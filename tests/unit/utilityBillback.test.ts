/**
 * Utility pass-through billback engine (mobile_home Stage 1b) — the honesty of a
 * passed-through utility charge. Every rule that keeps it honest is pinned
 * behaviourally, not just asserted in source:
 *   • SUBMETER bills (current − prior) × rate, and REFUSES a missing read or a
 *     non-monotonic (rollback/swap) pair rather than bill fabricated usage;
 *   • RUBS REFUSES without a master bill or a basis, and its allocation
 *     CONSERVES — the shares sum EXACTLY to the master bill with a deterministic
 *     remainder absorbed by the last allocated pad;
 *   • a pad missing its basis input is DISCLOSED (coverageComplete=false), never
 *     assigned a guessed share.
 */
import { describe, it, expect } from "vitest";
import {
  computeUtilityBillback,
  renderUtilityBillbackStatement,
} from "../../shared/rental/utilityBillback";
import { formatCents } from "../../shared/finance/cents";

describe("submeter — (current − prior) × rate, refuse the rest", () => {
  it("bills each pad's metered consumption at the rate", () => {
    const r = computeUtilityBillback({
      method: "submeter",
      ratePerUnitCents: 500,
      pads: [
        { unitId: "A", priorReading: 100, currentReading: 150 }, // 50 × 500
        { unitId: "B", priorReading: 200, currentReading: 260 }, // 60 × 500
      ],
    });
    expect(r.coverageComplete).toBe(true);
    expect(r.refusedReason).toBeNull();
    expect(r.perPad[0]).toMatchObject({ unitId: "A", basisAmount: 50, allocatedCents: 25_000 });
    expect(r.perPad[1]).toMatchObject({ unitId: "B", basisAmount: 60, allocatedCents: 30_000 });
    expect(r.allocatedCents).toBe(55_000);
  });

  it("REFUSES a pad with a missing read and discloses partial coverage", () => {
    const r = computeUtilityBillback({
      method: "submeter",
      ratePerUnitCents: 500,
      pads: [
        { unitId: "A", priorReading: 100, currentReading: 150 },
        { unitId: "B", priorReading: null, currentReading: 300 },
      ],
    });
    expect(r.perPad[0].allocatedCents).toBe(25_000);
    expect(r.perPad[1].allocatedCents).toBeNull();
    expect(r.perPad[1].refusedReason).toBeTruthy();
    expect(r.coverageComplete).toBe(false);
    // Only the billable pad contributes to the total.
    expect(r.allocatedCents).toBe(25_000);
  });

  it("REFUSES a non-monotonic (rollback/swap) read pair", () => {
    const r = computeUtilityBillback({
      method: "submeter",
      ratePerUnitCents: 500,
      pads: [{ unitId: "A", priorReading: 500, currentReading: 400 }],
    });
    expect(r.perPad[0].allocatedCents).toBeNull();
    expect(r.perPad[0].refusedReason).toMatch(/lower than the prior|rollback|swap/i);
    expect(r.coverageComplete).toBe(false);
  });

  it("REFUSES the whole billback with no rate", () => {
    const r = computeUtilityBillback({
      method: "submeter",
      ratePerUnitCents: null,
      pads: [{ unitId: "A", priorReading: 100, currentReading: 150 }],
    });
    expect(r.refusedReason).toBeTruthy();
    expect(r.perPad).toHaveLength(0);
  });
});

describe("rubs — allocate the master bill, conserve to the cent", () => {
  it("splits equally with the remainder on the last pad (sum == master)", () => {
    const r = computeUtilityBillback({
      method: "rubs",
      masterBillCents: 100_000,
      basis: "equal",
      pads: [{ unitId: "A", basisValue: null }, { unitId: "B", basisValue: null }, { unitId: "C", basisValue: null }],
    });
    // floor(100000/3) = 33333 for the first two; the last absorbs the remainder.
    expect(r.perPad.map((p) => p.allocatedCents)).toEqual([33_333, 33_333, 33_334]);
    expect(r.perPad.reduce((s, p) => s + (p.allocatedCents ?? 0), 0)).toBe(100_000);
    expect(r.allocatedCents).toBe(100_000);
    expect(r.coverageComplete).toBe(true);
  });

  it("weights by occupants and conserves exactly", () => {
    const r = computeUtilityBillback({
      method: "rubs",
      masterBillCents: 100_000,
      basis: "occupants",
      pads: [
        { unitId: "A", basisValue: 2 }, // floor(100000*2/10) = 20000
        { unitId: "B", basisValue: 3 }, // floor(100000*3/10) = 30000
        { unitId: "C", basisValue: 5 }, // last: 100000 − 50000 = 50000
      ],
    });
    expect(r.perPad.map((p) => p.allocatedCents)).toEqual([20_000, 30_000, 50_000]);
    expect(r.perPad.reduce((s, p) => s + (p.allocatedCents ?? 0), 0)).toBe(100_000);
  });

  it("puts a rounding remainder on the last pad deterministically", () => {
    const r = computeUtilityBillback({
      method: "rubs",
      masterBillCents: 100,
      basis: "occupants",
      pads: [
        { unitId: "A", basisValue: 1 }, // floor(100/3) = 33
        { unitId: "B", basisValue: 1 }, // floor(100/3) = 33
        { unitId: "C", basisValue: 1 }, // last: 100 − 66 = 34
      ],
    });
    expect(r.perPad.map((p) => p.allocatedCents)).toEqual([33, 33, 34]);
    expect(r.perPad.reduce((s, p) => s + (p.allocatedCents ?? 0), 0)).toBe(100);
  });

  it("DISCLOSES partial coverage when a pad lacks the basis input, still conserving to master", () => {
    const r = computeUtilityBillback({
      method: "rubs",
      masterBillCents: 100_000,
      basis: "occupants",
      pads: [
        { unitId: "A", basisValue: 2 },   // floor(100000*2/5) = 40000
        { unitId: "B", basisValue: 3 },   // last included: 100000 − 40000 = 60000
        { unitId: "C", basisValue: null }, // no occupant count → uncovered
      ],
    });
    expect(r.coverageComplete).toBe(false);
    const covered = r.perPad.filter((p) => p.refusedReason == null);
    const uncovered = r.perPad.filter((p) => p.refusedReason != null);
    expect(uncovered.map((p) => p.unitId)).toEqual(["C"]);
    // The included pads still absorb the WHOLE master bill (last absorbs remainder).
    expect(covered.reduce((s, p) => s + (p.allocatedCents ?? 0), 0)).toBe(100_000);
    expect(r.allocatedCents).toBe(100_000);
  });

  it("REFUSES the whole allocation without a master bill", () => {
    const r = computeUtilityBillback({
      method: "rubs",
      masterBillCents: null,
      basis: "equal",
      pads: [{ unitId: "A", basisValue: null }],
    });
    expect(r.refusedReason).toBeTruthy();
    expect(r.perPad).toHaveLength(0);
  });

  it("REFUSES the whole allocation without a basis", () => {
    const r = computeUtilityBillback({
      method: "rubs",
      masterBillCents: 100_000,
      basis: null,
      pads: [{ unitId: "A", basisValue: 2 }],
    });
    expect(r.refusedReason).toBeTruthy();
  });

  it("REFUSES when NO pad has a recorded basis (nothing to allocate by)", () => {
    const r = computeUtilityBillback({
      method: "rubs",
      masterBillCents: 100_000,
      basis: "sqft",
      pads: [{ unitId: "A", basisValue: null }, { unitId: "B", basisValue: null }],
    });
    expect(r.refusedReason).toBeTruthy();
    expect(r.perPad).toHaveLength(0);
  });
});

describe("renderUtilityBillbackStatement", () => {
  const ctx = { utilityKind: "water" as const, periodStart: "2026-01-01", periodEnd: "2026-01-31" };

  it("caveats partial coverage and never renders a fabricated total on refusal", () => {
    const partial = computeUtilityBillback({
      method: "rubs",
      masterBillCents: 100_000,
      basis: "occupants",
      pads: [
        { unitId: "A", basisValue: 2 },
        { unitId: "B", basisValue: null },
      ],
    });
    const md = renderUtilityBillbackStatement(partial, ctx);
    expect(md).toMatch(/PARTIAL|provisional/);

    const refused = computeUtilityBillback({
      method: "rubs",
      masterBillCents: null,
      basis: "equal",
      pads: [{ unitId: "A", basisValue: null }],
    });
    const refusedMd = renderUtilityBillbackStatement(refused, ctx);
    expect(refusedMd).toContain("could not be produced");
    expect(refusedMd).not.toContain("Allocated to pads");
  });
});

describe("formatCents — now imported from its canonical home", () => {
  // This module used to export a byte-identical private copy, and this test
  // pinned it. The copy is gone (formatCentsIsCanonical.test.ts holds the repo
  // to one definition); the INVARIANT is unchanged and still asserted, because
  // a pad's utility bill is money an operator passes through to a resident.
  it("formats with commas and a real minus sign", () => {
    expect(formatCents(100_000)).toBe("$1,000.00");
    expect(formatCents(-2_550)).toBe("−$25.50");
  });
});
