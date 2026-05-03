import { Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export interface DataProvenanceTagProps {
  /** The data source label, e.g. "County assessor", "AcreOS estimate", "Regrid" */
  source: string;
  /** ISO date string or Date for when the data was last retrieved/updated */
  asOf?: string | Date | null;
  /** Optional confidence: "high" | "medium" | "low" */
  confidence?: "high" | "medium" | "low";
  /** Extra CSS classes for the outer wrapper */
  className?: string;
}

function formatProvenanceDate(date: string | Date): string {
  try {
    const d = new Date(date);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);

    if (diffDays < 1) return "today";
    if (diffDays < 30) return `${diffDays}d ago`;
    // Show month + year for older data
    return d.toLocaleDateString(undefined, { month: "short", year: "numeric" });
  } catch {
    return String(date);
  }
}

const confidenceDot: Record<string, string> = {
  high: "bg-acr-pos",
  medium: "bg-acr-warn",
  low: "bg-acr-neg",
};

/**
 * Subtle inline provenance tag for financial data points.
 * Shows source + optional "as of" date beneath a value.
 *
 * Usage:
 *   <p className="font-medium">{formatCurrency(value)}</p>
 *   <DataProvenanceTag source="County assessor" asOf={parcelData?.lastUpdated} />
 */
export function DataProvenanceTag({
  source,
  asOf,
  confidence,
  className,
}: DataProvenanceTagProps) {
  const dateLabel = asOf ? formatProvenanceDate(asOf) : null;

  const displayText = dateLabel ? `${source}, ${dateLabel}` : source;

  const tooltipText = asOf
    ? `Source: ${source}\nRetrieved: ${new Date(asOf).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}`
    : `Source: ${source}`;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "inline-flex items-center gap-1 text-[11px] text-muted-foreground/70 hover:text-muted-foreground transition-colors cursor-help leading-tight mt-0.5",
            className
          )}
        >
          {confidence && (
            <span
              className={cn(
                "inline-block h-1.5 w-1.5 rounded-full shrink-0",
                confidenceDot[confidence]
              )}
              aria-label={`${confidence} confidence`}
            />
          )}
          <Info className="w-3 h-3 shrink-0" />
          <span className="truncate">{displayText}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-xs whitespace-pre-line text-xs">
        {tooltipText}
      </TooltipContent>
    </Tooltip>
  );
}
