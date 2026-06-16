/**
 * Founder Autopilot — real senses gathered from live platform state.
 *
 * The brain only ever acts on senses that are genuinely measured (decide.ts).
 * This module is where the not-yet-in-the-pulse senses are read from real
 * tables — honestly, best-effort, never invented. Each loader isolates its own
 * failure and degrades to the truthful "none known" default so a single bad
 * source can't poison the decision or crash the loop.
 *
 * Currently: the support backlog (open + escalated cases). More senses
 * (activation stalls, etc.) land here as they get real sources.
 */
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { supportCases } from "@shared/schema";
import { logger } from "../../utils/logger";

/**
 * Count support cases genuinely waiting on us — status open or escalated.
 * `awaiting_user` is waiting on the customer (not our backlog); `ai_handling`
 * is in progress; resolved/closed are done. Returns 0 on any error (honest
 * default — we never fabricate a backlog).
 */
export async function getOpenSupportCaseCount(): Promise<number> {
  try {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(supportCases)
      .where(sql`${supportCases.status} in ('open', 'escalated')`);
    return Number(row?.n ?? 0);
  } catch (err) {
    logger.warn(
      "[autopilot/senses] support backlog read failed; defaulting to 0",
      err instanceof Error ? err : undefined,
    );
    return 0;
  }
}
