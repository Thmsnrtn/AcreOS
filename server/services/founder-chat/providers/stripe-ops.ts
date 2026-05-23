/**
 * Atlas Stripe read-only provider (Phase G — operations batch 1).
 *
 * Reuses the existing getUncachableStripeClient() — same circuit-breaker
 * + key management as the rest of the platform. Returns trimmed shapes
 * so Atlas tools format deterministically.
 *
 * Read-only methods only in this drop:
 *   - lookupCustomer(query)       — by email, customer-id, or partial name
 *   - getCustomerInvoices(id, n)  — recent invoices for a customer
 *   - getActiveSubscriptions(id)  — active subs for a customer
 *
 * Destructive operations (refund / cancel / pause / credit) land in a
 * follow-up commit with Tier-3 confirmation per the founder-chat plan.
 */

import { getUncachableStripeClient } from "../../../stripeClient";
import { logger } from "../../../utils/logger";

export interface StripeCustomerSummary {
  id: string;
  email: string | null;
  name: string | null;
  created: number;
  livemode: boolean;
  defaultPayment?: string | null;
  delinquent?: boolean | null;
}

export interface StripeInvoiceSummary {
  id: string;
  amount_paid: number;
  amount_due: number;
  currency: string;
  status: string | null;
  created: number;
  hosted_invoice_url?: string | null;
}

export interface StripeSubscriptionSummary {
  id: string;
  status: string;
  current_period_end: number;
  cancel_at_period_end: boolean;
  items: Array<{ price_id: string; quantity: number; nickname?: string | null }>;
}

/**
 * Look up a customer by email (preferred), Stripe id, or partial name.
 * Returns at most 5 matches — Atlas can ask Tom to disambiguate.
 */
export async function lookupCustomer(query: string): Promise<StripeCustomerSummary[]> {
  if (!query || query.trim().length < 3) {
    throw new Error("Customer lookup requires at least 3 characters");
  }
  const stripe = await getUncachableStripeClient();
  const trimmed = query.trim();

  // Direct customer id?
  if (/^cus_[A-Za-z0-9]{10,}$/.test(trimmed)) {
    try {
      const c = await stripe.customers.retrieve(trimmed);
      if (c.deleted) return [];
      return [summarizeCustomer(c)];
    } catch (err) {
      logger.info({ err: err instanceof Error ? err.message : String(err) }, "stripe customer retrieve miss");
      return [];
    }
  }

  // Email lookup is exact via Stripe API.
  if (trimmed.includes("@")) {
    const list = await stripe.customers.list({ email: trimmed, limit: 5 });
    return list.data.map(summarizeCustomer);
  }

  // Fallback — search API (subscription tier required for full text; if not
  // available we degrade gracefully to listing by name in metadata).
  try {
    const search = await stripe.customers.search({
      query: `name:'${trimmed.replace(/'/g, "")}' OR metadata['name']:'${trimmed.replace(/'/g, "")}'`,
      limit: 5,
    });
    return search.data.map(summarizeCustomer);
  } catch (err) {
    logger.info({ err: err instanceof Error ? err.message : String(err) }, "stripe search unavailable; falling back to list");
    const list = await stripe.customers.list({ limit: 100 });
    const q = trimmed.toLowerCase();
    return list.data
      .filter((c) => (c.name ?? "").toLowerCase().includes(q))
      .slice(0, 5)
      .map(summarizeCustomer);
  }
}

export async function getCustomerInvoices(customerId: string, limit = 5): Promise<StripeInvoiceSummary[]> {
  const stripe = await getUncachableStripeClient();
  const list = await stripe.invoices.list({ customer: customerId, limit });
  return list.data.map((inv) => ({
    id: inv.id ?? "",
    amount_paid: inv.amount_paid,
    amount_due: inv.amount_due,
    currency: inv.currency,
    status: inv.status,
    created: inv.created,
    hosted_invoice_url: inv.hosted_invoice_url ?? null,
  }));
}

export async function getActiveSubscriptions(customerId: string): Promise<StripeSubscriptionSummary[]> {
  const stripe = await getUncachableStripeClient();
  const list = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 10 });
  return list.data
    .filter((s) => s.status === "active" || s.status === "trialing" || s.status === "past_due")
    .map((s) => ({
      id: s.id,
      status: s.status,
      current_period_end: (s as unknown as { current_period_end: number }).current_period_end,
      cancel_at_period_end: s.cancel_at_period_end,
      items: s.items.data.map((it) => ({
        price_id: it.price.id,
        quantity: it.quantity ?? 1,
        nickname: it.price.nickname ?? null,
      })),
    }));
}

function summarizeCustomer(c: any): StripeCustomerSummary {
  return {
    id: c.id,
    email: c.email ?? null,
    name: c.name ?? null,
    created: c.created,
    livemode: c.livemode,
    delinquent: c.delinquent ?? null,
    defaultPayment: c.default_source ?? c.invoice_settings?.default_payment_method ?? null,
  };
}
