/**
 * configManager — Platform Credential Manager
 *
 * Stores founder-supplied credentials encrypted in the `platform_config` DB table
 * and patches process.env at startup so all existing code continues to work
 * without modification.
 *
 * Encryption: AES-256-GCM using the FIELD_ENCRYPTION_KEY env var (if set) or
 * a runtime-generated key stored in the DB itself (bootstrap key).
 */

import { db } from "../db";
import { platformConfig } from "@shared/schema";
import { eq } from "drizzle-orm";
import { logger } from "../utils/logger";
import { encrypt as canonicalEncrypt, decrypt as canonicalDecrypt } from "./fieldEncryption";

// ─── Encryption ──────────────────────────────────────────────────────────────
//
// As of the encryption-consolidation refactor (Aravind audit §3.1) these
// helpers delegate to the canonical module at services/fieldEncryption.ts.
// New writes emit the canonical envelope ("enc:v1:..."). Reads remain
// forward-compatible with the legacy 3-segment shape ("iv:tag:ct") that
// existing platform_config rows, encrypted EINs, and skip-trace envelopes
// still carry, because canonicalDecrypt() recognizes both.

export function encryptValue(plaintext: string): string {
  return canonicalEncrypt(plaintext);
}

export function decryptValue(ciphertext: string): string {
  return canonicalDecrypt(ciphertext);
}

// ─── Config Manager ──────────────────────────────────────────────────────────

export interface ConfigEntry {
  key: string;
  service: string;
  label: string;
  isSecret: boolean;
  isRequired: boolean;
  validationStatus?: string | null;
  validationMessage?: string | null;
  validatedAt?: Date | null;
  hasValue: boolean;          // true if set (from env or DB)
  source: "env" | "db" | "missing";
  maskedValue?: string;       // last 4 chars for display
}

export async function loadConfigToEnv(): Promise<void> {
  try {
    const rows = await db.select().from(platformConfig);
    let patched = 0;
    for (const row of rows) {
      if (!row.encryptedValue) continue;
      // Only patch if not already set in environment (env takes precedence)
      if (process.env[row.key]) continue;
      try {
        const plaintext = decryptValue(row.encryptedValue);
        process.env[row.key] = plaintext;
        patched++;
      } catch (e) {
        logger.warn(`[configManager] Failed to decrypt config key: ${row.key}`);
      }
    }
    if (patched > 0) {
      logger.info(`[configManager] Patched ${patched} credentials from DB into process.env`);
    }
  } catch (e) {
    // DB might not be ready at startup — this is non-fatal
    logger.warn("[configManager] Could not load config from DB (table may not exist yet)", { metadata: { detail: (e as Error).message } });
  }
}

export async function saveCredential(
  key: string,
  value: string,
  meta: { service: string; label: string; isSecret?: boolean; isRequired?: boolean }
): Promise<void> {
  const encrypted = encryptValue(value);
  // Also patch into current process.env immediately
  process.env[key] = value;

  await db
    .insert(platformConfig)
    .values({
      key,
      encryptedValue: encrypted,
      service: meta.service,
      label: meta.label,
      isSecret: meta.isSecret ?? true,
      isRequired: meta.isRequired ?? false,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: platformConfig.key,
      set: {
        encryptedValue: encrypted,
        validationStatus: null,
        validationMessage: null,
        validatedAt: null,
        updatedAt: new Date(),
      },
    });
}

export async function deleteCredential(key: string): Promise<void> {
  await db.delete(platformConfig).where(eq(platformConfig.key, key));
  delete process.env[key];
}

export async function markValidated(key: string, status: "ok" | "error", message: string): Promise<void> {
  await db
    .update(platformConfig)
    .set({ validationStatus: status, validationMessage: message, validatedAt: new Date() })
    .where(eq(platformConfig.key, key));
}

export async function getConfigStatus(): Promise<ConfigEntry[]> {
  const dbRows = await db.select().from(platformConfig);
  const dbMap = new Map(dbRows.map(r => [r.key, r]));

  const allKeys = CREDENTIAL_DEFINITIONS;
  return allKeys.map(def => {
    const dbRow = dbMap.get(def.key);
    const envVal = process.env[def.key];
    const hasValue = !!(envVal || dbRow?.encryptedValue);
    const source: "env" | "db" | "missing" = envVal ? "env" : dbRow?.encryptedValue ? "db" : "missing";

    let maskedValue: string | undefined;
    if (hasValue && def.isSecret) {
      const raw = envVal || "••••••";
      maskedValue = raw.length > 8 ? `${"•".repeat(raw.length - 4)}${raw.slice(-4)}` : "••••••";
    }

    return {
      key: def.key,
      service: def.service,
      label: def.label,
      isSecret: def.isSecret,
      isRequired: def.isRequired,
      hasValue,
      source,
      maskedValue,
      validationStatus: dbRow?.validationStatus ?? null,
      validationMessage: dbRow?.validationMessage ?? null,
      validatedAt: dbRow?.validatedAt ?? null,
    };
  });
}

// ─── Credential Definitions ───────────────────────────────────────────────────
// Canonical list of all credentials the setup wizard manages.

export const CREDENTIAL_DEFINITIONS: Array<{
  key: string;
  service: string;
  label: string;
  isSecret: boolean;
  isRequired: boolean;
  hint: string;
  docUrl?: string;
}> = [
  // Core
  { key: "DATABASE_URL", service: "core", label: "PostgreSQL URL", isSecret: true, isRequired: true, hint: "postgresql://user:pass@host:5432/dbname" },
  { key: "SESSION_SECRET", service: "core", label: "Session Secret (≥64 chars)", isSecret: true, isRequired: true, hint: "Auto-generate below" },
  { key: "APP_URL", service: "core", label: "App URL", isSecret: false, isRequired: true, hint: "https://yourdomain.com" },
  { key: "FOUNDER_EMAIL", service: "core", label: "Founder Email", isSecret: false, isRequired: true, hint: "founder@yourdomain.com" },
  { key: "FIELD_ENCRYPTION_KEY", service: "core", label: "Field Encryption Key (64 hex chars)", isSecret: true, isRequired: false, hint: "Auto-generate below" },
  // AI
  { key: "AI_INTEGRATIONS_OPENROUTER_API_KEY", service: "openrouter", label: "OpenRouter API Key", isSecret: true, isRequired: true, hint: "sk-or-...", docUrl: "https://openrouter.ai/keys" },
  { key: "OPENAI_API_KEY", service: "openai", label: "OpenAI API Key (fallback)", isSecret: true, isRequired: false, hint: "sk-...", docUrl: "https://platform.openai.com/api-keys" },
  // Payments
  { key: "STRIPE_SECRET_KEY", service: "stripe", label: "Stripe Secret Key", isSecret: true, isRequired: true, hint: "sk_live_... or sk_test_...", docUrl: "https://dashboard.stripe.com/apikeys" },
  { key: "STRIPE_PUBLISHABLE_KEY", service: "stripe", label: "Stripe Publishable Key", isSecret: false, isRequired: true, hint: "pk_live_... or pk_test_..." },
  { key: "STRIPE_WEBHOOK_SECRET", service: "stripe", label: "Stripe Webhook Secret", isSecret: true, isRequired: true, hint: "whsec_..." },
  // Email
  { key: "AWS_ACCESS_KEY_ID", service: "aws", label: "AWS Access Key ID", isSecret: false, isRequired: true, hint: "AKIA..." },
  { key: "AWS_SECRET_ACCESS_KEY", service: "aws", label: "AWS Secret Access Key", isSecret: true, isRequired: true, hint: "..." },
  { key: "AWS_REGION", service: "aws", label: "AWS Region", isSecret: false, isRequired: true, hint: "us-east-1" },
  { key: "AWS_SES_FROM_EMAIL", service: "aws", label: "SES From Email", isSecret: false, isRequired: true, hint: "no-reply@yourdomain.com" },
  // Maps
  { key: "VITE_MAPBOX_ACCESS_TOKEN", service: "mapbox", label: "Mapbox Access Token", isSecret: true, isRequired: false, hint: "pk.eyJ1...", docUrl: "https://account.mapbox.com/access-tokens/" },
  // Direct Mail
  { key: "LOB_API_KEY", service: "lob", label: "Lob API Key (direct mail)", isSecret: true, isRequired: false, hint: "test_... or live_...", docUrl: "https://dashboard.lob.com/settings/api-keys" },
  // Wave B — delivery-event ingest. Lob signs each webhook POST with
  // HMAC-SHA256 over `${timestamp}.${rawBody}` keyed by this secret; without
  // it POST /api/webhooks/lob rejects EVERY post, because an unauthenticated
  // writer into the attribution tables could fabricate deliveries.
  { key: "LOB_WEBHOOK_SECRET", service: "lob", label: "Lob Webhook Signing Secret", isSecret: true, isRequired: false, hint: "From Lob dashboard → Webhooks → your endpoint", docUrl: "https://docs.lob.com/#tag/Webhooks" },
  // Wave B — signs the per-piece QR short codes printed on mail. Optional:
  // falls back to FIELD_ENCRYPTION_KEY then SESSION_SECRET. If none is set we
  // refuse to mint codes rather than mint forgeable ones.
  { key: "MAIL_QR_SIGNING_SECRET", service: "lob", label: "Mail QR Code Signing Secret", isSecret: true, isRequired: false, hint: "Any long random string; falls back to SESSION_SECRET" },
  // Wave B — where a scanned postcard QR lands. Constant for every code so
  // the public redirect never reveals which org mailed the piece.
  { key: "MAIL_QR_LANDING_URL", service: "lob", label: "Mail QR Landing URL", isSecret: false, isRequired: false, hint: "https://yourdomain.com/respond (defaults to APP_URL/tools/parcel-check)" },
  // SMS / Voice
  { key: "TWILIO_ACCOUNT_SID", service: "twilio", label: "Twilio Account SID", isSecret: false, isRequired: false, hint: "AC..." },
  { key: "TWILIO_AUTH_TOKEN", service: "twilio", label: "Twilio Auth Token", isSecret: true, isRequired: false, hint: "..." },
  { key: "TWILIO_PHONE_NUMBER", service: "twilio", label: "Twilio Phone Number", isSecret: false, isRequired: false, hint: "+12125550100" },
  // Redis
  { key: "REDIS_URL", service: "redis", label: "Redis URL", isSecret: true, isRequired: false, hint: "redis://localhost:6379" },
  // MCP
  { key: "MCP_API_KEY", service: "mcp", label: "MCP API Key", isSecret: true, isRequired: false, hint: "Auto-generate below" },
  // Data Providers
  { key: "ATTOM_API_KEY", service: "attom", label: "ATTOM Data API Key", isSecret: true, isRequired: false, hint: "apikey from attomdata.com", docUrl: "https://api.gateway.attomdata.com/docs" },
  { key: "REGRID_API_KEY", service: "regrid", label: "Regrid API Key", isSecret: true, isRequired: false, hint: "API key from regrid.com", docUrl: "https://regrid.com/api" },
  // TCPA compliance — DNC / litigator scrub. Founder decision 2026-07-29:
  // Searchbug (docs/company/dnc-vendor-comparison.md). Auth is a CO_CODE
  // (account id) + PASS (account password / API key) PAIR, so it declares two
  // entries the same way AWS does — the id is not a secret, the password is.
  // Set DNC_SCRUB_PROVIDER=searchbug to select the adapter. Until BOTH values
  // are present the scrub returns "not checked" and lead-matched marketing
  // sends fail CLOSED — it never silently passes numbers.
  { key: "SEARCHBUG_CO_CODE", service: "searchbug", label: "Searchbug Account ID (CO_CODE)", isSecret: false, isRequired: false, hint: "Account ID from Your Account page after login", docUrl: "https://www.searchbug.com/api/identify-phone-number.aspx" },
  { key: "SEARCHBUG_API_KEY", service: "searchbug", label: "Searchbug API Password (PASS)", isSecret: true, isRequired: false, hint: "Your Searchbug account password; must not contain @ # ? & or =", docUrl: "https://www.searchbug.com/api/identify-phone-number.aspx" },
];

export const SERVICE_GROUPS: Array<{
  service: string;
  label: string;
  description: string;
  icon: string;
  required: boolean;
}> = [
  { service: "core", label: "Core Platform", description: "Database, sessions, and app identity", icon: "Server", required: true },
  { service: "openrouter", label: "AI (OpenRouter)", description: "Powers every AI feature — valuation, offers, insights", icon: "Bot", required: true },
  { service: "stripe", label: "Stripe Payments", description: "Subscription billing and credit purchases", icon: "CreditCard", required: true },
  { service: "aws", label: "Email (AWS SES)", description: "Transactional emails — signups, password resets, alerts", icon: "Mail", required: true },
  { service: "mapbox", label: "Maps (Mapbox)", description: "Parcel maps and GIS visualization", icon: "Map", required: false },
  { service: "lob", label: "Direct Mail (Lob)", description: "Physical mailers to seller leads", icon: "FileText", required: false },
  { service: "twilio", label: "SMS / Phone (Twilio)", description: "Text message campaigns and call routing", icon: "Phone", required: false },
  { service: "redis", label: "Redis", description: "Job queues, real-time pub/sub, caching", icon: "Database", required: false },
  { service: "openai", label: "OpenAI (fallback)", description: "Direct OpenAI fallback if OpenRouter is unavailable", icon: "Sparkles", required: false },
  { service: "mcp", label: "MCP API Key", description: "Internal MCP server access key", icon: "Key", required: false },
  { service: "attom", label: "ATTOM Data", description: "Property details, valuations, and sales comparables", icon: "Building", required: false },
  { service: "regrid", label: "Regrid", description: "Parcel boundaries, owner info, and land data", icon: "MapPin", required: false },
  { service: "searchbug", label: "Searchbug (DNC scrub)", description: "Federal/state DNC + TCPA litigator scrub for outbound SMS", icon: "Phone", required: false },
];
