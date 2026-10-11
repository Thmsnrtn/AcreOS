/**
 * The county guide's road-access share (W3), pure and browser-safe. Counts
 * only access facts the accuracy gate would show (projectFactsForCustomer),
 * and refuses — with the reason — rather than state a number that would not
 * be honest: the gate has not passed, or too few parcels carry the fact.
 * Consumed by server/services/publicCountyGuide.ts.
 */
import { FACT_ACCURACY, projectFactsForCustomer } from "./factAccuracyGate";
import type { ParcelFactSet } from "./parcelFacts";

/** Below this many parcels with a computed access fact, no share is stated. */
const MIN_PARCELS_FOR_SHARE = 10;

export interface CountyRoadAccess {
  /** Kept parcels whose access fact passed the gate and was computed. */
  computed: number;
  publicRoad: number;
  nonAccessOnly: number;
  noRoad: number;
  /** publicRoad / computed, one decimal. */
  publicRoadPct: number;
  basis: string;
}

/**
 * The road-access share, from per-parcel access facts run through the gate.
 * Pure — exported for the test. Returns a refusal reason instead of a number
 * whenever the number would not be honest.
 */
export function roadAccessShare(
  accessFacts: Array<ParcelFactSet["legal_access_indication"] | null | undefined>,
  parcelCount: number,
): { share: CountyRoadAccess | null; refusal: string | null } {
  if (FACT_ACCURACY.legal_access_indication.status !== "passed") {
    return { share: null, refusal: "the road-access fact has not passed its accuracy check." };
  }
  let computed = 0;
  let publicRoad = 0;
  let nonAccessOnly = 0;
  let noRoad = 0;
  for (const f of accessFacts) {
    if (!f) continue;
    // The gate's own projection decides whether this parcel's fact counts.
    const shown = projectFactsForCustomer({ legal_access_indication: f }).shown[0];
    if (!shown || shown.status !== "computed") continue;
    computed++;
    if (shown.value === "public_road_contact") publicRoad++;
    else if (shown.value === "non_access_road_contact_only") nonAccessOnly++;
    else if (shown.value === "no_road_contact") noRoad++;
  }
  if (computed < MIN_PARCELS_FOR_SHARE) {
    return { share: null, refusal: `only ${computed} kept parcel${computed === 1 ? "" : "s"} carry a computed access fact — too few to state a share.` };
  }
  return {
    share: {
      computed,
      publicRoad,
      nonAccessOnly,
      noRoad,
      publicRoadPct: Math.round((publicRoad / computed) * 1000) / 10,
      basis: `Counted over ${computed.toLocaleString("en-US")} of ${parcelCount.toLocaleString("en-US")} kept parcels; the others have no computed access fact. A public road on the map (US Census TIGER, within 20 m) is an indication of access, not proof of a legal right of way.`,
    },
    refusal: null,
  };
}

