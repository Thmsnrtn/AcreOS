/**
 * SessionHistory — the "Deal history" tab of the negotiation copilot.
 * Owns the full loading / error / empty / populated state machine for the
 * per-deal session list (T3 W1-4: session-list-shaped Skeleton, EmptyState
 * with a "Start a negotiation" CTA, QueryErrorState with retry).
 */

import { useId } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/empty-state';
import { QueryErrorState } from '@/components/query-error-state';
import { MessageSquare, ChevronRight, Search } from 'lucide-react';
import type { NegotiationSession } from './meta';
import { formatDate } from "@/lib/format";

interface SessionHistoryProps {
  dealId: string;
  setDealId: (id: string) => void;
  sessions: NegotiationSession[];
  isLoading: boolean;
  error: Error | null;
  isRefetching: boolean;
  onRetry: () => void;
  onOpenSession: (id: number) => void;
  onStartNegotiation: () => void;
}

/** Session-list-shaped skeleton: mirrors the real session card rows
 *  (title line + meta line on the left, outcome badge + chevron on the right). */
function SessionListSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading negotiation sessions">
      {Array.from({ length: 3 }).map((_, i) => (
        <Card key={i}>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center justify-between">
              <div className="space-y-2">
                <Skeleton className="h-4 w-28" announce={i === 0} announceText="Loading negotiation sessions" />
                <Skeleton className="h-3 w-44" announce={false} />
              </div>
              <div className="flex items-center gap-2">
                <Skeleton className="h-5 w-16 rounded-full" announce={false} />
                <Skeleton className="h-4 w-4" announce={false} />
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function SessionHistory({
  dealId,
  setDealId,
  sessions,
  isLoading,
  error,
  isRefetching,
  onRetry,
  onOpenSession,
  onStartNegotiation,
}: SessionHistoryProps) {
  const dealHistoryFilterId = useId();

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Label htmlFor={dealHistoryFilterId} className="sr-only">Deal ID</Label>
        <Input
          id={dealHistoryFilterId}
          placeholder="Deal ID"
          value={dealId}
          onChange={(e) => setDealId(e.target.value)}
          className="w-32 tabular-nums"
          type="number"
          inputMode="numeric"
          aria-label="Deal ID to filter sessions"
        />
      </div>

      {error ? (
        <QueryErrorState
          error={error}
          onRetry={onRetry}
          isRetrying={isRefetching}
          title="Couldn't load negotiation history"
          testId="negotiation-sessions-error"
        />
      ) : isLoading ? (
        <SessionListSkeleton />
      ) : sessions.length > 0 ? (
        <ul className="space-y-3 list-none p-0 m-0" aria-label={`${sessions.length} negotiation session${sessions.length === 1 ? "" : "s"} for deal ${dealId}`}>
          {sessions.map((s) => (
            <li key={s.id}>
              <Card
                className="cursor-pointer transition-shadow hover:shadow-md active:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                role="button"
                tabIndex={0}
                aria-label={`Open session ${s.id}, started ${formatDate(s.createdAt)}${s.outcome ? `, outcome ${s.outcome}` : ", active"}`}
                onClick={() => onOpenSession(s.id)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpenSession(s.id); } }}
              >
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-sm">Session #<span className="tabular-nums">{s.id}</span></p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Started <time dateTime={new Date(s.createdAt).toISOString()}>{formatDate(s.createdAt)}</time>
                        {s.outcome && ` · Outcome: ${s.outcome}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {s.outcome ? (
                        <Badge className={s.outcome === 'accepted' ? 'bg-acr-pos-soft text-acr-pos' : 'bg-muted text-foreground'} aria-label={`Outcome: ${s.outcome}`}>
                          {s.outcome}
                        </Badge>
                      ) : (
                        <Badge className="bg-acr-accent text-acr-accent">Active</Badge>
                      )}
                      <ChevronRight className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      ) : dealId ? (
        <EmptyState
          icon={MessageSquare}
          headline={`No sessions for deal #${dealId} yet`}
          subtitle="Start a negotiation on this deal — every move, strategy, and outcome gets recorded here so the copilot learns what works for you."
          cta={{
            label: "Start a negotiation",
            onClick: onStartNegotiation,
            "data-testid": "negotiation-history-start",
          }}
          actionIcon={null}
          testId="negotiation-history-empty"
        />
      ) : (
        <EmptyState
          icon={Search}
          headline="Enter a deal ID to see negotiation history"
          subtitle="Each deal keeps its own session record — strategies tried, seller responses, and outcomes."
          cta={{
            label: "Start a negotiation",
            onClick: onStartNegotiation,
            "data-testid": "negotiation-history-start-blank",
          }}
          actionIcon={null}
          testId="negotiation-history-no-deal"
        />
      )}
    </div>
  );
}
