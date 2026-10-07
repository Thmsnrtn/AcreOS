import { useQuery } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DollarSign, FileText, Receipt, Download } from "lucide-react";
import { PageSkeleton } from "@/components/page-skeleton";
import { QueryErrorState } from "@/components/query-error-state";
import { useToast } from "@/hooks/use-toast";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { Verbs } from "@/lib/labels";
import { usd } from "@/lib/format";
import { contractQueryFn } from "@/lib/contractFetch";
import { buildBookkeepingCsv } from "@/lib/bookkeepingCsv";
import { annualInterestReportContract } from "@shared/contracts";

const currentYear = new Date().getFullYear();
const taxYear = currentYear - 1;

export default function BookkeepingPage() {
  useDocumentTitle("Bookkeeping");
  const { toast } = useToast();

  // One request, through the app's query client and the shared contract
  // (shared/contracts/bookkeeping.ts): a non-2xx response is an ERROR, and a
  // response missing a field this page reads fails the contract instead of
  // rendering as "$NaN". The key IS the URL — getQueryFn joins it.
  const {
    data: report,
    isLoading: loadingReport,
    isError: reportError,
    error: reportErrorObj,
    refetch: refetchReport,
    isRefetching: reportRefetching,
  } = useQuery({
    queryKey: [`${annualInterestReportContract.path}?year=${taxYear}`],
    queryFn: contractQueryFn(annualInterestReportContract),
  });

  // The report's money fields are DOLLARS (the contract's stated unit — the
  // server converted from cents once). Render them as dollars; `usd` shows
  // the not-available mark for a missing or non-finite value, never NaN.
  const fmt = (n: number | null | undefined) => usd(n);

  return (
    <PageShell>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold" data-testid="text-bookkeeping-title">
            Bookkeeping
          </h1>
          <p className="text-muted-foreground text-sm md:text-base">
            <span className="tabular-nums">{taxYear}</span> tax year — interest income, principal, late fees, and the year-end interest report.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={!report || loadingReport}
          onClick={() => {
            // Built client-side from the loaded report (no server export
            // yet). Dollars in, dollars out — see lib/bookkeepingCsv.ts.
            if (!report) return;
            const blob = new Blob([buildBookkeepingCsv(report)], { type: "text/csv;charset=utf-8" });
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
          <Download className="w-4 h-4 mr-2" aria-hidden="true" /> {Verbs.EXPORT}
        </Button>
      </div>

      {loadingReport ? (
        <PageSkeleton variant="table" statCards={4} announceText="Loading bookkeeping data" />
      ) : reportError ? (
        <QueryErrorState
          error={reportErrorObj instanceof Error ? reportErrorObj : null}
          onRetry={() => {
            refetchReport();
          }}
          isRetrying={reportRefetching}
          compact
          title="Couldn't load your books"
          description="We hit a snag loading your interest income report. Your data is safe — try again."
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
                  {fmt(report?.totalInterestIncome)}
                </dd>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <dt className="text-xs text-muted-foreground mb-1">Principal collected</dt>
                <dd className="text-xl font-bold tabular-nums">
                  {fmt(report?.totalPrincipalReceived)}
                </dd>
              </CardContent>
            </Card>
            {/* This card read `netProfit`, which no endpoint returns, and
                rendered "$NaN". No portfolio P&L is computed anywhere, so the
                card shows a figure the report really carries. */}
            <Card>
              <CardContent className="p-4">
                <dt className="flex items-center gap-2 text-muted-foreground mb-1">
                  <Receipt className="w-4 h-4" aria-hidden="true" />
                  <span className="text-xs">Late fees collected</span>
                </dt>
                <dd className="text-xl font-bold tabular-nums">
                  {fmt(report?.totalLateFeesCollected)}
                </dd>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <dt className="flex items-center gap-2 text-muted-foreground mb-1">
                  <FileText className="w-4 h-4" aria-hidden="true" />
                  <span className="text-xs">Notes ≥ $600 interest received (review)</span>
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
                        <Badge variant="secondary" className="text-xs">≥ $600</Badge>
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
