/**
 * comms-email — extracted from the shared/schema.ts monolith on 2026-09-28
 * (DEFECT-0048) and re-exported through that barrel, so every
 * `import { … } from "@shared/schema"` is unchanged. Sections, verbatim:
 *   - EMAIL EVENTS + SUPPRESSIONS (SendGrid event webhook)
 *   - OUTBOUND EMAIL LOG — Tahoe E10 lifecycle email registry
 *   - MARKETING TOUCH — acquisition event substrate (Soren, 2026-06-06)
 *   - ELEONORA DELIVERABILITY — Phase 1 §10 / Week 7-8
 *   - VERIFIED SENDERS (Email & SMS)
 *   - TCPA / CAN-SPAM — EVIDENCE-GRADE CONSENT EVENTS
 *   - DIGEST SUBSCRIPTIONS
 *   - ACTIVITY EVENTS (Communication History Timeline)
 *   - DRIP CAMPAIGN SEQUENCES (Multi-Touch Automation)
 *   - EMAIL SENDER IDENTITIES
 *   - INBOX MESSAGES (Inbound Email Replies)
 *
 * Monolith tables are imported from "../schema" and used only lazily
 * (inside references(() => …)); the barrel's `export *` is hoisted, so this
 * module evaluates before the monolith's body and must never read one eagerly.
 */
import { pgTable, text, serial, integer, bigserial, boolean, timestamp, numeric, varchar, jsonb, index, uniqueIndex, primaryKey } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "../db/createInsertSchema";
import { z } from "zod";
import { campaigns, conversations, leads, organizations, teamMembers } from "../schema";

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
// ACTIVITY_EVENT_TYPES / ActivityEventType moved to shared/constants/activity.ts
// (runtime-free, so the client can import them without dragging the ORM).
export { ACTIVITY_EVENT_TYPES, type ActivityEventType } from "../constants/activity";

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

