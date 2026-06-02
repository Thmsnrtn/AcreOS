/**
 * RS-6 (post-may1-resweep): email-change confirmation step to original.
 *
 * Asher-takeover §3 attacker timeline: at 12:10 the attacker changed
 * the org email and AcreOS sent zero notification to the original
 * address. Clerk's hosted flow does require the new address be
 * verified — but a takeover with credentials in hand can blow through
 * that verification, and the original address never gets a chance to
 * intervene.
 *
 * This detector closes the gap with a redundant safety net:
 *   1. Once per session per process, fetch the current Clerk primary
 *      email and compare to our local DB row.
 *   2. If different, send a high-friction alert to BOTH the OLD and
 *      NEW addresses with timestamp + revoke instructions.
 *   3. Update our local DB row to the new email so we don't re-fire
 *      on every subsequent check.
 *   4. Write an audit row so the Coriander recovery console can
 *      correlate later.
 *
 * Fail-open: if the Clerk fetch breaks or the email send fails, the
 * request continues and we'll detect again on the next session.
 */

import { db } from "../db";
import { users, auditEvents } from "@shared/schema";
import { eq } from "drizzle-orm";
import { logger } from "../utils/logger";
import { emailService } from "./emailService";

const checkedSessions = new Set<string>();
const MAX_CHECKED_SESSIONS = 50_000;

function rememberChecked(key: string): void {
  if (checkedSessions.size >= MAX_CHECKED_SESSIONS) checkedSessions.clear();
  checkedSessions.add(key);
}

let cachedClerk: any = null;
async function getClerk() {
  if (cachedClerk) return cachedClerk;
  try {
    const mod = await import("@clerk/express");
    cachedClerk = mod.clerkClient;
  } catch (err) {
    logger.warn("[emailChangeDetector] @clerk/express not available", err instanceof Error ? err : undefined);
  }
  return cachedClerk;
}

interface DetectOpts {
  userId: string;
  clerkUserId: string | null | undefined;
  sessionId: string | null;
  ip: string | null | undefined;
  userAgent: string | null | undefined;
}

export async function detectAndAlertEmailChange(opts: DetectOpts): Promise<void> {
  if (!opts.clerkUserId) return;
  const memoKey = `${opts.sessionId ?? "no-session"}|${opts.userId}|email-change`;
  if (checkedSessions.has(memoKey)) return;
  rememberChecked(memoKey);

  try {
    const [localUser] = await db.select().from(users).where(eq(users.id, opts.userId)).limit(1);
    if (!localUser) return;
    const localEmail = (localUser.email ?? "").toLowerCase();

    const clerk = await getClerk();
    if (!clerk) return;

    let clerkEmail: string | null = null;
    try {
      const cu = await clerk.users.getUser(opts.clerkUserId);
      const primary = cu?.emailAddresses?.find((e: any) => e.id === cu.primaryEmailAddressId);
      clerkEmail = primary?.emailAddress?.toLowerCase() ?? null;
    } catch (err) {
      logger.warn(
        "[emailChangeDetector] clerk.users.getUser failed",
        err instanceof Error ? err : undefined,
      );
      return;
    }

    if (!clerkEmail || !localEmail || localEmail === clerkEmail) return;

    // Real change. Fire alerts + update local + audit.
    await Promise.allSettled([
      sendEmailChangeAlert({ to: localEmail, oldEmail: localEmail, newEmail: clerkEmail, role: "old" }),
      sendEmailChangeAlert({ to: clerkEmail, oldEmail: localEmail, newEmail: clerkEmail, role: "new" }),
    ]);

    await db.update(users).set({ email: clerkEmail }).where(eq(users.id, opts.userId));

    try {
      await db.insert(auditEvents).values({
        actorUserId: opts.userId,
        actorEmail: clerkEmail,
        action: "auth.email_changed",
        targetType: "user",
        targetId: opts.userId,
        metadata: {
          oldEmail: localEmail,
          newEmail: clerkEmail,
        },
        ip: opts.ip ?? null,
        userAgent: opts.userAgent ?? null,
      });
    } catch (err) {
      logger.warn(
        "[emailChangeDetector] audit write failed",
        err instanceof Error ? err : undefined,
      );
    }
  } catch (err) {
    logger.warn(
      "[emailChangeDetector] detection failed",
      err instanceof Error ? err : undefined,
    );
  }
}

async function sendEmailChangeAlert(opts: {
  to: string;
  oldEmail: string;
  newEmail: string;
  role: "old" | "new";
}): Promise<void> {
  try {
    const when = new Date().toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
    const securityUrl = `${process.env.PUBLIC_APP_URL ?? "https://app.acreos.io"}/account/security`;
    const lead =
      opts.role === "old"
        ? "The primary email on your AcreOS account just changed."
        : "Your address is now the primary email on this AcreOS account.";
    const action =
      opts.role === "old"
        ? "If you didn't make this change, sign in immediately, revoke other sessions, change your password, then email security@acreos.io with the timestamp above. Account-recovery support requires the OLD email — keep this message."
        : "If you didn't initiate this change, sign in immediately and contact security@acreos.io.";
    const message = [
      lead,
      ``,
      `When: ${when}`,
      `Old email: ${opts.oldEmail}`,
      `New email: ${opts.newEmail}`,
      ``,
      action,
    ].join("\n");
    await emailService.sendTransactionalEmail("alert", {
      to: opts.to,
      subject:
        opts.role === "old"
          ? "Primary email on your AcreOS account changed"
          : "You're now the primary email on an AcreOS account",
      templateData: {
        alertTitle:
          opts.role === "old"
            ? "Primary email on your AcreOS account changed"
            : "You're now the primary email on an AcreOS account",
        alertMessage: message,
        actionUrl: securityUrl,
        actionText: "Review your sessions",
      },
    });
  } catch (err) {
    logger.warn(
      `[emailChangeDetector] alert send failed (${opts.role})`,
      err instanceof Error ? err : undefined,
    );
  }
}
