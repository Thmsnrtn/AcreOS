/**
 * W5a trust and giving — three scheduled jobs, each single-flight via the job
 * lock and each on the deadman roster (jobRegistry.ts):
 *
 *   owner_optout_deadlines  daily 08:00 UTC  CRITICAL — the statutory clock on
 *                           owner deletion requests. If this job goes dark the
 *                           deadman pages: a silent clock is how a 45-day
 *                           legal deadline is missed.
 *   giving_monthly          2nd of the month 07:00 UTC — counts last month's
 *                           paying members and puts the pledge on the founder's
 *                           Decisions door. Moves no money.
 *   collateral_watch        daily 09:00 UTC — reads each note's collateral
 *                           parcel where a source exists; alerts land on Today.
 */
import { clock } from "../utils/clock";
import { trackInterval, withJobLock, jobLog as log } from "../utils/jobRuntime";

const ONE_HOUR_MS = 60 * 60 * 1000;

const OWNER_OPTOUT_DEADLINE_HOUR_UTC = 8;
const GIVING_MONTHLY_DAY = 2;
const GIVING_MONTHLY_HOUR_UTC = 7;
const COLLATERAL_WATCH_HOUR_UTC = 9;

export function startTrustJobs(): void {
  log("Registering W5a trust jobs (owner opt-out deadlines, giving pledge, collateral watch)", "trust");
  trackInterval(() => {
    const now = clock.now();
    if (now.getUTCHours() === OWNER_OPTOUT_DEADLINE_HOUR_UTC) {
      withJobLock("owner_optout_deadlines", 30 * 60, async () => {
        const { runOwnerOptOutDeadlineCheck } = await import("../services/trust/ownerOptOut");
        const r = await runOwnerOptOutDeadlineCheck(now);
        log(`[trust] owner opt-out deadlines: ${r.alerted} alerted, ${r.expired} expired unconfirmed`, "trust");
      }).catch((err: unknown) => log(`[trust] owner opt-out deadline check failed: ${err instanceof Error ? err.message : String(err)}`, "trust"));
    }
    if (now.getUTCDate() === GIVING_MONTHLY_DAY && now.getUTCHours() === GIVING_MONTHLY_HOUR_UTC) {
      withJobLock("giving_monthly", 30 * 60, async () => {
        const { computeGivingMonth } = await import("../services/trust/givingService");
        const r = await computeGivingMonth(now);
        log(`[trust] giving ${r.month}: ${r.payingMembers} paying members, $${(r.pledgeCents / 100).toFixed(2)} pledged (awaiting founder)`, "trust");
      }).catch((err: unknown) => log(`[trust] giving pledge failed: ${err instanceof Error ? err.message : String(err)}`, "trust"));
    }
    if (now.getUTCHours() === COLLATERAL_WATCH_HOUR_UTC) {
      withJobLock("collateral_watch", 50 * 60, async () => {
        const { runCollateralWatch } = await import("../services/trust/collateralWatchService");
        const r = await runCollateralWatch();
        log(`[trust] collateral watch: ${r.checked}/${r.parcels} parcels read, ${r.alerts} alerts, ${r.notWatched} not watched (no source)`, "trust");
      }).catch((err: unknown) => log(`[trust] collateral watch failed: ${err instanceof Error ? err.message : String(err)}`, "trust"));
    }
  }, ONE_HOUR_MS);
}
