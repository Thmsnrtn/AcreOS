import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ContentReveal } from "@/components/ContentReveal";
import { ClearedEmpty } from "@/components/empty-states";
import {
  CheckCircle2,
  Sparkles,
  Zap,
  AlertTriangle,
  Bell,
  GitBranch,
  ArrowRight,
} from "lucide-react";

// Priority → semantic --acr-* tone (carried from today.tsx).
const priorityColors: Record<string, string> = {
  high: "bg-acr-neg-soft text-acr-neg border-transparent",
  medium: "bg-acr-warn-soft text-acr-warn border-transparent",
  low: "bg-acr-brand-soft text-acr-brand border-transparent",
};

export type DecisionSource =
  | "pax-priority"
  | "pax-suggests"
  | "pax-noticed"
  | "ai-queue"
  | "portfolio-alert";

const sourcePillStyles: Record<DecisionSource, string> = {
  "pax-priority": "bg-acr-brand-soft text-acr-brand",
  "pax-suggests": "bg-acr-pos-soft text-acr-pos",
  "pax-noticed": "bg-acr-brand-soft text-acr-brand",
  "ai-queue": "bg-primary/10 text-primary",
  "portfolio-alert": "bg-acr-warn-soft text-acr-warn",
};

const sourcePillLabel: Record<DecisionSource, string> = {
  "pax-priority": "Pax priority",
  "pax-suggests": "Pax suggests",
  "pax-noticed": "Pax noticed",
  "ai-queue": "AI queue",
  "portfolio-alert": "Alert",
};

const sourceIcon: Record<DecisionSource, React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>> = {
  "pax-priority": Zap,
  "pax-suggests": Sparkles,
  "pax-noticed": Sparkles,
  "ai-queue": GitBranch,
  "portfolio-alert": AlertTriangle,
};

export interface DecisionItem {
  id: string;
  source: DecisionSource;
  priority: "high" | "medium" | "low";
  title: string;
  description: string;
  actionLabel: string;
  actionUrl: string;
  rank: number; // for sort; lower = higher priority
  // Optional Pax model-confidence (0..1). Only set for Pax-sourced rows;
  // rendered as a 4th chip on the row when present so the founder can
  // see how strongly Pax stands behind the suggestion (restored after
  // d21c5fc8 collapsed the per-section view into the unified queue).
  confidence?: number | null;
}

interface DecisionQueueProps {
  items: DecisionItem[];
  isLoading: boolean;
}

// Provenance-pill decision list. Replaces the old Start-here / Today's
// actions / Pax suggests / Pax noticed / AI action queue / Portfolio
// alerts stack — one prioritized list, source on a pill.
export function DecisionQueue({ items, isLoading }: DecisionQueueProps) {
  const sorted = [...items].sort((a, b) => a.rank - b.rank);

  return (
    <div data-testid="section-decision-queue">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-acr-brand" aria-hidden="true" />
          <h2 className="acr-section-h2">Decision queue</h2>
          {sorted.length > 0 && (
            <Badge variant="secondary" className="bg-acr-brand-soft text-acr-brand border-transparent text-xs tabular-nums">
              {sorted.length}
            </Badge>
          )}
        </div>
        <Button asChild variant="ghost" size="sm" className="gap-1 text-xs">
          <Link href="/decision-queue">
            View all <ArrowRight className="w-3 h-3" aria-hidden="true" />
          </Link>
        </Button>
      </div>

      <ContentReveal
        ready={!isLoading}
        skeleton={
          <div className="space-y-2">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
          </div>
        }
      >
        {sorted.length === 0 ? (
          <ClearedEmpty
            headline="All clear — nothing needs you right now"
            subtitle="When new leads, deals, or signals come in, they'll show up here first."
          />
        ) : (
          <ul role="list" className="space-y-2">
            {sorted.map((item, idx) => {
              const SourceIcon = sourceIcon[item.source];
              return (
                <li key={item.id} role="listitem">
                  <Card
                    className={`rounded-card hover:shadow-md transition-shadow ${idx === 0 ? "border-[color:var(--acr-brand)]/30" : ""}`}
                  >
                    <CardContent className="flex items-center gap-4 p-4">
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${idx === 0 ? "bg-acr-brand text-acr-brand-ink" : "bg-muted text-muted-foreground"}`}>
                        {idx + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                          <span className="font-medium text-sm truncate">{item.title}</span>
                          <Badge variant="secondary" className={priorityColors[item.priority]}>
                            {item.priority}
                          </Badge>
                          <Badge
                            variant="secondary"
                            className={`text-xs border-transparent inline-flex items-center gap-1 ${sourcePillStyles[item.source]}`}
                          >
                            <SourceIcon className="w-3 h-3" aria-hidden={true} />
                            {sourcePillLabel[item.source]}
                          </Badge>
                          {item.source === "pax-suggests" &&
                            typeof item.confidence === "number" && (
                              <Badge
                                variant="secondary"
                                className="text-xs border-transparent bg-acr-pos-soft text-acr-pos tabular-nums"
                                aria-label={`Pax confidence: ${Math.round(item.confidence * 100)} percent`}
                              >
                                {Math.round(item.confidence * 100)}% confidence
                              </Badge>
                            )}
                        </div>
                        <p className="text-xs text-muted-foreground line-clamp-1">{item.description}</p>
                      </div>
                      <Button
                        asChild
                        size="sm"
                        variant={idx === 0 ? "default" : "outline"}
                        className="shrink-0 text-xs"
                      >
                        <Link href={item.actionUrl}>{item.actionLabel}</Link>
                      </Button>
                    </CardContent>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </ContentReveal>
    </div>
  );
}
