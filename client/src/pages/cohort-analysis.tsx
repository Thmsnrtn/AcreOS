import { useState, useId } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { BarChart3, Loader2, TrendingUp } from "lucide-react";
import { SkeletonList } from "@/components/ui/skeleton-list";
import { EmptyState } from "@/components/empty-state";
import { QueryErrorState } from "@/components/query-error-state";

type Segment = "source" | "state" | "county" | "campaign" | "import_month" | "import_quarter";

interface CohortRow {
  segment: string;
  totalLeads: number;
  contacted: number;
  offerSent: number;
  underContract: number;
  closed: number;
  contactedRate: number;
  offerRate: number;
  closedRate: number;
  avgDaysToClose: number | null;
}

interface CohortReport {
  segmentBy: Segment;
  cohorts: CohortRow[];
  totalLeads: number;
  overallClosedRate: number;
  generatedAt: string;
}

const SEGMENTS: { value: Segment; label: string }[] = [
  { value: "source", label: "Lead source" },
  { value: "state", label: "State" },
  { value: "county", label: "County" },
  { value: "campaign", label: "Campaign" },
  { value: "import_month", label: "Import month" },
  { value: "import_quarter", label: "Import quarter" },
];

export default function CohortAnalysisPage() {
  useDocumentTitle("Cohort analysis");
  const [segmentBy, setSegmentBy] = useState<Segment>("source");
  const segmentSelectId = useId();

  const { data, isLoading, error, refetch } = useQuery<CohortReport>({
    queryKey: ["/api/analytics/cohorts", segmentBy],
    queryFn: () =>
      fetch(`/api/analytics/cohorts?segmentBy=${segmentBy}`).then(r => {
        if (!r.ok) throw new Error(`Failed to load cohort report (${r.status})`);
        return r.json();
      }),
  });

  const cohorts = data?.cohorts ?? [];

  return (
    <PageShell>
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold" data-testid="text-cohort-analysis-title">
            Cohort analysis
          </h1>
          <p className="text-muted-foreground text-sm md:text-base">
            Track lead conversion rates by segment over time.
          </p>
        </div>
        <div>
          <Label htmlFor={segmentSelectId} className="sr-only">Segment by</Label>
          <Select value={segmentBy} onValueChange={v => setSegmentBy(v as Segment)}>
            <SelectTrigger id={segmentSelectId} className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SEGMENTS.map(s => (
                <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {data && (
        <dl className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <Card>
            <CardContent className="p-4">
              <dt className="text-xs text-muted-foreground mb-1">Total leads</dt>
              <dd className="text-2xl font-bold tabular-nums">{data.totalLeads.toLocaleString()}</dd>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <dt className="text-xs text-muted-foreground mb-1">Overall close rate</dt>
              <dd className="text-2xl font-bold tabular-nums">{data.overallClosedRate.toFixed(1)}%</dd>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <dt className="text-xs text-muted-foreground mb-1">Cohorts</dt>
              <dd className="text-2xl font-bold tabular-nums">{cohorts.length}</dd>
            </CardContent>
          </Card>
        </dl>
      )}

      {isLoading ? (
        <div aria-busy="true" aria-label="Loading cohorts">
          <SkeletonList items={5} showAvatar={false} showBadge />
        </div>
      ) : error ? (
        <QueryErrorState
          error={error as Error}
          onRetry={() => refetch()}
          title="Couldn't load cohort report"
        />
      ) : cohorts.length === 0 ? (
        <EmptyState
          icon={BarChart3}
          title="Not enough lead data yet"
          description="Cohort analysis needs a baseline of leads to compare. Import or capture more leads, then come back to see conversion patterns by segment."
          actionLabel="Import leads"
          onAction={() => { window.location.assign("/leads/import"); }}
          actionIcon={null}
          testId="cohort-analysis-empty"
        />
      ) : (
        <ul className="space-y-2" aria-label="Cohorts">
          {cohorts.map(c => (
            <li key={c.segment}>
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{c.segment}</span>
                      <Badge variant="outline" className="text-xs">
                        <span className="tabular-nums">{c.totalLeads}</span> leads
                      </Badge>
                    </div>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <TrendingUp className="w-3 h-3" aria-hidden="true" />
                      <span className="tabular-nums">{c.closedRate.toFixed(1)}% closed</span>
                    </div>
                  </div>

                  <dl className="grid grid-cols-4 gap-3 text-xs mb-3">
                    <div>
                      <dt className="text-muted-foreground">Contacted</dt>
                      <dd className="font-medium tabular-nums">{c.contactedRate.toFixed(1)}%</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Offer sent</dt>
                      <dd className="font-medium tabular-nums">{c.offerRate.toFixed(1)}%</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Closed</dt>
                      <dd className="font-medium tabular-nums">{c.closedRate.toFixed(1)}%</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Avg days</dt>
                      <dd className="font-medium tabular-nums">{c.avgDaysToClose != null ? `${c.avgDaysToClose}d` : "—"}</dd>
                    </div>
                  </dl>

                  <div className="space-y-1">
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>Funnel progress</span>
                      <span className="tabular-nums">{c.closedRate.toFixed(1)}%</span>
                    </div>
                    <Progress
                      value={c.closedRate}
                      className="h-1"
                      aria-label={`${c.segment} funnel: ${c.closedRate.toFixed(1)}% closed`}
                    />
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </PageShell>
  );
}
