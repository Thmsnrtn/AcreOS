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
 *   - Pool-empty: FAIL CLOSED (Tier 1I, 2026-06-10). In the default
 *     `enforce: "gate"` mode a genuinely-exhausted pool refuses the debit
 *     (`allowed: false`, no ledger write) and a debit ERROR also refuses
 *     for non-founder orgs — the prior fail-open behavior let heavy users
 *     run unbounded COGS. Callers must check `allowed` and respond with
 *     `Errors.limitExceeded` carrying `{ reason, remaining, byokAvailable }`.
 *     Post-hoc recorders (provider registry, which debits AFTER the paid
 *     lookup happened) pass `enforce: "record"` so the COGS ledger row is
 *     always written regardless of pool state.
 *   - BYOK bypass: orgs with an active BYOK credential for the channel that
 *     serves the action never draw from the pool at all — their spend goes
 *     straight to the provider, our COGS is $0 (see byok/toggle.ts).
 *   - Refunds: callers that fail mid-flight pass the inserted row id back to
 *     `refundPoolDebit` which posts a positive ledger row keyed on
 *     `${originalEventId}:refund`.
 */

import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { financialLedger, organizations, type ByokChannel } from "@shared/schema";
import { TIER_LIMITS, type SubscriptionTier } from "@shared/billing/tier-limits";
// Tier 1C: creditCost moved out of shared/ (it reaches into server settings).
import { type CreditAction } from "@shared/billing/credit-weights";
import { creditCost } from "./creditCost";
import { isByokEnabled } from "./byok/toggle";
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
  // Paid data lookups share a single "data_lookup" gauge bucket so the founder
  // sees total paid-data COGS at a glance (Lena cost surface).
  parcel_lookup_paid: "data_lookup",
  comps_lookup: "data_lookup",
  owner_lookup: "data_lookup",
  valuation_lookup: "data_lookup",
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
  parcel_lookup_paid: "data-provider",
  comps_lookup: "data-provider",
  owner_lookup: "data-provider",
  valuation_lookup: "data-provider",
};

/**
 * Which BYOK channels, when active for the org, make an action free to the
 * platform (the customer's own provider account absorbs the spend). When
 * any listed channel has an active credential, poolDebit skips the pool
 * entirely. Actions with an empty list never BYOK-bypass (e.g. paid data
 * lookups, which run on platform provider contracts).
 */
const BYOK_CHANNELS_FOR_ACTION: Record<CreditAction, readonly ByokChannel[]> = {
  sms_outbound: ["twilio", "telnyx"],
  email_outbound: ["sendgrid", "ses"],
  postcard_eddm: [],
  postcard_postgrid: ["postgrid"],
  postcard_lob: ["lob"],
  letter_presort: [],
  letter_lob: ["lob"],
  skip_trace: ["batch_skiptracing"],
  // Any AI-channel key makes Pax turns free to the platform — the router
  // sends the call through the customer's key (see byok/aiByok.ts).
  ai_turn_avg: ["anthropic", "openrouter", "openai"],
  parcel_lookup_paid: [],
  comps_lookup: [],
  owner_lookup: [],
  valuation_lookup: [],
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
  /**
   * "gate" (default): pre-action callers — refuses (no ledger write) when
   * the pool is already exhausted, and FAILS CLOSED on debit errors.
   * "record": post-hoc COGS recorders (provider registry) — always writes
   * the ledger row even over-pool; `allowed` is advisory only.
   */
  enforce?: "gate" | "record";
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
  /** Set when `allowed === false` — why the action was refused. */
  reason?: "pool_exhausted" | "pool_debit_error";
  /** True when an active BYOK credential made this action free to the platform. */
  byokBypassed?: boolean;
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

  // BYOK bypass — when the org's own provider key serves this action, the
  // customer pays the provider directly. No pool draw, no ledger row, and
  // the action is always allowed (their key, their spend, zero COGS to us).
  const byokChannels = BYOK_CHANNELS_FOR_ACTION[args.action] ?? [];
  for (const channel of byokChannels) {
    let active = false;
    try {
      active = await isByokEnabled(args.organizationId, channel);
    } catch {
      // Lookup hiccup → treat as no-BYOK and fall through to the pool.
      active = false;
    }
    if (active) {
      const poolMonthly = TIER_LIMITS[tier].creditPool;
      return {
        allowed: true,
        debitedCents: 0,
        remaining: poolMonthly, // untouched by this call
        poolMonthly,
        ledgerRowId: null,
        overPool: false,
        byokBypassed: true,
      };
    }
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
  const enforce = args.enforce ?? "gate";

  try {
    // FAIL CLOSED on a genuinely-exhausted pool (gate mode only): when the
    // month's pool is already fully spent BEFORE this debit, refuse without
    // writing a ledger row. The boundary debit that merely pushes PAST the
    // pool is still honored (generous edge — `overPool: true` flags it).
    if (enforce === "gate") {
      const poolMonthly = TIER_LIMITS[tier].creditPool;
      const usedBefore = await poolUsageThisMonth(args.organizationId);
      if (usedBefore >= poolMonthly) {
        logger.warn("[credit-pool] debit refused — pool exhausted", {
          metadata: {
            organizationId: args.organizationId,
            action: args.action,
            usedBefore,
            poolMonthly,
            tier,
          },
        });
        return {
          allowed: false,
          debitedCents: 0,
          remaining: 0,
          poolMonthly,
          ledgerRowId: null,
          overPool: true,
          reason: "pool_exhausted",
        };
      }
    }

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
    const poolMonthly = TIER_LIMITS[tier].creditPool;
    if (enforce === "record") {
      // Post-hoc recorder — the spend already happened; nothing to refuse.
      return {
        allowed: true,
        debitedCents: 0,
        remaining: poolMonthly,
        poolMonthly,
        ledgerRowId: null,
        overPool: false,
      };
    }
    // FAIL CLOSED (Tier 1I, 2026-06-10) — the prior fail-open here meant a
    // broken ledger silently un-metered every paid lane. Non-founder orgs
    // (founders returned earlier) get a refusal the route surfaces as a 429
    // with a BYOK/upgrade path; remaining is reported 0 because we cannot
    // know the true pool state mid-error.
    return {
      allowed: false,
      debitedCents: 0,
      remaining: 0,
      poolMonthly,
      ledgerRowId: null,
      overPool: false,
      reason: "pool_debit_error",
    };
  }
}

/**
 * Whether an action has a self-serve BYOK escape hatch — used by routes to
 * set `byokAvailable` on the 429 refusal payload so the client can point
 * at /settings/byok instead of a dead-end "limit reached".
 */
export function byokAvailableForAction(action: CreditAction): boolean {
  return (BYOK_CHANNELS_FOR_ACTION[action] ?? []).length > 0;
}

/**
 * Standard `details` payload for the Errors.limitExceeded(429) a route
 * returns when poolDebit refuses (`allowed: false`). One shape everywhere
 * so the client banner/toast can render a single refusal component.
 */
export function poolRefusalDetails(action: CreditAction, debit: PoolDebitResult) {
  return {
    reason: debit.reason ?? "pool_exhausted",
    resourceType: "credit_pool" as const,
    remaining: debit.remaining,
    poolMonthly: debit.poolMonthly,
    byokAvailable: byokAvailableForAction(action),
    byokSettingsUrl: "/settings/byok",
    message:
      "Your monthly AcreOS credit pool is used up. Add your own provider key in Settings → Your provider keys to keep going without limits, or wait for the monthly reset.",
  };
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
