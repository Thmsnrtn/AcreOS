/**
 * server/utils/injectionRateLimiter.ts — Phase 4 Week 21-22 (Sayuri §2.3 hardening).
 *
 * Per-user rate limiter for prompt-injection attempts. Each call into
 * `recordAttemptIfDetected` runs the input through the same deny-list
 * `sanitizePrompt` redacts with — literally the same arrays, via
 * `detectInjectionPatterns()`, since unit 111. This sentence used to say "the
 * same regex set" while the file held a hand-copied SUBSET of it, which meant
 * the count below systematically missed attacks the sanitizer caught. If any
 * pattern matches, we:
 *
 *   1. Insert a row into ai_injection_attempts.
 *   2. Count the user's attempts in the last 1h.
 *   3. If count > THRESHOLD, also insert an audit_events row tagged
 *      "ai.injection_rate_limit" and return `blocked: true` so the caller
 *      can short-circuit with a 429.
 *
 * Designed to be drop-in: every customer-facing AI route should call
 * `recordAttemptIfDetected({ userId, organizationId, surface, input })`
 * before invoking the LLM. Returns { matched, blocked } — when matched
 * is true the input is suspicious; when blocked is true the user has
 * crossed the threshold and the caller should refuse.
 *
 * Storage:
 *   • ai_injection_attempts (migration 0065) for the rolling 1h window.
 *   • audit_events for the high-priority alert, queryable by founder dash.
 *
 * Failure mode:
 *   • All DB writes are swallowed if the table is unreachable. The
 *     in-process counter still increments so a single suspicious user
 *     can be detected even when the audit DB is down.
 */

import { logger } from "./logger";
import { detectInjectionPatterns } from "./sanitizePrompt";

// PATTERNS COME FROM THE ONE OWNER. This block used to hold a hand-copied
// subset of server/utils/sanitizePrompt.ts's arrays — 9 markers where there were
// 15, 10 phrases where there were 20 — beneath a header claiming it ran "the
// same INJECTION_PHRASES/MARKERS regex set used by sanitizePrompt" (unit 111).
// It did not, so probes the sanitizer redacted never reached this counter and
// the founder-visible attempt count was a systematic undercount.
const WINDOW_MS = 60 * 60 * 1000; // 1 hour
const DEFAULT_THRESHOLD = 3;

// In-memory counter — DB row is the source of truth, but the counter lets
// us short-circuit on hot paths without a DB round-trip.
const counterByUser = new Map<string, number[]>();

/** Delegates: one deny-list, so detection and redaction cannot disagree. */
function detectPatterns(input: string): string[] {
  return detectInjectionPatterns(input);
}

function pruneAndCount(userId: string, now: number): number {
  const arr = counterByUser.get(userId) ?? [];
  const recent = arr.filter((t) => now - t < WINDOW_MS);
  if (recent.length !== arr.length) counterByUser.set(userId, recent);
  return recent.length;
}

export interface RateLimitInput {
  userId?: string | null;
  organizationId?: number | null;
  surface: string;
  input: string;
  threshold?: number;
}

export interface RateLimitResult {
  /** True if the input matched an injection pattern. */
  matched: boolean;
  /** True if the user has crossed the threshold and should be blocked. */
  blocked: boolean;
  /** Patterns that matched. */
  matchedPatterns: string[];
  /** Current attempt count in the last hour. */
  recentCount: number;
}

/**
 * Scan the input for injection patterns. If matched, log the attempt and
 * (optionally) signal that the user should be blocked.
 */
export async function recordAttemptIfDetected(req: RateLimitInput): Promise<RateLimitResult> {
  const matched = detectPatterns(req.input ?? "");
  if (matched.length === 0) {
    return { matched: false, blocked: false, matchedPatterns: [], recentCount: 0 };
  }

  const now = Date.now();
  const key = req.userId ?? `org:${req.organizationId ?? "anon"}`;
  const arr = counterByUser.get(key) ?? [];
  arr.push(now);
  counterByUser.set(key, arr);
  const recentCount = pruneAndCount(key, now);
  const threshold = req.threshold ?? DEFAULT_THRESHOLD;
  const blocked = recentCount > threshold;

  // Persist (fire-and-forget) — never block the request path on a write.
  void (async () => {
    try {
      const { db } = await import("../db");
      const { aiInjectionAttempts } = await import("@shared/schema");
      const { chainAndInsertAuditEvent } = await import("./auditEventsChain");
      await db.insert(aiInjectionAttempts).values({
        userId: req.userId ?? null,
        organizationId: req.organizationId ?? null,
        surface: req.surface,
        matchedPatterns: matched.slice(0, 10),
        inputPreview: (req.input ?? "").slice(0, 200),
      });
      if (blocked) {
        await chainAndInsertAuditEvent({
          actorUserId: req.userId ?? null,
          action: "ai.injection_rate_limit",
          targetType: "user",
          targetId: req.userId ?? `org:${req.organizationId ?? "anon"}`,
          justification: `prompt-injection attempts > ${threshold} in 1h`,
          metadata: {
            surface: req.surface,
            recentCount,
            matchedPatterns: matched.slice(0, 10),
            organizationId: req.organizationId ?? null,
          },
        });
      }
    } catch (err) {
      logger.warn("[injectionRateLimiter] persist failed", {
        metadata: { detail: err instanceof Error ? err.message : String(err) },
      });
    }
  })();

  return { matched: true, blocked, matchedPatterns: matched, recentCount };
}

// Test helpers
export const __testOnly = {
  detectPatterns,
  resetCounters: (): void => counterByUser.clear(),
  WINDOW_MS,
  DEFAULT_THRESHOLD,
};
