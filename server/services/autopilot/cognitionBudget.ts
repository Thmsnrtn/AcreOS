/**
 * CognitionBudget — a per-tick ceiling on the brain's LLM calls (kernel-elevation
 * T2.1). KERNEL (domain-agnostic, pure).
 *
 * The gate stack already meters MONEY (the monthly ensemble cap, fail-closed).
 * But cognition spend is per-CALL and per-TICK: the loop deliberates, runs a
 * pre-mortem per high-stakes move, and — once the Operator is wired (T2.3) —
 * could propose a dozen net-new candidates, each potentially triggering model
 * calls. Unbounded, a single tick could fire ~24 calls against a $50/mo budget,
 * and the money gate that would catch it lives INSIDE the loop it throttles (a
 * control deadlock). This is the cheap, deadlock-free backpressure: a simple
 * per-tick call counter, checked BEFORE each cognition call, that degrades to
 * the deterministic path when exhausted — never a money gate, never a hang.
 *
 * It is a CEILING, not a meter: exceeding it skips OPTIONAL cognition (the loop
 * still runs its deterministic reflexes), so running out is always safe.
 */

/** Default per-tick cognition-call ceiling; override via env. */
export const COGNITION_CALLS_PER_TICK = (() => {
  const n = Number(process.env.AUTOPILOT_COGNITION_CALLS_PER_TICK);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 8;
})();

export class CognitionBudget {
  private consumed = 0;
  constructor(private readonly ceiling: number = COGNITION_CALLS_PER_TICK) {}

  /** Reserve one cognition call. Returns false once the ceiling is reached. */
  tryConsume(): boolean {
    if (this.consumed >= this.ceiling) return false;
    this.consumed += 1;
    return true;
  }

  get used(): number {
    return this.consumed;
  }
  remaining(): number {
    return Math.max(0, this.ceiling - this.consumed);
  }
  get exhausted(): boolean {
    return this.consumed >= this.ceiling;
  }

  /**
   * Wrap a model-call fn so each invocation first reserves budget; once
   * exhausted it returns "" (an empty completion the parsers treat as
   * no-signal → the caller falls back to its deterministic path). `onExhausted`
   * fires once per exhausted call for logging. A null fn stays null.
   */
  wrap(
    fn: ((prompt: string) => Promise<string>) | null,
    onExhausted?: () => void,
  ): ((prompt: string) => Promise<string>) | null {
    if (!fn) return null;
    return async (prompt: string) => {
      if (!this.tryConsume()) {
        onExhausted?.();
        return "";
      }
      return fn(prompt);
    };
  }
}
