/**
 * One rule for "this lead has said do not contact me" — every outreach
 * audience reads it through here.
 *
 * A lead is opted out when EITHER flag is set:
 *   - `doNotContact`: set by an operator, an inbound STOP, or a consent
 *     revocation (tcpaCompliance.ts, smsService.ts, auditRepo.updateLeadConsent);
 *   - `optOutDate`: stamped alongside it by the same revocation paths, and left
 *     behind by an edit that clears `doNotContact` without clearing it.
 * A path that read only `doNotContact` (the email campaign route did; the TCPA
 * consent check every sequence, workflow and Pax send used did too) contacted
 * leads the revocation paths had marked opted out. Re-consent clears both
 * (tcpaCompliance SMS double opt-in, updateLeadConsent).
 *
 * Use `leadHasOptedOut` on a loaded row and `leadNotOptedOutSql` in a query.
 * Channel consent (TCPA express consent for SMS/phone) is a SEPARATE, stricter
 * check layered on top in tcpaCompliance.ts — this is only the opt-out floor.
 * tests/unit/outreachOptOutIsOneRule.test.ts enumerates the outreach paths
 * and fails a new raw `doNotContact` check anywhere in server/.
 */
import { sql, type SQL } from "drizzle-orm";
import { leads } from "@shared/schema";

export interface OptOutFlags {
  doNotContact?: boolean | null;
  optOutDate?: Date | string | null;
}

export function leadHasOptedOut(lead: OptOutFlags): boolean {
  return lead.doNotContact === true || (lead.optOutDate !== null && lead.optOutDate !== undefined);
}

/** The same rule as a WHERE fragment over `leads`. */
export function leadNotOptedOutSql(): SQL {
  return sql`(${leads.doNotContact} IS NOT TRUE AND ${leads.optOutDate} IS NULL)`;
}
