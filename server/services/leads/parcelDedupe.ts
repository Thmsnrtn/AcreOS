/**
 * Parcel-identity dedupe for lead imports (DEFECT-0140, 0153).
 *
 * A parcel is APN + state + county. Keyed on the APN alone, or on state + APN,
 * the same number in two counties is one lead and the second import is
 * silently skipped. Where EITHER side has no county (a legacy lead, or a file
 * without a county column) the county is unknown, and the match falls back to
 * state + APN rather than guessing two rows apart.
 *
 * The full key is the canonical one (shared/parcel/parcelRef.ts): whitespace
 * collapsed, "Travis County" and "Travis" one county, APN punctuation kept.
 * Used by every lead import path: POST /api/leads/csv-import and
 * /api/leads/import/tax-delinquent (server/routes-leads.ts) and importLeads
 * (server/services/importExport.ts).
 */
import { inArray, sql, type AnyColumn, type SQL } from "drizzle-orm";
import { normalizeParcelRef, parcelKey } from "@shared/parcel/parcelRef";

export interface ParcelDedupeIndex {
  add(state: string | null | undefined, county: string | null | undefined, apn: string): void;
  has(state: string | null | undefined, county: string | null | undefined, apn: string): boolean;
}

const norm = (v: string | null | undefined): string => (v ?? "").trim().replace(/\s+/g, " ").toUpperCase();

/** The form an APN is compared in, on both sides — also what the DB pre-filter matches. */
export const apnMatchForm = (apn: string | null | undefined): string => norm(apn);

/**
 * Every character ECMAScript's `\s` matches — WhiteSpace + LineTerminator,
 * exactly the set String.prototype.trim strips — as a regex bracket
 * expression that Postgres (ARE) and JavaScript read identically. Postgres's
 * own `\s` and `trim()` are narrower (trim() strips only spaces), so the
 * set is spelled out rather than borrowed.
 */
const APN_WHITESPACE_CLASS =
  "[\\t\\n\\v\\f\\r \\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]";

/**
 * `apnMatchForm`, in SQL, for a stored APN column: every whitespace run
 * collapsed to one space, the ends trimmed, upper-cased. Equal to apnMatchForm
 * for every whitespace variant (verified against Postgres 16, W10.3 second
 * audit) — the old `upper(regexp_replace(trim(apn), '\s+', ' ', 'g'))` was
 * not: trim() strips only spaces, so a deleted, opted-out lead stored as
 * "\t123" never matched an incoming "123" and a fresh contactable lead was
 * minted for that parcel. Upper-casing agrees for ASCII; Postgres's upper()
 * does not do JavaScript's full Unicode case mapping (e.g. "ß"), which no
 * APN format uses.
 */
function apnMatchSql(apn: AnyColumn | SQL): SQL {
  return sql`upper(btrim(regexp_replace(${apn}, ${`${APN_WHITESPACE_CLASS}+`}, ' ', 'g'), ' '))`;
}

/**
 * The dedupe PRE-FILTER: rows whose stored APN, normalised in SQL, is one of
 * these APNs normalised in JS. Both sides of the comparison come from here,
 * so they cannot drift apart. The identity itself is still decided in JS.
 */
export function apnMatchesAny(apn: AnyColumn | SQL, apns: ReadonlyArray<string | null | undefined>): SQL {
  return inArray(apnMatchSql(apn), Array.from(new Set(apns.map(apnMatchForm))));
}

export function createParcelDedupeIndex(): ParcelDedupeIndex {
  const full = new Set<string>();
  const countyless = new Set<string>();
  const anyCounty = new Set<string>();
  const stateApn = (state: string | null | undefined, apn: string) => `${norm(state)}|${norm(apn)}`;
  // The full identity when the canonical normaliser accepts the parts;
  // otherwise (no county, a spelled-out state, an APN with no digit) the
  // county is treated as unknown and the match falls back to state + APN.
  const fullKey = (state: string | null | undefined, county: string | null | undefined, apn: string): string | null => {
    if (!norm(county)) return null;
    const r = normalizeParcelRef({ state: state ?? "", county: county ?? "", apn });
    // Upper-cased so an APN typed in another case is the same parcel.
    return r.ok ? parcelKey(r.ref).toUpperCase() : null;
  };
  return {
    add(state, county, apn) {
      anyCounty.add(stateApn(state, apn));
      const key = fullKey(state, county, apn);
      if (key) full.add(key);
      else countyless.add(stateApn(state, apn));
    },
    has(state, county, apn) {
      const key = fullKey(state, county, apn);
      return key
        ? full.has(key) || countyless.has(stateApn(state, apn))
        : anyCounty.has(stateApn(state, apn));
    },
  };
}

/**
 * Two leads are DIFFERENT parcels when both carry an APN and the dedupe rule
 * does not match them. One owner holding several parcels shares a name,
 * phone and email across leads that are not duplicates — merging deletes a
 * parcel (DEFECT-0161).
 */
export function areDistinctParcels(a: ParcelFields, b: ParcelFields): boolean {
  return identitiesAreDistinct(parcelIdentityOf(a), parcelIdentityOf(b));
}

type ParcelFields = { apn?: string | null; state?: string | null; county?: string | null };

/**
 * A lead's parcel identity, computed ONCE so a scan over many leads compares
 * strings rather than re-normalising per pair. Null when the lead carries no
 * APN (its parcel is unknown, so it is never "distinct" from anything).
 * `full` is the canonical key; null when the county is unknown, in which case
 * the match falls back to state + APN — the same rule as the import index.
 */
export interface ParcelIdentity {
  full: string | null;
  stateApn: string;
}

export function parcelIdentityOf(lead: ParcelFields): ParcelIdentity | null {
  if (!norm(lead.apn)) return null;
  const apn = lead.apn ?? "";
  let full: string | null = null;
  if (norm(lead.county)) {
    const r = normalizeParcelRef({ state: lead.state ?? "", county: lead.county ?? "", apn });
    full = r.ok ? parcelKey(r.ref).toUpperCase() : null;
  }
  return { full, stateApn: `${norm(lead.state)}|${norm(apn)}` };
}

/** Both carry a parcel and the parcels differ. */
export function identitiesAreDistinct(a: ParcelIdentity | null, b: ParcelIdentity | null): boolean {
  if (!a || !b) return false;
  const same = a.full && b.full ? a.full === b.full : a.stateApn === b.stateApn;
  return !same;
}
