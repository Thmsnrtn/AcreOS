/**
 * Property Vision Re-imaging Job — Ingrid §1
 *
 * Self-rescheduling daily job that scans for properties due for re-imaging
 * and triggers vision-AI analysis on each. Wraps `runVisionReimagingPass`
 * with the standard `scheduleSelfRescheduling` runtime so failures are
 * logged to job_runs + DLQ.
 */

import { scheduleSelfRescheduling } from "./scheduler";
import { runVisionReimagingPass } from "../services/propertyVisionReimaging";
import { logger } from "../utils/logger";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export function startPropertyVisionReimagingJob(): () => void {
  logger.info(
    "[vision-reimaging] registering daily self-rescheduling job",
  );

  return scheduleSelfRescheduling({
    name: "property_vision_reimaging",
    intervalMs: ONE_DAY_MS,
    initialDelayMs: 10 * 60 * 1000, // 10 minutes after boot
    run: async () => {
      const summary = await runVisionReimagingPass();
      return summary.snapshotsCreated;
    },
  });
}
