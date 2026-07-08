// ============================================================================
// SHARED/SCHEMA/PLATFORM-CONNECTIONS.TS
// ----------------------------------------------------------------------------
// Platform Connections — founder-entered credentials for the accounts the
// PLATFORM ITSELF runs on (GitHub, paging, Anthropic, Stripe, Lob, ad
// accounts …). This is the native "connect an account from within AcreOS"
// store: DB-first with env fallback, so pasting a key in the Control Center
// works immediately — no Fly secret, no redeploy.
//
// Distinct from byok_credentials (CUSTOMER-org keys): these rows are
// platform-scoped (no organization_id) and only the founder surface touches
// them. Mirrors the BYOK vault's storage discipline exactly:
//   • AES-256-GCM envelope in a bytea column (never TEXT — dump tools that
//     print text columns can't accidentally leak it into logs)
//   • last-4 fingerprint for display, NEVER the plaintext
//   • at most one ACTIVE row per (provider, field) — partial unique index;
//     setting a new value revokes the prior in the same transaction
//   • non-secret fields (a repo slug, an ntfy topic, an email) live in
//     value_plain so they stay greppable/auditable
//
// Verify bookkeeping reuses the existing integration_status table.
// Mirror in scripts/migrate.mjs (migration 0189).
// ============================================================================

import {
  pgTable,
  text,
  serial,
  timestamp,
  index,
  uniqueIndex,
  customType,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const platformConnections = pgTable(
  "platform_connections",
  {
    id: serial("id").primaryKey(),
    /** Catalog key (connectionRegistry) — e.g. "github", "paging", "meta_ads". */
    provider: text("provider").notNull(),
    /** Field within the provider — e.g. "token", "topic", "oauth_access_token". */
    field: text("field").notNull(),
    /** AES-256-GCM envelope bytes for SECRET fields. Null for plain fields. */
    secretEncrypted: customType<{ data: Buffer; driverData: Buffer }>({
      dataType() { return "bytea"; },
    })("secret_encrypted"),
    /** Plaintext value for NON-secret fields (topic names, repo slugs, emails). */
    valuePlain: text("value_plain"),
    /** Last 4 chars of a secret for UI display ("…x4az"). NEVER the full key. */
    fingerprint: text("fingerprint"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: text("updated_by"),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    index("platform_connections_provider_idx").on(t.provider, t.field),
    uniqueIndex("platform_connections_active_uidx")
      .on(t.provider, t.field)
      .where(sql`revoked_at IS NULL`),
  ],
);

export type PlatformConnectionRow = typeof platformConnections.$inferSelect;
export type InsertPlatformConnectionRow = typeof platformConnections.$inferInsert;
