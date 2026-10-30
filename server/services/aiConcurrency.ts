/**
 * aiConcurrency — the per-org bound on AI tasks in flight (G10, 2026-10-30).
 *
 * Rate limiters bound throughput; nothing bounded in-flight work. A client
 * sending slow AI calls inside the rate window, or a stuck retry loop, could
 * hold unbounded provider calls open for one org. This is the bound: at most
 * AI_ORG_CONCURRENCY_CAP tasks in flight per org; the next gets a 429
 * AI_CONCURRENCY_EXCEEDED with Retry-After until a slot frees.
 *
 * ONE counter, shared by both metered entry points (routeAITask and
 * aiSpendGuard.meteredChatCompletion / meteredAnthropicMessage) — two
 * independent counters would each allow the cap.
 *
 * COO-proposed value (5); the founder may overturn it at merge. It is changed
 * here, in code, never silently via env.
 *
 * Known limit: the counter is in-memory and PER INSTANCE, so the effective
 * bound is cap × instances. Redis-backed enforcement is the follow-up.
 */

import { logger } from "../utils/logger";

export const AI_ORG_CONCURRENCY_CAP = 5;
const RETRY_AFTER_SECONDS = 2;

const inFlight = new Map<number, number>();

/** Thrown for the (cap+1)th concurrent AI task for one org. Surfaced as HTTP 429. */
export class AIConcurrencyExceeded extends Error {
  readonly statusCode = 429;
  readonly code = "AI_CONCURRENCY_EXCEEDED";
  readonly retryAfterSeconds = RETRY_AFTER_SECONDS;
  readonly cap: number;

  constructor(cap: number) {
    super(`Too many AI tasks are running at once for this organization (limit ${cap}). Please retry shortly.`);
    this.name = "AIConcurrencyExceeded";
    this.cap = cap;
  }
}

/**
 * Run `fn` holding one of the org's slots. The slot is taken synchronously and
 * released in `finally`, so success, throw, timeout and abort all free it.
 * No org (platform-internal / founder calls) → not bounded here.
 */
export async function withAiConcurrencySlot<T>(
  orgId: number | null | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  if (orgId == null) return fn();
  const current = inFlight.get(orgId) ?? 0;
  if (current >= AI_ORG_CONCURRENCY_CAP) {
    logger.warn("[aiConcurrency] per-org AI concurrency cap hit — refusing", {
      metadata: { orgId, inFlight: current, cap: AI_ORG_CONCURRENCY_CAP },
    });
    throw new AIConcurrencyExceeded(AI_ORG_CONCURRENCY_CAP);
  }
  inFlight.set(orgId, current + 1);
  try {
    return await fn();
  } finally {
    const left = (inFlight.get(orgId) ?? 1) - 1;
    if (left <= 0) inFlight.delete(orgId);
    else inFlight.set(orgId, left);
  }
}

/** Slots currently held for an org (observability + tests). */
export function aiConcurrencyInFlight(orgId: number): number {
  return inFlight.get(orgId) ?? 0;
}

/** Test seam: forget every held slot. */
export function __resetAiConcurrencyForTests(): void {
  inFlight.clear();
}
