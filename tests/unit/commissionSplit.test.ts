/**
 * shared/commission/split.ts — computeCommissionSplit.
 *
 * Behavioural pins for the brokerage split engine. The load-bearing property is
 * REFUSE-NOT-FABRICATE: with no split config (or no agent share) the engine
 * returns applicable=false + a refusedReason and agentNetCents null — it never
 * assumes a split, a cap, or a fee.
 */
import { describe, it, expect } from "vitest";
import {
  computeCommissionSplit,
  type CommissionSplitConfig,
} from "../../shared/commission/split";

const CONFIG: CommissionSplitConfig = {
  agentSplitBps: 7000, // 70% agent / 30% company dollar
  annualCapCents: null,
  transactionFeeCents: null,
  franchiseFeeBps: null,
};

describe("computeCommissionSplit — refusal (never fabricate a split)", () => {
  it("refuses when there is NO split config", () => {
    const r = computeCommissionSplit({ grossCommissionCents: 100_000, config: null });
    expect(r.applicable).toBe(false);
    expect(r.agentNetCents).toBeNull();
    expect(r.brokerCents).toBeNull();
    expect(r.refusedReason).toMatch(/split/i);
    // The gross is echoed even on refusal (for the frozen record).
    expect(r.grossCommissionCents).toBe(100_000);
  });

  it("refuses when the agent share is not configured", () => {
    const r = computeCommissionSplit({
      grossCommissionCents: 100_000,
      config: { ...CONFIG, agentSplitBps: null },
    });
    expect(r.applicable).toBe(false);
    expect(r.agentNetCents).toBeNull();
    expect(r.refusedReason).toMatch(/agent split/i);
  });

  it("refuses an out-of-range agent split rather than compute from an invalid share", () => {
    const r = computeCommissionSplit({
      grossCommissionCents: 100_000,
      config: { ...CONFIG, agentSplitBps: 15_000 },
    });
    expect(r.applicable).toBe(false);
    expect(r.agentNetCents).toBeNull();
    expect(r.refusedReason).toMatch(/range/i);
  });

  it("refuses when there is no gross commission to split", () => {
    const r = computeCommissionSplit({ grossCommissionCents: null, config: CONFIG });
    expect(r.applicable).toBe(false);
    expect(r.agentNetCents).toBeNull();
    const neg = computeCommissionSplit({ grossCommissionCents: -1, config: CONFIG });
    expect(neg.applicable).toBe(false);
  });
});

describe("computeCommissionSplit — the basic split", () => {
  it("splits gross into agent share + company dollar (no cap, no fees)", () => {
    const r = computeCommissionSplit({ grossCommissionCents: 100_000, config: CONFIG });
    expect(r.applicable).toBe(true);
    expect(r.franchiseFeeCents).toBe(0);
    expect(r.adjustedGrossCents).toBe(100_000);
    expect(r.companyDollarBeforeCapCents).toBe(30_000);
    expect(r.brokerCents).toBe(30_000);
    expect(r.agentCents).toBe(70_000);
    expect(r.transactionFeeCents).toBe(0);
    expect(r.agentNetCents).toBe(70_000);
    expect(r.cappedThisDeal).toBe(false);
    expect(r.capRemainingBeforeCents).toBeNull();
    // Invariant: agent + broker == adjusted gross.
    expect((r.agentCents ?? 0) + (r.brokerCents ?? 0)).toBe(r.adjustedGrossCents);
  });
});

describe("computeCommissionSplit — franchise fee off the top", () => {
  it("takes the franchise fee off gross before the house split", () => {
    const r = computeCommissionSplit({
      grossCommissionCents: 100_000,
      config: { ...CONFIG, franchiseFeeBps: 600 }, // 6%
    });
    expect(r.franchiseFeeCents).toBe(6_000);
    expect(r.adjustedGrossCents).toBe(94_000);
    expect(r.companyDollarBeforeCapCents).toBe(28_200); // 30% of 94,000
    expect(r.brokerCents).toBe(28_200);
    expect(r.agentCents).toBe(65_800);
    expect(r.agentNetCents).toBe(65_800);
    // Invariant: franchise + adjusted == gross.
    expect((r.franchiseFeeCents ?? 0) + (r.adjustedGrossCents ?? 0)).toBe(100_000);
  });
});

describe("computeCommissionSplit — the annual company-dollar cap", () => {
  it("limits the broker's take to the remaining cap room this deal", () => {
    const r = computeCommissionSplit({
      grossCommissionCents: 100_000,
      config: { ...CONFIG, annualCapCents: 20_000 },
      agentYtdCompanyDollarCents: 18_000, // only 2,000 of cap room left
    });
    expect(r.capRemainingBeforeCents).toBe(2_000);
    expect(r.brokerCents).toBe(2_000);
    expect(r.cappedThisDeal).toBe(true);
    expect(r.agentCents).toBe(98_000); // agent keeps the cap-freed dollars
    expect(r.agentNetCents).toBe(98_000);
  });

  it("once the cap is met, the agent keeps 100% of gross less flat fees", () => {
    const r = computeCommissionSplit({
      grossCommissionCents: 100_000,
      config: { ...CONFIG, annualCapCents: 20_000, transactionFeeCents: 15_000 },
      agentYtdCompanyDollarCents: 25_000, // already over cap
    });
    expect(r.capRemainingBeforeCents).toBe(0);
    expect(r.brokerCents).toBe(0);
    expect(r.cappedThisDeal).toBe(true);
    expect(r.agentCents).toBe(100_000);
    expect(r.transactionFeeCents).toBe(15_000);
    expect(r.agentNetCents).toBe(85_000); // 100% less the flat transaction fee
  });

  it("does not cap when under the cap (defaults ytd company dollar to 0)", () => {
    const r = computeCommissionSplit({
      grossCommissionCents: 100_000,
      config: { ...CONFIG, annualCapCents: 50_000 },
    });
    expect(r.brokerCents).toBe(30_000);
    expect(r.cappedThisDeal).toBe(false);
    expect(r.agentNetCents).toBe(70_000);
  });
});

describe("computeCommissionSplit — the flat transaction fee", () => {
  it("subtracts the per-transaction fee from the agent's net", () => {
    const r = computeCommissionSplit({
      grossCommissionCents: 50_000,
      config: { agentSplitBps: 8000, annualCapCents: null, transactionFeeCents: 25_000, franchiseFeeBps: null },
    });
    expect(r.agentCents).toBe(40_000); // 80% of 50,000
    expect(r.brokerCents).toBe(10_000);
    expect(r.transactionFeeCents).toBe(25_000);
    expect(r.agentNetCents).toBe(15_000);
  });
});
