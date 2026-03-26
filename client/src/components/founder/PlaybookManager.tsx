/**
 * Playbook Manager — Sovereign Company Protocol v6
 *
 * Review, approve, and manage agent SOPs.
 * Approve once, agents execute forever.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AGENT_AVATARS,
  AGENT_ROLES,
} from "@/lib/trust-language";
import {
  BookOpen,
  CheckCircle2,
  Play,
  Pause,
  ArrowRight,
  ListChecks,
} from "lucide-react";

interface Playbook {
  id: number;
  name: string;
  description: string | null;
  ownerAgent: string;
  triggerCondition: string;
  steps: Array<{
    order: number;
    agentCodename: string;
    action: string;
    description: string;
  }>;
  isApproved: boolean;
  isActive: boolean;
  totalExecutions: number;
  successRate: string | null;
  lastExecutedAt: string | null;
  createdBy: string;
}

function PlaybookCard({ playbook }: { playbook: Playbook }) {
  const queryClient = useQueryClient();
  const ownerAvatar = AGENT_AVATARS[playbook.ownerAgent] || "?";
  const ownerRole = AGENT_ROLES[playbook.ownerAgent] || playbook.ownerAgent;

  const approveMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/founder/v6/playbooks/${playbook.id}/approve`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/founder/v6/playbooks"] }),
  });

  const toggleMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/founder/v6/playbooks/${playbook.id}/toggle`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/founder/v6/playbooks"] }),
  });

  const executeMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/founder/v6/playbooks/${playbook.id}/execute`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/founder/v6/playbooks"] }),
  });

  const steps = playbook.steps || [];

  return (
    <div className="border rounded-xl p-4 space-y-3">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="text-sm font-semibold">{playbook.name}</div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="text-sm">{ownerAvatar}</span>
            <span className="text-xs text-muted-foreground">Owned by {ownerRole}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {playbook.isApproved ? (
            <Badge variant="outline" className="bg-emerald-100 text-emerald-800">Approved</Badge>
          ) : (
            <Badge variant="outline" className="bg-amber-100 text-amber-800">Pending</Badge>
          )}
          {playbook.isApproved && (
            <Switch
              checked={playbook.isActive}
              onCheckedChange={() => toggleMutation.mutate()}
              disabled={toggleMutation.isPending}
            />
          )}
        </div>
      </div>

      {/* Description */}
      {playbook.description && (
        <p className="text-xs text-muted-foreground">{playbook.description}</p>
      )}

      {/* Trigger */}
      <div className="text-xs px-2 py-1.5 rounded-md bg-muted/50 border">
        Trigger: {playbook.triggerCondition}
      </div>

      {/* Steps */}
      <div className="space-y-1">
        {steps.map((step, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground font-mono w-4">{step.order + 1}.</span>
            <span>{AGENT_AVATARS[step.agentCodename] || "?"}</span>
            <span className="text-muted-foreground">{step.description}</span>
          </div>
        ))}
      </div>

      {/* Stats */}
      {playbook.totalExecutions > 0 && (
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>{playbook.totalExecutions} runs</span>
          {playbook.successRate && <span>{playbook.successRate}% success</span>}
          {playbook.lastExecutedAt && (
            <span>Last: {new Date(playbook.lastExecutedAt).toLocaleDateString()}</span>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2">
        {!playbook.isApproved && (
          <Button
            size="sm"
            variant="default"
            className="h-7 text-xs"
            onClick={() => approveMutation.mutate()}
            disabled={approveMutation.isPending}
          >
            <CheckCircle2 className="h-3 w-3 mr-1" /> Approve
          </Button>
        )}
        {playbook.isApproved && playbook.isActive && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={() => executeMutation.mutate()}
            disabled={executeMutation.isPending}
          >
            <Play className="h-3 w-3 mr-1" /> Run Now
          </Button>
        )}
      </div>
    </div>
  );
}

export function PlaybookManager() {
  const { data: playbooks, isLoading } = useQuery({
    queryKey: ["/api/founder/v6/playbooks"],
    queryFn: () => apiRequest("GET", "/api/founder/v6/playbooks").then(r => r.json()),
    refetchInterval: 30000,
  });

  if (isLoading) return <Skeleton className="h-48 w-full rounded-xl" />;

  const list = (playbooks || []) as Playbook[];
  const pending = list.filter(p => !p.isApproved);
  const approved = list.filter(p => p.isApproved);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <BookOpen className="h-4 w-4" /> Playbooks
            {pending.length > 0 && (
              <Badge variant="outline" className="bg-amber-100 text-amber-800 ml-1">
                {pending.length} awaiting approval
              </Badge>
            )}
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {pending.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Needs Your Approval</div>
            {pending.map(p => <PlaybookCard key={p.id} playbook={p} />)}
          </div>
        )}

        {approved.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Active Playbooks</div>
            {approved.map(p => <PlaybookCard key={p.id} playbook={p} />)}
          </div>
        )}

        {list.length === 0 && (
          <div className="text-center py-6 text-sm text-muted-foreground">
            No playbooks yet. Agents propose SOPs when they spot repeatable patterns.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
