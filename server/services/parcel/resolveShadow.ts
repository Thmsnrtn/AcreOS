/**
 * resolveShadow — field-level shadow-diff detection + logging.
 *
 * When `resolveParcel` runs (sampled), it also computes the legacy broker result
 * and hands both normalized results here. This module compares them field by
 * field per category and emits a structured `resolve_shadow_diff` log line for
 * every DIFFERENCE — the evidence base for the eventual full caller migration.
 *
 * Design choices:
 *   - Log, not table. A structured log line keyed `event: "resolve_shadow_diff"`
 *     is queryable in the log pipeline without a migration, and this is a
 *     pre-launch diagnostic, not a system of record. (If volume warrants, a
 *     `resolve_shadow_diffs` table is the trivial next step — the shape here is
 *     already row-flat.)
 *   - We compare PROVENANCE + availability fields (the ones a customer sees and
 *     that the honesty contract is about): available, source, sourceAsOf,
 *     classification, confidence. We do NOT deep-diff the raw `data` payload —
 *     the two spines structure it differently by design, and a payload diff
 *     would be all noise. A presence/availability mismatch is the load-bearing
 *     signal ("one door has it, the other doesn't").
 *   - Never throws into the caller. Logging is best-effort.
 */

import { logger } from "../../utils/logger";
import type { DataCategory, LookupInput } from "../providers/types";
import type { ResolvedCategory } from "./resolveParcel";

/** A single field-level difference between the two spines for one category. */
export interface ShadowFieldDiff {
  category: DataCategory;
  field: "available" | "source" | "sourceAsOf" | "classification" | "confidence";
  unified: unknown;
  legacy: unknown;
}

/** The fields we treat as load-bearing provenance for the diff. */
const COMPARED_FIELDS: ShadowFieldDiff["field"][] = [
  "available",
  "source",
  "sourceAsOf",
  "classification",
  "confidence",
];

/**
 * Diff one category's unified vs. legacy normalized result. Returns the list of
 * differing provenance fields (empty when the two agree). Pure + exported for
 * unit testing.
 */
export function diffCategory(
  category: DataCategory,
  unified: ResolvedCategory | undefined,
  legacy: ResolvedCategory | undefined,
): ShadowFieldDiff[] {
  const diffs: ShadowFieldDiff[] = [];
  for (const field of COMPARED_FIELDS) {
    const u = unified ? unified[field] : undefined;
    const l = legacy ? legacy[field] : undefined;
    if (!fieldsEqual(u, l)) {
      diffs.push({ category, field, unified: u, legacy: l });
    }
  }
  return diffs;
}

/**
 * Field equality that treats null/undefined as equal (both mean "no value") and
 * confidence within a small epsilon as equal (the spines round differently).
 */
function fieldsEqual(a: unknown, b: unknown): boolean {
  if (a == null && b == null) return true;
  if (typeof a === "number" && typeof b === "number") {
    return Math.abs(a - b) < 1; // confidence 0–100, sub-point drift is noise
  }
  return a === b;
}

/**
 * Compute and log all field-level diffs across the requested categories. One
 * structured log line per differing category (with its field diffs nested) plus
 * a roll-up count. Never throws.
 *
 * Returns the full diff list (so callers/tests can assert on it directly).
 */
export function logShadowDiff(
  input: LookupInput,
  categories: DataCategory[],
  unified: Record<string, ResolvedCategory>,
  legacy: Record<string, ResolvedCategory>,
): ShadowFieldDiff[] {
  const allDiffs: ShadowFieldDiff[] = [];
  try {
    for (const category of categories) {
      const catDiffs = diffCategory(category, unified[category], legacy[category]);
      if (catDiffs.length > 0) {
        allDiffs.push(...catDiffs);
        logger.info("resolve_shadow_diff", {
          source: "resolveParcel.shadow",
          metadata: {
            event: "resolve_shadow_diff",
            inputType: input.type,
            inputKey: inputKey(input),
            category,
            diffs: catDiffs.map((d) => ({
              field: d.field,
              unified: d.unified,
              legacy: d.legacy,
            })),
          },
        });
      }
    }

    if (allDiffs.length > 0) {
      logger.warn("resolve_shadow_diff summary: spines disagree", {
        source: "resolveParcel.shadow",
        metadata: {
          event: "resolve_shadow_diff_summary",
          inputType: input.type,
          inputKey: inputKey(input),
          diffCount: allDiffs.length,
          categoriesAffected: [...new Set(allDiffs.map((d) => d.category))],
        },
      });
    }
  } catch (err) {
    logger.warn("[resolveShadow] diff logging failed (non-fatal)", {
      source: "resolveParcel.shadow",
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return allDiffs;
}

/**
 * A stable, low-cardinality, PII-safe key for the input. Coordinates are rounded
 * to 4 decimals (the broker's own cache granularity); identifying inputs are
 * deliberately NOT emitted verbatim.
 */
function inputKey(input: LookupInput): string {
  switch (input.type) {
    case "coordinates":
      return `${input.latitude.toFixed(4)},${input.longitude.toFixed(4)}`;
    case "address":
      return `addr:${input.state}/${input.zip}`;
    case "apn":
      return `apn:${input.state}/${input.county}`;
    case "owner":
      return `owner:${input.state ?? "?"}`;
  }
}
