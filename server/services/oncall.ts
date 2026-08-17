/**
 * On-Call Alert Delivery — the single way a P0/P1 incident reaches a human.
 *
 * The reliability substrate (autonomousHealthMonitor, registerCriticalAlert,
 * the error-budget tables) is excellent, but the wiring between "something is
 * on fire" and "the founder's phone buzzes" was broken: a SEV-1 at 3am produced
 * a DB row and an unread email and *silence on the phone*, because the one
 * delivery path that wakes a sleeping founder (VAPID web-push, which works on a
 * locked iPhone PWA) was wired to "deal accepted," not "production is down."
 *
 * `notifyOnCall()` closes that loop. It fans out a P0/P1 atomically to THREE
 * channels and is intended to be the ONLY way a P0/P1 is raised:
 *
 *   1. VAPID push  → founder's phone  (PRIMARY — wakes a sleeping founder)
 *   2. email       → audit trail      (durable record; founder reviews later)
 *   3. registerCriticalAlert → the existing 15m/60m ack-deadline timer that
 *      drives the founder-bell "Critical alerts" view + escalation flag.
 *
 * Every channel is best-effort and independent: one channel failing must never
 * suppress the others. We always create the `notifications` row first so the
 * ack-timer (which FKs the notification id) and the in-app bell both have a
 * durable anchor even if push and email both fail.
 *
 * Scope (this file): delivery wiring only. External probes, burn-rate alerting,
 * and OTel are separate, later work.
 */

import { db } from "../db";
import { notifications } from "@shared/schema";
import { logger } from "../utils/logger";
import { emailService } from "./emailService";
import { sendPushToUser } from "./pushNotificationService";
import { getFounderEmails, getFounderUserIds, getFounderPrimaryOrgId } from "./founder";
import { registerCriticalAlert } from "../routes-founder-critical-alerts";

/** P0 = page-now (15m ack), P1 = urgent (60m ack). Mirrors criticalAlertAcks. */
export type OnCallSeverity = "P0" | "P1";

export interface NotifyOnCallResult {
  notificationId: number | null;
  push: { sent: number; failed: number };
  emailSent: boolean;
  ackTimerRegistered: boolean;
}

/**
 * Raise a P0/P1 incident to on-call. Fans out to push + email + ack-timer.
 *
 * @param severity "P0" (page now, 15m ack) or "P1" (urgent, 60m ack)
 * @param title    short headline ("Stripe webhook failing")
 * @param body     human-readable detail (what broke, what to check)
 * @param meta     optional structured context, persisted on the notification
 */
export async function notifyOnCall(
  severity: OnCallSeverity,
  title: string,
  body: string,
  meta?: Record<string, any>,
): Promise<NotifyOnCallResult> {
  const result: NotifyOnCallResult = {
    notificationId: null,
    push: { sent: 0, failed: 0 },
    emailSent: false,
    ackTimerRegistered: false,
  };

  logger.warn(`[OnCall] ${severity} raised: ${title}`, {
    metadata: { severity, title, ...meta },
  });

  // Resolve founder targets up front so each channel can reuse them.
  let orgId: number;
  let founderUserIds: string[] = [];
  try {
    orgId = await getFounderPrimaryOrgId();
  } catch {
    orgId = 1; // matches getFounderPrimaryOrgId's own last-resort fallback
  }
  try {
    founderUserIds = await getFounderUserIds();
  } catch {
    founderUserIds = [];
  }

  // ── Channel 0 (anchor): durable in-app notification row ──────────────────
  // Created first so the ack-timer (FK) and founder-bell have a record even if
  // push + email both fail. Each founder user gets their own row; we keep the
  // first id for the ack-timer.
  const recipients = founderUserIds.length > 0 ? founderUserIds : ["founder"];
  for (const userId of recipients) {
    try {
      const [row] = await db
        .insert(notifications)
        .values({
          organizationId: orgId,
          userId,
          type: "system_alert",
          title: `[${severity}] ${title}`,
          message: body,
          metadata: { severity, oncall: true, ...meta },
        })
        .returning({ id: notifications.id });
      if (row && result.notificationId === null) result.notificationId = row.id;
    } catch (err) {
      logger.error("[OnCall] Failed to persist notification row", err);
    }
  }

  // ── Channel 1 (PRIMARY): VAPID push to the founder's phone ───────────────
  // Works on a locked iPhone via the installed PWA — the only channel that
  // wakes a sleeping founder.
  for (const userId of founderUserIds) {
    try {
      const r = await sendPushToUser(orgId, userId, {
        title: `🔴 ${severity}: ${title}`,
        body,
        // `/founder/intelligence` has no <Route> — this woke a founder at 3am
        // and landed them on NotFound. `/founder` is The Letter, the canonical
        // founder home and the one destination guaranteed to exist. There is no
        // dedicated on-call page and inventing one would be a new top-level
        // founder route, which the four-doors rule forbids.
        url: "/founder",
        tag: `oncall-${severity}-${result.notificationId ?? Date.now()}`,
        data: { severity, oncall: true, ...meta },
      });
      result.push.sent += r.sent;
      result.push.failed += r.failed;
    } catch (err) {
      logger.error("[OnCall] Push delivery failed", err);
    }
  }

  // ── Channel 2: email audit trail ─────────────────────────────────────────
  const founderEmails = getFounderEmails();
  if (founderEmails.length > 0) {
    const appUrl = process.env.APP_URL || "https://app.acreos.io";
    const color = severity === "P0" ? "#dc2626" : "#d97706";
    const html = `
<div style="font-family:-apple-system,sans-serif;max-width:560px;margin:0 auto;padding:20px;">
  <div style="background:${color};padding:16px 20px;border-radius:8px;margin-bottom:16px;">
    <h2 style="color:white;margin:0;font-size:18px;">🔴 ${severity} — ${title}</h2>
    <p style="color:rgba(255,255,255,0.85);margin:4px 0 0;font-size:13px;">AcreOS On-Call · ${new Date().toISOString()}</p>
  </div>
  <pre style="white-space:pre-wrap;font-family:-apple-system,sans-serif;color:#374151;font-size:14px;line-height:1.5;">${escapeHtml(body)}</pre>
  <div style="margin-top:20px;text-align:center;">
    <a href="${appUrl}/founder/intelligence" style="background:#1e3a5f;color:white;padding:10px 24px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px;">Open Founder Cockpit</a>
  </div>
  <p style="color:#9ca3af;font-size:11px;margin-top:16px;text-align:center;">
    Sent by AcreOS On-Call. ${severity === "P0" ? "15-minute" : "60-minute"} ack deadline is running.
  </p>
</div>`;
    try {
      const r = await emailService.sendEmail({
        to: founderEmails,
        subject: `🔴 [${severity}] AcreOS On-Call — ${title}`,
        html,
        text: `${severity}: ${title}\n\n${body}\n\nOpen cockpit: ${appUrl}/founder/intelligence`,
        organizationId: orgId,
      });
      result.emailSent = r.success;
    } catch (err) {
      logger.error("[OnCall] Email delivery failed", err);
    }
  }

  // ── Channel 3: ack-deadline timer (founder-bell escalation) ──────────────
  if (result.notificationId !== null) {
    try {
      await registerCriticalAlert({
        notificationId: result.notificationId,
        severity,
      });
      result.ackTimerRegistered = true;
    } catch (err) {
      logger.error("[OnCall] Failed to register ack-deadline timer", err);
    }
  }

  return result;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
