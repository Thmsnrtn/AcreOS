import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Bot, Activity, Clock, AlertCircle, Info } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface AgentHealth {
  name: string;
  enabled: boolean;
  status: "idle" | "running" | "error" | "disabled";
  lastRun: string | null;
  nextRun: string | null;
  lastError: string | null;
  runCount: number;
}

const AGENT_LABELS: Record<string, { label: string; description: string }> = {
  customer_success: { label: "Customer Success", description: "Automatically sends check-in emails, re-engages inactive customers, and celebrates milestones" },
  growth: { label: "Growth Intelligence", description: "Tracks new signups daily, monitors who is actively using the product, and sends you weekly summaries" },
  revenue: { label: "Revenue Operations", description: "Watches your monthly revenue, suggests upgrade opportunities, and alerts you about payment issues" },
  operations: { label: "Operations", description: "Monitors data sources and APIs to make sure everything is working behind the scenes" },
  digest: { label: "Founder Digest", description: "Sends you one daily briefing that summarizes what all other agents did" },
};

const STATUS_COLORS = {
  idle: "bg-green-500",
  running: "bg-blue-500 animate-pulse",
  error: "bg-red-500",
  disabled: "bg-gray-400",
};

export default function FounderAgentsPage() {
  const queryClient = useQueryClient();
  const [pendingToggle, setPendingToggle] = useState<{ name: string; enabled: boolean } | null>(null);

  const { data: agents, isLoading } = useQuery<AgentHealth[]>({
    queryKey: ["/api/admin/agents/status"],
    refetchInterval: 10000,
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ name, enabled }: { name: string; enabled: boolean }) => {
      const res = await apiRequest("POST", `/api/admin/agents/${name}/toggle`, { enabled });
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/admin/agents/status"] }),
  });

  if (isLoading) return <div className="p-8"><Skeleton className="h-96 w-full" /></div>;

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Bot className="h-6 w-6" />
        <h1 className="text-2xl font-bold">Agent Operations</h1>
      </div>

      <Alert>
        <Info className="h-4 w-4" />
        <AlertTitle>What are agents?</AlertTitle>
        <AlertDescription>
          These are your automated assistants. Each one handles a different part of your business. You can turn them on or off at any time using the toggle on the right.
        </AlertDescription>
      </Alert>

      <div className="grid gap-4">
        {(agents ?? []).map((agent) => {
          const meta = AGENT_LABELS[agent.name] || { label: agent.name, description: "" };
          return (
            <Card key={agent.name}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`h-3 w-3 rounded-full ${STATUS_COLORS[agent.status]}`} />
                    <div>
                      <h3 className="font-medium">{meta.label}</h3>
                      <p className="text-sm text-muted-foreground">{meta.description}</p>
                    </div>
                  </div>
                  <Switch
                    checked={agent.enabled}
                    onCheckedChange={(enabled) => toggleMutation.mutate({ name: agent.name, enabled })}
                  />
                </div>

                <div className="mt-3 flex items-center gap-6 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Activity className="h-3 w-3" />
                    {agent.runCount} runs
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    Last: {agent.lastRun ? new Date(agent.lastRun).toLocaleString() : "Never"}
                  </span>
                  {agent.lastError && (
                    <span className="flex items-center gap-1 text-destructive">
                      <AlertCircle className="h-3 w-3" />
                      {agent.lastError}
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
