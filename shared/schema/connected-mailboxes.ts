/**
 * Connected mailboxes — R1c native business inbox (2026-07-15).
 *
 * Per-(org, operator) customer mailbox connections (Gmail / Outlook).
 *
 * MINIMAL-CUSTODY AT ITS FLOOR (reshape doctrine — connect, don't custody):
 * this table stores NO tokens at all. The customer links their mailbox
 * through Clerk (Clerk owns OAuth); Clerk holds the tokens and AcreOS reads
 * a fresh one on-demand (see server/services/mailbox/clerkMailbox.ts). This
 * row is only the org-scoped record of "which mailbox, whose, and its
 * fine-tuning settings" — never a credential and never a copy of the mail.
 */

import { pgTable, serial, integer, text, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const connectedMailboxes = pgTable(
  "connected_mailboxes",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").notNull(),
    /** The operator (users.id varchar UUID) who linked this mailbox via Clerk. */
    userId: text("user_id").notNull(),
    /** "gmail" | "outlook". */
    provider: text("provider").notNull(),
    /** The connected address, e.g. "you@yourbusiness.com". Non-secret. */
    emailAddress: text("email_address").notNull(),
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
