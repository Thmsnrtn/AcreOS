/**
 * Refund automation — the named numbers, in ONE place (design 2026-11 §3.3).
 *
 * Nothing in server/services/refunds/ or the routes may restate these as a
 * literal; import them.
 */

/** §5A's own window: a first charge is guarantee-covered for this many days. */
export const GUARANTEE_WINDOW_DAYS = 30;

/** The internal decision SLA for a queued request: createdAt + this. */
export const REFUND_DECISION_SLA_HOURS = 24;

/** Severity raise + founder ask once a request is this long past its dueAt. */
export const REFUND_ESCALATION_AFTER_DUE_HOURS = 24;

/** Pre-call execution failures retried by the sweep up to this many attempts. */
export const REFUND_MAX_AUTO_ATTEMPTS = 3;

/** Retry backoff: attempts × base, capped. */
export const REFUND_RETRY_BASE_MS = 5 * 60 * 1000;
export const REFUND_RETRY_MAX_MS = 6 * 60 * 60 * 1000;

/**
 * B7 — platform velocity brake.
 *
 * ⚠ PROPOSAL, NOT A RATIFIED NUMBER. These values are Muse's proposal
 * (refund-automation design §3.3 B7 / §6) pending founder ratification at
 * build review. When the rolling window already holds `maxCount` automatic
 * guarantee refunds, or would exceed `maxCents` with the next one, automation
 * pauses platform-wide: eligible requests queue with brake B7 and the founder
 * is paged. It protects against a signup farm draining the platform through
 * $1,990 annuals. Changing it is a one-line edit here and nowhere else.
 */
export const GUARANTEE_REFUND_VELOCITY = {
  /** Rolling window length, hours. */
  windowHours: 24,
  /** Automatic guarantee refunds allowed in the window. */
  maxCount: 10,
  /** Automatic guarantee refund dollars allowed in the window, in cents ($5,000). */
  maxCents: 500_000,
} as const;
