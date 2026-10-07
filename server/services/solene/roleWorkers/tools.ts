/**
 * The role workers' BUSINESS tools (Stage 2) — what a Support / Retention
 * employee can actually do, in place of file_read / git_commit / run_tests.
 *
 * Every customer-facing or money-moving effect goes through an EXISTING hand
 * via the dispatch executor (executeDispatchTool), so it inherits every wall
 * that path already has: the constitutional screen, the witnessed-send freeze
 * (pending action → founder tap or a founder-issued WitnessGrant), the
 * refund ceiling inside apply_refund, the system-only recipient rule inside
 * send_email. These tools only add what a model must never choose freely:
 *   • WHO — the recipient is resolved from the ticket / the org row, never a
 *     model-supplied address;
 *   • WHAT CAN BE REFUNDED — only a purchase the ticket's own org made, never
 *     more than it cost, never over the hand's $50 ceiling;
 *   • WHO MAY BE EMAILED — only an org on today's at-risk list, not
 *     unsubscribed, not emailed for the same reason in the last 7 days.
 *
 * Reads are platform-scope by design: the support desk and the retention desk
 * serve every AcreOS customer (AcreOS operating itself — Level-1 work).
 */
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import {
  autopilotPendingActions,
  creditTransactions,
  organizations,
  supportTicketMessages,
  supportTickets,
} from "@shared/schema";
import { unscopedForPlatformOps } from "../../../utils/orgScopedDb";
import { logger } from "../../../utils/logger";
import type { RoleWorker } from "./routing";
// The $50 hand ceiling, mirrored for an early, explainable refusal (the hand
// itself still enforces it — this only lets the worker say why).
import { REFUND_CEILING_CENTS } from "../../autopilot/hands/apply-refund";

export interface RoleToolSchema {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

/** What a tool call accomplished, for the runner's "did any work happen" check. */
export type RoleEffect = "drafted_reply" | "drafted_refund" | "escalated" | "drafted_email";

export interface RoleToolResult {
  success: boolean;
  output: string;
  effect?: RoleEffect;
}

export interface RoleToolContext {
  dispatchId: number;
  /**
   * The ONE ticket (and its org) this Support run was briefed on. Support tools
   * act on that ticket only — another ticket id, or a run with no briefed
   * ticket, is refused. One org per model context (audit M2).
   */
  ticketId?: number;
  organizationId?: number;
}

import { SUPPORT_WORKER_AGENT, FOUNDER_AGENT } from "./routing";
import { clock } from "../../../utils/clock";
export { SUPPORT_WORKER_AGENT, FOUNDER_AGENT };


const SUPPORT_TOOLS: RoleToolSchema[] = [
  {
    name: "list_recent_purchases",
    description: "List the purchases (credit packs, add-ons) the ticket's organization made in the last 90 days: amount, description, payment id, date. The only purchases you may refund.",
    input_schema: { type: "object", properties: { ticket_id: { type: "number" } }, required: ["ticket_id"] },
  },
  {
    name: "refund_purchase",
    description: `Draft a refund of a purchase list_recent_purchases returned for this ticket's organization. At most the purchase amount and at most $${(REFUND_CEILING_CENTS / 100).toFixed(2)} — anything larger must be escalated to the founder. Goes out once witnessed.`,
    input_schema: {
      type: "object",
      properties: {
        ticket_id: { type: "number" },
        payment_intent_id: { type: "string" },
        amount_cents: { type: "number" },
        reason: { type: "string" },
      },
      required: ["ticket_id", "payment_intent_id", "amount_cents", "reason"],
    },
  },
  {
    name: "reply_to_ticket",
    description: "Draft the reply to a ticket. It is posted on the ticket and the customer who opened it is told by AcreOS system mail, once witnessed. resolve=true when it fully answers the request.",
    input_schema: {
      type: "object",
      properties: { ticket_id: { type: "number" }, message: { type: "string" }, resolve: { type: "boolean" } },
      required: ["ticket_id", "message", "resolve"],
    },
  },
  {
    name: "escalate_to_founder",
    description: "Hand a ticket to the founder (refund over $50, anything legal, data deletion, pricing exceptions, an undiagnosable bug). Opens one founder ask naming the ticket.",
    input_schema: {
      type: "object",
      properties: { ticket_id: { type: "number" }, summary: { type: "string" }, why: { type: "string" } },
      required: ["ticket_id", "summary", "why"],
    },
  },
];

const RETENTION_TOOLS: RoleToolSchema[] = [
  {
    name: "email_customer",
    description: "Draft one AcreOS system email to the OWNER of an org on today's at-risk list (kind: payment_recovery | win_back | trial_ending). The address is looked up for you. Refused for unsubscribed customers, for orgs not on the list, and when the same kind went to that org in the last 7 days. Goes out once witnessed.",
    input_schema: {
      type: "object",
      properties: {
        organization_id: { type: "number" },
        kind: { type: "string", enum: ["payment_recovery", "win_back", "trial_ending"] },
        subject: { type: "string" },
        html: { type: "string" },
      },
      required: ["organization_id", "kind", "subject", "html"],
    },
  },
];

/** The tool list each role sees. The Writer has none (its output is the PUBLISH block); Ops runs no model. */
export function roleToolSchemas(role: RoleWorker): RoleToolSchema[] {
  if (role === "support") return SUPPORT_TOOLS;
  if (role === "retention") return RETENTION_TOOLS;
  return [];
}

const PLATFORM_SUPPORT = "Solene support role worker: the AcreOS support desk serves every customer's tickets (AcreOS operating itself)";
const PLATFORM_RETENTION = "Solene retention role worker: AcreOS's own at-risk customers across every org (system mail to its own users)";
const PLATFORM_WRITER = "Solene writer role worker: AcreOS's own published field notes (one shared public surface)";

// ── Support ─────────────────────────────────────────────────────────────────

/**
 * The ONE ticket waiting on AcreOS that no worker or founder has picked up yet
 * (oldest first). A Support run works exactly one ticket, so one model
 * context never holds two organizations' tickets (audit M2). Selecting which
 * ticket is next is the platform-scope read; everything after it is scoped to
 * that ticket's organization.
 */
async function nextWaitingTicket() {
  const [ticket] = await unscopedForPlatformOps(PLATFORM_SUPPORT)
    .select({
      id: supportTickets.id,
      organizationId: supportTickets.organizationId,
      subject: supportTickets.subject,
      description: supportTickets.description,
      category: supportTickets.category,
      status: supportTickets.status,
      createdAt: supportTickets.createdAt,
    })
    .from(supportTickets)
    .where(
      sql`${supportTickets.resolutionType} = 'escalated' and ${supportTickets.status} not in ('resolved', 'closed')
          and coalesce(${supportTickets.assignedAgent}, '') not in (${SUPPORT_WORKER_AGENT}, ${FOUNDER_AGENT})`,
    )
    .orderBy(supportTickets.createdAt)
    .limit(1);
  if (!ticket) return null;
  const msgs = await unscopedForPlatformOps(PLATFORM_SUPPORT)
    .select({ role: supportTicketMessages.role, content: supportTicketMessages.content })
    .from(supportTicketMessages)
    .where(eq(supportTicketMessages.ticketId, ticket.id))
    .orderBy(supportTicketMessages.id);
  const [org] = await unscopedForPlatformOps(PLATFORM_SUPPORT)
    .select({ id: organizations.id, name: organizations.name, tier: organizations.subscriptionTier, status: organizations.subscriptionStatus })
    .from(organizations)
    .where(eq(organizations.id, ticket.organizationId))
    .limit(1);
  return { ...ticket, org: org ?? null, recentMessages: msgs.slice(-4) };
}

/** The briefed ticket, read within its organization. */
async function ticketInOrg(organizationId: number, ticketId: number) {
  const [t] = await unscopedForPlatformOps(PLATFORM_SUPPORT)
    .select()
    .from(supportTickets)
    .where(and(eq(supportTickets.id, ticketId), eq(supportTickets.organizationId, organizationId)))
    .limit(1);
  return t ?? null;
}

async function purchasesForOrg(organizationId: number) {
  const since = new Date(clock.nowMs() - 90 * 24 * 3600_000);
  return unscopedForPlatformOps(PLATFORM_SUPPORT)
    .select({
      id: creditTransactions.id,
      amountCents: creditTransactions.amountCents,
      description: creditTransactions.description,
      paymentIntentId: creditTransactions.stripePaymentIntentId,
      at: creditTransactions.createdAt,
    })
    .from(creditTransactions)
    .where(
      and(
        eq(creditTransactions.organizationId, organizationId),
        eq(creditTransactions.type, "purchase"),
        gte(creditTransactions.createdAt, since),
      ),
    )
    .orderBy(desc(creditTransactions.createdAt))
    .limit(20);
}

/** Mark a ticket picked up so the backlog sense stops counting it (never overwrite a founder hand-off). */
async function assignTicket(organizationId: number, ticketId: number, agent: string) {
  const db = unscopedForPlatformOps(PLATFORM_SUPPORT);
  if (agent === FOUNDER_AGENT) {
    await db.update(supportTickets).set({ assignedAgent: FOUNDER_AGENT, status: "in_progress", updatedAt: clock.now() }).where(and(eq(supportTickets.id, ticketId), eq(supportTickets.organizationId, organizationId)));
    return;
  }
  await db
    .update(supportTickets)
    .set({ assignedAgent: agent, status: "in_progress", updatedAt: clock.now() })
    .where(and(eq(supportTickets.id, ticketId), eq(supportTickets.organizationId, organizationId), sql`coalesce(${supportTickets.assignedAgent}, '') <> ${FOUNDER_AGENT}`));
}

/** Freeze a hand through the dispatch executor (constitutional screen + witnessed-send). */
async function freezeHand(role: RoleWorker, handName: string, args: Record<string, unknown>, ctx: RoleToolContext): Promise<{ pendingId: number | null; output: string }> {
  const { executeDispatchTool } = await import("../dispatchToolExecutor");
  const r = await executeDispatchTool(handName, args, { dispatchId: ctx.dispatchId, agentRole: "general-purpose", untrusted: true, sourceRole: role });
  const m = /pending action #(\d+)/.exec(r.output);
  return { pendingId: m ? Number(m[1]) : null, output: r.output };
}

// ── Retention ───────────────────────────────────────────────────────────────

export interface AtRiskCustomer {
  organizationId: number;
  name: string;
  kind: "payment_recovery" | "win_back" | "trial_ending";
  detail: string;
}

/**
 * Today's eligible retention list — the ONLY orgs email_customer may reach.
 *   payment_recovery — in dunning AND the dunning service has not emailed for
 *     the latest failed invoice (it owns those emails; the worker only covers
 *     the gap, never a second email about the same payment);
 *   win_back — cancelled in the last 60 days, or a paying customer the churn
 *     engine flagged as quiet (autopilot_senses churn_signal, last 14 days);
 *   trial_ending — an in-app trial ending in the next 3 days.
 * Founder orgs are never on it.
 */
async function listAtRiskCustomers(now = clock.now()): Promise<AtRiskCustomer[]> {
  const db = unscopedForPlatformOps(PLATFORM_RETENTION);
  const rows = await db.execute(sql`
    select o.id, o.name, o.dunning_stage, o.subscription_status, o.subscription_tier,
           o.trial_ends_at, o.subscription_ended_at,
           (q.org_id is not null) as quiet, coalesce(ld.sent, 0) as dunning_emails
      from organizations o
      left join (
        select distinct (detail->>'org')::int as org_id
          from autopilot_senses
         where kind = 'churn_signal' and detail->>'org' ~ '^[0-9]+$'
           and observed_at > ${new Date(now.getTime() - 14 * 24 * 3600_000)}
      ) q on q.org_id = o.id
      left join (
        select distinct on (organization_id) organization_id, coalesce(jsonb_array_length(notifications_sent), 0) as sent
          from dunning_events
         where event_type = 'payment_failed'
         order by organization_id, id desc
      ) ld on ld.organization_id = o.id
     where coalesce(o.is_founder, false) = false and (
        (coalesce(o.dunning_stage, 'none') not in ('none', 'cancelled') and coalesce(ld.sent, 0) = 0)
        or (o.subscription_status in ('canceled', 'cancelled') and o.subscription_ended_at > ${new Date(now.getTime() - 60 * 24 * 3600_000)})
        or (q.org_id is not null and o.subscription_status = 'active')
        or (o.subscription_tier = 'free' and o.trial_ends_at between ${now} and ${new Date(now.getTime() + 3 * 24 * 3600_000)})
     )
     limit 50`);
  type Row = { id: number; name: string; dunning_stage: string | null; subscription_status: string; subscription_tier: string; trial_ends_at: Date | null; subscription_ended_at: Date | null; quiet: boolean };
  return (rows.rows as Row[]).map((r) => {
    if (r.dunning_stage && r.dunning_stage !== "none" && r.dunning_stage !== "cancelled" && !r.quiet) {
      return { organizationId: r.id, name: r.name, kind: "payment_recovery" as const, detail: `subscription payment failed — dunning stage ${r.dunning_stage}; no dunning email has gone out yet` };
    }
    if (r.subscription_status === "canceled" || r.subscription_status === "cancelled") {
      return { organizationId: r.id, name: r.name, kind: "win_back" as const, detail: `cancelled ${r.subscription_ended_at ? new Date(r.subscription_ended_at).toISOString().slice(0, 10) : "recently"}` };
    }
    if (r.quiet) {
      return { organizationId: r.id, name: r.name, kind: "win_back" as const, detail: "paying customer gone quiet (churn engine signal)" };
    }
    return { organizationId: r.id, name: r.name, kind: "trial_ending" as const, detail: `trial ends ${r.trial_ends_at ? new Date(r.trial_ends_at).toISOString().slice(0, 10) : "soon"}` };
  });
}

async function recentlyEmailed(organizationId: number, kind: string): Promise<boolean> {
  const since = new Date(clock.nowMs() - 7 * 24 * 3600_000);
  const rows = await unscopedForPlatformOps(PLATFORM_RETENTION)
    .select({ id: autopilotPendingActions.id })
    .from(autopilotPendingActions)
    .where(
      and(
        eq(autopilotPendingActions.handName, "send_email"),
        gte(autopilotPendingActions.createdAt, since),
        sql`${autopilotPendingActions.status} in ('pending', 'approved', 'executed')`,
        sql`(${autopilotPendingActions.args}->>'organization_id')::int = ${organizationId}`,
        sql`${autopilotPendingActions.args}->>'retention_kind' = ${kind}`,
      ),
    )
    .limit(1);
  return rows.length > 0;
}

// ── Writer ──────────────────────────────────────────────────────────────────

async function recentTitles(limit = 20): Promise<string[]> {
  const { communityLetters } = await import("@shared/schema");
  const rows = await unscopedForPlatformOps(PLATFORM_WRITER)
    .select({ subject: communityLetters.subject })
    .from(communityLetters)
    .orderBy(desc(communityLetters.id))
    .limit(limit);
  return rows.map((r) => r.subject);
}

// ── Briefings ───────────────────────────────────────────────────────────────

export interface Briefing {
  text: string;
  /** How many work items the briefing carries (0 ⇒ nothing to do). */
  items: number;
  /** Support: the one ticket (and org) the run is bound to. */
  scope?: { ticketId: number; organizationId: number };
}

/** The work a role worker is handed, read fresh at run time. */
export async function buildBriefing(role: RoleWorker): Promise<Briefing> {
  if (role === "support") {
    const t = await nextWaitingTicket();
    if (!t) return { text: "No tickets are waiting.", items: 0 };
    const text = [
      `## The ticket you are working (one ticket per run)`,
      "",
      [
        `### Ticket #${t.id} — ${t.subject}`,
        `- Organization: #${t.organizationId}${t.org ? ` "${t.org.name}" (${t.org.tier}, ${t.org.status})` : ""}`,
        `- Category: ${t.category}; opened ${t.createdAt?.toISOString() ?? "unknown"}`,
        `- Customer wrote: ${t.description}`,
        ...t.recentMessages.map((m) => `- ${m.role}: ${m.content.slice(0, 400)}`),
      ].join("\n"),
    ].join("\n");
    return { text, items: 1, scope: { ticketId: t.id, organizationId: t.organizationId } };
  }
  if (role === "retention") {
    const list = await listAtRiskCustomers();
    if (list.length === 0) return { text: "No customers are at risk today.", items: 0 };
    return {
      text: [`## Eligible customers today (${list.length})`, ...list.map((c) => `- Org #${c.organizationId} "${c.name}" — ${c.kind}: ${c.detail}`)].join("\n"),
      items: list.length,
    };
  }
  if (role === "writer") {
    const titles = await recentTitles();
    return {
      text: titles.length
        ? ["## Already published — do not repeat these topics", ...titles.map((t) => `- ${t}`)].join("\n")
        : "## Already published\nNothing yet — this is the first piece.",
      items: 1,
    };
  }
  return { text: "", items: 1 };
}

// ── Execution ───────────────────────────────────────────────────────────────

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.floor(v) : NaN);
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

export async function executeRoleTool(
  role: RoleWorker,
  name: string,
  input: Record<string, unknown>,
  ctx: RoleToolContext,
): Promise<RoleToolResult> {
  try {
    if (!roleToolSchemas(role).some((t) => t.name === name)) {
      return { success: false, output: `${name} is not one of the ${role} worker's tools.` };
    }
    if (role === "support") return await executeSupportRoleTool(name, input, ctx);
    if (role === "retention") return await executeRetentionRoleTool(name, input, ctx);
    return { success: false, output: `${role} has no tools.` };
  } catch (err) {
    logger.warn(`[roleWorkers] ${role}.${name} threw`, err instanceof Error ? err : undefined);
    return { success: false, output: `${name} failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

async function executeSupportRoleTool(name: string, input: Record<string, unknown>, ctx: RoleToolContext): Promise<RoleToolResult> {
  // Bound to the briefed ticket: one ticket, one org, per run.
  if (ctx.ticketId == null || ctx.organizationId == null) {
    return { success: false, output: "This Support run was not briefed on a ticket; no ticket tool may act." };
  }
  const ticketId = num(input.ticket_id);
  if (ticketId !== ctx.ticketId) {
    return { success: false, output: `You are working ticket #${ctx.ticketId} only — ticket #${input.ticket_id} is not yours in this run.` };
  }
  const ticket = await ticketInOrg(ctx.organizationId, ctx.ticketId);
  if (!ticket) return { success: false, output: `ticket #${input.ticket_id} not found.` };

  if (name === "list_recent_purchases") {
    const rows = await purchasesForOrg(ticket.organizationId);
    return {
      success: true,
      output: rows.length
        ? JSON.stringify(rows.map((r) => ({ amount_cents: r.amountCents, description: r.description, payment_intent_id: r.paymentIntentId, at: r.at })))
        : "No purchases in the last 90 days for this organization.",
    };
  }

  if (name === "refund_purchase") {
    const amount = num(input.amount_cents);
    const pi = str(input.payment_intent_id);
    if (!pi || !Number.isFinite(amount) || amount <= 0) return { success: false, output: "refund_purchase: payment_intent_id and a positive amount_cents are required." };
    if (amount > REFUND_CEILING_CENTS) {
      return { success: false, output: `refund_purchase refused: $${(amount / 100).toFixed(2)} is over the $${(REFUND_CEILING_CENTS / 100).toFixed(2)} limit. Escalate this ticket to the founder.` };
    }
    const purchase = (await purchasesForOrg(ticket.organizationId)).find((p) => p.paymentIntentId === pi);
    if (!purchase) return { success: false, output: `refund_purchase refused: ${pi} is not a purchase this ticket's organization made in the last 90 days.` };
    // Never refund the same payment twice: anything already drafted, approved
    // or executed against it counts toward what it cost.
    const prior = await unscopedForPlatformOps(PLATFORM_SUPPORT)
      .select({ args: autopilotPendingActions.args })
      .from(autopilotPendingActions)
      .where(
        and(
          eq(autopilotPendingActions.handName, "apply_refund"),
          sql`${autopilotPendingActions.status} in ('pending', 'approved', 'executed')`,
          sql`${autopilotPendingActions.args}->>'charge_id' = ${pi}`,
        ),
      );
    const already = prior.reduce((a, r) => a + Number((r.args as { amount_cents?: number } | null)?.amount_cents ?? 0), 0);
    if (already > 0) return { success: false, output: `refund_purchase refused: $${(already / 100).toFixed(2)} of ${pi} is already refunded or awaiting its witness — never twice.` };
    if (amount > purchase.amountCents) return { success: false, output: `refund_purchase refused: $${(amount / 100).toFixed(2)} is more than the purchase ($${(purchase.amountCents / 100).toFixed(2)}).` };
    const frozen = await freezeHand("support", "apply_refund", { charge_id: pi, amount_cents: amount, reason: `ticket #${ticket.id}: ${str(input.reason).slice(0, 300)}`, organization_id: ticket.organizationId }, ctx);
    if (frozen.pendingId == null) return { success: false, output: frozen.output };
    return { success: true, effect: "drafted_refund", output: `Refund of $${(amount / 100).toFixed(2)} drafted (pending action #${frozen.pendingId}); it goes out once witnessed. Do not tell the customer it has already been refunded — say it is being processed.` };
  }

  if (name === "reply_to_ticket") {
    const message = str(input.message);
    if (!message) return { success: false, output: "reply_to_ticket: message is required." };
    // The honesty screen, with the amounts this ticket is ABOUT allowed: a
    // dollar figure the customer wrote, or one of their own purchases, is a
    // fact of the case, not an invented statistic.
    const { screenFabrication } = await import("../../autopilot/contentHonesty");
    const known = new Set<string>();
    for (const m of `${ticket.subject} ${ticket.description}`.matchAll(/\$\s?\d[\d,]*(?:\.\d+)?/g)) known.add(m[0]);
    for (const p of await purchasesForOrg(ticket.organizationId)) {
      known.add(`$${(p.amountCents / 100).toFixed(2)}`);
      if (p.amountCents % 100 === 0) known.add(`$${p.amountCents / 100}`);
    }
    for (const v of [...known]) known.add(v.replace(/\.00$/, "")).add(/\./.test(v) ? v : `${v}.00`);
    const fab = screenFabrication(message, { allowDollarFigures: [...known] });
    if (fab.length > 0) return { success: false, output: `reply_to_ticket refused by the honesty screen: ${fab.map((v) => v.message).join(" ")}` };
    const frozen = await freezeHand("support", "reply_support_ticket", { ticket_id: ticket.id, organization_id: ticket.organizationId, message, resolve: input.resolve === true }, ctx);
    if (frozen.pendingId == null) return { success: false, output: frozen.output };
    await assignTicket(ticket.organizationId, ticket.id, SUPPORT_WORKER_AGENT);
    return { success: true, effect: "drafted_reply", output: `Reply to ticket #${ticket.id} drafted (pending action #${frozen.pendingId}); it is posted and emailed once witnessed.` };
  }

  if (name === "escalate_to_founder") {
    const summary = str(input.summary).slice(0, 150) || ticket.subject;
    const why = str(input.why);
    const { askFounder } = await import("../founderCollab");
    const r = await askFounder({
      askingAgentRole: "general-purpose",
      questionSummary: `Support ticket #${ticket.id} needs you: ${summary}`,
      questionBody: [
        `Ticket #${ticket.id} from organization #${ticket.organizationId}: "${ticket.subject}"`,
        `The customer wrote: ${ticket.description.slice(0, 1200)}`,
        "",
        `Why this is yours: ${why || "it is outside what the support worker may do on its own."}`,
        "",
        "I have told the customer you are reviewing it and promised no outcome. Answering here records your decision; anything it needs (a refund over $50, a legal reply) is done by you — I will not do it.",
      ].join("\n"),
      answerFormat: "free_text",
      urgency: /legal|lawsuit|attorney|counsel|tcpa|cease|demand letter|subpoena/i.test(`${summary} ${why} ${ticket.description}`) ? "urgent" : "normal",
    });
    await assignTicket(ticket.organizationId, ticket.id, FOUNDER_AGENT);
    return { success: true, effect: "escalated", output: `Ticket #${ticket.id} handed to the founder (ask #${r.askId}${r.deduped ? ", already open" : ""}).` };
  }
  return { success: false, output: `unknown support tool ${name}` };
}

async function executeRetentionRoleTool(name: string, input: Record<string, unknown>, ctx: RoleToolContext): Promise<RoleToolResult> {
  if (name !== "email_customer") return { success: false, output: `unknown retention tool ${name}` };
  const orgId = num(input.organization_id);
  const kind = str(input.kind);
  const subject = str(input.subject);
  const html = str(input.html);
  if (!Number.isFinite(orgId) || !subject || !html) return { success: false, output: "email_customer: organization_id, kind, subject and html are required." };
  const eligible = (await listAtRiskCustomers()).find((c) => c.organizationId === orgId);
  if (!eligible) return { success: false, output: `email_customer refused: org #${orgId} is not on today's at-risk list.` };
  if (eligible.kind !== kind) return { success: false, output: `email_customer refused: org #${orgId} is eligible for ${eligible.kind}, not ${kind}.` };
  const { screenFabrication } = await import("../../autopilot/contentHonesty");
  const fab = screenFabrication(`${subject}\n${html}`);
  if (fab.length > 0) return { success: false, output: `email_customer refused by the honesty screen: ${fab.map((v) => v.message).join(" ")}` };
  if (await recentlyEmailed(orgId, kind)) return { success: false, output: `email_customer refused: org #${orgId} already got a ${kind} email in the last 7 days.` };
  const { ownerEmailOf } = await import("../../autopilot/delegationRules");
  const to = await ownerEmailOf(orgId);
  if (!to) return { success: false, output: `email_customer refused: no owner email on file for org #${orgId}.` };
  const { filterSuppressed } = await import("../../emailSuppressions");
  const { allowed } = await filterSuppressed([to]);
  if (allowed.length === 0) return { success: false, output: `email_customer refused: the owner of org #${orgId} has unsubscribed. Not emailing.` };
  const frozen = await freezeHand("retention", "send_email", { to, subject, html, organization_id: orgId, retention_kind: kind }, ctx);
  if (frozen.pendingId == null) return { success: false, output: frozen.output };
  return { success: true, effect: "drafted_email", output: `${kind} email to org #${orgId}'s owner drafted (pending action #${frozen.pendingId}); it goes out once witnessed.` };
}
