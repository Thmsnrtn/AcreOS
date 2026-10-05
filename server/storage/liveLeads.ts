/**
 * The one live-lead predicate, and the one deliberate way around it.
 *
 * A lead is soft-deleted by setting `leads.deletedAt`; NULL means live
 * (DEFECT-0266). Until 2026-10-05 nothing said so in one place: about a
 * hundred readers each decided — or forgot — whether a deleted lead counts,
 * and most forgot (DEFECT-0273). Deleted leads appeared in counts, lists,
 * Pax's context, scoring, nudges and campaigns.
 *
 * Now there are exactly two ways to read the table, and the census
 * (tests/unit/liveLeadReadsCensus.test.ts) holds every production file to them:
 *
 *   - `liveLead()` in the statement's WHERE — the default for anything a
 *     customer, Pax or a send path sees;
 *   - `leadsIncludingDeleted` as the table — for the reads that MUST see
 *     deleted rows: consent and opt-out handling (a STOP from a deleted lead's
 *     number still opts it out), the duplicate checks that guard creation, the
 *     soft-delete and restore writers, export and erasure. Every file that uses
 *     it is on the census register with its reason, so the exception cannot
 *     spread silently.
 */
import { isNull } from "drizzle-orm";
import { leads } from "@shared/schema";

/** The live-lead predicate: not soft-deleted. Compose it into a WHERE with `and(...)`. */
export function liveLead() {
  return isNull(leads.deletedAt);
}

/**
 * The `leads` table, named for a read that deliberately includes soft-deleted
 * rows. Identical to `leads` at runtime; the name is the point — the intent is
 * in the code a reviewer reads, not in a comment beside it.
 */
export const leadsIncludingDeleted = leads;
