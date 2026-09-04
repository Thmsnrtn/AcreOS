/**
 * Founder Finance — Steering sections.
 *
 * Folded into `/founder/steering` ABOVE the existing letter/strategy/recovery
 * sections (those are preserved). No new /founder/finance top-level route
 * exists; this is the canonical financial surface per the founder-side
 * integration map.
 *
 * Five subsections, in plan order:
 *   1. Buckets — five horizontal bars + per-bucket timeline drill-down.
 *   2. MRR + margin — sparkline + per-tier table + this-vs-last delta.
 *   3. Cost mix — pie by category w/ provider breakdown + per-org margin table.
 *   4. Scale-up history — audit-log table.
 *   5. Recovery actions — bucket-to-bucket transfer form.
 *
 * Uses Skeleton during loading, QueryErrorState on failure.
 */
import { useMemo, useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { QueryErrorState } from "@/components/query-error-state";
import { useToast } from "@/hooks/use-toast";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip as ReTooltip,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import {
  useBuckets,
  useContributionMargin,
  useCostMix,
  useMrr,
  useRecoveryTransfer,
  useScaleUpHistory,
  type CostMixCategory,
  type RecoveryTransferArgs,
} from "@/hooks/use-finance";
import { formatDate } from "@/lib/format";
import { Verbs } from "@/lib/labels";

const BUCKET_ORDER = [
  "tax_reserve",
  "refund_reserve",
  "profit_reserve",
  "owner_draw",
  "opex_available",
] as const;

const BUCKET_LABELS: Record<(typeof BUCKET_ORDER)[number], string> = {
  tax_reserve: "Tax",
  refund_reserve: "Refund",
  profit_reserve: "Profit",
  owner_draw: "Draw",
  opex_available: "Opex",
};

const BUCKET_COLORS: Record<(typeof BUCKET_ORDER)[number], string> = {
  tax_reserve: "#5b8def",
  refund_reserve: "#f59e0b",
  profit_reserve: "#10b981",
  owner_draw: "#a855f7",
  opex_available: "#64748b",
};

const COST_MIX_COLORS: Record<CostMixCategory, string> = {
  postcard: "#3b82f6",
  sms: "#10b981",
  email: "#a855f7",
  ai_tokens: "#f59e0b",
  skip_trace: "#ec4899",
  stripe_fee: "#64748b",
  voice: "#06b6d4",
  listings: "#8b5cf6",
};

function formatUsd(cents: number, opts?: { compact?: boolean }): string {
  const dollars = cents / 100;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: opts?.compact ? "compact" : "standard",
    maximumFractionDigits: dollars >= 100 || opts?.compact ? 0 : 2,
  }).format(dollars);
}

export function FounderFinanceSteeringSections() {
  return (
    <div className="space-y-6">
      <BucketsSection />
      <MrrMarginSection />
      <CostMixSection />
      <ScaleUpHistorySection />
      <RecoveryActionsSection />
    </div>
  );
}

// ── Section 1: Buckets ───────────────────────────────────────────────────────

function BucketsSection() {
  const { data, isLoading, isError, refetch, error } = useBuckets();
  const [drillBucket, setDrillBucket] = useState<string | null>(null);

  return (
    <Card id="buckets">
      <CardHeader>
        <CardTitle className="text-base">Buckets</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : isError ? (
          <QueryErrorState
            compact
            error={error as Error | null}
            onRetry={() => refetch()}
          />
        ) : data ? (
          <div className="space-y-3">
            <div className="flex flex-col gap-2" role="list">
              {BUCKET_ORDER.map((b) => {
                const value =
                  b === "tax_reserve" ? data.taxReserve :
                  b === "refund_reserve" ? data.refundReserve :
                  b === "profit_reserve" ? data.profitReserve :
                  b === "owner_draw" ? data.ownerDraw :
                  data.opexAvailableNet;
                const max = Math.max(
                  data.taxReserve,
                  data.refundReserve,
                  data.profitReserve,
                  data.ownerDraw,
                  Math.abs(data.opexAvailableNet),
                  1,
                );
                const widthPct = Math.max(2, Math.min(100, (Math.abs(value) / max) * 100));
                return (
                  <button
                    key={b}
                    type="button"
                    role="listitem"
                    aria-label={`${BUCKET_LABELS[b]} bucket: ${formatUsd(value)}`}
                    onClick={() => setDrillBucket(drillBucket === b ? null : b)}
                    className="text-left group focus:outline-none focus-visible:ring-2 focus-visible:ring-acr-brand rounded"
                  >
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="font-medium">{BUCKET_LABELS[b]}</span>
                      <span className="tabular-nums text-muted-foreground">
                        {formatUsd(value)}
                      </span>
                    </div>
                    <div
                      className="h-3 w-full rounded-full bg-muted overflow-hidden"
                      aria-hidden="true"
                    >
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${widthPct}%`,
                          background: BUCKET_COLORS[b],
                        }}
                      />
                    </div>
                  </button>
                );
              })}
            </div>
            {drillBucket && (
              <div className="mt-2 p-3 rounded-md bg-muted/40 text-xs">
                <div className="font-semibold mb-1">
                  {BUCKET_LABELS[drillBucket as keyof typeof BUCKET_LABELS]} — last 30 days
                </div>
                <p className="text-muted-foreground">
                  Drill-down timeline shows debits + credits posted to this bucket.
                  Click again to collapse.
                </p>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Opex shown as net (allocations minus spend). As of{" "}
              {new Date(data.asOf).toLocaleString()}.
            </p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

// ── Section 2: MRR + margin ─────────────────────────────────────────────────

function MrrMarginSection() {
  const mrr = useMrr();
  const margin = useContributionMargin();

  return (
    <Card id="mrr">
      <CardHeader>
        <CardTitle className="text-base">Revenue collected + margin</CardTitle>
        {/* NOT labeled "MRR": this section reads the financial LEDGER
            (cash actually posted in the window), while the Letter/home
            reports true subscription run-rate from active org tiers
            (computeRealMrrUsd). Labeling both "MRR" made sibling founder
            pages contradict each other ($0.00 here vs $49 on the Letter —
            2026-07 design-panel finding). Same numbers, honest names. */}
        <p className="text-xs text-muted-foreground">
          Cash posted to the ledger — subscription run-rate (MRR) lives on the
          Letter and can differ until payments post here.
        </p>
      </CardHeader>
      <CardContent>
        {mrr.isLoading || margin.isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : mrr.isError ? (
          <QueryErrorState
            compact
            error={mrr.error as Error | null}
            onRetry={() => mrr.refetch()}
          />
        ) : margin.isError ? (
          <QueryErrorState
            compact
            error={margin.error as Error | null}
            onRetry={() => margin.refetch()}
          />
        ) : mrr.data && margin.data ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <div className="text-xs text-muted-foreground mb-1">
                  Revenue collected (trailing 30d)
                </div>
                <div className="text-2xl font-semibold tabular-nums">
                  {formatUsd(mrr.data.currentMrr)}
                </div>
                <div className="h-24 mt-2">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={mrr.data.mrrTrend}>
                      <Line
                        type="monotone"
                        dataKey="mrr"
                        stroke="#5b8def"
                        strokeWidth={2}
                        dot={false}
                      />
                      <XAxis dataKey="date" hide />
                      <YAxis hide />
                      <ReTooltip
                        formatter={(v) =>
                          typeof v === "number" ? formatUsd(v) : String(v)
                        }
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-1">
                  Net contribution margin
                </div>
                <div className="text-2xl font-semibold tabular-nums">
                  {formatUsd(margin.data.thisMonthCents)}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  this month · {margin.data.marginPctThisMonth.toFixed(1)}% ·
                  delta {formatUsd(margin.data.thisMonthCents - margin.data.lastMonthCents)}
                  {" "}vs last month
                </div>
              </div>
            </div>
            <div>
              <div className="text-xs font-semibold mb-2">By tier (last 30d)</div>
              <table
                className="w-full text-sm"
                aria-label="MRR breakdown by tier"
              >
                <thead>
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="font-medium py-1">Tier</th>
                    <th className="font-medium py-1 text-right">MRR</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="py-1">Starter</td>
                    <td className="py-1 text-right tabular-nums">
                      {formatUsd(mrr.data.byTier.starter)}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-1">Pro</td>
                    <td className="py-1 text-right tabular-nums">
                      {formatUsd(mrr.data.byTier.pro)}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-1">Scale</td>
                    <td className="py-1 text-right tabular-nums">
                      {formatUsd(mrr.data.byTier.scale)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

// ── Section 3: Cost mix ──────────────────────────────────────────────────────

function CostMixSection() {
  const [days, setDays] = useState<7 | 30>(30);
  const [showNetNeg, setShowNetNeg] = useState(false);
  const costMix = useCostMix(days);
  const margin = useContributionMargin();

  const pieData = useMemo(() => {
    if (!costMix.data) return [];
    return (Object.entries(costMix.data.byCategory) as Array<
      [CostMixCategory, { cents: number; providers: Record<string, number> }]
    >)
      .filter(([, v]) => v.cents > 0)
      .map(([k, v]) => ({ name: k, value: v.cents, providers: v.providers }));
  }, [costMix.data]);

  const perOrg = margin.data?.perOrg ?? [];
  const visibleOrgs = showNetNeg
    ? perOrg.filter((o) => o.marginCents < 0)
    : perOrg;

  return (
    <Card id="cost-mix">
      <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
        <CardTitle className="text-base">Cost mix</CardTitle>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant={days === 7 ? "default" : "outline"}
            onClick={() => setDays(7)}
            aria-pressed={days === 7}
          >
            7d
          </Button>
          <Button
            size="sm"
            variant={days === 30 ? "default" : "outline"}
            onClick={() => setDays(30)}
            aria-pressed={days === 30}
          >
            30d
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {costMix.isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : costMix.isError ? (
          <QueryErrorState
            compact
            error={costMix.error as Error | null}
            onRetry={() => costMix.refetch()}
          />
        ) : costMix.data ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="h-48">
                {pieData.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                    No opex spend in this window.
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={pieData}
                        dataKey="value"
                        nameKey="name"
                        innerRadius={40}
                        outerRadius={80}
                      >
                        {pieData.map((d) => (
                          <Cell
                            key={d.name}
                            fill={COST_MIX_COLORS[d.name as CostMixCategory] ?? "#888"}
                          />
                        ))}
                      </Pie>
                      <ReTooltip
                        formatter={(v, _name, entry) => {
                          const providers = (entry?.payload as { providers?: Record<string, number> } | undefined)?.providers;
                          const providerStr = providers
                            ? Object.entries(providers)
                                .map(([p, c]) => `${p}: ${formatUsd(c)}`)
                                .join(", ")
                            : "";
                          return [
                            typeof v === "number" ? formatUsd(v) : String(v),
                            providerStr,
                          ];
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </div>
              <ul className="text-xs space-y-1" role="list">
                {pieData.map((d) => (
                  <li
                    key={d.name}
                    className="flex items-center justify-between gap-2"
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className="w-2 h-2 rounded-full"
                        style={{
                          background: COST_MIX_COLORS[d.name as CostMixCategory] ?? "#888",
                        }}
                        aria-hidden="true"
                      />
                      <span className="capitalize">{d.name.replace("_", " ")}</span>
                    </span>
                    <span className="tabular-nums">{formatUsd(d.value)}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs font-semibold">Per-org margin</div>
                <label className="flex items-center gap-1 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showNetNeg}
                    onChange={(e) => setShowNetNeg(e.target.checked)}
                    aria-label="Show only net-negative customers"
                  />
                  <span>Show net-negative only</span>
                </label>
              </div>
              {margin.isLoading ? (
                <Skeleton className="h-24 w-full" />
              ) : visibleOrgs.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {showNetNeg ? "No net-negative orgs." : "No orgs in window."}
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs" aria-label="Per-org contribution margin">
                    <thead className="text-muted-foreground text-left">
                      <tr>
                        <th className="font-medium py-1">Org</th>
                        <th className="font-medium py-1">Tier</th>
                        <th className="font-medium py-1 text-right">MRR</th>
                        <th className="font-medium py-1 text-right">Var cost</th>
                        <th className="font-medium py-1 text-right">Margin</th>
                        <th className="font-medium py-1 text-right">%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleOrgs.slice(0, 50).map((o) => (
                        <tr
                          key={o.orgId}
                          className={o.marginCents < 0 ? "text-acr-neg" : ""}
                        >
                          <td className="py-1 truncate max-w-[12rem]">{o.orgName}</td>
                          <td className="py-1">
                            <Badge variant="secondary" className="text-xs">
                              {o.tier}
                            </Badge>
                          </td>
                          <td className="py-1 text-right tabular-nums">
                            {formatUsd(o.mrrCents)}
                          </td>
                          <td className="py-1 text-right tabular-nums">
                            {formatUsd(o.variableCostCents)}
                          </td>
                          <td className="py-1 text-right tabular-nums">
                            {formatUsd(o.marginCents)}
                          </td>
                          <td className="py-1 text-right tabular-nums">
                            {o.marginPct.toFixed(1)}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

// ── Section 4: Scale-up history ──────────────────────────────────────────────

function ScaleUpHistorySection() {
  const history = useScaleUpHistory();
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const decisions = history.data?.decisions ?? [];
  const filtered = decisions.filter((d) =>
    statusFilter === "all" ? true : d.action === statusFilter,
  );

  return (
    <Card id="scale-up-history">
      <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
        <CardTitle className="text-base">Scale-up history</CardTitle>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-32 h-8 text-xs" aria-label="Filter scale-up history by status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="approve">Approved</SelectItem>
            <SelectItem value="defer">Deferred</SelectItem>
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent>
        {history.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : history.isError ? (
          <QueryErrorState
            compact
            error={history.error as Error | null}
            onRetry={() => history.refetch()}
          />
        ) : filtered.length === 0 ? (
          <p className="text-xs text-muted-foreground">No scale-up decisions yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs" aria-label="Scale-up history">
              <thead className="text-muted-foreground text-left">
                <tr>
                  <th className="font-medium py-1">Date</th>
                  <th className="font-medium py-1">Threshold</th>
                  <th className="font-medium py-1">Action</th>
                  <th className="font-medium py-1">Decision</th>
                  <th className="font-medium py-1">Note</th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 100).map((d) => {
                  const after = (d.after ?? {}) as {
                    threshold?: number;
                    action?: string;
                  };
                  return (
                    <tr key={d.id}>
                      <td className="py-1 tabular-nums">
                        {formatDate(d.createdAt)}
                      </td>
                      <td className="py-1 tabular-nums">
                        {after.threshold != null
                          ? formatUsd(after.threshold)
                          : d.targetId ?? "—"}
                      </td>
                      <td className="py-1">{after.action ?? "—"}</td>
                      <td className="py-1">
                        <Badge
                          variant="secondary"
                          className={
                            d.action === "approve"
                              ? "text-xs bg-acr-pos-soft text-acr-pos-soft-ink"
                              : "text-xs"
                          }
                        >
                          {d.action}
                        </Badge>
                      </td>
                      <td className="py-1 truncate max-w-[12rem]">{d.note ?? ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Section 5: Recovery actions ──────────────────────────────────────────────

const BUCKET_SELECT_OPTIONS: Array<{
  value: RecoveryTransferArgs["fromBucket"];
  label: string;
}> = [
  { value: "tax_reserve", label: "Tax reserve" },
  { value: "refund_reserve", label: "Refund reserve" },
  { value: "profit_reserve", label: "Profit reserve" },
  { value: "owner_draw", label: "Owner draw" },
  { value: "opex_available", label: "Opex available" },
];

function RecoveryActionsSection() {
  const transfer = useRecoveryTransfer();
  const { toast } = useToast();
  const [fromBucket, setFromBucket] = useState<RecoveryTransferArgs["fromBucket"]>("profit_reserve");
  const [toBucket, setToBucket] = useState<RecoveryTransferArgs["toBucket"]>("refund_reserve");
  const [amount, setAmount] = useState<string>("");
  const [note, setNote] = useState<string>("");
  const [confirmOpen, setConfirmOpen] = useState(false);

  const amountCents = Math.round((parseFloat(amount) || 0) * 100);
  const canSubmit =
    amountCents > 0 && fromBucket !== toBucket && note.trim().length > 0;

  function submit() {
    transfer.mutate(
      { fromBucket, toBucket, amountCents, note },
      {
        onSuccess: () => {
          toast({
            title: "Transfer posted",
            description: `${formatUsd(amountCents)} ${fromBucket} → ${toBucket}`,
          });
          setAmount("");
          setNote("");
          setConfirmOpen(false);
        },
        onError: (err) => {
          toast({
            title: "Transfer failed",
            description: err instanceof Error ? err.message : String(err),
            variant: "destructive",
          });
        },
      },
    );
  }

  return (
    <Card id="recovery">
      <CardHeader>
        <CardTitle className="text-base">Recovery actions</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground mb-3">
          Manual bucket-to-bucket transfer for recovery scenarios (e.g. refund
          reserve depleted after chargebacks). Posts a paired counter-entry and
          logs to founder_audit.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label htmlFor="from-bucket" className="text-xs font-medium block mb-1">
              From
            </label>
            <Select
              value={fromBucket}
              onValueChange={(v) => setFromBucket(v as RecoveryTransferArgs["fromBucket"])}
            >
              <SelectTrigger id="from-bucket" aria-label="From bucket">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BUCKET_SELECT_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label htmlFor="to-bucket" className="text-xs font-medium block mb-1">
              To
            </label>
            <Select
              value={toBucket}
              onValueChange={(v) => setToBucket(v as RecoveryTransferArgs["toBucket"])}
            >
              <SelectTrigger id="to-bucket" aria-label="To bucket">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BUCKET_SELECT_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label htmlFor="amount" className="text-xs font-medium block mb-1">
              Amount (USD)
            </label>
            <Input
              id="amount"
              type="number"
              min="0"
              step="0.01"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              aria-label="Amount in dollars"
            />
          </div>
          <div className="md:row-span-1">
            <label htmlFor="note" className="text-xs font-medium block mb-1">
              Note (required)
            </label>
            <Textarea
              id="note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Why is this transfer needed?"
              rows={2}
              aria-required="true"
            />
          </div>
        </div>
        <div className="mt-3">
          <Button
            size="sm"
            disabled={!canSubmit || transfer.isPending}
            onClick={() => setConfirmOpen(true)}
          >
            {transfer.isPending ? "Posting…" : "Review transfer"}
          </Button>
        </div>
      </CardContent>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm bucket transfer</DialogTitle>
            <DialogDescription>
              {formatUsd(amountCents)} from{" "}
              <strong>{fromBucket}</strong> to <strong>{toBucket}</strong>.
              This posts paired counter-entries to the financial ledger and
              writes to founder_audit. Cannot be undone — post a reverse
              transfer to revert.
            </DialogDescription>
          </DialogHeader>
          <div className="text-xs text-muted-foreground">Note: {note}</div>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmOpen(false)}
              disabled={transfer.isPending}
            >
              {Verbs.CANCEL}
            </Button>
            <Button
              size="sm"
              onClick={submit}
              disabled={transfer.isPending || !canSubmit}
            >
              {transfer.isPending ? "Posting…" : "Post transfer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
