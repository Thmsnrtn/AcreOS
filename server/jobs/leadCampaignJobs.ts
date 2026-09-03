/**
 * Lead-nurturing + campaign-optimization background jobs.
 *
 * Extracted verbatim from runScheduledJobs.ts (S3, 2026-07-16) as the first
 * slice of decomposing that god-file — the autopilot heartbeat. Same shared
 * runtime (jobRuntime lock/interval/log, jobSupervisor), same kill-switches,
 * same cadences. runScheduledJobs.ts imports the two start* entrypoints and
 * calls them from its orchestrator exactly as before.
 *
 * Pax controls (AUTONOMY_SPEC.md §4.4, customer autonomy clarity program):
 * both passes are "Runs your rules" rows behind the org's `leadScoring`
 * switch. Per org, per tick, ONE read of getPaxControls decides:
 *   paused            → the org is skipped for this tick (`skipped_paused`,
 *                       logged, nothing marked failed);
 *   leadScoring=false → skipped (`skipped_off`) — a real Off, not a hidden
 *                       one; the campaign optimizer follows the same switch;
 *   otherwise         → the pass runs at EITHER stance: a score, a stage, a
 *                       suggestion is an internal write, not a message to
 *                       anyone — the receipt each transition leaves says so.
 * The controls are handed down to processLeadsForOrg so the engine does not
 * read them a second time.
 */

import { db } from "../storage";
import { sql } from "drizzle-orm";
import { organizations } from "@shared/schema";
import { trackInterval, withJobLock, jobLog as log } from "../utils/jobRuntime";
import { jobSupervisor } from "../services/jobSupervisor";
import { leadNurturerService } from "../services/leadNurturer";
import { getPaxControls, type PaxControlsState } from "../services/paxControls";

/**
 * The reason an org's pass did not run this tick, or null when it may run.
 * One vocabulary for both jobs — the same words the Pax page prints.
 */
function skipReasonFor(controls: PaxControlsState): "skipped_paused" | "skipped_off" | null {
  if (controls.paused) return "skipped_paused";
  if (!controls.leadScoring) return "skipped_off";
  return null;
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
        const controls = await getPaxControls(org.id);
        const skip = skipReasonFor(controls);
        if (skip) {
          log(
            `Lead nurturing for org ${org.id}: ${skip}` +
              (controls.checkFailed ? " (controls read failed; failing closed)" : ""),
            'nurturing',
          );
          continue;
        }

        const result = await leadNurturerService.processLeadsForOrg(org.id, {
          scoringLimit: 20,
          generateFollowUps: false,
          controls,
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
        // Suggestions follow the lead-scoring switch (spec §4.4): one switch
        // on the page, one reason vocabulary in the log.
        const controls = await getPaxControls(org.id);
        const skip = skipReasonFor(controls);
        if (skip) {
          log(
            `Campaign optimization for org ${org.id}: ${skip}` +
              (controls.checkFailed ? " (controls read failed; failing closed)" : ""),
            'optimizer',
          );
          continue;
        }

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

export { startLeadNurturingJob, startCampaignOptimizationJob };
