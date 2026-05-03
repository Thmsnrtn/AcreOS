import Stripe from 'stripe';
import { isCategorySimulated, recordSimulatedAction } from './utils/simulationMode';

/**
 * Pinned Stripe API version. Phase 3 Week 10: every `new Stripe(...)` site
 * agrees on a single, explicit apiVersion. Stripe SDK 20.4.1 ships with
 * `LatestApiVersion = '2026-02-25.clover'` — pinning to that string keeps
 * us on the typed surface (apiVersion?: LatestApiVersion) without `as any`.
 *
 * Re-exported so other modules that construct Stripe clients (webhook
 * handlers, connect service, support agent, etc.) reuse this constant
 * rather than scattering string literals.
 */
export const STRIPE_API_VERSION: Stripe.LatestApiVersion = '2026-02-25.clover';

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

/**
 * When SIMULATION_MODE (or SIMULATION_MODE_STRIPE) is set, every
 * mutating Stripe method short-circuits — no API call, no real charge.
 * Read-only methods (.retrieve, .list, .search) pass through untouched
 * so dashboards that inspect Stripe state still work.
 *
 * The whitelist of read-only sub-paths is deliberately conservative:
 * if a method isn't listed, we simulate rather than pass through, so
 * accidental new money-moving methods fail-closed instead of fail-open.
 */
const READ_ONLY_METHODS = new Set([
  "retrieve", "list", "search", "listLineItems", "listMembers",
  "listPaymentMethods", "listSubscriptionItems", "listOwners",
]);

function wrapStripeForSimulation<T extends object>(stripe: T): T {
  const handler: ProxyHandler<any> = {
    get(target: any, prop: string | symbol) {
      const value = target[prop];
      // Primitives / non-object properties pass through.
      if (value === null || value === undefined) return value;
      if (typeof prop === "symbol") return value;
      if (typeof value === "function") {
        // Only wrap functions at the resource.method level — the outer
        // `stripe.subscriptions` is an object, not a function, so this
        // branch runs for things like `stripe.subscriptions.create`.
        const methodName = prop.toString();
        if (READ_ONLY_METHODS.has(methodName)) {
          return value.bind(target);
        }
        // Simulated side-effectful method: record and return a fake.
        return async (...args: any[]) => {
          const action = `${(target.constructor?.name || "stripe").toLowerCase()}.${methodName}`;
          await recordSimulatedAction("stripe", action, { args });
          // Return a synthetic response shaped enough like Stripe's to
          // not blow up downstream code: { id, object, simulated:true }.
          return {
            id: `sim_${methodName}_${Date.now().toString(36)}`,
            object: target.constructor?.name?.toLowerCase() || "object",
            simulated: true,
            status: "active",
            url: `https://sim.acreos.io/stripe/${methodName}`,
            client_secret: `sim_secret_${Date.now().toString(36)}`,
          } as any;
        };
      }
      // Nested resource namespace (stripe.subscriptions, stripe.customers.tax, etc).
      if (typeof value === "object") {
        return new Proxy(value, handler);
      }
      return value;
    },
  };
  return new Proxy(stripe, handler) as T;
}

export async function getUncachableStripeClient() {
  const real = new Stripe(getSecretKey(), {
    apiVersion: STRIPE_API_VERSION,
    maxNetworkRetries: 3,
  });
  if (isCategorySimulated("stripe")) {
    return wrapStripeForSimulation(real);
  }
  return real;
}

export async function getStripePublishableKey() {
  return getPublishableKey();
}

export async function getStripeSecretKey() {
  return getSecretKey();
}
