/**
 * Circuit breaker for external service calls.
 *
 * States:
 *   CLOSED   — normal operation, requests pass through
 *   OPEN     — too many failures; requests fail fast for `resetTimeoutMs`
 *   HALF_OPEN — trial period; one request allowed; if successful -> CLOSED
 *
 * Supports both consecutive-failure counting AND sliding-window failure
 * tracking (monitorWindowMs). The circuit opens when EITHER threshold is
 * reached — whichever fires first.
 *
 * Usage:
 *   const cb = new CircuitBreaker("openai", { failureThreshold: 5, resetTimeoutMs: 30_000 });
 *   const result = await cb.call(() => openai.chat.completions.create(...));
 */

import { logger } from "./logger";

type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitBreakerOptions {
  /** Number of consecutive failures before opening the circuit. Default: 5 */
  failureThreshold?: number;
  /** Milliseconds to wait in OPEN state before transitioning to HALF_OPEN. Default: 30_000 */
  resetTimeoutMs?: number;
  /** Sliding window in ms to count failures (default: 60_000). If the number of
   *  failures within this window reaches failureThreshold, the circuit opens. */
  monitorWindowMs?: number;
  /** Optional callback invoked when circuit state changes */
  onStateChange?: (name: string, from: CircuitState, to: CircuitState) => void;
}

export class CircuitBreaker {
  private state: CircuitState = "CLOSED";
  private consecutiveFailures = 0;
  private failureTimestamps: number[] = [];
  private lastFailureTime = 0;

  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;
  private readonly monitorWindowMs: number;
  private readonly onStateChange?: (name: string, from: CircuitState, to: CircuitState) => void;

  constructor(
    private readonly name: string,
    options: CircuitBreakerOptions = {}
  ) {
    this.failureThreshold = options.failureThreshold ?? 5;
    this.resetTimeoutMs = options.resetTimeoutMs ?? 30_000;
    this.monitorWindowMs = options.monitorWindowMs ?? 60_000;
    this.onStateChange = options.onStateChange;
  }

  /** Execute `fn` through the circuit breaker. Optionally provide a fallback
   *  that is returned when the circuit is open instead of throwing. */
  async call<T>(fn: () => Promise<T>, fallback?: () => T): Promise<T> {
    if (this.state === "OPEN") {
      if (Date.now() - this.lastFailureTime >= this.resetTimeoutMs) {
        this.transition("HALF_OPEN");
      } else {
        logger.warn(`Circuit breaker [${this.name}] is OPEN — skipping call`, {
          metadata: { retryAfterMs: this.resetTimeoutMs - (Date.now() - this.lastFailureTime) },
        });
        if (fallback) return fallback();
        throw new CircuitOpenError(this.name, this.resetTimeoutMs - (Date.now() - this.lastFailureTime));
      }
    }

    try {
      const result = await fn();
      this.onSuccessInternal();
      return result;
    } catch (err) {
      this.onFailureInternal();
      throw err;
    }
  }

  get currentState(): CircuitState {
    return this.state;
  }

  /** Number of failures in the current monitoring window. */
  getFailureCount(): number {
    const now = Date.now();
    this.failureTimestamps = this.failureTimestamps.filter(t => now - t < this.monitorWindowMs);
    return this.failureTimestamps.length;
  }

  /** Reset to closed state (for testing or manual recovery). */
  reset(): void {
    this.consecutiveFailures = 0;
    this.failureTimestamps = [];
    this.transition("CLOSED");
  }

  private onSuccessInternal(): void {
    this.consecutiveFailures = 0;
    this.failureTimestamps = [];
    if (this.state === "HALF_OPEN") {
      this.transition("CLOSED");
    }
  }

  private onFailureInternal(): void {
    const now = Date.now();
    this.consecutiveFailures++;
    this.lastFailureTime = now;

    // Sliding window tracking
    this.failureTimestamps = this.failureTimestamps.filter(t => now - t < this.monitorWindowMs);
    this.failureTimestamps.push(now);

    // Open if consecutive threshold hit OR window threshold hit
    if (
      this.state === "HALF_OPEN" ||
      this.consecutiveFailures >= this.failureThreshold ||
      this.failureTimestamps.length >= this.failureThreshold
    ) {
      this.transition("OPEN");
    }
  }

  private transition(to: CircuitState): void {
    if (this.state === to) return;
    const from = this.state;
    this.state = to;
    if (this.onStateChange) {
      try {
        this.onStateChange(this.name, from, to);
      } catch {
        // ignore errors in callback
      }
    }
    if (to === "OPEN") {
      logger.error(`Circuit breaker [${this.name}] OPENED after ${this.consecutiveFailures} consecutive failures (${this.failureTimestamps.length} in window)`);
    } else if (to === "CLOSED") {
      logger.info(`Circuit breaker [${this.name}] recovered — closing`);
    } else if (to === "HALF_OPEN") {
      logger.info(`Circuit breaker [${this.name}] transitioning to half-open`);
    }
  }
}

export class CircuitOpenError extends Error {
  constructor(name: string, retryAfterMs: number) {
    super(`Circuit breaker "${name}" is OPEN. Retry after ${Math.ceil(retryAfterMs / 1000)}s.`);
    this.name = "CircuitOpenError";
  }
}

// ── Pre-configured circuit breakers for external services ─────────────────────

const stateChangeLogger = (name: string, from: CircuitState, to: CircuitState): void => {
  logger.info(`Circuit breaker state change: ${name} ${from} -> ${to}`);
};

export const openAICircuitBreaker = new CircuitBreaker("openai", {
  failureThreshold: 5,
  resetTimeoutMs: 30_000,
  monitorWindowMs: 60_000,
  onStateChange: stateChangeLogger,
});

export const stripeCircuitBreaker = new CircuitBreaker("stripe", {
  failureThreshold: 3,
  resetTimeoutMs: 15_000,
  monitorWindowMs: 60_000,
  onStateChange: stateChangeLogger,
});

export const redisCircuitBreaker = new CircuitBreaker("redis", {
  failureThreshold: 5,
  resetTimeoutMs: 10_000,
  monitorWindowMs: 60_000,
  onStateChange: stateChangeLogger,
});

export const emailCircuitBreaker = new CircuitBreaker("email", {
  failureThreshold: 3,
  resetTimeoutMs: 60_000,
  monitorWindowMs: 120_000,
  onStateChange: stateChangeLogger,
});

// Breakers for data-source-broker external API categories
export const enrichmentCircuitBreaker = new CircuitBreaker("enrichment", {
  failureThreshold: 5,
  resetTimeoutMs: 45_000,
  monitorWindowMs: 60_000,
  onStateChange: stateChangeLogger,
});

export const countyApiCircuitBreaker = new CircuitBreaker("county_api", {
  failureThreshold: 5,
  resetTimeoutMs: 60_000,
  monitorWindowMs: 120_000,
  onStateChange: stateChangeLogger,
});

export const twilioCircuitBreaker = new CircuitBreaker("twilio", {
  failureThreshold: 3,
  resetTimeoutMs: 30_000,
  monitorWindowMs: 60_000,
  onStateChange: stateChangeLogger,
});

/** Convenience map for looking up breakers by service name. */
export const circuitBreakers = {
  stripe: stripeCircuitBreaker,
  openai: openAICircuitBreaker,
  enrichment: enrichmentCircuitBreaker,
  county_api: countyApiCircuitBreaker,
  twilio: twilioCircuitBreaker,
  redis: redisCircuitBreaker,
  email: emailCircuitBreaker,
} as const;
