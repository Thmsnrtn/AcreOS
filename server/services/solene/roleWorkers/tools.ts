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
import { and, desc, eq, gte, inArray, or, sql } from "drizzle-orm";
import {
  autopilotPendingActions,
  creditTransactions,
  organizations,
  supportTicketMessages,
  supportTickets,
} from "@shared/schema";
import { users } from "@shared/models/auth";
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
}

import { SUPPORT_WORKER_AGENT, FOUNDER_AGENT } from "./routing";
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

/** Tickets waiting on AcreOS that no worker or founder has picked up yet. */
export async function listWaitingTickets(limit = 10) {
  const tickets = await unscopedForPlatformOps(PLATFORM_SUPPORT)
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
    .limit(limit);
  if (tickets.length === 0) return [];
  const msgs = await unscopedForPlatformOps(PLATFORM_SUPPORT)
    .select({ ticketId: supportTicketMessages.ticketId, role: supportTicketMessages.role, content: supportTicketMessages.content })
    .from(supportTicketMessages)
    .where(inArray(supportTicketMessages.ticketId, tickets.map((t) => t.id)))
    .orderBy(supportTicketMessages.id);
  const orgs = await unscopedForPlatformOps(PLATFORM_SUPPORT)
    .select({ id: organizations.id, name: organizations.name, tier: organizations.subscriptionTier, status: organizations.subscriptionStatus })
    .from(organizations)
    .where(inArray(organizations.id, [...new Set(tickets.map((t) => t.organizationId))]));
  return tickets.map((t) => ({
    ...t,
    org: orgs.find((o) => o.id === t.organizationId) ?? null,
    recentMessages: msgs.filter((m) => m.ticketId === t.id).slice(-4),
  }));
}

async function ticketById(ticketId: number) {
  const [t] = await unscopedForPlatformOps(PLATFORM_SUPPORT)
    .select()
    .from(supportTickets)
    .where(eq(supportTickets.id, ticketId))
    .limit(1);
  return t ?? null;
}

async function purchasesForOrg(organizationId: number) {
  const since = new Date(Date.now() - 90 * 24 * 3600_000);
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
async function assignTicket(ticketId: number, agent: string) {
  const db = unscopedForPlatformOps(PLATFORM_SUPPORT);
  if (agent === FOUNDER_AGENT) {
    await db.update(supportTickets).set({ assignedAgent: FOUNDER_AGENT, status: "in_progress", updatedAt: new Date() }).where(eq(supportTickets.id, ticketId));
    return;
  }
  await db
    .update(supportTickets)
    .set({ assignedAgent: agent, status: "in_progress", updatedAt: new Date() })
    .where(and(eq(supportTickets.id, ticketId), sql`coalesce(${supportTickets.assignedAgent}, '') <> ${FOUNDER_AGENT}`));
}

/** Freeze a hand through the dispatch executor (constitutional screen + witnessed-send). */
async function freezeHand(handName: string, args: Record<string, unknown>, ctx: RoleToolContext): Promise<{ pendingId: number | null; output: string }> {
  const { executeDispatchTool } = await import("../dispatchToolExecutor");
  const r = await executeDispatchTool(handName, args, { dispatchId: ctx.dispatchId, agentRole: "general-purpose", untrusted: true });
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

/** Today's eligible retention list — the ONLY orgs email_customer may reach. */
export async function listAtRiskCustomers(now = new Date()): Promise<AtRiskCustomer[]> {
  const db = unscopedForPlatformOps(PLATFORM_RETENTION);
  const rows = await db
    .select({
      id: organizations.id,
      name: organizations.name,
      dunningStage: organizations.dunningStage,
      status: organizations.subscriptionStatus,
      tier: organizations.subscriptionTier,
      trialEndsAt: organizations.trialEndsAt,
      endedAt: organizations.subscriptionEndedAt,
      isFounder: organizations.isFounder,
    })
    .from(organizations)
    .where(
      sql`coalesce(${organizations.isFounder}, false) = false and (
        (coalesce(${organizations.dunningStage}, 'none') not in ('none', 'cancelled'))
        or (${organizations.subscriptionStatus} in ('canceled', 'cancelled') and ${organizations.subscriptionEndedAt} > ${new Date(now.getTime() - 60 * 24 * 3600_000)})
        or (${organizations.subscriptionTier} = 'free' and ${organizations.trialEndsAt} between ${now} and ${new Date(now.getTime() + 3 * 24 * 3600_000)})
      )`,
    )
    .limit(50);
  return rows.map((r) => {
    if (r.dunningStage && r.dunningStage !== "none" && r.dunningStage !== "cancelled") {
      return { organizationId: r.id, name: r.name, kind: "payment_recovery" as const, detail: `subscription payment failed — dunning stage ${r.dunningStage}` };
    }
    if (r.status === "canceled" || r.status === "cancelled") {
      return { organizationId: r.id, name: r.name, kind: "win_back" as const, detail: `cancelled ${r.endedAt?.toISOString().slice(0, 10) ?? "recently"}` };
    }
    return { organizationId: r.id, name: r.name, kind: "trial_ending" as const, detail: `trial ends ${r.trialEndsAt?.toISOString().slice(0, 10)}` };
  });
}

async function ownerEmail(organizationId: number): Promise<string | null> {
  const db = unscopedForPlatformOps(PLATFORM_RETENTION);
  const [org] = await db.select({ ownerId: organizations.ownerId }).from(organizations).where(eq(organizations.id, organizationId)).limit(1);
  if (!org) return null;
  const [u] = await db
    .select({ email: users.email })
    .from(users)
    .where(or(eq(users.id, org.ownerId), eq(users.clerkUserId, org.ownerId)))
    .limit(1);
  return u?.email ?? null;
}

async function recentlyEmailed(organizationId: number, kind: string): Promise<boolean> {
  const since = new Date(Date.now() - 7 * 24 * 3600_000);
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
}

/** The work a role worker is handed, read fresh at run time. */
export async function buildBriefing(role: RoleWorker): Promise<Briefing> {
  if (role === "support") {
    const tickets = await listWaitingTickets();
    if (tickets.length === 0) return { text: "No tickets are waiting.", items: 0 };
    const lines = tickets.map((t) => [
      `### Ticket #${t.id} — ${t.subject}`,
      `- Organization: #${t.organizationId}${t.org ? ` "${t.org.name}" (${t.org.tier}, ${t.org.status})` : ""}`,
      `- Category: ${t.category}; opened ${t.createdAt?.toISOString() ?? "unknown"}`,
      `- Customer wrote: ${t.description}`,
      ...t.recentMessages.map((m) => `- ${m.role}: ${m.content.slice(0, 400)}`),
    ].join("\n"));
    return { text: [`## Waiting tickets (${tickets.length})`, "", ...lines].join("\n\n"), items: tickets.length };
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
  const ticketId = num(input.ticket_id);
  const ticket = Number.isFinite(ticketId) ? await ticketById(ticketId) : null;
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
    if (amount > purchase.amountCents) return { success: false, output: `refund_purchase refused: $${(amount / 100).toFixed(2)} is more than the purchase ($${(purchase.amountCents / 100).toFixed(2)}).` };
    const frozen = await freezeHand("apply_refund", { charge_id: pi, amount_cents: amount, reason: `ticket #${ticket.id}: ${str(input.reason).slice(0, 300)}`, organization_id: ticket.organizationId }, ctx);
    if (frozen.pendingId == null) return { success: false, output: frozen.output };
    return { success: true, effect: "drafted_refund", output: `Refund of $${(amount / 100).toFixed(2)} drafted (pending action #${frozen.pendingId}); it goes out once witnessed. Do not tell the customer it has already been refunded — say it is being processed.` };
  }

  if (name === "reply_to_ticket") {
    const message = str(input.message);
    if (!message) return { success: false, output: "reply_to_ticket: message is required." };
    const { screenFabrication } = await import("../../autopilot/contentHonesty");
    const fab = screenFabrication(message);
    if (fab.length > 0) return { success: false, output: `reply_to_ticket refused by the honesty screen: ${fab.map((v) => v.message).join(" ")}` };
    const frozen = await freezeHand("reply_support_ticket", { ticket_id: ticket.id, message, resolve: input.resolve === true }, ctx);
    if (frozen.pendingId == null) return { success: false, output: frozen.output };
    await assignTicket(ticket.id, SUPPORT_WORKER_AGENT);
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
    await assignTicket(ticket.id, FOUNDER_AGENT);
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
  const to = await ownerEmail(orgId);
  if (!to) return { success: false, output: `email_customer refused: no owner email on file for org #${orgId}.` };
  const { filterSuppressed } = await import("../../emailSuppressions");
  const { allowed } = await filterSuppressed([to]);
  if (allowed.length === 0) return { success: false, output: `email_customer refused: the owner of org #${orgId} has unsubscribed. Not emailing.` };
  const frozen = await freezeHand("send_email", { to, subject, html, organization_id: orgId, retention_kind: kind }, ctx);
  if (frozen.pendingId == null) return { success: false, output: frozen.output };
  return { success: true, effect: "drafted_email", output: `${kind} email to org #${orgId}'s owner drafted (pending action #${frozen.pendingId}); it goes out once witnessed.` };
}
