/**
 * Finance agent — BORROWER dunning (Wave C, agent C2).
 *
 * ⚠️ NAMING: "dunning" here means a BORROWER is late on a seller-financed note
 * the AcreOS customer holds. `server/services/dunning.ts` is a DIFFERENT,
 * founder-only system (an AcreOS customer's subscription card failed). Never
 * cross-wire the two.
 *
 * Before this wave the borrower ladder tracked stages, wrote reminder rows and
 * emitted events — and nothing actually reached the borrower. Three concrete
 * defects, all fixed here:
 *
 *   1. `runFinanceAgentJob` enumerated orgs with `getOrganizationsInDunning()`
 *      — the SUBSCRIPTION dunning list. A healthy customer's late borrowers
 *      were never swept at all. Now: orgs that actually hold active notes.
 *   2. `processReminders` called the comms rail, IGNORED `result.success`, and
 *      marked the row `sent` regardless — the exact "recorded as sent but never
 *      sent" family Wave A removed. Now: `sent` is written only alongside the
 *      rail that accepted it (see storage recordReminderOutcome, which throws
 *      without an `acceptedBy`).
 *   3. `sendManualReminder` inserted a row with `status: "sent"` and never
 *      touched a rail at all. Now it dispatches through the same chokepoint.
 *
 * Gates honoured on every send, in order (none of them bypassed):
 *   Pax pause (paxPause.getPaxPauseState, fail-closed)
 *     → org autonomy level (autonomyGuardrails.getOrgAutonomyLevel)
 *     → daily autonomous-send envelope (checkSendRateLimit)
 *     → communicationsService.sendToLead, which itself applies TCPA consent,
 *       the contact-frequency cap, per-channel consent, and for SMS the
 *       sendOrgSMS chokepoint (consent → recipient-local quiet hours → DNC →
 *       frequency). Email goes out with `purpose: 'counterparty'`, so the org's
 *       own connected identity is REQUIRED and there is no platform fallback
 *       (founder decision 2026-07-17).
 */

import { storage } from "../storage";
import { usageMeteringService } from "./credits";
import { type Note, type Lead, type InsertPaymentReminder, type InsertSystemAlert } from "@shared/schema";
import { logActivity } from "./systemActivityLogger";
import { getOpenAIClient } from "../utils/openaiClient";
import { logger } from "../utils/logger";
import { getPaxPauseState, paxPauseRefusalMessage } from "./paxPause";
import { getOrgAutonomyLevel, checkSendRateLimit, recordAutonomousSend } from "./autonomyGuardrails";
import { getIdentityForSend } from "./orgEmailIdentity";
import { ensureLivePortalLink } from "./portalLink";
import {
  buildBorrowerLetter,
  buildBorrowerNotice,
  buildBorrowerSmsText,
  PHYSICAL_MAIL_STATUS,
  type BorrowerNoticeInput,
  type BorrowerNoticeStage,
} from "./borrowerNotices";

export type DelinquencyStatus =
  | "current"
  | "early_delinquent"
  | "delinquent"
  | "seriously_delinquent"
  | "default_candidate";

export type ReminderType = "upcoming" | "due" | "late" | "final_warning" | "demand_letter";

const DELINQUENCY_THRESHOLDS = {
  earlyDelinquent: { min: 1, max: 5 },
  delinquent: { min: 6, max: 15 },
  seriouslyDelinquent: { min: 16, max: 30 },
  defaultCandidate: { min: 31, max: Infinity },
};

const REMINDER_SCHEDULE = {
  upcoming: -3,
  due: 0,
  late: 5,
  final_warning: 15,
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Reminder-row status vocabulary. Only `sent` claims a rail accepted the
 * message; everything else says, in `failure_reason`, why it did not go.
 *
 *   scheduled          created by the ladder, dispatch not yet attempted
 *   queued             attempted; rail unavailable for a reason that may clear
 *                      (no connected identity, warmup/daily envelope, frequency
 *                      cap, Pax pause) — retried inside a bounded window
 *   awaiting_approval  org autonomy is "assisted": ready, needs a human tap
 *   blocked            refused by a compliance gate (consent / DNC / opt-out)
 *   unavailable        cannot be delivered for this period (no contact info,
 *                      recipient suppressed)
 *   document_ready     letter artifact generated; physical mail is not wired,
 *                      so nothing was mailed and nothing claims it was
 *   sent               a rail accepted it
 */
export const REMINDER_STATUS = {
  scheduled: "scheduled",
  queued: "queued",
  awaitingApproval: "awaiting_approval",
  blocked: "blocked",
  unavailable: "unavailable",
  documentReady: "document_ready",
  sent: "sent",
  failed: "failed",
  cancelled: "cancelled",
} as const;

export type ReminderChannel = "email" | "sms" | "letter";

export interface LadderRung {
  stage: BorrowerNoticeStage;
  /** Days relative to the period's due date. Negative = before due. */
  offsetDays: number;
  channel: ReminderChannel;
  /** The last rung. Nothing automated follows it for this period. */
  terminal?: boolean;
}

/**
 * The borrower reminder ladder. BOUNDED BY CONSTRUCTION: five rungs, one row
 * per (note, stage, period), and `demand_letter` is terminal — after day 30 the
 * machine stops contacting the borrower and the note sits in the founder's
 * default-candidate alert. There is no rung that repeats, so the ladder cannot
 * nag forever.
 *
 * Missed rungs are deliberately NOT backfilled: a note first seen at day 20
 * gets the day-15 rung only, not a burst of four notices.
 */
export const BORROWER_LADDER: readonly LadderRung[] = [
  { stage: "upcoming", offsetDays: -3, channel: "email" },
  { stage: "due", offsetDays: 0, channel: "email" },
  { stage: "late", offsetDays: 5, channel: "email" },
  { stage: "final_warning", offsetDays: 15, channel: "email" },
  { stage: "demand_letter", offsetDays: 30, channel: "letter", terminal: true },
];

/** How long a `queued` reminder stays retryable before a human must act. */
export const REMINDER_RETRY_WINDOW_DAYS = 14;

/** Midnight UTC of the given instant — the stable basis for the period key. */
export function utcMidnight(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/**
 * Whole days from the period due date to `now`. Signed: -3 means "due in three
 * days", +5 means "five days past due".
 */
export function daysRelativeToDue(dueDate: Date, now: Date = new Date()): number {
  return Math.floor((utcMidnight(now).getTime() - utcMidnight(dueDate).getTime()) / DAY_MS);
}

/**
 * The rung this note is on right now, or null when it is too early for any.
 * Past the terminal rung's offset the answer stays the terminal rung, and
 * idempotency ensures it is only ever created once for the period.
 */
export function currentLadderRung(relativeDays: number): LadderRung | null {
  let match: LadderRung | null = null;
  for (const rung of BORROWER_LADDER) {
    if (relativeDays >= rung.offsetDays) match = rung;
  }
  return match;
}

/**
 * Idempotency key for one rung of one period: `note:<id>:<stage>:<YYYY-MM-DD>`
 * where the date is the period's due date. Stored implicitly — `scheduledFor`
 * is derived as `periodDue + offsetDays` at UTC midnight, so the repo can look
 * the row up on (noteId, type, scheduledFor window) with no new column and no
 * migration. Exported so tests and surfaces can name the key.
 */
export function reminderIdempotencyKey(
  noteId: number,
  stage: BorrowerNoticeStage,
  periodDueDate: Date,
): string {
  return `note:${noteId}:${stage}:${utcMidnight(periodDueDate).toISOString().slice(0, 10)}`;
}

/** The exact instant a rung fires: period due date + offset, UTC midnight. */
export function rungScheduledFor(periodDueDate: Date, offsetDays: number): Date {
  return new Date(utcMidnight(periodDueDate).getTime() + offsetDays * DAY_MS);
}

export class FinanceAgentService {
  calculateDaysDelinquent(nextPaymentDate: Date | null): number {
    if (!nextPaymentDate) return 0;
    const now = new Date();
    const diffTime = now.getTime() - nextPaymentDate.getTime();
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    return Math.max(0, diffDays);
  }

  getDelinquencyStatus(daysDelinquent: number): DelinquencyStatus {
    if (daysDelinquent <= 0) return "current";
    if (daysDelinquent <= DELINQUENCY_THRESHOLDS.earlyDelinquent.max) return "early_delinquent";
    if (daysDelinquent <= DELINQUENCY_THRESHOLDS.delinquent.max) return "delinquent";
    if (daysDelinquent <= DELINQUENCY_THRESHOLDS.seriouslyDelinquent.max) return "seriously_delinquent";
    return "default_candidate";
  }

  async detectDelinquency(note: Note): Promise<{
    daysDelinquent: number;
    status: DelinquencyStatus;
    statusChanged: boolean;
  }> {
    const daysDelinquent = this.calculateDaysDelinquent(note.nextPaymentDate);
    const newStatus = this.getDelinquencyStatus(daysDelinquent);
    const oldStatus = (note.delinquencyStatus as DelinquencyStatus) || "current";
    const statusChanged = newStatus !== oldStatus;

    if (statusChanged || daysDelinquent !== (note.daysDelinquent || 0)) {
      await storage.updateNote(note.id, {
        daysDelinquent,
        delinquencyStatus: newStatus,
      }, note.organizationId);
    }

    return { daysDelinquent, status: newStatus, statusChanged };
  }

  /**
   * Values every notice template needs, read ONLY from the note/borrower rows.
   * Missing values stay missing — the templates render words instead of
   * inventing an amount or a date.
   */
  private async noticeInput(
    note: Note,
    borrower: Lead | null,
    relativeDays: number,
    lenderName: string | null,
  ): Promise<BorrowerNoticeInput> {
    const name = borrower
      ? [borrower.firstName, borrower.lastName].filter(Boolean).join(" ").trim()
      : "";
    // A notice must never embed a dead link: an EXPIRED portal token is
    // rotated (and its old sessions revoked) before the URL is built, so
    // "ask your lender to send a fresh link" is true by construction. Live
    // tokens pass through untouched — no rotation churn on routine sends.
    const liveNote = await ensureLivePortalLink(note);
    return {
      borrowerName: name.length > 0 ? name : null,
      amountDue: note.monthlyPayment ?? null,
      currentBalance: note.currentBalance ?? null,
      dueDate: note.nextPaymentDate ?? null,
      daysLate: Math.max(0, relativeDays),
      lenderName,
      portalUrl: this.borrowerPortalUrl(liveNote),
      noteReference: `Note #${note.id}`,
    };
  }

  /**
   * Borrower payment-portal link, or null. Built only when the note actually
   * carries an access token AND a public app URL is configured — a notice must
   * never point a late borrower at a broken link.
   */
  private borrowerPortalUrl(note: Note): string | null {
    if (!note.accessToken) return null;
    const base = (process.env.PUBLIC_APP_URL || process.env.APP_URL || "").trim().replace(/\/+$/, "");
    if (base.length === 0) return null;
    return `${base}/portal/${note.accessToken}`;
  }

  private async lenderNameFor(orgId: number): Promise<string | null> {
    try {
      const org = await storage.getOrganization(orgId);
      const name = (org?.name ?? "").trim();
      return name.length > 0 ? name : null;
    } catch {
      return null;
    }
  }

  /**
   * Deterministic notice body for a stage.
   *
   * Was an LLM call with a hardcoded fallback. Collection notices are
   * regulated, carry statutory disclosure text, and quote money — a
   * temperature-0.7 generator is the wrong tool, and an outage there must not
   * be able to empty a legal notice. The templates in ./borrowerNotices are
   * pure functions of the note row.
   */
  async generateReminderContent(
    note: Note,
    borrower: Lead | null,
    type: ReminderType,
    orgId: number,
  ): Promise<string> {
    const relativeDays = note.nextPaymentDate ? daysRelativeToDue(note.nextPaymentDate) : 0;
    const lenderName = await this.lenderNameFor(orgId);
    const input = await this.noticeInput(note, borrower, relativeDays, lenderName);
    return buildBorrowerNotice(type, input).text;
  }

  /**
   * Create the ONE reminder row this note currently owes, if it does not
   * already exist.
   *
   * Idempotent by (note, stage, period): the row's `scheduledFor` is
   * `periodDue + rung.offsetDays` at UTC midnight, so a re-run finds the
   * existing row and creates nothing. Any status counts as a hit — a rung that
   * was blocked or marked unavailable is not resurrected.
   *
   * Never backfills skipped rungs, and stops permanently after the terminal
   * rung: the ladder terminates.
   */
  async ensureLadderRung(
    note: Note,
    borrower: Lead | null,
    now: Date = new Date(),
  ): Promise<{
    created: boolean;
    stage?: BorrowerNoticeStage;
    idempotencyKey?: string;
    reason?: string;
  }> {
    if (note.status !== "active") return { created: false, reason: "note is not active" };
    if (!note.nextPaymentDate) return { created: false, reason: "note has no next payment date" };

    const periodDue = note.nextPaymentDate;
    const relativeDays = daysRelativeToDue(periodDue, now);
    const rung = currentLadderRung(relativeDays);
    if (!rung) return { created: false, reason: "too early for the first rung" };

    const scheduledFor = rungScheduledFor(periodDue, rung.offsetDays);
    const idempotencyKey = reminderIdempotencyKey(note.id, rung.stage, periodDue);

    const existing = await storage.findLadderReminder(
      note.id,
      rung.stage,
      scheduledFor,
      new Date(scheduledFor.getTime() + DAY_MS),
    );
    if (existing) {
      return { created: false, stage: rung.stage, idempotencyKey, reason: "already exists" };
    }

    const lenderName = await this.lenderNameFor(note.organizationId);
    const input = await this.noticeInput(note, borrower, relativeDays, lenderName);
    const channel = this.channelForRung(rung, borrower);
    const content =
      channel === "sms"
        ? buildBorrowerSmsText(rung.stage, input).text
        : channel === "letter"
          ? buildBorrowerLetter(rung.stage, input).letterText
          : buildBorrowerNotice(rung.stage, input).text;

    const reminder: InsertPaymentReminder = {
      organizationId: note.organizationId,
      noteId: note.id,
      borrowerId: borrower?.id ?? null,
      type: rung.stage,
      scheduledFor,
      channel,
      content,
      status: REMINDER_STATUS.scheduled,
    };

    await storage.createPaymentReminder(reminder);
    logger.info("[FinanceAgent] Borrower reminder queued by the ladder", {
      metadata: {
        __pii_safe: true,
        organizationId: note.organizationId,
        noteId: note.id,
        stage: rung.stage,
        channel,
        relativeDays,
        idempotencyKey,
        terminal: rung.terminal === true,
      },
    });

    return { created: true, stage: rung.stage, idempotencyKey };
  }

  /**
   * Channel for a rung. The letter rung is always a document. Otherwise email
   * when the borrower has one, SMS when they only have a phone. When we have
   * neither the row is still created on `email` so the dispatch pass records an
   * honest `unavailable` with the reason, instead of the note silently going
   * uncontacted.
   */
  private channelForRung(rung: LadderRung, borrower: Lead | null): ReminderChannel {
    if (rung.channel === "letter") return "letter";
    if (borrower?.email) return "email";
    if (borrower?.phone) return "sms";
    return "email";
  }

  /**
   * Back-compat shim for the old name. Returns the number of rows created
   * (0 or 1) — the ladder creates at most one rung per tick.
   */
  async scheduleReminders(note: Note, borrower: Lead | null): Promise<number> {
    const result = await this.ensureLadderRung(note, borrower);
    return result.created ? 1 : 0;
  }

  /**
   * Does this org have its OWN connected sending identity?
   *
   * Borrower mail is counterparty mail (founder decision 2026-07-17): it must
   * carry the customer's identity — their BYO SES integration or a verified
   * sending domain — never the platform @acreos.io sender. emailService remains
   * the ENFORCEMENT point (it refuses `purpose: 'counterparty'` without one);
   * this preflight exists only so the reminder row can record the honest,
   * specific reason ("connect your email") instead of a generic failure, and so
   * we don't burn a send attempt we know will be refused.
   *
   * Fails CLOSED: an unreadable identity state reports "no identity", which
   * queues the reminder rather than pretending it went out.
   */
  async hasConnectedSendingIdentity(orgId: number): Promise<boolean> {
    try {
      const [integration, identity] = await Promise.all([
        storage.getOrganizationIntegration(orgId, "aws_ses").catch(() => null),
        getIdentityForSend(orgId).catch(() => null),
      ]);
      const byoSes = !!integration?.isEnabled && !!integration?.credentials?.encrypted;
      return byoSes || !!identity;
    } catch (error) {
      logger.warn("[FinanceAgent] Could not verify the org's sending identity — treating as absent", {
        metadata: { organizationId: orgId },
      });
      void error;
      return false;
    }
  }

  /**
   * Attempt delivery of ONE reminder row and write the honest outcome.
   *
   * Never returns without recording a status, and `sent` is only ever written
   * through recordReminderOutcome with the accepting rail — the storage layer
   * throws otherwise, so a "recorded as sent but never sent" regression cannot
   * be introduced here by accident.
   */
  async dispatchReminder(reminder: {
    id: number;
    organizationId: number;
    noteId: number;
    borrowerId: number | null;
    type: string;
    channel: string;
    content: string | null;
  }, options: {
    /**
     * Set ONLY by the human-initiated path (sendManualReminder). The tap IS the
     * approval the "assisted" autonomy level demands, so that one gate is
     * satisfied rather than bypassed. Every other gate still applies.
     */
    humanApproved?: boolean;
  } = {}): Promise<{ status: string; reason?: string }> {
    const orgId = reminder.organizationId;

    const finish = async (status: string, reason?: string, acceptedBy?: string) => {
      await storage.recordReminderOutcome(
        reminder.id,
        {
          status: status as "sent" | "queued" | "unavailable" | "blocked" | "failed" | "cancelled",
          reason: reason ?? null,
          acceptedBy: acceptedBy ?? null,
        },
        orgId,
      );
      if (status !== REMINDER_STATUS.sent) {
        logger.info("[FinanceAgent] Borrower reminder NOT sent", {
          metadata: {
            __pii_safe: true,
            organizationId: orgId,
            reminderId: reminder.id,
            noteId: reminder.noteId,
            stage: reminder.type,
            channel: reminder.channel,
            status,
            reason,
          },
        });
      }
      return { status, reason };
    };

    const note = await storage.getNote(orgId, reminder.noteId);
    if (!note) {
      return finish(REMINDER_STATUS.failed, "Note not found");
    }
    if (note.status !== "active") {
      return finish(REMINDER_STATUS.cancelled, `Note is ${note.status} — no borrower contact sent`);
    }

    // ── Gate 1: Pax pause kill switch (fails closed) ────────────────────────
    const pause = await getPaxPauseState(orgId);
    if (pause.paused) {
      return finish(REMINDER_STATUS.queued, paxPauseRefusalMessage(pause));
    }

    // ── Gate 2: org autonomy level ──────────────────────────────────────────
    // "assisted" is the default and its standing promise is that NOTHING sends
    // without an explicit human tap. A borrower collection notice does not get
    // to opt out of that promise on its own authority: the notice is fully
    // prepared and parked for one-tap approval. Orgs at supervised/autonomous
    // dispatch unattended.
    const autonomy = await getOrgAutonomyLevel(orgId);
    if (autonomy === "assisted" && !options.humanApproved) {
      return finish(
        REMINDER_STATUS.awaitingApproval,
        "Ready to send — your autonomy level is 'assisted', so Pax waits for your tap (Settings → Pax controls).",
      );
    }

    // ── Letter rung: document only, never claimed as mailed ─────────────────
    if (reminder.channel === "letter") {
      return finish(REMINDER_STATUS.documentReady, PHYSICAL_MAIL_STATUS.reason);
    }

    if (!reminder.borrowerId) {
      return finish(REMINDER_STATUS.unavailable, "No borrower is linked to this note");
    }

    const channel: "email" | "sms" = reminder.channel === "sms" ? "sms" : "email";

    // ── Gate 3: the org's own sending identity (counterparty mail) ──────────
    if (channel === "email" && !(await this.hasConnectedSendingIdentity(orgId))) {
      return finish(
        REMINDER_STATUS.queued,
        "No connected email identity for this organization. Borrower mail must come from your own address — connect your email or verify your sending domain (Settings → Connections). The notice stays queued and will send once you do.",
      );
    }

    // ── Gate 4: daily autonomous-send envelope ──────────────────────────────
    const rate = await checkSendRateLimit(orgId, channel);
    if (!rate.allowed) {
      return finish(REMINDER_STATUS.queued, rate.reason ?? "Daily autonomous send envelope reached");
    }

    const body = reminder.content;
    if (!body || body.trim().length === 0) {
      return finish(REMINDER_STATUS.failed, "Reminder has no content — refusing to send an empty notice");
    }

    // ── Gate 5: the comms chokepoint ────────────────────────────────────────
    // sendToLead applies TCPA consent, the contact-frequency cap and per-channel
    // consent, and for SMS routes through sendOrgSMS (consent → recipient-local
    // quiet hours → DNC → frequency). Email carries purpose:'counterparty'
    // inside, so the platform sender is not reachable from this path.
    const { communicationsService } = await import("./communications");
    const result = await communicationsService.sendToLead({
      organizationId: orgId,
      leadId: reminder.borrowerId,
      channel,
      subject: this.subjectForStage(reminder.type),
      message: body,
    });

    if (result.success) {
      await storage.updateNote(
        note.id,
        {
          lastReminderSentAt: new Date(),
          reminderCount: (note.reminderCount || 0) + 1,
        },
        orgId,
      );
      await recordAutonomousSend(orgId, channel, reminder.borrowerId, body);
      return finish(REMINDER_STATUS.sent, undefined, result.channel || channel);
    }

    const error = result.error ?? "Rail did not accept the message";
    if (result.tcpaBlocked) {
      return finish(REMINDER_STATUS.blocked, error);
    }
    if (result.frequencyCapped) {
      return finish(REMINDER_STATUS.queued, error);
    }
    if (/suppress/i.test(error)) {
      return finish(REMINDER_STATUS.unavailable, error);
    }
    return finish(REMINDER_STATUS.queued, error);
  }

  private subjectForStage(stage: string): string {
    switch (stage) {
      case "upcoming":
        return "Payment reminder — coming due";
      case "due":
        return "Payment due today";
      case "late":
        return "Past due notice";
      case "final_warning":
        return "FINAL NOTICE — your account is seriously past due";
      case "demand_letter":
        return "NOTICE OF DEFAULT AND DEMAND FOR PAYMENT";
      default:
        return "Payment reminder";
    }
  }

  /**
   * Dispatch every reminder whose moment has arrived, plus `queued` rows still
   * inside the bounded retry window. Returns an honest breakdown — `sent` counts
   * only rail-accepted messages.
   */
  async dispatchDueReminders(limit = 50): Promise<{
    sent: number;
    queued: number;
    blocked: number;
    unavailable: number;
    awaitingApproval: number;
    documentReady: number;
    failed: number;
  }> {
    const tally = {
      sent: 0,
      queued: 0,
      blocked: 0,
      unavailable: 0,
      awaitingApproval: 0,
      documentReady: 0,
      failed: 0,
    };

    const due = await storage.getDispatchableReminders(limit, REMINDER_RETRY_WINDOW_DAYS);

    for (const reminder of due) {
      try {
        const outcome = await this.dispatchReminder(reminder);
        switch (outcome.status) {
          case REMINDER_STATUS.sent:
            tally.sent++;
            break;
          case REMINDER_STATUS.queued:
            tally.queued++;
            break;
          case REMINDER_STATUS.blocked:
            tally.blocked++;
            break;
          case REMINDER_STATUS.unavailable:
            tally.unavailable++;
            break;
          case REMINDER_STATUS.awaitingApproval:
            tally.awaitingApproval++;
            break;
          case REMINDER_STATUS.documentReady:
            tally.documentReady++;
            break;
          default:
            tally.failed++;
        }
      } catch (error) {
        logger.error("[FinanceAgent] Dispatch threw — recording failure", error, {
          metadata: { reminderId: reminder.id, organizationId: reminder.organizationId },
        });
        await storage
          .recordReminderOutcome(
            reminder.id,
            {
              status: "failed",
              reason: error instanceof Error ? error.message : "Unknown dispatch error",
            },
            reminder.organizationId,
          )
          .catch(() => {});
        tally.failed++;
      }
    }

    return tally;
  }

  /**
   * @deprecated Kept for the old call shape. `sent` is now a real count of
   * rail-accepted messages; everything else lands in `failed`'s sibling
   * buckets, so prefer dispatchDueReminders() for the full breakdown.
   */
  async processReminders(): Promise<{ sent: number; failed: number }> {
    const tally = await this.dispatchDueReminders();
    return { sent: tally.sent, failed: tally.failed };
  }

  async updateDelinquencyStatus(note: Note): Promise<void> {
    const { daysDelinquent, status, statusChanged } = await this.detectDelinquency(note);

    if (status === "default_candidate" && statusChanged) {
      const alert: InsertSystemAlert = {
        type: "finance_delinquency",
        alertType: "revenue_at_risk",
        severity: "critical",
        title: `Default Candidate: Note #${note.id}`,
        message: `Note #${note.id} is ${daysDelinquent} days delinquent and is now a default candidate. Balance: $${Number(note.currentBalance || 0).toFixed(2)}. Immediate attention required.`,
        organizationId: note.organizationId,
        relatedEntityType: "note",
        relatedEntityId: note.id,
        status: "new",
        metadata: {
          daysDelinquent,
          currentBalance: note.currentBalance,
          borrowerId: note.borrowerId,
        },
      };

      await storage.createSystemAlert(alert);
      logger.info(`[FinanceAgent] Created default candidate alert for note ${note.id}`);
    }
  }

  async processOrganizationNotes(orgId: number): Promise<{
    processed: number;
    remindersScheduled: number;
    statusUpdates: number;
    errors: string[];
  }> {
    const errors: string[] = [];
    let processed = 0;
    let remindersScheduled = 0;
    let statusUpdates = 0;

    try {
      const notesNeedingReminders = await storage.getNotesNeedingReminders(orgId);
      const delinquentNotes = await storage.getDelinquentNotes(orgId);
      
      const allNotes = new Map<number, Note>();
      for (const note of [...notesNeedingReminders, ...delinquentNotes]) {
        allNotes.set(note.id, note);
      }

      for (const note of Array.from(allNotes.values())) {
        try {
          let borrower: Lead | null = null;
          if (note.borrowerId) {
            borrower = await storage.getLead(orgId, note.borrowerId) || null;
          }

          const { statusChanged } = await this.detectDelinquency(note);
          if (statusChanged) {
            statusUpdates++;
            await this.updateDelinquencyStatus(note);
          }

          const scheduled = await this.scheduleReminders(note, borrower);
          remindersScheduled += scheduled;

          processed++;
        } catch (error) {
          const errorMsg = `Error processing note ${note.id}: ${error instanceof Error ? error.message : "Unknown error"}`;
          errors.push(errorMsg);
          logger.error(`[FinanceAgent] ${errorMsg}`);
        }
      }
    } catch (error) {
      const errorMsg = `Error fetching notes for org ${orgId}: ${error instanceof Error ? error.message : "Unknown error"}`;
      errors.push(errorMsg);
      logger.error(`[FinanceAgent] ${errorMsg}`);
    }

    return { processed, remindersScheduled, statusUpdates, errors };
  }

  async runFinanceAgentJob(): Promise<{
    orgsProcessed: number;
    totalNotes: number;
    remindersSent: number;
    remindersScheduled: number;
    errors: string[];
  }> {
    // Driven by the already-registered `finance_agent` scheduled tick
    // (server/jobs/runScheduledJobs.ts → startFinanceAgentJob, self-rescheduling
    // every 30m under a Postgres job lock). The ladder body lives in
    // server/jobs/borrowerDunningLadder.ts; it is imported dynamically so the
    // job module can import this service statically without a cycle.
    const { runBorrowerDunningLadder } = await import("../jobs/borrowerDunningLadder");
    return runBorrowerDunningLadder();
  }

  /**
   * Human-initiated reminder (the "Send reminder" / "Escalate" buttons).
   *
   * This used to insert a row with `status: "sent"` and never touch a rail —
   * the borrower was told nothing while the UI reported success. Now it creates
   * the row and dispatches it through the SAME chokepoint and the SAME gates as
   * the automated ladder, then returns the real outcome. `success` means the row
   * exists and was acted on; `status`/`deliveryNote` say whether a rail actually
   * accepted it, so callers can stop saying "Reminder sent" when it wasn't.
   *
   * The human tap satisfies the "assisted" autonomy promise, so the
   * awaiting-approval gate is skipped here — and only here.
   */
  async sendManualReminder(
    noteId: number,
    orgId: number,
    type: ReminderType = "due"
  ): Promise<{
    success: boolean;
    reminderId?: number;
    error?: string;
    status?: string;
    deliveryNote?: string;
    /** Present for the letter rung: the artifact to download. Nothing was mailed. */
    document?: { filename: string; text: string; delivered: false; reason: string };
  }> {
    try {
      const note = await storage.getNote(orgId, noteId);
      if (!note) {
        return { success: false, error: "Note not found" };
      }

      let borrower: Lead | null = null;
      if (note.borrowerId) {
        borrower = await storage.getLead(orgId, note.borrowerId) || null;
      }

      const relativeDays = note.nextPaymentDate ? daysRelativeToDue(note.nextPaymentDate) : 0;
      const lenderName = await this.lenderNameFor(orgId);
      const input = await this.noticeInput(note, borrower, relativeDays, lenderName);

      // The letter rung produces a DOCUMENT. Physical mail is not wired, so we
      // hand back the artifact and record `document_ready` — never "sent".
      if (type === "demand_letter") {
        const letter = buildBorrowerLetter(type, input);
        const created = await storage.createPaymentReminder({
          organizationId: orgId,
          noteId,
          borrowerId: borrower?.id ?? null,
          type,
          scheduledFor: new Date(),
          channel: "letter",
          content: letter.letterText,
          status: REMINDER_STATUS.documentReady,
          failureReason: PHYSICAL_MAIL_STATUS.reason,
        });
        return {
          success: true,
          reminderId: created.id,
          status: REMINDER_STATUS.documentReady,
          deliveryNote: PHYSICAL_MAIL_STATUS.reason,
          document: {
            filename: letter.filename,
            text: letter.letterText,
            delivered: false,
            reason: PHYSICAL_MAIL_STATUS.reason,
          },
        };
      }

      const channel: ReminderChannel = borrower?.email
        ? "email"
        : borrower?.phone
          ? "sms"
          : "email";
      const content =
        channel === "sms" ? buildBorrowerSmsText(type, input).text : buildBorrowerNotice(type, input).text;

      const created = await storage.createPaymentReminder({
        organizationId: orgId,
        noteId,
        borrowerId: borrower?.id ?? null,
        type,
        scheduledFor: new Date(),
        channel,
        content,
        status: REMINDER_STATUS.scheduled,
      });

      const outcome = await this.dispatchReminder({
        id: created.id,
        organizationId: orgId,
        noteId,
        borrowerId: borrower?.id ?? null,
        type,
        channel,
        content,
      }, { humanApproved: true });

      return {
        success: true,
        reminderId: created.id,
        status: outcome.status,
        deliveryNote:
          outcome.status === REMINDER_STATUS.sent
            ? undefined
            : outcome.reason ?? "The notice was not delivered.",
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error"
      };
    }
  }
}

export const financeAgentService = new FinanceAgentService();
