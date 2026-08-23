/**
 * `execute()` returns a QueryResult. It is not an array and never was.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 * `server/db.ts` builds drizzle on `drizzle-orm/node-postgres` with a `pg.Pool`,
 * so `reader.execute(sql)` resolves to a node-postgres **QueryResult** — an
 * object carrying `.rows`, `.rowCount`, `.fields`. It has no `.length` and is
 * not iterable.
 *
 * `routes-cohort-retention.ts` treated it as an array twice:
 *
 *     const signupRows = (signups as unknown as SignupRow[]) ?? [];
 *     for (const row of signupRows) { … }        // throws: not iterable
 *
 *     const matched = (probe as unknown as unknown[])?.length ?? 0;
 *     if (matched > 0) retained++;               // .length undefined -> always 0
 *
 * The first one throws on EVERY request, so the endpoint has never produced a
 * cohort. Even had it survived, the second guarantees every cohort reports 0%
 * retention. A founder reading that dashboard would see a real-looking zero.
 *
 * ── HOW IT WAS FOUND, AND WHY THE CAST FORM MATTERS ─────────────────────────
 * `as unknown as T` is a DOUBLE assertion: the first half erases the type, the
 * second asserts a shape nothing checks. `check-ghost-fields.mjs` originally
 * matched `as any` only and said so in its own note after founder-chat's
 * stripe-ops used this exact form to read a field `Stripe.Subscription` does not
 * have. Widening the gate to the second form put 38 more property reads in scope
 * and surfaced this one.
 *
 * The honest footnote: 1 ghost out of 27 judgeable double assertions. The gap
 * was real; the population behind it is mostly legitimate conversion. Both
 * halves of that are worth knowing before widening the next lens.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const code = (rel: string) =>
  read(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const COHORT = "server/routes-cohort-retention.ts";

describe("the driver really does return a QueryResult", () => {
  it("VACUITY: db.ts builds on node-postgres, so .rows is the contract", () => {
    // If the driver ever changes, `execute()` may genuinely return an array and
    // this whole file is asserting the wrong thing. Pinned so that swap cannot
    // happen silently underneath it.
    const db = code("server/db.ts");
    expect(db).toMatch(/drizzle-orm\/node-postgres/);
    expect(db).toMatch(/from "pg"/);
  });

  it("the house convention reads .rows", () => {
    // routes-platform-features has always done this correctly; it is the
    // independent third source that settles what the shape is.
    expect(code("server/routes-platform-features.ts")).toMatch(/\.rows\?\.\[0\]/);
  });
});

describe("cohort retention reads rows, not the result object", () => {
  it("takes signup rows from .rows", () => {
    expect(code(COHORT)).toMatch(/signups\.rows\s*\?\?\s*\[\]/);
  });

  it("counts the probe from .rows, not .length on the result", () => {
    expect(code(COHORT)).toMatch(/probe\.rows\?\.length\s*\?\?\s*0/);
  });

  it("asserts no result object is cast to an array or array-like", () => {
    // Value-level and shape-level: any `as unknown as <something>[]` on an
    // execute() result reintroduces the defect whatever the element type is.
    const c = code(COHORT);
    expect(
      c,
      "an execute() result is being cast to an array again — QueryResult is an object " +
        "with .rows, and a for...of over it throws",
    ).not.toMatch(/as unknown as\s+\w+\[\]/);
    expect(c).not.toMatch(/as unknown as unknown\[\]/);
  });

  it("still iterates the rows it extracted, so the fix is not a deletion", () => {
    // Guards the other direction: quietly dropping the loop would satisfy every
    // assertion above while producing no cohorts at all.
    const c = code(COHORT);
    expect(c).toMatch(/for \(const row of signupRows\)/);
    expect(c).toMatch(/if \(matched > 0\) retained\+\+/);
  });
});
