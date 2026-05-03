/**
 * P0-14 — Pax / Atlas response post-validator.
 *
 * After the LLM returns, we scan the response for evidence the model
 * leaked its system prompt or otherwise complied with an injection.
 * If any leak is detected, we log it and return a safe fallback so the
 * customer never sees the leaked content.
 *
 * Pair with sanitizePrompt() — this is the second half of the defense.
 */

import { logger } from "./logger";
import { USER_DATA_OPEN, USER_DATA_CLOSE } from "./sanitizePrompt";

/**
 * Markers and verbatim strings that indicate a system-prompt leak.
 * Each entry is matched case-insensitively. Add new entries as the Pax
 * prompt evolves — anything that should NEVER appear in a customer-
 * visible response belongs here.
 */
const LEAK_PATTERNS: RegExp[] = [
  // Direct prompt-template tokens
  /<<\s*SYS\s*>>/i,
  /\[\s*INST\s*\]/i,
  /<\|\s*system\s*\|>/i,
  /<\|\s*im_start\s*\|>/i,
  // Our own delimiter — should never echo back to the user
  new RegExp(USER_DATA_OPEN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"),
  new RegExp(USER_DATA_CLOSE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"),
  // Verbatim system-prompt giveaways from the Pax prompts
  /I am Pax, the AcreOS executive assistant/i,
  /You are Pax, an AI executive assistant for a real estate company/i,
  /You are Pax, the Land Investor's AI copilot/i,
  /ATLAS_CORE_METHODOLOGY/i,
  /RESPONSE SHAPE \(mandatory\)/i,
  /UNTRUSTED DATA HANDLING/i,
  // Common system-prompt boundary phrasings the model might echo
  /^---\s*system\s*:/im,
];

const SAFE_FALLBACK =
  "I ran into an issue formatting that response. Could you rephrase or try again?";

export interface ValidatePaxResponseResult {
  safe: boolean;
  /** The response to surface to the user — either original or fallback. */
  response: string;
  /** Patterns that matched, for telemetry. */
  matchedPatterns: string[];
}

export interface ValidatePaxResponseOptions {
  /** Tag for telemetry, e.g. "pax.chat" or "pax.draft-reply". */
  source?: string;
  /** Override the fallback message if a leak is detected. */
  fallback?: string;
  /** Org id for structured logging. */
  organizationId?: number | null;
}

/**
 * Validate a model response. If any leak pattern matches, return the
 * fallback string and `safe: false`. Otherwise return the original
 * response and `safe: true`.
 */
export function validatePaxResponse(
  response: string,
  opts: ValidatePaxResponseOptions = {},
): ValidatePaxResponseResult {
  if (typeof response !== "string" || response.length === 0) {
    return { safe: true, response: response ?? "", matchedPatterns: [] };
  }

  const matched: string[] = [];
  for (const re of LEAK_PATTERNS) {
    if (re.test(response)) {
      matched.push(re.source);
    }
  }

  if (matched.length === 0) {
    return { safe: true, response, matchedPatterns: [] };
  }

  try {
    logger.warn("[validatePaxResponse] system-prompt leak detected — returning fallback", {
      metadata: {
        source: opts.source ?? "unknown",
        organizationId: opts.organizationId ?? null,
        matchedPatterns: matched,
        responseLength: response.length,
        responsePreview: response.slice(0, 200),
      },
    });
  } catch {
    // logger must never break the response path
  }

  return {
    safe: false,
    response: opts.fallback ?? SAFE_FALLBACK,
    matchedPatterns: matched,
  };
}
