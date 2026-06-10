/**
 * SessionReplayPanel — chronological move history with AI reasoning for a
 * negotiation session. Extracted from pages/negotiation-copilot.tsx (T3 W1-4).
 */

import { History, Brain } from 'lucide-react';
import { STRATEGY_INFO, type NegotiationSession, type NegotiationMove } from './meta';

export function SessionReplayPanel({ session }: { session: NegotiationSession | undefined }) {
  const moves: NegotiationMove[] = session?.moves ?? session?.moveHistory ?? [];
  if (!moves || moves.length === 0) {
    return (
      <div className="text-center py-6 text-muted-foreground text-sm" role="status">
        <History className="w-6 h-6 mx-auto mb-2 opacity-40" aria-hidden="true" />
        No move history recorded for this session.
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Move history</p>
      <ol className="relative pl-4 border-l-2 border-muted space-y-4 list-none p-0 m-0" aria-label={`${moves.length} move${moves.length === 1 ? "" : "s"} in chronological order`}>
        {moves.map((move, i) => (
          <li key={i} className="relative pl-4">
            <span className="absolute -left-[1.125rem] top-1 w-3 h-3 rounded-full bg-primary/30 border-2 border-primary" aria-hidden="true" />
            <div className="text-xs text-muted-foreground mb-0.5">
              {move.timestamp ? <time dateTime={new Date(move.timestamp).toISOString()}>{new Date(move.timestamp).toLocaleString()}</time> : `Move ${i + 1}`}
            </div>
            <div className="flex items-center gap-2 mb-1">
              {move.strategy && (
                <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${STRATEGY_INFO[move.strategy]?.color ?? 'bg-muted text-foreground'}`} aria-label={`Strategy: ${STRATEGY_INFO[move.strategy]?.label ?? move.strategy}`}>
                  {STRATEGY_INFO[move.strategy]?.label ?? move.strategy}
                </span>
              )}
              {move.type && <span className="text-xs text-muted-foreground capitalize">{move.type.replace(/_/g, ' ')}</span>}
            </div>
            {move.content && <p className="text-sm bg-muted/50 rounded p-2">{move.content}</p>}
            {move.aiReasoning && (
              <div className="mt-1.5 flex items-start gap-1.5 text-xs text-muted-foreground">
                <Brain className="w-3 h-3 mt-0.5 shrink-0 text-primary" aria-hidden="true" />
                <span className="italic">{move.aiReasoning}</span>
              </div>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
