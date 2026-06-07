/**
 * Iyari (Chief of Future) #6 + Lena #3 — Paid-data eval harness.
 *
 * THE QUESTION THIS ANSWERS: "When MRR finally justifies a paid-data trial
 * (Regrid / Zamplo / PropGrid), which fields actually move outcomes — so we
 * buy the 20% that flips decisions, not a blanket subscription?"
 *
 * THE THESIS (iyari.md #6, lena.md): the free open-data stack already covers
 * ~80% of the decision-relevant signal (flood, wetlands, slope, soil, access).
 * Paid providers' incremental value is concentrated in a few fields
 * (owner contact, assessed value, clean APN normalization, boundaries). This
 * harness measures that empirically against our persisted free corpus
 * (`land_intelligence_reports`, the eval ground-truth from migration 0127) so
 * the buy decision is data-driven, not vibes.
 *
 * HOW IT WORKS:
 *   1. Read N persisted free LIS reports from `land_intelligence_reports`.
 *   2. For each parcel, ask a PaidDataProvider for the same fields (during a
 *      real trial window this is Regrid; today it's MockPaidProvider).
 *   3. Compute two metrics (see METRIC DEFINITIONS below):
 *        - FIELD DIVERGENCE: % of parcels where field X differs free-vs-paid,
 *          and the magnitude of the difference.
 *        - DECISION-FLIP RATE: % of parcels where substituting the paid value
 *          would change the deal recommendation or a deal-killer flag.
 *
 * PROVIDER-INJECTION SEAM: there is NO paid API key today. The harness takes a
 * `PaidDataProvider` by injection. `MockPaidProvider` (deterministic, seeded
 * from the free report itself) drives the tests and the sample/dry-run founder
 * view. The day Lena greenlights a trial, a `RegridPaidProvider` implementing
 * the same interface is dropped in — zero harness changes.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * METRIC DEFINITIONS (the precise spec — documented here as the source of truth)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Let the corpus be P parcels. For each comparable field f (see COMPARED_FIELDS):
 *
 *   FIELD DIVERGENCE (per field f):
 *     - eligible(f)   = parcels where BOTH free and paid produced a value for f.
 *                       (A parcel where free is missing but paid has a value is a
 *                       "fill", counted separately — see fillCount — not a
 *                       divergence, because there is nothing to disagree with.)
 *     - divergent(f)  = eligible parcels where free value ≠ paid value, judged by
 *                       the field's comparator:
 *                         * categorical (e.g. floodZone): strict !== after
 *                           normalization (trim+uppercase).
 *                         * boolean (e.g. hasRoadAccess): strict !==.
 *                         * numeric (e.g. assessedValue, acres): differ iff the
 *                           RELATIVE difference exceeds the field's tolerance
 *                           (default 5%): |free-paid| / max(|free|,|paid|,ε) > tol.
 *     - divergenceRate(f) = divergent(f) / eligible(f)   (0 when eligible = 0)
 *     - fillRate(f)       = fill(f) / P                  (paid had it, free didn't)
 *     - For numeric fields we also report meanAbsPctDiff over divergent parcels
 *       (how big the disagreement is when it happens), so a field that differs
 *       often but trivially (e.g. acres ±1%) is distinguishable from one that
 *       differs rarely but hugely (e.g. assessedValue 3×).
 *
 *   DECISION-FLIP RATE (the metric that justifies spend):
 *     A "decision flip" occurs for a parcel iff re-deriving the deal decision
 *     using the PAID value(s) — holding all other free fields constant — yields
 *     a DIFFERENT decision than the free-only report. "Decision" has two
 *     components, and a flip in EITHER counts:
 *       (a) RECOMMENDATION BUCKET flip: the free report's `recommendation`
 *           (buy_aggressively | buy_selectively | conduct_due_diligence | pass |
 *           dealbreaker) maps to a coarse buy/caution/no-buy bucket; a flip is a
 *           change of bucket (e.g. caution → no-buy). We do NOT re-run the full
 *           fusion engine (out of scope + would couple us to its internals);
 *           instead we apply the SAME deal-killer rules the fusion engine uses
 *           (server/services/parcelIntelligenceFusion identifyDealKillers logic,
 *           re-encoded narrowly here for the compared fields) to the paid values.
 *       (b) DEAL-KILLER flip: a dealbreaker-severity flag appears under paid
 *           that was absent under free, or vice-versa. This is the highest-value
 *           signal — a paid flood-zone correction that turns a "buy" into a
 *           "dealbreaker" is exactly the field worth paying for.
 *     decisionFlipRate = parcelsWithAnyFlip / P.
 *
 *   The output ranks fields by a crude "value score" = divergenceRate weighted
 *   by how often that field participated in a decision flip, so the founder sees
 *   "buy parcel boundaries + assessed value; skip flood (free already nails it)".
 *
 * This is dry-run/sample-safe today (MockPaidProvider, no network, no spend) and
 * production-ready the moment a real key + RegridPaidProvider land.
 */

import { dbForReads } from "../db-replica";
import { landIntelligenceReports } from "@shared/schema";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { logger } from "../utils/logger";

// ─── The free-report projection the harness compares against ────────────────
// We deliberately read a NARROW, decision-relevant projection out of the
// persisted LandIntelligenceReport JSON rather than coupling to the full type.
// These are the fields a paid provider could plausibly improve AND that feed a
// deal decision.

export interface ParcelFacts {
  /** Stable identity for matching free↔paid + reporting. */
  parcelKey: string;
  apn: string | null;
  state: string;
  county: string;
  latitude: number | null;
  longitude: number | null;

  // ── Compared fields (null = the source did not produce a value) ──
  acres: number | null;
  assessedValue: number | null;
  ownerName: string | null;
  floodZone: string | null;        // e.g. "AE", "X", "VE"
  wetlandPercent: number | null;   // 0–100
  hasRoadAccess: boolean | null;
}

/** The set of fields the harness diffs + flip-tests. Order = report order. */
export const COMPARED_FIELDS = [
  "acres",
  "assessedValue",
  "ownerName",
  "floodZone",
  "wetlandPercent",
  "hasRoadAccess",
] as const;
export type ComparedField = (typeof COMPARED_FIELDS)[number];

type FieldKind = "numeric" | "categorical" | "boolean";

interface FieldSpec {
  kind: FieldKind;
  /** Relative-difference tolerance for numeric fields (fraction, e.g. 0.05). */
  numericTolerance?: number;
  /** Human label for the report. */
  label: string;
}

export const FIELD_SPECS: Record<ComparedField, FieldSpec> = {
  acres: { kind: "numeric", numericTolerance: 0.05, label: "Parcel acreage" },
  assessedValue: { kind: "numeric", numericTolerance: 0.05, label: "Assessed value" },
  ownerName: { kind: "categorical", label: "Owner name" },
  floodZone: { kind: "categorical", label: "FEMA flood zone" },
  wetlandPercent: { kind: "numeric", numericTolerance: 0.1, label: "Wetland coverage %" },
  hasRoadAccess: { kind: "boolean", label: "Road access" },
};

// ─── The provider-injection seam ────────────────────────────────────────────

/**
 * A paid-data provider, abstracted so the harness never knows whether it's
 * talking to a mock or to live Regrid. During a trial window the real adapter
 * makes ONE paid call per parcel and maps the response into ParcelFacts.
 *
 * `name` is stamped into the report so we know which vendor produced the diff.
 * `estCostCents` lets the harness report projected trial spend for the corpus
 * (Lena #2/#3: every paid dollar must be visible before it's spent).
 */
export interface PaidDataProvider {
  readonly name: string;
  /** Estimated per-parcel cost in cents (Regrid ~5–25¢). Mock returns 0. */
  estCostCents(): number;
  /**
   * Return the paid view of the SAME parcel. Implementations should return null
   * for fields the paid source doesn't cover (counted as non-eligible, not a
   * divergence). Throwing is tolerated — the harness records it as an error and
   * skips the parcel.
   */
  lookup(free: ParcelFacts): Promise<Partial<ParcelFacts>>;
}

// ─── Metric result shapes ───────────────────────────────────────────────────

export interface FieldDivergenceResult {
  field: ComparedField;
  label: string;
  kind: FieldKind;
  /** Parcels where BOTH sides produced a value (denominator for divergenceRate). */
  eligible: number;
  /** Eligible parcels where the values disagree (per the field comparator). */
  divergent: number;
  divergenceRate: number; // divergent / eligible, 0 when eligible = 0
  /** Parcels where paid filled a value free was missing. */
  fillCount: number;
  fillRate: number; // fillCount / totalParcels
  /** Numeric only: mean |%diff| over divergent parcels (magnitude of disagreement). */
  meanAbsPctDiff: number | null;
  /** How many decision flips this field participated in (attribution). */
  flipsParticipated: number;
  /** Crude buy-priority score: divergenceRate × (1 + flipsParticipated). */
  valueScore: number;
}

export interface DecisionFlipDetail {
  parcelKey: string;
  apn: string | null;
  state: string;
  county: string;
  freeBucket: DecisionBucket;
  paidBucket: DecisionBucket;
  /** True when a dealbreaker-severity flag appeared/disappeared under paid. */
  dealKillerFlip: boolean;
  /** Which compared fields differed on this parcel (the cause). */
  divergentFields: ComparedField[];
  reason: string;
}

export interface PaidDataEvalResult {
  provider: string;
  mode: "sample" | "trial";
  totalParcels: number;
  parcelsCompared: number; // parcels where the paid lookup succeeded
  errors: number;
  estTrialCostCents: number; // parcelsCompared × provider.estCostCents()
  fieldDivergence: FieldDivergenceResult[];
  decisionFlipCount: number;
  decisionFlipRate: number; // decisionFlipCount / parcelsCompared
  decisionFlips: DecisionFlipDetail[];
  /** Plain-language buy guidance derived from the field ranking. */
  recommendation: string;
  generatedAt: string;
}

// ─── Decision derivation (mirrors fusion deal-killer rules, narrowly) ───────
// We re-encode ONLY the deal-killer rules that depend on the compared fields,
// matching server/services/parcelIntelligenceFusion.ts identifyDealKillers:
//   - floodZone AE/VE        → dealbreaker-class (mandatory flood insurance)
//   - wetlandPercent > 75    → dealbreaker; 50–75 → major_risk
//   - hasRoadAccess === false → landlocked, major_risk
// This is intentionally a NARROW re-encoding (the harness only varies these
// fields), not a re-run of the full fusion engine.

export type DecisionBucket = "buy" | "caution" | "no_buy";

/** Map the fusion `recommendation` enum to a coarse 3-way bucket. */
export function recommendationToBucket(rec: string | null | undefined): DecisionBucket {
  switch (rec) {
    case "buy_aggressively":
    case "buy_selectively":
      return "buy";
    case "conduct_due_diligence":
      return "caution";
    case "pass":
    case "dealbreaker":
      return "no_buy";
    default:
      return "caution";
  }
}

interface DerivedDecision {
  bucket: DecisionBucket;
  hasDealbreaker: boolean;
}

/**
 * Derive a decision from a parcel's compared fields, anchored on the free
 * report's baseline recommendation.
 *
 * Key semantics for clean free-vs-paid comparison: `hasDealbreaker` is derived
 * SOLELY from the compared-field deal-killer rules (flood / wetlands), NOT
 * inherited from the baseline bucket. This is what makes a deal-killer flip
 * symmetric — a PAID flood correction AE→X must be able to CLEAR the dealbreaker
 * that the free AE created, which is impossible if we treat every no_buy
 * baseline as already-dealbroken regardless of why.
 *
 * The `bucket`, by contrast, IS floored at the baseline: the baseline encodes
 * the free report's judgment on the non-compared fields (slope, soil, superfund,
 * pricing, seller motivation, etc.) which the harness does not vary. We then
 * apply the compared-field rules on top — a triggered dealbreaker forces no_buy;
 * a major_risk caps a buy at caution — so a paid correction can move the bucket
 * in either direction while preserving the free judgment we aren't testing.
 */
export function deriveDecision(
  facts: ParcelFacts,
  baselineBucket: DecisionBucket,
): DerivedDecision {
  let bucket = baselineBucket;
  // Dealbreaker is a function of the compared fields only (see doc above).
  let hasDealbreaker = false;

  // Flood zone AE/VE → Special Flood Hazard Area (fusion: flood_zone_ae).
  const fz = normalizeCategorical(facts.floodZone);
  if (fz === "AE" || fz === "VE") {
    hasDealbreaker = true;
    bucket = "no_buy";
  }

  // Dominant wetlands (fusion: wetlands_dominant, >75 dealbreaker, 50–75 major).
  if (facts.wetlandPercent != null) {
    if (facts.wetlandPercent > 75) {
      hasDealbreaker = true;
      bucket = "no_buy";
    } else if (facts.wetlandPercent > 50 && bucket === "buy") {
      bucket = "caution";
    }
  }

  // Landlocked (fusion: no_road_access / landlocked, major_risk).
  if (facts.hasRoadAccess === false && bucket === "buy") {
    bucket = "caution";
  }

  return { bucket, hasDealbreaker };
}

// ─── Value normalization + comparators ──────────────────────────────────────

function normalizeCategorical(v: string | null | undefined): string | null {
  if (v == null) return null;
  const t = String(v).trim().toUpperCase();
  return t.length === 0 ? null : t;
}

const EPS = 1e-9;

/** Relative difference of two numbers, guarded against divide-by-zero. */
export function relDiff(a: number, b: number): number {
  const denom = Math.max(Math.abs(a), Math.abs(b), EPS);
  return Math.abs(a - b) / denom;
}

/**
 * Compare a single field's free vs paid values.
 * Returns:
 *   - eligible: both sides had a value
 *   - fill:     paid had it, free didn't
 *   - divergent: eligible AND values disagree per the comparator
 *   - absPctDiff: numeric-only magnitude when divergent (else null)
 */
export function compareField(
  field: ComparedField,
  freeVal: unknown,
  paidVal: unknown,
): { eligible: boolean; fill: boolean; divergent: boolean; absPctDiff: number | null } {
  const spec = FIELD_SPECS[field];
  const freeMissing = freeVal == null;
  const paidMissing = paidVal == null;

  if (paidMissing) {
    // Paid produced nothing → nothing to compare or fill.
    return { eligible: false, fill: false, divergent: false, absPctDiff: null };
  }
  if (freeMissing) {
    // Paid filled a gap. Not a divergence (nothing to disagree with).
    return { eligible: false, fill: true, divergent: false, absPctDiff: null };
  }

  // Both present → eligible.
  if (spec.kind === "numeric") {
    const a = Number(freeVal);
    const b = Number(paidVal);
    if (Number.isNaN(a) || Number.isNaN(b)) {
      // Non-numeric garbage on one side → treat as categorical mismatch.
      const divergent = String(freeVal) !== String(paidVal);
      return { eligible: true, fill: false, divergent, absPctDiff: null };
    }
    const rd = relDiff(a, b);
    const tol = spec.numericTolerance ?? 0.05;
    const divergent = rd > tol;
    return { eligible: true, fill: false, divergent, absPctDiff: divergent ? rd : null };
  }

  if (spec.kind === "boolean") {
    const divergent = Boolean(freeVal) !== Boolean(paidVal);
    return { eligible: true, fill: false, divergent, absPctDiff: null };
  }

  // categorical
  const a = normalizeCategorical(String(freeVal));
  const b = normalizeCategorical(String(paidVal));
  const divergent = a !== b;
  return { eligible: true, fill: false, divergent, absPctDiff: null };
}

// ─── Extract ParcelFacts from a persisted land_intelligence_reports row ─────

/**
 * Lift the narrow compared projection out of a persisted LIS report. Defensive:
 * the report JSON is `Record<string, unknown>` and may be partial / from an
 * older fusion version, so every access is null-guarded.
 */
export function factsFromReportRow(row: {
  parcelKey: string;
  apn: string | null;
  state: string;
  county: string;
  latitude: string | number | null;
  longitude: string | number | null;
  acres: string | number | null;
  report: Record<string, unknown>;
}): ParcelFacts {
  const report = row.report ?? {};
  const dd = (report.dueDiligence ?? null) as Record<string, any> | null;

  const floodZone =
    dd?.floodZone?.zone != null ? String(dd.floodZone.zone) : null;
  const wetlandPercent =
    dd?.wetlands?.percent != null ? toNum(dd.wetlands.percent) : null;
  const hasRoadAccess =
    dd?.roadAccess?.hasAccess != null ? Boolean(dd.roadAccess.hasAccess) : null;

  // Assessed value isn't a first-class report field; it flows through the input
  // and may be stamped on the report best-effort. We never fabricate it.
  const assessedValue = toNum((report as any).assessedValue);

  return {
    parcelKey: row.parcelKey,
    apn: row.apn,
    state: row.state,
    county: row.county,
    latitude: toNum(row.latitude),
    longitude: toNum(row.longitude),
    acres: toNum(row.acres),
    assessedValue,
    ownerName: (report as any).ownerName != null ? String((report as any).ownerName) : null,
    floodZone,
    wetlandPercent,
    hasRoadAccess,
  };
}

function toNum(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

/** Merge a paid partial over free facts (paid wins where it has a value). */
export function mergePaid(free: ParcelFacts, paid: Partial<ParcelFacts>): ParcelFacts {
  const merged: ParcelFacts = { ...free };
  for (const field of COMPARED_FIELDS) {
    const pv = paid[field];
    if (pv != null) {
      // @ts-expect-error indexed assignment across the union is safe here
      merged[field] = pv;
    }
  }
  return merged;
}

// ─── The harness core (pure compute — testable without a DB) ────────────────

/**
 * Run the eval over an in-memory corpus + a baseline-bucket map. Pure: takes
 * the free facts, the per-parcel baseline recommendation bucket, and a paid
 * provider; returns the full metric result. The DB-reading wrapper below feeds
 * this. Tests call this directly with a fixture corpus + MockPaidProvider.
 */
export async function evaluateCorpus(opts: {
  provider: PaidDataProvider;
  mode: "sample" | "trial";
  corpus: Array<{ facts: ParcelFacts; baselineBucket: DecisionBucket }>;
}): Promise<PaidDataEvalResult> {
  const { provider, corpus, mode } = opts;

  // Per-field accumulators.
  const acc: Record<ComparedField, {
    eligible: number;
    divergent: number;
    fill: number;
    pctDiffSum: number;
    pctDiffCount: number;
    flipsParticipated: number;
  }> = Object.fromEntries(
    COMPARED_FIELDS.map((f) => [f, {
      eligible: 0, divergent: 0, fill: 0, pctDiffSum: 0, pctDiffCount: 0, flipsParticipated: 0,
    }]),
  ) as Record<ComparedField, {
    eligible: number; divergent: number; fill: number;
    pctDiffSum: number; pctDiffCount: number; flipsParticipated: number;
  }>;

  const flips: DecisionFlipDetail[] = [];
  let parcelsCompared = 0;
  let errors = 0;

  for (const { facts, baselineBucket } of corpus) {
    let paid: Partial<ParcelFacts>;
    try {
      paid = await provider.lookup(facts);
    } catch {
      errors++;
      logger.warn("[paidDataEvalHarness] paid lookup threw; skipping parcel", {
        metadata: { parcelKey: facts.parcelKey, provider: provider.name },
      });
      continue;
    }
    parcelsCompared++;

    // Per-field divergence.
    const divergentFields: ComparedField[] = [];
    for (const field of COMPARED_FIELDS) {
      const cmp = compareField(field, facts[field], paid[field]);
      const a = acc[field];
      if (cmp.eligible) a.eligible++;
      if (cmp.fill) a.fill++;
      if (cmp.divergent) {
        a.divergent++;
        divergentFields.push(field);
        if (cmp.absPctDiff != null) {
          a.pctDiffSum += cmp.absPctDiff;
          a.pctDiffCount++;
        }
      }
    }

    // Decision-flip: re-derive decision under paid (merged) vs free baseline.
    const freeDecision = deriveDecision(facts, baselineBucket);
    const paidFacts = mergePaid(facts, paid);
    const paidDecision = deriveDecision(paidFacts, baselineBucket);

    const bucketFlip = freeDecision.bucket !== paidDecision.bucket;
    const dealKillerFlip = freeDecision.hasDealbreaker !== paidDecision.hasDealbreaker;

    if (bucketFlip || dealKillerFlip) {
      for (const f of divergentFields) acc[f].flipsParticipated++;
      flips.push({
        parcelKey: facts.parcelKey,
        apn: facts.apn,
        state: facts.state,
        county: facts.county,
        freeBucket: freeDecision.bucket,
        paidBucket: paidDecision.bucket,
        dealKillerFlip,
        divergentFields,
        reason: buildFlipReason(freeDecision, paidDecision, divergentFields),
      });
    }
  }

  const fieldDivergence: FieldDivergenceResult[] = COMPARED_FIELDS.map((field) => {
    const a = acc[field];
    const divergenceRate = a.eligible > 0 ? a.divergent / a.eligible : 0;
    const meanAbsPctDiff = a.pctDiffCount > 0 ? a.pctDiffSum / a.pctDiffCount : null;
    return {
      field,
      label: FIELD_SPECS[field].label,
      kind: FIELD_SPECS[field].kind,
      eligible: a.eligible,
      divergent: a.divergent,
      divergenceRate,
      fillCount: a.fill,
      fillRate: corpus.length > 0 ? a.fill / corpus.length : 0,
      meanAbsPctDiff,
      flipsParticipated: a.flipsParticipated,
      valueScore: divergenceRate * (1 + a.flipsParticipated),
    };
  }).sort((x, y) => y.valueScore - x.valueScore);

  const decisionFlipRate = parcelsCompared > 0 ? flips.length / parcelsCompared : 0;

  return {
    provider: provider.name,
    mode,
    totalParcels: corpus.length,
    parcelsCompared,
    errors,
    estTrialCostCents: parcelsCompared * provider.estCostCents(),
    fieldDivergence,
    decisionFlipCount: flips.length,
    decisionFlipRate,
    decisionFlips: flips,
    recommendation: buildBuyRecommendation(fieldDivergence, decisionFlipRate),
    generatedAt: new Date().toISOString(),
  };
}

function buildFlipReason(
  free: DerivedDecision,
  paid: DerivedDecision,
  fields: ComparedField[],
): string {
  const fieldLabels = fields.map((f) => FIELD_SPECS[f].label).join(", ") || "no compared field";
  if (free.hasDealbreaker !== paid.hasDealbreaker) {
    return paid.hasDealbreaker
      ? `Paid data surfaced a deal-killer free data missed (via ${fieldLabels}).`
      : `Paid data cleared a deal-killer free data flagged (via ${fieldLabels}).`;
  }
  return `Decision bucket changed ${free.bucket} → ${paid.bucket} (via ${fieldLabels}).`;
}

/** Plain-language buy guidance from the ranked field divergence. */
function buildBuyRecommendation(
  fields: FieldDivergenceResult[],
  flipRate: number,
): string {
  const flipPct = (flipRate * 100).toFixed(1);
  const worthBuying = fields.filter((f) => f.flipsParticipated > 0 || f.divergenceRate >= 0.1);
  const skip = fields.filter((f) => f.flipsParticipated === 0 && f.divergenceRate < 0.05 && f.eligible > 0);

  const parts: string[] = [];
  parts.push(`Paid data would flip ${flipPct}% of deal decisions on this corpus.`);
  if (worthBuying.length > 0) {
    parts.push(
      `Worth buying: ${worthBuying.map((f) => f.label).join(", ")} (these diverge and/or flip decisions).`,
    );
  } else {
    parts.push("No compared field flipped a decision — free data already covers the decision-relevant signal on this corpus.");
  }
  if (skip.length > 0) {
    parts.push(`Skip (free already matches): ${skip.map((f) => f.label).join(", ")}.`);
  }
  return parts.join(" ");
}

// ─── DB-reading wrapper: pull the persisted free corpus + run the harness ───

/**
 * Read up to `limit` persisted free LIS reports for `organizationId` (or the
 * whole corpus when org is null), build the baseline buckets from each report's
 * persisted `recommendation`, and run the harness against `provider`.
 *
 * Reads `land_intelligence_reports` READ-ONLY (table from migration 0127). The
 * harness never writes to that table.
 */
export async function runPaidDataEval(opts: {
  provider: PaidDataProvider;
  mode: "sample" | "trial";
  organizationId?: number | null;
  /** Restrict the corpus to one state (e.g. trial-window scoping). */
  state?: string;
  limit?: number;
}): Promise<PaidDataEvalResult> {
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 2000);
  const reader = await dbForReads("paid-data-eval.corpus");

  const whereClauses = [isNotNull(landIntelligenceReports.parcelKey)];
  if (opts.organizationId != null) {
    whereClauses.push(eq(landIntelligenceReports.organizationId, opts.organizationId));
  }
  if (opts.state) {
    whereClauses.push(eq(landIntelligenceReports.state, opts.state));
  }

  const rows = await reader
    .select({
      parcelKey: landIntelligenceReports.parcelKey,
      apn: landIntelligenceReports.apn,
      state: landIntelligenceReports.state,
      county: landIntelligenceReports.county,
      latitude: landIntelligenceReports.latitude,
      longitude: landIntelligenceReports.longitude,
      acres: landIntelligenceReports.acres,
      recommendation: landIntelligenceReports.recommendation,
      report: landIntelligenceReports.report,
    })
    .from(landIntelligenceReports)
    .where(and(...whereClauses))
    .orderBy(desc(landIntelligenceReports.computedAt))
    .limit(limit);

  const corpus = rows.map((r) => ({
    facts: factsFromReportRow(r),
    baselineBucket: recommendationToBucket(r.recommendation),
  }));

  logger.info("[paidDataEvalHarness] running eval", {
    metadata: {
      provider: opts.provider.name,
      mode: opts.mode,
      corpusSize: corpus.length,
      organizationId: opts.organizationId ?? null,
      state: opts.state ?? null,
    },
  });

  return evaluateCorpus({ provider: opts.provider, mode: opts.mode, corpus });
}

/** Count the persisted free corpus (for the founder surface's empty state). */
export async function countCorpus(organizationId?: number | null): Promise<number> {
  const reader = await dbForReads("paid-data-eval.count");
  const whereClauses = [];
  if (organizationId != null) {
    whereClauses.push(eq(landIntelligenceReports.organizationId, organizationId));
  }
  const result = await reader
    .select({ n: sql<number>`count(*)::int` })
    .from(landIntelligenceReports)
    .where(whereClauses.length ? and(...whereClauses) : undefined);
  return result[0]?.n ?? 0;
}
