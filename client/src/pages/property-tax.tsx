import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { DollarSign, AlertTriangle, ExternalLink, Loader2 } from "lucide-react";

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
  const { toast } = useToast();
  const [portalState, setPortalState] = useState("TX");
  const [portalCounty, setPortalCounty] = useState("");
  const [portalUrl, setPortalUrl] = useState<string | null>(null);

  const { data: summary, isLoading } = useQuery<PortfolioTaxSummary>({
    queryKey: ["/api/property-tax/portfolio"],
    queryFn: () => fetch("/api/property-tax/portfolio").then(r => r.json()),
  });

  async function lookupPortal() {
    const params = new URLSearchParams({ state: portalState });
    if (portalCounty) params.set("county", portalCounty);
    const res = await fetch(`/api/property-tax/portal?${params}`);
    const data = await res.json();
    setPortalUrl(data.url);
  }

  const totalBalance = summary?.totalEscrowBalance ?? 0;
  const totalAnnualTax = summary?.totalAnnualTax ?? 0;
  const coverage = totalAnnualTax > 0 ? (totalBalance / totalAnnualTax) * 100 : 0;

  return (
    <PageShell>
      <div>
        <h1 className="text-2xl md:text-3xl font-bold" data-testid="text-property-tax-title">
          Property Tax Manager
        </h1>
        <p className="text-muted-foreground text-sm md:text-base">
          Track tax escrow balances and upcoming payments across your portfolio.
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading tax data...
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <DollarSign className="w-4 h-4" />
                  <span className="text-xs">Escrow Balance</span>
                </div>
                <p className="text-xl font-bold">
                  ${((totalBalance) / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground mb-1">Annual Tax Due</p>
                <p className="text-xl font-bold">
                  ${((totalAnnualTax) / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground mb-1">Notes w/ Escrow</p>
                <p className="text-xl font-bold">{summary?.notesWithEscrow ?? 0}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <AlertTriangle className="w-4 h-4" />
                  <span className="text-xs">Shortfall</span>
                </div>
                <p className="text-xl font-bold text-destructive">{summary?.notesWithShortfall ?? 0}</p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardContent className="p-4">
              <div className="flex justify-between text-xs text-muted-foreground mb-2">
                <span>Escrow Coverage</span>
                <span>{coverage.toFixed(0)}%</span>
              </div>
              <Progress value={Math.min(coverage, 100)} className="h-2" />
              <p className="text-xs text-muted-foreground mt-1">
                {coverage >= 100 ? "Fully funded" : `${(100 - coverage).toFixed(0)}% underfunded`}
              </p>
            </CardContent>
          </Card>

          {(summary?.upcomingPayments?.length ?? 0) > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Upcoming Tax Payments</CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-0 space-y-2">
                {summary!.upcomingPayments.map(p => (
                  <div key={p.noteId} className="flex items-center justify-between text-sm">
                    <div>
                      <p className="font-medium text-xs">{p.propertyAddress}</p>
                      <p className="text-xs text-muted-foreground">Due {new Date(p.dueDate).toLocaleDateString()}</p>
                    </div>
                    <Badge variant="secondary">${(p.amount / 100).toLocaleString()}</Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">County Tax Portal Lookup</CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0 space-y-3">
          <div className="flex gap-2">
            <Input
              placeholder="State (e.g. TX)"
              value={portalState}
              onChange={e => setPortalState(e.target.value.toUpperCase().slice(0, 2))}
              className="w-24"
              maxLength={2}
            />
            <Input
              placeholder="County (optional)"
              value={portalCounty}
              onChange={e => setPortalCounty(e.target.value)}
              className="flex-1"
            />
            <Button onClick={lookupPortal} size="sm">Lookup</Button>
          </div>
          {portalUrl && (
            <a
              href={portalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs text-primary hover:underline"
            >
              <ExternalLink className="w-3 h-3" />
              {portalUrl}
            </a>
          )}
        </CardContent>
      </Card>
    </PageShell>
  );
}
