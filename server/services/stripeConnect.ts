import Stripe from "stripe";
import { storage } from "../storage";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "");

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
    const baseUrl = process.env.REPLIT_DEV_DOMAIN 
      ? `https://${process.env.REPLIT_DEV_DOMAIN}`
      : process.env.APP_URL || "http://localhost:5000";

    return stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${baseUrl}/settings?stripe_refresh=true`,
      return_url: `${baseUrl}/settings?stripe_connected=true`,
      type: "account_onboarding",
    });
  }

  async getAccountStatus(accountId: string): Promise<StripeConnectStatus> {
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
      console.error("Error retrieving Stripe account:", error);
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
      settings: existing?.settings || {
        stripeConnectOnboardingComplete: false,
        stripeApplicationFeePercent: 2.5,
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
    const integration = await storage.getOrganizationIntegration(organizationId, "stripe_connect");
    
    if (!integration?.credentials?.stripeConnectAccountId) {
      throw new Error("Stripe Connect account not configured");
    }

    const accountId = integration.credentials.stripeConnectAccountId;
    const applicationFeePercent = integration.settings?.stripeApplicationFeePercent || 2.5;
    const applicationFeeAmount = Math.round(amount * (applicationFeePercent / 100));

    const paymentMetadata: Record<string, string> = {
      organizationId: String(organizationId),
      paymentType: metadata.paymentType,
    };
    if (metadata.noteId) paymentMetadata.noteId = String(metadata.noteId);
    if (metadata.propertyId) paymentMetadata.propertyId = String(metadata.propertyId);

    return stripe.paymentIntents.create({
      amount,
      currency,
      application_fee_amount: applicationFeeAmount,
      transfer_data: {
        destination: accountId,
      },
      metadata: paymentMetadata,
      description: metadata.description,
    });
  }

  async createSetupIntent(
    organizationId: number,
    customerId: string
  ): Promise<Stripe.SetupIntent> {
    const integration = await storage.getOrganizationIntegration(organizationId, "stripe_connect");
    
    if (!integration?.credentials?.stripeConnectAccountId) {
      throw new Error("Stripe Connect account not configured");
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

      default:
        console.log(`Unhandled Stripe webhook event: ${event.type}`);
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
      console.error("No organizationId in payment intent metadata");
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

        let noteStatus = note.status;
        if (newBalance <= 0) {
          noteStatus = "paid_off";
        } else if (noteStatus === "late" || noteStatus === "delinquent") {
          noteStatus = "active";
        }

        await storage.updateNote(Number(noteId), {
          currentBalance: String(newBalance),
          status: noteStatus,
        });
      }
    }

    console.log(`Payment succeeded: ${paymentIntent.id} for org ${organizationId}`);
  }

  private async handleFailedPayment(paymentIntent: Stripe.PaymentIntent): Promise<void> {
    const organizationId = paymentIntent.metadata?.organizationId;
    const noteId = paymentIntent.metadata?.noteId;

    console.error(`Payment failed: ${paymentIntent.id} for org ${organizationId}, note ${noteId}`);
    console.error(`Failure reason: ${paymentIntent.last_payment_error?.message}`);
  }

  async getPaymentLink(
    organizationId: number,
    noteId: number,
    amount: number
  ): Promise<string> {
    const integration = await storage.getOrganizationIntegration(organizationId, "stripe_connect");
    
    if (!integration?.credentials?.stripeConnectAccountId) {
      throw new Error("Stripe Connect account not configured");
    }

    const note = await storage.getNote(organizationId, noteId);
    if (!note) {
      throw new Error("Note not found");
    }

    const paymentIntent = await this.createPaymentIntent(organizationId, amount * 100, "usd", {
      noteId,
      paymentType: "note_payment",
      description: `Payment for Note #${noteId}`,
    });

    const baseUrl = process.env.REPLIT_DEV_DOMAIN 
      ? `https://${process.env.REPLIT_DEV_DOMAIN}`
      : process.env.APP_URL || "http://localhost:5000";

    return `${baseUrl}/pay/${paymentIntent.client_secret}`;
  }
}

export const stripeConnectService = StripeConnectService.getInstance();
