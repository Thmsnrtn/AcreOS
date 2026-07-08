/**
 * GET /api/today — consolidated Today-screen payload.
 *
 * Replaces the ~6 parallel client fetches the Today screen used to fan out
 * (/api/dashboard/today-priorities, /api/tasks, /api/alerts/active,
 * /api/dashboard/intelligence, /api/pax/insights, /api/pax/pax-suggestions)
 * with a single server-side gather + merge + rank. The screen can now paint
 * from one round-trip instead of waiting on the slowest of six.
 *
 * IMPORTANT — behavior-preserving: the merge + ranking here mirror exactly the
 * client-side logic that previously lived in client/src/pages/today.tsx. We
 * call the SAME storage methods and services the original endpoints used
 * (storage.getLeads/getDeals/getProperties/getNotes/getTasks, portfolioHealth,
 * the paxObservations table) — no business logic is re-invented.
 *
 * Sources merged server-side:
 *   - Pax priorities    (mirrors /api/dashboard/today-priorities)
 *   - Today's tasks     (mirrors /api/tasks, filtered to today/overdue)
 *   - Portfolio alerts  (mirrors /api/alerts/active)
 *   - Pax noticed       (mirrors /api/pax/insights observations/stale/expiring)
 *   - Pax suggests      (mirrors /api/pax/pax-suggestions)
 *   - AI action queue   (mirrors /api/dashboard/intelligence .actions)
 *
 * The Activity feed is intentionally NOT merged here: it is an independent
 * infinite-scroll surface (client/src/components/activity-feed.tsx) with its
 * own pagination, so folding it into a one-shot payload would break scroll.
 * It stays a separate client query — `activity` is returned as [] for shape
 * parity and the client renders <TodayActivityFeed /> as before.
 */

import { Router, type Response } from "express";
import { and, desc, eq, gte, gt, sql, inArray } from "drizzle-orm";
import { paxObservations, leads as leadsTable, deals as dealsTable, properties as propertiesTable, payments as paymentsTable, todayQueueState, paxSends, paxScheduledTaskRuns } from "@shared/schema";
import type { Persona } from "@shared/models/auth";
import { db, storage } from "./storage";
import { runPortfolioHealthJob, getActiveAlerts } from "./services/portfolioHealth";
import { routeAITask, TaskComplexity } from "./services/aiRouter";
import type { AuthenticatedRequest } from "./types/request";
import { getOrganization, getOrganizationId, getUserId } from "./types/request";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";

const router = Router();

const priorityRank: Record<string, number> = { high: 0, medium: 1, low: 2 };

type DecisionSource =
  | "pax-priority"
  | "pax-suggests"
  | "pax-noticed"
  | "ai-queue"
  | "portfolio-alert";

// ── Inline action (Maren CPO #2) ────────────────────────────────────────────
// The habit-loop upgrade: every queue item carries an `inlineAction` describing
// what the operator can do WITHOUT leaving Today. `resolve` items can be
// Done / Snoozed / Dismissed in place via PATCH /api/today/queue/:id. When a
// `paxDraft` target is present, Today also offers "Pax, draft the follow-up"
// (deep-link with a compose intent) — still resolving the row on use.
//
// Discriminated on `kind` so the client can render exactly the right controls:
//   - "resolve"  : Done / Snooze 3d / Dismiss (always inline-resolvable)
//   - "navigate" : link-out only (legacy behavior, no inline resolution)
type InlineAction =
  | {
      kind: "resolve";
      // Optional Pax-draft affordance for follow-up-shaped items.
      paxDraft?: { entityType: "lead" | "deal"; entityId: number };
    }
  | { kind: "navigate" };

// ── Urgency classes (Tier 3C — the ranked spine) ────────────────────────────
// Every queue item belongs to exactly one urgency class, derived from REAL
// signals at the gather site (a past-due timestamp, a dollar consequence, a
// staleness clock). Items whose builder can't honestly claim urgency default
// to "routine" — no fabricated urgency, ever.
export type QueueUrgency = "overdue" | "money" | "time" | "routine";

export const URGENCY_ORDER: Record<QueueUrgency, number> = {
  overdue: 0, // a real deadline already passed (task past due)
  money: 1,   // dollars on the table now (offer expiring, live negotiation, late note)
  time: 2,    // a real clock is running (due today, staleness window closing)
  routine: 3, // everything else — honest default
};

interface DecisionItem {
  id: string;
  source: DecisionSource;
  priority: "high" | "medium" | "low";
  title: string;
  description: string;
  actionLabel: string;
  actionUrl: string;
  rank: number;
  confidence?: number | null;
  inlineAction?: InlineAction;
  // Urgency class set by the gather site that owns the underlying signal.
  // Absent → classified "routine" by the comparator (never upgraded).
  urgency?: QueueUrgency;
}

/** Honest classification: an item is only as urgent as its builder could prove. */
export function classifyUrgency(item: Pick<DecisionItem, "urgency">): QueueUrgency {
  return item.urgency ?? "routine";
}

/**
 * The one ranking function for the Today queue (Tier 3C). Explainable order:
 *   1. urgency class — overdue → money-touching → time-sensitive → routine
 *   2. priority      — high → medium → low (within a class)
 *   3. rank          — the legacy per-source ordinal (stable within-class tiebreak)
 *   4. id            — lexicographic, so the full order is deterministic
 */
export function compareQueueItems(
  a: Pick<DecisionItem, "urgency" | "priority" | "rank" | "id">,
  b: Pick<DecisionItem, "urgency" | "priority" | "rank" | "id">,
): number {
  const ua = URGENCY_ORDER[classifyUrgency(a)];
  const ub = URGENCY_ORDER[classifyUrgency(b)];
  if (ua !== ub) return ua - ub;
  const pa = priorityRank[a.priority] ?? 1;
  const pb = priorityRank[b.priority] ?? 1;
  if (pa !== pb) return pa - pb;
  if (a.rank !== b.rank) return a.rank - b.rank;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

// Snooze duration for the "Snooze 3d" inline action (Maren CPO #2).
const SNOOZE_DAYS = 3;

const alertHrefByType: Record<string, string> = {
  note_overdue: "/money",
  stale_leads: "/pipeline#leads",
  stuck_deals: "/pipeline#board",
  stale_avm: "/pipeline#properties",
};

const alertLinkLabelByType: Record<string, string> = {
  note_overdue: "View notes",
  stale_leads: "View leads",
  stuck_deals: "View deals",
  stale_avm: "View properties",
};

const DAY_MS = 24 * 60 * 60 * 1000;
function daysAgo(days: number, from: Date) {
  return new Date(from.getTime() - days * DAY_MS);
}

// ── Inline-action derivation (Maren CPO #2) ─────────────────────────────────
// Every queue item is now inline-resolvable (Done / Snooze / Dismiss). On TOP
// of that, follow-up-shaped items get a "Pax, draft the follow-up" affordance
// when we can extract the underlying lead/deal id from the synthetic item id.
//
// The synthetic ids the queue builder emits and the lead id they carry:
//   stale-lead-<leadId>        (pax-noticed)
//   ai-follow-up-<leadId>      (ai-queue)
//   suggest-stale-<leadId>     (pax-suggests)
//   suggest-obs-<obsId>        (observation — no direct lead id; resolve-only)
// We parse a trailing integer ONLY for the known follow-up prefixes — never
// fabricate a target for items whose id doesn't carry a real entity id.
const FOLLOW_UP_LEAD_ID_PREFIXES = ["stale-lead-", "ai-follow-up-", "suggest-stale-"];

export function deriveInlineAction(item: Pick<DecisionItem, "id">): InlineAction {
  for (const prefix of FOLLOW_UP_LEAD_ID_PREFIXES) {
    if (item.id.startsWith(prefix)) {
      const raw = item.id.slice(prefix.length);
      const leadId = Number.parseInt(raw, 10);
      if (Number.isFinite(leadId) && leadId > 0) {
        return { kind: "resolve", paxDraft: { entityType: "lead", entityId: leadId } };
      }
    }
  }
  // Everything else is still resolvable in place — just no Pax-draft shortcut.
  return { kind: "resolve" };
}

// ── Inline-resolution state machine (Maren CPO #2) ──────────────────────────
// The two pure halves of the resolver, extracted for direct unit testing:
//   • resolveActionToState: the PATCH body's action → persisted (status,
//     snoozedUntil). "snooze" hides for SNOOZE_DAYS; done/dismiss are permanent.
//   • isQueueItemHidden: given a persisted state row + now, should the GET
//     payload subtract this item? done/dismissed always; snoozed only while the
//     snooze window is still in the future (so the item re-surfaces after).
export type ResolveAction = "done" | "snooze" | "dismiss";
export interface QueueResolveState {
  status: string;
  snoozedUntil: Date | null;
}

export function resolveActionToState(action: ResolveAction, now: Date): QueueResolveState {
  if (action === "snooze") {
    return { status: "snoozed", snoozedUntil: new Date(now.getTime() + SNOOZE_DAYS * DAY_MS) };
  }
  return { status: action === "done" ? "done" : "dismissed", snoozedUntil: null };
}

export function isQueueItemHidden(
  state: { status: string; snoozedUntil: Date | string | null } | undefined,
  now: Date,
): boolean {
  if (!state) return false;
  if (state.status === "done" || state.status === "dismissed") return true;
  if (state.status === "snoozed") {
    return !!state.snoozedUntil && new Date(state.snoozedUntil).getTime() > now.getTime();
  }
  return false;
}

// ── Receipts (Tier 3C) — "what Pax/the system DID while you were away" ──────
// Every receipt is derived from real rows (pax_sends, completed payments,
// successful pax_scheduled_task_runs). No rows → empty array → the client
// renders nothing. Receipts are COMPLETED events only; attention-needing
// items belong in the queue, not here.
//
// Deliberately EXCLUDED: outbound_email_log lifecycle mail. Those rows are
// real, but they're mail sent TO the operator (welcome, trial-ending) — the
// operator already has them in their own inbox, so surfacing them as "work
// done for you" would be padding, not a receipt.
export interface ReceiptItem {
  id: string;
  label: string;
  count: number;
  /** ISO timestamp of the most recent underlying row. */
  latestAt: string | null;
  /** Door-relative deep link to where the evidence lives. */
  href: string;
}

interface ReceiptsInput {
  sends: Array<{ id: number; channel: string; sentAt: Date | string | null }>;
  payments: Array<{ id: number; amount: string | number | null; processedAt: Date | string | null }>;
  /** Successful pax_scheduled_task_runs rows (the "jobs" receipt source). */
  taskRuns?: Array<{ id: number; runAt: Date | string | null }>;
}

function latestIso(stamps: Array<Date | string | null>): string | null {
  let max = -Infinity;
  for (const s of stamps) {
    if (!s) continue;
    const t = new Date(s).getTime();
    if (Number.isFinite(t) && t > max) max = t;
  }
  return max === -Infinity ? null : new Date(max).toISOString();
}

const SEND_CHANNEL_NOUNS: Record<string, [string, string]> = {
  email: ["follow-up email", "follow-up emails"],
  sms: ["text", "texts"],
};

export function deriveReceipts(input: ReceiptsInput): ReceiptItem[] {
  const receipts: ReceiptItem[] = [];

  // Witnessed sends, grouped by channel — each group traces to pax_sends rows.
  const byChannel = new Map<string, Array<Date | string | null>>();
  for (const s of input.sends) {
    const channel = s.channel || "other";
    const arr = byChannel.get(channel) ?? [];
    arr.push(s.sentAt);
    byChannel.set(channel, arr);
  }
  for (const [channel, stamps] of byChannel) {
    const nouns = SEND_CHANNEL_NOUNS[channel] ?? ["send", "sends"];
    const count = stamps.length;
    receipts.push({
      id: `sends-${channel}`,
      label: `Pax sent ${count} ${count === 1 ? nouns[0] : nouns[1]}`,
      count,
      latestAt: latestIso(stamps),
      // The Pax door is /ai (/pax is a legacy redirect — skip the hop).
      href: "/ai",
    });
  }

  // Scheduled jobs that ran — traces to pax_scheduled_task_runs rows with
  // status "success". Failed runs are NOT receipts (nothing got done).
  if (input.taskRuns && input.taskRuns.length > 0) {
    const count = input.taskRuns.length;
    receipts.push({
      id: "task-runs",
      label: `Pax ran ${count} scheduled ${count === 1 ? "task" : "tasks"}`,
      count,
      latestAt: latestIso(input.taskRuns.map((r) => r.runAt)),
      href: "/ai",
    });
  }

  // Completed payments — traces to payments rows with status "completed".
  if (input.payments.length > 0) {
    const total = input.payments.reduce(
      (sum, p) => sum + (parseFloat(String(p.amount ?? "0") || "0") || 0),
      0,
    );
    const count = input.payments.length;
    receipts.push({
      id: "payments-posted",
      label: `${count} ${count === 1 ? "payment" : "payments"} posted — $${Math.round(total).toLocaleString("en-US")}`,
      count,
      latestAt: latestIso(input.payments.map((p) => p.processedAt)),
      href: "/money",
    });
  }

  // Most recent activity first; null timestamps sink. Deterministic via id tiebreak.
  receipts.sort((a, b) => {
    const ta = a.latestAt ? new Date(a.latestAt).getTime() : -Infinity;
    const tb = b.latestAt ? new Date(b.latestAt).getTime() : -Infinity;
    if (ta !== tb) return tb - ta;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return receipts;
}

// ── Receipts window + user-local day boundary (Tier 3C) ─────────────────────
// The client sends `since` (epoch ms of its last recorded visit) and `tz`
// (minutes, Date#getTimezoneOffset). Both are advisory; the server clamps.
const RECEIPTS_MIN_WINDOW_MS = 12 * 60 * 60 * 1000; // always show at least "overnight"
const RECEIPTS_MAX_WINDOW_MS = 7 * DAY_MS;           // never dig further than a week

export function clampReceiptsSince(sinceMs: number | undefined, now: Date): Date {
  const floor = now.getTime() - RECEIPTS_MAX_WINDOW_MS;
  const ceil = now.getTime() - RECEIPTS_MIN_WINDOW_MS;
  const requested = Number.isFinite(sinceMs) ? (sinceMs as number) : ceil;
  return new Date(Math.min(Math.max(requested, floor), ceil));
}

/**
 * Start of the user's local calendar day. `tzOffsetMin` is the value of
 * Date#getTimezoneOffset() in the user's browser (positive west of UTC).
 * Falls back to the server's local midnight when absent/invalid.
 */
export function startOfUserDay(now: Date, tzOffsetMin: number | undefined): Date {
  const offset = Number.isFinite(tzOffsetMin) ? (tzOffsetMin as number) : now.getTimezoneOffset();
  const shifted = new Date(now.getTime() - offset * 60_000);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() + offset * 60_000);
}

function isOverdue(due: Date, now: Date) {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return due < startOfToday;
}
function isTodayOrOverdue(due: Date, now: Date) {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfTomorrow = new Date(startOfToday.getTime() + DAY_MS);
  return due < startOfTomorrow;
}

// ── Pax priorities: mirrors /api/dashboard/today-priorities ────────────────
async function gatherPaxPriorities(orgId: number, now: Date): Promise<DecisionItem[]> {
  const [unscoredLeads, staleFollowUps, campaignFreshness] = await Promise.allSettled([
    db.select({ count: sql<number>`COUNT(*)` })
      .from(leadsTable)
      .where(and(
        eq(leadsTable.organizationId, orgId),
        sql`status NOT IN ('closed', 'dead', 'converted')`,
        sql`(score IS NULL OR last_score_at IS NULL)`,
      )),
    db.select({ count: sql<number>`COUNT(*)` })
      .from(leadsTable)
      .where(and(
        eq(leadsTable.organizationId, orgId),
        sql`status NOT IN ('closed', 'dead', 'converted')`,
        sql`(last_contacted_at IS NULL OR last_contacted_at < ${daysAgo(28, now).toISOString()})`,
      )),
    db.select({ lastSent: sql<string>`MAX(created_at)` })
      .from(sql`campaigns`)
      .where(sql`organization_id = ${orgId}`),
  ]);

  const unscoredCount = unscoredLeads.status === "fulfilled" ? Number(unscoredLeads.value[0]?.count) || 0 : 0;
  const staleCount = staleFollowUps.status === "fulfilled" ? Number(staleFollowUps.value[0]?.count) || 0 : 0;
  const lastSent = campaignFreshness.status === "fulfilled" ? campaignFreshness.value[0]?.lastSent : null;
  const lastCampaignDaysAgo = lastSent
    ? Math.floor((now.getTime() - new Date(lastSent).getTime()) / DAY_MS)
    : 999;

  type Priority = { id: string; priority: "high" | "medium" | "low"; title: string; description: string; actionLabel: string; actionUrl: string };
  const priorities: Priority[] = [];

  if (unscoredCount > 0) {
    priorities.push({
      id: "score-leads",
      priority: "high",
      title: `Score ${unscoredCount} unscored lead${unscoredCount !== 1 ? "s" : ""}`,
      description: `You have ${unscoredCount} lead${unscoredCount !== 1 ? "s" : ""} awaiting AcreScore™ analysis. Scored leads convert 3× faster — don't leave them cold.`,
      actionLabel: "Score Now",
      actionUrl: "/leads?filter=unscored",
    });
  }
  if (staleCount > 0) {
    priorities.push({
      id: "follow-up",
      priority: staleCount > 10 ? "high" : "medium",
      title: `Follow up with ${Math.min(staleCount, 5)} seller${staleCount > 1 ? "s" : ""} who haven't responded`,
      description: `${staleCount} lead${staleCount !== 1 ? "s" : ""} haven't been contacted in 28+ days. Consistent follow-up is the key to conversion.`,
      actionLabel: "View Stale Leads",
      actionUrl: "/leads?filter=stale",
    });
  }
  if (lastCampaignDaysAgo > 45) {
    priorities.push({
      id: "send-campaign",
      priority: lastCampaignDaysAgo > 60 ? "high" : "medium",
      title: `Send a direct mail campaign — you haven't mailed in ${Math.min(lastCampaignDaysAgo, 90)}+ days`,
      description: "The mailer that goes out today is the passive income that arrives next quarter. Keep your pipeline full.",
      actionLabel: "Plan Campaign",
      actionUrl: "/campaigns",
    });
  }
  if (priorities.length === 0) {
    priorities.push({
      id: "county-snapshot",
      priority: "medium",
      title: "Check your primary county intelligence snapshot",
      description: "Review USDA land values, migration signals, and opportunity score for your target county.",
      actionLabel: "View County Data",
      actionUrl: "/data-intelligence",
    });
  }
  if (priorities.length < 2) {
    priorities.push({
      id: "review-pipeline",
      priority: "low",
      title: "Review your deal pipeline for stuck deals",
      description: "Deals that haven't moved in 14+ days often need a nudge. Check your pipeline board.",
      actionLabel: "View Pipeline",
      actionUrl: "/pipeline",
    });
  }
  if (priorities.length < 3) {
    priorities.push({
      id: "evening-review",
      priority: "low",
      title: "Review your passive income progress tonight",
      description: "Open the Evening Review dashboard to see today's note payments, freedom meter progress, and tomorrow's one thing.",
      actionLabel: "Open Evening Review",
      actionUrl: "/evening-review",
    });
  }

  return priorities.slice(0, 3).map((p, idx) => ({
    id: `priority-${p.id}`,
    source: "pax-priority" as const,
    priority: p.priority,
    title: p.title,
    description: p.description,
    actionLabel: p.actionLabel,
    actionUrl: p.actionUrl,
    rank: idx,
    // Only the stale-follow-up priority sits on a real clock (28-day silence
    // window). Scoring/campaign/review prompts are honest routine.
    urgency: (p.id === "follow-up" ? "time" : "routine") as QueueUrgency,
  }));
}

// ── Pax noticed: mirrors /api/pax/insights (observations/stale/expiring) ───
async function gatherPaxNoticed(orgId: number, now: Date): Promise<DecisionItem[]> {
  const items: DecisionItem[] = [];

  // Observations (status=detected), re-sorted by severity then recency, top 10.
  const rawObservations = await db
    .select({
      id: paxObservations.id,
      severity: paxObservations.severity,
      title: paxObservations.title,
      description: paxObservations.description,
      createdAt: paxObservations.createdAt,
    })
    .from(paxObservations)
    .where(and(
      eq(paxObservations.organizationId, orgId),
      eq(paxObservations.status, "detected"),
    ))
    .orderBy(desc(paxObservations.createdAt))
    .limit(50);

  const severityRank: Record<string, number> = { high: 3, medium: 2, low: 1, info: 0 };
  rawObservations
    .sort((a, b) => {
      const rankDiff = (severityRank[b.severity] ?? 0) - (severityRank[a.severity] ?? 0);
      if (rankDiff !== 0) return rankDiff;
      return new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime();
    })
    .slice(0, 10)
    .forEach((obs) => {
      const sev: "high" | "medium" | "low" =
        obs.severity === "high" ? "high" : obs.severity === "medium" ? "medium" : "low";
      items.push({
        id: `obs-${obs.id}`,
        source: "pax-noticed",
        priority: sev,
        title: obs.title,
        description: obs.description,
        actionLabel: "Review",
        actionUrl: "/pax#insights",
        rank: 300 + priorityRank[sev],
        // High-severity observations carry a real degradation signal; the
        // rest are informational → routine.
        urgency: sev === "high" ? "time" : "routine",
      });
    });

  // Stale leads: not contacted in > 21 days.
  const twentyOneDaysAgo = daysAgo(21, now);
  const allActiveLeads = await db
    .select({
      id: leadsTable.id,
      firstName: leadsTable.firstName,
      lastName: leadsTable.lastName,
      lastContactedAt: leadsTable.lastContactedAt,
      status: leadsTable.status,
      doNotContact: leadsTable.doNotContact,
    })
    .from(leadsTable)
    .where(eq(leadsTable.organizationId, orgId));

  allActiveLeads
    .filter((l) => {
      if (l.status === "closed" || l.status === "dead") return false;
      if (l.doNotContact) return false;
      if (!l.lastContactedAt) return true;
      return new Date(l.lastContactedAt).getTime() < twentyOneDaysAgo.getTime();
    })
    .map((l) => ({
      id: l.id,
      firstName: l.firstName,
      lastName: l.lastName,
      daysSinceContact: l.lastContactedAt
        ? Math.floor((now.getTime() - new Date(l.lastContactedAt).getTime()) / DAY_MS)
        : 999,
    }))
    .sort((a, b) => b.daysSinceContact - a.daysSinceContact)
    .forEach((lead) => {
      items.push({
        id: `stale-lead-${lead.id}`,
        source: "pax-noticed",
        priority: "medium",
        title: `${lead.firstName} ${lead.lastName} hasn't been contacted`,
        description: lead.daysSinceContact >= 999
          ? "Never contacted"
          : `${lead.daysSinceContact} days since last contact`,
        actionLabel: "Follow up",
        actionUrl: "/leads",
        rank: 310,
        // Backed by a real lastContactedAt staleness clock (21+ days).
        urgency: "time",
      });
    });

  // Expiring offers: deals with offerDate within the last 72 hours.
  const seventyTwoHoursAgo = new Date(now.getTime() - 72 * 60 * 60 * 1000);
  const recentDeals = await db
    .select({
      id: dealsTable.id,
      propertyId: dealsTable.propertyId,
      offerDate: dealsTable.offerDate,
    })
    .from(dealsTable)
    .where(and(
      eq(dealsTable.organizationId, orgId),
      gte(dealsTable.offerDate, seventyTwoHoursAgo),
    ))
    .orderBy(desc(dealsTable.offerDate));

  const propertyIds = [...new Set(recentDeals.map((d) => d.propertyId).filter(Boolean))];
  const propertyMap: Record<number, string> = {};
  if (propertyIds.length > 0) {
    const props = await db
      .select({ id: propertiesTable.id, address: propertiesTable.address })
      .from(propertiesTable)
      .where(eq(propertiesTable.organizationId, orgId));
    for (const p of props) {
      if (propertyIds.includes(p.id)) {
        propertyMap[p.id] = p.address ?? `Property #${p.id}`;
      }
    }
  }

  recentDeals.forEach((d) => {
    const title = propertyMap[d.propertyId] ?? `Deal #${d.id}`;
    const offerExpiresAt = d.offerDate
      ? new Date(new Date(d.offerDate).getTime() + 72 * 60 * 60 * 1000)
      : null;
    items.push({
      id: `expiring-offer-${d.id}`,
      source: "pax-noticed",
      priority: "high",
      title,
      description: `Offer expires ${offerExpiresAt
        ? offerExpiresAt.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
        : "soon"}`,
      actionLabel: "View deal",
      actionUrl: "/deals",
      rank: 250,
      // A live offer with a 72-hour clock is money on the table.
      urgency: "money",
    });
  });

  return items;
}

// ── Pax suggests: mirrors /api/pax/pax-suggestions ─────────────────────────
async function gatherPaxSuggests(orgId: number, now: Date): Promise<DecisionItem[]> {
  const seventyTwoHoursAgo = new Date(now.getTime() - 72 * 60 * 60 * 1000);

  const recentObs = await db
    .select({
      id: paxObservations.id,
      type: paxObservations.type,
      title: paxObservations.title,
      description: paxObservations.description,
      confidenceScore: paxObservations.confidenceScore,
      metadata: paxObservations.metadata,
    })
    .from(paxObservations)
    .where(and(
      eq(paxObservations.organizationId, orgId),
      eq(paxObservations.status, "detected"),
      gte(paxObservations.detectedAt, seventyTwoHoursAgo),
      gt(paxObservations.confidenceScore, 70),
    ))
    .orderBy(desc(paxObservations.confidenceScore), desc(paxObservations.detectedAt))
    .limit(20);

  type Suggestion = {
    id: string; suggestion: string; rationale: string; actionLabel: string; actionUrl: string; confidence: number;
  };
  const suggestions: Suggestion[] = [];

  for (const obs of recentObs) {
    if (suggestions.length >= 3) break;
    const confidence = (obs.confidenceScore ?? 0) / 100;
    const entityId = (obs.metadata as any)?.relatedEntityId;
    let actionLabel = "Review";
    let actionUrl = "/today";
    if (obs.type === "activity_drop" || obs.type === "anomaly") {
      actionLabel = "Create Task"; actionUrl = "/pipeline";
    } else if (obs.type === "opportunity" || obs.type === "optimization") {
      actionLabel = "View Lead"; actionUrl = entityId ? `/leads?highlight=${entityId}` : "/leads";
    } else if (obs.type === "quota_warning" || obs.type === "performance") {
      actionLabel = "View Analytics"; actionUrl = "/analytics";
    } else if (obs.type === "data_issue" || obs.type === "error_pattern") {
      actionLabel = "Review"; actionUrl = "/settings";
    } else if (obs.type === "usage_spike") {
      actionLabel = "View Dashboard"; actionUrl = "/";
    }
    suggestions.push({
      id: `obs-${obs.id}`,
      suggestion: obs.title,
      rationale: obs.description,
      actionLabel,
      actionUrl,
      confidence,
    });
  }

  // Fill remaining slots from stale leads (up to 3 total).
  if (suggestions.length < 3) {
    const twentyOneDaysAgo = daysAgo(21, now);
    const staleLeads = await db
      .select({
        id: leadsTable.id,
        firstName: leadsTable.firstName,
        lastName: leadsTable.lastName,
        lastContactedAt: leadsTable.lastContactedAt,
        status: leadsTable.status,
        email: leadsTable.email,
      })
      .from(leadsTable)
      .where(eq(leadsTable.organizationId, orgId))
      .orderBy(leadsTable.lastContactedAt)
      .limit(50);

    const staleFiltered = staleLeads
      .filter((l) => {
        if (["closed", "dead"].includes(l.status ?? "")) return false;
        if (!l.lastContactedAt) return true;
        return new Date(l.lastContactedAt).getTime() < twentyOneDaysAgo.getTime();
      })
      .slice(0, 5);

    for (const lead of staleFiltered) {
      if (suggestions.length >= 3) break;
      const daysSince = lead.lastContactedAt
        ? Math.floor((now.getTime() - new Date(lead.lastContactedAt).getTime()) / DAY_MS)
        : null;
      const daysText = daysSince != null ? `${daysSince} days ago` : "never";
      suggestions.push({
        id: `stale-${lead.id}`,
        suggestion: `Follow up with ${lead.firstName} ${lead.lastName}`,
        rationale: `Last contacted ${daysText}. Re-engaging stale leads improves conversion rates.`,
        actionLabel: lead.email ? "Send Email" : "Create Task",
        actionUrl: `/leads?highlight=${lead.id}`,
        confidence: 0.82,
      });
    }
  }

  return suggestions.slice(0, 3).map((s) => ({
    id: `suggest-${s.id}`,
    source: "pax-suggests" as const,
    priority: s.confidence >= 0.85 ? "high" : s.confidence >= 0.7 ? "medium" : "low",
    title: s.suggestion,
    description: s.rationale,
    actionLabel: s.actionLabel,
    actionUrl: s.actionUrl,
    rank: 400 + (1 - s.confidence) * 10,
    confidence: s.confidence,
    // Stale-lead suggestions ride a real 21-day silence clock; observation
    // suggestions are opportunities, not deadlines → routine.
    urgency: (s.id.startsWith("stale-") ? "time" : "routine") as QueueUrgency,
  }));
}

// ── AI action queue: mirrors the .actions slice of /api/dashboard/intelligence
async function gatherAiQueue(
  orgId: number,
  now: Date,
  allLeads: Awaited<ReturnType<typeof storage.getLeads>>,
  allDeals: Awaited<ReturnType<typeof storage.getDeals>>,
  allProperties: Awaited<ReturnType<typeof storage.getProperties>>,
): Promise<DecisionItem[]> {
  type Action = { id: string; priority: "high" | "medium" | "low"; title: string; description: string; actionLabel: string; actionUrl: string };
  const actions: Action[] = [];

  const staleLeads = allLeads
    .filter((l) => {
      if (l.status === "closed" || l.status === "dead" || l.doNotContact) return false;
      if (!l.lastContactedAt) return true;
      const days = Math.floor((now.getTime() - new Date(l.lastContactedAt).getTime()) / DAY_MS);
      return days >= 7;
    })
    .sort((a, b) => {
      const da = a.lastContactedAt ? Math.floor((now.getTime() - new Date(a.lastContactedAt).getTime()) / DAY_MS) : 999;
      const dbb = b.lastContactedAt ? Math.floor((now.getTime() - new Date(b.lastContactedAt).getTime()) / DAY_MS) : 999;
      return dbb - da;
    })
    .slice(0, 3);

  for (const lead of staleLeads) {
    const daysSinceContact = lead.lastContactedAt
      ? Math.floor((now.getTime() - new Date(lead.lastContactedAt).getTime()) / DAY_MS)
      : null;
    actions.push({
      id: `follow-up-${lead.id}`,
      priority: daysSinceContact && daysSinceContact > 14 ? "high" : "medium",
      title: `Follow up with ${lead.firstName} ${lead.lastName}`,
      description: daysSinceContact ? `Last contact ${daysSinceContact} days ago` : "Never contacted",
      actionLabel: "View Lead",
      actionUrl: "/leads",
    });
  }

  const pendingDeals = allDeals
    .filter((d) => d.status === "offer_sent" || d.status === "negotiating")
    .slice(0, 2);
  for (const deal of pendingDeals) {
    const property = allProperties.find((p) => p.id === deal.propertyId);
    const propertyName = property?.address || `Property #${deal.propertyId}`;
    const daysSinceOffer = deal.offerDate
      ? Math.floor((now.getTime() - new Date(deal.offerDate).getTime()) / DAY_MS)
      : null;
    actions.push({
      id: `review-deal-${deal.id}`,
      priority: daysSinceOffer && daysSinceOffer > 5 ? "high" : "medium",
      title: `Review offer on ${propertyName}`,
      description: deal.status === "offer_sent" ? "Awaiting seller response" : "In negotiation",
      actionLabel: "View Deal",
      actionUrl: "/deals",
    });
  }

  const pendingProperties = allProperties
    .filter((p) => p.status === "listed" && p.updatedAt)
    .sort((a, b) => new Date(a.updatedAt!).getTime() - new Date(b.updatedAt!).getTime())
    .slice(0, 2);
  for (const property of pendingProperties) {
    const daysListed = property.updatedAt
      ? Math.floor((now.getTime() - new Date(property.updatedAt).getTime()) / DAY_MS)
      : 0;
    if (daysListed > 30) {
      actions.push({
        id: `property-${property.id}`,
        priority: daysListed > 60 ? "high" : "medium",
        title: `Review listing for ${property.address || `Property #${property.id}`}`,
        description: `Listed for ${daysListed} days without a sale`,
        actionLabel: "View Property",
        actionUrl: "/properties",
      });
    }
  }

  actions.sort((a, b) => priorityRank[a.priority] - priorityRank[b.priority]);

  return actions.slice(0, 5).map((a) => ({
    id: `ai-${a.id}`,
    source: "ai-queue" as const,
    priority: a.priority,
    title: a.title,
    description: a.description,
    actionLabel: a.actionLabel,
    actionUrl: a.actionUrl,
    rank: 500 + priorityRank[a.priority],
    // review-deal-* = a live offer/negotiation (money on the table);
    // follow-up-* = real 7+/14+ day contact staleness (time-sensitive);
    // stale listings get no manufactured clock → routine.
    urgency: (a.id.startsWith("review-deal-")
      ? "money"
      : a.id.startsWith("follow-up-")
        ? "time"
        : "routine") as QueueUrgency,
  }));
}

// ── MorningBrief composer (Chesky) ──────────────────────────────────────────
// One-sentence persona-typed brief rendered above the Decision Queue.
//
// Today this is a static template per persona, fed by counts the route is
// already gathering (queue items, alerts, late notes, cash position). The
// surface is intentionally a single paragraph so we can swap the composer
// for an LLM call later without touching the client.
//
// First-close prefix: when the org has at least one closed deal, prefix the
// brief with "Since the {address-short} deal — " (Chesky's compounding-empathy
// move). Source: the earliest deal with status === "closed" (or "won"), joined
// in-memory to its property's address. No extra round-trip; the caller already
// has allDeals + allProperties loaded.
interface BriefInputs {
  paxReplies: number;       // pax-noticed/suggests count (proxy for "sellers replied")
  topCounter: string | null; // best Pax-priority headline if present
  curbSaves: number;         // portfolio alerts touched today
  lateNotes: number;
  netInflow30: number;       // projected 30-day net (from cash strip)
  staleLeads: number;
  pipelineValue: number;
  firstClosePrefix?: string | null; // e.g. "Since the 4218 Cactus deal — "
}

// Strip an address down to a memorable short form: number + street name.
// "4218 W Cactus Rd, Phoenix, AZ 85021" → "4218 W Cactus". Conservative —
// returns the full first comma-segment when parsing is uncertain.
function shortAddressLabel(address: string | null | undefined): string | null {
  if (!address) return null;
  const head = address.split(",")[0]?.trim();
  if (!head) return null;
  // Drop a trailing street-type suffix (Rd / Ave / St / Blvd / Ln / Dr / Way / Ct / Pl).
  const suffixRe = /\s+(rd|road|ave|avenue|st|street|blvd|boulevard|ln|lane|dr|drive|way|ct|court|pl|place|hwy|highway|pkwy|parkway|ter|terrace|cir|circle)\.?$/i;
  return head.replace(suffixRe, "").trim() || head;
}

interface FirstCloseDealLike {
  status?: string | null;
  propertyId?: number | null;
  closingDate?: Date | string | null;
  updatedAt?: Date | string | null;
}
interface FirstClosePropertyLike {
  id: number;
  address?: string | null;
}

// Return the earliest closed deal's short property label, or null if none.
// Prefers closingDate; falls back to updatedAt when closingDate is missing.
function deriveFirstClosePrefix(
  deals: FirstCloseDealLike[],
  properties: FirstClosePropertyLike[],
): string | null {
  const closed = deals.filter(
    (d) => d.status === "closed" || d.status === "won",
  );
  if (closed.length === 0) return null;

  const sortKey = (d: FirstCloseDealLike): number => {
    const ts = d.closingDate ?? d.updatedAt;
    if (!ts) return Number.POSITIVE_INFINITY;
    const t = new Date(ts).getTime();
    return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
  };
  closed.sort((a, b) => sortKey(a) - sortKey(b));
  const first = closed[0];
  if (!first.propertyId) return null;

  const prop = properties.find((p) => p.id === first.propertyId);
  const label = shortAddressLabel(prop?.address ?? null);
  if (!label) return null;
  return `Since the ${label} deal — `;
}

function composeBrief(persona: Persona | undefined, inputs: BriefInputs): string {
  const {
    paxReplies,
    topCounter,
    curbSaves,
    lateNotes,
    netInflow30,
    staleLeads,
    pipelineValue,
    firstClosePrefix,
  } = inputs;
  const money = (n: number) =>
    `$${Math.round(n).toLocaleString("en-US")}`;
  // Loss-frame templates: every persona gets at least one verb that's only
  // theirs (Chesky), and the second clause names what would have been LOST
  // (Joanna's loss-frame) instead of a flat count. The topCounter, when
  // present, is inlined as the deal headline rather than appended as a
  // separate sentence, so the brief reads like one operator talking to
  // another.
  const counterInline = topCounter ? ` — ${topCounter}` : "";
  const prefix = firstClosePrefix ?? "";

  const body = (() => {
  switch (persona) {
    case "wholesaler":
      // Wholesalers don't have leads, they have a phone that won't stop ringing.
      // Verbs: "wrote back", "almost lost", "saved".
      return `${paxReplies} seller${paxReplies === 1 ? "" : "s"} wrote back overnight${counterInline}. ${curbSaves} you almost lost yesterday, saved.`;
    case "note_investor":
      // Note investors have a tape that hits Tuesday morning.
      // Verbs: "wobbled", "tape clears".
      return `${lateNotes} note${lateNotes === 1 ? "" : "s"} wobbled overnight${counterInline} — the tape still clears ${money(netInflow30)} this month.`;
    case "note_originator":
      // Originators draw new paper; their verb is "underwrote / funded".
      return `${lateNotes} note${lateNotes === 1 ? "" : "s"} slipped overnight${counterInline} — funded paper still pencils ${money(netInflow30)} this month.`;
    case "note_servicer":
      // Servicers process payments; their verb is "posted".
      return `${lateNotes} payment${lateNotes === 1 ? "" : "s"} didn't post overnight${counterInline} — Pax posted the rest, ${money(netInflow30)} cleared this month.`;
    case "land_investor":
      // Land investors hunt parcels; their verb is "surfaced".
      return `Pax surfaced ${paxReplies} parcel${paxReplies === 1 ? "" : "s"} overnight${counterInline}. ${staleLeads} you'd otherwise lose to the 21-day silence, still warm.`;
    case "fix_flipper":
      // Flippers run jobs; their verb is "swung" (as in swinging hammers / jobs in flight).
      return `${paxReplies} project update${paxReplies === 1 ? "" : "s"} swung in overnight${counterInline} — ${money(pipelineValue)} on the table this week.`;
    case "landlord":
      // Landlords collect rent; verb is "landed".
      return `${lateNotes} rent${lateNotes === 1 ? "" : "s"} hadn't landed by 6am${counterInline} — ${money(netInflow30)} still pacing for the month.`;
    case "subdivider":
      // Subdividers split parcels; verb is "splits".
      return `${paxReplies} new split candidate${paxReplies === 1 ? "" : "s"} from Pax overnight${counterInline}. ${curbSaves} parcel${curbSaves === 1 ? "" : "s"} you almost let cool, kept warm.`;
    case "tax_delinquent":
      // Tax-delinquent buyers chase the auction calendar; verb is "ticked over".
      return `${paxReplies} delinquency${paxReplies === 1 ? "" : "s"} ticked over overnight${counterInline} — ${staleLeads} you'd lose to the redemption window, still in reach.`;
    default:
      // Neutral fallback if persona is missing or unrecognized.
      if (paxReplies + curbSaves + lateNotes === 0) {
        return "Quiet morning — nothing urgent from Pax. Good time to plan the next move.";
      }
      return `${paxReplies} Pax signal${paxReplies === 1 ? "" : "s"} overnight${counterInline}. ${curbSaves} you almost lost yesterday, saved.`;
  }
  })();

  return `${prefix}${body}`;
}

// ── Pax-composed brief (Karpathy + Chesky upgrade) ──────────────────────────
// Feature-flagged. When PAX_COMPOSED_BRIEF is "1"/"true", routes the brief
// through Pax via aiRouter (MODEL_SIMPLE / deepseek by default — cheap).
// Falls back to the static template on quota exceeded, network/parse error,
// empty response, or when the flag is off. Never throws to the caller.
//
// Cost envelope at deepseek pricing: ~$0.001–0.003 per generation, capped
// by the per-org daily AI quota the aiRouter already enforces.
// Caching: aiRouter's content-hash cache catches re-renders when inputs
// haven't moved, so the typical Today re-fetch is free.
const PAX_COMPOSED_BRIEF_ENABLED = (() => {
  const v = process.env.PAX_COMPOSED_BRIEF;
  return v === "1" || v === "true";
})();

const PERSONA_LABELS: Record<string, string> = {
  wholesaler: "a land wholesaler",
  note_investor: "a note investor",
  note_originator: "a note originator",
  note_servicer: "a note servicer",
  land_investor: "a land flipper",
  fix_flipper: "a fix-and-flip investor",
  landlord: "a buy-and-hold landlord",
  subdivider: "a parcel subdivider",
  tax_delinquent: "a tax-delinquent auction buyer",
};

async function composeBriefWithPax(
  persona: Persona | undefined,
  inputs: BriefInputs,
  orgId: number,
): Promise<string | null> {
  if (!PAX_COMPOSED_BRIEF_ENABLED) return null;

  const personaLabel = (persona && PERSONA_LABELS[persona]) ?? "a Land Investor";
  const prefix = inputs.firstClosePrefix ?? "";

  const system =
    `You are Pax, the AcreOS assistant. Write a single-sentence morning brief for ${personaLabel}. ` +
    `Use only the numbers given — do not invent. Calm, specific, no exclamation marks, no emoji, no greeting. ` +
    `Max 25 words. Tone: warm but exacting. ` +
    (prefix
      ? `Your sentence MUST start with this exact prefix verbatim: "${prefix}".`
      : `No prefix — start with the most material number.`);

  const user = JSON.stringify({
    paxReplies: inputs.paxReplies,
    topCounter: inputs.topCounter,
    curbSaves: inputs.curbSaves,
    lateNotes: inputs.lateNotes,
    netInflow30: inputs.netInflow30,
    staleLeads: inputs.staleLeads,
    pipelineValue: inputs.pipelineValue,
  });

  try {
    const response = await routeAITask(
      {
        taskType: "morning_brief",
        complexity: TaskComplexity.SIMPLE,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        maxTokens: 80,
        temperature: 0.3,
      },
      { orgId },
    );
    const raw = (response?.content ?? "").trim();
    if (!raw) return null;
    // Hard cap — strip anything after the first newline; Pax sometimes adds
    // explanatory follow-on lines we don't want surfaced on Today.
    const firstLine = raw.split("\n")[0].trim();
    return firstLine || null;
  } catch (err) {
    logger.warn("Today: Pax brief composition failed — falling back to template", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

// ── Shared queue builder (single source of truth) ───────────────────────────
// Both GET /api/today and POST /api/today/queue/clear MUST surface exactly the
// same set of active decision items, so the gather → merge → rank → subtract-
// resolved pipeline lives here once. GET uses both the resulting `items` (the
// queue it renders) and the `gathered` raw pieces (for the cash strip + brief),
// so calling this builder costs no extra round-trips. /queue/clear calls it to
// learn precisely which item ids to permanently dismiss — clearing exactly what
// the operator sees, regardless of client pagination.
interface BuiltQueue {
  /** Active decision items, ranked, with resolved/snoozed rows already subtracted. */
  items: DecisionItem[];
  /** Raw gather outputs the GET payload reuses for cash/brief (no re-fetch). */
  gathered: {
    paxPriorities: DecisionItem[];
    tasks: Awaited<ReturnType<typeof storage.getTasks>>;
    activeAlerts: Awaited<ReturnType<typeof getActiveAlerts>>;
    allLeads: Awaited<ReturnType<typeof storage.getLeads>>;
    allDeals: Awaited<ReturnType<typeof storage.getDeals>>;
    allProperties: Awaited<ReturnType<typeof storage.getProperties>>;
    allNotes: Awaited<ReturnType<typeof storage.getNotes>>;
    taskItems: DecisionItem[];
    alertItems: DecisionItem[];
  };
}

async function buildActiveQueue(orgId: number, now: Date): Promise<BuiltQueue> {
  const [
    paxPriorities,
    tasks,
    activeAlerts,
    paxNoticed,
    paxSuggests,
    allLeads,
    allDeals,
    allProperties,
    allNotes,
  ] = await Promise.all([
    gatherPaxPriorities(orgId, now),
    storage.getTasks(orgId),
    getActiveAlerts(orgId),
    gatherPaxNoticed(orgId, now),
    gatherPaxSuggests(orgId, now),
    storage.getLeads(orgId),
    storage.getDeals(orgId),
    storage.getProperties(orgId),
    storage.getNotes(orgId),
  ]);

  // Today's tasks → ai-queue rows (mirrors today.tsx todayActions block).
  const taskItems: DecisionItem[] = tasks
    .filter((t) => {
      if (t.status === "completed" || t.status === "done") return false;
      if (!t.dueDate) return false;
      return isTodayOrOverdue(new Date(t.dueDate), now);
    })
    .map((t) => {
      const overdue = t.dueDate ? isOverdue(new Date(t.dueDate), now) : false;
      return {
        id: `task-${t.id}`,
        source: "ai-queue" as const,
        priority: (t.priority as "high" | "medium" | "low") ?? "medium",
        title: t.title,
        description: t.dueDate
          ? `${overdue ? "Overdue · " : ""}Due ${new Date(t.dueDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
          : (t.description ?? ""),
        actionLabel: "Open task",
        actionUrl: "/pipeline",
        rank: 100 + (overdue ? 0 : 10) + (priorityRank[t.priority] ?? 1),
        // The only class that can honestly claim "overdue": a real dueDate
        // already in the past. Due-today tasks are time-sensitive.
        urgency: (overdue ? "overdue" : "time") as QueueUrgency,
      };
    });

  // Portfolio alerts → portfolio-alert rows.
  const alertItems: DecisionItem[] = activeAlerts.map((a: any) => {
    const sev: "high" | "medium" | "low" =
      a.severity === "critical" ? "high" : a.severity === "warning" ? "medium" : "low";
    return {
      id: `alert-${a.id}`,
      source: "portfolio-alert" as const,
      priority: sev,
      title: a.title,
      description: a.message,
      actionLabel: alertLinkLabelByType[a.type] ?? "View",
      actionUrl: alertHrefByType[a.type] ?? "/",
      rank: 200 + priorityRank[sev],
      // Overdue notes are missed dollars; critical alerts ride a real
      // degradation signal; the rest are routine watch items.
      urgency: (a.type === "note_overdue"
        ? "money"
        : sev === "high"
          ? "time"
          : "routine") as QueueUrgency,
    };
  });

  const aiQueue = await gatherAiQueue(orgId, now, allLeads, allDeals, allProperties);

  // One ranking function (Tier 3C): overdue → money-touching →
  // time-sensitive → routine; see compareQueueItems for the full contract.
  const mergedQueue: DecisionItem[] = [
    ...paxPriorities,
    ...taskItems,
    ...alertItems,
    ...paxNoticed,
    ...paxSuggests,
    ...aiQueue,
  ].sort(compareQueueItems);

  // ── Subtract inline-resolved items (Maren CPO #2) ──────────────────────
  // The queue is derived, so we hide anything the operator has already
  // resolved in place: "done"/"dismissed" hide permanently; "snoozed" hides
  // until snoozed_until passes (then the row re-surfaces naturally). We only
  // look up state for ids actually present this request — keeps the read
  // bounded to the live queue, and a single per-tenant index probe.
  const presentIds = mergedQueue.map((q) => q.id);
  let resolvedById = new Map<string, { status: string; snoozedUntil: Date | null }>();
  if (presentIds.length > 0) {
    try {
      const rows = await db
        .select({
          itemId: todayQueueState.itemId,
          status: todayQueueState.status,
          snoozedUntil: todayQueueState.snoozedUntil,
        })
        .from(todayQueueState)
        .where(and(
          eq(todayQueueState.organizationId, orgId),
          inArray(todayQueueState.itemId, presentIds),
        ));
      resolvedById = new Map(rows.map((r) => [r.itemId, { status: r.status, snoozedUntil: r.snoozedUntil }]));
    } catch (e) {
      // Non-fatal: if the resolution ledger read fails we show the full queue
      // rather than break Today. Honest degradation.
      logger.warn("Today: queue-state subtract failed — showing full queue", {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const items: DecisionItem[] = mergedQueue
    .filter((item) => !isQueueItemHidden(resolvedById.get(item.id), now))
    .map((item) => ({ ...item, inlineAction: deriveInlineAction(item) }));

  return {
    items,
    gathered: {
      paxPriorities,
      tasks,
      activeAlerts,
      allLeads,
      allDeals,
      allProperties,
      allNotes,
      taskItems,
      alertItems,
    },
  };
}

router.get("/", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const org = getOrganization(req);
    const orgId = org.id;
    const now = new Date();

    // Refresh portfolio alerts the same way /api/alerts/active does.
    await runPortfolioHealthJob(orgId).catch((e) =>
      logger.warn("Today: portfolio health refresh failed", { error: e instanceof Error ? e.message : String(e) }),
    );

    // Single source of truth: the shared builder gathers, merges, ranks, and
    // subtracts resolved/snoozed rows. We reuse its raw gather outputs for the
    // cash strip + brief below, so this costs no extra round-trips.
    const { items: queue, gathered } = await buildActiveQueue(orgId, now);
    const {
      paxPriorities,
      allLeads,
      allDeals,
      allProperties,
      allNotes,
      alertItems,
    } = gathered;

    // ── Finishability (Tier 3C): "N of M cleared" ──────────────────────────
    // clearedToday counts REAL completions: today_queue_state rows the
    // operator marked "done" since the start of THEIR local day (tz param).
    // Persisted + org-scoped, so it survives reload and follows the org, not
    // the device. Dismissals/snoozes shrink the queue but are not completions.
    const tzOffsetMin = Number(req.query.tz);
    const startOfDay = startOfUserDay(now, Number.isFinite(tzOffsetMin) ? tzOffsetMin : undefined);
    let clearedToday = 0;
    try {
      const rows = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(todayQueueState)
        .where(and(
          eq(todayQueueState.organizationId, orgId),
          eq(todayQueueState.status, "done"),
          gte(todayQueueState.updatedAt, startOfDay),
        ));
      clearedToday = Number(rows[0]?.count) || 0;
    } catch (e) {
      logger.warn("Today: clearedToday derivation failed", {
        error: e instanceof Error ? e.message : String(e),
      });
    }
    const progress = { cleared: clearedToday, total: clearedToday + queue.length };

    // ── Receipts (Tier 3C): completed events since the user's last visit ──
    // Sources are real rows only: pax_sends (witnessed sends through the
    // approval kernel), completed payments, and successful scheduled-task
    // runs. Window clamped to [now-7d, now-12h] so a quick reload doesn't
    // erase the overnight story.
    const sinceMs = Number(req.query.since);
    const receiptsSince = clampReceiptsSince(Number.isFinite(sinceMs) ? sinceMs : undefined, now);
    let receipts: ReceiptItem[] = [];
    try {
      const [sendRows, paymentRows, taskRunRows] = await Promise.all([
        db
          .select({ id: paxSends.id, channel: paxSends.channel, sentAt: paxSends.sentAt })
          .from(paxSends)
          .where(and(
            eq(paxSends.organizationId, orgId),
            gte(paxSends.sentAt, receiptsSince),
          ))
          .limit(200),
        db
          .select({
            id: paymentsTable.id,
            amount: paymentsTable.amount,
            processedAt: paymentsTable.processedAt,
          })
          .from(paymentsTable)
          .where(and(
            eq(paymentsTable.organizationId, orgId),
            eq(paymentsTable.status, "completed"),
            gte(paymentsTable.processedAt, receiptsSince),
          ))
          .limit(200),
        db
          .select({ id: paxScheduledTaskRuns.id, runAt: paxScheduledTaskRuns.runAt })
          .from(paxScheduledTaskRuns)
          .where(and(
            eq(paxScheduledTaskRuns.organizationId, orgId),
            eq(paxScheduledTaskRuns.status, "success"),
            gte(paxScheduledTaskRuns.runAt, receiptsSince),
          ))
          .limit(200),
      ]);
      receipts = deriveReceipts({ sends: sendRows, payments: paymentRows, taskRuns: taskRunRows });
    } catch (e) {
      // Non-fatal: no receipts is an honest state; never break Today for it.
      logger.warn("Today: receipts derivation failed", {
        error: e instanceof Error ? e.message : String(e),
      });
    }

    // ── Cash strip aggregates (mirrors today.tsx cashAggregates/pipeline) ──
    const activeDeals = allDeals.filter((d) => !["closed", "cancelled"].includes(d.status));
    const pipelineValue = activeDeals.reduce(
      (sum, d) => sum + parseFloat(String((d as any).purchasePrice ?? (d as any).offerAmount ?? "0") || "0"),
      0,
    );

    const activeNotes = allNotes.filter(
      (n) => n.status === "active" || n.status === "late" || n.status === "delinquent",
    );
    const lateCount = allNotes.filter((n) => n.status === "late" || n.status === "delinquent").length;
    const within = (days: number) =>
      activeNotes.filter((n) => {
        if (!n.nextPaymentDate) return false;
        const diff = (new Date(n.nextPaymentDate).getTime() - now.getTime()) / DAY_MS;
        return diff >= 0 && diff <= days;
      });
    const sumPayments = (arr: typeof activeNotes) =>
      arr.reduce((s, n) => s + parseFloat(String(n.monthlyPayment ?? "0") || "0"), 0);

    const projected30 = sumPayments(within(30));
    const projected90 = sumPayments(within(90));

    // ── Honest 90-day histories for KPI sparklines ─────────────────────────
    // We bucket by ~7-day windows over the last 90 days (≈ 13 buckets).
    // For history we can derive from existing tables without snapshots:
    //   • cashHistory          ← sum of completed payments per week
    //   • openDealsValueHistory ← cumulative active-deal value as of each bucket
    //                              (deals created on/before bucket, not yet closed)
    // For the other two we don't have a snapshot table, so we honestly return
    // []. The client falls through to "no sparkline" rather than fake data.
    const SPARK_BUCKETS = 13;
    const BUCKET_DAYS = 7;
    const bucketStart = (i: number) =>
      new Date(now.getTime() - (SPARK_BUCKETS - i) * BUCKET_DAYS * DAY_MS);
    const bucketEnd = (i: number) =>
      new Date(now.getTime() - (SPARK_BUCKETS - 1 - i) * BUCKET_DAYS * DAY_MS);

    let cashHistory: number[] = [];
    try {
      const since = bucketStart(0);
      const rows = await db
        .select({
          processedAt: paymentsTable.processedAt,
          paymentDate: paymentsTable.paymentDate,
          amount: paymentsTable.amount,
        })
        .from(paymentsTable)
        .where(
          and(
            eq(paymentsTable.organizationId, orgId),
            eq(paymentsTable.status, "completed"),
            gte(paymentsTable.paymentDate, since),
          ),
        );
      const buckets = new Array<number>(SPARK_BUCKETS).fill(0);
      for (const r of rows) {
        const ts = r.processedAt ?? r.paymentDate;
        if (!ts) continue;
        const d = new Date(ts).getTime();
        const idx = Math.floor((d - since.getTime()) / (BUCKET_DAYS * DAY_MS));
        if (idx < 0 || idx >= SPARK_BUCKETS) continue;
        buckets[idx] += parseFloat(String(r.amount ?? "0") || "0");
      }
      cashHistory = buckets;
    } catch (e) {
      logger.warn("Today: cashHistory derivation failed", {
        error: e instanceof Error ? e.message : String(e),
      });
      cashHistory = [];
    }

    const openDealsValueHistory: number[] = (() => {
      try {
        return Array.from({ length: SPARK_BUCKETS }, (_, i) => {
          const end = bucketEnd(i);
          return allDeals.reduce((sum, d: any) => {
            const created = d.createdAt ? new Date(d.createdAt) : null;
            if (!created || created > end) return sum;
            // Treat the deal as "active as of bucket end" if it wasn't already
            // closed/cancelled by then. We don't have a status-history table,
            // so we use updatedAt as a proxy: if updatedAt <= bucket end and
            // it's now closed/cancelled, exclude. Otherwise include.
            const terminal = ["closed", "cancelled"].includes(d.status);
            if (terminal) {
              const updated = d.updatedAt ? new Date(d.updatedAt) : null;
              if (updated && updated <= end) return sum;
            }
            const value = parseFloat(
              String(d.purchasePrice ?? d.offerAmount ?? "0") || "0",
            );
            return sum + value;
          }, 0);
        });
      } catch {
        return [];
      }
    })();

    // pendingDecisionCount feeds the hero badge (mirrors today.tsx).
    const stalledLeads = allLeads.filter((l) => {
      if (["closed", "dead", "converted"].includes(l.status)) return false;
      if (!l.lastContactedAt) return true;
      return new Date(l.lastContactedAt) < daysAgo(14, now);
    }).length;
    const waitingCounters = allDeals.filter((d) => {
      if (d.status !== "offer_sent") return false;
      if (!d.offerDate) return false;
      return new Date(d.offerDate) < daysAgo(7, now);
    }).length;
    const stuckDeals = allDeals.filter((d) => {
      if (["closed", "cancelled", "offer_sent"].includes(d.status)) return false;
      if (!d.updatedAt) return false;
      return new Date(d.updatedAt) < daysAgo(14, now);
    }).length;
    const pendingDecisionCount = stalledLeads + waitingCounters + stuckDeals;

    const hasAnyData = allLeads.length > 0 || allProperties.length > 0 || allDeals.length > 0;

    // ── MorningBrief: persona-typed one-liner above the queue ──────────────
    // Inputs come from the same gather we just did — no extra round-trips.
    const paxReplies = queue.filter((q) => q.source.startsWith("pax-")).length;
    const curbSaves = alertItems.length;
    const topCounter =
      paxPriorities.length > 0 ? paxPriorities[0].title : null;
    const netInflow30 = projected30; // 30-day projected note income
    const firstClosePrefix = deriveFirstClosePrefix(allDeals, allProperties);
    const persona = req.user?.persona as Persona | undefined;
    const briefInputs: BriefInputs = {
      paxReplies,
      topCounter,
      curbSaves,
      lateNotes: lateCount,
      netInflow30,
      staleLeads: stalledLeads,
      firstClosePrefix,
      pipelineValue,
    };
    // Try Pax-composed first (feature-flagged); fall back to the static template.
    // composeBriefWithPax returns null when the flag is off, on error, or on
    // empty response — never throws, so the route is unconditionally safe.
    const composed = hasAnyData
      ? await composeBriefWithPax(persona, briefInputs, orgId)
      : null;
    const brief: string | null = hasAnyData
      ? (composed ?? composeBrief(persona, briefInputs))
      : null;

    res.json({
      queue,
      brief,
      progress,
      receipts,
      cash: {
        cashOnHand: projected90,
        openDealsValue: pipelineValue,
        openDealsCount: activeDeals.length,
        pendingPayments30: projected30,
        lateCount,
        // 90-day weekly history. Empty arrays where we can't derive honestly
        // (no snapshot table for pending-payments / late-count over time).
        cashHistory,
        openDealsValueHistory,
        pendingPayments30History: [] as number[],
        lateCountHistory: [] as number[],
      },
      // Activity intentionally not merged (see file header) — kept for shape parity.
      activity: [],
      meta: {
        pendingDecisionCount,
        hasAnyData,
        generatedAt: now.toISOString(),
      },
    });
  } catch (error) {
    logger.error("Today consolidated endpoint error", error instanceof Error ? error : undefined);
    Errors.internal(res, error);
  }
});

// ── PATCH /api/today/queue/:id — inline-resolve a decision item (Maren CPO #2)
// Records the operator's in-place action on a (derived) queue item so the GET
// payload can subtract it. Body: { action: "done" | "snooze" | "dismiss" }.
//   • done / dismiss → permanent hide.
//   • snooze         → hide for SNOOZE_DAYS, then the item re-surfaces.
// Upserts on the (organization_id, item_id) unique index so repeated actions on
// the same item just overwrite the prior resolution. The item id is the same
// synthetic string the GET payload emits.
const RESOLVE_ACTIONS = new Set(["done", "snooze", "dismiss"]);

router.patch("/queue/:id", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const org = getOrganization(req);
    const orgId = org.id;
    const userId = getUserId(req);
    const itemId = String(req.params.id ?? "").trim();
    if (!itemId) {
      return Errors.badRequest(res, "A queue item id is required");
    }

    const action = String((req.body as { action?: unknown })?.action ?? "").trim();
    if (!RESOLVE_ACTIONS.has(action)) {
      return Errors.badRequest(res, "Invalid action — expected one of: done, snooze, dismiss");
    }

    const now = new Date();
    const { status, snoozedUntil } = resolveActionToState(action as ResolveAction, now);

    await db
      .insert(todayQueueState)
      .values({
        organizationId: orgId,
        itemId,
        status,
        snoozedUntil,
        resolvedBy: userId,
      })
      .onConflictDoUpdate({
        target: [todayQueueState.organizationId, todayQueueState.itemId],
        set: {
          status,
          snoozedUntil,
          resolvedBy: userId,
          updatedAt: now,
        },
      });

    res.json({
      id: itemId,
      status,
      snoozedUntil: snoozedUntil ? snoozedUntil.toISOString() : null,
    });
  } catch (error) {
    logger.error("Today queue resolve error", error instanceof Error ? error : undefined);
    Errors.internal(res, error);
  }
});

// ── POST /api/today/queue/clear — permanently clear the WHOLE active queue ───
// The per-item PATCH above is for one row at a time. This route lets the
// operator wipe the entire surfaced queue in one shot — the escape hatch for a
// queue that has accumulated hundreds of derived items (dev/deploy noise).
//
// It is server-computes-ALL (not client-supplied ids): we call the SAME shared
// buildActiveQueue() that GET /api/today renders from, so we dismiss exactly the
// set the operator sees — independent of client pagination. Every active item
// id is upserted to status="dismissed" (snoozedUntil=null) on the
// (organization_id, item_id) unique index, in ONE batched insert (not N
// queries). Idempotent: re-running on an already-clear queue is a no-op that
// returns { cleared: 0 }. Org-scoped + authed exactly like the PATCH handler.
router.post("/queue/clear", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const orgId = getOrganizationId(req);
    const userId = getUserId(req);
    const now = new Date();

    const { items } = await buildActiveQueue(orgId, now);
    if (items.length === 0) {
      // Nothing surfaced — idempotent no-op.
      return res.json({ cleared: 0 });
    }

    // Single batched upsert: one INSERT … VALUES (…),(…),… ON CONFLICT DO
    // UPDATE, mirroring the PATCH handler's upsert shape (status="dismissed",
    // snoozedUntil=null). Dedupe ids defensively so the VALUES list never
    // carries a duplicate (the unique index would otherwise reject the batch).
    const uniqueIds = Array.from(new Set(items.map((it) => it.id)));
    const rows = uniqueIds.map((itemId) => ({
      organizationId: orgId,
      itemId,
      status: "dismissed" as const,
      snoozedUntil: null,
      resolvedBy: userId,
    }));

    await db
      .insert(todayQueueState)
      .values(rows)
      .onConflictDoUpdate({
        target: [todayQueueState.organizationId, todayQueueState.itemId],
        set: {
          status: "dismissed",
          snoozedUntil: null,
          resolvedBy: userId,
          updatedAt: now,
        },
      });

    logger.info("Today: queue permanently cleared", {
      orgId,
      cleared: uniqueIds.length,
    });

    res.json({ cleared: uniqueIds.length });
  } catch (error) {
    logger.error("Today queue clear error", error instanceof Error ? error : undefined);
    Errors.internal(res, error);
  }
});

export default router;
