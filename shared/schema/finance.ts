// ============================================================================
// SHARED/SCHEMA/FINANCE.TS
// ----------------------------------------------------------------------------
// Financial ledger (Pillar 1) — append-only signed-amount ledger, tracking-
// number assignments, per-provider cost catalog, BYOK secrets channel, and
// outreach mail shipments / shipment pieces (Pillar 3).
// Extracted from shared/schema.ts.
// ============================================================================

import {
  pgTable,
  text,
  serial,
  integer,
  bigint,
  bigserial,
  timestamp,
  varchar,
  jsonb,
  index,
  uniqueIndex,
  real,
  customType,
  primaryKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations } from "../schema";

// ===========================
// FINANCIAL LEDGER (Pillar 1)
// ===========================
//
// Append-only signed-amount ledger that captures every flow of money
// through the platform. The single source of truth for:
//   - per-bucket balances (tax / refund / profit / draw / opex_available)
//   - per-org contribution margin (revenue minus opex_spent)
//   - per-provider / per-feature spend attribution
//
// Design notes:
//
//   - amount_cents is a SIGNED bigint. Positive credits the bucket (revenue,
//     allocation in), negative debits it (opex spend, refund). Summing the
//     column for a given bucket gives the live balance — no separate
//     balances table to keep in sync.
//
//   - bucket is one of the five canonical names from
//     shared/billing/allocation-policy.ts. Stored as text so the column is
//     human-greppable in psql; validated at service boundary.
//
//   - category names the kind of flow (revenue | allocation | opex_spent |
//     refund | manual_transfer). Distinct from `bucket` so we can ask
//     questions like "all revenue rows last month" independently of which
//     bucket they hit.
//
//   - external_event_id is UNIQUE. This is the idempotency key — every
//     Stripe webhook, Lob postage event, Twilio message billed event posts
//     with a stable id, so retries collapse into a single insert. A 5-row
//     revenue split shares the same external_event_id with a `:row-N`
//     suffix to keep the unique constraint while still grouping the split.
//
//   - feature / provider / external_event_id are nullable for manual
//     postings (founder-initiated bucket transfers) where they don't apply.
//
//   - Indexes target the two hot read paths: (org, posted_at) for org
//     contribution-margin queries and (bucket, posted_at) for live balance
//     scans. The external_event_id unique index doubles as the idempotency
//     lookup.
export const financialLedger = pgTable("financial_ledger", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  // Organization the flow attributes to. Nullable for platform-level
  // postings that aren't customer-attributable (e.g. founder manual
  // transfers between buckets, platform-level credits).
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "set null" }),
  // Five-bucket name from allocation-policy.ts.
  bucket: text("bucket").notNull(),
  // Flow taxonomy: revenue | allocation | opex_spent | refund | manual_transfer.
  category: text("category").notNull(),
  // Signed cents. Positive credits, negative debits. bigint mode "number"
  // because no single posting will exceed 2^53 cents (~$90T) and downstream
  // arithmetic is simpler without BigInt coercion.
  amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
  // Feature the spend (or revenue) attributes to: "mail" | "sms" | "voice" |
  // "email" | "skip_trace" | "property_data" | "ai" | "infra" | "stripe_fee"
  // | "subscription" | "credit_topup" | etc. Free-form text; the founder UI
  // groups on this column.
  feature: text("feature"),
  // External provider name (Lob, Stripe, Twilio, Telnyx, SendGrid, OpenRouter,
  // ATTOM, Regrid, ElevenLabs, Fly, Neon, Sentry). NULL for internal flows.
  provider: text("provider"),
  // Idempotency anchor — the provider's own event id (Stripe event id, Lob
  // event id, Twilio message SID) prefixed with the provider name so two
  // providers can't collide. Allocation rows share the originating revenue
  // event id with a `:alloc-<bucket>` suffix.
  externalEventId: text("external_event_id").unique(),
  // Soft pointers — kept as integers (no FK so a deleted invoice/campaign
  // doesn't destroy ledger history).
  invoiceId: integer("invoice_id"),
  campaignId: integer("campaign_id"),
  // When the flow occurred (provider event timestamp, not insert time).
  postedAt: timestamp("posted_at", { withTimezone: true }).defaultNow().notNull(),
  // Who/what posted the row: "stripe_webhook" | "lob_webhook" | "founder:<id>"
  // | "system:<service-name>". Free-form text for audit traceability.
  postedBy: text("posted_by").notNull(),
  // Operator notes. NULL for system-generated rows.
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("financial_ledger_org_posted_idx").on(table.organizationId, table.postedAt),
  index("financial_ledger_bucket_posted_idx").on(table.bucket, table.postedAt),
  index("financial_ledger_posted_idx").on(table.postedAt),
  index("financial_ledger_category_posted_idx").on(table.category, table.postedAt),
  index("financial_ledger_provider_idx").on(table.provider),
]);

export type FinancialLedgerRow = typeof financialLedger.$inferSelect;
export type InsertFinancialLedgerRow = typeof financialLedger.$inferInsert;

// ── Tier 2B (one money spine) — ledger dead letters ─────────────────────────
//
// When a ledger posting (postRevenue / postRefund / postOpexSpent) fails at a
// call site that must never throw (the Stripe webhook handlers), the original
// args are captured here verbatim so the money is never silently lost. The
// hourly `ledger_dead_letter_replay` job re-dispatches pending rows through
// the same idempotent posting functions (external_event_id collisions make
// replay retry-safe), and raises an alert-spine finding when entries
// accumulate instead of draining.
//
//   - external_event_id is UNIQUE: one dead letter per failed event, no
//     matter how many times Stripe redelivers while the failure persists.
//   - payload is the exact PostRevenueArgs / PostRefundArgs / PostOpexArgs
//     object (Date fields serialized to ISO strings by jsonb).
//   - status: pending → replayed (success) | abandoned (attempts exhausted —
//     founder intervention required; the accumulation alert escalates).
export const ledgerDeadLetters = pgTable("ledger_dead_letters", {
  id: serial("id").primaryKey(),
  // Org the failed posting attributes to. Nullable to mirror financial_ledger
  // (platform-level postings aren't customer-attributable).
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "set null" }),
  // Which posting function failed: revenue | refund | opex.
  kind: text("kind").notNull(),
  // The idempotency anchor of the failed posting — also OUR dedupe key.
  externalEventId: text("external_event_id").notNull().unique(),
  // Verbatim args of the failed call, replayable as-is.
  payload: jsonb("payload").notNull(),
  lastError: text("last_error"),
  // Replay attempts so far (the original failed call is NOT counted).
  attempts: integer("attempts").notNull().default(0),
  // pending | replayed | abandoned
  status: text("status").notNull().default("pending"),
  lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
  replayedAt: timestamp("replayed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  // Org-leading per repo discipline; the replay scan + accumulation check
  // both filter on status first, so give them their own composite.
  index("ledger_dead_letters_org_status_idx").on(table.organizationId, table.status),
  index("ledger_dead_letters_status_created_idx").on(table.status, table.createdAt),
]);

export type LedgerDeadLetterRow = typeof ledgerDeadLetters.$inferSelect;
export type InsertLedgerDeadLetterRow = typeof ledgerDeadLetters.$inferInsert;

// ── Pillar 5: Communications Router ──────────────────────────────────────
// Tracking-number assignments. A "tracking number" is a phone number we
// rent (currently from Twilio) and assign to a specific (org, campaign)
// pair so inbound calls/SMS can be attributed back to the campaign that
// triggered them. Releasing a number lets us recycle it into the pool;
// idle numbers (no inbound activity within `comms.pool.auto_release_days`)
// are auto-released by the tracking-pool cron.
//
// `provider` is the carrier the number was rented from — "twilio" today,
// "telnyx" once the $3k-MRR trigger flips on. `releasedAt` IS NULL marks
// an active assignment; a non-null value freezes the row for audit but
// marks the number reusable.
export const trackingNumberAssignments = pgTable("tracking_number_assignments", {
  id: serial("id").primaryKey(),
  number: text("number").notNull(),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "set null" }),
  campaignId: integer("campaign_id"),
  // Provider that owns the underlying phone number ("twilio" | "telnyx" | "bandwidth").
  provider: text("provider").notNull(),
  assignedAt: timestamp("assigned_at", { withTimezone: true }).defaultNow().notNull(),
  // When set, the number is no longer attributing inbound to this org/campaign.
  releasedAt: timestamp("released_at", { withTimezone: true }),
  // Last time we observed an inbound SMS or call on this number — used by
  // the auto-release sweeper to decide when the number is idle.
  lastInboundAt: timestamp("last_inbound_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  // Active-lookup: finding the current owner of an inbound number means
  // "WHERE number = $1 AND released_at IS NULL". The composite covers it.
  index("tracking_number_assignments_number_released_idx").on(table.number, table.releasedAt),
  // Org timeline lookup.
  index("tracking_number_assignments_org_assigned_idx").on(table.organizationId, table.assignedAt),
]);

export type TrackingNumberAssignment = typeof trackingNumberAssignments.$inferSelect;
export type InsertTrackingNumberAssignment = typeof trackingNumberAssignments.$inferInsert;

// Observed per-provider unit costs. Refreshed by a periodic job that
// reconciles real provider invoices against our internal cost estimates,
// so router cost decisions stay accurate as carrier pricing drifts.
// Optional; the router falls back to hardcoded estimateCostCents() if
// no row exists.
export const commsProviderQuotes = pgTable("comms_provider_quotes", {
  id: serial("id").primaryKey(),
  provider: text("provider").notNull(),
  // ISO 3166-1 alpha-2 country code ("US" today, "CA"/"MX" later).
  destinationCountry: text("destination_country").notNull(),
  smsCostCents: integer("sms_cost_cents"),
  voiceCostCentsPerMin: integer("voice_cost_cents_per_min"),
  observedAt: timestamp("observed_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("comms_provider_quotes_provider_country_idx").on(table.provider, table.destinationCountry),
  index("comms_provider_quotes_observed_idx").on(table.observedAt),
]);

export type CommsProviderQuote = typeof commsProviderQuotes.$inferSelect;
export type InsertCommsProviderQuote = typeof commsProviderQuotes.$inferInsert;

// ─── Universal BYOK (Bring-Your-Own-Key) — Pillar 5 cross-cutting ─────────────
//
// Extends BYOK from the data-provider niche (organizations.byokSupport, the
// per-data-source pattern) to every paid channel in the platform:
//   twilio | telnyx | sendgrid | ses | lob | postgrid | openrouter |
//   anthropic | openai | batch_skiptracing | mapbox | s3
//
// Plaintext credentials NEVER leave the database in cleartext. The
// credentialKeyEncrypted bytea column stores the AES-256-GCM ciphertext
// produced by server/services/fieldEncryption.ts. We store the canonical
// "enc:v1:<base64>" envelope as bytes so dump tools that print TEXT columns
// don't accidentally leak the envelope into logs.
//
// credentialKeyFingerprint is a *non-secret* tail of the plaintext (last
// 4 chars) used only for "...x4az" UI display. Never sufficient to derive
// the plaintext.
//
// Active-credential semantics: exactly zero or one active row per (org,
// channel) pair. Revoking sets `revokedAt`; the partial UNIQUE index
// enforces "only one non-revoked row".
//
// When an active credential exists for (org, channel), spend on that
// channel must NOT debit the customer's opex bucket — the customer pays
// the provider directly, so AcreOS's contribution-margin math should skip
// that row entirely. See server/services/byok/toggle.ts +
// postOpexSpent call-sites.
export const byokCredentials = pgTable("byok_credentials", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  // Channel discriminator. Free-form text rather than enum so future
  // channels (mailgun, sendinblue, etc.) don't require a migration.
  channel: text("channel").notNull(),
  // AES-256-GCM ciphertext bytes. Decrypt via fieldEncryption.decrypt().
  credentialKeyEncrypted: customType<{ data: Buffer; driverData: Buffer }>({
    dataType() { return "bytea"; },
  })("credential_key_encrypted").notNull(),
  // Last 4 chars of plaintext for UI display ("...x4az"). NEVER full key.
  credentialKeyFingerprint: text("credential_key_fingerprint").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  lastUsedAt: timestamp("last_used_at"),
  revokedAt: timestamp("revoked_at"),
}, (table) => [
  index("byok_credentials_org_channel_idx").on(table.organizationId, table.channel),
  index("byok_credentials_channel_idx").on(table.channel),
  // Partial unique: at most one active credential per (org, channel).
  uniqueIndex("byok_credentials_active_uidx")
    .on(table.organizationId, table.channel)
    .where(sql`revoked_at IS NULL`),
]);

export type ByokCredential = typeof byokCredentials.$inferSelect;
export type InsertByokCredential = typeof byokCredentials.$inferInsert;

// Channels that accept BYOK. Keep in sync with key-vault.ts + ui rows.
export const BYOK_CHANNELS = [
  "twilio",
  "telnyx",
  "sendgrid",
  "ses",
  "lob",
  "postgrid",
  "openrouter",
  "anthropic",
  "openai",
  "batch_skiptracing",
  "mapbox",
  "s3",
] as const;
export type ByokChannel = (typeof BYOK_CHANNELS)[number];

// ────────────────────────────────────────────────────────────────────────────
// Pillar 3 — Outreach mail shipments (customer-facing /outreach/mail surface)
//
// One row per queued send batch. The 30-minute hold window means a row can
// move from "queued" → "cancelled" before any provider is hit; once leavesAt
// passes, the worker calls MailRouter.route() and updates the row in place.
// Per-piece rows live in `mailShipmentPieces` so the In-Flight tab can render
// per-recipient USPS scan timestamps + status chips without scanning a JSON
// blob.
// ────────────────────────────────────────────────────────────────────────────
export const mailShipments = pgTable("mail_shipments", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  createdByUserId: varchar("created_by_user_id"),
  // queued | cancelled | sending | sent | partial_failed | failed
  status: text("status").notNull().default("queued"),
  pieceType: text("piece_type").notNull(), // postcard_4x6 | postcard_6x9 | letter_10 | handwritten
  speed: text("speed").notNull(), // next_day | standard | batch_3d | batch_weekly | eddm_geo
  // Resolved provider name once the router has chosen — null while queued.
  provider: text("provider"),
  // Snapshot of the quote we showed the user when they hit Send. Locks the
  // cost so a mid-flight price drift can't surprise them.
  pieceCount: integer("piece_count").notNull(),
  perPieceCents: integer("per_piece_cents").notNull(),
  totalCents: integer("total_cents").notNull(),
  savedVsLobCents: integer("saved_vs_lob_cents").notNull().default(0),
  deliveryEtaDays: integer("delivery_eta_days"),
  // Free-text label the composer set ("Hidalgo absentees v3").
  label: text("label"),
  // Reference to the chosen template + copy snapshot.
  templateId: integer("template_id"),
  copySnapshot: text("copy_snapshot"),
  // Audience filter snapshot (JSON) — replayable for "preview all" and audit.
  audienceFilter: jsonb("audience_filter").$type<{
    leadListIds?: number[];
    savedViewIds?: number[];
    states?: string[];
    counties?: string[];
    acreageMin?: number;
    acreageMax?: number;
  }>(),
  // The 30-minute hold window. Worker only fires when leavesAt <= now and
  // status === 'queued'.
  queuedAt: timestamp("queued_at", { withTimezone: true }).defaultNow().notNull(),
  leavesAt: timestamp("leaves_at", { withTimezone: true }).notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  cancellationReason: text("cancellation_reason"),
  // The credit-pool debit taken at enqueue, persisted so BOTH the flusher
  // worker (on send failure) and the cancel path can refund this exact draw —
  // the guarantee that a shipment is never charged-without-sent.
  debitEventKey: text("debit_event_key"),
  debitedCents: integer("debited_cents"),
}, (table) => [
  index("mail_shipments_org_status_idx").on(table.organizationId, table.status),
  index("mail_shipments_leaves_at_idx").on(table.leavesAt),
]);

export type MailShipmentRow = typeof mailShipments.$inferSelect;
export type InsertMailShipmentRow = typeof mailShipments.$inferInsert;

export const mailShipmentPieces = pgTable("mail_shipment_pieces", {
  id: serial("id").primaryKey(),
  shipmentId: integer("shipment_id").references(() => mailShipments.id, { onDelete: "cascade" }).notNull(),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  leadId: integer("lead_id"),
  recipientName: text("recipient_name").notNull(),
  addressLine1: text("address_line1").notNull(),
  addressLine2: text("address_line2"),
  city: text("city").notNull(),
  state: text("state").notNull(),
  zip: text("zip").notNull(),
  // pending | printed | in_transit | delivered | returned | failed
  status: text("status").notNull().default("pending"),
  providerPieceId: text("provider_piece_id"),
  printedAt: timestamp("printed_at", { withTimezone: true }),
  inTransitAt: timestamp("in_transit_at", { withTimezone: true }),
  expectedDeliveryAt: timestamp("expected_delivery_at", { withTimezone: true }),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  returnedAt: timestamp("returned_at", { withTimezone: true }),
  qrScanCount: integer("qr_scan_count").notNull().default(0),
  inboundCallCount: integer("inbound_call_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("mail_shipment_pieces_shipment_idx").on(table.shipmentId),
  index("mail_shipment_pieces_org_status_idx").on(table.organizationId, table.status),
  index("mail_shipment_pieces_lead_idx").on(table.leadId),
]);

export type MailShipmentPiece = typeof mailShipmentPieces.$inferSelect;
export type InsertMailShipmentPiece = typeof mailShipmentPieces.$inferInsert;

