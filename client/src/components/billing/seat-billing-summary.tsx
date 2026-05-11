/**
 * Seat-billing summary widget — Phase 5 §5 Part A (team readiness).
 *
 * Drop-in component that renders the billing math for the current org:
 *   "Operator @ $49/mo + 2 extra seats × $20 = $89/mo"
 *
 * Admins can adjust seatCount inline; the API call hits
 * /api/team-readiness/seat-count which both updates the column and
 * syncs the per-seat add-on subscription on Stripe.
 */

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

interface BillingSummary {
  tier: "starter" | "pro" | "scale" | null;
  seatCount: number;
  interval: "monthly" | "yearly";
  description: string;
  baseCents: number;
  seatAddonCents: number;
  totalCents: number;
  maxSeats: number | null;
  perSeatCents: number | null;
  canAddMoreSeats: boolean;
}

export function SeatBillingSummary() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [draft, setDraft] = useState<number | null>(null);

  const { data, isLoading } = useQuery<BillingSummary>({
    queryKey: ["/api/team-readiness/billing-summary"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/team-readiness/billing-summary");
      return await res.json();
    },
  });

  useEffect(() => {
    if (data && draft === null) setDraft(data.seatCount);
  }, [data, draft]);

  const updateSeats = useMutation({
    mutationFn: async (count: number) => {
      const res = await apiRequest("POST", "/api/team-readiness/seat-count", { seatCount: count });
      return await res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/team-readiness/billing-summary"] });
      toast({ title: "Seat count updated" });
    },
    onError: (e: Error) => toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });

  if (isLoading || !data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Seats &amp; billing</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-4 w-3/4 bg-muted animate-pulse rounded" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Seats &amp; billing</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm">{data.description}</p>
        <div className="text-xs text-muted-foreground">
          Base ${(data.baseCents / 100).toFixed(2)} + add-on ${(data.seatAddonCents / 100).toFixed(2)} ={" "}
          <strong>${(data.totalCents / 100).toFixed(2)}/{data.interval === "yearly" ? "yr" : "mo"}</strong>
        </div>

        {data.tier === null ? (
          <p className="text-xs text-muted-foreground">
            Free tier — upgrade to invite teammates.
          </p>
        ) : data.tier === "starter" ? (
          <p className="text-xs text-muted-foreground">
            Starter plan is single-user. Upgrade to Pro or Scale to add seats.
          </p>
        ) : (
          <div className="flex items-end gap-2">
            <div className="max-w-xs flex-1">
              <Label htmlFor="seat-input">Seat count</Label>
              <Input
                id="seat-input"
                type="number"
                min={1}
                max={data.maxSeats ?? 500}
                value={draft ?? data.seatCount}
                onChange={(e) => setDraft(parseInt(e.target.value, 10) || 1)}
              />
            </div>
            <Button
              onClick={() => draft !== null && updateSeats.mutate(draft)}
              disabled={updateSeats.isPending || draft === data.seatCount}
            >
              {updateSeats.isPending ? "Saving…" : "Update seats"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
