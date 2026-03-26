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
          <Skeleton className="h-6 w-48 mb-4" />
          <div className="grid grid-cols-3 gap-4">
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!data || data.totalDecisions === 0) return null;

  return (
    <motion.div variants={staggerContainer} initial="initial" animate="animate">
      <Card>
        <CardHeader
          className="cursor-pointer flex flex-row items-center justify-between pb-2"
          onClick={() => setExpanded(!expanded)}
        >
          <div className="flex items-center gap-2">
            <Target className="h-5 w-5 text-primary" />
            <CardTitle className="text-base">Decision Quality</CardTitle>
          </div>
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </CardHeader>

        <CardContent>
          <motion.div variants={staggerItem} className="grid grid-cols-3 gap-4 mb-4">
            <div className="text-center p-3 rounded-lg bg-muted/50">
              <p className="text-2xl font-bold">{data.totalDecisions}</p>
              <p className="text-xs text-muted-foreground">Decisions</p>
            </div>
            <div className="text-center p-3 rounded-lg bg-muted/50">
              <p className="text-2xl font-bold text-emerald-600">{data.approvalRate}%</p>
              <p className="text-xs text-muted-foreground">Approval Rate</p>
            </div>
            <div className="text-center p-3 rounded-lg bg-muted/50">
              <p className="text-2xl font-bold text-blue-600">{data.positiveOutcomeRate}%</p>
              <p className="text-xs text-muted-foreground">Positive Outcomes</p>
            </div>
          </motion.div>

          <AnimatePresence>
            {expanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                {data.agentAccuracy.length > 0 && (
                  <div className="mt-4">
                    <h4 className="text-sm font-semibold mb-2 flex items-center gap-1">
                      <BarChart3 className="h-4 w-4" />
                      Per-Agent Accuracy
                    </h4>
                    <div className="space-y-2">
                      {data.agentAccuracy.map((agent) => (
                        <div key={agent.agent} className="flex items-center justify-between text-sm">
                          <span className="font-medium capitalize">{agent.agent.replace(/_/g, " ")}</span>
                          <div className="flex items-center gap-3 text-xs text-muted-foreground">
                            <span className="text-emerald-600">{agent.approved} approved</span>
                            <span className="text-red-500">{agent.rejected} rejected</span>
                            <span className="text-amber-500">{agent.modified} modified</span>
                            <span className="font-semibold text-foreground">{agent.outcomeQuality}% quality</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {data.recentOutcomes.length > 0 && (
                  <div className="mt-4">
                    <h4 className="text-sm font-semibold mb-2 flex items-center gap-1">
                      <TrendingUp className="h-4 w-4" />
                      Recent Outcomes
                    </h4>
                    <div className="space-y-1">
                      {data.recentOutcomes.slice(0, 5).map((outcome) => (
                        <div key={outcome.id} className="flex items-center justify-between text-sm py-1">
                          <span>{outcome.action.replace(/_/g, " ")}</span>
                          <span className={`text-xs px-2 py-0.5 rounded-full ${
                            outcome.score > 0 ? "bg-emerald-100 text-emerald-700" :
                            outcome.score < 0 ? "bg-red-100 text-red-700" :
                            "bg-gray-100 text-gray-700"
                          }`}>
                            {outcome.score > 0 ? "+" : ""}{outcome.score}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </CardContent>
      </Card>
    </motion.div>
  );
}
