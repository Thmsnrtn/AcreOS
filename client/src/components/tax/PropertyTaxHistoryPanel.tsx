/**
 * The tax history a Land property carries — V-Tax-1 T4b. On the property
 * detail, for a parcel that came from a tax position; nothing for one that
 * did not.
 *
 *   - While any position is not yet marketable in AcreOS, a taught lock says
 *     what cannot be done (improve, market, plat, feasibility spend) and what
 *     clears it — the same answer the spend and marketing routes refuse with.
 *   - What the positions have cost so far, with its basis: an input to the
 *     parcel's next offer, not forgotten.
 *   - Each position's calendar and bids, oldest first.
 */
import { useQuery } from "@tanstack/react-query";
import { History, Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryErrorState } from "@/components/query-error-state";
import { formatDate } from "@/lib/format";
import type { Clock } from "@shared/tax/clock";

interface TaxHistory {
  positions: Array<{
    certificateId: string;
    apn: string;
    saleType: string;
    saleDate: string;
    status: string;
    clock: Clock;
    events: Array<{ eventType: string; eventDate: string; source: string | null; recordedAt: string }>;
    bids: Array<{ action: string; amountCents: number | null; performedAt: string; overMaxReason: string | null }>;
  }>;
  moneyIn: { purchaseCents: number; subsequentTaxesCents: number; totalCents: number; basis: string };
}

const usd = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const EVENT_LABEL: Record<string, string> = {
  redemption_expiry: "Redemption expiry",
  quiet_title_filed: "Quiet-title petition filed",
  subsequent_tax_paid: "Subsequent tax paid",
  redemption_notice_recorded: "Redemption notice you sent",
  foreclosure_filing_deadline: "Foreclosure-filing deadline",
};

export function PropertyTaxHistoryPanel({ propertyId }: { propertyId: number }) {
  const q = useQuery<{ history: TaxHistory }>({ queryKey: [`/api/properties/${propertyId}/tax-history`] });
  if (q.isLoading) return <Skeleton className="h-16" aria-label="Loading the tax history" />;
  if (q.isError || !q.data?.history) return <QueryErrorState error={q.error} onRetry={() => void q.refetch()} isRetrying={q.isFetching} title="The tax history could not be loaded" />;
  const h = q.data.history;
  if (h.positions.length === 0) return null;
  const held = h.positions.filter((p) => p.clock.phase !== "redeemed" && p.clock.phase !== "cancelled" && !p.clock.marketable.eligible);
  return (
    <section className="space-y-3 rounded-md border p-4" aria-label="Tax history" data-testid={`property-tax-history-${propertyId}`}>
      <h3 className="flex items-center gap-2 text-sm font-semibold"><History className="h-4 w-4" aria-hidden="true" />Tax history</h3>
      {held.length > 0 && (
        <div className="rounded-md border border-destructive/40 p-3" role="note" data-testid="property-tax-lock">
          <p className="flex items-center gap-2 text-sm font-semibold"><Lock className="h-4 w-4 text-destructive" aria-hidden="true" />Not yet: do not improve, market, plat or spend on feasibility</p>
          <ul className="mt-1 list-disc pl-5 text-sm">
            {held.map((p) => <li key={p.certificateId}>APN {p.apn}: {p.clock.marketable.reason}</li>)}
          </ul>
          <p className="mt-1 text-xs text-muted-foreground">What clears it: {[...new Set(held.flatMap((p) => p.clock.lock?.clears ?? ["the quiet-title petition is filed, or an attorney-reviewed exception is recorded"]))].join("; ")}. AcreOS refuses those steps until then.</p>
        </div>
      )}
      <div data-testid="property-tax-money-in">
        <p className="text-xs text-muted-foreground">What the tax position cost so far — an input to your next offer</p>
        <p className="text-sm"><span className="font-medium tabular-nums">{usd(h.moneyIn.totalCents)}</span> <span className="text-xs text-muted-foreground">(purchase {usd(h.moneyIn.purchaseCents)} + subsequent taxes {usd(h.moneyIn.subsequentTaxesCents)}) — {h.moneyIn.basis}</span></p>
      </div>
      {h.positions.map((p) => {
        const saleKind = p.saleType.replace(/_/g, " ");
        const phaseLabel = p.clock.phase.replace(/_/g, " ");
        return (
        <div key={p.certificateId} className="space-y-1 text-sm" data-testid={`property-tax-position-${p.certificateId}`}>
          <p className="font-medium">
            {saleKind} · sale {formatDate(p.saleDate)} · APN {p.apn} <Badge variant="outline">{phaseLabel}</Badge>
          </p>
          <ol className="space-y-0.5 text-xs text-muted-foreground">
            {[
              ...p.bids.map((b) => ({ at: b.performedAt.slice(0, 10), text: `Bid log: ${b.action}${b.amountCents != null ? ` ${usd(b.amountCents)}` : ""}${b.overMaxReason ? ` — over your max: ${b.overMaxReason}` : ""}` })),
              ...p.events.map((e) => ({ at: e.eventDate, text: `${EVENT_LABEL[e.eventType] ?? e.eventType}${e.source ? ` — ${e.source}` : ""}` })),
            ]
              .sort((a, b) => a.at.localeCompare(b.at))
              .map((x, i) => <li key={i}>{formatDate(x.at)} · {x.text}</li>)}
          </ol>
        </div>
        );
      })}
    </section>
  );
}
