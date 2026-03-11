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
import { organizations, jobHealthLogs } from "@shared/schema";
import { logger, requestLoggingMiddleware, errorLoggingMiddleware } from "./utils/logger";
import { securityHeaders, corsMiddleware, requestTimeout, validateContentType, sanitizeQueryParams } from "./middleware/security";
import { csrfProtection } from "./middleware/csrf";
import crypto from "crypto";
import { wsServer } from "./websocket";
import { realtimeAlertsService } from "./services/realtimeAlerts";
import { createMcpServer } from "./mcp/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import rateLimit from "express-rate-limit";
import { initSentry, Sentry } from "./utils/sentry";

// Initialize Sentry ASAP — must run before any other code
initSentry();

// T15: Validate required secrets at startup
import { validateSecrets } from "./middleware/secretsValidation";
validateSecrets();

const app = express();
const httpServer = createServer(app);

// Initialize WebSocket real-time server
wsServer.initialize(httpServer);
realtimeAlertsService.setWebSocketServer(wsServer);

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

  console.log(`${formattedTime} [${source}] ${message}`);
}

// ============================================
// JOB LOCKING FOR MULTI-INSTANCE DEPLOYMENT
// ============================================

const instanceId = crypto.randomUUID();

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

// F-A09-2: Install PII masking console interceptor at startup
import("./middleware/piiMasking").then(({ installConsoleInterceptor }) => {
  try { installConsoleInterceptor(); } catch (_) { /* non-critical */ }
}).catch(() => {});

// F-A05-3: Remove x-powered-by header
app.disable("x-powered-by");

app.use(securityHeaders);
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
    limit: "10mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false, limit: "10mb" }));
app.use(cookieParser());

// Sentry request/tracing handler — must come before routes, after bodyParsers
if (process.env.SENTRY_DSN) {
  app.use(Sentry.expressErrorHandler());
}

app.use(validateContentType);
app.use(requestLoggingMiddleware);

// CSRF protection for state-changing API requests
app.use("/api", csrfProtection);

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
app.use("/api/atlas", aiLimiter);
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

// ── Redis-backed cross-instance rate limiting (Tasks #39-42) ─────────────────
// Applied to all /api routes as a supplementary layer on top of express-rate-limit.
// Falls back gracefully to allow if Redis is unavailable.
import { createOrgRateLimit, createIpRateLimit } from "./middleware/redisRateLimit";
let _redisRateLimitClient: any = null;
async function getRedisForRateLimit(): Promise<any> {
  if (_redisRateLimitClient) return _redisRateLimitClient;
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) return null;
  try {
    const IORedis = (await import("ioredis")).default;
    _redisRateLimitClient = new IORedis(redisUrl, {
      maxRetriesPerRequest: 2,
      enableReadyCheck: false,
      lazyConnect: true,
    });
    _redisRateLimitClient.on("error", () => {}); // swallow — fallback handles it
    await _redisRateLimitClient.connect().catch(() => { _redisRateLimitClient = null; });
    return _redisRateLimitClient;
  } catch {
    return null;
  }
}

// Wire Redis org-level rate limiting for authenticated API routes
app.use("/api", async (req, res, next) => {
  try {
    const redis = await getRedisForRateLimit();
    if (!redis) return next();
    return createOrgRateLimit(redis)(req, res, next);
  } catch {
    next();
  }
});

// Wire Redis IP-level rate limiting as defense-in-depth for unauthenticated paths
app.use("/api/auth", async (req, res, next) => {
  try {
    const redis = await getRedisForRateLimit();
    if (!redis) return next();
    return createIpRateLimit(redis, { maxPerMinute: 20, maxPerHour: 100 })(req, res, next);
  } catch {
    next();
  }
});

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

  // Initialize distributed tracing before routes so Express instrumentation captures all routes
  await initTracing();

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
      
      // Start lead nurturing background job (every 15 minutes)
      startLeadNurturingJob();
      
      // Start campaign optimization background job (every hour)
      startCampaignOptimizationJob();
      
      // Start finance agent background job (every 30 minutes)
      startFinanceAgentJob();
      
      // Start API queue background job (every 10 seconds)
      startApiQueueJob();
      
      // Start alerting background job (every hour)
      startAlertingJob();
      
      // Start digest background job (every 6 hours)
      startDigestJob();
      
      // Start sequence processor background job (every 60 seconds)
      startSequenceProcessorJob();
      
      // Start scheduled task runner background job (every minute)
      startScheduledTaskRunnerJob();
      
      // Start job queue worker (every 10 seconds)
      startJobQueueWorker();
      
      // Start deal hunter background jobs
      startDealHunterScrapingJob();
      startDistressRecalculationJob();

      // EPIC 1: County Assessor ingest pipeline (nightly at 11 PM UTC)
      startCountyAssessorIngestJob();

      // EPIC 2: Autonomous Deal Machine (nightly at 1 AM UTC)
      startAutonomousDealMachineJob();

      // Start voice learning profile refresh job (every 12 hours)
      startVoiceLearningRefreshJob();

      // Start real-time alert sync job (every 5 minutes)
      startRealtimeAlertSyncJob();

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
      setInterval(runJobHealthCleanup, 24 * 60 * 60 * 1000);
    },
  );
})();

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
  setInterval(() => {
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
  }
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
  setInterval(() => {
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
  } catch (err) {
    log(`Finance agent job error: ${err}`, 'finance');
  }
}

function startFinanceAgentJob() {
  const THIRTY_MINUTES = 30 * 60 * 1000;
  const TTL_SECONDS = 25 * 60; // Lock TTL slightly less than interval
  
  log('Starting finance agent background job (every 30 minutes)', 'finance');
  
  // Run after a short delay on startup
  setTimeout(() => {
    withJobLock('finance_agent', TTL_SECONDS, processFinanceAgent).catch(err => {
      log(`Initial finance agent run failed: ${err}`, 'finance');
    });
  }, 45000); // Wait 45 seconds after startup
  
  // Then run every 30 minutes
  setInterval(() => {
    withJobLock('finance_agent', TTL_SECONDS, processFinanceAgent).catch(err => {
      log(`Scheduled finance agent run failed: ${err}`, 'finance');
    });
  }, THIRTY_MINUTES);
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
  
  setInterval(() => {
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
  
  setInterval(() => {
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
  setInterval(() => {
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
  
  setInterval(() => {
    withJobLock('scheduled_tasks', TTL_SECONDS, processScheduledTasks).catch(err => {
      log(`Scheduled task runner run failed: ${err}`, 'task-runner');
    });
  }, ONE_MINUTE);
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
    setInterval(() => {
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
  setInterval(() => {
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

  setInterval(() => {
    withJobLock('voice_learning_refresh', TTL_SECONDS, processVoiceLearningRefresh).catch(err => {
      log(`Scheduled voice learning refresh failed: ${err}`, 'voice-learning');
    });
  }, TWELVE_HOURS);
}

// Real-time alert sync: push pending deal alerts to WebSocket clients every 5 minutes
function startRealtimeAlertSyncJob() {
  const FIVE_MINUTES = 5 * 60 * 1000;

  log('Starting real-time alert sync job (every 5 minutes)', 'realtime');

  setInterval(async () => {
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

    setInterval(() => {
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
  setInterval(() => {
    withJobLock('autonomous_deal_machine', TTL_SECONDS, processAutonomousDealMachine).catch(err => {
      log(`Autonomous deal machine run failed: ${err}`, 'deal-machine');
    });
  }, ONE_HOUR);
}
