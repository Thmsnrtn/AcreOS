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

// Strip trailing slashes on GET/HEAD requests so /pricing and /pricing/
// don't both 200 (or 301 inconsistently). Policy: canonical form has no
// trailing slash. Skip the root path "/" and API routes (some clients
// rely on exact paths and POST bodies should not be redirected).
app.use((req, res, next) => {
  if (req.method !== "GET" && req.method !== "HEAD") return next();
  if (req.path === "/" || !req.path.endsWith("/")) return next();
  if (req.path.startsWith("/api/")) return next();
  const stripped = req.path.replace(/\/+$/, "");
  const query = req.url.slice(req.path.length);
  return res.redirect(301, stripped + query);
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

// Sentry's express ERROR handler is registered AFTER routes (see below,
// just before the generic error handler). Registering it here as well
// previously meant the early instance never caught route errors (routes
// hadn't been mounted yet) but did consume an extra middleware slot.

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

// AI / Pax / chat endpoints: 240 requests per minute, keyed by userId with
// IP fallback. These are hot paths — /api/pax fans out ~8 calls per page
// load when the Gabriel × Pax rail is mounted. A pure 60/min per-IP cap
// 429'd legitimate authenticated users on cellular carrier NAT (same root
// cause as the /api/auth limiter fixed 2026-05-10). Founder traffic also
// bypasses the cap via the deeper aiRateLimit in middleware/aiRateLimit.ts.
const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 240,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req as any).auth?.userId || req.ip || "unknown",
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
  // Migrations are NOT run from the server boot path. They run exclusively
  // via `scripts/migrate.mjs`, registered as Fly's `release_command` in
  // fly.toml. Boot-time DDL is unsafe in a multi-machine deploy: 2 app
  // machines + 1 worker would race the same CREATE TABLE / CREATE INDEX
  // through pgBouncer on every restart. See refactor commit
  // "refactor(migrations): remove Drizzle migrator + inline DDL from
  // server boot" for the history.

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

