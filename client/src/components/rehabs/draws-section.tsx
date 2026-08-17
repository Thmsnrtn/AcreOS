/**
 * Construction draw schedule on /rehabs/:id (FF-6).
 *
 * Devon §3.5: "Draws taken, draws remaining, inspection dates, lender
 * contact, % complete per draw."
 */

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Banknote, PlusCircle, Sparkles } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";

interface Draw {
  id: string;
  sequence: number;
  label: string;
  pctOfLoan: string;
  amountCents: number;
  status: string;
  requestedAt: string | null;
  inspectionAt: string | null;
  fundedAt: string | null;
  inspectorName: string | null;
  inspectorContact: string | null;
}

interface DrawsResponse {
  rehab: {
    lenderName: string | null;
    lenderLoanCents: number | null;
    lenderRateBps: number | null;
  };
  draws: Draw[];
  summary: {
    drawCount: number;
    fundedCents: number;
    remainingCents: number;
    fundedPct: number;
    dailyInterestCents: number | null;
  };
}

const STATUSES = ["planned", "requested", "inspected", "funded", "rejected"] as const;

function fmtUsd(c: number | null): string {
  if (c === null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(c / 100);
}

function csrf(): Record<string, string> {
  const m = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/);
  return { "Content-Type": "application/json", "x-csrf-token": decodeURIComponent(m?.[1] ?? "") };
}

export function DrawsSection({ rehabId }: { rehabId: string }) {
  const { toast } = useToast();

  const draws = useQuery<DrawsResponse>({
    queryKey: ["/api/rehabs", rehabId, "draws"],
    queryFn: async () => {
      const res = await fetch(`/api/rehabs/${rehabId}/draws`, { credentials: "include" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return res.json();
    },
  });

  const seed = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/rehabs/${rehabId}/draws/seed`, {
        method: "POST", credentials: "include", headers: csrf(),
        body: JSON.stringify({ splits: [0.25, 0.50, 0.25] }),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(detail.message ?? `Failed (${res.status})`);
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Seeded 25/50/25 schedule" });
      queryClient.invalidateQueries({ queryKey: ["/api/rehabs", rehabId, "draws"] });
    },
    onError: (err: any) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const updateDraw = useMutation({
    mutationFn: async (vars: { drawId: string; updates: Partial<Draw> }) => {
      const res = await fetch(`/api/draws/${vars.drawId}`, {
        method: "PATCH", credentials: "include", headers: csrf(),
        body: JSON.stringify(vars.updates),
      });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/rehabs", rehabId, "draws"] }),
  });

  if (draws.isLoading) return <Skeleton className="h-32" />;
  const data = draws.data;
  if (!data) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Banknote className="w-4 h-4" aria-hidden="true" /> Construction draws
        </CardTitle>
        <CardDescription>
          {data.rehab.lenderName ?? "(no lender set)"}{" — "}
          {data.rehab.lenderLoanCents !== null ? fmtUsd(data.rehab.lenderLoanCents) : "no loan"}
          {data.rehab.lenderRateBps !== null && ` at ${(data.rehab.lenderRateBps / 100).toFixed(2)}%`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {data.draws.length === 0 ? (
          <div className="text-center py-3">
            <p className="text-sm text-muted-foreground mb-2">No draw schedule yet.</p>
            <Button size="sm" variant="outline" onClick={() => seed.mutate()} disabled={seed.isPending || !data.rehab.lenderLoanCents}>
              <Sparkles className="w-4 h-4 mr-1" aria-hidden="true" /> Seed 25/50/25
            </Button>
            {!data.rehab.lenderLoanCents && (
              <p className="text-xs text-muted-foreground mt-1">Set lender loan amount on the rehab first.</p>
            )}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <div className="text-xs text-muted-foreground">Funded</div>
                <div className="text-lg font-semibold">{fmtUsd(data.summary.fundedCents)}</div>
                <Progress value={data.summary.fundedPct} className="mt-1 h-2" />
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Remaining</div>
                <div className="text-lg font-semibold">{fmtUsd(data.summary.remainingCents)}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Daily interest</div>
                <div className="text-lg font-semibold">{fmtUsd(data.summary.dailyInterestCents)}</div>
              </div>
            </div>

            <table className="w-full text-sm mt-2">
              <thead>
                <tr className="text-xs text-muted-foreground border-b border-border">
                  <th className="px-2 py-2 text-left font-medium">#</th>
                  <th className="px-2 py-2 text-left font-medium">Label</th>
                  <th className="px-2 py-2 text-right font-medium">%</th>
                  <th className="px-2 py-2 text-right font-medium">Amount</th>
                  <th className="px-2 py-2 text-left font-medium">Status</th>
                  <th className="px-2 py-2 text-left font-medium">Inspection</th>
                  <th className="px-2 py-2 text-left font-medium">Funded</th>
                  <th className="px-2 py-2 text-left font-medium">Inspector</th>
                </tr>
              </thead>
              <tbody>
                {data.draws.map((d) => (
                  <tr key={d.id} className="border-b border-border/40">
                    <td className="px-2 py-1 text-xs text-muted-foreground">{d.sequence}</td>
                    <td className="px-2 py-1 font-medium">{d.label}</td>
                    <td className="px-2 py-1 text-right">{Math.round(parseFloat(d.pctOfLoan) * 100)}%</td>
                    <td className="px-2 py-1 text-right">{fmtUsd(d.amountCents)}</td>
                    <td className="px-2 py-1">
                      <Select value={d.status} onValueChange={(v) => updateDraw.mutate({ drawId: d.id, updates: { status: v as any } })}>
                        <SelectTrigger className="h-7 w-[110px] text-xs">
                          <SelectValue><Badge variant="outline" className="text-xs">{d.status}</Badge></SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="px-2 py-1">
                      <Input
                        aria-label={`Inspection date for draw ${d.sequence ?? d.id}`}
                        type="date"
                        defaultValue={d.inspectionAt ?? ""}
                        onBlur={(e) => updateDraw.mutate({ drawId: d.id, updates: { inspectionAt: e.target.value || null } as any })}
                        className="h-7 text-xs"
                      />
                    </td>
                    <td className="px-2 py-1">
                      <Input
                        aria-label={`Funded date for draw ${d.sequence ?? d.id}`}
                        type="date"
                        defaultValue={d.fundedAt ?? ""}
                        onBlur={(e) => updateDraw.mutate({ drawId: d.id, updates: { fundedAt: e.target.value || null } as any })}
                        className="h-7 text-xs"
                      />
                    </td>
                    <td className="px-2 py-1">
                      <Input
                        aria-label={`Inspector for draw ${d.sequence ?? d.id}`}
                        defaultValue={d.inspectorName ?? ""}
                        onBlur={(e) => updateDraw.mutate({ drawId: d.id, updates: { inspectorName: e.target.value || null } as any })}
                        className="h-7 text-xs"
                        placeholder="Inspector name"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </CardContent>
    </Card>
  );
}
