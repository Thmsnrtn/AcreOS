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
import { normalizeParcelRef, parcelKey } from "@shared/parcel/parcelRef";

export interface ParcelDedupeIndex {
  add(state: string | null | undefined, county: string | null | undefined, apn: string): void;
  has(state: string | null | undefined, county: string | null | undefined, apn: string): boolean;
}

const norm = (v: string | null | undefined): string => (v ?? "").trim().replace(/\s+/g, " ").toUpperCase();

/** The form an APN is compared in, on both sides — also what the DB pre-filter matches. */
export const apnMatchForm = (apn: string | null | undefined): string => norm(apn);

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
