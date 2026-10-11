/**
 * Every model-backed WORKER the year run reaches must be modelled by the brain.
 *
 * Found 2026-10-10: the capable brain had no answer for the generic autopilot
 * dispatch (Iris: ops and deploy). The stand-in fell back to its empty script
 * answer, every such dispatch ended "empty_result", and the trust ledger
 * demoted ops and deploy to OBSERVE. The year then reported founder minutes
 * that measured the stand-in's gap, not the business, and nothing said so.
 *
 * This reads the stand-in's call log for one run, groups calls by worker shape
 * and counts the ones the brain skipped ("no answer for this call"). A worker
 * shape above NO_ANSWER_MAX_SHARE fails the run. Non-worker calls (screeners,
 * briefings, councils) have schema-shaped script answers by design and are not
 * counted.
 */
export const NO_ANSWER_MAX_SHARE = 0.02;
export const BRAIN_SKIPPED = "no answer for this call";

/** The worker a call belongs to, from the start of its system prompt (or first message), or null for a non-worker call. */
export function workerShapeOf(caller: string): string | null {
  const c = caller.trim();
  const role = /^AcreOS role worker — (\w+)/.exec(c);
  if (role) return `role worker: ${role[1].toLowerCase()}`;
  if (/^You are Pax\b/.test(c)) return "pax";
  if (/^# Team-state preamble/.test(c)) return "autopilot dispatch (iris and other agents)";
  return null;
}

export interface WorkerCoverage {
  byShape: Record<string, { calls: number; noAnswer: number }>;
  failing: string[];
}

/** Pure, over parsed call-log rows ({ caller, brain }). */
export function workerCoverage(rows: Array<{ caller?: string; brain?: string }>, maxShare = NO_ANSWER_MAX_SHARE): WorkerCoverage {
  const byShape: WorkerCoverage["byShape"] = {};
  for (const r of rows) {
    const shape = workerShapeOf(r.caller ?? "");
    if (!shape) continue;
    const b = (byShape[shape] ??= { calls: 0, noAnswer: 0 });
    b.calls++;
    if (r.brain === BRAIN_SKIPPED) b.noAnswer++;
  }
  const failing = Object.entries(byShape)
    .filter(([, v]) => v.noAnswer / v.calls > maxShare)
    .map(([k, v]) => `${k}: ${v.noAnswer}/${v.calls} calls had no brain answer (limit ${(maxShare * 100).toFixed(0)}%)`);
  return { byShape, failing };
}
