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
import { eventMeshEvents, supportCases } from "@shared/schema";
import { unscopedForPlatformOps } from "../../utils/orgScopedDb";
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

/** Deal pipeline activity as the brain sees it (Jarvis 2.1, audit G2). */
export interface DealActivitySignal {
  /** deal:lifecycle mesh events in the window (created/updated/closed). */
  events: number;
  /** Of those, deals closed WON — the milestone signal. */
  closedWon: number;
}

/**
 * Count deal-lifecycle mesh events in the window. This reads the mesh's own
 * ledger (event_mesh_events) rather than re-deriving pipeline state, so the
 * brain sees exactly what the mutation seams published — no more, no less.
 * Returns honest zeros on any failure.
 */
export async function getDealActivitySignal(windowHours = 24): Promise<DealActivitySignal> {
  try {
    // Platform-wide ON PURPOSE, through the explicit hatch. Solene is the
    // FOUNDER's brain — its tick reads MRR, trials and the founder decision
    // budget for the whole business — so "deal motion in the last 24h" is a
    // company number, not a tenant's. The read was already cross-org; what it
    // lacked was any way to tell that from a forgotten predicate, which is
    // exactly what made it invisible until `org_id` tables entered the
    // tenancy gate's population on 2026-09-04.
    const [row] = await unscopedForPlatformOps(
      "Solene founder-brain deal-motion sense: counts deal:lifecycle mesh events across the whole business, which is the company-level signal the founder tick reasons over",
    )
      .select({
        events: sql<number>`count(*)::int`,
        closedWon: sql<number>`count(*) filter (where ${eventMeshEvents.eventType} = 'deal:closed' and ${eventMeshEvents.payload} ->> 'outcome' = 'won')::int`,
      })
      .from(eventMeshEvents)
      .where(
        sql`${eventMeshEvents.channel} = 'deal:lifecycle' and ${eventMeshEvents.createdAt} > now() - (${windowHours} || ' hours')::interval`,
      );
    return { events: Number(row?.events ?? 0), closedWon: Number(row?.closedWon ?? 0) };
  } catch (err) {
    logger.warn(
      "[autopilot/senses] deal activity read failed; defaulting to 0",
      err instanceof Error ? err : undefined,
    );
    return { events: 0, closedWon: 0 };
  }
}
