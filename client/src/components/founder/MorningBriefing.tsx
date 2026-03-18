/**
 * Morning Briefing — Sovereign Company Protocol v3
 *
 * The CEO's one-screen morning summary. Apple Health-style card stack
 * where each agent "speaks" their update in character.
 *
 * Philosophy: 30 seconds to understand everything.
 * No charts, no tables, no metrics — just your team talking to you.
 */

import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckCircle2, AlertTriangle, Clock } from "lucide-react";
import { staggerContainer, staggerItem, fadeInUp } from "@/lib/animations";
import {
  AGENT_AVATARS,
  AGENT_ROLES,
  AGENT_COLORS,
} from "@/lib/trust-language";
import { PullToRefresh } from "@/components/mobile/PullToRefresh";

interface AgentUpdate {
  agent: string;
  role: string;
  message: string;
  hasActivity: boolean;
}

interface TrustUpdate {
  agent: string;
  message: string;
}

interface BriefingData {
  greeting: string;
  headline: string;
  healthScore: number;
  allClear: boolean;
  agentUpdates: AgentUpdate[];
  pendingDecisions: number;
  trustUpdates: TrustUpdate[];
  generatedAt: string;
}

const AGENT_BG_CLASSES: Record<string, string> = {
  blue: "bg-blue-50/50 dark:bg-blue-950/20 border-blue-100 dark:border-blue-900/30",
  emerald: "bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-100 dark:border-emerald-900/30",
  amber: "bg-amber-50/50 dark:bg-amber-950/20 border-amber-100 dark:border-amber-900/30",
  purple: "bg-purple-50/50 dark:bg-purple-950/20 border-purple-100 dark:border-purple-900/30",
  red: "bg-red-50/50 dark:bg-red-950/20 border-red-100 dark:border-red-900/30",
  slate: "bg-slate-50/50 dark:bg-slate-950/20 border-slate-100 dark:border-slate-900/30",
  indigo: "bg-indigo-50/50 dark:bg-indigo-950/20 border-indigo-100 dark:border-indigo-900/30",
  cyan: "bg-cyan-50/50 dark:bg-cyan-950/20 border-cyan-100 dark:border-cyan-900/30",
  orange: "bg-orange-50/50 dark:bg-orange-950/20 border-orange-100 dark:border-orange-900/30",
  pink: "bg-pink-50/50 dark:bg-pink-950/20 border-pink-100 dark:border-pink-900/30",
};

function HealthRing({ score }: { score: number }) {
  const circumference = 2 * Math.PI * 36;
  const filled = (score / 100) * circumference;
  const color = score >= 80 ? "#22c55e" : score >= 60 ? "#f59e0b" : "#ef4444";

  return (
    <div className="relative w-20 h-20 shrink-0">
      <svg viewBox="0 0 80 80" className="w-full h-full -rotate-90">
        <circle cx="40" cy="40" r="36" fill="none" stroke="currentColor" strokeWidth="4" className="text-muted/20" />
        <motion.circle
          cx="40" cy="40" r="36" fill="none"
          stroke={color}
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: circumference - filled }}
          transition={{ duration: 1, ease: "easeOut", delay: 0.3 }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-lg font-semibold text-foreground">{score}</span>
      </div>
    </div>
  );
}

function AgentUpdateCard({ update }: { update: AgentUpdate }) {
  const avatar = AGENT_AVATARS[update.agent] || "🤖";
  const color = AGENT_COLORS[update.agent] || "slate";
  const bgClass = AGENT_BG_CLASSES[color] || AGENT_BG_CLASSES.slate;

  return (
    <motion.div variants={staggerItem}>
      <Card className={`border ${bgClass} shadow-none`}>
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <span className="text-xl mt-0.5" role="img">{avatar}</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-foreground">
                  {AGENT_ROLES[update.agent] || update.role}
                </span>
                {update.hasActivity && (
                  <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
                )}
              </div>
              <p className="text-sm text-foreground/80 leading-relaxed mt-1">
                {update.message}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

export function MorningBriefing() {
  const { data, isLoading, refetch } = useQuery<BriefingData>({
    queryKey: ["/api/founder/intelligence/morning-briefing"],
    refetchInterval: 60000, // Refresh every minute
    refetchIntervalInBackground: false,
  });

  const handleRefresh = useCallback(async () => {
    await refetch();
  }, [refetch]);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 rounded-xl" />
        <div className="space-y-3">
          {[0, 1, 2, 3, 4].map(i => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <PullToRefresh onRefresh={handleRefresh}>
    <motion.div
      variants={staggerContainer}
      initial="hidden"
      animate="visible"
      className="space-y-4"
    >
      {/* Greeting + Health Ring */}
      <motion.div variants={fadeInUp}>
        <Card className="bg-gradient-to-br from-card to-background border shadow-sm">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <h1 className="text-xl font-semibold text-foreground tracking-tight">
                  {data.greeting}
                </h1>
                <p className="text-sm text-foreground/70 mt-1 leading-relaxed">
                  {data.headline}
                </p>
                {data.pendingDecisions > 0 && (
                  <div className="flex items-center gap-2 mt-3">
                    <Badge className="bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300">
                      {data.pendingDecisions} decision{data.pendingDecisions > 1 ? "s" : ""} pending
                    </Badge>
                  </div>
                )}
              </div>
              <HealthRing score={data.healthScore} />
            </div>

            {data.allClear && (
              <div className="flex items-center gap-2 mt-4 pt-3 border-t border-border/50">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                <span className="text-xs text-green-700 dark:text-green-400 font-medium">
                  All systems nominal. Your team is handling everything.
                </span>
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>

      {/* Trust promotions (if any) */}
      <AnimatePresence>
        {data.trustUpdates.length > 0 && (
          <motion.div
            variants={staggerItem}
            className="space-y-2"
          >
            {data.trustUpdates.map((update, i) => (
              <Card key={i} className="border-amber-200 bg-amber-50/50 dark:border-amber-900/30 dark:bg-amber-950/20">
                <CardContent className="p-3 flex items-center gap-3">
                  <span className="text-lg">{AGENT_AVATARS[update.agent] || "⭐"}</span>
                  <p className="text-sm text-amber-800 dark:text-amber-300">{update.message}</p>
                </CardContent>
              </Card>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Agent Update Cards */}
      <motion.div variants={staggerContainer} className="space-y-2">
        {data.agentUpdates.map((update) => (
          <AgentUpdateCard key={update.agent} update={update} />
        ))}
      </motion.div>

      {/* Generated timestamp */}
      <motion.div variants={staggerItem} className="flex items-center justify-center gap-1.5 py-1">
        <Clock className="h-3 w-3 text-muted-foreground/40" />
        <span className="text-[10px] text-muted-foreground/40">
          Last updated {new Date(data.generatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </span>
      </motion.div>
    </motion.div>
    </PullToRefresh>
  );
}
