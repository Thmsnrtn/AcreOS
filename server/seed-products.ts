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
    description: 'Start land investing with AI due diligence, 50 enrichments/mo, basic data access, tax delinquent import, and Night Cap dashboard.',
    metadata: {
      tier: 'sprout',
      propertyLimit: '50',
      leadLimit: '250',
      teamMembers: '1',
      aiCredits: '500',
      enrichments: '50',
      dataTier: 'basic',
    },
    monthlyPrice: 2900, // $29/month
    yearlyPrice: 27800, // $278/year (20% discount)
  },
  {
    name: 'Starter',
    description: 'Build momentum with Atlas AI assistant, 50 skip traces & 200 enrichments/mo, standard data tier, assisted AI autonomy, and comps analysis.',
    metadata: {
      tier: 'starter',
      propertyLimit: '100',
      leadLimit: '500',
      teamMembers: '2',
      aiCredits: '1000',
      skipTraces: '50',
      enrichments: '200',
      dataTier: 'standard',
      autonomyLevel: 'assisted',
    },
    monthlyPrice: 5900, // $59/month
    yearlyPrice: 56600, // $566/year (20% discount)
  },
  {
    name: 'Pro',
    description: 'Scale with 200 skip traces, 1000 enrichments/mo, premium data, supervised AI autonomy, Deal Hunter AI, and full team collaboration.',
    metadata: {
      tier: 'pro',
      propertyLimit: '1000',
      leadLimit: '5000',
      teamMembers: '10',
      aiCredits: '10000',
      skipTraces: '200',
      enrichments: '1000',
      dataTier: 'premium',
      autonomyLevel: 'supervised',
    },
    monthlyPrice: 17900, // $179/month
    yearlyPrice: 171800, // $1718/year (20% discount)
  },
  {
    name: 'Scale',
    description: 'Unlimited leads & properties. 1000 skip traces, 5000 enrichments/mo, autonomous AI, Portfolio Sentinel, Voice & Vision AI, API access.',
    metadata: {
      tier: 'scale',
      propertyLimit: 'unlimited',
      leadLimit: 'unlimited',
      teamMembers: '25',
      aiCredits: 'unlimited',
      skipTraces: '1000',
      enrichments: '5000',
      dataTier: 'premium',
      autonomyLevel: 'autonomous',
    },
    monthlyPrice: 44900, // $449/month
    yearlyPrice: 430800, // $4308/year (20% discount)
  },
  {
    name: 'Enterprise',
    description: 'Everything unlimited. Unlimited skip traces & enrichments, autonomous AI, white-label portal, SSO, dedicated support, custom integrations.',
    metadata: {
      tier: 'enterprise',
      propertyLimit: 'unlimited',
      leadLimit: 'unlimited',
      teamMembers: 'unlimited',
      aiCredits: 'unlimited',
      skipTraces: 'unlimited',
      enrichments: 'unlimited',
      dataTier: 'premium',
      autonomyLevel: 'autonomous',
    },
    monthlyPrice: 89900, // $899/month
    yearlyPrice: 862800, // $8628/year (20% discount)
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
