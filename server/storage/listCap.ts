/**
 * Bounded, LOUD list reads (audit F-10-2).
 *
 * The "load the whole table for an org" storage reads (getLeads/getDeals/
 * getProperties) capped at 5000 rows SILENTLY — a tenant past 5000 lost its
 * oldest rows with no signal — and getNotes was uncapped entirely (OOM risk on
 * a large note servicer). The fix is not "another silent cap": query one MORE
 * row than the cap, and if the cap is exceeded, LOG it (so truncation is
 * visible in logs / Sentry, never silent) and return the capped slice. Callers
 * that need every row must use the *Paginated variant.
 */

import { logger } from "../utils/logger";

/** Default cap for unbounded org-wide list reads. */
export const LIST_READ_CAP = 5000;

/**
 * Given rows fetched with `.limit(cap + 1)`, return at most `cap` rows and log
 * loudly when more existed (the +1 row proves there is more data than the cap).
 */
export function capListRead<T>(rows: T[], cap: number, method: string, orgId: number): T[] {
  if (rows.length > cap) {
    logger.warn(
      `[storage] ${method} hit the ${cap}-row cap for org ${orgId} — MORE ROWS EXIST and were truncated. ` +
        `This read loads the whole set into memory; use the paginated variant for this surface.`,
      { metadata: { method, orgId, cap } },
    );
    return rows.slice(0, cap);
  }
  return rows;
}
