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
 *     call: () => openai.chat.completions.create({
 *       model: "openai/gpt-4o",
 *       messages: [
 *         { role: "system", content: systemPrompt },
 *         { role: "user", content: userPrompt },
 *       ],
 *     }),
 *   });
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

export interface TracedLlmCallOpts {
  agentCodename: string;
  purpose: string;
  organizationId?: number | null;
  decisionId?: number | null;
  model: string;
  systemPrompt?: string | null;
  userPrompt: string;
  metadata?: Record<string, unknown>;
  call: () => Promise<OpenAI.Chat.ChatCompletion>;
}

export async function tracedLlmCall(opts: TracedLlmCallOpts): Promise<{
  response: OpenAI.Chat.ChatCompletion;
  content: string;
}> {
  const started = Date.now();
  let response: OpenAI.Chat.ChatCompletion | null = null;
  let error: string | null = null;
  let content = "";
  try {
    response = await opts.call();
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
      latencyMs: Date.now() - started,
      inputTokens: response?.usage?.prompt_tokens,
      outputTokens: response?.usage?.completion_tokens,
      error,
      metadata: opts.metadata,
    });
  }
}
