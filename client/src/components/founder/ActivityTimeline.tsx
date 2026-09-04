// @ts-nocheck
/**
 * Activity Timeline — Sovereign Company Protocol v4
 *
 * Shows what agents did in chronological order. Groups by time blocks
 * ("Overnight", "This Morning", "Yesterday"). Each entry shows the agent,
 * what they did, the outcome, and an undo button if available.
 *
 * CEO-facing: builds trust by showing exactly what happened.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Clock, CheckCircle, XCircle, Undo2, ChevronDown, ChevronUp } from "lucide-react";
import { agentBgClass, getAgentIdentity } from "@/lib/agent-identity";

function getTimeBlock(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffHours = (now.getTime() - date.getTime()) / (1000 * 60 * 60);

  if (diffHours < 1) return "Just now";
  if (date.getHours() < 7 && diffHours < 24) return "Overnight";
  if (date.toDateString() === now.toDateString()) return "Today";
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString("en-US", { weekday: "long" });
}

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export default function ActivityTimeline() {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const queryClient = useQueryClient();

  const { data: timeline, isLoading } = useQuery({
    queryKey: ["/api/founder/intelligence/activity-timeline"],
    refetchInterval: 60000, // Refresh every minute
  });

  const undoMutation = useMutation({
    mutationFn: async (actionLogId: number) => {
      const res = await fetch(`/api/founder/intelligence/undo/${actionLogId}`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Undo failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/founder/intelligence/activity-timeline"] });
    },
  });

  const entries = (timeline as any)?.entries || [];

  // Group by time block
  const groups = new Map<string, any[]>();
  for (const entry of entries) {
    const block = getTimeBlock(entry.createdAt);
    if (!groups.has(block)) groups.set(block, []);
    groups.get(block)!.push(entry);
  }

  if (isLoading) {
    return (
      <div role="status" aria-busy="true" aria-label="Loading activity timeline" className="p-4 space-y-3">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-16 bg-acr-bg-sunken/50 rounded-card animate-pulse" />
        ))}
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="p-6 text-center text-muted-foreground">
        <Clock className="w-8 h-8 mx-auto mb-2 opacity-50" aria-hidden="true" />
        <p className="text-sm">No agent activity yet. Your team is standing by.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {Array.from(groups.entries()).map(([block, blockEntries]) => {
        const blockId = `timeline-block-${block.replace(/\s+/g, "-").toLowerCase()}`;
        return (
          <section key={block} aria-labelledby={blockId}>
            <h3 id={blockId} className="text-xs font-medium text-muted-foreground uppercase tracking-wide px-4 mb-2">
              {block}
            </h3>
            <ul aria-labelledby={blockId} className="space-y-1 list-none p-0 m-0">
              {blockEntries.map((entry: any) => {
                const isExpanded = expanded.has(entry.id);
                const identity = getAgentIdentity(entry.agentCodename);
                const agentName = identity.friendlyName !== "Unknown" ? identity.friendlyName : entry.agentCodename;
                const agentDotClass = agentBgClass(entry.agentCodename);
                const action = entry.humanReadable || entry.actionName.replace(/_/g, " ");
                const outcomeText = entry.outcome === "success" ? "succeeded" : entry.outcome === "failure" ? "failed" : "pending";

                return (
                  <li
                    key={entry.id}
                    className="mx-2 rounded-card bg-acr-bg-sunken/40 border border-border/50 overflow-hidden"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        const next = new Set(expanded);
                        if (isExpanded) next.delete(entry.id);
                        else next.add(entry.id);
                        setExpanded(next);
                      }}
                      aria-expanded={isExpanded}
                      aria-label={`${agentName}: ${action}, ${outcomeText} at ${formatTime(entry.createdAt)}`}
                      className="w-full flex items-center gap-3 p-3 text-left hover:bg-acr-bg-sunken/30 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {/* Agent letter mark — design-system §1.3. Soft tint
                          matches the agent's tone via the consolidated
                          identity registry. */}
                      <div
                        aria-hidden="true"
                        className={`w-5 h-5 rounded-full flex-shrink-0 flex items-center justify-center text-micro font-semibold ${agentDotClass}`}
                      >
                        {identity.letter}
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-muted-foreground truncate">
                          <span className="font-medium" style={{ color: agentColor }}>
                            {agentName}
                          </span>
                          {" "}
                          {action}
                        </p>
                        <time dateTime={entry.createdAt} className="text-xs text-muted-foreground mt-0.5 block tabular-nums">
                          {formatTime(entry.createdAt)}
                        </time>
                      </div>

                      {/* Outcome badge */}
                      {entry.outcome === "success" ? (
                        <CheckCircle className="w-4 h-4 text-acr-pos flex-shrink-0" aria-hidden="true" />
                      ) : entry.outcome === "failure" ? (
                        <XCircle className="w-4 h-4 text-acr-neg flex-shrink-0" aria-hidden="true" />
                      ) : (
                        <Clock className="w-4 h-4 text-acr-warn flex-shrink-0" aria-hidden="true" />
                      )}

                      {isExpanded ? (
                        <ChevronUp className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
                      ) : (
                        <ChevronDown className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
                      )}
                    </button>

                    {isExpanded && (
                      <div className="px-3 pb-3 pt-1 border-t border-border/30">
                        <p className="text-xs text-muted-foreground mb-2">
                          {entry.detail || "No additional details."}
                        </p>

                        {entry.verification && (
                          <div className={`text-xs px-2 py-1 rounded mb-2 ${
                            entry.verification.success
                              ? "bg-acr-pos-soft/30 text-acr-pos-soft-ink"
                              : "bg-acr-neg-soft/30 text-acr-neg-soft-ink"
                          }`}>
                            Outcome: {entry.verification.detail}
                          </div>
                        )}

                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">
                            {entry.triggeredBy === "reaction" ? "Auto-triggered" : entry.triggeredBy === "approval" ? "CEO-approved" : "Proactive"}
                          </span>

                          {entry.undoAvailable && !entry.undoExpired && !entry.undoExecuted && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                undoMutation.mutate(entry.id);
                              }}
                              disabled={undoMutation.isPending}
                              aria-busy={undoMutation.isPending}
                              aria-label={`Undo ${agentName}: ${action}`}
                              className="ml-auto flex items-center gap-1 text-xs px-2 py-1 rounded bg-acr-bg-sunken hover:bg-muted text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              <Undo2 className="w-3 h-3" aria-hidden="true" />
                              {undoMutation.isPending ? "Undoing…" : "Undo"}
                            </button>
                          )}

                          {entry.undoExecuted && (
                            <span className="ml-auto text-xs text-muted-foreground">Undone</span>
                          )}
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
