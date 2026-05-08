/**
 * /inspections/:id — single inspection detail w/ security-deposit reconcile (FW-4).
 *
 * Imelda §2.10: "every wall, every appliance, every floor, with a
 * timestamp, before I release the security deposit."
 *
 * BH-4 shipped the move_inspections table + the reconcile endpoint;
 * FW-4 ships the UI that surfaces deductions + computes refund.
 */

import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute } from "wouter";
import {
  ClipboardCheck, Camera, Calendar, User, AlertTriangle, PlusCircle, Trash2, Save,
} from "lucide-react";

import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";

interface ChecklistItem {
  area: string;
  condition: "excellent" | "good" | "fair" | "damaged";
  notes?: string;
  photoCount?: number;
}

interface InspectionDetail {
  inspection: {
    id: string;
    propertyId: number;
    leaseId: string | null;
    tenantId: string | null;
    kind: "move_in" | "move_out" | "annual" | "drive_by";
    inspectionDate: string;
    conductedBy: string | null;
    checklist: ChecklistItem[];
    photos: Array<{ url: string; caption?: string; area?: string; timestamp?: string }>;
    tenantSignedAt: string | null;
    landlordSignedAt: string | null;
    damagesTotalCents: number | null;
    notes: string | null;
  };
}

interface DeductionDraft {
  description: string;
  amountCents: string;
  category: string;
}

function fmtUsdCents(c: number | null | undefined): string {
  if (c === null || c === undefined) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(c / 100);
}

function csrf(): Record<string, string> {
  const m = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/);
  return { "Content-Type": "application/json", "x-csrf-token": decodeURIComponent(m?.[1] ?? "") };
}

function conditionTone(c: string): "default" | "secondary" | "outline" | "destructive" {
  if (c === "damaged") return "destructive";
  if (c === "fair") return "default";
  if (c === "excellent" || c === "good") return "secondary";
  return "outline";
}

export default function InspectionDetailPage() {
  useDocumentTitle("Inspection — AcreOS");
  const { toast } = useToast();
  const [, params] = useRoute("/inspections/:id");
  const id = params?.id ?? "";

  const detail = useQuery<InspectionDetail>({
    queryKey: ["/api/inspections", id],
    enabled: !!id,
    queryFn: async () => {
      const res = await fetch(`/api/inspections/${id}`, { credentials: "include" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return res.json();
    },
  });

  const signTenant = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/inspections/${id}/sign-tenant`, {
        method: "POST", credentials: "include", headers: csrf(), body: "{}",
      });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Tenant signature recorded" });
      queryClient.invalidateQueries({ queryKey: ["/api/inspections", id] });
    },
  });

  const signLandlord = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/inspections/${id}/sign-landlord`, {
        method: "POST", credentials: "include", headers: csrf(), body: "{}",
      });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Landlord signature recorded" });
      queryClient.invalidateQueries({ queryKey: ["/api/inspections", id] });
    },
  });

  if (!id) return <PageShell label="Inspection"><Card><CardContent>Invalid id</CardContent></Card></PageShell>;
  if (detail.isLoading) return <PageShell label="Inspection"><Skeleton className="h-32" /></PageShell>;
  if (!detail.data) return <PageShell label="Inspection"><Card><CardContent>Not found.</CardContent></Card></PageShell>;

  const { inspection } = detail.data;
  const damagedAreas = inspection.checklist.filter((c) => c.condition === "damaged");

  return (
    <PageShell label={`${inspection.kind.replace(/_/g, " ")} inspection`}>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <ClipboardCheck className="w-6 h-6 text-primary" aria-hidden="true" />
          {inspection.kind.replace(/_/g, " ")} inspection
        </h1>
        <div className="flex items-center gap-2 mt-2 text-sm text-muted-foreground">
          <Calendar className="w-3 h-3" aria-hidden="true" /> {inspection.inspectionDate}
          {inspection.conductedBy && (
            <>
              · <User className="w-3 h-3" aria-hidden="true" /> {inspection.conductedBy}
            </>
          )}
          <span>· Property #{inspection.propertyId}</span>
        </div>
      </div>

      {/* Signatures */}
      <Card className="mb-6">
        <CardHeader className="pb-2"><CardTitle className="text-base">Signatures</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 gap-3">
          <div>
            <div className="text-xs text-muted-foreground">Tenant</div>
            {inspection.tenantSignedAt ? (
              <Badge variant="default" className="text-xs">Signed {new Date(inspection.tenantSignedAt).toLocaleDateString()}</Badge>
            ) : (
              <Button size="sm" variant="outline" onClick={() => signTenant.mutate()} disabled={signTenant.isPending}>
                Record tenant signature
              </Button>
            )}
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Landlord</div>
            {inspection.landlordSignedAt ? (
              <Badge variant="default" className="text-xs">Signed {new Date(inspection.landlordSignedAt).toLocaleDateString()}</Badge>
            ) : (
              <Button size="sm" variant="outline" onClick={() => signLandlord.mutate()} disabled={signLandlord.isPending}>
                Record landlord signature
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Checklist */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Checklist ({inspection.checklist.length} areas)</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {inspection.checklist.length === 0 ? (
            <p className="px-4 py-3 text-sm text-muted-foreground">No checklist data.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted-foreground border-b border-border bg-muted/30">
                  <th className="px-3 py-2 text-left font-medium">Area</th>
                  <th className="px-3 py-2 text-left font-medium">Condition</th>
                  <th className="px-3 py-2 text-left font-medium">Notes</th>
                  <th className="px-3 py-2 text-right font-medium">Photos</th>
                </tr>
              </thead>
              <tbody>
                {inspection.checklist.map((c, i) => (
                  <tr key={i} className="border-b border-border/40">
                    <td className="px-3 py-2 font-medium">{c.area}</td>
                    <td className="px-3 py-2"><Badge variant={conditionTone(c.condition)} className="text-xs">{c.condition}</Badge></td>
                    <td className="px-3 py-2 text-muted-foreground text-xs">{c.notes ?? "—"}</td>
                    <td className="px-3 py-2 text-right text-muted-foreground">{c.photoCount ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* Photos */}
      {inspection.photos.length > 0 && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Camera className="w-4 h-4" aria-hidden="true" /> Photos ({inspection.photos.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {inspection.photos.map((p, i) => (
                <a key={i} href={p.url} target="_blank" rel="noreferrer" className="block">
                  <img src={p.url} alt={p.caption ?? p.area ?? `Photo ${i + 1}`} className="w-full h-32 object-cover rounded border" />
                  {p.caption && <p className="text-xs text-muted-foreground mt-1 truncate">{p.caption}</p>}
                </a>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Deposit reconciliation — only for move_out */}
      {inspection.kind === "move_out" && inspection.leaseId && (
        <SecurityDepositReconcile
          inspectionId={inspection.id}
          leaseId={inspection.leaseId}
          damagedAreas={damagedAreas}
        />
      )}
    </PageShell>
  );
}

interface DepositResponse {
  deposit: {
    id: string;
    leaseId: string;
    heldCents: number;
    deductions: Array<{ description: string; amountCents: number; category?: string }>;
    deductionsTotalCents: number | null;
    refundCents: number | null;
    refundedAt: string | null;
    statutoryDeadline: string | null;
  };
  refundCents: number;
  totalDeductions: number;
}

function SecurityDepositReconcile({
  inspectionId,
  leaseId,
  damagedAreas,
}: {
  inspectionId: string;
  leaseId: string;
  damagedAreas: ChecklistItem[];
}) {
  const { toast } = useToast();

  // Pre-populate one deduction per damaged area when starting fresh.
  const initialDeductions: DeductionDraft[] = useMemo(() => (
    damagedAreas.length > 0
      ? damagedAreas.map((d) => ({ description: `${d.area} damage`, amountCents: "0", category: d.area }))
      : [{ description: "", amountCents: "0", category: "" }]
  ), [damagedAreas]);

  const [deductions, setDeductions] = useState<DeductionDraft[]>(initialDeductions);

  // Pull the current deposit row to show heldCents.
  const lease = useQuery<{ lease: { securityDepositCents: number } }>({
    queryKey: ["/api/leases", leaseId],
    queryFn: async () => {
      const res = await fetch(`/api/leases/${leaseId}`, { credentials: "include" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return res.json();
    },
  });

  const reconcile = useMutation<DepositResponse, Error>({
    mutationFn: async () => {
      const cleanedDeductions = deductions
        .filter((d) => d.description.trim() && parseFloat(d.amountCents) > 0)
        .map((d) => ({
          description: d.description.trim(),
          amountCents: Math.round(parseFloat(d.amountCents) * 100),
          category: d.category.trim() || undefined,
        }));
      const res = await fetch(`/api/inspections/${inspectionId}/reconcile-deposit`, {
        method: "POST",
        credentials: "include",
        headers: csrf(),
        body: JSON.stringify({ deductions: cleanedDeductions }),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(detail.message ?? `Failed (${res.status})`);
      }
      return res.json();
    },
    onSuccess: (r: DepositResponse) => {
      toast({ title: "Deposit reconciled", description: `Refund: ${fmtUsdCents(r.refundCents)}` });
      queryClient.invalidateQueries({ queryKey: ["/api/inspections", inspectionId] });
    },
    onError: (err: any) => toast({ title: "Reconcile failed", description: err.message, variant: "destructive" }),
  });

  const heldCents = lease.data?.lease.securityDepositCents ?? null;
  const totalDeductionsCents = deductions.reduce((s, d) => {
    const v = parseFloat(d.amountCents);
    return s + (Number.isFinite(v) ? Math.round(v * 100) : 0);
  }, 0);
  const refundCents = heldCents !== null ? Math.max(0, heldCents - totalDeductionsCents) : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-acr-warning" aria-hidden="true" />
          Security-deposit reconciliation
        </CardTitle>
        <CardDescription>
          Move-out only. Damages from the checklist seed line items below — adjust amounts and add new lines, then save.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Tiles */}
        <div className="grid grid-cols-3 gap-3">
          <Card className="p-3">
            <div className="text-xs text-muted-foreground">Held</div>
            <div className="text-xl font-semibold">{fmtUsdCents(heldCents)}</div>
          </Card>
          <Card className="p-3">
            <div className="text-xs text-muted-foreground">Deductions</div>
            <div className="text-xl font-semibold text-acr-neg">{fmtUsdCents(totalDeductionsCents)}</div>
          </Card>
          <Card className="p-3">
            <div className="text-xs text-muted-foreground">Refund</div>
            <div className={`text-xl font-semibold ${refundCents === 0 ? "text-acr-warning" : "text-acr-pos"}`}>
              {fmtUsdCents(refundCents)}
            </div>
          </Card>
        </div>

        <Separator />

        <div className="space-y-2">
          {deductions.map((d, idx) => (
            <div key={idx} className="grid grid-cols-12 gap-2 items-end">
              <div className="col-span-6">
                <Label className="text-xs">Description</Label>
                <Input
                  value={d.description}
                  onChange={(e) => {
                    const next = [...deductions]; next[idx] = { ...next[idx], description: e.target.value }; setDeductions(next);
                  }}
                  className="h-8 text-xs"
                  placeholder="Carpet stain in master bedroom"
                />
              </div>
              <div className="col-span-3">
                <Label className="text-xs">Category</Label>
                <Input
                  value={d.category}
                  onChange={(e) => {
                    const next = [...deductions]; next[idx] = { ...next[idx], category: e.target.value }; setDeductions(next);
                  }}
                  className="h-8 text-xs"
                  placeholder="flooring"
                />
              </div>
              <div className="col-span-2">
                <Label className="text-xs">Amount ($)</Label>
                <Input
                  type="number"
                  value={d.amountCents}
                  onChange={(e) => {
                    const next = [...deductions]; next[idx] = { ...next[idx], amountCents: e.target.value }; setDeductions(next);
                  }}
                  className="h-8 text-xs text-right"
                />
              </div>
              <div className="col-span-1 flex justify-end">
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setDeductions(deductions.filter((_, i) => i !== idx))} aria-label="Remove line">
                  <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                </Button>
              </div>
            </div>
          ))}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setDeductions([...deductions, { description: "", amountCents: "0", category: "" }])}
          >
            <PlusCircle className="w-4 h-4 mr-1" aria-hidden="true" /> Add line
          </Button>
        </div>

        <Button onClick={() => reconcile.mutate()} disabled={reconcile.isPending}>
          <Save className="w-4 h-4 mr-1" aria-hidden="true" />
          {reconcile.isPending ? "Reconciling…" : "Reconcile deposit"}
        </Button>
      </CardContent>
    </Card>
  );
}
