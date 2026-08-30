import { pgTable, text, serial, integer, bigint, bigserial, boolean, timestamp, numeric, varchar, jsonb, index, uniqueIndex, date, real, doublePrecision, check, customType, primaryKey } from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// W5-1 schema-split: tables now living in shared/schema/*.ts but referenced
// by relations blocks above their re-export line need direct import here.
// The re-exports at the bottom of this file are still the public API; these
// imports just resolve the forward-reference for the relations() calls.
import { chartOfAccounts, accountLedgerEntries } from "./schema/accounting-ops";
import { users } from "./models/auth";
import { dealRooms } from "./schema/marketplace";

/**
 * Phase 3 Week 14 (Sayuri-Vatanen §1): pgvector custom column type.
 *
 * Drizzle's pg-core doesn't ship a native `vector` type, so we declare a
 * `customType` that serializes a number[] to pgvector's wire format
 * (`[0.1,0.2,…]`) and deserializes it back. The dimension is encoded in
 * the SQL type only — we accept any-length arrays in JS and let Postgres
 * enforce the dim at write time.
 *
 * Used by `deal_patterns.embedding_vector` (dim=1536, OpenAI
 * `text-embedding-3-small`).
 */
export const vectorColumn = customType<{
  data: number[];
  driverData: string;
  config: { dimensions: number };
}>({
  dataType(config) {
    return `vector(${config?.dimensions ?? 1536})`;
  },
  toDriver(value: number[]): string {
    return `[${value.join(",")}]`;
  },
  fromDriver(value: string | number[]): number[] {
    if (Array.isArray(value)) return value as number[];
    if (typeof value === "string") {
      // Wire format: "[0.1,0.2,...]"
      const trimmed = value.replace(/^\[|\]$/g, "");
      if (!trimmed) return [];
      return trimmed.split(",").map((n) => parseFloat(n));
    }
    return [];
  },
});

// Import Auth and Chat models
export * from "./models/auth";
export * from "./models/chat";

// ============================================
// ORGANIZATIONS & TEAM MANAGEMENT
// ============================================

// Organizations (tenants for multi-tenancy)
export const organizations = pgTable("organizations", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  ownerId: text("owner_id").notNull(), // Replit user ID
  subscriptionTier: text("subscription_tier").notNull().default("free"), // free, starter, pro, scale (aliased to solo/operator/empire in shared/billing/tier-pricing.ts)
  subscriptionStatus: text("subscription_status").notNull().default("active"),
  // Billing cadence for the active subscription. MRR math in
  // /api/founder/executive-dashboard normalises yearly subscriptions to a
  // per-month figure using shared/billing/tier-pricing.ts.
  billingInterval: text("billing_interval").notNull().default("monthly"), // monthly | yearly
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  creditBalance: numeric("credit_balance").default("0"), // prepaid credit balance in cents
  // Dunning state
  dunningStage: text("dunning_stage").default("none"), // none, grace_period, warning, restricted, suspended, cancelled
  dunningStartedAt: timestamp("dunning_started_at"),
  lastPaymentFailedAt: timestamp("last_payment_failed_at"),
  // Auto top-up settings
  autoTopUpEnabled: boolean("auto_top_up_enabled").default(false),
  autoTopUpThresholdCents: integer("auto_top_up_threshold_cents").default(200), // Trigger when below $2
  autoTopUpAmountCents: integer("auto_top_up_amount_cents").default(2500), // Add $25
  // Seat management
  additionalSeats: integer("additional_seats").default(0), // Extra seats purchased beyond tier limit
  // Per-seat pricing (Phase 5 §5 — team-readiness). seat_count is the
  // canonical "how many active seats does this org pay for" value. Tier
  // bundles 1 seat; each additional seat is billed via the per-seat
  // add-on subscription. additional_seats is retained for legacy callers
  // and equals max(seat_count - 1, 0) for new flows.
  seatCount: integer("seat_count").notNull().default(1),
  // Offer-approval threshold (Phase 5 §5 Part E). When non-null, offers
  // with cashOffer or termsOffer above this dollar amount route to the
  // /team/offer-approvals queue instead of going out the door.
  requiresApprovalOffersOver: numeric("requires_approval_offers_over"),
  // Founder status - bypasses all limits and credit checks
  isFounder: boolean("is_founder").default(false),
  // Note Investor vertical (Phase 5 §5 Q4 2026). The wizard's first question
  // captures whether this org buys land, buys notes, or both. Drives sidebar
  // module visibility, onboarding-flow step skipping, and the persona
  // vocabulary register applied across the surface. Defaults to 'land' to
  // preserve every legacy org's behavior — they continue to see the land
  // surface unchanged.
  investorType: text("investor_type").notNull().default("land"), // 'land' | 'notes' | 'both'
  // Onboarding wizard state
  onboardingCompleted: boolean("onboarding_completed").default(false),
  onboardingStep: integer("onboarding_step").default(0),
  onboardingData: jsonb("onboarding_data").$type<{
    businessType?: "land_flipper" | "note_investor" | "hybrid" | "residential_wholesaler" | "fix_and_flip" | "buy_and_hold" | "commercial" | "short_term_rental" | "creative_finance" | "developer" | "subdivider" | "tax_lien_deed" | "multifamily" | "mobile_home" | "agent_investor";
    dataImported?: boolean;
    stripeConnected?: boolean;
    campaignCreated?: boolean;
    completedSteps?: number[];
    skippedSteps?: number[];
    aiTips?: string[];
    // Tax-identity onboarding step (1099 issuer fields). Stored here rather
    // than as a top-level column because the columns shipped via 0035; the
    // skip flag is purely UX state. The 1099 generator still 422s when the
    // identity columns are unset — skipping only completes onboarding.
    skippedTaxIdentity?: { skipped: boolean; skippedAt: string };
    taxIdentityCapturedAt?: string;
  }>(),
  settings: jsonb("settings").$type<{
    timezone?: string;
    currency?: string;
    defaultInterestRate?: number;
    defaultTermMonths?: number;
    companyAddress?: string;
    companyPhone?: string;
    companyEmail?: string;
    onboardingCompleted?: boolean;
    showTips?: boolean;
    checklistDismissed?: boolean;
    notificationsConfigured?: boolean;
    mailMode?: "test" | "live";
    // Data Retention Policies (20.3)
    retentionPolicies?: {
      leads?: { enabled: boolean; retentionDays: number };
      closedDeals?: { enabled: boolean; retentionDays: number };
      auditLogs?: { enabled: boolean; retentionDays: number };
      communications?: { enabled: boolean; retentionDays: number };
    };
    // AI Settings
    aiSettings?: {
      responseStyle?: "concise" | "detailed" | "balanced";
      defaultAgent?: string;
      autoSuggestions?: boolean;
      rememberContext?: boolean;
      // Pax inbox drafted-reply gate (product-call #10). Defaulted on; set
      // to false from Settings → Notifications when an org wants their
      // inbox replies fully manual.
      paxDraftEnabled?: boolean;
    };
    // Dashboard Widget Settings
    dashboardWidgets?: {
      order: string[];
      visibility: Record<string, boolean>;
    };
    /**
     * VA workflow definitions, authored by the customer.
     *
     * Stored here rather than in a table of their own, which is the shape that
     * makes the cap below load-bearing: `organizations` is SELECTed in full on
     * EVERY org-scoped request (getOrCreateOrg → getOrganizationByOwner), so
     * this array rides along on every read the product does. It had no cap and
     * no delete path — only create and list — so it grew forever.
     *
     * Declared here rather than reached through `(org as any).settings`, for
     * the same reason as `simulationMode` below: a field outside its column's
     * own type cannot be carried by a typed write and can be erased by one.
     */
    va_workflows?: Array<{
      id: string;
      organizationId: number;
      createdByUserId?: string | null;
      name: string;
      description?: string;
      triggerType?: string;
      triggerConfig?: Record<string, unknown>;
      steps: Array<{
        stepNumber: number;
        title?: string;
        category?: string;
        description?: string;
        assignToRole?: string;
        estimatedMinutes?: number;
        dependsOnStep?: number | null;
      }>;
      status?: string;
      createdAt?: string;
      updatedAt?: string;
    }>;
    /**
     * VA task escalations — a LOG, not a delivery mechanism.
     *
     * `POST /api/va/escalate` wrote here and did nothing else: no route, job or
     * screen anywhere in the repo ever read the key back, and the named
     * supervisor was never told. It returned `{ success: true }` regardless.
     * The escalation now goes out as a notification to the named supervisor —
     * that is the delivery — and this array is the record of it.
     *
     * Bounded, because `organizations` is SELECTed in full on every org-scoped
     * request. Trimming the oldest is safe ONLY because the signal itself lives
     * in `notifications`; before that, dropping an entry would have dropped the
     * escalation.
     */
    va_escalations?: Array<{
      id: string;
      taskId: string;
      reason: string;
      urgency?: string;
      escalatedByUserId?: string | null;
      supervisorUserId: string;
      escalatedAt: string;
      status?: string;
      /** When the supervisor's notification was created. Null = not delivered. */
      notifiedAt?: string | null;
    }>;
    // Per-org simulation kill-switch — layer 3 of server/utils/simulationMode.ts
    // ("the single source of truth for no real-world side effects"). Read by
    // isOrgSimulated(); when true, no mail, SMS, email or webhook leaves the
    // building for this org.
    //
    // It was NOT declared here while being read as `(org as any).settings
    // .simulationMode`, which meant the safety flag was outside the contract
    // its own column publishes: any typed write of `settings` composed from
    // this type could not carry it, and a write that REPLACED rather than
    // merged would have silently disarmed it with nothing to report. Every
    // writer merges today — `tests/unit/orgSettingsMerge.test.ts` derives that
    // from source and keeps it true.
    simulationMode?: boolean;
  }>(),
  // Free trial tracking
  trialStartedAt: timestamp("trial_started_at"), // When trial began
  trialEndsAt: timestamp("trial_ends_at"), // When trial expires (7 days from start)
  trialUsed: boolean("trial_used").default(false), // True once trial has been used (prevents repeat trials)
  // Trial tokens for sampling premium actions (free tier users)
  trialTokens: integer("trial_tokens").default(5), // Free tokens to try premium actions
  trialTokensGrantedAt: timestamp("trial_tokens_granted_at").defaultNow(), // When tokens were last granted
  // Pax proactive notification settings
  proactiveNotificationLevel: varchar("proactive_notification_level", { length: 50 }).default("balanced"), // minimal, balanced, proactive, off
  // Pax autonomy level — controls how much Pax can act without per-action approval
  paxAutonomyLevel: varchar("pax_autonomy_level", { length: 20 }).default("assisted"), // assisted, supervised, autonomous
  // UTM attribution for customer acquisition tracking
  utmSource: text("utm_source"),     // e.g. 'meta', 'google', 'organic'
  utmMedium: text("utm_medium"),     // e.g. 'cpc', 'social', 'email'
  utmCampaign: text("utm_campaign"), // e.g. 'land-investors-q1'
  utmContent: text("utm_content"),   // e.g. 'carousel-ad-1'
  // Timezone for scheduling and date display (IANA timezone name)
  timezone: text("timezone").default("America/New_York"),
  // Referral program credit balance (in cents)
  referralCredits: integer("referral_credits").notNull().default(0),
  // Churn risk scoring (0-100, 100 = highest risk)
  churnRiskScore: integer("churn_risk_score").notNull().default(0),
  churnRiskUpdatedAt: timestamp("churn_risk_updated_at"),
  churnRescueSentAt: timestamp("churn_rescue_sent_at"),
  // Real last-activity timestamp (stamped by the getOrCreateOrg heartbeat,
  // throttled ~15 min). Powers churn/health signals; null = no activity yet.
  lastActiveAt: timestamp("last_active_at"),
  // Milestone tracking for self-promotion nudges
  milestonesReached: jsonb("milestones_reached").$type<string[]>().default([]),
  referralNudgeSentAt: timestamp("referral_nudge_sent_at"),
  // ─── Tax / 1099 reporting identity ─────────────────────────────────────────
  // Captured during onboarding and required to issue valid 1099-INTs.
  // EIN is stored as ciphertext (AES-256-GCM) using the helpers in
  // server/services/configManager.ts (encryptValue / decryptValue).
  // All fields nullable because legacy orgs pre-date them; downstream tax
  // code MUST throw if missing rather than fall back to a placeholder.
  ein: text("ein"), // ciphertext of the payer EIN/SSN/ITIN
  taxIdType: text("tax_id_type"), // 'EIN' | 'SSN' | 'ITIN'
  taxAddress: jsonb("tax_address").$type<{
    line1?: string;
    line2?: string;
    city?: string;
    state?: string;
    zip?: string;
    country?: string;
    phone?: string;
  }>(),
  legalEntityName: text("legal_entity_name"), // exact IRS filing name
  // Coriander §1: Recovery-console autopay freeze. When true, Stripe
  // collection is paused via collection_method = "send_invoice". Set by
  // founder during dispute / death / fraud workflows; cleared explicitly.
  autopayFrozen: boolean("autopay_frozen").notNull().default(false),
  autopayFrozenAt: timestamp("autopay_frozen_at"),
  autopayFrozenReason: text("autopay_frozen_reason"),
  autopayFrozenUntil: timestamp("autopay_frozen_until"),
  // ─── Tahoe E11: customer-elected pause (cancellation 4th rung) ──────
  // When `subscriptionPaused = true`, mutation routes 402 with a
  // "subscription paused" payload; reads continue to work. Stripe pauses
  // collection via subscription.pause_collection. Auto-resumes when
  // `subscriptionPauseEndsAt` passes (the resumeExpiredPauses job clears
  // the flag and Stripe also fires customer.subscription.resumed).
  // `subscriptionPausedAt` is the moment the user elected pause;
  // `subscriptionPauseReason` is a coarse category (matches the
  // cancellation-survey reasons so the founder surface can co-aggregate
  // pause vs cancel signal).
  subscriptionPaused: boolean("subscription_paused").notNull().default(false),
  subscriptionPausedAt: timestamp("subscription_paused_at"),
  subscriptionPauseEndsAt: timestamp("subscription_pause_ends_at"),
  subscriptionPauseReason: text("subscription_pause_reason"),
  // ─── AI cost ceiling (Phase 3 Week 9) ───────────────────────────────────────
  // Per-org daily USD cap on AI spend. Enforced in routeAITask: if
  // sum(ai_usage_daily.totalUsd WHERE org=this AND date=today) >= this cap,
  // the call is rejected with 429 (AIQuotaExceeded). Default $50/day.
  // Set to 0 to disable enforcement (treats org as unlimited — used for
  // founder/internal orgs). Founder orgs already bypass via req.isFounder.
  orgAiQuotaDailyUsd: numeric("org_ai_quota_daily_usd", { precision: 10, scale: 2 }).notNull().default("50.00"),
  // ─── Pillar S — Founder daily attention budget ─────────────────────
  // Max number of action-required items the /founder/now inbox will
  // surface per day. Agents may write more to decisions_inbox_items;
  // overflow gets `deferred_until: tomorrow` rather than appearing.
  // 5 is a deliberate cap — see docs/archive/exhaustive-completion/pillar-s-
  // one-inbox.md for the rationale.
  founderDailyAttentionCap: integer("founder_daily_attention_cap").notNull().default(5),
  // ─── Underwriting defaults (Hank fix) ──────────────────────────────
  // Per-org owner-finance defaults used by blindOfferCalculator. The
  // hardcode was 9% APR / 84 months — Texas land standard is ~9.9%
  // APR / 120 months / 20% down / no balloon. Persisted as a single
  // jsonb so we can extend with cash-flip multipliers, hybrid splits,
  // etc. without another migration.
  underwritingDefaults: jsonb("underwriting_defaults").$type<{
    ownerFinance?: {
      apr: number; // annual percentage rate, e.g. 9.9
      termMonths: number; // amortization term, e.g. 120
      downPaymentPct: number; // 0-100, e.g. 20
      balloon: boolean; // true if a balloon payment is required at term end
    };
    // Fix-and-flip rules consumed by the MAO chain (/api/flip-analyzer/*,
    // server/services/flipUnderwriting.ts). The "cash-flip multipliers"
    // extension the column was designed for — no migration needed, this is
    // the same jsonb. Every field is optional: an absent field falls back to
    // PLATFORM_FLIP_DEFAULTS and is BADGED as a platform default in the UI,
    // never presented as the operator's own rule.
    flip?: {
      maoRulePct?: number; // percent of ARV the rule allows, e.g. 70
      rehabContingencyPct?: number; // added on top of the rehab estimate, e.g. 10
      sellingCostPct?: number; // resale cost as a percent of ARV, e.g. 7
      purchaseClosingPct?: number; // acquisition closing as a percent of price, e.g. 2
      holdMonths?: number; // months held from close to resale
      monthlyHoldingCostCents?: number; // carry per month, integer cents
      targetProfitPct?: number; // minimum acceptable net profit, percent of ARV
    };
    // Land buy/hold/resell rules, consumed by the blind-offer exit model
    // (server/services/landDealDefaults.ts). Same jsonb, no migration — and
    // the same optional-with-provenance discipline as `flip` above: an absent
    // field falls back to PLATFORM_LAND_DEFAULTS and is badged as ours, never
    // shown as the operator's own rule.
    //
    // The wedge vertical had NO section here until 2026-08-19, which is why
    // blindOfferCalculator hardcoded its costs — the numbers reached the
    // customer as netProfit and roi with nothing marking them as defaults.
    landDeal?: {
      closingAtBuyPct?: number; // acquisition closing as a percent of price, e.g. 2
      dispositionCostPct?: number; // resale closing + marketing, percent of sale, e.g. 8
      holdMonths?: number; // whole months held from close to resale
      monthlyHoldingPctOfSale?: number; // carry per month as a percent of sale price
    };
  }>(),
  // ─── Per-tenant constitutional / alignment preferences (Tahoe L11) ────
  // Schema-bind landed ahead of any consumer. Quinn's horizon vision is
  // per-tenant customization of the 12 customer immutables + per-tenant
  // tuning of how strictly downstream LLM screeners interpret them (e.g.
  // a banking-vertical tenant may require stricter #12 fiduciary-advice
  // screening; a marketing-only tenant may opt into a stricter #11 get-
  // rich-quick filter for outbound copy). The shape is intentionally a
  // generic jsonb-bag today; downstream schema migrations can lift
  // sub-fields into typed columns once the UI consumer ships. Defaults
  // to '{}' so legacy orgs behave identically (canonical immutables apply
  // unchanged). NOT NULL with DEFAULT '{}' so consumers can read without
  // null-checking.
  alignmentPreferences: jsonb("alignment_preferences").$type<{
    // Future shape (none of these are read today — schema-bind only):
    //   immutableOverrides?: Record<number, {
    //     stricterThanDefault?: boolean;
    //     additionalContext?: string;       // appended to screener prompt
    //   }>;
    //   verticalProfile?: "land" | "notes" | "banking" | "marketing";
    //   alignmentReviewerNotes?: string;
    [key: string]: unknown;
  }>().notNull().default({}),
  // ─── Tahoe E5: per-tenant theming (TenantThemeProvider) ──────────────
  // Distinct from white_label_configs (reseller/Kim tenants on custom
  // domains). These are first-party org-level brand affordances every org
  // can set from Settings → Appearance: an accent color, a logo, and a
  // density preference. Applied client-side by TenantThemeProvider as CSS
  // custom properties / data-attributes — NEVER hardcoded colors. All
  // nullable so legacy orgs render the default theme unchanged. The accent
  // is stored as a hex string ("#2563eb"); the provider converts it to the
  // HSL component form the design tokens expect.
  brandAccentColor: text("brand_accent_color"), // hex, e.g. "#2563eb"; null = theme default
  brandLogoUrl: text("brand_logo_url"),         // absolute URL; shown in nav/topbar when set
  brandDensity: text("brand_density"),          // 'compact' | 'comfortable' | 'adaptive' | null (default)
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Team members within an organization
//
// Phase 3 Week 14 (Liana §1+§3, Reyna §1): standardized to 4 pragmatic roles
// + a 5th `va` role for outsourced VAs / contractors:
//
//   owner   — full control of org (billing, ownership transfer, delete)
//   admin   — full operational control except billing & ownership transfer
//   member  — full operational, cannot change member roles
//   viewer  — read-only across the CRM
//   va      — like member, but optionally limited to assigned-leads-only when
//             `viewOnlyAssignedLeads = true`. Used for outsourced VAs who
//             should never see the full lead pool.
//
// Legacy role values (`acquisitions`, `marketing`, `finance`) were retired in
// migration 0050. Existing rows are remapped to `member`. The `roleGuard`
// middleware now treats those legacy strings as `member` for backward compat
// at the read path (in case any unmigrated row sneaks in via replica lag).
export const teamMembers = pgTable("team_members", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  userId: text("user_id").notNull(), // Replit user ID
  email: text("email"),
  displayName: text("display_name"),
  role: text("role").notNull().default("member"), // owner | admin | member | viewer | va
  permissions: jsonb("permissions").$type<string[]>(),
  // Per-user assigned-leads-only flag. Honored when role === 'va' (or when
  // an admin opts a member into restricted visibility). When true, every
  // leads query MUST add `WHERE assignedTo = teamMember.id`.
  viewOnlyAssignedLeads: boolean("view_only_assigned_leads").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  invitedAt: timestamp("invited_at").defaultNow(),
  joinedAt: timestamp("joined_at"),
});

// ─── Org Co-Owners (Blanco §1) ────────────────────────────────────────────────
// A separate relation from team_members because co-ownership is a billing /
// ownership concept distinct from operational role. Co-owners get:
//   - dual billing-card visibility (each can update payment method)
//   - dual tax-contact visibility (each visible on the 1099 issuer side)
//   - LLC EIN on Stripe customer (deferred to a billing follow-up)
//
// A co-owner row does NOT grant operational permissions on its own — the
// linked user must also have an `owner` role in `team_members` for normal
// route access. The presence of a row in `org_co_owners` is what unlocks
// the dual-billing / dual-tax-contact UX.
export const orgCoOwners = pgTable("org_co_owners", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  userId: text("user_id").notNull(),
  addedAt: timestamp("added_at").defaultNow().notNull(),
  addedBy: text("added_by").notNull(), // userId of the owner who added them
}, (table) => ({
  byOrgUser: uniqueIndex("idx_org_co_owners_org_user").on(table.organizationId, table.userId),
}));

export type OrgCoOwner = typeof orgCoOwners.$inferSelect;
export type InsertOrgCoOwner = typeof orgCoOwners.$inferInsert;

// Pending seat invitations — email-addressed invites that attach the user
// to this org on first sign-in after they click the invite link.
export const organizationInvitations = pgTable("organization_invitations", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  email: text("email").notNull(),
  role: text("role").notNull().default("member"), // owner, admin, member, viewer, acquisitions, marketing, finance
  /**
   * @deprecated Plaintext invite token. Retained ONLY for tolerant validation
   * of legacy rows created before invite-token hashing landed (Pelle G/H/I).
   * New rows leave this NULL and store SHA-256 in inviteTokenHash. The accept
   * path lazy-migrates legacy rows on first hit (see routes-organization.ts).
   * A follow-up migration will drop this column once telemetry confirms zero
   * remaining plaintext rows.
   */
  token: text("token").unique(),
  /** SHA-256 hex of the plaintext invite token. Plaintext lives in the email/URL only. */
  inviteTokenHash: text("invite_token_hash"),
  /** Last 4 chars of the plaintext token, safe to display in audit logs / support UI. */
  inviteTokenLast4: text("invite_token_last4"),
  invitedByUserId: text("invited_by_user_id"),
  status: text("status").notNull().default("pending"), // pending, accepted, revoked, expired
  createdAt: timestamp("created_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  acceptedAt: timestamp("accepted_at"),
  acceptedByUserId: text("accepted_by_user_id"),
});

// ============================================
// EMAIL EVENTS + SUPPRESSIONS (SendGrid event webhook)
// ============================================
// Hessam §2.3: every SendGrid event (delivered/open/click/bounce/dropped/
// spamreport/unsubscribe/deferred) lands in email_events. Hard-bounce,
// spamreport, and unsubscribe events also seed email_suppressions, which
// every outbound send path consults before calling SES.
export const emailEvents = pgTable(
  "email_events",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    email: text("email").notNull(),
    event: text("event").notNull(), // delivered | open | click | bounce | dropped | spamreport | unsubscribe | deferred | processed
    sgEventId: text("sg_event_id").unique(), // SendGrid's per-event ID — used for idempotency
    sgMessageId: text("sg_message_id"),
    timestamp: timestamp("timestamp", { withTimezone: true }),
    reason: text("reason"),
    status: text("status"),
    response: text("response"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    byEmailCreated: index("idx_email_events_email_created").on(table.email, table.createdAt),
    bySgEventId: index("idx_email_events_sg_event_id").on(table.sgEventId),
    // P1-15 (Phase 3 Week 7-8) — funnel/aggregation queries filter by event
    // type and order by created_at DESC. Migration: 0045_index_audit.sql.
    byEventCreated: index("email_events_event_created_idx").on(table.event, table.createdAt),
  })
);

export const emailSuppressions = pgTable(
  "email_suppressions",
  {
    email: text("email").primaryKey(),
    reason: text("reason").notNull(),
    suppressedAt: timestamp("suppressed_at", { withTimezone: true }).defaultNow().notNull(),
    source: text("source"), // "bounce" | "spam" | "unsubscribe" | "manual"
    // Eleonora deliverability — Phase 1 §10 / Week 7-8.
    bounceCategory: text("bounce_category"), // "hard" | "soft" | "complaint" | "unsubscribe" | "manual"
    organizationId: integer("organization_id"),
    softBounceCount: integer("soft_bounce_count").notNull().default(0),
    lastSoftBounceAt: timestamp("last_soft_bounce_at", { withTimezone: true }),
  },
  (table) => ({
    bySource: index("idx_email_suppressions_source").on(table.source),
    byOrg: index("idx_email_suppressions_org").on(table.organizationId),
    byCategory: index("idx_email_suppressions_category").on(table.bounceCategory),
  })
);

export type EmailEvent = typeof emailEvents.$inferSelect;
export type InsertEmailEvent = typeof emailEvents.$inferInsert;
export type EmailSuppression = typeof emailSuppressions.$inferSelect;
export type InsertEmailSuppression = typeof emailSuppressions.$inferInsert;

// ============================================
// OUTBOUND EMAIL LOG — Tahoe E10 lifecycle email registry
// ============================================
// Every send routed through server/services/emailRegistry.ts writes one row
// here BEFORE delegating to the SES transport. The registry is the single
// typed entrypoint for all transactional + lifecycle/marketing mail: each
// send is named (`kind`), categorized (transactional | lifecycle), suppression-
// checked (for lifecycle sends), and logged. This table is the audit trail —
// it answers "did we send the trial-ending email to org N, when, did it land".
export const outboundEmailLog = pgTable(
  "outbound_email_log",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    organizationId: integer("organization_id"), // nullable: founder-internal mail (briefing) has no org
    kind: text("kind").notNull(), // registry kind id, e.g. "welcome" | "trial_ending" | "churn_rescue"
    category: text("category").notNull(), // "transactional" | "lifecycle"
    recipient: text("recipient").notNull(),
    subject: text("subject").notNull(),
    status: text("status").notNull(), // "sent" | "failed" | "suppressed" | "skipped"
    messageId: text("message_id"),
    error: text("error"),
    errorType: text("error_type"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    // Leading-org composite per scripts/check-org-leading-index.mjs — the
    // founder audit surface filters by org + kind, ordered by recency.
    byOrgKindCreated: index("idx_outbound_email_log_org_kind_created").on(
      table.organizationId,
      table.kind,
      table.createdAt,
    ),
    byRecipientCreated: index("idx_outbound_email_log_recipient_created").on(
      table.recipient,
      table.createdAt,
    ),
  })
);

export type OutboundEmailLogRow = typeof outboundEmailLog.$inferSelect;
export type InsertOutboundEmailLog = typeof outboundEmailLog.$inferInsert;

// ============================================
// MARKETING TOUCH — acquisition event substrate (Soren, 2026-06-06)
// ============================================
// Per docs/internal/marketing-os/03-analytics.md §4. The canonical, owned
// record of every pre-signup marketing/lifecycle touchpoint. Keyed by a
// 1st-party `anonymous_id` cookie so the pre-signup chain survives the auth
// handshake (the UTM-loss-at-auth bug). On signup the server JOINs
// anonymous_id → user_id / organization_id so attribution is preserved.
//
// Privacy locks (spec §4 notes + feedback_rate_limit_ip_keying):
//   - NO raw IP stored. Country-level geo only (`ip_country`).
//   - User-agent HASHED, not raw (`user_agent_hash`), for cohort grouping.
//
// organization_id is nullable (most touches are pre-signup, org-less). It is
// populated post-signup via the anonymous_id JOIN. The leading-org composite
// index below satisfies check-org-leading-index.mjs AND accelerates the
// post-signup "all touches for this org" attribution rollup.
export const marketingTouch = pgTable(
  "marketing_touch",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    anonymousId: text("anonymous_id").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull(),
    // 'landing' | 'landing:cta' | 'learn:land-flipping:texas' | 'signup:started' | etc.
    surface: text("surface").notNull(),
    // Stable event verb: 'page_view' | 'cta_click' | 'funnel_step' | 'email_open' | 'email_click'
    eventType: text("event_type").notNull().default("page_view"),
    sourceArtifactId: text("source_artifact_id"), // marketing_artifact.id when the surface is an artifact
    utmSource: text("utm_source"),
    utmMedium: text("utm_medium"),
    utmCampaign: text("utm_campaign"),
    utmTerm: text("utm_term"),
    utmContent: text("utm_content"),
    referrer: text("referrer"),
    landingPath: text("landing_path").notNull(),
    deviceType: text("device_type"), // 'mobile' | 'desktop' | 'tablet'
    userAgentHash: text("user_agent_hash"), // hashed UA, never raw
    ipCountry: text("ip_country"), // country only, never raw IP
    payload: jsonb("payload"), // event-specific extras (step, durationMs, ctaId, …)
    userId: text("user_id"), // nullable; populated on signup-join (users.id is varchar)
    organizationId: integer("organization_id"), // nullable; populated on signup-join
  },
  (table) => ({
    // Hot path: pre-signup chain reconstruction for a single anon visitor.
    byAnonOccurred: index("marketing_touch_anon_occurred_idx").on(
      table.anonymousId,
      table.occurredAt,
    ),
    // Surface-level rollups (touches per artifact / surface over time).
    bySurfaceOccurred: index("marketing_touch_surface_occurred_idx").on(
      table.surface,
      table.occurredAt,
    ),
    // Leading-org composite — post-signup attribution rollup per tenant.
    // Satisfies check-org-leading-index.mjs (org column present → must lead).
    byOrgOccurred: index("marketing_touch_org_occurred_idx").on(
      table.organizationId,
      table.occurredAt,
    ),
  }),
);

export type MarketingTouch = typeof marketingTouch.$inferSelect;
export type InsertMarketingTouch = typeof marketingTouch.$inferInsert;

// ============================================
// ELEONORA DELIVERABILITY — Phase 1 §10 / Week 7-8
// ============================================
// Per-org email identity (DKIM/SPF/DMARC). The keypair is generated server-
// side; the private key is encrypted at rest via fieldEncryption.encrypt().
// The founder publishes the DNS records returned by /provision; once the
// records propagate, /verify confirms them and (when SENDGRID_API_KEY is
// set) registers the domain with SendGrid's domain-authentication API.
export const orgEmailIdentities = pgTable(
  "org_email_identities",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").notNull(),
    fromAddress: text("from_address").notNull(),
    dkimDomain: text("dkim_domain").notNull(),
    dkimSelector: text("dkim_selector").notNull().default("acreos1"),
    dkimPublicKey: text("dkim_public_key").notNull(),
    dkimPrivateKeyEncrypted: text("dkim_private_key_encrypted").notNull(),
    spfRecord: text("spf_record").notNull(),
    dmarcRecord: text("dmarc_record").notNull(),
    status: text("status").notNull().default("provisioning"), // provisioning | verified | failed
    sendgridDomainId: text("sendgrid_domain_id"),
    verificationError: text("verification_error"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    byOrgDomain: uniqueIndex("idx_org_email_identities_org_domain").on(
      table.organizationId,
      table.dkimDomain,
    ),
    byStatus: index("idx_org_email_identities_status").on(table.status),
  })
);

export type OrgEmailIdentity = typeof orgEmailIdentities.$inferSelect;
export type InsertOrgEmailIdentity = typeof orgEmailIdentities.$inferInsert;

// Per-org IP-warmup state. Day-based ramp; the dailySendLimit is recomputed
// from daysSinceFirstSend whenever currentDayResetAt rolls over.
export const emailWarmupState = pgTable("email_warmup_state", {
  organizationId: integer("organization_id").primaryKey(),
  firstSendAt: timestamp("first_send_at", { withTimezone: true }),
  daysSinceFirstSend: integer("days_since_first_send").notNull().default(0),
  dailySendLimit: integer("daily_send_limit").notNull().default(50),
  currentDayUsed: integer("current_day_used").notNull().default(0),
  currentDayResetAt: timestamp("current_day_reset_at", { withTimezone: true }).defaultNow().notNull(),
  warmupComplete: boolean("warmup_complete").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type EmailWarmupState = typeof emailWarmupState.$inferSelect;
export type InsertEmailWarmupState = typeof emailWarmupState.$inferInsert;

// Token-based one-click List-Unsubscribe (RFC 8058). One row per recipient
// per org — minted at first send and reused.
export const unsubscribeTokens = pgTable(
  "unsubscribe_tokens",
  {
    token: text("token").primaryKey(),
    email: text("email").notNull(),
    organizationId: integer("organization_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
  },
  (table) => ({
    byEmail: index("idx_unsubscribe_tokens_email").on(table.email),
  })
);

export type UnsubscribeToken = typeof unsubscribeTokens.$inferSelect;
export type InsertUnsubscribeToken = typeof unsubscribeTokens.$inferInsert;

// Per-org rolling deliverability snapshot. Computed nightly + on demand.
// healthStatus: "healthy" (score≥90) | "at_risk" (70-89) | "critical" (<70).
export const emailReputationSnapshot = pgTable(
  "email_reputation_snapshot",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").notNull(),
    windowDays: integer("window_days").notNull().default(30),
    sentCount: integer("sent_count").notNull().default(0),
    bounceCount: integer("bounce_count").notNull().default(0),
    complaintCount: integer("complaint_count").notNull().default(0),
    bounceRate: numeric("bounce_rate", { precision: 5, scale: 4 }).notNull().default("0"),
    complaintRate: numeric("complaint_rate", { precision: 5, scale: 4 }).notNull().default("0"),
    deliverabilityScore: integer("deliverability_score").notNull().default(100),
    healthStatus: text("health_status").notNull().default("healthy"),
    computedAt: timestamp("computed_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    byOrgComputed: index("idx_email_reputation_org_computed").on(table.organizationId, table.computedAt),
  })
);

export type EmailReputationSnapshot = typeof emailReputationSnapshot.$inferSelect;
export type InsertEmailReputationSnapshot = typeof emailReputationSnapshot.$inferInsert;

// ============================================
// VERIFIED SENDERS (Email & SMS)
// ============================================

// Verified email domains for SendGrid
export const verifiedEmailDomains = pgTable("verified_email_domains", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  domain: text("domain").notNull(), // e.g., "mycompany.com"
  sendgridDomainId: text("sendgrid_domain_id"), // SendGrid's domain ID
  status: text("status").notNull().default("pending"), // pending, verified, failed
  dnsRecords: jsonb("dns_records").$type<{
    type: string; // CNAME, TXT, MX
    host: string;
    data: string;
    valid: boolean;
  }[]>(),
  fromEmail: text("from_email"), // Default from email, e.g., "noreply@mycompany.com"
  fromName: text("from_name"), // Default from name, e.g., "My Company"
  isDefault: boolean("is_default").default(false),
  verifiedAt: timestamp("verified_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Provisioned phone numbers for Twilio SMS
export const provisionedPhoneNumbers = pgTable("provisioned_phone_numbers", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  phoneNumber: text("phone_number").notNull(), // E.164 format, e.g., "+15551234567"
  twilioSid: text("twilio_sid"), // Twilio's phone number SID
  friendlyName: text("friendly_name"), // Display name for the number
  capabilities: jsonb("capabilities").$type<{
    sms: boolean;
    mms: boolean;
    voice: boolean;
  }>(),
  status: text("status").notNull().default("active"), // active, released, pending
  isDefault: boolean("is_default").default(false),
  monthlyRentalCost: numeric("monthly_rental_cost"), // Cost in cents
  purchasedAt: timestamp("purchased_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertVerifiedEmailDomainSchema = createInsertSchema(verifiedEmailDomains).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertVerifiedEmailDomain = z.infer<typeof insertVerifiedEmailDomainSchema>;
export type VerifiedEmailDomain = typeof verifiedEmailDomains.$inferSelect;

export const insertProvisionedPhoneNumberSchema = createInsertSchema(provisionedPhoneNumbers).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertProvisionedPhoneNumber = z.infer<typeof insertProvisionedPhoneNumberSchema>;
export type ProvisionedPhoneNumber = typeof provisionedPhoneNumbers.$inferSelect;

// Organization integrations for storing per-org API credentials
export const organizationIntegrations = pgTable("organization_integrations", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  provider: text("provider").notNull(), // sendgrid, twilio, lob, stripe_connect
  isEnabled: boolean("is_enabled").default(true),
  credentials: jsonb("credentials").$type<{
    encrypted?: string; // Encrypted JSON blob containing apiKey and other secrets
    apiKey?: string;
    accountSid?: string; // Twilio
    authToken?: string; // Twilio
    fromEmail?: string; // SendGrid default sender
    fromName?: string; // SendGrid default sender name
    fromPhoneNumber?: string; // Twilio default sender
    // Stripe Connect fields
    stripeConnectAccountId?: string; // Connected account ID (acct_xxx)
    stripeConnectAccessToken?: string; // OAuth access token (if using OAuth flow)
    stripeConnectRefreshToken?: string; // OAuth refresh token
  }>(),
  settings: jsonb("settings").$type<{
    testMode?: boolean;
    webhookSecret?: string;
    defaultTemplateId?: string;
    // Stripe Connect settings
    stripeConnectCapabilities?: {
      cardPayments?: boolean;
      transfers?: boolean;
      achPayments?: boolean;
    };
    stripeConnectOnboardingComplete?: boolean;
    stripeConnectPayoutsEnabled?: boolean;
    stripeConnectChargesEnabled?: boolean;
    stripeConnectDefaultCurrency?: string;
    stripeApplicationFeePercent?: number; // Platform fee percentage (e.g., 2.5)
  }>(),
  lastValidatedAt: timestamp("last_validated_at"),
  validationError: text("validation_error"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertOrganizationIntegrationSchema = createInsertSchema(organizationIntegrations).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertOrganizationIntegration = z.infer<typeof insertOrganizationIntegrationSchema>;
export type OrganizationIntegration = typeof organizationIntegrations.$inferSelect;

// White-label tenant configurations — persisted so configs survive server restarts
export const whiteLabelConfigs = pgTable("white_label_configs", {
  id: serial("id").primaryKey(),
  tenantId: text("tenant_id").notNull().unique(), // UUID assigned on create
  organizationId: integer("organization_id").references(() => organizations.id).notNull().unique(),
  parentOrganizationId: integer("parent_organization_id").references(() => organizations.id).notNull(),
  brandName: text("brand_name").notNull(),
  logoUrl: text("logo_url"),
  faviconUrl: text("favicon_url"),
  primaryColor: text("primary_color").notNull().default("#2563eb"),
  accentColor: text("accent_color").notNull().default("#16a34a"),
  customDomain: text("custom_domain").unique(),
  supportEmail: text("support_email").notNull(),
  supportPhone: text("support_phone"),
  footerText: text("footer_text").notNull().default("Powered by AcreOS"),
  features: jsonb("features").$type<{
    marketplace: boolean; academy: boolean; dealHunter: boolean; voiceAI: boolean;
    visionAI: boolean; capitalMarkets: boolean; negotiationCopilot: boolean;
    portfolioOptimizer: boolean; complianceAI: boolean; taxResearcher: boolean;
  }>().notNull(),
  revenueShare: jsonb("revenue_share").$type<{ platformFeePercent: number; resellerFeePercent: number }>().notNull(),
  limits: jsonb("limits").$type<{ maxUsers: number; maxLeads: number; maxProperties: number; maxCampaigns: number }>().notNull(),
  plan: text("plan").notNull().default("starter"), // starter | professional | enterprise
  billingEmail: text("billing_email").notNull(),
  status: text("status").notNull().default("active"), // active | suspended | cancelled
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Borrower payment profiles - maps borrowers to Stripe Customer IDs for connected accounts
export const borrowerPaymentProfiles = pgTable("borrower_payment_profiles", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  leadId: integer("lead_id").references(() => leads.id), // Borrower/buyer lead
  noteId: integer("note_id"), // Associated note (if for note payments)
  
  // Stripe Customer on the connected account
  stripeCustomerId: text("stripe_customer_id").notNull(), // cus_xxx on connected account
  stripeConnectAccountId: text("stripe_connect_account_id").notNull(), // acct_xxx
  
  // Payment method storage
  defaultPaymentMethodId: text("default_payment_method_id"), // pm_xxx
  paymentMethodType: text("payment_method_type"), // card, us_bank_account
  paymentMethodLast4: text("payment_method_last4"),
  paymentMethodBrand: text("payment_method_brand"), // visa, mastercard, etc.
  
  // Autopay settings
  autopayEnabled: boolean("autopay_enabled").default(false),
  autopayDay: integer("autopay_day"), // Day of month for autopay (1-28)
  
  // Contact info for payment notifications
  email: text("email"),
  phone: text("phone"),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertBorrowerPaymentProfileSchema = createInsertSchema(borrowerPaymentProfiles).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertBorrowerPaymentProfile = z.infer<typeof insertBorrowerPaymentProfileSchema>;
export type BorrowerPaymentProfile = typeof borrowerPaymentProfiles.$inferSelect;

// ============================================
// CRM: LEADS & CONTACTS
// ============================================

// Leads (sellers and buyers)
export const leads = pgTable("leads", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  type: text("type").notNull().default("seller"), // seller, buyer
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: text("email"),
  phone: text("phone"),
  // GENERATED ALWAYS AS (regexp_replace(coalesce(phone,''),'[^0-9]','','g')) STORED
  // (see migration 0051). Never written from JS — Drizzle treats it
  // as a read-only string column.
  phoneNormalized: text("phone_normalized"),
  address: text("address"),
  city: text("city"),
  state: text("state"),
  zip: text("zip"),
  status: text("status").notNull().default("new"),
  // Seller statuses: new, mailed, responded, negotiating, accepted, closed, dead
  // Buyer statuses: new, interested, qualified, under_contract, closed, dead
  source: text("source"), // tax_list, referral, website, facebook, craigslist, etc.
  campaignId: integer("campaign_id"),
  notes: text("notes"),
  tags: jsonb("tags").$type<string[]>(),
  assignedTo: integer("assigned_to"), // team member ID
  lastContactedAt: timestamp("last_contacted_at"),
  // Assessor's Parcel Number — captured by the CSV importer for tax-
  // delinquent / county lists where APN is the canonical de-dup key.
  // Nullable because the manual-add path doesn't require it; APN
  // uniqueness is enforced PER ORG inside the importer (not via a DB
  // unique index — multiple orgs may legitimately import the same
  // parcel as a lead).
  apn: text("apn"),

  // Parcel / property enrichment fields (populated from parcel-of-record data —
  // county GIS or Regrid via the provider registry, or tax-delinquent imports).
  // estimatedValue is a derived ESTIMATE, never a quoted comp.
  county: text("county"),
  propertyAddress: text("property_address"),
  taxDelinquent: boolean("tax_delinquent"),
  estimatedValue: numeric("estimated_value"),
  acreage: numeric("acreage"),

  // Campaign attribution tracking
  sourceTrackingCode: text("source_tracking_code"), // Links to campaign.trackingCode
  sourceCampaignId: integer("source_campaign_id"), // Links to the campaign that generated this lead
  sourceMailPieceId: integer("source_mail_piece_id"), // FK to mailingOrderPieces — direct mail attribution
  
  // Lead Scoring & Nurturing
  score: integer("score"), // 0-100 lead score
  scoreFactors: jsonb("score_factors").$type<{
    responseRecency?: number;
    emailEngagement?: number;
    sourceBonus?: number;
    statusBonus?: number;
    recencyPenalty?: number;
    total?: number;
  }>(),
  lastScoreAt: timestamp("last_score_at"),
  emailOpens: integer("email_opens").default(0),
  emailClicks: integer("email_clicks").default(0),
  responses: integer("responses").default(0),
  nurturingStage: text("nurturing_stage").default("new"), // hot, warm, cold, dead, new
  nextFollowUpAt: timestamp("next_follow_up_at"),
  lastAIMessageAt: timestamp("last_ai_message_at"),
  
  // TCPA Compliance (20.2)
  tcpaConsent: boolean("tcpa_consent").default(false),
  consentDate: timestamp("consent_date"),
  consentSource: text("consent_source"), // website, phone, written, imported
  optOutDate: timestamp("opt_out_date"),
  optOutReason: text("opt_out_reason"),
  doNotContact: boolean("do_not_contact").default(false),
  // Roadmap W1.5 (2026-07): IANA timezone for TCPA quiet-hours (8am–9pm
  // RECIPIENT-local). Area-code inference is unreliable post-number-porting;
  // this column is the honest source — populated from the mailing address
  // (enrichment follow-up) or set manually. Null → area-code fallback.
  timezone: text("timezone"),
  
  // Soft delete support for safe bulk operations with recovery
  deletedAt: timestamp("deleted_at"), // null = active, timestamp = soft deleted
  deletedBy: text("deleted_by"), // user ID who performed the deletion

  // ─── Tax / 1099 recipient identity ─────────────────────────────────────────
  // When a lead is also a borrower on a note, their TIN is required to issue
  // a 1099-INT (interest > $600). Stored encrypted (AES-256-GCM) via
  // server/services/configManager.ts encryptValue / decryptValue.
  taxId: text("tax_id"), // ciphertext of the recipient TIN (SSN/EIN/ITIN)
  taxIdType: text("tax_id_type"), // 'SSN' | 'EIN' | 'ITIN'

  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("leads_org_idx").on(table.organizationId),
  index("leads_status_idx").on(table.status),
  index("leads_created_at_idx").on(table.createdAt),
  index("leads_email_idx").on(table.email),
  index("leads_source_campaign_idx").on(table.sourceCampaignId),
  index("leads_org_updated_idx").on(table.organizationId, table.updatedAt),
  index("leads_score_idx").on(table.score),
  // P1-15 (Phase 3 Week 7-8) — composite indexes matching real call-sites.
  // Migration: 0045_index_audit.sql.
  index("leads_org_status_created_idx").on(table.organizationId, table.status, table.createdAt),
  index("leads_org_assigned_status_idx").on(table.organizationId, table.assignedTo, table.status),
]);

// Lead activity/interactions log
export const leadActivities = pgTable("lead_activities", {
  id: serial("id").primaryKey(),
  leadId: integer("lead_id").references(() => leads.id, { onDelete: "cascade" }).notNull(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  type: text("type").notNull(), // email_sent, sms_sent, call_made, note_added, status_changed, offer_sent
  description: text("description"),
  metadata: jsonb("metadata"),
  performedBy: integer("performed_by"), // team member ID or null for automated
  createdAt: timestamp("created_at").defaultNow(),
});

// ============================================
// LEAD SCORING (Betty-style)
// ============================================

// Scoring profiles - configurable weights per organization
export const leadScoringProfiles = pgTable("lead_scoring_profiles", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  name: text("name").notNull().default("Default"),
  isActive: boolean("is_active").default(true),
  
  // Property-based factor weights (sum to ~40%)
  ownershipDurationWeight: integer("ownership_duration_weight").default(15),
  taxDelinquencyWeight: integer("tax_delinquency_weight").default(20),
  absenteeOwnerWeight: integer("absentee_owner_weight").default(15),
  propertySizeWeight: integer("property_size_weight").default(10),
  assessedValueWeight: integer("assessed_value_weight").default(10),
  
  // Owner-based factor weights (sum to ~30%)
  corporateOwnerWeight: integer("corporate_owner_weight").default(10),
  multiplePropertiesWeight: integer("multiple_properties_weight").default(10),
  inheritanceIndicatorWeight: integer("inheritance_indicator_weight").default(15),
  outOfStateWeight: integer("out_of_state_weight").default(15),
  
  // Market/Location factor weights (sum to ~15%)
  floodZoneWeight: integer("flood_zone_weight").default(10),
  marketActivityWeight: integer("market_activity_weight").default(15),
  developmentPotentialWeight: integer("development_potential_weight").default(10),
  
  // Engagement factor weights (sum to ~15%)
  responseRecencyWeight: integer("response_recency_weight").default(25),
  emailEngagementWeight: integer("email_engagement_weight").default(15),
  campaignTouchesWeight: integer("campaign_touches_weight").default(10),
  
  // Thresholds
  hotThreshold: integer("hot_threshold").default(70),
  warmThreshold: integer("warm_threshold").default(40),
  coldThreshold: integer("cold_threshold").default(20),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Lead score history - tracks score changes over time
export const leadScoreHistory = pgTable("lead_score_history", {
  id: serial("id").primaryKey(),
  leadId: integer("lead_id").references(() => leads.id).notNull(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  profileId: integer("profile_id").references(() => leadScoringProfiles.id),
  
  // Score (-400 to +400 Betty-style range, stored as integer)
  score: integer("score").notNull(),
  previousScore: integer("previous_score"),
  
  // Factor breakdown
  factors: jsonb("factors").$type<{
    // Property factors
    ownershipDuration?: { value: number; score: number; yearsOwned?: number };
    taxDelinquency?: { value: number; score: number; delinquentAmount?: number };
    absenteeOwner?: { value: boolean; score: number };
    propertySize?: { value: number; score: number; acres?: number };
    assessedValue?: { value: number; score: number; assessedAmount?: number };
    
    // Owner factors
    corporateOwner?: { value: boolean; score: number; entityType?: string };
    multipleProperties?: { value: boolean; score: number; count?: number };
    inheritanceIndicator?: { value: boolean; score: number; indicator?: string };
    outOfState?: { value: boolean; score: number; ownerState?: string };
    
    // Market/Location factors
    floodZone?: { value: string; score: number };
    marketActivity?: { value: number; score: number; recentSales?: number };
    developmentPotential?: { value: number; score: number };
    
    // Engagement factors
    responseRecency?: { value: number; score: number; daysSinceResponse?: number };
    emailEngagement?: { value: number; score: number; openRate?: number };
    campaignTouches?: { value: number; score: number; touchCount?: number };
    
    // Computed
    totalRawScore?: number;
    normalizedScore?: number;
    recommendation?: "mail" | "maybe" | "skip";
  }>(),
  
  // Enrichment data used
  enrichmentData: jsonb("enrichment_data").$type<{
    parcelData?: any;
    floodData?: any;
    censusData?: any;
    taxData?: any;
    marketData?: any;
    lastEnriched?: string;
  }>(),
  
  triggerSource: text("trigger_source"), // manual, scheduled, import, campaign
  scoredAt: timestamp("scored_at").defaultNow(),
});

// Lead conversion tracking - for training the model
export const leadConversions = pgTable("lead_conversions", {
  id: serial("id").primaryKey(),
  leadId: integer("lead_id").references(() => leads.id).notNull(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  
  // What happened
  conversionType: text("conversion_type").notNull(), // responded, negotiating, accepted, closed, dead
  scoreAtConversion: integer("score_at_conversion"),
  
  // Campaign attribution
  campaignId: integer("campaign_id"),
  campaignType: text("campaign_type"), // direct_mail, email, sms, cold_call
  touchNumber: integer("touch_number"), // Which touch in the sequence led to conversion
  
  // Timing
  daysFromFirstTouch: integer("days_from_first_touch"),
  daysFromScore: integer("days_from_score"),
  
  // Outcome value
  dealValue: integer("deal_value"), // If closed, what was the deal value
  profitMargin: integer("profit_margin"), // Percentage profit
  
  convertedAt: timestamp("converted_at").defaultNow(),
});

export const insertLeadScoringProfileSchema = createInsertSchema(leadScoringProfiles).omit({ 
  id: true, 
  createdAt: true, 
  updatedAt: true 
});
export type LeadScoringProfile = typeof leadScoringProfiles.$inferSelect;
export type InsertLeadScoringProfile = z.infer<typeof insertLeadScoringProfileSchema>;

export const insertLeadScoreHistorySchema = createInsertSchema(leadScoreHistory).omit({ 
  id: true, 
  scoredAt: true 
});
export type LeadScoreHistory = typeof leadScoreHistory.$inferSelect;
export type InsertLeadScoreHistory = z.infer<typeof insertLeadScoreHistorySchema>;

export const insertLeadConversionSchema = createInsertSchema(leadConversions).omit({ 
  id: true, 
  convertedAt: true 
});
export type LeadConversion = typeof leadConversions.$inferSelect;
export type InsertLeadConversion = z.infer<typeof insertLeadConversionSchema>;

// ============================================
// INVENTORY: PROPERTIES & DEALS
// ============================================

// Properties in inventory
export const properties = pgTable("properties", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  
  // Core property info
  apn: text("apn").notNull(), // Assessor's Parcel Number
  legalDescription: text("legal_description"),
  county: text("county").notNull(),
  state: text("state").notNull(),
  address: text("address"),
  city: text("city"),
  zip: text("zip"),
  subdivision: text("subdivision"),
  lotNumber: text("lot_number"),

  // Subdivider vertical SD-1 — Brigid: "one parent → many children, AcreOS
  // does not know that." Adding the parent/child link is the deal-killer
  // fix. parentParcelId is null for normal parcels (every existing user) and
  // set to the parent parcel's id for child lots created by a subdivision.
  // childLotNumber is the within-subdivision lot number (e.g. "Lot 12") and
  // subdivisionPlanId points at the saved plan that produced this lot.
  parentParcelId: integer("parent_parcel_id").references((): any => properties.id, { onDelete: "set null" }),
  childLotNumber: text("child_lot_number"),
  subdivisionPlanId: varchar("subdivision_plan_id"),

  // Size & Characteristics
  sizeAcres: numeric("size_acres").notNull(),
  zoning: text("zoning"),
  terrain: text("terrain"), // flat, rolling, mountainous
  roadAccess: text("road_access"), // paved, gravel, dirt, none
  utilities: jsonb("utilities").$type<{
    electric?: boolean;
    water?: boolean;
    sewer?: boolean;
    gas?: boolean;
  }>(),
  
  // Status & Pipeline
  status: text("status").notNull().default("prospect"), 
  // prospect, due_diligence, offer_sent, under_contract, owned, listed, sold
  
  // Financial
  assessedValue: numeric("assessed_value"),
  marketValue: numeric("market_value"),
  purchasePrice: numeric("purchase_price"),
  purchaseDate: timestamp("purchase_date"),
  listPrice: numeric("list_price"),
  soldPrice: numeric("sold_price"),
  soldDate: timestamp("sold_date"),
  
  // Seller info (if applicable)
  sellerId: integer("seller_id").references(() => leads.id),
  buyerId: integer("buyer_id").references(() => leads.id),
  
  // Due diligence
  dueDiligenceStatus: text("due_diligence_status").default("pending"),
  dueDiligenceData: jsonb("due_diligence_data").$type<{
    titleClear?: boolean;
    noLiens?: boolean;
    noEnvironmentalIssues?: boolean;
    accessVerified?: boolean;
    taxesCurrent?: boolean;
    checklistCompleted?: boolean;
    notes?: string;
    // r7 Ingrid WF-R7-001: structured distress indicators. Stored
    // on the existing jsonb column to avoid a schema migration.
    // Shapes for cycle-4 distress renderer on the property detail.
    distress?: {
      taxDelinquent?: boolean;
      taxDelinquentYears?: number;
      taxPrincipalCents?: number;
      taxPenaltyCents?: number;
      taxInterestCents?: number;
      taxPayoffAsOf?: string; // ISO date
      probate?: boolean;
      codeViolation?: boolean;
      source?: string; // e.g. "county-assessor-2026-03"
      updatedAt?: string; // ISO date
      // Cycle 5 r2 Priya / r3 Sofia: tax-delinquent specialists need
      // the full lien / auction lifecycle, not just a payoff number.
      lienState?: "tax-lien" | "tax-deed"; // enum
      lienSoldDate?: string; // ISO — only for tax-lien states
      lienHolder?: string; // party holding the lien certificate (investor or the county)
      redemptionDeadline?: string; // ISO — after which foreclosure can proceed
      auctionDate?: string; // ISO — upcoming tax-deed auction, if scheduled
      openingBid?: number; // cents — tax-deed auction opening bid
    };
  }>(),
  
  // Marketing
  description: text("description"),
  highlights: jsonb("highlights").$type<string[]>(),
  photos: jsonb("photos").$type<string[]>(),
  virtualTourUrl: text("virtual_tour_url"),
  
  // GPS coordinates
  latitude: numeric("latitude"),
  longitude: numeric("longitude"),
  
  // Parcel boundary data (GeoJSON polygon from Regrid)
  parcelBoundary: jsonb("parcel_boundary").$type<{
    type: "Polygon" | "MultiPolygon";
    coordinates: number[][][] | number[][][][];
  }>(),
  parcelCentroid: jsonb("parcel_centroid").$type<{
    lat: number;
    lng: number;
  }>(),
  parcelData: jsonb("parcel_data").$type<{
    regridId?: string;
    owner?: string;
    ownerAddress?: string;
    taxAmount?: string;
    lastUpdated?: string;
  }>(),
  
  // Enrichment data (from PropertyEnrichmentService - free public data sources)
  enrichmentData: jsonb("enrichment_data"),
  enrichmentStatus: text("enrichment_status"), // pending, processing, complete, failed
  enrichedAt: timestamp("enriched_at"),

  // Structural fields (all nullable — populated by ATTOM/BatchData providers)
  bedrooms: integer("bedrooms"),
  bathrooms: numeric("bathrooms"),
  squareFeet: integer("square_feet"),
  yearBuilt: integer("year_built"),
  stories: integer("stories"),
  garageSpaces: integer("garage_spaces"),
  lotSizeSqFt: integer("lot_size_sq_ft"),
  structureType: text("structure_type"), // sfr, duplex, triplex, fourplex, condo, townhouse, commercial, mixed_use, vacant_land
  condition: text("condition"), // excellent, good, fair, poor, distressed
  afterRepairValue: numeric("after_repair_value"),
  estimatedRepairCost: numeric("estimated_repair_cost"),
  monthlyRent: numeric("monthly_rent"),
  capRate: numeric("cap_rate"),
  noi: numeric("noi"),

  // Glenn Okonkwo audit: federal lead-paint disclosure trigger.
  // 24 CFR §35.92 / 40 CFR §745.107 — every pre-1978 residential lease
  // MUST include the EPA lead-paint pamphlet acknowledgment. EPA fines
  // can reach $16K+ per violation; the platform must never let a
  // pre-1978 lease execute without the addendum attached.
  // Derived from yearBuilt: yearBuilt < 1978 → true; >= 1978 → false;
  // null when yearBuilt is unknown (don't claim a duty without evidence).
  requiresLeadPaintDisclosure: boolean("requires_lead_paint_disclosure"),

  // Entity ownership tracking
  owningEntity: text("owning_entity"), // "Smith Land LLC", "Smith IRA LLC", etc.

  // Indian-Country / federal trust land status (Aniyah §2 — 25 USC §177, 25 CFR §152).
  // Tribal trust, individual trust, and restricted-fee parcels are NOT alienable
  // under standard fee-simple rules. Auto-AVM, blind-offer generation, and
  // contract auto-doc must be blocked unless landStatus === 'fee'. The default
  // is 'unknown' so existing rows safely block automation until a human verifies.
  // TODO(LAR-overlay): Phase B will auto-set this from the BIA Land Area
  // Representations shapefile overlay. For now this is a manual-verification field.
  landStatus: text("land_status").notNull().default("unknown"),

  // Soft delete
  deletedAt: timestamp("deleted_at"),
  deletedBy: text("deleted_by"),

  // Timestamps
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("properties_org_idx").on(table.organizationId),
  index("properties_status_idx").on(table.status),
  index("properties_apn_idx").on(table.apn),
  index("properties_created_at_idx").on(table.createdAt),
  // P1-15 (Phase 3 Week 7-8) — composite indexes matching real call-sites.
  // Migration: 0045_index_audit.sql.
  index("properties_org_land_status_idx").on(table.organizationId, table.landStatus),
  index("properties_org_status_created_idx").on(table.organizationId, table.status, table.createdAt),
]);

// Deals/Transactions (acquisition or disposition)
export const deals = pgTable("deals", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  propertyId: integer("property_id").references(() => properties.id, { onDelete: "restrict" }).notNull(),
  type: text("type").notNull(), // acquisition, disposition
  status: text("status").notNull().default("negotiating"),
  // negotiating, offer_sent, countered, accepted, in_escrow, closed, cancelled
  
  // Offer details
  offerAmount: numeric("offer_amount"),
  offerDate: timestamp("offer_date"),
  counterAmount: numeric("counter_amount"),
  acceptedAmount: numeric("accepted_amount"),
  
  // Closing details
  closingDate: timestamp("closing_date"),
  closingCosts: numeric("closing_costs"),
  titleCompany: text("title_company"),
  escrowNumber: text("escrow_number"),
  
  // Documents
  documents: jsonb("documents").$type<{
    name: string;
    url: string;
    type: string;
    uploadedAt: string;
  }[]>(),
  
  // ROI Analysis Results
  analysisResults: jsonb("analysis_results").$type<{
    purchasePrice: number;
    downPayment: number;
    financedAmount: number;
    interestRate: number;
    holdingCostsMonthly: number;
    holdingPeriodMonths: number;
    improvementCosts: number;
    expectedSalePrice: number;
    totalInvestment: number;
    totalCost: number;
    grossProfit: number;
    netProfit: number;
    roiPercent: number;
    annualizedRoi: number;
    cashOnCashReturn: number;
    calculatedAt: string;
  }>(),
  
  // Property enrichment data (flood zones, hazards, demographics, etc.)
  enrichmentData: jsonb("enrichment_data").$type<{
    enrichedAt?: string;
    lookupTimeMs?: number;
    hazards?: {
      floodZone?: string;
      floodRisk?: "low" | "medium" | "high";
      wetlandsPresent?: boolean;
      wetlandsPercentage?: number;
      earthquakeRisk?: "low" | "medium" | "high";
      wildfireRisk?: "low" | "medium" | "high";
      overallRiskScore?: number;
      overallRiskLevel?: "low" | "medium" | "high";
    };
    environment?: {
      soilType?: string;
      soilSuitability?: string;
      epaFacilitiesNearby?: number;
      epaRiskLevel?: "low" | "medium" | "high";
    };
    infrastructure?: {
      nearestHospitalMiles?: number;
      nearestFireStationMiles?: number;
      nearestSchoolMiles?: number;
      accessScore?: number;
    };
    demographics?: {
      population?: number;
      medianIncome?: number;
      medianHomeValue?: number;
    };
    scores?: {
      investmentScore?: number;
      developmentScore?: number;
      riskScore?: number;
      overallScore?: number;
    };
    errors?: Record<string, string>;
  }>(),
  enrichmentStatus: text("enrichment_status"), // pending, completed, failed
  enrichedAt: timestamp("enriched_at"),
  
  notes: text("notes"),
  assignedTo: integer("assigned_to"),

  // ── agent_investor: client vs. own book (migration 0226) ──────────────────
  // 'client' = a brokerage transaction that earns a commission; 'own_investment'
  // = the agent's OWN buy/sell, which is their own P&L and NEVER a commission.
  // NULL (the default, and every pre-0226 row) is treated as 'client' — that is
  // what a deal always was — so the presence of 'own_investment' is the only
  // signal, and nothing is inferred from absence.
  dealBook: text("deal_book"), // 'client' | 'own_investment' | null

  // ── agent_investor: dual-agency disclosure TRACKER (migration 0226) ───────
  // RECORD-ONLY. These columns store what the operator asserts and uploads —
  // AcreOS does not generate, send, or e-sign any disclosure (legal-signing is
  // founder-only). `dualAgencySide` is which side the agent represented
  // ('seller' | 'buyer' | 'dual'); `disclosureAcknowledgedAt` is a recorded
  // acknowledgement date (operator-set, not a signature); `disclosureDocRef` is
  // a reference (URL/id) to a document the OPERATOR uploaded elsewhere — never
  // generated here. All nullable; a deal carries at most one such record, so
  // these are columns, not a table.
  dualAgencySide: text("dual_agency_side"), // 'seller' | 'buyer' | 'dual' | null
  disclosureAcknowledgedAt: timestamp("disclosure_acknowledged_at"),
  disclosureDocRef: text("disclosure_doc_ref"),

  deletedAt: timestamp("deleted_at"),
  deletedBy: text("deleted_by"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("deals_org_idx").on(table.organizationId),
  index("deals_status_idx").on(table.status),
  index("deals_created_at_idx").on(table.createdAt),
  // agent_investor pipeline filter: "my client deals under contract" reads by
  // (org, book). Org-LEADING per the shard-readiness invariant.
  index("deals_org_book_idx").on(table.organizationId, table.dealBook),
]);

// ============================================
// FINANCE: NOTES & PAYMENTS
// ============================================

// Seller-financed notes
export const notes = pgTable("notes", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  propertyId: integer("property_id").references(() => properties.id, { onDelete: "set null" }),
  borrowerId: integer("borrower_id").references(() => leads.id, { onDelete: "set null" }),
  
  // Note terms
  originalPrincipal: numeric("original_principal").notNull(),
  currentBalance: numeric("current_balance").notNull(),
  interestRate: numeric("interest_rate").notNull(), // Annual percentage
  termMonths: integer("term_months").notNull(),
  monthlyPayment: numeric("monthly_payment").notNull(),
  
  // Additional fees
  serviceFee: numeric("service_fee").default("0"), // Monthly note servicing fee
  lateFee: numeric("late_fee").default("0"),
  gracePeriodDays: integer("grace_period_days").default(10),

  // Property Tax Escrow (Payment processing)
  // Collects pro-rated property taxes monthly from borrower alongside loan payment
  taxEscrowEnabled: boolean("tax_escrow_enabled").default(false),
  annualPropertyTax: numeric("annual_property_tax").default("0"), // Annual tax amount for this property
  monthlyTaxEscrow: numeric("monthly_tax_escrow").default("0"), // = annualPropertyTax / 12
  taxEscrowBalance: numeric("tax_escrow_balance").default("0"), // Accumulated escrow balance
  taxEscrowAccountId: text("tax_escrow_account_id"), // Reference to escrow account
  lastTaxPaymentDate: timestamp("last_tax_payment_date"), // Last time taxes were paid from escrow
  nextTaxDueDate: timestamp("next_tax_due_date"), // Next county tax due date
  taxPaymentYear: integer("tax_payment_year"), // Tax year currently being escrowed
  countyTaxPortalUrl: text("county_tax_portal_url"), // Direct link to county payment portal
  
  // Dates
  startDate: timestamp("start_date").notNull(),
  firstPaymentDate: timestamp("first_payment_date").notNull(),
  nextPaymentDate: timestamp("next_payment_date"),
  maturityDate: timestamp("maturity_date"),
  
  // Status
  status: text("status").notNull().default("active"), 
  // pending, active, paid_off, defaulted, foreclosed
  
  // Down payment tracking
  downPayment: numeric("down_payment").default("0"),
  downPaymentReceived: boolean("down_payment_received").default(false),
  
  // Payment method info (for automation)
  paymentMethod: text("payment_method"), // ach_actum, ach_authorize, card_stripe, card_authorize, manual
  paymentAccountId: text("payment_account_id"), // Reference to stored payment method (primary)
  autoPayEnabled: boolean("auto_pay_enabled").default(false),

  // Fallback payment cascade (Payment cascade)
  // If primary payment fails, system tries fallback accounts in order
  fallbackPaymentAccounts: jsonb("fallback_payment_accounts").$type<{
    profileId: string;
    method: "ach_actum" | "ach_authorize" | "card_stripe" | "card_authorize";
    last4?: string;
    bankName?: string;
    order: number; // 1 = first fallback, 2 = second, etc.
    isActive: boolean;
  }[]>(),
  
  // Amortization schedule stored as JSON
  amortizationSchedule: jsonb("amortization_schedule").$type<{
    paymentNumber: number;
    dueDate: string;
    payment: number;
    principal: number;
    interest: number;
    balance: number;
    status: string; // pending, paid, late, missed
  }[]>(),
  
  // Portal access token for borrowers
  accessToken: text("access_token").unique(),
  
  // Pending checkout session ID for webhook verification
  pendingCheckoutSessionId: text("pending_checkout_session_id"),
  
  // Delinquency tracking
  lastReminderSentAt: timestamp("last_reminder_sent_at"),
  reminderCount: integer("reminder_count").default(0),
  daysDelinquent: integer("days_delinquent").default(0),
  delinquencyStatus: text("delinquency_status").default("current"), // current, early_delinquent, delinquent, seriously_delinquent, default_candidate
  
  // Entity ownership tracking
  owningEntity: text("owning_entity"), // "Smith Land LLC", "Smith IRA LLC", etc.

  // ── Close & Carry — Deal→Note lifecycle bridge ─────────────────────────────
  // The deal that originated this note. When a seller-financed deal closes in
  // the Deals door, "Carry this note" one-click-originates the serviced note
  // (POST /api/notes/from-deal/:dealId) and stamps the originating deal here so
  // the two halves of the lifecycle stay one continuous object — no re-keying.
  // The reverse view (deal → originated note) resolves by querying notes WHERE
  // originating_deal_id = deal.id (org-scoped). ON DELETE SET NULL: deleting the
  // deal must never cascade-destroy a live serviced note — the ledger outlives
  // its origination record.
  originatingDealId: integer("originating_deal_id").references(() => deals.id, { onDelete: "set null" }),

  // ── ATR (Ability-to-Repay) safe-harbor attestation ─────────────────────
  // Reg-Z §1026.43(c): for every consumer-purpose closed-end credit secured
  // by a dwelling, the creditor must make a reasonable, good-faith
  // determination at consummation that the borrower has the ability to
  // repay. ATR documentation must be retained for 3 years (§1026.25(c)(3)).
  // QM (Qualified Mortgage) status provides a presumption of compliance;
  // non-QM exposes the lender (and any assignee) to a borrower defense
  // under §1026.43(e)(5) for the life of the loan.
  atrDetermination: jsonb("atr_determination").$type<{
    // The eight statutory factors (§1026.43(c)(2)). Operators capture
    // current values + sources; AcreOS does not opine on sufficiency.
    currentOrReasonablyExpectedIncomeCents: number;
    currentEmploymentStatus: string;
    monthlyMortgagePaymentCents: number;
    monthlyPaymentSimultaneousLoansCents: number;
    monthlyPaymentMortgageRelatedObligationsCents: number; // taxes, insurance, HOA, MI
    currentDebtObligationsAlimonyChildSupportCents: number;
    monthlyDtiOrResidualIncomeCents: number; // DTI-as-fraction OR residual-income basis
    creditHistorySummary: string; // free-text; FICO, tradeline summary, bankruptcy notes
    // Verification evidence — at least one document per factor where
    // §1026.43(c)(3) requires third-party records (income, employment).
    verificationDocuments: Array<{
      factor: string;
      documentType: string; // 'w2' | 'tax_return' | 'bank_statement' | 'pay_stub' | 'voe' | 'other'
      receivedDate: string; // ISO date
      storedAt?: string; // S3 / blob reference
    }>;
    // Qualified Mortgage classification (§1026.43(e)). When true, the
    // QM safe-harbor / rebuttable presumption applies and the lender is
    // protected against an ATR claim absent rebuttal proof.
    qmClassification: "general_qm" | "small_creditor_qm" | "seasoned_qm" | "non_qm" | null;
    // Attestation block — operator must affirm the determination was
    // made in good faith and is supported by the documents above.
    attestedBy: string;
    attestedByUserId: number;
    attestedAt: string; // ISO timestamp
    attestationText: string; // exact text the operator affirmed
  } | null>(),
  // Quick-filter index: true once a non-null ATR determination has been
  // captured. Servicing/audit surfaces use this to flag any note that
  // entered the book without one.
  atrDeterminationCompleted: boolean("atr_determination_completed").default(false),
  atrDeterminationCompletedAt: timestamp("atr_determination_completed_at"),

  // Exemption from §1026.43 — populated INSTEAD OF atrDetermination when the
  // note is statutorily out of scope:
  //   raw_land             — non-dwelling collateral; §1026.43 doesn't attach
  //   business_purpose     — non-consumer-purpose credit (§1026.43(a)(1)(i))
  //   commercial_borrower  — borrower is an entity (LLC, trust, corp), not a natural person
  //   legacy               — grandfather marker for pre-AcreOS originated notes (CSV import / migration)
  // NULL means no exemption claimed — origination then requires a full ATR
  // determination before the note can transition to 'active'. The DB-level
  // CHECK constraint added in 0099_notes_atr_origination_gate.sql enforces
  // that status='active' is impossible without one of these or
  // atr_determination_completed=true.
  atrExemptionCode: text("atr_exemption_code").$type<
    "raw_land" | "business_purpose" | "commercial_borrower" | "legacy" | null
  >(),

  // Optimistic locking — incremented on every balance-changing write
  version: integer("version").notNull().default(1),

  notes: text("notes_text"), // Renamed to avoid conflict with table name
  deletedAt: timestamp("deleted_at"),
  deletedBy: text("deleted_by"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("notes_org_idx").on(table.organizationId),
  index("notes_status_idx").on(table.status),
  index("notes_borrower_idx").on(table.borrowerId),
  // Close & Carry: leading-org composite so "find this org's note originated
  // from deal X" (the reverse deal→note link) is a single index probe.
  index("notes_org_originating_deal_idx").on(table.organizationId, table.originatingDealId),
]);

// Payment transactions
export const payments = pgTable("payments", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  noteId: integer("note_id").references(() => notes.id, { onDelete: "cascade" }).notNull(),
  
  // Payment details
  amount: numeric("amount").notNull(),
  principalAmount: numeric("principal_amount").notNull(),
  interestAmount: numeric("interest_amount").notNull(),
  feeAmount: numeric("fee_amount").default("0"),
  lateFeeAmount: numeric("late_fee_amount").default("0"),
  
  // Payment info
  paymentDate: timestamp("payment_date").notNull(),
  dueDate: timestamp("due_date").notNull(),
  paymentMethod: text("payment_method"), // ach, card, check, cash
  transactionId: text("transaction_id").unique(), // External processor transaction ID — unique prevents duplicate payments
  
  // Status
  status: text("status").notNull().default("pending"),
  // pending, processing, completed, failed, refunded
  
  failureReason: text("failure_reason"),
  processedAt: timestamp("processed_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("payments_note_idx").on(table.noteId),
  index("payments_status_idx").on(table.status),
  index("payments_due_date_idx").on(table.dueDate),
  index("payments_created_at_idx").on(table.createdAt),
]);

// Property tax escrow payments — tracks actual county tax payments made from escrow
export const taxEscrowPayments = pgTable("tax_escrow_payments", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  noteId: integer("note_id").references(() => notes.id).notNull(),
  propertyId: integer("property_id").references(() => properties.id),

  taxYear: integer("tax_year").notNull(),
  installment: text("installment").default("annual"), // annual, first_half, second_half, quarterly
  amountPaid: numeric("amount_paid").notNull(),
  escrowBalanceUsed: numeric("escrow_balance_used").notNull(),
  shortfall: numeric("shortfall").default("0"), // if escrow insufficient
  excessRefunded: numeric("excess_refunded").default("0"),

  paymentDate: timestamp("payment_date").notNull(),
  countyConfirmationNumber: text("county_confirmation_number"),
  paymentMethod: text("payment_method").default("manual"), // manual, portal, check
  countyTaxPortalUrl: text("county_tax_portal_url"),

  notes: text("notes"),
  receiptUrl: text("receipt_url"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertTaxEscrowPaymentSchema = createInsertSchema(taxEscrowPayments).omit({ id: true, createdAt: true });
export type InsertTaxEscrowPayment = z.infer<typeof insertTaxEscrowPaymentSchema>;
export type TaxEscrowPayment = typeof taxEscrowPayments.$inferSelect;

// Payment reminders for automated delinquency management
export const paymentReminders = pgTable("payment_reminders", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  noteId: integer("note_id").references(() => notes.id).notNull(),
  borrowerId: integer("borrower_id").references(() => leads.id),
  
  // Reminder type and timing
  type: text("type").notNull(), // upcoming, due, late, final_warning
  scheduledFor: timestamp("scheduled_for").notNull(),
  sentAt: timestamp("sent_at"),
  
  // Delivery settings
  channel: text("channel").notNull().default("email"), // email, sms, both
  content: text("content"), // Generated message content
  
  // Status tracking
  status: text("status").notNull().default("scheduled"), // scheduled, sent, failed, cancelled
  failureReason: text("failure_reason"),
  
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertPaymentReminderSchema = createInsertSchema(paymentReminders).omit({ id: true, createdAt: true });
export type InsertPaymentReminder = z.infer<typeof insertPaymentReminderSchema>;
export type PaymentReminder = typeof paymentReminders.$inferSelect;

// ============================================
// MARKETING CAMPAIGNS
// ============================================

// Marketing campaigns (direct mail, email, SMS)
export const campaigns = pgTable("campaigns", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  name: text("name").notNull(),
  type: text("type").notNull(), // direct_mail, email, sms, multi_channel
  status: text("status").notNull().default("draft"), // draft, scheduled, active, paused, completed
  
  // Unique tracking code for attribution (e.g., "CAMP-ABC123")
  trackingCode: text("tracking_code").unique(),
  
  // Target audience
  targetCriteria: jsonb("target_criteria").$type<{
    states?: string[];
    counties?: string[];
    leadStatus?: string[];
    leadType?: string[];
    tags?: string[];
  }>(),
  
  // Content
  subject: text("subject"),
  content: text("content"),
  templateId: text("template_id"),
  // MMS attachments — array of public https URLs Twilio fetches and
  // attaches when sending. Currently constrained to 1 from the UI but
  // schema is array so we can lift the limit later without migration.
  mediaUrls: text("media_urls").array(),
  
  // Schedule
  scheduledDate: timestamp("scheduled_date"),
  completedDate: timestamp("completed_date"),
  
  // Metrics
  totalSent: integer("total_sent").default(0),
  totalDelivered: integer("total_delivered").default(0),
  totalOpened: integer("total_opened").default(0),
  totalClicked: integer("total_clicked").default(0),
  totalResponded: integer("total_responded").default(0),
  
  budget: numeric("budget"),
  spent: numeric("spent").default("0"),
  
  // Optimization tracking
  lastOptimizedAt: timestamp("last_optimized_at"),
  optimizationScore: integer("optimization_score"), // 0-100
  
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("campaigns_org_idx").on(table.organizationId),
  index("campaigns_status_idx").on(table.status),
]);

// Campaign optimizations (AI-powered suggestions)
export const campaignOptimizations = pgTable("campaign_optimizations", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  campaignId: integer("campaign_id").references(() => campaigns.id).notNull(),
  
  type: text("type").notNull(), // content, timing, audience, budget
  suggestion: text("suggestion").notNull(),
  reasoning: text("reasoning").notNull(),
  priority: text("priority").notNull().default("medium"), // high, medium, low
  
  implemented: boolean("implemented").default(false),
  implementedAt: timestamp("implemented_at"),
  resultDelta: jsonb("result_delta").$type<{
    before?: {
      openRate?: number;
      clickRate?: number;
      responseRate?: number;
      costPerResponse?: number;
    };
    after?: {
      openRate?: number;
      clickRate?: number;
      responseRate?: number;
      costPerResponse?: number;
    };
  }>(),
  
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertCampaignOptimizationSchema = createInsertSchema(campaignOptimizations).omit({ id: true, createdAt: true });
export type InsertCampaignOptimization = z.infer<typeof insertCampaignOptimizationSchema>;
export type CampaignOptimization = typeof campaignOptimizations.$inferSelect;

// Campaign responses (inbound responses for attribution tracking)
export const campaignResponses = pgTable("campaign_responses", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  leadId: integer("lead_id").references(() => leads.id),
  campaignId: integer("campaign_id").references(() => campaigns.id, { onDelete: "cascade" }),
  
  // Response details
  channel: text("channel").notNull(), // call, text, email, webform
  responseDate: timestamp("response_date").notNull().defaultNow(),
  content: text("content"), // Message content or call notes
  
  // Attribution tracking
  trackingCode: text("tracking_code"), // The tracking code provided by the responder
  isAttributed: boolean("is_attributed").default(false), // Whether we successfully linked to a campaign
  
  // Contact info if no existing lead
  contactName: text("contact_name"),
  contactEmail: text("contact_email"),
  contactPhone: text("contact_phone"),
  
  // Metadata
  metadata: jsonb("metadata").$type<{
    callDuration?: number;
    sentiment?: string;
    followUpRequired?: boolean;
    notes?: string;
  }>(),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertCampaignResponseSchema = createInsertSchema(campaignResponses).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCampaignResponse = z.infer<typeof insertCampaignResponseSchema>;
export type CampaignResponse = typeof campaignResponses.$inferSelect;

// Campaign delivery events (audit trail for sent messages)
export const campaignDeliveryEvents = pgTable("campaign_delivery_events", {
  id: serial("id").primaryKey(),
  campaignId: integer("campaign_id").references(() => campaigns.id).notNull(),
  leadId: integer("lead_id").references(() => leads.id).notNull(),
  channel: text("channel").notNull(), // email, sms, direct_mail
  status: text("status").notNull().default("sent"), // sent, delivered, bounced, complained, failed
  sentAt: timestamp("sent_at").defaultNow(),
  statusUpdatedAt: timestamp("status_updated_at").defaultNow(),
  metadata: jsonb("metadata"),
});

export const insertCampaignDeliveryEventSchema = createInsertSchema(campaignDeliveryEvents).omit({ id: true });
export type InsertCampaignDeliveryEvent = z.infer<typeof insertCampaignDeliveryEventSchema>;
export type CampaignDeliveryEvent = typeof campaignDeliveryEvents.$inferSelect;

// ============================================
// AI AGENTS & AUTOMATION
// ============================================

// AI Agent configurations
export const agentConfigs = pgTable("agent_configs", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  agentType: text("agent_type").notNull(), 
  // due_diligence, marketing_writer, buyer_communicator, offer_generator, research
  
  name: text("name").notNull(),
  description: text("description"),
  isEnabled: boolean("is_enabled").notNull().default(true),
  
  // Configuration
  config: jsonb("config").$type<{
    systemPrompt?: string;
    temperature?: number;
    maxTokens?: number;
    channels?: string[]; // For buyer_communicator: email, sms, facebook, etc.
    autoReply?: boolean;
    workingHours?: { start: string; end: string };
    responseTemplates?: { trigger: string; response: string }[];
  }>(),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// AI Agent tasks/jobs
export const agentTasks = pgTable("agent_tasks", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  agentConfigId: integer("agent_config_id").references(() => agentConfigs.id),
  agentType: text("agent_type").notNull(),
  
  // Task details
  status: text("status").notNull().default("pending"), 
  // pending, queued, processing, completed, failed, cancelled
  priority: integer("priority").default(5), // 1-10, lower is higher priority
  
  // Input/Output
  input: jsonb("input").notNull(),
  output: jsonb("output"),
  error: text("error"),
  
  // Related entities
  relatedLeadId: integer("related_lead_id").references(() => leads.id),
  relatedPropertyId: integer("related_property_id").references(() => properties.id),
  relatedDealId: integer("related_deal_id").references(() => deals.id),
  
  // Execution
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  executionTimeMs: integer("execution_time_ms"),
  
  // Human review
  requiresReview: boolean("requires_review").default(false),
  reviewedBy: integer("reviewed_by"),
  reviewedAt: timestamp("reviewed_at"),
  reviewNotes: text("review_notes"),
  
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("agent_tasks_org_idx").on(table.organizationId),
  index("agent_tasks_status_idx").on(table.status),
  index("agent_tasks_created_at_idx").on(table.createdAt),
]);

// Background Agent Runs (tracking status of automated agents)
export const agentRuns = pgTable("agent_runs", {
  id: serial("id").primaryKey(),
  agentName: text("agent_name").notNull().unique(), // lead_nurturer, campaign_optimizer, finance_agent, sequence_processor, alerting_service, digest_service
  status: text("status").notNull().default("idle"), // idle, running, completed, failed
  lastRunAt: timestamp("last_run_at"),
  nextRunAt: timestamp("next_run_at"),
  processedCount: integer("processed_count").default(0),
  errorCount: integer("error_count").default(0),
  lastError: text("last_error"),
  metadata: jsonb("metadata").$type<Record<string, any>>(),
});

// Agent Memory - stores learned patterns, facts, and preferences
export const agentMemory = pgTable("agent_memory", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  agentType: text("agent_type").notNull(), // research, deals, communications, operations
  memoryType: text("memory_type").notNull(), // fact, preference, success_pattern, failure_pattern
  key: text("key").notNull(), // unique identifier for the memory
  value: jsonb("value").$type<Record<string, any>>().notNull(), // the actual memory data
  confidence: numeric("confidence").default("0.5"), // 0-1 confidence score
  usageCount: integer("usage_count").default(0), // how often this memory has been used
  lastUsedAt: timestamp("last_used_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertAgentMemorySchema = createInsertSchema(agentMemory).omit({
  id: true,
  createdAt: true,
  usageCount: true,
  lastUsedAt: true,
});
export type InsertAgentMemory = z.infer<typeof insertAgentMemorySchema>;
export type AgentMemory = typeof agentMemory.$inferSelect;

// Agent Feedback - user ratings and feedback on agent task outputs
export const agentFeedback = pgTable("agent_feedback", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  agentTaskId: integer("agent_task_id").references(() => agentTasks.id).notNull(),
  userId: text("user_id").notNull(), // Replit user ID
  rating: integer("rating").notNull(), // 1-5 star rating
  helpful: boolean("helpful").notNull(), // was the output helpful?
  feedback: text("feedback"), // optional text feedback
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertAgentFeedbackSchema = createInsertSchema(agentFeedback).omit({
  id: true,
  createdAt: true,
});
export type InsertAgentFeedback = z.infer<typeof insertAgentFeedbackSchema>;
export type AgentFeedback = typeof agentFeedback.$inferSelect;

// ============================================
// MULTI-AGENT ORCHESTRATION
// ============================================

// Agent Sessions - Multi-agent collaboration sessions
export const agentSessions = pgTable("agent_sessions", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  name: text("name").notNull(),
  sessionType: text("session_type").notNull(), // due_diligence_pod, acquisition_research, deal_analysis, etc.
  status: text("status").notNull().default("active"), // active, completed, failed, cancelled
  
  // Shared context that all agents in this session can access
  sharedContext: jsonb("shared_context").$type<{
    targetEntity?: { type: string; id: number };
    inputs?: Record<string, any>;
    intermediateResults?: Record<string, any>;
    decisions?: Array<{ agentType: string; decision: string; reasoning: string; timestamp: string }>;
  }>().default({}),
  
  // Session configuration
  config: jsonb("config").$type<{
    maxSteps?: number;
    timeout?: number;
    requireHumanApproval?: string[];
    participatingAgents?: string[];
  }>(),
  
  // Tracking
  initiatedBy: text("initiated_by"), // user ID or 'system'
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertAgentSessionSchema = createInsertSchema(agentSessions).omit({
  id: true,
  createdAt: true,
  completedAt: true,
});
export type InsertAgentSession = z.infer<typeof insertAgentSessionSchema>;
export type AgentSession = typeof agentSessions.$inferSelect;

// Agent Session Steps - Steps within a multi-agent session
export const agentSessionSteps = pgTable("agent_session_steps", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").references(() => agentSessions.id).notNull(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  
  stepNumber: integer("step_number").notNull(),
  agentType: text("agent_type").notNull(),
  skillUsed: text("skill_used"),
  
  status: text("status").notNull().default("pending"), // pending, running, completed, failed, skipped
  input: jsonb("input"),
  output: jsonb("output"),
  error: text("error"),
  
  // Execution tracking
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  executionTimeMs: integer("execution_time_ms"),
  
  // Dependencies
  dependsOnSteps: integer("depends_on_steps").array(),
  
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertAgentSessionStepSchema = createInsertSchema(agentSessionSteps).omit({
  id: true,
  createdAt: true,
  startedAt: true,
  completedAt: true,
  executionTimeMs: true,
});
export type InsertAgentSessionStep = z.infer<typeof insertAgentSessionStepSchema>;
export type AgentSessionStep = typeof agentSessionSteps.$inferSelect;

// Event Subscriptions - Agent event subscriptions
export const eventSubscriptions = pgTable("event_subscriptions", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  
  subscriberType: text("subscriber_type").notNull(), // agent, workflow, webhook
  subscriberId: text("subscriber_id").notNull(), // agent type or workflow ID
  
  eventType: text("event_type").notNull(), // property_value_change, lead_created, deadline_approaching, market_shift, etc.
  eventFilter: jsonb("event_filter").$type<{
    entityType?: string;
    entityId?: number;
    conditions?: Record<string, any>;
  }>(),
  
  isActive: boolean("is_active").notNull().default(true),
  lastTriggeredAt: timestamp("last_triggered_at"),
  triggerCount: integer("trigger_count").default(0),
  
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertEventSubscriptionSchema = createInsertSchema(eventSubscriptions).omit({
  id: true,
  createdAt: true,
  lastTriggeredAt: true,
  triggerCount: true,
});
export type InsertEventSubscription = z.infer<typeof insertEventSubscriptionSchema>;
export type EventSubscription = typeof eventSubscriptions.$inferSelect;

// Agent Events - Event log for agent system
export const agentEvents = pgTable("agent_events", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  
  eventType: text("event_type").notNull(),
  eventSource: text("event_source").notNull(), // system, user, agent, external
  
  payload: jsonb("payload").$type<Record<string, any>>().notNull(),
  
  // Related entities
  relatedEntityType: text("related_entity_type"), // lead, property, deal, etc.
  relatedEntityId: integer("related_entity_id"),
  
  processedAt: timestamp("processed_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertAgentEventSchema = createInsertSchema(agentEvents).omit({
  id: true,
  createdAt: true,
  processedAt: true,
});
export type InsertAgentEvent = z.infer<typeof insertAgentEventSchema>;
export type AgentEvent = typeof agentEvents.$inferSelect;

// Outcome Telemetry - Track outcomes for AI learning
export const outcomeTelemetry = pgTable("outcome_telemetry", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  
  outcomeType: text("outcome_type").notNull(), // deal_won, deal_lost, lead_converted, offer_accepted, etc.
  
  // What happened
  outcome: jsonb("outcome").$type<{
    success: boolean;
    value?: number;
    details?: Record<string, any>;
  }>().notNull(),
  
  // What led to this outcome (for learning)
  contributingFactors: jsonb("contributing_factors").$type<{
    agentActions?: Array<{ agentType: string; action: string; timestamp: string }>;
    messagesSent?: number;
    offerAmount?: number;
    responseTime?: number;
    sequenceUsed?: string;
    marketConditions?: Record<string, any>;
  }>(),
  
  // Related entities
  relatedLeadId: integer("related_lead_id").references(() => leads.id),
  relatedPropertyId: integer("related_property_id").references(() => properties.id),
  relatedDealId: integer("related_deal_id").references(() => deals.id),
  
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertOutcomeTelemetrySchema = createInsertSchema(outcomeTelemetry).omit({
  id: true,
  createdAt: true,
});
export type InsertOutcomeTelemetry = z.infer<typeof insertOutcomeTelemetrySchema>;
export type OutcomeTelemetry = typeof outcomeTelemetry.$inferSelect;

// Conversations (for buyer communication agent)
export const conversations = pgTable("conversations", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  leadId: integer("lead_id").references(() => leads.id).notNull(),
  propertyId: integer("property_id").references(() => properties.id),
  
  channel: text("channel").notNull(), // email, sms, facebook, whatsapp
  externalId: text("external_id"), // External thread/conversation ID
  
  status: text("status").notNull().default("active"), // active, closed, escalated
  assignedAgentId: integer("assigned_agent_id").references(() => agentConfigs.id),
  assignedHumanId: integer("assigned_human_id").references(() => teamMembers.id),
  
  lastMessageAt: timestamp("last_message_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Messages within conversations
export const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").references(() => conversations.id, { onDelete: "cascade" }).notNull(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),

  direction: text("direction").notNull(), // inbound, outbound
  sender: text("sender").notNull(), // lead, agent, human
  content: text("content").notNull(),

  // For AI-generated messages
  generatedByAgent: boolean("generated_by_agent").default(false),
  agentTaskId: integer("agent_task_id").references(() => agentTasks.id),

  // Delivery status
  status: text("status").notNull().default("sent"), // pending, sent, delivered, read, failed
  externalId: text("external_id"),

  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  // Webhook-replay defense (Hessam §2.2 + §2.4): a replayed Twilio webhook
  // would otherwise insert duplicate rows for the same MessageSid and
  // double-fire downstream side effects. Partial unique index because
  // outbound messages may not have an externalId at insert time.
  // The migration (0033_twilio_messagesid_unique.sql) creates the index
  // CONCURRENTLY with the same WHERE clause.
  uniqueIndex("messages_external_id_unique")
    .on(table.externalId)
    .where(sql`${table.externalId} IS NOT NULL`),
  // P1-15 (Phase 3 Week 7-8) — thread reads always filter org → conversation
  // and order by createdAt DESC. Migration: 0045_index_audit.sql.
  index("messages_org_conversation_created_idx").on(
    table.organizationId,
    table.conversationId,
    table.createdAt,
  ),
]);

// ============================================
// ACTIVITY LOG & AUDIT
// ============================================

export const activityLog = pgTable("activity_log", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  
  // Who/What
  userId: text("user_id"),
  teamMemberId: integer("team_member_id").references(() => teamMembers.id),
  agentType: text("agent_type"),
  
  // Action
  action: text("action").notNull(), // created, updated, deleted, status_changed, etc.
  entityType: text("entity_type").notNull(), // lead, property, note, payment, etc.
  entityId: integer("entity_id").notNull(),
  
  // Details
  description: text("description"),
  changes: jsonb("changes"), // { field: { old: value, new: value } }
  metadata: jsonb("metadata"),
  
  createdAt: timestamp("created_at").defaultNow(),
});

// ============================================
// TCPA / CAN-SPAM — EVIDENCE-GRADE CONSENT EVENTS
// ============================================
// "Prior express written consent" under 47 CFR § 64.1200(f)(9) requires:
//   (i)  the consumer's signature (electronic signature is fine)
//   (ii) clear and conspicuous disclosure that the consumer agrees to
//        receive autodialed/prerecorded calls/texts from a specific
//        identified seller
//   (iii) the disclosure must NOT be a condition of purchase
//
// To produce that record at trial we need the EXACT consent language
// shown, the checkbox state, the IP/UA fingerprint, and the timestamp.
// This is the table the plaintiff's expert will subpoena first.
export const leadConsentEvents = pgTable("lead_consent_events", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  leadId: integer("lead_id").references(() => leads.id, { onDelete: "cascade" }).notNull(),

  // What happened — granted or revoked, and on what channel(s)
  eventType: text("event_type").notNull(), // 'granted' | 'revoked' | 'updated' | 'imported'
  channels: jsonb("channels").$type<string[]>().notNull(), // ['sms','email','phone','direct_mail']

  // How consent was captured — must map to TCPA's enumerated sources
  source: text("source").notNull(), // 'website' | 'phone_ivr' | 'written' | 'sms_double_optin' | 'imported' | 'inbound_stop'

  // The disclosure language SHOWN to the consumer at capture time. NEVER
  // edit or null this row — it is the exhibit.
  consentText: text("consent_text"),
  checkboxChecked: boolean("checkbox_checked"),

  // Web/IVR fingerprint at the moment of consent
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  pageUrl: text("page_url"),

  // For revocation: the verbatim inbound message + carrier identifier
  inboundMessageText: text("inbound_message_text"),
  inboundMessageSid: text("inbound_message_sid"),
  inboundFromPhone: text("inbound_from_phone"),

  // For 'imported' rows: the file/batch identifier the legacy consent
  // record came from — required for chain-of-custody arguments.
  importBatchId: text("import_batch_id"),

  // The agent that wrote this row (human user id, or 'pax', 'twilio_webhook', etc.)
  recordedBy: text("recorded_by"),

  // Free-form for future fields, never null in production rows.
  metadata: jsonb("metadata"),

  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("lead_consent_events_lead_idx").on(table.leadId),
  index("lead_consent_events_org_idx").on(table.organizationId),
  index("lead_consent_events_type_idx").on(table.eventType),
  index("lead_consent_events_created_at_idx").on(table.createdAt),
]);

export type LeadConsentEvent = typeof leadConsentEvents.$inferSelect;
export type NewLeadConsentEvent = typeof leadConsentEvents.$inferInsert;

// ============================================
// USAGE & BILLING
// ============================================

export const usageEvents = pgTable("usage_events", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  
  eventType: text("event_type").notNull(), // ai_request, sms_sent, email_sent, etc.
  quantity: integer("quantity").notNull().default(1),
  
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Usage Records - tracks billable actions
export const usageRecords = pgTable("usage_records", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  actionType: text("action_type").notNull(), // email_sent, sms_sent, ai_chat, ai_image, pdf_generated, comps_query, direct_mail
  quantity: integer("quantity").notNull().default(1),
  unitCostCents: integer("unit_cost_cents").notNull(), // cost per unit in cents
  totalCostCents: integer("total_cost_cents").notNull(), // quantity * unitCostCents
  metadata: jsonb("metadata").$type<{
    campaignId?: number;
    recipientEmail?: string;
    recipientPhone?: string;
    documentType?: string;
    aiModel?: string;
    propertyId?: number;
    [key: string]: unknown;
  }>(),
  billingMonth: text("billing_month").notNull(), // Format: "2025-01"
  createdAt: timestamp("created_at").defaultNow(),
});

// Credit Transactions - tracks credit purchases/debits
export const creditTransactions = pgTable("credit_transactions", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  type: text("type").notNull(), // purchase, debit, refund, bonus, monthly_allowance
  amountCents: integer("amount_cents").notNull(), // positive for credits, negative for debits
  balanceAfterCents: integer("balance_after_cents").notNull(),
  description: text("description").notNull(),
  stripePaymentIntentId: text("stripe_payment_intent_id"), // for purchases
  stripeCheckoutSessionId: text("stripe_checkout_session_id"),
  // Populated only for allowance-type transactions (e.g. "2025-01").
  // Used with unique index to prevent double-granting via ON CONFLICT DO NOTHING (DEFECT-0007).
  allowanceMonth: text("allowance_month"),
  metadata: jsonb("metadata").$type<{
    creditPackId?: string;
    usageRecordIds?: number[];
    [key: string]: unknown;
  }>(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  // Prevents double-granting monthly allowances under concurrent execution (DEFECT-0007)
  uniqueIndex("credit_txn_allowance_month_org_uniq").on(table.organizationId, table.allowanceMonth),
]);

// Lens 3 (Pricing Coherence) — cache of the per-org current-month pool
// balance for fast hard-wall checks. Source of truth is `financial_ledger`
// (category='opex_spent', feature in TRACKED_CATEGORIES); this table is a
// best-effort cache so rate gates don't aggregate the ledger every call.
export const orgCredits = pgTable("org_credits", {
  organizationId: integer("organization_id")
    .primaryKey()
    .references(() => organizations.id, { onDelete: "cascade" }),
  balanceCents: integer("balance_cents").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// Usage Rates - configurable pricing per action type
export const usageRates = pgTable("usage_rates", {
  id: serial("id").primaryKey(),
  actionType: text("action_type").notNull().unique(), // email_sent, sms_sent, ai_chat, etc.
  displayName: text("display_name").notNull(),
  unitCostCents: integer("unit_cost_cents").notNull(), // cost per action in cents
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ============================================
// AI COMMAND CENTER
// ============================================

// AI Agent Profiles - predefined specialist agents
export const aiAgentProfiles = pgTable("ai_agent_profiles", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(), // "Alex", "Uma", "Maya", etc.
  role: text("role").notNull(), // "acquisitions", "underwriting", "marketing", "research", "documents"
  displayName: text("display_name").notNull(), // "Acquisitions Specialist"
  description: text("description").notNull(),
  systemPrompt: text("system_prompt").notNull(),
  capabilities: text("capabilities").array().notNull(), // ["analyze_leads", "score_opportunities"]
  icon: text("icon").notNull(), // lucide icon name
  isActive: boolean("is_active").default(true),
});

// AI Tool Definitions - available tools for agents
export const aiToolDefinitions = pgTable("ai_tool_definitions", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(), // "get_leads", "create_note"
  displayName: text("display_name").notNull(),
  description: text("description").notNull(),
  category: text("category").notNull(), // "crm", "finance", "marketing", "research"
  parameters: jsonb("parameters").notNull(), // JSON schema for parameters
  requiresApproval: boolean("requires_approval").default(false), // high-risk actions
  agentRoles: text("agent_roles").array(), // which agents can use this tool
});

// AI Execution Runs - tracks agent task executions
export const aiExecutionRuns = pgTable("ai_execution_runs", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull(),
  conversationId: integer("conversation_id"),
  agentRole: text("agent_role").notNull(),
  status: text("status").notNull().default("pending"), // pending, running, completed, failed, requires_approval
  input: jsonb("input").notNull(),
  output: jsonb("output"),
  toolCalls: jsonb("tool_calls"), // array of tool calls made
  startedAt: timestamp("started_at").defaultNow(),
  completedAt: timestamp("completed_at"),
  error: text("error"),
});

// AI Memory/Context - stores important facts and preferences
export const aiMemory = pgTable("ai_memory", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull(),
  memoryType: text("memory_type").notNull(), // "fact", "preference", "procedure"
  content: text("content").notNull(),
  source: text("source"), // where this memory came from
  createdAt: timestamp("created_at").defaultNow(),
  expiresAt: timestamp("expires_at"),
});

// AI Conversations - chat history with AI agents
// ============================================
// PAX CONNECTORS — per-org connector instances
// ============================================

export const paxConnectorInstances = pgTable("pax_connector_instances", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull(),
  connectorId: text("connector_id").notNull(), // 'gmail' | 'google_drive' | 'stripe' | etc.
  status: text("status").notNull().default("disconnected"), // 'disconnected' | 'connected' | 'error'
  // Encrypted credentials JSON (access_token, refresh_token, api_key, webhook_url, etc.)
  credentialsEncrypted: text("credentials_encrypted"),
  settings: jsonb("settings").$type<Record<string, any>>(),
  lastTestedAt: timestamp("last_tested_at"),
  lastErrorAt: timestamp("last_error_at"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => [
  index("pax_ci_org_idx").on(t.organizationId),
  index("pax_ci_connector_idx").on(t.organizationId, t.connectorId),
]);
export type PaxConnectorInstance = typeof paxConnectorInstances.$inferSelect;

export const paxKnowledgeFiles = pgTable("pax_knowledge_files", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  extractedContent: text("extracted_content").notNull(),
  uploadedBy: text("uploaded_by").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  usageCount: integer("usage_count").notNull().default(0),
  lastUsedAt: timestamp("last_used_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
  index("pax_kb_org_idx").on(t.organizationId),
  index("pax_kb_active_idx").on(t.isActive),
]);
export type PaxKnowledgeFile = typeof paxKnowledgeFiles.$inferSelect;

export const paxProjects = pgTable("pax_projects", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  entityType: text("entity_type"),
  entityId: integer("entity_id"),
  isActive: boolean("is_active").notNull().default(true),
  fileCount: integer("file_count").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
  index("pax_proj_org_idx").on(t.organizationId),
  index("pax_proj_entity_idx").on(t.entityType, t.entityId),
]);
export type PaxProject = typeof paxProjects.$inferSelect;

export const paxProjectFiles = pgTable("pax_project_files", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull(),
  fileName: text("file_name").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  extractedContent: text("extracted_content").notNull(),
  uploadedBy: text("uploaded_by").notNull(),
  uploadedAt: timestamp("uploaded_at").defaultNow(),
}, (t) => [index("pax_pf_proj_idx").on(t.projectId)]);
export type PaxProjectFile = typeof paxProjectFiles.$inferSelect;

export const paxScheduledTasks = pgTable("pax_scheduled_tasks", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  prompt: text("prompt").notNull(),
  agentRole: text("agent_role").notNull().default("executive"),
  schedule: text("schedule").notNull(),
  timezone: text("timezone").notNull().default("America/New_York"),
  isActive: boolean("is_active").notNull().default(true),
  lastRunAt: timestamp("last_run_at"),
  nextRunAt: timestamp("next_run_at"),
  lastRunConversationId: integer("last_run_conversation_id"),
  lastRunStatus: text("last_run_status"),
  lastRunSummary: text("last_run_summary"),
  runCount: integer("run_count").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => [
  index("pax_tasks_org_idx").on(t.organizationId),
  index("pax_tasks_next_run_idx").on(t.nextRunAt),
]);
export type PaxScheduledTask = typeof paxScheduledTasks.$inferSelect;

// ============================================
// PAX SCHEDULED TASK RUN HISTORY
// ============================================
export const paxScheduledTaskRuns = pgTable("pax_scheduled_task_runs", {
  id: serial("id").primaryKey(),
  taskId: integer("task_id").notNull(),
  organizationId: integer("organization_id").notNull(),
  runAt: timestamp("run_at").defaultNow().notNull(),
  status: text("status").notNull(), // "success" | "error"
  summary: text("summary"),
  conversationId: integer("conversation_id"),
  durationMs: integer("duration_ms"),
}, (t) => [
  index("pax_task_runs_task_idx").on(t.taskId),
  index("pax_task_runs_org_idx").on(t.organizationId),
]);
export type PaxScheduledTaskRun = typeof paxScheduledTaskRuns.$inferSelect;

// ============================================
// PAX NUDGES — proactive ambient intelligence cards
// ============================================
export const paxNudges = pgTable("pax_nudges", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull(),
  userId: text("user_id"), // null = org-wide nudge
  content: text("content").notNull(), // Human-readable insight
  category: text("category").notNull(), // "stale_leads" | "stuck_deal" | "streak" | "task_due" | "opportunity"
  entityType: text("entity_type"), // "lead" | "property" | "deal" | null
  entityId: integer("entity_id"),
  priority: integer("priority").notNull().default(5), // 1 (high) – 10 (low)
  actionPrompt: text("action_prompt"), // Auto-send this to Pax when user clicks the nudge
  dismissedAt: timestamp("dismissed_at"),
  snoozedUntil: timestamp("snoozed_until"),
  snoozeCount: integer("snooze_count").default(0),
  actionedAt: timestamp("actioned_at"),    // when user clicked through (for tracking)
  actionType: text("action_type"),          // "dismissed" | "snoozed" | "actioned"
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
  index("pax_nudges_org_idx").on(t.organizationId),
  index("pax_nudges_active_idx").on(t.organizationId, t.dismissedAt),
]);
export type PaxNudge = typeof paxNudges.$inferSelect;

// 2026-06-10 (T0-6, elevation blueprint): server-persisted Pax send drafts.
// The witnessed-send loop previously trusted the CLIENT to re-supply
// subject/message on approve-and-send, so the approval wasn't bound to the
// draft Pax actually wrote, and a double-tap sent twice. The draft now lives
// here from the moment it's generated; approval references draftId + a
// content hash of exactly this row, and the pending→sent transition is the
// idempotency claim (second tap finds status='sent' and returns the first
// result instead of re-sending).
export const paxDrafts = pgTable("pax_drafts", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull(),
  leadId: integer("lead_id").notNull(),
  channel: text("channel").notNull().default("email"), // "email" | "sms"
  toAddress: text("to_address").notNull(),
  subject: text("subject").notNull().default(""),
  message: text("message").notNull(),
  contentHash: text("content_hash").notNull(), // sha256(subject + "\n" + message)
  status: text("status").notNull().default("pending"), // "pending" | "sent"
  sentAt: timestamp("sent_at"),
  sentMessageId: text("sent_message_id"),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
  index("pax_drafts_org_idx").on(t.organizationId),
  index("pax_drafts_lookup_idx").on(t.organizationId, t.leadId, t.channel, t.status),
]);
export type PaxDraft = typeof paxDrafts.$inferSelect;

// 2026-06-10 (Tier 1A, elevation blueprint): the structural approval kernel.
// Every approval-required tool invocation that arrives WITHOUT the trusted
// server-side approval option freezes here as a pending_actions row — tool
// name + frozen args + a sha256 content hash of the canonicalized args — and
// returns a pending artifact instead of executing. The approve endpoint
// executes THAT row (re-verifying the hash) and nothing else. Witnessed-send
// becomes unbypassable by construction: there is no code path from a model
// tool call to a live send that does not pass through a human tap on a
// frozen, hash-verified row.
export const pendingActions = pgTable("pending_actions", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull(),
  toolName: text("tool_name").notNull(),
  // Frozen at proposal time. The approve path executes EXACTLY these args —
  // client-supplied content never touches the execution.
  args: jsonb("args").notNull().$type<Record<string, unknown>>(),
  contentHash: text("content_hash").notNull(), // sha256(toolName + "\n" + canonicalized args)
  status: text("status").notNull().default("pending"), // "pending" | "approved" | "executed" | "expired" | "rejected"
  expiresAt: timestamp("expires_at").notNull(),
  createdByUserId: text("created_by_user_id"),
  approvedByUserId: text("approved_by_user_id"),
  executedAt: timestamp("executed_at"),
  resultSummary: jsonb("result_summary").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
  index("pending_actions_org_status_idx").on(t.organizationId, t.status),
  index("pending_actions_org_dedupe_idx").on(t.organizationId, t.toolName, t.contentHash, t.status),
]);
export type PendingAction = typeof pendingActions.$inferSelect;

// Append-only audit of every send executed through the approval kernel.
// INSERT-only by contract — no UPDATE path exists anywhere in the codebase
// (replacing the mutable agent_memory JSON blob as the send audit).
export const paxSends = pgTable("pax_sends", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull(),
  pendingActionId: integer("pending_action_id").notNull(),
  toolName: text("tool_name").notNull(),
  channel: text("channel").notNull(), // "email" | "sms" | "slack" | "stripe" | "other"
  recipientRef: text("recipient_ref"), // email / phone / "lead:<id>" / channel name — best-effort, never PII beyond what the org already holds
  contentHash: text("content_hash").notNull(),
  sentAt: timestamp("sent_at").defaultNow(),
}, (t) => [
  index("pax_sends_org_sent_idx").on(t.organizationId, t.sentAt),
  index("pax_sends_org_action_idx").on(t.organizationId, t.pendingActionId),
]);
export type PaxSend = typeof paxSends.$inferSelect;

// proof_receipts — the persisted, hash-chained ProofReceipt log (Foundry move
// #3 persistence). Every witnessed governed action seals one row: what + for
// whom (scope) + who approved + under which constitution + the Art.50
// disclosure. `receipt_hash` is the per-row integrity seal; `prev_receipt_hash`
// links each row to the previous one in the same scope chain (tamper-evident
// ordering). Append-only by contract (no UPDATE path), mirroring pax_sends.
export const proofReceipts = pgTable("proof_receipts", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id"), // null = platform scope (AcreOS itself)
  scope: text("scope").notNull(), // "platform" | "org:N"
  actionKind: text("action_kind").notNull(),
  payloadHash: text("payload_hash").notNull(),
  accountableHumanId: text("accountable_human_id").notNull(),
  constitutionVersion: text("constitution_version").notNull(),
  constitutionVersionHash: text("constitution_version_hash").notNull(),
  gateResults: jsonb("gate_results"),
  evalScore: doublePrecision("eval_score"),
  costUsd: doublePrecision("cost_usd"),
  autonomyLevel: text("autonomy_level"),
  situationHash: text("situation_hash"),
  // Frontier #4 — receipt schema version (1 = legacy, 2 = prediction-sealed).
  // Stored so rowToReceipt reconstructs the exact body shape the hash sealed.
  receiptVersion: integer("receipt_version").notNull().default(1),
  // Frontier #4 — the brain's sealed forecast at issuance (SealedPrediction);
  // null when the brain abstained. Sealed into receiptHash on v2 receipts.
  prediction: jsonb("prediction"),
  // Frontier #4 — the replay anchor: sha256 of the full decision inputs.
  inputsHash: text("inputs_hash"),
  // Frontier #4 — what the realized outcome delta is attributed to (CauseAllocation).
  causeAllocation: jsonb("cause_allocation"),
  disclosure: text("disclosure").notNull(),
  // ISO string (not a timestamp) so the sealed receiptHash round-trips
  // byte-for-byte — a timestamp's tz/precision drift would break verification.
  issuedAt: text("issued_at").notNull(),
  prevReceiptHash: text("prev_receipt_hash"),
  receiptHash: text("receipt_hash").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
  index("proof_receipts_scope_id_idx").on(t.scope, t.id),
  index("proof_receipts_org_issued_idx").on(t.organizationId, t.issuedAt),
  index("proof_receipts_hash_idx").on(t.receiptHash),
]);
export type ProofReceiptRow = typeof proofReceipts.$inferSelect;

// 2026-06-10 (Tier 1E, elevation blueprint): backup restore-verification
// ledger. A backup that has never been restored is a hope, not a backup. The
// weekly backup_restore_verify job (server/jobs/backupRestoreVerify.ts)
// restores the latest S3 pg_dump into a scratch database, asserts crown-jewel
// row-count parity vs production within tolerance, drops the scratch DB, and
// writes one row here — the durable proof the deadman/founder surfaces can
// read to answer "when did a restore last actually work?".
export const backupVerified = pgTable("backup_verified", {
  id: serial("id").primaryKey(),
  backupKey: text("backup_key").notNull(), // s3 object key of the dump verified
  backupSizeBytes: bigint("backup_size_bytes", { mode: "number" }),
  status: text("status").notNull(), // "verified" | "failed" | "skipped_config"
  tablesChecked: jsonb("tables_checked"), // [{ table, prodCount, scratchCount, driftPct, ok }]
  maxDriftPct: real("max_drift_pct"),
  error: text("error"),
  durationMs: integer("duration_ms"),
  verifiedAt: timestamp("verified_at").defaultNow().notNull(),
}, (t) => [
  index("backup_verified_at_idx").on(t.verifiedAt),
]);
export type BackupVerified = typeof backupVerified.$inferSelect;

export const aiConversations = pgTable("ai_conversations", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull(),
  userId: text("user_id").notNull(),
  title: text("title").notNull(),
  agentRole: text("agent_role").notNull().default("executive"),
  activeProjectId: integer("active_project_id"),
  contextSummary: text("context_summary"), // Auto-compaction summary of older messages
  // Founder Chat Phase A — Atlas thread scope discriminator. "customer" preserves
  // legacy Pax behavior; "founder" marks Atlas threads (the founder chat-spine).
  scope: text("scope").notNull().default("customer"),
  isDefault: boolean("is_default").notNull().default(false),
  threadTitle: text("thread_title"),
  pinnedMessageIds: integer("pinned_message_ids").array().notNull().default(sql`'{}'::integer[]`),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  // Exactly one isDefault=true row per (userId, scope='founder'). The partial
  // index makes the constraint a runtime invariant, not just a convention.
  uniqueIndex("ai_conversations_one_default_per_founder")
    .on(table.userId, table.scope)
    .where(sql`is_default = true AND scope = 'founder'`),
]);

// Founder Chat — pending destructive tool calls awaiting confirmation. The
// executor returns a confirmation_request artifact and persists the call here;
// when the founder confirms, the row is consumed (single-use) and the tool runs.
export const chatPendingToolCalls = pgTable("chat_pending_tool_calls", {
  id: text("id").primaryKey(),  // random 32-char hex (the confirmationRequestId)
  threadId: integer("thread_id").references(() => aiConversations.id, { onDelete: "cascade" }).notNull(),
  founderUserId: text("founder_user_id").notNull(),
  toolName: text("tool_name").notNull(),
  args: jsonb("args").notNull(),
  ctxSnapshot: jsonb("ctx_snapshot").notNull(),  // FounderToolContext at time of request
  expiresAt: timestamp("expires_at").notNull(),  // 5 min from creation
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("chat_pending_tool_calls_expires_idx").on(table.expiresAt),
  index("chat_pending_tool_calls_thread_idx").on(table.threadId),
]);

// Lens 13 / Kareem §2: persistent Tier-3 cooldown ledger. Replaces the
// in-memory Map in server/services/founder-chat/executor.ts that did not
// survive Fly restarts. One row per (user_id, tool_name); last_confirmed_at
// is overwritten on each successful Tier-3 execution.
export const chatToolCooldowns = pgTable("chat_tool_cooldowns", {
  userId: text("user_id").notNull(),
  toolName: text("tool_name").notNull(),
  lastConfirmedAt: timestamp("last_confirmed_at").defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.toolName] }),
  index("chat_tool_cooldowns_last_confirmed_idx").on(table.lastConfirmedAt),
]);

export type ChatToolCooldown = typeof chatToolCooldowns.$inferSelect;
export type InsertChatToolCooldown = typeof chatToolCooldowns.$inferInsert;

// Founder Chat — sealed paste requests for secret rotation (Phase G/H/I batch 2).
// One-time-use tokens minted by `fly_secret_set`. The chat client POSTs the
// secret value to /api/founder/chat/secret-paste/:id; the value NEVER enters
// the LLM context or any audit row in plaintext (only a SHA-256 fingerprint
// is stored on the audit row).
export const chatSecretPasteRequests = pgTable("chat_secret_paste_requests", {
  id: text("id").primaryKey(),  // random 32-char hex
  founderUserId: text("founder_user_id").notNull(),
  toolName: text("tool_name").notNull(),  // e.g. "fly_secret_set"
  keyName: text("key_name").notNull(),    // the secret NAME (never the value)
  threadId: integer("thread_id").references(() => aiConversations.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at").notNull(),  // 5-min TTL
  consumedAt: timestamp("consumed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("chat_secret_paste_requests_expires_idx").on(table.expiresAt),
  index("chat_secret_paste_requests_founder_idx").on(table.founderUserId),
]);

export type ChatSecretPasteRequest = typeof chatSecretPasteRequests.$inferSelect;
export type InsertChatSecretPasteRequest = typeof chatSecretPasteRequests.$inferInsert;

// Founder Chat — background tasks (audits, long analyses, weekly letter gen).
// Outbox-backed; worker picks runnerKey + payload, runs, posts resultArtifact
// back to the thread as a chat message. parentTaskId allows sub-agent nesting
// (a parent Atlas turn can spawn an explore sub-agent whose own task tree
// nests under the parent).
export const founderChatBackgroundTasks: any = pgTable("founder_chat_background_tasks", {
  id: text("id").primaryKey(),  // random 32-char hex
  threadId: integer("thread_id").references(() => aiConversations.id, { onDelete: "cascade" }).notNull(),
  founderUserId: text("founder_user_id").notNull(),
  label: text("label").notNull(),  // human-readable, shown in background_task_card
  runnerKey: text("runner_key").notNull(),  // dispatches to a specific worker handler
  payload: jsonb("payload").notNull(),
  status: text("status").notNull().default("queued"),  // queued | running | complete | failed
  resultArtifact: jsonb("result_artifact"),
  error: text("error"),
  estimatedSeconds: integer("estimated_seconds"),
  parentTaskId: text("parent_task_id"),  // self-FK; null for top-level tasks
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("founder_chat_bg_tasks_thread_idx").on(table.threadId),
  index("founder_chat_bg_tasks_status_idx").on(table.status),
  index("founder_chat_bg_tasks_parent_idx").on(table.parentTaskId),
]);

// AI Messages - individual messages in conversations
export const aiMessages = pgTable("ai_messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").references(() => aiConversations.id, { onDelete: "cascade" }).notNull(),
  role: text("role").notNull(), // user, assistant, system
  content: text("content").notNull(),
  toolCalls: jsonb("tool_calls").$type<any[]>(),
  mentionedEntities: jsonb("mentioned_entities").$type<{ type: string; id: number; name: string; preview: string }[]>(),
  thinkingContent: text("thinking_content"),
  rating: integer("rating"), // 1 = thumbs up, -1 = thumbs down, null = no rating
  createdAt: timestamp("created_at").defaultNow(),
});

// ============================================
// AI VIRTUAL ASSISTANTS (Enhanced Agent System)
// ============================================

// VA Agent Registry - tracks each VA employee with their settings
export const vaAgents = pgTable("va_agents", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  agentType: text("agent_type").notNull(), 
  // executive, sales, acquisitions, marketing, collections, research
  name: text("name").notNull(),
  avatar: text("avatar"), // URL or lucide icon name
  description: text("description"),
  
  // Status & Activity
  isEnabled: boolean("is_enabled").notNull().default(true),
  isActive: boolean("is_active").notNull().default(false), // currently processing something
  lastActiveAt: timestamp("last_active_at"),
  
  // Behavior Settings
  autonomyLevel: text("autonomy_level").notNull().default("supervised"),
  // full_auto: takes action without asking
  // supervised: proposes actions, waits for approval on important ones
  // manual: only acts when explicitly asked
  
  // Agent-specific configuration
  config: jsonb("config").$type<{
    systemPrompt?: string;
    workingHours?: { start: string; end: string; timezone: string };
    responseDelay?: number; // minutes to wait before auto-responding
    maxActionsPerDay?: number;
    notifyOnAction?: boolean;
    autoApproveCategories?: string[]; // action categories that don't need approval
    escalateToHuman?: string[]; // triggers that should escalate to human
    customInstructions?: string;
  }>(),
  
  // Performance metrics
  metrics: jsonb("metrics").$type<{
    totalActions: number;
    successfulActions: number;
    pendingApproval: number;
    lastDayActions: number;
  }>(),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// VA Action Queue - tracks all proposed and completed actions
export const vaActions = pgTable("va_actions", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  agentId: integer("agent_id").references(() => vaAgents.id).notNull(),
  
  // Action details
  actionType: text("action_type").notNull(),
  // Common actions: send_email, send_sms, update_lead, create_offer, 
  // schedule_callback, propose_campaign, record_payment, send_reminder, etc.
  category: text("category").notNull(),
  // crm, marketing, finance, communication, research, admin
  
  title: text("title").notNull(),
  description: text("description"),
  
  // Status tracking
  status: text("status").notNull().default("proposed"),
  // proposed: waiting for approval
  // approved: ready to execute
  // executing: currently running
  // completed: successfully finished
  // failed: execution failed
  // rejected: user rejected the action
  // cancelled: cancelled before execution
  
  priority: integer("priority").notNull().default(5), // 1=urgent, 5=normal, 10=low
  
  // Action payload
  input: jsonb("input").notNull(), // parameters for the action
  output: jsonb("output"), // result of execution
  error: text("error"),
  
  // Related entities
  relatedLeadId: integer("related_lead_id").references(() => leads.id),
  relatedPropertyId: integer("related_property_id").references(() => properties.id),
  relatedNoteId: integer("related_note_id").references(() => notes.id),
  relatedCampaignId: integer("related_campaign_id").references(() => campaigns.id),
  
  // Approval tracking
  requiresApproval: boolean("requires_approval").notNull().default(true),
  approvedBy: text("approved_by"),
  approvedAt: timestamp("approved_at"),
  rejectionReason: text("rejection_reason"),
  
  // Timing
  scheduledFor: timestamp("scheduled_for"), // when to execute (for scheduled actions)
  executedAt: timestamp("executed_at"),
  executionTimeMs: integer("execution_time_ms"),
  
  // Context
  reasoning: text("reasoning"), // AI's explanation for why this action
  confidence: numeric("confidence"), // 0-100 confidence score
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// VA Daily Briefings - generated summaries and insights
export const vaBriefings = pgTable("va_briefings", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  
  briefingType: text("briefing_type").notNull(), // daily, weekly, monthly, alert
  title: text("title").notNull(),
  summary: text("summary").notNull(),
  
  // Sections of the briefing
  sections: jsonb("sections").$type<{
    title: string;
    content: string;
    priority: number;
    actionItems?: { text: string; actionId?: number }[];
  }[]>(),
  
  // Key metrics snapshot
  metrics: jsonb("metrics").$type<{
    newLeads: number;
    activeDeals: number;
    paymentsReceived: number;
    overduePayments: number;
    pendingActions: number;
    campaignsActive: number;
  }>(),
  
  // Recommended actions
  recommendations: jsonb("recommendations").$type<{
    text: string;
    priority: number;
    agentType: string;
    actionType?: string;
  }[]>(),
  
  readAt: timestamp("read_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

// VA Calendar Events - scheduled tasks and reminders
export const vaCalendarEvents = pgTable("va_calendar_events", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  agentId: integer("agent_id").references(() => vaAgents.id),
  
  eventType: text("event_type").notNull(),
  // callback, follow_up, campaign_launch, payment_due, task_deadline, review_needed
  
  title: text("title").notNull(),
  description: text("description"),
  
  // Timing
  startTime: timestamp("start_time").notNull(),
  endTime: timestamp("end_time"),
  allDay: boolean("all_day").default(false),
  
  // Recurrence
  recurring: boolean("recurring").default(false),
  recurrenceRule: text("recurrence_rule"), // iCal RRULE format
  
  // Related entities
  relatedLeadId: integer("related_lead_id").references(() => leads.id),
  relatedPropertyId: integer("related_property_id").references(() => properties.id),
  relatedActionId: integer("related_action_id").references(() => vaActions.id),
  
  // Status
  status: text("status").notNull().default("scheduled"),
  // scheduled, completed, cancelled, rescheduled
  completedAt: timestamp("completed_at"),
  
  // Notifications
  reminderMinutes: integer("reminder_minutes").default(30),
  reminded: boolean("reminded").default(false),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// VA Templates - reusable templates for common actions
export const vaTemplates = pgTable("va_templates", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  
  name: text("name").notNull(),
  category: text("category").notNull(), // email, sms, offer, campaign, document
  agentTypes: text("agent_types").array(), // which agents can use this template
  
  subject: text("subject"), // for emails
  content: text("content").notNull(),
  
  // Variables that can be substituted
  variables: jsonb("variables").$type<{
    name: string;
    description: string;
    defaultValue?: string;
  }[]>(),
  
  isActive: boolean("is_active").default(true),
  usageCount: integer("usage_count").default(0),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ============================================
// VA REPLACEMENT ENGINE (Dirt Rich 2 Methodology)
// ============================================

// Marketing Lists - imported lead lists for mail campaigns
export const marketingLists = pgTable("marketing_lists", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  
  name: text("name").notNull(),
  source: text("source").notNull(), // datatree, propstream, county_records, custom
  status: text("status").notNull().default("pending"), // pending, processing, ready, scrubbed, archived
  
  totalRecords: integer("total_records").default(0),
  validRecords: integer("valid_records").default(0),
  duplicatesRemoved: integer("duplicates_removed").default(0),
  invalidAddresses: integer("invalid_addresses").default(0),
  
  filters: jsonb("filters").$type<{
    states?: string[];
    counties?: string[];
    acreageMin?: number;
    acreageMax?: number;
    priceMin?: number;
    priceMax?: number;
    zoning?: string[];
    ownerType?: string[]; // individual, llc, trust, estate
    yearsOwned?: number;
    taxDelinquent?: boolean;
  }>(),
  
  uploadedFileName: text("uploaded_file_name"),
  scrubSettings: jsonb("scrub_settings").$type<{
    removeDuplicates: boolean;
    validateAddresses: boolean;
    skipExistingLeads: boolean;
    enrichParcelData: boolean;
  }>(),
  
  processedAt: timestamp("processed_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Offer Batches - bulk offer generation with pricing matrix
export const offerBatches = pgTable("offer_batches", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  
  name: text("name").notNull(),
  status: text("status").notNull().default("draft"), // draft, generating, ready, sent, archived
  
  // Pricing matrix
  pricingMatrix: jsonb("pricing_matrix").$type<{
    targetMargin: number; // e.g., 0.25 for 25% of market value
    minOfferAmount: number;
    maxOfferAmount: number;
    roundTo: number; // round to nearest $100, $500, $1000
    adjustments: {
      factor: string; // wetlands, flood_zone, road_access, utilities
      adjustment: number; // percentage to add/subtract
    }[];
  }>().notNull(),
  
  // Terms for seller financing offers
  termsConfig: jsonb("terms_config").$type<{
    downPaymentPercent: number;
    interestRate: number;
    termMonths: number;
    documentFee: number;
  }>(),
  
  // Source filters
  sourceListId: integer("source_list_id").references(() => marketingLists.id),
  leadFilters: jsonb("lead_filters").$type<{
    status?: string[];
    source?: string[];
    states?: string[];
    counties?: string[];
    acreageMin?: number;
    acreageMax?: number;
  }>(),
  
  totalOffers: integer("total_offers").default(0),
  offersGenerated: integer("offers_generated").default(0),
  offersSent: integer("offers_sent").default(0),
  offersAccepted: integer("offers_accepted").default(0),
  
  generatedAt: timestamp("generated_at"),
  sentAt: timestamp("sent_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Individual offers within a batch
export const offers = pgTable("offers", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  batchId: integer("batch_id").references(() => offerBatches.id),
  leadId: integer("lead_id").references(() => leads.id),
  propertyId: integer("property_id").references(() => properties.id),
  
  status: text("status").notNull().default("draft"), // draft, approved, sent, viewed, accepted, rejected, expired, countered
  
  // Offer amounts
  cashOffer: numeric("cash_offer"),
  termsOffer: numeric("terms_offer"),
  downPayment: numeric("down_payment"),
  monthlyPayment: numeric("monthly_payment"),
  interestRate: numeric("interest_rate"),
  termMonths: integer("term_months"),
  
  // Calculated values
  estimatedMarketValue: numeric("estimated_market_value"),
  offerPercentage: numeric("offer_percentage"), // percentage of market value
  
  // Seller response
  counterOffer: numeric("counter_offer"),
  /**
   * The DecisionSnapshot that produced this offer, when one was recorded.
   *
   * Deliberately a plain integer with NO foreign key. `offers.organization_id`
   * does not cascade while `decision_snapshots.organization_id` does, so a real
   * FK would create a delete-ordering hazard: pruning a tenant would remove the
   * snapshots and then fail on the offers still pointing at them. The read path
   * resolves it through the org-scoped `getDecision`, so a stale or foreign id
   * simply yields nothing rather than leaking or crashing.
   *
   * Null is the normal state for every offer not drafted through the
   * fix-and-flip analyzer, and for one whose reasoning failed to record.
   */
  decisionSnapshotId: integer("decision_snapshot_id"),
  sellerNotes: text("seller_notes"),
  respondedAt: timestamp("responded_at"),
  
  // Tracking
  sentAt: timestamp("sent_at"),
  viewedAt: timestamp("viewed_at"),
  expiresAt: timestamp("expires_at"),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Seller Communications - track all seller interactions
export const sellerCommunications = pgTable("seller_communications", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  leadId: integer("lead_id").references(() => leads.id).notNull(),
  propertyId: integer("property_id").references(() => properties.id),
  offerId: integer("offer_id").references(() => offers.id),
  
  channel: text("channel").notNull(), // email, sms, call, mail, facebook
  direction: text("direction").notNull(), // inbound, outbound
  
  subject: text("subject"),
  content: text("content").notNull(),
  
  // For calls
  callDuration: integer("call_duration"), // seconds
  callNotes: text("call_notes"),
  callOutcome: text("call_outcome"), // interested, not_interested, callback, voicemail, wrong_number
  
  // For mail
  trackingNumber: text("tracking_number"),
  deliveryStatus: text("delivery_status"), // pending, sent, delivered, returned
  
  // Sentiment analysis
  sentiment: text("sentiment"), // positive, neutral, negative
  urgencyScore: integer("urgency_score"), // 1-10
  
  // AI-generated flag
  aiGenerated: boolean("ai_generated").default(false),
  aiAgentId: integer("ai_agent_id").references(() => vaAgents.id),
  
  createdAt: timestamp("created_at").defaultNow(),
});

// Ad Postings - multi-platform marketing ads
export const adPostings = pgTable("ad_postings", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  propertyId: integer("property_id").references(() => properties.id).notNull(),
  
  platform: text("platform").notNull(), // facebook, craigslist, lands_of_america, land_watch, zillow, land_com
  status: text("status").notNull().default("draft"), // draft, scheduled, posted, active, expired, removed
  
  // Ad content
  title: text("title").notNull(),
  description: text("description").notNull(),
  headline: text("headline"),
  storyContent: text("story_content"), // Narrative story-style ad copy
  
  // Pricing
  listingPrice: numeric("listing_price").notNull(),
  termsPrice: numeric("terms_price"),
  downPayment: numeric("down_payment"),
  monthlyPayment: numeric("monthly_payment"),
  
  // Media
  imageUrls: text("image_urls").array(),
  videoUrl: text("video_url"),
  
  // Platform-specific
  externalListingId: text("external_listing_id"),
  externalUrl: text("external_url"),
  
  // Performance
  views: integer("views").default(0),
  inquiries: integer("inquiries").default(0),
  clicks: integer("clicks").default(0),
  
  // AI-generated
  aiGenerated: boolean("ai_generated").default(false),
  
  postedAt: timestamp("posted_at"),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Buyer Prequalifications - scoring and qualifying buyers
export const buyerPrequalifications = pgTable("buyer_prequalifications", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  leadId: integer("lead_id").references(() => leads.id).notNull(),
  propertyId: integer("property_id").references(() => properties.id),
  
  status: text("status").notNull().default("pending"), // pending, qualified, disqualified, needs_info
  
  // Basic info
  intendedUse: text("intended_use"), // residential, recreation, investment, farming
  budgetMin: numeric("budget_min"),
  budgetMax: numeric("budget_max"),
  prefersCash: boolean("prefers_cash").default(false),
  prefersTerms: boolean("prefers_terms").default(false),
  
  // Financial qualification
  downPaymentAvailable: numeric("down_payment_available"),
  monthlyPaymentCapacity: numeric("monthly_payment_capacity"),
  employmentStatus: text("employment_status"), // employed, self_employed, retired, other
  creditRangeReported: text("credit_range_reported"), // excellent, good, fair, poor
  
  // Scoring
  qualificationScore: integer("qualification_score"), // 1-100
  scoreFactors: jsonb("score_factors").$type<{
    factor: string;
    score: number;
    notes: string;
  }[]>(),
  
  // Follow-up
  lastContactAt: timestamp("last_contact_at"),
  nextFollowUpAt: timestamp("next_follow_up_at"),
  followUpNotes: text("follow_up_notes"),
  
  // AI assessment
  aiAssessment: text("ai_assessment"),
  aiRecommendation: text("ai_recommendation"), // proceed, more_info, decline
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Collection Sequences - automated payment reminder sequences
export const collectionSequences = pgTable("collection_sequences", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  
  name: text("name").notNull(),
  description: text("description"),
  isActive: boolean("is_active").default(true),
  isDefault: boolean("is_default").default(false),
  
  // Sequence steps
  steps: jsonb("steps").$type<{
    stepNumber: number;
    daysAfterDue: number; // negative = before due, positive = after due
    channel: "email" | "sms" | "call" | "mail";
    templateId?: number;
    subject?: string;
    content?: string;
    escalationLevel: "reminder" | "warning" | "urgent" | "final";
  }[]>().notNull(),
  
  // Automation settings
  autoStart: boolean("auto_start").default(true), // automatically start sequence when payment becomes overdue
  pauseOnPayment: boolean("pause_on_payment").default(true),
  pauseOnContact: boolean("pause_on_contact").default(false),
  
  // Metrics
  totalEnrolled: integer("total_enrolled").default(0),
  paymentsRecovered: integer("payments_recovered").default(0),
  totalRecoveredAmount: numeric("total_recovered_amount").default("0"),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Collection enrollments - notes enrolled in collection sequences
export const collectionEnrollments = pgTable("collection_enrollments", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  sequenceId: integer("sequence_id").references(() => collectionSequences.id).notNull(),
  noteId: integer("note_id").references(() => notes.id).notNull(),
  paymentId: integer("payment_id"), // specific overdue payment if applicable
  
  status: text("status").notNull().default("active"), // active, paused, completed, cancelled
  currentStep: integer("current_step").default(0),
  
  // Tracking
  startedAt: timestamp("started_at").notNull().defaultNow(),
  lastStepAt: timestamp("last_step_at"),
  nextStepAt: timestamp("next_step_at"),
  completedAt: timestamp("completed_at"),
  
  // Outcome
  outcome: text("outcome"), // paid, partial_paid, no_response, escalated, cancelled
  amountRecovered: numeric("amount_recovered").default("0"),
  
  // History
  stepHistory: jsonb("step_history").$type<{
    step: number;
    executedAt: string;
    channel: string;
    result: string;
  }[]>(),
  
  createdAt: timestamp("created_at").defaultNow(),
});

// County Research Cache - cached research results for counties
export const countyResearch = pgTable("county_research", {
  id: serial("id").primaryKey(),
  
  state: text("state").notNull(),
  county: text("county").notNull(),
  
  // Contact info
  assessorPhone: text("assessor_phone"),
  assessorEmail: text("assessor_email"),
  assessorWebsite: text("assessor_website"),
  recorderPhone: text("recorder_phone"),
  recorderEmail: text("recorder_email"),
  recorderWebsite: text("recorder_website"),
  treasurerPhone: text("treasurer_phone"),
  treasurerEmail: text("treasurer_email"),
  treasurerWebsite: text("treasurer_website"),
  
  // GIS info
  gisPortalUrl: text("gis_portal_url"),
  gisApiEndpoint: text("gis_api_endpoint"),
  hasOnlineMaps: boolean("has_online_maps").default(false),
  
  // Fees and processes
  transferTax: numeric("transfer_tax"),
  recordingFee: numeric("recording_fee"),
  titleSearchCost: numeric("title_search_cost"),
  closingProcess: text("closing_process"),
  
  // Market data
  medianLandPrice: numeric("median_land_price"),
  avgDaysOnMarket: integer("avg_days_on_market"),
  salesVolumeLast12Mo: integer("sales_volume_last_12mo"),
  
  // AI-gathered insights
  marketNotes: text("market_notes"),
  investorFriendly: boolean("investor_friendly"),
  competitionLevel: text("competition_level"), // low, medium, high
  
  // Freshness
  lastUpdatedAt: timestamp("last_updated_at").defaultNow(),
  dataSource: text("data_source"), // manual, ai_research, api
  
  createdAt: timestamp("created_at").defaultNow(),
});

// Insert schemas for VA Replacement Engine tables
export const insertMarketingListSchema = createInsertSchema(marketingLists).omit({ id: true, createdAt: true, updatedAt: true });
export const insertOfferBatchSchema = createInsertSchema(offerBatches).omit({ id: true, createdAt: true, updatedAt: true });
export const insertOfferSchema = createInsertSchema(offers).omit({ id: true, createdAt: true, updatedAt: true });
export const insertSellerCommunicationSchema = createInsertSchema(sellerCommunications).omit({ id: true, createdAt: true });
export const insertAdPostingSchema = createInsertSchema(adPostings).omit({ id: true, createdAt: true, updatedAt: true });
export const insertBuyerPrequalificationSchema = createInsertSchema(buyerPrequalifications).omit({ id: true, createdAt: true, updatedAt: true });
export const insertCollectionSequenceSchema = createInsertSchema(collectionSequences).omit({ id: true, createdAt: true, updatedAt: true });
export const insertCollectionEnrollmentSchema = createInsertSchema(collectionEnrollments).omit({ id: true, createdAt: true });
export const insertCountyResearchSchema = createInsertSchema(countyResearch).omit({ id: true, createdAt: true });

// Type exports for VA Replacement Engine
export type MarketingList = typeof marketingLists.$inferSelect;
export type InsertMarketingList = z.infer<typeof insertMarketingListSchema>;

export type OfferBatch = typeof offerBatches.$inferSelect;
export type InsertOfferBatch = z.infer<typeof insertOfferBatchSchema>;

export type Offer = typeof offers.$inferSelect;
export type InsertOffer = z.infer<typeof insertOfferSchema>;

export type SellerCommunication = typeof sellerCommunications.$inferSelect;
export type InsertSellerCommunication = z.infer<typeof insertSellerCommunicationSchema>;

export type AdPosting = typeof adPostings.$inferSelect;
export type InsertAdPosting = z.infer<typeof insertAdPostingSchema>;

export type BuyerPrequalification = typeof buyerPrequalifications.$inferSelect;
export type InsertBuyerPrequalification = z.infer<typeof insertBuyerPrequalificationSchema>;

export type CollectionSequence = typeof collectionSequences.$inferSelect;
export type InsertCollectionSequence = z.infer<typeof insertCollectionSequenceSchema>;

export type CollectionEnrollment = typeof collectionEnrollments.$inferSelect;
export type InsertCollectionEnrollment = z.infer<typeof insertCollectionEnrollmentSchema>;

export type CountyResearch = typeof countyResearch.$inferSelect;
export type InsertCountyResearch = z.infer<typeof insertCountyResearchSchema>;

// ============================================
// RELATIONS
// ============================================

export const organizationsRelations = relations(organizations, ({ many }) => ({
  teamMembers: many(teamMembers),
  leads: many(leads),
  properties: many(properties),
  notes: many(notes),
  campaigns: many(campaigns),
  // Lavender §1 / Hilda §2 — accounting foundation
  chartOfAccounts: many(chartOfAccounts),
  ledgerEntries: many(accountLedgerEntries),
}));

export const propertiesRelations = relations(properties, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [properties.organizationId],
    references: [organizations.id],
  }),
  seller: one(leads, {
    fields: [properties.sellerId],
    references: [leads.id],
  }),
  notes: many(notes),
  deals: many(deals),
}));

export const notesRelations = relations(notes, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [notes.organizationId],
    references: [organizations.id],
  }),
  property: one(properties, {
    fields: [notes.propertyId],
    references: [properties.id],
  }),
  borrower: one(leads, {
    fields: [notes.borrowerId],
    references: [leads.id],
  }),
  payments: many(payments),
}));

export const paymentsRelations = relations(payments, ({ one }) => ({
  note: one(notes, {
    fields: [payments.noteId],
    references: [notes.id],
  }),
}));

export const leadsRelations = relations(leads, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [leads.organizationId],
    references: [organizations.id],
  }),
  activities: many(leadActivities),
  conversations: many(conversations),
}));

// ============================================
// INSERT SCHEMAS
// ============================================

export const insertOrganizationSchema = createInsertSchema(organizations).omit({ 
  id: true, createdAt: true, updatedAt: true 
});
export const insertTeamMemberSchema = createInsertSchema(teamMembers).omit({ 
  id: true, invitedAt: true, joinedAt: true 
});
// F-D34 (2026-05-21): every insert schema below omits `organizationId` so the
// safe pattern (server-side injection via `{ ...body, organizationId: org.id }`)
// is enforced by the schema, not just convention. A misbehaving caller can no
// longer mass-assign organizationId in the request body to write into another
// org's data.
export const insertLeadSchema = createInsertSchema(leads).omit({
  id: true, createdAt: true, updatedAt: true, lastScoreAt: true,
  organizationId: true,
  // phoneNormalized is a STORED generated column — Postgres rejects
  // explicit writes. Omit from inserts. (Migration 0051.)
  phoneNormalized: true,
}).extend({
  // F-D23: drizzle-zod treats text columns as bare z.string() — invalid
  // emails like "not-an-email" sailed through to the DB. Tighten to email
  // format (still optional since the column is nullable for callers who
  // only have a phone or just a parcel-owner name). An untouched form field
  // arrives as "" — that's an absent email, not an invalid one (WS1,
  // 2026-07-07): coerce to null instead of 422ing the whole lead.
  email: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z.string().email().optional().nullable(),
  ),
});
export const insertLeadActivitySchema = createInsertSchema(leadActivities).omit({
  id: true, createdAt: true,
});
export const insertPropertySchema = createInsertSchema(properties).omit({
  id: true, createdAt: true, updatedAt: true, organizationId: true,
});
export const insertDealSchema = createInsertSchema(deals).omit({
  id: true, createdAt: true, updatedAt: true, organizationId: true,
});
export const insertNoteSchema = createInsertSchema(notes).omit({ 
  id: true, createdAt: true, updatedAt: true 
});
export const insertPaymentSchema = createInsertSchema(payments).omit({ 
  id: true, createdAt: true 
});
export const insertCampaignSchema = createInsertSchema(campaigns).omit({ 
  id: true, createdAt: true, updatedAt: true 
});
export const insertAgentConfigSchema = createInsertSchema(agentConfigs).omit({ 
  id: true, createdAt: true, updatedAt: true 
});
export const insertAgentTaskSchema = createInsertSchema(agentTasks).omit({ 
  id: true, createdAt: true, startedAt: true, completedAt: true 
});
export const insertAgentRunSchema = createInsertSchema(agentRuns).omit({ 
  id: true 
});
export const insertConversationSchema = createInsertSchema(conversations).omit({ 
  id: true, createdAt: true 
});
export const insertMessageSchema = createInsertSchema(messages).omit({ 
  id: true, createdAt: true 
});

// Usage Metering & Credits
export const insertUsageRecordSchema = createInsertSchema(usageRecords).omit({ 
  id: true, createdAt: true 
});
export const insertCreditTransactionSchema = createInsertSchema(creditTransactions).omit({ 
  id: true, createdAt: true 
});
export const insertUsageRateSchema = createInsertSchema(usageRates).omit({ 
  id: true, updatedAt: true 
});

// AI Command Center
export const insertAiAgentProfileSchema = createInsertSchema(aiAgentProfiles).omit({ id: true });
export const insertAiToolDefinitionSchema = createInsertSchema(aiToolDefinitions).omit({ id: true });
export const insertAiExecutionRunSchema = createInsertSchema(aiExecutionRuns).omit({ id: true });
export const insertAiMemorySchema = createInsertSchema(aiMemory).omit({ id: true });

export const insertAiConversationSchema = createInsertSchema(aiConversations).omit({ id: true });
export const insertAiMessageSchema = createInsertSchema(aiMessages).omit({ id: true });

// VA (Virtual Assistant) System
export const insertVaAgentSchema = createInsertSchema(vaAgents).omit({ 
  id: true, createdAt: true, updatedAt: true 
});
export const insertVaActionSchema = createInsertSchema(vaActions).omit({ 
  id: true, createdAt: true, updatedAt: true 
});
export const insertVaBriefingSchema = createInsertSchema(vaBriefings).omit({ 
  id: true, createdAt: true 
});
export const insertVaCalendarEventSchema = createInsertSchema(vaCalendarEvents).omit({ 
  id: true, createdAt: true, updatedAt: true 
});
export const insertVaTemplateSchema = createInsertSchema(vaTemplates).omit({ 
  id: true, createdAt: true, updatedAt: true 
});

// ============================================
// PROVIDER CACHE
// ============================================

export const providerCache = pgTable("provider_cache", {
  id: serial("id").primaryKey(),
  provider: text("provider").notNull(),
  category: text("category").notNull(),
  cacheKey: text("cache_key").notNull().unique(),
  responseData: jsonb("response_data").notNull(),
  costCents: integer("cost_cents").notNull().default(0),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_provider_cache_key").on(table.cacheKey),
  index("idx_provider_cache_expires").on(table.expiresAt),
  index("idx_provider_cache_provider_category").on(table.provider, table.category),
]);

export type ProviderCache = typeof providerCache.$inferSelect;

// ============================================
// TEMPORAL SPINE — OPEN-DATA CHANGE EVENTS
// ============================================
//
// Ruling #9 wave 3 (docs/company/founder-decisions-2026-07-28.md): open data
// becomes EVENTS. When a refreshed lookup materially differs from what we
// previously knew for the same place, that change is itself intelligence
// ("FEMA redrew the map under this parcel") and is durably recorded here.
//
// scopeType/scopeRef contract (siblings build against exactly this):
//   point  → scopeRef = "lat,lng" rounded to 4 decimal places
//   county → scopeRef = "ST/countyslug"
// previousValue/newValue are always REAL previously-observed values —
// null→value (first sight) and value→null (lookup gap) are never recorded
// as changes. narrative is one plain-words sentence built only from the two
// real values. Diff/materiality rules live in
// server/services/openData/changeDetection.ts.
export const openDataChangeEvents = pgTable("open_data_change_events", {
  id: serial("id").primaryKey(),
  // LookupCategory value (e.g. "flood_zone") or county-signal key.
  category: text("category").notNull(),
  scopeType: text("scope_type").notNull(), // "point" | "county"
  scopeRef: text("scope_ref").notNull(),
  field: text("field").notNull(),
  previousValue: text("previous_value").notNull(),
  newValue: text("new_value").notNull(),
  // When the PREVIOUS knowledge was as-of (source freshness if known, else
  // when we cached it). Null when neither is known.
  previousAsOf: timestamp("previous_as_of"),
  detectedAt: timestamp("detected_at").defaultNow().notNull(),
  // The instrument name, e.g. "FEMA NFHL", "USDA SSURGO".
  source: text("source").notNull(),
  severity: text("severity").notNull(), // "info" | "notable"
  narrative: text("narrative").notNull(),
}, (table) => [
  index("idx_odce_scope_detected").on(table.scopeType, table.scopeRef, table.detectedAt),
]);

export type OpenDataChangeEvent = typeof openDataChangeEvents.$inferSelect;
export type InsertOpenDataChangeEvent = typeof openDataChangeEvents.$inferInsert;

// ============================================
// PILLAR 6 — CROSS-CUSTOMER DATA CACHE
// ============================================
//
// Shared cache for paid third-party data lookups (skip-trace, parcel
// ownership, AVM, flood-zone, liens, …). When customer A pays the provider
// to look up a record, customer B looking up the same record gets the
// cached result for free (cost-cents-charged = 0) until freshnessHours
// expires. The per-org savings are summed via cachedLookupHits.
//
// The query is identified by a deterministic SHA-256 fingerprint of the
// normalized input (lowercased addresses, trimmed names, …) so the same
// physical fact lookup collapses to a single cache row regardless of
// caller. UNIQUE(provider, entityType, queryFingerprint) prevents
// duplicate rows.

export const cachedLookups = pgTable("cached_lookups", {
  id: serial("id").primaryKey(),
  // Provider that originally produced the result. Examples:
  //   "batch_skiptrace", "reiskip", "regrid", "attom", "batchdata",
  //   "county_gis_<county>", "fema_nfhl", "usfws_nwi", "census".
  provider: text("provider").notNull(),
  // Type of fact cached. See TTL_BY_ENTITY_TYPE in
  // server/services/data-cache/lookup-cache.ts for the canonical list.
  entityType: text("entity_type").notNull(),
  // SHA-256 of normalized query payload. See normalizeQuery().
  queryFingerprint: text("query_fingerprint").notNull(),
  // The provider response, stored verbatim so any consumer can re-parse.
  resultJson: jsonb("result_json").notNull(),
  // TTL in hours used to compute freshness. Stored per-row so the policy
  // can evolve without invalidating historical rows.
  freshnessHours: integer("freshness_hours").notNull(),
  // First fetch — origin of truth.
  firstFetchedAt: timestamp("first_fetched_at").notNull().defaultNow(),
  firstFetchedBy: integer("first_fetched_by").references(() => organizations.id),
  // Hit counter — incremented on every cache-served read (across orgs).
  hits: integer("hits").notNull().default(0),
  lastHitAt: timestamp("last_hit_at"),
  // Original cost in cents. Used for "you saved $X" analytics.
  costCents: integer("cost_cents").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("cached_lookups_fingerprint_uidx").on(
    table.provider,
    table.entityType,
    table.queryFingerprint,
  ),
  index("cached_lookups_entity_type_idx").on(table.entityType),
  index("cached_lookups_first_fetched_at_idx").on(table.firstFetchedAt),
]);

export type CachedLookup = typeof cachedLookups.$inferSelect;
export type InsertCachedLookup = typeof cachedLookups.$inferInsert;

// Per-hit log. Same org hitting the same cache row twice writes TWO rows
// (it's a counter, not a dedupe). Drives "you saved $X this month" + the
// cross-customer cache-hit-rate dashboard.
export const cachedLookupHits = pgTable("cached_lookup_hits", {
  id: serial("id").primaryKey(),
  cachedLookupId: integer("cached_lookup_id")
    .references(() => cachedLookups.id, { onDelete: "cascade" })
    .notNull(),
  organizationId: integer("organization_id")
    .references(() => organizations.id, { onDelete: "cascade" })
    .notNull(),
  hitAt: timestamp("hit_at").notNull().defaultNow(),
}, (table) => [
  index("cached_lookup_hits_lookup_hit_at_idx").on(table.cachedLookupId, table.hitAt),
  index("cached_lookup_hits_org_hit_at_idx").on(table.organizationId, table.hitAt),
]);

export type CachedLookupHit = typeof cachedLookupHits.$inferSelect;
export type InsertCachedLookupHit = typeof cachedLookupHits.$inferInsert;

// ============================================
// CUSTOM AUTONOMY RULES
// ============================================

// Natural language rules for agent autonomy (e.g., "Never auto-email California leads")
export const customAutonomyRules = pgTable("custom_autonomy_rules", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  ruleText: text("rule_text").notNull(),
  ruleType: text("rule_type").notNull().default("scope"), // scope, temporal
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
  expiresAt: timestamp("expires_at"), // nullable — null means never expires
}, (table) => [
  index("idx_autonomy_rules_org").on(table.organizationId),
  index("idx_autonomy_rules_active").on(table.organizationId, table.isActive),
]);

export const insertCustomAutonomyRuleSchema = createInsertSchema(customAutonomyRules).omit({
  id: true,
  createdAt: true,
});

export type CustomAutonomyRule = typeof customAutonomyRules.$inferSelect;
export type InsertCustomAutonomyRule = z.infer<typeof insertCustomAutonomyRuleSchema>;

// ============================================
// TYPE EXPORTS
// ============================================

// Organizations
export type Organization = typeof organizations.$inferSelect;
export type InsertOrganization = z.infer<typeof insertOrganizationSchema>;

// Team Members
export type TeamMember = typeof teamMembers.$inferSelect;
export type InsertTeamMember = z.infer<typeof insertTeamMemberSchema>;

// Leads
export type Lead = typeof leads.$inferSelect;
export type InsertLead = z.infer<typeof insertLeadSchema>;

// Lead Activities
export type LeadActivity = typeof leadActivities.$inferSelect;
export type InsertLeadActivity = z.infer<typeof insertLeadActivitySchema>;

// Nurturing Stage Type
export type NurturingStage = "hot" | "warm" | "cold" | "dead" | "new";

// Properties
export type Property = typeof properties.$inferSelect;
export type InsertProperty = z.infer<typeof insertPropertySchema>;

// Indian-Country land status (Aniyah §2 — 25 USC §177, 25 CFR §152).
// Trust and restricted-fee parcels require BIA approval for any title transfer;
// fee-simple parcels follow standard alienability rules. 'unknown' means the
// status has not been verified by a human and auto-actions must be blocked.
export const LAND_STATUS_VALUES = [
  "fee",                    // Standard fee-simple — alienability rules apply normally
  "tribal_trust",           // Held in trust by US for a tribe (25 USC §177)
  "individual_trust",       // Held in trust by US for an individual Indian (allotment)
  "restricted_fee",         // Owned by Indian individual/tribe, alienation restricted
  "fee_within_reservation", // Fee-simple parcel inside reservation boundaries (still tribal-jurisdiction concerns)
  "off_reservation_trust",  // Trust land outside reservation boundaries
  "unknown",                // Not yet verified — auto-actions blocked
] as const;
export type LandStatus = (typeof LAND_STATUS_VALUES)[number];
export const landStatusSchema = z.enum(LAND_STATUS_VALUES);


// Deals
export type Deal = typeof deals.$inferSelect;
export type InsertDeal = z.infer<typeof insertDealSchema>;

// Notes
export type Note = typeof notes.$inferSelect;
export type InsertNote = z.infer<typeof insertNoteSchema>;

// Payments
export type Payment = typeof payments.$inferSelect;
export type InsertPayment = z.infer<typeof insertPaymentSchema>;

// Campaigns
export type Campaign = typeof campaigns.$inferSelect;
export type InsertCampaign = z.infer<typeof insertCampaignSchema>;

// Agent Configs
export type AgentConfig = typeof agentConfigs.$inferSelect;
export type InsertAgentConfig = z.infer<typeof insertAgentConfigSchema>;

// Agent Tasks
export type AgentTask = typeof agentTasks.$inferSelect;
export type InsertAgentTask = z.infer<typeof insertAgentTaskSchema>;

// Agent Runs (background agent status)
export type AgentRun = typeof agentRuns.$inferSelect;
export type InsertAgentRun = z.infer<typeof insertAgentRunSchema>;

// Conversations
export type Conversation = typeof conversations.$inferSelect;
export type InsertConversation = z.infer<typeof insertConversationSchema>;

// Messages
export type Message = typeof messages.$inferSelect;
export type InsertMessage = z.infer<typeof insertMessageSchema>;

// Activity Log
export type ActivityLogEntry = typeof activityLog.$inferSelect;

// Usage Events
export type UsageEvent = typeof usageEvents.$inferSelect;

// Usage Records
export type UsageRecord = typeof usageRecords.$inferSelect;
export type InsertUsageRecord = z.infer<typeof insertUsageRecordSchema>;

// Credit Transactions
export type CreditTransaction = typeof creditTransactions.$inferSelect;
export type InsertCreditTransaction = z.infer<typeof insertCreditTransactionSchema>;

// Usage Rates
export type UsageRate = typeof usageRates.$inferSelect;
export type InsertUsageRate = z.infer<typeof insertUsageRateSchema>;

// AI Agent Profiles
export type AiAgentProfile = typeof aiAgentProfiles.$inferSelect;
export type InsertAiAgentProfile = z.infer<typeof insertAiAgentProfileSchema>;

// AI Tool Definitions
export type AiToolDefinition = typeof aiToolDefinitions.$inferSelect;
export type InsertAiToolDefinition = z.infer<typeof insertAiToolDefinitionSchema>;

// AI Execution Runs
export type AiExecutionRun = typeof aiExecutionRuns.$inferSelect;
export type InsertAiExecutionRun = z.infer<typeof insertAiExecutionRunSchema>;

// AI Memory
export type AiMemory = typeof aiMemory.$inferSelect;
export type InsertAiMemory = z.infer<typeof insertAiMemorySchema>;

export type AiConversation = typeof aiConversations.$inferSelect;
export type InsertAiConversation = z.infer<typeof insertAiConversationSchema>;

export type AiMessage = typeof aiMessages.$inferSelect;
export type InsertAiMessage = z.infer<typeof insertAiMessageSchema>;

// VA (Virtual Assistant) System
export type VaAgent = typeof vaAgents.$inferSelect;
export type InsertVaAgent = z.infer<typeof insertVaAgentSchema>;

export type VaAction = typeof vaActions.$inferSelect;
export type InsertVaAction = z.infer<typeof insertVaActionSchema>;

export type VaBriefing = typeof vaBriefings.$inferSelect;
export type InsertVaBriefing = z.infer<typeof insertVaBriefingSchema>;

export type VaCalendarEvent = typeof vaCalendarEvents.$inferSelect;
export type InsertVaCalendarEvent = z.infer<typeof insertVaCalendarEventSchema>;

export type VaTemplate = typeof vaTemplates.$inferSelect;
export type InsertVaTemplate = z.infer<typeof insertVaTemplateSchema>;

// VA Agent Types
export type VaAgentType = "executive" | "sales" | "acquisitions" | "marketing" | "collections" | "research";
export type VaAutonomyLevel = "full_auto" | "supervised" | "manual";
export type VaActionStatus = "proposed" | "approved" | "executing" | "completed" | "failed" | "rejected" | "cancelled";

// ============================================
// DUE DILIGENCE CHECKLISTS
// ============================================

// Checklist item type for templates
export type DueDiligenceChecklistItem = {
  id: string;
  category: string;
  name: string;
  description?: string;
  required: boolean;
};

// Due diligence templates
export const dueDiligenceTemplates = pgTable("due_diligence_templates", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  name: text("name").notNull(),
  items: jsonb("items").$type<DueDiligenceChecklistItem[]>().notNull(),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

// Due diligence items for tracking completion on individual properties
export const dueDiligenceItems = pgTable("due_diligence_items", {
  id: serial("id").primaryKey(),
  propertyId: integer("property_id").references(() => properties.id).notNull(),
  templateId: integer("template_id").references(() => dueDiligenceTemplates.id),
  itemName: text("item_name").notNull(),
  category: text("category").notNull(),
  completed: boolean("completed").notNull().default(false),
  completedBy: text("completed_by"), // user ID who completed
  completedAt: timestamp("completed_at"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Insert schemas
export const insertDueDiligenceTemplateSchema = createInsertSchema(dueDiligenceTemplates).omit({ id: true, createdAt: true });
export const insertDueDiligenceItemSchema = createInsertSchema(dueDiligenceItems).omit({ id: true, createdAt: true });

// Types
export type DueDiligenceTemplate = typeof dueDiligenceTemplates.$inferSelect;
export type InsertDueDiligenceTemplate = z.infer<typeof insertDueDiligenceTemplateSchema>;
export type DueDiligenceItem = typeof dueDiligenceItems.$inferSelect;
export type InsertDueDiligenceItem = z.infer<typeof insertDueDiligenceItemSchema>;

// Default templates for real estate due diligence
export const DEFAULT_DUE_DILIGENCE_TEMPLATES = [
  {
    name: "Standard Land Due Diligence",
    items: [
      { id: "title-1", category: "Title Search", name: "Clear title verified", description: "Confirm property has clear title with no disputes", required: true },
      { id: "title-2", category: "Title Search", name: "No liens on property", description: "Check for any outstanding liens", required: true },
      { id: "title-3", category: "Title Search", name: "No encumbrances", description: "Verify no restrictive encumbrances", required: true },
      { id: "title-4", category: "Title Search", name: "Back taxes paid", description: "Confirm all property taxes are current", required: true },
      { id: "physical-1", category: "Physical", name: "Access road verified", description: "Legal access to property confirmed", required: true },
      { id: "physical-2", category: "Physical", name: "Utilities available", description: "Check availability of electric, water, sewer", required: false },
      { id: "physical-3", category: "Physical", name: "Topography assessed", description: "Evaluate terrain and buildability", required: false },
      { id: "physical-4", category: "Physical", name: "Flood zone check", description: "Verify FEMA flood zone status", required: true },
      { id: "physical-5", category: "Physical", name: "Environmental review", description: "Check for environmental issues or wetlands", required: true },
      { id: "legal-1", category: "Legal", name: "Zoning verified", description: "Confirm current zoning and allowed uses", required: true },
      { id: "legal-2", category: "Legal", name: "Restrictions reviewed", description: "Check deed restrictions and HOA rules", required: false },
      { id: "legal-3", category: "Legal", name: "Easements identified", description: "Locate and review all easements", required: true },
      { id: "legal-4", category: "Legal", name: "Mineral rights confirmed", description: "Verify mineral rights status", required: false },
      { id: "financial-1", category: "Financial", name: "Tax assessment reviewed", description: "Review current tax assessment value", required: true },
      { id: "financial-2", category: "Financial", name: "Market comps analyzed", description: "Compare to recent sales in area", required: true },
      { id: "financial-3", category: "Financial", name: "ROI calculation completed", description: "Calculate expected return on investment", required: false },
    ],
  },
] as const;

// ============================================
// DEAL CHECKLISTS (Stage Gate Due Diligence)
// ============================================

// Type for checklist template items
export type ChecklistTemplateItem = {
  id: string;
  title: string;
  description?: string;
  required: boolean;
  documentRequired: boolean;
};

// Type for deal checklist items (includes completion state)
export type DealChecklistItem = {
  id: string;
  title: string;
  description?: string;
  required: boolean;
  documentRequired: boolean;
  checkedAt?: string;
  checkedBy?: string;
  documentUrl?: string;
};

// Checklist templates table
export const checklistTemplates = pgTable("checklist_templates", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  name: text("name").notNull(),
  description: text("description"),
  dealType: text("deal_type").notNull().default("all"), // cash, terms, wholesale, all
  items: jsonb("items").$type<ChecklistTemplateItem[]>().notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Deal checklists table (applied to specific deals)
export const dealChecklists = pgTable("deal_checklists", {
  id: serial("id").primaryKey(),
  dealId: integer("deal_id").references(() => deals.id).notNull(),
  templateId: integer("template_id").references(() => checklistTemplates.id),
  items: jsonb("items").$type<DealChecklistItem[]>().notNull(),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Insert schemas
export const insertChecklistTemplateSchema = createInsertSchema(checklistTemplates).omit({ id: true, createdAt: true, updatedAt: true });
export const insertDealChecklistSchema = createInsertSchema(dealChecklists).omit({ id: true, createdAt: true, updatedAt: true });

// Types
export type ChecklistTemplate = typeof checklistTemplates.$inferSelect;
export type InsertChecklistTemplate = z.infer<typeof insertChecklistTemplateSchema>;
export type DealChecklist = typeof dealChecklists.$inferSelect;
export type InsertDealChecklist = z.infer<typeof insertDealChecklistSchema>;

// Default deal checklist templates
export const DEFAULT_DEAL_CHECKLIST_TEMPLATES: Array<{
  name: string;
  description: string;
  dealType: "cash" | "terms" | "wholesale" | "all";
  items: ChecklistTemplateItem[];
}> = [
  {
    name: "Cash Purchase Checklist",
    description: "Standard checklist for cash land purchases",
    dealType: "cash",
    items: [
      { id: "cash-1", title: "Title search completed", description: "Verify clear title with no liens or encumbrances", required: true, documentRequired: true },
      { id: "cash-2", title: "Survey review", description: "Review or order property survey", required: false, documentRequired: false },
      { id: "cash-3", title: "Property photos obtained", description: "Get current photos of the property", required: true, documentRequired: false },
      { id: "cash-4", title: "Purchase agreement signed", description: "Both parties have signed the purchase agreement", required: true, documentRequired: true },
      { id: "cash-5", title: "Funds verified", description: "Confirm buyer funds are available and verified", required: true, documentRequired: false },
      { id: "cash-6", title: "Closing scheduled", description: "Closing date and location confirmed", required: true, documentRequired: false },
    ],
  },
  {
    name: "Seller Financing (Terms) Checklist",
    description: "Checklist for seller-financed deals with payment terms",
    dealType: "terms",
    items: [
      { id: "terms-1", title: "Title search completed", description: "Verify clear title with no liens or encumbrances", required: true, documentRequired: true },
      { id: "terms-2", title: "Survey review", description: "Review or order property survey", required: false, documentRequired: false },
      { id: "terms-3", title: "Property photos obtained", description: "Get current photos of the property", required: true, documentRequired: false },
      { id: "terms-4", title: "Purchase agreement signed", description: "Both parties have signed the purchase agreement", required: true, documentRequired: true },
      { id: "terms-5", title: "Promissory note drafted", description: "Create and review promissory note terms", required: true, documentRequired: true },
      { id: "terms-6", title: "Down payment received", description: "Confirm down payment has been received", required: true, documentRequired: false },
      { id: "terms-7", title: "Payment schedule confirmed", description: "Finalize monthly payment schedule with buyer", required: true, documentRequired: false },
      { id: "terms-8", title: "Closing scheduled", description: "Closing date and location confirmed", required: true, documentRequired: false },
    ],
  },
  {
    name: "Wholesale Deal Checklist",
    description: "Checklist for wholesale/assignment deals",
    dealType: "wholesale",
    items: [
      { id: "ws-1", title: "Assignment contract prepared", description: "Create assignment of contract document", required: true, documentRequired: true },
      { id: "ws-2", title: "End buyer verified", description: "Confirm end buyer identity and ability to close", required: true, documentRequired: false },
      { id: "ws-3", title: "Earnest money deposited", description: "Earnest money received from end buyer", required: true, documentRequired: false },
      { id: "ws-4", title: "Assignment fee confirmed", description: "Assignment fee amount agreed upon", required: true, documentRequired: false },
      { id: "ws-5", title: "Original contract assignable", description: "Verify original purchase contract allows assignment", required: true, documentRequired: false },
      { id: "ws-6", title: "Closing coordinated", description: "Coordinate closing with title company and all parties", required: true, documentRequired: false },
    ],
  },
];

// ============================================
// USAGE ACTION TYPES & PRICING
// ============================================

export const USAGE_ACTION_TYPES = {
  email_sent: { name: "Email Sent", defaultCostCents: 1 }, // $0.01
  sms_sent: { name: "SMS Sent", defaultCostCents: 3 }, // $0.03
  ai_chat: { name: "AI Chat Request", defaultCostCents: 2 }, // $0.02
  ai_image: { name: "AI Image Generation", defaultCostCents: 25 }, // $0.25
  pdf_generated: { name: "PDF Document", defaultCostCents: 5 }, // $0.05
  comps_query: { name: "Comps Analysis", defaultCostCents: 10 }, // $0.10
  direct_mail: { name: "Direct Mail Piece", defaultCostCents: 75 }, // $0.75
} as const;

export type UsageActionType = keyof typeof USAGE_ACTION_TYPES;

// ============================================
// CREDIT PACKS
// ============================================

export const CREDIT_PACKS = {
  pack_10: { name: "$10 Credit Pack", amountCents: 1000, priceCents: 1000 },
  pack_25: { name: "$25 Credit Pack", amountCents: 2500, priceCents: 2500 },
  pack_50: { name: "$50 Credit Pack", amountCents: 5000, priceCents: 5000 },
  pack_100: { name: "$100 Credit Pack", amountCents: 10000, priceCents: 10000 },
} as const;

export type CreditPackId = keyof typeof CREDIT_PACKS;

// ============================================
// SUBSCRIPTION TIERS CONFIGURATION
// ============================================

export const SUBSCRIPTION_TIERS = {
  free: {
    name: "Free",
    price: 0,
    tagline: "Explore the platform",
    limits: {
      leads: 50,
      properties: 10,
      notes: 5,
      teamMembers: 1,
      aiRequestsPerMonth: 100,
      campaigns: 1,
      monthlyCredits: 100, // $1.00
    },
    features: ["basic_crm", "basic_inventory", "basic_notes"],
  },
  sprout: {
    name: "Sprout",
    price: 29,
    tagline: "Plant your first seeds",
    badge: "Best to start",
    limits: {
      leads: 250,
      properties: 50,
      notes: 25,
      teamMembers: 1,
      aiRequestsPerMonth: 500,
      campaigns: 5,
      monthlyCredits: 500, // $5.00
    },
    features: [
      "basic_crm", "basic_inventory", "basic_notes",
      "ai_due_diligence", "email_campaigns",
      "evening_review_dashboard", "deal_calculator",
      "tax_delinquent_import", "direct_mail_basic"
    ],
    // Superpowers unlocked at this tier (shown to free users as preview)
    unlocks: [
      "AI-powered due diligence on every parcel",
      "Tax delinquent list import & processing",
      "Evening Review passive income dashboard",
      "Blind offer calculation wizard",
      "Direct mail campaign builder",
      "Deal & ROI calculator",
    ],
  },
  starter: {
    name: "Starter",
    // Canonical price comes from shared/billing/tier-pricing.ts (solo tier).
    // The literal here is kept synchronous so this `as const` schema object
    // stays statically analysable for downstream tier-config consumers; the
    // tierPricing CI test pins this value and will fail if the two drift.
    price: 20,
    tagline: "Build momentum",
    badge: "Most popular solo",
    limits: {
      leads: 500,
      properties: 100,
      notes: 50,
      teamMembers: 2,
      aiRequestsPerMonth: 1000,
      campaigns: 10,
      monthlyCredits: 1000, // $10.00
    },
    features: [
      "basic_crm", "basic_inventory", "basic_notes",
      "ai_due_diligence", "email_campaigns",
      "evening_review_dashboard", "deal_calculator",
      "tax_delinquent_import", "direct_mail_basic",
      "atlas_ai_assistant", "seller_intent", "comps_analysis",
      "skip_tracing_basic", "avm_basic"
    ],
    unlocks: [
      "Atlas AI executive assistant",
      "Seller intent prediction",
      "Automated comps analysis",
      "Basic skip tracing",
      "Automated Valuation Model (AVM)",
      "Email drip sequences",
      "2 team member seats",
    ],
  },
  pro: {
    name: "Pro",
    // Canonical price from shared/billing/tier-pricing.ts (operator tier).
    price: 49,
    tagline: "Scale your operation",
    badge: "Best value for growth",
    limits: {
      leads: 5000,
      properties: 1000,
      notes: 500,
      teamMembers: 10,
      aiRequestsPerMonth: 10000,
      campaigns: 100,
      monthlyCredits: 5000, // $50.00
    },
    features: [
      "advanced_crm", "advanced_inventory", "advanced_notes",
      "ai_due_diligence", "ai_marketing", "ai_buyer_communication",
      "email_campaigns", "sms_campaigns", "direct_mail",
      "payment_processing", "reporting",
      "atlas_ai_assistant", "seller_intent", "comps_analysis",
      "skip_tracing_full", "avm_full", "deal_hunter", "portfolio_health",
      "owner_financing_manager", "buyer_network", "negotiation_copilot",
      "market_intelligence", "deal_patterns", "acquisition_radar"
    ],
    unlocks: [
      "Full skip tracing suite",
      "Deal Hunter AI (finds opportunities automatically)",
      "Negotiation Copilot",
      "Owner financing management & note portfolio",
      "Buyer network access",
      "Portfolio health monitoring",
      "Market intelligence reports",
      "Acquisition Radar (proactive deal alerts)",
      "SMS campaigns",
      "Up to 10 team members",
    ],
  },
  scale: {
    name: "Scale",
    // Canonical price from shared/billing/tier-pricing.ts (empire tier).
    price: 79,
    tagline: "Operate like a fund",
    badge: "For serious operators",
    limits: {
      leads: -1, // unlimited
      properties: -1,
      notes: -1,
      teamMembers: 25,
      aiRequestsPerMonth: -1,
      campaigns: -1,
      monthlyCredits: 25000, // $250.00
    },
    features: [
      "advanced_crm", "advanced_inventory", "advanced_notes",
      "ai_due_diligence", "ai_marketing", "ai_buyer_communication", "ai_custom_agents",
      "email_campaigns", "sms_campaigns", "direct_mail", "marketplace_syndication",
      "payment_processing", "advanced_reporting", "api_access", "webhooks",
      "priority_support", "custom_branding", "team_messaging",
      "atlas_ai_assistant", "seller_intent", "comps_analysis",
      "skip_tracing_full", "avm_full", "deal_hunter", "portfolio_health",
      "owner_financing_manager", "buyer_network", "negotiation_copilot",
      "market_intelligence", "deal_patterns", "acquisition_radar",
      "portfolio_optimizer", "portfolio_sentinel", "capital_markets",
      "va_management", "cohort_analysis", "territory_manager",
      "exchange_1031", "tax_optimization"
    ],
    unlocks: [
      "Unlimited leads, properties & notes",
      "Portfolio Optimizer & Sentinel (AI-managed portfolio)",
      "Capital markets access",
      "VA management system",
      "1031 Exchange tracker",
      "Tax optimization engine",
      "Full API access & webhooks",
      "Up to 25 team members",
    ],
  },
  enterprise: {
    name: "Enterprise",
    price: 899,
    tagline: "White-label your empire",
    badge: "For funds & teams",
    limits: {
      leads: -1, // unlimited
      properties: -1,
      notes: -1,
      teamMembers: -1, // unlimited seats
      aiRequestsPerMonth: -1,
      campaigns: -1,
      monthlyCredits: 50000, // $500.00
    },
    features: [
      "advanced_crm", "advanced_inventory", "advanced_notes",
      "ai_due_diligence", "ai_marketing", "ai_buyer_communication", "ai_custom_agents",
      "email_campaigns", "sms_campaigns", "direct_mail", "marketplace_syndication",
      "payment_processing", "advanced_reporting", "api_access", "webhooks",
      "priority_support", "custom_branding", "team_messaging",
      "white_label_portal", "dedicated_support", "compliance_exports", "custom_integrations",
      "atlas_ai_assistant", "seller_intent", "comps_analysis",
      "skip_tracing_full", "avm_full", "deal_hunter", "portfolio_health",
      "owner_financing_manager", "buyer_network", "negotiation_copilot",
      "market_intelligence", "deal_patterns", "acquisition_radar",
      "portfolio_optimizer", "portfolio_sentinel", "capital_markets",
      "va_management", "cohort_analysis", "territory_manager",
      "exchange_1031", "tax_optimization",
      "reseller_dashboard", "multi_org_management", "sso", "audit_logs_export"
    ],
    unlocks: [
      "White-label portal for your brand",
      "Multi-organization management",
      "SSO & enterprise authentication",
      "Dedicated account support",
      "Full compliance export suite",
      "Custom integrations",
      "Reseller dashboard",
      "Unlimited team members",
    ],
  },
} as const;

export type SubscriptionTier = keyof typeof SUBSCRIPTION_TIERS;

// ============================================
// AI CUSTOMER SUPPORT SYSTEM
// ============================================

// Support case categories and priorities
export const SUPPORT_CATEGORIES = {
  billing: { name: "Billing & Payments", priority: 2 },
  technical: { name: "Technical Issue", priority: 2 },
  account: { name: "Account Settings", priority: 1 },
  feature: { name: "Feature Question", priority: 1 },
  bug: { name: "Bug Report", priority: 3 },
  data: { name: "Data & Import/Export", priority: 2 },
  integration: { name: "Integration Help", priority: 2 },
  other: { name: "Other", priority: 1 },
} as const;

export type SupportCategory = keyof typeof SUPPORT_CATEGORIES;

// Support case statuses
export const SUPPORT_STATUSES = {
  open: { name: "Open", color: "blue" },
  ai_handling: { name: "AI Handling", color: "purple" },
  awaiting_user: { name: "Awaiting User Response", color: "yellow" },
  escalated: { name: "Escalated to Human", color: "red" },
  resolved: { name: "Resolved", color: "green" },
  closed: { name: "Closed", color: "gray" },
} as const;

export type SupportStatus = keyof typeof SUPPORT_STATUSES;

// SLA targets by priority level (hours to first response)
// Priority scale: 1=low, 2=normal, 3=medium, 4=high, 5=critical
export const SLA_HOURS = {
  5: 1,   // critical → 1 hour
  4: 4,   // high → 4 hours
  3: 24,  // medium → 24 hours
  2: 48,  // normal → 48 hours
  1: 72,  // low → 72 hours
} as const;

export type SlaStatus = "on_track" | "at_risk" | "breached";

export interface SlaInfo {
  slaDeadline: Date;
  slaStatus: SlaStatus;
  hoursUntilBreached: number; // negative = already breached
}

/** Compute SLA metadata for a support case given its priority and createdAt. */
export function computeSla(priority: number, createdAt: Date | string): SlaInfo {
  const p = (priority in SLA_HOURS ? priority : 1) as keyof typeof SLA_HOURS;
  const slaHours = SLA_HOURS[p] ?? 72;
  const created = new Date(createdAt);
  const slaDeadline = new Date(created.getTime() + slaHours * 60 * 60 * 1000);
  const now = new Date();
  const msUntil = slaDeadline.getTime() - now.getTime();
  const hoursUntilBreached = msUntil / (60 * 60 * 1000);
  let slaStatus: SlaStatus;
  if (hoursUntilBreached < 0) {
    slaStatus = "breached";
  } else if (hoursUntilBreached < slaHours * 0.25) {
    slaStatus = "at_risk";
  } else {
    slaStatus = "on_track";
  }
  return { slaDeadline, slaStatus, hoursUntilBreached };
}

// Support cases (tickets)
export const supportCases = pgTable("support_cases", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  userId: text("user_id").notNull(), // Replit user ID who created the case
  
  // Case details
  subject: text("subject").notNull(),
  category: text("category").notNull().default("other"), // billing, technical, account, feature, bug, data, integration, other
  status: text("status").notNull().default("open"), // open, ai_handling, awaiting_user, escalated, resolved, closed
  priority: integer("priority").notNull().default(1), // 1-5 (1=low, 5=critical)
  
  // AI classification
  aiClassification: jsonb("ai_classification").$type<{
    category: string;
    confidence: number;
    suggestedPlaybook?: string;
    sentiment?: "positive" | "neutral" | "negative" | "frustrated";
    urgency?: "low" | "medium" | "high" | "critical";
  }>(),
  
  // Resolution tracking
  resolvedAt: timestamp("resolved_at"),
  resolutionSummary: text("resolution_summary"),
  resolutionType: text("resolution_type"), // auto_resolved, user_resolved, escalated_resolved, closed_no_action
  
  // Escalation
  escalatedAt: timestamp("escalated_at"),
  escalationReason: text("escalation_reason"),
  assignedTo: text("assigned_to"), // admin user ID if escalated
  
  // Metrics
  aiAttempts: integer("ai_attempts").default(0), // how many times AI tried to resolve
  userSatisfaction: integer("user_satisfaction"), // 1-5 rating after resolution
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertSupportCaseSchema = createInsertSchema(supportCases).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSupportCase = z.infer<typeof insertSupportCaseSchema>;
export type SupportCase = typeof supportCases.$inferSelect;

// Support messages within a case
export const supportMessages = pgTable("support_messages", {
  id: serial("id").primaryKey(),
  caseId: integer("case_id").references(() => supportCases.id).notNull(),
  
  // Message details
  role: text("role").notNull(), // user, ai_support, human_support, system
  content: text("content").notNull(),
  
  // AI-specific fields
  aiModel: text("ai_model"), // which model generated the response
  aiConfidence: numeric("ai_confidence"), // confidence in the response (0-1)
  playbookUsed: text("playbook_used"), // which playbook was applied
  
  // Action tracking
  actionsAttempted: jsonb("actions_attempted").$type<Array<{
    action: string;
    success: boolean;
    details?: string;
  }>>(),
  
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertSupportMessageSchema = createInsertSchema(supportMessages).omit({ id: true, createdAt: true });
export type InsertSupportMessage = z.infer<typeof insertSupportMessageSchema>;
export type SupportMessage = typeof supportMessages.$inferSelect;

// Support actions (what AI can do to resolve issues)
export const supportActions = pgTable("support_actions", {
  id: serial("id").primaryKey(),
  caseId: integer("case_id").references(() => supportCases.id).notNull(),
  messageId: integer("message_id").references(() => supportMessages.id),
  
  // Action details
  actionType: text("action_type").notNull(), // credit_adjustment, settings_change, password_reset, data_export, etc.
  actionDetails: jsonb("action_details").$type<Record<string, any>>(),
  
  // Outcome
  success: boolean("success").notNull(),
  errorMessage: text("error_message"),
  resultDetails: jsonb("result_details").$type<Record<string, any>>(),
  
  // Audit trail
  performedBy: text("performed_by").notNull(), // 'ai_support' or admin user ID
  approvedBy: text("approved_by"), // if action required approval
  
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertSupportActionSchema = createInsertSchema(supportActions).omit({ id: true, createdAt: true });
export type InsertSupportAction = z.infer<typeof insertSupportActionSchema>;
export type SupportAction = typeof supportActions.$inferSelect;

// Support playbooks (automated resolution scripts)
export const supportPlaybooks = pgTable("support_playbooks", {
  id: serial("id").primaryKey(),
  
  // Playbook identity
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  description: text("description"),
  category: text("category").notNull(), // matches support categories
  
  // Trigger conditions
  triggerPatterns: jsonb("trigger_patterns").$type<string[]>(), // keywords/patterns to match
  triggerConditions: jsonb("trigger_conditions").$type<{
    requiredContext?: string[];
    excludePatterns?: string[];
    minConfidence?: number;
  }>(),
  
  // Actions to take
  steps: jsonb("steps").$type<Array<{
    stepNumber: number;
    actionType: string;
    actionParams: Record<string, any>;
    successMessage: string;
    failureMessage: string;
    continueOnFailure: boolean;
  }>>(),
  
  // Response templates
  initialResponse: text("initial_response"), // first message to user
  successResponse: text("success_response"), // if all steps succeed
  failureResponse: text("failure_response"), // if steps fail
  escalationResponse: text("escalation_response"), // if escalating
  
  // Guardrails
  maxCreditAdjustment: integer("max_credit_adjustment"), // max cents AI can adjust
  requiresApproval: boolean("requires_approval").default(false),
  canEscalate: boolean("can_escalate").default(true),
  
  // Metrics
  timesUsed: integer("times_used").default(0),
  successRate: numeric("success_rate"),
  
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertSupportPlaybookSchema = createInsertSchema(supportPlaybooks).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSupportPlaybook = z.infer<typeof insertSupportPlaybookSchema>;
export type SupportPlaybook = typeof supportPlaybooks.$inferSelect;

// Default playbooks for common issues
export const DEFAULT_SUPPORT_PLAYBOOKS = [
  {
    name: "Credit Balance Inquiry",
    slug: "credit_balance_inquiry",
    description: "Help users understand their credit balance and usage",
    category: "billing",
    triggerPatterns: ["credit balance", "credits", "how many credits", "usage", "charged", "balance"],
    steps: [
      { stepNumber: 1, actionType: "get_credit_balance", actionParams: {}, successMessage: "Retrieved your credit balance", failureMessage: "Could not retrieve balance", continueOnFailure: false },
      { stepNumber: 2, actionType: "get_recent_usage", actionParams: { days: 30 }, successMessage: "Retrieved your recent usage", failureMessage: "Could not retrieve usage", continueOnFailure: true },
    ],
    initialResponse: "Let me check your credit balance and recent usage for you.",
    successResponse: "Here's your current credit information. Is there anything specific you'd like to understand better?",
    maxCreditAdjustment: 0,
    canEscalate: true,
  },
  {
    name: "Courtesy Credit Request",
    slug: "courtesy_credit",
    description: "Issue small courtesy credits for minor issues",
    category: "billing",
    triggerPatterns: ["refund", "credit", "compensation", "not working", "error", "failed", "issue"],
    steps: [
      { stepNumber: 1, actionType: "check_recent_issues", actionParams: {}, successMessage: "Checked for recent issues", failureMessage: "Could not check issues", continueOnFailure: false },
      { stepNumber: 2, actionType: "issue_courtesy_credit", actionParams: { maxCents: 500 }, successMessage: "Issued courtesy credit", failureMessage: "Could not issue credit", continueOnFailure: false },
    ],
    initialResponse: "I understand you've had an issue. Let me look into this and see what I can do to help.",
    successResponse: "I've added a courtesy credit to your account. Is there anything else I can help with?",
    maxCreditAdjustment: 500, // $5 max
    canEscalate: true,
  },
  {
    name: "Feature Explanation",
    slug: "feature_explanation",
    description: "Explain how features work",
    category: "feature",
    triggerPatterns: ["how do i", "how does", "what is", "explain", "help with", "tutorial"],
    steps: [
      { stepNumber: 1, actionType: "identify_feature", actionParams: {}, successMessage: "Identified the feature", failureMessage: "Could not identify feature", continueOnFailure: false },
      { stepNumber: 2, actionType: "generate_explanation", actionParams: {}, successMessage: "Generated explanation", failureMessage: "Could not generate explanation", continueOnFailure: false },
    ],
    initialResponse: "I'd be happy to help explain that feature!",
    successResponse: "Does this help answer your question? Let me know if you'd like more details.",
    maxCreditAdjustment: 0,
    canEscalate: true,
  },
  {
    name: "Technical Troubleshooting",
    slug: "technical_troubleshooting",
    description: "Diagnose and resolve technical issues",
    category: "technical",
    triggerPatterns: ["not working", "error", "broken", "bug", "problem", "can't", "won't", "stuck"],
    steps: [
      { stepNumber: 1, actionType: "run_diagnostics", actionParams: {}, successMessage: "Ran system diagnostics", failureMessage: "Could not run diagnostics", continueOnFailure: false },
      { stepNumber: 2, actionType: "check_known_issues", actionParams: {}, successMessage: "Checked known issues", failureMessage: "Could not check issues", continueOnFailure: true },
      { stepNumber: 3, actionType: "attempt_fix", actionParams: {}, successMessage: "Applied fix", failureMessage: "Could not apply fix", continueOnFailure: true },
    ],
    initialResponse: "I'm sorry to hear you're having trouble. Let me run some diagnostics to see what's happening.",
    successResponse: "I've identified the issue and applied a fix. Please try again and let me know if you're still having problems.",
    failureResponse: "I wasn't able to resolve this automatically. Let me escalate this to our team for a closer look.",
    maxCreditAdjustment: 0,
    canEscalate: true,
  },
] as const;

// ============================================
// FEATURE REQUESTS
// ============================================

export const featureRequests = pgTable("feature_requests", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  userId: text("user_id").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  category: text("category").notNull(), // enhancement, new_feature, integration, ux
  priority: text("priority").default("medium"), // low, medium, high
  status: text("status").default("submitted"), // submitted, under_review, planned, in_progress, completed, declined
  founderNotes: text("founder_notes"), // Internal notes from founder
  upvotes: integer("upvotes").default(0),
  aiTriage: jsonb("ai_triage").$type<{
    estimatedRevImpactCents: number;
    priorityScore: number;
    duplicateOfId: number | null;
    analysisReason: string;
    autoDisposed: boolean;
  }>(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertFeatureRequestSchema = createInsertSchema(featureRequests).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  status: true,
  founderNotes: true,
  upvotes: true,
});
export type InsertFeatureRequest = z.infer<typeof insertFeatureRequestSchema>;
export type FeatureRequest = typeof featureRequests.$inferSelect;

// ============================================
// DUNNING & PAYMENT RECOVERY
// ============================================

// Dunning stages for progressive enforcement
export const DUNNING_STAGES = {
  none: { name: "Active", accessLevel: "full" },
  grace_period: { name: "Grace Period", accessLevel: "full" },
  warning: { name: "Payment Warning", accessLevel: "full" },
  restricted: { name: "Restricted", accessLevel: "limited" },
  suspended: { name: "Suspended", accessLevel: "none" },
  cancelled: { name: "Cancelled", accessLevel: "none" },
} as const;

export type DunningStage = keyof typeof DUNNING_STAGES;

// Dunning events track each payment failure and recovery attempt
export const dunningEvents = pgTable("dunning_events", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  
  // Stripe references
  stripeSubscriptionId: text("stripe_subscription_id"),
  stripeInvoiceId: text("stripe_invoice_id"),
  stripeCustomerId: text("stripe_customer_id"),
  
  // Event details
  eventType: text("event_type").notNull(), // payment_failed, payment_succeeded, subscription_cancelled, etc.
  attemptNumber: integer("attempt_number").notNull().default(1),
  amountDueCents: integer("amount_due_cents"),
  amountPaidCents: integer("amount_paid_cents"),
  
  // Status tracking
  status: text("status").notNull().default("pending"), // pending, scheduled_retry, resolved, failed_final, escalated
  dunningStage: text("dunning_stage").notNull().default("grace_period"), // current stage at time of event
  
  // Retry scheduling
  nextRetryAt: timestamp("next_retry_at"),
  retryCount: integer("retry_count").default(0),
  maxRetries: integer("max_retries").default(4),
  
  // Notifications
  notificationsSent: jsonb("notifications_sent").$type<Array<{
    type: string;
    sentAt: string;
    channel: string;
  }>>(),
  
  // Resolution
  resolvedAt: timestamp("resolved_at"),
  resolutionType: text("resolution_type"), // auto_recovered, manual_payment, subscription_cancelled, escalated

  // Phase 3 W10 — SMS leg throttle. Set the first time a dunning SMS is
  // dispatched in a sequence; checked before sending again so we never spam.
  smsSentAt: timestamp("sms_sent_at"),

  // Metadata
  metadata: jsonb("metadata").$type<Record<string, any>>(),
  errorMessage: text("error_message"),

  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertDunningEventSchema = createInsertSchema(dunningEvents).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertDunningEvent = z.infer<typeof insertDunningEventSchema>;
export type DunningEvent = typeof dunningEvents.$inferSelect;

// Default dunning configuration per tier
export const DUNNING_CONFIG = {
  retryScheduleDays: [3, 5, 7, 14], // Days after initial failure to retry
  // D1 (founder decision 2026-07-11): unattended auto-retry ladder — the
  // dunning sweeper attempts the outstanding invoice itself on these days
  // after the initial failure (distinct from retryScheduleDays, which
  // mirrors Stripe's own smart-retry schedule for stage math). Every
  // attempt is Letter-visible via the activity log.
  autoRetryScheduleDays: [1, 3, 7],
  gracePeriodDays: 3, // Full access for first 3 days
  warningPeriodDays: 7, // Warning stage days 4-7
  restrictedPeriodDays: 14, // Restricted access days 8-14
  finalCancellationDays: 21, // Cancel subscription after 21 days
  notificationSchedule: [
    { dayOffset: 0, type: "payment_failed", channel: "email" },
    { dayOffset: 2, type: "reminder", channel: "email" },
    // Phase 3 W10 — SMS leg fires on day 3 (after grace period). Throttled to
    // exactly one SMS per dunning sequence via dunning_events.sms_sent_at,
    // and respects the per-org notification-prefs override at billing.dunning_sms.
    { dayOffset: 3, type: "dunning_sms", channel: "sms" },
    { dayOffset: 6, type: "warning", channel: "email" },
    { dayOffset: 13, type: "final_notice", channel: "email" },
  ],
} as const;

// ============================================
// FOUNDER ALERTS & SYSTEM NOTIFICATIONS
// ============================================

export const systemAlerts = pgTable("system_alerts", {
  id: serial("id").primaryKey(),
  
  // Alert classification (type is the legacy column, alertType is the newer one)
  type: varchar("type", { length: 255 }).notNull(),
  alertType: text("alert_type"), // revenue_at_risk, high_churn, system_error, escalation, milestone
  severity: text("severity").notNull().default("info"), // info, warning, critical
  
  // Content
  title: text("title").notNull(),
  message: text("message").notNull(),
  
  // Context
  organizationId: integer("organization_id").references(() => organizations.id),
  relatedEntityType: text("related_entity_type"), // organization, support_case, subscription, etc.
  relatedEntityId: integer("related_entity_id"),
  
  // Status
  status: text("status").notNull().default("new"), // new, acknowledged, resolved, dismissed
  acknowledgedAt: timestamp("acknowledged_at"),
  resolvedAt: timestamp("resolved_at"),
  
  // Auto-resolution
  autoResolvable: boolean("auto_resolvable").default(false),
  autoResolveAction: text("auto_resolve_action"),
  
  // Metadata
  metadata: jsonb("metadata").$type<Record<string, any>>(),
  
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertSystemAlertSchema = createInsertSchema(systemAlerts).omit({ id: true, createdAt: true });
export type InsertSystemAlert = z.infer<typeof insertSystemAlertSchema>;
export type SystemAlert = typeof systemAlerts.$inferSelect;

// ============================================
// PAX OBSERVATIONS (Proactive Detection)
// ============================================

// Pax proactive observation types
export const PAX_OBSERVATION_TYPES = [
  'anomaly',           // Unusual patterns detected
  'performance',       // Performance degradation
  'error_pattern',     // Repeated errors
  'usage_spike',       // Unusual usage patterns
  'quota_warning',     // Approaching quota limits
  'data_issue',        // Data integrity issues
  'activity_drop',     // Sudden drop in user activity
  'service_health',    // External service issues
  'opportunity',       // Positive opportunity detected
  'optimization',      // Optimization suggestion
] as const;

export type PaxObservationType = typeof PAX_OBSERVATION_TYPES[number];

// Notification level options for organizations
export const PROACTIVE_NOTIFICATION_LEVELS = ['minimal', 'balanced', 'proactive', 'off'] as const;
export type ProactiveNotificationLevel = typeof PROACTIVE_NOTIFICATION_LEVELS[number];

// Pax observations table - graceful proactive detection
export const paxObservations = pgTable("pax_observations", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  userId: text("user_id"), // Nullable - may be org-wide observation

  // Classification
  type: text("type").notNull(), // anomaly, performance, error_pattern, usage_spike, etc.
  confidenceScore: integer("confidence_score").notNull(), // 0-100
  severity: text("severity").notNull().default("info"), // info, low, medium, high

  // Content - using soft language framing
  title: text("title").notNull(), // e.g., "Quick tip", "Something to check", "Heads up"
  description: text("description").notNull(),
  metadata: jsonb("metadata").$type<{
    // Context about the observation
    source?: string;
    relatedEntityType?: string;
    relatedEntityId?: number;
    suggestedAction?: string;
    dataPoints?: Record<string, any>;
    batchKey?: string; // For grouping similar observations
    previousOccurrences?: number;
  }>(),

  // Status tracking
  status: text("status").notNull().default("detected"), // detected, acknowledged, dismissed, escalated, auto_resolved

  // Timestamps
  detectedAt: timestamp("detected_at").defaultNow(),
  acknowledgedAt: timestamp("acknowledged_at"),
  escalatedAt: timestamp("escalated_at"),
  resolvedAt: timestamp("resolved_at"),

  // Notification tracking
  notificationSent: boolean("notification_sent").default(false),
  notificationType: text("notification_type").default("none"), // none, passive, active

  // Auto-resolution tracking
  autoResolveAttempted: boolean("auto_resolve_attempted").default(false),
  autoResolveSuccess: boolean("auto_resolve_success").default(false),
  autoResolveDetails: text("auto_resolve_details"),

  // Lens 46 — customer-facing trust loop. When a customer sees "Pax noticed X,"
  // they should be able to expand into WHY: the model's stated reason, the
  // inputs it weighed, alternatives it ruled out, and which model produced
  // the call. Description is the headline; these power the "Why Pax did this"
  // explainer card.
  reasoning: text("reasoning"),
  inputs: jsonb("inputs").$type<Record<string, unknown>>(),
  alternativesConsidered: jsonb("alternatives_considered").$type<
    Array<{ action: string; rejectedBecause: string }>
  >(),
  modelUsed: text("model_used"),

  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("pax_obs_org_idx").on(table.organizationId),
  index("pax_obs_status_idx").on(table.status),
  index("pax_obs_type_idx").on(table.type),
  index("pax_obs_detected_at_idx").on(table.detectedAt),
]);

export const insertPaxObservationSchema = createInsertSchema(paxObservations).omit({ 
  id: true, 
  createdAt: true, 
  updatedAt: true,
  detectedAt: true 
});
export type InsertPaxObservation = z.infer<typeof insertPaxObservationSchema>;
export type PaxObservation = typeof paxObservations.$inferSelect;

// ============================================
// API JOB QUEUE
// ============================================

export const apiJobs = pgTable("api_jobs", {
  id: varchar("id", { length: 255 }).primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id),
  type: text("type").notNull(), // openai, stripe, lob, sendgrid, twilio
  operation: text("operation").notNull(),
  payload: jsonb("payload"),
  status: text("status").notNull().default("pending"), // pending, processing, retrying, completed, failed
  retries: integer("retries").default(0),
  maxRetries: integer("max_retries").default(3),
  nextRetryAt: timestamp("next_retry_at"),
  result: jsonb("result"),
  error: text("error"),
  createdAt: timestamp("created_at").defaultNow(),
  completedAt: timestamp("completed_at"),
});

export const insertApiJobSchema = createInsertSchema(apiJobs).omit({ createdAt: true, completedAt: true });
export type InsertApiJob = z.infer<typeof insertApiJobSchema>;
export type ApiJob = typeof apiJobs.$inferSelect;

// ============================================
// DIGEST SUBSCRIPTIONS
// ============================================

export const digestSubscriptions = pgTable("digest_subscriptions", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id", { length: 255 }).notNull(),
  organizationId: integer("organization_id").references(() => organizations.id),
  frequency: text("frequency").notNull().default("weekly"), // daily, weekly, monthly
  emailEnabled: boolean("email_enabled").default(true),
  lastSentAt: timestamp("last_sent_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertDigestSubscriptionSchema = createInsertSchema(digestSubscriptions).omit({ id: true, createdAt: true });
export type InsertDigestSubscription = z.infer<typeof insertDigestSubscriptionSchema>;
export type DigestSubscription = typeof digestSubscriptions.$inferSelect;

// ============================================
// ACTIVITY EVENTS (Communication History Timeline)
// ============================================

// Event types for communication timeline
export const ACTIVITY_EVENT_TYPES = {
  email_sent: { name: "Email Sent", icon: "Mail", color: "blue" },
  email_opened: { name: "Email Opened", icon: "MailOpen", color: "green" },
  email_clicked: { name: "Email Clicked", icon: "MousePointer", color: "purple" },
  sms_sent: { name: "SMS Sent", icon: "MessageSquare", color: "cyan" },
  sms_delivered: { name: "SMS Delivered", icon: "MessageCircle", color: "green" },
  mail_sent: { name: "Direct Mail Sent", icon: "FileText", color: "orange" },
  mail_delivered: { name: "Direct Mail Delivered", icon: "Package", color: "green" },
  call_made: { name: "Call Made", icon: "PhoneOutgoing", color: "blue" },
  call_received: { name: "Call Received", icon: "PhoneIncoming", color: "green" },
  note_added: { name: "Note Added", icon: "StickyNote", color: "yellow" },
  stage_changed: { name: "Stage Changed", icon: "ArrowRightCircle", color: "purple" },
  payment_received: { name: "Payment Received", icon: "DollarSign", color: "green" },
  document_uploaded: { name: "Document Uploaded", icon: "Upload", color: "slate" },
  task_created: { name: "Task Created", icon: "ListTodo", color: "blue" },
  task_updated: { name: "Task Updated", icon: "ClipboardEdit", color: "amber" },
  task_completed: { name: "Task Completed", icon: "CheckCircle2", color: "green" },
  // W6.2b — synthetic track events. The deal /track endpoint maps the REAL
  // source tables (offers, seller_communications, campaign_responses,
  // mail_shipment_pieces) into the timeline at query time; these types name
  // the mapped rows. They are never persisted to activity_events.
  offer_sent: { name: "Offer Sent", icon: "Send", color: "blue" },
  offer_viewed: { name: "Offer Viewed", icon: "Eye", color: "purple" },
  offer_response: { name: "Offer Response", icon: "Reply", color: "green" },
  response_received: { name: "Response Received", icon: "Inbox", color: "green" },
} as const;

export type ActivityEventType = keyof typeof ACTIVITY_EVENT_TYPES;

// Activity Events table - unified timeline for leads, properties, and deals
export const activityEvents = pgTable("activity_events", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  
  // Entity reference (polymorphic)
  entityType: text("entity_type").notNull(), // lead, property, deal
  entityId: integer("entity_id").notNull(),
  
  // Event details
  eventType: text("event_type").notNull(), // email_sent, sms_sent, mail_sent, call_made, note_added, stage_changed, payment_received, etc.
  description: text("description").notNull(),
  
  // Metadata for event-specific details
  metadata: jsonb("metadata").$type<{
    subject?: string;
    recipient?: string;
    amount?: number;
    previousStage?: string;
    newStage?: string;
    campaignName?: string;
    paymentMethod?: string;
    documentName?: string;
    documentUrl?: string;
    callDuration?: number;
    templateUsed?: string;
    [key: string]: unknown;
  }>(),
  
  // Attribution
  userId: text("user_id"), // User who triggered the event (null for automated)
  campaignId: integer("campaign_id").references(() => campaigns.id),
  
  // Timestamp
  eventDate: timestamp("event_date").notNull().defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertActivityEventSchema = createInsertSchema(activityEvents).omit({ id: true, createdAt: true });
export type InsertActivityEvent = z.infer<typeof insertActivityEventSchema>;
export type ActivityEvent = typeof activityEvents.$inferSelect;

// ============================================
// DRIP CAMPAIGN SEQUENCES (Multi-Touch Automation)
// ============================================

// Campaign Sequences - multi-touch drip campaigns
export const campaignSequences = pgTable("campaign_sequences", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  name: text("name").notNull(),
  description: text("description"),
  isActive: boolean("is_active").default(true),
  enrollmentTrigger: text("enrollment_trigger").notNull().default("manual"), // manual, new_lead, stage_change
  enrollmentCriteria: jsonb("enrollment_criteria").$type<{
    leadStatus?: string[];
    leadSource?: string[];
    leadTags?: string[];
    triggerStage?: string;
  }>(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Sequence Steps - individual touches in a sequence
export const sequenceSteps = pgTable("sequence_steps", {
  id: serial("id").primaryKey(),
  sequenceId: integer("sequence_id").references(() => campaignSequences.id).notNull(),
  stepNumber: integer("step_number").notNull(),
  delayDays: integer("delay_days").notNull().default(0), // days to wait after previous step
  channel: text("channel").notNull(), // direct_mail, email, sms
  templateId: text("template_id"),
  subject: text("subject"),
  content: text("content").notNull(),
  conditionType: text("condition_type").notNull().default("always"), // always, no_response, responded
  conditionDays: integer("condition_days"), // days to check for response condition
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Sequence Enrollments - leads enrolled in sequences
export const sequenceEnrollments = pgTable("sequence_enrollments", {
  id: serial("id").primaryKey(),
  sequenceId: integer("sequence_id").references(() => campaignSequences.id).notNull(),
  leadId: integer("lead_id").references(() => leads.id).notNull(),
  status: text("status").notNull().default("active"), // active, paused, completed, cancelled
  currentStep: integer("current_step").notNull().default(0),
  enrolledAt: timestamp("enrolled_at").defaultNow(),
  lastStepSentAt: timestamp("last_step_sent_at"),
  nextStepScheduledAt: timestamp("next_step_scheduled_at"),
  pauseReason: text("pause_reason"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Insert Schemas
export const insertCampaignSequenceSchema = createInsertSchema(campaignSequences).omit({ id: true, createdAt: true, updatedAt: true });
export const insertSequenceStepSchema = createInsertSchema(sequenceSteps).omit({ id: true, createdAt: true, updatedAt: true });
export const insertSequenceEnrollmentSchema = createInsertSchema(sequenceEnrollments).omit({ id: true, createdAt: true, updatedAt: true });

// Types
export type CampaignSequence = typeof campaignSequences.$inferSelect;
export type InsertCampaignSequence = z.infer<typeof insertCampaignSequenceSchema>;
export type SequenceStep = typeof sequenceSteps.$inferSelect;
export type InsertSequenceStep = z.infer<typeof insertSequenceStepSchema>;
export type SequenceEnrollment = typeof sequenceEnrollments.$inferSelect;
export type InsertSequenceEnrollment = z.infer<typeof insertSequenceEnrollmentSchema>;

// Type aliases for sequence-related types
export type EnrollmentTrigger = "manual" | "new_lead" | "stage_change";
export type SequenceStepChannel = "direct_mail" | "email" | "sms";
export type SequenceConditionType = "always" | "no_response" | "responded";
export type SequenceEnrollmentStatus = "active" | "paused" | "completed" | "cancelled";

// ============================================
// A/B TESTING FRAMEWORK
// ============================================

// A/B Tests table - split testing for campaigns
export const abTests = pgTable("ab_tests", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  campaignId: integer("campaign_id").references(() => campaigns.id).notNull(),
  name: text("name").notNull(),
  status: text("status").notNull().default("draft"), // draft, running, completed
  testType: text("test_type").notNull(), // subject, content, offer
  
  // Test configuration
  sampleSizePercent: integer("sample_size_percent").default(20), // Percent of total audience for testing
  winningMetric: text("winning_metric").notNull().default("response_rate"), // open_rate, click_rate, response_rate
  minSampleSize: integer("min_sample_size").default(100), // Minimum sample per variant
  
  // Timing
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  autoCompleteOnSignificance: boolean("auto_complete_on_significance").default(true),
  
  // Winner
  winnerId: integer("winner_id"), // ID of winning variant
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// A/B Test Variants table - individual test variations
export const abTestVariants = pgTable("ab_test_variants", {
  id: serial("id").primaryKey(),
  testId: integer("test_id").references(() => abTests.id).notNull(),
  name: text("name").notNull(), // e.g., "Variant A", "Variant B"
  isControl: boolean("is_control").default(false), // Is this the control group?
  
  // Content variations
  subject: text("subject"),
  content: text("content"),
  offerAmount: numeric("offer_amount"),
  
  // Sample allocation
  sampleSize: integer("sample_size").default(0), // Number of recipients allocated
  
  // Performance metrics
  sent: integer("sent").default(0),
  delivered: integer("delivered").default(0),
  opened: integer("opened").default(0),
  clicked: integer("clicked").default(0),
  responded: integer("responded").default(0),
  converted: integer("converted").default(0),
  
  // Calculated metrics
  deliveryRate: numeric("delivery_rate"),
  openRate: numeric("open_rate"),
  clickRate: numeric("click_rate"),
  responseRate: numeric("response_rate"),
  conversionRate: numeric("conversion_rate"),
  confidenceLevel: numeric("confidence_level"), // Statistical significance level
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Insert Schemas
export const insertAbTestSchema = createInsertSchema(abTests).omit({ id: true, createdAt: true, updatedAt: true });
export const insertAbTestVariantSchema = createInsertSchema(abTestVariants).omit({ id: true, createdAt: true, updatedAt: true });

// Types
export type AbTest = typeof abTests.$inferSelect;
export type InsertAbTest = z.infer<typeof insertAbTestSchema>;
export type AbTestVariant = typeof abTestVariants.$inferSelect;
export type InsertAbTestVariant = z.infer<typeof insertAbTestVariantSchema>;

// Type aliases for A/B testing
export type AbTestStatus = "draft" | "running" | "completed";
export type AbTestType = "subject" | "content" | "offer";
export type AbTestWinningMetric = "open_rate" | "click_rate" | "response_rate";

// Statistical significance thresholds
export const CONFIDENCE_THRESHOLDS = {
  low: 0.90,    // 90% confidence
  medium: 0.95, // 95% confidence
  high: 0.99,   // 99% confidence
} as const;

// Z-scores for confidence levels
export const Z_SCORES = {
  0.90: 1.645,
  0.95: 1.96,
  0.99: 2.576,
} as const;

// ============================================
// CUSTOM FIELDS SYSTEM (10.1)
// ============================================

// Field types for custom fields
export const CUSTOM_FIELD_TYPES = ["text", "number", "date", "select", "checkbox"] as const;
export type CustomFieldType = typeof CUSTOM_FIELD_TYPES[number];

// Entity types that support custom fields
export const CUSTOM_FIELD_ENTITY_TYPES = ["lead", "property", "deal"] as const;
export type CustomFieldEntityType = typeof CUSTOM_FIELD_ENTITY_TYPES[number];

// Custom Field Definitions - defines the schema of custom fields
export const customFieldDefinitions = pgTable("custom_field_definitions", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  entityType: text("entity_type").notNull(), // lead, property, deal
  fieldName: text("field_name").notNull(), // internal name (snake_case)
  fieldLabel: text("field_label").notNull(), // display label
  fieldType: text("field_type").notNull(), // text, number, date, select, checkbox
  options: jsonb("options").$type<string[]>(), // for select type - array of option values
  isRequired: boolean("is_required").default(false),
  displayOrder: integer("display_order").default(0),
  placeholder: text("placeholder"), // placeholder text for input
  helpText: text("help_text"), // helper text displayed under the field
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Custom Field Values - stores actual values for entities
export const customFieldValues = pgTable("custom_field_values", {
  id: serial("id").primaryKey(),
  definitionId: integer("definition_id").references(() => customFieldDefinitions.id).notNull(),
  entityId: integer("entity_id").notNull(), // ID of the lead/property/deal
  value: text("value"), // stored as text, parsed based on field type
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Insert Schemas
export const insertCustomFieldDefinitionSchema = createInsertSchema(customFieldDefinitions).omit({ 
  id: true, 
  createdAt: true, 
  updatedAt: true 
});
export const insertCustomFieldValueSchema = createInsertSchema(customFieldValues).omit({ 
  id: true, 
  createdAt: true, 
  updatedAt: true 
});

// Types
export type CustomFieldDefinition = typeof customFieldDefinitions.$inferSelect;
export type InsertCustomFieldDefinition = z.infer<typeof insertCustomFieldDefinitionSchema>;
export type CustomFieldValue = typeof customFieldValues.$inferSelect;
export type InsertCustomFieldValue = z.infer<typeof insertCustomFieldValueSchema>;

// ============================================
// SAVED VIEWS / FILTERS (10.2)
// ============================================

// Saved Views - stores user-defined table views and filter presets
export const savedViews = pgTable("saved_views", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  entityType: text("entity_type").notNull(), // lead, property, deal
  name: text("name").notNull(),
  filters: jsonb("filters").$type<{
    field: string;
    operator: string; // equals, contains, gt, lt, gte, lte, in, not_in
    value: string | number | boolean | string[];
  }[]>(),
  sortBy: text("sort_by"),
  sortOrder: text("sort_order").default("desc"), // asc, desc
  columns: jsonb("columns").$type<string[]>(), // visible column names
  isDefault: boolean("is_default").default(false),
  isShared: boolean("is_shared").default(false), // shared with team
  createdBy: text("created_by"), // user ID who created the view
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Insert Schema
export const insertSavedViewSchema = createInsertSchema(savedViews).omit({ 
  id: true, 
  createdAt: true, 
  updatedAt: true 
});

// Types
export type SavedView = typeof savedViews.$inferSelect;
export type InsertSavedView = z.infer<typeof insertSavedViewSchema>;

// Type aliases for saved views
export type SavedViewFilter = NonNullable<SavedView["filters"]>[number];
export type FilterOperator = "equals" | "not_equals" | "contains" | "gt" | "lt" | "gte" | "lte" | "in" | "not_in" | "is_empty" | "is_not_empty";

// ============================================
// UI STATE (Tahoe E6 — server-backed useUiState)
// ============================================

// Server-backed UI preferences keyed by (organization_id, user_id, key).
// Today most ephemeral UI state — collapsed panels, view toggles, dismissed
// banners — lives only in localStorage, so it does not follow a user across
// devices (Tom uses iOS AND desktop). This table is the durable home for
// that state. The `value` is an opaque jsonb blob; each consumer owns its
// own shape via the `useUiState<T>` hook. Keys are namespaced "scope:field"
// (e.g. "sidebar:collapsed", "pax-rail:open") to match the localStorage key
// conventions in use-local-storage-state.ts.
export const uiState = pgTable("ui_state", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  userId: text("user_id").notNull(),
  key: text("key").notNull(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  // Leading-org composite uniqueness — one row per (org, user, key). The
  // hook upserts on this constraint; the leading org column also satisfies
  // the L3 shard-readiness lint (check-org-leading-index.mjs).
  uniqueIndex("ui_state_org_user_key_idx").on(table.organizationId, table.userId, table.key),
]);

export type UiState = typeof uiState.$inferSelect;
export type InsertUiState = typeof uiState.$inferInsert;

// ============================================
// NOTIFICATION PREFERENCES (15.2)
// ============================================

export const NOTIFICATION_EVENT_TYPES = [
  "lead_created",
  "lead_updated", 
  "lead_stage_changed",
  "property_created",
  "property_updated",
  "deal_created",
  "deal_updated",
  "deal_stage_changed",
  "payment_received",
  "payment_overdue",
  "campaign_started",
  "campaign_completed",
  "email_sent",
  "sms_sent",
  "mail_sent",
] as const;

export type NotificationEventType = typeof NOTIFICATION_EVENT_TYPES[number];

export const notificationPreferences = pgTable("notification_preferences", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  eventType: text("event_type").notNull(), // One of NOTIFICATION_EVENT_TYPES
  emailEnabled: boolean("email_enabled").default(true),
  pushEnabled: boolean("push_enabled").default(false),
  inAppEnabled: boolean("in_app_enabled").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertNotificationPreferenceSchema = createInsertSchema(notificationPreferences).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type NotificationPreference = typeof notificationPreferences.$inferSelect;
export type InsertNotificationPreference = z.infer<typeof insertNotificationPreferenceSchema>;

// ============================================
// TASK MANAGEMENT SYSTEM (17.1, 17.2)
// ============================================

// Priority levels for tasks
export const TASK_PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export type TaskPriority = typeof TASK_PRIORITIES[number];

// Status values for tasks
export const TASK_STATUSES = ["pending", "in_progress", "completed", "cancelled"] as const;
export type TaskStatus = typeof TASK_STATUSES[number];

// Entity types that tasks can be linked to
export const TASK_ENTITY_TYPES = ["lead", "property", "deal", "none"] as const;
export type TaskEntityType = typeof TASK_ENTITY_TYPES[number];

// Recurrence rules for recurring tasks
export const TASK_RECURRENCE_RULES = ["daily", "weekly", "monthly", "yearly"] as const;
export type TaskRecurrenceRule = typeof TASK_RECURRENCE_RULES[number];

// Tasks table
export const tasks = pgTable("tasks", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  
  // Core task fields
  title: text("title").notNull(),
  description: text("description"),
  dueDate: timestamp("due_date"),
  priority: text("priority").notNull().default("medium"), // low, medium, high, urgent
  status: text("status").notNull().default("pending"), // pending, in_progress, completed, cancelled
  
  // Assignment
  assignedTo: integer("assigned_to").references(() => teamMembers.id),
  createdBy: text("created_by").notNull(), // User ID who created the task
  
  // Entity linking (optional)
  entityType: text("entity_type").notNull().default("none"), // lead, property, deal, none
  entityId: integer("entity_id"), // ID of the linked entity
  
  // Recurring task fields (17.2)
  isRecurring: boolean("is_recurring").default(false),
  recurrenceRule: text("recurrence_rule"), // daily, weekly, monthly, yearly
  nextOccurrence: timestamp("next_occurrence"),
  parentTaskId: integer("parent_task_id"), // Reference to the original recurring task
  
  // Timestamps
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Insert schema
export const insertTaskSchema = createInsertSchema(tasks).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  completedAt: true,
});

// Types
export type Task = typeof tasks.$inferSelect;
export type InsertTask = z.infer<typeof insertTaskSchema>;

// ============================================
// COMPLIANCE: AUDIT LOG (20.1)
// ============================================

// ─── Production deploy ledger (Kareem §5, SOC 2 CC8.1) ───────────────────────
// Every prod deploy lands a row here, recording GIT_SHA, actor, PR ID,
// timestamp, and the GitHub workflow run URL. The deploy workflow POSTs to
// /api/admin/deployments after a successful flyctl deploy; the endpoint is
// authenticated by a deploy-bot token from the workflow environment.
// Auditors can pull `SELECT * FROM deployments ORDER BY deployed_at DESC`
// and tie every production change back to a PR + approver in GitHub.
export const deployments = pgTable("deployments", {
  id: serial("id").primaryKey(),
  gitSha: text("git_sha").notNull(),
  prNumber: integer("pr_number"),
  approvedBy: text("approved_by"),
  deployedBy: text("deployed_by").notNull(),
  workflowRunUrl: text("workflow_run_url"),
  flyMachineIds: text("fly_machine_ids"),
  environment: text("environment").notNull().default("production"),
  status: text("status").notNull().default("success"),
  rollbackOfDeploymentId: integer("rollback_of_deployment_id"),
  deployedAt: timestamp("deployed_at").notNull().defaultNow(),
  notes: text("notes"),
}, (table) => ({
  byGitSha: index("deployments_git_sha_idx").on(table.gitSha),
  byDeployedAt: index("deployments_deployed_at_idx").on(table.deployedAt),
}));

export type Deployment = typeof deployments.$inferSelect;
export type InsertDeployment = typeof deployments.$inferInsert;

// ─── DR drill ledger (Kareem §7, SOC 2 A1.2) ─────────────────────────────────
// Quarterly DR drill measurements per docs/runbooks/dr-drill-quarterly.md.
// Surfaces on /api/jobs/health as a staleness check so the founder sees a
// red badge if the last drill is > 100 days old.
export const drDrills = pgTable("dr_drills", {
  id: serial("id").primaryKey(),
  ranAt: timestamp("ran_at").notNull().defaultNow(),
  ranBy: text("ran_by").notNull(),
  snapshotAgeHours: integer("snapshot_age_hours"),
  restoreMinutes: integer("restore_minutes"),
  bootMinutes: integer("boot_minutes"),
  syntheticCheckMinutes: integer("synthetic_check_minutes"),
  dataVerifyMinutes: integer("data_verify_minutes"),
  totalRtoMinutes: integer("total_rto_minutes").notNull(),
  passedRtoTarget: boolean("passed_rto_target").notNull().default(false),
  whatWentWrong: text("what_went_wrong"),
  whatsFlaky: text("whats_flaky"),
  actionItems: text("action_items"),
  postmortemRef: text("postmortem_ref"),
}, (table) => ({
  byRanAt: index("dr_drills_ran_at_idx").on(table.ranAt),
}));

export type DrDrill = typeof drDrills.$inferSelect;
export type InsertDrDrill = typeof drDrills.$inferInsert;

// ─── Audit-log integrity (Kareem §1, SOC 2 CC7.2 / CC7.3) ────────────────────
// Every row is SHA-256 chained to the previous row in the same organization.
// Tamper-evident: an auditor can replay the chain (or hit
// /api/admin/audit-log/verify) and detect any UPDATE, DELETE, or out-of-band
// INSERT. The chain is per-organizationId so a single bad-tenant insert
// cannot invalidate the chain for another tenant. Genesis row's prev_hash is
// the literal string 'GENESIS' (rather than NULL) so the hash function has a
// deterministic input even for the first row.
export const auditLog = pgTable("audit_log", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  userId: text("user_id"), // Replit user ID or null for system actions
  action: text("action").notNull(), // create, update, delete, login, export, import, etc.
  entityType: text("entity_type").notNull(), // lead, property, deal, note, campaign, etc.
  entityId: integer("entity_id"), // ID of the affected entity
  changes: jsonb("changes").$type<{
    before?: Record<string, any>;
    after?: Record<string, any>;
    fields?: string[];
  }>(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  metadata: jsonb("metadata").$type<Record<string, any>>(), // Additional context
  createdAt: timestamp("created_at").defaultNow(),
  // SHA-256 chain — computed server-side by createAuditLogEntry(). prev_hash
  // is the hash of the previous row for this org (or 'GENESIS'). row_hash is
  // SHA-256(prev_hash || canonicalJSON({id,action,actor,target,payload,ts})).
  // Both columns are nullable for backfill ergonomics; new inserts always
  // populate them. The migration that adds these columns ships a Postgres
  // trigger preventing UPDATE/DELETE on rows where row_hash IS NOT NULL.
  prevHash: text("prev_hash"),
  rowHash: text("row_hash"),
}, (table) => ({
  byOrgId: index("audit_log_org_id_idx").on(table.organizationId, table.id),
}));

// Simulated actions — every time SIMULATION_MODE short-circuits a real
// external side effect (Stripe charge, Lob mail, Twilio SMS, SendGrid
// email, paid AI call), a row lands here. Lets the founder-testing
// suite verify "did the system decide to spend $X?" without the
// actual $X leaving the building.
export const simulatedActions = pgTable("simulated_actions", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  category: text("category").notNull(), // stripe | lob | sms | email | ai_paid | webhook_outbound | billing_mutation
  action: text("action").notNull(), // e.g. "subscriptions.create", "postcards.create"
  payload: jsonb("payload").$type<Record<string, any>>(),
  simulatedId: text("simulated_id").notNull().unique(), // sim_<ts>_<rand>
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Insert schema
export const insertAuditLogSchema = createInsertSchema(auditLog).omit({
  id: true,
  createdAt: true,
});

// Types
export type AuditLogEntry = typeof auditLog.$inferSelect;
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;

// Lens 13 / Kareem §1: audit-log purge sealing ledger. Every purgeOldAuditLogs
// call writes one row here (cumulative-hash record) + one sealing row into
// audit_log itself, then deletes the underlying rows. The chain verifier
// consults this table to tell documented purges from tampering.
export const auditLogPurges = pgTable("audit_log_purges", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  purgedBefore: timestamp("purged_before").notNull(),
  purgeStartedAt: timestamp("purge_started_at").defaultNow().notNull(),
  purgeCompletedAt: timestamp("purge_completed_at"),
  purgedCount: integer("purged_count").default(0).notNull(),
  // row_hash of the most recent purged row, or null if none were chained.
  lastPurgedRowHash: text("last_purged_row_hash"),
  // SHA-256(row_hash[0] || '\n' || row_hash[1] || '\n' || …) in id order.
  sealingHash: text("sealing_hash"),
  // The audit_log row this purge wrote to document the discontinuity.
  sealingAuditLogId: integer("sealing_audit_log_id"),
  actorUserId: text("actor_user_id"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
}, (table) => ({
  byOrgStartedAt: index("audit_log_purges_org_idx").on(table.organizationId, table.purgeStartedAt),
  bySealing: index("audit_log_purges_sealing_idx").on(table.sealingAuditLogId),
}));

export type AuditLogPurge = typeof auditLogPurges.$inferSelect;
export type InsertAuditLogPurge = typeof auditLogPurges.$inferInsert;

// ─── Coriander §1: Recovery-console audit events ────────────────────────────
// Platform-wide append-only event log for high-risk admin recovery actions
// (2FA reset, session revoke, autopay freeze, ownership transfer, password-
// reset link). Distinct from the org-scoped audit_log table because some
// targets have no owning org (cross-org ownership transfers, account-wide
// 2FA resets). Retention: 7 years; never deleted.
export const auditEvents = pgTable("audit_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  // Beatrice / compliance-debt §2 — monotonic ordering key for the GLOBAL
  // hash chain. audit_events is intentionally org-less (cross-org targets:
  // account-wide 2FA resets, ownership transfers), so unlike audit_log its
  // chain is a single global sequence rather than per-org. The UUID PK is
  // random and cannot order the chain, so `seq` (bigserial) gives the chain
  // walker a deterministic total order. NOT part of the canonical hash payload.
  seq: bigserial("seq", { mode: "number" }),
  actorUserId: text("actor_user_id"),
  actorEmail: text("actor_email"),
  action: text("action").notNull(),
  targetType: text("target_type").notNull(),
  targetId: text("target_id").notNull(),
  justification: text("justification"),
  metadata: jsonb("metadata").$type<Record<string, any>>(),
  ip: text("ip"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  // Beatrice / compliance-debt §2 — SHA-256 hash chain extending the audit_log
  // tamper-evidence scheme to the crown-jewel events (login, MFA-disable,
  // ownership-transfer, refunds, DSAR-erasure). prev_hash is the previous
  // chained row's row_hash (global order by `seq`), or 'GENESIS'. row_hash =
  // SHA-256(prev_hash || '\n' || canonical(payload)). Computed BEFORE insert
  // (see server/utils/auditEventsChain.ts) because audit_events already carries
  // a blanket append-only UPDATE-deny trigger (migration 0049) — we cannot use
  // audit_log's insert-then-update pattern here, so the row is inserted
  // already-chained in a single statement. Nullable for backfill of pre-chain
  // rows. TAMPER-EVIDENCE, not legal proof.
  prevHash: text("prev_hash"),
  rowHash: text("row_hash"),
}, (table) => [
  index("idx_audit_events_actor").on(table.actorUserId),
  index("idx_audit_events_target").on(table.targetType, table.targetId),
  index("idx_audit_events_action").on(table.action),
  index("idx_audit_events_created_at").on(table.createdAt),
  // P1-15 (Phase 3 Week 7-8) — Coriander recovery-console views filter by
  // action and order by created_at DESC. Migration: 0045_index_audit.sql.
  index("audit_events_action_created_idx").on(table.action, table.createdAt),
  // Beatrice / compliance-debt §2 — chain walker reads the latest chained row
  // (max seq where row_hash IS NOT NULL) and walks ascending by seq.
  index("audit_events_seq_chain_idx").on(table.seq),
]);

export type AuditEvent = typeof auditEvents.$inferSelect;
export type InsertAuditEvent = typeof auditEvents.$inferInsert;

// ─── Tahoe / Beatrice: customer-visible security activity log ───────────────
// A per-org, customer-READABLE log of security- and data-significant events:
// logins, data exports, member invite/remove, role changes, billing changes,
// subscription pause/cancel, API-key issuance. Distinct from:
//   - audit_log     (entity CRUD, hash-chained, surfaced to the customer's
//                    compliance tab as a per-record change history)
//   - audit_events  (founder/recovery-console internal forensic log, 7-yr)
// This table is the "Security activity" view the customer sees in Settings.
// It is org-scoped (every row carries organization_id), append-only by
// convention (we never UPDATE/DELETE from app code), and its `metadata` is
// always written through redactByClassification() so PII / financial values
// are labelled rather than stored in the clear.
export const customerAuditLog = pgTable("customer_audit_log", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id")
    .references(() => organizations.id, { onDelete: "cascade" })
    .notNull(),
  // The user who performed the action (Clerk/Replit user id) or null for
  // system-initiated events (e.g. a Stripe-webhook-confirmed cancellation).
  actorUserId: text("actor_user_id"),
  actorEmail: text("actor_email"),
  // Dot-namespaced, mirrors CustomerAuditActions in server/utils/customerAudit.ts
  // e.g. "auth.login", "member.invited", "billing.autopay_toggled".
  action: text("action").notNull(),
  // Short, customer-facing category for grouping/filtering in the UI.
  category: text("category").notNull(), // auth | members | billing | data | security
  // Optional human-readable target descriptor, e.g. invited member email.
  targetLabel: text("target_label"),
  // Class-labelled metadata — written via redactByClassification(..,{label:true}).
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  // Org-leading composite index — customer view filters by org and orders by
  // recency (check-org-leading-index.mjs requires org as the leading column).
  byOrgCreated: index("customer_audit_log_org_created_idx").on(
    table.organizationId,
    table.createdAt,
  ),
  byOrgCategory: index("customer_audit_log_org_category_idx").on(
    table.organizationId,
    table.category,
  ),
}));

export const insertCustomerAuditLogSchema = createInsertSchema(customerAuditLog).omit({
  id: true,
  createdAt: true,
});

export type CustomerAuditLogEntry = typeof customerAuditLog.$inferSelect;
export type InsertCustomerAuditLog = z.infer<typeof insertCustomerAuditLogSchema>;

// ─── Phase 3 Week 11: GDPR/CCPA Data Subject Access Requests ──────────────
// Public DSAR intake; rows are operator-driven post-receipt. Customers can
// request access, erasure, portability, or rectification. Founder reviews
// each request, runs identity verification (email-loop), and either fulfils
// (data fan-out) or denies (with documented reason).
export const dsarRequests = pgTable("dsar_requests", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  requestType: text("request_type").notNull(), // access | erasure | portability | rectification
  email: text("email").notNull(),
  fullName: text("full_name").notNull(),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "set null" }),
  organization: text("organization"),
  justification: text("justification"),
  status: text("status").notNull().default("pending"), // pending | verified | fulfilling | completed | denied
  verificationToken: text("verification_token"),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  deniedReason: text("denied_reason"),
  ip: text("ip"),
  userAgent: text("user_agent"),
  metadata: jsonb("metadata").$type<Record<string, any>>().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("idx_dsar_requests_email").on(table.email),
  index("idx_dsar_requests_status").on(table.status),
  index("idx_dsar_requests_created_at").on(table.createdAt),
  index("idx_dsar_requests_org").on(table.organizationId),
]);

export type DsarRequest = typeof dsarRequests.$inferSelect;
export type InsertDsarRequest = typeof dsarRequests.$inferInsert;

export const DSAR_REQUEST_TYPES = ["access", "erasure", "portability", "rectification"] as const;
export type DsarRequestType = typeof DSAR_REQUEST_TYPES[number];

export const DSAR_STATUSES = ["pending", "verified", "fulfilling", "completed", "denied"] as const;
export type DsarStatus = typeof DSAR_STATUSES[number];

// ─── Phase 3 Week 11: Legal-Hold Mechanism (Saskia, Lazlo, Margolis) ──────
// FRCP 37(e) — when litigation is reasonably anticipated, automatic retention
// must NOT delete potentially-relevant data. legal_holds is the authoritative
// record of which orgs / leads / properties / users are frozen against delete.
//
// A hold is "active" when status='active' AND releasedAt IS NULL. Every
// retention sweep + every db.delete() of a covered resource type calls
// `assertNotUnderLegalHold` from server/services/legalHold.ts.
export const legalHolds = pgTable("legal_holds", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "restrict" }),
  caseRef: text("case_ref").notNull(),                        // court docket # / matter # / internal ticket
  scope: text("scope").notNull(),                              // org_wide | lead_specific | property_specific | user_specific
  scopeIds: text("scope_ids").array().notNull().default(sql`'{}'::text[]`),
  placedAt: timestamp("placed_at", { withTimezone: true }).notNull().defaultNow(),
  placedBy: varchar("placed_by").references(() => users.id, { onDelete: "set null" }),
  releasedAt: timestamp("released_at", { withTimezone: true }),
  releaseReason: text("release_reason"),
  notes: text("notes"),
  status: text("status").notNull().default("active"),          // active | released
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("idx_legal_holds_org_active").on(table.organizationId).where(sql`${table.status} = 'active'`),
  index("idx_legal_holds_status").on(table.status),
  index("idx_legal_holds_placed_at").on(table.placedAt),
  index("idx_legal_holds_case_ref").on(table.caseRef),
]);

export type LegalHold = typeof legalHolds.$inferSelect;
export type InsertLegalHold = typeof legalHolds.$inferInsert;

export const LEGAL_HOLD_SCOPES = ["org_wide", "lead_specific", "property_specific", "user_specific"] as const;
export type LegalHoldScope = typeof LEGAL_HOLD_SCOPES[number];

export const LEGAL_HOLD_STATUSES = ["active", "released"] as const;
export type LegalHoldStatus = typeof LEGAL_HOLD_STATUSES[number];

export const LEGAL_HOLD_RESOURCE_TYPES = ["lead", "property", "user", "deal", "audit_log", "communication"] as const;
export type LegalHoldResourceType = typeof LEGAL_HOLD_RESOURCE_TYPES[number];

// ─── Phase 3 Week 11: Data Processing Agreements (sub-processor registry) ──
// Every external vendor that ever touches customer data lives here. The
// founder maintains negotiation status; vendor outreach is a manual
// workstream tracked in the /founder/sub-processors UI.
export const dataProcessingAgreements = pgTable("data_processing_agreements", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  vendorName: text("vendor_name").notNull().unique(),
  status: text("status").notNull().default("pending"), // pending | negotiating | signed | expired
  signedDate: date("signed_date"),
  expiresAt: date("expires_at"),
  contactEmail: text("contact_email"),
  scope: text("scope"),
  evidenceUrl: text("evidence_url"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("idx_dpa_status").on(table.status),
]);

export type DataProcessingAgreement = typeof dataProcessingAgreements.$inferSelect;
export type InsertDataProcessingAgreement = typeof dataProcessingAgreements.$inferInsert;

export const DPA_STATUSES = ["pending", "negotiating", "signed", "expired"] as const;
export type DpaStatus = typeof DPA_STATUSES[number];

// ─── Pillar D / D9 — incident tracking ────────────────────────────────────
//
// Every SEV-1 / SEV-2 incident gets a row here. The post-mortem template
// in /docs/runbooks/_postmortem-template.md drives the long-form write-up;
// this table is the structured index that the founder dashboard reads to
// surface trend, MTTR, and root-cause-category distributions over time.
export const incidents = pgTable("incidents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  severity: text("severity").notNull(),          // SEV-1 | SEV-2 | SEV-3 | SEV-4
  title: text("title").notNull(),
  summary: text("summary").notNull(),
  status: text("status").notNull().default("open"), // open | mitigated | resolved | post_mortem_done
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  detectedAt: timestamp("detected_at", { withTimezone: true }),
  mitigatedAt: timestamp("mitigated_at", { withTimezone: true }),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  detectionSource: text("detection_source"),     // sentry | customer | monitor | internal
  rootCauseCategory: text("root_cause_category"), // db | auth | provider | code | config | dep | infra | other
  rootCauseSummary: text("root_cause_summary"),
  impactSummary: text("impact_summary"),         // customer-visible description
  affectedOrgCount: integer("affected_org_count"),
  estimatedRevenueImpactCents: integer("estimated_revenue_impact_cents"),
  // Post-mortem fields populated after resolution
  postMortemUrl: text("post_mortem_url"),
  lessonsLearned: text("lessons_learned"),
  followupActions: jsonb("followup_actions").$type<Array<{ owner: string; description: string; dueBy?: string; done?: boolean }>>(),
  // Operational
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: text("created_by"),
}, (table) => [
  index("incidents_severity_idx").on(table.severity),
  index("incidents_status_idx").on(table.status),
  index("incidents_started_at_idx").on(table.startedAt),
]);
export const insertIncidentSchema = createInsertSchema(incidents).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type Incident = typeof incidents.$inferSelect;
export type InsertIncident = z.infer<typeof insertIncidentSchema>;

export const INCIDENT_SEVERITIES = ["SEV-1", "SEV-2", "SEV-3", "SEV-4"] as const;
export const INCIDENT_STATUSES = ["open", "mitigated", "resolved", "post_mortem_done"] as const;
export type IncidentSeverity = typeof INCIDENT_SEVERITIES[number];
export type IncidentStatus = typeof INCIDENT_STATUSES[number];

// ─── Pillar E / E5 — Lifecycle events firehose ────────────────────────────
//
// Unified journal of every customer-lifecycle signal — activation,
// onboarding, churn risk transitions, NPS responses, subscription
// state, expansion triggers, etc. Wraps the existing scattered tables
// (activationEvents, retentionEvents, subscriptionHistory, etc.) into
// one append-only stream so cohort + LTV + journey reasoning is a single
// SQL surface instead of five.
//
// Writers use recordLifecycleEvent() (services/lifecycleEvents.ts).
// Backfill from the existing tables is in scripts/backfill-lifecycle-events.ts.
export const lifecycleEvents = pgTable("lifecycle_events", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  userId: text("user_id"),
  // Canonical event types. New ones can be added freely; queries should
  // match by prefix (e.g. "trial.*") when grouping.
  eventType: text("event_type").notNull(),
  // Lightweight stage label for funnel visualization.
  stage: text("stage"), // signup | onboarding | activation | engagement | expansion | risk | churn | reactivation
  // Free-form metadata: source signal, dollar amounts, attribution context.
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
  // Originating table — handy when reverse-mapping a firehose row back
  // to its canonical record. Null if the event is firehose-native.
  sourceTable: text("source_table"),
  sourceId: text("source_id"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("lifecycle_events_org_occurred_idx").on(table.organizationId, table.occurredAt),
  index("lifecycle_events_event_type_idx").on(table.eventType),
  index("lifecycle_events_stage_idx").on(table.stage),
  index("lifecycle_events_occurred_idx").on(table.occurredAt),
]);
export const insertLifecycleEventSchema = createInsertSchema(lifecycleEvents).omit({
  id: true,
  occurredAt: true,
});
export type LifecycleEvent = typeof lifecycleEvents.$inferSelect;
export type InsertLifecycleEvent = z.infer<typeof insertLifecycleEventSchema>;

export const LIFECYCLE_STAGES = [
  "signup",
  "onboarding",
  "activation",
  "engagement",
  "expansion",
  "risk",
  "churn",
  "reactivation",
] as const;
export type LifecycleStage = typeof LIFECYCLE_STAGES[number];

// ─── Pillar E / E4 + E9 — Customer health score ──────────────────────────
//
// Distinct from churn_risk_scores. Churn risk asks "how likely to leave?";
// health asks "how much value is this customer extracting?" An org can
// have low churn risk AND low health (uses the product just enough to
// not churn) — that's the silent-disengaged segment we miss otherwise.
//
// Score breakdown (0–100, higher is healthier):
//   usage_velocity      0–25  — events per week trend (+/-)
//   feature_breadth     0–25  — # of distinct modules with data
//   nps_signal          0–20  — most-recent NPS bucket (promoter/passive/detractor)
//   data_quality        0–15  — % of records with complete required fields
//   pax_engagement      0–15  — Pax conversations or nudges accepted in last 30d
export const customerHealthScores = pgTable("customer_health_scores", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  score: integer("score").notNull(),                       // 0–100
  band: text("band").notNull(),                            // healthy | watch | silent_disengaged | struggling
  usageVelocityPoints: integer("usage_velocity_points").notNull(),
  featureBreadthPoints: integer("feature_breadth_points").notNull(),
  npsSignalPoints: integer("nps_signal_points").notNull(),
  dataQualityPoints: integer("data_quality_points").notNull(),
  paxEngagementPoints: integer("pax_engagement_points").notNull(),
  signals: jsonb("signals").$type<Record<string, unknown>>().default({}),
  calculatedAt: timestamp("calculated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("customer_health_org_idx").on(table.organizationId),
  index("customer_health_band_idx").on(table.band),
  index("customer_health_calc_idx").on(table.calculatedAt),
]);
export const insertCustomerHealthScoreSchema = createInsertSchema(customerHealthScores).omit({
  id: true,
  calculatedAt: true,
});
export type CustomerHealthScore = typeof customerHealthScores.$inferSelect;
export type InsertCustomerHealthScore = z.infer<typeof insertCustomerHealthScoreSchema>;

export const HEALTH_BANDS = ["healthy", "watch", "silent_disengaged", "struggling"] as const;
export type HealthBand = typeof HEALTH_BANDS[number];

// ─── Phase 3 Week 14: Activation + retention telemetry ────────────────────
// (Yuna §8, Konstantin §2). activation_events is the load-bearing table —
// the first occurrence of a canonical event per organisation drives the
// /founder/activation funnel. retention_events, cohort_assignments, and
// churn_reasons are the v0 retention scaffolding.

// Canonical activation events. recordActivationEvent() is idempotent on
// (organizationId, eventName) so the FIRST occurrence wins. Onboarding step
// transitions use the `onboarding_step_${n}_entered` and
// `onboarding_step_${n}_completed` patterns (see onboardingStepEnteredEvent()
// + onboardingStepCompletedEvent() helpers in server/services/activation.ts).
// Per-step bail rate = orgs with `_entered` AND NOT `_completed` for step N.
// Drives the C.2 onboarding-v2 redesign revisit trigger.
export const ACTIVATION_EVENTS = [
  "org_created",
  "first_lead_added",
  "first_property_added",
  "first_letter_sent",
  "first_offer_made",
  "first_deal_closed",
  "first_payment_processed",
  "first_borrower_payment_received",
  "first_1099_generated",
  "first_team_member_invited",
  "onboarding_path_selected",
  // Lenore §1 — value-event telemetry expansion (Lens 5). The 7 below
  // measure first true "aha" moments inside the actual workflows. They
  // are the leading indicators that decide whether day-7 retention will
  // hold. Fire-and-forget at the first successful execution of each path
  // (idempotent via the (orgId, eventName) unique index — no double-counts).
  //
  // Notes on overlap:
  //   - first_mailer_sent is intentionally distinct from first_letter_sent:
  //     `letter_sent` fires from the postcard/letter direct-mail path; the
  //     new `mailer_sent` fires from the email/SMS campaign send path.
  //   - first_payment_recorded is distinct from first_payment_processed
  //     (Stripe subscription) and first_borrower_payment_received: this
  //     one fires the first time the user MANUALLY records a payment in
  //     bookkeeping (the funnel needs to see "they're using the books",
  //     not "we charged them" or "Stripe webhook fired").
  //   - first_deal_closed already exists above; the brief's listing it
  //     a second time is intentional (we want it in the day-7/day-30
  //     surface) but we re-use the existing canonical event rather
  //     than mint a duplicate.
  "first_lead_enriched",
  "first_comp_run",
  "first_offer_drafted",
  "first_motivation_score_seen",
  "first_pax_question_asked",
  "first_mailer_sent",
  "first_payment_recorded",
  // Tier 2C (2026-06-10) — server-side funnel truth. These two were
  // previously CLIENT-emitted PostHog events (settings.tsx fired
  // trial_to_paid off the ?subscription=success redirect; use-onboarding
  // fired first_value_reached off onboarding completion), which made the
  // revenue + activation funnel steps spoofable, ad-blockable, and
  // detached from what actually happened. Now:
  //   trial_to_paid       — emitted by the Stripe webhook
  //                         (processSubscriptionCheckoutCompleted), the
  //                         same place first_payment_processed is recorded.
  //   first_value_reached — emitted by the approval kernel at the org's
  //                         first WITNESSED send (the append-only pax_sends
  //                         insert), not at "clicked through onboarding".
  // Both are first-occurrence-idempotent via the (org, eventName) unique
  // index like every other activation event.
  "trial_to_paid",
  "first_value_reached",
  // TTFM North-Star companion (2026-07-03) — the magic moment: a SELLER
  // answered. Mail out the door is our effort; this is the market talking
  // back, and it's the event that decides whether a trial becomes a
  // believer. Fired at the two inbound seams (reply-email webhook, inbound
  // SMS webhook) with eventValue.channel = "email" | "sms".
  "first_seller_response",
] as const;
export type ActivationEvent =
  | typeof ACTIVATION_EVENTS[number]
  | `onboarding_step_${number}_entered`
  | `onboarding_step_${number}_completed`;

export const activationEvents = pgTable("activation_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: text("user_id"),
  eventName: text("event_name").notNull(),
  eventValue: jsonb("event_value").$type<Record<string, any>>().default({}),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("activation_events_org_event_unique").on(table.organizationId, table.eventName),
  index("idx_activation_events_org").on(table.organizationId),
  index("idx_activation_events_event").on(table.eventName),
  index("idx_activation_events_occurred_at").on(table.occurredAt),
]);

export type ActivationEventRow = typeof activationEvents.$inferSelect;
export type InsertActivationEvent = typeof activationEvents.$inferInsert;

// Retention events: multi-row per org. Cohort assignment, reactivation,
// churn warnings/events. Append-only; the timeline matters.
export const RETENTION_EVENT_TYPES = [
  "assigned",
  "reactivated",
  "churn_warning",
  "churned",
  "resurrected",
] as const;
export type RetentionEventType = typeof RETENTION_EVENT_TYPES[number];

export const retentionEvents = pgTable("retention_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: text("user_id"),
  eventType: text("event_type").notNull(),
  cohortName: text("cohort_name"),
  metadata: jsonb("metadata").$type<Record<string, any>>().default({}),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("idx_retention_events_org").on(table.organizationId),
  index("idx_retention_events_type").on(table.eventType),
  index("idx_retention_events_cohort").on(table.cohortName),
  index("idx_retention_events_occurred_at").on(table.occurredAt),
]);

export type RetentionEvent = typeof retentionEvents.$inferSelect;
export type InsertRetentionEvent = typeof retentionEvents.$inferInsert;

// ─── ML training snapshots ─────────────────────────────────────────────────
// Phase 3 Week 12 (Magnus §1). Captures labels + feature snapshots so
// future model training has a labelled dataset to train on. Model training
// itself is deferred to month 18+; this is the *measurement infrastructure*.
//
// Five outcome types share the same wide table because the columns are
// identical (labels jsonb, features jsonb) and we want a single helper for
// all writes. See migrations/0058_ml_training_snapshots.sql for the long
// version of why this matters.
export const ML_SNAPSHOT_TYPES = [
  "avm_vs_actual",
  "deal_outcome",
  "lead_conversion",
  "churn_outcome",
  "offer_acceptance",
] as const;
export type MlSnapshotType = typeof ML_SNAPSHOT_TYPES[number];

export const ML_SUBJECT_TYPES = ["deal", "lead", "property", "org"] as const;
export type MlSubjectType = typeof ML_SUBJECT_TYPES[number];

export const mlTrainingSnapshots = pgTable("ml_training_snapshots", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  snapshotType: text("snapshot_type").notNull(),
  subjectType: text("subject_type").notNull(),
  subjectId: text("subject_id").notNull(),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  labels: jsonb("labels").$type<Record<string, any>>().notNull().default({}),
  features: jsonb("features").$type<Record<string, any>>().notNull().default({}),
  decisionAt: timestamp("decision_at", { withTimezone: true }).notNull(),
  outcomeAt: timestamp("outcome_at", { withTimezone: true }),
  metadata: jsonb("metadata").$type<Record<string, any>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("ml_training_snapshots_unique").on(
    table.snapshotType,
    table.subjectType,
    table.subjectId,
    table.decisionAt,
  ),
  index("idx_ml_snapshots_type_org_created").on(
    table.snapshotType,
    table.organizationId,
    table.createdAt,
  ),
  index("idx_ml_snapshots_type_decision").on(table.snapshotType, table.decisionAt),
  index("idx_ml_snapshots_subject").on(table.subjectType, table.subjectId),
  index("idx_ml_snapshots_outcome_at").on(table.outcomeAt),
]);

export type MlTrainingSnapshot = typeof mlTrainingSnapshots.$inferSelect;
export type InsertMlTrainingSnapshot = typeof mlTrainingSnapshots.$inferInsert;

// Cohort assignments: A/B onboarding flow assignment. One row per
// (org, cohortName). The variant column is the load-bearing dimension.
export const cohortAssignments = pgTable("cohort_assignments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  userId: text("user_id"),
  cohortName: text("cohort_name").notNull(),
  variant: text("variant").notNull().default("control"),
  attributes: jsonb("attributes").$type<Record<string, any>>().default({}),
  assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("cohort_assignments_org_cohort_unique").on(table.organizationId, table.cohortName),
  index("idx_cohort_assignments_org").on(table.organizationId),
  index("idx_cohort_assignments_user").on(table.userId),
  index("idx_cohort_assignments_name").on(table.cohortName),
  index("idx_cohort_assignments_variant").on(table.cohortName, table.variant),
]);

export type CohortAssignment = typeof cohortAssignments.$inferSelect;
export type InsertCohortAssignment = typeof cohortAssignments.$inferInsert;

// Churn reasons: exit-survey responses + cancellation rationale.
export const CHURN_PRIMARY_REASONS = [
  "price",
  "missing_feature",
  "switched_competitor",
  "no_fit",
  "support",
  "bug_or_reliability",
  "other",
] as const;
export type ChurnPrimaryReason = typeof CHURN_PRIMARY_REASONS[number];

export const churnReasons = pgTable("churn_reasons", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: text("user_id"),
  churnedAt: timestamp("churned_at", { withTimezone: true }).notNull().defaultNow(),
  primaryReason: text("primary_reason").notNull(),
  freeText: text("free_text"),
  surveyResponse: jsonb("survey_response").$type<Record<string, any>>().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("idx_churn_reasons_org").on(table.organizationId),
  index("idx_churn_reasons_primary").on(table.primaryReason),
  index("idx_churn_reasons_churned_at").on(table.churnedAt),
]);

export type ChurnReason = typeof churnReasons.$inferSelect;
export type InsertChurnReason = typeof churnReasons.$inferInsert;

// Audit action types
export const AUDIT_ACTIONS = [
  "create",
  "update",
  "delete",
  "login",
  "logout",
  "export",
  "import",
  "consent_granted",
  "consent_revoked",
  "data_purge",
] as const;
export type AuditAction = typeof AUDIT_ACTIONS[number];

// Entity types that can be audited
export const AUDITABLE_ENTITIES = [
  "lead",
  "property", 
  "deal",
  "note",
  "payment",
  "campaign",
  "user",
  "organization",
  "settings",
] as const;
export type AuditableEntity = typeof AUDITABLE_ENTITIES[number];

// ============================================
// TEAM MESSAGING SYSTEM
// ============================================

// Team conversations (direct messages or group chats)
export const teamConversations = pgTable("team_conversations", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  name: text("name"), // null for direct messages, set for group chats
  isDirect: boolean("is_direct").notNull().default(true), // true for 1-on-1, false for group
  createdBy: text("created_by").notNull(), // Replit user ID
  participantIds: jsonb("participant_ids").$type<string[]>().notNull(), // Array of Replit user IDs
  status: text("status").notNull().default("active"), // active, archived
  lastMessageAt: timestamp("last_message_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertTeamConversationSchema = createInsertSchema(teamConversations).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  lastMessageAt: true,
});
export type InsertTeamConversation = z.infer<typeof insertTeamConversationSchema>;
export type TeamConversation = typeof teamConversations.$inferSelect;

// Team messages within conversations
export const teamMessages = pgTable("team_messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").references(() => teamConversations.id).notNull(),
  senderId: text("sender_id").notNull(), // Replit user ID
  body: text("body").notNull(),
  attachments: jsonb("attachments").$type<{
    type: string;
    url: string;
    name: string;
    size?: number;
  }[]>(),
  readBy: jsonb("read_by").$type<{ 
    userId: string; 
    readAt: string; 
  }[]>().default([]),
  isDeleted: boolean("is_deleted").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertTeamMessageSchema = createInsertSchema(teamMessages).omit({
  id: true,
  createdAt: true,
  readBy: true,
  isDeleted: true,
});
export type InsertTeamMessage = z.infer<typeof insertTeamMessageSchema>;
export type TeamMessage = typeof teamMessages.$inferSelect;

// Team member presence/status for online indicators
export const teamMemberPresence = pgTable("team_member_presence", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  userId: text("user_id").notNull(), // Replit user ID
  status: text("status").notNull().default("offline"), // online, away, offline
  lastSeenAt: timestamp("last_seen_at").defaultNow(),
  deviceInfo: text("device_info"), // desktop, mobile, etc.
});

export const insertTeamMemberPresenceSchema = createInsertSchema(teamMemberPresence).omit({
  id: true,
});
export type InsertTeamMemberPresence = z.infer<typeof insertTeamMemberPresenceSchema>;
export type TeamMemberPresence = typeof teamMemberPresence.$inferSelect;

// ============================================
// ACQUISITION: TARGET COUNTIES & DATA SOURCES
// ============================================

export const targetCounties = pgTable("target_counties", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  name: text("name").notNull(),
  state: text("state").notNull(),
  fipsCode: text("fips_code"),
  population: integer("population"),
  medianHomeValue: numeric("median_home_value"),
  averageLotPrice: numeric("average_lot_price"),
  status: text("status").notNull().default("researching"), // researching, active, paused, exhausted
  priority: integer("priority").default(1), // 1-5, 1 being highest
  notes: text("notes"),
  // Marcus TD-5: "Per-county 'clerk profile' notes. Free-text notes I add:
  // 'Shelby clerk's office accepts wires only, deposit due 24h before sale,
  // opens at 10 AM Tuesday, lot list posted at 9:30 AM, no proxy bidding,
  // deeds recorded next-day if paid by 2 PM.' Every operator has these."
  // Structured so the UI can render labeled fields, but freeform 'general'
  // captures the long-tail.
  clerkProfile: jsonb("clerk_profile").$type<{
    acceptedPaymentMethods?: string[];   // wires_only, cash, certified_check, etc.
    depositTimingHours?: number;          // hrs before sale deposit due
    opensAt?: string;                     // "10:00" local
    lotListPostedAt?: string;             // "09:30" local
    proxyBiddingAllowed?: boolean;
    deedRecordationLagHours?: number;     // hours after payment
    clerkContact?: { name?: string; phone?: string; email?: string };
    general?: string;                     // freeform overflow
  }>(),
  dataSources: jsonb("data_sources").$type<{
    name: string;
    type: string; // tax_delinquent, probate, vacant, absentee
    lastPulled?: string;
    recordCount?: number;
    cost?: number;
    url?: string;
  }[]>(),
  metrics: jsonb("metrics").$type<{
    leadsGenerated?: number;
    dealsCompleted?: number;
    responseRate?: number;
    averageProfit?: number;
  }>(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertTargetCountySchema = createInsertSchema(targetCounties).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertTargetCounty = z.infer<typeof insertTargetCountySchema>;
export type TargetCounty = typeof targetCounties.$inferSelect;

// ============================================
// COUNTY GIS ENDPOINTS (Free Parcel Data Sources)
// ============================================

// Global registry of county GIS endpoints for free parcel lookups
export const countyGisEndpoints = pgTable("county_gis_endpoints", {
  id: serial("id").primaryKey(),
  state: text("state").notNull(), // 2-letter state code (TX, NM, AZ, etc.)
  county: text("county").notNull(), // County name
  fipsCode: text("fips_code"), // 5-digit FIPS code
  
  // Endpoint configuration
  endpointType: text("endpoint_type").notNull().default("arcgis_rest"), // arcgis_rest, arcgis_feature, wfs, direct_api
  baseUrl: text("base_url").notNull(), // Base URL for the GIS service
  layerId: text("layer_id"), // Layer ID for ArcGIS services
  
  // Query configuration
  apnField: text("apn_field").default("APN"), // Field name for parcel number
  ownerField: text("owner_field").default("OWNER"), // Field name for owner
  geometryField: text("geometry_field"), // Geometry field if different from default
  additionalParams: jsonb("additional_params").$type<Record<string, string>>(), // Extra query parameters
  
  // Field mappings (map county fields to our standard schema)
  fieldMappings: jsonb("field_mappings").$type<{
    apn?: string;
    owner?: string;
    address?: string;
    acres?: string;
    assessedValue?: string;
    taxAmount?: string;
    legalDescription?: string;
    zoning?: string;
    // Tier 2A widened facts — gisWidenedFacts() in parcel.ts already reads
    // these mapping keys; declared here so seeds can set them type-safely.
    marketValue?: string;
    taxStatus?: string;
    lastSalePrice?: string;
    lastSaleDate?: string;
  }>(),
  
  // Status
  isVerified: boolean("is_verified").default(false), // Has this endpoint been verified to work?
  lastVerified: timestamp("last_verified"),
  isActive: boolean("is_active").default(true),
  errorCount: integer("error_count").default(0), // Track failures
  lastError: text("last_error"),
  
  // Attribution
  sourceUrl: text("source_url"), // URL to the county's GIS website
  notes: text("notes"),
  contributedBy: text("contributed_by"), // Who added this endpoint

  // ── Data licensing (Beatrice, migration 0120) ──
  // County portal terms vary by jurisdiction. Every row ships
  // redistributable='review-required' until a human reads the specific
  // county's terms-of-use and flips it. The registry refuses to
  // bulk-cache/redistribute anything not 'yes'/'attribution' — un-reviewed
  // counties are live-passthrough only.
  license: text("license").default("county-tos"), // public-domain-usgov | cc0 | cc-by | odbl | county-tos | proprietary
  attribution: text("attribution"), // required attribution string, if any
  termsUrl: text("terms_url"), // URL to the county's terms-of-use page
  redistributable: text("redistributable").notNull().default("review-required"), // yes | attribution | no | review-required
  reviewedAt: timestamp("reviewed_at"), // when a human reviewed the terms
  reviewedBy: text("reviewed_by"), // who reviewed the terms

  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertCountyGisEndpointSchema = createInsertSchema(countyGisEndpoints).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertCountyGisEndpoint = z.infer<typeof insertCountyGisEndpointSchema>;
export type CountyGisEndpoint = typeof countyGisEndpoints.$inferSelect;

// ============================================
// COUNTY DISCOVERY QUEUE (Iris/Iyari — demand-driven coverage growth)
// ============================================
//
// When a parcel lookup misses for an unseeded county, we enqueue that
// (state, county) here. A background worker job drains the queue: runs the
// ArcGIS discovery search, probes a candidate /query endpoint for an
// APN-shaped field, auto-populates field mappings, inserts the
// county_gis_endpoints row as isActive=false + redistributable='review-required'
// (Beatrice rule — un-reviewed counties are live-passthrough only), and flips
// isActive only after the endpoint returns a real feature for a test APN.
//
// GLOBAL infra table (no organization_id) — coverage is shared across all
// orgs, so the work queue is not tenant-scoped. demandCount is incremented on
// every additional miss/request so the worker crawls the counties customers
// are actually in, not alphabetically. The customer-facing "request this
// county" CTA also bumps demandCount + flips priority.
export const countyDiscoveryQueue = pgTable("county_discovery_queue", {
  id: serial("id").primaryKey(),
  state: text("state").notNull(), // 2-letter state code, uppercased
  county: text("county").notNull(), // normalized county name (lowercased, no " county" suffix)

  // Demand signal — drives the crawl order.
  demandCount: integer("demand_count").notNull().default(1), // # of misses/requests seen
  priority: integer("priority").notNull().default(0), // 0 = normal, higher = jump the queue (customer-requested)
  firstRequestedBy: integer("first_requested_by").references(() => organizations.id), // org that first triggered (nullable — system misses have none)

  // Lifecycle: pending → in_progress → (resolved | failed | exhausted)
  // resolved   = an active county_gis_endpoints row now exists for this county
  // failed     = last attempt errored (will retry with backoff)
  // exhausted  = maxAttempts reached, no working endpoint found
  status: text("status").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(5),

  lastAttemptAt: timestamp("last_attempt_at"),
  lastResult: text("last_result"), // human-readable outcome of the last attempt
  resolvedEndpointId: integer("resolved_endpoint_id").references(() => countyGisEndpoints.id), // set when status=resolved

  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  // One queue row per (state, county) — enqueue is an upsert that bumps demand.
  uniqueIndex("county_discovery_queue_state_county_uidx").on(table.state, table.county),
  // Worker drain order: pending first, highest priority + demand first.
  index("county_discovery_queue_drain_idx").on(table.status, table.priority, table.demandCount),
]);

export const insertCountyDiscoveryQueueSchema = createInsertSchema(countyDiscoveryQueue).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertCountyDiscoveryQueue = z.infer<typeof insertCountyDiscoveryQueueSchema>;
export type CountyDiscoveryQueue = typeof countyDiscoveryQueue.$inferSelect;

// ============================================
// PUBLIC PARCEL REPORTS (Tier 3A — /p/:state/:county/:apn permalinks)
// ============================================
//
// Saved, shareable public parcel reports (migration 0156, elevation blueprint
// 3A). Each row IS the cache for one permalink: free/government-data parcel
// facts + the honest PARTIAL Land Credit Score computed from those facts only.
// No org linkage by design — these are pre-signup acquisition surfaces.
//
// Honesty + licensing contract:
//  - facts carry only free-tier sources (the generation path is hard-capped to
//    maxTier:"free" through resolveParcel; paid/byok providers are structurally
//    unreachable — see server/services/publicParcelReport.ts).
//  - County-assessor attributes (owner, tax, assessed value) are persisted ONLY
//    when the county's county_gis_endpoints row says redistributable in
//    ('yes','attribution') (Beatrice rule: un-reviewed counties are
//    live-passthrough only — a saved public page is redistribution).
//  - lcs locked dimensions carry score:null, never an invented value.

/** One free-data fact category as rendered on the public report. */
export interface PublicReportFactCategory {
  category: string; // flood_zone | soil | elevation | wetlands
  available: boolean;
  data: unknown; // raw free-source payload (zone, soilType, elevationFeet, …)
  source: string | null; // e.g. "FEMA NFHL" — named even when empty
  sourceAsOf: string | null;
  classification: "authoritative" | "estimate" | "modeled" | "unknown";
  fromCache: boolean;
}

export interface PublicReportFacts {
  parcel: {
    apn: string;
    state: string;
    county: string;
    acres: number | null;
    centroid: { lat: number; lng: number } | null;
    /**
     * included            — county attributes persisted (license allows)
     * not-redistributable — county record exists; terms not yet reviewed →
     *                       attributes intentionally omitted from the page
     * unavailable         — no free county source matched this APN
     */
    countyAttributes: "included" | "not-redistributable" | "unavailable";
    /** Required attribution string when countyAttributes === "included". */
    attribution: string | null;
    /** Present only when countyAttributes === "included". */
    assessorData?: Record<string, unknown> | null;
  };
  categories: PublicReportFactCategory[];
}

export type PublicLcsDimensionKey =
  | "location"
  | "physical"
  | "legal"
  | "financial"
  | "environmental"
  | "market";

export interface PublicLcsDimension {
  key: PublicLcsDimensionKey;
  label: string;
  weight: number; // canonical LCS weight (sums to 100 across all six)
  status: "scored" | "locked";
  /** 0–100 when scored; ALWAYS null when locked (honesty invariant). */
  score: number | null;
  /** Sub-factors actually informed by free government data. */
  coverage: string[];
  /** Sub-factors that need full-AcreOS data — named, never guessed. */
  missing: string[];
  /** Government sources backing the scored sub-factors. */
  sources: string[];
}

export interface PublicLcs {
  kind: "partial";
  basis: "government-data-only";
  scoredDimensions: number;
  totalDimensions: number;
  /**
   * Share of total LCS dimension weight covered by the scored dimensions,
   * 0–100 rounded (sum of scored-dimension weights ÷ total weight × 100).
   * Quantifies HOW partial the partial score is — a 2-of-6 score that covers
   * 30% of scoring weight is honestly different from one that covers 70%.
   */
  weightCoveredPct: number;
  /** 300–850 over scored dimensions only (weights renormalized); null when nothing scored. */
  partialScore: number | null;
  partialGrade: string | null;
  dimensions: PublicLcsDimension[];
  modelVersion: string;
  computedAt: string;
  /**
   * Standing disclaimer legend (L1 liability shield) — the score travels
   * with its "informational analysis, not a consumer credit score" framing
   * wherever the JSON is rendered or forwarded. Optional because rows
   * generated before the legend shipped don't carry it; the public API
   * route also attaches the legend at the response level for those.
   */
  disclaimer?: string;
}

export const publicParcelReports = pgTable("public_parcel_reports", {
  id: serial("id").primaryKey(),

  // Permalink identity: /p/:state/:county/:apn → (state, county_slug, apn_key).
  state: text("state").notNull(), // 2-letter, uppercased
  countySlug: text("county_slug").notNull(), // lowercased, hyphenated, no " county"
  countyLabel: text("county_label").notNull(), // display form, e.g. "Travis"
  apn: text("apn").notNull(), // display form as entered/normalized
  apnKey: text("apn_key").notNull(), // comparison key: uppercase alphanumerics only

  facts: jsonb("facts").$type<PublicReportFacts>().notNull(),
  lcs: jsonb("lcs").$type<PublicLcs>().notNull(),

  // Centroid duplicated out of facts for cheap geo queries / refresh.
  latitude: real("latitude"),
  longitude: real("longitude"),

  // Server-side truth for report consumption (client analytics is supplemental).
  viewCount: integer("view_count").notNull().default(0),
  lastViewedAt: timestamp("last_viewed_at", { withTimezone: true }),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  refreshedAt: timestamp("refreshed_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("public_parcel_reports_identity_uq").on(table.state, table.countySlug, table.apnKey),
  // Daily generation-cap counts + sitemap ordering.
  index("public_parcel_reports_created_idx").on(table.createdAt),
  index("public_parcel_reports_refreshed_idx").on(table.refreshedAt),
]);

export const insertPublicParcelReportSchema = createInsertSchema(publicParcelReports).omit({
  id: true,
  createdAt: true,
  refreshedAt: true,
});
export type InsertPublicParcelReport = z.infer<typeof insertPublicParcelReportSchema>;
export type PublicParcelReport = typeof publicParcelReports.$inferSelect;

// ============================================
// COUNTY COVERAGE REQUEST (customer-facing "request this county" CTA)
// ============================================
//
// Captures a customer's explicit (state, county) coverage request on a
// no-endpoint miss. The maps agent renders the CTA that POSTs to the
// request-county API; this is the org-scoped audit trail of who asked for
// what, so we can (a) prioritise discovery against real demand, and
// (b) notify the org when their county comes online later. The actual
// discovery work is tracked in county_discovery_queue (global); this table is
// the per-org request ledger.
export const countyCoverageRequests = pgTable("county_coverage_requests", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  requestedByUserId: text("requested_by_user_id"), // who clicked the CTA
  state: text("state").notNull(),
  county: text("county").notNull(),
  // Mirrors the queue lifecycle so the org can be told "pending" vs "covered".
  status: text("status").notNull().default("pending"), // pending | covered | unavailable
  queueId: integer("queue_id").references(() => countyDiscoveryQueue.id), // link to the global discovery work
  notifiedAt: timestamp("notified_at"), // when we told the org their county came online
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  // Leading-org composite index (L3 shard-readiness lint).
  index("county_coverage_requests_org_created_idx").on(table.organizationId, table.createdAt),
  index("county_coverage_requests_org_state_county_idx").on(table.organizationId, table.state, table.county),
]);

export const insertCountyCoverageRequestSchema = createInsertSchema(countyCoverageRequests).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertCountyCoverageRequest = z.infer<typeof insertCountyCoverageRequestSchema>;
export type CountyCoverageRequest = typeof countyCoverageRequests.$inferSelect;

// ============================================
// PARCEL SNAPSHOTS (Centralized Parcel Cache)
// ============================================

export const parcelSnapshots = pgTable("parcel_snapshots", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id), // null = global/shared cache
  
  // Parcel identification
  apn: text("apn").notNull(),
  state: text("state").notNull(), // 2-letter state code
  county: text("county").notNull(),
  fipsCode: text("fips_code"),
  
  // Data source
  source: text("source").notNull().default("regrid"), // county_gis, regrid, manual
  sourceId: text("source_id"), // External ID from the source (regrid_id, etc)
  
  // Geometry
  boundary: jsonb("boundary").$type<{
    type: "Polygon" | "MultiPolygon";
    coordinates: number[][][] | number[][][][];
  }>(),
  centroid: jsonb("centroid").$type<{ lat: number; lng: number }>(),
  
  // Property information
  owner: text("owner"),
  ownerAddress: text("owner_address"),
  mailingAddress: text("mailing_address"),
  siteAddress: text("site_address"),
  
  // Parcel details
  acres: numeric("acres"),
  legalDescription: text("legal_description"),
  zoning: text("zoning"),
  landUse: text("land_use"),
  propertyType: text("property_type"),
  
  // Valuation
  assessedValue: numeric("assessed_value"),
  marketValue: numeric("market_value"),
  taxAmount: numeric("tax_amount"),
  taxYear: integer("tax_year"),
  
  // Sales history
  lastSalePrice: numeric("last_sale_price"),
  lastSaleDate: timestamp("last_sale_date"),
  
  // Raw data from source
  rawData: jsonb("raw_data").$type<Record<string, unknown>>(),
  
  // Cache management
  fetchedAt: timestamp("fetched_at").defaultNow(),
  expiresAt: timestamp("expires_at"),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertParcelSnapshotSchema = createInsertSchema(parcelSnapshots).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertParcelSnapshot = z.infer<typeof insertParcelSnapshotSchema>;
export type ParcelSnapshot = typeof parcelSnapshots.$inferSelect;

// ============================================
// PARCEL OBSERVATION LOG (Iyari — the acorn)
// --------------------------------------------
// Append-only, NEVER updated. Every time any path (lookup, ETL, fusion,
// customer edit) sees a fact about a parcel, we write an immutable row.
// `parcel_snapshots` stays the fast "current best view" cache; observations
// become the longitudinal system-of-record the cache is derived from.
//
// The strategic bet: longitudinal parcel facts (assessed value, owner, tax
// status over time) are the one asset you cannot buy retroactively. Capturing
// them costs one async insert per fact today; backfilling later is impossible.
// Rows are written fire-and-forget via server/services/data-cache/observation-log.ts
// and must never block or fail a parcel response.
// ============================================
export const parcelObservations = pgTable("parcel_observations", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id), // null = global/shared observation

  // Parcel identity (denormalized — observations outlive any snapshot row)
  apn: text("apn").notNull(),
  state: text("state").notNull(), // 2-letter state code
  county: text("county").notNull(),

  // The fact: one row per (field) observed at observedAt
  field: text("field").notNull(), // e.g. "owner", "assessed_value", "tax_status", "acres"
  value: jsonb("value").$type<unknown>(), // text/number/object — whatever the field carries

  // Provenance
  source: text("source").notNull(), // county_gis, regrid, rapidapi, fema, fusion, manual, ...
  confidence: real("confidence"), // 0..1, optional

  // When the fact was observed (defaults to insert time)
  observedAt: timestamp("observed_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  // LEADING-org composite (shard-readiness lint): tenant routing is a single
  // index probe. Org-scoped rows scan only this tenant's history.
  index("parcel_observations_org_observed_idx").on(table.organizationId, table.observedAt),
  // Query index for the future owner-change / tax-status delta detector:
  // "latest N observations per (apn, field)" ordered by time.
  index("parcel_observations_apn_field_observed_idx").on(table.apn, table.field, table.observedAt),
]);

export const insertParcelObservationSchema = createInsertSchema(parcelObservations).omit({
  id: true,
  createdAt: true,
});
export type InsertParcelObservation = z.infer<typeof insertParcelObservationSchema>;
export type ParcelObservation = typeof parcelObservations.$inferSelect;

// ============================================
// PARCEL ALERTS (Iyari #5 — owner-change & tax-status delta detector surface)
// --------------------------------------------
// The scheduled diff job (server/services/parcelDeltaDetector.ts) compares the
// latest two observations per (apn, field) in parcel_observations for parcels in
// a customer's pipeline. When a tracked field meaningfully changes — and clears
// the false-positive guard — it writes ONE immutable alert row here and emits the
// matching workflow trigger event (parcel.owner_changed / parcel.tax_status_changed).
//
// This turns the passive observation log into a PROACTIVE lead engine: the
// customer surface ("Owner changed on a parcel in your pipeline") renders from
// this table behind the Today door. Each row carries the before/after values so
// the surface needs no recompute, plus a dedupe key so re-running the job never
// double-fires for the same (apn, field, transition).
//
// Migration 0131. Mirrors scripts/migrate.mjs STATEMENTS.
export const parcelAlerts = pgTable("parcel_alerts", {
  id: serial("id").primaryKey(),
  // Org-scoped — leading-org composite index for shard-readiness.
  organizationId: integer("organization_id")
    .references(() => organizations.id, { onDelete: "cascade" })
    .notNull(),

  // Parcel identity (denormalized — alerts outlive any snapshot/lead row)
  apn: text("apn").notNull(),
  state: text("state").notNull(),
  county: text("county").notNull(),

  // What kind of change this alert represents.
  //   "owner_changed"      — owner / owner_address transitioned
  //   "tax_status_changed" — tax_status / tax_amount transitioned (e.g. delinquent)
  alertType: text("alert_type").notNull(),
  // The underlying observation field that changed (owner, owner_address,
  // tax_status, tax_amount). Disambiguates within an alertType.
  field: text("field").notNull(),

  // Before/after snapshot so the surface renders with zero recompute.
  previousValue: jsonb("previous_value").$type<unknown>(),
  currentValue: jsonb("current_value").$type<unknown>(),

  // Provenance + confidence carried from the observations that produced it.
  source: text("source"), // county_gis, regrid, ...
  confidence: real("confidence"), // 0..1 — false-positive guard score

  // Link back to the pipeline entity that put this parcel on the radar.
  // Either may be null (a parcel can be tracked as a lead and/or a property).
  leadId: integer("lead_id"),
  propertyId: integer("property_id"),

  // Idempotency: stable hash of (apn, field, previous→current transition) so a
  // re-run of the detector never writes a duplicate alert for the same change.
  dedupeKey: text("dedupe_key").notNull(),

  // Read state — customer can mark an alert read.
  isRead: boolean("is_read").notNull().default(false),
  readAt: timestamp("read_at"),

  // When the underlying change was observed, and when we detected it.
  observedAt: timestamp("observed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  // LEADING-org composite (shard-readiness lint): tenant routing is one probe;
  // the customer alert list reads this tenant's newest alerts first.
  index("parcel_alerts_org_created_idx").on(table.organizationId, table.createdAt),
  // Unread-first read path for the badge/count and the "new alerts" list.
  index("parcel_alerts_org_unread_idx").on(table.organizationId, table.isRead, table.createdAt),
  // Idempotency lookup so the detector can skip already-emitted transitions.
  uniqueIndex("parcel_alerts_org_dedupe_uk").on(table.organizationId, table.dedupeKey),
]);

export const insertParcelAlertSchema = createInsertSchema(parcelAlerts).omit({
  id: true,
  createdAt: true,
});
export type InsertParcelAlert = z.infer<typeof insertParcelAlertSchema>;
export type ParcelAlert = typeof parcelAlerts.$inferSelect;

// ============================================
// COUNTY MARKET ROLLUPS (Tier 3F — cross-org data co-op)
// --------------------------------------------
// Privacy-preserving county-level market aggregates computed monthly from
// cross-org observations (parcel_observations density, deals/offer_letters
// pricing, land_credit_scores grades) by the `county_market_rollup` worker
// job (server/services/dataCoop/countyRollupJob.ts).
//
// Privacy model — generalized from marketNetworkContributor:
//   - NO organization column AT ALL (structural org-null: a rollup row cannot
//     link back to a tenant because the linkage does not exist in the schema).
//   - cohort_size records the k backing the row; rows below k=5 are NEVER
//     materialized — computeCountyRollup() returns null below the floor, so
//     the gate lives in the aggregation, not the read path.
//   - every price sample is value-bucketed (nearest $500/acre) BEFORE
//     aggregation so no exact deal is recoverable from a percentile.
// Migration 0157. Mirrors scripts/migrate.mjs STATEMENTS.
// ============================================
export const countyMarketRollups = pgTable("county_market_rollups", {
  id: serial("id").primaryKey(),
  state: text("state").notNull(), // 2-letter state code, uppercased
  county: text("county").notNull(),
  period: text("period").notNull(), // calendar month, "YYYY-MM"
  // CountyRollupMetrics (server/services/dataCoop/privacyRollup.ts) — each
  // sub-metric is independently k-gated and null when its own cohort is thin.
  metrics: jsonb("metrics").$type<Record<string, unknown>>().notNull(),
  // Distinct contributing parcels (cross-org APNs observed in the county) —
  // the k that allowed this row to exist. Always >= 5 by construction.
  cohortSize: integer("cohort_size").notNull(),
  computedAt: timestamp("computed_at").notNull().defaultNow(),
}, (table) => [
  // One row per (state, county, period); the monthly job upserts.
  uniqueIndex("county_market_rollups_state_county_period_uk").on(
    table.state, table.county, table.period,
  ),
  // Map-door browse path: all counties for a state, newest period first.
  index("county_market_rollups_state_period_idx").on(table.state, table.period),
]);

export type CountyMarketRollup = typeof countyMarketRollups.$inferSelect;

// Run ledger for the rollup job — the deadman roster proves the job RAN;
// this proves it PRODUCED. Two consecutive zero-rollup runs raise an
// alert-spine warning (the co-op silently producing nothing is the
// "wired but dark" failure mode).
export const countyRollupRuns = pgTable("county_rollup_runs", {
  id: serial("id").primaryKey(),
  period: text("period").notNull(), // the (most recent) period recomputed
  rollupsWritten: integer("rollups_written").notNull().default(0),
  countiesScanned: integer("counties_scanned").notNull().default(0),
  ranAt: timestamp("ran_at").notNull().defaultNow(),
}, (table) => [
  index("county_rollup_runs_ran_at_idx").on(table.ranAt),
]);

export type CountyRollupRun = typeof countyRollupRuns.$inferSelect;

// Quarterly public market report DRAFTS (Tier 3F foundation). Generated
// server-side from county_market_rollups; founder-reviewable at
// /api/founder/market-reports. NEVER auto-published — witnessed-publish is a
// follow-up; status stays 'draft' until a founder-approval path exists.
export const marketReportDrafts = pgTable("market_report_drafts", {
  id: serial("id").primaryKey(),
  quarter: text("quarter").notNull(), // "YYYY-Q#"
  status: text("status").notNull().default("draft"), // draft (publish path not built yet)
  report: jsonb("report").$type<Record<string, unknown>>().notNull(), // structured JSON artifact
  markdown: text("markdown").notNull(), // rendered markdown artifact
  generatedAt: timestamp("generated_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("market_report_drafts_quarter_uk").on(table.quarter),
]);

export type MarketReportDraft = typeof marketReportDrafts.$inferSelect;

// ============================================
// LAND INTELLIGENCE REPORTS (Iyari #2 — persist the report; seed the corpus)
// --------------------------------------------
// The LIS report (generateLandIntelligenceReport) is otherwise a cold recompute
// against ~8 external APIs on every view. We persist the computed report + its
// per-field provenance + a staleAfter policy so a re-opened parcel renders from
// our store in <100ms, and we ONLY recompute once the report is stale.
//
// Two payoffs for first customers: (a) speed on revisit (investors revisit
// deals across the pipeline), (b) trust — every field already carries its
// {source, fetchedAt} provenance. This store ALSO quietly becomes the eval
// corpus (Iyari #6): a labeled set of free-data reports to diff against paid
// data when MRR justifies a trial.
//
// IMPORTANT: this table wraps the fusion COMPUTATION (store-read / store-write)
// without changing the fusion math. The report column is the verbatim
// LandIntelligenceReport JSON the fusion produced.
// ============================================
export const landIntelligenceReports = pgTable("land_intelligence_reports", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id), // null = global/shared

  // Stable parcel identity / cache key. parcelKey is a normalized hash of the
  // parcel identity (apn+state+county when an apn exists, else rounded
  // lat/lng+acres) so the same parcel maps to one row per org.
  parcelKey: text("parcel_key").notNull(),
  apn: text("apn"),
  state: text("state").notNull(),
  county: text("county").notNull(),
  latitude: numeric("latitude"),
  longitude: numeric("longitude"),
  acres: numeric("acres"),

  // The verbatim computed report (LandIntelligenceReport shape).
  report: jsonb("report").$type<Record<string, unknown>>().notNull(),

  // Per-field provenance lifted from report.fieldProvenance for fast,
  // index-free staleness inspection without parsing the whole report.
  // Shape: { [field]: { source, fetchedAt, classification } }
  fieldProvenance: jsonb("field_provenance").$type<Record<string, {
    source: string;
    fetchedAt: string;
    classification: string;
  }>>(),

  // Composite score snapshot (denormalized for cheap longitudinal queries —
  // "this parcel scored 82 in March and 71 now" without parsing report JSON).
  landIntelligenceScore: integer("land_intelligence_score"),
  recommendation: text("recommendation"),

  // Staleness policy: serve from store while now() < staleAfter; recompute past it.
  computedAt: timestamp("computed_at").notNull().defaultNow(),
  staleAfter: timestamp("stale_after").notNull(),

  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  // LEADING-org composite (shard-readiness lint): tenant routing is one probe.
  index("land_intelligence_reports_org_key_idx").on(table.organizationId, table.parcelKey),
  // Longitudinal lookups for a parcel across time (score-over-time / corpus).
  index("land_intelligence_reports_apn_computed_idx").on(table.apn, table.computedAt),
]);

export const insertLandIntelligenceReportSchema = createInsertSchema(landIntelligenceReports).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertLandIntelligenceReport = z.infer<typeof insertLandIntelligenceReportSchema>;
export type LandIntelligenceReportRow = typeof landIntelligenceReports.$inferSelect;

// ============================================
// PAID-DATA EVAL RESULTS (Iyari #6 + Lena #3)
// ============================================
// Persists each run of the paid-data eval harness (server/services/
// paidDataEvalHarness.ts) so the founder buy-decision surface has a history:
// "Regrid would have flipped M decisions across N parcels in the counties our
// customers worked." A run reads the free LIS corpus read-only and produces a
// field-divergence + decision-flip report; this table is the audit trail of
// those runs (mock/sample today; real trial-window runs later). Storing it lets
// the surface show the latest run instantly without recomputing, and lets us
// compare a real Regrid trial against the mock baseline.
export const paidDataEvalRuns = pgTable("paid_data_eval_runs", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id), // null = whole corpus

  // Which provider produced the paid view ("mock-paid" today; "regrid" later).
  provider: text("provider").notNull(),
  // "sample" (dry-run / mock) or "trial" (real paid-window run).
  mode: text("mode").notNull(),

  // Corpus scoping for this run.
  stateFilter: text("state_filter"),
  totalParcels: integer("total_parcels").notNull(),
  parcelsCompared: integer("parcels_compared").notNull(),
  errors: integer("errors").notNull().default(0),

  // Headline metrics (denormalized for cheap listing/trend without parsing JSON).
  decisionFlipCount: integer("decision_flip_count").notNull().default(0),
  decisionFlipRate: numeric("decision_flip_rate"), // 0–1
  estTrialCostCents: integer("est_trial_cost_cents").notNull().default(0),

  // The verbatim PaidDataEvalResult (field divergence + flip details + buy rec).
  result: jsonb("result").$type<Record<string, unknown>>().notNull(),

  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  // LEADING-org composite (shard-readiness lint): tenant routing is one probe.
  index("paid_data_eval_runs_org_created_idx").on(table.organizationId, table.createdAt),
]);

export const insertPaidDataEvalRunSchema = createInsertSchema(paidDataEvalRuns).omit({
  id: true,
  createdAt: true,
});
export type InsertPaidDataEvalRun = z.infer<typeof insertPaidDataEvalRunSchema>;
export type PaidDataEvalRunRow = typeof paidDataEvalRuns.$inferSelect;

// ============================================
// ACQUISITION: OFFER LETTERS & BLIND OFFERS
// ============================================

export const offerLetters = pgTable("offer_letters", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  leadId: integer("lead_id").references(() => leads.id),
  propertyId: integer("property_id").references(() => properties.id),
  
  offerAmount: numeric("offer_amount").notNull(),
  offerPercent: numeric("offer_percent"), // Percentage of assessed value
  assessedValue: numeric("assessed_value"),
  
  expirationDays: integer("expiration_days").default(30),
  expirationDate: timestamp("expiration_date"),
  
  templateId: text("template_id"),
  letterContent: text("letter_content"),
  
  status: text("status").notNull().default("draft"), // draft, queued, sent, delivered, responded, accepted, rejected, expired
  
  deliveryMethod: text("delivery_method").default("direct_mail"), // direct_mail, email, both
  lobMailingId: text("lob_mailing_id"),
  trackingNumber: text("tracking_number"),
  
  sentAt: timestamp("sent_at"),
  deliveredAt: timestamp("delivered_at"),
  respondedAt: timestamp("responded_at"),
  responseNotes: text("response_notes"),
  
  batchId: text("batch_id"), // Groups offers sent together
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertOfferLetterSchema = createInsertSchema(offerLetters).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertOfferLetter = z.infer<typeof insertOfferLetterSchema>;
export type OfferLetter = typeof offerLetters.$inferSelect;

// Offer letter templates
export const offerTemplates = pgTable("offer_templates", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  name: text("name").notNull(),
  type: text("type").notNull().default("blind_offer"), // blind_offer, follow_up, final_offer
  subject: text("subject"),
  content: text("content").notNull(),
  isDefault: boolean("is_default").default(false),
  variables: jsonb("variables").$type<string[]>(), // Available merge fields
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertOfferTemplateSchema = createInsertSchema(offerTemplates).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertOfferTemplate = z.infer<typeof insertOfferTemplateSchema>;
export type OfferTemplate = typeof offerTemplates.$inferSelect;

// ============================================
// ACQUISITION: SKIP TRACING
// ============================================

export const skipTraces = pgTable("skip_traces", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  leadId: integer("lead_id").references(() => leads.id),

  inputData: jsonb("input_data").$type<{
    name?: string;
    address?: string;
    apn?: string;
    mailingAddress?: string;
  }>(),

  results: jsonb("results").$type<{
    phones?: { number: string; type: string; verified: boolean }[];
    emails?: { email: string; verified: boolean }[];
    addresses?: { address: string; type: string; current: boolean }[];
    relatives?: { name: string; relationship?: string }[];
    employer?: { name: string; address?: string };
    ageRange?: string;
  }>(),

  provider: text("provider"), // realskip, tloxp, batchskip
  status: text("status").notNull().default("pending"), // pending, processing, completed, failed, no_results

  costCents: integer("cost_cents"),
  requestedAt: timestamp("requested_at").defaultNow(),
  completedAt: timestamp("completed_at"),

  createdAt: timestamp("created_at").defaultNow(),

  // FW-WYNNE-1 (push-forward 2026-05-08): permissible-purpose gate.
  // Wynne-Ohaegbu §1: skip-trace is FCRA-adjacent under §1681b(a)(3)(F)
  // legitimate-business-need but the AcreOS operator must claim a purpose
  // and a justification at query time. Gate at route entry, persist here
  // for class-action defense audit trail.
  purposeOfUse: text("purpose_of_use"), // collection|legitimate_business_need|written_consent|account_review
  justification: text("justification"), // free-text, ≥10 chars
  attestingUserId: text("attesting_user_id"),
  attestationVersion: text("attestation_version"),
});

export const insertSkipTraceSchema = createInsertSchema(skipTraces).omit({
  id: true,
  createdAt: true,
});
export type InsertSkipTrace = z.infer<typeof insertSkipTraceSchema>;
export type SkipTrace = typeof skipTraces.$inferSelect;

// ============================================
// DUE DILIGENCE: CHECKLISTS & RESEARCH
// ============================================

export const dueDiligenceChecklists = pgTable("due_diligence_checklists", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  propertyId: integer("property_id").references(() => properties.id).notNull(),
  
  status: text("status").notNull().default("in_progress"), // in_progress, completed, failed
  completedPercent: integer("completed_percent").default(0),
  
  items: jsonb("items").$type<{
    id: string;
    category: string; // title, environmental, zoning, access, utilities, taxes
    name: string;
    status: string; // pending, passed, failed, warning, skipped
    notes?: string;
    dataSource?: string;
    verifiedAt?: string;
    verifiedBy?: string;
    autoVerified?: boolean;
    requiresManualReview?: boolean;
  }[]>(),
  
  floodZone: jsonb("flood_zone").$type<{
    zone?: string; // A, AE, X, etc.
    inFloodplain?: boolean;
    panelNumber?: string;
    effectiveDate?: string;
    source?: string;
  }>(),
  
  wetlands: jsonb("wetlands").$type<{
    hasWetlands?: boolean;
    wetlandType?: string;
    acresAffected?: number;
    source?: string;
    verified?: boolean;
  }>(),
  
  taxInfo: jsonb("tax_info").$type<{
    annualTaxAmount?: number;
    backTaxesOwed?: number;
    taxSaleScheduled?: boolean;
    taxSaleDate?: string;
    assessedValue?: number;
    taxRate?: number;
    paymentHistory?: { year: number; amount: number; status: string }[];
  }>(),
  
  hoaInfo: jsonb("hoa_info").$type<{
    hasHOA?: boolean;
    hoaName?: string;
    monthlyDues?: number;
    specialAssessments?: number;
    restrictions?: string[];
    contactInfo?: string;
  }>(),
  
  deedRestrictions: jsonb("deed_restrictions").$type<{
    hasRestrictions?: boolean;
    restrictions?: string[];
    easements?: string[];
    rightOfWay?: string;
  }>(),
  
  accessInfo: jsonb("access_info").$type<{
    hasLegalAccess?: boolean;
    accessType?: string; // paved, dirt, easement, none
    roadName?: string;
    maintenanceResponsibility?: string;
  }>(),
  
  utilitiesInfo: jsonb("utilities_info").$type<{
    electric?: { available: boolean; provider?: string; distanceFeet?: number };
    water?: { available: boolean; type?: string; provider?: string };
    sewer?: { available: boolean; type?: string };
    gas?: { available: boolean; provider?: string };
    internet?: { available: boolean; providers?: string[] };
  }>(),
  
  assignedTo: integer("assigned_to"),
  startedAt: timestamp("started_at").defaultNow(),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertDueDiligenceChecklistSchema = createInsertSchema(dueDiligenceChecklists).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertDueDiligenceChecklist = z.infer<typeof insertDueDiligenceChecklistSchema>;
export type DueDiligenceChecklist = typeof dueDiligenceChecklists.$inferSelect;

// ============================================
// DISPOSITION: LISTINGS & SYNDICATION
// ============================================

export const propertyListings = pgTable("property_listings", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  propertyId: integer("property_id").references(() => properties.id).notNull(),
  
  title: text("title").notNull(),
  description: text("description"),
  askingPrice: numeric("asking_price").notNull(),
  minimumPrice: numeric("minimum_price"),
  
  sellerFinancingAvailable: boolean("seller_financing_available").default(true),
  downPaymentMin: numeric("down_payment_min"),
  monthlyPaymentMin: numeric("monthly_payment_min"),
  interestRate: numeric("interest_rate"),
  termMonths: integer("term_months"),
  
  photos: jsonb("photos").$type<{
    url: string;
    caption?: string;
    isPrimary?: boolean;
    order?: number;
  }[]>(),
  
  status: text("status").notNull().default("draft"), // draft, active, pending, sold, withdrawn
  
  syndicationTargets: jsonb("syndication_targets").$type<{
    platform: string; // landwatch, landandfarm, lands_of_america, facebook_marketplace, craigslist
    listingId?: string;
    listingUrl?: string;
    status: string; // pending, active, failed, removed
    postedAt?: string;
    expiresAt?: string;
    error?: string;
  }[]>(),
  
  viewCount: integer("view_count").default(0),
  inquiryCount: integer("inquiry_count").default(0),
  
  publishedAt: timestamp("published_at"),
  expiresAt: timestamp("expires_at"),
  soldAt: timestamp("sold_at"),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertPropertyListingSchema = createInsertSchema(propertyListings).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertPropertyListing = z.infer<typeof insertPropertyListingSchema>;
export type PropertyListing = typeof propertyListings.$inferSelect;

// Per-org on/off + sync bookkeeping for each syndication channel (founder
// decision D7, 2026-07-11: build the syndication backend now). The channel
// CATALOG lives in code (listingSyndication.PLATFORMS — names, env keys,
// API availability); this table stores only what varies per org: whether
// the channel is enabled, when it last synced, and the last honest error.
// One row per (org, channel); channels with no row are disabled.
// Migration 0200. Mirrors scripts/migrate.mjs.
export const syndicationChannelStates = pgTable("syndication_channel_states", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  channelId: text("channel_id").notNull(),
  enabled: boolean("enabled").notNull().default(false),
  lastSyncAt: timestamp("last_sync_at"),
  lastSyncError: text("last_sync_error"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("syndication_channel_states_org_channel_idx").on(table.organizationId, table.channelId),
]);

export type SyndicationChannelState = typeof syndicationChannelStates.$inferSelect;
export type InsertSyndicationChannelState = typeof syndicationChannelStates.$inferInsert;

// ============================================
// DOCUMENTS: TEMPLATES & E-SIGNATURES
// ============================================

export const documentTemplates = pgTable("document_templates", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id),
  name: text("name").notNull(),
  type: text("type").notNull(), // purchase_agreement, quit_claim_deed, warranty_deed, assignment_contract, promissory_note, offer_letter
  category: text("category").notNull().default("closing"), // acquisition, closing, financing
  content: text("content").notNull(), // HTML/Markdown template with merge fields
  variables: jsonb("variables").$type<{
    name: string;
    description: string;
    type: string; // text, number, date, currency
    required: boolean;
    defaultValue?: string;
  }[]>(),
  isSystemTemplate: boolean("is_system_template").default(false),
  isActive: boolean("is_active").default(true),
  version: integer("version").default(1),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertDocumentTemplateSchema = createInsertSchema(documentTemplates).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertDocumentTemplate = z.infer<typeof insertDocumentTemplateSchema>;
export type DocumentTemplate = typeof documentTemplates.$inferSelect;

export const generatedDocuments = pgTable("generated_documents", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  templateId: integer("template_id").references(() => documentTemplates.id),
  dealId: integer("deal_id").references(() => deals.id),
  propertyId: integer("property_id").references(() => properties.id),
  leadId: integer("lead_id").references(() => leads.id),
  
  name: text("name").notNull(),
  type: text("type").notNull(),
  content: text("content"), // Generated content
  pdfUrl: text("pdf_url"),
  
  variables: jsonb("variables").$type<Record<string, string | number>>(),
  
  status: text("status").notNull().default("draft"), // draft, pending_signature, partially_signed, signed, final, archived, cancelled
  
  signers: jsonb("signers").$type<{
    id: string;
    name: string;
    email: string;
    role: string; // buyer, seller, witness, notary
    signedAt?: string;
    signatureUrl?: string;
    order?: number;
  }[]>(),
  
  esignProvider: text("esign_provider"), // docusign, hellosign, none
  esignEnvelopeId: text("esign_envelope_id"),
  esignStatus: text("esign_status"),
  
  sentAt: timestamp("sent_at"),
  completedAt: timestamp("completed_at"),
  signedAt: timestamp("signed_at"),
  expiresAt: timestamp("expires_at"),
  
  generatedBy: text("generated_by"), // userId who generated the document
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertGeneratedDocumentSchema = createInsertSchema(generatedDocuments).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertGeneratedDocument = z.infer<typeof insertGeneratedDocumentSchema>;
export type GeneratedDocument = typeof generatedDocuments.$inferSelect;

// ============================================
// NATIVE E-SIGNATURES
// ============================================

export const signatures = pgTable("signatures", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  documentId: integer("document_id").references(() => generatedDocuments.id),
  
  signerName: text("signer_name").notNull(),
  signerEmail: text("signer_email"),
  signerRole: text("signer_role").notNull().default("signer"), // buyer, seller, witness, notary, signer
  
  // Base64 encoded PNG signature image from HTML5 Canvas
  signatureData: text("signature_data").notNull(),
  signatureType: text("signature_type").notNull().default("drawn"), // drawn, typed, uploaded
  
  // IP and device info for audit trail
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  
  // Legal consent
  consentGiven: boolean("consent_given").notNull().default(true),
  consentText: text("consent_text"),

  // SHA-256 hash of the document content at the moment of signing.
  // Provides tamper-evidence: any later mutation of the document content
  // will not match this hash, preserving evidentiary value of the signature.
  documentContentHash: text("document_content_hash"),

  signedAt: timestamp("signed_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertSignatureSchema = createInsertSchema(signatures).omit({
  id: true,
  signedAt: true,
  createdAt: true,
});
export type InsertSignature = z.infer<typeof insertSignatureSchema>;
export type Signature = typeof signatures.$inferSelect;

// ── E-SIGN Act §101(c)(1)(B) consumer-consent audit ──────────────────────
//
// E-SIGN requires that, BEFORE an electronic signature is used on a consumer
// transaction, the consumer affirmatively consent after being given five
// disclosures: (i) hardware/software requirements, (ii) right to receive
// paper copies and any fee, (iii) right to withdraw consent and any
// consequences, (iv) procedures for updating contact information, (v) scope
// statement (which records are covered). Without that capture, the electronic
// signature is arguably unenforceable in the originating state.
//
// This table records the consent event itself (separate from `signatures`
// because consent is per-user, not per-document, and we need an immutable
// evidentiary row even if the user later signs nothing). The user's row also
// carries esign_consented_at + esign_consent_version for fast lookup.
//
// External signers (no users row — HMAC-tokened signing) produce rows here
// keyed by signer_email + document_id so a regulator can trace the consent
// for a borrower we don't have a user account for.
export const signingConsentAudit = pgTable("signing_consent_audit", {
  id: serial("id").primaryKey(),
  // FK to users.id when the consenting party is an authenticated AcreOS
  // user. Null for external signers (HMAC-tokened signing flow); in that
  // case signer_email + document_id is the lookup key.
  userId: varchar("user_id"),
  organizationId: integer("organization_id").references(() => organizations.id),
  // External-signer fields — populated only when userId is null.
  signerEmail: text("signer_email"),
  documentId: integer("document_id").references(() => generatedDocuments.id),
  // Disclosure version pinned to the dialog text the user saw. Format
  // 'YYYY-MM-DD'; bumped when the disclosure copy materially changes.
  disclosureVersion: varchar("disclosure_version", { length: 32 }).notNull(),
  // The five §101(c) disclosure flags — TRUE on all five is the legal
  // minimum. We record them individually so a regulator can verify each
  // box was rendered + acknowledged, not just that "I consented" landed.
  consentedHardwareRequirements: boolean("consented_hardware_requirements").notNull().default(false),
  consentedPaperCopyRight: boolean("consented_paper_copy_right").notNull().default(false),
  consentedWithdrawalRight: boolean("consented_withdrawal_right").notNull().default(false),
  consentedContactUpdate: boolean("consented_contact_update").notNull().default(false),
  consentedScope: boolean("consented_scope").notNull().default(false),
  // IP + user-agent of the consent capture itself. Required for the
  // tamper-evidence chain — a regulator may compare this with the
  // signatures.ip_address row to verify the consent and the signature came
  // from the same device session.
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  consentedAt: timestamp("consented_at").notNull().defaultNow(),
}, (table) => [
  index("signing_consent_audit_user_idx").on(table.userId),
  index("signing_consent_audit_email_doc_idx").on(table.signerEmail, table.documentId),
]);
export const insertSigningConsentAuditSchema = createInsertSchema(signingConsentAudit).omit({
  id: true,
  consentedAt: true,
});
export type InsertSigningConsentAudit = z.infer<typeof insertSigningConsentAuditSchema>;
export type SigningConsentAudit = typeof signingConsentAudit.$inferSelect;

/**
 * Current version of the E-SIGN §101(c)(1)(B) disclosure text. Bump when
 * the dialog copy materially changes — the dialog re-fires for users whose
 * stored version is older than this. Format 'YYYY-MM-DD'.
 */
export const ESIGN_DISCLOSURE_VERSION = "2026-05-29";

// ============================================
// DOCUMENT VERSION HISTORY
// ============================================

export const documentVersions = pgTable("document_versions", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  documentId: integer("document_id").notNull(), // ID of the template or generated document
  documentType: text("document_type").notNull(), // "template" or "generated"
  version: integer("version").notNull(), // 1, 2, 3...
  content: text("content").notNull(), // Snapshot of content at this version
  variables: jsonb("variables").$type<Record<string, any>>(), // Variables snapshot (for templates)
  changes: text("changes"), // Description of what changed
  createdBy: text("created_by"), // userId who created this version
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertDocumentVersionSchema = createInsertSchema(documentVersions).omit({
  id: true,
  createdAt: true,
});
export type InsertDocumentVersion = z.infer<typeof insertDocumentVersionSchema>;
export type DocumentVersion = typeof documentVersions.$inferSelect;

// ============================================
// DOCUMENT PACKAGES
// ============================================

export const DOCUMENT_PACKAGE_STATUSES = ["draft", "complete", "sent", "signed"] as const;
export type DocumentPackageStatus = typeof DOCUMENT_PACKAGE_STATUSES[number];

export const documentPackages = pgTable("document_packages", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  name: text("name").notNull(),
  description: text("description"),
  dealId: integer("deal_id").references(() => deals.id),
  propertyId: integer("property_id").references(() => properties.id),
  status: text("status").notNull().default("draft"),
  documents: jsonb("documents").$type<{
    documentId?: number;
    templateId: number;
    order: number;
    status: string;
    name?: string;
  }[]>().default([]),
  createdBy: text("created_by"),
  sentAt: timestamp("sent_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertDocumentPackageSchema = createInsertSchema(documentPackages).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertDocumentPackage = z.infer<typeof insertDocumentPackageSchema>;
export type DocumentPackage = typeof documentPackages.$inferSelect;

// ============================================
// AUTOMATION RULES ENGINE (8.1)
// ============================================

export const AUTOMATION_TRIGGERS = [
  "lead_created",
  "lead_status_changed",
  "deal_stage_changed",
  "payment_received",
  "payment_missed",
  "task_completed",
  "note_created",
  "property_added",
] as const;
export type AutomationTrigger = typeof AUTOMATION_TRIGGERS[number];

export const AUTOMATION_CONDITIONS = [
  "equals",
  "not_equals",
  "contains",
  "not_contains",
  "greater_than",
  "less_than",
  "is_empty",
  "is_not_empty",
] as const;
export type AutomationCondition = typeof AUTOMATION_CONDITIONS[number];

export const AUTOMATION_ACTIONS = [
  "send_email",
  "send_sms",
  "create_task",
  "add_tag",
  "remove_tag",
  "change_lead_status",
  "change_deal_stage",
  "notify_team",
  "assign_to",
  "add_note",
] as const;
export type AutomationAction = typeof AUTOMATION_ACTIONS[number];

export const automationRules = pgTable("automation_rules", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  
  name: text("name").notNull(),
  description: text("description"),
  
  trigger: text("trigger").notNull(), // One of AUTOMATION_TRIGGERS
  
  conditions: jsonb("conditions").$type<{
    field: string;
    operator: string; // One of AUTOMATION_CONDITIONS
    value: string;
    logicalOperator?: "and" | "or";
  }[]>(),
  
  actions: jsonb("actions").$type<{
    type: string; // One of AUTOMATION_ACTIONS
    config: Record<string, any>;
  }[]>().notNull(),
  
  isEnabled: boolean("is_enabled").default(true),
  
  executionCount: integer("execution_count").default(0),
  lastExecutedAt: timestamp("last_executed_at"),
  
  createdBy: text("created_by"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("automation_rules_org_idx").on(table.organizationId),
  index("automation_rules_active_idx").on(table.isEnabled),
]);

export const insertAutomationRuleSchema = createInsertSchema(automationRules).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  executionCount: true,
  lastExecutedAt: true,
});
export type InsertAutomationRule = z.infer<typeof insertAutomationRuleSchema>;
export type AutomationRule = typeof automationRules.$inferSelect;

// automation_executions — DROPPED 2026-08-16 (migration 0236, founder ruling
// "Triage 3 ways, drop only experiment residue"). The /automation rules twin
// was deleted 2026-07-29 (deletion ledger) because it had NO EXECUTION ENGINE:
// `createAutomationExecution` had ZERO call sites, so this log could never hold
// a row, and that ledger entry itself recorded the table as "pending a drop
// migration (execution rule 2)". `automationRules` above is deliberately KEPT —
// its rows are customer-AUTHORED (name, description, conditions, actions), and
// deleting customer data is a founder-only hard stop this ruling did not touch.

// ============================================
// NOTIFICATIONS SYSTEM (8.3)
// ============================================

export const NOTIFICATION_TYPES = [
  "task_assigned",
  "task_due",
  "task_overdue",
  "deal_update",
  "deal_stage_changed",
  "payment_received",
  "payment_missed",
  "lead_response",
  "lead_assigned",
  "team_mention",
  "automation_triggered",
  "system_alert",
] as const;
export type NotificationType = typeof NOTIFICATION_TYPES[number];

export const notifications = pgTable("notifications", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  userId: text("user_id").notNull(), // Recipient user ID
  
  type: text("type").notNull(), // One of NOTIFICATION_TYPES
  title: text("title").notNull(),
  message: text("message"),
  
  entityType: text("entity_type"), // lead, property, deal, task, payment
  entityId: integer("entity_id"),
  
  isRead: boolean("is_read").default(false),
  readAt: timestamp("read_at"),
  
  metadata: jsonb("metadata").$type<Record<string, any>>(),
  
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertNotificationSchema = createInsertSchema(notifications).omit({
  id: true,
  createdAt: true,
  isRead: true,
  readAt: true,
});
export type InsertNotification = z.infer<typeof insertNotificationSchema>;
export type Notification = typeof notifications.$inferSelect;

// ============================================
// JOB CURSORS (Prevent duplicate processing on restart)
// ============================================

export const jobCursors = pgTable("job_cursors", {
  id: serial("id").primaryKey(),
  jobType: text("job_type").notNull().unique(),
  lastProcessedId: integer("last_processed_id"),
  lastRunAt: timestamp("last_run_at"),
  status: text("status").default('idle'),
  metadata: jsonb("metadata").$type<Record<string, any>>(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertJobCursorSchema = createInsertSchema(jobCursors).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertJobCursor = z.infer<typeof insertJobCursorSchema>;
export type JobCursor = typeof jobCursors.$inferSelect;

// ============================================
// JOB LOCKS (Prevent duplicate execution in multi-instance deployment)
// ============================================

export const jobLocks = pgTable("job_locks", {
  id: serial("id").primaryKey(),
  jobName: text("job_name").notNull().unique(),
  lockedBy: text("locked_by").notNull(),
  lockedAt: timestamp("locked_at").defaultNow(),
  expiresAt: timestamp("expires_at").notNull(),
});

export const insertJobLockSchema = createInsertSchema(jobLocks).omit({
  id: true,
  lockedAt: true,
});
export type InsertJobLock = z.infer<typeof insertJobLockSchema>;
export type JobLock = typeof jobLocks.$inferSelect;

// ============================================
// CIRCUIT BREAKER STATE (Tier 1G — persisted provider-registry breaker)
// ============================================
// One row per provider. Persists trip state across deploys so a hard-down
// provider isn't re-hammered with a fresh failure budget per machine per
// deploy. state: 'closed' | 'open' | 'half_open'. half_open_probe_at records
// the single-probe claim taken after the cooloff window.

export const circuitBreakerState = pgTable("circuit_breaker_state", {
  providerName: text("provider_name").primaryKey(),
  state: text("state").notNull().default("closed"),
  failures: integer("failures").notNull().default(0),
  openedAt: timestamp("opened_at"),
  lastFailureAt: timestamp("last_failure_at"),
  halfOpenProbeAt: timestamp("half_open_probe_at"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export type CircuitBreakerStateRow = typeof circuitBreakerState.$inferSelect;

// ============================================
// DEADMAN PAGE STATE (Tier 1H — persisted re-page throttle)
// ============================================
// One row per roster job. server/jobs/deadmanCheck.ts throttles on-call
// re-pages to once/hour per dark job; this table persists the last-paged
// timestamp so a deploy mid-incident doesn't reset the throttle and re-page
// every still-dark job.

export const deadmanPageState = pgTable("deadman_page_state", {
  jobName: text("job_name").primaryKey(),
  lastPagedAt: timestamp("last_paged_at").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export type DeadmanPageStateRow = typeof deadmanPageState.$inferSelect;

// ============================================
// EMAIL SENDER IDENTITIES
// ============================================

export const emailSenderIdentities = pgTable("email_sender_identities", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  teamMemberId: integer("team_member_id").references(() => teamMembers.id),
  
  type: text("type").notNull(), // platform_alias, custom_domain
  fromEmail: text("from_email").notNull(),
  fromName: text("from_name").notNull(),
  replyToEmail: text("reply_to_email"), // Where replies should go if forwarding
  
  replyRoutingMode: text("reply_routing_mode").notNull().default("in_app"), // in_app, forward, both
  
  status: text("status").notNull().default("pending"), // pending, verified, failed
  verificationToken: text("verification_token"),
  verifiedAt: timestamp("verified_at"),
  
  isDefault: boolean("is_default").default(false),
  isActive: boolean("is_active").default(true),
  
  dnsRecords: jsonb("dns_records").$type<{
    dkim?: Array<{ name: string; type: string; value: string; verified: boolean }>;
    spf?: { name: string; type: string; value: string; verified: boolean };
    dmarc?: { name: string; type: string; value: string; verified: boolean };
  }>(),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertEmailSenderIdentitySchema = createInsertSchema(emailSenderIdentities).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  verifiedAt: true,
});
export type InsertEmailSenderIdentity = z.infer<typeof insertEmailSenderIdentitySchema>;
export type EmailSenderIdentity = typeof emailSenderIdentities.$inferSelect;

// ============================================
// INBOX MESSAGES (Inbound Email Replies)
// ============================================

export const inboxMessages = pgTable("inbox_messages", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  
  senderEmail: text("sender_email").notNull(),
  senderName: text("sender_name"),
  recipientEmail: text("recipient_email").notNull(), // The @acreage.pro or custom domain address
  
  subject: text("subject"),
  bodyText: text("body_text"),
  bodyHtml: text("body_html"),
  
  leadId: integer("lead_id").references(() => leads.id),
  conversationId: integer("conversation_id").references(() => conversations.id),
  
  inReplyToMessageId: text("in_reply_to_message_id"), // Email Message-ID header for threading
  messageId: text("message_id"), // This email's Message-ID header
  
  isRead: boolean("is_read").default(false),
  readAt: timestamp("read_at"),
  readBy: text("read_by"), // User ID who marked as read
  
  isArchived: boolean("is_archived").default(false),
  isStarred: boolean("is_starred").default(false),
  
  forwardedToEmail: text("forwarded_to_email"),
  forwardedAt: timestamp("forwarded_at"),
  
  rawHeaders: jsonb("raw_headers").$type<Record<string, string>>(),
  attachments: jsonb("attachments").$type<Array<{
    filename: string;
    contentType: string;
    size: number;
    storageKey?: string;
  }>>(),
  
  receivedAt: timestamp("received_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertInboxMessageSchema = createInsertSchema(inboxMessages).omit({
  id: true,
  createdAt: true,
  isRead: true,
  readAt: true,
  readBy: true,
  isArchived: true,
  isStarred: true,
});
export type InsertInboxMessage = z.infer<typeof insertInboxMessageSchema>;
export type InboxMessage = typeof inboxMessages.$inferSelect;

// ============================================
// MAIL SENDER IDENTITIES (Direct Mail Return Addresses)
// ============================================

export const mailSenderIdentities = pgTable("mail_sender_identities", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  
  name: text("name").notNull(), // Display name e.g. "Main Office", "Marketing HQ"
  companyName: text("company_name").notNull(),
  addressLine1: text("address_line_1").notNull(),
  addressLine2: text("address_line_2"),
  city: text("city").notNull(),
  state: text("state").notNull(),
  zipCode: text("zip_code").notNull(),
  country: text("country").notNull().default("US"),
  
  lobAddressId: text("lob_address_id"), // Lob's address object ID after verification
  
  status: text("status").notNull().default("draft"), // draft, pending_verification, verified, failed
  verificationDetails: jsonb("verification_details").$type<{
    deliverability?: string;
    deliverabilityAnalysis?: {
      dpvConfirmation?: string;
      dpvCmra?: string;
      dpvVacant?: string;
      dpvFootnotes?: string[];
    };
    components?: {
      primaryNumber?: string;
      streetPredirection?: string;
      streetName?: string;
      streetSuffix?: string;
      city?: string;
      state?: string;
      zipCode?: string;
      zipCodePlus4?: string;
    };
    errorMessage?: string;
  }>(),
  verifiedAt: timestamp("verified_at"),
  
  isDefault: boolean("is_default").default(false),
  isActive: boolean("is_active").default(true),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertMailSenderIdentitySchema = createInsertSchema(mailSenderIdentities).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  verifiedAt: true,
  lobAddressId: true,
  verificationDetails: true,
});
export type InsertMailSenderIdentity = z.infer<typeof insertMailSenderIdentitySchema>;
export type MailSenderIdentity = typeof mailSenderIdentities.$inferSelect;

// ============================================
// MAILING ORDERS (Direct Mail Campaign Orders)
// ============================================

export const mailingOrders = pgTable("mailing_orders", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  campaignId: integer("campaign_id").references(() => campaigns.id),
  
  mailSenderIdentityId: integer("mail_sender_identity_id").references(() => mailSenderIdentities.id),
  
  returnAddressSnapshot: jsonb("return_address_snapshot").$type<{
    companyName: string;
    addressLine1: string;
    addressLine2?: string;
    city: string;
    state: string;
    zipCode: string;
    country: string;
  }>(),
  
  mailType: text("mail_type").notNull(), // letter, postcard, check
  templateId: text("template_id"), // Lob template ID if using templates
  
  totalPieces: integer("total_pieces").notNull().default(0),
  sentPieces: integer("sent_pieces").notNull().default(0),
  failedPieces: integer("failed_pieces").notNull().default(0),
  
  costPerPiece: integer("cost_per_piece").notNull().default(0), // In cents
  totalCost: integer("total_cost").notNull().default(0), // In cents
  creditsUsed: integer("credits_used").notNull().default(0),
  
  status: text("status").notNull().default("draft"), // draft, processing, sending, completed, failed, cancelled
  
  lobJobIds: jsonb("lob_job_ids").$type<string[]>(),
  
  errorMessage: text("error_message"),
  
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertMailingOrderSchema = createInsertSchema(mailingOrders).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  sentPieces: true,
  failedPieces: true,
  startedAt: true,
  completedAt: true,
  lobJobIds: true,
});
export type InsertMailingOrder = z.infer<typeof insertMailingOrderSchema>;
export type MailingOrder = typeof mailingOrders.$inferSelect;

// ============================================
// MAILING ORDER PIECES (Individual Mail Pieces)
// ============================================

export const mailingOrderPieces = pgTable("mailing_order_pieces", {
  id: serial("id").primaryKey(),
  mailingOrderId: integer("mailing_order_id").references(() => mailingOrders.id).notNull(),
  leadId: integer("lead_id").references(() => leads.id),
  
  recipientName: text("recipient_name").notNull(),
  recipientAddressLine1: text("recipient_address_line_1").notNull(),
  recipientAddressLine2: text("recipient_address_line_2"),
  recipientCity: text("recipient_city").notNull(),
  recipientState: text("recipient_state").notNull(),
  recipientZipCode: text("recipient_zip_code").notNull(),
  
  lobMailId: text("lob_mail_id"), // Lob's letter/postcard ID
  lobUrl: text("lob_url"), // Preview URL from Lob

  // Attribution tracking — unique 8-char code tied to this mail piece
  trackingCode: text("tracking_code").unique(),

  status: text("status").notNull().default("pending"), // pending, processing, mailed, in_transit, delivered, returned, failed
  
  trackingEvents: jsonb("tracking_events").$type<Array<{
    type: string;
    name: string;
    location?: string;
    timestamp: string;
  }>>(),
  
  expectedDeliveryDate: timestamp("expected_delivery_date"),
  
  errorMessage: text("error_message"),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertMailingOrderPieceSchema = createInsertSchema(mailingOrderPieces).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  lobMailId: true,
  lobUrl: true,
  trackingEvents: true,
  expectedDeliveryDate: true,
});
export type InsertMailingOrderPiece = z.infer<typeof insertMailingOrderPieceSchema>;
export type MailingOrderPiece = typeof mailingOrderPieces.$inferSelect;

// ============================================
// PILLAR 2 — Mail shipment + per-piece tables live further down
// ============================================
//
// The canonical mailShipments + mailShipmentPieces tables (rich version
// with status state-machine, 30-min hold window, audience snapshot,
// per-piece USPS scan timestamps + QR/inbound counters) are declared
// further down in this file alongside the rest of the Pillar 3 outreach
// surfaces. An earlier draft duplicated a thinner version here — removed
// (2026-05-22) so there's one canonical declaration.

// ============================================
// API USAGE LOGS (Cost Tracking)
// ============================================

export const apiUsageLogs = pgTable("api_usage_logs", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id),
  service: text("service").notNull(), // lob, regrid, openai
  action: text("action").notNull(), // e.g., "send_postcard", "parcel_lookup", "chat_completion"
  count: integer("count").default(1),
  estimatedCostCents: integer("estimated_cost_cents").default(0),
  metadata: jsonb("metadata").$type<Record<string, any>>(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertApiUsageLogSchema = createInsertSchema(apiUsageLogs).omit({ id: true, createdAt: true });
export type InsertApiUsageLog = z.infer<typeof insertApiUsageLogSchema>;
export type ApiUsageLog = typeof apiUsageLogs.$inferSelect;

// ============================================
// BORROWER SESSIONS (Session-based auth for borrower portal)
// ============================================

export const borrowerSessions = pgTable("borrower_sessions", {
  id: serial("id").primaryKey(),
  noteId: integer("note_id").references(() => notes.id).notNull(),
  // SEC (Lens 23): pin the originating organization at session-create so
  // every read can re-assert note.organizationId === session.organizationId.
  // Without this, a note that ever migrates across orgs would silently
  // carry an active borrower session into the new org. Backfilled from
  // notes.organization_id by migration 0081.
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  sessionToken: text("session_token").notNull().unique(),
  email: text("email").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").defaultNow(),
  expiresAt: timestamp("expires_at").notNull(),
  lastAccessedAt: timestamp("last_accessed_at").defaultNow(),
});

export const insertBorrowerSessionSchema = createInsertSchema(borrowerSessions).omit({ 
  id: true, 
  createdAt: true, 
  lastAccessedAt: true 
});
export type InsertBorrowerSession = z.infer<typeof insertBorrowerSessionSchema>;
export type BorrowerSession = typeof borrowerSessions.$inferSelect;

// ============================================
// BORROWER MESSAGES (Self-service messaging thread)
// ============================================

export const borrowerMessages = pgTable("borrower_messages", {
  id: serial("id").primaryKey(),
  noteId: integer("note_id").references(() => notes.id).notNull(),
  orgId: integer("org_id").references(() => organizations.id).notNull(),
  senderType: text("sender_type").notNull(), // 'borrower' | 'lender'
  content: text("content").notNull(),
  readAt: timestamp("read_at"), // null = unread
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertBorrowerMessageSchema = createInsertSchema(borrowerMessages).omit({ id: true, createdAt: true });
export type InsertBorrowerMessage = z.infer<typeof insertBorrowerMessageSchema>;
export type BorrowerMessage = typeof borrowerMessages.$inferSelect;

// ============================================
// DATA SOURCES (Free Data Endpoint Registry)
// ============================================

export const dataSources = pgTable("data_sources", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  title: text("title").notNull(),
  category: text("category").notNull(),
  subcategory: text("subcategory"),
  description: text("description"),
  
  portalUrl: text("portal_url"),
  apiUrl: text("api_url"),
  coverage: text("coverage"),
  
  accessLevel: text("access_level").notNull().default("free"),
  authRequirements: text("auth_requirements"),
  rateLimitNotes: text("rate_limit_notes"),
  costPerCall: integer("cost_per_call").default(0),
  
  dataTypes: text("data_types").array(),
  
  endpointType: text("endpoint_type"),
  queryParams: jsonb("query_params").$type<Record<string, string>>(),
  fieldMappings: jsonb("field_mappings").$type<Record<string, string>>(),
  
  isEnabled: boolean("is_enabled").default(true),
  isVerified: boolean("is_verified").default(false),
  lastVerifiedAt: timestamp("last_verified_at"),
  lastStatus: text("last_status"),
  lastStatusMessage: text("last_status_message"),
  
  freshnessdays: integer("freshness_days").default(30),
  priority: integer("priority").default(100),
  
  notes: text("notes"),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertDataSourceSchema = createInsertSchema(dataSources).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertDataSource = z.infer<typeof insertDataSourceSchema>;
export type DataSource = typeof dataSources.$inferSelect;

// ============================================
// SUBSCRIPTION EVENTS (Tier change tracking for analytics)
// ============================================

export const subscriptionEvents = pgTable("subscription_events", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id),
  eventType: text("event_type").notNull(), // 'signup', 'upgrade', 'downgrade', 'cancel', 'reactivate', 'trial_start', 'trial_end'
  fromTier: text("from_tier"), // null for signup
  toTier: text("to_tier"), // null for cancel
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertSubscriptionEventSchema = createInsertSchema(subscriptionEvents).omit({
  id: true,
  createdAt: true,
});
export type InsertSubscriptionEvent = z.infer<typeof insertSubscriptionEventSchema>;
export type SubscriptionEvent = typeof subscriptionEvents.$inferSelect;

// ─── FW-OLU-2 (push-forward 2026-05-08): synthetic checks (180-5) ────────
// Olu's spec: every 15min, ping the critical vendor surfaces (SES, Twilio,
// Stripe webhook freshness, Clerk proxy) so the founder gets paged before
// customers do. One row per (check_key, run_at).
export const syntheticCheckRuns = pgTable(
  "synthetic_check_runs",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    checkKey: text("check_key").notNull(), // ses_send | twilio_status | stripe_webhook_freshness | clerk_proxy_health | db_writeable
    runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
    status: text("status").notNull(), // ok | degraded | failing
    latencyMs: integer("latency_ms"),
    errorMessage: text("error_message"),
    metadata: jsonb("metadata"),
  },
  (table) => [
    index("synthetic_check_runs_key_run_idx").on(table.checkKey, table.runAt),
  ],
);
export type SyntheticCheckRun = typeof syntheticCheckRuns.$inferSelect;
export type InsertSyntheticCheckRun = typeof syntheticCheckRuns.$inferInsert;

// ─── Panel-300 #30 — CMA reports + auction-readiness + lien-search ───────
// Domain-real-estate moats. Each is a workflow surface a domain expert
// can sign off on; the data row is the legal artifact.
export const cmaReports = pgTable(
  "cma_reports",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    organizationId: integer("organization_id").notNull(),
    propertyId: integer("property_id"),
    subjectAddress: text("subject_address"),
    subjectAcres: numeric("subject_acres"),
    compIds: jsonb("comp_ids").$type<number[]>(), // array of comp property IDs
    subjectAttributes: jsonb("subject_attributes"),
    valuationLowCents: integer("valuation_low_cents"),
    valuationMidCents: integer("valuation_mid_cents"),
    valuationHighCents: integer("valuation_high_cents"),
    methodologyNotes: text("methodology_notes"),
    preparedBy: text("prepared_by"), // user_id
    domainExpertReviewedAt: timestamp("domain_expert_reviewed_at", { withTimezone: true }),
    domainExpertReviewer: text("domain_expert_reviewer"),
    status: text("status").notNull().default("draft"), // draft | reviewed | sent_to_buyer
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("cma_reports_org_idx").on(table.organizationId, table.createdAt),
    index("cma_reports_property_idx").on(table.propertyId),
  ],
);
export type CmaReport = typeof cmaReports.$inferSelect;
export type InsertCmaReport = typeof cmaReports.$inferInsert;

export const auctionReadinessChecklists = pgTable(
  "auction_readiness_checklists",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    organizationId: integer("organization_id").notNull(),
    propertyId: integer("property_id"),
    auctionDate: timestamp("auction_date", { withTimezone: true }),
    titleSearchComplete: boolean("title_search_complete").notNull().default(false),
    lienSearchComplete: boolean("lien_search_complete").notNull().default(false),
    occupancyVerified: boolean("occupancy_verified").notNull().default(false),
    bidStrategyDocumented: boolean("bid_strategy_documented").notNull().default(false),
    fundsConfirmedCents: integer("funds_confirmed_cents"),
    redemptionRiskAssessed: boolean("redemption_risk_assessed").notNull().default(false),
    domainExpertSignoffAt: timestamp("domain_expert_signoff_at", { withTimezone: true }),
    domainExpertSignoffBy: text("domain_expert_signoff_by"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("auction_readiness_property_unique_idx").on(
      table.organizationId,
      table.propertyId,
    ),
  ],
);
export type AuctionReadinessChecklist = typeof auctionReadinessChecklists.$inferSelect;

export const lienSearchRecords = pgTable(
  "lien_search_records",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    organizationId: integer("organization_id").notNull(),
    propertyId: integer("property_id"),
    lienType: text("lien_type").notNull(), // judgment | tax | mechanic | hoa | irs | child_support | other
    lienHolder: text("lien_holder"),
    lienAmountCents: integer("lien_amount_cents"),
    recordedAt: timestamp("recorded_at", { withTimezone: true }),
    releaseStatus: text("release_status").notNull().default("active"), // active | released | satisfied
    sourceSystem: text("source_system"), // courthouse | lps | regrid | manual
    rawData: jsonb("raw_data"),
    notes: text("notes"),
    discoveredAt: timestamp("discovered_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("lien_search_property_type_idx").on(table.propertyId, table.lienType),
    index("lien_search_org_idx").on(table.organizationId),
    index("lien_search_status_idx").on(table.releaseStatus),
  ],
);
export type LienSearchRecord = typeof lienSearchRecords.$inferSelect;
export type InsertLienSearchRecord = typeof lienSearchRecords.$inferInsert;

// ─── Panel-300 #25 — vendor adoption telemetry ───────────────────────────
// Vendor-partners panel: 5 vendors (Stripe, Clerk, Lob, Sentry, Regrid)
// each have an account-team-level conversation about adoption %, DAU,
// error rate, data freshness. One row per (vendor, period_key, metric_key).
export const vendorAdoptionMetrics = pgTable(
  "vendor_adoption_metrics",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    vendor: text("vendor").notNull(), // stripe | clerk | lob | sentry | regrid
    metricKey: text("metric_key").notNull(), // adoption_pct | dau | error_rate | freshness_minutes
    periodKey: text("period_key").notNull(), // YYYY-MM-DD or YYYY-MM
    value: numeric("value").notNull(),
    unit: text("unit"), // pct | count | seconds
    notes: text("notes"),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("vendor_metrics_unique_idx").on(
      table.vendor,
      table.metricKey,
      table.periodKey,
    ),
    index("vendor_metrics_vendor_period_idx").on(table.vendor, table.periodKey),
  ],
);
export type VendorAdoptionMetric = typeof vendorAdoptionMetrics.$inferSelect;
export type InsertVendorAdoptionMetric = typeof vendorAdoptionMetrics.$inferInsert;

// ─── Panel-300 #26 — GDPR DSAR tracking ───────────────────────────────────
// Adversarial-stress (Mei-Lin) + security-compliance: 24h SLA on
// data-subject access requests. Each request gets a tracking row;
// quarterly self-DSAR audit verifies the SLA is actually met.
export const dsarRequestsLifecycle = pgTable(
  "dsar_requests_lifecycle",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    requestType: text("request_type").notNull(), // access | erasure | portability | rectification
    requesterEmail: text("requester_email").notNull(),
    requesterIdentityVerified: boolean("requester_identity_verified").notNull().default(false),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    slaDeadlineAt: timestamp("sla_deadline_at", { withTimezone: true }).notNull(), // received_at + 24h
    fulfilledAt: timestamp("fulfilled_at", { withTimezone: true }),
    deliveryMethod: text("delivery_method"), // email | secure_download | in_app
    bytesDelivered: integer("bytes_delivered"),
    auditNotes: text("audit_notes"),
    isSelfTest: boolean("is_self_test").notNull().default(false),
  },
  (table) => [
    index("dsar_lifecycle_received_idx").on(table.receivedAt),
    index("dsar_lifecycle_unfulfilled_idx").on(table.fulfilledAt),
  ],
);
export type DsarRequestLifecycle = typeof dsarRequestsLifecycle.$inferSelect;
export type InsertDsarRequestLifecycle = typeof dsarRequestsLifecycle.$inferInsert;

// ─── Panel-300 #27 — pricing-elasticity A/B test instrumentation ──────────
// Product-leadership + investors-capital: $199 vs $249 Solo before
// Series-A pitch. One row per assignment; conversion event flips
// converted_at + amount_paid_cents.
export const pricingExperiments = pgTable(
  "pricing_experiments",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    experimentKey: text("experiment_key").notNull(), // 'solo_price_2026_05'
    variantKey: text("variant_key").notNull(), // 'control_249' | 'test_199'
    organizationId: integer("organization_id"),
    visitorId: text("visitor_id"), // anonymous-visitor cookie if pre-signup
    assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
    convertedAt: timestamp("converted_at", { withTimezone: true }),
    amountPaidCents: integer("amount_paid_cents"),
    conversionEvent: text("conversion_event"), // 'subscribed' | 'upgraded' | 'churned'
  },
  (table) => [
    index("pricing_experiments_key_variant_idx").on(table.experimentKey, table.variantKey),
    index("pricing_experiments_org_idx").on(table.organizationId),
    index("pricing_experiments_visitor_idx").on(table.visitorId),
  ],
);
export type PricingExperiment = typeof pricingExperiments.$inferSelect;
export type InsertPricingExperiment = typeof pricingExperiments.$inferInsert;

// ─── Panel-300 #34 — fair-lending audit + RESPA referral-fee transparency ─
// Adversarial-stress + security-compliance + customers-verticals.
// Monthly disparate-impact analysis (>5% divergence in approval rate
// across protected classes flags). RESPA referral-fee table feeds
// public /transparency/vendor-partnerships page.
export const fairLendingAuditRuns = pgTable(
  "fair_lending_audit_runs",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    organizationId: integer("organization_id").notNull(),
    periodKey: text("period_key").notNull(), // YYYY-MM
    sampleSize: integer("sample_size").notNull(),
    approvalRateOverall: numeric("approval_rate_overall"),
    approvalRateByCategory: jsonb("approval_rate_by_category"), // {protected_class: rate}
    maxDivergencePct: numeric("max_divergence_pct"),
    status: text("status").notNull(), // ok | divergent | insufficient_sample
    runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("fair_lending_org_period_idx").on(table.organizationId, table.periodKey),
  ],
);
export type FairLendingAuditRun = typeof fairLendingAuditRuns.$inferSelect;

export const vendorReferralFees = pgTable(
  "vendor_referral_fees",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    vendor: text("vendor").notNull(),
    relationshipKind: text("relationship_kind").notNull(), // affiliate | reseller | referral
    feeStructure: text("fee_structure").notNull(), // 'flat $X' | 'pct of customer revenue' | 'volume bonus'
    feeAmountCents: integer("fee_amount_cents"),
    feePct: numeric("fee_pct"),
    publicDisclosed: boolean("public_disclosed").notNull().default(false),
    disclosedAt: timestamp("disclosed_at", { withTimezone: true }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("vendor_referral_fees_vendor_idx").on(table.vendor),
    index("vendor_referral_fees_disclosed_idx").on(table.publicDisclosed),
  ],
);
export type VendorReferralFee = typeof vendorReferralFees.$inferSelect;

// ─── Panel-300 #9 — reconciliation rules + run history ──────────────────
// Adjacent-industries (Yusra) + executive-strategy (Marisol). Nightly
// cron compares source-system totals against AcreOS DB totals; if
// divergence > tolerance, log + alert. Replaces "trust the webhook"
// with "verify the webhook landed."
export const reconciliationRules = pgTable(
  "reconciliation_rules",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    sourceSystem: text("source_system").notNull(), // stripe | wire | irs_1099 | sendgrid
    entityType: text("entity_type").notNull(), // subscription | invoice | wire_transfer | 1099_filing | email_send
    aggregationKey: text("aggregation_key").notNull(), // e.g. "monthly_invoice_total"
    expectedQuery: text("expected_query"), // SQL query (or descriptor) for AcreOS-side total
    toleranceDollars: numeric("tolerance_dollars").notNull().default("1.00"),
    enabled: boolean("enabled").notNull().default(true),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("reconciliation_rules_key_idx").on(
      table.sourceSystem,
      table.entityType,
      table.aggregationKey,
    ),
  ],
);
export type ReconciliationRule = typeof reconciliationRules.$inferSelect;
export type InsertReconciliationRule = typeof reconciliationRules.$inferInsert;

export const reconciliationRuns = pgTable(
  "reconciliation_runs",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    ruleId: varchar("rule_id").notNull(),
    runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
    sourceTotal: numeric("source_total"),
    acreosTotal: numeric("acreos_total"),
    differenceDollars: numeric("difference_dollars"),
    status: text("status").notNull(), // ok | divergent | failing
    errorMessage: text("error_message"),
  },
  (table) => [
    index("reconciliation_runs_rule_run_idx").on(table.ruleId, table.runAt),
    index("reconciliation_runs_status_idx").on(table.status),
  ],
);
export type ReconciliationRun = typeof reconciliationRuns.$inferSelect;

// ─── Panel-300 #10 + #20 — statutory form registry + disclosure timing ──
// Domain-real-estate + adjacent-industries + adversarial-stress. Per-state
// forms with version + attorney-review status; disclosure-timing cron
// fires off `closing_date - 3 days` automatically so TILA timing is
// never violated by a manual workflow.
export const statutoryForms = pgTable(
  "statutory_forms",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    state: text("state").notNull(), // 'TX' | 'CA' | 'NY' etc.
    formKey: text("form_key").notNull(), // 'contract_for_deed' | 'fcra_disclosure' | 'tila_disclosure'
    statuteCitation: text("statute_citation"),
    version: text("version").notNull(),
    body: text("body").notNull(),
    attorneyReviewedAt: timestamp("attorney_reviewed_at", { withTimezone: true }),
    attorneyReviewer: text("attorney_reviewer"),
    enabled: boolean("enabled").notNull().default(false), // disabled by default; flip after attorney sign-off
    expiresAt: timestamp("expires_at", { withTimezone: true }), // 2-year resign cadence
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("statutory_forms_state_key_version_idx").on(
      table.state,
      table.formKey,
      table.version,
    ),
    index("statutory_forms_enabled_idx").on(table.enabled),
  ],
);
export type StatutoryForm = typeof statutoryForms.$inferSelect;
export type InsertStatutoryForm = typeof statutoryForms.$inferInsert;

export const disclosureTimingScheduled = pgTable(
  "disclosure_timing_scheduled",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    organizationId: integer("organization_id").notNull(),
    dealId: integer("deal_id"),
    propertyId: integer("property_id"),
    statutoryFormId: varchar("statutory_form_id").notNull(),
    closingDate: timestamp("closing_date", { withTimezone: true }).notNull(),
    sendDate: timestamp("send_date", { withTimezone: true }).notNull(), // closing_date - 3 days
    sentAt: timestamp("sent_at", { withTimezone: true }),
    status: text("status").notNull().default("scheduled"), // scheduled | sent | skipped | failed
    sendErrorMessage: text("send_error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("disclosure_timing_send_date_idx").on(table.sendDate, table.status),
    index("disclosure_timing_org_idx").on(table.organizationId),
  ],
);
export type DisclosureTimingScheduled = typeof disclosureTimingScheduled.$inferSelect;

// ─── Panel-300 G3 — auth-fail lockout tracker ────────────────────────────
// Adversarial-stress (Magdalena, Galvin) + security-compliance: record
// failed auth attempts per (ip, email) tuple; lock after 5 failures within
// 15 minutes. Service helper reads + writes this table; route layer calls
// recordAuthFailure() on each failed login.
export const authFailAttempts = pgTable(
  "auth_fail_attempts",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    ip: text("ip"),
    email: text("email"),
    attemptedAt: timestamp("attempted_at", { withTimezone: true }).notNull().defaultNow(),
    failureReason: text("failure_reason"), // password | mfa | session | unknown
    userAgent: text("user_agent"),
  },
  (table) => [
    index("auth_fail_attempts_ip_idx").on(table.ip, table.attemptedAt),
    index("auth_fail_attempts_email_idx").on(table.email, table.attemptedAt),
  ],
);
export type AuthFailAttempt = typeof authFailAttempts.$inferSelect;
export type InsertAuthFailAttempt = typeof authFailAttempts.$inferInsert;

// ─── FW-WYNNE-3 (push-forward 2026-05-08): data-retention policy ─────────
// Wynne's 180-day item (180-14). One row per (table_key, retention_kind).
// Holds the policy that the nightly retention job consults. table_key
// references actual tables (leads, properties, audit_events, etc).
// retention_kind ∈ {hard_delete | anonymize | archive}.
export const retentionPolicies = pgTable(
  "retention_policies",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    tableKey: text("table_key").notNull(), // 'leads' | 'audit_events' | etc
    retentionKind: text("retention_kind").notNull(), // hard_delete | anonymize | archive
    retentionDays: integer("retention_days").notNull(),
    legalBasis: text("legal_basis"), // citation for why we keep this long
    enabled: boolean("enabled").notNull().default(true),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("retention_policies_table_idx").on(table.tableKey),
  ],
);
export type RetentionPolicy = typeof retentionPolicies.$inferSelect;
export type InsertRetentionPolicy = typeof retentionPolicies.$inferInsert;

// ─── FW-CAMILA-2 (push-forward 2026-05-08): D7 NPS micro-survey ──────────
// Camila's 180-day item (180-7). One row per (org, surveyDate). Score 0-10.
// Score wired into customer-health rollup downstream.
export const npsMicroSurveys = pgTable(
  "nps_micro_surveys",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    organizationId: integer("organization_id").notNull(),
    userId: text("user_id"),
    score: integer("score").notNull(), // 0-10
    comment: text("comment"),
    surveyTrigger: text("survey_trigger").notNull().default("d7"), // d7 | d30 | adhoc
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("nps_micro_org_idx").on(table.organizationId, table.submittedAt),
  ],
);
export type NpsMicroSurvey = typeof npsMicroSurveys.$inferSelect;
export type InsertNpsMicroSurvey = typeof npsMicroSurveys.$inferInsert;

// ─── FW-CAMILA-3 (push-forward 2026-05-08): pre-churn ladder automation ──
// Camila's 180-day item (180-8). Activity-silence escalation: 5d/10d/14d/
// 21d/30d ladder. One row per (org, rung) so we don't re-fire the same
// rung. status flips to 'recovered' if activity resumes; 'churned' if
// 30d hits with no activity.
export const preChurnRungs = pgTable(
  "pre_churn_rungs",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    organizationId: integer("organization_id").notNull(),
    rung: text("rung").notNull(), // d5 | d10 | d14 | d21 | d30
    firedAt: timestamp("fired_at", { withTimezone: true }).notNull().defaultNow(),
    status: text("status").notNull().default("fired"), // fired | recovered | churned
    notes: text("notes"),
  },
  (table) => [
    uniqueIndex("pre_churn_rungs_org_rung_idx").on(table.organizationId, table.rung),
    index("pre_churn_rungs_status_idx").on(table.status),
  ],
);
export type PreChurnRung = typeof preChurnRungs.$inferSelect;
export type InsertPreChurnRung = typeof preChurnRungs.$inferInsert;

// ─── FW-WYNNE-2 (push-forward 2026-05-08): substantive FCRA attestation ──
// Wynne's 180-day item (180-15). The current annual attestation is a
// checkbox; this column captures the structured form: which permissible-
// purpose category, what specific use-case, what data category. Stored as
// jsonb on the existing `fcra_attestations` row via a new column. Keeps
// backward-compat (NULL means legacy checkbox).
// (column added via ALTER on fcra_attestations in scripts/migrate.mjs)

// ─── FW-TEGAN-1 + FW-ASHOK-1 (push-forward 2026-05-08): vertical packs ───
// 5-persona convergence (Tegan + Bryn + Ashok + Caspar + Ana): meter
// verticals as add-on packs on top of the base tier ($49 / $99 / $199).
// One row per (organization, pack_key) — the org has a pack active when
// status='active' AND (cancel_at IS NULL OR cancel_at > now()). Stripe
// subscription IDs stored alongside the local row so we can reconcile
// nightly against Stripe's own state.
export const orgVerticalPacks = pgTable(
  "org_vertical_packs",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    organizationId: integer("organization_id").notNull(),
    packKey: text("pack_key").notNull(), // note_investor | buy_and_hold | etc
    status: text("status").notNull().default("active"), // active | cancelled | past_due
    activatedAt: timestamp("activated_at", { withTimezone: true }).notNull().defaultNow(),
    cancelAt: timestamp("cancel_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    billingInterval: text("billing_interval").notNull().default("monthly"),
    priceCents: integer("price_cents").notNull(),
    stripeSubscriptionItemId: text("stripe_subscription_item_id"),
    activatedBy: text("activated_by"), // user_id
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("org_vertical_packs_org_pack_idx").on(table.organizationId, table.packKey),
    index("org_vertical_packs_status_idx").on(table.status),
  ],
);
export type OrgVerticalPack = typeof orgVerticalPacks.$inferSelect;
export type InsertOrgVerticalPack = typeof orgVerticalPacks.$inferInsert;

// ─── FW-MARISOL-2 (push-forward 2026-05-08): ASC 606 revenue recognition ──
// Marisol/Ashok/Harlowe/Bryn/Tegan all converged: annual subscriptions
// violate ASC 606 unless we defer + recognize ratably. One row per
// (organization, period_key) — period_key is "YYYY-MM" so we can re-run
// the recognition cron idempotently. recognized_cents is what hits the
// P&L this month; deferred_cents is the unrecognized balance carried
// forward. Source distinguishes monthly_sub / annual_sub / credit_topup
// so the founder can audit which subscription type drove which row.
export const revenueRecognitionPeriods = pgTable(
  "revenue_recognition_periods",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    organizationId: integer("organization_id").notNull(),
    periodKey: text("period_key").notNull(), // "2026-05"
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
    source: text("source").notNull(), // monthly_sub | annual_sub | credit_topup
    tier: text("tier"),
    billingInterval: text("billing_interval"), // monthly | yearly
    recognizedCents: integer("recognized_cents").notNull().default(0),
    deferredCents: integer("deferred_cents").notNull().default(0),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("rev_recog_org_period_source_idx").on(
      table.organizationId,
      table.periodKey,
      table.source,
    ),
    index("rev_recog_period_idx").on(table.periodKey),
  ],
);
export type RevenueRecognitionPeriod = typeof revenueRecognitionPeriods.$inferSelect;
export type InsertRevenueRecognitionPeriod = typeof revenueRecognitionPeriods.$inferInsert;

// ============================================
// SUBSCRIPTION HISTORY (Reactivation context — Renoir §1-§2)
// ============================================
//
// Priced lifecycle audit log. Each row captures a subscribed / tier_changed /
// canceled / reactivated event with the price + interval at that moment so
// the reactivation flow can show "you were on Operator @ $49/mo when you
// cancelled" and compute total active tenure across multiple lifecycles.

export const subscriptionHistory = pgTable("subscription_history", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  eventType: text("event_type").notNull(), // subscribed | tier_changed | canceled | reactivated
  tier: text("tier"), // nullable for canceled
  billingInterval: text("billing_interval"), // monthly | yearly | null
  priceCents: integer("price_cents"),
  eventAt: timestamp("event_at").defaultNow().notNull(),
  metadata: jsonb("metadata").default({}).notNull(),
});

export const insertSubscriptionHistorySchema = createInsertSchema(subscriptionHistory).omit({
  id: true,
  eventAt: true,
});
export type InsertSubscriptionHistory = z.infer<typeof insertSubscriptionHistorySchema>;
export type SubscriptionHistoryRow = typeof subscriptionHistory.$inferSelect;

// ============================================
// CUSTOMER CONCENTRATION (Phase 3 Week 10)
// ============================================
// Daily snapshots of MRR concentration so the founder can spot single-
// customer or top-3 risk over time. Computed by jobs/customerConcentration.ts.
// alert_triggered/alert_severity carry the policy result so the surface
// can render historical bands without re-applying thresholds.

// ============================================
// MRR SNAPSHOTS (roadmap W4.5, 2026-07)
// ============================================
// Weekly point-in-time MRR so week-over-week growth is computed from
// HISTORY instead of defaulting to zero (which made the runway "upside"
// scenario identical to base since launch). Written by the
// mrr_snapshot_weekly job; read by runwayModel + founder bridge.

export const mrrSnapshots = pgTable("mrr_snapshots", {
  id: serial("id").primaryKey(),
  capturedAt: timestamp("captured_at").defaultNow().notNull(),
  mrrCents: integer("mrr_cents").notNull(),
  payingOrgs: integer("paying_orgs").notNull().default(0),
});

// ── 0197 — Marketing spend ledger (the CAC numerator) ───────────────────────
// Until this table existed the unit-economics dashboard honestly reported
// cacAvailable:false and the budget ramp computed CAC from AI-dispatch spend
// alone — real ad dollars had no ledger anywhere (2026-07-07 cost audit).
// One row per spend entry. PLATFORM-GLOBAL (no organization_id): this is
// AcreOS's own acquisition spend, not tenant data. Sources: 'manual'
// (founder-entered), 'ad_provider' (a future Meta/Google spend-sync), or
// 'autopilot'. Amounts are ACTUALS — never record budgets/commitments here;
// a budget is not spend (no-fabrication).
//
// Mirrors scripts/migrate.mjs STATEMENTS + migrations/0197_marketing_spend.sql.
export const marketingSpend = pgTable("marketing_spend", {
  id: serial("id").primaryKey(),
  // "meta" | "google" | "content" | "referral" | "sponsorship" | "other"
  channel: text("channel").notNull(),
  amountCents: integer("amount_cents").notNull(),
  // The date the spend occurred (provider-reported date for synced rows).
  spentAt: timestamp("spent_at").notNull(),
  // "manual" | "ad_provider" | "autopilot"
  source: text("source").notNull().default("manual"),
  // Provider-side campaign id / name, when known.
  campaignRef: text("campaign_ref"),
  note: text("note"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  bySpentAt: index("marketing_spend_spent_at_idx").on(table.spentAt),
  byChannelSpentAt: index("marketing_spend_channel_spent_at_idx").on(
    table.channel,
    table.spentAt,
  ),
}));

export type MarketingSpendEntry = typeof marketingSpend.$inferSelect;

// ── 0201 — County market signals (Open-Data Program Phase 2.1/2.2) ──────────
// PLATFORM-GLOBAL reference data (no organization_id, like marketing_spend)
// feeding the County Opportunity Score. Ingested by the irs_soi_migration_v1 /
// census_bps_permits_v1 ETL jobs (server/services/etlHandlers.ts); read via
// server/services/openData/countyMarketSignals.ts.
//
// county_migration_summary: one row per (county, IRS filing year 'YYZZ').
// Values come from the IRS-published per-county "Total Migration-US and
// Foreign" summary rows — never summed from suppressed pair detail. AGI is
// in thousands of dollars as published; IRS-suppressed values (-1) are NULL.
//
// Mirrors scripts/migrate.mjs STATEMENTS + migrations/0201_county_market_signals.sql.
export const countyMigrationSummary = pgTable("county_migration_summary", {
  id: serial("id").primaryKey(),
  stateFips: text("state_fips").notNull(),
  countyFips: text("county_fips").notNull(),
  // IRS filing-year pair label, e.g. '2122' = tax years 2021→2022.
  filingYear: text("filing_year").notNull(),
  inflowReturns: integer("inflow_returns"),
  inflowIndividuals: integer("inflow_individuals"),
  inflowAgiThousands: bigint("inflow_agi_thousands", { mode: "number" }),
  outflowReturns: integer("outflow_returns"),
  outflowIndividuals: integer("outflow_individuals"),
  outflowAgiThousands: bigint("outflow_agi_thousands", { mode: "number" }),
  netReturns: integer("net_returns"),
  netAgiThousands: bigint("net_agi_thousands", { mode: "number" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  byFipsYear: uniqueIndex("county_migration_summary_fips_year_idx").on(
    table.stateFips,
    table.countyFips,
    table.filingYear,
  ),
}));

export type CountyMigrationSummaryRow = typeof countyMigrationSummary.$inferSelect;

// county_building_permits: Census BPS annual county permit UNITS (co{YYYY}a.txt).
// single_family = 1-unit structures; multi_family = 2 + 3-4 + 5+ unit
// structures; total = the sum. Covers permit-issuing places only — rural
// non-permitting counties are simply absent (never estimated here).
export const countyBuildingPermits = pgTable("county_building_permits", {
  id: serial("id").primaryKey(),
  stateFips: text("state_fips").notNull(),
  countyFips: text("county_fips").notNull(),
  year: integer("year").notNull(),
  totalUnits: integer("total_units").notNull(),
  singleFamilyUnits: integer("single_family_units").notNull(),
  multiFamilyUnits: integer("multi_family_units").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  byFipsYear: uniqueIndex("county_building_permits_fips_year_idx").on(
    table.stateFips,
    table.countyFips,
    table.year,
  ),
}));

export type CountyBuildingPermitsRow = typeof countyBuildingPermits.$inferSelect;

// ── 0202 — County employment & wages (Open-Data Program Phase 2.3) ──────────
// county_employment_wages: BLS QCEW annual county averages from the keyless
// open-data slice (data.bls.gov/cew/data/api/{year}/a/industry/10.csv,
// industry 10 = total all industries). Filtered to own_code=0 +
// agglvl_code=70 (county, total covered, all ownerships) — national/state/
// MSA rollups, per-ownership detail, and the XX999 "unknown or undefined"
// pseudo-counties never land here. BLS-suppressed counties (disclosure_code
// 'N', published as zeros) store NULL employment/wage — nulls are honest;
// establishment counts stay published even under suppression and are kept.
// Ingested by the bls_qcew_employment_v1 ETL job (server/services/
// etlHandlers.ts); read via server/services/openData/countyMarketSignals.ts.
//
// Mirrors scripts/migrate.mjs STATEMENTS + migrations/0202_county_employment_wages.sql.
export const countyEmploymentWages = pgTable("county_employment_wages", {
  id: serial("id").primaryKey(),
  stateFips: text("state_fips").notNull(),
  countyFips: text("county_fips").notNull(),
  year: integer("year").notNull(),
  // Annual average of monthly employment levels (QCEW annual_avg_emplvl).
  avgEmployment: integer("avg_employment"),
  // Annual average weekly wage in whole dollars (QCEW annual_avg_wkly_wage).
  avgWeeklyWage: integer("avg_weekly_wage"),
  // Annual average establishment count (QCEW annual_avg_estabs).
  establishments: integer("establishments"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  byFipsYear: uniqueIndex("county_employment_wages_fips_year_idx").on(
    table.stateFips,
    table.countyFips,
    table.year,
  ),
}));

export type CountyEmploymentWagesRow = typeof countyEmploymentWages.$inferSelect;

export const customerConcentration = pgTable("customer_concentration", {
  id: serial("id").primaryKey(),
  computedAt: timestamp("computed_at").defaultNow().notNull(),
  topMrrPctSingle: numeric("top_mrr_pct_single", { precision: 5, scale: 2 }).notNull().default("0"),
  topMrrPctTop3: numeric("top_mrr_pct_top3", { precision: 5, scale: 2 }).notNull().default("0"),
  totalMrrCents: bigint("total_mrr_cents", { mode: "number" }).notNull().default(0),
  activeOrgCount: integer("active_org_count").notNull().default(0),
  snapshot: jsonb("snapshot").$type<{
    topOrgs: Array<{
      organizationId: number;
      name: string;
      tier: string;
      billingInterval: string;
      mrrCents: number;
      pctOfTotal: number;
    }>;
  }>().notNull().default({ topOrgs: [] }),
  alertTriggered: boolean("alert_triggered").notNull().default(false),
  alertSeverity: text("alert_severity"), // null | 'warning' | 'critical'
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertCustomerConcentrationSchema = createInsertSchema(customerConcentration).omit({
  id: true,
  computedAt: true,
  createdAt: true,
});
export type InsertCustomerConcentration = z.infer<typeof insertCustomerConcentrationSchema>;
export type CustomerConcentrationRow = typeof customerConcentration.$inferSelect;

// Concentration alert thresholds — kept here so the job and dashboard share
// the same numbers. Adjust both via this constant only.
export const CONCENTRATION_THRESHOLDS = {
  singleCustomerCriticalPct: 20, // > 20% in one customer is critical
  top3CustomersWarningPct: 40,   // > 40% in top three is a warning
} as const;

// ============================================
// CUSTOMER UNIT ECONOMICS (Lavender Week 12)
// ============================================
// Per-org per-day rollup of MRR vs total COGS — variable (AI / mail / SMS /
// email / skip-trace) plus a fair share of fixed infra (Fly / Postgres /
// Clerk / Sentry). Computed nightly by services/unitEconomics.ts and read by
// /founder/unit-economics. See migrations/0063_customer_unit_economics.sql
// for column-by-column rationale.
//
// The unique (organizationId, computedDate) constraint means re-running the
// job on the same day upserts in place; that keeps the fixed-cost share
// from double-counting and gives the trend chart one clean point per day.

export const customerUnitEconomics = pgTable("customer_unit_economics", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id")
    .references(() => organizations.id, { onDelete: "cascade" })
    .notNull(),
  computedAt: timestamp("computed_at", { withTimezone: true }).defaultNow().notNull(),
  computedDate: date("computed_date").defaultNow().notNull(),
  windowDays: integer("window_days").notNull().default(30),

  mrrUsd: numeric("mrr_usd", { precision: 12, scale: 6 }).notNull().default("0"),

  aiCostUsd: numeric("ai_cost_usd", { precision: 12, scale: 6 }).notNull().default("0"),
  directMailCostUsd: numeric("direct_mail_cost_usd", { precision: 12, scale: 6 }).notNull().default("0"),
  smsCostUsd: numeric("sms_cost_usd", { precision: 12, scale: 6 }).notNull().default("0"),
  emailCostUsd: numeric("email_cost_usd", { precision: 12, scale: 6 }).notNull().default("0"),
  skipTraceCostUsd: numeric("skip_trace_cost_usd", { precision: 12, scale: 6 }).notNull().default("0"),

  fixedCostShareUsd: numeric("fixed_cost_share_usd", { precision: 12, scale: 6 }).notNull().default("0"),

  totalCogsUsd: numeric("total_cogs_usd", { precision: 12, scale: 6 }).notNull().default("0"),
  profitMarginUsd: numeric("profit_margin_usd", { precision: 12, scale: 6 }).notNull().default("0"),
  profitMarginPct: numeric("profit_margin_pct", { precision: 7, scale: 2 }).notNull().default("0"),

  aiCallCount: integer("ai_call_count").notNull().default(0),
  smsCount: integer("sms_count").notNull().default(0),
  emailCount: integer("email_count").notNull().default(0),
  directMailPieces: integer("direct_mail_pieces").notNull().default(0),
  skipTraceCount: integer("skip_trace_count").notNull().default(0),

  // breakdown.aiByFeature, breakdown.fixedCostInputs, breakdown.notes etc.
  breakdown: jsonb("breakdown").$type<{
    aiByFeature?: Record<string, { usd: number; calls: number }>;
    notes?: string[];
    fixedCostInputs?: {
      flyMonthlyUsd: number;
      postgresMonthlyUsd: number;
      clerkMonthlyUsd: number;
      sentryMonthlyUsd: number;
      activeCustomers: number;
    };
  }>().notNull().default({}),

  consecutiveUnprofitableDays: integer("consecutive_unprofitable_days").notNull().default(0),
}, (table) => [
  uniqueIndex("customer_unit_economics_org_date_uniq").on(
    table.organizationId,
    table.computedDate,
  ),
  index("customer_unit_economics_org_computed_idx").on(
    table.organizationId,
    table.computedAt,
  ),
  index("customer_unit_economics_computed_date_idx").on(table.computedDate),
  index("customer_unit_economics_margin_idx").on(table.profitMarginUsd),
]);

export const insertCustomerUnitEconomicsSchema = createInsertSchema(customerUnitEconomics).omit({
  id: true,
  computedAt: true,
});
export type InsertCustomerUnitEconomics = z.infer<typeof insertCustomerUnitEconomicsSchema>;
export type CustomerUnitEconomicsRow = typeof customerUnitEconomics.$inferSelect;

// Default fixed-cost inputs (USD per month). Sourced from the actual Fly +
// Neon + Clerk + Sentry invoices; nudge as the infra footprint grows. The
// unit-economics service divides these by the active-customer count to
// derive each org's fair share. Kept here so jobs and dashboards can share
// the same numbers.
export const FIXED_COST_INPUTS_USD_MONTHLY = {
  fly: 50,         // Fly compute (web + worker) — typical 2 machine fleet
  postgres: 25,    // Neon/Postgres baseline
  clerk: 25,       // Clerk MAU floor
  sentry: 26,      // Sentry team plan
} as const;

// Threshold for filing a "customer X is unprofitable for 7d" alert.
export const UNPROFITABLE_ALERT_DAYS = 7;

// ============================================
// DEFERRED REVENUE (Phase 3 Week 10)
// ============================================
// Period-by-period accrual rows. The recognition worker (Week 10+, out of
// scope here) will increment recognized_cents over time. One row per
// (organization, invoice/subscription period). Currency tracked for future
// multi-currency support; defaults to USD.

export const deferredRevenue = pgTable("deferred_revenue", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  subscriptionId: text("subscription_id"), // sub_xxx; null for one-time invoices
  invoiceId: text("invoice_id"),           // in_xxx; useful for recon
  periodStart: timestamp("period_start").notNull(),
  periodEnd: timestamp("period_end").notNull(),
  amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
  recognizedCents: bigint("recognized_cents", { mode: "number" }).notNull().default(0),
  asOfDate: timestamp("as_of_date").defaultNow().notNull(),
  currency: text("currency").notNull().default("usd"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertDeferredRevenueSchema = createInsertSchema(deferredRevenue).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertDeferredRevenue = z.infer<typeof insertDeferredRevenueSchema>;
export type DeferredRevenueRow = typeof deferredRevenue.$inferSelect;

// ============================================
// CANCELLATION SURVEYS & REFUND REQUESTS
// ============================================

// ── 0198 — Reactivation surveys (win-back "what brought you back") ──────────
// Written by POST /api/subscription/reactivation-survey (welcome-back page).
// Best-effort growth signal — the client swallows failures — but the store
// itself is durable (the 90-day activity_log retention would erase it).
// Mirrors scripts/migrate.mjs STATEMENTS + migrations/0198_reactivation_surveys.sql.
export const reactivationSurveys = pgTable("reactivation_surveys", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  userId: text("user_id"),
  // e.g. "missed_features" | "new_deals" | "pricing" | "other" — free string,
  // the client owns the vocabulary.
  returnReason: text("return_reason").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  byOrgCreated: index("reactivation_surveys_org_created_idx").on(table.organizationId, table.createdAt),
}));

export type ReactivationSurvey = typeof reactivationSurveys.$inferSelect;

export const cancellationSurveys = pgTable("cancellation_surveys", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  userId: text("user_id"),
  reason: text("reason").notNull(), // too_expensive, not_using, missing_features, switching_competitor, other
  feedback: text("feedback"), // optional free-text
  previousTier: text("previous_tier"),
  offeredDowngrade: boolean("offered_downgrade").default(false),
  acceptedDowngrade: boolean("accepted_downgrade").default(false),
  // Tahoe E11: 4th-rung pause flow. `offeredPause` is true any time the
  // cancellation dialog presented the pause option (we always do, but the
  // column is kept for future A/B variants that hide it). `acceptedPause`
  // is true when the user clicked Pause instead of Confirm cancellation,
  // and `pauseDays` records the 30/60/90 choice. When acceptedPause is
  // true the row represents a SAVE — no actual cancellation happened.
  offeredPause: boolean("offered_pause").default(false),
  acceptedPause: boolean("accepted_pause").default(false),
  pauseDays: integer("pause_days"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type CancellationSurvey = typeof cancellationSurveys.$inferSelect;
export type InsertCancellationSurvey = typeof cancellationSurveys.$inferInsert;

export const refundRequests = pgTable("refund_requests", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  userId: text("user_id"),
  stripeChargeId: text("stripe_charge_id"),
  stripePaymentIntentId: text("stripe_payment_intent_id"),
  amountCents: integer("amount_cents").notNull(),
  reason: text("reason"),
  status: text("status").notNull().default("pending"), // pending, approved, denied, processed
  autoApproved: boolean("auto_approved").default(false),
  processedAt: timestamp("processed_at"),
  processedBy: text("processed_by"), // 'auto' or founder user id
  stripeRefundId: text("stripe_refund_id"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type RefundRequest = typeof refundRequests.$inferSelect;
export type InsertRefundRequest = typeof refundRequests.$inferInsert;

// ============================================
// DATA SOURCE CACHE (Cached lookups from free sources)
// ============================================

export const dataSourceCache = pgTable("data_source_cache", {
  id: serial("id").primaryKey(),
  dataSourceId: integer("data_source_id").references(() => dataSources.id),
  
  lookupKey: text("lookup_key").notNull(),
  state: text("state"),
  county: text("county"),
  
  data: jsonb("data").$type<Record<string, any>>(),
  
  fetchedAt: timestamp("fetched_at").defaultNow(),
  expiresAt: timestamp("expires_at"),
  
  successfulFetch: boolean("successful_fetch").default(true),
  errorMessage: text("error_message"),
});

export const insertDataSourceCacheSchema = createInsertSchema(dataSourceCache).omit({
  id: true,
  fetchedAt: true,
});
export type InsertDataSourceCache = z.infer<typeof insertDataSourceCacheSchema>;
export type DataSourceCache = typeof dataSourceCache.$inferSelect;

// ============================================
// DISCOVERED ENDPOINTS (Live GIS Discovery Results)
// ============================================

export const discoveredEndpoints = pgTable("discovered_endpoints", {
  id: serial("id").primaryKey(),
  
  // Location info
  state: text("state").notNull(), // 2-letter state code
  county: text("county").notNull(),
  
  // Endpoint info
  baseUrl: text("base_url").notNull(),
  endpointType: text("endpoint_type").notNull().default("arcgis_rest"),
  serviceName: text("service_name"), // Name from discovery source
  
  // Discovery metadata
  discoverySource: text("discovery_source").notNull(), // 'arcgis_online', 'open_data_catalog', 'manual'
  discoveryDate: timestamp("discovery_date").defaultNow().notNull(),
  lastChecked: timestamp("last_checked"),
  
  // Validation
  status: text("status").notNull().default("pending"), // pending, validated, rejected, added
  healthCheckPassed: boolean("health_check_passed"),
  healthCheckMessage: text("health_check_message"),
  confidenceScore: integer("confidence_score"), // 0-100
  
  // Additional metadata from discovery
  metadata: jsonb("metadata").$type<Record<string, any>>(),
  
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertDiscoveredEndpointSchema = createInsertSchema(discoveredEndpoints).omit({
  id: true,
  createdAt: true,
});
export type InsertDiscoveredEndpoint = z.infer<typeof insertDiscoveredEndpointSchema>;
export type DiscoveredEndpoint = typeof discoveredEndpoints.$inferSelect;

// ============================================
// WORKFLOW AUTOMATION
// ============================================

// Trigger event types for workflows
export const WORKFLOW_TRIGGER_EVENTS = [
  "lead.created",
  "lead.updated",
  "lead.status_changed",
  "property.created",
  "property.updated",
  "property.status_changed",
  "deal.created",
  "deal.updated",
  "deal.stage_changed",
  "payment.received",
  "payment.missed",
  // Pillar K (note-investor) lifecycle events. Existing templates
  // referenced note.balloon_approaching + note.ltv_alert but the union
  // didn't declare them; new note-lifecycle templates below add the
  // remaining four. See docs/archive/exhaustive-completion/pillar-k-note-
  // investors-25-personas.md for the persona insights driving these.
  "note.balloon_approaching",
  "note.ltv_alert",
  "note.insurance_expiring_60d",
  "note.escrow_shortfall",
  "note.reperforming_threshold",
  // Pillar L — tax-delinquent specialist lifecycle. See
  // pillar-l-tax-delinquent-25-personas.md.
  "cert.acquired",
  "cert.redemption_period_60d",
  "cert.foreclosure_eligible",
  "cert.redeemed",
  // Pillar M — wholesaler lifecycle. See
  // pillar-m-wholesalers-25-personas.md.
  "deal.contract_signed",
  "deal.assignment_pending",
  "deal.occupied",
  // Buyer-match lifecycle. tpl_buyer_match_found triggered on this event via
  // the engine's local ExtendedTriggerEvent escape hatch; audit Wave 1
  // (wholesaler beta→core) wired a real emitter (buyerEvents.ts → emitBuyerEvent,
  // from buyerMatchingAI's fresh-insert branch), so it graduates into the shared
  // union here and out of the legacy escape hatch.
  "buyer.match_created",
  // Pillar N — subdivider lifecycle. See
  // pillar-n-subdividers-25-personas.md.
  "plat.submitted",
  "subdivision.vendor_milestone",
  "subdivision.phase_recorded",
  // Pillar O — fix-and-flipper lifecycle. See
  // pillar-o-fix-and-flippers-25-personas.md.
  "rehab.milestone",
  "rehab.punch_list_complete",
  // Pillar P — buy-and-hold landlord lifecycle. See
  // pillar-p-landlords-25-personas.md.
  "lease.renewal_countdown_60d",
  "maintenance.request_received",
  "rent.received",
  // lease.expiring_60d GRADUATED out of the engine-local ExtendedTriggerEvent
  // escape hatch in audit Wave 1 (buy_and_hold beta→core): it now has a real
  // emitter (rentalEvents.ts → emitRentalEvent, fired by the daily
  // leaseExpiryDetector job alongside lease.renewal_countdown_60d), so it joins
  // the shared union here and tpl_lease_expiring left
  // LEGACY_EXTENDED_TRIGGER_TEMPLATE_IDS in the same change.
  "lease.expiring_60d",
  // Short-term-rental (STR) lifecycle. reservation.checkout fires when an STR
  // reservation transitions to 'checked_out' (the real production seam in
  // server/routes-rent-ledger.ts PATCH /api/reservations/:id/status →
  // server/services/strEvents.ts → emitStrEvent). Drives the turnover-cleaning
  // template. See shared/schema/rental.ts (reservations) + strMetrics.ts.
  "reservation.checkout",
  // Iyari (Chief of Future) #5 — Owner-change & tax-status delta detector.
  // Derived FREE from the append-only parcel_observations log (migration 0121)
  // by a scheduled diff job (server/services/parcelDeltaDetector.ts). Fires when
  // a tracked parcel fact (owner / owner_address / tax_status / tax_amount)
  // meaningfully changes between the latest two observations for a parcel in a
  // customer's pipeline. This is the killer app of owning longitudinal county-GIS
  // history — the proactive lead signal investors pay PropStream/PropGrid for.
  "parcel.owner_changed",
  "parcel.tax_status_changed",
] as const;

export type WorkflowTriggerEvent = typeof WORKFLOW_TRIGGER_EVENTS[number];

// Action types for workflows
export const WORKFLOW_ACTION_TYPES = [
  "send_email",
  "create_task",
  "update_record",
  "run_agent_skill",
  "send_notification",
  "delay",
] as const;

export type WorkflowActionType = typeof WORKFLOW_ACTION_TYPES[number];

// Workflow trigger configuration
export type WorkflowTrigger = {
  event: WorkflowTriggerEvent;
  conditions?: {
    field: string;
    operator: "equals" | "not_equals" | "contains" | "greater_than" | "less_than" | "in" | "not_in";
    value: any;
  }[];
};

// Workflow action configuration
export type WorkflowAction = {
  id: string;
  type: WorkflowActionType;
  config: {
    // send_email
    to?: string;
    subject?: string;
    body?: string;
    templateId?: string;
    // create_task
    title?: string;
    description?: string;
    priority?: "low" | "medium" | "high";
    assignedTo?: number;
    dueInDays?: number;
    // update_record
    entityType?: "lead" | "property" | "deal";
    updates?: Record<string, any>;
    // run_agent_skill
    skillId?: string;
    skillParams?: Record<string, any>;
    // send_notification
    message?: string;
    notificationType?: "info" | "warning" | "success";
    // delay
    delayMinutes?: number;
  };
};

// Workflow run statuses.
// "waiting" (Wave B "Wire the engine", 2026-07-29) means the run parked on a
// durable `delay` step: it is NOT finished, NOT failed, and will be picked up
// again by the workflow_delay_resume job once `resumeAt` passes. Before this,
// `delay` slept in-process and silently capped at 60s, so a "wait 2 days" step
// resumed after a minute and vanished entirely on restart.
export const WORKFLOW_RUN_STATUSES = ["pending", "running", "waiting", "completed", "failed"] as const;
export type WorkflowRunStatus = typeof WORKFLOW_RUN_STATUSES[number];

/**
 * Everything the engine needs to pick a parked run back up in a DIFFERENT
 * process than the one that parked it. Persisted on the run row, so a deploy,
 * crash, or machine swap mid-delay does not lose the workflow.
 */
export type WorkflowRunResumeState = {
  /** Index of the `delay` action the run parked on. */
  delayActionIndex: number;
  /** Index of the action to execute when the run resumes. */
  nextActionIndex: number;
  /** Interpolation variables accumulated by the steps that already ran. */
  variables: Record<string, any>;
  /** The delay as configured, for the run log (not recomputed on resume). */
  delayMinutes: number;
};

// Workflows table
export const workflows = pgTable("workflows", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  name: text("name").notNull(),
  description: text("description"),
  trigger: jsonb("trigger").$type<WorkflowTrigger>().notNull(),
  actions: jsonb("actions").$type<WorkflowAction[]>().notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertWorkflowSchema = createInsertSchema(workflows).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertWorkflow = z.infer<typeof insertWorkflowSchema>;
export type Workflow = typeof workflows.$inferSelect;

// Workflow execution log entry
export type WorkflowExecutionLogEntry = {
  actionId: string;
  actionType: WorkflowActionType;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  startedAt?: string;
  completedAt?: string;
  result?: any;
  error?: string;
};

// Workflow runs table (execution history)
export const workflowRuns = pgTable("workflow_runs", {
  id: serial("id").primaryKey(),
  workflowId: integer("workflow_id").references(() => workflows.id).notNull(),
  status: text("status").$type<WorkflowRunStatus>().notNull().default("pending"),
  triggerData: jsonb("trigger_data").$type<{
    event: WorkflowTriggerEvent;
    entityId?: number;
    entityType?: string;
    data?: Record<string, any>;
    previousData?: Record<string, any>;
  }>(),
  executionLog: jsonb("execution_log").$type<WorkflowExecutionLogEntry[]>(),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  error: text("error"),
  // Durable `delay` (Wave B). Set together with status "waiting"; both are
  // cleared when the run resumes. Indexed for the due-sweep in
  // server/jobs/workflowDelayResume.ts.
  resumeAt: timestamp("resume_at"),
  resumeState: jsonb("resume_state").$type<WorkflowRunResumeState>(),
});

export const insertWorkflowRunSchema = createInsertSchema(workflowRuns).omit({
  id: true,
});
export type InsertWorkflowRun = z.infer<typeof insertWorkflowRunSchema>;
export type WorkflowRun = typeof workflowRuns.$inferSelect;

// ============================================
// SCHEDULED TASKS (Automation with Retry Logic)
// ============================================

// Task types
export const SCHEDULED_TASK_TYPES = ["workflow", "agent_skill", "custom"] as const;
export type ScheduledTaskType = typeof SCHEDULED_TASK_TYPES[number];

// Task statuses
export const SCHEDULED_TASK_STATUSES = ["active", "paused", "failed"] as const;
export type ScheduledTaskStatus = typeof SCHEDULED_TASK_STATUSES[number];

// Simple schedule types
export const SIMPLE_SCHEDULE_TYPES = ["hourly", "daily", "weekly", "monthly"] as const;
export type SimpleScheduleType = typeof SIMPLE_SCHEDULE_TYPES[number];

// Scheduled tasks table
export const scheduledTasks = pgTable("scheduled_tasks", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  name: text("name").notNull(),
  type: text("type").$type<ScheduledTaskType>().notNull(), // workflow, agent_skill, custom
  config: jsonb("config").$type<{
    workflowId?: number;
    skillId?: string;
    skillParams?: Record<string, any>;
    customHandler?: string;
    customParams?: Record<string, any>;
  }>().notNull(),
  schedule: text("schedule").notNull(), // cron expression or simple: daily, weekly, hourly, monthly
  nextRunAt: timestamp("next_run_at"),
  lastRunAt: timestamp("last_run_at"),
  status: text("status").$type<ScheduledTaskStatus>().notNull().default("active"),
  retryCount: integer("retry_count").notNull().default(0),
  maxRetries: integer("max_retries").notNull().default(3),
  retryDelayMinutes: integer("retry_delay_minutes").notNull().default(5),
  lastError: text("last_error"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertScheduledTaskSchema = createInsertSchema(scheduledTasks).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertScheduledTask = z.infer<typeof insertScheduledTaskSchema>;
export type ScheduledTask = typeof scheduledTasks.$inferSelect;

// ============================================
// PHASE 4: CLOSING & SERVICING AUTOMATION
// ============================================

// ----------------------------------------
// DISPOSITION AUTOMATION TABLES
// ----------------------------------------

// Buyer Reservations - Track property reservations by buyers
export const buyerReservations = pgTable("buyer_reservations", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  propertyId: integer("property_id").references(() => properties.id).notNull(),
  buyerId: integer("buyer_id").references(() => leads.id),
  buyerName: text("buyer_name").notNull(),
  buyerEmail: text("buyer_email"),
  buyerPhone: text("buyer_phone"),
  reservationAmount: numeric("reservation_amount"),
  reservationDate: timestamp("reservation_date").defaultNow(),
  expirationDate: timestamp("expiration_date"),
  status: text("status").notNull().default("pending"),
  paymentMethod: text("payment_method"),
  stripePaymentIntentId: text("stripe_payment_intent_id"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertBuyerReservationSchema = createInsertSchema(buyerReservations).omit({ id: true, createdAt: true });
export type InsertBuyerReservation = z.infer<typeof insertBuyerReservationSchema>;
export type BuyerReservation = typeof buyerReservations.$inferSelect;

// Escrow Checklists - Track closing steps
export const escrowChecklists = pgTable("escrow_checklists", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  dealId: integer("deal_id").references(() => deals.id).notNull(),
  title: text("title").notNull(),
  items: jsonb("items").$type<Array<{
    id: string;
    label: string;
    completed: boolean;
    completedAt?: string;
    completedBy?: string;
    required: boolean;
    notes?: string;
  }>>().default([]),
  status: text("status").notNull().default("in_progress"),
  targetCloseDate: timestamp("target_close_date"),
  actualCloseDate: timestamp("actual_close_date"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertEscrowChecklistSchema = createInsertSchema(escrowChecklists).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEscrowChecklist = z.infer<typeof insertEscrowChecklistSchema>;
export type EscrowChecklist = typeof escrowChecklists.$inferSelect;

// Closing Packets - Generated document bundles
export const closingPackets = pgTable("closing_packets", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  dealId: integer("deal_id").references(() => deals.id).notNull(),
  type: text("type").notNull(),
  documents: jsonb("documents").$type<Array<{
    name: string;
    type: string;
    url?: string;
    generatedAt?: string;
    signed?: boolean;
    signedAt?: string;
  }>>().default([]),
  status: text("status").notNull().default("draft"),
  sentAt: timestamp("sent_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertClosingPacketSchema = createInsertSchema(closingPackets).omit({ id: true, createdAt: true });
export type InsertClosingPacket = z.infer<typeof insertClosingPacketSchema>;
export type ClosingPacket = typeof closingPackets.$inferSelect;

// ----------------------------------------
// NOTE SERVICING TABLES
// ----------------------------------------

// Autopay Enrollments - Recurring payment setup
export const autopayEnrollments = pgTable("autopay_enrollments", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  noteId: integer("note_id").references(() => notes.id).notNull(),
  borrowerName: text("borrower_name").notNull(),
  borrowerEmail: text("borrower_email"),
  paymentMethod: text("payment_method").notNull(),
  stripeCustomerId: text("stripe_customer_id"),
  stripePaymentMethodId: text("stripe_payment_method_id"),
  amount: numeric("amount").notNull(),
  dayOfMonth: integer("day_of_month").notNull().default(1),
  status: text("status").notNull().default("active"),
  lastPaymentDate: timestamp("last_payment_date"),
  nextPaymentDate: timestamp("next_payment_date"),
  failureCount: integer("failure_count").default(0),
  lastFailureReason: text("last_failure_reason"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertAutopayEnrollmentSchema = createInsertSchema(autopayEnrollments).omit({ id: true, createdAt: true });
export type InsertAutopayEnrollment = z.infer<typeof insertAutopayEnrollmentSchema>;
export type AutopayEnrollment = typeof autopayEnrollments.$inferSelect;

// Payoff Quotes - Calculate and track payoff amounts
export const payoffQuotes = pgTable("payoff_quotes", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  noteId: integer("note_id").references(() => notes.id).notNull(),
  requestedBy: text("requested_by"),
  principalBalance: numeric("principal_balance").notNull(),
  accruedInterest: numeric("accrued_interest").notNull(),
  fees: numeric("fees").default("0"),
  totalPayoff: numeric("total_payoff").notNull(),
  goodThroughDate: timestamp("good_through_date").notNull(),
  status: text("status").notNull().default("pending"),
  paidAt: timestamp("paid_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertPayoffQuoteSchema = createInsertSchema(payoffQuotes).omit({ id: true, createdAt: true });
export type InsertPayoffQuote = z.infer<typeof insertPayoffQuoteSchema>;
export type PayoffQuote = typeof payoffQuotes.$inferSelect;

// Trust Ledger - Accounting entries for trust accounts
export const trustLedger = pgTable("trust_ledger", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  noteId: integer("note_id").references(() => notes.id),
  entryType: text("entry_type").notNull(),
  amount: numeric("amount").notNull(),
  runningBalance: numeric("running_balance").notNull(),
  description: text("description"),
  referenceId: text("reference_id"),
  referenceType: text("reference_type"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertTrustLedgerSchema = createInsertSchema(trustLedger).omit({ id: true, createdAt: true });
export type InsertTrustLedger = z.infer<typeof insertTrustLedgerSchema>;
export type TrustLedgerEntry = typeof trustLedger.$inferSelect;

// Delinquency Escalations - Track and automate collection steps
export const delinquencyEscalations = pgTable("delinquency_escalations", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  noteId: integer("note_id").references(() => notes.id).notNull(),
  daysDelinquent: integer("days_delinquent").notNull(),
  escalationLevel: integer("escalation_level").notNull().default(1),
  amountDue: numeric("amount_due").notNull(),
  lastContactDate: timestamp("last_contact_date"),
  lastContactMethod: text("last_contact_method"),
  nextActionDate: timestamp("next_action_date"),
  nextAction: text("next_action"),
  status: text("status").notNull().default("active"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("delinquency_escalations_org_idx").on(table.organizationId),
  index("delinquency_escalations_status_idx").on(table.status),
  index("delinquency_escalations_next_action_idx").on(table.nextActionDate),
]);

export const insertDelinquencyEscalationSchema = createInsertSchema(delinquencyEscalations).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertDelinquencyEscalation = z.infer<typeof insertDelinquencyEscalationSchema>;
export type DelinquencyEscalation = typeof delinquencyEscalations.$inferSelect;

// ----------------------------------------
// DUE DILIGENCE OPS TABLES
// ----------------------------------------

// DD Assignments - Assign DD tasks to team/vendors
export const ddAssignments = pgTable("dd_assignments", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  propertyId: integer("property_id").references(() => properties.id).notNull(),
  assigneeType: text("assignee_type").notNull(),
  assigneeId: integer("assignee_id"),
  vendorName: text("vendor_name"),
  vendorEmail: text("vendor_email"),
  taskType: text("task_type").notNull(),
  dueDate: timestamp("due_date"),
  status: text("status").notNull().default("pending"),
  priority: text("priority").default("normal"),
  cost: numeric("cost"),
  result: text("result"),
  resultNotes: text("result_notes"),
  attachments: jsonb("attachments").$type<string[]>().default([]),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertDdAssignmentSchema = createInsertSchema(ddAssignments).omit({ id: true, createdAt: true });
export type InsertDdAssignment = z.infer<typeof insertDdAssignmentSchema>;
export type DdAssignment = typeof ddAssignments.$inferSelect;

// SWOT Reports - Property analysis reports
export const swotReports = pgTable("swot_reports", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  propertyId: integer("property_id").references(() => properties.id).notNull(),
  strengths: jsonb("strengths").$type<string[]>().default([]),
  weaknesses: jsonb("weaknesses").$type<string[]>().default([]),
  opportunities: jsonb("opportunities").$type<string[]>().default([]),
  threats: jsonb("threats").$type<string[]>().default([]),
  overallScore: integer("overall_score"),
  recommendation: text("recommendation"),
  aiGenerated: boolean("ai_generated").default(false),
  generatedBy: text("generated_by"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertSwotReportSchema = createInsertSchema(swotReports).omit({ id: true, createdAt: true });
export type InsertSwotReport = z.infer<typeof insertSwotReportSchema>;
export type SwotReport = typeof swotReports.$inferSelect;

// Go/No-Go Memos - Investment decision documents
export const goNogoMemos = pgTable("go_nogo_memos", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  propertyId: integer("property_id").references(() => properties.id).notNull(),
  dealId: integer("deal_id").references(() => deals.id),
  decision: text("decision").notNull(),
  decisionDate: timestamp("decision_date").defaultNow(),
  decisionBy: text("decision_by"),
  maxOfferPrice: numeric("max_offer_price"),
  targetProfit: numeric("target_profit"),
  riskLevel: text("risk_level"),
  keyFindings: jsonb("key_findings").$type<string[]>().default([]),
  conditions: jsonb("conditions").$type<string[]>().default([]),
  attachedReports: jsonb("attached_reports").$type<Array<{type: string; id: number}>>().default([]),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertGoNogoMemoSchema = createInsertSchema(goNogoMemos).omit({ id: true, createdAt: true });
export type InsertGoNogoMemo = z.infer<typeof insertGoNogoMemoSchema>;
export type GoNogoMemo = typeof goNogoMemos.$inferSelect;

// ============================================
// WRITING STYLE PROFILES
// ============================================

// User writing style profiles - stores learned communication patterns
export const writingStyleProfiles = pgTable("writing_style_profiles", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  userId: text("user_id").notNull(), // Replit user ID
  name: text("name").notNull().default("Default Style"),
  isDefault: boolean("is_default").default(true),
  
  // Tone and style characteristics (analyzed from samples)
  toneAnalysis: jsonb("tone_analysis").$type<{
    formality: "casual" | "semi-formal" | "formal"; // detected formality level
    warmth: number; // 0-100 warmth score
    directness: number; // 0-100 how direct vs indirect
    enthusiasm: number; // 0-100 enthusiasm level
    humor: boolean; // uses humor
    empathy: number; // 0-100 empathy level
  }>(),
  
  // Common phrases and patterns
  patterns: jsonb("patterns").$type<{
    greetings: string[]; // common greetings used
    closings: string[]; // common sign-offs
    transitionPhrases: string[]; // how they move between topics
    emphasisStyle: string; // how they emphasize (caps, exclamation, etc.)
    questionStyle: string; // how they ask questions
    commonPhrases: string[]; // frequently used expressions
  }>(),
  
  // Sample messages for few-shot learning
  sampleMessages: jsonb("sample_messages").$type<{
    id: string;
    context: string; // what kind of message (initial outreach, follow-up, negotiation, etc.)
    content: string;
    sentiment: "positive" | "neutral" | "negative";
    addedAt: string;
  }[]>(),
  
  // Preferences
  preferences: jsonb("preferences").$type<{
    maxLength?: number; // preferred message length
    usesEmoji: boolean;
    signatureLine?: string;
    preferredChannels?: string[];
  }>(),
  
  // Training metadata
  totalSamples: integer("total_samples").default(0),
  lastTrainedAt: timestamp("last_trained_at"),
  confidenceScore: numeric("confidence_score").default("0"), // 0-1 how confident in style match
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertWritingStyleProfileSchema = createInsertSchema(writingStyleProfiles).omit({ 
  id: true, 
  createdAt: true, 
  updatedAt: true 
});
export type InsertWritingStyleProfile = z.infer<typeof insertWritingStyleProfileSchema>;
export type WritingStyleProfile = typeof writingStyleProfiles.$inferSelect;

// ============================================
// BROWSER AUTOMATION
// ============================================

// Browser automation job templates - reusable automation recipes
export const browserAutomationTemplates = pgTable("browser_automation_templates", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id"), // null = system template
  name: text("name").notNull(),
  description: text("description"),
  category: text("category").notNull(), // county_research, listings, public_records, data_entry
  targetDomain: text("target_domain"), // e.g., "recorder.maricopa.gov"
  
  // Step definitions
  steps: jsonb("steps").$type<{
    order: number;
    action: "navigate" | "click" | "type" | "select" | "wait" | "screenshot" | "extract" | "scroll";
    selector?: string;
    value?: string;
    waitTime?: number;
    extractAs?: string; // variable name to store extracted data
    description: string;
  }[]>(),
  
  // Input/output schema
  inputSchema: jsonb("input_schema").$type<{
    name: string;
    type: "string" | "number" | "boolean";
    required: boolean;
    description: string;
  }[]>(),
  outputSchema: jsonb("output_schema").$type<{
    name: string;
    type: "string" | "number" | "boolean" | "array" | "object";
    description: string;
  }[]>(),
  
  // Settings
  requiresAuth: boolean("requires_auth").default(false),
  estimatedDurationMs: integer("estimated_duration_ms"),
  isPublic: boolean("is_public").default(false),
  isEnabled: boolean("is_enabled").default(true),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertBrowserAutomationTemplateSchema = createInsertSchema(browserAutomationTemplates).omit({ 
  id: true, 
  createdAt: true, 
  updatedAt: true 
});
export type InsertBrowserAutomationTemplate = z.infer<typeof insertBrowserAutomationTemplateSchema>;
export type BrowserAutomationTemplate = typeof browserAutomationTemplates.$inferSelect;

// Browser automation jobs - queued/running automation tasks
export const browserAutomationJobs = pgTable("browser_automation_jobs", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  templateId: integer("template_id").references(() => browserAutomationTemplates.id),
  
  // Job details
  name: text("name").notNull(),
  status: text("status").notNull().default("queued"), // queued, running, completed, failed, cancelled
  priority: integer("priority").default(5), // 1-10, lower is higher priority
  
  // Input/output
  inputData: jsonb("input_data").$type<Record<string, any>>(),
  outputData: jsonb("output_data").$type<Record<string, any>>(),
  screenshots: jsonb("screenshots").$type<{
    name: string;
    url: string;
    capturedAt: string;
  }[]>(),
  
  // Error handling
  error: text("error"),
  errorDetails: jsonb("error_details").$type<{
    step?: number;
    selector?: string;
    message: string;
    stack?: string;
  }>(),
  retryCount: integer("retry_count").default(0),
  maxRetries: integer("max_retries").default(3),
  
  // Execution
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  executionTimeMs: integer("execution_time_ms"),
  
  // Agent integration
  triggeredByAgentTaskId: integer("triggered_by_agent_task_id").references(() => agentTasks.id),
  triggeredByUserId: text("triggered_by_user_id"),
  
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertBrowserAutomationJobSchema = createInsertSchema(browserAutomationJobs).omit({ 
  id: true, 
  createdAt: true 
});
export type InsertBrowserAutomationJob = z.infer<typeof insertBrowserAutomationJobSchema>;
export type BrowserAutomationJob = typeof browserAutomationJobs.$inferSelect;

// Browser session credentials - securely stored credentials for automation
export const browserSessionCredentials = pgTable("browser_session_credentials", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  domain: text("domain").notNull(), // e.g., "facebook.com"
  name: text("name").notNull(), // friendly name
  
  // Encrypted credential storage
  encryptedData: text("encrypted_data"), // encrypted JSON with login details
  
  // Session state
  lastValidatedAt: timestamp("last_validated_at"),
  isValid: boolean("is_valid").default(true),
  validationError: text("validation_error"),
  
  // Usage tracking
  lastUsedAt: timestamp("last_used_at"),
  usageCount: integer("usage_count").default(0),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertBrowserSessionCredentialSchema = createInsertSchema(browserSessionCredentials).omit({ 
  id: true, 
  createdAt: true, 
  updatedAt: true 
});
export type InsertBrowserSessionCredential = z.infer<typeof insertBrowserSessionCredentialSchema>;
export type BrowserSessionCredential = typeof browserSessionCredentials.$inferSelect;

// ============================================
// LEAD QUALIFICATION & ESCALATION
// ============================================

// Lead qualification signals - tracks buyer readiness indicators
export const leadQualificationSignals = pgTable("lead_qualification_signals", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  leadId: integer("lead_id").references(() => leads.id).notNull(),
  conversationId: integer("conversation_id").references(() => conversations.id),
  
  // Signal details
  signalType: text("signal_type").notNull(), // price_inquiry, timeline_mention, financing_question, viewing_request, comparison_shopping, urgency, objection, negotiation
  confidence: numeric("confidence").notNull(), // 0-1 confidence score
  extractedText: text("extracted_text"), // the text that triggered this signal
  
  // Buyer intent scoring
  intentScore: integer("intent_score"), // 0-100 how ready to buy
  
  metadata: jsonb("metadata").$type<{
    mentionedPrice?: number;
    mentionedTimeline?: string;
    propertyId?: number;
    channel?: string;
  }>(),
  
  detectedAt: timestamp("detected_at").defaultNow(),
});

export const insertLeadQualificationSignalSchema = createInsertSchema(leadQualificationSignals).omit({ 
  id: true, 
  detectedAt: true 
});
export type InsertLeadQualificationSignal = z.infer<typeof insertLeadQualificationSignalSchema>;
export type LeadQualificationSignal = typeof leadQualificationSignals.$inferSelect;

// Escalation alerts - notifies user when action needed
export const escalationAlerts = pgTable("escalation_alerts", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  leadId: integer("lead_id").references(() => leads.id),
  conversationId: integer("conversation_id").references(() => conversations.id),
  propertyId: integer("property_id").references(() => properties.id),
  
  // Alert details
  alertType: text("alert_type").notNull(), // hot_lead, ready_to_buy, price_negotiation, urgent_response, escalation_requested
  priority: text("priority").notNull().default("medium"), // low, medium, high, urgent
  title: text("title").notNull(),
  description: text("description"),
  
  // Recommended action
  suggestedAction: text("suggested_action"),
  suggestedResponse: text("suggested_response"), // AI-drafted response
  
  // Status
  status: text("status").notNull().default("pending"), // pending, acknowledged, actioned, dismissed
  acknowledgedAt: timestamp("acknowledged_at"),
  acknowledgedBy: text("acknowledged_by"),
  actionTaken: text("action_taken"),
  
  // Auto-dismiss rules
  expiresAt: timestamp("expires_at"),
  
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertEscalationAlertSchema = createInsertSchema(escalationAlerts).omit({ 
  id: true, 
  createdAt: true 
});
export type InsertEscalationAlert = z.infer<typeof insertEscalationAlertSchema>;
export type EscalationAlert = typeof escalationAlerts.$inferSelect;

// ============================================
// ACQUISITION RADAR - OPPORTUNITY SCORING
// ============================================

// Opportunity types for acquisition radar
export const OPPORTUNITY_TYPES = {
  undervalued: { name: "Undervalued", description: "Listed well below market value", color: "green" },
  motivated_seller: { name: "Motivated Seller", description: "Signs of urgency (estate, divorce, tax issues)", color: "orange" },
  off_market: { name: "Off-Market", description: "Not listed but shows potential (tax delinquent, inherited)", color: "purple" },
  market_shift: { name: "Market Shift", description: "Area experiencing value growth", color: "blue" },
} as const;

export type OpportunityType = keyof typeof OPPORTUNITY_TYPES;

// Radar configuration per organization
export const radarConfigs = pgTable("radar_configs", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  
  name: text("name").notNull().default("Default"),
  isActive: boolean("is_active").default(true),
  
  // Scoring weights (sum to 100)
  weights: jsonb("weights").$type<{
    priceVsAssessed: number; // Weight for price vs assessed value comparison
    daysOnMarket: number; // Weight for DOM scoring
    sellerMotivation: number; // Weight for motivation signals
    marketVelocity: number; // Weight for market activity
    comparableSpreads: number; // Weight for comp analysis
    environmentalRisk: number; // Negative weight for flood/wetland risk
    ownerSignals: number; // Weight for out-of-state, inherited, corporate
  }>().default({
    priceVsAssessed: 25,
    daysOnMarket: 15,
    sellerMotivation: 20,
    marketVelocity: 15,
    comparableSpreads: 15,
    environmentalRisk: -10,
    ownerSignals: 20,
  }),
  
  // Thresholds
  thresholds: jsonb("thresholds").$type<{
    hotOpportunity: number; // Score threshold for "hot" opportunities (default 80)
    goodOpportunity: number; // Score threshold for "good" opportunities (default 60)
    minimumScore: number; // Minimum score to surface (default 40)
    maxDaysOnMarket: number; // Maximum DOM to consider (default 365)
    minPriceDiscount: number; // Minimum discount % below assessed (default 10)
    maxFloodRisk: number; // Maximum flood risk score to accept (default 50)
  }>().default({
    hotOpportunity: 80,
    goodOpportunity: 60,
    minimumScore: 40,
    maxDaysOnMarket: 365,
    minPriceDiscount: 10,
    maxFloodRisk: 50,
  }),
  
  // Target criteria
  targetCriteria: jsonb("target_criteria").$type<{
    states?: string[];
    counties?: string[];
    minAcres?: number;
    maxAcres?: number;
    minPrice?: number;
    maxPrice?: number;
    zoning?: string[];
    opportunityTypes?: OpportunityType[];
  }>(),
  
  // Alert settings
  alertSettings: jsonb("alert_settings").$type<{
    enabled: boolean;
    topNPerMarket: number; // How many top opportunities to alert on per market
    autoTriggerDueDiligence: boolean;
    notifyOnHotOnly: boolean; // Only alert for hot opportunities
    digestFrequency: "realtime" | "hourly" | "daily" | "weekly";
  }>().default({
    enabled: true,
    topNPerMarket: 10,
    autoTriggerDueDiligence: false,
    notifyOnHotOnly: false,
    digestFrequency: "daily",
  }),
  
  // Scanner settings
  scannerSettings: jsonb("scanner_settings").$type<{
    batchSize: number; // Parcels to process per batch
    scanIntervalMinutes: number; // How often to scan
    priorityCounties?: string[]; // Counties to scan more frequently
  }>().default({
    batchSize: 100,
    scanIntervalMinutes: 60,
  }),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertRadarConfigSchema = createInsertSchema(radarConfigs).omit({ 
  id: true, 
  createdAt: true,
  updatedAt: true,
});
export type InsertRadarConfig = z.infer<typeof insertRadarConfigSchema>;
export type RadarConfig = typeof radarConfigs.$inferSelect;

// Opportunity scores - stored scored opportunities with explanation
export const opportunityScores = pgTable("opportunity_scores", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  radarConfigId: integer("radar_config_id").references(() => radarConfigs.id),
  
  // Property reference
  propertyId: integer("property_id").references(() => properties.id),
  apn: text("apn"),
  county: text("county"),
  state: text("state"),
  
  // Opportunity classification
  opportunityType: text("opportunity_type").notNull(), // undervalued, motivated_seller, off_market, market_shift
  
  // Overall score (0-100)
  score: integer("score").notNull(),
  previousScore: integer("previous_score"),
  scoreChange: integer("score_change"),
  rank: integer("rank"), // Rank within market/county
  
  // Score breakdown with explainability
  scoreFactors: jsonb("score_factors").$type<{
    priceVsAssessed?: {
      score: number;
      weight: number;
      contribution: number;
      details: {
        listPrice?: number;
        assessedValue?: number;
        discountPercent?: number;
        explanation: string;
      };
    };
    daysOnMarket?: {
      score: number;
      weight: number;
      contribution: number;
      details: {
        dom: number;
        averageDom?: number;
        explanation: string;
      };
    };
    sellerMotivation?: {
      score: number;
      weight: number;
      contribution: number;
      details: {
        signals: string[];
        explanation: string;
      };
    };
    marketVelocity?: {
      score: number;
      weight: number;
      contribution: number;
      details: {
        recentSales?: number;
        absorptionRate?: number;
        priceChangePercent?: number;
        explanation: string;
      };
    };
    comparableSpreads?: {
      score: number;
      weight: number;
      contribution: number;
      details: {
        avgCompPrice?: number;
        pricePerAcre?: number;
        spreadPercent?: number;
        explanation: string;
      };
    };
    environmentalRisk?: {
      score: number;
      weight: number;
      contribution: number;
      details: {
        floodZone?: string;
        wetlandsPercent?: number;
        riskLevel: "low" | "medium" | "high";
        explanation: string;
      };
    };
    ownerSignals?: {
      score: number;
      weight: number;
      contribution: number;
      details: {
        isOutOfState?: boolean;
        isInherited?: boolean;
        isTaxDelinquent?: boolean;
        isCorporate?: boolean;
        ownershipYears?: number;
        explanation: string;
      };
    };
  }>(),
  
  // Human-readable explanation
  explanation: text("explanation"), // AI-generated summary of why this is an opportunity
  
  // Data sources used
  dataSources: jsonb("data_sources").$type<{
    sourceId: number;
    sourceName: string;
    fetchedAt: string;
    dataType: string;
  }[]>(),
  
  // Enrichment data snapshot
  enrichmentData: jsonb("enrichment_data").$type<{
    parcelData?: any;
    marketData?: any;
    ownerData?: any;
    environmentalData?: any;
    lastEnriched?: string;
  }>(),
  
  // Action tracking
  status: text("status").notNull().default("new"), // new, reviewed, contacted, in_progress, acquired, passed, expired
  alertSent: boolean("alert_sent").default(false),
  alertSentAt: timestamp("alert_sent_at"),
  dueDiligenceTriggered: boolean("due_diligence_triggered").default(false),
  reviewedBy: text("reviewed_by"),
  reviewedAt: timestamp("reviewed_at"),
  reviewNotes: text("review_notes"),
  
  // Validity
  expiresAt: timestamp("expires_at"), // When this score should be recalculated
  isStale: boolean("is_stale").default(false),
  
  scoredAt: timestamp("scored_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertOpportunityScoreSchema = createInsertSchema(opportunityScores).omit({ 
  id: true, 
  createdAt: true,
  updatedAt: true,
  scoredAt: true,
});
export type InsertOpportunityScore = z.infer<typeof insertOpportunityScoreSchema>;
export type OpportunityScore = typeof opportunityScores.$inferSelect;

// ============================================
// MARKET INTELLIGENCE - METRICS & PREDICTIONS
// ============================================

// Market health status types
export const MARKET_STATUS = {
  heating: { name: "Heating", description: "Prices rising, high demand", color: "red" },
  stable: { name: "Stable", description: "Balanced market conditions", color: "green" },
  cooling: { name: "Cooling", description: "Prices declining, low demand", color: "blue" },
  volatile: { name: "Volatile", description: "Unpredictable market fluctuations", color: "orange" },
} as const;

export type MarketStatus = keyof typeof MARKET_STATUS;

// Historical market metrics - store market data points over time
export const marketMetrics = pgTable("market_metrics", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id),
  
  // Location
  county: text("county").notNull(),
  state: text("state").notNull(),
  
  // Time period
  metricDate: timestamp("metric_date").notNull(),
  periodType: text("period_type").notNull().default("monthly"), // daily, weekly, monthly, quarterly, yearly
  
  // Sales velocity metrics
  salesVolume: integer("sales_volume"), // Number of sales in period
  averageDaysOnMarket: numeric("average_days_on_market"),
  medianDaysOnMarket: numeric("median_days_on_market"),
  inventoryCount: integer("inventory_count"), // Active listings
  absorptionRate: numeric("absorption_rate"), // Months of inventory
  
  // Price metrics
  medianPricePerAcre: numeric("median_price_per_acre"),
  averagePricePerAcre: numeric("average_price_per_acre"),
  medianSalePrice: numeric("median_sale_price"),
  averageSalePrice: numeric("average_sale_price"),
  priceChangePercent: numeric("price_change_percent"), // Period over period
  yearOverYearChangePercent: numeric("year_over_year_change_percent"),
  
  // Listing metrics
  newListingsCount: integer("new_listings_count"),
  priceReductionsCount: integer("price_reductions_count"),
  withdrawnListingsCount: integer("withdrawn_listings_count"),
  expiredListingsCount: integer("expired_listings_count"),
  
  // Growth indicators
  permitData: jsonb("permit_data").$type<{
    residentialPermits?: number;
    commercialPermits?: number;
    totalPermitValue?: number;
    permitTrend?: "increasing" | "stable" | "decreasing";
  }>(),
  
  populationData: jsonb("population_data").$type<{
    currentPopulation?: number;
    populationChange?: number;
    populationChangePercent?: number;
    migrationRate?: number;
  }>(),
  
  infrastructureData: jsonb("infrastructure_data").$type<{
    newRoadsPlanned?: boolean;
    utilityExpansion?: boolean;
    publicTransitProjects?: boolean;
    majorDevelopments?: string[];
    infrastructureScore?: number;
  }>(),
  
  economicData: jsonb("economic_data").$type<{
    unemploymentRate?: number;
    medianHouseholdIncome?: number;
    jobGrowthRate?: number;
    majorEmployers?: string[];
  }>(),
  
  // Computed scores
  marketHealthScore: integer("market_health_score"), // 0-100
  growthPotentialScore: integer("growth_potential_score"), // 0-100
  investmentScore: integer("investment_score"), // 0-100
  marketStatus: text("market_status"), // heating, cooling, stable, volatile
  
  // Data sources used
  dataSources: jsonb("data_sources").$type<{
    sourceId: number;
    sourceName: string;
    fetchedAt: string;
  }[]>(),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertMarketMetricSchema = createInsertSchema(marketMetrics).omit({ 
  id: true, 
  createdAt: true,
  updatedAt: true,
});
export type InsertMarketMetric = z.infer<typeof insertMarketMetricSchema>;
export type MarketMetric = typeof marketMetrics.$inferSelect;

// Market predictions - store predictions with accuracy tracking
export const marketPredictions = pgTable("market_predictions", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id),
  
  // Location
  county: text("county").notNull(),
  state: text("state").notNull(),
  
  // Prediction details
  predictionType: text("prediction_type").notNull(), // price_direction, market_status, growth_potential
  predictionDate: timestamp("prediction_date").notNull().defaultNow(),
  targetDate: timestamp("target_date").notNull(), // When prediction is for
  horizonMonths: integer("horizon_months").notNull(), // 3, 6, 12 months
  
  // Predictions
  predictedValue: numeric("predicted_value"), // Numeric prediction (e.g., price per acre)
  predictedDirection: text("predicted_direction"), // up, down, stable
  predictedChangePercent: numeric("predicted_change_percent"),
  predictedMarketStatus: text("predicted_market_status"), // heating, cooling, stable
  confidenceScore: integer("confidence_score"), // 0-100
  
  // Prediction factors
  predictionFactors: jsonb("prediction_factors").$type<{
    historicalTrend?: {
      weight: number;
      value: number;
      direction: string;
    };
    salesVelocity?: {
      weight: number;
      value: number;
      trend: string;
    };
    inventoryLevels?: {
      weight: number;
      value: number;
      trend: string;
    };
    pricePerAcreTrend?: {
      weight: number;
      value: number;
      trend: string;
    };
    growthIndicators?: {
      weight: number;
      permitScore: number;
      populationScore: number;
      infrastructureScore: number;
    };
    economicFactors?: {
      weight: number;
      unemploymentTrend: string;
      incomeGrowth: number;
    };
    seasonalAdjustment?: {
      weight: number;
      factor: number;
    };
  }>(),
  
  // Model info
  modelVersion: text("model_version").default("v1"),
  algorithmUsed: text("algorithm_used"), // weighted_average, regression, ml_ensemble
  
  // Accuracy tracking (filled in when prediction period ends)
  actualValue: numeric("actual_value"),
  actualDirection: text("actual_direction"),
  actualChangePercent: numeric("actual_change_percent"),
  predictionError: numeric("prediction_error"), // Difference between predicted and actual
  accuracyScore: integer("accuracy_score"), // 0-100 accuracy rating
  
  // Status
  status: text("status").notNull().default("active"), // active, expired, verified
  verifiedAt: timestamp("verified_at"),
  
  // Alert tracking
  alertTriggered: boolean("alert_triggered").default(false),
  alertTriggeredAt: timestamp("alert_triggered_at"),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertMarketPredictionSchema = createInsertSchema(marketPredictions).omit({ 
  id: true, 
  createdAt: true,
  updatedAt: true,
  verifiedAt: true,
});
export type InsertMarketPrediction = z.infer<typeof insertMarketPredictionSchema>;
export type MarketPrediction = typeof marketPredictions.$inferSelect;

// ============================================
// TAX SALE RESEARCH
// ============================================

// Tax Sale Types
export const TAX_SALE_TYPES = {
  lien: { name: "Tax Lien", description: "Purchase of tax debt, property may be redeemed" },
  deed: { name: "Tax Deed", description: "Direct property ownership after foreclosure" },
  redeemable_deed: { name: "Redeemable Tax Deed", description: "Deed purchase with redemption period" },
  hybrid: { name: "Hybrid", description: "State with both lien and deed options" },
} as const;

export type TaxSaleType = keyof typeof TAX_SALE_TYPES;

// Redemption risk levels
export const REDEMPTION_RISK_LEVELS = {
  very_low: { name: "Very Low", description: "Owner unlikely to redeem", score: [0, 20] },
  low: { name: "Low", description: "Low chance of redemption", score: [21, 40] },
  moderate: { name: "Moderate", description: "Moderate redemption chance", score: [41, 60] },
  high: { name: "High", description: "High chance owner will redeem", score: [61, 80] },
  very_high: { name: "Very High", description: "Owner very likely to redeem", score: [81, 100] },
} as const;

export type RedemptionRiskLevel = keyof typeof REDEMPTION_RISK_LEVELS;

// Tax Sale Auctions - store auction calendar data
export const taxSaleAuctions = pgTable("tax_sale_auctions", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id),
  
  county: text("county").notNull(),
  state: text("state").notNull(),
  
  auctionType: text("auction_type").notNull(), // lien, deed, redeemable_deed
  auctionDate: timestamp("auction_date").notNull(),
  auctionEndDate: timestamp("auction_end_date"),
  registrationDeadline: timestamp("registration_deadline"),
  
  auctionFormat: text("auction_format").notNull().default("in_person"), // in_person, online, sealed_bid
  auctionUrl: text("auction_url"),
  venueAddress: text("venue_address"),
  venueName: text("venue_name"),
  
  minimumBid: numeric("minimum_bid"),
  depositRequired: numeric("deposit_required"),
  premiumRate: numeric("premium_rate"),
  interestRate: numeric("interest_rate"),
  redemptionPeriodMonths: integer("redemption_period_months"),
  
  parcelCount: integer("parcel_count"),
  totalTaxOwed: numeric("total_tax_owed"),

  // Capital the operator has allocated to THIS sale, integer cents. Powers the
  // live "remaining budget" figure on the day-of worksheet.
  //
  // Founder ruling #15 ("be the rail, not the provider"): this is a notebook
  // number, not a balance. Auction deposits and certificate purchases move
  // between the operator and the county on the operator's OWN rails; no
  // customer money transits AcreOS. Nothing writes to or reads from a
  // processor because of this column.
  sessionBudgetCents: bigint("session_budget_cents", { mode: "number" }),

  contactInfo: jsonb("contact_info").$type<{
    name?: string;
    phone?: string;
    email?: string;
    website?: string;
  }>(),
  
  requirements: jsonb("requirements").$type<{
    registrationRequired?: boolean;
    depositAmount?: number;
    acceptedPaymentMethods?: string[];
    residencyRequired?: boolean;
    disclaimers?: string[];
  }>(),
  
  sourceUrl: text("source_url"),
  lastScrapedAt: timestamp("last_scraped_at"),
  // 'manual_entry' for operator-created auctions — the only insert path that
  // exists. 'pending'/'success'/'failed'/'stale' are reserved for a county
  // ingest that is deliberately NOT built (founder-gated large bet), so a row
  // never implies a scrape that never happened.
  scrapeStatus: text("scrape_status").default("pending"),

  status: text("status").notNull().default("scheduled"), // scheduled, in_progress, completed, cancelled, postponed
  notes: text("notes"),

  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  // Org-LEADING composite indexes. Added 2026-07-30 with the table's first
  // real insert path: every query is "this org's auctions, by date" or
  // "this org's auctions in this county", and the table previously carried no
  // index at all (it was in the check-org-leading-index.mjs baseline).
  index("tax_sale_auctions_org_date_idx").on(table.organizationId, table.auctionDate),
  index("tax_sale_auctions_org_state_county_idx").on(
    table.organizationId,
    table.state,
    table.county,
  ),
]);

// Tax Sale Listings - store individual tax sale opportunities
// How the listing entered our pipeline. Marcus (Lens 17, 2026-05-27):
// "Auction is the obvious source, but my best ROI comes from OTC inventory
// — the certs that didn't sell at auction and the county is sitting on at
// the floor rate. And private off-market is rare but the highest margin
// (a county clerk friend mentions an estate sale). Pre-sale list is the
// 30-days-before-auction publication — useful to bidders but already
// crowded." OTC + private are higher-margin than auction. Filter and
// sort on this to surface the high-margin acquisition paths first.
export const TAX_LISTING_ACQUISITION_SOURCES = [
  "auction",       // standard county auction (the bulk of inventory)
  "otc",           // over-the-counter; struck-off / county-held inventory
  "pre_sale_list", // 30-day published delinquent list pre-auction
  "private",       // off-market / private sale / direct-from-owner
] as const;
export type TaxListingAcquisitionSource = typeof TAX_LISTING_ACQUISITION_SOURCES[number];

export const taxSaleListings = pgTable("tax_sale_listings", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id),
  auctionId: integer("auction_id").references(() => taxSaleAuctions.id),
  propertyId: integer("property_id").references(() => properties.id),

  // Marcus / Lens 17 — first-class acquisition-source tagging.
  acquisitionSource: text("acquisition_source").$type<TaxListingAcquisitionSource>().default("auction"),

  apn: text("apn").notNull(),
  county: text("county").notNull(),
  state: text("state").notNull(),
  
  address: text("address"),
  city: text("city"),
  zip: text("zip"),
  legalDescription: text("legal_description"),
  
  saleType: text("sale_type").notNull(), // lien, deed, redeemable_deed
  
  taxYearsDelinquent: text("tax_years_delinquent").array(),
  totalTaxOwed: numeric("total_tax_owed").notNull(),
  penalties: numeric("penalties"),
  interest: numeric("interest"),
  fees: numeric("fees"),
  totalAmountDue: numeric("total_amount_due"),
  
  minimumBid: numeric("minimum_bid"),
  openingBid: numeric("opening_bid"),
  winningBid: numeric("winning_bid"),
  
  assessedValue: numeric("assessed_value"),
  marketValue: numeric("market_value"),
  acreage: numeric("acreage"),
  propertyType: text("property_type"), // vacant_land, residential, commercial, agricultural
  zoning: text("zoning"),
  
  ownerName: text("owner_name"),
  ownerAddress: text("owner_address"),
  ownerIsOutOfState: boolean("owner_is_out_of_state"),
  ownerIsCorporate: boolean("owner_is_corporate"),
  
  redemptionPeriodMonths: integer("redemption_period_months"),
  redemptionDeadline: timestamp("redemption_deadline"),
  interestRate: numeric("interest_rate"),
  
  redemptionRiskScore: integer("redemption_risk_score"), // 0-100
  redemptionRiskLevel: text("redemption_risk_level"), // very_low, low, moderate, high, very_high
  redemptionFactors: jsonb("redemption_factors").$type<{
    propertyValueVsTax?: { score: number; ratio: number; explanation: string };
    ownerIndicators?: { score: number; signals: string[]; explanation: string };
    propertyType?: { score: number; type: string; explanation: string };
    countyRedemptionRate?: { score: number; rate: number; explanation: string };
    timeRemaining?: { score: number; months: number; explanation: string };
    overallExplanation: string;
  }>(),
  
  estimatedRoi: numeric("estimated_roi"),
  roiCalculation: jsonb("roi_calculation").$type<{
    investmentAmount: number;
    interestIfRedeemed: number;
    propertyValueIfNotRedeemed: number;
    estimatedHoldingCosts: number;
    bestCaseRoi: number;
    worstCaseRoi: number;
    expectedRoi: number;
    assumptions: string[];
  }>(),
  
  opportunityScore: integer("opportunity_score"), // 0-100 overall score
  opportunityFactors: jsonb("opportunity_factors").$type<{
    roiPotential?: { score: number; explanation: string };
    riskLevel?: { score: number; explanation: string };
    propertyQuality?: { score: number; explanation: string };
    marketConditions?: { score: number; explanation: string };
  }>(),
  
  status: text("status").notNull().default("available"), // available, watching, bid_placed, won, lost, redeemed, acquired
  watchlistAddedAt: timestamp("watchlist_added_at"),
  bidAmount: numeric("bid_amount"),
  bidDate: timestamp("bid_date"),

  // ── TD-4 pre-auction worksheet fields ───────────────────────────────────
  // SCHEMA-DRIFT FIX (2026-07-30): these four columns have existed in the
  // DATABASE since TD-4 (scripts/migrate.mjs ALTERs "max_bid_cents",
  // "walk_away_above_cents", "walk_away_condition", "partner_split") but were
  // never mirrored here. The worksheet route wrote them through
  // `.set(update as any)`, and the cast was the only thing stopping the type
  // checker from pointing out that Drizzle had no idea these columns existed.
  // Integer cents, per the money rule.
  maxBidCents: bigint("max_bid_cents", { mode: "number" }),
  walkAwayAboveCents: bigint("walk_away_above_cents", { mode: "number" }),
  walkAwayCondition: text("walk_away_condition"),
  partnerSplit: jsonb("partner_split").$type<Array<{ investorName: string; splitBps: number }>>(),

  sourceUrl: text("source_url"),
  certificateNumber: text("certificate_number"),

  latitude: numeric("latitude"),
  longitude: numeric("longitude"),

  notes: text("notes"),

  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  // Org-LEADING composite indexes. Added 2026-07-30 with the table's first
  // real insert path. `tax_sale_listings_org_source_idx` already existed in
  // migrate.mjs but was never declared here; these three are the query
  // patterns the worksheet, the import de-dupe check and the county summary
  // actually run.
  index("tax_sale_listings_org_auction_idx").on(table.organizationId, table.auctionId),
  index("tax_sale_listings_org_state_county_apn_idx").on(
    table.organizationId,
    table.state,
    table.county,
    table.apn,
  ),
  index("tax_sale_listings_org_status_idx").on(table.organizationId, table.status),
]);

// Tax Sale Alerts - subscription to tax sale opportunities
export const taxSaleAlerts = pgTable("tax_sale_alerts", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  
  name: text("name").notNull(),
  isActive: boolean("is_active").default(true),
  
  criteria: jsonb("criteria").$type<{
    states?: string[];
    counties?: string[];
    saleTypes?: TaxSaleType[];
    minAssessedValue?: number;
    maxAssessedValue?: number;
    maxTaxOwed?: number;
    minAcreage?: number;
    maxAcreage?: number;
    propertyTypes?: string[];
    maxRedemptionRisk?: RedemptionRiskLevel;
    minEstimatedRoi?: number;
    auctionDateRange?: { start: string; end: string };
  }>(),
  
  notificationPreferences: jsonb("notification_preferences").$type<{
    email?: boolean;
    sms?: boolean;
    inApp?: boolean;
    frequency?: "immediate" | "daily" | "weekly";
  }>(),
  
  lastTriggeredAt: timestamp("last_triggered_at"),
  triggerCount: integer("trigger_count").default(0),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Historical redemption rates by county - for prediction
export const countyRedemptionRates = pgTable("county_redemption_rates", {
  id: serial("id").primaryKey(),
  
  county: text("county").notNull(),
  state: text("state").notNull(),
  year: integer("year").notNull(),
  
  saleType: text("sale_type").notNull(), // lien, deed
  
  totalSales: integer("total_sales"),
  totalRedemptions: integer("total_redemptions"),
  redemptionRate: numeric("redemption_rate"),
  
  averageRedemptionMonths: numeric("average_redemption_months"),
  averageTaxAmount: numeric("average_tax_amount"),
  averagePropertyValue: numeric("average_property_value"),
  
  dataSource: text("data_source"),
  
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertTaxSaleAuctionSchema = createInsertSchema(taxSaleAuctions).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertTaxSaleAuction = z.infer<typeof insertTaxSaleAuctionSchema>;
export type TaxSaleAuction = typeof taxSaleAuctions.$inferSelect;

export const insertTaxSaleListingSchema = createInsertSchema(taxSaleListings).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertTaxSaleListing = z.infer<typeof insertTaxSaleListingSchema>;
export type TaxSaleListing = typeof taxSaleListings.$inferSelect;

export const insertTaxSaleAlertSchema = createInsertSchema(taxSaleAlerts).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertTaxSaleAlert = z.infer<typeof insertTaxSaleAlertSchema>;
export type TaxSaleAlert = typeof taxSaleAlerts.$inferSelect;

export const insertCountyRedemptionRateSchema = createInsertSchema(countyRedemptionRates).omit({
  id: true,
  createdAt: true,
});
export type InsertCountyRedemptionRate = z.infer<typeof insertCountyRedemptionRateSchema>;
export type CountyRedemptionRate = typeof countyRedemptionRates.$inferSelect;

// ============================================
// PHASE 3: DUE DILIGENCE, INTENT, PRICING, PATTERNS
// ============================================

// Due Diligence Dossiers - investor-ready property reports
export const dueDiligenceDossiers = pgTable("due_diligence_dossiers", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  propertyId: integer("property_id").references(() => properties.id).notNull(),
  
  // Request details
  requestedBy: integer("requested_by"), // team member who requested
  priority: text("priority").notNull().default("normal"), // urgent, high, normal, low
  
  // Pod execution tracking
  status: text("status").notNull().default("queued"), // queued, running, completed, failed
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  
  // Multi-agent pod assignment
  agentsAssigned: jsonb("agents_assigned").$type<{
    titleSearch?: { agentId: string; status: string; startedAt?: string; completedAt?: string };
    taxAnalysis?: { agentId: string; status: string; startedAt?: string; completedAt?: string };
    environmentalCheck?: { agentId: string; status: string; startedAt?: string; completedAt?: string };
    zoningReview?: { agentId: string; status: string; startedAt?: string; completedAt?: string };
    accessAnalysis?: { agentId: string; status: string; startedAt?: string; completedAt?: string };
    marketComps?: { agentId: string; status: string; startedAt?: string; completedAt?: string };
    ownerResearch?: { agentId: string; status: string; startedAt?: string; completedAt?: string };
  }>(),
  
  // Aggregated findings
  findings: jsonb("findings").$type<{
    titleStatus?: { clear: boolean; issues?: string[]; liens?: string[]; encumbrances?: string[] };
    taxStatus?: { current: boolean; amountDue?: number; yearsDelinquent?: number; specialAssessments?: string[] };
    environmental?: { clean: boolean; concerns?: string[]; wetlands?: boolean; floodZone?: string };
    zoning?: { current: string; allowedUses?: string[]; restrictions?: string[]; overlays?: string[] };
    access?: { type: string; legal: boolean; easements?: string[]; roadMaintenance?: string };
    comps?: { medianPrice?: number; pricePerAcre?: number; salesCount?: number; trend?: string };
    owner?: { name: string; type: string; contactInfo?: string; motivationSignals?: string[] };
  }>(),
  
  // Scores and recommendations
  investabilityScore: integer("investability_score"), // 0-100 overall score
  riskScore: integer("risk_score"), // 0-100 (higher = more risky)
  
  scoreBreakdown: jsonb("score_breakdown").$type<{
    titleScore: number;
    taxScore: number;
    environmentalScore: number;
    zoningScore: number;
    accessScore: number;
    marketScore: number;
    ownerScore: number;
  }>(),
  
  recommendation: text("recommendation"), // strong_buy, buy, hold, pass, avoid
  recommendationReasoning: text("recommendation_reasoning"),
  
  // Red flags and highlights
  redFlags: jsonb("red_flags").$type<string[]>(),
  greenFlags: jsonb("green_flags").$type<string[]>(),
  
  // AI-generated summary
  executiveSummary: text("executive_summary"),
  detailedReport: text("detailed_report"),
  
  // Cost tracking
  apiCostsIncurred: numeric("api_costs_incurred"),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Seller Intent Predictions - score likelihood of accepting offers
export const sellerIntentPredictions = pgTable("seller_intent_predictions", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  leadId: integer("lead_id").references(() => leads.id).notNull(),
  propertyId: integer("property_id").references(() => properties.id),
  
  // Overall intent score
  intentScore: integer("intent_score").notNull(), // 0-100
  intentLevel: text("intent_level").notNull(), // very_high, high, moderate, low, very_low
  
  // Prediction confidence
  confidence: numeric("confidence").notNull(), // 0-1
  
  // Signal breakdown
  signals: jsonb("signals").$type<{
    // Urgency signals
    urgency?: {
      score: number;
      indicators: string[];
      mentions?: string[]; // "need to sell fast", "relocating", etc.
    };
    // Financial motivation
    financial?: {
      score: number;
      indicators: string[];
      taxDelinquent?: boolean;
      estimatedEquity?: number;
    };
    // Emotional/personal signals
    emotional?: {
      score: number;
      indicators: string[];
      lifeEvent?: string; // divorce, inheritance, retirement
    };
    // Engagement signals
    engagement?: {
      score: number;
      responseRate?: number;
      responseSpeed?: number; // avg hours to respond
      questionTypes?: string[];
    };
    // Price flexibility signals
    priceFlexibility?: {
      score: number;
      hasCountered?: boolean;
      counterPattern?: string;
      anchorAcceptance?: number;
    };
    // Competitive signals
    competition?: {
      score: number;
      otherOffersmentioned?: boolean;
      marketingProperty?: boolean;
    };
  }>(),
  
  // Historical accuracy (for learning)
  actualOutcome: text("actual_outcome"), // accepted, rejected, countered, no_response, withdrew
  outcomeRecordedAt: timestamp("outcome_recorded_at"),
  predictionAccurate: boolean("prediction_accurate"),
  
  // Recommended approach
  recommendedApproach: text("recommended_approach"), // aggressive, standard, patient, walk_away
  approachReasoning: text("approach_reasoning"),
  suggestedOfferRange: jsonb("suggested_offer_range").$type<{
    min: number;
    optimal: number;
    max: number;
  }>(),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Price Recommendations - optimal offer/list price suggestions
export const priceRecommendations = pgTable("price_recommendations", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  propertyId: integer("property_id").references(() => properties.id).notNull(),
  
  // Type of recommendation
  recommendationType: text("recommendation_type").notNull(), // acquisition_offer, disposition_list, counter_offer
  
  // Price recommendations
  recommendedPrice: numeric("recommended_price").notNull(),
  priceRangeMin: numeric("price_range_min").notNull(),
  priceRangeMax: numeric("price_range_max").notNull(),
  
  // Confidence
  confidence: numeric("confidence").notNull(), // 0-1
  
  // Analysis inputs
  comparablesSummary: jsonb("comparables_summary").$type<{
    count: number;
    medianPricePerAcre: number;
    avgDaysOnMarket?: number;
    recentTrend?: string;
    comps?: Array<{
      apn: string;
      salePrice: number;
      acres: number;
      pricePerAcre: number;
      saleDate: string;
      distance?: number;
      similarityScore?: number;
    }>;
  }>(),
  
  // Adjustment factors
  adjustments: jsonb("adjustments").$type<{
    sizeAdjustment?: { factor: number; reason: string };
    accessAdjustment?: { factor: number; reason: string };
    zoningAdjustment?: { factor: number; reason: string };
    utilitiesAdjustment?: { factor: number; reason: string };
    terrainAdjustment?: { factor: number; reason: string };
    marketTrendAdjustment?: { factor: number; reason: string };
    sellerMotivationAdjustment?: { factor: number; reason: string };
    holdingCostAdjustment?: { factor: number; reason: string };
  }>(),
  
  // Strategic factors
  strategy: jsonb("strategy").$type<{
    targetMargin?: number; // desired profit margin
    competitionLevel?: string;
    marketTiming?: string;
    negotiationRoom?: number; // % buffer for negotiation
    quickSaleDiscount?: number; // discount for faster sale
  }>(),
  
  // AI reasoning
  reasoning: text("reasoning"),
  
  // Outcome tracking
  actualPrice: numeric("actual_price"),
  priceAccepted: boolean("price_accepted"),
  outcomeRecordedAt: timestamp("outcome_recorded_at"),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Deal Patterns - historical patterns for similarity matching
export const dealPatterns = pgTable("deal_patterns", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  dealId: integer("deal_id").references(() => deals.id).notNull(),
  
  // Pattern fingerprint for similarity matching
  fingerprint: jsonb("fingerprint").$type<{
    // Property characteristics
    property: {
      acreage: number;
      county: string;
      state: string;
      zoning?: string;
      terrain?: string;
      roadAccess?: string;
      utilities?: string[];
    };
    // Deal metrics
    deal: {
      type: string; // acquisition/disposition
      offerToAskRatio?: number;
      daysToClose?: number;
      negotiationRounds?: number;
      finalMargin?: number;
    };
    // Seller characteristics
    seller?: {
      type?: string; // individual, corporate, estate
      motivation?: string[];
      responsePattern?: string;
    };
    // Market context
    market?: {
      pricePerAcre: number;
      marketTrend?: string;
      competitionLevel?: string;
    };
  }>(),
  
  // Outcome
  outcome: text("outcome").notNull(), // success, partial_success, failure
  profitAmount: numeric("profit_amount"),
  roiPercent: numeric("roi_percent"),
  daysToComplete: integer("days_to_complete"),
  
  // Lessons learned
  successFactors: jsonb("success_factors").$type<string[]>(),
  challengesFaced: jsonb("challenges_faced").$type<string[]>(),
  lessonsLearned: jsonb("lessons_learned").$type<string[]>(),
  
  // Pattern usage tracking
  timesMatched: integer("times_matched").default(0),
  matchSuccessRate: numeric("match_success_rate"),
  
  // Embedding for similarity search — pgvector(1536) for OpenAI
  // `text-embedding-3-small`. See migration 0052 + the vectorColumn
  // custom type at the top of this file.
  embeddingVector: vectorColumn("embedding_vector", { dimensions: 1536 }),

  // Tracks when the embedding was last (re-)generated so the rolling
  // 7-day refresh job can sweep stale rows. See server/jobs/embeddingRefresh.ts.
  embeddingRefreshedAt: timestamp("embedding_refreshed_at"),

  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  // Tahoe L3 shard-readiness composite — every tenant-bound pattern
  // lookup probes this index first. Pairs with the org-scoped HNSW
  // candidate set in server/services/dealPatterns/*.
  index("deal_patterns_org_outcome_created_idx").on(
    table.organizationId,
    table.outcome,
    table.createdAt,
  ),
  index("deal_patterns_org_deal_idx").on(table.organizationId, table.dealId),
]);

// Deal Pattern Matches - when we find similar deals
export const dealPatternMatches = pgTable("deal_pattern_matches", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  
  // Current property/deal being analyzed
  targetPropertyId: integer("target_property_id").references(() => properties.id),
  targetDealId: integer("target_deal_id").references(() => deals.id),
  
  // Matched historical pattern
  patternId: integer("pattern_id").references(() => dealPatterns.id).notNull(),
  
  // Similarity metrics
  similarityScore: numeric("similarity_score").notNull(), // 0-1
  matchedDimensions: jsonb("matched_dimensions").$type<{
    propertyMatch: number;
    dealMatch: number;
    sellerMatch: number;
    marketMatch: number;
  }>(),
  
  // Insights derived
  insights: jsonb("insights").$type<{
    recommendedOffer?: number;
    expectedNegotiationRounds?: number;
    estimatedDaysToClose?: number;
    suggestedApproach?: string;
    watchOutFor?: string[];
    leveragePoints?: string[];
  }>(),
  
  // Outcome tracking
  insightsApplied: boolean("insights_applied").default(false),
  actualOutcome: text("actual_outcome"),
  insightHelpful: boolean("insight_helpful"),

  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  // Tahoe L3 shard-readiness composite — match lookups for a tenant
  // newest-first land on this index.
  index("deal_pattern_matches_org_created_idx").on(
    table.organizationId,
    table.createdAt,
  ),
  index("deal_pattern_matches_org_pattern_idx").on(
    table.organizationId,
    table.patternId,
  ),
]);

export const insertDueDiligenceDossierSchema = createInsertSchema(dueDiligenceDossiers).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertDueDiligenceDossier = z.infer<typeof insertDueDiligenceDossierSchema>;
export type DueDiligenceDossier = typeof dueDiligenceDossiers.$inferSelect;

export const insertSellerIntentPredictionSchema = createInsertSchema(sellerIntentPredictions).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertSellerIntentPrediction = z.infer<typeof insertSellerIntentPredictionSchema>;
export type SellerIntentPrediction = typeof sellerIntentPredictions.$inferSelect;

export const insertPriceRecommendationSchema = createInsertSchema(priceRecommendations).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertPriceRecommendation = z.infer<typeof insertPriceRecommendationSchema>;
export type PriceRecommendation = typeof priceRecommendations.$inferSelect;

export const insertDealPatternSchema = createInsertSchema(dealPatterns).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertDealPattern = z.infer<typeof insertDealPatternSchema>;
export type DealPattern = typeof dealPatterns.$inferSelect;

export const insertDealPatternMatchSchema = createInsertSchema(dealPatternMatches).omit({
  id: true,
  createdAt: true,
});
export type InsertDealPatternMatch = z.infer<typeof insertDealPatternMatchSchema>;
export type DealPatternMatch = typeof dealPatternMatches.$inferSelect;

// ============================================
// PHASE 4: NEGOTIATION, SEQUENCES, VOICE/CALL AI
// ============================================

// Negotiation Sessions - AI-assisted negotiation tracking
export const negotiationSessions = pgTable("negotiation_sessions", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  dealId: integer("deal_id").references(() => deals.id).notNull(),
  leadId: integer("lead_id").references(() => leads.id).notNull(),
  
  status: text("status").notNull().default("active"), // active, paused, won, lost, stalled
  
  // Current negotiation state
  currentOfferAmount: numeric("current_offer_amount"),
  sellerAskAmount: numeric("seller_ask_amount"),
  lastCounterAmount: numeric("last_counter_amount"),
  negotiationRound: integer("negotiation_round").default(1),
  
  // Objection handling
  objections: jsonb("objections").$type<Array<{
    id: string;
    text: string;
    category: string; // price, timing, trust, emotional, competitive
    detectedAt: string;
    responseUsed?: string;
    resolved: boolean;
    effectiveness?: number;
  }>>(),
  
  // AI-generated responses
  suggestedResponses: jsonb("suggested_responses").$type<Array<{
    id: string;
    text: string;
    strategy: string; // empathy, logic, urgency, anchor, silence
    confidence: number;
    generatedAt: string;
    used: boolean;
    outcome?: string;
  }>>(),
  
  // Counter-offer history
  counterOfferHistory: jsonb("counter_offer_history").$type<Array<{
    round: number;
    ourOffer: number;
    theirCounter?: number;
    timestamp: string;
    notes?: string;
  }>>(),
  
  // Sentiment tracking
  sentimentHistory: jsonb("sentiment_history").$type<Array<{
    timestamp: string;
    score: number; // -1 to 1
    indicators: string[];
  }>>(),
  
  // Outcome tracking
  outcome: text("outcome"), // accepted, rejected, walked_away, ghosted
  finalAmount: numeric("final_amount"),
  profitMargin: numeric("profit_margin"),
  lessonsLearned: text("lessons_learned"),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Message Sequence Performance - which messages work best
export const sequencePerformance = pgTable("sequence_performance", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  
  // Sequence identification
  sequenceId: integer("sequence_id"), // links to marketingSequences if applicable
  sequenceName: text("sequence_name").notNull(),
  channel: text("channel").notNull(), // email, sms, mail
  
  // Message details
  messagePosition: integer("message_position").notNull(), // 1st, 2nd, 3rd etc.
  templateContent: text("template_content"),
  subjectLine: text("subject_line"),
  
  // Performance metrics
  totalSent: integer("total_sent").default(0),
  delivered: integer("delivered").default(0),
  opened: integer("opened").default(0),
  clicked: integer("clicked").default(0),
  replied: integer("replied").default(0),
  converted: integer("converted").default(0),
  unsubscribed: integer("unsubscribed").default(0),
  bounced: integer("bounced").default(0),
  
  // Calculated rates
  openRate: numeric("open_rate"),
  clickRate: numeric("click_rate"),
  replyRate: numeric("reply_rate"),
  conversionRate: numeric("conversion_rate"),
  
  // A/B testing
  variant: text("variant"), // A, B, control
  isWinner: boolean("is_winner"),
  
  // AI optimization suggestions
  optimizationSuggestions: jsonb("optimization_suggestions").$type<{
    subjectLineSuggestions?: string[];
    timingSuggestions?: string[];
    contentSuggestions?: string[];
    segmentSuggestions?: string[];
    confidence?: number;
    lastOptimizedAt?: string;
  }>(),
  
  // Best performing segments
  bestPerformingSegments: jsonb("best_performing_segments").$type<Array<{
    segment: string;
    replyRate: number;
    sampleSize: number;
  }>>(),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Call Transcripts - voice/call AI integration
export const callTranscripts = pgTable("call_transcripts", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  leadId: integer("lead_id").references(() => leads.id).notNull(),
  dealId: integer("deal_id").references(() => deals.id),
  
  // Call metadata
  callId: text("call_id"), // external call system ID
  direction: text("direction").notNull(), // inbound, outbound
  callType: text("call_type").notNull(), // initial_contact, follow_up, negotiation, closing
  callerPhone: text("caller_phone"),
  duration: integer("duration"), // seconds
  callStartedAt: timestamp("call_started_at"),
  callEndedAt: timestamp("call_ended_at"),
  
  // Transcription
  transcriptRaw: text("transcript_raw"),
  transcriptFormatted: jsonb("transcript_formatted").$type<Array<{
    speaker: string;
    text: string;
    startTime: number;
    endTime: number;
    confidence?: number;
  }>>(),
  transcriptionProvider: text("transcription_provider"), // whisper, assembly, deepgram
  transcriptionConfidence: numeric("transcription_confidence"),
  
  // AI Analysis
  summary: text("summary"),
  sentiment: text("sentiment"), // positive, negative, neutral, mixed
  sentimentScore: numeric("sentiment_score"), // -1 to 1
  
  // Action items extracted
  actionItems: jsonb("action_items").$type<Array<{
    id: string;
    description: string;
    assignedTo?: string;
    dueDate?: string;
    priority: string;
    completed: boolean;
    completedAt?: string;
    createdFromCall: boolean;
  }>>(),
  
  // Key information extracted
  extractedData: jsonb("extracted_data").$type<{
    pricesMentioned?: number[];
    datesMentioned?: string[];
    namesMentioned?: string[];
    objectionsRaised?: string[];
    commitmentsMade?: string[];
    questionsAsked?: string[];
    nextSteps?: string[];
  }>(),
  
  // Coaching insights
  coachingInsights: jsonb("coaching_insights").$type<{
    talkToListenRatio?: number;
    questionCount?: number;
    objectionHandlingScore?: number;
    rapportScore?: number;
    closingEffectiveness?: number;
    improvementAreas?: string[];
    strengths?: string[];
  }>(),
  
  // CRM updates made
  crmUpdatesApplied: jsonb("crm_updates_applied").$type<Array<{
    field: string;
    oldValue: string;
    newValue: string;
    appliedAt: string;
    automated: boolean;
  }>>(),
  
  // Audio storage
  audioUrl: text("audio_url"),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertNegotiationSessionSchema = createInsertSchema(negotiationSessions).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertNegotiationSession = z.infer<typeof insertNegotiationSessionSchema>;
export type NegotiationSession = typeof negotiationSessions.$inferSelect;

export const insertSequencePerformanceSchema = createInsertSchema(sequencePerformance).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertSequencePerformance = z.infer<typeof insertSequencePerformanceSchema>;
export type SequencePerformance = typeof sequencePerformance.$inferSelect;

export const insertCallTranscriptSchema = createInsertSchema(callTranscripts).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertCallTranscript = z.infer<typeof insertCallTranscriptSchema>;
export type CallTranscript = typeof callTranscripts.$inferSelect;

// ============================================
// PHASE 5: PORTFOLIO, DOCUMENTS, CASH FLOW, COMPLIANCE
// ============================================

// Portfolio Monitoring Alerts - proactive alerts for owned properties
export const portfolioAlerts = pgTable("portfolio_alerts", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  propertyId: integer("property_id").references(() => properties.id).notNull(),
  
  alertType: text("alert_type").notNull(), // tax_due, market_change, competitor_activity, maintenance, document_expiring, compliance
  severity: text("severity").notNull().default("medium"), // low, medium, high, critical
  
  title: text("title").notNull(),
  description: text("description"),
  
  // Alert details
  triggeredBy: text("triggered_by"), // system, scheduled, market_event
  triggerData: jsonb("trigger_data").$type<{
    previousValue?: any;
    currentValue?: any;
    threshold?: any;
    changePercent?: number;
    source?: string;
  }>(),
  
  // Status
  status: text("status").notNull().default("active"), // active, acknowledged, resolved, dismissed
  acknowledgedAt: timestamp("acknowledged_at"),
  acknowledgedBy: integer("acknowledged_by"),
  resolvedAt: timestamp("resolved_at"),
  resolution: text("resolution"),
  
  // Suggested actions
  suggestedActions: jsonb("suggested_actions").$type<Array<{
    action: string;
    priority: string;
    estimatedImpact?: string;
  }>>(),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Document Intelligence - parsed documents
export const documentAnalysis = pgTable("document_analysis", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  propertyId: integer("property_id").references(() => properties.id),
  dealId: integer("deal_id").references(() => deals.id),
  
  // Document info
  documentType: text("document_type").notNull(), // deed, contract, title_report, survey, note, mortgage, tax_bill, closing_statement
  documentName: text("document_name").notNull(),
  fileUrl: text("file_url"),
  fileHash: text("file_hash"), // for deduplication
  
  // Extraction status
  status: text("status").notNull().default("pending"), // pending, processing, completed, failed
  processedAt: timestamp("processed_at"),
  
  // Raw content
  rawText: text("raw_text"),
  ocrConfidence: numeric("ocr_confidence"),
  
  // Extracted data (varies by document type)
  extractedData: jsonb("extracted_data").$type<{
    // For deeds
    grantorName?: string;
    granteeName?: string;
    legalDescription?: string;
    recordingInfo?: { book?: string; page?: string; date?: string };
    considerationAmount?: number;
    
    // For contracts
    buyerName?: string;
    sellerName?: string;
    purchasePrice?: number;
    closingDate?: string;
    contingencies?: string[];
    deadlines?: Array<{ name: string; date: string }>;
    
    // For notes/mortgages
    principalAmount?: number;
    interestRate?: number;
    term?: number;
    paymentAmount?: number;
    maturityDate?: string;
    collateralDescription?: string;
    
    // For tax bills
    taxYear?: number;
    assessedValue?: number;
    taxAmount?: number;
    dueDate?: string;
    exemptions?: string[];
    
    // Common
    parties?: Array<{ name: string; role: string }>;
    dates?: Array<{ label: string; date: string }>;
    amounts?: Array<{ label: string; amount: number }>;
    signatures?: string[];
  }>(),
  
  // Key terms/clauses extracted
  keyTerms: jsonb("key_terms").$type<Array<{
    term: string;
    value: string;
    importance: string;
    pageNumber?: number;
  }>>(),
  
  // Risk analysis
  riskFlags: jsonb("risk_flags").$type<Array<{
    issue: string;
    severity: string;
    recommendation: string;
  }>>(),
  
  // Version tracking
  version: integer("version").default(1),
  previousVersionId: integer("previous_version_id"),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Cash Flow Forecasts - projected income/expenses
export const cashFlowForecasts = pgTable("cash_flow_forecasts", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  noteId: integer("note_id").references(() => notes.id),
  propertyId: integer("property_id").references(() => properties.id),
  
  // Forecast period
  forecastDate: timestamp("forecast_date").notNull(),
  forecastPeriodMonths: integer("forecast_period_months").notNull().default(12),
  
  // Income projections
  projectedIncome: jsonb("projected_income").$type<Array<{
    month: string;
    expectedAmount: number;
    probability: number;
    source: string; // note_payment, interest, sale_proceeds
    notes?: string;
  }>>(),
  
  // Expense projections
  projectedExpenses: jsonb("projected_expenses").$type<Array<{
    month: string;
    amount: number;
    category: string; // taxes, insurance, maintenance, legal, marketing
    notes?: string;
  }>>(),
  
  // Summary metrics
  totalProjectedIncome: numeric("total_projected_income"),
  totalProjectedExpenses: numeric("total_projected_expenses"),
  netCashFlow: numeric("net_cash_flow"),
  
  // Risk analysis
  paymentRiskScore: integer("payment_risk_score"), // 0-100 (higher = more risky)
  riskFactors: jsonb("risk_factors").$type<Array<{
    factor: string;
    impact: string;
    mitigation?: string;
  }>>(),
  
  // Payment health for notes
  paymentHealth: jsonb("payment_health").$type<{
    onTimePayments: number;
    latePayments: number;
    missedPayments: number;
    averageDaysLate?: number;
    paymentPattern?: string; // consistent, declining, improving, erratic
    defaultProbability?: number;
  }>(),
  
  // AI insights
  insights: jsonb("insights").$type<Array<{
    type: string;
    message: string;
    urgency: string;
  }>>(),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Compliance Rules - county-specific regulations
export const complianceRules = pgTable("compliance_rules", {
  id: serial("id").primaryKey(),
  
  // Jurisdiction
  state: text("state").notNull(),
  county: text("county"),
  municipality: text("municipality"),
  
  // Rule details
  ruleType: text("rule_type").notNull(), // subdivision, building, zoning, environmental, disclosure, recording, tax
  ruleName: text("rule_name").notNull(),
  ruleDescription: text("rule_description"),
  
  // Requirements
  requirements: jsonb("requirements").$type<Array<{
    requirement: string;
    mandatory: boolean;
    deadline?: string;
    fee?: number;
    authority?: string;
  }>>(),
  
  // Thresholds and triggers
  triggers: jsonb("triggers").$type<{
    acreageMin?: number;
    acreageMax?: number;
    transactionType?: string[];
    propertyType?: string[];
    useType?: string[];
    priceThreshold?: number;
  }>(),
  
  // Penalties
  penalties: jsonb("penalties").$type<{
    description: string;
    fineRange?: { min: number; max: number };
    otherConsequences?: string[];
  }>(),
  
  // References
  sourceUrl: text("source_url"),
  lastVerified: timestamp("last_verified"),
  effectiveDate: timestamp("effective_date"),
  expirationDate: timestamp("expiration_date"),
  
  isActive: boolean("is_active").default(true),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Compliance Checks - property-specific compliance status
export const complianceChecks = pgTable("compliance_checks", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  propertyId: integer("property_id").references(() => properties.id).notNull(),
  ruleId: integer("rule_id").references(() => complianceRules.id),
  
  // Check details
  checkType: text("check_type").notNull(),
  checkDescription: text("check_description"),
  
  // Status
  status: text("status").notNull().default("pending"), // pending, compliant, non_compliant, not_applicable, needs_review
  
  // Findings
  findings: jsonb("findings").$type<{
    isCompliant: boolean;
    issues?: string[];
    requiredActions?: string[];
    estimatedCost?: number;
    deadline?: string;
  }>(),
  
  // Resolution
  resolvedAt: timestamp("resolved_at"),
  resolutionNotes: text("resolution_notes"),
  
  // Review info
  lastCheckedAt: timestamp("last_checked_at"),
  nextCheckDue: timestamp("next_check_due"),
  checkedBy: text("checked_by"), // system or user id
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertPortfolioAlertSchema = createInsertSchema(portfolioAlerts).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertPortfolioAlert = z.infer<typeof insertPortfolioAlertSchema>;
export type PortfolioAlert = typeof portfolioAlerts.$inferSelect;

export const insertDocumentAnalysisSchema = createInsertSchema(documentAnalysis).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertDocumentAnalysis = z.infer<typeof insertDocumentAnalysisSchema>;
export type DocumentAnalysis = typeof documentAnalysis.$inferSelect;

export const insertCashFlowForecastSchema = createInsertSchema(cashFlowForecasts).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertCashFlowForecast = z.infer<typeof insertCashFlowForecastSchema>;
export type CashFlowForecast = typeof cashFlowForecasts.$inferSelect;

export const insertComplianceRuleSchema = createInsertSchema(complianceRules).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertComplianceRule = z.infer<typeof insertComplianceRuleSchema>;
export type ComplianceRule = typeof complianceRules.$inferSelect;

export const insertComplianceCheckSchema = createInsertSchema(complianceChecks).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertComplianceCheck = z.infer<typeof insertComplianceCheckSchema>;
export type ComplianceCheck = typeof complianceChecks.$inferSelect;

// ============================================
// PHASE 6: BUYER MATCHING, QUALIFICATION, DISPOSITION
// ============================================

// Buyer Profiles - ideal buyer characteristics for matching
export const buyerProfiles = pgTable("buyer_profiles", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  leadId: integer("lead_id").references(() => leads.id),
  
  // Profile type
  profileType: text("profile_type").notNull().default("individual"), // individual, investor, developer, builder
  
  // Property preferences
  preferences: jsonb("preferences").$type<{
    minAcreage?: number;
    maxAcreage?: number;
    minPrice?: number;
    maxPrice?: number;
    states?: string[];
    counties?: string[];
    zoningTypes?: string[];
    useTypes?: string[]; // residential, commercial, agricultural, recreational
    roadAccess?: string[];
    utilities?: string[];
    terrainTypes?: string[];
    waterFeatures?: boolean;
  }>(),
  
  // Financial capacity
  financialInfo: jsonb("financial_info").$type<{
    budget?: number;
    preApproved?: boolean;
    preApprovalAmount?: number;
    financingType?: string; // cash, owner_finance, conventional, hard_money
    downPaymentCapacity?: number;
    monthlyPaymentCapacity?: number;
    creditScoreRange?: string;
  }>(),
  
  // Buyer intent
  intent: jsonb("intent").$type<{
    purchaseTimeline?: string; // immediate, 1_month, 3_months, 6_months, just_looking
    primaryUse?: string;
    investmentGoal?: string; // flip, hold, develop, recreation
    urgency?: number; // 1-10
    previousPurchases?: number;
  }>(),
  
  // Engagement history
  engagement: jsonb("engagement").$type<{
    propertiesViewed?: number[];
    propertiesFavorited?: number[];
    inquiriesMade?: number;
    lastContactDate?: string;
    preferredContactMethod?: string;
    responsiveness?: string; // high, medium, low
  }>(),
  
  // AI-computed scores
  qualificationScore: integer("qualification_score"), // 0-100
  matchConfidence: integer("match_confidence"), // 0-100 overall match quality
  
  isActive: boolean("is_active").default(true),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Buyer-Property Matches - AI-generated matches
export const buyerPropertyMatches = pgTable("buyer_property_matches", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  buyerProfileId: integer("buyer_profile_id").references(() => buyerProfiles.id).notNull(),
  propertyId: integer("property_id").references(() => properties.id).notNull(),
  
  // Match quality
  matchScore: integer("match_score").notNull(), // 0-100
  matchFactors: jsonb("match_factors").$type<{
    priceMatch: number; // 0-100
    sizeMatch: number;
    locationMatch: number;
    zoningMatch: number;
    featureMatch: number;
    financingMatch: number;
  }>(),
  
  // Match details
  matchReasons: jsonb("match_reasons").$type<string[]>(),
  potentialConcerns: jsonb("potential_concerns").$type<string[]>(),
  suggestedPitch: text("suggested_pitch"),
  
  // Status
  status: text("status").notNull().default("pending"), // pending, presented, interested, not_interested, purchased
  presentedAt: timestamp("presented_at"),
  buyerResponse: text("buyer_response"),

  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("buyer_property_match_buyer_idx").on(table.buyerProfileId),
  index("buyer_property_match_prop_idx").on(table.propertyId),
  index("buyer_property_match_org_idx").on(table.organizationId),
]);

// Buyer Qualifications - pre-screening results
export const buyerQualifications = pgTable("buyer_qualifications", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  buyerProfileId: integer("buyer_profile_id").references(() => buyerProfiles.id).notNull(),
  
  // Qualification checks
  checks: jsonb("checks").$type<{
    financialVerified?: boolean;
    identityVerified?: boolean;
    proofOfFunds?: boolean;
    preApprovalLetter?: boolean;
    references?: boolean;
    backgroundCheck?: boolean;
  }>(),
  
  // Financing readiness
  financingReadiness: jsonb("financing_readiness").$type<{
    cashAvailable?: number;
    preApprovalStatus?: string;
    creditStatus?: string;
    debtToIncome?: number;
    downPaymentReady?: boolean;
    ownerFinanceEligible?: boolean;
  }>(),
  
  // AI assessment
  assessment: jsonb("assessment").$type<{
    overallScore: number;
    strengths: string[];
    concerns: string[];
    recommendations: string[];
    riskLevel: string;
    closingProbability: number;
  }>(),
  
  // Qualification status
  status: text("status").notNull().default("pending"), // pending, qualified, conditionally_qualified, not_qualified
  qualifiedAt: timestamp("qualified_at"),
  qualifiedBy: text("qualified_by"), // system or user
  
  notes: text("notes"),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Disposition Recommendations - optimal selling strategies
export const dispositionRecommendations = pgTable("disposition_recommendations", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  propertyId: integer("property_id").references(() => properties.id).notNull(),
  
  // Recommended strategy
  strategy: text("strategy").notNull(), // list_retail, sell_wholesale, owner_finance, auction, hold
  confidence: integer("confidence").notNull(), // 0-100
  
  // Price recommendations
  pricing: jsonb("pricing").$type<{
    recommendedPrice: number;
    priceRange: { min: number; max: number };
    marketComps: Array<{ address: string; price: number; soldDate?: string }>;
    pricePerAcre: number;
    daysToSellEstimate: number;
  }>(),
  
  // Channel recommendations
  channels: jsonb("channels").$type<Array<{
    channel: string; // mls, facebook, craigslist, landwatch, direct_mail, buyer_list
    priority: number;
    estimatedReach: number;
    estimatedCost: number;
    notes?: string;
  }>>(),
  
  // Timing recommendations
  timing: jsonb("timing").$type<{
    optimalListDate: string;
    seasonality: string;
    marketTrend: string;
    urgencyScore: number;
    holdRecommendation?: string;
  }>(),
  
  // Target buyer profile
  targetBuyer: jsonb("target_buyer").$type<{
    profileType: string;
    likelyUseCase: string;
    financingPreference: string;
    keyFeaturesToHighlight: string[];
  }>(),
  
  // Owner financing terms if recommended
  ownerFinanceTerms: jsonb("owner_finance_terms").$type<{
    downPaymentPercent: number;
    interestRate: number;
    termMonths: number;
    monthlyPayment: number;
    totalValue: number;
  }>(),
  
  // ROI analysis
  roiAnalysis: jsonb("roi_analysis").$type<{
    acquisitionCost: number;
    holdingCosts: number;
    sellingCosts: number;
    netProfit: number;
    roi: number;
    annualizedReturn: number;
  }>(),
  
  // Alternative strategies
  alternatives: jsonb("alternatives").$type<Array<{
    strategy: string;
    expectedValue: number;
    pros: string[];
    cons: string[];
  }>>(),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertBuyerProfileSchema = createInsertSchema(buyerProfiles).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertBuyerProfile = z.infer<typeof insertBuyerProfileSchema>;
export type BuyerProfile = typeof buyerProfiles.$inferSelect;

export const insertBuyerPropertyMatchSchema = createInsertSchema(buyerPropertyMatches).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertBuyerPropertyMatch = z.infer<typeof insertBuyerPropertyMatchSchema>;
export type BuyerPropertyMatch = typeof buyerPropertyMatches.$inferSelect;

export const insertBuyerQualificationSchema = createInsertSchema(buyerQualifications).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertBuyerQualification = z.infer<typeof insertBuyerQualificationSchema>;
export type BuyerQualification = typeof buyerQualifications.$inferSelect;

export const insertDispositionRecommendationSchema = createInsertSchema(dispositionRecommendations).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertDispositionRecommendation = z.infer<typeof insertDispositionRecommendationSchema>;
export type DispositionRecommendation = typeof dispositionRecommendations.$inferSelect;

// ============================================
// PLAYBOOKS - Guided Workflows
// ============================================

export const PLAYBOOK_TEMPLATES = {
  acquisition_sprint: "acquisition_sprint",
  due_diligence: "due_diligence", 
  disposition_launch: "disposition_launch",
} as const;

export type PlaybookTemplateType = typeof PLAYBOOK_TEMPLATES[keyof typeof PLAYBOOK_TEMPLATES];

export const playbookInstances = pgTable("playbook_instances", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  templateId: text("template_id").notNull(), // acquisition_sprint, due_diligence, disposition_launch
  name: text("name").notNull(),
  status: text("status").notNull().default("in_progress"), // in_progress, completed, cancelled
  
  linkedDealId: integer("linked_deal_id").references(() => deals.id),
  linkedPropertyId: integer("linked_property_id").references(() => properties.id),
  linkedLeadId: integer("linked_lead_id").references(() => leads.id),
  
  completedSteps: jsonb("completed_steps").$type<string[]>().default([]),
  stepData: jsonb("step_data").$type<Record<string, any>>(),
  
  startedAt: timestamp("started_at").defaultNow(),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertPlaybookInstanceSchema = createInsertSchema(playbookInstances).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertPlaybookInstance = z.infer<typeof insertPlaybookInstanceSchema>;
export type PlaybookInstance = typeof playbookInstances.$inferSelect;

// Playbook step types for frontend
export interface PlaybookStep {
  id: string;
  title: string;
  description: string;
  actionType: "navigate" | "create_lead" | "create_property" | "create_deal" | "link_entity" | "manual";
  actionLabel: string;
  actionUrl?: string;
  icon: string;
  estimatedMinutes?: number;
}

export interface PlaybookTemplate {
  id: string;
  name: string;
  description: string;
  category: "acquisition" | "due_diligence" | "disposition";
  estimatedDuration: string;
  steps: PlaybookStep[];
}

// ============================================
// WORKSPACE PRESETS - Power User Features
// ============================================

export const workspacePresets = pgTable("workspace_presets", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  layout: jsonb("layout").$type<{
    route: string;
    sidebarCollapsed?: boolean;
    openPanels?: string[];
    filters?: Record<string, any>;
    sortBy?: string;
    viewMode?: string;
  }>().notNull(),
  icon: text("icon"),
  color: text("color"),
  isDefault: boolean("is_default").default(false),
  sortOrder: integer("sort_order").default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("workspace_presets_org_idx").on(table.organizationId),
  index("workspace_presets_user_idx").on(table.userId),
]);

export const insertWorkspacePresetSchema = createInsertSchema(workspacePresets).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type WorkspacePreset = typeof workspacePresets.$inferSelect;
export type InsertWorkspacePreset = z.infer<typeof insertWorkspacePresetSchema>;

// ============================================
// SUPPORT TICKETS & KNOWLEDGE BASE
// ============================================

export const supportTickets = pgTable("support_tickets", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  userId: text("user_id").notNull(),
  
  // Ticket details
  subject: text("subject").notNull(),
  description: text("description").notNull(),
  category: text("category").notNull().default("general"), // general, billing, technical, feature_request, bug_report
  priority: text("priority").notNull().default("normal"), // low, normal, high, urgent
  status: text("status").notNull().default("open"), // open, in_progress, waiting_on_customer, resolved, closed
  
  // AI handling
  assignedAgent: text("assigned_agent"), // pax (Support Agent), pax, or null for human
  aiHandled: boolean("ai_handled").default(false),
  aiConfidenceScore: numeric("ai_confidence_score"), // 0-100 confidence in resolution
  aiResolutionAttempts: integer("ai_resolution_attempts").default(0),

  // ── Andrei — autonomous-resolve calibration loop (close the loop) ──────────
  // When Pax auto-resolves a ticket on its SELF-REPORTED confidence, the only
  // way calibration can ever learn is if the OUTCOME of that decision is
  // labeled later. These two columns are that label:
  //   aiResolutionOutcome: null while the decision stands unobserved, then
  //     'held' (stayed resolved / not contradicted), 'reopened' (the customer
  //     posted again on an auto-resolved ticket → the answer didn't land), or
  //     'csat_negative' (the customer rated it ≤2★ / thumbs-down).
  //   aiResolutionReopened: convenience bool mirroring the reopen case for fast
  //     filtering. A reopened OR csat_negative outcome == "was corrected" — the
  //     label the Brier/calibration job needs to know an auto-resolve was wrong.
  // Set by gradeAutoResolvedTicket() (server/services/andrei/supportResolverCalibration.ts)
  // from the reopen/CSAT handlers + the daily grader. Pax's live auto-resolve
  // THRESHOLD is unchanged — this only INSTRUMENTS the outcome so the data to
  // govern that threshold later exists.
  aiResolutionOutcome: text("ai_resolution_outcome"), // null | held | reopened | csat_negative
  aiResolutionReopened: boolean("ai_resolution_reopened").default(false),
  
  // Resolution details
  resolution: text("resolution"),
  resolutionType: text("resolution_type"), // auto_fixed, knowledge_base, escalated, manual
  resolvedAt: timestamp("resolved_at"),
  resolvedBy: text("resolved_by"), // user_id or agent name
  
  // Customer satisfaction
  customerRating: integer("customer_rating"), // 1-5 stars
  customerFeedback: text("customer_feedback"),
  
  // Context for AI
  pageContext: text("page_context"), // Which page user was on
  errorContext: jsonb("error_context").$type<{
    errorMessage?: string;
    stackTrace?: string;
    browserInfo?: string;
    screenSize?: string;
  }>(),
  
  // Escalation diagnostic bundle (auto-gathered when escalating)
  escalationBundle: jsonb("escalation_bundle").$type<{
    gatheredAt: string;
    organization: any;
    dataCounts: any;
    usageLimits: any;
    activeAlerts: any[];
    serviceHealth: any;
    recentActivity: any[];
    recentApiErrors: any[];
    previousIssues: any[];
    solutionsTried: any[];
  }>(),
  
  // Metadata
  source: text("source").notNull().default("in_app"), // in_app, email, chat
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("support_tickets_org_idx").on(table.organizationId),
  index("support_tickets_status_idx").on(table.status),
  index("support_tickets_user_idx").on(table.userId),
]);

export const supportTicketMessages = pgTable("support_ticket_messages", {
  id: serial("id").primaryKey(),
  ticketId: integer("ticket_id").references(() => supportTickets.id).notNull(),
  
  role: text("role").notNull(), // user, agent, system
  content: text("content").notNull(),
  agentName: text("agent_name"), // Pax, Pax, or human agent name
  
  // For AI messages
  toolsUsed: jsonb("tools_used").$type<string[]>(),
  actionsPerformed: jsonb("actions_performed").$type<Array<{
    action: string;
    target: string;
    result: string;
    success: boolean;
  }>>(),
  
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("support_ticket_messages_ticket_idx").on(table.ticketId),
]);

export const knowledgeBaseArticles = pgTable("knowledge_base_articles", {
  id: serial("id").primaryKey(),
  
  title: text("title").notNull(),
  slug: text("slug").notNull().unique(),
  content: text("content").notNull(), // Markdown content
  summary: text("summary"), // Short summary for search results
  
  category: text("category").notNull(), // getting_started, leads, properties, deals, finance, campaigns, ai, integrations, billing
  tags: jsonb("tags").$type<string[]>().default([]),
  
  // For AI matching
  keywords: jsonb("keywords").$type<string[]>().default([]),
  relatedIssues: jsonb("related_issues").$type<string[]>().default([]), // Common error messages or issues this solves
  
  // Troubleshooting steps
  troubleshootingSteps: jsonb("troubleshooting_steps").$type<Array<{
    step: number;
    instruction: string;
    expectedResult: string;
  }>>(),
  
  // Auto-fix capability
  canAutoFix: boolean("can_auto_fix").default(false),
  autoFixToolName: text("auto_fix_tool_name"), // Tool the AI can call to fix this
  autoFixParameters: jsonb("auto_fix_parameters").$type<Record<string, any>>(),
  
  // Analytics
  viewCount: integer("view_count").default(0),
  helpfulCount: integer("helpful_count").default(0),
  notHelpfulCount: integer("not_helpful_count").default(0),

  // Tahoe E3 / Rafe — KB auto-publish from resolved tickets.
  // `isDraft` gates the article from /api/support/knowledge-base reads.
  // `sourceTicketId` ties the draft back to the resolved ticket so a
  // reviewer can audit the conversation before publishing. `draftStatus`
  // is "pending_review" until the founder/admin clicks Publish (→ "published")
  // or Dismiss (→ "dismissed"). isPublished flips on publish.
  isDraft: boolean("is_draft").default(false),
  draftStatus: text("draft_status"), // pending_review | published | dismissed | null (already-live)
  sourceTicketId: integer("source_ticket_id").references(() => supportTickets.id),

  isPublished: boolean("is_published").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("kb_articles_category_idx").on(table.category),
  index("kb_articles_slug_idx").on(table.slug),
  index("kb_articles_draft_status_idx").on(table.draftStatus, table.createdAt),
]);

// Track AI resolution history for learning
export const supportResolutionHistory = pgTable("support_resolution_history", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  ticketId: integer("ticket_id").references(() => supportTickets.id),
  
  issueType: text("issue_type").notNull(),
  issuePattern: text("issue_pattern"), // Regex or keyword pattern
  
  variantName: text("variant_name"), // For A/B testing different resolution approaches
  resolutionApproach: text("resolution_approach").notNull(),
  toolsUsed: jsonb("tools_used").$type<string[]>(),
  customerEffortScore: integer("customer_effort_score"), // 1-5 how much effort from customer
  
  wasSuccessful: boolean("was_successful").notNull(),
  customerSatisfied: boolean("customer_satisfied"),
  
  // For improving AI
  lessonLearned: text("lesson_learned"),
  
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("resolution_history_issue_type_idx").on(table.issueType),
]);

export const insertSupportTicketSchema = createInsertSchema(supportTickets).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertSupportTicket = z.infer<typeof insertSupportTicketSchema>;
export type SupportTicket = typeof supportTickets.$inferSelect;

export const insertSupportTicketMessageSchema = createInsertSchema(supportTicketMessages).omit({
  id: true,
  createdAt: true,
});
export type InsertSupportTicketMessage = z.infer<typeof insertSupportTicketMessageSchema>;
export type SupportTicketMessage = typeof supportTicketMessages.$inferSelect;

export const insertKnowledgeBaseArticleSchema = createInsertSchema(knowledgeBaseArticles).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertKnowledgeBaseArticle = z.infer<typeof insertKnowledgeBaseArticleSchema>;
export type KnowledgeBaseArticle = typeof knowledgeBaseArticles.$inferSelect;

export const insertSupportResolutionHistorySchema = createInsertSchema(supportResolutionHistory).omit({
  id: true,
  createdAt: true,
});
export type InsertSupportResolutionHistory = z.infer<typeof insertSupportResolutionHistorySchema>;
export type SupportResolutionHistory = typeof supportResolutionHistory.$inferSelect;

// Multi-session memory for Pax - stores context across conversations
export const paxMemory = pgTable("pax_memory", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  userId: text("user_id").notNull(),
  
  // Memory type for different kinds of remembered information
  memoryType: text("memory_type").notNull(), // issue_history, preference, solution_tried, escalation, context
  
  // The remembered information
  key: text("key").notNull(), // e.g., "last_billing_issue", "preferred_contact_method", "tried_cache_clear"
  value: jsonb("value").$type<{
    summary?: string;
    details?: any;
    issueType?: string;
    toolsUsed?: string[];
    resolution?: string;
    wasSuccessful?: boolean;
    timestamp?: string;
  }>(),
  
  // Relevance and expiry
  importance: integer("importance").default(5), // 1-10 scale, higher = more important to remember
  expiresAt: timestamp("expires_at"), // Optional expiry for temporary memories
  
  // Source tracking
  sourceTicketId: integer("source_ticket_id").references(() => supportTickets.id),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("pax_memory_org_user_idx").on(table.organizationId, table.userId),
  index("pax_memory_type_idx").on(table.memoryType),
  index("pax_memory_key_idx").on(table.key),
]);

export const insertPaxMemorySchema = createInsertSchema(paxMemory).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertPaxMemory = z.infer<typeof insertPaxMemorySchema>;
export type PaxMemory = typeof paxMemory.$inferSelect;

// Track self-healing fix attempts with retry logic
export const fixAttempts = pgTable("fix_attempts", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  
  issuePattern: text("issue_pattern").notNull(),
  fixAction: text("fix_action").notNull(),
  
  attemptNumber: integer("attempt_number").notNull().default(1),
  status: text("status").notNull().default("pending"), // pending, success, failed, escalated
  
  errorMessage: text("error_message"),
  result: jsonb("result").$type<{
    success: boolean;
    details?: string;
    fixedAt?: string;
    retryAfter?: string;
  }>(),
  
  sourceObservationId: integer("source_observation_id").references(() => paxObservations.id),
  sourceTicketId: integer("source_ticket_id").references(() => supportTickets.id),
  escalatedAt: timestamp("escalated_at"),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("fix_attempts_org_idx").on(table.organizationId),
  index("fix_attempts_pattern_idx").on(table.issuePattern),
  index("fix_attempts_status_idx").on(table.status),
]);

export const insertFixAttemptSchema = createInsertSchema(fixAttempts).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertFixAttempt = z.infer<typeof insertFixAttemptSchema>;
export type FixAttempt = typeof fixAttempts.$inferSelect;

// Cross-org learning patterns - learnings that apply across all organizations
export const paxCrossOrgLearnings = pgTable("pax_cross_org_learnings", {
  id: serial("id").primaryKey(),
  
  issuePattern: text("issue_pattern").notNull(),
  issueCategory: text("issue_category").notNull(), // billing, ai, leads, properties, etc.
  
  resolutionApproach: text("resolution_approach").notNull(),
  lessonLearned: text("lesson_learned"),
  
  applicableCategories: jsonb("applicable_categories").$type<string[]>().default([]),
  keywords: jsonb("keywords").$type<string[]>().default([]),
  
  successCount: integer("success_count").default(0),
  failureCount: integer("failure_count").default(0),
  successRate: numeric("success_rate").default("0"),
  
  isAutoFixable: boolean("is_auto_fixable").default(false),
  autoFixAction: text("auto_fix_action"),
  
  sourceTicketIds: jsonb("source_ticket_ids").$type<number[]>().default([]),
  contributingOrgIds: jsonb("contributing_org_ids").$type<number[]>().default([]),
  contributingOrgs: integer("contributing_orgs").default(0),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("cross_org_learnings_category_idx").on(table.issueCategory),
  index("cross_org_learnings_pattern_idx").on(table.issuePattern),
]);

export const insertPaxCrossOrgLearningSchema = createInsertSchema(paxCrossOrgLearnings).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertPaxCrossOrgLearning = z.infer<typeof insertPaxCrossOrgLearningSchema>;
export type PaxCrossOrgLearning = typeof paxCrossOrgLearnings.$inferSelect;

// ============================================
// PHASE 1: INTELLIGENCE AMPLIFICATION
// ============================================
// (Tables already defined above - reusing existing definitions)

// Market Indicators - Aggregated economic and real estate signals (DUPLICATE - ALREADY EXISTS)
// Using existing marketPredictions table definition from earlier in file
export const marketIndicatorsDuplicate = pgTable("market_indicators_temp", {
  id: serial("id").primaryKey(),
  
  indicatorDate: timestamp("indicator_date").notNull().defaultNow(),
  
  // Interest rates
  federalFundsRate: numeric("federal_funds_rate"),
  mortgageRate30Yr: numeric("mortgage_rate_30_yr"),
  
  // Economic
  gdpGrowthRate: numeric("gdp_growth_rate"),
  inflationRate: numeric("inflation_rate"),
  unemploymentRate: numeric("unemployment_rate"),
  
  // Real estate specific
  nationalHomePriceIndex: numeric("national_home_price_index"),
  landDemandIndex: numeric("land_demand_index"), // custom calculation
  
  // Sentiment
  consumerConfidenceIndex: numeric("consumer_confidence_index"),
  
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertMarketIndicatorSchema = createInsertSchema(marketIndicatorsDuplicate).omit({ id: true, createdAt: true });
export type InsertMarketIndicator = z.infer<typeof insertMarketIndicatorSchema>;
export type MarketIndicator = typeof marketIndicatorsDuplicate.$inferSelect;

// Alias for imports expecting "marketIndicators"
export const marketIndicators = marketIndicatorsDuplicate;

// Price Trends - Historical price movements by property type and location
export const priceTrends = pgTable("price_trends", {
  id: serial("id").primaryKey(),
  
  // Location
  state: text("state").notNull(),
  county: text("county").notNull(),
  
  // Property characteristics
  propertyType: text("property_type").notNull(), // raw_land, recreational, agricultural, residential_lot, commercial
  acreageRange: text("acreage_range"), // 0-1, 1-5, 5-10, 10-40, 40+
  
  // Time period
  periodStart: timestamp("period_start").notNull(),
  periodEnd: timestamp("period_end").notNull(),
  
  // Pricing data
  avgPricePerAcre: numeric("avg_price_per_acre").notNull(),
  medianPricePerAcre: numeric("median_price_per_acre"),
  minPrice: numeric("min_price"),
  maxPrice: numeric("max_price"),
  
  // Volume
  transactionCount: integer("transaction_count").notNull(),
  totalAcresSold: numeric("total_acres_sold"),
  
  // Velocity
  avgDaysOnMarket: integer("avg_days_on_market"),
  
  // Comparison to previous period
  priceChange: numeric("price_change"), // percentage
  volumeChange: numeric("volume_change"), // percentage
  
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("price_trends_state_county_idx").on(table.state, table.county),
  index("price_trends_type_idx").on(table.propertyType),
  index("price_trends_period_idx").on(table.periodStart, table.periodEnd),
]);

export const insertPriceTrendSchema = createInsertSchema(priceTrends).omit({ id: true, createdAt: true });
export type InsertPriceTrend = z.infer<typeof insertPriceTrendSchema>;
export type PriceTrend = typeof priceTrends.$inferSelect;

// Scraped Deals - Opportunities found through automation
export const scrapedDeals = pgTable("scraped_deals", {
  id: serial("id").primaryKey(),
  
  // Source information
  sourceId: integer("source_id"), // references dealSources
  sourceType: text("source_type").notNull(), // tax_auction, foreclosure, probate, expired_listing, fsbo
  sourceUrl: text("source_url"),
  
  // Property details
  apn: text("apn"),
  address: text("address"),
  city: text("city"),
  county: text("county").notNull(),
  state: text("state").notNull(),
  zip: text("zip"),
  
  // Property characteristics
  sizeAcres: numeric("size_acres"),
  zoning: text("zoning"),
  
  // Pricing
  listPrice: numeric("list_price"),
  assessedValue: numeric("assessed_value"),
  taxesOwed: numeric("taxes_owed"),
  minimumBid: numeric("minimum_bid"),
  
  // Auction/sale details
  auctionDate: timestamp("auction_date"),
  auctionStatus: text("auction_status"), // upcoming, live, sold, unsold, cancelled
  
  // Owner information
  ownerName: text("owner_name"),
  ownerAddress: text("owner_address"),
  ownerType: text("owner_type"), // individual, corporate, estate, government
  
  // Distress signals
  distressScore: integer("distress_score"), // 0-100
  distressFactors: jsonb("distress_factors").$type<{
    taxDelinquent?: boolean;
    yearsDelinquent?: number;
    foreclosureStage?: string;
    probateStatus?: string;
    vacantLand?: boolean;
    absenteeOwner?: boolean;
    ownershipDuration?: number;
  }>(),
  
  // Processing status
  status: text("status").notNull().default("new"), // new, reviewed, contacted, added_to_crm, passed, archived
  convertedToLeadId: integer("converted_to_lead_id"),
  convertedToPropertyId: integer("converted_to_property_id"),
  
  // Scraping metadata
  scrapedAt: timestamp("scraped_at").notNull().defaultNow(),
  lastVerified: timestamp("last_verified"),
  
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("scraped_deals_state_county_idx").on(table.state, table.county),
  index("scraped_deals_status_idx").on(table.status),
  index("scraped_deals_auction_date_idx").on(table.auctionDate),
  index("scraped_deals_distress_idx").on(table.distressScore),
]);

export const insertScrapedDealSchema = createInsertSchema(scrapedDeals).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertScrapedDeal = z.infer<typeof insertScrapedDealSchema>;
export type ScrapedDeal = typeof scrapedDeals.$inferSelect;

// Deal Sources - Registry of county websites and data sources for scraping
export const dealSources = pgTable("deal_sources", {
  id: serial("id").primaryKey(),
  
  // Source identification
  name: text("name").notNull(),
  sourceType: text("source_type").notNull(), // county_website, auction_site, foreclosure_tracker, mls
  
  // Location
  state: text("state").notNull(),
  county: text("county"),
  
  // URL and scraping config
  baseUrl: text("base_url").notNull(),
  scrapingConfig: jsonb("scraping_config").$type<{
    scraperType: string; // puppeteer, api, rss
    selectors?: Record<string, string>;
    apiEndpoint?: string;
    apiKey?: string;
    updateFrequency?: string; // daily, weekly, realtime
    customHeaders?: Record<string, string>;
  }>(),
  
  // Status
  isActive: boolean("is_active").default(true),
  lastScraped: timestamp("last_scraped"),
  lastSuccessful: timestamp("last_successful"),
  consecutiveFailures: integer("consecutive_failures").default(0),
  
  // Performance
  avgDealsPerScrape: numeric("avg_deals_per_scrape"),
  totalDealsFound: integer("total_deals_found").default(0),
  conversionRate: numeric("conversion_rate"), // scraped deals to actual deals
  
  // Priority
  priority: integer("priority").default(50), // 0-100, higher = more important
  
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("deal_sources_state_county_idx").on(table.state, table.county),
  index("deal_sources_active_idx").on(table.isActive),
]);

export const insertDealSourceSchema = createInsertSchema(dealSources).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertDealSource = z.infer<typeof insertDealSourceSchema>;
export type DealSource = typeof dealSources.$inferSelect;

// Auto-Bid Rules - User-defined parameters for automatic bidding
export const autoBidRules = pgTable("auto_bid_rules", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  
  name: text("name").notNull(),
  isActive: boolean("is_active").default(true),
  
  // Geographic filters
  states: jsonb("states").$type<string[]>(),
  counties: jsonb("counties").$type<string[]>(),
  
  // Property filters
  minAcres: numeric("min_acres"),
  maxAcres: numeric("max_acres"),
  propertyTypes: jsonb("property_types").$type<string[]>(),
  
  // Price parameters
  maxBidAmount: numeric("max_bid_amount").notNull(),
  bidStrategy: text("bid_strategy").notNull(), // percentage_of_value, fixed_amount, incremental
  bidPercentage: numeric("bid_percentage"), // if percentage_of_value
  incrementAmount: numeric("increment_amount"), // if incremental
  
  // Distress criteria
  minDistressScore: integer("min_distress_score"),
  requireTaxDelinquent: boolean("require_tax_delinquent").default(false),
  
  // Approval workflow
  requiresApproval: boolean("requires_approval").default(true),
  approvalThreshold: numeric("approval_threshold"), // bids above this require approval
  
  // Budget controls
  monthlyBudget: numeric("monthly_budget"),
  currentMonthSpent: numeric("current_month_spent").default("0"),
  
  // Stats
  bidsPlaced: integer("bids_placed").default(0),
  bidsWon: integer("bids_won").default(0),
  totalSpent: numeric("total_spent").default("0"),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("auto_bid_rules_org_idx").on(table.organizationId),
  index("auto_bid_rules_active_idx").on(table.isActive),
]);

export const insertAutoBidRuleSchema = createInsertSchema(autoBidRules).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAutoBidRule = z.infer<typeof insertAutoBidRuleSchema>;
export type AutoBidRule = typeof autoBidRules.$inferSelect;

// Deal Alerts - Notifications for matching deals
export const dealAlerts = pgTable("deal_alerts", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  scrapedDealId: integer("scraped_deal_id").references(() => scrapedDeals.id).notNull(),
  autoBidRuleId: integer("auto_bid_rule_id").references(() => autoBidRules.id),
  
  alertType: text("alert_type").notNull(), // match, bid_placed, bid_won, bid_lost, auction_soon
  priority: text("priority").notNull().default("medium"), // low, medium, high, urgent
  
  message: text("message").notNull(),
  actionRequired: boolean("action_required").default(false),
  actionUrl: text("action_url"),
  
  // Delivery
  sentAt: timestamp("sent_at"),
  readAt: timestamp("read_at"),
  dismissedAt: timestamp("dismissed_at"),
  
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("deal_alerts_org_idx").on(table.organizationId),
  index("deal_alerts_type_idx").on(table.alertType),
  index("deal_alerts_read_idx").on(table.readAt),
]);

export const insertDealAlertSchema = createInsertSchema(dealAlerts).omit({ id: true, createdAt: true });
export type InsertDealAlert = z.infer<typeof insertDealAlertSchema>;
export type DealAlert = typeof dealAlerts.$inferSelect;

// Negotiation Threads - Track negotiation conversations
export const negotiationThreads = pgTable("negotiation_threads", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  
  leadId: integer("lead_id").references(() => leads.id).notNull(),
  propertyId: integer("property_id").references(() => properties.id),
  dealId: integer("deal_id"),
  // Which strategy is driving this thread — enables per-strategy performance
  // rollups scoped to a single strategy (not all of an org's threads).
  strategyId: integer("strategy_id").references(() => negotiationStrategies.id),

  status: text("status").notNull().default("active"), // active, stalled, closed_won, closed_lost, archived
  
  // Current state
  currentOfferAmount: numeric("current_offer_amount"),
  targetPrice: numeric("target_price"),
  walkawayPrice: numeric("walkaway_price"),
  
  // Psychology profile
  sellerProfile: jsonb("seller_profile").$type<{
    communicationStyle?: string; // responsive, slow, aggressive, friendly
    motivationLevel?: string; // high, medium, low
    urgency?: string; // immediate, flexible, no_rush
    priceFlexibility?: string; // firm, somewhat_flexible, very_flexible
    keyMotivators?: string[]; // cash, speed, terms, family, tax
  }>(),
  
  // Sentiment analysis
  overallSentiment: text("overall_sentiment"), // positive, neutral, negative, frustrated
  sentimentTrend: text("sentiment_trend"), // improving, stable, declining
  
  // AI strategy
  currentStrategy: text("current_strategy"), // anchor_low, meet_middle, add_terms, wait_and_watch
  strategyConfidence: numeric("strategy_confidence"), // 0-1
  
  // Stats
  totalExchanges: integer("total_exchanges").default(0),
  avgResponseTimeHours: numeric("avg_response_time_hours"),
  daysInNegotiation: integer("days_in_negotiation"),
  
  startedAt: timestamp("started_at").notNull().defaultNow(),
  lastActivityAt: timestamp("last_activity_at").defaultNow(),
  closedAt: timestamp("closed_at"),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("negotiation_threads_org_idx").on(table.organizationId),
  index("negotiation_threads_lead_idx").on(table.leadId),
  index("negotiation_threads_status_idx").on(table.status),
]);

export const insertNegotiationThreadSchema = createInsertSchema(negotiationThreads).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertNegotiationThread = z.infer<typeof insertNegotiationThreadSchema>;
export type NegotiationThread = typeof negotiationThreads.$inferSelect;

// Negotiation Moves - Individual offers and counter-offers
export const negotiationMoves = pgTable("negotiation_moves", {
  id: serial("id").primaryKey(),
  threadId: integer("thread_id").references(() => negotiationThreads.id).notNull(),
  
  moveNumber: integer("move_number").notNull(),
  moveType: text("move_type").notNull(), // initial_offer, counter_offer, acceptance, rejection, terms_change
  party: text("party").notNull(), // buyer, seller
  
  // Offer details
  offerAmount: numeric("offer_amount"),
  terms: text("terms"),
  reasoning: text("reasoning"), // AI's reasoning for this move
  
  // AI generation
  generatedByAI: boolean("generated_by_ai").default(false),
  aiModel: text("ai_model"),
  aiConfidence: numeric("ai_confidence"),
  alternativeStrategies: jsonb("alternative_strategies").$type<Array<{
    strategy: string;
    amount: number;
    reasoning: string;
    confidence: number;
  }>>(),
  
  // Response
  responseReceived: boolean("response_received").default(false),
  responseTime: integer("response_time"), // hours
  responseType: text("response_type"), // accepted, rejected, countered, no_response
  
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("negotiation_moves_thread_idx").on(table.threadId),
  index("negotiation_moves_party_idx").on(table.party),
]);

export const insertNegotiationMoveSchema = createInsertSchema(negotiationMoves).omit({ id: true, createdAt: true });
export type InsertNegotiationMove = z.infer<typeof insertNegotiationMoveSchema>;
export type NegotiationMove = typeof negotiationMoves.$inferSelect;

// Negotiation Outcomes - Learning data for AI improvement
export const negotiationOutcomes = pgTable("negotiation_outcomes", {
  id: serial("id").primaryKey(),
  // Tenant scope. Nullable for rows written before org-scoping landed; new
  // rows always carry it, and org-scoped reads filter on it (NULL rows are
  // never surfaced cross-org). Added 2026-06-15 with the negotiation
  // tenant-isolation fix.
  organizationId: integer("organization_id").references(() => organizations.id),
  threadId: integer("thread_id").references(() => negotiationThreads.id).notNull(),

  outcome: text("outcome").notNull(), // deal_closed, seller_walked, buyer_walked, stalled
  
  // Final terms
  finalPrice: numeric("final_price"),
  initialOffer: numeric("initial_offer"),
  targetPrice: numeric("target_price"),
  negotiationDiscount: numeric("negotiation_discount"), // percentage saved from initial ask
  
  // Performance metrics
  totalDays: integer("total_days"),
  totalMoves: integer("total_moves"),
  strategyUsed: text("strategy_used"),
  strategyEffectiveness: integer("strategy_effectiveness"), // 1-10
  
  // Learnings
  keyFactors: jsonb("key_factors").$type<string[]>(), // what made this succeed/fail
  lessonsLearned: text("lessons_learned"),
  
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("negotiation_outcomes_org_idx").on(table.organizationId, table.createdAt),
  index("negotiation_outcomes_outcome_idx").on(table.outcome),
]);

export const insertNegotiationOutcomeSchema = createInsertSchema(negotiationOutcomes).omit({ id: true, createdAt: true });
export type InsertNegotiationOutcome = z.infer<typeof insertNegotiationOutcomeSchema>;
export type NegotiationOutcome = typeof negotiationOutcomes.$inferSelect;

// Negotiation Strategies - A/B test variants
export const negotiationStrategies = pgTable("negotiation_strategies", {
  id: serial("id").primaryKey(),
  // Tenant scope — see negotiationOutcomes. Nullable for pre-existing rows;
  // org-scoped reads (getBestStrategy / updateStrategyPerformance) filter on it
  // so one tenant's strategy performance can never influence another's.
  organizationId: integer("organization_id").references(() => organizations.id),

  name: text("name").notNull(),
  description: text("description"),
  
  strategyType: text("strategy_type").notNull(), // anchor_low, anchor_high, meet_middle, terms_heavy, cash_heavy
  
  // Parameters
  initialOfferPercentage: numeric("initial_offer_percentage"), // % of target
  incrementStrategy: text("increment_strategy"), // fixed, percentage, adaptive
  maxMoves: integer("max_moves"),
  
  // Performance tracking
  timesUsed: integer("times_used").default(0),
  successRate: numeric("success_rate"),
  avgDiscount: numeric("avg_discount"), // avg % saved
  avgDaysToClose: numeric("avg_days_to_close"),
  
  isActive: boolean("is_active").default(true),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("negotiation_strategies_org_idx").on(table.organizationId, table.successRate),
]);

export const insertNegotiationStrategySchema = createInsertSchema(negotiationStrategies).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertNegotiationStrategy = z.infer<typeof insertNegotiationStrategySchema>;
export type NegotiationStrategy = typeof negotiationStrategies.$inferSelect;

// ============================================================================
// FOUNDER AUTOPILOT — per-domain earned-autonomy (the Trust Ledger)
// ============================================================================
// One row per founder-ops domain (growth/support/deploy/ops/finance). Tracks
// the domain's autonomy level + clean-cycle progress toward promotion. Global
// (not org-scoped) — this is AcreOS-the-company governing its OWN operations.
export const domainAutonomyLevels = pgTable("domain_autonomy_levels", {
  id: serial("id").primaryKey(),
  domain: text("domain").notNull().unique(), // growth | support | deploy | ops | finance
  level: text("level").notNull().default("observe"), // observe | draft | execute_gated | autonomous_gated
  cleanCycleCount: integer("clean_cycle_count").notNull().default(0),
  lastPromotedAt: timestamp("last_promoted_at"),
  lastDemotedAt: timestamp("last_demoted_at"),
  lastDemotionReason: text("last_demotion_reason"),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Founder Autopilot — standing orders + intents ("Your Voice"). Durable
// natural-language policy the founder issues; the autopilot honors active
// orders in every outward action. Global (founder-level).
export const autopilotStandingOrders = pgTable("autopilot_standing_orders", {
  id: serial("id").primaryKey(),
  kind: text("kind").notNull().default("standing_order"), // standing_order | intent
  body: text("body").notNull(),
  active: boolean("active").notNull().default(true),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});
export type AutopilotStandingOrder = typeof autopilotStandingOrders.$inferSelect;

// Founder Autopilot — the Experience Log (procedural memory for the learning
// loop). One row per autopilot action; real signals accrete as they land (each
// field null until its signal genuinely arrives — never fabricated). Global.
export const autopilotExperiences = pgTable("autopilot_experiences", {
  id: serial("id").primaryKey(),
  moveKind: text("move_kind").notNull(),
  domain: text("domain").notNull(),
  playId: text("play_id"), // null for moves without a play (e.g. optimize)
  outcome: text("outcome").notNull(), // acted | escalated | suppressed
  dispatchId: integer("dispatch_id"),
  askId: integer("ask_id"),
  // Real signals — null until they land.
  dispatchSuccess: boolean("dispatch_success"),
  evalScore: numeric("eval_score"),
  founderVerdict: text("founder_verdict"), // approved | declined
  resolution: text("resolution"), // resolved | reopened
  satisfaction: integer("satisfaction"), // 1-5
  // Real downstream CONSEQUENCE signals (kernel-elevation T0.1) — set by a
  // webhook when a witnessed action's effect lands in the world, matched to this
  // row via target_ref. Null until/unless a concrete consequence is observed.
  deliveryBounced: boolean("delivery_bounced"), // an outward send hard-bounced/complained
  paymentRecovered: boolean("payment_recovered"), // a dunning action → the invoice then paid
  // The concrete business object this action targeted (e.g. "invoice:in_123",
  // "email:x@y.com"), set at witnessed execution when a hand knows its target —
  // the join key a downstream webhook uses to credit the consequence. Null when
  // no clean 1:1 target exists (→ honest abstention; no consequence attributed).
  targetRef: text("target_ref"),
  // Accountable scope (kernel-elevation T3 / #11) — "platform" (AcreOS operating
  // itself) today; an "org:N" once the kernel runs foreign tenants. Recorded NOW
  // (defaulted 'platform') because it's ruinous to retrofit onto a populated
  // learning ledger — you can't backfill which tenant a historical row belonged
  // to. Reads stay platform-wide until a second tenant exists; the column is the
  // cheap insurance that the cross-tenant split is a pure migration later.
  scope: text("scope").default("platform"),
  costUsd: numeric("cost_usd"),
  // Calibrated foresight: the success probability the system PREDICTED for this
  // action at act-time. Compared against the realized outcome to measure the
  // system's own calibration (Brier score). Null when no forecast was made.
  predictedSuccess: numeric("predicted_success"),
  // Glass-box: the full reasoning trace (senses → options → forecast → gate →
  // outcome + a plain-language narrative). Lets the founder reconstruct WHY.
  reasoningTrace: jsonb("reasoning_trace"),
  createdAt: timestamp("created_at").defaultNow(),
  resolvedAt: timestamp("resolved_at"),
}, (t) => ({
  playIdx: index("autopilot_experiences_play_idx").on(t.playId),
  dispatchIdx: index("autopilot_experiences_dispatch_idx").on(t.dispatchId),
  askIdx: index("autopilot_experiences_ask_idx").on(t.askId),
  targetRefIdx: index("autopilot_experiences_target_ref_idx").on(t.targetRef),
}));
export type AutopilotExperience = typeof autopilotExperiences.$inferSelect;

// autopilot_worldmodel_snapshots (kernel-elevation T1.3 / #10) — per-cycle
// snapshot of the causal world-model's edge confidences, so the model's
// confidence TRAJECTORY (the heart of THE BET) is observable + diffable, not an
// in-memory value discarded each tick. "self-improving" becomes a fact you can
// chart, with each edge badged measured (refined from real consequence) vs prior.
export const autopilotWorldmodelSnapshots = pgTable("autopilot_worldmodel_snapshots", {
  id: serial("id").primaryKey(),
  capturedAt: timestamp("captured_at").defaultNow(),
  modelVersion: integer("model_version").notNull(),
  edges: jsonb("edges").notNull(), // [{ from, to, confidence, measured }]
  measuredEdgeCount: integer("measured_edge_count").notNull(),
  edgeCount: integer("edge_count").notNull(),
}, (t) => [
  index("autopilot_worldmodel_snapshots_at_idx").on(t.capturedAt),
]);
export type AutopilotWorldmodelSnapshot = typeof autopilotWorldmodelSnapshots.$inferSelect;

// Founder Autopilot — policy-induction proposals. When the system spots a
// durable pattern (a play it keeps declining, or one it keeps approving) it
// proposes codifying it. One row per (kind, play) — proposed at most once,
// respecting the founder's answer. Global.
export const autopilotPolicyProposals = pgTable("autopilot_policy_proposals", {
  id: serial("id").primaryKey(),
  kind: text("kind").notNull(), // stop_play | trust_play | ramp_budget
  playId: text("play_id").notNull(),
  domain: text("domain").notNull(),
  reason: text("reason").notNull(),
  status: text("status").notNull().default("open"), // open | approved | declined
  askId: integer("ask_id"),
  // ramp_budget only: the proposed new monthly cap (USD) applied on approval.
  targetValueUsd: doublePrecision("target_value_usd"),
  createdAt: timestamp("created_at").defaultNow(),
  resolvedAt: timestamp("resolved_at"),
}, (t) => ({
  playKindIdx: index("autopilot_policy_proposals_play_kind_idx").on(t.playId, t.kind),
  askIdx: index("autopilot_policy_proposals_ask_idx").on(t.askId),
}));
export type AutopilotPolicyProposal = typeof autopilotPolicyProposals.$inferSelect;

// ============================================================================
// MARKETPLACE + FINANCIAL INTEL + CAPITAL MARKETS + VOICE/VISUAL + ACADEMY +
// REGULATORY AI + WHITE-LABEL + STRIPE WEBHOOK DEDUP — extracted to
// ./schema/marketplace.ts
// ============================================================================
export * from "./schema/marketplace";


// ============================================================================
// AI TELEMETRY — extracted to ./schema/ai-telemetry.ts
// ============================================================================
export * from "./schema/ai-telemetry";

// ============================================================================
// API TELEMETRY SAMPLES (L14 — durable backing store for per-route counters).
// ============================================================================
export * from "./schema/api-telemetry-samples";

// ============================================================================
// API TELEMETRY ROLLUP MONTHLY (L14 follow-up — system-wide aggregate after
// the 30-day rolling purge of api_telemetry_samples).
// ============================================================================
export * from "./schema/api-telemetry-rollup-monthly";

// ============================================================================
// IR SEVERITY LADDER (Tahoe Tess — single source of truth for the
// incident-response / system_alerts severity ladder; locks free strings).
// ============================================================================
export * from "./schema/ir-severity";

// ============================================================================
// RESERVE FLOOR COMPLIANCE LOG (Tahoe L6 — capital-ladder enforcement).
// ============================================================================
export * from "./schema/reserve-floor-checks";

// ============================================================================
// COMPLIANCE / INVESTOR-VERIFICATION / FEES / TAX-BASIS / ML-REGISTRY —
// extracted to ./schema/compliance.ts
// ============================================================================
export * from "./schema/compliance";

// ============================================================================
// TIER 2D — bounded, audited calibration-threshold adjustments for the Pax
// support auto-resolve grader. Lives in ./schema/calibration-threshold-adjustments.ts
// ============================================================================
export * from "./schema/calibration-threshold-adjustments";

// ============================================================================
// REG-Z §1026.41 + §1026.36(c) — periodic statements, payment
// applications, suspense bucket, late-fee non-pyramiding.
// Lives in ./schema/reg-z.ts so a CFPB examiner reading the codebase can
// see every regulated field in one place.
// ============================================================================
export * from "./schema/reg-z";

// ============================================
// DEAL ROOM MESSAGES & DOCUMENTS (Tasks 45-52)
// ============================================

// Deal Room Messages — real-time chat within a deal room
export const dealRoomMessages = pgTable("deal_room_messages", {
  id: serial("id").primaryKey(),
  dealRoomId: integer("deal_room_id").references(() => dealRooms.id).notNull(),
  senderId: text("sender_id").notNull(), // user/org ID string
  senderName: text("sender_name").notNull(),
  content: text("content").notNull(),
  messageType: text("message_type").notNull().default("text"), // text | system | document
  attachmentUrl: text("attachment_url"),
  isRead: boolean("is_read").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("deal_room_messages_room_idx").on(table.dealRoomId),
  index("deal_room_messages_created_idx").on(table.createdAt),
]);

export const insertDealRoomMessageSchema = createInsertSchema(dealRoomMessages).omit({ id: true, createdAt: true });
export type InsertDealRoomMessage = z.infer<typeof insertDealRoomMessageSchema>;
export type DealRoomMessage = typeof dealRoomMessages.$inferSelect;

// Deal Room Documents — versioned file storage per deal room
export const dealRoomDocuments = pgTable("deal_room_documents", {
  id: serial("id").primaryKey(),
  dealRoomId: integer("deal_room_id").references(() => dealRooms.id).notNull(),
  uploadedBy: text("uploaded_by").notNull(), // user/org ID string
  fileName: text("file_name").notNull(),
  fileUrl: text("file_url").notNull(),
  fileSize: integer("file_size"), // bytes
  mimeType: text("mime_type"),
  version: integer("version").notNull().default(1),
  previousVersionId: integer("previous_version_id"), // self-reference via ID for version chain
  accessControl: jsonb("access_control").$type<{ allowedUserIds: string[] }>().notNull().default({ allowedUserIds: [] }),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("deal_room_documents_room_idx").on(table.dealRoomId),
  index("deal_room_documents_file_idx").on(table.dealRoomId, table.fileName),
]);

export const insertDealRoomDocumentSchema = createInsertSchema(dealRoomDocuments).omit({ id: true, createdAt: true });
export type InsertDealRoomDocument = z.infer<typeof insertDealRoomDocumentSchema>;
export type DealRoomDocument = typeof dealRoomDocuments.$inferSelect;

// ============================================
// PASSIVE COMMAND CENTER — FOUNDER INTELLIGENCE
// ============================================

// Decisions Inbox — pre-analyzed items requiring human judgment
export const decisionsInboxItems = pgTable("decisions_inbox_items", {
  id: serial("id").primaryKey(),
  itemType: text("item_type").notNull(), // support_escalation | critical_alert | feature_request_flagged | churn_risk_intervention | dunning_recovery | deferred_interrupt (Jarvis 2.2 arbiter deferral row) | outcome_check_in (Horizon A1 outcome-ledger founder check-in card) | letter_reply_confirm (Horizon A3 letter-reply shown-back parse awaiting the founder's witnessed confirmation)
  riskLevel: text("risk_level").notNull().default("medium"), // low | medium | high | critical
  urgencyScore: integer("urgency_score").notNull().default(50), // 0-100
  estimatedImpactCents: integer("estimated_impact_cents"),
  sophieAnalysis: text("sophie_analysis").notNull(),
  sophieConfidenceScore: integer("sophie_confidence_score"),
  recommendedAction: text("recommended_action").notNull(),
  recommendedActionLabel: text("recommended_action_label").notNull(),
  actionPayload: jsonb("action_payload").$type<Record<string, any>>(),
  sourceTicketId: integer("source_ticket_id").references(() => supportTickets.id),
  sourceAlertId: integer("source_alert_id").references(() => systemAlerts.id),
  sourceFeatureRequestId: integer("source_feature_request_id").references(() => featureRequests.id),
  organizationId: integer("organization_id").references(() => organizations.id),
  status: text("status").notNull().default("pending"), // pending | approved | rejected | deferred | auto_resolved | suppressed (Class C — interrupt-arbiter audit record, never surfaced)
  deferredUntil: timestamp("deferred_until"),
  resolvedAt: timestamp("resolved_at"),
  resolvedBy: text("resolved_by"),
  founderOverrideAction: text("founder_override_action"),
  contextBundle: jsonb("context_bundle").$type<Record<string, any>>(),
  ownerAgentCodename: text("owner_agent_codename"), // company agent that owns this decision
  // Horizon A1 outcome ledger — the PREDICTION made at creation (what will
  // be true if this was the right call + when to check). Items carrying a
  // checkInDate are scored by server/services/outcomeLedger.ts at 30/90
  // days; legacy items without one keep the 3-7-day heuristic grader.
  expectedOutcome: text("expected_outcome"),
  checkInDate: timestamp("check_in_date"),
  actualOutcome: text("actual_outcome"),
  outcomeScore: integer("outcome_score"), // -2 to +2
  outcomeRecordedAt: timestamp("outcome_recorded_at"),
  founderModification: text("founder_modification"),
  // Lens 46 — pointer to the agent_action_log row that resolved this item,
  // so the /audit-log/explain endpoint can hop a single join from inbox →
  // action → llm_traces → observations.
  resolvedByActionLogId: integer("resolved_by_action_log_id"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("decisions_inbox_status_idx").on(table.status),
  index("decisions_inbox_urgency_idx").on(table.urgencyScore),
  index("decisions_inbox_org_idx").on(table.organizationId),
  index("decisions_inbox_resolved_action_idx").on(table.resolvedByActionLogId),
]);

export const insertDecisionsInboxItemSchema = createInsertSchema(decisionsInboxItems).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertDecisionsInboxItem = z.infer<typeof insertDecisionsInboxItemSchema>;
export type DecisionsInboxItem = typeof decisionsInboxItems.$inferSelect;

// Churn Risk Scores — per-org composite risk scoring
export const churnRiskScores = pgTable("churn_risk_scores", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  riskScore: integer("risk_score").notNull(), // 0-100
  riskBand: text("risk_band").notNull(), // green | yellow | red | critical
  loginFrequencyScore: integer("login_frequency_score"),    // 0-25
  featureUsageScore: integer("feature_usage_score"),        // 0-25
  supportTicketScore: integer("support_ticket_score"),      // 0-20
  dunningStateScore: integer("dunning_state_score"),        // 0-20
  engagementTrendScore: integer("engagement_trend_score"),  // 0-10
  daysSinceLastActive: integer("days_since_last_active"),
  loginsLast14d: integer("logins_last_14d"),
  ticketsLast30d: integer("tickets_last_30d"),
  dunningStage: text("dunning_stage"),
  featureUsageTrend: text("feature_usage_trend"), // increasing | stable | declining
  lastInterventionAt: timestamp("last_intervention_at"),
  lastInterventionType: text("last_intervention_type"),
  interventionCount: integer("intervention_count").default(0),
  nextInterventionAt: timestamp("next_intervention_at"),
  nextInterventionType: text("next_intervention_type"),
  scoredAt: timestamp("scored_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("churn_risk_org_idx").on(table.organizationId),
  index("churn_risk_band_idx").on(table.riskBand),
  index("churn_risk_score_idx").on(table.riskScore),
]);

export const insertChurnRiskScoreSchema = createInsertSchema(churnRiskScores).omit({ id: true, createdAt: true });
export type InsertChurnRiskScore = z.infer<typeof insertChurnRiskScoreSchema>;
export type ChurnRiskScore = typeof churnRiskScores.$inferSelect;

// NPS Responses — Net Promoter Score feedback collection
export const npsResponses = pgTable("nps_responses", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  userId: text("user_id").notNull(),
  score: integer("score").notNull(), // 0-10
  feedback: text("feedback"), // Optional free-text
  trigger: text("trigger").notNull(), // "day_14", "churn", "upgrade", "quarterly"
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertNpsResponseSchema = createInsertSchema(npsResponses).omit({ id: true, createdAt: true });
export type InsertNpsResponse = z.infer<typeof insertNpsResponseSchema>;
export type NpsResponse = typeof npsResponses.$inferSelect;

// Tahoe E3 / Rafe — NPS prompt queue.
// A daily scheduler (server/jobs/runScheduledJobs.ts → startNpsPromptSchedulerJob)
// inserts one row per (org, primary_user) when the cohort gate passes:
//   - org age >= 21 days since signup
//   - no NPS response in the last 90 days
//   - no pending queue row already
// On next login, /api/nps/pending reads this queue first. When the user
// submits or dismisses, the row is marked consumed. The dialog hook in
// AppContent stays unchanged — only the source of truth shifts from
// "trigger inferred from org.createdAt" to "trigger flagged by the
// scheduler."
export const npsPromptQueue = pgTable("nps_prompt_queue", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  userId: text("user_id").notNull(),
  trigger: text("trigger").notNull(), // scheduled_21d | scheduled_quarterly | manual
  scheduledFor: timestamp("scheduled_for").notNull(),
  status: text("status").notNull().default("pending"), // pending | shown | submitted | dismissed
  shownAt: timestamp("shown_at"),
  consumedAt: timestamp("consumed_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  // Leading-org composite per the L3 shard-readiness lint
  // (scripts/check-org-leading-index.mjs). org_id leads + status +
  // scheduledFor covers the hot read path on login.
  index("nps_prompt_queue_org_status_scheduled_idx").on(table.organizationId, table.status, table.scheduledFor),
  index("nps_prompt_queue_user_status_idx").on(table.userId, table.status),
]);

export const insertNpsPromptQueueSchema = createInsertSchema(npsPromptQueue).omit({ id: true, createdAt: true });
export type InsertNpsPromptQueue = z.infer<typeof insertNpsPromptQueueSchema>;
export type NpsPromptQueue = typeof npsPromptQueue.$inferSelect;

// Job Health Logs — execution records for all background jobs
export const jobHealthLogs = pgTable("job_health_logs", {
  id: serial("id").primaryKey(),
  jobName: text("job_name").notNull(),
  runStartedAt: timestamp("run_started_at").notNull(),
  runCompletedAt: timestamp("run_completed_at"),
  durationMs: integer("duration_ms"),
  status: text("status").notNull(), // success | failed | timeout | skipped_lock
  errorMessage: text("error_message"),
  runMetrics: jsonb("run_metrics").$type<Record<string, any>>(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("job_health_job_name_idx").on(table.jobName),
  index("job_health_status_idx").on(table.status),
  index("job_health_started_idx").on(table.runStartedAt),
]);

export const insertJobHealthLogSchema = createInsertSchema(jobHealthLogs).omit({ id: true, createdAt: true });
export type InsertJobHealthLog = z.infer<typeof insertJobHealthLogSchema>;
export type JobHealthLog = typeof jobHealthLogs.$inferSelect;

// ── Worker heartbeat (Tess #5) ───────────────────────────────────────────────
// The worker process runs every scheduled job AND originates every alert
// (autonomousHealthMonitor, dataSourceProbe, the burn-rate monitor). If the
// worker dies we lose background processing *and* the ability to tell anyone we
// lost it — "the watchman watches everyone but no one watches the watchman."
//
// This single-row table is the watchman's pulse: server/worker.ts bumps
// updatedAt on every outbox poll loop. An *external* eye (the Cloudflare probe,
// or any uptime monitor) reads GET /api/health/worker-heartbeat — an auth-free
// endpoint like /api/healthz — and pages if the heartbeat is stale. That is the
// only correct topology: the thing that detects "alerting is down" lives OUTSIDE
// alerting. Single row, pinned to id=1 (an UPSERT keeps it singleton).
export const workerHeartbeat = pgTable("worker_heartbeat", {
  id: integer("id").primaryKey().default(1),
  // Stable identifier of the worker process that last wrote the pulse — useful
  // when debugging which machine is (or isn't) alive.
  instanceId: text("instance_id"),
  // Build SHA the live worker is running, so a stale heartbeat after a deploy is
  // attributable to a specific release.
  gitSha: text("git_sha"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertWorkerHeartbeatSchema = createInsertSchema(workerHeartbeat).omit({ updatedAt: true });
export type InsertWorkerHeartbeat = z.infer<typeof insertWorkerHeartbeatSchema>;
export type WorkerHeartbeat = typeof workerHeartbeat.$inferSelect;

// Uptime samples — append-only liveness pulse (the HISTORY the single-row
// worker_heartbeat can't keep). The worker writes one row ~per minute as it
// polls; GAPS between consecutive samples are provable downtime (the worker
// wasn't running to write them). The real uptime % is derived from these gaps,
// replacing the old hard-stubbed constant. `source` distinguishes the internal
// worker pulse from an optional external probe. Pruned to ~31 days. Global.
export const uptimeSamples = pgTable("uptime_samples", {
  id: serial("id").primaryKey(),
  at: timestamp("at").notNull().defaultNow(),
  source: text("source").notNull().default("worker"), // worker | external
}, (t) => ({
  atIdx: index("uptime_samples_at_idx").on(t.at),
}));
export type UptimeSample = typeof uptimeSamples.$inferSelect;

// Founder Autopilot — runtime settings (the master switches, DB-backed so the
// founder flips them from the Control Center instead of a Fly secret). Singleton
// row (id=1). The runtime reads these with env as the fallback default, so the
// system stays safe-off until a real row says otherwise. Global.
export const autopilotSettings = pgTable("autopilot_settings", {
  id: integer("id").primaryKey().default(1),
  dispatchEnabled: boolean("dispatch_enabled"), // null → fall back to env
  publishEnabled: boolean("publish_enabled"), // null → fall back to env
  // DB-backed monthly growth-budget cap an approved ramp writes. null → the
  // env/charter default governs. Clamped to a hard ceiling at read-time.
  growthBudgetOverrideUsd: doublePrecision("growth_budget_override_usd"),
  // Master switch for the autonomous daily Operator cadence. null → env fallback (OFF).
  cognitionEnabled: boolean("cognition_enabled"),
  // Master switch for the immune system's motor half (gated self-patch PRs).
  // null → env SELF_PATCH_ENABLED fallback (OFF). Flipping it is a Control
  // Center tap, not a Fly secret + redeploy.
  selfPatchEnabled: boolean("self_patch_enabled"),
  updatedAt: timestamp("updated_at").defaultNow(),
  updatedBy: text("updated_by"),
});
export type AutopilotSettings = typeof autopilotSettings.$inferSelect;

// Growth targets — the queue of WHICH county to write the next owned-content
// guide for. Seeded from the founder's buy-box counties at ignition, later
// demand-ranked from real parcel-check volume. The daily grow loop drains the
// highest-priority pending target. Global (one shared SEO surface). Migration 0181.
export const growthTargets = pgTable("growth_targets", {
  id: serial("id").primaryKey(),
  state: text("state").notNull(),
  countySlug: text("county_slug").notNull(),
  countyLabel: text("county_label").notNull(),
  source: text("source").notNull().default("seed"), // seed | demand
  demandScore: doublePrecision("demand_score").notNull().default(0),
  status: text("status").notNull().default("pending"), // pending | dispatched
  dispatchedAt: timestamp("dispatched_at"),
  lastDispatchId: integer("last_dispatch_id"),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => ({
  stateCountyIdx: uniqueIndex("growth_targets_state_county_idx").on(t.state, t.countySlug),
  statusScoreIdx: index("growth_targets_status_score_idx").on(t.status, t.demandScore),
}));
export type GrowthTarget = typeof growthTargets.$inferSelect;

// Founder Autopilot — published marketing artifacts. The stable id every
// attribution keys against (replaces the in-memory content-brief map). One row
// per artifact the autopilot publishes to a public owned surface. Global.
export const marketingArtifacts = pgTable("marketing_artifacts", {
  id: serial("id").primaryKey(),
  dispatchId: integer("dispatch_id"),
  playId: text("play_id"),
  slug: text("slug").notNull(),
  surface: text("surface").notNull().default("field_note"),
  county: text("county"),
  state: text("state"),
  publishedAt: timestamp("published_at"),
  unpublishedAt: timestamp("unpublished_at"),
  viewCount: integer("view_count").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => ({
  slugIdx: index("marketing_artifacts_slug_idx").on(t.slug),
  dispatchIdx: index("marketing_artifacts_dispatch_idx").on(t.dispatchId),
}));
export type MarketingArtifact = typeof marketingArtifacts.$inferSelect;

// Founder Autopilot — the attribution ledger. A signup attributed (off the
// witnessed marketing_touch chain, never the racy UTM user blob) to a published
// artifact. A LOWER BOUND — absence of a row is absent evidence, never a
// "failure" vote. Founder-dashboard only; never fed to the learning loop in T0.
export const autopilotConversions = pgTable("autopilot_conversions", {
  id: serial("id").primaryKey(),
  artifactId: integer("artifact_id"),
  playId: text("play_id"),
  anonId: text("anon_id"),
  organizationId: integer("organization_id"),
  event: text("event").notNull(), // view | signup | first_value | paid
  attributedAt: timestamp("attributed_at").defaultNow(),
}, (t) => ({
  artifactIdx: index("autopilot_conversions_artifact_idx").on(t.artifactId),
  dedupIdx: uniqueIndex("autopilot_conversions_dedup_uq").on(t.artifactId, t.anonId, t.event),
  orgIdx: index("autopilot_conversions_org_event_idx").on(t.organizationId, t.event),
}));
export type AutopilotConversion = typeof autopilotConversions.$inferSelect;

// ── Autopilot outward perception bus (Hands roadmap P0.2) ───────────────────
// Append-only ledger of senses derived from the OUTSIDE world — the webhooks
// that already land (SendGrid deliverability, Stripe revenue/churn, inbound
// SMS opt-outs) become rows here so the brain (decide.ts) can perceive the
// market it acts on, not just AcreOS's own DB. Each row is one observation:
//   • kind  — the sense channel, e.g. "email_complaint" | "revenue_delta" |
//             "dunning_pressure" | "sms_opt_out" | "churn_signal".
//   • value — a numeric magnitude (count, cents, rate) for that observation.
//   • detail— optional structured context (never PII-bearing credential values).
// Reads aggregate the latest rows per kind within a window (perception.ts);
// writes are best-effort and MUST never break the webhook that emits them.
export const autopilotSenses = pgTable("autopilot_senses", {
  id: serial("id").primaryKey(),
  kind: text("kind").notNull(),
  value: doublePrecision("value").notNull().default(0),
  detail: jsonb("detail"),
  observedAt: timestamp("observed_at").defaultNow(),
}, (t) => ({
  kindObservedIdx: index("autopilot_senses_kind_observed_idx").on(t.kind, t.observedAt),
}));
export type AutopilotSense = typeof autopilotSenses.$inferSelect;

// ── Autopilot objectives (Hands roadmap P5) ─────────────────────────────────
// Structured goals the brain plans toward — the difference between "do sensible
// things" and "move THESE numbers." The founder declares targets in Your Voice;
// the planner weights moves by expected objective movement; the daily letter
// reports progress. `current` is refreshed from real senses (never invented).
//   • key     — stable machine id, e.g. "activated_orgs" | "trial_to_paid_rate".
//   • unit    — count | cents | rate | minutes (how to render + compare).
//   • owningDomain — which autopilot domain is accountable for moving it.
export const autopilotObjectives = pgTable("autopilot_objectives", {
  id: serial("id").primaryKey(),
  key: text("key").notNull(),
  label: text("label").notNull(),
  target: doublePrecision("target").notNull(),
  current: doublePrecision("current").notNull().default(0),
  unit: text("unit").notNull().default("count"),
  owningDomain: text("owning_domain"),
  deadline: timestamp("deadline"),
  active: boolean("active").notNull().default(true),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => ({
  keyIdx: uniqueIndex("autopilot_objectives_key_uq").on(t.key),
}));
export type AutopilotObjective = typeof autopilotObjectives.$inferSelect;

// ── Autopilot founder-scoped pending actions (Elite Vision H1 — execution seam) ─
// The witnessed-send surface for AUTOPILOT actions. When a dispatched agent
// drafts a customer-facing action (send_email, apply_refund, …) and calls the
// hand, the executor FREEZES it here instead of sending — bound to the hand name
// + frozen args + a sha256 content hash + a 24h expiry. The founder approves it
// in /decisions; approval re-verifies the hash and fires executeHandWitnessed
// exactly once (idempotent claim). This is the founder-scoped analogue of the
// org-scoped approvalKernel/pending_actions — same safety contract, different
// approver (the founder/platform, not a customer org).
export const autopilotPendingActions = pgTable("autopilot_pending_actions", {
  id: serial("id").primaryKey(),
  handName: text("hand_name").notNull(),
  args: jsonb("args").notNull(),
  contentHash: text("content_hash").notNull(),
  domain: text("domain"),
  /** Human-readable one-liner of what approval will do (for the /decisions card). */
  summary: text("summary"),
  /** The dispatch that drafted this, for the glass-box trace. */
  sourceDispatchId: integer("source_dispatch_id"),
  status: text("status").notNull().default("pending"), // pending | approved | rejected | executed | expired
  expiresAt: timestamp("expires_at"),
  approvedBy: text("approved_by"),
  executedAt: timestamp("executed_at"),
  resultSummary: jsonb("result_summary"),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => ({
  statusIdx: index("autopilot_pending_actions_status_idx").on(t.status, t.createdAt),
  dedupIdx: index("autopilot_pending_actions_dedup_idx").on(t.handName, t.contentHash, t.status),
}));
export type AutopilotPendingAction = typeof autopilotPendingActions.$inferSelect;

// ── Autopilot witnessed-send audit (Elite Vision H1) ────────────────────────
// Append-only record of every autopilot action the founder approved + that
// executed. INSERT-only by contract (no UPDATE path), mirroring pax_sends.
export const autopilotSends = pgTable("autopilot_sends", {
  id: serial("id").primaryKey(),
  pendingActionId: integer("pending_action_id"),
  handName: text("hand_name").notNull(),
  domain: text("domain"),
  approvedBy: text("approved_by"),
  contentHash: text("content_hash"),
  sentAt: timestamp("sent_at").defaultNow(),
});
export type AutopilotSend = typeof autopilotSends.$inferSelect;

// ── Today decision-queue resolution state (Maren CPO #2) ────────────────────
// The /today Decision Queue is DERIVED — its items are computed each request
// from leads / deals / observations / tasks (server/routes-today.ts). There is
// no row to flip "done" on. This table is the durable resolution ledger: one
// row per (org, synthetic item id) that the operator has acted on inline, so
// the GET payload can subtract resolved/snoozed items and shrink the queue
// toward the rewarding "you're clear for today" zero-state.
//
//   • status "done"      — handled in place; hide permanently.
//   • status "dismissed" — not relevant; hide permanently.
//   • status "snoozed"   — hide until snoozedUntil, then re-surface.
//
// The item id is the SAME synthetic string the queue builder emits
// (e.g. "stale-lead-42", "priority-follow-up"). It is intentionally NOT a FK —
// the underlying entity may be a lead, deal, observation, task, or a purely
// computed priority with no row at all. Leading-org composite index keeps the
// per-tenant subtract a single index probe (Tahoe shard-readiness).
export const todayQueueState = pgTable("today_queue_state", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  // The synthetic decision-item id from the queue builder (not a FK).
  itemId: text("item_id").notNull(),
  // "done" | "dismissed" | "snoozed"
  status: text("status").notNull(),
  // When a snoozed item should re-surface (null for done/dismissed).
  snoozedUntil: timestamp("snoozed_until"),
  resolvedBy: text("resolved_by"), // user id that acted, for audit
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgItemIdx: uniqueIndex("today_queue_state_org_item_idx").on(table.organizationId, table.itemId),
}));

export const insertTodayQueueStateSchema = createInsertSchema(todayQueueState).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type TodayQueueState = typeof todayQueueState.$inferSelect;
export type InsertTodayQueueState = z.infer<typeof insertTodayQueueStateSchema>;

// ── 0142 — Beatrice (CRO) — OFAC/sanctions advisory screening results ───────
// Records the outcome of an ADVISORY name-screen of a counterparty (a lead /
// borrower / seller) against an OFAC SDN-style sanctions list. This is NOT a
// legal determination and NOT a block — a `potential_match` raises a
// founder-visible flag for MANUAL review; the originating action (e.g. lead
// creation) always proceeds.
//
// One row per (counterparty × screen). The screen is fuzzy: `matchScore` is a
// 0..1 normalized-name similarity; `result` is the bucketed decision. When
// `result='potential_match'` we persist the matched SDN entry's display name +
// program so a human can adjudicate without re-running the screen. We never
// persist more counterparty PII than the screened name itself.
//
// Founder-visible flag = a row where `result='potential_match'` AND
// `reviewedAt IS NULL`. Reviewing it (clearing / confirming) stamps
// `reviewedAt` + `reviewedBy` + `reviewDisposition`.
//
// Mirrors scripts/migrate.mjs STATEMENTS + migrations/0142_sanctions_screenings.sql.
export const sanctionsScreenings = pgTable("sanctions_screenings", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id")
    .references(() => organizations.id, { onDelete: "cascade" })
    .notNull(),
  // What kind of counterparty was screened + its id in its own table.
  // Not a FK — the subject may be a lead, borrower, contact, or an ad-hoc
  // name with no row at all (e.g. a deal counterparty typed by hand).
  subjectType: text("subject_type").notNull(), // "lead" | "borrower" | "contact" | "ad_hoc"
  subjectId: text("subject_id"), // string id of the subject row, or null for ad_hoc
  // The screened name AS PRESENTED (display only). The match itself runs on a
  // normalized form; we keep the raw name so a reviewer sees what was checked.
  screenedName: text("screened_name").notNull(),
  // Bucketed advisory outcome. NOT a legal determination.
  //   "clear"           — no entry scored above the match threshold.
  //   "potential_match" — at least one entry scored above the threshold;
  //                       requires MANUAL human review.
  //   "error"           — the screen could not complete (engine/data error).
  result: text("result").notNull(),
  // 0..1 best-match similarity score (highest across all candidate entries).
  matchScore: real("match_score").notNull().default(0),
  // The matched SDN-style entry, when result='potential_match'. Display name +
  // program (e.g. "SDN", "SDGT") + the list source identifier.
  matchedEntryName: text("matched_entry_name"),
  matchedEntryProgram: text("matched_entry_program"),
  listSource: text("list_source").notNull().default("bundled-fixture"),
  // Snapshot of the engine for reproducibility / audit.
  engineVersion: text("engine_version").notNull().default("v1"),
  threshold: real("threshold").notNull(),
  // Human review of a potential match. Null until a human acts.
  reviewedAt: timestamp("reviewed_at"),
  reviewedBy: text("reviewed_by"),
  // "false_positive" | "confirmed_match" | "inconclusive"
  reviewDisposition: text("review_disposition"),
  reviewNotes: text("review_notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  // Lead with organization_id (Tahoe shard-readiness — leading-org composite).
  byOrgCreated: index("sanctions_screenings_org_created_idx").on(
    table.organizationId,
    table.createdAt,
  ),
  // Founder-flag lookup: open potential matches per org, newest first.
  byOrgResult: index("sanctions_screenings_org_result_idx").on(
    table.organizationId,
    table.result,
    table.reviewedAt,
  ),
}));

export const insertSanctionsScreeningSchema = createInsertSchema(sanctionsScreenings).omit({
  id: true,
  createdAt: true,
});
export type SanctionsScreening = typeof sanctionsScreenings.$inferSelect;
export type InsertSanctionsScreening = z.infer<typeof insertSanctionsScreeningSchema>;

// ── 0144 — Beatrice (CRO) — OFAC sanctions LIST ENTRIES (live cached copy) ───
// The live, cleartext OFAC reference list that BACKS the advisory fuzzy
// name-matcher (server/services/compliance/ofacScreening.ts). Refreshed daily
// from the public U.S. Treasury data files (SDN + Consolidated) by
// server/services/compliance/sanctionsListSync.ts.
//
// GLOBAL / COMPANY-WIDE reference table — intentionally NOT org-scoped (there
// is NO organization_id). It is the same public Treasury list for every org,
// so the check-org-leading-index gate exempts it (a reference/global table has
// no tenant to lead a composite index with). This is distinct from
// `sanctions_list` (the hash-only signup gate) — a fuzzy matcher needs the
// cleartext names that this table stores.
//
// ADVISORY framing: a row here is a public Treasury list entry, not a legal
// determination. The screener flags potential matches for MANUAL review and
// surfaces "list current as of `listPublishedAt`" provenance; it never blocks.
//
// Mirrors scripts/migrate.mjs STATEMENTS + migrations/0144_sanctions_list_entries.sql.
export const sanctionsListEntries = pgTable("sanctions_list_entries", {
  id: serial("id").primaryKey(),
  // Which Treasury list this row came from: "SDN" | "CONSOLIDATED".
  sourceList: text("source_list").notNull(),
  // OFAC entity classification: "individual" | "entity" | "vessel" | "aircraft".
  entityType: text("entity_type").notNull(),
  // Primary display name exactly as published by Treasury.
  primaryName: text("primary_name").notNull(),
  // Normalized form (NFKD + lowercase + sorted token set) used for matching.
  // Mirrors normalizeName() in ofacScreening.ts so indexed lookups align.
  normalizedName: text("normalized_name").notNull(),
  // AKA / alternate names (jsonb array of strings).
  aliases: jsonb("aliases").$type<string[]>().notNull().default([]),
  // OFAC program code(s), e.g. ["SDNTK","IRAN"] (jsonb array of strings).
  programs: jsonb("programs").$type<string[]>().notNull().default([]),
  // Addresses / countries associated with the entry (jsonb array of objects).
  addresses: jsonb("addresses").$type<Array<Record<string, string>>>().notNull().default([]),
  // Free-text remarks from the Treasury record.
  remarks: text("remarks"),
  // Treasury's stable unique identifier for the entry (ent_num / uid).
  ofacUid: text("ofac_uid").notNull(),
  // When the Treasury list itself was published (provenance for "current as of").
  listPublishedAt: timestamp("list_published_at"),
  // When THIS row was last upserted from the live fetch.
  fetchedAt: timestamp("fetched_at").notNull().defaultNow(),
}, (table) => ({
  // GLOBAL reference table — no organization_id, so NO org-leading composite
  // index here (exempt from scripts/check-org-leading-index.mjs by design).
  // Match path: normalized_name lookup.
  byNormalizedName: index("sanctions_list_entries_normalized_name_idx").on(
    table.normalizedName,
  ),
  // Idempotent upsert key: one row per (list, OFAC uid).
  bySourceUid: uniqueIndex("sanctions_list_entries_source_uid_idx").on(
    table.sourceList,
    table.ofacUid,
  ),
}));

export const insertSanctionsListEntrySchema = createInsertSchema(sanctionsListEntries).omit({
  id: true,
  fetchedAt: true,
});
export type SanctionsListEntry = typeof sanctionsListEntries.$inferSelect;
export type InsertSanctionsListEntry = z.infer<typeof insertSanctionsListEntrySchema>;

// ── 0195 — DNC / litigator scrub results (TCPA cold-outreach seam) ──────────
// Cached outcome of scrubbing a PHONE NUMBER against a Do-Not-Call registry
// and/or a known-TCPA-litigator list via a pluggable vendor adapter
// (server/services/compliance/dncScrub.ts). The vendor decision is a pending
// founder call (roadmap-2026-07 "Founder decisions" #1); until a vendor is
// configured the seam is INERT (gate allows, `scrubbed:false`) and this table
// simply stays empty. Once configured:
//   • `litigator`  — always blocks outbound SMS/calls, even with consent.
//   • `dnc_listed` — blocks unless the lead carries express TCPA consent
//                    (express consent lawfully overrides registry listing).
//   • scrub ERROR on a lead-matched marketing send — FAIL CLOSED (block);
//     on unmatched/transactional traffic — fail open (billing must flow).
// Rows expire (`expiresAt`) because DNC lists demand periodic re-scrub
// (the federal SAN convention is every 31 days).
//
// Mirrors scripts/migrate.mjs STATEMENTS + migrations/0195_dnc_scrub_results.sql.
export const dncScrubResults = pgTable("dnc_scrub_results", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id")
    .references(() => organizations.id, { onDelete: "cascade" })
    .notNull(),
  // Normalized digits of the scrubbed number (last 10, US-centric — matches
  // the lead-matching convention in smsService.tcpaGateForRecipient).
  phoneLast10: text("phone_last10").notNull(),
  // "clean" | "dnc_listed" | "litigator". Transient scrub ERRORS are never
  // cached — they must re-run, not poison the cache.
  status: text("status").notNull(),
  // Which vendor adapter produced the result ("fixture" | vendor name).
  provider: text("provider").notNull(),
  // Vendor's list identifier (e.g. "federal-dnc", "litigator-v3"), if given.
  listSource: text("list_source"),
  // Vendor's stated reason/detail for a listing, if given.
  reason: text("reason"),
  scrubbedAt: timestamp("scrubbed_at").notNull().defaultNow(),
  // Scrub validity window — re-scrub after this (default 30 days).
  expiresAt: timestamp("expires_at").notNull(),
}, (table) => ({
  // Lead with organization_id (Tahoe shard-readiness — leading-org composite).
  // Gate lookup path: latest un-expired scrub for (org, phone).
  byOrgPhone: index("dnc_scrub_results_org_phone_idx").on(
    table.organizationId,
    table.phoneLast10,
    table.scrubbedAt,
  ),
}));

export const insertDncScrubResultSchema = createInsertSchema(dncScrubResults).omit({
  id: true,
  scrubbedAt: true,
});
export type DncScrubResult = typeof dncScrubResults.$inferSelect;
export type InsertDncScrubResult = z.infer<typeof insertDncScrubResultSchema>;

// ── 0196 — Authority delegations (temporary authority elevations) ───────────
// "Let Sophie handle all support without asking me until Friday." Previously a
// module-level Map — on 2+ Fly machines a grant made on the app machine was
// INVISIBLE to the authority gate running on the worker (where autonomous
// execution actually happens) and vanished on every deploy. DB-backed so the
// gate reads the same truth everywhere (module-state audit, 2026-07-07).
//
// GLOBAL / founder-level table — delegations elevate PLATFORM agents
// (companyAgents), not org data, so there is intentionally no organization_id
// (exempt from the org-leading-index gate like sanctions_list_entries).
// Active = revoked_at IS NULL AND expires_at > now().
//
// Mirrors scripts/migrate.mjs STATEMENTS + migrations/0196_agent_state_persistence.sql.
export const authorityDelegations = pgTable("authority_delegations", {
  id: serial("id").primaryKey(),
  agentCodename: text("agent_codename").notNull(),
  // Actions elevated by this delegation; ["*"] means all actions.
  elevatedActions: jsonb("elevated_actions").$type<string[]>().notNull().default(["*"]),
  fromLevel: integer("from_level").notNull().default(2),
  // Elevated authority level (0 = full autonomy).
  toLevel: integer("to_level").notNull().default(0),
  reason: text("reason").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  revokedAt: timestamp("revoked_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  // Gate lookup path: active delegations for an agent.
  byAgentExpires: index("authority_delegations_agent_expires_idx").on(
    table.agentCodename,
    table.expiresAt,
  ),
}));

export type AuthorityDelegation = typeof authorityDelegations.$inferSelect;

// ── 0196 — Agent execution counts (autonomous-action rate throttle) ─────────
// Hourly action counters backing executionEngine's safety throttle
// (100/hr global, 30/hr/agent). Previously a module-level Map — each machine
// kept its own counter, so the effective cap was N× the configured cap and
// the throttle silently didn't throttle. Single-statement upsert
// (INSERT … ON CONFLICT … count+1 RETURNING) keeps it race-free across
// machines (module-state audit, 2026-07-07).
//
// GLOBAL table — the throttle caps PLATFORM agents, not org traffic; no
// organization_id by design. Rows are garbage-collected opportunistically
// (buckets older than 2h).
//
// Mirrors scripts/migrate.mjs STATEMENTS + migrations/0196_agent_state_persistence.sql.
export const agentExecutionCounts = pgTable("agent_execution_counts", {
  id: serial("id").primaryKey(),
  // "__global__" or the agent codename.
  agentKey: text("agent_key").notNull(),
  bucketStart: timestamp("bucket_start").notNull(),
  count: integer("count").notNull().default(0),
}, (table) => ({
  byKeyBucket: uniqueIndex("agent_execution_counts_key_bucket_idx").on(
    table.agentKey,
    table.bucketStart,
  ),
}));

export type AgentExecutionCount = typeof agentExecutionCounts.$inferSelect;

// Revenue Protection Interventions — automated churn/dunning outreach log
export const revenueProtectionInterventions = pgTable("revenue_protection_interventions", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  interventionType: text("intervention_type").notNull(), // checkin_email | retention_offer | dunning_recovery | founder_decision
  triggerRiskScore: integer("trigger_risk_score").notNull(),
  triggerRiskBand: text("trigger_risk_band").notNull(),
  executedBy: text("executed_by").notNull().default("sophie"),
  sophieMessageSubject: text("sophie_message_subject"),
  sophieMessageBody: text("sophie_message_body"),
  emailSentAt: timestamp("email_sent_at"),
  emailDeliveryStatus: text("email_delivery_status"),
  outcome: text("outcome"), // pending | customer_responded | payment_recovered | churned | no_response
  outcomeRecordedAt: timestamp("outcome_recorded_at"),
  revenueRecoveredCents: integer("revenue_recovered_cents"),
  decisionsInboxItemId: integer("decisions_inbox_item_id").references(() => decisionsInboxItems.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("rev_protection_org_idx").on(table.organizationId),
  index("rev_protection_type_idx").on(table.interventionType),
  index("rev_protection_created_idx").on(table.createdAt),
]);

export const insertRevenueProtectionInterventionSchema = createInsertSchema(revenueProtectionInterventions).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertRevenueProtectionIntervention = z.infer<typeof insertRevenueProtectionInterventionSchema>;
export type RevenueProtectionIntervention = typeof revenueProtectionInterventions.$inferSelect;

// Founder Digest History — daily automated briefing records
export const founderDigestHistory = pgTable("founder_digest_history", {
  id: serial("id").primaryKey(),
  digestDate: timestamp("digest_date").notNull(),
  deliveredAt: timestamp("delivered_at"),
  deliveryStatus: text("delivery_status").notNull().default("pending"),
  revenueBullet: text("revenue_bullet"),
  systemHealthBullet: text("system_health_bullet"),
  supportActivityBullet: text("support_activity_bullet"),
  topAtRiskBullet: text("top_at_risk_bullet"),
  recommendedActionBullet: text("recommended_action_bullet"),
  dataSnapshot: jsonb("data_snapshot").$type<Record<string, any>>(),
  mrrCents: integer("mrr_cents"),
  openDecisions: integer("open_decisions"),
  sophieAutoResolved24h: integer("sophie_auto_resolved_24h"),
  jobFailures24h: integer("job_failures_24h"),
  atRiskOrgs: integer("at_risk_orgs"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("founder_digest_date_idx").on(table.digestDate),
  index("founder_digest_status_idx").on(table.deliveryStatus),
]);

export const insertFounderDigestHistorySchema = createInsertSchema(founderDigestHistory).omit({ id: true, createdAt: true });
export type InsertFounderDigestHistory = z.infer<typeof insertFounderDigestHistorySchema>;
export type FounderDigestHistory = typeof founderDigestHistory.$inferSelect;

// Agent memory notes — per-agent weekly consolidation of learned
// patterns, wins, losses, and self-recommendations. Acts as the
// long-term memory complement to Company Mind's 14-day cross-wing
// context. Each note is one LLM call summarizing the agent's recent
// activity; notes accumulate as the agent's wisdom over time.
export const agentMemoryNotes = pgTable("agent_memory_notes", {
  id: serial("id").primaryKey(),
  agentCodename: text("agent_codename").notNull(),
  weekKey: text("week_key").notNull(),
  patternsLearned: text("patterns_learned").notNull(), // short-form prose
  wins: jsonb("wins").$type<string[]>().default([]),
  losses: jsonb("losses").$type<string[]>().default([]),
  selfRecommendations: text("self_recommendations"), // what the agent advises itself to do next week
  decisionsAnalyzed: integer("decisions_analyzed").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("agent_memory_notes_agent_idx").on(table.agentCodename, table.createdAt),
  index("agent_memory_notes_week_idx").on(table.weekKey),
]);

export type AgentMemoryNote = typeof agentMemoryNotes.$inferSelect;

// Provider lookup log — a row per external-data call. Powers
// per-provider success-rate scoring so the registry can prefer the
// provider that's been answering this query-type well lately, within
// the same tier+cost bracket.
export const providerLookupLog = pgTable("provider_lookup_log", {
  id: serial("id").primaryKey(),
  providerName: text("provider_name").notNull(),
  category: text("category").notNull(),
  inputType: text("input_type").notNull(),
  success: boolean("success").notNull(),
  cached: boolean("cached").notNull().default(false),
  latencyMs: integer("latency_ms"),
  costCents: integer("cost_cents").default(0),
  errorCode: text("error_code"),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  // Free-miss-by-county telemetry (migration 0120) — lets the paid-data buy
  // decision be data-driven: where are free misses concentrated?
  state: text("state"),
  county: text("county"),
  // Cache telemetry (migration 0152, Tier 2A) — cache hits used to early-return
  // before any telemetry write, making the hit rate (and the dollars the cache
  // saves) invisible. cacheLane names which of the four cache lanes served the
  // hit: "provider_cache" | "provider_cache_stale" | "parcel_snapshots" |
  // "cached_lookups". avoidedCostCents is the provider cost the hit avoided —
  // only when the original cost is actually KNOWN (0 otherwise; never invented).
  cacheLane: text("cache_lane"),
  avoidedCostCents: integer("avoided_cost_cents").default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("provider_lookup_provider_idx").on(table.providerName, table.createdAt),
  index("provider_lookup_category_idx").on(table.category, table.createdAt),
  index("provider_lookup_created_idx").on(table.createdAt),
  index("provider_lookup_county_idx").on(table.state, table.county, table.category),
  index("provider_lookup_cache_lane_idx").on(table.cacheLane, table.createdAt),
]);

export type ProviderLookupLog = typeof providerLookupLog.$inferSelect;

// Model calibration log (migration 0152, Tier 2A) — persisted snapshots of
// learned model weights. The LCS calibrator (server/services/lcsCalibrator.ts)
// kept its EMA-adjusted per-org dimension weights in in-memory Maps, so every
// deploy erased everything the calibration loop had learned. Each adjusted
// calibration run appends one row here; the latest row per (org, model) is the
// live weight set loaded on first use after a deploy. Append-only by
// convention — history doubles as the calibration audit trail.
export const modelCalibrationLog = pgTable("model_calibration_log", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  modelName: text("model_name").notNull().default("lcs_calibrator"),
  weights: jsonb("weights").$type<Record<string, number>>().notNull(),
  correlations: jsonb("correlations").$type<Record<string, number>>(),
  sampleSize: integer("sample_size").notNull().default(0),
  adjusted: boolean("adjusted").notNull().default(false),
  reason: text("reason"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("model_calibration_log_org_idx").on(table.organizationId, table.modelName, table.createdAt),
]);

export type ModelCalibrationLog = typeof modelCalibrationLog.$inferSelect;
export type InsertModelCalibrationLog = typeof modelCalibrationLog.$inferInsert;

// ── Per-source synthetic-probe health (Tess SRE item 2, migration 0122) ──────
// The free data sources ARE the product, but a 200 OK from a MapServer root
// does NOT prove a real flood-zone lookup still works (schemas drift, layers
// get renumbered). The dataSourceProbe job runs golden parcels through the
// registry every ~30m and asserts the *shape + a plausible value*, writing the
// pass/fail + measured latency here. This is the canary that turns "the county
// changed their API" from a customer ticket into a founder alert. Global infra
// (no organization_id) — the leading-org-index lint correctly skips it.
export const providerHealth = pgTable("provider_health", {
  id: serial("id").primaryKey(),
  // Probe identity: the registry provider name (e.g. "open-data", "county-gis")
  // and the golden parcel / category exercised.
  source: text("source").notNull(),
  category: text("category").notNull(),
  // Label of the golden fixture probed, e.g. "travis-tx-flood".
  probe: text("probe").notNull(),
  healthy: boolean("healthy").notNull(),
  latencyMs: integer("latency_ms"),
  // Why it failed (shape mismatch / implausible value / error) — short string.
  detail: text("detail"),
  checkedAt: timestamp("checked_at").notNull().defaultNow(),
}, (table) => [
  index("provider_health_source_idx").on(table.source, table.checkedAt),
  index("provider_health_checked_idx").on(table.checkedAt),
]);

export type ProviderHealth = typeof providerHealth.$inferSelect;
export type InsertProviderHealth = typeof providerHealth.$inferInsert;

// Decision experiments — A/B test at the agent-decision layer.
// Not UI A/B tests; these split how agents *decide* for different
// organizations. Example: half of past-due customers get 7-day
// dunning, half get 10-day, measure which recovers more.
export const decisionExperiments = pgTable("decision_experiments", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description").notNull(),
  category: text("category").notNull(), // dunning | onboarding_step | nudge | upsell_offer | custom
  itemType: text("item_type"), // decisionsInboxItems.itemType this hooks into
  variants: jsonb("variants").$type<Array<{
    key: string;           // e.g. "retry_7d", "retry_10d"
    label: string;
    weight: number;        // 0-100 percentage; variants sum to 100
    config: Record<string, any>; // variant-specific params
  }>>().notNull(),
  successMetric: text("success_metric").notNull(), // "outcome_score_positive" | "conversion" | "custom"
  status: text("status").notNull().default("draft"), // draft | running | paused | completed | aborted
  winningVariant: text("winning_variant"),
  founderNotes: text("founder_notes"),
  startedAt: timestamp("started_at"),
  endedAt: timestamp("ended_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("decision_experiments_status_idx").on(table.status),
  index("decision_experiments_category_idx").on(table.category),
  index("decision_experiments_item_type_idx").on(table.itemType),
]);

export type DecisionExperiment = typeof decisionExperiments.$inferSelect;

// Per-(experiment, org) variant assignment. Deterministic via hash
// so the same org always gets the same variant for a given experiment.
export const decisionExperimentAssignments = pgTable("decision_experiment_assignments", {
  id: serial("id").primaryKey(),
  experimentId: integer("experiment_id").notNull().references(() => decisionExperiments.id, { onDelete: "cascade" }),
  organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  variantKey: text("variant_key").notNull(),
  assignedAt: timestamp("assigned_at").notNull().defaultNow(),
  outcomeRecorded: boolean("outcome_recorded").notNull().default(false),
  outcomeValue: integer("outcome_value"), // raw metric (e.g. outcomeScore)
  outcomeAt: timestamp("outcome_at"),
}, (table) => [
  index("dea_experiment_org_unique").on(table.experimentId, table.organizationId),
  index("dea_experiment_idx").on(table.experimentId),
  index("dea_variant_idx").on(table.variantKey),
]);

export type DecisionExperimentAssignment = typeof decisionExperimentAssignments.$inferSelect;

// Expansion candidates — weekly-computed list of customers who look
// ready to upgrade, with a composite readiness score and the specific
// signals that qualify them. Founder approves → upgrade offer goes
// out (wrapped by SIMULATION_MODE in sim runs).
export const expansionCandidates = pgTable("expansion_candidates", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  weekKey: text("week_key").notNull(),
  currentTier: text("current_tier").notNull(),
  proposedTier: text("proposed_tier").notNull(),
  score: integer("score").notNull(), // 0-100 composite readiness
  signals: jsonb("signals").$type<Record<string, any>>().notNull(),
  reasoning: text("reasoning").notNull(),
  estimatedMrrLiftCents: integer("estimated_mrr_lift_cents"),
  status: text("status").notNull().default("proposed"), // proposed | approved | rejected | offered | converted | declined
  founderNotes: text("founder_notes"),
  resolvedAt: timestamp("resolved_at"),
  resolvedBy: text("resolved_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("expansion_candidates_week_idx").on(table.weekKey),
  index("expansion_candidates_status_idx").on(table.status),
  index("expansion_candidates_org_idx").on(table.organizationId),
  index("expansion_candidates_score_idx").on(table.score),
]);

export type ExpansionCandidate = typeof expansionCandidates.$inferSelect;

// Onboarding journeys — per-org 30-day scripted activation sequence
// owned by Sophie. One journey per organization (unique), tracking
// activation status. The single biggest conversion lever in SaaS:
// instead of "sign up and figure it out," every Land Investor
// walks a defined path with checkpoints at 7/14/30 days.
export const onboardingJourneys = pgTable("onboarding_journeys", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().unique().references(() => organizations.id, { onDelete: "cascade" }),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  currentStepKey: text("current_step_key").notNull().default("day0_welcome"),
  activationStatus: text("activation_status").notNull().default("pending"), // pending | active | at_risk | churned | completed
  activationDeterminedAt: timestamp("activation_determined_at"),
  firstDealAt: timestamp("first_deal_at"),
  firstLeadAddedAt: timestamp("first_lead_added_at"),
  founderFlag: text("founder_flag"), // null | "watch" | "escalate"
  notes: jsonb("notes").$type<Record<string, any>>().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("onboarding_journeys_status_idx").on(table.activationStatus),
  index("onboarding_journeys_started_at_idx").on(table.startedAt),
]);

export type OnboardingJourney = typeof onboardingJourneys.$inferSelect;

// Per-step execution log. Scheduled ahead by the journey starter,
// fired by the daily cron when the scheduledAt threshold is crossed.
export const onboardingSteps = pgTable("onboarding_steps", {
  id: serial("id").primaryKey(),
  journeyId: integer("journey_id").notNull().references(() => onboardingJourneys.id, { onDelete: "cascade" }),
  stepKey: text("step_key").notNull(),
  scheduledAt: timestamp("scheduled_at").notNull(),
  firedAt: timestamp("fired_at"),
  status: text("status").notNull().default("scheduled"), // scheduled | fired | skipped | failed
  outcome: jsonb("outcome").$type<Record<string, any>>().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("onboarding_steps_journey_idx").on(table.journeyId),
  index("onboarding_steps_scheduled_at_idx").on(table.scheduledAt),
  index("onboarding_steps_status_idx").on(table.status),
]);

export type OnboardingStep = typeof onboardingSteps.$inferSelect;

// Customer letters — per-org monthly narrative mirroring the
// founder letter. Written by Sophie (CSM agent) voice. One row per
// (organizationId, monthKey). The customer-facing primary surface
// for recurring engagement.
export const customerLetters = pgTable("customer_letters", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  monthKey: text("month_key").notNull(),
  letterMarkdown: text("letter_markdown").notNull(),
  summaryJson: jsonb("summary_json").$type<Record<string, any>>().notNull(),
  recommendedAction: text("recommended_action"),
  generatedAt: timestamp("generated_at").notNull().defaultNow(),
  deliveredAt: timestamp("delivered_at"),
  openedAt: timestamp("opened_at"),
  status: text("status").notNull().default("draft"), // draft | delivered | opened | archived
}, (table) => [
  index("customer_letters_org_month_idx").on(table.organizationId, table.monthKey),
  index("customer_letters_status_idx").on(table.status),
]);

export type CustomerLetter = typeof customerLetters.$inferSelect;

// Tool proposals — agents (or the strategic synthesis pass) propose
// new integrations / data sources / capabilities the company needs
// to operate better. Always founder-gated.
export const toolProposals = pgTable("tool_proposals", {
  id: serial("id").primaryKey(),
  proposedBy: text("proposed_by").notNull(), // agent codename or 'synthesis'
  title: text("title").notNull(),
  description: text("description").notNull(),
  category: text("category").notNull(), // integration | data_source | capability | rubric
  capabilityGap: text("capability_gap").notNull(), // what's missing today
  expectedBenefit: text("expected_benefit").notNull(),
  estimatedComplexity: text("estimated_complexity").notNull().default("medium"), // low | medium | high
  estimatedImpactCents: integer("estimated_impact_cents"),
  supportingEvidence: jsonb("supporting_evidence").$type<Record<string, any>>(),
  status: text("status").notNull().default("proposed"), // proposed | approved | rejected | building | shipped
  founderNotes: text("founder_notes"),
  resolvedAt: timestamp("resolved_at"),
  resolvedBy: text("resolved_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("tool_proposals_status_idx").on(table.status),
  index("tool_proposals_category_idx").on(table.category),
  index("tool_proposals_proposed_by_idx").on(table.proposedBy),
]);

export type ToolProposal = typeof toolProposals.$inferSelect;

// Action previews — every auto-approved executor action writes a
// preview row that records WHAT was about to happen, WHY, and gives
// the founder a cancel-before-commit window (0 by default, tunable
// via settings). Also works as a permanent audit trail of
// autonomous side effects.
export const actionPreviews = pgTable("action_previews", {
  id: serial("id").primaryKey(),
  decisionId: integer("decision_id"),
  agentCodename: text("agent_codename").notNull(),
  itemType: text("item_type").notNull(),
  actionSummary: text("action_summary").notNull(),  // plain-English
  actionReasoning: text("action_reasoning"),
  actionPayload: jsonb("action_payload").$type<Record<string, any>>(),
  estimatedImpactCents: integer("estimated_impact_cents"),
  confidence: integer("confidence"),
  plannedAt: timestamp("planned_at").notNull().defaultNow(),
  commitAt: timestamp("commit_at").notNull(), // when the window closes
  committedAt: timestamp("committed_at"),
  cancelledAt: timestamp("cancelled_at"),
  cancelledBy: text("cancelled_by"),
  cancelReason: text("cancel_reason"),
  status: text("status").notNull().default("pending"), // pending | committed | cancelled | failed
  executionResult: text("execution_result"),
}, (table) => [
  index("action_previews_status_idx").on(table.status),
  index("action_previews_commit_at_idx").on(table.commitAt),
  index("action_previews_decision_idx").on(table.decisionId),
  index("action_previews_agent_idx").on(table.agentCodename),
]);

export type ActionPreview = typeof actionPreviews.$inferSelect;

// Founder settings — editable operational knobs. Simple key-value
// store so adding a new tunable doesn't require a migration. The
// service layer reads this first, falls back to process.env, then
// falls back to a hardcoded default.
export const founderSettings = pgTable("founder_settings", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  value: text("value").notNull(),
  valueType: text("value_type").notNull().default("string"), // string | number | boolean | json
  description: text("description"),
  category: text("category").notNull().default("general"), // safety | learning | scheduling | general
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  updatedBy: text("updated_by"),
}, (table) => [
  index("founder_settings_key_idx").on(table.key),
  index("founder_settings_category_idx").on(table.category),
]);

export type FounderSetting = typeof founderSettings.$inferSelect;

// Strategic proposals — proactive "what should we do this month"
// layer. Agents generate weekly proposals; a monthly synthesis step
// picks the top 3-5 and stamps them with a monthKey for the founder
// letter's "Next month's focus" section.
export const strategicProposals = pgTable("strategic_proposals", {
  id: serial("id").primaryKey(),
  proposedBy: text("proposed_by").notNull(), // agent codename or 'synthesis'
  weekKey: text("week_key").notNull(),       // YYYY-WW ISO week
  monthKey: text("month_key"),               // YYYY-MM when synthesized
  title: text("title").notNull(),
  rationale: text("rationale").notNull(),
  estimatedImpactCents: integer("estimated_impact_cents"),
  confidence: integer("confidence").notNull().default(50), // 0-100
  category: text("category").notNull(),      // revenue | retention | product | ops | risk
  supportingDataKeys: jsonb("supporting_data_keys").$type<string[]>().default([]),
  status: text("status").notNull().default("proposed"), // proposed | synthesized | approved | rejected | executed | deferred
  founderFeedback: text("founder_feedback"),
  resolvedAt: timestamp("resolved_at"),
  resolvedBy: text("resolved_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("strategic_proposals_week_idx").on(table.weekKey),
  index("strategic_proposals_month_idx").on(table.monthKey),
  index("strategic_proposals_status_idx").on(table.status),
  index("strategic_proposals_proposed_by_idx").on(table.proposedBy),
]);

export type StrategicProposal = typeof strategicProposals.$inferSelect;

// Monthly founder letter — narrative interface replacing the dashboard
// as primary surface for the "1 hour/month" founder operation. One row
// per month, regeneratable until delivered.
export const founderLetters = pgTable("founder_letters", {
  id: serial("id").primaryKey(),
  monthKey: text("month_key").notNull().unique(), // YYYY-MM
  letterMarkdown: text("letter_markdown").notNull(),
  summaryJson: jsonb("summary_json").$type<Record<string, any>>().notNull(),
  pendingFounderDecision: text("pending_founder_decision"), // the one thing to decide
  generatedAt: timestamp("generated_at").notNull().defaultNow(),
  deliveredAt: timestamp("delivered_at"),
  status: text("status").notNull().default("draft"), // draft | delivered | archived
}, (table) => [
  index("founder_letters_month_idx").on(table.monthKey),
  index("founder_letters_status_idx").on(table.status),
]);

export type FounderLetter = typeof founderLetters.$inferSelect;

// Platform Config — encrypted key-value store for founder-managed credentials
// Values are AES-256 encrypted at rest. The configManager service merges these
// into process.env at startup so all existing code continues to work unchanged.
export const platformConfig = pgTable("platform_config", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),           // e.g. "STRIPE_SECRET_KEY"
  encryptedValue: text("encrypted_value"),        // AES-256-GCM encrypted, null = delete
  service: text("service").notNull(),             // e.g. "stripe" | "aws" | "openrouter"
  label: text("label").notNull(),                 // Human-readable label
  isSecret: boolean("is_secret").notNull().default(true),
  isRequired: boolean("is_required").notNull().default(false),
  validatedAt: timestamp("validated_at"),         // last time this credential was verified OK
  validationStatus: text("validation_status"),    // "ok" | "error" | null
  validationMessage: text("validation_message"),
  updatedAt: timestamp("updated_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("platform_config_key_idx").on(table.key),
  index("platform_config_service_idx").on(table.service),
]);

export const insertPlatformConfigSchema = createInsertSchema(platformConfig).omit({ id: true, createdAt: true });
export type InsertPlatformConfig = z.infer<typeof insertPlatformConfigSchema>;
export type PlatformConfig = typeof platformConfig.$inferSelect;

// ============================================
// PLATFORM FEATURE FLAGS (Founder-controlled feature visibility)
// ============================================

/**
 * Feature flag state machine (design-system §8). 5 possible states:
 *   off            — invisible everywhere; routes 404, sidebar hides, APIs reject
 *   founder-only   — only the founder sees / hits
 *   beta           — opted-in users (audience.betaUserIds)
 *   tier:<X>       — subscription-gated (X = free | starter | pro | scale)
 *   on             — live for everyone
 *
 * `enabled` boolean kept for back-compat with pre-port consumers; derive
 * from `state IN ('on', ...)` at read time when migrating call sites.
 */
export const FEATURE_FLAG_STATES = [
  "off",
  "founder-only",
  "beta",
  "tier:free",
  "tier:starter",
  "tier:pro",
  "tier:scale",
  "on",
] as const;
export type FeatureFlagState = typeof FEATURE_FLAG_STATES[number];

export interface FeatureFlagAudience {
  betaUserIds?: string[];
  // Future: orgIds, region, percent rollout, etc.
}

export const platformFeatureFlags = pgTable("platform_feature_flags", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),            // e.g. "feature.autonomy-matrix"
  label: text("label").notNull(),                  // human-readable name
  description: text("description").notNull(),
  enabled: boolean("enabled").notNull().default(false), // back-compat — derived from state
  state: text("state").default("off"),             // FeatureFlagState — canonical post-port
  audience: jsonb("audience").$type<FeatureFlagAudience>().default({}),
  changedBy: text("changed_by"),                   // userId of last editor
  changedAt: timestamp("changed_at"),
  // which nav items this flag controls (JSON array of hrefs like ["/academy"])
  controlledRoutes: jsonb("controlled_routes").$type<string[]>().notNull().default([]),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertPlatformFeatureFlagSchema = createInsertSchema(platformFeatureFlags).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type PlatformFeatureFlag = typeof platformFeatureFlags.$inferSelect;
export type InsertPlatformFeatureFlag = z.infer<typeof insertPlatformFeatureFlagSchema>;

// ============================================
// PRICING CONFIG (Founder-controlled pricing + promotions)
// ============================================

export const pricingConfig = pgTable("pricing_config", {
  id: serial("id").primaryKey(),
  tier: text("tier").notNull().unique(),           // 'pro', 'growth', 'enterprise'
  displayPriceMonthly: integer("display_price_monthly").notNull(), // cents
  displayPriceYearly: integer("display_price_yearly").notNull(),   // cents (per month, billed annually)
  // Active promotion (null = no promo)
  promoLabel: text("promo_label"),                 // e.g. "Spring Sale"
  promoDiscountPercent: integer("promo_discount_percent"), // 0-100
  promoEndsAt: timestamp("promo_ends_at"),
  // Stripe coupon ID (created on-the-fly when promo is set)
  stripeCouponId: text("stripe_coupon_id"),
  // Allow user-entered promo codes at checkout
  allowPromoCodes: boolean("allow_promo_codes").notNull().default(false),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertPricingConfigSchema = createInsertSchema(pricingConfig).omit({
  id: true, updatedAt: true,
});
export type PricingConfig = typeof pricingConfig.$inferSelect;
export type InsertPricingConfig = z.infer<typeof insertPricingConfigSchema>;

// ============================================
// GROWTH / AD MARKETING (AcreOS own customer acquisition)
// ============================================

// Stores founder-level Meta ad account credentials for AcreOS growth campaigns
export const founderAdAccounts = pgTable("founder_ad_accounts", {
  id: serial("id").primaryKey(),
  platform: text("platform").notNull().default("meta"), // 'meta' | 'google'
  adAccountId: text("ad_account_id").notNull(),
  accessToken: text("access_token").notNull(),
  pixelId: text("pixel_id"),           // Meta pixel for conversion reporting
  appId: text("app_id"),               // Meta app ID
  appSecret: text("app_secret"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertFounderAdAccountSchema = createInsertSchema(founderAdAccounts).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type FounderAdAccount = typeof founderAdAccounts.$inferSelect;
export type InsertFounderAdAccount = z.infer<typeof insertFounderAdAccountSchema>;

// Growth campaigns launched by founder for AcreOS marketing
export const growthCampaigns = pgTable("growth_campaigns", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  platform: text("platform").notNull().default("meta"),
  templateKey: text("template_key").notNull(), // 'land_investors_signup' | 'retargeting' etc.
  externalCampaignId: text("external_campaign_id"), // Meta campaign ID once created
  status: text("status").notNull().default("draft"), // 'draft' | 'active' | 'paused' | 'completed'
  dailyBudgetCents: integer("daily_budget_cents").notNull().default(2000), // $20/day default
  targetCountries: jsonb("target_countries").$type<string[]>().notNull().default(["US"]),
  totalSpendCents: integer("total_spend_cents").notNull().default(0),
  impressions: integer("impressions").notNull().default(0),
  clicks: integer("clicks").notNull().default(0),
  signups: integer("signups").notNull().default(0),
  conversions: integer("conversions").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertGrowthCampaignSchema = createInsertSchema(growthCampaigns).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type GrowthCampaign = typeof growthCampaigns.$inferSelect;
export type InsertGrowthCampaign = z.infer<typeof insertGrowthCampaignSchema>;

// UTM attribution on organization signup
// (columns added to organizations table via migration; tracked here as a view-friendly type)
export type SignupAttribution = {
  organizationId: number;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  createdAt: Date;
};

// AI-generated ad creative bundles — copy variants + images, produced before campaign deployment
export const adCreativeBundles = pgTable("ad_creative_bundles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  templateKey: text("template_key").notNull(),
  campaignId: integer("campaign_id").references(() => growthCampaigns.id, { onDelete: "set null" }),
  status: text("status").notNull().default("generating"), // 'generating' | 'ready' | 'error' | 'deployed'
  copies: jsonb("copies").$type<any[]>(),   // AdCopyVariant[]
  images: jsonb("images").$type<any[]>(),   // GeneratedAdImage[]
  error: text("error"),
  generatedAt: timestamp("generated_at").defaultNow(),
  model: text("model").default("gpt-4o"),
});
export type AdCreativeBundle = typeof adCreativeBundles.$inferSelect;

// ============================================
// AUTONOMOUS OBSERVATORY
// ============================================

// System activity log: every meaningful autonomous action the system takes
export const systemActivity = pgTable("system_activity", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").references(() => organizations.id, { onDelete: "set null" }),
  jobName: text("job_name").notNull(),   // 'finance_agent', 'pax', 'dunning', etc.
  action: text("action").notNull(),      // 'payment_reminder_sent', 'ticket_resolved', etc.
  summary: text("summary").notNull(),    // human-readable narrative
  entityType: text("entity_type"),       // 'note', 'lead', 'campaign', 'support_case'
  entityId: text("entity_id"),
  metadata: jsonb("metadata").$type<Record<string, any>>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("IDX_sysact_created").on(table.createdAt),
  index("IDX_sysact_org").on(table.orgId, table.createdAt),
  index("IDX_sysact_job").on(table.jobName, table.createdAt),
]);
export type SystemActivity = typeof systemActivity.$inferSelect;

// System meta: key-value store for operational state
export const systemMeta = pgTable("system_meta", {
  key: text("key").primaryKey(),
  value: text("value"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export type SystemMeta = typeof systemMeta.$inferSelect;

// ============================================
// CAMPAIGN VARIANTS (A/B Test Framework)
// ============================================

// Lightweight per-campaign variant table for A/B split testing
export const campaignVariants = pgTable("campaign_variants", {
  id: serial("id").primaryKey(),
  campaignId: integer("campaign_id").references(() => campaigns.id).notNull(),
  name: text("name").notNull(), // "Variant A", "Variant B"
  subject: text("subject"),
  body: text("body"),
  trafficSplit: integer("traffic_split").default(50), // percentage of audience (0-100)
  sentCount: integer("sent_count").default(0),
  openCount: integer("open_count").default(0),
  clickCount: integer("click_count").default(0),
  responseCount: integer("response_count").default(0),
  isWinner: boolean("is_winner").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertCampaignVariantSchema = createInsertSchema(campaignVariants).omit({ id: true, createdAt: true });
export type CampaignVariant = typeof campaignVariants.$inferSelect;
export type InsertCampaignVariant = z.infer<typeof insertCampaignVariantSchema>;

// ============================================
// ORGANIZATION API KEYS
// ============================================
// Per-org API keys allowing external integrations to authenticate with AcreOS.
// The raw key is only returned once at creation; we store a SHA-256 hash.
export const orgApiKeys = pgTable("org_api_keys", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),

  name: text("name").notNull(),
  keyHash: text("key_hash").notNull(), // SHA-256 hex of the actual key
  keyPrefix: text("key_prefix").notNull(), // First 8 chars for display ("acos_XXXX...")
  scope: text("scope").notNull().default("read"), // read | write | admin

  expiresAt: timestamp("expires_at"), // null = never

  lastUsedAt: timestamp("last_used_at"),
  isRevoked: boolean("is_revoked").notNull().default(false),

  createdBy: integer("created_by"), // team member ID
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("org_api_keys_org_idx").on(table.organizationId),
]);

export const insertOrgApiKeySchema = createInsertSchema(orgApiKeys).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  lastUsedAt: true,
  isRevoked: true,
});
export type OrgApiKey = typeof orgApiKeys.$inferSelect;
export type InsertOrgApiKey = z.infer<typeof insertOrgApiKeySchema>;

// ============================================
// SELF-EVOLUTION ENGINE TABLES
// ============================================

// Cache of all models available on OpenRouter, refreshed weekly.
// The model intelligence service benchmarks new models and auto-updates aiModelConfigs.
export const openrouterModelCatalog = pgTable("openrouter_model_catalog", {
  id: serial("id").primaryKey(),
  modelId: text("model_id").notNull().unique(), // e.g. "anthropic/claude-opus-4-6"
  displayName: text("display_name").notNull(),
  inputCostPerMillion: numeric("input_cost_per_million", { precision: 12, scale: 6 }),
  outputCostPerMillion: numeric("output_cost_per_million", { precision: 12, scale: 6 }),
  contextWindow: integer("context_window"),
  capabilities: text("capabilities").array().default([]), // ["vision","reasoning","code",...]
  isNew: boolean("is_new").default(false), // flagged on first discovery for benchmarking
  lastBenchmarkedAt: timestamp("last_benchmarked_at"),
  benchmarkScoreSimple: numeric("benchmark_score_simple", { precision: 5, scale: 2 }),
  benchmarkScoreModerate: numeric("benchmark_score_moderate", { precision: 5, scale: 2 }),
  benchmarkScoreComplex: numeric("benchmark_score_complex", { precision: 5, scale: 2 }),
  isActive: boolean("is_active").default(true), // false = removed from OpenRouter
  discoveredAt: timestamp("discovered_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("openrouter_catalog_active_idx").on(table.isActive),
  index("openrouter_catalog_new_idx").on(table.isNew),
]);
export type OpenrouterModelCatalog = typeof openrouterModelCatalog.$inferSelect;

// Audit log of every autonomous code evolution attempt.
// Each record covers one proposal from generation through deployment/abandonment.
export const evolutionHistory = pgTable("evolution_history", {
  id: serial("id").primaryKey(),
  proposalId: integer("proposal_id"), // FK → agentTasks.id (the self-assessment proposal)
  proposalDescription: text("proposal_description").notNull(),
  targetFile: text("target_file").notNull(), // which file was modified
  generatedCode: text("generated_code"), // the actual code diff generated
  // Multi-stage gauntlet tracking
  stagesCompleted: text("stages_completed").array().default([]),
  stageFailedAt: text("stage_failed_at"), // stage name where failure occurred, null = success
  stageFailureReason: text("stage_failure_reason"),
  reviewModelOutput: text("review_model_output"), // Stage 2 adversarial review JSON
  intentVerificationOutput: text("intent_verification_output"), // Stage 3 JSON
  staticAnalysisOutput: text("static_analysis_output"), // Stage 4 compiler/lint/test output
  // Git tracking
  branchName: text("branch_name"),
  commitHash: text("commit_hash"),
  // Lifecycle
  status: text("status").notNull().default("proposed"), // proposed|stage1_pass|stage2_pass|stage3_pass|stage4_pass|deployed|reverted|abandoned
  deployedAt: timestamp("deployed_at"),
  revertedAt: timestamp("reverted_at"),
  revertReason: text("revert_reason"),
  // Metrics
  errorRateBeforeDeploy: numeric("error_rate_before_deploy", { precision: 8, scale: 4 }),
  errorRateAfterDeploy: numeric("error_rate_after_deploy", { precision: 8, scale: 4 }),
  qualityScoreBefore: numeric("quality_score_before", { precision: 5, scale: 2 }),
  qualityScoreAfter: numeric("quality_score_after", { precision: 5, scale: 2 }),
  // Rosy River C3 — GitHub PR generation. Stage 5 pushes the evolution
  // branch and opens a PR via `gh` instead of marking deployed directly.
  // Founder reviews + merges in GitHub. Null until the PR is opened.
  prNumber: integer("pr_number"),
  prUrl: text("pr_url"),
  // Step-away gap #6 — persisted Stage-6 due-time. The old in-process
  // setTimeout was lost on redeploy and never armed in PR mode; the
  // evolution_regression_scan job now fires stage6RegressionCheck for any
  // deployed row whose due-time has passed. NULL = no check owed (either
  // already run — the scanner claims by nulling it — or not deployed yet).
  regressionCheckDueAt: timestamp("regression_check_due_at", { withTimezone: true }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("evolution_history_status_idx").on(table.status),
  index("evolution_history_created_idx").on(table.createdAt),
]);
export type EvolutionHistory = typeof evolutionHistory.$inferSelect;

// Tracks circuit breaker state for the autonomous evolution pipeline.
// Prevents runaway deployments when consecutive reverts occur.
export const evolutionCircuitBreaker = pgTable("evolution_circuit_breaker", {
  id: serial("id").primaryKey(),
  isTripped: boolean("is_tripped").notNull().default(false),
  consecutiveReverts: integer("consecutive_reverts").notNull().default(0),
  trippedAt: timestamp("tripped_at"),
  resumeAt: timestamp("resume_at"), // auto-resume after 7 days
  resumedBy: text("resumed_by"), // founder email if manually resumed
  updatedAt: timestamp("updated_at").defaultNow(),
});
export type EvolutionCircuitBreaker = typeof evolutionCircuitBreaker.$inferSelect;

// Rosy River (2026-05-12) initially added proposed_changes, agent_cost_log,
// and founder_notifications tables here. Those were architecturally redundant:
// codebase-monitor proposals belong in `agentTasks`, LLM cost belongs in
// `agentLlmTraces`, and founder review events belong in `decisionsInboxItems`.
// Removed before deploy; see server/services/rosyRiver.ts for the integration
// helpers that route through the existing tables.

// ============================================
// CAMPAIGN LEADS
// ============================================

export const campaignLeads = pgTable("campaign_leads", {
  id: serial("id").primaryKey(),
  campaignId: integer("campaign_id").notNull(),
  leadId: integer("lead_id").notNull(),
  organizationId: integer("organization_id").notNull(),
  status: text("status").notNull().default("pending"),
  scheduledAt: timestamp("scheduled_at"),
  touchNumber: integer("touch_number").default(1),
  createdAt: timestamp("created_at").defaultNow(),
});
export type CampaignLead = typeof campaignLeads.$inferSelect;

// ============================================
// COUNTY MARKETS
// ============================================

export const countyMarkets = pgTable("county_markets", {
  id: serial("id").primaryKey(),
  state: text("state").notNull(),
  county: text("county").notNull(),
  medianPricePerAcre: text("median_price_per_acre"),
  recentSalesCount: integer("recent_sales_count"),
  avgDaysOnMarket: integer("avg_days_on_market"),
  priceChangePercent: text("price_change_percent"),
  investorDemandScore: integer("investor_demand_score"),
  lastUpdated: timestamp("last_updated"),
});
export type CountyMarket = typeof countyMarkets.$inferSelect;

// ============================================
// TERRITORIES
// ============================================

export const territories = pgTable("territories", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  stateCode: text("state_code").notNull(),
  counties: jsonb("counties").default([]),
  assignedUserId: integer("assigned_user_id"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});
export type Territory = typeof territories.$inferSelect;

// `sessions` table dropped 2026-08-01 by explicit founder ruling: auth is
// Clerk JWT, no session-store package exists in the dependency tree
// (requireClerkMFA.ts documents express-session is deliberately NOT
// installed), and the table never had a reader or writer.

// ============================================
// NOTES RECEIVABLE
// ============================================

export const notesReceivable = pgTable("notes_receivable", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull(),
  remainingBalance: numeric("remaining_balance").default("0"),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at").defaultNow(),
});

// ============================================
// DAILY DEAL FEED (Section 1)
// ============================================

export interface DealOpportunity {
  id: string; // deterministic hash of apn+county+state
  parcel: {
    apn: string;
    address: string | null;
    county: string;
    state: string;
    /** null when the parcel record carries no usable acreage. */
    acreage: number | null;
    lat: number;
    lng: number;
  };
  scores: {
    // null = the scorer did not answer for this parcel. NOT a neutral
    // midpoint: these were seeded 50 / 575 and a failed scorer left the seed
    // in place, so an unscored parcel was indistinguishable from a genuinely
    // average one — on a surface that RANKS parcels and prints dollar offers
    // beside them. `countyOpportunity` had no scorer wired at all and was the
    // constant 50 for 20% of every composite.
    landCredit: number | null; // 300-850
    landCreditGrade: string | null;
    radarScore: number | null; // 0-100
    ownerMotivation: number | null; // 0-100
    countyOpportunity: number | null; // 0-100
    composite: number | null; // weighted blend over the pillars that scored — the sort key
    /** Which pillars backed `composite`, and how much of the model's weight. */
    basis: {
      scoredPillars: string[];
      missingPillars: string[];
      weightCoverage: number; // 0-1
    };
  };
  signals: {
    motivation: string[]; // "tax delinquent", "out of state", "owned 20+ years"
    environmental: string[]; // "no flood risk", "road access confirmed"
    market: string[]; // "county values rising 8% YoY"
    risks: string[]; // "wetlands adjacent", "no road access"
  };
  financials: {
    // null throughout when the inputs are not on file. `estimatedValue` used
    // to fall back to `medianSalePerAcre * (acreage || 5)`, so a parcel of
    // unknown size was valued as five acres and three dollar offer amounts
    // were derived from that.
    estimatedValue: number | null;
    suggestedOffer: {
      aggressive: number | null;
      market: number | null;
      generous: number | null;
    };
    cashFlipProfit: {
      aggressive: number | null;
      market: number | null;
      generous: number | null;
    };
    sellerFinanceYield: number | null;
  };
  enrichment: {
    floodZone: string;
    elevation: number | null;
    roadAccess: string;
    terrain: string;
    soil: string;
    nearestTown: string | null;
    nearestTownDistance: number | null;
  };
  matchReason: string; // "Matches your Hudspeth County pattern"
}

export const dailyDealFeed = pgTable("daily_deal_feed", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  opportunities: jsonb("opportunities").$type<DealOpportunity[]>().notNull(),
  generatedAt: timestamp("generated_at").defaultNow().notNull(),
  viewedAt: timestamp("viewed_at"),
  archivedAt: timestamp("archived_at"),
}, (t) => [
  index("ddf_org_generated_idx").on(t.organizationId, t.generatedAt),
]);
export type DailyDealFeed = typeof dailyDealFeed.$inferSelect;

export const dealFeedInteractions = pgTable("deal_feed_interactions", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  opportunityId: text("opportunity_id").notNull(),
  action: text("action").notNull(), // "interested" | "pass" | "offer_sent" | "deal_created"
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
  index("dfi_org_opportunity_idx").on(t.organizationId, t.opportunityId),
  index("dfi_org_created_idx").on(t.organizationId, t.createdAt),
]);
export type DealFeedInteraction = typeof dealFeedInteractions.$inferSelect;

// ============================================
// ENTITY COMMENTS (Section 11)
// ============================================

export const entityComments = pgTable("entity_comments", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  entityType: text("entity_type").notNull(), // "lead" | "deal" | "property" | "note"
  entityId: integer("entity_id").notNull(),
  userId: text("user_id").notNull(),
  content: text("content").notNull(),
  mentions: jsonb("mentions").$type<string[]>().default([]),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
  index("ec_entity_idx").on(t.entityType, t.entityId),
  index("ec_org_created_idx").on(t.organizationId, t.createdAt),
]);
export type EntityComment = typeof entityComments.$inferSelect;

// ============================================
// BETA ANALYTICS TABLES
// ============================================

export const userSessions = pgTable("user_sessions", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  orgId: integer("org_id").references(() => organizations.id).notNull(),
  startedAt: timestamp("started_at").defaultNow(),
  endedAt: timestamp("ended_at"),
  pageViews: jsonb("page_views").$type<Array<{ path: string; timestamp: string }>>().default([]),
}, (table) => [
  index("user_sessions_org_idx").on(table.orgId),
  index("user_sessions_user_idx").on(table.userId),
]);

export const userActivationEvents = pgTable("user_activation_events", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  orgId: integer("org_id").references(() => organizations.id).notNull(),
  eventName: text("event_name").notNull(),
  occurredAt: timestamp("occurred_at").defaultNow(),
}, (table) => [
  index("user_activation_events_org_idx").on(table.orgId),
  index("user_activation_events_event_idx").on(table.eventName),
]);

export const userFeedback = pgTable("user_feedback", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  orgId: integer("org_id").references(() => organizations.id).notNull(),
  page: text("page").notNull(),
  feedback: text("feedback").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("user_feedback_org_idx").on(table.orgId),
]);

// ============================================
// FOUNDER BRIEFS TABLE (for agent digest/reports)
// ============================================

export const founderBriefs = pgTable("founder_briefs", {
  id: serial("id").primaryKey(),
  agentType: text("agent_type").notNull(), // customer_success, growth, revenue, operations, digest
  briefType: text("brief_type").notNull(), // daily, weekly, monthly
  content: jsonb("content").$type<Record<string, any>>().notNull(),
  generatedAt: timestamp("generated_at").defaultNow(),
  readAt: timestamp("read_at"),
});

// ============================================
// PROCESSED FEEDBACK TABLE (for AI categorization)
// ============================================

export const processedFeedback = pgTable("processed_feedback", {
  id: serial("id").primaryKey(),
  feedbackId: integer("feedback_id").references(() => userFeedback.id).notNull(),
  category: text("category"), // bug, feature, confusion, praise, complaint
  coreRequest: text("core_request"),
  severity: text("severity"), // low, medium, high, critical
  productArea: text("product_area"),
  processedAt: timestamp("processed_at").defaultNow(),
});

// ============================================
// PLATFORM COMPLETION TABLES
// ============================================

// Legacy `leases` and `maintenance_requests` schema definitions removed
// (FW-7). Superseded by BH-1 schema (rental_leases + maintenance_tickets).
// The underlying database tables remain on disk pending data-migration
// review; no application code reads or writes them.

// Shared deal links — attorney/partner sharing
export const sharedDealLinks = pgTable("shared_deal_links", {
  id: serial("id").primaryKey(),
  dealId: integer("deal_id").references(() => deals.id).notNull(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

// Webhook delivery log — production reliability tracking
export const webhookDeliveries = pgTable("webhook_deliveries", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  endpointUrl: text("endpoint_url").notNull(),
  eventType: text("event_type").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  statusCode: integer("status_code"),
  responseBody: text("response_body"),
  attemptNumber: integer("attempt_number").notNull().default(1),
  deliveredAt: timestamp("delivered_at"),
  nextRetryAt: timestamp("next_retry_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Personal bests — milestone tracking
export const personalBests = pgTable("personal_bests", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").references(() => organizations.id).notNull(),
  metric: text("metric").notNull(),
  value: numeric("value").notNull(),
  previousValue: numeric("previous_value"),
  achievedAt: timestamp("achieved_at").defaultNow(),
  dealId: integer("deal_id").references(() => deals.id),
});

// Model calibration log: the previous dead definition that lived here
// (model_type/records_analyzed/correlation/adjustments — flagged "never
// queried" by the 0013 index audit and never created by migrate.mjs) was
// removed 2026-06-10 (Tier 2A). The live modelCalibrationLog table — the LCS
// calibrator's durable weight store — is defined earlier in this file and
// created by migration 0152.

// Lead emails — inbound/outbound email thread per lead
export const leadEmails = pgTable("lead_emails", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  leadId: integer("lead_id").references(() => leads.id).notNull(),
  direction: text("direction").notNull(), // "inbound" | "outbound"
  fromEmail: text("from_email").notNull(),
  toEmail: text("to_email").notNull(),
  subject: text("subject"),
  bodyText: text("body_text"),
  bodyHtml: text("body_html"),
  messageId: text("message_id"), // SES message ID or inbound Message-ID header
  inReplyTo: text("in_reply_to"), // threading
  receivedAt: timestamp("received_at").defaultNow(),
  readAt: timestamp("read_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertLeadEmailSchema = createInsertSchema(leadEmails).omit({
  id: true, createdAt: true,
});

// ============================================
// COUNTY REVIEWS (Community Intelligence)
// ============================================

export const countyReviews = pgTable("county_reviews", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  state: text("state").notNull(),
  county: text("county").notNull(),
  rating: integer("rating").notNull(),
  pros: text("pros").notNull(),
  cons: text("cons").notNull(),
  investorTrustScore: integer("investor_trust_score"),
  verifiedDeals: integer("verified_deals"),
  createdAt: timestamp("created_at").defaultNow(),
});
export const insertNoteReceivableSchema = createInsertSchema(notesReceivable).omit({ id: true, createdAt: true });
export type NoteReceivable = typeof notesReceivable.$inferSelect;
export type InsertNoteReceivable = z.infer<typeof insertNoteReceivableSchema>;

// ============================================
// SOVEREIGN COMPANY PROTOCOL — AI TEAM
// ============================================

// Company Agents — named AI personas that coordinate existing services
export const companyAgents = pgTable("company_agents", {
  id: serial("id").primaryKey(),
  codename: text("codename").notNull().unique(),     // "atlas_cto", "sentinel_devops", etc.
  title: text("title").notNull(),                     // "Chief Technology Officer"
  wing: text("wing").notNull(),                       // "product", "growth", "ops"
  personalityPrompt: text("personality_prompt"),       // How this agent communicates
  ownedServices: jsonb("owned_services").$type<string[]>(),   // service file names this agent owns
  ownedJobs: jsonb("owned_jobs").$type<string[]>(),           // background jobs this agent monitors
  ownedRoutes: jsonb("owned_routes").$type<string[]>(),       // API route prefixes
  authorityConfig: jsonb("authority_config").$type<{
    level0Actions: string[];  // full autonomy — execute without notification
    level1Actions: string[];  // autonomous + notify — execute and inform CEO
    level2Actions: string[];  // recommend + wait — propose and await approval
    level3Actions: string[];  // escalate immediately — alert CEO, do not act
  }>(),
  trustScore: integer("trust_score").notNull().default(50),  // 0-100, evolves over time
  status: text("status").notNull().default("active"),        // active | paused | disabled
  lastActivityAt: timestamp("last_activity_at"),
  metrics: jsonb("metrics").$type<{
    decisionsTotal: number;
    decisionsCorrect: number;
    escalationsCount: number;
    avgConfidence: number;
    lastWeekActions: number;
  }>(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("company_agents_codename_idx").on(table.codename),
  index("company_agents_wing_idx").on(table.wing),
  index("company_agents_status_idx").on(table.status),
]);

export const insertCompanyAgentSchema = createInsertSchema(companyAgents).omit({ id: true, createdAt: true, updatedAt: true });
export type CompanyAgent = typeof companyAgents.$inferSelect;
export type InsertCompanyAgent = z.infer<typeof insertCompanyAgentSchema>;

// ─── Pillar R — agent trust graduation per category ─────────────────
// Per (agent, action_category) tuple track consecutive acceptances /
// retracts. Promotion rules:
//   manual       (default; founder approves every proposal)
//   → notify_only (auto-merges; founder gets one-line notification)
//   → silent      (auto-merges; appears in weekly digest)
// Demote on retract. Suspend after 3 consecutive retracts at manual.
export const agentActionGraduations = pgTable("agent_action_graduations", {
  id: serial("id").primaryKey(),
  agentCodename: text("agent_codename").notNull(),
  // The category groups proposals so the founder isn't approving the
  // same KIND of work over and over. Examples: "dependency_bump",
  // "schema_column_fix", "copy_change", "workflow_template_wire".
  actionCategory: text("action_category").notNull(),
  graduationTier: text("graduation_tier").notNull().default("manual"), // manual | notify_only | silent | suspended
  consecutiveAccepted: integer("consecutive_accepted").notNull().default(0),
  consecutiveRetracted: integer("consecutive_retracted").notNull().default(0),
  totalAccepted: integer("total_accepted").notNull().default(0),
  totalRetracted: integer("total_retracted").notNull().default(0),
  // When the tier last changed (promoted, demoted, or suspended).
  tierChangedAt: timestamp("tier_changed_at", { withTimezone: true }).notNull().defaultNow(),
  // Founder can override the tier — e.g. force-promote to silent
  // before the auto-graduation threshold, or freeze at manual even
  // after enough successes. Resets on next tier change.
  founderOverride: text("founder_override"), // 'force_silent' | 'freeze_manual' | null
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("agent_graduation_unique").on(table.agentCodename, table.actionCategory),
  index("agent_graduation_tier_idx").on(table.graduationTier),
]);
export type AgentActionGraduation = typeof agentActionGraduations.$inferSelect;

// ─── Pillar R — post-merge observation windows ──────────────────────
// Every agent-shipped change gets a 7-day observation row. A nightly
// cron checks telemetry deltas; on regression, auto-reverts and
// demotes the agent's graduation tier in that category.
export const agentProposalObservations = pgTable("agent_proposal_observations", {
  id: serial("id").primaryKey(),
  agentCodename: text("agent_codename").notNull(),
  actionCategory: text("action_category").notNull(),
  // What shipped. Either a git SHA (for code changes) or a
  // proposal/decision ID (for non-code changes).
  shippedRef: text("shipped_ref").notNull(),
  shippedRefType: text("shipped_ref_type").notNull(), // 'git_sha' | 'decision_id' | 'proposal_id'
  shippedAt: timestamp("shipped_at", { withTimezone: true }).notNull(),
  // The watch window: re-evaluate daily until this date.
  observationEndsAt: timestamp("observation_ends_at", { withTimezone: true }).notNull(),
  // Snapshot of pre-merge telemetry, for delta computation.
  telemetryBaseline: jsonb("telemetry_baseline").$type<Record<string, number>>(),
  // Latest snapshot from a daily cron pass.
  telemetryCurrent: jsonb("telemetry_current").$type<Record<string, number>>(),
  // The verdict so far: 'observing' | 'clean' | 'retracted'.
  status: text("status").notNull().default("observing"),
  // If retracted, why + when + how (git revert SHA).
  retractReason: text("retract_reason"),
  retractedAt: timestamp("retracted_at", { withTimezone: true }),
  retractCommitSha: text("retract_commit_sha"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("agent_observations_agent_idx").on(table.agentCodename),
  index("agent_observations_status_idx").on(table.status),
  index("agent_observations_ends_idx").on(table.observationEndsAt),
]);
export type AgentProposalObservation = typeof agentProposalObservations.$inferSelect;

// Agent Channel Messages — Sovereign Company Protocol broadcast bus.
//
// HISTORY / RECONCILIATION (2026-06-09, iris/agent-messages-reconcile):
// This typed-channel design was originally declared as `agent_messages`
// (2026-03-18, Sovereign Company Protocol) but NO migration ever created
// that table — every broadcast threw "column to_channel does not exist" at
// runtime. Meanwhile a SEPARATE correlation-based `agent_messages` table
// (shared/schema/solene-agent-messages.ts) WAS migrated (2026-06-03) and is
// the one that physically exists in prod. The two designs collided on a
// single physical name. They are two distinct features, so they now own two
// distinct tables: the correlation-based inter-agent DM table keeps the live
// `agent_messages` name (canonical def re-exported from the solene barrel
// below), and this broadcast bus moves to its own `agent_channel_messages`
// table (created by migration 0146). No prod data is dropped — the
// typed-channel table never existed.
export const agentChannelMessages = pgTable("agent_channel_messages", {
  id: serial("id").primaryKey(),
  fromAgent: text("from_agent").notNull(),           // agent codename
  toChannel: text("to_channel").notNull(),           // releases | incidents | customer_signals | metrics_alerts | revenue_events | content_pipeline | compliance_flags
  priority: text("priority").notNull().default("medium"), // low | medium | high | critical
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  data: jsonb("data").$type<Record<string, any>>(),
  requiresResponse: boolean("requires_response").default(false),
  respondBy: timestamp("respond_by"),
  readByAgents: jsonb("read_by_agents").$type<string[]>().default([]),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("agent_channel_messages_channel_idx").on(table.toChannel),
  index("agent_channel_messages_from_idx").on(table.fromAgent),
  index("agent_channel_messages_priority_idx").on(table.priority),
  index("agent_channel_messages_created_idx").on(table.createdAt),
]);

export const insertAgentChannelMessageSchema = createInsertSchema(agentChannelMessages).omit({ id: true, createdAt: true });
export type AgentChannelMessage = typeof agentChannelMessages.$inferSelect;
export type InsertAgentChannelMessage = z.infer<typeof insertAgentChannelMessageSchema>;

// Company Briefing Cache — pre-generated CEO briefings
export const companyBriefingCache = pgTable("company_briefing_cache", {
  id: serial("id").primaryKey(),
  briefingData: jsonb("briefing_data").notNull(),
  healthScore: integer("health_score").notNull(),
  mood: text("mood").notNull(),  // green | yellow | red
  generatedAt: timestamp("generated_at").defaultNow(),
});

// Trust Evolution Log — tracks trust score changes over time
export const trustEvolutionLog = pgTable("trust_evolution_log", {
  id: serial("id").primaryKey(),
  agentCodename: text("agent_codename").notNull(),
  previousScore: integer("previous_score").notNull(),
  newScore: integer("new_score").notNull(),
  delta: integer("delta").notNull(),
  reason: text("reason").notNull(),
  periodStart: timestamp("period_start").notNull(),
  periodEnd: timestamp("period_end").notNull(),
  decisionsInPeriod: integer("decisions_in_period").notNull().default(0),
  accuracyRate: numeric("accuracy_rate"),
  promotionSuggested: boolean("promotion_suggested").default(false),
  promotionAction: text("promotion_action"),  // e.g. "Level 2 → Level 1 for infrastructure scaling"
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("trust_evolution_agent_idx").on(table.agentCodename),
  index("trust_evolution_created_idx").on(table.createdAt),
]);

// Agent Action Log — full audit trail of every agent action
export const agentActionLog = pgTable("agent_action_log", {
  id: serial("id").primaryKey(),
  agentCodename: text("agent_codename").notNull(),
  actionType: text("action_type").notNull(), // skill | goal | reaction | report | chat | decision | proactive
  actionName: text("action_name").notNull(),
  input: jsonb("input").$type<Record<string, any>>(),
  output: jsonb("output").$type<Record<string, any>>(),
  reasoning: text("reasoning"),
  confidence: integer("confidence"),
  costCents: integer("cost_cents").default(0),
  authorityLevel: integer("authority_level"), // 0-3
  trustScoreAtTime: integer("trust_score_at_time"),
  outcome: text("outcome").notNull(), // success | failure | escalated | pending
  durationMs: integer("duration_ms"),
  relatedGoalId: integer("related_goal_id"),
  relatedDecisionId: integer("related_decision_id"),
  // Lens 46 — trust-loop legibility. These columns let a human reconstruct
  // not just WHAT the agent did, but WHY: which alternatives it weighed,
  // what upstream signal triggered the chain, and which model tiers it
  // climbed before producing a confident answer.
  alternativesConsidered: jsonb("alternatives_considered").$type<
    Array<{ action: string; rejectedBecause: string; confidence?: number }>
  >(),
  triggeredByObservationId: integer("triggered_by_observation_id"),
  tiersTried: jsonb("tiers_tried").$type<Array<"haiku" | "sonnet" | "opus">>(),
  modelUsed: text("model_used"),
  correlationId: text("correlation_id"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("agent_action_log_agent_idx").on(table.agentCodename),
  index("agent_action_log_type_idx").on(table.actionType),
  index("agent_action_log_outcome_idx").on(table.outcome),
  index("agent_action_log_created_idx").on(table.createdAt),
  index("agent_action_log_obs_idx").on(table.triggeredByObservationId),
  index("agent_action_log_correlation_idx").on(table.correlationId),
]);

// Agent Goals — CEO-delegated and agent-to-agent task assignments
export const agentGoals = pgTable("agent_goals", {
  id: serial("id").primaryKey(),
  assignedAgent: text("assigned_agent").notNull(), // agent codename
  assignedBy: text("assigned_by").notNull(), // 'ceo' or agent codename
  goal: text("goal").notNull(),
  successCriteria: text("success_criteria"),
  priority: text("priority").notNull().default("medium"), // low | medium | high | critical
  deadline: timestamp("deadline"),
  status: text("status").notNull().default("pending"), // pending | in_progress | completed | failed | cancelled
  directorTaskId: integer("director_task_id"),
  progressLog: jsonb("progress_log").$type<Array<{ timestamp: string; update: string; metrics?: Record<string, any> }>>().default([]),
  result: jsonb("result").$type<Record<string, any>>(),
  createdAt: timestamp("created_at").defaultNow(),
  completedAt: timestamp("completed_at"),
}, (table) => [
  index("agent_goals_agent_idx").on(table.assignedAgent),
  index("agent_goals_status_idx").on(table.status),
  index("agent_goals_created_idx").on(table.createdAt),
]);

// Agent Conversations — persistent chat history with memory
export const agentConversations = pgTable("agent_conversations", {
  id: serial("id").primaryKey(),
  conversationId: text("conversation_id").notNull(), // UUID, groups messages
  agentCodename: text("agent_codename"),
  role: text("role").notNull(), // user | assistant
  content: text("content").notNull(),
  toolCalls: jsonb("tool_calls").$type<Record<string, any>[]>(),
  metadata: jsonb("metadata").$type<Record<string, any>>(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("agent_conv_id_idx").on(table.conversationId),
  index("agent_conv_agent_idx").on(table.agentCodename),
  index("agent_conv_created_idx").on(table.createdAt),
]);

// ============================================
// SOVEREIGN COMPANY PROTOCOL v4
// ============================================

// Outcome Verification Queue — persistent verification of agent action results
// Replaces the broken setTimeout-based outcome checks with a proper job queue
export const outcomeVerificationQueue = pgTable("outcome_verification_queue", {
  id: serial("id").primaryKey(),
  actionLogId: integer("action_log_id").references(() => agentActionLog.id),
  agentCodename: text("agent_codename").notNull(),
  actionName: text("action_name").notNull(),
  input: jsonb("input").$type<Record<string, any>>(),
  scheduledFor: timestamp("scheduled_for").notNull(),
  status: text("status").notNull().default("pending"), // pending | checked | verified | failed
  verifiedAt: timestamp("verified_at"),
  verificationResult: jsonb("verification_result").$type<{
    success: boolean;
    detail: string;
    metrics?: Record<string, any>;
  }>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("ovq_status_scheduled_idx").on(table.status, table.scheduledFor),
  index("ovq_agent_idx").on(table.agentCodename),
  index("ovq_action_log_idx").on(table.actionLogId),
]);
export type OutcomeVerification = typeof outcomeVerificationQueue.$inferSelect;

// Company Priorities — CEO-set strategic priorities all agents follow
export const companyPriorities = pgTable("company_priorities", {
  id: serial("id").primaryKey(),
  priority: text("priority").notNull(),           // "Focus on keeping customers"
  description: text("description"),               // Longer explanation
  weight: integer("weight").notNull().default(5), // 1-10, how important
  setBy: text("set_by").notNull().default("ceo"), // "ceo" or agent codename
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("company_priorities_active_idx").on(table.isActive),
]);
export type CompanyPriority = typeof companyPriorities.$inferSelect;

// Quiet Hours Config — when agents should NOT send notifications
export const quietHoursConfig = pgTable("quiet_hours_config", {
  id: serial("id").primaryKey(),
  startHour: integer("start_hour").notNull().default(22), // 10 PM
  endHour: integer("end_hour").notNull().default(7),       // 7 AM
  timezone: text("timezone").notNull().default("America/Chicago"),
  daysOfWeek: jsonb("days_of_week").$type<number[]>().default([0, 1, 2, 3, 4, 5, 6]), // all days
  emergencyOverride: boolean("emergency_override").notNull().default(true),
  isActive: boolean("is_active").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export type QuietHoursConfig = typeof quietHoursConfig.$inferSelect;

// Agent Override Learnings — what agents learned from CEO rejections
export const agentOverrideLearnings = pgTable("agent_override_learnings", {
  id: serial("id").primaryKey(),
  agentCodename: text("agent_codename").notNull(),
  decisionId: integer("decision_id"),
  actionName: text("action_name").notNull(),
  originalRecommendation: text("original_recommendation"),
  ceoOverrideAction: text("ceo_override_action"),
  ceoOverrideNotes: text("ceo_override_notes"),
  learnedPattern: text("learned_pattern").notNull(),    // AI-extracted lesson
  patternCategory: text("pattern_category").notNull(),   // timing | scope | judgment | risk
  occurrenceCount: integer("occurrence_count").notNull().default(1),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("aol_agent_idx").on(table.agentCodename),
  index("aol_action_idx").on(table.actionName),
]);
export type AgentOverrideLearning = typeof agentOverrideLearnings.$inferSelect;

// Undo Registry — tracks which agent actions can be reversed
export const agentActionUndoLog = pgTable("agent_action_undo_log", {
  id: serial("id").primaryKey(),
  actionLogId: integer("action_log_id").references(() => agentActionLog.id),
  agentCodename: text("agent_codename").notNull(),
  actionName: text("action_name").notNull(),
  undoAvailable: boolean("undo_available").notNull().default(false),
  undoExpiry: timestamp("undo_expiry"),               // After this, can't undo
  undoExecutedAt: timestamp("undo_executed_at"),       // When undo was performed
  undoResult: jsonb("undo_result").$type<{ success: boolean; detail: string }>(),
  originalInput: jsonb("original_input").$type<Record<string, any>>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("aaul_action_log_idx").on(table.actionLogId),
  index("aaul_undo_avail_idx").on(table.undoAvailable, table.undoExpiry),
]);

// ============================================
// SOVEREIGN COMPANY PROTOCOL v6 — THE SELF-RUNNING COMPANY
// ============================================

// --- Agent Workflows (Multi-Agent Pipelines) ---
// Coordinated multi-step processes: Lead -> Score -> Price -> Outreach -> Nurture

export const agentWorkflows = pgTable("agent_workflows", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  triggerType: text("trigger_type").notNull(), // "manual" | "event" | "schedule" | "threshold"
  triggerConfig: jsonb("trigger_config").$type<{
    event?: string;
    schedule?: string;
    threshold?: { metric: string; operator: "gt" | "lt" | "eq"; value: number };
  }>(),
  steps: jsonb("steps").$type<Array<{
    order: number;
    agentCodename: string;
    action: string;
    description: string;
    inputMapping: Record<string, string>;
    failureStrategy: "abort" | "skip" | "retry" | "fallback";
    fallbackAgent?: string;
    timeoutMs?: number;
    condition?: string;
  }>>().notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdBy: text("created_by").notNull().default("system"),
  totalRuns: integer("total_runs").notNull().default(0),
  successRate: numeric("success_rate"),
  avgDurationMs: integer("avg_duration_ms"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("aw_trigger_type_idx").on(table.triggerType),
  index("aw_active_idx").on(table.isActive),
]);
export type AgentWorkflow = typeof agentWorkflows.$inferSelect;

export const agentWorkflowRuns = pgTable("agent_workflow_runs", {
  id: serial("id").primaryKey(),
  workflowId: integer("workflow_id").references(() => agentWorkflows.id).notNull(),
  status: text("status").notNull().default("running"),
  triggeredBy: text("triggered_by").notNull(),
  triggerData: jsonb("trigger_data").$type<Record<string, any>>(),
  currentStep: integer("current_step").notNull().default(0),
  stepResults: jsonb("step_results").$type<Array<{
    step: number;
    agentCodename: string;
    action: string;
    status: "pending" | "running" | "completed" | "failed" | "skipped";
    output?: any;
    error?: string;
    startedAt?: string;
    completedAt?: string;
    durationMs?: number;
  }>>().notNull().default([]),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
  durationMs: integer("duration_ms"),
}, (table) => [
  index("awr_workflow_idx").on(table.workflowId),
  index("awr_status_idx").on(table.status),
  index("awr_started_idx").on(table.startedAt),
]);
export type AgentWorkflowRun = typeof agentWorkflowRuns.$inferSelect;

// --- War Rooms (Auto-Convened Collaboration) ---

export const warRooms = pgTable("war_rooms", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  severity: text("severity").notNull(),
  triggerEvent: text("trigger_event").notNull(),
  triggerData: jsonb("trigger_data").$type<Record<string, any>>(),
  participants: jsonb("participants").$type<string[]>().notNull(),
  leadAgent: text("lead_agent").notNull(),
  status: text("status").notNull().default("active"),
  resolution: text("resolution"),
  resolvedBy: text("resolved_by"),
  ceoJoined: boolean("ceo_joined").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("wr_status_idx").on(table.status),
  index("wr_severity_idx").on(table.severity),
  index("wr_created_idx").on(table.createdAt),
]);
export type WarRoom = typeof warRooms.$inferSelect;

export const warRoomMessages = pgTable("war_room_messages", {
  id: serial("id").primaryKey(),
  warRoomId: integer("war_room_id").references(() => warRooms.id).notNull(),
  fromAgent: text("from_agent").notNull(),
  messageType: text("message_type").notNull(),
  content: text("content").notNull(),
  data: jsonb("data").$type<Record<string, any>>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("wrm_room_idx").on(table.warRoomId),
  index("wrm_from_idx").on(table.fromAgent),
]);
export type WarRoomMessage = typeof warRoomMessages.$inferSelect;

// --- Agent Initiative Proposals ---

export const agentInitiatives = pgTable("agent_initiatives", {
  id: serial("id").primaryKey(),
  proposedBy: text("proposed_by").notNull(),
  title: text("title").notNull(),
  thesis: text("thesis").notNull(),
  evidence: jsonb("evidence").$type<Array<{
    type: "metric" | "pattern" | "customer_signal" | "market_data" | "competitor";
    description: string;
    value?: string | number;
  }>>().notNull(),
  projectedImpact: jsonb("projected_impact").$type<{
    metric: string;
    currentValue: number;
    projectedValue: number;
    timeframeWeeks: number;
    confidence: "low" | "medium" | "high";
  }>(),
  requiredAgents: jsonb("required_agents").$type<string[]>(),
  estimatedEffort: text("estimated_effort"),
  status: text("status").notNull().default("proposed"),
  ceoNotes: text("ceo_notes"),
  votedAt: timestamp("voted_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("ai_init_proposed_by_idx").on(table.proposedBy),
  index("ai_init_status_idx").on(table.status),
  index("ai_init_created_idx").on(table.createdAt),
]);
export type AgentInitiative = typeof agentInitiatives.$inferSelect;

// --- Agent Performance Reviews ---

export const agentPerformanceReviews = pgTable("agent_performance_reviews", {
  id: serial("id").primaryKey(),
  agentCodename: text("agent_codename").notNull(),
  periodStart: timestamp("period_start").notNull(),
  periodEnd: timestamp("period_end").notNull(),
  metrics: jsonb("metrics").$type<{
    totalActions: number;
    successRate: number;
    escalationRate: number;
    avgConfidence: number;
    avgResponseTimeMs: number;
    trustScoreStart: number;
    trustScoreEnd: number;
    trustDelta: number;
    overridesReceived: number;
    goalsCompleted: number;
    goalsAssigned: number;
  }>().notNull(),
  strengths: jsonb("strengths").$type<string[]>().notNull(),
  improvements: jsonb("improvements").$type<string[]>().notNull(),
  learnings: jsonb("learnings").$type<string[]>().notNull(),
  peerFeedback: jsonb("peer_feedback").$type<Array<{
    fromAgent: string;
    feedback: string;
  }>>(),
  overallGrade: text("overall_grade").notNull(),
  summary: text("summary").notNull(),
  ceoComments: text("ceo_comments"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("apr_agent_idx").on(table.agentCodename),
  index("apr_period_idx").on(table.periodStart, table.periodEnd),
]);
export type AgentPerformanceReview = typeof agentPerformanceReviews.$inferSelect;

// --- Agent Playbooks (Codified SOPs) ---

export const agentPlaybooks = pgTable("agent_playbooks", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  ownerAgent: text("owner_agent").notNull(),
  triggerCondition: text("trigger_condition").notNull(),
  triggerConfig: jsonb("trigger_config").$type<{
    event?: string;
    metric?: string;
    operator?: "gt" | "lt" | "eq" | "contains";
    value?: number | string;
  }>(),
  steps: jsonb("steps").$type<Array<{
    order: number;
    agentCodename: string;
    action: string;
    description: string;
    delayMs?: number;
    condition?: string;
    params?: Record<string, any>;
  }>>().notNull(),
  isApproved: boolean("is_approved").notNull().default(false),
  approvedAt: timestamp("approved_at"),
  isActive: boolean("is_active").notNull().default(false),
  totalExecutions: integer("total_executions").notNull().default(0),
  successRate: numeric("success_rate"),
  lastExecutedAt: timestamp("last_executed_at"),
  // v9: Playbook evolution fields
  generation: integer("generation").notNull().default(1),            // mutation generation counter
  parentPlaybookId: integer("parent_playbook_id"),                   // what it evolved from
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("ap_owner_idx").on(table.ownerAgent),
  index("ap_active_idx").on(table.isActive, table.isApproved),
]);
export type AgentPlaybook = typeof agentPlaybooks.$inferSelect;

// --- CEO Absence Mode ---

export const ceoAbsenceMode = pgTable("ceo_absence_mode", {
  id: serial("id").primaryKey(),
  isActive: boolean("is_active").notNull().default(false),
  startedAt: timestamp("started_at"),
  endsAt: timestamp("ends_at"),
  trustBoost: integer("trust_boost").notNull().default(15),
  batchedItems: jsonb("batched_items").$type<Array<{
    type: string;
    summary: string;
    agentCodename: string;
    priority: string;
    timestamp: string;
    data?: any;
  }>>().notNull().default([]),
  emergencyBreaks: jsonb("emergency_breaks").$type<Array<{
    agentCodename: string;
    reason: string;
    timestamp: string;
    actionTaken: string;
  }>>().notNull().default([]),
  returnBriefing: text("return_briefing"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("cam_active_idx").on(table.isActive),
]);

// ============================================
// SOVEREIGN COMPANY PROTOCOL v7 — THE LEARNING COMPANY
// ============================================

// --- Decision Autopilot: Learn the founder's judgment patterns ---

export const decisionPatterns = pgTable("decision_patterns", {
  id: serial("id").primaryKey(),
  patternKey: text("pattern_key").notNull(),              // "forge:pricing_under_5k" | "sophie:churn_response"
  agentCodename: text("agent_codename").notNull(),
  decisionCategory: text("decision_category").notNull(),   // "pricing" | "retention" | "hiring" | "spend" | "feature"
  description: text("description").notNull(),              // human-readable: "Forge pricing suggestions under $5k"
  totalDecisions: integer("total_decisions").notNull().default(0),
  approvedCount: integer("approved_count").notNull().default(0),
  rejectedCount: integer("rejected_count").notNull().default(0),
  overriddenCount: integer("overridden_count").notNull().default(0),
  autoApproveRate: numeric("auto_approve_rate"),           // calculated: approved / total
  predictedAction: text("predicted_action"),               // "approve" | "reject" | "modify" — what the system thinks CEO would do
  predictionConfidence: numeric("prediction_confidence"),   // 0.0–1.0
  isAutopilotEligible: boolean("is_autopilot_eligible").notNull().default(false), // confidence > 0.95 and 20+ decisions
  isAutopilotActive: boolean("is_autopilot_active").notNull().default(false),     // CEO has opted in
  recentDecisions: jsonb("recent_decisions").$type<Array<{
    decisionId: number;
    action: "approved" | "rejected" | "modified" | "shelved";
    context: Record<string, any>;
    timestamp: string;
    wouldHaveAutoed?: string;             // what autopilot would have done
    autopilotCorrect?: boolean;           // was the prediction right?
  }>>().notNull().default([]),
  conditionRules: jsonb("condition_rules").$type<{
    maxAmount?: number;
    agentTrustMin?: number;
    timeOfDay?: string;
    excludeCategories?: string[];
  }>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("dp_pattern_key_idx").on(table.patternKey),
  index("dp_agent_idx").on(table.agentCodename),
  index("dp_autopilot_idx").on(table.isAutopilotActive),
  index("dp_eligible_idx").on(table.isAutopilotEligible),
]);
export type DecisionPattern = typeof decisionPatterns.$inferSelect;

// --- Scenario Engine: "What if?" simulations ---

export const scenarioSimulations = pgTable("scenario_simulations", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  hypothesis: text("hypothesis").notNull(),                // "What if we raise prices 20%?"
  status: text("status").notNull().default("running"),     // "running" | "completed" | "failed"
  agentAnalyses: jsonb("agent_analyses").$type<Array<{
    agentCodename: string;
    perspective: string;                  // "revenue_impact" | "churn_risk" | "operational_load"
    analysis: string;
    metrics: Record<string, any>;
    confidence: "low" | "medium" | "high";
  }>>().notNull().default([]),
  scenarios: jsonb("scenarios").$type<{
    best: { description: string; probability: number; metrics: Record<string, number> };
    median: { description: string; probability: number; metrics: Record<string, number> };
    worst: { description: string; probability: number; metrics: Record<string, number> };
  }>(),
  recommendation: text("recommendation"),
  requestedBy: text("requested_by").notNull().default("ceo"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
}, (table) => [
  index("ss_status_idx").on(table.status),
  index("ss_created_idx").on(table.createdAt),
]);
export type ScenarioSimulation = typeof scenarioSimulations.$inferSelect;

// --- Agent Self-Improvement Plans — DROPPED 2026-08-16 (migration 0236) ---
// `agent_improvement_plans` held per-AGENT goals, skill requests and weekly
// progress notes. Its owning service `agentSelfImprovement.ts` and the
// AgentGrowth.tsx founder component were deleted 2026-08-06 (deletion ledger,
// "Founder narrative routers V6–V14"). No organization_id, no customer row:
// class A under the 2026-08-16 founder ruling "drop only experiment residue".
// `agentPerformanceReviews`, which it referenced, is NOT dropped — it is
// neither writer-less nor reader-less.

// --- Founder Digital Twin: voice, patterns, preferences ---

export const founderTwinContext = pgTable("founder_twin_context", {
  id: serial("id").primaryKey(),
  contextType: text("context_type").notNull(),             // "communication_style" | "decision_pattern" | "priority_signal" | "vocabulary"
  key: text("key").notNull(),
  value: jsonb("value").$type<Record<string, any>>().notNull(),
  confidence: numeric("confidence").notNull().default("0.5"),
  sourceCount: integer("source_count").notNull().default(1),  // how many observations support this
  examples: jsonb("examples").$type<string[]>().notNull().default([]),  // actual excerpts
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("ftc_type_idx").on(table.contextType),
  index("ftc_key_idx").on(table.key),
]);
export type FounderTwinContext = typeof founderTwinContext.$inferSelect;

export const founderDrafts = pgTable("founder_drafts", {
  id: serial("id").primaryKey(),
  draftType: text("draft_type").notNull(),                 // "investor_update" | "board_report" | "customer_response" | "team_announcement"
  title: text("title").notNull(),
  content: text("content").notNull(),
  dataSources: jsonb("data_sources").$type<string[]>().notNull().default([]),  // which agents contributed
  status: text("status").notNull().default("draft"),       // "draft" | "approved" | "sent" | "discarded"
  ceoEdits: text("ceo_edits"),                             // tracked for twin learning
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("fd_type_idx").on(table.draftType),
  index("fd_status_idx").on(table.status),
]);
export type FounderDraft = typeof founderDrafts.$inferSelect;

// --- Attention Optimizer: where the founder's time matters ---

export const attentionInsights = pgTable("attention_insights", {
  id: serial("id").primaryKey(),
  periodStart: timestamp("period_start").notNull(),
  periodEnd: timestamp("period_end").notNull(),
  timeSpent: jsonb("time_spent").$type<Record<string, number>>().notNull(),  // area → minutes: { "war_rooms": 40, "initiatives": 5 }
  interventionImpact: jsonb("intervention_impact").$type<Array<{
    area: string;
    ceoIntervened: boolean;
    outcomeWithout: string;              // what would have happened
    outcomeWith: string;                 // what actually happened
    impactDelta: number;                 // -1 to +1, how much CEO changed outcome
  }>>().notNull().default([]),
  recommendations: jsonb("recommendations").$type<Array<{
    action: "focus_more" | "delegate" | "skip" | "automate";
    area: string;
    reason: string;
    projectedTimeSaved: number;          // minutes per week
  }>>().notNull().default([]),
  focusCard: text("focus_card"),         // "Here's where you matter today" — single-sentence
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("ai_ins_period_idx").on(table.periodStart),
]);
export type AttentionInsight = typeof attentionInsights.$inferSelect;

// --- Institutional Memory: compound pattern library ---

export const institutionalPatterns = pgTable("institutional_patterns", {
  id: serial("id").primaryKey(),
  patternName: text("pattern_name").notNull(),
  description: text("description").notNull(),
  triggerSignals: jsonb("trigger_signals").$type<Array<{
    agentCodename: string;
    signal: string;
    threshold?: number;
  }>>().notNull(),
  effectiveResponse: text("effective_response").notNull(),  // what worked
  ineffectiveResponse: text("ineffective_response"),         // what didn't work
  contextConditions: jsonb("context_conditions").$type<{
    customerAge?: string;                // "0-3m" | "3-12m" | "12m+"
    dealSize?: string;                   // "small" | "medium" | "large"
    season?: string;                     // "q1" | "q2" | "q3" | "q4"
    churnRisk?: string;                  // "low" | "medium" | "high"
  }>(),
  successRate: numeric("success_rate").notNull(),
  sampleSize: integer("sample_size").notNull().default(0),
  lastTriggered: timestamp("last_triggered"),
  contributingAgents: jsonb("contributing_agents").$type<string[]>().notNull().default([]),
  linkedPlaybookId: integer("linked_playbook_id").references(() => agentPlaybooks.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("ip_name_idx").on(table.patternName),
  index("ip_success_idx").on(table.successRate),
]);
export type InstitutionalPattern = typeof institutionalPatterns.$inferSelect;

// Cross-agent signal correlation — when A + B happen together, C follows
export const signalCorrelations = pgTable("signal_correlations", {
  id: serial("id").primaryKey(),
  signalA: text("signal_a").notNull(),                     // "oracle:revenue_dip"
  signalB: text("signal_b").notNull(),                     // "sophie:support_spike"
  predictedOutcome: text("predicted_outcome").notNull(),    // "churn_wave_14d"
  correlation: numeric("correlation").notNull(),            // 0.0–1.0
  observationCount: integer("observation_count").notNull().default(0),
  lastObserved: timestamp("last_observed"),
  autoTriggerPlaybookId: integer("auto_trigger_playbook_id").references(() => agentPlaybooks.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("sc_signals_idx").on(table.signalA, table.signalB),
  index("sc_correlation_idx").on(table.correlation),
]);
export type SignalCorrelation = typeof signalCorrelations.$inferSelect;

// ============================================
// SOVEREIGN COMPANY PROTOCOL v8 — THE LIVING ORGANIZATION
// ============================================

// --- Strategic Compass: living strategy that every agent reads ---

export const strategicCompass = pgTable("strategic_compass", {
  id: serial("id").primaryKey(),
  isActive: boolean("is_active").notNull().default(true),
  mode: text("mode").notNull().default("growth"),         // "growth" | "efficiency" | "crisis" | "exploration" | "balanced"
  northStar: text("north_star").notNull(),                 // single sentence: "Revenue over efficiency. Ship fast."
  priorities: jsonb("priorities").$type<Array<{
    rank: number;
    priority: string;
    weight: number;                                        // 1-10
  }>>().notNull(),
  agentDirectives: jsonb("agent_directives").$type<Record<string, {
    riskTolerance: "low" | "medium" | "high";
    spendAuthority: "tight" | "normal" | "aggressive";
    approvalThreshold: "strict" | "normal" | "loose";
    focusAreas: string[];
    avoidAreas: string[];
  }>>().notNull().default({}),
  metrics: jsonb("metrics").$type<{
    targetMRR?: number;
    acceptableChurn?: number;
    marketingBudgetCeiling?: number;
    hiringStatus?: "freeze" | "selective" | "aggressive";
  }>(),
  lastUpdatedBy: text("last_updated_by").notNull().default("ceo"),
  changelog: jsonb("changelog").$type<Array<{
    timestamp: string;
    changedBy: string;
    description: string;
    previousMode?: string;
    newMode?: string;
  }>>().notNull().default([]),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("sc_compass_active_idx").on(table.isActive),
]);
export type StrategicCompass = typeof strategicCompass.$inferSelect;

// --- Agent Debates: structured disagreement before big decisions ---

export const agentDebates = pgTable("agent_debates", {
  id: serial("id").primaryKey(),
  proposition: text("proposition").notNull(),               // "Should we build a mobile app?"
  status: text("status").notNull().default("in_progress"), // "in_progress" | "awaiting_decision" | "decided" | "cancelled"
  category: text("category").notNull(),                    // "investment" | "pricing" | "product" | "hiring" | "strategy" | "risk"
  initiatedBy: text("initiated_by").notNull(),             // "ceo" | agent codename
  forAgents: jsonb("for_agents").$type<string[]>().notNull().default([]),
  againstAgents: jsonb("against_agents").$type<string[]>().notNull().default([]),
  arguments: jsonb("arguments").$type<Array<{
    agentCodename: string;
    position: "for" | "against";
    round: number;                                         // 1 = opening, 2 = rebuttal
    argument: string;
    evidence: string[];
    confidence: number;                                    // 0-100
  }>>().notNull().default([]),
  votes: jsonb("votes").$type<Array<{
    agentCodename: string;
    vote: "for" | "against" | "abstain";
    confidence: number;
    reasoning: string;
  }>>().notNull().default([]),
  ceoDecision: text("ceo_decision"),                       // "approved" | "rejected" | "modified" | "deferred"
  ceoReasoning: text("ceo_reasoning"),
  outcome: text("outcome"),                                // tracked later: was the decision right?
  createdAt: timestamp("created_at").notNull().defaultNow(),
  decidedAt: timestamp("decided_at"),
}, (table) => [
  index("ad_status_idx").on(table.status),
  index("ad_category_idx").on(table.category),
  index("ad_created_idx").on(table.createdAt),
]);
export type AgentDebate = typeof agentDebates.$inferSelect;

// --- Founder Wellbeing Monitor ---

export const founderWellbeing = pgTable("founder_wellbeing", {
  id: serial("id").primaryKey(),
  date: timestamp("date").notNull(),
  metrics: jsonb("metrics").$type<{
    overrideCount: number;
    overrideAvgWeekly: number;
    decisionsToday: number;
    avgDecisionTimeMs: number;
    timeOnPlatformMinutes: number;
    daysSinceLastBreak: number;
    warRoomInterventions: number;
    agentSuccessRateWithoutCEO: number;
    winCount: number;
    stressSignals: string[];
  }>().notNull(),
  insights: jsonb("insights").$type<Array<{
    type: "warning" | "celebration" | "nudge" | "milestone";
    message: string;
    severity?: "low" | "medium" | "high";
  }>>().notNull().default([]),
  energyScore: integer("energy_score"),                    // 0-100, AI-estimated
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("fw_date_idx").on(table.date),
]);
export type FounderWellbeing = typeof founderWellbeing.$inferSelect;

// --- Company Seasons ---

export const companySeasons = pgTable("company_seasons", {
  id: serial("id").primaryKey(),
  season: text("season").notNull(),                        // "growth" | "efficiency" | "crisis" | "exploration"
  isActive: boolean("is_active").notNull().default(false),
  activatedAt: timestamp("activated_at"),
  deactivatedAt: timestamp("deactivated_at"),
  activatedBy: text("activated_by").notNull().default("ceo"),
  reason: text("reason"),                                  // why this season was activated
  config: jsonb("config").$type<{
    trustBoostAll: number;                                 // temporary trust modifier
    approvalThreshold: "strict" | "normal" | "loose";
    briefingFrequency: "daily" | "twice_daily" | "hourly";
    spendMultiplier: number;                               // 0.5 = half budget, 2.0 = double
    riskTolerance: "low" | "medium" | "high";
    initiativeEncouragement: "discouraged" | "normal" | "encouraged";
    failureTolerance: "zero" | "low" | "medium" | "high";
    autoEscalateThreshold: "low" | "normal" | "high";
  }>().notNull(),
  results: jsonb("results").$type<{
    startMetrics: Record<string, number>;
    endMetrics?: Record<string, number>;
    summary?: string;
  }>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("cs_active_idx").on(table.isActive),
  index("cs_season_idx").on(table.season),
]);
export type CompanySeason = typeof companySeasons.$inferSelect;

// --- Agent Synergy Map — DROPPED 2026-08-16 (migration 0236) ---
// `agent_synergy_map` held agent-PAIR collaboration counters and an AI-written
// routing recommendation. Its owning service `agentSynergyMap.ts` and the
// SynergyMap.tsx founder component were deleted 2026-08-06 (deletion ledger,
// "Founder narrative routers V6–V14" — the three services those dead routers
// solely owned). No organization_id, no customer row: class A under the
// 2026-08-16 founder ruling "drop only experiment residue".

// --- Company Chronicle ---

export const companyChronicle = pgTable("company_chronicle", {
  id: serial("id").primaryKey(),
  periodType: text("period_type").notNull(),               // "week" | "month" | "quarter" | "milestone"
  periodLabel: text("period_label").notNull(),             // "March 2026" | "Q1 2026" | "Week of Mar 17"
  periodStart: timestamp("period_start").notNull(),
  periodEnd: timestamp("period_end").notNull(),
  narrative: text("narrative").notNull(),                   // AI-generated story
  highlights: jsonb("highlights").$type<Array<{
    type: "win" | "challenge" | "learning" | "milestone" | "decision";
    description: string;
    impact?: string;
    agents?: string[];
  }>>().notNull(),
  metrics: jsonb("metrics").$type<{
    mrrStart?: number;
    mrrEnd?: number;
    mrrDelta?: number;
    deals?: number;
    warRooms?: number;
    ceoDecisions?: number;
    agentActions?: number;
    topAgent?: string;
    topAgentGrade?: string;
  }>(),
  keyLearnings: jsonb("key_learnings").$type<string[]>().notNull().default([]),
  searchableText: text("searchable_text"),                 // for full-text search
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("cc_period_type_idx").on(table.periodType),
  index("cc_period_start_idx").on(table.periodStart),
]);
export type CompanyChronicleEntry = typeof companyChronicle.$inferSelect;

// ============================================
// SOVEREIGN COMPANY PROTOCOL v9 — THE SELF-RUNNING COMPANY
// ============================================

// --- Agent Initiatives: (defined above in v8 section) ---

// --- CEO Briefings: unified daily digest ---

export const ceoBriefings = pgTable("ceo_briefings", {
  id: serial("id").primaryKey(),
  date: timestamp("date").notNull(),
  overallStatus: text("overall_status").notNull(),         // "all_clear" | "watch" | "needs_ceo"
  narrative: text("narrative").notNull(),                   // AI-generated executive summary
  allClearAgents: jsonb("all_clear_agents").$type<string[]>().notNull().default([]),
  watchItems: jsonb("watch_items").$type<Array<{
    agentCodename: string;
    title: string;
    summary: string;
    evidence: string[];
    proposedAction?: string;
    confidence: number;
  }>>().notNull().default([]),
  needsCeoItems: jsonb("needs_ceo_items").$type<Array<{
    agentCodename: string;
    title: string;
    summary: string;
    evidence: string[];
    proposedAction?: string;
    actionApprovalNeeded: boolean;
    confidence: number;
  }>>().notNull().default([]),
  actionsTaken: jsonb("actions_taken").$type<Array<{
    action: string;
    decision: string;
    timestamp: string;
  }>>().notNull().default([]),
  totalAgents: integer("total_agents").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("cb_date_idx").on(table.date),
  index("cb_status_idx").on(table.overallStatus),
]);
export type CEOBriefing = typeof ceoBriefings.$inferSelect;

// --- V9 EXPERIMENT RESIDUE — SEVEN TABLES DROPPED 2026-08-16 (migration 0236)
//
// Founder ruling (picker, 2026-08-16): "Triage 3 ways, drop only experiment
// residue." `playbook_evolutions`, `compass_recommendations`, `spend_watchers`,
// `spend_optimizations`, `causal_investigations`, `delegated_goals` and
// `external_intelligence` all lost their only writer when the B19 class-3
// deletion wave removed `playbookEvolutionV9`, `compassAutoRecommendV9`,
// `spendAutonomyV9`, `causalReasoningV9`, `delegationDepthV9` and
// `externalIntelligenceV9` on 2026-08-14 (founder ruling: "Delete classes 2 and
// 3 now"). That deletion-ledger entry names six of the seven in its own
// DELETION-REVEALED list and queues them for exactly this decision.
//
// Class A, not class B: none of the seven carried an `organization_id` or any
// customer row. They held AcreOS's INTERNAL operating state — champion/
// challenger mutations of agent playbooks, mode-change suggestions to the
// founder, AcreOS's own vendor spend figures and savings proposals, internal
// anomaly root-cause analyses, agent-to-agent goal cascades, and competitor /
// market notes.
//
// STILL HERE, deliberately: `agentPlaybooks` (above). It is class A by content
// too, but `institutionalPatterns.linkedPlaybookId` and
// `signalCorrelations.autoTriggerPlaybookId` — on tables that are neither
// writer-less nor reader-less — hold foreign keys into it, so dropping it means
// altering two live tables. That is a larger change than this ruling authorises
// and stays on the founder queue.

// ============================================
// SOVEREIGN COMPANY PROTOCOL v10 — THE CONSCIOUS ORGANIZATION
// ============================================

// --- Scenario Simulations: (defined above in v9 section) ---

// --- Scenario Outcome Comparisons: predicted vs actual ---

export const scenarioOutcomeComparisons = pgTable("scenario_outcome_comparisons", {
  id: serial("id").primaryKey(),
  scenarioId: integer("scenario_id").notNull().references(() => scenarioSimulations.id),
  comparisonDate: timestamp("comparison_date").notNull().defaultNow(),
  predictedOutcome: jsonb("predicted_outcome").$type<Record<string, any>>().notNull(),
  actualOutcome: jsonb("actual_outcome").$type<Record<string, any>>().notNull(),
  accuracyScore: integer("accuracy_score").notNull().default(50),
  lessonsLearned: text("lessons_learned"),
  agentAccuracy: jsonb("agent_accuracy").$type<Array<{ agentCodename: string; accuracy: number }>>().notNull().default([]),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("soc_scenario_idx").on(table.scenarioId),
]);
export type ScenarioOutcomeComparison = typeof scenarioOutcomeComparisons.$inferSelect;

// --- Learning Propagations: cross-agent knowledge transfer ---

export const learningPropagations = pgTable("learning_propagations", {
  id: serial("id").primaryKey(),
  sourceAgent: text("source_agent").notNull(),
  targetAgents: jsonb("target_agents").$type<string[]>().notNull().default([]),
  learningType: text("learning_type").notNull(),
  learning: text("learning").notNull(),
  evidence: jsonb("evidence").$type<string[]>().notNull().default([]),
  outcomeWindowDays: integer("outcome_window_days").notNull().default(7),
  originalOutcomeId: text("original_outcome_id"),
  propagationStatus: text("propagation_status").notNull().default("pending"),
  acceptanceRate: integer("acceptance_rate"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  propagatedAt: timestamp("propagated_at"),
}, (table) => [
  index("lp_source_idx").on(table.sourceAgent),
  index("lp_status_idx").on(table.propagationStatus),
  index("lp_type_idx").on(table.learningType),
]);
export type LearningPropagation = typeof learningPropagations.$inferSelect;

// --- Outcome Calibrations: prediction accuracy per agent ---

export const outcomeCalibrations = pgTable("outcome_calibrations", {
  id: serial("id").primaryKey(),
  agentCodename: text("agent_codename").notNull(),
  actionType: text("action_type").notNull(),
  predictedOutcome: text("predicted_outcome").notNull(),
  predictedConfidence: integer("predicted_confidence").notNull(),
  actualOutcome: text("actual_outcome"),
  actualSuccess: boolean("actual_success"),
  accuracyDelta: integer("accuracy_delta"),
  outcomeWindowDays: integer("outcome_window_days").notNull().default(7),
  outcomeMeasuredAt: timestamp("outcome_measured_at"),
  status: text("status").notNull().default("awaiting_outcome"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("oc_agent_idx").on(table.agentCodename),
  index("oc_status_idx").on(table.status),
]);
export type OutcomeCalibration = typeof outcomeCalibrations.$inferSelect;

// --- Org Heartbeat Snapshots: system vital signs ---

export const orgHeartbeatSnapshots = pgTable("org_heartbeat_snapshots", {
  id: serial("id").primaryKey(),
  snapshotType: text("snapshot_type").notNull().default("hourly"),
  agentLatencies: jsonb("agent_latencies").$type<Record<string, number>>().notNull().default({}),
  decisionQueueDepth: integer("decision_queue_depth").notNull().default(0),
  learningVelocity: integer("learning_velocity").notNull().default(0),
  trustTrajectory: jsonb("trust_trajectory").$type<Record<string, number>>().notNull().default({}),
  escalationRatio: numeric("escalation_ratio").notNull().default("0"),
  feedbackClosureRate: numeric("feedback_closure_rate").notNull().default("0"),
  coherenceScore: integer("coherence_score").notNull().default(100),
  anomalies: jsonb("anomalies").$type<Array<{
    type: string;
    description: string;
    severity: string;
    affectedAgent?: string;
  }>>().notNull().default([]),
  healthGrade: text("health_grade").notNull().default("A"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("ohs_type_idx").on(table.snapshotType),
  index("ohs_grade_idx").on(table.healthGrade),
  index("ohs_created_idx").on(table.createdAt),
]);
export type OrgHeartbeatSnapshot = typeof orgHeartbeatSnapshots.$inferSelect;

// --- Agent Calibration History: self-calibration events ---

export const agentCalibrationHistory = pgTable("agent_calibration_history", {
  id: serial("id").primaryKey(),
  agentCodename: text("agent_codename").notNull(),
  calibrationType: text("calibration_type").notNull(),
  parameterName: text("parameter_name").notNull(),
  oldValue: text("old_value").notNull(),
  newValue: text("new_value").notNull(),
  triggerReason: text("trigger_reason").notNull(),
  performanceBefore: jsonb("performance_before").$type<Record<string, any>>(),
  performanceAfter: jsonb("performance_after").$type<Record<string, any>>(),
  status: text("status").notNull().default("applied"),
  ceoAction: text("ceo_action"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  measuredAt: timestamp("measured_at"),
}, (table) => [
  index("ach_agent_idx").on(table.agentCodename),
  index("ach_type_idx").on(table.calibrationType),
  index("ach_status_idx").on(table.status),
]);
export type AgentCalibrationHistoryEntry = typeof agentCalibrationHistory.$inferSelect;

// --- CEO Decision Replays: hindsight analysis and bias detection ---

export const ceoDecisionReplays = pgTable("ceo_decision_replays", {
  id: serial("id").primaryKey(),
  originalDecisionId: text("original_decision_id").notNull(),
  decisionType: text("decision_type").notNull(),
  decisionSummary: text("decision_summary").notNull(),
  originalContext: jsonb("original_context").$type<Record<string, any>>().notNull().default({}),
  agentRecommendations: jsonb("agent_recommendations").$type<Array<{
    agentCodename: string;
    recommendation: string;
    confidence: number;
  }>>().notNull().default([]),
  ceoChoice: text("ceo_choice").notNull(),
  outcomeData: jsonb("outcome_data").$type<Record<string, any>>(),
  hindsightAssessment: text("hindsight_assessment"),
  wasOptimal: boolean("was_optimal"),
  qualityScore: integer("quality_score"),
  biasFlags: jsonb("bias_flags").$type<Array<{
    biasType: string;
    description: string;
    frequency: number;
    severity: string;
  }>>().notNull().default([]),
  replayDate: timestamp("replay_date").notNull().defaultNow(),
  originalDate: timestamp("original_date").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("cdr_type_idx").on(table.decisionType),
  index("cdr_quality_idx").on(table.qualityScore),
  index("cdr_replay_date_idx").on(table.replayDate),
]);
export type CEODecisionReplay = typeof ceoDecisionReplays.$inferSelect;

// --- Resilience Tests: chaos testing and SPOF detection ---

export const resilienceTests = pgTable("resilience_tests", {
  id: serial("id").primaryKey(),
  testType: text("test_type").notNull(),
  testDescription: text("test_description").notNull(),
  simulatedConditions: jsonb("simulated_conditions").$type<Record<string, any>>().notNull().default({}),
  results: jsonb("results").$type<{
    impact: string;
    degradation: string;
    recoveryTime: string;
    affectedFunctions: string[];
  }>().notNull().default({ impact: "", degradation: "", recoveryTime: "", affectedFunctions: [] }),
  singlePointsOfFailure: jsonb("single_points_of_failure").$type<Array<{
    component: string;
    function: string;
    risk: string;
    mitigation: string;
  }>>().notNull().default([]),
  recommendations: jsonb("recommendations").$type<string[]>().notNull().default([]),
  resilienceScore: integer("resilience_score").notNull().default(50),
  status: text("status").notNull().default("completed"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("rt_type_idx").on(table.testType),
  index("rt_score_idx").on(table.resilienceScore),
]);
export type ResilienceTest = typeof resilienceTests.$inferSelect;

// --- Realtime Event Log: nervous system audit trail ---

export const realtimeEventLog = pgTable("realtime_event_log", {
  id: serial("id").primaryKey(),
  eventType: text("event_type").notNull(),
  agentCodename: text("agent_codename"),
  channel: text("channel").notNull(),
  payload: jsonb("payload").$type<Record<string, any>>().notNull().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("rel_event_type_idx").on(table.eventType),
  index("rel_agent_idx").on(table.agentCodename),
  index("rel_created_idx").on(table.createdAt),
]);
export type RealtimeEvent = typeof realtimeEventLog.$inferSelect;

// --- Dashboard Context States: adaptive CEO surface ---

export const dashboardContextStates = pgTable("dashboard_context_states", {
  id: serial("id").primaryKey(),
  contextMode: text("context_mode").notNull(),
  activeLayers: jsonb("active_layers").$type<string[]>().notNull().default([]),
  suppressedLayers: jsonb("suppressed_layers").$type<string[]>().notNull().default([]),
  triggerReason: text("trigger_reason").notNull(),
  triggerData: jsonb("trigger_data").$type<Record<string, any>>().notNull().default({}),
  activeFrom: timestamp("active_from").notNull().defaultNow(),
  activeUntil: timestamp("active_until"),
  isCurrent: boolean("is_current").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("dcs_mode_idx").on(table.contextMode),
  index("dcs_current_idx").on(table.isCurrent),
]);
export type DashboardContextState = typeof dashboardContextStates.$inferSelect;

// ============================================
// SOVEREIGN COMPANY PROTOCOL v11 — THE ANTICIPATORY ENTERPRISE
// ============================================

// --- Agent Negotiations: structured conflict resolution ---

export const agentNegotiations = pgTable("agent_negotiations", {
  id: serial("id").primaryKey(),
  initiatorAgent: text("initiator_agent").notNull(),
  respondentAgent: text("respondent_agent").notNull(),
  conflictType: text("conflict_type").notNull(),
  subject: text("subject").notNull(),
  initiatorPosition: text("initiator_position").notNull(),
  initiatorEvidence: jsonb("initiator_evidence").$type<string[]>().notNull().default([]),
  respondentPosition: text("respondent_position"),
  respondentEvidence: jsonb("respondent_evidence").$type<string[]>().notNull().default([]),
  negotiationRounds: jsonb("negotiation_rounds").$type<Array<{
    round: number;
    agentCodename: string;
    proposal: string;
    concessions: string[];
    reasoning: string;
  }>>().notNull().default([]),
  resolution: text("resolution"),
  resolutionType: text("resolution_type"),
  compromiseDetails: jsonb("compromise_details").$type<Record<string, any>>(),
  ceoOverride: text("ceo_override"),
  status: text("status").notNull().default("open"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at"),
}, (table) => [
  index("an_status_idx").on(table.status),
  index("an_initiator_idx").on(table.initiatorAgent),
  index("an_respondent_idx").on(table.respondentAgent),
]);
export type AgentNegotiation = typeof agentNegotiations.$inferSelect;

// --- Revenue Attribution Nodes: causal chain to revenue ---

export const revenueAttributionNodes = pgTable("revenue_attribution_nodes", {
  id: serial("id").primaryKey(),
  correlationId: text("correlation_id").notNull(),
  agentCodename: text("agent_codename").notNull(),
  actionType: text("action_type").notNull(),
  actionDescription: text("action_description").notNull(),
  revenueImpactCents: integer("revenue_impact_cents"),
  attributionWeight: numeric("attribution_weight").notNull().default("0"),
  upstreamNodeId: integer("upstream_node_id"),
  downstreamNodeIds: jsonb("downstream_node_ids").$type<number[]>().notNull().default([]),
  metadata: jsonb("metadata").$type<Record<string, any>>().notNull().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("ran_correlation_idx").on(table.correlationId),
  index("ran_agent_idx").on(table.agentCodename),
  index("ran_action_idx").on(table.actionType),
]);
export type RevenueAttributionNode = typeof revenueAttributionNodes.$inferSelect;

// --- Revenue Attribution Reports: periodic ROI summaries ---

export const revenueAttributionReports = pgTable("revenue_attribution_reports", {
  id: serial("id").primaryKey(),
  reportPeriod: text("report_period").notNull(),
  periodStart: timestamp("period_start").notNull(),
  periodEnd: timestamp("period_end").notNull(),
  agentContributions: jsonb("agent_contributions").$type<Array<{
    agentCodename: string;
    totalRevenue: number;
    actionCount: number;
    avgAttribution: number;
    roi: number;
  }>>().notNull().default([]),
  topChains: jsonb("top_chains").$type<Array<{
    correlationId: string;
    totalRevenue: number;
    chainLength: number;
    agents: string[];
  }>>().notNull().default([]),
  totalAttributedRevenue: integer("total_attributed_revenue").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("rar_period_idx").on(table.reportPeriod),
]);
export type RevenueAttributionReport = typeof revenueAttributionReports.$inferSelect;


// --- Delegation Tokens: time-bounded authority grants ---

export const delegationTokens = pgTable("delegation_tokens", {
  id: serial("id").primaryKey(),
  agentCodename: text("agent_codename").notNull(),
  scope: text("scope").notNull(),
  authorityLevel: integer("authority_level").notNull().default(1),
  spendingLimitCents: integer("spending_limit_cents"),
  conditions: jsonb("conditions").$type<Record<string, any>>().notNull().default({}),
  grantedBy: text("granted_by").notNull().default("ceo"),
  reason: text("reason").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  isStanding: boolean("is_standing").notNull().default(false),
  autoRenewDays: integer("auto_renew_days"),
  actionsTaken: integer("actions_taken").notNull().default(0),
  actionsSucceeded: integer("actions_succeeded").notNull().default(0),
  actionsFailed: integer("actions_failed").notNull().default(0),
  revoked: boolean("revoked").notNull().default(false),
  revokedAt: timestamp("revoked_at"),
  revocationReason: text("revocation_reason"),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("dt_agent_idx").on(table.agentCodename),
  index("dt_status_idx").on(table.status),
  index("dt_scope_idx").on(table.scope),
  index("dt_expires_idx").on(table.expiresAt),
]);
export type DelegationToken = typeof delegationTokens.$inferSelect;


// ============================================
// SOVEREIGN COMPANY PROTOCOL v12 — THE REAL RUNTIME
// ============================================

// --- Agent Runtime State: persistent lifecycle ---

export const agentRuntimeState = pgTable("agent_runtime_state", {
  id: serial("id").primaryKey(),
  agentCodename: text("agent_codename").notNull().unique(),
  lifecycleState: text("lifecycle_state").notNull().default("initializing"),
  currentTask: text("current_task"),
  currentTaskStartedAt: timestamp("current_task_started_at"),
  waitingFor: text("waiting_for"),
  waitingSince: timestamp("waiting_since"),
  persistentContext: jsonb("persistent_context").$type<Record<string, any>>().notNull().default({}),
  memoryBudgetBytes: integer("memory_budget_bytes").notNull().default(1048576),
  memoryUsedBytes: integer("memory_used_bytes").notNull().default(0),
  executionTimeLimitMs: integer("execution_time_limit_ms").notNull().default(30000),
  lastHeartbeatAt: timestamp("last_heartbeat_at").notNull().defaultNow(),
  heartbeatIntervalMs: integer("heartbeat_interval_ms").notNull().default(30000),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  maxConsecutiveFailures: integer("max_consecutive_failures").notNull().default(5),
  supervisorAgent: text("supervisor_agent"),
  restartPolicy: text("restart_policy").notNull().default("restart"),
  restartCount: integer("restart_count").notNull().default(0),
  lastRestartAt: timestamp("last_restart_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("ars_state_idx").on(table.lifecycleState),
  index("ars_heartbeat_idx").on(table.lastHeartbeatAt),
]);
export type AgentRuntimeStateEntry = typeof agentRuntimeState.$inferSelect;

// --- Event Mesh Events: real pub/sub ---

export const eventMeshEvents = pgTable("event_mesh_events", {
  id: serial("id").primaryKey(),
  eventId: text("event_id").notNull().unique(),
  channel: text("channel").notNull(),
  eventType: text("event_type").notNull(),
  priority: integer("priority").notNull().default(5),
  payload: jsonb("payload").$type<Record<string, any>>().notNull().default({}),
  publisher: text("publisher").notNull(),
  orgId: integer("org_id"),
  requiresAck: boolean("requires_ack").notNull().default(false),
  ackedBy: jsonb("acked_by").$type<string[]>().notNull().default([]),
  deadLettered: boolean("dead_lettered").notNull().default(false),
  deadLetterReason: text("dead_letter_reason"),
  retryCount: integer("retry_count").notNull().default(0),
  maxRetries: integer("max_retries").notNull().default(3),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("eme_channel_idx").on(table.channel),
  index("eme_type_idx").on(table.eventType),
  index("eme_priority_idx").on(table.priority),
  index("eme_org_idx").on(table.orgId),
  index("eme_dead_idx").on(table.deadLettered),
  index("eme_created_idx").on(table.createdAt),
]);
export type EventMeshEvent = typeof eventMeshEvents.$inferSelect;

// --- Event Mesh Subscriptions ---

export const eventMeshSubscriptions = pgTable("event_mesh_subscriptions", {
  id: serial("id").primaryKey(),
  subscriber: text("subscriber").notNull(),
  channelPattern: text("channel_pattern").notNull(),
  filterConditions: jsonb("filter_conditions").$type<Record<string, any>>().notNull().default({}),
  callbackType: text("callback_type").notNull().default("internal"),
  isActive: boolean("is_active").notNull().default(true),
  lastEventAt: timestamp("last_event_at"),
  eventsProcessed: integer("events_processed").notNull().default(0),
  eventsFailed: integer("events_failed").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("ems_subscriber_idx").on(table.subscriber),
  index("ems_channel_idx").on(table.channelPattern),
]);
export type EventMeshSubscription = typeof eventMeshSubscriptions.$inferSelect;

// --- Outcome Verification Contracts ---

export const outcomeVerificationContracts = pgTable("outcome_verification_contracts", {
  id: serial("id").primaryKey(),
  actionId: text("action_id").notNull(),
  agentCodename: text("agent_codename").notNull(),
  actionType: text("action_type").notNull(),
  actionDescription: text("action_description").notNull(),
  claimedOutcome: text("claimed_outcome").notNull(),
  claimedSuccess: boolean("claimed_success").notNull().default(true),
  verificationMethod: text("verification_method").notNull(),
  verificationConfig: jsonb("verification_config").$type<Record<string, any>>().notNull().default({}),
  verifyAfterMinutes: integer("verify_after_minutes").notNull().default(60),
  verifyStages: jsonb("verify_stages").$type<Array<{ stage: string; minutes: number }>>().notNull().default([]),
  currentStage: text("current_stage").notNull().default("pending"),
  verifiedOutcome: text("verified_outcome"),
  verifiedSuccess: boolean("verified_success"),
  discrepancyDetected: boolean("discrepancy_detected").notNull().default(false),
  discrepancyDetails: text("discrepancy_details"),
  orgId: integer("org_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  nextVerificationAt: timestamp("next_verification_at"),
  completedAt: timestamp("completed_at"),
}, (table) => [
  index("ovc_agent_idx").on(table.agentCodename),
  index("ovc_stage_idx").on(table.currentStage),
  index("ovc_next_idx").on(table.nextVerificationAt),
  index("ovc_discrepancy_idx").on(table.discrepancyDetected),
]);
export type OutcomeVerificationContract = typeof outcomeVerificationContracts.$inferSelect;


// --- Agent Versions: personality versioning ---

export const agentVersions = pgTable("agent_versions", {
  id: serial("id").primaryKey(),
  agentCodename: text("agent_codename").notNull(),
  versionNumber: integer("version_number").notNull(),
  personalityPrompt: text("personality_prompt").notNull(),
  ownedServices: jsonb("owned_services").$type<string[]>().notNull().default([]),
  behaviorConfig: jsonb("behavior_config").$type<Record<string, any>>().notNull().default({}),
  changeDescription: text("change_description").notNull(),
  isActive: boolean("is_active").notNull().default(false),
  canaryWeight: integer("canary_weight").notNull().default(0),
  performanceMetrics: jsonb("performance_metrics").$type<Record<string, any>>().notNull().default({}),
  regressionTestPassed: boolean("regression_test_passed"),
  regressionTestResults: jsonb("regression_test_results").$type<Record<string, any>>(),
  deployedAt: timestamp("deployed_at"),
  rolledBackAt: timestamp("rolled_back_at"),
  createdBy: text("created_by").notNull().default("system"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("av_agent_idx").on(table.agentCodename),
  index("av_active_idx").on(table.isActive),
]);
export type AgentVersion = typeof agentVersions.$inferSelect;

// --- Trust Enforcement Log ---

export const trustEnforcementLog = pgTable("trust_enforcement_log", {
  id: serial("id").primaryKey(),
  agentCodename: text("agent_codename").notNull(),
  actionType: text("action_type").notNull(),
  requiredTrust: integer("required_trust").notNull(),
  actualTrust: integer("actual_trust").notNull(),
  decision: text("decision").notNull(),
  approvalRequestedAt: timestamp("approval_requested_at"),
  approvalResolvedAt: timestamp("approval_resolved_at"),
  approvedBy: text("approved_by"),
  actionOutcome: text("action_outcome"),
  trustDelta: integer("trust_delta"),
  orgId: integer("org_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("tel_agent_idx").on(table.agentCodename),
  index("tel_decision_idx").on(table.decision),
  index("tel_org_idx").on(table.orgId),
]);
export type TrustEnforcementLogEntry = typeof trustEnforcementLog.$inferSelect;

// --- Integration Credentials: secure vault ---

export const integrationCredentials = pgTable("integration_credentials", {
  id: serial("id").primaryKey(),
  serviceName: text("service_name").notNull(),
  credentialType: text("credential_type").notNull(),
  encryptedValue: text("encrypted_value").notNull(),
  allowedAgents: jsonb("allowed_agents").$type<string[]>().notNull().default([]),
  rateLimitPerMinute: integer("rate_limit_per_minute").notNull().default(60),
  rateLimitUsed: integer("rate_limit_used").notNull().default(0),
  rateLimitResetAt: timestamp("rate_limit_reset_at").notNull().defaultNow(),
  circuitBreakerFailures: integer("circuit_breaker_failures").notNull().default(0),
  circuitBreakerThreshold: integer("circuit_breaker_threshold").notNull().default(5),
  circuitBreakerOpen: boolean("circuit_breaker_open").notNull().default(false),
  circuitBreakerResetAt: timestamp("circuit_breaker_reset_at"),
  lastUsedAt: timestamp("last_used_at"),
  orgId: integer("org_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("ic_service_idx").on(table.serviceName),
  index("ic_circuit_idx").on(table.circuitBreakerOpen),
]);
export type IntegrationCredential = typeof integrationCredentials.$inferSelect;

// --- Integration Execution Log ---

export const integrationExecutionLog = pgTable("integration_execution_log", {
  id: serial("id").primaryKey(),
  agentCodename: text("agent_codename").notNull(),
  serviceName: text("service_name").notNull(),
  method: text("method").notNull(),
  endpoint: text("endpoint").notNull(),
  requestSummary: text("request_summary"),
  responseStatus: integer("response_status"),
  responseSummary: text("response_summary"),
  costCents: integer("cost_cents").notNull().default(0),
  latencyMs: integer("latency_ms"),
  success: boolean("success"),
  error: text("error"),
  retryCount: integer("retry_count").notNull().default(0),
  rollbackAction: text("rollback_action"),
  rollbackExecuted: boolean("rollback_executed").notNull().default(false),
  orgId: integer("org_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("iel_agent_idx").on(table.agentCodename),
  index("iel_service_idx").on(table.serviceName),
  index("iel_success_idx").on(table.success),
]);
export type IntegrationExecutionLogEntry = typeof integrationExecutionLog.$inferSelect;

// --- Tenant Agent Config: per-org agent customization ---

export const tenantAgentConfig = pgTable("tenant_agent_config", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull(),
  agentCodename: text("agent_codename").notNull(),
  trustScore: integer("trust_score").notNull().default(50),
  trustFloor: integer("trust_floor").notNull().default(20),
  trustCeiling: integer("trust_ceiling").notNull().default(100),
  enabled: boolean("enabled").notNull().default(true),
  customPersonalityOverride: text("custom_personality_override"),
  customQuotas: jsonb("custom_quotas").$type<Record<string, any>>().notNull().default({}),
  customPermissions: jsonb("custom_permissions").$type<string[]>().notNull().default([]),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("tac_org_idx").on(table.orgId),
  index("tac_agent_idx").on(table.agentCodename),
]);
export type TenantAgentConfigEntry = typeof tenantAgentConfig.$inferSelect;

// ============================================
// SOVEREIGN COMPANY PROTOCOL V13 — THE SENTIENT ENTERPRISE
// ============================================

// --- Pillar 1: Cognitive Memory Layer ---

export const agentEpisodicMemory = pgTable("agent_episodic_memory", {
  id: serial("id").primaryKey(),
  agentCodename: text("agent_codename").notNull(),
  episodeId: text("episode_id").notNull().unique(),
  context: jsonb("context").$type<Record<string, any>>().notNull().default({}),
  action: text("action").notNull(),
  outcome: text("outcome").notNull(),
  outcomeSuccess: boolean("outcome_success").notNull().default(true),
  emotionalValence: integer("emotional_valence").notNull().default(0), // -100 to 100
  relatedEntities: jsonb("related_entities").$type<Array<{ type: string; id: string; name?: string }>>().notNull().default([]),
  tags: jsonb("tags").$type<string[]>().notNull().default([]),
  relevanceScore: integer("relevance_score").notNull().default(100), // decays over time
  accessCount: integer("access_count").notNull().default(0),
  lastAccessedAt: timestamp("last_accessed_at"),
  orgId: integer("org_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("aem_agent_idx").on(table.agentCodename),
  index("aem_relevance_idx").on(table.relevanceScore),
  index("aem_tags_idx").on(table.tags),
  index("aem_org_idx").on(table.orgId),
  index("aem_created_idx").on(table.createdAt),
]);
export type AgentEpisodicMemoryEntry = typeof agentEpisodicMemory.$inferSelect;

export const agentSemanticMemory = pgTable("agent_semantic_memory", {
  id: serial("id").primaryKey(),
  agentCodename: text("agent_codename").notNull(),
  factId: text("fact_id").notNull().unique(),
  fact: text("fact").notNull(),
  category: text("category").notNull(), // market, lead_behavior, pricing, compliance, etc
  confidence: integer("confidence").notNull().default(50), // 0-100
  sourceEpisodes: jsonb("source_episodes").$type<string[]>().notNull().default([]),
  reinforcementCount: integer("reinforcement_count").notNull().default(1),
  contradictionCount: integer("contradiction_count").notNull().default(0),
  decayScore: integer("decay_score").notNull().default(100),
  isShared: boolean("is_shared").notNull().default(false),
  sharedWithAgents: jsonb("shared_with_agents").$type<string[]>().notNull().default([]),
  orgId: integer("org_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("asm_agent_idx").on(table.agentCodename),
  index("asm_category_idx").on(table.category),
  index("asm_confidence_idx").on(table.confidence),
  index("asm_shared_idx").on(table.isShared),
  index("asm_org_idx").on(table.orgId),
]);
export type AgentSemanticMemoryEntry = typeof agentSemanticMemory.$inferSelect;

export const agentWorkingMemoryV13 = pgTable("agent_working_memory_v13", {
  id: serial("id").primaryKey(),
  sagaId: text("saga_id"),
  agentCodename: text("agent_codename").notNull(),
  key: text("key").notNull(),
  value: jsonb("value").$type<any>().notNull(),
  ttlSeconds: integer("ttl_seconds").notNull().default(3600),
  expiresAt: timestamp("expires_at").notNull(),
  orgId: integer("org_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("awm_agent_idx").on(table.agentCodename),
  index("awm_saga_idx").on(table.sagaId),
  index("awm_expires_idx").on(table.expiresAt),
]);
export type AgentWorkingMemoryEntry = typeof agentWorkingMemoryV13.$inferSelect;

export const memoryAccessLog = pgTable("memory_access_log", {
  id: serial("id").primaryKey(),
  agentCodename: text("agent_codename").notNull(),
  memoryType: text("memory_type").notNull(), // episodic, semantic, working
  memoryId: text("memory_id").notNull(),
  query: text("query"),
  relevanceReturned: integer("relevance_returned"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("mal_agent_idx").on(table.agentCodename),
  index("mal_type_idx").on(table.memoryType),
]);
export type MemoryAccessLogEntry = typeof memoryAccessLog.$inferSelect;

// --- Pillar 2: Adaptive Strategy Engine ---

export const agentStrategies = pgTable("agent_strategies", {
  id: serial("id").primaryKey(),
  strategyId: text("strategy_id").notNull().unique(),
  agentCodename: text("agent_codename").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  config: jsonb("config").$type<Record<string, any>>().notNull().default({}),
  contextWeights: jsonb("context_weights").$type<Record<string, number>>().notNull().default({}),
  trialCount: integer("trial_count").notNull().default(0),
  successCount: integer("success_count").notNull().default(0),
  successRate: numeric("success_rate").notNull().default("0"),
  avgOutcomeValue: numeric("avg_outcome_value").notNull().default("0"),
  thompsonAlpha: integer("thompson_alpha").notNull().default(1), // successes + 1
  thompsonBeta: integer("thompson_beta").notNull().default(1), // failures + 1
  minTrialsBeforeCompare: integer("min_trials_before_compare").notNull().default(10),
  isActive: boolean("is_active").notNull().default(true),
  parentStrategyId: text("parent_strategy_id"),
  mutationDescription: text("mutation_description"),
  orgId: integer("org_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("as_agent_idx").on(table.agentCodename),
  index("as_active_idx").on(table.isActive),
  index("as_parent_idx").on(table.parentStrategyId),
  index("as_org_idx").on(table.orgId),
]);
export type AgentStrategyEntry = typeof agentStrategies.$inferSelect;

export const strategyAssignments = pgTable("strategy_assignments", {
  id: serial("id").primaryKey(),
  strategyId: text("strategy_id").notNull(),
  agentCodename: text("agent_codename").notNull(),
  entityType: text("entity_type").notNull(), // lead, deal, property
  entityId: text("entity_id").notNull(),
  contextSnapshot: jsonb("context_snapshot").$type<Record<string, any>>().notNull().default({}),
  outcome: text("outcome"),
  outcomeValue: numeric("outcome_value"),
  outcomeRecordedAt: timestamp("outcome_recorded_at"),
  orgId: integer("org_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("sa_strategy_idx").on(table.strategyId),
  index("sa_entity_idx").on(table.entityType, table.entityId),
  index("sa_agent_idx").on(table.agentCodename),
  index("sa_org_idx").on(table.orgId),
]);
export type StrategyAssignmentEntry = typeof strategyAssignments.$inferSelect;

export const strategyProposals = pgTable("strategy_proposals", {
  id: serial("id").primaryKey(),
  proposalId: text("proposal_id").notNull().unique(),
  agentCodename: text("agent_codename").notNull(),
  proposedName: text("proposed_name").notNull(),
  proposedConfig: jsonb("proposed_config").$type<Record<string, any>>().notNull().default({}),
  rationale: text("rationale").notNull(),
  evidenceEpisodes: jsonb("evidence_episodes").$type<string[]>().notNull().default([]),
  parentStrategyId: text("parent_strategy_id"),
  status: text("status").notNull().default("pending"), // pending, approved, rejected, testing
  reviewedBy: text("reviewed_by"),
  reviewNotes: text("review_notes"),
  orgId: integer("org_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  reviewedAt: timestamp("reviewed_at"),
}, (table) => [
  index("sp_agent_idx").on(table.agentCodename),
  index("sp_status_idx").on(table.status),
  index("sp_org_idx").on(table.orgId),
]);
export type StrategyProposalEntry = typeof strategyProposals.$inferSelect;

// --- Pillar 3: Agent Collaboration Protocol ---

export const agentDialogues = pgTable("agent_dialogues", {
  id: serial("id").primaryKey(),
  dialogueId: text("dialogue_id").notNull().unique(),
  topic: text("topic").notNull(),
  participants: jsonb("participants").$type<string[]>().notNull().default([]),
  consensusMechanism: text("consensus_mechanism").notNull().default("majority"), // majority, weighted, unanimous, ceo_tiebreak
  status: text("status").notNull().default("open"), // open, consensus_reached, escalated, closed
  resolution: text("resolution"),
  relatedEntityType: text("related_entity_type"),
  relatedEntityId: text("related_entity_id"),
  orgId: integer("org_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at"),
}, (table) => [
  index("ad_status_v2_idx").on(table.status),
  index("ad_org_idx").on(table.orgId),
]);
export type AgentDialogueEntry = typeof agentDialogues.$inferSelect;

export const dialogueMessages = pgTable("dialogue_messages", {
  id: serial("id").primaryKey(),
  dialogueId: text("dialogue_id").notNull(),
  fromAgent: text("from_agent").notNull(),
  messageType: text("message_type").notNull(), // proposal, counter_proposal, objection, endorsement, withdrawal, evidence, vote
  content: text("content").notNull(),
  evidence: jsonb("evidence").$type<Record<string, any>>(),
  vote: text("vote"), // approve, reject, abstain
  confidence: integer("confidence"), // 0-100
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("dm_dialogue_idx").on(table.dialogueId),
  index("dm_agent_idx").on(table.fromAgent),
  index("dm_type_idx").on(table.messageType),
]);
export type DialogueMessageEntry = typeof dialogueMessages.$inferSelect;

export const agentDelegations = pgTable("agent_delegations", {
  id: serial("id").primaryKey(),
  delegationId: text("delegation_id").notNull().unique(),
  fromAgent: text("from_agent").notNull(),
  toAgent: text("to_agent").notNull(),
  task: text("task").notNull(),
  taskContext: jsonb("task_context").$type<Record<string, any>>().notNull().default({}),
  slaDeadline: timestamp("sla_deadline"),
  slaQualityThreshold: integer("sla_quality_threshold"), // 0-100
  status: text("status").notNull().default("pending"), // pending, accepted, in_progress, completed, failed, rejected
  result: jsonb("result").$type<Record<string, any>>(),
  qualityScore: integer("quality_score"),
  orgId: integer("org_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
}, (table) => [
  index("adl_from_idx").on(table.fromAgent),
  index("adl_to_idx").on(table.toAgent),
  index("adl_status_idx").on(table.status),
  index("adl_org_idx").on(table.orgId),
]);
export type AgentDelegationEntry = typeof agentDelegations.$inferSelect;

export const agentReputationVotes = pgTable("agent_reputation_votes", {
  id: serial("id").primaryKey(),
  voterAgent: text("voter_agent").notNull(),
  subjectAgent: text("subject_agent").notNull(),
  dimension: text("dimension").notNull(), // accuracy, reliability, speed, creativity, collaboration
  score: integer("score").notNull(), // 1-10
  evidence: text("evidence"),
  dialogueId: text("dialogue_id"),
  delegationId: text("delegation_id"),
  orgId: integer("org_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("arv_voter_idx").on(table.voterAgent),
  index("arv_subject_idx").on(table.subjectAgent),
  index("arv_dimension_idx").on(table.dimension),
  index("arv_org_idx").on(table.orgId),
]);
export type AgentReputationVoteEntry = typeof agentReputationVotes.$inferSelect;

export const agentSkillRegistry = pgTable("agent_skill_registry", {
  id: serial("id").primaryKey(),
  agentCodename: text("agent_codename").notNull(),
  skillName: text("skill_name").notNull(),
  skillDescription: text("skill_description").notNull(),
  proficiency: integer("proficiency").notNull().default(50), // 0-100
  avgLatencyMs: integer("avg_latency_ms"),
  successRate: numeric("success_rate").notNull().default("0"),
  totalInvocations: integer("total_invocations").notNull().default(0),
  isAdvertised: boolean("is_advertised").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("asr_agent_idx").on(table.agentCodename),
  index("asr_skill_idx").on(table.skillName),
  index("asr_proficiency_idx").on(table.proficiency),
]);
export type AgentSkillRegistryEntry = typeof agentSkillRegistry.$inferSelect;

// --- Pillar 4: Self-Healing Mesh ---

export const agentHealthBaselines = pgTable("agent_health_baselines", {
  id: serial("id").primaryKey(),
  agentCodename: text("agent_codename").notNull(),
  metric: text("metric").notNull(), // response_time, error_rate, memory_usage, throughput
  p50: numeric("p50").notNull().default("0"),
  p95: numeric("p95").notNull().default("0"),
  p99: numeric("p99").notNull().default("0"),
  sampleCount: integer("sample_count").notNull().default(0),
  sampleWindow: text("sample_window").notNull().default("24h"),
  lastCalculatedAt: timestamp("last_calculated_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("ahb_agent_idx").on(table.agentCodename),
  index("ahb_metric_idx").on(table.metric),
]);
export type AgentHealthBaselineEntry = typeof agentHealthBaselines.$inferSelect;

export const anomalyDetections = pgTable("anomaly_detections", {
  id: serial("id").primaryKey(),
  anomalyId: text("anomaly_id").notNull().unique(),
  agentCodename: text("agent_codename").notNull(),
  metric: text("metric").notNull(),
  expectedValue: numeric("expected_value").notNull(),
  actualValue: numeric("actual_value").notNull(),
  deviationPercent: numeric("deviation_percent").notNull(),
  severity: text("severity").notNull(), // info, warning, critical
  correlatedEvents: jsonb("correlated_events").$type<string[]>().notNull().default([]),
  rootCauseAnalysis: text("root_cause_analysis"),
  autoResolved: boolean("auto_resolved").notNull().default(false),
  resolvedAt: timestamp("resolved_at"),
  orgId: integer("org_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("adet_agent_idx").on(table.agentCodename),
  index("adet_severity_idx").on(table.severity),
  index("adet_resolved_idx").on(table.autoResolved),
  index("adet_org_idx").on(table.orgId),
]);
export type AnomalyDetectionEntry = typeof anomalyDetections.$inferSelect;

export const degradationModes = pgTable("degradation_modes", {
  id: serial("id").primaryKey(),
  agentCodename: text("agent_codename").notNull(),
  modeName: text("mode_name").notNull(),
  capabilitiesAvailable: jsonb("capabilities_available").$type<string[]>().notNull().default([]),
  capabilitiesDisabled: jsonb("capabilities_disabled").$type<string[]>().notNull().default([]),
  triggerConditions: jsonb("trigger_conditions").$type<Record<string, any>>().notNull().default({}),
  isCurrentMode: boolean("is_current_mode").notNull().default(false),
  activatedAt: timestamp("activated_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("dgm_agent_idx").on(table.agentCodename),
  index("dgm_current_idx").on(table.isCurrentMode),
]);
export type DegradationModeEntry = typeof degradationModes.$inferSelect;

export const incidentPlaybooks = pgTable("incident_playbooks", {
  id: serial("id").primaryKey(),
  playbookId: text("playbook_id").notNull().unique(),
  name: text("name").notNull(),
  triggerPattern: jsonb("trigger_pattern").$type<Record<string, any>>().notNull(),
  actions: jsonb("actions").$type<Array<{ type: string; target: string; params: Record<string, any> }>>().notNull().default([]),
  cooldownMinutes: integer("cooldown_minutes").notNull().default(30),
  lastTriggeredAt: timestamp("last_triggered_at"),
  triggerCount: integer("trigger_count").notNull().default(0),
  isEnabled: boolean("is_enabled").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("ip_enabled_idx").on(table.isEnabled),
]);
export type IncidentPlaybookEntry = typeof incidentPlaybooks.$inferSelect;

export const chaosExperiments = pgTable("chaos_experiments", {
  id: serial("id").primaryKey(),
  experimentId: text("experiment_id").notNull().unique(),
  name: text("name").notNull(),
  experimentType: text("experiment_type").notNull(), // kill_agent, slow_integration, corrupt_event, network_partition
  targetAgent: text("target_agent"),
  targetService: text("target_service"),
  config: jsonb("config").$type<Record<string, any>>().notNull().default({}),
  durationMs: integer("duration_ms").notNull().default(60000),
  status: text("status").notNull().default("pending"), // pending, running, completed, aborted
  impactObserved: jsonb("impact_observed").$type<Record<string, any>>(),
  recoveryTimeMs: integer("recovery_time_ms"),
  lessonsLearned: text("lessons_learned"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
}, (table) => [
  index("ce_status_idx").on(table.status),
  index("ce_type_idx").on(table.experimentType),
]);
export type ChaosExperimentEntry = typeof chaosExperiments.$inferSelect;

// --- Pillar 5: Governance & Compliance Brain ---

export const governancePolicies = pgTable("governance_policies", {
  id: serial("id").primaryKey(),
  policyId: text("policy_id").notNull().unique(),
  name: text("name").notNull(),
  category: text("category").notNull(), // fair_housing, tcpa, dodd_frank, state_specific, internal
  jurisdiction: text("jurisdiction"), // US, TX, CA, etc
  ruleDsl: text("rule_dsl").notNull(), // WHEN ... THEN ... REQUIRE ...
  ruleConfig: jsonb("rule_config").$type<Record<string, any>>().notNull().default({}),
  severity: text("severity").notNull().default("warning"), // info, warning, block
  effectiveDate: timestamp("effective_date").notNull().defaultNow(),
  sunsetDate: timestamp("sunset_date"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("gp_category_idx").on(table.category),
  index("gp_jurisdiction_idx").on(table.jurisdiction),
  index("gp_active_idx").on(table.isActive),
]);
export type GovernancePolicyEntry = typeof governancePolicies.$inferSelect;

export const policyEvaluations = pgTable("policy_evaluations", {
  id: serial("id").primaryKey(),
  evaluationId: text("evaluation_id").notNull().unique(),
  actionId: text("action_id").notNull(),
  agentCodename: text("agent_codename").notNull(),
  policiesChecked: jsonb("policies_checked").$type<Array<{ policyId: string; result: string; details?: string }>>().notNull().default([]),
  overallResult: text("overall_result").notNull(), // pass, warning, blocked
  explanation: text("explanation").notNull(),
  orgId: integer("org_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("pe_action_idx").on(table.actionId),
  index("pe_agent_idx").on(table.agentCodename),
  index("pe_result_idx").on(table.overallResult),
  index("pe_org_idx").on(table.orgId),
]);
export type PolicyEvaluationEntry = typeof policyEvaluations.$inferSelect;

export const auditExplanations = pgTable("audit_explanations", {
  id: serial("id").primaryKey(),
  actionId: text("action_id").notNull(),
  agentCodename: text("agent_codename").notNull(),
  actionType: text("action_type").notNull(),
  humanReadable: text("human_readable").notNull(),
  machineReadable: jsonb("machine_readable").$type<Record<string, any>>().notNull().default({}),
  evidenceChain: jsonb("evidence_chain").$type<Array<{ source: string; fact: string; weight: number }>>().notNull().default([]),
  modelVersion: text("model_version"),
  orgId: integer("org_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("ae_action_idx").on(table.actionId),
  index("ae_agent_idx").on(table.agentCodename),
  index("ae_org_idx").on(table.orgId),
]);
export type AuditExplanationEntry = typeof auditExplanations.$inferSelect;

export const complianceSnapshots = pgTable("compliance_snapshots", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull(),
  period: text("period").notNull(), // 2026-03, 2026-Q1, etc
  metricsByCategory: jsonb("metrics_by_category").$type<Record<string, { total: number; passed: number; violations: number }>>().notNull().default({}),
  violations: jsonb("violations").$type<Array<{ policyId: string; actionId: string; severity: string; date: string }>>().notNull().default([]),
  overallScore: integer("overall_score").notNull().default(100), // 0-100
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("cs_org_idx").on(table.orgId),
  index("cs_period_idx").on(table.period),
  index("cs_score_idx").on(table.overallScore),
]);
export type ComplianceSnapshotEntry = typeof complianceSnapshots.$inferSelect;

export const regulatorySandboxRuns = pgTable("regulatory_sandbox_runs", {
  id: serial("id").primaryKey(),
  sandboxId: text("sandbox_id").notNull().unique(),
  strategyId: text("strategy_id"),
  agentCodename: text("agent_codename"),
  simulatedActions: jsonb("simulated_actions").$type<Array<{ action: string; context: Record<string, any> }>>().notNull().default([]),
  policyViolationsFound: jsonb("policy_violations_found").$type<Array<{ policyId: string; action: string; details: string }>>().notNull().default([]),
  totalSimulated: integer("total_simulated").notNull().default(0),
  totalViolations: integer("total_violations").notNull().default(0),
  recommendation: text("recommendation"),
  orgId: integer("org_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("rsr_agent_idx").on(table.agentCodename),
  index("rsr_strategy_idx").on(table.strategyId),
  index("rsr_org_idx").on(table.orgId),
]);
export type RegulatorySandboxRunEntry = typeof regulatorySandboxRuns.$inferSelect;

// --- Pillar 6: Founder Intelligence Layer ---

export const founderBriefings = pgTable("founder_briefings", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull(),
  briefingDate: text("briefing_date").notNull(), // YYYY-MM-DD
  summary: text("summary").notNull(),
  insights: jsonb("insights").$type<Array<{ category: string; insight: string; importance: number }>>().notNull().default([]),
  recommendations: jsonb("recommendations").$type<Array<{ action: string; rationale: string; impactEstimate: string; priority: number }>>().notNull().default([]),
  agentHighlights: jsonb("agent_highlights").$type<Record<string, { actions: number; successRate: number; trustDelta: number; noteworthy: string }>>().notNull().default({}),
  metricsSnapshot: jsonb("metrics_snapshot").$type<Record<string, any>>().notNull().default({}),
  isRead: boolean("is_read").notNull().default(false),
  readAt: timestamp("read_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("fb_org_idx").on(table.orgId),
  index("fb_date_idx").on(table.briefingDate),
  index("fb_read_idx").on(table.isRead),
]);
export type FounderBriefingEntry = typeof founderBriefings.$inferSelect;

export const simulationRuns = pgTable("simulation_runs", {
  id: serial("id").primaryKey(),
  simulationId: text("simulation_id").notNull().unique(),
  orgId: integer("org_id").notNull(),
  scenarioName: text("scenario_name").notNull(),
  scenarioConfig: jsonb("scenario_config").$type<Record<string, any>>().notNull().default({}),
  outcomes: jsonb("outcomes").$type<Array<{ metric: string; current: number; simulated: number; delta: number }>>().notNull().default([]),
  confidenceInterval: numeric("confidence_interval").notNull().default("0.95"),
  riskFactors: jsonb("risk_factors").$type<Array<{ factor: string; probability: number; impact: string }>>().notNull().default([]),
  recommendation: text("recommendation"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("sr_org_idx").on(table.orgId),
  index("sr_scenario_idx").on(table.scenarioName),
]);
export type SimulationRunEntry = typeof simulationRuns.$inferSelect;

export const strategicRecommendations = pgTable("strategic_recommendations", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull(),
  category: text("category").notNull(), // growth, efficiency, risk, compliance, cost
  recommendation: text("recommendation").notNull(),
  evidence: jsonb("evidence").$type<Array<{ source: string; dataPoint: string; significance: string }>>().notNull().default([]),
  impactEstimate: text("impact_estimate").notNull(),
  priority: integer("priority").notNull().default(5), // 1-10
  status: text("status").notNull().default("new"), // new, acknowledged, implementing, dismissed
  acknowledgedAt: timestamp("acknowledged_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("strec_org_idx").on(table.orgId),
  index("strec_category_idx").on(table.category),
  index("strec_priority_idx").on(table.priority),
  index("strec_status_idx").on(table.status),
]);
export type StrategicRecommendationEntry = typeof strategicRecommendations.$inferSelect;

export const founderInteractions = pgTable("founder_interactions", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull(),
  featureUsed: text("feature_used").notNull(),
  section: text("section"), // memory, strategy, collaboration, healing, governance, intelligence
  engagementDepth: text("engagement_depth").notNull().default("glance"), // glance, read, interact, configure
  sessionDurationMs: integer("session_duration_ms"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("fi_org_idx").on(table.orgId),
  index("fi_feature_idx").on(table.featureUsed),
  index("fi_section_idx").on(table.section),
]);

// ═══════════════════════════════════════════════════════════════════════════════
// Sovereign Company Protocol v14 — The Self-Running Company
//
// V14 is the integration & reflexes layer. V13 built the brain (memory, strategy,
// collaboration, self-healing, governance, intelligence). V14 wires them together
// into closed-loop autonomous workflows that run end-to-end without the founder.
//
// Five pillars:
//   1. Reactive Orchestration — Events trigger agent chains automatically
//   2. Feedback Loop — Founder overrides teach the system
//   3. Confidence Cascade — Exhaust all system resources before bothering founder
//   4. Founder Intent — RETIRED 2026-08-28 (competing-brains stage 2); its
//      tables went into OD-8 drop batch 1 (migration 0241)
//   5. Autonomy Score — Track and minimize founder dependency
// ═══════════════════════════════════════════════════════════════════════════════

// ─── 1. Reactive Orchestration ──────────────────────────────────────────────


/** Tracks each execution of a reaction chain */
export const reactionChainRuns = pgTable("reaction_chain_runs", {
  id: serial("id").primaryKey(),
  runId: text("run_id").notNull().unique(),
  chainId: text("chain_id").notNull(),
  orgId: integer("org_id").notNull(),
  triggerEvent: jsonb("trigger_event").notNull(),
  status: text("status").notNull().default("running"),
  currentStepIndex: integer("current_step_index").notNull().default(0),
  stepResults: jsonb("step_results").default([]),
  haltReason: text("halt_reason"),
  resumedBy: text("resumed_by"),
  totalDurationMs: integer("total_duration_ms"),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
}, (table) => [
  index("rr_chain_idx").on(table.chainId),
  index("rr_org_idx").on(table.orgId),
  index("rr_status_idx").on(table.status),
]);

/** Cross-chain dependency definitions */
export const reactionChainLinks = pgTable("reaction_chain_links", {
  id: serial("id").primaryKey(),
  fromChainId: text("from_chain_id").notNull(),
  toChainId: text("to_chain_id").notNull(),
  linkType: text("link_type").notNull().default("on_complete"),
  conditionFilter: jsonb("condition_filter").default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("rcl_from_idx").on(table.fromChainId),
  index("rcl_to_idx").on(table.toChainId),
]);

// ─── 2. Feedback Loop ───────────────────────────────────────────────────────

/** Every founder override captured as a learning signal */
export const founderOverrides = pgTable("founder_overrides", {
  id: serial("id").primaryKey(),
  overrideId: text("override_id").notNull().unique(),
  orgId: integer("org_id").notNull(),
  originalDecisionId: text("original_decision_id"),
  originalAction: text("original_action").notNull(),
  founderAction: text("founder_action").notNull(),
  founderReason: text("founder_reason"),
  context: jsonb("context").notNull().default({}),
  agentCodename: text("agent_codename"),
  category: text("category").notNull(),
  learningExtracted: boolean("learning_extracted").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("fo_org_idx").on(table.orgId),
  index("fo_agent_idx").on(table.agentCodename),
  index("fo_category_idx").on(table.category),
  index("fo_learning_idx").on(table.learningExtracted),
]);

/** Extracted learning rules from override patterns */
export const feedbackLearnings = pgTable("feedback_learnings", {
  id: serial("id").primaryKey(),
  learningId: text("learning_id").notNull().unique(),
  orgId: integer("org_id").notNull(),
  rule: text("rule").notNull(),
  ruleConfig: jsonb("rule_config").notNull().default({}),
  sourceOverrideIds: jsonb("source_override_ids").notNull().default([]),
  confidence: real("confidence").notNull().default(0.5),
  reinforcementCount: integer("reinforcement_count").notNull().default(1),
  appliedToStrategies: jsonb("applied_to_strategies").default([]),
  appliedToPolicies: jsonb("applied_to_policies").default([]),
  appliedToMemory: jsonb("applied_to_memory").default([]),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("fl_org_idx").on(table.orgId),
  index("fl_status_idx").on(table.status),
  index("fl_confidence_idx").on(table.confidence),
]);

// ─── 3. Confidence Cascade ──────────────────────────────────────────────────

/** Tracks each resolution attempt through cascade layers */
export const cascadeResolutions = pgTable("cascade_resolutions", {
  id: serial("id").primaryKey(),
  resolutionId: text("resolution_id").notNull().unique(),
  orgId: integer("org_id").notNull(),
  triggerType: text("trigger_type").notNull(),
  triggerContext: jsonb("trigger_context").notNull().default({}),
  originAgent: text("origin_agent").notNull(),
  layersAttempted: jsonb("layers_attempted").notNull().default([]),
  resolvedAtLayer: text("resolved_at_layer"),
  finalDecision: text("final_decision"),
  finalConfidence: real("final_confidence"),
  founderEscalated: boolean("founder_escalated").notNull().default(false),
  founderResolution: text("founder_resolution"),
  totalDurationMs: integer("total_duration_ms"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at"),
}, (table) => [
  index("cr_org_idx").on(table.orgId),
  index("cr_origin_idx").on(table.originAgent),
  index("cr_resolved_layer_idx").on(table.resolvedAtLayer),
  index("cr_escalated_idx").on(table.founderEscalated),
]);


// ─── 5. Autonomy Score ──────────────────────────────────────────────────────

/** Daily autonomy metrics snapshot */
export const autonomyScoreSnapshots = pgTable("autonomy_score_snapshots", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull(),
  date: text("date").notNull(),
  totalDecisions: integer("total_decisions").notNull().default(0),
  autonomousDecisions: integer("autonomous_decisions").notNull().default(0),
  cascadeResolved: integer("cascade_resolved").notNull().default(0),
  founderEscalations: integer("founder_escalations").notNull().default(0),
  founderOverrideCount: integer("founder_override_count").notNull().default(0),
  founderTimeSpentMs: integer("founder_time_spent_ms").notNull().default(0),
  avgDecisionLatencyMs: integer("avg_decision_latency_ms").notNull().default(0),
  autonomyScore: real("autonomy_score").notNull().default(0),
  trustScore: real("trust_score").notNull().default(0),
  founderConfidenceScore: real("founder_confidence_score").notNull().default(0),
  breakdownByCategory: jsonb("breakdown_by_category").default({}),
  breakdownByAgent: jsonb("breakdown_by_agent").default({}),
  weekOverWeekDelta: real("week_over_week_delta"),
  recommendations: jsonb("recommendations").default([]),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("as_org_date_idx").on(table.orgId, table.date),
]);

/** Individual founder dependency events */
export const founderDependencyEvents = pgTable("founder_dependency_events", {
  id: serial("id").primaryKey(),
  eventId: text("event_id").notNull().unique(),
  orgId: integer("org_id").notNull(),
  eventType: text("event_type").notNull(),
  agentCodename: text("agent_codename"),
  category: text("category").notNull(),
  description: text("description").notNull(),
  blockedDurationMs: integer("blocked_duration_ms"),
  wasPreventable: boolean("was_preventable"),
  preventionSuggestion: text("prevention_suggestion"),
  resolvedAt: timestamp("resolved_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("fde_org_idx").on(table.orgId),
  index("fde_type_idx").on(table.eventType),
  index("fde_agent_idx").on(table.agentCodename),
]);

// ─── V14 Inferred Types ────────────────────────────────────────────────────

export type ReactionChainRunEntry = typeof reactionChainRuns.$inferSelect;
export type ReactionChainLinkEntry = typeof reactionChainLinks.$inferSelect;
export type FounderOverrideEntry = typeof founderOverrides.$inferSelect;
export type FeedbackLearningEntry = typeof feedbackLearnings.$inferSelect;
export type CascadeResolutionEntry = typeof cascadeResolutions.$inferSelect;
export type AutonomyScoreSnapshotEntry = typeof autonomyScoreSnapshots.$inferSelect;
export type FounderDependencyEventEntry = typeof founderDependencyEvents.$inferSelect;

// ═══════════════════════════════════════════════════════════════════════════════
// Phases 6-20: Sovereign Company Protocol — Full Autonomy Tables
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Phase 11: Graduated Financial Authority ─────────────────────────────────

export const financialApprovals = pgTable("financial_approvals", {
  id: serial("id").primaryKey(),
  requestId: text("request_id").notNull().unique(),
  requestedBy: text("requested_by").notNull(),
  amount: integer("amount_cents").notNull(),
  tier: integer("tier").notNull(),
  purpose: text("purpose").notNull(),
  category: text("category").notNull(),
  approvers: jsonb("approvers").$type<string[]>().default([]),
  approvalStatus: jsonb("approval_status").$type<Record<string, { approved: boolean; timestamp: string; reasoning: string }>>().default({}),
  requiredApprovers: integer("required_approvers").notNull(),
  coolingPeriodEnds: timestamp("cooling_period_ends"),
  status: text("status").notNull().default("pending"),
  executedAt: timestamp("executed_at"),
  reasoning: text("reasoning"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("fa_status_idx").on(table.status),
  index("fa_requested_by_idx").on(table.requestedBy),
  index("fa_tier_idx").on(table.tier),
]);

export const agentBudgetEnvelopes = pgTable("agent_budget_envelopes", {
  id: serial("id").primaryKey(),
  agentCodename: text("agent_codename").notNull(),
  monthKey: text("month_key").notNull(),
  budgetCents: integer("budget_cents").notNull(),
  spentCents: integer("spent_cents").notNull().default(0),
  category: text("category").notNull().default("general"),
  autoApproveUnderCents: integer("auto_approve_under_cents").default(50000),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("abe_agent_month_idx").on(table.agentCodename, table.monthKey),
]);

export const spendAnomalies = pgTable("spend_anomalies", {
  id: serial("id").primaryKey(),
  agentCodename: text("agent_codename").notNull(),
  amountCents: integer("amount_cents").notNull(),
  expectedCents: integer("expected_cents").notNull(),
  deviationSigma: real("deviation_sigma").notNull(),
  peerReviewStatus: text("peer_review_status").default("pending"),
  reviewingAgents: jsonb("reviewing_agents").$type<string[]>().default([]),
  resolution: text("resolution"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("sa_agent_v2_idx").on(table.agentCodename),
]);

// ─── Phase 12: Legal Autonomy Engine ─────────────────────────────────────────

export const legalActions = pgTable("legal_actions", {
  id: serial("id").primaryKey(),
  actionId: text("action_id").notNull().unique(),
  actionType: text("action_type").notNull(),
  category: text("category").notNull(),
  tier: text("tier").notNull(),
  riskScore: integer("risk_score").notNull(),
  templateId: text("template_id"),
  requestedBy: text("requested_by").notNull(),
  counterparty: text("counterparty"),
  valueAtStakeCents: integer("value_at_stake_cents"),
  status: text("status").notNull().default("pending"),
  executedAt: timestamp("executed_at"),
  reviewedBy: jsonb("reviewed_by").$type<string[]>().default([]),
  outcome: text("outcome"),
  reasoning: text("reasoning"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("la_status_idx").on(table.status),
  index("la_tier_idx").on(table.tier),
]);

export const contractTemplates = pgTable("contract_templates", {
  id: serial("id").primaryKey(),
  templateId: text("template_id").notNull().unique(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  content: text("content").notNull(),
  variables: jsonb("variables").$type<string[]>().default([]),
  maxValueCents: integer("max_value_cents"),
  requiresReview: boolean("requires_review").default(false),
  approvedBy: text("approved_by"),
  version: integer("version").notNull().default(1),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const regulatoryFilingCalendar = pgTable("regulatory_filing_calendar", {
  id: serial("id").primaryKey(),
  filingType: text("filing_type").notNull(),
  jurisdiction: text("jurisdiction").notNull(),
  dueDate: timestamp("due_date").notNull(),
  recurrence: text("recurrence").notNull().default("annual"),
  templateId: text("template_id"),
  status: text("status").notNull().default("upcoming"),
  filedAt: timestamp("filed_at"),
  filedBy: text("filed_by"),
  confirmationRef: text("confirmation_ref"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("rfc_due_date_idx").on(table.dueDate),
  index("rfc_status_idx").on(table.status),
]);

// ─── Phase 14: AI Board of Directors ─────────────────────────────────────────

export const boardMeetings = pgTable("board_meetings", {
  id: serial("id").primaryKey(),
  meetingId: text("meeting_id").notNull().unique(),
  meetingType: text("meeting_type").notNull().default("weekly"),
  status: text("status").notNull().default("scheduled"),
  scheduledAt: timestamp("scheduled_at").notNull(),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  agendaItems: jsonb("agenda_items").$type<Array<{ topic: string; presenter: string; priority: number }>>().default([]),
  attendees: jsonb("attendees").$type<string[]>().default([]),
  kpiSnapshot: jsonb("kpi_snapshot").$type<Record<string, any>>().default({}),
  summary: text("summary"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("bm_status_idx").on(table.status),
  index("bm_scheduled_idx").on(table.scheduledAt),
]);

export const boardVotes = pgTable("board_votes", {
  id: serial("id").primaryKey(),
  meetingId: text("meeting_id").notNull(),
  proposalId: text("proposal_id").notNull(),
  proposal: text("proposal").notNull(),
  proposalType: text("proposal_type").notNull(),
  votingAgents: jsonb("voting_agents").$type<string[]>().default([]),
  votes: jsonb("votes").$type<Array<{ agentCodename: string; vote: "for" | "against" | "abstain"; reasoning: string; weight: number }>>().default([]),
  requiredMajority: real("required_majority").notNull().default(0.7),
  result: text("result"),
  executedAt: timestamp("executed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("bv_meeting_idx").on(table.meetingId),
  index("bv_proposal_idx").on(table.proposalId),
]);

export const boardDecisions = pgTable("board_decisions", {
  id: serial("id").primaryKey(),
  decisionId: text("decision_id").notNull().unique(),
  meetingId: text("meeting_id"),
  category: text("category").notNull(),
  description: text("description").notNull(),
  voteSummary: jsonb("vote_summary").$type<{ for: number; against: number; abstain: number }>().default({ for: 0, against: 0, abstain: 0 }),
  passed: boolean("passed").notNull(),
  executionPlan: text("execution_plan"),
  executedAt: timestamp("executed_at"),
  executionResult: text("execution_result"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("bd_category_idx").on(table.category),
]);

export const constitutionalPrinciples = pgTable("constitutional_principles", {
  id: serial("id").primaryKey(),
  principleId: text("principle_id").notNull().unique(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  category: text("category").notNull(),
  isImmutable: boolean("is_immutable").notNull().default(true),
  enforcementLevel: text("enforcement_level").notNull().default("block"),
  violationCount: integer("violation_count").notNull().default(0),
  lastViolationAt: timestamp("last_violation_at"),
  amendmentRequires: real("amendment_requires").notNull().default(0.9),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const strategicPlans = pgTable("strategic_plans", {
  id: serial("id").primaryKey(),
  planId: text("plan_id").notNull().unique(),
  title: text("title").notNull(),
  quarter: text("quarter").notNull(),
  objectives: jsonb("objectives").$type<Array<{ objective: string; keyResults: string[]; owner: string; status: string }>>().default([]),
  approvedByBoard: boolean("approved_by_board").default(false),
  boardMeetingId: text("board_meeting_id"),
  status: text("status").notNull().default("draft"),
  progressPercent: integer("progress_percent").default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ─── Phase 16: Product Evolution Engine — DROPPED 2026-08-16 ─────────────────
// `product_specifications`, `build_buy_decisions` and `feature_impact_scores`
// were dropped by migration 0236 (founder ruling, picker 2026-08-16: "Triage 3
// ways, drop only experiment residue"). Their ONLY writer was
// server/services/productEvolutionEngine.ts, deleted 2026-08-15 in the B19
// orphan triage as a FABRICATOR — it derived build estimates from `gap.length`,
// a string length. The deletion ledger's entry for that wave names all three in
// its DELETION-REVEALED list and queues them for exactly this decision. Content
// was AcreOS's OWN roadmap (its specs, its build-vs-buy analyses, its own
// feature adoption scores) — no organization_id, no customer row.

// ─── Phase 18: Agent Evolution & Meta-Learning ───────────────────────────────

export const agentPromptEvolutions = pgTable("agent_prompt_evolutions", {
  id: serial("id").primaryKey(),
  agentCodename: text("agent_codename").notNull(),
  currentPromptHash: text("current_prompt_hash").notNull(),
  proposedPrompt: text("proposed_prompt").notNull(),
  proposalReason: text("proposal_reason").notNull(),
  performanceDataBefore: jsonb("performance_data_before").$type<Record<string, number>>().default({}),
  performanceDataAfter: jsonb("performance_data_after").$type<Record<string, number>>(),
  abTestId: text("ab_test_id"),
  status: text("status").notNull().default("proposed"),
  approvedByBoard: boolean("approved_by_board").default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Raw LLM prompt/response capture for agent action-replay.
// Persists the full input + output of any LLM call so the founder
// can audit "what did Sophie see and say when she recommended X?"
// See migrations/0027_agent_llm_traces.sql.
export const agentLlmTraces = pgTable("agent_llm_traces", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  agentCodename: text("agent_codename").notNull(),
  // Free-text call-site tag — "customer_monthly_letter", "support_chat",
  // "negotiation_script", etc. No schema migration to add a new source.
  purpose: text("purpose").notNull(),
  decisionId: integer("decision_id"),
  model: text("model").notNull(),
  systemPrompt: text("system_prompt"),
  userPrompt: text("user_prompt").notNull(),
  response: text("response").notNull(),
  latencyMs: integer("latency_ms"),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  costCents: integer("cost_cents"),
  error: text("error"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("idx_agent_llm_traces_agent_recent").on(table.agentCodename, table.createdAt),
  index("idx_agent_llm_traces_decision").on(table.decisionId),
  index("idx_agent_llm_traces_org_recent").on(table.organizationId, table.createdAt),
]);
export type AgentLlmTrace = typeof agentLlmTraces.$inferSelect;
export type InsertAgentLlmTrace = typeof agentLlmTraces.$inferInsert;

export const agentSpawnProposals = pgTable("agent_spawn_proposals", {
  id: serial("id").primaryKey(),
  proposalId: text("proposal_id").notNull().unique(),
  proposedBy: text("proposed_by").notNull(),
  codename: text("codename").notNull(),
  title: text("title").notNull(),
  wing: text("wing").notNull(),
  personalityPrompt: text("personality_prompt").notNull(),
  ownedServices: jsonb("owned_services").$type<string[]>().default([]),
  capabilityGap: text("capability_gap").notNull(),
  justification: text("justification").notNull(),
  boardVoteId: text("board_vote_id"),
  status: text("status").notNull().default("proposed"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const metaLearningInsights = pgTable("meta_learning_insights", {
  id: serial("id").primaryKey(),
  insightId: text("insight_id").notNull().unique(),
  pattern: text("pattern").notNull(),
  correlatedOutcome: text("correlated_outcome").notNull(),
  confidence: real("confidence").notNull(),
  sampleSize: integer("sample_size").notNull(),
  affectedAgents: jsonb("affected_agents").$type<string[]>().default([]),
  recommendation: text("recommendation"),
  appliedAt: timestamp("applied_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});


// ============================================
// PLATFORM ISSUES (Atlas CTO issue tracking)
// ============================================

export const platformIssues = pgTable("platform_issues", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  severity: text("severity").notNull(), // critical | high | medium | low
  affectedFiles: jsonb("affected_files").$type<string[]>(),
  reportedBy: text("reported_by").notNull(),
  status: text("status").notNull().default("open"), // open | in_progress | resolved
  fixPrompt: text("fix_prompt"),
  resolvedAt: timestamp("resolved_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

// ============================================
// CONTENT DRAFTS (Beacon marketing drafts)
// ============================================

export const contentDrafts = pgTable("content_drafts", {
  id: serial("id").primaryKey(),
  type: text("type").notNull(), // social_post | blog_post | email
  platform: text("platform"), // twitter | linkedin | substack | null
  title: text("title"),
  content: text("content").notNull(),
  draftedBy: text("drafted_by").notNull(),
  status: text("status").notNull().default("draft"), // draft | approved | published | rejected
  approvedAt: timestamp("approved_at"),
  publishedAt: timestamp("published_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

// ─── Phase 6-20 Inferred Types ───────────────────────────────────────────────

export type FinancialApproval = typeof financialApprovals.$inferSelect;
export type InsertFinancialApproval = typeof financialApprovals.$inferInsert;
export type AgentBudgetEnvelope = typeof agentBudgetEnvelopes.$inferSelect;
export type SpendAnomaly = typeof spendAnomalies.$inferSelect;
export type LegalAction = typeof legalActions.$inferSelect;
export type ContractTemplate = typeof contractTemplates.$inferSelect;
export type RegulatoryFilingEntry = typeof regulatoryFilingCalendar.$inferSelect;
export type BoardMeeting = typeof boardMeetings.$inferSelect;
export type BoardVote = typeof boardVotes.$inferSelect;
export type BoardDecision = typeof boardDecisions.$inferSelect;
export type ConstitutionalPrinciple = typeof constitutionalPrinciples.$inferSelect;
export type StrategicPlan = typeof strategicPlans.$inferSelect;
// ProductSpecification / BuildBuyDecision / FeatureImpactScore removed with
// their tables on 2026-08-16 (migration 0236).
export type AgentPromptEvolution = typeof agentPromptEvolutions.$inferSelect;
export type AgentSpawnProposal = typeof agentSpawnProposals.$inferSelect;
export type MetaLearningInsight = typeof metaLearningInsights.$inferSelect;

// ─── SCP v2: Structured Memory System ──────────────────────────────────────

// Semantic Memory v2 — SPO (Subject-Predicate-Object) triples with versioning
export const scpSemanticFacts = pgTable("scp_semantic_facts", {
  id: serial("id").primaryKey(),
  factId: text("fact_id").notNull().unique(),
  agentCodename: text("agent_codename").notNull(),
  subject: text("subject").notNull(),
  predicate: text("predicate").notNull(),
  object: text("object").notNull(),
  naturalLanguage: text("natural_language").notNull(),
  sourceEpisodeIds: jsonb("source_episode_ids").$type<string[]>().notNull().default([]),
  confidence: integer("confidence").notNull().default(50), // 0-100 (mapped from 0-1)
  validFrom: timestamp("valid_from").notNull().defaultNow(),
  validUntil: timestamp("valid_until"),
  version: integer("version").notNull().default(1),
  previousVersionId: text("previous_version_id"),
  category: text("category").notNull().default("domain_knowledge"), // ceo_preference, domain_knowledge, team, codebase, process, tool, customer, market
  tags: jsonb("tags").$type<string[]>().notNull().default([]),
  orgId: integer("org_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("ssf_agent_idx").on(table.agentCodename),
  index("ssf_subject_idx").on(table.subject),
  index("ssf_category_idx").on(table.category),
  index("ssf_confidence_idx").on(table.confidence),
  index("ssf_valid_idx").on(table.validUntil),
]);
export type ScpSemanticFact = typeof scpSemanticFacts.$inferSelect;

// Procedural Memory — learned procedures with steps and success tracking
export const scpProcedures = pgTable("scp_procedures", {
  id: serial("id").primaryKey(),
  procedureId: text("procedure_id").notNull().unique(),
  agentCodename: text("agent_codename").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  trigger: text("trigger").notNull(), // When to use this procedure
  steps: jsonb("steps").$type<Array<{
    order: number;
    action: string;
    tool: string | null;
    expectedOutcome: string;
    errorHandling: string | null;
    decisionPoint: boolean;
  }>>().notNull().default([]),
  preconditions: jsonb("preconditions").$type<string[]>().notNull().default([]),
  postconditions: jsonb("postconditions").$type<string[]>().notNull().default([]),
  parameters: jsonb("parameters").$type<Record<string, { type: string; description: string; required: boolean }>>().notNull().default({}),
  sourceEpisodeIds: jsonb("source_episode_ids").$type<string[]>().notNull().default([]),
  successCount: integer("success_count").notNull().default(0),
  failureCount: integer("failure_count").notNull().default(0),
  lastUsedAt: timestamp("last_used_at"),
  confidence: integer("confidence").notNull().default(50), // 0-100
  version: integer("version").notNull().default(1),
  orgId: integer("org_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("scp_agent_idx").on(table.agentCodename),
  index("sp_name_idx").on(table.name),
  index("sp_confidence_idx").on(table.confidence),
]);
export type ScpProcedure = typeof scpProcedures.$inferSelect;

// Golden Suite — permanent regression test cases from CEO corrections
export const scpGoldenCases = pgTable("scp_golden_cases", {
  id: serial("id").primaryKey(),
  caseId: text("case_id").notNull().unique(),
  agentCodename: text("agent_codename").notNull(),
  description: text("description").notNull(),
  lesson: text("lesson").notNull(),
  sessionId: text("session_id").notNull(),
  context: jsonb("context").$type<Record<string, any>>().notNull().default({}),
  orgId: integer("org_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("sgc_agent_idx").on(table.agentCodename),
  index("sgc_session_idx").on(table.sessionId),
]);
export type ScpGoldenCase = typeof scpGoldenCases.$inferSelect;

// Cross-Agent Shared Memory — validated shared knowledge
export const scpSharedMemory = pgTable("scp_shared_memory", {
  id: serial("id").primaryKey(),
  memoryId: text("memory_id").notNull().unique(),
  writtenByAgent: text("written_by_agent").notNull(),
  category: text("category").notNull(), // company_fact, cross_domain_insight, ceo_directive
  subject: text("subject").notNull(),
  content: text("content").notNull(),
  confidence: integer("confidence").notNull().default(70),
  validatedAt: timestamp("validated_at"),
  validationGatesPassed: jsonb("validation_gates_passed").$type<string[]>().notNull().default([]),
  readByAgents: jsonb("read_by_agents").$type<string[]>().notNull().default([]),
  orgId: integer("org_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("ssm_agent_idx").on(table.writtenByAgent),
  index("ssm_category_idx").on(table.category),
]);
export type ScpSharedMemoryEntry = typeof scpSharedMemory.$inferSelect;

// Evolution Metrics — per-agent v2 evolution tracking
export const scpEvolutionMetrics = pgTable("scp_evolution_metrics", {
  id: serial("id").primaryKey(),
  agentCodename: text("agent_codename").notNull(),
  totalSessions: integer("total_sessions").notNull().default(0),
  successRate: integer("success_rate").notNull().default(0), // 0-100
  correctionRate: integer("correction_rate").notNull().default(0), // 0-100
  overrideRate: integer("override_rate").notNull().default(0), // 0-100
  escalationAccuracy: integer("escalation_accuracy").notNull().default(0), // 0-100
  goldenSuiteSize: integer("golden_suite_size").notNull().default(0),
  currentVersion: integer("current_version").notNull().default(1),
  evolutionCadence: text("evolution_cadence").notNull().default("aggressive"), // aggressive, moderate, conservative
  lastEvolvedAt: timestamp("last_evolved_at"),
  lastRollbackAt: timestamp("last_rollback_at"),
  rollbackCount: integer("rollback_count").notNull().default(0),
  orgId: integer("org_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("sem_agent_idx").on(table.agentCodename),
]);
export type ScpEvolutionMetric = typeof scpEvolutionMetrics.$inferSelect;

// ── Field Scout ─────────────────────────────────────────────────────────────

export const fieldScoutVisits = pgTable("field_scout_visits", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull(),
  visitorId: varchar("visitor_id", { length: 255 }).notNull(),
  leadId: integer("lead_id"),
  propertyId: integer("property_id"),
  latitude: real("latitude"),
  longitude: real("longitude"),
  notes: text("notes"),
  status: varchar("status", { length: 50 }).default("completed"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("fsv_org_idx").on(t.organizationId),
  index("fsv_visitor_idx").on(t.visitorId),
]);

export const insertFieldScoutVisitSchema = createInsertSchema(fieldScoutVisits).omit({ id: true, createdAt: true, updatedAt: true });
export type FieldScoutVisit = typeof fieldScoutVisits.$inferSelect;
export type InsertFieldScoutVisit = z.infer<typeof insertFieldScoutVisitSchema>;

export const fieldScoutPhotos = pgTable("field_scout_photos", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull(),
  visitId: integer("visit_id").notNull(),
  leadId: integer("lead_id"),
  url: text("url").notNull(),
  caption: text("caption"),
  latitude: real("latitude"),
  longitude: real("longitude"),
  // Phase 8 Mo 12 — Yara §1 photo-hash + resize pipeline (migration 0067).
  // SHA-256 of the post-EXIF-strip bytes; per-org dedup key.
  imageHash: varchar("image_hash", { length: 64 }),
  // Resize variants (re-encoded JPEG, generated on upload). Surface APIs
  // return whichever size was requested instead of the 12 MP original.
  thumbnailUrl: text("thumbnail_url"),
  cardUrl: text("card_url"),
  fullUrl: text("full_url"),
  bytes: integer("bytes"),
  mime: varchar("mime", { length: 64 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("fsp_visit_idx").on(t.visitId),
  index("fsp_lead_idx").on(t.leadId),
  index("fsp_org_hash_idx").on(t.organizationId, t.imageHash),
]);

export const insertFieldScoutPhotoSchema = createInsertSchema(fieldScoutPhotos).omit({ id: true, createdAt: true });
export type FieldScoutPhoto = typeof fieldScoutPhotos.$inferSelect;
export type InsertFieldScoutPhoto = z.infer<typeof insertFieldScoutPhotoSchema>;

// ============================================
// ADJACENT VERTICALS WAITLIST
// ============================================

export const adjacentVerticalsWaitlist = pgTable("adjacent_verticals_waitlist", {
  id: serial("id").primaryKey(),
  email: text("email").notNull(),
  vertical: text("vertical").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertAdjacentVerticalsWaitlistSchema = createInsertSchema(adjacentVerticalsWaitlist).omit({ id: true, createdAt: true });
export type AdjacentVerticalsWaitlistEntry = typeof adjacentVerticalsWaitlist.$inferSelect;

// ============================================
// FEEDBACK SUBMISSIONS
// ============================================

// Unified feedback table. Serves BOTH the in-app signed-in feedback widget
// (legacy, populated with userId + userEmail) AND the public support/feedback/
// question form on the landing page (populated with name + email; no userId).
// `userId` is nullable to support anonymous public submissions.
export const feedbackSubmissions = pgTable("feedback_submissions", {
  id: serial("id").primaryKey(),
  // Identity — exactly one of (userId+userEmail) OR (name?+email?) populated
  userId: text("user_id"),                         // signed-in submissions only
  userEmail: text("user_email"),                   // signed-in submissions only
  name: text("name"),                              // public submissions only
  email: text("email"),                            // public submissions only
  // Content
  category: text("category").notNull(),            // bug | feature_request | confusion | other | support | feedback | question
  message: text("message").notNull(),
  source: text("source"),                          // landing_footer | final_cta | in_app_widget | help_page
  allowFollowUp: boolean("allow_follow_up").default(true).notNull(),
  pageUrl: text("page_url"),
  userAgent: text("user_agent"),
  ipAddress: text("ip_address"),
  // Founder triage state
  status: text("status").default("new").notNull(), // new | read | replied | archived | reviewed | resolved
  readAt: timestamp("read_at"),
  repliedAt: timestamp("replied_at"),
  founderNotes: text("founder_notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertFeedbackSubmissionSchema = createInsertSchema(feedbackSubmissions).omit({ id: true, createdAt: true });
export type FeedbackSubmission = typeof feedbackSubmissions.$inferSelect;
export type InsertFeedbackSubmission = z.infer<typeof insertFeedbackSubmissionSchema>;

// ============================================
// INTEGRATION STATUS (Founder Dashboard)
// ============================================

export const integrationStatus = pgTable("integration_status", {
  id: serial("id").primaryKey(),
  integrationKey: text("integration_key").notNull().unique(),
  displayName: text("display_name").notNull(),
  isConfigured: boolean("is_configured").default(false).notNull(),
  isCritical: boolean("is_critical").default(false).notNull(),
  lastVerifiedAt: timestamp("last_verified_at"),
  lastVerificationStatus: text("last_verification_status").default("never_tested").notNull(),
  setupDocsUrl: text("setup_docs_url"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertIntegrationStatusSchema = createInsertSchema(integrationStatus).omit({ id: true, updatedAt: true });
export type IntegrationStatus = typeof integrationStatus.$inferSelect;
export type InsertIntegrationStatus = z.infer<typeof insertIntegrationStatusSchema>;

// ============================================================================
// ACCOUNTING + OPS — extracted to ./schema/accounting-ops.ts
// ============================================================================
export * from "./schema/accounting-ops";

// ============================================================================
// FOUNDER AUTOPILOT — immune-system run reports (./schema/autopilot-immune.ts)
// ============================================================================
export * from "./schema/autopilot-immune";

// ============================================================================
// FOUNDER AUTOPILOT — persisted WitnessGrants (./schema/autopilot-witness-grants.ts)
// ============================================================================
export * from "./schema/autopilot-witness-grants";

// ============================================================================
// PLATFORM CONNECTIONS — founder-entered platform credentials
// (./schema/platform-connections.ts)
// ============================================================================
export * from "./schema/platform-connections";
export * from "./schema/connected-mailboxes";

// ============================================================================
// UNATTACHED INBOUND REPLIES — SMS from numbers matching no lead
// (./schema/unattached-inbound.ts)
// ============================================================================
export * from "./schema/unattached-inbound";


// ============================================================================
// NOTE INVESTOR VERTICAL — extracted to ./schema/notes-vertical.ts
// ============================================================================
export * from "./schema/notes-vertical";

// ============================================================================
// WHOLESALE VERTICAL — extracted to ./schema/wholesale.ts
// ============================================================================
export * from "./schema/wholesale";

// ============================================================================
// SUBDIVISION VERTICAL — extracted to ./schema/subdivision.ts
// ============================================================================
export * from "./schema/subdivision";

// ============================================================================
// FIX-AND-FLIP VERTICAL — extracted to ./schema/fix-and-flip.ts
// ============================================================================
export * from "./schema/fix-and-flip";

// ============================================================================
// BUY-AND-HOLD / RENTAL VERTICAL — extracted to ./schema/rental.ts
// ============================================================================
export * from "./schema/rental";

// ============================================================================
// MIGRATION/ETL — extracted to ./schema/etl.ts
// ============================================================================
export * from "./schema/etl";

// ============================================================================
// FINANCIAL LEDGER + MAIL SHIPMENTS — extracted to ./schema/finance.ts
// ============================================================================
export * from "./schema/finance";

// ============================================================================
// PUBLIC API v0 — extracted to ./schema/public-api.ts
// ============================================================================
export * from "./schema/public-api";

// ============================================================================
// PHASE 0 HARDENING — bot-signal capture + OFAC SDN hash table
// ============================================================================
export * from "./schema/hardening";

// ============================================================================
// BEATRICE — Pax continuous-audit ledger (constitutional compliance audit)
// ============================================================================
export * from "./schema/pax-audit";

// ============================================================================
// PHASE D1 — per-user Pax context (vertical / experience / goals / geo)
// ============================================================================
export * from "./schema/pax-user-context";

// ============================================================================
// SOLENE — self-audit ledger (operating-discipline drift detection)
// ============================================================================
export * from "./schema/solene-audit";

// ============================================================================
// SOLENE — capital event ledger (per-session + per-day spend tracker)
// ============================================================================
export * from "./schema/solene-capital";

// ============================================================================
// SOLENE — proactive page-event ledger (urgent / critical pages to Tom)
// ============================================================================
export * from "./schema/solene-page";

// ============================================================================
// SOLENE — inter-agent direct messages (correlation-based DM table). This is
// the CANONICAL `agent_messages` table that physically exists in prod (created
// 2026-06-03, migrate.mjs). Re-exported here so `agentMessages` resolves to
// the real table from `@shared/schema` and the schema-column validator (which
// indexes only shared/schema.ts) sees the live column set. The typed-channel
// broadcast bus that previously squatted this name now lives on its own
// `agent_channel_messages` table (see agentChannelMessages above).
// ============================================================================
export * from "./schema/solene-agent-messages";

// ============================================================================
// SOLENE — team-system audit (overarching team-as-a-system elite-bar audit)
// ============================================================================
export * from "./schema/team-system-audit";

// ============================================================================
// SOLENE — customer-surface ErrorBoundary trip ledger
// ============================================================================
export * from "./schema/error-boundary-trips";

// ============================================================================
// SOLENE — real agent-dispatch queue + result ledger (Layer 1 capability #1)
// ============================================================================
export * from "./schema/solene-dispatch";

// ============================================================================
// QUINN + BEATRICE — Pax refusal payload ledger (Tahoe wave E9 — customer
// recourse substrate). Every customer-facing refusal cites an immutable.
// ============================================================================
export * from "./schema/pax-refusal-payloads";

// ============================================================================
// QUINN + BEATRICE — Pax decision appeals ledger (Tahoe wave E9 — customer
// recourse lifecycle: open → under_review → upheld | reversed).
// ============================================================================
export * from "./schema/pax-decision-appeals";

// ============================================================================
// RAFE — The Recourse Loop draft ledger (every negative customer signal →
// a drafted, personal, same-hour human reply; one founder queue, auditable).
// ============================================================================
export * from "./schema/recourse-drafts";

// ============================================================================
// QUINN — Transparency report substrate (Tahoe wave E9 — rolling 90-day
// aggregation; nightly job populates, /transparency surface ships later).
// ============================================================================
export * from "./schema/transparency-reports";

// ============================================================================
// LENA + IRIS + BEATRICE — Founder Life-Cockpit (FOUNDER-SIDE ONLY).
// Founder-scoped (founder_user_id), NOT org-scoped customer data. Encrypted
// personal-tax + income + obligations + document-vault substrate. Migration 0123.
// ============================================================================
export * from "./schema/founder-life-cockpit";

// ============================================================================
// IRIS — shared continuous-audit substrate (domain_audit_findings).
// COMPANY/FOUNDER-LEVEL (no organization_id). Six domains write findings; the
// founder Command cockpit renders "is it green?". Migration 0135.
// ============================================================================
export * from "./schema/domain-audit-findings";

// ============================================================================
// SOLENE — Founder collaboration asks (solene_founder_asks).
// FOUNDER-SIDE ONLY. Powers /api/founder/asks. Re-exported here so the single
// drizzle schema source (drizzle.config.ts) creates the table on db:push;
// prod mirrors the DDL via scripts/migrate.mjs.
// ============================================================================
export * from "./schema/solene-founder-collab";

// ============================================================================
// SCHEMA SOURCE-OF-TRUTH DRIFT CLOSURE (Iris).
// The 34 sub-modules below define tables that previously existed in prod only
// because scripts/migrate.mjs (raw SQL, the prod release_command) mirrors their
// DDL — they were NOT re-exported from this single drizzle schema source
// (drizzle.config.ts -> ./shared/schema.ts), so `drizzle-kit push` (the local
// db-build path) never created them, causing spurious local 500s (e.g. missing
// `solene_conversations`). These re-exports are PURELY ADDITIVE: no table
// definition is changed; they only make db:push match migrate.mjs. Alphabetized.
// ============================================================================
export * from "./schema/agent-codenames";
export * from "./schema/beatrice-regwatch";
export * from "./schema/external-watch";
export * from "./schema/iris-perf";
export * from "./schema/krieger-audit";
export * from "./schema/onboarding-funnel";
export * from "./schema/pax-verticals";
export * from "./schema/solene-adversarial-tests";
export * from "./schema/solene-agent-claims";
export * from "./schema/solene-agent-identity";
export * from "./schema/solene-capability-proposals";
export * from "./schema/solene-chat-config";
export * from "./schema/solene-confidence-observations";
// NOT re-exported: solene-constitutional-violations is a server-only audit
// table; server code imports it directly from the sub-module path and its
// table is created in prod by scripts/migrate.mjs. (Historically it also
// imported the server-only "@sovereign/immutables" alias — that import now
// lives in server/services/solene/constitutionalGuard.ts, enforced by
// scripts/check-boundaries.mjs.)
export * from "./schema/solene-conversations";
export * from "./schema/solene-counterfactuals";
export * from "./schema/solene-decision-traces";
export * from "./schema/solene-distributed-reasoning";
export * from "./schema/solene-embeddings";
export * from "./schema/solene-evidence-weights";
export * from "./schema/solene-failure-modes";
export * from "./schema/solene-learning-loop";
export * from "./schema/solene-memory-files";
export * from "./schema/solene-memory-retrieval";
export * from "./schema/solene-model-upgrade";
export * from "./schema/solene-morning-pulse";
export * from "./schema/solene-pipeline";
export * from "./schema/solene-plan-proposals";
export * from "./schema/solene-pre-call-decisions";
export * from "./schema/solene-session-tasks";
export * from "./schema/solene-speculations";
export * from "./schema/solene-token-economy";
export * from "./schema/soren-seo";
export * from "./schema/team-improvement";

// Wave A "Nothing lies" (founder ruling #12(c), 2026-07-29) — persisted
// feature state for services that previously ran on in-memory Maps:
// market watchlist entries/alerts + outreach A/B tests/outcomes. (The KYC
// request table lives in ./schema/compliance with its verification siblings.)
export * from "./schema/market-watchlist";
export * from "./schema/outreach-ab";

// The Evidence Fabric's one table (Master Audit BI13/BI14). EvidenceClaim is
// the atomic truth primitive: a source-backed assertion with provenance,
// observation time, freshness, rights and cost. The canonical "current answer"
// is a recomputable projection over these rows, produced by the deterministic
// policy in shared/evidence/claim.ts — not a column anything overwrites.
export * from "./schema/evidence";

// Decision Memory's one table (Master Audit BI20). A DecisionSnapshot freezes
// what was KNOWN when a consequential investment decision was made — resolved
// evidence with its claim ids, assumptions, alternatives, unknowns, actor and
// authority, and the Strategy Pack version in force. Immutable by contract:
// later evidence and later outcomes append context, they never rewrite it.
export * from "./schema/decision-snapshots";

// The consequential-action claim ledger (canonical law 8, BI74). One row per
// logical outward action under a unique (org, kind, key) index — the atomic
// claim that stops a retried job double-sending. Mutable operational state, NOT
// history: the immutable proof of an action is a receipt, a separate artifact.
export * from "./schema/outward-actions";

// The economics layer's one table (Master Audit BI12/BK24). A Scenario is a
// versioned, deterministic economic hypothesis: the engine that produced it,
// that engine's version, the verbatim inputs and the outputs. Immutable —
// re-running the maths inserts a new row; a stored scenario never changes.
export * from "./schema/scenarios";

// The learning layer's one table (Master Audit BI1/AA8). An Outcome records
// what ACTUALLY happened, referencing the DecisionSnapshot it graded. Variance
// is deliberately NOT a column — it is a pure projection over the scenario
// references the decision already froze (law 9: outcomes append, they do not
// rewrite history).
export * from "./schema/outcomes";

// The Reality Graph's first canonical object (Master Audit BI11/BI93). An
// Opportunity is a POTENTIAL action on a parcel — pre-commitment, where a Deal
// is the transaction process after commitment. Identity and lifecycle only: it
// owns no economics, because `scenarios`, `decision_snapshots` and `outcomes`
// already do. All three already accepted an `opportunity` subject that pointed
// at no table, and decisionStore.ts resolved that subject id AS a properties.id
// for want of anywhere else for it to point.
export * from "./schema/opportunity";

// VA task management and the org's SOP library (BLOCKERS B9, founder ruling
// 2026-08-13). The persistence layer `services/vaManagement.ts` declared as two
// unused string constants — `VA_TASKS_KEY` / `SOP_LIBRARY_KEY` — and never
// wrote. Tasks lived in `organizations.settings.va_tasks`, an array with no
// creator anywhere in the repo, which is why the metrics and audit-trail
// endpoints returned zeros that read as measurements.
export * from "./schema/va-tasks";
