import { getUncachableStripeClient } from './stripeClient';

// Only Pro tier supports additional seats in the 3-tier launch
const SEAT_ADDON_PRODUCTS = [
  {
    name: 'Pro Seat Add-on',
    description: 'Additional team member seat for Pro plan',
    metadata: {
      type: 'seat_addon',
      tier: 'pro',
    },
    monthlyPrice: 2000, // $20/month per seat
    yearlyPrice: 19200, // $192/year per seat (20% discount)
  },
];

// Only create Stripe products for the 3 launch tiers (Free, Starter, Pro)
// Scale and Enterprise are feature-flagged and will NOT have Stripe products until manually enabled
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
    monthlyPrice: 2000, // $20/month
    yearlyPrice: 19200, // $192/year (20% discount)
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
    monthlyPrice: 4900, // $49/month
    yearlyPrice: 47000, // $470/year (20% discount)
  },
];

async function seedProducts() {
  console.log('Starting product seed...');
  
  const stripe = await getUncachableStripeClient();
  
  for (const product of SUBSCRIPTION_PRODUCTS) {
    console.log(`Creating product: ${product.name}`);
    
    // Check if product already exists
    const existingProducts = await stripe.products.search({
      query: `name:'${product.name}'`,
    });
    
    if (existingProducts.data.length > 0) {
      console.log(`Product ${product.name} already exists, skipping...`);
      continue;
    }
    
    // Create the product
    const stripeProduct = await stripe.products.create({
      name: product.name,
      description: product.description,
      metadata: product.metadata,
    });
    
    console.log(`Created product: ${stripeProduct.id}`);
    
    // Create monthly price
    const monthlyPrice = await stripe.prices.create({
      product: stripeProduct.id,
      unit_amount: product.monthlyPrice,
      currency: 'usd',
      recurring: { interval: 'month' },
      metadata: { billingPeriod: 'monthly' },
    });
    
    console.log(`Created monthly price: ${monthlyPrice.id} ($${product.monthlyPrice / 100}/mo)`);
    
    // Create yearly price
    const yearlyPrice = await stripe.prices.create({
      product: stripeProduct.id,
      unit_amount: product.yearlyPrice,
      currency: 'usd',
      recurring: { interval: 'year' },
      metadata: { billingPeriod: 'yearly' },
    });
    
    console.log(`Created yearly price: ${yearlyPrice.id} ($${product.yearlyPrice / 100}/yr)`);
  }
  
  console.log('Subscription products complete!');
  
  // Seed seat add-on products
  for (const addon of SEAT_ADDON_PRODUCTS) {
    console.log(`Creating seat add-on product: ${addon.name}`);
    
    // Check if product already exists
    const existingProducts = await stripe.products.search({
      query: `name:'${addon.name}'`,
    });
    
    if (existingProducts.data.length > 0) {
      console.log(`Product ${addon.name} already exists, skipping...`);
      continue;
    }
    
    // Create the product
    const stripeProduct = await stripe.products.create({
      name: addon.name,
      description: addon.description,
      metadata: addon.metadata,
    });
    
    console.log(`Created seat add-on product: ${stripeProduct.id}`);
    
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
    
    console.log(`Created monthly seat price: ${monthlyPrice.id} ($${addon.monthlyPrice / 100}/seat/mo)`);
    
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
    
    console.log(`Created yearly seat price: ${yearlyPrice.id} ($${addon.yearlyPrice / 100}/seat/yr)`);
  }
  
  console.log('Product seed complete!');
}

seedProducts().catch(console.error);
