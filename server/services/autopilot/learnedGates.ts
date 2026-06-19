/**
 * Founder Autopilot — learned ladder gates (Leap 1, end to end).
 *
 * This is where the rules→learning mechanism (learnedPolicy.learnThreshold)
 * meets a real ladder gate. The support auto-resolve gate used a hand-typed
 * confidence cut (0.8). Here we LEARN that cut from the brain's own
 * confidence→outcome calibration history: when the autopilot was confident at
 * level X, did the action actually succeed? The learned threshold is then passed
 * into SupportCtx so the live gate self-calibrates — acting earlier when the data
 * supports it, staying conservative when it doesn't.
 *
 * Honest + cold-start-safe: the history read is best-effort (empty on failure or
 * pre-customer), and learnThreshold returns the typed default until enough
 * outcomes accrue. Pure selection over the history; the DB read is thin.
 */
import { learnThreshold, type SignalOutcome, type LearnedThreshold } from "./learnedPolicy";
import { DEFAULT_AUTO_RESOLVE_THRESHOLD } from "./domainLadders";
import { logger } from "../../utils/logger";

/** Learn the auto-resolve confidence threshold from (confidence → success)
 * history. Pure. Conservative opts: needs a high success rate to act early. */
export function learnedAutoResolveThreshold(history: SignalOutcome[]): LearnedThreshold {
  return learnThreshold(history, DEFAULT_AUTO_RESOLVE_THRESHOLD, {
    minSamples: 30,
    targetSuccessRate: 0.85,
    minBucket: 8,
  });
}

/**
 * Best-effort read of the brain's confidence→outcome history from the experience
 * log's calibration pairs (predicted success prob → did it actually succeed).
 * That IS the signal the auto-resolve gate should calibrate on. Returns [] on any
 * failure / pre-customer.
 */
export async function readConfidenceOutcomeHistory(limit = 500): Promise<SignalOutcome[]> {
  try {
    const { getCalibrationPairs } = await import("./experienceLog");
    const pairs = await getCalibrationPairs(limit);
    return pairs.map((p) => ({ signal: p.predicted, success: p.actual === 1 }));
  } catch (err) {
    logger.warn("[autopilot/learnedGates] confidence-outcome history read failed; defaulting to none", err instanceof Error ? err : undefined);
    return [];
  }
}

/**
 * The live value the support handler passes into SupportCtx.autoResolveThreshold.
 * Reads real history, learns the threshold (or keeps the typed default). Returns
 * both the number and the provenance for the glass-box trace.
 */
export async function currentAutoResolveThreshold(): Promise<LearnedThreshold> {
  return learnedAutoResolveThreshold(await readConfidenceOutcomeHistory());
}
