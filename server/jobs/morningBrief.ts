/**
 * Phase E — Morning brief for the founder's Atlas thread.
 *
 * Runs at 07:00 (Central, per the legacy pattern). For each founder we:
 *   1. Skip if a brief was already posted today (dedupe via toolCalls
 *      jsonb `kind = 'morning_brief'` on aiMessages — the chat schema has
 *      no first-class metadata column, so we ride along in toolCalls).
 *   2. Read five tools' worth of data directly (cheaper than chained
 *      tool-call round trips).
 *   3. Compose a ~200-word brief via Atlas Opus 4.7
 *      (selectModelForTurn({ intent: 'morning_brief' })).
 *   4. Insert a single assistant message carrying a brief_card artifact
 *      with section sub-cards for buckets / triggers / decisions / DLQ /
 *      net-negative orgs. Each section gets a markdown body, a headline
 *      metric, and inline action buttons (toolCallText is dropped into
 *      the chat composer when the founder taps it).
 *
 * The job is deliberately self-contained: it does NOT depend on the
 * agentic loop, executor, or persona files. It composes via aiRouter
 * (which already speaks OpenRouter) so unit tests can mock that module
 * cleanly without spinning up the full SSE stream.
 */

import { and, desc, eq, gte, inArray, isNotNull, sql, sum } from "drizzle-orm";
import { db } from "../db";
import {
  aiConversations,
  aiMessages,
  decisionsInboxItems,
  financialLedger,
  founderAudit,
  organizations,
  outboxDlq,
  teamMembers,
} from "@shared/schema";
import type { Artifact, BriefSection } from "@shared/founder-chat/artifacts";
import { selectModelForTurn } from "../services/founder-chat/model-selector";
import { logger } from "../utils/logger";

// ─────────────────────────────────────────────────────────────────────────────
// Public surface
// ─────────────────────────────────────────────────────────────────────────────

export interface MorningBriefResult {
  founderUserId: string;
  threadId: number | null;
  skipped?: "already_posted_today" | "no_default_thread";
  messageId?: number;
  briefArtifact?: Extract<Artifact, { type: "brief_card" }>;
  /** Model id used for the LLM composition (or "fallback" if no key). */
  modelUsed?: string;
}

/**
 * Run the morning brief for a single founder. Idempotent within the
 * current calendar day in UTC (the dedupe check inspects
 * createdAt >= startOfTodayUtc + toolCalls.kind === 'morning_brief').
 */
export async function runMorningBriefForFounder(
  founderUserId: string,
  opts: { now?: Date; force?: boolean } = {},
): Promise<MorningBriefResult> {
  const now = opts.now ?? new Date();
  const threadId = await findDefaultFounderThread(founderUserId);
  if (!threadId) {
    return { founderUserId, threadId: null, skipped: "no_default_thread" };
  }

  if (!opts.force) {
    const already = await wasBriefPostedToday(threadId, now);
    if (already) {
      return { founderUserId, threadId, skipped: "already_posted_today" };
    }
  }

  const data = await collectBriefData();
  const brief = await composeBrief(data);

  const briefArtifact: Extract<Artifact, { type: "brief_card" }> = {
    type: "brief_card",
    title: `Morning brief — ${formatDate(now)}`,
    sections: brief.sections,
  };

  const inserted = await db
    .insert(aiMessages)
    .values({
      conversationId: threadId,
      role: "assistant",
      content: brief.spoken,
      // Stash artifacts + `kind` discriminator in toolCalls jsonb. The
      // chat-stream endpoint already round-trips toolCalls verbatim, and
      // the renderer reads artifacts off it (Phase C+).
      toolCalls: [
        { kind: "morning_brief", artifact: briefArtifact, postedBy: "atlas_cron" },
      ] as any,
    } as any)
    .returning({ id: aiMessages.id });

  try {
    await db
      .update(aiConversations)
      .set({ updatedAt: now } as any)
      .where(eq(aiConversations.id, threadId));
  } catch (err) {
    logger.warn("[morningBrief] failed to bump thread updatedAt", { metadata: { err: String(err) } });
  }

  return {
    founderUserId,
    threadId,
    messageId: inserted[0]?.id,
    briefArtifact,
    modelUsed: brief.modelUsed,
  };
}

/**
 * Run the morning brief for every founder. Founders = users who own at
 * least one org with isFounder=true (team_members.role='owner' joined
 * against organizations.isFounder=true). De-dupes founders that own
 * multiple founder orgs.
 */
export async function runMorningBriefForAllFounders(
  opts: { now?: Date } = {},
): Promise<{ ran: number; skipped: number; results: MorningBriefResult[] }> {
  const rows = await db
    .selectDistinct({ userId: teamMembers.userId })
    .from(teamMembers)
    .innerJoin(organizations, eq(organizations.id, teamMembers.organizationId))
    .where(and(eq(teamMembers.role, "owner"), eq(organizations.isFounder, true)));

  const results: MorningBriefResult[] = [];
  let ran = 0;
  let skipped = 0;
  for (const r of rows) {
    if (!r.userId) continue;
    try {
      const result = await runMorningBriefForFounder(r.userId, opts);
      results.push(result);
      if (result.skipped) skipped += 1;
      else ran += 1;
    } catch (err) {
      logger.error(
        `[morningBrief] failed for founder ${r.userId}`,
        err instanceof Error ? err : undefined,
      );
    }
  }
  return { ran, skipped, results };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function startOfTodayUtc(now: Date): Date {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function daysAgo(n: number, now = new Date()): Date {
  return new Date(now.getTime() - n * 24 * 60 * 60 * 1000);
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function centsToUsd(cents: number): string {
  const dollars = Math.round(cents) / 100;
  const sign = dollars < 0 ? "-" : "";
  const abs = Math.abs(dollars);
  return `${sign}$${abs.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

async function findDefaultFounderThread(founderUserId: string): Promise<number | null> {
  const [row] = await db
    .select({ id: aiConversations.id })
    .from(aiConversations)
    .where(
      and(
        eq(aiConversations.userId, founderUserId),
        eq(aiConversations.scope, "founder"),
        eq(aiConversations.isDefault, true),
      ),
    )
    .limit(1);
  return row?.id ?? null;
}

async function wasBriefPostedToday(threadId: number, now: Date): Promise<boolean> {
  const since = startOfTodayUtc(now);
  // Postgres jsonb contains-any predicate. We look for any toolCalls
  // jsonb array element whose `kind` is 'morning_brief'.
  const rows = await db
    .select({ id: aiMessages.id })
    .from(aiMessages)
    .where(
      and(
        eq(aiMessages.conversationId, threadId),
        eq(aiMessages.role, "assistant"),
        gte(aiMessages.createdAt, since),
        isNotNull(aiMessages.toolCalls),
        sql`${aiMessages.toolCalls}::jsonb @> '[{"kind":"morning_brief"}]'::jsonb`,
      ),
    )
    .limit(1);
  return rows.length > 0;
}

// ─── Data collection ────────────────────────────────────────────────────────

interface BriefData {
  buckets: {
    taxReserve: number;
    refundReserve: number;
    profitReserve: number;
    ownerDraw: number;
    opexAvailable: number;
  };
  pendingTriggers: number;
  pendingDecisions: number;
  unresolvedDlq: number;
  netNegativeOrgs: Array<{ orgId: number; orgName: string; marginCents: number; mrrCents: number }>;
}

async function collectBriefData(): Promise<BriefData> {
  const since30 = daysAgo(30);

  const [bucketRows, mrrRow, decisionRows, dlqRows, perOrgMargin] = await Promise.all([
    db
      .select({
        bucket: financialLedger.bucket,
        total: sum(financialLedger.amountCents).mapWith(Number),
      })
      .from(financialLedger)
      .groupBy(financialLedger.bucket)
      .catch(() => [] as Array<{ bucket: string | null; total: number | null }>),
    db
      .select({ total: sum(financialLedger.amountCents).mapWith(Number) })
      .from(financialLedger)
      .where(and(eq(financialLedger.category, "revenue"), gte(financialLedger.postedAt, since30)))
      .catch(() => [] as Array<{ total: number | null }>),
    db
      .select()
      .from(decisionsInboxItems)
      .where(eq(decisionsInboxItems.status, "pending"))
      .orderBy(desc(decisionsInboxItems.createdAt))
      .limit(50)
      .catch(() => [] as any[]),
    db
      .select()
      .from(outboxDlq)
      .where(sql`${outboxDlq.status} not in ('discarded', 'retried')`)
      .orderBy(desc(outboxDlq.movedToDlqAt))
      .limit(50)
      .catch(() => [] as any[]),
    computePerOrgMargin(since30),
  ]);

  const balances: BriefData["buckets"] = {
    taxReserve: 0,
    refundReserve: 0,
    profitReserve: 0,
    ownerDraw: 0,
    opexAvailable: 0,
  };
  for (const r of bucketRows) {
    if (!r.bucket) continue;
    if (r.bucket === "tax_reserve") balances.taxReserve = r.total ?? 0;
    else if (r.bucket === "refund_reserve") balances.refundReserve = r.total ?? 0;
    else if (r.bucket === "profit_reserve") balances.profitReserve = r.total ?? 0;
    else if (r.bucket === "owner_draw") balances.ownerDraw = r.total ?? 0;
    else if (r.bucket === "opex_available") balances.opexAvailable = r.total ?? 0;
  }

  // pendingTriggers — read from founder_audit to find threshold ids that
  // haven't been approved/deferred. The full ladder lives in
  // tools/inquiry.ts; we approximate by counting active threshold rows
  // from audit-history that the founder hasn't acted on. If nothing
  // exists yet (early platform), return 0.
  const pendingTriggers = await countActiveTriggers(mrrRow?.[0]?.total ?? 0);

  // pendingTriggers is what the founder still owes a decision on; the
  // morning brief surfaces a count + invites Atlas's get_active_triggers
  // tool for detail. Keeping the brief itself thin.

  return {
    buckets: balances,
    pendingTriggers,
    pendingDecisions: decisionRows.length,
    unresolvedDlq: dlqRows.length,
    netNegativeOrgs: perOrgMargin,
  };
}

const REVENUE_TRIGGER_THRESHOLDS_CENTS = [
  5_000, 20_000, 50_000, 100_000, 100_000, 200_000, 300_000, 500_000, 1_000_000,
];

async function countActiveTriggers(mrr30dCents: number): Promise<number> {
  const crossed = REVENUE_TRIGGER_THRESHOLDS_CENTS.filter((t) => mrr30dCents >= t).length;
  if (crossed === 0) return 0;
  try {
    const decisions = await db
      .select({ targetId: founderAudit.targetId, action: founderAudit.action })
      .from(founderAudit)
      .where(eq(founderAudit.area, "scale_up"))
      .orderBy(desc(founderAudit.createdAt));
    const decided = new Set<string>();
    for (const r of decisions) {
      if (!r.targetId || decided.has(r.targetId)) continue;
      if (r.action === "approve" || r.action === "defer") decided.add(r.targetId);
    }
    return Math.max(0, crossed - decided.size);
  } catch {
    return crossed;
  }
}

async function computePerOrgMargin(
  since: Date,
): Promise<Array<{ orgId: number; orgName: string; marginCents: number; mrrCents: number }>> {
  try {
    const revenueRows = await db
      .select({
        orgId: financialLedger.organizationId,
        total: sum(financialLedger.amountCents).mapWith(Number),
      })
      .from(financialLedger)
      .where(and(eq(financialLedger.category, "revenue"), gte(financialLedger.postedAt, since)))
      .groupBy(financialLedger.organizationId);
    const opexRows = await db
      .select({
        orgId: financialLedger.organizationId,
        total: sum(financialLedger.amountCents).mapWith(Number),
      })
      .from(financialLedger)
      .where(and(eq(financialLedger.category, "opex_spent"), gte(financialLedger.postedAt, since)))
      .groupBy(financialLedger.organizationId);
    const opexByOrg = new Map<number, number>();
    for (const r of opexRows) if (r.orgId != null) opexByOrg.set(r.orgId, r.total ?? 0);
    const ids = revenueRows.map((r) => r.orgId).filter((id): id is number => id != null);
    const orgNames = ids.length
      ? await db
          .select({ id: organizations.id, name: organizations.name })
          .from(organizations)
          .where(inArray(organizations.id, ids))
      : [];
    const nameMap = new Map(orgNames.map((r) => [r.id, r.name ?? `Org ${r.id}`]));
    return revenueRows
      .filter((r): r is typeof r & { orgId: number } => r.orgId != null)
      .map((r) => {
        const mrrCents = r.total ?? 0;
        const opexCents = opexByOrg.get(r.orgId) ?? 0;
        return {
          orgId: r.orgId,
          orgName: nameMap.get(r.orgId) ?? `Org ${r.orgId}`,
          mrrCents,
          marginCents: mrrCents + opexCents,
        };
      })
      .filter((r) => r.marginCents < 0)
      .sort((a, b) => a.marginCents - b.marginCents)
      .slice(0, 5);
  } catch {
    return [];
  }
}

// ─── Composition ────────────────────────────────────────────────────────────

interface ComposedBrief {
  sections: BriefSection[];
  spoken: string;
  modelUsed: string;
}

async function composeBrief(data: BriefData): Promise<ComposedBrief> {
  const sections = buildSections(data);
  const stats = await buildStatsLineWithImprovements(data);

  // Single Opus 4.7 call composes the spoken intro (~200 words). If the
  // LLM is unreachable, we ship the structured artifact anyway with a
  // deterministic 1-line spoken summary.
  let modelUsed = "fallback";
  let spoken = `Morning. ${stats}`;
  try {
    const { routeAITask, TaskComplexity } = await import("../services/aiRouter");
    const { model } = selectModelForTurn({ intent: "morning_brief" });
    modelUsed = model;
    const result = await routeAITask({
      taskType: "atlas_morning_brief",
      complexity: TaskComplexity.MODERATE,
      taskTier: "standard",
      messages: [
        {
          role: "system",
          content:
            "You are Atlas, Tom's chief of staff. Write a 200-word morning brief in Tom's terse direct voice. " +
            "Lead with the most load-bearing number; then list one-line callouts for: opex bucket, pending triggers, pending decisions, " +
            "DLQ items, net-negative orgs (if any). End with one suggested next action. No hedging. No bullets except where the data is a list.",
        },
        {
          role: "user",
          content: `Today's data:\n${stats}\n\nRespond with the brief only (no greeting line — that's Atlas).`,
        },
      ],
    });
    if (result?.content && typeof result.content === "string") {
      spoken = result.content.trim();
    }
  } catch (err) {
    logger.warn("[morningBrief] composer fell back to deterministic spoken line", {
      metadata: { err: String(err) },
    });
  }

  return { sections, spoken, modelUsed };
}

/**
 * Stats line + best-effort team-improvement opportunity count. Used by
 * composeBrief() so the morning pulse surfaces detector output without
 * blocking on a slow query.
 */
async function buildStatsLineWithImprovements(data: BriefData): Promise<string> {
  const base = buildStatsLine(data);
  try {
    const openCount = await Promise.race([
      countOpenImprovementOpportunities(),
      new Promise<number>((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), 3000),
      ),
    ]);
    return `${base}, improvement opportunities: ${openCount} open`;
  } catch (err) {
    // Fail-graceful: morning brief is not blocked by an unhealthy
    // improvement-detector ledger.
    logger.warn("[morningBrief] improvement-opportunities count failed", {
      metadata: { err: String(err) },
    });
    return base;
  }
}

async function countOpenImprovementOpportunities(): Promise<number> {
  const { teamImprovementOpportunities } = await import(
    "@shared/schema/team-improvement"
  );
  const [row] = await db
    .select({ n: sql<number>`COUNT(*)::int` })
    .from(teamImprovementOpportunities)
    .where(
      and(
        eq(teamImprovementOpportunities.autoDispatched, false),
        sql`${teamImprovementOpportunities.resolvedAt} IS NULL`,
      ),
    );
  return Number(row?.n ?? 0);
}

function buildStatsLine(data: BriefData): string {
  const opex = centsToUsd(data.buckets.opexAvailable);
  const profit = centsToUsd(data.buckets.profitReserve);
  return [
    `opex ${opex}`,
    `profit ${profit}`,
    `triggers pending ${data.pendingTriggers}`,
    `decisions pending ${data.pendingDecisions}`,
    `dlq ${data.unresolvedDlq}`,
    `net-negative orgs ${data.netNegativeOrgs.length}`,
  ].join(", ");
}

function buildSections(data: BriefData): BriefSection[] {
  const sections: BriefSection[] = [];

  sections.push({
    title: "Buckets",
    headline: centsToUsd(data.buckets.opexAvailable),
    headlineLabel: "opex available",
    markdown:
      `Tax ${centsToUsd(data.buckets.taxReserve)} · Refund ${centsToUsd(data.buckets.refundReserve)} · ` +
      `Profit ${centsToUsd(data.buckets.profitReserve)} · Owner ${centsToUsd(data.buckets.ownerDraw)}`,
    tone: data.buckets.opexAvailable < 0 ? "danger" : "neutral",
    actions: [{ label: "Open buckets", toolCallText: "/buckets" }],
  });

  sections.push({
    title: "Active triggers",
    headline: String(data.pendingTriggers),
    headlineLabel: data.pendingTriggers === 1 ? "scale-up awaiting you" : "scale-ups awaiting you",
    markdown:
      data.pendingTriggers === 0
        ? "No revenue triggers waiting. Nothing to approve."
        : `${data.pendingTriggers} threshold${data.pendingTriggers === 1 ? "" : "s"} crossed and waiting on you.`,
    tone: data.pendingTriggers > 0 ? "warning" : "positive",
    actions:
      data.pendingTriggers > 0
        ? [{ label: "Show triggers", toolCallText: "/triggers" }]
        : undefined,
  });

  sections.push({
    title: "Decision queue",
    headline: String(data.pendingDecisions),
    headlineLabel: "pending",
    markdown:
      data.pendingDecisions === 0
        ? "Inbox is clear."
        : `${data.pendingDecisions} item${data.pendingDecisions === 1 ? "" : "s"} in the decision queue.`,
    tone: data.pendingDecisions > 0 ? "warning" : "positive",
    actions:
      data.pendingDecisions > 0
        ? [{ label: "Show decisions", toolCallText: "/decisions" }]
        : undefined,
  });

  sections.push({
    title: "DLQ",
    headline: String(data.unresolvedDlq),
    headlineLabel: "unresolved",
    markdown:
      data.unresolvedDlq === 0
        ? "No dead-letter items."
        : `${data.unresolvedDlq} dead-letter row${data.unresolvedDlq === 1 ? "" : "s"} need triage.`,
    tone: data.unresolvedDlq > 0 ? "danger" : "positive",
    actions: data.unresolvedDlq > 0 ? [{ label: "Show DLQ", toolCallText: "/dlq" }] : undefined,
  });

  if (data.netNegativeOrgs.length > 0) {
    const top = data.netNegativeOrgs.slice(0, 5);
    sections.push({
      title: "Net-negative orgs",
      headline: String(data.netNegativeOrgs.length),
      headlineLabel: "burning margin",
      markdown:
        "Worst margin first:\n" +
        top
          .map((o) => `- ${o.orgName} — margin ${centsToUsd(o.marginCents)} (mrr ${centsToUsd(o.mrrCents)})`)
          .join("\n"),
      tone: "danger",
      actions: top.slice(0, 3).map((o) => ({
        label: `Investigate ${o.orgName}`,
        toolCallText: `Show me org ${o.orgId} cost detail`,
      })),
    });
  } else {
    sections.push({
      title: "Net-negative orgs",
      headline: "0",
      headlineLabel: "all orgs profitable",
      markdown: "Every paying org is contribution-positive over the trailing 30d.",
      tone: "positive",
    });
  }

  return sections;
}
