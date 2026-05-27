/**
 * "Subdivision" tab on /parcels/:id (SD-2).
 *
 * Brigid §4 (per-surface friction): "A 'Subdivision' tab here would change
 * my life: plan list, child-lot table, permit checklist, document-version
 * stack, cost-basis allocation, asking-price grid. One tab. One day, the
 * most important tab in the app."
 *
 * This v1 ships the child-lot table + parent rollup metrics + an inline
 * "Add lots" form. Permit checklist (SD-3), basis allocation (SD-4),
 * pricing grid (SD-5), and plans (SD-7) land in subsequent PRs.
 */

import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useOptimisticUpdate } from "@/lib/optimistic-mutation";
import { Layers, PlusCircle, AlertTriangle, ArrowRight, ClipboardList, CheckCircle2, Clock } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { SubdivisionPlanEditor } from "@/components/parcels/subdivision-plan-editor";

interface ChildLot {
  id: number;
  childLotNumber: string | null;
  apn: string;
  sizeAcres: string | null;
  status: string;
  listPrice: string | null;
  soldPrice: string | null;
  soldDate: string | null;
  buyerId: number | null;
  daysOnMarket: number | null;
  allocatedBasisCents: number | null;
  allocationMethod: string | null;
}

interface SubdivisionResponse {
  parent: {
    id: number;
    apn: string;
    address: string | null;
    county: string;
    state: string;
    sizeAcres: string | null;
    purchasePrice: string | null;
    purchaseDate: string | null;
  };
  children: ChildLot[];
  metrics: {
    childCount: number;
    totalChildAcres: number;
    totalParentAcres: number | null;
    parentBasisCents: number | null;
    soldChildCount: number;
    soldProceedsCents: number;
    remainingChildCount: number;
    remainingChildAcres: number;
    blendedCostPerRemainingAcreCents: number | null;
    breakevenAtCurrentAskingCents: number | null;
    pipelineCounts: Record<string, number>;
  };
}

function fmtUsdCents(cents: number | null): string {
  if (cents === null || cents === undefined) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(cents / 100);
}

function fmtUsdString(s: string | null): string {
  if (!s) return "—";
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

function fmtAcres(s: string | number | null): string {
  if (s === null || s === undefined) return "—";
  const n = typeof s === "string" ? parseFloat(s) : s;
  if (!Number.isFinite(n)) return "—";
  return `${n.toFixed(2)} ac`;
}

function statusBadge(status: string): { label: string; tone: "default" | "secondary" | "outline" | "destructive" } {
  const s = status.toLowerCase();
  if (s === "sold") return { label: "Sold", tone: "secondary" };
  if (s === "under_contract") return { label: "Under contract", tone: "default" };
  if (s === "listed") return { label: "Listed", tone: "outline" };
  if (s === "owned") return { label: "Held", tone: "outline" };
  return { label: status, tone: "outline" };
}

export function SubdivisionTab({ parentParcelId }: { parentParcelId: number }) {
  const { toast } = useToast();
  const [showAdd, setShowAdd] = useState(false);
  const [draftLots, setDraftLots] = useState<Array<{ childLotNumber: string; sizeAcres: string; listPrice: string }>>([
    { childLotNumber: "", sizeAcres: "", listPrice: "" },
  ]);

  const { data, isLoading, error } = useQuery<SubdivisionResponse>({
    queryKey: ["/api/parcels", parentParcelId, "subdivision"],
    queryFn: async () => {
      const res = await fetch(`/api/parcels/${parentParcelId}/subdivision`, { credentials: "include" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return res.json();
    },
  });

  const createLots = useMutation({
    mutationFn: async (lots: Array<{ childLotNumber: string; sizeAcres: number; listPrice?: number }>) => {
      const csrfToken = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/)?.[1] || "";
      const res = await fetch(`/api/parcels/${parentParcelId}/lots`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "x-csrf-token": decodeURIComponent(csrfToken) },
        body: JSON.stringify({ lots, inheritFromParent: true }),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(detail.message ?? `Failed (${res.status})`);
      }
      return res.json();
    },
    onSuccess: (r) => {
      toast({ title: `${r.created.length} lot${r.created.length === 1 ? "" : "s"} created` });
      queryClient.invalidateQueries({ queryKey: ["/api/parcels", parentParcelId, "subdivision"] });
      setShowAdd(false);
      setDraftLots([{ childLotNumber: "", sizeAcres: "", listPrice: "" }]);
    },
    onError: (err: any) => toast({ title: "Could not create lots", description: err.message, variant: "destructive" }),
  });

  const totalDraftAcres = useMemo(
    () => draftLots.reduce((sum, l) => sum + (parseFloat(l.sizeAcres) || 0), 0),
    [draftLots],
  );

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32" />
        <Skeleton className="h-48" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <Card>
        <CardContent className="py-8 text-sm text-muted-foreground flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-acr-warn" aria-hidden="true" />
          Could not load subdivision data.
        </CardContent>
      </Card>
    );
  }

  const m = data.metrics;
  const remainingPct = m.parentBasisCents
    ? Math.round((m.soldProceedsCents / m.parentBasisCents) * 100)
    : 0;

  return (
    <div className="space-y-4">
      {/* Rollup metrics */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Layers className="w-4 h-4" aria-hidden="true" />
            Subdivision rollup
          </CardTitle>
          <CardDescription>
            Parent {fmtAcres(data.parent.sizeAcres)} → {m.childCount} child lot{m.childCount === 1 ? "" : "s"} ({fmtAcres(m.totalChildAcres)} cut)
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Tile label="Parent basis" value={fmtUsdCents(m.parentBasisCents)} />
          <Tile label="Sold proceeds" value={fmtUsdCents(m.soldProceedsCents)} sub={`${m.soldChildCount} of ${m.childCount} sold (${remainingPct}% recovered)`} />
          <Tile label="Cost / remaining acre" value={fmtUsdCents(m.blendedCostPerRemainingAcreCents)} sub={fmtAcres(m.remainingChildAcres) + " left"} />
          <Tile
            label="Breakeven gap"
            value={fmtUsdCents(m.breakevenAtCurrentAskingCents)}
            sub={m.breakevenAtCurrentAskingCents !== null && m.breakevenAtCurrentAskingCents <= 0 ? "above breakeven at asking" : "still below breakeven"}
            tone={m.breakevenAtCurrentAskingCents !== null && m.breakevenAtCurrentAskingCents <= 0 ? "pos" : "warn"}
          />
        </CardContent>
      </Card>

      {/* Pipeline counts */}
      {Object.keys(m.pipelineCounts).length > 0 && (
        <div className="flex flex-wrap gap-2">
          {Object.entries(m.pipelineCounts).map(([status, count]) => {
            const b = statusBadge(status);
            return (
              <Badge key={status} variant={b.tone}>
                {b.label}: {count}
              </Badge>
            );
          })}
        </div>
      )}

      {/* Child lots */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-base">Child lots</CardTitle>
            <CardDescription>One row per recorded child lot.</CardDescription>
          </div>
          <Button size="sm" variant="outline" onClick={() => setShowAdd((v) => !v)}>
            <PlusCircle className="w-4 h-4 mr-1" aria-hidden="true" />
            {showAdd ? "Cancel" : "Add lots"}
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {showAdd && (
            <div className="border border-dashed rounded-md p-3 space-y-3 bg-muted/30">
              <p className="text-xs text-muted-foreground">
                Bulk add. County / state / zoning inherit from the parent. Acreage required; pricing optional.
              </p>
              <div className="space-y-2">
                {draftLots.map((d, idx) => (
                  <div key={idx} className="grid grid-cols-3 gap-2">
                    <div>
                      <Label className="text-xs">Lot #</Label>
                      <Input
                        value={d.childLotNumber}
                        onChange={(e) => {
                          const next = [...draftLots]; next[idx] = { ...next[idx], childLotNumber: e.target.value }; setDraftLots(next);
                        }}
                        placeholder="Lot 1"
                        className="h-8"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Acres</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={d.sizeAcres}
                        onChange={(e) => {
                          const next = [...draftLots]; next[idx] = { ...next[idx], sizeAcres: e.target.value }; setDraftLots(next);
                        }}
                        placeholder="2.5"
                        className="h-8"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">List price (optional)</Label>
                      <Input
                        type="number"
                        value={d.listPrice}
                        onChange={(e) => {
                          const next = [...draftLots]; next[idx] = { ...next[idx], listPrice: e.target.value }; setDraftLots(next);
                        }}
                        placeholder="55000"
                        className="h-8"
                      />
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between gap-2 pt-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDraftLots((d) => [...d, { childLotNumber: "", sizeAcres: "", listPrice: "" }])}
                >
                  + another row
                </Button>
                <p className="text-xs text-muted-foreground">
                  {totalDraftAcres > 0
                    ? `${totalDraftAcres.toFixed(2)} ac (${
                        data.parent.sizeAcres
                          ? `${((totalDraftAcres / parseFloat(data.parent.sizeAcres)) * 100).toFixed(0)}% of parent`
                          : ""
                      })`
                    : ""}
                </p>
                <Button
                  size="sm"
                  disabled={createLots.isPending || draftLots.some((d) => !d.childLotNumber || !parseFloat(d.sizeAcres))}
                  onClick={() => {
                    createLots.mutate(
                      draftLots.map((d) => ({
                        childLotNumber: d.childLotNumber.trim(),
                        sizeAcres: parseFloat(d.sizeAcres),
                        listPrice: d.listPrice ? parseFloat(d.listPrice) : undefined,
                      })),
                    );
                  }}
                >
                  Create {draftLots.length} lot{draftLots.length === 1 ? "" : "s"}
                </Button>
              </div>
            </div>
          )}

          {data.children.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              No child lots yet. Add lots above once the plat is recorded (or earlier, with placeholder APNs).
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-muted-foreground border-b border-border">
                    <th className="px-2 py-2 text-left font-medium">Lot</th>
                    <th className="px-2 py-2 text-left font-medium">APN</th>
                    <th className="px-2 py-2 text-right font-medium">Acres</th>
                    <th className="px-2 py-2 text-left font-medium">Status</th>
                    <th className="px-2 py-2 text-right font-medium">List</th>
                    <th className="px-2 py-2 text-right font-medium">Sold</th>
                    <th className="px-2 py-2 text-right font-medium">Basis</th>
                    <th className="px-2 py-2 text-right font-medium">DOM</th>
                    <th className="px-2 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {data.children.map((c) => {
                    const b = statusBadge(c.status);
                    return (
                      <tr key={c.id} className="border-b border-border/40">
                        <td className="px-2 py-2 font-medium">{c.childLotNumber ?? "—"}</td>
                        <td className="px-2 py-2 text-xs font-mono text-muted-foreground truncate max-w-[8rem]">{c.apn}</td>
                        <td className="px-2 py-2 text-right">{fmtAcres(c.sizeAcres)}</td>
                        <td className="px-2 py-2"><Badge variant={b.tone}>{b.label}</Badge></td>
                        <td className="px-2 py-2 text-right">{fmtUsdString(c.listPrice)}</td>
                        <td className="px-2 py-2 text-right">{fmtUsdString(c.soldPrice)}</td>
                        <td className="px-2 py-2 text-right text-muted-foreground">{fmtUsdCents(c.allocatedBasisCents)}</td>
                        <td className="px-2 py-2 text-right text-muted-foreground">{c.daysOnMarket ?? "—"}</td>
                        <td className="px-2 py-2 text-right">
                          <a href={`/parcels/${c.id}`} className="text-primary inline-flex items-center text-xs gap-1">
                            Open <ArrowRight className="w-3 h-3" aria-hidden="true" />
                          </a>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Permit checklists (SD-3) */}
      <PermitChecklistsSection parentParcelId={parentParcelId} />

      {/* Cost-basis allocation (SD-4) */}
      <BasisAllocationSection
        parentParcelId={parentParcelId}
        parentBasisCents={data.metrics.parentBasisCents}
        children={data.children}
      />

      {/* SD-7: subdivision plans (A/B) */}
      <SubdivisionPlansSection parentParcelId={parentParcelId} />

      {/* SD-5: pricing grid link */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Asking-price grid</CardTitle>
          <CardDescription>
            Define premium rules (corner +10%, frontage &gt; 150ft +8%, water +15%, …)
            and apply them across every child lot.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <a
            href={`/lot-pricing?parcelId=${parentParcelId}`}
            className="text-sm text-primary inline-flex items-center gap-1"
          >
            Open pricing rules editor <ArrowRight className="w-3 h-3" aria-hidden="true" />
          </a>
        </CardContent>
      </Card>

      <Separator />
      <p className="text-xs text-muted-foreground">
        Saved subdivision plans + GeoJSON storage land in SD-7.
      </p>
    </div>
  );
}

// ---------- SD-3: permit checklists section ----------

interface PermitGate {
  id: string;
  sequence: number;
  gateKey: string;
  label: string;
  status: string;
  submittedAt: string | null;
  expectedReturnAt: string | null;
  completedAt: string | null;
  feeCents: number | null;
  contactName: string | null;
  notes: string | null;
}

interface PermitChecklist {
  id: string;
  title: string | null;
  countyState: string;
  countyName: string;
  templateKey: string | null;
  completedAt: string | null;
  completedCount: number;
  stalledCount: number;
  gates: PermitGate[];
}

interface PermitTemplate {
  templateKey: string;
  state: string;
  county: string;
  description: string;
  gateCount: number;
}

const GATE_STATUS_OPTIONS = [
  "not_started", "submitted", "in_review", "approved", "rejected", "on_hold", "skipped",
] as const;

function gateBadge(status: string): { label: string; tone: "default" | "secondary" | "outline" | "destructive" } {
  if (status === "approved") return { label: "Approved", tone: "secondary" };
  if (status === "submitted") return { label: "Submitted", tone: "default" };
  if (status === "in_review") return { label: "In review", tone: "default" };
  if (status === "rejected") return { label: "Rejected", tone: "destructive" };
  if (status === "on_hold") return { label: "On hold", tone: "destructive" };
  if (status === "skipped") return { label: "N/A", tone: "outline" };
  return { label: "Not started", tone: "outline" };
}

function isStalled(g: PermitGate): boolean {
  if (!g.expectedReturnAt) return false;
  if (g.status !== "submitted" && g.status !== "in_review") return false;
  return new Date(g.expectedReturnAt).getTime() < Date.now();
}

function PermitChecklistsSection({ parentParcelId }: { parentParcelId: number }) {
  const { toast } = useToast();
  const [templateKey, setTemplateKey] = useState<string>("");

  const checklists = useQuery<{ checklists: PermitChecklist[] }>({
    queryKey: ["/api/parcels", parentParcelId, "permits"],
    queryFn: async () => {
      const res = await fetch(`/api/parcels/${parentParcelId}/permits`, { credentials: "include" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return res.json();
    },
  });

  const templates = useQuery<{ templates: PermitTemplate[] }>({
    queryKey: ["/api/permit-templates"],
    queryFn: async () => {
      const res = await fetch("/api/permit-templates", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return res.json();
    },
  });

  const createChecklist = useMutation({
    mutationFn: async (key: string) => {
      const csrf = decodeURIComponent(document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/)?.[1] || "");
      const res = await fetch(`/api/parcels/${parentParcelId}/permits`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "x-csrf-token": csrf },
        body: JSON.stringify({ templateKey: key }),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(detail.message ?? `Failed (${res.status})`);
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Permit checklist created" });
      queryClient.invalidateQueries({ queryKey: ["/api/parcels", parentParcelId, "permits"] });
      setTemplateKey("");
    },
    onError: (err: any) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const updateGate = useMutation({
    mutationFn: async (vars: { gateId: string; updates: Partial<PermitGate & { submittedAtIso: string }> }) => {
      const csrf = decodeURIComponent(document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/)?.[1] || "");
      const res = await fetch(`/api/permit-gates/${vars.gateId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json", "x-csrf-token": csrf },
        body: JSON.stringify(vars.updates),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(detail.message ?? `Failed (${res.status})`);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/parcels", parentParcelId, "permits"] });
    },
    onError: (err: any) => toast({ title: "Could not update gate", description: err.message, variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ClipboardList className="w-4 h-4" aria-hidden="true" />
          Permit checklists
        </CardTitle>
        <CardDescription>
          County-by-county subdivision gates. Status flips here propagate to the
          org-wide /permits dashboard.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {checklists.isLoading ? (
          <Skeleton className="h-24" />
        ) : checklists.data && checklists.data.checklists.length > 0 ? (
          <div className="space-y-4">
            {checklists.data.checklists.map((cl) => (
              <div key={cl.id} className="border rounded-md p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">{cl.title ?? `${cl.countyName}, ${cl.countyState}`}</p>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">
                      {cl.completedCount} / {cl.gates.length} done
                    </Badge>
                    {cl.stalledCount > 0 && (
                      <Badge variant="destructive" className="text-xs">
                        {cl.stalledCount} stalled
                      </Badge>
                    )}
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-muted-foreground border-b border-border/60">
                        <th className="px-2 py-1 text-left font-medium w-12">#</th>
                        <th className="px-2 py-1 text-left font-medium">Gate</th>
                        <th className="px-2 py-1 text-left font-medium">Status</th>
                        <th className="px-2 py-1 text-left font-medium">Submitted</th>
                        <th className="px-2 py-1 text-left font-medium">Expected back</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cl.gates.map((g) => {
                        const b = gateBadge(g.status);
                        const stalled = isStalled(g);
                        return (
                          <tr key={g.id} className="border-b border-border/40">
                            <td className="px-2 py-1 text-muted-foreground">{g.sequence}</td>
                            <td className="px-2 py-1">
                              <span className="font-medium">{g.label}</span>
                              {g.feeCents !== null && (
                                <span className="text-muted-foreground ml-2">${(g.feeCents / 100).toLocaleString()}</span>
                              )}
                            </td>
                            <td className="px-2 py-1">
                              <Select
                                value={g.status}
                                onValueChange={(next) => {
                                  const updates: any = { status: next };
                                  if (next === "submitted" && !g.submittedAt) {
                                    updates.submittedAt = new Date().toISOString().slice(0, 10);
                                  }
                                  if (next === "approved" && !g.completedAt) {
                                    updates.completedAt = new Date().toISOString().slice(0, 10);
                                  }
                                  updateGate.mutate({ gateId: g.id, updates });
                                }}
                              >
                                <SelectTrigger className="h-7 w-[140px] text-xs">
                                  <SelectValue>
                                    <Badge variant={b.tone} className="text-xs">{b.label}</Badge>
                                  </SelectValue>
                                </SelectTrigger>
                                <SelectContent>
                                  {GATE_STATUS_OPTIONS.map((s) => (
                                    <SelectItem key={s} value={s}>{s.replace(/_/g, " ")}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </td>
                            <td className="px-2 py-1 text-muted-foreground">{g.submittedAt ?? "—"}</td>
                            <td className={`px-2 py-1 ${stalled ? "text-acr-warning font-semibold" : "text-muted-foreground"}`}>
                              {g.expectedReturnAt ?? "—"}
                              {stalled && (
                                <span className="ml-1 inline-flex items-center"><Clock className="w-3 h-3" aria-hidden="true" /></span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground py-3">
            No permit checklists yet. Pick a county template below to instantiate one.
          </p>
        )}

        <div className="flex items-end gap-2 pt-2 border-t border-border/40">
          <div className="flex-1">
            <Label className="text-xs">Add checklist from template</Label>
            <Select value={templateKey} onValueChange={setTemplateKey}>
              <SelectTrigger className="h-9 text-xs">
                <SelectValue placeholder="Pick a template…" />
              </SelectTrigger>
              <SelectContent>
                {templates.data?.templates.map((t) => (
                  <SelectItem key={t.templateKey} value={t.templateKey}>
                    {t.state === "*" ? "Generic" : `${t.county}, ${t.state}`} — {t.gateCount} gates
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            size="sm"
            disabled={!templateKey || createChecklist.isPending}
            onClick={() => createChecklist.mutate(templateKey)}
          >
            <PlusCircle className="w-4 h-4 mr-1" aria-hidden="true" />
            Create
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------- SD-4: cost-basis allocation section ----------

interface AllocationRow {
  id: string;
  childParcelId: number;
  method: string;
  numerator: string;
  denominator: string;
  sharePct: string;
  allocatedBasisCents: number;
  realizedAt: string | null;
  realizedSalePriceCents: number | null;
  realizedCogsCents: number | null;
}

function BasisAllocationSection({
  parentParcelId,
  parentBasisCents,
  children,
}: {
  parentParcelId: number;
  parentBasisCents: number | null;
  children: ChildLot[];
}) {
  const { toast } = useToast();
  const [method, setMethod] = useState<"acreage" | "frontage" | "appraisal" | "override">("acreage");
  // Per-child typed inputs for the three non-acreage methods. Keyed by
  // child parcel id (string) to match the server contract.
  const [frontages, setFrontages] = useState<Record<string, string>>({});
  const [appraisals, setAppraisals] = useState<Record<string, string>>({});
  const [overrides, setOverrides] = useState<Record<string, string>>({});

  const allocs = useQuery<{ allocations: AllocationRow[] }>({
    queryKey: ["/api/parcels", parentParcelId, "basis-allocation"],
    queryFn: async () => {
      const res = await fetch(`/api/parcels/${parentParcelId}/basis-allocation`, { credentials: "include" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return res.json();
    },
  });

  // Override shares must sum to ~1.0; surface a live total for the operator.
  const overrideSum = useMemo(
    () => Object.values(overrides).reduce((s, v) => s + (parseFloat(v) || 0), 0),
    [overrides],
  );

  const allocate = useMutation({
    mutationFn: async () => {
      const csrf = decodeURIComponent(document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/)?.[1] || "");
      const body: Record<string, unknown> = { method };
      if (method === "frontage") {
        const fts: Record<string, number> = {};
        for (const c of children) fts[String(c.id)] = parseFloat(frontages[String(c.id)] ?? "") || 0;
        body.frontages = fts;
      } else if (method === "appraisal") {
        const aps: Record<string, number> = {};
        for (const c of children) aps[String(c.id)] = parseFloat(appraisals[String(c.id)] ?? "") || 0;
        body.appraisals = aps;
      } else if (method === "override") {
        const ovs: Record<string, number> = {};
        for (const c of children) ovs[String(c.id)] = parseFloat(overrides[String(c.id)] ?? "") || 0;
        body.overrides = ovs;
      }
      const res = await fetch(`/api/parcels/${parentParcelId}/basis-allocation`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "x-csrf-token": csrf },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(detail.message ?? `Failed (${res.status})`);
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Basis allocated", description: `Method: ${method}` });
      queryClient.invalidateQueries({ queryKey: ["/api/parcels", parentParcelId, "basis-allocation"] });
      queryClient.invalidateQueries({ queryKey: ["/api/parcels", parentParcelId, "subdivision"] });
    },
    onError: (err: any) => toast({ title: "Could not allocate", description: err.message, variant: "destructive" }),
  });

  const allocByChild = useMemo(() => {
    const m = new Map<number, AllocationRow>();
    for (const a of allocs.data?.allocations ?? []) m.set(a.childParcelId, a);
    return m;
  }, [allocs.data]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Basis allocation (COGS at sale)</CardTitle>
        <CardDescription>
          Splits the parent's purchase price across child lots so your CPA gets
          basis-per-lot at every closing. Lots held as inventory aren't depreciated —
          basis converts to COGS when the lot sells.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {parentBasisCents === null ? (
          <p className="text-sm text-muted-foreground">
            Add a purchase price on the parent parcel before allocating basis.
          </p>
        ) : children.length === 0 ? (
          <p className="text-sm text-muted-foreground">Add child lots first.</p>
        ) : (
          <>
            <div className="flex items-end gap-2">
              <div>
                <Label className="text-xs">Method</Label>
                <Select value={method} onValueChange={(v) => setMethod(v as any)}>
                  <SelectTrigger className="h-9 w-[180px] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="acreage">Acreage (default)</SelectItem>
                    <SelectItem value="frontage">Frontage (road feet)</SelectItem>
                    <SelectItem value="appraisal">Appraisal (per-lot value)</SelectItem>
                    <SelectItem value="override">Override (typed shares)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button
                size="sm"
                onClick={() => allocate.mutate()}
                disabled={
                  allocate.isPending ||
                  (method === "override" && Math.abs(overrideSum - 1) > 0.001)
                }
              >
                {allocs.data?.allocations.length ? "Re-allocate" : "Allocate"} basis
              </Button>
            </div>

            {/* Per-child inputs for non-acreage methods. */}
            {method === "frontage" && (
              <div className="rounded-md border border-border/60 p-2">
                <p className="text-xs text-muted-foreground mb-2">
                  Road frontage in feet per lot. CPAs often prefer this for road-front lots.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {children.map((c) => (
                    <div key={c.id} className="flex items-center gap-2">
                      <Label className="text-xs w-24 shrink-0">{c.childLotNumber ?? c.apn}</Label>
                      <Input
                        type="number"
                        min="0"
                        step="1"
                        inputMode="numeric"
                        className="h-8 text-xs"
                        value={frontages[String(c.id)] ?? ""}
                        onChange={(e) => setFrontages((s) => ({ ...s, [String(c.id)]: e.target.value }))}
                        placeholder="ft"
                        aria-label={`Frontage feet for lot ${c.childLotNumber ?? c.apn}`}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {method === "appraisal" && (
              <div className="rounded-md border border-border/60 p-2">
                <p className="text-xs text-muted-foreground mb-2">
                  Appraised value per lot (dollars). Shares are normalized at allocation.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {children.map((c) => (
                    <div key={c.id} className="flex items-center gap-2">
                      <Label className="text-xs w-24 shrink-0">{c.childLotNumber ?? c.apn}</Label>
                      <Input
                        type="number"
                        min="0"
                        step="1"
                        inputMode="decimal"
                        className="h-8 text-xs"
                        value={appraisals[String(c.id)] ?? ""}
                        onChange={(e) => setAppraisals((s) => ({ ...s, [String(c.id)]: e.target.value }))}
                        placeholder="$"
                        aria-label={`Appraisal for lot ${c.childLotNumber ?? c.apn}`}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {method === "override" && (
              <div className="rounded-md border border-border/60 p-2">
                <p className="text-xs text-muted-foreground mb-2">
                  Per-lot share as a decimal (e.g. 0.15 = 15%). Total must equal 1.0.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {children.map((c) => (
                    <div key={c.id} className="flex items-center gap-2">
                      <Label className="text-xs w-24 shrink-0">{c.childLotNumber ?? c.apn}</Label>
                      <Input
                        type="number"
                        min="0"
                        max="1"
                        step="0.0001"
                        inputMode="decimal"
                        className="h-8 text-xs"
                        value={overrides[String(c.id)] ?? ""}
                        onChange={(e) => setOverrides((s) => ({ ...s, [String(c.id)]: e.target.value }))}
                        placeholder="0.0833"
                        aria-label={`Override share for lot ${c.childLotNumber ?? c.apn}`}
                      />
                    </div>
                  ))}
                </div>
                <p className={`text-xs mt-2 ${Math.abs(overrideSum - 1) > 0.001 ? "text-acr-warning" : "text-acr-pos"}`}>
                  Total share: {overrideSum.toFixed(4)} {Math.abs(overrideSum - 1) > 0.001 ? "(must be 1.0000)" : "✓"}
                </p>
              </div>
            )}

            {allocs.data && allocs.data.allocations.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-muted-foreground border-b border-border/60">
                      <th className="px-2 py-1 text-left font-medium">Lot</th>
                      <th className="px-2 py-1 text-right font-medium">Share</th>
                      <th className="px-2 py-1 text-right font-medium">Allocated basis</th>
                      <th className="px-2 py-1 text-right font-medium">Sale</th>
                      <th className="px-2 py-1 text-right font-medium">Gain</th>
                    </tr>
                  </thead>
                  <tbody>
                    {children.map((c) => {
                      const a = allocByChild.get(c.id);
                      const gain = a?.realizedSalePriceCents != null && a.realizedCogsCents != null
                        ? a.realizedSalePriceCents - a.realizedCogsCents
                        : null;
                      return (
                        <tr key={c.id} className="border-b border-border/40">
                          <td className="px-2 py-1 font-medium">{c.childLotNumber ?? c.apn}</td>
                          <td className="px-2 py-1 text-right">{a ? `${(parseFloat(a.sharePct) * 100).toFixed(2)}%` : "—"}</td>
                          <td className="px-2 py-1 text-right">{fmtUsdCents(a?.allocatedBasisCents ?? null)}</td>
                          <td className="px-2 py-1 text-right">{fmtUsdCents(a?.realizedSalePriceCents ?? null)}</td>
                          <td className={`px-2 py-1 text-right ${gain != null && gain > 0 ? "text-acr-pos" : gain != null && gain < 0 ? "text-acr-neg" : ""}`}>
                            {gain != null ? fmtUsdCents(gain) : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ---------- SD-7: subdivision plans section ----------

interface SubdivisionPlanRow {
  id: string;
  name: string;
  versionNumber: number;
  status: string;
  lotCount: number | null;
  totalAcres: string | null;
  totalRoadFeet: number | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

const PLAN_STATUS_OPTIONS = [
  "draft", "engineer_review", "county_submitted", "recorded", "abandoned",
] as const;

function planStatusBadge(s: string): "default" | "secondary" | "outline" | "destructive" {
  if (s === "recorded") return "secondary";
  if (s === "abandoned") return "destructive";
  if (s === "county_submitted") return "default";
  return "outline";
}

function SubdivisionPlansSection({ parentParcelId }: { parentParcelId: number }) {
  const { toast } = useToast();
  const [newName, setNewName] = useState("");
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null);

  const plans = useQuery<{ plans: SubdivisionPlanRow[] }>({
    queryKey: ["/api/parcels", parentParcelId, "plans"],
    queryFn: async () => {
      const res = await fetch(`/api/parcels/${parentParcelId}/plans`, { credentials: "include" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return res.json();
    },
  });

  const csrf = () => decodeURIComponent(document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/)?.[1] || "");

  const createPlan = useMutation({
    mutationFn: async (name: string) => {
      const res = await fetch(`/api/parcels/${parentParcelId}/plans`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "x-csrf-token": csrf() },
        body: JSON.stringify({ name, status: "draft" }),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(detail.message ?? `Failed (${res.status})`);
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Plan created" });
      queryClient.invalidateQueries({ queryKey: ["/api/parcels", parentParcelId, "plans"] });
      setNewName("");
    },
    onError: (err: any) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  // Optimistic plan-status flip — Select shows new state instantly in
  // every cached plans list. Rolls back if the PATCH fails.
  const updateStatus = useOptimisticUpdate<{ id: string; status: string; parentParcelId: number }>({
    mutationFn: async ({ id, status }) => {
      const res = await fetch(`/api/plans/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json", "x-csrf-token": csrf() },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return res.json();
    },
    listKeys: [({ parentParcelId: ppid }) => ["/api/parcels", ppid, "plans"]],
    getId: ({ id }) => id,
    buildPatch: ({ status }) => ({ status }),
    successToast: false,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Subdivision plans (A/B)</CardTitle>
        <CardDescription>
          Save multiple lot configurations per parent parcel (e.g. "Plan A — 12 lots,"
          "Plan B — 8 lots, two estate"). Versions auto-increment when GeoJSON
          changes so previous plans stay intact.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {plans.isLoading ? (
          <Skeleton className="h-20" />
        ) : plans.data && plans.data.plans.length > 0 ? (
          <div className="space-y-2">
            {plans.data.plans.map((p) => (
              <div key={p.id} className="flex items-center justify-between border rounded-md p-2 text-sm">
                <div className="flex-1">
                  <p className="font-medium">{p.name} <span className="text-xs text-muted-foreground">v{p.versionNumber}</span></p>
                  <p className="text-xs text-muted-foreground">
                    {p.lotCount ?? "—"} lot{p.lotCount === 1 ? "" : "s"}
                    {p.totalAcres ? ` · ${parseFloat(p.totalAcres).toFixed(2)} ac` : ""}
                    {p.totalRoadFeet ? ` · ${p.totalRoadFeet} ft road` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={() => setEditingPlanId(editingPlanId === p.id ? null : p.id)}
                  >
                    {editingPlanId === p.id ? "Close map" : "Edit on map"}
                  </Button>
                  <Select value={p.status} onValueChange={(s) => updateStatus.mutate({ id: p.id, status: s, parentParcelId })}>
                    <SelectTrigger className="h-7 w-[160px] text-xs">
                      <SelectValue>
                        <Badge variant={planStatusBadge(p.status)} className="text-xs">{p.status.replace(/_/g, " ")}</Badge>
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {PLAN_STATUS_OPTIONS.map((s) => <SelectItem key={s} value={s}>{s.replace(/_/g, " ")}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No plans yet.</p>
        )}

        {/* CT-2: mapbox-gl-draw editor renders inline when a plan is opened. */}
        {editingPlanId && <SubdivisionPlanEditor planId={editingPlanId} />}

        <div className="flex gap-2 pt-2 border-t border-border/40">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Plan A — 12 lots"
            className="h-9"
          />
          <Button size="sm" disabled={!newName.trim() || createPlan.isPending} onClick={() => createPlan.mutate(newName.trim())}>
            <PlusCircle className="w-4 h-4 mr-1" aria-hidden="true" /> Create plan
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          GeoJSON polygon-draw on the map ships next. Until then, plans are
          named placeholders — save them now so Earl's comments land in the right spot.
        </p>
      </CardContent>
    </Card>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "pos" | "warn" }) {
  const toneClass = tone === "pos" ? "text-acr-pos" : tone === "warn" ? "text-acr-warning" : "";
  return (
    <Card className="p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-xl font-semibold tracking-tight mt-1 ${toneClass}`}>{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
    </Card>
  );
}
