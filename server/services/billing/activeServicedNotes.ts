/**
 * Active serviced notes — informs the pause flow, never gates it.
 *
 * A subscription pause makes AcreOS read-only EXCEPT servicing writes on notes
 * the org already holds (see subscriptionPauseGate). The pause handler tells
 * the customer how many notes that covers, so a hybrid org knows its servicing
 * keeps running. "Active" = performing / late / default; paid_off and sold
 * are finished and need no servicing.
 *
 * Best-effort by design: pause is a retention save. A failed count degrades to
 * `null` and is never allowed to block or fail the pause.
 */

import { and, eq, inArray, sql } from "drizzle-orm";
import { acquiredNotes } from "@shared/schema";
import { db } from "../../storage";
import { logger } from "../../utils/logger";

export const ACTIVE_SERVICED_NOTE_STATUSES = ["performing", "late", "default"] as const;

/** Count of the org's active serviced notes, or `null` if the count failed. */
export async function countActiveServicedNotes(orgId: number): Promise<number | null> {
  try {
    const rows = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(acquiredNotes)
      .where(
        and(
          eq(acquiredNotes.organizationId, orgId),
          inArray(acquiredNotes.status, [...ACTIVE_SERVICED_NOTE_STATUSES]),
        ),
      );
    const n = Number(rows[0]?.n);
    return Number.isFinite(n) ? n : null;
  } catch (err) {
    logger.warn(
      `[subscription/pause] active-notes count failed for org ${orgId}; continuing without it`,
      err,
    );
    return null;
  }
}
