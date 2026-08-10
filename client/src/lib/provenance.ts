/**
 * Provenance & freshness — ONE grammar for "where this number came from and
 * how current it is" (Wave 2.4, handoff §D / P1 §2.5).
 *
 * ─── WHY ────────────────────────────────────────────────────────────────────
 * Before this file the repo spoke TWO provenance dialects for the same fact:
 *
 *   • `DataProvenanceChip` — "FEMA NFHL · as of 2024 · 80%", where `sourceAsOf`
 *     is documented as *the vintage at the source, NOT when we fetched it*, and
 *     an unknown source rendered NOTHING at all.
 *   • `DataProvenanceTag`  — "County assessor, Mar 2024", where the very same
 *     prop name (`asOf`) is documented as *"when the data was last retrieved"*.
 *
 * Two components, one prop name, two different facts, and a silent absence. A
 * reader could not tell whether "Mar 2024" meant the county last touched the
 * record then or AcreOS last looked then — and where we knew neither, the
 * figure rendered bare, which reads as "no provenance needed" rather than "no
 * provenance known".
 *
 * This module is the single grammar both components now render from. It keeps
 * the two facts SEPARATE and NAMED:
 *
 *   sourceAsOf   the vintage of the fact AT the source ("as of 2024")
 *   retrievedAt  when AcreOS fetched / computed the value ("retrieved 3d ago")
 *
 * ─── HONEST ABSENCE (the whole point) ───────────────────────────────────────
 * A missing source is a FACT about the figure, not an absence of UI. When the
 * source is unknown the grammar says {@link PROVENANCE_UNKNOWN_SOURCE}; when
 * neither timestamp is known it says {@link PROVENANCE_UNKNOWN_FRESHNESS}. It
 * never guesses, never substitutes the render clock for a retrieval time, and
 * never emits a relative phrase it cannot source. `description.absent` carries
 * the plain-language reason so a caller can log or narrate it.
 *
 * (The concrete bug this replaced: comps-analysis.tsx stamped its estimated
 * market value with `asOf={new Date().toISOString()}` — the chip therefore read
 * "today" on every render regardless of how old the underlying comps were.
 * There is no way to express that here: `retrievedAt` has to come from a real
 * timestamp or the grammar states its absence.)
 *
 * ─── COMPOSITION, NOT A FORK ────────────────────────────────────────────────
 * `client/src/lib/stale-while-error.tsx` already owns a freshness sentence:
 * "Showing data from {time}" — that one is about the CLIENT CACHE (a refetch
 * failed, you are looking at what react-query still holds). This grammar is
 * about the UPSTREAM RECORD (which provider, which vintage, when we fetched).
 * The two are deliberately disjoint vocabularies for two different questions,
 * and `provenanceGrammar.test.ts` pins that this module never emits the stale
 * chip's sentence. Relative time here goes through the house `formatRelative`
 * (lib/format), so both surfaces speak the same "3d ago" dialect.
 */

import { formatDate, formatRelative } from "@/lib/format";

/**
 * How to treat the value. Structurally identical to
 * `shared/landProfile.ts`'s `LandFieldClassification` and the provider
 * registry's `DataClassification`, so a field from either can be fed straight
 * in without a mapping table.
 */
export type ProvenanceClassification =
  | "authoritative"
  | "estimate"
  | "modeled"
  | "unknown";

/** Qualitative confidence, for sources that report a band rather than a %. */
export type ProvenanceConfidenceLevel = "high" | "medium" | "low";

/** Granularity for the source vintage. Public datasets are honest at year. */
export type ProvenanceVintagePrecision = "year" | "day";

/** Rendered when we do not know where a figure came from. */
export const PROVENANCE_UNKNOWN_SOURCE = "Source not recorded";

/** Rendered when we know the source but neither its vintage nor our fetch time. */
export const PROVENANCE_UNKNOWN_FRESHNESS = "age not recorded";

export type ProvenanceTime = string | Date | number | null | undefined;

export interface Provenance {
  /** Named source, e.g. "FEMA NFHL", "County assessor", "AcreOS comp analysis". */
  source?: string | null;
  /** When the SOURCE last updated the fact. Not when we fetched it. */
  sourceAsOf?: ProvenanceTime;
  /** When ACREOS fetched or computed the value. `0` means unknown (react-query
   *  reports `dataUpdatedAt: 0` for placeholder data) and is treated as absent. */
  retrievedAt?: ProvenanceTime;
  /** 0–100, or a qualitative band. */
  confidence?: number | ProvenanceConfidenceLevel | null;
  classification?: ProvenanceClassification | null;
  /** Vintage granularity; defaults to "year". */
  vintagePrecision?: ProvenanceVintagePrecision;
}

/** Semantic tone. Each surface maps this to its own token — never a hex. */
export type ProvenanceTone = "positive" | "caution" | "negative" | "info" | "neutral";

export interface ProvenanceDescription {
  sourceKnown: boolean;
  vintageKnown: boolean;
  retrievalKnown: boolean;
  /** True when we know at least one of vintage / retrieval time. */
  freshnessKnown: boolean;
  /** The source name, or {@link PROVENANCE_UNKNOWN_SOURCE}. Never empty. */
  sourceText: string;
  /** "2024" / "Mar 12, 2024", or null. */
  vintageText: string | null;
  /** "3d ago" / "Jun 11, 2026", or null. */
  retrievalText: string | null;
  /** "80%" / "high confidence", or null. */
  confidenceText: string | null;
  classificationText: string | null;
  tone: ProvenanceTone;
  /** The one visible line, " · " separated. */
  line: string;
  /** Long form for screen readers — never color-only, never shorter than `line`. */
  aria: string;
  /** Plain-language reason WHY something is missing; null when nothing is. */
  absent: string | null;
}

const CLASSIFICATION_LABEL: Record<ProvenanceClassification, string> = {
  authoritative: "Authoritative record",
  estimate: "Estimate",
  modeled: "Modeled",
  unknown: "Unverified",
};

const TONE_VAR: Record<ProvenanceTone, string> = {
  positive: "var(--acr-pos)",
  caution: "var(--acr-heat-warm)",
  negative: "var(--acr-heat-hot)",
  info: "var(--acr-accent)",
  neutral: "var(--acr-muted, var(--muted-foreground))",
};

/** CSS custom property for a tone. Design tokens only — no hardcoded colors. */
export function provenanceToneVar(tone: ProvenanceTone): string {
  return TONE_VAR[tone];
}

function toDateOrNull(input: ProvenanceTime): Date | null {
  if (input == null || input === "") return null;
  // Epoch 0 / negative is react-query's "I don't know" sentinel, not 1970.
  if (typeof input === "number" && input <= 0) return null;
  const d = input instanceof Date ? input : new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * The source's own vintage. Some providers hand us a pre-formatted string
 * ("2024", "FY2023-24"); an unparseable string is passed through verbatim
 * rather than dropped, because the provider's own label is still real
 * provenance. A non-string unparseable value yields null.
 */
function formatVintage(
  input: ProvenanceTime,
  precision: ProvenanceVintagePrecision,
): string | null {
  if (input == null || input === "") return null;
  const d = toDateOrNull(input);
  if (!d) return typeof input === "string" ? input : null;
  // Year-only via getFullYear (not Intl) — no locale drift, and lib/format
  // has no year-only helper. Day precision uses the house formatter.
  return precision === "day" ? formatDate(d) : String(d.getFullYear());
}

function formatConfidence(
  confidence: number | ProvenanceConfidenceLevel | null | undefined,
): string | null {
  if (confidence == null) return null;
  if (typeof confidence === "number") {
    return Number.isFinite(confidence) ? `${Math.round(confidence)}%` : null;
  }
  return `${confidence} confidence`;
}

/**
 * Semantic tone for the dot. A modeled/estimate value is CAUTION regardless of
 * its internal confidence, because the uncertainty is structural rather than
 * statistical; an unknown source is NEUTRAL, never green.
 */
export function provenanceTone(p: Provenance): ProvenanceTone {
  if (!p.source) return "neutral";
  if (p.classification === "modeled" || p.classification === "estimate") {
    return "caution";
  }
  if (p.classification === "unknown") return "neutral";
  const c = p.confidence;
  if (c == null) return p.classification === "authoritative" ? "positive" : "info";
  if (typeof c === "number") {
    if (!Number.isFinite(c)) return "info";
    if (c >= 80) return "positive";
    if (c >= 50) return "caution";
    return "negative";
  }
  if (c === "high") return "positive";
  if (c === "medium") return "caution";
  return "negative";
}

/**
 * Describe a figure's provenance. Pure; pass `now` for deterministic tests.
 *
 * Nothing here invents a value: every clause is present only when its input
 * was, and each missing input produces a NAMED absence rather than silence.
 */
export function describeProvenance(
  p: Provenance,
  now: Date | number = Date.now(),
): ProvenanceDescription {
  const source = typeof p.source === "string" ? p.source.trim() : "";
  const sourceKnown = source.length > 0;

  const vintageText = formatVintage(p.sourceAsOf, p.vintagePrecision ?? "year");
  const retrievedDate = toDateOrNull(p.retrievedAt);
  const retrievalText = retrievedDate ? formatRelative(retrievedDate, now) : null;

  const vintageKnown = vintageText !== null;
  const retrievalKnown = retrievalText !== null;
  const freshnessKnown = vintageKnown || retrievalKnown;

  const confidenceText = formatConfidence(p.confidence);
  const classificationText = p.classification
    ? CLASSIFICATION_LABEL[p.classification]
    : null;

  const sourceText = sourceKnown ? source : PROVENANCE_UNKNOWN_SOURCE;

  const parts: string[] = [sourceText];
  if (vintageText) parts.push(`as of ${vintageText}`);
  if (retrievalText) parts.push(`retrieved ${retrievalText}`);
  if (!freshnessKnown && sourceKnown) parts.push(PROVENANCE_UNKNOWN_FRESHNESS);
  if (confidenceText) parts.push(confidenceText);

  const ariaParts: string[] = [
    sourceKnown
      ? `Source: ${source}`
      : `${PROVENANCE_UNKNOWN_SOURCE} for this figure`,
  ];
  if (classificationText) ariaParts.push(classificationText);
  if (vintageText) ariaParts.push(`source as of ${vintageText}`);
  if (retrievalText) ariaParts.push(`retrieved ${retrievalText}`);
  if (!freshnessKnown) ariaParts.push("no retrieval time recorded");
  if (confidenceText) {
    ariaParts.push(
      typeof p.confidence === "number"
        ? `${Math.round(p.confidence)} percent confidence`
        : confidenceText,
    );
  }

  let absent: string | null = null;
  if (!sourceKnown && !freshnessKnown) {
    absent = "No source and no retrieval time are recorded for this figure.";
  } else if (!sourceKnown) {
    absent = "No source is recorded for this figure.";
  } else if (!freshnessKnown) {
    absent = "No source vintage or retrieval time is recorded for this figure.";
  }

  return {
    sourceKnown,
    vintageKnown,
    retrievalKnown,
    freshnessKnown,
    sourceText,
    vintageText,
    retrievalText,
    confidenceText,
    classificationText,
    tone: provenanceTone(p),
    line: parts.join(" · "),
    aria: ariaParts.join(", "),
    absent,
  };
}
