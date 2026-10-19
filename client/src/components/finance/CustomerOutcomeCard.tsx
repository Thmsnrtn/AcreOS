/**
 * Deals closed and realised profit (W5b, Finance door) — from closed-deal
 * records only, with the label of what is counted. When any counted sale has
 * no purchase price on record, NO profit figure is shown: the card says which
 * record is missing instead (shared/outcomes/customerOutcome.ts).
 */
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryErrorState } from "@/components/query-error-state";
import { Trophy } from "lucide-react";
import { usd } from "@/lib/format";
import { useVocabulary } from "@/hooks/use-persona";
import type { CustomerOutcome } from "@shared/outcomes/customerOutcome";

export function CustomerOutcomeCard() {
  // The persona's words for what is counted and the stage it reached — the
  // same name the Deals board gives that column (dealStageLabel): a note
  // investor reads "Note acquisitions · Acquired", a tax-lien operator "Tax
  // certificates · Awarded", never the land flipper's "Deals closed".
  const term = useVocabulary();
  const dealsLabel = term("entity.deal.plural");
  const closedStage = term("pipeline.stage.closed");
  const q = useQuery<CustomerOutcome>({ queryKey: ["/api/finance/outcome"] });
  if (q.isLoading) {
    return (
      <Card className="mb-6" data-testid="card-customer-outcome-loading">
        <CardContent className="p-4 grid grid-cols-2 gap-4">
          <Skeleton className="h-14" />
          <Skeleton className="h-14" />
        </CardContent>
      </Card>
    );
  }
  if (q.error) return <QueryErrorState error={q.error as Error} onRetry={() => q.refetch()} compact />;
  const o = q.data!;
  const p = o.realisedProfit;
  return (
    <Card className="mb-6" data-testid="card-customer-outcome">
      <CardHeader className="pb-2">
        <CardTitle className="acr-section-h2 text-section-h2 flex items-center gap-2">
          <Trophy className="w-5 h-5 text-primary" aria-hidden="true" />
          Your results
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-muted-foreground">{dealsLabel} · {closedStage}</p>
            <p className="text-2xl font-semibold tabular-nums" data-testid="outcome-deals-closed">{o.dealsClosed.total}</p>
            <p className="text-xs text-muted-foreground">
              {o.dealsClosed.acquisitions} bought · {o.dealsClosed.dispositions} sold
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Realised profit</p>
            {p.status === "shown" ? (
              <>
                <p className="text-2xl font-semibold tabular-nums" data-testid="outcome-profit">{usd(p.cents / 100, { noCents: true })}</p>
                <p className="text-xs text-muted-foreground">from {p.salesCounted} completed sale{p.salesCounted === 1 ? "" : "s"}</p>
              </>
            ) : (
              <p className="text-sm" data-testid="outcome-profit-refused">{p.reason}</p>
            )}
          </div>
        </div>
        {(o.excluded.ownerFinancedSales > 0 || o.excluded.salesMissingSalePrice > 0) && (
          <p className="text-xs text-muted-foreground" data-testid="outcome-excluded">
            Left out:{" "}
            {[
              o.excluded.ownerFinancedSales > 0 ? `${o.excluded.ownerFinancedSales} owner-financed sale${o.excluded.ownerFinancedSales === 1 ? "" : "s"}` : null,
              o.excluded.salesMissingSalePrice > 0 ? `${o.excluded.salesMissingSalePrice} sale${o.excluded.salesMissingSalePrice === 1 ? "" : "s"} with no sale price recorded` : null,
            ].filter(Boolean).join(" · ")}
            .
          </p>
        )}
        <p className="text-xs text-muted-foreground" data-testid="outcome-label">
          {o.included} Closing costs were recorded on {o.closingCostsRecordedOn} of the {dealsLabel.toLowerCase()} counted.
        </p>
      </CardContent>
    </Card>
  );
}
