/**
 * Panel-300 #7 — prompt-injection sanitizer.
 *
 * Wraps user-supplied content before it's passed to a downstream LLM.
 * Detects common injection patterns (role-confusion, instruction-
 * override, system-prompt-leak attempts) and either escapes them
 * (default) or rejects (strict mode).
 *
 * NOT a substitute for Anthropic's / OpenAI's own input filters; this
 * is the AcreOS-side belt-and-suspenders. Adversarial-stress (Magdalena +
 * Galvin) explicitly flagged that role-confusion attacks via lead-imported
 * notes / property-description fields will reach Pax draft surfaces and
 * exfiltrate system prompts unless sanitized at the boundary.
 */

const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(?:all\s+)?(?:previous|prior|above)\s+(?:instructions|prompts|rules)/i,
  /you\s+are\s+now\s+(?:a\s+)?[a-z]+/i, // "you are now a pirate" style
  /system\s*:\s*/i,
  /\<\s*\/?(?:system|assistant|user)\s*\>/i, // role-tag injection
  /(?:print|output|reveal|show)\s+(?:your|the)\s+(?:system\s+)?prompt/i,
  /forget\s+(?:everything|all|your\s+instructions)/i,
  /act\s+as\s+(?:if|though)\s+/i,
  /(?:###|---)\s*end\s+of\s+(?:document|context|prompt)/i,
];

const SUSPICIOUS_TOKENS = [
  "{{system}}",
  "<|im_start|>",
  "<|im_end|>",
  "<|system|>",
  "[INST]",
  "[/INST]",
];

export class PromptInjectionDetectedError extends Error {
  readonly code = "PROMPT_INJECTION_DETECTED" as const;
  constructor(public readonly pattern: string, public readonly snippet: string) {
    super(`Prompt-injection pattern detected: "${pattern}" near: "${snippet.slice(0, 80)}…"`);
    this.name = "PromptInjectionDetectedError";
  }
}

export interface SanitizeOptions {
  /** When true, throw PromptInjectionDetectedError on detection. When false (default), escape suspicious patterns. */
  strict?: boolean;
}

/**
 * Sanitize user-supplied content for LLM consumption.
 *
 * Default mode escapes suspicious patterns by replacing them with
 * `[REDACTED:injection-attempt]` markers; the LLM still sees the
 * surrounding text, but the injection vector is neutralized.
 *
 * Strict mode throws on detection — use for high-trust surfaces
 * (compliance disclosure generation, contract drafting) where any
 * detected injection should hard-stop the request.
 */
export function sanitizePromptInput(input: string, options: SanitizeOptions = {}): string {
  if (!input) return "";
  let result = input;

  for (const pattern of INJECTION_PATTERNS) {
    const match = result.match(pattern);
    if (match) {
      if (options.strict) {
        throw new PromptInjectionDetectedError(pattern.source, match[0]);
      }
      result = result.replace(pattern, "[REDACTED:injection-attempt]");
    }
  }

  for (const token of SUSPICIOUS_TOKENS) {
    if (result.includes(token)) {
      if (options.strict) {
        throw new PromptInjectionDetectedError(token, token);
      }
      result = result.split(token).join("[REDACTED:role-token]");
    }
  }

  return result;
}

/**
 * Convenience: sanitize an object's string fields recursively (useful
 * for lead/property/note records before they hit the AI router).
 */
export function sanitizeObjectStringFields<T extends Record<string, unknown>>(
  obj: T,
  options: SanitizeOptions = {},
): T {
  const out: Record<string, unknown> = { ...obj };
  for (const [k, v] of Object.entries(out)) {
    if (typeof v === "string") {
      out[k] = sanitizePromptInput(v, options);
    } else if (v && typeof v === "object" && !Array.isArray(v)) {
      out[k] = sanitizeObjectStringFields(v as Record<string, unknown>, options);
    } else if (Array.isArray(v)) {
      out[k] = v.map((item) =>
        typeof item === "string"
          ? sanitizePromptInput(item, options)
          : item && typeof item === "object"
            ? sanitizeObjectStringFields(item as Record<string, unknown>, options)
            : item,
      );
    }
  }
  return out as T;
}
