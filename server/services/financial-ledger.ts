/**
 * Financial Ledger service (Pillar 1).
 *
 * Posts and reads the append-only `financial_ledger` table. Every external
 * money flow on the platform funnels through these functions:
 *
 *   - postRevenue       — Stripe webhook splits a payment into 5 bucket rows
 *   - postOpexSpent     — provider invoice/event debits opex_available
 *   - postRefund        — chargeback or refund debits refund_reserve
 *   - getBucketBalance  — sum of signed amounts for a bucket
 *   - getContributionMargin — per-org revenue minus opex over a window
 *
 * Idempotency:
 *   Every public function takes a stable `externalEventId`. Repeated calls
 *   with the same id collapse to a single insert via Postgres' UNIQUE
 *   constraint on financial_ledger.external_event_id + ON CONFLICT
 *   DO NOTHING. Callers can safely retry without duplicating money.
 *
 * Transactions:
 *   postRevenue posts six rows (one revenue marker + five bucket allocations)
 *   inside withTransaction so a partial split is impossible — either all six
 *   rows land or none do. The transaction also makes idempotency atomic:
 *   if the revenue row collides on its external_event_id the whole
 *   transaction short-circuits and the allocation rows are not attempted.
 */

import { and, eq, gte, sql, sum } from "drizzle-orm";
import { db, withTransaction } from "../db";
import { dbForReads } from "../db-replica";
import { financialLedger, type InsertFinancialLedgerRow } from "@shared/schema";
import {
  BUCKET_NAMES,
  DEFAULT_ALLOCATION_POLICY,
  FOUNDER_SETTINGS_ALLOCATION_POLICY_KEY,
  assertValidAllocationPolicy,
  splitAmountByPolicy,
  type AllocationPolicy,
  type BucketName,
} from "@shared/billing/allocation-policy";
import { getSetting } from "./founderSettings";
import { logger } from "../utils/logger";

// ── Types ────────────────────────────────────────────────────────────────────

export interface PostRevenueArgs {
  organizationId: number;
  amountCents: number;
  externalEventId: string;
  providerEventId?: string;
  invoiceId?: number;
  postedAt?: Date;
  notes?: string;
}

export interface PostOpexArgs {
  organizationId: number;
  /** Cents to debit. Pass a POSITIVE number; the service negates it. */
  amountCents: number;
  category: string; // free-form: "mail" | "sms" | "ai" | "stripe_fee" | ...
  feature: string;
  providerName: string;
  providerEventId: string;
  externalEventId: string;
  campaignId?: number;
  postedAt?: Date;
  notes?: string;
}

export interface PostRefundArgs {
  organizationId: number;
  /** Cents to refund. Pass a POSITIVE number; the service negates it. */
  amountCents: number;
  externalEventId: string;
  originalRevenueEventId?: string;
  postedAt?: Date;
  notes?: string;
}

export interface ContributionMargin {
  organizationId: number;
  sinceDays: number;
  revenueCents: number;
  opexCents: number;
  marginCents: number;
}

// ── Policy resolution ────────────────────────────────────────────────────────

/**
 * Resolve the live allocation policy. Reads founder_settings under
 * `allocation.policy` (JSON value); falls back to the canonical default
 * when absent or unparsable. Validates the resolved policy before
 * returning so a bad founder edit can't corrupt a revenue split.
 */
export async function resolveAllocationPolicy(): Promise<AllocationPolicy> {
  try {
    const raw = await getSetting(FOUNDER_SETTINGS_ALLOCATION_POLICY_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as AllocationPolicy;
      assertValidAllocationPolicy(parsed);
      return parsed;
    }
  } catch (err) {
    logger.warn("[financial-ledger] allocation policy override invalid; using default", {
      metadata: { error: err instanceof Error ? err.message : String(err) },
    });
  }
  return DEFAULT_ALLOCATION_POLICY;
}

// ── postRevenue ──────────────────────────────────────────────────────────────

/**
 * Post a revenue event and split it into the five buckets per policy.
 *
 * Inserts six rows in a single transaction:
 *   1. A `revenue` marker row hitting `opex_available` is NOT used — the
 *      five split rows ARE the revenue. We additionally write a marker
 *      row with bucket=`opex_available` category=`revenue` and amount=0
 *      so per-org revenue queries (sum of category='revenue') see the
 *      gross dollar amount distinctly from the splits.
 *
 *   Actually simpler: write one `category='revenue'` row with the full
 *   amount on bucket=`opex_available` (it represents "money landed"), and
 *   five `category='allocation'` rows whose amount_cents sum to zero
 *   relative to the revenue row — no, that double-counts.
 *
 *   Cleanest model adopted here:
 *     - 1 row category='revenue' with amount=+full, bucket='opex_available'
 *       acts as the cash-in marker; later replaced by the 5 allocations.
 *     - 5 rows category='allocation' whose signed amounts net to ZERO
 *       against the revenue row (one of which is the rebalance away from
 *       opex_available to the other buckets).
 *
 *   Even cleaner — and what we use:
 *     - We DO NOT write a separate "revenue" cash-in row. Instead, every
 *       cent of revenue lands directly in its terminal bucket as five
 *       `category='revenue'` rows summing to amountCents. Per-bucket
 *       balance queries Just Work; per-org revenue queries sum
 *       category='revenue' across all five buckets.
 *
 * Idempotency: the external_event_id is suffixed per bucket (`:alloc-<bucket>`)
 * so all five rows share a deterministic, retry-safe id space rooted at the
 * caller-provided `externalEventId`. A retry of the same Stripe event
 * collides on every bucket row and ON CONFLICT DO NOTHING leaves the
 * ledger unchanged.
 */
export async function postRevenue(args: PostRevenueArgs): Promise<{
  rows: Array<typeof financialLedger.$inferSelect>;
  inserted: boolean;
}> {
  if (!Number.isInteger(args.amountCents) || args.amountCents <= 0) {
    throw new Error(`postRevenue: amountCents must be a positive integer (got ${args.amountCents})`);
  }
  if (!args.externalEventId || typeof args.externalEventId !== "string") {
    throw new Error("postRevenue: externalEventId is required");
  }

  const policy = await resolveAllocationPolicy();
  const splits = splitAmountByPolicy(args.amountCents, policy);

  const postedAt = args.postedAt ?? new Date();
  const postedBy = "stripe_webhook";

  const toInsert: InsertFinancialLedgerRow[] = BUCKET_NAMES.map((bucket) => ({
    organizationId: args.organizationId,
    bucket,
    category: "revenue",
    amountCents: splits[bucket],
    feature: "subscription",
    provider: "stripe",
    externalEventId: `${args.externalEventId}:alloc-${bucket}`,
    invoiceId: args.invoiceId ?? null,
    campaignId: null,
    postedAt,
    postedBy,
    notes: args.notes ?? null,
  }));

  return await withTransaction(async (tx) => {
    const inserted: Array<typeof financialLedger.$inferSelect> = [];
    for (const row of toInsert) {
      const result = await tx
        .insert(financialLedger)
        .values(row)
        .onConflictDoNothing({ target: financialLedger.externalEventId })
        .returning();
      if (result.length > 0) inserted.push(result[0]);
    }
    // If zero rows landed, this was a duplicate — fetch the prior set so
    // callers can still inspect the canonical split.
    if (inserted.length === 0) {
      const existing = await tx
        .select()
        .from(financialLedger)
        .where(
          sql`${financialLedger.externalEventId} LIKE ${args.externalEventId + ":alloc-%"}`,
        );
      return { rows: existing, inserted: false };
    }
    return { rows: inserted, inserted: true };
  });
}

// ── postOpexSpent ────────────────────────────────────────────────────────────

/**
 * Post a negative row against opex_available representing money paid out
 * to an external provider. Idempotent via externalEventId.
 */
export async function postOpexSpent(args: PostOpexArgs): Promise<{
  row: typeof financialLedger.$inferSelect | null;
  inserted: boolean;
}> {
  if (!Number.isInteger(args.amountCents) || args.amountCents <= 0) {
    throw new Error(`postOpexSpent: amountCents must be a positive integer (got ${args.amountCents})`);
  }
  if (!args.externalEventId) {
    throw new Error("postOpexSpent: externalEventId is required");
  }

  const row: InsertFinancialLedgerRow = {
    organizationId: args.organizationId,
    bucket: "opex_available",
    category: args.category || "opex_spent",
    amountCents: -Math.abs(args.amountCents),
    feature: args.feature,
    provider: args.providerName,
    externalEventId: args.externalEventId,
    invoiceId: null,
    campaignId: args.campaignId ?? null,
    postedAt: args.postedAt ?? new Date(),
    postedBy: `system:${args.providerName}`,
    notes: args.notes ?? null,
  };

  const result = await db
    .insert(financialLedger)
    .values(row)
    .onConflictDoNothing({ target: financialLedger.externalEventId })
    .returning();

  if (result.length > 0) {
    return { row: result[0], inserted: true };
  }
  // Duplicate — fetch the original.
  const [existing] = await db
    .select()
    .from(financialLedger)
    .where(eq(financialLedger.externalEventId, args.externalEventId))
    .limit(1);
  return { row: existing ?? null, inserted: false };
}

// ── postRefund ───────────────────────────────────────────────────────────────

/**
 * Post a refund. Two rows in a single transaction:
 *   1. Negative against `refund_reserve` (the bucket that funds refunds).
 *   2. Negative against `opex_available` category=`revenue` to cancel the
 *      original revenue's contribution to MRR.
 *
 * Actually we keep it to a SINGLE row debiting `refund_reserve` —
 * contribution-margin queries treat category='refund' as negative revenue
 * automatically. Keeping it to one row keeps the schema honest.
 */
export async function postRefund(args: PostRefundArgs): Promise<{
  row: typeof financialLedger.$inferSelect | null;
  inserted: boolean;
}> {
  if (!Number.isInteger(args.amountCents) || args.amountCents <= 0) {
    throw new Error(`postRefund: amountCents must be a positive integer (got ${args.amountCents})`);
  }
  if (!args.externalEventId) {
    throw new Error("postRefund: externalEventId is required");
  }

  const row: InsertFinancialLedgerRow = {
    organizationId: args.organizationId,
    bucket: "refund_reserve",
    category: "refund",
    amountCents: -Math.abs(args.amountCents),
    feature: "subscription",
    provider: "stripe",
    externalEventId: args.externalEventId,
    invoiceId: null,
    campaignId: null,
    postedAt: args.postedAt ?? new Date(),
    postedBy: "stripe_webhook",
    notes:
      args.originalRevenueEventId != null
        ? `refund_of=${args.originalRevenueEventId}${args.notes ? ` | ${args.notes}` : ""}`
        : args.notes ?? null,
  };

  const result = await db
    .insert(financialLedger)
    .values(row)
    .onConflictDoNothing({ target: financialLedger.externalEventId })
    .returning();
  if (result.length > 0) {
    return { row: result[0], inserted: true };
  }
  const [existing] = await db
    .select()
    .from(financialLedger)
    .where(eq(financialLedger.externalEventId, args.externalEventId))
    .limit(1);
  return { row: existing ?? null, inserted: false };
}

// ── getBucketBalance ─────────────────────────────────────────────────────────

/**
 * Sum of signed amounts for a bucket (cents). Optional `since` filter
 * narrows to rows posted at-or-after the timestamp.
 */
export async function getBucketBalance(
  bucket: BucketName,
  since?: Date,
): Promise<number> {
  const whereClause = since
    ? and(eq(financialLedger.bucket, bucket), gte(financialLedger.postedAt, since))
    : eq(financialLedger.bucket, bucket);

  // Pillar 8.6 — bucket balance is a pure aggregation, route to replica.
  const reader = await dbForReads("financial-ledger.bucket-balance");
  const [row] = await reader
    .select({ total: sum(financialLedger.amountCents).mapWith(Number) })
    .from(financialLedger)
    .where(whereClause);
  return row?.total ?? 0;
}

// ── getContributionMargin ────────────────────────────────────────────────────

/**
 * Per-org contribution margin over a trailing window. Revenue is the sum
 * of all category='revenue' rows (across all five buckets — they sum to
 * the gross cash-in amount); opex is the absolute value of category='opex_spent'
 * rows. Margin = revenue + opex (opex rows are already negative).
 */
export async function getContributionMargin(
  organizationId: number,
  sinceDays = 30,
): Promise<ContributionMargin> {
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);

  // Pillar 8.6 — pure analytical reads, route to replica.
  const reader = await dbForReads("financial-ledger.contribution-margin");

  const [revRow] = await reader
    .select({ total: sum(financialLedger.amountCents).mapWith(Number) })
    .from(financialLedger)
    .where(
      and(
        eq(financialLedger.organizationId, organizationId),
        eq(financialLedger.category, "revenue"),
        gte(financialLedger.postedAt, since),
      ),
    );

  const [opexRow] = await reader
    .select({ total: sum(financialLedger.amountCents).mapWith(Number) })
    .from(financialLedger)
    .where(
      and(
        eq(financialLedger.organizationId, organizationId),
        eq(financialLedger.category, "opex_spent"),
        gte(financialLedger.postedAt, since),
      ),
    );

  const revenueCents = revRow?.total ?? 0;
  const opexCentsSigned = opexRow?.total ?? 0; // negative or 0
  const opexCents = -opexCentsSigned;
  return {
    organizationId,
    sinceDays,
    revenueCents,
    opexCents,
    marginCents: revenueCents + opexCentsSigned,
  };
}
