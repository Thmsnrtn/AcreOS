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
  /**
   * Set when the monthly pool was exhausted but the org's PURCHASED credit
   * balance (credit packs — organizations.creditBalance) funded the action
   * instead. Before this overflow lane existed the two ledgers never
   * reconciled: a customer who hit "pool used up" and bought a credit pack
   * stayed blocked, because poolDebit never read creditBalance.
   */
  fundedBy?: "purchased_credits";
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
    // W1.8 (2026-07 audit): a lookup hiccup used to be swallowed as
    // "no BYOK" and fall through to the pool — silently debiting pool
    // credits from a customer whose own key was about to serve the send
    // (the adapter resolves BYOK independently). Never guess the billing
    // answer: retry the cheap existence check, and if it still cannot be
    // answered, refuse in gate mode (fail closed, consistent with Tier 1I)
    // instead of picking a payer at random. Record mode continues — the
    // spend already happened and an over-recorded COGS row beats a
    // missing one.
    let active: boolean | null = null;
    for (let attempt = 0; attempt < 3 && active === null; attempt++) {
      try {
        active = await isByokEnabled(args.organizationId, channel);
      } catch (err) {
        if (attempt === 2) {
          logger.error(
            "[credit-pool] BYOK lookup failed after retries — refusing to guess the payer",
            err instanceof Error ? err : undefined,
          );
        } else {
          await new Promise((r) => setTimeout(r, 50 * (attempt + 1)));
        }
      }
    }
    if (active === null) {
      if ((args.enforce ?? "gate") === "gate") {
        const poolMonthly = TIER_LIMITS[tier].creditPool;
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
      // record mode: treat as no-BYOK and keep the COGS row honest.
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
    // FAIL CLOSED on a genuinely-exhausted pool (gate mode only). Roadmap
    // W1.8 (2026-07 audit): this used to be a separate SELECT (usedBefore)
    // followed by an unconditional INSERT — two concurrent debits near the
    // cap could BOTH pass the read and BOTH insert (TOCTOU), overspending
    // COGS past the pool. The gate is now a single atomic conditional
    // insert: the exhaustion re-check runs INSIDE the INSERT's WHERE at the
    // database, so no interleaving can slip a second boundary debit through.
    // Semantics preserved: a debit is honored while used < pool (even if it
    // pushes PAST the pool — the generous boundary edge, flagged overPool);
    // refused once used >= pool. Idempotency (ON CONFLICT on
    // external_event_id) is unchanged.
    const poolMonthlyForGate = TIER_LIMITS[tier].creditPool;
    const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
    const uniqueFeatures = Array.from(new Set(Object.values(POOL_FEATURE_FOR_ACTION)));

    let inserted: Array<{ id: number }>;
    if (enforce === "gate") {
      const res = await db.execute<{ id: number }>(sql`
        INSERT INTO financial_ledger
          (organization_id, bucket, category, amount_cents, feature, provider,
           external_event_id, posted_at, posted_by, notes)
        SELECT ${args.organizationId}, 'opex_available', 'opex_spent', ${-cents},
               ${feature}, ${provider ?? null}, ${args.externalEventId}, now(),
               ${`system:credit-pool:${args.action}`}, ${args.notes ?? null}
        WHERE (
          SELECT coalesce(sum(abs(amount_cents)), 0)
          FROM financial_ledger
          WHERE organization_id = ${args.organizationId}
            AND category = 'opex_spent'
            -- Parameterized IN via sql.join — NOT \`= ANY(\${arr}::text[])\`:
            -- drizzle binds a JS array as a record param, which Postgres
            -- rejects ("cannot cast type record to text[]"), so the gate
            -- query THREW on every call and fail-closed refused every
            -- metered action (found 2026-07-11 full-app sweep).
            AND feature IN (${sql.join(uniqueFeatures.map((f) => sql`${f}`), sql`, `)})
            AND posted_at >= ${monthStart}
        ) < ${poolMonthlyForGate}
        ON CONFLICT (external_event_id) DO NOTHING
        RETURNING id
      `);
      inserted = Array.isArray(res) ? (res as Array<{ id: number }>) : ((res as { rows?: Array<{ id: number }> })?.rows ?? []);

      if (inserted.length === 0) {
        // Zero rows = either an idempotent replay (row already exists for
        // this externalEventId) or the gate refused. Disambiguate honestly.
        const [replay] = await db
          .select({ id: financialLedger.id })
          .from(financialLedger)
          .where(eq(financialLedger.externalEventId, args.externalEventId))
          .limit(1);
        if (!replay) {
          // ── Purchased-credit overflow ─────────────────────────────────
          // The monthly pool is exhausted, but the org may hold PURCHASED
          // credits (credit packs → organizations.creditBalance). Draw from
          // that balance before refusing, so buying a pack actually relieves
          // the wall that sent the customer to the purchase modal. The
          // deduction is atomically guarded (balance >= amount) inside
          // deductCredits; on success we still write the opex ledger row so
          // per-org COGS stays honest.
          const { creditService } = await import("./credits");
          const overflowTx = await creditService
            .deductCredits(args.organizationId, cents, `Pool overflow: ${args.action}`, {
              source: "credit-pool-overflow",
              action: args.action,
              externalEventId: args.externalEventId,
            })
            .catch(() => null);
          if (overflowTx) {
            const recorded = await db
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
                postedBy: `system:credit-pool:${args.action}:purchased-overflow`,
                notes: args.notes ?? null,
              })
              .onConflictDoNothing({ target: financialLedger.externalEventId })
              .returning({ id: financialLedger.id });
            logger.info("[credit-pool] pool exhausted — funded from purchased credit balance", {
              metadata: { organizationId: args.organizationId, action: args.action, cents },
            });
            return {
              allowed: true,
              debitedCents: cents,
              remaining: 0,
              poolMonthly: poolMonthlyForGate,
              ledgerRowId: recorded[0]?.id ?? null,
              overPool: true,
              fundedBy: "purchased_credits",
            };
          }

          logger.warn("[credit-pool] debit refused — pool exhausted (atomic gate)", {
            metadata: { organizationId: args.organizationId, action: args.action, poolMonthly: poolMonthlyForGate, tier },
          });
          return {
            allowed: false,
            debitedCents: 0,
            remaining: 0,
            poolMonthly: poolMonthlyForGate,
            ledgerRowId: null,
            overPool: true,
            reason: "pool_exhausted",
          };
        }
        // Replay: fall through with zero-debit success (matches prior behavior).
      }
    } else {
      // record mode — the spend already happened; always write the row.
      inserted = await db
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
    }

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
    purchaseAvailable: true,
    purchaseUrl: "/usage",
    message:
      "Your monthly AcreOS credit pool is used up. Buy a credit pack on the Usage page to keep going now, add your own provider key in Settings → Your provider keys, or wait for the monthly reset.",
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
