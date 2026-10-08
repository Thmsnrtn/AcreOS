/**
 * tracedLlmCall — thin wrapper around an OpenAI chat completion that
 * auto-captures a trace row via agentLlmTraces.
 *
 * Call-site pattern:
 *
 *   const { response, content } = await tracedLlmCall({
 *     agentCodename: "pax",
 *     purpose: "negotiation_script",
 *     organizationId: orgId,
 *     decisionId: dealId,
 *     model: "openai/gpt-4o",
 *     systemPrompt,
 *     userPrompt,
 *     client: openai,
 *     origin: "customer",          // or "background" — the ceiling posture
 *     request: {
 *       model: "openai/gpt-4o",
 *       messages: [
 *         { role: "system", content: systemPrompt },
 *         { role: "user", content: userPrompt },
 *       ],
 *     },
 *   });
 *
 * 2026-10 cost efficiency: the request is sent through the metered gateway
 * (aiSpendGuard.meteredChatCompletion) — cost ceiling before, telemetry after,
 * prompt cache stamped — instead of an opaque `call` thunk the trace could
 * observe but the ceilings could not. `purpose` is the telemetry feature tag.
 *
 * Returns the raw OpenAI response AND the extracted text content so
 * most call-sites don't need to dig into choices[0].message manually.
 *
 * Errors: if the inner call throws, the error gets captured in the
 * trace row (purpose stays the same so you can still find it) and
 * re-thrown so caller error-handling is unchanged.
 */
import type OpenAI from "openai";
import { logAgentTrace } from "./agentLlmTraces";
import { meteredChatCompletion, type AiCallOrigin, type ChatCompletionsClient } from "./aiSpendGuard";
import { clock } from "../utils/clock";

export interface TracedLlmCallOpts {
  agentCodename: string;
  purpose: string;
  organizationId?: number | null;
  decisionId?: number | null;
  model: string;
  systemPrompt?: string | null;
  userPrompt: string;
  metadata?: Record<string, unknown>;
  /** The client to send on (platform, BYOK, or a test double). */
  client: ChatCompletionsClient;
  /** The exact request — passed through the gateway unchanged. */
  request: OpenAI.ChatCompletionCreateParamsNonStreaming;
  /** Who triggered the call: decides the ceiling's read-error posture. */
  origin: AiCallOrigin;
  /** The org's own key serves this call ($0 platform cost, no ceilings). */
  byok?: boolean;
}

export async function tracedLlmCall(opts: TracedLlmCallOpts): Promise<{
  response: OpenAI.Chat.ChatCompletion;
  content: string;
}> {
  const started = clock.nowMs();
  let response: OpenAI.Chat.ChatCompletion | null = null;
  let error: string | null = null;
  let content = "";
  try {
    response = await meteredChatCompletion(opts.client, opts.request, {
      taskType: opts.purpose,
      orgId: opts.organizationId ?? null,
      origin: opts.origin,
      byok: opts.byok,
    });
    content =
      response.choices[0]?.message?.content ??
      JSON.stringify(response.choices[0]?.message?.tool_calls ?? "");
    return { response, content };
  } catch (err: any) {
    error = err?.message ?? String(err);
    throw err;
  } finally {
    // Fire-and-forget — never block the caller on trace write.
    void logAgentTrace({
      organizationId: opts.organizationId ?? null,
      agentCodename: opts.agentCodename,
      purpose: opts.purpose,
      decisionId: opts.decisionId ?? null,
      model: opts.model,
      systemPrompt: opts.systemPrompt,
      userPrompt: opts.userPrompt,
      response: content || "",
      latencyMs: clock.nowMs() - started,
      inputTokens: response?.usage?.prompt_tokens,
      outputTokens: response?.usage?.completion_tokens,
      error,
      metadata: opts.metadata,
    });
  }
}
