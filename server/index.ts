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
import { logger, requestLoggingMiddleware, errorLoggingMiddleware } from "./utils/logger";
import { securityHeaders, corsMiddleware, requestTimeout, validateContentType, sanitizeQueryParams } from "./middleware/security";
import { metricsMiddleware, metricsHandler } from "./middleware/metrics";
import { telemetryMiddleware } from "./middleware/telemetry";
import { wsServer } from "./websocket";
import { realtimeAlertsService } from "./services/realtimeAlerts";
import { createMcpServer } from "./mcp/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import rateLimit from "express-rate-limit";
import { initSentry, Sentry } from "./utils/sentry";
import { validateEnv } from "./utils/validateEnv";

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

// Job-runtime primitives (instanceId, trackInterval, withJobLock) live in
// server/utils/jobRuntime.ts so server/worker.ts can register the same
// scheduled-jobs catalogue. See server/jobs/runScheduledJobs.ts.

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

// ─── Compression — gzip + brotli (Wave: cost) ──────────────────────────────
// `compression@^1.8.0` negotiates Brotli when the client advertises it via
// Accept-Encoding (every modern browser does), falling back to gzip
// otherwise. Threshold = 1 KB so we don't waste CPU on tiny responses
// where the encoding overhead would be larger than the saved bytes.
//
// Filter:
//   - Skip pre-compressed binary content (images, PDFs, video, audio) —
//     re-compressing burns CPU for negligible bandwidth gain and on PDFs
//     in particular it tends to hurt because jspdf already deflates.
//   - Skip when the caller opts out via `x-no-compression` (kept for
//     parity with the upstream `compression` middleware default behavior).
import compression from "compression";
const SKIP_COMPRESS_TYPE = /^(image\/|video\/|audio\/|application\/pdf|application\/zip|application\/gzip|application\/x-gzip|application\/x-bzip2|application\/x-7z-compressed|application\/octet-stream)/i;
app.use(
  compression({
    threshold: 1024,
    filter: (req, res) => {
      if (req.headers["x-no-compression"]) return false;
      const ct = String(res.getHeader("Content-Type") ?? "");
      if (ct && SKIP_COMPRESS_TYPE.test(ct)) return false;
      return compression.filter(req, res);
    },
  }),
);

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
// Auth read endpoints (session-check, org list, oauth-status): permissive cap
// keyed by user-id when authenticated, falling back to IP. The previous blanket
// 20/15min-per-IP rule 429'd cellular users behind carrier-grade NAT, where
// many phones share one egress IP and one normal browsing session burns the
// bucket for the whole subnet — caught 2026-05-10 as the mobile sign-in hang.
// /api/auth/user is skipped entirely: it's called on every page render to
// validate the session cookie, clerk-express already verifies the JWT, and
// rate-limiting a read-only session check adds no security value.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req as any).auth?.userId || req.ip || "unknown",
  skip: (req) => req.originalUrl.startsWith("/api/auth/user"),
  message: { message: "Too many requests. Please try again later." },
});

// Auth-attempt endpoints (OAuth init/callback, legacy login/register): keep
// an aggressive per-IP cap to slow credential-stuffing and brute force.
const authAttemptLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many sign-in attempts. Please try again later." },
});

app.use("/api/auth", authLimiter);
app.use("/api/auth/google", authAttemptLimiter);
app.use("/api/auth/microsoft", authAttemptLimiter);
app.use("/api/login", authAttemptLimiter);
app.use("/api/register", authAttemptLimiter);

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

// RS-7 (post-may1-resweep): bulk export endpoints. Asher-takeover §3:
// "Asher's borrowers exported at 09:04 with no friction." Per-org per-day
// hard cap at 5 exports — generous for normal use, blocks the burst
// pattern that takeovers exhibit. Keyed by org first then user (so a
// hijacked single user can't grind through other orgs).
const exportLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const orgId = (req as any).organization?.id ?? "unknown-org";
    const userId = (req as any).auth?.userId ?? req.ip ?? "unknown-user";
    return `export:${orgId}:${userId}`;
  },
  message: { message: "Bulk-export rate limit exceeded. Per-org daily cap is 5. Email support@acreos.io for one-off lifts." },
});
app.use("/api/leads/export", exportLimiter);
app.use("/api/properties/export", exportLimiter);
app.use("/api/notes/export", exportLimiter);
app.use("/api/contractors/export", exportLimiter);
app.use("/api/tenants/export", exportLimiter);

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
      // when run on the customer-facing app machines. The actual catalogue lives in
      // server/jobs/runScheduledJobs.ts and is also booted from server/worker.ts so
      // production keeps these jobs alive even with DISABLE_BACKGROUND_JOBS=1 on app.
      if (process.env.DISABLE_BACKGROUND_JOBS === "1") {
        log("Background jobs DISABLED on app process (DISABLE_BACKGROUND_JOBS=1) — running on worker", "startup");
      } else {
        void (async () => {
          try {
            const { runScheduledJobs } = await import("./jobs/runScheduledJobs");
            await runScheduledJobs();
          } catch (err) {
            log(`runScheduledJobs failed: ${err}`, "startup");
          }
        })();
      }

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

