/**
 * Consent timestamps are stamped by the server, never accepted from a client.
 *
 * `leads.consent_date` is the TCPA evidence of WHEN consent was recorded. It
 * was a plain writable column of every lead create/update body
 * (insertLeadSchema), so a request could set `tcpaConsent: true` with any
 * `consentDate` it liked — backdated consent, or a consent date on a lead that
 * never consented. Only two paths stamped it themselves (the consent PATCH and
 * SMS double opt-in), both with a server clock.
 *
 * The rule, applied at the lead repository so every writer that goes through
 * it is covered (routes, bulk update, import, the public API, Pax tools):
 *   - a client-supplied `consentDate` is always discarded;
 *   - when a write GIVES consent, `consentDate` is the server's clock and
 *     `consentSource` is a member of the consent vocabulary (the caller may
 *     name the method — "written", "phone_ivr" — but not invent one);
 *   - re-asserting consent on a lead that already has it keeps the original
 *     date and source (an edit is not a new grant);
 *   - a write that does not give consent carries no consent source.
 */
import { sql, type SQL } from "drizzle-orm";
import { leads } from "@shared/schema";
import type { ConsentSource } from "./consentEvents";

/**
 * The grant sources a CALLER may name. `sms_double_optin` and `inbound_stop`
 * are not here: only the inbound-SMS keyword handler records those (it writes
 * the row itself, in tcpaCompliance.ts), and a request body claiming one is
 * claiming evidence that does not exist.
 */
const CLIENT_GRANT_SOURCES: readonly ConsentSource[] = ["website", "phone_ivr", "written", "imported", "admin_manual"];

/** The one default for a grant whose caller named no (or no valid) source. */
export const DEFAULT_GRANT_SOURCE: ConsentSource = "admin_manual";

function normalizeConsentSource(raw: unknown, fallback: ConsentSource): ConsentSource {
  return typeof raw === "string" && (CLIENT_GRANT_SOURCES as readonly string[]).includes(raw)
    ? (raw as ConsentSource)
    : fallback;
}

type ConsentFields = {
  tcpaConsent?: unknown;
  consentDate?: unknown;
  consentSource?: unknown;
};

/** For an INSERT: there is no prior row, so a grant is always a new grant. */
export function stampConsentForInsert<T extends ConsentFields>(
  input: T,
  fallback: ConsentSource,
  now: Date = new Date(),
): Omit<T, "consentDate" | "consentSource"> & { consentDate?: Date; consentSource?: ConsentSource } {
  const { consentDate: _clientDate, consentSource: rawSource, ...rest } = input;
  if (rest.tcpaConsent === true) {
    return { ...rest, consentDate: now, consentSource: normalizeConsentSource(rawSource, fallback) };
  }
  return rest;
}

/**
 * For an UPDATE: the stamp is SQL evaluated against the row being updated, so
 * an already-consented lead keeps its original date and source, and a lead
 * moving to consented gets the server's clock.
 */
export function stampConsentForUpdate<T extends ConsentFields>(
  updates: T,
  fallback: ConsentSource,
): Omit<T, "consentDate" | "consentSource"> & { consentDate?: SQL; consentSource?: SQL } {
  const { consentDate: _clientDate, consentSource: rawSource, ...rest } = updates;
  if (rest.tcpaConsent === true) {
    const source = normalizeConsentSource(rawSource, fallback);
    return {
      ...rest,
      consentDate: sql`CASE WHEN ${leads.tcpaConsent} IS TRUE AND ${leads.consentDate} IS NOT NULL THEN ${leads.consentDate} ELSE now() END`,
      consentSource: sql`CASE WHEN ${leads.tcpaConsent} IS TRUE AND ${leads.consentSource} IS NOT NULL THEN ${leads.consentSource} ELSE ${source} END`,
    };
  }
  return rest;
}
