import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { useToast } from "@/hooks/use-toast";
import {
  DollarSign, Clock, TrendingUp, ArrowUpRight, CheckCircle2, RefreshCw,
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

function fmtCurrency(val: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(val);
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    pending: "bg-yellow-100 text-yellow-800",
    held: "bg-blue-100 text-blue-800",
    released: "bg-green-100 text-green-800",
    processing: "bg-purple-100 text-purple-800",
    completed: "bg-green-100 text-green-800",
    failed: "bg-red-100 text-red-800",
  };
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${map[status] ?? "bg-gray-100 text-gray-600"}`}>
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
    { label: "Total Fees Collected", value: analytics?.totalCollected, icon: DollarSign, color: "text-green-500" },
    { label: "Pending in Escrow", value: analytics?.pendingInEscrow, icon: Clock, color: "text-yellow-500" },
    { label: "Paid Out", value: analytics?.paidOut, icon: CheckCircle2, color: "text-blue-500" },
    { label: "This Month", value: analytics?.thisMonth, icon: TrendingUp, color: "text-purple-500" },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {cards.map((card) => (
        <Card key={card.label}>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-1">
              <p className="text-sm text-muted-foreground">{card.label}</p>
              <card.icon className={`w-4 h-4 ${card.color}`} />
            </div>
            {loading ? (
              <Skeleton className="h-7 w-24 mt-1" />
            ) : (
              <p className="text-2xl font-bold">{fmtCurrency(card.value ?? 0)}</p>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ─── Analytics Chart ─────────────────────────────────────────────────────────

function AnalyticsChart({ analytics }: { analytics: FeeAnalytics | null }) {
  // Build bar data from summary fields
  const data = analytics ? [
    { name: "Collected", value: analytics.totalCollected },
    { name: "In Escrow", value: analytics.pendingInEscrow },
    { name: "Paid Out", value: analytics.paidOut },
    { name: "This Month", value: analytics.thisMonth },
  ] : [];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-primary" /> Fee Breakdown
        </CardTitle>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <Skeleton className="h-48 w-full" />
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={data} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
              <XAxis dataKey="name" tick={{ fontSize: 12 }} />
              <YAxis tickFormatter={v => `$${(v / 1000).toFixed(0)}K`} tick={{ fontSize: 11 }} width={60} />
              <Tooltip formatter={(val: number) => fmtCurrency(val)} />
              <Bar dataKey="value" fill="#6366f1" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
        {analytics && (
          <div className="mt-3 flex gap-4 text-xs text-muted-foreground">
            <span>Avg Rate: <strong>{(analytics.avgFeeRate * 100).toFixed(2)}%</strong></span>
            <span>Transactions: <strong>{analytics.transactionCount.toLocaleString()}</strong></span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Settlements Tab ──────────────────────────────────────────────────────────

function SettlementsTab() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<string>("");

  const { data, isLoading } = useQuery({
    queryKey: ["/api/fees/settlements", statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: "50", offset: "0" });
      if (statusFilter) params.set("status", statusFilter);
      const res = await fetch(`/api/fees/settlements?${params}`, { credentials: "include" });
      return res.json();
    },
  });

  const settlements: Settlement[] = data?.settlements ?? [];

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
      toast({ title: "Settlement released from escrow" });
      queryClient.invalidateQueries({ queryKey: ["/api/fees/settlements"] });
      queryClient.invalidateQueries({ queryKey: ["/api/fees/analytics"] });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-44">
          <Label className="text-xs">Status</Label>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-8"><SelectValue placeholder="All statuses" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="">All</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="held">Held in Escrow</SelectItem>
              <SelectItem value="released">Released</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <p className="text-xs text-muted-foreground ml-auto self-end pb-1">{settlements.length} results</p>
      </div>

      {isLoading ? (
        <div className="space-y-2">{[1,2,3,4,5].map(i => <Skeleton key={i} className="h-12" />)}</div>
      ) : settlements.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Wallet className="w-10 h-10 mx-auto mb-2 text-muted-foreground" />
            <p className="text-muted-foreground">No settlements found</p>
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Transaction</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Fee Rate</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {settlements.map(s => (
                <TableRow key={s.id}>
                  <TableCell className="font-mono text-xs">{s.transactionId}</TableCell>
                  <TableCell className="font-semibold">{fmtCurrency(s.amount)}</TableCell>
                  <TableCell>{(s.feeRate * 100).toFixed(2)}%</TableCell>
                  <TableCell><StatusBadge status={s.status} /></TableCell>
                  <TableCell className="text-xs text-muted-foreground">{fmtDate(s.createdAt)}</TableCell>
                  <TableCell>
                    {s.status === "held" && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={() => releaseMutation.mutate(s.id)}
                        disabled={releaseMutation.isPending}
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
        <div className="space-y-2">{[1,2,3,4,5].map(i => <Skeleton key={i} className="h-12" />)}</div>
      ) : entries.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <FileText className="w-10 h-10 mx-auto mb-2 text-muted-foreground" />
            <p className="text-muted-foreground">No ledger entries yet</p>
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map(e => (
                <TableRow key={e.id}>
                  <TableCell className="text-xs text-muted-foreground">{fmtDate(e.createdAt)}</TableCell>
                  <TableCell><StatusBadge status={e.type} /></TableCell>
                  <TableCell className="font-mono text-xs">{e.reference}</TableCell>
                  <TableCell className="text-sm">{e.description}</TableCell>
                  <TableCell className="text-right font-semibold">{fmtCurrency(e.amount)}</TableCell>
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
      toast({ title: "Payout triggered", description: "Processing in background" });
      setOpen(false);
      setForm({ amount: "", bankAccountId: "", note: "" });
      onSuccess();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><Send className="w-4 h-4 mr-1" /> Trigger Payout</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Trigger Manual Payout</DialogTitle></DialogHeader>
        <div className="space-y-4 pt-2">
          <div>
            <Label>Amount ($)</Label>
            <Input type="number" placeholder="5000" value={form.amount}
              onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
          </div>
          <div>
            <Label>Bank Account ID</Label>
            <Input placeholder="ba_1234567890" value={form.bankAccountId}
              onChange={e => setForm(f => ({ ...f, bankAccountId: e.target.value }))} />
          </div>
          <div>
            <Label>Note (optional)</Label>
            <Input placeholder="Monthly payout" value={form.note}
              onChange={e => setForm(f => ({ ...f, note: e.target.value }))} />
          </div>
          <Button className="w-full" onClick={() => triggerMutation.mutate()}
            disabled={triggerMutation.isPending || !form.amount || !form.bankAccountId}>
            {triggerMutation.isPending ? "Processing…" : "Confirm Payout"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SchedulePanel() {
  const { toast } = useToast();
  const [frequency, setFrequency] = useState("weekly");
  const [minAmount, setMinAmount] = useState("100");
  const [enabled, setEnabled] = useState(true);

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
    onSuccess: () => toast({ title: "Auto-payout schedule saved" }),
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Settings className="w-4 h-4 text-primary" /> Auto-Payout Schedule
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-3 gap-3">
          <div>
            <Label className="text-xs">Frequency</Label>
            <Select value={frequency} onValueChange={setFrequency}>
              <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="daily">Daily</SelectItem>
                <SelectItem value="weekly">Weekly</SelectItem>
                <SelectItem value="monthly">Monthly</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Min Amount ($)</Label>
            <Input className="h-8" type="number" value={minAmount}
              onChange={e => setMinAmount(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Enabled</Label>
            <Select value={enabled ? "true" : "false"} onValueChange={v => setEnabled(v === "true")}>
              <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="true">Enabled</SelectItem>
                <SelectItem value="false">Disabled</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <Button size="sm" onClick={() => scheduleMutation.mutate()} disabled={scheduleMutation.isPending}>
          {scheduleMutation.isPending ? "Saving…" : "Save Schedule"}
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
        <p className="text-sm text-muted-foreground">{payouts.length} payouts</p>
        <TriggerPayoutDialog onSuccess={() => queryClient.invalidateQueries({ queryKey: ["/api/fees/payouts"] })} />
      </div>

      <SchedulePanel />

      {isLoading ? (
        <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-12" />)}</div>
      ) : payouts.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <ArrowUpRight className="w-10 h-10 mx-auto mb-2 text-muted-foreground" />
            <p className="text-muted-foreground">No payouts yet</p>
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Account</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Note</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payouts.map(p => (
                <TableRow key={p.id}>
                  <TableCell className="text-xs text-muted-foreground">{fmtDate(p.triggeredAt)}</TableCell>
                  <TableCell className="font-semibold">{fmtCurrency(p.amount)}</TableCell>
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
          <DollarSign className="w-7 h-7 text-primary" /> Fee Dashboard
        </h1>
        <p className="text-muted-foreground mt-1">
          Fee analytics, settlement management, ledger, and payout history
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
