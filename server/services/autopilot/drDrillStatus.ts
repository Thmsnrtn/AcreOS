/**
 * The step-away readiness verdict for disaster-recovery drills (audit F-13-2,
 * DEFECT-0110).
 *
 * Backups that have never been restored are a hope, not a backup. A drill
 * proves recovery only when it PASSED its RTO target; a recent drill that
 * missed the target proves recovery is slower than promised. The inline
 * check it replaces returned "ready" for any drill under 90 days old — its
 * own detail text said "target MISSED" beside a ready status, and the ready
 * count on the step-away surface went up by one.
 */

const DRILL_CADENCE_DAYS = 90;

export interface LatestDrDrill {
  ranAt: Date | string;
  passed: boolean | null;
  rto: number | null;
}

export function drDrillVerdict(
  latest: LatestDrDrill | undefined,
  now: Date,
): { status: "ready" | "attention"; detail: string; fix?: string } {
  if (!latest) {
    return {
      status: "attention",
      detail:
        "No full restore drill has EVER been recorded — RTO/RPO are unproven. Backups exist and the weekly verify proves they restore into a scratch DB, but full production-cutover recovery time is unmeasured.",
      fix: "Run docs/runbooks/07-database-restore-from-snapshot.md end-to-end once, fill the RTO table, and record a dr_drills row.",
    };
  }
  const ageDays = Math.floor((now.getTime() - new Date(latest.ranAt).getTime()) / 86_400_000);
  const target = latest.passed === true ? "met" : "MISSED";
  if (ageDays > DRILL_CADENCE_DAYS) {
    return {
      status: "attention",
      detail: `Last DR drill was ~${ageDays} day(s) ago (RTO ${latest.rto}m, target ${target}) — over the ${DRILL_CADENCE_DAYS}-day cadence.`,
      fix: "Schedule a fresh restore drill (runbook 07).",
    };
  }
  if (latest.passed !== true) {
    return {
      status: "attention",
      detail: `Last DR drill ~${ageDays} day(s) ago took ${latest.rto}m and MISSED its RTO target — recovery is proven slower than promised.`,
      fix: "Fix what made the restore slow, then re-run the drill (runbook 07).",
    };
  }
  return { status: "ready", detail: `Last DR drill ~${ageDays} day(s) ago — RTO ${latest.rto}m, target met.` };
}
