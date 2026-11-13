/**
 * The ONE shared DSAR clock (PKG-1 spec item 1).
 *
 * Every DSAR intake (public form, support inbox, future channels) stamps its
 * deadline from this constant instead of carrying its own literal.
 *
 * `DSAR_CLOCK_HOURS` is the OPERATIONAL default: the stricter 24h target. It
 * changes NO published promise — `routes-dsar.ts` still says 30 days in prose.
 * Which clock is legally canonical is counsel's open question Q-C2; until
 * counsel answers, this module is the operating target, not a legal claim.
 *
 * Pure functions, no imports.
 */

export const DSAR_CLOCK_HOURS = 24;

const HOUR_MS = 60 * 60 * 1000;

export interface DsarDeadlineStamp {
  /** ISO 8601 — when the MESSAGE arrived. */
  arrivalAt: string;
  /** ISO 8601 — arrival + clock. */
  deadlineAt: string;
  /** ISO 8601 — arrival + 50% of the clock. */
  reAlert50At: string;
  /** ISO 8601 — arrival + 90% of the clock. */
  reAlert90At: string;
}

/**
 * Stamp a DSAR's deadline and re-alert thresholds.
 *
 * `arrival` is the MESSAGE's arrival time, never the time a watcher happened
 * to run — a late poll must not grant the request extra time.
 */
export function stampDsarDeadline(
  arrival: Date | string,
  clockHours: number = DSAR_CLOCK_HOURS,
): DsarDeadlineStamp {
  const arrivalMs = new Date(arrival).getTime();
  const clockMs = clockHours * HOUR_MS;
  return {
    arrivalAt: new Date(arrivalMs).toISOString(),
    deadlineAt: new Date(arrivalMs + clockMs).toISOString(),
    reAlert50At: new Date(arrivalMs + clockMs * 0.5).toISOString(),
    reAlert90At: new Date(arrivalMs + clockMs * 0.9).toISOString(),
  };
}

/**
 * Which re-alert thresholds are due: each whose time has passed
 * (now >= threshold) and which has not already fired. Returned in order.
 */
export function dsarReAlertsDue(
  stamp: DsarDeadlineStamp,
  now: Date | string,
  fired: { fired50: boolean; fired90: boolean },
): Array<"50" | "90"> {
  const nowMs = new Date(now).getTime();
  const due: Array<"50" | "90"> = [];
  if (!fired.fired50 && nowMs >= new Date(stamp.reAlert50At).getTime()) due.push("50");
  if (!fired.fired90 && nowMs >= new Date(stamp.reAlert90At).getTime()) due.push("90");
  return due;
}
