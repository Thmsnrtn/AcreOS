import { getUncachableStripeClient, getStripeSecretKey } from './stripeClient';
import { storage, db } from './storage';
import { creditService } from './services/credits';
import { CreditPackId, stripeProcessedEvents } from '@shared/schema';
import { eq } from 'drizzle-orm';
import Stripe from 'stripe';
import { logger } from './utils/logger';

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
   * Check if this event has already been processed (idempotency).
   * Returns true if already processed.
   */
  private static async isDuplicate(eventId: string): Promise<boolean> {
    try {
      const [existing] = await db
        .select({ id: stripeProcessedEvents.id })
        .from(stripeProcessedEvents)
        .where(eq(stripeProcessedEvents.stripeEventId, eventId))
        .limit(1);
      return !!existing;
    } catch {
      // Table may not exist yet during migration — allow processing
      return false;
    }
  }

  /**
   * Record that an event has been processed.
   */
  private static async markProcessed(eventId: string, eventType: string): Promise<void> {
    try {
      await db.insert(stripeProcessedEvents).values({
        stripeEventId: eventId,
        eventType,
      }).onConflictDoNothing();
    } catch (err) {
      // Non-fatal — log and continue
      logger.warn(`[webhook] Failed to record processed event ${eventId}`, err instanceof Error ? err : undefined);
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

    // Idempotency: skip already-processed events
    if (await WebhookHandlers.isDuplicate(event.id)) {
      logger.info(`[webhook] Skipping duplicate event: ${event.id} (${event.type})`);
      return;
    }

    // Handle checkout session completed
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      
      if (session.metadata?.type === 'borrower_portal_payment') {
        await WebhookHandlers.processBorrowerPortalPayment(session);
        await WebhookHandlers.markProcessed(event.id, event.type);
        return;
      }
      
      if (session.metadata?.type === 'credit_purchase') {
        await WebhookHandlers.processCreditPurchase(session);
        await WebhookHandlers.markProcessed(event.id, event.type);
        return;
      }

      // Subscription checkout — eagerly record the subscription ID so the org
      // is updated even if customer.subscription.updated fires before we process it.
      if (session.mode === 'subscription' && session.subscription) {
        await WebhookHandlers.processSubscriptionCheckoutCompleted(session);
        await WebhookHandlers.markProcessed(event.id, event.type);
        return;
      }
    }

    // Handle invoice payment failed - trigger dunning
    if (event.type === 'invoice.payment_failed') {
      const invoice = event.data.object as Stripe.Invoice;
      await WebhookHandlers.processPaymentFailed(invoice);
      await WebhookHandlers.markProcessed(event.id, event.type);
      return;
    }

    // Handle invoice payment succeeded - resolve dunning
    if (event.type === 'invoice.payment_succeeded') {
      const invoice = event.data.object as Stripe.Invoice;
      await WebhookHandlers.processPaymentSucceeded(invoice);
      await WebhookHandlers.markProcessed(event.id, event.type);
      return;
    }

    // Handle subscription lifecycle
    if (event.type === 'customer.subscription.deleted') {
      const subscription = event.data.object as Stripe.Subscription;
      await WebhookHandlers.processSubscriptionCancelled(subscription);
      await WebhookHandlers.markProcessed(event.id, event.type);
      return;
    }

    // customer.subscription.created fires when any new subscription is created.
    // Reuse processSubscriptionUpdated since the payload shape is identical.
    if (event.type === 'customer.subscription.created') {
      const subscription = event.data.object as Stripe.Subscription;
      await WebhookHandlers.processSubscriptionUpdated(subscription);
      await WebhookHandlers.markProcessed(event.id, event.type);
      return;
    }

    if (event.type === 'customer.subscription.updated') {
      const subscription = event.data.object as Stripe.Subscription;
      await WebhookHandlers.processSubscriptionUpdated(subscription);
      await WebhookHandlers.markProcessed(event.id, event.type);
      return;
    }

    if (event.type === 'customer.subscription.paused') {
      const subscription = event.data.object as Stripe.Subscription;
      await WebhookHandlers.processSubscriptionPaused(subscription);
      await WebhookHandlers.markProcessed(event.id, event.type);
      return;
    }

    if (event.type === 'customer.subscription.resumed') {
      const subscription = event.data.object as Stripe.Subscription;
      await WebhookHandlers.processSubscriptionResumed(subscription);
      await WebhookHandlers.markProcessed(event.id, event.type);
      return;
    }

    if (event.type === 'invoice.paid') {
      const invoice = event.data.object as Stripe.Invoice;
      await WebhookHandlers.processInvoicePaid(invoice);
      await WebhookHandlers.markProcessed(event.id, event.type);
      return;
    }

    if (event.type === 'customer.subscription.trial_will_end') {
      const subscription = event.data.object as Stripe.Subscription;
      await WebhookHandlers.processTrialWillEnd(subscription);
      await WebhookHandlers.markProcessed(event.id, event.type);
      return;
    }

    // Unhandled event type — log and acknowledge
    logger.info(`[webhook] Unhandled Stripe event type: ${event.type}`);
    await WebhookHandlers.markProcessed(event.id, event.type);
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

      await storage.updateOrganization(organizationId, {
        stripeSubscriptionId: subscriptionId,
        subscriptionStatus: 'active',
        trialUsed: true, // Mark here, not at checkout creation — abandoned checkouts must not consume the trial
      });

      logger.info(`[webhook] Subscription checkout completed: Org ${organizationId}, sub ${subscriptionId}`);

      // Send subscription welcome email
      try {
        const { emailService } = await import('./services/emailService');
        const org = await storage.getOrganization(organizationId);
        if (org) {
          const tierName = (org.subscriptionTier || 'starter').charAt(0).toUpperCase() + (org.subscriptionTier || 'starter').slice(1);
          const tierLimits: Record<string, { leads: string; properties: string; ai: string }> = {
            sprout: { leads: '50', properties: '10', ai: '25/month' },
            starter: { leads: '200', properties: '50', ai: '100/month' },
            pro: { leads: '1,000', properties: '250', ai: '500/month' },
            scale: { leads: '5,000', properties: '1,000', ai: '2,000/month' },
            enterprise: { leads: 'Unlimited', properties: 'Unlimited', ai: 'Unlimited' },
          };
          const limits = tierLimits[org.subscriptionTier || 'starter'] || tierLimits.starter;

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
                <p><a href="${process.env.APP_URL || 'https://app.acreos.com'}">Go to your dashboard</a></p>
                <p>— The AcreOS Team</p>
              `,
              text: `Welcome to AcreOS ${tierName}!\n\nYour plan includes:\n- Leads: ${limits.leads}\n- Properties: ${limits.properties}\n- AI Requests: ${limits.ai}\n\nGo to your dashboard: ${process.env.APP_URL || 'https://app.acreos.com'}`,
            });
            logger.info(`[webhook] Welcome email sent to ${userEmail} for ${tierName} plan`);
          }
        }
      } catch (emailErr) {
        logger.warn('[webhook] Could not send subscription welcome email (email service may not be configured)', emailErr instanceof Error ? emailErr : undefined);
      }
    } catch (err) {
      logger.error('[webhook] Error processing subscription checkout', err instanceof Error ? err : undefined);
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

      const subscriptionId = (invoice as any).subscription 
        ? (typeof (invoice as any).subscription === 'string' ? (invoice as any).subscription : (invoice as any).subscription?.id)
        : '';

      const { dunningService } = await import('./services/dunning');
      await dunningService.handlePaymentFailed(
        org.id,
        invoice.id,
        subscriptionId || '',
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
      const customerId = typeof subscription.customer === 'string'
        ? subscription.customer
        : subscription.customer?.id;

      if (!customerId) return;

      const org = await storage.getOrganizationByStripeCustomerId(customerId);
      if (!org) return;

      const previousTier = org.subscriptionTier || 'free';

      // Update org to free tier
      await storage.updateOrganization(org.id, {
        subscriptionTier: 'free',
        subscriptionStatus: 'cancelled',
        dunningStage: 'cancelled',
        stripeSubscriptionId: null,
      });

      // Log the subscription cancel event
      await storage.logSubscriptionEvent({
        organizationId: org.id,
        eventType: 'cancel',
        fromTier: previousTier,
        toTier: null,
      });

      logger.info(`Subscription cancelled: Org ${org.id}`);
    } catch (err) {
      logger.error('Error processing subscription cancelled', err instanceof Error ? err : undefined);
    }
  }

  /**
   * Handle subscription plan changes (upgrades/downgrades, status changes).
   */
  static async processSubscriptionUpdated(subscription: Stripe.Subscription): Promise<void> {
    try {
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

      // Determine tier from product metadata
      const priceId = subscription.items?.data?.[0]?.price?.id;
      let newTier: string | undefined;

      if (priceId) {
        const stripe = await getUncachableStripeClient();
        const price = await stripe.prices.retrieve(priceId, { expand: ['product'] });
        const product = price.product as Stripe.Product;
        newTier = product.metadata?.tier;
      }

      const updates: Record<string, any> = {
        subscriptionStatus: statusMap[subscription.status] || subscription.status,
        stripeSubscriptionId: subscription.id,
      };

      if (newTier) {
        const previousTier = org.subscriptionTier;
        updates.subscriptionTier = newTier;

        if (previousTier !== newTier) {
          await storage.logSubscriptionEvent({
            organizationId: org.id,
            eventType: 'change',
            fromTier: previousTier,
            toTier: newTier,
          });
        }
      }

      await storage.updateOrganization(org.id, updates);
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
      logger.error('Error processing subscription updated', err instanceof Error ? err : undefined);
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

      await storage.updateOrganization(org.id, {
        subscriptionStatus: 'paused',
      });

      await storage.logSubscriptionEvent({
        organizationId: org.id,
        eventType: 'pause',
        fromTier: org.subscriptionTier || 'free',
        toTier: null,
      });

      logger.info(`[webhook] Subscription paused: Org ${org.id}`);
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
    } catch (err) {
      logger.error('Error processing invoice paid', err instanceof Error ? err : undefined);
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

      const newBalance = Math.max(0, Number(note.currentBalance) - principalAmount);

      let updatedSchedule = schedule;
      if (nextPendingPayment) {
        updatedSchedule = schedule.map(s =>
          s.paymentNumber === nextPendingPayment.paymentNumber
            ? { ...s, status: 'paid' }
            : s
        );
      }

      const nextPaymentDate = new Date(note.nextPaymentDate || new Date());
      nextPaymentDate.setMonth(nextPaymentDate.getMonth() + 1);

      await storage.updateNote(note.id, {
        currentBalance: newBalance.toString(),
        amortizationSchedule: updatedSchedule,
        nextPaymentDate: nextPaymentDate,
        status: newBalance <= 0 ? 'paid_off' : 'active',
        pendingCheckoutSessionId: null, // Clear after successful payment
      });

      logger.info(`Borrower portal payment processed: Note ${note.id}, Amount: $${amount}, New Balance: $${newBalance}`);

      // Send payment receipt email to borrower
      try {
        const { emailService } = await import('./services/emailService');
        const borrower = note.borrowerId ? await storage.getLead(note.organizationId, note.borrowerId) : null;
        const borrowerEmail = borrower?.email;
        if (borrowerEmail) {
          const nextDue = nextPaymentDate.toLocaleDateString();
          await emailService.sendEmail({
            to: borrowerEmail,
            subject: `Payment Receipt — $${amount.toFixed(2)}`,
            html: `
              <h2>Payment Receipt</h2>
              <p>Thank you for your payment.</p>
              <ul>
                <li><strong>Amount Paid:</strong> $${amount.toFixed(2)}</li>
                <li><strong>Payment Date:</strong> ${new Date().toLocaleDateString()}</li>
                <li><strong>Remaining Balance:</strong> $${newBalance.toFixed(2)}</li>
                <li><strong>Next Payment Due:</strong> ${newBalance <= 0 ? 'Paid in full!' : nextDue}</li>
              </ul>
              <p>If you have questions about your account, please contact your lender.</p>
            `,
            text: `Payment Receipt\n\nAmount Paid: $${amount.toFixed(2)}\nPayment Date: ${new Date().toLocaleDateString()}\nRemaining Balance: $${newBalance.toFixed(2)}\nNext Payment Due: ${newBalance <= 0 ? 'Paid in full!' : nextDue}`,
          });
          logger.info(`[webhook] Payment receipt sent to ${borrowerEmail}`);
        }
      } catch (emailErr) {
        logger.warn('[webhook] Could not send payment receipt email', emailErr instanceof Error ? emailErr : undefined);
      }
    } catch (err) {
      logger.error('Error processing borrower portal payment', err instanceof Error ? err : undefined);
      throw err;
    }
  }
}
