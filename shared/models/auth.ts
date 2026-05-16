import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";

/**
 * User-scoped appearance preferences. Drives the theme system (5 themes ×
 * light/dark + 5 font pairings + density + motion) per design-system §3-§6,
 * plus sidebar/mobile-nav ordering and per-list-type view preferences (§6.3).
 * Mirror of `ThemeConfig` in client/src/contexts/theme-context.tsx — keep
 * the union types in sync when adding new options.
 */
export interface AppearancePreferences {
  theme?: "bedrock" | "homestead" | "quarry" | "nocturne" | "meadow" | "slate";
  mode?: "light" | "dark" | "auto";
  fontPairing?: "editorial" | "modern" | "classic" | "native" | "refined";
  density?: "compact" | "comfortable" | "adaptive";
  motion?: "full" | "reduced";
  /**
   * Sidebar + mobile bottom-bar customization. IDs reference the flat
   * registry in client/src/lib/nav-items.ts. Desktop sidebar refactor to
   * consume this lands in Phase E with the shell re-skin (JUDGMENT-CALLS C.1.1).
   */
  sidebarConfig?: {
    sidebarItems?: string[];
    mobileItems?: string[];
  };
  /**
   * Per-list-type view preferences (rows / cards / expand-on-click). Keys
   * are list-type IDs from design-system §5.5.
   */
  listViews?: Record<string, "rows" | "cards" | "expand-on-click">;
  /**
   * Notification quiet hours (per-user, applies to all channels).
   * Hours are 0-23 in the user's local timezone (browser-detected at
   * enable time). When `enabled`, in-app + email + SMS notifications are
   * suppressed during the [start, end) window; if start > end the window
   * wraps midnight (e.g. 19→8 = 7pm to 8am next day).
   */
  notificationQuietHours?: {
    enabled?: boolean;
    startHour?: number;
    endHour?: number;
  };
}

export type AutonomyLevel = 0 | 1 | 2 | 3;

export interface AgentAutonomy {
  /** Top-level scale (0 Observe / 1 Draft / 2 Execute / 3 Autonomous). */
  level?: AutonomyLevel;
  /** Per-action overrides — keys are action IDs from per-agent registry. */
  perAction?: Record<string, AutonomyLevel>;
  /** Monetary thresholds (cents) — keys are action IDs that gate on $$$. */
  thresholdsCents?: Record<string, number>;
}

/**
 * Per-user notification matrix (JC#11). Persisted at users.notification_prefs;
 * read/written via server/services/notificationPreferences.ts.
 *
 * `overrides` is keyed by event ID (e.g. "deal.offer_sent"); each value is
 * a partial channel toggle map. Missing channels fall back to the event's
 * defaultChannels in NOTIFICATION_SCHEMA so the service has a single source
 * of truth for "what arrives by default."
 */
export interface UserNotificationPrefsShape {
  overrides?: Record<string, Partial<{ email: boolean; sms: boolean; push: boolean; inApp: boolean }>>;
  globalMute?: boolean;
  weeklyDigest?: boolean;
  digestDay?: "monday" | "tuesday" | "wednesday" | "thursday" | "friday";
  digestHour?: number;
}

/**
 * Investor archetype. Drives onboarding path, default surfaces, and
 * vocabulary substitutions per VERTICAL-EXPANSION-PLAN.md. Default for
 * existing users is "land_investor" — the v6 product positioning.
 *
 * Add new personas to the registry in client/src/lib/personaVocabulary.ts;
 * the column is plain text so persona expansion doesn't require a migration.
 */
export type Persona =
  | "land_investor"
  | "note_investor"
  | "note_originator"   // Pillar K: Devon (land seller-financer), Hugo (tax-lien-to-note convertor). Wears the lender hat, not the secondary-market hat.
  | "note_servicer"     // Pillar K: Ursa (licensed sub-servicer). Services notes for others; not the beneficial owner.
  | "tax_delinquent"
  | "wholesaler"
  | "subdivider"
  | "fix_flipper"
  | "landlord";

/**
 * Per-agent autonomy matrix (design-system §7). 4-level scale
 * (0 Observe / 1 Draft / 2 Execute / 3 Autonomous) per agent, with
 * per-action overrides and monetary thresholds where applicable.
 * Time guards apply to all agents.
 *
 * Server-side enforcement is wired progressively as Phase E surfaces
 * touch agent action paths — for now this stores the user's intent;
 * agents read it at action time and gate / ask / log accordingly.
 *
 * Phase D gates this UI behind feature.autonomy-matrix (founder-only)
 * until UX polish complete (design-system §8.4).
 *
 * Lives in its own column (JC#14) — see migrations/0030. Decoupled from
 * AppearancePreferences so theme writes can't trample autonomy policy
 * and agents read a narrow surface at action time.
 */
export interface AutonomyPreferences {
  atlas?: AgentAutonomy;
  pax?: AgentAutonomy;
  sophie?: AgentAutonomy;
  timeGuards?: {
    pauseStartHour?: number;
    pauseEndHour?: number;
    dailyActionLimit?: number;
  };
}

// User storage table.
// Identity is managed by Clerk; clerkUserId links our record to their user.
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  clerkUserId: varchar("clerk_user_id", { length: 255 }).unique(),
  email: varchar("email").unique(),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  // Task #12: Password reset flow — token is a 64-char hex string, one-time use, 1-hour TTL
  passwordResetToken: varchar("password_reset_token"),
  passwordResetExpiresAt: timestamp("password_reset_expires_at"),
  // Task #8: Account lockout — lock after 5 consecutive failed logins for 30 minutes
  failedLoginAttempts: varchar("failed_login_attempts").default("0"),
  lockedUntil: timestamp("locked_until"),
  referralCode: varchar("referral_code", { length: 16 }).unique(),
  // User-scoped appearance preferences (theme, mode, font pairing, density, motion).
  // Defaults applied client-side via DEFAULT_CONFIG in theme-context.tsx; nulls in
  // any field fall back to those defaults.
  appearancePreferences: jsonb("appearance_preferences").$type<AppearancePreferences>(),
  // Per-agent autonomy matrix — split off from appearance_preferences in
  // migration 0030 so theme writes can't trample agent policy.
  autonomyPreferences: jsonb("autonomy_preferences").$type<AutonomyPreferences>(),
  // Investor archetype — drives onboarding path, default surfaces, and
  // vocabulary substitutions (JC#7 + VERTICAL-EXPANSION-PLAN.md). Validated
  // against the registry in client/src/lib/personaVocabulary.ts; stored as
  // free text so adding personas doesn't need a column migration.
  persona: text("persona").notNull().default("land_investor").$type<Persona>(),
  // Per-user notification matrix (JC#11) — overrides + global mute + digest.
  // Null = user hasn't adjusted; service applies category-tree defaults.
  // Shape matches UserNotificationPreferences in
  // server/services/notificationPreferences.ts.
  notificationPrefs: jsonb("notification_prefs").$type<UserNotificationPrefsShape>(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type UpsertUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;

// Referral tracking table.
export const referrals = pgTable(
  "referrals",
  {
    id: serial("id").primaryKey(),
    referrerId: varchar("referrer_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    refereeId: varchar("referee_id").references(() => users.id, { onDelete: "set null" }),
    code: varchar("code", { length: 16 }).notNull().unique(),
    status: text("status").notNull().default("pending"), // pending | signed_up | converted
    creditAmount: integer("credit_amount").notNull().default(0), // cents
    creditedAt: timestamp("credited_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("IDX_referrals_referrer").on(table.referrerId),
    index("IDX_referrals_code").on(table.code),
    index("IDX_referrals_referee").on(table.refereeId),
  ]
);

export type Referral = typeof referrals.$inferSelect;
