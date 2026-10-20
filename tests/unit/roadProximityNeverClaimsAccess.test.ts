/**
 * A road NEARBY is never "road access" (P1-C audit follow-up).
 *
 * - dealFeedEngine pushed "Road access confirmed" onto the deal card whenever
 *   `enrichment.roadAccess` was anything but "none" — including "Unknown".
 * - dataIntelligenceEngine flagged "Excellent road access" (positive) for any
 *   parcel whose primary road was within 0.25 mi — a distance, not access.
 *
 * Falsified against the semantic claim, not the old literal: no signal derived
 * from proximity may assert access exists ("access confirmed", "excellent
 * access", "has road access"), and an unknown value yields no signal at all.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../server/db", () => ({ db: {} }));

import { extractEnvironmentalSignals, extractRiskSignals } from "../../server/services/dealFeedEngine";
import { calculateOpportunityScore } from "../../server/services/dataIntelligenceEngine";

/** Any phrase asserting access EXISTS, unless it says it is not verified. */
function assertsAccess(signal: string): boolean {
  if (/not verified/i.test(signal)) return false;
  return /(road |legal )?access( confirmed| verified)?/i.test(signal) && !/no (mapped )?road/i.test(signal);
}

describe("deal feed — environmental signals", () => {
  for (const roadAccess of ["paved", "gravel", "dirt", "nearby", "yes"]) {
    it(`roadAccess=${JSON.stringify(roadAccess)} → proximity wording, never an access claim`, () => {
      const signals = extractEnvironmentalSignals({ roadAccess });
      expect(signals.some(assertsAccess), signals.join(" | ")).toBe(false);
      expect(signals).toContain("Mapped road nearby (access not verified)");
    });
  }

  for (const roadAccess of ["Unknown", "unknown", "", undefined, null, "none"]) {
    it(`roadAccess=${JSON.stringify(roadAccess)} → no positive road signal`, () => {
      const signals = extractEnvironmentalSignals({ roadAccess });
      expect(signals.filter((s) => /road/i.test(s))).toEqual([]);
    });
  }

  it("roadAccess=none → risk names the observation, not a legal verdict", () => {
    const risks = extractRiskSignals({ roadAccess: "none" });
    expect(risks).toContain("No mapped road nearby (access not verified)");
    expect(risks).not.toContain("No road access");
  });
});

describe("opportunity scorer — road distance is not access", () => {
  for (const miles of [0, 0.1, 0.25]) {
    it(`primary road ${miles} mi away → no flag asserting access`, () => {
      const score = calculateOpportunityScore({ distanceToPrimaryRoad: miles });
      const roadFlags = score.flags.filter((f) => /road/i.test(f.signal));
      expect(roadFlags.length, "proximity flag still present").toBeGreaterThan(0);
      for (const f of roadFlags) {
        expect(assertsAccess(f.signal), f.signal).toBe(false);
        expect(f.impact).not.toMatch(/accessible to all/i);
      }
    });
  }
});
