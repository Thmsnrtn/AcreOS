import Stripe from 'stripe';

function getSecretKey(): string {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error('STRIPE_SECRET_KEY environment variable is not set');
  }
  return key;
}

function getPublishableKey(): string {
  const key = process.env.STRIPE_PUBLISHABLE_KEY;
  if (!key) {
    throw new Error('STRIPE_PUBLISHABLE_KEY environment variable is not set');
  }
  return key;
}

export async function getUncachableStripeClient() {
  return new Stripe(getSecretKey());
}

export async function getStripePublishableKey() {
  return getPublishableKey();
}

export async function getStripeSecretKey() {
  return getSecretKey();
}
