/**
 * /investor-analytics — landlord portfolio metrics (BH-7).
 *
 * Imelda §2.11: "NOI per door, DSCR, vacancy rate trailing-12, average
 * tenant tenure, cap rate. None of these are calculated anywhere in
 * AcreOS today. Stessa gives me all of these for free."
 */

import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { TrendingUp, AlertTriangle } from "lucide-react";

import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useDocumentTitle } from "@/hooks/use-document-title";

interface PropertyAnalytics {
  propertyId: number;
  marketValueCents: number | null;
  monthlyRentCollectedCents: number;
  noiMonthlyCents: number;
  noiAnnualCents: number;
  capRatePct: number | null;
  dscr: number | null;
  vacancyRate: number;
  averageTenureMonths: number | null;
  occupiedUnitCount: number;
  unitCount: number;
}

interface AnalyticsResponse {
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

function fmtUsd(c: number | null): string {
  if (c === null || c === undefined) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(c / 100);
}

function fmtPct(p: number | null): string {
  if (p === null || p === undefined) return "—";
  return `${p.toFixed(2)}%`;
}

export default function InvestorAnalyticsPage() {
  useDocumentTitle("Portfolio analytics — AcreOS");

  const { data, isLoading } = useQuery<AnalyticsResponse>({
    queryKey: ["/api/portfolio/analytics"],
    queryFn: async () => {
      const res = await fetch("/api/portfolio/analytics", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return res.json();
    },
  });

  return (
    <PageShell label="Portfolio analytics">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <TrendingUp className="w-6 h-6 text-primary" aria-hidden="true" />
          Portfolio analytics
        </h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          NOI / cap rate / DSCR / vacancy across every property with active
          leases. Op-ex defaults to 40% of collected rent unless overridden;
          fine-grained Schedule E categorization is on the roadmap.
        </p>
      </div>

      <Card className="mb-4 border-acr-warn-soft bg-acr-warn-soft/10">
        <CardContent className="p-3 text-xs flex gap-2 text-muted-foreground">
          <AlertTriangle className="w-4 h-4 text-acr-warning mt-0.5 shrink-0" aria-hidden="true" />
          <span>
            <strong>Approximations.</strong> Op-ex uses a 40% rule of thumb;
            DSCR requires per-property debt service that we don't track yet
            (operator can pass <code>?debtMonthlyCents=...</code> on the
            single-property endpoint). Vacancy rate trailing-12 counts
            months with billed rent across all leases at the property.
          </span>
        </CardContent>
      </Card>

      {isLoading ? (
        <Skeleton className="h-40" />
      ) : data ? (
        <>
          {/* Portfolio rollup */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <Card className="p-3">
              <div className="text-xs text-muted-foreground">Properties</div>
              <div className="text-2xl font-semibold">{data.propertyCount}</div>
            </Card>
            <Card className="p-3">
              <div className="text-xs text-muted-foreground">Monthly NOI</div>
              <div className="text-2xl font-semibold">{fmtUsd(data.portfolio.totalNoiMonthlyCents)}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{fmtUsd(data.portfolio.totalMonthlyRentCents)} rent</div>
            </Card>
            <Card className="p-3">
              <div className="text-xs text-muted-foreground">Cap rate</div>
              <div className="text-2xl font-semibold">{fmtPct(data.portfolio.portfolioCapRatePct)}</div>
              <div className="text-xs text-muted-foreground mt-0.5">on {fmtUsd(data.portfolio.totalMarketValueCents)} value</div>
            </Card>
            <Card className="p-3">
              <div className="text-xs text-muted-foreground">Vacancy (avg)</div>
              <div className="text-2xl font-semibold">{(data.portfolio.portfolioVacancyRate * 100).toFixed(1)}%</div>
            </Card>
          </div>

          {/* Per-property */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Per-property snapshot</CardTitle>
              <CardDescription>Click a property to open its parcel detail.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-muted-foreground border-b border-border bg-muted/30">
                    <th className="px-3 py-2 text-left font-medium">Property</th>
                    <th className="px-3 py-2 text-right font-medium">Monthly rent</th>
                    <th className="px-3 py-2 text-right font-medium">NOI / mo</th>
                    <th className="px-3 py-2 text-right font-medium">NOI / yr</th>
                    <th className="px-3 py-2 text-right font-medium">Cap rate</th>
                    <th className="px-3 py-2 text-right font-medium">DSCR</th>
                    <th className="px-3 py-2 text-right font-medium">Vacancy T12</th>
                    <th className="px-3 py-2 text-right font-medium">Avg tenure</th>
                  </tr>
                </thead>
                <tbody>
                  {data.properties.map((p) => (
                    <tr key={p.propertyId} className="border-b border-border/40">
                      <td className="px-3 py-2 font-medium">
                        <Link href={`/parcels/${p.propertyId}`} className="hover:underline">#{p.propertyId}</Link>
                        <span className="text-xs text-muted-foreground ml-2">{p.occupiedUnitCount}/{p.unitCount} occ</span>
                      </td>
                      <td className="px-3 py-2 text-right">{fmtUsd(p.monthlyRentCollectedCents)}</td>
                      <td className="px-3 py-2 text-right">{fmtUsd(p.noiMonthlyCents)}</td>
                      <td className="px-3 py-2 text-right">{fmtUsd(p.noiAnnualCents)}</td>
                      <td className="px-3 py-2 text-right">
                        {p.capRatePct !== null && p.capRatePct >= 7 ? (
                          <Badge variant="default" className="text-xs">{fmtPct(p.capRatePct)}</Badge>
                        ) : (
                          fmtPct(p.capRatePct)
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">{p.dscr !== null ? p.dscr.toFixed(2) : "—"}</td>
                      <td className={`px-3 py-2 text-right ${p.vacancyRate > 0.10 ? "text-acr-warning" : ""}`}>
                        {(p.vacancyRate * 100).toFixed(1)}%
                      </td>
                      <td className="px-3 py-2 text-right">
                        {p.averageTenureMonths !== null ? `${p.averageTenureMonths} mo` : "—"}
                      </td>
                    </tr>
                  ))}
                  {data.properties.length === 0 && (
                    <tr><td colSpan={8} className="text-center text-muted-foreground py-6">
                      No properties with active leases yet.
                    </td></tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </>
      ) : null}
    </PageShell>
  );
}
