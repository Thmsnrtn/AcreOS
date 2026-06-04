// ============================================================================
// SHARED/SCHEMA/PAX-USER-CONTEXT.TS
// ----------------------------------------------------------------------------
// Phase D1 — per-user Pax context capture + injection.
//
// One row per (Clerk) user. Captured at onboarding via PaxContextStep, read by
// `server/services/pax/userContext.ts → buildUserScopedPromptAppendix` to
// generate the per-user system-prompt appendix injected into every Pax turn.
//
// Privacy posture (constitutional immutables):
//   §3  data minimization      → 5 fields total; nothing beyond what
//                                 materially improves Pax personalization.
//   §5  no cross-customer share → indexes are user-scoped only.
//   §7  AI disclosure          → opted_in_personalization is the on/off knob
//                                 the customer controls from Settings.
//   §8  delete within 7 days   → deleteUserContext() hard-deletes the row.
//
// `vertical`, `experience_level`, and `investment_goals` reference enum
// LITERALS from sibling D1-B's `shared/schema/pax-verticals.ts`. We keep
// columns as plain `text` / `text[]` and validate at the service boundary,
// so the table works even if D1-B is rolled out independently.
// ============================================================================

import {
  pgTable,
  text,
  serial,
  boolean,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const paxUserContext = pgTable(
  "pax_user_context",
  {
    id: serial("id").primaryKey(),
    // Clerk user id (string) — NOT a FK to a local users table because Pax
    // context attaches to the auth identity, not a row we own.
    userId: text("user_id").notNull(),
    // The user's home org at capture time. If they later switch orgs the
    // row stays — Pax personalization is per-person, not per-org.
    organizationId: text("organization_id").notNull(),

    // From PAX_VERTICALS in pax-verticals.ts (D1-B). Nullable: the user
    // can skip the question ("Multiple / I'm not sure yet") in which case
    // we fall back to the land_investing default at prompt-build time.
    vertical: text("vertical"),
    // From PAX_EXPERIENCE_LEVELS in pax-verticals.ts (D1-B).
    experienceLevel: text("experience_level"),
    // From PAX_INVESTMENT_GOALS in pax-verticals.ts (D1-B). Multi-select,
    // 1-3 values enforced at the form layer. Default '{}' so reads never
    // hit a NULL array.
    investmentGoals: text("investment_goals")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),

    // Free-text — e.g. "Texas Hill Country", "Southeast US", "Florida
    // Panhandle". Capped at the API boundary (no DB-level length cap so we
    // can iterate on the cap without a migration).
    geographicFocus: text("geographic_focus"),
    // What Pax should call the user. Defaults to Clerk first-name on the
    // form; users can override. NEVER required — anonymous-feel is OK.
    displayedName: text("displayed_name"),

    capturedAt: timestamp("captured_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // Updated as a side-effect of loadUserContext(). Powers the
    // distribution dashboard's "active context" metric.
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),

    // The privacy on/off switch. When false:
    //   - the row stays (so the user can re-enable without re-onboarding),
    //   - buildUserScopedPromptAppendix returns the land_investing default,
    //   - Pax behaves as though there is no captured context.
    optedInPersonalization: boolean("opted_in_personalization")
      .notNull()
      .default(true),
  },
  (t) => [
    // user_id unique — UPSERT key for captureUserContext().
    uniqueIndex("pax_user_context_user_id_unique").on(t.userId),
    index("pax_user_context_org_idx").on(t.organizationId),
    // Partial index — drives the founder distribution dashboard's "active
    // personalized users" sort. Skips opted-out rows so the index stays
    // tight as the platform grows.
    index("pax_user_context_active_idx")
      .on(t.optedInPersonalization, t.lastUsedAt)
      .where(sql`${t.optedInPersonalization} = true`),
  ],
);

export type PaxUserContextRow = typeof paxUserContext.$inferSelect;
export type InsertPaxUserContextRow = typeof paxUserContext.$inferInsert;
