/**
 * Stripe Connect — onboarding the ORG'S OWN processor, and charging on it.
 *
 * CUSTODY (founder ruling 2026-07-29, "be the rail, not the provider")
 * ───────────────────────────────────────────────────────────────────────────
 * Every charge created here is CUSTOMER money (a borrower's note payment, a
 * cash sale, a down payment). It is a DIRECT charge on the org's own connected
 * account — scoped with the `stripeAccount` header — so the org is merchant of
 * record, the funds settle into the org's balance, and AcreOS takes nothing.
 *
 * Until 2026-07-29 `createPaymentIntent` built `transfer_data.destination`
 * plus a 2.5% `application_fee_amount` with no `on_behalf_of`. That made
 * AcreOS the settlement merchant on consumer mortgage payments, passed the
 * money through AcreOS's balance, and skimmed a cut of it. Both the fee and
 * the destination-charge shape are gone. `prepareCustomerMoneyCall` now
 * asserts, at runtime, that neither can come back — see
 * `server/services/customerMoneyRouting.ts` for the full reasoning.
 *
 * AcreOS-as-vendor billing (plans, seats, credits, packs, top-ups) is a
 * DIFFERENT lane and is untouched by this: it lives in `stripeService.ts` /
 * `routes-billing.ts` subscription paths and charges on AcreOS's own account,
 * as it should. The only AcreOS-account calls in THIS file are account
 * lifecycle (`accounts.create`, `accountLinks.create`, `accounts.retrieve`),
 * which move no money.
 */

import Stripe from "stripe";
import { storage } from "../storage";
import { logger } from "../utils/logger";
import { STRIPE_API_VERSION } from "../stripeClient";
import {
  resolveOrgCardProcessor,
  prepareCustomerMoneyCall,
  type CustomerMoneyRefusal,
} from "./customerMoneyRouting";

function isStripeConfigured(): boolean {
  return !!process.env.STRIPE_SECRET_KEY;
}

function getStripeClient(): Stripe | null {
  if (!isStripeConfigured()) {
    return null;
  }
  return new Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion: STRIPE_API_VERSION,
    maxNetworkRetries: 3,
  });
}

/**
 * Thrown by the legacy throwing wrappers when the org has no usable processor.
 * Carries the typed reason so routes can answer honestly instead of mapping a
 * substring of an error message.
 */
export class CustomerMoneyRefusedError extends Error {
  constructor(
    readonly reason: CustomerMoneyRefusal,
    message: string,
  ) {
    super(message);
    this.name = "CustomerMoneyRefusedError";
  }
}

/**
 * THE EVENTS THE CONNECT ENDPOINT MUST BE SUBSCRIBED TO.
 *
 * ── WHY THIS IS A CONSTANT AND NOT A LIST IN THE SETUP ROUTE ─────────────
 * `routes-setup.ts` provisions the webhook endpoint at
 * `${APP_URL}/api/stripe/connect/webhook` with an `enabled_events` array —
 * and Stripe DELIVERS NOTHING that is not in it. That array was hand-written
 * and had drifted badly: it listed `customer.subscription.*`,
 * `invoice.payment_succeeded` and `charge.dispute.created` (none of which
 * `handleWebhookEvent` below dispatches on) while omitting `account.updated`,
 * `checkout.session.completed`, `invoice.paid` and `charge.refunded` (all of
 * which it does). A handler for an event the endpoint never receives is
 * "built but unwired" with a green test suite: the branch is real, the code
 * is reachable in a unit test, and in production the event simply never
 * arrives.
 *
 * So the subscription list lives HERE, next to the switch it must mirror, and
 * the setup route imports it — one definition, and `stripeConnectWebhookEvents.test.ts`
 * DERIVES the handled set from this file's actual `case` labels and fails if
 * the two ever diverge again.
 *
 * Ordinary payment-failure/rescue events (`invoice.*`) stay in the list even
 * though they concern AcreOS's own subscription billing: `handleWebhookEvent`
 * dispatches them to dunning, so they are handled here in fact.
 */
export const STRIPE_CONNECT_WEBHOOK_EVENTS = [
  "account.updated",
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "charge.refunded",
  "payment_intent.succeeded",
  "payment_intent.payment_failed",
  "invoice.payment_failed",
  "invoice.paid",
] as const;

export interface StripeConnectStatus {
  isConnected: boolean;
  accountId?: string;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  capabilities?: {
    cardPayments?: string;
    transfers?: string;
    usBankAccountAchPayments?: string;
  };
  requirements?: {
    currentlyDue: string[];
    eventuallyDue: string[];
    pastDue: string[];
  };
  businessProfile?: {
    name?: string;
    url?: string;
  };
}

export class StripeConnectService {
  private static instance: StripeConnectService;

  private constructor() {}

  static getInstance(): StripeConnectService {
    if (!StripeConnectService.instance) {
      StripeConnectService.instance = new StripeConnectService();
    }
    return StripeConnectService.instance;
  }

  async createConnectedAccount(
    organizationId: number,
    email: string,
    businessName?: string
  ): Promise<{ accountId: string; onboardingUrl: string }> {
    const stripe = getStripeClient();
    if (!stripe) {
      throw new Error("Stripe is not configured. Please contact support to enable payment processing.");
    }
    
    const account = await stripe.accounts.create({
      type: "express",
      email,
      business_profile: {
        name: businessName,
        product_description: "Land investment and seller financing services",
      },
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
        us_bank_account_ach_payments: { requested: true },
      },
      settings: {
        payouts: {
          schedule: {
            interval: "daily",
          },
        },
      },
    });

    await this.saveConnectedAccount(organizationId, account.id);

    const accountLink = await this.createOnboardingLink(account.id);

    return {
      accountId: account.id,
      onboardingUrl: accountLink.url,
    };
  }

  async createOnboardingLink(accountId: string): Promise<Stripe.AccountLink> {
    const stripe = getStripeClient();
    if (!stripe) {
      throw new Error("Stripe is not configured. Please contact support to enable payment processing.");
    }
    
    const baseUrl = process.env.APP_URL || "http://localhost:5000";

    return stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${baseUrl}/settings?stripe_refresh=true`,
      return_url: `${baseUrl}/settings?stripe_connected=true`,
      type: "account_onboarding",
    });
  }

  async getAccountStatus(accountId: string): Promise<StripeConnectStatus> {
    const stripe = getStripeClient();
    if (!stripe) {
      return {
        isConnected: false,
        chargesEnabled: false,
        payoutsEnabled: false,
        detailsSubmitted: false,
      };
    }
    
    try {
      const account = await stripe.accounts.retrieve(accountId);

      return {
        isConnected: true,
        accountId: account.id,
        chargesEnabled: account.charges_enabled || false,
        payoutsEnabled: account.payouts_enabled || false,
        detailsSubmitted: account.details_submitted || false,
        capabilities: {
          cardPayments: account.capabilities?.card_payments,
          transfers: account.capabilities?.transfers,
          usBankAccountAchPayments: account.capabilities?.us_bank_account_ach_payments,
        },
        requirements: account.requirements ? {
          currentlyDue: account.requirements.currently_due || [],
          eventuallyDue: account.requirements.eventually_due || [],
          pastDue: account.requirements.past_due || [],
        } : undefined,
        businessProfile: {
          name: account.business_profile?.name || undefined,
          url: account.business_profile?.url || undefined,
        },
      };
    } catch (error) {
      logger.error("Error retrieving Stripe account", error);
      return {
        isConnected: false,
        chargesEnabled: false,
        payoutsEnabled: false,
        detailsSubmitted: false,
      };
    }
  }

  async getOrganizationConnectStatus(organizationId: number): Promise<StripeConnectStatus> {
    const integration = await storage.getOrganizationIntegration(organizationId, "stripe_connect");
    
    if (!integration || !integration.credentials?.stripeConnectAccountId) {
      return {
        isConnected: false,
        chargesEnabled: false,
        payoutsEnabled: false,
        detailsSubmitted: false,
      };
    }

    return this.getAccountStatus(integration.credentials.stripeConnectAccountId);
  }

  async saveConnectedAccount(organizationId: number, accountId: string): Promise<void> {
    const existing = await storage.getOrganizationIntegration(organizationId, "stripe_connect");
    
    await storage.upsertOrganizationIntegration({
      organizationId,
      provider: "stripe_connect",
      isEnabled: true,
      credentials: {
        ...(existing?.credentials || {}),
        stripeConnectAccountId: accountId,
      },
      // No `stripeApplicationFeePercent`. AcreOS takes no cut of customer
      // money (founder ruling 2026-07-29) — storing a fee percent here is
      // what made the old 2.5% destination charge look sanctioned.
      settings: existing?.settings || {
        stripeConnectOnboardingComplete: false,
      },
      lastValidatedAt: new Date(),
    });
  }

  async updateAccountStatus(organizationId: number, accountId: string): Promise<void> {
    const status = await this.getAccountStatus(accountId);
    const integration = await storage.getOrganizationIntegration(organizationId, "stripe_connect");
    
    if (integration) {
      await storage.upsertOrganizationIntegration({
        organizationId,
        provider: "stripe_connect",
        isEnabled: integration.isEnabled ?? true,
        credentials: integration.credentials,
        settings: {
          ...integration.settings,
          stripeConnectOnboardingComplete: status.detailsSubmitted,
          stripeConnectPayoutsEnabled: status.payoutsEnabled,
          stripeConnectChargesEnabled: status.chargesEnabled,
          stripeConnectCapabilities: {
            cardPayments: status.capabilities?.cardPayments === "active",
            transfers: status.capabilities?.transfers === "active",
            achPayments: status.capabilities?.usBankAccountAchPayments === "active",
          },
        },
        lastValidatedAt: new Date(),
        validationError: status.requirements?.currentlyDue?.length 
          ? `Pending requirements: ${status.requirements.currentlyDue.join(", ")}`
          : undefined,
      });
    }
  }

  async disconnectAccount(organizationId: number): Promise<void> {
    await storage.deleteOrganizationIntegration(organizationId, "stripe_connect");
  }

  async createSetupIntent(
    organizationId: number,
    customerId: string
  ): Promise<Stripe.SetupIntent> {
    const integration = await storage.getOrganizationIntegration(organizationId, "stripe_connect");
    
    if (!integration?.credentials?.stripeConnectAccountId) {
      throw new Error("Stripe Connect account not configured");
    }

    const stripe = getStripeClient();
    if (!stripe) {
      throw new Error("Stripe is not configured. Please contact support to enable payment processing.");
    }
    
    return stripe.setupIntents.create(
      {
        customer: customerId,
        payment_method_types: ["card", "us_bank_account"],
      },
      {
        stripeAccount: integration.credentials.stripeConnectAccountId,
      }
    );
  }

  async createCustomerOnConnectedAccount(
    organizationId: number,
    email: string,
    name: string,
    metadata?: { leadId?: number; noteId?: number }
  ): Promise<Stripe.Customer> {
    const integration = await storage.getOrganizationIntegration(organizationId, "stripe_connect");
    
    if (!integration?.credentials?.stripeConnectAccountId) {
      throw new Error("Stripe Connect account not configured");
    }

    const customerMetadata: Record<string, string> = {};
    if (metadata?.leadId) customerMetadata.leadId = String(metadata.leadId);
    if (metadata?.noteId) customerMetadata.noteId = String(metadata.noteId);

    const stripe = getStripeClient();
    if (!stripe) {
      throw new Error("Stripe is not configured. Please contact support to enable payment processing.");
    }
    
    return stripe.customers.create(
      {
        email,
        name,
        metadata: customerMetadata,
      },
      {
        stripeAccount: integration.credentials.stripeConnectAccountId,
      }
    );
  }

  async handleWebhookEvent(event: Stripe.Event): Promise<void> {
    switch (event.type) {
      case "account.updated": {
        const account = event.data.object as Stripe.Account;
        const integration = await this.findIntegrationByAccountId(account.id);
        if (integration) {
          await this.updateAccountStatus(integration.organizationId, account.id);
        }
        break;
      }

      // Borrower card payments are DIRECT charges on the lender's connected
      // account (2026-07-29), so their `checkout.session.completed` now arrives
      // here as a Connect event rather than on the platform endpoint. Without
      // this branch the ledger row would silently never be written — the
      // "built but unwired" defect this repo keeps repeating.
      // A delayed-settlement method (ACH debit on a Payment Link) completes
      // the session UNPAID — the posting rule refuses it before any write —
      // and settles later as `async_payment_succeeded` with payment_status
      // "paid". Both route to the same rule, keyed on the same session, so
      // whichever carries "paid" posts exactly once. Until slice A retired
      // the PaymentIntent writer, `payment_intent.succeeded` posted these;
      // without this label nothing would.
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.metadata?.type === "borrower_portal_payment") {
          const { WebhookHandlers } = await import("../webhookHandlers");
          await WebhookHandlers.processBorrowerPortalPayment(session);
        } else if (session.metadata?.paymentType === "note_payment") {
          // A lender-shared Payment Link (getPaymentLink) — posted by the same
          // rule as the portal, keyed on this session (DEFECT-0116).
          const { WebhookHandlers } = await import("../webhookHandlers");
          await WebhookHandlers.processPaymentLinkNotePayment(session, event.account ?? null);
        }
        break;
      }

      // ── Money going back OUT ────────────────────────────────────────
      // A lender refunding a borrower's card payment on their own account is
      // a LEDGER EVENT, not a notification. webhookHandlers' PLATFORM
      // dispatcher already had a `charge.refunded` branch, but it reverses
      // AcreOS's own subscription revenue recognition and never sees this
      // event: a borrower's charge is DIRECT on the lender's account, so the
      // refund arrives HERE. Until this branch existed it landed in
      // `default:` as "Unhandled Stripe webhook event": the payment row
      // stood, the balance stayed reduced, and Form 1098 Box 1 reported
      // mortgage interest the borrower never actually paid — to the IRS,
      // under that borrower's real TIN. `charge.refunded` fires for partial
      // refunds too, which is why the handler proportions rather than
      // reversing whole rows.
      case "charge.refunded": {
        const charge = event.data.object as Stripe.Charge;
        const { WebhookHandlers } = await import("../webhookHandlers");
        await WebhookHandlers.processBorrowerPaymentRefund(charge, event.account ?? null);
        break;
      }

      case "payment_intent.succeeded": {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        await this.handleSuccessfulPayment(paymentIntent);
        break;
      }

      case "payment_intent.payment_failed": {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        await this.handleFailedPayment(paymentIntent);
        break;
      }

      // ── Subscription billing failures → dunning flow ───────────────────
      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = typeof invoice.customer === "string" ? invoice.customer : (invoice.customer as any)?.id;
        // See invoiceSubscriptionId: the old top-level field does not exist in
        // the pinned API version, so this was always undefined.
        const { invoiceSubscriptionId } = await import("../stripeClient");
        const subscriptionId = invoiceSubscriptionId(invoice);
        if (customerId) {
          try {
            // Find org by Stripe customer ID
            const org = await storage.getOrganizationByStripeCustomerId(customerId);
            if (org) {
              const { dunningService } = await import("./dunning");
              await dunningService.handlePaymentFailed(
                org.id,
                invoice.id,
                subscriptionId ?? "",
                invoice.amount_due ?? 0,
                invoice.attempt_count ?? 1
              );
            }
          } catch (err: any) {
            logger.error(`[StripeWebhook] Dunning error for invoice ${invoice.id}`, err);
          }
        }
        break;
      }

      case "invoice.paid": {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = typeof invoice.customer === "string" ? invoice.customer : (invoice.customer as any)?.id;
        if (customerId) {
          try {
            const org = await storage.getOrganizationByStripeCustomerId(customerId);
            if (org) {
              const { dunningService } = await import("./dunning");
              await dunningService.handlePaymentRecovered(org.id);
            }
          } catch (err: any) {
            logger.error(`[StripeWebhook] Dunning recovery error`, err);
          }
        }
        break;
      }

      default:
        logger.info(`Unhandled Stripe webhook event: ${event.type}`);
    }
  }

  private async findIntegrationByAccountId(accountId: string) {
    return storage.findOrganizationIntegrationByCredential("stripe_connect", "stripeConnectAccountId", accountId);
  }

  /**
   * `payment_intent.succeeded` is OBSERVED, never posted (DEFECT-0116).
   *
   * Until 2026-09-27 this method posted lender-shared Payment Link payments
   * with a float split, no late fee, an installment marked paid for any
   * amount and no workflow event — and keyed the row on `pi_…`, which the
   * portal-keyed (`cs_…`) refund handler could never match. Stripe delivers
   * this event and `checkout.session.completed` in no guaranteed order, so a
   * second writer keyed differently cannot be deduped by ON CONFLICT. The
   * session path (`processPaymentLinkNotePayment`) is now the only writer.
   *
   * Portal Checkout PaymentIntents carry no metadata at all
   * (`buildBorrowerCardCheckoutParams` sets no `payment_intent_data`), so an
   * empty organizationId here is the ordinary case, not an error.
   */
  private async handleSuccessfulPayment(paymentIntent: Stripe.PaymentIntent): Promise<void> {
    logger.debug("Stripe Connect payment_intent.succeeded observed (posting is session-keyed)", {
      metadata: {
        paymentIntentId: paymentIntent.id,
        organizationId: paymentIntent.metadata?.organizationId ?? null,
        paymentType: paymentIntent.metadata?.paymentType ?? null,
      },
    });
  }

  private async handleFailedPayment(paymentIntent: Stripe.PaymentIntent): Promise<void> {
    const organizationId = paymentIntent.metadata?.organizationId;
    const noteId = paymentIntent.metadata?.noteId;

    logger.error(`Payment failed: ${paymentIntent.id} for org ${organizationId}, note ${noteId}`);
    logger.error(`Failure reason: ${paymentIntent.last_payment_error?.message}`);
  }

  /**
   * A shareable payment link for a note payment, hosted BY STRIPE on the org's
   * OWN connected account.
   *
   * Before 2026-07-29 this minted a real, chargeable PaymentIntent and returned
   * `${APP_URL}/pay/<client_secret>` — a route that does not exist in
   * `client/src/App.tsx`. So every "Generate payment link" click created a live
   * chargeable intent and handed the operator a 404 to send a borrower. Two
   * defects in one line: a dead link, and a dangling chargeable object.
   *
   * The fix is a real Stripe Payment Link created on the connected account.
   * Stripe hosts it (`https://buy.stripe.com/…`), branded by the lender's own
   * account, settling into the lender's own balance, with no AcreOS fee and no
   * AcreOS-hosted page in the middle. Nothing is charged until the borrower
   * actually pays, so an unused link leaves no chargeable object behind.
   */
  async getPaymentLink(
    organizationId: number,
    noteId: number,
    amount: number
  ): Promise<{ url: string; paymentLinkId: string }> {
    const note = await storage.getNote(organizationId, noteId);
    if (!note) {
      throw new Error("Note not found");
    }

    const routing = await resolveOrgCardProcessor(organizationId);
    if (!routing.ok) {
      logger.warn("Customer-money payment link refused — org has no usable card processor", {
        metadata: { organizationId, noteId, reason: routing.reason },
      });
      throw new CustomerMoneyRefusedError(routing.reason, routing.operatorMessage);
    }

    const stripe = getStripeClient();
    if (!stripe) {
      throw new Error("Stripe is not configured. Please contact support to enable payment processing.");
    }

    const org = await storage.getOrganization(organizationId);
    const lenderName = org?.name || "your lender";

    // A Payment Link needs a Price, and both objects must live on the same
    // (connected) account as the eventual charge.
    const pricePrep = prepareCustomerMoneyCall(
      "connect.customer_money.price",
      {
        currency: "usd",
        unit_amount: Math.round(amount * 100),
        product_data: { name: `Loan payment to ${lenderName} — Note #${noteId}` },
      } satisfies Stripe.PriceCreateParams,
      routing.processor,
    );
    const price = await stripe.prices.create(pricePrep.params, pricePrep.options);

    const linkPrep = prepareCustomerMoneyCall(
      "connect.customer_money.payment_link",
      {
        line_items: [{ price: price.id, quantity: 1 }],
        metadata: {
          organizationId: String(organizationId),
          noteId: String(noteId),
          paymentType: "note_payment",
        },
        payment_intent_data: {
          metadata: {
            organizationId: String(organizationId),
            noteId: String(noteId),
            paymentType: "note_payment",
          },
        },
      } satisfies Stripe.PaymentLinkCreateParams,
      routing.processor,
    );
    const link = await stripe.paymentLinks.create(linkPrep.params, linkPrep.options);

    return { url: link.url, paymentLinkId: link.id };
  }
}

export const stripeConnectService = StripeConnectService.getInstance();
