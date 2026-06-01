/**
 * /founder/pax-calibration — Pax confidence calibration plot (Workstream A).
 *
 * Tufte-style reliability diagram. X = stated Pax confidence bucket, Y =
 * realized accept-rate. 45° reference line marks perfect calibration; one
 * dot per non-empty bucket sized by sample count.
 *
 * Why this exists: the Decision Queue's confidence chip currently surfaces
 * a hand-coded constant from server/services/paxObserver.ts. Until those
 * confidences are real model outputs, this plot will show flat predictions
 * across noisy realized hit-rates. That divergence IS the diagnosis — the
 * surface is wired so it tells the truth the moment real confidences land.
 */

import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Target, AlertTriangle } from "lucide-react";
import {
  ResponsiveContainer,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  Cell,
} from "recharts";

import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import { QueryErrorState } from "@/components/query-error-state";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import { useDocumentTitle } from "@/hooks/use-document-title";

interface CalibrationBucket {
  label: string;
  predicted: number;        // 0..1, bucket midpoint
  observed: number | null;  // 0..1, realized accept-rate (null if n=0)
  n: number;
}

interface CalibrationResponse {
  asOf: string;
  windowDays: number;
  sampleCount: number;
  buckets: CalibrationBucket[];
  overallObservedRate: number;
  note: string;
}

const WINDOW_OPTIONS: Array<{ label: string; value: number }> = [
  { label: "7 days", value: 7 },
  { label: "30 days", value: 30 },
  { label: "90 days", value: 90 },
];

function fmtPct(value: number | null): string {
  if (value === null || value === undefined) return "—";
  return `${(value * 100).toFixed(1)}%`;
}

interface ScatterPointPayload {
  label: string;
  predicted: number;
  observed: number;
  n: number;
  radius: number;
}

/**
 * Custom Recharts shape — draws a filled circle whose radius scales with
 * sqrt(n) so a 100-sample bucket isn't 100× the visual weight of a 1-sample
 * one. Capped to keep the chart readable.
 */
function CalibrationDot(props: {
  cx?: number;
  cy?: number;
  payload?: ScatterPointPayload;
}) {
  const { cx, cy, payload } = props;
  if (cx === undefined || cy === undefined || !payload) return null;
  return (
    <circle
      cx={cx}
      cy={cy}
      r={payload.radius}
      fill="var(--acr-brand)"
      fillOpacity={0.75}
      stroke="var(--acr-brand)"
      strokeWidth={1.5}
    />
  );
}

function CalibrationTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: ScatterPointPayload }>;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-md border border-border bg-popover text-popover-foreground shadow-md text-xs p-2.5 space-y-0.5">
      <div className="font-medium">{p.label}</div>
      <div className="tabular-nums text-muted-foreground">
        predicted {fmtPct(p.predicted)}
      </div>
      <div className="tabular-nums text-muted-foreground">
        observed {fmtPct(p.observed)}
      </div>
      <div className="tabular-nums text-muted-foreground">
        n = {p.n.toLocaleString()}
      </div>
    </div>
  );
}

function ChartSkeleton() {
  return (
    <Card className="rounded-card">
      <CardContent className="p-4">
        <Skeleton className="h-[360px] w-full" />
      </CardContent>
    </Card>
  );
}

export default function FounderPaxCalibrationPage() {
  useDocumentTitle("Pax calibration — AcreOS");
  const [windowDays, setWindowDays] = React.useState<number>(30);

  const { data, isLoading, error, refetch } = useQuery<CalibrationResponse>({
    queryKey: ["/api/founder/pax-calibration", windowDays],
    queryFn: async () => {
      const r = await fetch(
        `/api/founder/pax-calibration?windowDays=${windowDays}`,
        { credentials: "include" },
      );
      if (!r.ok) throw new Error(`Failed to load calibration (${r.status})`);
      return r.json();
    },
  });

  // Build the scatter data (non-null buckets only) with computed radii.
  const scatterData: ScatterPointPayload[] = React.useMemo(() => {
    if (!data) return [];
    const populated = data.buckets.filter(
      (b): b is CalibrationBucket & { observed: number } =>
        b.observed !== null && b.n > 0,
    );
    if (populated.length === 0) return [];
    // sqrt(n) scaling, with a floor so 1-sample points are still clickable
    // and a cap so a single dominant bucket doesn't swallow the chart.
    const k = 4;
    const cap = 28;
    return populated.map((b) => ({
      label: b.label,
      predicted: b.predicted,
      observed: b.observed,
      n: b.n,
      radius: Math.min(cap, Math.max(4, Math.sqrt(b.n) * k)),
    }));
  }, [data]);

  return (
    <PageShell label="Pax calibration">
      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Target className="w-6 h-6 text-acr-brand" aria-hidden="true" />
            Pax calibration
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Reliability diagram. X-axis is the confidence Pax stated; Y-axis is
            the realized accept-rate. The 45° line is perfect calibration —
            points above it mean Pax was under-confident, below means
            over-confident. Each dot is a confidence bucket, sized by sample
            count.
          </p>
          {data && (
            <p className="text-xs text-muted-foreground mt-2 tabular-nums">
              Window: last {data.windowDays} days · {data.sampleCount.toLocaleString()}{" "}
              observation{data.sampleCount === 1 ? "" : "s"} · overall accept-rate{" "}
              {fmtPct(data.overallObservedRate)}
            </p>
          )}
        </div>
        <div
          className="flex items-center gap-1 shrink-0"
          role="group"
          aria-label="Window size"
        >
          {WINDOW_OPTIONS.map((opt) => (
            <Button
              key={opt.value}
              variant={windowDays === opt.value ? "default" : "outline"}
              size="sm"
              onClick={() => setWindowDays(opt.value)}
              data-testid={`pax-calibration-window-${opt.value}`}
              aria-pressed={windowDays === opt.value}
            >
              {opt.label}
            </Button>
          ))}
        </div>
      </div>

      {data && (
        <Card
          className="rounded-card mb-4 bg-acr-warn-soft border-acr-warn/30"
          data-testid="pax-calibration-honest-disclosure"
        >
          <CardContent className="p-3.5 flex items-start gap-2.5">
            <AlertTriangle
              className="w-4 h-4 text-acr-warn shrink-0 mt-0.5"
              aria-hidden="true"
            />
            <p className="text-xs leading-relaxed">{data.note}</p>
          </CardContent>
        </Card>
      )}

      {error && (
        <QueryErrorState
          error={error as Error}
          onRetry={() => refetch()}
          title="Couldn't load calibration"
          description="We hit a snag computing the reliability diagram. Try again."
          testId="pax-calibration-error"
        />
      )}

      {isLoading && (
        <div data-testid="pax-calibration-loading" className="space-y-3">
          <ChartSkeleton />
          <Card className="rounded-card">
            <CardContent className="p-4 space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-6 w-full" />
              ))}
            </CardContent>
          </Card>
        </div>
      )}

      {!isLoading && !error && data && data.sampleCount === 0 && (
        <EmptyState
          icon={Target}
          headline="No Pax observations yet"
          subtitle={`No Pax observations were emitted in the last ${data.windowDays} days. As soon as Pax starts making calls, the calibration plot will populate.`}
          // TODO(cta): Pax observations are system-generated from customer AI calls; no direct founder action
          cta={{ label: "", _noOp: true }}
          actionIcon={null}
          testId="pax-calibration-empty"
        />
      )}

      {!isLoading && !error && data && data.sampleCount > 0 && (
        <div className="space-y-4">
          <Card className="rounded-card" data-testid="pax-calibration-chart-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Predicted vs. observed</CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <div className="h-[400px] w-full" data-testid="pax-calibration-chart">
                <ResponsiveContainer width="100%" height="100%">
                  <ScatterChart
                    margin={{ top: 16, right: 24, bottom: 36, left: 36 }}
                  >
                    <CartesianGrid stroke="var(--acr-line-soft)" />
                    <XAxis
                      type="number"
                      dataKey="predicted"
                      domain={[0, 1]}
                      ticks={[0.5, 0.6, 0.7, 0.8, 0.9, 1.0]}
                      tickFormatter={(v: number) => `${Math.round(v * 100)}%`}
                      stroke="var(--acr-ink-3, currentColor)"
                      tick={{ fontSize: 11 }}
                      label={{
                        value: "Predicted (Pax-stated)",
                        position: "insideBottom",
                        offset: -20,
                        style: { fontSize: 11, fill: "var(--acr-ink-3, currentColor)" },
                      }}
                    />
                    <YAxis
                      type="number"
                      dataKey="observed"
                      domain={[0, 1]}
                      ticks={[0, 0.2, 0.4, 0.6, 0.8, 1.0]}
                      tickFormatter={(v: number) => `${Math.round(v * 100)}%`}
                      stroke="var(--acr-ink-3, currentColor)"
                      tick={{ fontSize: 11 }}
                      label={{
                        value: "Observed (realized accept-rate)",
                        angle: -90,
                        position: "insideLeft",
                        offset: 10,
                        style: { fontSize: 11, fill: "var(--acr-ink-3, currentColor)", textAnchor: "middle" },
                      }}
                    />
                    {/* 45° perfect-calibration reference line */}
                    <ReferenceLine
                      segment={[
                        { x: 0, y: 0 },
                        { x: 1, y: 1 },
                      ]}
                      stroke="var(--acr-line-soft)"
                      strokeWidth={1.5}
                      ifOverflow="extendDomain"
                    />
                    <Tooltip
                      content={<CalibrationTooltip />}
                      cursor={{ stroke: "var(--acr-line-soft)", strokeDasharray: "3 3" }}
                    />
                    <Scatter
                      name="Calibration"
                      data={scatterData}
                      shape={<CalibrationDot />}
                      isAnimationActive={false}
                    >
                      {scatterData.map((_, i) => (
                        <Cell key={i} />
                      ))}
                    </Scatter>
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-card" data-testid="pax-calibration-table-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Buckets</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Bucket</TableHead>
                    <TableHead className="text-right">Predicted</TableHead>
                    <TableHead className="text-right">Observed</TableHead>
                    <TableHead className="text-right">n</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.buckets.map((b) => (
                    <TableRow
                      key={b.label}
                      data-testid={`pax-calibration-row-${b.label}`}
                    >
                      <TableCell className="font-medium">{b.label}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtPct(b.predicted)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {b.n === 0 ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          fmtPct(b.observed)
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {b.n === 0 ? (
                          <span className="text-muted-foreground">0</span>
                        ) : (
                          <Badge
                            variant="secondary"
                            className="bg-acr-brand-soft text-acr-brand border-transparent tabular-nums"
                          >
                            {b.n.toLocaleString()}
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}
    </PageShell>
  );
}
