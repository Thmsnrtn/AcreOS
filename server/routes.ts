import type { Express, Request, Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "./types/request";
import express from "express";
import type { Server } from "http";
import crypto from "crypto";
import { storage, db } from "./storage";

// Auth imports
import { clerkMiddleware, isAuthenticated, registerAuthRoutes } from "./auth";

// Feature routes (Router-based)
import { registerAIOperationsRoutes } from "./routes-ai-operations";
import marketplaceRouter from "./routes-marketplace";
import predictionsRouter from "./routes-predictions";
import landCreditRouter from "./routes-land-credit";
import acquisitionRadarRouter from "./routes-acquisition-radar";
import customerLetterRouter from "./routes-customer-letter";
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
import dealUnderwritingRouter from "./routes-deal-underwriting";

// Phase 2-4 new feature routes
import voiceLearningRouter from "./routes-voice-learning";
import whiteLabelRouter from "./routes-white-label";
import realtimeRouter from "./routes-realtime";
import paxInsightsRouter from "./routes-pax-insights";
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
import apiDocsRouter, { registerApiDocsApp } from "./routes-api-docs";
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
import preferencesRouter from "./routes-preferences";
import autonomyRouter from "./routes-autonomy";
import personaRouter from "./routes-persona";
import featureFlagsRouter from "./routes-feature-flags";
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
import fieldScoutRouter from "./routes-field-scout";
import dealFeedRouter from "./routes-deal-feed";
import visionScanRouter from "./routes-vision-scan";
import commentsRouter from "./routes-comments";

// Phase 1: Communication features
import { registerInboundEmailRoutes } from "./routes-inbound-email";
import { registerSendGridEventRoutes } from "./routes-sendgrid-events";

// Rate limiting middleware
import { createRateLimiter, rateLimiters, RATE_LIMIT_CONFIGS, authLimiter, aiLimiter, webhookLimiter, importLimiter } from "./middleware/rateLimit";


// White-label domain middleware
import { whiteLabelDomainMiddleware } from "./middleware/white-label-domain";
import { correlationIdMiddleware } from "./middleware/correlationId";

// Feature flag gate middleware
import { featureGate } from "./middleware/featureGate";

// MCP handler
import { mcpHandler } from "./mcp-server";
// Named aliases for backwards compatibility
const apiRateLimit = rateLimiters.default;
const strictRateLimit = rateLimiters.strict;
const authRateLimit = rateLimiters.auth;

// Org middleware
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { requirePermission } from "./utils/permissions";
import { activityLogger } from "./services/activityLogger";
import { insertTaskSchema } from "@shared/schema";
// F-A04-1: Prompt injection guard
import { promptInjectionMiddleware } from "./middleware/promptInjection";
// SEC-004: CSRF protection for state-changing requests
import { csrfProtection } from "./middleware/csrf";
// Phase 4: Request timeout middleware (30s timeout → 504)
import { requestTimeout } from "./middleware/security";
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
import aiDraftRouter from "./routes-ai-draft";
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
import { registerMicroFeatureRoutes } from "./routes-micro-features";
import { registerClosingRoutes } from "./routes-closing";
import { registerPlatformFeatureRoutes } from "./routes-platform-features";
import { registerLeaseRoutes } from "./routes-leases";
import { registerMaintenanceRoutes } from "./routes-maintenance";

import { logger } from "./utils/logger";
import { Errors } from "./utils/errors";
import { organizations, leads, properties, deals, npsResponses, feedbackSubmissions, churnRiskScores } from "@shared/schema";
import { monthlyRevenueCentsFor } from "@shared/billing/tier-pricing";
import { eq, and, desc, sql, count, sum, gte, avg } from "drizzle-orm";

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
    logger.info(`[${jobName}] Lock not acquired, skipping execution`);
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
        logger.info(`Cleaned ${cleaned} expired borrower sessions`);
      }
      return cleaned;
    } catch (err) {
      logger.error("Error cleaning expired borrower sessions", err instanceof Error ? err : undefined);
      return 0;
    }
  });
}, 60 * 60 * 1000);

// Clean expired job locks every 5 minutes
setInterval(async () => {
  try {
    await storage.cleanExpiredJobLocks();
  } catch (err) {
    logger.error("Error cleaning expired job locks", err instanceof Error ? err : undefined);
  }
}, 5 * 60 * 1000);

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // Clerk proxy — Cloudflare blocks clerk.acreos.io (Error 1000)
  app.use("/__clerk", express.urlencoded({ extended: false }), express.json(), async (req, res) => {
    try {
      const clerkPath = req.originalUrl.replace(/^\/__clerk/, "") || "/";

      // STR-011 root cause: /v1/client is per-session and MUST NOT be cached
      // across users. The prior cache keyed by a `__client=` cookie regex
      // that never matched (Clerk sets `__client_uat` and `__session`, not
      // `__client`), so every request fell through to the "anon" bucket and
      // signed-in users got served a stale empty-sessions response for up
      // to 60s — blocking hydration after ticket sign-in.
      //
      // /v1/environment is safe to cache (it's public / instance-level,
      // not user-level) — keep that cache, drop the client cache entirely.
      if (req.method === "GET" && clerkPath === "/v1/environment") {
        const cacheKey = `clerk:${clerkPath}`;
        if ((globalThis as any).__clerkCache?.[cacheKey] && Date.now() - (globalThis as any).__clerkCache[cacheKey].ts < 60000) {
          const cached = (globalThis as any).__clerkCache[cacheKey];
          res.setHeader("X-Clerk-Cache", "hit");
          cached.headers.forEach(([k, v]: [string, string]) => res.setHeader(k, v));
          res.status(cached.status);
          return res.end(cached.body);
        }
      }

      const targetUrl = `https://possible-emu-83.clerk.accounts.dev${clerkPath}`;
      const fwdHeaders: Record<string, string> = {
        "Clerk-Proxy-Url": "https://acreos.io/__clerk",
        "Clerk-Secret-Key": process.env.CLERK_SECRET_KEY || "",
      };
      for (const key of ["content-type", "authorization", "cookie", "accept", "user-agent", "referer", "origin"]) {
        if (req.headers[key]) fwdHeaders[key] = req.headers[key] as string;
      }
      fwdHeaders["x-forwarded-for"] = req.ip || req.socket.remoteAddress || "";
      fwdHeaders["x-forwarded-proto"] = "https";
      fwdHeaders["x-forwarded-host"] = "acreos.io";
      let body: string | undefined;
      if (!["GET", "HEAD"].includes(req.method)) {
        const ct = (req.headers["content-type"] || "").toLowerCase();
        if (ct.includes("application/json")) body = JSON.stringify(req.body);
        else if (ct.includes("form-urlencoded") && typeof req.body === "object") body = new URLSearchParams(req.body as Record<string, string>).toString();
        else if (typeof req.body === "string") body = req.body;
      }
      const clerkRes = await fetch(targetUrl, { method: req.method, headers: fwdHeaders, body, redirect: "manual" });

      // Set-Cookie: use getSetCookie() to get each Set-Cookie value as a
      // separate array entry (not merged, not comma-joined). STR-011
      // investigation showed forEach on Node 20 does iterate per-cookie,
      // but getSetCookie() is the spec-blessed multi-value accessor and
      // the safer long-term choice. Also log the cookie names relayed so
      // we can verify __client lands in the browser.
      const setCookies = clerkRes.headers.getSetCookie();
      if (setCookies.length > 0) {
        const cookieNames = setCookies.map((c) => c.split("=")[0]);
        logger.info(`[clerk-proxy] ${req.method} ${clerkPath} -> Set-Cookie: ${cookieNames.join(", ")}`);
        for (const raw of setCookies) {
          res.appendHeader("Set-Cookie", raw.replace(/domain=[^;]+/gi, "domain=.acreos.io"));
        }
      }

      clerkRes.headers.forEach((value, key) => {
        const k = key.toLowerCase();
        if (["transfer-encoding", "connection", "content-encoding", "content-length", "set-cookie"].includes(k)) return;
        if (k === "location") {
          let loc = value;
          if (loc.startsWith("/v1/") || loc.startsWith("/npm/")) loc = "/__clerk" + loc;
          if (loc.includes("possible-emu-83.clerk.accounts.dev")) loc = loc.replace("https://possible-emu-83.clerk.accounts.dev", "/__clerk");
          if (loc.includes("accounts.acreos.io")) loc = "https://acreos.io/";
          res.setHeader(key, loc);
          return;
        }
        res.setHeader(key, value);
      });
      res.status(clerkRes.status);
      const responseBody = Buffer.from(await clerkRes.arrayBuffer());

      // Cache ONLY /v1/environment (instance-level, safe to share).
      // /v1/client is per-session and must not be cached across users.
      if (req.method === "GET" && clerkRes.status < 400 && clerkPath === "/v1/environment") {
        const cacheKey = `clerk:${clerkPath}`;
        if (!(globalThis as any).__clerkCache) (globalThis as any).__clerkCache = {};
        const hdrs: [string, string][] = [];
        clerkRes.headers.forEach((v, k) => { if (!["transfer-encoding","connection","content-encoding","content-length"].includes(k)) hdrs.push([k,v]); });
        (globalThis as any).__clerkCache[cacheKey] = { status: clerkRes.status, headers: hdrs, body: responseBody, ts: Date.now() };
      }

      res.end(responseBody);
    } catch (err: any) {
      logger.error("[clerk-proxy] " + err.message);
      res.status(502).json({ error: "Clerk proxy error" });
    }
  });


  // PERF: HTTP Cache-Control for safe-GET /api/ responses. Registered
  // BEFORE any route definitions — Express only applies middleware to
  // routes registered after it. Earlier placements were silently
  // bypassed because /api/status, /api/changelog, /api/config/features,
  // etc. were defined before the middleware chain.
  const { httpCacheHeaders: _httpCacheHeaders } = await import("./middleware/httpCacheHeaders");
  app.use("/api", _httpCacheHeaders);

  // Public feature flags endpoint — needed before Clerk middleware for sidebar rendering
  app.get("/api/config/features", async (_req, res) => {
    try {
      const flags = await storage.getEnabledFeatureFlags();
      const enabledKeys = flags.map((f: any) => f.key);
      const enabledRoutes = flags.flatMap((f: any) => (f.controlledRoutes || []) as string[]);
      res.json({ enabledKeys, enabledRoutes });
    } catch {
      // On error, return all routes enabled so sidebar shows everything
      res.json({ enabledKeys: [], enabledRoutes: [] });
    }
  });

  // Public changelog endpoint
  app.get("/api/changelog", async (_req, res) => {
    try {
      const fs = await import("fs/promises");
      const path = await import("path");
      const content = await fs.readFile(path.join(process.cwd(), "CHANGELOG.md"), "utf-8");
      const entries: { version: string; date: string; sections: { title: string; items: string[] }[] }[] = [];
      let current: typeof entries[0] | null = null;
      let currentSection: { title: string; items: string[] } | null = null;
      for (const line of content.split("\n")) {
        const versionMatch = line.match(/^## \[?([\d.]+)\]?\s*[-–—]?\s*(.+)?/);
        if (versionMatch) { if (current) entries.push(current); current = { version: versionMatch[1], date: (versionMatch[2] || "").trim(), sections: [] }; currentSection = null; continue; }
        const sectionMatch = line.match(/^### (.+)/);
        if (sectionMatch && current) { currentSection = { title: sectionMatch[1], items: [] }; current.sections.push(currentSection); continue; }
        if (line.startsWith("- ") && currentSection) currentSection.items.push(line.slice(2).trim());
      }
      if (current) entries.push(current);
      res.json({ entries });
    } catch { res.json({ entries: [] }); }
  });

  // Public status endpoint for customers
  app.get("/api/status", async (_req, res) => {
    try {
      const { healthCheckService } = await import("./services/healthCheck");
      const result = healthCheckService.getLastResults() || await healthCheckService.checkAll();
      const services = (result.services || []).map((s: any) => ({
        name: s.name,
        status: s.status === "healthy" ? "operational" : s.status === "degraded" ? "degraded" : s.status === "unconfigured" ? "operational" : "outage",
      }));
      const overall = services.every((s: any) => s.status === "operational") ? "operational"
        : services.some((s: any) => s.status === "outage") ? "outage" : "degraded";
      res.json({ status: overall, services, lastChecked: result.timestamp });
    } catch {
      res.json({ status: "unknown", services: [], lastChecked: new Date() });
    }
  });

  // ============================================
  // HEALTH CHECK (Public endpoint - no rate limiting, no middleware)
  // Mounted BEFORE WhiteLabel/Clerk middleware so health probes never fail
  // due to domain resolution or auth issues.
  // ============================================
  app.get("/api/health", async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { healthCheckService } = await import("./services/healthCheck");
      const result = await healthCheckService.checkAll();
      const statusCode = result.overall === "unavailable" ? 503 : 200;
      res.status(statusCode).json({
        ...result,
        version: process.env.npm_package_version || "1.0.0",
        uptime: process.uptime(),
      });
    } catch (err: any) {
      res.status(503).json({
        overall: "degraded",
        services: [],
        timestamp: new Date(),
        version: process.env.npm_package_version || "1.0.0",
        uptime: process.uptime(),
        error: err?.message || "health check failed",
      });
    }
  });

  // Adjacent verticals waitlist — public, no auth
  app.post("/api/waitlist", async (req: Request, res: Response) => {
    try {
      const { email, vertical } = req.body;
      if (!email || !vertical) {
        return res.status(400).json({ error: "Email and vertical are required" });
      }
      const { adjacentVerticalsWaitlist } = await import("../shared/schema");
      await db.insert(adjacentVerticalsWaitlist).values({ email, vertical });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to join waitlist" });
    }
  });

  app.get("/api/health/cached", async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { healthCheckService } = await import("./services/healthCheck");
      const result = healthCheckService.getLastResults();
      const data = result || await healthCheckService.checkAll();
      const statusCode = data.overall === "unavailable" ? 503 : 200;
      res.status(statusCode).json({
        ...data,
        version: process.env.npm_package_version || "1.0.0",
        uptime: process.uptime(),
      });
    } catch (err: any) {
      res.status(503).json({
        overall: "degraded",
        services: [],
        timestamp: new Date(),
        version: process.env.npm_package_version || "1.0.0",
        uptime: process.uptime(),
        error: err?.message || "health check failed",
      });
    }
  });

  // White-label domain middleware — runs before auth so custom domains are resolved early
  app.use(whiteLabelDomainMiddleware);
  app.use(correlationIdMiddleware);

  // Apply Clerk middleware globally — parses JWT tokens, makes req.auth available
  // Pass publishableKey explicitly — Fly.io stores it as VITE_CLERK_PUBLISHABLE_KEY
  // but @clerk/express expects CLERK_PUBLISHABLE_KEY by default.
  const clerkPK = process.env.CLERK_PUBLISHABLE_KEY || process.env.VITE_CLERK_PUBLISHABLE_KEY;
  app.use(clerkMiddleware({
    publishableKey: clerkPK,
    jwtKey: process.env.CLERK_JWT_KEY,
    proxyUrl: process.env.APP_URL ? `${process.env.APP_URL}/__clerk` : undefined,
  }));

  // Register auth routes (/api/auth/user, /api/auth/attribution)
  registerAuthRoutes(app);

  // T11: Two-Factor Auth routes
  const { register2FARoutes } = await import("./routes-2fa");
  register2FARoutes(app);

  // T12: OAuth/SSO routes (Google + Microsoft)
  const { registerOAuthRoutes } = await import("./auth/oauth");
  registerOAuthRoutes(app);

  app.get("/api/health/:service", async (req: AuthenticatedRequest, res: Response) => {
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
  app.get("/api/founder/readiness", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const org = req.organization || req.organization;
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
  app.get("/api/search", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const org = req.organization;
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
  // F-A04-1: Prompt injection guard on all AI-touching paths
  // ============================================
  app.use("/api/ai", promptInjectionMiddleware);
  app.use("/api/atlas", promptInjectionMiddleware);
  app.use("/api/chat", promptInjectionMiddleware);
  app.use("/api/executive", promptInjectionMiddleware);
  app.use("/api/pax", promptInjectionMiddleware);
  app.use("/api/founder/v6", promptInjectionMiddleware);
  app.use("/api/founder/v7", promptInjectionMiddleware);
  app.use("/api/founder/v8", promptInjectionMiddleware);
  app.use("/api/founder/v10", promptInjectionMiddleware);
  app.use("/api/founder/v12", promptInjectionMiddleware);
  app.use("/api/founder/v13", promptInjectionMiddleware);
  app.use("/api/founder/v14", promptInjectionMiddleware);
  app.use("/api/founder/v11", promptInjectionMiddleware);
  app.use("/api/founder/agent-collaboration", promptInjectionMiddleware);
  app.use("/api/support", promptInjectionMiddleware);

  // ============================================
  // SEC-004: CSRF protection for state-changing requests
  // Skips GET/HEAD/OPTIONS, webhooks, and Bearer-token API clients
  // ============================================
  app.use("/api", csrfProtection);
  // (httpCacheHeaders registered earlier — before any route definitions,
  // since Express middleware has to be installed before the routes it
  // should wrap.)

  // ============================================
  // RATE LIMITING MIDDLEWARE (excludes health check)
  // ============================================
  app.use("/api/ai", aiLimiter);
  app.use("/api/auth", authLimiter);
  app.use("/api/stripe/connect/webhook", webhookLimiter);
  app.use("/webhook", webhookLimiter);
  app.use("/api/import", importLimiter);
  app.use("/api", (req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith("/health")) {
      return next();
    }
    return apiRateLimit(req, res, next);
  });

  // ============================================
  // REQUEST TIMEOUT MIDDLEWARE (30s → 504 Gateway Timeout)
  // Applied to all /api routes except health checks
  // ============================================
  app.use("/api", (req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith("/health")) {
      return next();
    }
    return requestTimeout(req, res, next);
  });

  // ============================================
  // HTTP REQUEST LOGGING MIDDLEWARE
  // ============================================
  app.use("/api", (req: Request, res: Response, next: NextFunction) => {
    const requestId = crypto.randomUUID();
    const startTime = Date.now();
    // @ts-expect-error -- requestId is added at runtime for request tracing
    req.requestId = requestId;
    logger.info("HTTP Request", {
      requestId,
      source: "http",
      metadata: { method: req.method, path: req.path, ip: req.ip || req.socket.remoteAddress },
    });
    res.on("finish", () => {
      const duration = Date.now() - startTime;
      logger.info("HTTP Response", {
        requestId,
        source: "http",
        metadata: { method: req.method, path: req.path, statusCode: res.statusCode, durationMs: duration },
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

  // Protected API routes - all require authentication
  const api = app;

  // ============================================
  // DASHBOARD
  // ============================================

  // simple in-memory cache per org for dashboard stats (30s TTL)
  const statsCache: Map<number, { ts: number; data: any }> = new Map();

  api.get("/api/dashboard/stats", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    const org = req.organization;
    const key = org.id as number;
    const now = Date.now();
    const cached = statsCache.get(key);
    if (cached && now - cached.ts < 30_000) {
      return res.json(cached.data);
    }
    const stats = await storage.getDashboardStats(org.id);
    statsCache.set(key, { ts: now, data: stats });
    res.json(stats);
  });

  // Preview leads that will be affected by bulk delete
  app.post("/api/leads/bulk-delete/preview", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const org = req.organization;
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
      logger.error("Bulk delete preview error", error instanceof Error ? error : undefined);
      res.status(500).json({ message: error.message || "Failed to preview bulk delete" });
    }
  });

    // Mark a lead as contacted (updates lastContactedAt timestamp)
  app.post("/api/leads/:id/mark-contacted", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const org = req.organization;
      const leadId = Number(req.params.id);
      
      if (isNaN(leadId)) {
        return res.status(400).json({ message: "Invalid lead ID" });
      }
      
      const existingLead = await storage.getLead(org.id, leadId);
      if (!existingLead) {
        return res.status(404).json({ message: "Lead not found" });
      }
      
      const now = new Date();
      const lead = await storage.updateLead(leadId, { lastContactedAt: now }, org.id);
      
      // Log the action
      const user = req.user as any;
      const userId = user?.claims?.sub || user?.id;
      await storage.createAuditLogEntry({
        organizationId: org.id,
        userId,
        action: "update",
        entityType: "lead",
        entityId: leadId,
        changes: { 
          before: { lastContactedAt: existingLead.lastContactedAt },
          after: { lastContactedAt: now },
          fields: ["lastContactedAt"] 
        },
        ipAddress: req.ip || req.socket?.remoteAddress,
        userAgent: req.headers["user-agent"],
      });
      
      res.json({
        success: true,
        message: "Lead marked as contacted",
        lead,
      });
    } catch (err) {
      logger.error("Mark contacted error", err instanceof Error ? err : undefined);
      res.status(500).json({ message: "Failed to mark lead as contacted" });
    }
  });

    // Merge two leads
  app.post("/api/leads/merge", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const org = req.organization;
      const { primaryId, duplicateId } = req.body;
      
      if (!primaryId || !duplicateId) {
        return res.status(400).json({ message: "Primary and duplicate lead IDs are required" });
      }
      
      const merged = await storage.mergeLeads(org.id, primaryId, duplicateId);
      
      res.json({
        success: true,
        message: "Leads merged successfully",
        lead: merged,
      });
    } catch (err) {
      logger.error("Merge leads error", err instanceof Error ? err : undefined);
      res.status(500).json({ message: "Failed to merge leads" });
    }
  });

  // Record contact (marks lead as contacted now)
  app.post("/api/leads/:id/record-contact", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const org = req.organization;
      const leadId = Number(req.params.id);
      
      if (isNaN(leadId)) {
        return res.status(400).json({ message: "Invalid lead ID" });
      }
      
      const existingLead = await storage.getLead(org.id, leadId);
      if (!existingLead) {
        return res.status(404).json({ message: "Lead not found" });
      }
      
      const contactMethod = req.body.method || "manual"; // call, email, sms, manual
      const notes = req.body.notes || null;
      const now = new Date();
      
      // Update last contacted timestamp
      const updated = await storage.updateLead(leadId, {
        lastContactedAt: now,
      }, org.id);
      
      // Record activity event
      await storage.createActivityEvent({
        organizationId: org.id,
        entityType: "lead",
        entityId: leadId,
        eventType: "contact_recorded",
        description: `Contact recorded via ${contactMethod}`,
      });
      
      // Audit log
      const user = req.user as any;
      const userId = user?.claims?.sub || user?.id;
      await storage.createAuditLogEntry({
        organizationId: org.id,
        userId,
        action: "record_contact",
        entityType: "lead",
        entityId: leadId,
        changes: { after: { method: contactMethod, timestamp: now.toISOString() } },
        ipAddress: req.ip || req.socket?.remoteAddress,
        userAgent: req.headers["user-agent"],
      });
      
      res.json({
        success: true,
        lead: updated,
        contactedAt: now.toISOString(),
      });
    } catch (error: any) {
      logger.error("Record contact error", error instanceof Error ? error : undefined);
      res.status(500).json({ message: error.message || "Failed to record contact" });
    }
  });

  app.post("/api/leads/bulk-delete", isAuthenticated, getOrCreateOrg, requirePermission("canDeleteLeads"), async (req: AuthenticatedRequest, res: Response) => {
    try {
      const org = req.organization;
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
        changes: { after: { ids, count: deletedCount, recoverable: true, leadNames: leadsToDelete.map(l => `${l.firstName} ${l.lastName}`) } } as any,
        ipAddress: req.ip || req.socket?.remoteAddress,
        userAgent: req.headers["user-agent"],
      });

      res.json({ 
        deletedCount,
        recoverable: true,
        message: `${deletedCount} lead(s) moved to trash. They can be restored within 30 days.`,
      });
    } catch (error: any) {
      logger.error("Bulk delete leads error", error instanceof Error ? error : undefined);
      res.status(500).json({ message: error.message || "Failed to bulk delete leads" });
    }
  });
  
  // Get deleted/trashed leads
  app.get("/api/leads/deleted", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const org = req.organization;
      const deletedLeads = await storage.getDeletedLeads(org.id);
      res.json(deletedLeads);
    } catch (error: any) {
      logger.error("Get deleted leads error", error instanceof Error ? error : undefined);
      res.status(500).json({ message: error.message || "Failed to get deleted leads" });
    }
  });
  
  // Restore soft-deleted leads
  app.post("/api/leads/restore", isAuthenticated, getOrCreateOrg, requirePermission("canDeleteLeads"), async (req: AuthenticatedRequest, res: Response) => {
    try {
      const org = req.organization;
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
        changes: { after: { ids, count: restoredCount } } as any,
        ipAddress: req.ip || req.socket?.remoteAddress,
        userAgent: req.headers["user-agent"],
      });

      res.json({ restoredCount });
    } catch (error: any) {
      logger.error("Restore leads error", error instanceof Error ? error : undefined);
      res.status(500).json({ message: error.message || "Failed to restore leads" });
    }
  });
  
  // Permanently delete leads (empty trash)
  app.post("/api/leads/permanent-delete", isAuthenticated, getOrCreateOrg, requirePermission("canDeleteLeads"), async (req: AuthenticatedRequest, res: Response) => {
    try {
      const org = req.organization;
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
        changes: { after: { ids, count: deletedCount, permanent: true } } as any,
        ipAddress: req.ip || req.socket?.remoteAddress,
        userAgent: req.headers["user-agent"],
      });
      
      res.json({ deletedCount });
    } catch (error: any) {
      logger.error("Permanent delete leads error", error instanceof Error ? error : undefined);
      res.status(500).json({ message: error.message || "Failed to permanently delete leads" });
    }
  });


  // ============================================
  // ROUTER-BASED FEATURE ROUTES
  // ============================================
  app.use('/api/marketplace', isAuthenticated, getOrCreateOrg, featureGate("feature_marketplace"), marketplaceRouter);
  app.use('/api/predictions', isAuthenticated, getOrCreateOrg, predictionsRouter);
  app.use('/api/land-credit', isAuthenticated, getOrCreateOrg, landCreditRouter);
  app.use('/api/radar', isAuthenticated, getOrCreateOrg, acquisitionRadarRouter);
  app.use('/api/my-letter', isAuthenticated, getOrCreateOrg, customerLetterRouter);
  app.use('/api/portfolio-optimizer', isAuthenticated, getOrCreateOrg, portfolioOptimizerRouter);
  app.use('/api/avm', isAuthenticated, getOrCreateOrg, avmRouter);
  app.use('/api/negotiation', isAuthenticated, getOrCreateOrg, negotiationRouter);
  app.use('/api/cash-flow', isAuthenticated, getOrCreateOrg, cashFlowRouter);
  app.use('/api/deal-hunter', isAuthenticated, getOrCreateOrg, dealHunterRouter);
  app.use('/api/academy', isAuthenticated, getOrCreateOrg, featureGate("feature_academy"), academyRouter);
  app.use('/api/vision-ai', isAuthenticated, getOrCreateOrg, featureGate("feature_vision_ai"), visionAIRouter);
  app.use('/api/capital-markets', isAuthenticated, getOrCreateOrg, featureGate("feature_capital_markets"), capitalMarketsRouter);
  app.use('/api/document-intelligence', isAuthenticated, getOrCreateOrg, documentIntelligenceRouter);
  app.use('/api/market-intelligence', isAuthenticated, marketIntelligenceRouter);
  app.use('/api/compliance', isAuthenticated, getOrCreateOrg, complianceRouter);
  app.use('/api/tax-researcher', isAuthenticated, getOrCreateOrg, taxResearcherRouter);
  app.use('/api/deal-underwriting', isAuthenticated, getOrCreateOrg, dealUnderwritingRouter);

  // Phase 2-4: Voice Learning, Context Profile, White-Label, Real-Time
  app.use('/api/intelligence', isAuthenticated, getOrCreateOrg, voiceLearningRouter);
  app.use('/api/white-label', isAuthenticated, getOrCreateOrg, featureGate("feature_white_label"), whiteLabelRouter);
  app.use('/api/realtime', isAuthenticated, getOrCreateOrg, realtimeRouter);
  app.use('/api/pax', aiLimiter, isAuthenticated, getOrCreateOrg, paxInsightsRouter);
  app.post('/api/mcp/execute', isAuthenticated, mcpHandler);

  // Voice pipeline: webhook callbacks (no auth, signature-verified) + authenticated API routes
  // Mount only webhook paths at root — NOT the entire router, which would expose
  // unauthenticated /analytics, /calls, etc. at the root path.
  app.post('/webhook/twilio/recording-complete', voiceRouter);
  app.post('/webhook/disclosure', voiceRouter);
  app.use('/api/voice', isAuthenticated, getOrCreateOrg, featureGate("feature_voice_ai"), voiceRouter);

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
  app.use('/api/certification', isAuthenticated, featureGate("feature_academy"), certificationRouter);
  app.use('/api/buyer-qualification', isAuthenticated, getOrCreateOrg, buyerQualificationRouter);
  app.use('/api/due-diligence', isAuthenticated, getOrCreateOrg, dueDiligenceRouter);
  app.use('/api/deal-patterns', isAuthenticated, getOrCreateOrg, dealPatternsRouter);
  app.use('/api/deal-feed', dealFeedRouter);
  app.use('/api/properties', visionScanRouter);
  app.use('/api/comments', commentsRouter);
  app.use('/api/price-optimizer', isAuthenticated, getOrCreateOrg, priceOptimizerRouter);
  app.use('/api/portfolio-health', isAuthenticated, getOrCreateOrg, portfolioHealthRouter);
  app.use('/api/privacy', isAuthenticated, gdprRouter);
  app.use('/api/metrics', isAuthenticated, metricsRouter);
  app.use('/api/bulk', isAuthenticated, getOrCreateOrg, bulkRouter);
  app.use('/api/leads', isAuthenticated, getOrCreateOrg, leadEnrichmentRouter);
  app.use('/api/skip-tracing', isAuthenticated, getOrCreateOrg, skipTracingRouter);
  app.use('/api/territories', isAuthenticated, getOrCreateOrg, featureGate("feature_territories"), territoriesRouter);
  app.use('/api/zoning', isAuthenticated, zoningRouter);
  app.use('/api/title-search', isAuthenticated, getOrCreateOrg, titleSearchRouter);
  app.use('/api/properties', isAuthenticated, getOrCreateOrg, propertyEnrichmentRouter);
  app.use('/api/exchange-1031', isAuthenticated, getOrCreateOrg, exchange1031Router);
  app.use('/api/dunning', isAuthenticated, dunningRouter);
  app.use('/api/onboarding', isAuthenticated, getOrCreateOrg, onboardingRouter);
  // User-scoped appearance preferences (theme/mode/font/density/motion).
  // No org context needed — preferences are user-level.
  app.use('/api/me/preferences', isAuthenticated, preferencesRouter);
  // Per-agent autonomy matrix — split off from /preferences in JC#14 so
  // theme writes can't trample agent policy and agents have a narrow read
  // surface at action time.
  app.use('/api/me/autonomy', isAuthenticated, autonomyRouter);
  // Persona setter — drives vocabulary swaps, default surfaces, onboarding
  // path per VERTICAL-EXPANSION-PLAN.md. User-scoped, no org context needed.
  app.use('/api/me/persona', isAuthenticated, personaRouter);
  // Feature flags — read endpoint accessible to authenticated users (returns
  // their resolved view); admin endpoints inside the router enforce founder.
  app.use('/api/feature-flags', isAuthenticated, getOrCreateOrg, featureFlagsRouter);

  // Swagger UI + OpenAPI spec — no auth required so external integrators
  // can consume the spec before signing up. Registered BEFORE the
  // catch-all `app.use('/api', isAuthenticated, …, epicServicesRouter)`
  // below; otherwise that middleware chain 401s the docs endpoint even
  // though the router itself is open.
  app.use('/api/docs', apiDocsRouter);

  // Public e-sign endpoints — external signers (no AcreOS account)
  // authenticate via an HMAC token in the URL, not Clerk. Must register
  // BEFORE the app.use('/api', isAuthenticated, …) catch-all below, or
  // the catch-all 401s them. See server/services/signingTokens.ts.
  const { registerPublicSignRoutes } = await import("./routes-public-sign");
  registerPublicSignRoutes(app);

  // EPIC Services: Seller Motivation, County Opportunity, Title Chain, Investor Network, Financial OS, Developer API
  app.use('/api', isAuthenticated, getOrCreateOrg, epicServicesRouter);

  // Data Intelligence: USDA NASS, Census, Parcel Fusion, Blind Offer Calculator, Freedom Meter
  app.use('/api/data-intel', isAuthenticated, getOrCreateOrg, dataIntelligenceRouter);

  // Epic A: Evening Review Dashboard
  {
    const nightCapRouter = (await import("./routes-night-cap")).default;
    app.use('/api/night-cap', isAuthenticated, getOrCreateOrg, nightCapRouter);
  }

    // Bulk stage update for deals with undo support
  app.post("/api/deals/bulk-stage-update", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const org = req.organization;
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
        changes: { after: { ids: idsToUpdate, newStage, previousStates, count: updatedCount } } as any,
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
      logger.error("Bulk stage update deals error", error instanceof Error ? error : undefined);
      res.status(500).json({ message: error.message || "Failed to bulk update deal stages" });
    }
  });
  
  // Undo bulk stage update
  app.post("/api/deals/bulk-stage-undo", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const org = req.organization;
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
          await storage.updateDeal(state.id, { status: state.previousStage }, undefined, org.id);
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
        changes: { after: { previousStates, restoredCount, errors: errors.length > 0 ? errors : undefined } } as any,
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
      logger.error("Bulk stage undo error", error instanceof Error ? error : undefined);
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

  // ============================================
  // ADMIN FEATURE FLAGS (founder-only)
  // ============================================
  app.get("/api/admin/feature-flags", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const org = req.organization || req.organization;
      if (!org?.isFounder) {
        return res.status(403).json({ message: "Founder access required" });
      }
      const { platformFeatureFlags } = await import("@shared/schema");
      const flags = await db.select().from(platformFeatureFlags).limit(1000);
      res.json(flags);
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Failed to fetch feature flags" });
    }
  });

  app.patch("/api/admin/feature-flags/:key", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const org = req.organization || req.organization;
      if (!org?.isFounder) {
        return res.status(403).json({ message: "Founder access required" });
      }
      const { platformFeatureFlags } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");
      const { enabled } = req.body;
      if (typeof enabled !== "boolean") {
        return res.status(400).json({ message: "enabled (boolean) is required" });
      }
      const [updated] = await db
        .update(platformFeatureFlags)
        .set({ enabled, updatedAt: new Date() })
        .where(eq(platformFeatureFlags.key, req.params.key))
        .returning();
      if (!updated) {
        return res.status(404).json({ message: "Feature flag not found" });
      }
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Failed to update feature flag" });
    }
  });

  // Sovereign Company Protocol routes — ALL require authentication + org context
  // DEFECT-0001: Previously used Router() with `as any` casting which silently
  // bypassed auth middleware. Now each path prefix explicitly enforces auth.
  {
    // Apply auth middleware to every SCP path prefix
    app.use('/api/founder/v6', isAuthenticated, getOrCreateOrg);
    app.use('/api/founder/v7', isAuthenticated, getOrCreateOrg);
    app.use('/api/founder/v8', isAuthenticated, getOrCreateOrg);
    app.use('/api/founder/v10', isAuthenticated, getOrCreateOrg);
    app.use('/api/founder/v11', isAuthenticated, getOrCreateOrg);
    app.use('/api/founder/v12', isAuthenticated, getOrCreateOrg);
    app.use('/api/founder/v13', isAuthenticated, getOrCreateOrg);
    app.use('/api/founder/v14', isAuthenticated, getOrCreateOrg);
    app.use('/api/founder/job-health', isAuthenticated, getOrCreateOrg);
    app.use('/api/founder/agent-collaboration', isAuthenticated, getOrCreateOrg);
    app.use('/api/notifications', isAuthenticated, getOrCreateOrg);

    const { registerFounderV6Routes } = await import("./routes-founder-v6");
    registerFounderV6Routes(app);
    const { registerFounderV7Routes } = await import("./routes-founder-v7");
    registerFounderV7Routes(app);
    const { registerFounderV8Routes } = await import("./routes-founder-v8");
    registerFounderV8Routes(app);
    const { registerFounderV10Routes } = await import("./routes-founder-v10");
    registerFounderV10Routes(app);
    const { registerFounderV11Routes } = await import("./routes-founder-v11");
    registerFounderV11Routes(app);
    const { registerFounderV12Routes } = await import("./routes-founder-v12");
    registerFounderV12Routes(app);
    const { registerFounderV13Routes } = await import("./routes-founder-v13");
    registerFounderV13Routes(app);
    const { registerFounderV14Routes } = await import("./routes-founder-v14");
    registerFounderV14Routes(app);
    const { registerSovereignIntegrationRoutes } = await import("./routes-sovereign-integration");
    registerSovereignIntegrationRoutes(app);
    const { registerFounderIntegrationsRoutes } = await import("./routes-founder-integrations");
    registerFounderIntegrationsRoutes(app);
  }

  // Executive Revenue Dashboard — Founder-only aggregate metrics
  app.get('/api/founder/executive-dashboard', isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!req.isFounder) {
        return Errors.forbidden(res, "Executive dashboard is restricted to founders");
      }

      logger.info("[ExecutiveDashboard] Fetching metrics");

      // Active organizations and subscription breakdown
      const allOrgs = await db.select().from(organizations).limit(10000);
      const activeOrgs = allOrgs.filter(o => o.subscriptionStatus === "active");
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const orgsCreatedLast30 = allOrgs.filter(o => o.createdAt && new Date(o.createdAt) >= thirtyDaysAgo).length;

      // MRR calculation — pulls prices from the canonical
      // shared/billing/tier-pricing.ts so this surface can never drift
      // from the pricing page or Stripe checkout amounts again.
      // Yearly subscriptions are normalised to a per-month figure.
      const mrr = activeOrgs.reduce((total, org) => {
        const interval = (org.billingInterval === "yearly" ? "yearly" : "monthly") as "monthly" | "yearly";
        return total + monthlyRevenueCentsFor(org.subscriptionTier, interval) / 100;
      }, 0);

      // Churn: orgs that cancelled or downgraded in last 30 days
      const churnedOrgs = allOrgs.filter(o =>
        o.subscriptionStatus !== "active" &&
        o.updatedAt && new Date(o.updatedAt) >= thirtyDaysAgo
      ).length;
      const churnRate = activeOrgs.length > 0 ? churnedOrgs / activeOrgs.length : 0;

      // ARPU
      const arpu = activeOrgs.length > 0 ? mrr / activeOrgs.length : 0;

      // Tier breakdown
      const tierBreakdown = activeOrgs.reduce((acc, org) => {
        acc[org.subscriptionTier] = (acc[org.subscriptionTier] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      // Platform-wide usage stats
      const [leadCount] = await db.select({ count: count() }).from(leads);
      const [propertyCount] = await db.select({ count: count() }).from(properties);
      const [dealCount] = await db.select({ count: count() }).from(deals);

      // NPS metrics — last 90 days only so the score reflects recent
      // sentiment, not all-time. Earlier this endpoint pulled all rows; the
      // 90d window prevents one cohort from anchoring NPS forever.
      const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
      const npsRows = await db.select().from(npsResponses).limit(50000);
      const recentNps = npsRows.filter(r => r.createdAt && new Date(r.createdAt) >= ninetyDaysAgo);
      const npsCount = recentNps.length;
      const npsAvg = npsCount > 0 ? recentNps.reduce((sum, r) => sum + r.score, 0) / npsCount : 0;
      const promoters = recentNps.filter(r => r.score >= 9).length;
      const detractors = recentNps.filter(r => r.score <= 6).length;
      const passives = npsCount - promoters - detractors;
      const npsScore = npsCount > 0 ? Math.round(((promoters - detractors) / npsCount) * 100) : 0;

      // Forward-looking churn risk — last scored row per active org.
      // The 30-day backward churnRate above only catches orgs that already
      // left; this surface gives the founder time to intervene before they
      // do. Each active org's most recent churn_risk_scores row counts.
      const allRiskRows = await db.select().from(churnRiskScores).limit(50000);
      const latestByOrg = new Map<number, typeof allRiskRows[number]>();
      for (const row of allRiskRows) {
        const existing = latestByOrg.get(row.organizationId);
        if (!existing || (row.scoredAt && existing.scoredAt && new Date(row.scoredAt) > new Date(existing.scoredAt))) {
          latestByOrg.set(row.organizationId, row);
        }
      }
      const activeOrgIds = new Set(activeOrgs.map(o => o.id));
      const activeRiskRows = Array.from(latestByOrg.values()).filter(r => activeOrgIds.has(r.organizationId));
      const riskBands = { critical: 0, red: 0, yellow: 0, green: 0 } as Record<string, number>;
      for (const r of activeRiskRows) {
        if (r.riskBand in riskBands) riskBands[r.riskBand]++;
      }
      const riskScoreSum = activeRiskRows.reduce((sum, r) => sum + (r.riskScore ?? 0), 0);
      const riskScoreAvg = activeRiskRows.length > 0 ? Math.round(riskScoreSum / activeRiskRows.length) : 0;
      // Project forward: orgs in critical+red bands are the at-risk cohort
      // most likely to churn next. % of active orgs lets the founder read
      // it as a forward analog to the 30-day backward churnRate.
      const atRiskOrgs = riskBands.critical + riskBands.red;
      const projectedChurnRate = activeOrgs.length > 0
        ? Math.round((atRiskOrgs / activeOrgs.length) * 10000) / 100
        : 0;

      const metrics = {
        mrr,
        activeOrganizations: activeOrgs.length,
        totalOrganizations: allOrgs.length,
        newOrgsLast30Days: orgsCreatedLast30,
        churnRate: Math.round(churnRate * 10000) / 100, // percent with 2 decimals
        churnedOrgsLast30Days: churnedOrgs,
        arpu: Math.round(arpu * 100) / 100,
        tierBreakdown,
        platformUsage: {
          totalLeads: Number(leadCount.count),
          totalProperties: Number(propertyCount.count),
          totalDeals: Number(dealCount.count),
        },
        nps: {
          score: npsScore,
          average: Math.round(npsAvg * 100) / 100,
          responseCount: npsCount,
          promoters,
          passives,
          detractors,
        },
        churnRisk: {
          // Forward-looking: distribution of active orgs across risk bands +
          // % at risk (critical+red). Founder uses this to decide when to
          // intervene; the 30-day churnRate above is post-mortem.
          bands: riskBands,
          atRiskOrgs,
          projectedChurnRate,
          averageRiskScore: riskScoreAvg,
          scoredOrgs: activeRiskRows.length,
        },
      };

      logger.info("[ExecutiveDashboard] Metrics fetched successfully", { mrr, activeOrgs: activeOrgs.length });
      res.json(metrics);
    } catch (err: any) {
      logger.error("[ExecutiveDashboard] Error", { message: err?.message });
      // Return empty metrics so page still renders
      res.json({
        totalOrgs: 0, activeOrgs: 0, newOrgsLast30: 0,
        mrr: 0, arr: 0, mrrChange: 0,
        tierBreakdown: { free: 0, sprout: 0, starter: 0, pro: 0 },
        totalLeads: 0, totalProperties: 0, totalDeals: 0, totalNotes: 0,
        newLeadsLast7: 0, newDealsLast7: 0,
        recentSignups: [],
      });
    }
  });

  // Epic H: Auto-Delinquent Scraper route
  app.post('/api/import/auto-delinquent', isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
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

  // Field Scout: parcel lookup, voice transcription, photo uploads, visits, reports
  app.use('/api', isAuthenticated, getOrCreateOrg, fieldScoutRouter);

  // Phase 5-6 routes
  app.use('/api/investor-verification', isAuthenticated, getOrCreateOrg, investorVerificationRouter);
  app.use('/api/transaction-fees', isAuthenticated, getOrCreateOrg, transactionFeesRouter);
  app.use('/api/call-routing', isAuthenticated, getOrCreateOrg, callRoutingRouter);
  app.use('/api/buyer-network', isAuthenticated, getOrCreateOrg, buyerNetworkRouter);
  app.use('/api/tax-optimization', isAuthenticated, getOrCreateOrg, taxOptimizationRouter);
  app.use('/api/deal-rooms', isAuthenticated, getOrCreateOrg, featureGate("feature_deal_rooms"), dealRoomsRouter);
  app.use('/api/data-api', dataApiRouter); // API key auth handled internally
  // (/api/docs registered above, before the /api catch-all auth middleware)

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
  // Pax inbox drafted-reply (product-call #10) — uses the standard AI
  // router under /api/ai. Mounted after registerAIRoutes so its routes
  // take precedence on the same prefix; isAuthenticated + getOrCreateOrg
  // gate access.
  app.use('/api/ai', isAuthenticated, getOrCreateOrg, aiDraftRouter);
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
  registerMicroFeatureRoutes(app);
  registerClosingRoutes(app);
  registerPlatformFeatureRoutes(app);
  registerLeaseRoutes(app);
  registerMaintenanceRoutes(app);

  // Phase 1: Communication features
  registerInboundEmailRoutes(app);
  // SendGrid event webhook (Hessam §2.3) — Ed25519-signed delivery events
  registerSendGridEventRoutes(app);

  // Register AI Operations (Router-based)
  registerAIOperationsRoutes(app);

  // Register Autonomous Agent routes
  registerAutonomousAgentRoutes(app);

  // ─── Elite Features (Tax Escrow, E-Signing, DD Engine, Meta Ads, Actum, Syndication, Bookkeeping, VA) ──
  await registerEliteFeatureRoutes(app);

  // Enhancement routes (300 elite improvements)
  {
    const { registerEnhancementRoutes } = await import("./routes-enhancements");
    await registerEnhancementRoutes(app);
  }

  // ─── Address Verification ──────────────────────────────────────────
  const { verifyAddress } = await import("./services/addressVerification");
  app.post("/api/addresses/verify", isAuthenticated, async (req: AuthenticatedRequest, res: Response) => {
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
  app.use("/api/v1/{*splat}", (req, res) => {
    const newPath = req.originalUrl.replace("/api/v1/", "/api/");
    res.redirect(307, newPath);
  });

  app.get("/api/tasks", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = req.organization!.id;
      const filters: { status?: string; priority?: string; assignedTo?: number; entityType?: string; entityId?: number } = {};
      
      if (req.query.status) filters.status = req.query.status as string;
      if (req.query.priority) filters.priority = req.query.priority as string;
      if (req.query.assignedTo) filters.assignedTo = parseInt(req.query.assignedTo as string);
      if (req.query.entityType) filters.entityType = req.query.entityType as string;
      if (req.query.entityId) filters.entityId = parseInt(req.query.entityId as string);
      
      const tasks = await storage.getTasks(orgId, Object.keys(filters).length > 0 ? filters : undefined);
      res.json(tasks);
    } catch (error: any) {
      logger.error("Get tasks error", error instanceof Error ? error : undefined);
      res.status(500).json({ message: error.message || "Failed to fetch tasks" });
    }
  });

  app.get("/api/tasks/:id", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = req.organization!.id;
      const id = parseInt(req.params.id);
      
      const task = await storage.getTask(orgId, id);
      if (!task) {
        return res.status(404).json({ message: "Task not found" });
      }
      
      res.json(task);
    } catch (error: any) {
      logger.error("Get task error", error instanceof Error ? error : undefined);
      res.status(500).json({ message: error.message || "Failed to fetch task" });
    }
  });

  app.post("/api/tasks", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = req.organization!.id;
      const userId = (req.user as any).id;
      
      const validated = insertTaskSchema.parse({
        ...req.body,
        organizationId: orgId,
        createdBy: userId,
        dueDate: req.body.dueDate ? new Date(req.body.dueDate) : null,
        nextOccurrence: req.body.nextOccurrence ? new Date(req.body.nextOccurrence) : null,
      });
      
      const task = await storage.createTask(validated);
      
      await activityLogger.logTaskCreated(
        orgId,
        task.id,
        task.title,
        task.entityType as any,
        task.entityId ?? undefined,
        userId
      );
      
      await storage.createAuditLogEntry({
        organizationId: orgId,
        userId,
        action: "create",
        entityType: "task",
        entityId: task.id,
        changes: { after: validated, fields: Object.keys(validated) },
        ipAddress: req.ip || req.socket?.remoteAddress,
        userAgent: req.headers["user-agent"],
      });
      
      res.status(201).json(task);
    } catch (error: any) {
      logger.error("Create task error", error instanceof Error ? error : undefined);
      res.status(500).json({ message: error.message || "Failed to create task" });
    }
  });

  app.put("/api/tasks/:id", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = req.organization!.id;
      const userId = (req.user as any).id;
      const id = parseInt(req.params.id);
      
      const existingTask = await storage.getTask(orgId, id);
      if (!existingTask) {
        return res.status(404).json({ message: "Task not found" });
      }
      
      const updates: any = { ...req.body };
      if (updates.dueDate) updates.dueDate = new Date(updates.dueDate);
      if (updates.nextOccurrence) updates.nextOccurrence = new Date(updates.nextOccurrence);
      
      const task = await storage.updateTask(id, updates);
      
      const changes = Object.keys(updates).filter(k => k !== 'updatedAt').join(', ');
      await activityLogger.logTaskUpdated(
        orgId,
        task.id,
        task.title,
        changes,
        task.entityType as any,
        task.entityId ?? undefined,
        userId
      );
      
      await storage.createAuditLogEntry({
        organizationId: orgId,
        userId,
        action: "update",
        entityType: "task",
        entityId: task.id,
        changes: { before: existingTask, after: task, fields: Object.keys(updates) },
        ipAddress: req.ip || req.socket?.remoteAddress,
        userAgent: req.headers["user-agent"],
      });
      
      res.json(task);
    } catch (error: any) {
      logger.error("Update task error", error instanceof Error ? error : undefined);
      res.status(500).json({ message: error.message || "Failed to update task" });
    }
  });

  app.delete("/api/tasks/:id", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = req.organization!.id;
      const id = parseInt(req.params.id);
      
      const task = await storage.getTask(orgId, id);
      if (!task) {
        return res.status(404).json({ message: "Task not found" });
      }
      
      const user = req.user as any;
      const userId = user?.claims?.sub || user?.id;
      
      await storage.deleteTask(id);
      
      await storage.createAuditLogEntry({
        organizationId: orgId,
        userId,
        action: "delete",
        entityType: "task",
        entityId: id,
        changes: { before: task, fields: ["deleted"] },
        ipAddress: req.ip || req.socket?.remoteAddress,
        userAgent: req.headers["user-agent"],
      });
      
      res.json({ message: "Task deleted" });
    } catch (error: any) {
      logger.error("Delete task error", error instanceof Error ? error : undefined);
      res.status(500).json({ message: error.message || "Failed to delete task" });
    }
  });

  app.post("/api/tasks/:id/complete", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = req.organization!.id;
      const userId = (req.user as any).id;
      const id = parseInt(req.params.id);
      
      const existingTask = await storage.getTask(orgId, id);
      if (!existingTask) {
        return res.status(404).json({ message: "Task not found" });
      }
      
      const completedTask = await storage.completeTask(id);
      
      await activityLogger.logTaskCompleted(
        orgId,
        completedTask.id,
        completedTask.title,
        completedTask.entityType as any,
        completedTask.entityId ?? undefined,
        userId
      );
      
      if (completedTask.isRecurring && completedTask.recurrenceRule) {
        const nextTask = await storage.createNextRecurringTask(completedTask);
        return res.json({ completedTask, nextTask });
      }
      
      res.json({ completedTask });
    } catch (error: any) {
      logger.error("Complete task error", error instanceof Error ? error : undefined);
      res.status(500).json({ message: error.message || "Failed to complete task" });
    }
  });

  app.post("/api/tasks/process-recurring", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const recurringTasksDue = await storage.getRecurringTasksDue();
      const createdTasks = [];
      
      for (const task of recurringTasksDue) {
        const nextTask = await storage.createNextRecurringTask(task);
        createdTasks.push(nextTask);
      }
      
      res.json({ processed: recurringTasksDue.length, created: createdTasks });
    } catch (error: any) {
      logger.error("Process recurring tasks error", error instanceof Error ? error : undefined);
      res.status(500).json({ message: error.message || "Failed to process recurring tasks" });
    }
  });

  // Dashboard summary: overdue + today's pending tasks
  app.get("/api/tasks/dashboard-summary", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = req.organization!.id;
      
      // Get all pending/in_progress tasks
      const allTasks = await storage.getTasks(orgId);
      const activeTasks = allTasks.filter(t => t.status === "pending" || t.status === "in_progress");
      
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const todayEnd = new Date(todayStart);
      todayEnd.setDate(todayEnd.getDate() + 1);
      
      const overdue: typeof activeTasks = [];
      const dueToday: typeof activeTasks = [];
      
      for (const task of activeTasks) {
        if (!task.dueDate) continue;
        const due = new Date(task.dueDate);
        if (due < todayStart) {
          overdue.push(task);
        } else if (due >= todayStart && due < todayEnd) {
          dueToday.push(task);
        }
      }
      
      // Sort by priority (urgent > high > medium > low), then by dueDate
      const priorityOrder: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
      const sortFn = (a: typeof activeTasks[0], b: typeof activeTasks[0]) => {
        const pa = priorityOrder[a.priority] ?? 4;
        const pb = priorityOrder[b.priority] ?? 4;
        if (pa !== pb) return pa - pb;
        if (a.dueDate && b.dueDate) return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
        return 0;
      };
      
      overdue.sort(sortFn);
      dueToday.sort(sortFn);
      
      res.json({
        overdue: overdue.slice(0, 10),
        dueToday: dueToday.slice(0, 10),
        overdueCount: overdue.length,
        dueTodayCount: dueToday.length,
      });
    } catch (error: any) {
      logger.error("Get dashboard tasks summary error", error instanceof Error ? error : undefined);
      res.status(500).json({ message: error.message || "Failed to fetch tasks summary" });
    }
  });

  // ============================================
  // FEEDBACK SUBMISSIONS
  // ============================================
  app.post("/api/feedback", isAuthenticated, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const user = req.user;
      if (!user?.id) {
        return Errors.unauthorized(res);
      }

      const { category, message, allowFollowUp } = req.body;

      // Validate category
      const validCategories = ["bug", "feature_request", "confusion", "other"];
      if (!category || !validCategories.includes(category)) {
        return Errors.badRequest(res, "Invalid category. Must be one of: bug, feature_request, confusion, other");
      }

      // Validate message (min 10 chars)
      if (!message || typeof message !== "string" || message.trim().length < 10) {
        return Errors.badRequest(res, "Message must be at least 10 characters");
      }

      const pageUrl = req.headers.referer || null;
      const userAgent = req.headers["user-agent"] || null;

      const [inserted] = await db
        .insert(feedbackSubmissions)
        .values({
          userId: user.id,
          userEmail: user.email || "unknown",
          category,
          message: message.trim(),
          allowFollowUp: allowFollowUp !== false,
          pageUrl,
          userAgent,
        })
        .returning({ id: feedbackSubmissions.id });

      // Send email notification to founder (non-blocking)
      const founderEmail = process.env.FOUNDER_EMAIL;
      if (founderEmail) {
        try {
          const { emailService } = await import("./services/emailService");
          const categoryLabel = category.replace("_", " ");
          await emailService.sendEmail({
            to: founderEmail,
            subject: `[AcreOS Feedback] New ${categoryLabel} from ${user.email || "a user"}`,
            html: `
              <h2>New Feedback Submission</h2>
              <p><strong>Category:</strong> ${categoryLabel}</p>
              <p><strong>From:</strong> ${user.email || user.id}</p>
              <p><strong>Page:</strong> ${pageUrl || "N/A"}</p>
              <p><strong>Follow-up OK:</strong> ${allowFollowUp !== false ? "Yes" : "No"}</p>
              <hr />
              <p>${message.trim().replace(/\n/g, "<br />")}</p>
            `,
          });
        } catch (emailErr) {
          logger.warn("Failed to send feedback notification email", emailErr instanceof Error ? emailErr : undefined);
        }
      }

      logger.info(`Feedback submitted: id=${inserted.id}, category=${category}, user=${user.id}`);
      res.json({ success: true, id: inserted.id });
    } catch (error) {
      logger.error("Feedback submission error", error instanceof Error ? error : undefined);
      return Errors.internal(res, error);
    }
  });

  // Hand the fully-mounted app to the OpenAPI reflector so the
  // generated spec covers every route registered above.
  registerApiDocsApp(app);

  return httpServer;
}
