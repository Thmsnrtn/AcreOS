/**
 * /earnest-money — EMD inspection-period dashboard (W-2).
 *
 * Trey: "EMD becomes non-refundable in 48 hours — confirm inspection
 * results or back out. Saves me $1,000 per blown deal."
 *
 * Top of page surfaces the at-risk view (currently held EMD with
 * refundable-until ≤ 7 days). Below, the full org-wide ledger of all
 * EMD holds with status filter + per-row terminal action buttons
 * (Release / Refund / Forfeit).
 */

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Banknote, AlertTriangle, Plus } from "lucide-react";

import { PageShell } from "@/components/page-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/empty-state";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";

type Status =
  | "pending"
  | "held"
  | "non_refundable"
  | "released_to_seller"
  | "refunded_to_buyer"
  | "forfeited";

interface Hold {
  id: string;
  dealId: number | null;
  propertyId: number | null;
  amountCents: number;
  titleCompany: string | null;
  referenceNumber: string | null;
  depositedAt: string;
  inspectionPeriodDays: number;
  refundableUntilAt: string;
  status: Status;
  statusChangedAt: string | null;
  finalDispositionAmountCents: number | null;
  notes: string | null;
}

interface AtRiskResponse {
  holds: Hold[];
  asOf: string;
  horizonIso: string;
  withinDays: number;
  totalAtRiskCents: number;
}

const STATUS_LABELS: Record<Status, string> = {
  pending: "Pending",
  held: "Held — refundable",
  non_refundable: "Non-refundable",
  released_to_seller: "Released",
  refunded_to_buyer: "Refunded",
  forfeited: "Forfeited",
};

function fmtUsd(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Math.round(cents / 100));
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function daysFromToday(iso: string): number {
  const d = new Date(iso);
  return Math.ceil((d.getTime() - Date.now()) / 86_400_000);
}

export default function EarnestMoneyPage() {
  useDocumentTitle("Earnest money — AcreOS");
  const [statusFilter, setStatusFilter] = useState<string>("active");
  const [createOpen, setCreateOpen] = useState(false);

  const atRisk = useQuery<AtRiskResponse>({
    queryKey: ["/api/earnest-money/at-risk"],
    queryFn: async () => {
      const res = await fetch("/api/earnest-money/at-risk?withinDays=7", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return res.json();
    },
  });

  const list = useQuery<{ holds: Hold[] }>({
    queryKey: ["/api/earnest-money", statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter !== "all" && statusFilter !== "active") params.set("status", statusFilter);
      const res = await fetch(`/api/earnest-money?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return res.json();
    },
  });

  let holds = list.data?.holds ?? [];
  if (statusFilter === "active") {
    holds = holds.filter((h) => h.status === "held" || h.status === "pending" || h.status === "non_refundable");
  }

  return (
    <PageShell label="Earnest money">
      <div className="flex items-start justify-between mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Banknote className="w-6 h-6 text-primary" aria-hidden="true" />
            Earnest money
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Per-deal EMD lifecycle. Inspection-period timer flags holds becoming
            non-refundable so you can decide to proceed or back out before
            losing the deposit.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} data-testid="record-emd-button">
          <Plus className="w-4 h-4 mr-1.5" aria-hidden="true" />
          Record EMD
        </Button>
      </div>

      {/* At-risk banner — Trey's specific request. */}
      {atRisk.data && atRisk.data.holds.length > 0 && (
        <Card className="mb-6 border-acr-warning/30 bg-acr-warning/5">
          <div className="p-5">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="w-5 h-5 text-acr-warning" aria-hidden="true" />
              <h2 className="text-sm font-semibold">
                {atRisk.data.holds.length} EMD{atRisk.data.holds.length === 1 ? "" : "s"} becoming non-refundable in ≤ 7 days
              </h2>
              <span className="ml-auto text-sm font-mono">{fmtUsd(atRisk.data.totalAtRiskCents)} at risk</span>
            </div>
            <ul className="space-y-1 text-sm">
              {atRisk.data.holds.map((h) => {
                const days = daysFromToday(h.refundableUntilAt);
                return (
                  <li key={h.id} className="flex items-center justify-between gap-3">
                    <span className="font-mono text-xs">
                      {h.referenceNumber ?? h.id.slice(0, 8)} · {h.titleCompany ?? "—"}
                    </span>
                    <span className="text-xs text-muted-foreground">{fmtUsd(h.amountCents)}</span>
                    <span className={`text-xs font-semibold ${days < 0 ? "text-acr-neg" : days <= 2 ? "text-acr-neg" : "text-acr-warning"}`}>
                      {days < 0 ? `${Math.abs(days)}d overdue` : days === 0 ? "today" : `${days}d left`}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </Card>
      )}

      {/* Filter bar */}
      <div className="flex items-center gap-3 mb-4">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Active (pending/held/non-ref)</SelectItem>
            <SelectItem value="all">All statuses</SelectItem>
            {Object.entries(STATUS_LABELS).map(([k, l]) => (
              <SelectItem key={k} value={k}>{l}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {list.isLoading ? (
        <Card><div className="p-5"><Skeleton className="h-32" /></div></Card>
      ) : holds.length === 0 ? (
        <EmptyState
          icon={Banknote}
          title="No EMD holds"
          description="Record an earnest-money deposit when you wire to title. The inspection-period timer flips status to non-refundable on day N+1."
          actionLabel="Record EMD"
          actionIcon={Plus}
          onAction={() => setCreateOpen(true)}
        />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted-foreground bg-muted/30">
                  <th className="px-3 py-2.5 text-left font-medium">Title co.</th>
                  <th className="px-3 py-2.5 text-left font-medium">Reference</th>
                  <th className="px-3 py-2.5 text-right font-medium">Amount</th>
                  <th className="px-3 py-2.5 text-left font-medium">Deposited</th>
                  <th className="px-3 py-2.5 text-left font-medium">Refundable until</th>
                  <th className="px-3 py-2.5 text-left font-medium">Status</th>
                  <th className="px-3 py-2.5 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {holds.map((h) => {
                  const days = h.status === "held" ? daysFromToday(h.refundableUntilAt) : null;
                  return (
                    <tr key={h.id} className="border-t border-border/40">
                      <td className="px-3 py-2.5 text-xs">{h.titleCompany ?? "—"}</td>
                      <td className="px-3 py-2.5 text-xs font-mono">{h.referenceNumber ?? h.id.slice(0, 8)}</td>
                      <td className="px-3 py-2.5 text-right font-mono">{fmtUsd(h.amountCents)}</td>
                      <td className="px-3 py-2.5 text-xs">{fmtDate(h.depositedAt)}</td>
                      <td className="px-3 py-2.5 text-xs">
                        {fmtDate(h.refundableUntilAt)}
                        {days !== null && (
                          <span className={`ml-1.5 text-[10px] ${days < 0 ? "text-acr-neg font-semibold" : days <= 2 ? "text-acr-warning" : "text-muted-foreground"}`}>
                            ({days < 0 ? `${Math.abs(days)}d overdue` : days === 0 ? "today" : `${days}d`})
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-xs">{STATUS_LABELS[h.status]}</td>
                      <td className="px-3 py-2.5 text-right">
                        {(h.status === "held" || h.status === "non_refundable" || h.status === "pending") && (
                          <TerminalActions holdId={h.id} amountCents={h.amountCents} />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <RecordEmdDialog open={createOpen} onOpenChange={setCreateOpen} />
    </PageShell>
  );
}

function TerminalActions({ holdId, amountCents }: { holdId: string; amountCents: number }) {
  const { toast } = useToast();
  const action = useMutation({
    mutationFn: async (kind: "release" | "refund" | "forfeit") => {
      const csrfToken = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/)?.[1] || "";
      const res = await fetch(`/api/earnest-money/${holdId}/${kind}`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": decodeURIComponent(csrfToken),
        },
        body: JSON.stringify({ finalDispositionAmountCents: amountCents }),
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/earnest-money"] });
      queryClient.invalidateQueries({ queryKey: ["/api/earnest-money/at-risk"] });
    },
    onError: (err: any) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  return (
    <div className="flex items-center gap-1 justify-end">
      <Button variant="ghost" size="sm" className="h-7 text-xs text-acr-pos" onClick={() => action.mutate("release")} disabled={action.isPending}>
        Released
      </Button>
      <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" onClick={() => action.mutate("refund")} disabled={action.isPending}>
        Refunded
      </Button>
      <Button variant="ghost" size="sm" className="h-7 text-xs text-acr-neg" onClick={() => action.mutate("forfeit")} disabled={action.isPending}>
        Forfeit
      </Button>
    </div>
  );
}

function RecordEmdDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (b: boolean) => void }) {
  const { toast } = useToast();
  const [amount, setAmount] = useState("");
  const [titleCompany, setTitleCompany] = useState("");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [depositedAt, setDepositedAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [inspectionDays, setInspectionDays] = useState("7");
  const [dealId, setDealId] = useState("");

  const reset = () => {
    setAmount(""); setTitleCompany(""); setReferenceNumber("");
    setDepositedAt(new Date().toISOString().slice(0, 10));
    setInspectionDays("7"); setDealId("");
  };

  const submit = useMutation({
    mutationFn: async () => {
      const csrfToken = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/)?.[1] || "";
      const amountCents = Math.round(parseFloat(amount.replace(/[$,\s]/g, "")) * 100);
      const res = await fetch("/api/earnest-money", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": decodeURIComponent(csrfToken),
        },
        body: JSON.stringify({
          amountCents,
          titleCompany: titleCompany.trim() || undefined,
          referenceNumber: referenceNumber.trim() || undefined,
          depositedAt,
          inspectionPeriodDays: parseInt(inspectionDays, 10),
          dealId: dealId ? parseInt(dealId, 10) : undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || "Failed");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "EMD recorded" });
      queryClient.invalidateQueries({ queryKey: ["/api/earnest-money"] });
      queryClient.invalidateQueries({ queryKey: ["/api/earnest-money/at-risk"] });
      reset();
      onOpenChange(false);
    },
    onError: (err: any) => toast({ title: "Couldn't record", description: err.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record earnest-money deposit</DialogTitle>
          <DialogDescription>
            Inspection-period clock starts on the deposit date. Refundable until
            day N+1, non-refundable thereafter.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="emd-amount" className="text-xs">Amount $ *</Label>
              <Input id="emd-amount" inputMode="decimal" placeholder="1000" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="emd-deal" className="text-xs">Deal ID (optional)</Label>
              <Input id="emd-deal" inputMode="numeric" value={dealId} onChange={(e) => setDealId(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="emd-title" className="text-xs">Title company</Label>
            <Input id="emd-title" placeholder="Old Republic — Phoenix" value={titleCompany} onChange={(e) => setTitleCompany(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="emd-ref" className="text-xs">Reference (wire/check)</Label>
              <Input id="emd-ref" value={referenceNumber} onChange={(e) => setReferenceNumber(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="emd-days" className="text-xs">Inspection period (days)</Label>
              <Input id="emd-days" inputMode="numeric" value={inspectionDays} onChange={(e) => setInspectionDays(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="emd-deposited" className="text-xs">Deposited *</Label>
            <Input id="emd-deposited" type="date" value={depositedAt} onChange={(e) => setDepositedAt(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { reset(); onOpenChange(false); }}>Cancel</Button>
          <Button onClick={() => submit.mutate()} disabled={!amount || !depositedAt || submit.isPending}>
            {submit.isPending ? "Recording…" : "Record EMD"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
