/**
 * T9 — Request Deduplication for Outbound Communications
 *
 * Before sending any email, SMS, or direct mail to a lead, check whether an
 * identical communication was sent within the deduplication window (24 hours
 * by default). If so, skip the send and return the original result.
 *
 * This prevents:
 *   - Double-sends when a campaign job retries after a transient failure
 *   - Duplicate emails if a user re-submits a form
 *   - Accidental mass duplicate mailings that would tank sender reputation
 *
 * Storage: Redis if available, in-memory Map as fallback.
 *
 * Usage:
 *   import { commDedup } from "./communicationDeduplication";
 *
 *   const key = commDedup.buildKey("email", orgId, leadId, templateId);
 *   if (await commDedup.isDuplicate(key)) {
 *     return { skipped: true, reason: "duplicate" };
 *   }
 *   const result = await sendEmail(...);
 *   await commDedup.markSent(key);
 *   return result;
 */

const DEDUP_TTL_SECONDS = parseInt(
  process.env.COMM_DEDUP_TTL_HOURS ?? "24",
  10
) * 3600;

// ─── In-memory fallback ──────────────────────────────────────────────────────

const memKeys = new Map<string, number>(); // key → expiresAt epoch ms

setInterval(() => {
  const now = Date.now();
  for (const [key, exp] of memKeys.entries()) {
    if (now > exp) memKeys.delete(key);
  }
}, 5 * 60 * 1000);

// ─── Redis (lazy) ────────────────────────────────────────────────────────────

let _redis: any = null;

async function getRedis(): Promise<any | null> {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  if (_redis) return _redis;
  try {
    const IORedis = (await import("ioredis")).default;
    _redis = new IORedis(url, {
      maxRetriesPerRequest: 1,
      enableReadyCheck: false,
      lazyConnect: true,
    });
    await _redis.connect().catch(() => {});
    return _redis;
  } catch {
    return null;
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

export const commDedup = {
  /**
   * Build a deduplication key for a communication.
   *
   * @param channel  "email" | "sms" | "mail"
   * @param orgId    Organization ID
   * @param leadId   Lead/recipient ID
   * @param templateId  Template or campaign ID (or any stable identifier)
   */
  buildKey(
    channel: "email" | "sms" | "mail",
    orgId: number,
    leadId: number,
    templateId: string | number
  ): string {
    return `comm:dedup:${channel}:org:${orgId}:lead:${leadId}:tpl:${templateId}`;
  },

  /**
   * Check whether this communication was already sent within the TTL window.
   * Returns true if it was (= skip the send), false if it's safe to send.
   */
  async isDuplicate(key: string): Promise<boolean> {
    try {
      const redis = await getRedis();
      if (redis) {
        return (await redis.exists(key)) === 1;
      }
      const exp = memKeys.get(key);
      return exp !== undefined && Date.now() < exp;
    } catch {
      return false; // on error, allow send (fail open)
    }
  },

  /**
   * Mark a communication as sent. Call this AFTER a successful send.
   */
  async markSent(key: string): Promise<void> {
    try {
      const redis = await getRedis();
      if (redis) {
        await redis.setex(key, DEDUP_TTL_SECONDS, "1");
        return;
      }
      memKeys.set(key, Date.now() + DEDUP_TTL_SECONDS * 1000);
    } catch {}
  },

  /**
   * Convenience: wrap a send function with deduplication.
   * If the communication is a duplicate, returns { skipped: true }.
   * Otherwise, calls fn(), marks as sent, and returns the result.
   */
  async withDedup<T>(
    key: string,
    fn: () => Promise<T>
  ): Promise<T | { skipped: true; reason: "duplicate" }> {
    if (await commDedup.isDuplicate(key)) {
      return { skipped: true, reason: "duplicate" };
    }
    const result = await fn();
    await commDedup.markSent(key);
    return result;
  },
};
