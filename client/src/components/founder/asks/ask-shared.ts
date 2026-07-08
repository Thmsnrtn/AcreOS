/**
 * Shared types + presentation helpers for the /founder/asks surface.
 *
 * Extracted from client/src/pages/founder/asks.tsx (W3-5 decomposition) so the
 * page, the answer/supersede dialogs, and the terminal-row component can share
 * one source of truth. Mirrors the founder-collab API surface shipped in
 * commit 05a2e122 (server/routes-founder-collab.ts — frozen).
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export type AskStatus = "open" | "answered" | "timed_out" | "superseded";
export type AskFormat = "free_text" | "multi_choice" | "yes_no" | "numeric";
export type AskUrgency = "urgent" | "normal" | "low";

export interface AskOption {
  id: string;
  label: string;
  description?: string;
}

export interface FounderAsk {
  id: number;
  askedAt: string;
  askingAgentRole: string;
  askingDispatchId: number | null;
  questionSummary: string;
  questionBody: string;
  options: AskOption[] | null;
  answerFormat: AskFormat;
  status: AskStatus;
  answeredAt: string | null;
  answerText: string | null;
  answerChosenOptionId: string | null;
  pagerEventId: number | null;
  timeoutAt: string | null;
  urgency: AskUrgency;
}

export interface AsksResponse {
  asks: FounderAsk[];
  count: number;
}

// ─── Presentation helpers ───────────────────────────────────────────────────

export const STATUS_TONE: Record<
  AskStatus,
  "default" | "secondary" | "destructive" | "outline"
> = {
  open: "default",
  answered: "secondary",
  timed_out: "destructive",
  superseded: "outline",
};

export const URGENCY_TONE: Record<
  AskUrgency,
  "default" | "secondary" | "destructive" | "outline"
> = {
  urgent: "destructive",
  normal: "default",
  low: "outline",
};

// Distinct color hint per agent role — uses Tailwind tokens, no hard-coded
// hex. The Badge tone is unified ('outline'); we apply a className tint.
export const AGENT_ROLE_CLASS: Record<string, string> = {
  iris: "border-acr-accent/40 text-acr-accent",
  soren: "border-acr-chart-c/40 text-acr-chart-c",
  beatrice: "border-acr-pos/40 text-acr-pos",
  krieger: "border-acr-warn/40 text-acr-warn",
  "general-purpose": "border-acr-ink-3/40 text-acr-ink-3",
  solene: "border-acr-chart-d/40 text-acr-chart-d",
};

export function agentClass(role: string): string {
  return AGENT_ROLE_CLASS[role] ?? "border-border text-muted-foreground";
}

export function truncate(s: string | null | undefined, n: number): string {
  if (!s) return "—";
  return s.length > n ? `${s.slice(0, n)}…` : s;
}
