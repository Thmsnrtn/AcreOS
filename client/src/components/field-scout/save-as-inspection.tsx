/**
 * Save-as-inspection — wires the field-scout offline-sync infrastructure
 * to the BH-4 move_inspections endpoint (CT-1).
 *
 * Imelda §6.2 (best surface): "/field-scout with offline photo sync.
 * Already discussed. Best surface for me, for a use case AcreOS didn't
 * design for. Move-in/move-out inspection out of the box even before
 * AcreOS ships a tenant entity. I'd start using this Monday."
 *
 * Posts the field-scout's current checklist + photos to
 * POST /api/properties/:id/inspections (BH-4) with kind ∈
 * {move_in, move_out, annual, drive_by}.
 */

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { ClipboardCheck, Save } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";

import type { ScoutPhoto } from "@/components/field-scout/photo-gallery";
import type { ChecklistResults } from "@/components/field-scout/inspection-checklist";

interface PropertyOption {
  id: number;
  apn: string;
  address: string | null;
  city: string | null;
  state: string | null;
}

const INSPECTION_KINDS = [
  { value: "move_in", label: "Move-in" },
  { value: "move_out", label: "Move-out" },
  { value: "annual", label: "Annual walkthrough" },
  { value: "drive_by", label: "Drive-by" },
] as const;

function csrfHeader(): Record<string, string> {
  const m = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/);
  return { "Content-Type": "application/json", "x-csrf-token": decodeURIComponent(m?.[1] ?? "") };
}

interface Props {
  photos: ScoutPhoto[];
  checklist?: ChecklistResults;
  notes: string;
  /** Optional pre-selection (when field-scout already knows the property). */
  defaultPropertyId?: number;
  /** Called after successful save so the parent can reset its state. */
  onSaved?: () => void;
}

/**
 * Convert ScoutPhoto[] → BH-4's move_inspections.photos jsonb shape.
 */
function adaptPhotos(photos: ScoutPhoto[]): Array<{ url: string; caption?: string; area?: string; timestamp?: string }> {
  return photos.map((p) => ({
    url: p.url ?? "",
    caption: (p as any).caption ?? undefined,
    area: undefined,  // field-scout's ScoutPhoto isn't area-tagged yet
    timestamp: (p as any).takenAt ?? undefined,
  }));
}

/**
 * Convert ChecklistResults → BH-4's move_inspections.checklist jsonb shape.
 * Field-scout's checklist is a flat object; BH-4 expects an array of
 * { area, condition, notes, photoCount }. We collapse the field-scout
 * boolean / text answers into per-area "good" or "fair" entries.
 */
function adaptChecklist(checklist: ChecklistResults | undefined): Array<{
  area: string;
  condition: "excellent" | "good" | "fair" | "damaged";
  notes?: string;
  photoCount?: number;
}> {
  if (!checklist) return [];
  const out: Array<{ area: string; condition: "excellent" | "good" | "fair" | "damaged"; notes?: string }> = [];
  for (const [key, val] of Object.entries(checklist)) {
    if (val === undefined || val === null || val === "") continue;
    if (typeof val === "boolean") {
      out.push({ area: key, condition: val ? "good" : "fair" });
    } else if (typeof val === "string") {
      out.push({ area: key, condition: "good", notes: val });
    } else {
      out.push({ area: key, condition: "good", notes: JSON.stringify(val) });
    }
  }
  return out;
}

export function SaveAsInspection({ photos, checklist, notes, defaultPropertyId, onSaved }: Props) {
  const { toast } = useToast();
  const [propertyId, setPropertyId] = useState<string>(defaultPropertyId ? String(defaultPropertyId) : "");
  const [kind, setKind] = useState<typeof INSPECTION_KINDS[number]["value"]>("move_in");

  const { data: properties } = useQuery<{ properties: PropertyOption[] }>({
    queryKey: ["/api/properties", { limit: 200 }],
    queryFn: async () => {
      const res = await fetch("/api/properties?limit=200", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return res.json();
    },
    staleTime: 5 * 60_000,
  });

  const create = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/properties/${propertyId}/inspections`, {
        method: "POST",
        credentials: "include",
        headers: csrfHeader(),
        body: JSON.stringify({
          kind,
          inspectionDate: new Date().toISOString().slice(0, 10),
          checklist: adaptChecklist(checklist),
          photos: adaptPhotos(photos),
          notes: notes || null,
        }),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(detail.message ?? `Failed (${res.status})`);
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Inspection saved", description: "Photos + checklist attached to the property." });
      queryClient.invalidateQueries({ queryKey: [`/api/properties/${propertyId}/inspections`] });
      onSaved?.();
    },
    onError: (err: any) => toast({ title: "Couldn't save inspection", description: err.message, variant: "destructive" }),
  });

  const canSave = !!propertyId && !!kind && (photos.length > 0 || !!checklist) && !create.isPending;

  return (
    <Card className="p-3 border-dashed">
      <div className="flex items-center gap-2 text-xs font-semibold mb-2">
        <ClipboardCheck className="w-4 h-4 text-primary" aria-hidden="true" />
        Save as move-in/move-out inspection
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        Tag the current photos + checklist to a property as a BH-4 move-in/move-out
        inspection (lives at /properties/:id/inspections, attaches to security-deposit reconciliation).
      </p>
      <div className="grid grid-cols-2 gap-2 mb-2">
        <div>
          <Label className="text-xs">Property</Label>
          <Select value={propertyId} onValueChange={setPropertyId}>
            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Pick a property…" /></SelectTrigger>
            <SelectContent>
              {properties?.properties.map((p) => (
                <SelectItem key={p.id} value={String(p.id)}>
                  {p.address ?? p.apn} · {p.city ?? ""}{p.state ? `, ${p.state}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Kind</Label>
          <Select value={kind} onValueChange={(v) => setKind(v as any)}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {INSPECTION_KINDS.map((k) => <SelectItem key={k.value} value={k.value}>{k.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
      <Button
        size="sm"
        variant="outline"
        className="w-full h-8 text-xs"
        disabled={!canSave}
        onClick={() => create.mutate()}
      >
        <Save className="w-3.5 h-3.5 mr-1" aria-hidden="true" />
        {create.isPending ? "Saving inspection…" : "Save as inspection"}
      </Button>
    </Card>
  );
}
