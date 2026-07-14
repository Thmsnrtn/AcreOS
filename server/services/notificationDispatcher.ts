/**
 * Notification Dispatcher — Phase D
 *
 * Routes events to the correct notification channel based on:
 * 1. Event type → channel mapping (defaults)
 * 2. Founder preferences (overrides defaults)
 *
 * Supported channels: in_app (WebSocket toast), email, sms
 * Push notifications are queued but not sent until Capacitor integration is complete.
 */

import { wsServer } from "../websocket";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { logger } from "../utils/logger";
import {
  arbitrateFounderInterrupt,
  recordDeferredInterrupt,
  type ArbiterDecision,
} from "./founderInterruptArbiter";

// ─── Types ───────────────────────────────────────────────────────────────────

interface NotificationEvent {
  eventType: string;
  channel: string;
  payload: Record<string, any>;
  priority: number;
  orgId?: number;
  timestamp?: Date | string;
}

interface ChannelConfig {
  defaultChannel: "in_app" | "email" | "sms" | "push";
  urgentChannel?: "sms" | "push";
  label: string;
  /**
   * Jarvis 2.2 — constitutional decision class of the FOUNDER-facing legs
   * (founder broadcast + SMS + email), mapped EXPLICITLY per event: events
   * with an urgentChannel (escalation / approval / conflict) are Class B;
   * everything else is Class C (never interrupts the founder). The org
   * broadcast is customer-facing and never arbitrated.
   */
  founderClass: "B" | "C";
}

// ─── Event → Channel Mapping ─────────────────────────────────────────────────

const EVENT_CHANNEL_MAP: Record<string, ChannelConfig> = {
  "deal:discovered": { defaultChannel: "in_app", label: "New Deal Found", founderClass: "C" },
  "deal:closed": { defaultChannel: "email", label: "Deal Closed", founderClass: "C" },
  "agent:escalation": { defaultChannel: "in_app", urgentChannel: "sms", label: "Agent Escalation", founderClass: "B" },
  "agent:decision": { defaultChannel: "in_app", label: "Agent Decision", founderClass: "C" },
  "approval:requested": { defaultChannel: "in_app", urgentChannel: "sms", label: "Approval Needed", founderClass: "B" },
  "job:failed": { defaultChannel: "in_app", label: "Job Failed", founderClass: "C" },
  "revenue:milestone": { defaultChannel: "email", label: "Revenue Milestone", founderClass: "C" },
  "briefing:ready": { defaultChannel: "in_app", label: "Daily Briefing Ready", founderClass: "C" },
  "agent:conflict": { defaultChannel: "in_app", urgentChannel: "sms", label: "Agent Conflict", founderClass: "B" },
  "market:alert": { defaultChannel: "in_app", label: "Market Alert", founderClass: "C" },
};

// ─── Notification Storage (in-app history) ───────────────────────────────────

interface StoredNotification {
  id: string;
  eventType: string;
  title: string;
  message: string;
  priority: number;
  channel: string;
  read: boolean;
  createdAt: string;
  payload: Record<string, any>;
}

// MODULE-STATE PIN (audit 2026-07-07): per-process, in-memory — on 2+ Fly
// machines a notification written here on one machine is invisible on the
// other, and all are lost on deploy. Fix before load-bearing use: persist to
// the existing `notifications` table (shared/schema.ts) — tracked in
// docs/company/deletion-ledger.md "Module-state residue".
const notificationStore: StoredNotification[] = [];
const MAX_NOTIFICATIONS = 200;

// ─── Service ─────────────────────────────────────────────────────────────────

class NotificationDispatcher {
  /**
   * Dispatch a notification event to the appropriate channels.
   */
  async dispatch(event: NotificationEvent): Promise<void> {
    const config = EVENT_CHANNEL_MAP[event.eventType];
    const channel = config?.defaultChannel ?? "in_app";
    const label = config?.label ?? event.eventType;
    const isUrgent = event.priority <= 2;

    // Build notification
    const notification: StoredNotification = {
      id: `notif_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      eventType: event.eventType,
      title: label,
      message: this.buildMessage(event),
      priority: event.priority,
      channel: event.channel,
      read: false,
      createdAt: new Date().toISOString(),
      payload: event.payload,
    };

    // Store in history
    notificationStore.unshift(notification);
    if (notificationStore.length > MAX_NOTIFICATIONS) {
      notificationStore.length = MAX_NOTIFICATIONS;
    }

    // Jarvis 2.2 — the FOUNDER-facing legs (founder broadcast + SMS + email)
    // route through the interrupt arbiter. The org broadcast (customer-facing)
    // and the in-app history store (pull-based tray) are untouched. Fails
    // CLOSED-quiet: an arbiter failure suppresses the founder legs with a
    // log — it never blocks the customer-facing path and never spams.
    const founderClass = config?.founderClass ?? "C"; // unmapped events → C
    let founderLegsAllowed = false;
    try {
      const decision: ArbiterDecision = await arbitrateFounderInterrupt({
        source: "notification_dispatcher",
        interruptClass: founderClass,
        channel: "founder_broadcast",
        subject: label,
        body: notification.message,
        metadata: {
          eventType: event.eventType,
          priority: event.priority,
          organizationId: event.orgId,
        },
      });
      founderLegsAllowed = decision.outcome === "deliver";
      if (decision.outcome === "defer_next_pulse" || decision.outcome === "defer_to_letter") {
        await recordDeferredInterrupt(
          {
            source: "notification_dispatcher",
            interruptClass: founderClass,
            channel: "founder_broadcast",
            subject: label,
            body: notification.message,
            metadata: { eventType: event.eventType, priority: event.priority, organizationId: event.orgId },
          },
          decision,
        );
      }
    } catch (err) {
      logger.error(
        `[notification-dispatcher] interrupt arbiter threw for ${event.eventType} — founder legs fail CLOSED-quiet`,
        err instanceof Error ? err : undefined,
      );
      founderLegsAllowed = false;
    }

    // Route to channels
    try {
      // Customer-facing org broadcast — always, never arbitrated.
      await this.sendInAppOrg(event, notification);

      if (founderLegsAllowed) {
        await this.sendInAppFounder(event, notification);

        // If urgent and has an urgent channel, also send there
        if (isUrgent && config?.urgentChannel === "sms") {
          await this.sendSms(event, notification);
        }

        // Email for non-urgent but important
        if (channel === "email" || (isUrgent && channel !== "sms")) {
          await this.queueEmail(event, notification);
        }
      }
    } catch (err: any) {
      logger.error(`[notification-dispatcher] Error dispatching ${event.eventType}`, err);
    }
  }

  /**
   * In-app notification via WebSocket toast — customer-facing org broadcast.
   */
  private async sendInAppOrg(event: NotificationEvent, notification: StoredNotification): Promise<void> {
    if (event.orgId) {
      wsServer.broadcastToOrg(event.orgId, "notification", {
        id: notification.id,
        title: notification.title,
        message: notification.message,
        priority: event.priority,
        eventType: event.eventType,
        actionUrl: this.getActionUrl(event),
        createdAt: notification.createdAt,
      });
    }
  }

  /**
   * In-app notification via WebSocket toast — founder-facing broadcast
   * (arbitrated; Jarvis 2.2).
   */
  private async sendInAppFounder(event: NotificationEvent, notification: StoredNotification): Promise<void> {
    wsServer.broadcast("founder:activity", "notification", {
      id: notification.id,
      title: notification.title,
      message: notification.message,
      priority: event.priority,
      eventType: event.eventType,
      actionUrl: this.getActionUrl(event),
    });
  }

  /**
   * SMS via Twilio (logs intent — actual sending requires Twilio credentials)
   */
  private async sendSms(event: NotificationEvent, notification: StoredNotification): Promise<void> {
    // Log SMS intent — actual sending handled by existing Twilio service
    logger.info(`[notification-dispatcher] SMS queued: ${notification.title} — ${notification.message}`);
    // In production, this would call twilioService.sendSms(founderPhone, message)
  }

  /**
   * Queue email for batch delivery
   */
  private async queueEmail(event: NotificationEvent, notification: StoredNotification): Promise<void> {
    // Log email intent — actual sending handled by existing email service
    logger.info(`[notification-dispatcher] Email queued: ${notification.title} — ${notification.message}`);
    // In production, this would call emailService.send(founderEmail, subject, body)
  }

  /**
   * Build human-readable notification message from event payload
   */
  private buildMessage(event: NotificationEvent): string {
    const p = event.payload ?? {};

    switch (event.eventType) {
      case "deal:discovered":
        return `New deal found: ${p.address ?? p.propertyAddress ?? "Unknown"} — $${p.price?.toLocaleString() ?? "N/A"}`;
      case "deal:closed":
        return `Deal closed: ${p.address ?? "Unknown"} for $${p.amount?.toLocaleString() ?? p.price?.toLocaleString() ?? "N/A"}`;
      case "agent:escalation":
        return `${p.agent ?? "Agent"} needs your input: ${p.reason ?? p.description ?? "Review required"}`;
      case "agent:decision":
        return `${p.agent ?? "Agent"} decided: ${p.decision ?? p.description ?? "Action taken"}`;
      case "approval:requested":
        return `Approval needed: ${p.description ?? p.action ?? "Review request"}`;
      case "job:failed":
        return `Job failed: ${p.jobName ?? "Unknown"} — ${p.error ?? "Check logs"}`;
      case "revenue:milestone":
        return `Revenue milestone: $${p.amount?.toLocaleString() ?? "N/A"} — ${p.description ?? ""}`;
      case "briefing:ready":
        return `Your daily briefing is ready. ${p.highlights ?? ""}`;
      case "agent:conflict":
        return `Agents disagree: ${p.topic ?? p.description ?? "Needs resolution"}`;
      case "market:alert":
        return `Market alert for ${p.county ?? p.market ?? "your area"}: ${p.description ?? p.message ?? ""}`;
      default:
        return p.message ?? p.description ?? `${event.eventType} event occurred`;
    }
  }

  /**
   * Map events to action URLs in the frontend
   */
  private getActionUrl(event: NotificationEvent): string {
    switch (event.eventType) {
      case "deal:discovered":
      case "deal:closed":
        return "/deals";
      case "agent:escalation":
      case "agent:decision":
      case "agent:conflict":
        return "/board-of-directors";
      case "approval:requested":
        return "/admin/decisions";
      case "job:failed":
        return "/job-health";
      case "revenue:milestone":
        return "/agent-performance";
      case "briefing:ready":
        return "/today";
      case "market:alert":
        return "/market-intelligence";
      default:
        return "/sovereign";
    }
  }

  /**
   * Get stored in-app notifications (for notification tray)
   */
  getNotifications(limit: number = 50): StoredNotification[] {
    return notificationStore.slice(0, limit);
  }

  /**
   * Mark a notification as read
   */
  markAsRead(notificationId: string): boolean {
    const notif = notificationStore.find((n) => n.id === notificationId);
    if (notif) {
      notif.read = true;
      return true;
    }
    return false;
  }

  /**
   * Get unread count
   */
  getUnreadCount(): number {
    return notificationStore.filter((n) => !n.read).length;
  }
}

export const notificationDispatcher = new NotificationDispatcher();
