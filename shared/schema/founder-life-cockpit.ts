// ============================================================================
// SHARED/SCHEMA/FOUNDER-LIFE-COCKPIT.TS
// ----------------------------------------------------------------------------
// Lena (CFO/CIO) + Iris (CTO) + Beatrice (CRO) — Founder Life-Cockpit substrate.
//
// FOUNDER-SIDE ONLY. These tables are FOUNDER-SCOPED (keyed by `founder_user_id`,
// the Clerk user id), NOT organization-scoped customer data. They support Tom
// personally — taxes, income, deadlines, an encrypted document vault — alongside
// running AcreOS. This data:
//   - is gated behind requireFounder on every route,
//   - holds SENSITIVE personal data (W2s, possibly SSNs, financial records),
//   - is ENCRYPTED AT REST for any sensitive value (encrypted blob refs, SSN
//     last-4, dollar amounts) via server/services/fieldEncryption (AES-256-GCM),
//   - must NEVER appear on any customer surface, in any customer feature, or in
//     shared logs, and must NEVER be used to train or shape any customer feature
//     (Quinn's rule).
//
// Deliberately NOT keyed by organization_id — so it is structurally separated
// from the multi-tenant customer data path and does NOT trip (nor belong in)
// the L3 org-leading-index lint. Founder-personal, by construction.
//
// Mirror every table + index in scripts/migrate.mjs and migrations/0123_*.sql.
//
// SCOPE NOTE (this wave): FOUNDATION ONLY. The tax-computation / draft-return
// generation engine is the EXPLICIT next founder wave. Tom chose tax = prep +
// self-file package (NOT real IRS MeF e-file — that regulated project is
// deferred). He is MA-based; spouse has a W2; he has a day-job W2 + woodworking
// side income + (eventually) AcreOS draw.
// ============================================================================

import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// ─── founder_tax_profile ──────────────────────────────────────────────────────
// One row per (founder, tax year). Captures the lightweight intake profile that
// the NEXT wave's draft-return engine will read. No SSNs here — those live in the
// vault as encrypted document blobs; this table only flags whether spouse info
// is on file. State defaults to MA.
export const founderTaxProfile = pgTable(
  "founder_tax_profile",
  {
    id: serial("id").primaryKey(),
    founderUserId: text("founder_user_id").notNull(),
    taxYear: integer("tax_year").notNull(),
    // single | married_joint | married_separate | head_of_household | qualifying_widow
    filingStatus: text("filing_status").notNull().default("married_joint"),
    state: text("state").notNull().default("MA"),
    // Whether spouse income/info is part of this return. The spouse's actual
    // W2 lands in founder_documents (encrypted); this is just the on-file flag.
    hasSpouse: boolean("has_spouse").notNull().default(false),
    // Free-form notes from the founder OR from Lena's advisor stub (no PII).
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One profile per founder per tax year (intake is upserted on conflict).
    uniqueIndex("founder_tax_profile_user_year_uk").on(t.founderUserId, t.taxYear),
    index("founder_tax_profile_user_idx").on(t.founderUserId),
  ],
);

// ─── founder_documents ─────────────────────────────────────────────────────────
// The encrypted document vault. The actual file bytes are encrypted at rest with
// AES-256-GCM (server/services/fieldEncryption) and stored as a canonical
// "enc:v1:" envelope in `encrypted_blob`. We NEVER store plaintext SSNs or raw
// file bytes; `encryption_kid` records which key-ring kid sealed the blob so it
// survives key rotation. `byte_size` is the PLAINTEXT length (for UI display),
// never the secret itself.
export const founderDocuments = pgTable(
  "founder_documents",
  {
    id: serial("id").primaryKey(),
    founderUserId: text("founder_user_id").notNull(),
    // w2 | 1099 | prior_return | receipt | statement | other
    docType: text("doc_type").notNull().default("other"),
    // Human label, e.g. "2025 W2 — Acme Corp (self)". NO raw SSN in the label.
    label: text("label").notNull(),
    taxYear: integer("tax_year"),
    // The encrypted file payload (enc:v1: envelope of base64 file bytes).
    encryptedBlob: text("encrypted_blob").notNull(),
    // Key-ring kid that sealed this blob (for rotation). "default" in single-key mode.
    encryptionKid: text("encryption_kid").notNull().default("default"),
    // Original filename + mime, for download UX. Filename is treated as
    // non-sensitive metadata (founder-chosen on upload).
    fileName: text("file_name"),
    mimeType: text("mime_type"),
    byteSize: integer("byte_size").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("founder_documents_user_created_idx").on(t.founderUserId, t.createdAt),
    index("founder_documents_user_type_idx").on(t.founderUserId, t.docType),
    index("founder_documents_user_year_idx").on(t.founderUserId, t.taxYear),
  ],
);

// ─── founder_obligations ───────────────────────────────────────────────────────
// Deadline / obligation tracker — tax filing dates, legal deadlines, financial
// to-dos. No sensitive values; this is a personal task radar.
export const founderObligations = pgTable(
  "founder_obligations",
  {
    id: serial("id").primaryKey(),
    founderUserId: text("founder_user_id").notNull(),
    title: text("title").notNull(),
    // tax | legal | financial
    obligationType: text("obligation_type").notNull().default("tax"),
    dueDate: timestamp("due_date", { withTimezone: true }),
    // open | done | dismissed
    status: text("status").notNull().default("open"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("founder_obligations_user_due_idx").on(t.founderUserId, t.dueDate),
    index("founder_obligations_user_status_idx").on(t.founderUserId, t.status),
  ],
);

// ─── founder_income_sources ────────────────────────────────────────────────────
// Blended income picture: W2 (self), W2 (spouse), AcreOS draw, side income
// (woodworking). The annual amount is SENSITIVE and stored ENCRYPTED
// (`encrypted_amount`, an enc:v1: envelope of the rounded whole-dollar amount as
// a string). We never store the raw number in the clear. The quarterly-estimate
// radar lights up off these rows once AcreOS pays Tom a draw.
export const founderIncomeSources = pgTable(
  "founder_income_sources",
  {
    id: serial("id").primaryKey(),
    founderUserId: text("founder_user_id").notNull(),
    taxYear: integer("tax_year").notNull(),
    // w2_self | w2_spouse | acreos_draw | side_income | other
    sourceType: text("source_type").notNull().default("w2_self"),
    // Display label, e.g. "Day job — Acme Corp". No PII.
    label: text("label").notNull(),
    // Encrypted whole-dollar annual amount (enc:v1: envelope of a string).
    // Nullable: a source can be tracked before its amount is known.
    encryptedAmount: text("encrypted_amount"),
    encryptionKid: text("encryption_kid").notNull().default("default"),
    // Whether withholding is handled at source (W2) vs. needs quarterly estimates.
    withholdingAtSource: boolean("withholding_at_source").notNull().default(true),
    // 0126 — W-2/1099 box intake. Federal income tax withheld (W-2 box 2) and
    // state income tax withheld (W-2 box 17) for THIS source. SENSITIVE → stored
    // ENCRYPTED (enc:v1: envelope of the rounded whole-dollar amount as a string),
    // exactly like encryptedAmount. Nullable: a source can be tracked before its
    // withholding boxes are confirmed. The draft engine reads these to estimate
    // refund vs. balance due.
    encryptedFederalWithheld: text("encrypted_federal_withheld"),
    encryptedStateWithheld: text("encrypted_state_withheld"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("founder_income_sources_user_year_idx").on(t.founderUserId, t.taxYear),
    index("founder_income_sources_user_type_idx").on(t.founderUserId, t.sourceType),
  ],
);

// ─── founder_tax_returns ─────────────────────────────────────────────────────
// 0126 — Stores a COMPUTED draft return (federal 1040 + MA Form 1 estimate)
// produced by server/services/founder/taxEngine.ts. One row per (founder, tax
// year, version): re-computing appends a new row so the founder keeps a history
// and can see when figures changed (e.g. after correcting a W-2 box).
//
// The full computed draft is a structured JSON document with line-by-line
// figures + basis. Those figures are DERIVED from already-encrypted income
// amounts, so the dollar values are not "new" secrets — but because the draft is
// nonetheless sensitive personal-tax data, the entire payload is stored
// ENCRYPTED at rest (enc:v1: envelope of the JSON string) and NEVER logged.
//
// `status` tracks the founder's filing workflow:
//   draft     — freshly computed, under review
//   reviewed  — founder has eyeballed the figures
//   filed     — founder has transcribed + filed externally (we never e-file)
// Every dollar-valued figure (payload + headline numbers) is encrypted; nothing
// dollar-valued is ever stored in plaintext.
export const founderTaxReturns = pgTable(
  "founder_tax_returns",
  {
    id: serial("id").primaryKey(),
    founderUserId: text("founder_user_id").notNull(),
    taxYear: integer("tax_year").notNull(),
    // Monotonic per (founder, year): each recompute is a new version.
    version: integer("version").notNull().default(1),
    // single | married_joint | ... (snapshot of profile at compute time).
    filingStatus: text("filing_status").notNull().default("married_joint"),
    state: text("state").notNull().default("MA"),
    // The full computed DraftReturn JSON, encrypted at rest.
    encryptedPayload: text("encrypted_payload").notNull(),
    encryptionKid: text("encryption_kid").notNull().default("default"),
    // Encrypted headline figures (whole-dollar strings) for quick list display
    // without decrypting the whole payload. Still never plaintext.
    encryptedFederalTotalTax: text("encrypted_federal_total_tax"),
    encryptedFederalRefundOrOwed: text("encrypted_federal_refund_or_owed"),
    encryptedStateTotalTax: text("encrypted_state_total_tax"),
    encryptedStateRefundOrOwed: text("encrypted_state_refund_or_owed"),
    // True if any rule table used was provisional (unreleased year). Non-secret.
    provisional: boolean("provisional").notNull().default(false),
    // draft | reviewed | filed
    status: text("status").notNull().default("draft"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("founder_tax_returns_user_year_idx").on(t.founderUserId, t.taxYear),
    uniqueIndex("founder_tax_returns_user_year_version_uk").on(
      t.founderUserId,
      t.taxYear,
      t.version,
    ),
  ],
);

export type FounderTaxProfile = typeof founderTaxProfile.$inferSelect;
export type InsertFounderTaxProfile = typeof founderTaxProfile.$inferInsert;
export type FounderDocument = typeof founderDocuments.$inferSelect;
export type InsertFounderDocument = typeof founderDocuments.$inferInsert;
export type FounderObligation = typeof founderObligations.$inferSelect;
export type InsertFounderObligation = typeof founderObligations.$inferInsert;
export type FounderIncomeSource = typeof founderIncomeSources.$inferSelect;
export type InsertFounderIncomeSource = typeof founderIncomeSources.$inferInsert;
export type FounderTaxReturn = typeof founderTaxReturns.$inferSelect;
export type InsertFounderTaxReturn = typeof founderTaxReturns.$inferInsert;
