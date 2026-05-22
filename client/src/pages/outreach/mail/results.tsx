/**
 * /outreach/mail · Results tab (Pillar 3 Tab 3).
 *
 * Per-campaign attribution analytics. Pick a shipment, see the
 * sent→delivered→QR→call→deal funnel, cost-per-stage, response timeline,
 * template comparison, and a 6-month cohort table.
 */

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  BarChart3,
  Download,
  Inbox,
  Mailbox,
  PackageCheck,
  Phone,
  QrCode,
  Send,
  Sparkles,
} from "lucide-react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/empty-state";
import { QueryErrorState } from "@/components/query-error-state";
import { staggerContainer, staggerItem } from "@/lib/animations";
import {
  type FunnelResponse,
  type TemplateCompareRow,
  type CohortRow,
  type ResponseTimelinePoint,
  useCohortByMonth,
  useInFlightShipments,
  useResponseTimeline,
  useResultsFunnel,
  useTemplateCompare,
} from "@/hooks/use-outreach-mail";

function formatUsd(cents: number): string {
  if (!Number.isFinite(cents) || cents === 0) return "$0.00";
  return `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatCentsCompact(cents: number): string {
  if (!Number.isFinite(cents) || cents === 0) return "—";
  if (cents < 100) return `${cents}¢`;
  return `$${(cents / 100).toFixed(2)}`;
}

export default function ResultsTab() {
  const shipments = useInFlightShipments();
  const [selectedShipmentId, setSelectedShipmentId] = useState<number | null>(null);

  const effectiveShipmentId = useMemo(() => {
    if (selectedShipmentId !== null) return selectedShipmentId;
    return shipments.data?.shipments[0]?.id ?? null;
  }, [selectedShipmentId, shipments.data]);

  const funnel = useResultsFunnel(effectiveShipmentId);
  const timeline = useResponseTimeline(effectiveShipmentId);
  const templates = useTemplateCompare(90);
  const cohort = useCohortByMonth(180);

  if (shipments.isLoading) {
    return (
      <div className="space-y-4" data-testid="results-loading">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (shipments.error) {
    return (
      <QueryErrorState error={shipments.error as Error} onRetry={() => shipments.refetch()} />
    );
  }

  if (!shipments.data || shipments.data.shipments.length === 0) {
    return (
      <EmptyState
        icon={BarChart3}
        title="No campaigns to analyze yet"
        description="Once a shipment leaves the hold window, this tab unlocks per-campaign attribution — delivery, QR scans, inbound calls, and deal lift."
        testId="results-empty"
      />
    );
  }

  return (
    <motion.div
      variants={staggerContainer}
      initial="initial"
      animate="animate"
      className="space-y-6"
      data-testid="results-list"
    >
      <motion.div variants={staggerItem}>
        <Card>
          <CardHeader className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
            <div>
              <CardTitle>Campaign</CardTitle>
              <CardDescription>Select a shipment to see attribution detail.</CardDescription>
            </div>
            <div className="flex flex-col md:flex-row gap-2 md:items-center">
              <Select
                value={effectiveShipmentId ? String(effectiveShipmentId) : ""}
                onValueChange={(v) => setSelectedShipmentId(v ? Number(v) : null)}
              >
                <SelectTrigger className="w-full md:w-72" data-testid="results-shipment-select">
                  <SelectValue placeholder="Pick a shipment" />
                </SelectTrigger>
                <SelectContent>
                  {shipments.data.shipments.map((s) => (
                    <SelectItem key={s.id} value={String(s.id)}>
                      Campaign R{String(s.id).padStart(3, "0")} — {s.label ?? "Untitled"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {effectiveShipmentId && (
                <Button asChild variant="outline" size="sm" data-testid="results-export-csv">
                  <a href={`/api/outreach/mail/results/${effectiveShipmentId}/export.csv`}>
                    <Download className="w-4 h-4 mr-2" aria-hidden="true" />
                    Export CSV
                  </a>
                </Button>
              )}
            </div>
          </CardHeader>
        </Card>
      </motion.div>

      <motion.div variants={staggerItem}>
        <FunnelCard funnel={funnel} />
      </motion.div>

      <motion.div variants={staggerItem}>
        <CostPerStageRow funnel={funnel} />
      </motion.div>

      <motion.div variants={staggerItem}>
        <TimelineCard timeline={timeline} />
      </motion.div>

      <motion.div variants={staggerItem}>
        <TemplateTable templates={templates} />
      </motion.div>

      <motion.div variants={staggerItem}>
        <CohortTable cohort={cohort} />
      </motion.div>
    </motion.div>
  );
}

// ── Funnel visualization ────────────────────────────────────────────────────

interface FunnelStage {
  key: string;
  label: string;
  icon: typeof Send;
  count: number;
  cssToken: string; // text color token
}

function FunnelCard({
  funnel,
}: {
  funnel: ReturnType<typeof useResultsFunnel>;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Funnel</CardTitle>
        <CardDescription>From mailbox to closed deal — relative volumes.</CardDescription>
      </CardHeader>
      <CardContent>
        {funnel.isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : funnel.error ? (
          <QueryErrorState
            error={funnel.error as Error}
            onRetry={() => funnel.refetch()}
            compact
          />
        ) : funnel.data ? (
          <FunnelBars data={funnel.data} />
        ) : (
          <p className="text-sm text-muted-foreground">No data.</p>
        )}
      </CardContent>
    </Card>
  );
}

function FunnelBars({ data }: { data: FunnelResponse }) {
  const stages: FunnelStage[] = [
    { key: "sent", label: "Sent", icon: Send, count: data.sent, cssToken: "text-foreground" },
    {
      key: "delivered",
      label: "Delivered",
      icon: PackageCheck,
      count: data.delivered,
      cssToken: "text-acr-pos",
    },
    { key: "qr", label: "QR scans", icon: QrCode, count: data.qrScans, cssToken: "text-acr-pos" },
    {
      key: "calls",
      label: "Calls",
      icon: Phone,
      count: data.callsReceived,
      cssToken: "text-acr-pos",
    },
    {
      key: "dealsOpened",
      label: "Deals opened",
      icon: Inbox,
      count: data.dealsOpened,
      cssToken: "text-acr-pos",
    },
    {
      key: "dealsClosed",
      label: "Deals closed",
      icon: Sparkles,
      count: data.dealsClosed,
      cssToken: "text-acr-pos",
    },
  ];
  const max = Math.max(1, ...stages.map((s) => s.count));

  return (
    <ol className="space-y-2" aria-label="Campaign funnel" data-testid="funnel-bars">
      {stages.map((s) => {
        const pct = Math.max(2, Math.round((s.count / max) * 100));
        const Icon = s.icon;
        return (
          <li key={s.key} className="flex items-center gap-3">
            <div className="w-32 shrink-0 flex items-center gap-2 text-sm">
              <Icon className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
              <span className="font-medium">{s.label}</span>
            </div>
            <div className="flex-1 h-6 rounded-md bg-muted/30 overflow-hidden">
              <div
                role="progressbar"
                aria-valuenow={s.count}
                aria-valuemin={0}
                aria-valuemax={max}
                aria-label={`${s.label}: ${s.count}`}
                className="h-full bg-primary/60 transition-[width] duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className={`w-16 text-right text-sm font-mono ${s.cssToken}`}>
              {s.count.toLocaleString()}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

// ── Cost-per-stage ──────────────────────────────────────────────────────────

function CostPerStageRow({ funnel }: { funnel: ReturnType<typeof useResultsFunnel> }) {
  if (funnel.isLoading || !funnel.data) return null;
  const d = funnel.data;
  const items: Array<{ label: string; cents: number }> = [
    { label: "$ / sent", cents: d.costPerSentCents },
    { label: "$ / delivered", cents: d.costPerDeliveredCents },
    { label: "$ / QR scan", cents: d.costPerQrScanCents },
    { label: "$ / call", cents: d.costPerCallCents },
    { label: "$ / deal", cents: d.costPerDealCents },
  ];
  return (
    <div
      className="grid grid-cols-2 md:grid-cols-5 gap-2"
      data-testid="cost-per-stage"
    >
      {items.map((it) => (
        <Card key={it.label}>
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">{it.label}</p>
            <p className="text-lg font-semibold font-mono text-acr-warn">
              {formatCentsCompact(it.cents)}
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ── Timeline (line chart) ──────────────────────────────────────────────────

function TimelineCard({
  timeline,
}: {
  timeline: ReturnType<typeof useResponseTimeline>;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Response timeline</CardTitle>
        <CardDescription>QR scans + inbound calls in the 30 days after send.</CardDescription>
      </CardHeader>
      <CardContent>
        {timeline.isLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : timeline.error ? (
          <QueryErrorState
            error={timeline.error as Error}
            onRetry={() => timeline.refetch()}
            compact
          />
        ) : timeline.data && timeline.data.length > 0 ? (
          <TimelineChart points={timeline.data} />
        ) : (
          <p className="text-sm text-muted-foreground">No response activity yet.</p>
        )}
      </CardContent>
    </Card>
  );
}

function TimelineChart({ points }: { points: ResponseTimelinePoint[] }) {
  return (
    <div className="h-64 w-full" data-testid="timeline-chart">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
          <XAxis
            dataKey="day"
            tick={{ fontSize: 11 }}
            tickFormatter={(d: string) => d.slice(5)}
          />
          <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
          <Tooltip
            contentStyle={{
              background: "hsl(var(--background))",
              border: "1px solid hsl(var(--border))",
              fontSize: 12,
            }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Line
            type="monotone"
            dataKey="qrScans"
            name="QR scans"
            stroke="hsl(var(--primary))"
            strokeWidth={2}
            dot={false}
          />
          <Line
            type="monotone"
            dataKey="calls"
            name="Calls"
            stroke="hsl(var(--chart-2, var(--primary)))"
            strokeWidth={2}
            dot={false}
          />
          <Line
            type="monotone"
            dataKey="cumulativeQr"
            name="Cum. QR"
            stroke="hsl(var(--primary))"
            strokeDasharray="4 2"
            strokeWidth={1.5}
            dot={false}
          />
          <Line
            type="monotone"
            dataKey="cumulativeCalls"
            name="Cum. calls"
            stroke="hsl(var(--chart-2, var(--primary)))"
            strokeDasharray="4 2"
            strokeWidth={1.5}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Template comparison ────────────────────────────────────────────────────

function TemplateTable({
  templates,
}: {
  templates: ReturnType<typeof useTemplateCompare>;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Template comparison</CardTitle>
        <CardDescription>Response rate per template, last 90 days.</CardDescription>
      </CardHeader>
      <CardContent>
        {templates.isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : templates.error ? (
          <QueryErrorState
            error={templates.error as Error}
            onRetry={() => templates.refetch()}
            compact
          />
        ) : templates.data && templates.data.length > 0 ? (
          <>
            {/* Desktop table */}
            <div className="hidden md:block overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Template</TableHead>
                    <TableHead className="text-right">Shipments</TableHead>
                    <TableHead className="text-right">Sent</TableHead>
                    <TableHead className="text-right">Responses</TableHead>
                    <TableHead className="text-right">Response rate</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {templates.data.map((row: TemplateCompareRow) => (
                    <TableRow key={row.templateId ?? "none"}>
                      <TableCell>{row.name}</TableCell>
                      <TableCell className="text-right font-mono">{row.shipments}</TableCell>
                      <TableCell className="text-right font-mono">
                        {row.totalSent.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right font-mono text-acr-pos">
                        {row.totalResponses.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right font-mono text-acr-pos">
                        {row.responseRatePct.toFixed(1)}%
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Mobile card list */}
            <ul className="md:hidden space-y-2">
              {templates.data.map((row: TemplateCompareRow) => (
                <li
                  key={row.templateId ?? "none"}
                  className="rounded-md border p-3 flex items-center justify-between"
                >
                  <div>
                    <p className="font-medium text-sm">{row.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {row.shipments} shipments · {row.totalSent.toLocaleString()} sent
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-mono text-acr-pos">
                      {row.responseRatePct.toFixed(1)}%
                    </p>
                    <p className="text-xs text-muted-foreground font-mono">
                      {row.totalResponses.toLocaleString()} resp
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">No template data yet.</p>
        )}
      </CardContent>
    </Card>
  );
}

// ── Cohort by month ────────────────────────────────────────────────────────

function CohortTable({ cohort }: { cohort: ReturnType<typeof useCohortByMonth> }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Monthly cohort</CardTitle>
        <CardDescription>Last 6 months — track if mail performance trends up or down.</CardDescription>
      </CardHeader>
      <CardContent>
        {cohort.isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : cohort.error ? (
          <QueryErrorState
            error={cohort.error as Error}
            onRetry={() => cohort.refetch()}
            compact
          />
        ) : cohort.data && cohort.data.length > 0 ? (
          <>
            <div className="hidden md:block overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Month</TableHead>
                    <TableHead className="text-right">Shipments</TableHead>
                    <TableHead className="text-right">Sent</TableHead>
                    <TableHead className="text-right">Delivered</TableHead>
                    <TableHead className="text-right">QR scans</TableHead>
                    <TableHead className="text-right">Calls</TableHead>
                    <TableHead className="text-right">Spend</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {cohort.data.map((m: CohortRow) => (
                    <TableRow key={m.month}>
                      <TableCell>{m.month}</TableCell>
                      <TableCell className="text-right font-mono">{m.shipments}</TableCell>
                      <TableCell className="text-right font-mono">
                        {m.sent.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {m.delivered.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right font-mono text-acr-pos">
                        {m.qrScans.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right font-mono text-acr-pos">
                        {m.calls.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right font-mono text-acr-warn">
                        {formatUsd(m.spendCents)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <ul className="md:hidden space-y-2">
              {cohort.data.map((m: CohortRow) => (
                <li key={m.month} className="rounded-md border p-3">
                  <div className="flex items-center justify-between mb-1">
                    <p className="font-medium text-sm">{m.month}</p>
                    <p className="text-xs font-mono text-acr-warn">{formatUsd(m.spendCents)}</p>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {m.shipments} shipments · {m.sent.toLocaleString()} sent ·{" "}
                    <span className="text-acr-pos">{m.qrScans.toLocaleString()} QR</span> ·{" "}
                    <span className="text-acr-pos">{m.calls.toLocaleString()} calls</span>
                  </p>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <EmptyState
            icon={Mailbox}
            title="Not enough history yet"
            description="Once you've run a few campaigns, this rolls up monthly so you can spot trend shifts."
            testId="cohort-empty"
          />
        )}
      </CardContent>
    </Card>
  );
}
