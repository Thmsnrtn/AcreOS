import { getUncachableStripeClient } from './stripeClient';

const SEAT_ADDON_PRODUCTS = [
  {
    name: 'Starter Seat Add-on',
    description: 'Additional team member seat for Starter plan',
    metadata: {
      type: 'seat_addon',
      tier: 'starter',
    },
    monthlyPrice: 2000, // $20/month per seat
    yearlyPrice: 19200, // $192/year per seat (20% discount)
  },
  {
    name: 'Pro Seat Add-on',
    description: 'Additional team member seat for Pro plan',
    metadata: {
      type: 'seat_addon',
      tier: 'pro',
    },
    monthlyPrice: 3000, // $30/month per seat
    yearlyPrice: 28800, // $288/year per seat (20% discount)
  },
  {
    name: 'Scale Seat Add-on',
    description: 'Additional team member seat for Scale plan',
    metadata: {
      type: 'seat_addon',
      tier: 'scale',
    },
    monthlyPrice: 4000, // $40/month per seat
    yearlyPrice: 38400, // $384/year per seat (20% discount)
  },
];

const SUBSCRIPTION_PRODUCTS = [
  {
    name: 'Sprout',
    description: 'The most accessible way to start land investing. Up to 50 properties, 250 leads, AI due diligence, tax delinquent import, Night Cap dashboard.',
    metadata: {
      tier: 'sprout',
      propertyLimit: '50',
      leadLimit: '250',
      teamMembers: '1',
      aiCredits: '500',
    },
    monthlyPrice: 2000, // $20/month
    yearlyPrice: 19200, // $192/year (20% discount)
  },
  {
    name: 'Starter',
    description: 'Perfect for solo land investors building momentum. Up to 100 properties, 500 leads, full AI assistant Atlas, seller intent & comps analysis.',
    metadata: {
      tier: 'starter',
      propertyLimit: '100',
      leadLimit: '500',
      teamMembers: '2',
      aiCredits: '1000',
    },
    monthlyPrice: 4900, // $49/month
    yearlyPrice: 47000, // $470/year (20% discount)
  },
  {
    name: 'Pro',
    description: 'For growing land businesses. Up to 1000 properties, 5000 leads, full AI suite, team collaboration.',
    metadata: {
      tier: 'pro',
      propertyLimit: '1000',
      leadLimit: '5000',
      teamMembers: '10',
      aiCredits: '5000',
    },
    monthlyPrice: 14900, // $149/month
    yearlyPrice: 143000, // $1430/year (20% discount)
  },
  {
    name: 'Scale',
    description: 'Unlimited leads and properties. Advanced reporting, API access, team messaging, priority support.',
    metadata: {
      tier: 'scale',
      propertyLimit: 'unlimited',
      leadLimit: 'unlimited',
      teamMembers: '25',
      aiCredits: '25000',
    },
    monthlyPrice: 39900, // $399/month
    yearlyPrice: 383000, // $3830/year (20% discount)
  },
  {
    name: 'Enterprise',
    description: 'Everything unlimited. White-label portal, dedicated support, compliance exports, custom integrations.',
    metadata: {
      tier: 'enterprise',
      propertyLimit: 'unlimited',
      leadLimit: 'unlimited',
      teamMembers: 'unlimited',
      aiCredits: '50000',
    },
    monthlyPrice: 79900, // $799/month
    yearlyPrice: 767000, // $7670/year (20% discount)
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
