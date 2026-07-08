/**
 * StrategyAnalytics — the "Strategy analytics" tab of the negotiation
 * copilot: A/B win-rate table + per-objection effectiveness bars.
 * Owns its loading / error / empty treatment (T3 W1-4).
 */

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/empty-state';
import { QueryErrorState } from '@/components/query-error-state';
import { FlaskConical, BarChart2 } from 'lucide-react';
import { STRATEGY_INFO, OBJECTION_COLORS, type EffectivenessRow } from './meta';

interface StrategyAnalyticsProps {
  effectiveness: EffectivenessRow[];
  isLoading: boolean;
  error: Error | null;
  isRefetching: boolean;
  onRetry: () => void;
  onStartNegotiation: () => void;
}

/** Analytics-shaped skeleton: table header + bar rows. */
function AnalyticsSkeleton() {
  return (
    <Card aria-busy="true" aria-label="Loading strategy analytics">
      <CardHeader>
        <Skeleton className="h-4 w-56" announce announceText="Loading strategy analytics" />
        <Skeleton className="h-3 w-72" announce={false} />
      </CardHeader>
      <CardContent className="space-y-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Skeleton className="h-5 w-16 rounded-full" announce={false} />
                <Skeleton className="h-5 w-16 rounded-full" announce={false} />
              </div>
              <Skeleton className="h-4 w-24" announce={false} />
            </div>
            <Skeleton className="h-2 w-full rounded-full" announce={false} />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function StrategyAnalytics({
  effectiveness,
  isLoading,
  error,
  isRefetching,
  onRetry,
  onStartNegotiation,
}: StrategyAnalyticsProps) {
  if (error) {
    return (
      <QueryErrorState
        error={error}
        onRetry={onRetry}
        isRetrying={isRefetching}
        title="Couldn't load strategy analytics"
        testId="negotiation-analytics-error"
      />
    );
  }

  if (isLoading) {
    return <AnalyticsSkeleton />;
  }

  if (effectiveness.length === 0) {
    return (
      <EmptyState
        icon={BarChart2}
        headline="No effectiveness data yet"
        subtitle="Complete negotiation sessions and the copilot starts charting which strategies actually win against each objection type."
        cta={{
          label: "Start a negotiation",
          onClick: onStartNegotiation,
          "data-testid": "negotiation-analytics-start",
        }}
        actionIcon={null}
        testId="negotiation-analytics-empty"
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* A/B Test Analytics Panel */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <FlaskConical className="w-4 h-4 text-primary" aria-hidden="true" /> A/B strategy win-rate comparison
          </CardTitle>
          <CardDescription>Strategy effectiveness comparison across all sessions.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto" role="region" aria-label="Strategy win rates" tabIndex={0}>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th scope="col" className="text-left py-2 text-xs text-muted-foreground">Strategy</th>
                  <th scope="col" className="text-left py-2 text-xs text-muted-foreground">vs. objection</th>
                  <th scope="col" className="text-right py-2 text-xs text-muted-foreground">Used</th>
                  <th scope="col" className="text-right py-2 text-xs text-muted-foreground">Win rate</th>
                  <th scope="col" className="py-2 pl-4 text-xs text-muted-foreground">Bar</th>
                </tr>
              </thead>
              <tbody>
                {effectiveness.map((e, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="py-2">
                      <Badge className={`${STRATEGY_INFO[e.strategy]?.color || ''} text-xs`} aria-label={`Strategy: ${STRATEGY_INFO[e.strategy]?.label || e.strategy}`}>
                        {STRATEGY_INFO[e.strategy]?.label || e.strategy}
                      </Badge>
                    </td>
                    <td className="py-2">
                      <Badge className={`${OBJECTION_COLORS[e.category] || ''} text-xs`} aria-label={`Objection: ${e.category}`}>
                        {e.category}
                      </Badge>
                    </td>
                    <td className="py-2 text-right text-muted-foreground tabular-nums">{e.timesUsed}×</td>
                    <td className="py-2 text-right font-semibold tabular-nums">{(e.successRate * 100).toFixed(0)}%</td>
                    <td className="py-2 pl-4 w-32">
                      <div
                        className="w-full bg-muted rounded-full h-1.5"
                        role="progressbar"
                        aria-label={`${STRATEGY_INFO[e.strategy]?.label || e.strategy} vs ${e.category} win rate`}
                        aria-valuenow={Math.round(e.successRate * 100)}
                        aria-valuemin={0}
                        aria-valuemax={100}
                      >
                        <div className="bg-primary h-1.5 rounded-full" style={{ width: `${e.successRate * 100}%` }} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Strategy effectiveness by objection type</CardTitle>
          <CardDescription>Success rate analysis across all closed negotiation sessions.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-4 list-none p-0 m-0" aria-label="Strategy effectiveness rows">
            {effectiveness.map((e, i) => (
              <li key={i} className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <Badge className={OBJECTION_COLORS[e.category] || ''} aria-label={`Objection: ${e.category}`}>
                      {e.category}
                    </Badge>
                    <span className="text-muted-foreground" aria-hidden="true">→</span>
                    <Badge className={STRATEGY_INFO[e.strategy]?.color || ''}>
                      {STRATEGY_INFO[e.strategy]?.label || e.strategy}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-muted-foreground tabular-nums">{e.timesUsed}× used</span>
                    <span className="font-semibold tabular-nums">{(e.successRate * 100).toFixed(0)}% success</span>
                  </div>
                </div>
                <div
                  className="w-full bg-muted rounded-full h-2"
                  role="progressbar"
                  aria-label={`${STRATEGY_INFO[e.strategy]?.label || e.strategy} vs ${e.category} success rate`}
                  aria-valuenow={Math.round(e.successRate * 100)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div
                    className="bg-primary h-2 rounded-full transition-all"
                    style={{ width: `${e.successRate * 100}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
