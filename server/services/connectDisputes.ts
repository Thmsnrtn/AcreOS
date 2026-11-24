/**
 * Borrower chargebacks on a lender's OWN connected account — autopilot
 * brief B-2 (founder-autopilot drills, 2026-11-16, ranked High).
 *
 * ── THE DEFECT ─────────────────────────────────────────────────────────────
 * A borrower's card payment is a DIRECT charge on the lender's connected
 * Stripe account, so when the borrower disputes it, the dispute events
 * arrive at the CONNECT endpoint — which subscribed to no dispute events
 * and had no handler. Stripe clawed the money back on its side while the
 * AcreOS ledger row stood serene: the platform's servicing record silently
 * diverged from Stripe reality, and the lender — whose book this is — was
 * never told. (The PLATFORM dispatcher's `processChargeDispute` in
 * webhookHandlers.ts handles disputes on AcreOS's OWN charges; it never
 * sees these, and it is alert-only with no deadline — brief B-9's concern,
 * not this one's.)
 *
 * ── WHAT THIS DOES ─────────────────────────────────────────────────────────
 * For `charge.dispute.created / updated / closed` on the Connect endpoint:
 *   (a) FLAG — the dispute is resolved to the ledger row it concerns (the
 *       refund handler's exact path: payment intent → Checkout sessions on
 *       the lender's account → the borrower session → the `payments` row
 *       that session posted) and the row's dispute_* columns record
 *       "dispute opened — under review", Stripe's status/reason/amount and
 *       the hard response deadline (`evidence_details.due_by`).
 *   (b) RAISE — a founder `systemAlert` (org-scoped) plus a lender-visible
 *       notice through the witnessed rails (push + in-app, preference-
 *       gated on `finance.borrower_dispute`, mirroring the borrower-
 *       message wire) on open and on close.
 *   (c) DEADLINE — `runConnectDisputeEscalationSweep` (hourly job) fires
 *       T-72h (warning) and T-24h (critical, overdue included) escalations
 *       through the same rails, stamped on the row so each tier fires once.
 *
 * ── WHAT THIS NEVER DOES ───────────────────────────────────────────────────
 * NO AUTOMATIC LEDGER REVERSAL. The dispute path writes dispute_* columns
 * ONLY — never amount, balance, payment status, or a reversal row. Whether
 * a closed-lost dispute reverses on the books stays a founder/lender
 * judgment (drills record B-2; the meta-review draft's auto-reversal
 * wording is superseded by it). The unit suite pins this: every update
 * payload the handler emits is asserted to carry dispute_* keys only.
 *
 * ── REFUSALS, NEVER GUESSES ────────────────────────────────────────────────
 * A dispute on a charge that is not a borrower payment (lenders dispute
 * their own unrelated charges on this account too) is logged and left
 * alone. A borrower payment whose ledger row cannot be found raises a
 * founder alert rather than passing silently — that is the divergence
 * this brief exists to make impossible. An org mismatch between the
 * session and the ledger row refuses the write, as the refund path does.
 *
 * Dependencies are injectable (the outbox-reaper DI pattern) so the whole
 * behaviour is unit-provable without a database or a Stripe account; the
 * defaults are the production seams.
 */

import type Stripe from "stripe";
import { logger } from "../utils/logger";
import { clock } from "../utils/clock";

const BORROWER_DISPUTE_EVENT_ID = "finance.borrower_dispute";

/**
 * The dispute_* columns a flag write may carry — and nothing else. Every
 * field is optional so a write carries exactly the columns it means to
 * change (the escalation sweep stamps its tier without touching the
 * status/reason the webhook recorded).
 */
export interface DisputeFlagPatch {
  disputeId?: string;
  disputeStatus?: string | null;
  disputeReason?: string | null;
  disputeAmountCents?: number | null;
  disputeDueBy?: Date | null;
  disputeOpenedAt?: Date;
  disputeClosedAt?: Date;
  disputeEscalation72hAt?: Date;
  disputeEscalation24hAt?: Date;
}

export interface DisputedPaymentRow {
  id: number;
  organizationId: number;
  noteId: number;
}

export interface OpenDisputeRow extends DisputedPaymentRow {
  disputeId: string;
  disputeAmountCents: number | null;
  disputeDueBy: Date;
  disputeEscalation72hAt: Date | null;
  disputeEscalation24hAt: Date | null;
}

export type DisputeNoticeKind = "opened" | "closed_won" | "closed_lost" | "closed_other" | "deadline_72h" | "deadline_24h";

export interface BorrowerDisputeNotice {
  orgId: number;
  noteId: number;
  disputeId: string;
  kind: DisputeNoticeKind;
  amountCents: number | null;
  dueBy: Date | null;
}

export interface ConnectDisputeDeps {
  /** The borrower Checkout session behind a payment intent, read on the lender's account; null when the charge is not a borrower payment. */
  findBorrowerSession: (
    paymentIntentId: string,
    connectedAccountId: string,
  ) => Promise<{ id: string; organizationId: number | null } | null>;
  findPaymentBySessionId: (sessionId: string, organizationId: number) => Promise<DisputedPaymentRow | null>;
  findOrgIdByConnectedAccount: (connectedAccountId: string) => Promise<number | null>;
  updatePaymentDispute: (paymentId: number, organizationId: number, patch: DisputeFlagPatch) => Promise<void>;
  createSystemAlert: (alert: {
    organizationId: number | null;
    type: string;
    severity: "critical" | "warning" | "info";
    title: string;
    message: string;
    relatedEntityType: string;
    relatedEntityId: number | null;
    metadata: Record<string, unknown>;
  }) => Promise<void>;
  notifyLender: (notice: BorrowerDisputeNotice) => Promise<void>;
  listOpenDisputes: () => Promise<OpenDisputeRow[]>;
  now: () => Date;
}

// ─── Production seams ───────────────────────────────────────────────────────

async function defaultFindBorrowerSession(
  paymentIntentId: string,
  connectedAccountId: string,
): Promise<{ id: string; organizationId: number | null } | null> {
  const { getUncachableStripeClient } = await import("../stripeClient");
  const { customerMoneyReadOptions } = await import("./customerMoneyRouting");
  const stripe = await getUncachableStripeClient();
  // Scoped to the lender's account — the charge lives there, not in AcreOS's.
  const sessions = await stripe.checkout.sessions.list(
    { payment_intent: paymentIntentId, limit: 10 },
    customerMoneyReadOptions({ accountId: connectedAccountId }, "borrower.card.dispute.session.lookup"),
  );
  // Portal sessions carry `type`; lender-shared Payment Link sessions carry
  // `paymentType` (DEFECT-0116). Both are posted by the one rule keyed on
  // the session id, so both are disputable here.
  const session = sessions.data.find(
    (s) => s.metadata?.type === "borrower_portal_payment" || s.metadata?.paymentType === "note_payment",
  );
  if (!session) return null;
  const orgId = Number(session.metadata?.organizationId ?? NaN);
  return { id: session.id, organizationId: Number.isFinite(orgId) ? orgId : null };
}

async function defaultFindPaymentBySessionId(sessionId: string, organizationId: number): Promise<DisputedPaymentRow | null> {
  const { db } = await import("../db");
  const { payments } = await import("@shared/schema");
  const { and, eq } = await import("drizzle-orm");
  // Org-scoped: the session id is only ever read inside the org the
  // connected account (or the session itself) proved — never platform-wide.
  const [row] = await db
    .select({ id: payments.id, organizationId: payments.organizationId, noteId: payments.noteId })
    .from(payments)
    .where(and(eq(payments.transactionId, sessionId), eq(payments.organizationId, organizationId)))
    .limit(1);
  return row ?? null;
}

async function defaultFindOrgIdByConnectedAccount(connectedAccountId: string): Promise<number | null> {
  const { storage } = await import("../storage");
  const integration = await storage.findOrganizationIntegrationByCredential(
    "stripe_connect",
    "stripeConnectAccountId",
    connectedAccountId,
  );
  return integration?.organizationId ?? null;
}

async function defaultUpdatePaymentDispute(paymentId: number, organizationId: number, patch: DisputeFlagPatch): Promise<void> {
  const { hasWritableValues } = await import("../utils/patch");
  // A patch whose values are all undefined would render an empty SET —
  // drizzle drops undefined values and Postgres rejects the statement.
  if (!hasWritableValues(patch)) return;
  const { db } = await import("../db");
  const { payments } = await import("@shared/schema");
  const { and, eq } = await import("drizzle-orm");
  await db
    .update(payments)
    .set(patch)
    .where(and(eq(payments.id, paymentId), eq(payments.organizationId, organizationId)));
}

async function defaultCreateSystemAlert(alert: Parameters<ConnectDisputeDeps["createSystemAlert"]>[0]): Promise<void> {
  const { storage } = await import("../storage");
  await storage.createSystemAlert({
    organizationId: alert.organizationId as number,
    type: alert.type,
    severity: alert.severity,
    title: alert.title,
    message: alert.message,
    relatedEntityType: alert.relatedEntityType,
    relatedEntityId: alert.relatedEntityId ?? undefined,
    metadata: alert.metadata,
  });
}

async function defaultListOpenDisputes(): Promise<OpenDisputeRow[]> {
  const { unscopedForPlatformOps } = await import("../utils/orgScopedDb");
  // The deadline sweep is a platform job by design: it scans every org's
  // open disputes so each lender's deadline is watched — the sanctioned
  // cross-org hatch, with the reason logged on every run.
  const db = unscopedForPlatformOps(
    "Connect dispute escalation sweep: scan all organizations' open borrower disputes for response deadlines",
  );
  const { payments } = await import("@shared/schema");
  const { and, isNotNull, isNull } = await import("drizzle-orm");
  const rows = await db
    .select({
      id: payments.id,
      organizationId: payments.organizationId,
      noteId: payments.noteId,
      disputeId: payments.disputeId,
      disputeAmountCents: payments.disputeAmountCents,
      disputeDueBy: payments.disputeDueBy,
      disputeEscalation72hAt: payments.disputeEscalation72hAt,
      disputeEscalation24hAt: payments.disputeEscalation24hAt,
    })
    .from(payments)
    .where(and(isNotNull(payments.disputeId), isNull(payments.disputeClosedAt), isNotNull(payments.disputeDueBy)));
  return rows
    .filter((r): r is OpenDisputeRow => r.disputeId != null && r.disputeDueBy != null)
    .map((r) => ({ ...r, disputeDueBy: new Date(r.disputeDueBy as Date) }));
}

const defaultConnectDisputeDeps: ConnectDisputeDeps = {
  findBorrowerSession: defaultFindBorrowerSession,
  findPaymentBySessionId: defaultFindPaymentBySessionId,
  findOrgIdByConnectedAccount: defaultFindOrgIdByConnectedAccount,
  updatePaymentDispute: defaultUpdatePaymentDispute,
  createSystemAlert: defaultCreateSystemAlert,
  notifyLender: async (notice) => {
    await notifyLenderOfBorrowerDispute(notice);
  },
  listOpenDisputes: defaultListOpenDisputes,
  now: () => clock.now(),
};

// ─── Lender notice (witnessed rails, mirroring borrowerMessageNotify) ──────

const NOTICE_COPY: Record<DisputeNoticeKind, { title: string; body: string }> = {
  opened: {
    title: "A borrower disputed a payment",
    body: "A chargeback was opened on one of your note payments. The payment is flagged under review in your book — respond in Stripe by the deadline shown.",
  },
  closed_won: {
    title: "A disputed payment was resolved in your favour",
    body: "Stripe closed the chargeback on one of your note payments as won. The dispute flag on the payment is cleared.",
  },
  closed_lost: {
    title: "A disputed payment was lost",
    body: "Stripe closed the chargeback on one of your note payments as lost and took the money back on your Stripe account. Your AcreOS book still shows the payment — review it with your records; nothing was reversed automatically.",
  },
  closed_other: {
    title: "A disputed payment was closed",
    body: "Stripe closed the chargeback on one of your note payments. The dispute flag on the payment shows the final status.",
  },
  deadline_72h: {
    title: "Chargeback deadline in under 72 hours",
    body: "A borrower chargeback on one of your note payments must be answered in Stripe within 72 hours or it is lost automatically.",
  },
  deadline_24h: {
    title: "Chargeback deadline in under 24 hours",
    body: "A borrower chargeback on one of your note payments must be answered in Stripe within 24 hours or it is lost automatically.",
  },
};

/**
 * Tell the lender, through the witnessed rails: push (family
 * `borrower_dispute`, preference-gated) + one in-app row per active team
 * member whose preferences allow it. BEST EFFORT — every leg is guarded;
 * a notification failure never fails the webhook that carries the flag.
 * No borrower PII: the payload names the note and the amount, never the
 * borrower.
 */
async function notifyLenderOfBorrowerDispute(notice: BorrowerDisputeNotice): Promise<{ pushed: boolean; inApp: number }> {
  const result = { pushed: false, inApp: 0 };
  if (!Number.isInteger(notice.orgId) || notice.orgId <= 0) return result;
  if (!Number.isInteger(notice.noteId) || notice.noteId <= 0) return result;
  const copy = NOTICE_COPY[notice.kind];
  const amount = notice.amountCents != null ? ` ($${(notice.amountCents / 100).toFixed(2)})` : "";

  try {
    const { pushOrgEvent } = await import("./orgPushFanout");
    result.pushed = await pushOrgEvent(notice.orgId, {
      family: "borrower_dispute",
      title: copy.title,
      body: copy.body,
      url: "/finance",
      tag: `borrower-dispute-${notice.disputeId}`,
    });
  } catch (err) {
    logger.warn("[ConnectDispute] lender push leg failed (flag unaffected)", {
      metadata: { orgId: notice.orgId, noteId: notice.noteId, disputeId: notice.disputeId, error: err instanceof Error ? err.message : String(err) },
    });
  }

  try {
    const { storage } = await import("../storage");
    const { notificationPrefsService } = await import("./notificationPreferences");
    const members = await storage.getTeamMembers(notice.orgId);
    for (const member of members) {
      if (!member.isActive || !member.userId) continue;
      try {
        const allowed = await notificationPrefsService.shouldNotify(member.userId, notice.orgId, BORROWER_DISPUTE_EVENT_ID, "inApp");
        if (!allowed) continue;
        await storage.createNotification({
          organizationId: notice.orgId,
          userId: member.userId,
          type: BORROWER_DISPUTE_EVENT_ID,
          title: copy.title,
          message: `${copy.body} Note #${notice.noteId}${amount}.`,
          entityType: "note",
          entityId: notice.noteId,
          metadata: {
            source: "borrower_dispute",
            noteId: notice.noteId,
            disputeId: notice.disputeId,
            kind: notice.kind,
            dueBy: notice.dueBy ? notice.dueBy.toISOString() : null,
            actionUrl: "/finance",
          },
        });
        result.inApp++;
      } catch (err) {
        logger.error("[ConnectDispute] in-app row failed for a member (flag unaffected)", err instanceof Error ? err : undefined);
      }
    }
  } catch (err) {
    logger.error("[ConnectDispute] in-app leg failed (flag unaffected)", err instanceof Error ? err : undefined);
  }

  return result;
}

// ─── The webhook handler ────────────────────────────────────────────────────

export type BorrowerDisputeEventType = "charge.dispute.created" | "charge.dispute.updated" | "charge.dispute.closed";

export interface BorrowerDisputeOutcome {
  matched: boolean;
  reason?: "not_borrower_payment" | "no_ledger_row" | "org_mismatch" | "unresolvable";
  paymentId?: number;
  noteId?: number;
  organizationId?: number;
}

function disputeDueBy(dispute: Stripe.Dispute): Date | null {
  const dueBySeconds = dispute.evidence_details?.due_by ?? null;
  return dueBySeconds != null ? new Date(dueBySeconds * 1000) : null;
}

function closeKind(dispute: Stripe.Dispute): DisputeNoticeKind {
  if (dispute.status === "won") return "closed_won";
  if (dispute.status === "lost") return "closed_lost";
  return "closed_other";
}

function dollars(cents: number | null | undefined): string {
  return cents != null ? `$${(cents / 100).toFixed(2)}` : "an unknown amount";
}

/**
 * Handle one Connect dispute event. Stripe API failures THROW (the Connect
 * route releases its idempotency claim and returns 500, so Stripe
 * redelivers); identification failures are logged/alerted and return —
 * redelivery cannot cure them.
 */
export async function processBorrowerChargeDispute(
  eventType: BorrowerDisputeEventType,
  dispute: Stripe.Dispute,
  connectedAccountId: string | null,
  deps: ConnectDisputeDeps = defaultConnectDisputeDeps,
): Promise<BorrowerDisputeOutcome> {
  const chargeId = typeof dispute.charge === "string" ? dispute.charge : dispute.charge?.id ?? null;
  const paymentIntentId =
    typeof dispute.payment_intent === "string" ? dispute.payment_intent : dispute.payment_intent?.id ?? null;

  if (!connectedAccountId || !paymentIntentId) {
    logger.error(
      "[ConnectDispute] Dispute cannot be matched to a borrower payment — a lender's book may now diverge from Stripe",
      new Error(`dispute=${dispute.id} charge=${chargeId ?? "unknown"} missing=${!connectedAccountId ? "connectedAccount" : "paymentIntent"}`),
    );
    return { matched: false, reason: "unresolvable" };
  }

  const session = await deps.findBorrowerSession(paymentIntentId, connectedAccountId);
  if (!session) {
    // Lenders dispute their OWN unrelated charges on this account too.
    // Not a borrower payment — nothing of AcreOS's to flag.
    logger.info(`[ConnectDispute] Dispute ${dispute.id} is not a borrower portal payment — no note ledger to flag`);
    return { matched: false, reason: "not_borrower_payment" };
  }

  // The org is proved BEFORE the ledger is touched: the connected
  // account's own integration mapping is authoritative, the session's
  // metadata is the fallback. The ledger read itself is org-scoped.
  const orgId = (await deps.findOrgIdByConnectedAccount(connectedAccountId)) ?? session.organizationId;
  const payment = orgId != null ? await deps.findPaymentBySessionId(session.id, orgId) : null;
  if (!payment) {
    // A borrower paid through AcreOS and disputed, but the ledger row the
    // session posted cannot be found. That is exactly the silent
    // divergence this brief forbids — page the founder, loudly.
    logger.error(
      "[ConnectDispute] Dispute on a borrower payment AcreOS cannot find on the ledger — the book may diverge from Stripe",
      new Error(`dispute=${dispute.id} checkoutSession=${session.id} charge=${chargeId ?? "unknown"}`),
    );
    await deps.createSystemAlert({
      organizationId: orgId,
      type: "borrower_charge_dispute",
      severity: "critical",
      title: `Borrower dispute on an unrecorded payment: ${dollars(dispute.amount)}`,
      message:
        `Dispute ${dispute.id} was opened on a borrower payment (Checkout session ${session.id}) that has no matching row on the AcreOS ledger, ` +
        `so there is no payment to flag. Stripe's response deadline is ${disputeDueBy(dispute)?.toISOString() ?? "not shown"}. Reconcile the lender's Stripe account against the book.`,
      relatedEntityType: "note",
      relatedEntityId: null,
      metadata: { disputeId: dispute.id, chargeId, checkoutSessionId: session.id, amountCents: dispute.amount ?? null, eventType, unmatched: true },
    });
    return { matched: false, reason: "no_ledger_row", organizationId: orgId ?? undefined };
  }

  if (session.organizationId != null && session.organizationId !== payment.organizationId) {
    logger.error(
      "[ConnectDispute] Dispute org mismatch between the checkout session and the ledger row — refusing to write",
      new Error(`dispute=${dispute.id} checkoutSession=${session.id} sessionOrg=${session.organizationId} ledgerOrg=${payment.organizationId}`),
    );
    return { matched: false, reason: "org_mismatch", paymentId: payment.id, noteId: payment.noteId, organizationId: payment.organizationId };
  }

  const dueBy = disputeDueBy(dispute);
  const patch: DisputeFlagPatch = {
    disputeId: dispute.id,
    disputeStatus: dispute.status ?? null,
    disputeReason: dispute.reason ?? null,
    disputeAmountCents: dispute.amount ?? null,
    disputeDueBy: dueBy,
  };
  if (eventType === "charge.dispute.created") {
    patch.disputeOpenedAt = dispute.created ? new Date(dispute.created * 1000) : deps.now();
  }
  if (eventType === "charge.dispute.closed") {
    patch.disputeClosedAt = deps.now();
  }
  await deps.updatePaymentDispute(payment.id, payment.organizationId, patch);

  const base = { paymentId: payment.id, noteId: payment.noteId, organizationId: payment.organizationId };

  if (eventType === "charge.dispute.created") {
    await deps.createSystemAlert({
      organizationId: payment.organizationId,
      type: "borrower_charge_dispute",
      severity: "critical",
      title: `Borrower dispute opened: ${dollars(dispute.amount)} on Note #${payment.noteId}`,
      message:
        `A borrower disputed a payment of ${dollars(dispute.amount)} on Note #${payment.noteId} (dispute ${dispute.id}, reason: ${dispute.reason ?? "not stated"}). ` +
        `The payment is flagged "dispute opened — under review" on the lender's ledger; the lender has been notified. ` +
        `Stripe's response deadline (response.by) is ${dueBy ? dueBy.toISOString() : "not shown by Stripe"}. No ledger reversal was posted — reversal stays a founder/lender judgment.`,
      relatedEntityType: "note",
      relatedEntityId: payment.noteId,
      metadata: { disputeId: dispute.id, chargeId, paymentId: payment.id, amountCents: dispute.amount ?? null, reason: dispute.reason ?? null, status: dispute.status ?? null, dueBy: dueBy?.toISOString() ?? null, eventType },
    });
    await deps.notifyLender({ orgId: payment.organizationId, noteId: payment.noteId, disputeId: dispute.id, kind: "opened", amountCents: dispute.amount ?? null, dueBy });
  } else if (eventType === "charge.dispute.closed") {
    const kind = closeKind(dispute);
    await deps.createSystemAlert({
      organizationId: payment.organizationId,
      type: "borrower_charge_dispute",
      severity: kind === "closed_lost" ? "warning" : "info",
      title:
        kind === "closed_lost"
          ? `Borrower dispute LOST: ${dollars(dispute.amount)} on Note #${payment.noteId}`
          : kind === "closed_won"
            ? `Borrower dispute won: ${dollars(dispute.amount)} on Note #${payment.noteId}`
            : `Borrower dispute closed: ${dollars(dispute.amount)} on Note #${payment.noteId}`,
      message:
        `Dispute ${dispute.id} on Note #${payment.noteId} closed with status "${dispute.status ?? "unknown"}". The lender has been notified. ` +
        (kind === "closed_lost"
          ? "Stripe has taken the money back on the lender's own account. The AcreOS ledger still shows the payment as posted — NO reversal was posted automatically; reversing it is a founder/lender judgment."
          : "The dispute flag on the payment now shows the final status."),
      relatedEntityType: "note",
      relatedEntityId: payment.noteId,
      metadata: { disputeId: dispute.id, chargeId, paymentId: payment.id, amountCents: dispute.amount ?? null, status: dispute.status ?? null, eventType },
    });
    await deps.notifyLender({ orgId: payment.organizationId, noteId: payment.noteId, disputeId: dispute.id, kind, amountCents: dispute.amount ?? null, dueBy });
  } else {
    logger.info(`[ConnectDispute] Dispute ${dispute.id} updated on Note #${payment.noteId} — flag synced (status ${dispute.status ?? "unknown"}, due_by ${dueBy?.toISOString() ?? "none"})`);
  }

  return { matched: true, ...base };
}

// ─── The deadline escalation sweep ──────────────────────────────────────────

const HOUR_MS = 60 * 60 * 1000;

export interface DisputeEscalationSweepResult {
  scanned: number;
  escalated72h: number;
  escalated24h: number;
}

/**
 * Fire the T-72h / T-24h deadline escalations for every open dispute.
 * Each tier fires once per dispute: the stamp is written only after the
 * alert + notice go out, so a failed tier retries on the next run and a
 * fired tier never repeats. A dispute first seen inside the 24h window
 * (or already overdue) fires the 24h tier and has its 72h stamp set
 * silently — the earlier warning can no longer be sent honestly late.
 */
export async function runConnectDisputeEscalationSweep(
  deps: ConnectDisputeDeps = defaultConnectDisputeDeps,
): Promise<DisputeEscalationSweepResult> {
  const now = deps.now();
  const rows = await deps.listOpenDisputes();
  const result: DisputeEscalationSweepResult = { scanned: rows.length, escalated72h: 0, escalated24h: 0 };

  for (const row of rows) {
    try {
      const msLeft = row.disputeDueBy.getTime() - now.getTime();
      if (msLeft <= 24 * HOUR_MS && !row.disputeEscalation24hAt) {
        await deps.createSystemAlert({
          organizationId: row.organizationId,
          type: "borrower_charge_dispute",
          severity: "critical",
          title: `Borrower dispute deadline in under 24 hours: Note #${row.noteId}`,
          message:
            `Dispute ${row.disputeId} on Note #${row.noteId} (${dollars(row.disputeAmountCents)}) must be answered in Stripe by ${row.disputeDueBy.toISOString()} or it is lost automatically. ` +
            `The lender has been re-notified. No ledger action is taken by this escalation.`,
          relatedEntityType: "note",
          relatedEntityId: row.noteId,
          metadata: { disputeId: row.disputeId, paymentId: row.id, amountCents: row.disputeAmountCents, dueBy: row.disputeDueBy.toISOString(), escalation: "24h" },
        });
        await deps.notifyLender({ orgId: row.organizationId, noteId: row.noteId, disputeId: row.disputeId, kind: "deadline_24h", amountCents: row.disputeAmountCents, dueBy: row.disputeDueBy });
        await deps.updatePaymentDispute(row.id, row.organizationId, {
          disputeEscalation24hAt: now,
          ...(row.disputeEscalation72hAt ? {} : { disputeEscalation72hAt: now }),
        });
        result.escalated24h++;
      } else if (msLeft <= 72 * HOUR_MS && !row.disputeEscalation72hAt) {
        await deps.createSystemAlert({
          organizationId: row.organizationId,
          type: "borrower_charge_dispute",
          severity: "warning",
          title: `Borrower dispute deadline in under 72 hours: Note #${row.noteId}`,
          message:
            `Dispute ${row.disputeId} on Note #${row.noteId} (${dollars(row.disputeAmountCents)}) must be answered in Stripe by ${row.disputeDueBy.toISOString()} or it is lost automatically. ` +
            `The lender has been re-notified.`,
          relatedEntityType: "note",
          relatedEntityId: row.noteId,
          metadata: { disputeId: row.disputeId, paymentId: row.id, amountCents: row.disputeAmountCents, dueBy: row.disputeDueBy.toISOString(), escalation: "72h" },
        });
        await deps.notifyLender({ orgId: row.organizationId, noteId: row.noteId, disputeId: row.disputeId, kind: "deadline_72h", amountCents: row.disputeAmountCents, dueBy: row.disputeDueBy });
        await deps.updatePaymentDispute(row.id, row.organizationId, {
          disputeEscalation72hAt: now,
        });
        result.escalated72h++;
      }
    } catch (err) {
      logger.error(`[ConnectDispute] Escalation failed for dispute ${row.disputeId} (payment ${row.id}) — will retry next sweep`, err instanceof Error ? err : undefined);
    }
  }

  return result;
}
