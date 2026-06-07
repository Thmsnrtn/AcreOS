/**
 * checklistAnnotation — CONFIDENCE-AWARE DILIGENCE CHECKLIST ANNOTATIONS.
 *
 * Maren (#6, Tahoe) — "If our free data can pre-flag the environmental
 * checklist items ('FEMA says Zone X — likely clears; verify'), the data
 * stops being a lookup and becomes the workflow. That's the retention hook."
 *
 * This module is a PURE MAPPER: it takes the raw result of an open-data
 * lookup (flood / wetlands / soil / environmental — the shapes returned by
 * `server/services/data-source-lookup.ts`) and produces a single honest,
 * human-readable `ChecklistAnnotation` carrying:
 *   - a one-line summary ("FEMA says Zone X — likely clears; verify"),
 *   - a `verdict` (likely_clears | needs_attention | flagged | unknown),
 *   - a `confidence` band (high | medium | low | none),
 *   - the `source` name + an `asOf` vintage when available.
 *
 * ── DESIGN INVARIANTS (Maren's non-negotiables) ──────────────────────────
 *  1. ANNOTATION ONLY. This NEVER changes a checklist item's `status` and
 *     NEVER checks it off. The verdict is advisory; the human still decides.
 *     The word "verify" is appended to every non-unknown annotation so the
 *     framing is honest — the data informs, it does not conclude.
 *  2. NEVER FABRICATE. A missing / API-unavailable / "Default" result yields
 *     an `unknown` verdict with `confidence: "none"` and a plain "not yet
 *     looked up" summary — we never invent a zone, a soil class, or a "clear".
 *     (Mirrors Maren #1: a real "Unknown" beats a fake value.)
 *  3. Pure + deterministic. No DB, no network, no Date.now() in the summary.
 *     Trivially unit-testable; the mapping IS the contract.
 *
 * The route layer calls `annotateEnvironmentalChecklist(...)` with whatever
 * lookups it already ran; the client renders the annotations read-only under
 * the corresponding checklist items.
 */

// ── Public types ─────────────────────────────────────────────────────────────

/** Checklist item ids in the diligence panel that we annotate. */
export type AnnotatableChecklistItemId =
  | "env-flood"
  | "env-wetlands"
  | "env-soil"
  | "env-epa";

export type AnnotationVerdict =
  /** Data suggests the item likely passes — still requires human verify. */
  | "likely_clears"
  /** Data suggests a caveat the human should weigh. */
  | "needs_attention"
  /** Data indicates a clear risk flag. */
  | "flagged"
  /** No usable data — not yet looked up / source unavailable. */
  | "unknown";

export type AnnotationConfidence = "high" | "medium" | "low" | "none";

export interface ChecklistAnnotation {
  /** Which checklist item this annotates. */
  itemId: AnnotatableChecklistItemId;
  /** One-line honest summary, always ending with a "verify" cue when known. */
  summary: string;
  verdict: AnnotationVerdict;
  confidence: AnnotationConfidence;
  /** Source name (e.g. "FEMA NFHL") — null when unknown. */
  source: string | null;
  /** ISO vintage of the data, when the lookup carried one. */
  asOf: string | null;
  /**
   * Whether the human should still act. ALWAYS true unless verdict is unknown
   * — the data never closes a diligence step on its own. Surfaced so the UI
   * can render a persistent "verify" affordance.
   */
  requiresVerification: boolean;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** A source string that signals the lookup didn't really resolve. */
function isUnavailableSource(source: unknown): boolean {
  if (typeof source !== "string") return true;
  const s = source.toLowerCase();
  return (
    s === "" ||
    s === "n/a" ||
    s.includes("default") ||
    s.includes("unavailable") ||
    s.includes("api unavailable")
  );
}

/** Pull an ISO date from common lookup vintage fields, if present. */
function extractAsOf(data: Record<string, any> | null | undefined): string | null {
  if (!data) return null;
  const candidate = data.lastUpdated ?? data.asOf ?? data.cachedAt ?? data.effectiveDate;
  if (!candidate) return null;
  if (candidate instanceof Date) return candidate.toISOString();
  if (typeof candidate === "string" && candidate.trim() !== "") return candidate;
  return null;
}

/** The honest "not yet looked up" annotation for an item. */
function unknownAnnotation(
  itemId: AnnotatableChecklistItemId,
  reason = "Not yet looked up.",
): ChecklistAnnotation {
  return {
    itemId,
    summary: reason,
    verdict: "unknown",
    confidence: "none",
    source: null,
    asOf: null,
    requiresVerification: false,
  };
}

/** Compose a known annotation, always appending the verify cue. */
function knownAnnotation(args: {
  itemId: AnnotatableChecklistItemId;
  lead: string;
  verdict: Exclude<AnnotationVerdict, "unknown">;
  confidence: Exclude<AnnotationConfidence, "none">;
  source: string;
  asOf: string | null;
}): ChecklistAnnotation {
  // The "verify" cue is load-bearing — it keeps the annotation advisory.
  const summary = `${args.lead.replace(/\s+$/, "")} — verify`;
  return {
    itemId: args.itemId,
    summary,
    verdict: args.verdict,
    confidence: args.confidence,
    source: args.source,
    asOf: args.asOf,
    requiresVerification: true,
  };
}

// ── Per-category mappers ─────────────────────────────────────────────────────

/**
 * Flood — maps a `lookupFloodZone(...)` result `data` to an env-flood
 * annotation. Expected fields: `{ zone, riskLevel, source, lastUpdated }`.
 */
export function annotateFlood(data: any): ChecklistAnnotation {
  const id: AnnotatableChecklistItemId = "env-flood";
  if (!data || isUnavailableSource(data.source)) {
    return unknownAnnotation(id);
  }
  const zone: string = typeof data.zone === "string" ? data.zone : "Unknown";
  const risk: string = (data.riskLevel ?? "unknown").toString().toLowerCase();
  const source: string = data.source;
  const asOf = extractAsOf(data);

  if (risk === "low") {
    return knownAnnotation({
      itemId: id,
      lead: `${source} says ${zone} — likely clears`,
      verdict: "likely_clears",
      confidence: "high",
      source,
      asOf,
    });
  }
  if (risk === "medium") {
    return knownAnnotation({
      itemId: id,
      lead: `${source} says ${zone} — moderate flood risk`,
      verdict: "needs_attention",
      confidence: "medium",
      source,
      asOf,
    });
  }
  if (risk === "high") {
    return knownAnnotation({
      itemId: id,
      lead: `${source} says ${zone} — high flood risk`,
      verdict: "flagged",
      confidence: "high",
      source,
      asOf,
    });
  }
  // Source present but risk indeterminate → low-confidence attention, not a pass.
  return knownAnnotation({
    itemId: id,
    lead: `${source} returned ${zone} — risk undetermined`,
    verdict: "needs_attention",
    confidence: "low",
    source,
    asOf,
  });
}

/**
 * Wetlands — maps a `lookupWetlands(...)` result. The diligence panel maps
 * wetlands onto the "Environmental review" item (env-wetlands).
 * Expected fields: `{ hasWetlands, classification, percentage, source }`.
 */
export function annotateWetlands(data: any): ChecklistAnnotation {
  const id: AnnotatableChecklistItemId = "env-wetlands";
  if (!data || isUnavailableSource(data.source)) {
    return unknownAnnotation(id);
  }
  const source: string = data.source;
  const asOf = extractAsOf(data);

  if (data.hasWetlands === true) {
    const pct = typeof data.percentage === "number" ? data.percentage : null;
    const cls = data.classification ? ` (${data.classification})` : "";
    const pctText = pct !== null ? ` ~${pct}% of parcel` : "";
    return knownAnnotation({
      itemId: id,
      lead: `${source} shows wetlands present${cls}${pctText}`,
      verdict: "flagged",
      confidence: "high",
      source,
      asOf,
    });
  }
  if (data.hasWetlands === false) {
    return knownAnnotation({
      itemId: id,
      lead: `${source} shows no mapped wetlands — likely clears`,
      verdict: "likely_clears",
      confidence: "medium",
      source,
      asOf,
    });
  }
  return unknownAnnotation(id);
}

/**
 * Soil — maps a `lookupSoilData(...)` result. Informational (annotated onto
 * env-soil). Expected: `{ soilType, drainage|drainageClass, suitability, source }`.
 */
export function annotateSoil(data: any): ChecklistAnnotation {
  const id: AnnotatableChecklistItemId = "env-soil";
  if (!data || isUnavailableSource(data.source)) {
    return unknownAnnotation(id);
  }
  const source: string = data.source;
  const asOf = extractAsOf(data);
  const soilType: string =
    typeof data.soilType === "string" && data.soilType.trim() !== ""
      ? data.soilType
      : "soil type unavailable";
  const drainage = data.drainage ?? data.drainageClass ?? null;
  const suitability = (data.suitability ?? "").toString().toLowerCase();
  const drainageText = drainage && drainage !== "Unknown" ? `, drainage ${drainage}` : "";

  if (suitability === "good") {
    return knownAnnotation({
      itemId: id,
      lead: `${source}: ${soilType}${drainageText} — suitable`,
      verdict: "likely_clears",
      confidence: "medium",
      source,
      asOf,
    });
  }
  if (suitability === "poor") {
    return knownAnnotation({
      itemId: id,
      lead: `${source}: ${soilType}${drainageText} — poor suitability`,
      verdict: "needs_attention",
      confidence: "medium",
      source,
      asOf,
    });
  }
  // Soil retrieved but no suitability verdict — report it, don't conclude.
  return knownAnnotation({
    itemId: id,
    lead: `${source}: ${soilType}${drainageText}`,
    verdict: "needs_attention",
    confidence: "low",
    source,
    asOf,
  });
}

/**
 * Environmental / EPA — maps a `lookupEpaData(...)` result onto env-epa.
 * Expected: `{ superfundSites?, nearestSiteDistance?, riskLevel, source }`.
 */
export function annotateEnvironmental(data: any): ChecklistAnnotation {
  const id: AnnotatableChecklistItemId = "env-epa";
  if (!data || isUnavailableSource(data.source)) {
    return unknownAnnotation(id);
  }
  const source: string = data.source;
  const asOf = extractAsOf(data);
  const risk: string = (data.riskLevel ?? "unknown").toString().toLowerCase();
  const siteCount = Array.isArray(data.superfundSites) ? data.superfundSites.length : 0;
  const nearest = data.nearestSiteDistance;

  if (siteCount > 0 || risk === "high") {
    const distText =
      typeof nearest === "number" ? ` (nearest ${nearest} mi)` : "";
    return knownAnnotation({
      itemId: id,
      lead: `${source}: ${siteCount} EPA site(s) nearby${distText}`,
      verdict: "flagged",
      confidence: "high",
      source,
      asOf,
    });
  }
  if (risk === "low") {
    return knownAnnotation({
      itemId: id,
      lead: `${source}: no EPA Superfund sites nearby — likely clears`,
      verdict: "likely_clears",
      confidence: "high",
      source,
      asOf,
    });
  }
  return knownAnnotation({
    itemId: id,
    lead: `${source}: environmental risk undetermined`,
    verdict: "needs_attention",
    confidence: "low",
    source,
    asOf,
  });
}

// ── Top-level orchestrator ───────────────────────────────────────────────────

export interface EnvironmentalLookupBundle {
  flood?: any;
  wetlands?: any;
  soil?: any;
  environmental?: any;
}

/**
 * Annotate the environmental diligence checklist items from whatever open-data
 * lookups the caller has on hand. Categories with no provided lookup yield an
 * honest `unknown` annotation rather than being omitted, so the UI can show
 * "not yet looked up" consistently.
 *
 * Returns a map keyed by checklist item id for easy client lookup. NEVER
 * mutates checklist item status — the human still checks the box.
 */
export function annotateEnvironmentalChecklist(
  lookups: EnvironmentalLookupBundle,
): Record<AnnotatableChecklistItemId, ChecklistAnnotation> {
  return {
    "env-flood": "flood" in lookups ? annotateFlood(lookups.flood) : unknownAnnotation("env-flood"),
    "env-wetlands":
      "wetlands" in lookups ? annotateWetlands(lookups.wetlands) : unknownAnnotation("env-wetlands"),
    "env-soil": "soil" in lookups ? annotateSoil(lookups.soil) : unknownAnnotation("env-soil"),
    "env-epa":
      "environmental" in lookups
        ? annotateEnvironmental(lookups.environmental)
        : unknownAnnotation("env-epa"),
  };
}
