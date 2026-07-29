/**
 * workflowDelayResume.ts — the job that makes workflow `delay` steps real.
 *
 * Wave B "Wire the engine" (2026-07-29)
 * ────────────────────────────────────
 * The workflow engine's `delay` action used to be
 * `await sleep(Math.min(delayMinutes * 60_000, 60_000))`. Two lies in one
 * line: a step configured "wait 2 days" resumed after 60 SECONDS, and the wait
 * lived only in one Node process's event loop, so any deploy or crash dropped
 * the run on the floor with its row stuck in status "running" forever.
 *
 * Long delays now PARK the run: status "waiting", `resume_at` = the real wake
 * time, `resume_state` = the next action index plus the interpolation
 * variables accumulated so far (migration 0210). This job is the other half —
 * every minute it sweeps parked runs whose wake time has passed and continues
 * them from exactly where they stopped, in whichever process is alive.
 *
 * Concurrency: the sweep runs under `withJobLock('workflow_delay_resume', …)`
 * so only one process ticks at a time, and each run is additionally claimed
 * with a conditional waiting → running update, so even a lock lapse cannot
 * execute a run's remaining steps twice.
 *
 * Scheduling lives here too, following the S3 decomposition convention set by
 * leadCampaignJobs.ts: this module owns its own process/start-job pair on the
 * shared runtime (jobRuntime lock/interval/log), and runScheduledJobs.ts only
 * imports `startWorkflowDelayResumeJob` and calls it from the orchestrator.
 */

import { logger } from "../utils/logger";
import { trackInterval, withJobLock, jobLog as log } from "../utils/jobRuntime";

/** How many parked runs one tick will resume. Keeps a backlog from stalling the loop. */
const RESUME_BATCH_SIZE = 25;

export async function runWorkflowDelayResume(): Promise<{
  due: number;
  resumed: number;
  failed: number;
}> {
  const { workflowEngine } = await import("../services/workflow-engine");
  const result = await workflowEngine.resumeDueWorkflowRuns(RESUME_BATCH_SIZE);

  if (result.due > 0) {
    logger.info("[WorkflowDelayResume] resumed parked workflow runs", {
      metadata: {
        due: result.due,
        resumed: result.resumed,
        failed: result.failed,
      },
    });
  }

  return result;
}

// ── Scheduling ──────────────────────────────────────────────────────────────
// Workflow runs that hit a long `delay` step park in the DB with a wake time
// instead of sleeping in-process (which silently capped at 60s and evaporated
// on restart). This sweep continues every run whose wake time has passed.
async function processWorkflowDelayResume() {
  try {
    const result = await runWorkflowDelayResume();
    if (result.due > 0) {
      log(`Workflow delay resume: due=${result.due}, resumed=${result.resumed}, failed=${result.failed}`, 'workflow-delay');
    }
  } catch (err) {
    log(`Workflow delay resume job error: ${err}`, 'workflow-delay');
  }
}

export function startWorkflowDelayResumeJob() {
  const ONE_MINUTE = 60 * 1000;
  const TTL_SECONDS = 55; // Lock TTL slightly less than interval

  log('Starting workflow delay resume job (every minute)', 'workflow-delay');

  setTimeout(() => {
    withJobLock('workflow_delay_resume', TTL_SECONDS, processWorkflowDelayResume).catch(err => {
      log(`Initial workflow delay resume run failed: ${err}`, 'workflow-delay');
    });
  }, 75000); // ~75s after startup, offset from the other minute-cadence jobs

  trackInterval(() => {
    withJobLock('workflow_delay_resume', TTL_SECONDS, processWorkflowDelayResume).catch(err => {
      log(`Workflow delay resume run failed: ${err}`, 'workflow-delay');
    });
  }, ONE_MINUTE);
}
