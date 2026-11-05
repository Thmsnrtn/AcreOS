// ============================================================================
// SHARED/SUBDIVISION/LOTYIELD.TS — the lot-yield ESTIMATE (lot-yield v1).
// ----------------------------------------------------------------------------
// Pure and browser-safe. Subdivision V1, Leg 2 (package 2026-11-05 §4).
//
// Lot counts on main are operator-DRAWN (subdivision_plans.lot_count, derived
// server-side from the plan's lot polygons). Nothing DERIVES what a parcel can
// yield. This module does, and it does it the pro-forma's way:
//
//   DERIVED, ITEMISED, RANGED — never a single number, never a silent zero.
//
//     gross acres
//     − floodway acres            (a stated fact, or NOT DETERMINABLE)
//     − easement-encumbered acres (a stated fact, or NOT DETERMINABLE)
//     − unbuildable-slope acres   (a stated fact, or NOT DETERMINABLE)
//     − roads / ROW allowance     (the operator's stated % for this run)
//     = net buildable acres, as a range [low, high]
//     ÷ lot-size basis            (a stated minimum lot and/or target lot)
//     = yield range [low, high] lots
//
// A deduction whose fact is absent is NOT zero. The high end of net buildable
// (and so of yield) assumes nothing is lost to it — that end is labelled so —
// and the low end is REFUSED, with the deduction named, because an unknown
// deduction has no honest upper bound. A missing gross acreage, roads %, or any
// lot-size basis refuses the whole estimate by name.
//
// THE RANGE ENDS (a correction to the package text, recorded in the PR): §4.1
// calls the minimum-lot basis "low" and the target-size basis "high". A
// minimum lot is the SMALLEST lot a parcel can be cut into, so dividing by it
// yields the MOST lots; a larger target lot yields fewer. Here the ends are
// computed for what they are — yield.low divides the smaller net by the larger
// lot basis, yield.high divides the larger net by the smaller basis — and each
// end names its basis, so the record reproduces either way.
//
// What this is NOT (§4.3): not a survey, not an engineering yield, not a
// jurisdiction's determination. A stated minimum lot is the operator's
// statement with their citation, never the county's rule as presented fact.
// ============================================================================

const LOT_YIELD_VERSION = "lot-yield v1";

/** Where a stated acreage came from. Free text: the record is the operator's. */
export interface StatedFact {
  value: number;
  /** "county GIS export", "survey by J. Smith", "operator measured on aerial"… */
  source: string;
  /** ISO date the fact is as of, when the source states one. */
  asOf: string | null;
}

export interface LotYieldInputs {
  /** The parcel's gross acreage, with its source. Required. */
  grossAcres: StatedFact | null;
  /** Acreage in the regulatory floodway. null = not determinable (never zero). */
  floodwayAcres: StatedFact | null;
  /** Acreage encumbered by easements that remove buildable area. null = not determinable. */
  easementAcres: StatedFact | null;
  /** Acreage over the operator's slope threshold. null = not determinable. */
  unbuildableSlopeAcres: StatedFact | null;
  /** The operator's roads / right-of-way allowance for this run, as a fraction of net (0.15 = 15%). Required. */
  roadsRowFraction: number | null;
  /** The jurisdiction's minimum lot, AS THE OPERATOR STATES IT, with their citation. */
  minimumLot: { acres: number; citation: string } | null;
  /** The operator's own target lot size. */
  targetLotAcres: number | null;
}

export type DeductionKey = "floodway" | "easement" | "unbuildable_slope";

export interface DeductionLine {
  key: DeductionKey;
  label: string;
  status: "stated" | "not_determinable";
  acres: number | null;
  source: string | null;
  asOf: string | null;
  /** For not_determinable: what would resolve it (the ignorance-map shape). */
  resolution: string | null;
}

export interface RangeEnd {
  value: number | null;
  /** Why this end is null. Null when the end computed. */
  refusedReason: string | null;
  /** How this end was computed, in words the record can be checked against. */
  basis: string | null;
}

export interface LotYieldEstimate {
  version: typeof LOT_YIELD_VERSION;
  /** Whole-estimate refusal (missing gross acres, roads %, or any lot-size basis). */
  refusedReason: string | null;
  grossAcres: StatedFact | null;
  deductions: DeductionLine[];
  roadsRowFraction: number | null;
  /** Acres after the three fact deductions and before roads, low/high. */
  afterDeductions: { low: RangeEnd; high: RangeEnd };
  /** Net buildable acres after the roads allowance, low/high. */
  netBuildable: { low: RangeEnd; high: RangeEnd };
  yield: { low: RangeEnd; high: RangeEnd };
  /** Which lot sizes were divided by, as stated. */
  lotBasis: { minimumLot: { acres: number; citation: string } | null; targetLotAcres: number | null };
  /** Deductions that could not be determined — each widens the range. */
  notDeterminable: DeductionKey[];
}

const DEDUCTIONS: ReadonlyArray<{ key: DeductionKey; field: "floodwayAcres" | "easementAcres" | "unbuildableSlopeAcres"; label: string; resolution: string }> = [
  {
    key: "floodway",
    field: "floodwayAcres",
    label: "Floodway acres",
    resolution: "FEMA flood map panel read for the parcel (free) or a surveyor's flood determination",
  },
  {
    key: "easement",
    field: "easementAcres",
    label: "Easement-encumbered acres",
    resolution: "county recorder pull of easements of record (free, days), or a title commitment",
  },
  {
    key: "unbuildable_slope",
    field: "unbuildableSlopeAcres",
    label: "Unbuildable-slope acres",
    resolution: "topographic survey, or a slope read from county contours (operator's professional)",
  },
];

/** Round acres to 1/10,000 of an acre so float noise never changes a lot count. */
const acres4 = (n: number) => Math.round(n * 10_000) / 10_000;
/** Whole lots from net acres ÷ lot size, robust to float noise at exact multiples. */
const wholeLots = (net: number, lot: number) => Math.max(0, Math.floor(acres4(net / lot) + 1e-9));

const ok = (value: number, basis: string): RangeEnd => ({ value, refusedReason: null, basis });
const refused = (reason: string): RangeEnd => ({ value: null, refusedReason: reason, basis: null });

const isNonNegative = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0;

/** The yield estimate. Pure; every number is reproducible from `inputs`. */
export function estimateLotYield(inputs: LotYieldInputs): LotYieldEstimate {
  const deductions: DeductionLine[] = DEDUCTIONS.map((d) => {
    const f = inputs[d.field];
    if (f && isNonNegative(f.value)) {
      return { key: d.key, label: d.label, status: "stated", acres: acres4(f.value), source: f.source, asOf: f.asOf, resolution: null };
    }
    return { key: d.key, label: d.label, status: "not_determinable", acres: null, source: null, asOf: null, resolution: d.resolution };
  });
  const notDeterminable = deductions.filter((d) => d.status === "not_determinable").map((d) => d.key);
  const lotBasis = { minimumLot: inputs.minimumLot, targetLotAcres: inputs.targetLotAcres };
  const base = { version: LOT_YIELD_VERSION, grossAcres: inputs.grossAcres, deductions, roadsRowFraction: inputs.roadsRowFraction, lotBasis, notDeterminable } as const;

  const wholeRefusal = (reason: string): LotYieldEstimate => ({
    ...base,
    refusedReason: reason,
    afterDeductions: { low: refused(reason), high: refused(reason) },
    netBuildable: { low: refused(reason), high: refused(reason) },
    yield: { low: refused(reason), high: refused(reason) },
  });

  if (!inputs.grossAcres || !isNonNegative(inputs.grossAcres.value) || inputs.grossAcres.value === 0) {
    return wholeRefusal("no gross acreage of record — state the parcel's acreage and its source");
  }
  const roads = inputs.roadsRowFraction;
  if (!isNonNegative(roads) || roads >= 1) {
    return wholeRefusal("no roads / right-of-way allowance stated for this run — state it as a share of the parcel (0 is a valid statement)");
  }
  const lots: Array<{ acres: number; label: string }> = [];
  if (inputs.minimumLot && isNonNegative(inputs.minimumLot.acres) && inputs.minimumLot.acres > 0) {
    lots.push({ acres: inputs.minimumLot.acres, label: `stated minimum lot ${inputs.minimumLot.acres} ac (operator-stated; cited: ${inputs.minimumLot.citation})` });
  }
  if (isNonNegative(inputs.targetLotAcres) && inputs.targetLotAcres > 0) {
    lots.push({ acres: inputs.targetLotAcres, label: `operator's target lot ${inputs.targetLotAcres} ac` });
  }
  if (lots.length === 0) {
    return wholeRefusal("no lot-size basis stated — state the minimum lot (with its citation) or a target lot size");
  }

  const gross = inputs.grossAcres.value;
  const stated = deductions.filter((d) => d.status === "stated").reduce((a, d) => a + (d.acres as number), 0);
  const statedNames = deductions.filter((d) => d.status === "stated").map((d) => d.label.toLowerCase());

  const highAfter = acres4(Math.max(0, gross - stated));
  const highNote = notDeterminable.length
    ? `gross ${gross} ac less stated deductions (${statedNames.join(", ") || "none"}); assumes nothing lost to ${notDeterminable.join(", ")} (not determinable)`
    : `gross ${gross} ac less every deduction as stated`;
  const lowReason = notDeterminable.length
    ? `not determinable: ${notDeterminable.join(", ")} — an unknown deduction has no honest upper bound, so the low end is refused`
    : null;

  const afterDeductions = {
    high: ok(highAfter, highNote),
    low: lowReason ? refused(lowReason) : ok(highAfter, `gross ${gross} ac less every deduction as stated`),
  };
  const net = (a: number) => acres4(a * (1 - roads));
  const roadsNote = `after a stated roads / ROW allowance of ${acres4(roads * 100)}%`;
  const netBuildable = {
    high: ok(net(highAfter), `${highNote}, ${roadsNote}`),
    low: lowReason ? refused(lowReason) : ok(net(highAfter), `${afterDeductions.low.basis}, ${roadsNote}`),
  };

  const smallest = lots.reduce((a, b) => (b.acres < a.acres ? b : a));
  const largest = lots.reduce((a, b) => (b.acres > a.acres ? b : a));
  const yHigh = ok(wholeLots(netBuildable.high.value as number, smallest.acres), `net ${netBuildable.high.value} ac ÷ ${smallest.label}, whole lots`);
  const yLow =
    netBuildable.low.value === null
      ? refused(netBuildable.low.refusedReason as string)
      : ok(wholeLots(netBuildable.low.value, largest.acres), `net ${netBuildable.low.value} ac ÷ ${largest.label}, whole lots`);

  return { ...base, refusedReason: null, afterDeductions, netBuildable, yield: { low: yLow, high: yHigh } };
}

// ── Reconciliation with drawn plans (§4.2) ────────────────────────────────

export interface DrawnPlan {
  planId: string;
  name: string;
  /** subdivision_plans.lot_count — counted server-side from the plan's lot polygons. */
  lotCount: number | null;
}

export type DrawnVsEstimate = "within_range" | "above_range" | "below_range" | "not_comparable";

export interface PlanReconciliation {
  planId: string;
  name: string;
  drawn: number | null;
  estimateLow: number | null;
  estimateHigh: number | null;
  relation: DrawnVsEstimate;
  /** The sentence the surface shows — both numbers, never one overwriting the other. */
  statement: string;
}

/**
 * Drawn counts beside the estimate. Neither value is changed: a divergence is
 * displayed as a divergence. A missing low end compares only against the high
 * end ("above" is still decidable; "within" and "below" are not).
 */
export function reconcileWithDrawnPlans(estimate: LotYieldEstimate, plans: readonly DrawnPlan[]): PlanReconciliation[] {
  const lo = estimate.yield.low.value;
  const hi = estimate.yield.high.value;
  return plans.map((p) => {
    const drawn = p.lotCount;
    const range = hi === null ? "no estimate" : lo === null ? `up to ${hi} (low end not determinable)` : lo === hi ? `${lo}` : `${lo}–${hi}`;
    let relation: DrawnVsEstimate = "not_comparable";
    if (drawn !== null && hi !== null) {
      if (drawn > hi) relation = "above_range";
      else if (lo !== null) relation = drawn < lo ? "below_range" : "within_range";
    }
    const statement =
      drawn === null
        ? `${p.name}: no lots drawn yet; estimated range ${range}`
        : `${p.name}: drawn ${drawn} lot${drawn === 1 ? "" : "s"} vs estimated range ${range}` +
          (relation === "above_range" ? " — the drawing exceeds the estimate" : relation === "below_range" ? " — the drawing is under the estimate" : "");
    return { planId: p.planId, name: p.name, drawn, estimateLow: lo, estimateHigh: hi, relation, statement };
  });
}

