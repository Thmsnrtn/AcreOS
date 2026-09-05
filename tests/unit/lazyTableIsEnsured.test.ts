/**
 * Every statement naming a lazily-created table must ensure it first.
 *
 * `intelligence_job_runs` is not in the Drizzle schema and not in any
 * migration — `server/services/intelligence/coordinator.ts` creates it itself
 * with `CREATE TABLE IF NOT EXISTS` on first use. That is a deliberate choice,
 * and it has one obligation attached: EVERY path that touches the table has to
 * run the create first, because nothing else will.
 *
 * The reader did. Both writers did not:
 *
 *     recordSkip     INSERT … ON CONFLICT (name) DO UPDATE …
 *     recordJobRun   INSERT … ON CONFLICT (name) DO UPDATE …   (exported)
 *
 * and both wrap the statement in a `catch` that logs a warn. So "relation
 * intelligence_job_runs does not exist" read exactly like a successful
 * bookkeeping write — visible in the E2E's postgres log, invisible to the
 * coordinator. This service exists to DEDUPE expensive AI work; a lost record
 * means the next tick re-runs work it had decided to skip.
 *
 * `recordJobRun` is exported, so it can be reached without `shouldRunAIJob`
 * having run in the process at all — its doc comment asks callers to pair
 * them, and a doc comment is not an enforcement.
 *
 * This derives the population from the file rather than listing the three
 * functions: a fourth statement added later is what has to fail here.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "../helpers/stripComments";

const FILE = "server/services/intelligence/coordinator.ts";
const LAZY_TABLE = "intelligence_job_runs";

/** Top-level function declarations, with their bodies, comments stripped. */
function functionsIn(src: string): Array<{ name: string; body: string }> {
  const out: Array<{ name: string; body: string }> = [];
  const re = /(?:export\s+)?async\s+function\s+([A-Za-z_$][\w$]*)\s*\(/g;
  const starts: Array<{ name: string; at: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) starts.push({ name: m[1], at: m.index });
  for (let i = 0; i < starts.length; i++) {
    const end = i + 1 < starts.length ? starts[i + 1].at : src.length;
    out.push({ name: starts[i].name, body: src.slice(starts[i].at, end) });
  }
  return out;
}

describe("intelligence coordinator: the lazily-created table is ensured on every path", () => {
  const src = stripComments(
    fs.readFileSync(path.resolve(__dirname, "../..", FILE), "utf8"),
  );
  const fns = functionsIn(src);

  it("reads the file's functions (vacuity)", () => {
    // A parser that stops matching reports zero offenders, which is exactly
    // what a clean file looks like.
    expect(fns.length).toBeGreaterThanOrEqual(4);
    expect(fns.map((f) => f.name)).toContain("ensureTable");
  });

  it("finds the statements that name the table (vacuity)", () => {
    const touching = fns.filter(
      (f) => f.name !== "ensureTable" && f.body.includes(LAZY_TABLE),
    );
    // Measured 2026-09-05: getJobRunRow, recordSkip, recordJobRun.
    expect(touching.length).toBeGreaterThanOrEqual(3);
  });

  it.each(["getJobRunRow", "recordSkip", "recordJobRun"])(
    "%s ensures the table before its statement",
    (name) => {
      const fn = fns.find((f) => f.name === name);
      expect(fn, `${name} not found — was it renamed?`).toBeTruthy();
      expect(fn!.body).toContain(LAZY_TABLE);
      const ensureAt = fn!.body.indexOf("ensureTable()");
      const tableAt = fn!.body.indexOf(LAZY_TABLE);
      expect(ensureAt, `${name} never calls ensureTable()`).toBeGreaterThan(-1);
      // Ordering matters: an ensure AFTER the statement is no ensure at all.
      expect(ensureAt).toBeLessThan(tableAt);
    },
  );

  it("no function names the table without ensuring it first", () => {
    const offenders = fns
      .filter((f) => f.name !== "ensureTable" && f.body.includes(LAZY_TABLE))
      .filter((f) => {
        const ensureAt = f.body.indexOf("ensureTable()");
        return ensureAt === -1 || ensureAt > f.body.indexOf(LAZY_TABLE);
      })
      .map((f) => f.name);
    expect(offenders).toEqual([]);
  });
});
