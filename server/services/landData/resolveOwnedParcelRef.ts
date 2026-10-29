/**
 * Resolve a county parcel reference (state + county + APN) to an AcreOS-held
 * public-record parcel, and to its APID where the county has a FIPS reference
 * and an applied release (D2c). The ONE resolver for customer-contributed
 * parcel references — the note-tape import (Notes N1) and the tax-list import
 * (V-Tax-1 T1) both call it, so "matched" means the same thing in both.
 *
 *   - null  → not searchable: the reference lacks an APN, state or county.
 *             Unknown — never "not found".
 *   - parcelKey null → searched, none found (a verified absence).
 *   - parcelKey set, apid null → matched, with the reason there is no APID.
 *
 * Reads public-record parcels only (organization_id IS NULL rows); no tenant
 * data is read.
 */

export interface ParcelRefResolution {
  searchedFor: { state: string; county: string; apn: string };
  parcelKey: string | null;
  apid: string | null;
  /** Why there is no parcel or no APID, in plain words. */
  reason: string | null;
}

export async function resolveOwnedParcelRef(ref: { apn: string | null; state: string | null; county: string | null }): Promise<ParcelRefResolution | null> {
  if (!ref.apn || !ref.state || !ref.county) return null;
  const searchedFor = { state: ref.state, county: ref.county, apn: ref.apn };
  const { findOwnedParcelRow } = await import("./ownedParcelView");
  const row = await findOwnedParcelRow(ref.state, ref.county, ref.apn);
  if (!row) return { searchedFor, parcelKey: null, apid: null, reason: "no AcreOS-held public-record parcel has this county parcel id" };
  const { countyFipsFor } = await import("./releases/releaseLineage");
  const fips = countyFipsFor(ref.state, ref.county);
  if (!fips) return { searchedFor, parcelKey: row.parcelKey ?? null, apid: null, reason: `no county FIPS reference for ${ref.state}, so no APID can be resolved` };
  const { db } = await import("../../db");
  const { loadCountyLedger } = await import("./apidStore");
  const { apidForApnAt } = await import("@shared/landData/apid");
  const ledger = await loadCountyLedger(db, ref.state, fips);
  if (!ledger.lastRelease) return { searchedFor, parcelKey: row.parcelKey ?? null, apid: null, reason: "no parcel release has been applied for this county yet" };
  const apid = apidForApnAt(ledger, ref.apn, ledger.lastRelease.ordinal);
  return { searchedFor, parcelKey: row.parcelKey ?? null, apid, reason: apid ? null : "the parcel id has no APID in the county's current release" };
}
