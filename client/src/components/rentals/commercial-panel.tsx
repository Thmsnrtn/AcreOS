/**
 * COMMERCIAL — the commercial-lease workspace (W2-COMMERCIAL, 2026-11-06).
 * Rendered as the "Commercial" tab of `/leases`, for commercial orgs only (see
 * client/src/pages/leases.tsx).
 *
 * WHERE THIS LIVES, AND WHY THERE
 * A TAB on `/leases`, behind the Rentals module — the same host as Units,
 * Expenses and T-12. No route and no nav entry: the customer nav is exactly five
 * doors and "no new top-level nav entries EVER" is a standing founder hard-stop.
 *
 * WHAT IT IS FOR
 * The commercial engines (Wave 4) shipped with routes and no screen, so none of
 * them was reachable. This is the minimal surface over them, one lease at a time:
 *   - the lease's commercial terms — PATCH /api/leases/:id/commercial-terms, the
 *     only writer of the inputs every figure below needs;
 *   - $/sqft/yr — GET /api/leases/:id/per-sqft;
 *   - rent escalation steps — GET/POST /api/leases/:id/rent-schedule;
 *   - CAM pools for the lease's property and this lease's reconciliation —
 *     GET/POST /api/properties/:id/cam-pools, POST /api/cam-pools/:id/
 *     reconciliations/generate, GET /api/cam-pools/:id/reconciliations.
 *
 * REFUSE, DON'T FABRICATE — every figure is computed by the server's engine from
 * what the operator recorded, and a refusal is shown as the answer, verbatim. A
 * blank input is sent as "not recorded" (null), never as 0.
 *
 * MONEY POSTURE (founder ruling "be the rail, not the provider") — nothing here
 * moves, holds or collects a cent. A CAM statement is a document the landlord
 * sends on their own; AcreOS posts no charge from it.
 */

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Building2, FileText } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/empty-state";
import { QueryErrorState } from "@/components/query-error-state";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { usd } from "@/lib/format";
import {
  PROPERTY_EXPENSE_CATEGORIES,
  PROPERTY_EXPENSE_CATEGORY_LABELS,
  isOperatingCategory,
} from "@shared/rental/propertyExpense";
import { effectiveBaseRentForMonth, type RentScheduleStepInput } from "@shared/rental/rentEscalation";

type LeaseType = "gross" | "nnn" | "modified_gross";

interface CommercialLease {
  id: string;
  propertyId: number;
  unitLabel: string | null;
  status: string;
  monthlyRentCents: number;
  rentableSqft: number | null;
  leaseType: LeaseType | null;
  camProRataBps: number | null;
  camEstimateMonthlyCents: number | null;
  camBaseYearStopCents: number | null;
}

interface PerSqft {
  baseRentPerSqftAnnualCents: number | null;
  occupancyCostPerSqftAnnualCents: number | null;
  monthlyRentCentsUsed: number | null;
  asOfMonth: string;
  unavailable: boolean;
}

interface ScheduleStepRow {
  id: string;
  effectiveMonth: string;
  stepType: RentScheduleStepInput["stepType"];
  amountCents: number | null;
  pctBps: number | null;
  cpiIndexBase: string | null;
  cpiIndexCurrent: string | null;
  floorPctBps: number | null;
  ceilingPctBps: number | null;
}

interface CamPool {
  id: string;
  poolKind: string;
  periodStart: string;
  periodEnd: string;
  recoverableCategories: string[];
  totalRentableSqft: number | null;
  adminFeeBps: number | null;
  grossUpPct: string | null;
}

interface CamReconciliation {
  leaseId: string;
  statementMarkdown: string | null;
  generatedAt: string | null;
  generatedBy: string | null;
}

const LEASE_TYPES: Array<[LeaseType, string]> = [["nnn", "NNN (triple net)"], ["modified_gross", "Modified gross"], ["gross", "Gross"]];
const POOL_KINDS: Array<[string, string]> = [["cam", "CAM"], ["property_tax", "Property tax"], ["insurance", "Insurance"], ["all_in", "All-in"]];
const STEP_TYPES: Array<[RentScheduleStepInput["stepType"], string]> = [["fixed_pct", "Fixed %"], ["fixed_amount", "New monthly rent"], ["cpi", "CPI"]];
const OPERATING = PROPERTY_EXPENSE_CATEGORIES.filter(isOperatingCategory);

/** "" → null (not recorded), else the number scaled by `k` and rounded. */
function parse(v: string, k = 1): number | null {
  return v.trim() === "" ? null : Math.round(Number(v) * k);
}
/** A stored integer shown in its input's unit (÷ k); null → "". */
function show(n: number | null | undefined, k = 1): string {
  return n == null ? "" : String(n / k);
}
const $ = (cents: number | null | undefined) => (cents == null ? "—" : usd(cents / 100));
/** The server's refusal, verbatim — without apiRequest's "400: " status prefix. */
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^\d{3}:\s*/, "");

/** A labelled input — every input on this tab has its own label. */
function Field(p: { id: string; label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <div>
      <Label htmlFor={p.id} className="text-xs">{p.label}</Label>
      <Input id={p.id} type={p.type ?? "number"} value={p.value} onChange={(e) => p.onChange(e.target.value)} className="h-9 mt-1" />
    </div>
  );
}

function Pick<T extends string>(p: { id: string; label: string; value: T | ""; options: Array<[T, string]>; onChange: (v: T) => void }) {
  return (
    <div>
      <Label htmlFor={p.id} className="text-xs">{p.label}</Label>
      <Select value={p.value} onValueChange={(v) => p.onChange(v as T)}>
        <SelectTrigger id={p.id} className="h-9 mt-1"><SelectValue placeholder="Not recorded" /></SelectTrigger>
        <SelectContent>
          {p.options.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

function Loading() {
  return <div className="space-y-2"><Skeleton className="h-9" /><Skeleton className="h-9" /></div>;
}

export function CommercialPanel() {
  const leases = useQuery<{ leases: CommercialLease[] }>({ queryKey: ["/api/leases"] });
  const [leaseId, setLeaseId] = useState("");
  const lease = leases.data?.leases.find((l) => l.id === leaseId) ?? null;

  if (leases.isLoading) return <Loading />;
  if (leases.isError) {
    return (
      <QueryErrorState
        error={leases.error instanceof Error ? leases.error : null}
        onRetry={() => leases.refetch()}
        isRetrying={leases.isRefetching}
        compact
        title="Couldn't load your leases"
        testId="commercial-leases-error"
      />
    );
  }
  const all = leases.data?.leases ?? [];
  if (all.length === 0) {
    return (
      <EmptyState
        icon={FileText}
        headline="No leases yet"
        subtitle="Commercial terms, rent steps, $/sqft and CAM reconciliation all hang off a lease. Create one on the Leases tab first."
        framed
        // TODO(cta): the Leases tab is one click away on this same page.
        cta={{ label: "", _noOp: true }}
        testId="commercial-no-leases"
      />
    );
  }

  return (
    <div className="space-y-4" data-testid="commercial-panel">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Building2 className="w-4 h-4 text-primary" aria-hidden="true" /> Commercial lease
          </CardTitle>
          <CardDescription>
            Record the lease's commercial terms, its rent steps and its CAM pools. Every figure here is
            computed from what you recorded; where an input is missing AcreOS says so instead of guessing.
            Nothing here bills or collects — you send statements and charges on your own.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Pick
            id="commercial-lease"
            label="Lease"
            value={leaseId}
            options={all.map((l) => [l.id, `Property #${l.propertyId}${l.unitLabel ? ` · ${l.unitLabel}` : ""} · ${l.status.replace(/_/g, " ")}`])}
            onChange={setLeaseId}
          />
        </CardContent>
      </Card>

      {lease ? (
        <>
          <TermsCard key={`t${lease.id}`} lease={lease} />
          <PerSqftCard leaseId={lease.id} />
          <ScheduleCard key={`s${lease.id}`} lease={lease} />
          <CamCard key={`c${lease.id}`} lease={lease} />
        </>
      ) : (
        <EmptyState
          icon={Building2}
          headline="Pick a lease"
          subtitle="Choose the lease to work on: its terms, $/sqft, rent steps and CAM."
          framed
          cta={{ label: "", _noOp: true }}
          testId="commercial-no-lease"
        />
      )}
    </div>
  );
}

function TermsCard({ lease }: { lease: CommercialLease }) {
  const [sqft, setSqft] = useState(show(lease.rentableSqft));
  const [type, setType] = useState<LeaseType | "">(lease.leaseType ?? "");
  const [share, setShare] = useState(show(lease.camProRataBps, 100));
  const [estimate, setEstimate] = useState(show(lease.camEstimateMonthlyCents, 100));
  const [stop, setStop] = useState(show(lease.camBaseYearStopCents, 100));
  const save = useMutation({
    mutationFn: () =>
      apiRequest("PATCH", `/api/leases/${lease.id}/commercial-terms`, {
        rentableSqft: parse(sqft),
        leaseType: type || null,
        camProRataBps: parse(share, 100),
        camEstimateMonthlyCents: parse(estimate, 100),
        camBaseYearStopCents: parse(stop, 100),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leases"] });
      queryClient.invalidateQueries({ queryKey: [`/api/leases/${lease.id}/per-sqft`] });
    },
  });
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Commercial terms</CardTitle>
        <CardDescription>
          From the lease document. Leave a field blank when the lease does not set it — blank is saved as
          not recorded, never as zero.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Field id="ct-sqft" label="Rentable sqft" value={sqft} onChange={setSqft} />
        <Pick id="ct-type" label="Lease type" value={type} options={LEASE_TYPES} onChange={setType} />
        <Field id="ct-share" label="Fixed CAM share (%)" value={share} onChange={setShare} />
        <Field id="ct-estimate" label="CAM estimate ($/month)" value={estimate} onChange={setEstimate} />
        <Field id="ct-stop" label="Base-year stop ($/year)" value={stop} onChange={setStop} />
        <div className="col-span-full flex items-center gap-3">
          <Button size="sm" disabled={save.isPending} onClick={() => save.mutate()} data-testid="commercial-terms-save">
            Save terms
          </Button>
          {save.isSuccess && <span className="text-xs text-muted-foreground">Saved.</span>}
        </div>
      </CardContent>
    </Card>
  );
}

function PerSqftCard({ leaseId }: { leaseId: string }) {
  const q = useQuery<{ perSqft: PerSqft }>({ queryKey: [`/api/leases/${leaseId}/per-sqft`] });
  const m = q.data?.perSqft;
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">$/sqft/year</CardTitle>
      </CardHeader>
      <CardContent className="text-sm" data-testid="commercial-per-sqft">
        {q.isLoading ? <Loading /> : q.isError ? (
          <QueryErrorState error={q.error instanceof Error ? q.error : null} onRetry={() => q.refetch()} compact title="Couldn't load $/sqft" />
        ) : !m ? null : m.unavailable ? (
          <p className="text-muted-foreground">Record the lease's rentable sqft to quote rent per square foot.</p>
        ) : (
          <div className="space-y-1">
            <p>Base rent <strong className="tabular-nums">{$(m.baseRentPerSqftAnnualCents)}</strong> /sqft/yr — on {$(m.monthlyRentCentsUsed)}/month, the rent in effect for {m.asOfMonth}.</p>
            <p>
              Occupancy cost{" "}
              {m.occupancyCostPerSqftAnnualCents == null
                ? <span className="text-muted-foreground">— not stated: record the monthly CAM estimate (or mark the lease gross).</span>
                : <><strong className="tabular-nums">{$(m.occupancyCostPerSqftAnnualCents)}</strong> /sqft/yr</>}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ScheduleCard({ lease }: { lease: CommercialLease }) {
  const key = `/api/leases/${lease.id}/rent-schedule`;
  const q = useQuery<{ steps: ScheduleStepRow[] }>({ queryKey: [key] });
  const [month, setMonth] = useState("");
  const [type, setType] = useState<RentScheduleStepInput["stepType"]>("fixed_pct");
  const [v, setV] = useState({ amount: "", pct: "", base: "", current: "", floor: "", ceiling: "" });
  const set = (k: keyof typeof v) => (x: string) => setV((s) => ({ ...s, [k]: x }));
  const add = useMutation({
    mutationFn: () =>
      apiRequest("POST", key, {
        effectiveMonth: `${month}-01`,
        stepType: type,
        amountCents: parse(v.amount, 100),
        pctBps: parse(v.pct, 100),
        cpiIndexBase: v.base.trim() === "" ? null : Number(v.base),
        cpiIndexCurrent: v.current.trim() === "" ? null : Number(v.current),
        floorPctBps: parse(v.floor, 100),
        ceilingPctBps: parse(v.ceiling, 100),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [key] });
      queryClient.invalidateQueries({ queryKey: [`/api/leases/${lease.id}/per-sqft`] });
    },
  });
  // The rent each step produces, by the same engine the rent-charge generator bills with.
  const steps: RentScheduleStepInput[] = (q.data?.steps ?? []).map((s) => ({
    ...s,
    effectiveMonth: String(s.effectiveMonth).slice(0, 10),
    cpiIndexBase: s.cpiIndexBase == null ? null : Number(s.cpiIndexBase),
    cpiIndexCurrent: s.cpiIndexCurrent == null ? null : Number(s.cpiIndexCurrent),
  }));
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Rent steps (escalations)</CardTitle>
        <CardDescription>
          Starting rent {$(lease.monthlyRentCents)}/month. Each step changes the rent from its month on;
          entering a month that already has a step replaces it.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {q.isLoading ? <Loading /> : q.isError ? (
          <QueryErrorState error={q.error instanceof Error ? q.error : null} onRetry={() => q.refetch()} compact title="Couldn't load the rent steps" />
        ) : steps.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="commercial-no-steps">No steps — this lease bills its flat monthly rent.</p>
        ) : (
          <ul className="text-sm divide-y divide-border/40" data-testid="commercial-steps">
            {steps.map((s) => (
              <li key={s.effectiveMonth} className="py-1.5 flex justify-between gap-3">
                <span>
                  {s.effectiveMonth.slice(0, 7)} · {s.stepType === "fixed_amount" ? `set to ${$(s.amountCents)}` : s.stepType === "fixed_pct" ? `+${(s.pctBps ?? 0) / 100}%` : `CPI ${s.cpiIndexBase} → ${s.cpiIndexCurrent}`}
                </span>
                <span className="tabular-nums">{$(effectiveBaseRentForMonth(lease.monthlyRentCents, steps, s.effectiveMonth))}/month</span>
              </li>
            ))}
          </ul>
        )}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 items-end">
          <Field id="rs-month" label="From month" type="month" value={month} onChange={setMonth} />
          <Pick id="rs-type" label="Step" value={type} options={STEP_TYPES} onChange={setType} />
          {type === "fixed_amount" && <Field id="rs-amount" label="New rent ($/month)" value={v.amount} onChange={set("amount")} />}
          {type === "fixed_pct" && <Field id="rs-pct" label="Increase (%)" value={v.pct} onChange={set("pct")} />}
          {type === "cpi" && (
            <>
              <Field id="rs-base" label="CPI at prior anchor" value={v.base} onChange={set("base")} />
              <Field id="rs-current" label="CPI now" value={v.current} onChange={set("current")} />
              <Field id="rs-floor" label="Floor (%)" value={v.floor} onChange={set("floor")} />
              <Field id="rs-ceiling" label="Ceiling (%)" value={v.ceiling} onChange={set("ceiling")} />
            </>
          )}
          <Button size="sm" disabled={!month || add.isPending} onClick={() => add.mutate()} data-testid="commercial-step-add">
            Add step
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function CamCard({ lease }: { lease: CommercialLease }) {
  const key = `/api/properties/${lease.propertyId}/cam-pools`;
  const q = useQuery<{ pools: CamPool[] }>({ queryKey: [key] });
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState("cam");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [cats, setCats] = useState<string[]>([]);
  const [sqft, setSqft] = useState("");
  const [fee, setFee] = useState("");
  const [grossUp, setGrossUp] = useState("");
  const create = useMutation({
    mutationFn: () =>
      apiRequest("POST", key, {
        poolKind: kind,
        periodStart: from,
        periodEnd: to,
        recoverableCategories: cats,
        totalRentableSqft: parse(sqft),
        adminFeeBps: parse(fee, 100),
        grossUpPct: grossUp.trim() === "" ? null : Number(grossUp),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [key] });
      setOpen(false);
    },
  });
  const pools = q.data?.pools ?? [];
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">CAM reconciliation</CardTitle>
        <CardDescription>
          A pool names which recorded expenses (Expenses tab) are recoverable for this property over a
          period. Reconciling computes this lease's share of them and what is owed against what was
          billed. The statement is yours to send; AcreOS posts no charge.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {q.isLoading ? <Loading /> : q.isError ? (
          <QueryErrorState error={q.error instanceof Error ? q.error : null} onRetry={() => q.refetch()} compact title="Couldn't load the CAM pools" />
        ) : pools.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="commercial-no-pools">No CAM pools for property #{lease.propertyId} yet.</p>
        ) : (
          pools.map((p) => <PoolRow key={p.id} pool={p} leaseId={lease.id} />)
        )}
        {open ? (
          <div className="rounded-md border border-border p-3 space-y-3" data-testid="commercial-pool-form">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <Pick id="cp-kind" label="Pool" value={kind} options={POOL_KINDS} onChange={setKind} />
              <Field id="cp-from" label="Period start" type="date" value={from} onChange={setFrom} />
              <Field id="cp-to" label="Period end" type="date" value={to} onChange={setTo} />
              <Field id="cp-sqft" label="Building rentable sqft" value={sqft} onChange={setSqft} />
              <Field id="cp-fee" label="Admin fee (%)" value={fee} onChange={setFee} />
              <Field id="cp-grossup" label="Gross-up (%)" value={grossUp} onChange={setGrossUp} />
            </div>
            <fieldset>
              <legend className="text-xs mb-1">Recoverable categories (the lease decides which — none are preselected)</legend>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-1">
                {OPERATING.map((c) => (
                  <label key={c} className="text-xs flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={cats.includes(c)}
                      onChange={(e) => setCats((s) => (e.target.checked ? [...s, c] : s.filter((x) => x !== c)))}
                    />
                    {PROPERTY_EXPENSE_CATEGORY_LABELS[c]}
                  </label>
                ))}
              </div>
            </fieldset>
            <p className="text-xs text-muted-foreground">A pool's definition cannot be edited after it is saved — check it first.</p>
            <Button size="sm" disabled={!from || !to || cats.length === 0 || create.isPending} onClick={() => create.mutate()} data-testid="commercial-pool-save">
              Save pool
            </Button>
          </div>
        ) : (
          <Button size="sm" variant="outline" onClick={() => setOpen(true)} data-testid="commercial-pool-new">New pool</Button>
        )}
      </CardContent>
    </Card>
  );
}

function PoolRow({ pool, leaseId }: { pool: CamPool; leaseId: string }) {
  const key = `/api/cam-pools/${pool.id}/reconciliations`;
  const q = useQuery<{ reconciliations: CamReconciliation[] }>({ queryKey: [key] });
  const [billed, setBilled] = useState("");
  const run = useMutation({
    mutationFn: () => apiRequest("POST", `${key}/generate`, { leaseId, estimatedBilledCents: parse(billed, 100) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [key] }),
  });
  const mine = q.data?.reconciliations.find((r) => r.leaseId === leaseId);
  const kindLabel = POOL_KINDS.find(([k]) => k === pool.poolKind)?.[1] ?? pool.poolKind;
  return (
    <div className="rounded-md border border-border p-3 space-y-2 text-sm" data-testid={`commercial-pool-${pool.id}`}>
      <p className="font-medium">{kindLabel} · {pool.periodStart} to {pool.periodEnd}</p>
      <p className="text-xs text-muted-foreground">
        Recovers: {pool.recoverableCategories.map((c) => PROPERTY_EXPENSE_CATEGORY_LABELS[c as keyof typeof PROPERTY_EXPENSE_CATEGORY_LABELS] ?? c).join(", ")}
        {pool.totalRentableSqft != null && ` · building ${pool.totalRentableSqft.toLocaleString("en-US")} sqft`}
        {pool.adminFeeBps != null && ` · admin fee ${pool.adminFeeBps / 100}%`}
        {pool.grossUpPct != null && ` · gross-up ${Number(pool.grossUpPct)}%`}
      </p>
      {q.isLoading ? <Skeleton className="h-9" /> : q.isError ? (
        <QueryErrorState error={q.error instanceof Error ? q.error : null} onRetry={() => q.refetch()} compact title="Couldn't load this pool's reconciliations" />
      ) : mine ? (
        <div>
          <p className="text-xs text-muted-foreground">
            {mine.generatedBy === "engine" ? "Computed by AcreOS" : "Entered by hand (not computed by AcreOS)"}
            {mine.generatedAt ? ` on ${mine.generatedAt.slice(0, 10)}` : ""} — frozen as generated.
          </p>
          {mine.statementMarkdown && (
            <pre className="whitespace-pre-wrap text-xs bg-muted/40 rounded p-2 mt-1" data-testid="commercial-cam-statement">{mine.statementMarkdown}</pre>
          )}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Not reconciled for this lease yet.</p>
      )}
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 items-end">
        <Field id={`cp-billed-${pool.id}`} label="CAM estimates you billed this tenant for the period ($) — blank if they are on the ledger" value={billed} onChange={setBilled} />
        <Button size="sm" disabled={run.isPending} onClick={() => run.mutate()} data-testid={`commercial-reconcile-${pool.id}`}>
          {mine ? "Reconcile again" : "Reconcile this lease"}
        </Button>
      </div>
      {run.isError && <p className="text-xs text-destructive" role="alert" data-testid="commercial-reconcile-refusal">{msg(run.error)}</p>}
    </div>
  );
}
