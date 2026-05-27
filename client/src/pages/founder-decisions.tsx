/**
 * FounderDecisionsPage — the audit trail of every decision the
 * autonomous executor makes in your absence. Built for Thomas-the-
 * layperson: five buckets, plain-English labels, expandable rows
 * with AI reasoning, one-click reversal for auto-handled items
 * you'd rather not have happened.
 *
 * The single most important page for "can I trust this system to
 * run without me?" — if this page shows a stream of sensible
 * decisions, the autonomy story works. If it shows confusing or
 * scary decisions, the system isn't ready.
 */

import { useMemo, useState } from "react";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertCircle,
  CheckCircle2,
  Shield,
  ShieldAlert,
  Clock,
  User as UserIcon,
  ChevronRight,
  DollarSign,
  AlertTriangle,
  Undo2,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { dollars, relative } from "@/lib/format";
import { CopyButton } from "@/components/ui/copy-button";

// ───────────── Types ─────────────

interface DecisionRow {
  id: number;
  itemType: string;
  riskLevel: "low" | "medium" | "high" | "critical";
  urgencyScore: number;
  estimatedImpactCents: number | null;
  sophieAnalysis: string;
  sophieConfidenceScore: number | null;
  recommendedAction: string;
  recommendedActionLabel: string;
  status: string;
  resolvedBy: string | null;
  founderOverrideAction: string | null;
  ownerAgentCodename: string | null;
  outcomeScore: number | null;
  actualOutcome: string | null;
  contextBundle: Record<string, unknown> | null;
  createdAt: string;
  resolvedAt: string | null;
}

interface DecisionLogResponse {
  windowDays: number;
  generatedAt: string;
  summary: {
    total: number;
    needsYou: number;
    autoHandled: number;
    guardrailStopped: number;
    youReviewed: number;
    deferred: number;
    autoHandledImpactCents: number;
    avgOutcomeScore: number | null;
  };
  buckets: {
    needsYou: DecisionRow[];
    autoHandled: DecisionRow[];
    guardrailStopped: DecisionRow[];
    youReviewed: DecisionRow[];
    deferred: DecisionRow[];
  };
}

type BucketKey = keyof DecisionLogResponse["buckets"];

// ───────────── Helpers ─────────────

function riskBadgeClass(level: string): string {
  switch (level) {
    case "critical":
      return "bg-acr-neg-soft text-acr-neg dark:bg-acr-neg-soft dark:text-acr-neg";
    case "high":
      return "bg-acr-warn-soft text-acr-warn dark:bg-acr-warn-soft dark:text-acr-warn";
    case "medium":
      return "bg-acr-accent text-acr-accent dark:bg-acr-accent dark:text-acr-accent";
    default:
      return "bg-muted text-muted-foreground";
  }
}

function humanizeItemType(type: string): string {
  return type
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// ───────────── Row component ─────────────

function DecisionRowCard({
  row,
  showReverse,
  onReverse,
  reverseInFlight,
}: {
  row: DecisionRow;
  showReverse: boolean;
  onReverse?: (id: number) => void;
  reverseInFlight: number | null;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div
      className="border rounded-card p-4 hover:bg-muted/30 transition-colors"
      data-testid={`decision-row-${row.id}`}
    >
      <div className="flex items-start justify-between gap-4">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex-1 text-left"
          aria-expanded={expanded}
        >
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="font-medium text-sm">{humanizeItemType(row.itemType)}</span>
            <Badge className={`text-[10px] uppercase ${riskBadgeClass(row.riskLevel)}`} variant="outline">
              {row.riskLevel}
            </Badge>
            {row.ownerAgentCodename && (
              <Badge variant="outline" className="text-[10px]">
                {row.ownerAgentCodename}
              </Badge>
            )}
            {typeof row.outcomeScore === "number" && (
              <Badge
                variant="outline"
                className={`text-[10px] ${
                  row.outcomeScore >= 1
                    ? "bg-acr-pos-soft text-acr-pos"
                    : row.outcomeScore <= -1
                    ? "bg-acr-neg-soft text-acr-neg"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                outcome {row.outcomeScore > 0 ? `+${row.outcomeScore}` : row.outcomeScore}
              </Badge>
            )}
          </div>
          <p className="text-sm text-foreground mb-1">{row.recommendedActionLabel || row.recommendedAction}</p>
          {/* Preserve newlines from the agent's analysis when expanded — they
              encode structure the agent produced deliberately. Truncate
              without whitespace preservation in the collapsed state. */}
          <p className={expanded ? "text-xs text-muted-foreground whitespace-pre-wrap" : "text-xs text-muted-foreground"}>
            {expanded
              ? row.sophieAnalysis
              : `${row.sophieAnalysis.replace(/\s+/g, " ").slice(0, 180)}${row.sophieAnalysis.length > 180 ? "…" : ""}`}
          </p>
        </button>
        <div className="text-right shrink-0">
          <div className="text-xs font-mono text-muted-foreground whitespace-nowrap flex items-center gap-1 justify-end">
            <Clock className="w-3 h-3" />
            {relative(row.createdAt)}
          </div>
          {row.estimatedImpactCents != null && (
            <div className="text-xs font-mono mt-0.5 flex items-center gap-1 justify-end text-muted-foreground">
              <DollarSign className="w-3 h-3" />
              {dollars(row.estimatedImpactCents)}
            </div>
          )}
          {typeof row.sophieConfidenceScore === "number" && (
            <div className="text-[10px] text-muted-foreground mt-0.5">
              {row.sophieConfidenceScore}% conf
            </div>
          )}
        </div>
      </div>

      {expanded && (
        <div className="mt-3 pt-3 border-t space-y-2 text-xs">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <span className="text-muted-foreground">Status: </span>
              <span className="font-medium">{row.status}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Resolved by: </span>
              <span className="font-medium">{row.resolvedBy || "—"}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Urgency: </span>
              <span className="font-medium">{row.urgencyScore}/100</span>
            </div>
            <div>
              <span className="text-muted-foreground">Risk: </span>
              <span className="font-medium">{row.riskLevel}</span>
            </div>
          </div>
          {row.founderOverrideAction && (
            <div>
              <span className="text-muted-foreground">You overrode this with: </span>
              <span className="font-medium">{row.founderOverrideAction}</span>
            </div>
          )}
          {row.actualOutcome && (
            <div>
              <span className="text-muted-foreground">Outcome: </span>
              <span>{row.actualOutcome}</span>
            </div>
          )}
          {row.contextBundle && Object.keys(row.contextBundle).length > 0 && (
            <details className="mt-1">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground flex items-center gap-2">
                Context bundle
                <span onClick={(e) => e.stopPropagation()} className="inline-flex">
                  <CopyButton
                    value={JSON.stringify(row, null, 2)}
                    successMessage="Decision JSON copied"
                    srLabel="Copy decision as JSON"
                    size="sm"
                    className="h-6 w-6"
                  />
                </span>
              </summary>
              <pre className="mt-1 p-2 bg-muted rounded overflow-x-auto text-[10px] leading-relaxed max-h-64">
                {JSON.stringify(row.contextBundle, null, 2)}
              </pre>
            </details>
          )}
          {showReverse && onReverse && row.status !== "rejected" && (
            <div className="flex justify-end pt-1">
              <Button
                size="sm"
                variant="outline"
                className="text-destructive border-destructive/30 hover:bg-destructive/10"
                disabled={reverseInFlight === row.id}
                onClick={() => onReverse(row.id)}
                data-testid={`button-reverse-${row.id}`}
              >
                <Undo2 className="w-3 h-3 mr-1" />
                {reverseInFlight === row.id ? "Recording…" : "I don't like this — don't do it again"}
              </Button>
            </div>
          )}
        </div>
      )}
      {!expanded && (
        <div className="flex justify-end mt-1">
          <span className="text-[10px] text-muted-foreground inline-flex items-center gap-0.5">
            <ChevronRight className="w-3 h-3" /> Click to expand
          </span>
        </div>
      )}
    </div>
  );
}

// ───────────── Page ─────────────

const BUCKET_META: Record<
  BucketKey,
  { label: string; icon: React.ComponentType<{ className?: string }>; tone: string; emptyText: string }
> = {
  needsYou: {
    label: "Needs you",
    icon: AlertCircle,
    tone: "text-acr-warn",
    emptyText: "Nothing's waiting on you. The system handled everything.",
  },
  autoHandled: {
    label: "Auto-handled",
    icon: CheckCircle2,
    tone: "text-acr-pos",
    emptyText: "The system hasn't auto-handled anything in this window.",
  },
  guardrailStopped: {
    label: "Guardrail stopped",
    icon: ShieldAlert,
    tone: "text-acr-neg",
    emptyText: "No hard-guardrail rejections — that's a good thing.",
  },
  youReviewed: {
    label: "You reviewed",
    icon: UserIcon,
    tone: "text-acr-accent",
    emptyText: "You haven't manually reviewed any decisions in this window.",
  },
  deferred: {
    label: "Deferred",
    icon: Clock,
    tone: "text-muted-foreground",
    emptyText: "Nothing snoozed for later.",
  },
};

const BUCKET_ORDER: BucketKey[] = [
  "needsYou",
  "autoHandled",
  "guardrailStopped",
  "youReviewed",
  "deferred",
];

export default function FounderDecisionsPage() {
  useDocumentTitle("Founder decisions");
  const [windowDays, setWindowDays] = useState<number>(30);
  const [activeBucket, setActiveBucket] = useState<BucketKey>("needsYou");
  const [reverseInFlight, setReverseInFlight] = useState<number | null>(null);
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading } = useQuery<DecisionLogResponse>({
    queryKey: ["/api/founder/intelligence/decision-log", windowDays],
    queryFn: async () => {
      const res = await fetch(`/api/founder/intelligence/decision-log?days=${windowDays}&limit=300`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load decision log");
      return res.json();
    },
  });

  const reverseMut = useMutation({
    mutationFn: async (id: number) => {
      setReverseInFlight(id);
      await apiRequest("POST", `/api/founder/intelligence/decision-log/${id}/reverse`, {
        reason: "Founder clicked 'I don't like this — don't do it again' on the decisions page",
      });
    },
    onSuccess: () => {
      toast({
        title: "Recorded",
        description:
          "The system noted you'd rather it didn't do this. It'll adjust its approach next time.",
      });
      qc.invalidateQueries({ queryKey: ["/api/founder/intelligence/decision-log"] });
    },
    onError: (err: Error) => {
      toast({
        title: "Couldn't record reversal",
        description: `${err.message} — try again in a moment.`,
        variant: "destructive",
      });
    },
    onSettled: () => setReverseInFlight(null),
  });

  const activeRows = useMemo(() => {
    if (!data) return [];
    return data.buckets[activeBucket] ?? [];
  }, [data, activeBucket]);

  return (
    <PageShell label="Autonomous decisions">
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Shield className="w-6 h-6 text-primary" />
            Autonomous decisions
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Every decision the system made in your absence, bucketed so you can see what needed
            you, what got handled cleanly, and what a safety rule stopped from happening.
          </p>
        </div>
        <select
          value={windowDays}
          onChange={(e) => setWindowDays(parseInt(e.target.value, 10))}
          className="h-9 px-3 rounded-md border bg-background text-sm"
          data-testid="select-window"
        >
          <option value={7}>Last 7 days</option>
          <option value={14}>Last 14 days</option>
          <option value={30}>Last 30 days</option>
          <option value={60}>Last 60 days</option>
          <option value={90}>Last 90 days</option>
        </select>
      </div>

      {/* Summary strip */}
      {isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      ) : data ? (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {BUCKET_ORDER.map((key) => {
            const meta = BUCKET_META[key];
            const count = data.summary[key] ?? 0;
            const Icon = meta.icon;
            return (
              <button
                key={key}
                onClick={() => setActiveBucket(key)}
                className={`text-left rounded-card border p-3 transition-all ${
                  activeBucket === key
                    ? "ring-2 ring-primary shadow-sm bg-card"
                    : "hover:border-primary/40 bg-card"
                }`}
                data-testid={`bucket-tab-${key}`}
              >
                <div className={`flex items-center gap-1.5 text-xs ${meta.tone}`}>
                  <Icon className="w-3.5 h-3.5" />
                  <span className="font-medium">{meta.label}</span>
                </div>
                <div className="text-2xl font-bold mt-1">{count}</div>
              </button>
            );
          })}
        </div>
      ) : null}

      {/* Spend exposure + outcome health */}
      {data && (
        <Card>
          <CardContent className="p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-3 text-sm">
            <div className="flex items-center gap-2 text-muted-foreground">
              <DollarSign className="w-4 h-4" />
              <span>
                Auto-handled dollar exposure:{" "}
                <span className="font-semibold text-foreground">
                  {dollars(data.summary.autoHandledImpactCents)}
                </span>
              </span>
            </div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <AlertTriangle className="w-4 h-4" />
              <span>
                Average outcome score (of those graded):{" "}
                <span className="font-semibold text-foreground">
                  {data.summary.avgOutcomeScore != null
                    ? data.summary.avgOutcomeScore.toFixed(1)
                    : "not yet graded"}
                </span>
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Active bucket list */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            {(() => {
              const meta = BUCKET_META[activeBucket];
              const Icon = meta.icon;
              return (
                <>
                  <Icon className={`w-4 h-4 ${meta.tone}`} />
                  {meta.label} ({activeRows.length})
                </>
              );
            })()}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {isLoading ? (
            Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)
          ) : activeRows.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              {BUCKET_META[activeBucket].emptyText}
            </p>
          ) : (
            activeRows.map((row) => (
              <DecisionRowCard
                key={row.id}
                row={row}
                showReverse={activeBucket === "autoHandled"}
                onReverse={(id) => reverseMut.mutate(id)}
                reverseInFlight={reverseInFlight}
              />
            ))
          )}
        </CardContent>
      </Card>
    </div>
    </PageShell>
  );
}
