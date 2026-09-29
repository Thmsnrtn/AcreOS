/**
 * The notices of the 90-day borrower wind-down (founder ruling 2026-09-29 #3,
 * DEFECT-0106). The phase rule itself is `servicingPhase.ts`; this pass only
 * tells the people it affects.
 *
 *  - LENDER, during the wind-down: "your subscription ended on X; your
 *    borrowers' autopay, portal and statements continue until Y; export or
 *    move the book before then." AcreOS → its own customer: the system lane.
 *  - BORROWERS, once it has ended: "pay your lender directly." That is mail
 *    to the lender's counterparty, so it goes on the counterparty lane — the
 *    lender's OWN identity (founder decision 2026-07-17). If the lender has
 *    none connected, the send is refused and the lender notice has already
 *    told them they must tell their borrowers themselves.
 *
 * Each notice carries an idempotency key built from the org, the note and the
 * stamped end date, so a daily re-run replays instead of re-sending, a failed
 * send is retried the next day, and a later cancel (a new end date) notifies
 * again. Borrower notices are attempted for 30 days after the wind-down ends,
 * then the pass stops trying and says so in its result.
 */
import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { leads, notes, organizations, teamMembers } from "@shared/schema";
import { db } from "../../db";
import { logger } from "../../utils/logger";
import { emailService } from "../emailService";
import { sendBorrowerNotice } from "./servicingWindDownBorrowerNotice";
import {
  SUBSCRIPTION_ENDED_STATUSES,
  WIND_DOWN_DAYS,
  servicingPhaseFor,
  stampUnstampedSubscriptionEnds,
} from "./servicingPhase";

const DAY_MS = 24 * 60 * 60 * 1000;
const BORROWER_NOTICE_WINDOW_DAYS = 30;

export interface WindDownPassResult {
  stamped: number;
  lendersInWindDown: number;
  lenderNoticesSent: number;
  lenderNoticesNotSent: number;
  borrowerNoticesSent: number;
  borrowerNoticesNotSent: number;
  borrowersWithoutEmail: number;
}

const day = (d: Date) => d.toISOString().slice(0, 10);

export async function runServicingWindDownPass(now: Date = new Date()): Promise<WindDownPassResult> {
  const result: WindDownPassResult = {
    stamped: await stampUnstampedSubscriptionEnds(now),
    lendersInWindDown: 0,
    lenderNoticesSent: 0,
    lenderNoticesNotSent: 0,
    borrowerNoticesSent: 0,
    borrowerNoticesNotSent: 0,
    borrowersWithoutEmail: 0,
  };

  const ended = await db
    .select({
      id: organizations.id,
      name: organizations.name,
      subscriptionStatus: organizations.subscriptionStatus,
      subscriptionEndedAt: organizations.subscriptionEndedAt,
    })
    .from(organizations)
    .where(
      and(
        inArray(organizations.subscriptionStatus, [...SUBSCRIPTION_ENDED_STATUSES]),
        isNotNull(organizations.subscriptionEndedAt),
      ),
    );

  for (const org of ended) {
    const phase = servicingPhaseFor(org, now);
    if (phase.phase === "full") continue;
    try {
      const book = await db
        .select({ noteId: notes.id, email: leads.email, firstName: leads.firstName })
        .from(notes)
        .leftJoin(leads, and(eq(leads.id, notes.borrowerId), eq(leads.organizationId, org.id)))
        .where(and(eq(notes.organizationId, org.id), eq(notes.status, "active"), isNull(notes.deletedAt)));
      // A lender with no live book has nothing to wind down and nobody to tell.
      if (book.length === 0) continue;

      if (phase.phase === "wind_down") {
        result.lendersInWindDown++;
        const sent = await sendLenderNotice(org, phase.endedAt, phase.windDownEndsAt, book.length);
        if (sent) result.lenderNoticesSent++;
        else result.lenderNoticesNotSent++;
        continue;
      }

      // Ended: tell each borrower once, for a bounded window.
      if (now.getTime() - phase.windDownEndsAt.getTime() > BORROWER_NOTICE_WINDOW_DAYS * DAY_MS) continue;
      for (const b of book) {
        if (!b.email) {
          result.borrowersWithoutEmail++;
          continue;
        }
        const sent = await sendBorrowerNotice(org, b.noteId, b.email, b.firstName, phase.endedAt);
        if (sent) result.borrowerNoticesSent++;
        else result.borrowerNoticesNotSent++;
      }
    } catch (err) {
      logger.error("[servicingWindDown] org pass failed", err instanceof Error ? err : undefined, {
        organizationId: org.id,
      });
    }
  }
  return result;
}

async function ownerEmail(organizationId: number): Promise<string | null> {
  const [owner] = await db
    .select({ email: teamMembers.email })
    .from(teamMembers)
    .where(and(eq(teamMembers.organizationId, organizationId), eq(teamMembers.role, "owner")))
    .limit(1);
  return owner?.email ?? null;
}

async function sendLenderNotice(
  org: { id: number; name: string },
  endedAt: Date,
  windDownEndsAt: Date,
  activeNotes: number,
): Promise<boolean> {
  const to = await ownerEmail(org.id);
  if (!to) {
    logger.warn("[servicingWindDown] lender notice not sent — no owner email", { organizationId: org.id });
    return false;
  }
  const lines = [
    `Your AcreOS subscription ended on ${day(endedAt)}.`,
    `You have ${activeNotes} active note${activeNotes === 1 ? "" : "s"}. For your borrowers' protection, AcreOS keeps servicing them — autopay, the borrower portal and monthly statements — until ${day(windDownEndsAt)} (${WIND_DOWN_DAYS} days).`,
    `Before then, export your book (${appUrl()}/data-export) or move servicing elsewhere, and tell your borrowers where to pay.`,
    `After ${day(windDownEndsAt)} no new payment will be taken through AcreOS. Borrowers who sign in will be told to pay you directly, and AcreOS will email them that notice from your own sending identity. If you have not connected one, AcreOS cannot email them — you will need to tell them yourself.`,
    `Payments already in progress will still settle and be recorded. Resubscribing at any time restores full servicing.`,
  ];
  let result: Awaited<ReturnType<typeof emailService.sendEmail>>;
  try {
    result = await emailService.sendEmail({
    organizationId: org.id,
    purpose: "system",
    transactional: true,
    to,
    subject: `Your borrowers: AcreOS servicing ends ${day(windDownEndsAt)}`,
    html: lines.map((l) => `<p>${escapeHtml(l)}</p>`).join("\n"),
    text: lines.join("\n\n"),
    idempotencyKey: `servicing-wind-down:lender:${org.id}:${endedAt.toISOString()}`,
    });
  } catch (err) {
    // An in-flight or ambiguous prior claim refuses by throwing; the next
    // pass tries again (or replays if it went out).
    logger.warn("[servicingWindDown] lender notice refused", {
      organizationId: org.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
  if (!result.success) {
    logger.warn("[servicingWindDown] lender notice not sent", {
      organizationId: org.id,
      errorType: result.errorType,
      error: result.error,
    });
  }
  return result.success;
}

function appUrl(): string {
  return (process.env.APP_URL || "https://app.acreos.io").replace(/\/$/, "");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
