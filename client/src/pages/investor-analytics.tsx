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
import { isMeasuredCoverageComplete, TRAILING_12_WINDOW_MONTHS } from "@shared/rental/noi";

/**
 * Per-building occupancy, mirrored from the server's OccupancySnapshot
 * (computeOccupancySnapshot). Measurable/unmeasurable is honest per building: a
 * property with no rentable stock is `measurable:false` with a null percentage,
 * never a fabricated 0%/100%.
 */
interface OccupancySnapshot {
  measurable: boolean;
  occupancyPct: number | null;
  vacantUnits: number | null;
  rentableUnits: number;
  reason?: string;
  message?: string;
}

interface PropertyAnalytics {
  propertyId: number;
  marketValueCents: number | null;
  monthlyRentCollectedCents: number;
  monthlyRentPotentialCents: number;
  occupiedUnitCount: number;
  vacantUnitCount: number;
  unitCount: number;
  vacancyRate: number;
  /** Null for an unmeasured commercial property (opExSource "commercial_unmeasured"). */
  opExMonthlyCents: number | null;
  /** Null when op-ex is unavailable — NOI cannot be computed without it. */
  noiMonthlyCents: number | null;
  noiAnnualCents: number | null;
  capRatePct: number | null;
  dscr: number | null;
  averageTenureMonths: number | null;
  /**
   * Coarse op-ex provenance: "assumed_ratio" keeps the "(est.)" label,
   * "operator_supplied" (measured ledger OR an explicit ratio override) drops it,
   * "unavailable" is a commercial property with no measured op-ex (no NOI at all).
   */
  opExBasis: "operator_supplied" | "assumed_ratio" | "unavailable";
  /**
   * Finer provenance used to label honestly: "measured_expenses" drops "(est.)"
   * entirely; "ratio_override" is an operator-supplied ratio, still an assumption
   * (labelled "(assumed ratio)"), not measured; "assumed_ratio" is the flat 40%
   * default ("(est.)"); "commercial_unmeasured" is a commercial property whose
   * residential ratio does not apply — NOI/cap rate are not shown at all.
   */
  opExSource: "measured_expenses" | "ratio_override" | "assumed_ratio" | "commercial_unmeasured";
  /**
   * How many of the trailing-12 months carry a measured operating expense. Drives
   * the coverage qualifier: a measured NOI is shown bare only at full coverage;
   * thin coverage carries a factual "N/12 mo" marker instead.
   */
  opExMonthsCovered: number;
  occupancy: OccupancySnapshot;
}

interface PortfolioAnalyticsResponse {
  propertyCount: number;
  portfolio: {
    totalMonthlyRentCents: number;
    totalOpExMonthlyCents: number;
    /** Null when NO property has measurable op-ex (every one is commercial-unmeasured). */
    totalNoiMonthlyCents: number | null;
    totalNoiAnnualCents: number | null;
    totalMarketValueCents: number;
    portfolioCapRatePct: number | null;
    portfolioVacancyRate: number;
    /**
     * "operator_supplied" only when EVERY property's op-ex is measured — the
     * one case the rollup tiles may drop "(est.)". "mixed" and "assumed_ratio"
     * both keep the estimate label.
     */
    portfolioOpExBasis: "operator_supplied" | "assumed_ratio" | "mixed";
    /** Commercial properties excluded from the NOI rollup because op-ex is unmeasured. */
    excludedUnmeasuredCommercial: number;
  };
  properties: PropertyAnalytics[];
}

function fmtUsd(c: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(c / 100);
}

function fmtPct(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`;
}

/**
 * The op-ex provenance + coverage qualifier appended to a measured NOI figure.
 *
 * The gate is on BOTH provenance and completeness, because a thin measured op-ex
 * is the exact honesty trap this stage has to avoid — a single month's expense,
 * divided by 12, understates cost, and shown bare it would read as a complete
 * measured cap rate:
 *   - measured_expenses, FULL trailing-12 coverage → "" (no qualifier: this is
 *     the operator's actual books for the year).
 *   - measured_expenses, THIN/partial coverage → " (N/12 mo)" — the FACTUAL span
 *     of the recorded data (the real month count), never a bare number. This is
 *     a data-span statement, not an arbitrary confidence threshold.
 *   - ratio_override → " (assumed ratio)"; assumed_ratio → " (est.)".
 * A property with NO stored operating expenses never reaches "measured_expenses",
 * so it always keeps a label — an assumption is never shown as a measurement.
 */
function opExQualifier(source: PropertyAnalytics["opExSource"], monthsCovered: number): string {
  if (source === "measured_expenses") {
    if (isMeasuredCoverageComplete(monthsCovered)) return "";
    const covered = Math.max(0, Math.min(TRAILING_12_WINDOW_MONTHS, Math.trunc(monthsCovered)));
    return ` (${covered}/${TRAILING_12_WINDOW_MONTHS} mo)`;
  }
  if (source === "ratio_override") return " (assumed ratio)";
  // A commercial property whose residential op-ex ratio does not apply: NOI/cap
  // rate are not shown, and this labels why rather than a bare "—".
  if (source === "commercial_unmeasured") return " (op-ex not measured)";
  return " (est.)";
}

/** NOI cents → display, honestly showing "—" when op-ex is unavailable (never a fabricated zero). */
function fmtNoi(cents: number | null): string {
  return cents !== null ? fmtUsd(cents) : "—";
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
              <div className="text-xs text-muted-foreground">
                NOI / month
                {portfolio.data.portfolio.portfolioOpExBasis === "operator_supplied" ? "" : " (est.)"}
              </div>
              <div className="text-2xl font-semibold tabular-nums">
                {fmtNoi(portfolio.data.portfolio.totalNoiMonthlyCents)}
              </div>
              {portfolio.data.portfolio.excludedUnmeasuredCommercial > 0 && (
                <div className="text-xs text-muted-foreground">
                  excludes {portfolio.data.portfolio.excludedUnmeasuredCommercial} commercial{" "}
                  {portfolio.data.portfolio.excludedUnmeasuredCommercial === 1 ? "property" : "properties"}
                  {" "}(op-ex not measured)
                </div>
              )}
            </Card>
            <Card className="p-3">
              <div className="text-xs text-muted-foreground">
                Portfolio cap rate
                {portfolio.data.portfolio.portfolioOpExBasis === "operator_supplied" ? "" : " (est.)"}
              </div>
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

          {/* Honest-approximation note — op-ex provenance. Shown only while any
              property still lacks recorded operating expenses; dropped entirely
              once every property is measured (portfolioOpExBasis
              "operator_supplied"), because the 40% rule is then used nowhere. */}
          {portfolio.data.portfolio.portfolioOpExBasis !== "operator_supplied" && (
            <div className="flex items-start gap-2 text-xs text-muted-foreground mb-2 max-w-3xl">
              <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
              <p>
                {portfolio.data.portfolio.portfolioOpExBasis === "mixed" ? (
                  <>
                    Some properties now compute NOI from your recorded operating
                    expenses; the rest fall back to a 40%-of-rent op-ex rule of
                    thumb until you record theirs — those figures carry an
                    "(est.)" and are an estimate, not your books.
                  </>
                ) : (
                  <>
                    NOI uses a 40%-of-rent op-ex rule of thumb until you record
                    operating expenses — an estimate, not your books. On a
                    commercial NNN lease this rule of thumb is residential-shaped
                    and understates NOI: op-ex passes through to the tenant, so
                    the real operating expense you carry is lower than 40% of rent.
                  </>
                )}
              </p>
            </div>
          )}

          {/* DSCR provenance — always shown: DSCR needs operator-supplied debt
              service, which AcreOS doesn't track, so it shows "—", never a
              made-up number. */}
          <div className="flex items-start gap-2 text-xs text-muted-foreground mb-6 max-w-3xl">
            <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
            <p>
              DSCR needs your actual debt service, which AcreOS doesn't track
              yet, so it shows "—" instead of a made-up number.
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
                        <div className="font-mono font-semibold tabular-nums">{fmtNoi(p.noiMonthlyCents)}</div>
                        <div className="text-xs text-muted-foreground">NOI / mo{opExQualifier(p.opExSource, p.opExMonthsCovered)}</div>
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-3 mt-2 text-xs text-muted-foreground tabular-nums">
                      <span
                        title={!p.occupancy.measurable ? p.occupancy.message : undefined}
                      >
                        Occ {p.occupancy.measurable ? `${p.occupancy.occupancyPct}%` : "—"}
                      </span>
                      <span>
                        Cap {p.capRatePct !== null ? `${p.capRatePct.toFixed(1)}%` : "—"}
                        {p.capRatePct !== null ? opExQualifier(p.opExSource, p.opExMonthsCovered) : ""}
                      </span>
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
                      <th className="px-3 py-2 text-right font-medium">Occupancy</th>
                      <th className="px-3 py-2 text-right font-medium">Rent / mo</th>
                      <th className="px-3 py-2 text-right font-medium">NOI / mo</th>
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
                        <td
                          className="px-3 py-2 text-right tabular-nums"
                          title={!p.occupancy.measurable ? p.occupancy.message : undefined}
                        >
                          {p.occupancy.measurable ? `${p.occupancy.occupancyPct}%` : "—"}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmtUsd(p.monthlyRentCollectedCents)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {fmtNoi(p.noiMonthlyCents)}
                          {/* Empty span for measured AND full coverage; otherwise
                              the honest qualifier ("N/12 mo", "(assumed ratio)" or
                              "(est.)"). A thin measured op-ex never renders bare. */}
                          <span className="text-muted-foreground">
                            {opExQualifier(p.opExSource, p.opExMonthsCovered)}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {p.capRatePct !== null ? `${p.capRatePct.toFixed(1)}%` : "—"}
                          {/* The cap rate inherits the op-ex provenance: a thin
                              measured op-ex (or an assumed one) makes the cap rate
                              an estimate too, so it carries the same qualifier and
                              never renders as a bare measured number. */}
                          {p.capRatePct !== null && (
                            <span className="text-muted-foreground">{opExQualifier(p.opExSource, p.opExMonthsCovered)}</span>
                          )}
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
