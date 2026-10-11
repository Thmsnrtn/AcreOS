// ============================================================================
// SHARED/SCHEMA/GROWTH.TS — W5b growth: A2P 10DLC registration status and
// reversible lead imports.
// ----------------------------------------------------------------------------
// Migration 0280. Mirrors scripts/migrate.mjs STATEMENTS.
//
// WHY TWO NEW TABLES (table-count +2, a conscious "yes we need this")
// ---------------------------------------------------------------------------
// `sms_a2p_registrations` — one row per org: the state of the org's OWN brand
//   and campaign registration with its OWN SMS provider, and WHERE that state
//   came from (`provider_api` vs `self_reported`). Checked against code:
//   `organization_integrations` holds credentials, not a carrier registration;
//   `organizations.settings` is read on nearly every request and has no
//   provenance per field; `byok_credentials` is a secret vault. The send
//   chokepoint (sendOrgSMS) reads this row, so it needs a real, indexed home.
// `lead_import_batches` — what one import created, so it can be undone.
//   `import_jobs` belongs to the background migration worker, stores the
//   payload bytes, and has no list of created rows; leads carry `source`
//   ("csv_import") but no batch, so "undo that import" could only delete every
//   imported lead the org ever had. The lead ids are an integer[] on the batch
//   (not a join table) because a batch is written once and read whole.
// ============================================================================

import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations } from "../schema";

export const smsA2pRegistrations = pgTable(
  "sms_a2p_registrations",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    /** The org's own SMS provider ("twilio", or another named provider when self-reported). */
    provider: text("provider").notNull(),
    /** '10dlc' (US long code) or 'toll_free' (toll-free verification instead). */
    numberKind: text("number_kind").notNull().default("10dlc"),
    /** The sending number this registration covers (E.164), when known. */
    phoneNumber: text("phone_number"),
    /** Normalised: 'not_started' | 'pending' | 'approved' | 'failed'. */
    brandStatus: text("brand_status").notNull().default("not_started"),
    /** Normalised: 'not_started' | 'pending' | 'approved' | 'failed'. */
    campaignStatus: text("campaign_status").notNull().default("not_started"),
    /** 'provider_api' (read from the provider) | 'self_reported' (the customer told us). */
    statusSource: text("status_source").notNull(),
    brandSid: text("brand_sid"),
    campaignSid: text("campaign_sid"),
    messagingServiceSid: text("messaging_service_sid"),
    /** The provider's own words (raw statuses, error list), for the guide to show. */
    providerDetail: jsonb("provider_detail").$type<Record<string, unknown>>(),
    checkedAt: timestamp("checked_at").notNull(),
    reportedBy: text("reported_by"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("sms_a2p_registrations_org_uq").on(t.organizationId)],
);

export type SmsA2pRegistration = typeof smsA2pRegistrations.$inferSelect;

export const leadImportBatches = pgTable(
  "lead_import_batches",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    /** The detected or chosen source format id (shared/leads/importFormats.ts), or 'mapped'. */
    sourceFormat: text("source_format").notNull(),
    fileName: text("file_name"),
    rowCount: integer("row_count").notNull().default(0),
    importedCount: integer("imported_count").notNull().default(0),
    skippedCount: integer("skipped_count").notNull().default(0),
    suppressedCount: integer("suppressed_count").notNull().default(0),
    leadIds: integer("lead_ids")
      .array()
      .notNull()
      .default(sql`'{}'::integer[]`),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    undoneAt: timestamp("undone_at"),
    undoneBy: text("undone_by"),
    /** What undo removed and what it kept (and why) — the receipt. */
    undoResult: jsonb("undo_result").$type<{ removed: number; kept: Array<{ leadId: number; reason: string }> }>(),
  },
  (t) => [index("lead_import_batches_org_created_idx").on(t.organizationId, t.createdAt)],
);

export type LeadImportBatch = typeof leadImportBatches.$inferSelect;
