/**
 * /investor-analytics — buy-and-hold investor analytics (BH-7).
 *
 * Imelda §2.11: "the metrics I actually look at on a Sunday afternoon
 * when I'm thinking about whether to buy door 32: NOI per door, DSCR,
 * vacancy rate trailing-12, average tenant tenure, cap rate."
 *
 * Consumes the real BH-7 endpoints (GET /api/portfolio/analytics per-org,
 * per-property snapshots inline). Honesty rules ("nothing lies"):
 *   - op-ex is the 40%-rule approximation until Schedule E categorization
 *     ships — labeled as such, never presented as measured;
 *   - DSCR needs operator-supplied debt service, which the portfolio
 *     rollup doesn't carry yet — shown as "—", never invented;
 *   - empty portfolio → EmptyState with a CTA, not zeroes styled as data.
 */

import { useQuery } from "@tanstack/react-query";
import { TrendingUp, Building2, Info } from "lucide-react";

import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { QueryErrorState } from "@/components/query-error-state";
import { useDocumentTitle } from "@/hooks/use-document-title";

interface PropertyAnalytics {
  propertyId: number;
  marketValueCents: number | null;
  monthlyRentCollectedCents: number;
  monthlyRentPotentialCents: number;
  occupiedUnitCount: number;
  vacantUnitCount: number;
  unitCount: number;
  vacancyRate: number;
  opExMonthlyCents: number;
  noiMonthlyCents: number;
  noiAnnualCents: number;
  capRatePct: number | null;
  dscr: number | null;
  averageTenureMonths: number | null;
}

interface PortfolioAnalyticsResponse {
  propertyCount: number;
  portfolio: {
    totalMonthlyRentCents: number;
    totalOpExMonthlyCents: number;
    totalNoiMonthlyCents: number;
    totalNoiAnnualCents: number;
    totalMarketValueCents: number;
    portfolioCapRatePct: number | null;
    portfolioVacancyRate: number;
  };
  properties: PropertyAnalytics[];
}

function fmtUsd(c: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(c / 100);
}

function fmtPct(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`;
}

export default function InvestorAnalyticsPage() {
  useDocumentTitle("Rental analytics — AcreOS");

  const portfolio = useQuery<PortfolioAnalyticsResponse>({
    queryKey: ["/api/portfolio/analytics"],
    queryFn: async () => {
      const res = await fetch("/api/portfolio/analytics", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return res.json();
    },
  });

  return (
    <PageShell label="Analytics">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <TrendingUp className="w-6 h-6 text-primary" aria-hidden="true" />
          Rental analytics
        </h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          NOI, cap rate, DSCR, and trailing-12 vacancy across every property
          with a lease on record.
        </p>
      </div>

      {portfolio.isLoading ? (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
          </div>
          <Skeleton className="h-48" />
        </div>
      ) : portfolio.isError ? (
        <QueryErrorState
          error={portfolio.error instanceof Error ? portfolio.error : null}
          onRetry={() => portfolio.refetch()}
          isRetrying={portfolio.isRefetching}
          compact
          title="Couldn't load portfolio analytics"
          description="We hit a snag loading NOI / cap-rate data. Your data is safe — try again."
          testId="investor-analytics-query-error"
          className="mb-6"
        />
      ) : portfolio.data && portfolio.data.propertyCount === 0 ? (
        <EmptyState
          icon={Building2}
          headline="No rental analytics yet"
          subtitle="NOI, cap rate, and vacancy compute from your leases and rent ledger. Add a lease to see real numbers — nothing here is ever estimated for you."
          cta={{ label: "Add a lease", href: "/leases", "data-testid": "cta-investor-analytics-add-lease" }}
          framed
          testId="investor-analytics-empty"
        />
      ) : portfolio.data ? (
        <>
          {/* Portfolio rollup tiles */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
            <Card className="p-3">
              <div className="text-xs text-muted-foreground">Monthly rent (active leases)</div>
              <div className="text-2xl font-semibold tabular-nums">
                {fmtUsd(portfolio.data.portfolio.totalMonthlyRentCents)}
              </div>
            </Card>
            <Card className="p-3">
              <div className="text-xs text-muted-foreground">NOI / month (est.)</div>
              <div className="text-2xl font-semibold tabular-nums">
                {fmtUsd(portfolio.data.portfolio.totalNoiMonthlyCents)}
              </div>
            </Card>
            <Card className="p-3">
              <div className="text-xs text-muted-foreground">Portfolio cap rate</div>
              <div className="text-2xl font-semibold tabular-nums">
                {portfolio.data.portfolio.portfolioCapRatePct !== null
                  ? `${portfolio.data.portfolio.portfolioCapRatePct.toFixed(1)}%`
                  : "—"}
              </div>
              {portfolio.data.portfolio.portfolioCapRatePct === null && (
                <div className="text-xs text-muted-foreground">Needs a market value on file</div>
              )}
            </Card>
            <Card className="p-3">
              <div className="text-xs text-muted-foreground">Vacancy (trailing 12)</div>
              <div className="text-2xl font-semibold tabular-nums">
                {fmtPct(portfolio.data.portfolio.portfolioVacancyRate)}
              </div>
            </Card>
          </div>

          {/* Honest-approximation note — op-ex + DSCR provenance */}
          <div className="flex items-start gap-2 text-xs text-muted-foreground mb-6 max-w-3xl">
            <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
            <p>
              NOI uses a 40%-of-rent op-ex rule of thumb until expense
              categorization ships — an estimate, not your books. DSCR needs
              your actual debt service, which AcreOS doesn't track yet, so it
              shows "—" instead of a made-up number.
            </p>
          </div>

          {/* Per-property snapshots */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Building2 className="w-4 h-4" aria-hidden="true" /> Per-property snapshots
              </CardTitle>
              <CardDescription>
                Every property with at least one lease on record ({portfolio.data.propertyCount}).
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {/* Mobile: stacked cards — the 7-column table side-scrolls at
                  phone widths. md+ renders the table below. */}
              <ul className="md:hidden divide-y divide-border/40" data-testid="list-investor-analytics-mobile">
                {portfolio.data.properties.map((p) => (
                  <li key={p.propertyId} className="px-4 py-3" data-testid={`card-property-analytics-${p.propertyId}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-medium text-sm">Property #{p.propertyId}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {p.occupiedUnitCount} occupied · rent {fmtUsd(p.monthlyRentCollectedCents)}/mo
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="font-mono font-semibold tabular-nums">{fmtUsd(p.noiMonthlyCents)}</div>
                        <div className="text-xs text-muted-foreground">NOI / mo (est.)</div>
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-3 mt-2 text-xs text-muted-foreground tabular-nums">
                      <span>Cap {p.capRatePct !== null ? `${p.capRatePct.toFixed(1)}%` : "—"}</span>
                      <span>Vacancy {fmtPct(p.vacancyRate)}</span>
                      <span>Tenure {p.averageTenureMonths !== null ? `${p.averageTenureMonths} mo` : "—"}</span>
                    </div>
                  </li>
                ))}
              </ul>

              {/* Desktop: full table. Hidden on mobile. */}
              <div className="hidden md:block">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-muted-foreground border-b border-border bg-muted/30">
                      <th className="px-3 py-2 text-left font-medium">Property</th>
                      <th className="px-3 py-2 text-right font-medium">Occupied</th>
                      <th className="px-3 py-2 text-right font-medium">Rent / mo</th>
                      <th className="px-3 py-2 text-right font-medium">NOI / mo (est.)</th>
                      <th className="px-3 py-2 text-right font-medium">Cap rate</th>
                      <th className="px-3 py-2 text-right font-medium">DSCR</th>
                      <th className="px-3 py-2 text-right font-medium">Vacancy (T12)</th>
                      <th className="px-3 py-2 text-right font-medium">Avg tenure</th>
                    </tr>
                  </thead>
                  <tbody>
                    {portfolio.data.properties.map((p) => (
                      <tr key={p.propertyId} className="border-b border-border/40" data-testid={`row-property-analytics-${p.propertyId}`}>
                        <td className="px-3 py-2 font-medium">#{p.propertyId}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{p.occupiedUnitCount}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmtUsd(p.monthlyRentCollectedCents)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmtUsd(p.noiMonthlyCents)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {p.capRatePct !== null ? `${p.capRatePct.toFixed(1)}%` : "—"}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                          {p.dscr !== null ? p.dscr.toFixed(2) : "—"}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmtPct(p.vacancyRate)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {p.averageTenureMonths !== null ? `${p.averageTenureMonths} mo` : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      ) : null}
    </PageShell>
  );
}
