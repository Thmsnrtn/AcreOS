import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { BarChart3, Loader2, TrendingUp } from "lucide-react";

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
  { value: "source", label: "Lead Source" },
  { value: "state", label: "State" },
  { value: "county", label: "County" },
  { value: "campaign", label: "Campaign" },
  { value: "import_month", label: "Import Month" },
  { value: "import_quarter", label: "Import Quarter" },
];

export default function CohortAnalysisPage() {
  const [segmentBy, setSegmentBy] = useState<Segment>("source");

  const { data, isLoading } = useQuery<CohortReport>({
    queryKey: ["/api/analytics/cohorts", segmentBy],
    queryFn: () =>
      fetch(`/api/analytics/cohorts?segmentBy=${segmentBy}`).then(r => r.json()),
  });

  const cohorts = data?.cohorts ?? [];

  return (
    <PageShell>
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold" data-testid="text-cohort-analysis-title">
            Cohort Analysis
          </h1>
          <p className="text-muted-foreground text-sm md:text-base">
            Track lead conversion rates by segment over time.
          </p>
        </div>
        <Select value={segmentBy} onValueChange={v => setSegmentBy(v as Segment)}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SEGMENTS.map(s => (
              <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {data && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground mb-1">Total Leads</p>
              <p className="text-2xl font-bold">{data.totalLeads.toLocaleString()}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground mb-1">Overall Close Rate</p>
              <p className="text-2xl font-bold">{data.overallClosedRate.toFixed(1)}%</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground mb-1">Cohorts</p>
              <p className="text-2xl font-bold">{cohorts.length}</p>
            </CardContent>
          </Card>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading cohorts...
        </div>
      ) : cohorts.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <BarChart3 className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-muted-foreground text-sm">No cohort data available.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {cohorts.map(c => (
            <Card key={c.segment}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{c.segment}</span>
                    <Badge variant="outline" className="text-xs">{c.totalLeads} leads</Badge>
                  </div>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <TrendingUp className="w-3 h-3" />
                    <span>{c.closedRate.toFixed(1)}% closed</span>
                  </div>
                </div>

                <div className="grid grid-cols-4 gap-3 text-xs mb-3">
                  <div>
                    <p className="text-muted-foreground">Contacted</p>
                    <p className="font-medium">{c.contactedRate.toFixed(1)}%</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Offer Sent</p>
                    <p className="font-medium">{c.offerRate.toFixed(1)}%</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Closed</p>
                    <p className="font-medium">{c.closedRate.toFixed(1)}%</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Avg Days</p>
                    <p className="font-medium">{c.avgDaysToClose != null ? `${c.avgDaysToClose}d` : "—"}</p>
                  </div>
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Funnel progress</span>
                    <span>{c.closedRate.toFixed(1)}%</span>
                  </div>
                  <Progress value={c.closedRate} className="h-1" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </PageShell>
  );
}
