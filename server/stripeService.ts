import { getUncachableStripeClient } from './stripeClient';

export class StripeService {
  async createCustomer(email: string, userId: string, name?: string) {
    const stripe = await getUncachableStripeClient();
    return await stripe.customers.create({
      email,
      name,
      metadata: { userId },
    });
  }

  async createCheckoutSession(
    customerId: string, 
    priceId: string, 
    successUrl: string, 
    cancelUrl: string,
    metadata?: Record<string, string>,
    trialDays?: number
  ) {
    const stripe = await getUncachableStripeClient();
    const sessionConfig: any = {
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      mode: 'subscription',
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata,
    };
    
    // Add trial period if specified (for first-time subscribers only)
    if (trialDays && trialDays > 0) {
      sessionConfig.subscription_data = {
        trial_period_days: trialDays,
      };
    }
    
    return await stripe.checkout.sessions.create(sessionConfig);
  }

  async createCreditPurchaseCheckout(
    customerId: string,
    packId: string,
    priceCents: number,
    packName: string,
    successUrl: string,
    cancelUrl: string,
    metadata: Record<string, string>
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
          },
          unit_amount: priceCents,
        },
        quantity: 1,
      }],
      mode: 'payment',
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata,
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

  async getCustomerSubscriptions(customerId: string) {
    const stripe = await getUncachableStripeClient();
    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
      limit: 100,
    });
    return subscriptions.data;
  }
}

export const stripeService = new StripeService();
