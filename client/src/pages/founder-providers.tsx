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
import { useDocumentTitle } from "@/hooks/use-document-title";
import { usd } from "@/lib/format";
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

export function ProvidersContent() {
  useDocumentTitle("Data providers");
  const { data, isLoading, isError, refetch } = useQuery<ProviderSummary>({
    queryKey: ["/api/founder/intelligence/providers"],
    staleTime: 5 * 60_000,
  });

  return (
    <>
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
            <CardContent className="p-6 text-sm text-acr-neg" role="alert">
              Couldn't load provider summary. Provider state is unchanged —{" "}
              <button
                type="button"
                className="underline hover:no-underline"
                onClick={() => refetch()}
              >
                try again
              </button>.
            </CardContent>
          </Card>
        ) : !data || data.totalLookups === 0 ? (
          <EmptyState
            icon={Database}
            headline="No provider lookups yet"
            subtitle="Once customers start enriching parcels and properties, provider telemetry will populate here."
            // TODO(cta): provider telemetry is system-generated from customer activity; no direct founder action
            cta={{ label: "", _noOp: true }}
          />
        ) : (
          <>
            {/* Totals */}
            <dl className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <StatCard label={`Lookups (${data.windowDays}d)`} value={data.totalLookups.toLocaleString()} />
              <StatCard label={`Total cost (${data.windowDays}d)`} value={usd(data.totalCostCents / 100)} />
              <StatCard label="Providers active" value={data.byProvider.length} />
            </dl>

            {/* Per provider */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Per provider</CardTitle>
              </CardHeader>
              <CardContent className="p-0 overflow-x-auto" role="region" aria-label="Per-provider summary" tabIndex={0}>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-xs text-muted-foreground">
                      <th scope="col" className="text-left px-4 py-2">Provider</th>
                      <th scope="col" className="text-right px-4 py-2">Lookups</th>
                      <th scope="col" className="text-right px-4 py-2">Success</th>
                      <th scope="col" className="text-right px-4 py-2">Avg latency</th>
                      <th scope="col" className="text-right px-4 py-2">Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.byProvider.map((p) => (
                      <tr key={p.provider} className="border-b border-border/50">
                        <td className="px-4 py-2 font-mono text-xs">{p.provider}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{p.lookups.toLocaleString()}</td>
                        <td className="px-4 py-2 text-right">
                          <span
                            className={`tabular-nums ${
                              p.successRate < 60
                                ? "text-acr-neg dark:text-acr-neg font-medium"
                                : p.successRate < 80
                                  ? "text-acr-warn dark:text-acr-warn"
                                  : "text-acr-pos dark:text-acr-pos"
                            }`}
                            aria-label={
                              p.successRate < 60
                                ? `Success rate ${p.successRate}%, critical`
                                : p.successRate < 80
                                  ? `Success rate ${p.successRate}%, warning`
                                  : `Success rate ${p.successRate}%`
                            }
                          >
                            {p.successRate}%
                          </span>
                          {p.successRate < 60 && (
                            <AlertTriangle className="inline-block ml-1 h-3 w-3 text-acr-neg" aria-hidden="true" />
                          )}
                        </td>
                        <td className="px-4 py-2 text-right text-xs text-muted-foreground tabular-nums">
                          {p.avgLatencyMs != null ? `${p.avgLatencyMs}ms` : "—"}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">{usd(p.totalCostCents / 100)}</td>
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
              <CardContent className="p-0 overflow-x-auto" role="region" aria-label="Per-category summary" tabIndex={0}>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-xs text-muted-foreground">
                      <th scope="col" className="text-left px-4 py-2">Category</th>
                      <th scope="col" className="text-right px-4 py-2">Lookups</th>
                      <th scope="col" className="text-right px-4 py-2">Success rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.byCategory.map((c) => (
                      <tr key={c.category} className="border-b border-border/50">
                        <td className="px-4 py-2 font-mono text-xs">{c.category}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{c.lookups.toLocaleString()}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{c.successRate}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </>
  );
}

export default function FounderProvidersPage() {
  return (
    <PageShell label="Data Providers">
      <ProvidersContent />
    </PageShell>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <Card>
      <CardContent className="p-4">
        <dt className="text-xs text-muted-foreground">{label}</dt>
        <dd className="text-2xl font-semibold text-foreground mt-1 tabular-nums">{value}</dd>
      </CardContent>
    </Card>
  );
}
