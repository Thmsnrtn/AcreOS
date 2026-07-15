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

import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { logger } from "./logger";
import { USER_DATA_OPEN, USER_DATA_CLOSE } from "./sanitizePrompt";
import { db } from "../db";
import { paxRefusalPayloads } from "@shared/schema/pax-refusal-payloads";
import { soleneConstitutionalViolations } from "@shared/schema/solene-constitutional-violations";
import {
  customerImmutableByNumber,
  sovereignPrincipleById,
} from "@sovereign/immutables";

/**
 * Markers and verbatim strings that indicate a system-prompt leak.
 * Each entry is matched case-insensitively. Add new entries as the Pax
 * prompt evolves — anything that should NEVER appear in a customer-
 * visible response belongs here.
 *
 * EXPORTED so Beatrice's continuousAudit service can re-use the exact
 * same gate at sampling time without forking a second copy. The
 * per-response validator below is the synchronous fast-path; the audit
 * service is the asynchronous sampling-floor.
 */
export const LEAK_PATTERNS: RegExp[] = [
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
  // Internal AI-executive codename self-identification — Pax-only is constitutional
  // (§ persona-architecture). Match only the self-identification phrasings most
  // likely to come from a system-prompt leak ("I am Atlas", "as Solene", etc.),
  // NOT bare mentions — "Atlas Property Management" is a real company a customer
  // might legitimately ask about, and false positives would replace a useful
  // response with the SAFE_FALLBACK. Beatrice Phase Zero-Three audit.
  /\bI\s+am\s+(Sophie|Forge|Atlas|Lena|Iris|Soren|Beatrice|Solene|Andrei|Maren|Tess|Quinn|Rafe|Eleonora|Krieger|Kai)\b/i,
  /\bI'm\s+(Sophie|Forge|Atlas|Lena|Iris|Soren|Beatrice|Solene|Andrei|Maren|Tess|Quinn|Rafe|Eleonora|Krieger|Kai)\b/i,
  /\bas\s+(Sophie|Forge|Atlas|Lena|Iris|Soren|Beatrice|Solene|Andrei|Maren|Tess|Quinn|Rafe|Eleonora|Krieger|Kai)[\s,]/i,
  /\bMy\s+name\s+is\s+(Sophie|Forge|Atlas|Lena|Iris|Soren|Beatrice|Solene|Andrei|Maren|Tess|Quinn|Rafe|Eleonora|Krieger|Kai)\b/i,
];

const SAFE_FALLBACK =
  "I ran into an issue formatting that response. Could you rephrase or try again?";

// ============================================================================
// FIDUCIARY-DISCLAIMER APPENDER (L1 liability shield)
// ----------------------------------------------------------------------------
// Constitution Immutable #12: "Pax never gives fiduciary advice"
// (docs/company/CONSTITUTION.md). Until now that immutable was enforced only
// post-hoc by the continuous-audit sampling floor
// (server/services/pax/continuousAudit.ts advisor_phrasing detector). This
// synchronous companion APPENDS a one-line disclaimer when advisor phrasing
// lands in an investment/legal/tax/deal-decision context — it NEVER blocks,
// truncates, or rewrites the response body. The original text is preserved
// byte-for-byte; the only change is the appended line.
//
// The advisor-phrasing pattern list is the single source of truth shared
// with continuousAudit (same convention as LEAK_PATTERNS above — the
// per-response validator exports, the audit service imports).
// ============================================================================

/** Advisor-phrasing patterns. Immutable §12. Shared with continuousAudit. */
export const ADVISOR_PHRASING_PATTERNS: RegExp[] = [
  /\byou\s+should\b/i,
  /\bI\s+recommend\b/i,
  /\bmy\s+advice\b/i,
  /\bI\s+suggest\s+you\b/i,
  /\bif\s+I\s+were\s+you\b/i,
  /\byou\s+ought\s+to\b/i,
];

/**
 * Rendering-language exclusions — these phrases use "you should" but in a
 * "the UI should let you do X" sense, which is not fiduciary advice.
 * Shared with continuousAudit.
 */
export const ADVISOR_FALSE_POSITIVE_EXCLUSIONS: RegExp[] = [
  /you\s+should\s+(be\s+able\s+to\s+see|see|find|notice)/i,
  /you\s+should\s+now\s+be\s+able\s+to/i,
];

/**
 * Decision-context nouns that scope the appender. Advisor phrasing alone is
 * often benign product guidance ("you should connect your Twilio account");
 * the disclaimer only appends when the phrasing lands NEAR an
 * investment/legal/tax/deal-decision noun.
 */
const FIDUCIARY_CONTEXT_NOUNS =
  /\b(invest\w*|buy\w*|sell\w*|offer\w*|loan\w*|note\w*|deed\w*|legal\w*|tax\w*|foreclos\w*)\b/i;

/** Chars of context on each side of an advisor match to scan for nouns. */
const FIDUCIARY_CONTEXT_WINDOW_CHARS = 120;

/** The single appended line — ToS vocabulary, never a novel legal claim. */
export const FIDUCIARY_DISCLAIMER_LINE =
  "This is informational analysis, not investment, legal, or tax advice — AcreOS is not your fiduciary.";

/**
 * Does the response already carry a fiduciary/advice disclaimer? Covers the
 * appended line itself (idempotence on re-validation), the client-side
 * RequiredDisclaimer copy, and the legalDisclaimers legends.
 */
const EXISTING_FIDUCIARY_DISCLAIMER =
  /fiduciary|\bnot\s+(?:investment|legal|tax|financial)[^.\n]{0,80}\badvice\b|\binformational\s+(?:only|analysis|purposes)\b/i;

/**
 * Detect advisor phrasing scoped to a decision context. Returns the sources
 * of the advisor patterns that matched near a decision noun (empty array =
 * nothing to disclaim). Pure + exported for tests.
 */
export function detectFiduciaryAdvisorPhrasing(response: string): string[] {
  // Scrub rendering-language false positives first (detection only — the
  // surfaced response is never modified by this scrub), then re-test.
  let scrubbed = response;
  for (const re of ADVISOR_FALSE_POSITIVE_EXCLUSIONS) {
    scrubbed = scrubbed.replace(re, "");
  }
  const matched: string[] = [];
  for (const re of ADVISOR_PHRASING_PATTERNS) {
    const global = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
    let m: RegExpExecArray | null;
    while ((m = global.exec(scrubbed)) !== null) {
      const start = Math.max(0, m.index - FIDUCIARY_CONTEXT_WINDOW_CHARS);
      const end = Math.min(
        scrubbed.length,
        m.index + m[0].length + FIDUCIARY_CONTEXT_WINDOW_CHARS,
      );
      if (FIDUCIARY_CONTEXT_NOUNS.test(scrubbed.slice(start, end))) {
        matched.push(re.source);
        break; // one hit per pattern is enough — we append at most one line
      }
      // Zero-width safety: RegExp.exec with a global flag can loop forever
      // on a zero-length match. None of the patterns can match empty, but
      // guard anyway.
      if (m[0].length === 0) global.lastIndex += 1;
    }
  }
  return matched;
}

export interface ValidatePaxResponseResult {
  safe: boolean;
  /** The response to surface to the user — either original or fallback. */
  response: string;
  /** Patterns that matched, for telemetry. */
  matchedPatterns: string[];
  /**
   * True when the fiduciary-disclaimer line was appended (Immutable #12).
   * Absent/false otherwise. The response body above is otherwise identical
   * to what the model produced — appending never blocks or rewrites.
   */
  fiduciaryDisclaimerAppended?: boolean;
}

export interface ValidatePaxResponseOptions {
  /** Tag for telemetry, e.g. "pax.chat" or "pax.draft-reply". */
  source?: string;
  /** Override the fallback message if a leak is detected. */
  fallback?: string;
  /** Org id for structured logging. */
  organizationId?: number | null;
  /** Optional conversation id (Pax conversation context). */
  conversationId?: number | null;
  /** Optional message id (the assistant message being validated). */
  messageId?: number | null;
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
    // Leak screen passed — run the fiduciary-disclaimer appender
    // (Immutable #12, "Pax never gives fiduciary advice"). APPEND-only:
    // the response body is surfaced byte-identical, plus at most one line.
    const advisorHits = detectFiduciaryAdvisorPhrasing(response);
    if (
      advisorHits.length > 0 &&
      !EXISTING_FIDUCIARY_DISCLAIMER.test(response)
    ) {
      try {
        // Structured warn tagged as the REAL-TIME appender so Beatrice's
        // continuousAudit sampled advisor_phrasing counts are never
        // double-counted against it. We deliberately do NOT write a
        // pax_audit_findings row here: those rows are keyed to a sampling
        // runId and feed the drift-ratio denominators — injecting
        // synchronous per-response hits would distort the sampling-floor
        // statistics. The audit service will independently sample and
        // count this same message if it lands in a window.
        logger.warn(
          "[validatePaxResponse] fiduciary disclaimer appended (Immutable #12) — realtime appender, distinct from continuousAudit sampling",
          {
            metadata: {
              source: opts.source ?? "unknown",
              organizationId: opts.organizationId ?? null,
              conversationId: opts.conversationId ?? null,
              messageId: opts.messageId ?? null,
              advisorPatterns: advisorHits,
              responseLength: response.length,
            },
          },
        );
      } catch {
        // logger must never break the response path
      }
      return {
        safe: true,
        response: `${response}\n\n${FIDUCIARY_DISCLAIMER_LINE}`,
        matchedPatterns: [],
        fiduciaryDisclaimerAppended: true,
      };
    }
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

  // Tahoe E9 — write a pax_refusal_payloads row so the customer recourse
  // path has data to surface. Fire-and-forget; the customer's response is
  // never blocked on the audit-row write.
  //
  // Citation: this validator catches prompt-leak / persona-architecture
  // breaches, which the constitution maps to customer immutable #7 (always
  // disclose AI use clearly). We use that as the canonical citation.
  if (opts.organizationId != null) {
    void recordRefusalPayload({
      organizationId: opts.organizationId,
      conversationId: opts.conversationId ?? null,
      messageId: opts.messageId ?? null,
      citedImmutableId: "customer:7",
      refusalText: opts.fallback ?? SAFE_FALLBACK,
      severity: "critical",
    }).catch((err) => {
      try {
        logger.warn("[validatePaxResponse] refusal-payload write failed", {
          metadata: { error: err instanceof Error ? err.message : String(err) },
        });
      } catch {
        // never throw out of the response path
      }
    });
  }

  // Tahoe H2 follow-up (Quinn) — converge the triad on one forensic ledger.
  // Today, postvalidate failures land in pax_refusal_payloads (E9) + the
  // per-org logger. The precall checker writes to solene_constitutional_violations.
  // The constitutionalGuard tool-call screen writes to
  // solene_constitutional_violations. Without this insert, postvalidate is
  // the ONLY surface of the precall/postvalidate/audit triad that doesn't
  // converge on the cross-cutting forensic ledger — so a daily-pulse query
  // over solene_constitutional_violations was missing all output-side
  // breaches.
  //
  // Fire-and-forget — never block the customer-facing response on this write.
  void recordPostvalidateViolation({
    matchedPatterns: matched,
    responsePreview: response.slice(0, 200),
    conversationId: opts.conversationId ?? null,
    messageId: opts.messageId ?? null,
    source: opts.source ?? "unknown",
  }).catch((err) => {
    try {
      logger.warn(
        "[validatePaxResponse] constitutional-violation write failed",
        { metadata: { error: err instanceof Error ? err.message : String(err) } },
      );
    } catch {
      // never throw out of the response path
    }
  });

  return {
    safe: false,
    response: opts.fallback ?? SAFE_FALLBACK,
    matchedPatterns: matched,
  };
}

// ============================================================================
// REFUSAL PAYLOAD EMITTER (Tahoe wave E9)
// ----------------------------------------------------------------------------
// Single chokepoint for "Pax just refused" rows. Other refusal emitters
// (the supportBrain validator, executive.ts streaming validator) call this
// directly so every refusal lands in pax_refusal_payloads with the canonical
// shape.
//
// Fire-and-forget — a failed write never blocks the customer-facing response.
// ============================================================================

export interface RecordRefusalPayloadInput {
  organizationId: number;
  conversationId?: number | null;
  messageId?: number | null;
  /** Canonical immutable id (e.g. "customer:7", "sovereign:1"). */
  citedImmutableId: string;
  refusalText: string;
  severity: "info" | "warn" | "critical";
}

/**
 * Resolve a canonical immutable id ("customer:N" / "sovereign:N") to its
 * PLAIN-LANGUAGE wording, snapshotted into the refusal row at write time.
 *
 * Why snapshot rather than re-derive at render time (Quinn alignment fix):
 * the appeal UI shows the customer WHY Pax refused. If the wording were
 * re-derived from the id when the appeal is viewed, a later constitutional
 * amendment that changes the text would retroactively rewrite what a PAST
 * refusal appears to have told the customer. Freezing the text here keeps the
 * appeal record faithful to what the customer actually received.
 *
 * Returns null when the id is malformed or doesn't resolve to a known
 * immutable — the column is nullable, and a null is honest ("we couldn't
 * snapshot the wording") rather than a fabricated string.
 *
 * Exported for the test suite.
 */
export function resolveCitedImmutableText(
  citedImmutableId: string,
): string | null {
  const match = /^(customer|sovereign):(\d+)$/.exec(citedImmutableId.trim());
  if (!match) return null;
  const num = Number.parseInt(match[2], 10);
  if (!Number.isFinite(num)) return null;
  if (match[1] === "customer") {
    // Prefer the fuller `text` (what LLM screeners see); fall back to `short`.
    const imm = customerImmutableByNumber(num);
    return imm ? imm.text ?? imm.short ?? null : null;
  }
  const principle = sovereignPrincipleById(num);
  return principle ? principle.text ?? principle.summary ?? null : null;
}

export async function recordRefusalPayload(
  input: RecordRefusalPayloadInput,
): Promise<void> {
  try {
    await db.insert(paxRefusalPayloads).values({
      organizationId: input.organizationId,
      conversationId: input.conversationId ?? null,
      messageId: input.messageId ?? null,
      citedImmutableId: input.citedImmutableId,
      // Snapshot the plain-language wording at write time — see
      // resolveCitedImmutableText for the alignment rationale.
      citedImmutableText: resolveCitedImmutableText(input.citedImmutableId),
      refusalText: input.refusalText,
      severity: input.severity,
    });
  } catch (err) {
    try {
      logger.warn("[recordRefusalPayload] db insert failed — refusal not persisted", {
        metadata: { error: err instanceof Error ? err.message : String(err) },
      });
    } catch {
      // never throw — this is best-effort telemetry
    }
  }
}

// ============================================================================
// POSTVALIDATE → solene_constitutional_violations WIRING (Tahoe H2 follow-up)
// ----------------------------------------------------------------------------
// Bridges the postvalidate gate into the cross-cutting forensic ledger so
// the precall + postvalidate + continuous-audit triad converges on one
// table. The per-org logger keeps working separately (the structured warn
// on prompt-leak detection above) — this is in ADDITION to that, not a
// replacement.
//
// Citation choice — load-bearing:
//
//   - Codename self-identification breaches map cleanly to customer
//     immutable #7 ("Always disclose AI use clearly"). The model's
//     leaking a non-Pax codename DIRECTLY undermines clear AI-use
//     disclosure: the customer was told they're talking to Pax; the
//     model just claimed it's Atlas.
//
//   - Direct prompt-template tokens + verbatim system-prompt giveaways
//     also breach #7 as their effect: the model has surfaced the AI
//     scaffolding, which is the inverse of clear AI disclosure (the
//     scaffolding leak collapses the "you're talking to Pax" framing).
//
// Both categories land as immutable #7 hits. The `triggerEvidence` column
// preserves which pattern fired, so retro analysis can distinguish them
// even though they share the immutable citation.
//
// Idempotence — same (conversationId, messageId) pair MUST NOT double-write
// even on retry. We hash both into the `toolInputHash` column (repurposed
// here as an idempotence key) and check before insert. The check is racy
// under concurrent writes, but conversation_id+message_id is conventionally
// single-writer per response, and a duplicate is graceful: cosmetic noise
// in the ledger, no functional harm.
// ============================================================================

interface RecordPostvalidateViolationInput {
  matchedPatterns: string[];
  responsePreview: string;
  conversationId: number | null;
  messageId: number | null;
  source: string;
}

/**
 * Compute a stable idempotence key from (conversationId, messageId). If
 * either is null, returns null — we don't dedupe rows without both halves
 * of the natural key, since "two leaks in the same conversation from two
 * unstamped emitters" is real signal we shouldn't collapse.
 */
function computeIdempotenceKey(
  conversationId: number | null,
  messageId: number | null,
): string | null {
  if (conversationId == null || messageId == null) return null;
  return createHash("sha256")
    .update(`postvalidate:${conversationId}:${messageId}`)
    .digest("hex");
}

export async function recordPostvalidateViolation(
  input: RecordPostvalidateViolationInput,
): Promise<void> {
  // Best-fit canonical immutable: #7 ("Always disclose AI use clearly").
  // Either category of leak (codename or prompt-template) undermines that.
  const immutable = customerImmutableByNumber(7);
  if (!immutable) {
    // Defensive — if the constitution ever amends past #7 the boot-time
    // citation validator in alignmentDetectors would catch it. We still
    // guard here so a missing immutable never crashes a customer response.
    logger.warn(
      "[recordPostvalidateViolation] customer immutable #7 missing from constitution — skipping",
    );
    return;
  }

  const idempotenceKey = computeIdempotenceKey(
    input.conversationId,
    input.messageId,
  );

  try {
    // Idempotence — check for an existing row with the same hash before
    // inserting. We use a raw SQL EXISTS check rather than relying on
    // a unique constraint (the column is shared with the constitutionalGuard
    // pathway's sha256-of-tool-input, where uniqueness would be wrong).
    if (idempotenceKey !== null) {
      const existing = await db.execute(sql`
        SELECT 1
        FROM solene_constitutional_violations
        WHERE tool_input_hash = ${idempotenceKey}
          AND trigger_kind = 'output_pattern'
        LIMIT 1
      `);
      const rows = (
        existing as unknown as { rows?: Array<unknown> }
      ).rows ?? [];
      if (rows.length > 0) {
        return; // already recorded — idempotent no-op.
      }
    }

    // Build a sanitized evidence string — the matched-pattern set + a
    // truncated response preview. Stays well clear of the 500-char
    // soft cap downstream code applies.
    const triggerEvidence = JSON.stringify({
      matchedPatterns: input.matchedPatterns.slice(0, 5),
      responsePreview: input.responsePreview.slice(0, 200),
      source: input.source,
    }).slice(0, 500);

    await db.insert(soleneConstitutionalViolations).values({
      // No dispatch context — postvalidate runs on the model output of a
      // customer-facing chat surface, not inside a Solene dispatch.
      dispatchId: null,
      immutableNumber: immutable.number,
      immutableText: immutable.short,
      triggerKind: "output_pattern",
      triggerEvidence,
      toolName: null,
      // tool_input_hash reused as the idempotence key — see comment above.
      toolInputHash: idempotenceKey,
      // Notably "warn" — the postvalidate gate has already replaced the
      // would-be leaky response with the SAFE_FALLBACK at this point. The
      // customer never saw the leak. That's a warn-class finding (something
      // the model TRIED, gate caught it), not critical (a breach actually
      // reached the customer). Matches Beatrice's severity-ladder discipline.
      severity: "warn",
      actionTaken: "logged_only",
      pageEventId: null,
    });
  } catch (err) {
    try {
      logger.warn(
        "[recordPostvalidateViolation] db insert failed — violation not persisted",
        { metadata: { error: err instanceof Error ? err.message : String(err) } },
      );
    } catch {
      // never throw — best-effort telemetry only
    }
  }
}

// Test seam — exposed so tests can verify the idempotence key shape without
// reaching into the DB layer.
export const __test_computeIdempotenceKey = computeIdempotenceKey;
