/**
 * "Your membership makes a difference" — Settings → Billing (W5a giving).
 *
 * Shows ONLY money AcreOS has actually paid, with its receipt: the server
 * builds this from receipts alone (shared/trust/giving.ts memberGivingPanel),
 * and this panel has no field for a pledged or approved amount. When nothing
 * is receipted it says so plainly.
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { HeartHandshake } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryErrorState } from "@/components/query-error-state";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface MembershipGiving {
  state: "given" | "nothing_yet";
  foodBankName: string | null;
  givenCents: number;
  asOf: string | null;
  receiptReference: string | null;
  receiptUrl: string | null;
  area: { state: string; county: string } | null;
}

const KEY = ["/api/giving/membership"];

export function MembershipGivingPanel() {
  const { toast } = useToast();
  const { data, isLoading, isError, error, refetch, isRefetching } = useQuery<MembershipGiving>({ queryKey: KEY });
  const [state, setState] = useState("");
  const [county, setCounty] = useState("");
  useEffect(() => {
    if (data?.area) {
      setState(data.area.state);
      setCounty(data.area.county);
    }
  }, [data?.area?.state, data?.area?.county]);

  const save = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PUT", "/api/giving/area", { area: { state: state.trim().toUpperCase(), county: county.trim() } });
      return res.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: KEY });
      toast({ title: "Saved your county" });
    },
    onError: (err) => toast({ title: "Couldn't save", description: err instanceof Error ? err.message : String(err), variant: "destructive" }),
  });

  if (isError) {
    return <QueryErrorState error={error as Error} onRetry={() => void refetch()} isRetrying={isRefetching} title="Your membership makes a difference" compact />;
  }

  return (
    <Card data-testid="card-membership-giving">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <HeartHandshake className="h-4 w-4 text-primary" aria-hidden="true" />
          Your membership makes a difference
        </CardTitle>
        <CardDescription>
          For every paying member, AcreOS commits $1 a month of its own money to a food bank serving that member's area.
          This panel shows only what has actually been paid, with the receipt.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="space-y-2" aria-hidden="true">
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ) : data?.state === "given" ? (
          <p className="text-sm text-foreground" data-testid="text-giving-given">
            ${(data.givenCents / 100).toFixed(2)} given to {data.foodBankName} as of {data.asOf}
            {" · "}
            {data.receiptUrl ? (
              <a href={data.receiptUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm">
                receipt {data.receiptReference}
              </a>
            ) : (
              <span>receipt {data.receiptReference}</span>
            )}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground" data-testid="text-giving-nothing-yet">
            {!data?.area
              ? "Nothing has been given in your area yet, and we don't know your county. Add it below so your share goes to a food bank near you."
              : data.foodBankName
                ? `Nothing has been given to ${data.foodBankName} yet. When a payment is made, it will show here with its receipt.`
                : `Nothing has been given in ${data.area.county}, ${data.area.state} yet. A food bank for your county hasn't been chosen.`}
          </p>
        )}
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="giving-state">State</Label>
            <Input id="giving-state" value={state} onChange={(e) => setState(e.target.value)} maxLength={2} className="w-20" placeholder="TN" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="giving-county">County</Label>
            <Input id="giving-county" value={county} onChange={(e) => setCounty(e.target.value)} maxLength={80} className="w-48" placeholder="Hamilton" />
          </div>
          <Button type="submit" variant="outline" size="sm" disabled={save.isPending || state.trim().length !== 2 || county.trim().length < 2}>
            Save county
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
