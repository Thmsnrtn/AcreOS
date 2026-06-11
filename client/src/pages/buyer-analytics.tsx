/**
 * /buyer-analytics — buyer match funnel + freshness (W-6).
 *
 * Trey: "deal X had 14 buyers presented → 6 interested → 1 purchased.
 * Then aggregate: your 30-day average is 38% buyer interest rate."
 * + "Flag buyers I haven't pinged in 90 days; auto-send a re-engagement
 * email; auto-deactivate after 180 days of silence with my approval."
 */

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { BarChart3, Users as UsersIcon, AlertTriangle, ArrowDown } from "lucide-react";

import { PageShell } from "@/components/page-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { formatDate } from "@/lib/format";

interface PerBlast {
  blastId: string;
  subject: string;
  propertyId: number;
  presented: number;
  interested: number;
  notInterested: number;
  interestRate: number;
  createdAt: string;
}

interface AnalyticsResponse {
  windowDays: number;
  blastCount: number;
  totalPresented: number;
  totalInterested: number;
  aggregateInterestRate: number;
  perBlast: PerBlast[];
}

interface FreshnessResponse {
  totalBuyers: number;
  counts: {
    fresh: number;
    warming: number;
    stale: number;
    deactivationCandidate: number;
    unknown: number;
  };
  stale: Array<{ id: number; name: string; email: string | null; lastContactDate: string | null }>;
  deactivationCandidates: Array<{ id: number; name: string; email: string | null; lastContactDate: string | null }>;
}

function fmtPct(decimal: number): string {
  return `${(decimal * 100).toFixed(1)}%`;
}

export default function BuyerAnalyticsPage() {
  useDocumentTitle("Buyer analytics — AcreOS");
  const [windowDays, setWindowDays] = useState("30");

  const analytics = useQuery<AnalyticsResponse>({
    queryKey: ["/api/buyer-analytics", windowDays],
    queryFn: async () => {
      const res = await fetch(`/api/buyer-analytics?days=${windowDays}`, { credentials: "include" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return res.json();
    },
  });

  const freshness = useQuery<FreshnessResponse>({
    queryKey: ["/api/buyer-profiles/freshness"],
    queryFn: async () => {
      const res = await fetch("/api/buyer-profiles/freshness", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return res.json();
    },
  });

  return (
    <PageShell label="Buyer analytics">
      <div className="flex items-start justify-between mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <BarChart3 className="w-6 h-6 text-primary" aria-hidden="true" />
            Buyer analytics
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Per-blast match funnel + buyer-list freshness. Knowing your interest
            rate per blast is how you tell if a deal is priced right.
          </p>
        </div>
        <Select value={windowDays} onValueChange={setWindowDays}>
          <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="7">7 days</SelectItem>
            <SelectItem value="30">30 days</SelectItem>
            <SelectItem value="90">90 days</SelectItem>
            <SelectItem value="365">1 year</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Aggregate */}
      {analytics.isLoading ? (
        <Skeleton className="h-24 mb-6" />
      ) : analytics.data ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <SummaryTile label="Blasts" value={analytics.data.blastCount} sub={`last ${analytics.data.windowDays}d`} />
          <SummaryTile label="Presented" value={analytics.data.totalPresented} sub="cash buyers reached" />
          <SummaryTile label="Interested" value={analytics.data.totalInterested} sub="replied yes" />
          <SummaryTile
            label="Interest rate"
            value={fmtPct(analytics.data.aggregateInterestRate)}
            sub="aggregate"
            tone={analytics.data.aggregateInterestRate >= 0.24 ? "pos" : analytics.data.aggregateInterestRate >= 0.10 ? undefined : "warn"}
          />
        </div>
      ) : null}

      {/* Per-blast funnel */}
      <Card className="mb-6">
        <div className="p-5">
          <h2 className="text-sm font-semibold mb-3">Per-blast funnel</h2>
          <Separator className="mb-3" />
          {analytics.isLoading ? (
            <Skeleton className="h-32" />
          ) : !analytics.data || analytics.data.perBlast.length === 0 ? (
            <p className="text-sm text-muted-foreground">No blasts in the selected window.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted-foreground">
                  <th className="px-2 py-2 text-left font-medium">Subject</th>
                  <th className="px-2 py-2 text-left font-medium">Property</th>
                  <th className="px-2 py-2 text-right font-medium">Presented</th>
                  <th className="px-2 py-2 text-right font-medium">Interested</th>
                  <th className="px-2 py-2 text-right font-medium">Not</th>
                  <th className="px-2 py-2 text-right font-medium">Rate</th>
                </tr>
              </thead>
              <tbody>
                {analytics.data.perBlast.map((p) => (
                  <tr key={p.blastId} className="border-t border-border/40">
                    <td className="px-2 py-2 font-medium">{p.subject}</td>
                    <td className="px-2 py-2 text-xs font-mono">{p.propertyId}</td>
                    <td className="px-2 py-2 text-right">{p.presented}</td>
                    <td className="px-2 py-2 text-right text-acr-pos">{p.interested}</td>
                    <td className="px-2 py-2 text-right text-muted-foreground">{p.notInterested}</td>
                    <td className={`px-2 py-2 text-right font-mono ${p.interestRate >= 0.24 ? "text-acr-pos" : p.interestRate >= 0.10 ? "" : "text-acr-warning"}`}>
                      {fmtPct(p.interestRate)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>

      {/* Freshness */}
      {freshness.isLoading ? (
        <Skeleton className="h-32" />
      ) : freshness.data ? (
        <Card>
          <div className="p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <UsersIcon className="w-4 h-4 text-primary" aria-hidden="true" />
                <h2 className="text-sm font-semibold">Buyer-list freshness</h2>
              </div>
              <span className="text-xs text-muted-foreground">{freshness.data.totalBuyers} total buyers</span>
            </div>
            <Separator className="mb-3" />
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
              <BucketTile label="Fresh ≤ 30d" count={freshness.data.counts.fresh} tone="pos" />
              <BucketTile label="Warming 31-90d" count={freshness.data.counts.warming} />
              <BucketTile label="Stale 91-180d" count={freshness.data.counts.stale} tone="warn" />
              <BucketTile label="Deactivation" count={freshness.data.counts.deactivationCandidate} tone="neg" />
              <BucketTile label="Unknown" count={freshness.data.counts.unknown} />
            </div>

            {freshness.data.deactivationCandidates.length > 0 && (
              <>
                <p className="text-xs font-semibold flex items-center gap-1 mb-2">
                  <AlertTriangle className="w-3.5 h-3.5 text-acr-warning" aria-hidden="true" />
                  Deactivation candidates ({freshness.data.deactivationCandidates.length})
                </p>
                <ul className="space-y-1">
                  {freshness.data.deactivationCandidates.slice(0, 10).map((b) => (
                    <DeactivateRow key={b.id} buyer={b} />
                  ))}
                  {freshness.data.deactivationCandidates.length > 10 && (
                    <li className="text-xs text-muted-foreground italic">…and {freshness.data.deactivationCandidates.length - 10} more</li>
                  )}
                </ul>
              </>
            )}
          </div>
        </Card>
      ) : null}
    </PageShell>
  );
}

function SummaryTile({ label, value, sub, tone }: { label: string; value: number | string; sub?: string; tone?: "pos" | "warn" }) {
  const toneClass = tone === "pos" ? "text-acr-pos" : tone === "warn" ? "text-acr-warning" : "";
  return (
    <Card className="p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-2xl font-semibold tracking-tight mt-1 ${toneClass}`}>{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
    </Card>
  );
}

function BucketTile({ label, count, tone }: { label: string; count: number; tone?: "pos" | "warn" | "neg" }) {
  const toneClass = tone === "pos" ? "text-acr-pos" : tone === "warn" ? "text-acr-warning" : tone === "neg" ? "text-acr-neg" : "";
  return (
    <Card className="p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-xl font-semibold mt-1 ${toneClass}`}>{count}</div>
    </Card>
  );
}

function DeactivateRow({ buyer }: { buyer: FreshnessResponse["deactivationCandidates"][number] }) {
  const { toast } = useToast();
  const deactivate = useMutation({
    mutationFn: async () => {
      const csrfToken = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/)?.[1] || "";
      const res = await fetch(`/api/buyer-profiles/${buyer.id}/deactivate`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "x-csrf-token": decodeURIComponent(csrfToken) },
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Buyer deactivated" });
      queryClient.invalidateQueries({ queryKey: ["/api/buyer-profiles/freshness"] });
    },
    onError: (err: any) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });
  return (
    <li className="flex items-center justify-between gap-3 py-1 text-xs">
      <span className="font-medium truncate">{buyer.name}</span>
      <span className="text-muted-foreground truncate">{buyer.email ?? "—"}</span>
      <span className="text-muted-foreground whitespace-nowrap">Last: {formatDate(buyer.lastContactDate)}</span>
      <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => deactivate.mutate()} disabled={deactivate.isPending}>
        <ArrowDown className="w-3 h-3 mr-1" aria-hidden="true" /> Deactivate
      </Button>
    </li>
  );
}
