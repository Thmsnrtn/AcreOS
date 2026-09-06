/**
 * Team Commission Tracking Service (T54)
 *
 * Tracks commissions owed per closed deal, supports tiered/graduated
 * commission structures by volume, and generates per-agent statements.
 *
 * Storage: organizationIntegrations with provider='commission_config' for
 * tier configs (JSON blob). Commission records stored in trustLedger as
 * entryType='commission_owed' / 'commission_paid'.
 */

import { db } from "../db";
import {
  organizationIntegrations,
  teamMembers,
  deals,
  trustLedger,
} from "@shared/schema";
import { and, desc, eq, gte, inArray, lte, notInArray, sql } from "drizzle-orm";
import { startOfYear, endOfYear, format } from "date-fns";
import { logger } from "../utils/logger";
// Tiered-commission types + tier resolution live in the pure, browser-safe
// shared module now (so the forecast engine can use them without server code);
// re-exported here so existing consumers keep importing from commissionService.
import {
  type CommissionTier,
  type CommissionConfig,
  resolveCommissionTier,
} from "@shared/commission/tier-types";
import {
  computeCommissionSplit,
  type CommissionSplitConfig,
  type CommissionSplitResult,
} from "@shared/commission/split";
import { projectGci, type GciForecastResult, type PipelineDealInput } from "@shared/commission/forecast";

import { ADMINISTRATIVE_DEAL_STATUSES } from "@shared/lifecycle/pipeline-status";
export {
  type CommissionTier,
  type CommissionConfig,
  resolveCommissionTier,
  type CommissionSplitConfig,
  type CommissionSplitResult,
};

export interface CommissionRecord {
  id: string;
  organizationId: number;
  teamMemberId: number;
  dealId: number;
  dealClosedAt: Date;
  salePrice: number;        // cents
  commissionRatePercent: number;
  commissionAmountCents: number;
  flatBonusCents: number;
  totalOwedCents: number;
  paidCents: number;
  status: "owed" | "partial" | "paid";
  createdAt: Date;
  updatedAt: Date;
  // Net-of-split economics — present ONLY when the org has saved a split config
  // (hasSplitConfig) at record time. Absent on records booked before the split
  // config existed, so every field is optional and readers must treat absence
  // as "no split applied", never as zero.
  splitApplied?: boolean;
  /** The agent's net after split, cap and flat fees, in cents. */
  splitAgentNetCents?: number;
  /** Company dollar the broker retained on this deal (after the annual cap), in cents. */
  splitBrokerCents?: number;
  /** Franchise/royalty fee taken off the top, in cents. */
  splitFranchiseFeeCents?: number;
  /** Flat per-transaction fee, in cents. */
  splitTransactionFeeCents?: number;
  /** Whether the annual company-dollar cap reduced the broker's take on this deal. */
  splitCappedThisDeal?: boolean;
}

export interface AgentCommissionSummary {
  teamMemberId: number;
  displayName: string;
  email: string;
  ytdDeals: number;
  ytdSaleVolumeCents: number;
  ytdOwedCents: number;
  ytdPaidCents: number;
  ytdOutstandingCents: number;
  currentTier: CommissionTier | null;
  records: CommissionRecord[];
  // Net-of-split YTD roll-up. Derived from the split fields on records; when no
  // record carried a split (no split config was ever saved) ytdSplitApplied is
  // false and ytdAgentNetCents stays 0 — an honest "no split to report", never
  // a fabricated net.
  ytdAgentNetCents: number;
  ytdSplitApplied: boolean;
}

// ---------------------------------------------------------------------------
// Config storage (JSON blob in organizationIntegrations)
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: CommissionConfig = {
  tiers: [
    { minDeals: 0,  ratePercent: 3.0, label: "Standard" },
    { minDeals: 5,  ratePercent: 4.0, label: "Silver"   },
    { minDeals: 10, ratePercent: 5.0, label: "Gold"     },
    { minDeals: 20, ratePercent: 6.0, label: "Platinum" },
  ],
  trackingPeriod: "annual",
};

export async function getCommissionConfig(
  organizationId: number
): Promise<CommissionConfig> {
  const [row] = await db
    .select()
    .from(organizationIntegrations)
    .where(
      and(
        eq(organizationIntegrations.organizationId, organizationId),
        eq(organizationIntegrations.provider, "commission_config")
      )
    )
    .limit(1);

  if (!row?.credentials) return DEFAULT_CONFIG;
  const creds = row.credentials as { encrypted?: string; config?: CommissionConfig };
  // Stored as a JSON blob under `encrypted` (the credentials column is a typed
  // secrets jsonb repurposed here); fall back to a legacy top-level `config`.
  if (creds.encrypted) {
    try {
      const parsed = JSON.parse(creds.encrypted) as { config?: CommissionConfig };
      if (parsed.config) return parsed.config;
    } catch { /* fall through */ }
  }
  return creds.config ?? DEFAULT_CONFIG;
}

/**
 * Whether the org has EXPLICITLY configured commission tiers (i.e. an
 * organizationIntegrations row with provider='commission_config' exists).
 *
 * `getCommissionConfig` intentionally falls back to DEFAULT_CONFIG so read
 * surfaces always render, but the deal-close auto-record path must NOT act on
 * that default — recording a commission when the org never opted in would
 * fabricate a number. This is the honest gate: only true once a real config
 * has been saved.
 */
export async function hasCommissionConfig(
  organizationId: number
): Promise<boolean> {
  const [row] = await db
    .select({ id: organizationIntegrations.id })
    .from(organizationIntegrations)
    .where(
      and(
        eq(organizationIntegrations.organizationId, organizationId),
        eq(organizationIntegrations.provider, "commission_config")
      )
    )
    .limit(1);
  return !!row;
}

export async function saveCommissionConfig(
  organizationId: number,
  config: CommissionConfig
): Promise<void> {
  const [existing] = await db
    .select()
    .from(organizationIntegrations)
    .where(
      and(
        eq(organizationIntegrations.organizationId, organizationId),
        eq(organizationIntegrations.provider, "commission_config")
      )
    )
    .limit(1);

  // The credentials column is a typed secrets jsonb; store the commission
  // config as a JSON blob under `encrypted`.
  const credentials = { encrypted: JSON.stringify({ config }) };

  if (existing) {
    await db
      .update(organizationIntegrations)
      .set({ credentials, updatedAt: new Date() })
      .where(eq(organizationIntegrations.id, existing.id));
  } else {
    await db.insert(organizationIntegrations).values({
      organizationId,
      provider: "commission_config",
      isEnabled: true,
      credentials,
    });
  }
}

// ---------------------------------------------------------------------------
// Split config storage (JSON blob in organizationIntegrations)
// ---------------------------------------------------------------------------
//
// The operator's OWN saved split arrangement. Same organizationIntegrations
// blob pattern as commission_config, under a distinct provider key. There is NO
// default: getSplitConfig returns null when unconfigured so the pure engine can
// REFUSE — a split is never assumed. hasSplitConfig is the honest gate that the
// deal-close net-of-split path checks before applying any split.

/**
 * Read the org's saved split config, or null when none is saved. Deliberately
 * has NO default fallback (unlike getCommissionConfig): a split is a private,
 * negotiated term, and returning a made-up default would let a fabricated net
 * ship. Null ⇒ the split engine refuses.
 */
export async function getSplitConfig(
  organizationId: number
): Promise<CommissionSplitConfig | null> {
  const [row] = await db
    .select()
    .from(organizationIntegrations)
    .where(
      and(
        eq(organizationIntegrations.organizationId, organizationId),
        eq(organizationIntegrations.provider, "commission_split_config")
      )
    )
    .limit(1);

  if (!row?.credentials) return null;
  const creds = row.credentials as { encrypted?: string; config?: CommissionSplitConfig };
  if (creds.encrypted) {
    try {
      const parsed = JSON.parse(creds.encrypted) as { config?: CommissionSplitConfig };
      if (parsed.config) return parsed.config;
    } catch { /* fall through */ }
  }
  return creds.config ?? null;
}

/**
 * Whether the org has EXPLICITLY saved a split config. The net-of-split paths
 * (deal-close record, the forecast) must NOT act without this — applying a
 * split the operator never configured would fabricate an agent net.
 */
export async function hasSplitConfig(organizationId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: organizationIntegrations.id })
    .from(organizationIntegrations)
    .where(
      and(
        eq(organizationIntegrations.organizationId, organizationId),
        eq(organizationIntegrations.provider, "commission_split_config")
      )
    )
    .limit(1);
  return !!row;
}

export async function saveSplitConfig(
  organizationId: number,
  config: CommissionSplitConfig
): Promise<void> {
  const [existing] = await db
    .select()
    .from(organizationIntegrations)
    .where(
      and(
        eq(organizationIntegrations.organizationId, organizationId),
        eq(organizationIntegrations.provider, "commission_split_config")
      )
    )
    .limit(1);

  const credentials = { encrypted: JSON.stringify({ config }) };

  if (existing) {
    await db
      .update(organizationIntegrations)
      .set({ credentials, updatedAt: new Date() })
      .where(eq(organizationIntegrations.id, existing.id));
  } else {
    await db.insert(organizationIntegrations).values({
      organizationId,
      provider: "commission_split_config",
      isEnabled: true,
      credentials,
    });
  }
}

// ---------------------------------------------------------------------------
// Commission records storage (also JSON blob — no dedicated table)
// ---------------------------------------------------------------------------

async function getCommissionRecordsStore(
  organizationId: number
): Promise<CommissionRecord[]> {
  const [row] = await db
    .select()
    .from(organizationIntegrations)
    .where(
      and(
        eq(organizationIntegrations.organizationId, organizationId),
        eq(organizationIntegrations.provider, "commission_records")
      )
    )
    .limit(1);

  if (!row?.credentials) return [];
  const creds = row.credentials as { encrypted?: string; records?: CommissionRecord[] };
  let rawRecords: CommissionRecord[] = Array.isArray(creds.records) ? creds.records : [];
  if (creds.encrypted) {
    try {
      const parsed = JSON.parse(creds.encrypted) as { records?: CommissionRecord[] };
      if (Array.isArray(parsed.records)) rawRecords = parsed.records;
    } catch { /* fall through to legacy */ }
  }
  const records: CommissionRecord[] = rawRecords;
  // Rehydrate dates
  return records.map((r) => ({
    ...r,
    dealClosedAt: new Date(r.dealClosedAt),
    createdAt: new Date(r.createdAt),
    updatedAt: new Date(r.updatedAt),
  }));
}

async function saveCommissionRecordsStore(
  organizationId: number,
  records: CommissionRecord[]
): Promise<void> {
  const [existing] = await db
    .select()
    .from(organizationIntegrations)
    .where(
      and(
        eq(organizationIntegrations.organizationId, organizationId),
        eq(organizationIntegrations.provider, "commission_records")
      )
    )
    .limit(1);

  const credentials = { encrypted: JSON.stringify({ records }) };

  if (existing) {
    await db
      .update(organizationIntegrations)
      .set({ credentials, updatedAt: new Date() })
      .where(eq(organizationIntegrations.id, existing.id));
  } else {
    await db.insert(organizationIntegrations).values({
      organizationId,
      provider: "commission_records",
      isEnabled: true,
      credentials,
    });
  }
}

// ---------------------------------------------------------------------------
// Core CRUD
// ---------------------------------------------------------------------------

/**
 * Record a new commission when a deal closes.
 * Call this from the deal "closed" status transition handler.
 */
export async function recordDealCommission(
  organizationId: number,
  teamMemberId: number,
  dealId: number,
  salePriceCents: number,
  closedAt: Date = new Date()
): Promise<CommissionRecord> {
  const config = await getCommissionConfig(organizationId);
  const records = await getCommissionRecordsStore(organizationId);

  // Count deals closed by this agent in the current tracking period
  const periodStart = getPeriodStart(config.trackingPeriod, closedAt);
  const periodEnd = closedAt;
  const priorDealsInPeriod = records.filter(
    (r) =>
      r.teamMemberId === teamMemberId &&
      r.dealClosedAt >= periodStart &&
      r.dealClosedAt <= periodEnd &&
      r.dealId !== dealId
  ).length;

  const tier = resolveCommissionTier(config, priorDealsInPeriod);
  const commissionAmountCents = Math.round(
    (salePriceCents * tier.ratePercent) / 100
  );
  const flatBonusCents = config.baseFlatAmount ?? 0;
  const totalOwedCents = commissionAmountCents + flatBonusCents;

  // Net-of-split — ONLY when the org has explicitly saved a split config.
  // hasSplitConfig is the honest gate (same shape as hasCommissionConfig): with
  // no saved split we leave the record's split fields absent (unchanged
  // behaviour), because applying a split the operator never configured would
  // fabricate an agent net. The split is computed on the GROSS COMMISSION (the %
  // of sale price), not on totalOwedCents — the flat bonus is an internal
  // broker→agent bonus, not GCI to be split — so nothing is double-counted.
  let splitFields: Partial<CommissionRecord> = {};
  const splitConfig = (await hasSplitConfig(organizationId))
    ? await getSplitConfig(organizationId)
    : null;
  if (splitConfig) {
    // Company dollar the broker has already retained THIS YEAR for this agent —
    // the cap runs off it. Summed from prior records' persisted splitBrokerCents.
    const closedYear = closedAt.getFullYear();
    const agentYtdCompanyDollarCents = records
      .filter(
        (r) =>
          r.teamMemberId === teamMemberId &&
          r.dealId !== dealId &&
          r.dealClosedAt.getFullYear() === closedYear &&
          typeof r.splitBrokerCents === "number"
      )
      .reduce((sum, r) => sum + (r.splitBrokerCents ?? 0), 0);

    const split = computeCommissionSplit({
      grossCommissionCents: commissionAmountCents,
      config: splitConfig,
      agentYtdCompanyDollarCents,
    });
    if (split.applicable && split.agentNetCents != null) {
      splitFields = {
        splitApplied: true,
        splitAgentNetCents: split.agentNetCents,
        splitBrokerCents: split.brokerCents ?? 0,
        splitFranchiseFeeCents: split.franchiseFeeCents ?? 0,
        splitTransactionFeeCents: split.transactionFeeCents ?? 0,
        splitCappedThisDeal: split.cappedThisDeal,
      };
    }
  }

  const record: CommissionRecord = {
    id: `comm_${dealId}_${teamMemberId}_${Date.now()}`,
    organizationId,
    teamMemberId,
    dealId,
    dealClosedAt: closedAt,
    salePrice: salePriceCents,
    commissionRatePercent: tier.ratePercent,
    commissionAmountCents,
    flatBonusCents,
    totalOwedCents,
    paidCents: 0,
    status: "owed",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...splitFields,
  };

  // Remove any existing record for this deal (idempotent)
  const filtered = records.filter((r) => r.dealId !== dealId);
  filtered.push(record);
  await saveCommissionRecordsStore(organizationId, filtered);

  logger.info(`[Commission] Recorded $${(totalOwedCents / 100).toFixed(2)} commission for team member ${teamMemberId} on deal ${dealId} (${tier.label} tier @ ${tier.ratePercent}%)`);

  return record;
}

/**
 * Mark a commission payment (partial or full).
 */
export async function recordCommissionPayment(
  organizationId: number,
  commissionId: string,
  paidCents: number
): Promise<CommissionRecord> {
  const records = await getCommissionRecordsStore(organizationId);
  const idx = records.findIndex((r) => r.id === commissionId);
  if (idx < 0) throw new Error(`Commission record not found: ${commissionId}`);

  const rec = records[idx];
  const newPaid = rec.paidCents + paidCents;
  records[idx] = {
    ...rec,
    paidCents: newPaid,
    status:
      newPaid >= rec.totalOwedCents
        ? "paid"
        : newPaid > 0
        ? "partial"
        : "owed",
    updatedAt: new Date(),
  };

  await saveCommissionRecordsStore(organizationId, records);
  return records[idx];
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function getCommissionRecords(
  organizationId: number,
  options: {
    teamMemberId?: number;
    dealId?: number;
    status?: "owed" | "partial" | "paid";
    fromDate?: Date;
    toDate?: Date;
  } = {}
): Promise<CommissionRecord[]> {
  let records = await getCommissionRecordsStore(organizationId);

  if (options.teamMemberId !== undefined) {
    records = records.filter((r) => r.teamMemberId === options.teamMemberId);
  }
  if (options.dealId !== undefined) {
    records = records.filter((r) => r.dealId === options.dealId);
  }
  if (options.status) {
    records = records.filter((r) => r.status === options.status);
  }
  if (options.fromDate) {
    records = records.filter((r) => r.dealClosedAt >= options.fromDate!);
  }
  if (options.toDate) {
    records = records.filter((r) => r.dealClosedAt <= options.toDate!);
  }

  return records.sort(
    (a, b) => b.dealClosedAt.getTime() - a.dealClosedAt.getTime()
  );
}

/**
 * Get YTD commission summary per active team member.
 */
export async function getAgentCommissionSummaries(
  organizationId: number,
  year: number = new Date().getFullYear()
): Promise<AgentCommissionSummary[]> {
  const fromDate = startOfYear(new Date(year, 0, 1));
  const toDate = endOfYear(new Date(year, 0, 1));

  const [members, records, config] = await Promise.all([
    db
      .select()
      .from(teamMembers)
      .where(
        and(
          eq(teamMembers.organizationId, organizationId),
          eq(teamMembers.isActive, true)
        )
      ),
    getCommissionRecords(organizationId, { fromDate, toDate }),
    getCommissionConfig(organizationId),
  ]);

  return members.map((m) => {
    const agentRecords = records.filter((r) => r.teamMemberId === m.id);
    const ytdDeals = agentRecords.length;
    const ytdSaleVolumeCents = agentRecords.reduce(
      (sum, r) => sum + r.salePrice,
      0
    );
    const ytdOwedCents = agentRecords.reduce(
      (sum, r) => sum + r.totalOwedCents,
      0
    );
    const ytdPaidCents = agentRecords.reduce(
      (sum, r) => sum + r.paidCents,
      0
    );
    const currentTier = resolveCommissionTier(config, ytdDeals);
    // Net-of-split YTD — derived from the persisted split fields. When no record
    // carried a split (no split config was ever saved) this stays 0 and
    // ytdSplitApplied is false: an honest "no split to report", never invented.
    const splitRecords = agentRecords.filter((r) => r.splitApplied);
    const ytdAgentNetCents = splitRecords.reduce(
      (sum, r) => sum + (r.splitAgentNetCents ?? 0),
      0
    );

    return {
      teamMemberId: m.id,
      displayName: m.displayName || m.email || `Member ${m.id}`,
      email: m.email || "",
      ytdDeals,
      ytdSaleVolumeCents,
      ytdOwedCents,
      ytdPaidCents,
      ytdOutstandingCents: ytdOwedCents - ytdPaidCents,
      currentTier,
      records: agentRecords,
      ytdAgentNetCents,
      ytdSplitApplied: splitRecords.length > 0,
    };
  });
}

// ---------------------------------------------------------------------------
// Statement generation (plain-text PDF-ready format)
// ---------------------------------------------------------------------------

export function generateCommissionStatement(
  summary: AgentCommissionSummary,
  orgName: string,
  year: number
): string {
  const lines: string[] = [];
  const fmt = (cents: number) => `$${(cents / 100).toFixed(2)}`;

  lines.push(`COMMISSION STATEMENT`);
  lines.push(`Organization: ${orgName}`);
  lines.push(`Agent: ${summary.displayName} (${summary.email})`);
  lines.push(`Year: ${year}`);
  lines.push(`Generated: ${format(new Date(), "MMMM d, yyyy")}`);
  lines.push(``);
  lines.push(`─`.repeat(60));
  lines.push(`YEAR-TO-DATE SUMMARY`);
  lines.push(`─`.repeat(60));
  lines.push(`Deals Closed:         ${summary.ytdDeals}`);
  lines.push(`Total Sale Volume:    ${fmt(summary.ytdSaleVolumeCents)}`);
  lines.push(
    `Current Tier:         ${summary.currentTier?.label ?? "N/A"} @ ${summary.currentTier?.ratePercent ?? 0}%`
  );
  lines.push(`Total Owed:           ${fmt(summary.ytdOwedCents)}`);
  lines.push(`Total Paid:           ${fmt(summary.ytdPaidCents)}`);
  lines.push(`Outstanding:          ${fmt(summary.ytdOutstandingCents)}`);
  // Net-of-split line — only when a split was actually applied to these records.
  // Absent otherwise (no fabricated net when the org never configured a split).
  if (summary.ytdSplitApplied) {
    lines.push(`Agent Net (of split): ${fmt(summary.ytdAgentNetCents)}`);
  }
  lines.push(``);
  lines.push(`─`.repeat(60));
  lines.push(`DEAL DETAIL`);
  lines.push(`─`.repeat(60));

  if (summary.records.length === 0) {
    lines.push(`No commission records for ${year}.`);
  } else {
    for (const r of summary.records) {
      lines.push(``);
      lines.push(`Deal #${r.dealId} — Closed ${format(r.dealClosedAt, "MMM d, yyyy")}`);
      lines.push(`  Sale Price:      ${fmt(r.salePrice)}`);
      lines.push(`  Rate:            ${r.commissionRatePercent}%`);
      lines.push(`  Commission:      ${fmt(r.commissionAmountCents)}`);
      if (r.flatBonusCents > 0) {
        lines.push(`  Flat Bonus:      ${fmt(r.flatBonusCents)}`);
      }
      lines.push(`  Total Owed:      ${fmt(r.totalOwedCents)}`);
      lines.push(`  Paid:            ${fmt(r.paidCents)}`);
      lines.push(`  Status:          ${r.status.toUpperCase()}`);
    }
  }

  lines.push(``);
  lines.push(`─`.repeat(60));
  lines.push(`This statement is for informational purposes only.`);

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getPeriodStart(
  period: CommissionConfig["trackingPeriod"],
  refDate: Date
): Date {
  const d = new Date(refDate);
  switch (period) {
    case "monthly":
      return new Date(d.getFullYear(), d.getMonth(), 1);
    case "quarterly": {
      const q = Math.floor(d.getMonth() / 3);
      return new Date(d.getFullYear(), q * 3, 1);
    }
    case "annual":
    default:
      return new Date(d.getFullYear(), 0, 1);
  }
}

// ---------------------------------------------------------------------------
// Net-of-split summary + pipeline GCI forecast (read surfaces)
// ---------------------------------------------------------------------------

export interface SplitConfigSummary {
  /** The org's saved split config, or null when unconfigured. */
  config: CommissionSplitConfig | null;
  /** True only when a real split config row exists (the honest gate). */
  configured: boolean;
  /** Per-agent YTD roll-up: GCI owed vs. agent net of split. */
  perAgent: Array<{
    teamMemberId: number;
    displayName: string;
    ytdOwedCents: number;
    ytdAgentNetCents: number;
    ytdSplitApplied: boolean;
  }>;
}

/**
 * The split config + a computed net-of-split YTD summary for the GET surface.
 * When no split config is saved, `config` is null and `configured` is false —
 * the caller renders an honest "not configured" state, never an assumed split.
 */
export async function getSplitConfigSummary(
  organizationId: number,
  year: number = new Date().getFullYear()
): Promise<SplitConfigSummary> {
  const [config, summaries] = await Promise.all([
    getSplitConfig(organizationId),
    getAgentCommissionSummaries(organizationId, year),
  ]);
  return {
    config,
    configured: config != null,
    perAgent: summaries.map((s) => ({
      teamMemberId: s.teamMemberId,
      displayName: s.displayName,
      ytdOwedCents: s.ytdOwedCents,
      ytdAgentNetCents: s.ytdAgentNetCents,
      ytdSplitApplied: s.ytdSplitApplied,
    })),
  };
}

/**
 * Build a pipeline GCI forecast for the org from its OWN data:
 *   - under-contract (accepted / in_escrow), client-book deals only,
 *   - the tiered commission config (refuses when none saved),
 *   - the split config (projects agent net only when saved),
 *   - real YTD closed counts + company dollar per agent for honest tier + cap.
 *
 * All refusal/skip logic lives in the pure shared/commission/forecast.ts engine;
 * this only assembles the org's recorded facts and hands them over.
 */
export async function getGciForecast(
  organizationId: number,
  year: number = new Date().getFullYear()
): Promise<GciForecastResult> {
  const [configured, commissionConfig, splitConfig] = await Promise.all([
    hasCommissionConfig(organizationId),
    getCommissionConfig(organizationId),
    getSplitConfig(organizationId),
  ]);

  // Under-contract pipeline deals (exclude soft-deleted). acceptedAmount is a
  // numeric dollar string; convert to cents. A missing/invalid amount stays
  // null so the engine SKIPS it rather than invent a price.
  const rows = await db
    .select({
      id: deals.id,
      assignedTo: deals.assignedTo,
      acceptedAmount: deals.acceptedAmount,
      status: deals.status,
      dealBook: deals.dealBook,
    })
    .from(deals)
    .where(
      and(
        eq(deals.organizationId, organizationId),
        inArray(deals.status, ["accepted", "in_escrow"]),
        // The soft-delete value, from the vocabulary rather than spelled
        // here — `deleted` is an ADMINISTRATIVE deal status, and the day a
        // second one exists this excludes it too.
        notInArray(deals.status, [...ADMINISTRATIVE_DEAL_STATUSES])
      )
    );

  const pipelineDeals: PipelineDealInput[] = rows.map((r) => {
    const amt = r.acceptedAmount != null ? parseFloat(String(r.acceptedAmount)) : NaN;
    const salePriceCents = Number.isFinite(amt) && amt > 0 ? Math.round(amt * 100) : null;
    return {
      dealId: r.id,
      teamMemberId: r.assignedTo ?? null,
      salePriceCents,
      status: r.status,
      dealBook: r.dealBook ?? null,
    };
  });

  // Real YTD closed counts + company dollar per agent, from recorded commissions.
  const fromDate = startOfYear(new Date(year, 0, 1));
  const toDate = endOfYear(new Date(year, 0, 1));
  const ytdRecords = await getCommissionRecords(organizationId, { fromDate, toDate });
  const ytdClosedByMember: Record<number, number> = {};
  const ytdCompanyDollarByMember: Record<number, number> = {};
  for (const r of ytdRecords) {
    ytdClosedByMember[r.teamMemberId] = (ytdClosedByMember[r.teamMemberId] ?? 0) + 1;
    if (typeof r.splitBrokerCents === "number") {
      ytdCompanyDollarByMember[r.teamMemberId] =
        (ytdCompanyDollarByMember[r.teamMemberId] ?? 0) + r.splitBrokerCents;
    }
  }

  return projectGci({
    pipelineDeals,
    config: {
      commissionConfig: configured ? commissionConfig : null,
      splitConfig,
      ytdClosedByMember,
      ytdCompanyDollarByMember,
    },
  });
}
