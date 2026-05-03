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
  blue: "bg-acr-accent/50 dark:bg-acr-accent/20 border-acr-accent dark:border-acr-accent/30",
  emerald: "bg-acr-pos-soft/50 dark:bg-acr-pos-soft/20 border-acr-pos-soft dark:border-acr-pos-soft/30",
  amber: "bg-acr-warn-soft/50 dark:bg-acr-warn-soft/20 border-acr-warn-soft dark:border-acr-warn-soft/30",
  purple: "bg-acr-brand-soft/50 dark:bg-acr-brand-soft/20 border-acr-brand-soft dark:border-acr-brand-soft/30",
  red: "bg-acr-neg-soft/50 dark:bg-acr-neg-soft/20 border-acr-neg-soft dark:border-acr-neg-soft/30",
  slate: "bg-muted/50 dark:bg-acr-bg-sunken/20 border-border dark:border-border/30",
  indigo: "bg-acr-accent/50 dark:bg-acr-accent/20 border-acr-accent dark:border-acr-accent/30",
  cyan: "bg-acr-accent/50 dark:bg-acr-accent/20 border-acr-accent dark:border-acr-accent/30",
  orange: "bg-acr-warn-soft/50 dark:bg-acr-warn-soft/20 border-acr-warn-soft dark:border-acr-warn-soft/30",
  pink: "bg-acr-brand-soft/50 dark:bg-acr-brand-soft/20 border-acr-brand-soft dark:border-acr-brand-soft/30",
};

function HealthRing({ score }: { score: number }) {
  const circumference = 2 * Math.PI * 36;
  const filled = (score / 100) * circumference;
  const color = score >= 80 ? "#22c55e" : score >= 60 ? "#f59e0b" : "#ef4444";

  return (
    <div
      role="progressbar"
      aria-label={`Health score: ${score} out of 100`}
      aria-valuenow={score}
      aria-valuemin={0}
      aria-valuemax={100}
      className="relative w-20 h-20 shrink-0"
    >
      <svg viewBox="0 0 80 80" className="w-full h-full -rotate-90" aria-hidden="true">
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
      <div className="absolute inset-0 flex items-center justify-center" aria-hidden="true">
        <span className="text-lg font-semibold text-foreground tabular-nums">{score}</span>
      </div>
    </div>
  );
}

function AgentUpdateCard({ update }: { update: AgentUpdate }) {
  const avatar = AGENT_AVATARS[update.agent] || "🤖";
  const color = AGENT_COLORS[update.agent] || "slate";
  const bgClass = AGENT_BG_CLASSES[color] || AGENT_BG_CLASSES.slate;

  return (
    <motion.li variants={staggerItem} className="list-none">
      <Card className={`border ${bgClass} shadow-none`}>
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <span aria-hidden="true" className="text-xl mt-0.5">{avatar}</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-foreground">
                  {AGENT_ROLES[update.agent] || update.role}
                </span>
                {update.hasActivity && (
                  <span aria-label="Active" className="h-1.5 w-1.5 rounded-full bg-acr-pos animate-pulse" role="status" />
                )}
              </div>
              <p className="text-sm text-foreground/80 leading-relaxed mt-1">
                {update.message}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.li>
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
      <div role="status" aria-busy="true" aria-label="Loading morning briefing" className="space-y-4">
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
                    <Badge className="bg-acr-warn-soft text-acr-warn dark:bg-acr-warn-soft/30 dark:text-acr-warn tabular-nums" aria-label={`${data.pendingDecisions} pending decision${data.pendingDecisions > 1 ? "s" : ""}`}>
                      {data.pendingDecisions} decision{data.pendingDecisions > 1 ? "s" : ""} pending
                    </Badge>
                  </div>
                )}
              </div>
              <HealthRing score={data.healthScore} />
            </div>

            {data.allClear && (
              <div role="status" className="flex items-center gap-2 mt-4 pt-3 border-t border-border/50">
                <CheckCircle2 className="h-4 w-4 text-acr-pos" aria-hidden="true" />
                <span className="text-xs text-acr-pos dark:text-acr-pos font-medium">
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
          <motion.ul
            aria-label="Trust updates"
            variants={staggerItem}
            className="space-y-2 list-none p-0 m-0"
          >
            {data.trustUpdates.map((update, i) => (
              <li key={i}>
                <Card className="border-acr-warn-soft bg-acr-warn-soft/50 dark:border-acr-warn-soft/30 dark:bg-acr-warn-soft/20">
                  <CardContent className="p-3 flex items-center gap-3">
                    <span aria-hidden="true" className="text-lg">{AGENT_AVATARS[update.agent] || "⭐"}</span>
                    <p className="text-sm text-acr-warn dark:text-acr-warn">{update.message}</p>
                  </CardContent>
                </Card>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>

      {/* Agent Update Cards */}
      <motion.ul aria-label="Agent updates" variants={staggerContainer} className="space-y-2 list-none p-0 m-0">
        {data.agentUpdates.map((update) => (
          <AgentUpdateCard key={update.agent} update={update} />
        ))}
      </motion.ul>

      {/* Generated timestamp */}
      <motion.div variants={staggerItem} className="flex items-center justify-center gap-1.5 py-1">
        <Clock className="h-3 w-3 text-muted-foreground/40" aria-hidden="true" />
        <span className="text-[10px] text-muted-foreground/40">
          Last updated <time dateTime={data.generatedAt} className="tabular-nums">{new Date(data.generatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
        </span>
      </motion.div>
    </motion.div>
    </PullToRefresh>
  );
}
