/**
 * Autonomous Self-Acquisition — A3: authority-paced publish governor (the brake).
 *
 * The whole "unattended publisher" premise rests on this: a zero-authority domain
 * that mass-mints pages is the textbook scaled-content penalty that permanently
 * torches the only asset (domain reputation). So publish velocity is NOT a flat
 * cap — it rises ONLY when Google Search Console confirms existing pages are
 * actually earning impressions (authority earned), and it FREEZES the instant a
 * reputation indicator (deliverability complaints) degrades. Build the brake
 * before the gas.
 *
 * The decision is a pure function (exhaustively tested); the gatherer is thin
 * best-effort IO that degrades to the safe base pace when a signal is missing.
 */
import { logger } from "../../utils/logger";

export interface PublishGovernorInput {
  /** GSC impressions over the recent window, or null when no search signal yet. */
  gscImpressions: number | null;
  /** Total owned artifacts published to date. */
  publishedTotal: number;
  /** Reputation healthy? (deliverability not degraded, no manual action). */
  reputationOk: boolean;
  /** Base (cold-start) pace, the floor. */
  base?: number;
  /** Hard ceiling on daily pace. */
  max?: number;
  /** Impressions that unlock one extra daily slot. */
  impressionsPerExtraSlot?: number;
}

export interface PublishGovernorResult {
  allowedPerDay: number;
  reason: string;
}

/**
 * Allowed publishes/day. Pure + total. Frozen on reputation degradation; base
 * pace until search authority is proven; expands only as real impressions accrue
 * (so it can never out-run crawl-trust into a penalty), clamped to a ceiling.
 * Published-into-a-void self-limits: extra≈0 while impressions≈0, so a big page
 * count with no impressions never unlocks faster minting.
 */
export function allowedPublishesPerDay(input: PublishGovernorInput): PublishGovernorResult {
  const base = Math.max(0, input.base ?? 1);
  const max = Math.max(base, input.max ?? 5);
  const perSlot = Math.max(1, input.impressionsPerExtraSlot ?? 500);

  if (!input.reputationOk) {
    return { allowedPerDay: 0, reason: "reputation degraded — publishing frozen until it recovers" };
  }
  if (input.gscImpressions == null) {
    return { allowedPerDay: base, reason: "no search-authority signal yet — holding base pace" };
  }
  const extra = Math.floor(Math.max(0, input.gscImpressions) / perSlot);
  const allowed = Math.max(base, Math.min(max, base + extra));
  return {
    allowedPerDay: allowed,
    reason:
      extra > 0
        ? `authority earned (${input.gscImpressions} impressions) — pace ${allowed}/day`
        : "indexed but not yet earning impressions — holding base pace",
  };
}

/**
 * Gather the live inputs and compute today's allowed publish pace. Best-effort:
 * any missing/erroring signal degrades to the safe base (the old flat cap), so
 * the governor can only ever HOLD or, on proven authority, gently widen — never
 * unbound. Reputation degradation (real email complaints) freezes publishing.
 */
export async function computeAllowedPublishesPerDay(base: number, max = 5): Promise<PublishGovernorResult> {
  let gscImpressions: number | null = null;
  let publishedTotal = 0;
  let reputationOk = true;

  try {
    const { getSearchConsoleMetrics, gscConfigured } = await import("./searchConsoleSense");
    if (gscConfigured()) {
      const m = await getSearchConsoleMetrics();
      gscImpressions = m ? m.impressions : null;
    }
  } catch {
    /* no GSC signal → base pace */
  }

  try {
    const { db } = await import("../../db");
    const { marketingArtifacts } = await import("@shared/schema");
    const { isNull } = await import("drizzle-orm");
    const rows = await db.select({ id: marketingArtifacts.id }).from(marketingArtifacts).where(isNull(marketingArtifacts.unpublishedAt));
    publishedTotal = rows.length;
  } catch {
    /* unknown total → treated as 0, conservative */
  }

  try {
    // Reputation freeze on real deliverability degradation — the same spam-
    // complaint signal decide.ts uses for protect_deliverability. Best-effort
    // (readOutwardSenses returns an empty map on failure → 0 complaints → ok).
    const { readOutwardSenses, outwardSignalFrom } = await import("./perception");
    const complaints = outwardSignalFrom(await readOutwardSenses()).emailComplaints;
    reputationOk = complaints <= EMAIL_COMPLAINT_FREEZE_THRESHOLD;
  } catch {
    /* no signal → assume ok (the gate stack still binds elsewhere) */
  }

  const result = allowedPublishesPerDay({ gscImpressions, publishedTotal, reputationOk, base, max });
  if (result.allowedPerDay !== base) {
    logger.info("[publishGovernor] authority-paced cap", { ...result, gscImpressions, publishedTotal, reputationOk });
  }
  return result;
}

/** Recent spam-complaint count above which owned publishing freezes. */
export const EMAIL_COMPLAINT_FREEZE_THRESHOLD = Number(process.env.AUTOPILOT_PUBLISH_COMPLAINT_FREEZE ?? 3);
