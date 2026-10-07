/**
 * Every simulation invariant that declares a production alert HAS one.
 *
 * tests/simulation/invariants/registry.ts names, per invariant, whether it is
 * cheap and safe to read in production (`productionAlert`). The production
 * half is server/services/invariantWatch.ts, run by the health check. This
 * pins that the two populations agree in both directions: a registry entry
 * claiming an alert with no query is a claim the product does not keep, and a
 * query the registry does not know is an alert nobody canaried.
 */
import { describe, expect, it } from "vitest";
import { INVARIANTS } from "../simulation/invariants/registry";
import { invariantQueries } from "../../server/services/invariantWatch";
import { readFileSync } from "node:fs";
import { stripComments } from "../helpers/stripComments";

describe("production invariant watch", () => {
  const prod = new Set(INVARIANTS.filter((i) => i.productionAlert).map((i) => i.id));
  const queries = new Set(Object.keys(invariantQueries(new Date("2026-10-07T00:00:00Z"))));
  it("every registry invariant with a production alert has a production query", () => {
    expect(prod.size).toBeGreaterThanOrEqual(4);
    for (const id of prod) expect(queries, id).toContain(id);
  });
  it("every production query is a registry invariant", () => {
    for (const id of queries) expect(prod, id).toContain(id);
  });
  it("the health check runs it (adoption, not just existence)", () => {
    const src = readFileSync("server/services/healthCheck.ts", "utf8");
    const code = stripComments(src);
    expect(code).toMatch(/this\.checkInvariants\(\)/);
    expect(code).toMatch(/import\(['"]\.\/invariantWatch['"]\)/);
  });
});
