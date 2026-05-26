import { useState, useId } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { usd } from "@/lib/format";
import { DollarSign, AlertTriangle, ExternalLink, Loader2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryErrorState } from "@/components/query-error-state";

interface EscrowStatus {
  noteId: number;
  enabled: boolean;
  annualTax: number;
  monthlyEscrow: number;
  currentBalance: number;
  nextTaxDue: string | null;
  isAdequate: boolean;
  shortfallAmount: number;
  countyPortalUrl: string | null;
  recommendation: string;
}

interface PortfolioTaxSummary {
  totalEscrowBalance: number;
  totalAnnualTax: number;
  notesWithEscrow: number;
  notesWithShortfall: number;
  upcomingPayments: Array<{
    noteId: number;
    dueDate: string;
    amount: number;
    propertyAddress: string;
  }>;
}

export default function PropertyTaxPage() {
  useDocumentTitle("Property tax manager");
  const { toast } = useToast();
  const [portalState, setPortalState] = useState("TX");
  const [portalCounty, setPortalCounty] = useState("");
  const [portalUrl, setPortalUrl] = useState<string | null>(null);
  const portalStateId = useId();
  const portalCountyId = useId();

  const { data: summary, isLoading, error, refetch } = useQuery<PortfolioTaxSummary>({
    queryKey: ["/api/property-tax/portfolio"],
    queryFn: () => fetch("/api/property-tax/portfolio").then(r => {
      if (!r.ok) throw new Error(`Failed to load tax portfolio (${r.status})`);
      return r.json();
    }),
  });

  async function lookupPortal() {
    try {
      const params = new URLSearchParams({ state: portalState });
      if (portalCounty) params.set("county", portalCounty);
      const res = await fetch(`/api/property-tax/portal?${params}`);
      if (!res.ok) throw new Error("Portal lookup failed");
      const data = await res.json();
      if (data.url) {
        setPortalUrl(data.url);
      } else {
        setPortalUrl(null);
        toast({
          title: "No portal found",
          description: `We don't have a tax-portal URL on file for ${portalState}${portalCounty ? `, ${portalCounty}` : ""}.`,
        });
      }
    } catch {
      setPortalUrl(null);
      toast({
        title: "Couldn't look up portal",
        description: "Check your connection and try again — your inputs are preserved.",
        variant: "destructive",
      });
    }
  }

  const totalBalance = summary?.totalEscrowBalance ?? 0;
  const totalAnnualTax = summary?.totalAnnualTax ?? 0;
  const coverage = totalAnnualTax > 0 ? (totalBalance / totalAnnualTax) * 100 : 0;

  return (
    <PageShell>
      <div>
        <h1 className="text-2xl md:text-3xl font-bold" data-testid="text-property-tax-title">
          Property tax manager
        </h1>
        <p className="text-muted-foreground text-sm md:text-base">
          Track tax escrow balances and upcoming payments across your portfolio.
        </p>
      </div>

      {isLoading ? (
        <>
          <dl className="grid grid-cols-2 md:grid-cols-4 gap-3" aria-busy="true" aria-label="Loading tax summary">
            {Array.from({ length: 4 }).map((_, i) => (
              <Card key={i}>
                <CardContent className="p-4 space-y-2">
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-7 w-24" />
                </CardContent>
              </Card>
            ))}
          </dl>
          <Card>
            <CardContent className="p-4 space-y-2">
              <Skeleton className="h-3 w-32" />
              <Skeleton className="h-2 w-full" />
              <Skeleton className="h-3 w-40" />
            </CardContent>
          </Card>
        </>
      ) : error ? (
        <QueryErrorState
          error={error as Error}
          onRetry={() => refetch()}
          title="Couldn't load tax portfolio"
        />
      ) : (
        <>
          <dl className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card>
              <CardContent className="p-4">
                <dt className="flex items-center gap-2 text-muted-foreground mb-1">
                  <DollarSign className="w-4 h-4" aria-hidden="true" />
                  <span className="text-xs">Escrow balance</span>
                </dt>
                <dd className="text-xl font-bold tabular-nums">
                  {usd(totalBalance / 100)}
                </dd>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <dt className="text-xs text-muted-foreground mb-1">Annual tax due</dt>
                <dd className="text-xl font-bold tabular-nums">
                  {usd(totalAnnualTax / 100)}
                </dd>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <dt className="text-xs text-muted-foreground mb-1">Notes w/ escrow</dt>
                <dd className="text-xl font-bold tabular-nums">{summary?.notesWithEscrow ?? 0}</dd>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <dt className="flex items-center gap-2 text-muted-foreground mb-1">
                  <AlertTriangle className="w-4 h-4" aria-hidden="true" />
                  <span className="text-xs">Shortfall</span>
                </dt>
                <dd className="text-xl font-bold text-destructive tabular-nums">{summary?.notesWithShortfall ?? 0}</dd>
              </CardContent>
            </Card>
          </dl>

          <Card>
            <CardContent className="p-4">
              <div className="flex justify-between text-xs text-muted-foreground mb-2">
                <span>Escrow coverage</span>
                <span className="tabular-nums">{coverage.toFixed(0)}%</span>
              </div>
              <Progress
                value={Math.min(coverage, 100)}
                className="h-2"
                aria-label={`Escrow coverage: ${coverage.toFixed(0)}% of annual tax`}
              />
              <p className="text-xs text-muted-foreground mt-1">
                {coverage >= 100 ? "Fully funded." : <><span className="tabular-nums">{(100 - coverage).toFixed(0)}%</span> underfunded.</>}
              </p>
            </CardContent>
          </Card>

          {(summary?.upcomingPayments?.length ?? 0) > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Upcoming tax payments</CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-0">
                <ul className="space-y-2" aria-label="Upcoming tax payments">
                  {summary!.upcomingPayments.map(p => (
                    <li key={p.noteId} className="flex items-center justify-between text-sm">
                      <div>
                        <p className="font-medium text-xs">{p.propertyAddress}</p>
                        <p className="text-xs text-muted-foreground tabular-nums">Due {new Date(p.dueDate).toLocaleDateString()}</p>
                      </div>
                      <Badge variant="secondary" className="tabular-nums">{usd(p.amount / 100)}</Badge>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">County tax portal lookup</CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          <form
            className="space-y-3"
            onSubmit={(e) => { e.preventDefault(); lookupPortal(); }}
          >
            <div className="flex flex-wrap gap-2">
              <div className="w-24">
                <Label htmlFor={portalStateId} className="sr-only">State</Label>
                <Input
                  id={portalStateId}
                  placeholder="State (e.g. TX)"
                  value={portalState}
                  onChange={e => setPortalState(e.target.value.toUpperCase().slice(0, 2))}
                  className="uppercase"
                  maxLength={2}
                  autoCapitalize="characters"
                  autoComplete="address-level1"
                  autoCorrect="off"
                  spellCheck={false}
                />
              </div>
              <div className="flex-1 min-w-[150px]">
                <Label htmlFor={portalCountyId} className="sr-only">County (optional)</Label>
                <Input
                  id={portalCountyId}
                  placeholder="County (optional)"
                  value={portalCounty}
                  onChange={e => setPortalCounty(e.target.value)}
                  autoCapitalize="words"
                  autoComplete="address-level2"
                />
              </div>
              <Button type="submit" size="sm" className="min-h-9">Look up</Button>
            </div>
            {portalUrl && (
              <a
                href={portalUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs text-primary hover:underline"
                aria-label={`Open ${portalState} tax portal (opens in new tab)`}
              >
                <ExternalLink className="w-3 h-3" aria-hidden="true" />
                {portalUrl}
              </a>
            )}
          </form>
        </CardContent>
      </Card>
    </PageShell>
  );
}
