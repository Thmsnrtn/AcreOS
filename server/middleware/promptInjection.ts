/**
 * F-A04-1: Prompt Injection Guard — the EXPRESS MIDDLEWARE.
 *
 * This file used to carry its own deny-list and its own exported
 * `sanitizePrompt`, which was a DIFFERENT function with the SAME NAME as
 * `server/utils/sanitizePrompt.ts`'s. Which defence a surface got therefore
 * depended on which import line it happened to use — and `server/ai/executive.ts`
 * had picked this one, whose list missed 14 of a 30-attack corpus that the
 * canonical list caught 20 of (unit 111).
 *
 * The deny-list is GONE from here. Its unique patterns — bracketed `[SYSTEM]`
 * tags, `--- new instructions:`, fenced ```system blocks, markdown-image
 * exfiltration, tool-abuse and base64 evasion — were merged into
 * `server/utils/sanitizePrompt.ts`, which is now the single owner. Nothing is
 * caught less than before; several things are caught that were not.
 *
 * What remains here is the part that is genuinely about Express: sanitizing the
 * well-known body fields on the way in. It delegates.
 *
 * DO NOT REINTRODUCE A PATTERN LIST IN THIS FILE. Add patterns to
 * server/utils/sanitizePrompt.ts; `singleInjectionSanitizer.test.ts` fails if a
 * second deny-list appears anywhere.
 */

import type { Request, Response, NextFunction } from "express";
import { logger } from "../utils/logger";
import { sanitizePromptInline, isInstructionProbe } from "../utils/sanitizePrompt";

// ─── Sanitizer: delegated, not duplicated ────────────────────────────────────

/**
 * Sanitize a request-body field. Thin re-export of the canonical sanitizer in
 * its inline (unwrapped) form: body fields are edited in place and handed on to
 * a route, so they must not acquire <<USER_DATA>> markers here — the envelope is
 * applied where the text is interpolated into a prompt, by the caller that knows
 * it is doing so (server/ai/untrustedEnvelope.ts).
 */
export function sanitizePrompt(text: string): string {
  if (typeof text !== "string") return text;
  return sanitizePromptInline(text, { source: "request-body" });
}

// ─── Express middleware ───────────────────────────────────────────────────────

/**
 * Sanitizes common body fields used by AI endpoints.
 * Safe to apply broadly — only modifies string fields.
 */
/**
 * What the middleware removed, for the handler downstream. A redaction is
 * silent in the text itself (the phrase becomes "[redacted]"), so without this
 * the assistant could only guess, and told a customer who typed "Print your
 * system prompt" that "part of your message didn't come through" (oracle pass
 * I6). Read with `promptRedactionOf(res)`.
 */
export interface PromptRedaction {
  fields: string[];
  /** True when a removed phrase asked to reveal or override the assistant's instructions. */
  instructionProbe: boolean;
}

export function promptRedactionOf(res: Response): PromptRedaction | null {
  const r = res.locals?.promptRedaction as PromptRedaction | undefined;
  return r && Array.isArray(r.fields) && r.fields.length > 0 ? r : null;
}

export function promptInjectionMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (req.body && typeof req.body === "object") {
    const fieldsToSanitize = ["message", "prompt", "content", "query", "input", "text"];
    const redacted: string[] = [];
    let instructionProbe = false;
    for (const field of fieldsToSanitize) {
      if (typeof req.body[field] === "string") {
        const original = req.body[field] as string;
        const sanitized = sanitizePrompt(original);
        if (sanitized !== original) {
          logger.warn(`[promptInjection] Potential injection detected and sanitized in field "${field}" from ${req.ip}`);
          redacted.push(field);
          if (isInstructionProbe(original)) instructionProbe = true;
        }
        req.body[field] = sanitized;
      }
    }
    if (redacted.length > 0 && res?.locals) {
      res.locals.promptRedaction = { fields: redacted, instructionProbe } satisfies PromptRedaction;
    }

    // Also sanitize nested messages array (OpenAI chat format)
    if (Array.isArray(req.body.messages)) {
      req.body.messages = (req.body.messages as any[]).map((msg: any) => {
        if (msg && typeof msg.content === "string") {
          const original = msg.content as string;
          const sanitized = sanitizePrompt(original);
          if (sanitized !== original) {
            logger.warn(`[promptInjection] Potential injection sanitized in messages[].content from ${req.ip}`);
          }
          return { ...msg, content: sanitized };
        }
        return msg;
      });
    }
  }
  next();
}
