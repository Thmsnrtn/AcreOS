/**
 * Cause Giving rules battery (CG-1) — the pure-math heart of the program
 * (shared/cause-giving/rules.ts; spec §1.2–§1.5, §2 invariants).
 * Integer cents everywhere; every case asserts the sum invariant
 * Σ disbursable + Σ carryforwardOut = pool + Σ carryforwardIn.
 */
import { describe, expect, it } from "vitest";
import {
  MIN_DISBURSEMENT_CENTS,
  computeAllocations,
  computeQuarterPool,
  tallySnapshot,
  type AllocationInput,
  type AllocationRow,
} from "@shared/cause-giving/rules";

function expectInvariant(rows: AllocationRow[], input: AllocationInput) {
  const carryInTotal = Object.values(input.carryforwardInByCause ?? {}).reduce(
    (a, b) => a + b,
    0,
  );
  const out = rows.reduce(
    (a, r) => a + r.disbursableCents + r.carryforwardOutCents,
    0,
  );
  expect(out).toBe(input.poolCents + carryInTotal);
}

const CATS = { 1: "housing", 2: "housing", 3: "environment", 4: "environment" };

describe("computeQuarterPool (FC-CG-1: 1% of Schedule C NOP, as-is)", () => {
  it("pools exactly 1% of a profitable quarter", () => {
    expect(computeQuarterPool(1_000_000, 400_000)).toBe(6_000);
  });
  it("pools $0 for a break-even quarter", () => {
    expect(computeQuarterPool(100_00, 100_00)).toBe(0);
  });
  it("pools $0 for a loss quarter (published identically, spec §1.7)", () => {
    expect(computeQuarterPool(50_00, 100_00)).toBe(0);
  });
  it("floors the 1% in integer cents", () => {
    expect(computeQuarterPool(199, 0)).toBe(1);
    expect(computeQuarterPool(101, 0)).toBe(1);
    expect(computeQuarterPool(99, 0)).toBe(0);
  });
});

describe("tallySnapshot (one paying member = one vote)", () => {
  it("counts only paying members; churned members contribute no vote", () => {
    const { rows, totalVotes } = tallySnapshot([
      { causeId: 1, isPayingMember: true },
      { causeId: 1, isPayingMember: true },
      { causeId: 2, isPayingMember: true },
      { causeId: 2, isPayingMember: false }, // churned before the snapshot
      { causeId: 3, isPayingMember: false },
    ]);
    expect(totalVotes).toBe(3);
    expect(rows).toEqual([
      { causeId: 1, votes: 2, share: 2 / 3 },
      { causeId: 2, votes: 1, share: 1 / 3 },
    ]);
  });
  it("handles an empty tally", () => {
    expect(tallySnapshot([])).toEqual({ rows: [], totalVotes: 0 });
  });
});

describe("computeAllocations", () => {
  it("splits proportionally and assigns rounding residue to the largest share", () => {
    const input: AllocationInput = {
      poolCents: 100_001,
      snapshot: [
        { causeId: 1, votes: 1, share: 1 / 3 },
        { causeId: 2, votes: 1, share: 1 / 3 },
        { causeId: 3, votes: 1, share: 1 / 3 },
      ],
      payableCauseIds: [1, 2, 3],
      categoryByCause: CATS,
    };
    const rows = computeAllocations(input);
    const allocated = Object.fromEntries(rows.map((r) => [r.causeId, r.allocatedCents]));
    expect(allocated[1] + allocated[2] + allocated[3]).toBe(100_001);
    expect(Math.max(...Object.values(allocated))).toBe(33_335);
    expect(rows.every((r) => r.disposition === "disbursed")).toBe(true);
    expectInvariant(rows, input);
  });

  it("rolls a sub-$50 allocation forward instead of sending it (§1.4)", () => {
    const input: AllocationInput = {
      poolCents: 10_000,
      snapshot: [
        { causeId: 1, votes: 99, share: 0.99 },
        { causeId: 2, votes: 1, share: 0.01 },
      ],
      payableCauseIds: [1, 2],
      categoryByCause: CATS,
    };
    const rows = computeAllocations(input);
    const small = rows.find((r) => r.causeId === 2)!;
    expect(small.allocatedCents).toBe(100);
    expect(small.disposition).toBe("rolled");
    expect(small.disbursableCents).toBe(0);
    expect(small.carryforwardOutCents).toBe(100);
    expectInvariant(rows, input);
  });

  it("redistributes after 4 consecutive sub-threshold quarters, same category first (§1.4)", () => {
    const input: AllocationInput = {
      poolCents: 20_000,
      snapshot: [
        { causeId: 1, votes: 1, share: 0.5 },
        { causeId: 3, votes: 1, share: 0.5 },
      ],
      carryforwardInByCause: { 2: 4_000 },
      consecutiveSubThresholdQuartersByCause: { 2: 3 },
      payableCauseIds: [1, 2, 3],
      categoryByCause: CATS,
    };
    const rows = computeAllocations(input);
    const source = rows.find((r) => r.causeId === 2)!;
    expect(source.disposition).toBe("redistributed-out");
    expect(source.carryforwardOutCents).toBe(0);
    expect(source.redistributionToCauseIds).toEqual([1]); // same category wins over cause 3
    const target = rows.find((r) => r.causeId === 1)!;
    expect(target.disposition).toBe("redistributed-in");
    expect(target.disbursableCents).toBe(10_000 + 4_000);
    expect(target.redistributionFromCauseIds).toEqual([2]);
    const other = rows.find((r) => r.causeId === 3)!;
    expect(other.disbursableCents).toBe(10_000);
    expectInvariant(rows, input);
  });

  it("falls back to all above-threshold charities when the category has none (§1.4)", () => {
    const input: AllocationInput = {
      poolCents: 20_000,
      snapshot: [{ causeId: 3, votes: 1, share: 1 }],
      carryforwardInByCause: { 2: 4_000 },
      consecutiveSubThresholdQuartersByCause: { 2: 3 },
      payableCauseIds: [2, 3],
      categoryByCause: CATS,
    };
    const rows = computeAllocations(input);
    const target = rows.find((r) => r.causeId === 3)!;
    expect(target.disbursableCents).toBe(24_000);
    expectInvariant(rows, input);
  });

  it("does not redistribute before the 4th consecutive sub-threshold quarter", () => {
    const input: AllocationInput = {
      poolCents: 0,
      snapshot: [],
      carryforwardInByCause: { 2: 4_000 },
      consecutiveSubThresholdQuartersByCause: { 2: 2 },
      payableCauseIds: [2],
      categoryByCause: CATS,
    };
    const rows = computeAllocations(input);
    expect(rows).toHaveLength(1);
    expect(rows[0].disposition).toBe("rolled");
    expect(rows[0].carryforwardOutCents).toBe(4_000);
    expectInvariant(rows, input);
  });

  it("holds an unpayable cause exactly one quarter, then redistributes (§1.5)", () => {
    const first: AllocationInput = {
      poolCents: 6_000,
      snapshot: [{ causeId: 4, votes: 1, share: 1 }],
      payableCauseIds: [], // cause 4 is unpayable this quarter
      categoryByCause: CATS,
    };
    const firstRows = computeAllocations(first);
    expect(firstRows[0].disposition).toBe("unpayable-held");
    expect(firstRows[0].carryforwardOutCents).toBe(6_000);
    expectInvariant(firstRows, first);

    const second: AllocationInput = {
      poolCents: 10_000,
      snapshot: [{ causeId: 3, votes: 1, share: 1 }],
      carryforwardInByCause: { 4: 6_000 },
      payableCauseIds: [3],
      unpayableHeldCauseIds: [4],
      categoryByCause: CATS,
    };
    const secondRows = computeAllocations(second);
    const held = secondRows.find((r) => r.causeId === 4)!;
    expect(held.disposition).toBe("redistributed-out");
    const target = secondRows.find((r) => r.causeId === 3)!;
    expect(target.disbursableCents).toBe(16_000);
    expectInvariant(secondRows, second);
  });

  it("keeps a $0-pool quarter's carryforwards unchanged (§1.7)", () => {
    const input: AllocationInput = {
      poolCents: 0,
      snapshot: [{ causeId: 1, votes: 5, share: 1 }],
      carryforwardInByCause: { 1: 3_000 },
      payableCauseIds: [1],
      categoryByCause: CATS,
    };
    const rows = computeAllocations(input);
    expect(rows[0].allocatedCents).toBe(0);
    expect(rows[0].carryforwardOutCents).toBe(3_000);
    expectInvariant(rows, input);
  });

  it("refuses a positive pool with no frozen votes (fail closed)", () => {
    expect(() =>
      computeAllocations({
        poolCents: 1_000,
        snapshot: [],
        payableCauseIds: [],
        categoryByCause: CATS,
      }),
    ).toThrow(RangeError);
  });

  it("is deterministic and keeps the sum invariant across randomized cases", () => {
    // Deterministic LCG — the same cases on every run.
    let seed = 42;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    for (let iter = 0; iter < 200; iter++) {
      const n = 1 + rand(8);
      const ids = Array.from({ length: n }, (_, i) => i + 1);
      const snapshot = ids
        .map((id) => ({ causeId: id, votes: rand(50), share: 0 }))
        .filter((r) => r.votes > 0);
      const totalVotes = snapshot.reduce((a, r) => a + r.votes, 0);
      for (const r of snapshot) r.share = totalVotes ? r.votes / totalVotes : 0;
      const poolCents = totalVotes > 0 ? rand(200_000) : 0;
      const input: AllocationInput = {
        poolCents,
        snapshot,
        carryforwardInByCause: Object.fromEntries(
          ids.map((id) => [id, rand(8_000)]),
        ),
        consecutiveSubThresholdQuartersByCause: Object.fromEntries(
          ids.map((id) => [id, rand(4)]),
        ),
        payableCauseIds: ids.filter(() => rand(4) !== 0),
        unpayableHeldCauseIds: ids.filter(() => rand(6) === 0),
        categoryByCause: Object.fromEntries(
          ids.map((id) => [id, ["housing", "environment", "relief"][rand(3)]]),
        ),
      };
      const a = computeAllocations(input);
      const b = computeAllocations(input);
      expect(b).toEqual(a); // re-runnable with identical output (§2)
      expectInvariant(a, input);
      for (const row of a) {
        expect(row.allocatedCents).toBeGreaterThanOrEqual(0);
        expect(row.disbursableCents).toBeGreaterThanOrEqual(0);
        expect(row.carryforwardOutCents).toBeGreaterThanOrEqual(0);
        if (row.disposition === "disbursed" || row.disposition === "redistributed-in") {
          expect(row.disbursableCents).toBeGreaterThanOrEqual(MIN_DISBURSEMENT_CENTS);
        }
      }
    }
  });
});
