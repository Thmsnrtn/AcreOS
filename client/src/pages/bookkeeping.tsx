import { useQuery } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DollarSign, FileText, TrendingUp, Loader2, Download } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface AnnualInterestReport {
  taxYear: number;
  totalInterestIncome: number;
  totalPrincipalReceived: number;
  totalLateFeesCollected: number;
  notesWith1099Required: number;
  notes: Array<{
    noteId: number;
    borrowerName: string;
    interestCollected: number;
    principalCollected: number;
    requires1099: boolean;
  }>;
}

interface PortfolioSummary {
  taxYear: number;
  totalRevenue: number;
  totalCosts: number;
  netProfit: number;
  dealsCompleted: number;
  avgRoi: number;
}

const currentYear = new Date().getFullYear();
const taxYear = currentYear - 1;

export default function BookkeepingPage() {
  const { toast } = useToast();

  const { data: report, isLoading: loadingReport } = useQuery<AnnualInterestReport>({
    queryKey: ["/api/bookkeeping/annual-report", taxYear],
    queryFn: () => fetch(`/api/bookkeeping/annual-report?year=${taxYear}`).then(r => r.json()),
  });

  const { data: summary, isLoading: loadingSummary } = useQuery<PortfolioSummary>({
    queryKey: ["/api/bookkeeping/portfolio-summary", taxYear],
    queryFn: () => fetch(`/api/bookkeeping/portfolio-summary?year=${taxYear}`).then(r => r.json()),
  });

  const fmt = (n: number) =>
    `$${(n / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;

  return (
    <PageShell>
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold" data-testid="text-bookkeeping-title">
            Bookkeeping
          </h1>
          <p className="text-muted-foreground text-sm md:text-base">
            {taxYear} tax year — interest income, P&L, and 1099 reports.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => toast({ title: "Export feature coming soon" })}>
          <Download className="w-4 h-4 mr-2" /> Export
        </Button>
      </div>

      {loadingReport || loadingSummary ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading bookkeeping data...
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <DollarSign className="w-4 h-4" />
                  <span className="text-xs">Interest Income</span>
                </div>
                <p className="text-xl font-bold">
                  {report ? fmt(report.totalInterestIncome) : "—"}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground mb-1">Principal Collected</p>
                <p className="text-xl font-bold">
                  {report ? fmt(report.totalPrincipalReceived) : "—"}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <TrendingUp className="w-4 h-4" />
                  <span className="text-xs">Net P&L</span>
                </div>
                <p className="text-xl font-bold">
                  {summary ? fmt(summary.netProfit) : "—"}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <FileText className="w-4 h-4" />
                  <span className="text-xs">1099s Required</span>
                </div>
                <p className="text-xl font-bold">{report?.notesWith1099Required ?? "—"}</p>
              </CardContent>
            </Card>
          </div>

          {report && report.notes.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Note Interest Summary</CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-0 space-y-2">
                {report.notes.map(n => (
                  <div key={n.noteId} className="flex items-center justify-between text-sm">
                    <div>
                      <p className="font-medium text-xs">{n.borrowerName}</p>
                      <p className="text-xs text-muted-foreground">
                        {fmt(n.interestCollected)} interest · {fmt(n.principalCollected)} principal
                      </p>
                    </div>
                    {n.requires1099 && (
                      <Badge variant="secondary" className="text-xs">1099</Badge>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </PageShell>
  );
}
