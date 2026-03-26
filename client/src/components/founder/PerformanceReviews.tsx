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
  A: "bg-emerald-100 text-emerald-800 border-emerald-200",
  B: "bg-blue-100 text-blue-800 border-blue-200",
  C: "bg-amber-100 text-amber-800 border-amber-200",
  D: "bg-orange-100 text-orange-800 border-orange-200",
  F: "bg-red-100 text-red-800 border-red-200",
};

function ReviewCard({ review }: { review: Review }) {
  const avatar = AGENT_AVATARS[review.agentCodename] || "?";
  const role = AGENT_ROLES[review.agentCodename] || review.agentCodename;
  const gradeStyle = GRADE_STYLES[review.overallGrade] || GRADE_STYLES.C;
  const m = review.metrics;
  const peers = review.peerFeedback || [];

  return (
    <div className="border rounded-xl p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg">{avatar}</span>
          <div>
            <div className="text-sm font-semibold">{role}</div>
            <div className="text-[10px] text-muted-foreground">
              {new Date(review.periodStart).toLocaleDateString()} — {new Date(review.periodEnd).toLocaleDateString()}
            </div>
          </div>
        </div>
        <div className={`text-2xl font-bold px-3 py-1 rounded-lg border ${gradeStyle}`}>
          {review.overallGrade}
        </div>
      </div>

      {/* Summary */}
      <p className="text-sm leading-relaxed">{review.summary}</p>

      {/* Key Metrics */}
      <div className="grid grid-cols-4 gap-2">
        <div className="text-center p-2 rounded-lg bg-muted/50">
          <div className="text-lg font-bold">{m.totalActions}</div>
          <div className="text-[10px] text-muted-foreground">Actions</div>
        </div>
        <div className="text-center p-2 rounded-lg bg-muted/50">
          <div className="text-lg font-bold">{m.successRate}%</div>
          <div className="text-[10px] text-muted-foreground">Success</div>
        </div>
        <div className="text-center p-2 rounded-lg bg-muted/50">
          <div className="text-lg font-bold flex items-center justify-center gap-0.5">
            {m.trustScoreEnd}
            {m.trustDelta > 0 ? <ArrowUp className="h-3 w-3 text-emerald-500" /> :
             m.trustDelta < 0 ? <ArrowDown className="h-3 w-3 text-red-500" /> :
             <Minus className="h-3 w-3 text-muted-foreground" />}
          </div>
          <div className="text-[10px] text-muted-foreground">Trust</div>
        </div>
        <div className="text-center p-2 rounded-lg bg-muted/50">
          <div className="text-lg font-bold">{m.goalsCompleted}/{m.goalsAssigned}</div>
          <div className="text-[10px] text-muted-foreground">Goals</div>
        </div>
      </div>

      {/* Strengths & Improvements */}
      <div className="grid grid-cols-2 gap-3">
        {review.strengths.length > 0 && (
          <div>
            <div className="text-xs font-medium text-emerald-600 mb-1">Strengths</div>
            {review.strengths.map((s, i) => (
              <div key={i} className="text-xs text-muted-foreground flex items-start gap-1 mb-0.5">
                <Star className="h-2.5 w-2.5 text-emerald-500 mt-0.5 shrink-0" />
                {s}
              </div>
            ))}
          </div>
        )}
        {review.improvements.length > 0 && (
          <div>
            <div className="text-xs font-medium text-amber-600 mb-1">To Improve</div>
            {review.improvements.map((s, i) => (
              <div key={i} className="text-xs text-muted-foreground flex items-start gap-1 mb-0.5">
                <TrendingUp className="h-2.5 w-2.5 text-amber-500 mt-0.5 shrink-0" />
                {s}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Peer Feedback */}
      {peers.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs font-medium text-muted-foreground">Peer Feedback</div>
          {peers.map((p, i) => (
            <div key={i} className="text-xs flex items-start gap-1.5">
              <span>{AGENT_AVATARS[p.fromAgent] || "?"}</span>
              <span className="text-muted-foreground italic">"{p.feedback}"</span>
            </div>
          ))}
        </div>
      )}

      {/* Overrides */}
      {m.overridesReceived > 0 && (
        <div className="text-xs text-amber-600">
          CEO overrode {m.overridesReceived} decision{m.overridesReceived !== 1 ? "s" : ""} this period
        </div>
      )}
    </div>
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

  if (isLoading) return <Skeleton className="h-48 w-full rounded-xl" />;

  const reviewList = (reviews || []) as Review[];

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <ClipboardCheck className="h-4 w-4" /> Performance Reviews
          </CardTitle>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={() => generateMutation.mutate()}
            disabled={generateMutation.isPending}
          >
            {generateMutation.isPending ? (
              <RefreshCw className="h-3 w-3 mr-1 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3 mr-1" />
            )}
            Generate Reviews
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {reviewList.length === 0 ? (
          <div className="text-center py-6 text-sm text-muted-foreground">
            No reviews yet. Click "Generate Reviews" to run weekly evaluations.
          </div>
        ) : (
          reviewList.map(review => (
            <ReviewCard key={review.id} review={review} />
          ))
        )}
      </CardContent>
    </Card>
  );
}
