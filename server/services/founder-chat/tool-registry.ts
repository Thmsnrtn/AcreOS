/**
 * Founder Chat — Tool Registry.
 *
 * Atlas's tools are distinct from the customer-side Pax tools in
 * server/ai/tools.ts. Customer tools manipulate the customer's own data
 * (leads, properties, deals). Atlas tools manipulate the PLATFORM —
 * approve revenue triggers, transfer between buckets, pause channels,
 * run Fly deploys, write SQL, open GitHub PRs.
 *
 * Phase A delivers the framework. Phase B fills in the initial 40
 * platform tools. Phases G/H/I add the ~50 operational-hands tools
 * (Fly / Stripe / Clerk / GitHub / DB / etc.).
 *
 * See /Users/user/.claude/plans/how-can-we-either-ticklish-ocean.md
 * for the full tool taxonomy.
 */

import type { z } from "zod";

export type ArtifactType =
  | "text"
  | "bucket_chart"
  | "mrr_sparkline"
  | "cost_mix_pie"
  | "org_table"
  | "org_card"
  | "org_cost_detail_card"
  | "decision_card"
  | "trigger_card"
  | "dlq_card"
  | "cost_event_card"
  | "provider_card"
  | "agent_card"
  | "infra_status_card"
  | "confirmation_request"
  | "dial_form"
  | "letter_card"
  | "audit_log_table"
  | "brief_card"
  | "agent_quote"
  | "tool_call_progress"
  | "background_task_card"
  | "attachment_group"
  // Phase G/H/I operational-hands artifacts
  | "code_diff"
  | "file_view"
  | "pr_summary"
  | "ci_status_card"
  | "query_result_table"
  | "explain_plan"
  | "error_event_card"
  | "log_stream"
  | "secret_paste"
  | "fly_releases_card"
  | "fly_machine_metrics_card"
  | "stripe_customer_card"
  | "clerk_user_card"
  // Persona-mode tools (Phase G slice)
  | "navigation";

export type ToolCategory = "inquiry" | "action" | "synthesis" | "delegation";

/** Three permission tiers per the plan's cross-cutting security model. */
export type ToolTier = 1 | 2 | 3;

/**
 * Per-turn context Atlas's executor passes to every tool handler. Built
 * by context-resolver from the request + thread + page hints.
 */
export interface FounderToolContext {
  founderUserId: string;
  organizationId: number;
  currentPath?: string;
  currentOrgId?: number;
  currentShipmentId?: number;
  currentLedgerEventId?: number;
  currentProviderName?: string;
  /** Phase D — the active Studio tab/dial category when the dock fires. */
  currentDialCategory?: string;
  recentMentions: Array<{ kind: string; id: number; label?: string }>;
  threadId: number;
  /** Append a row to founder_audit with the tool's before/after state. */
  auditLog: (action: string, before?: unknown, after?: unknown) => Promise<void>;
}

/**
 * What every tool returns. The artifact is what the chat renders. The
 * verifyFn (if present) is invoked AFTER the action by the executor —
 * this is the post-action verification pattern from Reliability Req 3A.
 */
export interface ToolResult {
  artifact: { type: ArtifactType } & Record<string, unknown>;
  followUp?: string;
  destructivePending?: boolean;
  rollbackRecipe?: { tool: string; args: unknown };
  /**
   * Optional post-action verifier. Executor invokes after the tool
   * succeeds and appends `{ ok, evidence }` to the audit row. Atlas
   * sees the result on its next inference pass so it can speak to it.
   */
  verifyFn?: () => Promise<{ ok: boolean; evidence: string }>;
}

export interface FounderTool<Args = unknown> {
  name: string;
  description: string;
  category: ToolCategory;
  destructive: boolean;
  tier: ToolTier;
  schema: z.ZodSchema<Args>;
  /** Optional natural-language aliases for slash-command lookup. */
  slashAliases?: string[];
  /** Suggested artifact type for the result (for UI optimization). */
  artifactType?: ArtifactType;
  handler: (args: Args, ctx: FounderToolContext) => Promise<ToolResult>;
}

const REGISTRY = new Map<string, FounderTool>();
const SLASH_INDEX = new Map<string, FounderTool>();

export function registerTool<A>(tool: FounderTool<A>): void {
  if (REGISTRY.has(tool.name)) {
    throw new Error(`[founder-chat] duplicate tool name: ${tool.name}`);
  }
  REGISTRY.set(tool.name, tool as unknown as FounderTool);
  for (const alias of tool.slashAliases ?? []) {
    SLASH_INDEX.set(alias.toLowerCase(), tool as unknown as FounderTool);
  }
}

export function getTool(name: string): FounderTool | undefined {
  return REGISTRY.get(name);
}

export function getToolBySlashAlias(alias: string): FounderTool | undefined {
  return SLASH_INDEX.get(alias.toLowerCase());
}

export function listTools(filter?: { category?: ToolCategory; tier?: ToolTier }): FounderTool[] {
  const all = Array.from(REGISTRY.values());
  if (!filter) return all;
  return all.filter((t) =>
    (filter.category == null || t.category === filter.category) &&
    (filter.tier == null || t.tier === filter.tier),
  );
}

/**
 * Atlas's tool inventory shape for the LLM (Anthropic / OpenAI tool spec).
 * Built lazily so plan additions don't require restart.
 */
export function buildToolInventoryForLLM(): Array<{
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}> {
  return Array.from(REGISTRY.values()).map((t) => ({
    name: t.name,
    description: t.description,
    // Note: zod-to-json-schema conversion happens at call-site to keep
    // the registry zero-deps. The chat-stream endpoint imports
    // `zod-to-json-schema` and applies it per tool.
    input_schema: {
      __zod: t.schema,
    },
  }));
}

/** Reset for tests. NEVER call in production. */
export function __resetRegistryForTests(): void {
  REGISTRY.clear();
  SLASH_INDEX.clear();
}
