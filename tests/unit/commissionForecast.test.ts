/**
 * shared/commission/forecast.ts — projectGci.
 *
 * Behavioural pins for the pipeline GCI forecast. Load-bearing properties:
 *   - REFUSE when no commission config (no assumed rate, no invented deals);
 *   - only UNDER-CONTRACT, CLIENT-book deals are projected (own_investment and
 *     non-under-contract are excluded; missing price/agent is skipped, not
 *     back-filled);
 *   - NO close-rate probability (a deal under contract projects at full value);
 *   - agent net only when a split is configured (else null, splitApplied=false).
 */
import { describe, it, expect } from "vitest";
import { projectGci, type PipelineDealInput } from "../../shared/commission/forecast";
import type { CommissionConfig } from "../../shared/commission/tier-types";
import type { CommissionSplitConfig } from "../../shared/commission/split";

const RATE_10: CommissionConfig = {
  tiers: [{ minDeals: 0, ratePercent: 10, label: "Std" }],
  trackingPeriod: "annual",
};

const SPLIT_70: CommissionSplitConfig = {
  agentSplitBps: 7000,
  annualCapCents: null,
  transactionFeeCents: null,
  franchiseFeeBps: null,
};

function deal(partial: Partial<PipelineDealInput> & { dealId: number }): PipelineDealInput {
  return {
    teamMemberId: 1,
    salePriceCents: 10_000_000, // $100k → gross 1,000,000 @ 10%
    status: "accepted",
    dealBook: "client",
    ...partial,
  };
}

describe("projectGci — refusal (no commission config)", () => {
  it("refuses when no commission config exists", () => {
    const r = projectGci({
      pipelineDeals: [deal({ dealId: 1 })],
      config: { commissionConfig: null, splitConfig: null },
    });
    expect(r.applicable).toBe(false);
    expect(r.perAgent).toEqual([]);
    expect(r.totalProjectedGrossCommissionCents).toBe(0);
    expect(r.totalProjectedAgentNetCents).toBeNull();
    expect(r.refusedReason).toMatch(/commission/i);
  });
});

describe("projectGci — gross only (no split config)", () => {
  it("projects gross commission per agent, net stays null", () => {
    const r = projectGci({
      pipelineDeals: [
        deal({ dealId: 1, salePriceCents: 20_000_000 }), // gross 2,000,000
        deal({ dealId: 2, salePriceCents: 10_000_000, status: "in_escrow" }), // gross 1,000,000
      ],
      config: { commissionConfig: RATE_10, splitConfig: null },
    });
    expect(r.applicable).toBe(true);
    expect(r.splitApplied).toBe(false);
    expect(r.consideredDeals).toBe(2);
    expect(r.perAgent).toHaveLength(1);
    expect(r.perAgent[0].projectedGrossCommissionCents).toBe(3_000_000);
    expect(r.perAgent[0].projectedAgentNetCents).toBeNull();
    expect(r.totalProjectedGrossCommissionCents).toBe(3_000_000);
    expect(r.totalProjectedAgentNetCents).toBeNull();
  });
});

describe("projectGci — exclusions and skips (never invent)", () => {
  it("excludes own-book and non-under-contract deals; skips missing price/agent", () => {
    const r = projectGci({
      pipelineDeals: [
        deal({ dealId: 1 }), // counted
        deal({ dealId: 2, dealBook: "own_investment" }), // excluded (own book)
        deal({ dealId: 3, status: "negotiating" }), // excluded (not under contract)
        deal({ dealId: 4, salePriceCents: null }), // skipped (no price)
        deal({ dealId: 5, teamMemberId: null }), // skipped (no agent)
      ],
      config: { commissionConfig: RATE_10, splitConfig: null },
    });
    expect(r.consideredDeals).toBe(1);
    expect(r.skippedDeals).toBe(2); // deal 4 + deal 5
    expect(r.perAgent).toHaveLength(1);
    expect(r.perAgent[0].dealCount).toBe(1);
    expect(r.perAgent[0].projectedGrossCommissionCents).toBe(1_000_000);
  });

  it("legacy null book is treated as a client (commission) deal", () => {
    const r = projectGci({
      pipelineDeals: [deal({ dealId: 1, dealBook: null })],
      config: { commissionConfig: RATE_10, splitConfig: null },
    });
    expect(r.consideredDeals).toBe(1);
    expect(r.perAgent[0].projectedGrossCommissionCents).toBe(1_000_000);
  });
});

describe("projectGci — net of split", () => {
  it("projects agent net when a split is configured", () => {
    const r = projectGci({
      pipelineDeals: [deal({ dealId: 1, salePriceCents: 20_000_000 })], // gross 2,000,000
      config: { commissionConfig: RATE_10, splitConfig: SPLIT_70 },
    });
    expect(r.splitApplied).toBe(true);
    expect(r.perAgent[0].projectedGrossCommissionCents).toBe(2_000_000);
    expect(r.perAgent[0].projectedAgentNetCents).toBe(1_400_000); // 70%
    expect(r.totalProjectedAgentNetCents).toBe(1_400_000);
  });

  it("depletes the annual company-dollar cap across a multi-deal pipeline", () => {
    const capped: CommissionSplitConfig = { ...SPLIT_70, annualCapCents: 500_000 };
    const r = projectGci({
      pipelineDeals: [
        deal({ dealId: 1 }), // gross 1,000,000 → company dollar 300,000
        deal({ dealId: 2 }), // gross 1,000,000 → company dollar would be 300,000
      ],
      config: {
        commissionConfig: RATE_10,
        splitConfig: capped,
        ytdCompanyDollarByMember: { 1: 0 },
      },
    });
    // Deal 1: broker 300,000 → agent net 700,000. Deal 2: only 200,000 cap room
    // left → broker 200,000 → agent net 800,000.
    expect(r.perAgent[0].projectedAgentNetCents).toBe(1_500_000);
    expect(r.totalProjectedAgentNetCents).toBe(1_500_000);
  });
});

describe("projectGci — tier resolution from real YTD closed counts", () => {
  it("resolves a higher tier from the agent's real YTD closed count", () => {
    const tiered: CommissionConfig = {
      tiers: [
        { minDeals: 0, ratePercent: 3, label: "Std" },
        { minDeals: 5, ratePercent: 6, label: "Gold" },
      ],
      trackingPeriod: "annual",
    };
    const r = projectGci({
      pipelineDeals: [deal({ dealId: 1, salePriceCents: 10_000_000 })],
      config: { commissionConfig: tiered, splitConfig: null, ytdClosedByMember: { 1: 5 } },
    });
    // 6% of $100k = 600,000
    expect(r.perAgent[0].projectedGrossCommissionCents).toBe(600_000);
  });
});
