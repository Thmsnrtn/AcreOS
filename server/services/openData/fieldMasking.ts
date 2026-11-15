/**
 * Field masking for parcel lookup results (I-6) — the serving enforcement
 * half of field-level clearance.
 *
 * A clearance answer (fieldClearance.ts) says which field groups a source
 * may serve on a surface; this is where a fetched parcel is made to match
 * that answer, post-fetch and pre-response. parcel.ts applies it ONLY to
 * statewide GIS results — the one surface the lookup gate governs.
 * Per-county GIS rows, Regrid and RapidAPI results are other licences'
 * answers and pass through untouched, exactly as before this package.
 *
 * Withholding is removal, never fabrication: an owner name becomes null, a
 * mailing string becomes "", assessment fields become undefined, and a
 * result whose GEOMETRY is not served is not a parcel answer at all
 * (found: false). One county-GIS quirk is handled fail-closed: in
 * arcgisFeatureToParcel the `ownerAddress` slot carries the SITUS string
 * (the endpoint's "address" mapping defaults to SITUS), so that slot is
 * served only when BOTH the situs and the owner-mailing groups are served.
 */

// Type-only: parcel.ts loads the database at import time.
import type { ParcelLookupResult } from "../parcel";
import { answerServes, type FieldClearanceAnswer } from "@shared/openData/fieldClearance";

export function maskParcelLookupResult(result: ParcelLookupResult, answer: FieldClearanceAnswer): ParcelLookupResult {
  if (!result.found || !result.parcel) return result;
  if (!answerServes(answer, "geometry")) {
    return { found: false, error: "The source for this parcel is not cleared to serve its geometry, so no parcel fields are served." };
  }
  const parcel = result.parcel;
  const data = { ...parcel.data };
  if (!answerServes(answer, "ownerName")) data.owner = null;
  if (!answerServes(answer, "ownerMailing") || !answerServes(answer, "situs")) data.ownerAddress = "";
  if (!answerServes(answer, "assessment")) {
    data.taxAmount = "";
    data.acres = undefined;
    data.assessedValue = undefined;
    data.marketValue = undefined;
    data.taxStatus = undefined;
    data.lastSalePrice = undefined;
    data.lastSaleDate = undefined;
  }
  if (!answerServes(answer, "situs")) {
    data.county = undefined;
    data.state = undefined;
  }
  return {
    ...result,
    parcel: {
      ...parcel,
      apn: answerServes(answer, "identifiers") ? parcel.apn : "",
      data: { ...data, regridId: answerServes(answer, "identifiers") ? data.regridId : "" },
    },
  };
}
