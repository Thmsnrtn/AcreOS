/**
 * Performance Reviews — Sovereign Company Protocol v6
 *
 * Weekly AI-generated evaluations of each agent.
 * Read like manager self-reviews. Grades are earned.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AGENT_AVATARS,
  AGENT_ROLES,
  AGENT_COLORS,
} from "@/lib/trust-language";
import {
  ClipboardCheck,
  Star,
  TrendingUp,
  TrendingDown,
  RefreshCw,
  Minus,
  ArrowUp,
  ArrowDown,
} from "lucide-react";

interface Review {
  id: number;
  agentCodename: string;
  periodStart: string;
  periodEnd: string;
  metrics: {
    totalActions: number;
    successRate: number;
    escalationRate: number;
    avgConfidence: number;
    trustScoreEnd: number;
    trustDelta: number;
    overridesReceived: number;
    goalsCompleted: number;
    goalsAssigned: number;
  };
  strengths: string[];
  improvements: string[];
  learnings: string[];
  peerFeedback: Array<{ fromAgent: string; feedback: string }> | null;
  overallGrade: string;
  summary: string;
  ceoComments: string | null;
  createdAt: string;
}

const GRADE_STYLES: Record<string, string> = {
  A: "bg-acr-pos-soft text-acr-pos border-acr-pos-soft",
  B: "bg-acr-accent text-acr-accent border-acr-accent",
  C: "bg-acr-warn-soft text-acr-warn border-acr-warn-soft",
  D: "bg-acr-warn-soft text-acr-warn border-acr-warn-soft",
  F: "bg-acr-neg-soft text-acr-neg border-acr-neg-soft",
};

function ReviewCard({ review }: { review: Review }) {
  const avatar = AGENT_AVATARS[review.agentCodename] || "?";
  const role = AGENT_ROLES[review.agentCodename] || review.agentCodename;
  const gradeStyle = GRADE_STYLES[review.overallGrade] || GRADE_STYLES.C;
  const m = review.metrics;
  const peers = review.peerFeedback || [];

  const reviewId = `review-${review.id}`;
  return (
    <li className="border rounded-xl p-4 space-y-3 list-none" aria-labelledby={`${reviewId}-heading`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className="text-lg">{avatar}</span>
          <div>
            <p id={`${reviewId}-heading`} className="text-sm font-semibold m-0">{role}</p>
            <p className="text-[10px] text-muted-foreground m-0">
              <time dateTime={review.periodStart} className="tabular-nums">{new Date(review.periodStart).toLocaleDateString()}</time> — <time dateTime={review.periodEnd} className="tabular-nums">{new Date(review.periodEnd).toLocaleDateString()}</time>
            </p>
          </div>
        </div>
        <div className={`text-2xl font-bold px-3 py-1 rounded-lg border ${gradeStyle}`} aria-label={`Overall grade: ${review.overallGrade}`}>
          {review.overallGrade}
        </div>
      </div>

      {/* Summary */}
      <p className="text-sm leading-relaxed">{review.summary}</p>

      {/* Key Metrics */}
      <dl className="grid grid-cols-4 gap-2 m-0">
        <div className="text-center p-2 rounded-lg bg-muted/50">
          <dd className="text-lg font-bold tabular-nums m-0">{m.totalActions}</dd>
          <dt className="text-[10px] text-muted-foreground">Actions</dt>
        </div>
        <div className="text-center p-2 rounded-lg bg-muted/50">
          <dd className="text-lg font-bold tabular-nums m-0">{m.successRate}%</dd>
          <dt className="text-[10px] text-muted-foreground">Success</dt>
        </div>
        <div className="text-center p-2 rounded-lg bg-muted/50">
          <dd className="text-lg font-bold flex items-center justify-center gap-0.5 m-0" aria-label={`Trust ${m.trustScoreEnd}, ${m.trustDelta > 0 ? "up" : m.trustDelta < 0 ? "down" : "flat"}`}>
            <span className="tabular-nums">{m.trustScoreEnd}</span>
            {m.trustDelta > 0 ? <ArrowUp className="h-3 w-3 text-acr-pos" aria-hidden="true" /> :
             m.trustDelta < 0 ? <ArrowDown className="h-3 w-3 text-acr-neg" aria-hidden="true" /> :
             <Minus className="h-3 w-3 text-muted-foreground" aria-hidden="true" />}
          </dd>
          <dt className="text-[10px] text-muted-foreground">Trust</dt>
        </div>
        <div className="text-center p-2 rounded-lg bg-muted/50">
          <dd className="text-lg font-bold tabular-nums m-0">{m.goalsCompleted}/{m.goalsAssigned}</dd>
          <dt className="text-[10px] text-muted-foreground">Goals</dt>
        </div>
      </dl>

      {/* Strengths & Improvements */}
      <div className="grid grid-cols-2 gap-3">
        {review.strengths.length > 0 && (
          <section aria-labelledby={`${reviewId}-strengths`}>
            <p id={`${reviewId}-strengths`} className="text-xs font-medium text-acr-pos mb-1">Strengths</p>
            <ul aria-labelledby={`${reviewId}-strengths`} className="list-none p-0 m-0">
              {review.strengths.map((s, i) => (
                <li key={i} className="text-xs text-muted-foreground flex items-start gap-1 mb-0.5">
                  <Star className="h-2.5 w-2.5 text-acr-pos mt-0.5 shrink-0" aria-hidden="true" />
                  {s}
                </li>
              ))}
            </ul>
          </section>
        )}
        {review.improvements.length > 0 && (
          <section aria-labelledby={`${reviewId}-improvements`}>
            <p id={`${reviewId}-improvements`} className="text-xs font-medium text-acr-warn mb-1">To improve</p>
            <ul aria-labelledby={`${reviewId}-improvements`} className="list-none p-0 m-0">
              {review.improvements.map((s, i) => (
                <li key={i} className="text-xs text-muted-foreground flex items-start gap-1 mb-0.5">
                  <TrendingUp className="h-2.5 w-2.5 text-acr-warn mt-0.5 shrink-0" aria-hidden="true" />
                  {s}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      {/* Peer Feedback */}
      {peers.length > 0 && (
        <section aria-labelledby={`${reviewId}-peer`} className="space-y-1">
          <p id={`${reviewId}-peer`} className="text-xs font-medium text-muted-foreground">Peer feedback</p>
          <ul aria-labelledby={`${reviewId}-peer`} className="list-none p-0 m-0 space-y-1">
            {peers.map((p, i) => (
              <li key={i} className="text-xs flex items-start gap-1.5">
                <span aria-hidden="true">{AGENT_AVATARS[p.fromAgent] || "?"}</span>
                <span className="text-muted-foreground italic">{AGENT_ROLES[p.fromAgent] || p.fromAgent}: "{p.feedback}"</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Overrides */}
      {m.overridesReceived > 0 && (
        <p className="text-xs text-acr-warn">
          CEO overrode <span className="tabular-nums">{m.overridesReceived}</span> decision{m.overridesReceived !== 1 ? "s" : ""} this period
        </p>
      )}
    </li>
  );
}

export function PerformanceReviews() {
  const queryClient = useQueryClient();

  const { data: reviews, isLoading } = useQuery({
    queryKey: ["/api/founder/v6/performance-reviews"],
    queryFn: () => apiRequest("GET", "/api/founder/v6/performance-reviews").then(r => r.json()),
    refetchInterval: 60000,
  });

  const generateMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/founder/v6/performance-reviews/generate"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/founder/v6/performance-reviews"] }),
  });

  if (isLoading) return <Skeleton role="status" aria-busy="true" aria-label="Loading performance reviews" className="h-48 w-full rounded-xl" />;

  const reviewList = (reviews || []) as Review[];

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <ClipboardCheck className="h-4 w-4" aria-hidden="true" /> Performance reviews
          </CardTitle>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={() => generateMutation.mutate()}
            disabled={generateMutation.isPending}
            aria-busy={generateMutation.isPending}
          >
            <RefreshCw className={`h-3 w-3 mr-1 ${generateMutation.isPending ? "animate-spin" : ""}`} aria-hidden="true" />
            {generateMutation.isPending ? "Generating…" : "Generate reviews"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {reviewList.length === 0 ? (
          <p className="text-center py-6 text-sm text-muted-foreground">
            No reviews yet. Click "Generate reviews" to run weekly evaluations.
          </p>
        ) : (
          <ul aria-label="Performance reviews" className="space-y-4 list-none p-0 m-0">
            {reviewList.map(review => (
              <ReviewCard key={review.id} review={review} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
