/**
 * T113 — Notification Preferences Service
 *
 * Per-user, per-org notification preferences.
 * Controls which events trigger email, SMS, and in-app notifications.
 *
 * Categories:
 *   - Deals: new offer, status change, close reminder
 *   - Leads: new lead imported, high intent detected, aged out
 *   - Campaigns: send complete, low performance
 *   - Finance: payment due, note defaulted
 *   - System: weekly digest, AI insights
 *
 * Exposed via:
 *   GET  /api/notifications/preferences        — get preferences
 *   PUT  /api/notifications/preferences        — update preferences
 *   GET  /api/notifications/preferences/schema — available notification types
 */

import { db } from "../db";
import { sql } from "drizzle-orm";

export interface NotificationChannel {
  email: boolean;
  sms: boolean;
  push: boolean;
  inApp: boolean;
}

export interface NotificationCategory {
  id: string;
  label: string;
  description: string;
  events: NotificationEvent[];
}

export interface NotificationEvent {
  id: string;
  label: string;
  description: string;
  defaultChannels: NotificationChannel;
}

export interface UserNotificationPreferences {
  userId: string;
  organizationId: number;
  // Map from event ID to channel preferences (overrides default)
  overrides: Record<string, Partial<NotificationChannel>>;
  // Global mute
  globalMute: boolean;
  // Digest settings
  weeklyDigest: boolean;
  digestDay: "monday" | "tuesday" | "wednesday" | "thursday" | "friday";
  digestHour: number; // 0-23 UTC
  updatedAt: Date;
}

// Schema of all notification events
export const NOTIFICATION_SCHEMA: NotificationCategory[] = [
  {
    id: "deals",
    label: "Deals",
    description: "Deal pipeline and transaction events",
    events: [
      {
        id: "deal.offer_sent",
        label: "Offer sent",
        description: "When an offer letter is sent to a seller",
        defaultChannels: { email: true, sms: false, push: true, inApp: true },
      },
      {
        id: "deal.status_changed",
        label: "Deal status changed",
        description: "When a deal moves to a new stage",
        defaultChannels: { email: true, sms: false, push: true, inApp: true },
      },
      {
        id: "deal.closing_reminder",
        label: "Closing reminder",
        description: "3-day reminder before scheduled closing",
        defaultChannels: { email: true, sms: true, push: true, inApp: true },
      },
      {
        id: "deal.counter_received",
        label: "Counter offer received",
        description: "When a seller sends a counter offer",
        defaultChannels: { email: true, sms: true, push: true, inApp: true },
      },
    ],
  },
  {
    id: "leads",
    label: "Leads",
    description: "Lead import, scoring, and follow-up events",
    events: [
      {
        id: "lead.imported",
        label: "Lead imported",
        description: "When new leads are imported (batch summary)",
        defaultChannels: { email: false, sms: false, push: false, inApp: true },
      },
      {
        id: "lead.high_intent",
        label: "High-intent seller detected",
        description: "When AI detects a hot seller (score ≥ 80)",
        defaultChannels: { email: true, sms: true, push: true, inApp: true },
      },
      {
        id: "lead.aged_out",
        label: "Lead aged out",
        description: "When a lead has had no activity for 60+ days",
        defaultChannels: { email: false, sms: false, push: false, inApp: true },
      },
      {
        id: "lead.responded",
        label: "Lead responded",
        description: "When a lead replies to an outreach sequence",
        defaultChannels: { email: true, sms: true, push: true, inApp: true },
      },
    ],
  },
  {
    id: "campaigns",
    label: "Campaigns",
    description: "Marketing campaign events",
    events: [
      {
        id: "campaign.send_complete",
        label: "Send batch complete",
        description: "When a campaign batch finishes sending",
        defaultChannels: { email: true, sms: false, push: true, inApp: true },
      },
      {
        id: "campaign.low_performance",
        label: "Low performance alert",
        description: "When a campaign's open/response rate drops below threshold",
        defaultChannels: { email: true, sms: false, push: false, inApp: true },
      },
    ],
  },
  {
    id: "finance",
    label: "Finance",
    description: "Notes, payments, and cash flow events",
    events: [
      {
        id: "finance.payment_due",
        label: "Payment due in 7 days",
        description: "When a note payment is due in 7 days",
        defaultChannels: { email: true, sms: false, push: true, inApp: true },
      },
      {
        id: "finance.payment_missed",
        label: "Payment missed",
        description: "When a note payment is 3+ days past due",
        defaultChannels: { email: true, sms: true, push: true, inApp: true },
      },
      {
        id: "finance.note_paid_off",
        label: "Note paid off",
        description: "When a seller-financed note is fully paid",
        defaultChannels: { email: true, sms: false, push: true, inApp: true },
      },
    ],
  },
  {
    id: "system",
    label: "System",
    description: "Platform digest and AI insights",
    events: [
      {
        id: "system.weekly_digest",
        label: "Weekly performance digest",
        description: "Weekly summary: deals, leads, revenue, KPIs",
        defaultChannels: { email: true, sms: false, push: false, inApp: false },
      },
      {
        id: "system.ai_insight",
        label: "AI market insight",
        description: "When Atlas detects a significant market opportunity",
        defaultChannels: { email: false, sms: false, push: true, inApp: true },
      },
      {
        id: "system.integration_error",
        label: "Integration error",
        description: "When a critical integration (Stripe, Twilio) fails",
        defaultChannels: { email: true, sms: false, push: true, inApp: true },
      },
    ],
  },
];

// In-memory store (replace with DB table in production)
const preferencesStore = new Map<string, UserNotificationPreferences>();

function makeKey(userId: string, orgId: number) {
  return `${orgId}:${userId}`;
}

export const notificationPrefsService = {
  getSchema(): NotificationCategory[] {
    return NOTIFICATION_SCHEMA;
  },

  getPreferences(userId: string, orgId: number): UserNotificationPreferences {
    const key = makeKey(userId, orgId);
    return preferencesStore.get(key) ?? {
      userId,
      organizationId: orgId,
      overrides: {},
      globalMute: false,
      weeklyDigest: true,
      digestDay: "monday",
      digestHour: 9,
      updatedAt: new Date(),
    };
  },

  updatePreferences(
    userId: string,
    orgId: number,
    updates: Partial<UserNotificationPreferences>
  ): UserNotificationPreferences {
    const key = makeKey(userId, orgId);
    const current = this.getPreferences(userId, orgId);
    const updated: UserNotificationPreferences = {
      ...current,
      ...updates,
      userId,
      organizationId: orgId,
      updatedAt: new Date(),
    };
    preferencesStore.set(key, updated);
    return updated;
  },

  /**
   * Check if a specific event should trigger a channel for a user.
   */
  shouldNotify(
    userId: string,
    orgId: number,
    eventId: string,
    channel: keyof NotificationChannel
  ): boolean {
    const prefs = this.getPreferences(userId, orgId);
    if (prefs.globalMute) return false;

    const override = prefs.overrides[eventId];
    if (override && override[channel] !== undefined) {
      return override[channel] as boolean;
    }

    // Find default
    for (const category of NOTIFICATION_SCHEMA) {
      for (const event of category.events) {
        if (event.id === eventId) {
          return event.defaultChannels[channel];
        }
      }
    }

    return false;
  },
};
