/**
 * P1-41 — Pax response-shape v3 (Beck §2, Theo §3.B).
 *
 * The v2 Pax executive prompt produced wall-of-text responses. Customer
 * research (Beck/Reyna) showed customers don't read past the first
 * paragraph. v3 enforces a hard shape: one-sentence headline → up to 3
 * tight bullets → prose only when explicitly asked.
 *
 * We keep v2 around for shadow-testing and for ops to fall back via
 * `?paxPrompt=v2` query param if v3 surfaces a regression. Default is v3.
 *
 * The executive system prompt is built by composing:
 *   [shape rule] + [base profile.systemPrompt] + [data-handling clause]
 *
 * The shape rule is prepended so it has the highest salience; the data-
 * handling clause is appended because it references the <<USER_DATA>>
 * markers that wrap any DB-sourced text in the user message.
 */

import { USER_DATA_SYSTEM_CLAUSE } from "../utils/sanitizePrompt";

export type PaxPromptVersion = "v2" | "v3";

export const DEFAULT_PAX_PROMPT_VERSION: PaxPromptVersion = "v3";

/**
 * v3 response-shape rule — prepended to the system prompt.
 * Every word here is load-bearing; do not edit without product sign-off.
 */
export const PAX_RESPONSE_SHAPE_V3 = `RESPONSE SHAPE (mandatory):
- Open with ONE concise sentence summarizing your answer.
- Follow with up to 3 bullets, each ≤ 12 words.
- Use prose only when the user explicitly asks for explanation or context.
- Never use more than 3 bullets per response.
- Never preface with "Sure!", "Of course!", or filler.
`;

/**
 * Compose the final system prompt for Pax / agent profiles.
 *
 * @param baseSystemPrompt — the per-role profile.systemPrompt
 * @param version — "v3" (default, new shape) or "v2" (legacy fallback)
 */
export function composePaxSystemPrompt(
  baseSystemPrompt: string,
  version: PaxPromptVersion = DEFAULT_PAX_PROMPT_VERSION,
): string {
  const dataClause = `\n\n${USER_DATA_SYSTEM_CLAUSE}`;

  if (version === "v2") {
    // v2 = legacy: no shape rule, but still gets the data-handling clause
    // so the injection guard works regardless of which prompt version is
    // active. Shadow-testing only changes the *shape* axis.
    return baseSystemPrompt + dataClause;
  }

  return `${PAX_RESPONSE_SHAPE_V3}\n${baseSystemPrompt}${dataClause}`;
}

/**
 * Parse a request-supplied prompt version (query param / header) and
 * fall back to default for invalid values. Used by routes-ai.ts to honor
 * `?paxPrompt=v2` for ops fall-back.
 */
export function parsePaxPromptVersion(raw: unknown): PaxPromptVersion {
  if (raw === "v2" || raw === "v3") return raw;
  return DEFAULT_PAX_PROMPT_VERSION;
}
