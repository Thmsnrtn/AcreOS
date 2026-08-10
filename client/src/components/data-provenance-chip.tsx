/**
 * DataProvenanceChip
 *
 * The compact inline rendering of the house provenance/freshness grammar
 * (`client/src/lib/provenance.ts`). Renders e.g.
 * "FEMA NFHL · as of 2024 · retrieved 3d ago · 80%" with a small tone dot whose
 * color is resolved entirely from design tokens (CSS vars) so it survives every
 * theme × mode combination.
 *
 * Wave 2.4 changed three things and kept everything else:
 *
 *  1. The sentence is no longer built here. `describeProvenance()` composes it,
 *     so this chip and `DataProvenanceTag` cannot drift apart again.
 *  2. `retrievedAt` exists as its own prop. `sourceAsOf` has always meant the
 *     vintage AT the source; "when did AcreOS last look" is a different fact and
 *     now has a different name instead of being crammed into the same one.
 *  3. An unknown source no longer renders NOTHING. Silence next to a figure
 *     reads as "no provenance needed"; the honest reading is "no provenance
 *     known", so the chip says {@link PROVENANCE_UNKNOWN_SOURCE}. Call sites
 *     whose surrounding copy ALREADY states the absence (the public parcel
 *     report and /tools/parcel-check both print "Source unavailable for this
 *     location.") pass `whenUnknown="hide"` so the page doesn't say it twice.
 *
 * Honesty contract:
 * - Nothing is invented. No source, no vintage, no fetch time → the grammar
 *   names the gap; the chip never fills it with the render clock.
 * - The full provenance is exposed as `aria-label` AND as visible text — never
 *   color-only — so screen readers and color-blind users get the same
 *   information (WCAG 1.4.1).
 */
import { cn } from "@/lib/utils";
import {
  describeProvenance,
  provenanceToneVar,
  type Provenance,
  type ProvenanceClassification,
  type ProvenanceConfidenceLevel,
  type ProvenanceTime,
  type ProvenanceVintagePrecision,
} from "@/lib/provenance";

/**
 * Kept as a named alias so existing importers
 * (`property-enrichment-widget.tsx`) keep compiling; the grammar owns the type.
 */
export type DataClassification = ProvenanceClassification;

interface DataProvenanceChipProps {
  /** Named source, e.g. "FEMA NFHL", "USDA SSURGO", "County GIS". */
  source?: string | null;
  /** When the authoritative source last updated the fact (NOT when we fetched it). */
  sourceAsOf?: ProvenanceTime;
  /** When AcreOS fetched or computed the value. `0`/null = unknown, and says so. */
  retrievedAt?: ProvenanceTime;
  /** 0–100, or a qualitative band the provider reported. */
  confidence?: number | ProvenanceConfidenceLevel | null;
  /** How to treat the value: authoritative record vs. estimate vs. computed model. */
  classification?: ProvenanceClassification | null;
  /** Vintage granularity; defaults to "year" (honest for most public datasets). */
  vintagePrecision?: ProvenanceVintagePrecision;
  /**
   * What to do when the source is unknown. Default "state" — say so. Use "hide"
   * ONLY where the surrounding copy already states the absence.
   */
  whenUnknown?: "state" | "hide";
  className?: string;
}

export function DataProvenanceChip({
  source,
  sourceAsOf,
  retrievedAt,
  confidence,
  classification,
  vintagePrecision,
  whenUnknown = "state",
  className,
}: DataProvenanceChipProps) {
  const provenance: Provenance = {
    source,
    sourceAsOf,
    retrievedAt,
    confidence,
    classification,
    vintagePrecision,
  };
  const d = describeProvenance(provenance);

  // The one case where rendering nothing is correct: the page itself already
  // told the reader the source is unavailable.
  if (!d.sourceKnown && whenUnknown === "hide") return null;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-micro text-muted-foreground leading-none",
        className,
      )}
      data-testid="data-provenance-chip"
      data-provenance-absent={d.absent ? "true" : undefined}
      title={d.absent ?? undefined}
    >
      <span
        aria-hidden="true"
        className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
        style={{ backgroundColor: provenanceToneVar(d.tone) }}
      />
      {/* The abbreviated line is shown but hidden from AT; the unabbreviated
          sentence is read instead. `aria-label` on a plain span is not a valid
          accessible name (role=generic), so the previous version's label was
          announced by nothing at all — this is the sr-only pattern used
          elsewhere in the component library. */}
      <span aria-hidden="true" className="truncate" data-testid="data-provenance-chip-line">
        {d.line}
      </span>
      <span className="sr-only" data-testid="data-provenance-chip-sr">
        {d.aria}
        {d.absent ? ` ${d.absent}` : ""}
      </span>
    </span>
  );
}

export default DataProvenanceChip;
