/**
 * Founder agent-queue — Rosy River C4.
 *
 * Single founder-only page that surfaces the autonomy pipeline:
 *
 *   - Code-change proposals from agentTasks (filtered to Rosy-River agents).
 *     Approve / reject / defer inline; approval clears requiresReview +
 *     simulationMode so the evolution gauntlet picks the task up on its
 *     next 6h tick.
 *   - Agent events from decisionsInboxItems (itemType='agent_event' —
 *     budget warnings, planner output, circuit-breaker trips, etc.).
 *     Mark resolved / dismissed inline.
 *   - Weekly LLM budget from agent_llm_traces (single source of truth).
 *
 * All three feeds are existing tables — this page is just a view layer
 * over the harmonized autonomy architecture documented at
 *   /Users/user/.claude/plans/ok-i-wanna-try-rosy-river.md
 */

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useOptimisticUpdate } from "@/lib/optimistic-mutation";
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
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useDocumentTitle } from "@/hooks/use-document-title";
import {
  Bot,
  CircleCheck,
  CircleSlash,
  Clock,
  AlertCircle,
  DollarSign,
  Zap,
} from "lucide-react";

// ─── Types ──────────────────────────────────────────────────────────────────

type AgentTaskStatus =
  | "pending"
  | "queued"
  | "processing"
  | "completed"
  | "failed"
  | "cancelled";

interface ProposalRow {
  id: number;
  agentType: string;
  status: AgentTaskStatus;
  priority: number | null;
  requiresReview: boolean | null;
  input: {
    rosyRiver?: boolean;
    pillar?: string;
    source?: string | null;
    simulationMode?: boolean;
    rawSignal?: Record<string, unknown> | null;
  } | null;
  output: {
    title?: string;
    rationale?: string;
    targetFiles?: string[];
    riskTier?: "low" | "medium" | "high";
    preMortem?: string | null;
    rollbackPath?: string | null;
    autoMergeEligible?: boolean;
    autoMergeReason?: string;
    estimatedCostUsd?: number | null;
  } | null;
  reviewedBy: number | null;
  reviewedAt: string | null;
  reviewNotes: string | null;
  createdAt: string;
  inboxItemId: number | null;
  inboxStatus: string | null;
  founderModification: string | null;
}

interface ProposalsResponse {
  proposals: ProposalRow[];
  total: number;
  page: number;
  limit: number;
}

interface NotificationRow {
  id: number;
  itemType: string;
  riskLevel: string;
  urgencyScore: number;
  sophieAnalysis: string;
  recommendedAction: string;
  recommendedActionLabel: string;
  actionPayload: Record<string, unknown> | null;
  contextBundle: Record<string, unknown> | null;
  ownerAgentCodename: string | null;
  status: string;
  resolvedAt: string | null;
  createdAt: string;
}

interface NotificationsResponse {
  notifications: NotificationRow[];
  total: number;
  unread: number;
  page: number;
  limit: number;
}

interface BudgetResponse {
  totalUsd: number;
  byAgent: Record<string, number>;
  crossedAlert: boolean;
  crossedCeiling: boolean;
  ceilingUsd: number;
  alertUsd: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const RISK_TONE: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  low: "secondary",
  medium: "default",
  high: "destructive",
  critical: "destructive",
};

function formatDate(s: string): string {
  return new Date(s).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function pillarLabel(p: string | undefined): string {
  if (p === "A_uiux") return "UI/UX";
  if (p === "B_data") return "Data";
  if (p === "C_agentic") return "Agentic";
  if (p === "shared") return "Shared";
  return p ?? "—";
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function FounderAgentQueuePage() {
  useDocumentTitle("Agent queue");
  const { toast } = useToast();
  const qc = useQueryClient();

  const [proposalStatus, setProposalStatus] = useState<string>("pending");
  const [proposalAgent, setProposalAgent] = useState<string>("all");

  const proposalsKey = useMemo(() => {
    const params = new URLSearchParams();
    if (proposalStatus !== "all") params.set("status", proposalStatus);
    if (proposalAgent !== "all") params.set("agent", proposalAgent);
    const qs = params.toString();
    return [`/api/founder/proposed-changes${qs ? `?${qs}` : ""}`];
  }, [proposalStatus, proposalAgent]);

  const { data: proposalsData, isLoading: proposalsLoading, error: proposalsError } =
    useQuery<ProposalsResponse>({ queryKey: proposalsKey });

  const { data: notifData, isLoading: notifLoading } = useQuery<NotificationsResponse>({
    queryKey: ["/api/founder/agent-notifications?status=pending"],
  });

  const { data: budgetData } = useQuery<BudgetResponse>({
    queryKey: ["/api/founder/agent-budget"],
  });

  const decisionMutation = useMutation({
    mutationFn: async ({
      id,
      decision,
      notes,
    }: {
      id: number;
      decision: "approve" | "reject" | "defer";
      notes?: string;
    }) => {
      const res = await apiRequest("PATCH", `/api/founder/proposed-changes/${id}`, {
        decision,
        notes,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || "Update failed");
      }
      return res.json();
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["/api/founder/proposed-changes"] });
      qc.invalidateQueries({ queryKey: ["/api/founder/agent-notifications"] });
      qc.invalidateQueries({ queryKey: ["/api/founder/agent-budget"] });
      toast({
        title:
          vars.decision === "approve"
            ? "Approved — queued for gauntlet"
            : vars.decision === "reject"
              ? "Rejected"
              : "Deferred",
      });
    },
    onError: (err: Error) => {
      toast({
        title: "Couldn't update proposal",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const notifMutation = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => {
      const res = await apiRequest("PATCH", `/api/founder/agent-notifications/${id}`, {
        status,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || "Update failed");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/founder/agent-notifications"] });
    },
    onError: (err: Error) => {
      toast({
        title: "Couldn't update notification",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const proposals = proposalsData?.proposals ?? [];
  const notifications = notifData?.notifications ?? [];

  // ── Render ──
  return (
    <PageShell>
      <div className="max-w-5xl mx-auto py-6 space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold flex items-center gap-2">
              <Bot className="h-6 w-6" aria-hidden="true" />
              Agent queue
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Code-change proposals from your autonomous agents, plus the
              event feed and weekly budget. Approve sends a proposal into the
              evolution gauntlet on its next 6h tick.
            </p>
          </div>
          {budgetData && <BudgetBanner data={budgetData} />}
        </div>

        <Tabs defaultValue="proposals" className="space-y-4">
          <TabsList>
            <TabsTrigger value="proposals" data-testid="tab-proposals">
              Proposals
              {proposalsData?.total ? (
                <Badge variant="secondary" className="ml-2 tabular-nums">
                  {proposalsData.total}
                </Badge>
              ) : null}
            </TabsTrigger>
            <TabsTrigger value="notifications" data-testid="tab-notifications">
              Notifications
              {notifData?.unread ? (
                <Badge variant="default" className="ml-2 tabular-nums">
                  {notifData.unread}
                </Badge>
              ) : null}
            </TabsTrigger>
          </TabsList>

          {/* Proposals tab */}
          <TabsContent value="proposals" className="space-y-4">
            <div className="flex flex-wrap gap-3">
              <div className="space-y-1">
                <label className="text-xs uppercase tracking-wide text-muted-foreground">
                  Status
                </label>
                <Select value={proposalStatus} onValueChange={setProposalStatus}>
                  <SelectTrigger className="w-40" data-testid="filter-proposal-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="processing">Processing</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="failed">Failed</SelectItem>
                    <SelectItem value="cancelled">Rejected</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-xs uppercase tracking-wide text-muted-foreground">
                  Agent
                </label>
                <Select value={proposalAgent} onValueChange={setProposalAgent}>
                  <SelectTrigger className="w-48" data-testid="filter-proposal-agent">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="codebase_monitor">Codebase monitor</SelectItem>
                    <SelectItem value="multi_week_planner">Multi-week planner</SelectItem>
                    <SelectItem value="telemetry_drift">Telemetry drift</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {proposalsLoading && (
              <div className="space-y-3" aria-busy="true">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-32 w-full" />
                ))}
              </div>
            )}

            {proposalsError && (
              <Card>
                <CardContent className="pt-6 flex items-center gap-2 text-destructive">
                  <AlertCircle className="h-5 w-5" aria-hidden="true" />
                  Couldn't load proposals — try refreshing.
                </CardContent>
              </Card>
            )}

            {!proposalsLoading && !proposalsError && proposals.length === 0 && (
              <Card>
                <CardContent className="pt-8 pb-8 text-center text-muted-foreground space-y-2">
                  <Bot className="h-10 w-10 mx-auto opacity-40" aria-hidden="true" />
                  <div className="text-sm">
                    No proposals match these filters.
                  </div>
                  <div className="text-xs">
                    The codebase monitor runs daily at 4:15am UTC. First
                    proposal will land after the next tick.
                  </div>
                </CardContent>
              </Card>
            )}

            <div className="space-y-3">
              {proposals.map((p) => (
                <ProposalCard
                  key={p.id}
                  proposal={p}
                  onDecide={(decision) =>
                    decisionMutation.mutate({ id: p.id, decision })
                  }
                  isPending={decisionMutation.isPending}
                />
              ))}
            </div>
          </TabsContent>

          {/* Notifications tab */}
          <TabsContent value="notifications" className="space-y-4">
            {notifLoading && (
              <div className="space-y-3" aria-busy="true">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-20 w-full" />
                ))}
              </div>
            )}

            {!notifLoading && notifications.length === 0 && (
              <Card>
                <CardContent className="pt-8 pb-8 text-center text-muted-foreground space-y-2">
                  <Zap className="h-10 w-10 mx-auto opacity-40" aria-hidden="true" />
                  <div className="text-sm">No agent notifications.</div>
                </CardContent>
              </Card>
            )}

            <div className="space-y-3">
              {notifications.map((n) => (
                <Card key={n.id} data-testid={`notif-row-${n.id}`}>
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="space-y-1">
                        <CardTitle className="text-base flex items-center gap-2 flex-wrap">
                          <Badge variant={RISK_TONE[n.riskLevel] ?? "outline"}>
                            {n.riskLevel}
                          </Badge>
                          {n.ownerAgentCodename && (
                            <Badge variant="outline" className="font-mono text-xs">
                              {n.ownerAgentCodename}
                            </Badge>
                          )}
                          <span className="text-sm font-normal text-muted-foreground">
                            {formatDate(n.createdAt)}
                          </span>
                        </CardTitle>
                        <CardDescription className="text-sm">
                          {n.sophieAnalysis}
                        </CardDescription>
                      </div>
                      <div className="flex gap-2 shrink-0">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            notifMutation.mutate({ id: n.id, status: "auto_resolved" })
                          }
                          disabled={notifMutation.isPending}
                          data-testid={`button-mark-read-${n.id}`}
                        >
                          Mark read
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                </Card>
              ))}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </PageShell>
  );
}

// ─── Subcomponents ──────────────────────────────────────────────────────────

function BudgetBanner({ data }: { data: BudgetResponse }) {
  const pct = Math.min(100, (data.totalUsd / data.ceilingUsd) * 100);
  const tone = data.crossedCeiling
    ? "destructive"
    : data.crossedAlert
      ? "default"
      : "secondary";
  return (
    <div className="min-w-[220px] space-y-1">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <DollarSign className="h-3 w-3" aria-hidden="true" />
        Weekly LLM spend
      </div>
      <div className="flex items-baseline gap-2">
        <div className="text-2xl font-semibold tabular-nums">
          ${data.totalUsd.toFixed(2)}
        </div>
        <div className="text-xs text-muted-foreground">
          / ${data.ceilingUsd}
        </div>
        <Badge variant={tone} className="ml-auto text-micro">
          {data.crossedCeiling ? "ceiling" : data.crossedAlert ? "alert" : "ok"}
        </Badge>
      </div>
      <Progress value={pct} className="h-1.5" />
    </div>
  );
}

function ProposalCard({
  proposal,
  onDecide,
  isPending,
}: {
  proposal: ProposalRow;
  onDecide: (decision: "approve" | "reject" | "defer") => void;
  isPending: boolean;
}) {
  const output = proposal.output ?? {};
  const input = proposal.input ?? {};
  const isSim = !!input.simulationMode;
  const risk = output.riskTier ?? "medium";
  const isOpen = proposal.status === "pending" && proposal.requiresReview !== false;

  return (
    <Card
      className={isOpen ? "border-primary/30" : ""}
      data-testid={`proposal-row-${proposal.id}`}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="space-y-1 flex-1 min-w-0">
            <CardTitle className="text-base flex items-center gap-2 flex-wrap">
              <Badge variant={RISK_TONE[risk] ?? "outline"}>{risk} risk</Badge>
              <Badge variant="outline" className="font-mono text-xs">
                {proposal.agentType}
              </Badge>
              <Badge variant="secondary" className="text-xs">
                {pillarLabel(input.pillar)}
              </Badge>
              {isSim && (
                <Badge variant="outline" className="text-xs">
                  simulation
                </Badge>
              )}
              {output.autoMergeEligible && (
                <Badge variant="outline" className="text-xs text-acr-pos">
                  auto-merge eligible
                </Badge>
              )}
              <span className="text-sm font-normal text-muted-foreground">
                {formatDate(proposal.createdAt)}
              </span>
            </CardTitle>
            <CardDescription className="text-sm font-medium text-foreground">
              {output.title ?? "(untitled)"}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        {output.rationale && (
          <p className="text-sm text-muted-foreground whitespace-pre-wrap">
            {output.rationale}
          </p>
        )}

        {output.targetFiles && output.targetFiles.length > 0 && (
          <div className="space-y-1">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              Target files
            </div>
            <div className="flex flex-wrap gap-1">
              {output.targetFiles.map((f) => (
                <code
                  key={f}
                  className="px-1.5 py-0.5 rounded bg-muted text-xs font-mono"
                >
                  {f}
                </code>
              ))}
            </div>
          </div>
        )}

        {(output.preMortem || output.rollbackPath) && (
          <div className="grid sm:grid-cols-2 gap-3 text-xs">
            {output.preMortem && (
              <div className="space-y-1">
                <div className="uppercase tracking-wide text-muted-foreground flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" aria-hidden="true" /> Pre-mortem
                </div>
                <div className="text-foreground/80">{output.preMortem}</div>
              </div>
            )}
            {output.rollbackPath && (
              <div className="space-y-1">
                <div className="uppercase tracking-wide text-muted-foreground flex items-center gap-1">
                  <CircleSlash className="h-3 w-3" aria-hidden="true" /> Rollback
                </div>
                <div className="text-foreground/80 font-mono">
                  {output.rollbackPath}
                </div>
              </div>
            )}
          </div>
        )}

        {!output.autoMergeEligible && output.autoMergeReason && (
          <div className="text-xs text-muted-foreground italic">
            Not auto-merge eligible: {output.autoMergeReason}
          </div>
        )}

        {proposal.reviewedAt && (
          <div className="text-xs text-muted-foreground">
            Decided {formatDate(proposal.reviewedAt)}
            {proposal.reviewNotes && <> · {proposal.reviewNotes}</>}
          </div>
        )}

        {isOpen && (
          <div className="flex flex-wrap gap-2 pt-2">
            <Button
              size="sm"
              onClick={() => onDecide("approve")}
              disabled={isPending}
              data-testid={`button-approve-${proposal.id}`}
            >
              <CircleCheck className="h-4 w-4 mr-1.5" aria-hidden="true" />
              Approve
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onDecide("reject")}
              disabled={isPending}
              data-testid={`button-reject-${proposal.id}`}
            >
              <CircleSlash className="h-4 w-4 mr-1.5" aria-hidden="true" />
              Reject
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onDecide("defer")}
              disabled={isPending}
              data-testid={`button-defer-${proposal.id}`}
            >
              <Clock className="h-4 w-4 mr-1.5" aria-hidden="true" />
              Defer
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
