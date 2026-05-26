/**
 * /redemption-clock — Marcus's deal-killer surface.
 *
 * Lists every active tax certificate sorted by days-to-deadline ascending.
 * Each row shows: parcel (state/county/APN), sale date, deadline, days
 * remaining, principal + accrued interest = current redemption amount,
 * applied rate (especially for Florida bid-down), and a status pill.
 *
 * Marcus: "Cards with: parcel, certificate number, redemption date, days
 * remaining, current redemption amount (principal + statutory interest
 * accrued), redeemer-of-record. Sort by days-remaining ascending."
 *
 * Per his §8 deal-killer test: surfaces a "preliminary math" banner when
 * any visible cert is in a state whose rules haven't been attorney-reviewed
 * yet. The banner stays until TD-3 lands the reviewed all-50-states database.
 */

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  Clock,
  AlertTriangle,
  Plus,
  CheckCircle2,
  ShieldAlert,
} from "lucide-react";

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
import { useIsMobile } from "@/hooks/use-mobile";
import { queryClient } from "@/lib/queryClient";

interface Certificate {
  id: string;
  state: string;
  county: string;
  apn: string;
  certificateNumber: string | null;
  saleType: "lien" | "deed" | "redeemable_deed";
  saleDate: string;
  purchaseAmountCents: number;
  bidDownRateBps: number | null;
  ownerName: string | null;
  redemptionDeadline: string;
  ownerOccupiedAtSale: boolean | null;
  status: "active" | "redeemed" | "expired_to_deed" | "deed_obtained" | "cancelled";
  redeemedAt: string | null;
  redeemedAmountCents: number | null;
  // Server-decorated:
  currentRedemptionAmountCents: number;
  currentInterestCents: number;
  appliedRateBps: number;
  modelUsed: string;
  preliminary: boolean;
  daysRemaining: number;
}

interface ListResponse {
  certificates: Certificate[];
  asOf: string;
  rulesAttorneyReviewed: boolean;
}

interface SummaryResponse {
  asOf: string;
  activeCount: number;
  overdueCount: number;
  within30Count: number;
  within90Count: number;
  totalCapitalCents: number;
}

function fmtUsd(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

function fmtDate(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function fmtPct(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}

function dayCellTone(days: number): string {
  if (days < 0) return "text-acr-neg font-bold";
  if (days <= 30) return "text-acr-warning font-semibold";
  if (days <= 90) return "text-foreground";
  return "text-muted-foreground";
}

const STATUS_LABELS: Record<Certificate["status"], string> = {
  active: "Active",
  redeemed: "Redeemed",
  expired_to_deed: "Expired — apply for deed",
  deed_obtained: "Deed obtained",
  cancelled: "Cancelled",
};

export default function RedemptionClockPage() {
  useDocumentTitle("Redemption clock — AcreOS");
  const [, navigate] = useLocation();
  const [statusFilter, setStatusFilter] = useState<string>("active");
  const [stateFilter, setStateFilter] = useState<string>("");
  const [createOpen, setCreateOpen] = useState(false);
  const { isMobile } = useIsMobile();

  const certsQuery = useQuery<ListResponse>({
    queryKey: ["/api/tax-certificates", statusFilter, stateFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter) params.set("status", statusFilter);
      if (stateFilter) params.set("state", stateFilter);
      const res = await fetch(`/api/tax-certificates?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return res.json();
    },
  });

  const summaryQuery = useQuery<SummaryResponse>({
    queryKey: ["/api/tax-certificates/dashboard/summary"],
    queryFn: async () => {
      const res = await fetch("/api/tax-certificates/dashboard/summary", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return res.json();
    },
  });

  const certs = certsQuery.data?.certificates ?? [];
  const summary = summaryQuery.data;
  const anyPreliminary = certs.some((c) => c.preliminary);

  return (
    <PageShell label="Redemption clock">
      <div className="flex items-start justify-between mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Redemption clock</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Every active tax certificate sorted by days-to-deadline. Running
            redemption amount = principal + statutory interest as of today,
            computed per the state's interest model.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} data-testid="add-certificate-button">
          <Plus className="w-4 h-4 mr-1.5" aria-hidden="true" />
          Add certificate
        </Button>
      </div>

      {/* Preliminary-math banner — Marcus's §8 deal-killer guard. */}
      {anyPreliminary && (
        <Card className="mb-6 border-acr-warning/30 bg-acr-warning/5">
          <div className="p-4 flex items-start gap-3">
            <ShieldAlert className="w-5 h-5 text-acr-warning shrink-0 mt-0.5" aria-hidden="true" />
            <div className="flex-1">
              <p className="text-sm font-semibold">Per-state math is preliminary.</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Some certificates use rules that haven't been attorney-reviewed.
                Confirm any redemption quote with the county clerk before relying
                on the dollar figure. Attorney review for the top 15 states ships
                in TD-3.
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
          <SummaryCard label="Active" value={summary.activeCount} />
          <SummaryCard label="Overdue" value={summary.overdueCount} tone={summary.overdueCount > 0 ? "neg" : undefined} />
          <SummaryCard label="≤ 30 days" value={summary.within30Count} tone={summary.within30Count > 0 ? "warn" : undefined} />
          <SummaryCard label="≤ 90 days" value={summary.within90Count} />
          <SummaryCard label="Capital deployed" value={fmtUsd(summary.totalCapitalCents)} />
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3 mb-6">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-44" data-testid="status-filter"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="redeemed">Redeemed</SelectItem>
            <SelectItem value="expired_to_deed">Expired — apply for deed</SelectItem>
            <SelectItem value="deed_obtained">Deed obtained</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
        <Input
          className="w-32"
          maxLength={2}
          placeholder="State"
          value={stateFilter}
          onChange={(e) => setStateFilter(e.target.value.toUpperCase())}
        />
      </div>

      {certsQuery.isLoading ? (
        <Card><div className="p-5"><Skeleton className="h-40" /></div></Card>
      ) : certs.length === 0 ? (
        <EmptyState
          icon={Clock}
          title="No certificates yet"
          description="Add a tax certificate or deed to start tracking the redemption clock. The math runs nightly and surfaces deadlines closest to expiry first."
          actionLabel="Add certificate"
          actionIcon={Plus}
          onAction={() => setCreateOpen(true)}
        />
      ) : isMobile ? (
        // 2026-05-26 mobile audit fix: the horizontal-scroll table is
        // unusable on a phone. On mobile we render each certificate as
        // a single-column big card so days-remaining + redemption-amount
        // are scannable at a glance.
        <div className="space-y-2">
          {certs.map((c) => {
            const tone =
              c.daysRemaining < 0
                ? "border-rose-500/60"
                : c.daysRemaining <= 7
                  ? "border-rose-400/60"
                  : c.daysRemaining <= 30
                    ? "border-amber-400/60"
                    : "";
            return (
              <Card
                key={c.id}
                role="button"
                tabIndex={0}
                onClick={() => navigate(`/redemption-clock/${c.id}`)}
                className={`p-4 cursor-pointer active:bg-muted/50 ${tone}`}
                data-testid={`certificate-card-${c.id}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-mono text-base font-semibold truncate">
                      {c.apn}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {c.state} · {c.county} · {c.saleType.replace("_", " ")}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div
                      className={`text-2xl font-semibold tabular-nums ${
                        c.daysRemaining < 0
                          ? "text-rose-600 dark:text-rose-400"
                          : c.daysRemaining <= 7
                            ? "text-rose-600 dark:text-rose-400"
                            : c.daysRemaining <= 30
                              ? "text-amber-600 dark:text-amber-400"
                              : ""
                      }`}
                    >
                      {c.daysRemaining < 0 ? `${Math.abs(c.daysRemaining)}d` : `${c.daysRemaining}d`}
                    </div>
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      {c.daysRemaining < 0 ? "overdue" : "to deadline"}
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 mt-3 text-xs">
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      Deadline
                    </div>
                    <div className="font-medium tabular-nums">{fmtDate(c.redemptionDeadline)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      Rate
                    </div>
                    <div className={`font-mono tabular-nums ${c.preliminary ? "text-amber-600 dark:text-amber-400" : ""}`}>
                      {fmtPct(c.appliedRateBps)}{c.preliminary && "*"}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      Principal
                    </div>
                    <div className="font-mono tabular-nums">{fmtUsd(c.purchaseAmountCents)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      Interest
                    </div>
                    <div className="font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
                      +{fmtUsd(c.currentInterestCents)}
                    </div>
                  </div>
                </div>
                <div className="mt-3 pt-3 border-t border-border/40 flex items-baseline justify-between">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    Total redemption
                  </div>
                  <div className="font-mono text-base font-semibold tabular-nums">
                    {fmtUsd(c.currentRedemptionAmountCents)}
                  </div>
                </div>
              </Card>
            );
          })}
          {anyPreliminary && (
            <div className="px-3 py-2 text-[11px] text-muted-foreground">
              * Rate uses preliminary state-rule data. Verify with the county clerk before quoting a redeemer.
            </div>
          )}
        </div>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted-foreground bg-muted/30">
                  <th className="px-3 py-2.5 text-left font-medium">Parcel</th>
                  <th className="px-3 py-2.5 text-left font-medium">Sale</th>
                  <th className="px-3 py-2.5 text-left font-medium">Deadline</th>
                  <th className="px-3 py-2.5 text-right font-medium">Days</th>
                  <th className="px-3 py-2.5 text-right font-medium">Principal</th>
                  <th className="px-3 py-2.5 text-right font-medium">Interest</th>
                  <th className="px-3 py-2.5 text-right font-medium">Total redemption</th>
                  <th className="px-3 py-2.5 text-right font-medium">Rate</th>
                  <th className="px-3 py-2.5 text-left font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {certs.map((c) => (
                  <tr
                    key={c.id}
                    className="border-t border-border/40 hover:bg-accent/30 cursor-pointer"
                    onClick={() => navigate(`/redemption-clock/${c.id}`)}
                    data-testid={`certificate-row-${c.id}`}
                  >
                    <td className="px-3 py-2.5">
                      <div className="font-medium">{c.state} · {c.county}</div>
                      <div className="text-xs text-muted-foreground font-mono">{c.apn}</div>
                    </td>
                    <td className="px-3 py-2.5 text-xs">
                      <div>{fmtDate(c.saleDate)}</div>
                      <div className="text-muted-foreground capitalize">{c.saleType.replace("_", " ")}</div>
                    </td>
                    <td className="px-3 py-2.5 text-xs">{fmtDate(c.redemptionDeadline)}</td>
                    <td className={`px-3 py-2.5 text-right text-xs ${dayCellTone(c.daysRemaining)}`}>
                      {c.daysRemaining < 0 ? `${Math.abs(c.daysRemaining)} overdue` : `${c.daysRemaining}`}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs">{fmtUsd(c.purchaseAmountCents)}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs text-acr-pos">+{fmtUsd(c.currentInterestCents)}</td>
                    <td className="px-3 py-2.5 text-right font-mono font-semibold">{fmtUsd(c.currentRedemptionAmountCents)}</td>
                    <td className="px-3 py-2.5 text-right text-xs">
                      <span className={c.preliminary ? "text-acr-warning" : ""}>
                        {fmtPct(c.appliedRateBps)}
                      </span>
                      {c.preliminary && <span className="ml-0.5">*</span>}
                    </td>
                    <td className="px-3 py-2.5 text-xs">
                      <span className="capitalize">{STATUS_LABELS[c.status]}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {anyPreliminary && (
            <div className="px-4 py-2 text-[11px] text-muted-foreground border-t border-border/40 bg-muted/20">
              * Rate uses preliminary state-rule data. Verify with the county clerk before quoting a redeemer.
            </div>
          )}
        </Card>
      )}

      <CreateCertificateDialog open={createOpen} onOpenChange={setCreateOpen} />
    </PageShell>
  );
}

function SummaryCard({ label, value, tone }: { label: string; value: string | number; tone?: "neg" | "warn" }) {
  const toneClass = tone === "neg" ? "text-acr-neg" : tone === "warn" ? "text-acr-warning" : "";
  return (
    <Card className="p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-2xl font-semibold tracking-tight mt-1 ${toneClass}`}>{value}</div>
    </Card>
  );
}

function CreateCertificateDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (b: boolean) => void }) {
  const { toast } = useToast();
  const [state, setState] = useState("");
  const [county, setCounty] = useState("");
  const [apn, setApn] = useState("");
  const [certificateNumber, setCertificateNumber] = useState("");
  const [saleType, setSaleType] = useState<"lien" | "deed" | "redeemable_deed">("lien");
  const [saleDate, setSaleDate] = useState("");
  const [purchase, setPurchase] = useState("");
  const [bidDownRate, setBidDownRate] = useState("");
  const [ownerOccupied, setOwnerOccupied] = useState(false);
  const [ownerName, setOwnerName] = useState("");

  const reset = () => {
    setState(""); setCounty(""); setApn(""); setCertificateNumber("");
    setSaleType("lien"); setSaleDate(""); setPurchase("");
    setBidDownRate(""); setOwnerOccupied(false); setOwnerName("");
  };

  const submit = useMutation({
    mutationFn: async () => {
      const csrfToken = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/)?.[1] || "";
      const purchaseCents = Math.round(parseFloat(purchase.replace(/[$,\s]/g, "")) * 100);
      const bidDownBps = bidDownRate ? Math.round(parseFloat(bidDownRate) * 100) : undefined;
      const res = await fetch("/api/tax-certificates", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": decodeURIComponent(csrfToken),
        },
        body: JSON.stringify({
          state: state.toUpperCase(),
          county: county.trim(),
          apn: apn.trim(),
          certificateNumber: certificateNumber.trim() || undefined,
          saleType,
          saleDate,
          purchaseAmountCents: purchaseCents,
          bidDownRateBps: bidDownBps,
          ownerName: ownerName.trim() || undefined,
          ownerOccupiedAtSale: ownerOccupied,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Failed" }));
        throw new Error(err.message || "Failed");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Certificate added", description: "Redemption deadline computed and tracked." });
      queryClient.invalidateQueries({ queryKey: ["/api/tax-certificates"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tax-certificates/dashboard/summary"] });
      reset();
      onOpenChange(false);
    },
    onError: (err: any) => toast({ title: "Couldn't add", description: err.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add tax certificate</DialogTitle>
          <DialogDescription>
            Captures what you bought at the sale. Deadline computes per state
            rules; for Florida bid-down sales, enter the rate you won at.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1">
              <Label htmlFor="cert-state" className="text-xs">State *</Label>
              <Input id="cert-state" maxLength={2} value={state} onChange={(e) => setState(e.target.value.toUpperCase())} />
            </div>
            <div className="col-span-2 space-y-1">
              <Label htmlFor="cert-county" className="text-xs">County *</Label>
              <Input id="cert-county" value={county} onChange={(e) => setCounty(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="cert-apn" className="text-xs">APN / parcel ID *</Label>
              <Input id="cert-apn" className="font-mono" value={apn} onChange={(e) => setApn(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="cert-number" className="text-xs">Certificate number</Label>
              <Input id="cert-number" value={certificateNumber} onChange={(e) => setCertificateNumber(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1">
              <Label htmlFor="cert-type" className="text-xs">Type</Label>
              <Select value={saleType} onValueChange={(v) => setSaleType(v as any)}>
                <SelectTrigger id="cert-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="lien">Lien</SelectItem>
                  <SelectItem value="deed">Deed</SelectItem>
                  <SelectItem value="redeemable_deed">Redeemable deed</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="cert-sale-date" className="text-xs">Sale date *</Label>
              <Input id="cert-sale-date" type="date" value={saleDate} onChange={(e) => setSaleDate(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="cert-purchase" className="text-xs">Purchase $ *</Label>
              <Input id="cert-purchase" inputMode="decimal" placeholder="4200.00" value={purchase} onChange={(e) => setPurchase(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="cert-bid-down" className="text-xs">FL bid-down rate %</Label>
              <Input id="cert-bid-down" inputMode="decimal" placeholder="14.25" value={bidDownRate} onChange={(e) => setBidDownRate(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="cert-owner" className="text-xs">Owner name</Label>
              <Input id="cert-owner" value={ownerName} onChange={(e) => setOwnerName(e.target.value)} />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input
              id="cert-owner-occ"
              type="checkbox"
              checked={ownerOccupied}
              onChange={(e) => setOwnerOccupied(e.target.checked)}
              className="rounded border-border"
            />
            <Label htmlFor="cert-owner-occ" className="text-xs cursor-pointer">
              Owner-occupied at sale (TX 24-mo redemption applies; some states differ)
            </Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { reset(); onOpenChange(false); }}>Cancel</Button>
          <Button
            onClick={() => submit.mutate()}
            disabled={!state || !county || !apn || !saleDate || !purchase || submit.isPending}
            data-testid="confirm-add-certificate"
          >
            {submit.isPending ? "Adding…" : "Add"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
