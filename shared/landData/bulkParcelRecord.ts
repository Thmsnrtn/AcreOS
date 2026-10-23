/**
 * Canonical bulk parcel record — the normalized shape a statewide cadastral
 * ingest writes (D1b; first source: the Florida DOR statewide layer).
 *
 * D1 amendment A1 (data-sourcing v2 §1.2): provenance is carried PER FIELD
 * GROUP, not per record, because the groups age at different speeds and come
 * from different upstream processes. Each group states where its values came
 * from, how confident the record is and why, and its decay class:
 *
 *   identity   — stable (the source's own parcel key)
 *   geometry   — years
 *   ownership  — ~1 year (owner of record changes on sale / at roll time)
 *   tax        — months (assessments and tax status change on the tax cycle)
 *   valuation  — continuous (a market value is stale the day after it is set)
 *   sale       — event (a recorded sale is a fact about a day; it does not decay)
 *
 * These fields land with the schema, before bulk ingest: adding them after
 * millions of rows exist means re-deriving every row (the cost A1 avoids).
 * A value the source does not carry is null — never 0, never a default.
 */

export type DecayClass = "stable" | "years" | "about_a_year" | "months" | "continuous" | "event";

export type FieldGroup = "identity" | "geometry" | "ownership" | "tax" | "valuation" | "sale";

export const FIELD_GROUP_DECAY: Record<FieldGroup, DecayClass> = {
  identity: "stable",
  geometry: "years",
  ownership: "about_a_year",
  tax: "months",
  valuation: "continuous",
  sale: "event",
};

export type Confidence = "high" | "medium" | "low";

export interface GroupProvenance {
  /** Register name of the source (data-licenses / statewide registry). */
  source: string;
  /** The source's own field names the group's values were read from. */
  sourceFields: string[];
  /** ISO date the source's data is as of; null when the source does not say. */
  asOf: string | null;
  /** null when the group carries no value (nothing to be confident about). */
  confidence: Confidence | null;
  /** Why that confidence — a sentence a reviewer can check, never a bare label. */
  confidenceBasis: string;
  decayClass: DecayClass;
}

export interface BulkParcelRecord {
  state: string;
  /** County name as the source states it (or the source's county code), null if unstated. */
  county: string | null;
  identity: { sourceParcelId: string };
  geometry: { type: "Polygon" | "MultiPolygon"; coordinates: unknown } | null;
  ownership: { ownerName: string | null; situsAddress: string | null };
  tax: { assessedValueUsd: number | null };
  valuation: { marketValueUsd: number | null };
  sale: { lastSalePriceUsd: number | null };
  legalDescription: string | null;
  provenance: Record<FieldGroup, GroupProvenance>;
}

/** Parse a source money/number cell: a finite number, else null (blank, "N/A", negative sentinel). */
export function sourceNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Trimmed text, or null for blank. */
export function sourceText(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}
