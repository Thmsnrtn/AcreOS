/**
 * /founder/readiness — Launch readiness checklist (extracted from
 * founder-dashboard.tsx).
 *
 * Per docs/exhaustive-completion/founder-dashboard-extraction-queue.md
 * Extraction #2. Pure move; no behavior change. Preserves the
 * /api/founder/launch-readiness query key + the
 * "founder-readiness-dismissed" localStorage key.
 *
 * Daily-during-launch surface — earns its own focused route.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertOctagon, Zap, Rocket, Sparkles,
  Loader2, ListChecks, Check, X, CircleDot,
  ChevronRight, RefreshCw, ArrowRight,
} from "lucide-react";

import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useDocumentTitle } from "@/hooks/use-document-title";

interface ReadinessItem {
  key: string;
  label: string;
  description: string;
  priority: "critical" | "core" | "launch" | "growth";
  status: "complete" | "incomplete" | "blocked";
  section: string;
  helpText?: string;
}

interface LaunchReadiness {
  score: number;
  items: ReadinessItem[];
}

const PRIORITY_CONFIG = {
  critical: {
    label: "Critical",
    color: "text-acr-neg",
    bg: "bg-acr-neg/10 border-acr-neg/20",
    badgeClass: "bg-acr-neg/10 text-acr-neg border-acr-neg/20",
    icon: AlertOctagon,
  },
  core: {
    label: "Core Features",
    color: "text-acr-warn",
    bg: "bg-acr-warn/10 border-acr-warn/20",
    badgeClass: "bg-acr-warn/10 text-acr-warn border-acr-warn/20",
    icon: Zap,
  },
  launch: {
    label: "Launch Ready",
    color: "text-acr-accent",
    bg: "bg-acr-accent/10 border-acr-accent/20",
    badgeClass: "bg-acr-accent/10 text-acr-accent border-acr-accent/20",
    icon: Rocket,
  },
  growth: {
    label: "Growth",
    color: "text-acr-brand",
    bg: "bg-acr-brand/10 border-acr-brand/20",
    badgeClass: "bg-acr-brand/10 text-acr-brand border-acr-brand/20",
    icon: Sparkles,
  },
} as const;

export default function FounderReadinessPage() {
  useDocumentTitle("Launch readiness — AcreOS");
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem("founder-readiness-dismissed") === "true"; } catch { return false; }
  });
  const [expanded, setExpanded] = useState(true);

  const { data, isLoading, refetch } = useQuery<LaunchReadiness>({
    queryKey: ["/api/founder/launch-readiness"],
    refetchInterval: 10 * 60_000,
  });

  const scrollToSection = (sectionId: string) => {
    const el = document.getElementById(sectionId);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const dismiss = () => {
    try { localStorage.setItem("founder-readiness-dismissed", "true"); } catch {}
    setDismissed(true);
  };

  const score = data?.score ?? 0;
  const isLive = score >= 80;
  const grouped = (data?.items ?? []).reduce<Record<string, ReadinessItem[]>>((acc, item) => {
    (acc[item.priority] ??= []).push(item);
    return acc;
  }, {});
  const incompleteCount = (data?.items ?? []).filter(i => i.status === "incomplete").length;
  const criticalIncomplete = (data?.items ?? []).filter(i => i.priority === "critical" && i.status === "incomplete").length;

  return (
    <PageShell label="Launch readiness">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <ListChecks className="w-6 h-6 text-primary" aria-hidden="true" />
          Launch readiness
        </h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          Interactive checklist of everything needed to accept paying customers.
          Auto-refreshes every 10 minutes; tap an open item to jump to the
          relevant dashboard section.
        </p>
      </div>

      {dismissed && (data?.score ?? 0) >= 100 ? (
        <div className="p-6 border rounded-xl bg-acr-pos/5 border-acr-pos/20">
          <p className="text-sm">
            Launch readiness complete (dismissed). Click <button
              className="text-primary underline"
              onClick={() => { try { localStorage.removeItem("founder-readiness-dismissed"); } catch {}; setDismissed(false); }}
            >re-show</button> to see the full checklist.
          </p>
        </div>
      ) : (
        <div className="mt-4">
          {/* Header bar */}
          <div
            className={`flex items-center gap-3 p-4 rounded-xl border cursor-pointer transition-all ${
              isLive
                ? "bg-acr-pos/5 border-acr-pos/30"
                : criticalIncomplete > 0
                ? "bg-acr-neg/5 border-acr-neg/30"
                : "bg-acr-warn/5 border-acr-warn/30"
            }`}
            onClick={() => setExpanded(e => !e)}
          >
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
              isLive ? "bg-acr-pos/20" : criticalIncomplete > 0 ? "bg-acr-neg/20" : "bg-acr-warn/20"
            }`}>
              {isLoading ? (
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              ) : isLive ? (
                <Rocket className={`w-5 h-5 text-acr-pos`} />
              ) : (
                <ListChecks className={`w-5 h-5 ${criticalIncomplete > 0 ? "text-acr-neg" : "text-acr-warn"}`} />
              )}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-sm">
                  {isLive ? "AcreOS is live-ready" : "App Launch Checklist"}
                </span>
                {!isLoading && (
                  <Badge
                    className={`text-xs ${
                      isLive
                        ? "bg-acr-pos/10 text-acr-pos border-acr-pos/20"
                        : criticalIncomplete > 0
                        ? "bg-acr-neg/10 text-acr-neg border-acr-neg/20"
                        : "bg-acr-warn/10 text-acr-warn border-acr-warn/20"
                    }`}
                  >
                    {score}% ready
                  </Badge>
                )}
                {incompleteCount > 0 && (
                  <span className="text-xs text-muted-foreground">{incompleteCount} item{incompleteCount !== 1 ? "s" : ""} remaining</span>
                )}
              </div>

              {!isLoading && (
                <div className="mt-1.5 h-1.5 bg-muted rounded-full overflow-hidden w-full max-w-sm">
                  <div
                    className={`h-full rounded-full transition-all duration-700 ${
                      isLive ? "bg-acr-pos" : criticalIncomplete > 0 ? "bg-acr-neg" : "bg-acr-warn"
                    }`}
                    style={{ width: `${score}%` }}
                  />
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <Button aria-label="Refresh"
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                onClick={(e) => { e.stopPropagation(); refetch(); }}
              >
                <RefreshCw className="w-3 h-3" />
              </Button>
              {isLive && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs text-muted-foreground"
                  onClick={(e) => { e.stopPropagation(); dismiss(); }}
                >
                  Dismiss
                </Button>
              )}
              <ChevronRight
                className={`w-4 h-4 text-muted-foreground transition-transform ${expanded ? "rotate-90" : ""}`}
              />
            </div>
          </div>

          {expanded && (
            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
              {(["critical", "core", "launch", "growth"] as const).map((priority) => {
                const items = grouped[priority] ?? [];
                if (items.length === 0) return null;
                const cfg = PRIORITY_CONFIG[priority];
                const PriorityIcon = cfg.icon;
                const allDone = items.every(i => i.status === "complete");

                return (
                  <div key={priority} className={`p-4 rounded-xl border ${allDone ? "bg-muted/30 border-border/50" : cfg.bg}`}>
                    <div className="flex items-center gap-2 mb-3">
                      <PriorityIcon className={`w-4 h-4 ${allDone ? "text-acr-pos" : cfg.color}`} />
                      <span className={`text-xs font-semibold uppercase tracking-wide ${allDone ? "text-acr-pos" : cfg.color}`}>
                        {cfg.label}
                      </span>
                      {allDone && (
                        <Badge className="ml-auto text-xs bg-acr-pos/10 text-acr-pos border-acr-pos/20">All done</Badge>
                      )}
                    </div>

                    <div className="space-y-2">
                      {items.map((item) => {
                        const done = item.status === "complete";
                        return (
                          <div key={item.key} className={`flex items-start gap-2.5 p-2.5 rounded-lg transition-colors ${done ? "" : "hover:bg-background/60 cursor-pointer"}`}
                            onClick={() => !done && scrollToSection(item.section)}>
                            <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                              done ? "bg-acr-pos" : item.status === "blocked" ? "bg-muted" : "bg-background border-2 border-muted-foreground/30"
                            }`}>
                              {done ? (
                                <Check className="w-3 h-3 text-white" />
                              ) : item.status === "blocked" ? (
                                <X className="w-3 h-3 text-muted-foreground" />
                              ) : (
                                <CircleDot className="w-2.5 h-2.5 text-muted-foreground/50" />
                              )}
                            </div>

                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className={`text-sm font-medium ${done ? "text-muted-foreground line-through" : ""}`}>
                                  {item.label}
                                </span>
                                {!done && (
                                  <ArrowRight className="w-3 h-3 text-muted-foreground shrink-0" />
                                )}
                              </div>
                              {!done && (
                                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                                  {item.helpText || item.description}
                                </p>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </PageShell>
  );
}
