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
import { formatDate } from "@/lib/format";

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
  high: "text-acr-pos",
  medium: "text-acr-warn",
  low: "text-acr-neg",
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
    <li className="border rounded-xl p-4 space-y-3 list-none">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-semibold m-0">{initiative.title}</p>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span aria-hidden="true" className="text-sm">{avatar}</span>
            <span className="text-xs text-muted-foreground">Proposed by {role}</span>
            <span className="text-xs text-muted-foreground">&middot; <time dateTime={initiative.createdAt} className="tabular-nums">{formatDate(initiative.createdAt)}</time></span>
          </div>
        </div>
        <Badge
          variant="outline"
          aria-label={`Status: ${initiative.status}`}
          className={`capitalize ${
            initiative.status === "approved" ? "bg-acr-pos-soft text-acr-pos" :
            initiative.status === "rejected" ? "bg-acr-neg-soft text-acr-neg" :
            initiative.status === "shelved" ? "bg-acr-warn-soft text-acr-warn" :
            "bg-acr-accent text-acr-accent"
          }`}
        >
          {initiative.status}
        </Badge>
      </div>

      {/* Thesis */}
      <p className="text-sm leading-relaxed">{initiative.thesis}</p>

      {/* Evidence */}
      {evidence.length > 0 && (
        <section aria-labelledby={`evidence-${initiative.id}`} className="space-y-1">
          <p id={`evidence-${initiative.id}`} className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Evidence</p>
          <ul aria-labelledby={`evidence-${initiative.id}`} className="space-y-1 list-none p-0 m-0">
            {evidence.map((e, i) => (
              <li key={i} className="flex items-start gap-2 text-xs">
                <Badge variant="outline" className="text-micro h-4 px-1 shrink-0 capitalize">{e.type}</Badge>
                <span>{e.description}{e.value ? `: ${e.value}` : ""}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Projected Impact */}
      {impact && (
        <div
          className="flex items-center gap-3 p-2 rounded-card bg-muted/50"
          aria-label={`Projected impact on ${impact.metric}: from ${impact.currentValue} to ${impact.projectedValue} in ${impact.timeframeWeeks} weeks (${impact.confidence} confidence)`}
        >
          <TrendingUp className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <div className="text-xs">
            <span className="font-medium">{impact.metric}</span>:{" "}
            <span className="text-muted-foreground tabular-nums">{impact.currentValue}</span>
            <ArrowUpRight className="h-3 w-3 inline mx-1" aria-hidden="true" />
            <span className="font-semibold tabular-nums">{impact.projectedValue}</span>
            <span className="text-muted-foreground"> in <span className="tabular-nums">{impact.timeframeWeeks}w</span></span>
            <span className={`ml-2 ${CONFIDENCE_COLORS[impact.confidence] || ""}`}>
              ({impact.confidence} confidence)
            </span>
          </div>
        </div>
      )}

      {/* Required agents */}
      {initiative.requiredAgents && initiative.requiredAgents.length > 0 && (
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <span>Needs:</span>
          <ul aria-label="Required agents" className="flex items-center gap-1 list-none p-0 m-0">
            {initiative.requiredAgents.map(a => (
              <li key={a} aria-label={AGENT_ROLES[a] || a}>
                <span aria-hidden="true">{AGENT_AVATARS[a] || a}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Actions (only for pending) */}
      {isPending && (
        <div className="space-y-2">
          {showNotes && (
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional CEO notes…"
              className="text-sm h-16"
              aria-label="CEO notes (optional)"
              autoCapitalize="sentences"
            />
          )}
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="default"
              className="h-7 text-xs"
              onClick={() => voteMutation.mutate({ action: "approve", ceoNotes: notes || undefined })}
              disabled={voteMutation.isPending}
              aria-busy={voteMutation.isPending}
              aria-label={`Approve ${initiative.title}`}
            >
              <ThumbsUp className="h-3 w-3 mr-1" aria-hidden="true" /> Approve
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={() => voteMutation.mutate({ action: "shelve", ceoNotes: notes || undefined })}
              disabled={voteMutation.isPending}
              aria-busy={voteMutation.isPending}
              aria-label={`Shelve ${initiative.title}`}
            >
              <Bookmark className="h-3 w-3 mr-1" aria-hidden="true" /> Later
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 text-xs text-acr-neg"
              onClick={() => voteMutation.mutate({ action: "reject", ceoNotes: notes || undefined })}
              disabled={voteMutation.isPending}
              aria-busy={voteMutation.isPending}
              aria-label={`Reject ${initiative.title}`}
            >
              <ThumbsDown className="h-3 w-3 mr-1" aria-hidden="true" /> Reject
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 text-xs ml-auto"
              onClick={() => setShowNotes(!showNotes)}
              aria-expanded={showNotes}
              aria-controls={`ceo-notes-${initiative.id}`}
              aria-label={showNotes ? "Hide CEO note field" : "Add CEO note"}
            >
              + Note
            </Button>
          </div>
        </div>
      )}

      {/* CEO Notes (for decided) */}
      {initiative.ceoNotes && (
        <p className="text-xs text-muted-foreground italic border-t pt-2 m-0">
          CEO: {initiative.ceoNotes}
        </p>
      )}
    </li>
  );
}

export function InitiativeBoard() {
  const [filter, setFilter] = useState<"proposed" | "all">("proposed");

  const { data: initiatives, isLoading } = useQuery({
    queryKey: ["/api/founder/v6/initiatives", filter],
    queryFn: () => apiRequest("GET", `/api/founder/v6/initiatives?status=${filter}`).then(r => r.json()),
    refetchInterval: 30000,
  });

  if (isLoading) return <Skeleton role="status" aria-busy="true" aria-label="Loading initiatives" className="h-48 w-full rounded-xl" />;

  const list = (initiatives || []) as Initiative[];
  const pendingCount = list.filter(i => i.status === "proposed").length;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Lightbulb className="h-4 w-4" aria-hidden="true" /> Agent initiatives
            {pendingCount > 0 && (
              <Badge variant="outline" className="bg-acr-accent text-acr-accent ml-1 tabular-nums" aria-label={`${pendingCount} pending`}>
                {pendingCount} pending
              </Badge>
            )}
          </CardTitle>
          <div role="radiogroup" aria-label="Filter initiatives" className="flex gap-1">
            <Button
              type="button"
              role="radio"
              aria-checked={filter === "proposed"}
              size="sm"
              variant={filter === "proposed" ? "default" : "ghost"}
              className="h-6 text-micro"
              onClick={() => setFilter("proposed")}
            >
              Pending
            </Button>
            <Button
              type="button"
              role="radio"
              aria-checked={filter === "all"}
              size="sm"
              variant={filter === "all" ? "default" : "ghost"}
              className="h-6 text-micro"
              onClick={() => setFilter("all")}
            >
              All
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {list.length === 0 ? (
          <p className="text-center py-6 text-sm text-muted-foreground">
            No initiatives yet. Agents propose ideas when they spot opportunities.
          </p>
        ) : (
          <ul aria-label="Agent initiatives" className="space-y-4 list-none p-0 m-0">
            {list.map(initiative => (
              <InitiativeCard key={initiative.id} initiative={initiative} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
