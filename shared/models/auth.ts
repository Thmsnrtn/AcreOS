import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";

/**
 * User-scoped appearance preferences. Drives the theme system (5 themes ×
 * light/dark + 5 font pairings + density + motion) per design-system §3-§6.
 * Mirror of `ThemeConfig` in client/src/contexts/theme-context.tsx — keep
 * the union types in sync when adding new options.
 */
export interface AppearancePreferences {
  theme?: "homestead" | "quarry" | "nocturne" | "meadow" | "slate";
  mode?: "light" | "dark" | "auto";
  fontPairing?: "editorial" | "modern" | "classic" | "native" | "refined";
  density?: "compact" | "comfortable" | "adaptive";
  motion?: "full" | "reduced";
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
