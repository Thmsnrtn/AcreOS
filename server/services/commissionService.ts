// @ts-nocheck
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
import { eq, and, gte, lte, desc } from "drizzle-orm";
import { startOfYear, endOfYear, format } from "date-fns";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CommissionTier {
  minDeals: number;     // minimum closed deals in period to qualify for this tier
  ratePercent: number;  // commission % of deal sale price
  label: string;        // e.g. "Bronze", "Silver", "Gold"
}

export interface CommissionConfig {
  tiers: CommissionTier[];          // sorted ascending by minDeals
  baseFlatAmount?: number;          // flat per-deal bonus in cents (in addition to %)
  trackingPeriod: "monthly" | "quarterly" | "annual"; // volume counting window
}

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
  const creds = row.credentials as any;
  return creds.config ?? DEFAULT_CONFIG;
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

  const credentials = { config };

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
  const creds = row.credentials as any;
  const records: CommissionRecord[] = Array.isArray(creds.records)
    ? creds.records
    : [];
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

  const credentials = { records };

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
// Tier resolution
// ---------------------------------------------------------------------------

/**
 * Given a config and the number of deals already closed this period by an
 * agent, determine which tier applies to the NEXT deal.
 */
export function resolveCommissionTier(
  config: CommissionConfig,
  closedDealsInPeriod: number
): CommissionTier {
  // tiers sorted ascending by minDeals; pick highest eligible
  const eligible = config.tiers
    .filter((t) => closedDealsInPeriod >= t.minDeals)
    .sort((a, b) => b.minDeals - a.minDeals);
  return eligible[0] ?? config.tiers[0];
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
  };

  // Remove any existing record for this deal (idempotent)
  const filtered = records.filter((r) => r.dealId !== dealId);
  filtered.push(record);
  await saveCommissionRecordsStore(organizationId, filtered);

  console.log(
    `[Commission] Recorded $${(totalOwedCents / 100).toFixed(2)} commission for team member ${teamMemberId} on deal ${dealId} (${tier.label} tier @ ${tier.ratePercent}%)`
  );

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
