/**
 * ARV calculator card on /parcels/:id (FF-4).
 *
 * Devon §2.9: "An AVM is not an ARV. […] ARV needs a workflow: pick three
 * sold comps within 0.5 mi in the last 6 months, adjust per square foot,
 * apply your contractor's scope of work, output an ARV with a confidence
 * band."
 */

import { useId, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Calculator, PlusCircle, Trash2, AlertTriangle } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";

interface CompInput {
  address: string;
  soldPriceDollars: string;
  soldDate: string;
  sqft: string;
  distanceMiles: string;
  conditionRating: string;
}

interface ArvRecord {
  id: string;
  arvLowCents: number;
  arvMidCents: number;
  arvHighCents: number;
  pricePerSqftMidCents: number | null;
  confidence: string | null;
  subjectSqft: number | null;
  compsUsed: any[];
  notes: string | null;
  createdAt: string;
}

function fmtUsd(c: number | null | undefined): string {
  if (c === null || c === undefined) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(c / 100);
}

function csrfHeader(): Record<string, string> {
  const m = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/);
  return { "Content-Type": "application/json", "x-csrf-token": decodeURIComponent(m?.[1] ?? "") };
}

const emptyComp = (): CompInput => ({
  address: "", soldPriceDollars: "", soldDate: "", sqft: "", distanceMiles: "", conditionRating: "3",
});

/**
 * Mounted on /parcels/:id (pre-rehab pricing) and on /rehabs/:id (the
 * active project tied to a property). When the rehab variant mounts, pass
 * rehabId — the POST body forwards it so arv_calculations.rehab_id is
 * populated on write. NOT NULL on rehab_id is deferred to a separate
 * migration once the backfill of pre-rehab ARV rows lands.
 */
export function ArvCalculator({ propertyId, rehabId }: { propertyId: number; rehabId?: string }) {
  // Every Label below is paired to its Input with htmlFor/id. A visible label
  // that is not ASSOCIATED is announced by a screen reader as nothing at all —
  // the input has no accessible name, however obvious the text beside it looks.
  // useId rather than literals so two calculators on one page cannot collide.
  const uid = useId();
  const { toast } = useToast();
  const [subjectSqft, setSubjectSqft] = useState("");
  const [subjectCondition, setSubjectCondition] = useState("4");
  const [comps, setComps] = useState<CompInput[]>([emptyComp(), emptyComp(), emptyComp()]);
  const [methodology, setMethodology] = useState("");

  const current = useQuery<{ arv: ArvRecord | null }>({
    queryKey: ["/api/parcels", propertyId, "arv"],
    queryFn: async () => {
      const res = await fetch(`/api/parcels/${propertyId}/arv`, { credentials: "include" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return res.json();
    },
  });

  const calc = useMutation({
    mutationFn: async () => {
      const validComps = comps
        .filter((c) => parseFloat(c.soldPriceDollars) > 0)
        .map((c) => ({
          address: c.address || undefined,
          soldPriceCents: Math.round(parseFloat(c.soldPriceDollars) * 100),
          soldDate: c.soldDate || undefined,
          sqft: c.sqft ? parseInt(c.sqft, 10) : undefined,
          distanceMiles: c.distanceMiles ? parseFloat(c.distanceMiles) : undefined,
          conditionRating: c.conditionRating ? parseInt(c.conditionRating, 10) : undefined,
        }));
      if (validComps.length === 0) throw new Error("Need at least one comp.");

      const res = await fetch(`/api/parcels/${propertyId}/arv`, {
        method: "POST", credentials: "include", headers: csrfHeader(),
        body: JSON.stringify({
          comps: validComps,
          subjectSqft: subjectSqft ? parseInt(subjectSqft, 10) : undefined,
          subjectConditionRating: parseInt(subjectCondition, 10),
          methodology,
          // Populated only when mounted from rehab-detail. The POST handler
          // (server/routes-arv.ts) already accepts an optional rehabId and
          // persists it to arv_calculations.rehab_id.
          rehabId,
        }),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(detail.message ?? `Failed (${res.status})`);
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "ARV computed" });
      queryClient.invalidateQueries({ queryKey: ["/api/parcels", propertyId, "arv"] });
    },
    onError: (err: any) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      <Card className="border-acr-warn-soft bg-acr-warn-soft/10">
        <CardContent className="p-3 flex items-start gap-2 text-xs text-muted-foreground">
          <AlertTriangle className="w-4 h-4 text-acr-warning mt-0.5 shrink-0" aria-hidden="true" />
          <div>
            <strong>ARV is not AVM.</strong> The AVM in enrichment data tells you what
            the property is worth today, in distressed condition. ARV is what
            it'll be worth post-rehab. Compute ARV here from your own comps.
          </div>
        </CardContent>
      </Card>

      {current.isLoading ? (
        <Skeleton className="h-32" />
      ) : current.data?.arv ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Calculator className="w-4 h-4" aria-hidden="true" /> Current ARV
              {current.data.arv.confidence && (
                <Badge variant={current.data.arv.confidence === "high" ? "default" : current.data.arv.confidence === "medium" ? "outline" : "destructive"} className="text-xs">
                  {current.data.arv.confidence} confidence
                </Badge>
              )}
            </CardTitle>
            <CardDescription>
              Based on {current.data.arv.compsUsed.length} comp{current.data.arv.compsUsed.length === 1 ? "" : "s"} ·
              {current.data.arv.subjectSqft ? ` ${current.data.arv.subjectSqft} sqft subject` : " sqft not specified"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-3">
              <div><div className="text-xs text-muted-foreground">Low</div><div className="text-xl font-semibold">{fmtUsd(current.data.arv.arvLowCents)}</div></div>
              <div><div className="text-xs text-muted-foreground">Expected</div><div className="text-2xl font-bold text-acr-pos">{fmtUsd(current.data.arv.arvMidCents)}</div></div>
              <div><div className="text-xs text-muted-foreground">High</div><div className="text-xl font-semibold">{fmtUsd(current.data.arv.arvHighCents)}</div></div>
            </div>
            {current.data.arv.pricePerSqftMidCents !== null && (
              <div className="text-xs text-muted-foreground mt-3">
                ${(current.data.arv.pricePerSqftMidCents / 100).toFixed(0)}/sqft expected
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <p className="text-sm text-muted-foreground">No ARV computed yet. Add comps below.</p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Compute new ARV</CardTitle>
          <CardDescription>
            3-5 sold comps within 0.5mi in the last 6 months for high confidence.
            Distance + sold-date drive the confidence band.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3 max-w-md">
            <div>
              <Label htmlFor={`${uid}-subject-sqft`} className="text-xs">Subject sqft</Label>
              <Input id={`${uid}-subject-sqft`} type="number" value={subjectSqft} onChange={(e) => setSubjectSqft(e.target.value)} className="h-9" placeholder="1500" />
            </div>
            <div>
              <Label htmlFor={`${uid}-subject-condition`} className="text-xs">Subject post-rehab condition (1-5)</Label>
              <Input id={`${uid}-subject-condition`} type="number" min="1" max="5" value={subjectCondition} onChange={(e) => setSubjectCondition(e.target.value)} className="h-9" />
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-semibold">Comps</p>
            {comps.map((c, idx) => (
              <div key={idx} className="grid grid-cols-12 gap-2 items-end">
                <div className="col-span-3">
                  <Label htmlFor={`${uid}-comp-${idx}-address`} className="text-xs">Address</Label>
                  <Input id={`${uid}-comp-${idx}-address`} value={c.address} onChange={(e) => { const next = [...comps]; next[idx].address = e.target.value; setComps(next); }} className="h-8 text-xs" />
                </div>
                <div className="col-span-2">
                  <Label htmlFor={`${uid}-comp-${idx}-sold`} className="text-xs">Sold ($)</Label>
                  <Input id={`${uid}-comp-${idx}-sold`} type="number" value={c.soldPriceDollars} onChange={(e) => { const next = [...comps]; next[idx].soldPriceDollars = e.target.value; setComps(next); }} className="h-8 text-xs" />
                </div>
                <div className="col-span-2">
                  <Label htmlFor={`${uid}-comp-${idx}-sold-date`} className="text-xs">Sold date</Label>
                  <Input id={`${uid}-comp-${idx}-sold-date`} type="date" value={c.soldDate} onChange={(e) => { const next = [...comps]; next[idx].soldDate = e.target.value; setComps(next); }} className="h-8 text-xs" />
                </div>
                <div className="col-span-1">
                  <Label htmlFor={`${uid}-comp-${idx}-sqft`} className="text-xs">Sqft</Label>
                  <Input id={`${uid}-comp-${idx}-sqft`} type="number" value={c.sqft} onChange={(e) => { const next = [...comps]; next[idx].sqft = e.target.value; setComps(next); }} className="h-8 text-xs" />
                </div>
                <div className="col-span-2">
                  <Label htmlFor={`${uid}-comp-${idx}-distance`} className="text-xs">Distance (mi)</Label>
                  <Input id={`${uid}-comp-${idx}-distance`} type="number" step="0.1" value={c.distanceMiles} onChange={(e) => { const next = [...comps]; next[idx].distanceMiles = e.target.value; setComps(next); }} className="h-8 text-xs" />
                </div>
                <div className="col-span-1">
                  <Label htmlFor={`${uid}-comp-${idx}-condition`} className="text-xs">Cond.</Label>
                  <Input id={`${uid}-comp-${idx}-condition`} type="number" min="1" max="5" value={c.conditionRating} onChange={(e) => { const next = [...comps]; next[idx].conditionRating = e.target.value; setComps(next); }} className="h-8 text-xs" />
                </div>
                <div className="col-span-1 flex justify-end">
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setComps(comps.filter((_, i) => i !== idx))} aria-label="Remove comp">
                    <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                  </Button>
                </div>
              </div>
            ))}
            <Button variant="ghost" size="sm" onClick={() => setComps([...comps, emptyComp()])}>
              <PlusCircle className="w-4 h-4 mr-1" aria-hidden="true" /> Add comp
            </Button>
          </div>

          <div>
            <Label htmlFor={`${uid}-methodology`} className="text-xs">Methodology / notes</Label>
            <Input id={`${uid}-methodology`} value={methodology} onChange={(e) => setMethodology(e.target.value)} className="h-9" placeholder="e.g. SFR-only, no flood-zone comps, post-rehab condition 4 = stainless + LVP + neutral paint" />
          </div>

          <Button onClick={() => calc.mutate()} disabled={calc.isPending}>
            <Calculator className="w-4 h-4 mr-1" aria-hidden="true" /> Compute ARV
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
