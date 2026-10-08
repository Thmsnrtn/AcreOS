/**
 * Founder Autopilot — real senses gathered from live platform state.
 *
 * The brain only ever acts on senses that are genuinely measured (decide.ts).
 * This module is where the not-yet-in-the-pulse senses are read from real
 * tables — honestly, best-effort, never invented. Each loader isolates its own
 * failure and degrades to the truthful "none known" default so a single bad
 * source can't poison the decision or crash the loop.
 *
 * Currently: the support backlog (open + escalated cases AND escalated Pax
 * tickets), open data-subject requests, stalled activation, orgs in dunning,
 * and unanswered legal/compliance asks.
 */
import { sql } from "drizzle-orm";
import { db } from "../../db";
import {
  dsarRequests,
  dsarRequestsLifecycle,
  eventMeshEvents,
  organizations,
  supportCases,
  supportTickets,
} from "@shared/schema";
import { soleneFounderAsks } from "@shared/schema/solene-founder-collab";
import { unscopedForPlatformOps } from "../../utils/orgScopedDb";
import { logger } from "../../utils/logger";
import { SUPPORT_WORKER_AGENT, FOUNDER_AGENT } from "../solene/roleWorkers/routing";

/**
 * Count support cases genuinely waiting on us — status open or escalated.
 * `awaiting_user` is waiting on the customer (not our backlog); `ai_handling`
 * is in progress; resolved/closed are done. Returns 0 on any error (honest
 * default — we never fabricate a backlog).
 */
async function getOpenSupportCaseCount(): Promise<number> {
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

/**
 * Pax chat escalations live in `support_tickets` (resolution_type 'escalated'),
 * not `support_cases`. A ticket Pax handed to a human stays waiting on us until
 * it is resolved or closed. Returns the count and the oldest ticket ids so a
 * founder ask can NAME the ticket. Throws on a read error.
 */
export async function readEscalatedSupportTickets(
  limit = 5,
  opts: { excludePickedUp?: boolean } = {},
): Promise<{ count: number; ticketIds: number[] }> {
  // Stage 2: for the BRAIN's backlog, a ticket the Support worker already
  // drafted a reply for (awaiting its witness) or handed to the founder (an
  // open ask names it) is not work another support dispatch can do. The
  // step-away check still counts every escalated ticket — a human is still
  // waiting on each of them.
  const pickedUp = opts.excludePickedUp
    ? sql` and coalesce(${supportTickets.assignedAgent}, '') not in (${SUPPORT_WORKER_AGENT}, ${FOUNDER_AGENT})`
    : sql``;
  const rows = await unscopedForPlatformOps(
    "Solene founder-brain support sense: escalated Pax tickets across every org are the company's support backlog the founder must see",
  )
    .select({ id: supportTickets.id, n: sql<number>`count(*) over ()::int` })
    .from(supportTickets)
    .where(
      sql`${supportTickets.resolutionType} = 'escalated' and ${supportTickets.status} not in ('resolved', 'closed')${pickedUp}`,
    )
    .orderBy(supportTickets.createdAt)
    .limit(limit);
  return { count: Number(rows[0]?.n ?? 0), ticketIds: rows.map((r) => r.id) };
}

/** Best-effort form for the loop: honest empty on error. The step-away check uses the throwing read. */
async function getEscalatedSupportTickets(
  limit = 5,
): Promise<{ count: number; ticketIds: number[] }> {
  try {
    return await readEscalatedSupportTickets(limit, { excludePickedUp: true });
  } catch (err) {
    logger.warn(
      "[autopilot/senses] escalated ticket read failed; defaulting to 0",
      err instanceof Error ? err : undefined,
    );
    return { count: 0, ticketIds: [] };
  }
}

/**
 * The whole support backlog the brain ranks on: open/escalated support cases
 * PLUS escalated Pax tickets. Before this, only support_cases were counted, so
 * a chat escalation never reached clear_support_backlog.
 */
export async function getSupportBacklog(): Promise<{ total: number; escalatedTicketIds: number[] }> {
  const [cases, tickets] = await Promise.all([getOpenSupportCaseCount(), getEscalatedSupportTickets()]);
  return { total: cases + tickets.count, escalatedTicketIds: tickets.ticketIds };
}

/**
 * Open data-subject requests (access / erasure / portability) across both
 * intake tables: `dsar_requests` (public form) and `dsar_requests_lifecycle`
 * (in-app GDPR/privacy routes, self-tests excluded). These carry statutory
 * deadlines and are a founder-only decision (customer-data deletion is a
 * hard-stop), so they count as open compliance items. Throws on a read
 * error; getOpenDsarCount is the best-effort form.
 */
export async function readOpenDsarCount(): Promise<number> {
  const reason =
    "Solene founder-brain compliance sense: open data-subject requests across every org are a founder-only legal obligation";
  const [a] = await unscopedForPlatformOps(reason)
    .select({ n: sql<number>`count(*)::int` })
    .from(dsarRequests)
    .where(sql`${dsarRequests.status} in ('pending', 'verified', 'fulfilling')`);
  const [b] = await unscopedForPlatformOps(reason)
    .select({ n: sql<number>`count(*)::int` })
    .from(dsarRequestsLifecycle)
    .where(sql`${dsarRequestsLifecycle.fulfilledAt} is null and ${dsarRequestsLifecycle.isSelfTest} = false`);
  return Number(a?.n ?? 0) + Number(b?.n ?? 0);
}

/** Best-effort form for the loop: honest 0 on error. */
export async function getOpenDsarCount(): Promise<number> {
  try {
    return await readOpenDsarCount();
  } catch (err) {
    logger.warn(
      "[autopilot/senses] DSAR read failed; defaulting to 0",
      err instanceof Error ? err : undefined,
    );
    return 0;
  }
}

/** Activation is "stalled" for an org not onboarded this long after signup. */
const ACTIVATION_STALL_HOURS = 48;
/**
 * Only signups from this recent window count — a years-old abandoned signup is
 * not a leak the brain can still fix, and counting it would pin the sense on
 * forever.
 */
const ACTIVATION_LOOKBACK_DAYS = 30;

/**
 * Orgs that signed up more than 48h ago (within the lookback) and have still
 * not completed onboarding. Feeds `activationStalled`, which decide.ts ranks as
 * unblock_activation. Founder orgs excluded. Honest 0 on error.
 */
export async function getStalledActivationCount(): Promise<number> {
  try {
    const [row] = await unscopedForPlatformOps(
      "Solene founder-brain activation sense: counts signups across the business that never finished onboarding",
    )
      .select({ n: sql<number>`count(*)::int` })
      .from(organizations)
      .where(
        sql`coalesce(${organizations.onboardingCompleted}, false) = false
          and coalesce(${organizations.isFounder}, false) = false
          and ${organizations.createdAt} < now() - (${ACTIVATION_STALL_HOURS} || ' hours')::interval
          and ${organizations.createdAt} > now() - (${ACTIVATION_LOOKBACK_DAYS} || ' days')::interval`,
      );
    return Number(row?.n ?? 0);
  } catch (err) {
    logger.warn(
      "[autopilot/senses] activation read failed; defaulting to 0",
      err instanceof Error ? err : undefined,
    );
    return 0;
  }
}

/**
 * Orgs whose subscription payment has failed and is still unrecovered — any
 * dunning stage other than none/cancelled. THROWS on a read error: its only
 * caller is the step-away verdict, where unreadable must never read as zero.
 */
export async function readFailedPaymentOrgCount(): Promise<number> {
  const [row] = await unscopedForPlatformOps(
    "Solene founder-brain billing sense: counts orgs in dunning across the business for the step-away verdict",
  )
    .select({ n: sql<number>`count(*)::int` })
    .from(organizations)
    .where(sql`coalesce(${organizations.dunningStage}, 'none') not in ('none', 'cancelled')`);
  return Number(row?.n ?? 0);
}

/**
 * Legal/compliance founder asks still waiting on the founder — open, or timed
 * out unanswered (a timeout is not a decision). Keyed on the summary prefix the
 * support legal-intake classifier writes. Throws on a read error.
 */
export async function readPendingLegalAskCount(): Promise<number> {
  const { LEGAL_ASK_SUMMARY_PREFIX } = await import("../supportLegalIntake");
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(soleneFounderAsks)
    .where(
      sql`${soleneFounderAsks.status} in ('open', 'timed_out') and ${soleneFounderAsks.questionSummary} like ${`${LEGAL_ASK_SUMMARY_PREFIX}%`}`,
    );
  return Number(row?.n ?? 0);
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
