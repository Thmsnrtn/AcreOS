/**
 * Credit-pool deduction surface — Pillar 4 enforcement (Lens 3, Pricing
 * Coherence).
 *
 * Five high-traffic actions ship in this round:
 *   - `/api/sms/send`               → `sms_outbound`
 *   - `/api/outreach/mail/queue`    → postcard/letter weight (already routed
 *                                     through MailRouter, this is the pool draw)
 *   - `/api/ai/draft-reply`         → `ai_turn_avg`
 *   - `/api/skip-tracing/...`       → `skip_trace`
 *   - `/api/avm/...`                → `ai_turn_avg` (AVM runs an LLM-assisted
 *                                     valuation pipeline; we bill it as one
 *                                     AI turn until the model splits in two)
 *
 * Semantics:
 *   - Founders bypass entirely (and the credit-weights file already returns
 *     a giant pool for founder tier).
 *   - Each call writes a single `financial_ledger` row with
 *     `category = "opex_spent"` and a `feature` in TRACKED_CATEGORIES — the
 *     existing /api/outreach/mail/credits/summary gauge sums these.
 *   - Idempotency: the caller must supply a unique externalEventId so retries
 *     collapse to one ledger row (financial_ledger has a UNIQUE index on it).
 *   - Pool-empty: we still post the debit and return `allowed: false`. The
 *     caller decides whether to refuse the action (hard wall) or only soft-
 *     warn — at this stage we soft-warn for SMS/AI and hard-wall mail
 *     because mail has out-of-pocket cost to AcreOS regardless of customer
 *     tier.
 *   - Refunds: callers that fail mid-flight pass the inserted row id back to
 *     `refundPoolDebit` which posts a positive ledger row keyed on
 *     `${originalEventId}:refund`.
 */

import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { financialLedger, organizations } from "@shared/schema";
import { TIER_LIMITS, type SubscriptionTier } from "@shared/billing/tier-limits";
import { creditCost, type CreditAction } from "@shared/billing/credit-weights";
import { logger } from "../utils/logger";

/** TRACKED_CATEGORIES on the gauge query — must stay in sync. */
const POOL_FEATURE_FOR_ACTION: Record<CreditAction, string> = {
  sms_outbound: "sms",
  email_outbound: "email",
  postcard_eddm: "postcard",
  postcard_postgrid: "postcard",
  postcard_lob: "postcard",
  letter_presort: "postcard", // letters share the postcard pool bucket on the gauge
  letter_lob: "postcard",
  skip_trace: "skip_trace",
  ai_turn_avg: "ai_tokens",
};

const PROVIDER_HINT_FOR_ACTION: Record<CreditAction, string> = {
  sms_outbound: "twilio",
  email_outbound: "ses",
  postcard_eddm: "eddm",
  postcard_postgrid: "postgrid",
  postcard_lob: "lob",
  letter_presort: "presort",
  letter_lob: "lob",
  skip_trace: "batchdata",
  ai_turn_avg: "anthropic",
};

export interface PoolDebitArgs {
  organizationId: number;
  action: CreditAction;
  /** Number of units (recipients, tokens, lookups). Final cost = weight * units, rounded up. */
  units: number;
  /**
   * Idempotency anchor. Should embed the route + a stable id (e.g.
   * `sms:${messageSid}` or `mail:queue:${shipmentId}`). Required.
   */
  externalEventId: string;
  /** Optional human note for the ledger row. */
  notes?: string;
  /** Bypass entirely (founder paths set this). Defaults via DB lookup. */
  isFounder?: boolean;
}

export interface PoolDebitResult {
  /** True if the action is permitted (founder OR pool had room OR soft-warn). */
  allowed: boolean;
  /** Cents debited from the pool (0 for founders or no-op). */
  debitedCents: number;
  /** Remaining pool credits this month after this debit (founders: Infinity). */
  remaining: number;
  /** Total pool size for the tier (founders: Infinity). */
  poolMonthly: number;
  /** The ledger row id, for downstream refund() calls. Null for founder / no-op. */
  ledgerRowId: number | null;
  /** True when the debit pushed past the pool (caller may choose to soft-warn). */
  overPool: boolean;
}

async function fetchOrgTier(
  organizationId: number,
): Promise<{ tier: SubscriptionTier; isFounder: boolean }> {
  const [row] = await db
    .select({
      subscriptionTier: organizations.subscriptionTier,
      isFounder: organizations.isFounder,
    })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  if (!row) return { tier: "free", isFounder: false };
  const t = (row.subscriptionTier ?? "free").toLowerCase();
  const tier = (TIER_LIMITS as Record<string, unknown>)[t]
    ? (t as SubscriptionTier)
    : "free";
  return { tier, isFounder: row.isFounder === true };
}

async function poolUsageThisMonth(organizationId: number): Promise<number> {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const features = Object.values(POOL_FEATURE_FOR_ACTION);
  const uniqueFeatures = Array.from(new Set(features));
  const [agg] = await db
    .select({
      usedAbsCents: sql<number>`coalesce(sum(abs(${financialLedger.amountCents})), 0)::int`,
    })
    .from(financialLedger)
    .where(
      and(
        eq(financialLedger.organizationId, organizationId),
        eq(financialLedger.category, "opex_spent"),
        inArray(financialLedger.feature, uniqueFeatures),
        gte(financialLedger.postedAt, monthStart),
      ),
    );
  return agg?.usedAbsCents ?? 0;
}

/**
 * Deduct N units of `action` from the org's pool. Idempotent on
 * `externalEventId`. Returns the new pool state so the response can update
 * the client gauge optimistically.
 */
export async function poolDebit(args: PoolDebitArgs): Promise<PoolDebitResult> {
  const { tier, isFounder: dbIsFounder } = await fetchOrgTier(args.organizationId);
  const isFounder = args.isFounder ?? dbIsFounder;

  // Founders never draw from the pool. Return a sentinel result so callers
  // can keep one code path.
  if (isFounder) {
    return {
      allowed: true,
      debitedCents: 0,
      remaining: Number.POSITIVE_INFINITY,
      poolMonthly: TIER_LIMITS.enterprise.creditPool,
      ledgerRowId: null,
      overPool: false,
    };
  }

  const weight = await creditCost(args.action);
  const rawCost = weight * Math.max(0, args.units);
  // Round UP so fractional weights (email 0.02) never undercount.
  const cents = Math.max(0, Math.ceil(rawCost));

  if (cents === 0) {
    const poolMonthly = TIER_LIMITS[tier].creditPool;
    const used = await poolUsageThisMonth(args.organizationId);
    return {
      allowed: true,
      debitedCents: 0,
      remaining: Math.max(0, poolMonthly - used),
      poolMonthly,
      ledgerRowId: null,
      overPool: false,
    };
  }

  // Insert the debit. ON CONFLICT DO NOTHING on external_event_id makes the
  // call idempotent — a retry of the same externalEventId is a no-op.
  const feature = POOL_FEATURE_FOR_ACTION[args.action];
  const provider = PROVIDER_HINT_FOR_ACTION[args.action];

  try {
    const inserted = await db
      .insert(financialLedger)
      .values({
        organizationId: args.organizationId,
        bucket: "opex_available",
        category: "opex_spent",
        amountCents: -cents,
        feature,
        provider,
        externalEventId: args.externalEventId,
        postedAt: new Date(),
        postedBy: `system:credit-pool:${args.action}`,
        notes: args.notes ?? null,
      })
      .onConflictDoNothing({ target: financialLedger.externalEventId })
      .returning({ id: financialLedger.id });

    const poolMonthly = TIER_LIMITS[tier].creditPool;
    const usedAfter = await poolUsageThisMonth(args.organizationId);
    const remaining = Math.max(0, poolMonthly - usedAfter);
    const overPool = usedAfter > poolMonthly;

    return {
      allowed: true,
      debitedCents: inserted.length > 0 ? cents : 0,
      remaining,
      poolMonthly,
      ledgerRowId: inserted[0]?.id ?? null,
      overPool,
    };
  } catch (err) {
    logger.error("[credit-pool] debit failed", err instanceof Error ? err : undefined);
    // Fail-OPEN — never block a customer action because the pool ledger
    // misbehaved. The gauge will reconcile on the next successful debit.
    const poolMonthly = TIER_LIMITS[tier].creditPool;
    return {
      allowed: true,
      debitedCents: 0,
      remaining: poolMonthly,
      poolMonthly,
      ledgerRowId: null,
      overPool: false,
    };
  }
}

/**
 * Refund a previously-debited pool entry (caller failed after the debit
 * posted). Writes a positive ledger row keyed on `${originalEventId}:refund`.
 */
export async function refundPoolDebit(args: {
  organizationId: number;
  originalEventId: string;
  amountCents: number;
  reason: string;
}): Promise<void> {
  if (!Number.isFinite(args.amountCents) || args.amountCents <= 0) return;
  try {
    await db
      .insert(financialLedger)
      .values({
        organizationId: args.organizationId,
        bucket: "opex_available",
        category: "opex_spent",
        amountCents: Math.abs(args.amountCents), // POSITIVE to reverse the debit
        feature: "refund",
        provider: null,
        externalEventId: `${args.originalEventId}:refund`,
        postedAt: new Date(),
        postedBy: "system:credit-pool:refund",
        notes: args.reason,
      })
      .onConflictDoNothing({ target: financialLedger.externalEventId });
  } catch (err) {
    logger.error("[credit-pool] refund failed", err instanceof Error ? err : undefined);
  }
}

/**
 * Snapshot the pool state without writing — useful for routes that want to
 * surface the remaining balance in a non-debit response.
 */
export async function poolSnapshot(
  organizationId: number,
): Promise<{ poolMonthly: number; remaining: number; tier: SubscriptionTier }> {
  const { tier, isFounder } = await fetchOrgTier(organizationId);
  if (isFounder) {
    return {
      poolMonthly: TIER_LIMITS.enterprise.creditPool,
      remaining: Number.POSITIVE_INFINITY,
      tier,
    };
  }
  const poolMonthly = TIER_LIMITS[tier].creditPool;
  const used = await poolUsageThisMonth(organizationId);
  return { poolMonthly, remaining: Math.max(0, poolMonthly - used), tier };
}
