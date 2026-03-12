import { sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";

// Session storage table (used by connect-pg-simple).
export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)]
);

// User storage table.
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email").unique(),
  passwordHash: varchar("password_hash"),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  referralCode: varchar("referral_code", { length: 16 }).unique(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type UpsertUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;

// Password reset tokens table.
export const passwordResetTokens = pgTable(
  "password_reset_tokens",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    token: varchar("token", { length: 128 }).notNull().unique(),
    expiresAt: timestamp("expires_at").notNull(),
    usedAt: timestamp("used_at"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [
    index("IDX_prt_token").on(table.token),
    index("IDX_prt_user").on(table.userId),
    index("IDX_prt_expires").on(table.expiresAt),
  ]
);

export type PasswordResetToken = typeof passwordResetTokens.$inferSelect;

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
