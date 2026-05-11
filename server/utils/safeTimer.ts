/**
 * Timer-delay sanitization helpers.
 *
 * Node prints `TimeoutOverflowWarning: <n> does not fit in a 32-bit signed
 * integer` whenever `setTimeout`/`setInterval` is called with a delay that
 * isn't a positive int32, then silently coerces the delay to `1`. In
 * production that warning has flooded Fly logs because a few job/agent
 * code paths can pass values that came in from external data (env vars,
 * DB rows, retry-backoff math without a cap). Once the delay is `1`, the
 * timer fires immediately and the job behaves unpredictably.
 *
 * `coerceTimerDelay` is the canonical pre-flight:
 *
 *   - Number-coerces the input.
 *   - If the value is `NaN`, non-finite, or negative we *fail loud* by
 *     logging the offending value (and source label) and returning `null`
 *     so the caller can choose to skip the timer entirely.
 *   - Otherwise we clamp to `[0, INT32_MAX]`.
 *
 * The thin `safeSetTimeout` / `safeSetInterval` wrappers run the value
 * through `coerceTimerDelay` and refuse to schedule a timer when the
 * delay is unusable — this prevents the silent "fire-immediately"
 * behavior that masked the underlying bug.
 */

import { logger } from "./logger";

const INT32_MAX = 2_147_483_647;

export function coerceTimerDelay(value: unknown, source = "setTimeout"): number | null {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) {
    logger.warn(`[safeTimer] non-finite delay passed to ${source}, skipping timer`, {
      metadata: { value: String(value), valueType: typeof value },
    });
    return null;
  }
  if (n < 0) {
    logger.warn(`[safeTimer] negative delay passed to ${source}, skipping timer`, {
      metadata: { value: n },
    });
    return null;
  }
  // Floor + clamp. Values that would overflow int32 get capped at the max
  // representable delay (~24.8 days) rather than triggering the Node warning.
  return Math.min(Math.floor(n), INT32_MAX);
}

export function safeSetTimeout(
  fn: (...args: any[]) => void,
  delay: unknown,
  source = "setTimeout",
): NodeJS.Timeout | null {
  const coerced = coerceTimerDelay(delay, source);
  if (coerced === null) return null;
  return setTimeout(fn, coerced);
}

export function safeSetInterval(
  fn: (...args: any[]) => void,
  delay: unknown,
  source = "setInterval",
): NodeJS.Timeout | null {
  const coerced = coerceTimerDelay(delay, source);
  if (coerced === null) return null;
  return setInterval(fn, coerced);
}
