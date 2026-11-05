/**
 * An absent field in an update means "unchanged" — never the create-time default.
 *
 * Under Zod 4, `schema.partial()` KEEPS each field's `.default(...)`, so a PATCH
 * body that omits a defaulted field parses AS the default, and a handler that
 * copies every defined key writes it over the stored value. Measured 2026-11-05:
 * saving only "spent" on a rehab line zeroed its budget and committed amounts.
 *
 * Two halves:
 *   1. BEHAVIOUR — `patchSchemaOf` drops defaults (and the trap it replaces is
 *      real, so this test is not vacuous if Zod changes).
 *   2. POPULATION — every `X.partial()` in server/ whose `X` is a local schema
 *      carrying `.default(` is counted. The fix-and-flip routes are at zero; the
 *      rest are listed and held at a baseline that may only SHRINK (they belong
 *      to other verticals' lanes and are reported, not fixed here). A canary
 *      proves the scanner sees the shape.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { stripComments } from "../helpers/stripComments";
import { patchSchemaOf } from "../../server/utils/updatePayload";

const ROOT = path.resolve(__dirname, "../..");

describe("patchSchemaOf", () => {
  const create = z.object({
    name: z.string(),
    budgetCents: z.coerce.number().int().default(0),
    status: z.enum(["planning", "demo"]).default("planning"),
  });

  it("the trap is real: .partial() fills defaults for absent fields", () => {
    expect(create.partial().parse({ name: "x" })).toEqual({ name: "x", budgetCents: 0, status: "planning" });
  });

  it("defaults nested under nullable/optional, and prefaults, are removed too; object settings survive", () => {
    const nested = z
      .object({
        a: z.string().default("d").nullable(),
        b: z.number().prefault(5),
        c: z.number().default(1).optional(),
      })
      .strict();
    const patch = patchSchemaOf(nested);
    expect(patch.parse({})).toEqual({});
    expect(patch.parse({ a: null })).toEqual({ a: null });
    expect(patch.safeParse({ zzz: 1 }).success, "strict() survives").toBe(false);
  });

  it("patchSchemaOf leaves absent fields absent, and still validates present ones", () => {
    const patch = patchSchemaOf(create);
    expect(patch.parse({ name: "x" })).toEqual({ name: "x" });
    expect(patch.parse({ budgetCents: "12" })).toEqual({ budgetCents: 12 });
    expect(patch.safeParse({ status: "sold" }).success).toBe(false);
  });
});

/**
 * `.partial()` calls the scanner cannot resolve to a local `z.object({...})`
 * definition: chained (`x.omit(...).partial()`), imported, or built with
 * `.extend`. They are COUNTED, not assumed clean — the population law: a unit
 * the gate cannot read is reported, never skipped.
 */
function unresolved(file: string, text: string): string[] {
  const src = stripComments(text);
  const out: string[] = [];
  for (const m of src.matchAll(/(\w+|\))\s*\.\s*partial\(\s*\)/g)) {
    const name = m[1];
    if (name === ")" || !new RegExp(`(?:const|let)\\s+${name}\\s*=\\s*z\\.object\\(\\{`).test(src)) out.push(`${file}::${name === ")" ? "<chained>" : name}`);
  }
  return out;
}

/** Every `X.partial()` in a file whose local `X` definition contains `.default(`. */
function offenders(file: string, text: string): string[] {
  const src = stripComments(text);
  const out: string[] = [];
  for (const m of src.matchAll(/(\w+)\s*\.\s*partial\(\s*\)/g)) {
    const name = m[1];
    const def = new RegExp(`(?:const|let)\\s+${name}\\s*=\\s*z\\.object\\(\\{([\\s\\S]*?)\\n\\}\\)`).exec(src);
    if (def && def[1].includes(".default(")) out.push(`${file}::${name}`);
  }
  return out;
}

function serverFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return serverFiles(p);
    return /\.ts$/.test(e.name) && !/\.test\.ts$/.test(e.name) ? [p] : [];
  });
}

/**
 * MEASURED 2026-11-05 after the fix-and-flip routes were fixed. Other lanes'
 * update schemas with the same shape — each a PATCH that can reset a defaulted
 * field it was not sent. DOWN-ONLY: fix one, remove it here in the same commit.
 */
const UNRESOLVED_BASELINE = 15;

const KNOWN_OFFENDERS = [
  "server/api-v1/leads.ts::createLeadSchema",
  "server/routes-ccr-templates.ts::createSchema",
  "server/routes-double-close.ts::createSchema",
  "server/routes-move-inspections.ts::inspectionSchema",
  "server/routes-rentals.ts::leaseSchema",
  "server/routes-rentals.ts::tenantBase",
  "server/routes-rentals.ts::unitCreateSchema",
  "server/routes-tax-researcher.ts::auctionBodySchema",
];

describe("population: update schemas that keep create-time defaults", () => {
  const files = serverFiles(path.join(ROOT, "server"));
  const found = files
    .flatMap((f) => offenders(path.relative(ROOT, f).split(path.sep).join("/"), fs.readFileSync(f, "utf8")))
    .sort();

  it("read the whole server tree (vacuity floor)", () => {
    expect(files.length).toBeGreaterThan(1000);
  });

  it("the scanner sees the shape (canary)", () => {
    const canary = `const s = z.object({\n  a: z.number().default(0),\n});\nconst u = s.partial();\n`;
    expect(offenders("canary.ts", canary)).toEqual(["canary.ts::s"]);
    expect(offenders("ok.ts", canary.replace(".default(0)", ".optional()"))).toEqual([]);
  });

  it("the fix-and-flip update routes carry none", () => {
    expect(found.filter((f) => /routes-(rehabs|construction-draws|bid-estimates|flip)/.test(f))).toEqual([]);
  });

  it("partial() calls the scanner cannot read are counted, not assumed clean", () => {
    const u = files.flatMap((f) => unresolved(path.relative(ROOT, f).split(path.sep).join("/"), fs.readFileSync(f, "utf8")));
    // MEASURED 2026-11-05. DOWN-ONLY: resolve one (or convert it to patchSchemaOf) and lower this.
    expect(u.length, `unreadable partial() sites:\n${u.join("\n")}`).toBeLessThanOrEqual(UNRESOLVED_BASELINE);
    expect(u.length, "the count dropped — lower UNRESOLVED_BASELINE").toBe(UNRESOLVED_BASELINE);
  });

  it("no NEW offender, and the known list is not stale", () => {
    expect(found, "a new update schema keeps create-time defaults — use patchSchemaOf(schema)").toEqual(KNOWN_OFFENDERS);
  });
});
