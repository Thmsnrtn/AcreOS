/**
 * Founder market-report review surface (Tier 3F — witnessed-publish foundation).
 *
 * The data co-op drafts a quarterly, privacy-preserving land-market report from
 * the persisted county_market_rollups (k>=5 floor per county). Those drafts are
 * stored server-side (market_report_drafts, status 'draft') and exposed via
 * /api/founder/market-reports — but until now NOTHING consumed them, so the
 * founder couldn't see or steer a draft. This is that review surface.
 *
 * Review ONLY. There is deliberately NO publish transition and NO public page:
 * a quarter is worthless to index until its counties clear the k>=5 density
 * floor, and at current scale most quarters draft EMPTY by design (not a bug).
 * The EmptyState says so honestly.
 *
 * Endpoints consumed:
 *   GET  /api/founder/market-reports            → { drafts: [{id, quarter, status, generatedAt}] }
 *   GET  /api/founder/market-reports/:quarter   → full MarketReportDraft row (report JSON + markdown)
 *   POST /api/founder/market-reports/generate   → { quarter } body; (re)generates the draft
 *
 * Founder-gated (FounderProtectedRoute in App.tsx). Founder personas only —
 * never "Pax" here.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { PageShell } from "@/components/page-shell";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { QueryErrorState } from "@/components/query-error-state";
import { useToast } from "@/hooks/use-toast";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { formatDate, formatDateTime } from "@/lib/format";
import { Newspaper, RefreshCw, Eye, FileText, Database } from "lucide-react";

// ─── Types (mirror routes-founder-market-reports.ts response shapes) ─────────

type ReportStatus = "draft" | "published";

interface MarketReportDraftSummary {
  id: number;
  quarter: string; // "YYYY-Q#"
  status: ReportStatus;
  generatedAt: string;
}

interface MarketReportDraftDetail extends MarketReportDraftSummary {
  /** Structured JSON artifact — carried verbatim from rollups (k>=5). */
  report: Record<string, unknown>;
  /** Rendered markdown artifact. */
  markdown: string;
}

interface ListResponse {
  drafts: MarketReportDraftSummary[];
}

const LIST_KEY = "/api/founder/market-reports";

// ─── Current + recent quarter helpers (for the regenerate control) ───────────

function quarterOf(d: Date): string {
  const q = Math.floor(d.getUTCMonth() / 3) + 1;
  return `${d.getUTCFullYear()}-Q${q}`;
}

/** Current quarter + the previous one — the two a founder would ordinarily draft. */
function draftableQuarters(): string[] {
  const now = new Date();
  const current = quarterOf(now);
  const prevDate = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 3, 1),
  );
  const previous = quarterOf(prevDate);
  return previous === current ? [current] : [current, previous];
}

// ─── Detail / preview panel ──────────────────────────────────────────────────

function ReportPreview({ quarter }: { quarter: string }) {
  const { data, isLoading, error, refetch, isRefetching } =
    useQuery<MarketReportDraftDetail>({
      queryKey: [`${LIST_KEY}/${quarter}`],
    });

  if (isLoading) {
    return (
      <div
        className="space-y-2"
        role="status"
        aria-label={`Loading the ${quarter} market report`}
      >
        <Skeleton className="h-5 w-48 rounded-card" announce={false} />
        <Skeleton className="h-64 w-full rounded-card" announce={false} />
      </div>
    );
  }

  if (error) {
    return (
      <QueryErrorState
        error={error}
        onRetry={() => refetch()}
        isRetrying={isRefetching}
        title="Couldn't load this report"
        description="The market-report draft failed to load. Please try again."
        testId="founder-market-report-detail-error"
      />
    );
  }

  if (!data) return null;

  const insufficient = data.report?.insufficientData === true;
  const countiesReported =
    typeof data.report?.countiesReported === "number"
      ? (data.report.countiesReported as number)
      : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <Database className="h-3 w-3" aria-hidden="true" />
          {countiesReported === null
            ? "Counties reported: —"
            : insufficient || countiesReported === 0
              ? "No county cleared the k≥5 density floor this quarter"
              : `${countiesReported} count${countiesReported === 1 ? "y" : "ies"} cleared the k≥5 floor`}
        </span>
        <span>· Generated {formatDateTime(data.generatedAt)}</span>
      </div>

      {/* Rendered markdown artifact — shown verbatim, monospace, never edited
          here (review surface only; no publish). */}
      <pre className="whitespace-pre-wrap break-words rounded-card border bg-muted/40 p-4 text-sm leading-relaxed text-acr-ink-1">
        {data.markdown}
      </pre>

      <details className="rounded-card border bg-card">
        <summary className="cursor-pointer select-none px-4 py-2 text-xs font-medium text-acr-ink-2">
          Structured JSON artifact
        </summary>
        <pre className="overflow-x-auto px-4 pb-4 text-xs leading-relaxed text-muted-foreground">
          {JSON.stringify(data.report, null, 2)}
        </pre>
      </details>
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function FounderMarketReportsPage() {
  useDocumentTitle("Market reports");
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [openQuarter, setOpenQuarter] = useState<string | null>(null);

  const { data, isLoading, error, refetch, isRefetching } =
    useQuery<ListResponse>({
      queryKey: [LIST_KEY],
    });

  const drafts = data?.drafts ?? [];

  const regenerate = useMutation({
    mutationFn: async (quarter: string) => {
      const resp = await apiRequest(
        "POST",
        "/api/founder/market-reports/generate",
        { quarter },
      );
      if (!resp.ok) {
        const b = await resp.json().catch(() => ({}));
        throw new Error(b.message || "Generation failed");
      }
      return resp.json() as Promise<MarketReportDraftDetail>;
    },
    onSuccess: (draft) => {
      queryClient.invalidateQueries({ queryKey: [LIST_KEY] });
      queryClient.invalidateQueries({
        queryKey: [`${LIST_KEY}/${draft.quarter}`],
      });
      setOpenQuarter(draft.quarter);
      const insufficient = draft.report?.insufficientData === true;
      toast({
        title: `Drafted ${draft.quarter}`,
        description: insufficient
          ? "No county cleared the k≥5 density floor — the draft says so honestly rather than estimating."
          : "Draft regenerated from the latest county rollups.",
      });
    },
    onError: (err: unknown) => {
      toast({
        title: "Couldn't draft the report",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    },
  });

  const pendingQuarter = regenerate.isPending
    ? (regenerate.variables as string | undefined)
    : undefined;

  return (
    <PageShell>
      <div className="mx-auto max-w-3xl space-y-6 py-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-semibold">
              <Newspaper className="h-6 w-6" aria-hidden="true" />
              Market reports
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              The data co-op's quarterly, privacy-preserving land-market report.
              Every figure is carried verbatim from county rollups that each
              cleared a k≥5 contribution floor — nothing is estimated. These are
              DRAFTS for your review only; there is deliberately no publish path
              yet.
            </p>
          </div>
        </div>

        {/* Draft / regenerate controls for the current + previous quarter */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Draft a quarter</CardTitle>
            <CardDescription>
              Regenerate from the latest county rollups. Idempotent — replaces
              the existing draft for that quarter (status stays draft).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {draftableQuarters().map((q) => {
                const busy = pendingQuarter === q;
                return (
                  <Button
                    key={q}
                    size="sm"
                    variant="outline"
                    disabled={regenerate.isPending}
                    onClick={() => regenerate.mutate(q)}
                    aria-label={`Regenerate the ${q} market report draft`}
                  >
                    <RefreshCw
                      className={`mr-1.5 h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`}
                      aria-hidden="true"
                    />
                    {busy ? `Drafting ${q}…` : `Draft ${q}`}
                  </Button>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {isLoading && (
          <div
            className="space-y-3"
            role="status"
            aria-label="Loading market-report drafts"
          >
            {[1, 2].map((i) => (
              <Skeleton
                key={i}
                className="h-24 w-full rounded-card"
                announce={false}
              />
            ))}
          </div>
        )}

        {error && (
          <QueryErrorState
            error={error}
            onRetry={() => refetch()}
            isRetrying={isRefetching}
            title="Couldn't load market reports"
            description="The market-report draft list failed to load. Please try again."
            testId="founder-market-reports-error"
          />
        )}

        {!isLoading && !error && drafts.length === 0 && (
          <EmptyState
            icon={Database}
            headline="No market reports yet"
            subtitle="The co-op needs ≥5 contributing parcels per county before a quarter drafts. At current scale this is usually empty by design, not a bug — a quarter will appear here the moment a county clears the k≥5 density floor (or draft one above to confirm)."
            // TODO(cta): drafting lives in the "Draft a quarter" card above —
            // no separate empty-state action needed.
            cta={{ label: "", _noOp: true }}
            testId="founder-market-reports-empty"
          />
        )}

        {!isLoading && !error && drafts.length > 0 && (
          <div className="space-y-4">
            {drafts.map((d) => {
              const isOpen = openQuarter === d.quarter;
              const busy = pendingQuarter === d.quarter;
              return (
                <Card key={d.id}>
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <CardTitle className="flex items-center gap-2 text-base">
                          <FileText
                            className="h-4 w-4 text-acr-ink-2"
                            aria-hidden="true"
                          />
                          {d.quarter}
                        </CardTitle>
                        <CardDescription className="mt-0.5">
                          Generated {formatDate(d.generatedAt)}
                        </CardDescription>
                      </div>
                      <Badge
                        variant={d.status === "published" ? "default" : "secondary"}
                        className="shrink-0 capitalize"
                      >
                        {d.status}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        size="sm"
                        variant={isOpen ? "secondary" : "outline"}
                        onClick={() =>
                          setOpenQuarter(isOpen ? null : d.quarter)
                        }
                        aria-label={
                          isOpen
                            ? `Hide the ${d.quarter} report preview`
                            : `Preview the ${d.quarter} report`
                        }
                        aria-expanded={isOpen}
                      >
                        <Eye className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                        {isOpen ? "Hide preview" : "Preview"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={regenerate.isPending}
                        onClick={() => regenerate.mutate(d.quarter)}
                        aria-label={`Regenerate the ${d.quarter} report draft`}
                      >
                        <RefreshCw
                          className={`mr-1.5 h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`}
                          aria-hidden="true"
                        />
                        {busy ? "Regenerating…" : "Regenerate"}
                      </Button>
                    </div>

                    {isOpen && (
                      <div className="border-t pt-3">
                        <ReportPreview quarter={d.quarter} />
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </PageShell>
  );
}
