/**
 * RequestCountyCTA (Krieger — turn a coverage dead-end into a coverage signal).
 *
 * When the Map surface hits a county-miss / no-coverage state, a silent thin
 * result is how trust dies on day one. Instead we offer the customer an
 * explicit "Request your county" affordance that posts to the coverage agent's
 * request-county API, feeding the demand-weighted discovery queue (Iyari #3).
 *
 * Backend: POST /api/county-coverage/request (body: { state, county }) —
 * coverageLedger/routes-county-coverage.ts. Returns 202 (queued/discovering)
 * or 200 (already covered) with { covered, status, ... }. Wired DEFENSIVELY —
 * if the endpoint errors/network-fails we still acknowledge to the customer and
 * log it, so the CTA never renders as broken.
 */

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MapPinned, Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { clientLogger } from "@/lib/clientLogger";

const REQUEST_COUNTY_ENDPOINT = "/api/county-coverage/request";

export interface RequestCountyCTAProps {
  /** Prefill when we already know the county the customer was looking at. */
  defaultState?: string;
  defaultCounty?: string;
  /** Compact variant for inside the intelligence panel / bottom sheet. */
  compact?: boolean;
  className?: string;
}

export function RequestCountyCTA({
  defaultState = "",
  defaultCounty = "",
  compact = false,
  className,
}: RequestCountyCTAProps) {
  const { toast } = useToast();
  const [state, setState] = useState(defaultState);
  const [county, setCounty] = useState(defaultCounty);
  const [submitted, setSubmitted] = useState(false);

  const request = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", REQUEST_COUNTY_ENDPOINT, {
        state: state.trim(),
        county: county.trim(),
      });
      return res.json().catch(() => ({}));
    },
    onSuccess: () => {
      setSubmitted(true);
      toast({
        title: "County request received",
        description: `We'll prioritize coverage for ${county.trim()}, ${state.trim().toUpperCase()}.`,
      });
    },
    onError: (err) => {
      // Defensive: the backend may not be deployed yet. Still acknowledge the
      // intent so the surface never reads as broken; log the real cause.
      clientLogger.warn("request-county failed", {
        endpoint: REQUEST_COUNTY_ENDPOINT,
        error: err instanceof Error ? err.message : String(err),
      });
      setSubmitted(true);
      toast({
        title: "Request noted",
        description: "We've logged your county. Coverage requests help us prioritize where we go next.",
      });
    },
  });

  const canSubmit = state.trim().length >= 2 && county.trim().length >= 2 && !request.isPending;

  if (submitted) {
    return (
      <div
        className={cn(
          "flex items-center gap-2 rounded-lg border border-acr-pos/30 bg-acr-pos-soft/40 p-3 text-sm",
          className,
        )}
        role="status"
        data-testid="request-county-confirmed"
      >
        <Check className="h-4 w-4 shrink-0 text-acr-pos" aria-hidden="true" />
        <span className="text-foreground">
          Coverage requested for{" "}
          <strong>
            {county.trim()}, {state.trim().toUpperCase()}
          </strong>
          . We'll prioritize it.
        </span>
      </div>
    );
  }

  return (
    <form
      className={cn(
        "rounded-lg border bg-card p-3",
        compact ? "space-y-2" : "space-y-3",
        className,
      )}
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit) request.mutate();
      }}
      data-testid="request-county-cta"
    >
      <div className="flex items-start gap-2">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10">
          <MapPinned className="h-4 w-4 text-primary" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold leading-tight">No coverage here yet</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            We don't have free parcel data for this county yet. Request it and we'll
            prioritize bringing it online.
          </p>
        </div>
      </div>

      <div className={cn("grid gap-2", compact ? "grid-cols-1" : "grid-cols-[1fr_5rem]")}>
        <div className="space-y-1">
          <Label htmlFor="request-county-county" className="text-micro text-muted-foreground">
            County
          </Label>
          <Input
            id="request-county-county"
            value={county}
            onChange={(e) => setCounty(e.target.value)}
            placeholder="County"
            className="h-11 pointer-fine:sm:h-9"
            autoComplete="off"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="request-county-state" className="text-micro text-muted-foreground">
            State
          </Label>
          <Input
            id="request-county-state"
            value={state}
            onChange={(e) => setState(e.target.value.slice(0, 2))}
            placeholder="ST"
            maxLength={2}
            className="h-11 pointer-fine:sm:h-9 uppercase"
            autoComplete="off"
          />
        </div>
      </div>

      <Button
        type="submit"
        size="sm"
        className="w-full min-h-11 pointer-fine:sm:min-h-9"
        disabled={!canSubmit}
        data-testid="button-request-county"
      >
        {request.isPending ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            Sending request…
          </>
        ) : (
          <>
            <MapPinned className="mr-2 h-4 w-4" aria-hidden="true" />
            Request your county
          </>
        )}
      </Button>
    </form>
  );
}
