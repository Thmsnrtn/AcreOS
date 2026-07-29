/**
 * Borrower dunning ladder — the scheduled sweep (Wave C, agent C2).
 *
 * ⚠️ NAMING: BORROWER dunning (a borrower is late on a seller-financed note an
 * AcreOS customer holds). Not `server/services/dunning.ts`, which is the
 * founder-only SUBSCRIPTION dunning for a customer whose own card failed.
 *
 * WIRING (this is the part waves usually get wrong): this module is NOT
 * separately registered. It is the body of the ALREADY-REGISTERED
 * `finance_agent` job — `runScheduledJobs.ts → startFinanceAgentJob()` schedules
 * `financeAgentService.runFinanceAgentJob()` every 30 minutes, self-rescheduling
 * under a Postgres job lock, and that method's only job now is to call
 * `runBorrowerDunningLadder()` here. So there is exactly one scheduler entry,
 * one lock, and no unwired start* export sitting dark.
 *
 * Two passes per tick, in order:
 *   1. LADDER pass — for every org that holds an active note: refresh
 *      delinquency state and create at most ONE reminder row per note for the
 *      rung it currently owes. Idempotent per (note, stage, period).
 *   2. DISPATCH pass — attempt delivery of every row whose moment has arrived
 *      (plus `queued` rows still inside the bounded retry window), recording an
 *      honest outcome for each.
 *
 * The org population comes from `getOrganizationIdsWithActiveNotes()`. It used
 * to come from `getOrganizationsInDunning()` — the SUBSCRIPTION dunning list —
 * which meant a healthy customer's late borrowers were never swept at all.
 */

import { logger } from "../utils/logger";
import { storage } from "../storage";
import { logActivity } from "../services/systemActivityLogger";
import { financeAgentService } from "../services/financeAgent";

const JOB_TYPE = "dunning";

/** How many reminder rows one tick will attempt to dispatch. */
const DISPATCH_BATCH = 50;

export interface BorrowerDunningLadderResult {
  orgsProcessed: number;
  totalNotes: number;
  /** Rail-accepted messages only. Never a count of rows we merely touched. */
  remindersSent: number;
  remindersScheduled: number;
  /** Prepared but not delivered, with a recorded reason on each row. */
  remindersNotSent: number;
  errors: string[];
}

export async function runBorrowerDunningLadder(): Promise<BorrowerDunningLadderResult> {
  logger.info("[BorrowerDunning] Starting borrower reminder ladder sweep");

  const errors: string[] = [];
  let orgsProcessed = 0;
  let totalNotes = 0;
  let remindersScheduled = 0;
  let remindersSent = 0;
  let remindersNotSent = 0;

  try {
    await storage.setJobStatus(JOB_TYPE, "running");

    // ── Pass 1: build the ladder ──────────────────────────────────────────
    let orgIds: number[] = [];
    try {
      orgIds = await storage.getOrganizationIdsWithActiveNotes();
    } catch (error) {
      errors.push(
        `Could not enumerate orgs holding active notes: ${error instanceof Error ? error.message : "Unknown"}`,
      );
    }

    for (const orgId of orgIds) {
      try {
        const result = await financeAgentService.processOrganizationNotes(orgId);
        totalNotes += result.processed;
        remindersScheduled += result.remindersScheduled;
        errors.push(...result.errors);
        orgsProcessed++;
      } catch (error) {
        errors.push(
          `Error processing org ${orgId}: ${error instanceof Error ? error.message : "Unknown"}`,
        );
      }
    }

    // ── Pass 2: dispatch what is due ──────────────────────────────────────
    try {
      const tally = await financeAgentService.dispatchDueReminders(DISPATCH_BATCH);
      remindersSent = tally.sent;
      remindersNotSent =
        tally.queued +
        tally.blocked +
        tally.unavailable +
        tally.awaitingApproval +
        tally.documentReady +
        tally.failed;
      logger.info("[BorrowerDunning] Dispatch pass complete", {
        metadata: { __pii_safe: true, ...tally },
      });
    } catch (error) {
      errors.push(
        `Error dispatching borrower reminders: ${error instanceof Error ? error.message : "Unknown"}`,
      );
    }

    await storage.setJobStatus(JOB_TYPE, "idle");
  } catch (error) {
    errors.push(
      `Error in borrower dunning ladder: ${error instanceof Error ? error.message : "Unknown"}`,
    );
    await storage.setJobStatus(JOB_TYPE, "failed").catch(() => {});
  }

  logger.info(
    `[BorrowerDunning] Sweep complete: ${orgsProcessed} orgs, ${totalNotes} notes, ` +
      `${remindersScheduled} queued, ${remindersSent} sent, ${remindersNotSent} prepared-not-sent, ` +
      `${errors.length} error(s)`,
  );

  if (remindersScheduled > 0 || remindersSent > 0 || remindersNotSent > 0) {
    logActivity({
      job: "finance_agent",
      action: "borrower_dunning_ladder",
      summary:
        `Borrower dunning: ${orgsProcessed} org(s), ${totalNotes} note(s), ` +
        `${remindersScheduled} reminder(s) queued, ${remindersSent} sent, ` +
        `${remindersNotSent} prepared but not sent`,
      metadata: {
        orgsProcessed,
        totalNotes,
        remindersScheduled,
        remindersSent,
        remindersNotSent,
        errors: errors.length,
      },
    }).catch(() => {});
  }

  return {
    orgsProcessed,
    totalNotes,
    remindersSent,
    remindersScheduled,
    remindersNotSent,
    errors,
  };
}
