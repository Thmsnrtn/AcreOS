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
 * BYO identity (founder decision 2026-07-17, "no re-fronting platform send
 * rails"): this is LENDER correspondence to the org's own borrower — a
 * counterparty send, not system mail. It therefore carries
 * `purpose: "counterparty"`, which makes emailService refuse the send
 * outright (emailService.ts:614-641) when the org has neither BYO SES
 * credentials nor a verified sending domain. Before that label, a Reg Z
 * §1026.41 statement branded "Sent by <org>" went out over AcreOS's own
 * @acreos.io identity — AcreOS signing regulated lender mail as the lender.
 *
 * Status state machine on `periodic_statements`:
 *   pending → delivered                (SES send succeeded)
 *   pending → bounced                  (SES rejected the RECIPIENT)
 *   pending → failed                   (transient send error; retryable)
 *   pending → suppressed               (no borrower email on file)
 *   pending → blocked_no_org_identity  (ORG has no connected identity —
 *                                       TERMINAL, alerts, never retried)
 *   delivered → delivered              (idempotent no-op on regenerate)
 *   blocked_no_org_identity → itself   (terminal no-op; see NON-RETRY below)
 *
 * NON-RETRY, precisely. Two queries gate a re-attempt and neither one can
 * re-send a blocked statement:
 *
 *   1. periodicStatements/index.ts:556-568 — the (loan_id, cycle_start)
 *      existence SELECT. `if (existing.length > 0 && !regenerate) return
 *      false` returns BEFORE notifyStatementGenerated is reached, so the
 *      monthly cron never re-enters delivery for any already-generated
 *      cycle. This gate is status-blind.
 *   2. THIS module's re-read + terminal guard below (the row SELECT at
 *      `where(eq(periodicStatements.id, statementId))` followed by the
 *      PERIODIC_STATEMENT_TERMINAL_DELIVERY_STATUSES check). This is the
 *      status-SENSITIVE gate, and `blocked_no_org_identity` is a member of
 *      that terminal set — so even an explicit re-entry (ops regenerate,
 *      manual replay, a future retry sweep) returns without touching SES.
 *
 * The only sanctioned way out is an operator regenerate, which rewrites the
 * row with `deliveryStatus: "pending"` (index.ts:602-612 / :1121-1128) after
 * the org has actually connected an identity.
 */

import { db } from "../../db";
import { and, eq, inArray } from "drizzle-orm";
import {
  periodicStatements,
  DELIVERY_STATUS_BLOCKED_NO_ORG_IDENTITY,
  PERIODIC_STATEMENT_TERMINAL_DELIVERY_STATUSES,
  type PeriodicStatement,
} from "@shared/schema/reg-z";
import { notes } from "@shared/schema";
import { storage } from "../../storage";
import { emailService, type EmailResult } from "../emailService";
import { logger } from "../../utils/logger";
import { ORG_IDENTITY_BLOCK_REASON, isOrgIdentityRefusal } from "./orgIdentityBlock";

/**
 * Machine-readable reason stamped into `delivery_error` alongside the
 * blocked status. Kept in the same style as the other codes this module
 * writes (`no_borrower_email_on_file`, `note_not_found_or_cross_org`) so
 * the admin view can switch on it.
 */


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
  /**
   * True when the send was refused because the ORG has no connected email
   * identity. The row carries `blocked_no_org_identity` and will never be
   * retried automatically.
   */
  blockedNoOrgIdentity?: boolean;
  /**
   * True when the notifier returned WITHOUT attempting a send because the
   * row already carried a terminal status. Distinguishes "we chose not to
   * retry" from "we tried and it did not work".
   */
  skippedTerminalStatus?: boolean;
}

/**
 * How many statements / borrowers in this org are currently blocked on the
 * missing identity. Derived from real `periodic_statements` rows — never
 * estimated.
 *
 * EITHER field is null when that number could not be derived, and null is
 * rendered as "an undetermined number" in the alert. Null, never 0: a zero
 * here would be a fabricated number flatly contradicting the blocked row
 * that triggered the alert.
 */
interface OrgIdentityBlockScope {
  statementsBlocked: number | null;
  borrowersAffected: number | null;
}

/**
 * Count the org's currently-blocked statements and the distinct borrowers
 * behind them.
 *
 * Both numbers come from rows, not from arithmetic on a guess:
 *   - statementsBlocked = COUNT of periodic_statements rows for this org
 *     whose delivery_status is already `blocked_no_org_identity` (the
 *     caller writes the current row FIRST, so it is included).
 *   - borrowersAffected = the number of DISTINCT non-null
 *     notes.borrower_id behind those rows. Distinct because one borrower
 *     can hold several notes, and the founder wants people, not rows.
 *
 * Only `loanType === "note"` rows can ever reach the blocked state — the
 * acquired-note path never gets past the notes lookup in this module — but
 * the filter is written explicitly rather than assumed.
 */
async function scopeOrgIdentityBlock(
  organizationId: number,
): Promise<OrgIdentityBlockScope> {
  const blockedRows = await db
    .select({
      loanId: periodicStatements.loanId,
      loanType: periodicStatements.loanType,
    })
    .from(periodicStatements)
    .where(
      and(
        eq(periodicStatements.organizationId, organizationId),
        eq(
          periodicStatements.deliveryStatus,
          DELIVERY_STATUS_BLOCKED_NO_ORG_IDENTITY,
        ),
      ),
    );

  const statementsBlocked = blockedRows.length;

  const noteIds = Array.from(
    new Set(
      blockedRows
        .filter((r) => r.loanType === "note")
        .map((r) => Number(r.loanId))
        .filter((n) => Number.isInteger(n)),
    ),
  );

  // No resolvable note ids → we know the statement count but NOT the
  // borrower count. Report null; the alert renders "borrower count
  // unavailable" instead of a made-up figure.
  if (noteIds.length === 0) {
    return { statementsBlocked, borrowersAffected: null };
  }

  const noteRows = await db
    .select({ borrowerId: notes.borrowerId })
    .from(notes)
    .where(
      and(eq(notes.organizationId, organizationId), inArray(notes.id, noteIds)),
    );

  const borrowerIds = new Set(
    noteRows
      .map((r) => r.borrowerId)
      .filter((b): b is number => typeof b === "number"),
  );

  return {
    statementsBlocked,
    borrowersAffected: borrowerIds.size > 0 ? borrowerIds.size : null,
  };
}

/**
 * Raise the founder/org alert for a §1026.41 statement that could not be
 * sent because the org has no connected email identity.
 *
 * Uses the repo's ONE alert policy layer (services/alertSpine.ts,
 * elevation blueprint Tier 1D) rather than a bespoke channel. Dynamic
 * import + try/catch matches the existing callers (ledgerDeadLetter.ts:245,
 * reconciliation.ts:101): the alert is best-effort and must never turn a
 * recorded block into a thrown error.
 *
 * severity "warning" → durable domain_audit_findings row (founder cockpit,
 * compliance domain / Beatrice) + a system_alerts row scoped to the org
 * (so the customer sees the "connect your email" banner too). Not
 * "critical": this does not page at 3am, because the statement is still
 * readable in the borrower portal and the remedy is a customer action on a
 * monthly cadence. It must be VISIBLE and ACTIONABLE, not a pager.
 *
 * dedupeKey is per-org, so each affected org gets its own finding and
 * re-fires refresh the counts (recordFinding upserts on
 * (detector, dedupe_key)) instead of duplicating.
 */
async function alertOrgIdentityBlock(input: {
  organizationId: number;
  orgName: string | null;
  statementId: string;
  scope: OrgIdentityBlockScope;
  refusalMessage: string | null;
}): Promise<void> {
  const { organizationId, orgName, statementId, scope, refusalMessage } = input;
  const orgLabel = orgName
    ? `${orgName} (org ${organizationId})`
    : `org ${organizationId}`;

  // Never render a number we did not derive. When a count is unavailable
  // the sentence says so, and the founder still gets the org.
  const borrowerPhrase =
    scope.borrowersAffected === null
      ? "an undetermined number of borrowers (borrower count unavailable)"
      : `${scope.borrowersAffected} borrower(s)`;
  const statementPhrase =
    scope.statementsBlocked === null
      ? "An undetermined number of"
      : `${scope.statementsBlocked}`;

  try {
    const { raiseAlert } = await import("../alertSpine");
    await raiseAlert({
      severity: "warning",
      source: "periodic_statement_delivery",
      title: `Reg Z statements blocked — ${orgLabel} has no connected email identity`,
      detail:
        `${statementPhrase} §1026.41 periodic statement(s) covering ${borrowerPhrase} ` +
        `cannot be emailed for ${orgLabel}: the org has neither BYO SES credentials nor a ` +
        `verified sending domain, and lender correspondence to a borrower may not go out over ` +
        `AcreOS's platform identity (founder decision 2026-07-17). The statements ARE generated ` +
        `and readable in the borrower portal — only the email channel is blocked. ` +
        `Remedy: the org connects email (Settings → Connections), then an operator re-runs ` +
        `generateStatementsForCycle with { regenerate: true }, which resets these rows to pending. ` +
        `Blocked rows: periodic_statements where delivery_status = '${DELIVERY_STATUS_BLOCKED_NO_ORG_IDENTITY}' ` +
        `and organization_id = ${organizationId}.`,
      dedupeKey: `org:${organizationId}`,
      domain: "compliance",
      citedReason:
        "12 C.F.R. §1026.41(b) requires a periodic statement per billing cycle; the founder's 2026-07-17 BYO ruling forbids delivering it over the platform sender. Both hold, so the undeliverable obligation must stay visible.",
      alertType: "periodic_statement_blocked_no_org_identity",
      organizationId,
      subjectRef: `organization:${organizationId}`,
      metadata: {
        organizationId,
        orgName,
        statementId,
        statementsBlocked: scope.statementsBlocked,
        borrowersAffected: scope.borrowersAffected,
        refusalMessage,
      },
    });
  } catch (alertErr) {
    logger.error(
      "[periodicStatements/delivery] alert spine raise failed for org-identity block",
      alertErr instanceof Error ? alertErr : undefined,
      { metadata: { organizationId, statementId } },
    );
  }
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

  // ── THE RETRY GATE ───────────────────────────────────────────────────
  // This is the status-sensitive half of the non-retry guarantee (see the
  // module header). Membership in PERIODIC_STATEMENT_TERMINAL_DELIVERY_
  // STATUSES is the whole policy: a terminal row returns here, before any
  // recipient resolution and before emailService.sendEmail is called, so no
  // send can occur. Everything NOT in that set falls through and is retried.
  if (
    PERIODIC_STATEMENT_TERMINAL_DELIVERY_STATUSES.includes(
      statement.deliveryStatus as (typeof PERIODIC_STATEMENT_TERMINAL_DELIVERY_STATUSES)[number],
    )
  ) {
    // Already delivered → the original idempotency guarantee: re-running
    // generation for a delivered statement does NOT re-send the email.
    if (statement.deliveryStatus === "sent" || statement.deliveryStatus === "delivered") {
      return {
        attempted: false,
        delivered: true,
        skippedAlreadyDelivered: true,
        skippedTerminalStatus: true,
      };
    }
    // Blocked on the org's missing sending identity. Retrying cannot fix
    // it — only the org connecting email can — so we return without
    // touching SES. The alert raised when the block was first recorded is
    // the actionable surface; it is not re-raised here, because nothing
    // new happened.
    logger.info(
      "[periodicStatements/delivery] skipped — terminal blocked_no_org_identity, not retried",
      {
        metadata: {
          statementId,
          organizationId: statement.organizationId,
          deliveryStatus: statement.deliveryStatus,
        },
      },
    );
    return {
      attempted: false,
      delivered: false,
      blockedNoOrgIdentity: true,
      skippedTerminalStatus: true,
      error: statement.deliveryError ?? ORG_IDENTITY_BLOCK_REASON,
    };
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
    // BYO lane (founder decision 2026-07-17). The recipient here is the
    // CUSTOMER ORG'S BORROWER, resolved above via
    // storage.getLead(note.organizationId, note.borrowerId), and the body
    // is branded "Sent by ${orgName}". That is counterparty mail by every
    // definition in the ruling — regulated lender correspondence, on the
    // lender's behalf, to the lender's borrower. It must ride the org's
    // own identity or not go at all; it may NOT be re-fronted onto
    // AcreOS's @acreos.io platform sender. Omitting this field would
    // default to 'system' (emailService.ts: `options.purpose ?? 'system'`)
    // and silently reinstate exactly that re-front.
    purpose: "counterparty",
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
        // "sent", NOT "delivered". `result.success` is SES accepting a
        // SendRawEmailCommand — the carrier taking custody. Nothing in AcreOS
        // consumes a bounce or delivery notification, so writing "delivered"
        // here asserted an observation that never happened and could never be
        // corrected. On a §1026.41 statement that is a regulated record
        // claiming an event nobody saw; and because "delivered" is terminal, a
        // bounced statement was also never re-attempted.
        deliveryStatus: "sent",
        deliveredAt: now,
        deliveryMethod: "email",
        deliveryError: null,
      })
      .where(eq(periodicStatements.id, statementId));
    return { attempted: true, delivered: true };
  }

  // ── Refused, not failed ──────────────────────────────────────────────
  // emailService returned before ever constructing a SES command because
  // the org has no connected sending identity. This is NEITHER of the two
  // outcomes this module already knew how to record:
  //   - not `suppressed`: the borrower's address is fine, we have one.
  //   - not `failed`/`bounced`: nothing was attempted and nothing is
  //     transient. Retrying a hundred times cannot connect the org's
  //     mailbox, and parking a STATUTORY statement in a retry loop is how
  //     an unmet §1026.41 obligation becomes invisible.
  // So it gets its own terminal state plus an alert that names the org and
  // counts the borrowers behind it.
  if (isOrgIdentityRefusal(result)) {
    await db
      .update(periodicStatements)
      .set({
        deliveryStatus: DELIVERY_STATUS_BLOCKED_NO_ORG_IDENTITY,
        deliveryError: ORG_IDENTITY_BLOCK_REASON,
        // deliveryMethod deliberately left untouched: no channel was
        // used. (The `failed` branch below stamps "email" because SES was
        // actually engaged.)
      })
      .where(eq(periodicStatements.id, statementId));

    // Counts are derived AFTER the write so this statement is included.
    // A counting failure must not swallow the alert — we degrade to
    // "org named, count unavailable" rather than fabricating a number.
    // Both null, NOT zero: if the derivation throws we do not know the
    // counts, and "0 statements blocked" would be a fabricated number
    // contradicting the very row we just wrote.
    let scope: OrgIdentityBlockScope = {
      statementsBlocked: null,
      borrowersAffected: null,
    };
    try {
      scope = await scopeOrgIdentityBlock(statement.organizationId);
    } catch (countErr) {
      logger.error(
        "[periodicStatements/delivery] could not derive blocked-statement scope; alerting without counts",
        countErr instanceof Error ? countErr : undefined,
        { metadata: { organizationId: statement.organizationId, statementId } },
      );
    }

    await alertOrgIdentityBlock({
      organizationId: statement.organizationId,
      orgName: org?.name ?? null,
      statementId,
      scope,
      refusalMessage: result.error ?? null,
    });

    logger.warn(
      "[periodicStatements/delivery] blocked — org has no connected email identity",
      {
        metadata: {
          statementId,
          organizationId: statement.organizationId,
          statementsBlocked: scope.statementsBlocked,
          borrowersAffected: scope.borrowersAffected,
          reason: ORG_IDENTITY_BLOCK_REASON,
        },
      },
    );

    return {
      attempted: true,
      delivered: false,
      blockedNoOrgIdentity: true,
      errorType: result.errorType,
      error: result.error ?? ORG_IDENTITY_BLOCK_REASON,
    };
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
