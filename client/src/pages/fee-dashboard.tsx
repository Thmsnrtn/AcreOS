import { useState, useId } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { useToast } from "@/hooks/use-toast";
import { usd } from "@/lib/format";
import { useDocumentTitle } from "@/hooks/use-document-title";
import {
  DollarSign, Clock, TrendingUp, ArrowUpRight, CheckCircle2,
  Send, Settings, Wallet, FileText,
} from "lucide-react";

// ─── Types ──────────────────────────────────────────────────────────────────

interface FeeAnalytics {
  totalCollected: number;
  pendingInEscrow: number;
  paidOut: number;
  thisMonth: number;
  avgFeeRate: number;
  transactionCount: number;
  lastUpdated: string;
}

interface Settlement {
  id: string | number;
  transactionId: string;
  amount: number;
  feeRate: number;
  status: "pending" | "held" | "released";
  notes?: string;
  createdAt: string;
  releasedAt?: string;
}

interface LedgerEntry {
  id: string | number;
  type: string;
  amount: number;
  reference: string;
  description: string;
  createdAt: string;
}

interface Payout {
  id: string | number;
  amount: number;
  bankAccountId: string;
  status: string;
  note?: string;
  triggeredAt: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Money on a settlements/payouts dashboard must show cents — these are
// real dollars being held in escrow and paid to bank accounts. Drop
// previous maximumFractionDigits: 0 which dropped up to $0.99 per line.
function fmtCurrency(val: number) {
  return usd(val);
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    pending: "bg-acr-warn-soft text-acr-warn",
    held: "bg-acr-accent text-acr-accent",
    released: "bg-acr-pos-soft text-acr-pos",
    processing: "bg-acr-brand-soft text-acr-brand",
    completed: "bg-acr-pos-soft text-acr-pos",
    failed: "bg-acr-neg-soft text-acr-neg",
  };
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium capitalize ${map[status] ?? "bg-muted text-muted-foreground"}`}>
      {status}
    </span>
  );
}

function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`bg-muted/50 rounded animate-pulse ${className}`} />;
}

// ─── Summary Cards ────────────────────────────────────────────────────────────

function SummaryCards({ analytics, loading }: { analytics: FeeAnalytics | null; loading: boolean }) {
  const cards = [
    { label: "Total fees collected", value: analytics?.totalCollected, icon: DollarSign, color: "text-acr-pos" },
    { label: "Pending in escrow", value: analytics?.pendingInEscrow, icon: Clock, color: "text-acr-warn" },
    { label: "Paid out", value: analytics?.paidOut, icon: CheckCircle2, color: "text-acr-accent" },
    { label: "This month", value: analytics?.thisMonth, icon: TrendingUp, color: "text-acr-brand" },
  ];

  return (
    <dl className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {cards.map((card) => (
        <Card key={card.label}>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-1">
              <dt className="text-sm text-muted-foreground">{card.label}</dt>
              <card.icon className={`w-4 h-4 ${card.color}`} aria-hidden="true" />
            </div>
            {loading ? (
              <Skeleton className="h-7 w-24 mt-1" />
            ) : (
              <dd className="text-2xl font-bold tabular-nums">{fmtCurrency(card.value ?? 0)}</dd>
            )}
          </CardContent>
        </Card>
      ))}
    </dl>
  );
}

// ─── Analytics Chart ─────────────────────────────────────────────────────────

function AnalyticsChart({ analytics }: { analytics: FeeAnalytics | null }) {
  const data = analytics ? [
    { name: "Collected", value: analytics.totalCollected },
    { name: "In escrow", value: analytics.pendingInEscrow },
    { name: "Paid out", value: analytics.paidOut },
    { name: "This month", value: analytics.thisMonth },
  ] : [];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-primary" aria-hidden="true" /> Fee breakdown
        </CardTitle>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <Skeleton className="h-48 w-full" />
        ) : (
          <div
            role="img"
            aria-label={`Fee breakdown bar chart: ${data.map(d => `${d.name} ${fmtCurrency(d.value)}`).join(", ")}`}
          >
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={data} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis tickFormatter={v => `$${(v / 1000).toFixed(0)}K`} tick={{ fontSize: 11 }} width={60} />
                <Tooltip formatter={((val: number) => fmtCurrency(val)) as any} />
                <Bar dataKey="value" fill="#6366f1" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
        {analytics && (
          <dl className="mt-3 flex gap-4 text-xs text-muted-foreground">
            <div className="flex gap-1">
              <dt>Average rate:</dt>
              <dd><strong className="tabular-nums">{(analytics.avgFeeRate * 100).toFixed(2)}%</strong></dd>
            </div>
            <div className="flex gap-1">
              <dt>Transactions:</dt>
              <dd><strong className="tabular-nums">{analytics.transactionCount.toLocaleString()}</strong></dd>
            </div>
          </dl>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Settlements Tab ──────────────────────────────────────────────────────────

function SettlementsTab() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [settlementToRelease, setSettlementToRelease] = useState<Settlement | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["/api/fees/settlements", statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: "50", offset: "0" });
      if (statusFilter && statusFilter !== "all") params.set("status", statusFilter);
      const res = await fetch(`/api/fees/settlements?${params}`, { credentials: "include" });
      return res.json();
    },
  });

  const settlements: Settlement[] = data?.settlements ?? [];

  const statusFilterId = useId();

  const releaseMutation = useMutation({
    mutationFn: async (id: string | number) => {
      const res = await fetch(`/api/fees/settlements/${id}/release`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ releaseNote: "Manual release" }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Settlement released from escrow." });
      queryClient.invalidateQueries({ queryKey: ["/api/fees/settlements"] });
      queryClient.invalidateQueries({ queryKey: ["/api/fees/analytics"] });
      setSettlementToRelease(null);
    },
    onError: (e: any) =>
      toast({
        title: "Couldn't release settlement",
        description: `${e.message} — the settlement is still held in escrow. No funds were moved.`,
        variant: "destructive",
      }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-44">
          <Label htmlFor={statusFilterId} className="text-xs">Status</Label>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger id={statusFilterId} className="h-8">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="held">Held in escrow</SelectItem>
              <SelectItem value="released">Released</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <p className="text-xs text-muted-foreground ml-auto self-end pb-1">
          <span className="tabular-nums">{settlements.length}</span> result{settlements.length === 1 ? "" : "s"}
        </p>
      </div>

      {isLoading ? (
        <div className="space-y-2" role="status" aria-live="polite">
          <span className="sr-only">Loading settlements…</span>
          {[1,2,3,4,5].map(i => <Skeleton key={i} className="h-12" />)}
        </div>
      ) : settlements.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Wallet className="w-10 h-10 mx-auto mb-2 text-muted-foreground" aria-hidden="true" />
            <p className="text-muted-foreground">No settlements found.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-md border" role="region" aria-label="Settlements" tabIndex={0}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Transaction</TableHead>
                <TableHead scope="col">Amount</TableHead>
                <TableHead scope="col">Fee rate</TableHead>
                <TableHead scope="col">Status</TableHead>
                <TableHead scope="col">Created</TableHead>
                <TableHead scope="col"><span className="sr-only">Actions</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {settlements.map(s => (
                <TableRow key={s.id}>
                  <TableCell className="font-mono text-xs">{s.transactionId}</TableCell>
                  <TableCell className="font-semibold tabular-nums">{fmtCurrency(s.amount)}</TableCell>
                  <TableCell className="tabular-nums">{(s.feeRate * 100).toFixed(2)}%</TableCell>
                  <TableCell><StatusBadge status={s.status} /></TableCell>
                  <TableCell className="text-xs text-muted-foreground tabular-nums">{fmtDate(s.createdAt)}</TableCell>
                  <TableCell>
                    {s.status === "held" && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-9 min-h-9 text-xs"
                        onClick={() => setSettlementToRelease(s)}
                        disabled={releaseMutation.isPending}
                        aria-label={`Release settlement ${s.transactionId} from escrow`}
                      >
                        Release
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <ConfirmDialog
        open={!!settlementToRelease}
        onOpenChange={(open) => !open && setSettlementToRelease(null)}
        title="Release settlement from escrow?"
        description={
          settlementToRelease
            ? `Release ${fmtCurrency(settlementToRelease.amount)} for transaction ${settlementToRelease.transactionId}? Funds will move out of escrow and cannot be recalled here.`
            : ""
        }
        confirmLabel="Release funds"
        variant="destructive"
        onConfirm={() => settlementToRelease && releaseMutation.mutate(settlementToRelease.id)}
        isLoading={releaseMutation.isPending}
      />
    </div>
  );
}

// ─── Ledger Tab ───────────────────────────────────────────────────────────────

function LedgerTab() {
  const { data, isLoading } = useQuery({
    queryKey: ["/api/fees/ledger"],
    queryFn: async () => {
      const res = await fetch("/api/fees/ledger?limit=100", { credentials: "include" });
      return res.json();
    },
  });

  const entries: LedgerEntry[] = data?.entries ?? [];

  return (
    <div className="space-y-4">
      {isLoading ? (
        <div className="space-y-2" role="status" aria-live="polite">
          <span className="sr-only">Loading ledger…</span>
          {[1,2,3,4,5].map(i => <Skeleton key={i} className="h-12" />)}
        </div>
      ) : entries.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <FileText className="w-10 h-10 mx-auto mb-2 text-muted-foreground" aria-hidden="true" />
            <p className="text-muted-foreground">No ledger entries yet.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-md border" role="region" aria-label="Fee ledger" tabIndex={0}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Date</TableHead>
                <TableHead scope="col">Type</TableHead>
                <TableHead scope="col">Reference</TableHead>
                <TableHead scope="col">Description</TableHead>
                <TableHead scope="col" className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map(e => (
                <TableRow key={e.id}>
                  <TableCell className="text-xs text-muted-foreground tabular-nums">{fmtDate(e.createdAt)}</TableCell>
                  <TableCell><StatusBadge status={e.type} /></TableCell>
                  <TableCell className="font-mono text-xs">{e.reference}</TableCell>
                  <TableCell className="text-sm">{e.description}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{fmtCurrency(e.amount)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

// ─── Payouts Tab ──────────────────────────────────────────────────────────────

function TriggerPayoutDialog({ onSuccess }: { onSuccess: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ amount: "", bankAccountId: "", note: "" });
  const amountId = useId();
  const bankId = useId();
  const noteId = useId();

  const triggerMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/fees/payouts/trigger", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: parseFloat(form.amount), bankAccountId: form.bankAccountId, note: form.note }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Payout triggered", description: "Processing in background." });
      setOpen(false);
      setForm({ amount: "", bankAccountId: "", note: "" });
      onSuccess();
    },
    onError: (e: any) =>
      toast({
        title: "Couldn't trigger payout",
        description: `${e.message} — no funds were moved. Your escrow balance is unchanged.`,
        variant: "destructive",
      }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="min-h-9">
          <Send className="w-4 h-4 mr-1" aria-hidden="true" /> Trigger payout
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Trigger manual payout</DialogTitle></DialogHeader>
        <form
          className="space-y-4 pt-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (triggerMutation.isPending) return;
            triggerMutation.mutate();
          }}
        >
          <div>
            <Label htmlFor={amountId}>
              Amount ($) <span className="text-destructive" aria-label="required">*</span>
            </Label>
            <Input
              id={amountId}
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              placeholder="5000"
              value={form.amount}
              onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
            />
          </div>
          <div>
            <Label htmlFor={bankId}>
              Bank account ID <span className="text-destructive" aria-label="required">*</span>
            </Label>
            <Input
              id={bankId}
              placeholder="ba_1234567890"
              value={form.bankAccountId}
              onChange={e => setForm(f => ({ ...f, bankAccountId: e.target.value }))}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="font-mono"
            />
          </div>
          <div>
            <Label htmlFor={noteId}>Note (optional)</Label>
            <Input
              id={noteId}
              placeholder="Monthly payout"
              value={form.note}
              onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
            />
          </div>
          <Button
            type="submit"
            className="w-full min-h-11"
            disabled={triggerMutation.isPending || !form.amount || !form.bankAccountId}
          >
            {triggerMutation.isPending ? "Processing…" : "Confirm payout"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SchedulePanel() {
  const { toast } = useToast();
  const [frequency, setFrequency] = useState("weekly");
  const [minAmount, setMinAmount] = useState("100");
  const [enabled, setEnabled] = useState(true);
  const frequencyId = useId();
  const minAmountId = useId();
  const enabledId = useId();

  const scheduleMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/fees/payouts/schedule", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ frequency, minimumAmount: parseFloat(minAmount), enabled }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      return res.json();
    },
    onSuccess: () => toast({ title: "Auto-payout schedule saved." }),
    onError: (e: any) =>
      toast({
        title: "Couldn't save schedule",
        description: `${e.message} — the auto-payout schedule is unchanged.`,
        variant: "destructive",
      }),
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Settings className="w-4 h-4 text-primary" aria-hidden="true" /> Auto-payout schedule
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <Label htmlFor={frequencyId} className="text-xs">Frequency</Label>
            <Select value={frequency} onValueChange={setFrequency}>
              <SelectTrigger id={frequencyId} className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="daily">Daily — payouts every business day</SelectItem>
                <SelectItem value="weekly">Weekly — payouts every Monday</SelectItem>
                <SelectItem value="monthly">Monthly — payouts on the 1st</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor={minAmountId} className="text-xs">Min amount ($)</Label>
            <Input
              id={minAmountId}
              className="h-9"
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              value={minAmount}
              onChange={e => setMinAmount(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor={enabledId} className="text-xs">Enabled</Label>
            <Select value={enabled ? "true" : "false"} onValueChange={v => setEnabled(v === "true")}>
              <SelectTrigger id={enabledId} className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="true">Enabled — auto-pay out when balance hits min</SelectItem>
                <SelectItem value="false">Disabled — escrow held until manual release</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <Button
          size="sm"
          onClick={() => scheduleMutation.mutate()}
          disabled={scheduleMutation.isPending}
          className="min-h-9"
        >
          {scheduleMutation.isPending ? "Saving…" : "Save schedule"}
        </Button>
      </CardContent>
    </Card>
  );
}

function PayoutsTab() {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["/api/fees/payouts"],
    queryFn: async () => {
      const res = await fetch("/api/fees/payouts?limit=50", { credentials: "include" });
      return res.json();
    },
  });

  const payouts: Payout[] = data?.payouts ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          <span className="tabular-nums">{payouts.length}</span> payout{payouts.length === 1 ? "" : "s"}
        </p>
        <TriggerPayoutDialog onSuccess={() => queryClient.invalidateQueries({ queryKey: ["/api/fees/payouts"] })} />
      </div>

      <SchedulePanel />

      {isLoading ? (
        <div className="space-y-2" role="status" aria-live="polite">
          <span className="sr-only">Loading payouts…</span>
          {[1,2,3].map(i => <Skeleton key={i} className="h-12" />)}
        </div>
      ) : payouts.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <ArrowUpRight className="w-10 h-10 mx-auto mb-2 text-muted-foreground" aria-hidden="true" />
            <p className="text-muted-foreground">No payouts yet.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-md border" role="region" aria-label="Payouts" tabIndex={0}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Date</TableHead>
                <TableHead scope="col">Amount</TableHead>
                <TableHead scope="col">Account</TableHead>
                <TableHead scope="col">Status</TableHead>
                <TableHead scope="col">Note</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payouts.map(p => (
                <TableRow key={p.id}>
                  <TableCell className="text-xs text-muted-foreground tabular-nums">{fmtDate(p.triggeredAt)}</TableCell>
                  <TableCell className="font-semibold tabular-nums">{fmtCurrency(p.amount)}</TableCell>
                  <TableCell className="font-mono text-xs">{p.bankAccountId}</TableCell>
                  <TableCell><StatusBadge status={p.status} /></TableCell>
                  <TableCell className="text-xs text-muted-foreground">{p.note ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function FeeDashboardPage() {
  useDocumentTitle("Fee dashboard");
  const { data: analyticsData, isLoading: analyticsLoading } = useQuery({
    queryKey: ["/api/fees/analytics"],
    queryFn: async () => {
      const res = await fetch("/api/fees/analytics", { credentials: "include" });
      return res.json();
    },
  });

  const analytics: FeeAnalytics | null = analyticsData?.analytics ?? null;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <DollarSign className="w-7 h-7 text-primary" aria-hidden="true" /> Fee dashboard
        </h1>
        <p className="text-muted-foreground mt-1">
          Fee analytics, settlement management, ledger, and payout history.
        </p>
      </div>

      {/* Summary Cards */}
      <SummaryCards analytics={analytics} loading={analyticsLoading} />

      {/* Analytics Chart */}
      <AnalyticsChart analytics={analytics} />

      {/* Tabs */}
      <Tabs defaultValue="settlements">
        <TabsList>
          <TabsTrigger value="settlements">Settlements</TabsTrigger>
          {/* eslint-disable-next-line acreos/no-founder-codenames-in-customer-jsx -- "Ledger" here is the financial-accounting noun (general ledger), not the codename for the Finance agent */}
          <TabsTrigger value="ledger">Ledger</TabsTrigger>
          <TabsTrigger value="payouts">Payouts</TabsTrigger>
        </TabsList>
        <TabsContent value="settlements" className="mt-4">
          <SettlementsTab />
        </TabsContent>
        <TabsContent value="ledger" className="mt-4">
          <LedgerTab />
        </TabsContent>
        <TabsContent value="payouts" className="mt-4">
          <PayoutsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
