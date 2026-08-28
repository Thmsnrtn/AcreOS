/**
 * PaxWhyExplainer — Lens 46 customer-facing trust loop.
 *
 * Renders the "why Pax did this" surface for a single Pax observation.
 * Shows the model's stated reasoning, the inputs it weighed, alternatives
 * it ruled out, and which model produced the call. Customers can endorse
 * or reject the call with the full reasoning visible.
 *
 * Used inline in the Pax copilot rail (expandable card) and standalone
 * on any surface that needs a "show your work" affordance for a Pax
 * observation. Reads /api/pax/observations/:id/explain.
 */

import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { DataProvenanceChip } from "@/components/data-provenance-chip";
import { ChevronDown, ChevronUp, Brain, Lightbulb } from "lucide-react";
import { useState } from "react";

interface PaxObservationExplanation {
  observation: {
    id: number;
    title: string;
    description: string;
    severity: string;
    detectedAt: string | null;
  };
  reasoning: string | null;
  inputs: Record<string, unknown> | null;
  alternativesConsidered:
    | Array<{ action: string; rejectedBecause: string }>
    | null;
  modelUsed: string | null;
  confidenceScore: number;
  suggestedAction: string | null;
}

interface PaxWhyExplainerProps {
  observationId: number;
  /** Auto-fetch on mount. Default true. Pass false to gate on a parent toggle. */
  enabled?: boolean;
  /** When true, render only the expandable trigger (cards inline the rest). */
  triggerOnly?: boolean;
}

export function PaxWhyExplainer({
  observationId,
  enabled = true,
  triggerOnly = false,
}: PaxWhyExplainerProps) {
  const [expanded, setExpanded] = useState(false);

  const { data, isLoading, isError } = useQuery<PaxObservationExplanation>({
    queryKey: ["/api/pax/observations", observationId, "explain"],
    queryFn: async () => {
      const r = await fetch(
        `/api/pax/observations/${observationId}/explain`,
        { credentials: "include" },
      );
      if (!r.ok) throw new Error("Failed to load explanation");
      return r.json();
    },
    enabled: enabled && expanded,
    staleTime: 5 * 60_000,
  });

  if (triggerOnly && !expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="inline-flex items-center gap-1 text-caption text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
        aria-label="Show why Pax flagged this"
      >
        <Brain className="h-3 w-3" aria-hidden="true" />
        Why?
      </button>
    );
  }

  return (
    <div className="border-t border-border/50 pt-2 mt-2 text-xs">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
        aria-expanded={expanded}
        aria-label={expanded ? "Hide Pax reasoning" : "Show Pax reasoning"}
      >
        <Brain className="h-3 w-3" aria-hidden="true" />
        Why Pax flagged this
        {expanded ? (
          <ChevronUp className="h-3 w-3" aria-hidden="true" />
        ) : (
          <ChevronDown className="h-3 w-3" aria-hidden="true" />
        )}
      </button>

      {expanded && (
        <div className="mt-2 space-y-2">
          {isLoading && (
            <div className="space-y-1.5">
              <Skeleton className="h-3 w-32" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-4/5" />
            </div>
          )}

          {isError && (
            <p className="text-muted-foreground" role="alert">
              Couldn't load the reasoning for this observation.
            </p>
          )}

          {data && (
            <>
              <div>
                <DataProvenanceChip
                  source={data.modelUsed ?? "Pax"}
                  classification="modeled"
                  confidence={data.confidenceScore}
                />
              </div>

              {data.reasoning ? (
                <p className="text-foreground leading-snug">{data.reasoning}</p>
              ) : (
                <p className="text-muted-foreground italic">
                  No reasoning recorded for this observation.
                </p>
              )}

              {data.suggestedAction && (
                <div className="flex items-start gap-1.5 rounded-md bg-acr-accent/10 px-2 py-1.5">
                  <Lightbulb
                    className="h-3 w-3 text-acr-accent flex-shrink-0 mt-0.5"
                    aria-hidden="true"
                  />
                  <p className="text-foreground leading-snug">
                    <span className="font-medium">Suggested next step:</span>{" "}
                    {data.suggestedAction}
                  </p>
                </div>
              )}

              {data.alternativesConsidered &&
                data.alternativesConsidered.length > 0 && (
                  <div className="space-y-1">
                    <p className="font-medium text-foreground">
                      Other options Pax weighed
                    </p>
                    <ul className="space-y-1 list-none p-0 m-0">
                      {data.alternativesConsidered.map((alt, i) => (
                        <li key={i} className="text-muted-foreground">
                          <span className="font-medium text-foreground">
                            {alt.action}
                          </span>
                          {" — "}
                          {alt.rejectedBecause}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

              {data.inputs && Object.keys(data.inputs).length > 0 && (
                <details className="text-muted-foreground">
                  <summary className="cursor-pointer hover:text-foreground">
                    Inputs Pax saw
                  </summary>
                  <pre className="mt-1 bg-muted/50 rounded p-1.5 overflow-auto max-h-32 text-micro">
                    {JSON.stringify(data.inputs, null, 2)}
                  </pre>
                </details>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
