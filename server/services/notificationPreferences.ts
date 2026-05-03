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
import { eq } from "drizzle-orm";
import { users } from "@shared/models/auth";

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
    id: "billing",
    label: "Billing",
    description: "Subscription billing, dunning, and payment events",
    events: [
      {
        // Phase 3 W10 — SMS leg of the AcreOS subscription dunning sequence.
        // Defaults ON because a declined card is high-stakes and customers
        // usually want a heads-up. Owners can flip sms → false to opt out.
        // Throttled to one SMS per dunning sequence regardless of preference.
        id: "billing.dunning_sms",
        label: "Payment failed — SMS reminder",
        description: "When a card is declined, send a single SMS on day 3 of dunning",
        defaultChannels: { email: false, sms: true, push: false, inApp: false },
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

// JC#11 — persist to users.notification_prefs (jsonb). Replaces the prior
// in-memory store. orgId is no longer part of the storage key because the
// matrix is per-user, not per-(user, org); the route layer still accepts
// it for API stability.
const DEFAULTS: Omit<UserNotificationPreferences, "userId" | "organizationId" | "updatedAt"> = {
  overrides: {},
  globalMute: false,
  weeklyDigest: true,
  digestDay: "monday",
  digestHour: 9,
};

export const notificationPrefsService = {
  getSchema(): NotificationCategory[] {
    return NOTIFICATION_SCHEMA;
  },

  async getPreferences(userId: string, orgId: number): Promise<UserNotificationPreferences> {
    const [row] = await db
      .select({ notificationPrefs: users.notificationPrefs, updatedAt: users.updatedAt })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    const stored = row?.notificationPrefs ?? {};
    return {
      userId,
      organizationId: orgId,
      overrides: stored.overrides ?? DEFAULTS.overrides,
      globalMute: stored.globalMute ?? DEFAULTS.globalMute,
      weeklyDigest: stored.weeklyDigest ?? DEFAULTS.weeklyDigest,
      digestDay: stored.digestDay ?? DEFAULTS.digestDay,
      digestHour: stored.digestHour ?? DEFAULTS.digestHour,
      updatedAt: row?.updatedAt ?? new Date(),
    };
  },

  async updatePreferences(
    userId: string,
    orgId: number,
    updates: Partial<UserNotificationPreferences>
  ): Promise<UserNotificationPreferences> {
    const current = await this.getPreferences(userId, orgId);
    const merged = {
      overrides: updates.overrides ?? current.overrides,
      globalMute: updates.globalMute ?? current.globalMute,
      weeklyDigest: updates.weeklyDigest ?? current.weeklyDigest,
      digestDay: updates.digestDay ?? current.digestDay,
      digestHour: updates.digestHour ?? current.digestHour,
    };

    await db
      .update(users)
      .set({ notificationPrefs: merged, updatedAt: new Date() })
      .where(eq(users.id, userId));

    return {
      userId,
      organizationId: orgId,
      ...merged,
      updatedAt: new Date(),
    };
  },

  /**
   * Check if a specific event should trigger a channel for a user.
   * Async because preferences live in the DB now.
   */
  async shouldNotify(
    userId: string,
    orgId: number,
    eventId: string,
    channel: keyof NotificationChannel
  ): Promise<boolean> {
    const prefs = await this.getPreferences(userId, orgId);
    if (prefs.globalMute) return false;

    const override = prefs.overrides[eventId];
    if (override && override[channel] !== undefined) {
      return override[channel] as boolean;
    }

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
