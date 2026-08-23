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
          //
          // F-D37: include `type` so callers like the webhook claimEvent path
          // (claimEvent(event.id, event.type)) don't pass undefined into a
          // NOT NULL Postgres column. Without this the idempotency insert
          // serializes event_type as DEFAULT and fails the column constraint.
          return {
            id: `sim_${methodName}_${Date.now().toString(36)}`,
            object: target.constructor?.name?.toLowerCase() || "object",
            type: `sim.${methodName}`,
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

/**
 * The current billing period of a subscription.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * `current_period_start` / `current_period_end` are NOT on `Stripe.Subscription`
 * in the API version this repo pins (see STRIPE_API_VERSION above; SDK 20.x).
 * Stripe moved them onto the SUBSCRIPTION ITEM, because a subscription with
 * items on different cadences has no single period.
 *
 * Four call sites read them off the subscription anyway, each through a cast
 * that silenced the compiler, and the consequences differed by site:
 *
 *   supportAgent.diagnose_account   `new Date(undefined * 1000).toISOString()`
 *                                   is `new Date(NaN).toISOString()`, which
 *                                   THROWS RangeError — so the support agent
 *                                   could never report subscription status for a
 *                                   customer who HAS one.
 *   founder-chat stripe-ops         typed the field `number` and populated it
 *                                   with undefined via `as unknown as {...}` —
 *                                   a double assertion, which is why the
 *                                   ghost-field gate did not see it.
 *   founder-chat operations         same throw, one layer downstream.
 *   paxLearning                     guarded with `if (periodEnd)`, so the
 *                                   renewal-window prediction simply never fired.
 *
 * Returns null rather than NaN when no item carries a period: absent is a state
 * the caller must handle, and `new Date(NaN)` is not a date.
 *
 * Uses the EARLIEST end across items, which is when the customer is next
 * charged for anything — the question every caller here is actually asking.
 */
export function subscriptionPeriod(
  sub: Stripe.Subscription,
): { start: number; end: number } | null {
  const items = sub.items?.data ?? [];
  const periods = items
    .map((it) => ({
      start: (it as { current_period_start?: number }).current_period_start,
      end: (it as { current_period_end?: number }).current_period_end,
    }))
    .filter((p): p is { start: number; end: number } =>
      typeof p.start === "number" && typeof p.end === "number" &&
      Number.isFinite(p.start) && Number.isFinite(p.end),
    );
  if (periods.length === 0) return null;
  return periods.reduce((soonest, p) => (p.end < soonest.end ? p : soonest));
}

/** The period as ISO strings, or nulls. Never an Invalid Date. */
export function subscriptionPeriodIso(
  sub: Stripe.Subscription,
): { start: string | null; end: string | null } {
  const p = subscriptionPeriod(sub);
  return p
    ? { start: new Date(p.start * 1000).toISOString(), end: new Date(p.end * 1000).toISOString() }
    : { start: null, end: null };
}
