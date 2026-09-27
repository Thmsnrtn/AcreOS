/**
 * DEFECT-0110 — a recent DR drill that missed its RTO target is not "ready".
 * The step-away check returned ready for any drill under 90 days old, with
 * "target MISSED" in its own detail text.
 */
import { describe, expect, it } from "vitest";
import { drDrillVerdict } from "../../server/services/autopilot/drDrillStatus";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const now = new Date("2026-09-27T12:00:00Z");
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000);

describe("drDrillVerdict", () => {
  it("no drill ever → attention", () => {
    expect(drDrillVerdict(undefined, now).status).toBe("attention");
  });
  it("recent drill that PASSED → ready", () => {
    expect(drDrillVerdict({ ranAt: daysAgo(10), passed: true, rto: 42 }, now).status).toBe("ready");
  });
  it("recent drill that FAILED its RTO target → attention, not ready", () => {
    const v = drDrillVerdict({ ranAt: daysAgo(10), passed: false, rto: 190 }, now);
    expect(v.status).toBe("attention");
    expect(v.detail).toMatch(/MISSED/);
  });
  it("recent drill with no recorded pass/fail → attention", () => {
    expect(drDrillVerdict({ ranAt: daysAgo(10), passed: null, rto: null }, now).status).toBe("attention");
  });
  it("stale drill, even a passing one → attention", () => {
    expect(drDrillVerdict({ ranAt: daysAgo(120), passed: true, rto: 42 }, now).status).toBe("attention");
  });
  it("the step-away readiness check uses this verdict (adoption, not a parallel rule)", () => {
    const src = readFileSync(resolve(__dirname, "../../server/services/autopilot/stepAwayReadiness.ts"), "utf8");
    expect(src).toMatch(/drDrillVerdict\(latest, new Date\(\)\)/);
    expect(src).not.toMatch(/status: "ready", detail: `Last DR drill/);
  });
});
