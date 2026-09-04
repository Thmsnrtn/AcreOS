import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronDown, ChevronUp, Target, TrendingUp, BarChart3 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { staggerContainer, staggerItem } from "@/lib/animations";
import { useState } from "react";

interface DecisionMetrics {
  totalDecisions: number;
  approvalRate: number;
  positiveOutcomeRate: number;
  agentAccuracy: Array<{
    agent: string;
    approved: number;
    rejected: number;
    modified: number;
    outcomeQuality: number;
  }>;
  recentOutcomes: Array<{
    id: number;
    action: string;
    agent: string;
    outcome: string;
    score: number;
    date: string;
  }>;
}

export function DecisionQuality() {
  const [expanded, setExpanded] = useState(false);

  const { data, isLoading } = useQuery<DecisionMetrics>({
    queryKey: ["/api/founder/intelligence/decision-quality"],
    queryFn: async () => {
      const res = await fetch("/api/founder/intelligence/decision-quality", { credentials: "include" });
      if (!res.ok) {
        // Return defaults if endpoint not available yet
        return {
          totalDecisions: 0,
          approvalRate: 0,
          positiveOutcomeRate: 0,
          agentAccuracy: [],
          recentOutcomes: [],
        };
      }
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div role="status" aria-busy="true" aria-label="Loading decision quality">
            <Skeleton className="h-6 w-48 mb-4" />
            <div className="grid grid-cols-3 gap-4">
              <Skeleton className="h-16" />
              <Skeleton className="h-16" />
              <Skeleton className="h-16" />
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!data || data.totalDecisions === 0) return null;

  return (
    <motion.div variants={staggerContainer} initial="initial" animate="animate">
      <Card>
        <CardHeader className="pb-2 p-0">
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            aria-expanded={expanded}
            aria-label={expanded ? "Collapse decision quality details" : "Expand decision quality details"}
            className="w-full flex items-center justify-between px-6 py-4 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-card"
          >
            <span className="flex items-center gap-2">
              <Target className="h-5 w-5 text-primary" aria-hidden="true" />
              <CardTitle className="text-base">Decision quality</CardTitle>
            </span>
            {expanded ? <ChevronUp className="h-4 w-4" aria-hidden="true" /> : <ChevronDown className="h-4 w-4" aria-hidden="true" />}
          </button>
        </CardHeader>

        <CardContent>
          <motion.dl variants={staggerItem} className="grid grid-cols-3 gap-4 mb-4 m-0">
            <div className="text-center p-3 rounded-card bg-muted/50">
              <dd className="text-2xl font-bold tabular-nums m-0">{data.totalDecisions}</dd>
              <dt className="text-xs text-muted-foreground">Decisions</dt>
            </div>
            <div className="text-center p-3 rounded-card bg-muted/50">
              <dd className="text-2xl font-bold text-acr-pos tabular-nums m-0">{data.approvalRate}%</dd>
              <dt className="text-xs text-muted-foreground">Approval rate</dt>
            </div>
            <div className="text-center p-3 rounded-card bg-muted/50">
              <dd className="text-2xl font-bold text-acr-accent tabular-nums m-0">{data.positiveOutcomeRate}%</dd>
              <dt className="text-xs text-muted-foreground">Positive outcomes</dt>
            </div>
          </motion.dl>

          <AnimatePresence>
            {expanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                {data.agentAccuracy.length > 0 && (
                  <section aria-labelledby="per-agent-heading" className="mt-4">
                    <h4 id="per-agent-heading" className="text-sm font-semibold mb-2 flex items-center gap-1">
                      <BarChart3 className="h-4 w-4" aria-hidden="true" />
                      Per-agent accuracy
                    </h4>
                    <ul aria-labelledby="per-agent-heading" className="space-y-2 list-none p-0 m-0">
                      {data.agentAccuracy.map((agent) => {
                        const agentLabel = agent.agent.replace(/_/g, " ");
                        return (
                          <li
                            key={agent.agent}
                            className="flex items-center justify-between text-sm"
                            aria-label={`${agentLabel}: ${agent.approved} approved, ${agent.rejected} rejected, ${agent.modified} modified, ${agent.outcomeQuality}% quality`}
                          >
                            <span className="font-medium capitalize">{agentLabel}</span>
                            <div className="flex items-center gap-3 text-xs text-muted-foreground">
                              <span className="text-acr-pos tabular-nums">{agent.approved} approved</span>
                              <span className="text-acr-neg tabular-nums">{agent.rejected} rejected</span>
                              <span className="text-acr-warn tabular-nums">{agent.modified} modified</span>
                              <span className="font-semibold text-foreground tabular-nums">{agent.outcomeQuality}% quality</span>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                )}

                {data.recentOutcomes.length > 0 && (
                  <section aria-labelledby="recent-outcomes-heading" className="mt-4">
                    <h4 id="recent-outcomes-heading" className="text-sm font-semibold mb-2 flex items-center gap-1">
                      <TrendingUp className="h-4 w-4" aria-hidden="true" />
                      Recent outcomes
                    </h4>
                    <ul aria-labelledby="recent-outcomes-heading" className="space-y-1 list-none p-0 m-0">
                      {data.recentOutcomes.slice(0, 5).map((outcome) => {
                        const action = outcome.action.replace(/_/g, " ");
                        const sign = outcome.score > 0 ? "+" : "";
                        return (
                          <li
                            key={outcome.id}
                            className="flex items-center justify-between text-sm py-1"
                            aria-label={`${action}: score ${sign}${outcome.score}`}
                          >
                            <span>{action}</span>
                            <span className={`text-xs px-2 py-0.5 rounded-full tabular-nums ${
                              outcome.score > 0 ? "bg-acr-pos-soft text-acr-pos-soft-ink" :
                              outcome.score < 0 ? "bg-acr-neg-soft text-acr-neg-soft-ink" :
                              "bg-muted text-foreground"
                            }`}>
                              {sign}{outcome.score}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </CardContent>
      </Card>
    </motion.div>
  );
}
