/**
 * Basis-schedule card for the acquired-note detail page.
 *
 * Surfaces the IRS Pub 1212 market-discount accretion schedule. Linnea:
 * "When I buy a note at a discount, IRS Pub 1212 says I have to accrete
 * the discount over the remaining life of the note as ordinary income.
 * No serious note investor's tax software ignores this. AcreOS does
 * not appear to compute it."
 *
 * It does now.
 */

import { useQuery } from "@tanstack/react-query";
import { Receipt, AlertCircle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { RequiredDisclaimer } from "@/components/required-disclaimer";

interface BasisRow {
  year: number;
  startingBasisCents: number;
  accretedDiscountCents: number;
  principalReceivedCents: number;
  endingBasisCents: number;
}

interface BasisResponse {
  noteId: string;
  method: "ratable" | "constant_yield";
  totalDiscountCents: number;
  isPremium: boolean;
  schedule: BasisRow[];
}

function fmtUsd(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Math.round(cents / 100));
}

export function NoteBasisSchedule({ noteId }: { noteId: string }) {
  const { data, isLoading, isError } = useQuery<BasisResponse>({
    queryKey: ["/api/notes", noteId, "basis"],
    queryFn: async () => {
      const res = await fetch(`/api/notes/${noteId}/basis`, { credentials: "include" });
      if (!res.ok) throw new Error(`Basis schedule failed (${res.status})`);
      return res.json();
    },
  });

  return (
    <Card className="mb-6">
      <div className="p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Receipt className="w-4 h-4 text-primary" aria-hidden="true" />
            <h2 className="text-sm font-semibold">Basis schedule</h2>
          </div>
          {data?.method && (
            <span className="text-xs text-muted-foreground">
              Method: {data.method === "ratable" ? "Ratable accrual" : "Constant yield"}
            </span>
          )}
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-8" />)}
          </div>
        ) : isError ? (
          <p className="text-sm text-muted-foreground flex items-center gap-2">
            <AlertCircle className="w-4 h-4" aria-hidden="true" /> Couldn't compute basis schedule.
          </p>
        ) : data && data.isPremium ? (
          <div className="text-sm text-muted-foreground">
            <p>
              You bought this note <span className="font-semibold">above face</span> ({fmtUsd(Math.abs(data.totalDiscountCents))} premium).
              Bond-premium amortization under §171 requires an election; we don't auto-amortize
              premiums. Your basis stays at acquisition price unless you elect to amortize on
              your tax return.
            </p>
          </div>
        ) : data && data.schedule.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            You bought this note at face value (no discount). No accretion required.
          </p>
        ) : data ? (
          <>
            <div className="overflow-x-auto -mx-2">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-muted-foreground">
                    <th className="px-2 py-2 text-left font-medium">Year</th>
                    <th className="px-2 py-2 text-right font-medium">Starting basis</th>
                    <th className="px-2 py-2 text-right font-medium">Accreted discount</th>
                    <th className="px-2 py-2 text-right font-medium">Principal received</th>
                    <th className="px-2 py-2 text-right font-medium">Ending basis</th>
                  </tr>
                </thead>
                <tbody>
                  {data.schedule.map((r) => (
                    <tr key={r.year} className="border-t border-border/40">
                      <td className="px-2 py-2 font-medium">{r.year}</td>
                      <td className="px-2 py-2 text-right font-mono">{fmtUsd(r.startingBasisCents)}</td>
                      <td className="px-2 py-2 text-right font-mono text-acr-pos">
                        +{fmtUsd(r.accretedDiscountCents)}
                      </td>
                      <td className="px-2 py-2 text-right font-mono text-muted-foreground">
                        −{fmtUsd(r.principalReceivedCents)}
                      </td>
                      <td className="px-2 py-2 text-right font-mono font-semibold">
                        {fmtUsd(r.endingBasisCents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground mt-3">
              Total market discount at acquisition: <span className="font-semibold">{fmtUsd(data.totalDiscountCents)}</span>.
              Accreted as ordinary income each year via the ratable method
              (months-in-year ÷ months-remaining-at-acquisition × discount).
              IRS Pub 1212.
            </p>
          </>
        ) : null}

        {/* R1b reshape (home-base-reshape.md rule 2): tax accretion figures are
            an informational worksheet the holder verifies with their CPA — a
            labeled computation, never a tax determination AcreOS renders. */}
        {data && !isError && <RequiredDisclaimer type="worksheet" className="mt-4" />}
      </div>
    </Card>
  );
}
