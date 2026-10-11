/**
 * The free "Is this parcel landlocked?" checker (W3 acquisition engine).
 *
 * Answers ONLY from AcreOS's own access fact — legal_access_indication on a
 * parcel AcreOS keeps — and ONLY through the accuracy gate (the same
 * publicLandFactsOf projection the public report renders). Everything else is
 * an honest refusal with the reason:
 *   - the input is not a usable parcel reference;
 *   - AcreOS does not keep that county's parcels (with the county's coverage);
 *   - AcreOS keeps the county but not that parcel id;
 *   - the access fact has not passed its accuracy check, or could not be
 *     computed for this parcel.
 *
 * The answer never says more than the map can: a road touching the GIS line
 * is an INDICATION of access, not a recorded right of way, and "no road" is
 * "possibly landlocked", not a legal finding.
 */
import { normalizeParcelRef } from "@shared/parcel/parcelRef";
import { COVERAGE_LABELS, censusRowFor } from "@shared/landData/countySourceCensus";
import type { PublicFactRow } from "@shared/landData/publicFactText";
import type { AccessIndication } from "@shared/landData/parcelFacts";
import { findOwnedParcelRow } from "./landData/ownedParcelView";
import { normalizeCountyName, ownedParcelAtPoint } from "./landData/ownedParcelStore";
import { countyLabelOf, publicLandFactsOf, reportPath } from "./publicParcelReport";
import { getCountyGuide, countyGuidePath } from "./publicCountyGuide";

export type LandlockedInput = { state: string; county: string; apn: string } | { lat: number; lng: number };

export type LandlockedVerdict = "public_road" | "non_access_road_only" | "no_road";

export type LandlockedAnswer =
  | {
      status: "answered";
      verdict: LandlockedVerdict;
      headline: string;
      explanation: string;
      parcel: { state: string; countyLabel: string; apn: string; reportPath: string };
      fact: PublicFactRow;
      caveats: string[];
    }
  | {
      status: "refused";
      reason: "bad_input" | "county_not_kept" | "parcel_not_kept" | "fact_not_verified" | "fact_unavailable";
      message: string;
      county: { label: string; coverageLabel: string | null; guidePath: string | null } | null;
    };

const VERDICT_OF: Record<AccessIndication, LandlockedVerdict> = {
  public_road_contact: "public_road",
  non_access_road_contact_only: "non_access_road_only",
  no_road_contact: "no_road",
};

const HEADLINE: Record<LandlockedVerdict, string> = {
  public_road: "Not landlocked on the map: a public road touches this parcel.",
  non_access_road_only: "Possibly landlocked: only a private drive, trail or limited-access highway touches it.",
  no_road: "Possibly landlocked: no road touches the mapped parcel.",
};

const EXPLANATION: Record<LandlockedVerdict, string> = {
  public_road:
    "A public road centerline runs along or through the county's mapped parcel line. That usually means road access — but GIS lines are drawn for tax maps, so confirm frontage on the ground or with a survey.",
  non_access_road_only:
    "The only roads touching it are kinds that do not by themselves give access: a private drive, a 4WD trail, a walkway, or a limited-access highway. Access may depend on an easement or an agreement.",
  no_road:
    "No road centerline is within the tolerance of the mapped parcel line. Access may still exist through a recorded easement — or may not. Only the deed, the plat and a title search can tell.",
};

const LANDLOCKED_CAVEATS: readonly string[] = [
  "This is a map check, not a legal opinion. A road touching the map line is not proof of a legal right of way.",
  "Easements are unknown until the deed and plat are read; no free map layer records them.",
  "GIS parcel lines are drawn for tax maps, not surveyed. Only a survey settles the boundary.",
];

function countyRefusal(state: string, county: string) {
  const row = censusRowFor(state, county);
  return {
    label: `${countyLabelOf(county)} County, ${state}`,
    coverageLabel: row ? COVERAGE_LABELS[row.coverage] : null,
    guidePath: null as string | null,
  };
}

export async function checkLandlocked(input: LandlockedInput): Promise<LandlockedAnswer> {
  let state: string;
  let county: string;
  let apn: string;
  if ("lat" in input) {
    const hit = await ownedParcelAtPoint(input.lat, input.lng);
    if (!hit) {
      return {
        status: "refused",
        reason: "parcel_not_kept",
        message: "AcreOS does not keep a parcel at that point. Its kept parcels cover only counties whose parcel data it has loaded.",
        county: null,
      };
    }
    ({ state, county, apn } = hit);
  } else {
    const ref = normalizeParcelRef({ state: input.state, county: input.county, apn: input.apn });
    if (!ref.ok) {
      return { status: "refused", reason: "bad_input", message: "Enter a two-letter state, a county name and the county's parcel number.", county: null };
    }
    state = ref.ref.state;
    county = normalizeCountyName(ref.ref.county);
    apn = ref.ref.apn;
  }

  const row = await findOwnedParcelRow(state, county, apn);
  if (!row) {
    const guide = await getCountyGuide(state, county);
    if (!guide) {
      return {
        status: "refused",
        reason: "county_not_kept",
        message: `AcreOS has not loaded ${countyLabelOf(county)} County's parcels yet, so it cannot answer for this parcel. It will not guess.`,
        county: countyRefusal(state, county),
      };
    }
    return {
      status: "refused",
      reason: "parcel_not_kept",
      message: `AcreOS keeps ${guide.parcelCount.toLocaleString("en-US")} parcels in ${guide.countyLabel} County, but none with that parcel number. Check the number on the county's tax record.`,
      county: { ...countyRefusal(state, county), guidePath: countyGuidePath(guide.state, guide.countySlug) },
    };
  }

  const land = publicLandFactsOf(row);
  const fact = land.rows.find((r) => r.key === "legal_access_indication");
  const raw = (row.facts as Record<string, { status?: string; value?: unknown }> | null)?.legal_access_indication;
  if (!fact || fact.status !== "shown") {
    return {
      status: "refused",
      reason: raw?.status === "computed" ? "fact_not_verified" : "fact_unavailable",
      message: fact?.reason ?? "AcreOS has no road-access fact for this parcel.",
      county: null,
    };
  }
  const verdict = VERDICT_OF[raw?.value as AccessIndication];
  if (!verdict) {
    return { status: "refused", reason: "fact_unavailable", message: "The road-access fact for this parcel has a value AcreOS cannot read.", county: null };
  }
  return {
    status: "answered",
    verdict,
    headline: HEADLINE[verdict],
    explanation: EXPLANATION[verdict],
    parcel: {
      state: land.state,
      countyLabel: land.countyLabel,
      apn: land.apn,
      reportPath: reportPath({ state: land.state, countySlug: land.countySlug, apn: land.apn }),
    },
    fact,
    caveats: [...LANDLOCKED_CAVEATS],
  };
}
