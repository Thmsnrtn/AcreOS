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
import { addMonths } from "../utils/dateUtils";
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

  /**
   * A customer-money PaymentIntent on the ORG'S OWN account.
   *
   * Direct charge (`stripeAccount` header), no `application_fee_amount`, no
   * `transfer_data`. The returned `client_secret` is only confirmable by
   * Stripe.js initialised with `stripeAccount: <connectedAccountId>`, which is
   * why `createCustomerMoneyPaymentIntent` (below) hands the account id back to
   * the caller instead of leaving the client to guess it.
   */
  async createPaymentIntent(
    organizationId: number,
    amount: number,
    currency: string = "usd",
    metadata: {
      noteId?: number;
      propertyId?: number;
      paymentType: "note_payment" | "cash_sale" | "down_payment";
      description?: string;
    }
  ): Promise<Stripe.PaymentIntent> {
    const result = await this.createCustomerMoneyPaymentIntent(organizationId, amount, currency, metadata);
    if (!result.ok) throw new CustomerMoneyRefusedError(result.reason, result.operatorMessage);
    return result.paymentIntent;
  }

  /**
   * Refusal-returning form. Callers that can render a reason (routes) should
   * use this; `createPaymentIntent` is the throwing wrapper kept for existing
   * call sites.
   */
  async createCustomerMoneyPaymentIntent(
    organizationId: number,
    amount: number,
    currency: string = "usd",
    metadata: {
      noteId?: number;
      propertyId?: number;
      paymentType: "note_payment" | "cash_sale" | "down_payment";
      description?: string;
    }
  ): Promise<
    | { ok: true; paymentIntent: Stripe.PaymentIntent; connectedAccountId: string }
    | { ok: false; reason: CustomerMoneyRefusal; operatorMessage: string; connectPath: string }
  > {
    const routing = await resolveOrgCardProcessor(organizationId);
    if (!routing.ok) {
      logger.warn("Customer-money payment intent refused — org has no usable card processor", {
        metadata: { organizationId, reason: routing.reason, paymentType: metadata.paymentType },
      });
      return {
        ok: false,
        reason: routing.reason,
        operatorMessage: routing.operatorMessage,
        connectPath: routing.connectPath,
      };
    }

    const paymentMetadata: Record<string, string> = {
      organizationId: String(organizationId),
      paymentType: metadata.paymentType,
    };
    if (metadata.noteId) paymentMetadata.noteId = String(metadata.noteId);
    if (metadata.propertyId) paymentMetadata.propertyId = String(metadata.propertyId);

    const stripe = getStripeClient();
    if (!stripe) {
      throw new Error("Stripe is not configured. Please contact support to enable payment processing.");
    }

    const { params, options } = prepareCustomerMoneyCall(
      "connect.customer_money.payment_intent",
      {
        amount,
        currency,
        metadata: paymentMetadata,
        description: metadata.description,
      } satisfies Stripe.PaymentIntentCreateParams,
      routing.processor,
    );

    const paymentIntent = await stripe.paymentIntents.create(params, options);
    return { ok: true, paymentIntent, connectedAccountId: routing.processor.accountId };
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
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.metadata?.type === "borrower_portal_payment") {
          const { WebhookHandlers } = await import("../webhookHandlers");
          await WebhookHandlers.processBorrowerPortalPayment(session);
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
        const subscriptionId = typeof (invoice as any).subscription === "string" ? (invoice as any).subscription : (invoice as any).subscription?.id;
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

  private async handleSuccessfulPayment(paymentIntent: Stripe.PaymentIntent): Promise<void> {
    const organizationId = paymentIntent.metadata?.organizationId;
    const noteId = paymentIntent.metadata?.noteId;
    const paymentType = paymentIntent.metadata?.paymentType;

    if (!organizationId) {
      logger.error("No organizationId in payment intent metadata");
      return;
    }

    if (paymentType === "note_payment" && noteId) {
      const note = await storage.getNote(Number(organizationId), Number(noteId));
      if (note) {
        const amountPaid = paymentIntent.amount / 100;
        const currentBalance = Number(note.currentBalance || note.originalPrincipal);
        const monthlyRate = Number(note.interestRate) / 100 / 12;
        const interestPortion = currentBalance * monthlyRate;
        const principalPortion = Math.max(0, amountPaid - interestPortion);
        const newBalance = Math.max(0, currentBalance - principalPortion);

        await storage.createPayment({
          organizationId: Number(organizationId),
          noteId: Number(noteId),
          amount: String(amountPaid),
          principalAmount: String(principalPortion),
          interestAmount: String(interestPortion),
          paymentDate: new Date(),
          dueDate: note.nextPaymentDate || new Date(),
          paymentMethod: "stripe",
          transactionId: paymentIntent.id,
          status: "completed",
        });

        const schedule = note.amortizationSchedule || [];
        const nextPendingPayment = schedule.find((s: any) => s.status === "pending");

        let updatedSchedule = schedule;
        if (nextPendingPayment) {
          updatedSchedule = schedule.map((s: any) =>
            s.paymentNumber === nextPendingPayment.paymentNumber
              ? { ...s, status: "paid" }
              : s
          );
        }

        const nextPaymentDate = addMonths(new Date(note.nextPaymentDate || new Date()), 1);

        let noteStatus = note.status;
        if (newBalance <= 0) {
          noteStatus = "paid_off";
        } else if (noteStatus === "late" || noteStatus === "delinquent") {
          noteStatus = "active";
        }

        await storage.updateNote(Number(noteId), {
          currentBalance: String(newBalance),
          amortizationSchedule: updatedSchedule,
          nextPaymentDate: nextPaymentDate,
          status: noteStatus,
        }, Number(organizationId));
      }
    }

    logger.info(`Payment succeeded: ${paymentIntent.id} for org ${organizationId}`);
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
