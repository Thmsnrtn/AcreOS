/**
 * v5 Maintenance Job — Sovereign Company Protocol
 *
 * Runs every 15 minutes to:
 * 1. Process the outcome verification queue
 * 2. Check for stale goals and mark them as failed
 *
 * These are the critical background processes that v4 forgot to schedule.
 */

import { processVerificationQueue } from "../services/outcomeVerifiers";
import { checkStaleGoals } from "../services/agentGoalManager";
import { logger } from "../utils/logger";

/**
 * Main maintenance function. Called by the job supervisor.
 */
export async function runV5Maintenance(): Promise<{
  verifications: { processed: number; verified: number; failed: number };
  staleGoals: number;
}> {
  const verifications = await processVerificationQueue();
  const staleGoals = await checkStaleGoals();

  if (verifications.processed > 0 || staleGoals > 0) {
    logger.info(`[v5Maintenance] Verifications: ${verifications.processed} processed (${verifications.verified} verified, ${verifications.failed} failed). Stale goals failed: ${staleGoals}`);
  }

  return { verifications, staleGoals };
}
