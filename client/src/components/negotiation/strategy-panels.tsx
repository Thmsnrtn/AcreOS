/**
 * Negotiation strategy panels — sentiment indicator, strategy
 * explainability, and the learning-loop status strip.
 * Extracted from pages/negotiation-copilot.tsx (T3 W1-4).
 */

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Info, TrendingUp, TrendingDown, Activity } from 'lucide-react';
import { STRATEGY_INFO, type StrategyResult } from './meta';

export function SentimentIndicator({ score }: { score: number }) {
  if (score > 0.3) return <span className="flex items-center gap-1 text-acr-pos text-sm"><TrendingUp className="w-3 h-3" /> Positive ({(score * 100).toFixed(0)}%)</span>;
  if (score < -0.3) return <span className="flex items-center gap-1 text-acr-neg text-sm"><TrendingDown className="w-3 h-3" /> Negative ({(Math.abs(score) * 100).toFixed(0)}%)</span>;
  return <span className="flex items-center gap-1 text-muted-foreground text-sm">Neutral</span>;
}

export function StrategyExplainabilityPanel({ strategyResult }: { strategyResult: StrategyResult | null }) {
  if (!strategyResult) return null;
  return (
    <Card className="border-primary/20 bg-primary/5">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Info className="w-4 h-4 text-primary" aria-hidden="true" /> Why Pax recommends this approach
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex items-center gap-2">
          <Badge className={STRATEGY_INFO[strategyResult.strategy]?.color || ''}>
            {STRATEGY_INFO[strategyResult.strategy]?.label || strategyResult.strategy}
          </Badge>
          <span className="text-muted-foreground text-xs">strategy · {strategyResult.confidence}% confidence</span>
        </div>
        <p className="text-muted-foreground">{strategyResult.reasoning}</p>
        {strategyResult.dataCitations && strategyResult.dataCitations.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Data citations:</p>
            {strategyResult.dataCitations.map((cite, i) => (
              <div key={i} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                <span className="text-primary font-mono">[{i + 1}]</span> {cite}
              </div>
            ))}
          </div>
        )}
        {strategyResult.successRate != null && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <TrendingUp className="w-3 h-3 text-acr-pos" />
            Historical success rate for this strategy: <strong className="text-foreground">{(strategyResult.successRate * 100).toFixed(0)}%</strong>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function LearningLoopIndicator() {
  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-acr-pos-soft dark:bg-acr-pos-soft/20 rounded-md text-xs text-acr-pos dark:text-acr-pos border border-acr-pos-soft dark:border-acr-pos-soft" role="status" aria-live="polite">
      <Activity className="w-3.5 h-3.5 animate-pulse" aria-hidden="true" />
      <span><strong>Learning loop active</strong> — strategy effectiveness is being tracked and will improve recommendations over time.</span>
    </div>
  );
}
