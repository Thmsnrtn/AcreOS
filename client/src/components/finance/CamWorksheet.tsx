/**
 * CAM RECONCILIATION WORKSHEET — the operator's review step before a CAM
 * true-up statement is frozen.
 *
 * Lives BEHIND the Finance door as a tab (money.tsx). It is not a new door, not
 * a new nav entry, and not a new destination — the five customer doors are
 * fixed and this is content behind one of them, shown only to orgs whose
 * business type is `commercial` (persona changes the CONTENT behind a door,
 * never the doors themselves).
 *
 * Three honesty rules this surface exists to keep visible:
 *
 *   1. IT SHOWS WHICH INPUTS ARE MISSING. A lease the engine refuses does not
 *      render a dash and a shrug — it renders the named inputs (label + what to
 *      do about each) that would let the reconciliation be computed. Refusing
 *      without saying what you need is only half of refusing honestly.
 *   2. A FROZEN STATEMENT IS SHOWN AS FROZEN. Once generated, the figures are
 *      what the tenant was billed. If today's inputs would produce different
 *      figures, the DRIFT is shown beside the frozen ones — labelled as what
 *      would change, never substituted for what was issued. Re-generating is
 *      not offered, because it is refused server-side.
 *   3. NO MONEY MOVES HERE. This produces a statement. The resulting charge is
 *      recorded on the rent ledger, on the operator's own rails, elsewhere.
 */
import { useState } from "react";
import { motion } from "framer-motion";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Calculator,
  Lock,
  AlertTriangle,
  FileText,
  ChevronRight,
  Building2,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { QueryErrorState } from "@/components/query-error-state";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { staggerContainer, staggerItem } from "@/lib/animations";
import { usd } from "@/lib/format";
import type {
  CamMissingInput,
  CamStatementDrift,
  CamFrozenStatement,
} from "@shared/rental/camWorksheet";
import type { CamReconciliationResult } from "@shared/rental/camReconciliation";

interface CamPoolSummary {
  id: string;
  propertyId: number;
  propertyAddress: string | null;
  poolKind: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  totalRentableSqft: number | null;
  adminFeeBps: number | null;
  grossUpPct: string | null;
  recoverableCategories: string[];
}

interface WorksheetRow {
  lease: {
    id: string;
    unitLabel: string | null;
    startDate: string;
    endDate: string | null;
    status: string;
    leaseType: string | null;
    rentableSqft: number | null;
    camProRataBps: number | null;
  };
  preview: {
    blocked: boolean;
    missing: CamMissingInput[];
    blocking: CamMissingInput[];
    recoverableRowCount: number;
    result: CamReconciliationResult | null;
  };
  estimatedBilled: { cents: number; basis: string; chargeCount: number };
  statement: {
    frozen: boolean;
    reconciliation: (CamFrozenStatement & { id: string }) | null;
    fingerprint: string | null;
    drift: CamStatementDrift[];
  };
}

interface WorksheetResponse {
  pool: CamPoolSummary;
  periodMonths: number;
  rows: WorksheetRow[];
  count: number;
}

const BILLED_BASIS_LABEL: Record<string, string> = {
  from_charges: "from recorded CAM charges",
  lease_estimate: "from the lease's monthly CAM estimate",
  none: "none recorded",
};

function leaseName(lease: WorksheetRow["lease"]): string {
  return lease.unitLabel?.trim() || `Lease ${lease.id.slice(0, 8)}`;
}

/** cents → currency, or an em-dash. Never a zero standing in for "unknown". */
function money(cents: number | null | undefined): string {
  if (cents == null) return "—";
  return usd(cents / 100);
}

// ---------------------------------------------------------------------------

function MissingInputs({ missing }: { missing: CamMissingInput[] }) {
  const blocking = missing.filter((m) => m.blocking);
  const advisory = missing.filter((m) => !m.blocking);
  const anyOf = blocking.filter((m) => m.satisfiedBy === "any_of");
  const required = blocking.filter((m) => m.satisfiedBy === "required");

  return (
    <div className="space-y-3 text-sm">
      {required.length > 0 && (
        <div>
          <p className="font-medium text-foreground">Set these before this lease can be reconciled</p>
          <ul className="mt-1 space-y-1">
            {required.map((m) => (
              <li key={m.field} className="text-muted-foreground">
                <span className="text-foreground">{m.label}</span> — {m.fix}
              </li>
            ))}
          </ul>
        </div>
      )}
      {anyOf.length > 0 && (
        <div>
          <p className="font-medium text-foreground">Set any ONE of these to establish the pro-rata share</p>
          <ul className="mt-1 space-y-1">
            {anyOf.map((m) => (
              <li key={m.field} className="text-muted-foreground">
                <span className="text-foreground">{m.label}</span> — {m.fix}
              </li>
            ))}
          </ul>
        </div>
      )}
      {advisory.length > 0 && (
        <div>
          <p className="font-medium text-foreground">Worth knowing before you generate</p>
          <ul className="mt-1 space-y-1">
            {advisory.map((m) => (
              <li key={m.field} className="text-muted-foreground">
                <span className="text-foreground">{m.label}</span> — {m.fix}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function DriftPanel({ drift }: { drift: CamStatementDrift[] }) {
  if (drift.length === 0) return null;
  return (
    <div className="mt-3 rounded-md border border-dashed bg-muted/40 p-3">
      <p className="flex items-center gap-2 text-sm font-medium">
        <AlertTriangle className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        {drift.length} figure{drift.length === 1 ? "" : "s"} would differ if this were generated today
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        The statement above is what the tenant was billed and it stands. This is shown so you can
        decide what to do about the difference — a credit, or a corrected statement with its own
        paper trail. Nothing here has been applied.
      </p>
      <div className="mt-2 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Figure</TableHead>
              <TableHead>On the issued statement</TableHead>
              <TableHead>Would be today</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {drift.map((d) => (
              <TableRow key={d.field}>
                <TableCell className="font-mono text-xs">{d.field}</TableCell>
                <TableCell className="text-xs">{String(d.frozen ?? "—")}</TableCell>
                <TableCell className="text-xs">{String(d.current ?? "—")}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function LeaseCard({
  row,
  poolId,
  onGenerated,
}: {
  row: WorksheetRow;
  poolId: string;
  onGenerated: () => void;
}) {
  const { toast } = useToast();
  const frozen = row.statement.frozen;
  const result = row.preview.result;

  // allow-no-invalidation: the worksheet query belongs to the parent, which
  // invalidates ["/api/cam-pools", activePoolId, "worksheet"] in the
  // onGenerated callback this mutation fires. Invalidating the same key here
  // as well would double-fetch the freeze result on every generate.
  const generate = useMutation({
    mutationFn: async (): Promise<{ created: boolean; message?: string }> => {
      const res = await fetch(`/api/cam-pools/${poolId}/reconciliations/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ leaseId: row.lease.id }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.message || `Failed (${res.status})`);
      return body;
    },
    // A 200 here means one of TWO things and they must not be confused: the
    // statement was generated, or one already existed and stands. `created`
    // discriminates — announcing a generation that did not happen would be the
    // exact fabrication this surface exists to avoid.
    onSuccess: (body) => {
      if (body.created) {
        toast({
          title: "Statement generated and frozen",
          description:
            "The figures and the inputs behind them are now fixed. Editing the pool afterwards will not change this statement.",
        });
      } else {
        toast({
          title: "Nothing was generated — this statement is already frozen",
          description:
            body.message ??
            "A statement was already issued for this lease and period. It stands as billed.",
        });
      }
      onGenerated();
    },
    onError: (err: Error) => {
      toast({ title: "Nothing was generated", description: err.message, variant: "destructive" });
    },
  });

  return (
    <motion.div variants={staggerItem}>
      <Card data-testid={`cam-worksheet-lease-${row.lease.id}`}>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                {leaseName(row.lease)}
                {frozen && (
                  <Badge variant="secondary" className="gap-1">
                    <Lock className="h-3 w-3" aria-hidden="true" />
                    Frozen statement
                  </Badge>
                )}
                {row.lease.leaseType && <Badge variant="outline">{row.lease.leaseType}</Badge>}
              </CardTitle>
              <CardDescription>
                {row.lease.startDate} — {row.lease.endDate ?? "month-to-month"}
                {row.lease.rentableSqft != null && ` · ${row.lease.rentableSqft.toLocaleString()} sqft`}
              </CardDescription>
            </div>
            {!frozen && !row.preview.blocked && (
              <Button
                size="sm"
                onClick={() => generate.mutate()}
                disabled={generate.isPending}
                data-testid={`cam-generate-${row.lease.id}`}
              >
                {generate.isPending ? "Generating…" : "Generate & freeze"}
              </Button>
            )}
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* ── Refused: say WHICH inputs are missing ───────────────────── */}
          {row.preview.blocked && !frozen && (
            <div
              className="rounded-md border border-dashed p-4"
              data-testid={`cam-blocked-${row.lease.id}`}
            >
              <p className="flex items-center gap-2 text-sm font-medium">
                <AlertTriangle className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                No reconciliation for this lease — the inputs are incomplete
              </p>
              <p className="mt-1 mb-3 text-xs text-muted-foreground">
                A CAM bill is real money. Rather than fill a gap with an assumption, nothing is
                computed until these are set.
              </p>
              <MissingInputs missing={row.preview.missing} />
            </div>
          )}

          {/* ── The figures (frozen ones win over the preview) ──────────── */}
          {(frozen || result) && (
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-xs text-muted-foreground">Pool actual</dt>
                <dd className="font-medium tabular-nums">
                  {money(frozen ? row.statement.reconciliation?.poolActualCents : result?.poolActualCents)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Pro-rata share</dt>
                <dd className="font-medium tabular-nums">
                  {(() => {
                    const bps = frozen
                      ? row.statement.reconciliation?.proRataBpsUsed
                      : result?.proRataBps;
                    const basis = frozen
                      ? row.statement.reconciliation?.proRataBasis
                      : result?.proRataBasis;
                    if (bps == null) return "—";
                    return `${(bps / 100).toFixed(2)}%${basis === "sqft" ? " (by sqft)" : " (fixed by lease)"}`;
                  })()}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Recoverable share</dt>
                <dd className="font-medium tabular-nums">
                  {money(
                    frozen
                      ? row.statement.reconciliation?.recoverableShareCents
                      : result?.recoverableShareCents,
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">
                  {(() => {
                    const delta = frozen
                      ? row.statement.reconciliation?.deltaCents
                      : result?.deltaCents;
                    if (delta == null) return "Balance";
                    return delta >= 0 ? "Balance due" : "Credit due to tenant";
                  })()}
                </dt>
                <dd className="font-semibold tabular-nums">
                  {(() => {
                    const delta = frozen
                      ? row.statement.reconciliation?.deltaCents
                      : result?.deltaCents;
                    return delta == null ? "—" : money(Math.abs(delta));
                  })()}
                </dd>
              </div>
            </dl>
          )}

          {/* ── Estimated-billed provenance, always stated ──────────────── */}
          {(frozen || result) && (
            <p className="text-xs text-muted-foreground">
              Estimated CAM billed over the period: {money(row.estimatedBilled.cents)} (
              {BILLED_BASIS_LABEL[row.estimatedBilled.basis] ?? row.estimatedBilled.basis})
              {row.estimatedBilled.basis === "none" && " — this lease has no CAM charges and no lease estimate on record."}
            </p>
          )}

          {/* ── Coverage caveat ─────────────────────────────────────────── */}
          {!frozen && result && !result.coverageComplete && (
            <p className="rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
              Based on recorded expenses for {result.coverageMonths} of {result.periodMonths} months.
              Generating now produces a PARTIAL, provisional true-up — and it will be frozen as such.
            </p>
          )}

          {/* ── Frozen statement ────────────────────────────────────────── */}
          {frozen && row.statement.reconciliation && (
            <div className="rounded-md border bg-muted/30 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="flex items-center gap-2 text-xs font-medium">
                  <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                  Issued statement
                  {row.statement.reconciliation.generatedAt && (
                    <span className="font-normal text-muted-foreground">
                      · generated {String(row.statement.reconciliation.generatedAt).slice(0, 10)}
                    </span>
                  )}
                </p>
                {row.statement.fingerprint && (
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {row.statement.reconciliation.statementVersion} · {row.statement.fingerprint}
                  </span>
                )}
              </div>
              <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-xs text-muted-foreground">
                {row.statement.reconciliation.statementMarkdown}
              </pre>
              <p className="mt-2 text-xs text-muted-foreground">
                This statement is frozen. Re-generating it is refused — the tenant was billed from
                these exact figures and the inputs behind them.
              </p>
            </div>
          )}

          <DriftPanel drift={row.statement.drift} />
        </CardContent>
      </Card>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------

export function CamWorksheet() {
  const [poolId, setPoolId] = useState<string | null>(null);

  const poolsQuery = useQuery<{ pools: CamPoolSummary[]; count: number }>({
    queryKey: ["/api/cam-pools"],
    queryFn: async () => {
      const res = await fetch("/api/cam-pools", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return res.json();
    },
  });

  const pools = poolsQuery.data?.pools ?? [];
  const activePoolId = poolId ?? pools[0]?.id ?? null;

  const worksheetQuery = useQuery<WorksheetResponse>({
    queryKey: ["/api/cam-pools", activePoolId, "worksheet"],
    enabled: Boolean(activePoolId),
    queryFn: async () => {
      const res = await fetch(`/api/cam-pools/${activePoolId}/worksheet`, { credentials: "include" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return res.json();
    },
  });

  if (poolsQuery.isLoading) {
    return (
      <div className="space-y-4" role="status" aria-live="polite">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-40 rounded-card" />
        <Skeleton className="h-40 rounded-card" />
        <span className="sr-only">Loading CAM pools…</span>
      </div>
    );
  }

  if (poolsQuery.isError) {
    return (
      <QueryErrorState
        error={poolsQuery.error instanceof Error ? poolsQuery.error : null}
        onRetry={() => poolsQuery.refetch()}
        isRetrying={poolsQuery.isRefetching}
        title="Couldn't load your CAM pools"
        testId="cam-pools-error"
      />
    );
  }

  if (pools.length === 0) {
    return (
      <EmptyState
        icon={Calculator}
        headline="No CAM expense pools yet"
        subtitle="A pool defines which property expenses are recoverable for a period. Define one before a year-end true-up can be reconciled against it."
        framed
        cta={{
          label: "Open rent roll",
          href: "/rent-roll",
          "data-testid": "cam-empty-cta",
        }}
        tips={[
          "One pool per kind (CAM, tax, insurance) per property per period.",
          "Recoverability is your explicit assertion — it is never inferred from a category.",
        ]}
        testId="cam-worksheet-empty"
      />
    );
  }

  const activePool = pools.find((p) => p.id === activePoolId) ?? null;
  const rows = worksheetQuery.data?.rows ?? [];

  return (
    <div className="space-y-6" data-testid="cam-worksheet">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight flex items-center gap-2">
            <Calculator className="h-5 w-5 text-primary" aria-hidden="true" />
            CAM reconciliation
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Each lease's share of the pool's actual recoverable spend, against what it was billed in
            estimates. Generating <strong>freezes</strong> the statement — the figures and the inputs
            behind them are fixed at that moment, so a later edit to the pool cannot rewrite a
            statement you already sent.
          </p>
          <p className="mt-2 max-w-3xl text-xs text-muted-foreground">
            Nothing here moves money. A generated statement is a document; the resulting charge is
            recorded on the rent ledger, on your own rails.
          </p>
        </div>

        <div className="w-full sm:w-96">
          <label htmlFor="cam-pool-select" className="mb-1 block text-xs text-muted-foreground">
            Expense pool
          </label>
          <Select value={activePoolId ?? undefined} onValueChange={setPoolId}>
            <SelectTrigger id="cam-pool-select" data-testid="cam-pool-select">
              <SelectValue placeholder="Choose a pool" />
            </SelectTrigger>
            <SelectContent>
              {pools.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.propertyAddress ?? `Property ${p.propertyId}`} · {p.poolKind} · {p.periodStart}–
                  {p.periodEnd}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {activePool && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Building2 className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              {activePool.propertyAddress ?? `Property ${activePool.propertyId}`}
            </CardTitle>
            <CardDescription>
              {activePool.poolKind} pool · {activePool.periodStart} to {activePool.periodEnd} ·{" "}
              {activePool.status}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-xs text-muted-foreground">Building rentable sqft</dt>
                <dd className="font-medium tabular-nums">
                  {activePool.totalRentableSqft?.toLocaleString() ?? "Not set"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Admin fee</dt>
                <dd className="font-medium tabular-nums">
                  {activePool.adminFeeBps != null ? `${(activePool.adminFeeBps / 100).toFixed(2)}%` : "None"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Gross-up</dt>
                <dd className="font-medium tabular-nums">
                  {activePool.grossUpPct != null ? `${Number(activePool.grossUpPct)}%` : "None"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Recoverable categories</dt>
                <dd className="font-medium">{activePool.recoverableCategories?.length ?? 0}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      )}

      {worksheetQuery.isLoading && (
        <div className="space-y-4" role="status" aria-live="polite">
          <Skeleton className="h-48 rounded-card" />
          <Skeleton className="h-48 rounded-card" />
          <span className="sr-only">Loading the worksheet…</span>
        </div>
      )}

      {worksheetQuery.isError && (
        <QueryErrorState
          error={worksheetQuery.error instanceof Error ? worksheetQuery.error : null}
          onRetry={() => worksheetQuery.refetch()}
          isRetrying={worksheetQuery.isRefetching}
          title="Couldn't load this pool's worksheet"
          testId="cam-worksheet-error"
        />
      )}

      {worksheetQuery.isSuccess && rows.length === 0 && (
        <EmptyState
          icon={FileText}
          headline="No leases overlap this pool's period"
          subtitle="A CAM pool reconciles against the leases that occupied the building during its period. None of this property's leases overlap this one."
          framed
          cta={{ label: "Open leases", href: "/leases", "data-testid": "cam-no-leases-cta" }}
          testId="cam-worksheet-no-leases"
        />
      )}

      {rows.length > 0 && (
        <motion.div
          className="space-y-4"
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
        >
          {rows.map((row) => (
            <LeaseCard
              key={row.lease.id}
              row={row}
              poolId={activePoolId!}
              onGenerated={() => {
                queryClient.invalidateQueries({ queryKey: ["/api/cam-pools", activePoolId, "worksheet"] });
              }}
            />
          ))}
        </motion.div>
      )}

      {rows.length > 0 && (
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          <ChevronRight className="h-3 w-3" aria-hidden="true" />
          Charges from a generated statement are recorded on the lease ledger under{" "}
          <a href="/rent-roll" className="underline underline-offset-2">
            Rent roll
          </a>
          .
        </p>
      )}
    </div>
  );
}

export default CamWorksheet;
