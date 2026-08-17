/**
 * /lot-pricing?parcelId=N — lot-pricing rules editor (SD-5).
 *
 * Brigid §5: "A pricing-rules editor where I define premium percentages per
 * attribute (corner +10%, frontage > 150ft +8%, water feature +15%,
 * cul-de-sac +5%, lot < 1.5ac -10%), apply them to all child lots in a
 * subdivision, see the proposed asking-price grid, override any cell, and
 * lock the grid. Re-run when comps refresh. The base price comes from the
 * AVM on the parent's per-acre value."
 */

import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { DollarSign, Plus, Trash2, Lock, Sparkles } from "lucide-react";

import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";

interface Rule {
  attribute: string;
  operator: "==" | ">" | "<" | ">=" | "<=";
  threshold?: number | string | boolean;
  premiumPct: number;
  label?: string;
}

interface RulesResponse {
  rules: {
    id: string;
    name: string;
    basePriceSource: string;
    fixedPerAcreCents: number | null;
    rules: Rule[];
    lockedGrid: any | null;
    lockedAt: string | null;
  } | null;
}

interface PreviewRow {
  childParcelId: number;
  childLotNumber: string | null;
  sizeAcres: number;
  basePriceCents: number;
  premiumPct: number;
  askingPriceCents: number;
  matchedRules: Array<{ attribute: string; premiumPct: number }>;
}

interface PreviewResponse {
  basePerAcreCents: number;
  basePriceSource: string;
  grid: PreviewRow[];
}

const ATTRIBUTE_OPTIONS = [
  { value: "acres", label: "Acreage" },
  { value: "frontage", label: "Frontage (ft)" },
  { value: "corner", label: "Corner lot (yes/no)" },
  { value: "cul_de_sac", label: "Cul-de-sac (yes/no)" },
  { value: "water_feature", label: "Water feature (yes/no)" },
  { value: "wooded", label: "Wooded (yes/no)" },
];

function fmtUsdCents(c: number | null | undefined): string {
  if (c === null || c === undefined) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(c / 100);
}

function csrfHeader(): Record<string, string> {
  const m = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/);
  return { "Content-Type": "application/json", "x-csrf-token": decodeURIComponent(m?.[1] ?? "") };
}

export default function LotPricingPage() {
  useDocumentTitle("Lot pricing — AcreOS");
  const [location] = useLocation();
  const { toast } = useToast();
  const parcelId = useMemo(() => {
    const params = new URLSearchParams(location.split("?")[1] ?? "");
    const id = parseInt(params.get("parcelId") ?? "0", 10);
    return Number.isFinite(id) && id > 0 ? id : null;
  }, [location]);

  const [name, setName] = useState("Standard rural");
  const [basePriceSource, setBasePriceSource] = useState<"avm_per_acre" | "fixed_per_acre">("avm_per_acre");
  const [fixedPerAcreCents, setFixedPerAcreCents] = useState<string>("");
  const [rules, setRules] = useState<Rule[]>([
    { attribute: "corner", operator: "==", threshold: true, premiumPct: 0.10, label: "Corner lot" },
    { attribute: "frontage", operator: ">", threshold: 150, premiumPct: 0.08, label: "Frontage > 150ft" },
    { attribute: "water_feature", operator: "==", threshold: true, premiumPct: 0.15, label: "Water feature" },
    { attribute: "cul_de_sac", operator: "==", threshold: true, premiumPct: 0.05, label: "Cul-de-sac" },
    { attribute: "acres", operator: "<", threshold: 1.5, premiumPct: -0.10, label: "Sub-1.5 acre lot" },
  ]);

  const existing = useQuery<RulesResponse>({
    queryKey: ["/api/parcels", parcelId, "pricing-rules"],
    enabled: parcelId !== null,
    queryFn: async () => {
      const res = await fetch(`/api/parcels/${parcelId}/pricing-rules`, { credentials: "include" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return res.json();
    },
  });

  useEffect(() => {
    if (existing.data?.rules) {
      setName(existing.data.rules.name);
      setBasePriceSource(existing.data.rules.basePriceSource as any);
      setFixedPerAcreCents(existing.data.rules.fixedPerAcreCents !== null ? String(existing.data.rules.fixedPerAcreCents) : "");
      if (existing.data.rules.rules?.length) setRules(existing.data.rules.rules);
    }
  }, [existing.data?.rules?.id]);

  const save = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/parcels/${parcelId}/pricing-rules`, {
        method: "PUT",
        credentials: "include",
        headers: csrfHeader(),
        body: JSON.stringify({
          name,
          basePriceSource,
          fixedPerAcreCents: basePriceSource === "fixed_per_acre" ? parseInt(fixedPerAcreCents, 10) || 0 : null,
          rules,
        }),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(detail.message ?? `Failed (${res.status})`);
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Pricing rules saved" });
      queryClient.invalidateQueries({ queryKey: ["/api/parcels", parcelId, "pricing-rules"] });
    },
    onError: (err: any) => toast({ title: "Save failed", description: err.message, variant: "destructive" }),
  });

  // allow-no-invalidation: pricing preview renders from mutation.data — nothing persisted
  const preview = useMutation<PreviewResponse, Error>({
    mutationFn: async () => {
      const res = await fetch(`/api/parcels/${parcelId}/pricing-rules/preview`, {
        method: "POST",
        credentials: "include",
        headers: csrfHeader(),
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(detail.message ?? `Failed (${res.status})`);
      }
      return res.json();
    },
    onError: (err: any) => toast({ title: "Preview failed", description: err.message, variant: "destructive" }),
  });

  const lock = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/parcels/${parcelId}/pricing-rules/lock`, {
        method: "POST",
        credentials: "include",
        headers: csrfHeader(),
        body: JSON.stringify({ overrides: {} }),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(detail.message ?? `Failed (${res.status})`);
      }
      return res.json();
    },
    onSuccess: (r: any) => {
      toast({ title: "Grid locked", description: `${r.lockedGrid.length} list prices updated` });
      queryClient.invalidateQueries({ queryKey: ["/api/parcels", parcelId, "pricing-rules"] });
      queryClient.invalidateQueries({ queryKey: ["/api/parcels", parcelId, "subdivision"] });
    },
    onError: (err: any) => toast({ title: "Lock failed", description: err.message, variant: "destructive" }),
  });

  if (!parcelId) {
    return (
      <PageShell label="Lot pricing">
        <Card>
          <CardContent className="py-8 text-sm text-muted-foreground">
            Open this page from a parent parcel: <code className="text-xs">/lot-pricing?parcelId=&lt;id&gt;</code>
          </CardContent>
        </Card>
      </PageShell>
    );
  }

  return (
    <PageShell label="Lot pricing">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <DollarSign className="w-6 h-6 text-primary" aria-hidden="true" />
          Lot pricing rules
        </h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          Define premium rules once, apply them to every child lot. Year three of
          doing this with your own data and you should be able to predict sale
          price within five percent on lot one of every new project.
        </p>
      </div>

      {/* Rules editor */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Premium rules</CardTitle>
          <CardDescription>
            Each matching rule's premium adds (or subtracts). Multiple rules
            stack additively.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3 max-w-xl">
            <div>
              <Label className="text-xs" htmlFor="lot-ruleset-name">Ruleset name</Label>
              <Input id="lot-ruleset-name" value={name} onChange={(e) => setName(e.target.value)} className="h-9" />
            </div>
            <div>
              <Label className="text-xs">Base price source</Label>
              <Select value={basePriceSource} onValueChange={(v) => setBasePriceSource(v as any)}>
                <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="avm_per_acre">Parent value / acre</SelectItem>
                  <SelectItem value="fixed_per_acre">Fixed $/acre</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {basePriceSource === "fixed_per_acre" && (
              <div className="col-span-2">
                <Label className="text-xs" htmlFor="lot-fixed-per-acre">Fixed $ per acre (cents)</Label>
                <Input
                  id="lot-fixed-per-acre"
                  type="number"
                  value={fixedPerAcreCents}
                  onChange={(e) => setFixedPerAcreCents(e.target.value)}
                  className="h-9"
                  placeholder="3500000 = $35,000/acre"
                />
              </div>
            )}
          </div>

          <Separator />

          <div className="space-y-2">
            {rules.map((r, idx) => (
              <div key={idx} className="grid grid-cols-12 gap-2 items-end">
                <div className="col-span-3">
                  <Label className="text-xs">Attribute</Label>
                  <Select value={r.attribute} onValueChange={(v) => {
                    const next = [...rules]; next[idx] = { ...next[idx], attribute: v }; setRules(next);
                  }}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {ATTRIBUTE_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-2">
                  <Label className="text-xs">Operator</Label>
                  <Select value={r.operator} onValueChange={(v) => {
                    const next = [...rules]; next[idx] = { ...next[idx], operator: v as any }; setRules(next);
                  }}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="==">=</SelectItem>
                      <SelectItem value=">">&gt;</SelectItem>
                      <SelectItem value="<">&lt;</SelectItem>
                      <SelectItem value=">=">≥</SelectItem>
                      <SelectItem value="<=">≤</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-2">
                  <Label className="text-xs" htmlFor={`lot-rule-${idx}-threshold`}>Threshold</Label>
                  <Input
                    id={`lot-rule-${idx}-threshold`}
                    value={String(r.threshold ?? "")}
                    onChange={(e) => {
                      const v = e.target.value;
                      const parsed = v === "true" ? true : v === "false" ? false : !isNaN(parseFloat(v)) ? parseFloat(v) : v;
                      const next = [...rules]; next[idx] = { ...next[idx], threshold: parsed }; setRules(next);
                    }}
                    className="h-8 text-xs"
                  />
                </div>
                <div className="col-span-2">
                  <Label className="text-xs" htmlFor={`lot-rule-${idx}-premium`}>Premium %</Label>
                  <Input
                    id={`lot-rule-${idx}-premium`}
                    type="number"
                    step="0.01"
                    value={(r.premiumPct * 100).toFixed(2)}
                    onChange={(e) => {
                      const next = [...rules]; next[idx] = { ...next[idx], premiumPct: (parseFloat(e.target.value) || 0) / 100 }; setRules(next);
                    }}
                    className="h-8 text-xs"
                  />
                </div>
                <div className="col-span-2">
                  <Label className="text-xs" htmlFor={`lot-rule-${idx}-label`}>Label</Label>
                  <Input
                    id={`lot-rule-${idx}-label`}
                    value={r.label ?? ""}
                    onChange={(e) => {
                      const next = [...rules]; next[idx] = { ...next[idx], label: e.target.value }; setRules(next);
                    }}
                    className="h-8 text-xs"
                  />
                </div>
                <div className="col-span-1 flex justify-end">
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => {
                    setRules(rules.filter((_, i) => i !== idx));
                  }} aria-label="Remove rule">
                    <Trash2 className="w-4 h-4" aria-hidden="true" />
                  </Button>
                </div>
              </div>
            ))}
            <Button variant="ghost" size="sm" onClick={() => setRules([...rules, { attribute: "acres", operator: ">", threshold: 0, premiumPct: 0 }])}>
              <Plus className="w-4 h-4 mr-1" aria-hidden="true" /> Add rule
            </Button>
          </div>

          <div className="flex gap-2 pt-2">
            <Button onClick={() => save.mutate()} disabled={save.isPending}>Save rules</Button>
            <Button variant="outline" onClick={() => preview.mutate()} disabled={preview.isPending || !existing.data?.rules}>
              <Sparkles className="w-4 h-4 mr-1" aria-hidden="true" /> Preview grid
            </Button>
            <Button variant="default" onClick={() => lock.mutate()} disabled={lock.isPending || !existing.data?.rules}>
              <Lock className="w-4 h-4 mr-1" aria-hidden="true" /> Lock grid
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Preview / locked grid */}
      {preview.data && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Proposed asking-price grid</CardTitle>
            <CardDescription>
              Base: {fmtUsdCents(preview.data.basePerAcreCents)} / acre ({preview.data.basePriceSource.replace(/_/g, " ")})
            </CardDescription>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted-foreground border-b border-border">
                  <th className="px-2 py-2 text-left font-medium">Lot</th>
                  <th className="px-2 py-2 text-right font-medium">Acres</th>
                  <th className="px-2 py-2 text-right font-medium">Base</th>
                  <th className="px-2 py-2 text-right font-medium">Premium</th>
                  <th className="px-2 py-2 text-left font-medium">Matched</th>
                  <th className="px-2 py-2 text-right font-medium">Asking</th>
                </tr>
              </thead>
              <tbody>
                {preview.data.grid.map((g) => (
                  <tr key={g.childParcelId} className="border-b border-border/40">
                    <td className="px-2 py-2 font-medium">{g.childLotNumber ?? `#${g.childParcelId}`}</td>
                    <td className="px-2 py-2 text-right">{g.sizeAcres.toFixed(2)}</td>
                    <td className="px-2 py-2 text-right text-muted-foreground">{fmtUsdCents(g.basePriceCents)}</td>
                    <td className={`px-2 py-2 text-right ${g.premiumPct > 0 ? "text-acr-pos" : g.premiumPct < 0 ? "text-acr-neg" : ""}`}>
                      {(g.premiumPct * 100).toFixed(1)}%
                    </td>
                    <td className="px-2 py-2 text-xs">
                      {g.matchedRules.map((m, i) => (
                        <Badge key={i} variant="outline" className="mr-1 text-micro">{m.attribute} {(m.premiumPct * 100).toFixed(0)}%</Badge>
                      ))}
                    </td>
                    <td className="px-2 py-2 text-right font-semibold">{fmtUsdCents(g.askingPriceCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </PageShell>
  );
}
