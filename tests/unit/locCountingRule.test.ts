/**
 * Roadmap W10.1 — the LOC target has a counting rule.
 *
 * The deletion ledger set ≤650K (G2) and ≤600K (end of H2) with no rule for
 * counting, so neither could ever be proven. scripts/measure-loc.mjs is the
 * rule; this pins what it counts and that its population cannot silently
 * empty.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { measureLoc, isProductSource, LOC_FILE_FLOOR, LOC_ROOTS } from "../../scripts/measure-loc.mjs";

describe("production LOC is counted one way", () => {
  it("counts product source and nothing else", () => {
    expect(LOC_ROOTS).toEqual(["server/", "client/src/", "shared/"]);
    expect(isProductSource("server/routes-deals.ts")).toBe(true);
    expect(isProductSource("client/src/pages/deals.tsx")).toBe(true);
    expect(isProductSource("shared/schema.ts")).toBe(true);
    expect(isProductSource("server/services/borrower/statementAccess.test.ts")).toBe(false);
    expect(isProductSource("client/src/components/__tests__/x.tsx")).toBe(false);
    expect(isProductSource("scripts/ratchet.mjs")).toBe(false);
    expect(isProductSource("tests/unit/locCountingRule.test.ts")).toBe(false);
  });

  it("the population is real (vacuity floor) and the count is plausible", () => {
    const r = measureLoc();
    expect(r.files).toBeGreaterThanOrEqual(LOC_FILE_FLOOR);
    expect(r.lines).toBeGreaterThan(r.files * 50);
  });

  it("the roadmap cites the rule it is measured by", () => {
    expect(readFileSync("docs/company/roadmap-2026-10.md", "utf8")).toMatch(/npm run measure:loc/);
  });
});
