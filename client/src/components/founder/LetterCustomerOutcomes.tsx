/**
 * LetterCustomerOutcomes — the Letter's "what customers achieved" section
 * (W5b). Totals across organizations from closed-deal records only, no
 * organization named. Profit sums only organizations whose every counted
 * sale has a purchase price; the rest are counted as refused, never as zero.
 */
import { useQuery } from "@tanstack/react-query";
import { Trophy } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryErrorState } from "@/components/query-error-state";
import { usd } from "@/lib/format";
import type { PlatformOutcomeAggregate } from "@shared/outcomes/customerOutcome";

export function LetterCustomerOutcomes() {
  const q = useQuery<PlatformOutcomeAggregate>({ queryKey: ["/api/founder/customer-outcomes"] });
  return (
    <section className="rounded-lg border border-border bg-card p-4 space-y-2" data-testid="letter-customer-outcomes">
      <h2 className="text-sm font-semibold flex items-center gap-2">
        <Trophy className="w-4 h-4 text-primary" aria-hidden="true" />
        What customers closed
      </h2>
      {q.isLoading ? (
        <Skeleton className="h-10 w-full" />
      ) : q.error ? (
        <QueryErrorState error={q.error as Error} onRetry={() => q.refetch()} compact />
      ) : q.data!.orgsWithAClosedDeal === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="letter-outcomes-none">No customer has a closed deal on record yet.</p>
      ) : (
        <div className="space-y-1 text-sm">
          <p data-testid="letter-outcomes-line">
            {q.data!.dealsClosed} deal{q.data!.dealsClosed === 1 ? "" : "s"} closed across {q.data!.orgsWithAClosedDeal} customer
            {q.data!.orgsWithAClosedDeal === 1 ? "" : "s"}.
            {q.data!.orgsProfitShown > 0
              ? ` Realised profit ${usd(q.data!.realisedProfitCents / 100, { noCents: true })} from ${q.data!.salesCounted} sale${q.data!.salesCounted === 1 ? "" : "s"} (${q.data!.orgsProfitShown} customer${q.data!.orgsProfitShown === 1 ? "" : "s"}).`
              : " No realised profit can be shown yet."}
            {q.data!.orgsProfitRefused > 0 ? ` ${q.data!.orgsProfitRefused} customer${q.data!.orgsProfitRefused === 1 ? " is" : "s are"} missing a purchase price, so not summed.` : ""}
          </p>
          <p className="text-xs text-muted-foreground">{q.data!.label}</p>
        </div>
      )}
    </section>
  );
}
