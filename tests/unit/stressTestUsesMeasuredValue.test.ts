/**
 * DEFECT-0280 — the portfolio stress test applies scenarios to the measured
 * portfolio value, never to a placeholder.
 *
 * It read its value with GET /api/portfolio-optimizer/simulate — a route that
 * exists only as POST — so the read always failed, `.catch` turned that into
 * `{ simulation: null }`, and `|| 500000` stress-tested an invented $500,000
 * for every customer. It now takes the value the page already measures
 * (`/api/portfolio-optimizer/metrics` → `totalValue`) and shows an empty state
 * when there is none. Source-level, comments stripped.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { stripComments } from "./../helpers/stripComments";

const src = stripComments(readFileSync("client/src/pages/portfolio-optimizer.tsx", "utf8"));
const at = src.indexOf("function StressTestTab(");
const body = src.slice(at, src.indexOf("\nfunction ", at + 10) === -1 ? undefined : src.indexOf("\nfunction ", at + 10));

describe("the stress test reads the measured value", () => {
  it("vacuity: the component exists", () => {
    expect(at).toBeGreaterThan(-1);
  });
  it("is handed the page's measured totalValue", () => {
    expect(src).toMatch(/<StressTestTab totalValue=\{metrics\?\.totalValue\}/);
  });
  it("invents no value and reads no route of its own", () => {
    expect(body).not.toMatch(/\b500000\b|500_000/);
    expect(body).not.toMatch(/fetch\(/);
    expect(body).toMatch(/<EmptyState/);
  });
});
