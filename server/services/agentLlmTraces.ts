/**
 * Agent LLM Trace service — persist the exact prompt + response of
 * every agent-initiated LLM call so the founder can audit "what did
 * Sophie actually see and say when she recommended X?"
 *
 * Usage pattern (wrapper):
 *
 *   const started = Date.now();
 *   const response = await llmClient.call(...);
 *   await logAgentTrace({
 *     organizationId: orgId,
 *     agentCodename: "sophie_csm",
 *     purpose: "customer_monthly_letter",
 *     model: "claude-opus-4",
 *     systemPrompt,
 *     userPrompt,
 *     response: response.text,
 *     latencyMs: Date.now() - started,
 *     inputTokens: response.inputTokens,
 *     outputTokens: response.outputTokens,
 *   });
 *
 * Fire-and-forget: `logAgentTrace` never throws — if the trace write
 * fails we log a warning and move on. The LLM call's primary result
 * should never be gated on the audit trail succeeding.
 *
 * Roadmap top-20 #8 (agent action-replay audit) and #10 (agent
 * reasoning trace viewer). Principle #3 (autonomous): the platform
 * that runs itself needs to show its work when asked.
 */

import { db } from "../db";
import { agentLlmTraces, type InsertAgentLlmTrace } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { logger } from "../utils/logger";

// Arbitrary per-field caps — protect the DB from a 200k-token prompt
// blowing up a row. Truncation marker makes it obvious in the UI.
const MAX_PROMPT_CHARS = 60_000;
const MAX_RESPONSE_CHARS = 60_000;
const TRUNCATION_MARKER = "\n\n… [truncated by traces service]";

function clip(s: string | null | undefined, cap: number): string | null {
  if (s == null) return null;
  if (s.length <= cap) return s;
  return s.slice(0, cap - TRUNCATION_MARKER.length) + TRUNCATION_MARKER;
}

export interface LogTraceInput {
  organizationId?: number | null;
  agentCodename: string;
  purpose: string;
  decisionId?: number | null;
  model: string;
  systemPrompt?: string | null;
  userPrompt: string;
  response: string;
  latencyMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  costCents?: number;
  error?: string | null;
  metadata?: Record<string, unknown>;
}

export async function logAgentTrace(input: LogTraceInput): Promise<void> {
  try {
    const row: InsertAgentLlmTrace = {
      organizationId: input.organizationId ?? null,
      agentCodename: input.agentCodename,
      purpose: input.purpose,
      decisionId: input.decisionId ?? null,
      model: input.model,
      systemPrompt: clip(input.systemPrompt, MAX_PROMPT_CHARS),
      userPrompt: clip(input.userPrompt, MAX_PROMPT_CHARS) ?? "",
      response: clip(input.response, MAX_RESPONSE_CHARS) ?? "",
      latencyMs: input.latencyMs,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      costCents: input.costCents,
      error: input.error ?? null,
      metadata: input.metadata ?? {},
    };
    await db.insert(agentLlmTraces).values(row);
  } catch (err: any) {
    logger.warn("[agentLlmTraces] trace write failed", {
      metadata: { agent: input.agentCodename, purpose: input.purpose, error: err?.message },
    });
  }
}

export async function getTracesForDecision(decisionId: number) {
  return db
    .select()
    .from(agentLlmTraces)
    .where(eq(agentLlmTraces.decisionId, decisionId))
    .orderBy(desc(agentLlmTraces.createdAt))
    .limit(20);
}

export async function listRecentTraces(
  filter: { agentCodename?: string; organizationId?: number; limit?: number } = {},
) {
  const limit = Math.min(filter.limit ?? 50, 200);
  const conds = [] as any[];
  if (filter.agentCodename) conds.push(eq(agentLlmTraces.agentCodename, filter.agentCodename));
  if (filter.organizationId) conds.push(eq(agentLlmTraces.organizationId, filter.organizationId));
  const where = conds.length ? and(...conds) : undefined;
  const q = db
    .select({
      id: agentLlmTraces.id,
      agentCodename: agentLlmTraces.agentCodename,
      purpose: agentLlmTraces.purpose,
      decisionId: agentLlmTraces.decisionId,
      model: agentLlmTraces.model,
      latencyMs: agentLlmTraces.latencyMs,
      inputTokens: agentLlmTraces.inputTokens,
      outputTokens: agentLlmTraces.outputTokens,
      costCents: agentLlmTraces.costCents,
      error: agentLlmTraces.error,
      createdAt: agentLlmTraces.createdAt,
    })
    .from(agentLlmTraces)
    .orderBy(desc(agentLlmTraces.createdAt))
    .limit(limit);
  return where ? q.where(where) : q;
}

export async function getTraceById(id: number) {
  const [row] = await db.select().from(agentLlmTraces).where(eq(agentLlmTraces.id, id)).limit(1);
  return row ?? null;
}
