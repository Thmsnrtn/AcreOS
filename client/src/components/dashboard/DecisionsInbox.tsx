import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckCircle2, X, Clock, ChevronDown, ChevronUp } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useState } from "react";
import {
  AGENT_AVATARS,
  AGENT_ROLES,
  naturalItemType,
  naturalUrgency,
  naturalRisk,
} from "@/lib/trust-language";

interface DecisionsInboxItem {
  id: number;
  itemType: string;
  riskLevel: string;
  urgencyScore: number;
  estimatedImpactCents: number | null;
  sophieAnalysis: string;
  sophieConfidenceScore: number | null;
  recommendedAction: string;
  recommendedActionLabel: string;
  organizationId: number | null;
  contextBundle: Record<string, any> | null;
  status: string;
  createdAt: string;
}

interface InboxResponse {
  items: DecisionsInboxItem[];
  totalPending: number;
  stats: { byType: Record<string, number> };
}

const RISK_BADGE: Record<string, string> = {
  critical: "bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-300",
  high: "bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-900/30 dark:text-orange-300",
  medium: "bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-300",
  low: "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300",
};

function formatItemType(type: string) {
  return type.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function ItemCard({ item, onAction }: { item: DecisionsInboxItem; onAction: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const qc = useQueryClient();

  const mutate = useMutation({
    mutationFn: ({ action, body }: { action: string; body?: any }) =>
      apiRequest("POST", `/api/founder/intelligence/decisions-inbox/${item.id}/${action}`, body ?? {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/founder/intelligence/decisions-inbox"] }); onAction(); },
  });

  const impactText = item.estimatedImpactCents
    ? ` · Est. impact $${(item.estimatedImpactCents / 100).toLocaleString()}/yr`
    : "";

  return (
    <li className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span aria-hidden="true" className="text-lg">{AGENT_AVATARS[(item as any).ownerAgentCodename || "sophie_csm"]}</span>
          <Badge className={`text-xs border ${RISK_BADGE[item.riskLevel] ?? RISK_BADGE.medium}`}>
            {naturalRisk(item.riskLevel)}
          </Badge>
          <span className="text-xs text-muted-foreground">{naturalItemType(item.itemType)}{impactText}</span>
          <span className="text-xs text-muted-foreground">{naturalUrgency(item.urgencyScore)}</span>
        </div>
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
          onClick={() => setExpanded(e => !e)}
          aria-expanded={expanded}
          aria-label={expanded ? "Hide context" : "Show context"}
        >
          {expanded ? <ChevronUp className="h-4 w-4" aria-hidden="true" /> : <ChevronDown className="h-4 w-4" aria-hidden="true" />}
        </button>
      </div>

      <p className="text-sm text-foreground leading-snug">{item.sophieAnalysis}</p>

      {/* v3: Removed raw confidence score — CEO doesn't need technical metrics */}

      {expanded && item.contextBundle && (
        <pre className="text-xs bg-muted rounded p-2 overflow-auto max-h-32">
          {JSON.stringify(item.contextBundle, null, 2)}
        </pre>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <Button
          type="button"
          size="sm"
          className="bg-green-600 hover:bg-green-700 text-white"
          disabled={mutate.isPending}
          aria-busy={mutate.isPending}
          onClick={() => mutate.mutate({ action: "approve" })}
        >
          Approve: {item.recommendedActionLabel}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={mutate.isPending}
          aria-busy={mutate.isPending}
          onClick={() => mutate.mutate({ action: "reject" })}
        >
          <X className="h-3 w-3 mr-1" aria-hidden="true" /> Reject
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={mutate.isPending}
          aria-busy={mutate.isPending}
          onClick={() => mutate.mutate({ action: "defer", body: { hours: 24 } })}
        >
          <Clock className="h-3 w-3 mr-1" aria-hidden="true" /> Defer 24h
        </Button>
      </div>
    </li>
  );
}

export function DecisionsInbox() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<InboxResponse>({
    queryKey: ["/api/founder/intelligence/decisions-inbox"],
    refetchInterval: 30000,
    refetchIntervalInBackground: false,
  });

  const items = data?.items ?? [];
  const pending = data?.totalPending ?? 0;

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Decisions inbox</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3 animate-pulse">
            {[0, 1].map(i => <div key={i} className="h-24 rounded-lg bg-muted" />)}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">
            Decisions inbox
            {pending > 0 && (
              <Badge className="ml-2 bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-900/30 dark:text-orange-300 text-xs tabular-nums" aria-label={`${pending} pending`}>
                {pending}
              </Badge>
            )}
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <CheckCircle2 className="h-10 w-10 text-green-500 mb-2" aria-hidden="true" />
            <p className="text-sm font-medium text-foreground">All clear. Sophie has handled everything.</p>
            <p className="text-xs text-muted-foreground mt-1">No decisions pending</p>
          </div>
        ) : (
          <ul aria-label="Pending decisions" className="space-y-3 list-none p-0 m-0">
            {items.map(item => (
              <ItemCard
                key={item.id}
                item={item}
                onAction={() => qc.invalidateQueries({ queryKey: ["/api/founder/intelligence/decisions-inbox"] })}
              />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
