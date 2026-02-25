import express, { type Request, Response, NextFunction } from "express";
import path from "path";
import cookieParser from "cookie-parser";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { WebhookHandlers } from "./webhookHandlers";
import { leadNurturerService } from "./services/leadNurturer";
import { db, storage } from "./storage";
import { eq, sql } from "drizzle-orm";
import { organizations } from "@shared/schema";
import { logger, requestLoggingMiddleware, errorLoggingMiddleware } from "./utils/logger";
import { securityHeaders, corsMiddleware, requestTimeout, validateContentType, sanitizeQueryParams } from "./middleware/security";
import { csrfProtection } from "./middleware/csrf";
import crypto from "crypto";

const app = express();
const httpServer = createServer(app);

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

async function withJobLock<T>(
  jobName: string, 
  ttlSeconds: number, 
  fn: () => Promise<T>
): Promise<T | null> {
  const acquired = await storage.acquireJobLock(jobName, instanceId, ttlSeconds);
  if (!acquired) {
    log(`Lock not acquired, skipping execution`, jobName);
    return null;
  }
  try {
    return await fn();
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

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

app.use(validateContentType);
app.use(requestLoggingMiddleware);

// CSRF protection for state-changing API requests
app.use("/api", csrfProtection);

(async () => {
  await initStripe();
  
  await registerRoutes(httpServer, app);

  app.use(errorLoggingMiddleware);

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
    const dealHunterModule = await import("./services/dealHunter");
    const dealHunter = (dealHunterModule as any).dealHunter || dealHunterModule;
    
    log('Starting daily deal scraping across all sources', 'deal-hunter');
    
    // In production, would scrape all registered sources
    // For now, just log that job ran
    const sources = await dealHunter.getRegisteredSources();
    
    log(`Found ${sources.length} registered deal sources`, 'deal-hunter');
    
    for (const source of sources) {
      if (source.enabled) {
        log(`Scraping ${source.name} (${source.state}/${source.county})`, 'deal-hunter');
        // In production: await dealHunter.scrapeDealSource(source.id);
      }
    }
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
