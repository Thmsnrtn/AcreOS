/**
 * Lot-vs-home rent split engine (mobile_home Stage 1a) — the POH/TOH honesty.
 *
 * A mobile-home park's rent is not one number; the split between LOT rent (the
 * ground) and HOME rent (a park-owned home) is a fact the operator records, and
 * every rule that keeps it honest gets a behavioural test here, not just a
 * source assertion:
 *   • a park-owned-home (POH) split is DECOMPOSED from both recorded components;
 *   • a tenant-owned-home (TOH) lot bills lot rent only (no home rent invented);
 *   • the POH/TOH mix COUNTS recorded ownership — an unrecorded flag is
 *     unclassified, never bucketed by a guess;
 *   • the conversion-trade delta compares two recorded cohorts, and is null
 *     (unavailable) when either is empty — never a computed-looking zero;
 *   • an unrecorded split REFUSES that lease rather than infer a decomposition.
 */
import { describe, it, expect } from "vitest";
import {
  computeLotRentSplit,
  type LotRentLeaseInput,
} from "../../shared/rental/lotRentSplit";

const TWO_POH: LotRentLeaseInput[] = [
  { ref: "Lot 1", homeOwnership: "park_owned", lotRentCents: 40_000, homeRentCents: 60_000 },
  { ref: "Lot 2", homeOwnership: "park_owned", lotRentCents: 45_000, homeRentCents: 55_000 },
];
const THREE_TOH: LotRentLeaseInput[] = [
  { ref: "Lot 3", homeOwnership: "tenant_owned", lotRentCents: 35_000, homeRentCents: null },
  { ref: "Lot 4", homeOwnership: "tenant_owned", lotRentCents: 40_000, homeRentCents: null },
  { ref: "Lot 5", homeOwnership: "tenant_owned", lotRentCents: 45_000, homeRentCents: null },
];

describe("per-lease split math", () => {
  it("decomposes a park-owned-home lease into lot + home = total", () => {
    const r = computeLotRentSplit([TWO_POH[0]]);
    const line = r.leases[0];
    expect(line.homeOwnership).toBe("park_owned");
    expect(line.lotRentCents).toBe(40_000);
    expect(line.homeRentCents).toBe(60_000);
    expect(line.totalRentCents).toBe(100_000);
    expect(line.refusedReason).toBeNull();
  });

  it("bills a tenant-owned-home lot on lot rent only — no home rent invented", () => {
    const r = computeLotRentSplit([THREE_TOH[0]]);
    const line = r.leases[0];
    expect(line.homeOwnership).toBe("tenant_owned");
    expect(line.lotRentCents).toBe(35_000);
    expect(line.homeRentCents).toBeNull();
    expect(line.totalRentCents).toBe(35_000);
    expect(line.refusedReason).toBeNull();
  });
});

describe("park-level POH/TOH mix + totals", () => {
  const r = computeLotRentSplit([...TWO_POH, ...THREE_TOH]);

  it("counts recorded POH and TOH leases", () => {
    expect(r.pohCount).toBe(2);
    expect(r.tohCount).toBe(3);
    expect(r.unclassifiedCount).toBe(0);
  });

  it("computes the POH mix in basis points of the classified leases", () => {
    // 2 of 5 classified are POH → 40.00%.
    expect(r.pohMixBps).toBe(4_000);
  });

  it("sums the recorded components", () => {
    expect(r.pohLotRentTotalCents).toBe(85_000);
    expect(r.pohHomeRentTotalCents).toBe(115_000);
    expect(r.tohLotRentTotalCents).toBe(120_000);
    expect(r.parkTotalRentCents).toBe(320_000); // 85000 + 115000 + 120000
  });

  it("computes the conversion-trade delta = avg POH total − avg TOH lot", () => {
    expect(r.avgPohTotalRentCents).toBe(100_000); // (100000 + 100000) / 2
    expect(r.avgTohLotRentCents).toBe(40_000);    // (35000 + 40000 + 45000) / 3
    expect(r.conversionTradeDeltaCents).toBe(60_000);
  });
});

describe("refuse-not-fabricate — an unrecorded split is never inferred", () => {
  it("REFUSES a park-owned-home lease missing its home-rent component", () => {
    const r = computeLotRentSplit([
      { ref: "Lot X", homeOwnership: "park_owned", lotRentCents: 40_000, homeRentCents: null },
    ]);
    const line = r.leases[0];
    expect(line.totalRentCents).toBeNull();
    expect(line.refusedReason).toBeTruthy();
    expect(r.pohCount).toBe(0);
    expect(r.unclassifiedCount).toBe(1);
  });

  it("REFUSES a lease whose ownership (POH/TOH) is not recorded", () => {
    const r = computeLotRentSplit([
      { ref: "Lot Y", homeOwnership: null, lotRentCents: 40_000, homeRentCents: null },
    ]);
    const line = r.leases[0];
    expect(line.totalRentCents).toBeNull();
    expect(line.refusedReason).toBeTruthy();
    expect(r.unclassifiedCount).toBe(1);
    expect(r.pohMixBps).toBeNull(); // nothing classified
  });

  it("REFUSES a tenant-owned-home lot with no lot rent recorded", () => {
    const r = computeLotRentSplit([
      { ref: "Lot Z", homeOwnership: "tenant_owned", lotRentCents: null, homeRentCents: null },
    ]);
    expect(r.leases[0].refusedReason).toBeTruthy();
    expect(r.tohCount).toBe(0);
    expect(r.unclassifiedCount).toBe(1);
  });

  it("reports the conversion-trade delta as null (unavailable) when a cohort is empty", () => {
    const pohOnly = computeLotRentSplit(TWO_POH);
    expect(pohOnly.avgTohLotRentCents).toBeNull();
    expect(pohOnly.conversionTradeDeltaCents).toBeNull();
    expect(pohOnly.pohMixBps).toBe(10_000); // all classified leases are POH

    const tohOnly = computeLotRentSplit(THREE_TOH);
    expect(tohOnly.avgPohTotalRentCents).toBeNull();
    expect(tohOnly.conversionTradeDeltaCents).toBeNull();
  });
});
