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
  /**
   * Workstream A (Honesty) — kill switch.
   * ISO-8601 timestamp. While in the future, all autonomous action for this
   * agent MUST be skipped (only asked / drafted, never executed). Downstream
   * executors (e.g. server/services/autonomousDecisionExecutor.ts) must
   * respect this when wired. Cleared by the "reset to manual-only" or by
   * the timestamp passing.
   */
  pausedUntil?: string;
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
 * ENFORCED (P-1, 2026-08-09): this matrix is no longer a display-only
 * preference. `resolveActionPolicy` (server/services/resolveActionPolicy.ts)
 * consumes it — org-scoped, most-restrictive-human-wins, same fail-safe
 * direction as paxPause — and is consulted at the SINGLE chokepoint where
 * pending_actions are written (approvalKernel.proposePendingAction). The
 * resolved decision + rule are stamped on every pending action, `forbid`
 * refuses at the chokepoint, and nothing may execute without human approval
 * unless a stamped `auto_with_receipt` grant exists (no such execution lane
 * is built yet — see the Wave 6.5 seam note in resolveActionPolicy.ts).
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

/** The three matrix agents. Keys of AutonomyPreferences (minus timeGuards). */
export type AutonomyAgent = "atlas" | "pax" | "sophie";

/**
 * P-1 (master handoff Part 2 §7.2) — the resolved autonomy verdict for one
 * action, produced by resolveActionPolicy from the stored matrix above:
 *
 *   suggest           — level 0 Observe: Pax may only surface the idea.
 *   draft             — level 1 Draft: prepare the artifact; human reviews.
 *   require_approval  — witnessed approval required (the default, and every
 *                       downgrade lands here). Today's de-facto kernel
 *                       behavior for all consequential actions.
 *   auto_with_receipt — the matrix grants autonomous execution (level 2/3,
 *                       under threshold, inside allowed hours, not paused).
 *                       NOTE: no execution lane acts on this yet — actions so
 *                       stamped still freeze for human approval; Wave 6.5
 *                       adds the standing-instruction consent artifact that
 *                       any future auto lane must additionally require.
 *   forbid            — the matrix disallows the action outright; the
 *                       chokepoint refuses and writes nothing.
 */
export type ActionPolicyDecision =
  | "suggest"
  | "draft"
  | "require_approval"
  | "auto_with_receipt"
  | "forbid";

/**
 * Stamped onto every pending_actions row at proposal time (the `policy`
 * column) so the ledger records WHICH matrix rule governed each action —
 * the receipt half of "promise = behavior".
 */
export interface ActionPolicyStamp {
  decision: ActionPolicyDecision;
  /** The matrix rule that produced the decision, human-readable. */
  reason: string;
  agent: AutonomyAgent;
  /** ISO-8601 instant the policy was resolved. */
  resolvedAt: string;
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
  // Wave 3 Workstream E — distribution telemetry.
  // Acquisition UTM captured at signup. Written exactly once via the
  // idempotent /api/me/acquisition-utm endpoint on the first authenticated
  // request after sign-up. Null for legacy users and for direct loads with
  // no UTM params + no cross-origin referrer. The org-level utm_* columns
  // (organizations.utm_source etc.) are legacy and remain in place; this
  // column is the canonical per-user acquisition surface the founder
  // /customers viewer reads.
  acquisitionUtm: jsonb("acquisition_utm").$type<AcquisitionUtm>(),
  // E-SIGN Act §101(c)(1)(B) consumer-consent timestamp (Workstream A).
  // Captures the moment the user affirmed the five required pre-consent
  // disclosures (hardware requirements, paper-copy right + fees, withdrawal
  // right + consequences, contact-info update procedures, scope statement).
  // Null until consent is captured; once set, the dialog is suppressed for
  // future signing sessions by this user. The full disclosure version + audit
  // row lives in the signing_consent_audit table.
  esignConsentedAt: timestamp("esign_consented_at"),
  // Disclosure version string for the consent currently on file. Format is
  // 'YYYY-MM-DD' matching ESIGN_DISCLOSURE_VERSION pinned in schema.ts. When
  // we materially change the disclosure text, the version bumps and the
  // dialog re-fires; the prior consent row remains in audit for evidentiary
  // value.
  esignConsentVersion: varchar("esign_consent_version", { length: 32 }),
  // Constitution §7 + Colorado SB 24-205 AI-disclosure consent.
  // Null until the customer clicks "I understand — continue" in the
  // AiDisclosureDialog at onboarding entry. Idempotent writes only (once
  // set, not overwritten). When AI_DISCLOSURE_VERSION bumps (wording change),
  // aiDisclosureVersion diverges from the current constant and the dialog
  // re-fires, preserving the original consent row for evidentiary value.
  aiDisclosedAt: timestamp("ai_disclosed_at"),
  aiDisclosureVersion: varchar("ai_disclosure_version", { length: 32 }),
  // Phase Zero-Three gate (Beatrice audit 2026-06-01) — auditable record of
  // the customer's acknowledgement of AI involvement at the first /pax
  // interaction surface. Constitution §7 (disclosure at first interaction)
  // + CO SB 24-205 §6-1-1703 (evidentiary trail) require server-side
  // capture; the prior localStorage greeting-dismissed key was not
  // auditable. Set once via POST /api/pax/acknowledge-disclosure;
  // idempotent (no overwrite once non-null).
  paxDisclosureAcknowledgedAt: timestamp("pax_disclosure_acknowledged_at"),
  // Clickwrap acceptance of Terms of Service. Captured by the required
  // checkbox at signup (auth-page.tsx) before the Clerk widget renders.
  // The first hydrateUser request after sign-up writes this column from
  // the client-side acceptance timestamp planted on the auth page.
  // Nullable in schema so existing pre-clickwrap users are grandfathered;
  // every NEW user record is written with a non-null value.
  tosAcceptedAt: timestamp("tos_accepted_at"),
  // Clickwrap acceptance of Privacy Policy. Set simultaneously with
  // tosAcceptedAt at signup; separate column lets us track per-document
  // re-acceptance if Privacy v1.1 ships without re-bumping ToS.
  privacyAcceptedAt: timestamp("privacy_accepted_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

/**
 * Per-user acquisition attribution snapshot. Captured client-side on the
 * pre-signup landing visit (window.location.search + document.referrer)
 * and persisted on the user row exactly once at signup. Read by the
 * founder /customers viewer and by downstream cohort analyses.
 */
export interface AcquisitionUtm {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
  referrer?: string;
  landedAt?: string;
  // Tier 2C — referral + tier context ride the same first-touch chain.
  // `ref` is the referrer's referral code (?ref=CODE on any landing URL);
  // the server also applies it to the referrals table at signup flush.
  // `plan` / `billing` capture which pricing CTA the user clicked
  // (?plan=pro&billing=yearly) so trial_to_paid cohorts can be segmented
  // by stated intent vs. what they actually bought.
  ref?: string;
  plan?: string;
  billing?: string;
  // Tier 3A — the public parcel report that brought this user in. Format
  // "ST/county-slug/APN" (e.g. "TX/travis/0123456789"), captured client-side
  // from the /p/:state/:county/:apn pathname on first touch. Lets cohort
  // analysis answer "which shared reports convert?" and lets onboarding
  // carry the parcel into the new workspace.
  parcel?: string;
}

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
