/**
 * The W2 accuracy gate — no parcel fact reaches a customer until a labelled
 * sample of real parcels says the engine gets it right.
 *
 * Each fact has an entry here. `status: "passed"` is a CLAIM, and the claim
 * is checked, not trusted: tests/unit/landDataAccuracyGate.test.ts recomputes
 * every passed fact on the committed sample (tests/fixtures/land-data/
 * tn-accuracy-sample.json), compares it with labels taken independently from
 * the publishing servers, and fails if the measured agreement is below the
 * threshold, the sample is smaller than the minimum, or the counts recorded
 * here differ from what was measured.
 *
 * The customer-facing projection is `projectFactsForCustomer()`; the parcel
 * facts API serves only its output (server/routes-land-data.ts), and the gate
 * test pins that too. Browser-safe.
 */

import type { ParcelFactKey, ParcelFactSet } from "./parcelFacts";
import { PARCEL_FACT_KEYS, PARCEL_FACT_LABELS } from "./parcelFacts";

export interface FactAccuracyEntry {
  fact: ParcelFactKey;
  status: "passed" | "no_sample";
  /** What the sample verifies, in plain words. */
  check: string;
  minSample: number;
  /** Required agreement, 0–1. */
  threshold: number;
  /** Measured on the committed sample — the test recomputes and compares. */
  sampleSize?: number;
  agreed?: number;
  verifiedOn?: string;
  /** Why there is no sample yet (status "no_sample"). */
  noSampleReason?: string;
}

export const FACT_ACCURACY: Record<ParcelFactKey, FactAccuracyEntry> = {
  road_frontage_m: {
    fact: "road_frontage_m",
    status: "passed",
    check:
      "Frontage is non-zero exactly when the Census TIGERweb server finds an access-giving road within 20 m of the parcel polygon.",
    minSample: 10,
    threshold: 0.9,
    sampleSize: 20,
    agreed: 20,
    verifiedOn: "2026-10-10",
  },
  legal_access_indication: {
    fact: "legal_access_indication",
    status: "passed",
    check:
      "\"Public road contact\" exactly when the TIGERweb server finds an access-giving road within 20 m of the parcel polygon.",
    minSample: 10,
    threshold: 0.9,
    sampleSize: 20,
    agreed: 20,
    verifiedOn: "2026-10-10",
  },
  buildable_acres: {
    fact: "buildable_acres",
    status: "passed",
    check:
      "Flood acres are non-zero exactly when the FEMA NFHL server finds a 1% flood zone intersecting the parcel; wetland acres non-zero exactly when the USFWS NWI server finds a wetland intersecting it; the engine's 3DEP elevation at the centroid within 5 m of USGS EPQS; and the engine's slope at the centroid on the same side of 15% as an EPQS central-difference slope, or within 10 points of it.",
    minSample: 10,
    threshold: 0.9,
    sampleSize: 20,
    agreed: 19,
    verifiedOn: "2026-10-10",
  },
  public_land_adjacent: {
    fact: "public_land_adjacent",
    status: "passed",
    check: "Adjacent exactly when the USGS PAD-US server finds publicly owned fee land within 30 m of the parcel polygon.",
    minSample: 10,
    threshold: 0.9,
    sampleSize: 20,
    agreed: 20,
    verifiedOn: "2026-10-10",
  },
  distance_to_town_km: {
    fact: "distance_to_town_km",
    status: "passed",
    check:
      "The TIGERweb server finds an incorporated place within (engine distance + 100 m) of the parcel and none within (engine distance − 100 m).",
    minSample: 10,
    threshold: 0.9,
    sampleSize: 20,
    agreed: 20,
    verifiedOn: "2026-10-10",
  },
  distance_to_transmission_km: {
    fact: "distance_to_transmission_km",
    status: "no_sample",
    check: "—",
    minSample: 10,
    threshold: 0.9,
    noSampleReason:
      "No transmission-line source with open terms is wired, so there is nothing to sample (see TRANSMISSION_REFUSAL).",
  },
  out_of_state_owner: {
    fact: "out_of_state_owner",
    status: "no_sample",
    check: "—",
    minSample: 10,
    threshold: 0.9,
    noSampleReason:
      "The owner mailing state comes from the Comptroller's assessment roll, which is a manual download not yet loaded; the public service carries no mailing address.",
  },
};

export interface CustomerFactProjection {
  shown: Array<ParcelFactSet[ParcelFactKey]>;
  withheld: Array<{ key: ParcelFactKey; label: string; reason: string }>;
}

/**
 * The ONLY projection of a fact set a customer surface may render. Facts whose
 * accuracy sample has not passed are withheld with the reason — never shown
 * "with a caveat".
 */
export function projectFactsForCustomer(facts: Partial<ParcelFactSet>): CustomerFactProjection {
  const out: CustomerFactProjection = { shown: [], withheld: [] };
  for (const key of PARCEL_FACT_KEYS) {
    const f = facts[key];
    if (!f) continue;
    const gate = FACT_ACCURACY[key];
    if (gate.status !== "passed") {
      out.withheld.push({
        key,
        label: PARCEL_FACT_LABELS[key],
        reason: `Not shown yet: its accuracy sample has not passed. ${gate.noSampleReason ?? ""}`.trim(),
      });
      continue;
    }
    // A computed fact reaches a customer only with its provenance: at least
    // one source, each with a retrieval date, and a confidence from the rubric.
    if (f.status === "computed") {
      const dated = f.sources.length > 0 && f.sources.every((s) => /^\d{4}-\d{2}-\d{2}$/.test(s.retrievedOn ?? ""));
      if (!dated || !f.confidence) {
        out.withheld.push({
          key,
          label: PARCEL_FACT_LABELS[key],
          reason: "Not shown: this value arrived without a dated source and a confidence.",
        });
        continue;
      }
    }
    out.shown.push(f as ParcelFactSet[ParcelFactKey]);
  }
  return out;
}
