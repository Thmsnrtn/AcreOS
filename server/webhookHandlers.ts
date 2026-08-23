import { getUncachableStripeClient, getStripeSecretKey } from './stripeClient';
import { storage, db } from './storage';
import { withTransaction } from './db';
import { creditService } from './services/credits';
import {
  CreditPackId,
  stripeProcessedEvents,
  organizations,
  subscriptionEvents,
  subscriptionHistory,
} from '@shared/schema';
import { eq, sql } from 'drizzle-orm';
import Stripe from 'stripe';
import { logger } from './utils/logger';
import { addMonths } from './utils/dateUtils';
import { recordSense } from './services/autopilot/perception';

// ─── Refund reversal derivation (PURE) ──────────────────────────────────────
//
// A refunded card payment is backed out by APPENDING a negative row to the
// payments ledger. The original row is never edited and never deleted: the
// borrower really did pay, and the reversing pair IS the audit trail. This is
// the same shape achAutopay.ts uses for an ACH return.
//
// Everything below is pure so the tax gate can drive it without a database.

/** The original payment's buckets, in cents. */
export interface ReversibleLedgerRow {
  amountCents: number;
  principalCents: number;
  interestCents: number;
  feeCents: number;
  lateFeeCents: number;
}

/** One Stripe refund against that payment. */
export interface StripeRefundFact {
  id: string;
  amountCents: number;
  /** ISO instant the refund was created — the day the reversal posts. */
  createdIso: string;
}

/** One reversing ledger row to append. Every money field is NEGATIVE. */
export interface RefundReversalRow {
  refundId: string;
  postedAt: Date;
  amountCents: number;
  principalCents: number;
  interestCents: number;
  feeCents: number;
  lateFeeCents: number;
}

/**
 * Split refunds across the original payment's buckets.
 *
 * PARTIAL REFUNDS ARE THE NORMAL CASE, not an edge: a lender who refunds a
 * $50 late fee off a $500 payment has reversed none of the principal and none
 * of the interest in proportion... so each bucket is reduced in the ratio the
 * refund bears to the payment. Reversing the whole row for a partial refund
 * would wipe out interest the borrower really did pay.
 *
 * Allocation is CUMULATIVE, not per-refund: each row carries the difference
 * between the split at the running total and the split at the previous total.
 * Two consequences that a naive per-refund `round()` gets wrong:
 *   • rounding cannot drift — three refunds of a third each reverse exactly
 *     the original, to the cent;
 *   • a refund that completes the payment reverses exactly what is left, so a
 *     fully refunded payment nets to zero and can never leave a stray cent of
 *     interest on a Form 1098.
 *
 * `alreadyReversedRefundIds` are skipped but still ADVANCE the running total,
 * which is what makes redelivery and second-partial-refund events idempotent.
 */
export function deriveRefundReversals(input: {
  original: ReversibleLedgerRow;
  refunds: StripeRefundFact[];
  alreadyReversedRefundIds: ReadonlySet<string>;
}): RefundReversalRow[] {
  const { original, refunds, alreadyReversedRefundIds } = input;
  const total = original.amountCents;
  // A zero/negative original is not a payment we can proportion a refund
  // against. Refuse rather than invent a split.
  if (total <= 0) return [];

  const ordered = [...refunds]
    .filter((r) => r.amountCents > 0)
    .sort((a, b) => (a.createdIso === b.createdIso ? a.id.localeCompare(b.id) : a.createdIso.localeCompare(b.createdIso)));

  /** The share of `bucket` reversed once `cumulative` has been refunded. */
  const share = (bucket: number, cumulative: number): number =>
    cumulative >= total ? bucket : Math.round((bucket * cumulative) / total);

  let cumulative = 0;
  let prev = { amount: 0, principal: 0, interest: 0, fee: 0, lateFee: 0 };
  const rows: RefundReversalRow[] = [];

  for (const r of ordered) {
    cumulative = Math.min(total, cumulative + r.amountCents);
    const cur = {
      amount: share(total, cumulative),
      principal: share(original.principalCents, cumulative),
      interest: share(original.interestCents, cumulative),
      fee: share(original.feeCents, cumulative),
      lateFee: share(original.lateFeeCents, cumulative),
    };
    if (!alreadyReversedRefundIds.has(r.id)) {
      const row: RefundReversalRow = {
        refundId: r.id,
        postedAt: new Date(r.createdIso),
        amountCents: -(cur.amount - prev.amount),
        principalCents: -(cur.principal - prev.principal),
        interestCents: -(cur.interest - prev.interest),
        feeCents: -(cur.fee - prev.fee),
        lateFeeCents: -(cur.lateFee - prev.lateFee),
      };
      if (
        row.amountCents !== 0 ||
        row.principalCents !== 0 ||
        row.interestCents !== 0 ||
        row.feeCents !== 0 ||
        row.lateFeeCents !== 0
      ) {
        rows.push(row);
      }
    }
    prev = cur;
  }

  return rows;
}

export class WebhookHandlers {
  /**
   * Verify webhook signature and parse event.
   * Uses stripe.webhooks.constructEvent() for cryptographic verification.
   */
  private static async verifyAndParseEvent(payload: Buffer, signature: string): Promise<Stripe.Event> {
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      throw new Error('STRIPE_WEBHOOK_SECRET not configured — cannot verify webhook signatures');
    }

    const stripe = await getUncachableStripeClient();
    // constructEvent verifies the signature and throws on mismatch
    return stripe.webhooks.constructEvent(payload, signature, webhookSecret);
  }

  /**
   * Atomically claim an event for processing using INSERT ... ON CONFLICT DO NOTHING.
   * Returns true if this instance successfully claimed the event (i.e., the row was inserted).
   * Returns false if the event was already claimed by another instance (conflict, no row returned).
   * This eliminates the TOCTOU race between isDuplicate() and markProcessed() (DEFECT-0006).
   */
  private static async claimEvent(eventId: string, eventType: string): Promise<boolean> {
    try {
      const result = await db.insert(stripeProcessedEvents).values({
        stripeEventId: eventId,
        eventType,
      }).onConflictDoNothing().returning({ id: stripeProcessedEvents.id });
      // If a row was returned, we claimed it; if empty array, it was already claimed
      return result.length > 0;
    } catch (err) {
      // Table may not exist yet during migration — allow processing
      logger.warn(`[webhook] Failed to claim event ${eventId}, allowing processing`, err instanceof Error ? err : undefined);
      return true;
    }
  }

  static async processWebhook(payload: Buffer, signature: string): Promise<void> {
    if (!Buffer.isBuffer(payload)) {
      throw new Error(
        'STRIPE WEBHOOK ERROR: Payload must be a Buffer. ' +
        'Received type: ' + typeof payload + '. ' +
        'This usually means express.json() parsed the body before reaching this handler. ' +
        'FIX: Ensure webhook route is registered BEFORE app.use(express.json()).'
      );
    }

    // Verify signature cryptographically
    const event = await WebhookHandlers.verifyAndParseEvent(payload, signature);

    // Idempotency: atomically claim the event before processing (DEFECT-0006).
    // INSERT ... ON CONFLICT DO NOTHING RETURNING id ensures only one instance
    // processes each event, even under concurrent webhook delivery.
    const claimed = await WebhookHandlers.claimEvent(event.id, event.type);
    if (!claimed) {
      logger.info(`[webhook] Skipping duplicate event: ${event.id} (${event.type})`);
      return;
    }

    // Event claimed — dispatch. W1.8 (2026-07 audit): errors used to be
    // swallowed here, which combined with claim-before-process meant a
    // failed handler acked 200 AND left the claim row behind — Stripe's
    // retry was skipped as a "duplicate" and the update was lost forever
    // (charged-but-not-provisioned with no recovery path). Now a failure
    // releases the claim and re-throws: the route returns non-2xx, pages
    // on-call, and Stripe's bounded retry ladder re-delivers an event we
    // can claim again. Handlers that swallow their own non-critical errors
    // (emails, telemetry) are unaffected — only state-critical failures
    // propagate this far.
    try {
      await WebhookHandlers.dispatchEvent(event);
    } catch (err: any) {
      logger.error(`[webhook] Error processing ${event.type} (${event.id}) — releasing claim for Stripe retry`, err);
      await WebhookHandlers.releaseClaim(event.id);
      throw err;
    }
  }

  /**
   * Release a previously-claimed event so a Stripe redelivery can be
   * processed. Best-effort: if the delete itself fails we've already paged
   * on-call via the route's non-2xx path.
   */
  private static async releaseClaim(eventId: string): Promise<void> {
    try {
      await db
        .delete(stripeProcessedEvents)
        .where(eq(stripeProcessedEvents.stripeEventId, eventId));
    } catch (err) {
      logger.warn(
        `[webhook] Failed to release claim for ${eventId} — a Stripe retry will be skipped as duplicate`,
        err instanceof Error ? err : undefined,
      );
    }
  }

  /**
   * Hands roadmap P0.2 — feed the autopilot perception bus from real Stripe
   * events. Best-effort + non-PII (counts/cents/ids only); a sense write can
   * never break payment processing (recordSense swallows its own errors and we
   * still `void` it). This is how the brain perceives revenue + churn pressure.
   */
  /** True when a Stripe customer id resolves to one of our orgs. */
  private static async isAcreosCustomer(customerId?: string | null): Promise<boolean> {
    if (!customerId) return false;
    try {
      return !!(await storage.getOrganizationByStripeCustomerId(customerId));
    } catch {
      return false;
    }
  }

  private static emitRevenueSense(event: Stripe.Event): void {
    // Shared live account: land sales + Foundry emit events here too. Only
    // perceive events billed to an AcreOS org so their revenue/churn/dunning
    // never pollutes the autopilot signal bus. Best-effort; unresolved → skip.
    const obj = event.data.object as { customer?: string | { id: string } } | undefined;
    const customerId =
      typeof obj?.customer === 'string' ? obj.customer : obj?.customer?.id;
    void WebhookHandlers.isAcreosCustomer(customerId).then((owned) => {
      if (!owned) return;
      WebhookHandlers.emitRevenueSenseOwned(event);
    });
  }

  private static emitRevenueSenseOwned(event: Stripe.Event): void {
    try {
      switch (event.type) {
        case 'invoice.payment_failed': {
          const inv = event.data.object as Stripe.Invoice;
          void recordSense('dunning_pressure', Number(inv.amount_due ?? 0), { invoice: inv.id });
          break;
        }
        case 'invoice.payment_succeeded': {
          const inv = event.data.object as Stripe.Invoice;
          // attempt_count > 1 ⇒ this was a retry that finally cleared = a real
          // dunning recovery, distinct from a first-try renewal.
          if (Number(inv.attempt_count ?? 0) > 1) {
            void recordSense('payment_recovered', Number(inv.amount_paid ?? 0), { invoice: inv.id });
            // kernel-elevation T0.1: credit the REAL consequence onto the
            // autopilot dunning action that targeted this invoice (no-op unless
            // a witnessed dunning_action stamped target_ref="invoice:<id>").
            if (inv.id) {
              // Horizon A4 — realized-value join: thread the REAL recovered
              // cents through to the experience row (not just the boolean),
              // so cognition ROI can attribute actual dollars to the dispatch
              // that earned them. Never estimated — this is Stripe's number.
              void import('./services/autopilot/experienceLog').then(({ recordConsequenceByTarget }) =>
                recordConsequenceByTarget(`invoice:${inv.id}`, {
                  paymentRecovered: true,
                  recoveredCents: Number(inv.amount_paid ?? 0),
                }),
              ).catch(() => {});
            }
          }
          break;
        }
        case 'invoice.paid': {
          const inv = event.data.object as Stripe.Invoice;
          void recordSense('revenue_delta', Number(inv.amount_paid ?? 0), { invoice: inv.id });
          break;
        }
        case 'customer.subscription.deleted': {
          const sub = event.data.object as Stripe.Subscription;
          void recordSense('churn_signal', 1, { subscription: sub.id, reason: 'cancelled' });
          break;
        }
        case 'charge.dispute.created': {
          const d = event.data.object as Stripe.Dispute;
          void recordSense('churn_signal', 1, { dispute: d.id, reason: 'dispute' });
          break;
        }
        case 'customer.subscription.trial_will_end': {
          const sub = event.data.object as Stripe.Subscription;
          void recordSense('trial_ending', 1, { subscription: sub.id });
          break;
        }
        default:
          break;
      }
    } catch {
      /* perception is best-effort; never let it affect webhook processing */
    }
  }

  private static async dispatchEvent(event: Stripe.Event): Promise<void> {
    WebhookHandlers.emitRevenueSense(event);
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.metadata?.type === 'borrower_portal_payment') {
        return WebhookHandlers.processBorrowerPortalPayment(session);
      }
      if (session.metadata?.type === 'credit_purchase') {
        return WebhookHandlers.processCreditPurchase(session);
      }
      // Vertical-pack add-on (S3) — MUST run before the generic subscription
      // branch, or the pack sub would be recorded as the org's plan sub.
      if (session.metadata?.type === 'vertical_pack') {
        return WebhookHandlers.processVerticalPackPurchase(session);
      }

      // Subscription checkout — eagerly record the subscription ID so the org
      // is updated even if customer.subscription.updated fires before we process it.
      if (session.mode === 'subscription' && session.subscription) {
        await WebhookHandlers.processSubscriptionCheckoutCompleted(session);
        return;
      }
      return;
    }

    if (event.type === 'invoice.payment_failed') {
      return WebhookHandlers.processPaymentFailed(event.data.object as Stripe.Invoice);
    }

    if (event.type === 'invoice.upcoming') {
      return WebhookHandlers.processUpcomingRenewal(event.data.object as Stripe.Invoice);
    }

    if (event.type === 'invoice.payment_succeeded') {
      return WebhookHandlers.processPaymentSucceeded(event.data.object as Stripe.Invoice);
    }

    if (event.type === 'customer.subscription.deleted') {
      return WebhookHandlers.processSubscriptionCancelled(event.data.object as Stripe.Subscription);
    }

    // customer.subscription.created fires when any new subscription is created.
    // Reuse processSubscriptionUpdated since the payload shape is identical.
    if (event.type === 'customer.subscription.created') {
      const subscription = event.data.object as Stripe.Subscription;
      await WebhookHandlers.processSubscriptionUpdated(subscription);
      return;
    }

    if (event.type === 'customer.subscription.updated') {
      return WebhookHandlers.processSubscriptionUpdated(event.data.object as Stripe.Subscription);
    }

    if (event.type === 'customer.subscription.paused') {
      const subscription = event.data.object as Stripe.Subscription;
      await WebhookHandlers.processSubscriptionPaused(subscription);
      return;
    }

    if (event.type === 'customer.subscription.resumed') {
      const subscription = event.data.object as Stripe.Subscription;
      await WebhookHandlers.processSubscriptionResumed(subscription);
      return;
    }

    if (event.type === 'invoice.paid') {
      const invoice = event.data.object as Stripe.Invoice;
      await WebhookHandlers.processInvoicePaid(invoice);
      return;
    }

    if (event.type === 'customer.subscription.trial_will_end') {
      return WebhookHandlers.processTrialWillEnd(event.data.object as Stripe.Subscription);
    }

    if (
      event.type === 'charge.dispute.created' ||
      event.type === 'charge.dispute.updated' ||
      event.type === 'charge.dispute.closed'
    ) {
      await WebhookHandlers.processChargeDispute(event.type, event.data.object as Stripe.Dispute);
      return;
    }

    // Lavender Week 10 — recognition worker. Stripe `charge.refunded` posts
    // the opposite ledger pair of the original invoice booking so the GL
    // nets to zero on a full refund.
    if (event.type === 'charge.refunded') {
      await WebhookHandlers.processChargeRefunded(event.data.object as Stripe.Charge);
      return;
    }

    // Pillar 1.5 — capture Stripe processing fees as opex_spent. We listen
    // to charge.succeeded (a sibling of invoice.paid) because Stripe only
    // computes the balance_transaction fee on the charge itself.
    if (event.type === 'charge.succeeded') {
      await WebhookHandlers.processChargeSucceeded(event.data.object as Stripe.Charge);
      return;
    }

    // Unhandled event type — log and acknowledge
    logger.info(`[webhook] Unhandled Stripe event type: ${event.type}`);
  }

  /**
   * Eagerly record the subscription ID when a subscription checkout completes.
   * customer.subscription.updated will handle tier detection, but this ensures
   * stripeSubscriptionId is saved immediately and provides a reliable fallback.
   */
  static async processSubscriptionCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
    try {
      const organizationId = session.metadata?.organizationId
        ? parseInt(session.metadata.organizationId, 10)
        : null;

      if (!organizationId) {
        logger.warn('[webhook] subscription checkout missing organizationId metadata');
        return;
      }

      const subscriptionId = typeof session.subscription === 'string'
        ? session.subscription
        : session.subscription?.id;

      if (!subscriptionId) return;

      // W1.8: subscription state + the "subscribed" audit row commit
      // atomically. A crash between them used to leave a provisioned org
      // with no history marker (or, worse orderings elsewhere, history
      // without state). Failure rolls both back and propagates so Stripe
      // redelivers.
      await withTransaction(async (tx) => {
        const [orgAfter] = await tx
          .update(organizations)
          .set({
            stripeSubscriptionId: subscriptionId,
            subscriptionStatus: 'active',
            trialUsed: true, // Mark here, not at checkout creation — abandoned checkouts must not consume the trial
            updatedAt: new Date(),
          })
          .where(eq(organizations.id, organizationId))
          .returning({
            subscriptionTier: organizations.subscriptionTier,
            billingInterval: organizations.billingInterval,
          });

        // Renoir audit-log: capture the initial "subscribed" event with the
        // priced state. customer.subscription.updated will follow with the
        // tier-resolved row, but having an explicit subscribed marker makes
        // tenure math straightforward.
        await tx.insert(subscriptionHistory).values({
          organizationId,
          eventType: 'subscribed',
          tier: orgAfter?.subscriptionTier ?? null,
          billingInterval: orgAfter?.billingInterval ?? null,
          priceCents: null,
          metadata: {
            stripeSubscriptionId: subscriptionId,
            source: 'webhook:checkout.session.completed',
          } as any,
        });
      });

      logger.info(`[webhook] Subscription checkout completed: Org ${organizationId}, sub ${subscriptionId}`);

      // Phase 3 Week 14 — Activation telemetry. Subscription went active =
      // first_payment_processed. Idempotent FIRST-occurrence.
      try {
        const { recordActivationEventAsync } = await import('./services/activation');
        recordActivationEventAsync({
          orgId: organizationId,
          userId: null,
          eventName: 'first_payment_processed',
          eventValue: { stripeSubscriptionId: subscriptionId, source: 'webhook:checkout.session.completed' },
        });
        // Tier 2C — server-side funnel truth. trial_to_paid used to be a
        // client-side PostHog event fired off the ?subscription=success
        // redirect (spoofable, ad-blockable, lost when the tab closed before
        // the redirect landed). The webhook is the only witness of the money
        // actually moving, so the canonical funnel event is recorded HERE.
        // Idempotent first-occurrence via the (org, eventName) unique index.
        recordActivationEventAsync({
          orgId: organizationId,
          userId: null,
          eventName: 'trial_to_paid',
          eventValue: { stripeSubscriptionId: subscriptionId, source: 'webhook:checkout.session.completed' },
        });
      } catch { /* non-fatal */ }

      // Send subscription welcome email
      try {
        const { emailService } = await import('./services/emailService');
        const org = await storage.getOrganization(organizationId);
        if (org) {
          const tierName = (org.subscriptionTier || 'starter').charAt(0).toUpperCase() + (org.subscriptionTier || 'starter').slice(1);
          // Roadmap W1.3: this email previously hardcoded entitlements that
          // disagreed with the real limits (and named a non-existent tier) —
          // customers were told the wrong plan on day one. Render from
          // TIER_LIMITS, the single source of truth, with unlimited (null)
          // spelled out honestly.
          const { TIER_LIMITS } = await import('@shared/billing/tier-limits');
          const tierKey = (org.subscriptionTier || 'starter') as keyof typeof TIER_LIMITS;
          const real = TIER_LIMITS[tierKey] ?? TIER_LIMITS.starter;
          const fmt = (n: number | null | undefined): string =>
            n == null ? 'Unlimited' : n.toLocaleString('en-US');
          const limits = {
            leads: fmt(real.leads),
            properties: fmt(real.properties),
            ai: real.aiTurnsByokThreshold == null ? 'Unlimited' : `${fmt(real.aiTurnsByokThreshold)}/month`,
          };

          // Find the user's email from session metadata or org owner
          const userEmail = session.customer_email || session.metadata?.userEmail;
          if (userEmail) {
            await emailService.sendEmail({
              to: userEmail,
              subject: `Welcome to AcreOS ${tierName}!`,
              html: `
                <h2>Welcome to AcreOS ${tierName}!</h2>
                <p>Your subscription is now active. Here's what's included in your plan:</p>
                <ul>
                  <li><strong>Leads:</strong> ${limits.leads}</li>
                  <li><strong>Properties:</strong> ${limits.properties}</li>
                  <li><strong>AI Requests:</strong> ${limits.ai}</li>
                </ul>
                <p><a href="${process.env.APP_URL || 'https://app.acreos.io'}">Go to your dashboard</a></p>
                <p>— The AcreOS Team</p>
              `,
              text: `Welcome to AcreOS ${tierName}!\n\nYour plan includes:\n- Leads: ${limits.leads}\n- Properties: ${limits.properties}\n- AI Requests: ${limits.ai}\n\nGo to your dashboard: ${process.env.APP_URL || 'https://app.acreos.io'}`,
            });
            logger.info(`[webhook] Welcome email sent to ${userEmail} for ${tierName} plan`);
          }
        }
      } catch (emailErr) {
        logger.warn('[webhook] Could not send subscription welcome email (email service may not be configured)', emailErr instanceof Error ? emailErr : undefined);
      }
    } catch (err) {
      // State-critical failure — propagate so processWebhook releases the
      // claim and Stripe redelivers (a swallowed error here = a customer
      // charged but never provisioned, silently).
      logger.error('[webhook] Error processing subscription checkout', err instanceof Error ? err : undefined);
      throw err;
    }
  }

  /**
   * invoice.upcoming — Stripe's pre-renewal notice, fired N days before a
   * subscription renews (N is the Dashboard's "Upcoming invoice" lead time;
   * set it to 7+ days there). ToS §5 promises customers a renewal reminder
   * and 940 CMR 38 (MA auto-renewal regulation) expects notice with clear
   * cancellation instructions — this handler is what keeps that promise.
   * System-lane email (platform sender): renewal date, amount, and the
   * self-serve cancel path. Never throws — a reminder failure must not
   * poison webhook processing.
   */
  static async processUpcomingRenewal(invoice: Stripe.Invoice): Promise<void> {
    try {
      const customerId =
        typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;
      if (!customerId) return;

      const org = await storage.getOrganizationByStripeCustomerId(customerId);
      const to =
        invoice.customer_email ||
        (org as { billingEmail?: string | null } | undefined)?.billingEmail ||
        null;
      if (!to) {
        logger.info(`[webhook] invoice.upcoming: no email for customer ${customerId} — reminder skipped`);
        return;
      }

      const amount = ((invoice.amount_due ?? 0) / 100).toLocaleString('en-US', {
        style: 'currency',
        currency: (invoice.currency || 'usd').toUpperCase(),
      });
      const renewsAtMs =
        (invoice.next_payment_attempt ?? (invoice as { period_end?: number }).period_end ?? 0) * 1000;
      const renewsOn = renewsAtMs
        ? new Date(renewsAtMs).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
        : 'your next billing date';
      const appUrl = process.env.APP_URL || 'https://acreos.io';
      const billingUrl = `${appUrl}/settings?tab=billing`;

      const { emailService } = await import('./services/emailService');
      await emailService.sendEmail({
        to,
        subject: `Your AcreOS subscription renews on ${renewsOn}`,
        html: `
          <h2>Your AcreOS subscription renews soon</h2>
          <p>This is a reminder that your AcreOS subscription will renew automatically on
          <strong>${renewsOn}</strong> for <strong>${amount}</strong>, charged to your payment
          method on file.</p>
          <p>No action is needed to continue. If you'd like to make a change, you can manage
          or cancel your subscription any time — it takes effect at the end of the current
          billing period, with no calls and no forms:</p>
          <p><a href="${billingUrl}">Manage subscription</a></p>
          <p>Questions? Just reply to this email.</p>
          <p>— The AcreOS Team</p>
        `,
        text: `Your AcreOS subscription renews automatically on ${renewsOn} for ${amount}, charged to your payment method on file.\n\nNo action is needed to continue. To manage or cancel (effective at the end of the current period): ${billingUrl}\n\nQuestions? Just reply to this email.\n— The AcreOS Team`,
      });
      logger.info(`[webhook] Renewal reminder sent to ${to} (renews ${renewsOn}, ${amount})`);
    } catch (err) {
      logger.warn(
        '[webhook] Could not send renewal reminder (invoice.upcoming)',
        err instanceof Error ? err : undefined,
      );
    }
  }

  static async processPaymentFailed(invoice: Stripe.Invoice): Promise<void> {
    try {
      const customerId = typeof invoice.customer === 'string' 
        ? invoice.customer 
        : invoice.customer?.id;
      
      if (!customerId) {
        logger.error('No customer ID on failed invoice');
        return;
      }

      // Find org by stripe customer ID
      const org = await storage.getOrganizationByStripeCustomerId(customerId);
      if (!org) {
        logger.info(`No organization found for Stripe customer: ${customerId}`);
        return;
      }

      // Was `(invoice as any).subscription`, which is not a field in the pinned
      // API version — Stripe moved it under parent.subscription_details. It was
      // always undefined, so every dunning row recorded '' for the subscription.
      const { invoiceSubscriptionId } = await import('./stripeClient');
      const subscriptionId = invoiceSubscriptionId(invoice);

      const { dunningService } = await import('./services/dunning');
      await dunningService.handlePaymentFailed(
        org.id,
        invoice.id,
        subscriptionId,
        invoice.amount_due,
        invoice.attempt_count || 1
      );

      logger.info(`Payment failed processed: Org ${org.id}, Invoice ${invoice.id}, Amount: $${invoice.amount_due / 100}`);
    } catch (err) {
      logger.error('Error processing payment failed', err instanceof Error ? err : undefined);
    }
  }

  static async processPaymentSucceeded(invoice: Stripe.Invoice): Promise<void> {
    try {
      const customerId = typeof invoice.customer === 'string' 
        ? invoice.customer 
        : invoice.customer?.id;
      
      if (!customerId) {
        return;
      }

      const org = await storage.getOrganizationByStripeCustomerId(customerId);
      if (!org) {
        return;
      }

      // Only process if org was in dunning
      if (org.dunningStage && org.dunningStage !== 'none') {
        const { dunningService } = await import('./services/dunning');
        await dunningService.handlePaymentSucceeded(
          org.id,
          invoice.id,
          invoice.amount_paid
        );

        logger.info(`Payment succeeded, dunning resolved: Org ${org.id}, Amount: $${invoice.amount_paid / 100}`);
      }
    } catch (err) {
      logger.error('Error processing payment succeeded', err instanceof Error ? err : undefined);
    }
  }

  static async processSubscriptionCancelled(subscription: Stripe.Subscription): Promise<void> {
    try {
      // Vertical-pack guard (S3): a pack add-on cancelling must cancel the
      // PACK, never downgrade the org's plan to free — without this guard the
      // generic path below would nuke the whole subscription tier.
      if (subscription.metadata?.type === 'vertical_pack') {
        await WebhookHandlers.cancelVerticalPack(subscription);
        return;
      }

      const customerId = typeof subscription.customer === 'string'
        ? subscription.customer
        : subscription.customer?.id;

      if (!customerId) return;

      const org = await storage.getOrganizationByStripeCustomerId(customerId);
      if (!org) return;

      const previousTier = org.subscriptionTier || 'free';

      // W1.8: downgrade + both audit rows commit atomically. A crash
      // mid-sequence used to leave an org on the free tier with no cancel
      // event and no lifecycle history — tenure/churn math silently wrong.
      await withTransaction(async (tx) => {
        // Update org to free tier
        await tx
          .update(organizations)
          .set({
            subscriptionTier: 'free',
            subscriptionStatus: 'cancelled',
            dunningStage: 'cancelled',
            stripeSubscriptionId: null,
            updatedAt: new Date(),
          })
          .where(eq(organizations.id, org.id));

        // Log the subscription cancel event
        await tx.insert(subscriptionEvents).values({
          organizationId: org.id,
          eventType: 'cancel',
          fromTier: previousTier,
          toTier: null,
        });

        // Renoir audit-log: priced lifecycle history for reactivation context.
        await tx.insert(subscriptionHistory).values({
          organizationId: org.id,
          eventType: 'canceled',
          tier: previousTier,
          billingInterval: org.billingInterval || null,
          priceCents: null,
          metadata: {
            stripeSubscriptionId: subscription.id,
            source: 'webhook:customer.subscription.deleted',
          } as any,
        });
      });

      // Send cancellation confirmation email
      try {
        const { emailService } = await import('./services/emailService');
        const { users } = await import('@shared/models/auth');
        const { eq } = await import('drizzle-orm');
        const [owner] = await db.select({ email: users.email }).from(users).where(eq(users.clerkUserId, org.ownerId)).limit(1);
        if (owner?.email) {
          await emailService.sendEmail({
            to: owner.email,
            subject: 'Your AcreOS subscription has been cancelled',
            html: `
              <h2>Subscription Cancelled</h2>
              <p>Your AcreOS ${previousTier} subscription has been cancelled. Your account has been moved to the Free tier.</p>
              <p>Your data is preserved — you can re-subscribe at any time to pick up where you left off.</p>
              <p><a href="${process.env.APP_URL || 'https://app.acreos.io'}/settings">Re-subscribe</a></p>
              <p>— The AcreOS Team</p>
            `,
            text: `Your AcreOS ${previousTier} subscription has been cancelled. Your account has been moved to the Free tier.\n\nYour data is preserved — re-subscribe any time: ${process.env.APP_URL || 'https://app.acreos.io'}/settings\n\n— The AcreOS Team`,
          });
        }
      } catch (emailErr) {
        logger.warn('[webhook] Could not send cancellation confirmation email', emailErr instanceof Error ? emailErr : undefined);
      }

      // Tier 2C — cancellation_reason_ask at T+0 (the template's trigger).
      // Only fires when the customer cancelled OUTSIDE the in-app flow (the
      // in-app cancellation dialog already collects the reason into
      // churn_reasons — asking again would be tone-deaf). Once-only per org
      // via dispatchLifecycleOnce; the daily lifecycle_dispatch sweep is the
      // catch-up if this inline dispatch fails. Best-effort, never blocks
      // the webhook ack.
      try {
        const { churnReasons } = await import('@shared/schema');
        const { users } = await import('@shared/models/auth');
        const { eq } = await import('drizzle-orm');
        const [existingReason] = await db
          .select({ id: churnReasons.id })
          .from(churnReasons)
          .where(eq(churnReasons.organizationId, org.id))
          .limit(1);
        if (!existingReason) {
          const [ownerUser] = await db
            .select({ id: users.id, email: users.email })
            .from(users)
            .where(eq(users.clerkUserId, org.ownerId))
            .limit(1);
          if (ownerUser?.email) {
            const { dispatchLifecycleOnce } = await import('./jobs/lifecycleDispatch');
            await dispatchLifecycleOnce({
              templateKey: 'cancellation_reason_ask',
              organizationId: org.id,
              recipientEmail: ownerUser.email,
              userId: ownerUser.id,
              metadata: { trigger: 'webhook:customer.subscription.deleted' },
            });
          }
        }
      } catch (askErr) {
        logger.warn('[webhook] cancellation_reason_ask dispatch failed', askErr instanceof Error ? askErr : undefined);
      }

      // Magnus §1 — ML training: capture org's last-30-day usage snapshot
      // at churn so we have a (features → churned) row to train a churn
      // model on later. Fire-and-forget; never blocks webhook ack.
      try {
        const { recordSnapshotAsync } = await import('./services/mlSnapshots');
        const usage = await db.execute(sql`
          SELECT
            (SELECT COUNT(*)::int FROM leads
              WHERE organization_id = ${org.id}
                AND created_at > NOW() - INTERVAL '30 days') AS "leadsCreated30d",
            (SELECT COUNT(*)::int FROM properties
              WHERE organization_id = ${org.id}
                AND created_at > NOW() - INTERVAL '30 days') AS "propertiesCreated30d",
            (SELECT COUNT(*)::int FROM deals
              WHERE organization_id = ${org.id}
                AND created_at > NOW() - INTERVAL '30 days') AS "dealsCreated30d",
            (SELECT COUNT(*)::int FROM deals
              WHERE organization_id = ${org.id}
                AND status = 'closed'
                AND updated_at > NOW() - INTERVAL '30 days') AS "dealsClosed30d"
        `);
        const usageRow = ((usage as any).rows ?? (usage as any) ?? [])[0] ?? {};

        recordSnapshotAsync({
          snapshotType: 'churn_outcome',
          subjectType: 'org',
          subjectId: String(org.id),
          orgId: org.id,
          decisionAt: new Date(),
          outcomeAt: new Date(),
          features: {
            previousTier,
            billingInterval: org.billingInterval ?? null,
            ageDays: org.createdAt
              ? Math.round((Date.now() - new Date(org.createdAt as any).getTime()) / 86400000)
              : null,
            leadsCreated30d: Number(usageRow.leadsCreated30d ?? 0),
            propertiesCreated30d: Number(usageRow.propertiesCreated30d ?? 0),
            dealsCreated30d: Number(usageRow.dealsCreated30d ?? 0),
            dealsClosed30d: Number(usageRow.dealsClosed30d ?? 0),
          },
          labels: {
            outcome: 'churned',
            stripeSubscriptionId: subscription.id,
            cancelledAt: new Date().toISOString(),
            // Reason will be backfilled via metadata when the exit-survey
            // (churn_reasons) row is recorded.
          },
        });
      } catch { /* non-fatal */ }

      logger.info(`Subscription cancelled: Org ${org.id}`);
    } catch (err) {
      // State-critical failure — propagate for claim release + Stripe retry.
      // (The email/survey/ML blocks above swallow their own errors; only the
      // downgrade transaction can land here.)
      logger.error('Error processing subscription cancelled', err instanceof Error ? err : undefined);
      throw err;
    }
  }

  /**
   * Handle subscription plan changes (upgrades/downgrades, status changes).
   */
  static async processSubscriptionUpdated(subscription: Stripe.Subscription): Promise<void> {
    try {
      // Vertical-pack guard (S3): pack add-on subscriptions are managed via
      // org_vertical_packs, never as the org's plan subscription.
      if (subscription.metadata?.type === 'vertical_pack') {
        return;
      }

      const customerId = typeof subscription.customer === 'string'
        ? subscription.customer
        : subscription.customer?.id;

      if (!customerId) return;

      const org = await storage.getOrganizationByStripeCustomerId(customerId);
      if (!org) return;

      // Map Stripe status to our status
      const statusMap: Record<string, string> = {
        active: 'active',
        past_due: 'past_due',
        unpaid: 'unpaid',
        trialing: 'trialing',
        canceled: 'cancelled',
        incomplete: 'incomplete',
        incomplete_expired: 'expired',
        paused: 'paused',
      };

      // Determine tier from product metadata, with a price-ID fallback
      // (roadmap W1.2): metadata-only resolution stranded paying customers on
      // free entitlements whenever `product.metadata.tier` was unset — and
      // MRR (summed from subscriptionTier) undercounted them. The price the
      // customer actually paid is the ground truth; map it back through the
      // same STRIPE_PRICE_* env vars checkout uses.
      const priceId = subscription.items?.data?.[0]?.price?.id;
      let newTier: string | undefined;

      if (priceId) {
        const stripe = await getUncachableStripeClient();
        const price = await stripe.prices.retrieve(priceId, { expand: ['product'] });
        const product = price.product as Stripe.Product;
        newTier = product.metadata?.tier;
        if (!newTier) {
          const { tierForStripePriceId } = await import('@shared/billing/tier-pricing');
          const mapped = tierForStripePriceId(priceId);
          if (mapped) {
            newTier = mapped;
            logger.warn(
              `[webhook] product.metadata.tier missing for price ${priceId} — resolved tier "${mapped}" from the price-ID mapping. Fix the Stripe product metadata.`,
            );
          } else {
            logger.error(
              `[webhook] cannot resolve tier for price ${priceId}: no product metadata AND no STRIPE_PRICE_* mapping — org ${org.id} tier NOT updated`,
            );
          }
        }
      }

      const updates: Record<string, any> = {
        subscriptionStatus: statusMap[subscription.status] || subscription.status,
        stripeSubscriptionId: subscription.id,
      };

      // Capture the priced state from Stripe for the audit log.
      const priceUnitAmount =
        subscription.items?.data?.[0]?.price?.unit_amount ?? null;
      const recurringInterval =
        subscription.items?.data?.[0]?.price?.recurring?.interval ?? null;
      const billingIntervalLabel =
        recurringInterval === 'year' ? 'yearly'
          : recurringInterval === 'month' ? 'monthly'
          : null;

      const previousTier = org.subscriptionTier;
      if (newTier) {
        updates.subscriptionTier = newTier;
      }
      const tierChanged = !!newTier && previousTier !== newTier;

      // W1.8: state + audit rows commit atomically. The old ordering wrote
      // both audit rows BEFORE updateOrganization — a crash between them
      // recorded a tier change that never happened.
      await withTransaction(async (tx) => {
        await tx
          .update(organizations)
          .set({ ...updates, updatedAt: new Date() })
          .where(eq(organizations.id, org.id));

        if (tierChanged) {
          await tx.insert(subscriptionEvents).values({
            organizationId: org.id,
            eventType: 'change',
            fromTier: previousTier,
            toTier: newTier!,
          });

          // Renoir audit-log: classify as reactivated when the org was on
          // the free/cancelled side and is moving to a paid tier; otherwise
          // it's a tier change (up or down).
          const wasInactive =
            !previousTier ||
            previousTier === 'free' ||
            org.subscriptionStatus === 'cancelled';
          await tx.insert(subscriptionHistory).values({
            organizationId: org.id,
            eventType: wasInactive ? 'reactivated' : 'tier_changed',
            tier: newTier!,
            billingInterval: billingIntervalLabel,
            priceCents: priceUnitAmount,
            metadata: {
              stripeSubscriptionId: subscription.id,
              fromTier: previousTier ?? null,
              source: 'webhook:customer.subscription.updated',
            } as any,
          });
        }
      });
      logger.info(`[webhook] Subscription updated: Org ${org.id}, Status: ${subscription.status}${newTier ? `, Tier: ${newTier}` : ''}`);

      // Founder notification: new paid signup or upgrade
      if (newTier && newTier !== 'free' && subscription.status === 'active') {
        const isUpgrade = org.subscriptionTier !== 'free' && org.subscriptionTier !== newTier;
        const isNewPaid = org.subscriptionTier === 'free' || !org.subscriptionTier;
        if (isNewPaid || isUpgrade) {
          await storage.createSystemAlert({
            organizationId: null as any, // Platform-wide alert for founder
            type: 'new_subscriber',
            severity: 'info',
            title: isUpgrade ? `Upgrade: ${org.name}` : `New subscriber: ${org.name}`,
            message: isUpgrade
              ? `${org.name} upgraded from ${org.subscriptionTier} → ${newTier}.`
              : `${org.name} converted to the ${newTier} plan.`,
            metadata: { organizationId: org.id, fromTier: org.subscriptionTier, toTier: newTier },
          });
        }
      }
    } catch (err) {
      // State-critical failure — propagate for claim release + Stripe retry.
      logger.error('Error processing subscription updated', err instanceof Error ? err : undefined);
      throw err;
    }
  }

  /**
   * Handle trial ending soon (3 days before trial ends).
   */
  static async processTrialWillEnd(subscription: Stripe.Subscription): Promise<void> {
    try {
      const customerId = typeof subscription.customer === 'string'
        ? subscription.customer
        : subscription.customer?.id;

      if (!customerId) return;

      const org = await storage.getOrganizationByStripeCustomerId(customerId);
      if (!org) return;

      // Create a system alert for the org
      await storage.createSystemAlert({
        organizationId: org.id,
        type: 'trial_ending',
        severity: 'warning',
        title: 'Your trial is ending soon',
        message: `Your trial ends on ${new Date((subscription.trial_end || 0) * 1000).toLocaleDateString()}. Upgrade to keep access to all features.`,
        metadata: {
          trialEnd: subscription.trial_end,
          subscriptionId: subscription.id,
        },
      });

      logger.info(`[webhook] Trial ending soon alert created: Org ${org.id}`);
    } catch (err) {
      logger.error('Error processing trial_will_end', err instanceof Error ? err : undefined);
    }
  }

  static async processSubscriptionPaused(subscription: Stripe.Subscription): Promise<void> {
    try {
      const customerId = typeof subscription.customer === 'string'
        ? subscription.customer
        : subscription.customer?.id;

      if (!customerId) return;

      const org = await storage.getOrganizationByStripeCustomerId(customerId);
      if (!org) return;

      // Tahoe E11 — Stripe attaches the resumes_at on subscription.pause_collection.
      // Bind the org-level pause window so middleware can 402 mutations and the
      // resumeExpiredPauses worker has a target to compare against. Idempotent:
      // re-firing the event with the same window is a no-op write.
      const pauseCollection = (subscription as any).pause_collection as
        | { resumes_at?: number | null; behavior?: string }
        | null
        | undefined;
      const resumesAtUnix = pauseCollection?.resumes_at ?? null;
      const subscriptionPauseEndsAt = resumesAtUnix
        ? new Date(resumesAtUnix * 1000)
        : null;

      await storage.updateOrganization(org.id, {
        subscriptionStatus: 'paused',
        subscriptionPaused: true,
        // Preserve the originally-elected `subscriptionPausedAt` if already
        // set by the /api/subscription/pause route — webhook redelivery
        // shouldn't reset the clock. New pauses default to now().
        ...(org.subscriptionPausedAt ? {} : { subscriptionPausedAt: new Date() }),
        ...(subscriptionPauseEndsAt ? { subscriptionPauseEndsAt } : {}),
      });

      await storage.logSubscriptionEvent({
        organizationId: org.id,
        eventType: 'pause',
        fromTier: org.subscriptionTier || 'free',
        toTier: null,
      });

      logger.info(`[webhook] Subscription paused: Org ${org.id} (resumes_at=${resumesAtUnix ?? 'null'})`);
    } catch (err) {
      logger.error('Error processing subscription paused', err instanceof Error ? err : undefined);
    }
  }

  static async processSubscriptionResumed(subscription: Stripe.Subscription): Promise<void> {
    try {
      const customerId = typeof subscription.customer === 'string'
        ? subscription.customer
        : subscription.customer?.id;

      if (!customerId) return;

      const org = await storage.getOrganizationByStripeCustomerId(customerId);
      if (!org) return;

      await storage.updateOrganization(org.id, {
        subscriptionStatus: 'active',
        // Tahoe E11 — clear the org-level pause guard. The mutation
        // middleware reads `subscriptionPaused`; auto-resume must flip
        // it back atomically with the status change.
        subscriptionPaused: false,
        subscriptionPausedAt: null,
        subscriptionPauseEndsAt: null,
        subscriptionPauseReason: null,
      });

      await storage.logSubscriptionEvent({
        organizationId: org.id,
        eventType: 'resume',
        fromTier: org.subscriptionTier || 'free',
        toTier: null,
      });

      logger.info(`[webhook] Subscription resumed: Org ${org.id}`);
    } catch (err) {
      logger.error('Error processing subscription resumed', err instanceof Error ? err : undefined);
    }
  }

  static async processInvoicePaid(invoice: Stripe.Invoice): Promise<void> {
    try {
      const customerId = typeof invoice.customer === 'string'
        ? invoice.customer
        : invoice.customer?.id;

      if (!customerId) {
        return;
      }

      const org = await storage.getOrganizationByStripeCustomerId(customerId);
      if (!org) {
        return;
      }

      // Only process if org was in dunning
      if (org.dunningStage && org.dunningStage !== 'none') {
        const { dunningService } = await import('./services/dunning');
        await dunningService.handlePaymentSucceeded(
          org.id,
          invoice.id,
          invoice.amount_paid
        );

        logger.info(`[webhook] Invoice paid, dunning resolved: Org ${org.id}, Amount: $${invoice.amount_paid / 100}`);
      }

      // Lavender Week 10 — recognition-worker ledger write.
      // Best-effort: never throw out of the webhook on accounting errors
      // (we'd rather double-process via Stripe redelivery than 5xx the
      // webhook and trigger a retry storm). Idempotent by event ID.
      try {
        const { recordStripeInvoicePaid } = await import('./services/recognitionWorker');
        const period = (invoice as any).lines?.data?.[0]?.period as
          | { start?: number; end?: number }
          | undefined;
        await recordStripeInvoicePaid({
          id: invoice.id ?? '',
          customerId,
          organizationId: org.id,
          amountPaidCents: invoice.amount_paid,
          paidAt: new Date(((invoice as any).status_transitions?.paid_at ?? Date.now() / 1000) * 1000).toISOString(),
          periodStartIso: period?.start ? new Date(period.start * 1000).toISOString() : undefined,
          periodEndIso: period?.end ? new Date(period.end * 1000).toISOString() : undefined,
          description: `Stripe invoice ${invoice.id}`,
        });
      } catch (recogErr) {
        logger.warn(
          '[webhook] recognitionWorker.recordStripeInvoicePaid failed',
          recogErr instanceof Error ? recogErr : undefined,
        );
      }

      // Pillar 1.5 — financial ledger split. Posts five bucket rows summing
      // to amount_paid via the canonical allocation policy. Idempotent by
      // externalEventId (stripe:invoice:<id>); fully isolated in try/catch so
      // a ledger failure can NEVER 5xx the webhook back to Stripe.
      // Tier 2B — a failed postRevenue dead-letters into ledger_dead_letters
      // for hourly replay instead of vanishing into the log stream.
      if (invoice.amount_paid > 0 && invoice.id) {
        const revenueArgs = {
          organizationId: org.id,
          amountCents: invoice.amount_paid,
          externalEventId: `stripe:invoice:${invoice.id}`,
          providerEventId: invoice.id,
          notes: `Stripe invoice ${invoice.id}`,
        };
        try {
          const { postRevenue } = await import('./services/financial-ledger');
          await postRevenue(revenueArgs);
        } catch (ledgerErr) {
          logger.warn(
            '[webhook] financial-ledger.postRevenue failed (non-fatal) — dead-lettering',
            ledgerErr instanceof Error ? ledgerErr : undefined,
          );
          const { recordLedgerDeadLetter } = await import('./services/ledgerDeadLetter');
          await recordLedgerDeadLetter({
            kind: 'revenue',
            externalEventId: revenueArgs.externalEventId,
            organizationId: org.id,
            payload: revenueArgs,
            error: ledgerErr,
          });
        }
      }
    } catch (err) {
      logger.error('Error processing invoice paid', err instanceof Error ? err : undefined);
    }
  }

  /**
   * Lavender Week 10 — Stripe `charge.refunded`. Posts the reverse
   * journal entry so the GL nets to zero on full refunds.
   */
  static async processChargeRefunded(charge: Stripe.Charge): Promise<void> {
    try {
      // Stripe SDK v20 dropped `invoice` from the Charge type, but legacy
      // webhook payloads can still carry the linkage. Read it through a narrow
      // typed view rather than `any`.
      const chargeInvoice = (charge as Stripe.Charge & {
        invoice?: string | { id: string } | null;
      }).invoice;
      const customerId = typeof charge.customer === 'string'
        ? charge.customer
        : charge.customer?.id;
      if (!customerId) return;
      const org = await storage.getOrganizationByStripeCustomerId(customerId);
      if (!org) return;

      const { recordStripeChargeRefunded } = await import('./services/recognitionWorker');
      await recordStripeChargeRefunded({
        chargeId: charge.id,
        organizationId: org.id,
        amountRefundedCents: charge.amount_refunded ?? 0,
        refundedAt: new Date().toISOString(),
        invoiceId: typeof chargeInvoice === 'string' ? chargeInvoice : chargeInvoice?.id,
        description: `Stripe refund — charge ${charge.id}`,
      });

      // Pillar 1.5 — financial ledger refund debit against refund_reserve.
      // Idempotent by externalEventId; never propagates failure to Stripe.
      // Tier 2B — failed postRefund dead-letters for hourly replay.
      const refundCents = charge.amount_refunded ?? 0;
      // Stripe issues one charge.refunded event per refund object. Prefer the
      // latest refund's id for a stable externalEventId per refund event.
      const latestRefund =
        (charge as any).refunds?.data?.[(charge as any).refunds?.data?.length - 1];
      const refundId: string = latestRefund?.id || `charge_${charge.id}`;
      if (refundCents > 0) {
        const refundArgs = {
          organizationId: org.id,
          amountCents: refundCents,
          externalEventId: `stripe:refund:${refundId}`,
          originalRevenueEventId:
            typeof chargeInvoice === 'string'
              ? `stripe:invoice:${chargeInvoice}`
              : chargeInvoice?.id
              ? `stripe:invoice:${chargeInvoice.id}`
              : undefined,
        };
        try {
          const { postRefund } = await import('./services/financial-ledger');
          await postRefund(refundArgs);
        } catch (ledgerErr) {
          logger.warn(
            '[webhook] financial-ledger.postRefund failed (non-fatal) — dead-lettering',
            ledgerErr instanceof Error ? ledgerErr : undefined,
          );
          const { recordLedgerDeadLetter } = await import('./services/ledgerDeadLetter');
          await recordLedgerDeadLetter({
            kind: 'refund',
            externalEventId: refundArgs.externalEventId,
            organizationId: org.id,
            payload: refundArgs,
            error: ledgerErr,
          });
        }
      }
    } catch (err) {
      logger.error('[webhook] Error processing charge.refunded', err instanceof Error ? err : undefined);
    }
  }

  /**
   * Pillar 1.5 — `charge.succeeded`. Stripe attaches a balance_transaction id
   * to every successful charge; that BalanceTransaction is the only object
   * that exposes the processing fee. We retrieve it and post the fee as
   * opex_spent (category=stripe_fee) so contribution-margin math accounts
   * for the cost of accepting cards. Idempotent on charge.id.
   */
  static async processChargeSucceeded(charge: Stripe.Charge): Promise<void> {
    try {
      const customerId = typeof charge.customer === 'string'
        ? charge.customer
        : charge.customer?.id;
      if (!customerId) return;
      const org = await storage.getOrganizationByStripeCustomerId(customerId);
      if (!org) return;

      let feeCents = 0;
      const btId = typeof charge.balance_transaction === 'string'
        ? charge.balance_transaction
        : charge.balance_transaction?.id;
      if (btId) {
        try {
          const stripe = await getUncachableStripeClient();
          const bt = await stripe.balanceTransactions.retrieve(btId);
          feeCents = bt.fee ?? 0;
        } catch (btErr) {
          logger.warn(
            '[webhook] could not retrieve balance_transaction for fee',
            btErr instanceof Error ? btErr : undefined,
          );
        }
      }

      if (feeCents <= 0) return;
      // Tier 2B — failed fee posting dead-letters for hourly replay.
      const feeArgs = {
        organizationId: org.id,
        amountCents: feeCents,
        category: 'stripe_fee',
        feature: 'subscription',
        providerName: 'stripe',
        providerEventId: charge.id,
        externalEventId: `stripe:fee:${charge.id}`,
        notes: `Stripe processing fee for charge ${charge.id}`,
      };
      try {
        const { postOpexSpent } = await import('./services/financial-ledger');
        await postOpexSpent(feeArgs);
      } catch (ledgerErr) {
        logger.warn(
          '[webhook] financial-ledger.postOpexSpent (stripe_fee) failed — dead-lettering',
          ledgerErr instanceof Error ? ledgerErr : undefined,
        );
        const { recordLedgerDeadLetter } = await import('./services/ledgerDeadLetter');
        await recordLedgerDeadLetter({
          kind: 'opex',
          externalEventId: feeArgs.externalEventId,
          organizationId: org.id,
          payload: feeArgs,
          error: ledgerErr,
        });
      }
    } catch (err) {
      logger.error('[webhook] Error processing charge.succeeded', err instanceof Error ? err : undefined);
    }
  }

  static async processCreditPurchase(session: Stripe.Checkout.Session): Promise<void> {
    try {
      const { organizationId, packId } = session.metadata || {};
      
      if (!organizationId || !packId) {
        logger.error('Missing organizationId or packId in credit purchase session metadata');
        return;
      }

      const orgId = parseInt(organizationId);
      const paymentIntentId = typeof session.payment_intent === 'string' 
        ? session.payment_intent 
        : session.payment_intent?.id;

      const transaction = await creditService.applyCreditPackPurchase(
        orgId,
        packId as CreditPackId,
        session.id,
        paymentIntentId
      );

      logger.info(`Credit purchase processed: Org ${orgId}, Pack ${packId}, Credits added: ${transaction.amountCents} cents`);
    } catch (err) {
      logger.error('Error processing credit purchase', err instanceof Error ? err : undefined);
      throw err;
    }
  }

  /**
   * Vertical-pack add-on activation (S3). The checkout session carries
   * metadata {type:"vertical_pack", packKey, interval, organizationId}; on
   * completion the org_vertical_packs row is upserted active so the pack's
   * businessTypeOnly surfaces unlock. Idempotent on (organization, packKey).
   */
  static async processVerticalPackPurchase(session: Stripe.Checkout.Session): Promise<void> {
    try {
      const { organizationId, packKey, interval } = session.metadata || {};
      if (!organizationId || !packKey) {
        logger.error('[webhook] vertical_pack session missing organizationId/packKey metadata');
        return;
      }
      const orgId = parseInt(organizationId, 10);
      if (!Number.isFinite(orgId)) return;

      const { VERTICAL_PACKS, packPriceCents } = await import('@shared/billing/tier-pricing');
      const pack = (VERTICAL_PACKS as Record<string, { key: string }>)[packKey];
      if (!pack) {
        logger.error(`[webhook] vertical_pack session names unknown pack '${packKey}'`);
        return;
      }
      const billingInterval = interval === 'yearly' ? 'yearly' : 'monthly';
      const priceCents = packPriceCents(packKey as never, billingInterval as never);

      // Resolve the subscription's item id for later per-item management.
      let subscriptionItemId: string | null = null;
      try {
        const subId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
        if (subId) {
          const stripe = await getUncachableStripeClient();
          const sub = await stripe.subscriptions.retrieve(subId);
          subscriptionItemId = sub.items?.data?.[0]?.id ?? subId;
        }
      } catch {
        subscriptionItemId = null; // best-effort — activation must not fail on this
      }

      const { orgVerticalPacks } = await import('@shared/schema');
      await db
        .insert(orgVerticalPacks)
        .values({
          organizationId: orgId,
          packKey,
          status: 'active',
          activatedAt: new Date(),
          billingInterval,
          priceCents,
          stripeSubscriptionItemId: subscriptionItemId,
          notes: `Activated via checkout session ${session.id}`,
        })
        .onConflictDoUpdate({
          target: [orgVerticalPacks.organizationId, orgVerticalPacks.packKey],
          set: {
            status: 'active',
            activatedAt: new Date(),
            cancelledAt: null,
            cancelAt: null,
            billingInterval,
            priceCents,
            stripeSubscriptionItemId: subscriptionItemId,
            updatedAt: new Date(),
          },
        });

      logger.info(`[webhook] vertical pack activated: org ${orgId}, pack ${packKey} (${billingInterval})`);
    } catch (err) {
      logger.error('[webhook] Error processing vertical pack purchase', err instanceof Error ? err : undefined);
      throw err;
    }
  }

  /** Mark a vertical pack cancelled from its subscription's metadata. */
  static async cancelVerticalPack(subscription: Stripe.Subscription): Promise<void> {
    try {
      const { organizationId, packKey } = subscription.metadata || {};
      const orgId = parseInt(organizationId ?? '', 10);
      if (!Number.isFinite(orgId) || !packKey) return;
      const { orgVerticalPacks } = await import('@shared/schema');
      const { and, eq } = await import('drizzle-orm');
      await db
        .update(orgVerticalPacks)
        .set({ status: 'cancelled', cancelledAt: new Date(), updatedAt: new Date() })
        .where(and(eq(orgVerticalPacks.organizationId, orgId), eq(orgVerticalPacks.packKey, packKey)));
      logger.info(`[webhook] vertical pack cancelled: org ${orgId}, pack ${packKey}`);
    } catch (err) {
      logger.error('[webhook] Error cancelling vertical pack', err instanceof Error ? err : undefined);
    }
  }

  static async processBorrowerPortalPayment(session: Stripe.Checkout.Session): Promise<void> {
    try {
      const { noteId, accessToken, paymentAmount } = session.metadata || {};
      
      if (!noteId || !accessToken) {
        logger.error('Missing noteId or accessToken in session metadata');
        return;
      }

      const note = await storage.getNoteByAccessToken(accessToken);
      if (!note) {
        logger.error(`Note not found for accessToken: ${accessToken}`);
        return;
      }

      // Security: Verify the session ID matches what was stored when payment was initiated
      // This prevents replay attacks and ensures payment was actually created for this note
      if (note.pendingCheckoutSessionId !== session.id) {
        logger.error(`Session ID mismatch for note ${note.id}. Expected: ${note.pendingCheckoutSessionId}, Got: ${session.id}`);
        return;
      }

      const existingPayments = await storage.getPayments(note.organizationId, note.id);
      const alreadyRecorded = existingPayments.some(p => p.transactionId === session.id);
      if (alreadyRecorded) {
        logger.info(`Payment already recorded for session: ${session.id}`);
        return;
      }

      const amount = session.amount_total ? session.amount_total / 100 : Number(paymentAmount || note.monthlyPayment);

      const schedule = note.amortizationSchedule || [];
      const nextPendingPayment = schedule.find(s => s.status === 'pending');

      let principalAmount = 0;
      let interestAmount = 0;

      if (nextPendingPayment) {
        const ratio = amount / nextPendingPayment.payment;
        principalAmount = Number((nextPendingPayment.principal * ratio).toFixed(2));
        interestAmount = Number((nextPendingPayment.interest * ratio).toFixed(2));
      } else {
        const monthlyRate = Number(note.interestRate) / 100 / 12;
        interestAmount = Number((Number(note.currentBalance) * monthlyRate).toFixed(2));
        principalAmount = Number((amount - interestAmount).toFixed(2));
        if (principalAmount < 0) principalAmount = 0;
      }

      // Process payment + note update in a single transaction (see storage.createPayment)
      // The transactional createPayment handles balance update with optimistic locking
      await storage.createPayment({
        organizationId: note.organizationId,
        noteId: note.id,
        amount: amount.toString(),
        principalAmount: principalAmount.toString(),
        interestAmount: interestAmount.toString(),
        feeAmount: "0",
        lateFeeAmount: "0",
        paymentDate: new Date(),
        dueDate: note.nextPaymentDate || new Date(),
        paymentMethod: 'card',
        transactionId: session.id,
        status: 'completed',
      });

      // Update schedule and next payment date (non-financial fields, safe outside payment tx)
      const newBalance = Math.max(0, Number(note.currentBalance) - principalAmount);

      let updatedSchedule = schedule;
      if (nextPendingPayment) {
        updatedSchedule = schedule.map(s =>
          s.paymentNumber === nextPendingPayment.paymentNumber
            ? { ...s, status: 'paid' }
            : s
        );
      }

      const nextPaymentDate = addMonths(new Date(note.nextPaymentDate || new Date()), 1);

      await storage.updateNote(note.id, {
        amortizationSchedule: updatedSchedule,
        nextPaymentDate: nextPaymentDate,
        pendingCheckoutSessionId: null, // Clear after successful payment
      }, note.organizationId);

      logger.info(`Borrower portal payment processed: Note ${note.id}, Amount: $${amount}, New Balance: $${newBalance}`);

      // Send payment receipt email to borrower.
      //
      // WHO COLLECTED IT. The charge is a direct charge on the lender's own
      // connected processor (founder ruling 2026-07-29, "be the rail, not the
      // provider") — AcreOS never held this money and took no cut of it. The
      // receipt says so, and names the lender when the org has a name on file;
      // it degrades to "your lender" rather than inventing one.
      try {
        const { emailService } = await import('./services/emailService');
        const borrower = note.borrowerId ? await storage.getLead(note.organizationId, note.borrowerId) : null;
        const borrowerEmail = borrower?.email;
        if (borrowerEmail) {
          const nextDue = nextPaymentDate.toLocaleDateString();
          const lenderOrg = await storage.getOrganization(note.organizationId);
          const collector = lenderOrg?.name?.trim() || 'your lender';
          const custodyLine = `This payment was collected by ${collector}. AcreOS is the software your lender uses — it doesn't hold your payment or take a share of it.`;
          const receiptResult = await emailService.sendEmail({
            // COUNTERPARTY (founder decision 2026-07-17). The lender org owns
            // this message — it is their borrower (storage.getLead(
            // note.organizationId, note.borrowerId)), their charge on their own
            // connected processor, their identity. The body already says
            // "AcreOS is the software your lender uses", which only stays true
            // if the mail leaves under the lender's identity rather than the
            // platform's. No connected identity → honest refusal, no @acreos.io
            // fallback.
            organizationId: note.organizationId,
            purpose: 'counterparty',
            to: borrowerEmail,
            subject: `Payment Receipt — $${amount.toFixed(2)}`,
            html: `
              <h2>Payment Receipt</h2>
              <p>Thank you for your payment.</p>
              <ul>
                <li><strong>Amount Paid:</strong> $${amount.toFixed(2)}</li>
                <li><strong>Paid To:</strong> ${collector}</li>
                <li><strong>Payment Date:</strong> ${new Date().toLocaleDateString()}</li>
                <li><strong>Remaining Balance:</strong> $${newBalance.toFixed(2)}</li>
                <li><strong>Next Payment Due:</strong> ${newBalance <= 0 ? 'Paid in full!' : nextDue}</li>
              </ul>
              <p>${custodyLine}</p>
              <p>If you have questions about your account, please contact your lender.</p>
            `,
            text: `Payment Receipt\n\nAmount Paid: $${amount.toFixed(2)}\nPaid To: ${collector}\nPayment Date: ${new Date().toLocaleDateString()}\nRemaining Balance: $${newBalance.toFixed(2)}\nNext Payment Due: ${newBalance <= 0 ? 'Paid in full!' : nextDue}\n\n${custodyLine}`,
          });
          // sendEmail RETURNS a refusal (it does not throw), so the catch below
          // never sees one. Log what actually happened — the payment itself is
          // already recorded and must not be rolled back for a mail failure.
          if (receiptResult.success) {
            logger.info(`[webhook] Payment receipt sent to ${borrowerEmail}`);
          } else {
            logger.warn('[webhook] Payment receipt NOT sent — borrower has no receipt', {
              metadata: {
                organizationId: note.organizationId,
                noteId: note.id,
                errorType: receiptResult.errorType,
                error: receiptResult.error,
              },
            });
          }
        }
      } catch (emailErr) {
        logger.warn('[webhook] Could not send payment receipt email', emailErr instanceof Error ? emailErr : undefined);
      }
    } catch (err) {
      logger.error('Error processing borrower portal payment', err instanceof Error ? err : undefined);
      throw err;
    }
  }

  /**
   * A borrower's card payment was REFUNDED on the lender's own connected
   * account (`charge.refunded`, Connect endpoint).
   *
   * ── WHY THIS EXISTS ───────────────────────────────────────────────────────
   * SCOPE, precisely: the PLATFORM dispatcher in this file already handled
   * both `charge.refunded` (→ processChargeRefunded, which reverses AcreOS's
   * OWN subscription revenue recognition) and `charge.dispute.*` (→
   * processChargeDispute). Neither touches a borrower's note ledger, and
   * neither ever saw these events: a borrower's card payment is a DIRECT
   * charge on the LENDER'S connected account, so its `charge.refunded`
   * arrives at the CONNECT endpoint and is dispatched by
   * stripeConnect.handleWebhookEvent — whose switch had no refund branch.
   * There it hit `default:` and logged "Unhandled Stripe webhook event": the
   * `payments` row this webhook's sibling (processBorrowerPortalPayment →
   * storage.createPayment) had written stood, the note balance stayed
   * reduced, and Form 1098 Box 1 reported mortgage interest the borrower
   * never ended up paying — filed with the IRS under that borrower's real
   * TIN.
   *
   * ── WHAT IT DOES ──────────────────────────────────────────────────────────
   *   1. resolves the Checkout Session behind the charge ON THE LENDER'S
   *      ACCOUNT (the charge is direct; an unscoped lookup finds nothing);
   *   2. finds the ledger row that session wrote;
   *   3. APPENDS one negative row per refund — history is preserved, never
   *      rewritten — proportioned across principal / interest / fees;
   *   4. restores the principal to the note balance under the same optimistic
   *      lock the payment path uses.
   *
   * Refusals, never guesses: if the session, the org, or the original row
   * cannot be identified, it writes NOTHING and logs what is missing. A Stripe
   * API failure is allowed to THROW — the connect webhook route releases its
   * idempotency claim and returns 500, so Stripe redelivers. Swallowing it
   * would leave the ledger permanently overstating interest received.
   */
  static async processBorrowerPaymentRefund(
    charge: Stripe.Charge,
    connectedAccountId: string | null,
  ): Promise<void> {
    const refundedCents = charge.amount_refunded ?? 0;
    if (refundedCents <= 0) {
      logger.info(`[webhook] charge.refunded carried no refunded amount — nothing to reverse (charge ${charge.id})`);
      return;
    }

    const paymentIntentId =
      typeof charge.payment_intent === 'string'
        ? charge.payment_intent
        : charge.payment_intent?.id ?? null;

    if (!connectedAccountId || !paymentIntentId) {
      logger.error(
        '[webhook] Refund cannot be matched to a borrower payment — the ledger may now overstate interest received',
        new Error(
          `charge=${charge.id} missing=${!connectedAccountId ? 'connectedAccount' : 'paymentIntent'}`,
        ),
      );
      return;
    }

    const { customerMoneyReadOptions } = await import('./services/customerMoneyRouting');
    const { refundReversalTransactionId } = await import('./services/form1098Batch');
    const stripe = await getUncachableStripeClient();

    // Scoped to the lender's account — the charge lives there, not in AcreOS's.
    const sessions = await stripe.checkout.sessions.list(
      { payment_intent: paymentIntentId, limit: 10 },
      customerMoneyReadOptions({ accountId: connectedAccountId }, 'borrower.card.refund.session.lookup'),
    );
    const session = sessions.data.find(
      (s: Stripe.Checkout.Session) => s.metadata?.type === 'borrower_portal_payment',
    );
    if (!session) {
      // Lenders refund their OWN unrelated charges on this account all the
      // time. Not ours, nothing to reverse.
      logger.info(`[webhook] Refund on charge ${charge.id} is not a borrower portal payment — no note ledger to reverse`);
      return;
    }

    const { payments, notes } = await import('@shared/schema');
    const { and, eq: eqOp, like } = await import('drizzle-orm');

    const [original] = await db
      .select()
      .from(payments)
      .where(eqOp(payments.transactionId, session.id))
      .limit(1);

    if (!original) {
      logger.error(
        '[webhook] Refund of a borrower payment AcreOS never recorded — no ledger row to reverse',
        new Error(`checkoutSession=${session.id} charge=${charge.id}`),
      );
      return;
    }

    const sessionOrgId = Number(session.metadata?.organizationId ?? NaN);
    if (Number.isFinite(sessionOrgId) && sessionOrgId !== original.organizationId) {
      logger.error(
        '[webhook] Refund org mismatch between the checkout session and the ledger row — refusing to write',
        new Error(`checkoutSession=${session.id} sessionOrg=${sessionOrgId} ledgerOrg=${original.organizationId}`),
      );
      return;
    }

    const toCents = (v: string | null | undefined): number => {
      const n = parseFloat(v ?? '0');
      return Number.isFinite(n) ? Math.round(n * 100) : 0;
    };

    // Reversals already on the ledger for THIS payment. The link lives in the
    // unique transaction id (see form1098Batch's reversal-link helpers), which
    // is what makes redelivery idempotent without a schema column.
    const reversalPrefix = refundReversalTransactionId(session.id, '');
    const existingReversals = (
      await db
        .select({ transactionId: payments.transactionId, amount: payments.amount })
        .from(payments)
        .where(
          and(
            eqOp(payments.noteId, original.noteId),
            like(payments.transactionId, `${reversalPrefix}%`),
          ),
        )
    // `_` is a LIKE wildcard and Stripe ids are full of them, so the SQL
    // prefix is a coarse filter; this is the exact one.
    ).filter((r) => r.transactionId?.startsWith(reversalPrefix));
    const existingTxIds = new Set(
      existingReversals.map((r) => r.transactionId).filter((t): t is string => Boolean(t)),
    );
    const alreadyReversedCents = existingReversals.reduce((sum, r) => sum + Math.abs(toCents(r.amount)), 0);

    // Prefer the refund objects on the event: each has its own id, amount and
    // timestamp, so partial refunds post individually and idempotently.
    let refundFacts: StripeRefundFact[] = (charge.refunds?.data ?? [])
      .filter((r) => (r.status ?? 'succeeded') === 'succeeded' && (r.amount ?? 0) > 0)
      .map((r) => ({
        id: r.id,
        amountCents: r.amount,
        createdIso: new Date((r.created ?? charge.created) * 1000).toISOString(),
      }));

    const alreadyReversedRefundIds = new Set<string>(
      refundFacts.filter((f) => existingTxIds.has(refundReversalTransactionId(session.id, f.id))).map((f) => f.id),
    );

    if (refundFacts.length === 0) {
      // The event did not expand the refund list (it is a paginated sub-list).
      // Fall back to the CUMULATIVE `amount_refunded`, and feed the portion we
      // already reversed in as a sentinel so the proportional split is taken
      // against the true running total and only the delta posts.
      const sentinelId = `${charge.id}:already-reversed`;
      const createdIso = new Date(charge.created * 1000).toISOString();
      if (alreadyReversedCents > 0) {
        refundFacts.push({ id: sentinelId, amountCents: alreadyReversedCents, createdIso });
        alreadyReversedRefundIds.add(sentinelId);
      }
      const deltaCents = refundedCents - alreadyReversedCents;
      if (deltaCents > 0) {
        refundFacts.push({ id: `${charge.id}:refunded:${refundedCents}`, amountCents: deltaCents, createdIso });
      }
    }

    const reversals = deriveRefundReversals({
      original: {
        amountCents: toCents(original.amount),
        principalCents: toCents(original.principalAmount),
        interestCents: toCents(original.interestAmount),
        feeCents: toCents(original.feeAmount),
        lateFeeCents: toCents(original.lateFeeAmount),
      },
      refunds: refundFacts,
      alreadyReversedRefundIds,
    });

    if (reversals.length === 0) {
      logger.info(`[webhook] Refund on charge ${charge.id} was already reversed on the ledger — nothing to post`);
      return;
    }

    const restoredPrincipalCents = await withTransaction(async (tx) => {
      let restored = 0;
      for (const rev of reversals) {
        const inserted = await tx
          .insert(payments)
          .values({
            organizationId: original.organizationId,
            noteId: original.noteId,
            amount: (rev.amountCents / 100).toString(),
            principalAmount: (rev.principalCents / 100).toString(),
            interestAmount: (rev.interestCents / 100).toString(),
            feeAmount: (rev.feeCents / 100).toString(),
            lateFeeAmount: (rev.lateFeeCents / 100).toString(),
            paymentDate: rev.postedAt,
            // Same period as the payment it reverses.
            dueDate: original.dueDate,
            paymentMethod: 'card_refund',
            transactionId: refundReversalTransactionId(session.id, rev.refundId),
            // 'completed' means POSTED, not "money received". The tax
            // collectors read only posted rows, so a reversal that is not
            // marked completed would never reach Form 1098 and Box 1 would go
            // on reporting interest that was handed back.
            status: 'completed',
            failureReason: `Refunded on the lender's Stripe account (refund ${rev.refundId})`,
            processedAt: rev.postedAt,
          })
          // No conflict TARGET on purpose: `payments.transaction_id` is
          // unique via a PARTIAL index (migration 0023, `WHERE transaction_id
          // IS NOT NULL`), and Postgres cannot infer a partial index from a
          // bare column list — an inferred target would raise "no unique or
          // exclusion constraint matching the ON CONFLICT specification",
          // 500 the webhook, and have Stripe retry it forever. The pre-check
          // above is the primary idempotency guard; this is the race backstop.
          .onConflictDoNothing()
          .returning();
        if (inserted.length === 0) continue; // already posted by a redelivery
        restored += -rev.principalCents;
      }

      if (restored !== 0) {
        const [locked] = await tx
          .select()
          .from(notes)
          .where(eqOp(notes.id, original.noteId))
          .for('update');
        if (locked) {
          const newBalance = Number(locked.currentBalance) + restored / 100;
          const updated = await tx
            .update(notes)
            .set({
              currentBalance: String(Math.max(0, newBalance)),
              // A refund can un-pay-off a note. Leaving it 'paid_off' would
              // tell the lender a balance they are still owed is settled.
              //
              // ONLY 'paid_off' may be lifted, and the guard is the whole
              // point: `newBalance > 0 ? 'active' : …` would ALSO reset a
              // note sitting in 'late', 'delinquent' or 'defaulted' back to
              // 'active', silently clearing a delinquency state the product
              // reads as truth (routes-finance.ts reads 'defaulted';
              // routes-today.ts reads 'late'/'delinquent'). A refund says
              // nothing about whether the borrower is current. Same guard,
              // same reason, as achAutopay.ts's ACH-return reversal.
              status:
                newBalance > 0 && locked.status === 'paid_off'
                  ? 'active'
                  : locked.status,
              version: (locked.version ?? 1) + 1,
              updatedAt: new Date(),
            })
            .where(and(eqOp(notes.id, original.noteId), eqOp(notes.version, locked.version ?? 1)))
            .returning();
          if (updated.length === 0) {
            throw new Error(`Optimistic lock conflict on note ${original.noteId} while reversing refund ${charge.id}`);
          }
        }
      }
      return restored;
    });

    logger.info('[webhook] Borrower card refund reversed on the note ledger', {
      metadata: {
        organizationId: original.organizationId,
        noteId: original.noteId,
        chargeId: charge.id,
        reversalRows: reversals.length,
        reversedInterestCents: reversals.reduce((s, r) => s + -r.interestCents, 0),
        restoredPrincipalCents,
      },
    });
  }

  /**
   * Handle charge dispute events (created, updated, closed).
   * Logs dispute details and creates a system alert for the founder.
   */
  static async processChargeDispute(eventType: string, dispute: Stripe.Dispute): Promise<void> {
    try {
      const amount = dispute.amount ? (dispute.amount / 100).toFixed(2) : 'unknown';
      const reason = dispute.reason || 'unknown';
      const status = dispute.status || 'unknown';
      const chargeId = typeof dispute.charge === 'string' ? dispute.charge : dispute.charge?.id || 'unknown';

      logger.warn(`[webhook] Charge dispute ${eventType}: dispute=${dispute.id}, charge=${chargeId}, amount=$${amount}, reason=${reason}, status=${status}`);

      const severityMap: Record<string, 'critical' | 'warning' | 'info'> = {
        'charge.dispute.created': 'critical',
        'charge.dispute.updated': 'warning',
        'charge.dispute.closed': 'info',
      };

      const titleMap: Record<string, string> = {
        'charge.dispute.created': `New charge dispute: $${amount}`,
        'charge.dispute.updated': `Charge dispute updated: $${amount}`,
        'charge.dispute.closed': `Charge dispute closed: $${amount}`,
      };

      await storage.createSystemAlert({
        organizationId: null as any, // Platform-wide alert for founder
        type: 'charge_dispute',
        severity: severityMap[eventType] || 'warning',
        title: titleMap[eventType] || `Charge dispute event: ${eventType}`,
        message: `Dispute ${dispute.id} on charge ${chargeId} for $${amount}. Reason: ${reason}. Status: ${status}.`,
        metadata: {
          disputeId: dispute.id,
          chargeId,
          amount: dispute.amount,
          reason,
          status,
          eventType,
        },
      });
    } catch (err) {
      logger.error(`Error processing charge dispute event (${eventType})`, err instanceof Error ? err : undefined);
    }
  }
}
