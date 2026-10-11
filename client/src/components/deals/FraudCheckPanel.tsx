/**
 * Before you offer or close — fraud-check signals (W5a), Deals door →
 * deal → Checklist. Signals, never accusations, and never a block: each one
 * names its source and the one thing to do. A signal with missing data says
 * "not checked" and why — it is never shown as clear.
 */
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ShieldAlert, ShieldCheck, ShieldQuestion } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryErrorState } from "@/components/query-error-state";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { FraudSignal } from "@shared/trust/fraudSignals";

const STATUS_LABEL: Record<FraudSignal["status"], string> = {
  fired: "Check this",
  clear: "Nothing seen",
  not_checked: "Not checked",
};

export function FraudCheckPanel({ dealId }: { dealId: number }) {
  const { toast } = useToast();
  const key = [`/api/deals/${dealId}/fraud-check`];
  const { data, isLoading, isError, error, refetch, isRefetching } = useQuery<{ signals: FraudSignal[] }>({ queryKey: key });
  const [note, setNote] = useState("");
  const report = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/deals/${dealId}/fraud-check/wire-change`, { note: note.trim() || undefined })).json(),
    onSuccess: () => {
      setNote("");
      void queryClient.invalidateQueries({ queryKey: key });
      toast({ title: "Recorded on this deal" });
    },
    onError: (err) => toast({ title: "Couldn't record it", description: err instanceof Error ? err.message : String(err), variant: "destructive" }),
  });

  if (isError) return <QueryErrorState error={error as Error} onRetry={() => void refetch()} isRetrying={isRefetching} title="Fraud check" compact />;

  return (
    <Card data-testid="card-fraud-check">
      <CardHeader>
        <CardTitle className="text-base">Before you offer or close: fraud check</CardTitle>
        <CardDescription>Signals to look into, not accusations. Nothing here stops the deal.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading || !data ? (
          <div className="space-y-2" aria-hidden="true">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
          </div>
        ) : (
          <ul className="space-y-3">
            {data.signals.map((s) => {
              const Icon = s.status === "fired" ? ShieldAlert : s.status === "clear" ? ShieldCheck : ShieldQuestion;
              return (
                <li key={s.id} className="flex gap-3" data-testid={`fraud-signal-${s.id}`}>
                  <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${s.status === "fired" ? "text-acr-warn" : "text-muted-foreground"}`} aria-hidden="true" />
                  <div className="space-y-1 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-foreground">{s.title}</span>
                      <Badge variant={s.status === "fired" ? "secondary" : "outline"}>{STATUS_LABEL[s.status]}</Badge>
                    </div>
                    <p className="text-muted-foreground">{s.detail}</p>
                    {s.source ? <p className="text-xs text-muted-foreground">Source: {s.source}</p> : null}
                    {s.status !== "clear" ? <p className="text-xs text-foreground">What to do: {s.whatToDo}</p> : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <form
          className="space-y-2 border-t border-border pt-3"
          onSubmit={(e) => {
            e.preventDefault();
            report.mutate();
          }}
        >
          <Label htmlFor={`wire-change-${dealId}`}>Did someone ask you to wire money to a new or changed account?</Label>
          <Textarea id={`wire-change-${dealId}`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={2} placeholder="Who asked, and how (email, text, call)" />
          <Button type="submit" size="sm" variant="outline" disabled={report.isPending}>Record a wire-change request</Button>
        </form>
      </CardContent>
    </Card>
  );
}
