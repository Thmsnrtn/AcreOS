/**
 * Email suppression list service.
 *
 * Hessam §2.3: every outbound email send must consult this list before
 * dispatching to the provider. Hard bounces, spam reports, and unsubscribe
 * events seed the list; manual entries are also supported (e.g. founder
 * blocklist).
 *
 * The list is intentionally global (not per-org). A single recipient who
 * has marked one tenant's mail as spam should not receive mail from any
 * tenant on the platform — that's how SendGrid's domain reputation gets
 * destroyed across the customer base.
 */

import { db } from "../db";
import { emailSuppressions } from "@shared/schema";
import { eq, inArray } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { logger } from "../utils/logger";

export type SuppressionSource = "bounce" | "spam" | "unsubscribe" | "manual";

/**
 * Bounce-category taxonomy (Eleonora Phase 1 §10).
 *   - "hard"        — permanent failure (unknown user, blocked domain).
 *                     Always suppresses on first event.
 *   - "soft"        — transient failure (mailbox full, greylist, deferred).
 *                     Three strikes within 30 days → suppression.
 *   - "complaint"   — recipient hit the spam button. Immediate suppress +
 *                     founder alert.
 *   - "unsubscribe" — explicit user opt-out (link or one-click header).
 *   - "manual"      — founder/support added the address by hand.
 */
export type BounceCategory = "hard" | "soft" | "complaint" | "unsubscribe" | "manual";

/** Soft bounces accumulate strikes; this many strikes inside the window
 * promote the address to a permanent suppression. */
export const SOFT_BOUNCE_STRIKES_LIMIT = 3;
export const SOFT_BOUNCE_WINDOW_DAYS = 30;

function normalize(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Insert (or upsert with most-recent reason) a suppression entry.
 * Idempotent: repeat calls for the same address keep the original
 * suppressed_at timestamp but refresh the reason, source, and category.
 *
 * `bounceCategory` is the Eleonora taxonomy — "hard"/"soft"/"complaint"/
 * "unsubscribe"/"manual". Setting it to "soft" does NOT suppress on its
 * own — call `recordSoftBounce()` for that. The function is exposed so
 * callers can re-categorize an existing entry without changing other
 * fields.
 */
export async function suppress(
  email: string,
  reason: string,
  source: SuppressionSource,
  options?: { bounceCategory?: BounceCategory; organizationId?: number },
): Promise<void> {
  const normalized = normalize(email);
  if (!normalized) return;
  try {
    await db
      .insert(emailSuppressions)
      .values({
        email: normalized,
        reason,
        source,
        bounceCategory: options?.bounceCategory,
        organizationId: options?.organizationId,
      })
      .onConflictDoUpdate({
        target: emailSuppressions.email,
        set: {
          reason,
          source,
          bounceCategory: options?.bounceCategory,
          organizationId: options?.organizationId,
        },
      });
  } catch (err) {
    logger.error("[emailSuppressions] suppress failed", err instanceof Error ? err : undefined, {
      metadata: { email: normalized, reason, source },
    });
  }
}

/**
 * Increment the soft-bounce strike count for an address. When the count
 * reaches SOFT_BOUNCE_STRIKES_LIMIT inside SOFT_BOUNCE_WINDOW_DAYS, the
 * address is promoted to a permanent suppression.
 *
 * The "window" is enforced by resetting the strike counter when the most
 * recent strike is older than the window — that is, a slow drip of one
 * soft bounce every six weeks will never trip suppression, but three in
 * a month will.
 */
export async function recordSoftBounce(
  email: string,
  reason: string,
  options?: { organizationId?: number },
): Promise<{ suppressed: boolean; strikes: number }> {
  const normalized = normalize(email);
  if (!normalized) return { suppressed: false, strikes: 0 };
  const now = new Date();
  const windowMs = SOFT_BOUNCE_WINDOW_DAYS * 24 * 60 * 60 * 1000;

  try {
    // Read existing row.
    const rows = await db
      .select()
      .from(emailSuppressions)
      .where(eq(emailSuppressions.email, normalized))
      .limit(1);
    const existing = rows[0];

    // If already suppressed permanently (hard/complaint/unsubscribe/manual),
    // don't downgrade — return as-is.
    if (existing && existing.bounceCategory && existing.bounceCategory !== "soft") {
      return { suppressed: true, strikes: existing.softBounceCount ?? 0 };
    }

    let strikes: number;
    if (existing && existing.lastSoftBounceAt && now.getTime() - new Date(existing.lastSoftBounceAt).getTime() <= windowMs) {
      strikes = (existing.softBounceCount ?? 0) + 1;
    } else {
      strikes = 1;
    }

    if (strikes >= SOFT_BOUNCE_STRIKES_LIMIT) {
      // Promote to permanent suppression. We keep bounceCategory="soft"
      // because that's the etiology, but the source becomes "bounce" and
      // future filterSuppressed calls block the address.
      await db
        .insert(emailSuppressions)
        .values({
          email: normalized,
          reason: `soft_bounce_strikes_${strikes}: ${reason}`,
          source: "bounce",
          bounceCategory: "soft",
          organizationId: options?.organizationId,
          softBounceCount: strikes,
          lastSoftBounceAt: now,
        })
        .onConflictDoUpdate({
          target: emailSuppressions.email,
          set: {
            reason: `soft_bounce_strikes_${strikes}: ${reason}`,
            source: "bounce",
            bounceCategory: "soft",
            softBounceCount: strikes,
            lastSoftBounceAt: now,
          },
        });
      return { suppressed: true, strikes };
    }

    // Below threshold — record the strike but do not suppress. We still
    // upsert into email_suppressions so the strike counter is persisted,
    // but the source is left null so isSuppressed() returns false. The
    // table acts as the strike ledger as well as the blocklist.
    //
    // To keep filterSuppressed correct, we use a sentinel "tracking"
    // source that isn't checked anywhere. (Schema-level: source is
    // nullable — but conflict handling requires we set *something*.)
    if (existing) {
      await db
        .update(emailSuppressions)
        .set({
          softBounceCount: strikes,
          lastSoftBounceAt: now,
          bounceCategory: "soft",
          // Do NOT touch `source` if it's already non-null — that would
          // erase a real suppression. Leave source as-is.
        })
        .where(eq(emailSuppressions.email, normalized));
    } else {
      // We use a special source value "tracking" that filterSuppressed
      // treats specially: rows with source="tracking" are NOT considered
      // suppressed. See below.
      await db.insert(emailSuppressions).values({
        email: normalized,
        reason: `soft_bounce_strike_${strikes}: ${reason}`,
        source: "tracking" as SuppressionSource,
        bounceCategory: "soft",
        organizationId: options?.organizationId,
        softBounceCount: strikes,
        lastSoftBounceAt: now,
      });
    }
    return { suppressed: false, strikes };
  } catch (err) {
    logger.error("[emailSuppressions] recordSoftBounce failed", err instanceof Error ? err : undefined, {
      metadata: { email: normalized, reason },
    });
    return { suppressed: false, strikes: 0 };
  }
}

/**
 * Returns true if the address is on the suppression list.
 * Failures are logged and treated as "not suppressed" — we fail OPEN here
 * because a transient DB blip should not silently stop transactional mail.
 */
export async function isSuppressed(email: string): Promise<boolean> {
  const normalized = normalize(email);
  if (!normalized) return false;
  try {
    const rows = await db
      .select({ email: emailSuppressions.email, source: emailSuppressions.source })
      .from(emailSuppressions)
      .where(eq(emailSuppressions.email, normalized))
      .limit(1);
    if (rows.length === 0) return false;
    // "tracking" rows are soft-bounce ledger entries below the strike
    // threshold; they're not actual suppressions.
    return rows[0].source !== "tracking";
  } catch (err) {
    logger.warn("[emailSuppressions] isSuppressed lookup failed — failing open", {
      metadata: { email: normalized, error: (err as Error).message },
    });
    return false;
  }
}

/**
 * Bulk filter: returns the subset of `emails` that are NOT suppressed.
 * Used by bulk-send paths so we make one round-trip instead of N.
 */
export async function filterSuppressed(emails: string[]): Promise<{
  allowed: string[];
  suppressed: string[];
}> {
  const normalized = Array.from(new Set(emails.map(normalize).filter(Boolean)));
  if (normalized.length === 0) return { allowed: [], suppressed: [] };
  try {
    const rows = await db
      .select({ email: emailSuppressions.email, source: emailSuppressions.source })
      .from(emailSuppressions)
      .where(inArray(emailSuppressions.email, normalized));
    // "tracking" rows are soft-bounce ledger entries; they don't suppress.
    const blocked = new Set(rows.filter((r) => r.source !== "tracking").map((r) => r.email));
    return {
      allowed: normalized.filter((e) => !blocked.has(e)),
      suppressed: normalized.filter((e) => blocked.has(e)),
    };
  } catch (err) {
    logger.warn("[emailSuppressions] filterSuppressed lookup failed — failing open", {
      metadata: { error: (err as Error).message },
    });
    return { allowed: normalized, suppressed: [] };
  }
}

/** Manual unsuppress (founder/support tooling). */
export async function unsuppress(email: string): Promise<void> {
  const normalized = normalize(email);
  if (!normalized) return;
  await db.delete(emailSuppressions).where(eq(emailSuppressions.email, normalized));
}

/**
 * Map a SendGrid event to a categorized suppression record, or null if
 * the event should not produce a permanent suppression on its own.
 *
 * Per SendGrid docs:
 *   - bounce      → "type":"bounce" is a HARD bounce, suppress immediately.
 *                   "type":"blocked" is a SOFT bounce — strike-based.
 *   - spamreport  → COMPLAINT — immediate suppress + founder alert.
 *   - unsubscribe → unsubscribe — immediate suppress.
 *   - dropped     → SendGrid pre-flight reject — treat as hard bounce.
 *
 * `softBounce: true` means the caller should funnel through
 * recordSoftBounce() rather than immediate suppress().
 */
export function suppressionFromEvent(evt: {
  event: string;
  type?: string;
  reason?: string;
}): { reason: string; source: SuppressionSource; bounceCategory: BounceCategory; softBounce?: true } | null {
  switch (evt.event) {
    case "bounce": {
      const isSoft = evt.type === "blocked" || evt.type === "soft" || evt.type === "deferred";
      if (isSoft) {
        return {
          reason: evt.reason || "soft_bounce",
          source: "bounce",
          bounceCategory: "soft",
          softBounce: true,
        };
      }
      return {
        reason: evt.reason || "hard_bounce",
        source: "bounce",
        bounceCategory: "hard",
      };
    }
    case "dropped":
      return {
        reason: evt.reason || "dropped",
        source: "bounce",
        bounceCategory: "hard",
      };
    case "spamreport":
      return {
        reason: "spam_report",
        source: "spam",
        bounceCategory: "complaint",
      };
    case "unsubscribe":
    case "group_unsubscribe":
      return {
        reason: "unsubscribe",
        source: "unsubscribe",
        bounceCategory: "unsubscribe",
      };
    default:
      return null;
  }
}

/**
 * Founder alert hook — fired on every COMPLAINT (spamreport). The actual
 * delivery is handled by the alert pipeline (logger + future Slack hook).
 * Centralized here so the SendGrid event handler doesn't need to know
 * about alert routing.
 */
export async function alertFounderOnComplaint(opts: {
  email: string;
  organizationId?: number;
  reason?: string;
}): Promise<void> {
  logger.warn("[emailSuppressions] COMPLAINT received — founder alert", {
    metadata: {
      email: opts.email,
      organizationId: opts.organizationId,
      reason: opts.reason,
      severity: "high",
      kind: "founder_alert",
    },
  });
  // The structured logger entry above is picked up by the founder
  // alerting pipeline (Sentry + Slack), so no further action is required
  // here. We deliberately do not throw on alert failure.
}
