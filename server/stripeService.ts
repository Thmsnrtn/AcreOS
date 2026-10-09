import type Stripe from 'stripe';
import { getUncachableStripeClient } from './stripeClient';
import crypto from 'crypto';
import { stripeCircuitBreaker } from './utils/circuitBreaker';
import { clock } from "./utils/clock";

/** Deterministic idempotency key for a given operation + seed. */
function idempotencyKey(operation: string, ...seeds: (string | number | undefined)[]): string {
  const data = [operation, ...seeds.map(String)].join(':');
  return crypto.createHash('sha256').update(data).digest('hex').slice(0, 64);
}

/**
 * The idempotency key of ONE credit purchase intent.
 *
 * It used to be customer + pack + org, so Stripe (which keeps keys 24h)
 * answered a second deliberate purchase of the same pack — a second $20 mail
 * pack the same afternoon — with the FIRST, already-paid session: the
 * customer could not buy the same pack twice in a day. The key now includes
 * the purchase intent: the client's Idempotency-Key for that purchase action
 * (it holds one key while a purchase is in flight, so a double-click sends
 * the same one), or, when a caller sends none, a 10-second window — wide
 * enough to fold a double-click, far narrower than any deliberate re-buy.
 */
export const CREDIT_CHECKOUT_DEDUPE_WINDOW_MS = 10_000;
const PURCHASE_INTENT_SHAPE = /^[A-Za-z0-9_-]{8,128}$/;
export function creditCheckoutIdempotencyKey(input: {
  customerId: string;
  packId: string;
  organizationId: string;
  purchaseIntent?: string | null;
  nowMs?: number;
}): string {
  const intent =
    typeof input.purchaseIntent === "string" && PURCHASE_INTENT_SHAPE.test(input.purchaseIntent)
      ? `intent:${input.purchaseIntent}`
      : `window:${Math.floor((input.nowMs ?? clock.nowMs()) / CREDIT_CHECKOUT_DEDUPE_WINDOW_MS)}`;
  return idempotencyKey("credit_checkout", input.customerId, input.packId, input.organizationId, intent);
}

export class StripeService {
  async createCustomer(email: string | null, userId: string, name?: string) {
    // users.email is nullable. A null email is omitted rather than sent as the
    // string "null" (surfaced 2026-09-28 when the `req.user as any` casts that
    // hid the nullability came off — DEFECT-0063).
    const customerEmail = email ?? undefined;
    const stripe = await getUncachableStripeClient();
    return await stripeCircuitBreaker.call(() =>
      stripe.customers.create(
        // `app: 'acreos'` namespaces the customer in the shared account (see
        // docs/stripe-shared-account.md); `userId` is our own back-reference.
        { email: customerEmail, name, metadata: { app: 'acreos', userId } },
        { idempotencyKey: idempotencyKey('create_customer', userId, customerEmail) }
      )
    );
  }

  async createCheckoutSession(
    customerId: string,
    priceId: string,
    successUrl: string,
    cancelUrl: string,
    metadata?: Record<string, string>,
    trialDays?: number,
    options?: {
      couponId?: string;
      allowPromoCodes?: boolean;
      enableAch?: boolean;
      subscriptionMetadata?: Record<string, string>;
      /**
       * The automatic-renewal terms (shared/billing/autoRenewalTerms.ts),
       * shown beside the pay button — Cal. Bus. & Prof. Code § 17602(a)(1)
       * wants them "in visual proximity" to the request for consent.
       */
      renewalTerms?: string;
    }
  ) {
    const stripe = await getUncachableStripeClient();
    // Pillar 8.5 — yearly checkout adds ACH. ACH costs ~$0.80 vs Stripe's
    // ~2.9% + $0.30 card fee → saves ~$18 on a $700 annual seat. Cards
    // remain the default on monthly because ACH adds 3-5 days of payment
    // settlement, which we don't want to interleave with monthly billing.
    const paymentMethodTypes: Stripe.Checkout.SessionCreateParams.PaymentMethodType[] =
      options?.enableAch ? ['card', 'us_bank_account'] : ['card'];
    const sessionConfig: any = {
      customer: customerId,
      payment_method_types: paymentMethodTypes,
      line_items: [{ price: priceId, quantity: 1 }],
      mode: 'subscription',
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata,
      // Phase 3 W10 — Stripe Tax automation. Stripe computes the correct
      // sales-tax/VAT rate per checkout based on the customer's billing
      // address. Pair with stripe.customers.update({ tax: { ... } }) when
      // org.taxAddress changes (see syncTaxAddressToStripe).
      automatic_tax: { enabled: true },
      // Required for automatic_tax — Stripe needs a billing address on the
      // session to determine taxability.
      customer_update: { address: 'auto', name: 'auto' },
      tax_id_collection: { enabled: true },
    };

    if (options?.renewalTerms) {
      // Stripe caps custom text at 1,200 characters.
      sessionConfig.custom_text = { submit: { message: options.renewalTerms.slice(0, 1200) } };
    }

    // Add trial period if specified (for first-time subscribers only)
    if (trialDays && trialDays > 0) {
      sessionConfig.subscription_data = {
        trial_period_days: trialDays,
      };
    }

    // Stamp metadata onto the SUBSCRIPTION itself (not just the session) so
    // later subscription.updated/deleted webhooks can tell what kind of
    // subscription this is (e.g. a vertical-pack add-on vs the org's plan).
    if (options?.subscriptionMetadata) {
      sessionConfig.subscription_data = {
        ...(sessionConfig.subscription_data ?? {}),
        metadata: options.subscriptionMetadata,
      };
    }


    // Apply a specific coupon (founder-set flash sale) or allow user-entered promo codes
    if (options?.couponId) {
      sessionConfig.discounts = [{ coupon: options.couponId }];
    } else if (options?.allowPromoCodes) {
      sessionConfig.allow_promotion_codes = true;
    }

    return await stripe.checkout.sessions.create(
      sessionConfig,
      { idempotencyKey: idempotencyKey('checkout_session', customerId, priceId, metadata?.organizationId || '') }
    );
  }

  async createCreditPurchaseCheckout(
    customerId: string,
    packId: string,
    priceCents: number,
    packName: string,
    successUrl: string,
    cancelUrl: string,
    metadata: Record<string, string>,
    purchaseIntent?: string | null,
  ) {
    const stripe = await getUncachableStripeClient();
    return await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: packName,
            description: `Credit pack for usage-based features`,
            tax_code: 'txcd_10000000', // SaaS / digital service tax code
          },
          unit_amount: priceCents,
          tax_behavior: 'exclusive',
        },
        quantity: 1,
      }],
      mode: 'payment',
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata,
      // Phase 3 W10 — Stripe Tax on credit purchases too.
      automatic_tax: { enabled: true },
      customer_update: { address: 'auto', name: 'auto' },
    }, {
      idempotencyKey: creditCheckoutIdempotencyKey({
        customerId,
        packId,
        organizationId: metadata?.organizationId || '',
        purchaseIntent,
      }),
    });
  }

  async createCustomerPortalSession(customerId: string, returnUrl: string) {
    const stripe = await getUncachableStripeClient();
    return await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });
  }

  async getProduct(productId: string) {
    const stripe = await getUncachableStripeClient();
    try {
      return await stripe.products.retrieve(productId);
    } catch {
      return null;
    }
  }

  async listProducts(active = true) {
    const stripe = await getUncachableStripeClient();
    const products = await stripe.products.list({ active, limit: 100 });
    return products.data;
  }

  async listProductsWithPrices(active = true) {
    const stripe = await getUncachableStripeClient();
    const [products, prices] = await Promise.all([
      stripe.products.list({ active, limit: 100 }),
      stripe.prices.list({ active: true, limit: 100, expand: ['data.product'] }),
    ]);

    return products.data.map(product => {
      const productPrices = prices.data
        .filter(p => {
          const prodId = typeof p.product === 'string' ? p.product : p.product?.id;
          return prodId === product.id;
        })
        .sort((a, b) => (a.unit_amount || 0) - (b.unit_amount || 0));

      return {
        product_id: product.id,
        product_name: product.name,
        product_description: product.description,
        product_active: product.active,
        product_metadata: product.metadata,
        prices: productPrices.map(p => ({
          price_id: p.id,
          unit_amount: p.unit_amount,
          currency: p.currency,
          recurring: p.recurring,
          price_active: p.active,
          price_metadata: p.metadata,
        })),
      };
    });
  }

  async getPrice(priceId: string) {
    const stripe = await getUncachableStripeClient();
    try {
      return await stripe.prices.retrieve(priceId);
    } catch {
      return null;
    }
  }

  async getSubscription(subscriptionId: string) {
    const stripe = await getUncachableStripeClient();
    try {
      return await stripe.subscriptions.retrieve(subscriptionId);
    } catch {
      return null;
    }
  }

  /**
   * Self-serve cancellation (Cal. Bus. & Prof. Code § 17602(d)(1): online, at
   * will, immediately): the subscription stops renewing and ends at the close
   * of the paid period. Idempotent per subscription.
   */
  async cancelAtPeriodEnd(subscriptionId: string) {
    const stripe = await getUncachableStripeClient();
    return await stripe.subscriptions.update(
      subscriptionId,
      { cancel_at_period_end: true },
      { idempotencyKey: idempotencyKey('cancel_at_period_end', subscriptionId) },
    );
  }

  async getCustomerSubscriptions(customerId: string) {
    const stripe = await getUncachableStripeClient();
    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
      limit: 100,
    });
    return subscriptions.data;
  }

  /**
   * Tahoe E11 — pause the active Stripe subscription with a window-bound
   * `pause_collection`. `keep_as_draft` defers any invoice generated
   * during the window so the customer is not double-charged on resume;
   * `resumes_at` is the unix timestamp at which Stripe will fire
   * customer.subscription.resumed automatically.
   *
   * Deterministic idempotency key includes the subscription id + resumes_at
   * second so re-trying the same pause for the same window is a no-op,
   * but a different window length creates a new operation.
   */
  async pauseSubscription(subscriptionId: string, resumesAtUnix: number) {
    const stripe = await getUncachableStripeClient();
    return await stripeCircuitBreaker.call(() =>
      stripe.subscriptions.update(
        subscriptionId,
        {
          pause_collection: {
            behavior: 'keep_as_draft',
            resumes_at: resumesAtUnix,
          },
        } as any,
        { idempotencyKey: idempotencyKey('pause_subscription', subscriptionId, resumesAtUnix) },
      ),
    );
  }

  /**
   * Tahoe E11 — clear `pause_collection`. Used by the
   * resumeExpiredPauses worker as a defensive double-write in case
   * Stripe missed firing customer.subscription.resumed on its own.
   */
  async resumeSubscription(subscriptionId: string) {
    const stripe = await getUncachableStripeClient();
    return await stripeCircuitBreaker.call(() =>
      stripe.subscriptions.update(
        subscriptionId,
        { pause_collection: '' } as any,
        { idempotencyKey: idempotencyKey('resume_subscription', subscriptionId, clock.nowMs()) },
      ),
    );
  }
}

export const stripeService = new StripeService();
