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
import portfolioHealthRouter from "./routes-portfolio-health";
import gdprRouter from "./routes-gdpr";
import metricsRouter from "./routes-metrics";
import bulkRouter from "./routes-bulk";

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
import { registerIntegrationRoutes } from "./routes-integrations";
import { registerCRMExtrasRoutes } from "./routes-crm-extras";
import { registerImportExportRoutes } from "./routes-import-export";
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
    });
    next();
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
  registerAdminRoutes(app);
  registerCoreAIRoutes(app);
  registerIntegrationRoutes(app);
  registerCRMExtrasRoutes(app);
  registerImportExportRoutes(app);
  registerTeamMessagingRoutes(app);
  registerDocSystemRoutes(app);
  registerAnalyticsRoutes(app);
  registerCommunicationRoutes(app);
  await registerVAEngineRoutes(app);
  await registerMiscRoutes(app);
  registerSupportTicketRoutes(app);

  // Register AI Operations (Router-based)
  registerAIOperationsRoutes(app);

  // ─── Elite Features (Tax Escrow, E-Signing, DD Engine, Meta Ads, Actum, Syndication, Bookkeeping, VA) ──
  await registerEliteFeatureRoutes(app);

  // ─── Address Verification ──────────────────────────────────────────
  const { isAuthenticated } = await import("./auth");
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
