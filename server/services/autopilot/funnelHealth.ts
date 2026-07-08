/**
 * Autonomous Self-Acquisition — funnel-health SLO ("work done" vs "demand captured").
 *
 * The most likely silent failure of an unattended acquisition engine: it runs
 * green, publishes daily, gates pass — and acquires zero users for months. The
 * daily letter must tell the truth. This assesses whether the inventory the loop
 * is building is actually EARNING (search impressions) and CONVERTING (attributed
 * signups), and flags a genuine stall distinctly from healthy early accretion.
 *
 * Honest by construction: published-count is PROGRESS, never SUCCESS; absence of
 * GSC config is "unknown", not "failing"; attribution is a lower bound. The pure
 * assessor is unit-tested; the gatherer raises one deduped alert on a real stall.
 */
import { logger } from "../../utils/logger";

/** Days of indexing grace before "0 impressions" counts as a stall. */
export const IMPRESSION_GRACE_DAYS = 21;
/** Days before "earning but 0 signups" counts as a conversion stall. */
export const SIGNUP_GRACE_DAYS = 30;

export type FunnelHealthStatus = "not_started" | "building" | "unknown" | "starved_discovery" | "starved_conversion";

export interface FunnelHealthInput {
  publishedTotal: number;
  daysSinceFirstPublish: number | null;
  /** GSC impressions over the window, or null when GSC isn't configured. */
  gscImpressions: number | null;
  /** Attributed signups (lower bound). */
  attributedSignups: number;
}

export interface FunnelHealthResult {
  status: FunnelHealthStatus;
  /** True only for a genuine stall worth a founder alert. */
  starved: boolean;
  /** One honest line for the daily letter. */
  line: string;
}

/**
 * Assess funnel health. Pure + total. "Starved" only fires after the relevant
 * grace window so SEO dead-time is never mistaken for failure; GSC-unconfigured
 * is "unknown" (we can't see discovery), not a stall.
 */
export function assessFunnelHealth(inp: FunnelHealthInput): FunnelHealthResult {
  if (inp.publishedTotal <= 0) {
    return { status: "not_started", starved: false, line: "No owned content published yet — inventory phase hasn't begun." };
  }
  const days = inp.daysSinceFirstPublish ?? 0;

  // Discovery stall: enough time to index, GSC says zero impressions.
  if (inp.gscImpressions !== null && days >= IMPRESSION_GRACE_DAYS && inp.gscImpressions === 0) {
    return {
      status: "starved_discovery",
      starved: true,
      line: `${inp.publishedTotal} page(s) published, 0 search impressions after ${days}d — publishing into a void. Check indexing/ignition (Search Console verified? sitemaps submitted? backlinks?).`,
    };
  }

  // Conversion stall: earning attention but converting nobody, past the window.
  if ((inp.gscImpressions ?? 0) > 0 && days >= SIGNUP_GRACE_DAYS && inp.attributedSignups === 0) {
    return {
      status: "starved_conversion",
      starved: true,
      line: `Earning ${inp.gscImpressions} impressions but 0 attributed signups in ${days}d — traffic isn't converting. The funnel, not the inventory, is the gap.`,
    };
  }

  if (inp.gscImpressions === null) {
    return {
      status: "unknown",
      starved: false,
      line: `${inp.publishedTotal} page(s) published; search visibility unknown (Search Console not connected). Inventory accreting.`,
    };
  }

  return {
    status: "building",
    starved: false,
    line:
      inp.attributedSignups > 0
        ? `${inp.publishedTotal} page(s) published, ${inp.gscImpressions} impressions, ${inp.attributedSignups} attributed signup(s) — the flywheel is turning.`
        : `${inp.publishedTotal} page(s) published, ${inp.gscImpressions} impressions, 0 signups yet — earning attention, conversion still pending (expected early). Inventory accreting.`,
  };
}

/**
 * Gather live inputs, assess, and raise ONE deduped founder alert on a genuine
 * stall. Returns the result for the daily letter. Best-effort; never throws.
 */
export async function checkFunnelHealth(now = new Date()): Promise<FunnelHealthResult> {
  let publishedTotal = 0;
  let daysSinceFirstPublish: number | null = null;
  let gscImpressions: number | null = null;
  let attributedSignups = 0;

  try {
    const { db } = await import("../../db");
    const { marketingArtifacts } = await import("@shared/schema");
    const { isNull, sql } = await import("drizzle-orm");
    const [agg] = await db
      .select({ n: sql<number>`count(*)::int`, first: sql<string | null>`min(${marketingArtifacts.publishedAt})` })
      .from(marketingArtifacts)
      .where(isNull(marketingArtifacts.unpublishedAt));
    publishedTotal = Number(agg?.n ?? 0);
    if (agg?.first) daysSinceFirstPublish = Math.floor((now.getTime() - new Date(agg.first).getTime()) / 86400_000);
  } catch {
    /* unknown total */
  }

  try {
    const { getSearchConsoleMetrics, gscConfigured } = await import("./searchConsoleSense");
    if (gscConfigured()) {
      const m = await getSearchConsoleMetrics();
      gscImpressions = m ? m.impressions : null;
    }
  } catch {
    /* gsc unknown */
  }

  try {
    const { getConversionSummary } = await import("./attribution");
    attributedSignups = (await getConversionSummary()).totalSignups;
  } catch {
    /* none */
  }

  const result = assessFunnelHealth({ publishedTotal, daysSinceFirstPublish, gscImpressions, attributedSignups });

  if (result.starved) {
    try {
      const { raiseAlert } = await import("../../services/alertSpine");
      const day = now.toISOString().slice(0, 10);
      await raiseAlert({
        severity: "warning",
        source: "autopilot_funnel_health",
        title: `Acquisition stall: ${result.status.replace(/_/g, " ")}`,
        detail: result.line,
        dedupeKey: `funnel-stall:${result.status}:${day}`,
        domain: "growth",
        citedReason: "Autonomous acquisition must surface 'work done ≠ demand captured' honestly.",
      });
    } catch (err) {
      logger.warn("[funnelHealth] alert failed", err instanceof Error ? err : undefined);
    }
  }
  return result;
}
