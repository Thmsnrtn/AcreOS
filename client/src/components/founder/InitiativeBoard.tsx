/**
 * Initiative Board — Sovereign Company Protocol v6
 *
 * Agents pitch strategic ideas. CEO evaluates like board proposals.
 * Approve, reject, or shelve for later.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AGENT_AVATARS,
  AGENT_ROLES,
} from "@/lib/trust-language";
import {
  Lightbulb,
  ThumbsUp,
  ThumbsDown,
  Bookmark,
  TrendingUp,
  ArrowUpRight,
} from "lucide-react";

interface Initiative {
  id: number;
  proposedBy: string;
  title: string;
  thesis: string;
  evidence: Array<{
    type: string;
    description: string;
    value?: string | number;
  }>;
  projectedImpact: {
    metric: string;
    currentValue: number;
    projectedValue: number;
    timeframeWeeks: number;
    confidence: string;
  } | null;
  requiredAgents: string[] | null;
  estimatedEffort: string | null;
  status: string;
  ceoNotes: string | null;
  createdAt: string;
}

const CONFIDENCE_COLORS: Record<string, string> = {
  high: "text-emerald-600",
  medium: "text-amber-600",
  low: "text-red-600",
};

function InitiativeCard({ initiative }: { initiative: Initiative }) {
  const queryClient = useQueryClient();
  const [notes, setNotes] = useState("");
  const [showNotes, setShowNotes] = useState(false);

  const voteMutation = useMutation({
    mutationFn: ({ action, ceoNotes }: { action: string; ceoNotes?: string }) =>
      apiRequest("POST", `/api/founder/v6/initiatives/${initiative.id}/${action}`, { ceoNotes }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/founder/v6/initiatives"] }),
  });

  const avatar = AGENT_AVATARS[initiative.proposedBy] || "?";
  const role = AGENT_ROLES[initiative.proposedBy] || initiative.proposedBy;
  const impact = initiative.projectedImpact;
  const evidence = initiative.evidence || [];
  const isPending = initiative.status === "proposed";

  return (
    <div className="border rounded-xl p-4 space-y-3">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="text-sm font-semibold">{initiative.title}</div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="text-sm">{avatar}</span>
            <span className="text-xs text-muted-foreground">Proposed by {role}</span>
            <span className="text-xs text-muted-foreground">&middot; {new Date(initiative.createdAt).toLocaleDateString()}</span>
          </div>
        </div>
        <Badge variant="outline" className={
          initiative.status === "approved" ? "bg-emerald-100 text-emerald-800" :
          initiative.status === "rejected" ? "bg-red-100 text-red-800" :
          initiative.status === "shelved" ? "bg-amber-100 text-amber-800" :
          "bg-blue-100 text-blue-800"
        }>
          {initiative.status}
        </Badge>
      </div>

      {/* Thesis */}
      <p className="text-sm leading-relaxed">{initiative.thesis}</p>

      {/* Evidence */}
      {evidence.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Evidence</div>
          {evidence.map((e, i) => (
            <div key={i} className="flex items-start gap-2 text-xs">
              <Badge variant="outline" className="text-[10px] h-4 px-1 shrink-0">{e.type}</Badge>
              <span>{e.description}{e.value ? `: ${e.value}` : ""}</span>
            </div>
          ))}
        </div>
      )}

      {/* Projected Impact */}
      {impact && (
        <div className="flex items-center gap-3 p-2 rounded-lg bg-muted/50">
          <TrendingUp className="h-4 w-4 text-muted-foreground" />
          <div className="text-xs">
            <span className="font-medium">{impact.metric}</span>:{" "}
            <span className="text-muted-foreground">{impact.currentValue}</span>
            <ArrowUpRight className="h-3 w-3 inline mx-1" />
            <span className="font-semibold">{impact.projectedValue}</span>
            <span className="text-muted-foreground"> in {impact.timeframeWeeks}w</span>
            <span className={`ml-2 ${CONFIDENCE_COLORS[impact.confidence] || ""}`}>
              ({impact.confidence} confidence)
            </span>
          </div>
        </div>
      )}

      {/* Required agents */}
      {initiative.requiredAgents && initiative.requiredAgents.length > 0 && (
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          Needs:
          {initiative.requiredAgents.map(a => (
            <span key={a} title={AGENT_ROLES[a]}>{AGENT_AVATARS[a] || a}</span>
          ))}
        </div>
      )}

      {/* Actions (only for pending) */}
      {isPending && (
        <div className="space-y-2">
          {showNotes && (
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional CEO notes..."
              className="text-sm h-16"
            />
          )}
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="default"
              className="h-7 text-xs"
              onClick={() => voteMutation.mutate({ action: "approve", ceoNotes: notes || undefined })}
              disabled={voteMutation.isPending}
            >
              <ThumbsUp className="h-3 w-3 mr-1" /> Approve
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={() => voteMutation.mutate({ action: "shelve", ceoNotes: notes || undefined })}
              disabled={voteMutation.isPending}
            >
              <Bookmark className="h-3 w-3 mr-1" /> Later
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs text-red-600"
              onClick={() => voteMutation.mutate({ action: "reject", ceoNotes: notes || undefined })}
              disabled={voteMutation.isPending}
            >
              <ThumbsDown className="h-3 w-3 mr-1" /> Reject
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs ml-auto"
              onClick={() => setShowNotes(!showNotes)}
            >
              + Note
            </Button>
          </div>
        </div>
      )}

      {/* CEO Notes (for decided) */}
      {initiative.ceoNotes && (
        <div className="text-xs text-muted-foreground italic border-t pt-2">
          CEO: {initiative.ceoNotes}
        </div>
      )}
    </div>
  );
}

export function InitiativeBoard() {
  const [filter, setFilter] = useState<"proposed" | "all">("proposed");

  const { data: initiatives, isLoading } = useQuery({
    queryKey: ["/api/founder/v6/initiatives", filter],
    queryFn: () => apiRequest("GET", `/api/founder/v6/initiatives?status=${filter}`).then(r => r.json()),
    refetchInterval: 30000,
  });

  if (isLoading) return <Skeleton className="h-48 w-full rounded-xl" />;

  const list = (initiatives || []) as Initiative[];
  const pendingCount = list.filter(i => i.status === "proposed").length;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Lightbulb className="h-4 w-4" /> Agent Initiatives
            {pendingCount > 0 && (
              <Badge variant="outline" className="bg-blue-100 text-blue-800 ml-1">
                {pendingCount} pending
              </Badge>
            )}
          </CardTitle>
          <div className="flex gap-1">
            <Button
              size="sm"
              variant={filter === "proposed" ? "default" : "ghost"}
              className="h-6 text-[10px]"
              onClick={() => setFilter("proposed")}
            >
              Pending
            </Button>
            <Button
              size="sm"
              variant={filter === "all" ? "default" : "ghost"}
              className="h-6 text-[10px]"
              onClick={() => setFilter("all")}
            >
              All
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {list.length === 0 ? (
          <div className="text-center py-6 text-sm text-muted-foreground">
            No initiatives yet. Agents propose ideas when they spot opportunities.
          </div>
        ) : (
          list.map(initiative => (
            <InitiativeCard key={initiative.id} initiative={initiative} />
          ))
        )}
      </CardContent>
    </Card>
  );
}
