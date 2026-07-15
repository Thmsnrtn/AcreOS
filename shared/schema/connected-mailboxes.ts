/**
 * Connected mailboxes — R1c native business inbox (2026-07-15).
 *
 * Per-(org, operator) customer mailbox connections (Gmail / Outlook / IMAP).
 *
 * MINIMAL-CUSTODY POSTURE (reshape doctrine — connect, don't custody):
 * this table stores ONLY the encrypted OAuth tokens + non-secret metadata.
 * Message bodies are NEVER persisted here — the native inbox reads mail
 * ON-DEMAND through the customer's own connection and displays it live. The
 * customer's mailbox stays the system of record; AcreOS is the intelligent
 * lens over it. (Full-sync — persisting a mailbox copy — is a deliberate,
 * founder-visible custody escalation and is intentionally NOT built here.)
 *
 * Tokens are AES-256-GCM envelopes stored as bytea (same discipline as
 * byokCredentials): never logged, decrypted only in-memory to make the
 * upstream Gmail/Graph call.
 */

import { pgTable, serial, integer, text, timestamp, jsonb, index, uniqueIndex, customType } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

export const connectedMailboxes = pgTable(
  "connected_mailboxes",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").notNull(),
    /** The operator (users.id varchar UUID) who connected this mailbox. */
    userId: text("user_id").notNull(),
    /** "gmail" | "outlook" | "imap". */
    provider: text("provider").notNull(),
    /** The connected address, e.g. "you@yourbusiness.com". Non-secret. */
    emailAddress: text("email_address").notNull(),
    /** AES-256-GCM envelope (bytea). Null until the OAuth callback stores it. */
    accessTokenEncrypted: bytea("access_token_encrypted"),
    refreshTokenEncrypted: bytea("refresh_token_encrypted"),
    tokenExpiresAt: timestamp("token_expires_at"),
    /** Space-delimited granted scopes, for capability checks. Non-secret. */
    scopes: text("scopes"),
    /** "connected" | "error" | "revoked". */
    status: text("status").notNull().default("connected"),
    /** Last non-secret error string for the UI ("token refresh failed"). */
    lastError: text("last_error"),
    /**
     * Per-account fine-tuning — label/folder filters, signature, AI reply
     * tone, quiet hours. NON-secret; drives the fine-tunable native inbox.
     */
    settings: jsonb("settings").$type<Record<string, unknown>>().default({}),
    lastSyncedAt: timestamp("last_synced_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    revokedAt: timestamp("revoked_at"),
  },
  (t) => [
    index("connected_mailboxes_org_idx").on(t.organizationId),
    index("connected_mailboxes_user_idx").on(t.userId),
    // At most one active connection per (org, address).
    uniqueIndex("connected_mailboxes_active_uidx")
      .on(t.organizationId, t.emailAddress)
      .where(sql`revoked_at IS NULL`),
  ],
);

export type ConnectedMailbox = typeof connectedMailboxes.$inferSelect;
export type InsertConnectedMailbox = typeof connectedMailboxes.$inferInsert;

/** Providers that connect via OAuth (IMAP uses app-password creds instead). */
export const MAILBOX_OAUTH_PROVIDERS = ["gmail", "outlook"] as const;
export type MailboxOAuthProvider = (typeof MAILBOX_OAUTH_PROVIDERS)[number];
