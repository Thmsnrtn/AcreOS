/**
 * ACH mandate capture — obtaining and RETAINING the borrower's authorization.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY A MANDATE IS NOT OPTIONAL
 * ═══════════════════════════════════════════════════════════════════════════
 * NACHA Operating Rules §2.3 require the Originator of a consumer ACH debit
 * to obtain the Receiver's authorization, retain it (2 years past revocation),
 * and produce it on demand. An unauthorized-debit claim (R10) is decided on
 * whether that record exists and what it says. Before Wave C, AcreOS had
 * exactly one artifact of borrower consent: `notes.auto_pay_enabled = true`.
 * A boolean is not an authorization.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE TWO-PHASE FLOW, AND WHY IT IS TWO PHASES
 * ═══════════════════════════════════════════════════════════════════════════
 * Phase 1 — `startAchMandateSetup`. The portal shows the borrower our exact
 * authorization language (`buildAuthorizationText`) and they tick the box. We
 * persist a `pending` mandate FIRST, carrying the verbatim text, its version,
 * the agreed-at timestamp, their IP and user-agent, the verified session
 * email, and the dollar ceiling + schedule they authorized. THEN we redirect
 * to Stripe Checkout in `setup` mode to collect the bank account.
 *
 *   The order matters. Recording consent only after a successful redirect
 *   loses the record for every borrower who agreed and then abandoned — and
 *   makes "did they agree before or after we had their bank details" an
 *   unanswerable question. A `pending` row that never confirms is visible and
 *   harmless; it is never debitable.
 *
 * Phase 2 — `confirmAchMandateSetup`. On return we retrieve the Checkout
 * session, read the SetupIntent's payment method and Stripe's OWN mandate id,
 * and promote our row to `active`. Any previously active mandate on the note
 * is marked `superseded` in the same transaction, so a note can never have
 * two live authorizations.
 *
 * Stripe Checkout (rather than an in-page Stripe.js element) is deliberate:
 * the client has no `@stripe/stripe-js` dependency and the portal already
 * redirects to hosted Checkout for card payments. Checkout also displays and
 * retains Stripe's own NACHA authorization text, so the borrower's consent is
 * corroborated by the processor instead of resting on our word alone.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHOSE ACCOUNT THE MONEY LANDS IN
 * ═══════════════════════════════════════════════════════════════════════════
 * The lender's own Stripe Connect account, via the `stripeAccount` header. A
 * lender who has not completed Connect onboarding (or whose
 * `us_bank_account_ach_payments` capability is not active) gets an explicit
 * refusal with a reason the portal can render. The platform account is never
 * used to pull a borrower's bank funds.
 */

import { and, eq, ne } from "drizzle-orm";
import { db, withTransaction } from "../db";
import { storage } from "../storage";
import { achMandates, type AchMandate } from "@shared/schema/ach-autopay";
import { logger } from "../utils/logger";
import { isCategorySimulated } from "../utils/simulationMode";
import {
  ACH_RAIL,
  AUTHORIZATION_TEXT_VERSION,
  buildAuthorizationText,
  scheduledDebitAmountCents,
} from "./achAutopay";

/**
 * Headroom over the currently-scheduled payment that the authorization
 * covers. A mandate ceiling pinned exactly at today's payment would refuse a
 * legitimate debit the moment a tax-escrow recalculation moves the amount by
 * a cent — and a ceiling of "whatever we bill" is not a ceiling at all. 15%
 * (minimum $25) covers ordinary escrow/fee drift while still bounding the
 * authorization to something the borrower can read as a number.
 */
export const MANDATE_HEADROOM_BPS = 1_500;
export const MANDATE_HEADROOM_MIN_CENTS = 2_500;

export function mandateCeilingCents(scheduledCents: number): number {
  const headroom = Math.max(
    MANDATE_HEADROOM_MIN_CENTS,
    Math.round((scheduledCents * MANDATE_HEADROOM_BPS) / 10_000),
  );
  return scheduledCents + headroom;
}

export type AchSetupRefusal =
  | "simulated"
  | "connect_not_configured"
  | "connect_charges_disabled"
  | "ach_capability_inactive"
  | "no_scheduled_amount"
  | "authorization_not_accepted"
  // Server-issued authorization challenge (see
  // services/borrower/autopayAuthorizationChallenge.ts). `_used` is the
  // race-backstop twin of the route's pre-check: two simultaneous redemptions
  // of one challenge collide on the unique index and the loser lands here.
  // `_unavailable` means this deployment has no signing material, so no
  // challenge can be issued or verified — refuse rather than fall back to
  // trusting the client's word.
  | "authorization_challenge_used"
  | "authorization_challenge_unavailable"
  | "stripe_error";

export interface AchSetupNote {
  id: number;
  organizationId: number;
  borrowerId: number | null;
  accessToken: string | null;
  monthlyPayment: string;
  serviceFee: string | null;
  taxEscrowEnabled: boolean | null;
  monthlyTaxEscrow: string | null;
  nextPaymentDate: Date | null;
}

export interface StartAchMandateSetupInput {
  note: AchSetupNote;
  /** The verified borrower-session email. Who agreed, not just when. */
  sessionEmail: string;
  lenderName: string;
  ipAddress: string | null;
  userAgent: string | null;
  /** Absolute origin used to build the Checkout return URLs. */
  baseUrl: string;
  /** Must be literally true — the borrower ticked the authorization box. */
  authorizationAccepted: boolean;
  /** The text the client actually rendered, echoed back for cross-checking. */
  displayedAuthorizationText?: string;
  /**
   * The single-use id of the server-issued challenge the caller redeemed. It is
   * stored on the mandate under a UNIQUE index, so this value — not the
   * caller's word — is what makes the authorization provable and non-replayable
   * later. The route verifies and pre-checks it; passing it here is what
   * actually CONSUMES it.
   */
  authorizationChallengeId?: string;
}

export type StartAchMandateSetupResult =
  | { ok: true; mandateId: number; setupUrl: string; authorizationText: string; maxAmountCents: number }
  | { ok: false; reason: AchSetupRefusal; message: string };

export interface ConnectContext {
  accountId: string;
}

/**
 * Resolve the lender's connected account and assert it can actually take ACH.
 * Refuses rather than falling back to the platform account.
 */
export async function resolveLenderConnectAccount(
  organizationId: number,
): Promise<{ ok: true; account: ConnectContext } | { ok: false; reason: AchSetupRefusal; message: string }> {
  const integration = await storage.getOrganizationIntegration(organizationId, "stripe_connect");
  const accountId = integration?.credentials?.stripeConnectAccountId;
  if (!accountId) {
    return {
      ok: false,
      reason: "connect_not_configured",
      message:
        "Bank payments aren't set up by your lender yet. They need to finish connecting their payout account before autopay by bank transfer can be enabled.",
    };
  }
  try {
    const { stripeConnectService } = await import("./stripeConnect");
    const status = await stripeConnectService.getAccountStatus(accountId);
    if (!status.chargesEnabled) {
      return {
        ok: false,
        reason: "connect_charges_disabled",
        message:
          "Your lender's payout account isn't finished being verified yet, so bank payments can't be collected. Card payments still work.",
      };
    }
    if (status.capabilities?.usBankAccountAchPayments !== "active") {
      return {
        ok: false,
        reason: "ach_capability_inactive",
        message:
          "Your lender's account isn't approved for bank (ACH) payments yet. Card payments still work.",
      };
    }
    return { ok: true, account: { accountId } };
  } catch (err) {
    logger.error(
      "[achMandateSetup] Connect account status check failed",
      err instanceof Error ? err : undefined,
      { organizationId },
    );
    return {
      ok: false,
      reason: "stripe_error",
      message: "We couldn't check your lender's payment setup right now. Please try again shortly.",
    };
  }
}

/** Human description of the schedule the borrower is authorizing. */
export function scheduleDescriptionForNote(note: { nextPaymentDate: Date | null }): string {
  if (!note.nextPaymentDate) return "monthly, on each scheduled due date";
  const day = note.nextPaymentDate.getUTCDate();
  const suffix = day === 1 || day === 21 || day === 31 ? "st" : day === 2 || day === 22 ? "nd" : day === 3 || day === 23 ? "rd" : "th";
  return `monthly, on the ${day}${suffix} of each month (your scheduled due date)`;
}

export async function startAchMandateSetup(
  input: StartAchMandateSetupInput,
): Promise<StartAchMandateSetupResult> {
  const { note } = input;

  if (!input.authorizationAccepted) {
    return {
      ok: false,
      reason: "authorization_not_accepted",
      message: "We can't set up bank autopay until you agree to the authorization.",
    };
  }
  if (isCategorySimulated("stripe")) {
    return {
      ok: false,
      reason: "simulated",
      message:
        "Payment setup is disabled on this environment (simulation mode). No bank details were collected and no authorization was stored.",
    };
  }

  const scheduledCents = scheduledDebitAmountCents(note);
  if (scheduledCents <= 0) {
    return {
      ok: false,
      reason: "no_scheduled_amount",
      message: "This loan has no scheduled payment amount, so there's nothing to authorize yet.",
    };
  }

  const connect = await resolveLenderConnectAccount(note.organizationId);
  if (!connect.ok) return connect;

  const maxAmountCents = mandateCeilingCents(scheduledCents);
  const scheduleDescription = scheduleDescriptionForNote(note);
  const authorizationText = buildAuthorizationText({
    lenderName: input.lenderName,
    amountCents: maxAmountCents,
    scheduleDescription,
    noteReference: `Note #${note.id}`,
  });

  const agreedAt = new Date();

  try {
    const { getUncachableStripeClient } = await import("../stripeClient");
    const stripe = await getUncachableStripeClient();

    const portalPath = note.accessToken ? `/portal/${note.accessToken}` : "/portal";
    const checkout = await stripe.checkout.sessions.create(
      {
        mode: "setup",
        payment_method_types: ["us_bank_account"],
        customer_email: input.sessionEmail,
        success_url: `${input.baseUrl}${portalPath}?ach_setup=success&setup_ref={CHECKOUT_SESSION_ID}`,
        cancel_url: `${input.baseUrl}${portalPath}?ach_setup=cancelled`,
        metadata: {
          type: "borrower_ach_mandate",
          noteId: String(note.id),
          organizationId: String(note.organizationId),
        },
      },
      { stripeAccount: connect.account.accountId },
    );

    if (!checkout.id || !checkout.url) {
      return {
        ok: false,
        reason: "stripe_error",
        message: "We couldn't start bank verification right now. No authorization was stored — please try again.",
      };
    }

    // Persist the authorization BEFORE the borrower leaves. `setup_reference`
    // is unique, so a retried POST cannot mint two pending mandates for the
    // same Checkout session.
    const [mandate] = await db
      .insert(achMandates)
      .values({
        organizationId: note.organizationId,
        noteId: note.id,
        borrowerLeadId: note.borrowerId,
        rail: ACH_RAIL,
        processorAccountId: connect.account.accountId,
        setupReference: checkout.id,
        authorizationText,
        authorizationTextVersion: AUTHORIZATION_TEXT_VERSION,
        authorizationMethod: "web",
        agreedAt,
        agreedIpAddress: input.ipAddress,
        agreedUserAgent: input.userAgent,
        agreedByEmail: input.sessionEmail.toLowerCase(),
        authorizationChallengeId: input.authorizationChallengeId ?? null,
        debitType: "recurring",
        maxAmountCents,
        frequency: "monthly",
        scheduleDescription,
        status: "pending",
      })
      .onConflictDoNothing()
      .returning();

    if (!mandate) {
      // The unique setup_reference already existed — reuse it rather than
      // creating a second record of the same consent.
      const [existing] = await db
        .select()
        .from(achMandates)
        .where(eq(achMandates.setupReference, checkout.id));
      if (!existing) {
        // Not the setup_reference index, then. The other unique index on this
        // table is the authorization challenge — i.e. a concurrent request
        // redeemed the same server-issued challenge and won. Single use is
        // enforced by the index, so the loser creates NO mandate and says so
        // instead of reporting a generic processor fault.
        if (input.authorizationChallengeId) {
          const [byChallenge] = await db
            .select({ id: achMandates.id })
            .from(achMandates)
            .where(eq(achMandates.authorizationChallengeId, input.authorizationChallengeId));
          if (byChallenge) {
            logger.warn("[achMandateSetup] authorization challenge already consumed — no second mandate", {
              noteId: note.id,
              metadata: { existingMandateId: byChallenge.id },
            });
            return {
              ok: false,
              reason: "authorization_challenge_used",
              message:
                "This authorization step was already completed once. Please reload your portal to see your current bank setup — nothing was authorized twice and nothing was debited.",
            };
          }
        }
        return {
          ok: false,
          reason: "stripe_error",
          message: "We couldn't record your authorization. Please try again — no bank details were collected.",
        };
      }
      return {
        ok: true,
        mandateId: existing.id,
        setupUrl: checkout.url,
        authorizationText: existing.authorizationText,
        maxAmountCents: existing.maxAmountCents,
      };
    }

    logger.info("[achMandateSetup] pending ACH mandate recorded", {
      noteId: note.id,
      organizationId: note.organizationId,
      mandateId: mandate.id,
      maxAmountCents,
      authorizationTextVersion: AUTHORIZATION_TEXT_VERSION,
    });

    return {
      ok: true,
      mandateId: mandate.id,
      setupUrl: checkout.url,
      authorizationText,
      maxAmountCents,
    };
  } catch (err) {
    logger.error("[achMandateSetup] setup start failed", err instanceof Error ? err : undefined, {
      noteId: note.id,
    });
    return {
      ok: false,
      reason: "stripe_error",
      message: "We couldn't start bank verification right now. No authorization was stored — please try again.",
    };
  }
}

export type ConfirmAchMandateResult =
  | { ok: true; mandate: AchMandate; alreadyActive: boolean }
  | { ok: false; reason: "not_found" | "wrong_note" | "not_completed" | "no_payment_method" | "stripe_error"; message: string };

/**
 * Promote a pending mandate to `active` after Stripe confirms the bank
 * account. Idempotent: a replayed confirm (double-click, browser back button)
 * returns the already-active mandate without a second write.
 */
export async function confirmAchMandateSetup(input: {
  noteId: number;
  setupReference: string;
}): Promise<ConfirmAchMandateResult> {
  const [mandate] = await db
    .select()
    .from(achMandates)
    .where(eq(achMandates.setupReference, input.setupReference));

  if (!mandate) {
    return { ok: false, reason: "not_found", message: "We couldn't find that bank setup. Please start again." };
  }
  if (mandate.noteId !== input.noteId) {
    // Cross-note confirm attempt. Refuse loudly.
    logger.warn("[achMandateSetup] confirm rejected — setup reference belongs to another note", {
      mandateId: mandate.id,
      mandateNoteId: mandate.noteId,
      requestedNoteId: input.noteId,
    });
    return { ok: false, reason: "wrong_note", message: "That bank setup doesn't belong to this loan." };
  }
  if (mandate.status === "active") {
    return { ok: true, mandate, alreadyActive: true };
  }
  if (mandate.status !== "pending") {
    return {
      ok: false,
      reason: "not_completed",
      message: `This authorization is ${mandate.status} and can't be reactivated. Please set up autopay again.`,
    };
  }
  if (!mandate.processorAccountId) {
    return { ok: false, reason: "stripe_error", message: "This bank setup is missing its processor account." };
  }

  try {
    const { getUncachableStripeClient } = await import("../stripeClient");
    const stripe = await getUncachableStripeClient();
    const session = await stripe.checkout.sessions.retrieve(
      input.setupReference,
      { expand: ["setup_intent"] },
      { stripeAccount: mandate.processorAccountId },
    );

    if (session.status !== "complete") {
      return {
        ok: false,
        reason: "not_completed",
        message: "Bank verification isn't finished yet. Autopay stays off until it is.",
      };
    }

    const setupIntent = typeof session.setup_intent === "string" ? null : session.setup_intent;
    if (!setupIntent) {
      return {
        ok: false,
        reason: "no_payment_method",
        message: "Bank verification didn't return an account we can use. Autopay stays off.",
      };
    }

    const paymentMethodId =
      typeof setupIntent.payment_method === "string"
        ? setupIntent.payment_method
        : setupIntent.payment_method?.id ?? null;
    if (!paymentMethodId) {
      return {
        ok: false,
        reason: "no_payment_method",
        message: "Bank verification didn't return an account we can use. Autopay stays off.",
      };
    }

    const customerId =
      typeof session.customer === "string" ? session.customer : session.customer?.id ?? null;
    if (!customerId) {
      return {
        ok: false,
        reason: "no_payment_method",
        message: "Bank verification didn't attach the account to a customer record. Autopay stays off.",
      };
    }

    const processorMandateId =
      typeof setupIntent.mandate === "string" ? setupIntent.mandate : setupIntent.mandate?.id ?? null;

    // Bank display details — last4/bank name only. Never the full number.
    let bankName: string | null = null;
    let accountLast4: string | null = null;
    let accountType: string | null = null;
    try {
      const pm = await stripe.paymentMethods.retrieve(paymentMethodId, undefined, {
        stripeAccount: mandate.processorAccountId,
      });
      bankName = pm.us_bank_account?.bank_name ?? null;
      accountLast4 = pm.us_bank_account?.last4 ?? null;
      accountType = pm.us_bank_account?.account_type ?? null;
    } catch (err) {
      // Cosmetic only — never block an otherwise valid authorization on it.
      logger.warn("[achMandateSetup] could not read bank display details", {
        error: err instanceof Error ? err : String(err),
        metadata: { mandateId: mandate.id },
      });
    }

    const confirmedAt = new Date();
    const activated = await withTransaction(async (tx) => {
      // One live authorization per note, always.
      await tx
        .update(achMandates)
        .set({ status: "superseded", updatedAt: confirmedAt })
        .where(
          and(
            // organizationId leads deliberately: this is a WRITE that
            // deactivates authorizations to debit someone's bank account.
            // noteId alone would be correct-by-luck (a note belongs to one
            // org), but scoping by tenant explicitly means a bug elsewhere
            // in note resolution can never reach across orgs, and it matches
            // the org-leading index.
            eq(achMandates.organizationId, mandate.organizationId),
            eq(achMandates.noteId, mandate.noteId),
            eq(achMandates.status, "active"),
            ne(achMandates.id, mandate.id),
          ),
        );

      const [row] = await tx
        .update(achMandates)
        .set({
          status: "active",
          processorCustomerId: customerId,
          processorPaymentMethodId: paymentMethodId,
          processorMandateId,
          processorSetupIntentId: setupIntent.id,
          bankName,
          accountLast4,
          accountType,
          confirmedAt,
          updatedAt: confirmedAt,
        })
        // Only a still-pending row activates: a concurrent confirm that
        // already activated it loses here and we read the active row back.
        .where(and(eq(achMandates.id, mandate.id), eq(achMandates.status, "pending")))
        .returning();
      return row ?? null;
    });

    if (!activated) {
      const [current] = await db.select().from(achMandates).where(eq(achMandates.id, mandate.id));
      if (current?.status === "active") {
        return { ok: true, mandate: current, alreadyActive: true };
      }
      return { ok: false, reason: "stripe_error", message: "We couldn't activate your authorization. Please try again." };
    }

    logger.info("[achMandateSetup] ACH mandate activated", {
      noteId: mandate.noteId,
      mandateId: mandate.id,
      processorMandateId,
      accountLast4,
    });
    return { ok: true, mandate: activated, alreadyActive: false };
  } catch (err) {
    logger.error("[achMandateSetup] confirm failed", err instanceof Error ? err : undefined, {
      mandateId: mandate.id,
    });
    return {
      ok: false,
      reason: "stripe_error",
      message: "We couldn't confirm your bank setup right now. Autopay stays off until we can.",
    };
  }
}

/**
 * Revoke every active/pending mandate on a note. Called when the borrower
 * turns autopay off — NACHA requires we stop on request, and leaving a live
 * authorization behind an "off" toggle is exactly the kind of gap that
 * produces an unauthorized debit later.
 */
export async function revokeAchMandatesForNote(input: {
  noteId: number;
  reason: string;
  at?: Date;
}): Promise<number> {
  const at = input.at ?? new Date();
  const revoked = await db
    .update(achMandates)
    .set({ status: "revoked", revokedAt: at, revokedReason: input.reason, updatedAt: at })
    .where(
      and(
        eq(achMandates.noteId, input.noteId),
        ne(achMandates.status, "revoked"),
        ne(achMandates.status, "superseded"),
      ),
    )
    .returning({ id: achMandates.id });
  if (revoked.length > 0) {
    logger.info("[achMandateSetup] mandates revoked", {
      noteId: input.noteId,
      count: revoked.length,
      reason: input.reason,
    });
  }
  return revoked.length;
}

export interface AchMandateSummary {
  /** true only when a debit could actually be created today. */
  armed: boolean;
  status: AchMandate["status"] | "none";
  bankName: string | null;
  accountLast4: string | null;
  maxAmountCents: number | null;
  scheduleDescription: string | null;
  agreedAt: string | null;
  authorizationTextVersion: string | null;
}

/** What the portal needs to tell the borrower the truth about autopay. */
export async function getAchMandateSummary(noteId: number): Promise<AchMandateSummary> {
  const rows = await db
    .select()
    .from(achMandates)
    .where(eq(achMandates.noteId, noteId))
    .orderBy(achMandates.id);

  // Newest meaningful record wins: an active mandate beats a pending one,
  // which beats a terminal one.
  const active = rows.filter((r) => r.status === "active").pop();
  const pending = rows.filter((r) => r.status === "pending").pop();
  const chosen = active ?? pending ?? rows[rows.length - 1] ?? null;

  if (!chosen) {
    return {
      armed: false,
      status: "none",
      bankName: null,
      accountLast4: null,
      maxAmountCents: null,
      scheduleDescription: null,
      agreedAt: null,
      authorizationTextVersion: null,
    };
  }

  return {
    armed:
      chosen.status === "active" &&
      !!chosen.processorPaymentMethodId &&
      !!chosen.processorCustomerId &&
      !!chosen.processorAccountId,
    status: chosen.status,
    bankName: chosen.bankName,
    accountLast4: chosen.accountLast4,
    maxAmountCents: chosen.maxAmountCents,
    scheduleDescription: chosen.scheduleDescription,
    agreedAt: chosen.agreedAt ? chosen.agreedAt.toISOString() : null,
    authorizationTextVersion: chosen.authorizationTextVersion,
  };
}
