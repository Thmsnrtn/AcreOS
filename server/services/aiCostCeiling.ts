/**
 * FW-THEO-1 + FW-INDIRA-1 (push-forward 2026-05-08): per-org AI cost ceiling.
 *
 * Per the panel: any single org's daily AI cost should never exceed a
 * configured ceiling without explicit founder override. Theo frames as
 * cost discipline; Indira frames as runaway-loop protection (the
 * agent-loop-runaway runbook trips at $50/24h).
 *
 * Defaults:
 *   PLATFORM_DEFAULT_DAILY_CEILING_CENTS = 5000  ($50/day per org)
 *   PLATFORM_DEFAULT_MONTHLY_CEILING_CENTS = 100000 ($1,000/month per org)
 *
 * Founder can set per-org overrides via ai_cost_ceiling_overrides. The
 * aiRouter consults this helper before routing a paid call; if the org
 * is at-or-over the ceiling, the call is rejected with an explicit
 * AiCostCeilingExceededError that the agent surfaces back to the
 * customer ("AI is paused for today; contact support@acreos.io").
 */

import { db } from "../db";
import { aiCostCeilingOverrides, aiTelemetryEvents, organizations } from "@shared/schema";
import { and, eq, gte, sql } from "drizzle-orm";
import { logger } from "../utils/logger";

const PLATFORM_DEFAULT_DAILY_CEILING_CENTS = 5000;
const PLATFORM_DEFAULT_MONTHLY_CEILING_CENTS = 100_000;

/**
 * W4.2 (2026-07 audit): tier-proportional ceiling defaults. The flat
 * $50/day default gave a FREE org the same runaway allowance as Pro —
 * 30× what Pro pays per month, per day, at $0 revenue. Ceilings now scale
 * with what the tier pays; founder overrides still win.
 */
const TIER_CEILING_DEFAULTS: Record<string, { dailyCents: number; monthlyCents: number }> = {
  free:       { dailyCents: 200,    monthlyCents: 2_000 },   // $2/day, $20/mo
  starter:    { dailyCents: 1_000,  monthlyCents: 10_000 },  // $10/day, $100/mo
  pro:        { dailyCents: 5_000,  monthlyCents: 50_000 },  // $50/day, $500/mo
  scale:      { dailyCents: 8_000,  monthlyCents: 80_000 },
  enterprise: { dailyCents: 10_000, monthlyCents: 100_000 },
};

/**
 * W4.3: last-known-good spend cache so a telemetry-read hiccup enforces
 * against recent truth instead of silently disabling the gate. Entries
 * older than the TTL are not trusted.
 */
const LAST_KNOWN_SPEND_TTL_MS = 10 * 60 * 1000;
const lastKnownOrgDailyCents = new Map<number, { cents: number; at: number }>();
let lastKnownPlatformDailyCents: { cents: number; at: number } | null = null;

// Platform-wide cap across ALL orgs + platform-internal calls. This is the
// outer envelope: the per-org ceilings prevent one customer from hogging
// spend; this prevents the whole platform from quietly billing $30/day at
// $0 MRR. Settable via env so Tom can ratchet it without a deploy.
//
// This is the ONLY fail-CLOSED gate in the AI cost stack — assertWithin* below
// re-throws AiCostCeilingExceededError but swallows DB errors fail-open. So the
// SOFT gates (intelligence/budget.ts $10/day per-category, aiQuotaService
// $50/day per-org) disable themselves under DB load, leaving THIS ceiling as
// the only limit that actually holds. It must therefore sit just ABOVE the
// summed soft budgets so it is the meaningful master limit, not a 100×-below
// decorative floor.
//
// Default $15/day = 1500 cents (above the $10/day category budget; the per-org
// $50/day quota is per-org, so $15 platform-wide is the binding aggregate
// backstop under DB failure). Env-overridable.
const PLATFORM_DEFAULT_DAILY_CEILING_CENTS_FALLBACK = 1500;
function getPlatformDailyCeilingCents(): number {
  const fromEnv = process.env.AI_PLATFORM_DAILY_CEILING_CENTS;
  if (fromEnv) {
    const n = Number(fromEnv);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return PLATFORM_DEFAULT_DAILY_CEILING_CENTS_FALLBACK;
}

export class AiCostCeilingExceededError extends Error {
  readonly code = "AI_COST_CEILING_EXCEEDED" as const;
  constructor(
    public readonly orgId: number,
    public readonly windowKey: "daily" | "monthly",
    public readonly currentCents: number,
    public readonly ceilingCents: number,
  ) {
    super(
      `AI cost ceiling exceeded for org ${orgId} (${windowKey}): ` +
      `$${(currentCents / 100).toFixed(2)} ≥ $${(ceilingCents / 100).toFixed(2)}`,
    );
    this.name = "AiCostCeilingExceededError";
  }
}

export async function getEffectiveCeilings(orgId: number): Promise<{
  dailyCents: number;
  monthlyCents: number;
  source: "platform_default" | "tier_default" | "founder_override";
}> {
  const [override] = await db
    .select()
    .from(aiCostCeilingOverrides)
    .where(eq(aiCostCeilingOverrides.organizationId, orgId))
    .limit(1);
  if (override) {
    return {
      dailyCents: override.dailyCeilingCents,
      monthlyCents: override.monthlyCeilingCents ?? PLATFORM_DEFAULT_MONTHLY_CEILING_CENTS,
      source: "founder_override",
    };
  }

  // W4.2 — tier-aware default. A tier lookup failure falls back to the
  // conservative FREE ceiling, never the generous flat default: an org we
  // can't identify should get the smallest allowance, not the largest.
  try {
    const [org] = await db
      .select({ subscriptionTier: organizations.subscriptionTier })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1);
    const tier = (org?.subscriptionTier ?? "free").toLowerCase();
    const tierDefaults = TIER_CEILING_DEFAULTS[tier];
    if (tierDefaults) {
      return { ...tierDefaults, source: "tier_default" };
    }
    return {
      dailyCents: PLATFORM_DEFAULT_DAILY_CEILING_CENTS,
      monthlyCents: PLATFORM_DEFAULT_MONTHLY_CEILING_CENTS,
      source: "platform_default",
    };
  } catch {
    return { ...TIER_CEILING_DEFAULTS.free, source: "tier_default" };
  }
}

async function sumCostCentsSince(orgId: number, sinceMs: number): Promise<number> {
  const since = new Date(Date.now() - sinceMs);
  const [row] = await db
    .select({
      sum: sql<string>`COALESCE(SUM(${aiTelemetryEvents.estimatedCostCents}), 0)`,
    })
    .from(aiTelemetryEvents)
    .where(and(
      eq(aiTelemetryEvents.organizationId, orgId),
      gte(aiTelemetryEvents.createdAt, since),
    ));
  return Number(row?.sum ?? 0);
}

/**
 * Tahoe Andrei: how many cents of an org's daily AI ceiling remain right now.
 * Used by the router's pre-call predictCostCents forecast to decide whether the
 * next call fits under the ceiling — and, if not, to route to a cheaper model
 * instead of letting the next-but-one call hard-fail with a 429.
 *
 * Returns Infinity for platform-internal calls (orgId == null) and on any DB
 * read error (fail-open — never block a chat on a budget-lookup hiccup).
 */
export async function getRemainingDailyBudgetCents(
  orgId: number | null,
): Promise<number> {
  if (orgId == null) return Number.POSITIVE_INFINITY;
  try {
    const ceilings = await getEffectiveCeilings(orgId);
    const dayMs = 24 * 60 * 60 * 1000;
    const spent = await sumCostCentsSince(orgId, dayMs);
    return Math.max(0, ceilings.dailyCents - spent);
  } catch (err) {
    logger.warn(
      "[aiCostCeiling] remaining-budget lookup failed; treating as unlimited",
      err instanceof Error ? err : undefined,
    );
    return Number.POSITIVE_INFINITY;
  }
}

async function sumPlatformCostCentsSince(sinceMs: number): Promise<number> {
  const since = new Date(Date.now() - sinceMs);
  const [row] = await db
    .select({
      sum: sql<string>`COALESCE(SUM(${aiTelemetryEvents.estimatedCostCents}), 0)`,
    })
    .from(aiTelemetryEvents)
    .where(gte(aiTelemetryEvents.createdAt, since));
  return Number(row?.sum ?? 0);
}

/**
 * Platform-wide daily ceiling check. Throws AiCostCeilingExceededError
 * (with orgId=0 sentinel) if the sum of all telemetry across all orgs +
 * platform-internal calls in the last 24h is at-or-over
 * AI_PLATFORM_DAILY_CEILING_CENTS. Call this for every paid AI call,
 * regardless of whether an orgId is available.
 *
 * Bypass: `AI_COST_CEILING_BYPASS=1`.
 */
export async function assertWithinPlatformCostCeiling(opts?: {
  failClosed?: boolean;
}): Promise<void> {
  if (process.env.AI_COST_CEILING_BYPASS === "1") return;

  const ceilingCents = getPlatformDailyCeilingCents();
  const dayMs = 24 * 60 * 60 * 1000;

  // W4.2b — chat floor. The $15/day bucket is shared by paying-customer
  // chat AND background/autopilot loops; before this split, a runaway
  // background loop could drain the whole bucket and throttle paying
  // customers with it. Background callers (failClosed === true is how the
  // autonomous callers already identify themselves) hit their ceiling at
  // 70% of the bucket, reserving the last 30% for customer-facing calls.
  const isBackground = opts?.failClosed === true;
  const effectiveCeiling = isBackground
    ? Math.floor(ceilingCents * 0.7)
    : ceilingCents;

  try {
    const dailyCents = await sumPlatformCostCentsSince(dayMs);
    lastKnownPlatformDailyCents = { cents: dailyCents, at: Date.now() };
    if (dailyCents >= effectiveCeiling) {
      throw new AiCostCeilingExceededError(0, "daily", dailyCents, effectiveCeiling);
    }
  } catch (err) {
    if (err instanceof AiCostCeilingExceededError) throw err;
    // W4.3 — cached-last-known first: a telemetry-read hiccup enforces
    // against the last good total (≤10 min old) instead of disabling the
    // gate outright.
    const cached = lastKnownPlatformDailyCents;
    if (cached && Date.now() - cached.at <= LAST_KNOWN_SPEND_TTL_MS) {
      if (cached.cents >= effectiveCeiling) {
        throw new AiCostCeilingExceededError(0, "daily", cached.cents, effectiveCeiling);
      }
      return; // last-known says we're under — allow.
    }
    // Posture split (re-audit it.3): CUSTOMER-facing callers fail OPEN (a DB
    // hiccup must not brick a paying customer's AI). AUTONOMOUS callers (the
    // autopilot/dispatch worker) pass failClosed → we refuse rather than let a
    // sustained telemetry-read outage silently unbound platform LLM spend.
    if (opts?.failClosed) {
      logger.error(
        "[aiCostCeiling] platform ceiling unreadable; failing CLOSED for autonomous caller",
        err instanceof Error ? err : undefined,
      );
      throw new AiCostCeilingExceededError(0, "daily", -1, effectiveCeiling);
    }
    logger.warn(
      "[aiCostCeiling] platform ceiling check failed; falling open",
      err instanceof Error ? err : undefined,
    );
  }
}

/**
 * Throw if the requesting org has exceeded its daily or monthly AI
 * cost ceiling. Call this BEFORE incurring a paid AI call.
 *
 * Bypass:
 *   - orgId === null (platform-internal calls) → no-op
 *   - process.env.AI_COST_CEILING_BYPASS === "1" (dev-loop only)
 */
export async function assertWithinAiCostCeiling(
  orgId: number | null,
  opts?: { failClosed?: boolean },
): Promise<void> {
  // Platform-wide check ALWAYS runs (including for orgId === null platform
  // calls). This is the outer envelope that prevents the runaway $30/day
  // scenario regardless of which surface initiated the call. Autonomous
  // callers pass failClosed so a telemetry-read outage refuses instead of
  // silently unbounding spend (re-audit it.3).
  await assertWithinPlatformCostCeiling({ failClosed: opts?.failClosed });

  if (orgId == null) return;
  if (process.env.AI_COST_CEILING_BYPASS === "1") return;

  const ceilings = await getEffectiveCeilings(orgId);
  const dayMs = 24 * 60 * 60 * 1000;
  const monthMs = 30 * dayMs;

  try {
    const dailyCents = await sumCostCentsSince(orgId, dayMs);
    lastKnownOrgDailyCents.set(orgId, { cents: dailyCents, at: Date.now() });
    if (dailyCents >= ceilings.dailyCents) {
      throw new AiCostCeilingExceededError(orgId, "daily", dailyCents, ceilings.dailyCents);
    }
    const monthlyCents = await sumCostCentsSince(orgId, monthMs);
    if (monthlyCents >= ceilings.monthlyCents) {
      throw new AiCostCeilingExceededError(orgId, "monthly", monthlyCents, ceilings.monthlyCents);
    }
  } catch (err) {
    if (err instanceof AiCostCeilingExceededError) throw err;
    // W4.3 — enforce against the last-known-good daily total when the live
    // read fails (≤10 min stale). The old posture disabled the ceiling
    // entirely on any telemetry hiccup — exactly when a runaway loop is
    // most likely to be hammering the DB.
    const cached = lastKnownOrgDailyCents.get(orgId);
    if (cached && Date.now() - cached.at <= LAST_KNOWN_SPEND_TTL_MS) {
      if (cached.cents >= ceilings.dailyCents) {
        throw new AiCostCeilingExceededError(orgId, "daily", cached.cents, ceilings.dailyCents);
      }
      return;
    }
    if (opts?.failClosed) {
      logger.error(
        "[aiCostCeiling] org ceiling unreadable with no recent cache; failing CLOSED for autonomous caller",
        err instanceof Error ? err : undefined,
      );
      throw new AiCostCeilingExceededError(orgId, "daily", -1, ceilings.dailyCents);
    }
    // Customer-facing with no cache: fail open (a transient DB hiccup must
    // not brick a paying customer's chat); log and proceed.
    logger.warn(
      "[aiCostCeiling] could not check ceiling; falling open",
      err instanceof Error ? err : undefined,
    );
  }
}

export async function setFounderOverride(opts: {
  organizationId: number;
  dailyCeilingCents: number;
  monthlyCeilingCents?: number;
  setBy: string;
  notes?: string;
}): Promise<void> {
  await db
    .insert(aiCostCeilingOverrides)
    .values({
      organizationId: opts.organizationId,
      dailyCeilingCents: opts.dailyCeilingCents,
      monthlyCeilingCents: opts.monthlyCeilingCents ?? null,
      setBy: opts.setBy,
      notes: opts.notes ?? null,
    })
    .onConflictDoUpdate({
      target: aiCostCeilingOverrides.organizationId,
      set: {
        dailyCeilingCents: opts.dailyCeilingCents,
        monthlyCeilingCents: opts.monthlyCeilingCents ?? null,
        setBy: opts.setBy,
        notes: opts.notes ?? null,
        updatedAt: new Date(),
      },
    });
}
