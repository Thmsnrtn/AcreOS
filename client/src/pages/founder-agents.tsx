import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useDocumentTitle } from "@/hooks/use-document-title";
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
  customer_success: { label: "Customer success", description: "Automatically sends check-in emails, re-engages inactive customers, and celebrates milestones" },
  growth: { label: "Growth intelligence", description: "Tracks new signups daily, monitors who is actively using the product, and sends you weekly summaries" },
  revenue: { label: "Revenue operations", description: "Watches your monthly revenue, suggests upgrade opportunities, and alerts you about payment issues" },
  operations: { label: "Operations", description: "Monitors data sources and APIs to make sure everything is working behind the scenes" },
  digest: { label: "Founder digest", description: "Sends you one daily briefing that summarizes what all other agents did" },
};

const STATUS_COLORS = {
  idle: "bg-green-500",
  running: "bg-blue-500 animate-pulse",
  error: "bg-red-500",
  disabled: "bg-gray-400",
};

export default function FounderAgentsPage() {
  useDocumentTitle("Agent operations");
  const { toast } = useToast();
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
    onError: () =>
      toast({
        title: "Couldn't update agent",
        description: "The agent's on/off state is unchanged. Try again in a moment.",
        variant: "destructive",
      }),
  });

  const handleConfirmToggle = () => {
    if (pendingToggle) {
      toggleMutation.mutate(pendingToggle);
      setPendingToggle(null);
    }
  };

  const getPendingMeta = () => {
    if (!pendingToggle) return { label: "", description: "" };
    return AGENT_LABELS[pendingToggle.name] || { label: pendingToggle.name, description: "" };
  };

  if (isLoading) return (
    <div className="p-8" role="status" aria-live="polite">
      <span className="sr-only">Loading agents…</span>
      <Skeleton className="h-96 w-full" />
    </div>
  );

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Bot className="h-6 w-6" aria-hidden="true" />
        <h1 className="text-2xl font-bold">Agent operations</h1>
      </div>

      <Alert>
        <Info className="h-4 w-4" aria-hidden="true" />
        <AlertTitle>What are agents?</AlertTitle>
        <AlertDescription>
          These are your automated assistants. Each one handles a different part of your business. You can turn them on or off at any time using the toggle on the right.
        </AlertDescription>
      </Alert>

      <ul className="grid gap-4" aria-label="Automated agents">
        {(agents ?? []).map((agent) => {
          const meta = AGENT_LABELS[agent.name] || { label: agent.name, description: "" };
          return (
            <li key={agent.name}>
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className={`h-3 w-3 rounded-full ${STATUS_COLORS[agent.status]}`}
                        aria-label={`Status: ${agent.status}`}
                      />
                      <div className="min-w-0">
                        <h2 className="font-medium">{meta.label}</h2>
                        <p className="text-sm text-muted-foreground">{meta.description}</p>
                      </div>
                    </div>
                    <Switch
                      checked={agent.enabled}
                      onCheckedChange={(enabled) => setPendingToggle({ name: agent.name, enabled })}
                      aria-label={`${meta.label}: ${agent.enabled ? "on" : "off"}`}
                    />
                  </div>

                  <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Activity className="h-3 w-3" aria-hidden="true" />
                      <span className="tabular-nums">{agent.runCount}</span> runs
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" aria-hidden="true" />
                      Last: <span className="tabular-nums">{agent.lastRun ? new Date(agent.lastRun).toLocaleString() : "Never"}</span>
                    </span>
                    {agent.lastError && (
                      <span className="flex items-center gap-1 text-destructive" role="alert">
                        <AlertCircle className="h-3 w-3" aria-hidden="true" />
                        {agent.lastError}
                      </span>
                    )}
                  </div>
                </CardContent>
              </Card>
            </li>
          );
        })}
      </ul>

      <AlertDialog open={!!pendingToggle} onOpenChange={(open) => { if (!open) setPendingToggle(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingToggle?.enabled
                ? `Activate ${getPendingMeta().label}?`
                : `Pause ${getPendingMeta().label}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingToggle?.enabled
                ? `This will activate ${getPendingMeta().label}. It will start handling ${getPendingMeta().description.toLowerCase()} automatically.`
                : `Are you sure you want to pause ${getPendingMeta().label}? It handles ${getPendingMeta().description.toLowerCase()}. While paused, these tasks won't run automatically.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmToggle}>
              Yes, {pendingToggle?.enabled ? "activate" : "pause"} it
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
