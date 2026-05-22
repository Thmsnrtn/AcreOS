/**
 * /rehabs/:id — single rehab w/ line items + budget vs. spent + holding meter (FF-2).
 *
 * Devon §3 (per-surface friction): "What's missing for a flipper: a 'Project
 * status' chip per row — Acquired / Demo / Framing / Rough-ins / Drywall /
 * Finishes / Listed / Under Contract / Closed."
 */

import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute } from "wouter";
import { Hammer, PlusCircle, Trash2, Sparkles } from "lucide-react";

import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { getErrorMessage, getErrorTitle } from "@/lib/error-utils";
import { BidsSection } from "@/components/rehabs/bids-section";
import { DrawsSection } from "@/components/rehabs/draws-section";

const CATEGORIES = [
  "demolition", "framing", "roof", "siding", "windows",
  "exterior_paint", "interior_paint", "flooring", "kitchen", "bathroom",
  "hvac", "plumbing", "electrical", "drywall", "trim_doors",
  "appliances", "landscaping", "permits", "dumpster", "cleaning",
  "punch_list", "contingency", "other",
] as const;

const STATUSES = [
  "planning", "demo", "framing", "rough_ins", "drywall",
  "finishes", "punch_list", "listed", "under_contract", "closed", "on_hold",
] as const;

interface Rehab {
  id: string;
  name: string;
  status: string;
  startedAt: string | null;
  plannedListingDate: string | null;
  purchasePriceCents: number | null;
  budgetTotalCents: number | null;
  spentTotalCents: number | null;
  holdingCostMonthlyCents: number | null;
  arvCents: number | null;
  targetMarginCents: number | null;
}

interface LineItem {
  id: string;
  rehabId: string;
  sequence: number;
  category: string;
  scope: string;
  contractorId: string | null;
  budgetCents: number;
  committedCents: number;
  spentCents: number;
  startedAt: string | null;
  completedAt: string | null;
  notes: string | null;
}

interface RehabDetail {
  rehab: Rehab;
  items: LineItem[];
  totals: {
    budgetCents: number;
    committedCents: number;
    spentCents: number;
    varianceCents: number;
    byCategory: Record<string, { budget: number; committed: number; spent: number; variance: number }>;
    daysOnSite: number | null;
    accruedHoldingCents: number | null;
  };
}

interface ScopeTemplate {
  key: string;
  label: string;
  description: string;
  lineCount: number;
}

function fmtUsdCents(c: number | null | undefined): string {
  if (c === null || c === undefined) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(c / 100);
}

function csrfHeader(): Record<string, string> {
  const m = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/);
  return { "Content-Type": "application/json", "x-csrf-token": decodeURIComponent(m?.[1] ?? "") };
}

export default function RehabDetailPage() {
  useDocumentTitle("Rehab — AcreOS");
  const [match, params] = useRoute("/rehabs/:id");
  const id = params?.id ?? "";
  const { toast } = useToast();

  const [newCategory, setNewCategory] = useState<typeof CATEGORIES[number]>("kitchen");
  const [newScope, setNewScope] = useState("");
  const [newBudget, setNewBudget] = useState("");
  const [templateKey, setTemplateKey] = useState("");
  const [templateSqft, setTemplateSqft] = useState("1500");

  const detail = useQuery<RehabDetail>({
    queryKey: ["/api/rehabs", id],
    enabled: !!id,
    queryFn: async () => {
      const res = await fetch(`/api/rehabs/${id}`, { credentials: "include" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return res.json();
    },
  });

  const templates = useQuery<{ templates: ScopeTemplate[] }>({
    queryKey: ["/api/rehab-scope-templates"],
    queryFn: async () => {
      const res = await fetch("/api/rehab-scope-templates", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return res.json();
    },
  });

  const updateRehab = useMutation({
    mutationFn: async (updates: Partial<Rehab>) => {
      const res = await fetch(`/api/rehabs/${id}`, { method: "PATCH", credentials: "include", headers: csrfHeader(), body: JSON.stringify(updates) });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/rehabs", id] }),
    onError: (error) => {
      const title = getErrorTitle(error);
      const description = getErrorMessage(error);
      toast({ title, description, variant: "destructive" });
    },
  });

  const addItem = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/rehabs/${id}/line-items`, {
        method: "POST", credentials: "include", headers: csrfHeader(),
        body: JSON.stringify({
          category: newCategory,
          scope: newScope,
          budgetCents: Math.round(parseFloat(newBudget || "0") * 100),
        }),
      });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rehabs", id] });
      setNewScope(""); setNewBudget("");
    },
    onError: (error) => {
      const title = getErrorTitle(error);
      const description = getErrorMessage(error);
      toast({ title, description, variant: "destructive" });
    },
  });

  const updateItem = useMutation({
    mutationFn: async (vars: { itemId: string; updates: Partial<LineItem> }) => {
      const res = await fetch(`/api/rehab-line-items/${vars.itemId}`, {
        method: "PATCH", credentials: "include", headers: csrfHeader(),
        body: JSON.stringify(vars.updates),
      });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/rehabs", id] }),
    onError: (error) => {
      const title = getErrorTitle(error);
      const description = getErrorMessage(error);
      toast({ title, description, variant: "destructive" });
    },
  });

  const deleteItem = useMutation({
    mutationFn: async (itemId: string) => {
      const res = await fetch(`/api/rehab-line-items/${itemId}`, {
        method: "DELETE", credentials: "include", headers: csrfHeader(),
      });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/rehabs", id] }),
    onError: (error) => {
      const title = getErrorTitle(error);
      const description = getErrorMessage(error);
      toast({ title, description, variant: "destructive" });
    },
  });

  const seedTemplate = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/rehabs/${id}/seed-template`, {
        method: "POST", credentials: "include", headers: csrfHeader(),
        body: JSON.stringify({
          templateKey,
          sqft: parseInt(templateSqft, 10) || 1500,
        }),
      });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return res.json();
    },
    onSuccess: (r: any) => {
      toast({ title: `${r.inserted} line items added`, description: `Sized for ${r.sqft} sqft` });
      queryClient.invalidateQueries({ queryKey: ["/api/rehabs", id] });
    },
    onError: (error) => {
      const title = getErrorTitle(error);
      const description = getErrorMessage(error);
      toast({ title, description, variant: "destructive" });
    },
  });

  if (!id) return <PageShell label="Rehab"><Card><CardContent>Invalid id</CardContent></Card></PageShell>;
  if (detail.isLoading) return <PageShell label="Rehab"><Skeleton className="h-32" /></PageShell>;
  if (!detail.data) return <PageShell label="Rehab"><Card><CardContent>Not found.</CardContent></Card></PageShell>;

  const { rehab, items, totals } = detail.data;
  const spentPct = totals.budgetCents > 0 ? Math.min(100, Math.round((totals.spentCents / totals.budgetCents) * 100)) : 0;
  const arvMargin = rehab.arvCents !== null && rehab.purchasePriceCents !== null && rehab.budgetTotalCents !== null
    ? rehab.arvCents - rehab.purchasePriceCents - rehab.budgetTotalCents
    : null;

  return (
    <PageShell label={rehab.name}>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <Hammer className="w-6 h-6 text-primary" aria-hidden="true" />
          {rehab.name}
        </h1>
        <div className="flex items-center gap-2 mt-2">
          <Select value={rehab.status} onValueChange={(s) => updateRehab.mutate({ status: s })}>
            <SelectTrigger className="h-8 w-[180px] text-xs">
              <SelectValue><Badge variant="outline">{rehab.status.replace(/_/g, " ")}</Badge></SelectValue>
            </SelectTrigger>
            <SelectContent>
              {STATUSES.map((s) => <SelectItem key={s} value={s}>{s.replace(/_/g, " ")}</SelectItem>)}
            </SelectContent>
          </Select>
          {totals.daysOnSite !== null && (
            <Badge variant="outline" className="text-xs">{totals.daysOnSite} days on site</Badge>
          )}
        </div>
      </div>

      {/* Tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Budget</div>
          <div className="text-xl font-semibold">{fmtUsdCents(totals.budgetCents)}</div>
          <Progress value={spentPct} className="mt-2 h-2" />
          <div className="text-xs text-muted-foreground mt-1">{spentPct}% spent</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Spent</div>
          <div className="text-xl font-semibold">{fmtUsdCents(totals.spentCents)}</div>
          <div className={`text-xs mt-1 ${totals.varianceCents > 0 ? "text-acr-warning" : "text-acr-pos"}`}>
            Variance: {fmtUsdCents(totals.varianceCents)}
          </div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Holding accrued</div>
          <div className="text-xl font-semibold">{fmtUsdCents(totals.accruedHoldingCents)}</div>
          <div className="text-xs text-muted-foreground mt-1">
            {rehab.holdingCostMonthlyCents ? `${fmtUsdCents(Math.round(rehab.holdingCostMonthlyCents / 30))}/day` : "set holding cost"}
          </div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">ARV margin</div>
          <div className={`text-xl font-semibold ${arvMargin !== null && arvMargin < 0 ? "text-acr-neg" : ""}`}>
            {fmtUsdCents(arvMargin)}
          </div>
          <div className="text-xs text-muted-foreground mt-1">ARV − basis − budget</div>
        </Card>
      </div>

      {/* Seed template */}
      {items.length === 0 && (
        <Card className="mb-6 border-dashed">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Sparkles className="w-4 h-4" aria-hidden="true" />
              Seed from a scope template
            </CardTitle>
            <CardDescription>
              Pre-populated line items so you don't start from a blank slate. Per-sqft items multiply by the sqft you enter.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-end gap-2">
            <div className="flex-1 min-w-[280px]">
              <Label className="text-xs">Template</Label>
              <Select value={templateKey} onValueChange={setTemplateKey}>
                <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Pick a scope template…" /></SelectTrigger>
                <SelectContent>
                  {templates.data?.templates.map((t) => (
                    <SelectItem key={t.key} value={t.key}>{t.label} — {t.lineCount} lines</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="w-32">
              <Label className="text-xs">Sqft</Label>
              <Input type="number" value={templateSqft} onChange={(e) => setTemplateSqft(e.target.value)} className="h-9" />
            </div>
            <Button disabled={!templateKey || seedTemplate.isPending} onClick={() => seedTemplate.mutate()}>
              Apply template
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Construction draws */}
      <DrawsSection rehabId={id} />

      {/* Bids comparison */}
      <BidsSection rehabId={id} />

      {/* Line items */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Line items</CardTitle>
          <CardDescription>
            Edit budget / committed / spent inline. Each cell auto-saves on blur.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-muted-foreground border-b border-border bg-muted/30">
                <th className="px-2 py-2 text-left font-medium">#</th>
                <th className="px-2 py-2 text-left font-medium">Category</th>
                <th className="px-2 py-2 text-left font-medium">Scope</th>
                <th className="px-2 py-2 text-right font-medium">Budget</th>
                <th className="px-2 py-2 text-right font-medium">Committed</th>
                <th className="px-2 py-2 text-right font-medium">Spent</th>
                <th className="px-2 py-2 text-right font-medium">Variance</th>
                <th className="px-2 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => {
                const variance = it.spentCents - it.budgetCents;
                return (
                  <tr key={it.id} className="border-b border-border/40">
                    <td className="px-2 py-1 text-xs text-muted-foreground">{it.sequence + 1}</td>
                    <td className="px-2 py-1"><Badge variant="outline" className="text-xs">{it.category.replace(/_/g, " ")}</Badge></td>
                    <td className="px-2 py-1">{it.scope}</td>
                    <td className="px-2 py-1 text-right">
                      <CellInput
                        defaultValue={(it.budgetCents / 100).toFixed(0)}
                        onCommit={(v) => updateItem.mutate({ itemId: it.id, updates: { budgetCents: Math.round(parseFloat(v || "0") * 100) } as any })}
                      />
                    </td>
                    <td className="px-2 py-1 text-right">
                      <CellInput
                        defaultValue={(it.committedCents / 100).toFixed(0)}
                        onCommit={(v) => updateItem.mutate({ itemId: it.id, updates: { committedCents: Math.round(parseFloat(v || "0") * 100) } as any })}
                      />
                    </td>
                    <td className="px-2 py-1 text-right">
                      <CellInput
                        defaultValue={(it.spentCents / 100).toFixed(0)}
                        onCommit={(v) => updateItem.mutate({ itemId: it.id, updates: { spentCents: Math.round(parseFloat(v || "0") * 100) } as any })}
                      />
                    </td>
                    <td className={`px-2 py-1 text-right ${variance > 0 ? "text-acr-warning" : variance < 0 ? "text-acr-pos" : "text-muted-foreground"}`}>
                      {fmtUsdCents(variance)}
                    </td>
                    <td className="px-2 py-1 text-right">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => deleteItem.mutate(it.id)} aria-label="Delete line">
                        <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
              {/* Add row */}
              <tr className="border-t border-border bg-muted/30">
                <td colSpan={2} className="px-2 py-2">
                  <Select value={newCategory} onValueChange={(v) => setNewCategory(v as any)}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c.replace(/_/g, " ")}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </td>
                <td className="px-2 py-2"><Input value={newScope} onChange={(e) => setNewScope(e.target.value)} placeholder="Scope description…" className="h-8" /></td>
                <td className="px-2 py-2 text-right">
                  <Input type="number" value={newBudget} onChange={(e) => setNewBudget(e.target.value)} placeholder="0" className="h-8 text-right" />
                </td>
                <td colSpan={4}></td>
                <td className="px-2 py-2 text-right">
                  <Button size="sm" disabled={!newScope || !newBudget || addItem.isPending} onClick={() => addItem.mutate()}>
                    <PlusCircle className="w-4 h-4 mr-1" aria-hidden="true" /> Add
                  </Button>
                </td>
              </tr>
            </tbody>
            <tfoot>
              <tr className="font-semibold border-t-2 border-border">
                <td colSpan={3} className="px-2 py-2 text-right">Totals</td>
                <td className="px-2 py-2 text-right">{fmtUsdCents(totals.budgetCents)}</td>
                <td className="px-2 py-2 text-right">{fmtUsdCents(totals.committedCents)}</td>
                <td className="px-2 py-2 text-right">{fmtUsdCents(totals.spentCents)}</td>
                <td className={`px-2 py-2 text-right ${totals.varianceCents > 0 ? "text-acr-warning" : totals.varianceCents < 0 ? "text-acr-pos" : ""}`}>
                  {fmtUsdCents(totals.varianceCents)}
                </td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </CardContent>
      </Card>
    </PageShell>
  );
}

function CellInput({ defaultValue, onCommit }: { defaultValue: string; onCommit: (v: string) => void }) {
  const [val, setVal] = useState(defaultValue);
  return (
    <Input
      type="number"
      value={val}
      onChange={(e) => setVal(e.target.value)}
      onBlur={() => { if (val !== defaultValue) onCommit(val); }}
      className="h-7 text-right text-xs w-24"
    />
  );
}
