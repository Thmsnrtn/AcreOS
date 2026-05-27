// ============================================================================
// SHARED/SCHEMA/PUBLIC-API.TS
// ----------------------------------------------------------------------------
// Public API v0 — org API keys, API-key usage log, webhook subscriptions,
// webhook delivery log. Extracted from shared/schema.ts.
// ============================================================================

import {
  pgTable,
  text,
  serial,
  integer,
  bigserial,
  boolean,
  timestamp,
  jsonb,
  index,
  primaryKey,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { organizations } from "../schema";

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API v0 (Lens 50)
// ─────────────────────────────────────────────────────────────────────────────
//
// Scope: scaffold only — these tables back the not-yet-mounted /api/v1/* routes.
// The public surface is intentionally not registered in server/routes.ts yet
// (per the v0 design spec: "Don't open public API at all — just scaffold").
//
// Tables:
//   - api_keys              — per-org bearer tokens with scopes & rate limits
//   - api_key_usage         — append-only log of every authenticated call
//   - webhook_subscriptions — customer-registered outbound endpoints
//   - webhook_delivery_log  — per-attempt delivery ledger (HMAC-signed, retried)
//
// Note: an internal `webhook_deliveries` table already exists (line ~14143) for
// the older Slack/Teams dispatcher. The new `webhook_delivery_log` is keyed to
// a subscription row instead of a raw URL, so we keep both — additive only.

export const apiKeys = pgTable("api_keys", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id")
    .references(() => organizations.id, { onDelete: "cascade" })
    .notNull(),
  // Human-readable label shown in the settings UI ("Zapier prod", "Make.com").
  name: text("name").notNull(),
  // Last 4 of the plaintext token for UI display ("ak_live_…•••3f9c").
  // The full plaintext is never persisted — only this hint + the bcrypt hash.
  prefix: text("prefix").notNull(),
  // bcrypt hash of the full plaintext token. Verified with timing-safe compare
  // in server/middleware/requireApiKey.ts.
  hashedKey: text("hashed_key").notNull(),
  // Subset of the scope vocabulary in server/middleware/requireApiKey.ts.
  scopes: jsonb("scopes").$type<string[]>().notNull().default([]),
  // Per-key override of the tier-default hourly cap. Null = use org tier default.
  rateLimit: integer("rate_limit"),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdBy: text("created_by").notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  revokedBy: text("revoked_by"),
  revokedReason: text("revoked_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("api_keys_org_idx").on(table.organizationId),
  index("api_keys_hash_idx").on(table.hashedKey),
  index("api_keys_org_revoked_idx").on(table.organizationId, table.revokedAt),
]);

export const apiKeyUsage = pgTable("api_key_usage", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  apiKeyId: integer("api_key_id")
    .references(() => apiKeys.id, { onDelete: "cascade" })
    .notNull(),
  organizationId: integer("organization_id")
    .references(() => organizations.id, { onDelete: "cascade" })
    .notNull(),
  method: text("method").notNull(),
  path: text("path").notNull(),
  statusCode: integer("status_code").notNull(),
  durationMs: integer("duration_ms").notNull(),
  // Truncated remote address — full IP not persisted (privacy + carrier NAT
  // makes it low-signal anyway, see feedback_rate_limit_ip_keying.md).
  remoteAddrPrefix: text("remote_addr_prefix"),
  userAgent: text("user_agent"),
  requestId: text("request_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("api_key_usage_key_created_idx").on(table.apiKeyId, table.createdAt),
  index("api_key_usage_org_created_idx").on(table.organizationId, table.createdAt),
]);

export const webhookSubscriptions = pgTable("webhook_subscriptions", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id")
    .references(() => organizations.id, { onDelete: "cascade" })
    .notNull(),
  url: text("url").notNull(),
  // Subset of: lead.created, lead.updated, property.created, property.updated,
  // deal.created, deal.updated, deal.closed, note.created.
  events: jsonb("events").$type<string[]>().notNull().default([]),
  // 32-byte hex secret used for HMAC-SHA256 signing of every delivery.
  // Persisted plaintext (per Stripe/Plaid convention) so the customer can
  // verify on their end without us holding it asymmetrically.
  signingSecret: text("signing_secret").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  // After this many consecutive failed deliveries we auto-disable the
  // endpoint and require the customer to re-enable from /settings/api-keys.
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  lastFailureAt: timestamp("last_failure_at", { withTimezone: true }),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("webhook_subs_org_idx").on(table.organizationId),
  index("webhook_subs_org_active_idx").on(table.organizationId, table.isActive),
]);

export const webhookDeliveryLog = pgTable("webhook_delivery_log", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  subscriptionId: integer("subscription_id")
    .references(() => webhookSubscriptions.id, { onDelete: "cascade" })
    .notNull(),
  organizationId: integer("organization_id")
    .references(() => organizations.id, { onDelete: "cascade" })
    .notNull(),
  eventId: text("event_id").notNull(), // uuid — stable across retries
  eventType: text("event_type").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  attemptNumber: integer("attempt_number").notNull().default(1),
  status: text("status").notNull().default("pending"), // pending | succeeded | failed | dlq
  statusCode: integer("status_code"),
  responseBody: text("response_body"),
  errorMessage: text("error_message"),
  nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("webhook_delivery_log_sub_idx").on(table.subscriptionId),
  index("webhook_delivery_log_event_idx").on(table.eventId),
  index("webhook_delivery_log_next_retry_idx").on(table.nextRetryAt),
  index("webhook_delivery_log_org_created_idx").on(table.organizationId, table.createdAt),
]);

export const insertApiKeySchema = createInsertSchema(apiKeys).omit({
  id: true, createdAt: true, updatedAt: true, hashedKey: true, prefix: true,
  lastUsedAt: true, revokedAt: true, revokedBy: true, revokedReason: true,
});
export const insertWebhookSubscriptionSchema = createInsertSchema(webhookSubscriptions).omit({
  id: true, createdAt: true, updatedAt: true, signingSecret: true,
  consecutiveFailures: true, lastSuccessAt: true, lastFailureAt: true,
});

export type ApiKey = typeof apiKeys.$inferSelect;
export type InsertApiKey = typeof apiKeys.$inferInsert;
export type ApiKeyUsage = typeof apiKeyUsage.$inferSelect;
export type WebhookSubscription = typeof webhookSubscriptions.$inferSelect;
export type InsertWebhookSubscription = typeof webhookSubscriptions.$inferInsert;
export type WebhookDeliveryLog = typeof webhookDeliveryLog.$inferSelect;
