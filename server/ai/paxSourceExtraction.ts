/**
 * Andrei (2026-06-06) — source-fact extraction for the Pax hallucination guard.
 *
 * The hallucination guard (server/services/paxHallucinationGuard.ts → guardPaxOutput)
 * can verify that the numbers and entity IDs Pax states actually came from the
 * data it was given THIS turn — but only if the caller hands it that source
 * context. Before this module, executive.ts called the guard with only
 * { organizationId, output }, so the numeric check had no source set to compare
 * against (it fell back to a weak freeform heuristic) and the entity-existence
 * check never fired at all (no IDs passed).
 *
 * This module walks the `toolCallsExecuted` array a Pax turn produced and pulls:
 *  - sourceNumbers: every numeric fact that appeared in a tool RESULT — parcel
 *    acreage, prices, scores, enrichment values, APN-derived numbers — so the
 *    guard can flag any number in Pax's reply that isn't grounded in a source.
 *  - claimedPropertyIds / claimedLeadIds / claimedDealIds: the entity IDs the
 *    tools touched, so the guard's cross-org existence check can fire.
 *
 * Design notes:
 *  - We extract from tool RESULTS (what the data layer returned), not tool
 *    ARGS, because args are what Pax/the model *asked for* and could themselves
 *    be hallucinated. The result is the ground truth the guard compares against.
 *  - We are deliberately GENEROUS in what counts as a source number (recurse the
 *    whole result object). A false negative here (missing a real source number)
 *    is worse than a false positive: a missed source number can make the guard
 *    flag a legitimate value, but the guard is advisory for `warning` severity,
 *    so over-collection only loosens the net — it never blocks a good answer.
 *  - Property IDs are collected only from well-known id-bearing fields
 *    (propertyId / property.id / id within a property-shaped object), not from
 *    every numeric field, to avoid turning an acreage value into a fake ID.
 */

export interface ExtractedSourceContext {
  sourceNumbers: number[];
  claimedPropertyIds: number[];
  claimedLeadIds: number[];
  claimedDealIds: number[];
}

/** A single executed tool call as pushed onto `toolCallsExecuted` in executive.ts. */
export interface ExecutedToolCall {
  name: string;
  arguments?: unknown;
  result?: unknown;
}

const MAX_DEPTH = 6;

/** Coerce a value to a finite, positive-ish number, or null. */
function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    // Strip currency/percent/commas; only accept a clean numeric token.
    const cleaned = value.replace(/[$,%\s]/g, "");
    if (cleaned === "" || !/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Keys whose numeric values are NOT facts to compare Pax's prose against —
 * timestamps, internal IDs, coordinates, counts/flags. Including these as
 * "source numbers" would let the guard treat e.g. a unix timestamp or a row id
 * as a legitimate dollar figure Pax could echo. Matched case-insensitively as
 * substrings.
 */
const NON_FACT_KEY_SUBSTRINGS = [
  "id",
  "latitude",
  "longitude",
  "lat",
  "lng",
  "lon",
  "timestamp",
  "createdat",
  "updatedat",
  "fetchedat",
  "enrichedat",
  "asof",
  "_at",
];

function isNonFactKey(key: string): boolean {
  const k = key.toLowerCase();
  return NON_FACT_KEY_SUBSTRINGS.some((s) => k.includes(s));
}

/** Property-ish container detection: an object that looks like a property row. */
function looksLikeProperty(obj: Record<string, unknown>): boolean {
  return (
    "apn" in obj ||
    "sizeAcres" in obj ||
    "parcelData" in obj ||
    "parcelBoundary" in obj
  );
}

function pushId(set: Set<number>, value: unknown): void {
  const n = toFiniteNumber(value);
  if (n != null && Number.isInteger(n) && n > 0) set.add(n);
}

/**
 * Recursively walk a tool result, collecting source numbers and entity IDs.
 */
function walk(
  node: unknown,
  ctx: {
    numbers: Set<number>;
    propertyIds: Set<number>;
    leadIds: Set<number>;
    dealIds: Set<number>;
  },
  depth: number,
  parentKey: string | null,
): void {
  if (node == null || depth > MAX_DEPTH) return;

  if (Array.isArray(node)) {
    for (const item of node) walk(item, ctx, depth + 1, parentKey);
    return;
  }

  if (typeof node === "object") {
    const obj = node as Record<string, unknown>;
    const propertyShaped = looksLikeProperty(obj);

    for (const [key, value] of Object.entries(obj)) {
      const lowerKey = key.toLowerCase();

      // Entity-ID collection from well-known id-bearing keys.
      if (lowerKey === "propertyid") {
        pushId(ctx.propertyIds, value);
      } else if (lowerKey === "leadid") {
        pushId(ctx.leadIds, value);
      } else if (lowerKey === "dealid") {
        pushId(ctx.dealIds, value);
      } else if (lowerKey === "id" && propertyShaped) {
        // `id` on a property-shaped object is a property id.
        pushId(ctx.propertyIds, value);
      }

      if (value != null && typeof value === "object") {
        walk(value, ctx, depth + 1, key);
        continue;
      }

      // Scalar: candidate source number, unless it's a non-fact key.
      if (!isNonFactKey(key)) {
        const n = toFiniteNumber(value);
        if (n != null && n > 0) ctx.numbers.add(n);
      }
    }
    return;
  }
}

/**
 * Extract the source context the hallucination guard needs from a Pax turn's
 * executed tool calls. Returns empty arrays when there were no tool calls
 * (a pure-conversational turn) — in which case the guard falls back to its
 * freeform numeric heuristic + entity checks with no claimed IDs.
 */
export function extractSourceContext(
  toolCallsExecuted: ReadonlyArray<ExecutedToolCall> | undefined | null,
): ExtractedSourceContext {
  const numbers = new Set<number>();
  const propertyIds = new Set<number>();
  const leadIds = new Set<number>();
  const dealIds = new Set<number>();

  if (toolCallsExecuted) {
    for (const call of toolCallsExecuted) {
      if (!call || call.result == null) continue;
      // Tool results are sometimes stringified JSON; parse opportunistically.
      let result: unknown = call.result;
      if (typeof result === "string") {
        try {
          result = JSON.parse(result);
        } catch {
          // Not JSON — skip; we only mine structured results.
          continue;
        }
      }
      walk(result, { numbers, propertyIds, leadIds, dealIds }, 0, null);
    }
  }

  return {
    sourceNumbers: Array.from(numbers),
    claimedPropertyIds: Array.from(propertyIds),
    claimedLeadIds: Array.from(leadIds),
    claimedDealIds: Array.from(dealIds),
  };
}
