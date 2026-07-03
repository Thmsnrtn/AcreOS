/**
 * Founder Autopilot — the blind-sense watchdog (step-away gap #2 residue).
 *
 * The Operator's briefing already tells the BRAIN when senses are dark
 * (PARTIAL TELEMETRY block); this module tells the FOUNDER — because a sense
 * that stays dark across consecutive gathers isn't a blip, it's a broken
 * instrument, and an instrument that fails silently for days is exactly what
 * makes stepping away unsafe.
 *
 * Mechanism (no new tables — rides the append-only autopilot_senses ledger):
 *   • every context gather writes ONE row (kind "context_gather", detail =
 *     { degraded: [...] }) — including all-clear gathers, so "consecutive"
 *     is well-defined;
 *   • a sense dark in the last CONSECUTIVE_DARK_TO_PAGE gathers pages the
 *     founder once, with a 24h re-page cooldown per sense (marker row
 *     kind "sense_dark_paged:<sense>").
 *
 * Best-effort everywhere: this runs fire-and-forget off the cognition path
 * and must never block or break a tick.
 */
import { desc, eq, gte, and } from "drizzle-orm";
import { db } from "../../db";
import { autopilotSenses } from "@shared/schema";
import { logger } from "../../utils/logger";

export const GATHER_KIND = "context_gather";
export const PAGE_MARKER_PREFIX = "sense_dark_paged:";
export const CONSECUTIVE_DARK_TO_PAGE = 3;
const REPAGE_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/**
 * Pure: which senses are dark in ALL of the last `n` gathers?
 * `recentGathers` is newest-first; fewer than `n` gathers → nothing qualifies
 * (cold start never pages).
 */
export function consecutivelyDark(recentGathers: string[][], n = CONSECUTIVE_DARK_TO_PAGE): string[] {
  if (recentGathers.length < n) return [];
  const lastN = recentGathers.slice(0, n);
  const [newest, ...rest] = lastN;
  return newest.filter((sense) => rest.every((g) => g.includes(sense)));
}

/**
 * Record this gather's dark-sense list and page the founder for any sense
 * that has now been dark CONSECUTIVE_DARK_TO_PAGE gathers running (with a
 * 24h per-sense cooldown). Returns the senses paged for. Never throws.
 */
export async function recordGatherAndCheck(degraded: string[]): Promise<{ paged: string[] }> {
  const paged: string[] = [];
  try {
    await db.insert(autopilotSenses).values({
      kind: GATHER_KIND,
      value: degraded.length,
      detail: { degraded },
    });

    const recent = await db
      .select({ detail: autopilotSenses.detail })
      .from(autopilotSenses)
      .where(eq(autopilotSenses.kind, GATHER_KIND))
      .orderBy(desc(autopilotSenses.observedAt))
      .limit(CONSECUTIVE_DARK_TO_PAGE);

    const gathers: string[][] = recent.map((r) => {
      const d = r.detail as { degraded?: unknown } | null;
      return Array.isArray(d?.degraded) ? (d!.degraded as string[]) : [];
    });

    const stuck = consecutivelyDark(gathers);
    if (stuck.length === 0) return { paged };

    for (const sense of stuck) {
      // 24h cooldown per sense — a broken instrument pages once a day, not
      // every 30-minute tick.
      const markerKind = `${PAGE_MARKER_PREFIX}${sense}`;
      const cooldownFloor = new Date(Date.now() - REPAGE_COOLDOWN_MS);
      const [recentPage] = await db
        .select({ id: autopilotSenses.id })
        .from(autopilotSenses)
        .where(and(eq(autopilotSenses.kind, markerKind), gte(autopilotSenses.observedAt, cooldownFloor)))
        .limit(1);
      if (recentPage) continue;

      const { sendSolenePage } = await import("../solene/pagerService");
      await sendSolenePage({
        severity: "urgent",
        subject: `Autopilot sense "${sense}" has gone dark`,
        body: `The "${sense}" sense failed on ${CONSECUTIVE_DARK_TO_PAGE} consecutive context gathers (~${CONSECUTIVE_DARK_TO_PAGE * 30} min). The Operator is treating its values as UNKNOWN, not zero — plans aren't being grounded on it — but a persistently blind instrument needs a look.`,
      });
      await db.insert(autopilotSenses).values({ kind: markerKind, value: 1, detail: { sense } });
      paged.push(sense);
      logger.warn(`[senseWatchdog] paged founder — sense "${sense}" dark ${CONSECUTIVE_DARK_TO_PAGE} gathers running`);
    }
  } catch (err) {
    logger.warn(
      `[senseWatchdog] watchdog pass failed (cognition unaffected): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return { paged };
}
