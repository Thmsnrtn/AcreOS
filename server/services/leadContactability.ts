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
import { inArray, sql, type SQL } from "drizzle-orm";
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

// ── Written SMS consent (founder decision 2026-10-20 #1) ─────────────────────

export interface WrittenConsentFlags {
  tcpaConsent?: boolean | null;
  consentSource?: string | null;
}

/**
 * Consent sources that are WRITTEN consent (47 C.F.R. § 64.1200(f)(9): a
 * signed agreement, electronic signatures under E-SIGN included — a web
 * form checkbox, a written form, a texted double opt-in, an IVR keypress).
 *
 * Standing founder decision 2026-10-20 #1: NO COLD TEXTING WITHOUT WRITTEN
 * CONSENT. A verbal yes, an operator's unevidenced "manual" tick, or any
 * source not listed here does not license a prospecting text, even though
 * it may record TCPA consent for other purposes.
 */
export const WRITTEN_SMS_CONSENT_SOURCES: ReadonlySet<string> = new Set([
  "website",
  "written",
  "sms_double_optin",
  "phone_ivr",
]);

export function hasWrittenSmsConsent(lead: WrittenConsentFlags): boolean {
  return lead.tcpaConsent === true && WRITTEN_SMS_CONSENT_SOURCES.has(lead.consentSource ?? "");
}

/**
 * hasWrittenSmsConsent as a SQL condition on `leads`, built from the same
 * WRITTEN_SMS_CONSENT_SOURCES constant, for readers that COUNT textable
 * leads in the database rather than test one row (Pax's "I can text only
 * the N leads who did"). Opt-outs are the caller's to exclude, exactly as
 * the row predicate leaves them to leadHasOptedOut.
 */
export function writtenSmsConsentSql(): SQL {
  return sql`(${leads.tcpaConsent} IS TRUE AND ${inArray(leads.consentSource, [...WRITTEN_SMS_CONSENT_SOURCES])})`;
}
