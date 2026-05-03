import React from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
  Bot,
  DollarSign,
  Clock,
  Zap,
  RefreshCw,
  ShieldAlert,
  BrainCircuit,
  Activity,
  Layers,
} from "lucide-react";
import { format } from "date-fns";
import { relative } from "@/lib/format";

// ─── Types ────────────────────────────────────────────────────────────────────

interface AiStats {
  totalCallsToday: number;
  totalCostTodayCents: number;
  avgLatencyMs: number;
  cacheHitRate: number; // 0–1
}

interface AiTelemetryEntry {
  id: number;
  organizationId: number;
  organizationName: string;
  agentRole: string;
  model: string;
  complexity: "simple" | "moderate" | "complex";
  toolsCalled: string[];
  inputTokens: number;
  outputTokens: number;
  costCents: number;
  status: "success" | "failed" | "partial";
  latencyMs: number;
  createdAt: string;
}

interface AiTelemetryResponse {
  interactions: AiTelemetryEntry[];
}

interface ModelDistribution {
  model: string;
  complexity: "simple" | "moderate" | "complex";
  count: number;
}

interface EvolutionProposal {
  id: number;
  description: string;
  targetFile: string;
  estimatedImpact: "low" | "medium" | "high" | "critical";
  status: "pending" | "approved" | "rejected" | "applied";
  createdAt: string;
}

interface EvolutionProposalsResponse {
  proposals: EvolutionProposal[];
}

interface ModelCatalogEntry {
  id: number;
  modelId: string;
  provider: string;
  benchmarkSimple: number;
  benchmarkModerate: number;
  benchmarkComplex: number;
  inputCostPerMTokens: number;  // dollars
  outputCostPerMTokens: number; // dollars
  status: "active" | "deprecated" | "experimental";
}

interface ModelCatalogResponse {
  models: ModelCatalogEntry[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatCents(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function complexityColor(c: string) {
  switch (c) {
    case "simple":   return "bg-acr-pos/10 text-acr-pos border-acr-pos/20";
    case "moderate": return "bg-acr-warn/10 text-acr-warn border-acr-warn/20";
    case "complex":  return "bg-acr-neg/10 text-acr-neg border-acr-neg/20";
    default:         return "bg-muted text-muted-foreground border-border";
  }
}

function statusColor(s: string) {
  switch (s) {
    case "success": return "bg-acr-pos/10 text-acr-pos border-acr-pos/20";
    case "failed":  return "bg-acr-neg/10 text-acr-neg border-acr-neg/20";
    case "partial": return "bg-acr-warn/10 text-acr-warn border-acr-warn/20";
    default:        return "bg-muted text-muted-foreground border-border";
  }
}

function impactColor(impact: string) {
  switch (impact) {
    case "critical": return "bg-acr-neg/10 text-acr-neg border-acr-neg/20";
    case "high":     return "bg-acr-warn/10 text-acr-warn border-acr-warn/20";
    case "medium":   return "bg-acr-warn/10 text-acr-warn border-acr-warn/20";
    case "low":      return "bg-acr-pos/10 text-acr-pos border-acr-pos/20";
    default:         return "bg-muted text-muted-foreground border-border";
  }
}

function proposalStatusColor(s: string) {
  switch (s) {
    case "pending":  return "bg-acr-accent/10 text-acr-accent border-acr-accent/20";
    case "approved": return "bg-acr-pos/10 text-acr-pos border-acr-pos/20";
    case "rejected": return "bg-acr-neg/10 text-acr-neg border-acr-neg/20";
    case "applied":  return "bg-acr-brand/10 text-acr-brand border-acr-brand/20";
    default:         return "bg-muted text-muted-foreground border-border";
  }
}

function modelStatusColor(s: string) {
  switch (s) {
    case "active":       return "bg-acr-pos/10 text-acr-pos border-acr-pos/20";
    case "deprecated":   return "bg-acr-neg/10 text-acr-neg border-acr-neg/20";
    case "experimental": return "bg-acr-warn/10 text-acr-warn border-acr-warn/20";
    default:             return "bg-muted text-muted-foreground border-border";
  }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatCard({
  title,
  value,
  sub,
  icon: Icon,
  loading,
}: {
  title: string;
  value: string;
  sub?: string;
  icon: React.ElementType;
  loading?: boolean;
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">{title}</p>
            {loading ? (
              <Skeleton className="h-7 w-24" />
            ) : (
              <p className="text-2xl font-bold text-foreground">{value}</p>
            )}
            {sub && !loading && (
              <p className="text-xs text-muted-foreground">{sub}</p>
            )}
          </div>
          <div className="p-2 rounded-lg bg-muted">
            <Icon className="w-4 h-4 text-muted-foreground" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ModelDistributionSection({
  interactions,
}: {
  interactions: AiTelemetryEntry[];
}) {
  const counts: Record<string, Record<string, number>> = {};
  for (const entry of interactions) {
    if (!counts[entry.model]) counts[entry.model] = {};
    const c = counts[entry.model];
    c[entry.complexity] = (c[entry.complexity] ?? 0) + 1;
  }

  const rows: ModelDistribution[] = [];
  for (const [model, tiers] of Object.entries(counts)) {
    for (const [complexity, count] of Object.entries(tiers)) {
      rows.push({ model, complexity: complexity as any, count });
    }
  }
  rows.sort((a, b) => b.count - a.count);

  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No model usage data in the current telemetry window.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {rows.map((row, i) => (
        <div key={i} className="flex items-center gap-3">
          <span className="text-sm font-mono text-foreground w-48 truncate">
            {row.model}
          </span>
          <Badge
            variant="outline"
            className={`text-xs ${complexityColor(row.complexity)}`}
          >
            {row.complexity}
          </Badge>
          <span className="text-sm text-muted-foreground">
            {row.count.toLocaleString()} call{row.count !== 1 ? "s" : ""}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AiObservatory() {
  const { isFounder, isLoading: authLoading } = useAuth();

  const { data: stats, isLoading: statsLoading } = useQuery<AiStats>({
    queryKey: ["/api/founder/ai/stats"],
    enabled: isFounder,
    refetchInterval: 30000,
  });

  const { data: telemetryData, isLoading: telemetryLoading } =
    useQuery<AiTelemetryResponse>({
      queryKey: ["/api/founder/ai/telemetry?limit=50"],
      enabled: isFounder,
      refetchInterval: 30000,
    });

  const { data: proposalsData, isLoading: proposalsLoading } =
    useQuery<EvolutionProposalsResponse>({
      queryKey: ["/api/admin/evolution-proposals"],
      enabled: isFounder,
    });

  const { data: catalogData, isLoading: catalogLoading } =
    useQuery<ModelCatalogResponse>({
      queryKey: ["/api/admin/model-catalog"],
      enabled: isFounder,
    });

  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Skeleton className="h-12 w-48" />
      </div>
    );
  }

  if (!isFounder) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4">
        <ShieldAlert className="w-12 h-12 text-destructive" />
        <h1 className="text-xl font-semibold text-foreground">Access Denied</h1>
        <p className="text-sm text-muted-foreground">
          This page is restricted to founder administrators.
        </p>
      </div>
    );
  }

  const interactions = telemetryData?.interactions ?? [];
  const proposals = proposalsData?.proposals ?? [];
  const topModels = (catalogData?.models ?? [])
    .sort(
      (a, b) =>
        b.benchmarkSimple + b.benchmarkModerate + b.benchmarkComplex -
        (a.benchmarkSimple + a.benchmarkModerate + a.benchmarkComplex)
    )
    .slice(0, 10);

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {/* Header */}
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <BrainCircuit className="w-6 h-6 text-acr-brand" />
            <h1 className="text-2xl font-bold text-foreground">AI Observatory</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Real-time intelligence across all organizations
          </p>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            title="Total AI Calls Today"
            value={stats ? stats.totalCallsToday.toLocaleString() : "—"}
            icon={Activity}
            loading={statsLoading}
          />
          <StatCard
            title="Total Cost Today"
            value={stats ? formatCents(stats.totalCostTodayCents) : "—"}
            icon={DollarSign}
            loading={statsLoading}
          />
          <StatCard
            title="Avg Latency"
            value={stats ? formatMs(stats.avgLatencyMs) : "—"}
            icon={Clock}
            loading={statsLoading}
          />
          <StatCard
            title="Cache Hit Rate"
            value={
              stats ? `${(stats.cacheHitRate * 100).toFixed(1)}%` : "—"
            }
            icon={Zap}
            loading={statsLoading}
          />
        </div>

        {/* Live Telemetry Feed */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <RefreshCw className="w-4 h-4 text-muted-foreground" />
              Live Telemetry Feed
            </CardTitle>
            <span className="text-xs text-muted-foreground">
              Last 50 interactions · auto-refreshes every 30s
            </span>
          </CardHeader>
          <CardContent className="p-0">
            {telemetryLoading ? (
              <div className="p-6 space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-8 w-full" />
                ))}
              </div>
            ) : interactions.length === 0 ? (
              <div className="p-6 text-sm text-muted-foreground text-center">
                No telemetry data available.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="whitespace-nowrap">Time</TableHead>
                      <TableHead>Org</TableHead>
                      <TableHead>Agent Role</TableHead>
                      <TableHead>Model</TableHead>
                      <TableHead>Complexity</TableHead>
                      <TableHead>Tools Called</TableHead>
                      <TableHead className="text-right">Tokens</TableHead>
                      <TableHead className="text-right">Cost</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {interactions.map((row) => {
                      const totalTokens = row.inputTokens + row.outputTokens;
                      return (
                        <TableRow key={row.id}>
                          <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                            <span title={format(new Date(row.createdAt), "PPpp")}>
                              {relative(row.createdAt)}
                            </span>
                          </TableCell>
                          <TableCell className="text-xs max-w-[120px] truncate">
                            {row.organizationName}
                          </TableCell>
                          <TableCell className="text-xs">{row.agentRole}</TableCell>
                          <TableCell className="text-xs font-mono">
                            {row.model}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className={`text-xs ${complexityColor(row.complexity)}`}
                            >
                              {row.complexity}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {row.toolsCalled.length > 0
                              ? row.toolsCalled.join(", ")
                              : "—"}
                          </TableCell>
                          <TableCell className="text-xs text-right">
                            {totalTokens.toLocaleString()}
                          </TableCell>
                          <TableCell className="text-xs text-right">
                            {formatCents(row.costCents)}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className={`text-xs ${statusColor(row.status)}`}
                            >
                              {row.status}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Model Distribution */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Layers className="w-4 h-4 text-muted-foreground" />
              Model Distribution
            </CardTitle>
          </CardHeader>
          <CardContent>
            {telemetryLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-5 w-full" />
                ))}
              </div>
            ) : (
              <ModelDistributionSection interactions={interactions} />
            )}
          </CardContent>
        </Card>

        {/* Evolution Proposals */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Bot className="w-4 h-4 text-muted-foreground" />
              Evolution Proposals
            </CardTitle>
          </CardHeader>
          <CardContent>
            {proposalsLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-14 w-full" />
                ))}
              </div>
            ) : proposals.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No evolution proposals at this time.
              </p>
            ) : (
              <div className="space-y-3">
                {proposals.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-start gap-3 p-3 rounded-lg border border-border bg-muted/30"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-foreground leading-snug">
                        {p.description}
                      </p>
                      <p className="text-xs text-muted-foreground font-mono mt-1 truncate">
                        {p.targetFile}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1.5 shrink-0">
                      <Badge
                        variant="outline"
                        className={`text-xs ${impactColor(p.estimatedImpact)}`}
                      >
                        {p.estimatedImpact} impact
                      </Badge>
                      <Badge
                        variant="outline"
                        className={`text-xs ${proposalStatusColor(p.status)}`}
                      >
                        {p.status}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {relative(p.createdAt)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Model Catalog */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <BrainCircuit className="w-4 h-4 text-muted-foreground" />
              Model Catalog{" "}
              <span className="text-xs font-normal text-muted-foreground">
                (top 10 by benchmark score)
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {catalogLoading ? (
              <div className="p-6 space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-8 w-full" />
                ))}
              </div>
            ) : topModels.length === 0 ? (
              <div className="p-6 text-sm text-muted-foreground text-center">
                No model catalog data available.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Model ID</TableHead>
                      <TableHead className="text-right">
                        Benchmark Simple
                      </TableHead>
                      <TableHead className="text-right">
                        Benchmark Moderate
                      </TableHead>
                      <TableHead className="text-right">
                        Benchmark Complex
                      </TableHead>
                      <TableHead className="text-right">
                        Input $/M tokens
                      </TableHead>
                      <TableHead className="text-right">
                        Output $/M tokens
                      </TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {topModels.map((m) => (
                      <TableRow key={m.id}>
                        <TableCell className="text-xs font-mono">
                          {m.modelId}
                        </TableCell>
                        <TableCell className="text-xs text-right">
                          {m.benchmarkSimple.toFixed(2)}
                        </TableCell>
                        <TableCell className="text-xs text-right">
                          {m.benchmarkModerate.toFixed(2)}
                        </TableCell>
                        <TableCell className="text-xs text-right">
                          {m.benchmarkComplex.toFixed(2)}
                        </TableCell>
                        <TableCell className="text-xs text-right">
                          ${m.inputCostPerMTokens.toFixed(2)}
                        </TableCell>
                        <TableCell className="text-xs text-right">
                          ${m.outputCostPerMTokens.toFixed(2)}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={`text-xs ${modelStatusColor(m.status)}`}
                          >
                            {m.status}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
