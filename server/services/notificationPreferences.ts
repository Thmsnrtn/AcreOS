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
    description: "Offers going out, sellers responding, closings coming up",
    events: [
      {
        id: "deal.offer_sent",
        label: "An offer goes out",
        description: "When an offer letter is sent to a seller",
        defaultChannels: { email: true, sms: false, push: true, inApp: true },
      },
      {
        id: "deal.status_changed",
        label: "A deal moves forward",
        description: "When one of your deals moves to a new stage",
        defaultChannels: { email: true, sms: false, push: true, inApp: true },
      },
      {
        id: "deal.closing_reminder",
        label: "A closing is 3 days away",
        description: "A reminder 3 days before a scheduled closing",
        defaultChannels: { email: true, sms: true, push: true, inApp: true },
      },
      {
        id: "deal.counter_received",
        label: "A seller counters your offer",
        description: "When a seller comes back with a different number",
        defaultChannels: { email: true, sms: true, push: true, inApp: true },
      },
    ],
  },
  {
    id: "leads",
    label: "Leads",
    description: "New leads coming in, sellers replying, leads going quiet",
    events: [
      {
        id: "lead.imported",
        label: "New leads finish importing",
        description: "One summary when a batch of leads lands — not one alert per lead",
        defaultChannels: { email: false, sms: false, push: false, inApp: true },
      },
      {
        id: "lead.high_intent",
        label: "A seller looks ready to sell",
        description: "When the AI thinks a seller is ready to act — the ones to call first",
        defaultChannels: { email: true, sms: true, push: true, inApp: true },
      },
      {
        id: "lead.aged_out",
        label: "A lead goes quiet",
        description: "When a lead has had no activity for 60+ days",
        defaultChannels: { email: false, sms: false, push: false, inApp: true },
      },
      {
        id: "lead.responded",
        label: "A seller replies",
        description: "When a lead answers one of your letters, texts, or emails",
        defaultChannels: { email: true, sms: true, push: true, inApp: true },
      },
    ],
  },
  {
    id: "campaigns",
    label: "Campaigns",
    description: "Your letters, texts, and emails going out — and how they're doing",
    events: [
      {
        id: "campaign.send_complete",
        label: "A campaign finishes sending",
        description: "When a round of letters, texts, or emails has all gone out",
        defaultChannels: { email: true, sms: false, push: true, inApp: true },
      },
      {
        id: "campaign.low_performance",
        label: "A campaign is underperforming",
        description: "When far fewer people than usual are opening or replying",
        defaultChannels: { email: true, sms: false, push: false, inApp: true },
      },
    ],
  },
  {
    id: "finance",
    label: "Finance",
    description: "Payments on the notes you hold",
    events: [
      {
        id: "finance.payment_due",
        label: "A payment is due in 7 days",
        description: "A heads-up one week before a note payment is due to you",
        defaultChannels: { email: true, sms: false, push: true, inApp: true },
      },
      {
        id: "finance.payment_missed",
        label: "A payment is missed",
        description: "When a note payment you're owed is 3+ days late",
        defaultChannels: { email: true, sms: true, push: true, inApp: true },
      },
      {
        id: "finance.note_paid_off",
        label: "A note is paid off",
        description: "When a buyer makes the final payment on a note you hold",
        defaultChannels: { email: true, sms: false, push: true, inApp: true },
      },
    ],
  },
  {
    id: "billing",
    label: "Billing",
    description: "Your AcreOS subscription and card",
    events: [
      {
        // Phase 3 W10 — SMS leg of the AcreOS subscription dunning sequence.
        // Defaults ON because a declined card is high-stakes and customers
        // usually want a heads-up. Owners can flip sms → false to opt out.
        // Throttled to one SMS per dunning sequence regardless of preference.
        id: "billing.dunning_sms",
        label: "Your card is declined — one text",
        description: "If your card fails, we text you once (3 days in) so your account doesn't lapse",
        defaultChannels: { email: false, sms: true, push: false, inApp: false },
      },
    ],
  },
  {
    id: "system",
    label: "System",
    description: "Weekly summaries, AI insights, and anything that breaks",
    events: [
      {
        id: "system.weekly_digest",
        label: "Your week in one email",
        description: "A weekly summary of your deals, leads, and money",
        defaultChannels: { email: true, sms: false, push: false, inApp: false },
      },
      {
        id: "system.ai_insight",
        label: "The AI spots an opportunity",
        description: "When the AI finds a market opening worth a look",
        defaultChannels: { email: false, sms: false, push: true, inApp: true },
      },
      {
        id: "system.integration_error",
        label: "Something you rely on breaks",
        description: "When a connected service fails — payments, texting — and needs attention",
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
