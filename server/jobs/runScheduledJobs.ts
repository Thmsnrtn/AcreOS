/**
 * Scheduled-jobs registration — extracted from server/index.ts.
 *
 * Production runs the app process group with DISABLE_BACKGROUND_JOBS=1
 * (the gate that used to live around lines 1030-1735 of server/index.ts).
 * Before this extraction, the worker process (server/worker.ts) only
 * consumed outbox events, leaving ~70 start*Job calls dark — drip
 * campaigns, autonomous executor, onboarding sweeper, founder briefings,
 * churn engine, etc. all unscheduled in production. This module exports
 * `runScheduledJobs()` which both entrypoints can call (worker on every
 * deploy; app only when DISABLE_BACKGROUND_JOBS≠"1", e.g. single-machine
 * dev). Per-job locking via withJobLock keeps the cross-process behaviour
 * correct: whichever process acquires the Postgres-backed lock for a
 * given (jobName, ttl) tuple runs that tick.
 *
 * No behavioural change vs the inlined version — pure extraction. Each
 * job's comment block from the original index.ts is preserved verbatim.
 */

import { db, storage as _storage } from "../storage";
import { sql, lt, eq } from "drizzle-orm";
import { organizations, jobHealthLogs, agentEvents } from "@shared/schema";
import { logger } from "../utils/logger";
import { leadNurturerService } from "../services/leadNurturer";
import { realtimeAlertsService } from "../services/realtimeAlerts";
import { wsServer } from "../websocket";
import { jobSupervisor } from "../services/jobSupervisor";
import { instanceId as _instanceId, trackInterval, withJobLock, jobLog as log } from "../utils/jobRuntime";

// Touch unused imports to keep them part of the symbol table (their
// presence mirrors index.ts where they were originally imported at the
// top of the file). They may be referenced by future dynamic imports.
void _storage;
void _instanceId;

// Auto-seed county GIS endpoints on startup
async function seedCountyGisEndpointsOnStartup() {
  try {
    const { seedCountyGisEndpoints } = await import('../services/parcel');
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
  // 2026-06-05 cost-audit kill-switch. At zero paying orgs the loop is
  // ~$0/day, but the moment customers exist it can fan-out to
  // ~$50/day at 100 orgs × 15min × $0.005/call. Set
  // LEAD_NURTURING_AI_DISABLED=1 to skip registration entirely.
  if (process.env.LEAD_NURTURING_AI_DISABLED === "1") {
    log("Skipping lead nurturing job (LEAD_NURTURING_AI_DISABLED=1)", "nurturing");
    return;
  }

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
    const { campaignOptimizerService } = await import("../services/campaignOptimizer");

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
  // 2026-06-05 cost-audit kill-switch. Worst-case fan-out: 100 orgs × 24
  // ticks/day × 3 campaigns × $0.01/call = $72/day. Set
  // CAMPAIGN_OPTIMIZER_AI_DISABLED=1 to skip registration entirely.
  if (process.env.CAMPAIGN_OPTIMIZER_AI_DISABLED === "1") {
    log("Skipping campaign optimization job (CAMPAIGN_OPTIMIZER_AI_DISABLED=1)", "optimizer");
    return;
  }

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
    const { financeAgentService } = await import("../services/financeAgent");

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

  import('./scheduler').then(({ scheduleSelfRescheduling }) => {
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
    const { apiQueueService } = await import('../services/apiQueue');
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
    const { alertingService } = await import('../services/alerting');
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
    const { digestService } = await import('../services/digest');
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

// ── Domain-audit substrate (Iris) — daily continuous-audit sweep ─────────────
// Runs the shared domain-audit detectors (Lena/Iyari exemplars today; the
// other domains register theirs over time) and then sweeps stale findings.
// One bad detector never breaks the others (runDomainAudits isolates each).
async function processDomainAudits() {
  try {
    const { runDomainAudits, staleFindings } = await import('../services/audit/domainAudit');
    // Lena (finance) — the full finance-audit loop: tax_reserve (exemplar) +
    // envelope_overrun + runway_crunch, registered as one coherent set.
    const { financeDetectors } = await import('../services/lena/financeAudit');
    const { observationRateDetector } = await import('../services/audit/detectors/observationRateDetector');
    // Andrei (domain "ai") — Pax quality-drift detectors: hallucination-flag-rate
    // spike (load-bearing), eval-pass-rate regression, cost-per-interaction creep.
    const { aiQualityDetectors } = await import('../services/andrei/aiQualityAudit');

    const result = await runDomainAudits([
      ...financeDetectors,
      observationRateDetector,
      ...aiQualityDetectors,
    ]);
    // Auto-age open findings whose condition stopped firing >7d ago.
    const staled = await staleFindings(7);

    log(
      `Domain audits: detectors=${result.detectorsRun}, failed=${result.detectorsFailed}, findings=${result.findingsRecorded}, staled=${staled}`,
      'domain-audit',
    );
  } catch (err) {
    log(`Domain audit job error: ${err}`, 'domain-audit');
  }
}

function startDomainAuditJob() {
  const ONE_DAY = 24 * 60 * 60 * 1000;
  const TTL_SECONDS = 23 * 60 * 60; // Lock TTL slightly less than interval

  log('Starting domain-audit background job (daily)', 'domain-audit');

  // Run once shortly after boot so a fresh deploy seeds the cockpit, then daily.
  trackInterval(() => {
    withJobLock('domain_audit', TTL_SECONDS, processDomainAudits).catch(err => {
      log(`Scheduled domain audit run failed: ${err}`, 'domain-audit');
    });
  }, ONE_DAY);

  withJobLock('domain_audit', TTL_SECONDS, processDomainAudits).catch(err => {
    log(`Initial domain audit run failed: ${err}`, 'domain-audit');
  });
}

// The autonomous daily Operator cognition cycle (gated, OBSERVE-first). A no-op
// until cognition is switched ON in the Control Center — so this runs zero model
// calls by default. When on, one Opus-grade pass over the live Context Pack ~once
// per day surfaces a single deduped brief into the founder's Decisions queue.
// The 23h job lock makes it ~daily even across frequent deploys.
function startOperatorCycleJob() {
  const ONE_DAY = 24 * 60 * 60 * 1000;
  const TTL_SECONDS = 23 * 60 * 60;
  log('Starting Operator daily cognition cycle (gated OFF by default)', 'operator');
  const run = async () => {
    const { runOperatorCycle } = await import('../services/autopilot/operator');
    const { askFounder } = await import('../services/solene/founderCollab');
    await runOperatorCycle({
      ask: async (input) => {
        const r = await askFounder(input);
        return { askId: r.askId };
      },
    });
  };
  trackInterval(() => {
    withJobLock('operator_cycle', TTL_SECONDS, run).catch(err => log(`Operator cycle failed: ${err}`, 'operator'));
  }, ONE_DAY);
  // Initial run on boot, lock-guarded → effectively once per ~23h regardless of
  // restart frequency (gated OFF ⇒ a cheap no-op until the founder enables it).
  withJobLock('operator_cycle', TTL_SECONDS, run).catch(err => {
    log(`Initial Operator cycle failed: ${err}`, 'operator');
  });
}

// Sequence processor background job
function startSequenceProcessorJob() {
  log('Starting sequence processor background job (every 60 seconds)', 'sequences');

  import('../services/sequenceProcessor').then(({ sequenceProcessorService }) => {
    sequenceProcessorService.start();
  }).catch(err => {
    log(`Failed to start sequence processor: ${err}`, 'sequences');
  });
}

// Scheduled task runner background job
async function processScheduledTasks() {
  try {
    const { taskRunnerService } = await import('../services/task-runner');
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
    const { processPaxScheduledTasks } = await import("../services/paxScheduler");
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
    const { processPaxNudges } = await import("../services/paxNudges");
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

// Deal Hunter retired 2026-06-08 — the daily scrape job and the hourly distress
// recalculation job were removed along with the dealHunter service. Sourcing now
// flows through dealFeedEngine (/deals/discover). tax_sale / deal-source scrape
// tables are left orphaned for a later deliberate migration sweep.

// Job queue worker
function startJobQueueWorker() {
  const TEN_SECONDS = 10 * 1000;

  import('../services/jobQueue').then(({ jobQueueService }) => {
    // Register default job handlers

    // Email job handler
    jobQueueService.registerHandler('email', async (job) => {
      try {
        const { emailService } = await import('../services/emailService');
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

    // Webhook job handler — T0-11 (2026-06-10): extracted to
    // webhookJobHandler.ts and routed through the shared SSRF guard
    // (validateUrl), matching /api/webhooks/test + webhookDispatcher.
    // Blocked URLs fail terminally — no retry storm.
    jobQueueService.registerHandler('webhook', async (job) => {
      const { handleWebhookJob } = await import('./webhookJobHandler');
      return handleWebhookJob(job);
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
    const { voiceLearningService } = await import('../services/voiceLearning');
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
// EPIC 2: Autonomous Deal Machine — nightly at 1 AM UTC
// Scores new deals, runs auto-follow-up engine, sends morning briefings
// ============================================================================
async function processAutonomousDealMachine() {
  try {
    const { sendEnhancedMorningBriefings } = await import('./autonomousDealMachine');

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
    import('./autonomousHealthMonitor').then(({ runAutonomousHealthMonitor }) => {
      withJobLock('autonomous_health_monitor', TTL_SECONDS, runAutonomousHealthMonitor).catch(err => {
        log(`Health monitor startup run failed: ${err}`, 'health-monitor');
      });
    }).catch(err => log(`Health monitor import failed: ${err}`, 'health-monitor'));
  }, 30000); // 30s after startup

  // Then run every hour
  trackInterval(() => {
    import('./autonomousHealthMonitor').then(({ runAutonomousHealthMonitor }) => {
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
      import('./customerConcentration').then(({ runCustomerConcentrationCheck }) => {
        withJobLock('customer_concentration', TTL_SECONDS, runCustomerConcentrationCheck).catch(err => {
          log(`Customer concentration job failed: ${err}`, 'concentration');
        });
      }).catch(err => log(`Customer concentration import failed: ${err}`, 'concentration'));
    }
  }, ONE_HOUR);
}

// ============================================================================
// Wave 10: Self-Tuning Cost Optimizer — daily, self-rescheduling
// Analyses last 30 days of AI usage + MRR + Fly estimate, generates
// recommendations, auto-applies safe changes (prompt-cache, log-volume),
// flags everything else for /founder/cost-optimizer review.
// ============================================================================
function startCostOptimizerSelfRescheduling() {
  log('Registering self-tuning cost optimiser (daily)', 'cost-optimizer');
  import('./costOptimizer').then(({ startCostOptimizerJob }) => {
    startCostOptimizerJob();
  }).catch(err => log(`Cost optimiser import failed: ${err}`, 'cost-optimizer'));
}

// ============================================================================
// Wave 10: Per-Customer Unit Economics — daily, self-rescheduling.
// Recomputes the trailing-30-day MRR-vs-COGS rollup for every org and emits
// a system_alerts row when a customer has been unprofitable for 7+ days.
// ============================================================================
function startCustomerUnitEconomicsJob() {
  const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
  const TTL_SECONDS = 30 * 60;

  log('Registering customer unit economics job (daily, self-rescheduling)', 'unit-economics');

  import('./scheduler').then(({ scheduleSelfRescheduling }) => {
    scheduleSelfRescheduling({
      name: 'customer_unit_economics',
      intervalMs: TWENTY_FOUR_HOURS_MS,
      initialDelayMs: 5 * 60 * 1000,
      run: async () => {
        const recordsProcessed = await withJobLock('customer_unit_economics', TTL_SECONDS, async () => {
          const { computeAllOrgs } = await import('../services/unitEconomics');
          return await computeAllOrgs();
        });
        return recordsProcessed ?? 0;
      },
    });
  }).catch(err => log(`Unit economics scheduler import failed: ${err}`, 'unit-economics'));
}

// ============================================================================
// Tahoe L14 follow-up — api_telemetry_samples nightly rollup + purge.
//
// 30-day rolling retention on api_telemetry_samples. Older rows are
// aggregated into api_telemetry_rollup_monthly (UPSERT) then DELETEd from
// the source. Idempotent — see server/services/apiTelemetryRollup.ts.
// Daily wall-clock 01:00 UTC.
// ============================================================================
function startApiTelemetryRollupJob() {
  const ONE_HOUR_MS = 60 * 60 * 1000;
  const TTL_SECONDS = 50 * 60;

  log('Registering api_telemetry rollup + purge job (daily 01:00 UTC)', 'api-telemetry-rollup');

  trackInterval(() => {
    const now = new Date();
    if (now.getUTCHours() === 1 && now.getUTCMinutes() < 5) {
      void withJobLock('api_telemetry_rollup', TTL_SECONDS, async () => {
        const { runApiTelemetryRollup } = await import('../services/apiTelemetryRollup');
        const r = await runApiTelemetryRollup();
        log(
          `[api-telemetry-rollup] upserted=${r.rollupRowsUpserted} deleted=${r.sourceRowsDeleted} retentionDays=${r.retentionDays}`,
          'api-telemetry-rollup',
        );
      }).catch((err) => {
        log(`api_telemetry rollup failed: ${err}`, 'api-telemetry-rollup');
      });
    }
  }, ONE_HOUR_MS);
}

// ============================================================================
// Tahoe L6 — reserve-floor compliance check.
//
// Sums reserve buckets vs trailing-90d revenue. Writes a row to
// reserve_floor_check; never blocks any work. Daily wall-clock 06:30 UTC
// (after the daily AI cost guard run at 00:00 so logs interleave cleanly).
// ============================================================================
function startReserveFloorCheckerJob() {
  const ONE_HOUR_MS = 60 * 60 * 1000;
  const TTL_SECONDS = 30 * 60;

  log('Registering reserve floor checker job (daily 06:30 UTC)', 'reserve-floor');

  trackInterval(() => {
    const now = new Date();
    // Fire in the 06:30-06:34 UTC window so the 5-minute trackInterval
    // fan-out only matches one tick.
    if (now.getUTCHours() === 6 && now.getUTCMinutes() >= 30 && now.getUTCMinutes() < 35) {
      void withJobLock('reserve_floor_check', TTL_SECONDS, async () => {
        const { recordReserveFloorCheck } = await import('../services/reserveFloorChecker');
        const r = await recordReserveFloorCheck({ source: 'scheduled' });
        log(
          `[reserve-floor] reservesCents=${r.reservesTotalCents} floorCents=${r.floorCents} belowFloor=${r.belowFloor}`,
          'reserve-floor',
        );
      }).catch((err) => {
        log(`reserve floor check failed: ${err}`, 'reserve-floor');
      });
    }
  }, 5 * 60 * 1000);
}

// ============================================================================
// Wenzeslaus ETL orchestrator — Phase 8 Months 11.
//
// Sweeps etl_jobs every 5 minutes and runs every job whose cron cadence
// has elapsed since lastSuccessAt. Reference handlers (Regrid, FEMA) are
// registered up front; additional handlers can register themselves
// during their own service init. Per-job concurrency is enforced inside
// runDueJobs() via withJobLock, so this 5-minute outer cadence is safe.
// ============================================================================
function startEtlOrchestratorJob() {
  const FIVE_MINUTES = 5 * 60 * 1000;
  log('Registering ETL orchestrator job (every 5m)', 'etl');

  // Register reference handlers eagerly so manual /run-now from the
  // founder UI works even before the first scheduler tick.
  import('../services/etlHandlers')
    .then(({ registerReferenceEtlHandlers }) => {
      registerReferenceEtlHandlers();
    })
    .catch((err) => log(`ETL handler registration failed: ${err}`, 'etl'));

  import('./scheduler').then(({ scheduleSelfRescheduling }) => {
    scheduleSelfRescheduling({
      name: 'etl_orchestrator',
      intervalMs: FIVE_MINUTES,
      initialDelayMs: 90_000,
      run: async () => {
        const { runDueJobs } = await import('../services/etlOrchestrator');
        const results = await runDueJobs();
        const successes = results.filter((r) => r.status === 'success').length;
        const failures = results.filter((r) => r.status === 'failure').length;
        if (results.length > 0) {
          log(
            `ETL tick: ran=${results.length} ok=${successes} failed=${failures}`,
            'etl',
          );
        }
        return results.length;
      },
    });
  }).catch((err) => log(`ETL orchestrator scheduler import failed: ${err}`, 'etl'));
}

// ============================================================================
// Parcel Delta Detector — Iyari #5 — every 6 hours.
// ----------------------------------------------------------------------------
// Diffs the latest two observations per (apn, field) in parcel_observations for
// parcels in each customer's pipeline. On a guard-passing owner/tax change it
// writes a parcel_alert + emits parcel.owner_changed / parcel.tax_status_changed.
// The append-only observation log is READ-ONLY here; parcel_alerts is idempotent
// via its (organization_id, dedupe_key) unique index, so re-runs never duplicate.
// ============================================================================
async function processParcelDeltaDetection() {
  try {
    const { runParcelDeltaDetector } = await import('../services/parcelDeltaDetector');
    const result = await runParcelDeltaDetector();
    if (result.alertsCreated > 0) {
      log(
        `Parcel deltas: orgs=${result.orgsScanned} detected=${result.deltasDetected} alerts=${result.alertsCreated}`,
        'parcel-deltas',
      );
    }
  } catch (err) {
    log(`Parcel delta detector error: ${err}`, 'parcel-deltas');
  }
}

function startParcelDeltaDetectorJob() {
  const SIX_HOURS = 6 * 60 * 60 * 1000;
  const TTL_SECONDS = 5 * 60 * 60; // Lock TTL slightly less than interval

  log('Starting parcel delta detector job (every 6 hours)', 'parcel-deltas');

  // First run after a startup delay so it doesn't contend with boot work.
  setTimeout(() => {
    withJobLock('parcel_delta_detector', TTL_SECONDS, processParcelDeltaDetection).catch(err => {
      log(`Initial parcel delta run failed: ${err}`, 'parcel-deltas');
    });
  }, 150000); // ~2.5 min after startup

  trackInterval(() => {
    withJobLock('parcel_delta_detector', TTL_SECONDS, processParcelDeltaDetection).catch(err => {
      log(`Scheduled parcel delta run failed: ${err}`, 'parcel-deltas');
    });
  }, SIX_HOURS);
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
      import('./founderWeeklyDigest').then(({ sendFounderWeeklyDigest }) => {
        withJobLock('founder_weekly_digest', TTL_SECONDS, sendFounderWeeklyDigest).catch(err => {
          log(`Founder weekly digest failed: ${err}`, 'founder-digest');
        });
      }).catch(err => log(`Founder digest import failed: ${err}`, 'founder-digest'));

      // Wave 8 — also send the spend-report digest piggy-backed on the same
      // Monday 8 AM CT window. Separate email + separate job lock so a
      // failure in one doesn't block the other.
      import('./costOptimizerWeeklyDigest').then(({ sendCostOptimizerWeeklyDigest }) => {
        withJobLock('cost_optimizer_weekly_digest', TTL_SECONDS, sendCostOptimizerWeeklyDigest).catch(err => {
          log(`Cost optimiser weekly digest failed: ${err}`, 'cost-optimizer-digest');
        });
      }).catch(err => log(`Cost optimiser digest import failed: ${err}`, 'cost-optimizer-digest'));
    }
  }, ONE_HOUR);
}

// ============================================================================
// Autonomous Decision Executor — every 30 minutes
// Processes all pending founder inbox items using Opus 4.6.
// Eliminates the need for the founder to ever manually review the inbox.
// ============================================================================

// Tess (SRE) cost guardrail (2026-06): per-tick spend bound on the executor.
// The 30-min cadence × Haiku→Sonnet→Opus cascade × full-inbox burst was the
// identified ~$30/day burn source and had NO per-tick ceiling. We add a bound
// at the SCHEDULER layer (executor behaviour itself is unchanged):
//   • PRE-tick: if the trailing-window AI spend already exceeds the ceiling,
//     skip this tick entirely (a hot inbox burning > the cap pauses the
//     cascade until spend drains) — this is the enforcing bound.
//   • POST-tick: re-measure spend incurred + decisions processed; if either
//     ceiling was crossed, log a structured warn so the breach is greppable.
// Both ceilings are env-tunable with sensible defaults.
const AUTONOMOUS_DECISION_EXECUTOR_MAX_USD_PER_TICK = (() => {
  const raw = Number(process.env.AUTONOMOUS_DECISION_EXECUTOR_MAX_USD_PER_TICK);
  return Number.isFinite(raw) && raw > 0 ? raw : 1.0;
})();
const AUTONOMOUS_DECISION_EXECUTOR_MAX_DECISIONS_PER_TICK = (() => {
  const raw = Number(process.env.AUTONOMOUS_DECISION_EXECUTOR_MAX_DECISIONS_PER_TICK);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 10;
})();
const DECISION_EXECUTOR_TICK_WINDOW_MS = 30 * 60 * 1000;

// Sum estimated AI spend (USD) recorded since `since`, across all orgs.
// Reads the indexed ai_telemetry_events.created_at + estimated_cost_cents.
// On any error we return null so the caller fails OPEN (never blocks the
// executor purely because telemetry was momentarily unreadable).
async function sumAiSpendUsdSince(since: Date): Promise<number | null> {
  try {
    const { aiTelemetryEvents } = await import("@shared/schema");
    const { gte } = await import("drizzle-orm");
    const [row] = await db
      .select({
        cents: sql<string>`COALESCE(SUM(${aiTelemetryEvents.estimatedCostCents}), 0)`,
      })
      .from(aiTelemetryEvents)
      .where(gte(aiTelemetryEvents.createdAt, since));
    return Number(row?.cents ?? 0) / 100;
  } catch (err) {
    log(`[decision-executor] AI spend read failed (failing open): ${err}`, "decision-executor");
    return null;
  }
}

// Runs one executor tick under the per-tick cost bound. Imported lazily by the
// job so the cap lives at the scheduler layer, not in the executor service.
async function runDecisionExecutorTickBounded(): Promise<void> {
  const tickStart = new Date();
  const windowStart = new Date(tickStart.getTime() - DECISION_EXECUTOR_TICK_WINDOW_MS);

  // PRE-tick enforcing bound: if recent spend already blew the ceiling, defer.
  const recentSpend = await sumAiSpendUsdSince(windowStart);
  if (recentSpend !== null && recentSpend >= AUTONOMOUS_DECISION_EXECUTOR_MAX_USD_PER_TICK) {
    log(
      `[decision-executor] per-tick spend cap hit — skipping tick. ` +
        `trailing-${Math.round(DECISION_EXECUTOR_TICK_WINDOW_MS / 60000)}m spend=$${recentSpend.toFixed(2)} ` +
        `>= cap=$${AUTONOMOUS_DECISION_EXECUTOR_MAX_USD_PER_TICK.toFixed(2)} ` +
        `(AUTONOMOUS_DECISION_EXECUTOR_MAX_USD_PER_TICK)`,
      "decision-executor",
    );
    return;
  }

  const { runAutonomousDecisionExecutor } = await import("../services/autonomousDecisionExecutor");
  const result = await runAutonomousDecisionExecutor();

  // POST-tick bound: surface a breach so a runaway tick is greppable even
  // though we let the in-flight items finish (we never kill mid-tick).
  const incurred = await sumAiSpendUsdSince(tickStart);
  if (incurred !== null && incurred > AUTONOMOUS_DECISION_EXECUTOR_MAX_USD_PER_TICK) {
    log(
      `[decision-executor] per-tick spend ceiling exceeded: this tick spent $${incurred.toFixed(2)} ` +
        `> cap=$${AUTONOMOUS_DECISION_EXECUTOR_MAX_USD_PER_TICK.toFixed(2)} ` +
        `across ${result.itemsProcessed} items — next tick will defer until spend drains`,
      "decision-executor",
    );
  }
  if (result.itemsProcessed > AUTONOMOUS_DECISION_EXECUTOR_MAX_DECISIONS_PER_TICK) {
    log(
      `[decision-executor] per-tick decision cap exceeded: processed ${result.itemsProcessed} ` +
        `> cap=${AUTONOMOUS_DECISION_EXECUTOR_MAX_DECISIONS_PER_TICK} ` +
        `(AUTONOMOUS_DECISION_EXECUTOR_MAX_DECISIONS_PER_TICK)`,
      "decision-executor",
    );
  }
}

function startAutonomousDecisionExecutorJob() {
  // 2026-06-05 cost-audit kill-switch. This job was identified as the
  // single most-likely $30/day burn source: 30-min cadence × no per-tick
  // decision cap × Haiku→Sonnet→Opus tier cascade. A full inbox at any
  // point during the day cascades to Opus per item. Set
  // AUTONOMOUS_DECISION_EXECUTOR_DISABLED=1 to skip registration.
  if (process.env.AUTONOMOUS_DECISION_EXECUTOR_DISABLED === "1") {
    log(
      "Skipping autonomous decision executor (AUTONOMOUS_DECISION_EXECUTOR_DISABLED=1)",
      "decision-executor",
    );
    return;
  }

  const THIRTY_MINUTES = 30 * 60 * 1000;
  const TTL_SECONDS = 25 * 60;

  log(
    `Registering autonomous decision executor job (every 30 minutes; ` +
      `per-tick cap $${AUTONOMOUS_DECISION_EXECUTOR_MAX_USD_PER_TICK.toFixed(2)} / ` +
      `${AUTONOMOUS_DECISION_EXECUTOR_MAX_DECISIONS_PER_TICK} decisions)`,
    'decision-executor',
  );

  // Run once 2 minutes after startup (let other services initialize first)
  setTimeout(() => {
    withJobLock('autonomous_decision_executor', TTL_SECONDS, runDecisionExecutorTickBounded).catch(err => {
      log(`Autonomous decision executor startup run failed: ${err}`, 'decision-executor');
    });
  }, 2 * 60 * 1000);

  // Then every 30 minutes
  trackInterval(() => {
    withJobLock('autonomous_decision_executor', TTL_SECONDS, runDecisionExecutorTickBounded).catch(err => {
      log(`Autonomous decision executor run failed: ${err}`, 'decision-executor');
    });
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
    import('./growthAutomation').then(({ runGrowthAutomation }) => {
      withJobLock('growth_automation', TTL_SECONDS, runGrowthAutomation).catch(err => {
        log(`Growth automation first run failed: ${err}`, 'growth-automation');
      });
    }).catch(err => log(`Growth automation import failed: ${err}`, 'growth-automation'));

    // Then repeat every 6 hours
    trackInterval(() => {
      import('./growthAutomation').then(({ runGrowthAutomation }) => {
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
    const { churnEngine } = await import("../services/churnEngine");
    await churnEngine.runForAllOrgs();
    jobSupervisor.notifyResult('churn_engine', 24 * 60 * 60 * 1000, true);
  } catch (err) {
    log(`Churn engine job error: ${err}`, 'churn');
    jobSupervisor.notifyResult('churn_engine', 24 * 60 * 60 * 1000, false, undefined, String(err));
  }
}

function startChurnEngineJob() {
  log('Starting churn risk engine (daily at 6am)', 'churn');
  // Daily wall-clock 6am window — TTL = 60m so a duplicate tick within
  // the 5m window (or any retry inside the hour) gets skipped across
  // workers. The startup-warmup run is unwrapped because it's a one-
  // shot at boot and runs from a single instance during boot anyway.
  setTimeout(() => { processChurnEngine(); }, 2 * 60 * 1000);
  trackInterval(() => {
    const now = new Date();
    if (now.getHours() === 6 && now.getMinutes() < 5) {
      withJobLock("churn_engine_daily", 60 * 60, processChurnEngine).catch((err: any) => {
        log(`Churn engine lock error: ${err}`, 'churn');
      });
    }
  }, 5 * 60 * 1000);
}

// Founder daily briefing email at 7am
async function processFounderBriefing() {
  try {
    const { sendDailyBriefing } = await import("../services/founderBriefing");
    await sendDailyBriefing();
    jobSupervisor.notifyResult('founder_briefing', 24 * 60 * 60 * 1000, true);
  } catch (err) {
    log(`Founder briefing job error: ${err}`, 'briefing');
    jobSupervisor.notifyResult('founder_briefing', 24 * 60 * 60 * 1000, false, undefined, String(err));
  }
}

function startFounderBriefingJob() {
  log('Starting founder daily briefing job (daily at 7am)', 'briefing');
  // Daily wall-clock 7am window — TTL = 60m covers the 5m window.
  trackInterval(() => {
    const now = new Date();
    if (now.getHours() === 7 && now.getMinutes() < 5) {
      withJobLock("founder_briefing_daily", 60 * 60, processFounderBriefing).catch((err: any) => {
        log(`Founder briefing lock error: ${err}`, 'briefing');
      });
    }
  }, 5 * 60 * 1000);
}

// ── Atlas Morning Brief (Phase E) ────────────────────────────────────────────
// Posts a single assistant message containing a brief_card to each founder's
// default Atlas thread at 07:00 wall-clock. Idempotent — the job de-dupes
// per-thread per-UTC-day inside morningBrief.ts. Separate from the customer
// founder-briefing email above (that's a customer-side daily email; this is
// the founder-chat morning brief).
async function processAtlasMorningBrief() {
  // Frugal Autonomy gate: budget check + min-interval. The brief is
  // founder-essential so mustRunCondition stays true regardless of activity.
  const { shouldRunAIJob, recordJobRun } = await import("../services/intelligence/coordinator");
  const gate = await shouldRunAIJob("atlas_morning_brief", {
    category: "founder_brief",
    minIntervalMinutes: 12 * 60, // 12h — block accidental double-fires
  });
  if (!gate.run) {
    log(`Atlas morning brief skipped: ${gate.reason}`, 'atlas-morning-brief');
    return;
  }
  try {
    const { runMorningBriefForAllFounders } = await import("./morningBrief");
    const r = await runMorningBriefForAllFounders();
    log(`Atlas morning brief: ran=${r.ran}, skipped=${r.skipped}`, 'atlas-morning-brief');
    await recordJobRun("atlas_morning_brief");
    jobSupervisor.notifyResult('atlas_morning_brief', 24 * 60 * 60 * 1000, true);
  } catch (err) {
    log(`Atlas morning brief error: ${err}`, 'atlas-morning-brief');
    jobSupervisor.notifyResult('atlas_morning_brief', 24 * 60 * 60 * 1000, false, undefined, String(err));
  }
}

function startAtlasMorningBriefJob() {
  log('Starting Atlas morning brief job (daily at 7am)', 'atlas-morning-brief');
  trackInterval(() => {
    const now = new Date();
    if (now.getHours() === 7 && now.getMinutes() < 5) {
      withJobLock("atlas_morning_brief_daily", 60 * 60, processAtlasMorningBrief).catch((err: any) => {
        log(`Atlas morning brief lock error: ${err}`, 'atlas-morning-brief');
      });
    }
  }, 5 * 60 * 1000);
}

// ── Customer-surface ErrorBoundary spike detector (Solene) ───────────────────
// Every 15 minutes, scans error_boundary_trips for routes that fired more than
// SPIKE_TRIPS_PER_HOUR ErrorBoundary trips in the last hour. When tripped,
// fires Solene's proactive page channel (severity=urgent). Dedupes per (route,
// hour) so a sustained spike doesn't loop-page Tom's phone. See
// server/services/customer-surface/errorBoundaryAggregator.ts.
async function processErrorBoundarySpikeDetect() {
  try {
    const { detectAndPageOnSpike } = await import("../services/customer-surface/errorBoundaryAggregator");
    const r = await detectAndPageOnSpike();
    if (r.pagedCount > 0 || r.spikes.length > 0) {
      log(
        `[error-boundary-spike] examinedRoutes=${r.examinedRoutes} spikes=${r.spikes.length} paged=${r.pagedCount}`,
        'error-boundary-spike',
      );
    }
  } catch (err) {
    log(`[error-boundary-spike] error: ${err}`, 'error-boundary-spike');
  }
}

function startErrorBoundarySpikeDetectorJob() {
  const FIFTEEN_MINUTES = 15 * 60 * 1000;
  const TTL_SECONDS = 14 * 60;
  log('Starting ErrorBoundary spike detector (every 15 min)', 'error-boundary-spike');
  trackInterval(() => {
    withJobLock('error_boundary_spike_detect', TTL_SECONDS, processErrorBoundarySpikeDetect).catch((err: any) => {
      log(`ErrorBoundary spike detector lock error: ${err}`, 'error-boundary-spike');
    });
  }, FIFTEEN_MINUTES);
}

// ── Atlas Background-Task Runner (Phase E) ───────────────────────────────────
// Polls founder_chat_background_tasks every 10s. Started once at boot; the
// runner self-loops, so no setInterval wrapper needed.
function startAtlasBackgroundTaskRunner() {
  log('Starting Atlas background-task runner (10s poll)', 'atlas-bg-runner');
  void import('./founderChatBackgroundTaskRunner').then(({ startFounderChatBackgroundTaskRunner }) => {
    startFounderChatBackgroundTaskRunner(10_000);
  }).catch((err) => log(`Atlas background-task runner import failed: ${err}`, 'atlas-bg-runner'));
}

// Phase F push wiring — nudges Tom when a destructive confirmation has been
// sitting idle for >60s. Best-effort; silently skips if VAPID is unset.
function startAtlasPendingConfirmationNudger() {
  log('Starting Atlas pending-confirmation nudger (60s poll)', 'atlas-confirm-nudger');
  void import('./atlasPendingConfirmationNudger').then(({ startAtlasPendingConfirmationNudger: start }) => {
    start();
  }).catch((err) => log(`Atlas pending-confirmation nudger import failed: ${err}`, 'atlas-confirm-nudger'));
}

// ── Outcome Analyzer: nightly feedback loop at 2am ───────────────────────────
async function processOutcomeAnalyzerJob() {
  // Skip when there's no recent outcome telemetry to analyze — no point
  // paying for an LLM to "analyze" zero data points on a pre-launch
  // platform.
  const { shouldRunAIJob, recordJobRun } = await import("../services/intelligence/coordinator");
  const gate = await shouldRunAIJob("outcome_analyzer", {
    category: "analysis",
    minIntervalMinutes: 18 * 60,
    mustRunCondition: async () => {
      try {
        const { db } = await import("../db");
        const { outcomeTelemetry } = await import("@shared/schema");
        const { sql: sqlOp, gte: gteOp } = await import("drizzle-orm");
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const [{ n }] = await db
          .select({ n: sqlOp<number>`count(*)` })
          .from(outcomeTelemetry)
          .where(gteOp(outcomeTelemetry.createdAt, since));
        return Number(n) > 0;
      } catch {
        return false;
      }
    },
  });
  if (!gate.run) {
    log(`Outcome analyzer skipped: ${gate.reason}`, 'outcome-analyzer');
    return;
  }
  try {
    const { runOutcomeAnalysis } = await import("../services/outcomeAnalyzer");
    await runOutcomeAnalysis();
    await recordJobRun("outcome_analyzer");
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
  // Skip when there's no recent AI telemetry to optimize against.
  const { shouldRunAIJob, recordJobRun } = await import("../services/intelligence/coordinator");
  const gate = await shouldRunAIJob("telemetry_optimizer", {
    category: "analysis",
    minIntervalMinutes: 18 * 60,
    mustRunCondition: async () => {
      try {
        const { db } = await import("../db");
        const { aiTelemetryEvents } = await import("@shared/schema");
        const { sql: sqlOp, gte: gteOp } = await import("drizzle-orm");
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const [{ n }] = await db
          .select({ n: sqlOp<number>`count(*)` })
          .from(aiTelemetryEvents)
          .where(gteOp(aiTelemetryEvents.createdAt, since));
        // Optimizer wants meaningful sample — at least 100 calls in 24h.
        return Number(n) >= 100;
      } catch {
        return false;
      }
    },
  });
  if (!gate.run) {
    log(`Telemetry optimizer skipped: ${gate.reason}`, 'telemetry-optimizer');
    return;
  }
  try {
    const { runTelemetryOptimizer } = await import("../services/telemetryOptimizer");
    const result = await runTelemetryOptimizer();
    log(`Telemetry optimizer: ${result.tiersOptimized} tiers optimized, ${result.changesApplied} changes applied`, 'telemetry-optimizer');
    await recordJobRun("telemetry_optimizer");
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
    const { runModelIntelligence } = await import("../services/modelIntelligence");
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
    const { runSelfAssessment } = await import("../services/selfAssessmentAgent");
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
    const { processPendingProposals } = await import("../services/evolutionPipeline");
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

// ── Rosy River C2: Codebase Monitor — daily proposal scan (4:15am UTC) ───────
// See /Users/user/.claude/plans/ok-i-wanna-try-rosy-river.md (C2). Writes
// candidates to proposed_changes outbox in simulation mode. Founder reviews
// at /founder/agent-queue and promotes to the evolution gauntlet.
//
// Scheduled outside the 3-5am evolution-pipeline deploy window so it doesn't
// compete for CPU/locks. npm-outdated scan only (TS scan deferred — too heavy
// for prod inline; runs locally or in a future worker pool).
async function processCodebaseMonitorJob() {
  try {
    const { runCodebaseMonitor } = await import("../services/codebaseMonitor");
    const result = await runCodebaseMonitor({
      scanNpmOutdated: true,
      scanTypescript: false,
    });
    log(
      `Codebase monitor: ${result.proposalsAdded} proposal(s) added` +
        (result.skipped ? ` (skipped: ${result.reason})` : ""),
      'codebase-monitor',
    );
    jobSupervisor.notifyResult('codebase_monitor', 24 * 60 * 60 * 1000, true);
  } catch (err) {
    log(`Codebase monitor job error: ${err}`, 'codebase-monitor');
    jobSupervisor.notifyResult('codebase_monitor', 24 * 60 * 60 * 1000, false, undefined, String(err));
  }
}

function startCodebaseMonitorJob() {
  log('Starting codebase monitor job (daily at 4:15am UTC)', 'codebase-monitor');
  trackInterval(() => {
    const now = new Date();
    if (now.getUTCHours() === 4 && now.getUTCMinutes() >= 15 && now.getUTCMinutes() < 20) {
      withJobLock('codebase_monitor', 23 * 60 * 60, processCodebaseMonitorJob).catch(err => {
        log(`Codebase monitor lock error: ${err}`, 'codebase-monitor');
      });
    }
  }, 5 * 60 * 1000);
}

// ── Rosy River C5: Weekly telemetry digest (Sunday 8am UTC) ──────────────────
// Rolls up the last 7 days of agent_tasks / agent_llm_traces / evolution_history
// into a single founder-feed event. Scheduled outside the heavy 3-5am window
// and after Sunday's existing strategic-proposals / model-intelligence jobs
// so it has the freshest data to summarize.
async function processTelemetryDigestJob() {
  try {
    const { runTelemetryDigest } = await import("../services/telemetryDigest");
    const snapshot = await runTelemetryDigest();
    log(
      `Telemetry digest: $${snapshot.spend.totalUsd.toFixed(2)} spent, ` +
        `${snapshot.proposals.total} proposals, ` +
        `${snapshot.gauntlet.deployed} deployed, ` +
        `${snapshot.gauntlet.reverted} reverted`,
      'telemetry-digest',
    );
    jobSupervisor.notifyResult('telemetry_digest', 7 * 24 * 60 * 60 * 1000, true);
  } catch (err) {
    log(`Telemetry digest job error: ${err}`, 'telemetry-digest');
    jobSupervisor.notifyResult('telemetry_digest', 7 * 24 * 60 * 60 * 1000, false, undefined, String(err));
  }
}

function startTelemetryDigestJob() {
  log('Starting telemetry digest job (Sundays at 8:00am UTC)', 'telemetry-digest');
  trackInterval(() => {
    const now = new Date();
    if (
      now.getUTCDay() === 0 && // Sunday
      now.getUTCHours() === 8 &&
      now.getUTCMinutes() < 5
    ) {
      withJobLock('telemetry_digest', 6 * 24 * 60 * 60, processTelemetryDigestJob).catch(err => {
        log(`Telemetry digest lock error: ${err}`, 'telemetry-digest');
      });
    }
  }, 5 * 60 * 1000);
}

// ── Rosy River C6: Multi-week planner (Sunday 9am UTC, 1h after digest) ──────
async function processMultiWeekPlannerJob() {
  try {
    const { runMultiWeekPlanner } = await import("../services/multiWeekPlanner");
    const plan = await runMultiWeekPlanner();
    log(
      `Multi-week planner: ${plan.recommendations.length} recommendation(s), ` +
        `spend Δ${plan.deltas.spendDeltaPct}%, ` +
        `${plan.promotionEligible.length} promotion-eligible`,
      'multi-week-planner',
    );
    jobSupervisor.notifyResult('multi_week_planner', 7 * 24 * 60 * 60 * 1000, true);
  } catch (err) {
    log(`Multi-week planner job error: ${err}`, 'multi-week-planner');
    jobSupervisor.notifyResult('multi_week_planner', 7 * 24 * 60 * 60 * 1000, false, undefined, String(err));
  }
}

function startMultiWeekPlannerJob() {
  log('Starting multi-week planner job (Sundays at 9:00am UTC)', 'multi-week-planner');
  trackInterval(() => {
    const now = new Date();
    if (
      now.getUTCDay() === 0 && // Sunday
      now.getUTCHours() === 9 &&
      now.getUTCMinutes() < 5
    ) {
      withJobLock('multi_week_planner', 6 * 24 * 60 * 60, processMultiWeekPlannerJob).catch(err => {
        log(`Multi-week planner lock error: ${err}`, 'multi-week-planner');
      });
    }
  }, 5 * 60 * 1000);
}

// ── Pillar F / F3: Pax personality drift sampler (Mondays 7am UTC) ──────────
async function processPersonalityDriftJob() {
  try {
    const { runPersonalityDriftSampler } = await import("../services/personalityDriftSampler");
    const report = await runPersonalityDriftSampler();
    log(
      `Personality drift: sample=${report.sampleSize}, composite=${report.current.composite.toFixed(3)}, alert=${report.alertFired}`,
      'drift-sampler',
    );
    jobSupervisor.notifyResult('personality_drift', 7 * 24 * 60 * 60 * 1000, true);
  } catch (err) {
    log(`Personality drift sampler error: ${err}`, 'drift-sampler');
    jobSupervisor.notifyResult('personality_drift', 7 * 24 * 60 * 60 * 1000, false, undefined, String(err));
  }
}

function startPersonalityDriftJob() {
  log('Starting personality drift sampler (Mondays at 7am UTC)', 'drift-sampler');
  trackInterval(() => {
    const now = new Date();
    if (now.getUTCDay() === 1 && now.getUTCHours() === 7 && now.getUTCMinutes() < 5) {
      withJobLock('personality_drift', 6 * 24 * 60 * 60, processPersonalityDriftJob).catch(err => {
        log(`Personality drift lock error: ${err}`, 'drift-sampler');
      });
    }
  }, 5 * 60 * 1000);
}

// ── Pillar E / E1: Trial expiry automation (daily 9am UTC) ──────────────────
async function processTrialExpiryJob() {
  try {
    const { runTrialExpiryCycle } = await import("../services/trialEngine");
    const result = await runTrialExpiryCycle();
    log(
      `Trial engine: reminders=${result.remindersSent}, followups=${result.followupsSent}, skipped=${result.skipped}`,
      'trial-engine',
    );
    jobSupervisor.notifyResult('trial_engine', 24 * 60 * 60 * 1000, true);
  } catch (err) {
    log(`Trial engine error: ${err}`, 'trial-engine');
    jobSupervisor.notifyResult('trial_engine', 24 * 60 * 60 * 1000, false, undefined, String(err));
  }
}

function startTrialExpiryJob() {
  log('Starting trial-expiry job (daily at 9am UTC)', 'trial-engine');
  trackInterval(() => {
    const now = new Date();
    if (now.getUTCHours() === 9 && now.getUTCMinutes() < 5) {
      withJobLock('trial_engine', 23 * 60 * 60, processTrialExpiryJob).catch(err => {
        log(`Trial engine lock error: ${err}`, 'trial-engine');
      });
    }
  }, 5 * 60 * 1000);
}

// ── Pillar E / E4+E9: Customer health scoring (daily 7am UTC) ───────────────
async function processCustomerHealthJob() {
  try {
    const { runHealthForAllOrgs } = await import("../services/customerHealthEngine");
    const result = await runHealthForAllOrgs();
    log(
      `Customer health: scored=${result.scored}, healthy=${result.bandsCount.healthy}, ` +
        `watch=${result.bandsCount.watch}, silent=${result.bandsCount.silent_disengaged}, ` +
        `struggling=${result.bandsCount.struggling}`,
      'customer-health',
    );
    jobSupervisor.notifyResult('customer_health', 24 * 60 * 60 * 1000, true);
  } catch (err) {
    log(`Customer health job error: ${err}`, 'customer-health');
    jobSupervisor.notifyResult('customer_health', 24 * 60 * 60 * 1000, false, undefined, String(err));
  }
}

function startCustomerHealthJob() {
  log('Starting customer health job (daily at 7am UTC)', 'customer-health');
  trackInterval(() => {
    const now = new Date();
    if (now.getUTCHours() === 7 && now.getUTCMinutes() < 5) {
      withJobLock('customer_health', 23 * 60 * 60, processCustomerHealthJob).catch(err => {
        log(`Customer health lock error: ${err}`, 'customer-health');
      });
    }
  }, 5 * 60 * 1000);
}

// ── Pillar E / E11: Onboarding step scheduler (daily 10am UTC) ──────────────
async function processOnboardingSchedulerJob() {
  try {
    const { runOnboardingScheduler } = await import("../services/onboardingScheduler");
    const result = await runOnboardingScheduler();
    log(
      `Onboarding scheduler: fired=${result.fired}, failed=${result.failed}, skipped=${result.skipped}`,
      'onboarding-scheduler',
    );
    jobSupervisor.notifyResult('onboarding_scheduler', 24 * 60 * 60 * 1000, true);
  } catch (err) {
    log(`Onboarding scheduler error: ${err}`, 'onboarding-scheduler');
    jobSupervisor.notifyResult('onboarding_scheduler', 24 * 60 * 60 * 1000, false, undefined, String(err));
  }
}

function startOnboardingSchedulerJob() {
  log('Starting onboarding scheduler (daily at 10am UTC)', 'onboarding-scheduler');
  trackInterval(() => {
    const now = new Date();
    if (now.getUTCHours() === 10 && now.getUTCMinutes() < 5) {
      withJobLock('onboarding_scheduler', 23 * 60 * 60, processOnboardingSchedulerJob).catch(err => {
        log(`Onboarding scheduler lock error: ${err}`, 'onboarding-scheduler');
      });
    }
  }, 5 * 60 * 1000);
}

// ── Data Retention: nightly purge of expired rows (3:30am UTC) ───────────────
async function processDataRetentionJob() {
  try {
    const { runDataRetention } = await import("./dataRetention");
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

// ── Kareem §2: Quarterly access review (SOC 2 CC6.2) ─────────────────────────
// Fires on the first Tuesday of January / April / July / October at 14:00 UTC
// (8 AM CT). Enumerates every team_members row with role IN ('owner','admin'),
// joins lastActiveAt, flags stale admins, emails the founder, persists an
// audit_event for evidence. Idempotent within a day via systemMeta sentinel.
async function processQuarterlyAccessReview() {
  try {
    const { runQuarterlyAccessReview, alreadyRanToday, isQuarterlyAccessReviewDay } = await import("./accessReview");
    if (!isQuarterlyAccessReviewDay()) return;
    if (await alreadyRanToday()) {
      log("Access review skipped — already ran today", "access-review");
      return;
    }
    const result = await runQuarterlyAccessReview();
    log(`Access review complete: reviewed=${result.rows.length} stale=${result.stale.length}`, "access-review");
  } catch (err) {
    log(`Access review failed: ${err}`, "access-review");
  }
}

function startQuarterlyAccessReviewJob() {
  log("Starting quarterly access review job (first Tue of Jan/Apr/Jul/Oct at 14:00 UTC)", "access-review");
  trackInterval(() => {
    const now = new Date();
    if (now.getUTCHours() === 14 && now.getUTCMinutes() < 5) {
      withJobLock("access_review_quarterly", 60 * 60, processQuarterlyAccessReview).catch((err) => {
        log(`Access review lock error: ${err}`, "access-review");
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
      const { companyAgentService } = await import('../services/companyAgents');
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
    // Monthly cron — TTL = 60m (covers full 09:xx UTC window so duplicate
    // tick within the window is suppressed across workers).
    withJobLock("prompt_evolution_monthly", 60 * 60, async () => {
      const { runMonthlyPromptEvolution } = await import('../services/promptEvolutionMetaAgent');
      const r = await runMonthlyPromptEvolution();
      log(
        `[prompt-evolution] monthly: scanned=${r.scanned} proposals=${r.proposals.filter(p => p.proposalId).length}`,
        'sovereign',
      );
    }).catch((err: any) => {
      log(`[prompt-evolution] monthly failed: ${err?.message ?? err}`, 'sovereign');
    });
  }, ONE_HOUR);
}

/**
 * Phase B-2: outcome-driven prompt evolution — nightly per-agent sweep.
 *
 * Each night at 04:00 UTC walks every active agent and calls
 * agentEvolutionEngine.proposePromptChangeFromOutcomes(). Below the
 * minSignal threshold (3 combined rejections + failures in last 30d)
 * the call returns null and nothing happens; above it, a Haiku-drafted
 * prompt revision lands in agent_prompt_evolutions for founder review
 * at /founder/prompt-evolutions.
 *
 * Closes the autonomy learning loop: founder rejections + verified
 * failures → agent prompt evolves without manual triage. The proposal
 * is always founder-gated; nothing applies without explicit approval.
 */
function startOutcomeDrivenEvolutionJob() {
  const ONE_HOUR = 60 * 60 * 1000;
  log('Registering outcome-driven evolution proposer (nightly 04:00 UTC)', 'sovereign');
  trackInterval(async () => {
    const now = new Date();
    if (now.getUTCHours() !== 4) return;
    // Nightly cron — TTL 60m covers the 04:xx window across workers.
    withJobLock("outcome_driven_evolution_nightly", 60 * 60, async () => {
      const { agentEvolutionEngine } = await import('../services/agentEvolutionEngine');
      const { companyAgentService } = await import('../services/companyAgents');
      const agents = await companyAgentService.getAllIncludingPaused();
      let proposed = 0;
      let skipped = 0;
      for (const agent of agents) {
        if (agent.status === 'disabled') { skipped++; continue; }
        try {
          const result = await agentEvolutionEngine.proposePromptChangeFromOutcomes(agent.codename);
          if (result) proposed++;
          else skipped++;
        } catch (err: any) {
          log(`[outcome-evolution] agent=${agent.codename} failed: ${err?.message ?? err}`, 'sovereign');
        }
      }
      log(
        `[outcome-evolution] nightly: agents=${agents.length} proposed=${proposed} skipped=${skipped}`,
        'sovereign',
      );
    }).catch((err: any) => {
      log(`[outcome-evolution] nightly failed: ${err?.message ?? err}`, 'sovereign');
    });
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
    // Weekly window — TTL = 60m (covers the 09:xx UTC window).
    withJobLock("experiment_sweep_weekly", 60 * 60, async () => {
      const { sweepAndAutoComplete } = await import('../services/decisionExperiments');
      const r = await sweepAndAutoComplete();
      if (r.autoCompleted > 0) {
        log(
          `[experiments] auto-swept: inspected=${r.inspected} completed=${r.autoCompleted} promos=${r.promotionsProposed}`,
          'sovereign',
        );
      }
    }).catch((err: any) => {
      log(`[experiments] sweep failed: ${err?.message ?? err}`, 'sovereign');
    });
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
    // Weekly window — TTL = 60m (covers the 23:xx UTC window).
    withJobLock("agent_memory_consolidation_weekly", 60 * 60, async () => {
      const { runWeeklyMemoryConsolidation } = await import('../services/agentMemoryConsolidation');
      const r = await runWeeklyMemoryConsolidation();
      log(
        `[agent-memory] week ${r.weekKey}: ${r.notesWritten} notes, ${r.skipped.length} skipped`,
        'sovereign',
      );
    }).catch((err: any) => {
      log(`[agent-memory] failed: ${err?.message ?? err}`, 'sovereign');
    });
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
    // Weekly window — TTL = 60m (covers the 08:xx UTC window).
    withJobLock("expansion_radar_weekly", 60 * 60, async () => {
      const { runWeeklyExpansionScan } = await import('../services/expansionRadar');
      const r = await runWeeklyExpansionScan();
      log(
        `[expansion-radar] ${r.weekKey}: scanned=${r.scanned} qualifiers=${r.qualifiers} top=${r.topCandidates.length}`,
        'sovereign',
      );
    }).catch((err: any) => {
      log(`[expansion-radar] failed: ${err?.message ?? err}`, 'sovereign');
    });
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
    // Hourly — TTL = 55m (≈90% of cadence). Per-step idempotence is
    // already handled by status='fired', but the lock prevents two
    // workers from both firing onboarding email/SMS in the same hour.
    withJobLock("onboarding_sweeper", 55 * 60, async () => {
      const { sweepAndFireDueSteps } = await import('../services/onboardingAutonomy');
      const r = await sweepAndFireDueSteps();
      if (r.fired > 0 || r.failed > 0) {
        log(
          `[onboarding] swept ${r.inspected}, fired ${r.fired}, failed ${r.failed}`,
          'sovereign',
        );
      }
    }).catch((err: any) => {
      log(`[onboarding] sweep failed: ${err?.message ?? err}`, 'sovereign');
    });
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
    // Monthly window — TTL = 60m (covers 15:xx UTC window). Per-org
    // letters are idempotent by (orgId, monthKey) but the cross-org
    // iteration itself burns OpenAI tokens — lock keeps that single-fire.
    withJobLock("customer_letters_monthly", 60 * 60, async () => {
      const { runMonthlyCustomerLetters } = await import('../services/customerNarrative');
      const r = await runMonthlyCustomerLetters();
      log(
        `[customer-letters] generated ${r.succeeded}/${r.orgsProcessed} for ${r.monthKey} (${r.failed} failed)`,
        'sovereign',
      );
    }).catch((err: any) => {
      log(`[customer-letters] run failed: ${err?.message ?? err}`, 'sovereign');
    });
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
    // Hourly — TTL = 55m (≈90% of cadence).
    withJobLock("action_preview_sweeper", 55 * 60, async () => {
      const { sweepOrphanedPreviews } = await import('../services/actionPreview');
      const r = await sweepOrphanedPreviews();
      if (r.swept > 0) log(`[action-preview] swept ${r.swept} orphans`, 'sovereign');
    }).catch((err: any) => {
      log(`[action-preview] sweep failed: ${err?.message ?? err}`, 'sovereign');
    });
  }, ONE_HOUR);
}

/**
 * Mail flusher — every 3 minutes, sends `mail_shipments` whose 30-minute hold
 * window has elapsed (status='queued', leaves_at<=now) through the real Lob
 * path, writes provider piece ids back, and REFUNDS the enqueue debit on a send
 * failure. Without this, the outreach-mail queue charged customers and never
 * mailed (the product-truth audit's most serious gap). withJobLock + the
 * atomic FOR UPDATE SKIP LOCKED claim make it safe to run on every worker.
 */
function startMailFlusherJob() {
  const THREE_MIN = 3 * 60 * 1000;
  log('Registering mail flusher (every 3m)', 'sovereign');
  trackInterval(async () => {
    withJobLock("mail_flusher", 2 * 60 + 30, async () => {
      const { flushDueMailShipments } = await import('../services/mail/mailFlusher');
      const r = await flushDueMailShipments();
      if (r.claimed > 0) log(`[mail-flusher] claimed=${r.claimed} sent=${r.sent} failed=${r.failed}`, 'sovereign');
    }).catch((err: any) => {
      log(`[mail-flusher] failed: ${err?.message ?? err}`, 'sovereign');
    });
  }, THREE_MIN);
}

/**
 * Dispatch reaper — every 10 minutes, marks `solene_dispatch_queue` rows
 * stuck `in_progress` past their own timeout + a 5-minute margin as 'failed'.
 * Those are workers that crashed mid-dispatch: the claim is exactly-once
 * (FOR UPDATE SKIP LOCKED) so the row is never re-claimed, but without a
 * reaper it would pin a queue slot forever. Reaped rows are FAILED, never
 * requeued — an orphan's outward effect may have partially fired, so the
 * safe stance is at-most-once (surface it, never risk a double-send).
 */
function startDispatchReaperJob() {
  const TEN_MIN = 10 * 60 * 1000;
  log('Registering dispatch reaper (every 10m)', 'sovereign');
  trackInterval(async () => {
    // TTL = 9m (≈90% of cadence) so a stuck instance can't double-run it.
    withJobLock("dispatch_reaper", 9 * 60, async () => {
      const { reapOrphanedDispatches } = await import('../services/solene/dispatchQueue');
      const n = await reapOrphanedDispatches();
      if (n > 0) log(`[dispatch-reaper] reaped ${n} orphaned in_progress dispatch(es)`, 'sovereign');
    }).catch((err: any) => {
      log(`[dispatch-reaper] reap failed: ${err?.message ?? err}`, 'sovereign');
    });
  }, TEN_MIN);
}

/**
 * Proof-receipt chain self-verify (Frontier #4) — daily, walks every scope's
 * persisted receipt chain and re-checks the per-row seal + chain linkage. A
 * tamper-evident log is only worth anything if something re-verifies it: a
 * silent corruption (an edited row, a forked chain) becomes a critical page
 * instead of sitting undetected until a regulator/insurer asks for the proof.
 */
function startProofChainAuditJob() {
  const ONE_DAY = 24 * 60 * 60 * 1000;
  log('Registering proof-receipt chain audit (daily)', 'sovereign');
  trackInterval(async () => {
    // Daily — TTL = 23h (≈90% of cadence).
    withJobLock("proof_chain_audit", 23 * 60 * 60, async () => {
      const { auditAllReceiptChains } = await import('../services/autopilot/proofReceiptStore');
      const r = await auditAllReceiptChains();
      if (r.brokenChains.length > 0) {
        const detail = r.brokenChains.map((b) => `${b.scope}: ${b.reason}`).join('; ');
        log(`[proof-chain-audit] BROKEN ${r.brokenChains.length}/${r.scopesChecked} chains — ${detail}`, 'sovereign');
        const { sendSolenePage } = await import('../services/solene/pagerService');
        await sendSolenePage({
          severity: 'critical',
          subject: `Proof-receipt chain integrity broken (${r.brokenChains.length} scope${r.brokenChains.length === 1 ? '' : 's'})`,
          body: `A persisted governance receipt chain failed self-verification — possible tampering or corruption. ${detail}`,
        }).catch(() => { /* paging best-effort; the log line is the durable record */ });
      } else {
        log(`[proof-chain-audit] OK — ${r.receiptsChecked} receipts across ${r.scopesChecked} scopes verify`, 'sovereign');
      }
    }).catch((err: any) => {
      log(`[proof-chain-audit] failed: ${err?.message ?? err}`, 'sovereign');
    });
  }, ONE_DAY);
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
    // Weekly: Sunday 00:xx UTC window — TTL = 60m (covers the window).
    if (now.getUTCDay() === 0 && now.getUTCHours() === 0) {
      withJobLock("strategic_proposals_weekly", 60 * 60, async () => {
        const { runWeeklyProposals } = await import('../services/strategicProposals');
        const r = await runWeeklyProposals();
        log(`[strategic-proposals] weekly ${r.weekKey}: ${r.proposalsCreated} created`, 'sovereign');
      }).catch((err: any) => {
        log(`[strategic-proposals] weekly failed: ${err?.message ?? err}`, 'sovereign');
      });
    }
    // Monthly synthesis: 1st at 10:00 UTC — TTL = 60m.
    if (now.getUTCDate() === 1 && now.getUTCHours() === 10) {
      withJobLock("strategic_proposals_monthly_synthesis", 60 * 60, async () => {
        const { runMonthlySynthesis } = await import('../services/strategicProposals');
        const r = await runMonthlySynthesis();
        log(`[strategic-proposals] synthesis ${r.monthKey}: ${r.synthesizedCount} picked`, 'sovereign');
      }).catch((err: any) => {
        log(`[strategic-proposals] synthesis failed: ${err?.message ?? err}`, 'sovereign');
      });
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
    // Monthly window — TTL = 60m (covers the 12:xx UTC window).
    withJobLock("founder_letter_monthly", 60 * 60, async () => {
      const { generateMonthlyLetter } = await import('../services/founderNarrative');
      const r = await generateMonthlyLetter();
      log(`[founder-letter] generated ${r.monthKey}`, 'sovereign');
    }).catch((err: any) => {
      log(`[founder-letter] generation failed: ${err?.message ?? err}`, 'sovereign');
    });
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
      const { gradeRecentDecisions } = await import('../services/autonomyHealth');
      const { graded } = await gradeRecentDecisions();
      log(`[autonomy-health] initial grade pass: ${graded} decisions`, 'sovereign');
    } catch (err: any) {
      log(`[autonomy-health] initial grade failed: ${err?.message ?? err}`, 'sovereign');
    }
  }, 2 * 60 * 1000);
  trackInterval(async () => {
    // Daily cadence — TTL = 60m (expected-max duration + buffer).
    withJobLock("autonomy_outcome_grader", 60 * 60, async () => {
      const { gradeRecentDecisions } = await import('../services/autonomyHealth');
      const { graded } = await gradeRecentDecisions();
      if (graded > 0) log(`[autonomy-health] graded ${graded} decisions`, 'sovereign');
    }).catch((err: any) => {
      log(`[autonomy-health] grade failed: ${err?.message ?? err}`, 'sovereign');
    });
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
      void (async () => {
        // Frugal Autonomy gate — skip when no inputs changed since
        // yesterday's brief AND the founder hasn't checked in lately.
        // The brief composes 10 agent reports, so a no-op morning saves
        // ~10 Haiku calls.
        const { shouldRunAIJob, recordJobRun, fingerprintOf } = await import(
          "../services/intelligence/coordinator"
        );
        const gate = await shouldRunAIJob("company_briefing", {
          category: "briefing",
          minIntervalMinutes: 18 * 60, // 18h — won't fire twice in one day
          fingerprintInputs: async () => {
            // Coarse input fingerprint: rerun only if active agent count
            // or decisions-inbox depth has materially shifted since last.
            try {
              const { companyAgentService } = await import("../services/companyAgents");
              const { db } = await import("../db");
              const { decisionsInboxItems } = await import("@shared/schema");
              const { sql: sqlOp, eq: eqOp } = await import("drizzle-orm");
              const agents = await companyAgentService.getAllIncludingPaused();
              const [{ n }] = await db
                .select({ n: sqlOp<number>`count(*)` })
                .from(decisionsInboxItems)
                .where(eqOp(decisionsInboxItems.status, "pending"));
              return fingerprintOf({
                activeAgents: agents.filter((a) => a.status === "active").map((a) => a.codename).sort(),
                pendingDecisions: Number(n) || 0,
              });
            } catch {
              // Empty fingerprint is treated as "no match" by shouldRunAIJob
              // (falsy), identical downstream behavior to returning null.
              return "";
            }
          },
        });
        if (!gate.run) {
          log(`Company briefing skipped: ${gate.reason}`, 'sovereign');
          return;
        }
        try {
          await import('../services/companyBriefingGenerator').then(({ generateCompanyBriefing }) =>
            withJobLock('company_briefing_generator', TTL_SECONDS, async () => {
              const result = await generateCompanyBriefing();
              await import('../services/eventMeshPublisher').then(({ eventMeshPublisher }) => {
                eventMeshPublisher.briefingReady(0, { type: 'morning', highlights: 'Daily briefing generated' }).catch(() => {});
              }).catch(() => {});
              wsServer.broadcast('founder:activity', 'briefing_ready', { type: 'morning', timestamp: new Date().toISOString() });
              return result;
            }),
          );
          await recordJobRun("company_briefing");
        } catch (err) {
          log(`Company briefing generation failed: ${err}`, 'sovereign');
        }
      })();
    }
  }, 5 * 60 * 1000); // Check every 5 minutes
}

/**
 * §1026.41 periodic statements — monthly cron.
 *
 * Fires once an hour and checks for the 1st-of-month / 09:00 UTC slot;
 * when matched, walks every active organization and generates one
 * statement per active loan for the previous-month cycle. Idempotent
 * via the (loan_id, cycle_start) unique index — re-running is a no-op.
 *
 * Lock TTL: 50 minutes — generation must finish within 30s per org per
 * the elite-engineering performance budget, but we give head-room for
 * an org with multiple thousand loans + slow PDF rendering.
 */
function startPeriodicStatementsMonthlyJob() {
  const ONE_HOUR = 60 * 60 * 1000;
  const TTL_SECONDS = 50 * 60;

  log('Registering §1026.41 periodic statements monthly job (1st of month, 09:00 UTC)', 'compliance');

  trackInterval(() => {
    const now = new Date();
    const dayOfMonth = now.getUTCDate();
    const utcHour = now.getUTCHours();

    // 1st of the month at 09:00 UTC = the canonical fire slot. The
    // ONE_HOUR interval means we get one shot per hour — the lock
    // guarantees only one process actually runs the work.
    if (dayOfMonth === 1 && utcHour === 9) {
      void withJobLock('periodic_statements_monthly', TTL_SECONDS, async () => {
        const { generateStatementsForCycle } = await import(
          '../services/periodicStatements'
        );
        const { db: dbHandle } = await import('../db');
        const { organizations: orgsTable } = await import('@shared/schema');
        const { sql: sqlOp } = await import('drizzle-orm');

        // Last month's last day — the cycle anchor.
        const asOfDate = new Date(
          Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0),
        );

        const activeOrgs = await dbHandle
          .select({ id: orgsTable.id })
          .from(orgsTable)
          .where(sqlOp`${orgsTable.subscriptionStatus} = 'active'`);

        log(
          `Running §1026.41 statements for ${activeOrgs.length} orgs, asOfDate=${asOfDate.toISOString().slice(0, 10)}`,
          'compliance',
        );

        let totalGenerated = 0;
        let totalErrors = 0;
        for (const org of activeOrgs) {
          try {
            const result = await generateStatementsForCycle(org.id, asOfDate);
            totalGenerated += result.statementsGenerated;
            totalErrors += result.errors.length;
            if (result.errors.length > 0) {
              log(
                `§1026.41 errors for org ${org.id}: ${JSON.stringify(result.errors.slice(0, 5))}`,
                'compliance',
              );
            }
          } catch (err) {
            totalErrors += 1;
            log(`§1026.41 fatal error for org ${org.id}: ${err}`, 'compliance');
          }
        }
        log(
          `§1026.41 monthly run complete — generated=${totalGenerated} errors=${totalErrors}`,
          'compliance',
        );
      }).catch((err) => {
        log(`§1026.41 monthly job failed to acquire lock or run: ${err}`, 'compliance');
      });
    }
  }, ONE_HOUR);
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
      import('../services/trustEvolution').then(({ runTrustEvolution }) => {
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
  // 2m cadence → TTL = ~90% (108s ≈ 1.8m).
  const TTL_SECONDS = 108;

  log('Registering agent reaction processor (every 2 minutes)', 'sovereign');

  trackInterval(() => {
    withJobLock("agent_reaction_processor", TTL_SECONDS, async () => {
      const { processAgentReactions } = await import('../services/agentReactionEngine');
      await processAgentReactions();
    }).catch(err => {
      log(`Agent reaction processor failed: ${err}`, 'sovereign');
    });
  }, TWO_MINUTES);
}

/**
 * Agent Proactive Engine — every 5 minutes.
 * Agents independently check conditions and take initiative.
 */
function startAgentProactiveEngineJob() {
  const FIVE_MINUTES = 5 * 60 * 1000;
  // 5m cadence → TTL = ~90% (4m).
  const TTL_SECONDS = 4 * 60;

  log('Registering agent proactive engine (every 5 minutes)', 'sovereign');

  // Start after 3 minutes to let agents seed first
  setTimeout(() => {
    withJobLock("agent_proactive_engine", TTL_SECONDS, async () => {
      const { runProactiveEngine } = await import('../services/agentProactiveEngine');
      await runProactiveEngine();
    }).catch(err => {
      log(`Proactive engine startup run failed: ${err}`, 'sovereign');
    });
  }, 3 * 60 * 1000);

  trackInterval(() => {
    withJobLock("agent_proactive_engine", TTL_SECONDS, async () => {
      const { runProactiveEngine } = await import('../services/agentProactiveEngine');
      await runProactiveEngine();
    }).catch(err => {
      log(`Proactive engine run failed: ${err}`, 'sovereign');
    });
  }, FIVE_MINUTES);
}

/**
 * v5 Maintenance Job — every 15 minutes.
 * Processes the outcome verification queue and checks for stale goals.
 */
function startV5MaintenanceJob() {
  const FIFTEEN_MINUTES = 15 * 60 * 1000;
  // 15m cadence → TTL = ~90% (13m).
  const TTL_SECONDS = 13 * 60;

  log('Registering v5 maintenance job (every 15 minutes)', 'sovereign');

  trackInterval(() => {
    withJobLock("v5_maintenance", TTL_SECONDS, async () => {
      const { runV5Maintenance } = await import('./v5MaintenanceJob');
      await runV5Maintenance();
    }).catch(err => {
      log(`v5 maintenance run failed: ${err}`, 'sovereign');
    });
  }, FIFTEEN_MINUTES);
}

/**
 * Beatrice (CRO) — Pax continuous-audit. Daily 04:00 UTC sweep that samples
 * recent Pax outputs across every active org and checks them against six
 * constitutional/regulatory detectors. Detection-only — drift signals fire
 * via logger.error + (when configured) Sentry; remediation is the
 * quarterly review.
 *
 * Lock TTL: 30 minutes. The sweep is per-org sequential but each org is
 * fast (≤ sampleSize queries + N regex passes). A 30m TTL covers the
 * 04:xx UTC fire window across worker processes without leaving the lock
 * dangling if the worker dies mid-walk.
 */
function startPaxContinuousAuditJob() {
  const ONE_HOUR = 60 * 60 * 1000;
  const TTL_SECONDS = 30 * 60;

  log('Registering Pax continuous-audit job (daily 04:00 UTC)', 'beatrice');

  trackInterval(() => {
    const now = new Date();
    if (now.getUTCHours() !== 4) return;

    void withJobLock('pax_continuous_audit', TTL_SECONDS, async () => {
      const { walkAllOrgsForAudit } = await import('../services/pax/continuousAudit');
      const result = await walkAllOrgsForAudit();
      log(
        `[pax-audit] daily: considered=${result.orgsConsidered} audited=${result.orgsAudited} skipped=${result.orgsSkipped} drift=${result.totalDriftSignals} errors=${result.errors.length}`,
        'beatrice',
      );
    }).catch((err) => {
      log(`[pax-audit] daily failed to acquire lock or run: ${err}`, 'beatrice');
    });
  }, ONE_HOUR);
}

/**
 * Quinn (Chief of Alignment) — nightly transparency report aggregation.
 *
 * Tahoe wave E9. Aggregates the rolling 90-day window across
 * pax_refusal_payloads, pax_decision_appeals, solene_pre_call_decisions
 * (founder bypass count), and the alignment-detector drift findings.
 * Upserts a transparency_reports row. Publication (setting published_at) is
 * a separate manual gesture — this job only refreshes the draft.
 *
 * Lock TTL: 15 minutes (the aggregation is cheap — a handful of grouped
 * counts). Fires at 05:00 UTC, immediately after Beatrice's 04:00 audit so
 * the report row reflects the latest audit findings.
 */
function startTransparencyReportAggregationJob() {
  const ONE_HOUR = 60 * 60 * 1000;
  const TTL_SECONDS = 15 * 60;

  log(
    'Registering Quinn transparency-report aggregation job (daily 05:00 UTC)',
    'sovereign',
  );

  trackInterval(() => {
    const now = new Date();
    if (now.getUTCHours() !== 5) return;

    void withJobLock('transparency_report_aggregation', TTL_SECONDS, async () => {
      const { runTransparencyReportAggregation, checkTransparencyDraftStaleness } = await import(
        './transparencyReportAggregator'
      );
      const reportId = await runTransparencyReportAggregation();
      // Tier 1D dark signal: drafts >30d unpublished → alignment finding
      // via the alert spine (info severity — findings only).
      const staleDraft = await checkTransparencyDraftStaleness();
      log(
        `[transparency-report] daily: report_id=${reportId ?? 'null'} staleDraft=${staleDraft}`,
        'sovereign',
      );
    }).catch((err) => {
      log(
        `[transparency-report] daily failed to acquire lock or run: ${err}`,
        'sovereign',
      );
    });
  }, ONE_HOUR);
}

/**
 * Solene (COO) — self-audit cron.
 *
 * Two cadences honoured by one tick function:
 *  - per-session sweep: every 60 minutes. Honest constraint — Solene can't
 *    detect session boundaries from server-side, so a 60-min poll is the
 *    best proxy for "end of session" granularity.
 *  - per-week sweep: Sunday 23:00 UTC. Captures the broader pattern after
 *    a full week of decisions.
 *
 * Both wrapped in withJobLock so concurrent worker + app processes don't
 * double-fire. Detection only — drift signals fire via logger.error +
 * Sentry; remediation is downstream.
 */
function startSoleneAuditJob() {
  const FIVE_MINUTES = 5 * 60 * 1000;
  log(
    'Registering Solene self-audit job (per-session every 60m, per-week Sun 23:00 UTC)',
    'solene-audit',
  );

  trackInterval(() => {
    const now = new Date();
    // Per-week sweep: Sunday (day=0) at 23:00 UTC, within a 5-min window.
    if (now.getUTCDay() === 0 && now.getUTCHours() === 23 && now.getUTCMinutes() < 5) {
      void withJobLock('solene_audit_per_week', 60 * 60, async () => {
        const { runSoleneAudit } = await import('../services/solene/selfAudit');
        const r = await runSoleneAudit({ scope: 'per-week' });
        log(
          `[solene-audit] per-week: examined=${r.decisionsExamined} findings=${r.findingCount} drift=${r.driftSignalEmitted}`,
          'solene-audit',
        );
      }).catch((err) => {
        log(`[solene-audit] per-week lock error: ${err}`, 'solene-audit');
      });
    }
    // Per-session sweep: every 60 minutes, on the hour (within the 5m poll window).
    if (now.getUTCMinutes() < 5) {
      void withJobLock('solene_audit_per_session', 55 * 60, async () => {
        const { runSoleneAudit } = await import('../services/solene/selfAudit');
        const r = await runSoleneAudit({ scope: 'per-session' });
        if (r.findingCount > 0 || r.driftSignalEmitted) {
          log(
            `[solene-audit] per-session: examined=${r.decisionsExamined} findings=${r.findingCount} drift=${r.driftSignalEmitted}`,
            'solene-audit',
          );
        }
      }).catch((err) => {
        log(`[solene-audit] per-session lock error: ${err}`, 'solene-audit');
      });
    }
  }, FIVE_MINUTES);
}

/**
 * Solene (Phase 7 — continuous loop) — daily morning pulse.
 *
 * Fires at 12:00 UTC (7am ET) once per day. composeMorningPulse() walks
 * live data (capital tracker / agent identity / founder collab /
 * dispatch queue / onboarding funnel / Beatrice findings) and persists
 * a MorningPulseSnapshot to solene_morning_pulse so the Today page
 * reads the freshest data instantly. Phase 0 cost-aware: runs on the
 * existing worker process, not a dedicated machine.
 */
function startSoleneMorningPulseJob() {
  const ONE_HOUR = 60 * 60 * 1000;
  log(
    'Registering Solene morning pulse (daily 12:00 UTC = 7am ET)',
    'solene-pulse',
  );
  // Fire-window check: the previous `getUTCHours()===12 && getUTCMinutes()<5`
  // guard depended on the interval landing inside the 12:00–12:04 UTC window
  // — but trackInterval is anchored to boot time, so a machine that booted
  // at 14:13 UTC fires every subsequent tick at :13 and never inside the
  // window. Surfaced by the 2026-06-05 audit (only 3 morning_pulse rows
  // existed; the 30-min tick was the only thing keeping the table alive).
  //
  // New rule: every hour, if it's at least 12:00 UTC AND no pulse has been
  // persisted yet for today (UTC date), fire. withJobLock idempotently
  // handles concurrent ticks.
  trackInterval(() => {
    const now = new Date();
    if (now.getUTCHours() < 12) return;
    void withJobLock('solene_morning_pulse', 30 * 60, async () => {
      const { composeMorningPulse, persistMorningPulse, getLatestMorningPulse } =
        await import('../services/solene/continuousLoop');
      const latest = await getLatestMorningPulse();
      if (latest) {
        const latestDay = latest.generatedAt.toISOString().slice(0, 10);
        const today = now.toISOString().slice(0, 10);
        if (latestDay === today) return; // already wrote today's row
      }
      const snap = await composeMorningPulse();
      const persisted = await persistMorningPulse(snap);
      log(
        `[solene-pulse] generated id=${persisted.pulseId} oneLine="${snap.oneLine}"`,
        'solene-pulse',
      );
    }).catch((err) =>
      log(`[solene-pulse] failed: ${err}`, 'solene-pulse'),
    );
  }, ONE_HOUR);
}

/**
 * Solene (Phase 7 — continuous loop) — between-session tick.
 *
 * Fires every 30 minutes from the worker. runContinuousTick() scans
 * open founder asks + recent dispatch terminal states + the code-review
 * queue, refreshes the morning pulse if older than 6h, and surfaces
 * counters for cron observability. Enqueue logic for remediation
 * dispatches stays inside the dedicated queue services so we don't
 * double-fire alongside their own guardrails.
 */
function startSoleneContinuousTickJob() {
  const THIRTY_MINUTES = 30 * 60 * 1000;
  const TTL_SECONDS = 25 * 60;
  log(
    'Registering Solene continuous tick (every 30 minutes)',
    'solene-continuous',
  );
  // First run 120s after boot so other services initialise first.
  setTimeout(() => {
    void withJobLock('solene_continuous_tick', TTL_SECONDS, async () => {
      const { runContinuousTick } = await import(
        '../services/solene/continuousLoop'
      );
      const r = await runContinuousTick();
      log(
        `[solene-continuous] tick: signals=${r.signalsScanned} dispatches=${r.dispatchesQueued} asks=${r.asksFiredToFounder} errors=${r.errors}`,
        'solene-continuous',
      );
    }).catch((err) =>
      log(`[solene-continuous] tick failed: ${err}`, 'solene-continuous'),
    );
  }, 120 * 1000);
  trackInterval(() => {
    void withJobLock('solene_continuous_tick', TTL_SECONDS, async () => {
      const { runContinuousTick } = await import(
        '../services/solene/continuousLoop'
      );
      const r = await runContinuousTick();
      if (
        r.signalsScanned > 0 ||
        r.dispatchesQueued > 0 ||
        r.asksFiredToFounder > 0 ||
        r.errors > 0
      ) {
        log(
          `[solene-continuous] tick: signals=${r.signalsScanned} dispatches=${r.dispatchesQueued} asks=${r.asksFiredToFounder} errors=${r.errors}`,
          'solene-continuous',
        );
      }
    }).catch((err) =>
      log(`[solene-continuous] tick failed: ${err}`, 'solene-continuous'),
    );
  }, THIRTY_MINUTES);
}

/**
 * Founder Autopilot — loop-stall watchdog.
 *
 * The autopilot's one un-silenceable failure is going dark. This independent
 * observer reads the loop's heartbeat (latest morning pulse) + the dispatch
 * queue and pages the founder if the loop has STALLED. It runs on its own
 * interval (offset from the tick) so a wedged tick can't suppress its own
 * alarm. Paging is debounced to once per 6h so a persistent stall doesn't spam.
 */
let lastStallPageAt = 0;
function startSoleneLoopWatchdogJob() {
  const THIRTY_MINUTES = 30 * 60 * 1000;
  const SIX_HOURS = 6 * 60 * 60 * 1000;
  const TTL_SECONDS = 5 * 60;
  log('Registering Solene loop-stall watchdog (every 30 minutes)', 'solene-watchdog');
  const runOnce = async () => {
    await withJobLock('solene_loop_watchdog', TTL_SECONDS, async () => {
      const { observeLoopHealth } = await import('../services/autopilot/loopStall');
      const v = await observeLoopHealth();
      if (v.severity !== 'healthy') {
        log(`[solene-watchdog] ${v.summary}`, 'solene-watchdog');
      }
      if (v.shouldPageFounder && Date.now() - lastStallPageAt > SIX_HOURS) {
        lastStallPageAt = Date.now();
        const { sendSolenePage } = await import('../services/solene/pagerService');
        await sendSolenePage({
          severity: 'critical',
          subject: 'Autopilot loop has stalled',
          body: v.summary,
        });
        log('[solene-watchdog] paged founder: loop stalled', 'solene-watchdog');
      }
    }).catch((err) =>
      log(`[solene-watchdog] failed: ${err}`, 'solene-watchdog'),
    );
  };
  // First run 180s after boot (after the tick's first run at 120s) so a fresh
  // pulse exists before we judge liveness.
  setTimeout(() => void runOnce(), 180 * 1000);
  trackInterval(() => void runOnce(), THIRTY_MINUTES);
}

/**
 * Solene (COO) — team-state map regenerator.
 *
 * Runs scripts/regenerate-team-state.mjs every 15 minutes so the auto-
 * generated section of docs/internal/solene-team-state.md stays fresh.
 * Solene loads that file on session start (per the session-start protocol
 * in team_solene.md) — a stale map is worse than an empty one because it
 * encourages dispatch collisions.
 *
 * The script itself is a thin node binary (no DB writes); we shell out to
 * keep the cron path identical to the manual `node scripts/...` invocation
 * so debug parity is trivial. withJobLock keeps multi-process worker + app
 * from double-firing.
 */
async function processSoleneTeamStateRegenerator(): Promise<void> {
  const { spawn } = await import("node:child_process");
  const path = await import("node:path");
  const scriptPath = path.resolve(process.cwd(), "scripts/regenerate-team-state.mjs");
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [scriptPath], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        // Inside the prod container we never want the regenerator to
        // hit the public health endpoint from itself — same-host curl
        // can loop and consume request slots. Skip it; the daily-pulse
        // workflow already publishes health independently.
        SOLENE_TEAM_STATE_SKIP_HEALTHCHECK: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (err) => rejectPromise(err));
    child.on("exit", (code) => {
      if (code === 0) return resolvePromise();
      rejectPromise(
        new Error(`regenerate-team-state exit ${code}: ${stderr.slice(0, 500)}`),
      );
    });
  });
}

/**
 * Solene (Layer 1 cap #2) — agent-claims expiry sweep.
 *
 * Walks active rows in solene_agent_claims whose claimed_at + ttl_minutes
 * is in the past and flips them to status='expired'. Without this, a crashed
 * dispatch or a forgotten releaseClaim() would leave a stale row blocking
 * future commits forever.
 *
 * Tiny job — runs every 5 minutes; ttl-lock slightly less than interval.
 */
function startAgentClaimsExpiryJob() {
  const FIVE_MINUTES = 5 * 60 * 1000;
  const TTL_SECONDS = 4 * 60 + 30;
  log(
    'Registering Solene agent-claims expiry job (every 5 minutes)',
    'agent-claims',
  );

  // Initial run 60s after startup so leftover rows from a crashed worker
  // clear quickly.
  setTimeout(() => {
    withJobLock('solene_agent_claims_expiry', TTL_SECONDS, async () => {
      const { expireStaleClaims } = await import('../services/solene/agentClaims');
      const n = await expireStaleClaims();
      if (n > 0) {
        log(`[agent-claims] expired ${n} stale claim(s) on startup`, 'agent-claims');
      }
    }).catch((err) => {
      log(`[agent-claims] initial expiry run failed: ${err}`, 'agent-claims');
    });
  }, 60 * 1000);

  trackInterval(() => {
    withJobLock('solene_agent_claims_expiry', TTL_SECONDS, async () => {
      const { expireStaleClaims } = await import('../services/solene/agentClaims');
      const n = await expireStaleClaims();
      if (n > 0) {
        log(`[agent-claims] expired ${n} stale claim(s)`, 'agent-claims');
      }
    }).catch((err) => {
      log(`[agent-claims] expiry run failed: ${err}`, 'agent-claims');
    });
  }, FIVE_MINUTES);
}

function startSoleneTeamStateRegeneratorJob() {
  // The regenerator script writes to ./docs/internal/ and depends on the
  // git working tree being present. On Fly machines neither is true:
  //   - /app has no .git (the Docker build copies source without the
  //     repo history)
  //   - /app/docs/internal/ doesn't exist and the runtime user can't
  //     mkdir under /app
  // Every interval failed with EACCES + "not a git repository" + emailed
  // the founder. Surfaced by the 2026-06-05 audit — Tom's inbox had been
  // getting an alert every 15 minutes since the regenerator was wired.
  //
  // Gate off in Fly (FLY_APP_NAME is automatically set on every machine).
  // The job is meaningful only in environments where the local repo +
  // writable docs/ tree exist (developer machine, CI before commit).
  if (process.env.FLY_APP_NAME) {
    log(
      'Skipping Solene team-state regenerator (Fly environment — script requires local git + writable docs/)',
      'solene-team-state',
    );
    return;
  }

  const FIFTEEN_MINUTES = 15 * 60 * 1000;
  const TTL_SECONDS = 14 * 60; // slightly less than interval
  log(
    'Registering Solene team-state regenerator (every 15 minutes)',
    'solene-team-state',
  );

  // Initial run 90s after startup so the file is fresh even on first boot.
  setTimeout(() => {
    withJobLock('solene_team_state_regenerator', TTL_SECONDS, processSoleneTeamStateRegenerator).catch((err) => {
      log(`[solene-team-state] initial run failed: ${err}`, 'solene-team-state');
    });
  }, 90 * 1000);

  trackInterval(() => {
    withJobLock('solene_team_state_regenerator', TTL_SECONDS, processSoleneTeamStateRegenerator).catch((err) => {
      log(`[solene-team-state] run failed: ${err}`, 'solene-team-state');
    });
  }, FIFTEEN_MINUTES);
}

/**
 * Solene (COO) — weekly retrospective generator.
 *
 * Runs scripts/generate-weekly-retro.mjs every Sunday at 23:00 UTC so a
 * fresh `docs/company/retros/<YYYY-Www>.md` skeleton lands at week-end
 * with auto-pulled sections (commits + audit findings + capital + dispatch
 * counts) already populated. Solene then hand-edits the manual sections
 * (surprises / patterns / founder-visible summary) during her end-of-week
 * digest pass.
 *
 * The 5-minute poll window covers the exact Sunday-23:00-UTC trigger; a
 * single per-week run is enforced by withJobLock + the script's
 * file-exists idempotency.
 */
async function processSoleneWeeklyRetro(): Promise<void> {
  const { spawn } = await import("node:child_process");
  const path = await import("node:path");
  const scriptPath = path.resolve(process.cwd(), "scripts/generate-weekly-retro.mjs");
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [scriptPath], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (err) => rejectPromise(err));
    child.on("exit", (code) => {
      if (code === 0) return resolvePromise();
      rejectPromise(
        new Error(`generate-weekly-retro exit ${code}: ${stderr.slice(0, 500)}`),
      );
    });
  });
}

function startSoleneWeeklyRetroJob() {
  log(
    'Registering Solene weekly retro generator (Sundays 23:00 UTC)',
    'solene-retro',
  );

  const FIVE_MINUTES = 5 * 60 * 1000;
  trackInterval(() => {
    const now = new Date();
    // Sunday = 0, hour 23, within a 5-minute window so cron drift can't miss it.
    if (now.getUTCDay() === 0 && now.getUTCHours() === 23 && now.getUTCMinutes() < 5) {
      withJobLock('solene_weekly_retro', 60 * 60, processSoleneWeeklyRetro).catch((err) => {
        log(`[solene-retro] weekly run failed: ${err}`, 'solene-retro');
      });
    }
  }, FIVE_MINUTES);
}

/**
 * Solene (COO) — monthly team-member review generator.
 *
 * Cadence: 1st of every month at 09:00 UTC, within a 5-minute window.
 * Rotation by month % 4 (Iris → Soren → Beatrice → Krieger) is computed
 * inside the script. Auto-pulled top, Solene-filled bottom.
 *
 * Script idempotent: re-running same (month, member) is no-op unless
 * --force.
 */
async function processMonthlyTeamMemberReview(): Promise<void> {
  const { spawn } = await import("node:child_process");
  const path = await import("node:path");
  const scriptPath = path.resolve(
    process.cwd(),
    "scripts/generate-team-member-review.mjs",
  );
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [scriptPath], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (err) => rejectPromise(err));
    child.on("exit", (code) => {
      if (code === 0) return resolvePromise();
      rejectPromise(
        new Error(
          `generate-team-member-review exit ${code}: ${stderr.slice(0, 500)}`,
        ),
      );
    });
  });
}

function startMonthlyTeamMemberReviewJob() {
  log(
    'Registering Solene monthly team-member review (1st of month, 09:00 UTC)',
    'solene-team-review',
  );

  const FIVE_MINUTES = 5 * 60 * 1000;
  trackInterval(() => {
    const now = new Date();
    // 1st of month, 09:00 UTC, ±5 minutes
    if (
      now.getUTCDate() === 1 &&
      now.getUTCHours() === 9 &&
      now.getUTCMinutes() < 5
    ) {
      withJobLock(
        'solene_monthly_team_member_review',
        60 * 60,
        processMonthlyTeamMemberReview,
      ).catch((err) => {
        log(`[solene-team-review] monthly run failed: ${err}`, 'solene-team-review');
      });
    }
  }, FIVE_MINUTES);
}

/**
 * Solene (COO) — quarterly arc-review generator.
 *
 * Cadence: 1st of Jan/Apr/Jul/Oct at 09:00 UTC, within a 5-minute window.
 * Script picks the just-ended quarter via "yesterday's date" so the
 * 1st-of-month run lands in the prior quarter. Auto-pulled top,
 * Solene-filled bottom.
 */
async function processQuarterlySoleneArcReview(): Promise<void> {
  const { spawn } = await import("node:child_process");
  const path = await import("node:path");
  const scriptPath = path.resolve(
    process.cwd(),
    "scripts/generate-solene-arc-review.mjs",
  );
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [scriptPath], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (err) => rejectPromise(err));
    child.on("exit", (code) => {
      if (code === 0) return resolvePromise();
      rejectPromise(
        new Error(
          `generate-solene-arc-review exit ${code}: ${stderr.slice(0, 500)}`,
        ),
      );
    });
  });
}

/**
 * Solene v3 — TEAM-SYSTEM audit cron.
 *
 * Two cadences honoured by one tick function:
 *  - continuous: every 60 minutes. Runs scanners 1/2/3/5/6 (cross-team
 *    handoff, coordination, anti-fragmentation, synergy, elite-bar
 *    trajectory). Cheap, mostly git + filesystem.
 *  - weekly: Sunday 04:00 UTC. Runs the outside-in benchmark scanner
 *    (RSS feed pull + keyword surfacing). Quarterly cadence per the
 *    directive's "honest constraint" caveat is achieved by gating the
 *    weekly run on the benchmark-feed-source returning items — when the
 *    feed accessor returns [], the scan is a no-op.
 *
 * Both wrapped in withJobLock so concurrent worker + app processes
 * don't double-fire. Detection only — drift signals fire via
 * logger.error + (when configured) Sentry tag team_system_audit_drift.
 * Remediation is downstream via Solene's morning brief + retros.
 */
function startTeamSystemAuditJob() {
  const FIVE_MINUTES = 5 * 60 * 1000;
  log(
    'Registering Solene team-system audit (continuous every 60m, weekly Sun 04:00 UTC)',
    'team-system-audit',
  );

  trackInterval(() => {
    const now = new Date();
    // Weekly outside-in benchmark sweep: Sunday (day=0) at 04:00 UTC, within a 5-min window.
    if (
      now.getUTCDay() === 0 &&
      now.getUTCHours() === 4 &&
      now.getUTCMinutes() < 5
    ) {
      void withJobLock('team_system_audit_weekly', 30 * 60, async () => {
        const { runTeamSystemAudit } = await import(
          '../services/team-system-audit'
        );
        const r = await runTeamSystemAudit({ scope: 'weekly' });
        log(
          `[team-system-audit] weekly: dims=${r.dimensionsScanned.length} findings=${r.findingCount} drift=${r.driftSignalEmitted}`,
          'team-system-audit',
        );
      }).catch((err) => {
        log(`[team-system-audit] weekly lock error: ${err}`, 'team-system-audit');
      });
    }
    // Continuous sweep: every 60 minutes, on the hour (within the 5m poll window).
    if (now.getUTCMinutes() < 5) {
      void withJobLock('team_system_audit_continuous', 55 * 60, async () => {
        const { runTeamSystemAudit } = await import(
          '../services/team-system-audit'
        );
        const r = await runTeamSystemAudit({ scope: 'continuous' });
        if (r.findingCount > 0 || r.driftSignalEmitted) {
          log(
            `[team-system-audit] continuous: dims=${r.dimensionsScanned.length} findings=${r.findingCount} drift=${r.driftSignalEmitted}`,
            'team-system-audit',
          );
        }
      }).catch((err) => {
        log(`[team-system-audit] continuous lock error: ${err}`, 'team-system-audit');
      });
    }
  }, FIVE_MINUTES);
}

function startQuarterlySoleneArcReviewJob() {
  log(
    'Registering Solene quarterly arc review (1st of Jan/Apr/Jul/Oct, 09:00 UTC)',
    'solene-arc-review',
  );

  const FIVE_MINUTES = 5 * 60 * 1000;
  // Months are 0-indexed: 0=Jan, 3=Apr, 6=Jul, 9=Oct.
  const QUARTER_START_MONTHS = new Set([0, 3, 6, 9]);
  trackInterval(() => {
    const now = new Date();
    if (
      now.getUTCDate() === 1 &&
      QUARTER_START_MONTHS.has(now.getUTCMonth()) &&
      now.getUTCHours() === 9 &&
      now.getUTCMinutes() < 5
    ) {
      withJobLock(
        'solene_quarterly_arc_review',
        60 * 60,
        processQuarterlySoleneArcReview,
      ).catch((err) => {
        log(`[solene-arc-review] quarterly run failed: ${err}`, 'solene-arc-review');
      });
    }
  }, FIVE_MINUTES);
}

// ── Phase 0 hardening — daily OFAC SDN list refresh ────────────────────────
// Downloads the public Treasury sdn.csv, hashes (name+country) tuples, and
// rebuilds the sanctions_list table. Runs at 03:30 UTC daily (low-traffic
// window). Idempotent — re-running just rebuilds the table.
function startOfacSdnRefreshJob() {
  log('Registering OFAC SDN refresh job (daily ~03:30 UTC)', 'sanctions');
  // 5-minute poll window so we don't miss the 03:30 hour due to drift.
  trackInterval(() => {
    const now = new Date();
    if (now.getUTCHours() !== 3 || now.getUTCMinutes() >= 35 || now.getUTCMinutes() < 30) {
      return;
    }
    withJobLock("ofac_sdn_refresh", 23 * 60 * 60, async () => {
      const { refreshOfacSdnList } = await import("../services/sanctionsList");
      const result = await refreshOfacSdnList();
      log(
        `OFAC SDN refresh: fetched=${result.fetched} inserted=${result.inserted} duration=${result.durationMs}ms${result.error ? ` error=${result.error}` : ""}`,
        'sanctions',
      );
      jobSupervisor.notifyResult('ofac_sdn_refresh', 24 * 60 * 60 * 1000, !result.error, undefined, result.error);
    }).catch((err) => {
      log(`OFAC SDN refresh lock error: ${err}`, 'sanctions');
    });
  }, 5 * 60 * 1000);
}

// ── Beatrice (CRO) — daily OFAC sanctions LIST ENTRIES sync ─────────────────
// Fetches the public Treasury SDN + Consolidated data files (sdn.csv +
// consolidated/cons_prim.csv, plus alt/add companions), parses them, and
// UPSERTs the CLEARTEXT entries into sanctions_list_entries — the live cached
// list that backs the ADVISORY fuzzy name-matcher
// (server/services/compliance/ofacScreening.ts). Runs at ~04:00 UTC daily so it
// staggers off the 03:30 hash-gate refresh above.
//
// Resilient: a fetch/parse failure for either list logs + skips that list and
// leaves the existing cached rows intact — good data is never wiped. ADVISORY
// only: a match is a founder-visible flag for MANUAL review, never a block.
function startSanctionsListEntriesSyncJob() {
  log('Registering OFAC sanctions list-entries sync job (daily ~04:00 UTC)', 'sanctions');
  // 5-minute poll window so we don't miss the 04:00 hour due to drift.
  trackInterval(() => {
    const now = new Date();
    if (now.getUTCHours() !== 4 || now.getUTCMinutes() >= 5) {
      return;
    }
    withJobLock("sanctions_list_entries_sync", 23 * 60 * 60, async () => {
      const { syncSanctionsLists } = await import("../services/compliance/sanctionsListSync");
      const summary = await syncSanctionsLists();
      const anyError = summary.results.some((r) => r.error);
      log(
        `OFAC list-entries sync: upserted=${summary.totalUpserted} duration=${summary.durationMs}ms ` +
          summary.results.map((r) => `${r.sourceList}=${r.upserted}${r.error ? "(err)" : ""}`).join(" "),
        'sanctions',
      );
      jobSupervisor.notifyResult(
        'sanctions_list_entries_sync',
        24 * 60 * 60 * 1000,
        !anyError,
        undefined,
        anyError ? summary.results.find((r) => r.error)?.error : undefined,
      );
    }).catch((err) => {
      log(`OFAC list-entries sync lock error: ${err}`, 'sanctions');
    });
  }, 5 * 60 * 1000);
}

// ════════════════════════════════════════════════════════════════════════════
// Tess (SRE) — dark-job activation. Six fully-implemented jobs lived in
// server/jobs/ + server/services/ but were never wired into this scheduler, so
// they never ran in production. They follow the canonical OFAC pattern below:
// a 5-minute trackInterval poll, a UTC time-of-day fire window (drift-tolerant),
// and the shared Postgres-backed withJobLock so the multi-instance worker never
// double-runs. Each is idempotent. Staggered into the low-traffic 01:00–08:00
// UTC band so they don't collide with each other or the 03:30/04:00 OFAC jobs.
// ════════════════════════════════════════════════════════════════════════════

// ── Tess #1 — DB index analyzer (daily ~02:00 UTC) ─────────────────────────
// Pure pg_stat_statements / pg_stat_user_tables read. Surfaces slow queries +
// sequential-scan-heavy tables + index suggestions; persists the report. No
// external dep, no AI. Auto-apply stays opt-in via OTEL_AUTO_INDEX inside the
// service. Idempotent — each run just rebuilds the latest report row.
function startIndexAnalyzerJob() {
  log('Registering DB index analyzer (daily ~02:00 UTC)', 'index-analyzer');
  trackInterval(() => {
    const now = new Date();
    if (now.getUTCHours() !== 2 || now.getUTCMinutes() >= 5) {
      return;
    }
    void withJobLock('index_analyzer', 23 * 60 * 60, async () => {
      const { runIndexAnalysis } = await import('./indexAnalyzer');
      const report = await runIndexAnalysis();
      log(
        `Index analysis: slowQueries=${report.slowQueries.length} seqScans=${report.sequentialScans.length} suggestions=${report.suggestions.length}`,
        'index-analyzer',
      );
    }).catch((err) => {
      log(`Index analyzer run failed: ${err}`, 'index-analyzer');
    });
  }, 5 * 60 * 1000);
}

// ── Tess #2 — land credit-score recalculation (daily ~01:00 UTC) ───────────
// Pure compute: finds properties with stale land-credit scores and recomputes
// them, flagging >10pt drops. Idempotent — re-running on fresh scores is a
// no-op. Writes a backgroundJobs audit row per run via the service.
function startLandCreditScoreRecalcJob() {
  log('Registering land credit-score recalculation (daily ~01:00 UTC)', 'land-credit-recalc');
  trackInterval(() => {
    const now = new Date();
    if (now.getUTCHours() !== 1 || now.getUTCMinutes() >= 5) {
      return;
    }
    void withJobLock('land_credit_score_recalc', 23 * 60 * 60, async () => {
      const { runLandCreditScoreRecalculation } = await import('./landCreditScoreRecalculation');
      await runLandCreditScoreRecalculation();
      log('Land credit-score recalculation complete', 'land-credit-recalc');
    }).catch((err) => {
      log(`Land credit-score recalc run failed: ${err}`, 'land-credit-recalc');
    });
  }, 5 * 60 * 1000);
}

// ── Tess #3 — feature-engineering precompute (weekly Sun ~02:30 UTC) ────────
// Pure compute: precomputes location + market ML features per property (capped
// at 1000/run). Weekly cadence keeps the rolling cost bounded; idempotent —
// each run overwrites the stored feature row. Sits 30m after the index
// analyzer so the two heavy Sunday reads don't overlap.
function startFeatureEngineeringJob() {
  log('Registering feature-engineering precompute (weekly Sun ~02:30 UTC)', 'feature-engineering');
  trackInterval(() => {
    const now = new Date();
    if (now.getUTCDay() !== 0 || now.getUTCHours() !== 2 || now.getUTCMinutes() < 30 || now.getUTCMinutes() >= 35) {
      return;
    }
    void withJobLock('feature_engineering', 6 * 60 * 60, async () => {
      const { runFeatureEngineering } = await import('./featureEngineeringJob');
      await runFeatureEngineering();
      log('Feature-engineering precompute complete', 'feature-engineering');
    }).catch((err) => {
      log(`Feature-engineering run failed: ${err}`, 'feature-engineering');
    });
  }, 5 * 60 * 1000);
}

// ── Tess #4 — DB backup (daily ~07:00 UTC, config-gated) ───────────────────
// Wired but DORMANT until S3 creds land: runDbBackupIfConfigured() checks
// DB_BACKUP_S3_BUCKET at run time and logs a structured INFO skip + no-ops if
// unset (a dump to ephemeral container /tmp is worthless across deploys). Lock
// TTL covers a long pg_dump. Never crashes the scheduler.
function startDbBackupJob() {
  log('Registering DB backup (daily ~07:00 UTC, config-gated on DB_BACKUP_S3_BUCKET)', 'dbBackup');
  trackInterval(() => {
    const now = new Date();
    if (now.getUTCHours() !== 7 || now.getUTCMinutes() >= 5) {
      return;
    }
    void withJobLock('db_backup', 60 * 60, async () => {
      const { runDbBackupIfConfigured } = await import('./dbBackup');
      await runDbBackupIfConfigured();
    }).catch((err) => {
      log(`DB backup run failed: ${err}`, 'dbBackup');
    });
  }, 5 * 60 * 1000);
}

// ── Tier 1E — backup RESTORE verification (weekly, Sun ~05:00 UTC) ─────────
// A backup that has never been restored is a hope, not a backup. Downloads
// the latest S3 dump, restores it into a scratch DB, asserts crown-jewel
// row-count parity vs live production within tolerance, writes a
// backup_verified proof row, drops the scratch DB. Config-dormant without
// DB_BACKUP_S3_BUCKET + AWS creds — the SAME predicate backs the roster's
// disabledWhen, so the deadman's config-dormant meta-check keeps the
// dormancy visible instead of silently forgotten. Lock TTL 2h covers a slow
// download + restore. Never crashes the scheduler.
function startBackupRestoreVerifyJob() {
  log('Registering backup restore-verification (weekly Sun ~05:00 UTC, config-gated on DB_BACKUP_S3_BUCKET + AWS creds)', 'backupRestoreVerify');
  trackInterval(() => {
    const now = new Date();
    if (now.getUTCDay() !== 0 || now.getUTCHours() !== 5 || now.getUTCMinutes() >= 5) {
      return;
    }
    void withJobLock('backup_restore_verify', 2 * 60 * 60, async () => {
      const { runBackupRestoreVerification } = await import('./backupRestoreVerify');
      const result = await runBackupRestoreVerification();
      if (result.status === 'failed') {
        // Surface through the job-failure machinery (job_health_logs row +
        // event-mesh jobFailed) — a failed restore-verify must be LOUD.
        throw new Error(`backup restore-verification FAILED: ${result.error ?? 'crown-jewel parity out of tolerance'}`);
      }
    }).catch((err) => {
      log(`Backup restore-verification run failed: ${err}`, 'backupRestoreVerify');
    });
  }, 5 * 60 * 1000);
}

// ── Tess #5 — course-completion check (daily ~08:00 UTC, config-gated) ──────
// Wired but DORMANT until email creds land: runCourseCompletionCheck() checks
// AWS_SES_FROM_EMAIL at run time and logs a structured INFO skip + no-ops if
// unset (the completion path issues certificates AND emails learners — we don't
// want to mutate enrollment state we can't notify on). Idempotent — completed
// enrollments are filtered out. Never crashes the scheduler.
function startCourseCompletionCheckJob() {
  log('Registering course-completion check (daily ~08:00 UTC, config-gated on AWS_SES_FROM_EMAIL)', 'course-completion');
  trackInterval(() => {
    const now = new Date();
    if (now.getUTCHours() !== 8 || now.getUTCMinutes() >= 5) {
      return;
    }
    void withJobLock('course_completion_check', 55 * 60, async () => {
      const { runCourseCompletionCheck } = await import('./courseCompletionCheck');
      await runCourseCompletionCheck();
    }).catch((err) => {
      log(`Course-completion check run failed: ${err}`, 'course-completion');
    });
  }, 5 * 60 * 1000);
}

// ── Iris (CTO) — continuous p95 baseline sampler (every 30m) ────────────────
// Drains the response-time ring buffer (server/middleware/responseTimeRing.ts)
// per IRIS_TRACKED_ENDPOINTS, persists per-window p50/p95/p99 rows to
// iris_perf_samples, then runs the regression detector and logs any findings.
// Findings are detection-only — no Sentry hook yet, just structured warn logs.
// ── Krieger — Mobile-feel continuous audit (every 30 minutes) ───────────────
// Six detectors: touch_target_drift / cross_device_matrix_red / mobile_error_
// boundary_trip / theme_contract_drift / pwa_install_regression /
// real_device_gap. High/critical findings auto-enqueue Krieger fix dispatches
// via the live solene_dispatch_queue.
function startKriegerMobileFeelAuditJob() {
  const THIRTY_MINUTES = 30 * 60 * 1000;
  const TTL_SECONDS = 25 * 60;
  log(
    'Registering Krieger mobile-feel audit (every 30 minutes)',
    'krieger-audit',
  );

  setTimeout(() => {
    void withJobLock('krieger_mobile_feel_audit', TTL_SECONDS, async () => {
      const { runMobileFeelAudit } = await import(
        '../services/krieger/mobileFeelAudit'
      );
      const r = await runMobileFeelAudit();
      log(
        `[krieger-audit] initial run: detectors=${r.detectorsRun} findings=${r.findingsRecorded} dispatches=${r.dispatchesEnqueued} errors=${r.errors}`,
        'krieger-audit',
      );
    }).catch((err) => {
      log(`[krieger-audit] initial run failed: ${err}`, 'krieger-audit');
    });
  }, 90 * 1000);

  trackInterval(() => {
    void withJobLock('krieger_mobile_feel_audit', TTL_SECONDS, async () => {
      const { runMobileFeelAudit } = await import(
        '../services/krieger/mobileFeelAudit'
      );
      const r = await runMobileFeelAudit();
      if (r.findingsRecorded > 0 || r.errors > 0) {
        log(
          `[krieger-audit] run: detectors=${r.detectorsRun} findings=${r.findingsRecorded} dispatches=${r.dispatchesEnqueued} errors=${r.errors}`,
          'krieger-audit',
        );
      }
    }).catch((err) => {
      log(`[krieger-audit] run failed: ${err}`, 'krieger-audit');
    });
  }, THIRTY_MINUTES);
}

function startIrisPerfMonitorJob() {
  const THIRTY_MINUTES = 30 * 60 * 1000;
  const TTL_SECONDS = 25 * 60; // slightly less than interval
  log(
    'Registering Iris perf monitor (every 30 minutes — sample + regression detect)',
    'iris-perf',
  );

  // Run 60s after startup so the ring has a chance to accumulate
  // observations before the first drain.
  setTimeout(() => {
    void withJobLock('iris_perf_monitor', TTL_SECONDS, async () => {
      const { samplePerformance, detectRegression } = await import(
        '../services/iris/perfMonitor'
      );
      const sample = await samplePerformance();
      const regression = await detectRegression();
      log(
        `[iris-perf] sampled windows=${sample.windowsPersisted} obs=${sample.totalObservations} regressions=${regression.regressions.length}`,
        'iris-perf',
      );
    }).catch((err) => {
      log(`[iris-perf] initial run failed: ${err}`, 'iris-perf');
    });
  }, 60 * 1000);

  trackInterval(() => {
    void withJobLock('iris_perf_monitor', TTL_SECONDS, async () => {
      const { samplePerformance, detectRegression } = await import(
        '../services/iris/perfMonitor'
      );
      const sample = await samplePerformance();
      const regression = await detectRegression();
      if (sample.windowsPersisted > 0 || regression.regressions.length > 0) {
        log(
          `[iris-perf] sampled windows=${sample.windowsPersisted} obs=${sample.totalObservations} regressions=${regression.regressions.length}`,
          'iris-perf',
        );
      }
    }).catch((err) => {
      log(`[iris-perf] scheduled run failed: ${err}`, 'iris-perf');
    });
  }, THIRTY_MINUTES);
}

// ── Soren (CGO) — SEO ranking tracker (daily 06:00 UTC) ─────────────────────
// For each /learn page × target keyword, fetches the Google SERP, parses
// the AcreOS rank, persists to soren_seo_rankings, and fires a structured
// logger.warn when rank changes ≥10 positions vs the prior reading.
// Detection-only — no founder push channel; the cron's drift signal is the
// only out-of-band notification.
function startSorenSeoTrackerJob() {
  const ONE_HOUR = 60 * 60 * 1000;
  const TTL_SECONDS = 30 * 60;
  log(
    'Registering Soren SEO ranking tracker (daily 06:00 UTC)',
    'soren-seo',
  );

  trackInterval(() => {
    const now = new Date();
    if (now.getUTCHours() === 6 && now.getUTCMinutes() < 5) {
      void withJobLock('soren_seo_tracker', TTL_SECONDS, async () => {
        const { trackRankings } = await import(
          '../services/soren/seoTracker'
        );
        const r = await trackRankings();
        log(
          `[soren-seo] daily run: pages=${r.pagesChecked} keywords=${r.keywordsChecked} persisted=${r.rankingsPersisted} changes=${r.rankChangesDetected} errors=${r.errors}`,
          'soren-seo',
        );
      }).catch((err) => {
        log(`[soren-seo] daily run failed: ${err}`, 'soren-seo');
      });
    }
  }, ONE_HOUR);
}

// ── External-watch: Anthropic API changelog (daily 03:00 UTC) ───────────────
// Layer 1 cap #4 (#17 in 32-cap map). Pulls Anthropic's public release-notes
// feed, keyword-matches against ANTHROPIC_RELEVANCE_KEYWORDS, persists hits
// to external_watch_events. Iris owns the 48h ack SLA per
// docs/internal/anthropic-watch-discipline.md.
function startAnthropicWatchJob() {
  const ONE_HOUR = 60 * 60 * 1000;
  const TTL_SECONDS = 30 * 60;
  log(
    'Registering Anthropic API changelog watch (daily 03:00 UTC)',
    'anthropic-watch',
  );

  trackInterval(() => {
    const now = new Date();
    if (now.getUTCHours() === 3 && now.getUTCMinutes() < 5) {
      void withJobLock('anthropic_watch', TTL_SECONDS, async () => {
        const { fetchAnthropicChangelog } = await import(
          '../services/external-watch/anthropicWatch'
        );
        const r = await fetchAnthropicChangelog();
        log(
          `[anthropic-watch] daily run: fetched=${r.itemsFetched} matched=${r.itemsMatched} persisted=${r.itemsPersisted} dupes=${r.itemsSkippedDuplicate}${r.fetchError ? ` err=${r.fetchError}` : ''}`,
          'anthropic-watch',
        );
      }).catch((err) => {
        log(`[anthropic-watch] daily run failed: ${err}`, 'anthropic-watch');
      });
    }
  }, ONE_HOUR);
}

// ── External-watch: npm vulnerability feed (daily 04:00 UTC) ────────────────
// Layer 1 cap #4 (#17 in 32-cap map). Runs `npm audit --json
// --audit-level=high` and persists each vulnerability as an
// external_watch_events row. Iris owns: 7d ack for high, 24h for critical
// per docs/internal/npm-watch-discipline.md. Critical vulns auto-page
// Solene's channel as severity=urgent.
function startDailyAiCostGuardJob() {
  const ONE_HOUR = 60 * 60 * 1000;
  const TTL_SECONDS = 30 * 60;
  log(
    'Registering daily AI cost guard (00:00 UTC) — sums last-24h spend, emails over $5',
    'ai-cost-guard',
  );
  trackInterval(() => {
    const now = new Date();
    if (now.getUTCHours() === 0 && now.getUTCMinutes() < 30) {
      void withJobLock('daily_ai_cost_guard', TTL_SECONDS, async () => {
        const { runDailyAiCostGuard } = await import(
          '../services/dailyAiCostGuard'
        );
        await runDailyAiCostGuard();
      }).catch((err) => {
        log(`[ai-cost-guard] daily run failed: ${err}`, 'ai-cost-guard');
      });
    }
  }, ONE_HOUR);
}

function startNpmWatchJob() {
  const ONE_HOUR = 60 * 60 * 1000;
  const TTL_SECONDS = 30 * 60;
  log(
    'Registering npm vulnerability watch (daily 04:00 UTC)',
    'npm-watch',
  );

  trackInterval(() => {
    const now = new Date();
    if (now.getUTCHours() === 4 && now.getUTCMinutes() < 5) {
      void withJobLock('npm_watch', TTL_SECONDS, async () => {
        const { fetchNpmVulnerabilities } = await import(
          '../services/external-watch/npmWatch'
        );
        const r = await fetchNpmVulnerabilities();
        log(
          `[npm-watch] daily run: scanned=${r.advisoriesScanned} matched=${r.advisoriesMatched} persisted=${r.advisoriesPersisted} dupes=${r.advisoriesSkippedDuplicate}${r.auditError ? ` err=${r.auditError}` : ''}`,
          'npm-watch',
        );
        // Step-away gap #4 — the immune-response wire. The watch above only
        // RECORDS advisories; this runs the plan→act chain (gated repair plan,
        // self-patch PR when earned + enabled, deduped founder ask for the
        // witnessed class, honesty-ledger report row). Never throws.
        const { runImmuneResponse } = await import(
          '../services/autopilot/immuneResponse'
        );
        const immune = await runImmuneResponse();
        log(
          `[npm-watch] immune response: ${immune.line} selfPatch=${immune.selfPatch.ran ? immune.selfPatch.prUrl ?? 'PR' : immune.selfPatch.reason} ask=${immune.askCreated}`,
          'npm-watch',
        );
      }).catch((err) => {
        log(`[npm-watch] daily run failed: ${err}`, 'npm-watch');
      });
    }
  }, ONE_HOUR);
}

// ── External-watch: Anthropic model-upgrade-path backfill (daily 03:30 UTC) ─
// Layer 4 cap #18. Anthropic-watch's ingest hook already calls
// processWatchEvent inline on every newly-inserted event. This backfill is
// belt-and-suspenders: scans for any anthropic_api events lacking a
// solene_model_upgrade_recommendations row (i.e. the inline hook failed or
// the event predates the hook landing) and processes them. Idempotent via
// the UNIQUE(source_event_id) constraint on the recommendations table.
function startModelUpgradePathBackfillJob() {
  const ONE_HOUR = 60 * 60 * 1000;
  const TTL_SECONDS = 30 * 60;
  log(
    'Registering model-upgrade-path backfill (daily 03:30 UTC)',
    'model-upgrade',
  );

  trackInterval(() => {
    const now = new Date();
    if (now.getUTCHours() === 3 && now.getUTCMinutes() >= 30 && now.getUTCMinutes() < 35) {
      void withJobLock('model_upgrade_backfill', TTL_SECONDS, async () => {
        const { processUnactionedEvents } = await import(
          '../services/external-watch/modelUpgradePath'
        );
        const r = await processUnactionedEvents();
        log(
          `[model-upgrade] backfill: processed=${r.processed} recommended=${r.recommended}`,
          'model-upgrade',
        );
      }).catch((err) => {
        log(`[model-upgrade] backfill failed: ${err}`, 'model-upgrade');
      });
    }
  }, ONE_HOUR);
}

// ── Solene — failure-mode library seeder (boot + daily 05:00 UTC) ───────────
// Layer 3 cap #12. Reads docs/internal/failure-modes/*.md from disk and
// UPSERTs into solene_failure_modes. Disk is the source of truth; the DB
// table backs the per-dispatch prompt injection in dispatchRunner. Boot
// run lands 60s after startup so first-boot prompts get the library
// immediately. Daily run picks up newly-authored failure-mode docs.
function startSoleneFailureModeLibrarySeedJob() {
  const ONE_DAY = 24 * 60 * 60 * 1000;
  const TTL_SECONDS = 30 * 60;
  log(
    'Registering Solene failure-mode library seeder (boot + daily 05:00 UTC)',
    'failure-modes',
  );

  // Initial seed 60s after startup.
  setTimeout(() => {
    void withJobLock('solene_failure_modes_seed', TTL_SECONDS, async () => {
      const { seedFailureModesFromDisk } = await import(
        '../services/solene/failureModeLibrary'
      );
      const r = await seedFailureModesFromDisk();
      log(
        `[failure-modes] initial seed: inserted=${r.inserted} skipped=${r.skipped}`,
        'failure-modes',
      );
    }).catch((err) => {
      log(`[failure-modes] initial seed failed: ${err}`, 'failure-modes');
    });
  }, 60 * 1000);

  // Daily refresh at 05:00 UTC — picks up newly-authored docs.
  trackInterval(() => {
    const now = new Date();
    if (now.getUTCHours() === 5 && now.getUTCMinutes() < 5) {
      void withJobLock('solene_failure_modes_seed', TTL_SECONDS, async () => {
        const { seedFailureModesFromDisk } = await import(
          '../services/solene/failureModeLibrary'
        );
        const r = await seedFailureModesFromDisk();
        log(
          `[failure-modes] daily seed: inserted=${r.inserted} skipped=${r.skipped}`,
          'failure-modes',
        );
      }).catch((err) => {
        log(`[failure-modes] daily seed failed: ${err}`, 'failure-modes');
      });
    }
  }, 60 * 60 * 1000);
}

// ── Beatrice (CRO) — regulatory-news feed (daily 02:00 UTC) ─────────────────
// Pulls daily RSS from CFPB / FTC / state AGs (TX, CA). Each item is
// keyword-filtered against BEATRICE_RELEVANCE_KEYWORDS; matches persist
// to beatrice_reg_events. ON CONFLICT DO NOTHING on (source, source_url)
// means re-runs are idempotent. Beatrice triages within 72h per
// docs/legal/beatrice-regwatch-discipline.md.
function startBeatriceRegWatchJob() {
  const ONE_HOUR = 60 * 60 * 1000;
  const TTL_SECONDS = 30 * 60;
  log(
    'Registering Beatrice regulatory-watch ingest (daily 02:00 UTC)',
    'beatrice-regwatch',
  );

  trackInterval(() => {
    const now = new Date();
    if (now.getUTCHours() === 2 && now.getUTCMinutes() < 5) {
      void withJobLock('beatrice_reg_watch', TTL_SECONDS, async () => {
        const { fetchRegSources } = await import(
          '../services/beatrice/regWatch'
        );
        const r = await fetchRegSources();
        const errCount = Object.keys(r.errorsBySource).length;
        log(
          `[beatrice-regwatch] daily run: sources=${r.sourcesScanned} fetched=${r.itemsFetched} matched=${r.itemsMatched} persisted=${r.itemsPersisted} dupes=${r.itemsSkippedDuplicate} errors=${errCount}`,
          'beatrice-regwatch',
        );
      }).catch((err) => {
        log(`[beatrice-regwatch] daily run failed: ${err}`, 'beatrice-regwatch');
      });
    }
  }, ONE_HOUR);
}

// ============================================================================
// Rafe / Tahoe E3 Sub-3 — NPS prompt scheduler.
//
// Daily 04:15 UTC. For each active org whose primary user (owner) has:
//   - org age >= 21 days since signup AND
//   - no NPS response in the last 90 days AND
//   - no pending nps_prompt_queue row already
// enqueue one row. /api/nps/pending reads the queue on next login.
// The "7 days since last prompt" gate is enforced by the queue itself —
// a row in status='shown' (set by /pending) blocks another insert until
// either the user submits / dismisses or the next scheduler tick after
// the 90-day window passes.
//
// Defensive: bounded to 500 orgs per tick to keep the daily fan-out
// predictable. Self-rescheduling under withJobLock.
// ============================================================================
function startNpsPromptSchedulerJob() {
  const ONE_HOUR_MS = 60 * 60 * 1000;
  const TTL_SECONDS = 55 * 60;

  log('Registering NPS prompt scheduler job (daily 04:15 UTC)', 'nps-scheduler');

  trackInterval(() => {
    const now = new Date();
    if (now.getUTCHours() === 4 && now.getUTCMinutes() >= 15 && now.getUTCMinutes() < 20) {
      void withJobLock('nps_prompt_scheduler', TTL_SECONDS, async () => {
        const { npsResponses, npsPromptQueue, teamMembers } = await import('@shared/schema');
        const twentyOneDaysAgo = new Date(now.getTime() - 21 * 24 * 60 * 60 * 1000);
        const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

        // Eligible orgs: active subscription, owner present, signup >= 21d ago.
        const eligible = await db
          .select({ id: organizations.id, ownerId: organizations.ownerId })
          .from(organizations)
          .where(sql`
            ${organizations.subscriptionStatus} = 'active'
            AND ${organizations.createdAt} <= ${twentyOneDaysAgo}
            AND ${organizations.ownerId} IS NOT NULL
          `)
          .limit(500);

        let enqueued = 0;
        let skippedRecent = 0;
        let skippedPending = 0;

        for (const org of eligible) {
          try {
            // Recency gate: any NPS response in last 90 days → skip the whole
            // org. We've heard from this account recently; don't re-survey it.
            const recentResponse = await db
              .select({ id: npsResponses.id })
              .from(npsResponses)
              .where(sql`
                ${npsResponses.organizationId} = ${org.id}
                AND ${npsResponses.createdAt} >= ${ninetyDaysAgo}
              `)
              .limit(1);
            if (recentResponse.length > 0) { skippedRecent++; continue; }

            // RAFE — per-member NPS. Previously only the org owner was ever
            // surveyed, so seat-expanded accounts' actual users never got asked
            // — exactly the people whose sentiment matters as a team grows. The
            // queue keys on user_id, so we enqueue one row per ACTIVE member
            // who has joined. The owner is included (they're a member). Bounded
            // to 25 members/org to keep the daily fan-out predictable on a large
            // team. Per-(org,user) dedupe means a member with a pending/shown
            // row is never double-queued.
            const members = await db
              .select({ userId: teamMembers.userId })
              .from(teamMembers)
              .where(sql`
                ${teamMembers.organizationId} = ${org.id}
                AND ${teamMembers.isActive} = true
                AND ${teamMembers.joinedAt} IS NOT NULL
              `)
              .limit(25);

            // Fall back to the owner if the org has no team_members rows yet
            // (older accounts created before membership rows were backfilled).
            const targetUserIds = members.length > 0
              ? Array.from(new Set(members.map((m) => m.userId).filter(Boolean)))
              : (org.ownerId ? [org.ownerId] : []);

            for (const userId of targetUserIds) {
              // De-dupe: pending or shown row already for this (org, user) → skip.
              const pendingRow = await db
                .select({ id: npsPromptQueue.id })
                .from(npsPromptQueue)
                .where(sql`
                  ${npsPromptQueue.organizationId} = ${org.id}
                  AND ${npsPromptQueue.userId} = ${userId}
                  AND ${npsPromptQueue.status} IN ('pending', 'shown')
                `)
                .limit(1);
              if (pendingRow.length > 0) { skippedPending++; continue; }

              await db.insert(npsPromptQueue).values({
                organizationId: org.id,
                userId,
                trigger: 'scheduled_quarterly',
                scheduledFor: now,
                status: 'pending',
              });
              enqueued++;
            }
          } catch (rowErr) {
            log(`[nps-scheduler] org ${org.id} enqueue failed: ${rowErr}`, 'nps-scheduler');
          }
        }

        log(
          `[nps-scheduler] daily run: eligible=${eligible.length} enqueued=${enqueued} skippedRecent=${skippedRecent} skippedPending=${skippedPending}`,
          'nps-scheduler',
        );
      }).catch((err) => {
        log(`[nps-scheduler] daily run failed: ${err}`, 'nps-scheduler');
      });
    }
  }, 5 * 60 * 1000);
}

// ============================================================================
// Tier 2C (elevation blueprint) — lifecycle email dispatcher.
//
// Daily 15:05 UTC (morning across US timezones — a check-in email landing at
// 3am local reads as automation; one landing mid-morning reads as a person).
// Finds orgs due for d7_check_in / d30_nps / cancellation_reason_ask and
// dispatches each at most once, ever, per (org, key). Eligibility windows,
// dedupe, and the once-only contract live in jobs/lifecycleDispatch.ts.
// ============================================================================
function startLifecycleDispatchJob() {
  const TTL_SECONDS = 55 * 60;

  log('Registering lifecycle dispatch job (daily 15:05 UTC)', 'lifecycle');

  trackInterval(() => {
    const now = new Date();
    if (now.getUTCHours() === 15 && now.getUTCMinutes() >= 5 && now.getUTCMinutes() < 10) {
      void withJobLock('lifecycle_dispatch', TTL_SECONDS, async () => {
        const { runLifecycleDispatch } = await import('./lifecycleDispatch');
        const counters = await runLifecycleDispatch(now);
        log(
          `[lifecycle-dispatch] daily run: candidates=${counters.candidates} dispatched=${counters.dispatched} skipped=${counters.skipped} noOwnerEmail=${counters.noOwnerEmail} errors=${counters.errors}`,
          'lifecycle',
        );
      }).catch((err) => {
        log(`[lifecycle-dispatch] daily run failed: ${err}`, 'lifecycle');
      });
    }
  }, 5 * 60 * 1000);
}

// ============================================================================
// Rafe — Recourse-loop heartbeat (every 30 minutes).
//
// The recourse loop (server/services/recourseDrafter.ts) turns every negative
// customer signal — a detractor NPS, a ≤2/5 support rating, a real cancellation
// — into a DRAFTED, personal, same-hour founder reply. The drafting brain
// (aggregateAndDraft) was BUILT and bounded for exactly this cadence, but until
// now it only ran lazily inside GET /api/founder/recourse. That made "same-hour
// personal reply" silently degrade to "whenever the founder happens to open the
// tab." This job gives the loop a heartbeat: it sweeps + drafts on a fixed
// cadence so a detractor/cancellation has a ready-to-send personal reply within
// the half-hour, and pushes the founder's phone when new drafts actually land so
// they can act in minutes — without opening anything.
//
// Idempotent + bounded by construction:
//   - aggregateRecourseSignals de-dupes via the (signal_ref_type, signal_ref_id)
//     unique index, so re-running never double-drafts.
//   - aggregateAndDraft caps model fan-out at maxDrafts per tick (25 here).
//   - withJobLock keeps the cross-process tick single-flighted.
// Best-effort throughout: a sweep/draft/push failure logs and never throws.
// ============================================================================
async function processRecourseSweep(): Promise<void> {
  const { runRecourseSweepTick, aggregateAndDraft } = await import(
    '../services/recourseDrafter'
  );
  const { getFounderUserIds, getFounderPrimaryOrgId } = await import(
    '../services/founder'
  );
  const { sendPushToUser } = await import('../services/pushNotificationService');

  // The sweep tick aggregates negative signals + drafts the founder's personal
  // reply (bounded 25/tick via aggregateAndDraft), then — only when NEW drafts
  // land — wakes the founder's phone with a non-incident lifecycle nudge that
  // deep-links to /founder/recourse. The founder + push services are injected
  // so the testable core lives in recourseDrafter.ts.
  const result = await runRecourseSweepTick(
    {
      aggregateAndDraft,
      getFounderPrimaryOrgId,
      getFounderUserIds,
      sendPushToUser,
    },
    { maxDrafts: 25 },
  );

  if (result.inserted > 0 || result.drafted > 0 || result.pushed > 0) {
    log(
      `[recourse-sweep] scanned=${result.scanned} inserted=${result.inserted} drafted=${result.drafted} pushed=${result.pushed}`,
      'recourse-sweep',
    );
  }
}

function startRecourseSweepJob() {
  const THIRTY_MINUTES = 30 * 60 * 1000;
  const TTL_SECONDS = 25 * 60; // Lock TTL slightly less than interval.

  log('Registering recourse-loop sweep job (every 30 minutes)', 'recourse-sweep');

  // First run a few minutes after boot so a fresh deploy seeds the queue
  // without contending with startup work, then every 30 minutes.
  setTimeout(() => {
    withJobLock('recourse_sweep', TTL_SECONDS, processRecourseSweep).catch((err) => {
      log(`Initial recourse sweep failed: ${err}`, 'recourse-sweep');
    });
  }, 4 * 60 * 1000);

  trackInterval(() => {
    withJobLock('recourse_sweep', TTL_SECONDS, processRecourseSweep).catch((err) => {
      log(`Scheduled recourse sweep failed: ${err}`, 'recourse-sweep');
    });
  }, THIRTY_MINUTES);
}

// ============================================================================
// Tahoe E11 — resume expired subscription pauses.
//
// Hourly defensive double-write alongside the customer.subscription.resumed
// webhook. Stripe auto-resumes collection when `pause_collection.resumes_at`
// passes, but if that webhook is missed (or pause was set without a Stripe
// sub on a manual/trial org), this worker clears the DB pause flag so the
// subscriptionPauseGate stops 402-ing the customer. Bounded 500/tick.
// ============================================================================
function startResumeExpiredPausesJob() {
  const TTL_SECONDS = 50 * 60;
  log('Registering resume-expired-pauses job (hourly)', 'pause-resume');

  trackInterval(() => {
    void withJobLock('resume_expired_pauses', TTL_SECONDS, async () => {
      const now = new Date();
      const expired = await db
        .select({ id: organizations.id, stripeSubscriptionId: organizations.stripeSubscriptionId })
        .from(organizations)
        .where(sql`
          ${organizations.subscriptionPaused} = true
          AND ${organizations.subscriptionPauseEndsAt} IS NOT NULL
          AND ${organizations.subscriptionPauseEndsAt} <= ${now}
        `)
        .limit(500);

      let resumed = 0;
      for (const org of expired) {
        try {
          if (org.stripeSubscriptionId) {
            try {
              const { stripeService } = await import('../stripeService');
              await stripeService.resumeSubscription(org.stripeSubscriptionId);
            } catch (stripeErr) {
              // Stripe resume is best-effort; the DB clear below is what
              // un-gates the customer. Stripe also auto-resumes on resumes_at.
              log(`[pause-resume] org ${org.id} stripe resume failed: ${stripeErr}`, 'pause-resume');
            }
          }
          await db.update(organizations)
            .set({
              subscriptionPaused: false,
              subscriptionPausedAt: null,
              subscriptionPauseEndsAt: null,
              subscriptionPauseReason: null,
            })
            .where(eq(organizations.id, org.id));
          resumed++;
        } catch (rowErr) {
          log(`[pause-resume] org ${org.id} resume failed: ${rowErr}`, 'pause-resume');
        }
      }

      if (expired.length > 0) {
        log(`[pause-resume] hourly run: expired=${expired.length} resumed=${resumed}`, 'pause-resume');
      }
    }).catch((err) => {
      log(`[pause-resume] hourly run failed: ${err}`, 'pause-resume');
    });
  }, 60 * 60 * 1000);
}

// ============================================================================
// Tess (SRE) — per-source synthetic data-source probe (every 30 minutes).
// Runs golden parcels through the provider registry on the warm worker and
// asserts each FREE data source still returns the expected shape + a plausible
// value. Writes pass/fail to provider_health + the provider lookup log; raises
// a single data_source_down alert when a source is failing. This is the canary
// that turns "the county changed their API" from a customer ticket into a
// founder alert — see server/jobs/dataSourceProbe.ts.
// ============================================================================
function startDataSourceProbeJob() {
  const THIRTY_MINUTES = 30 * 60 * 1000;
  const TTL_SECONDS = 10 * 60; // probes are fast; 10m lock is plenty

  log('Registering data-source probe job (every 30m)', 'data-source-probe');

  const runOnce = () =>
    import('./dataSourceProbe')
      .then(({ runAndRecordDataSourceProbes }) =>
        withJobLock('data_source_probe', TTL_SECONDS, runAndRecordDataSourceProbes).catch((err) =>
          log(`Data-source probe run failed: ${err}`, 'data-source-probe'),
        ),
      )
      .catch((err) => log(`Data-source probe import failed: ${err}`, 'data-source-probe'));

  // First run 45s after boot (let providers-init + DB settle), then every 30m.
  setTimeout(runOnce, 45_000);
  trackInterval(runOnce, THIRTY_MINUTES);
}

// ============================================================================
// Burn-rate SLO monitor — Tess #3 — every 5 minutes.
// ----------------------------------------------------------------------------
// The push half of the SLO story. routes-error-budget.ts is pull-only (computes
// consumption when the founder opens the page); this watches the SAME SLOs
// against rolling windows so the SLOs defend themselves. Fast burn (≥2% of the
// monthly budget in 1h) pages via notifyOnCall + auto-opens an incidents row
// (detectionSource:"burn_rate") + auto-attaches the post-mortem template; slow
// burn (≥10% in 6h) records a non-paging 'reliability' finding. Open-incident
// dedupe means one sustained outage rings the phone once, not every 5 minutes.
// See server/services/reliability/burnRateMonitor.ts.
// ============================================================================
function startBurnRateMonitorJob() {
  const FIVE_MINUTES = 5 * 60 * 1000;
  const TTL_SECONDS = 4 * 60; // fast job; lock just under the interval

  log('Registering burn-rate SLO monitor job (every 5m)', 'burn-rate');

  const runOnce = () =>
    import('../services/reliability/burnRateMonitor')
      .then(({ runBurnRateMonitor }) =>
        withJobLock('burn_rate_monitor', TTL_SECONDS, runBurnRateMonitor).catch((err) =>
          log(`Burn-rate monitor run failed: ${err}`, 'burn-rate'),
        ),
      )
      .catch((err) => log(`Burn-rate monitor import failed: ${err}`, 'burn-rate'));

  // First run 90s after boot (let telemetry tables + providers settle), then 5m.
  setTimeout(runOnce, 90_000);
  trackInterval(runOnce, FIVE_MINUTES);
}

// ============================================================================
// runScheduledJobs — concatenation of the two former gate-blocks from
// server/index.ts:1032-1660 (main block) + 1706-1735 (supervisor + churn /
// briefing / outcome / telemetry / model / self-assessment / evolution /
// data-retention). Each call below preserves the original surrounding
// comment so the "why this job exists" rationale stays inline.
// ============================================================================
export async function runScheduledJobs(): Promise<void> {

  // Start lead nurturing background job (every 15 minutes)
  startLeadNurturingJob();

  // Start campaign optimization background job (every hour)
  startCampaignOptimizationJob();

  // Start finance agent background job (every 30 minutes)
  startFinanceAgentJob();

  // Lavender Week 10 — recognition worker (deferred-revenue
  // amortisation). Self-rescheduling, hourly cadence.
  void import('../services/recognitionWorker').then(({ startRecognitionWorker }) => {
    startRecognitionWorker();
  });

  // Start API queue background job (every 10 seconds)
  startApiQueueJob();

  // Start alerting background job (every hour)
  startAlertingJob();

  // Start digest background job (every 6 hours)
  startDigestJob();

  // Start domain-audit substrate sweep (daily — Iris shared continuous audit)
  startDomainAuditJob();
  startOperatorCycleJob();

  // Start sequence processor background job (every 60 seconds)
  startSequenceProcessorJob();

  // Start autonomous agent task processor (every 30 seconds)
  import('./autonomousTaskProcessor').then(({ startAutonomousTaskProcessor }) => {
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

  // Deal Hunter background jobs (daily scrape + hourly distress recalc) retired 2026-06-08.

  // EPIC 1: County Assessor ingest pipeline — stub removed (was a no-op
  // log; the real BullMQ worker is registered separately when redis is
  // wired up).

  // EPIC 2: Autonomous Deal Machine (nightly at 1 AM UTC)
  startAutonomousDealMachineJob();

  // Autonomous Health Monitor (hourly self-healing + cost guard)
  startAutonomousHealthMonitorJob();

  // Founder Weekly Digest (Mondays 8 AM CT)
  startFounderWeeklyDigestJob();

  // Customer Concentration (daily 13:00 UTC) — MRR concentration alerts
  startCustomerConcentrationJob();

  // §1026.41 periodic statements — monthly (1st of month, 09:00 UTC).
  // Generates one statement per active loan per org per cycle.
  // Idempotent via (loan_id, cycle_start) unique index.
  startPeriodicStatementsMonthlyJob();

  // Wave 10: Self-tuning cost optimiser (daily, self-rescheduling)
  startCostOptimizerSelfRescheduling();

  // Wave 10: Per-customer unit economics (daily, self-rescheduling)
  startCustomerUnitEconomicsJob();

  // Tahoe L14 follow-up — daily 01:00 UTC. Roll up + purge older-than-30d
  // api_telemetry_samples. Idempotent, system-wide.
  startApiTelemetryRollupJob();

  // Tahoe L6 — daily 06:30 UTC. Reserve floor compliance check against
  // financial_ledger. Logs to reserve_floor_check; never blocks.
  startReserveFloorCheckerJob();

  // Phase 8 Months 10-11 (Ingrid §1): vision-AI scheduled re-imaging
  // Scans properties on a configurable cadence (default 90 days),
  // captures fresh aerial imagery, runs vision analysis, raises a
  // system_alert when change-detection score crosses the threshold.
  import("./propertyVisionReimaging")
    .then(({ startPropertyVisionReimagingJob }) => {
      startPropertyVisionReimagingJob();
    })
    .catch((err) =>
      log(`Vision re-imaging scheduler import failed: ${err}`, "vision-reimaging"),
    );

  // Atlas Morning Brief (Phase E) — daily 7am wall-clock, per-founder
  startAtlasMorningBriefJob();

  // Customer-surface ErrorBoundary spike detector (Solene) — every 15m
  // scan for routes spiking ErrorBoundary trips and page on threshold.
  startErrorBoundarySpikeDetectorJob();

  // Atlas Background-Task Runner (Phase E) — 10s poller on the worker
  startAtlasBackgroundTaskRunner();

  // Atlas Pending-Confirmation Nudger (Phase F) — 60s poller; pushes Tom when
  // a destructive confirmation has been sitting idle past the nudge window.
  startAtlasPendingConfirmationNudger();

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

  // Phase 0 traffic-readiness — daily OFAC SDN list refresh (~03:30 UTC).
  // Required before public acquisition opens; the signup-time hash check
  // (server/services/sanctionsList.ts → checkOfacSdn) reads from this table.
  startOfacSdnRefreshJob();

  // Beatrice — daily OFAC sanctions LIST ENTRIES sync (~04:00 UTC). Fetches the
  // public Treasury SDN + Consolidated data files and UPSERTs the cleartext
  // entries into sanctions_list_entries, the live list backing the ADVISORY
  // fuzzy name-matcher (server/services/compliance/ofacScreening.ts). Resilient:
  // a failed fetch leaves the existing cached list intact.
  startSanctionsListEntriesSyncJob();

  // Beatrice — Pax continuous-audit (daily 04:00 UTC). Samples 20 Pax
  // outputs per active org from the last 24h and runs six constitutional/
  // regulatory detectors. Findings persist to pax_audit_findings; drift
  // signals fire via logger.error + Sentry (when SENTRY_DSN set).
  startPaxContinuousAuditJob();

  // Quinn (Chief of Alignment) — nightly transparency report aggregation
  // (daily 05:00 UTC, immediately after Beatrice's continuous-audit). Rolls
  // up refusals + appeals + founder bypasses + alignment-detector drift
  // findings over the trailing 90 days and upserts a transparency_reports
  // row. Publication (setting published_at) is a separate manual gesture;
  // this job only refreshes the draft.
  startTransparencyReportAggregationJob();

  // Solene — self-audit (per-session every 60m, per-week Sunday 23:00 UTC).
  // Samples recent solene_decisions and scores each through eight
  // discipline detectors. Findings persist to solene_audit_findings;
  // drift signals fire via logger.error + Sentry tag solene_audit_drift.
  startSoleneAuditJob();

  // Solene (Phase 7) — continuous between-session loop. Two registrations
  // share the same continuousLoop.ts service: daily morning-pulse compose
  // at 12:00 UTC + 30m continuous tick (signal scan, late-pulse refresh
  // safety net). Both run on the existing worker — Phase 0 cost-aware,
  // no new Fly machine. Adding a dedicated continuous-Solene machine is a
  // Phase 1+ consideration when revenue justifies the ops complexity.
  startSoleneMorningPulseJob();
  startSoleneContinuousTickJob();
  startSoleneLoopWatchdogJob();

  // Founder Autopilot — seed the per-domain Trust Ledger at the safe default
  // (every domain at OBSERVE) so the autonomy gate has rows to read + the
  // founder UI has a ledger to show. Idempotent (onConflictDoNothing); fire-
  // and-forget so a transient DB hiccup can't block job registration. The gate
  // fails safe regardless — an absent row reads as OBSERVE → block.
  void (async () => {
    try {
      const { ensureDomainsSeeded } = await import('../services/autopilot/domainAutonomy');
      await ensureDomainsSeeded();
      log('[autopilot] Trust Ledger domains seeded (OBSERVE)', 'autopilot');
    } catch (err) {
      log(`[autopilot] domain seed failed (gate still fails safe): ${err}`, 'autopilot');
    }
  })();

  // Iris — continuous p95 baseline (every 30 minutes). Drains the
  // response-time ring buffer for IRIS_TRACKED_ENDPOINTS, persists p50/
  // p95/p99 summaries to iris_perf_samples, and runs the regression
  // detector against the rolling 7d baseline. Detection-only — findings
  // log at warn level for now.
  startIrisPerfMonitorJob();

  // Tess (SRE) — dark-job activation. Six fully-built jobs that were never
  // registered (and so never ran). All lock-guarded + idempotent + staggered
  // across the low-traffic 01:00–08:00 UTC band; the two cred-dependent ones
  // (backup / course-completion) self-skip cleanly until creds land.
  startLandCreditScoreRecalcJob();   // daily ~01:00 UTC
  startIndexAnalyzerJob();           // daily ~02:00 UTC
  startFeatureEngineeringJob();      // weekly Sun ~02:30 UTC
  startDbBackupJob();                // daily ~07:00 UTC (dormant w/o DB_BACKUP_S3_BUCKET)
  startCourseCompletionCheckJob();   // daily ~08:00 UTC (dormant w/o AWS_SES_FROM_EMAIL)
  // Tier 1E — weekly restore-verification of the latest backup (Sun ~05:00
  // UTC; dormant w/o DB_BACKUP_S3_BUCKET + AWS creds — visible via the
  // deadman's config-dormant meta-check, never silently forgotten).
  startBackupRestoreVerifyJob();
  // Note: fairLendingAudit (monthly) is ALREADY registered below via
  // scheduleSelfRescheduling("fair_lending_audit") — not re-wired here.

  // Tess (SRE) — per-source synthetic data-source probe (every 30m). Golden
  // parcels through the registry; asserts each free source returns the expected
  // shape + a plausible value; canary alert on a county/federal API change.
  startDataSourceProbeJob();

  // Tess #3 — burn-rate SLO monitor (every 5m): self-defending SLOs.
  startBurnRateMonitorJob();

  // Krieger — mobile-feel continuous audit (every 30m). 6 detectors with
  // auto-enqueue to live dispatch queue for high/critical findings.
  startKriegerMobileFeelAuditJob();

  // Soren — daily SEO ranking tracker (06:00 UTC). For each /learn page
  // and its target keywords, fetches the Google SERP, parses the AcreOS
  // rank, persists, and warns on ≥10-position drift vs prior reading.
  startSorenSeoTrackerJob();

  // Beatrice — daily regulatory-news ingest (02:00 UTC). Pulls RSS from
  // CFPB, FTC, TX-AG, CA-AG; keyword-filters; persists matches. 72h
  // manual triage SLA per docs/legal/beatrice-regwatch-discipline.md.
  startBeatriceRegWatchJob();

  // Rafe / Tahoe E3 Sub-3 — NPS prompt scheduler (daily 04:15 UTC).
  // Enqueues one nps_prompt_queue row per eligible (org, owner); the
  // dialog reads the queue on next login via /api/nps/pending.
  startNpsPromptSchedulerJob();

  // Tier 2C — lifecycle email dispatcher (daily 15:05 UTC ≈ morning US).
  // Sends d7_check_in / d30_nps / cancellation_reason_ask through
  // lifecycleProgram.sendLifecycleMessage (suppression-checked, audited,
  // CAN-SPAM-compliant transport via the worker's lifecycle_email handler).
  startLifecycleDispatchJob();

  // Rafe — Recourse-loop heartbeat (every 30 minutes). Sweeps negative
  // customer signals into the recourse_drafts ledger and drafts the
  // founder's personal reply (aggregateAndDraft, bounded 25/tick), then
  // pushes the founder's phone when new drafts land so the "same-hour
  // personal reply" promise holds without anyone opening the tab.
  startRecourseSweepJob();

  // Tahoe E11 — resume expired subscription pauses (hourly). Defensive
  // double-write alongside the customer.subscription.resumed webhook:
  // clears subscriptionPaused for any org past subscriptionPauseEndsAt.
  startResumeExpiredPausesJob();

  // External-watch: Anthropic API changelog (daily 03:00 UTC). Layer 1
  // cap #4. Pulls Anthropic release-notes feed; keyword-filters; persists
  // matches. Iris owns 48h ack SLA per
  // docs/internal/anthropic-watch-discipline.md.
  startAnthropicWatchJob();

  // External-watch: npm vulnerabilities (daily 04:00 UTC). Runs
  // `npm audit --json --audit-level=high` and persists each advisory.
  // Iris owns 7d ack (high) / 24h ack (critical) per
  // docs/internal/npm-watch-discipline.md.
  startNpmWatchJob();

  // Daily AI cost guard (00:00–00:29 UTC). Sums all ai_telemetry_events
  // for the prior 24h and emails the founder when the total crosses
  // AI_COST_ALERT_USD_THRESHOLD (default $5). Always logs an
  // `[ai-cost-summary]` line so spend is greppable in Fly logs. This
  // closes the loop that let the 2026-06-05 $30/day burn go unnoticed
  // for weeks — the platform ceiling caps spend in real time, this
  // surfaces what was spent up to the cap.
  startDailyAiCostGuardJob();

  // Layer 4 cap #18 — model-upgrade-path backfill (daily 03:30 UTC).
  // Belt-and-suspenders for the inline anthropic-watch hook; processes any
  // anthropic_api events lacking a solene_model_upgrade_recommendations row.
  startModelUpgradePathBackfillJob();

  // Layer 3 cap #12 — Solene failure-mode library seeder. Initial run 60s
  // after boot + daily refresh at 05:00 UTC. Reads
  // docs/internal/failure-modes/*.md and UPSERTs into solene_failure_modes
  // so dispatchRunner's prompt injection has the latest library available.
  startSoleneFailureModeLibrarySeedJob();

  // Solene (Layer 1 cap #2) — agent-claims expiry sweep (every 5m). Walks
  // solene_agent_claims rows past their TTL and flips them to 'expired' so
  // a crashed dispatch or forgotten releaseClaim() can't leave a stale row
  // blocking future commits via the pre-commit hook.
  startAgentClaimsExpiryJob();

  // Solene — team-state map regenerator (every 15m). Refreshes the
  // auto-generated section of docs/internal/solene-team-state.md so the
  // file Solene loads on session start reflects the current working tree +
  // in-flight agent identities + production state.
  startSoleneTeamStateRegeneratorJob();

  // Solene — weekly retro generator (Sundays 23:00 UTC). Creates the
  // skeleton at docs/company/retros/<YYYY-Www>.md with auto-pulled
  // commits / audit findings / capital / dispatch counts; Solene fills
  // in the manual notes + founder-visible summary during her end-of-week
  // digest pass.
  startSoleneWeeklyRetroJob();

  // Solene — monthly team-member review (1st of month, 09:00 UTC).
  // Rotates Iris → Soren → Beatrice → Krieger by month % 4. Auto-pulls
  // commits / dispatches / findings / capital / elite-bar snapshot /
  // last evolution entry; Solene hand-fills the assessment + tranche-N
  // deliverable + founder-visible paragraph. Stale skeletons (>7d with
  // TODO(solene): markers) are flagged by the checkReviewSkeletonStaleness
  // detector in selfAudit.ts.
  startMonthlyTeamMemberReviewJob();

  // Solene — quarterly arc-review (1st of Jan/Apr/Jul/Oct, 09:00 UTC).
  // Aggregates 13 weeks of solene_audit_findings + solene_decisions +
  // solene_capital_events + solene_page_events; Solene hand-fills the
  // pattern analysis + next-quarter self-development tranche. Same
  // staleness check applies.
  startQuarterlySoleneArcReviewJob();

  // Solene v3 — TEAM-SYSTEM audit (overarching elite-bar audit). Continuous
  // scanners every 60m (cross-team handoff, coordination, anti-fragmentation,
  // synergy, elite-bar trajectory); weekly outside-in benchmark sweep on
  // Sunday 04:00 UTC. Distinct from per-member audits (Pax, Iris perf,
  // Solene self). Drift signals fire via logger.error + Sentry tag
  // team_system_audit_drift.
  startTeamSystemAuditJob();

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

  // Phase B-2 — outcome-driven evolution. Nightly sweep that turns
  // founder rejections + verified failures into proposed prompt
  // revisions. Same founder-approval gate as the monthly meta-agent.
  startOutcomeDrivenEvolutionJob();

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

  // Dispatch reaper — every 10m; fails orphaned in_progress dispatches
  // (worker crashed mid-dispatch) so a dead row can't pin a queue slot.
  startDispatchReaperJob();

  // Mail flusher — every 3m; sends queued mail_shipments past their hold
  // window via Lob + refunds on failure (never charge-without-send).
  startMailFlusherJob();

  // Proof-receipt chain audit — daily; re-verifies every persisted
  // receipt chain and pages on a broken seal/link (Frontier #4).
  startProofChainAuditJob();

  // Customer monthly letters — per-org narrative from Sophie.
  // Fires on the 1st at 15:00 UTC (3h after the founder letter
  // at 12:00 UTC) so the customer wave is not in the same burst.
  startCustomerLetterJob();

  // Wenzeslaus ETL orchestrator — every 5m, sweep etl_jobs and run
  // the ones whose schedule cadence has elapsed. Per-job concurrency
  // is enforced via withJobLock; per-record failures dead-letter to
  // outbox_dlq for /founder/etl replay.
  startEtlOrchestratorJob();

  // Iyari #5 — Parcel delta detector. Every 6h, diff the latest two
  // observations per (apn, field) in parcel_observations for parcels in
  // each customer's pipeline; on a guard-passing owner/tax change, write a
  // parcel_alert + emit the workflow trigger event. Read-only against
  // observations; idempotent via the alert dedupe key.
  startParcelDeltaDetectorJob();

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
  import("./embeddingRefresh").then(({ startEmbeddingRefreshJob }) => {
    startEmbeddingRefreshJob();
    log("Embedding refresh job registered (self-rescheduling, 6m, rolling 7d)", "embedding-refresh");
  }).catch(err => {
    log(`Failed to start embedding refresh job: ${err}`, "embedding-refresh");
  });

  // Auto-seed county GIS endpoints for free parcel lookups
  seedCountyGisEndpointsOnStartup();

  // Start periodic health checks (every 60s). Replaces the service's
  // own startPeriodicChecks() with a lock-gated trackInterval so on a
  // >1 worker scale-out we don't fan out probes N× across the health-
  // checked dependencies. TTL = ~90% of cadence (54s).
  import("../services/healthCheck").then(({ healthCheckService }) => {
    // Initial tick at boot so the dashboard hydrates promptly. Lock-
    // gated so even the warm-up call only fires from one machine.
    withJobLock("health_check_periodic", 54, () => healthCheckService.checkAll())
      .catch(() => {/* boot-time tick: swallow */});
    trackInterval(() => {
      withJobLock("health_check_periodic", 54, () => healthCheckService.checkAll())
        .catch((err: any) => log(`Health check failed: ${err}`, "health-check"));
    }, 60_000);
    log("Health check job registered (every 60s, lock-gated)", "health-check");
  });

  // Start external service status monitoring (Stripe, Twilio, Lob, Regrid).
  // Replaces the service's own startPeriodicMonitoring() interval so the
  // tick is gated by withJobLock — on a >1 worker scale-out we don't
  // fan out probes N× to Stripe/Twilio/Lob/Regrid and we don't write
  // duplicate systemAlerts rows on outage detection. TTL = ~90% (4m).
  // Includes the auto-resolve-on-recovery pass: when a service that was
  // previously alerting on goes back to operational, outstanding alerts
  // are flipped to resolved so the dashboard / inbox clear automatically.
  import("../services/externalStatusMonitor").then(({ externalStatusMonitor }) => {
    trackInterval(() => {
      withJobLock("external_status_monitor", 4 * 60, async () => {
        const outages = await externalStatusMonitor.detectOutages();
        for (const outage of outages) {
          if (outage.status.status === "outage") {
            await externalStatusMonitor.notifyUsersOfOutage(outage.service, outage.impact);
          }
        }
        // Tier 1D — FOUNDER-side signal: customers were told about vendor
        // outages (per-org system_alerts above) but the founder never was.
        // Route every outage/degradation through the alert spine: hard
        // outage = critical (P1 page, throttled per service inside the
        // spine), degraded = warning (finding + system_alerts, no page).
        // alertType is deliberately NOT "external_outage" — that type keys
        // notifyUsersOfOutage's per-org dedupe query, and a founder-level
        // row (organization_id NULL) must never poison it.
        if (outages.length > 0) {
          const { raiseAlert } = await import("../services/alertSpine");
          for (const outage of outages) {
            const isOutage = outage.status.status === "outage";
            await raiseAlert({
              severity: isOutage ? "critical" : "warning",
              source: "external_status_monitor",
              title: `External service ${isOutage ? "OUTAGE" : "degraded"}: ${outage.status.name}`,
              detail:
                `${outage.status.name} is ${outage.status.status}` +
                `${outage.status.message ? ` (${outage.status.message})` : ""}. ${outage.impact}.`,
              dedupeKey: `vendor:${outage.service}`,
              domain: "reliability",
              citedReason:
                "The founder must learn about vendor outages from the platform, not from customers.",
              alertType: "vendor_outage_founder",
              pagePriority: "P1",
              metadata: {
                service: outage.service,
                status: outage.status.status,
                latencyMs: outage.status.latency ?? null,
              },
            }).catch((err: any) =>
              log(`Founder-side vendor alert failed for ${outage.service}: ${err}`, "external-monitor"),
            );
          }
        }
        // Auto-resolve recovered services in the same locked tick.
        const recoveryResult = await externalStatusMonitor.resolveRecoveredServices();
        if (recoveryResult.resolved > 0) {
          log(`Auto-resolved ${recoveryResult.resolved} outage alert(s) across: ${recoveryResult.recovered.join(", ")}`, "external-monitor");
        }
      }).catch((err: any) => log(`External status monitor failed: ${err}`, "external-monitor"));
    }, 5 * 60 * 1000);
    log("External service status monitoring started (every 5 minutes, lock-gated, auto-resolves on recovery)", "external-monitor");
  }).catch(err => {
    log(`Failed to start external status monitoring: ${err}`, "external-monitor");
  });

  // Passive Command Center: Revenue Protection (every 6h) + Founder Digest (daily at 8 AM CST)
  import("../services/revenueProtection").then(({ startRevenueProtectionJob }) => {
    startRevenueProtectionJob(withJobLock).catch((err: any) => {
      log(`Revenue protection job failed: ${err}`, "revenue-protection");
    });
    log("Revenue protection job registered (every 6h, 3-min startup delay)", "revenue-protection");
  }).catch(err => {
    log(`Failed to start revenue protection job: ${err}`, "revenue-protection");
  });

  import("../services/founderDigest").then(({ startFounderDigestJob }) => {
    startFounderDigestJob(withJobLock).catch((err: any) => {
      log(`Founder digest job error: ${err}`, "founder-digest");
    });
    log("Founder digest job registered (hourly check, sends at 8 AM CST)", "founder-digest");
  }).catch(err => {
    log(`Failed to start founder digest job: ${err}`, "founder-digest");
  });

  // ─── Phase B: Event Mesh Drain (every 10 seconds) ──────────────────
  import("../services/eventMeshDrain").then(({ eventMeshDrain }) => {
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
  import("../services/autonomyFinalMile").then(({
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
    // 15m cadence → TTL = ~90% (13m).
    trackInterval(() => {
      withJobLock("check_delegation_completions", 13 * 60, checkDelegationCompletions)
        .catch((err: any) => log(`Delegation completion check failed: ${err}`, "autonomy"));
    }, 15 * 60 * 1000);

    // Retry failed actions (every 30 minutes)
    // 30m cadence → TTL = ~90% (27m).
    trackInterval(() => {
      withJobLock("retry_failed_actions", 27 * 60, retryFailedActions)
        .catch((err: any) => log(`Retry failed actions failed: ${err}`, "autonomy"));
    }, 30 * 60 * 1000);

    // Consensus auto-execution (every 5 minutes)
    // 5m cadence → TTL = ~90% (4m).
    trackInterval(() => {
      withJobLock("execute_resolved_consensus", 4 * 60, executeResolvedConsensus)
        .catch((err: any) => log(`Execute resolved consensus failed: ${err}`, "autonomy"));
    }, 5 * 60 * 1000);

    log("Final mile autonomy jobs registered (summary/delegation/retry/consensus)", "autonomy");
  }).catch(err => {
    log(`Failed to import final mile: ${err}`, "autonomy");
  });

  // ─── Weekly Alert Digest (Sundays at 9 AM UTC / 4 AM CT) ──
  import("../services/alertPolicy").then(({ alertPolicyService }) => {
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
  import("../services/dunning").then(({ dunningService }) => {
    import("./scheduler").then(({ scheduleSelfRescheduling }) => {
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

  // ─── Migration in/out parity workers (every 10s) ──
  // Phase 4 Week 15-16 (Magdalena §1, Tobiah §1): drains import_jobs and
  // export_jobs queues. Each tick claims one queued row via FOR UPDATE
  // SKIP LOCKED so multiple instances coexist safely.
  import("../services/migrationJobs").then(({ runMigrationJobsTick }) => {
    import("./scheduler").then(({ scheduleSelfRescheduling }) => {
      log("Migration jobs worker registered (self-rescheduling, 10s)", "migration");
      scheduleSelfRescheduling({
        name: "migration_jobs",
        intervalMs: 10_000,
        initialDelayMs: 30_000,
        run: runMigrationJobsTick,
      });
    });
  }).catch(err => {
    log(`Failed to import migration jobs worker: ${err}`, "migration");
  });

  // ─── Cost: VM resource tracker (every 5 min) ──
  // Persists memory + CPU + event-loop lag samples to vm_resource_usage
  // so the founder can review 7 days of data and decide whether to drop
  // from 2× performance / 4GB → 2GB / 1 CPU. See migration 0061.
  import("./vmResourceTracker").then(({ captureVmResourceSample, VM_RESOURCE_SAMPLE_INTERVAL_MS }) => {
    import("./scheduler").then(({ scheduleSelfRescheduling }) => {
      log("VM resource tracker registered (self-rescheduling, 5m)", "cost");
      scheduleSelfRescheduling({
        name: "vm_resource_tracker",
        intervalMs: VM_RESOURCE_SAMPLE_INTERVAL_MS,
        initialDelayMs: 60_000,
        run: captureVmResourceSample,
      });
    });
  }).catch(err => {
    log(`Failed to import vm resource tracker: ${err}`, "cost");
  });

  // ─── Cost: Fly off-hours scale-down (every 5 min, flips at 02:00/06:00 UTC) ──
  // Cuts min_machines_running 2→1 between 02:00–06:00 UTC on
  // Sun–Thu UTC. Skips Fri+Sat (mailer prep) and any active P0/P1
  // incident. NEVER scales to zero — see scripts/fly-night-mode.ts.
  if (process.env.NODE_ENV === "production" && process.env.FLY_API_TOKEN) {
    import("../../scripts/fly-night-mode").then(({ runFlyNightModeTick }) => {
      import("./scheduler").then(({ scheduleSelfRescheduling }) => {
        log("Fly night-mode scheduler registered (self-rescheduling, 5m)", "cost");
        scheduleSelfRescheduling({
          name: "fly_night_mode",
          intervalMs: 5 * 60 * 1000,
          initialDelayMs: 90_000,
          run: async () => {
            // 5m cadence → TTL = ~90% (4m). Wraps a Fly API write so
            // two worker generations don't both flip min_machines.
            await withJobLock("fly_night_mode", 4 * 60, async () => {
              await runFlyNightModeTick();
            });
          },
        });
      });
    }).catch(err => {
      log(`Failed to import fly night-mode: ${err}`, "cost");
    });
  } else {
    log("Fly night-mode scheduler skipped (not prod or no FLY_API_TOKEN)", "cost");
  }

  // ─── FW-MARISOL-2: ASC 606 monthly recognition (daily idempotent) ──
  // Recognition is idempotent per (org, period_key, source) so running
  // it daily during the month is fine — each run overwrites the row
  // with current pricing/interval. Production picks up tier/billing
  // changes within 24h; the row at month-end is the canonical close.
  import("../services/revenueRecognition").then(
    ({ runMonthlyRecognition, currentPeriodKey }) => {
      import("./scheduler").then(({ scheduleSelfRescheduling }) => {
        log("Revenue recognition scheduler registered (self-rescheduling, 24h)", "billing");
        scheduleSelfRescheduling({
          name: "asc606_monthly_recognition",
          intervalMs: 24 * 60 * 60 * 1000, // daily
          initialDelayMs: 5 * 60 * 1000, // 5min after boot
          run: async () => {
            await runMonthlyRecognition(currentPeriodKey());
          },
        });
      });
    },
  ).catch(err => {
    log(`Failed to import revenue recognition: ${err}`, "billing");
  });

  // ─── FW-OLU-2: synthetic vendor checks (every 15 min) ──
  // Five checks (SES, Stripe webhook freshness, Clerk proxy, DB
  // writeable, Twilio). Persists to synthetic_check_runs. Founder
  // pulls latest via /api/founder/synthetic-checks/recent.
  import("../services/syntheticChecks").then(({ runAllSyntheticChecks }) => {
    import("./scheduler").then(({ scheduleSelfRescheduling }) => {
      log("Synthetic checks scheduler registered (self-rescheduling, 15m)", "ops");
      scheduleSelfRescheduling({
        name: "synthetic_checks",
        intervalMs: 15 * 60 * 1000,
        initialDelayMs: 3 * 60 * 1000, // 3min after boot
        run: async () => {
          // 15m cadence → TTL = ~90% of cadence (13m).
          await withJobLock("synthetic_checks", 13 * 60, async () => {
            // Detection WITHOUT announcement was the bug: the results were
            // discarded. Inspect them and page on-call if any check is
            // failing (a failing SES/Stripe-webhook/Clerk/DB/Twilio probe is a
            // production-affecting signal). 'degraded' is informational only.
            const results = await runAllSyntheticChecks();
            const failing = results.filter((r) => r.status === "failing");
            if (failing.length > 0) {
              // Tier 1D: route through the alert spine instead of a raw
              // notifyOnCall — the spine's dedupe window means a check that
              // stays failing pages once an hour, not every 15 minutes, and
              // the failure also lands as a finding + system_alerts row.
              const { raiseAlert } = await import("../services/alertSpine");
              for (const r of failing) {
                await raiseAlert({
                  severity: "critical",
                  source: "synthetic_checks",
                  title: `Synthetic check failing: ${r.checkKey}`,
                  detail:
                    `Synthetic vendor check "${r.checkKey}" reported status=failing. ` +
                    `A failing probe means a core dependency (email/Stripe webhook/Clerk proxy/DB/Twilio) ` +
                    `is unreachable or erroring. See synthetic_check_runs for detail.`,
                  dedupeKey: `failing:${r.checkKey}`,
                  domain: "reliability",
                  citedReason: "Synthetic vendor probes assert core dependencies stay reachable (FW-OLU-2).",
                  alertType: "synthetic_check_failing",
                  pagePriority: "P1",
                  metadata: { checkKey: r.checkKey, status: r.status },
                }).catch(() => {/* raiseAlert is internally best-effort */});
              }
            }
          });
        },
      });
    });
  }).catch(err => {
    log(`Failed to import synthetic checks: ${err}`, "ops");
  });

  // ─── Panel-300 #9: reconciliation cron (daily) ──────────────────
  // Compares Stripe MTD-paid total vs revenue_recognition_periods
  // recognized_cents AND vs financial_ledger revenue rows (Tier 2B money
  // spine — divergence on that rule pages critical via the 1D alert spine).
  // Divergence > tolerance → status='divergent' run row + raiseAlert.
  // Tier 2B activation: ensureDefaultRules() self-provisions the two Stripe
  // rules before every run — previously nothing ever seeded
  // reconciliation_rules, so this cron was a registered no-op in prod.
  import("../services/reconciliation").then(({ runReconciliation, ensureDefaultRules }) => {
    import("./scheduler").then(({ scheduleSelfRescheduling }) => {
      log("Reconciliation cron registered (self-rescheduling, 24h)", "billing");
      scheduleSelfRescheduling({
        name: "reconciliation_cron",
        intervalMs: 24 * 60 * 60 * 1000,
        initialDelayMs: 8 * 60 * 1000,
        run: async () => {
          // Daily cadence; TTL = expected max duration + buffer (60m).
          await withJobLock("reconciliation_cron", 60 * 60, async () => {
            await ensureDefaultRules();
            await runReconciliation();
          });
        },
      });
    });
  }).catch(err => {
    log(`Failed to import reconciliation cron: ${err}`, "billing");
  });

  // ─── Tier 2B: ledger dead-letter replay (hourly) ─────────────────
  // Re-dispatches failed financial_ledger postings captured by the Stripe
  // webhook catch blocks (ledger_dead_letters) through the same idempotent
  // posting functions, and raises an alert-spine finding when entries
  // accumulate (warning) or are abandoned after max attempts (critical).
  import("../services/ledgerDeadLetter").then(({ runLedgerDeadLetterSweep }) => {
    import("./scheduler").then(({ scheduleSelfRescheduling }) => {
      log("Ledger dead-letter replay registered (self-rescheduling, 1h)", "billing");
      scheduleSelfRescheduling({
        name: "ledger_dead_letter_replay",
        intervalMs: 60 * 60 * 1000,
        initialDelayMs: 5 * 60 * 1000,
        run: async () => {
          await withJobLock("ledger_dead_letter_replay", 30 * 60, async () => {
            const r = await runLedgerDeadLetterSweep();
            if (r.scanned > 0) {
              log(
                `[ledger-dlq] replayed=${r.replayed} failed=${r.failed} abandoned=${r.abandoned} pending=${r.pendingAfter}`,
                "billing",
              );
            }
          });
        },
      });
    });
  }).catch(err => {
    log(`Failed to import ledger dead-letter replay: ${err}`, "billing");
  });

  // ─── Tier 3F: county market rollup (monthly) ─────────────────────
  // Cross-org data co-op: recomputes the current + previous month's
  // privacy-preserving county rollups (k>=5 floor, value bucketing,
  // structural org-null — see server/services/dataCoop/privacyRollup.ts),
  // records a county_rollup_runs ledger row, raises an alert-spine warning
  // after two consecutive zero-rollup runs, and drafts the quarterly market
  // report at quarter close (draft only — founder reviews; never published).
  import("../services/dataCoop/countyRollupJob").then(({ runCountyMarketRollup }) => {
    import("./scheduler").then(({ scheduleSelfRescheduling }) => {
      log("County market rollup registered (self-rescheduling, 30d)", "data");
      scheduleSelfRescheduling({
        name: "county_market_rollup",
        intervalMs: 30 * 24 * 60 * 60 * 1000,
        initialDelayMs: 18 * 60 * 1000,
        run: async () => {
          // Monthly cadence; TTL = expected max duration + buffer (60m).
          await withJobLock("county_market_rollup", 60 * 60, async () => {
            const r = await runCountyMarketRollup();
            log(
              `[data-coop] counties=${r.countiesScanned} rollups=${r.rollupsWritten} periods=${r.periods.join(",")}`,
              "data",
            );
          });
        },
      });
    });
  }).catch(err => {
    log(`Failed to import county market rollup: ${err}`, "data");
  });

  // ─── Panel-300 #10: disclosure-timing dispatcher (every 1h) ──────
  // Picks up disclosure_timing_scheduled rows where send_date ≤ now
  // AND form is attorney-reviewed; sends + marks 'sent'. TILA timing
  // becomes impossible to violate by manual workflow.
  import("../services/disclosureTimingDispatcher").then(({ runDisclosureTimingDispatch }) => {
    import("./scheduler").then(({ scheduleSelfRescheduling }) => {
      log("Disclosure-timing dispatcher registered (self-rescheduling, 1h)", "compliance");
      scheduleSelfRescheduling({
        name: "disclosure_timing_dispatch",
        intervalMs: 60 * 60 * 1000,
        initialDelayMs: 6 * 60 * 1000,
        run: async () => {
          await withJobLock("disclosure_timing_dispatch", 55 * 60, async () => {
            await runDisclosureTimingDispatch();
          });
        },
      });
    });
  }).catch(err => {
    log(`Failed to import disclosure-timing dispatcher: ${err}`, "compliance");
  });

  // ─── Panel-300 #34: fair-lending audit cron (monthly) ────────────
  // Monthly disparate-impact analysis per org. ≥5% divergence flags.
  import("../services/fairLendingAudit").then(({ runFairLendingAudit }) => {
    import("./scheduler").then(({ scheduleSelfRescheduling }) => {
      log("Fair-lending audit cron registered (self-rescheduling, 30d)", "compliance");
      scheduleSelfRescheduling({
        name: "fair_lending_audit",
        intervalMs: 30 * 24 * 60 * 60 * 1000,
        initialDelayMs: 12 * 60 * 1000,
        run: async () => {
          // Monthly cadence; TTL = expected max duration + buffer (60m).
          await withJobLock("fair_lending_audit", 60 * 60, async () => {
            await runFairLendingAudit();
          });
        },
      });
    });
  }).catch(err => {
    log(`Failed to import fair-lending audit: ${err}`, "compliance");
  });

  // ─── Panel-300 #26: DSAR overdue alert (every 1h) ────────────────
  // Walks dsar_requests_lifecycle for rows where sla_deadline_at < now
  // AND fulfilled_at IS NULL. Logs warning per overdue row so the
  // founder/page-watcher sees them in /founder/dsar/recent. v0: log-
  // only; alert-fan-out is a follow-up.
  import("./scheduler").then(({ scheduleSelfRescheduling }) => {
    log("DSAR overdue-alert cron registered (self-rescheduling, 1h)", "compliance");
    scheduleSelfRescheduling({
      name: "dsar_overdue_alert",
      intervalMs: 60 * 60 * 1000,
      initialDelayMs: 14 * 60 * 1000,
      run: async () => {
        try {
          const { db } = await import("../db");
          const { dsarRequestsLifecycle } = await import("@shared/schema");
          const { and, lte, isNull } = await import("drizzle-orm");
          const overdue = await db
            .select()
            .from(dsarRequestsLifecycle)
            .where(and(
              isNull(dsarRequestsLifecycle.fulfilledAt),
              lte(dsarRequestsLifecycle.slaDeadlineAt, new Date()),
            ));
          if (overdue.length > 0) {
            log(`[DSAR] ${overdue.length} overdue requests — review at /founder/dsar/recent`, "compliance");
          }
        } catch (err) {
          log(`DSAR overdue check failed: ${err}`, "compliance");
        }
      },
    });
  }).catch(err => {
    log(`Failed to register DSAR cron: ${err}`, "compliance");
  });

  // ─── FW-CAMILA-3: pre-churn ladder sweep (daily at boot+10m) ──
  // Walks active orgs, computes days-silent, fires the highest-numbered
  // rung that hasn't been fired (unique-index makes the insert
  // idempotent). The actual outreach for each fired rung is a
  // separate concern (founder reads pre_churn_rungs.status='fired'
  // rows from /admin/support and decides who to call).
  import("../routes-lifecycle").then(() => {
    import("./scheduler").then(({ scheduleSelfRescheduling }) => {
      log("Pre-churn ladder sweep registered (self-rescheduling, 24h)", "lifecycle");
      scheduleSelfRescheduling({
        name: "pre_churn_ladder_sweep",
        intervalMs: 24 * 60 * 60 * 1000,
        initialDelayMs: 10 * 60 * 1000,
        run: async () => {
          const { db } = await import("../db");
          const {
            organizations: organizationsTbl,
            preChurnRungs,
            leads,
            deals,
            notes: notesTable,
          } = await import("@shared/schema");
          const { eq, sql: sqlOp } = await import("drizzle-orm");
          const RUNG_DAYS: Record<string, number> = {
            d5: 5, d10: 10, d14: 14, d21: 21, d30: 30,
          };
          const ladder = ["d30", "d21", "d14", "d10", "d5"] as const;
          const orgRows = await db.select().from(organizationsTbl).limit(10000);
          const now = Date.now();
          for (const org of orgRows) {
            if (org.subscriptionStatus !== "active") continue;
            try {
              const [recentLead] = await db
                .select({ at: sqlOp<string>`max(${leads.createdAt})` })
                .from(leads)
                .where(eq(leads.organizationId, org.id));
              const [recentDeal] = await db
                .select({ at: sqlOp<string>`max(${deals.createdAt})` })
                .from(deals)
                .where(eq(deals.organizationId, org.id));
              const [recentNote] = await db
                .select({ at: sqlOp<string>`max(${notesTable.createdAt})` })
                .from(notesTable)
                .where(eq(notesTable.organizationId, org.id));
              const lastIso = [recentLead?.at, recentDeal?.at, recentNote?.at]
                .filter((x): x is string => !!x)
                .sort()
                .at(-1);
              if (!lastIso) continue;
              const daysSilent = Math.floor(
                (now - new Date(lastIso).getTime()) / (24 * 60 * 60 * 1000),
              );
              const rung = ladder.find((r) => daysSilent >= RUNG_DAYS[r]);
              if (!rung) continue;
              await db
                .insert(preChurnRungs)
                .values({ organizationId: org.id, rung })
                .onConflictDoNothing({
                  target: [preChurnRungs.organizationId, preChurnRungs.rung],
                });
            } catch {/* per-org failure is non-fatal */}
          }
        },
      });
    });
  }).catch(err => {
    log(`Failed to import pre-churn sweep: ${err}`, "lifecycle");
  });

  // ─── Autonomy Bootstrap: seed chains, playbooks, modes, memories, strategies ──
  import("../services/autonomyBootstrap").then(({ bootstrapAutonomy }) => {
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
  import("../services/agentInitiativeEngine").then(({ agentInitiativeEngine }) => {
    log("Agent initiative engine registered (every 30m)", "initiative");
    // 30m cadence → TTL = ~90% (27m). OpenAI-heavy; lock prevents
    // double spend on a >1 worker scale-out.
    const INITIATIVE_TTL_SECONDS = 27 * 60;
    // Run after 5-minute startup delay, then every 30 minutes
    setTimeout(() => {
      // Get any org for initiative scanning (use org 1 as default)
      withJobLock("agent_initiative_engine", INITIATIVE_TTL_SECONDS, () =>
        agentInitiativeEngine.runInitiativeCycle(1),
      ).catch(() => {});
      trackInterval(() => {
        withJobLock("agent_initiative_engine", INITIATIVE_TTL_SECONDS, () =>
          agentInitiativeEngine.runInitiativeCycle(1),
        ).catch((err: any) => {
          log(`Initiative cycle failed: ${err}`, "initiative");
        });
      }, 30 * 60 * 1000);
    }, 5 * 60 * 1000);
  }).catch(err => {
    log(`Failed to import initiative engine: ${err}`, "initiative");
  });

  // ─── Outcome Verification Loop (daily at 2 AM UTC) ──
  import("../services/outcomeVerificationLoop").then(({ outcomeVerificationLoop }) => {
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

  // ── Former second gate-block (server/index.ts:1706-1735) ──
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

  // Rosy River C2: codebase monitor (daily at 4:15am UTC, after evolution deploy window)
  startCodebaseMonitorJob();

  // Rosy River C5: weekly telemetry digest (Sundays at 8:00am UTC)
  startTelemetryDigestJob();

  // Rosy River C6: weekly multi-week planner (Sundays at 9:00am UTC, after digest)
  startMultiWeekPlannerJob();

  // Pillar F / F3: Pax personality drift sampler (Mondays 7am UTC)
  startPersonalityDriftJob();

  // Pillar E / E1: trial expiry automation (daily 9am UTC)
  startTrialExpiryJob();

  // Pillar E / E4+E9: customer health scoring (daily 7am UTC)
  startCustomerHealthJob();

  // Pillar E / E11: onboarding step scheduler (daily 10am UTC)
  startOnboardingSchedulerJob();

  // Data retention: nightly purge of expired rows (3:30am UTC)
  startDataRetentionJob();

  // Kareem §2: quarterly access review (SOC 2 CC6.2) — first Tuesday of
  // Jan/Apr/Jul/Oct at 14:00 UTC. Emails the founder a list of all
  // owner/admin team_members + lastActiveAt + stale flag, persists evidence
  // to audit_events.
  startQuarterlyAccessReviewJob();

  // ─── Rosy River B / county-GIS autonomous discovery (weekly) ──────────
  // Pillar B / B3 — perpetual discovery of new county ArcGIS parcel
  // endpoints. Every Sunday at 5:30am UTC the agent searches ArcGIS Online
  // for "parcel" / "assessor" / "cadastral" services, validates each, and
  // inserts verified rows into county_gis_endpoints. Goal: drive the
  // Regrid fallback rate down by cold-discovering counties our seed list
  // missed.
  import("../services/countyEndpointDiscovery").then(({ runCountyEndpointDiscovery }) => {
    import("./scheduler").then(({ scheduleSelfRescheduling }) => {
      log("County endpoint discovery cron registered (self-rescheduling, 7d)", "data");
      scheduleSelfRescheduling({
        name: "county_endpoint_discovery",
        intervalMs: 7 * 24 * 60 * 60 * 1000,
        initialDelayMs: 30 * 60 * 1000,
        run: async () => {
          await withJobLock("county_endpoint_discovery", 60 * 60, async () => {
            const r = await runCountyEndpointDiscovery({ maxResults: 200 });
            log(
              `[county-discovery] scanned=${r.scanned} candidates=${r.candidatesExtracted} ` +
                `known=${r.alreadyKnown} validated=${r.validated} inserted=${r.inserted} failed=${r.failed}`,
              "data",
            );
          });
        },
      });
    });
  }).catch((err) => {
    log(`Failed to import county discovery cron: ${err}`, "data");
  });

  // ─── Iris/Iyari — demand-driven discovery-on-miss queue drain (30m) ───
  // The weekly cron above does a broad ArcGIS sweep. THIS job drains the
  // county_discovery_queue — the (state, county) pairs enqueued on real
  // parcel-lookup misses + customer "request this county" CTAs — in
  // demand+priority order. For each it probes ArcGIS, inserts the endpoint
  // as isActive=false / redistributable='review-required', and flips active
  // only after a real feature comes back for a test APN. $0, compounding:
  // every miss makes the next customer's lookup for that county hit free.
  import("../services/coverageLedger").then(({ runDiscoveryQueueDrain }) => {
    import("./scheduler").then(({ scheduleSelfRescheduling }) => {
      log("Discovery-on-miss queue drain registered (self-rescheduling, 30m)", "data");
      scheduleSelfRescheduling({
        name: "county_discovery_queue_drain",
        intervalMs: 30 * 60 * 1000,
        initialDelayMs: 5 * 60 * 1000,
        run: async () => {
          await withJobLock("county_discovery_queue_drain", 25 * 60, async () => {
            const r = await runDiscoveryQueueDrain(5);
            if (r.drained > 0) {
              log(
                `[discovery-on-miss] drained=${r.drained} activated=${r.activated} ` +
                  `reviewPending=${r.reviewPending} noCandidate=${r.noCandidate} ` +
                  `exhausted=${r.exhausted} errors=${r.errors}`,
                "data",
              );
            }
          });
        },
      });
    });
  }).catch((err) => {
    log(`Failed to import discovery-on-miss queue drain: ${err}`, "data");
  });

  // ─── Maren/Iris — LandProfile cache pre-warm backfill (15m) ──────────
  // Belt-and-suspenders for the property-create pre-warm hook: catches
  // imported / bulk-added parcels (and any create whose fire-and-forget
  // pre-warm was lost to a cold-machine restart) that have coordinates but no
  // enrichment yet. Warms the fast coordinate-only LandProfile categories
  // (flood/soil/elevation/etc. — no county seeding needed) into the broker
  // cache + persists onto the property, so the first "Land Snapshot" view is a
  // cache hit (<800ms) instead of a cold ~8-endpoint live fetch. Bounded to a
  // small batch per tick to stay polite to the free federal endpoints.
  import("@shared/schema").then(({ properties }) => {
    import("../services/propertyEnrichment").then(({ propertyEnrichmentService }) => {
      import("./scheduler").then(({ scheduleSelfRescheduling }) => {
        log("LandProfile pre-warm backfill registered (self-rescheduling, 15m)", "data");
        scheduleSelfRescheduling({
          name: "land_profile_prewarm",
          intervalMs: 15 * 60 * 1000,
          initialDelayMs: 3 * 60 * 1000,
          run: async () => {
            await withJobLock("land_profile_prewarm", 13 * 60, async () => {
              // Recently-created (last 7d), has coords, never enriched.
              const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
              const pending = await db
                .select({
                  id: properties.id,
                  organizationId: properties.organizationId,
                  latitude: properties.latitude,
                  longitude: properties.longitude,
                  state: properties.state,
                  county: properties.county,
                  apn: properties.apn,
                })
                .from(properties)
                .where(sql`
                  ${properties.latitude} IS NOT NULL
                  AND ${properties.longitude} IS NOT NULL
                  AND ${properties.enrichedAt} IS NULL
                  AND ${properties.createdAt} >= ${sevenDaysAgo}
                `)
                .limit(10);

              let warmed = 0;
              for (const p of pending) {
                const lat = p.latitude ? parseFloat(String(p.latitude)) : NaN;
                const lng = p.longitude ? parseFloat(String(p.longitude)) : NaN;
                if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
                const r = await propertyEnrichmentService.prewarmLandProfile(lat, lng, {
                  organizationId: p.organizationId,
                  propertyId: p.id,
                  state: p.state || undefined,
                  county: p.county || undefined,
                  apn: p.apn || undefined,
                });
                if (r) warmed++;
              }
              if (pending.length > 0) {
                log(`[land-profile-prewarm] candidates=${pending.length} warmed=${warmed}`, "data");
              }
            });
          },
        });
      });
    });
  }).catch((err) => {
    log(`Failed to register LandProfile pre-warm backfill: ${err}`, "data");
  });

  // ─── Pillar T — Stripe drift detector (daily 6:10am UTC) ─────────────
  // Compares the live Stripe account against shared/billing/tier-pricing.ts.
  // Surfaces missing tiers, price drift, and orphan acreos_product
  // entries as /founder/now inbox items. See
  // docs/exhaustive-completion/pillar-t-self-healing-ops.md.
  import("../services/stripeDriftDetector").then(({ runStripeDriftJob }) => {
    import("./scheduler").then(({ scheduleSelfRescheduling }) => {
      log("Stripe drift detector registered (self-rescheduling, 24h)", "ops");
      scheduleSelfRescheduling({
        name: "stripe_drift_detector",
        intervalMs: 24 * 60 * 60 * 1000,
        initialDelayMs: 10 * 60 * 1000,
        run: async () => {
          await withJobLock("stripe_drift_detector", 30 * 60, async () => {
            const r = await runStripeDriftJob();
            if (r.findings.length > 0) {
              log(`[stripe-drift] ${r.findings.length} findings — see /founder/now`, "ops");
            }
          });
        },
      });
    });
  }).catch((err) => {
    log(`Failed to import stripe drift detector: ${err}`, "ops");
  });

  // ─── Vendor secret rotation watcher (daily 6:30am UTC) ───────────────
  // Stripe webhook, GH PAT, Clerk secret, Sentry token. Surfaces a /founder/now
  // inbox item when any secret approaches expiry or returns 401.
  import("../services/vendorSecretRotation").then(({ runVendorSecretRotationWatcher }) => {
    import("./scheduler").then(({ scheduleSelfRescheduling }) => {
      log("Vendor secret rotation watcher registered (self-rescheduling, 24h)", "ops");
      scheduleSelfRescheduling({
        name: "vendor_secret_rotation",
        intervalMs: 24 * 60 * 60 * 1000,
        initialDelayMs: 30 * 60 * 1000,
        run: async () => {
          await withJobLock("vendor_secret_rotation", 30 * 60, async () => {
            const r = await runVendorSecretRotationWatcher();
            const surfaceable = r.findings.filter((f) => f.status === "warning" || f.status === "expired");
            log(
              `[vendor-secret-rotation] vendors=${r.findings.length} surfaced=${surfaceable.length}`,
              "ops",
            );
          });
        },
      });
    });
  }).catch((err) => {
    log(`Failed to import vendor secret rotation: ${err}`, "ops");
  });

  // ─── Pillar R — daily agent-retract cron ─────────────────────────────
  // Walks open agent_proposal_observations rows. Compares telemetry
  // baseline (captured at acceptance) to current snapshot; retracts +
  // demotes trust tier on regression. Marks clean once the 7-day
  // window closes without regression. Critical for Pillar R's
  // "default to ship, retract on regression" guarantee.
  import("../services/agentRetractCron").then(({ runAgentRetractCron }) => {
    import("./scheduler").then(({ scheduleSelfRescheduling }) => {
      log("Agent retract cron registered (self-rescheduling, 24h)", "ops");
      scheduleSelfRescheduling({
        name: "agent_retract_cron",
        intervalMs: 24 * 60 * 60 * 1000,
        initialDelayMs: 25 * 60 * 1000,
        run: async () => {
          await withJobLock("agent_retract_cron", 30 * 60, async () => {
            const r = await runAgentRetractCron();
            log(
              `[agent-retract] evaluated=${r.evaluated} retracted=${r.retracted} cleaned=${r.marked_clean} errors=${r.errors}`,
              "ops",
            );
          });
        },
      });
    });
  }).catch((err) => {
    log(`Failed to import agent retract cron: ${err}`, "ops");
  });

  // ─── Pillar U — monthly pillar review ────────────────────────────────
  // Reads docs/exhaustive-completion/pillar-*.md, scores each on
  // shipped-artifact recency, writes pillar-review-{YYYY-MM-DD}.md,
  // surfaces stale/dead pillars as /founder/now inbox items.
  import("../services/pillarReviewer").then(({ runPillarReviewJob }) => {
    import("./scheduler").then(({ scheduleSelfRescheduling }) => {
      log("Pillar reviewer registered (monthly, 30d interval)", "ops");
      scheduleSelfRescheduling({
        name: "pillar_reviewer",
        intervalMs: 30 * 24 * 60 * 60 * 1000,
        initialDelayMs: 24 * 60 * 60 * 1000,
        run: async () => {
          await withJobLock("pillar_reviewer", 30 * 60, async () => {
            const r = await runPillarReviewJob();
            log(`[pillar-review] stale=${r.staleCount} dead=${r.deadCount}`, "ops");
          });
        },
      });
    });
  }).catch((err) => {
    log(`Failed to import pillar reviewer: ${err}`, "ops");
  });

  // ─── Pillar T — Schema drift detector (daily 6:20am UTC) ─────────────
  // Compares shared/schema.ts to pg_catalog. Surfaces missing tables /
  // columns (likely a migration wasn't applied) as red inbox items.
  // Orphan-column drift gets logged but stays quiet unless it piles up.
  import("../services/schemaDriftDetector").then(({ runSchemaDriftJob }) => {
    import("./scheduler").then(({ scheduleSelfRescheduling }) => {
      log("Schema drift detector registered (self-rescheduling, 24h)", "ops");
      scheduleSelfRescheduling({
        name: "schema_drift_detector",
        intervalMs: 24 * 60 * 60 * 1000,
        initialDelayMs: 20 * 60 * 1000,
        run: async () => {
          await withJobLock("schema_drift_detector", 30 * 60, async () => {
            const r = await runSchemaDriftJob();
            log(`[schema-drift] ${r.findings.length} findings`, "ops");
          });
        },
      });
    });
  }).catch((err) => {
    log(`Failed to import schema drift detector: ${err}`, "ops");
  });

  // ─── Pillar 9.1 — Surface poison jobs into the decision queue (hourly).
  // Watches outbox_dlq and inserts at most one decisions_inbox_items row
  // per (event_type) so the founder sees "N poison jobs in DLQ — review,
  // retry, or discard?" in their inbox.
  import("../routes-founder-dlq").then(({ surfacePoisonJobDecision }) => {
    import("./scheduler").then(({ scheduleSelfRescheduling }) => {
      log("DLQ poison-job surfacer registered (hourly)", "ops");
      scheduleSelfRescheduling({
        name: "dlq_poison_job_surfacer",
        intervalMs: 60 * 60 * 1000,
        initialDelayMs: 60_000,
        run: async () => {
          await withJobLock("dlq_poison_job_surfacer", 30 * 60, async () => {
            const r = await surfacePoisonJobDecision();
            if (r.surfaced > 0) {
              log(`[dlq-surfacer] inserted ${r.surfaced} decision-queue item(s)`, "ops");
            }
          });
        },
      });
    });
  }).catch((err) => {
    log(`Failed to import DLQ surfacer: ${err}`, "ops");
  });

  // ─── Pillar 9.2 — Cold-storage archival (daily 4am UTC) ────────────────
  // Sweeps archive-eligible tables for rows older than archival.horizon_days
  // (default 90) and writes them to Cloudflare R2 in Parquet. Opt-in via
  // founder_settings.archival.enabled — defaults to false until Tom flips it
  // on. See server/jobs/archival.ts for the table registry + FDW notes.
  import("./archival").then(({ runArchivalSweep }) => {
    import("./scheduler").then(({ scheduleSelfRescheduling }) => {
      // 24h cadence, initial delay aligned roughly to 4am UTC. The exact
      // wall-clock time will drift if the worker restarts mid-day; that's
      // fine — archival is idempotent and cumulative.
      const FOUR_AM_INITIAL_DELAY_MS = (() => {
        const now = new Date();
        const fourAm = new Date(now);
        fourAm.setUTCHours(4, 0, 0, 0);
        if (fourAm.getTime() <= now.getTime()) {
          fourAm.setUTCDate(fourAm.getUTCDate() + 1);
        }
        return fourAm.getTime() - now.getTime();
      })();

      log("Archival sweep registered (daily 4am UTC)", "ops");
      scheduleSelfRescheduling({
        name: "archival_sweep",
        intervalMs: 24 * 60 * 60 * 1000,
        initialDelayMs: FOUR_AM_INITIAL_DELAY_MS,
        run: async () => {
          await withJobLock("archival_sweep", 60 * 60, async () => {
            const r = await runArchivalSweep();
            if (r.enabled) {
              log(`[archival] swept ${r.results.length} table(s)`, "ops");
            }
          });
        },
      });
    });
  }).catch((err) => {
    log(`Failed to import archival job: ${err}`, "ops");
  });

  // ─── Marcus / Lens 17 — Nightly redemption-clock refresh ─────────────
  // Re-runs per-cert redemption math every night so:
  //   - rule attorney-review updates propagate without manual reseed
  //   - owner-occupied / SCRA flag flips re-anchor the deadline
  //   - morning-brief has a source of truth for "X certs cross
  //     redemption threshold today" (was previously client-only)
  // See server/jobs/redemptionClockRefresh.ts for the dedupe logic.
  import("./redemptionClockRefresh").then(({ runRedemptionClockRefresh }) => {
    import("./scheduler").then(({ scheduleSelfRescheduling }) => {
      // 24h cadence, initial delay aligned to ~3:15am UTC so we land
      // after archival (4am isn't in conflict — they're independent —
      // but we want to be early enough that morning-brief at 7am CT
      // (~13:00 UTC) sees fresh data).
      const THREE_FIFTEEN_AM_DELAY_MS = (() => {
        const now = new Date();
        const target = new Date(now);
        target.setUTCHours(3, 15, 0, 0);
        if (target.getTime() <= now.getTime()) {
          target.setUTCDate(target.getUTCDate() + 1);
        }
        return target.getTime() - now.getTime();
      })();

      log("Redemption clock refresh registered (daily 3:15am UTC)", "redemption-clock");
      scheduleSelfRescheduling({
        name: "redemption_clock_refresh",
        intervalMs: 24 * 60 * 60 * 1000,
        initialDelayMs: THREE_FIFTEEN_AM_DELAY_MS,
        run: async () => {
          await withJobLock("redemption_clock_refresh", 60 * 60, async () => {
            const r = await runRedemptionClockRefresh();
            log(
              `[redemption-clock] scanned=${r.certsScanned} changed=${r.deadlineChanged} alerts=${r.alertsEmitted} errors=${r.errors}`,
              "redemption-clock",
            );
          });
        },
      });
    });
  }).catch((err) => {
    log(`Failed to import redemption-clock refresh job: ${err}`, "redemption-clock");
  });

  // ─── Tess — Deadman job-roster monitor (every ~5 min) ────────────────────
  // Closes the "a job silently went dark and all alarms stayed green" blind
  // spot. The three existing health systems key on rows that EXIST; this one
  // keys on rows that SHOULD exist (JOB_ROSTER). For every non-disabled roster
  // job it checks last job_health_logs liveness vs 2× the job's cadence and
  // pages on-call (P1 critical / P2 otherwise) + records a reliability finding
  // on absence. Self-rescheduling + advisory-lock-gated so only one worker
  // machine runs the sweep per tick.
  import("./deadmanCheck").then(({ runJobDeadmanCheck }) => {
    import("./scheduler").then(({ scheduleSelfRescheduling }) => {
      log("Deadman job-roster monitor registered (self-rescheduling, 5m)", "deadman");
      scheduleSelfRescheduling({
        name: "job_deadman_monitor",
        intervalMs: 5 * 60 * 1000,
        // Delay the first sweep so freshly-registered jobs have a chance to run
        // once before we judge them dark (the per-job uptime guard backstops
        // this, but a longer initial delay avoids noise on every boot).
        initialDelayMs: 10 * 60 * 1000,
        run: async () => {
          // 5m cadence → TTL = ~90% (4m). Lock-gated so two worker generations
          // don't double-page the same dark job.
          await withJobLock("job_deadman_monitor", 4 * 60, async () => {
            const r = await runJobDeadmanCheck();
            log(`[deadman] checked=${r.checked} dark=${r.dark.length}`, "deadman");
          });
        },
      });
    });
  }).catch((err) => {
    log(`Failed to import deadman monitor: ${err}`, "deadman");
  });

  // ─── Quinn F2 — Audit-chain integrity verifier (weekly) ──────────────────
  // verifyAuditEventsChain() walks the global audit_events hash chain and
  // proves no row was tampered with or reordered. It is correct but was NEVER
  // run anywhere — the integrity guarantee was theoretical. Schedule it weekly;
  // on ok:false page P1 + record an integrity finding (compliance domain — the
  // audit log is a SOC 2 CC7 control, the closest roster domain to "integrity";
  // there is no dedicated "integrity" domain in DOMAIN_AUDIT_DOMAINS).
  import("../utils/auditEventsChain").then(({ verifyAuditEventsChain }) => {
    import("./scheduler").then(({ scheduleSelfRescheduling }) => {
      log("Audit-chain verifier registered (self-rescheduling, weekly)", "audit-chain");
      scheduleSelfRescheduling({
        name: "audit_chain_verify",
        intervalMs: 7 * 24 * 60 * 60 * 1000,
        initialDelayMs: 15 * 60 * 1000, // 15min after boot
        run: async () => {
          // Weekly cadence; TTL generous for a full-table walk (30m).
          await withJobLock("audit_chain_verify", 30 * 60, async () => {
            // ── 1) Global audit_events chain (Quinn F2) ─────────────────
            const result = await verifyAuditEventsChain();
            if (result.ok) {
              log(
                `[audit-chain] OK — scanned=${result.scanned} preChainSkipped=${result.preChainSkipped}`,
                "audit-chain",
              );
            } else {
              const f = result.failure;
              const title = "Audit-events hash chain BROKEN";
              const body =
                `verifyAuditEventsChain reported ok:false after scanning ${result.scanned} rows. ` +
                `First failure: auditEventId=${f?.auditEventId} seq=${f?.seq} reason=${f?.reason}. ` +
                `This means an audit_events row was tampered with, reordered, or lost its hash — ` +
                `a tamper-evidence / integrity violation.`;
              log(`[audit-chain] ${body}`, "audit-chain");
              // Tier 1D: one spine call replaces the recordFinding +
              // notifyOnCall pair (the spine pages critical findings itself).
              const { raiseAlert } = await import("../services/alertSpine");
              await raiseAlert({
                severity: "critical",
                source: "audit_chain_verify",
                title,
                detail: body,
                dedupeKey: `audit_chain_broken:${f?.auditEventId ?? "unknown"}`,
                domain: "compliance",
                citedReason: "SOC 2 CC7.2/CC7.3 — the audit_events chain must be tamper-evident.",
                subjectRef: f?.auditEventId ?? null,
                alertType: "audit_chain_broken",
                pagePriority: "P1",
                metadata: { scanned: result.scanned, failure: f },
              }).catch(() => {/* raiseAlert is internally best-effort */});
            }

            // ── 2) Per-org audit_log chains (Tier 2D, 2026-06-10) ──────
            // The org-scoped audit_log table carries its own per-tenant
            // SHA-256 chain (Kareem §1) that until now was only verified
            // on demand via the admin endpoint. Walk every org's chain
            // weekly; tamper/break → CRITICAL page per failing org.
            // Runs even when the global chain failed — one broken chain
            // must never mask another.
            try {
              const { verifyAllOrgAuditLogChains } = await import("../utils/auditLogChain");
              const orgSummary = await verifyAllOrgAuditLogChains();
              if (orgSummary.ok) {
                log(
                  `[audit-chain] per-org OK — orgs=${orgSummary.orgsChecked} scanned=${orgSummary.totalScanned}`,
                  "audit-chain",
                );
              } else {
                const { raiseAlert } = await import("../services/alertSpine");
                for (const failure of orgSummary.failures) {
                  const f = failure.failure;
                  const detail =
                    `verifyAuditLogChain(org=${failure.organizationId}) reported ok:false after ` +
                    `scanning ${failure.scanned} rows. First failure: auditLogId=${f?.auditLogId} ` +
                    `reason=${f?.reason}. An org-scoped audit_log row was tampered with, deleted ` +
                    `without a documented purge, or lost its hash — a per-tenant tamper-evidence violation.`;
                  log(`[audit-chain] ${detail}`, "audit-chain");
                  await raiseAlert({
                    severity: "critical",
                    source: "audit_chain_verify",
                    title: `Org audit_log hash chain BROKEN (org ${failure.organizationId})`,
                    detail,
                    dedupeKey: `org_audit_chain_broken:${failure.organizationId}`,
                    domain: "compliance",
                    citedReason:
                      "SOC 2 CC7.2/CC7.3 — every tenant's audit_log chain must be tamper-evident.",
                    subjectRef: String(failure.organizationId),
                    alertType: "audit_chain_broken",
                    pagePriority: "P1",
                    metadata: {
                      organizationId: failure.organizationId,
                      scanned: failure.scanned,
                      failure: f,
                    },
                  }).catch(() => {/* raiseAlert is internally best-effort */});
                }
                for (const err of orgSummary.errors) {
                  // Verifier infra errors are NOT tamper evidence — warn,
                  // don't page, but never let them pass silently (a verifier
                  // that can't run is a dark control).
                  await raiseAlert({
                    severity: "warning",
                    source: "audit_chain_verify",
                    title: `Org audit_log chain verification errored (org ${err.organizationId})`,
                    detail: `verifyAuditLogChain(org=${err.organizationId}) threw: ${err.message}`,
                    dedupeKey: `org_audit_chain_verify_error:${err.organizationId}`,
                    domain: "compliance",
                    alertType: "audit_chain_verify_error",
                    metadata: { organizationId: err.organizationId },
                  }).catch(() => {/* raiseAlert is internally best-effort */});
                }
              }
            } catch (orgErr) {
              log(`[audit-chain] per-org verification failed to run: ${orgErr}`, "audit-chain");
            }
          });
        },
      });
    });
  }).catch((err) => {
    log(`Failed to import audit-chain verifier: ${err}`, "audit-chain");
  });

  // ─── Andrei (AI/ML) — autonomous support-resolve calibration grader ──────────
  // Self-contained appended block (kept isolated to minimise merge conflict with
  // another agent editing this file this wave). Closes the loop on the ONE path
  // Pax acts on a customer unsupervised: server/ai/paxSupportResolver.ts auto-
  // resolves on the model's self-reported confidence, and per-event reopen/CSAT
  // handlers grade the outcome live. This daily job is the backstop + rollup: it
  // ages still-unobserved auto-resolves to 'held' once they're old enough that a
  // reopen is unlikely, then logs the Brier/calibration report for the
  // autonomous support path. Cheap (one UPDATE + one aggregate read); no AI calls.
  import("./scheduler").then(({ scheduleSelfRescheduling }) => {
    const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
    log("Registering support-resolve calibration grader (daily)", "support-calibration");
    scheduleSelfRescheduling({
      name: "support_resolve_calibration_grader",
      intervalMs: TWENTY_FOUR_HOURS_MS,
      initialDelayMs: 7 * 60 * 1000, // 7 min after boot
      run: async () => {
        return await withJobLock("support_resolve_calibration_grader", 60 * 60, async () => {
          const { runSupportResolverCalibrationGrader } = await import(
            "../services/andrei/supportResolverCalibration"
          );
          const aged = await runSupportResolverCalibrationGrader();
          return aged ?? 0;
        }) ?? 0;
      },
    });
  }).catch((err) => {
    log(`Support-resolve calibration grader import failed: ${err}`, "support-calibration");
  });
}
