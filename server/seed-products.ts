import { getUncachableStripeClient } from './stripeClient';

const SUBSCRIPTION_PRODUCTS = [
  {
    name: 'Starter',
    description: 'Perfect for solo land investors getting started. Up to 50 properties, 100 leads, basic AI assistance.',
    metadata: {
      tier: 'starter',
      propertyLimit: '50',
      leadLimit: '100',
      teamMembers: '1',
      aiCredits: '100',
    },
    monthlyPrice: 4900, // $49/month
    yearlyPrice: 47000, // $470/year (20% discount)
  },
  {
    name: 'Professional',
    description: 'For growing land businesses. Up to 500 properties, 1000 leads, full AI suite, team collaboration.',
    metadata: {
      tier: 'professional',
      propertyLimit: '500',
      leadLimit: '1000',
      teamMembers: '5',
      aiCredits: '500',
    },
    monthlyPrice: 14900, // $149/month
    yearlyPrice: 143000, // $1430/year (20% discount)
  },
  {
    name: 'Enterprise',
    description: 'Unlimited everything. White-label options, API access, dedicated support, custom integrations.',
    metadata: {
      tier: 'enterprise',
      propertyLimit: 'unlimited',
      leadLimit: 'unlimited',
      teamMembers: 'unlimited',
      aiCredits: 'unlimited',
    },
    monthlyPrice: 49900, // $499/month
    yearlyPrice: 479000, // $4790/year (20% discount)
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
