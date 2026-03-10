/**
 * F-A04-1: Prompt Injection Guard
 *
 * Detects and strips known prompt injection patterns from user-supplied
 * text before it is forwarded to an LLM (OpenAI, etc.).
 *
 * Strategy: deny-list of common injection patterns (case-insensitive).
 * Matching content is replaced with a safe placeholder so the LLM never
 * sees the adversarial instruction while the request can still proceed.
 *
 * Exports:
 *   sanitizePrompt(text)      — pure function, returns sanitized copy
 *   promptInjectionMiddleware — Express middleware; sanitizes req.body.message,
 *                               req.body.prompt, and req.body.content
 */

import type { Request, Response, NextFunction } from "express";

// ─── Injection patterns ───────────────────────────────────────────────────────

const INJECTION_PATTERNS: RegExp[] = [
  // Classic role overrides
  /ignore\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|context|directions?)/gi,
  /disregard\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|context)/gi,
  /forget\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|context)/gi,

  // Role / persona injections
  /you\s+are\s+now\s+(a\s+)?(?:dan|jailbreak|evil|uncensored|unlimited)/gi,
  /pretend\s+(you\s+are|to\s+be)\s+(?:a\s+)?(?:dan|jailbreak|evil|uncensored)/gi,
  /act\s+as\s+(if\s+you\s+are\s+)?(?:a\s+)?(?:dan|jailbreak|evil|uncensored|an?\s+ai\s+with\s+no)/gi,

  // System prompt exfiltration attempts
  /repeat\s+(your\s+)?(system|hidden|secret)\s+(prompt|instructions?|context)/gi,
  /print\s+(your\s+)?(system|hidden|secret)\s+(prompt|instructions?)/gi,
  /reveal\s+(your\s+)?(system|hidden|secret)\s+(prompt|instructions?)/gi,
  /what\s+(is|are)\s+(your\s+)?(system|hidden|secret)\s+(prompt|instructions?)/gi,
  /output\s+(your\s+)?(system|hidden|initial)\s+(prompt|instructions?)/gi,
  /show\s+(me\s+)?(your\s+)?(system|hidden)\s+(prompt|instructions?)/gi,

  // Instruction boundary bypasses
  /---\s*(new|override|system)\s*(instructions?|prompt)/gi,
  /\[\s*(system|override|new\s+instruction)\s*\]/gi,
  /<\s*system\s*>/gi,
  /\/\*.*system.*instructions.*\*\//gi,

  // Classic jailbreak phrases
  /do\s+anything\s+now/gi,
  /developer\s+mode\s+(enabled|on|activated)/gi,
  /token\s+budget\s+exceeded/gi,
  /hypothetically\s+speaking,?\s+if\s+you\s+had\s+no\s+(restrictions|rules|guidelines)/gi,
];

const REDACTION_PLACEHOLDER = "[content removed by safety filter]";

// ─── Pure sanitizer ───────────────────────────────────────────────────────────

export function sanitizePrompt(text: string): string {
  if (typeof text !== "string") return text;
  let sanitized = text;
  for (const pattern of INJECTION_PATTERNS) {
    sanitized = sanitized.replace(pattern, REDACTION_PLACEHOLDER);
  }
  return sanitized;
}

// ─── Express middleware ───────────────────────────────────────────────────────

/**
 * Sanitizes common body fields used by AI endpoints.
 * Safe to apply broadly — only modifies string fields.
 */
export function promptInjectionMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  if (req.body && typeof req.body === "object") {
    const fieldsToSanitize = ["message", "prompt", "content", "query", "input", "text"];
    for (const field of fieldsToSanitize) {
      if (typeof req.body[field] === "string") {
        const original = req.body[field] as string;
        const sanitized = sanitizePrompt(original);
        if (sanitized !== original) {
          console.warn(
            `[promptInjection] Potential injection detected and sanitized in field "${field}" from ${req.ip}`
          );
        }
        req.body[field] = sanitized;
      }
    }

    // Also sanitize nested messages array (OpenAI chat format)
    if (Array.isArray(req.body.messages)) {
      req.body.messages = (req.body.messages as any[]).map((msg: any) => {
        if (msg && typeof msg.content === "string") {
          const original = msg.content as string;
          const sanitized = sanitizePrompt(original);
          if (sanitized !== original) {
            console.warn(
              `[promptInjection] Potential injection sanitized in messages[].content from ${req.ip}`
            );
          }
          return { ...msg, content: sanitized };
        }
        return msg;
      });
    }
  }
  next();
}
