// ============================================================================
// SHARED/SCHEMA/HARDENING.TS
// ----------------------------------------------------------------------------
// Phase 0 traffic-readiness hardening tables:
//   - signup_signals: bot-signal collection at signup (honeypot, time-to-fill,
//     UA fingerprint, ip-bucket). CAPTURE-ONLY — no blocking on these signals
//     without explicit founder gate.
//   - sanctions_list: OFAC SDN hashes for signup-time blocklist check. Daily
//     cron rebuilds the table from the public Treasury CSV. Stores ONLY
//     SHA-256 truncations + a short program code; no PII.
// ============================================================================

import {
  pgTable,
  text,
  serial,
  integer,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Bot-signal capture on signup. One row per signup attempt — independent of
 * whether the signup succeeds — so the founder can review the noise floor
 * over time and decide when to flip ENABLE_CAPTCHA=1.
 *
 * The is_suspicious boolean is the rollup: any of {honeypot_filled,
 * time_to_fill_ms < 2000, ua_matches_known_crawler} triggers it. reasons[]
 * lists the matched signals.
 */
export const signupSignals = pgTable(
  "signup_signals",
  {
    id: serial("id").primaryKey(),
    // SHA-256(email) — we keep this hashed because the row may persist for
    // attempts that never produce an account (failed validation, abandoned
    // signup). Hashing keeps the captured-only table from being a PII store.
    emailHash: text("email_hash"),
    // Linked once the signup completes and we have a user_id.
    userId: text("user_id"),
    userAgent: text("user_agent"),
    // /24 IPv4 or /48 IPv6 bucket. Matches the cellular-NAT-safe coarsening
    // used in server/middleware/authPathLimits.ts.
    ipBucket: text("ip_bucket"),
    honeypotFilled: boolean("honeypot_filled").notNull().default(false),
    timeToFillMs: integer("time_to_fill_ms"),
    isSuspicious: boolean("is_suspicious").notNull().default(false),
    // Array of signal names that matched, e.g. ["honeypot", "ttf-too-fast"].
    reasons: jsonb("reasons").notNull().default([]),
    captchaTokenPresent: boolean("captcha_token_present").notNull().default(false),
    captchaVerified: boolean("captcha_verified"),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    capturedIdx: index("signup_signals_captured_idx").on(t.capturedAt),
    suspiciousIdx: index("signup_signals_suspicious_idx").on(t.isSuspicious, t.capturedAt),
    ipBucketIdx: index("signup_signals_ip_bucket_idx").on(t.ipBucket, t.capturedAt),
  }),
);

export type SignupSignal = typeof signupSignals.$inferSelect;
export type NewSignupSignal = typeof signupSignals.$inferInsert;

/**
 * OFAC SDN sanctions list — daily-refreshed hash table for signup-time
 * blocklist check. We hash (name + country) tuples from the public Treasury
 * CSV and keep only the first 12 hex chars of SHA-256 — enough entropy to
 * make collision rate negligible against the ~10k-entry SDN list, small
 * enough that the table itself is not a database of names.
 *
 * The signup-time check is a single PK lookup keyed on
 * (list_source, name_country_hash).
 *
 * This is the Phase 0 FLOOR — not a substitute for real sanctions
 * compliance at Phase 2+. It says "we're not blind" rather than "we are
 * audited".
 */
export const sanctionsList = pgTable(
  "sanctions_list",
  {
    id: serial("id").primaryKey(),
    nameCountryHash: text("name_country_hash").notNull(),
    listSource: text("list_source").notNull().default("ofac-sdn"),
    program: text("program"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    hashUk: uniqueIndex("sanctions_list_hash_uk").on(t.listSource, t.nameCountryHash),
    fetchedIdx: index("sanctions_list_fetched_idx").on(t.fetchedAt),
  }),
);

export type SanctionsListEntry = typeof sanctionsList.$inferSelect;
export type NewSanctionsListEntry = typeof sanctionsList.$inferInsert;
