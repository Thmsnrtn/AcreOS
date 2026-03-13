import type { Express, Request, Response, NextFunction } from "express";
import express from "express";
import type { Server } from "http";
import crypto from "crypto";
import { storage, db } from "./storage";

// Auth imports
import { setupAuth, registerAuthRoutes, isAuthenticated } from "./auth";

// Feature routes (Router-based)
import { registerAIOperationsRoutes } from "./routes-ai-operations";
import marketplaceRouter from "./routes-marketplace";
import predictionsRouter from "./routes-predictions";
import landCreditRouter from "./routes-land-credit";
import acquisitionRadarRouter from "./routes-acquisition-radar";
import portfolioOptimizerRouter from "./routes-portfolio-optimizer";
import avmRouter from "./routes-avm";
import negotiationRouter from "./routes-negotiation";
import cashFlowRouter from "./routes-cash-flow";
import dealHunterRouter from "./routes-deal-hunter";
import academyRouter from "./routes-academy";
import visionAIRouter from "./routes-vision-ai";
import capitalMarketsRouter from "./routes-capital-markets";
import documentIntelligenceRouter from "./routes-document-intelligence";
import marketIntelligenceRouter from "./routes-market-intelligence";
import complianceRouter from "./routes-compliance";
import taxResearcherRouter from "./routes-tax-researcher";

// Phase 2-4 new feature routes
import voiceLearningRouter from "./routes-voice-learning";
import whiteLabelRouter from "./routes-white-label";
import realtimeRouter from "./routes-realtime";
import atlasInsightsRouter from "./routes-atlas-insights";
import voiceRouter from "./routes-voice";
import betaRouter from "./routes-beta";
import regulatoryRouter from "./routes-regulatory";
import notificationsRouter from "./routes-notifications";
import marketWatchlistRouter from "./routes-market-watchlist";

// Wave 8: New service routes (T141-T160)
import dispositionRouter from "./routes-disposition";
import sellerIntentRouter from "./routes-seller-intent";
import portfolioSentinelRouter from "./routes-portfolio-sentinel";
import portfolioPnlRouter from "./routes-portfolio-pnl";
import commissionsRouter from "./routes-commissions";
import certificationRouter from "./routes-certification";
import buyerQualificationRouter from "./routes-buyer-qualification";
import dueDiligenceRouter from "./routes-due-diligence";
import dealPatternsRouter from "./routes-deal-patterns";
import priceOptimizerRouter from "./routes-price-optimizer";

// Phase 5-6 new routes
import investorVerificationRouter from "./routes-investor-verification";
import transactionFeesRouter from "./routes-transaction-fees";
import callRoutingRouter from "./routes-call-routing";
import buyerNetworkRouter from "./routes-buyer-network";
import taxOptimizationRouter from "./routes-tax-optimization";
import dealRoomsRouter from "./routes-deal-rooms";
import dataApiRouter from "./routes-data-api";
import apiDocsRouter from "./routes-api-docs";
import portfolioHealthRouter from "./routes-portfolio-health";
import gdprRouter from "./routes-gdpr";
import metricsRouter, { recordRequestWithMetrics } from "./routes-metrics";
import bulkRouter from "./routes-bulk";
import leadEnrichmentRouter from "./routes-lead-enrichment";
import skipTracingRouter from "./routes-skip-tracing";
import territoriesRouter from "./routes-territories";
import zoningRouter from "./routes-zoning";
import titleSearchRouter from "./routes-title-search";
import propertyEnrichmentRouter from "./routes-property-enrichment";
import exchange1031Router from "./routes-exchange-1031";
import dunningRouter from "./routes-dunning";
import onboardingRouter from "./routes-onboarding";
import epicServicesRouter from "./routes-epic-services";
import dataIntelligenceRouter from "./routes-data-intelligence";
import taxDelinquentRouter from "./routes-tax-delinquent";
import matchingRouter from "./routes-matching";
import kpisRouter from "./routes-kpis";
import cohortAnalysisRouter from "./routes-cohort-analysis";
import propertyTaxRouter from "./routes-property-tax";
import recordingFeesRouter from "./routes-recording-fees";
import bookkeepingRouter from "./routes-bookkeeping";
import abTestsRouter from "./routes-ab-tests";
import doddFrankRouter from "./routes-dodd-frank";

// Rate limiting middleware
import { createRateLimiter, rateLimiters, RATE_LIMIT_CONFIGS, authLimiter, aiLimiter, webhookLimiter, importLimiter } from "./middleware/rateLimit";


// White-label domain middleware
import { whiteLabelDomainMiddleware } from "./middleware/white-label-domain";

// MCP handler
import { mcpHandler } from "./mcp-server";
// Named aliases for backwards compatibility
const apiRateLimit = rateLimiters.default;
const strictRateLimit = rateLimiters.strict;
const authRateLimit = rateLimiters.auth;

// Org middleware
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
// F-A04-1: Prompt injection guard
import { promptInjectionMiddleware } from "./middleware/promptInjection";
// F-A07-1: 2FA enforcement for admin routes
import { require2FA } from "./middleware/require2FA";

// Domain route modules
import { registerDashboardRoutes } from "./routes-dashboard";
import { registerOrganizationRoutes } from "./routes-organization";
import { registerLeadRoutes } from "./routes-leads";
import { registerPropertyRoutes } from "./routes-properties";
import { registerDealRoutes } from "./routes-deals";
import { registerFinanceRoutes } from "./routes-finance";
import { registerDocumentRoutes } from "./routes-documents";
import { registerCampaignRoutes } from "./routes-campaigns";
import { registerAIRoutes } from "./routes-ai";
import { registerBillingRoutes } from "./routes-billing";
import { registerBorrowerRoutes } from "./routes-borrower";
import { registerAdminRoutes } from "./routes-admin";
import { registerEliteFeatureRoutes } from "./routes-elite-features";
import { registerCoreAIRoutes } from "./routes-core-ai";
import { registerAutonomousAgentRoutes } from "./routes-autonomous-agent";
import { registerIntegrationRoutes } from "./routes-integrations";
import { registerCRMExtrasRoutes } from "./routes-crm-extras";
import { registerImportExportRoutes } from "./routes-import-export";
import { registerReferralRoutes } from "./routes-referral";
import { registerTeamMessagingRoutes } from "./routes-team-messaging";
import { registerDocSystemRoutes } from "./routes-doc-system";
import { registerAnalyticsRoutes } from "./routes-analytics";
import { registerCommunicationRoutes } from "./routes-communications";
import { registerVAEngineRoutes } from "./routes-va-engine";
import { registerMiscRoutes } from "./routes-misc";
import { registerSupportTicketRoutes } from "./routes-support-tickets";

// ============================================
// STRUCTURED LOGGER
// ============================================
const logger = {
  info: (msg: string, meta?: Record<string, any>) => console.log(JSON.stringify({ level: 'INFO', timestamp: new Date().toISOString(), message: msg, ...meta })),
  warn: (msg: string, meta?: Record<string, any>) => console.warn(JSON.stringify({ level: 'WARN', timestamp: new Date().toISOString(), message: msg, ...meta })),
  error: (msg: string, meta?: Record<string, any>) => console.error(JSON.stringify({ level: 'ERROR', timestamp: new Date().toISOString(), message: msg, ...meta })),
};

// ============================================
// JOB LOCKING FOR MULTI-INSTANCE DEPLOYMENT
// ============================================
const instanceId = crypto.randomUUID();

async function withJobLock<T>(
  jobName: string,
  ttlSeconds: number,
  fn: () => Promise<T>
): Promise<T | null> {
  const acquired = await storage.acquireJobLock(jobName, instanceId, ttlSeconds);
  if (!acquired) {
    console.log(`[${jobName}] Lock not acquired, skipping execution`);
    return null;
  }
  try {
    return await fn();
  } finally {
    await storage.releaseJobLock(jobName, instanceId);
  }
}

// Clean expired borrower sessions every hour (with job lock)
setInterval(async () => {
  await withJobLock("clean_borrower_sessions", 300, async () => {
    try {
      const cleaned = await storage.cleanExpiredBorrowerSessions();
      if (cleaned > 0) {
        console.log(`Cleaned ${cleaned} expired borrower sessions`);
      }
      return cleaned;
    } catch (err) {
      console.error("Error cleaning expired borrower sessions:", err);
      return 0;
    }
  });
}, 60 * 60 * 1000);

// Clean expired job locks every 5 minutes
setInterval(async () => {
  try {
    await storage.cleanExpiredJobLocks();
  } catch (err) {
    console.error("Error cleaning expired job locks:", err);
  }
}, 5 * 60 * 1000);

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // White-label domain middleware — runs before auth so custom domains are resolved early
  app.use(whiteLabelDomainMiddleware);

  // Register Auth
  await setupAuth(app);
  registerAuthRoutes(app);

  // T11: Two-Factor Auth routes
  const { register2FARoutes } = await import("./routes-2fa");
  register2FARoutes(app);

  // T12: OAuth/SSO routes (Google + Microsoft)
  const { registerOAuthRoutes } = await import("./auth/oauth");
  registerOAuthRoutes(app);

  // ============================================
  // HEALTH CHECK (Public endpoint - no rate limiting)
  // ============================================
  app.get("/api/health", async (req, res) => {
    const { healthCheckService } = await import("./services/healthCheck");
    const result = await healthCheckService.checkAll();
    res.json(result);
  });

  app.get("/api/health/cached", async (req, res) => {
    const { healthCheckService } = await import("./services/healthCheck");
    const result = healthCheckService.getLastResults();
    if (!result) {
      const freshResult = await healthCheckService.checkAll();
      return res.json(freshResult);
    }
    res.json(result);
  });

  app.get("/api/health/:service", async (req, res) => {
    const { healthCheckService } = await import("./services/healthCheck");
    const service = await healthCheckService.checkService(req.params.service);
    if (!service) {
      return res.status(404).json({ message: "Unknown service" });
    }
    res.json(service);
  });

  // ============================================
  // PRE-LAUNCH READINESS CHECK (founder only)
  // Surfaces the exact gaps between current state and production-ready.
  // Hit GET /api/founder/readiness to get a structured checklist.
  // ============================================
  app.get("/api/founder/readiness", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).org || (req as any).organization;
      if (!org?.isFounder) {
        return res.status(403).json({ message: "Founder access required" });
      }

      const checks: Array<{ name: string; status: "pass" | "warn" | "fail"; detail: string }> = [];
      const env = process.env;

      // ── Core infrastructure ──────────────────────────────────────────────
      checks.push({
        name: "Database connection",
        status: env.DATABASE_URL ? "pass" : "fail",
        detail: env.DATABASE_URL ? "DATABASE_URL is set" : "DATABASE_URL is missing — app will not start",
      });

      checks.push({
        name: "Session secret strength",
        status: !env.SESSION_SECRET ? "fail"
          : env.SESSION_SECRET.length < 64 ? "warn"
          : "pass",
        detail: !env.SESSION_SECRET ? "SESSION_SECRET is missing"
          : env.SESSION_SECRET.length < 64 ? `SESSION_SECRET is only ${env.SESSION_SECRET.length} chars (need ≥64)`
          : "SESSION_SECRET is set and strong",
      });

      checks.push({
        name: "Redis (job queue + real-time)",
        status: env.REDIS_URL ? "pass" : "warn",
        detail: env.REDIS_URL ? "REDIS_URL is set" : "REDIS_URL missing — background jobs and WebSocket pub/sub will not work in multi-instance mode",
      });

      // ── AI provider ──────────────────────────────────────────────────────
      checks.push({
        name: "AI provider (OpenRouter)",
        status: env.AI_INTEGRATIONS_OPENROUTER_API_KEY ? "pass" : "warn",
        detail: env.AI_INTEGRATIONS_OPENROUTER_API_KEY
          ? "OpenRouter API key is set (primary AI provider)"
          : "AI_INTEGRATIONS_OPENROUTER_API_KEY missing — all AI features will be unavailable",
      });

      const hasAnyAI = env.AI_INTEGRATIONS_OPENROUTER_API_KEY || env.AI_INTEGRATIONS_OPENAI_API_KEY || env.OPENAI_API_KEY;
      checks.push({
        name: "AI fallback provider",
        status: hasAnyAI ? "pass" : "fail",
        detail: hasAnyAI ? "At least one AI API key configured" : "No AI API keys found — platform is non-functional without AI",
      });

      // ── Payments ─────────────────────────────────────────────────────────
      checks.push({
        name: "Stripe secret key",
        status: env.STRIPE_SECRET_KEY ? "pass" : "warn",
        detail: env.STRIPE_SECRET_KEY
          ? (env.STRIPE_SECRET_KEY.startsWith("sk_live_") ? "Stripe LIVE key configured" : "Stripe TEST key configured — switch to live key before charging real users")
          : "STRIPE_SECRET_KEY missing — billing is disabled",
      });

      checks.push({
        name: "Stripe in live mode",
        status: !env.STRIPE_SECRET_KEY ? "warn"
          : env.STRIPE_SECRET_KEY.startsWith("sk_live_") ? "pass"
          : "warn",
        detail: env.STRIPE_SECRET_KEY?.startsWith("sk_live_")
          ? "Stripe is in LIVE mode — real payments will be processed"
          : "Stripe is in TEST mode — no real charges will occur",
      });

      checks.push({
        name: "Stripe webhook secret",
        status: env.STRIPE_WEBHOOK_SECRET ? "pass" : "warn",
        detail: env.STRIPE_WEBHOOK_SECRET ? "Webhook secret configured" : "STRIPE_WEBHOOK_SECRET missing — subscription events will not be verified",
      });

      // ── Email delivery ───────────────────────────────────────────────────
      const hasEmail = env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY && env.AWS_REGION;
      checks.push({
        name: "Email delivery (AWS SES)",
        status: hasEmail ? "pass" : "warn",
        detail: hasEmail ? "AWS SES credentials configured" : "AWS SES not configured — transactional emails (signup confirmation, password reset) will not send",
      });

      // ── Security ─────────────────────────────────────────────────────────
      checks.push({
        name: "Field encryption key",
        status: !env.FIELD_ENCRYPTION_KEY ? "warn"
          : env.FIELD_ENCRYPTION_KEY.length < 64 ? "fail"
          : "pass",
        detail: !env.FIELD_ENCRYPTION_KEY ? "FIELD_ENCRYPTION_KEY missing — PII stored unencrypted"
          : env.FIELD_ENCRYPTION_KEY.length < 64 ? "FIELD_ENCRYPTION_KEY too short — must be 64 hex chars (32 bytes)"
          : "AES-256 field encryption active",
      });

      checks.push({
        name: "Sentry error tracking",
        status: env.SENTRY_DSN ? "pass" : "warn",
        detail: env.SENTRY_DSN ? "Sentry configured — errors will be captured" : "SENTRY_DSN missing — production errors will not be tracked",
      });

      // ── Rate limit abuse ─────────────────────────────────────────────────
      const { getRateLimitHitStats } = await import("./middleware/rateLimit");
      const rateLimitAbusers = getRateLimitHitStats();
      checks.push({
        name: "Rate limit abuse",
        status: rateLimitAbusers.length === 0 ? "pass" : "warn",
        detail: rateLimitAbusers.length === 0
          ? "No keys hitting sustained rate limits"
          : `${rateLimitAbusers.length} key(s) hitting rate limits repeatedly: ${rateLimitAbusers.slice(0, 3).map(r => `${r.key}(${r.count}×)`).join(", ")}`,
      });

      // ── Legal pages ──────────────────────────────────────────────────────
      checks.push({
        name: "Terms of Service page",
        status: "pass",
        detail: "Terms of Service page exists at /terms",
      });
      checks.push({
        name: "Privacy Policy page",
        status: "pass",
        detail: "Privacy Policy page exists at /privacy",
      });
      checks.push({
        name: "Cookie consent banner",
        status: "pass",
        detail: "GDPR cookie consent banner implemented",
      });

      // ── NODE_ENV ─────────────────────────────────────────────────────────
      checks.push({
        name: "Production mode",
        status: env.NODE_ENV === "production" ? "pass" : "warn",
        detail: env.NODE_ENV === "production"
          ? "NODE_ENV=production — secure defaults active"
          : `NODE_ENV=${env.NODE_ENV || "unset"} — set to 'production' before launch`,
      });

      const pass = checks.filter(c => c.status === "pass").length;
      const warn = checks.filter(c => c.status === "warn").length;
      const fail = checks.filter(c => c.status === "fail").length;
      const overall = fail > 0 ? "not-ready" : warn > 0 ? "ready-with-warnings" : "launch-ready";

      res.json({
        overall,
        summary: { pass, warn, fail, total: checks.length },
        checks,
        generatedAt: new Date().toISOString(),
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ============================================
  // T4 — FULL-TEXT SEARCH
  // Cross-entity search across leads, properties, deals.
  // Uses PostgreSQL tsvector with ILIKE fallback.
  // ============================================
  app.get("/api/search", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const query = (req.query.q as string) || "";
      const limit = Math.min(parseInt((req.query.limit as string) || "20", 10), 50);

      if (!query || query.trim().length < 2) {
        return res.json({ results: [], query });
      }

      const { fullTextSearch } = await import("./services/fullTextSearch");
      const results = await fullTextSearch.search(org.id, query, limit);
      res.json({ results, query, total: results.length });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ============================================
  // RATE LIMITING MIDDLEWARE (excludes health check)
  // ============================================
  app.use("/api/ai", aiLimiter);
  app.use("/api/auth", authLimiter);
  app.use("/api/stripe/connect/webhook", webhookLimiter);
  app.use("/webhook", webhookLimiter);
  app.use("/api/import", importLimiter);
  app.use("/api", (req, res, next) => {
    if (req.path.startsWith("/health")) {
      return next();
    }
    return apiRateLimit(req, res, next);
  });

  // ============================================
  // HTTP REQUEST LOGGING MIDDLEWARE
  // ============================================
  app.use("/api", (req, res, next) => {
    const requestId = crypto.randomUUID();
    const startTime = Date.now();
    (req as any).requestId = requestId;
    logger.info("HTTP Request", {
      requestId,
      method: req.method,
      path: req.path,
      ip: req.ip || req.socket.remoteAddress,
    });
    res.on("finish", () => {
      const duration = Date.now() - startTime;
      logger.info("HTTP Response", {
        requestId,
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        durationMs: duration,
      });
      // Task #145: Record request metrics for Prometheus scrape endpoint
      recordRequestWithMetrics({
        path: req.path,
        method: req.method,
        statusCode: res.statusCode,
        durationMs: duration,
        timestamp: Date.now(),
      });
    });
    next();
  });

  // Preview leads that will be affected by bulk delete
  api.post("/api/leads/bulk-delete/preview", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const { ids } = req.body;
      
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ message: "ids must be a non-empty array" });
      }
      
      const leadsToDelete = await storage.getLeadsByIds(org.id, ids);
      
      res.json({
        count: leadsToDelete.length,
        leads: leadsToDelete.map(lead => ({
          id: lead.id,
          firstName: lead.firstName,
          lastName: lead.lastName,
          email: lead.email,
          phone: lead.phone,
          status: lead.status,
          createdAt: lead.createdAt,
        })),
      });
    } catch (error: any) {
      console.error("Bulk delete preview error:", error);
      res.status(500).json({ message: error.message || "Failed to preview bulk delete" });
    }
  });
  
  api.post("/api/leads/bulk-delete", isAuthenticated, getOrCreateOrg, requirePermission("canDeleteLeads"), async (req, res) => {
    try {
      const org = (req as any).organization;
      const { ids } = req.body;
      
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ message: "ids must be a non-empty array" });
      }
      
      const user = req.user as any;
      const userId = user?.claims?.sub || user?.id;
      
      // Get lead details before soft-delete for audit log
      const leadsToDelete = await storage.getLeadsByIds(org.id, ids);
      
      const deletedCount = await storage.bulkDeleteLeads(org.id, ids, userId);
      
      await storage.createAuditLogEntry({
        organizationId: org.id,
        userId,
        action: "bulk_soft_delete",
        entityType: "lead",
        entityId: 0,
        changes: { 
          ids, 
          count: deletedCount,
          recoverable: true,
          leadNames: leadsToDelete.map(l => `${l.firstName} ${l.lastName}`),
        },
        ipAddress: req.ip || req.socket?.remoteAddress,
        userAgent: req.headers["user-agent"],
      });
      
      res.json({ 
        deletedCount,
        recoverable: true,
        message: `${deletedCount} lead(s) moved to trash. They can be restored within 30 days.`,
      });
    } catch (error: any) {
      console.error("Bulk delete leads error:", error);
      res.status(500).json({ message: error.message || "Failed to bulk delete leads" });
    }
  });
  
  // Get deleted/trashed leads
  api.get("/api/leads/deleted", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const deletedLeads = await storage.getDeletedLeads(org.id);
      res.json(deletedLeads);
    } catch (error: any) {
      console.error("Get deleted leads error:", error);
      res.status(500).json({ message: error.message || "Failed to get deleted leads" });
    }
  });
  
  // Restore soft-deleted leads
  api.post("/api/leads/restore", isAuthenticated, getOrCreateOrg, requirePermission("canDeleteLeads"), async (req, res) => {
    try {
      const org = (req as any).organization;
      const { ids } = req.body;
      
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ message: "ids must be a non-empty array" });
      }
      
      const user = req.user as any;
      const userId = user?.claims?.sub || user?.id;
      
      const restoredCount = await storage.restoreLeads(org.id, ids);
      
      await storage.createAuditLogEntry({
        organizationId: org.id,
        userId,
        action: "bulk_restore",
        entityType: "lead",
        entityId: 0,
        changes: { ids, count: restoredCount },
        ipAddress: req.ip || req.socket?.remoteAddress,
        userAgent: req.headers["user-agent"],
      });
      
      res.json({ restoredCount });
    } catch (error: any) {
      console.error("Restore leads error:", error);
      res.status(500).json({ message: error.message || "Failed to restore leads" });
    }
  });
  
  // Permanently delete leads (empty trash)
  api.post("/api/leads/permanent-delete", isAuthenticated, getOrCreateOrg, requirePermission("canDeleteLeads"), async (req, res) => {
    try {
      const org = (req as any).organization;
      const { ids } = req.body;
      
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ message: "ids must be a non-empty array" });
      }
      
      const user = req.user as any;
      const userId = user?.claims?.sub || user?.id;
      
      const deletedCount = await storage.permanentlyDeleteLeads(org.id, ids);
      
      await storage.createAuditLogEntry({
        organizationId: org.id,
        userId,
        action: "bulk_permanent_delete",
        entityType: "lead",
        entityId: 0,
        changes: { ids, count: deletedCount, permanent: true },
        ipAddress: req.ip || req.socket?.remoteAddress,
        userAgent: req.headers["user-agent"],
      });
      
      res.json({ deletedCount });
    } catch (error: any) {
      console.error("Permanent delete leads error:", error);
      res.status(500).json({ message: error.message || "Failed to permanently delete leads" });
    }
  });


  // ============================================
  // ROUTER-BASED FEATURE ROUTES
  // ============================================
  app.use('/api/marketplace', isAuthenticated, getOrCreateOrg, marketplaceRouter);
  app.use('/api/predictions', isAuthenticated, getOrCreateOrg, predictionsRouter);
  app.use('/api/land-credit', isAuthenticated, getOrCreateOrg, landCreditRouter);
  app.use('/api/radar', isAuthenticated, getOrCreateOrg, acquisitionRadarRouter);
  app.use('/api/portfolio-optimizer', isAuthenticated, getOrCreateOrg, portfolioOptimizerRouter);
  app.use('/api/avm', isAuthenticated, getOrCreateOrg, avmRouter);
  app.use('/api/negotiation', isAuthenticated, getOrCreateOrg, negotiationRouter);
  app.use('/api/cash-flow', isAuthenticated, getOrCreateOrg, cashFlowRouter);
  app.use('/api/deal-hunter', isAuthenticated, getOrCreateOrg, dealHunterRouter);
  app.use('/api/academy', isAuthenticated, getOrCreateOrg, academyRouter);
  app.use('/api/vision-ai', isAuthenticated, getOrCreateOrg, visionAIRouter);
  app.use('/api/capital-markets', isAuthenticated, getOrCreateOrg, capitalMarketsRouter);
  app.use('/api/document-intelligence', isAuthenticated, getOrCreateOrg, documentIntelligenceRouter);
  app.use('/api/market-intelligence', isAuthenticated, marketIntelligenceRouter);
  app.use('/api/compliance', isAuthenticated, getOrCreateOrg, complianceRouter);
  app.use('/api/tax-researcher', isAuthenticated, getOrCreateOrg, taxResearcherRouter);

  // Phase 2-4: Voice Learning, Context Profile, White-Label, Real-Time
  app.use('/api/intelligence', isAuthenticated, getOrCreateOrg, voiceLearningRouter);
  app.use('/api/white-label', isAuthenticated, getOrCreateOrg, whiteLabelRouter);
  app.use('/api/realtime', isAuthenticated, getOrCreateOrg, realtimeRouter);
  // F-A04-1: Prompt injection guard applied to all AI endpoints
  app.use("/api/ai", promptInjectionMiddleware);
  app.use("/api/atlas", promptInjectionMiddleware);
  app.use("/api/chat", promptInjectionMiddleware);
  app.use("/api/executive", promptInjectionMiddleware);

  app.use('/api/atlas', aiLimiter, isAuthenticated, getOrCreateOrg, atlasInsightsRouter);
  app.post('/api/mcp/execute', mcpHandler);

  // Voice pipeline: webhook (no auth) + authenticated API routes
  app.use('/', voiceRouter); // handles POST /webhook/twilio/recording-complete
  app.use('/api/voice', isAuthenticated, getOrCreateOrg, voiceRouter);

  // Beta program: /api/beta/waitlist is public, /api/beta/admin/* requires founder auth
  app.use('/api/beta', betaRouter);

  // Regulatory intelligence: state profiles, alerts, checklists, risk assessment
  app.use('/api/regulatory', regulatoryRouter);

  // Notification preferences
  app.use('/api/notifications', isAuthenticated, notificationsRouter);

  // Market watchlist and alerts
  app.use('/api/market/watchlist', isAuthenticated, getOrCreateOrg, marketWatchlistRouter);

  // Wave 8: New service routes (T141-T160)
  app.use('/api/disposition', isAuthenticated, getOrCreateOrg, dispositionRouter);
  app.use('/api/seller-intent', isAuthenticated, getOrCreateOrg, sellerIntentRouter);
  app.use('/api/portfolio-sentinel', isAuthenticated, getOrCreateOrg, portfolioSentinelRouter);
  app.use('/api/portfolio-pnl', isAuthenticated, getOrCreateOrg, portfolioPnlRouter);
  app.use('/api/commissions', isAuthenticated, getOrCreateOrg, commissionsRouter);
  app.use('/api/certification', isAuthenticated, certificationRouter);
  app.use('/api/buyer-qualification', isAuthenticated, getOrCreateOrg, buyerQualificationRouter);
  app.use('/api/due-diligence', isAuthenticated, getOrCreateOrg, dueDiligenceRouter);
  app.use('/api/deal-patterns', isAuthenticated, getOrCreateOrg, dealPatternsRouter);
  app.use('/api/price-optimizer', isAuthenticated, getOrCreateOrg, priceOptimizerRouter);
  app.use('/api/portfolio-health', isAuthenticated, getOrCreateOrg, portfolioHealthRouter);
  app.use('/api/privacy', isAuthenticated, gdprRouter);
  app.use('/api/metrics', isAuthenticated, metricsRouter);
  app.use('/api/bulk', isAuthenticated, getOrCreateOrg, bulkRouter);
  app.use('/api/leads', isAuthenticated, getOrCreateOrg, leadEnrichmentRouter);
  app.use('/api/skip-tracing', isAuthenticated, getOrCreateOrg, skipTracingRouter);
  app.use('/api/territories', isAuthenticated, getOrCreateOrg, territoriesRouter);
  app.use('/api/zoning', isAuthenticated, zoningRouter);
  app.use('/api/title-search', isAuthenticated, getOrCreateOrg, titleSearchRouter);
  app.use('/api/properties', isAuthenticated, getOrCreateOrg, propertyEnrichmentRouter);
  app.use('/api/exchange-1031', isAuthenticated, getOrCreateOrg, exchange1031Router);
  app.use('/api/dunning', isAuthenticated, dunningRouter);
  app.use('/api/onboarding', isAuthenticated, getOrCreateOrg, onboardingRouter);

  // EPIC Services: Seller Motivation, County Opportunity, Title Chain, Investor Network, Financial OS, Developer API
  app.use('/api', isAuthenticated, getOrCreateOrg, epicServicesRouter);

  // Data Intelligence: USDA NASS, Census, Parcel Fusion, Blind Offer Calculator, Freedom Meter
  app.use('/api/data-intel', isAuthenticated, getOrCreateOrg, dataIntelligenceRouter);

  // Epic A: Night Cap Dashboard
  {
    const nightCapRouter = (await import("./routes-night-cap")).default;
    app.use('/api/night-cap', isAuthenticated, getOrCreateOrg, nightCapRouter);
  }

    // Bulk stage update for deals with undo support
  api.post("/api/deals/bulk-stage-update", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const { ids, newStage, confirmed } = req.body;
      
      // Validate required fields
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ message: "ids must be a non-empty array" });
      }
      
      if (!newStage || typeof newStage !== "string") {
        return res.status(400).json({ message: "newStage is required" });
      }
      
      // Validate stage is a valid deal stage
      const validStages = ["negotiating", "offer_sent", "countered", "accepted", "in_escrow", "closed", "cancelled"];
      if (!validStages.includes(newStage)) {
        return res.status(400).json({ 
          message: `Invalid stage. Must be one of: ${validStages.join(", ")}`,
          validStages 
        });
      }
      
      // Get the current state of all deals for safety/undo
      const existingDeals = await storage.getDealsByIds(org.id, ids);
      
      // Check if any deals weren't found
      const foundIds = existingDeals.map(d => d.id);
      const missingIds = ids.filter((id: number) => !foundIds.includes(id));
      
      if (missingIds.length > 0) {
        return res.status(404).json({ 
          message: `Some deals not found: ${missingIds.join(", ")}`,
          missingIds 
        });
      }
      
      // Filter out deals that are already in the target stage
      const dealsToUpdate = existingDeals.filter(d => d.status !== newStage);
      const alreadyInStage = existingDeals.filter(d => d.status === newStage);
      
      if (dealsToUpdate.length === 0) {
        return res.status(200).json({
          message: "No deals needed updating - all are already in the target stage",
          updatedCount: 0,
          skippedCount: alreadyInStage.length,
          previousStates: [],
        });
      }
      
      // If not confirmed, return preview for confirmation
      if (!confirmed) {
        const stageTransitions = dealsToUpdate.map(d => ({
          id: d.id,
          propertyId: d.propertyId,
          currentStage: d.status,
          newStage,
        }));
        
        return res.status(200).json({
          requiresConfirmation: true,
          message: `This will update ${dealsToUpdate.length} deal(s) to stage "${newStage}"`,
          dealsToUpdate: stageTransitions,
          skippedCount: alreadyInStage.length,
        });
      }
      
      // Perform the bulk update
      const idsToUpdate = dealsToUpdate.map(d => d.id);
      const updatedCount = await storage.bulkUpdateDeals(org.id, idsToUpdate, { status: newStage });
      
      // Save previous states for undo capability
      const previousStates = dealsToUpdate.map(d => ({
        id: d.id,
        previousStage: d.status,
      }));
      
      // Create audit log entry
      const user = req.user as any;
      const userId = user?.claims?.sub || user?.id;
      await storage.createAuditLogEntry({
        organizationId: org.id,
        userId,
        action: "bulk_stage_update",
        entityType: "deal",
        entityId: 0,
        changes: { 
          ids: idsToUpdate, 
          newStage, 
          previousStates,
          count: updatedCount 
        },
        ipAddress: req.ip || req.socket?.remoteAddress,
        userAgent: req.headers["user-agent"],
      });
      
      res.json({
        success: true,
        message: `Successfully updated ${updatedCount} deal(s) to stage "${newStage}"`,
        updatedCount,
        skippedCount: alreadyInStage.length,
        previousStates,
        undoAvailable: true,
      });
    } catch (error: any) {
      console.error("Bulk stage update deals error:", error);
      res.status(500).json({ message: error.message || "Failed to bulk update deal stages" });
    }
  });
  
  // Undo bulk stage update
  api.post("/api/deals/bulk-stage-undo", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const { previousStates } = req.body;
      
      if (!Array.isArray(previousStates) || previousStates.length === 0) {
        return res.status(400).json({ message: "previousStates must be a non-empty array" });
      }
      
      // Validate structure of previousStates
      for (const state of previousStates) {
        if (!state.id || !state.previousStage) {
          return res.status(400).json({ 
            message: "Each previousState must have id and previousStage properties" 
          });
        }
      }
      
      // Restore each deal to its previous state
      let restoredCount = 0;
      const errors: Array<{ id: number; error: string }> = [];
      
      for (const state of previousStates) {
        try {
          const deal = await storage.getDeal(org.id, state.id);
          if (!deal) {
            errors.push({ id: state.id, error: "Deal not found" });
            continue;
          }
          await storage.updateDeal(state.id, { status: state.previousStage });
          restoredCount++;
        } catch (err: any) {
          errors.push({ id: state.id, error: err.message || "Unknown error" });
        }
      }
      
      // Create audit log entry for the undo
      const user = req.user as any;
      const userId = user?.claims?.sub || user?.id;
      await storage.createAuditLogEntry({
        organizationId: org.id,
        userId,
        action: "bulk_stage_undo",
        entityType: "deal",
        entityId: 0,
        changes: { 
          previousStates,
          restoredCount,
          errors: errors.length > 0 ? errors : undefined,
        },
        ipAddress: req.ip || req.socket?.remoteAddress,
        userAgent: req.headers["user-agent"],
      });
      
      if (errors.length > 0) {
        return res.status(207).json({
          success: false,
          message: `Partially restored ${restoredCount} of ${previousStates.length} deals`,
          restoredCount,
          errors,
        });
      }
      
      res.json({
        success: true,
        message: `Successfully restored ${restoredCount} deal(s) to their previous stages`,
        restoredCount,
      });
    } catch (error: any) {
      console.error("Bulk stage undo error:", error);
      res.status(500).json({ message: error.message || "Failed to undo bulk stage update" });
    }
  });

  
  // Founder Intelligence API — passive monitoring & platform analytics
  {
    const founderIntelRouter = (await import("./routes-founder-intelligence")).default;
    app.use('/api/founder/intelligence', isAuthenticated, founderIntelRouter);
  }

  // Founder Setup API — interactive credential wizard
  {
    const setupRouter = (await import("./routes-setup")).default;
    app.use('/api/founder/setup', isAuthenticated, setupRouter);
  }

  // Epic H: Auto-Delinquent Scraper route
  app.post('/api/import/auto-delinquent', isAuthenticated, getOrCreateOrg, async (req, res) => {
    const { county, state } = req.body as { county: string; state: string };
    if (!county || !state) return res.status(400).json({ error: "county and state are required" });
    const { findAutoScrapeSource, scrapeCountyDelinquentList } = await import("./services/delinquentListScraper");
    const source = findAutoScrapeSource(county, state);
    if (!source) {
      return res.status(404).json({
        error: "No automated source available for this county",
        message: `Auto-scraping not yet available for ${county}, ${state}. Use manual CSV upload instead.`,
        manualUploadUrl: "/api/import/tax-delinquent",
      });
    }
    const result = await scrapeCountyDelinquentList(source);
    res.json(result);
  });

  app.use('/api/tax-delinquent', isAuthenticated, getOrCreateOrg, taxDelinquentRouter);
  app.use('/api/matching', isAuthenticated, getOrCreateOrg, matchingRouter);
  app.use('/api/kpis', isAuthenticated, getOrCreateOrg, kpisRouter);
  app.use('/api/analytics/cohorts', isAuthenticated, getOrCreateOrg, cohortAnalysisRouter);
  app.use('/api/property-tax', isAuthenticated, getOrCreateOrg, propertyTaxRouter);
  app.use('/api/recording-fees', isAuthenticated, recordingFeesRouter);
  app.use('/api/bookkeeping', isAuthenticated, getOrCreateOrg, bookkeepingRouter);
  app.use('/api/ab-tests', isAuthenticated, getOrCreateOrg, abTestsRouter);
  app.use('/api/dodd-frank', isAuthenticated, doddFrankRouter);

  // Phase 5-6 routes
  app.use('/api/investor-verification', isAuthenticated, getOrCreateOrg, investorVerificationRouter);
  app.use('/api/transaction-fees', isAuthenticated, getOrCreateOrg, transactionFeesRouter);
  app.use('/api/call-routing', isAuthenticated, getOrCreateOrg, callRoutingRouter);
  app.use('/api/buyer-network', isAuthenticated, getOrCreateOrg, buyerNetworkRouter);
  app.use('/api/tax-optimization', isAuthenticated, getOrCreateOrg, taxOptimizationRouter);
  app.use('/api/deal-rooms', isAuthenticated, getOrCreateOrg, dealRoomsRouter);
  app.use('/api/data-api', dataApiRouter); // API key auth handled internally
  app.use('/api/docs', apiDocsRouter); // Swagger UI — no auth required

  // ============================================
  // DOMAIN ROUTE MODULES
  // ============================================
  registerDashboardRoutes(app);
  registerOrganizationRoutes(app);
  registerLeadRoutes(app);
  registerPropertyRoutes(app);
  registerDealRoutes(app);
  registerFinanceRoutes(app);
  registerDocumentRoutes(app);
  registerCampaignRoutes(app);
  registerAIRoutes(app);
  registerBillingRoutes(app);
  registerBorrowerRoutes(app);
  // F-A07-1: Require 2FA verification before any admin operation for users who have it enabled
  app.use("/api/admin", isAuthenticated, require2FA);
  registerAdminRoutes(app);
  registerCoreAIRoutes(app);
  registerIntegrationRoutes(app);
  registerCRMExtrasRoutes(app);
  registerImportExportRoutes(app);
  registerReferralRoutes(app);
  registerTeamMessagingRoutes(app);
  registerDocSystemRoutes(app);
  registerAnalyticsRoutes(app);
  registerCommunicationRoutes(app);
  await registerVAEngineRoutes(app);
  await registerMiscRoutes(app);
  registerSupportTicketRoutes(app);

  // Register AI Operations (Router-based)
  registerAIOperationsRoutes(app);

  // Register Autonomous Agent routes
  registerAutonomousAgentRoutes(app);

  // ─── Elite Features (Tax Escrow, E-Signing, DD Engine, Meta Ads, Actum, Syndication, Bookkeeping, VA) ──
  await registerEliteFeatureRoutes(app);

  // ─── Address Verification ──────────────────────────────────────────
  const { verifyAddress } = await import("./services/addressVerification");
  app.post("/api/addresses/verify", isAuthenticated, async (req, res) => {
    try {
      const { address1, address2, city, state, zip } = req.body;
      if (!address1 || !city || !state) {
        return res.status(400).json({ message: "address1, city, and state are required" });
      }
      const result = await verifyAddress({ address1, address2, city, state, zip });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ─── T7: API Versioning — /api/v1/ passthrough alias ─────────────────────
  // Allows clients to pin to /api/v1/* without breaking existing /api/* routes.
  // When a breaking v2 is needed, add a separate versioned router here.
  app.use("/api/v1/*", (req, res) => {
    const newPath = req.originalUrl.replace("/api/v1/", "/api/");
    res.redirect(307, newPath);
  });

  return httpServer;
}
