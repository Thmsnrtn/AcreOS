/**
 * Data truths — the warnings every parcel fact page carries (W2 task 7).
 *
 * Free parcel data is useful and also systematically misleading in a few
 * known ways. These warnings say so on the parcel itself, each with its own
 * confidence, instead of leaving a buyer to learn it at closing:
 *
 *   gis_not_legal_boundary — GIS lines are drawn for tax maps, not surveyed;
 *                            plus an alignment check of GIS vs deeded acres.
 *   easements_unknown      — no free layer carries recorded easements.
 *   split_mineral_estate   — only where a county publishes a mineral roll.
 *   western_water_rights   — prior-appropriation states: link the state DB.
 *   paper_subdivision      — platted lots without a road, and unknown dues.
 *   wildfire_risk          — USFS Wildfire Hazard Potential class.
 *   epa_sites              — EPA-regulated facilities nearby.
 *   parcel_id_crosswalk    — the county id may change; AcreOS's key does not.
 *
 * Every registry below is SOURCED: an entry exists only with a URL that was
 * fetched and the date it was checked. Browser-safe.
 */

import type { AccessIndication } from "./parcelFacts";

export type TruthSeverity = "info" | "caution" | "warning";
export type TruthConfidence = "high" | "medium" | "low";

export interface ParcelTruth {
  key:
    | "gis_not_legal_boundary"
    | "easements_unknown"
    | "split_mineral_estate"
    | "western_water_rights"
    | "paper_subdivision"
    | "wildfire_risk"
    | "epa_sites"
    | "parcel_id_crosswalk";
  severity: TruthSeverity;
  /** How sure we are the warning applies to THIS parcel. */
  confidence: TruthConfidence;
  message: string;
  link?: { label: string; url: string };
}

// ── Western water rights (prior appropriation) ────────────────────────────

export interface WaterRightsDatabase {
  state: string;
  agency: string;
  url: string;
  /** Date an automated GET returned HTTP 200, or null if it did not. */
  reachableOn: string | null;
  note?: string;
}

/**
 * State water-rights databases for the prior-appropriation West (and the
 * hybrid states). URLs checked 2026-10-10; two agencies refuse automated
 * requests (HTTP 403), so they are listed with reachableOn: null.
 */
export const WESTERN_WATER_RIGHTS_DATABASES: readonly WaterRightsDatabase[] = [
  { state: "AK", agency: "Alaska DNR Water Resources", url: "https://dnr.alaska.gov/mlw/water/rights/", reachableOn: "2026-10-10" },
  { state: "AZ", agency: "Arizona Department of Water Resources", url: "https://www.azwater.gov/", reachableOn: null, note: "returned HTTP 403 to an automated check" },
  { state: "CA", agency: "State Water Resources Control Board (eWRIMS)", url: "https://www.waterboards.ca.gov/waterrights/water_issues/programs/ewrims/", reachableOn: "2026-10-10" },
  { state: "CO", agency: "Colorado Division of Water Resources", url: "https://dwr.state.co.us/Tools/WaterRights", reachableOn: "2026-10-10" },
  { state: "ID", agency: "Idaho Department of Water Resources", url: "https://idwr.idaho.gov/water-rights/", reachableOn: "2026-10-10" },
  { state: "KS", agency: "Kansas Division of Water Resources", url: "https://agriculture.ks.gov/divisions-programs/dwr/water-appropriation", reachableOn: null, note: "returned HTTP 403 to an automated check" },
  { state: "MT", agency: "Montana DNRC Water Rights", url: "https://dnrc.mt.gov/Water-Resources/Water-Rights/", reachableOn: "2026-10-10" },
  { state: "ND", agency: "North Dakota Department of Water Resources", url: "https://www.swc.nd.gov/reg_approp/waterpermits/", reachableOn: "2026-10-10" },
  { state: "NE", agency: "Nebraska Department of Natural Resources", url: "https://dnr.nebraska.gov/", reachableOn: "2026-10-10" },
  { state: "NM", agency: "New Mexico Office of the State Engineer (NMWRRS)", url: "https://nmwrrs.ose.nm.gov/", reachableOn: "2026-10-10" },
  { state: "NV", agency: "Nevada Division of Water Resources", url: "https://water.nv.gov/", reachableOn: "2026-10-10" },
  { state: "OK", agency: "Oklahoma Water Resources Board", url: "https://www.owrb.ok.gov/", reachableOn: "2026-10-10" },
  { state: "OR", agency: "Oregon Water Resources Department", url: "https://apps.wrd.state.or.us/apps/wr/wrinfo/", reachableOn: "2026-10-10" },
  { state: "SD", agency: "South Dakota DANR Water Rights", url: "https://danr.sd.gov/OfficeOfWater/WaterRights/default.aspx", reachableOn: "2026-10-10" },
  { state: "TX", agency: "Texas Commission on Environmental Quality", url: "https://www.tceq.texas.gov/permitting/water_rights", reachableOn: "2026-10-10" },
  { state: "UT", agency: "Utah Division of Water Rights", url: "https://www.waterrights.utah.gov/wrinfo/query.asp", reachableOn: "2026-10-10" },
  { state: "WA", agency: "Washington Department of Ecology", url: "https://appswr.ecology.wa.gov/waterrighttrackingsystem/WaterRights/WaterRightSearch.aspx", reachableOn: "2026-10-10" },
  { state: "WY", agency: "Wyoming State Engineer's Office (e-Permit)", url: "https://seoweb.wyo.gov/e-Permit/", reachableOn: "2026-10-10" },
];

// ── Split mineral estate ───────────────────────────────────────────────────

export interface MineralRollSource {
  state: string;
  county: string;
  url: string;
  checkedOn: string;
}

/**
 * Counties that publish a separate mineral (severed-interest) roll. EMPTY on
 * purpose: none was verified in W2's Tennessee scope. A county joins only with
 * a fetched URL — absence here means "not assessed", never "no severance".
 */
export const MINERAL_ROLL_COUNTIES: readonly MineralRollSource[] = [];

// ── Inputs ─────────────────────────────────────────────────────────────────

export interface ParcelTruthInput {
  state: string;
  county: string;
  gisAcres: number;
  deededAcres?: number | null;
  subdivision?: string | null;
  lot?: string | null;
  accessIndication?: AccessIndication | null;
  /** USFS Wildfire Hazard Potential class 1–5, when looked up. */
  wildfireHazardClass?: number | null;
  /** EPA FRS facilities within one mile, when looked up. */
  epaFacilitiesWithinOneMile?: number | null;
  /** True when the county parcel id for this land has changed before. */
  renumberedBefore?: boolean;
}

/** GIS-vs-deed acreage difference above which the lines may be misaligned. */
export const ALIGNMENT_TOLERANCE_RATIO = 0.15;

const BLANK = /^(|0+|none|n\/a|-+)$/i;
const meaningful = (s?: string | null) => !!s && !BLANK.test(s.trim());

export function parcelTruths(p: ParcelTruthInput): ParcelTruth[] {
  const out: ParcelTruth[] = [];

  // 1. GIS lines are not legal boundaries + the alignment check.
  const deeded = p.deededAcres ?? null;
  if (deeded !== null && deeded > 0 && p.gisAcres > 0) {
    const diff = Math.abs(p.gisAcres - deeded) / deeded;
    if (diff > ALIGNMENT_TOLERANCE_RATIO) {
      out.push({
        key: "gis_not_legal_boundary",
        severity: "warning",
        confidence: "high",
        message: `The mapped shape covers ${p.gisAcres.toFixed(2)} acres but the deed says ${deeded.toFixed(2)} — a ${Math.round(diff * 100)}% difference. The GIS lines may be misplaced; only a survey settles the boundary.`,
      });
    } else {
      out.push({
        key: "gis_not_legal_boundary",
        severity: "info",
        confidence: "high",
        message: `GIS parcel lines are drawn for tax maps, not surveyed. The mapped area (${p.gisAcres.toFixed(2)} ac) is within ${Math.round(ALIGNMENT_TOLERANCE_RATIO * 100)}% of the deeded ${deeded.toFixed(2)} ac, but only a survey settles the boundary.`,
      });
    }
  } else {
    out.push({
      key: "gis_not_legal_boundary",
      severity: "caution",
      confidence: "medium",
      message: "GIS parcel lines are drawn for tax maps, not surveyed, and this record has no deeded acreage to check them against.",
    });
  }

  // 2. Easements.
  out.push({
    key: "easements_unknown",
    severity: "caution",
    confidence: "high",
    message:
      p.accessIndication === "no_road_contact"
        ? "No road touches the mapped parcel. Access may still exist by a recorded easement — or may not. Easements are unknown until the deed and plat are read."
        : "Easements (utility, access, conservation) are unknown until the deed and plat are read. No free map layer records them.",
  });

  // 3. Split mineral estate.
  const roll = MINERAL_ROLL_COUNTIES.find(
    (m) => m.state === p.state.toUpperCase() && m.county.toLowerCase() === p.county.toLowerCase(),
  );
  out.push(
    roll
      ? {
          key: "split_mineral_estate",
          severity: "caution",
          confidence: "medium",
          message: "This county publishes a separate mineral roll. Check it: the minerals under this parcel may belong to someone else.",
          link: { label: "County mineral roll", url: roll.url },
        }
      : {
          key: "split_mineral_estate",
          severity: "info",
          confidence: "low",
          message: "Not assessed: we have no mineral roll for this county. Minerals can be owned separately from the surface — a title search will show it.",
        },
  );

  // 4. Western water rights.
  const water = WESTERN_WATER_RIGHTS_DATABASES.find((w) => w.state === p.state.toUpperCase());
  if (water) {
    out.push({
      key: "western_water_rights",
      severity: "caution",
      confidence: "high",
      message: `${p.state.toUpperCase()} allocates water by prior appropriation: owning the land does not mean owning water. Look up any rights attached to this parcel in the state database.`,
      link: { label: water.agency, url: water.url },
    });
  }

  // 5. Paper subdivisions and dues.
  if (meaningful(p.subdivision) || meaningful(p.lot)) {
    const paper = p.accessIndication === "no_road_contact" && p.gisAcres < 5;
    out.push({
      key: "paper_subdivision",
      severity: paper ? "warning" : "info",
      confidence: paper ? "medium" : "low",
      message: paper
        ? "This is a platted lot with no road reaching it — possibly a \"paper\" subdivision whose roads were never built. Check the plat and whether the county accepts the roads. Owners' association dues, if any, are unknown."
        : "This parcel is part of a recorded subdivision. Owners' association dues and restrictions, if any, are unknown until the covenants are read.",
    });
  }

  // 6. Wildfire.
  if (p.wildfireHazardClass !== undefined && p.wildfireHazardClass !== null) {
    const c = p.wildfireHazardClass;
    const label = ["", "very low", "low", "moderate", "high", "very high"][c] ?? null;
    if (label) {
      out.push({
        key: "wildfire_risk",
        severity: c >= 4 ? "warning" : c === 3 ? "caution" : "info",
        confidence: "medium",
        message: `USFS Wildfire Hazard Potential here is ${label} (class ${c} of 5). Insurance and building codes may follow.`,
      });
    }
  }

  // 7. EPA sites.
  if (p.epaFacilitiesWithinOneMile !== undefined && p.epaFacilitiesWithinOneMile !== null) {
    const n = p.epaFacilitiesWithinOneMile;
    out.push({
      key: "epa_sites",
      severity: n > 0 ? "caution" : "info",
      confidence: "medium",
      message:
        n > 0
          ? `${n} EPA-regulated ${n === 1 ? "facility is" : "facilities are"} within a mile. Being listed is not contamination — check each record before relying on the land.`
          : "No EPA-regulated facility is listed within a mile.",
    });
  }

  // 8. Parcel id crosswalk.
  out.push({
    key: "parcel_id_crosswalk",
    severity: "info",
    confidence: "high",
    message: p.renumberedBefore
      ? "The county has renumbered this parcel before. AcreOS keeps its own stable key and the old ids, so saved deals and notes still find it."
      : "Counties sometimes renumber parcels. AcreOS keeps its own stable key for this land, so saved deals and notes still find it if the county id changes.",
  });

  return out;
}
