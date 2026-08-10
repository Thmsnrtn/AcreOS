/**
 * DataProvenanceTag
 *
 * The tooltip-bearing rendering of the house provenance/freshness grammar
 * (`client/src/lib/provenance.ts`) — the same sentence as
 * `DataProvenanceChip`, laid out for a figure that needs its attribution
 * tucked underneath rather than beside it (finance tables, comps rows).
 *
 * Wave 2.4 unified this with the chip. Before, the two components each built
 * their own sentence and — worse — used the same prop name `asOf` for
 * DIFFERENT facts: the chip's meant "the source's own vintage", this one's
 * meant "when we retrieved it". They are now separate, named props and one
 * shared grammar:
 *
 *   asOf        the vintage AT the source ("as of Mar 12, 2024")
 *   retrievedAt when AcreOS fetched or computed the value ("retrieved 3d ago")
 *
 * Honesty contract: when neither is known the tag SAYS so rather than showing
 * a bare source that reads as current, and confidence is rendered as text as
 * well as a dot (never color-only). Dates go through the house formatters via
 * the grammar — this file no longer calls `toLocaleDateString` itself.
 *
 * Usage:
 *   <p className="font-medium">{formatCurrency(value)}</p>
 *   <DataProvenanceTag
 *     source="County assessor"
 *     asOf={parcelData?.lastUpdated}
 *     retrievedAt={query.dataUpdatedAt}
 *   />
 */
import { Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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

export interface DataProvenanceTagProps {
  /** The data source label, e.g. "County assessor", "AcreOS estimate", "Regrid" */
  source?: string | null;
  /** When the SOURCE last updated the fact. Not when we fetched it. */
  asOf?: ProvenanceTime;
  /** When AcreOS fetched or computed the value. `0`/null = unknown, and says so. */
  retrievedAt?: ProvenanceTime;
  /** Qualitative band, or a 0–100 number. */
  confidence?: ProvenanceConfidenceLevel | number | null;
  classification?: ProvenanceClassification | null;
  /** Vintage granularity; defaults to "day" here — these are event dates. */
  vintagePrecision?: ProvenanceVintagePrecision;
  /** Extra CSS classes for the outer wrapper */
  className?: string;
}

export function DataProvenanceTag({
  source,
  asOf,
  retrievedAt,
  confidence,
  classification,
  vintagePrecision = "day",
  className,
}: DataProvenanceTagProps) {
  const provenance: Provenance = {
    source,
    sourceAsOf: asOf,
    retrievedAt,
    confidence,
    classification,
    vintagePrecision,
  };
  const d = describeProvenance(provenance);

  const tooltipLines = [d.aria];
  if (d.absent) tooltipLines.push(d.absent);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "inline-flex items-center gap-1 text-[11px] text-muted-foreground/70 hover:text-muted-foreground transition-colors cursor-help leading-tight mt-0.5",
            className
          )}
          data-testid="data-provenance-tag"
          data-provenance-absent={d.absent ? "true" : undefined}
        >
          <span
            aria-hidden="true"
            className="inline-block h-1.5 w-1.5 rounded-full shrink-0"
            style={{ backgroundColor: provenanceToneVar(d.tone) }}
          />
          <Info className="w-3 h-3 shrink-0" aria-hidden="true" />
          {/* Same sr-only split as DataProvenanceChip: the truncated line is
              visual, the full sentence is what AT reads. The tooltip is
              pointer/focus-only and must not be the sole carrier. */}
          <span aria-hidden="true" className="truncate" data-testid="data-provenance-tag-line">
            {d.line}
          </span>
          <span className="sr-only" data-testid="data-provenance-tag-sr">
            {d.aria}
            {d.absent ? ` ${d.absent}` : ""}
          </span>
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-xs whitespace-pre-line text-xs">
        {tooltipLines.join("\n")}
      </TooltipContent>
    </Tooltip>
  );
}
