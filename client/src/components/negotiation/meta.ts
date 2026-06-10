/**
 * Negotiation copilot — shared metadata, formatting, and result types.
 *
 * Extracted from pages/negotiation-copilot.tsx (T3 W1-4 split) so the
 * session/replay/BATNA/analytics panels can live as coherent modules
 * without re-declaring strategy vocabulary or duplicating the money
 * formatter.
 */

import { usd } from '@/lib/format';

// ─── Strategy + objection vocabulary ─────────────────────────────────────────

export const STRATEGY_INFO: Record<string, { label: string; color: string; description: string }> = {
  empathy: { label: 'Empathy', color: 'bg-acr-accent text-acr-accent dark:bg-acr-accent/30 dark:text-acr-accent', description: 'Validate feelings and build connection' },
  logic: { label: 'Logic', color: 'bg-acr-brand-soft text-acr-brand dark:bg-acr-brand-soft/30 dark:text-acr-brand', description: 'Use facts and market data' },
  urgency: { label: 'Urgency', color: 'bg-acr-warn-soft text-acr-warn dark:bg-acr-warn-soft/30 dark:text-acr-warn', description: 'Time-limited framing' },
  anchor: { label: 'Anchor', color: 'bg-acr-warn-soft text-acr-warn dark:bg-acr-warn-soft/30 dark:text-acr-warn', description: 'Reinforce original offer as fair' },
  silence: { label: 'Silence', color: 'bg-muted text-foreground dark:bg-acr-bg-sunken dark:text-muted-foreground', description: 'Give space and wait' },
};

export const OBJECTION_COLORS: Record<string, string> = {
  price: 'bg-acr-neg-soft text-acr-neg dark:bg-acr-neg-soft/30 dark:text-acr-neg',
  timing: 'bg-acr-accent text-acr-accent dark:bg-acr-accent/30 dark:text-acr-accent',
  trust: 'bg-acr-warn-soft text-acr-warn dark:bg-acr-warn-soft/30 dark:text-acr-warn',
  emotional: 'bg-acr-brand-soft text-acr-brand dark:bg-acr-brand-soft/30 dark:text-acr-brand',
  competitive: 'bg-acr-brand-soft text-acr-brand dark:bg-acr-brand-soft/30 dark:text-acr-brand',
};

// ─── Money formatting ────────────────────────────────────────────────────────

// P1 money-precision: K/M compact bands intentionally kept for the copilot's hero
// numbers (counter-offer amounts, BATNA outputs — readability over cents at scale).
// Sub-$1K fall-through swapped to canonical usd(noCents).
export function formatDollar(n: number) {
  if (!n || isNaN(n)) return '$0';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return usd(n, { noCents: true });
}

// ─── Result types (shapes returned by /api/negotiation/*) ───────────────────

export interface NegotiationMove {
  timestamp?: string;
  strategy?: string;
  type?: string;
  content?: string;
  aiReasoning?: string;
}

export interface NegotiationSession {
  id: number;
  createdAt: string;
  outcome?: string | null;
  moves?: NegotiationMove[];
  moveHistory?: NegotiationMove[];
}

export interface StrategyResult {
  strategy: string;
  confidence: number;
  reasoning: string;
  suggestedActions?: string[];
  dataCitations?: string[];
  successRate?: number | null;
}

export interface ObjectionResult {
  id: string;
  category: string;
  text: string;
}

export interface SentimentResult {
  score: number;
  indicators?: string[];
}

export interface CounterOfferResult {
  suggestedAmount: number;
  reasoning: string;
  confidence: number;
  alternativeAmounts?: number[];
}

export interface EffectivenessRow {
  strategy: string;
  category: string;
  timesUsed: number;
  successRate: number;
}
