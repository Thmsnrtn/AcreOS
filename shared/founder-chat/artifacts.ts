/**
 * Atlas (Founder Chat) — Artifact Taxonomy
 *
 * Discriminated union of every artifact type the chat backend (Phase B)
 * can emit and the chat client (Phase C) renders. Both sides import from
 * here so the wire format stays in lockstep.
 *
 * Phase C ships the renderers for the CORE 9 (text, bucket_chart,
 * mrr_sparkline, cost_mix_pie, org_table, decision_card, trigger_card,
 * confirmation_request, brief_card). Everything else has a placeholder
 * renderer that doesn't crash when emitted — Phases D/E/G/H/I implement
 * the real renderers.
 */

// ───────────────────────────────────────────────────────────────────────
// Shared data shapes (deliberately permissive — backend authors them and
// the renderer is defensive about missing fields).
// ───────────────────────────────────────────────────────────────────────

export interface BucketBalances {
  taxReserveCents: number;
  refundReserveCents: number;
  profitReserveCents: number;
  ownerDrawCents: number;
  opexAvailableCents: number;
  /** Optional totals computed by the backend. */
  totalCents?: number;
  /** Optional ISO timestamp of when these balances were computed. */
  computedAt?: string;
}

export interface MrrPoint {
  date: string; // ISO date
  cents: number;
}

export interface CostMixSlice {
  category: string;
  cents: number;
  providers?: Array<{ name: string; cents: number }>;
}

export interface OrgMarginRow {
  orgId: number;
  orgName: string;
  tier?: string | null;
  mrrCents: number;
  costsCents: number;
  marginCents: number;
  /** Negative-margin orgs render in danger tone. */
  isNegative?: boolean;
}

export interface DecisionItem {
  id: string | number;
  title: string;
  summary: string;
  ownerAgentCodename?: string;
  /** Optional structured context. */
  meta?: Record<string, unknown>;
  /** Pre-computed deep-link to the underlying surface for "investigate". */
  inspectorHref?: string;
}

export interface RevenueTrigger {
  id: string | number;
  thresholdId?: string | number;
  title: string;
  rationale: string;
  /** "scale_up" | "scale_down" | "pause" | other free-form */
  kind?: string;
  /** Optional pre/post comparison cents for chart bars. */
  preCents?: number;
  postCents?: number;
}

export interface BriefSection {
  /** Human label for the section, e.g. "Overnight cash", "Net-negative orgs". */
  title: string;
  /** Embedded artifacts that render inside the brief. */
  artifacts: Artifact[];
}

// ───────────────────────────────────────────────────────────────────────
// Discriminated union
// ───────────────────────────────────────────────────────────────────────

export type ArtifactType = Artifact["type"];

export type Artifact =
  // ── CORE 9 (Phase C real renderers) ──────────────────────────────────
  | { type: "text"; markdown: string }
  | { type: "bucket_chart"; data: BucketBalances }
  | { type: "mrr_sparkline"; series: MrrPoint[]; label?: string }
  | { type: "cost_mix_pie"; data: CostMixSlice[]; windowDays?: number }
  | { type: "org_table"; rows: OrgMarginRow[]; sortBy?: keyof OrgMarginRow }
  | {
      type: "decision_card";
      item: DecisionItem;
      actions?: Array<"approve" | "reject" | "investigate">;
    }
  | {
      type: "trigger_card";
      trigger: RevenueTrigger;
      actions?: Array<"approve" | "defer">;
    }
  | {
      type: "confirmation_request";
      requestId: string;
      toolCall: { name: string; args: Record<string, unknown> };
      preview: string;
      /** Optional human-readable danger note. */
      warning?: string;
    }
  | { type: "brief_card"; title?: string; sections: BriefSection[] }

  // ── STUBS (Phase D/E/G/H/I renderers) ────────────────────────────────
  | { type: "dlq_card"; job: Record<string, unknown> }
  | { type: "cost_event_card"; ledgerRow: Record<string, unknown> }
  | { type: "provider_card"; summary: Record<string, unknown> }
  | { type: "agent_card"; agent: Record<string, unknown> }
  | { type: "infra_status_card"; data: Record<string, unknown> }
  | { type: "dial_form"; key: string; current: unknown; field: Record<string, unknown> }
  | { type: "letter_card"; title: string; body: string; sendTarget?: string }
  | { type: "audit_log_table"; rows: Array<Record<string, unknown>> }
  | { type: "agent_quote"; agentCodename: string; agentTitle: string; markdown: string }
  | {
      type: "tool_call_progress";
      toolName: string;
      progress: "running" | "complete" | "failed";
      /** Optional result summary once complete. */
      summary?: string;
    }
  | {
      type: "background_task_card";
      task: {
        id: string;
        label: string;
        status: "queued" | "running" | "complete" | "failed";
        etaSeconds?: number;
      };
    }
  | { type: "attachment_group"; artifacts: Artifact[] }
  | { type: "code_diff"; filename: string; diff: string }
  | { type: "file_view"; filename: string; content: string; language?: string }
  | { type: "pr_summary"; data: Record<string, unknown> }
  | { type: "ci_status_card"; data: Record<string, unknown> }
  | { type: "query_result_table"; columns: string[]; rows: unknown[][] }
  | { type: "explain_plan"; plan: string }
  | { type: "error_event_card"; data: Record<string, unknown> }
  | { type: "log_stream"; lines: string[]; source?: string }
  | { type: "secret_paste"; key: string; placeholder?: string }
  | { type: "fly_releases_card"; data: Record<string, unknown> }
  | { type: "stripe_customer_card"; data: Record<string, unknown> }
  | { type: "clerk_user_card"; data: Record<string, unknown> };

// ───────────────────────────────────────────────────────────────────────
// Chat messages + threads + stream events
// ───────────────────────────────────────────────────────────────────────

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  /** Raw text body — assistant messages may also carry artifacts. */
  text?: string;
  artifacts?: Artifact[];
  /** Tool calls that fired while producing this message. */
  toolCalls?: Array<{ name: string; status: "running" | "complete" | "failed"; summary?: string }>;
  createdAt: string;
}

export interface ChatThread {
  id: string;
  title: string | null;
  isDefault: boolean;
  lastActivityAt: string;
  unreadCount?: number;
}

/** SSE event envelope from /api/founder/chat/stream. */
export type ChatStreamEvent =
  | { type: "message_start"; messageId: string; threadId: string }
  | { type: "tool_call_start"; toolName: string; callId: string }
  | { type: "tool_call_complete"; toolName: string; callId: string; summary?: string; failed?: boolean }
  | { type: "artifact"; artifact: Artifact }
  | { type: "text_delta"; delta: string }
  | { type: "text_complete"; text: string }
  | { type: "message_end"; messageId: string }
  | { type: "error"; message: string };
