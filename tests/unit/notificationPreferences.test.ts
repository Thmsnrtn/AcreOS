/**
 * T222 — Notification Preferences Tests
 * Tests channel filtering, quiet hours, and preference merge logic.
 */

import { describe, it, expect } from "vitest";

// ─── Inline pure logic ────────────────────────────────────────────────────────

type NotificationChannel = "email" | "sms" | "push" | "in_app";
type NotificationCategory = "lead_alert" | "deal_update" | "task_reminder" | "team_message" | "system";

interface NotificationPreferences {
  userId: number;
  channels: Partial<Record<NotificationChannel, boolean>>;
  categories: Partial<Record<NotificationCategory, boolean>>;
  quietHoursStart?: number; // 0-23 hour
  quietHoursEnd?: number;   // 0-23 hour
  timezone: string;
}

function isChannelEnabled(prefs: NotificationPreferences, channel: NotificationChannel): boolean {
  return prefs.channels[channel] !== false;
}

function isCategoryEnabled(prefs: NotificationPreferences, category: NotificationCategory): boolean {
  return prefs.categories[category] !== false;
}

function isInQuietHours(prefs: NotificationPreferences, localHour: number): boolean {
  if (prefs.quietHoursStart === undefined || prefs.quietHoursEnd === undefined) return false;
  const { quietHoursStart: start, quietHoursEnd: end } = prefs;
  if (start <= end) {
    return localHour >= start && localHour < end;
  }
  // Wraps midnight (e.g., 22–06)
  return localHour >= start || localHour < end;
}

function shouldSendNotification(
  prefs: NotificationPreferences,
  channel: NotificationChannel,
  category: NotificationCategory,
  localHour: number,
  urgency: "urgent" | "normal" = "normal"
): boolean {
  if (!isChannelEnabled(prefs, channel)) return false;
  if (!isCategoryEnabled(prefs, category)) return false;
  if (urgency !== "urgent" && isInQuietHours(prefs, localHour)) return false;
  return true;
}

function mergePreferences(
  defaults: NotificationPreferences,
  overrides: Partial<NotificationPreferences>
): NotificationPreferences {
  return {
    ...defaults,
    ...overrides,
    channels: { ...defaults.channels, ...overrides.channels },
    categories: { ...defaults.categories, ...overrides.categories },
  };
}

function getDefaultPreferences(userId: number): NotificationPreferences {
  return {
    userId,
    channels: { email: true, sms: true, push: true, in_app: true },
    categories: {
      lead_alert: true,
      deal_update: true,
      task_reminder: true,
      team_message: true,
      system: true,
    },
    timezone: "America/Chicago",
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("isChannelEnabled", () => {
  it("returns true by default (not explicitly set)", () => {
    const prefs = getDefaultPreferences(1);
    expect(isChannelEnabled(prefs, "email")).toBe(true);
  });

  it("returns false when channel explicitly disabled", () => {
    const prefs: NotificationPreferences = {
      ...getDefaultPreferences(1),
      channels: { email: false },
    };
    expect(isChannelEnabled(prefs, "email")).toBe(false);
  });

  it("returns true when channel not mentioned in preferences", () => {
    const prefs: NotificationPreferences = {
      ...getDefaultPreferences(1),
      channels: {},
    };
    expect(isChannelEnabled(prefs, "push")).toBe(true);
  });
});

describe("isCategoryEnabled", () => {
  it("returns true for enabled category", () => {
    const prefs = getDefaultPreferences(1);
    expect(isCategoryEnabled(prefs, "lead_alert")).toBe(true);
  });

  it("returns false for disabled category", () => {
    const prefs: NotificationPreferences = {
      ...getDefaultPreferences(1),
      categories: { team_message: false },
    };
    expect(isCategoryEnabled(prefs, "team_message")).toBe(false);
  });

  it("returns true for unspecified category", () => {
    const prefs: NotificationPreferences = {
      ...getDefaultPreferences(1),
      categories: {},
    };
    expect(isCategoryEnabled(prefs, "system")).toBe(true);
  });
});

describe("isInQuietHours", () => {
  const prefs: NotificationPreferences = {
    ...getDefaultPreferences(1),
    quietHoursStart: 22,
    quietHoursEnd: 7,
  };

  it("returns true at midnight (within quiet hours)", () => {
    expect(isInQuietHours(prefs, 0)).toBe(true);
  });

  it("returns true at 23:00 (within quiet hours)", () => {
    expect(isInQuietHours(prefs, 23)).toBe(true);
  });

  it("returns true at 6:00 (within quiet hours)", () => {
    expect(isInQuietHours(prefs, 6)).toBe(true);
  });

  it("returns false at 12:00 (outside quiet hours)", () => {
    expect(isInQuietHours(prefs, 12)).toBe(false);
  });

  it("returns false when no quiet hours configured", () => {
    const noQuiet = getDefaultPreferences(1);
    expect(isInQuietHours(noQuiet, 0)).toBe(false);
  });

  it("handles same-day quiet hours (10-22)", () => {
    const dayQuiet: NotificationPreferences = {
      ...getDefaultPreferences(1),
      quietHoursStart: 10,
      quietHoursEnd: 22,
    };
    expect(isInQuietHours(dayQuiet, 15)).toBe(true);
    expect(isInQuietHours(dayQuiet, 9)).toBe(false);
    expect(isInQuietHours(dayQuiet, 23)).toBe(false);
  });
});

describe("shouldSendNotification", () => {
  const prefs: NotificationPreferences = {
    ...getDefaultPreferences(1),
    quietHoursStart: 22,
    quietHoursEnd: 7,
  };

  it("returns true for normal notification during business hours", () => {
    expect(shouldSendNotification(prefs, "email", "lead_alert", 10)).toBe(true);
  });

  it("returns false during quiet hours for normal urgency", () => {
    expect(shouldSendNotification(prefs, "email", "lead_alert", 23)).toBe(false);
  });

  it("returns true during quiet hours for urgent notification", () => {
    expect(shouldSendNotification(prefs, "email", "lead_alert", 23, "urgent")).toBe(true);
  });

  it("returns false when channel disabled", () => {
    const noSms: NotificationPreferences = {
      ...prefs,
      channels: { sms: false },
    };
    expect(shouldSendNotification(noSms, "sms", "lead_alert", 10)).toBe(false);
  });

  it("returns false when category disabled", () => {
    const noDeals: NotificationPreferences = {
      ...prefs,
      categories: { deal_update: false },
    };
    expect(shouldSendNotification(noDeals, "email", "deal_update", 10)).toBe(false);
  });
});

describe("mergePreferences", () => {
  it("overrides specific channels", () => {
    const defaults = getDefaultPreferences(1);
    const merged = mergePreferences(defaults, { channels: { sms: false } });
    expect(merged.channels.sms).toBe(false);
    expect(merged.channels.email).toBe(true);
  });

  it("preserves non-overridden fields", () => {
    const defaults = getDefaultPreferences(1);
    const merged = mergePreferences(defaults, { timezone: "America/New_York" });
    expect(merged.timezone).toBe("America/New_York");
    expect(merged.channels.email).toBe(true);
  });

  it("merges categories independently from channels", () => {
    const defaults = getDefaultPreferences(1);
    const merged = mergePreferences(defaults, { categories: { system: false } });
    expect(merged.categories.system).toBe(false);
    expect(merged.categories.lead_alert).toBe(true);
  });
});
