import { getUncachableStripeClient, getStripeSecretKey } from './stripeClient';
import { storage, db } from './storage';
import { creditService } from './services/credits';
import { CreditPackId, stripeProcessedEvents } from '@shared/schema';
import { eq } from 'drizzle-orm';
import Stripe from 'stripe';

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
      console.warn(`[webhook] Failed to record processed event ${eventId}:`, err);
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
      console.log(`[webhook] Skipping duplicate event: ${event.id} (${event.type})`);
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

    if (event.type === 'customer.subscription.updated') {
      const subscription = event.data.object as Stripe.Subscription;
      await WebhookHandlers.processSubscriptionUpdated(subscription);
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
    console.log(`[webhook] Unhandled Stripe event type: ${event.type}`);
    await WebhookHandlers.markProcessed(event.id, event.type);
  }

  static async processPaymentFailed(invoice: Stripe.Invoice): Promise<void> {
    try {
      const customerId = typeof invoice.customer === 'string' 
        ? invoice.customer 
        : invoice.customer?.id;
      
      if (!customerId) {
        console.error('No customer ID on failed invoice');
        return;
      }

      // Find org by stripe customer ID
      const org = await storage.getOrganizationByStripeCustomerId(customerId);
      if (!org) {
        console.log(`No organization found for Stripe customer: ${customerId}`);
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

      console.log(`Payment failed processed: Org ${org.id}, Invoice ${invoice.id}, Amount: $${invoice.amount_due / 100}`);
    } catch (err) {
      console.error('Error processing payment failed:', err);
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

        console.log(`Payment succeeded, dunning resolved: Org ${org.id}, Amount: $${invoice.amount_paid / 100}`);
      }
    } catch (err) {
      console.error('Error processing payment succeeded:', err);
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

      console.log(`Subscription cancelled: Org ${org.id}`);
    } catch (err) {
      console.error('Error processing subscription cancelled:', err);
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
      console.log(`[webhook] Subscription updated: Org ${org.id}, Status: ${subscription.status}${newTier ? `, Tier: ${newTier}` : ''}`);

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
      console.error('Error processing subscription updated:', err);
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

      console.log(`[webhook] Trial ending soon alert created: Org ${org.id}`);
    } catch (err) {
      console.error('Error processing trial_will_end:', err);
    }
  }

  static async processCreditPurchase(session: Stripe.Checkout.Session): Promise<void> {
    try {
      const { organizationId, packId } = session.metadata || {};
      
      if (!organizationId || !packId) {
        console.error('Missing organizationId or packId in credit purchase session metadata');
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

      console.log(`Credit purchase processed: Org ${orgId}, Pack ${packId}, Credits added: ${transaction.amountCents} cents`);
    } catch (err) {
      console.error('Error processing credit purchase:', err);
      throw err;
    }
  }

  static async processBorrowerPortalPayment(session: Stripe.Checkout.Session): Promise<void> {
    try {
      const { noteId, accessToken, paymentAmount } = session.metadata || {};
      
      if (!noteId || !accessToken) {
        console.error('Missing noteId or accessToken in session metadata');
        return;
      }

      const note = await storage.getNoteByAccessToken(accessToken);
      if (!note) {
        console.error(`Note not found for accessToken: ${accessToken}`);
        return;
      }

      // Security: Verify the session ID matches what was stored when payment was initiated
      // This prevents replay attacks and ensures payment was actually created for this note
      if (note.pendingCheckoutSessionId !== session.id) {
        console.error(`Session ID mismatch for note ${note.id}. Expected: ${note.pendingCheckoutSessionId}, Got: ${session.id}`);
        return;
      }

      const existingPayments = await storage.getPayments(note.organizationId, note.id);
      const alreadyRecorded = existingPayments.some(p => p.transactionId === session.id);
      if (alreadyRecorded) {
        console.log(`Payment already recorded for session: ${session.id}`);
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

      console.log(`Borrower portal payment processed: Note ${note.id}, Amount: $${amount}, New Balance: $${newBalance}`);
    } catch (err) {
      console.error('Error processing borrower portal payment:', err);
      throw err;
    }
  }
}
