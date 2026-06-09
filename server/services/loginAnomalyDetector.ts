/**
 * RS-5 (post-may1-resweep): email-on-new-location detector.
 *
 * Asher-takeover §3 root cause: the attacker signed in from Bulgaria on
 * an account that lives in Arizona, and AcreOS never told the customer.
 * Six hours, nine destructive actions, zero friction. This detector
 * closes that hole.
 *
 * Mechanism: one row in `user_sign_in_locations` per
 * (userId, ipPrefix, uaFamily) tuple. First time we see a new tuple
 * for a user, we email the user and write an audit row. Subsequent
 * sign-ins from the same tuple just bump lastSeenAt and sessionCount.
 *
 * This is fail-open by design: if the email send breaks, the user is
 * still signed in and the audit row still gets written. The whole
 * thing is wrapped in try/catch and called fire-and-forget from
 * `getOrCreateOrg` middleware so a detector failure never breaks the
 * request.
 */

import { db } from "../db";
import { users, userSignInLocations } from "@shared/schema";
import { chainAndInsertAuditEvent } from "../utils/auditEventsChain";
import { eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { logger } from "../utils/logger";
import { emailService } from "./emailService";

// Process-lifetime memo of (sessionId|userId+ipPrefix+uaFamily) we've
// already checked, so the detector runs at most once per session per
// process — not on every authenticated API call. Keep it bounded; if
// it grows past 50k entries we drop the oldest.
const checkedSessions = new Set<string>();
const MAX_CHECKED_SESSIONS = 50_000;

function rememberChecked(key: string): void {
  if (checkedSessions.size >= MAX_CHECKED_SESSIONS) {
    // crude eviction — clear the lot. Worst case we re-check after
    // a 50k-distinct-session burst, which costs one extra DB upsert
    // per session and is fine.
    checkedSessions.clear();
  }
  checkedSessions.add(key);
}

/**
 * Coarse /24 (IPv4) or first-4-hextets (IPv6) bucket. Covers normal
 * roaming on the same network without spamming on small IP rotation.
 */
export function ipPrefixOf(ip: string | null | undefined): string {
  if (!ip) return "unknown";
  const trimmed = ip.trim();
  if (!trimmed) return "unknown";
  // Strip any leading "::ffff:" v4-in-v6 prefix.
  const v4 = trimmed.replace(/^::ffff:/, "");
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v4)) {
    return v4.split(".").slice(0, 3).join(".") + ".0/24";
  }
  // IPv6 — take first 4 hextets.
  if (trimmed.includes(":")) {
    const parts = trimmed.split(":");
    return parts.slice(0, 4).join(":") + "::/64";
  }
  return trimmed;
}

/**
 * Coarse "Browser/OS" bucket so the detector doesn't over-fire on
 * minor User-Agent string churn (Chrome version bumps, etc).
 */
export function uaFamilyOf(ua: string | null | undefined): string {
  if (!ua) return "unknown";
  const browser =
    /Edg\//.test(ua) ? "Edge" :
    /OPR\/|Opera/.test(ua) ? "Opera" :
    /Chrome\//.test(ua) ? "Chrome" :
    /Firefox\//.test(ua) ? "Firefox" :
    /Safari\//.test(ua) ? "Safari" :
    "Other";
  const os =
    /Windows/.test(ua) ? "Windows" :
    /Mac OS X|Macintosh/.test(ua) ? "macOS" :
    /Android/.test(ua) ? "Android" :
    /iPhone|iPad|iOS/.test(ua) ? "iOS" :
    /Linux/.test(ua) ? "Linux" :
    "Other";
  return `${browser}/${os}`;
}

/**
 * Pull country from Cloudflare's CF-IPCountry header when present.
 * Falls back to null — we don't reach out to a paid GeoIP API. The
 * country line in the email reads "Unknown" if not available.
 */
function countryFromHeaders(headers: Record<string, any>): string | null {
  const v = headers["cf-ipcountry"];
  if (typeof v === "string" && v.length === 2) return v.toUpperCase();
  return null;
}

interface RecordOpts {
  userId: string;
  sessionId: string | null;
  ip: string | null | undefined;
  userAgent: string | null | undefined;
  headers: Record<string, any>;
}

/**
 * Idempotent record-and-alert.
 *
 * Returns:
 *   - { isNew: true } if this tuple was novel for this user → email + audit row written.
 *   - { isNew: false } if we'd seen it before → just bumped lastSeenAt.
 */
export async function recordAndAlertIfNew(opts: RecordOpts): Promise<{ isNew: boolean } | null> {
  const ipPrefix = ipPrefixOf(opts.ip);
  const uaFamily = uaFamilyOf(opts.userAgent);
  const country = countryFromHeaders(opts.headers);

  const memoKey = `${opts.sessionId ?? "no-session"}|${opts.userId}|${ipPrefix}|${uaFamily}`;
  if (checkedSessions.has(memoKey)) return null;
  rememberChecked(memoKey);

  try {
    // Atomic upsert. ON CONFLICT bumps last-seen; the RETURNING tells us
    // whether this was an insert (new) or an update (already known).
    const result = await db
      .insert(userSignInLocations)
      .values({
        userId: opts.userId,
        ipPrefix,
        uaFamily,
        country,
      })
      .onConflictDoUpdate({
        target: [
          userSignInLocations.userId,
          userSignInLocations.ipPrefix,
          userSignInLocations.uaFamily,
        ],
        set: {
          lastSeenAt: sql`now()`,
          sessionCount: sql`${userSignInLocations.sessionCount} + 1`,
        },
      })
      .returning({
        id: userSignInLocations.id,
        firstSeenAt: userSignInLocations.firstSeenAt,
        lastSeenAt: userSignInLocations.lastSeenAt,
        sessionCount: userSignInLocations.sessionCount,
        notifiedAt: userSignInLocations.notifiedAt,
      });

    const row = result[0];
    if (!row) return null;

    // The "is new" test: if firstSeenAt and lastSeenAt match (within ms),
    // and sessionCount is 1, this insert created a new row.
    const isNew =
      row.sessionCount === 1 &&
      Math.abs(row.firstSeenAt.getTime() - row.lastSeenAt.getTime()) < 1000;

    if (!isNew) return { isNew: false };

    // Skip email if this is the user's first-ever session on this
    // platform — every brand-new account looks "novel" by definition,
    // and we'd send a confusing alert during onboarding.
    const [otherCount] = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(userSignInLocations)
      .where(eq(userSignInLocations.userId, opts.userId));
    const totalLocations = Number(otherCount?.c ?? 1);
    if (totalLocations <= 1) return { isNew: true };

    // Send the email + write the audit row + stamp notifiedAt.
    await sendNewLocationEmail({
      userId: opts.userId,
      ipPrefix,
      uaFamily,
      country,
      ip: opts.ip ?? null,
    });
    await db
      .update(userSignInLocations)
      .set({ notifiedAt: sql`now()` })
      .where(eq(userSignInLocations.id, row.id));
    await writeNewLocationAudit({
      userId: opts.userId,
      ipPrefix,
      uaFamily,
      country,
      ip: opts.ip ?? null,
      userAgent: opts.userAgent ?? null,
    });
    return { isNew: true };
  } catch (err) {
    logger.warn(
      "[loginAnomalyDetector] record/alert failed",
      err instanceof Error ? err : undefined,
    );
    return null;
  }
}

async function sendNewLocationEmail(opts: {
  userId: string;
  ipPrefix: string;
  uaFamily: string;
  country: string | null;
  ip: string | null;
}): Promise<void> {
  try {
    const [user] = await db.select().from(users).where(eq(users.id, opts.userId)).limit(1);
    if (!user?.email) return;
    const when = new Date().toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
    const reviewUrl = `${process.env.PUBLIC_APP_URL ?? "https://app.acreos.io"}/account/security`;
    const lines = [
      `A new sign-in to your AcreOS account just happened.`,
      ``,
      `When: ${when}`,
      `Where: ${opts.country ?? "Unknown"} (network ${opts.ipPrefix}${opts.ip && opts.ip !== "unknown" ? `, IP ${opts.ip}` : ""})`,
      `Device: ${opts.uaFamily}`,
      ``,
      `If this was you, no action needed.`,
      ``,
      `If it wasn't, sign out everywhere and change your password right now: ${reviewUrl}`,
      ``,
      `If you can't get into your account, email security@acreos.io with the timestamp above.`,
    ];
    await emailService.sendTransactionalEmail("alert", {
      to: user.email,
      subject: "New sign-in to your AcreOS account",
      templateData: {
        alertTitle: "New sign-in to your AcreOS account",
        alertMessage: lines.join("\n"),
        actionUrl: reviewUrl,
        actionText: "Review your sessions",
      },
    });
  } catch (err) {
    logger.warn(
      "[loginAnomalyDetector] email send failed",
      err instanceof Error ? err : undefined,
    );
  }
}

async function writeNewLocationAudit(opts: {
  userId: string;
  ipPrefix: string;
  uaFamily: string;
  country: string | null;
  ip: string | null;
  userAgent: string | null;
}): Promise<void> {
  try {
    const [user] = await db.select().from(users).where(eq(users.id, opts.userId)).limit(1);
    await chainAndInsertAuditEvent({
      actorUserId: opts.userId,
      actorEmail: user?.email ?? null,
      action: "auth.new_location_detected",
      targetType: "user",
      targetId: opts.userId,
      metadata: {
        ipPrefix: opts.ipPrefix,
        uaFamily: opts.uaFamily,
        country: opts.country,
      },
      ip: opts.ip,
      userAgent: opts.userAgent,
    });
  } catch (err) {
    logger.warn(
      "[loginAnomalyDetector] audit write failed",
      err instanceof Error ? err : undefined,
    );
  }
}
