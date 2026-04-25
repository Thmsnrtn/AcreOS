/**
 * FounderTodoPage — the unified "what needs you right now" feed.
 *
 * One ranked list across 7 sources: decisions inbox, prompt
 * evolutions, strategic proposals, tool proposals, expansion
 * candidates, flagged onboarding journeys, and experiment
 * promotions.
 *
 * This is the single starting point for the founder's monthly
 * 1-hour session: open this page, work top-to-bottom until the list
 * is short, done. Each row links to the source page where the
 * actual approve/reject flow lives.
 */

import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { useDocumentTitle } from "@/hooks/use-document-title";
import {
  ListChecks,
  Brain,
  Lightbulb,
  Wrench,
  TrendingUp,
  Rocket,
  FlaskConical,
  CheckCircle2,
  ChevronRight,
} from "lucide-react";
import { dollars, relative } from "@/lib/format";

type TodoType =
  | "decision"
  | "prompt_evolution"
  | "strategic_move"
  | "tool_proposal"
  | "expansion_candidate"
  | "onboarding_rescue"
  | "experiment_promotion";

interface TodoItem {
  type: TodoType;
  id: number;
  title: string;
  subtitle: string;
  urgency: number;
  estimatedImpactCents: number | null;
  actionUrl: string;
  createdAt: string;
  badge?: string;
}

interface TodoResponse {
  generatedAt: string;
  total: number;
  byType: Record<TodoType, number>;
  items: TodoItem[];
}

const TYPE_META: Record<TodoType, { label: string; icon: any; color: string }> = {
  decision: { label: "Decision", icon: ListChecks, color: "text-amber-600 dark:text-amber-400" },
  prompt_evolution: { label: "Prompt revision", icon: Brain, color: "text-purple-600 dark:text-purple-400" },
  strategic_move: { label: "Strategic move", icon: Lightbulb, color: "text-blue-600 dark:text-blue-400" },
  tool_proposal: { label: "Tool proposal", icon: Wrench, color: "text-muted-foreground" },
  expansion_candidate: { label: "Expansion", icon: TrendingUp, color: "text-emerald-600 dark:text-emerald-400" },
  onboarding_rescue: { label: "Onboarding rescue", icon: Rocket, color: "text-red-600 dark:text-red-400" },
  experiment_promotion: { label: "Experiment winner", icon: FlaskConical, color: "text-blue-600 dark:text-blue-400" },
};

function urgencyClass(u: number): string {
  if (u >= 70) return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300";
  if (u >= 50) return "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300";
  return "bg-muted text-muted-foreground";
}

/** Naive pluralizer for the known TodoType labels. Good enough since
 * the label set is closed. */
function pluralize(label: string): string {
  if (/y$/.test(label)) return label.replace(/y$/, "ies");
  if (/(s|x|z|ch|sh)$/.test(label)) return `${label}es`;
  return `${label}s`;
}

export default function FounderTodoPage() {
  useDocumentTitle("What needs you");
  const { data, isLoading, isError, refetch } = useQuery<TodoResponse>({
    queryKey: ["/api/founder/intelligence/todo"],
    staleTime: 60_000,
  });

  const items = data?.items ?? [];

  return (
    <PageShell label="What needs you">
      <div className="space-y-6 max-w-4xl mx-auto">
        <Card>
          <CardContent className="p-6">
            <h1 className="text-2xl font-semibold text-foreground mb-2 flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
              What needs you right now
            </h1>
            <p className="text-sm text-muted-foreground">
              Every item from across the platform that's waiting on your call. Ranked by urgency
              and dollar-impact so you can work top-to-bottom. Each row links to the page where
              the actual approve/reject flow lives.
            </p>
            {data && (
              <div className="mt-4 flex items-center gap-3 flex-wrap">
                <Badge variant="secondary" className="text-xs">
                  <span className="tabular-nums mr-1">{data.total}</span> item{data.total === 1 ? "" : "s"}
                </Badge>
                {(Object.keys(data.byType) as TodoType[])
                  .filter((k) => data.byType[k] > 0)
                  .map((k) => {
                    const meta = TYPE_META[k];
                    const count = data.byType[k];
                    // Pluralize label naturally: "1 decision" not "1 decisions".
                    const base = meta.label.toLowerCase();
                    const label = count === 1 ? base : pluralize(base);
                    return (
                      <span key={k} className="text-[11px] text-muted-foreground flex items-center gap-1">
                        <meta.icon className={`h-3 w-3 ${meta.color}`} aria-hidden="true" />
                        <span className="tabular-nums">{count}</span> {label}
                      </span>
                    );
                  })}
              </div>
            )}
          </CardContent>
        </Card>

        {isLoading ? (
          <Card>
            <CardContent className="p-8 space-y-3">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </CardContent>
          </Card>
        ) : isError ? (
          <Card>
            <CardContent className="p-6 text-sm text-red-600" role="alert">
              Couldn't load the todo feed. Outstanding items are unchanged —{" "}
              <button
                type="button"
                className="underline hover:no-underline"
                onClick={() => refetch()}
              >
                try again
              </button>.
            </CardContent>
          </Card>
        ) : items.length === 0 ? (
          <EmptyState
            icon={CheckCircle2}
            title="Inbox zero"
            description="Nothing is waiting on you right now. The system is running itself. Check System trends in the sidebar to see how quality is trending."
          />
        ) : (
          <Card>
            <CardContent className="p-0">
              <ul aria-label="Items waiting on your decision">
                {items.map((item) => {
                  const meta = TYPE_META[item.type];
                  return (
                    <li key={`${item.type}-${item.id}`} className={`border-b border-border last:border-b-0`}>
                      <Link href={item.actionUrl}>
                        <a
                          className="flex items-start gap-3 p-4 hover:bg-muted/40 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          aria-label={`${meta.label}: ${item.title} — urgency ${item.urgency}`}
                        >
                          <meta.icon className={`h-5 w-5 ${meta.color} shrink-0 mt-0.5`} aria-hidden="true" />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap mb-1">
                              <span
                                className={`text-[10px] px-1.5 py-0.5 rounded tabular-nums ${urgencyClass(item.urgency)}`}
                                aria-label={`Urgency ${item.urgency}${item.urgency >= 70 ? ', high' : item.urgency >= 50 ? ', medium' : ''}`}
                              >
                                urgency {item.urgency}
                              </span>
                              <Badge variant="outline" className="text-[10px]">{meta.label}</Badge>
                              {item.badge && (
                                <Badge variant="secondary" className="text-[10px] font-mono">
                                  {item.badge}
                                </Badge>
                              )}
                              {item.estimatedImpactCents != null && item.estimatedImpactCents !== 0 && (
                                <Badge variant="outline" className="text-[10px] tabular-nums">
                                  {dollars(item.estimatedImpactCents, { showSign: true })}
                                </Badge>
                              )}
                              <span className="text-[10px] text-muted-foreground ml-auto tabular-nums">
                                {relative(item.createdAt)}
                              </span>
                            </div>
                            <p className="text-sm font-medium text-foreground truncate">{item.title}</p>
                            <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{item.subtitle}</p>
                          </div>
                          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 mt-1" aria-hidden="true" />
                        </a>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>
    </PageShell>
  );
}
