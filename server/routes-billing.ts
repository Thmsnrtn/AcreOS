import type { Express } from "express";
import express from "express";
import { storage } from "./storage";
import { SUBSCRIPTION_TIERS } from "@shared/schema";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { getAllUsageLimits, type SubscriptionTier, TIER_LIMITS } from "./services/usageLimits";
import { idempotencyMiddleware } from "./middleware/idempotency";

const logger = {
  info: (msg: string, meta?: Record<string, any>) => console.log(JSON.stringify({ level: 'INFO', timestamp: new Date().toISOString(), message: msg, ...meta })),
  warn: (msg: string, meta?: Record<string, any>) => console.warn(JSON.stringify({ level: 'WARN', timestamp: new Date().toISOString(), message: msg, ...meta })),
  error: (msg: string, meta?: Record<string, any>) => console.error(JSON.stringify({ level: 'ERROR', timestamp: new Date().toISOString(), message: msg, ...meta })),
};

export function registerBillingRoutes(app: Express): void {
  const api = app;

  // CREDITS AND USAGE METERING
  // ============================================
  
  api.get("/api/credits/balance", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { creditService } = await import("./services/credits");
      const org = (req as any).organization;
      const balance = await creditService.getBalance(org.id);
      res.json({ balance });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
  
  api.get("/api/credits/transactions", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { creditService } = await import("./services/credits");
      const org = (req as any).organization;
      const limit = parseInt(req.query.limit as string) || 50;
      const transactions = await creditService.getTransactionHistory(org.id, limit);
      res.json(transactions);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
  
  api.get("/api/usage/summary", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { usageMeteringService } = await import("./services/credits");
      const org = (req as any).organization;
      const month = req.query.month as string || new Date().toISOString().slice(0, 7);
      const summary = await usageMeteringService.getUsageSummary(org.id, month);
      res.json(summary);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
  
  api.get("/api/usage/records", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { usageMeteringService } = await import("./services/credits");
      const org = (req as any).organization;
      const limit = parseInt(req.query.limit as string) || 50;
      const records = await usageMeteringService.getRecentUsage(org.id, limit);
      res.json(records);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
  
  api.get("/api/usage/rates", isAuthenticated, async (req, res) => {
    try {
      const { usageMeteringService } = await import("./services/credits");
      const { USAGE_ACTION_TYPES } = await import("@shared/schema");
      const dbRates = await usageMeteringService.getAllRates();
      
      const rates = Object.entries(USAGE_ACTION_TYPES).map(([key, value]) => {
        const dbRate = dbRates.find((r: any) => r.actionType === key);
        return {
          actionType: key,
          displayName: value.name,
          unitCostCents: dbRate?.unitCostCents || value.defaultCostCents,
        };
      });
      
      res.json(rates);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
  
  api.post("/api/usage/estimate", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { usageMeteringService, creditService } = await import("./services/credits");
      const { USAGE_ACTION_TYPES } = await import("@shared/schema");
      const org = (req as any).organization;
      const { actionType, quantity = 1 } = req.body;
      
      if (!actionType || !USAGE_ACTION_TYPES[actionType as keyof typeof USAGE_ACTION_TYPES]) {
        return res.status(400).json({ message: "Invalid action type" });
      }
      
      const cost = await usageMeteringService.calculateCost(actionType, quantity);
      const balance = await creditService.getBalance(org.id);
      
      res.json({
        actionType,
        quantity,
        unitCostCents: cost / quantity,
        totalCostCents: cost,
        currentBalance: balance,
        insufficientCredits: balance < cost,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
  
  // T6: Idempotency on payment mutations to prevent duplicate charges
  api.post("/api/credits/purchase", isAuthenticated, getOrCreateOrg, idempotencyMiddleware, async (req, res) => {
    try {
      const { stripeService } = await import("./stripeService");
      const { CREDIT_PACKS } = await import("@shared/schema");
      const org = (req as any).organization;
      const { packId } = req.body;
      
      if (!packId || !CREDIT_PACKS[packId as keyof typeof CREDIT_PACKS]) {
        return res.status(400).json({ message: "Invalid credit pack ID" });
      }
      
      const pack = CREDIT_PACKS[packId as keyof typeof CREDIT_PACKS];
      
      let customerId = org.stripeCustomerId;
      if (!customerId) {
        const user = req.user as any;
        const customer = await stripeService.createCustomer(
          user.email || '',
          user.id,
          org.name
        );
        await storage.updateOrganization(org.id, { stripeCustomerId: customer.id });
        customerId = customer.id;
      }
      
      const session = await stripeService.createCreditPurchaseCheckout(
        customerId,
        packId,
        pack.priceCents,
        pack.name,
        `${req.protocol}://${req.get('host')}/settings?credits=success`,
        `${req.protocol}://${req.get('host')}/settings?credits=cancelled`,
        { 
          organizationId: String(org.id),
          type: 'credit_purchase',
          packId,
          amountCents: String(pack.amountCents),
        }
      );
      
      res.json({ checkoutUrl: session.url });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get auto-top-up settings
  api.get("/api/credits/auto-top-up", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      res.json({
        enabled: org.autoTopUpEnabled || false,
        thresholdCents: org.autoTopUpThresholdCents || 200,
        amountCents: org.autoTopUpAmountCents || 2500,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Update auto-top-up settings
  api.post("/api/credits/auto-top-up", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { usageMeteringService } = await import("./services/credits");
      const org = (req as any).organization;
      const { enabled, thresholdCents, amountCents } = req.body;
      
      await usageMeteringService.updateAutoTopUpSettings(
        org.id,
        enabled === true,
        thresholdCents,
        amountCents
      );
      
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ============================================
  // STRIPE SUBSCRIPTION
  // ============================================
  
  api.get("/api/stripe/products", async (req, res) => {
    try {
      const { stripeService } = await import("./stripeService");
      const rows = await stripeService.listProductsWithPrices();
      
      const productsMap = new Map();
      for (const row of rows as any[]) {
        if (!productsMap.has(row.product_id)) {
          productsMap.set(row.product_id, {
            id: row.product_id,
            name: row.product_name,
            description: row.product_description,
            active: row.product_active,
            metadata: row.product_metadata,
            prices: []
          });
        }
        if (row.price_id) {
          productsMap.get(row.product_id).prices.push({
            id: row.price_id,
            unit_amount: row.unit_amount,
            currency: row.currency,
            recurring: row.recurring,
            active: row.price_active,
            metadata: row.price_metadata,
          });
        }
      }
      
      res.json(Array.from(productsMap.values()));
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });
  
  api.post("/api/stripe/checkout", isAuthenticated, getOrCreateOrg, idempotencyMiddleware, async (req, res) => {
    try {
      const { stripeService } = await import("./stripeService");
      const org = (req as any).organization;
      const { priceId } = req.body;
      
      if (!priceId) {
        return res.status(400).json({ message: "priceId is required" });
      }
      
      let customerId = org.stripeCustomerId;
      if (!customerId) {
        const user = req.user as any;
        const customer = await stripeService.createCustomer(
          user.email,
          user.id,
          org.name
        );
        await storage.updateOrganization(org.id, { stripeCustomerId: customer.id });
        customerId = customer.id;
      }
      
      // Check if organization is eligible for 7-day free trial (first subscription only)
      const trialDays = org.trialUsed ? undefined : 7;
      
      // Mark trial as used when they start their first subscription
      if (!org.trialUsed) {
        await storage.updateOrganization(org.id, { trialUsed: true });
      }
      
      const session = await stripeService.createCheckoutSession(
        customerId,
        priceId,
        `${req.protocol}://${req.get('host')}/settings?subscription=success`,
        `${req.protocol}://${req.get('host')}/settings?subscription=cancelled`,
        { organizationId: String(org.id) },
        trialDays
      );
      
      res.json({ url: session.url });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });
  
  api.post("/api/stripe/portal", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { stripeService } = await import("./stripeService");
      const org = (req as any).organization;
      
      if (!org.stripeCustomerId) {
        return res.status(400).json({ message: "No subscription found" });
      }
      
      const session = await stripeService.createCustomerPortalSession(
        org.stripeCustomerId,
        `${req.protocol}://${req.get('host')}/settings`
      );
      
      res.json({ url: session.url });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });
  
  api.get("/api/stripe/subscription", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { stripeService } = await import("./stripeService");
      const org = (req as any).organization;
      
      if (!org.stripeCustomerId) {
        return res.json({ subscription: null });
      }
      
      const subscriptions = await stripeService.getCustomerSubscriptions(org.stripeCustomerId);
      const activeSubscription = subscriptions.find((s: any) => 
        s.status === 'active' || s.status === 'trialing'
      );
      
      res.json({ subscription: activeSubscription || null });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ============================================
  // STRIPE CONNECT (User Payment Acceptance)
  // ============================================

  api.post("/api/stripe/connect/link", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { stripeConnectService } = await import("./services/stripeConnect");
      const org = (req as any).organization;
      const user = req.user as any;
      
      const email = user?.claims?.email || req.body.email;
      const businessName = org.name || req.body.businessName;
      
      if (!email) {
        return res.status(400).json({ message: "Email is required" });
      }
      
      const existing = await storage.getOrganizationIntegration(org.id, "stripe_connect");
      
      if (existing?.credentials?.stripeConnectAccountId) {
        const accountLink = await stripeConnectService.createOnboardingLink(
          existing.credentials.stripeConnectAccountId
        );
        return res.json({ 
          accountId: existing.credentials.stripeConnectAccountId,
          onboardingUrl: accountLink.url,
          isExisting: true 
        });
      }
      
      const result = await stripeConnectService.createConnectedAccount(org.id, email, businessName);
      res.json(result);
    } catch (err: any) {
      console.error("Stripe Connect link error:", err);
      if (err.message?.includes("not configured")) {
        return res.status(503).json({ message: err.message });
      }
      res.status(500).json({ message: err.message });
    }
  });

  api.get("/api/stripe/connect/status", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { stripeConnectService } = await import("./services/stripeConnect");
      const org = (req as any).organization;
      
      const status = await stripeConnectService.getOrganizationConnectStatus(org.id);
      res.json(status);
    } catch (err: any) {
      console.error("Stripe Connect status error:", err);
      if (err.message?.includes("not configured")) {
        return res.status(503).json({ message: err.message });
      }
      res.status(500).json({ message: err.message });
    }
  });

  api.post("/api/stripe/connect/refresh", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { stripeConnectService } = await import("./services/stripeConnect");
      const org = (req as any).organization;
      
      const integration = await storage.getOrganizationIntegration(org.id, "stripe_connect");
      
      if (!integration?.credentials?.stripeConnectAccountId) {
        return res.status(400).json({ message: "No Stripe Connect account found" });
      }
      
      await stripeConnectService.updateAccountStatus(org.id, integration.credentials.stripeConnectAccountId);
      const status = await stripeConnectService.getOrganizationConnectStatus(org.id);
      
      res.json(status);
    } catch (err: any) {
      console.error("Stripe Connect refresh error:", err);
      if (err.message?.includes("not configured")) {
        return res.status(503).json({ message: err.message });
      }
      res.status(500).json({ message: err.message });
    }
  });

  api.post("/api/stripe/connect/disconnect", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { stripeConnectService } = await import("./services/stripeConnect");
      const org = (req as any).organization;
      
      await stripeConnectService.disconnectAccount(org.id);
      res.json({ success: true });
    } catch (err: any) {
      console.error("Stripe Connect disconnect error:", err);
      if (err.message?.includes("not configured")) {
        return res.status(503).json({ message: err.message });
      }
      res.status(500).json({ message: err.message });
    }
  });

  api.post("/api/stripe/connect/payment-intent", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { stripeConnectService } = await import("./services/stripeConnect");
      const org = (req as any).organization;
      const { amount, noteId, propertyId, paymentType, description } = req.body;
      
      if (!amount || amount <= 0) {
        return res.status(400).json({ message: "Valid amount is required" });
      }
      
      if (!paymentType || !["note_payment", "cash_sale", "down_payment"].includes(paymentType)) {
        return res.status(400).json({ message: "Valid payment type is required" });
      }
      
      const paymentIntent = await stripeConnectService.createPaymentIntent(
        org.id,
        Math.round(amount * 100),
        "usd",
        { noteId, propertyId, paymentType, description }
      );
      
      res.json({
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
        amount: paymentIntent.amount,
      });
    } catch (err: any) {
      console.error("Stripe payment intent error:", err);
      if (err.message?.includes("not configured")) {
        return res.status(503).json({ message: err.message });
      }
      res.status(500).json({ message: err.message });
    }
  });

  api.get("/api/stripe/connect/payment-link/:noteId", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { stripeConnectService } = await import("./services/stripeConnect");
      const org = (req as any).organization;
      const noteId = Number(req.params.noteId);
      
      const note = await storage.getNote(org.id, noteId);
      if (!note) {
        return res.status(404).json({ message: "Note not found" });
      }
      
      const amount = Number(note.monthlyPayment);
      const paymentLink = await stripeConnectService.getPaymentLink(org.id, noteId, amount);
      
      res.json({ paymentLink, amount });
    } catch (err: any) {
      console.error("Stripe payment link error:", err);
      if (err.message?.includes("not configured")) {
        return res.status(503).json({ message: err.message });
      }
      res.status(500).json({ message: err.message });
    }
  });

  // ============================================
  // STRIPE CONNECT WEBHOOK
  // ============================================
  
  api.post("/api/stripe/connect/webhook", express.raw({ type: "application/json" }), async (req, res) => {
    try {
      const { stripeConnectService } = await import("./services/stripeConnect");
      const Stripe = require("stripe").default;
      
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "");
      const sig = req.headers["stripe-signature"] as string;
      const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
      
      if (!webhookSecret) {
        logger.warn("Stripe webhook secret not configured", {});
        return res.status(400).json({ message: "Webhook secret not configured" });
      }
      
      if (!sig) {
        logger.warn("Missing Stripe signature header", {});
        return res.status(400).json({ message: "Missing Stripe signature" });
      }
      
      let event: any;
      
      try {
        const rawBody = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
        event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
      } catch (err: any) {
        logger.error("Webhook signature verification failed", { error: err.message });
        return res.status(400).json({ message: `Webhook Error: ${err.message}` });
      }
      
      logger.info("Stripe webhook event received", {
        eventType: event.type,
        eventId: event.id,
        timestamp: event.created,
      });
      
      await stripeConnectService.handleWebhookEvent(event);
      
      logger.info("Stripe webhook event processed", {
        eventType: event.type,
        eventId: event.id,
      });
      
      res.status(200).json({ received: true });
    } catch (err: any) {
      logger.error("Stripe webhook processing error", {
        error: err.message,
        stack: err.stack,
      });
      res.status(500).json({ message: err.message });
    }
  });

}
