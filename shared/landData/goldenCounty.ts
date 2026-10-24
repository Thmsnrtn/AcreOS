/**
 * Golden counties — assessor-verified ground truth for a statewide source
 * (D1 amendment A5), as production data rather than a test fixture.
 *
 * Two readers, one rule:
 *  - the CI harness (tests/unit/flGoldenCounty.test.ts) asserts the current
 *    normalizer against every verified parcel, so a mapping change that moves
 *    a real parcel off its ground truth goes red;
 *  - the self-healing adapter (D2d, server/services/openData/adapterRemap.ts)
 *    may promote a proposed field remap ONLY when the live layer, read through
 *    the proposed mapping, reproduces every verified value of every verified
 *    parcel. A state with no established golden county cannot auto-remap.
 *
 * A slot is filled only from a live read (sourceAttributes copied from the
 * statewide layer's response; assessorVerified from the county appraiser's
 * record, with who read it, when, and the record URL). Fields where the
 * statewide compilation and the appraiser genuinely differ are omitted, not
 * fudged.
 */
import flGolden from "./golden/fl-golden-county.json";
import type { BulkParcelRecord } from "./bulkParcelRecord";

export type VerifiedField = "ownerName" | "situsAddress" | "assessedValueUsd" | "marketValueUsd" | "lastSalePriceUsd";

export interface GoldenParcel {
  slot: number;
  sourceParcelId: string | null;
  sourceAttributes: Record<string, unknown> | null;
  assessorVerified: Partial<Record<VerifiedField, string | number>> | null;
  verifiedBy: string | null;
  verifiedOn: string | null;
  assessorRecordUrl: string | null;
}

export interface GoldenCounty {
  state: string;
  county: string | null;
  status: "pending_verification" | "established";
  parcels: GoldenParcel[];
}

const GOLDEN_SIZE = 5;

/** Every golden county by state. A state absent here has no ground truth. */
const GOLDEN_COUNTIES: Readonly<Record<string, GoldenCounty>> = {
  FL: flGolden as unknown as GoldenCounty,
};

export function goldenCountyFor(state: string): GoldenCounty | null {
  return GOLDEN_COUNTIES[state.toUpperCase()] ?? null;
}

export function isVerifiedParcel(p: GoldenParcel): boolean {
  return (
    p.sourceParcelId !== null &&
    p.sourceAttributes !== null &&
    p.assessorVerified !== null &&
    Object.keys(p.assessorVerified).length > 0 &&
    !!p.verifiedBy &&
    /^\d{4}-\d{2}-\d{2}$/.test(p.verifiedOn ?? "") &&
    /^https:\/\//.test(p.assessorRecordUrl ?? "")
  );
}

/**
 * The verified parcels of an ESTABLISHED golden county; empty otherwise. A
 * file marked established with fewer than GOLDEN_SIZE verified parcels is not
 * ground truth — nothing may be verified against it.
 */
export function verifiedParcels(g: GoldenCounty | null): GoldenParcel[] {
  if (!g || g.status !== "established") return [];
  const verified = g.parcels.filter(isVerifiedParcel);
  return verified.length === GOLDEN_SIZE ? verified : [];
}

function recordValue(r: BulkParcelRecord, f: VerifiedField): string | number | null {
  switch (f) {
    case "ownerName":
      return r.ownership.ownerName;
    case "situsAddress":
      return r.ownership.situsAddress;
    case "assessedValueUsd":
      return r.tax.assessedValueUsd;
    case "marketValueUsd":
      return r.valuation.marketValueUsd;
    case "lastSalePriceUsd":
      return r.sale.lastSalePriceUsd;
  }
}

/**
 * Field-by-field mismatches between a normalized record and the assessor's
 * verified values (empty = the record reproduces ground truth). A null record
 * is itself a mismatch: the parcel could not be keyed.
 */
export function goldenMismatches(p: GoldenParcel, r: BulkParcelRecord | null): string[] {
  if (!r) return ["normalizer refused the parcel (no id)"];
  const out: string[] = [];
  if (r.identity.sourceParcelId !== p.sourceParcelId) out.push(`parcel id ${r.identity.sourceParcelId} != ${p.sourceParcelId}`);
  for (const [k, want] of Object.entries(p.assessorVerified ?? {})) {
    const got = recordValue(r, k as VerifiedField);
    if (got !== want) out.push(`${k}: normalizer ${JSON.stringify(got)} != assessor ${JSON.stringify(want)}`);
  }
  return out;
}
