/**
 * Support intake — legal / compliance classifier.
 *
 * TCPA complaints, cease-and-desist letters, data-deletion (DSAR) requests and
 * threats of litigation arrive as ordinary support tickets. Before this they
 * were handled like any other ticket (Pax's first-response pass), and nothing
 * ever put them in front of the founder. They are founder decisions — legal
 * signing and customer-data deletion are hard-stops — so this module only
 * ROUTES them: it marks the ticket urgent and opens ONE urgent founder ask.
 * It never answers, deletes, or commits to anything on its own.
 *
 * Every support intake path that stores customer-written text calls
 * `escalateLegalIntake` (see LEGAL_INTAKE_PATHS in the test). The classifier is
 * a pure keyword match: deliberately over-inclusive, because a false positive
 * costs the founder one glance and a false negative can cost a statutory
 * deadline.
 */
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { supportTickets } from "@shared/schema";
import { logger } from "../utils/logger";

export type LegalIntakeKind = "tcpa" | "cease_and_desist" | "data_deletion" | "litigation";

/** Every legal founder ask's summary starts with this — the step-away check and senses count on it. */
export const LEGAL_ASK_SUMMARY_PREFIX = "Legal/compliance item";

const LABELS: Record<LegalIntakeKind, string> = {
  tcpa: "possible TCPA / do-not-call complaint",
  cease_and_desist: "cease-and-desist",
  data_deletion: "data-deletion / privacy request",
  litigation: "threat of legal action",
};

// Order matters only for which label wins when several match.
const RULES: Array<{ kind: LegalIntakeKind; re: RegExp }> = [
  { kind: "cease_and_desist", re: /\bcease\s*(?:and|&)\s*desist\b/i },
  { kind: "tcpa", re: /\bTCPA\b|\btelephone consumer protection\b|\bdo[\s-]*not[\s-]*call\b|\brobo-?calls?\b|\bunsolicited (?:calls?|texts?|messages?|sms)\b|\bstop (?:calling|texting) me\b/i },
  { kind: "data_deletion", re: /\b(?:delete|erase|remove|purge) (?:all )?(?:of )?(?:my|our) (?:personal )?(?:data|information|info|records|account)\b|\bright to (?:be forgotten|erasure|deletion|delete)\b|\b(?:GDPR|CCPA|CPRA|DSAR)\b|\bdata (?:subject )?(?:access|deletion|erasure) request\b/i },
  { kind: "litigation", re: /\b(?:my )?(?:attorney|lawyer)\b|\blawsuit\b|\bsue (?:you|your)\b|\blegal action\b|\bclass[\s-]action\b|\bsubpoena\b/i },
];

/** Pure: the legal kind a ticket's text carries, or null. */
export function classifyLegalIntake(text: string): { kind: LegalIntakeKind; label: string } | null {
  if (!text) return null;
  for (const r of RULES) {
    if (r.re.test(text)) return { kind: r.kind, label: LABELS[r.kind] };
  }
  return null;
}

export interface LegalIntakeInput {
  table: "support_tickets" | "support_cases";
  recordId: number;
  organizationId: number;
  subject: string;
  description?: string | null;
}

export interface LegalIntakeDeps {
  askFounder: (input: {
    askingAgentRole: "beatrice";
    questionSummary: string;
    questionBody: string;
    answerFormat: "free_text";
    urgency: "urgent";
    timeoutHours: number;
  }) => Promise<{ askId: number; deduped: boolean }>;
  markTicketUrgent: (ticketId: number, organizationId: number) => Promise<void>;
}

const defaultDeps: LegalIntakeDeps = {
  askFounder: async (input) => {
    const { askFounder } = await import("./solene/founderCollab");
    const r = await askFounder(input);
    return { askId: r.askId, deduped: r.deduped };
  },
  markTicketUrgent: async (ticketId, organizationId) => {
    await db
      .update(supportTickets)
      .set({ priority: "urgent" })
      .where(and(eq(supportTickets.id, ticketId), eq(supportTickets.organizationId, organizationId)));
  },
};

/** The summary is derived only from the record — so a repeat call dedupes onto the same open ask. */
function legalAskSummary(input: Pick<LegalIntakeInput, "table" | "recordId">, label: string): string {
  const what = input.table === "support_tickets" ? "support ticket" : "support case";
  return `${LEGAL_ASK_SUMMARY_PREFIX}: ${label} in ${what} #${input.recordId}`;
}

/**
 * Classify a fresh intake and, if it is a legal/compliance item, open ONE
 * urgent founder ask naming it. Never throws: a failure is logged and the
 * intake proceeds (the ticket itself is already stored).
 */
export async function escalateLegalIntake(
  input: LegalIntakeInput,
  deps: LegalIntakeDeps = defaultDeps,
): Promise<{ escalated: boolean; askId?: number; kind?: LegalIntakeKind }> {
  try {
    const hit = classifyLegalIntake(`${input.subject}\n${input.description ?? ""}`);
    if (!hit) return { escalated: false };
    if (input.table === "support_tickets") {
      await deps.markTicketUrgent(input.recordId, input.organizationId).catch((err: unknown) =>
        logger.warn("[supportLegalIntake] could not mark ticket urgent", err instanceof Error ? err : undefined),
      );
    }
    const { askId } = await deps.askFounder({
      askingAgentRole: "beatrice",
      questionSummary: legalAskSummary(input, hit.label),
      questionBody: [
        `A customer's ${input.table === "support_tickets" ? "ticket" : "case"} #${input.recordId} (org ${input.organizationId}) reads as a ${hit.label}.`,
        "",
        "This is yours to decide — nothing has been answered, deleted or promised on your behalf. Reply with what you decided or did.",
      ].join("\n"),
      answerFormat: "free_text",
      urgency: "urgent",
      // A legal item stays in front of the founder for two weeks; the ask
      // escalation ladder re-pages it while it waits.
      timeoutHours: 24 * 14,
    });
    logger.info("[supportLegalIntake] legal/compliance intake routed to founder", {
      metadata: { table: input.table, recordId: input.recordId, kind: hit.kind, askId },
    });
    return { escalated: true, askId, kind: hit.kind };
  } catch (err) {
    logger.error("[supportLegalIntake] legal intake escalation failed", err instanceof Error ? err : undefined);
    return { escalated: false };
  }
}
