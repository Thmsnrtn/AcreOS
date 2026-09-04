/**
 * T114 — Pipeline Velocity Component
 *
 * Shows average days deals spend in each stage of the pipeline.
 * Identifies bottleneck stages and deals that have stalled.
 * Fetches deal data and computes velocity client-side.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchJsonArray } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { QueryErrorState } from "@/components/query-error-state";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { Clock, TrendingUp, AlertCircle } from "lucide-react";

const PIPELINE_STAGES = [
  "new",
  "offer_sent",
  "countered",
  "under_contract",
  "due_diligence",
  "closing",
  "closed",
];

const STAGE_LABELS: Record<string, string> = {
  new: "New",
  offer_sent: "Offer Sent",
  countered: "Countered",
  under_contract: "Under Contract",
  due_diligence: "Due Diligence",
  closing: "Closing",
  closed: "Closed",
};

interface Deal {
  id: number;
  status: string;
  createdAt: string;
  updatedAt: string;
  offerDate?: string;
  closedAt?: string;
}

interface StageVelocity {
  stage: string;
  label: string;
  avgDays: number;
  dealCount: number;
  stalledCount: number; // deals in this stage > 2x avg
}

const STALL_THRESHOLD_DAYS: Record<string, number> = {
  new: 7,
  offer_sent: 14,
  countered: 7,
  under_contract: 30,
  due_diligence: 21,
  closing: 14,
};

export function PipelineVelocity() {
  // /api/deals returns a paginated envelope; normalize to an array
  // so the .filter / velocity-computation below is safe. (2026-05-26)
  // Velocity stats are computed from recent deals; pageSize=500 was
  // pulling ~half a meg of JSON every time any page that renders this
  // widget mounted. pageSize=100 keeps it consistent with the other
  // ["/api/deals"] consumers so they share cache cleanly.
  const { data: deals = [], isLoading, isError, error, refetch, isRefetching } = useQuery<Deal[]>({
    queryKey: ["/api/deals"],
    queryFn: () => fetchJsonArray<Deal>("/api/deals?pageSize=100"),
  });

  const velocityData = useMemo<StageVelocity[]>(() => {
    if (!deals) return [];

    return PIPELINE_STAGES.filter(s => s !== "closed").map(stage => {
      const stageDeals = deals.filter(d => d.status === stage);
      const now = new Date();

      const daysList = stageDeals.map(d => {
        const start = new Date(d.updatedAt || d.createdAt);
        return Math.max(0, (now.getTime() - start.getTime()) / 86400000);
      });

      const avgDays = daysList.length > 0
        ? Math.round(daysList.reduce((s, d) => s + d, 0) / daysList.length)
        : 0;

      const stallThreshold = STALL_THRESHOLD_DAYS[stage] ?? 14;
      const stalledCount = daysList.filter(d => d > stallThreshold).length;

      return {
        stage,
        label: STAGE_LABELS[stage] ?? stage,
        avgDays,
        dealCount: stageDeals.length,
        stalledCount,
      };
    }).filter(s => s.dealCount > 0);
  }, [deals]);

  const totalStalled = velocityData.reduce((s, v) => s + v.stalledCount, 0);
  const bottleneck = velocityData.sort((a, b) => b.avgDays - a.avgDays)[0];

  const chartData = velocityData.map(v => ({
    name: v.label,
    avgDays: v.avgDays,
    deals: v.dealCount,
    stalled: v.stalledCount,
  }));

  return (
    <Card>
      <CardHeader className="pb-3 flex-row items-start justify-between">
        <div>
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="w-4 h-4 text-acr-accent" /> Pipeline Velocity
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-0.5">
            Average days deals spend in each stage
          </p>
        </div>
        <div className="flex gap-2 flex-wrap justify-end">
          {totalStalled > 0 && (
            <Badge variant="destructive" className="text-xs">
              <AlertCircle className="w-3 h-3 mr-1" /> {totalStalled} stalled
            </Badge>
          )}
          {bottleneck && bottleneck.avgDays > 0 && (
            <Badge variant="outline" className="text-xs">
              Bottleneck: {bottleneck.label}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-8 w-full" />)}
          </div>
        ) : isError ? (
          // BEFORE THE EMPTY BRANCH, and that order is the point. When
          // fetchJsonArray swallowed failures into [], a failed read fell
          // through to "No active deals to analyze. Add deals to see pipeline
          // velocity." — telling a customer with a full pipeline that they had
          // none, and instructing them to add deals they already have.
          <QueryErrorState
            error={error}
            onRetry={() => void refetch()}
            isRetrying={isRefetching}
            compact
            title="Couldn't load your pipeline"
            description="We couldn't read your deals just now, so velocity is unknown — not zero."
            testId="pipeline-velocity-error"
          />
        ) : !velocityData.length ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            No active deals to analyze. Add deals to see pipeline velocity.
          </p>
        ) : (
          <>
            <div
              role="img"
              aria-label={`Pipeline velocity bar chart: ${chartData.map((d: any) => `${d.name} ${d.avgDays} days${d.stalled > 0 ? ` (${d.stalled} stalled)` : ""}`).join(", ")}`}
            >
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={chartData} margin={{ top: 0, right: 8, bottom: 0, left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} unit="d" />
                <Tooltip
                  formatter={((v: number) => [`${v} days`, "Avg Days"]) as any}
                />
                <Bar dataKey="avgDays" radius={[2, 2, 0, 0]}>
                  {chartData.map((entry, i) => (
                    <Cell
                      key={i}
                      fill={entry.stalled > 0 ? "#ef4444" : entry.avgDays > 10 ? "#f59e0b" : "#22c55e"}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            </div>

            <div className="mt-3 grid grid-cols-2 md:grid-cols-3 gap-2">
              {velocityData.map(v => (
                <div
                  key={v.stage}
                  className="rounded border p-2 text-xs"
                >
                  <div className="font-medium flex items-center justify-between">
                    <span>{v.label}</span>
                    {v.stalledCount > 0 && (
                      <span className="text-acr-neg flex items-center gap-0.5">
                        <AlertCircle className="w-3 h-3" /> {v.stalledCount}
                      </span>
                    )}
                  </div>
                  <div className="text-muted-foreground mt-0.5">
                    <span className="font-semibold text-foreground">{v.avgDays}d</span> avg · {v.dealCount} deal{v.dealCount !== 1 ? "s" : ""}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
