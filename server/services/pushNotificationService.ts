// @ts-nocheck
/**
 * Web Push Notification Service (T61)
 *
 * Sends Web Push API notifications to subscribed users.
 * Requires VAPID keys (generate once and set as env vars):
 *   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:contact@acreos.com)
 *
 * Uses the `web-push` npm package for VAPID signing.
 * If the package is not installed, operations are logged but skipped gracefully.
 *
 * Subscription storage: `push_subscriptions` table (created by the org routes).
 */

import { db } from "../db";
import { sql } from "drizzle-orm";

interface PushSubscription {
  id: number;
  organizationId: number;
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

interface PushPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  url?: string;
  tag?: string;
  data?: Record<string, any>;
  actions?: Array<{ action: string; title: string }>;
}

// ---------------------------------------------------------------------------
// VAPID setup
// ---------------------------------------------------------------------------

let webPush: any = null;
let vapidConfigured = false;

async function getWebPush(): Promise<any> {
  if (webPush) return webPush;
  try {
    webPush = await import("web-push");
    const subject = process.env.VAPID_SUBJECT || `mailto:${process.env.SENDGRID_FROM_EMAIL || "noreply@acreos.com"}`;
    const publicKey = process.env.VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;

    if (publicKey && privateKey) {
      webPush.setVapidDetails(subject, publicKey, privateKey);
      vapidConfigured = true;
      console.log("[PushNotifications] VAPID keys configured");
    } else {
      console.warn("[PushNotifications] VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY not set — push disabled");
    }
    return webPush;
  } catch (err) {
    console.warn("[PushNotifications] web-push package not installed — push disabled");
    return null;
  }
}

// ---------------------------------------------------------------------------
// Subscription queries
// ---------------------------------------------------------------------------

async function getSubscriptionsForUser(
  organizationId: number,
  userId: string
): Promise<PushSubscription[]> {
  try {
    const rows = await db.execute(
      sql`SELECT * FROM push_subscriptions
          WHERE organization_id = ${organizationId} AND user_id = ${userId}`
    );
    return (rows as any).rows ?? [];
  } catch {
    return [];
  }
}

async function getSubscriptionsForOrg(
  organizationId: number
): Promise<PushSubscription[]> {
  try {
    const rows = await db.execute(
      sql`SELECT * FROM push_subscriptions WHERE organization_id = ${organizationId}`
    );
    return (rows as any).rows ?? [];
  } catch {
    return [];
  }
}

async function deleteSubscription(endpoint: string): Promise<void> {
  try {
    await db.execute(sql`DELETE FROM push_subscriptions WHERE endpoint = ${endpoint}`);
  } catch (err) {
    console.error("[PushNotifications] Failed to delete subscription:", err);
  }
}

// ---------------------------------------------------------------------------
// Core send
// ---------------------------------------------------------------------------

async function sendToSubscription(
  subscription: PushSubscription,
  payload: PushPayload
): Promise<boolean> {
  const wp = await getWebPush();
  if (!wp || !vapidConfigured) return false;

  const pushSubscription = {
    endpoint: subscription.endpoint,
    keys: {
      p256dh: subscription.p256dh,
      auth: subscription.auth,
    },
  };

  try {
    await wp.sendNotification(
      pushSubscription,
      JSON.stringify({
        title: payload.title,
        body: payload.body,
        icon: payload.icon || "/pwa-192x192.png",
        badge: payload.badge || "/favicon.png",
        url: payload.url || "/",
        tag: payload.tag || "acreos",
        data: payload.data,
        actions: payload.actions,
      })
    );
    return true;
  } catch (err: any) {
    if (err.statusCode === 410 || err.statusCode === 404) {
      // Subscription expired — remove it
      await deleteSubscription(subscription.endpoint);
    } else {
      console.error("[PushNotifications] Send failed:", err.message);
    }
    return false;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Send a push notification to a specific user.
 */
export async function sendPushToUser(
  organizationId: number,
  userId: string,
  payload: PushPayload
): Promise<{ sent: number; failed: number }> {
  const subscriptions = await getSubscriptionsForUser(organizationId, userId);
  let sent = 0;
  let failed = 0;

  for (const sub of subscriptions) {
    const ok = await sendToSubscription(sub, payload);
    ok ? sent++ : failed++;
  }

  return { sent, failed };
}

/**
 * Send a push notification to all users in an org.
 */
export async function sendPushToOrg(
  organizationId: number,
  payload: PushPayload
): Promise<{ sent: number; failed: number }> {
  const subscriptions = await getSubscriptionsForOrg(organizationId);
  let sent = 0;
  let failed = 0;

  await Promise.allSettled(
    subscriptions.map(async (sub) => {
      const ok = await sendToSubscription(sub, payload);
      ok ? sent++ : failed++;
    })
  );

  return { sent, failed };
}

// ---------------------------------------------------------------------------
// Convenience notification types
// ---------------------------------------------------------------------------

export async function notifyDealAccepted(
  organizationId: number,
  userId: string,
  dealId: number,
  propertyAddress: string
): Promise<void> {
  await sendPushToUser(organizationId, userId, {
    title: "Deal Accepted! 🎉",
    body: `Your offer on ${propertyAddress} was accepted.`,
    url: `/deals/${dealId}`,
    tag: `deal-accepted-${dealId}`,
  });
}

export async function notifyPaymentReceived(
  organizationId: number,
  userId: string,
  noteId: number,
  amountDollars: number
): Promise<void> {
  await sendPushToUser(organizationId, userId, {
    title: "Payment Received 💰",
    body: `$${amountDollars.toLocaleString()} payment received on note #${noteId}.`,
    url: `/finance`,
    tag: `payment-${noteId}`,
  });
}

export async function notifyNoteDelinquent(
  organizationId: number,
  userId: string,
  noteId: number,
  borrowerName: string
): Promise<void> {
  await sendPushToUser(organizationId, userId, {
    title: "Overdue Payment Alert 🚨",
    body: `${borrowerName}'s note #${noteId} has a missed payment.`,
    url: `/finance`,
    tag: `delinquent-${noteId}`,
  });
}

export async function notifyLeadCampaignResponse(
  organizationId: number,
  userId: string,
  leadId: number,
  leadName: string,
  channel: string
): Promise<void> {
  await sendPushToUser(organizationId, userId, {
    title: "Lead Responded! 📬",
    body: `${leadName} replied via ${channel}.`,
    url: `/leads/${leadId}`,
    tag: `lead-response-${leadId}`,
  });
}

export async function notifyColdLeadAlert(
  organizationId: number,
  userId: string,
  leadId: number,
  leadName: string
): Promise<void> {
  await sendPushToUser(organizationId, userId, {
    title: "Cold Lead Alert ❄️",
    body: `${leadName} is going cold. Time to re-engage.`,
    url: `/leads/${leadId}`,
    tag: `cold-lead-${leadId}`,
  });
}

/**
 * Generate a new set of VAPID keys (call once during setup, store in env).
 */
export async function generateVapidKeys(): Promise<{ publicKey: string; privateKey: string } | null> {
  const wp = await getWebPush();
  if (!wp) return null;
  return wp.generateVAPIDKeys();
}

export { type PushPayload };
