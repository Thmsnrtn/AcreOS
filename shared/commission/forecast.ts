// ============================================================================
// SHARED/COMMISSION/FORECAST.TS — pipeline GCI forecast, computed honestly.
// ----------------------------------------------------------------------------
// Pure and browser-safe: no DB, no `process`. This projects the gross commission
// income (GCI) an agent's UNDER-CONTRACT pipeline will produce at close, and —
// when a split is configured — the agent's net of that. The honesty rules live
// once here:
//
//   1. The forecast is over deals that ALREADY EXIST and are under contract
//      (accepted / in_escrow), never invented ones, and it applies NO close-rate
//      probability. A deal under contract is projected at its full commission;
//      a speculative "40% of these might close" weighting would be a fabricated
//      number, so there is none. Deals not under contract are simply excluded.
//   2. Only CLIENT-book deals earn a brokerage commission. An own_investment
//      deal is the agent's own P&L, never a commission, and is excluded.
//   3. It REFUSES when there is no commission configuration — with no configured
//      rate there is no honest projected commission, so the whole forecast is
//      applicable=false rather than a zero that looks computed. A missing SPLIT
//      config is a softer, disclosed partial: gross is projected, but agent net
//      is null (splitApplied=false) — never an assumed split.
//   4. A pipeline deal with no attributable agent, or no recorded sale price, is
//      SKIPPED and counted (skippedDeals), never back-filled with a guessed
//      figure.
// ============================================================================

import { resolveCommissionTier, type CommissionConfig } from "./tier-types";
import {
  computeCommissionSplit,
  type CommissionSplitConfig,
} from "./split";

/** The statuses that count as "under contract" for a forward GCI projection. */
export const UNDER_CONTRACT_STATUSES = ["accepted", "in_escrow"] as const;

/** One pipeline deal, reduced to the facts the forecast needs. */
export interface PipelineDealInput {
  dealId: number;
  /** The deal's assigned agent (teamMemberId), or null when unattributed. */
  teamMemberId: number | null;
  /** The recorded sale/accepted price in cents, or null when not recorded. */
  salePriceCents: number | null;
  /** The deal's lifecycle status. */
  status: string;
  /** 'client' | 'own_investment' | null. Only 'client' (and legacy null) deals earn a commission. */
  dealBook: string | null;
}

export interface GciForecastConfig {
  /** The operator's tiered commission config, or null → the forecast refuses. */
  commissionConfig: CommissionConfig | null;
  /** The operator's split config, or null → gross is projected but net stays null. */
  splitConfig: CommissionSplitConfig | null;
  /** Real closed-deal counts per agent this period, for honest tier resolution. Missing → 0. */
  ytdClosedByMember?: Record<number, number>;
  /** Real company dollar already collected per agent this year, so the cap projection is honest. Missing → 0. */
  ytdCompanyDollarByMember?: Record<number, number>;
}

export interface AgentGciForecast {
  teamMemberId: number;
  /** Number of under-contract client deals attributed to this agent. */
  dealCount: number;
  /** Projected gross commission across those deals, in cents. */
  projectedGrossCommissionCents: number;
  /** Projected agent net of split, in cents — null when no split config. */
  projectedAgentNetCents: number | null;
}

export interface GciForecastResult {
  applicable: boolean;
  /** True only when a split config was applied to project agent net. */
  splitApplied: boolean;
  perAgent: AgentGciForecast[];
  totalProjectedGrossCommissionCents: number;
  /** Sum of agent net across agents — null when no split config (cannot say honestly). */
  totalProjectedAgentNetCents: number | null;
  /** Under-contract client deals skipped for a missing agent or missing price. */
  skippedDeals: number;
  /** Under-contract client deals that WERE projected. */
  consideredDeals: number;
  /** Non-null when the forecast refused (no commission config). */
  refusedReason: string | null;
}

/**
 * Project pipeline GCI (and, when a split is configured, agent net) per agent.
 *
 * REFUSES (applicable=false, empty per-agent, gross 0, net null) when there is
 * no commission configuration — no configured rate means no honest projection.
 */
export function projectGci(args: {
  pipelineDeals: PipelineDealInput[];
  config: GciForecastConfig;
}): GciForecastResult {
  const { pipelineDeals, config } = args;

  if (config.commissionConfig == null) {
    return {
      applicable: false,
      splitApplied: false,
      perAgent: [],
      totalProjectedGrossCommissionCents: 0,
      totalProjectedAgentNetCents: null,
      skippedDeals: 0,
      consideredDeals: 0,
      refusedReason:
        "No commission configuration is saved. A GCI forecast needs your commission rate to project — " +
        "refusing to assume a rate.",
    };
  }

  const commissionConfig = config.commissionConfig;
  const splitConfig = config.splitConfig;
  const underContract = new Set<string>(UNDER_CONTRACT_STATUSES);

  // Per-agent running accumulators. The split cap is depleted deal-by-deal from
  // each agent's real YTD company dollar so a multi-deal pipeline caps honestly.
  const perAgentMap = new Map<
    number,
    {
      dealCount: number;
      gross: number;
      net: number | null;
      runningCompanyDollar: number;
    }
  >();

  let skippedDeals = 0;
  let consideredDeals = 0;
  let anySplitApplied = false;

  // Deterministic order so the cap depletes in a stable sequence.
  const ordered = [...pipelineDeals].sort((a, b) => a.dealId - b.dealId);

  for (const deal of ordered) {
    if (!underContract.has(deal.status)) continue;
    // Own-book deals never earn a brokerage commission. Legacy null book is
    // treated as client (a commission deal) since that is what it always was.
    if (deal.dealBook === "own_investment") continue;
    if (deal.teamMemberId == null) {
      skippedDeals++;
      continue;
    }
    if (deal.salePriceCents == null || deal.salePriceCents <= 0) {
      skippedDeals++;
      continue;
    }

    const member = deal.teamMemberId;
    const ytdClosed = config.ytdClosedByMember?.[member] ?? 0;
    const tier = resolveCommissionTier(commissionConfig, ytdClosed);
    const projectedGrossCents = Math.round(deal.salePriceCents * (tier.ratePercent / 100));

    let entry = perAgentMap.get(member);
    if (!entry) {
      entry = {
        dealCount: 0,
        gross: 0,
        net: splitConfig ? 0 : null,
        runningCompanyDollar: config.ytdCompanyDollarByMember?.[member] ?? 0,
      };
      perAgentMap.set(member, entry);
    }

    entry.dealCount++;
    entry.gross += projectedGrossCents;
    consideredDeals++;

    if (splitConfig) {
      const split = computeCommissionSplit({
        grossCommissionCents: projectedGrossCents,
        config: splitConfig,
        agentYtdCompanyDollarCents: entry.runningCompanyDollar,
      });
      if (split.applicable && split.agentNetCents != null) {
        anySplitApplied = true;
        entry.net = (entry.net ?? 0) + split.agentNetCents;
        entry.runningCompanyDollar += split.brokerCents ?? 0;
      }
    }
  }

  const perAgent: AgentGciForecast[] = [...perAgentMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([teamMemberId, e]) => ({
      teamMemberId,
      dealCount: e.dealCount,
      projectedGrossCommissionCents: e.gross,
      projectedAgentNetCents: splitConfig ? e.net ?? 0 : null,
    }));

  const totalGross = perAgent.reduce((s, a) => s + a.projectedGrossCommissionCents, 0);
  const totalNet = splitConfig
    ? perAgent.reduce((s, a) => s + (a.projectedAgentNetCents ?? 0), 0)
    : null;

  return {
    applicable: true,
    splitApplied: anySplitApplied,
    perAgent,
    totalProjectedGrossCommissionCents: totalGross,
    totalProjectedAgentNetCents: totalNet,
    skippedDeals,
    consideredDeals,
    refusedReason: null,
  };
}
