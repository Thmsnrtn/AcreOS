import { sql } from "drizzle-orm";
import { index, integer, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";

// User storage table.
// Identity is managed by Clerk; clerkUserId links our record to their user.
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  clerkUserId: varchar("clerk_user_id", { length: 255 }).unique(),
  email: varchar("email").unique(),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  referralCode: varchar("referral_code", { length: 16 }).unique(),
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
