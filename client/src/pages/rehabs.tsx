/**
 * /rehabs — list flips. /rehabs/:id — single rehab w/ line items (FF-2).
 *
 * Devon §5.1: "A real rehabs table + rehab_line_items (category, scope,
 * vendor, budgeted, committed, spent, variance, photos)."
 */

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Hammer, ArrowRight, PlusCircle } from "lucide-react";

import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";

interface RehabRow {
  id: string;
  propertyId: number;
  name: string;
  status: string;
  startedAt: string | null;
  plannedListingDate: string | null;
  purchasePriceCents: number | null;
  budgetTotalCents: number | null;
  spentTotalCents: number | null;
  arvCents: number | null;
  updatedAt: string;
}

function fmtUsdCents(c: number | null): string {
  if (c === null || c === undefined) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(c / 100);
}

function statusTone(s: string): "default" | "secondary" | "outline" | "destructive" {
  if (s === "closed") return "secondary";
  if (s === "on_hold") return "destructive";
  if (s === "listed" || s === "under_contract") return "default";
  return "outline";
}

function csrf(): Record<string, string> {
  const m = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/);
  return { "Content-Type": "application/json", "x-csrf-token": decodeURIComponent(m?.[1] ?? "") };
}

const STATUSES = [
  "planning", "demo", "framing", "rough_ins", "drywall",
  "finishes", "punch_list", "listed", "under_contract", "closed", "on_hold",
] as const;

export default function RehabsPage() {
  useDocumentTitle("Active rehabs — AcreOS");
  const { toast } = useToast();
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [propertyId, setPropertyId] = useState("");
  const [purchasePrice, setPurchasePrice] = useState("");
  const [budgetTotal, setBudgetTotal] = useState("");
  const [arv, setArv] = useState("");
  const [holdingMonthly, setHoldingMonthly] = useState("");

  const list = useQuery<{ rehabs: RehabRow[] }>({
    queryKey: ["/api/rehabs"],
    queryFn: async () => {
      const res = await fetch("/api/rehabs", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return res.json();
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/rehabs", {
        method: "POST",
        credentials: "include",
        headers: csrf(),
        body: JSON.stringify({
          propertyId: parseInt(propertyId, 10),
          name,
          purchasePriceCents: purchasePrice ? Math.round(parseFloat(purchasePrice) * 100) : undefined,
          budgetTotalCents: budgetTotal ? Math.round(parseFloat(budgetTotal) * 100) : undefined,
          arvCents: arv ? Math.round(parseFloat(arv) * 100) : undefined,
          holdingCostMonthlyCents: holdingMonthly ? Math.round(parseFloat(holdingMonthly) * 100) : undefined,
          status: "planning",
        }),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(detail.message ?? `Failed (${res.status})`);
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Rehab created" });
      queryClient.invalidateQueries({ queryKey: ["/api/rehabs"] });
      setShowCreate(false);
      setName(""); setPropertyId(""); setPurchasePrice(""); setBudgetTotal(""); setArv(""); setHoldingMonthly("");
    },
    onError: (err: any) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  return (
    <PageShell label="Active rehabs">
      <div className="flex items-start justify-between mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Hammer className="w-6 h-6 text-primary" aria-hidden="true" />
            Active rehabs
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            One row per active flip project. Budget vs. spent, days on site,
            holding-cost meter — the morning-dashboard view a flipper actually opens.
          </p>
        </div>
        <Button onClick={() => setShowCreate((v) => !v)}>
          <PlusCircle className="w-4 h-4 mr-1" aria-hidden="true" />
          {showCreate ? "Cancel" : "New rehab"}
        </Button>
      </div>

      {showCreate && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">New rehab project</CardTitle>
            <CardDescription>
              Tie this rehab to an existing property. Numbers are dollars (no commas).
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <div>
              <Label className="text-xs">Property ID</Label>
              <Input value={propertyId} onChange={(e) => setPropertyId(e.target.value)} className="h-9" placeholder="42" />
            </div>
            <div className="md:col-span-2">
              <Label className="text-xs">Project name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} className="h-9" placeholder="1247 Cherokee Pl" />
            </div>
            <div>
              <Label className="text-xs">Purchase price ($)</Label>
              <Input type="number" value={purchasePrice} onChange={(e) => setPurchasePrice(e.target.value)} className="h-9" placeholder="120000" />
            </div>
            <div>
              <Label className="text-xs">Budget total ($)</Label>
              <Input type="number" value={budgetTotal} onChange={(e) => setBudgetTotal(e.target.value)} className="h-9" placeholder="65000" />
            </div>
            <div>
              <Label className="text-xs">ARV ($)</Label>
              <Input type="number" value={arv} onChange={(e) => setArv(e.target.value)} className="h-9" placeholder="245000" />
            </div>
            <div>
              <Label className="text-xs">Holding cost / month ($)</Label>
              <Input type="number" value={holdingMonthly} onChange={(e) => setHoldingMonthly(e.target.value)} className="h-9" placeholder="900" />
            </div>
            <div className="col-span-full">
              <Button disabled={!name || !propertyId || create.isPending} onClick={() => create.mutate()}>
                Create rehab
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          {list.isLoading ? (
            <Skeleton className="h-32 m-4" />
          ) : list.data && list.data.rehabs.length > 0 ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted-foreground border-b border-border bg-muted/30">
                  <th className="px-3 py-2 text-left font-medium">Project</th>
                  <th className="px-3 py-2 text-left font-medium">Status</th>
                  <th className="px-3 py-2 text-right font-medium">Purchase</th>
                  <th className="px-3 py-2 text-right font-medium">Budget</th>
                  <th className="px-3 py-2 text-right font-medium">Spent</th>
                  <th className="px-3 py-2 text-right font-medium">Variance</th>
                  <th className="px-3 py-2 text-right font-medium">ARV</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {list.data.rehabs.map((r) => {
                  const variance = (r.spentTotalCents ?? 0) - (r.budgetTotalCents ?? 0);
                  return (
                    <tr key={r.id} className="border-b border-border/40">
                      <td className="px-3 py-2 font-medium">{r.name}</td>
                      <td className="px-3 py-2"><Badge variant={statusTone(r.status)} className="text-xs">{r.status.replace(/_/g, " ")}</Badge></td>
                      <td className="px-3 py-2 text-right">{fmtUsdCents(r.purchasePriceCents)}</td>
                      <td className="px-3 py-2 text-right">{fmtUsdCents(r.budgetTotalCents)}</td>
                      <td className="px-3 py-2 text-right">{fmtUsdCents(r.spentTotalCents)}</td>
                      <td className={`px-3 py-2 text-right ${variance > 0 ? "text-acr-warning" : variance < 0 ? "text-acr-pos" : ""}`}>
                        {fmtUsdCents(variance)}
                      </td>
                      <td className="px-3 py-2 text-right">{fmtUsdCents(r.arvCents)}</td>
                      <td className="px-3 py-2 text-right">
                        <Link href={`/rehabs/${r.id}`} className="text-primary inline-flex items-center text-xs gap-1">
                          Open <ArrowRight className="w-3 h-3" aria-hidden="true" />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <div className="p-8 text-center text-sm text-muted-foreground">
              No active rehabs yet. Create one above to start tracking budget, line items, and contractor draws.
            </div>
          )}
        </CardContent>
      </Card>
    </PageShell>
  );
}
