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

function normalize(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Insert (or upsert with most-recent reason) a suppression entry.
 * Idempotent: repeat calls for the same address keep the original
 * suppressed_at timestamp but refresh the reason and source.
 */
export async function suppress(
  email: string,
  reason: string,
  source: SuppressionSource
): Promise<void> {
  const normalized = normalize(email);
  if (!normalized) return;
  try {
    await db
      .insert(emailSuppressions)
      .values({ email: normalized, reason, source })
      .onConflictDoUpdate({
        target: emailSuppressions.email,
        set: { reason, source },
      });
  } catch (err) {
    logger.error("[emailSuppressions] suppress failed", err instanceof Error ? err : undefined, {
      metadata: { email: normalized, reason, source },
    });
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
      .select({ email: emailSuppressions.email })
      .from(emailSuppressions)
      .where(eq(emailSuppressions.email, normalized))
      .limit(1);
    return rows.length > 0;
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
      .select({ email: emailSuppressions.email })
      .from(emailSuppressions)
      .where(inArray(emailSuppressions.email, normalized));
    const blocked = new Set(rows.map((r) => r.email));
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
 * Map a SendGrid event to a (reason, source) suppression record, or null
 * if the event should not produce a suppression.
 *
 * Per SendGrid docs:
 *   - bounce      → only HARD bounces ("type": "bounce") suppress; soft
 *                   bounces ("type": "blocked") are deferred and retried.
 *   - spamreport  → always suppress (recipient hit the spam button).
 *   - unsubscribe → always suppress (group unsubscribe also lands here).
 *   - dropped     → SendGrid pre-flight rejection; categorize as bounce.
 */
export function suppressionFromEvent(evt: {
  event: string;
  type?: string;
  reason?: string;
}): { reason: string; source: SuppressionSource } | null {
  switch (evt.event) {
    case "bounce":
      // Hard bounces ("bounce") suppress; "blocked" / soft are skipped.
      if (evt.type && evt.type !== "bounce") return null;
      return { reason: evt.reason || "hard_bounce", source: "bounce" };
    case "dropped":
      return { reason: evt.reason || "dropped", source: "bounce" };
    case "spamreport":
      return { reason: "spam_report", source: "spam" };
    case "unsubscribe":
    case "group_unsubscribe":
      return { reason: "unsubscribe", source: "unsubscribe" };
    default:
      return null;
  }
}
