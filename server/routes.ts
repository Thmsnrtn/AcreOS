import type { Express, Request, Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "./types/request";
import express from "express";
import type { Server } from "http";
import crypto from "crypto";
import { storage, db } from "./storage";

// Auth imports
import { clerkMiddleware, isAuthenticated, registerAuthRoutes, requireFounder } from "./auth";
import { e2eTestAuthEnabled } from "./auth/testAuth";

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
// Deal Hunter retired 2026-06-08 — sourcing role lives in /deals/discover (dealFeedEngine).
// Academy retired 2026-06-08 — education + AI tutor module removed.
// Satellite/Vision AI deleted 2026-08-01 (deletion-ledger row: Satellite / Vision AI, founder-authorized drop).
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
import todayRouter from "./routes-today";
import parcelAlertsRouter from "./routes-parcel-alerts";
import parcelBiographyRouter from "./routes-parcel-biography";
// Voice AI deleted 2026-08-01 (deletion-ledger row: Voice / AI voice, founder-authorized drop).
import betaRouter from "./routes-beta";
import regulatoryRouter from "./routes-regulatory";
import notificationsRouter from "./routes-notifications";
import marketWatchlistRouter from "./routes-market-watchlist";

// Wave 8: New service routes (T141-T160)
import dispositionRouter from "./routes-disposition";
import sellerIntentRouter from "./routes-seller-intent";
import portfolioSentinelRouter from "./routes-portfolio-sentinel";
import portfolioPnlRouter from "./routes-portfolio-pnl";
// Commission routes are the direct, zod-validated, admin-scoped, client-bound
// handlers in routes-organization.ts (GET/PUT /config, GET /summaries, GET /,
// POST /, POST /:id/pay, GET /statement/:teamMemberId — the exact paths
// client/src/pages/commissions.tsx calls). The former standalone
// routes-commissions.ts router was a duplicate mount at the same base with a
// swapped-argument recordDealCommission bug and un-called paths (/agents,
// /deal, /:id/payment); removed 2026-08 (Wave 2 pass C) so there is a single
// source of truth.
import certificationRouter from "./routes-certification";
import buyerQualificationRouter from "./routes-buyer-qualification";
import dueDiligenceRouter from "./routes-due-diligence";
import dealPatternsRouter from "./routes-deal-patterns";
import priceOptimizerRouter from "./routes-price-optimizer";

// Phase 5-6 new routes
import investorVerificationRouter from "./routes-investor-verification";
import buyerNetworkRouter from "./routes-buyer-network";
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
import tenantThemeRouter from "./routes-tenant-theme";
import uiStateRouter from "./routes-ui-state";
import byokRouter from "./routes-byok";
import mailboxRouter from "./routes-mailbox";
import autonomyRouter from "./routes-autonomy";
import personaRouter from "./routes-persona";
import needsOnboardingRouter from "./routes-needs-onboarding";
import acquisitionUtmRouter from "./routes-acquisition-utm";
import { registerMarketingTouchRoutes } from "./routes-marketing-touch";
import publicParcelCheckRouter from "./routes-public-parcel-check";
import publicParcelReportRouter, { registerPublicParcelReportPages } from "./routes-public-parcel-report";
import aiDisclosureRouter from "./routes-ai-disclosure";
import paxDisclosureRouter from "./routes-pax-disclosure";
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
import accountingRouter from "./routes-accounting";
import evalRouter from "./routes-eval";
import abTestsRouter from "./routes-ab-tests";
import doddFrankRouter from "./routes-dodd-frank";
import fieldScoutRouter from "./routes-field-scout";
import dealFeedRouter from "./routes-deal-feed";
import commentsRouter from "./routes-comments";

// Phase 1: Communication features
import { registerInboundEmailRoutes } from "./routes-inbound-email";
import { registerSendGridEventRoutes } from "./routes-sendgrid-events";
import { registerSesEventRoutes } from "./routes-ses-events";
// Eleonora deliverability — Phase 1 §10 / Week 7-8.
import { registerDeliverabilityRoutes } from "./routes-deliverability";

// Rate limiting middleware
import { createRateLimiter, rateLimiters, RATE_LIMIT_CONFIGS, authLimiter, aiLimiter, webhookLimiter, importLimiter } from "./middleware/rateLimit";
import { aiRateLimit } from "./middleware/aiRateLimit";
import { todayGuard, paxChatGuard, compsGuard } from "./middleware/expensiveEndpointGuard";


// White-label domain middleware
import { whiteLabelDomainMiddleware } from "./middleware/white-label-domain";
import { correlationIdMiddleware } from "./middleware/correlationId";

// Feature flag gate middleware
import { featureGate } from "./middleware/featureGate";

// MCP handler
// MCP Streamable HTTP endpoint (Tahoe E12) — AcreOS as a tool server for
// external AI agents. Bearer-API-key authed, org-scoped, read-mostly subset
// of the App Intent registry.
import { mcpStreamableHttpHandler } from "./mcp/streamableHttp";
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
// R4: Clerk-native MFA enforcement (replaces broken in-house require2FA).
// See server/middleware/requireClerkMFA.ts for the decision matrix.
import { requireClerkMFA } from "./middleware/requireClerkMFA";
import { createClerkProxyHandler } from "./middleware/clerkProxy";

// Domain route modules
import { registerDashboardRoutes } from "./routes-dashboard";
import { registerJobHealthRoutes } from "./routes-job-health";
import { registerAdminAuditLogRoutes } from "./routes-admin-audit";
import { registerCustomerAuditRoutes } from "./routes-customer-audit";
import { registerAdminComplianceRoutes } from "./routes-admin-compliance";
import { registerTransparencyRoutes } from "./routes-transparency";
import { registerPaxAppealRoutes } from "./routes-pax-appeals";
import { registerFounderAppealRoutes } from "./routes-founder-appeals";
import { registerFounderRecourseRoutes } from "./routes-founder-recourse";
import { registerOrganizationRoutes } from "./routes-organization";
import { registerTeamReadinessRoutes } from "./routes-team-readiness";
import { registerLeadRoutes } from "./routes-leads";
import { registerUnderwritingDefaultsRoutes } from "./routes-underwriting-defaults";
import { registerPropertyRoutes } from "./routes-properties";
import { registerDealRoutes } from "./routes-deals";
import { registerFinanceRoutes } from "./routes-finance";
import { registerDocumentRoutes } from "./routes-documents";
import { registerCampaignRoutes } from "./routes-campaigns";
import { registerOutreachMailRoutes } from "./routes-outreach-mail";
import { registerEddmRoutes } from "./routes-eddm";
import { registerAIRoutes } from "./routes-ai";
import aiDraftRouter from "./routes-ai-draft";
import { registerBillingRoutes } from "./routes-billing";
import { registerSubscriptionRoutes } from "./routes-subscription";
import { registerBorrowerRoutes } from "./routes-borrower";
import { registerNoteRoutes } from "./routes-notes";
import { registerNoteAcquisitionRoutes } from "./routes-note-acquisitions";
import { registerServicerRoutes } from "./routes-servicer";
import { registerTaxCertificateRoutes } from "./routes-tax-certificates";
import { registerTaxRuleRoutes } from "./routes-tax-rules";
import { registerQuietTitleRoutes } from "./routes-quiet-title";
import { registerWholesalerRuleRoutes } from "./routes-wholesaler-rules";
import { registerEarnestMoneyRoutes } from "./routes-earnest-money";
import { registerDoubleCloseRoutes } from "./routes-double-close";
import { registerBuyerBlastRoutes } from "./routes-buyer-blasts";
import { registerWholesalerDashboardRoutes } from "./routes-wholesaler-dashboard";
import { registerBuyerAnalyticsRoutes } from "./routes-buyer-analytics";
import { registerSubdivisionRoutes } from "./routes-subdivisions";
import { registerPermitTrackerRoutes } from "./routes-permit-tracker";
import { registerLotBasisRoutes } from "./routes-lot-basis";
import { registerLotPricingRoutes } from "./routes-lot-pricing";
import { registerCountyTimelineRoutes } from "./routes-county-timelines";
import { registerSubdivisionPlanRoutes } from "./routes-subdivision-plans";
import { registerCcrTemplateRoutes } from "./routes-ccr-templates";
import { registerRehabRoutes } from "./routes-rehabs";
import { registerRehabPhotoRoutes } from "./routes-rehab-photos";
import { registerDriveModeRoutes } from "./routes-drive-mode";
import { registerContractorRoutes } from "./routes-contractors";
import { registerArvRoutes } from "./routes-arv";
import { registerFlipAnalyzerRoutes } from "./routes-flip-analyzer";
import { registerBidEstimateRoutes } from "./routes-bid-estimates";
import { registerConstructionDrawRoutes } from "./routes-construction-draws";
import { registerRentalRoutes } from "./routes-rentals";
import { registerRentLedgerRoutes } from "./routes-rent-ledger";
import { registerPropertyExpenseRoutes } from "./routes-property-expenses";
import { registerAccountSecurityRoutes } from "./routes-account-security";
import { registerFounderLetterRoutes } from "./routes-founder-letters";
import { registerFeedbackRoutes } from "./routes-feedback";
import { registerRosyRiverRoutes } from "./routes-rosy-river";
import { registerAgentPrereqsRoute } from "./routes-agent-prereqs";
import { registerPublicTrustRoutes } from "./routes-public-trust";
import { registerDataSourcesRoutes } from "./routes-data-sources";
import { registerIncidentRoutes } from "./routes-incidents";
import { registerErrorBudgetRoute } from "./routes-error-budget";
import { registerWorkerHeartbeatRoute } from "./routes-worker-heartbeat";
import { registerCohortRetentionRoutes } from "./routes-cohort-retention";
import { registerCustomerHealthRoutes } from "./routes-customer-health";
import { registerCohortLtvRoutes } from "./routes-cohort-ltv";
import { registerPaxQualityRoutes } from "./routes-pax-quality";
import { registerPaxTracesRoutes } from "./routes-pax-traces";
import { registerPaxCalibrationRoutes } from "./routes-pax-calibration";
import { registerFounderCustomersRoutes } from "./routes-founder-customers";
import { registerFounderPulseRoutes } from "./routes-founder-pulse";
import { registerFounderCoverageRoutes } from "./routes-founder-coverage";
import { registerFounderPaidDataEvalRoutes } from "./routes-founder-paid-data-eval";
import { registerCountyCoverageRoutes } from "./routes-county-coverage";
import { registerFounderCostRoutes } from "./routes-founder-cost";
import { registerFounderAuditRoutes } from "./routes-founder-audit";
import { registerFounderLifeCockpitRoutes } from "./routes-founder-life-cockpit";
import { registerPublicDealRoomRoute } from "./routes-deal-rooms";
import { registerFounderFinancialsRoutes } from "./routes-founder-financials";
import { registerLifecycleRoutes } from "./routes-lifecycle";
import { registerApiContractRoutes, registerApiVersionHeader } from "./routes-api-contract";
import { registerPrivacyDsarRoutes } from "./routes-privacy-dsar";
import { registerPaxAuditRoutes } from "./routes-pax-audit";
import { registerSoleneAuditRoutes } from "./routes-solene-audit";
import { registerSolenePageRoutes } from "./routes-solene-page";
import { registerMorningPulseRoutes } from "./routes-morning-pulse";
import { registerAutopilotRoutes } from "./routes-autopilot";
import { registerSoleneChatRoutes } from "./routes-solene-chat";
import { registerFounderMoneyRoutes } from "./routes-founder-money";
import { registerAgentClaimsRoutes } from "./routes-agent-claims";
import { registerDispatchRoutes } from "./routes-dispatch";
import { registerErrorBoundaryRoutes } from "./routes-error-boundary";
import { registerErrorBoundaryAggregatorRoutes } from "./routes-error-boundary-aggregator";
import { registerIrisPerfRoutes } from "./routes-iris-perf";
import { registerSorenSeoRoutes } from "./routes-soren-seo";
import { registerBeatriceRegWatchRoutes } from "./routes-beatrice-regwatch";
import { registerExternalWatchRoutes } from "./routes-external-watch";
import { registerTeamImprovementRoutes } from "./routes-team-improvement";
import { registerTeamSystemAuditRoutes } from "./routes-team-system-audit";
import { registerFounderComplianceRoutes } from "./routes-founder-compliance";
import { registerMoveInspectionRoutes } from "./routes-move-inspections";
import { registerRentRollImportRoutes } from "./routes-rent-roll-import";
import { registerPlanProposalRoutes } from "./routes-plan-proposals";
import { registerFounderBypassRoutes } from "./routes-founder-bypass";
import { registerFounderCollabRoutes } from "./routes-founder-collab";
import { registerOnboardingFunnelRoutes } from "./routes-onboarding-funnel";
import { registerPaxContextRoutes } from "./routes-pax-context";
import { registerMaintenanceTicketRoutes } from "./routes-maintenance-tickets";
import { registerInvestorAnalyticsRoutes } from "./routes-investor-analytics";
import { registerAdminRoutes } from "./routes-admin";
import { registerAdminRecoveryRoutes } from "./routes-admin-recovery";
import { registerDsarRoutes } from "./routes-dsar";
import { registerLegalHoldRoutes } from "./routes-legal-holds";
import { registerSubProcessorRoutes } from "./routes-sub-processors";
import { registerActivationRoutes } from "./routes-activation";
import { registerMlSnapshotsRoutes } from "./routes-ml-snapshots";
import { registerEtlRoutes } from "./routes-etl";
import { registerPromptVersionsRoutes } from "./routes-prompt-versions";
import { registerEliteFeatureRoutes } from "./routes-elite-features";
import { registerSyndicationRoutes } from "./routes-syndication";
import { registerCoreAIRoutes } from "./routes-core-ai";
import { registerAutonomousAgentRoutes } from "./routes-autonomous-agent";
import { registerIntegrationRoutes } from "./routes-integrations";
import { registerCRMExtrasRoutes } from "./routes-crm-extras";
import { registerImportExportRoutes } from "./routes-import-export";
import { registerReferralRoutes } from "./routes-referral";
import { registerTeamMessagingRoutes } from "./routes-team-messaging";
import { registerDocSystemRoutes } from "./routes-doc-system";
// Wave D2 — accepted offer → merged state-specific contract → the existing
// e-sign rail. Lives inside the Deals door; creates drafts only, never sends.
import { registerContractChainRoutes } from "./routes-contract-chain";
import { registerAnalyticsRoutes } from "./routes-analytics";
import { registerCommunicationRoutes } from "./routes-communications";
import { registerVAEngineRoutes } from "./routes-va-engine";
import { registerMiscRoutes } from "./routes-misc";
import { registerSupportTicketRoutes } from "./routes-support-tickets";
import { registerKnowledgeBaseRoutes } from "./routes-kb";
import { registerMicroFeatureRoutes } from "./routes-micro-features";
import { registerClosingRoutes } from "./routes-closing";
import { registerPlatformFeatureRoutes } from "./routes-platform-features";
// FW-7: routes-leases + routes-maintenance deleted. The legacy /api/leases
// and /api/maintenance handlers were superseded by BH-2 (routes-rentals.ts:
// /api/leases against rental_leases) and BH-6 (routes-maintenance-tickets.ts:
// /api/maintenance-tickets). The legacy `leases` and `maintenance_requests`
// tables remain on disk for any data migration but no application code
// reads or writes them.

import { logger } from "./utils/logger";
import { Errors, sendError } from "./utils/errors";
import { organizations, leads, properties, deals, npsResponses, feedbackSubmissions, churnRiskScores } from "@shared/schema";
import { monthlyRevenueCentsFor } from "@shared/billing/tier-pricing";
import { eq, and, desc, sql, count, sum, gte, avg } from "drizzle-orm";

// ============================================
// JOB LOCKING FOR MULTI-INSTANCE DEPLOYMENT
// ============================================
// `instanceId` + `withJobLock` are defined ONCE in server/utils/jobRuntime.ts
// and shared between the app process (this file) and the worker process
// (server/worker.ts -> server/jobs/runScheduledJobs.ts). A previous local
// copy in this file used a different per-import instanceId, which meant
// `storage.releaseJobLock(name, instanceId)` could never release a lock
// held by the jobRuntime path during graceful shutdown.
import { withJobLock } from "./utils/jobRuntime";

// P0 #6 — Job-locks janitor migrated to scheduleSelfRescheduling
// (Phase 3 Week 7-8). The borrower-session cleanup is bundled into the same
// helper because they share the same correctness profile: idempotent
// deletes that must never overlap themselves. Stuck/timed-out runs now
// surface in `job_runs` and any terminal failure dead-letters to
// `outbox_dlq` so on-call has a single inspection surface.
//
// Skipped under NODE_ENV=test so unit tests of routes.ts don't open a DB
// pool.
if (process.env.NODE_ENV !== "test") {
  import("./jobs/scheduler").then(({ scheduleSelfRescheduling }) => {
    // Clean expired borrower sessions every hour (with job lock)
    scheduleSelfRescheduling({
      name: "clean_borrower_sessions",
      intervalMs: 60 * 60 * 1000,
      initialDelayMs: 60 * 60 * 1000,
      run: async () => {
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
      },
    });

    // Clean expired job locks every 5 minutes
    scheduleSelfRescheduling({
      name: "clean_expired_job_locks",
      intervalMs: 5 * 60 * 1000,
      initialDelayMs: 5 * 60 * 1000,
      run: async () => {
        await storage.cleanExpiredJobLocks();
      },
    });
  }).catch((err) => {
    logger.error("Failed to register job-lock janitor", err instanceof Error ? err : undefined);
  });
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // Clerk proxy — Cloudflare blocks clerk.acreos.io (Error 1000). Handler is
  // extracted to server/middleware/clerkProxy.ts so its double-send guards and
  // 10s upstream timeout are unit-testable in isolation.
  app.use("/__clerk", express.urlencoded({ extended: false }), express.json(), createClerkProxyHandler());



  // PERF: HTTP Cache-Control for safe-GET /api/ responses. Registered
  // BEFORE any route definitions — Express only applies middleware to
  // routes registered after it. Earlier placements were silently
  // bypassed because /api/status, /api/changelog, /api/config/features,
  // etc. were defined before the middleware chain.
  const { httpCacheHeaders: _httpCacheHeaders } = await import("./middleware/httpCacheHeaders");
  app.use("/api", _httpCacheHeaders);

  // FW-9: API telemetry — counts 2xx/4xx/5xx + p50/p95 per route.
  // Surfaced via GET /api/admin/telemetry (founder-gated below).
  const { apiTelemetry } = await import("./middleware/apiTelemetry");
  app.use("/api", apiTelemetry());

  // Public feature flags endpoint — needed before Clerk middleware for sidebar rendering
  app.get("/api/config/features", async (_req, res) => {
    try {
      const { featureFlagService } = await import("./services/featureFlags");
      const flags = await featureFlagService.getAll();
      // enabled* keeps its historical semantics ('on' === enabled boolean).
      // disabled* is the explicit deny-list: a flag whose state is 'off' is
      // off for every audience, so the client can hide its routes even when
      // ALL flags are off (previously indistinguishable from "flags unused",
      // which made a full module freeze un-hideable in the nav). Tier/beta/
      // founder-only states are deliberately in neither list — this endpoint
      // has no user context to resolve them.
      const enabledKeys = flags.filter((f) => f.state === "on").map((f) => f.key);
      const enabledRoutes = flags
        .filter((f) => f.state === "on")
        .flatMap((f) => f.controlledRoutes);
      const disabledKeys = flags.filter((f) => f.state === "off").map((f) => f.key);
      // FROZEN routes (shared/feature-freeze.ts, deletion-ledger verdicts)
      // are merged into the deny-list on BOTH paths so their hiding never
      // depends on the flags table being seeded — the client also enforces
      // this list locally, but older cached bundles get it from here.
      const { FROZEN_ROUTES } = await import("@shared/feature-freeze");
      const disabledRoutes = [
        ...new Set([
          ...flags.filter((f) => f.state === "off").flatMap((f) => f.controlledRoutes),
          ...FROZEN_ROUTES,
        ]),
      ];
      res.json({ enabledKeys, enabledRoutes, disabledKeys, disabledRoutes });
    } catch {
      // On error, return all routes enabled so the sidebar shows every REAL
      // feature — but frozen doors stay denied even on this path.
      const { FROZEN_ROUTES } = await import("@shared/feature-freeze");
      res.json({
        enabledKeys: [],
        enabledRoutes: [],
        disabledKeys: [],
        disabledRoutes: [...FROZEN_ROUTES],
      });
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
  // HEALTH CHECKS (Public, no rate limiting, no middleware)
  // Mounted BEFORE WhiteLabel/Clerk middleware so health probes never fail
  // due to domain resolution or auth issues.
  //
  // /api/healthz — tiny liveness probe, returns 200 with no upstream fan-out.
  //   Safe target for Fly/uptime monitors.
  // /api/health  — cached service snapshot (refreshed by startPeriodicChecks).
  //   Previously synchronously hit Stripe + OpenAI on every request from a
  //   public endpoint, giving 500–660ms TTFB and a DoS-amplification
  //   surface for any unauth caller. Caught 2026-05-10.
  // /api/health/live — explicit opt-in to the live fan-out, for cases where
  //   you genuinely need a fresh check (e.g. CI deploy verification).
  // ============================================
  app.get("/api/healthz", (_req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ ok: true, uptime: process.uptime() });
  });

  // /api/health/auth-config — secret-free Clerk-config self-diagnostic
  // (server/services/authConfigDiagnostic.ts). MUST live in this pre-Clerk,
  // pre-auth block: it exists to explain the "every authenticated call 401s"
  // outage, so it can never sit behind the very session verification it
  // diagnoses. It was first registered in routes-enhancements.ts, where the
  // GET /api/health/:service wildcard (registered earlier) shadowed it into a
  // 404 — the same trap that bit /api/health/deep on 2026-05-11.
  // Gated on the presence of a Clerk session cookie: a signed-in operator
  // whose session the server can't verify still carries __session*, so they
  // get the report; an anonymous scanner gets nothing.
  app.get("/api/health/auth-config", async (req: Request, res: Response) => {
    try {
      res.setHeader("Cache-Control", "no-store");
      const cookieHeader = req.headers.cookie ?? "";
      const hasClerkCookie = /(?:^|;\s*)__session(?:_[A-Za-z0-9_-]+)?=/.test(cookieHeader);
      if (!hasClerkCookie) {
        return res.json({ available: false });
      }
      const { computeAuthConfigReport } = await import("./services/authConfigDiagnostic");
      res.json({ available: true, ...computeAuthConfigReport() });
    } catch (err) {
      Errors.internal(res, err);
    }
  });

  // /api/health/uptime-probe — external uptime probe ingest (gold-standard
  // outside-in reachability). A free GitHub Actions cron POSTs here every ~5min
  // with a shared token; each call records an external uptime sample. Dormant
  // until UPTIME_PROBE_TOKEN is set (returns 401 otherwise), so it's safe to
  // ship off. Token-gated, not session-gated — it's called from CI, not a user.
  app.post("/api/health/uptime-probe", async (req: Request, res: Response) => {
    const configured = process.env.UPTIME_PROBE_TOKEN;
    const provided = req.header("x-probe-token");
    if (!configured || !provided || provided !== configured) {
      return Errors.unauthorized(res);
    }
    try {
      const { recordUptimeSample } = await import("./services/autopilot/uptime");
      await recordUptimeSample("external");
      return res.json({ ok: true });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  // /api/version — tiny endpoint for the client's stale-build self-heal.
  // Returns the deployed git SHA so the running tab can detect when its
  // bundled SHA no longer matches production and reload itself. Must be
  // no-store so neither browsers nor Cloudflare ever serve a stale answer
  // (which would defeat the entire mechanism). See client/src/lib/version-check.ts.
  app.get("/api/version", (_req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.status(200).json({ sha: process.env.VITE_GIT_SHA || "unknown" });
  });

  app.get("/api/health", async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { healthCheckService } = await import("./services/healthCheck");
      // Use cached snapshot maintained by startPeriodicChecks(). Only fall
      // back to a synchronous checkAll() if the cache is empty (first call
      // after boot before the first periodic tick).
      const cached = healthCheckService.getLastResults();
      const result = cached || (await healthCheckService.checkAll());
      const statusCode = result.overall === "unavailable" ? 503 : 200;
      res.setHeader(
        "Cache-Control",
        "public, max-age=10, s-maxage=10, stale-while-revalidate=60",
      );
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

  app.get("/api/health/live", async (_req: Request, res: Response) => {
    try {
      const { healthCheckService } = await import("./services/healthCheck");
      const result = await healthCheckService.checkAll();
      const statusCode = result.overall === "unavailable" ? 503 : 200;
      res.setHeader("Cache-Control", "no-store");
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
        error: err?.message || "live health check failed",
      });
    }
  });

  // Adjacent verticals waitlist — public, no auth
  app.post("/api/waitlist", async (req: Request, res: Response) => {
    try {
      const { email, vertical } = req.body;
      if (!email || !vertical) {
        return Errors.badRequest(res, "Email and vertical are required");
      }
      const { adjacentVerticalsWaitlist } = await import("../shared/schema");
      await db.insert(adjacentVerticalsWaitlist).values({ email, vertical });
      res.json({ success: true });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // Marketing-touch ingest — public, no auth. The write path for the
  // acquisition event substrate (docs/internal/marketing-os/03-analytics.md).
  // Keyed by a 1st-party anonymous_id cookie; user_id/org_id backfilled on
  // signup. See server/routes-marketing-touch.ts.
  registerMarketingTouchRoutes(app);

  // Public parcel-check — no auth. Renders the free open-data moat (FEMA /
  // USDA / USGS / USFWS / Census) for any address so a stranger can see the
  // free-tier promise work before signing up. Hard-capped to free providers,
  // rate-limited by session/parcel NOT raw IP. See routes-public-parcel-check.ts.
  app.use("/api/public/parcel-check", publicParcelCheckRouter);

  // Tier 3A — public parcel reports with the partial Land Credit Score.
  // Saved /p/:state/:county/:apn permalinks: free/government data only
  // (structurally pinned to maxTier:"free" — paid providers unreachable),
  // session-keyed rate limits, daily cap + alert-spine tripwire. The page
  // routes (HTML head injection / OG image / sitemap) are read-only and
  // registered here so they win over the SPA-shell catch-all.
  app.use("/api/public/parcel-report", publicParcelReportRouter);
  registerPublicParcelReportPages(app);

  app.get("/api/health/cached", async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { healthCheckService } = await import("./services/healthCheck");
      const result = healthCheckService.getLastResults();
      const data = result || await healthCheckService.checkAll();
      const statusCode = data.overall === "unavailable" ? 503 : 200;
      // Wave: cost — already memoized server-side; let Cloudflare collapse
      // the herd from Fly health checks too (interval=30s in fly.toml).
      res.setHeader(
        "Cache-Control",
        "public, max-age=10, s-maxage=10, stale-while-revalidate=60",
      );
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

  // ── PUBLIC TRUST SURFACE — Pillar D / D8 + H / H1 ──────────────────────
  // Mount /api/trust/* BEFORE Clerk middleware so prospective customers
  // (no signed-in session) can view the sub-processor list + vertical
  // maturity registry without hitting 401. Same pattern as /api/healthz
  // above. The registerPublicTrustRoutes call later (after Clerk) becomes
  // a no-op since these handlers are already bound.
  registerPublicTrustRoutes(app);
  // Quinn item #5 — public "How AcreOS sources data" disclosure. Mounted here
  // (before Clerk) so prospective customers can read our sourcing posture
  // without a session, same as the other /api/trust/* endpoints.
  registerDataSourcesRoutes(app);

  // Apply Clerk middleware globally — parses JWT tokens, makes req.auth available
  // Pass publishableKey explicitly — Fly.io stores it as VITE_CLERK_PUBLISHABLE_KEY
  // but @clerk/express expects CLERK_PUBLISHABLE_KEY by default.
  const clerkPK = process.env.CLERK_PUBLISHABLE_KEY || process.env.VITE_CLERK_PUBLISHABLE_KEY;
  const clerkMw = clerkMiddleware({
    publishableKey: clerkPK,
    jwtKey: process.env.CLERK_JWT_KEY,
    proxyUrl: process.env.APP_URL ? `${process.env.APP_URL}/__clerk` : undefined,
  });
  // F-D38 (2026-05-22): a malformed __session cookie value (e.g. "a.b.c") makes
  // clerkMiddleware throw synchronously, which bubbled out as 500 — letting
  // anonymous attackers burn CPU + fill logs by spamming junk cookies. Wrap
  // so any auth-parse failure leaves req.auth undefined and downstream
  // handlers cleanly return 401 via the normal path.
  app.use((req: Request, res: Response, next: NextFunction) => {
    // E2E test-auth: skip Clerk entirely. clerk-express auto-issues a
    // dev-browser handshake redirect (307 → /__clerk/v1/client/handshake) for
    // dev-instance keys when no session is found, which CI can't complete and
    // which blanks the page. The isAuthenticated bypass populates req.auth
    // itself. Never active on Fly — see server/auth/testAuth.ts.
    if (e2eTestAuthEnabled()) return next();
    try {
      clerkMw(req, res, (err?: unknown) => {
        if (err) {
          logger.debug(`[clerkMiddleware] auth attempt failed: ${(err as Error)?.message || err}`);
          return next();
        }
        next();
      });
    } catch (err) {
      logger.debug(`[clerkMiddleware] sync throw: ${(err as Error)?.message || err}`);
      next();
    }
  });

  // Register auth routes (/api/auth/user, /api/auth/attribution)
  registerAuthRoutes(app);

  // R4: In-house 2FA routes deleted — MFA is now managed via Clerk's
  // hosted UserProfile. Enrollment / verification / disable all flow
  // through Clerk's frontend SDK; the server only enforces (see
  // requireClerkMFA below).

  // Legacy Google/Microsoft login OAuth (server/auth/oauth.ts) was RETIRED —
  // Clerk owns all login + OAuth now, so the standalone social-login routes
  // were redundant. (Removed 2026-07-15.)

  // /api/health/deep and /api/health/replica are registered later by
  // routes-enhancements.ts. The wildcard /api/health/:service below would
  // otherwise shadow them (Express picks the first match), so we special-case
  // both to delegate. deep was caught 2026-05-11 via endpoint health probe;
  // replica had been silently 404ing the same way ever since it shipped
  // (caught 2026-07-17 while diagnosing the identically-shadowed
  // /api/health/auth-config, which now lives in the pre-Clerk probe block).
  app.get("/api/health/:service", async (req: AuthenticatedRequest, res: Response, next) => {
    if (req.params.service === "deep" || req.params.service === "replica") return next();
    const { healthCheckService } = await import("./services/healthCheck");
    const service = await healthCheckService.checkService(req.params.service);
    if (!service) {
      return Errors.notFound(res, "service");
    }
    res.json(service);
  });

  // ============================================
  // PRE-LAUNCH READINESS CHECK (founder only)
  // Surfaces the exact gaps between current state and production-ready.
  // Hit GET /api/founder/readiness to get a structured checklist.
  // ============================================
  app.get("/api/founder/readiness", isAuthenticated, getOrCreateOrg, requireFounder, async (req: AuthenticatedRequest, res: Response) => {
    try {
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
      // These are exactly the vars getPlatformCredentials() requires to send.
      // Region is NOT required (it defaults to us-east-1 in the send path), so
      // it is not gated here. AWS_SES_FROM_EMAIL *is* required and must be
      // reported by name so the founder knows precisely what's missing.
      const missingEmailVars: string[] = [];
      if (!env.AWS_ACCESS_KEY_ID) missingEmailVars.push("AWS_ACCESS_KEY_ID");
      if (!env.AWS_SECRET_ACCESS_KEY) missingEmailVars.push("AWS_SECRET_ACCESS_KEY");
      if (!env.AWS_SES_FROM_EMAIL) missingEmailVars.push("AWS_SES_FROM_EMAIL");
      const hasEmail = missingEmailVars.length === 0;
      checks.push({
        name: "Email delivery (AWS SES)",
        status: hasEmail ? "pass" : "warn",
        detail: hasEmail
          ? `AWS SES configured — transactional + campaign sends active (region: ${env.AWS_SES_REGION || env.AWS_REGION || "us-east-1 default"})`
          : `AWS SES not configured — transactional emails (signup confirmation, password reset) will not send. Missing: ${missingEmailVars.join(", ")}`,
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
      Errors.internal(res, err);
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
      Errors.internal(res, err);
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
  // v6/v7/v8 routers were deleted (audit F-17-1); their prefix guards go too.
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
  // Phase 3 Week 9: per-organization rate limit (60/min, 600/hr) — distinct
  // from aiLimiter (which is per-user). See server/middleware/aiRateLimit.ts.
  app.use("/api/ai", aiRateLimit);
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
        return Errors.badRequest(res, "ids must be a non-empty array");
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
      Errors.internal(res, error);
    }
  });

    // Mark a lead as contacted (updates lastContactedAt timestamp)
  app.post("/api/leads/:id/mark-contacted", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const org = req.organization;
      const leadId = Number(req.params.id);
      
      if (isNaN(leadId)) {
        return Errors.badRequest(res, "Invalid lead ID");
      }
      
      const existingLead = await storage.getLead(org.id, leadId);
      if (!existingLead) {
        return Errors.notFound(res, "lead");
      }
      
      const now = new Date();
      const lead = await storage.updateLead(leadId, { lastContactedAt: now }, org.id);
      
      // Log the action
      const user = req.user as any;
      const userId = user?.id || user?.id;
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
      Errors.internal(res, err);
    }
  });

    // Merge two leads
  app.post("/api/leads/merge", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const org = req.organization;
      const { primaryId, duplicateId } = req.body;
      
      if (!primaryId || !duplicateId) {
        return Errors.badRequest(res, "Primary and duplicate lead IDs are required");
      }
      
      const merged = await storage.mergeLeads(org.id, primaryId, duplicateId);
      
      res.json({
        success: true,
        message: "Leads merged successfully",
        lead: merged,
      });
    } catch (err) {
      logger.error("Merge leads error", err instanceof Error ? err : undefined);
      Errors.internal(res, err);
    }
  });

  // Record contact (marks lead as contacted now)
  app.post("/api/leads/:id/record-contact", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const org = req.organization;
      const leadId = Number(req.params.id);
      
      if (isNaN(leadId)) {
        return Errors.badRequest(res, "Invalid lead ID");
      }
      
      const existingLead = await storage.getLead(org.id, leadId);
      if (!existingLead) {
        return Errors.notFound(res, "lead");
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
      const userId = user?.id || user?.id;
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
      Errors.internal(res, error);
    }
  });

  app.post("/api/leads/bulk-delete", isAuthenticated, getOrCreateOrg, requirePermission("canDeleteLeads"), async (req: AuthenticatedRequest, res: Response) => {
    try {
      const org = req.organization;
      const { ids } = req.body;
      
      if (!Array.isArray(ids) || ids.length === 0) {
        return Errors.badRequest(res, "ids must be a non-empty array");
      }
      
      const user = req.user as any;
      const userId = user?.id || user?.id;
      
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
      Errors.internal(res, error);
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
      Errors.internal(res, error);
    }
  });
  
  // Restore soft-deleted leads
  app.post("/api/leads/restore", isAuthenticated, getOrCreateOrg, requirePermission("canDeleteLeads"), async (req: AuthenticatedRequest, res: Response) => {
    try {
      const org = req.organization;
      const { ids } = req.body;
      
      if (!Array.isArray(ids) || ids.length === 0) {
        return Errors.badRequest(res, "ids must be a non-empty array");
      }
      
      const user = req.user as any;
      const userId = user?.id || user?.id;
      
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
      Errors.internal(res, error);
    }
  });
  
  // Permanently delete leads (empty trash)
  app.post("/api/leads/permanent-delete", isAuthenticated, getOrCreateOrg, requirePermission("canDeleteLeads"), async (req: AuthenticatedRequest, res: Response) => {
    try {
      const org = req.organization;
      const { ids } = req.body;
      
      if (!Array.isArray(ids) || ids.length === 0) {
        return Errors.badRequest(res, "ids must be a non-empty array");
      }
      
      const user = req.user as any;
      const userId = user?.id || user?.id;
      
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
      Errors.internal(res, error);
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
  // /api/deal-hunter retired 2026-06-08 — superseded by /api/deal-feed (dealFeedEngine).
  // /api/academy retired 2026-06-08 — Academy module removed.
  // /api/vision-ai deleted 2026-08-01 (deletion-ledger row: Satellite / Vision AI).
  app.use('/api/capital-markets', isAuthenticated, getOrCreateOrg, featureGate("feature_capital_markets"), capitalMarketsRouter);
  app.use('/api/document-intelligence', isAuthenticated, getOrCreateOrg, documentIntelligenceRouter);
  app.use('/api/market-intelligence', isAuthenticated, marketIntelligenceRouter);
  app.use('/api/compliance', isAuthenticated, getOrCreateOrg, complianceRouter);
  app.use('/api/tax-researcher', isAuthenticated, getOrCreateOrg, taxResearcherRouter);
  app.use('/api/deal-underwriting', isAuthenticated, getOrCreateOrg, dealUnderwritingRouter);

  // Phase 2-4: Voice Learning, Context Profile, White-Label, Real-Time
  app.use('/api/intelligence', isAuthenticated, getOrCreateOrg, voiceLearningRouter);
  // GET /config answers BEFORE the feature gate (WS1 sweep, 2026-07-07):
  // useWhiteLabel() fetches it on every authed page load, and with the
  // white-label flag frozen the gate 404'd it — a guaranteed failed request
  // per page view for every customer, polluting telemetry with noise. An
  // honest "no white-label config" is a 200, not a 404; the mutating/admin
  // routes stay behind the gate.
  app.get('/api/white-label/config', isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res, next) => {
    try {
      const { featureFlagService, buildFlagContext } = await import("./services/featureFlags");
      const enabled = await featureFlagService.isEnabled("feature_white_label", buildFlagContext(req));
      if (!enabled) return res.json({ config: null });
    } catch {
      return res.json({ config: null });
    }
    // Enabled (or founder bypass) — fall through to the gated mount below.
    next();
  });
  app.use('/api/white-label', isAuthenticated, getOrCreateOrg, featureGate("feature_white_label"), whiteLabelRouter);
  app.use('/api/realtime', isAuthenticated, getOrCreateOrg, realtimeRouter);
  // Phase 0 hardening — per-user 60s sliding cap + per-org daily USD budget
  // gate on the four expensive endpoint families (Anthropic / OpenAI fan-out).
  // Stacks AFTER aiLimiter (per-user/min) and BEFORE the actual handlers —
  // soft-degrades to a structured LimitExceeded payload on cap exceeded
  // instead of silently failing or relying solely on usageLimitGate.
  app.use('/api/pax', aiLimiter, isAuthenticated, getOrCreateOrg, paxChatGuard, paxInsightsRouter);
  // Consolidated Today-screen payload (queue + cash + meta) — one round-trip
  // replacing the ~6 parallel fetches the Today page used to fan out.
  app.use('/api/today', isAuthenticated, getOrCreateOrg, todayGuard, todayRouter);
  // Iyari #5 — Parcel alerts (owner-change / tax-status deltas) surfaced behind
  // the Today door. Detector writes them; this router is read + mark-read only.
  app.use('/api/parcel-alerts', isAuthenticated, getOrCreateOrg, parcelAlertsRouter);
  // Iyari #1 — Parcel Biography: read-only longitudinal series + derived metrics
  // mined from parcel_observations. SELECT-only; the observation-log writer and
  // delta detector remain the sole writers.
  app.use('/api/parcel-biography', isAuthenticated, getOrCreateOrg, parcelBiographyRouter);
  // Legacy /api/mcp/execute retired (Wave 0.7, 2026-08-10): superseded by the
  // spec-compliant /api/mcp below. The legacy handler compared plaintext keys
  // in a loop, rate-limited in-memory (reset per machine, unbounded Map), and
  // sat behind session auth that made its documented external-bearer purpose
  // unreachable. Retirement was recorded in tahoe-arc-retrospective.md.
  // Tahoe E12: spec-compliant MCP Streamable HTTP endpoint for EXTERNAL AI
  // agents. Auth is the public API key (Authorization: Bearer ak_...),
  // resolved inside the handler — NOT session auth — so no isAuthenticated /
  // getOrCreateOrg middleware here. JSON-RPC: initialize / tools/list /
  // tools/call against the safe, org-scoped intent subset.
  app.post('/api/mcp', mcpStreamableHttpHandler);

  // Voice pipeline deleted 2026-08-01 (deletion-ledger row: Voice / AI voice).
  // The two formerly-ungated Twilio webhooks are stubbed to 410 Gone per the
  // ledger's execution rule, so a still-configured Twilio account gets a clean
  // permanent-failure signal instead of a 404 that looks like a routing bug.
  app.post('/webhook/twilio/recording-complete', (_req, res) => Errors.gone(res, "Voice pipeline removed"));
  app.post('/webhook/disclosure', (_req, res) => Errors.gone(res, "Voice pipeline removed"));

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
  // /api/commissions is served by the direct routes in routes-organization.ts
  // (registerOrganizationRoutes) — the single, validated, admin-scoped source
  // of truth. The duplicate standalone commissionsRouter mount was removed
  // 2026-08 (Wave 2 pass C).
  app.use('/api/certification', isAuthenticated, featureGate("feature_academy"), certificationRouter);
  app.use('/api/buyer-qualification', isAuthenticated, getOrCreateOrg, buyerQualificationRouter);
  app.use('/api/due-diligence', isAuthenticated, getOrCreateOrg, dueDiligenceRouter);
  app.use('/api/deal-patterns', isAuthenticated, getOrCreateOrg, dealPatternsRouter);
  app.use('/api/deal-feed', dealFeedRouter);
  // vision-scan sub-routes on /api/properties deleted 2026-08-01 (Satellite / Vision AI kill).
  app.use('/api/comments', commentsRouter);
  app.use('/api/price-optimizer', isAuthenticated, getOrCreateOrg, priceOptimizerRouter);
  app.use('/api/portfolio-health', isAuthenticated, getOrCreateOrg, portfolioHealthRouter);
  // gdprRouter is the legacy /api/privacy/{export,delete,status} shim.
  // Mounted WITHOUT a prefix-level isAuthenticated so /api/privacy/dsar
  // (the panel-300 #26 public intake, registered later by
  // registerPrivacyDsarRoutes) remains reachable without a session.
  // The router applies isAuthenticated per-route internally.
  app.use('/api/privacy', gdprRouter);
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
  // Tahoe E5 — per-org first-party theming (accent/logo/density). Needs org
  // context; reads open to members, writes gated to admin+ inside the router.
  app.use('/api/tenant-theme', isAuthenticated, getOrCreateOrg, tenantThemeRouter);
  // Tahoe E6 — server-backed per-user UI state (collapsed panels, view
  // toggles, dismissed banners). Org context keys each row to (org, user).
  app.use('/api/ui-state', isAuthenticated, getOrCreateOrg, uiStateRouter);
  app.use('/api/byok', isAuthenticated, getOrCreateOrg, byokRouter);
  // R1c native inbox — mailbox connect/callback/list/disconnect. Same auth
  // posture as byok; env-gated per provider (inert until the OAuth app is set).
  app.use('/api/mailbox', isAuthenticated, getOrCreateOrg, mailboxRouter);
  // Per-agent autonomy matrix — split off from /preferences in JC#14 so
  // theme writes can't trample agent policy and agents have a narrow read
  // surface at action time.
  app.use('/api/me/autonomy', isAuthenticated, autonomyRouter);
  // Persona setter — drives vocabulary swaps, default surfaces, onboarding
  // path per VERTICAL-EXPANSION-PLAN.md. User-scoped, no org context needed.
  app.use('/api/me/persona', isAuthenticated, personaRouter);
  // Canonical "should this user be force-routed through onboarding?"
  // endpoint. Replaces the prior client-side multi-signal OR.
  app.use('/api/me/needs-onboarding', isAuthenticated, getOrCreateOrg, needsOnboardingRouter);
  // Wave 3 Workstream E (distribution telemetry). One-shot idempotent
  // sink for the UTM snapshot the browser captured pre-signup. User-
  // scoped, no org context needed — attribution is per-user.
  app.use('/api/me/acquisition-utm', isAuthenticated, acquisitionUtmRouter);
  // Constitution §7 + Colorado SB 24-205 — auditable AI-disclosure consent.
  // No org context needed (disclosure is per-user, not per-org).
  app.use('/api/me/ai-disclosure', isAuthenticated, aiDisclosureRouter);
  // Phase Zero-Three gate (Beatrice audit 2026-06-01) — auditable record of
  // the customer's acknowledgement on first /pax visit. Replaces the prior
  // localStorage greeting-dismissed key (not auditable).
  app.use('/api/pax', isAuthenticated, paxDisclosureRouter);
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

  // Public transparency report JSON (/api/transparency + /schema) — anonymous
  // by design (linked from the public page + external auditors). Moved here
  // from the tail of this function (2026-07-08): registered after the
  // '/api' isAuthenticated catch-all below, the catch-all 401'd anonymous
  // visitors before the handler ever ran — the exact trap this comment
  // block documents for /api/docs and the e-sign routes.
  registerTransparencyRoutes(app);

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
        return Errors.badRequest(res, "ids must be a non-empty array");
      }
      
      if (!newStage || typeof newStage !== "string") {
        return Errors.badRequest(res, "newStage is required");
      }
      
      // Validate stage against the shared vocabulary (W3.4 — this route
      // used to carry its own duplicated list and NO transition check,
      // letting a bulk drag jump negotiating → closed around the state
      // machine the single-deal routes enforce).
      const { DEAL_STATUSES, validateDealTransition } = await import("@shared/lifecycle/pipeline-status");
      if (!(DEAL_STATUSES as readonly string[]).includes(newStage)) {
        return Errors.badRequest(res, `Invalid stage. Must be one of: ${DEAL_STATUSES.join(", ")}`, { validStages: DEAL_STATUSES });
      }

      // Get the current state of all deals for safety/undo
      const existingDeals = await storage.getDealsByIds(org.id, ids);

      // Check if any deals weren't found
      const foundIds = existingDeals.map(d => d.id);
      const missingIds = ids.filter((id: number) => !foundIds.includes(id));

      if (missingIds.length > 0) {
        return sendError(res, 404, "NOT_FOUND", `Some deals not found: ${missingIds.join(", ")}`, { missingIds });
      }

      // Filter out deals that are already in the target stage
      const dealsToUpdate = existingDeals.filter(d => d.status !== newStage);
      const alreadyInStage = existingDeals.filter(d => d.status === newStage);

      // Enforce the same per-deal transition rules as PUT /api/deals/:id.
      const blocked = dealsToUpdate
        .map(d => ({ id: d.id, error: validateDealTransition(d.status, newStage) }))
        .filter((b): b is { id: number; error: string } => b.error !== null);
      if (blocked.length > 0) {
        return Errors.badRequest(
          res,
          `${blocked.length} deal(s) cannot move to "${newStage}": ${blocked[0].error}`,
          { blocked },
        );
      }
      
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
      const userId = user?.id || user?.id;
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
      Errors.internal(res, error);
    }
  });
  
  // Undo bulk stage update
  app.post("/api/deals/bulk-stage-undo", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const org = req.organization;
      const { previousStates } = req.body;
      
      if (!Array.isArray(previousStates) || previousStates.length === 0) {
        return Errors.badRequest(res, "previousStates must be a non-empty array");
      }
      
      // Validate structure of previousStates
      for (const state of previousStates) {
        if (!state.id || !state.previousStage) {
          return Errors.badRequest(res, "Each previousState must have id and previousStage properties");
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
      const userId = user?.id || user?.id;
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
      Errors.internal(res, error);
    }
  });

  
  // F-D32 (2026-05-21): every /api/founder/* and /api/admin/* mount below
  // was previously `isAuthenticated` only — any signed-in CUSTOMER could hit
  // founder-only endpoints (vendor status, critical alerts, support tools,
  // setup wizard, intelligence platform, etc.). Adding `requireFounder` at
  // the mount layer is the canonical gate; the middleware 404s non-founders
  // to hide existence.
  //
  // Founder Intelligence API — passive monitoring & platform analytics
  {
    const founderIntelRouter = (await import("./routes-founder-intelligence")).default;
    app.use('/api/founder/intelligence', isAuthenticated, requireFounder, founderIntelRouter);
  }

  // Pillar S — one canonical founder inbox.
  {
    const founderNowRouter = (await import("./routes-founder-now")).default;
    app.use('/api/founder/now', isAuthenticated, requireFounder, founderNowRouter);
  }

  // Founder cockpit — the monthly check-in surface composing 13 fragmented summary endpoints.
  {
    const founderCockpitRouter = (await import("./routes-founder-cockpit")).default;
    app.use('/api/founder/cockpit', isAuthenticated, requireFounder, founderCockpitRouter);
  }

  // Founder Bridge — single-shot data endpoint for /founder/bridge. Returns
  // hero metric + 3 telemetry tiles + agents + action queue in one read.
  {
    const founderBridgeRouter = (await import("./routes-founder-bridge")).default;
    app.use('/api/founder/bridge', isAuthenticated, requireFounder, founderBridgeRouter);
  }

  // Founder Finance — buckets/MRR/contribution-margin/cost-mix/triggers/recovery
  // transfers. Read-side aggregation of `financial_ledger` + write-side recovery
  // controls. Weaves into /founder (Now) tiles + /founder/steering sections
  // per the founder-side integration map; no new top-level /founder/finance
  // route. See server/routes-finance-ledger.ts.
  {
    const financeLedgerRouter = (await import("./routes-finance-ledger")).default;
    app.use('/api/founder/finance', isAuthenticated, getOrCreateOrg, requireFounder, financeLedgerRouter);
  }

  // Admin Finance — Tahoe L6 system-of-record + reserve floor compliance.
  // Platform-level (not org-scoped); founder-gated. Mounted distinct from
  // /api/founder/finance because the surface is "platform admin" — reserve
  // floor + system-of-record posture probes are not customer-facing.
  {
    const adminFinanceRouter = (await import("./routes-admin-finance")).default;
    app.use('/api/admin/finance', isAuthenticated, getOrCreateOrg, requireFounder, adminFinanceRouter);
  }

  // Pillar R — founder admin for trust-graduation tiers.
  {
    const founderGraduationRouter = (await import("./routes-founder-graduation")).default;
    app.use('/api/founder/graduation', isAuthenticated, requireFounder, founderGraduationRouter);
  }

  // Founder Chat (Atlas) — chat-spine SSE stream + thread management.
  // Phase B of the founder-chat plan; mounts the only new founder-side
  // HTTP surface (the 40 tools live behind this endpoint). Importing
  // the routes module side-effect-registers the tool inventory.
  //
  // DEPRECATED 2026-06-05 (wave B1 audit): the canonical founder chat
  // surface is the Solene chat (registerSoleneChatRoutes). This route
  // is still mounted because the existing client hooks under
  // client/src/hooks/use-founder-chat*.ts + components/founder-chat/*
  // + components/modals/quick-offer-modal.tsx (POST /api/atlas/analyze)
  // continue to hit it. Migrate those callers, then drop this mount and
  // the routes-founder-chat.ts file in a follow-up cleanup.
  {
    app.use("/api/founder/chat", (req, _res, next) => {
      logger.warn("[founder-chat] legacy route hit — should migrate to Solene chat", {
        metadata: { path: req.path },
      });
      next();
    });
    const { registerFounderChatRoutes } = await import("./routes-founder-chat");
    registerFounderChatRoutes(app);
  }

  // Founder Vendor Status — aggregated Statuspage feeds for /founder-home tile
  {
    const vendorStatusRouter = (await import("./routes-founder-vendor-status")).default;
    app.use('/api/founder/vendor-status', isAuthenticated, requireFounder, vendorStatusRouter);
  }

  // Founder Critical Alerts — P0/P1 ack-timer + escalation banner backing
  {
    const criticalAlertsRouter = (await import("./routes-founder-critical-alerts")).default;
    app.use('/api/founder/critical-alerts', isAuthenticated, requireFounder, criticalAlertsRouter);
  }

  // Support — saved replies (operator pre-canned responses)
  {
    const savedRepliesRouter = (await import("./routes-support-saved-replies")).default;
    app.use('/api/admin/support/saved-replies', isAuthenticated, requireFounder, savedRepliesRouter);
  }

  // Support — customer-context sidebar feed (org details + recent activity + open tickets)
  {
    const customerContextRouter = (await import("./routes-support-customer-context")).default;
    app.use('/api/admin/support/customer-context', isAuthenticated, requireFounder, customerContextRouter);
  }

  // Founder Setup API — interactive credential wizard
  {
    const setupRouter = (await import("./routes-setup")).default;
    app.use('/api/founder/setup', isAuthenticated, requireFounder, setupRouter);
  }

  // ============================================
  // ADMIN FEATURE FLAGS (founder-only)
  // ============================================
  app.get("/api/admin/feature-flags", isAuthenticated, getOrCreateOrg, requireFounder, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { platformFeatureFlags } = await import("@shared/schema");
      const flags = await db.select().from(platformFeatureFlags).limit(1000);
      res.json(flags);
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  app.patch("/api/admin/feature-flags/:key", isAuthenticated, getOrCreateOrg, requireFounder, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { platformFeatureFlags } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");
      const { enabled } = req.body;
      if (typeof enabled !== "boolean") {
        return Errors.badRequest(res, "enabled (boolean) is required");
      }
      const [updated] = await db
        .update(platformFeatureFlags)
        .set({ enabled, updatedAt: new Date() })
        .where(eq(platformFeatureFlags.key, req.params.key))
        .returning();
      if (!updated) {
        return Errors.notFound(res, "feature flag");
      }
      res.json(updated);
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // Sovereign Company Protocol routes — ALL require authentication + org context
  // DEFECT-0001: Previously used Router() with `as any` casting which silently
  // bypassed auth middleware. Now each path prefix explicitly enforces auth.
  {
    // F-D32: every /api/founder/v*/ surface also needs requireFounder before
    // the per-route handlers run. Without it any customer can hit Sovereign
    // Company Protocol endpoints (constitution, evolution, costs, briefing,
    // etc.). /api/notifications stays customer-reachable.
    // v6/v7/v8 routers were deleted (audit F-17-1); their auth guards go too.
    app.use('/api/founder/v10', isAuthenticated, getOrCreateOrg, requireFounder);
    app.use('/api/founder/v11', isAuthenticated, getOrCreateOrg, requireFounder);
    app.use('/api/founder/v12', isAuthenticated, getOrCreateOrg, requireFounder);
    app.use('/api/founder/v13', isAuthenticated, getOrCreateOrg, requireFounder);
    app.use('/api/founder/v14', isAuthenticated, getOrCreateOrg, requireFounder);
    app.use('/api/founder/job-health', isAuthenticated, getOrCreateOrg, requireFounder);
    app.use('/api/founder/agent-collaboration', isAuthenticated, getOrCreateOrg, requireFounder);
    // F-D32 (2026-05-21): /api/scp/v2/* registered all 16 routes with ZERO
    // middleware. Anyone on the internet could POST /api/scp/v2/evolution/rollback,
    // /trust/demote, or /trust/promote — anonymous attackers could roll back the
    // company's agent evolution. Gate every SCPv2 surface at the mount layer.
    app.use('/api/scp/v2', isAuthenticated, getOrCreateOrg, requireFounder);
    app.use('/api/notifications', isAuthenticated, getOrCreateOrg);

    // V6–V8 founder-narrative routers (sovereign-company / learning-company /
    // living-organization) were deleted 2026-08-06 (audit F-17-1): their only
    // client consumers were the retired founder narrative components (WarRoom,
    // ScenarioEngine, StrategicCompass, …), all long-unmounted. The underlying
    // services they fronted stay live via ceoCommandBridge and the worker jobs;
    // only the dead HTTP facade + the three services it solely owned were removed.
    const { registerFounderV10Routes } = await import("./routes-founder-conscious-organization");
    registerFounderV10Routes(app);
    const { registerFounderV11Routes } = await import("./routes-founder-anticipatory-enterprise");
    registerFounderV11Routes(app);
    const { registerFounderV12Routes } = await import("./routes-founder-real-runtime");
    registerFounderV12Routes(app);
    const { registerFounderV13Routes } = await import("./routes-founder-sentient-enterprise");
    registerFounderV13Routes(app);
    const { registerFounderV14Routes } = await import("./routes-founder-self-running-company");
    registerFounderV14Routes(app);
    // CMO ad engine — native ad generation, founder approval, broadcast.
    const { registerCmoRoutes } = await import("./routes-cmo");
    registerCmoRoutes(app);
    // Founder studio (Phase C of founder redesign) — every dial in one API.
    const { registerFounderStudioRoutes } = await import("./routes-founder-studio");
    registerFounderStudioRoutes(app);
    // Founder studio dial sub-surfaces (allocation, credits, triggers,
    // routing, BYOK, infra) — each writes through the same settings service
    // so the legacy dial catalog reflects every change automatically.
    const { registerFounderStudioDialRoutes } = await import("./routes-founder-studio-dials");
    registerFounderStudioDialRoutes(app);
    // Founder inspector (Phase D) — provenance lens for agents / decisions / audit.
    const { registerFounderInspectorRoutes } = await import("./routes-founder-inspector");
    registerFounderInspectorRoutes(app);
    // Founder inspector finance enrichments — Cost tab for /org/:id, per-event
    // provenance, per-provider audit, and emergency channel overrides.
    const { registerFounderInspectorFinanceRoutes } = await import(
      "./routes-founder-inspector-finance"
    );
    registerFounderInspectorFinanceRoutes(app);
    // SCP v2 routes — golden-suite, briefing, evolution/dashboard, evolution/status,
    // costs, constitution, trust/promotions. File was orphaned from this
    // registration block; 7 GET endpoints were 404ing in production. Caught
    // 2026-05-11 via the endpoint health probe.
    const { registerSCPv2Routes } = await import("./routes-scp-v2");
    registerSCPv2Routes(app);
    const { registerSovereignIntegrationRoutes } = await import("./routes-sovereign-integration");
    registerSovereignIntegrationRoutes(app);
    const { registerFounderIntegrationsRoutes } = await import("./routes-founder-integrations");
    registerFounderIntegrationsRoutes(app);
    // Platform Connections — native connect-an-account infra: founder-entered
    // credentials (encrypted, DB-first with env fallback), live verify, and
    // the prewired OAuth flows for ad accounts.
    const { registerConnectionsRoutes } = await import("./routes-connections");
    registerConnectionsRoutes(app);
    // Free-distribution: per-route server-rendered <head> for the public
    // content surfaces (field-notes / compare / learn) — social cards and
    // first-pass crawlers stop seeing the homepage head on every URL.
    const { registerSeoHeadRoutes } = await import("./routes-seo-head");
    registerSeoHeadRoutes(app);
    // Phase 7 Months 7: Hartwell title-partner API — POST /title-orders +
    // inbound webhook + ALTA Pillar 2 wire instructions + partner registry.
    const { registerTitlePartnerRoutes } = await import("./routes-title-partners");
    registerTitlePartnerRoutes(app);
    // Phase 3 Week 9: AI cost ceiling + founder cost dashboard endpoints.
    const { registerAiCostRoutes } = await import("./routes-ai-cost");
    registerAiCostRoutes(app);
    // Sentry cost tuning: founder-only observability cost dashboard.
    const { registerObservabilityCostRoutes } = await import("./routes-observability-cost");
    registerObservabilityCostRoutes(app);
    // Wave 10: Self-tuning cost optimiser — founder dashboard + apply endpoint.
    const { registerCostOptimizerRoutes } = await import("./routes-cost-optimizer");
    registerCostOptimizerRoutes(app);
    // Wave 10: Per-customer unit economics + profit-margin dashboard.
    const { registerUnitEconomicsRoutes } = await import("./routes-unit-economics");
    registerUnitEconomicsRoutes(app);
  }

  // Executive Revenue Dashboard — Founder-only aggregate metrics
  app.get('/api/founder/executive-dashboard', isAuthenticated, getOrCreateOrg, requireFounder, async (req: AuthenticatedRequest, res: Response) => {
    try {
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

      // FW-MARISOL-1 (push-forward 2026-05-08): customer-concentration alert.
      // Marisol/Ashok/Harlowe converged: any single org contributing >20% of
      // total MRR is a Series-A diligence red flag. Surface the top 5 with
      // their MRR share so the founder can see the concentration shape at a
      // glance. Threshold is 20% (a common diligence trip-wire).
      const orgMrrCents = activeOrgs.map((org) => {
        const interval = (org.billingInterval === "yearly" ? "yearly" : "monthly") as "monthly" | "yearly";
        return {
          orgId: org.id,
          name: org.name,
          slug: org.slug,
          mrrCents: monthlyRevenueCentsFor(org.subscriptionTier, interval),
          tier: org.subscriptionTier,
        };
      })
        .filter((row) => row.mrrCents > 0)
        .sort((a, b) => b.mrrCents - a.mrrCents);
      const totalMrrCents = orgMrrCents.reduce((s, r) => s + r.mrrCents, 0);
      const top5 = orgMrrCents.slice(0, 5).map((row) => ({
        orgId: row.orgId,
        name: row.name,
        slug: row.slug,
        tier: row.tier,
        mrrCents: row.mrrCents,
        sharePct: totalMrrCents > 0
          ? Math.round((row.mrrCents / totalMrrCents) * 10000) / 100
          : 0,
      }));
      const concentrationFlag = top5.length > 0 && top5[0].sharePct > 20;
      const concentration = {
        threshold: 20,
        flag: concentrationFlag,
        top1SharePct: top5[0]?.sharePct ?? 0,
        top5,
        totalMrrCents,
      };

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
        concentration,
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
    if (!county || !state) return Errors.badRequest(res, "county and state are required");
    const { findAutoScrapeSource, scrapeCountyDelinquentList } = await import("./services/delinquentListScraper");
    const source = findAutoScrapeSource(county, state);
    if (!source) {
      return sendError(
        res,
        404,
        "NOT_FOUND",
        `Auto-scraping not yet available for ${county}, ${state}. Use manual CSV upload instead.`,
        { manualUploadUrl: "/api/import/tax-delinquent" },
      );
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
  // Lavender Week 10 — monthly-close + Olympia 1099 batch generator. Founder-
  // gated inside the router until the role-based permission check ships.
  app.use('/api/accounting', isAuthenticated, getOrCreateOrg, accountingRouter);
  // Wave: cost — eval suites are CPU-heavy; routed to worker via outbox.
  app.use('/api/eval', isAuthenticated, evalRouter);
  app.use('/api/ab-tests', isAuthenticated, getOrCreateOrg, abTestsRouter);
  app.use('/api/dodd-frank', isAuthenticated, doddFrankRouter);

  // Field Scout: parcel lookup, voice transcription, photo uploads, visits, reports
  app.use('/api', isAuthenticated, getOrCreateOrg, fieldScoutRouter);

  // Phase 5-6 routes
  app.use('/api/investor-verification', isAuthenticated, getOrCreateOrg, investorVerificationRouter);
  // routes-transaction-fees deleted 2026-07-29 (founder ruling "be the rail, not
  // the provider"): a platform escrow / take-a-cut / manual-payout console over
  // AcreOS's own balance. Every handler was a stub, and POST /fees/payouts/trigger
  // returned 202 "processing" while doing nothing. Custody is not AcreOS's to hold.
  // /api/call-routing deleted 2026-08-01 (Voice / AI voice kill): every handler
  // returned a hardcoded stub config presented as real — honesty gate applies.
  app.use('/api/buyer-network', isAuthenticated, getOrCreateOrg, buyerNetworkRouter);
  // routes-tax-optimization deleted 2026-07-29 (Nothing-lies wave A): 10 of 11
  // endpoints returned 501 and no client consumed the mount. The real tax
  // optimizer API is /api/tax-optimizer/* in routes-misc.ts.
  app.use('/api/deal-rooms', isAuthenticated, getOrCreateOrg, featureGate("feature_deal_rooms"), dealRoomsRouter);
  app.use('/api/data-api', dataApiRouter); // API key auth handled internally
  // (/api/docs registered above, before the /api catch-all auth middleware)

  // ============================================
  // DOMAIN ROUTE MODULES
  // ============================================
  registerDashboardRoutes(app);
  registerJobHealthRoutes(app);
  // Kareem §1: admin endpoints to verify the audit_log hash chain. Founder-
  // only; emits its own audit_event for every verification run.
  registerAdminAuditLogRoutes(app);
  // Tahoe / Beatrice: customer-readable security activity log (org-scoped).
  // GET /api/audit/log — surfaced behind Settings → Security activity.
  registerCustomerAuditRoutes(app);
  // Kareem §5 + §7: change-management ledger (deployments) and DR drill
  // ledger (dr_drills). GitHub Actions deploy.yml writes deploys here; the
  // founder records DR drills here after each quarterly run.
  registerAdminComplianceRoutes(app);
  // Quinn (Chief of Alignment) — public transparency endpoints are
  // registered EARLIER (before the '/api' isAuthenticated catch-all) so
  // anonymous visitors reach them; see the block above epicServicesRouter.
  // Quinn + Rafe — "appeal the AI" recourse loop. Customer surface
  // (see a refusal-with-reason + file an appeal) and the founder review
  // surface (uphold/reverse with rationale, close the loop back to the
  // customer). EU AI Act Art. 86.
  registerPaxAppealRoutes(app);
  registerFounderAppealRoutes(app);
  // Rafe — the Recourse Loop: every negative customer signal becomes a drafted,
  // personal, same-hour human reply in one founder queue, edit-and-send,
  // persisted back (auditable). Distinct from /founder/appeals.
  registerFounderRecourseRoutes(app);
  registerOrganizationRoutes(app);
  // Phase 5 §5 — team-readiness endpoints (per-seat pricing, lead-assignment
  // rules, manager dashboard, Slack/Teams webhooks, offer-approval queue).
  registerTeamReadinessRoutes(app);
  registerLeadRoutes(app);
  registerUnderwritingDefaultsRoutes(app);
  registerPropertyRoutes(app);
  registerDealRoutes(app);
  registerFinanceRoutes(app);
  registerDocumentRoutes(app);
  registerCampaignRoutes(app);
  // Pillar 3 — customer-facing /outreach/mail composer + in-flight tracker.
  registerOutreachMailRoutes(app);
  // Pillar 3 Tab 4 — EDDM map endpoints (routes / parcels / queue).
  registerEddmRoutes(app);
  registerAIRoutes(app);
  // Pax inbox drafted-reply (product-call #10) — uses the standard AI
  // router under /api/ai. Mounted after registerAIRoutes so its routes
  // take precedence on the same prefix; isAuthenticated + getOrCreateOrg
  // gate access.
  app.use('/api/ai', isAuthenticated, getOrCreateOrg, aiDraftRouter);
  registerBillingRoutes(app);
  registerSubscriptionRoutes(app);
  registerBorrowerRoutes(app);
  // Note Investor vertical (Phase 5 §5) — acquired-notes + payments + amort.
  registerNoteRoutes(app);
  // Note Investor vertical (Phase 5 §5) — pre-book diligence pipeline.
  registerNoteAcquisitionRoutes(app);
  // Note Servicer (Pillar K — Ursa) — owners-of-record, remittances, licenses.
  registerServicerRoutes(app);
  // Tax-Delinquent vertical TD-2 — redemption-clock surface.
  registerTaxCertificateRoutes(app);
  // Tax-Delinquent vertical TD-3 — per-state rules database.
  registerTaxRuleRoutes(app);
  // Tax-Delinquent vertical TD-6 — quiet-title workflow.
  registerQuietTitleRoutes(app);
  // Wholesaler vertical W-1 — per-state assignment-legality rules.
  registerWholesalerRuleRoutes(app);
  // Wholesaler vertical W-2 — EMD inspection-period state machine.
  registerEarnestMoneyRoutes(app);
  // Wholesaler vertical W-3 — double-close primitive (A→B + B→C).
  registerDoubleCloseRoutes(app);
  // Wholesaler vertical W-4 — push-to-buyer-list one-click blast.
  registerBuyerBlastRoutes(app);
  // Wholesaler vertical W-5 — wholesaler dashboard endpoint (real data).
  registerWholesalerDashboardRoutes(app);
  // Wholesaler vertical W-6 — buyer match analytics + freshness.
  registerBuyerAnalyticsRoutes(app);
  // Subdivider vertical SD-2 — parent/child pipeline + rollup metrics.
  registerSubdivisionRoutes(app);
  // Subdivider vertical SD-3 — permit-tracker workflow.
  registerPermitTrackerRoutes(app);
  // Subdivider vertical SD-4 — cost-basis allocation engine.
  registerLotBasisRoutes(app);
  // Subdivider vertical SD-5 — lot-pricing rules editor.
  registerLotPricingRoutes(app);
  // Subdivider vertical SD-6 — county-timeline + carry-cost projector.
  registerCountyTimelineRoutes(app);
  // Subdivider vertical SD-7 — subdivision plans (GeoJSON storage + A/B).
  registerSubdivisionPlanRoutes(app);
  // Subdivider vertical SD-8 — CC&R / covenant template library.
  registerCcrTemplateRoutes(app);
  // Fix-and-flip vertical FF-2 — rehab budget builder.
  registerRehabRoutes(app);
  // Fix-and-flip vertical FF-3 — contractor management + 1099-NEC.
  registerContractorRoutes(app);
  // Fix-and-flip vertical FF-4 — ARV calculator (distinct from AVM).
  registerArvRoutes(app);
  // Flip analyzer — assembles the chain the ARV calculator dead-ended in:
  // ATTOM comps → ARV → 70%-rule MAO (was dead code) → draft offer, driven by
  // the org's own underwriting rules.
  registerFlipAnalyzerRoutes(app);
  // Fix-and-flip vertical FF-5 — bid comparison (side-by-side).
  registerBidEstimateRoutes(app);
  // Fix-and-flip vertical FF-6 — construction draws + holding-cost meter.
  registerConstructionDrawRoutes(app);
  // Fix-and-flip vertical FF-7 — rehab photo evidence (before/during/after,
  // defect, lender_draw, tax basis).
  registerRehabPhotoRoutes(app);
  // Drive Mode — POST /api/field-scout/quick-add (one-tap curb capture). The
  // client DriveMode surface (linked from PersonaMapStrip for wholesaler/
  // fix_flipper personas + the today.tsx CTA) calls this; it shipped in
  // W5-10 but registerDriveModeRoutes was never wired, so quick-add 404'd in
  // prod. Caught by the 3E route-manifest orphan test. (Its old 501 photo-
  // stub was dropped — fieldScoutRouter already serves /api/leads/:id/photos.)
  registerDriveModeRoutes(app);
  // Buy-and-hold vertical BH-2 — tenant + lease CRUD.
  registerRentalRoutes(app);
  // Buy-and-hold vertical BH-3 — rent ledger + state late-fee engine.
  registerRentLedgerRoutes(app);
  // Wave 3 (multifamily → core) — property-expense ledger (the operating-cost
  // axis NOI needs). Write paths only; the NOI wiring that reads it is a later
  // stage.
  registerPropertyExpenseRoutes(app);
  // RS-4 (post-may1-resweep): customer-side /account/security surface.
  registerAccountSecurityRoutes(app);
  // FW-DIEGO-1 (push-forward 2026-05-08): founder-letter infrastructure.
  registerFounderLetterRoutes(app);
  // 2026-05-11: public feedback/support form + founder triage inbox.
  // Replaces dead thomas@acreos.io mailto links across landing surfaces.
  registerFeedbackRoutes(app);
  // 2026-05-12 — Rosy River C4 server side: founder agent-queue endpoints.
  // Powers /founder/agent-queue (C4 client UI shipped separately) + the
  // /founder/notifications feed for continuous agent-event visibility.
  registerRosyRiverRoutes(app);
  // 2026-05-12 — Agent-loop prerequisite health check (gh auth, git, db,
  // OpenRouter, seeded rules). Founder hits it post-deploy.
  registerAgentPrereqsRoute(app);
  // 2026-05-13 — Pillar D customer-facing trust surface — registered EARLIER
  // (before Clerk middleware) so the public endpoints don't 401. This call
  // is intentionally left as a no-op safety net.
  // registerPublicTrustRoutes(app);  // moved above clerkMiddleware
  // 2026-05-13 — Pillar D / D9 incident tracking + post-mortem routes.
  registerIncidentRoutes(app);
  // 2026-05-13 — Pillar D / D6 error-budget endpoint.
  registerErrorBudgetRoute(app);
  // Tess #5 — auth-free worker liveness endpoint for the external eye.
  registerWorkerHeartbeatRoute(app);
  // 2026-05-13 — Pillar E / E3 cohort retention endpoint.
  registerCohortRetentionRoutes(app);
  // 2026-05-13 — Pillar E / E4+E9 customer health endpoints.
  registerCustomerHealthRoutes(app);
  // 2026-05-13 — Pillar E / E10 cohort LTV endpoint.
  registerCohortLtvRoutes(app);
  // 2026-05-13 — Pillar F / F2 Pax quality (CSAT + resolution + cost).
  registerPaxQualityRoutes(app);
  // Workstream A (Honesty) — founder-only Pax trace viewer at
  // /api/founder/pax-traces. Read-only audit of every Pax LLM call.
  registerPaxTracesRoutes(app);
  // Workstream A (Honesty) wave 2 — founder-only Pax calibration plot at
  // /api/founder/pax-calibration. Bucketed predicted-vs-realized accept-rate.
  registerPaxCalibrationRoutes(app);
  // Wave 3 Workstream E (distribution telemetry) — founder-only
  // acquisition truth surface at /api/founder/customers. Paid / trial /
  // churned counts + top UTM sources + recent signup names. Companion to
  // the qualitative customers.md tracker at the repo root.
  registerFounderCustomersRoutes(app);
  // Pulse home — /api/founder/pulse. Solene's daily one-line as structured
  // data: SHA, health, commits, Autonomy Horizon, capital, phase, decisions.
  registerFounderPulseRoutes(app);
  // County coverage ledger — /api/founder/coverage. Coverage % of the counties
  // customers actually touch + the demand-ranked discovery queue (crawl order).
  registerFounderCoverageRoutes(app);
  // Paid-data eval harness — /api/founder/paid-data-eval. Runs the persisted
  // free LIS corpus against a paid provider (mock today) and reports field
  // divergence + decision-flip rate so a paid-data trial is bought surgically.
  registerFounderPaidDataEvalRoutes(app);
  // Customer county-coverage request — /api/county-coverage/* — the "request
  // this county" CTA (maps surface) that demand-drives discovery-on-miss.
  registerCountyCoverageRoutes(app);
  // Cost summary — /api/founder/cost-summary. Consolidated cost view for
  // the /founder/cost screen (AI spend + infra + per-org breakdown).
  registerFounderCostRoutes(app);
  // Domain-audit cockpit — /api/founder/audit-findings — the shared
  // continuous-audit substrate's founder "is it green?" read surface +
  // acknowledge/resolve. Founder-only. Company-level (no org scope).
  registerFounderAuditRoutes(app);
  // Founder Life-Cockpit — /api/founder/life-cockpit/* — FOUNDER-SIDE personal
  // ops (taxes, encrypted document vault, income, obligations). Founder-only.
  registerFounderLifeCockpitRoutes(app);
  // FW-MIREILLE-1 (push-forward 2026-05-08): public deal-room view (growth loop).
  registerPublicDealRoomRoute(app);
  // FW-MARISOL-2: ASC 606 recognition + /founder/financials backend.
  registerFounderFinancialsRoutes(app);
  // FW-CAMILA-2/3 + FW-WYNNE-2/3 (180-day batch): NPS + pre-churn ladder
  // + retention policy + power-user dashboard.
  registerLifecycleRoutes(app);
  // Panel-300 G2: API contract layer (OpenAPI export + X-API-Version header).
  registerApiVersionHeader(app);
  registerApiContractRoutes(app);
  // Panel-300 #26: GDPR DSAR endpoint with 24h SLA.
  registerPrivacyDsarRoutes(app);
  registerPaxAuditRoutes(app);
  // Solene (COO) self-audit + capital tracker founder read endpoints.
  registerSoleneAuditRoutes(app);
  // Solene (Phase 7) — morning-pulse founder read endpoints. GET cached
  // snapshot + POST /refresh force re-compute. Backs the Today page's
  // live one-line; cron-fed by the 12:00 UTC + 30m continuous jobs.
  registerMorningPulseRoutes(app);
  // Founder Autopilot — Trust Ledger control plane: GET the ledger + POST a
  // sovereign domain-level override (pause/trust). The reversibility guarantee.
  registerAutopilotRoutes(app);
  // Solene (Phase 2) — chat backend: SSE-streaming /api/founder/solene-chat/*
  // turn runner over OpenRouter with smart routing + prompt cache + tool
  // exec. Registration was missing from Wave 2 (shipped 2026-06-04) so the
  // chat UI POSTed into a 404 for 24 hours — surfaced by the 2026-06-05
  // founder audit, this restores the route mount.
  registerSoleneChatRoutes(app);
  // Founder Money page — summary / envelopes / events. Reads
  // solene_capital_events (the AI cost ledger) + env-configurable infra
  // knobs (FLY_INFRA_MONTHLY_USD, FOUNDER_CASH_ON_HAND_USD, etc) until
  // Lena's Phase 1 capital surface lands. Without this, /founder/money
  // silently 404'd into Phase 0 placeholders.
  registerFounderMoneyRoutes(app);
  // Solene (Layer 1 cap #2) — cross-agent claims founder read endpoint.
  registerAgentClaimsRoutes(app);
  // Solene (Layer 1 cap #1) — founder HTTP surface for the dispatch queue:
  // POST /api/founder/dispatches/queue + GET /dispatches + GET /:id + POST /:id/cancel.
  registerDispatchRoutes(app);
  // Solene (COO) proactive page channel — POST /api/internal/solene/page
  // (shared-secret auth) + GET /api/founder/solene-page/recent (founder).
  registerSolenePageRoutes(app);
  // Solene — customer-surface ErrorBoundary trip endpoints:
  // POST /api/client/error-boundary-trip (open, rate-limited per-user-per-route)
  // GET  /api/founder/error-boundary-trips/recent (founder).
  registerErrorBoundaryRoutes(app);
  // Solene — customer-surface ErrorBoundary aggregator endpoints:
  // GET  /api/founder/error-boundary-trips/counts (founder)
  // GET  /api/internal/error-boundary-trips/pulse-segment (open, counts-only).
  registerErrorBoundaryAggregatorRoutes(app);
  // Iris (CTO) continuous p95 baseline — GET /api/founder/iris-perf/recent.
  registerIrisPerfRoutes(app);
  // Soren (CGO) /learn SEO rank tracker — GET /api/founder/soren-seo/recent.
  registerSorenSeoRoutes(app);
  // Beatrice (CRO) regulatory-news feed — GET /api/founder/beatrice-regwatch/recent.
  registerBeatriceRegWatchRoutes(app);
  // External-watch (Layer 1 cap #4) — Anthropic API changelog + npm vuln feed.
  //   GET /api/founder/external-watch/recent
  //   POST /api/founder/external-watch/:id/ack
  registerExternalWatchRoutes(app);
  // L2.6 plan-then-execute proposals (founder review surface).
  //   GET /api/founder/plan-proposals/:id  + POST /:id/approve  + POST /:id/reject
  registerPlanProposalRoutes(app);
  // L6.31 founder-mode bypass — Tom directly invokes any agent with full authority.
  //   POST /api/founder/bypass/dispatch + POST /:id/cancel + GET /recent
  registerFounderBypassRoutes(app);
  // L6.32 real-time founder collab — agents page Tom; Tom answers via the dashboard.
  //   GET /api/founder/asks + GET /:id + POST /:id/answer + POST /:id/supersede
  registerFounderCollabRoutes(app);
  // D2 signup-to-first-value funnel — measure + surface per-org TTFV.
  //   GET /api/founder/onboarding-funnel/summary + /orgs + /orgs/:orgId
  //   POST /api/founder/onboarding-funnel/recompute
  registerOnboardingFunnelRoutes(app);
  // D1 Pax-context capture — PaxContextStep posts here on onboarding submit.
  //   POST /api/onboarding/pax-context (capture) + GET (read) + opt-out + DELETE.
  registerPaxContextRoutes(app);
  // Team-improvement detector — GET /api/founder/team-improvement/recent + /pending.
  // Event-driven primary driver per feedback_continuous_improvement_cadence.md.
  registerTeamImprovementRoutes(app);
  // Solene v3 — TEAM-SYSTEM audit (overarching team-as-a-system elite-bar audit).
  //   GET /api/founder/team-system-audit/recent
  //   GET /api/founder/team-system-audit/findings?dimension=...&severity=...
  registerTeamSystemAuditRoutes(app);
  // Panel-300 founder compliance + ops dashboards backend.
  registerFounderComplianceRoutes(app);
  // Buy-and-hold vertical BH-4 — move-in/move-out inspections.
  registerMoveInspectionRoutes(app);
  // Buy-and-hold vertical BH-5 — rent-roll uploader on /parcels/:id.
  registerRentRollImportRoutes(app);
  // Buy-and-hold vertical BH-6 — maintenance ticketing.
  registerMaintenanceTicketRoutes(app);
  // Buy-and-hold vertical BH-7 — investor analytics (NOI/cap/DSCR).
  registerInvestorAnalyticsRoutes(app);
  // R4: Clerk-native MFA enforcement on every /api/admin/* route. Users
  // with MFA enabled in Clerk must have completed second-factor in this
  // session; high-trust paths (admin recovery, ownership transfer)
  // additionally require MFA *be set up*. See requireClerkMFA for the
  // full decision matrix.
  app.use("/api/admin", isAuthenticated, requireClerkMFA);
  registerAdminRoutes(app);
  // Coriander §1: Recovery-console endpoints (founder-gated, audit-logged).
  // Mounted alongside other /api/admin routes so the requireClerkMFA
  // middleware above also covers them.
  registerAdminRecoveryRoutes(app);
  // Phase 3 Week 11: GDPR/CCPA DSAR pipeline (public intake + founder ops)
  // and the founder-only sub-processor DPA registry.
  registerDsarRoutes(app);
  // Phase 3 Week 11: Legal-hold mechanism (Saskia/Lazlo/Margolis) — FRCP 37(e)
  // delete-blocker + retention exclusion + founder admin UI backing endpoints.
  registerLegalHoldRoutes(app);
  registerSubProcessorRoutes(app);
  // Phase 3 Week 14: Activation funnel + retention infra (Yuna §8, Konstantin §2)
  registerActivationRoutes(app);
  // Phase 3 Week 12: ML training-snapshot instrumentation (Magnus §1)
  registerMlSnapshotsRoutes(app);
  // Phase 8 Months 11: Wenzeslaus ETL orchestrator + DLQ replay UI
  registerEtlRoutes(app);
  // Phase 4 W21-22: prompt-versioning A/B harness (Nadia-AI §2.A)
  registerPromptVersionsRoutes(app);
  registerCoreAIRoutes(app);
  registerIntegrationRoutes(app);
  registerCRMExtrasRoutes(app);
  registerImportExportRoutes(app);
  registerReferralRoutes(app);
  registerTeamMessagingRoutes(app);
  registerDocSystemRoutes(app);
  registerContractChainRoutes(app);
  registerAnalyticsRoutes(app);
  registerCommunicationRoutes(app);
  await registerVAEngineRoutes(app);
  await registerMiscRoutes(app);
  registerSupportTicketRoutes(app);
  // Public KB browse — Lens 25 #3. Powers /help#kb and /help/article/:slug,
  // plus the "Learn why" deep links from server/utils/errors.ts (docsSlug).
  registerKnowledgeBaseRoutes(app);
  registerMicroFeatureRoutes(app);
  registerClosingRoutes(app);
  registerPlatformFeatureRoutes(app);
  // registerLeaseRoutes + registerMaintenanceRoutes removed — see import block.

  // Phase 1: Communication features
  registerInboundEmailRoutes(app);
  // SendGrid event webhook (Hessam §2.3) — Ed25519-signed delivery events
  registerSendGridEventRoutes(app);
  // SES bounce/complaint webhook (Gap 4) — SNS-signed; feeds suppression list
  registerSesEventRoutes(app);
  // Pillar 9.1 — Founder DLQ inspection + retry/discard endpoints.
  (await import("./routes-founder-dlq")).registerFounderDlqRoutes(app);
  // Tier 3F — data co-op: Map-door county market heat (customer) + quarterly
  // market-report drafts (founder-gated, witnessed-publish — list/preview only).
  (await import("./routes-market-heat")).registerMarketHeatRoutes(app);
  (await import("./routes-founder-market-reports")).registerFounderMarketReportRoutes(app);
  // Eleonora deliverability — Phase 1 §10 / Week 7-8: per-org DKIM/SPF/DMARC
  // identity provisioning, one-click List-Unsubscribe handler, founder
  // deliverability dashboard.
  registerDeliverabilityRoutes(app);

  // Register AI Operations (Router-based)
  registerAIOperationsRoutes(app);

  // Register Autonomous Agent routes
  registerAutonomousAgentRoutes(app);

  // ─── Elite Features (Tax Escrow, E-Signing, DD Engine, Meta Ads, Actum, Syndication, Bookkeeping, VA) ──
  await registerEliteFeatureRoutes(app);

  // ─── Syndication channel model (D7): status, sync-all, channel toggle/sync ──
  registerSyndicationRoutes(app);

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
        return Errors.badRequest(res, "address1, city, and state are required");
      }
      const result = await verifyAddress({ address1, address2, city, state, zip });
      res.json(result);
    } catch (err: any) {
      Errors.internal(res, err);
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
      Errors.internal(res, error);
    }
  });

  // dashboard-summary — registered BEFORE /api/tasks/:id so the literal path wins (2026-07-11 route-order sweep).
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
      Errors.internal(res, error);
    }
  });

  app.get("/api/tasks/:id", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = req.organization!.id;
      const id = parseInt(req.params.id);
      
      const task = await storage.getTask(orgId, id);
      if (!task) {
        return Errors.notFound(res, "task");
      }
      
      res.json(task);
    } catch (error: any) {
      logger.error("Get task error", error instanceof Error ? error : undefined);
      Errors.internal(res, error);
    }
  });

  app.post("/api/tasks", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = req.organization!.id;
      const userId = req.user.id;
      
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
      Errors.internal(res, error);
    }
  });

  app.put("/api/tasks/:id", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = req.organization!.id;
      const userId = req.user.id;
      const id = parseInt(req.params.id);
      
      const existingTask = await storage.getTask(orgId, id);
      if (!existingTask) {
        return Errors.notFound(res, "task");
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
      Errors.internal(res, error);
    }
  });

  app.delete("/api/tasks/:id", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = req.organization!.id;
      const id = parseInt(req.params.id);
      
      const task = await storage.getTask(orgId, id);
      if (!task) {
        return Errors.notFound(res, "task");
      }
      
      const user = req.user as any;
      const userId = user?.id || user?.id;
      
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
      Errors.internal(res, error);
    }
  });

  app.post("/api/tasks/:id/complete", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = req.organization!.id;
      const userId = req.user.id;
      const id = parseInt(req.params.id);
      
      const existingTask = await storage.getTask(orgId, id);
      if (!existingTask) {
        return Errors.notFound(res, "task");
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
      Errors.internal(res, error);
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
      Errors.internal(res, error);
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
