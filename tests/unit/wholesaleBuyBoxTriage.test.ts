/**
 * Buy-box criteria and candidate triage — the pure half of Leg 2.
 * FALSIFYING: on pre-leg main shared/wholesale/buyBox.ts does not exist.
 *
 * Every criterion is proved in both directions (passes / fails with a named
 * reason), an unrecorded fact is UNKNOWN (never a pass, never a fail, never in
 * the score), a candidate with nothing evaluable is `undetermined` rather than
 * a 100% fit, and staleness retires with the date and the window named.
 */
import { describe, expect, it } from "vitest";
import { buyBoxCriteriaSchema, triageCandidates, type BuyBoxCriteria, type CandidateFacts } from "../../shared/wholesale/buyBox";

const triageCandidate = (b: BuyBoxCriteria, c: CandidateFacts, now: Date) => triageCandidates(b, [c], now)[0];

const NOW = new Date("2026-11-05T12:00:00Z");
const box: BuyBoxCriteria = {
  states: ["TX"],
  counties: [{ state: "TX", county: "Harris" }],
  zips: ["77002"],
  maxPurchasePriceCents: 20_000_000,
  minAssignmentFeeCents: 1_000_000,
  staleAfterDays: 30,
};
const fit: CandidateFacts = {
  propertyId: 1,
  label: "9 Main St",
  state: "TX",
  county: "Harris County",
  zip: "77002-1234",
  priceCents: 15_000_000,
  underwrittenFeeCents: 1_200_000,
  lastActivityAt: new Date("2026-11-01T00:00:00Z"),
};

describe("criteria", () => {
  it("requires states and a stale window; rejects malformed codes; DROPS unknown keys", () => {
    expect(buyBoxCriteriaSchema.safeParse(box).success).toBe(true);
    for (const bad of [
      { ...box, states: [] },
      { ...box, states: ["Texas"] },
      { ...box, staleAfterDays: 0 },
      { ...box, zips: ["7700"] },
    ]) {
      expect(buyBoxCriteriaSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
    const extra = buyBoxCriteriaSchema.parse({ ...box, ownerPhone: "x", skipTrace: true });
    expect(extra).toEqual(box);
  });
});

describe("triage — each criterion in both directions, with named reasons", () => {
  it("a candidate meeting every criterion fits at 100%", () => {
    const r = triageCandidate(box, fit, NOW);
    expect(r).toMatchObject({ verdict: "fits", score: 1, failures: [], unknowns: [] });
    expect(r.passed).toHaveLength(5);
  });

  it.each([
    // A county is named WITH its state, so the out-of-state candidate fails both.
    ["state", { state: "FL" }, /outside your states/, 3 / 5],
    ["county", { county: "Dallas" }, /Dallas County, TX is not one of your counties/, 4 / 5],
    ["zip", { zip: "75201" }, /ZIP 75201 is not one of your ZIPs/, 4 / 5],
    ["price", { priceCents: 25_000_000 }, /over your \$200,000 max/, 4 / 5],
    ["fee", { underwrittenFeeCents: 500_000 }, /under your \$10,000 minimum/, 4 / 5],
  ] as const)("%s failing is named and fails the candidate", (_k, patch, reason, score) => {
    const r = triageCandidate(box, { ...fit, ...patch }, NOW);
    expect(r.verdict).toBe("fails");
    expect(r.failures.join(" ")).toMatch(reason);
    expect(r.score).toBeCloseTo(score);
  });

  it("an unrecorded fact is unknown — not a pass, not a fail, not in the score", () => {
    const r = triageCandidate(box, { ...fit, priceCents: null, underwrittenFeeCents: null }, NOW);
    expect(r.verdict).toBe("fits");
    expect(r.unknowns).toEqual(["No offer or contract price is recorded on a deal.", "Not underwritten yet, so there is no fee to check."]);
    expect(r.score).toBe(1); // 3 of 3 evaluated
  });

  it("nothing evaluable is `undetermined`, never a 100% fit", () => {
    const r = triageCandidate({ states: ["TX"], staleAfterDays: 30 }, { ...fit, state: null }, NOW);
    expect(r).toMatchObject({ verdict: "undetermined", score: null });
  });

  it("stale retires with the date and window named; fresh does not (boundary)", () => {
    const stale = triageCandidate(box, { ...fit, lastActivityAt: new Date("2026-10-01T00:00:00Z") }, NOW);
    expect(stale.verdict).toBe("retired");
    expect(stale.retiredBecause).toBe("No activity since 2026-10-01 — past your 30-day window.");
    const edge = triageCandidate(box, { ...fit, lastActivityAt: new Date(NOW.getTime() - 30 * 86_400_000) }, NOW);
    expect(edge.verdict).toBe("fits");
    expect(triageCandidate(box, { ...fit, lastActivityAt: null }, NOW).verdict).toBe("retired");
  });

  it("orders fits (best first), then fails, undetermined, retired", () => {
    const rows = triageCandidates(
      box,
      [
        { ...fit, propertyId: 1, lastActivityAt: null },
        { ...fit, propertyId: 2, state: "FL" },
        { ...fit, propertyId: 3 },
        { ...fit, propertyId: 4, state: null, county: null, zip: null, priceCents: null, underwrittenFeeCents: null },
      ],
      NOW,
    );
    expect(rows.map((r) => [r.propertyId, r.verdict])).toEqual([[3, "fits"], [2, "fails"], [4, "undetermined"], [1, "retired"]]);
  });
});
