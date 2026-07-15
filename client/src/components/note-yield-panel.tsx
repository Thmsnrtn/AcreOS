/**
 * Per-note yield panel — the four metrics Linnea called "table stakes":
 *
 *   - Current yield = annual coupon / current basis
 *   - YTM at acquisition = IRR of original cash flows from the price paid
 *   - IRR to date = IRR of actual ledger payments + terminal balance
 *   - Effective net yield = IRR-to-date net of servicing assumption
 *
 * Math runs server-side at GET /api/notes/:id/yield. This component is
 * pure render + cache.
 */

import { useQuery } from "@tanstack/react-query";
import { TrendingUp, AlertCircle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { RequiredDisclaimer } from "@/components/required-disclaimer";

interface YieldResponse {
  noteId: string;
  currentYield: number;              // decimal, e.g. 0.085 = 8.5%
  ytmAtAcquisition: number | null;
  irrToDate: number | null;
  effectiveNetYield: number | null;
  effectiveNetServicingAssumption: {
    annualBps: number;
    note: string;
  } | null;
}

function fmtPct(decimal: number | null): string {
  if (decimal === null || !isFinite(decimal)) return "—";
  return `${(decimal * 100).toFixed(2)}%`;
}

export function NoteYieldPanel({ noteId }: { noteId: string }) {
  const { data, isLoading, isError } = useQuery<YieldResponse>({
    queryKey: ["/api/notes", noteId, "yield"],
    queryFn: async () => {
      const res = await fetch(`/api/notes/${noteId}/yield`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Yield calc failed (${res.status})`);
      return res.json();
    },
  });

  return (
    <Card className="mb-6">
      <div className="p-5">
        <div className="flex items-center gap-2 mb-4">
          <TrendingUp className="w-4 h-4 text-primary" aria-hidden="true" />
          <h2 className="text-sm font-semibold">Yield</h2>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-16" />
            ))}
          </div>
        ) : isError ? (
          <p className="text-sm text-muted-foreground flex items-center gap-2">
            <AlertCircle className="w-4 h-4" aria-hidden="true" />
            Couldn't compute yield. Likely missing payment history.
          </p>
        ) : data ? (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <YieldCell
                label="Current yield"
                value={fmtPct(data.currentYield)}
                hint="Annual coupon / current basis"
                testid="yield-current"
              />
              <YieldCell
                label="YTM at acquisition"
                value={fmtPct(data.ytmAtAcquisition)}
                hint="IRR of original projected cash flows from your purchase price"
                testid="yield-ytm"
              />
              <YieldCell
                label="IRR to date"
                value={fmtPct(data.irrToDate)}
                hint="IRR of actual payments received + today's payoff"
                testid="yield-irr"
              />
              <YieldCell
                label="Effective net"
                value={fmtPct(data.effectiveNetYield)}
                hint={
                  data.effectiveNetServicingAssumption
                    ? `IRR-to-date − ${data.effectiveNetServicingAssumption.annualBps}bps servicing`
                    : "Net of servicing costs"
                }
                testid="yield-effective"
              />
            </div>
            {data.effectiveNetServicingAssumption && (
              <p className="text-xs text-muted-foreground mt-3">
                Effective net assumes {data.effectiveNetServicingAssumption.annualBps}bps annual servicing —{" "}
                {data.effectiveNetServicingAssumption.note}.
              </p>
            )}
            {/* R1b reshape (home-base-reshape.md rule 2): yield figures are an
                informational worksheet the holder verifies — AcreOS dashboards
                the note, it is not the servicer/adviser of record. */}
            <RequiredDisclaimer type="worksheet" className="mt-4" />
          </>
        ) : null}
      </div>
    </Card>
  );
}

function YieldCell({ label, value, hint, testid }: { label: string; value: string; hint: string; testid?: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold tracking-tight mt-1" data-testid={testid}>
        {value}
      </div>
      <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{hint}</div>
    </div>
  );
}
