/**
 * The redemption clock for one certificate — V-Tax-1 T2b. One job: the clock
 * first (countdown, the rule the deadline rests on, the next action), then
 * the lock and what clears it, the capital tied up, marketability in AcreOS,
 * and the cross-check against the county's procedure object.
 *
 * A locked deed is a taught state — what cannot be done yet and what clears
 * the lock — never a confident blank. AcreOS never declares a deadline law or
 * a title marketable; it states what the date rests on.
 */
import { useQuery } from "@tanstack/react-query";
import { CalendarClock, Lock, ShieldAlert, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryErrorState } from "@/components/query-error-state";
import { formatDate } from "@/lib/format";
import type { Clock } from "@shared/tax/clock";
import { CertificateLedgerPanel } from "./CertificateLedgerPanel";
import { MoveToLandControl } from "./MoveToLandControl";

const usd = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const PHASE_LABEL: Record<Clock["phase"], string> = {
  redeemable: "redeemable",
  redemption_expired: "redemption expired",
  redeemed: "redeemed",
  deed_held: "deed held",
  cancelled: "cancelled",
};

export function CertificateClockPanel({ certificateId, label, onClose }: { certificateId: string; label: string; onClose: () => void }) {
  const q = useQuery<Clock>({ queryKey: [`/api/tax-certificates/${certificateId}/clock`] });
  return (
    <Card className="mb-4 p-5" data-testid={`certificate-clock-${certificateId}`}>
      <div className="mb-3 flex items-start justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <CalendarClock className="h-4 w-4" aria-hidden="true" />
          Redemption clock — {label}
        </h2>
        <Button size="icon" variant="ghost" aria-label="Close the redemption clock" onClick={onClose}><X className="h-4 w-4" aria-hidden="true" /></Button>
      </div>
      {q.isLoading ? (
        <Skeleton className="h-32" aria-label="Loading the redemption clock" />
      ) : q.isError || !q.data ? (
        <QueryErrorState error={q.error} onRetry={() => void q.refetch()} isRetrying={q.isFetching} title="The redemption clock could not be loaded" />
      ) : (
        <>
          <ClockBody c={q.data} />
          {q.data.phase === "deed_held" && <div className="mt-4"><MoveToLandControl certificateId={certificateId} /></div>}
        </>
      )}
      <div className="mt-4 border-t pt-4">
        <CertificateLedgerPanel certificateId={certificateId} />
      </div>
    </Card>
  );
}

function ClockBody({ c }: { c: Clock }) {
  return (
    <div className="space-y-4">
      <section aria-label="Countdown">
        <p className="text-2xl font-semibold tabular-nums" data-testid="clock-countdown">
          {c.phase === "redeemable" ? `${c.daysToDeadline} day${c.daysToDeadline === 1 ? "" : "s"} to redemption expiry` : PHASE_LABEL[c.phase]}
        </p>
        <p className="text-sm">Expiry {formatDate(c.deadline)} <Badge variant="outline" className="ml-1">{PHASE_LABEL[c.phase]}</Badge></p>
        <p className="mt-1 text-xs text-muted-foreground" data-testid="clock-rule-cited">Rests on: {c.deadlineBasis}</p>
        <p className="mt-2 text-sm font-medium" data-testid="clock-next-action">Next: {c.nextAction}</p>
        <ul className="mt-2 flex flex-wrap gap-2 text-xs" aria-label="Alerts">
          {c.alerts.map((a) => (
            <li key={a.daysBefore}><Badge variant={a.reached ? "secondary" : "outline"}>{a.daysBefore}-day alert {formatDate(a.date)}{a.reached ? " · reached" : ""}</Badge></li>
          ))}
        </ul>
      </section>

      {c.lock && (
        <section className="rounded-md border border-destructive/40 p-3" aria-label="Lock" data-testid="clock-lock">
          <p className="flex items-center gap-2 text-sm font-semibold"><Lock className="h-4 w-4 text-destructive" aria-hidden="true" />Locked: {c.lock.what}</p>
          <p className="mt-1 text-xs text-muted-foreground">Until {c.lock.until}. What clears it:</p>
          <ul className="mt-1 list-disc pl-5 text-sm">{c.lock.clears.map((x) => <li key={x}>{x}</li>)}</ul>
        </section>
      )}

      <section className="grid gap-2 sm:grid-cols-2" aria-label="Position">
        <div>
          <p className="text-xs text-muted-foreground">Capital tied up (redemption-risk reserve)</p>
          <p className="text-sm font-medium tabular-nums" data-testid="clock-capital">{usd(c.capitalTiedUpCents)}</p>
          <p className="text-xs text-muted-foreground">Anything spent on the parcel before expiry is not returned on redemption.</p>
        </div>
        <div data-testid="clock-marketable">
          <p className="text-xs text-muted-foreground">Eligible to market in AcreOS</p>
          <p className="text-sm font-medium">{c.marketable.eligible ? "yes" : "no"}</p>
          <p className="text-xs text-muted-foreground">{c.marketable.reason}</p>
        </div>
      </section>

      {c.procedureCheck && !c.procedureCheck.agrees && (
        <p className="flex items-start gap-2 rounded-md border p-2 text-sm" role="note" data-testid="clock-procedure-mismatch">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          The county procedure (version {c.procedureCheck.version}, {c.procedureCheck.source}, as of {c.procedureCheck.asOf}) states a {c.procedureCheck.statedMonths}-month redemption period — {formatDate(c.procedureCheck.impliedDeadlineFromSale)} if counted from the sale date — which does not match the deadline on record. Both are shown; confirm with the county.
        </p>
      )}
    </div>
  );
}
