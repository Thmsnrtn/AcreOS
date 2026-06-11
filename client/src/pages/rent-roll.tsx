/**
 * /rent-roll — org-wide rent aging dashboard (BH-3).
 *
 * Imelda §3 portfolio: "Aging buckets are right shape, wrong source. Wire
 * them to rent-roll late-pay data and they're useful."
 */

import { useQuery } from "@tanstack/react-query";
import { Wallet, AlertTriangle, FileText } from "lucide-react";

import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useDocumentTitle } from "@/hooks/use-document-title";

interface AgingResponse {
  asOf: string;
  totalsByBucket: Record<string, { count: number; totalCents: number }>;
  charges: Array<{
    id: string;
    lease_id: string;
    charged_for_month: string;
    due_date: string;
    amount_cents: number;
    balance_cents: number;
    late_fee_cents: number;
    legal_posture: string;
    days_overdue: number;
  }>;
}

interface LateFeeRule {
  state: string;
  capPctSmallProperty: string | null;
  capPctLargeProperty: string | null;
  graceDays: number;
  citation: string | null;
  summary: string | null;
}

function fmtUsd(c: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(c / 100);
}

function postureTone(p: string): "default" | "secondary" | "outline" | "destructive" {
  if (p === "eviction_filed") return "destructive";
  if (p === "notice_served") return "destructive";
  if (p === "late") return "default";
  return "outline";
}

export default function RentRollPage() {
  useDocumentTitle("Rent roll — AcreOS");

  const aging = useQuery<AgingResponse>({
    queryKey: ["/api/rent/aging"],
    queryFn: async () => {
      const res = await fetch("/api/rent/aging", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return res.json();
    },
  });

  const rules = useQuery<{ rules: LateFeeRule[] }>({
    queryKey: ["/api/late-fee-rules"],
    queryFn: async () => {
      const res = await fetch("/api/late-fee-rules", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return res.json();
    },
  });

  return (
    <PageShell label="Rent roll">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <Wallet className="w-6 h-6 text-primary" aria-hidden="true" />
          Rent roll
        </h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          Org-wide aging buckets across every active lease. Late fees compute
          per state rule on apply.
        </p>
      </div>

      {aging.isLoading ? (
        <Skeleton className="h-32" />
      ) : aging.data ? (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
            {(["current", "d1_30", "d31_60", "d61_90", "d90_plus"] as const).map((k) => {
              const tot = aging.data!.totalsByBucket[k] ?? { count: 0, totalCents: 0 };
              const labels: Record<string, string> = {
                current: "Current",
                d1_30: "1-30 days",
                d31_60: "31-60 days",
                d61_90: "61-90 days",
                d90_plus: "90+ days",
              };
              const tones: Record<string, string> = {
                current: "",
                d1_30: "text-acr-warning",
                d31_60: "text-acr-warning",
                d61_90: "text-acr-neg",
                d90_plus: "text-acr-neg",
              };
              return (
                <Card key={k} className="p-3">
                  <div className="text-xs text-muted-foreground">{labels[k]}</div>
                  <div className={`text-2xl font-semibold ${tones[k]}`}>{fmtUsd(tot.totalCents)}</div>
                  <div className="text-xs text-muted-foreground">{tot.count} charges</div>
                </Card>
              );
            })}
          </div>

          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-acr-warning" aria-hidden="true" /> Open balances
              </CardTitle>
              <CardDescription>Sorted by due date, oldest first.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {aging.data.charges.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">All caught up.</p>
              ) : (
                <>
                {/* Mobile: stacked charge cards — the 7-column aging table
                    side-scrolls at phone widths. md+ renders the table below. */}
                <ul className="md:hidden divide-y divide-border/40" data-testid="list-rent-aging-mobile">
                  {aging.data.charges.map((c) => (
                    <li key={c.id} className="px-4 py-3" data-testid={`card-rent-charge-${c.id}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-mono text-xs">{c.lease_id.slice(0, 8)}…</div>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {c.charged_for_month} · due {c.due_date}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="font-mono font-semibold tabular-nums">{fmtUsd(c.balance_cents)}</div>
                          {c.late_fee_cents > 0 && (
                            <div className="text-xs text-muted-foreground tabular-nums">
                              +{fmtUsd(c.late_fee_cents)} late fee
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center justify-between gap-3 mt-2">
                        <Badge variant={postureTone(c.legal_posture)} className="text-xs">
                          {c.legal_posture.replace(/_/g, " ")}
                        </Badge>
                        <span className={`text-xs tabular-nums ${c.days_overdue > 0 ? "text-acr-warning" : "text-muted-foreground"}`}>
                          {c.days_overdue > 0 ? `${c.days_overdue} days late` : "current"}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>

                {/* Desktop: full table. Hidden on mobile. */}
                <div className="hidden md:block">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-muted-foreground border-b border-border bg-muted/30">
                      <th className="px-3 py-2 text-left font-medium">Lease</th>
                      <th className="px-3 py-2 text-left font-medium">Month</th>
                      <th className="px-3 py-2 text-left font-medium">Due</th>
                      <th className="px-3 py-2 text-right font-medium">Days late</th>
                      <th className="px-3 py-2 text-right font-medium">Balance</th>
                      <th className="px-3 py-2 text-right font-medium">Late fee</th>
                      <th className="px-3 py-2 text-left font-medium">Posture</th>
                    </tr>
                  </thead>
                  <tbody>
                    {aging.data.charges.map((c) => (
                      <tr key={c.id} className="border-b border-border/40">
                        <td className="px-3 py-2 font-mono text-xs">{c.lease_id.slice(0, 8)}…</td>
                        <td className="px-3 py-2">{c.charged_for_month}</td>
                        <td className="px-3 py-2">{c.due_date}</td>
                        <td className={`px-3 py-2 text-right ${c.days_overdue > 0 ? "text-acr-warning" : ""}`}>
                          {c.days_overdue}
                        </td>
                        <td className="px-3 py-2 text-right">{fmtUsd(c.balance_cents)}</td>
                        <td className="px-3 py-2 text-right text-muted-foreground">
                          {c.late_fee_cents > 0 ? fmtUsd(c.late_fee_cents) : "—"}
                        </td>
                        <td className="px-3 py-2">
                          <Badge variant={postureTone(c.legal_posture)} className="text-xs">{c.legal_posture.replace(/_/g, " ")}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
                </>
              )}
            </CardContent>
          </Card>
        </>
      ) : null}

      {/* Late-fee rule reference */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="w-4 h-4" aria-hidden="true" /> State late-fee rules
          </CardTitle>
          <CardDescription>Reference data used when applying late fees. Verify with state counsel.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {rules.isLoading ? (
            <Skeleton className="h-20 m-4" />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted-foreground border-b border-border bg-muted/30">
                  <th className="px-3 py-2 text-left font-medium">State</th>
                  <th className="px-3 py-2 text-right font-medium">Cap (small)</th>
                  <th className="px-3 py-2 text-right font-medium">Cap (4+ unit)</th>
                  <th className="px-3 py-2 text-right font-medium">Grace</th>
                  <th className="px-3 py-2 text-left font-medium">Citation</th>
                </tr>
              </thead>
              <tbody>
                {rules.data?.rules.map((r) => (
                  <tr key={r.state} className="border-b border-border/40">
                    <td className="px-3 py-2 font-medium">{r.state}</td>
                    <td className="px-3 py-2 text-right">
                      {r.capPctSmallProperty ? `${(parseFloat(r.capPctSmallProperty) * 100).toFixed(0)}%` : "—"}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {r.capPctLargeProperty ? `${(parseFloat(r.capPctLargeProperty) * 100).toFixed(0)}%` : "—"}
                    </td>
                    <td className="px-3 py-2 text-right">{r.graceDays}d</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{r.citation ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </PageShell>
  );
}
