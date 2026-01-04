import { getUncachableStripeClient } from './stripeClient';

const SUBSCRIPTION_PRODUCTS = [
  {
    name: 'Starter',
    description: 'Perfect for solo land investors getting started. Up to 100 properties, 500 leads, basic AI assistance.',
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
  
  console.log('Product seed complete!');
}

seedProducts().catch(console.error);
