/**
 * DataProvenanceChip
 *
 * A tiny, honest attribution chip for any enrichment value sourced from a
 * real provider. Renders e.g. "FEMA NFHL · as of 2024 · 80%" with a small
 * confidence dot whose color is resolved entirely from design tokens (CSS
 * vars) so it survives every theme × mode combination.
 *
 * Honesty contract:
 * - If there is no `source`, the chip renders NOTHING (graceful). We never
 *   invent an attribution to make a value look authoritative.
 * - The full human-readable provenance is exposed as an `aria-label` and as
 *   visible text — never color-only — so screen readers and color-blind users
 *   get the same information (WCAG 1.4.1).
 *
 * This is the chrome that makes free open data feel premium: a customer can
 * see exactly where a number came from, how old it is, and how confident we
 * are — something a paid black box literally cannot match.
 */
import { cn } from "@/lib/utils";

// Single-sourced since 2026-08-28 (shared/dataClassification.ts); re-exported
// because this chip's callers import the type from here.
export type { DataClassification } from "@shared/dataClassification";
import type { DataClassification } from "@shared/dataClassification";
import { formatDate } from "@/lib/format";

interface DataProvenanceChipProps {
  /** Named source, e.g. "FEMA NFHL", "USDA SSURGO", "County GIS". Required to render. */
  source?: string | null;
  /** When the authoritative source last updated the fact (NOT when we fetched it). */
  sourceAsOf?: string | Date | null;
  /** 0–100 confidence the provider reported. */
  confidence?: number | null;
  /** How to treat the value: authoritative record vs. estimate vs. computed model. */
  classification?: DataClassification | null;
  className?: string;
}

/** Resolve the confidence-dot color from design tokens — never hardcoded. */
function confidenceVar(
  confidence: number | null | undefined,
  classification: DataClassification | null | undefined,
): string {
  // A modeled/estimate value is amber regardless of its internal confidence,
  // because the uncertainty is structural, not statistical.
  if (classification === "modeled" || classification === "estimate") {
    return "var(--acr-heat-warm)";
  }
  if (classification === "unknown") {
    return "var(--acr-muted, var(--muted-foreground))";
  }
  if (confidence == null) {
    // Authoritative source with no numeric confidence still reads as trusted.
    return classification === "authoritative" ? "var(--acr-pos)" : "var(--acr-accent)";
  }
  if (confidence >= 80) return "var(--acr-pos)";
  if (confidence >= 50) return "var(--acr-heat-warm)";
  return "var(--acr-heat-hot)";
}

/**
 * "as of 2024" / "as of Mar 2024" / "as of Aug 28" — best-effort, never
 * throws on bad input. Year-only is the honest granularity for most public
 * datasets (a county roll stamped "2024" was not updated on any particular
 * day the customer should rely on). But the step-3 migration brought LIVE
 * surfaces onto this chip — model runs, enrichment snapshots — where a
 * recent timestamp collapsed to its year reads as a stale dataset vintage
 * (the finance-steering refusal, 2026-08-28). Precision now follows the
 * data's own recency: within ~90 days the full house date ("Aug 28, 2026",
 * via lib/format), else the year.
 */
function formatAsOf(asOf: string | Date | null | undefined): string | null {
  if (!asOf) return null;
  const d = asOf instanceof Date ? asOf : new Date(asOf);
  if (Number.isNaN(d.getTime())) {
    // Server may already send a pre-formatted string like "2024" — pass through.
    return typeof asOf === "string" ? asOf : null;
  }
  const ageDays = (Date.now() - d.getTime()) / 86400000;
  if (ageDays >= 0 && ageDays <= 90) {
    return formatDate(d);
  }
  return String(d.getFullYear());
}

const CLASSIFICATION_LABEL: Record<DataClassification, string> = {
  authoritative: "Authoritative record",
  estimate: "Estimate",
  modeled: "Modeled",
  unknown: "Unverified",
};

export function DataProvenanceChip({
  source,
  sourceAsOf,
  confidence,
  classification,
  className,
}: DataProvenanceChipProps) {
  // Graceful: no source = no chip. Never fabricate provenance.
  if (!source) return null;

  const asOf = formatAsOf(sourceAsOf);
  const dotColor = confidenceVar(confidence, classification);

  const parts: string[] = [source];
  if (asOf) parts.push(`as of ${asOf}`);
  if (typeof confidence === "number") parts.push(`${Math.round(confidence)}%`);
  const visible = parts.join(" · ");

  const ariaParts = [`Source: ${source}`];
  if (classification) ariaParts.push(CLASSIFICATION_LABEL[classification]);
  if (asOf) ariaParts.push(`as of ${asOf}`);
  if (typeof confidence === "number") ariaParts.push(`${Math.round(confidence)} percent confidence`);
  const aria = ariaParts.join(", ");

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-micro text-muted-foreground leading-none",
        className,
      )}
      aria-label={aria}
      data-testid="data-provenance-chip"
    >
      <span
        aria-hidden="true"
        className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
        style={{ backgroundColor: dotColor }}
      />
      <span aria-hidden="true" className="truncate">
        {visible}
      </span>
    </span>
  );
}

export default DataProvenanceChip;
