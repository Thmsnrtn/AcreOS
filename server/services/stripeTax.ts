/**
 * Stripe Tax synchronization helpers (Phase 3 Week 10).
 *
 * Stripe Tax computes the correct sales-tax/VAT rate for every charge based
 * on the customer's billing address. For our flow, the source of truth is
 * `organizations.taxAddress` (captured during onboarding via the tax-identity
 * form). When that address is set or updated, we mirror it onto the Stripe
 * Customer with `stripe.customers.update({ address, tax: { ... } })` so
 * subsequent invoices/checkouts pick up the right rate.
 *
 * Failure mode: any Stripe error here is logged but never thrown. The
 * org's local taxAddress write is the source of truth; the Stripe sync is
 * a best-effort mirror. A nightly reconciliation job (out of scope) can
 * catch up any orgs that drifted.
 */

import { logger } from "../utils/logger";
import type { Organization } from "@shared/schema";

export interface TaxAddressShape {
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  phone?: string;
}

/**
 * Push the org's tax address onto the Stripe Customer record. Idempotent —
 * Stripe accepts repeated identical updates without side-effects.
 *
 * Caller responsibilities:
 *   - The org must already have a stripeCustomerId. If null, this is a no-op
 *     (we log info and return). The customer will be created on next checkout
 *     and that flow already passes the correct address via customer_update.
 *   - The taxAddress must have at minimum `country`. If country is missing,
 *     Stripe rejects the update — we log and skip.
 */
export async function syncTaxAddressToStripe(
  org: Pick<Organization, "id" | "stripeCustomerId" | "taxAddress" | "legalEntityName">,
): Promise<{ synced: boolean; reason?: string }> {
  if (!org.stripeCustomerId) {
    logger.info("[stripe-tax] org has no Stripe customer yet — sync deferred to next checkout", {
      orgId: org.id,
    });
    return { synced: false, reason: "no_stripe_customer" };
  }

  const taxAddress = (org.taxAddress ?? null) as TaxAddressShape | null;
  if (!taxAddress) {
    return { synced: false, reason: "no_tax_address" };
  }

  if (!taxAddress.country) {
    logger.warn("[stripe-tax] tax address missing country — Stripe Tax requires a country code", {
      orgId: org.id,
    });
    return { synced: false, reason: "missing_country" };
  }

  try {
    const { getUncachableStripeClient } = await import("../stripeClient");
    const stripe = await getUncachableStripeClient();

    await stripe.customers.update(org.stripeCustomerId, {
      address: {
        line1: taxAddress.line1 || "",
        line2: taxAddress.line2,
        city: taxAddress.city || "",
        state: taxAddress.state || "",
        postal_code: taxAddress.zip || "",
        country: taxAddress.country,
      },
      // The Customer's `tax` block is what Stripe Tax reads when computing
      // rates on subsequent invoices. validate_location: 'deferred' tells
      // Stripe to validate the address lazily so a partial form (no line1
      // yet) doesn't 400 the whole save.
      tax: {
        validate_location: "deferred",
      },
      ...(org.legalEntityName ? { name: org.legalEntityName } : {}),
      metadata: {
        organizationId: String(org.id),
        taxAddressSyncedAt: new Date().toISOString(),
      },
    });

    logger.info("[stripe-tax] tax address synced to Stripe customer", {
      orgId: org.id,
      stripeCustomerId: org.stripeCustomerId,
    });
    return { synced: true };
  } catch (err) {
    // Best-effort — log but don't throw. The DB write already succeeded;
    // the founder will see a banner if Stripe webhooks report a tax error.
    logger.error(
      "[stripe-tax] failed to sync tax address to Stripe",
      err instanceof Error ? err : undefined,
      { metadata: { orgId: org.id } },
    );
    return { synced: false, reason: "stripe_error" };
  }
}
