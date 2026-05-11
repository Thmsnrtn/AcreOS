import { getUncachableStripeClient } from './stripeClient';
import { logger } from "./utils/logger";
import { TIER_PRICES_CENTS } from "@shared/billing/tier-pricing";

// Only Pro tier supports additional seats in the launch lineup.
// Per-seat add-on shadows the Starter monthly price as the per-seat cost.
const SEAT_ADDON_PRODUCTS = [
  {
    name: 'Pro Seat Add-on',
    description: 'Additional team member seat for Pro plan',
    metadata: {
      type: 'seat_addon',
      tier: 'pro',
    },
    monthlyPrice: TIER_PRICES_CENTS.starter.priceMonthlyCents, // $20/seat/month
    yearlyPrice: TIER_PRICES_CENTS.starter.priceYearlyCents,   // $200/seat/year
  },
];

// Stripe products for the 3 paid tiers. Names + metadata keys + canonical
// TIER_PRICES_CENTS keys now all match (Starter / Pro / Scale) per the
// 2026-05-11 reconciliation. Prices come from
// shared/billing/tier-pricing.ts so this script can never drift from the
// pricing page or MRR math.
const SUBSCRIPTION_PRODUCTS = [
  {
    name: 'Starter',
    description: 'Replace your spreadsheet. 250 leads, 50 properties, 25 notes, 500 AI requests, 5 campaigns, 2 sequences.',
    metadata: {
      tier: 'starter',
      propertyLimit: '50',
      leadLimit: '250',
      teamMembers: '1',
      aiCredits: '500',
    },
    monthlyPrice: TIER_PRICES_CENTS.starter.priceMonthlyCents,
    yearlyPrice: TIER_PRICES_CENTS.starter.priceYearlyCents,
  },
  {
    name: 'Pro',
    description: 'For serious operators. 500 leads, 100 properties, 50 notes, 1000 AI requests, unlimited campaigns/sequences, BYOK data providers, 2 seats.',
    metadata: {
      tier: 'pro',
      propertyLimit: '100',
      leadLimit: '500',
      teamMembers: '2',
      aiCredits: '1000',
    },
    monthlyPrice: TIER_PRICES_CENTS.pro.priceMonthlyCents,
    yearlyPrice: TIER_PRICES_CENTS.pro.priceYearlyCents,
  },
  {
    name: 'Scale',
    description: 'For growing teams. Unlimited leads/properties/notes/AI, 10 seats, priority support, SMS/voice outreach, BYOK providers.',
    metadata: {
      tier: 'scale',
      propertyLimit: '-1',
      leadLimit: '-1',
      teamMembers: '10',
      aiCredits: '-1',
    },
    monthlyPrice: TIER_PRICES_CENTS.scale.priceMonthlyCents,
    yearlyPrice: TIER_PRICES_CENTS.scale.priceYearlyCents,
  },
];

async function seedProducts() {
  logger.info('Starting product seed...');
  
  const stripe = await getUncachableStripeClient();
  
  for (const product of SUBSCRIPTION_PRODUCTS) {
    logger.info(`Creating product: ${product.name}`);
    
    // Check if product already exists
    const existingProducts = await stripe.products.search({
      query: `name:'${product.name}'`,
    });
    
    if (existingProducts.data.length > 0) {
      logger.info(`Product ${product.name} already exists, skipping...`);
      continue;
    }
    
    // Create the product
    const stripeProduct = await stripe.products.create({
      name: product.name,
      description: product.description,
      metadata: product.metadata,
    });
    
    logger.info(`Created product: ${stripeProduct.id}`);
    
    // Create monthly price
    const monthlyPrice = await stripe.prices.create({
      product: stripeProduct.id,
      unit_amount: product.monthlyPrice,
      currency: 'usd',
      recurring: { interval: 'month' },
      metadata: { billingPeriod: 'monthly' },
    });
    
    logger.info(`Created monthly price: ${monthlyPrice.id} ($${product.monthlyPrice / 100}/mo)`);
    
    // Create yearly price
    const yearlyPrice = await stripe.prices.create({
      product: stripeProduct.id,
      unit_amount: product.yearlyPrice,
      currency: 'usd',
      recurring: { interval: 'year' },
      metadata: { billingPeriod: 'yearly' },
    });
    
    logger.info(`Created yearly price: ${yearlyPrice.id} ($${product.yearlyPrice / 100}/yr)`);
  }
  
  logger.info('Subscription products complete!');
  
  // Seed seat add-on products
  for (const addon of SEAT_ADDON_PRODUCTS) {
    logger.info(`Creating seat add-on product: ${addon.name}`);
    
    // Check if product already exists
    const existingProducts = await stripe.products.search({
      query: `name:'${addon.name}'`,
    });
    
    if (existingProducts.data.length > 0) {
      logger.info(`Product ${addon.name} already exists, skipping...`);
      continue;
    }
    
    // Create the product
    const stripeProduct = await stripe.products.create({
      name: addon.name,
      description: addon.description,
      metadata: addon.metadata,
    });
    
    logger.info(`Created seat add-on product: ${stripeProduct.id}`);
    
    // Create monthly price (per seat)
    const monthlyPrice = await stripe.prices.create({
      product: stripeProduct.id,
      unit_amount: addon.monthlyPrice,
      currency: 'usd',
      recurring: { interval: 'month' },
      metadata: { 
        billingPeriod: 'monthly',
        type: 'seat_addon',
        tier: addon.metadata.tier,
      },
    });
    
    logger.info(`Created monthly seat price: ${monthlyPrice.id} ($${addon.monthlyPrice / 100}/seat/mo)`);
    
    // Create yearly price (per seat)
    const yearlyPrice = await stripe.prices.create({
      product: stripeProduct.id,
      unit_amount: addon.yearlyPrice,
      currency: 'usd',
      recurring: { interval: 'year' },
      metadata: { 
        billingPeriod: 'yearly',
        type: 'seat_addon',
        tier: addon.metadata.tier,
      },
    });
    
    logger.info(`Created yearly seat price: ${yearlyPrice.id} ($${addon.yearlyPrice / 100}/seat/yr)`);
  }
  
  logger.info('Product seed complete!');
}

seedProducts().catch(err => logger.error("Product seed failed", err));
