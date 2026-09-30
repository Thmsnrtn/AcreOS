/**
 * Quality directive 2026-09-29 — `GET /api/market-intelligence/public/data`
 * served eight hard-coded state price-per-acre figures stamped with a fresh
 * `generatedAt`, unauthenticated, as market intelligence. It had no caller and
 * was removed. This pins that the router registers no public price route, and
 * that no route in it answers with a literal price table.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { stripComments } from "../helpers/stripComments";

const SRC = stripComments(readFileSync(resolve(__dirname, "../../server/routes-market-intelligence.ts"), "utf8"));

describe("market intelligence publishes no invented public prices", () => {
  it("the router registers no /public route", () => {
    const paths = [...SRC.matchAll(/router\.(?:get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]/g)].map((m) => m[1]);
    expect(paths.length).toBeGreaterThan(0); // vacuity: the router still registers its real routes
    expect(paths.filter((p) => p.startsWith("/public"))).toEqual([]);
  });

  it("no literal avgPricePerAcre figure is served", () => {
    expect(SRC).not.toMatch(/avgPricePerAcre:\s*\d/);
  });
});
