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

const AGENT_COLORS: Record<string, string> = {
  sophie_csm: "#E879A8",
  forge_revenue: "#F59E0B",
  sentinel_devops: "#3B82F6",
  atlas_cto: "#8B5CF6",
  beacon_marketing: "#10B981",
  ledger_finance: "#6366F1",
  oracle_analytics: "#EC4899",
  compass_pm: "#14B8A6",
  shield_legal: "#F97316",
  crucible_qa: "#EF4444",
};

const AGENT_NAMES: Record<string, string> = {
  sophie_csm: "Sophie",
  forge_revenue: "Forge",
  sentinel_devops: "Sentinel",
  atlas_cto: "Atlas",
  beacon_marketing: "Beacon",
  ledger_finance: "Ledger",
  oracle_analytics: "Oracle",
  compass_pm: "Compass",
  shield_legal: "Shield",
  crucible_qa: "Crucible",
};

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
          <div key={i} className="h-16 bg-gray-800/50 rounded-lg animate-pulse" />
        ))}
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="p-6 text-center text-gray-400">
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
            <h3 id={blockId} className="text-xs font-medium text-gray-500 uppercase tracking-wide px-4 mb-2">
              {block}
            </h3>
            <ul aria-labelledby={blockId} className="space-y-1 list-none p-0 m-0">
              {blockEntries.map((entry: any) => {
                const isExpanded = expanded.has(entry.id);
                const agentName = AGENT_NAMES[entry.agentCodename] || entry.agentCodename;
                const agentColor = AGENT_COLORS[entry.agentCodename] || "#6B7280";
                const action = entry.humanReadable || entry.actionName.replace(/_/g, " ");
                const outcomeText = entry.outcome === "success" ? "succeeded" : entry.outcome === "failure" ? "failed" : "pending";

                return (
                  <li
                    key={entry.id}
                    className="mx-2 rounded-lg bg-gray-800/40 border border-gray-700/50 overflow-hidden"
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
                      className="w-full flex items-center gap-3 p-3 text-left hover:bg-gray-700/30 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {/* Agent dot */}
                      <div
                        aria-hidden="true"
                        className="w-2 h-2 rounded-full flex-shrink-0"
                        style={{ backgroundColor: agentColor }}
                      />

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-200 truncate">
                          <span className="font-medium" style={{ color: agentColor }}>
                            {agentName}
                          </span>
                          {" "}
                          {action}
                        </p>
                        <time dateTime={entry.createdAt} className="text-xs text-gray-500 mt-0.5 block tabular-nums">
                          {formatTime(entry.createdAt)}
                        </time>
                      </div>

                      {/* Outcome badge */}
                      {entry.outcome === "success" ? (
                        <CheckCircle className="w-4 h-4 text-emerald-400 flex-shrink-0" aria-hidden="true" />
                      ) : entry.outcome === "failure" ? (
                        <XCircle className="w-4 h-4 text-red-400 flex-shrink-0" aria-hidden="true" />
                      ) : (
                        <Clock className="w-4 h-4 text-yellow-400 flex-shrink-0" aria-hidden="true" />
                      )}

                      {isExpanded ? (
                        <ChevronUp className="w-4 h-4 text-gray-500" aria-hidden="true" />
                      ) : (
                        <ChevronDown className="w-4 h-4 text-gray-500" aria-hidden="true" />
                      )}
                    </button>

                    {isExpanded && (
                      <div className="px-3 pb-3 pt-1 border-t border-gray-700/30">
                        <p className="text-xs text-gray-400 mb-2">
                          {entry.detail || "No additional details."}
                        </p>

                        {entry.verification && (
                          <div className={`text-xs px-2 py-1 rounded mb-2 ${
                            entry.verification.success
                              ? "bg-emerald-900/30 text-emerald-400"
                              : "bg-red-900/30 text-red-400"
                          }`}>
                            Outcome: {entry.verification.detail}
                          </div>
                        )}

                        <div className="flex items-center gap-2">
                          <span className="text-xs text-gray-500">
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
                              className="ml-auto flex items-center gap-1 text-xs px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              <Undo2 className="w-3 h-3" aria-hidden="true" />
                              {undoMutation.isPending ? "Undoing…" : "Undo"}
                            </button>
                          )}

                          {entry.undoExecuted && (
                            <span className="ml-auto text-xs text-gray-500">Undone</span>
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
