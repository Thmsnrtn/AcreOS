// ============================================================================
// SHARED/SCHEMA/AUTOPILOT-WITNESS-GRANTS.TS
// ----------------------------------------------------------------------------
// Founder Autopilot — persisted WitnessGrants (step-away gap #5).
//
// The DB half of server/services/autopilot/witnessGrant.ts (the pure policy
// engine). A row is a founder-issued, bounded, expiring, revocable delegation
// of the witnessed-send tap to a named principal (typically the machine
// principal "solene"). Every bound is a ceiling/allowlist; the conservative
// belts (deny_money / deny_broadcast) DEFAULT TRUE so a grant covers money or
// broadcasts only when the founder explicitly says so.
//
// used_count is consumed ATOMICALLY (UPDATE ... WHERE used_count < max_actions
// RETURNING) so the action budget is real under concurrency.
//
// Mirror in scripts/migrate.mjs (migration 0186).
// ============================================================================

import {
  pgTable,
  text,
  serial,
  integer,
  numeric,
  boolean,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";

export const witnessGrants = pgTable(
  "witness_grants",
  {
    id: serial("id").primaryKey(),
    /** The human delegating authority — always a real founder principal. */
    grantorId: text("grantor_id").notNull(),
    /** The principal authorized to tap on the grantor's behalf. */
    granteeId: text("grantee_id").notNull(),
    /** Allowlisted autopilot domains. Empty ⇒ covers NOTHING (fail-closed). */
    domains: jsonb("domains").$type<string[]>().notNull().default([]),
    /** Per-action predicted-cost ceiling in USD. */
    maxCostUsd: numeric("max_cost_usd", { precision: 10, scale: 2 }).notNull(),
    /** Total actions this grant may witness over its life. */
    maxActions: integer("max_actions").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    /** Conservative belts — a grant covers money/broadcasts only by explicit opt-in. */
    denyMoney: boolean("deny_money").notNull().default(true),
    denyBroadcast: boolean("deny_broadcast").notNull().default(true),
    usedCount: integer("used_count").notNull().default(0),
    revoked: boolean("revoked").notNull().default(false),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokeReason: text("revoke_reason"),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
    /** Founder's free-text note on why this grant exists. */
    note: text("note"),
  },
  (t) => [
    index("witness_grants_grantee_idx").on(t.granteeId, t.revoked, t.expiresAt),
    index("witness_grants_issued_idx").on(t.issuedAt),
  ],
);

export type WitnessGrantRow = typeof witnessGrants.$inferSelect;
export type InsertWitnessGrantRow = typeof witnessGrants.$inferInsert;
