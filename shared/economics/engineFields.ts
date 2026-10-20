/**
 * How an underwriting engine's inputs are presented to an operator.
 *
 * Engines (shared/economics/scenario.ts, server/services/economics/engines/)
 * own the arithmetic. This describes only the FORM: the label, the unit the
 * operator types in, and the conversion at the wire. The engine never sees a
 * dollar or a "7.5%" string, only integer cents and plain numbers, because
 * `requireCents` refuses anything else.
 *
 * Each vertical keeps its field list next to its engine
 * (shared/economics/fields/<engineId>.ts). No central registry is edited when a
 * vertical is added, so two verticals built in parallel cannot collide here.
 *
 * Unit conventions (every engine follows them):
 *   cents    the operator types dollars; the wire carries integer cents.
 *   percent  the operator types percentage points (7.5 for 7.5%); the wire
 *            carries the same number. Engines take percentage points, never
 *            0.075 fractions, so a 7.5 cannot be mistaken for 750%.
 *   months   whole months.
 *   count    a whole count (units, lots, nights).
 *   number   a plain number with no unit (an occupancy ratio typed as 0.82,
 *            say). Avoid it when a percent would do.
 */

export type EngineFieldUnit = "cents" | "percent" | "months" | "count" | "number";

export interface EngineField {
  /** The engine input key, verbatim. */
  key: string;
  label: string;
  unit: EngineFieldUnit;
  /** One line under the input: what it means and where the number comes from. */
  hint?: string;
  /**
   * Optional inputs may be left empty, and empty is sent as ABSENT, never as 0.
   * For most engines an unknown expense and a zero expense produce very
   * different numbers.
   */
  optional?: boolean;
  /** Inclusive bounds the form enforces before asking the server. */
  min?: number;
  max?: number;
}

/** Convert one typed value to its wire form, or `undefined` when empty/invalid. */
function toWire(field: EngineField, typed: string): number | undefined {
  const t = typed.replace(/[$,%\s]/g, "");
  if (t === "") return undefined;
  const n = Number(t);
  if (!Number.isFinite(n)) return undefined;
  if (field.min !== undefined && n < field.min) return undefined;
  if (field.max !== undefined && n > field.max) return undefined;
  if (field.unit === "cents") return Math.round(n * 100);
  if (field.unit === "months" || field.unit === "count") return Number.isInteger(n) ? n : undefined;
  return n;
}

/**
 * The wire inputs for a filled form, or the keys still missing/invalid.
 * Optional empties are omitted (absent ≠ zero).
 */
export function wireInputs(
  fields: readonly EngineField[],
  typed: Readonly<Record<string, string>>,
): { inputs: Record<string, number>; missing: string[] } {
  const inputs: Record<string, number> = {};
  const missing: string[] = [];
  for (const f of fields) {
    const raw = typed[f.key] ?? "";
    const v = toWire(f, raw);
    if (v === undefined) {
      if (!f.optional || raw.trim() !== "") missing.push(f.key);
      continue;
    }
    inputs[f.key] = v;
  }
  return { inputs, missing };
}
