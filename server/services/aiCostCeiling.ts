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
import { clock } from "../utils/clock";

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
 * P1-5 / I-5 R1 (2026-11-12): per-org BACKGROUND sub-ceiling, monthly
 * (rolling 30d), tiered to price. The total ceilings above were set as
 * runaway-loop protection (204–505% of tier price); background/agent AI
 * (origin='background') never touches the customer allowance, so before
 * this sub-ceiling a single org's background work could consume its
 * entire monthly ceiling — a pure per-org margin loss bounded only by
 * the shared platform bucket. The sub-ceiling bounds that layer at
 * roughly 20–25% of the tier's price:
 *   free $2 · starter $10 (~20% of $49) · pro $25 (~25% of $99) ·
 *   scale $50 (~25% of $199) · enterprise $100.
 * It reconciles ceilings TO the ratified prices; it changes no price and
 * no allowance value.
 *
 * Only origin='background' rows count. origin='background_metered' work
 * is already bounded by the allowance it counts toward (founder decision
 * 2026-10-17), so summing it here too would double-bound it below its
 * own allowance. A founder override scales the sub-ceiling by the same
 * ratio it applies to the tier monthly ceiling (see getEffectiveCeilings).
 */
const TIER_BACKGROUND_MONTHLY_SUBCEILING_CENTS: Record<string, number> = {
  free: 200,        // $2/mo
  starter: 1_000,   // $10/mo
  pro: 2_500,       // $25/mo
  scale: 5_000,     // $50/mo
  enterprise: 10_000, // $100/mo
};

/** The tier's background sub-ceiling, scaled by a founder override's ratio. */
function backgroundSubCeilingCents(tier: string, effectiveMonthlyCents: number): number {
  const base = TIER_BACKGROUND_MONTHLY_SUBCEILING_CENTS[tier] ?? TIER_BACKGROUND_MONTHLY_SUBCEILING_CENTS.free;
  const tierMonthly = TIER_CEILING_DEFAULTS[tier]?.monthlyCents;
  if (!tierMonthly || effectiveMonthlyCents === tierMonthly) return Math.min(base, effectiveMonthlyCents);
  return Math.min(effectiveMonthlyCents, Math.round(base * (effectiveMonthlyCents / tierMonthly)));
}

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
// Default FLOOR $15/day = 1500 cents (above the $10/day category budget; the
// per-org $50/day quota is per-org, so $15 platform-wide is the binding
// aggregate backstop under DB failure).
//
// 2026-10 cost-efficiency: the default SCALES WITH PAYING MRR. A fixed $15/day
// is a sensible backstop at 0-5 customers and an outage at ~25-50: every
// customer's AI pauses on a perfectly ordinary day once their summed legitimate
// spend crosses it (audit F-16-4). The default is now
//
//     max(PLATFORM_DAILY_CEILING_FLOOR_CENTS, floor(payingMrrCents / 30 × share))
//
// with share = PLATFORM_CEILING_MRR_SHARE_DEFAULT (0.75), env-overridable via
// AI_PLATFORM_CEILING_MRR_SHARE (0 < share ≤ 1). Why 75% of a day's MRR: the
// tier-limits margin math bounds the worst LEGITIMATE org at ≈ 68% of its price
// at absolute full utilization (tier-limits.ts, Scale), so a platform-wide day
// above 75% of daily revenue is a runaway signal, never an ordinary day — while
// a typical day sits well below it.
//
// Still fail-CLOSED: an MRR read error yields the FLOOR (never a larger
// number), and the 24h-spend read posture below is unchanged. An explicit
// AI_PLATFORM_DAILY_CEILING_CENTS still wins over everything.
const PLATFORM_DAILY_CEILING_FLOOR_CENTS = 1500;
const PLATFORM_CEILING_MRR_SHARE_DEFAULT = 0.75;
const MRR_READ_TTL_MS = 10 * 60 * 1000;
let mrrRead: { cents: number; at: number } | null = null;

function platformCeilingMrrShare(): number {
  const raw = process.env.AI_PLATFORM_CEILING_MRR_SHARE;
  if (raw) {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0 && n <= 1) return n;
  }
  return PLATFORM_CEILING_MRR_SHARE_DEFAULT;
}

/**
 * Paying MRR in cents from the canonical reader (finance/runwayModel
 * `liveMrrDetail` — the same source the runway, snapshot job and gate watcher
 * read). Cached for 10 minutes so the per-call ceiling check does not add an
 * organizations scan to every model call. Throws on read failure; the caller
 * turns that into the floor.
 */
async function payingMrrCents(): Promise<number> {
  const now = clock.nowMs();
  if (mrrRead && now - mrrRead.at <= MRR_READ_TTL_MS) return mrrRead.cents;
  const { liveMrrDetail } = await import("./finance/runwayModel");
  const { cents } = await liveMrrDetail();
  if (!Number.isFinite(cents) || cents < 0) throw new Error(`non-finite MRR read: ${cents}`);
  mrrRead = { cents, at: now };
  return cents;
}

/** Test seam: forget the cached MRR read. */
export function __resetPlatformCeilingMrrCacheForTests(): void {
  mrrRead = null;
}

/**
 * The platform-wide daily AI ceiling in cents, and where it came from.
 * This is THE canonical value — every surface that displays or bounds the
 * platform ceiling (routes-ai-cost status, autopilot worstDay) reads it here.
 */
export async function getPlatformDailyCeiling(): Promise<{
  cents: number;
  source: "env_override" | "mrr_scaled" | "floor";
  payingMrrCents: number | null;
}> {
  const fromEnv = process.env.AI_PLATFORM_DAILY_CEILING_CENTS;
  if (fromEnv) {
    const n = Number(fromEnv);
    if (Number.isFinite(n) && n > 0) return { cents: n, source: "env_override", payingMrrCents: null };
  }
  let mrr: number;
  try {
    mrr = await payingMrrCents();
  } catch (err) {
    // Fail CLOSED: an unreadable MRR never grows the ceiling.
    logger.warn(
      "[aiCostCeiling] paying MRR unreadable — platform ceiling held at its floor",
      err instanceof Error ? err : undefined,
    );
    return { cents: PLATFORM_DAILY_CEILING_FLOOR_CENTS, source: "floor", payingMrrCents: null };
  }
  const scaled = Math.floor((mrr / 30) * platformCeilingMrrShare());
  return scaled > PLATFORM_DAILY_CEILING_FLOOR_CENTS
    ? { cents: scaled, source: "mrr_scaled", payingMrrCents: mrr }
    : { cents: PLATFORM_DAILY_CEILING_FLOOR_CENTS, source: "floor", payingMrrCents: mrr };
}

export async function getPlatformDailyCeilingCents(): Promise<number> {
  return (await getPlatformDailyCeiling()).cents;
}

export class AiCostCeilingExceededError extends Error {
  readonly code = "AI_COST_CEILING_EXCEEDED" as const;
  constructor(
    public readonly orgId: number,
    public readonly windowKey: "daily" | "monthly" | "background_monthly",
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

/**
 * P1-5 / I-5 R4: founder alerting on a MEASURED ceiling trip (fire-and-
 * forget; alerting must never break or delay the gate). Dedup + delivery
 * live in aiCostAlert.ts. Dynamic import keeps the alert module's email
 * dependency out of this module's import graph.
 */
function fireCeilingTripAlert(input: {
  scope: "platform" | "platform_background" | "org" | "org_background";
  orgId: number | null;
  windowKey: "daily" | "monthly" | "background_monthly";
  currentCents: number;
  ceilingCents: number;
}): void {
  void (async () => {
    try {
      const { notifyAiCeilingTrip } = await import("./aiCostAlert");
      await notifyAiCeilingTrip(input);
    } catch {
      // The gate has already thrown the refusal; a failed alert is logged
      // inside aiCostAlert and must never surface as a second error here.
    }
  })();
}

export async function getEffectiveCeilings(orgId: number): Promise<{
  dailyCents: number;
  monthlyCents: number;
  /** P1-5 R1: monthly sub-ceiling for origin='background' spend alone. */
  backgroundMonthlyCents: number;
  source: "platform_default" | "tier_default" | "founder_override";
}> {
  // G10 (2026-10-30): the overrides lookup used to run OUTSIDE any try/catch, so
  // a metering outage threw a raw DB error out of the gate before the guarded
  // sum/read posture below was ever reached. An unreadable override table now
  // falls back to the tier defaults (a founder override can only RAISE a
  // ceiling, so ignoring an unreadable one is the conservative direction) and
  // names what was unreadable.
  let override:
    | { dailyCeilingCents: number; monthlyCeilingCents: number | null }
    | undefined;
  try {
    [override] = await db
      .select()
      .from(aiCostCeilingOverrides)
      .where(eq(aiCostCeilingOverrides.organizationId, orgId))
      .limit(1);
  } catch (err) {
    logger.warn(
      "[aiCostCeiling] ai_cost_ceiling_overrides unreadable — falling back to tier default ceilings",
      err instanceof Error ? err : undefined,
    );
  }
  if (override) {
    const monthlyCents = override.monthlyCeilingCents ?? PLATFORM_DEFAULT_MONTHLY_CEILING_CENTS;
    // R1 under an override: the sub-ceiling scales by the same ratio the
    // override applies to the org's tier monthly ceiling, so a founder
    // raise lifts background headroom proportionally (and never past the
    // effective monthly ceiling itself). Tier unreadable → ratio 1
    // against the free tier's sub-ceiling (the conservative direction).
    let tier = "free";
    try {
      const [org] = await db
        .select({ subscriptionTier: organizations.subscriptionTier })
        .from(organizations)
        .where(eq(organizations.id, orgId))
        .limit(1);
      const { limitsTierFor } = await import("@shared/billing/tier-limits");
      tier = limitsTierFor(org?.subscriptionTier ?? "free");
    } catch {
      // Keep "free" — smallest sub-ceiling.
    }
    return {
      dailyCents: override.dailyCeilingCents,
      monthlyCents,
      backgroundMonthlyCents: backgroundSubCeilingCents(tier, monthlyCents),
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
    // The canonical fold: a legacy solo/operator/empire org gets its real
    // tier's ceiling, not the platform default (or nothing).
    const { limitsTierFor } = await import("@shared/billing/tier-limits");
    const tier = limitsTierFor(org?.subscriptionTier ?? "free");
    const tierDefaults = TIER_CEILING_DEFAULTS[tier];
    if (tierDefaults) {
      return {
        ...tierDefaults,
        backgroundMonthlyCents: backgroundSubCeilingCents(tier, tierDefaults.monthlyCents),
        source: "tier_default",
      };
    }
    return {
      dailyCents: PLATFORM_DEFAULT_DAILY_CEILING_CENTS,
      monthlyCents: PLATFORM_DEFAULT_MONTHLY_CEILING_CENTS,
      backgroundMonthlyCents: TIER_BACKGROUND_MONTHLY_SUBCEILING_CENTS.free,
      source: "platform_default",
    };
  } catch {
    return {
      ...TIER_CEILING_DEFAULTS.free,
      backgroundMonthlyCents: TIER_BACKGROUND_MONTHLY_SUBCEILING_CENTS.free,
      source: "tier_default",
    };
  }
}

async function sumCostCentsSince(orgId: number, sinceMs: number): Promise<number> {
  const since = new Date(clock.nowMs() - sinceMs);
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
 * P1-5 R1: an org's background-origin spend alone (origin='background').
 * Deliberately NOT 'background_metered' — that origin is allowance-bound
 * already (see TIER_BACKGROUND_MONTHLY_SUBCEILING_CENTS).
 */
async function sumBackgroundCostCentsSince(orgId: number, sinceMs: number): Promise<number> {
  const since = new Date(clock.nowMs() - sinceMs);
  const [row] = await db
    .select({
      sum: sql<string>`COALESCE(SUM(${aiTelemetryEvents.estimatedCostCents}), 0)`,
    })
    .from(aiTelemetryEvents)
    .where(and(
      eq(aiTelemetryEvents.organizationId, orgId),
      eq(aiTelemetryEvents.origin, "background"),
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
  const since = new Date(clock.nowMs() - sinceMs);
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

  const ceilingCents = await getPlatformDailyCeilingCents();
  const dayMs = 24 * 60 * 60 * 1000;

  // W4.2b — chat floor. The platform daily bucket is shared by paying-customer
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
    lastKnownPlatformDailyCents = { cents: dailyCents, at: clock.nowMs() };
    if (dailyCents >= effectiveCeiling) {
      // P1-5 R4: a background caller tripping here is the platform bucket
      // tripping at 70% — the first moment background work is cut to
      // reserve headroom for customer chat. That trip, and the full-bucket
      // trip, alert the founder (deduped per scope per day in aiCostAlert).
      fireCeilingTripAlert({
        scope: isBackground ? "platform_background" : "platform",
        orgId: null,
        windowKey: "daily",
        currentCents: dailyCents,
        ceilingCents: effectiveCeiling,
      });
      throw new AiCostCeilingExceededError(0, "daily", dailyCents, effectiveCeiling);
    }
  } catch (err) {
    if (err instanceof AiCostCeilingExceededError) throw err;
    // W4.3 — cached-last-known first: a telemetry-read hiccup enforces
    // against the last good total (≤10 min old) instead of disabling the
    // gate outright.
    const cached = lastKnownPlatformDailyCents;
    if (cached && clock.nowMs() - cached.at <= LAST_KNOWN_SPEND_TTL_MS) {
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
  opts?: {
    failClosed?: boolean;
    /**
     * P1-5 R1: who triggered the call. "background" subjects the call to
     * the org's background monthly sub-ceiling. When omitted, the
     * existing convention decides: failClosed callers ARE the autonomous /
     * background callers (the same identification the platform 70%
     * reserve uses), everyone else is customer-facing.
     */
    origin?: "customer" | "background";
  },
): Promise<void> {
  // Platform-wide check ALWAYS runs (including for orgId === null platform
  // calls). This is the outer envelope that prevents the runaway $30/day
  // scenario regardless of which surface initiated the call. Autonomous
  // callers pass failClosed so a telemetry-read outage refuses instead of
  // silently unbounding spend (re-audit it.3).
  await assertWithinPlatformCostCeiling({ failClosed: opts?.failClosed });

  if (orgId == null) return;
  if (process.env.AI_COST_CEILING_BYPASS === "1") return;

  const isBackground = opts?.origin ? opts.origin === "background" : opts?.failClosed === true;

  const ceilings = await getEffectiveCeilings(orgId);
  const dayMs = 24 * 60 * 60 * 1000;
  const monthMs = 30 * dayMs;

  try {
    const dailyCents = await sumCostCentsSince(orgId, dayMs);
    lastKnownOrgDailyCents.set(orgId, { cents: dailyCents, at: clock.nowMs() });
    if (dailyCents >= ceilings.dailyCents) {
      fireCeilingTripAlert({ scope: "org", orgId, windowKey: "daily", currentCents: dailyCents, ceilingCents: ceilings.dailyCents });
      throw new AiCostCeilingExceededError(orgId, "daily", dailyCents, ceilings.dailyCents);
    }
    const monthlyCents = await sumCostCentsSince(orgId, monthMs);
    if (monthlyCents >= ceilings.monthlyCents) {
      fireCeilingTripAlert({ scope: "org", orgId, windowKey: "monthly", currentCents: monthlyCents, ceilingCents: ceilings.monthlyCents });
      throw new AiCostCeilingExceededError(orgId, "monthly", monthlyCents, ceilings.monthlyCents);
    }
    // P1-5 R1: the background sub-ceiling. A background call is refused
    // here even when the org is far under its TOTAL ceilings — while the
    // same org's customer calls (origin 'customer') never reach this
    // check, and other orgs are unaffected. That per-org isolation is
    // the I-5 acceptance proof (tests/unit/aiBackgroundSubCeiling.test.ts).
    if (isBackground) {
      const backgroundMonthlyCents = await sumBackgroundCostCentsSince(orgId, monthMs);
      if (backgroundMonthlyCents >= ceilings.backgroundMonthlyCents) {
        fireCeilingTripAlert({
          scope: "org_background",
          orgId,
          windowKey: "background_monthly",
          currentCents: backgroundMonthlyCents,
          ceilingCents: ceilings.backgroundMonthlyCents,
        });
        throw new AiCostCeilingExceededError(orgId, "background_monthly", backgroundMonthlyCents, ceilings.backgroundMonthlyCents);
      }
    }
  } catch (err) {
    if (err instanceof AiCostCeilingExceededError) throw err;
    // W4.3 — enforce against the last-known-good daily total when the live
    // read fails (≤10 min stale). The old posture disabled the ceiling
    // entirely on any telemetry hiccup — exactly when a runaway loop is
    // most likely to be hammering the DB.
    const cached = lastKnownOrgDailyCents.get(orgId);
    if (cached && clock.nowMs() - cached.at <= LAST_KNOWN_SPEND_TTL_MS) {
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
        updatedAt: clock.now(),
      },
    });
}
