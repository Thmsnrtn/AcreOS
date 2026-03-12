/**
 * Minimal circuit breaker for external service calls.
 *
 * States:
 *   CLOSED   — normal operation, requests pass through
 *   OPEN     — too many failures; requests fail fast for `resetTimeoutMs`
 *   HALF_OPEN — trial period; one request allowed; if successful → CLOSED
 *
 * Usage:
 *   const cb = new CircuitBreaker("openai", { failureThreshold: 5, resetTimeoutMs: 30_000 });
 *   const result = await cb.call(() => openai.chat.completions.create(...));
 */

type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitBreakerOptions {
  /** Number of consecutive failures before opening the circuit. Default: 5 */
  failureThreshold?: number;
  /** Milliseconds to wait in OPEN state before transitioning to HALF_OPEN. Default: 30_000 */
  resetTimeoutMs?: number;
  /** Optional callback invoked when circuit state changes */
  onStateChange?: (name: string, from: CircuitState, to: CircuitState) => void;
}

export class CircuitBreaker {
  private state: CircuitState = "CLOSED";
  private failures = 0;
  private lastFailureTime = 0;

  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;
  private readonly onStateChange?: (name: string, from: CircuitState, to: CircuitState) => void;

  constructor(
    private readonly name: string,
    options: CircuitBreakerOptions = {}
  ) {
    this.failureThreshold = options.failureThreshold ?? 5;
    this.resetTimeoutMs = options.resetTimeoutMs ?? 30_000;
    this.onStateChange = options.onStateChange;
  }

  /** Execute `fn` through the circuit breaker. */
  async call<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === "OPEN") {
      if (Date.now() - this.lastFailureTime >= this.resetTimeoutMs) {
        this.transition("HALF_OPEN");
      } else {
        throw new CircuitOpenError(this.name, this.resetTimeoutMs - (Date.now() - this.lastFailureTime));
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  get currentState(): CircuitState {
    return this.state;
  }

  /** Reset to closed state (for testing or manual recovery). */
  reset(): void {
    this.failures = 0;
    this.transition("CLOSED");
  }

  private onSuccess(): void {
    this.failures = 0;
    if (this.state === "HALF_OPEN") {
      this.transition("CLOSED");
    }
  }

  private onFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();
    if (this.state === "HALF_OPEN" || this.failures >= this.failureThreshold) {
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
      console.warn(`[circuit-breaker] ${this.name}: OPEN after ${this.failures} consecutive failures`);
    } else if (to === "CLOSED") {
      console.log(`[circuit-breaker] ${this.name}: CLOSED (recovered)`);
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
  console.log(`[circuit-breaker] ${name}: ${from} → ${to}`);
};

export const openAICircuitBreaker = new CircuitBreaker("openai", {
  failureThreshold: 5,
  resetTimeoutMs: 30_000,
  onStateChange: stateChangeLogger,
});

export const stripeCircuitBreaker = new CircuitBreaker("stripe", {
  failureThreshold: 3,
  resetTimeoutMs: 15_000,
  onStateChange: stateChangeLogger,
});

export const redisCircuitBreaker = new CircuitBreaker("redis", {
  failureThreshold: 5,
  resetTimeoutMs: 10_000,
  onStateChange: stateChangeLogger,
});

export const emailCircuitBreaker = new CircuitBreaker("email", {
  failureThreshold: 3,
  resetTimeoutMs: 60_000,
  onStateChange: stateChangeLogger,
});
