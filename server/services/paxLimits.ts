/**
 * Pax daily limits — the ONE per-call cap decision (PX-3, register P-1).
 *
 * `checkPaxLimit` is consulted by BOTH dispatch switches (server/ai/tools.ts:
 * executeTool and server/ai/supportAgent.ts:executeSupportTool), AFTER
 * decidePaxCall, against the EFFECTIVE controls (the org's limits narrowed by
 * the calling member's own override — shared/pax-controls.ts
 * effectiveControlsForMember). Four caps, each `null` = no cap = today:
 *
 *   asks      pending_actions rows the org created today (every row is a
 *             Pax-initiated ask by construction). Judged at the moment an ask
 *             is about to be parked.
 *   credits   what today's executed Pax sends cost, priced by
 *             sendPricing.paxSendCost on each send's frozen args — the SAME
 *             pricing source Pax quotes from. Pax direct sends cost 0 credits
 *             today (PAX_DIRECT_SEND_PRICE_CREDITS = 0), so spend is 0 until a
 *             price exists: that is a fact about pricing, not a gap here.
 *   browse    activity_log receipts (agent 'pax', action 'browse_web') today —
 *             every outcome counts; an attempted visit is a call.
 *   batchRows rows created by create_properties_batch today, read from the
 *             `rowsCreated` its receipt carries in `after`.
 *
 * BOUNDARIES (consistent on purpose):
 *   asks / browse   deny when used >= cap BEFORE the action, so the cap-th
 *                   action is the last one allowed.
 *   credits / batch deny when used + this call > cap, so landing EXACTLY on
 *                   the cap is allowed. A batch is refused WHOLE, never
 *                   truncated.
 *
 * "Today" is the org's local day (PaxControlsState.timezone) read through
 * server/utils/clock. Counters read only when the relevant cap is set, so an
 * org with no limits pays no query. A counter that cannot be read throws —
 * the dispatch switch's outer catch turns that into a refusal, never a pass.
 *
 * Out of scope on purpose: a human-approved replay (trustedApproval) is the
 * human acting and carries no controls, so the caps judge Pax's own calls only;
 * and this module never touches the platform's own AI-cost accounting.
 */

import { and, eq, gte, sql } from "drizzle-orm";
import { activityLog, paxSends, pendingActions } from "@shared/schema";
import type { PaxLimits, PaxStance } from "@shared/pax-controls";
import { PAX_LIMIT_COPY } from "@shared/pax-glossary";
import { clock } from "../utils/clock";
import { paxSendCost } from "./sendPricing";
import type { PaxEffectOrigin } from "./paxReceipts";

// `../db` and `./paxReceipts` are loaded on first use, not at import: the
// refusal builder below is imported by the plain-words gate
// (tests/unit/refusalsArePlainWords.test.ts), which must not need a database
// connection just to read a sentence. Both are cached by the module system.
const getDb = async () => (await import("../db")).db;

export type PaxLimitKind = "asks" | "credits" | "browse" | "batchRows";

export type PaxLimitVerdict =
  | { allowed: true }
  | { allowed: false; kind: PaxLimitKind; cap: number; used: number; message: string };

/** The limit key each kind reads. */
const KIND_KEY: Readonly<Record<PaxLimitKind, keyof PaxLimits>> = {
  asks: "asksPerDay",
  credits: "creditSpendPerDay",
  browse: "browseCallsPerDay",
  batchRows: "batchRowsPerDay",
};

/**
 * The plain-words refusal a capped call gets. A BUILDER, called directly by
 * both dispatch switches, so tests/unit/refusalsArePlainWords.test.ts can call
 * it for every kind and judge the words.
 */
export function paxLimitRefusalMessage(kind: PaxLimitKind): string {
  return PAX_LIMIT_COPY.refusals[kind];
}

/** The counting seams — small, injectable, org-scoped, each given the start of the org's day. */
export interface PaxUsageSeams {
  asksSince(orgId: number, since: Date): Promise<number>;
  browseSince(orgId: number, since: Date): Promise<number>;
  batchRowsSince(orgId: number, since: Date): Promise<number>;
  creditsSince(orgId: number, since: Date): Promise<number>;
}

const realSeams: PaxUsageSeams = {
  async asksSince(orgId, since) {
    const db = await getDb();
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(pendingActions)
      .where(and(eq(pendingActions.organizationId, orgId), gte(pendingActions.createdAt, since)));
    return Number(row?.n ?? 0);
  },
  async browseSince(orgId, since) {
    const db = await getDb();
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(activityLog)
      .where(
        and(
          eq(activityLog.organizationId, orgId),
          eq(activityLog.agentType, "pax"),
          eq(activityLog.action, "browse_web"),
          gte(activityLog.createdAt, since),
        ),
      );
    return Number(row?.n ?? 0);
  },
  async batchRowsSince(orgId, since) {
    const db = await getDb();
    const created = sql`${activityLog.changes}->'after'->>'rowsCreated'`;
    const [row] = await db
      .select({ n: sql<number>`coalesce(sum(case when ${created} ~ '^[0-9]+$' then (${created})::int else 0 end), 0)::int` })
      .from(activityLog)
      .where(
        and(
          eq(activityLog.organizationId, orgId),
          eq(activityLog.agentType, "pax"),
          eq(activityLog.action, "create_properties_batch"),
          gte(activityLog.createdAt, since),
        ),
      );
    return Number(row?.n ?? 0);
  },
  async creditsSince(orgId, since) {
    // pax_sends rows exist only for sends that went out; the join reads each
    // one's frozen args so the price is the one Pax quoted (paxSendCost).
    const db = await getDb();
    const rows = await db
      .select({ toolName: pendingActions.toolName, args: pendingActions.args })
      .from(paxSends)
      .innerJoin(pendingActions, eq(paxSends.pendingActionId, pendingActions.id))
      .where(
        and(
          eq(paxSends.organizationId, orgId),
          eq(pendingActions.organizationId, orgId),
          gte(paxSends.sentAt, since),
        ),
      );
    return rows.reduce((sum, r) => sum + (paxSendCost(r.toolName, r.args ?? {})?.credits ?? 0), 0);
  },
};

// ── The org's day ───────────────────────────────────────────────────────────

function zoneParts(date: Date, timeZone: string) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(date)) p[part.type] = part.value;
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute, s: +p.second };
}

function offsetMsAt(date: Date, timeZone: string): number {
  const p = zoneParts(date, timeZone);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - date.getTime();
}

/** Local midnight of `now` in the org's zone. */
function startOfOrgDay(timeZone: string, now: Date): Date {
  const p = zoneParts(now, timeZone);
  const wall = Date.UTC(p.y, p.m - 1, p.d, 0);
  const first = offsetMsAt(new Date(wall), timeZone);
  let result = wall - first;
  const second = offsetMsAt(new Date(result), timeZone);
  if (second !== first) result = wall - second;
  return new Date(result);
}

// ── The decision ────────────────────────────────────────────────────────────

/** One cap this call is judged against: how much it adds, and which boundary applies. */
interface PlannedCheck {
  kind: PaxLimitKind;
  cap: number;
  /** What this call adds to the count (1 for asks / browse, the quote, the row count). */
  adds: number;
  /** asks / browse: deny when used >= cap. credits / batch: deny when used + adds > cap. */
  before: boolean;
}

function rowsInCall(args: Record<string, unknown>): number {
  return Array.isArray(args.properties) ? args.properties.length : 0;
}

/**
 * Which caps judge this call. `stage` "ask" is the moment an ask is about to be
 * parked (any tool reaching proposePendingAction); "run" is a call about to
 * execute now. Tools no cap names are judged by nothing.
 */
function planChecks(
  limits: PaxLimits,
  stage: "ask" | "run",
  toolName: string,
  args: Record<string, unknown>,
): PlannedCheck[] {
  const plan: PlannedCheck[] = [];
  const add = (c: Omit<PlannedCheck, "cap">) => {
    // `limits?.`: a hand-built state from before PX-3 may carry none — no caps.
    const cap = limits?.[KIND_KEY[c.kind]];
    if (cap !== null && cap !== undefined) plan.push({ ...c, cap });
  };
  if (stage === "ask") {
    add({ kind: "asks", adds: 1, before: true });
    const quote = paxSendCost(toolName, args);
    if (quote) add({ kind: "credits", adds: quote.credits, before: false });
    // A batch parked for a tap is judged now too, so the cap holds for orgs whose
    // rail parks it (the tap-time replay carries no controls).
    if (toolName === "create_properties_batch") add({ kind: "batchRows", adds: rowsInCall(args), before: false });
  } else if (toolName === "browse_web") {
    add({ kind: "browse", adds: 1, before: true });
  } else if (toolName === "create_properties_batch") {
    add({ kind: "batchRows", adds: rowsInCall(args), before: false });
  }
  return plan;
}

function overCap(c: PlannedCheck, used: number): boolean {
  return c.before ? used >= c.cap : used + c.adds > c.cap;
}

/**
 * Judge one call against the EFFECTIVE limits. Pure given the seams; the real
 * seams read the durable stores. `timezone` is PaxControlsState.timezone.
 */
export async function checkPaxLimit(input: {
  orgId: number;
  limits: PaxLimits;
  toolName: string;
  args: Record<string, unknown>;
  stage: "ask" | "run";
  timezone: string;
  now?: Date;
  /** Injection point for the counters; unit tests pass stubs, production passes nothing. */
  seams?: Partial<PaxUsageSeams>;
}): Promise<PaxLimitVerdict> {
  const plan = planChecks(input.limits, input.stage, input.toolName, input.args);
  if (plan.length === 0) return { allowed: true };

  const seams: PaxUsageSeams = { ...realSeams, ...input.seams };
  const since = startOfOrgDay(input.timezone, input.now ?? clock.now());
  const read: Record<PaxLimitKind, (orgId: number, since: Date) => Promise<number>> = {
    asks: seams.asksSince,
    credits: seams.creditsSince,
    browse: seams.browseSince,
    batchRows: seams.batchRowsSince,
  };

  for (const c of plan) {
    const used = await read[c.kind](input.orgId, since);
    if (overCap(c, used)) {
      return { allowed: false, kind: c.kind, cap: c.cap, used, message: paxLimitRefusalMessage(c.kind) };
    }
  }
  return { allowed: true };
}

/**
 * The receipt for a denied attempt: one row in "What Pax did", in the
 * customer's words, naming the limit. Best-effort — recordPaxEffect never
 * throws and a receipt failure never changes the refusal.
 */
export async function recordPaxLimitDenied(input: {
  orgId: number;
  toolName: string;
  verdict: Extract<PaxLimitVerdict, { allowed: false }>;
  origin: PaxEffectOrigin;
  stance: PaxStance | null;
  userId?: string | null;
}): Promise<void> {
  try {
    const { recordPaxEffect } = await import("./paxReceipts");
    await recordPaxEffect({
      orgId: input.orgId,
      actor: "pax",
      origin: input.origin,
      stance: input.stance,
      tool: input.toolName,
      action: "pax_limit_denied",
      entityType: "organization",
      entityId: input.orgId,
      description: PAX_LIMIT_COPY.deniedLine[input.verdict.kind],
      after: { limit: input.verdict.kind, cap: input.verdict.cap, used: input.verdict.used },
      witnessed: false,
      userId: input.userId ?? null,
    });
  } catch {
    // recordPaxEffect swallows its own failures; this guards only the lazy
    // import. Either way the refusal the caller returns is unchanged.
  }
}
