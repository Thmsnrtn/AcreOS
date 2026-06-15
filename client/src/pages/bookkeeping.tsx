import { useQuery } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DollarSign, FileText, TrendingUp, Download } from "lucide-react";
import { PageSkeleton } from "@/components/page-skeleton";
import { QueryErrorState } from "@/components/query-error-state";
import { useToast } from "@/hooks/use-toast";
import { useDocumentTitle } from "@/hooks/use-document-title";

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
  useDocumentTitle("Bookkeeping");
  const { toast } = useToast();

  const {
    data: report,
    isLoading: loadingReport,
    isError: reportError,
    error: reportErrorObj,
    refetch: refetchReport,
    isRefetching: reportRefetching,
  } = useQuery<AnnualInterestReport>({
    queryKey: ["/api/bookkeeping/annual-report", taxYear],
    queryFn: () => fetch(`/api/bookkeeping/annual-report?year=${taxYear}`).then(r => r.json()),
  });

  const {
    data: summary,
    isLoading: loadingSummary,
    isError: summaryError,
    refetch: refetchSummary,
  } = useQuery<PortfolioSummary>({
    queryKey: ["/api/bookkeeping/portfolio-summary", taxYear],
    queryFn: () => fetch(`/api/bookkeeping/portfolio-summary?year=${taxYear}`).then(r => r.json()),
  });

  const hasError = reportError || summaryError;

  // cents → "$X,XXX.XX" with full precision so $1,234.56 never rounds to $1,235.
  const fmt = (n: number) =>
    `$${(n / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <PageShell>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold" data-testid="text-bookkeeping-title">
            Bookkeeping
          </h1>
          <p className="text-muted-foreground text-sm md:text-base">
            <span className="tabular-nums">{taxYear}</span> tax year — interest income, P&amp;L, and 1099 reports.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={!report || loadingReport}
          onClick={() => {
            // Build a CSV from the annual interest report client-side
            // (server export not shipped yet — but the data Tom needs
            // is already loaded). Beats a toast that says "coming soon".
            if (!report) return;
            const lines = [
              "Note ID,Borrower,Interest collected,Principal collected,1099 required",
              ...report.notes.map((n) => [
                n.noteId,
                JSON.stringify(n.borrowerName ?? ""),
                (n.interestCollected / 100).toFixed(2),
                (n.principalCollected / 100).toFixed(2),
                n.requires1099 ? "yes" : "no",
              ].join(",")),
              "",
              `Total interest,${(report.totalInterestIncome / 100).toFixed(2)}`,
              `Total principal,${(report.totalPrincipalReceived / 100).toFixed(2)}`,
              `Total late fees,${(report.totalLateFeesCollected / 100).toFixed(2)}`,
              `Notes requiring 1099,${report.notesWith1099Required}`,
            ];
            const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `bookkeeping-${taxYear}.csv`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            toast({ title: "Export ready", description: `bookkeeping-${taxYear}.csv downloaded.` });
          }}
          data-testid="button-export-bookkeeping"
        >
          <Download className="w-4 h-4 mr-2" aria-hidden="true" /> Export
        </Button>
      </div>

      {loadingReport || loadingSummary ? (
        <PageSkeleton variant="table" statCards={4} announceText="Loading bookkeeping data" />
      ) : hasError ? (
        <QueryErrorState
          error={reportErrorObj instanceof Error ? reportErrorObj : null}
          onRetry={() => {
            refetchReport();
            refetchSummary();
          }}
          isRetrying={reportRefetching}
          compact
          title="Couldn't load your books"
          description="We hit a snag loading your interest income and P&L. Your data is safe — try again."
          testId="bookkeeping-query-error"
        />
      ) : (
        <>
          <dl className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card>
              <CardContent className="p-4">
                <dt className="flex items-center gap-2 text-muted-foreground mb-1">
                  <DollarSign className="w-4 h-4" aria-hidden="true" />
                  <span className="text-xs">Interest income</span>
                </dt>
                <dd className="text-xl font-bold tabular-nums">
                  {report ? fmt(report.totalInterestIncome) : "—"}
                </dd>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <dt className="text-xs text-muted-foreground mb-1">Principal collected</dt>
                <dd className="text-xl font-bold tabular-nums">
                  {report ? fmt(report.totalPrincipalReceived) : "—"}
                </dd>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <dt className="flex items-center gap-2 text-muted-foreground mb-1">
                  <TrendingUp className="w-4 h-4" aria-hidden="true" />
                  <span className="text-xs">Net P&amp;L</span>
                </dt>
                <dd className="text-xl font-bold tabular-nums">
                  {summary ? fmt(summary.netProfit) : "—"}
                </dd>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <dt className="flex items-center gap-2 text-muted-foreground mb-1">
                  <FileText className="w-4 h-4" aria-hidden="true" />
                  <span className="text-xs">1099s required</span>
                </dt>
                <dd className="text-xl font-bold tabular-nums">{report?.notesWith1099Required ?? "—"}</dd>
              </CardContent>
            </Card>
          </dl>

          {report && report.notes.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Note interest summary</CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-0">
                <ul className="space-y-2" aria-label="Per-note interest summary">
                  {report.notes.map(n => (
                    <li key={n.noteId} className="flex items-center justify-between text-sm gap-3">
                      <div className="min-w-0">
                        <p className="font-medium text-xs truncate">{n.borrowerName}</p>
                        <p className="text-xs text-muted-foreground tabular-nums">
                          {fmt(n.interestCollected)} interest · {fmt(n.principalCollected)} principal
                        </p>
                      </div>
                      {n.requires1099 && (
                        <Badge variant="secondary" className="text-xs">1099</Badge>
                      )}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </PageShell>
  );
}
