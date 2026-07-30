/**
 * Customer-money routing — "BE THE RAIL, NOT THE PROVIDER".
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE RULING (founder, 2026-07-29)
 * ═══════════════════════════════════════════════════════════════════════════
 * AcreOS's payment architecture applies ONLY to direct subscription payments
 * TO the AcreOS platform (plans, seats, credits, vertical packs, top-ups).
 * Any money a CUSTOMER manages — a borrower's mortgage payment, a tenant's
 * rent — must move on the CUSTOMER'S OWN connected processor account. Never
 * on AcreOS's account. Never with AcreOS taking a cut. Never transiting
 * AcreOS's balance.
 *
 * Asked to choose between "keep a disclosed 2.5% on the org's own account" and
 * "route out entirely", the founder picked ROUTE OUT ENTIRELY: AcreOS gets
 * fully out of the customer-money path, accepting the loss of the fee and
 * accepting that a lender without a connected processor loses in-product card
 * acceptance until they connect one.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT WENT WRONG, AND WHY THIS MODULE IS A CHOKEPOINT RATHER THAN A COMMENT
 * ═══════════════════════════════════════════════════════════════════════════
 * Two live violations were found on 2026-07-29:
 *
 *   V1  `server/routes-borrower.ts` created borrower mortgage Checkout
 *       sessions with NO request options at all — no `stripeAccount`, no
 *       destination, no transfer. Consumer mortgage payments therefore
 *       settled into AcreOS's own platform balance with no payout path, and
 *       AcreOS was merchant of record for money it could not release. There
 *       was no Connect check, so it "worked" for orgs that never connected
 *       Stripe at all.
 *
 *   V2  `server/services/stripeConnect.ts#createPaymentIntent` built
 *       `transfer_data.destination` + a 2.5% `application_fee_amount` with no
 *       `on_behalf_of`, so the platform was settlement merchant and the money
 *       passed THROUGH AcreOS's balance while AcreOS took a cut.
 *
 * Both were omissions, not decisions — a missing second argument and a missing
 * `on_behalf_of`. Prose in a header comment does not catch a missing argument.
 * So the correct shape is asserted HERE, at runtime, on the way to Stripe:
 *
 *   • `resolveOrgCardProcessor` refuses with a TYPED REASON when the org has
 *     no usable connected processor. There is no platform fallback. This is
 *     the payments analogue of the already-banned send-rail re-fronting
 *     (CLAUDE.md, founder decision 2026-07-17) and is equally absolute.
 *
 *   • `prepareCustomerMoneyCall` is the ONLY sanctioned way to build a
 *     customer-money Stripe call. It returns the request options with
 *     `stripeAccount` set, and it THROWS if the params carry any
 *     platform-take key (`application_fee_amount`, `transfer_data`,
 *     `on_behalf_of`, …) at any depth. A future edit that reintroduces a
 *     platform cut fails loudly instead of quietly skimming a borrower.
 *
 * The Wave C ACH lane (`achMandateSetup.ts` / `achAutopay.ts`) already got
 * this right — every call re-scoped with the `stripeAccount` header, plus a
 * refuse-with-typed-reason resolver. This module is the same discipline for
 * CARD, and the two share one processor identity per org (the org's
 * `stripe_connect` account) so card, ACH, mandates, refunds and receipts all
 * reconcile in one place.
 */

import type Stripe from "stripe";
import { storage } from "../storage";
import { logger } from "../utils/logger";
import { isCategorySimulated } from "../utils/simulationMode";

// ───────────────────────────────────────────────────────────────────────────
// Refusals
// ───────────────────────────────────────────────────────────────────────────

/**
 * Why a customer-money card charge cannot be created. Every value is a state
 * the org (or the environment) is actually in — never a guess, and never a
 * reason to fall back to the platform account.
 */
export type CustomerMoneyRefusal =
  | "simulated"
  | "processor_not_connected"
  | "processor_charges_disabled"
  | "card_capability_inactive"
  | "processor_check_failed";

/**
 * Where an operator goes to connect their own processor.
 *
 * HASH, not a query param: `client/src/pages/settings.tsx` reads only the
 * hash (`getTabFromHash`) — `?tab=billing` is silently ignored and lands on
 * the Account tab. A refusal that points somewhere useless is only half an
 * honest refusal.
 */
export const CONNECT_PROCESSOR_PATH = "/settings#billing";

export interface ConnectedProcessor {
  /** The org's own Stripe account id (`acct_…`). Charges are scoped to it. */
  accountId: string;
}

export interface CustomerMoneyRefusalDetail {
  ok: false;
  reason: CustomerMoneyRefusal;
  /**
   * What the ORG's operator is told: names what is missing and where to fix
   * it. Shown in Finance / Settings.
   */
  operatorMessage: string;
  /**
   * What the BORROWER (or other counterparty) is told. A borrower cannot
   * connect their lender's processor, so this never tells them to — it says
   * what is not available and who to talk to.
   */
  borrowerMessage: string;
  /** Route the operator can follow to connect a processor. */
  connectPath: string;
}

export type CustomerMoneyRouting =
  | { ok: true; processor: ConnectedProcessor }
  | CustomerMoneyRefusalDetail;

function refuse(
  reason: CustomerMoneyRefusal,
  operatorMessage: string,
  borrowerMessage: string,
): CustomerMoneyRefusalDetail {
  return {
    ok: false,
    reason,
    operatorMessage,
    borrowerMessage,
    connectPath: CONNECT_PROCESSOR_PATH,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Resolver — injectable so tests need no DATABASE_URL and never reach Stripe
// ───────────────────────────────────────────────────────────────────────────

export interface ProcessorAccountStatus {
  chargesEnabled: boolean;
  /** Stripe capability state string, e.g. "active" | "pending" | "inactive". */
  cardPayments?: string;
}

export interface CustomerMoneyRoutingDeps {
  /** The org's own connected account id, or null when none is stored. */
  getConnectedAccountId(organizationId: number): Promise<string | null>;
  /** Live capability read for that account. */
  getAccountStatus(accountId: string): Promise<ProcessorAccountStatus>;
  /** True when this environment must not touch a real payment rail. */
  isSimulated(): boolean;
}

export const defaultCustomerMoneyRoutingDeps: CustomerMoneyRoutingDeps = {
  async getConnectedAccountId(organizationId: number): Promise<string | null> {
    const integration = await storage.getOrganizationIntegration(
      organizationId,
      "stripe_connect",
    );
    return integration?.credentials?.stripeConnectAccountId ?? null;
  },
  async getAccountStatus(accountId: string): Promise<ProcessorAccountStatus> {
    const { stripeConnectService } = await import("./stripeConnect");
    const status = await stripeConnectService.getAccountStatus(accountId);
    return {
      chargesEnabled: status.chargesEnabled,
      cardPayments: status.capabilities?.cardPayments,
    };
  },
  isSimulated(): boolean {
    return isCategorySimulated("stripe");
  },
};

/**
 * Resolve the org's OWN card processor, or refuse with a reason.
 *
 * Deliberately mirrors `resolveLenderConnectAccount` (Wave C, ACH) rather than
 * reusing it: that one gates on `us_bank_account_ach_payments`, this one gates
 * on `card_payments`. A lender approved for cards but not ACH must still be
 * able to take a card, and vice versa — one shared resolver would refuse both
 * lanes whenever either capability lagged.
 *
 * There is NO fallback branch. If this returns `ok: false`, the caller must
 * surface the refusal; it must not create a charge.
 */
export async function resolveOrgCardProcessor(
  organizationId: number,
  deps: CustomerMoneyRoutingDeps = defaultCustomerMoneyRoutingDeps,
): Promise<CustomerMoneyRouting> {
  if (deps.isSimulated()) {
    return refuse(
      "simulated",
      "Card acceptance is switched off on this environment (simulation mode). No card is charged and no payment is recorded.",
      "Card payments are switched off on this environment. No card was charged.",
    );
  }

  const accountId = await deps.getConnectedAccountId(organizationId);
  if (!accountId) {
    return refuse(
      "processor_not_connected",
      `You haven't connected a payment processor yet, so there's no account for this money to land in. AcreOS never collects your customers' payments into its own account. Connect your Stripe account in Settings → Billing (${CONNECT_PROCESSOR_PATH}) and card acceptance turns on immediately.`,
      "Your lender hasn't finished setting up card payments yet, so this payment can't be taken online right now. No card was charged — contact your lender to arrange payment.",
    );
  }

  let status: ProcessorAccountStatus;
  try {
    status = await deps.getAccountStatus(accountId);
  } catch (err) {
    logger.error(
      "[customerMoneyRouting] Connected-account status check failed",
      err instanceof Error ? err : undefined,
      { organizationId },
    );
    return refuse(
      "processor_check_failed",
      "We couldn't reach Stripe to confirm your connected account can take cards right now. Nothing was charged — try again shortly.",
      "We couldn't confirm your lender's payment setup right now. No card was charged — please try again shortly.",
    );
  }

  if (!status.chargesEnabled) {
    return refuse(
      "processor_charges_disabled",
      `Your connected Stripe account isn't cleared to take charges yet — Stripe still needs some details. Finish onboarding in Settings → Billing (${CONNECT_PROCESSOR_PATH}).`,
      "Your lender's payment account is still being verified, so this payment can't be taken online yet. No card was charged.",
    );
  }

  if (status.cardPayments !== "active") {
    return refuse(
      "card_capability_inactive",
      `Your connected Stripe account doesn't have card payments active yet (capability state: ${status.cardPayments ?? "not requested"}). Finish Stripe onboarding in Settings → Billing (${CONNECT_PROCESSOR_PATH}).`,
      "Your lender isn't approved for card payments yet. No card was charged — contact your lender to arrange payment.",
    );
  }

  return { ok: true, processor: { accountId } };
}

// ───────────────────────────────────────────────────────────────────────────
// The chokepoint — every customer-money Stripe call goes through here
// ───────────────────────────────────────────────────────────────────────────

/**
 * Parameter keys that would put AcreOS back into the money path. Each one is
 * exactly how V1/V2 happened, or how they would happen again:
 *
 *   application_fee_amount / application_fee_percent — AcreOS taking a cut.
 *   transfer_data                                    — platform is settlement
 *                                                      merchant, funds transit
 *                                                      AcreOS's balance.
 *   on_behalf_of                                     — legal for a direct
 *                                                      charge but meaningless
 *                                                      here (the charge is
 *                                                      ALREADY on the org's
 *                                                      account); its presence
 *                                                      means someone is
 *                                                      rebuilding a
 *                                                      destination charge.
 */
export const PLATFORM_TAKE_PARAM_KEYS = [
  "application_fee_amount",
  "application_fee_percent",
  "transfer_data",
  "on_behalf_of",
] as const;

export class PlatformTakeError extends Error {
  constructor(
    readonly callLabel: string,
    readonly offendingKey: string,
    readonly keyPath: string,
  ) {
    super(
      `Customer-money Stripe call "${callLabel}" carries "${keyPath}". ` +
        `Customer money moves on the org's OWN processor account with no ` +
        `AcreOS cut and no transit through AcreOS's balance (founder ruling ` +
        `2026-07-29, "be the rail, not the provider"). Remove ${offendingKey}, ` +
        `or route the charge through AcreOS-as-vendor billing if it really is ` +
        `AcreOS revenue.`,
    );
    this.name = "PlatformTakeError";
  }
}

export class UnscopedCustomerMoneyCallError extends Error {
  constructor(readonly callLabel: string) {
    super(
      `Customer-money Stripe call "${callLabel}" was built without a ` +
        `stripeAccount scope. It would settle into AcreOS's platform balance ` +
        `— the exact defect found on 2026-07-29. Resolve the org's own ` +
        `processor with resolveOrgCardProcessor() first, and refuse if it ` +
        `isn't connected.`,
    );
    this.name = "UnscopedCustomerMoneyCallError";
  }
}

/**
 * Deep scan for platform-take keys. Recursive because the shapes that matter
 * nest them: Checkout hides `application_fee_amount` under
 * `payment_intent_data`, Payment Links under `transfer_data`, Subscriptions
 * under `application_fee_percent`. A shallow check would have missed V2's
 * successor.
 */
export function assertNoPlatformTake(callLabel: string, params: unknown, keyPath = ""): void {
  if (params === null || typeof params !== "object") return;
  if (Array.isArray(params)) {
    params.forEach((entry, i) => assertNoPlatformTake(callLabel, entry, `${keyPath}[${i}]`));
    return;
  }
  for (const [key, value] of Object.entries(params as Record<string, unknown>)) {
    const path = keyPath ? `${keyPath}.${key}` : key;
    if ((PLATFORM_TAKE_PARAM_KEYS as readonly string[]).includes(key)) {
      // `undefined` is not a take — an optional field left unset is fine.
      if (value !== undefined) throw new PlatformTakeError(callLabel, key, path);
      continue;
    }
    assertNoPlatformTake(callLabel, value, path);
  }
}

/**
 * Build the request options for a customer-money Stripe call, asserting the
 * two invariants that keep AcreOS out of the money path.
 *
 * Use it at EVERY customer-money call site:
 *
 *   const { params, options } = prepareCustomerMoneyCall(
 *     "borrower.card.checkout", checkoutParams, processor,
 *   );
 *   await stripe.checkout.sessions.create(params, options);
 *
 * @throws PlatformTakeError            params carry an AcreOS cut / destination
 * @throws UnscopedCustomerMoneyCallError  no org account to scope to
 */
export function prepareCustomerMoneyCall<P extends object>(
  callLabel: string,
  params: P,
  processor: ConnectedProcessor,
  extraOptions?: Omit<Stripe.RequestOptions, "stripeAccount">,
): { params: P; options: Stripe.RequestOptions } {
  if (!processor?.accountId) throw new UnscopedCustomerMoneyCallError(callLabel);
  assertNoPlatformTake(callLabel, params);
  return {
    params,
    options: { ...(extraOptions ?? {}), stripeAccount: processor.accountId },
  };
}

/**
 * Read-side twin of `prepareCustomerMoneyCall`. A retrieve on a direct charge
 * MUST be scoped too — an unscoped retrieve looks in AcreOS's account, finds
 * nothing, and a caller that treats "not found" as "not paid" would tell a
 * borrower who really paid that they hadn't.
 */
export function customerMoneyReadOptions(processor: ConnectedProcessor, callLabel: string): Stripe.RequestOptions {
  if (!processor?.accountId) throw new UnscopedCustomerMoneyCallError(callLabel);
  return { stripeAccount: processor.accountId };
}

// ───────────────────────────────────────────────────────────────────────────
// Borrower card checkout — the params, built in one place
// ───────────────────────────────────────────────────────────────────────────

export interface BorrowerCardCheckoutInput {
  noteId: number;
  organizationId: number;
  /** The org's display name. Named in the line item so the borrower sees WHO is collecting. */
  lenderName: string;
  borrowerName: string;
  borrowerEmail?: string;
  amountCents: number;
  /** Absolute origin used to build the return URLs. */
  baseUrl: string;
  /** Portal access token used in the return URLs (legacy + session paths share it). */
  accessToken: string;
  /** Distinguishes the session-based path from the deprecated token path in logs/metadata. */
  source: "session" | "legacy_token";
}

/**
 * The Checkout params for a borrower card payment.
 *
 * Two things here are load-bearing beyond the mechanics:
 *
 *   1. The line item names the LENDER, not AcreOS. Hosted Checkout on a
 *      connected account already shows the connected account's business name
 *      as the merchant, and the statement descriptor comes from that account —
 *      but the borrower reads the line item first, and the portal is
 *      AcreOS-branded, so it has to say who is collecting.
 *   2. There is no fee field of any kind. `assertNoPlatformTake` enforces that
 *      mechanically; this builder makes it true by construction.
 */
export function buildBorrowerCardCheckoutParams(
  input: BorrowerCardCheckoutInput,
): Stripe.Checkout.SessionCreateParams {
  const returnBase = `${input.baseUrl}/portal/${input.accessToken}`;
  return {
    payment_method_types: ["card"],
    line_items: [
      {
        price_data: {
          currency: "usd",
          product_data: {
            name: `Loan payment to ${input.lenderName} — Note #${input.noteId}`,
            description: `Payment from ${input.borrowerName}. Collected by ${input.lenderName}; AcreOS is the software your lender uses and does not take a cut of this payment.`,
          },
          unit_amount: input.amountCents,
        },
        quantity: 1,
      },
    ],
    mode: "payment",
    success_url: `${returnBase}?payment=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${returnBase}?payment=cancelled`,
    ...(input.borrowerEmail ? { customer_email: input.borrowerEmail } : {}),
    metadata: {
      noteId: String(input.noteId),
      organizationId: String(input.organizationId),
      accessToken: input.accessToken,
      paymentAmount: (input.amountCents / 100).toString(),
      type: "borrower_portal_payment",
      source: input.source,
    },
  };
}
