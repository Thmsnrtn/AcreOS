/**
 * /founder/studio → Allocation tab.
 *
 * Edits the `allocation.policy` setting — five percentages that determine
 * how every incoming subscription dollar is split across tax reserve,
 * refund reserve, profit reserve, owner draw, and operating cash. The
 * sliders are constrained to sum to 100; the save button is disabled
 * until that constraint is met.
 */

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Save, AlertCircle } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface AllocationPolicy {
  taxReserve: number;
  refundReserve: number;
  profitReserve: number;
  ownerDraw: number;
  opexAvailable: number;
}

interface AllocationResponse {
  policy: AllocationPolicy;
}

const FIELDS: Array<{ key: keyof AllocationPolicy; label: string; help: string }> = [
  { key: "taxReserve", label: "Tax reserve", help: "Held until quarterly filings" },
  { key: "refundReserve", label: "Refund reserve", help: "Covers chargebacks and refunds" },
  { key: "profitReserve", label: "Profit reserve", help: "Untouchable retained earnings" },
  { key: "ownerDraw", label: "Owner draw", help: "Routed to founder distribution" },
  { key: "opexAvailable", label: "Operating cash", help: "Available for monthly opex" },
];

const STARTER_PRICE_CENTS = 2000;

export default function FounderStudioAllocation() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading } = useQuery<AllocationResponse>({
    queryKey: ["/api/founder/studio/allocation"],
  });

  const [draft, setDraft] = useState<AllocationPolicy | null>(null);
  const [note, setNote] = useState("");

  useEffect(() => {
    if (data?.policy && draft === null) setDraft(data.policy);
  }, [data, draft]);

  const total = useMemo(() => {
    if (!draft) return 0;
    return FIELDS.reduce((sum, f) => sum + (draft[f.key] || 0), 0);
  }, [draft]);

  const sumOk = Math.abs(total - 100) < 0.01;

  const save = useMutation({
    mutationFn: async () => {
      if (!draft) throw new Error("No draft");
      return apiRequest("POST", "/api/founder/studio/allocation", {
        ...draft,
        note: note || undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/founder/studio/allocation"] });
      queryClient.invalidateQueries({ queryKey: ["/api/founder/studio/dials"] });
      toast({ title: "Allocation saved" });
      setNote("");
    },
    onError: (err: Error) => {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    },
  });

  if (isLoading || !draft) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const previewCents = (pct: number) => Math.round((STARTER_PRICE_CENTS * pct) / 100);
  const cents = (n: number) => `$${(n / 100).toFixed(2)}`;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center justify-between">
            <span>Allocation policy</span>
            <Badge variant={sumOk ? "default" : "destructive"} className="font-mono">
              {total.toFixed(0)}%
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {FIELDS.map((f) => (
            <div key={f.key} className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor={`alloc-${f.key}`} className="text-sm">
                  {f.label}
                  <span className="ml-2 text-xs text-muted-foreground">{f.help}</span>
                </Label>
                <Input
                  id={`alloc-${f.key}`}
                  type="number"
                  min={0}
                  max={100}
                  value={draft[f.key]}
                  onChange={(e) =>
                    setDraft({ ...draft, [f.key]: Number(e.target.value) || 0 })
                  }
                  className="w-20 font-mono text-right"
                  aria-label={`${f.label} percent`}
                />
              </div>
              <Slider
                value={[draft[f.key]]}
                min={0}
                max={100}
                step={1}
                onValueChange={(v) => setDraft({ ...draft, [f.key]: v[0] })}
                aria-label={`${f.label} slider`}
              />
            </div>
          ))}

          {!sumOk && (
            <div className="flex items-center gap-2 text-sm text-destructive">
              <AlertCircle className="w-4 h-4" aria-hidden="true" />
              Allocations must sum to 100%. Currently {total.toFixed(0)}%.
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Preview on a $20 Starter</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-1 text-sm">
            {FIELDS.map((f) => (
              <li key={f.key} className="flex justify-between">
                <span className="text-muted-foreground">{f.label}</span>
                <span className="font-mono">{cents(previewCents(draft[f.key]))}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <div className="flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
        <Input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Optional — why are you changing this?"
          className="text-sm"
          aria-label="Change note"
        />
        <Button
          disabled={!sumOk || save.isPending}
          onClick={() => save.mutate()}
          className="gap-1.5 shrink-0"
        >
          {save.isPending ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Save className="w-3.5 h-3.5" aria-hidden="true" />
          )}
          Save allocation
        </Button>
      </div>
    </div>
  );
}
