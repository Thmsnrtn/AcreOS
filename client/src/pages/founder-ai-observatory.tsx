import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
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
  CheckCircle2,
  ArrowUpCircle,
  XCircle,
  ThumbsUp,
  ThumbsDown,
  ChevronDown,
  ChevronRight,
  Gauge,
  FileText,
  Users,
  Settings,
  TrendingUp,
  BarChart3,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { staggerContainer, staggerItem, collapsibleContent } from "@/lib/animations";
import { format, formatDistanceToNow } from "date-fns";

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
    case "simple":   return "bg-green-500/10 text-green-600 border-green-500/20";
    case "moderate": return "bg-yellow-500/10 text-yellow-600 border-yellow-500/20";
    case "complex":  return "bg-red-500/10 text-red-600 border-red-500/20";
    default:         return "bg-muted text-muted-foreground border-border";
  }
}

function statusColor(s: string) {
  switch (s) {
    case "success": return "bg-green-500/10 text-green-700 border-green-500/20";
    case "failed":  return "bg-red-500/10 text-red-700 border-red-500/20";
    case "partial": return "bg-yellow-500/10 text-yellow-700 border-yellow-500/20";
    default:        return "bg-muted text-muted-foreground border-border";
  }
}

function impactColor(impact: string) {
  switch (impact) {
    case "critical": return "bg-red-500/10 text-red-700 border-red-500/20";
    case "high":     return "bg-orange-500/10 text-orange-700 border-orange-500/20";
    case "medium":   return "bg-yellow-500/10 text-yellow-700 border-yellow-500/20";
    case "low":      return "bg-green-500/10 text-green-700 border-green-500/20";
    default:         return "bg-muted text-muted-foreground border-border";
  }
}

function proposalStatusColor(s: string) {
  switch (s) {
    case "pending":  return "bg-blue-500/10 text-blue-700 border-blue-500/20";
    case "approved": return "bg-green-500/10 text-green-700 border-green-500/20";
    case "rejected": return "bg-red-500/10 text-red-700 border-red-500/20";
    case "applied":  return "bg-purple-500/10 text-purple-700 border-purple-500/20";
    default:         return "bg-muted text-muted-foreground border-border";
  }
}

function modelStatusColor(s: string) {
  switch (s) {
    case "active":       return "bg-green-500/10 text-green-700 border-green-500/20";
    case "deprecated":   return "bg-red-500/10 text-red-700 border-red-500/20";
    case "experimental": return "bg-yellow-500/10 text-yellow-700 border-yellow-500/20";
    default:             return "bg-muted text-muted-foreground border-border";
  }
}

// ─── Decision Feed Types & Mock Data ─────────────────────────────────────────

type DecisionOutcome = "auto-executed" | "escalated" | "denied";
type DecisionCategory = "pricing" | "lease" | "maintenance" | "compliance" | "tenant";

interface AutonomousDecision {
  id: string;
  timestamp: string;
  actionType: DecisionCategory;
  summary: string;
  confidence: number; // 0–100
  outcome: DecisionOutcome;
  reasoning: string;
  dataConsidered: string[];
  feedback?: "good" | "different" | null;
}

const MOCK_DECISIONS: AutonomousDecision[] = [
  {
    id: "d1",
    timestamp: new Date(Date.now() - 12 * 60000).toISOString(),
    actionType: "pricing",
    summary: "Adjusted Unit 4B rent to $2,450/mo based on comp analysis",
    confidence: 92,
    outcome: "auto-executed",
    reasoning:
      "Market comps within 0.5mi show median $2,475 for similar 2BR units. Current vacancy rate is 4.1% (below 5% threshold). Seasonal demand index is +8% vs baseline. Recommended a modest increase from $2,380 to $2,450 to capture value without exceeding the 3% month-over-month guardrail.",
    dataConsidered: [
      "12 comparable units within 0.5mi radius",
      "Current portfolio vacancy rate: 4.1%",
      "Seasonal demand index: +8%",
      "Tenant payment history: 36 months on-time",
    ],
  },
  {
    id: "d2",
    timestamp: new Date(Date.now() - 47 * 60000).toISOString(),
    actionType: "maintenance",
    summary: "Dispatched emergency plumber to 210 Oak St, Unit 7A",
    confidence: 88,
    outcome: "auto-executed",
    reasoning:
      "Tenant reported active water leak via portal with photo evidence. NLP classified as severity:critical. Nearest preferred vendor (ProFlow Plumbing) has availability within 2hr window. Estimated cost $350-$600 falls within auto-approve threshold for emergency maintenance.",
    dataConsidered: [
      "Tenant report with photo evidence",
      "NLP severity classification: critical",
      "Vendor availability: ProFlow Plumbing, 2hr ETA",
      "Estimated cost: $350-$600 (within $750 auto-approve limit)",
    ],
  },
  {
    id: "d3",
    timestamp: new Date(Date.now() - 2.3 * 3600000).toISOString(),
    actionType: "lease",
    summary: "Flagged lease renewal for 510 Elm, Unit 3C for review",
    confidence: 61,
    outcome: "escalated",
    reasoning:
      "Tenant has 2 late payments in the last 6 months but strong overall history (4 years). Market suggests 4.2% increase is viable, but risk model flags potential churn. Confidence below 70% threshold for auto-renewal terms, escalating to property manager.",
    dataConsidered: [
      "Tenant tenure: 4 years",
      "Late payments: 2 in last 6 months",
      "Market rent increase potential: 4.2%",
      "Churn risk model output: 31% probability",
    ],
  },
  {
    id: "d4",
    timestamp: new Date(Date.now() - 5.1 * 3600000).toISOString(),
    actionType: "compliance",
    summary: "Blocked bulk email blast: missing Fair Housing disclaimer",
    confidence: 97,
    outcome: "denied",
    reasoning:
      "Outbound marketing email to 340 prospects was missing required Fair Housing Act disclaimer. Regulatory compliance check flagged violation before send. Email queued for edit. This is a hard compliance rule with zero tolerance.",
    dataConsidered: [
      "Email content analysis: no Fair Housing disclaimer detected",
      "Regulatory rule: Fair Housing Act compliance (mandatory)",
      "Recipient count: 340 prospects",
    ],
  },
  {
    id: "d5",
    timestamp: new Date(Date.now() - 8 * 3600000).toISOString(),
    actionType: "tenant",
    summary: "Auto-approved application for J. Martinez (credit 745, income 3.2x)",
    confidence: 94,
    outcome: "auto-executed",
    reasoning:
      "Applicant meets all auto-approve criteria: credit score 745 (threshold: 680), income-to-rent ratio 3.2x (threshold: 2.5x), clean background check, positive landlord references (2/2). No manual review flags triggered.",
    dataConsidered: [
      "Credit score: 745 (threshold: 680)",
      "Income-to-rent ratio: 3.2x (threshold: 2.5x)",
      "Background check: clear",
      "Landlord references: 2/2 positive",
    ],
  },
];

const CATEGORY_ICONS: Record<DecisionCategory, React.ElementType> = {
  pricing: DollarSign,
  lease: FileText,
  maintenance: Settings,
  compliance: ShieldAlert,
  tenant: Users,
};

const OUTCOME_DISPLAY: Record<DecisionOutcome, { icon: React.ReactNode; label: string; className: string }> = {
  "auto-executed": {
    icon: <CheckCircle2 className="w-3.5 h-3.5" />,
    label: "Auto-executed",
    className: "bg-green-500/10 text-green-700 border-green-500/20",
  },
  escalated: {
    icon: <ArrowUpCircle className="w-3.5 h-3.5" />,
    label: "Escalated",
    className: "bg-yellow-500/10 text-yellow-700 border-yellow-500/20",
  },
  denied: {
    icon: <XCircle className="w-3.5 h-3.5" />,
    label: "Denied",
    className: "bg-red-500/10 text-red-700 border-red-500/20",
  },
};

function confidenceColor(confidence: number): string {
  if (confidence >= 85) return "bg-green-500";
  if (confidence >= 70) return "bg-yellow-500";
  return "bg-orange-500";
}

function categoryColor(cat: DecisionCategory): string {
  switch (cat) {
    case "pricing":     return "bg-blue-500/10 text-blue-700 border-blue-500/20";
    case "lease":       return "bg-purple-500/10 text-purple-700 border-purple-500/20";
    case "maintenance": return "bg-orange-500/10 text-orange-700 border-orange-500/20";
    case "compliance":  return "bg-red-500/10 text-red-700 border-red-500/20";
    case "tenant":      return "bg-teal-500/10 text-teal-700 border-teal-500/20";
    default:            return "bg-muted text-muted-foreground border-border";
  }
}

// ─── Decision Feed Components ────────────────────────────────────────────────

function DecisionCard({
  decision,
  onFeedback,
}: {
  decision: AutonomousDecision;
  onFeedback: (id: string, feedback: "good" | "different") => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const CategoryIcon = CATEGORY_ICONS[decision.actionType];
  const outcome = OUTCOME_DISPLAY[decision.outcome];

  return (
    <motion.div variants={staggerItem}>
      <div className="p-4 rounded-lg border border-border bg-muted/30 space-y-3">
        {/* Top row: timestamp + category + summary + outcome */}
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-muted shrink-0 mt-0.5">
            <CategoryIcon className="w-4 h-4 text-muted-foreground" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-muted-foreground">
                {formatDistanceToNow(new Date(decision.timestamp), { addSuffix: true })}
              </span>
              <Badge variant="outline" className={`text-xs ${categoryColor(decision.actionType)}`}>
                {decision.actionType}
              </Badge>
              <Badge variant="outline" className={`text-xs inline-flex items-center gap-1 ${outcome.className}`}>
                {outcome.icon}
                {outcome.label}
              </Badge>
            </div>
            <p className="text-sm text-foreground mt-1 leading-snug">{decision.summary}</p>

            {/* Confidence meter */}
            <div className="flex items-center gap-2 mt-2">
              <span className="text-xs text-muted-foreground w-20 shrink-0">
                Confidence
              </span>
              <div className="flex-1 max-w-[200px]">
                <Progress
                  value={decision.confidence}
                  className={`h-1.5 [&>div]:${confidenceColor(decision.confidence)}`}
                />
              </div>
              <span className="text-xs font-medium text-foreground w-8 text-right">
                {decision.confidence}%
              </span>
            </div>
          </div>
        </div>

        {/* Action row: expand + feedback */}
        <div className="flex items-center justify-between pl-11">
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {expanded ? (
              <ChevronDown className="w-3.5 h-3.5" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5" />
            )}
            {expanded ? "Hide details" : "Show reasoning"}
          </button>
          <div className="flex items-center gap-1.5">
            <Button
              variant={decision.feedback === "good" ? "default" : "outline"}
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={() => onFeedback(decision.id, "good")}
            >
              <ThumbsUp className="w-3 h-3" />
              Good call
            </Button>
            <Button
              variant={decision.feedback === "different" ? "destructive" : "outline"}
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={() => onFeedback(decision.id, "different")}
            >
              <ThumbsDown className="w-3 h-3" />
              I'd have decided differently
            </Button>
          </div>
        </div>

        {/* Expandable detail */}
        <AnimatePresence>
          {expanded && (
            <motion.div
              variants={collapsibleContent}
              initial="hidden"
              animate="visible"
              exit="hidden"
              className="overflow-hidden"
            >
              <div className="pl-11 pt-2 space-y-3 border-t border-border mt-1 pt-3">
                <div>
                  <p className="text-xs font-medium text-foreground mb-1">AI Reasoning</p>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {decision.reasoning}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium text-foreground mb-1">Data Considered</p>
                  <ul className="space-y-1">
                    {decision.dataConsidered.map((item, i) => (
                      <li key={i} className="text-xs text-muted-foreground flex items-start gap-1.5">
                        <span className="text-muted-foreground/50 mt-0.5">-</span>
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

function CalibrationPanel({ decisions }: { decisions: AutonomousDecision[] }) {
  // Decisions by category
  const categoryCounts: Record<string, number> = {};
  for (const d of decisions) {
    categoryCounts[d.actionType] = (categoryCounts[d.actionType] ?? 0) + 1;
  }

  // Override trend (escalated + denied = overrides for calibration context)
  const totalDecisions = decisions.length;
  const autoExecuted = decisions.filter((d) => d.outcome === "auto-executed").length;
  const escalated = decisions.filter((d) => d.outcome === "escalated").length;
  const denied = decisions.filter((d) => d.outcome === "denied").length;
  const feedbackDifferent = decisions.filter((d) => d.feedback === "different").length;

  // Confidence calibration: avg confidence by outcome
  const avgConfByOutcome: Record<string, number> = {};
  const outcomeGroups: Record<string, number[]> = {};
  for (const d of decisions) {
    if (!outcomeGroups[d.outcome]) outcomeGroups[d.outcome] = [];
    outcomeGroups[d.outcome].push(d.confidence);
  }
  for (const [outcome, confs] of Object.entries(outcomeGroups)) {
    avgConfByOutcome[outcome] = Math.round(
      confs.reduce((a, b) => a + b, 0) / confs.length
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <Gauge className="w-4 h-4 text-muted-foreground" />
          Calibration
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Confidence Calibration */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-foreground">Confidence Calibration</p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Well-calibrated AI should show higher confidence on auto-executed decisions
            and lower confidence on escalated ones. A large gap indicates the model
            knows its limits.
          </p>
          <div className="space-y-2 mt-2">
            {(["auto-executed", "escalated", "denied"] as DecisionOutcome[]).map((outcome) => {
              const avg = avgConfByOutcome[outcome];
              if (avg === undefined) return null;
              const display = OUTCOME_DISPLAY[outcome];
              return (
                <div key={outcome} className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground w-24 shrink-0 flex items-center gap-1">
                    {display.icon} {display.label}
                  </span>
                  <div className="flex-1">
                    <Progress value={avg} className="h-2" />
                  </div>
                  <span className="text-xs font-medium text-foreground w-8 text-right">{avg}%</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Decisions by Category */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-foreground flex items-center gap-1.5">
            <BarChart3 className="w-3.5 h-3.5" />
            Decisions by Category
          </p>
          <div className="space-y-1.5">
            {Object.entries(categoryCounts)
              .sort(([, a], [, b]) => b - a)
              .map(([cat, count]) => {
                const Icon = CATEGORY_ICONS[cat as DecisionCategory];
                return (
                  <div key={cat} className="flex items-center gap-2">
                    <Icon className="w-3.5 h-3.5 text-muted-foreground" />
                    <span className="text-xs text-foreground capitalize flex-1">{cat}</span>
                    <span className="text-xs font-medium text-foreground">{count}</span>
                  </div>
                );
              })}
          </div>
        </div>

        {/* Override Trend */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-foreground flex items-center gap-1.5">
            <TrendingUp className="w-3.5 h-3.5" />
            Override Trend
          </p>
          <div className="grid grid-cols-2 gap-2">
            <div className="p-2 rounded-md border border-border bg-muted/30 text-center">
              <p className="text-lg font-bold text-foreground">{autoExecuted}</p>
              <p className="text-xs text-muted-foreground">Auto-executed</p>
            </div>
            <div className="p-2 rounded-md border border-border bg-muted/30 text-center">
              <p className="text-lg font-bold text-foreground">{escalated}</p>
              <p className="text-xs text-muted-foreground">Escalated</p>
            </div>
            <div className="p-2 rounded-md border border-border bg-muted/30 text-center">
              <p className="text-lg font-bold text-foreground">{denied}</p>
              <p className="text-xs text-muted-foreground">Denied</p>
            </div>
            <div className="p-2 rounded-md border border-border bg-muted/30 text-center">
              <p className="text-lg font-bold text-foreground">{feedbackDifferent}</p>
              <p className="text-xs text-muted-foreground">Disagreed</p>
            </div>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {totalDecisions > 0
              ? `${Math.round(((escalated + denied) / totalDecisions) * 100)}% of recent decisions required human intervention or were blocked.`
              : "No decision data available."}
          </p>
        </div>
      </CardContent>
    </Card>
  );
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

  const [decisions, setDecisions] = useState<AutonomousDecision[]>(MOCK_DECISIONS);

  const handleFeedback = (id: string, feedback: "good" | "different") => {
    setDecisions((prev) =>
      prev.map((d) =>
        d.id === id
          ? { ...d, feedback: d.feedback === feedback ? null : feedback }
          : d
      )
    );
  };

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
            <BrainCircuit className="w-6 h-6 text-violet-500" />
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

        {/* Decision Feed + Calibration Panel */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Decision Feed (2/3 width) */}
          <div className="lg:col-span-2">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-3">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <BrainCircuit className="w-4 h-4 text-violet-500" />
                  Decision Feed
                </CardTitle>
                <span className="text-xs text-muted-foreground">
                  {decisions.length} recent decisions
                </span>
              </CardHeader>
              <CardContent>
                <motion.div
                  variants={staggerContainer}
                  initial="hidden"
                  animate="visible"
                  className="space-y-3"
                >
                  {decisions.map((decision) => (
                    <DecisionCard
                      key={decision.id}
                      decision={decision}
                      onFeedback={handleFeedback}
                    />
                  ))}
                </motion.div>
              </CardContent>
            </Card>
          </div>

          {/* Calibration Side Panel (1/3 width) */}
          <div className="lg:col-span-1">
            <CalibrationPanel decisions={decisions} />
          </div>
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
                              {formatDistanceToNow(new Date(row.createdAt), {
                                addSuffix: true,
                              })}
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
                        {formatDistanceToNow(new Date(p.createdAt), {
                          addSuffix: true,
                        })}
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
