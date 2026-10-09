/**
 * The routine-support sweep (founder decision 2026-10-09; the pure policy is
 * routineSupportPolicy.ts). Runs at the head of the auto-witness sweep, every
 * tick, with or without any WitnessGrant issued.
 *
 * For each frozen support-worker reply or refund:
 *   routine  → released through approvePendingHand (the founder-tap path),
 *              after the live controls and the hand's own delegated rules;
 *              logged to the experience log as `support_auto_answer` /
 *              `support_auto_refund` (the Story door).
 *   founder  → held. The ticket goes to the founder as ONE ask (askFounder
 *              folds a repeat), and the hold is logged (`support_held`).
 *              A held ticket's drafts are reported back so the grant pass
 *              does not release them either.
 * A failed read releases nothing (fail closed).
 */
import { and, eq, or, sql } from "drizzle-orm";
import { soleneFounderAsks, supportTicketMessages, supportTickets } from "@shared/schema";
import { unscopedForPlatformOps } from "../../utils/orgScopedDb";
import { logger } from "../../utils/logger";
import { clock } from "../../utils/clock";
import {
  ROUTINE_SUPPORT_APPROVER,
  ROUTINE_SUPPORT_DECISION,
  isRoutineSupportDraft,
  judgeDraft,
  ticketIdOfDraft,
  type TicketText,
} from "./routineSupportPolicy";

const PLATFORM_SUPPORT = "routine-support policy: AcreOS's own support desk reads the ticket a frozen support reply answers (AcreOS operating itself)";
/** The pseudo-grant id carried into the executor so it re-checks every delegated-release rule. */
export const ROUTINE_SUPPORT_RELEASE_ID = "policy:routine-support-2026-10-09";

export interface RoutineSupportOutcome {
  pendingId: number;
  handName: string;
  ticketId: number | null;
  outcome: "released" | "held" | "skipped";
  reason: string;
}

export interface RoutineSupportSweepResult {
  considered: number;
  released: number;
  held: number;
  /** Pending ids the founder must see: the grant pass may not release these. */
  heldForFounder: Set<number>;
  outcomes: RoutineSupportOutcome[];
}

async function readTicket(ticketId: number, organizationId: number): Promise<(TicketText & { id: number; organizationId: number }) | null> {
  const db = unscopedForPlatformOps(PLATFORM_SUPPORT);
  const [t] = await db
    .select({ id: supportTickets.id, organizationId: supportTickets.organizationId, subject: supportTickets.subject, description: supportTickets.description })
    .from(supportTickets)
    .where(and(eq(supportTickets.id, ticketId), eq(supportTickets.organizationId, organizationId)))
    .limit(1);
  if (!t) return null;
  const msgs = await db
    .select({ role: supportTicketMessages.role, content: supportTicketMessages.content })
    .from(supportTicketMessages)
    .where(eq(supportTicketMessages.ticketId, t.id))
    .orderBy(supportTicketMessages.id);
  return { ...t, customerMessages: msgs.filter((m) => m.role === "user").map((m) => String(m.content ?? "")) };
}

/** Has this ticket ever been put to the founder (the worker's escalation, legal intake, or this policy)? */
async function ticketAlreadyAsked(ticketId: number): Promise<boolean> {
  try {
    return await askedRead(ticketId);
  } catch {
    return false; // unknown → ask; askFounder folds an identical open ask
  }
}
async function askedRead(ticketId: number): Promise<boolean> {
  const rows = await unscopedForPlatformOps(PLATFORM_SUPPORT)
    .select({ id: soleneFounderAsks.id })
    .from(soleneFounderAsks)
    .where(
      or(
        sql`${soleneFounderAsks.questionSummary} like ${`Support ticket #${ticketId} needs you%`}`,
        sql`${soleneFounderAsks.questionSummary} like ${`% in support ticket #${ticketId}`}`,
      ),
    )
    .limit(1);
  return rows.length > 0;
}

async function story(moveKind: string, domain: string, outcome: "acted" | "escalated", trace: Record<string, unknown>): Promise<void> {
  try {
    const { recordExperience } = await import("../autopilot/experienceLog");
    await recordExperience({ moveKind, domain, outcome, reasoningTrace: { policy: ROUTINE_SUPPORT_DECISION, ...trace } });
  } catch (err) {
    // The release itself already carries its approver on the pending row,
    // the receipt and the sends audit; a lost Story line is logged, not hidden.
    logger.warn(`[routineSupport] story entry not written: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function runRoutineSupportSweep(opts: { now?: number } = {}): Promise<RoutineSupportSweepResult> {
  const now = opts.now ?? clock.nowMs();
  const result: RoutineSupportSweepResult = { considered: 0, released: 0, held: 0, heldForFounder: new Set(), outcomes: [] };
  try {
    const { isPanicStopped } = await import("../autopilot/settings");
    if (isPanicStopped()) return result;
  } catch {
    /* the executor re-checks the panic stop */
  }

  const { listPendingHands, approvePendingHand } = await import("../autopilot/pendingHands");
  const { getHand } = await import("../autopilot/hands");
  const { delegationBlockedByControls, delegatedHandRefusal } = await import("../autopilot/delegationRules");
  const pending = await listPendingHands(200);

  for (const action of pending) {
    const args = (action.args ?? {}) as Record<string, unknown>;
    const draft = { handName: action.handName, sourceRole: (action as { sourceRole?: string | null }).sourceRole ?? null, args };
    if (!isRoutineSupportDraft(draft)) continue; // not a support draft — not this policy's
    result.considered++;
    const ticketId = ticketIdOfDraft(draft);
    const orgId = typeof args.organization_id === "number" ? args.organization_id : NaN;
    const note = (outcome: RoutineSupportOutcome["outcome"], reason: string) => result.outcomes.push({ pendingId: action.id, handName: action.handName, ticketId, outcome, reason });

    let ticket: Awaited<ReturnType<typeof readTicket>> = null;
    try {
      ticket = ticketId != null && Number.isFinite(orgId) ? await readTicket(ticketId, orgId) : null;
    } catch (err) {
      note("skipped", `ticket unreadable (${err instanceof Error ? err.message : String(err)}) — nothing released`);
      continue;
    }
    const verdict = judgeDraft(draft, ticket);

    if (!verdict.release) {
      result.held++;
      result.heldForFounder.add(action.id);
      note("held", verdict.reason);
      // ONE ask per ticket: askFounder folds an open ask with the same summary,
      // and the worker's own escalate_to_founder uses this summary shape.
      // The ticket is now the founder's (as escalate_to_founder makes it):
      // nobody else works it, and it is not counted as waiting on support.
      if (ticket) {
        try {
          const { FOUNDER_AGENT } = await import("../solene/roleWorkers/routing");
          await unscopedForPlatformOps(PLATFORM_SUPPORT)
            .update(supportTickets)
            .set({ assignedAgent: FOUNDER_AGENT, updatedAt: clock.now() })
            .where(and(eq(supportTickets.id, ticket.id), eq(supportTickets.organizationId, ticket.organizationId), sql`coalesce(${supportTickets.assignedAgent}, '') <> ${FOUNDER_AGENT}`));
        } catch (err) {
          logger.warn(`[routineSupport] ticket #${ticket.id} not assigned to the founder: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      if (ticket && !(await ticketAlreadyAsked(ticket.id))) {
        try {
          const { askFounder } = await import("../solene/founderCollab");
          const r = await askFounder({
            askingAgentRole: "general-purpose",
            questionSummary: `Support ticket #${ticket.id} needs you: ${String(ticket.subject ?? "").slice(0, 100)}`,
            questionBody: [
              `Ticket #${ticket.id} from organization #${ticket.organizationId}: "${ticket.subject}"`,
              `The customer wrote: ${String(ticket.description ?? "").slice(0, 1200)}`,
              "",
              `Why this is yours: ${verdict.reason}. Routine tickets (how-to, account questions, refunds up to $50) are answered without you; this one is not routine.`,
              `The support worker's draft is waiting in Decisions (pending action #${action.id}); it goes out only on your tap.`,
            ].join("\n"),
            answerFormat: "free_text",
            urgency: verdict.triage && verdict.triage.verdict === "founder" && (verdict.triage.reason === "legal" || verdict.triage.reason === "data_deletion") ? "urgent" : "normal",
          });
          await story("support_held", "support", "escalated", { ticketId: ticket.id, pendingId: action.id, hand: action.handName, why: verdict.reason, askId: r.askId, deduped: r.deduped ?? false });
        } catch (err) {
          logger.warn(`[routineSupport] founder ask for ticket #${ticket.id} not opened: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      continue;
    }

    const spec = getHand(action.handName);
    if (!spec) {
      note("skipped", "hand not registered in this process");
      continue;
    }
    try {
      const blocked = await delegationBlockedByControls(spec.domain);
      if (blocked) {
        note("skipped", `not released: ${blocked}`);
        continue;
      }
      const refused = await delegatedHandRefusal(action.handName, args);
      if (refused) {
        note("skipped", `not released: ${refused}`);
        continue;
      }
    } catch (err) {
      note("skipped", `not released: controls / hand rules unverifiable (${err instanceof Error ? err.message : String(err)})`);
      continue;
    }

    try {
      const out = await approvePendingHand({ id: action.id, approvedBy: ROUTINE_SUPPORT_APPROVER, delegation: { grantId: ROUTINE_SUPPORT_RELEASE_ID }, now });
      if (out.outcome === "executed") {
        result.released++;
        note("released", `${verdict.triage.kind} (${verdict.triage.signals.join(", ")})`);
        await story(action.handName === "apply_refund" ? "support_auto_refund" : "support_auto_answer", spec.domain, "acted", {
          ticketId,
          organizationId: orgId,
          pendingId: action.id,
          hand: action.handName,
          kind: verdict.triage.kind,
          signals: verdict.triage.signals,
          ...(action.handName === "apply_refund" ? { amountCents: args.amount_cents } : { reply: String(args.message ?? "").slice(0, 600), resolved: args.resolve === true }),
        });
      } else {
        note("skipped", `approval path refused: ${out.outcome}${"error" in out ? ` — ${String(out.error)}` : ""}`);
      }
    } catch (err) {
      note("skipped", `approval path threw: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (result.considered > 0) {
    logger.info(`[routineSupport] sweep: considered=${result.considered} released=${result.released} held=${result.held}`);
  }
  return result;
}
