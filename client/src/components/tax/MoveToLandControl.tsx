/**
 * "Move to Land inventory" — V-Tax-1 T4b (founder decision 2026-10-29: an
 * operator action, never automatic). Shown under the redemption clock once the
 * deed is held. It links the org's property for the same parcel or creates
 * one; the certificate's tax history goes with it. A created property needs
 * its acreage — from the lot's list, or stated here with where it came from.
 */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { MoveRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { ApiError, apiRequest, queryClient } from "@/lib/queryClient";

export function MoveToLandControl({ certificateId }: { certificateId: string }) {
  const { toast } = useToast();
  const [needsAcreage, setNeedsAcreage] = useState(false);
  const [acres, setAcres] = useState("");
  const [source, setSource] = useState("");
  const [linked, setLinked] = useState<{ propertyId: number; created: boolean } | null>(null);

  const move = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/tax-certificates/${certificateId}/move-to-land`, needsAcreage ? { sizeAcres: { value: acres.trim(), source: source.trim() } } : {});
      return (await res.json()) as { propertyId: number; created: boolean };
    },
    onSuccess: (r) => {
      setLinked(r);
      queryClient.invalidateQueries({ queryKey: ["/api/tax-certificates"] });
      queryClient.invalidateQueries({ queryKey: ["/api/properties"] });
      toast({ title: r.created ? "Added to Land inventory with its tax history" : "Linked to the parcel already in your Land inventory" });
    },
    onError: (err) => {
      const body = err instanceof ApiError ? err.body : null;
      if ((body?.details as { needsAcreage?: boolean } | undefined)?.needsAcreage) setNeedsAcreage(true);
      toast({ title: "Not moved", description: body?.message ?? (err instanceof Error ? err.message : String(err)), variant: "destructive" });
    },
  });

  if (linked) {
    return (
      <p className="text-sm" data-testid="move-to-land-linked">
        In Land inventory — <Link href={`/properties?id=${linked.propertyId}`} className="underline">open the parcel</Link>. Feasibility, plat and marketing stay locked until the quiet-title gate clears.
      </p>
    );
  }
  return (
    <div className="space-y-2 rounded-md border p-3 text-sm" data-testid="move-to-land">
      <p>The deed is held. Move the parcel to your Land inventory, with its tax history attached.</p>
      {needsAcreage && (
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="space-y-1"><Label htmlFor={`acres-${certificateId}`} className="text-xs">Acreage</Label><Input id={`acres-${certificateId}`} inputMode="decimal" value={acres} onChange={(e) => setAcres(e.target.value)} className="h-8" /></div>
          <div className="space-y-1"><Label htmlFor={`acres-src-${certificateId}`} className="text-xs">Where it came from (deed, plat, assessor)</Label><Input id={`acres-src-${certificateId}`} value={source} onChange={(e) => setSource(e.target.value)} className="h-8" /></div>
        </div>
      )}
      <Button size="sm" onClick={() => move.mutate()} disabled={move.isPending || (needsAcreage && (!acres.trim() || !source.trim()))} data-testid="button-move-to-land">
        <MoveRight className="w-3.5 h-3.5 mr-1" aria-hidden="true" />
        {move.isPending ? "Moving…" : "Move to Land inventory"}
      </Button>
    </div>
  );
}
