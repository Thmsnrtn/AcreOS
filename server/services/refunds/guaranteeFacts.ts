/**
 * Stripe-side facts for the §5A guarantee (design 2026-11 §3.1, E2 + E4).
 *
 * E2 — the org's FIRST subscription charge. Operationally: the subscription's
 * first paid invoice where the linkage resolves, else the earliest succeeded
 * charge of the customer that is not a credit-pack purchase. (Today's code took
 * "the latest charge", which for a renewal inside 30 days would auto-refund a
 * charge §5A covers only case-by-case.)
 *
 * Payloads at the pinned API version (2026-02-25.clover) no longer carry
 * `charge.invoice` / `invoice.charge`; the link lives on InvoicePayment, keyed
 * by the payment intent (see WebhookHandlers.invoiceIdOfCharge). The legacy
 * fields are still read when present.
 */
import type { ChargeFacts } from "./guaranteeEligibility";

/** The slice of a Stripe charge these functions read. */
export interface StripeChargeLike {
  id: string;
  amount: number;
  created: number; // epoch seconds
  status?: string | null;
  paid?: boolean | null;
  refunded?: boolean | null;
  disputed?: boolean | null;
  amount_refunded?: number | null;
  payment_intent?: string | { id: string } | null;
}

interface StripeInvoiceLike {
  id: string;
  created: number;
  status?: string | null;
  amount_paid?: number | null;
  subscription?: string | { id: string } | null;
  parent?: { subscription_details?: { subscription?: string | { id: string } | null } | null } | null;
  charge?: string | { id: string } | null;
}

interface StripePage<T> {
  data: T[];
  has_more?: boolean;
}

/** The Stripe client surface the resolver touches (a real client satisfies it structurally). */
export interface GuaranteeStripe {
  charges: {
    list(params: Record<string, unknown>): Promise<StripePage<StripeChargeLike>>;
    retrieve(id: string): Promise<StripeChargeLike>;
  };
  invoices: { list(params: Record<string, unknown>): Promise<StripePage<StripeInvoiceLike>> };
  invoicePayments: {
    list(params: Record<string, unknown>): Promise<
      StripePage<{
        status?: string | null;
        payment?: { type?: string; charge?: string | { id: string } | null; payment_intent?: string | { id: string } | null } | null;
      }>
    >;
  };
  paymentIntents: { retrieve(id: string): Promise<{ latest_charge?: string | { id: string } | null }> };
}

const MAX_PAGES = 10;
const idOf = (v: string | { id: string } | null | undefined): string | null => (typeof v === "string" ? v : v?.id ?? null);

async function listAll<T extends { id: string }>(fetchPage: (startingAfter?: string) => Promise<StripePage<T>>): Promise<T[]> {
  const all: T[] = [];
  let startingAfter: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await fetchPage(startingAfter);
    all.push(...res.data);
    if (!res.has_more || res.data.length === 0) break;
    startingAfter = res.data[res.data.length - 1].id;
  }
  return all;
}

export function chargeFactsOf(c: StripeChargeLike): ChargeFacts {
  return {
    status: c.status,
    amountRefundedCents: c.amount_refunded ?? 0,
    refunded: c.refunded ?? false,
    disputed: c.disputed ?? false,
  };
}

export interface FirstChargeTarget {
  charge: StripeChargeLike;
  /** How E2 was resolved — recorded with the verdicts. */
  via: "first_invoice" | "earliest_charge";
}

/** The charge that paid an invoice, or null where the linkage does not resolve. */
async function chargeOfInvoice(stripe: GuaranteeStripe, inv: StripeInvoiceLike): Promise<StripeChargeLike | null> {
  const legacy = idOf(inv.charge);
  if (legacy) return stripe.charges.retrieve(legacy);
  const payments = await stripe.invoicePayments.list({ invoice: inv.id, limit: 10 });
  for (const p of payments.data) {
    if (p.status && p.status !== "paid") continue;
    const direct = p.payment?.type === "charge" ? idOf(p.payment.charge) : null;
    if (direct) return stripe.charges.retrieve(direct);
    const pi = p.payment?.type === "payment_intent" ? idOf(p.payment.payment_intent) : null;
    if (pi) {
      const intent = await stripe.paymentIntents.retrieve(pi);
      const chargeId = idOf(intent.latest_charge);
      if (chargeId) return stripe.charges.retrieve(chargeId);
    }
  }
  return null;
}

const isSubscriptionInvoice = (inv: StripeInvoiceLike): boolean =>
  Boolean(idOf(inv.subscription) || idOf(inv.parent?.subscription_details?.subscription));

/**
 * The org's first subscription charge, or null when the customer has no
 * succeeded charge at all. `creditPurchasePaymentIntentIds` are the org's
 * credit-pack purchases (not subscription charges); the earliest-charge
 * fallback skips them.
 */
export async function resolveFirstSubscriptionCharge(
  stripe: GuaranteeStripe,
  args: { customerId: string; subscriptionId?: string | null; creditPurchasePaymentIntentIds?: ReadonlySet<string> },
): Promise<FirstChargeTarget | null> {
  // 1. The first paid subscription invoice, where the linkage resolves.
  try {
    const invoices = await listAll((startingAfter) =>
      stripe.invoices.list({
        customer: args.customerId,
        ...(args.subscriptionId ? { subscription: args.subscriptionId } : {}),
        limit: 100,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      }),
    );
    const paid = invoices
      .filter((i) => i.status === "paid" && (i.amount_paid ?? 0) > 0 && (args.subscriptionId ? true : isSubscriptionInvoice(i)))
      .sort((a, b) => a.created - b.created);
    for (const inv of paid) {
      const charge = await chargeOfInvoice(stripe, inv);
      if (charge && charge.status === "succeeded") return { charge, via: "first_invoice" };
      // The oldest paid invoice must resolve to a charge; if it does not, fall
      // through to the earliest-charge rule rather than skipping to a later one.
      break;
    }
  } catch {
    // Linkage did not resolve — the fallback below is the design's second rule.
  }

  // 2. The earliest succeeded, non-credit-pack charge of the customer.
  const charges = await listAll((startingAfter) =>
    stripe.charges.list({ customer: args.customerId, limit: 100, ...(startingAfter ? { starting_after: startingAfter } : {}) }),
  );
  const skip = args.creditPurchasePaymentIntentIds ?? new Set<string>();
  const candidates = charges
    .filter((c) => c.status === "succeeded" && c.paid !== false && !skip.has(idOf(c.payment_intent) ?? "\u0000"))
    .sort((a, b) => a.created - b.created);
  return candidates.length > 0 ? { charge: candidates[0], via: "earliest_charge" } : null;
}
