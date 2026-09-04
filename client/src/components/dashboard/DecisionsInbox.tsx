import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckCircle2, X, Clock, ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useState } from "react";
import {
  AGENT_AVATARS,
  AGENT_ROLES,
  naturalItemType,
  naturalUrgency,
  naturalRisk,
} from "@/lib/trust-language";
import { AgentReasoningExpandable } from "@/components/dashboard/AgentReasoningExpandable";

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

// Jarvis 2.3 — phone-answerable card option (contextBundle.options) and the
// precedent attached by the cascade (contextBundle.precedents).
interface DecisionCardOption {
  key: string;
  label: string;
}

interface DecisionPrecedent {
  sourceRef: string;
  snippet: string;
  similarity: number;
}

function readOptions(bundle: Record<string, any> | null): DecisionCardOption[] {
  const raw = bundle?.options;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (o: any): o is DecisionCardOption =>
      o && typeof o.key === "string" && typeof o.label === "string",
  );
}

function readPrecedents(bundle: Record<string, any> | null): DecisionPrecedent[] {
  const raw = bundle?.precedents;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (p: any): p is DecisionPrecedent =>
      p && typeof p.sourceRef === "string" && typeof p.snippet === "string",
  );
}

const RISK_BADGE: Record<string, string> = {
  critical: "bg-acr-neg-soft text-acr-neg-soft-ink border-acr-neg-soft dark:bg-acr-neg-soft/30 dark:text-acr-neg-soft-ink",
  high: "bg-acr-warn-soft text-acr-warn-soft-ink border-acr-warn-soft dark:bg-acr-warn-soft/30 dark:text-acr-warn-soft-ink",
  medium: "bg-acr-warn-soft text-acr-warn-soft-ink border-acr-warn-soft dark:bg-acr-warn-soft/30 dark:text-acr-warn-soft-ink",
  low: "bg-acr-accent text-acr-accent border-acr-accent dark:bg-acr-accent/30 dark:text-acr-accent",
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

  // F-D26: server returns `recommendedActionLabel` but no card heading. Compose one
  // from the action label so each item has scannable semantic text. Fall back to
  // a humanized itemType if the agent omitted a label.
  const cardTitle = item.recommendedActionLabel?.trim() || naturalItemType(item.itemType);

  const options = readOptions(item.contextBundle);
  const precedents = readPrecedents(item.contextBundle);

  return (
    <li className="rounded-card border bg-card p-4 space-y-3">
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

      <h3 className="text-sm font-semibold text-foreground leading-tight">{cardTitle}</h3>
      <p className="text-sm text-muted-foreground leading-snug">{item.sophieAnalysis}</p>

      {/* v3: Removed raw confidence score — CEO doesn't need technical metrics */}

      {expanded && item.contextBundle && (
        <div className="space-y-2">
          {/* Jarvis 2.3 — precedent(s) attached by the cascade */}
          {precedents.length > 0 && (
            <div className="text-xs bg-muted rounded p-2 space-y-1">
              <p className="font-medium text-foreground">Previously ruled</p>
              {precedents.slice(0, 3).map((p) => (
                <p key={p.sourceRef} className="text-muted-foreground leading-snug">
                  {p.snippet.length > 200 ? `${p.snippet.slice(0, 200)}…` : p.snippet}
                </p>
              ))}
            </div>
          )}
          <pre className="text-xs bg-muted rounded p-2 overflow-auto max-h-32">
            {JSON.stringify(item.contextBundle, null, 2)}
          </pre>
        </div>
      )}

      {/* Jarvis 2.3 — phone-answerable options replace the default row when
          present: full-width tap-sized stack; 'approve_recommended' approves,
          any other key posts an override with chosenOption. */}
      {options.length > 0 ? (
        <div className="flex flex-col gap-2">
          {options.map((opt) => (
            <Button
              key={opt.key}
              type="button"
              variant={opt.key === "approve_recommended" ? "default" : "outline"}
              className="w-full min-h-11 justify-center whitespace-normal"
              disabled={mutate.isPending}
              aria-busy={mutate.isPending}
              onClick={() =>
                mutate.mutate({
                  action: opt.key === "approve_recommended" ? "approve" : "override",
                  body: { chosenOption: opt.key },
                })
              }
            >
              {opt.label}
            </Button>
          ))}
        </div>
      ) : (
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            type="button"
            size="sm"
            className="bg-acr-pos hover:bg-acr-pos text-white"
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
      )}

      {/* Lens 46 — trust-loop legibility: the founder can expand to see the
          agent's reasoning, alternatives weighed, model tiers tried, and
          the upstream observation that triggered this item. */}
      <AgentReasoningExpandable decisionId={item.id} />
    </li>
  );
}

export function DecisionsInbox() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<InboxResponse>({
    queryKey: ["/api/founder/intelligence/decisions-inbox"],
    // 2026-05-26: dropped 30s background polling → refetch on focus only.
    // The decisions inbox isn't a real-time surface; freshness on tab
    // return is enough and saves continuous queries from every open tab.
    refetchOnWindowFocus: true,
    staleTime: 60_000,
  });

  const items = data?.items ?? [];
  const pending = data?.totalPending ?? 0;

  // Declared ABOVE the loading early-return: a hook after a conditional
  // return changes the hook count the moment loading finishes, which is a
  // rules-of-hooks violation React can throw on. eslint-plugin-react-hooks
  // was registered as a no-op stub, so nothing reported it (2026-09-04).
  const purgeMutation = useMutation({
    mutationFn: (vars: { olderThanDays: number }) =>
      apiRequest("POST", "/api/founder/intelligence/decisions-inbox/purge", {
        olderThanDays: vars.olderThanDays,
        statuses: ["pending", "deferred"],
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/founder/intelligence/decisions-inbox"] });
    },
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Decisions inbox</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3 animate-pulse">
            {[0, 1].map(i => <div key={i} className="h-24 rounded-card bg-muted" />)}
          </div>
        </CardContent>
      </Card>
    );
  }


  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">
            Decisions inbox
            {pending > 0 && (
              <Badge className="ml-2 bg-acr-warn-soft text-acr-warn-soft-ink border-acr-warn-soft dark:bg-acr-warn-soft/30 dark:text-acr-warn-soft-ink text-xs tabular-nums" aria-label={`${pending} pending`}>
                {pending}
              </Badge>
            )}
          </CardTitle>
          {pending > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 gap-1 text-xs text-muted-foreground hover:text-foreground"
              aria-label="Purge stale items (older than 7 days)"
              disabled={purgeMutation.isPending}
              onClick={() => {
                const ok = window.confirm(
                  "Mark every pending or deferred item older than 7 days as rejected? This clears stale dev/test rows but preserves history.",
                );
                if (ok) purgeMutation.mutate({ olderThanDays: 7 });
              }}
              data-testid="decisions-inbox-purge"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              Clear stale
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <CheckCircle2 className="h-10 w-10 text-acr-pos mb-2" aria-hidden="true" />
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
