/**
 * FounderProvidersPage — data-layer cost + quality visibility.
 *
 * Shows each external data provider's 30-day lookup volume, success
 * rate, average latency, and total cost. Useful for catching
 * providers that have quietly gone to 40% success rate or started
 * charging more. The registry already uses this data to sort
 * candidates within the same tier+cost bracket.
 */

import { useQuery } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { Database, AlertTriangle } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";

interface ProviderSummary {
  windowDays: number;
  byProvider: Array<{
    provider: string;
    lookups: number;
    successRate: number;
    avgLatencyMs: number | null;
    totalCostCents: number;
  }>;
  byCategory: Array<{
    category: string;
    lookups: number;
    successRate: number;
  }>;
  totalCostCents: number;
  totalLookups: number;
}

export default function FounderProvidersPage() {
  const { data, isLoading, isError } = useQuery<ProviderSummary>({
    queryKey: ["/api/founder/intelligence/providers"],
    staleTime: 5 * 60_000,
  });

  return (
    <PageShell label="Data Providers">
      <div className="space-y-6 max-w-5xl mx-auto">
        <PageHeader
          title="Data providers"
          icon={<Database className="h-5 w-5 text-muted-foreground" />}
          description="External data sources (parcel, property details, skip trace, etc). The registry now uses per-(provider, category) success rate as a tiebreaker within the same tier+cost bracket, so high-performing providers automatically get more traffic. If a provider degrades quietly, the success-rate column surfaces it here."
        />

        {isLoading ? (
          <Card>
            <CardContent className="p-8">
              <Skeleton className="h-16 w-full" />
            </CardContent>
          </Card>
        ) : isError ? (
          <Card>
            <CardContent className="p-6 text-sm text-red-600">Could not load summary.</CardContent>
          </Card>
        ) : !data || data.totalLookups === 0 ? (
          <EmptyState
            icon={Database}
            title="No provider lookups yet"
            description="Once customers start enriching parcels and properties, provider telemetry will populate here."
          />
        ) : (
          <>
            {/* Totals */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <StatCard label={`Lookups (${data.windowDays}d)`} value={data.totalLookups.toLocaleString()} />
              <StatCard label={`Total cost (${data.windowDays}d)`} value={`$${(data.totalCostCents / 100).toFixed(2)}`} />
              <StatCard
                label="Providers active"
                value={data.byProvider.length}
              />
            </div>

            {/* Per provider */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Per provider</CardTitle>
              </CardHeader>
              <CardContent className="p-0 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-xs text-muted-foreground">
                      <th className="text-left px-4 py-2">Provider</th>
                      <th className="text-right px-4 py-2">Lookups</th>
                      <th className="text-right px-4 py-2">Success</th>
                      <th className="text-right px-4 py-2">Avg latency</th>
                      <th className="text-right px-4 py-2">Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.byProvider.map((p) => (
                      <tr key={p.provider} className="border-b border-border/50">
                        <td className="px-4 py-2 font-mono text-xs">{p.provider}</td>
                        <td className="px-4 py-2 text-right">{p.lookups.toLocaleString()}</td>
                        <td className="px-4 py-2 text-right">
                          <span
                            className={
                              p.successRate < 60
                                ? "text-red-600 dark:text-red-400 font-medium"
                                : p.successRate < 80
                                  ? "text-amber-600 dark:text-amber-400"
                                  : "text-emerald-600 dark:text-emerald-400"
                            }
                          >
                            {p.successRate}%
                          </span>
                          {p.successRate < 60 && (
                            <AlertTriangle className="inline-block ml-1 h-3 w-3 text-red-600" />
                          )}
                        </td>
                        <td className="px-4 py-2 text-right text-xs text-muted-foreground">
                          {p.avgLatencyMs != null ? `${p.avgLatencyMs}ms` : "—"}
                        </td>
                        <td className="px-4 py-2 text-right">${(p.totalCostCents / 100).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>

            {/* Per category */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Per category</CardTitle>
              </CardHeader>
              <CardContent className="p-0 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-xs text-muted-foreground">
                      <th className="text-left px-4 py-2">Category</th>
                      <th className="text-right px-4 py-2">Lookups</th>
                      <th className="text-right px-4 py-2">Success rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.byCategory.map((c) => (
                      <tr key={c.category} className="border-b border-border/50">
                        <td className="px-4 py-2 font-mono text-xs">{c.category}</td>
                        <td className="px-4 py-2 text-right">{c.lookups.toLocaleString()}</td>
                        <td className="px-4 py-2 text-right">{c.successRate}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </PageShell>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-2xl font-semibold text-foreground mt-1">{value}</p>
      </CardContent>
    </Card>
  );
}
