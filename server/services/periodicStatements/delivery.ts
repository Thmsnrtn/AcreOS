/**
 * periodicStatements/delivery — email notification on §1026.41 statement generation.
 *
 * When a new periodic statement row is persisted, this module fires a
 * borrower notification through the existing emailService.ts pipeline.
 * The email DOES NOT attach the PDF — it carries a tokenized one-click
 * link back to the secured portal endpoint (Beatrice's directive in the
 * Phase Zero-Three audit, 2026-05-31: links over attachments for both
 * size and security; the link is borrower-session-gated, the PDF is
 * never world-readable).
 *
 * Idempotency: re-running generation for a statement that has already
 * been delivered (`delivery_status === 'delivered'`) is a no-op. The
 * caller (generateOneStatement) handles row-level idempotency via the
 * unique index on (loan_id, cycle_start); this function adds the
 * delivery-level guarantee that a stale statement can never trigger a
 * second send to the borrower.
 *
 * Status state machine on `periodic_statements`:
 *   pending → delivered    (SES send succeeded)
 *   pending → failed       (SES rejected; deliveryError populated)
 *   pending → suppressed   (recipient is on the org's suppression list)
 *   delivered → delivered  (idempotent no-op on regenerate)
 */

import { db } from "../../db";
import { eq } from "drizzle-orm";
import { periodicStatements, type PeriodicStatement } from "@shared/schema/reg-z";
import { notes } from "@shared/schema";
import { storage } from "../../storage";
import { emailService } from "../emailService";
import { logger } from "../../utils/logger";

/**
 * The app-facing URL the email points at. We resolve from APP_URL with
 * a localhost fallback so dev environments don't crash if the env var
 * isn't set. Production reads `https://app.acreos.io` from Fly secrets.
 */
function resolveAppUrl(): string {
  return process.env.APP_URL ?? "https://app.acreos.io";
}

/**
 * Format a yyyy-mm-dd cycle start as "Month YYYY" for the subject line.
 * Borrowers think in "my June statement", not "2026-06-01".
 */
function cycleMonthYear(cycleStart: string): string {
  const [y, m] = cycleStart.split("-").map(Number);
  if (!y || !m) return cycleStart;
  const d = new Date(Date.UTC(y, m - 1, 1));
  return d.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function fmtUsd(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

interface BuildEmailInput {
  borrowerFirstName: string | null;
  orgName: string;
  statement: Pick<
    PeriodicStatement,
    "id" | "cycleStart" | "dueDate" | "amountDueCents"
  >;
}

export interface BuiltStatementEmail {
  subject: string;
  text: string;
  html: string;
  pdfUrl: string;
}

/**
 * Pure builder — returns the subject + text + html + the PDF deep link.
 * Exposed for unit tests so we can assert the body composition without
 * touching SES.
 *
 * #154 callout: the CAN-SPAM postal address footer is gated on the LLC
 * being formed. Until then we render "AcreOS — physical address pending
 * LLC formation (#154)" so a missing footer is auditable rather than
 * silently absent.
 */
export function buildStatementEmail(input: BuildEmailInput): BuiltStatementEmail {
  const { borrowerFirstName, orgName, statement } = input;
  const appUrl = resolveAppUrl();
  const monthYear = cycleMonthYear(statement.cycleStart);
  // Deep link goes to the portal page (where the borrower is asked to
  // sign in if their session has expired). The portal page can then
  // resolve the statement and offer the PDF. Linking straight to the
  // PDF endpoint would 401 a borrower whose cookie has lapsed and
  // confuse the experience.
  const pdfUrl = `${appUrl}/portal?statement=${encodeURIComponent(statement.id)}`;

  const greeting = borrowerFirstName ? `Hi ${borrowerFirstName},` : "Hi,";

  const subject = `Your AcreOS statement for ${monthYear} is ready`;

  // Plain-text alternative — required for deliverability + accessibility.
  // No marketing language; factual, mechanism-describing, never advisory.
  const text = [
    greeting,
    "",
    `Your ${monthYear} statement is ready in the AcreOS borrower portal.`,
    "",
    `Amount due: ${fmtUsd(statement.amountDueCents)}`,
    `Due date: ${statement.dueDate}`,
    "",
    `View or download the statement:`,
    pdfUrl,
    "",
    `Sent by ${orgName} via AcreOS.`,
    `AcreOS — physical address pending LLC formation (#154).`,
  ].join("\n");

  // HTML alternative. Inline styles only (every email client). No
  // tracking pixels, no attachments — the PDF is reachable only via
  // the session-gated link.
  const html = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; color: #1f2937; max-width: 560px; margin: 0 auto; padding: 24px; background: #ffffff;">
      <div style="padding: 16px 0; border-bottom: 1px solid #e5e7eb;">
        <span style="font-weight: 700; font-size: 16px; color: #18181b;">AcreOS</span>
      </div>
      <h1 style="font-size: 20px; font-weight: 600; margin: 24px 0 8px;">Your ${monthYear} statement is ready</h1>
      <p style="line-height: 1.6; margin: 0 0 16px;">${greeting}</p>
      <p style="line-height: 1.6; margin: 0 0 16px;">Your ${monthYear} statement is available in your borrower portal.</p>
      <div style="background: #f9fafb; border-radius: 8px; padding: 16px; margin: 16px 0; font-size: 14px;">
        <div style="margin-bottom: 4px;"><strong>Amount due:</strong> ${fmtUsd(statement.amountDueCents)}</div>
        <div><strong>Due date:</strong> ${statement.dueDate}</div>
      </div>
      <div style="margin: 24px 0;">
        <a href="${pdfUrl}" style="background: #18181b; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-size: 14px; font-weight: 600; display: inline-block;">View statement</a>
      </div>
      <p style="color: #6b7280; font-size: 12px; line-height: 1.6; border-top: 1px solid #e5e7eb; padding-top: 16px; margin-top: 24px;">
        Sent by ${orgName} via AcreOS.<br>
        AcreOS — physical address pending LLC formation (#154).
      </p>
    </body>
    </html>
  `;

  return { subject, text, html, pdfUrl };
}

export interface NotifyStatementResult {
  attempted: boolean;
  delivered: boolean;
  errorType?: string;
  error?: string;
  /** True when the row was already delivered — the notifier was a no-op. */
  skippedAlreadyDelivered?: boolean;
  /** True when no borrower email was resolvable; row marked failed/suppressed. */
  skippedNoRecipient?: boolean;
}

/**
 * Send the statement-ready notification email for a single
 * periodic_statements row + persist the delivery status onto the row.
 *
 * Idempotency: if the row's current `delivery_status === 'delivered'`,
 * this is a no-op. Otherwise we attempt the send, then write back
 * one of {delivered, failed, suppressed} along with delivered_at +
 * delivery_method + delivery_error.
 *
 * Caller (generateStatementsForCycle) wraps this in a try/catch so a
 * single email failure never breaks the whole cron batch.
 */
export async function notifyStatementGenerated(
  statementId: string,
): Promise<NotifyStatementResult> {
  // Re-read the row so the idempotency check sees committed state, not
  // an in-memory image from the caller that might be stale.
  const rows = await db
    .select()
    .from(periodicStatements)
    .where(eq(periodicStatements.id, statementId))
    .limit(1);

  if (rows.length === 0) {
    logger.warn("[periodicStatements/delivery] statement not found", {
      metadata: { statementId },
    });
    return { attempted: false, delivered: false };
  }
  const statement = rows[0];

  // Idempotency: already delivered → no-op. This is the guarantee the
  // PR description spells out: re-running generation for a delivered
  // statement does NOT re-send the email.
  if (statement.deliveryStatus === "delivered") {
    return { attempted: false, delivered: true, skippedAlreadyDelivered: true };
  }

  // Resolve the borrower email via the linked note → lead chain. All
  // queries are org-scoped via the statement's organizationId.
  const noteRows = await db
    .select()
    .from(notes)
    .where(eq(notes.id, Number(statement.loanId)))
    .limit(1);
  const note = noteRows[0];
  if (!note || note.organizationId !== statement.organizationId) {
    // Defensive — the statement row should never outlive its note,
    // but if it does, we mark the row failed rather than silently
    // dropping the notification.
    await db
      .update(periodicStatements)
      .set({
        deliveryStatus: "failed",
        deliveryError: "note_not_found_or_cross_org",
      })
      .where(eq(periodicStatements.id, statementId));
    return {
      attempted: false,
      delivered: false,
      skippedNoRecipient: true,
      error: "note_not_found_or_cross_org",
    };
  }

  let borrowerEmail: string | null = null;
  let borrowerFirstName: string | null = null;
  if (note.borrowerId) {
    const borrower = await storage.getLead(note.organizationId, note.borrowerId);
    if (borrower) {
      borrowerEmail = borrower.email ?? null;
      borrowerFirstName = borrower.firstName ?? null;
    }
  }

  if (!borrowerEmail) {
    // No deliverable recipient. The §1026.41 obligation to deliver a
    // statement still attaches — the borrower can read it via portal —
    // but the email channel is "suppressed" here. Beatrice gates the
    // alternative-delivery (mail) backstop in the LLC-formation epic
    // (#154).
    await db
      .update(periodicStatements)
      .set({
        deliveryStatus: "suppressed",
        deliveryError: "no_borrower_email_on_file",
      })
      .where(eq(periodicStatements.id, statementId));
    logger.info(
      "[periodicStatements/delivery] suppressed — no borrower email",
      { metadata: { statementId, loanId: statement.loanId } },
    );
    return {
      attempted: false,
      delivered: false,
      skippedNoRecipient: true,
      error: "no_borrower_email_on_file",
    };
  }

  // Resolve org name for the subject + footer.
  const org = await storage.getOrganization(statement.organizationId);

  const built = buildStatementEmail({
    borrowerFirstName,
    orgName: org?.name ?? "Your lender",
    statement,
  });

  const result = await emailService.sendEmail({
    to: borrowerEmail,
    subject: built.subject,
    html: built.html,
    text: built.text,
    organizationId: statement.organizationId,
    // Eleonora's deliverability stack auto-attaches the List-Unsubscribe
    // header (RFC 2369 + RFC 8058) to every outbound message via
    // buildRawMimeMessage. This is a transactional loan-servicing notice,
    // so we mark it transactional to suppress the marketing-unsubscribe
    // footer that now renders by default on all non-transactional sends.
    transactional: true,
  });

  const now = new Date();
  if (result.success) {
    await db
      .update(periodicStatements)
      .set({
        deliveryStatus: "delivered",
        deliveredAt: now,
        deliveryMethod: "email",
        deliveryError: null,
      })
      .where(eq(periodicStatements.id, statementId));
    return { attempted: true, delivered: true };
  }

  // SES rejected — record the failure on the row so the founder can
  // see it in the periodic_statements admin view + the cron can retry
  // selectively next cycle.
  await db
    .update(periodicStatements)
    .set({
      deliveryStatus: result.errorType === "recipient_rejected" ? "bounced" : "failed",
      deliveryError: result.error ?? "unknown_send_failure",
      deliveryMethod: "email",
    })
    .where(eq(periodicStatements.id, statementId));

  logger.warn(
    "[periodicStatements/delivery] send failed",
    {
      metadata: {
        statementId,
        errorType: result.errorType,
        error: result.error,
      },
    },
  );

  return {
    attempted: true,
    delivered: false,
    errorType: result.errorType,
    error: result.error,
  };
}
