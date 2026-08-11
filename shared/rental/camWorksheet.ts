// ============================================================================
// SHARED/RENTAL/CAMWORKSHEET.TS — the two rules that sit AROUND the CAM engine.
// ----------------------------------------------------------------------------
// `camReconciliation.ts` decides HOW a CAM true-up is computed. This module
// decides the two things that decide WHETHER it may be computed at all, and
// whether it may ever be written twice:
//
//   1. INPUT SUFFICIENCY — refuse, and say WHICH input is missing.
//      The engine already refuses a fabricated pro-rata denominator. It does
//      NOT refuse a fabricated NUMERATOR, and that hole bills real money: a
//      pool with an empty recoverable-category set, or a period with no
//      recorded recoverable spend, computes a pool actual of $0, a recoverable
//      share of $0 and therefore a delta of MINUS everything the tenant was
//      estimated-billed — a credit statement asserting the building cost
//      nothing to run. Zero recorded expenses is an ABSENCE, not a measurement
//      of zero. `assessCamInputs` blocks that case and every sibling of it, and
//      returns the missing inputs as STRUCTURED FIELDS so the worksheet can
//      show the operator exactly what to set rather than a shrug.
//
//   2. FREEZE — a generated statement is an exhibit, not a cache.
//      `cam_reconciliations` is an immutable frozen statement (see the schema
//      comment): a tenant billed a delta is owed the exact inputs behind it, so
//      a later edit to the pool must not silently rewrite a statement already
//      sent. Not recomputing on READ is only half of that guarantee — the other
//      half is that no subsequent WRITE may overwrite it either, whether from a
//      re-generate after a pool edit or from an operator-entered row landing on
//      the same (pool, lease) unique key. `decideCamStatementWrite` is the one
//      place that decision is made; the route delegates to it, and when it
//      refuses it reports the DRIFT (what a statement generated today would say
//      instead) rather than either hiding the divergence or applying it.
//
// Pure and browser-safe: no DB, no `process`, no crypto, no imports beyond the
// sibling reconciliation/expense axes. Every export is called from
// server/routes-rent-ledger.ts and/or the Finance-door worksheet surface.
//
// MONEY POSTURE: nothing here moves, holds or charges a cent. It gates and
// freezes a STATEMENT; the resulting charge lands on the existing rent_charges
// ledger, on the operator's own rails, elsewhere.
// ============================================================================

import type { PropertyExpenseCategory } from "./propertyExpense";
import type { MeasurableExpenseRow } from "./noi";
import {
  computeCamReconciliation,
  monthsInPeriod,
  type CamPoolInput,
  type CamLeaseInput,
  type CamReconciliationResult,
} from "./camReconciliation";

/** The statement-generator version stamped on every engine-frozen row. */
export const CAM_STATEMENT_VERSION = "cam-v1";

// ---------------------------------------------------------------------------
// 1. INPUT SUFFICIENCY
// ---------------------------------------------------------------------------

/** Which part of the worksheet an input belongs to — the worksheet groups by this. */
export type CamInputGroup = "period" | "pool_definition" | "pool_actuals" | "pro_rata";

export interface CamMissingInput {
  /** Machine key, e.g. "pool.totalRentableSqft" — stable, used as a React key. */
  field: string;
  /** Operator-facing name of the thing that is missing. */
  label: string;
  group: CamInputGroup;
  /**
   * true  — the reconciliation CANNOT be produced without it (refuse).
   * false — it can be produced, but the statement must disclose the gap
   *         (thin coverage is computed and captioned, never hidden).
   */
  blocking: boolean;
  /**
   * "required" — this exact field must be supplied.
   * "any_of"   — this field is one of several alternatives for its group; the
   *              group is satisfied as soon as ONE of them is supplied.
   */
  satisfiedBy: "required" | "any_of";
  /** What the operator should actually do about it. */
  fix: string;
}

export interface CamInputAssessment {
  /** Everything missing — blocking and disclosable alike, in worksheet order. */
  missing: CamMissingInput[];
  /** The subset that refuses the reconciliation outright. */
  blocking: CamMissingInput[];
  /** false when any blocking input is missing. */
  canCompute: boolean;
  /** Recoverable OPERATING rows found in the pool's window — the numerator's evidence. */
  recoverableRowCount: number;
}

/**
 * Decide whether this pool + lease + actuals can produce an honest
 * reconciliation, and name every input that is missing.
 *
 * This runs BEFORE the engine. The engine's own `refusedReason` covers the
 * pro-rata denominator; this covers the inputs whose absence the engine would
 * otherwise silently read as a zero.
 */
export function assessCamInputs(args: {
  pool: CamPoolInput;
  lease: CamLeaseInput;
  rows: MeasurableExpenseRow[];
}): CamInputAssessment {
  const { pool, lease, rows } = args;
  const missing: CamMissingInput[] = [];

  // ── Period ───────────────────────────────────────────────────────────────
  const periodMonths = monthsInPeriod(pool.periodStart, pool.periodEnd);
  if (periodMonths === 0) {
    missing.push({
      field: "pool.period",
      label: "Reconciliation period",
      group: "period",
      blocking: true,
      satisfiedBy: "required",
      fix: "Set a period start and end on the pool, with the end on or after the start.",
    });
  }

  // ── Pool definition ──────────────────────────────────────────────────────
  const categories = Array.isArray(pool.recoverableCategories) ? pool.recoverableCategories : [];
  if (categories.length === 0) {
    missing.push({
      field: "pool.recoverableCategories",
      label: "Recoverable expense categories",
      group: "pool_definition",
      blocking: true,
      satisfiedBy: "required",
      fix:
        "Assert which expense categories this pool recovers. An empty set is an UNDEFINED pool, " +
        "not a $0 one — reconciling against it would credit the tenant everything they were billed.",
    });
  }

  // ── Pool actuals ─────────────────────────────────────────────────────────
  const recoverable = new Set<PropertyExpenseCategory>(categories);
  const monthsWithSpend = new Set<string>();
  let recoverableRowCount = 0;
  for (const r of rows) {
    if (!r.isOperating) continue;
    if (!recoverable.has(r.category)) continue;
    recoverableRowCount += 1;
    if (typeof r.incurredOn === "string" && r.incurredOn.length >= 7) {
      monthsWithSpend.add(r.incurredOn.slice(0, 7));
    }
  }
  if (recoverableRowCount === 0) {
    missing.push({
      field: "pool.actuals",
      label: "Recorded recoverable spend",
      group: "pool_actuals",
      blocking: true,
      satisfiedBy: "required",
      fix:
        "Record the property expenses this pool recovers for the period. No recorded spend is an " +
        "ABSENCE, not a measured zero — billing from it would state that the building cost nothing to run.",
    });
  } else if (periodMonths > 0 && monthsWithSpend.size < periodMonths) {
    // NOT blocking: partial coverage IS the actual spend so far, and the engine
    // computes it and captions it. It is surfaced so the operator knows the
    // statement will read as provisional.
    missing.push({
      field: "pool.actuals.coverage",
      label: `Expenses for ${periodMonths - monthsWithSpend.size} of ${periodMonths} months in the period`,
      group: "pool_actuals",
      blocking: false,
      satisfiedBy: "required",
      fix:
        "Record the remaining months' expenses before generating, or generate now and the statement " +
        "will be captioned as a PARTIAL, provisional true-up.",
    });
  }

  // ── Pro-rata (any_of) ────────────────────────────────────────────────────
  const hasFixedShare = lease.camProRataBps != null;
  const hasSqftPair =
    lease.rentableSqft != null &&
    lease.rentableSqft > 0 &&
    pool.totalRentableSqft != null &&
    pool.totalRentableSqft > 0;
  if (!hasFixedShare && !hasSqftPair) {
    missing.push({
      field: "lease.camProRataBps",
      label: "Lease's fixed CAM share",
      group: "pro_rata",
      blocking: true,
      satisfiedBy: "any_of",
      fix: "Set the CAM share the lease document fixes, in basis points (1500 = 15%).",
    });
    if (lease.rentableSqft == null || lease.rentableSqft <= 0) {
      missing.push({
        field: "lease.rentableSqft",
        label: "Lease's rentable sqft",
        group: "pro_rata",
        blocking: true,
        satisfiedBy: "any_of",
        fix: "Set the leased area — the numerator of a sqft-derived share.",
      });
    }
    if (pool.totalRentableSqft == null || pool.totalRentableSqft <= 0) {
      missing.push({
        field: "pool.totalRentableSqft",
        label: "Building's total rentable sqft",
        group: "pro_rata",
        blocking: true,
        satisfiedBy: "any_of",
        fix: "Set the building's total rentable area on the pool — the denominator of every share.",
      });
    }
  }

  const blocking = missing.filter((m) => m.blocking);
  return { missing, blocking, canCompute: blocking.length === 0, recoverableRowCount };
}

export interface CamWorksheetPreview {
  /** The computed reconciliation, or null when the inputs refuse it. */
  result: CamReconciliationResult | null;
  /** true when a blocking input is missing — nothing was computed. */
  blocked: boolean;
  missing: CamMissingInput[];
  blocking: CamMissingInput[];
  recoverableRowCount: number;
}

/**
 * The worksheet's dry run: assess the inputs, and compute ONLY if they suffice.
 * Writes nothing and freezes nothing — the operator reviews this, then generates.
 */
export function previewCamReconciliation(args: {
  pool: CamPoolInput;
  lease: CamLeaseInput;
  rows: MeasurableExpenseRow[];
  estimatedBilledCents: number;
}): CamWorksheetPreview {
  const assessment = assessCamInputs(args);
  if (!assessment.canCompute) {
    return {
      result: null,
      blocked: true,
      missing: assessment.missing,
      blocking: assessment.blocking,
      recoverableRowCount: assessment.recoverableRowCount,
    };
  }
  const result = computeCamReconciliation(args);
  return {
    result,
    // The engine can still refuse on its own axis; treat that as blocked too so
    // no caller has to remember to check both.
    blocked: result.refusedReason != null,
    missing: assessment.missing,
    blocking: assessment.blocking,
    recoverableRowCount: assessment.recoverableRowCount,
  };
}

// ---------------------------------------------------------------------------
// 2. FREEZE
// ---------------------------------------------------------------------------

/**
 * The shape of a `cam_reconciliations` row, narrowed to the columns that make
 * up the frozen exhibit. Declared structurally (not imported from the Drizzle
 * table type) so this module stays browser-safe and the client can reuse it.
 */
export interface CamFrozenStatement {
  periodStart: string | null;
  periodEnd: string | null;
  proRataBpsUsed: number | null;
  proRataBasis: string | null;
  leasedSqftUsed: number | null;
  totalRentableSqftUsed: number | null;
  poolActualCents: number | null;
  byCategoryCents: Record<string, number> | null;
  recoverableShareCents: number | null;
  estimatedBilledCents: number | null;
  estimatedBilledBasis: string | null;
  deltaCents: number | null;
  coverageMonths: number | null;
  coverageComplete: boolean | null;
  statementMarkdown: string | null;
  statementVersion: string | null;
  generatedAt: string | Date | null;
  generatedBy: string | null;
}

/**
 * A row is FROZEN once the engine has generated a rendered statement for it.
 *
 * All three conditions matter: an operator-entered row (`generatedBy` !==
 * "engine") is data entry the operator may correct, and an engine row with no
 * rendered statement was never handed to anybody. Only an engine row carrying
 * the statement text AND its generation timestamp is the exhibit a tenant was
 * billed from.
 */
export function isFrozenCamStatement(row: CamFrozenStatement | null | undefined): boolean {
  if (!row) return false;
  return (
    row.generatedBy === "engine" &&
    typeof row.statementMarkdown === "string" &&
    row.statementMarkdown.length > 0 &&
    row.generatedAt != null
  );
}

/** Timestamps arrive as Date from the driver and as string over JSON — normalise. */
function isoOrNull(v: string | Date | null | undefined): string | null {
  if (v == null) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
  return String(v);
}

/** Key-sorted so an object built in a different order fingerprints identically. */
function canonicalCategoryMap(m: Record<string, number> | null | undefined): Array<[string, number]> {
  if (!m) return [];
  return Object.keys(m)
    .sort()
    .map((k) => [k, Math.round(Number(m[k]))] as [string, number]);
}

/**
 * The fields that ARE the exhibit — the numbers, the inputs behind them, the
 * rendered statement, and the provenance stamp. Anything not in this list is
 * not part of what was handed to the tenant (`id`, `createdAt`, FKs).
 */
export const CAM_STATEMENT_CANONICAL_FIELDS = [
  "periodStart",
  "periodEnd",
  "proRataBpsUsed",
  "proRataBasis",
  "leasedSqftUsed",
  "totalRentableSqftUsed",
  "poolActualCents",
  "byCategoryCents",
  "recoverableShareCents",
  "estimatedBilledCents",
  "estimatedBilledBasis",
  "deltaCents",
  "coverageMonths",
  "coverageComplete",
  "statementMarkdown",
  "statementVersion",
  "generatedAt",
  "generatedBy",
] as const;

/**
 * A deterministic, order-independent serialization of the frozen exhibit.
 * Byte-equality of two canonicalisations IS the byte-stability guarantee — the
 * fingerprint below is a convenience over this, not a substitute for it.
 */
export function canonicalCamStatement(row: CamFrozenStatement): string {
  // BUILT FROM the field list rather than repeating it: a hand-written literal
  // here and a list up there would eventually disagree, and the failure mode is
  // silent — a column added to the exhibit but left out of the canonical form
  // would make a changed statement fingerprint as unchanged.
  const c: Record<string, unknown> = {};
  for (const field of CAM_STATEMENT_CANONICAL_FIELDS) {
    if (field === "byCategoryCents") {
      c[field] = canonicalCategoryMap(row.byCategoryCents);
    } else if (field === "generatedAt") {
      c[field] = isoOrNull(row.generatedAt);
    } else {
      c[field] = row[field] ?? null;
    }
  }
  // Key order is CAM_STATEMENT_CANONICAL_FIELDS order — deterministic.
  return JSON.stringify(c);
}

/**
 * A short change-detection fingerprint over `canonicalCamStatement` (FNV-1a,
 * 32-bit). Deliberately NOT a cryptographic digest and never described as one:
 * it exists so a UI can show "this statement is unchanged" cheaply. Anything
 * that must PROVE stability compares `canonicalCamStatement` directly.
 */
export function camStatementFingerprint(row: CamFrozenStatement): string {
  const s = canonicalCamStatement(row);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export interface CamStatementDrift {
  field: string;
  /** The value on the frozen statement the tenant was billed from. */
  frozen: unknown;
  /** What a statement generated right now would say instead. */
  current: unknown;
}

/**
 * The fields worth reporting drift on: the money and the inputs behind it.
 * `generatedAt`/`generatedBy` always differ between two generations and say
 * nothing about whether the STATEMENT changed, so they are excluded — reporting
 * them would make every comparison look like drift and train operators to
 * ignore the signal.
 */
const NON_DRIFT_FIELDS = new Set<string>([
  "generatedAt",
  "generatedBy",
  // The rendered text is a function of the figures above; reporting it as a
  // drifted "field" would print two whole statements into a diff table.
  "statementMarkdown",
  "statementVersion",
]);

// DERIVED from the canonical field list, so a column added to the exhibit is
// automatically compared for drift unless it is deliberately excluded above.
const DRIFT_FIELDS: Array<keyof CamFrozenStatement> = CAM_STATEMENT_CANONICAL_FIELDS.filter(
  (f) => !NON_DRIFT_FIELDS.has(f),
) as Array<keyof CamFrozenStatement>;

function driftEqual(a: unknown, b: unknown): boolean {
  if (a == null && b == null) return true;
  if (typeof a === "object" || typeof b === "object") {
    return JSON.stringify(canonicalCategoryMap(a as Record<string, number>)) ===
      JSON.stringify(canonicalCategoryMap(b as Record<string, number>));
  }
  return a === b;
}

/**
 * What a statement generated today would say differently from the frozen one.
 * Reported, never applied — the frozen statement is what the tenant was billed.
 */
export function diffCamStatement(
  frozen: CamFrozenStatement,
  incoming: Partial<CamFrozenStatement>,
): CamStatementDrift[] {
  const out: CamStatementDrift[] = [];
  for (const field of DRIFT_FIELDS) {
    if (!(field in incoming)) continue;
    const a = frozen[field] ?? null;
    const b = incoming[field] ?? null;
    if (!driftEqual(a, b)) out.push({ field, frozen: a, current: b });
  }
  return out;
}

export type CamWriteDecision =
  | { action: "write"; reason: string; drift: CamStatementDrift[] }
  | { action: "refuse_frozen"; reason: string; drift: CamStatementDrift[] };

/**
 * THE freeze decision. Every write to `cam_reconciliations` goes through here.
 *
 * A frozen statement is never overwritten — not by a re-generate after the pool
 * was edited, and not by an operator-entered row landing on the same
 * (pool, lease) unique key. Both would rewrite an exhibit a tenant was already
 * billed from, which is precisely what the table exists to prevent.
 *
 * `intent` does not change the answer (a frozen statement is frozen against
 * everyone); it only shapes the sentence the operator reads, so the refusal
 * names the thing they actually tried to do.
 */
export function decideCamStatementWrite(args: {
  existing: CamFrozenStatement | null | undefined;
  incoming: Partial<CamFrozenStatement>;
  intent: "engine" | "operator_entered";
}): CamWriteDecision {
  const { existing, incoming, intent } = args;
  if (!isFrozenCamStatement(existing)) {
    return {
      action: "write",
      reason:
        existing == null
          ? "No statement exists for this lease and period yet."
          : "The existing row is operator-entered data, not a generated statement — it may be corrected.",
      drift: [],
    };
  }
  const frozen = existing as CamFrozenStatement;
  const drift = diffCamStatement(frozen, incoming);
  const what =
    intent === "engine"
      ? "Re-generating would recompute it"
      : "Recording an operator-entered reconciliation would replace it";
  return {
    action: "refuse_frozen",
    reason:
      `This CAM statement was generated on ${isoOrNull(frozen.generatedAt) ?? "an earlier date"} and is frozen. ` +
      `${what}, and the tenant was billed from the figures already issued. ` +
      (drift.length > 0
        ? `${drift.length} figure${drift.length === 1 ? "" : "s"} would change; the frozen statement stands and the differences are reported, not applied.`
        : "Nothing would change; the frozen statement stands."),
    drift,
  };
}
