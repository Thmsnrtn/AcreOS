/**
 * RESPA §1024.39 early-intervention scaffold (Beatrice 2026-06-02 ruling §5
 * piggyback item 4). Triggers at day 36 of delinquency — required
 * borrower-facing outreach attempt under 12 C.F.R. §1024.39(a):
 *   "A servicer shall establish or make good faith efforts to establish
 *    live contact with a delinquent borrower not later than the 36th day
 *    of a borrower's delinquency..."
 *
 * FLAGGING ONLY — READ THIS BEFORE TRUSTING respa_outreach_events:
 *   - This module fires a FLAG at day 36 (idempotent — one event per cycle)
 *     and persists an audit row in respa_outreach_events with the §-citation.
 *   - A row in respa_outreach_events means "outreach became DUE and was
 *     flagged" — it is NOT evidence that any contact was attempted or made.
 *     NO message of any kind has been sent to a borrower by this platform.
 *     The §1024.39 duty is to make (or attempt) live contact; logging that
 *     the duty attached does not discharge it. THE OPERATOR MUST MAKE THE
 *     CONTACT.
 *   - Sending is deliberately NOT wired. Contacting borrowers automatically
 *     is a founder decision (and the outreach language is Beatrice's domain);
 *     see the comment at the would-be send site inside flagEarlyIntervention.
 *
 * Predicate gating: the same §1026.41 predicate (Beatrice's 4-gate tree)
 * gates §1024.39 attachment. A passive holder doesn't owe early-intervention
 * outreach because the duty lies with the actual servicer.
 *
 * §1024.40 (continuity of contact, day 45) and §1024.41 (loss-mit, day 45)
 * are NOT in this commit. §1024.40 is assignment-dimension (operational
 * staff assignment), not pure code. §1024.41 wires into note_loss_mit_cases
 * in a follow-up Beatrice gates.
 */

import { db } from "../../db";
import { respaOutreachEvents } from "@shared/schema/reg-z";
import { acquiredNotes } from "@shared/schema/notes-vertical";
import { notes } from "@shared/schema";
import { and, eq } from "drizzle-orm";
import { logger } from "../../utils/logger";
import { qualifiesForRegZStatement } from "../periodicStatements/predicate";

// §1024.39(a) trigger day. Servicer must attempt live contact NO LATER
// THAN the 36th day of delinquency. Industry-standard read: day 36 itself
// is the trigger; firing earlier is permissible, later is the violation.
export const EARLY_INTERVENTION_TRIGGER_DAY = 36;

export interface FlagEarlyInterventionInput {
  organizationId: number;
  loanId: string;
  loanType: "note" | "acquired_note";
  daysDelinquent: number;
  /** Optional anchor for idempotency — defaults to current month. */
  cycleAnchor?: Date;
}

export interface FlagEarlyInterventionResult {
  /**
   * True when the FLAG row was persisted this call. "Fired" means "flagged
   * for outreach" — NO message has been sent to the borrower; the operator
   * must make the §1024.39 contact.
   */
  fired: boolean;
  alreadyFired: boolean;
  /** Reason a future Beatrice audit reads at a glance. */
  reason: string;
  /** §-citation that authorised the decision. ALWAYS populated. */
  citation: string;
  /** The persisted event row id, when one was created. */
  eventId?: number;
}

/**
 * Evaluate whether RESPA §1024.39 early-intervention FLAGS for this loan
 * on this evaluation. Idempotent: re-running on day 37 / 38 for the same
 * cycle is a no-op (the UNIQUE index on org+loan+loanType+eventType+cycle
 * blocks duplicate writes).
 *
 * FLAG, NOT CONTACT: persisting the event sends NOTHING to the borrower.
 * The operator must make the §1024.39 contact — see the module header.
 *
 * Beatrice predicate gates whether AcreOS owes the duty at all — passive
 * holder / sub-serviced / business-purpose / non-dwelling shapes return
 * fired=false with the citation that authorised the skip.
 */
export async function flagEarlyIntervention(
  input: FlagEarlyInterventionInput,
): Promise<FlagEarlyInterventionResult> {
  const { organizationId, loanId, loanType, daysDelinquent } = input;

  // Cycle anchor: the calendar month containing the evaluation. Idempotency
  // is "one §1024.39 event per cycle", and we use the month as the cycle.
  const now = input.cycleAnchor ?? new Date();
  const cycleAnchor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  // Trigger gate. Firing earlier than 36d is permitted by the reg but
  // we hold the line — early-intervention exists to give the borrower
  // a 36-day breathing room. Firing on day 1 would defeat the design.
  if (daysDelinquent < EARLY_INTERVENTION_TRIGGER_DAY) {
    return {
      fired: false,
      alreadyFired: false,
      reason: `delinquency=${daysDelinquent}d below §1024.39 trigger of ${EARLY_INTERVENTION_TRIGGER_DAY}d`,
      citation: "12 C.F.R. §1024.39(a)",
    };
  }

  // Predicate gate (Beatrice §5 piggyback). The duty under §1024.39
  // attaches to the SERVICER. Reuses the same predicate that gates
  // §1026.41 — passive_holder / sub_serviced / seller_retained skip.
  if (loanType === "acquired_note") {
    const noteRows = await db
      .select()
      .from(acquiredNotes)
      .where(
        and(eq(acquiredNotes.id, loanId), eq(acquiredNotes.organizationId, organizationId)),
      )
      .limit(1);
    if (noteRows.length === 0) {
      return {
        fired: false,
        alreadyFired: false,
        reason: `acquired note ${loanId} not found for org ${organizationId}`,
        citation: "operational",
      };
    }
    const predicate = await qualifiesForRegZStatement(
      { kind: "acquired_note", row: noteRows[0] },
      organizationId,
    );
    if (!predicate.qualifies) {
      return {
        fired: false,
        alreadyFired: false,
        reason: predicate.skipReason ?? "predicate returned skip without reason",
        citation: predicate.citation,
      };
    }
  } else {
    // Originated notes: predicate is `kind: 'note'` and always qualifies.
    // We still cite §1024.39 explicitly so the audit log is consistent.
    const noteRows = await db
      .select()
      .from(notes)
      .where(and(eq(notes.id, Number(loanId)), eq(notes.organizationId, organizationId)))
      .limit(1);
    if (noteRows.length === 0) {
      return {
        fired: false,
        alreadyFired: false,
        reason: `note ${loanId} not found for org ${organizationId}`,
        citation: "operational",
      };
    }
  }

  // Persist the FLAG. ON CONFLICT DO NOTHING on the UNIQUE composite
  // (org + loan + loan_type + event_type + cycle_anchor) — re-running on
  // day 37 / 38 is a no-op (idempotency). This row records that the duty
  // ATTACHED, not that it was discharged — no borrower contact happens here.
  const inserted = await db
    .insert(respaOutreachEvents)
    .values({
      organizationId,
      loanId,
      loanType,
      eventType: "early_intervention_36d",
      firedAt: new Date(),
      cycleAnchor,
      daysDelinquent,
      citation: "12 C.F.R. §1024.39(a)",
      contentRef: null,
    })
    .onConflictDoNothing({
      target: [
        respaOutreachEvents.organizationId,
        respaOutreachEvents.loanId,
        respaOutreachEvents.loanType,
        respaOutreachEvents.eventType,
        respaOutreachEvents.cycleAnchor,
      ],
    })
    .returning({ id: respaOutreachEvents.id });

  if (inserted.length === 0) {
    logger.info(
      `[respa.earlyIntervention] already flagged this cycle (flag only — NO borrower message has been sent): org=${organizationId} loan=${loanId} type=${loanType} days=${daysDelinquent}`,
    );
    return {
      fired: false,
      alreadyFired: true,
      reason: `§1024.39 outreach already flagged for this cycle (idempotent re-run) — flag only; NO message has been sent to the borrower`,
      citation: "12 C.F.R. §1024.39(a)",
    };
  }

  // ── Where the send WOULD go — deliberately absent ──────────────────────
  // If the platform ever contacts borrowers itself, the send happens HERE,
  // after the flag row commits. It is NOT wired on purpose: contacting
  // borrowers automatically is a FOUNDER DECISION (hard-stop territory —
  // borrower-facing communication under a federal duty), and the outreach
  // language itself is Beatrice's domain. Until the founder rules, the flag
  // is the END of the platform's action: the operator must make the
  // §1024.39 live-contact attempt themselves. Do not add a send here in a
  // wave without that ruling.

  logger.info(
    `[respa.earlyIntervention] flagged for outreach — NO message has been sent to the borrower; the operator must make the §1024.39 contact: org=${organizationId} loan=${loanId} type=${loanType} days=${daysDelinquent} eventId=${inserted[0].id}`,
  );

  return {
    fired: true,
    alreadyFired: false,
    reason: `delinquency=${daysDelinquent}d met §1024.39 trigger of ${EARLY_INTERVENTION_TRIGGER_DAY}d — flagged for outreach; NO message has been sent to the borrower, the operator must make the contact`,
    citation: "12 C.F.R. §1024.39(a)",
    eventId: inserted[0].id,
  };
}

/**
 * Pure-function decision gate (no I/O). Used by tests + by callers that
 * want to know "would this trigger today?" without writing to the audit
 * trail. The async `flagEarlyIntervention` is the canonical entry point.
 * "Fire" here means FLAG for outreach — nothing is ever sent to a borrower
 * by this module (see the module header).
 */
export function shouldFireEarlyIntervention(daysDelinquent: number): {
  shouldFire: boolean;
  reason: string;
  citation: string;
} {
  if (daysDelinquent < EARLY_INTERVENTION_TRIGGER_DAY) {
    return {
      shouldFire: false,
      reason: `delinquency=${daysDelinquent}d below §1024.39 trigger of ${EARLY_INTERVENTION_TRIGGER_DAY}d`,
      citation: "12 C.F.R. §1024.39(a)",
    };
  }
  return {
    shouldFire: true,
    reason: `delinquency=${daysDelinquent}d met §1024.39 trigger`,
    citation: "12 C.F.R. §1024.39(a)",
  };
}
