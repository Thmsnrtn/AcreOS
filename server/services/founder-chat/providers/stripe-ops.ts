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
import { subscriptionPeriod } from "../../../stripeClient";
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
  /** null when no item carries a period — never NaN. */
  current_period_end: number | null;
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
      logger.info("stripe customer retrieve miss", { err: err instanceof Error ? err.message : String(err) });
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
    logger.info("stripe search unavailable; falling back to list", { err: err instanceof Error ? err.message : String(err) });
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
      // Was `(s as unknown as { current_period_end: number }).current_period_end`
      // — a DOUBLE assertion, which is how it evaded both tsc and the
      // ghost-field gate, and it populated a field typed `number` with
      // undefined. The period lives on the items, which this same map already
      // walks two lines below.
      current_period_end: subscriptionPeriod(s)?.end ?? null,
      cancel_at_period_end: s.cancel_at_period_end,
      items: s.items.data.map((it) => ({
        price_id: it.price.id,
        quantity: it.quantity ?? 1,
        nickname: it.price.nickname ?? null,
      })),
    }));
}

// ─── Destructive operations (Phase G/H/I batch 2) ───────────────────────────
// Tier 3 (audit at ERROR): refundCharge, cancelSubscription
// Tier 2 (audit at WARN):  grantCredit, pauseSubscription
// Each is invoked only from a confirmed tool handler. The kill-switch +
// cooldown live in the executor; the verifyFn lives in the tool.

export interface StripeRefundResult {
  id: string;
  amount: number;
  status: string | null;
  charge: string;
  reason: string | null;
}

export interface StripeCanceledSubscription {
  id: string;
  status: string;
  cancel_at_period_end: boolean;
  canceled_at: number | null;
}

export interface StripeCreditNoteSummary {
  id: string;
  amount: number;
  customer: string;
}

export async function refundCharge(
  chargeId: string,
  cents: number | undefined,
  reason: string,
): Promise<StripeRefundResult> {
  if (!/^ch_[A-Za-z0-9]+/.test(chargeId) && !/^py_[A-Za-z0-9]+/.test(chargeId)) {
    throw new Error("refundCharge requires a charge id (ch_… or py_…)");
  }
  if (cents !== undefined && (!Number.isFinite(cents) || cents <= 0)) {
    throw new Error("refundCharge cents must be a positive integer");
  }
  const stripe = await getUncachableStripeClient();
  const refund = await stripe.refunds.create({
    charge: chargeId,
    ...(cents !== undefined ? { amount: cents } : {}),
    metadata: { atlas_reason: reason.slice(0, 480) },
  });
  logger.warn("[stripe-ops] refundCharge", {
    metadata: { chargeId, cents: cents ?? "full", refundId: refund.id },
  });
  return {
    id: refund.id,
    amount: refund.amount,
    status: refund.status ?? null,
    charge: chargeId,
    reason: refund.reason ?? null,
  };
}

export async function cancelSubscription(
  subId: string,
  atPeriodEnd: boolean,
  reason: string,
): Promise<StripeCanceledSubscription> {
  const stripe = await getUncachableStripeClient();
  let updated: any;
  if (atPeriodEnd) {
    updated = await stripe.subscriptions.update(subId, {
      cancel_at_period_end: true,
      metadata: { atlas_cancel_reason: reason.slice(0, 480) },
    });
  } else {
    updated = await stripe.subscriptions.cancel(subId);
  }
  logger.warn("[stripe-ops] cancelSubscription", {
    metadata: { subId, atPeriodEnd, status: updated.status },
  });
  return {
    id: updated.id,
    status: updated.status,
    cancel_at_period_end: Boolean(updated.cancel_at_period_end),
    canceled_at: updated.canceled_at ?? null,
  };
}

export async function reactivateSubscription(subId: string): Promise<StripeCanceledSubscription> {
  const stripe = await getUncachableStripeClient();
  const updated: any = await stripe.subscriptions.update(subId, {
    cancel_at_period_end: false,
  });
  return {
    id: updated.id,
    status: updated.status,
    cancel_at_period_end: Boolean(updated.cancel_at_period_end),
    canceled_at: updated.canceled_at ?? null,
  };
}

export async function grantCredit(
  customerId: string,
  cents: number,
  reason: string,
): Promise<StripeCreditNoteSummary> {
  if (!/^cus_/.test(customerId)) {
    throw new Error("grantCredit requires a customer id (cus_…)");
  }
  if (!Number.isFinite(cents) || cents <= 0) {
    throw new Error("grantCredit cents must be a positive integer");
  }
  const stripe = await getUncachableStripeClient();
  const txn: any = await stripe.customers.createBalanceTransaction(customerId, {
    amount: -Math.abs(cents),  // negative balance = customer credit
    currency: "usd",
    description: `Atlas credit: ${reason.slice(0, 240)}`,
  });
  logger.warn("[stripe-ops] grantCredit", {
    metadata: { customerId, cents, txnId: txn.id },
  });
  return { id: txn.id, amount: cents, customer: customerId };
}

export async function pauseSubscription(
  subId: string,
  resumeAtUnix: number | undefined,
  reason: string,
): Promise<StripeCanceledSubscription> {
  const stripe = await getUncachableStripeClient();
  const updated: any = await stripe.subscriptions.update(subId, {
    pause_collection: {
      behavior: "void",
      ...(resumeAtUnix ? { resumes_at: resumeAtUnix } : {}),
    },
    metadata: { atlas_pause_reason: reason.slice(0, 480) },
  });
  logger.warn("[stripe-ops] pauseSubscription", {
    metadata: { subId, resumeAtUnix, status: updated.status },
  });
  return {
    id: updated.id,
    status: updated.status,
    cancel_at_period_end: Boolean(updated.cancel_at_period_end),
    canceled_at: updated.canceled_at ?? null,
  };
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
