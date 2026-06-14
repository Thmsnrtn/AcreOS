import type { Express, Response } from "express";
import express from "express";
import { getOrganization, type AuthenticatedRequest } from "./types/request";
import { storage, db } from "./storage";
import { SUBSCRIPTION_TIERS, cancellationSurveys, refundRequests, stripeProcessedEvents } from "@shared/schema";
import { eq, and, desc, gte } from "drizzle-orm";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { getAllUsageLimits, type SubscriptionTier, TIER_LIMITS } from "./services/usageLimits";
import { idempotencyMiddleware } from "./middleware/idempotency";
import { logger } from "./utils/logger";
import { Errors, sendError } from "./utils/errors";
import { requirePermission } from "./utils/permissions";
import { auditFromRequest, AuditActions } from "./utils/auditLog";
import { customerAuditFromRequest, CustomerAuditActions } from "./utils/customerAudit";
import { withTransaction } from "./db";
import { z } from "zod";

export function registerBillingRoutes(app: Express): void {
  const api = app;

  // CREDITS AND USAGE METERING
  // ============================================
  
  api.get("/api/credits/balance", isAuthenticated, getOrCreateOrg, requirePermission("canManageBilling"), async (req, res) => {
    try {
      const { creditService } = await import("./services/credits");
      const org = req.organization;
      const balance = await creditService.getBalance(org.id);
      res.json({ balance });
    } catch (error: any) {
      Errors.internal(res, error);
    }
  });

  api.get("/api/credits/transactions", isAuthenticated, getOrCreateOrg, requirePermission("canManageBilling"), async (req, res) => {
    try {
      const { creditService } = await import("./services/credits");
      const org = req.organization;
      const limit = Math.min(100, parseInt(req.query.limit as string) || 50);
      const transactions = await creditService.getTransactionHistory(org.id, limit);
      res.json(transactions);
    } catch (error: any) {
      Errors.internal(res, error);
    }
  });

  api.get("/api/usage/summary", isAuthenticated, getOrCreateOrg, requirePermission("canManageBilling"), async (req, res) => {
    try {
      const { usageMeteringService } = await import("./services/credits");
      const org = req.organization;
      const month = req.query.month as string || new Date().toISOString().slice(0, 7);
      const summary = await usageMeteringService.getUsageSummary(org.id, month);
      res.json(summary);
    } catch (error: any) {
      Errors.internal(res, error);
    }
  });

  api.get("/api/usage/records", isAuthenticated, getOrCreateOrg, requirePermission("canManageBilling"), async (req, res) => {
    try {
      const { usageMeteringService } = await import("./services/credits");
      const org = req.organization;
      const limit = Math.min(100, parseInt(req.query.limit as string) || 50);
      const records = await usageMeteringService.getRecentUsage(org.id, limit);
      res.json(records);
    } catch (error: any) {
      Errors.internal(res, error);
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
      Errors.internal(res, error);
    }
  });

  const usageEstimateSchema = z.object({
    actionType: z.string().min(1, "actionType is required"),
    quantity: z.number().int().positive().optional().default(1),
  });

  api.post("/api/usage/estimate", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { usageMeteringService, creditService } = await import("./services/credits");
      const { USAGE_ACTION_TYPES } = await import("@shared/schema");
      const org = req.organization;
      const parsed = usageEstimateSchema.safeParse(req.body);
      if (!parsed.success) {
        return Errors.validationFailed(res, parsed.error.issues);
      }
      const { actionType, quantity } = parsed.data;

      const validActionType = actionType as keyof typeof USAGE_ACTION_TYPES;
      if (!USAGE_ACTION_TYPES[validActionType]) {
        return Errors.badRequest(res, "Invalid action type");
      }

      const cost = await usageMeteringService.calculateCost(validActionType, quantity);
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
      Errors.internal(res, error);
    }
  });

  // T6: Idempotency on payment mutations to prevent duplicate charges
  const creditPurchaseSchema = z.object({
    packId: z.string().min(1, "packId is required"),
  });

  api.post("/api/credits/purchase", isAuthenticated, getOrCreateOrg, requirePermission("canManageBilling"), idempotencyMiddleware, async (req, res) => {
    try {
      const { stripeService } = await import("./stripeService");
      const { CREDIT_PACKS } = await import("@shared/schema");
      const org = req.organization;
      const parsed = creditPurchaseSchema.safeParse(req.body);
      if (!parsed.success) {
        return Errors.validationFailed(res, parsed.error.issues);
      }
      const { packId } = parsed.data;

      if (!CREDIT_PACKS[packId as keyof typeof CREDIT_PACKS]) {
        return Errors.badRequest(res, "Invalid credit pack ID");
      }
      
      const pack = CREDIT_PACKS[packId as keyof typeof CREDIT_PACKS];
      
      // Ensure Stripe customer creation and org update are atomic
      let customerId = org.stripeCustomerId;
      if (!customerId) {
        customerId = await withTransaction(async () => {
          const user = req.user;
          const customer = await stripeService.createCustomer(
            user.email || '',
            user.id,
            org.name
          );
          await storage.updateOrganization(org.id, { stripeCustomerId: customer.id });
          return customer.id;
        });
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
      Errors.internal(res, error);
    }
  });

  // Get auto-top-up settings
  api.get("/api/credits/auto-top-up", isAuthenticated, getOrCreateOrg, requirePermission("canManageBilling"), async (req, res) => {
    try {
      const org = req.organization;
      res.json({
        enabled: org.autoTopUpEnabled || false,
        thresholdCents: org.autoTopUpThresholdCents || 200,
        amountCents: org.autoTopUpAmountCents || 2500,
      });
    } catch (error: any) {
      Errors.internal(res, error);
    }
  });

  // Update auto-top-up settings
  const autoTopUpSchema = z.object({
    enabled: z.boolean(),
    thresholdCents: z.number().int().min(0).optional(),
    amountCents: z.number().int().min(0).optional(),
  });

  api.post("/api/credits/auto-top-up", isAuthenticated, getOrCreateOrg, requirePermission("canManageBilling"), async (req, res) => {
    try {
      const { usageMeteringService } = await import("./services/credits");
      const org = req.organization;
      const parsed = autoTopUpSchema.safeParse(req.body);
      if (!parsed.success) {
        return Errors.validationFailed(res, parsed.error.issues);
      }
      const { enabled, thresholdCents, amountCents } = parsed.data;

      await usageMeteringService.updateAutoTopUpSettings(
        org.id,
        enabled === true,
        thresholdCents,
        amountCents
      );

      try {
        const user = req.user;
        await storage.createAuditLogEntry({
          organizationId: org.id,
          userId: (user?.id || user?.id)?.toString() || null,
          action: "update",
          entityType: "billing_auto_top_up",
          entityId: org.id,
          changes: { after: { enabled: enabled === true, thresholdCents, amountCents }, fields: ["enabled", "thresholdCents", "amountCents"] },
          ipAddress: req.ip || null,
          userAgent: req.headers["user-agent"] || null,
          metadata: {},
        });
      } catch (e) { /* non-fatal */ }

      // Phase 3 Week 11 — autopay state change is a sensitive event.
      await auditFromRequest(req, {
        action: AuditActions.BILLING_AUTOPAY_TOGGLED,
        target: { type: "billing", id: org.id },
        metadata: { enabled: enabled === true, thresholdCents, amountCents },
      });

      // Tahoe / Beatrice — customer-visible security activity.
      void customerAuditFromRequest(req, {
        organizationId: org.id,
        action: CustomerAuditActions.BILLING_AUTOPAY_TOGGLED,
        category: "billing",
        targetLabel: "Auto top-up",
        metadata: { enabled: enabled === true, thresholdCents, amountCents },
      });

      res.json({ success: true });
    } catch (error: any) {
      Errors.internal(res, error);
    }
  });

  // ============================================
  // STRIPE SUBSCRIPTION
  // ============================================
  
  api.get("/api/stripe/products", async (req, res) => {
    try {
      const { stripeService } = await import("./stripeService");
      const rows = await stripeService.listProductsWithPrices();
      // Filter to AcreOS subscription products only. The Stripe account
      // also carries unrelated products (Foundry, Doc Fee, county lots,
      // etc.); without this filter the settings/billing page renders
      // them as if they were subscription tiers. Tagged via
      // metadata.acreos_product = "true" by
      // scripts/setup-stripe-subscription-products.ts.
      const acreosOnly = rows.filter((row: any) => row.product_metadata?.acreos_product === "true");
      const result = acreosOnly.map((row: any) => ({
        id: row.product_id,
        name: row.product_name,
        description: row.product_description,
        active: row.product_active,
        metadata: row.product_metadata,
        prices: (row.prices || []).map((p: any) => ({
          id: p.price_id,
          unit_amount: p.unit_amount,
          currency: p.currency,
          recurring: p.recurring,
          active: p.price_active,
          metadata: p.price_metadata,
        })),
      }));
      res.json(result);
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  const stripeCheckoutSchema = z.object({
    priceId: z.string().min(1, "priceId is required"),
  });

  api.post("/api/stripe/checkout", isAuthenticated, getOrCreateOrg, requirePermission("canManageBilling"), idempotencyMiddleware, async (req, res) => {
    try {
      const { stripeService } = await import("./stripeService");
      const org = req.organization;
      const parsed = stripeCheckoutSchema.safeParse(req.body);
      if (!parsed.success) {
        return Errors.validationFailed(res, parsed.error.issues);
      }
      const { priceId } = parsed.data;
      
      // Ensure Stripe customer creation and org update are atomic
      let customerId = org.stripeCustomerId;
      if (!customerId) {
        customerId = await withTransaction(async () => {
          const user = req.user;
          if (!user.email) {
            // A Stripe customer requires an email; Clerk-authenticated users
            // always have one, so this is a defensive invariant check.
            throw new Error("Cannot create a billing customer without an email on file");
          }
          const customer = await stripeService.createCustomer(
            user.email,
            user.id,
            org.name
          );
          await storage.updateOrganization(org.id, { stripeCustomerId: customer.id });
          return customer.id;
        });
      }

      // Check if organization is eligible for 14-day free trial (first subscription only)
      const trialDays = org.trialUsed ? undefined : 14;
      
      // Look up active promo for this price (match by tier name in Stripe product metadata)
      // and detect yearly billing to opt the session into ACH (Pillar 8.5).
      let checkoutOptions: { couponId?: string; allowPromoCodes?: boolean; enableAch?: boolean } = {};
      try {
        const price = await stripeService.getPrice(priceId);
        const tierFromMeta = (price?.metadata?.tier || price?.metadata?.plan) as string | undefined;
        if (tierFromMeta) {
          const pricingCfg = await storage.getPricingConfigForTier(tierFromMeta.toLowerCase());
          const now = new Date();
          if (pricingCfg?.stripeCouponId && pricingCfg.promoEndsAt && pricingCfg.promoEndsAt > now) {
            checkoutOptions.couponId = pricingCfg.stripeCouponId;
          } else if (pricingCfg?.allowPromoCodes) {
            checkoutOptions.allowPromoCodes = true;
          }
        }
        // Pillar 8.5 — yearly plans accept ACH in addition to card. ACH
        // costs ~$0.80 flat vs ~$20+ in card fees on a $700 annual seat.
        const recurringInterval = (price as any)?.recurring?.interval;
        if (recurringInterval === 'year') {
          checkoutOptions.enableAch = true;
        }
      } catch {
        // Non-fatal: proceed without promo
      }

      const session = await stripeService.createCheckoutSession(
        customerId,
        priceId,
        `${req.protocol}://${req.get('host')}/settings?subscription=success`,
        `${req.protocol}://${req.get('host')}/settings?subscription=cancelled`,
        { organizationId: String(org.id) },
        trialDays,
        checkoutOptions
      );

      res.json({ url: session.url });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  api.post("/api/stripe/portal", isAuthenticated, getOrCreateOrg, requirePermission("canManageBilling"), async (req, res) => {
    try {
      const { stripeService } = await import("./stripeService");
      const org = req.organization;
      
      if (!org.stripeCustomerId) {
        return Errors.badRequest(res, "No subscription found");
      }
      
      const session = await stripeService.createCustomerPortalSession(
        org.stripeCustomerId,
        `${req.protocol}://${req.get('host')}/settings`
      );
      
      res.json({ url: session.url });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  api.get("/api/stripe/subscription", isAuthenticated, getOrCreateOrg, requirePermission("canManageBilling"), async (req, res) => {
    try {
      const { stripeService } = await import("./stripeService");
      const org = req.organization;
      
      if (!org.stripeCustomerId) {
        return res.json({ subscription: null });
      }
      
      const subscriptions = await stripeService.getCustomerSubscriptions(org.stripeCustomerId);
      const activeSubscription = subscriptions.find((s: any) => 
        s.status === 'active' || s.status === 'trialing'
      );
      
      res.json({ subscription: activeSubscription || null });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // ============================================
  // STRIPE CONNECT (User Payment Acceptance)
  // ============================================

  const connectLinkSchema = z.object({
    email: z.string().email().optional(),
    businessName: z.string().optional(),
  });

  api.post("/api/stripe/connect/link", isAuthenticated, getOrCreateOrg, requirePermission("canManageBilling"), async (req, res) => {
    try {
      const { stripeConnectService } = await import("./services/stripeConnect");
      const org = req.organization;
      const user = req.user;

      const parsed = connectLinkSchema.safeParse(req.body);
      if (!parsed.success) {
        return Errors.validationFailed(res, parsed.error.issues);
      }

      const email = user?.email || parsed.data.email;
      const businessName = org.name || parsed.data.businessName;

      if (!email) {
        return Errors.badRequest(res, "Email is required");
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

      try {
        await storage.createAuditLogEntry({
          organizationId: org.id,
          userId: (user?.id || user?.id)?.toString() || null,
          action: "create",
          entityType: "stripe_connect_account",
          entityId: org.id,
          changes: { after: { email, businessName }, fields: ["email", "businessName"] },
          ipAddress: req.ip || null,
          userAgent: req.headers["user-agent"] || null,
          metadata: {},
        });
      } catch (e) { /* non-fatal */ }

      res.json(result);
    } catch (err: any) {
      logger.error("Stripe Connect link error", err instanceof Error ? err : undefined);
      if (err.message?.includes("not configured")) {
        return sendError(res, 503, "SERVICE_UNAVAILABLE", err.message);
      }
      Errors.internal(res, err);
    }
  });

  api.get("/api/stripe/connect/status", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { stripeConnectService } = await import("./services/stripeConnect");
      const org = req.organization;
      
      const status = await stripeConnectService.getOrganizationConnectStatus(org.id);
      res.json(status);
    } catch (err: any) {
      logger.error("Stripe Connect status error", err instanceof Error ? err : undefined);
      if (err.message?.includes("not configured")) {
        return sendError(res, 503, "SERVICE_UNAVAILABLE", err.message);
      }
      Errors.internal(res, err);
    }
  });

  api.post("/api/stripe/connect/refresh", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { stripeConnectService } = await import("./services/stripeConnect");
      const org = req.organization;
      
      const integration = await storage.getOrganizationIntegration(org.id, "stripe_connect");
      
      if (!integration?.credentials?.stripeConnectAccountId) {
        return Errors.badRequest(res, "No Stripe Connect account found");
      }
      
      await stripeConnectService.updateAccountStatus(org.id, integration.credentials.stripeConnectAccountId);
      const status = await stripeConnectService.getOrganizationConnectStatus(org.id);
      
      res.json(status);
    } catch (err: any) {
      logger.error("Stripe Connect refresh error", err instanceof Error ? err : undefined);
      if (err.message?.includes("not configured")) {
        return sendError(res, 503, "SERVICE_UNAVAILABLE", err.message);
      }
      Errors.internal(res, err);
    }
  });

  api.post("/api/stripe/connect/disconnect", isAuthenticated, getOrCreateOrg, requirePermission("canManageBilling"), async (req, res) => {
    try {
      const { stripeConnectService } = await import("./services/stripeConnect");
      const org = req.organization;

      await stripeConnectService.disconnectAccount(org.id);

      try {
        const user = req.user;
        await storage.createAuditLogEntry({
          organizationId: org.id,
          userId: (user?.id || user?.id)?.toString() || null,
          action: "delete",
          entityType: "stripe_connect_account",
          entityId: org.id,
          changes: { before: { organizationId: org.id }, fields: ["disconnected"] },
          ipAddress: req.ip || null,
          userAgent: req.headers["user-agent"] || null,
          metadata: {},
        });
      } catch (e) { /* non-fatal */ }

      res.json({ success: true });
    } catch (err: any) {
      logger.error("Stripe Connect disconnect error", err instanceof Error ? err : undefined);
      if (err.message?.includes("not configured")) {
        return sendError(res, 503, "SERVICE_UNAVAILABLE", err.message);
      }
      Errors.internal(res, err);
    }
  });

  const paymentIntentSchema = z.object({
    amount: z.number().positive("Valid amount is required"),
    noteId: z.number().int().optional(),
    propertyId: z.number().int().optional(),
    paymentType: z.enum(["note_payment", "cash_sale", "down_payment"], { message: "Valid payment type is required" }),
    description: z.string().optional(),
  });

  api.post("/api/stripe/connect/payment-intent", isAuthenticated, getOrCreateOrg, requirePermission("canManageBilling"), async (req, res) => {
    try {
      const { stripeConnectService } = await import("./services/stripeConnect");
      const org = req.organization;
      const parsed = paymentIntentSchema.safeParse(req.body);
      if (!parsed.success) {
        return Errors.validationFailed(res, parsed.error.issues);
      }
      const { amount, noteId, propertyId, paymentType, description } = parsed.data;
      
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
      logger.error("Stripe payment intent error", err instanceof Error ? err : undefined);
      if (err.message?.includes("not configured")) {
        return sendError(res, 503, "SERVICE_UNAVAILABLE", err.message);
      }
      Errors.internal(res, err);
    }
  });

  api.get("/api/stripe/connect/payment-link/:noteId", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { stripeConnectService } = await import("./services/stripeConnect");
      const org = req.organization;
      const noteId = Number(req.params.noteId);
      
      const note = await storage.getNote(org.id, noteId);
      if (!note) {
        return Errors.notFound(res, "Note");
      }
      
      const amount = Number(note.monthlyPayment);
      const paymentLink = await stripeConnectService.getPaymentLink(org.id, noteId, amount);
      
      res.json({ paymentLink, amount });
    } catch (err: any) {
      logger.error("Stripe payment link error", err instanceof Error ? err : undefined);
      if (err.message?.includes("not configured")) {
        return sendError(res, 503, "SERVICE_UNAVAILABLE", err.message);
      }
      Errors.internal(res, err);
    }
  });

  // ============================================
  // STRIPE CONNECT WEBHOOK
  // ============================================
  
  // ============================================
  // FREE TRIAL
  // ============================================

  api.get("/api/trial/status", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { trialService } = await import("./services/trialService");
      const org = getOrganization(req);
      const status = await trialService.getTrialStatus(org.id);
      res.json(status);
    } catch (error: any) {
      Errors.internal(res, error);
    }
  });

  const trialStartSchema = z.object({
    tier: z.enum(["starter", "pro"]).optional().default("starter"),
  });

  api.post("/api/trial/start", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { trialService } = await import("./services/trialService");
      const org = getOrganization(req);
      const parsed = trialStartSchema.safeParse(req.body);
      if (!parsed.success) {
        return Errors.validationFailed(res, parsed.error.issues);
      }
      const tier = parsed.data.tier;
      const status = await trialService.startTrial(org.id, tier);
      res.json(status);
    } catch (error: any) {
      if (error.message.includes("already used")) {
        return sendError(res, 409, "TRIAL_ALREADY_USED", error.message);
      }
      Errors.internal(res, error);
    }
  });

  api.post("/api/trial/expire-check", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { trialService } = await import("./services/trialService");
      const org = getOrganization(req);
      if (!org.isFounder) {
        return Errors.forbidden(res, "Founder only");
      }
      const expired = await trialService.expireTrials();
      res.json({ expired });
    } catch (error: any) {
      Errors.internal(res, error);
    }
  });

  api.post("/api/stripe/connect/webhook", express.raw({ type: "application/json" }), async (req, res) => {
    try {
      const { stripeConnectService } = await import("./services/stripeConnect");
      const Stripe = require("stripe").default;
      const { STRIPE_API_VERSION } = await import("./stripeClient");

      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
        apiVersion: STRIPE_API_VERSION,
        maxNetworkRetries: 3,
      });
      const sig = req.headers["stripe-signature"] as string;
      // Connect webhooks use a separate endpoint secret from standard webhooks
      const webhookSecret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET || process.env.STRIPE_WEBHOOK_SECRET;

      if (!webhookSecret) {
        logger.warn("Stripe Connect webhook secret not configured (set STRIPE_CONNECT_WEBHOOK_SECRET)", {});
        return Errors.badRequest(res, "Webhook secret not configured");
      }

      if (!sig) {
        logger.warn("Missing Stripe signature header", {});
        return Errors.badRequest(res, "Missing Stripe signature");
      }

      let event: any;

      try {
        // req.body is a Buffer (express.raw middleware) — pass it directly.
        // Never JSON.stringify a Buffer before constructEvent or signature verification will fail.
        event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
      } catch (err: any) {
        logger.error("Webhook signature verification failed", { error: err.message });
        return Errors.badRequest(res, `Webhook Error: ${err.message}`);
      }

      logger.info("Stripe Connect webhook event received", {
        eventType: event.type,
        eventId: event.id,
        timestamp: event.created,
      });

      // Idempotency: skip already-processed events (P1-4 fix)
      try {
        const [existing] = await db
          .select({ id: stripeProcessedEvents.id })
          .from(stripeProcessedEvents)
          .where(eq(stripeProcessedEvents.stripeEventId, event.id))
          .limit(1);
        if (existing) {
          logger.info(`[connect-webhook] Skipping duplicate event: ${event.id} (${event.type})`);
          return res.status(200).json({ received: true, duplicate: true });
        }
      } catch {
        // Table may not exist yet during migration — allow processing
      }

      try {
        await stripeConnectService.handleWebhookEvent(event);
      } finally {
        // Always mark processed to prevent infinite Stripe retries
        try {
          await db.insert(stripeProcessedEvents).values({
            stripeEventId: event.id,
            eventType: event.type,
          }).onConflictDoNothing();
        } catch (markErr) {
          logger.warn(`[connect-webhook] Failed to record processed event ${event.id}`, markErr instanceof Error ? markErr : undefined);
        }
      }

      logger.info("Stripe Connect webhook event processed", {
        eventType: event.type,
        eventId: event.id,
      });

      res.status(200).json({ received: true });
    } catch (err: any) {
      logger.error("Stripe Connect webhook processing error", {
        error: err.message,
        stack: err.stack,
      });
      Errors.internal(res, err);
    }
  });

  // ============================================
  // SELF-SERVE CANCELLATION
  // ============================================

  // Pre-cancellation: get usage stats for retention offer
  api.get("/api/subscription/cancellation-context", isAuthenticated, getOrCreateOrg, requirePermission("canManageBilling"), async (req, res) => {
    try {
      const org = req.organization;
      // getAllUsageLimits(organizationId, options) — the tier is resolved
      // internally; the second argument is UsageLimitOptions, not a tier.
      const limits = await getAllUsageLimits(org.id, { isFounder: req.isFounder });

      // Network-loss context: the org's OWN aggregate standing in the data
      // network (percentile, counties reached, properties contributed). The
      // cancellation dialog reframes churn as "going blind" on the benchmarks
      // this org currently sees. `contributing` is the truthful opt-out
      // signal — an org that has contributed nothing has no standing to lose,
      // so the dialog must show neutral copy rather than imply visibility it
      // never had (Beatrice cross-cut). This is the org's OWN aggregate
      // standing only — never a window into other orgs' raw data.
      let dataNetwork:
        | {
            propertiesContributed: number;
            countiesReached: number;
            dealsCompleted: number;
            percentileRank: number;
            contributing: boolean;
          }
        | null = null;
      try {
        const { getDataContributionMetrics } = await import("./services/dataNetworkVisibility");
        const metrics = await getDataContributionMetrics(org.id);
        dataNetwork = {
          propertiesContributed: metrics.propertiesContributed,
          countiesReached: metrics.countiesReached,
          dealsCompleted: metrics.dealsCompleted,
          percentileRank: metrics.percentileRank,
          contributing: metrics.propertiesContributed > 0,
        };
      } catch (metricsErr) {
        // Non-fatal: cancellation flow must not break if metrics are
        // unavailable. The dialog falls back to omitting the network section.
        logger.warn(
          `[cancellation-context] data-network metrics unavailable for org ${org.id}`,
          metricsErr instanceof Error ? metricsErr : undefined,
        );
      }

      res.json({
        currentTier: org.subscriptionTier,
        usage: limits,
        memberSince: org.createdAt,
        dataNetwork,
      });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // Submit cancellation survey + trigger cancellation via Stripe portal
  api.post("/api/subscription/cancel", isAuthenticated, getOrCreateOrg, requirePermission("canManageBilling"), async (req, res) => {
    try {
      const org = req.organization;
      const userId = req.user?.id;

      const schema = z.object({
        reason: z.enum(["too_expensive", "not_using", "missing_features", "switching_competitor", "other"]),
        feedback: z.string().optional(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return Errors.validationFailed(res, parsed.error.issues);
      }

      // Save survey. The self-serve cancellation dialog only ever presents a
      // DOWNGRADE alternative (when a lower paid tier exists) — it does NOT
      // offer a pause. Pause is a distinct flow (POST /api/subscription/pause)
      // that records its own survey row with offered_pause = true /
      // accepted_pause = true. Hardcoding offered_pause = true here inflated
      // the founder save-rate denominator with pause offers that never
      // happened; record it truthfully as false for this path.
      await db.insert(cancellationSurveys).values({
        organizationId: org.id,
        userId,
        reason: parsed.data.reason,
        feedback: parsed.data.feedback,
        previousTier: org.subscriptionTier,
        offeredPause: false,
        acceptedPause: false,
      });

      // Renoir audit-log: record the user-initiated cancel intent. The
      // Stripe webhook will follow up with the confirmed cancellation event;
      // capturing intent here gives us a reason linkage even if the user
      // never returns from the portal to confirm.
      try {
        const { recordSubscriptionHistoryEvent } = await import("./routes-subscription");
        await recordSubscriptionHistoryEvent({
          organizationId: org.id,
          eventType: "canceled",
          tier: org.subscriptionTier || null,
          billingInterval: org.billingInterval || null,
          priceCents: null,
          metadata: {
            source: "self_serve_cancel_intent",
            reason: parsed.data.reason,
          },
        });
      } catch { /* non-fatal */ }

      // Phase 3 Week 11 — emit a sensitive-action audit event for plan
      // changes. The Stripe webhook is the source of truth for the
      // *confirmed* cancellation; this row captures the user-initiated
      // intent independent of webhook delivery.
      await auditFromRequest(req, {
        action: AuditActions.BILLING_PLAN_SWITCHED,
        target: { type: "billing", id: org.id },
        metadata: {
          op: "self_serve_cancel_intent",
          previousTier: org.subscriptionTier,
          reason: parsed.data.reason,
        },
      });

      // Tahoe / Beatrice — customer-visible security activity.
      void customerAuditFromRequest(req, {
        organizationId: org.id,
        action: CustomerAuditActions.BILLING_SUBSCRIPTION_CANCELLED,
        category: "billing",
        targetLabel: "Subscription",
        metadata: {
          op: "self_serve_cancel_intent",
          previousTier: org.subscriptionTier,
          reason: parsed.data.reason,
        },
      });

      // If they have a Stripe subscription, redirect to portal for actual cancellation
      if (org.stripeCustomerId) {
        const { stripeService } = await import("./stripeService");
        const session = await stripeService.createCustomerPortalSession(
          org.stripeCustomerId,
          `${req.protocol}://${req.get("host")}/settings?cancelled=true`
        );
        return res.json({ portalUrl: session.url });
      }

      // Free tier — nothing to cancel
      return Errors.badRequest(res, "No active subscription to cancel");
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // ============================================
  // SELF-SERVE PAUSE (Tahoe E11 — cancellation 4th rung)
  // ============================================
  //
  // POST /api/subscription/pause
  // Body: { days: 30 | 60 | 90, reason: <same enum as cancel>, feedback? }
  //
  // The cancellation dialog presents pause BEFORE the confirm-cancel screen
  // ("Need a break?" before "Are you sure?"). Stripe handles the billing
  // mechanics via subscription.pause_collection with `keep_as_draft` and a
  // `resumes_at` matching the end of the chosen window. We also flip an
  // org-level `subscriptionPaused = true` guard so the mutation-route
  // middleware can 402 writes in real time — Stripe's collection-pause
  // alone wouldn't gate API access.
  //
  // We log a `cancellation_surveys` row with `accepted_pause = true` so the
  // /founder/customers/cancellation-reasons surface can show the save rate
  // (Sub-2 dependency). The row is the canonical SAVE record — no
  // `recordSubscriptionHistoryEvent('canceled')` is written because the
  // subscription isn't cancelled.
  api.post(
    "/api/subscription/pause",
    isAuthenticated,
    getOrCreateOrg,
    requirePermission("canManageBilling"),
    idempotencyMiddleware,
    async (req, res) => {
      try {
        const org = req.organization;
        const userId = req.user?.id;

        const schema = z.object({
          days: z.union([z.literal(30), z.literal(60), z.literal(90)]),
          reason: z.enum([
            "too_expensive",
            "not_using",
            "missing_features",
            "switching_competitor",
            "other",
          ]),
          feedback: z.string().max(2000).optional(),
        });
        const parsed = schema.safeParse(req.body);
        if (!parsed.success) {
          return Errors.validationFailed(res, parsed.error.issues);
        }

        if (!org.stripeSubscriptionId) {
          return Errors.badRequest(res, "No active subscription to pause");
        }
        if (org.subscriptionPaused) {
          return Errors.badRequest(res, "Subscription is already paused", {
            subscriptionPauseEndsAt: org.subscriptionPauseEndsAt,
          });
        }

        const now = new Date();
        const pauseEnds = new Date(now.getTime() + parsed.data.days * 24 * 60 * 60 * 1000);
        const resumesAtUnix = Math.floor(pauseEnds.getTime() / 1000);

        // Best-effort Stripe pause. If Stripe fails, we don't flip the org
        // flag — better to leave the user un-paused than to leave us in a
        // state where billing continues but the app blocks them.
        try {
          const { stripeService } = await import("./stripeService");
          await stripeService.pauseSubscription(org.stripeSubscriptionId, resumesAtUnix);
        } catch (err) {
          logger.error(
            `[subscription/pause] Stripe pause failed for org ${org.id}`,
            err instanceof Error ? err : undefined,
          );
          return Errors.internal(res, err);
        }

        // Org-level pause guard. The webhook will follow up with
        // customer.subscription.paused and re-affirm this state with the
        // Stripe-confirmed `resumes_at`.
        await storage.updateOrganization(org.id, {
          subscriptionPaused: true,
          subscriptionPausedAt: now,
          subscriptionPauseEndsAt: pauseEnds,
          subscriptionPauseReason: parsed.data.reason,
        });

        // Save-rate row for the founder surface. `accepted_pause = true`
        // marks this as a save; `acceptedDowngrade` stays false.
        await db.insert(cancellationSurveys).values({
          organizationId: org.id,
          userId,
          reason: parsed.data.reason,
          feedback: parsed.data.feedback,
          previousTier: org.subscriptionTier,
          offeredPause: true,
          acceptedPause: true,
          pauseDays: parsed.data.days,
        });

        await auditFromRequest(req, {
          action: AuditActions.BILLING_PLAN_SWITCHED,
          target: { type: "billing", id: org.id },
          metadata: {
            op: "self_serve_pause",
            pauseDays: parsed.data.days,
            pauseEndsAt: pauseEnds.toISOString(),
            reason: parsed.data.reason,
          },
        });

        return res.json({
          paused: true,
          pauseDays: parsed.data.days,
          pauseEndsAt: pauseEnds.toISOString(),
        });
      } catch (err: any) {
        Errors.internal(res, err);
      }
    },
  );

  // ============================================
  // SELF-SERVE REFUND REQUESTS
  // ============================================

  api.post("/api/subscription/refund-request", isAuthenticated, getOrCreateOrg, requirePermission("canManageBilling"), idempotencyMiddleware, async (req, res) => {
    try {
      const org = req.organization;
      const userId = req.user?.id;

      const schema = z.object({
        reason: z.string().min(1).max(500),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return Errors.validationFailed(res, parsed.error.issues);
      }

      if (!org.stripeCustomerId) {
        return Errors.badRequest(res, "No billing account found");
      }

      // Rate limit: reject if org already had a refund in the last 30 days
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const recentRefunds = await db.select({ id: refundRequests.id })
        .from(refundRequests)
        .where(and(
          eq(refundRequests.organizationId, org.id),
          eq(refundRequests.status, "processed"),
          gte(refundRequests.createdAt, thirtyDaysAgo),
        ))
        .limit(1);

      if (recentRefunds.length > 0) {
        return Errors.limitExceeded(res, "A refund was already processed for this account within the last 30 days. Please contact support for further assistance.", { docsSlug: "refund-already-issued" });
      }

      // Find recent charges from Stripe (last 30 days)
      const { getUncachableStripeClient } = await import("./stripeClient");
      const stripe = await getUncachableStripeClient();

      const charges = await stripe.charges.list({
        customer: org.stripeCustomerId,
        limit: 5,
        created: { gte: Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60 },
      });

      if (!charges.data.length) {
        return Errors.badRequest(res, "No charges found within the last 30 days");
      }

      const latestCharge = charges.data[0];
      const amountCents = latestCharge.amount;
      const autoApproveThreshold = 5000; // $50

      const shouldAutoApprove = amountCents <= autoApproveThreshold;

      const [request] = await db.insert(refundRequests).values({
        organizationId: org.id,
        userId,
        stripeChargeId: latestCharge.id,
        stripePaymentIntentId: typeof latestCharge.payment_intent === "string" ? latestCharge.payment_intent : latestCharge.payment_intent?.id,
        amountCents,
        reason: parsed.data.reason,
        status: shouldAutoApprove ? "approved" : "pending",
        autoApproved: shouldAutoApprove,
      }).returning();

      // Auto-process refunds under $50
      if (shouldAutoApprove) {
        try {
          const refund = await stripe.refunds.create({
            charge: latestCharge.id,
          });

          await db.update(refundRequests)
            .set({
              status: "processed",
              processedAt: new Date(),
              processedBy: "auto",
              stripeRefundId: refund.id,
            })
            .where(eq(refundRequests.id, request.id));

          // Cancel subscription and downgrade to free tier
          const previousTier = org.subscriptionTier || "free";
          if (org.stripeSubscriptionId) {
            try {
              await stripe.subscriptions.cancel(org.stripeSubscriptionId);
              logger.info(`[Refund] Cancelled Stripe subscription ${org.stripeSubscriptionId} for org ${org.id}`);
            } catch (cancelErr: any) {
              // Subscription may already be cancelled — log but continue
              logger.warn(`[Refund] Could not cancel Stripe subscription ${org.stripeSubscriptionId}`, cancelErr);
            }
          }

          await storage.updateOrganization(org.id, {
            subscriptionTier: "free",
            subscriptionStatus: "cancelled",
            stripeSubscriptionId: null,
          });

          await storage.logSubscriptionEvent({
            organizationId: org.id,
            eventType: "cancel",
            fromTier: previousTier,
            toTier: null,
          });

          // Renoir audit-log: priced cancel for reactivation context.
          try {
            const { recordSubscriptionHistoryEvent } = await import("./routes-subscription");
            await recordSubscriptionHistoryEvent({
              organizationId: org.id,
              eventType: "canceled",
              tier: previousTier,
              billingInterval: org.billingInterval || null,
              priceCents: null,
              metadata: {
                source: "refund_auto_cancel",
                refundRequestId: request.id,
              },
            });
          } catch { /* non-fatal */ }

          logger.info(`[Refund] Downgraded org ${org.id} from ${previousTier} to free after refund`);

          // Send confirmation email
          try {
            const { emailService } = await import("./services/emailService");
            const { users } = await import("@shared/models/auth");
            const [owner] = await db.select({ email: users.email }).from(users).where(eq(users.clerkUserId, org.ownerId)).limit(1);
            if (owner?.email) {
              await emailService.sendEmail({
                to: owner.email,
                subject: "Your AcreOS refund has been processed",
                html: `<h2>Refund Processed</h2><p>Your refund of <strong>$${(amountCents / 100).toFixed(2)}</strong> has been processed. It should appear on your statement within 5-10 business days.</p><p>— The AcreOS Team</p>`,
                text: `Your refund of $${(amountCents / 100).toFixed(2)} has been processed. It should appear within 5-10 business days.\n\n— The AcreOS Team`,
                transactional: true, // billing receipt — not commercial
              });
            }
          } catch {}

          // Phase 3 Week 11 — refund issuance is a sensitive billing event.
          await auditFromRequest(req, {
            action: AuditActions.BILLING_REFUND_ISSUED,
            target: { type: "billing", id: org.id },
            metadata: {
              op: "auto_refund",
              refundRequestId: request.id,
              stripeRefundId: refund.id,
              amountCents,
              previousTier,
            },
          });

          return res.json({ status: "processed", amountCents, message: "Refund processed automatically" });
        } catch (refundErr: any) {
          logger.error("[Refund] Auto-refund failed", refundErr);
          await db.update(refundRequests).set({ status: "pending", autoApproved: false }).where(eq(refundRequests.id, request.id));
          return res.json({ status: "pending", amountCents, message: "Refund submitted for manual review" });
        }
      }

      // Create system alert for founder to review
      await storage.createSystemAlert({
        type: "refund_request",
        severity: "warning",
        title: `Refund Request: $${(amountCents / 100).toFixed(2)}`,
        message: `Org "${org.name}" requested a refund. Reason: ${parsed.data.reason}`,
        organizationId: org.id,
        relatedEntityType: "refund_request",
        relatedEntityId: request.id,
        status: "new",
      });

      res.json({ status: "pending", amountCents, message: "Refund submitted for review (over $50 requires manual approval)" });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // Get refund request status
  api.get("/api/subscription/refund-requests", isAuthenticated, getOrCreateOrg, requirePermission("canManageBilling"), async (req, res) => {
    try {
      const org = req.organization;
      const requests = await db.select().from(refundRequests)
        .where(eq(refundRequests.organizationId, org.id))
        .orderBy(desc(refundRequests.createdAt))
        .limit(10);
      res.json({ requests });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

}
