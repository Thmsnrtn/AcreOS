/**
 * One sale's calendar and bidder registration — V-Tax-1 T3b. On the auction
 * worksheet, under the selected sale.
 *
 *   - Times are the county's: shown in the county's time zone, which the
 *     operator states with its source. With no zone stated, no time is shown
 *     and no countdown is computed — the date alone, and why.
 *   - Registration is a stage gate, item by item (deposit, funds, entity
 *     documents, W-9, registered). An item whose requirement is not stated is
 *     open, not assumed; bidding on this sale's lots is refused until every
 *     item is done or stated not required.
 *   - Deposits and funds are a notebook: no money moves through AcreOS.
 */
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CalendarClock, CheckCircle2, CircleDashed, ClipboardCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryErrorState } from "@/components/query-error-state";
import { useToast } from "@/hooks/use-toast";
import { ApiError, apiRequest, queryClient } from "@/lib/queryClient";
import { formatDate } from "@/lib/format";
import { Verbs } from "@/lib/labels";
import type { AuctionCalendarRecord, AuctionCalendarView, CalendarMoment, RegistrationItem, RegistrationStanding } from "@shared/tax/auctionCalendar";

interface CalendarResponse {
  calendar: AuctionCalendarView;
  registration: RegistrationStanding;
}

const usd = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const errorMessage = (err: unknown) => (err instanceof ApiError ? (err.body?.message ?? err.message) : err instanceof Error ? err.message : "Something went wrong");

function when(m: CalendarMoment): string {
  if (m.status === "date_only") return `${formatDate(m.date)} — ${m.why}`;
  const h = m.hoursFromNow;
  const rel = h <= 0 ? "passed" : h < 48 ? `in ${Math.round(h)} hours` : `in ${Math.round(h / 24)} days`;
  return `${formatDate(m.local.slice(0, 10))} ${m.local.slice(11)} ${m.zone} (${rel})`;
}

export function AuctionCalendarPanel({ auctionId }: { auctionId: number }) {
  const key = `/api/tax-researcher/auctions/${auctionId}/calendar`;
  const q = useQuery<CalendarResponse>({ queryKey: [key] });
  const [editing, setEditing] = useState(false);
  if (q.isLoading) return <Skeleton className="h-24" aria-label="Loading the sale calendar" />;
  if (q.isError || !q.data) return <QueryErrorState error={q.error} onRetry={() => void q.refetch()} isRetrying={q.isFetching} title="The sale calendar could not be loaded" />;
  const { calendar: c, registration } = q.data;
  return (
    <div className="space-y-3 text-sm" data-testid={`auction-calendar-${auctionId}`}>
      <section aria-label="Sale calendar" className="space-y-1">
        <p className="flex items-center gap-2 font-medium"><CalendarClock className="h-4 w-4" aria-hidden="true" />Sale: <span data-testid="calendar-start">{when(c.start)}</span></p>
        <p className="text-xs text-muted-foreground" data-testid="calendar-zone">
          {c.timeZone ? `County time zone ${c.timeZone.value} — ${c.timeZone.source}, as of ${formatDate(c.timeZone.asOf)}` : "County time zone not stated — AcreOS does not guess it."}
        </p>
        <p data-testid="calendar-registration">
          Registration deadline:{" "}
          {c.registration ? (
            <>
              {when(c.registration)}
              {c.registration.closed ? <Badge variant="destructive" className="ml-1">closed</Badge> : null}
              <span className="text-xs text-muted-foreground"> — {c.registration.source}</span>
            </>
          ) : (
            <span className="text-muted-foreground">not stated</span>
          )}
        </p>
        <p data-testid="calendar-funds">
          Funds:{" "}
          {c.funds ? (
            <>
              {c.funds.depositCents != null ? `deposit ${usd(c.funds.depositCents)}` : "deposit not stated"}
              {c.funds.form ? ` · ${c.funds.form}` : ""}
              <span className="text-xs text-muted-foreground"> — {c.funds.source}. A notebook: these move on your own rails.</span>
            </>
          ) : (
            <span className="text-muted-foreground">not stated</span>
          )}
        </p>
        {editing ? (
          <CalendarEditor auctionId={auctionId} queryKey={key} current={c} onDone={() => setEditing(false)} />
        ) : (
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setEditing(true)} data-testid="button-edit-calendar">
            State the county's times
          </Button>
        )}
      </section>
      <RegistrationChecklist auctionId={auctionId} queryKey={key} standing={registration} />
    </div>
  );
}

function CalendarEditor({ auctionId, queryKey, current, onDone }: { auctionId: number; queryKey: string; current: AuctionCalendarView; onDone: () => void }) {
  const { toast } = useToast();
  const [zone, setZone] = useState(current.timeZone?.value ?? "");
  const [zoneSource, setZoneSource] = useState(current.timeZone?.source ?? "");
  const [zoneAsOf, setZoneAsOf] = useState(current.timeZone?.asOf ?? "");
  const [start, setStart] = useState(current.start.status === "timed" ? current.start.local.slice(11) : "");
  const reg = current.registration;
  const [regDate, setRegDate] = useState(reg ? (reg.status === "timed" ? reg.local.slice(0, 10) : reg.date) : "");
  const [regTime, setRegTime] = useState(reg?.status === "timed" ? reg.local.slice(11) : "");
  const [regSource, setRegSource] = useState(reg?.source ?? "");
  const [deposit, setDeposit] = useState(current.funds?.depositCents != null ? String(current.funds.depositCents / 100) : "");
  const [form, setForm] = useState(current.funds?.form ?? "");
  const [fundsSource, setFundsSource] = useState(current.funds?.source ?? "");

  const save = useMutation({
    mutationFn: async () => {
      const body: AuctionCalendarRecord = {
        timeZone: zone.trim() ? { value: zone.trim(), source: zoneSource.trim(), asOf: zoneAsOf } : null,
        startTimeLocal: start || null,
        registrationDeadline: regDate ? { date: regDate, timeLocal: regTime || null, source: regSource.trim() } : null,
        funds: deposit.trim() || form.trim() ? { depositCents: deposit.trim() ? Math.round(Number(deposit) * 100) : null, form: form.trim() || null, source: fundsSource.trim() } : null,
      };
      return apiRequest("PUT", `/api/tax-researcher/auctions/${auctionId}/calendar`, body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [queryKey] });
      queryClient.invalidateQueries({ queryKey: ["/api/tax-researcher/auctions"] });
      toast({ title: "Sale calendar saved" });
      onDone();
    },
    onError: (err) => toast({ title: "Not saved", description: errorMessage(err), variant: "destructive" }),
  });

  const id = `cal-${auctionId}`;
  return (
    <div className="space-y-2 rounded-md border p-3 text-xs" data-testid="calendar-editor">
      <div className="grid gap-2 sm:grid-cols-3">
        <div className="space-y-1"><Label htmlFor={`${id}-zone`} className="text-xs">County time zone (IANA)</Label><Input id={`${id}-zone`} placeholder="America/Chicago" value={zone} onChange={(e) => setZone(e.target.value)} className="h-8" /></div>
        <div className="space-y-1"><Label htmlFor={`${id}-zone-src`} className="text-xs">Where it came from</Label><Input id={`${id}-zone-src`} value={zoneSource} onChange={(e) => setZoneSource(e.target.value)} className="h-8" /></div>
        <div className="space-y-1"><Label htmlFor={`${id}-zone-asof`} className="text-xs">As of</Label><Input id={`${id}-zone-asof`} type="date" value={zoneAsOf} onChange={(e) => setZoneAsOf(e.target.value)} className="h-8" /></div>
      </div>
      <div className="space-y-1 sm:w-1/3"><Label htmlFor={`${id}-start`} className="text-xs">Sale start, county local time</Label><Input id={`${id}-start`} type="time" value={start} onChange={(e) => setStart(e.target.value)} className="h-8" /></div>
      <div className="grid gap-2 sm:grid-cols-3">
        <div className="space-y-1"><Label htmlFor={`${id}-reg-date`} className="text-xs">Registration deadline</Label><Input id={`${id}-reg-date`} type="date" value={regDate} onChange={(e) => setRegDate(e.target.value)} className="h-8" /></div>
        <div className="space-y-1"><Label htmlFor={`${id}-reg-time`} className="text-xs">Deadline time, local</Label><Input id={`${id}-reg-time`} type="time" value={regTime} onChange={(e) => setRegTime(e.target.value)} className="h-8" /></div>
        <div className="space-y-1"><Label htmlFor={`${id}-reg-src`} className="text-xs">Where it came from</Label><Input id={`${id}-reg-src`} value={regSource} onChange={(e) => setRegSource(e.target.value)} className="h-8" /></div>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <div className="space-y-1"><Label htmlFor={`${id}-deposit`} className="text-xs">Deposit $</Label><Input id={`${id}-deposit`} inputMode="decimal" value={deposit} onChange={(e) => setDeposit(e.target.value)} className="h-8" /></div>
        <div className="space-y-1"><Label htmlFor={`${id}-form`} className="text-xs">Form of funds</Label><Input id={`${id}-form`} placeholder="Certified funds or wire" value={form} onChange={(e) => setForm(e.target.value)} className="h-8" /></div>
        <div className="space-y-1"><Label htmlFor={`${id}-funds-src`} className="text-xs">Where it came from</Label><Input id={`${id}-funds-src`} value={fundsSource} onChange={(e) => setFundsSource(e.target.value)} className="h-8" /></div>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onDone}>{Verbs.CANCEL}</Button>
        <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending ? "Saving…" : Verbs.SAVE}</Button>
      </div>
    </div>
  );
}

function RegistrationChecklist({ auctionId, queryKey, standing }: { auctionId: number; queryKey: string; standing: RegistrationStanding }) {
  const { toast } = useToast();
  const [stating, setStating] = useState<RegistrationItem | null>(null);
  const [status, setStatus] = useState<"required" | "not_required">("required");
  const [source, setSource] = useState("");
  const [asOf, setAsOf] = useState("");
  const [note, setNote] = useState("");

  const put = useMutation({
    mutationFn: async (a: { item: RegistrationItem; body: object }) => apiRequest("PUT", `/api/tax-researcher/auctions/${auctionId}/registration/${a.item}`, a.body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [queryKey] });
      setStating(null);
      setSource("");
      setAsOf("");
      setNote("");
    },
    onError: (err) => toast({ title: "Not saved", description: errorMessage(err), variant: "destructive" }),
  });

  return (
    <section aria-label="Bidder registration" data-testid={`registration-${auctionId}`}>
      <p className="flex items-center gap-2 font-medium">
        <ClipboardCheck className="h-4 w-4" aria-hidden="true" />
        Bidder registration{" "}
        {standing.complete ? <Badge variant="secondary">complete</Badge> : <Badge variant="outline" data-testid="registration-gate">bidding gated until complete</Badge>}
      </p>
      <ul className="mt-1 space-y-1">
        {standing.items.map((i) => (
          <li key={i.key} className="text-sm" data-testid={`registration-item-${i.key}`}>
            <span className="inline-flex items-center gap-1">
              {i.state === "done" || i.state === "not_required" ? <CheckCircle2 className="h-3.5 w-3.5 text-acr-pos" aria-hidden="true" /> : <CircleDashed className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />}
              <span className="font-medium">{i.label}</span>
            </span>{" "}
            <span className="text-xs text-muted-foreground">— {i.why}</span>{" "}
            {i.state !== "done" && i.key !== "bidder_registration" && (
              <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => setStating(i.key)}>State the county's requirement</Button>
            )}
            {i.state === "required_open" && (
              <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => put.mutate({ item: i.key, body: { kind: "done", note: note.trim() || null } })} data-testid={`button-done-${i.key}`}>Mark done</Button>
            )}
            {i.state === "done" && (
              <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => put.mutate({ item: i.key, body: { kind: "undone" } })}>Undo</Button>
            )}
          </li>
        ))}
      </ul>
      {stating && (
        <div className="mt-2 grid gap-2 rounded-md border p-2 text-xs sm:grid-cols-4">
          <div className="space-y-1">
            <Label htmlFor="reg-status" className="text-xs">The county</Label>
            <select id="reg-status" className="h-8 w-full rounded-md border bg-background px-2" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
              <option value="required">requires it</option>
              <option value="not_required">does not require it</option>
            </select>
          </div>
          <div className="space-y-1"><Label htmlFor="reg-source" className="text-xs">Where it came from</Label><Input id="reg-source" value={source} onChange={(e) => setSource(e.target.value)} className="h-8" /></div>
          <div className="space-y-1"><Label htmlFor="reg-asof" className="text-xs">As of</Label><Input id="reg-asof" type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} className="h-8" /></div>
          <div className="flex items-end gap-1">
            <Button size="sm" className="h-8" disabled={!source.trim() || !asOf || put.isPending} onClick={() => put.mutate({ item: stating, body: { kind: "requirement", requirement: { status, source: source.trim(), asOf } } })}>{Verbs.SAVE}</Button>
            <Button variant="ghost" size="sm" className="h-8" onClick={() => setStating(null)}>{Verbs.CANCEL}</Button>
          </div>
        </div>
      )}
      <div className="mt-2 space-y-1 sm:w-1/2">
        <Label htmlFor={`reg-note-${auctionId}`} className="text-xs">Note for the next item you mark done (bidder number, receipt)</Label>
        <Input id={`reg-note-${auctionId}`} value={note} onChange={(e) => setNote(e.target.value)} className="h-8 text-xs" />
      </div>
    </section>
  );
}
