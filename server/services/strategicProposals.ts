/**
 * Strategic Proposals — the proactive layer.
 *
 * Until now, the system has been reactive. Signals arrive, agents
 * process them, actions emit. The founder gets to review. But the
 * system never asks "what should we be doing that nobody told us
 * about?" That means the founder is still the only source of
 * strategic direction — the whole point we're trying to eliminate.
 *
 * This service closes that gap. Two passes:
 *
 *   1. Weekly pass (Sundays 00:00 UTC) — a single Opus call is given
 *      summaries of each of the 12 agents' domains and asked to
 *      produce 1-2 strategic proposals per agent. Output is up to
 *      24 proposals stamped with the ISO weekKey.
 *
 *   2. Monthly synthesis pass (1st at 10:00 UTC, 2h before the letter
 *      generator runs at 12:00 UTC) — reads all weekly proposals from
 *      the previous month, examines which patterns repeat, and
 *      synthesizes 3-5 "company moves" for the month. These are
 *      stamped with monthKey so the founder letter can pull them
 *      into the Next Month's Focus section.
 *
 * Design choices:
 * - One LLM call per pass instead of 12 — gives the model cross-wing
 *   awareness naturally and keeps costs at ~$0.50/month total.
 * - Proposals are never auto-executed. They're always founder-gated.
 *   The aim is to shape direction, not to act on the founder's behalf
 *   at a strategic level.
 * - The synthesis pass can reject all weekly proposals if the month
 *   is quiet. "Do nothing new" is a valid output.
 */

import { db } from "../db";
import {
  companyAgents,
  strategicProposals,
  decisionsInboxItems,
  organizations,
  payments,
} from "@shared/schema";
import { and, desc, eq, gte, isNotNull, lt, sql } from "drizzle-orm";
import { logger } from "../utils/logger";
import { routeCriticalTask } from "./aiRouter";

export interface WeeklyProposalsResult {
  weekKey: string;
  agentsScanned: number;
  proposalsCreated: number;
}

export interface SynthesisResult {
  monthKey: string;
  weekProposalsRead: number;
  synthesizedCount: number;
}

// ── Public API ──────────────────────────────────────────────────────

export async function runWeeklyProposals(): Promise<WeeklyProposalsResult> {
  const weekKey = isoWeekKey(new Date());
  const agents = await db
    .select()
    .from(companyAgents)
    .where(eq(companyAgents.status, "active"));

  if (agents.length === 0) {
    logger.warn("[strategicProposals] no active agents, skipping weekly run");
    return { weekKey, agentsScanned: 0, proposalsCreated: 0 };
  }

  // Skip if we've already run this week.
  const [existing] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(strategicProposals)
    .where(eq(strategicProposals.weekKey, weekKey));
  if (Number(existing?.c ?? 0) >= agents.length) {
    logger.info(`[strategicProposals] week ${weekKey} already has ${existing.c} proposals, skipping`);
    return { weekKey, agentsScanned: agents.length, proposalsCreated: 0 };
  }

  const domainSummary = await buildWeeklyDomainSummary(agents);
  const proposals = await askLLMForWeeklyProposals(weekKey, domainSummary, agents);
  let created = 0;
  for (const p of proposals) {
    try {
      await db.insert(strategicProposals).values({
        proposedBy: p.agentCodename,
        weekKey,
        title: p.title.slice(0, 200),
        rationale: p.rationale.slice(0, 2000),
        estimatedImpactCents: p.estimatedImpactCents ?? null,
        confidence: Math.max(0, Math.min(100, p.confidence ?? 50)),
        category: p.category,
        supportingDataKeys: p.supportingDataKeys ?? [],
        status: "proposed",
      });
      created++;
    } catch (err: any) {
      logger.warn("[strategicProposals] insert failed", {
        metadata: { error: err?.message, title: p.title },
      });
    }
  }
  logger.info(`[strategicProposals] week ${weekKey}: ${created} proposals from ${agents.length} agents`);
  return { weekKey, agentsScanned: agents.length, proposalsCreated: created };
}

export async function runMonthlySynthesis(
  explicitMonthKey?: string,
): Promise<SynthesisResult> {
  const { monthKey, monthStart, monthEnd } = resolveSynthesisMonth(explicitMonthKey);

  // Gather weekly proposals from the month in question.
  const weekly = await db
    .select()
    .from(strategicProposals)
    .where(
      and(
        gte(strategicProposals.createdAt, monthStart),
        lt(strategicProposals.createdAt, monthEnd),
        eq(strategicProposals.status, "proposed"),
      ),
    );
  if (weekly.length === 0) {
    logger.info(`[strategicProposals] no weekly proposals to synthesize for ${monthKey}`);
    return { monthKey, weekProposalsRead: 0, synthesizedCount: 0 };
  }

  const synthesized = await askLLMForMonthlySynthesis(monthKey, weekly);
  let saved = 0;
  for (const s of synthesized) {
    try {
      await db.insert(strategicProposals).values({
        proposedBy: "synthesis",
        weekKey: isoWeekKey(monthStart),
        monthKey,
        title: s.title.slice(0, 200),
        rationale: s.rationale.slice(0, 2000),
        estimatedImpactCents: s.estimatedImpactCents ?? null,
        confidence: Math.max(0, Math.min(100, s.confidence ?? 50)),
        category: s.category,
        supportingDataKeys: s.supportingDataKeys ?? [],
        status: "synthesized",
      });
      saved++;
    } catch (err: any) {
      logger.warn("[strategicProposals] synthesis insert failed", {
        metadata: { error: err?.message },
      });
    }
  }
  logger.info(`[strategicProposals] synthesis ${monthKey}: ${saved} picked from ${weekly.length} weekly`);
  return { monthKey, weekProposalsRead: weekly.length, synthesizedCount: saved };
}

export async function listSynthesizedForMonth(monthKey: string) {
  return db
    .select()
    .from(strategicProposals)
    .where(
      and(
        eq(strategicProposals.monthKey, monthKey),
        eq(strategicProposals.status, "synthesized"),
      ),
    )
    .orderBy(desc(strategicProposals.confidence));
}

export async function listPendingProposals() {
  return db
    .select()
    .from(strategicProposals)
    .where(
      sql`${strategicProposals.status} IN ('proposed', 'synthesized')`,
    )
    .orderBy(desc(strategicProposals.createdAt))
    .limit(50);
}

export async function resolveProposal(
  id: number,
  status: "approved" | "rejected" | "deferred",
  feedback?: string,
  resolvedBy?: string,
) {
  await db
    .update(strategicProposals)
    .set({
      status,
      founderFeedback: feedback ?? null,
      resolvedAt: new Date(),
      resolvedBy: resolvedBy ?? "founder",
    })
    .where(eq(strategicProposals.id, id));
}

// ── LLM calls ───────────────────────────────────────────────────────

interface LLMProposal {
  agentCodename: string;
  title: string;
  rationale: string;
  estimatedImpactCents?: number | null;
  confidence?: number;
  category: string;
  supportingDataKeys?: string[];
}

async function askLLMForWeeklyProposals(
  weekKey: string,
  domainSummary: string,
  agents: Array<{ codename: string; title: string; wing: string; personalityPrompt: string | null }>,
): Promise<LLMProposal[]> {
  const agentList = agents
    .map((a) => `- ${a.codename} (${a.title}, ${a.wing} wing)`)
    .join("\n");
  const context = `WEEK: ${weekKey}

AGENT ROSTER:
${agentList}

DOMAIN SIGNAL SUMMARY (last 7 days):
${domainSummary}

Task:
For each agent in the roster, propose 1–2 strategic moves their domain should make THIS WEEK. Focus on proactive moves, not reactive fixes to things already in the inbox. Skip agents whose domain has no clear opportunity right now ("no proposal" is a valid answer for an agent).

Rules:
- Proposals must be specific, actionable, and measurable (with a dollar impact estimate where credible).
- No vague proposals like "improve retention" — name the mechanism.
- Respect the founder's prior reversals visible in the summary. Do not re-propose rejected patterns.
- Land Investors, never "real estate professionals" or "users."
- No competitor references.

Output JSON (no code fences):
{
  "proposals": [
    {
      "agentCodename": "<codename>",
      "title": "<one-line title>",
      "rationale": "<2-4 sentences on why now and expected effect>",
      "estimatedImpactCents": <integer or null>,
      "confidence": <0-100>,
      "category": "revenue|retention|product|ops|risk",
      "supportingDataKeys": ["<key1>", "<key2>"]
    }
  ]
}`;

  try {
    const response = await routeCriticalTask(
      "strategic_weekly_proposals",
      WEEKLY_SYSTEM_PROMPT,
      context,
    );
    const parsed = parseJSON(response.content);
    const arr = Array.isArray(parsed?.proposals) ? parsed.proposals : [];
    return arr.filter((p: any) => p?.agentCodename && p?.title && p?.rationale && p?.category);
  } catch (err: any) {
    logger.warn("[strategicProposals] weekly LLM call failed", {
      metadata: { error: err?.message },
    });
    return [];
  }
}

async function askLLMForMonthlySynthesis(
  monthKey: string,
  weekly: Array<typeof strategicProposals.$inferSelect>,
): Promise<LLMProposal[]> {
  const weeklyLines = weekly
    .map(
      (p) =>
        `- [${p.proposedBy}] ${p.category}/${p.confidence}% | "${p.title}" — ${p.rationale.slice(0, 200)}${p.estimatedImpactCents ? ` ($${(p.estimatedImpactCents / 100).toFixed(0)})` : ""}`,
    )
    .join("\n");
  const context = `MONTH: ${monthKey}

WEEKLY PROPOSALS (${weekly.length} total):
${weeklyLines}

Task:
Pick the top 3-5 proposals to pursue this month. Prefer proposals that:
- Recurred across multiple weeks (the signal is persistent, not a fluke)
- Have the highest expected impact per unit risk
- Are specific and measurable

Synthesize similar proposals into one coherent "company move" each. A good synthesis combines related weekly proposals from different agents into a single strategic thrust (e.g. two retention proposals + one pricing proposal become "run a 60-day retention sprint on enterprise-tier churn with a pricing-lever A/B test").

If fewer than 3 of the weekly proposals meet the bar, output fewer. "Hold steady this month" is a valid answer if nothing is high-signal.

Rules:
- Same voice/style rules as the weekly call.
- The 'agentCodename' field becomes the proposal's owner — name the agent best-positioned to lead it.
- Confidence should reflect your certainty in the synthesis, not the average of inputs.

Output JSON (no code fences):
{
  "synthesized": [
    { same shape as weekly proposal }
  ]
}`;

  try {
    const response = await routeCriticalTask(
      "strategic_monthly_synthesis",
      SYNTHESIS_SYSTEM_PROMPT,
      context,
    );
    const parsed = parseJSON(response.content);
    const arr = Array.isArray(parsed?.synthesized) ? parsed.synthesized : [];

    // The synthesis call can also surface tool proposals — route those
    // to the tool-proposals pipeline now while we have the parsed JSON.
    const tools = Array.isArray(parsed?.toolProposals) ? parsed.toolProposals : [];
    if (tools.length > 0) {
      try {
        const { proposeTool } = await import("./toolProposals");
        for (const t of tools) {
          if (!t?.title || !t?.description || !t?.category) continue;
          await proposeTool({
            proposedBy: "synthesis",
            title: t.title,
            description: t.description,
            category: t.category,
            capabilityGap: t.capabilityGap ?? "",
            expectedBenefit: t.expectedBenefit ?? "",
            estimatedComplexity: t.estimatedComplexity ?? "medium",
            estimatedImpactCents: t.estimatedImpactCents ?? null,
            supportingEvidence: { source: `synthesis-${monthKey}` },
          });
        }
        logger.info(`[strategicProposals] synthesis surfaced ${tools.length} tool proposals`);
      } catch (err: any) {
        logger.warn("[strategicProposals] tool proposal forwarding failed", {
          metadata: { error: err?.message },
        });
      }
    }

    return arr.filter((p: any) => p?.agentCodename && p?.title && p?.rationale && p?.category);
  } catch (err: any) {
    logger.warn("[strategicProposals] synthesis LLM call failed", {
      metadata: { error: err?.message },
    });
    return [];
  }
}

// ── Domain summary ──────────────────────────────────────────────────

async function buildWeeklyDomainSummary(
  agents: Array<typeof companyAgents.$inferSelect>,
): Promise<string> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [orgStats, paymentStats, decisionStats, recentReversals] =
    await Promise.all([
      db
        .select({
          total: sql<number>`count(*)::int`,
          past_due: sql<number>`sum(case when subscription_status = 'past_due' then 1 else 0 end)::int`,
          active: sql<number>`sum(case when subscription_status = 'active' then 1 else 0 end)::int`,
        })
        .from(organizations),
      db
        .select({
          last7_count: sql<number>`count(*)::int`,
          last7_total: sql<number>`coalesce(sum(amount_cents), 0)::int`,
        })
        .from(payments)
        .where(gte(payments.createdAt, since)),
      db
        .select({
          total: sql<number>`count(*)::int`,
          auto: sql<number>`sum(case when status = 'auto_resolved' then 1 else 0 end)::int`,
          reversed: sql<number>`sum(case when founder_override_action is not null then 1 else 0 end)::int`,
        })
        .from(decisionsInboxItems)
        .where(gte(decisionsInboxItems.createdAt, since)),
      db
        .select({
          agent: decisionsInboxItems.ownerAgentCodename,
          label: decisionsInboxItems.recommendedActionLabel,
          action: decisionsInboxItems.founderOverrideAction,
          outcome: decisionsInboxItems.actualOutcome,
        })
        .from(decisionsInboxItems)
        .where(
          and(
            isNotNull(decisionsInboxItems.founderOverrideAction),
            gte(decisionsInboxItems.resolvedAt, since),
          ),
        )
        .limit(6),
    ]);

  const orgs = orgStats[0];
  const pay = paymentStats[0];
  const dec = decisionStats[0];

  const lines: string[] = [];
  lines.push(
    `Organizations: ${orgs?.total ?? 0} total, ${orgs?.active ?? 0} active, ${orgs?.past_due ?? 0} past-due`,
  );
  lines.push(
    `Payments (7d): ${pay?.last7_count ?? 0} charges totaling $${((pay?.last7_total ?? 0) / 100).toFixed(0)}`,
  );
  lines.push(
    `Decisions (7d): ${dec?.total ?? 0} total, ${dec?.auto ?? 0} auto-resolved, ${dec?.reversed ?? 0} founder-reversed`,
  );
  if (recentReversals.length > 0) {
    lines.push(``);
    lines.push(`Recent founder reversals (do not re-propose these patterns):`);
    for (const r of recentReversals) {
      lines.push(
        `  - [${r.agent ?? "agent"}] "${(r.label ?? "").slice(0, 80)}" → ${r.action}${r.outcome ? ` (${r.outcome.slice(0, 80)})` : ""}`,
      );
    }
  }
  return lines.join("\n");
}

// ── Helpers ─────────────────────────────────────────────────────────

function isoWeekKey(d: Date): string {
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNr = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNr + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const week = 1 +
    Math.round(
      ((target.getTime() - firstThursday.getTime()) / 86400000 -
        3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7,
    );
  return `${target.getUTCFullYear()}-${String(week).padStart(2, "0")}`;
}

function resolveSynthesisMonth(explicit?: string): {
  monthKey: string;
  monthStart: Date;
  monthEnd: Date;
} {
  const now = new Date();
  let year: number, month: number;
  if (explicit) {
    const [y, m] = explicit.split("-").map((n) => parseInt(n, 10));
    year = y;
    month = m - 1;
  } else {
    year = now.getUTCFullYear();
    month = now.getUTCMonth() - 1;
    if (month < 0) {
      month = 11;
      year -= 1;
    }
  }
  const monthStart = new Date(Date.UTC(year, month, 1));
  const monthEnd = new Date(Date.UTC(year, month + 1, 1));
  const monthKey = `${year}-${String(month + 1).padStart(2, "0")}`;
  return { monthKey, monthStart, monthEnd };
}

function parseJSON(raw: string): any {
  const cleaned = raw.replace(/```json\n?|```/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

// ── System prompts ──────────────────────────────────────────────────

const WEEKLY_SYSTEM_PROMPT = `You are the AcreOS Strategic Advisory Board. You see all 12 agents' domains at once and propose moves the company should make proactively — not fixes to things already in the inbox.

Principles:
- Specificity beats breadth. Name the mechanism and the metric.
- Respect founder reversals. If the founder rejected a pattern, don't re-propose it.
- Small bets > big bets. The monthly synthesizer will pick the best to concentrate on.
- Conservative impact estimates. Err on the side of understating expected impact.
- Use plain English and Land Investors terminology.`;

const SYNTHESIS_SYSTEM_PROMPT = `You are the AcreOS Chief of Staff synthesizing a month's strategic proposals into 3-5 concrete company moves AND surfacing tool gaps.

Principles:
- Prefer recurring signals across multiple weekly proposals — a pattern that repeats is stronger than a one-time proposal.
- Synthesize related proposals into single company moves rather than listing 12 separate items.
- It is acceptable to output fewer than 3 if the month is genuinely quiet.
- Confidence should reflect your certainty in the synthesized move, not the average of inputs.

Additionally: if the weekly proposals contain any recurring signal that "we couldn't act because we lack data/integration/capability X," emit a separate toolProposals array. These are engineering-backlog items, distinct from the strategic moves.

Output JSON (no code fences):
{
  "synthesized": [ /* same shape as weekly proposal */ ],
  "toolProposals": [
    {
      "title": "<one-line title>",
      "description": "<2-4 sentences on what this tool is>",
      "category": "integration|data_source|capability|rubric",
      "capabilityGap": "<what the team can't do today without it>",
      "expectedBenefit": "<what becomes possible after shipping>",
      "estimatedComplexity": "low|medium|high",
      "estimatedImpactCents": <integer or null>
    }
  ]
}`;
