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
import { StatusBadge } from "@/components/StatusBadge";
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
import { formatDate } from "@/lib/format";

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
    <li className="border rounded-xl p-4 space-y-3 list-none">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-semibold m-0">{playbook.name}</p>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span aria-hidden="true" className="text-sm">{ownerAvatar}</span>
            <span className="text-xs text-muted-foreground">Owned by {ownerRole}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {playbook.isApproved ? (
            <StatusBadge status="success" label="Approved" />
          ) : (
            <StatusBadge status="pending" label="Pending" />
          )}
          {playbook.isApproved && (
            <Switch
              checked={playbook.isActive}
              onCheckedChange={() => toggleMutation.mutate()}
              disabled={toggleMutation.isPending}
              aria-label={`Activate ${playbook.name}`}
            />
          )}
        </div>
      </div>

      {/* Description */}
      {playbook.description && (
        <p className="text-xs text-muted-foreground">{playbook.description}</p>
      )}

      {/* Trigger */}
      <p className="text-xs px-2 py-1.5 rounded-md bg-muted/50 border m-0">
        Trigger: {playbook.triggerCondition}
      </p>

      {/* Steps */}
      <ol aria-label="Playbook steps" className="space-y-1 list-none p-0 m-0">
        {steps.map((step, i) => (
          <li key={i} className="flex items-center gap-2 text-xs">
            <span aria-hidden="true" className="text-muted-foreground font-mono w-4 tabular-nums">{step.order + 1}.</span>
            <span aria-hidden="true">{AGENT_AVATARS[step.agentCodename] || "?"}</span>
            <span className="text-muted-foreground">
              <span className="sr-only">{AGENT_ROLES[step.agentCodename] || step.agentCodename}: </span>
              {step.description}
            </span>
          </li>
        ))}
      </ol>

      {/* Stats */}
      {playbook.totalExecutions > 0 && (
        <ul aria-label="Playbook statistics" className="flex items-center gap-3 text-xs text-muted-foreground list-none p-0 m-0">
          <li><span className="tabular-nums">{playbook.totalExecutions}</span> runs</li>
          {playbook.successRate && <li><span className="tabular-nums">{playbook.successRate}%</span> success</li>}
          {playbook.lastExecutedAt && (
            <li>Last: <time dateTime={playbook.lastExecutedAt} className="tabular-nums">{formatDate(playbook.lastExecutedAt)}</time></li>
          )}
        </ul>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2">
        {!playbook.isApproved && (
          <Button
            type="button"
            size="sm"
            variant="default"
            className="h-7 text-xs"
            onClick={() => approveMutation.mutate()}
            disabled={approveMutation.isPending}
            aria-busy={approveMutation.isPending}
            aria-label={`Approve ${playbook.name}`}
          >
            <CheckCircle2 className="h-3 w-3 mr-1" aria-hidden="true" /> {approveMutation.isPending ? "Approving…" : "Approve"}
          </Button>
        )}
        {playbook.isApproved && playbook.isActive && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={() => executeMutation.mutate()}
            disabled={executeMutation.isPending}
            aria-busy={executeMutation.isPending}
            aria-label={`Run ${playbook.name} now`}
          >
            <Play className="h-3 w-3 mr-1" aria-hidden="true" /> {executeMutation.isPending ? "Running…" : "Run now"}
          </Button>
        )}
      </div>
    </li>
  );
}

export function PlaybookManager() {
  const { data: playbooks, isLoading } = useQuery({
    queryKey: ["/api/founder/v6/playbooks"],
    queryFn: () => apiRequest("GET", "/api/founder/v6/playbooks").then(r => r.json()),
    refetchInterval: 30000,
  });

  if (isLoading) return <Skeleton role="status" aria-busy="true" aria-label="Loading playbooks" className="h-48 w-full rounded-xl" />;

  const list = (playbooks || []) as Playbook[];
  const pending = list.filter(p => !p.isApproved);
  const approved = list.filter(p => p.isApproved);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <BookOpen className="h-4 w-4" aria-hidden="true" /> Playbooks
            {pending.length > 0 && (
              <Badge variant="outline" className="bg-amber-100 text-amber-800 ml-1 tabular-nums" aria-label={`${pending.length} awaiting approval`}>
                {pending.length} awaiting approval
              </Badge>
            )}
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {pending.length > 0 && (
          <section aria-labelledby="needs-approval-heading" className="space-y-2">
            <p id="needs-approval-heading" className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Needs your approval</p>
            <ul aria-labelledby="needs-approval-heading" className="space-y-3 list-none p-0 m-0">
              {pending.map(p => <PlaybookCard key={p.id} playbook={p} />)}
            </ul>
          </section>
        )}

        {approved.length > 0 && (
          <section aria-labelledby="active-playbooks-heading" className="space-y-2">
            <p id="active-playbooks-heading" className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Active playbooks</p>
            <ul aria-labelledby="active-playbooks-heading" className="space-y-3 list-none p-0 m-0">
              {approved.map(p => <PlaybookCard key={p.id} playbook={p} />)}
            </ul>
          </section>
        )}

        {list.length === 0 && (
          <p className="text-center py-6 text-sm text-muted-foreground">
            No playbooks yet. Agents propose SOPs when they spot repeatable patterns.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
