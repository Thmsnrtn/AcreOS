/**
 * Founder-only: the background job roster and its run status.
 *
 * Reads /api/agents/status every 30s and pairs it with the fixed roster below.
 * Moved here 2026-09-04 from client/src/pages/command-center.tsx (the
 * CUSTOMER's /ai door) — see ./index.ts for why. Behaviour is unchanged:
 * command-center.tsx renders this behind `mainTab === "agents" && isFounder`,
 * exactly as before.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { StatusBadge } from "@/components/StatusBadge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  Bot,
  FileText,
  Users,
  Clock,
  CheckCircle2,
  AlertCircle,
  DollarSign,
  TrendingUp,
  Bell,
  GitBranch,
  RefreshCw,
  Activity
} from "lucide-react";
import { relative } from "@/lib/format";

interface BackgroundAgent {
  id: string;
  name: string;
  description: string;
  frequency: string;
  icon: typeof Bot;
  status: "running" | "idle" | "error";
  lastRunAt?: string;
  processedCount?: number;
  errorCount?: number;
}

interface AgentRunStatus {
  id: number;
  agentName: string;
  status: string;
  lastRunAt: string | null;
  nextRunAt: string | null;
  processedCount: number | null;
  errorCount: number | null;
  lastError: string | null;
  metadata: Record<string, any> | null;
}

const defaultBackgroundAgents: Omit<BackgroundAgent, "status" | "lastRunAt" | "processedCount" | "errorCount">[] = [
  {
    id: "lead_nurturer",
    name: "Lead Nurturer",
    description: "Scores leads and generates personalized follow-up sequences",
    frequency: "Every 15 minutes",
    icon: Users,
  },
  {
    id: "campaign_optimizer",
    name: "Campaign Optimizer",
    description: "Analyzes campaign performance and suggests optimizations",
    frequency: "Every hour",
    icon: TrendingUp,
  },
  {
    id: "finance_agent",
    name: "Finance Agent",
    description: "Handles delinquency detection and payment reminders",
    frequency: "Every 30 minutes",
    icon: DollarSign,
  },
  {
    id: "alerting_service",
    name: "Alerting Service",
    description: "Monitors system health and detects issues",
    frequency: "Every hour",
    icon: Bell,
  },
  {
    id: "digest_service",
    name: "Digest Service",
    description: "Generates performance summaries and reports",
    frequency: "Weekly",
    icon: FileText,
  },
  {
    id: "sequence_processor",
    name: "Sequence Processor",
    description: "Processes automation sequences and workflows",
    frequency: "Every minute",
    icon: GitBranch,
  },
];

function getAgentStatusBadge(status: BackgroundAgent["status"]) {
  switch (status) {
    case "running":
      return <StatusBadge status="active" label="Running" />;
    case "idle":
      return <StatusBadge status="paused" label="Idle" />;
    case "error":
      return <StatusBadge status="error" label="Error" />;
    default:
      return <StatusBadge status="inactive" label="Unknown" />;
  }
}

export function BackgroundServicesPanel() {
  const { toast } = useToast();

  const { data: agentStatuses = [], isLoading } = useQuery<AgentRunStatus[]>({
    queryKey: ["/api/agents/status"],
    refetchInterval: 30000,
  });

  const backgroundAgents: BackgroundAgent[] = defaultBackgroundAgents.map((agent) => {
    const apiStatus = agentStatuses.find((s) => s.agentName === agent.id);
    const status: BackgroundAgent["status"] = apiStatus
      ? (apiStatus.status === "failed" ? "error" : apiStatus.status === "running" ? "running" : apiStatus.status === "completed" ? "idle" : "idle")
      : "idle";
    return {
      ...agent,
      status,
      lastRunAt: apiStatus?.lastRunAt || undefined,
      processedCount: apiStatus?.processedCount || 0,
      errorCount: apiStatus?.errorCount || 0,
    };
  });

  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);

  const handleViewActivity = (agentId: string, agentName: string) => {
    setSelectedAgent(selectedAgent === agentId ? null : agentId);
  };

  const getAgentActivitySummary = (agent: BackgroundAgent) => {
    const status = agentStatuses.find((s) => s.agentName === agent.id);
    if (!status) return "No activity recorded yet.";
    const parts: string[] = [];
    if (status.processedCount) parts.push(`${status.processedCount} items processed`);
    if (status.errorCount) parts.push(`${status.errorCount} errors`);
    if (status.lastError) parts.push(`Last error: ${status.lastError}`);
    if (status.lastRunAt) parts.push(`Last run: ${new Date(status.lastRunAt).toLocaleString()}`);
    if (status.nextRunAt) parts.push(`Next run: ${new Date(status.nextRunAt).toLocaleString()}`);
    return parts.length > 0 ? parts.join(" \u2022 ") : "Agent is idle with no recent activity.";
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden p-6">
      <div className="mb-6">
        <h2 className="text-lg font-semibold mb-1">Background Agent Services</h2>
        <p className="text-sm text-muted-foreground">
          These agents run automatically in the background to keep your business running smoothly.
        </p>
      </div>

      <ScrollArea className="flex-1">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pb-4">
          {isLoading ? (
            Array.from({ length: 6 }).map((_, i) => (
              <Card key={i} className="flex flex-col" data-testid={`card-agent-skeleton-${i}`}>
                <CardHeader className="pb-3">
                  <Skeleton className="h-10 w-full" />
                </CardHeader>
                <CardContent>
                  <Skeleton className="h-16 w-full mb-3" />
                  <Skeleton className="h-4 w-24" />
                </CardContent>
              </Card>
            ))
          ) : (
            backgroundAgents.map((agent) => {
              const IconComponent = agent.icon;

              return (
                <Card key={agent.id} className="flex flex-col" data-testid={`card-agent-${agent.id}`}>
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-card ${agent.status === "running" ? "bg-acr-pos-soft" : agent.status === "error" ? "bg-acr-neg-soft" : "bg-muted"}`}>
                          <IconComponent className={`w-4 h-4 ${agent.status === "running" ? "text-acr-pos" : agent.status === "error" ? "text-acr-neg" : ""}`} />
                        </div>
                        <div>
                          <CardTitle className="text-sm font-medium">{agent.name}</CardTitle>
                        </div>
                      </div>
                      {getAgentStatusBadge(agent.status)}
                    </div>
                  </CardHeader>
                  <CardContent className="flex-1 flex flex-col gap-3">
                    <p className="text-sm text-muted-foreground">{agent.description}</p>
                    
                    <div className="space-y-2 text-xs">
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <RefreshCw className="w-3 h-3" aria-hidden="true" />
                        <span>{agent.frequency}</span>
                      </div>
                      {agent.lastRunAt && (
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <Clock className="w-3 h-3" />
                          <span>Last run: {relative(agent.lastRunAt)}</span>
                        </div>
                      )}
                      {(agent.processedCount !== undefined && agent.processedCount > 0) && (
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <CheckCircle2 className="w-3 h-3 text-acr-pos" />
                          <span>Processed: {agent.processedCount}</span>
                        </div>
                      )}
                      {(agent.errorCount !== undefined && agent.errorCount > 0) && (
                        <div className="flex items-center gap-2 text-acr-neg">
                          <AlertCircle className="w-3 h-3" />
                          <span>Errors: {agent.errorCount}</span>
                        </div>
                      )}
                    </div>

                    {selectedAgent === agent.id && (
                      <div className="p-3 bg-muted/50 rounded-card text-xs text-muted-foreground border">
                        {getAgentActivitySummary(agent)}
                      </div>
                    )}

                    <div className="flex items-center gap-2 mt-auto pt-3">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="flex-1"
                        onClick={() => handleViewActivity(agent.id, agent.name)}
                        data-testid={`button-view-agent-${agent.id}`}
                      >
                        <Activity className="w-3 h-3 mr-1" />
                        {selectedAgent === agent.id ? "Hide Activity" : "View Activity"}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
