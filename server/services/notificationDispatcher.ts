// @ts-nocheck
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
}

// ─── Event → Channel Mapping ─────────────────────────────────────────────────

const EVENT_CHANNEL_MAP: Record<string, ChannelConfig> = {
  "deal:discovered": { defaultChannel: "in_app", label: "New Deal Found" },
  "deal:closed": { defaultChannel: "email", label: "Deal Closed" },
  "agent:escalation": { defaultChannel: "in_app", urgentChannel: "sms", label: "Agent Escalation" },
  "agent:decision": { defaultChannel: "in_app", label: "Agent Decision" },
  "approval:requested": { defaultChannel: "in_app", urgentChannel: "sms", label: "Approval Needed" },
  "job:failed": { defaultChannel: "in_app", label: "Job Failed" },
  "revenue:milestone": { defaultChannel: "email", label: "Revenue Milestone" },
  "briefing:ready": { defaultChannel: "in_app", label: "Daily Briefing Ready" },
  "agent:conflict": { defaultChannel: "in_app", urgentChannel: "sms", label: "Agent Conflict" },
  "market:alert": { defaultChannel: "in_app", label: "Market Alert" },
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

// In-memory store for in-app notifications (will persist to DB in production)
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

    // Route to channels
    try {
      // Always send in-app via WebSocket
      await this.sendInApp(event, notification);

      // If urgent and has an urgent channel, also send there
      if (isUrgent && config?.urgentChannel === "sms") {
        await this.sendSms(event, notification);
      }

      // Email for non-urgent but important
      if (channel === "email" || (isUrgent && channel !== "sms")) {
        await this.queueEmail(event, notification);
      }
    } catch (err: any) {
      console.error(`[notification-dispatcher] Error dispatching ${event.eventType}:`, err.message);
    }
  }

  /**
   * In-app notification via WebSocket toast
   */
  private async sendInApp(event: NotificationEvent, notification: StoredNotification): Promise<void> {
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

    // Also broadcast to all connected founder users
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
    console.log(
      `[notification-dispatcher] SMS queued: ${notification.title} — ${notification.message}`,
    );
    // In production, this would call twilioService.sendSms(founderPhone, message)
  }

  /**
   * Queue email for batch delivery
   */
  private async queueEmail(event: NotificationEvent, notification: StoredNotification): Promise<void> {
    // Log email intent — actual sending handled by existing email service
    console.log(
      `[notification-dispatcher] Email queued: ${notification.title} — ${notification.message}`,
    );
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
