// Initialize OpenTelemetry BEFORE any other imports (T74)
import { initTracing } from "./tracing";
// initTracing() is called at startup below — see startupInit()

import express, { type Request, Response, NextFunction } from "express";
import path from "path";
import cookieParser from "cookie-parser";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { WebhookHandlers } from "./webhookHandlers";
import { leadNurturerService } from "./services/leadNurturer";
import { db, storage } from "./storage";
import { eq, sql, lt } from "drizzle-orm";
import { organizations, jobHealthLogs, agentEvents } from "@shared/schema";
import { logger, requestLoggingMiddleware, errorLoggingMiddleware } from "./utils/logger";
import { securityHeaders, corsMiddleware, requestTimeout, validateContentType, sanitizeQueryParams } from "./middleware/security";
import { metricsMiddleware, metricsHandler } from "./middleware/metrics";
import { telemetryMiddleware } from "./middleware/telemetry";
import crypto from "crypto";
import { wsServer } from "./websocket";
import { realtimeAlertsService } from "./services/realtimeAlerts";
import { createMcpServer } from "./mcp/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import rateLimit from "express-rate-limit";
import { initSentry, Sentry } from "./utils/sentry";
import { validateEnv } from "./utils/validateEnv";
import { jobSupervisor } from "./services/jobSupervisor";

// Validate required env vars before anything else — exits with clear error if misconfigured
validateEnv();

// Initialize Sentry ASAP — must run before any other code
initSentry();

// T15: Validate required secrets at startup
import { validateSecrets } from "./middleware/secretsValidation";
validateSecrets();

// F-A09-2: PII masking console interceptor — masks phone, email, SSN, CC in all log output
import { installConsoleInterceptor } from "./middleware/piiMasking";
installConsoleInterceptor();

// Global safety net for unhandled errors — log and report to Sentry
process.on("unhandledRejection", (reason: unknown) => {
  // Log the full error — reason can be an empty object {}, so serialize it
  const msg = reason instanceof Error ? reason.stack : JSON.stringify(reason, null, 2);
  logger.error("[process] Unhandled promise rejection", reason instanceof Error ? reason : undefined);
  Sentry.captureException(reason);
});

process.on("uncaughtException", (err: Error) => {
  // ERR_HTTP_HEADERS_SENT is non-fatal — log and continue instead of crashing
  if ((err as any)?.code === "ERR_HTTP_HEADERS_SENT") {
    logger.warn("[process] Non-fatal: ERR_HTTP_HEADERS_SENT (headers already sent, skipping)");
    return;
  }
  logger.error("[process] Uncaught exception", err);
  Sentry.captureException(err);
  // Allow Sentry to flush, then exit so the process manager can restart
  Sentry.close(2000).finally(() => process.exit(1));
});

const app = express();
const httpServer = createServer(app);

// Initialize WebSocket real-time server
wsServer.initialize(httpServer);
realtimeAlertsService.setWebSocketServer(wsServer);

// Initialize data providers
import { initializeProviders } from "./providers-init";
initializeProviders();

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  logger.info(`${formattedTime} [${source}] ${message}`);
}

// ============================================
// JOB LOCKING FOR MULTI-INSTANCE DEPLOYMENT
// ============================================

const instanceId = crypto.randomUUID();

// ── Background interval tracking for graceful shutdown ──────────────────────
// All setInterval calls for background jobs MUST use trackInterval() so they are
// cleared during SIGTERM/SIGINT shutdown. Using bare setInterval() will leak timers
// and prevent graceful shutdown from completing.
(globalThis as any).__bgIntervals = (globalThis as any).__bgIntervals || [];

function trackInterval(fn: () => void, ms: number): ReturnType<typeof setInterval> {
  const handle = setInterval(fn, ms);
  (globalThis as any).__bgIntervals.push(handle);
  return handle;
}

// Track last success log time per job to implement "1 success log per hour per job" sampling
const _jobLastSuccessLog: Record<string, number> = {};

async function withJobLock<T>(
  jobName: string,
  ttlSeconds: number,
  fn: () => Promise<T>
): Promise<T | null> {
  const acquired = await storage.acquireJobLock(jobName, instanceId, ttlSeconds);
  if (!acquired) {
    log(`Lock not acquired, skipping execution`, jobName);
    // Log skipped_lock (fire-and-forget, non-blocking)
    db.insert(jobHealthLogs).values({
      jobName,
      runStartedAt: new Date(),
      runCompletedAt: new Date(),
      durationMs: 0,
      status: "skipped_lock",
    }).catch(() => {/* best effort */});
    return null;
  }
  const startedAt = new Date();
  try {
    const result = await fn();
    const durationMs = Date.now() - startedAt.getTime();
    // Sample: only log success once per hour per job
    const now = Date.now();
    const lastLog = _jobLastSuccessLog[jobName] ?? 0;
    if (now - lastLog > 60 * 60 * 1000) {
      _jobLastSuccessLog[jobName] = now;
      db.insert(jobHealthLogs).values({
        jobName,
        runStartedAt: startedAt,
        runCompletedAt: new Date(),
        durationMs,
        status: "success",
      }).catch(() => {/* best effort */});
    }
    return result;
  } catch (err: any) {
    const durationMs = Date.now() - startedAt.getTime();
    // Always log failures
    db.insert(jobHealthLogs).values({
      jobName,
      runStartedAt: startedAt,
      runCompletedAt: new Date(),
      durationMs,
      status: "failed",
      errorMessage: err?.message ?? String(err),
    }).catch(() => {/* best effort */});
    // Phase B: Publish job failure to event mesh for real-time alerts
    import("./services/eventMeshPublisher").then(({ eventMeshPublisher }) => {
      eventMeshPublisher.jobFailed(jobName, err?.message ?? String(err), { durationMs }).catch(() => {});
    }).catch(() => {});
    throw err;
  } finally {
    await storage.releaseJobLock(jobName, instanceId);
  }
}

async function initStripe() {
  if (!process.env.STRIPE_SECRET_KEY) {
    log('STRIPE_SECRET_KEY not set, skipping Stripe initialization', 'stripe');
    return;
  }

  try {
    log('Stripe configured via environment variables', 'stripe');

    const appUrl = process.env.APP_URL;
    if (appUrl) {
      log(`Webhook URL: ${appUrl}/api/stripe/webhook`, 'stripe');
      log('Configure this URL in your Stripe Dashboard webhook settings', 'stripe');
    } else {
      log('APP_URL not set — configure Stripe webhook URL manually in Stripe Dashboard', 'stripe');
    }
  } catch (error: any) {
    log(`Failed to initialize Stripe: ${error.message}`, 'stripe');
  }
}

// STR-026: canonical host is acreos.io. Any request hitting acreos.fly.dev
// gets a 301 to the same path on acreos.io before any other middleware runs.
// Rationale: Clerk's FAPI pins JS versions with a 307 whose Location is
// absolute to the configured Clerk-Proxy-Url (acreos.io). On acreos.fly.dev
// that 307 is cross-origin, so browsers CORB-block the Clerk script and
// auth fails entirely. Redirecting at the edge ensures users always land on
// the configured canonical origin.
app.use((req, res, next) => {
  const host = (req.headers.host || "").toLowerCase();
  if (host === "acreos.fly.dev" || host.endsWith(".acreos.fly.dev")) {
    return res.redirect(301, `https://acreos.io${req.originalUrl}`);
  }
  next();
});

// API versioning: /api/v1/* is transparently rewritten to /api/*
// Clients can use either prefix; new code should use /api/v1/.
app.use((req, _res, next) => {
  if (req.url.startsWith("/api/v1/")) {
    req.url = "/api/" + req.url.slice("/api/v1/".length);
  }
  next();
});

// F-A05-3: Remove x-powered-by header
app.disable("x-powered-by");

// Task #30: Trust first proxy hop — required on Fly.io so req.ip reflects the
// actual client IP (for rate limiting and audit logging), not the Fly proxy.
app.set("trust proxy", 1);

// Enable gzip/brotli compression for all responses
import compression from "compression";
app.use(compression({ threshold: 1024 })); // Compress responses > 1KB

app.use(telemetryMiddleware); // Task #74: OpenTelemetry span recording per request
app.use(securityHeaders);
app.use(metricsMiddleware); // Prometheus request metrics collection
app.use(corsMiddleware);
app.use(requestTimeout);
app.use(sanitizeQueryParams);

app.post(
  '/api/stripe/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const signature = req.headers['stripe-signature'];

    if (!signature) {
      return res.status(400).json({ error: 'Missing stripe-signature' });
    }

    try {
      const sig = Array.isArray(signature) ? signature[0] : signature;

      if (!Buffer.isBuffer(req.body)) {
        log('STRIPE WEBHOOK ERROR: req.body is not a Buffer', 'stripe');
        return res.status(500).json({ error: 'Webhook processing error' });
      }

      await WebhookHandlers.processWebhook(req.body as Buffer, sig);

      res.status(200).json({ received: true });
    } catch (error: any) {
      log(`Webhook error: ${error.message}`, 'stripe');
      res.status(400).json({ error: 'Webhook processing error' });
    }
  }
);

// Task #204: enforce request body size limits to prevent payload-based DoS
app.use(
  express.json({
    limit: "1mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false, limit: "1mb" }));
app.use(cookieParser());

// Sentry request/tracing handler — must come before routes, after bodyParsers
if (process.env.SENTRY_DSN) {
  app.use(Sentry.expressErrorHandler());
}

app.use(validateContentType);
app.use(requestLoggingMiddleware);

// ── Rate limiting ────────────────────────────────────────────────────────────
// Auth routes: 20 requests per 15 min per IP
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many requests. Please try again later." },
});
app.use("/api/auth", authLimiter);
app.use("/api/login", authLimiter);
app.use("/api/register", authLimiter);

// AI endpoints: 60 requests per minute per IP
const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "AI request limit reached. Please wait a moment." },
});
app.use("/api/ai", aiLimiter);
app.use("/api/pax", aiLimiter);
app.use("/api/chat", aiLimiter);
app.use("/api/executive", aiLimiter);
app.use("/api/document-generation", aiLimiter);

// Webhook endpoints: 200 requests per minute per IP
const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Webhook rate limit exceeded." },
});
app.use("/api/webhooks", webhookLimiter);

// CSV / bulk import endpoints: 10 requests per 15 min per IP
const importLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Import rate limit exceeded. Please wait before importing again." },
});
app.use("/api/import", importLimiter);
app.use("/api/leads/import", importLimiter);
app.use("/api/properties/import", importLimiter);

// General authenticated API: 300 requests per minute, keyed by session ID (falls
// back to IP for unauthenticated requests). Prevents a single user behind a
// shared NAT/proxy from exhausting the per-IP bucket.
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req as any).auth?.userId || req.ip || 'unknown',
  message: { message: "Too many requests. Please slow down and try again shortly." },
});
app.use("/api", apiLimiter);

(async () => {
  // Run DB migrations on startup (production-safe versioned migrations)
  if (process.env.NODE_ENV === "production") {
    try {
      const { migrate } = await import("drizzle-orm/node-postgres/migrator");
      const { pool } = await import("./db");
      const { drizzle } = await import("drizzle-orm/node-postgres");
      const migrationDb = drizzle(pool);
      await migrate(migrationDb, { migrationsFolder: "./migrations" });
      log("Database migrations applied successfully", "db");
    } catch (err: any) {
      log(`DB migration warning: ${err.message}`, "db");
      // Non-fatal — server continues even if migration check fails
    }

    // Cycle 12 bootstrap: organization_invitations table. The drizzle
    // migration runner only applies files tracked in meta/_journal.json,
    // and the manual SQL migrations in this repo skip that journal. Do
    // an idempotent CREATE TABLE here so the invite endpoints work on
    // first deploy regardless of which migration path was used.
    try {
      const { pool } = await import("./db");
      await pool.query(`
        CREATE TABLE IF NOT EXISTS "organization_invitations" (
          "id" serial PRIMARY KEY,
          "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
          "email" text NOT NULL,
          "role" text NOT NULL DEFAULT 'member',
          "token" text UNIQUE,
          "invite_token_hash" text,
          "invite_token_last4" text,
          "invited_by_user_id" text,
          "status" text NOT NULL DEFAULT 'pending',
          "created_at" timestamp DEFAULT now() NOT NULL,
          "expires_at" timestamp NOT NULL,
          "accepted_at" timestamp,
          "accepted_by_user_id" text
        );
        ALTER TABLE "organization_invitations"
          ADD COLUMN IF NOT EXISTS "invite_token_hash" text;
        ALTER TABLE "organization_invitations"
          ADD COLUMN IF NOT EXISTS "invite_token_last4" text;
        ALTER TABLE "organization_invitations"
          ALTER COLUMN "token" DROP NOT NULL;
        CREATE INDEX IF NOT EXISTS "idx_org_invitations_org_id"
          ON "organization_invitations" ("organization_id");
        CREATE INDEX IF NOT EXISTS "idx_org_invitations_email_status"
          ON "organization_invitations" ("email", "status");
        CREATE INDEX IF NOT EXISTS "idx_org_invitations_token"
          ON "organization_invitations" ("token");
        CREATE INDEX IF NOT EXISTS "idx_org_invitations_token_hash"
          ON "organization_invitations" ("invite_token_hash");

        CREATE TABLE IF NOT EXISTS "email_events" (
          "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          "email" text NOT NULL,
          "event" text NOT NULL,
          "sg_event_id" text UNIQUE,
          "sg_message_id" text,
          "timestamp" timestamptz,
          "reason" text,
          "status" text,
          "response" text,
          "metadata" jsonb,
          "created_at" timestamptz DEFAULT now() NOT NULL
        );
        CREATE INDEX IF NOT EXISTS "idx_email_events_email_created"
          ON "email_events" ("email", "created_at" DESC);
        CREATE INDEX IF NOT EXISTS "idx_email_events_sg_event_id"
          ON "email_events" ("sg_event_id");

        CREATE TABLE IF NOT EXISTS "email_suppressions" (
          "email" text PRIMARY KEY,
          "reason" text NOT NULL,
          "suppressed_at" timestamptz DEFAULT now() NOT NULL,
          "source" text
        );
        CREATE INDEX IF NOT EXISTS "idx_email_suppressions_source"
          ON "email_suppressions" ("source");
      `);
    } catch (err: any) {
      log(`organization_invitations bootstrap: ${err.message}`, "db");
    }

    // Renoir §1-§2 bootstrap: subscription_history table. Mirrors
    // migrations/0042_subscription_history.sql so reactivation-context can
    // resolve last plan + tenure even on environments where the manual SQL
    // migration runner hasn't been executed yet.
    try {
      const { pool } = await import("./db");
      await pool.query(`
        CREATE TABLE IF NOT EXISTS "subscription_history" (
          "id" serial PRIMARY KEY,
          "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
          "event_type" text NOT NULL,
          "tier" text,
          "billing_interval" text,
          "price_cents" integer,
          "event_at" timestamp DEFAULT now() NOT NULL,
          "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
        );
        CREATE INDEX IF NOT EXISTS "idx_subscription_history_org_event_at"
          ON "subscription_history" ("organization_id", "event_at" DESC);
        CREATE INDEX IF NOT EXISTS "idx_subscription_history_event_type"
          ON "subscription_history" ("event_type");
      `);
    } catch (err: any) {
      log(`subscription_history bootstrap: ${err.message}`, "db");
    }

    // Phase A.0 bootstrap: simulated_actions table. Records every
    // would-have-happened external side effect when SIMULATION_MODE=true.
    try {
      const { pool } = await import("./db");
      await pool.query(`
        CREATE TABLE IF NOT EXISTS "simulated_actions" (
          "id" serial PRIMARY KEY,
          "organization_id" integer REFERENCES "organizations"("id") ON DELETE CASCADE,
          "category" text NOT NULL,
          "action" text NOT NULL,
          "payload" jsonb,
          "simulated_id" text NOT NULL UNIQUE,
          "created_at" timestamp DEFAULT now() NOT NULL
        );
        CREATE INDEX IF NOT EXISTS "idx_sim_actions_org_id"
          ON "simulated_actions" ("organization_id");
        CREATE INDEX IF NOT EXISTS "idx_sim_actions_category_created"
          ON "simulated_actions" ("category", "created_at");
      `);
    } catch (err: any) {
      log(`simulated_actions bootstrap: ${err.message}`, "db");
    }

    // Founder letters — monthly narrative table.
    try {
      const { pool } = await import("./db");
      await pool.query(`
        CREATE TABLE IF NOT EXISTS "founder_letters" (
          "id" serial PRIMARY KEY,
          "month_key" text NOT NULL UNIQUE,
          "letter_markdown" text NOT NULL,
          "summary_json" jsonb NOT NULL,
          "pending_founder_decision" text,
          "generated_at" timestamp DEFAULT now() NOT NULL,
          "delivered_at" timestamp,
          "status" text NOT NULL DEFAULT 'draft'
        );
        CREATE INDEX IF NOT EXISTS "founder_letters_month_idx"
          ON "founder_letters" ("month_key");
        CREATE INDEX IF NOT EXISTS "founder_letters_status_idx"
          ON "founder_letters" ("status");
      `);
    } catch (err: any) {
      log(`founder_letters bootstrap: ${err.message}`, "db");
    }

    // Agent memory notes — weekly consolidation of per-agent wisdom.
    try {
      const { pool } = await import("./db");
      await pool.query(`
        CREATE TABLE IF NOT EXISTS "agent_memory_notes" (
          "id" serial PRIMARY KEY,
          "agent_codename" text NOT NULL,
          "week_key" text NOT NULL,
          "patterns_learned" text NOT NULL,
          "wins" jsonb DEFAULT '[]'::jsonb,
          "losses" jsonb DEFAULT '[]'::jsonb,
          "self_recommendations" text,
          "decisions_analyzed" integer NOT NULL DEFAULT 0,
          "created_at" timestamp DEFAULT now() NOT NULL
        );
        CREATE INDEX IF NOT EXISTS "agent_memory_notes_agent_idx"
          ON "agent_memory_notes" ("agent_codename", "created_at");
        CREATE INDEX IF NOT EXISTS "agent_memory_notes_week_idx"
          ON "agent_memory_notes" ("week_key");
      `);
    } catch (err: any) {
      log(`agent_memory_notes bootstrap: ${err.message}`, "db");
    }

    // Provider lookup log — per-lookup telemetry feeding
    // intelligence-driven routing + founder cost/quality visibility.
    try {
      const { pool } = await import("./db");
      await pool.query(`
        CREATE TABLE IF NOT EXISTS "provider_lookup_log" (
          "id" serial PRIMARY KEY,
          "provider_name" text NOT NULL,
          "category" text NOT NULL,
          "input_type" text NOT NULL,
          "success" boolean NOT NULL,
          "cached" boolean NOT NULL DEFAULT false,
          "latency_ms" integer,
          "cost_cents" integer DEFAULT 0,
          "error_code" text,
          "organization_id" integer REFERENCES "organizations"("id") ON DELETE CASCADE,
          "created_at" timestamp DEFAULT now() NOT NULL
        );
        CREATE INDEX IF NOT EXISTS "provider_lookup_provider_idx"
          ON "provider_lookup_log" ("provider_name", "created_at");
        CREATE INDEX IF NOT EXISTS "provider_lookup_category_idx"
          ON "provider_lookup_log" ("category", "created_at");
        CREATE INDEX IF NOT EXISTS "provider_lookup_created_idx"
          ON "provider_lookup_log" ("created_at");
      `);
    } catch (err: any) {
      log(`provider_lookup_log bootstrap: ${err.message}`, "db");
    }

    // Decision experiments — A/B framework at decision-policy layer.
    try {
      const { pool } = await import("./db");
      await pool.query(`
        CREATE TABLE IF NOT EXISTS "decision_experiments" (
          "id" serial PRIMARY KEY,
          "name" text NOT NULL UNIQUE,
          "description" text NOT NULL,
          "category" text NOT NULL,
          "item_type" text,
          "variants" jsonb NOT NULL,
          "success_metric" text NOT NULL,
          "status" text NOT NULL DEFAULT 'draft',
          "winning_variant" text,
          "founder_notes" text,
          "started_at" timestamp,
          "ended_at" timestamp,
          "created_at" timestamp DEFAULT now() NOT NULL,
          "updated_at" timestamp DEFAULT now() NOT NULL
        );
        CREATE INDEX IF NOT EXISTS "decision_experiments_status_idx"
          ON "decision_experiments" ("status");
        CREATE INDEX IF NOT EXISTS "decision_experiments_category_idx"
          ON "decision_experiments" ("category");
        CREATE INDEX IF NOT EXISTS "decision_experiments_item_type_idx"
          ON "decision_experiments" ("item_type");
        CREATE TABLE IF NOT EXISTS "decision_experiment_assignments" (
          "id" serial PRIMARY KEY,
          "experiment_id" integer NOT NULL REFERENCES "decision_experiments"("id") ON DELETE CASCADE,
          "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
          "variant_key" text NOT NULL,
          "assigned_at" timestamp DEFAULT now() NOT NULL,
          "outcome_recorded" boolean NOT NULL DEFAULT false,
          "outcome_value" integer,
          "outcome_at" timestamp
        );
        CREATE UNIQUE INDEX IF NOT EXISTS "dea_experiment_org_unique"
          ON "decision_experiment_assignments" ("experiment_id", "organization_id");
        CREATE INDEX IF NOT EXISTS "dea_experiment_idx"
          ON "decision_experiment_assignments" ("experiment_id");
        CREATE INDEX IF NOT EXISTS "dea_variant_idx"
          ON "decision_experiment_assignments" ("variant_key");
      `);
    } catch (err: any) {
      log(`decision_experiments bootstrap: ${err.message}`, "db");
    }

    // Expansion candidates — weekly computed upsell-ready list.
    try {
      const { pool } = await import("./db");
      await pool.query(`
        CREATE TABLE IF NOT EXISTS "expansion_candidates" (
          "id" serial PRIMARY KEY,
          "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
          "week_key" text NOT NULL,
          "current_tier" text NOT NULL,
          "proposed_tier" text NOT NULL,
          "score" integer NOT NULL,
          "signals" jsonb NOT NULL,
          "reasoning" text NOT NULL,
          "estimated_mrr_lift_cents" integer,
          "status" text NOT NULL DEFAULT 'proposed',
          "founder_notes" text,
          "resolved_at" timestamp,
          "resolved_by" text,
          "created_at" timestamp DEFAULT now() NOT NULL
        );
        CREATE INDEX IF NOT EXISTS "expansion_candidates_week_idx"
          ON "expansion_candidates" ("week_key");
        CREATE INDEX IF NOT EXISTS "expansion_candidates_status_idx"
          ON "expansion_candidates" ("status");
        CREATE INDEX IF NOT EXISTS "expansion_candidates_org_idx"
          ON "expansion_candidates" ("organization_id");
        CREATE INDEX IF NOT EXISTS "expansion_candidates_score_idx"
          ON "expansion_candidates" ("score");
      `);
    } catch (err: any) {
      log(`expansion_candidates bootstrap: ${err.message}`, "db");
    }

    // Onboarding journeys + steps — Sophie's 30-day scripted
    // activation sequence for every new Land Investor org.
    try {
      const { pool } = await import("./db");
      await pool.query(`
        CREATE TABLE IF NOT EXISTS "onboarding_journeys" (
          "id" serial PRIMARY KEY,
          "organization_id" integer NOT NULL UNIQUE REFERENCES "organizations"("id") ON DELETE CASCADE,
          "started_at" timestamp DEFAULT now() NOT NULL,
          "current_step_key" text NOT NULL DEFAULT 'day0_welcome',
          "activation_status" text NOT NULL DEFAULT 'pending',
          "activation_determined_at" timestamp,
          "first_deal_at" timestamp,
          "first_lead_added_at" timestamp,
          "founder_flag" text,
          "notes" jsonb DEFAULT '{}'::jsonb,
          "created_at" timestamp DEFAULT now() NOT NULL,
          "updated_at" timestamp DEFAULT now() NOT NULL
        );
        CREATE INDEX IF NOT EXISTS "onboarding_journeys_status_idx"
          ON "onboarding_journeys" ("activation_status");
        CREATE INDEX IF NOT EXISTS "onboarding_journeys_started_at_idx"
          ON "onboarding_journeys" ("started_at");
        CREATE TABLE IF NOT EXISTS "onboarding_steps" (
          "id" serial PRIMARY KEY,
          "journey_id" integer NOT NULL REFERENCES "onboarding_journeys"("id") ON DELETE CASCADE,
          "step_key" text NOT NULL,
          "scheduled_at" timestamp NOT NULL,
          "fired_at" timestamp,
          "status" text NOT NULL DEFAULT 'scheduled',
          "outcome" jsonb DEFAULT '{}'::jsonb,
          "created_at" timestamp DEFAULT now() NOT NULL
        );
        CREATE INDEX IF NOT EXISTS "onboarding_steps_journey_idx"
          ON "onboarding_steps" ("journey_id");
        CREATE INDEX IF NOT EXISTS "onboarding_steps_scheduled_at_idx"
          ON "onboarding_steps" ("scheduled_at");
        CREATE INDEX IF NOT EXISTS "onboarding_steps_status_idx"
          ON "onboarding_steps" ("status");
      `);
    } catch (err: any) {
      log(`onboarding bootstrap: ${err.message}`, "db");
    }

    // Customer letters — per-org monthly narrative mirroring the
    // founder letter. Written in Sophie's voice.
    try {
      const { pool } = await import("./db");
      await pool.query(`
        CREATE TABLE IF NOT EXISTS "customer_letters" (
          "id" serial PRIMARY KEY,
          "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
          "month_key" text NOT NULL,
          "letter_markdown" text NOT NULL,
          "summary_json" jsonb NOT NULL,
          "recommended_action" text,
          "generated_at" timestamp DEFAULT now() NOT NULL,
          "delivered_at" timestamp,
          "opened_at" timestamp,
          "status" text NOT NULL DEFAULT 'draft'
        );
        CREATE INDEX IF NOT EXISTS "customer_letters_org_month_idx"
          ON "customer_letters" ("organization_id", "month_key");
        CREATE INDEX IF NOT EXISTS "customer_letters_status_idx"
          ON "customer_letters" ("status");
      `);
    } catch (err: any) {
      log(`customer_letters bootstrap: ${err.message}`, "db");
    }

    // Tool proposals — integrations / data sources / capabilities
    // agents have requested. Founder-gated.
    try {
      const { pool } = await import("./db");
      await pool.query(`
        CREATE TABLE IF NOT EXISTS "tool_proposals" (
          "id" serial PRIMARY KEY,
          "proposed_by" text NOT NULL,
          "title" text NOT NULL,
          "description" text NOT NULL,
          "category" text NOT NULL,
          "capability_gap" text NOT NULL,
          "expected_benefit" text NOT NULL,
          "estimated_complexity" text NOT NULL DEFAULT 'medium',
          "estimated_impact_cents" integer,
          "supporting_evidence" jsonb,
          "status" text NOT NULL DEFAULT 'proposed',
          "founder_notes" text,
          "resolved_at" timestamp,
          "resolved_by" text,
          "created_at" timestamp DEFAULT now() NOT NULL
        );
        CREATE INDEX IF NOT EXISTS "tool_proposals_status_idx"
          ON "tool_proposals" ("status");
        CREATE INDEX IF NOT EXISTS "tool_proposals_category_idx"
          ON "tool_proposals" ("category");
        CREATE INDEX IF NOT EXISTS "tool_proposals_proposed_by_idx"
          ON "tool_proposals" ("proposed_by");
      `);
    } catch (err: any) {
      log(`tool_proposals bootstrap: ${err.message}`, "db");
    }

    // Action previews — audit trail of every auto-approved action,
    // plus an optional cancel-before-commit window (founder-tunable
    // via ACTION_PREVIEW_WINDOW_SECONDS).
    try {
      const { pool } = await import("./db");
      await pool.query(`
        CREATE TABLE IF NOT EXISTS "action_previews" (
          "id" serial PRIMARY KEY,
          "decision_id" integer,
          "agent_codename" text NOT NULL,
          "item_type" text NOT NULL,
          "action_summary" text NOT NULL,
          "action_reasoning" text,
          "action_payload" jsonb,
          "estimated_impact_cents" integer,
          "confidence" integer,
          "planned_at" timestamp DEFAULT now() NOT NULL,
          "commit_at" timestamp NOT NULL,
          "committed_at" timestamp,
          "cancelled_at" timestamp,
          "cancelled_by" text,
          "cancel_reason" text,
          "status" text NOT NULL DEFAULT 'pending',
          "execution_result" text
        );
        CREATE INDEX IF NOT EXISTS "action_previews_status_idx"
          ON "action_previews" ("status");
        CREATE INDEX IF NOT EXISTS "action_previews_commit_at_idx"
          ON "action_previews" ("commit_at");
        CREATE INDEX IF NOT EXISTS "action_previews_decision_idx"
          ON "action_previews" ("decision_id");
        CREATE INDEX IF NOT EXISTS "action_previews_agent_idx"
          ON "action_previews" ("agent_codename");
      `);
    } catch (err: any) {
      log(`action_previews bootstrap: ${err.message}`, "db");
    }

    // Founder settings — key-value operational knobs (hard cap,
    // thresholds, TTLs) editable from /founder/settings.
    try {
      const { pool } = await import("./db");
      await pool.query(`
        CREATE TABLE IF NOT EXISTS "founder_settings" (
          "id" serial PRIMARY KEY,
          "key" text NOT NULL UNIQUE,
          "value" text NOT NULL,
          "value_type" text NOT NULL DEFAULT 'string',
          "description" text,
          "category" text NOT NULL DEFAULT 'general',
          "updated_at" timestamp DEFAULT now() NOT NULL,
          "updated_by" text
        );
        CREATE INDEX IF NOT EXISTS "founder_settings_key_idx"
          ON "founder_settings" ("key");
        CREATE INDEX IF NOT EXISTS "founder_settings_category_idx"
          ON "founder_settings" ("category");
      `);
    } catch (err: any) {
      log(`founder_settings bootstrap: ${err.message}`, "db");
    }

    // Strategic proposals — weekly per-agent proposals + monthly synthesis
    // feeding the founder letter's Next Month's Focus section.
    try {
      const { pool } = await import("./db");
      await pool.query(`
        CREATE TABLE IF NOT EXISTS "strategic_proposals" (
          "id" serial PRIMARY KEY,
          "proposed_by" text NOT NULL,
          "week_key" text NOT NULL,
          "month_key" text,
          "title" text NOT NULL,
          "rationale" text NOT NULL,
          "estimated_impact_cents" integer,
          "confidence" integer NOT NULL DEFAULT 50,
          "category" text NOT NULL,
          "supporting_data_keys" jsonb DEFAULT '[]'::jsonb,
          "status" text NOT NULL DEFAULT 'proposed',
          "founder_feedback" text,
          "resolved_at" timestamp,
          "resolved_by" text,
          "created_at" timestamp DEFAULT now() NOT NULL
        );
        CREATE INDEX IF NOT EXISTS "strategic_proposals_week_idx"
          ON "strategic_proposals" ("week_key");
        CREATE INDEX IF NOT EXISTS "strategic_proposals_month_idx"
          ON "strategic_proposals" ("month_key");
        CREATE INDEX IF NOT EXISTS "strategic_proposals_status_idx"
          ON "strategic_proposals" ("status");
        CREATE INDEX IF NOT EXISTS "strategic_proposals_proposed_by_idx"
          ON "strategic_proposals" ("proposed_by");
      `);
    } catch (err: any) {
      log(`strategic_proposals bootstrap: ${err.message}`, "db");
    }
  }

  await initStripe();
  
  // ── MCP HTTP endpoint (stateless StreamableHTTP transport) ───────────────
  // Accessible at POST /mcp — Claude Desktop or any MCP client can connect here.
  // Auth: requires Bearer token matching MCP_API_KEY env var.
  const mcpServer = createMcpServer();

  const mcpAuthMiddleware = (req: Request, res: Response, next: NextFunction) => {
    const mcpApiKey = process.env.MCP_API_KEY;
    if (!mcpApiKey) {
      // Not configured — block all access until key is set
      res.status(503).json({ error: "MCP endpoint not configured. Set MCP_API_KEY." });
      return;
    }
    const authHeader = req.headers["authorization"] ?? "";
    const provided = Array.isArray(authHeader) ? authHeader[0] : authHeader;
    if (provided !== `Bearer ${mcpApiKey}`) {
      res.status(401).json({ error: "Invalid or missing MCP API key." });
      return;
    }
    next();
  };

  app.post("/mcp", mcpAuthMiddleware, async (req, res) => {
    try {
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });
  app.get("/mcp", mcpAuthMiddleware, (_req, res) => {
    res.json({
      name: "AcreOS MCP Server",
      version: "1.0.0",
      transport: "StreamableHTTP",
      endpoint: "/mcp",
      tools: [
        "get_flood_zone", "get_wetlands", "get_soil_data", "get_demographics",
        "get_public_lands", "get_natural_hazards", "get_infrastructure",
        "get_transportation", "get_water_resources", "get_elevation", "get_climate",
        "get_agricultural_values", "get_land_cover", "enrich_property",
        "reverse_geocode", "geocode_address", "get_epa_data",
        "search_properties", "get_property", "search_leads", "get_deals",
        "get_portfolio_summary",
        "get_cropland", "get_epa_facilities", "get_storm_history",
        "get_plss", "get_watershed", "get_fema_nri", "get_usda_clu",
      ],
      description: "29 tools exposing AcreOS property intelligence and free public land data APIs",
    });
  });

  // Task #F-A05-2: CSP violation reporting endpoint — accepts browser reports, logs + ignores
  app.post("/api/csp-report", express.json({ type: ["application/json", "application/csp-report"] }), (req, res) => {
    const report = req.body?.["csp-report"] ?? req.body;
    logger.warn("CSP violation", { source: "csp", metadata: { report } });
    res.status(204).end();
  });

  // Task #305: /.well-known/security.txt — disclose vulnerability reporting channel
  app.get("/.well-known/security.txt", (_req, res) => {
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.send([
      "Contact: mailto:security@acreos.com",
      "Expires: 2027-03-18T00:00:00.000Z",
      "Preferred-Languages: en",
      "Canonical: https://acreos.fly.dev/.well-known/security.txt",
      "Policy: https://acreos.fly.dev/terms",
    ].join("\n") + "\n");
  });

  // Prometheus scrape endpoint — serves collected metrics in text exposition format
  app.get("/metrics", metricsHandler);

  // Initialize distributed tracing before routes so Express instrumentation captures all routes
  try {
    await initTracing();
  } catch (e) {
    logger.warn(`[startup] Tracing init skipped: ${(e as Error).message}`);
  }

  // Load founder-configured credentials from DB into process.env (non-fatal if DB not ready)
  try {
    const { loadConfigToEnv } = await import("./services/configManager");
    await loadConfigToEnv();
  } catch (e) {
    logger.warn(`[startup] configManager load skipped: ${(e as Error).message}`);
  }

  await registerRoutes(httpServer, app);

  app.use(errorLoggingMiddleware);

  // Sentry error handler — must come before the generic error handler
  if (process.env.SENTRY_DSN) {
    app.use(Sentry.expressErrorHandler());
  }

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    // Don't leak internal error details in production
    const message = status >= 500 && process.env.NODE_ENV === "production"
      ? "Internal Server Error"
      : err.message || "Internal Server Error";

    if (!res.headersSent) {
      res.status(status).json({ message });
    }
  });

  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);

      // Gate all background jobs behind env flag — they exhaust the DB pool on small instances
      if (process.env.DISABLE_BACKGROUND_JOBS === "1") {
        log("Background jobs DISABLED (DISABLE_BACKGROUND_JOBS=1)", "startup");
      } else {

      // Start lead nurturing background job (every 15 minutes)
      startLeadNurturingJob();
      
      // Start campaign optimization background job (every hour)
      startCampaignOptimizationJob();
      
      // Start finance agent background job (every 30 minutes)
      startFinanceAgentJob();

      // Lavender Week 10 — recognition worker (deferred-revenue
      // amortisation). Self-rescheduling, hourly cadence.
      void import('./services/recognitionWorker').then(({ startRecognitionWorker }) => {
        startRecognitionWorker();
      });
      
      // Start API queue background job (every 10 seconds)
      startApiQueueJob();
      
      // Start alerting background job (every hour)
      startAlertingJob();
      
      // Start digest background job (every 6 hours)
      startDigestJob();
      
      // Start sequence processor background job (every 60 seconds)
      startSequenceProcessorJob();

      // Start autonomous agent task processor (every 30 seconds)
      import('./jobs/autonomousTaskProcessor').then(({ startAutonomousTaskProcessor }) => {
        startAutonomousTaskProcessor();
      }).catch(err => logger.warn('[startup] autonomousTaskProcessor failed to start', err instanceof Error ? err : undefined));

      // Start scheduled task runner background job (every minute)
      startScheduledTaskRunnerJob();

      // Start Pax scheduled tasks (every minute)
      startPaxSchedulerJob();

      // Start Pax nudges (every 6 hours)
      startPaxNudgesJob();

      // Start job queue worker (every 10 seconds)
      startJobQueueWorker();
      
      // Start deal hunter background jobs
      startDealHunterScrapingJob();
      startDistressRecalculationJob();

      // EPIC 1: County Assessor ingest pipeline (nightly at 11 PM UTC)
      startCountyAssessorIngestJob();

      // EPIC 2: Autonomous Deal Machine (nightly at 1 AM UTC)
      startAutonomousDealMachineJob();

      // Autonomous Health Monitor (hourly self-healing + cost guard)
      startAutonomousHealthMonitorJob();

      // Founder Weekly Digest (Mondays 8 AM CT)
      startFounderWeeklyDigestJob();

      // Customer Concentration (daily 13:00 UTC) — MRR concentration alerts
      startCustomerConcentrationJob();

      // Lavender Week 12: Per-customer unit economics (daily, self-rescheduling)
      startCustomerUnitEconomicsJob();

      // Autonomous Decision Executor (every 30 minutes — auto-processes founder inbox)
      startAutonomousDecisionExecutorJob();

      // Growth Automation Engine (every 6 hours — upsell, win-back, referrals, re-engagement)
      startGrowthAutomationJob();

      // Start voice learning profile refresh job (every 12 hours)
      startVoiceLearningRefreshJob();

      // Start real-time alert sync job (every 5 minutes)
      startRealtimeAlertSyncJob();

      // Sovereign Company Protocol — seed AI agent personas and register briefing jobs
      seedCompanyAgentsOnStartup();
      startCompanyBriefingJob();
      startTrustEvolutionJob();
      startAgentReactionProcessorJob();
      startAgentProactiveEngineJob();
      startV5MaintenanceJob();

      // Autonomy Health — grade recent decision outcomes daily so the
      // learning loop closes (agent trust + autonomy health signal both
      // depend on outcomeScore being populated).
      startAutonomyOutcomeGraderJob();

      // Monthly prompt-evolution meta-agent — reads 30d of per-agent
      // performance data and proposes prompt revisions for founder
      // review. Proposals land in agentPromptEvolutions with status
      // 'proposed'; live prompts are only mutated after explicit
      // founder approval.
      startPromptEvolutionJob();

      // Monthly founder letter — one-page narrative synthesizing the
      // month's decisions, outcomes, and one thing the founder needs
      // to weigh in on. Primary surface for the 1-hour/month goal.
      startFounderLetterJob();

      // Strategic proposals — weekly per-agent proposal generation
      // (Sunday 00:00 UTC) + monthly synthesis pass (1st 10:00 UTC,
      // 2h before the founder letter generates). The synthesized
      // proposals feed the letter's "Next month's focus" section.
      startStrategicProposalsJobs();

      // Action-preview sweeper — hourly; marks orphaned pending
      // previews (commitAt passed + 1h) as 'failed' so they don't
      // misleadingly show up in /founder/preview.
      startActionPreviewSweeperJob();

      // Customer monthly letters — per-org narrative from Sophie.
      // Fires on the 1st at 15:00 UTC (3h after the founder letter
      // at 12:00 UTC) so the customer wave is not in the same burst.
      startCustomerLetterJob();

      // Onboarding journeys — hourly sweeper fires any due step for
      // any org walking the 30-day activation sequence. Each step is
      // pre-scheduled at journey-start time; this just picks up the
      // ones whose scheduledAt has passed.
      startOnboardingSweeperJob();

      // Expansion radar — weekly (Monday 08:00 UTC) scan of active
      // orgs for upsell readiness. Top 5 surface for founder review.
      startExpansionRadarJob();

      // Agent memory consolidation — weekly (Sunday 23:00 UTC, the
      // last cron of the ISO week). Distills each agent's week into
      // a memory note that Company Mind then injects into future
      // decision prompts.
      startAgentMemoryConsolidationJob();

      // Experiment auto-completion — weekly (Monday 09:00 UTC, 1h
      // after expansion radar). Auto-ends decisively-won experiments
      // and files a promotion proposal in the decisions inbox.
      startExperimentSweepJob();

      // Phase 3 Week 14 (Sayuri-Vatanen) — pgvector embedding refresh
      // job. Sweeps deal_patterns for embeddings older than 7 days
      // and regenerates them on a rolling cadence so retrieval stays
      // aligned with whatever the current model produces.
      import("./jobs/embeddingRefresh").then(({ startEmbeddingRefreshJob }) => {
        startEmbeddingRefreshJob();
        log("Embedding refresh job registered (self-rescheduling, 6m, rolling 7d)", "embedding-refresh");
      }).catch(err => {
        log(`Failed to start embedding refresh job: ${err}`, "embedding-refresh");
      });

      // Auto-seed county GIS endpoints for free parcel lookups
      seedCountyGisEndpointsOnStartup();
      
      // Start periodic health checks
      import("./services/healthCheck").then(({ healthCheckService }) => {
        healthCheckService.startPeriodicChecks(60000); // Check every minute
      });
      
      // Start external service status monitoring (Stripe, Twilio, Lob, Regrid)
      import("./services/externalStatusMonitor").then(({ externalStatusMonitor }) => {
        externalStatusMonitor.startPeriodicMonitoring(5 * 60 * 1000); // Check every 5 minutes
        log("External service status monitoring started (every 5 minutes)", "external-monitor");
      }).catch(err => {
        log(`Failed to start external status monitoring: ${err}`, "external-monitor");
      });

      // Passive Command Center: Revenue Protection (every 6h) + Founder Digest (daily at 8 AM CST)
      import("./services/revenueProtection").then(({ startRevenueProtectionJob }) => {
        startRevenueProtectionJob(withJobLock).catch((err: any) => {
          log(`Revenue protection job failed: ${err}`, "revenue-protection");
        });
        log("Revenue protection job registered (every 6h, 3-min startup delay)", "revenue-protection");
      }).catch(err => {
        log(`Failed to start revenue protection job: ${err}`, "revenue-protection");
      });

      import("./services/founderDigest").then(({ startFounderDigestJob }) => {
        startFounderDigestJob(withJobLock).catch((err: any) => {
          log(`Founder digest job error: ${err}`, "founder-digest");
        });
        log("Founder digest job registered (hourly check, sends at 8 AM CST)", "founder-digest");
      }).catch(err => {
        log(`Failed to start founder digest job: ${err}`, "founder-digest");
      });

      // ─── Phase B: Event Mesh Drain (every 10 seconds) ──────────────────
      import("./services/eventMeshDrain").then(({ eventMeshDrain }) => {
        // Initialize subscribers first, then start drain loop
        eventMeshDrain.initialize().then(() => {
          log("Event mesh drain initialized — draining every 10s", "event-mesh");
          trackInterval(() => {
            eventMeshDrain.drain().catch((err: any) => {
              log(`Event mesh drain error: ${err}`, "event-mesh");
            });
          }, 10_000);
        }).catch((err: any) => {
          log(`Event mesh drain init failed: ${err}`, "event-mesh");
        });
      }).catch(err => {
        log(`Failed to import event mesh drain: ${err}`, "event-mesh");
      });

      // ─── Final Mile: Daily Summary, Delegation Check, Retry Queue, Consensus Exec ──
      import("./services/autonomyFinalMile").then(({
        generateDailyAutonomousSummary,
        checkDelegationCompletions,
        retryFailedActions,
        executeResolvedConsensus,
      }) => {
        // Daily autonomous summary at 7 AM UTC (2 AM CT)
        trackInterval(() => {
          const now = new Date();
          if (now.getUTCHours() === 7 && now.getUTCMinutes() < 5) {
            withJobLock("daily_autonomous_summary", 55 * 60, generateDailyAutonomousSummary)
              .catch((err: any) => log(`Daily summary failed: ${err}`, "autonomy"));
          }
        }, 5 * 60 * 1000);

        // Delegation auto-completion check (every 15 minutes)
        trackInterval(() => {
          checkDelegationCompletions().catch(() => {});
        }, 15 * 60 * 1000);

        // Retry failed actions (every 30 minutes)
        trackInterval(() => {
          retryFailedActions().catch(() => {});
        }, 30 * 60 * 1000);

        // Consensus auto-execution (every 5 minutes)
        trackInterval(() => {
          executeResolvedConsensus().catch(() => {});
        }, 5 * 60 * 1000);

        log("Final mile autonomy jobs registered (summary/delegation/retry/consensus)", "autonomy");
      }).catch(err => {
        log(`Failed to import final mile: ${err}`, "autonomy");
      });

      // ─── Weekly Alert Digest (Sundays at 9 AM UTC / 4 AM CT) ──
      import("./services/alertPolicy").then(({ alertPolicyService }) => {
        log("Alert policy weekly digest registered (Sundays 9am UTC)", "alert-policy");
        trackInterval(() => {
          const now = new Date();
          if (now.getUTCDay() === 0 && now.getUTCHours() === 9 && now.getUTCMinutes() < 5) {
            withJobLock("weekly_alert_digest", 55 * 60, () => alertPolicyService.sendWeeklyDigest())
              .catch((err: any) => log(`Weekly digest failed: ${err}`, "alert-policy"));
          }
        }, 5 * 60 * 1000);
      }).catch(err => {
        log(`Failed to import alert policy: ${err}`, "alert-policy");
      });

      // ─── Dunning Scheduled Tasks (every 6 hours) ──
      // P0 #1 — Migrated to scheduleSelfRescheduling (Phase 3 Week 7-8).
      // Self-rescheduling guarantees no concurrent overlap, on-failure backoff,
      // DLQ on terminal failure, and a job_runs row per execution.
      import("./services/dunning").then(({ dunningService }) => {
        import("./jobs/scheduler").then(({ scheduleSelfRescheduling }) => {
          log("Dunning task processor registered (self-rescheduling, 6h)", "dunning");
          scheduleSelfRescheduling({
            name: "dunning_tasks",
            intervalMs: 6 * 60 * 60 * 1000,
            initialDelayMs: 2 * 60 * 1000,
            run: async () => {
              await withJobLock("dunning_tasks", 55 * 60, () =>
                dunningService.processScheduledTasks(),
              );
            },
          });
        });
      }).catch(err => {
        log(`Failed to import dunning service: ${err}`, "dunning");
      });

      // ─── Autonomy Bootstrap: seed chains, playbooks, modes, memories, strategies ──
      import("./services/autonomyBootstrap").then(({ bootstrapAutonomy }) => {
        // Delay bootstrap by 30s to ensure DB migrations are complete
        setTimeout(() => {
          bootstrapAutonomy().catch((err: any) => {
            log(`Autonomy bootstrap failed: ${err}`, "autonomy");
          });
        }, 30_000);
      }).catch(err => {
        log(`Failed to import autonomy bootstrap: ${err}`, "autonomy");
      });

      // ─── Agent Initiative Engine (every 30 minutes) ──
      import("./services/agentInitiativeEngine").then(({ agentInitiativeEngine }) => {
        log("Agent initiative engine registered (every 30m)", "initiative");
        // Run after 5-minute startup delay, then every 30 minutes
        setTimeout(() => {
          // Get any org for initiative scanning (use org 1 as default)
          agentInitiativeEngine.runInitiativeCycle(1).catch(() => {});
          trackInterval(() => {
            agentInitiativeEngine.runInitiativeCycle(1).catch((err: any) => {
              log(`Initiative cycle failed: ${err}`, "initiative");
            });
          }, 30 * 60 * 1000);
        }, 5 * 60 * 1000);
      }).catch(err => {
        log(`Failed to import initiative engine: ${err}`, "initiative");
      });

      // ─── Outcome Verification Loop (daily at 2 AM UTC) ──
      import("./services/outcomeVerificationLoop").then(({ outcomeVerificationLoop }) => {
        log("Outcome verification loop registered (daily 2am UTC)", "outcome-verify");
        trackInterval(() => {
          const now = new Date();
          if (now.getUTCHours() === 2 && now.getUTCMinutes() < 5) {
            withJobLock("outcome_verification", 55 * 60, async () => {
              return outcomeVerificationLoop.verify(1);
            }).catch((err: any) => {
              log(`Outcome verification failed: ${err}`, "outcome-verify");
            });
          }
        }, 5 * 60 * 1000); // Check every 5 minutes
      }).catch(err => {
        log(`Failed to import outcome verification: ${err}`, "outcome-verify");
      });

      // Daily job health log cleanup (delete rows older than 30 days)
      const runJobHealthCleanup = async () => {
        try {
          const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
          await db.delete(jobHealthLogs).where(lt(jobHealthLogs.createdAt, cutoff));
        } catch (err) {
          log(`Job health log cleanup failed: ${err}`, "job-health-cleanup");
        }
      };
      // Run once at startup, then daily
      runJobHealthCleanup();
      trackInterval(runJobHealthCleanup, 24 * 60 * 60 * 1000);

      // Task #data-retention: Agent events log cleanup (delete rows older than 90 days)
      // agent_events accumulates AI action logs — keep 90 days for audit, discard older rows.
      const runAgentEventsCleanup = async () => {
        try {
          const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
          await db.delete(agentEvents).where(lt(agentEvents.createdAt, cutoff));
        } catch (err) {
          log(`Agent events cleanup failed: ${err}`, "agent-events-cleanup");
        }
      };
      runAgentEventsCleanup();
      trackInterval(runAgentEventsCleanup, 24 * 60 * 60 * 1000);

      } // end DISABLE_BACKGROUND_JOBS gate

      // Task #201: Graceful shutdown — drain open connections and checkpoint jobs
      // Fly.io sends SIGTERM before replacing an instance. We close the HTTP server
      // so no new connections are accepted, then wait briefly for in-flight requests
      // to complete before exiting.
      const gracefulShutdown = (signal: string) => {
        log(`Received ${signal} — beginning graceful shutdown`, "shutdown");

        // Clear all background job intervals to stop new work
        for (const handle of (globalThis as any).__bgIntervals || []) {
          clearInterval(handle);
        }
        log(`Cleared ${((globalThis as any).__bgIntervals || []).length} background intervals`, "shutdown");

        httpServer.close((err) => {
          if (err) {
            log(`HTTP server close error: ${err}`, "shutdown");
          } else {
            log("HTTP server closed — all connections drained", "shutdown");
          }
          // Drain database connection pools before exiting
          const { pool, replicaPool } = require("./db");
          Promise.allSettled([pool.end(), replicaPool.end()]).then(() => {
            log("Database pools drained", "shutdown");
          }).catch(() => {});

          // Give in-flight work 5 seconds to complete
          setTimeout(() => {
            log("Graceful shutdown complete", "shutdown");
            process.exit(0);
          }, 5000);
        });

        // Force-exit after 30 seconds to prevent hanging
        setTimeout(() => {
          log("Force exiting after 30s shutdown timeout", "shutdown");
          process.exit(1);
        }, 30000).unref();
      };

      process.once("SIGTERM", () => gracefulShutdown("SIGTERM"));
      process.once("SIGINT", () => gracefulShutdown("SIGINT"));

      // trackInterval is defined at module scope — all jobs already use it

      if (process.env.DISABLE_BACKGROUND_JOBS !== "1") {
        // Job supervisor: check every 2 minutes for stalled jobs
        trackInterval(() => { jobSupervisor.checkHealth(); }, 2 * 60 * 1000);
        log("Job supervisor health monitoring started (every 2 minutes)", "supervisor");

        // Churn risk engine: score all paying orgs daily at 6am
        startChurnEngineJob();

        // Founder daily briefing email at 7am
        startFounderBriefingJob();

        // Outcome analyzer: close the feedback loop nightly (2am)
        startOutcomeAnalyzerJob();

        // ── Self-Evolution Engine jobs ──────────────────────────────────────
        // Telemetry optimizer: nightly model routing optimization (3am)
        startTelemetryOptimizerJob();

        // Model intelligence: weekly OpenRouter catalog sync + benchmarks (Sunday 4am)
        startModelIntelligenceJob();

        // Self-assessment agent: weekly gap analysis + tech watch (Sunday 3am)
        startSelfAssessmentJob();

        // Evolution pipeline: process pending proposals (runs every 6 hours, deploys at 3-5am)
        startEvolutionPipelineJob();

        // Data retention: nightly purge of expired rows (3:30am UTC)
        startDataRetentionJob();
      }
    },
  );
})().catch((err) => {
  logger.error("[startup] Fatal error during server initialization", err instanceof Error ? err : undefined);
  if (err instanceof Error) {
    logger.error(`  Name: ${err.name}`);
    logger.error(`  Message: ${err.message}`);
    logger.error(`  Stack: ${err.stack}`);
  } else {
    logger.error(`  Type: ${typeof err}`);
    logger.error(`  Value: ${JSON.stringify(err, null, 2)}`);
    logger.error(`  String: ${String(err)}`);
    try { logger.error(`  Keys: ${Object.keys(err)}`); } catch {}
  }
  process.exit(1);
});

// Auto-seed county GIS endpoints on startup
async function seedCountyGisEndpointsOnStartup() {
  try {
    const { seedCountyGisEndpoints } = await import('./services/parcel');
    const result = await seedCountyGisEndpoints();
    if (result.added > 0) {
      log(`Seeded ${result.added} county GIS endpoints (${result.skipped} already existed)`, 'parcel');
    }
  } catch (err) {
    log(`Failed to seed county GIS endpoints: ${err}`, 'parcel');
  }
}

// Lead nurturing background job
async function processLeadNurturing() {
  try {
    const activeOrgs = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(sql`${organizations.subscriptionStatus} = 'active'`)
      .limit(100);
    
    for (const org of activeOrgs) {
      try {
        const result = await leadNurturerService.processLeadsForOrg(org.id, {
          scoringLimit: 20,
          generateFollowUps: false,
        });
        
        if (result.scored > 0 || result.errors.length > 0) {
          log(`Lead nurturing for org ${org.id}: scored=${result.scored}, errors=${result.errors.length}`, 'nurturing');
        }
      } catch (err) {
        log(`Lead nurturing error for org ${org.id}: ${err}`, 'nurturing');
      }
    }
  } catch (err) {
    log(`Lead nurturing job error: ${err}`, 'nurturing');
  }
}

function startLeadNurturingJob() {
  const FIFTEEN_MINUTES = 15 * 60 * 1000;
  const TTL_SECONDS = 14 * 60; // Lock TTL slightly less than interval
  
  log('Starting lead nurturing background job (every 15 minutes)', 'nurturing');
  
  // Run immediately on startup after a short delay
  setTimeout(() => {
    withJobLock('lead_nurturing', TTL_SECONDS, processLeadNurturing).catch(err => {
      log(`Initial lead nurturing run failed: ${err}`, 'nurturing');
    });
  }, 30000); // Wait 30 seconds after startup
  
  // Then run every 15 minutes
  trackInterval(() => {
    withJobLock('lead_nurturing', TTL_SECONDS, processLeadNurturing).catch(err => {
      log(`Scheduled lead nurturing run failed: ${err}`, 'nurturing');
    });
  }, FIFTEEN_MINUTES);
}

// Campaign optimization background job
async function processCampaignOptimizations() {
  try {
    const { campaignOptimizerService } = await import("./services/campaignOptimizer");
    
    const activeOrgs = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(sql`${organizations.subscriptionStatus} = 'active'`)
      .limit(100);
    
    for (const org of activeOrgs) {
      try {
        const result = await campaignOptimizerService.processOrganizationCampaigns(org.id, {
          limit: 3,
        });
        
        if (result.processed > 0 || result.errors.length > 0) {
          log(`Campaign optimization for org ${org.id}: processed=${result.processed}, suggestions=${result.totalSuggestions}, errors=${result.errors.length}`, 'optimizer');
        }
      } catch (err) {
        log(`Campaign optimization error for org ${org.id}: ${err}`, 'optimizer');
      }
    }
  } catch (err) {
    log(`Campaign optimization job error: ${err}`, 'optimizer');
    jobSupervisor.notifyResult('campaign_optimizer', 60 * 60 * 1000, false, undefined, String(err));
    return;
  }
  jobSupervisor.notifyResult('campaign_optimizer', 60 * 60 * 1000, true);
}

function startCampaignOptimizationJob() {
  const ONE_HOUR = 60 * 60 * 1000;
  const TTL_SECONDS = 55 * 60; // Lock TTL slightly less than interval
  
  log('Starting campaign optimization background job (every hour)', 'optimizer');
  
  // Run after a short delay on startup
  setTimeout(() => {
    withJobLock('campaign_optimizer', TTL_SECONDS, processCampaignOptimizations).catch(err => {
      log(`Initial campaign optimization run failed: ${err}`, 'optimizer');
    });
  }, 60000); // Wait 1 minute after startup
  
  // Then run every hour
  trackInterval(() => {
    withJobLock('campaign_optimizer', TTL_SECONDS, processCampaignOptimizations).catch(err => {
      log(`Scheduled campaign optimization run failed: ${err}`, 'optimizer');
    });
  }, ONE_HOUR);
}

// Finance agent background job for delinquency detection and payment reminders
async function processFinanceAgent() {
  try {
    const { financeAgentService } = await import("./services/financeAgent");
    
    const result = await financeAgentService.runFinanceAgentJob();
    
    if (result.totalNotes > 0 || result.remindersSent > 0 || result.errors.length > 0) {
      log(`Finance agent: orgs=${result.orgsProcessed}, notes=${result.totalNotes}, sent=${result.remindersSent}, scheduled=${result.remindersScheduled}, errors=${result.errors.length}`, 'finance');
    }
    jobSupervisor.notifyResult('finance_agent', 30 * 60 * 1000, true);
  } catch (err) {
    log(`Finance agent job error: ${err}`, 'finance');
    jobSupervisor.notifyResult('finance_agent', 30 * 60 * 1000, false, undefined, String(err));
  }
}

function startFinanceAgentJob() {
  const THIRTY_MINUTES = 30 * 60 * 1000;
  const TTL_SECONDS = 25 * 60; // Lock TTL slightly less than interval

  // P0 #5 — Finance agent (delinquency detection + payment reminders)
  // migrated to scheduleSelfRescheduling (Phase 3 Week 7-8). Previously a
  // setInterval that could overlap a long-running run; the new helper
  // awaits each run before scheduling the next, plus DLQ + job_runs.
  log('Starting finance agent background job (self-rescheduling, 30m)', 'finance');

  import('./jobs/scheduler').then(({ scheduleSelfRescheduling }) => {
    scheduleSelfRescheduling({
      name: "finance_agent",
      intervalMs: THIRTY_MINUTES,
      initialDelayMs: 45_000,
      run: async () => {
        await withJobLock('finance_agent', TTL_SECONDS, processFinanceAgent);
      },
    });
  });
}

// API Queue background job
async function processApiQueue() {
  try {
    const { apiQueueService } = await import('./services/apiQueue');
    const result = await apiQueueService.processQueue();
    
    if (result.processed > 0 || result.failed > 0) {
      log(`API queue: processed=${result.processed}, failed=${result.failed}`, 'queue');
    }
    
    // Cleanup old completed jobs weekly
    if (new Date().getDay() === 0) {
      await apiQueueService.cleanupOldJobs(7);
    }
  } catch (err) {
    log(`API queue job error: ${err}`, 'queue');
  }
}

function startApiQueueJob() {
  const TEN_SECONDS = 10 * 1000;
  const TTL_SECONDS = 9; // Lock TTL slightly less than interval
  
  log('Starting API queue background job (every 10 seconds)', 'queue');
  
  trackInterval(() => {
    withJobLock('api_queue', TTL_SECONDS, processApiQueue).catch(err => {
      log(`API queue run failed: ${err}`, 'queue');
    });
  }, TEN_SECONDS);
}

// Alerting background job
async function processAlerts() {
  try {
    const { alertingService } = await import('./services/alerting');
    const result = await alertingService.runDailyAlertCheck();
    
    if (result.alertsCreated > 0) {
      log(`Alerting: checked=${result.checked}, created=${result.alertsCreated}`, 'alerting');
    }
  } catch (err) {
    log(`Alerting job error: ${err}`, 'alerting');
  }
}

function startAlertingJob() {
  const ONE_HOUR = 60 * 60 * 1000;
  const TTL_SECONDS = 55 * 60; // Lock TTL slightly less than interval
  
  log('Starting alerting background job (every hour)', 'alerting');
  
  // Run after startup delay
  setTimeout(() => {
    withJobLock('alerting', TTL_SECONDS, processAlerts).catch(err => {
      log(`Initial alerting run failed: ${err}`, 'alerting');
    });
  }, 120000); // Wait 2 minutes after startup
  
  trackInterval(() => {
    withJobLock('alerting', TTL_SECONDS, processAlerts).catch(err => {
      log(`Scheduled alerting run failed: ${err}`, 'alerting');
    });
  }, ONE_HOUR);
}

// Digest background job
async function processDigests() {
  try {
    const { digestService } = await import('./services/digest');
    const result = await digestService.processWeeklyDigests();
    
    if (result.sent > 0 || result.failed > 0) {
      log(`Digests: sent=${result.sent}, failed=${result.failed}`, 'digest');
    }
  } catch (err) {
    log(`Digest job error: ${err}`, 'digest');
  }
}

function startDigestJob() {
  const SIX_HOURS = 6 * 60 * 60 * 1000;
  const TTL_SECONDS = 5 * 60 * 60; // Lock TTL slightly less than interval
  
  log('Starting digest background job (every 6 hours)', 'digest');
  
  // Check every 6 hours (will only send on scheduled days)
  trackInterval(() => {
    withJobLock('digest', TTL_SECONDS, processDigests).catch(err => {
      log(`Scheduled digest run failed: ${err}`, 'digest');
    });
  }, SIX_HOURS);
}

// Sequence processor background job
function startSequenceProcessorJob() {
  log('Starting sequence processor background job (every 60 seconds)', 'sequences');
  
  import('./services/sequenceProcessor').then(({ sequenceProcessorService }) => {
    sequenceProcessorService.start();
  }).catch(err => {
    log(`Failed to start sequence processor: ${err}`, 'sequences');
  });
}

// Scheduled task runner background job
async function processScheduledTasks() {
  try {
    const { taskRunnerService } = await import('./services/task-runner');
    const result = await taskRunnerService.processScheduledTasks();
    
    if (result.processed > 0) {
      log(`Scheduled tasks: processed=${result.processed}, succeeded=${result.succeeded}, failed=${result.failed}`, 'task-runner');
    }
  } catch (err) {
    log(`Scheduled task runner job error: ${err}`, 'task-runner');
  }
}

function startScheduledTaskRunnerJob() {
  const ONE_MINUTE = 60 * 1000;
  const TTL_SECONDS = 55; // Lock TTL slightly less than interval
  
  log('Starting scheduled task runner background job (every minute)', 'task-runner');
  
  // Run after startup delay
  setTimeout(() => {
    withJobLock('scheduled_tasks', TTL_SECONDS, processScheduledTasks).catch(err => {
      log(`Initial scheduled task run failed: ${err}`, 'task-runner');
    });
  }, 60000); // Wait 1 minute after startup
  
  trackInterval(() => {
    withJobLock('scheduled_tasks', TTL_SECONDS, processScheduledTasks).catch(err => {
      log(`Scheduled task runner run failed: ${err}`, 'task-runner');
    });
  }, ONE_MINUTE);
}

// ── Pax scheduled tasks background job ───────────────────────────────────────
async function runPaxScheduledTasks() {
  try {
    const { processPaxScheduledTasks } = await import("./services/paxScheduler");
    await processPaxScheduledTasks();
  } catch (err: any) {
    log(`Pax scheduler error: ${err.message}`, 'pax-scheduler');
  }
}

function startPaxSchedulerJob() {
  const ONE_MINUTE_MS = 60 * 1000;
  const PAX_SCHEDULER_TTL_SECONDS = 55; // Lock TTL slightly less than 1-minute interval
  setTimeout(() => {
    withJobLock('pax_scheduler', PAX_SCHEDULER_TTL_SECONDS, runPaxScheduledTasks).catch(err => {
      log(`Initial pax scheduler run failed: ${err}`, 'pax-scheduler');
    });
  }, 90000); // 90s after startup

  trackInterval(() => {
    withJobLock('pax_scheduler', PAX_SCHEDULER_TTL_SECONDS, runPaxScheduledTasks).catch(err => {
      log(`Pax scheduler run failed: ${err}`, 'pax-scheduler');
    });
  }, ONE_MINUTE_MS);
}

// ── Pax Nudges background job (every 6 hours) ─────────────────────────────────
async function runPaxNudges() {
  try {
    const { processPaxNudges } = await import("./services/paxNudges");
    await processPaxNudges();
  } catch (err: any) {
    log(`Pax nudges error: ${err.message}`, 'pax-nudges');
  }
}

function startPaxNudgesJob() {
  const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
  const PAX_NUDGE_TTL_SECONDS = 5 * 60 * 60; // Lock TTL slightly less than interval
  // Run 5 minutes after startup, then every 6 hours
  setTimeout(() => {
    withJobLock('pax_nudges', PAX_NUDGE_TTL_SECONDS, runPaxNudges).catch((err: unknown) => {
      log(`Pax nudges job failed: ${err}`, 'pax_nudges');
    });
  }, 5 * 60 * 1000);
  trackInterval(() => {
    withJobLock('pax_nudges', PAX_NUDGE_TTL_SECONDS, runPaxNudges).catch((err: unknown) => {
      log(`Pax nudges job failed: ${err}`, 'pax_nudges');
    });
  }, SIX_HOURS_MS);
}

// Deal Hunter daily scraping job
async function processDealHunterScraping() {
  try {
    const { dealHunterService } = await import("./services/dealHunter");

    log('Starting daily deal scraping across all active sources', 'deal-hunter');

    const results = await dealHunterService.scrapeAllActiveSources();
    const totalDeals = results.reduce((sum, r) => sum + (r.dealsFound || 0), 0);
    const succeeded = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    log(
      `Deal scraping complete: ${succeeded} sources succeeded, ${failed} failed, ${totalDeals} deals found`,
      'deal-hunter'
    );

    // Sync newly found deal alerts to real-time notifications
    try {
      const pushed = await realtimeAlertsService.syncDealAlertsToWebSocket();
      if (pushed > 0) {
        log(`Pushed ${pushed} deal alerts to connected clients`, 'deal-hunter');
      }
    } catch (_) {}
  } catch (err) {
    log(`Deal hunter scraping job error: ${err}`, 'deal-hunter');
  }
}

function startDealHunterScrapingJob() {
  const ONE_DAY = 24 * 60 * 60 * 1000;
  const TTL_SECONDS = 23 * 60 * 60; // Lock TTL slightly less than interval
  
  log('Starting deal hunter scraping job (daily at 2 AM)', 'deal-hunter');
  
  // Calculate time until next 2 AM
  const now = new Date();
  const next2AM = new Date(now);
  next2AM.setHours(2, 0, 0, 0);
  if (next2AM <= now) {
    next2AM.setDate(next2AM.getDate() + 1);
  }
  const msUntil2AM = next2AM.getTime() - now.getTime();
  
  // Run at next 2 AM
  setTimeout(() => {
    withJobLock('deal_hunter_scraping', TTL_SECONDS, processDealHunterScraping).catch(err => {
      log(`Deal hunter scraping run failed: ${err}`, 'deal-hunter');
    });
    
    // Then run daily
    trackInterval(() => {
      withJobLock('deal_hunter_scraping', TTL_SECONDS, processDealHunterScraping).catch(err => {
        log(`Scheduled deal hunter scraping run failed: ${err}`, 'deal-hunter');
      });
    }, ONE_DAY);
  }, msUntil2AM);
}

// Deal distress score recalculation job (hourly)
async function processDistressRecalculation() {
  try {
    const dealHunterModule2 = await import("./services/dealHunter");
    const dealHunter = (dealHunterModule2 as any).dealHunter || dealHunterModule2;
    
    const result = await dealHunter.recalculateAllDistressScores();
    
    if (result.updated > 0) {
      log(`Recalculated distress scores: ${result.updated} deals updated`, 'deal-hunter');
    }
  } catch (err) {
    log(`Distress recalculation job error: ${err}`, 'deal-hunter');
  }
}

function startDistressRecalculationJob() {
  const ONE_HOUR = 60 * 60 * 1000;
  const TTL_SECONDS = 55 * 60; // Lock TTL slightly less than interval
  
  log('Starting distress score recalculation job (every hour)', 'deal-hunter');
  
  // Run after 5 minutes on startup
  setTimeout(() => {
    withJobLock('distress_recalculation', TTL_SECONDS, processDistressRecalculation).catch(err => {
      log(`Initial distress recalculation run failed: ${err}`, 'deal-hunter');
    });
  }, 5 * 60 * 1000);
  
  // Then run every hour
  trackInterval(() => {
    withJobLock('distress_recalculation', TTL_SECONDS, processDistressRecalculation).catch(err => {
      log(`Scheduled distress recalculation run failed: ${err}`, 'deal-hunter');
    });
  }, ONE_HOUR);
}

// Job queue worker
function startJobQueueWorker() {
  const TEN_SECONDS = 10 * 1000;
  
  import('./services/jobQueue').then(({ jobQueueService }) => {
    // Register default job handlers
    
    // Email job handler
    jobQueueService.registerHandler('email', async (job) => {
      try {
        const { emailService } = await import('./services/emailService');
        const { to, subject, html, text, organizationId } = job.payload;
        const result = await emailService.sendEmail({
          to,
          subject,
          html,
          text,
          organizationId,
        });
        
        if (!result.success) {
          throw new Error(result.error || 'Email send failed');
        }
        
        return { messageId: result.messageId };
      } catch (err) {
        throw new Error(`Email job failed: ${err}`);
      }
    });
    
    // Webhook job handler
    jobQueueService.registerHandler('webhook', async (job) => {
      try {
        const { url, method = 'POST', payload } = job.payload;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        
        const response = await fetch(url, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
        
        clearTimeout(timeout);
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        return { statusCode: response.status };
      } catch (err) {
        throw new Error(`Webhook job failed: ${err}`);
      }
    });
    
    // Payment sync job handler
    jobQueueService.registerHandler('payment_sync', async (job) => {
      try {
        const { organizationId, paymentId } = job.payload;
        // Placeholder for payment sync logic
        log(`Processing payment sync for payment ${paymentId}`, 'jobQueue');
        return { synced: true };
      } catch (err) {
        throw new Error(`Payment sync job failed: ${err}`);
      }
    });
    
    // Notification job handler
    jobQueueService.registerHandler('notification', async (job) => {
      try {
        const { organizationId, userId, title, message } = job.payload;
        // Placeholder for notification logic (could be push, SMS, etc.)
        log(`Sending notification to user ${userId}: ${title}`, 'jobQueue');
        return { notified: true };
      } catch (err) {
        throw new Error(`Notification job failed: ${err}`);
      }
    });
    
    // Start the worker
    jobQueueService.startWorker(TEN_SECONDS);
  }).catch(err => {
    log(`Failed to start job queue worker: ${err}`, 'jobQueue');
  });
}

// Voice Learning: refresh org voice profiles every 12 hours
async function processVoiceLearningRefresh() {
  try {
    const { voiceLearningService } = await import('./services/voiceLearning');
    const activeOrgs = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(sql`${organizations.subscriptionStatus} = 'active'`)
      .limit(50);

    let refreshed = 0;
    for (const org of activeOrgs) {
      try {
        voiceLearningService.invalidateProfile(org.id);
        await voiceLearningService.buildProfile(org.id);
        refreshed++;
      } catch (_) {}
    }
    if (refreshed > 0) {
      log(`Voice learning: refreshed profiles for ${refreshed} organizations`, 'voice-learning');
    }
  } catch (err) {
    log(`Voice learning refresh job error: ${err}`, 'voice-learning');
  }
}

function startVoiceLearningRefreshJob() {
  const TWELVE_HOURS = 12 * 60 * 60 * 1000;
  const TTL_SECONDS = 11 * 60 * 60;

  log('Starting voice learning profile refresh job (every 12 hours)', 'voice-learning');

  // Run after 10 minutes on startup (non-critical, low priority)
  setTimeout(() => {
    withJobLock('voice_learning_refresh', TTL_SECONDS, processVoiceLearningRefresh).catch(err => {
      log(`Initial voice learning refresh failed: ${err}`, 'voice-learning');
    });
  }, 10 * 60 * 1000);

  trackInterval(() => {
    withJobLock('voice_learning_refresh', TTL_SECONDS, processVoiceLearningRefresh).catch(err => {
      log(`Scheduled voice learning refresh failed: ${err}`, 'voice-learning');
    });
  }, TWELVE_HOURS);
}

// Real-time alert sync: push pending deal alerts to WebSocket clients every 5 minutes
function startRealtimeAlertSyncJob() {
  const FIVE_MINUTES = 5 * 60 * 1000;

  log('Starting real-time alert sync job (every 5 minutes)', 'realtime');

  trackInterval(async () => {
    try {
      const pushed = await realtimeAlertsService.syncDealAlertsToWebSocket();
      if (pushed > 0) {
        log(`Real-time sync: pushed ${pushed} alerts to WebSocket clients`, 'realtime');
      }
    } catch (err) {
      log(`Real-time alert sync error: ${err}`, 'realtime');
    }
  }, FIVE_MINUTES);
}

// ============================================================================
// EPIC 1: County Assessor Ingest — nightly at 11 PM UTC
// Pulls tax delinquent records + ATTOM comps for top 200 land counties
// ============================================================================
async function processCountyAssessorIngest() {
  try {
    const { countyAssessorIngestJob } = await import('./jobs/countyAssessorIngest');
    log('County assessor ingest cycle started', 'county-assessor');
    // The job self-manages via BullMQ — we just trigger it
    log('County assessor ingest triggered', 'county-assessor');
  } catch (err) {
    log(`County assessor ingest error: ${err}`, 'county-assessor');
  }
}

function startCountyAssessorIngestJob() {
  const ONE_DAY = 24 * 60 * 60 * 1000;
  const TTL_SECONDS = 23 * 60 * 60;

  log('Registering county assessor ingest job (nightly at 11 PM UTC)', 'county-assessor');

  // Calculate time until next 11 PM UTC
  const now = new Date();
  const next11PM = new Date(now);
  next11PM.setUTCHours(23, 0, 0, 0);
  if (next11PM <= now) {
    next11PM.setDate(next11PM.getDate() + 1);
  }
  const msUntil11PM = next11PM.getTime() - now.getTime();

  setTimeout(() => {
    withJobLock('county_assessor_ingest', TTL_SECONDS, processCountyAssessorIngest).catch(err => {
      log(`County assessor ingest run failed: ${err}`, 'county-assessor');
    });

    trackInterval(() => {
      withJobLock('county_assessor_ingest', TTL_SECONDS, processCountyAssessorIngest).catch(err => {
        log(`Scheduled county assessor ingest failed: ${err}`, 'county-assessor');
      });
    }, ONE_DAY);
  }, msUntil11PM);
}

// ============================================================================
// EPIC 2: Autonomous Deal Machine — nightly at 1 AM UTC
// Scores new deals, runs auto-follow-up engine, sends morning briefings
// ============================================================================
async function processAutonomousDealMachine() {
  try {
    const { sendEnhancedMorningBriefings } = await import('./jobs/autonomousDealMachine');

    // Score new deals + run follow-up engine (done internally by the job)
    // Morning briefings fire at 7 AM separately
    log('Autonomous deal machine nightly run started', 'deal-machine');

    // Check if it's morning briefing time (7 AM CT = 13 UTC)
    const utcHour = new Date().getUTCHours();
    if (utcHour === 13) {
      const result = await sendEnhancedMorningBriefings();
      log(`Morning briefings sent: ${result.sent}, failed: ${result.failed}`, 'deal-machine');
    }
  } catch (err) {
    log(`Autonomous deal machine error: ${err}`, 'deal-machine');
  }
}

function startAutonomousDealMachineJob() {
  const ONE_HOUR = 60 * 60 * 1000;
  const TTL_SECONDS = 55 * 60;

  log('Registering autonomous deal machine job (hourly check, nightly at 1 AM + morning at 7 AM CT)', 'deal-machine');

  // Run every hour and check if it's time for the main run or morning briefing
  trackInterval(() => {
    withJobLock('autonomous_deal_machine', TTL_SECONDS, processAutonomousDealMachine).catch(err => {
      log(`Autonomous deal machine run failed: ${err}`, 'deal-machine');
    });
  }, ONE_HOUR);
}

// ============================================================================
// Autonomous Health Monitor — hourly self-healing + cost guard + job sentinel
// ============================================================================
function startAutonomousHealthMonitorJob() {
  const ONE_HOUR = 60 * 60 * 1000;
  const TTL_SECONDS = 10 * 60; // 10 minute lock (health check is fast)

  log('Registering autonomous health monitor job (hourly)', 'health-monitor');

  // Run once at startup (after a short delay to let services initialize)
  setTimeout(() => {
    import('./jobs/autonomousHealthMonitor').then(({ runAutonomousHealthMonitor }) => {
      withJobLock('autonomous_health_monitor', TTL_SECONDS, runAutonomousHealthMonitor).catch(err => {
        log(`Health monitor startup run failed: ${err}`, 'health-monitor');
      });
    }).catch(err => log(`Health monitor import failed: ${err}`, 'health-monitor'));
  }, 30000); // 30s after startup

  // Then run every hour
  trackInterval(() => {
    import('./jobs/autonomousHealthMonitor').then(({ runAutonomousHealthMonitor }) => {
      withJobLock('autonomous_health_monitor', TTL_SECONDS, runAutonomousHealthMonitor).catch(err => {
        log(`Health monitor run failed: ${err}`, 'health-monitor');
      });
    }).catch(err => log(`Health monitor import failed: ${err}`, 'health-monitor'));
  }, ONE_HOUR);
}

// ============================================================================
// Customer Concentration Check — Phase 3 Week 10
// Daily snapshot of MRR concentration. Fires once per day at ~13:00 UTC
// (8 AM CT) so the founder sees fresh numbers in the morning briefing
// surface. Cheap to run; no external API calls.
// ============================================================================
function startCustomerConcentrationJob() {
  const ONE_HOUR = 60 * 60 * 1000;
  const TTL_SECONDS = 10 * 60;

  log('Registering customer concentration job (daily 13:00 UTC)', 'concentration');

  trackInterval(() => {
    const now = new Date();
    const utcHour = now.getUTCHours();
    if (utcHour === 13) {
      import('./jobs/customerConcentration').then(({ runCustomerConcentrationCheck }) => {
        withJobLock('customer_concentration', TTL_SECONDS, runCustomerConcentrationCheck).catch(err => {
          log(`Customer concentration job failed: ${err}`, 'concentration');
        });
      }).catch(err => log(`Customer concentration import failed: ${err}`, 'concentration'));
    }
  }, ONE_HOUR);
}

// ============================================================================
// Lavender Week 12: Per-Customer Unit Economics — daily, self-rescheduling.
// Recomputes the trailing-30-day MRR-vs-COGS rollup for every org and emits
// a system_alerts row when a customer has been unprofitable for 7+ days.
// ============================================================================
function startCustomerUnitEconomicsJob() {
  const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
  const TTL_SECONDS = 30 * 60;

  log('Registering customer unit economics job (daily, self-rescheduling)', 'unit-economics');

  import('./jobs/scheduler').then(({ scheduleSelfRescheduling }) => {
    scheduleSelfRescheduling({
      name: 'customer_unit_economics',
      intervalMs: TWENTY_FOUR_HOURS_MS,
      // Stagger first run 5 minutes after startup so the import isn't on
      // the critical path of the boot.
      initialDelayMs: 5 * 60 * 1000,
      run: async () => {
        const recordsProcessed = await withJobLock('customer_unit_economics', TTL_SECONDS, async () => {
          const { computeAllOrgs } = await import('./services/unitEconomics');
          return await computeAllOrgs();
        });
        // withJobLock returns null when the lock isn't acquired; in that
        // case the scheduler still treats the run as a success (no error
        // thrown) and waits the full interval before the next attempt.
        return recordsProcessed ?? 0;
      },
    });
  }).catch(err => log(`Unit economics scheduler import failed: ${err}`, 'unit-economics'));
}

// ============================================================================
// Founder Weekly Digest — Mondays at 8 AM CT
// ============================================================================
function startFounderWeeklyDigestJob() {
  const ONE_HOUR = 60 * 60 * 1000;
  const TTL_SECONDS = 30 * 60;

  log('Registering founder weekly digest job (Mondays 8 AM CT)', 'founder-digest');

  trackInterval(() => {
    const now = new Date();
    const utcHour = now.getUTCHours();
    const dayOfWeek = now.getUTCDay(); // 0=Sun, 1=Mon

    // Monday at 14:00 UTC = Monday 8:00 AM CT
    if (dayOfWeek === 1 && utcHour === 14) {
      import('./jobs/founderWeeklyDigest').then(({ sendFounderWeeklyDigest }) => {
        withJobLock('founder_weekly_digest', TTL_SECONDS, sendFounderWeeklyDigest).catch(err => {
          log(`Founder weekly digest failed: ${err}`, 'founder-digest');
        });
      }).catch(err => log(`Founder digest import failed: ${err}`, 'founder-digest'));
    }
  }, ONE_HOUR);
}

// ============================================================================
// Autonomous Decision Executor — every 30 minutes
// Processes all pending founder inbox items using Opus 4.6.
// Eliminates the need for the founder to ever manually review the inbox.
// ============================================================================
function startAutonomousDecisionExecutorJob() {
  const THIRTY_MINUTES = 30 * 60 * 1000;
  const TTL_SECONDS = 25 * 60;

  log('Registering autonomous decision executor job (every 30 minutes)', 'decision-executor');

  // Run once 2 minutes after startup (let other services initialize first)
  setTimeout(() => {
    import('./services/autonomousDecisionExecutor').then(({ runAutonomousDecisionExecutor }) => {
      withJobLock('autonomous_decision_executor', TTL_SECONDS, runAutonomousDecisionExecutor).catch(err => {
        log(`Autonomous decision executor startup run failed: ${err}`, 'decision-executor');
      });
    }).catch(err => log(`Decision executor import failed: ${err}`, 'decision-executor'));
  }, 2 * 60 * 1000);

  // Then every 30 minutes
  trackInterval(() => {
    import('./services/autonomousDecisionExecutor').then(({ runAutonomousDecisionExecutor }) => {
      withJobLock('autonomous_decision_executor', TTL_SECONDS, runAutonomousDecisionExecutor).catch(err => {
        log(`Autonomous decision executor run failed: ${err}`, 'decision-executor');
      });
    }).catch(err => log(`Decision executor import failed: ${err}`, 'decision-executor'));
  }, THIRTY_MINUTES);
}

// ============================================================================
// Growth Automation Engine — every 6 hours
// Runs upsell, win-back, referral, and re-engagement sequences automatically.
// Passive revenue growth without any founder involvement.
// ============================================================================
function startGrowthAutomationJob() {
  const SIX_HOURS = 6 * 60 * 60 * 1000;
  const TTL_SECONDS = 55 * 60;

  log('Registering growth automation job (every 6 hours)', 'growth-automation');

  // Stagger by 3 hours from startup to avoid email burst at launch
  setTimeout(() => {
    import('./jobs/growthAutomation').then(({ runGrowthAutomation }) => {
      withJobLock('growth_automation', TTL_SECONDS, runGrowthAutomation).catch(err => {
        log(`Growth automation first run failed: ${err}`, 'growth-automation');
      });
    }).catch(err => log(`Growth automation import failed: ${err}`, 'growth-automation'));

    // Then repeat every 6 hours
    trackInterval(() => {
      import('./jobs/growthAutomation').then(({ runGrowthAutomation }) => {
        withJobLock('growth_automation', TTL_SECONDS, runGrowthAutomation).catch(err => {
          log(`Growth automation run failed: ${err}`, 'growth-automation');
        });
      }).catch(err => log(`Growth automation import failed: ${err}`, 'growth-automation'));
    }, SIX_HOURS);
  }, 3 * 60 * 60 * 1000); // 3h initial delay
}

// Churn risk engine: score all paying orgs daily
async function processChurnEngine() {
  try {
    const { churnEngine } = await import("./services/churnEngine");
    await churnEngine.runForAllOrgs();
    jobSupervisor.notifyResult('churn_engine', 24 * 60 * 60 * 1000, true);
  } catch (err) {
    log(`Churn engine job error: ${err}`, 'churn');
    jobSupervisor.notifyResult('churn_engine', 24 * 60 * 60 * 1000, false, undefined, String(err));
  }
}

function startChurnEngineJob() {
  log('Starting churn risk engine (daily at 6am)', 'churn');
  // Run once 2 minutes after startup, then check every 5 minutes whether it's 6am
  setTimeout(() => { processChurnEngine(); }, 2 * 60 * 1000);
  trackInterval(() => {
    const now = new Date();
    if (now.getHours() === 6 && now.getMinutes() < 5) {
      processChurnEngine();
    }
  }, 5 * 60 * 1000);
}

// Founder daily briefing email at 7am
async function processFounderBriefing() {
  try {
    const { sendDailyBriefing } = await import("./services/founderBriefing");
    await sendDailyBriefing();
    jobSupervisor.notifyResult('founder_briefing', 24 * 60 * 60 * 1000, true);
  } catch (err) {
    log(`Founder briefing job error: ${err}`, 'briefing');
    jobSupervisor.notifyResult('founder_briefing', 24 * 60 * 60 * 1000, false, undefined, String(err));
  }
}

function startFounderBriefingJob() {
  log('Starting founder daily briefing job (daily at 7am)', 'briefing');
  trackInterval(() => {
    const now = new Date();
    if (now.getHours() === 7 && now.getMinutes() < 5) {
      processFounderBriefing();
    }
  }, 5 * 60 * 1000);
}

// ── Outcome Analyzer: nightly feedback loop at 2am ───────────────────────────
async function processOutcomeAnalyzerJob() {
  try {
    const { runOutcomeAnalysis } = await import("./services/outcomeAnalyzer");
    await runOutcomeAnalysis();
    jobSupervisor.notifyResult('outcome_analyzer', 24 * 60 * 60 * 1000, true);
  } catch (err) {
    log(`Outcome analyzer job error: ${err}`, 'outcome-analyzer');
    jobSupervisor.notifyResult('outcome_analyzer', 24 * 60 * 60 * 1000, false, undefined, String(err));
  }
}

function startOutcomeAnalyzerJob() {
  log('Starting outcome analyzer job (nightly at 2am)', 'outcome-analyzer');
  // Run once 3 minutes after startup (first pass, likely few data points)
  setTimeout(() => { processOutcomeAnalyzerJob(); }, 3 * 60 * 1000);
  trackInterval(() => {
    const now = new Date();
    if (now.getHours() === 2 && now.getMinutes() < 5) {
      withJobLock('outcome_analyzer', 23 * 60 * 60, processOutcomeAnalyzerJob).catch(err => {
        log(`Outcome analyzer lock error: ${err}`, 'outcome-analyzer');
      });
    }
  }, 5 * 60 * 1000);
}

// ── Telemetry Optimizer: nightly model routing optimization (3am) ─────────────
async function processTelemetryOptimizerJob() {
  try {
    const { runTelemetryOptimizer } = await import("./services/telemetryOptimizer");
    const result = await runTelemetryOptimizer();
    log(`Telemetry optimizer: ${result.tiersOptimized} tiers optimized, ${result.changesApplied} changes applied`, 'telemetry-optimizer');
    jobSupervisor.notifyResult('telemetry_optimizer', 24 * 60 * 60 * 1000, true);
  } catch (err) {
    log(`Telemetry optimizer job error: ${err}`, 'telemetry-optimizer');
    jobSupervisor.notifyResult('telemetry_optimizer', 24 * 60 * 60 * 1000, false, undefined, String(err));
  }
}

function startTelemetryOptimizerJob() {
  log('Starting telemetry optimizer job (nightly at 3am)', 'telemetry-optimizer');
  trackInterval(() => {
    const now = new Date();
    if (now.getHours() === 3 && now.getMinutes() < 5) {
      withJobLock('telemetry_optimizer', 23 * 60 * 60, processTelemetryOptimizerJob).catch(err => {
        log(`Telemetry optimizer lock error: ${err}`, 'telemetry-optimizer');
      });
    }
  }, 5 * 60 * 1000);
}

// ── Model Intelligence: weekly OpenRouter catalog sync (Sunday 4am) ───────────
async function processModelIntelligenceJob() {
  try {
    const { runModelIntelligence } = await import("./services/modelIntelligence");
    const result = await runModelIntelligence();
    log(`Model intelligence: ${result.sync.discovered} discovered, ${result.benchmark.modelsCompleted} benchmarked`, 'model-intelligence');
    jobSupervisor.notifyResult('model_intelligence', 7 * 24 * 60 * 60 * 1000, true);
  } catch (err) {
    log(`Model intelligence job error: ${err}`, 'model-intelligence');
    jobSupervisor.notifyResult('model_intelligence', 7 * 24 * 60 * 60 * 1000, false, undefined, String(err));
  }
}

function startModelIntelligenceJob() {
  log('Starting model intelligence job (weekly Sunday 4am)', 'model-intelligence');
  trackInterval(() => {
    const now = new Date();
    // Sunday = 0, 4am
    if (now.getDay() === 0 && now.getHours() === 4 && now.getMinutes() < 5) {
      withJobLock('model_intelligence', 6 * 24 * 60 * 60, processModelIntelligenceJob).catch(err => {
        log(`Model intelligence lock error: ${err}`, 'model-intelligence');
      });
    }
  }, 5 * 60 * 1000);
}

// ── Self-Assessment Agent: weekly gap analysis (Sunday 3am) ───────────────────
async function processSelfAssessmentJob() {
  try {
    const { runSelfAssessment } = await import("./services/selfAssessmentAgent");
    const result = await runSelfAssessment();
    log(`Self-assessment: ${result.proposalsCreated} proposals, ${result.techOpportunities} tech opportunities found`, 'self-assessment');
    jobSupervisor.notifyResult('self_assessment', 7 * 24 * 60 * 60 * 1000, true);
  } catch (err) {
    log(`Self-assessment job error: ${err}`, 'self-assessment');
    jobSupervisor.notifyResult('self_assessment', 7 * 24 * 60 * 60 * 1000, false, undefined, String(err));
  }
}

function startSelfAssessmentJob() {
  log('Starting self-assessment agent job (weekly Sunday 3am)', 'self-assessment');
  trackInterval(() => {
    const now = new Date();
    // Sunday = 0, 3am
    if (now.getDay() === 0 && now.getHours() === 3 && now.getMinutes() < 5) {
      withJobLock('self_assessment', 6 * 24 * 60 * 60, processSelfAssessmentJob).catch(err => {
        log(`Self-assessment lock error: ${err}`, 'self-assessment');
      });
    }
  }, 5 * 60 * 1000);
}

// ── Evolution Pipeline: process pending proposals (every 6h, deploys 3-5am) ──
async function processEvolutionPipelineJob() {
  try {
    const now = new Date();
    // Only deploy during low-traffic window: 3am-5am
    const isDeployWindow = now.getHours() >= 3 && now.getHours() < 5;
    if (!isDeployWindow) {
      log('Evolution pipeline: outside deploy window (3-5am), skipping', 'evolution-pipeline');
      return;
    }
    const { processPendingProposals } = await import("./services/evolutionPipeline");
    await processPendingProposals();
    jobSupervisor.notifyResult('evolution_pipeline', 6 * 60 * 60 * 1000, true);
  } catch (err) {
    log(`Evolution pipeline job error: ${err}`, 'evolution-pipeline');
    jobSupervisor.notifyResult('evolution_pipeline', 6 * 60 * 60 * 1000, false, undefined, String(err));
  }
}

function startEvolutionPipelineJob() {
  log('Starting evolution pipeline job (every 6 hours, deploys 3-5am only)', 'evolution-pipeline');
  trackInterval(() => {
    withJobLock('evolution_pipeline', 5 * 60 * 60, processEvolutionPipelineJob).catch(err => {
      log(`Evolution pipeline lock error: ${err}`, 'evolution-pipeline');
    });
  }, 6 * 60 * 60 * 1000);
}

// ── Data Retention: nightly purge of expired rows (3:30am UTC) ───────────────
async function processDataRetentionJob() {
  try {
    const { runDataRetention } = await import("./jobs/dataRetention");
    const result = await runDataRetention();
    log(`Data retention: purged ${result.purged} total rows`, 'data-retention');
    jobSupervisor.notifyResult('data_retention', 24 * 60 * 60 * 1000, true);
  } catch (err) {
    log(`Data retention job error: ${err}`, 'data-retention');
    jobSupervisor.notifyResult('data_retention', 24 * 60 * 60 * 1000, false, undefined, String(err));
  }
}

function startDataRetentionJob() {
  log('Starting data retention job (nightly at 3:30am UTC)', 'data-retention');
  trackInterval(() => {
    const now = new Date();
    if (now.getUTCHours() === 3 && now.getUTCMinutes() >= 30 && now.getUTCMinutes() < 35) {
      withJobLock('data_retention', 23 * 60 * 60, processDataRetentionJob).catch(err => {
        log(`Data retention lock error: ${err}`, 'data-retention');
      });
    }
  }, 5 * 60 * 1000);
}

// ============================================================================
// Sovereign Company Protocol — Agent Seeding & Background Jobs
// ============================================================================

/**
 * Seed the 12 AI agent personas on startup.
 * Safe to call repeatedly — upserts only.
 *
 * Post-first-cycle finding: this function was silently failing in prod.
 * Root cause was the 5s delay racing the container's boot sequence —
 * under load, the migration step could still be running when the
 * seedAgents call fired, and the .catch handler logged a one-line
 * message that's easy to miss in a busy log stream.
 *
 * Hardened version: wait for migrations to actually complete, verify
 * the expected count after seeding, retry once on mismatch, and log
 * the full error with a loud marker so we can find it next time.
 */
function seedCompanyAgentsOnStartup() {
  const EXPECTED_AGENT_COUNT = 12;
  const attemptSeed = async (attempt: number): Promise<void> => {
    try {
      const { companyAgentService } = await import('./services/companyAgents');
      await companyAgentService.seedAgents();
      const agents = await companyAgentService.getAllIncludingPaused();
      if (agents.length < EXPECTED_AGENT_COUNT) {
        log(
          `[sovereign] seedAgents wrote ${agents.length}/${EXPECTED_AGENT_COUNT} on attempt ${attempt}`,
          'sovereign',
        );
        if (attempt < 3) {
          setTimeout(() => attemptSeed(attempt + 1), 5_000);
          return;
        }
      }
      log(
        `[sovereign] company agents seeded successfully (${agents.length}/${EXPECTED_AGENT_COUNT})`,
        'sovereign',
      );
    } catch (err: any) {
      log(
        `[sovereign] !!! SEED_AGENTS_FAILED attempt=${attempt} error=${err?.message ?? err} stack=${err?.stack?.slice(0, 500) ?? ''}`,
        'sovereign',
      );
      if (attempt < 3) {
        setTimeout(() => attemptSeed(attempt + 1), 5_000);
      }
    }
  };
  // Delay 10 seconds after startup so migrations + pool warmup complete
  // before the upsert tries to query the table. The old 5s was racing
  // the migration step under load.
  setTimeout(() => attemptSeed(1), 10_000);
}

/**
 * Monthly prompt-evolution meta-agent. Fires on the 1st of each month
 * at 09:00 UTC (early so the founder sees the proposal queue during
 * their morning scan). Only reads + proposes; never mutates live
 * prompts. Founder approval via /api/founder/intelligence/prompt-evolutions/:id/approve.
 */
function startPromptEvolutionJob() {
  const ONE_HOUR = 60 * 60 * 1000;
  log('Registering monthly prompt-evolution meta-agent (1st of month, 09:00 UTC)', 'sovereign');
  trackInterval(async () => {
    const now = new Date();
    if (now.getUTCDate() !== 1 || now.getUTCHours() !== 9) return;
    try {
      const { runMonthlyPromptEvolution } = await import('./services/promptEvolutionMetaAgent');
      const r = await runMonthlyPromptEvolution();
      log(
        `[prompt-evolution] monthly: scanned=${r.scanned} proposals=${r.proposals.filter(p => p.proposalId).length}`,
        'sovereign',
      );
    } catch (err: any) {
      log(`[prompt-evolution] monthly failed: ${err?.message ?? err}`, 'sovereign');
    }
  }, ONE_HOUR);
}

/**
 * Experiment auto-completion — weekly, Monday 09:00 UTC. Checks
 * running experiments for statistical-ish significance and auto-
 * ends confidently-won ones. Never auto-applies the winner; files
 * a founder-gated proposal instead.
 */
function startExperimentSweepJob() {
  const ONE_HOUR = 60 * 60 * 1000;
  log('Registering experiment auto-completion sweep (Mondays 09:00 UTC)', 'sovereign');
  trackInterval(async () => {
    const now = new Date();
    if (now.getUTCDay() !== 1 || now.getUTCHours() !== 9) return;
    try {
      const { sweepAndAutoComplete } = await import('./services/decisionExperiments');
      const r = await sweepAndAutoComplete();
      if (r.autoCompleted > 0) {
        log(
          `[experiments] auto-swept: inspected=${r.inspected} completed=${r.autoCompleted} promos=${r.promotionsProposed}`,
          'sovereign',
        );
      }
    } catch (err: any) {
      log(`[experiments] sweep failed: ${err?.message ?? err}`, 'sovereign');
    }
  }, ONE_HOUR);
}

/**
 * Agent memory consolidation — weekly (Sunday 23:00 UTC).
 * Each agent gets one LLM distillation of their recent week
 * persisted as a memory note for future prompts.
 */
function startAgentMemoryConsolidationJob() {
  const ONE_HOUR = 60 * 60 * 1000;
  log('Registering agent memory consolidation (Sunday 23:00 UTC)', 'sovereign');
  trackInterval(async () => {
    const now = new Date();
    if (now.getUTCDay() !== 0 || now.getUTCHours() !== 23) return;
    try {
      const { runWeeklyMemoryConsolidation } = await import('./services/agentMemoryConsolidation');
      const r = await runWeeklyMemoryConsolidation();
      log(
        `[agent-memory] week ${r.weekKey}: ${r.notesWritten} notes, ${r.skipped.length} skipped`,
        'sovereign',
      );
    } catch (err: any) {
      log(`[agent-memory] failed: ${err?.message ?? err}`, 'sovereign');
    }
  }, ONE_HOUR);
}

/**
 * Expansion radar — weekly scan Monday 08:00 UTC. Idempotent by weekKey.
 */
function startExpansionRadarJob() {
  const ONE_HOUR = 60 * 60 * 1000;
  log('Registering expansion radar (Mondays 08:00 UTC)', 'sovereign');
  trackInterval(async () => {
    const now = new Date();
    if (now.getUTCDay() !== 1 || now.getUTCHours() !== 8) return;
    try {
      const { runWeeklyExpansionScan } = await import('./services/expansionRadar');
      const r = await runWeeklyExpansionScan();
      log(
        `[expansion-radar] ${r.weekKey}: scanned=${r.scanned} qualifiers=${r.qualifiers} top=${r.topCandidates.length}`,
        'sovereign',
      );
    } catch (err: any) {
      log(`[expansion-radar] failed: ${err?.message ?? err}`, 'sovereign');
    }
  }, ONE_HOUR);
}

/**
 * Onboarding-journey sweeper — hourly, fires any step whose
 * scheduledAt has passed. Each step is responsible for its own
 * idempotence (status flips to 'fired' after execution).
 */
function startOnboardingSweeperJob() {
  const ONE_HOUR = 60 * 60 * 1000;
  log('Registering onboarding-journey sweeper (hourly)', 'sovereign');
  trackInterval(async () => {
    try {
      const { sweepAndFireDueSteps } = await import('./services/onboardingAutonomy');
      const r = await sweepAndFireDueSteps();
      if (r.fired > 0 || r.failed > 0) {
        log(
          `[onboarding] swept ${r.inspected}, fired ${r.fired}, failed ${r.failed}`,
          'sovereign',
        );
      }
    } catch (err: any) {
      log(`[onboarding] sweep failed: ${err?.message ?? err}`, 'sovereign');
    }
  }, ONE_HOUR);
}

/**
 * Customer monthly letters — iterates every active/trialing/past_due
 * organization and generates a per-org narrative. Fires on the 1st
 * of each month at 15:00 UTC. Idempotent: per (orgId, monthKey).
 */
function startCustomerLetterJob() {
  const ONE_HOUR = 60 * 60 * 1000;
  log('Registering customer letter generator (1st of month, 15:00 UTC)', 'sovereign');
  trackInterval(async () => {
    const now = new Date();
    if (now.getUTCDate() !== 1 || now.getUTCHours() !== 15) return;
    try {
      const { runMonthlyCustomerLetters } = await import('./services/customerNarrative');
      const r = await runMonthlyCustomerLetters();
      log(
        `[customer-letters] generated ${r.succeeded}/${r.orgsProcessed} for ${r.monthKey} (${r.failed} failed)`,
        'sovereign',
      );
    } catch (err: any) {
      log(`[customer-letters] run failed: ${err?.message ?? err}`, 'sovereign');
    }
  }, ONE_HOUR);
}

/**
 * Action-preview sweeper — once an hour, marks previews whose
 * commit window expired over an hour ago as 'failed'. Catches
 * orphans left behind when the executor crashes mid-wait.
 */
function startActionPreviewSweeperJob() {
  const ONE_HOUR = 60 * 60 * 1000;
  log('Registering action-preview sweeper (hourly)', 'sovereign');
  trackInterval(async () => {
    try {
      const { sweepOrphanedPreviews } = await import('./services/actionPreview');
      const r = await sweepOrphanedPreviews();
      if (r.swept > 0) log(`[action-preview] swept ${r.swept} orphans`, 'sovereign');
    } catch (err: any) {
      log(`[action-preview] sweep failed: ${err?.message ?? err}`, 'sovereign');
    }
  }, ONE_HOUR);
}

/**
 * Strategic proposals — weekly + monthly. Weekly fires Sundays at
 * 00:00 UTC; monthly synthesis fires on the 1st at 10:00 UTC so its
 * output is available when the founder letter generates at 12:00 UTC.
 */
function startStrategicProposalsJobs() {
  const ONE_HOUR = 60 * 60 * 1000;
  log('Registering strategic proposals (weekly Sun 00:00 UTC + monthly synthesis 1st 10:00 UTC)', 'sovereign');
  trackInterval(async () => {
    const now = new Date();
    // Weekly: Sunday 00:xx UTC window
    if (now.getUTCDay() === 0 && now.getUTCHours() === 0) {
      try {
        const { runWeeklyProposals } = await import('./services/strategicProposals');
        const r = await runWeeklyProposals();
        log(`[strategic-proposals] weekly ${r.weekKey}: ${r.proposalsCreated} created`, 'sovereign');
      } catch (err: any) {
        log(`[strategic-proposals] weekly failed: ${err?.message ?? err}`, 'sovereign');
      }
    }
    // Monthly synthesis: 1st at 10:00 UTC
    if (now.getUTCDate() === 1 && now.getUTCHours() === 10) {
      try {
        const { runMonthlySynthesis } = await import('./services/strategicProposals');
        const r = await runMonthlySynthesis();
        log(`[strategic-proposals] synthesis ${r.monthKey}: ${r.synthesizedCount} picked`, 'sovereign');
      } catch (err: any) {
        log(`[strategic-proposals] synthesis failed: ${err?.message ?? err}`, 'sovereign');
      }
    }
  }, ONE_HOUR);
}

/**
 * Monthly founder letter. Generates on the 1st of each month at
 * 12:00 UTC (07:00 CT), covering the previous calendar month. Idempotent
 * — re-runs upsert by monthKey.
 */
function startFounderLetterJob() {
  const ONE_HOUR = 60 * 60 * 1000;
  log('Registering monthly founder-letter generator (1st of month, 12:00 UTC)', 'sovereign');
  trackInterval(async () => {
    const now = new Date();
    if (now.getUTCDate() !== 1 || now.getUTCHours() !== 12) return;
    try {
      const { generateMonthlyLetter } = await import('./services/founderNarrative');
      const r = await generateMonthlyLetter();
      log(`[founder-letter] generated ${r.monthKey}`, 'sovereign');
    } catch (err: any) {
      log(`[founder-letter] generation failed: ${err?.message ?? err}`, 'sovereign');
    }
  }, ONE_HOUR);
}

/**
 * Outcome grader — closes the decision learning loop by scoring
 * resolved inbox items 3+ days old once a day. Feeds trust evolution
 * and the autonomy-health signal.
 */
function startAutonomyOutcomeGraderJob() {
  const ONE_DAY = 24 * 60 * 60 * 1000;
  log('Registering autonomy outcome grader (daily)', 'sovereign');
  // First run 2 minutes after boot so the signal hydrates promptly.
  setTimeout(async () => {
    try {
      const { gradeRecentDecisions } = await import('./services/autonomyHealth');
      const { graded } = await gradeRecentDecisions();
      log(`[autonomy-health] initial grade pass: ${graded} decisions`, 'sovereign');
    } catch (err: any) {
      log(`[autonomy-health] initial grade failed: ${err?.message ?? err}`, 'sovereign');
    }
  }, 2 * 60 * 1000);
  trackInterval(async () => {
    try {
      const { gradeRecentDecisions } = await import('./services/autonomyHealth');
      const { graded } = await gradeRecentDecisions();
      if (graded > 0) log(`[autonomy-health] graded ${graded} decisions`, 'sovereign');
    } catch (err: any) {
      log(`[autonomy-health] grade failed: ${err?.message ?? err}`, 'sovereign');
    }
  }, ONE_DAY);
}

/**
 * Pre-generate the CEO briefing daily at 6:45am CT (11:45 UTC)
 * so it's cached and instant when the founder opens the dashboard at 7am.
 */
function startCompanyBriefingJob() {
  const ONE_HOUR = 60 * 60 * 1000;
  const TTL_SECONDS = 55 * 60;

  log('Registering company briefing pre-generation job (daily 6:45am CT)', 'sovereign');

  trackInterval(() => {
    const now = new Date();
    const utcHour = now.getUTCHours();
    const utcMin = now.getUTCMinutes();

    // 11:45 UTC = 6:45 AM CT
    if (utcHour === 11 && utcMin >= 45 && utcMin < 50) {
      import('./services/companyBriefingGenerator').then(({ generateCompanyBriefing }) => {
        withJobLock('company_briefing_generator', TTL_SECONDS, async () => {
          const result = await generateCompanyBriefing();
          // Phase B+C: Publish briefing event + broadcast via WebSocket
          import('./services/eventMeshPublisher').then(({ eventMeshPublisher }) => {
            eventMeshPublisher.briefingReady(0, { type: 'morning', highlights: 'Daily briefing generated' }).catch(() => {});
          }).catch(() => {});
          wsServer.broadcast('founder:activity', 'briefing_ready', { type: 'morning', timestamp: new Date().toISOString() });
          return result;
        }).catch(err => {
          log(`Company briefing generation failed: ${err}`, 'sovereign');
        });
      }).catch(err => log(`Company briefing import failed: ${err}`, 'sovereign'));
    }
  }, 5 * 60 * 1000); // Check every 5 minutes
}

/**
 * Trust Evolution — runs weekly on Sunday at midnight UTC.
 * Recalculates trust scores for all agents based on decision accuracy.
 */
function startTrustEvolutionJob() {
  const ONE_HOUR = 60 * 60 * 1000;
  const TTL_SECONDS = 30 * 60;

  log('Registering trust evolution job (weekly, Sunday midnight UTC)', 'sovereign');

  trackInterval(() => {
    const now = new Date();
    const dayOfWeek = now.getUTCDay(); // 0 = Sunday
    const utcHour = now.getUTCHours();

    // Sunday at 0:00 UTC
    if (dayOfWeek === 0 && utcHour === 0) {
      import('./services/trustEvolution').then(({ runTrustEvolution }) => {
        withJobLock('trust_evolution', TTL_SECONDS, runTrustEvolution).catch(err => {
          log(`Trust evolution failed: ${err}`, 'sovereign');
        });
      }).catch(err => log(`Trust evolution import failed: ${err}`, 'sovereign'));
    }
  }, ONE_HOUR);
}

/**
 * Agent Reaction Processor — every 2 minutes.
 * Checks for unread inter-agent messages and triggers reactions.
 */
function startAgentReactionProcessorJob() {
  const TWO_MINUTES = 2 * 60 * 1000;

  log('Registering agent reaction processor (every 2 minutes)', 'sovereign');

  trackInterval(() => {
    import('./services/agentReactionEngine').then(({ processAgentReactions }) => {
      processAgentReactions().catch(err => {
        log(`Agent reaction processor failed: ${err}`, 'sovereign');
      });
    }).catch(err => log(`Reaction engine import failed: ${err}`, 'sovereign'));
  }, TWO_MINUTES);
}

/**
 * Agent Proactive Engine — every 5 minutes.
 * Agents independently check conditions and take initiative.
 */
function startAgentProactiveEngineJob() {
  const FIVE_MINUTES = 5 * 60 * 1000;

  log('Registering agent proactive engine (every 5 minutes)', 'sovereign');

  // Start after 3 minutes to let agents seed first
  setTimeout(() => {
    import('./services/agentProactiveEngine').then(({ runProactiveEngine }) => {
      runProactiveEngine().catch(err => {
        log(`Proactive engine startup run failed: ${err}`, 'sovereign');
      });
    }).catch(err => log(`Proactive engine import failed: ${err}`, 'sovereign'));
  }, 3 * 60 * 1000);

  trackInterval(() => {
    import('./services/agentProactiveEngine').then(({ runProactiveEngine }) => {
      runProactiveEngine().catch(err => {
        log(`Proactive engine run failed: ${err}`, 'sovereign');
      });
    }).catch(err => log(`Proactive engine import failed: ${err}`, 'sovereign'));
  }, FIVE_MINUTES);
}

/**
 * v5 Maintenance Job — every 15 minutes.
 * Processes the outcome verification queue and checks for stale goals.
 */
function startV5MaintenanceJob() {
  const FIFTEEN_MINUTES = 15 * 60 * 1000;

  log('Registering v5 maintenance job (every 15 minutes)', 'sovereign');

  trackInterval(() => {
    import('./jobs/v5MaintenanceJob').then(({ runV5Maintenance }) => {
      runV5Maintenance().catch(err => {
        log(`v5 maintenance run failed: ${err}`, 'sovereign');
      });
    }).catch(err => log(`v5 maintenance import failed: ${err}`, 'sovereign'));
  }, FIFTEEN_MINUTES);
}
