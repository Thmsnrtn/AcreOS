/**
 * Platform Connections — the native "connect an account from within AcreOS"
 * layer (founder ask, 2026-07-03).
 *
 * Three jobs:
 *   1. CATALOG — one honest registry of every external account the platform
 *      runs on: what it powers, which fields it needs, which env var each
 *      field falls back to, and how to VERIFY it against the real API.
 *   2. VAULT — founder-entered values stored with the BYOK vault's exact
 *      discipline (AES-256-GCM bytea envelope, last-4 fingerprint, one active
 *      row per (provider, field), revoke-then-insert in one transaction,
 *      audit on every mutation, plaintext never logged).
 *   3. RESOLUTION — `resolveConnectionValue(provider, field)`: DB-first, env
 *      fallback, short cache, FAIL-SOFT (any error → null → callers keep
 *      their env path). This is what makes a pasted key work with no
 *      redeploy, and what keeps every existing deployment working unchanged
 *      when no rows exist.
 *
 * OAuth providers (Meta/Google ads) are PREWIRED: their app credentials are
 * normal fields here; the browser flow lives in connectionsOAuth.ts and
 * stores the resulting tokens as secret fields on the same rows.
 */
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../../db";
import { platformConnections } from "@shared/schema/platform-connections";
import { integrationStatus } from "@shared/schema";
import { encrypt, decrypt } from "../fieldEncryption";
import { founderAudit } from "../founderAuditService";
import { logger } from "../../utils/logger";

// ─── Catalog ─────────────────────────────────────────────────────────────────

export interface ConnectionFieldSpec {
  name: string;
  label: string;
  /** Secret fields are encrypted at rest and only ever displayed as …last4. */
  secret: boolean;
  /** Env var this field falls back to when no DB row exists. */
  envVar: string;
  placeholder?: string;
}

export interface ConnectionProviderSpec {
  key: string;
  label: string;
  category: "operations" | "ai" | "money" | "growth";
  /** Plain sentence: what stops working without this account. */
  powers: string;
  fields: ConnectionFieldSpec[];
  /** Present for OAuth providers — the connect flow beyond pasted app creds. */
  oauth?: { kind: "oauth2"; note: string };
  /** Extra honesty the founder should read before relying on this row. */
  note?: string;
}

export const CONNECTION_PROVIDERS: readonly ConnectionProviderSpec[] = [
  {
    key: "paging",
    label: "Paging (reach you)",
    category: "operations",
    powers: "Incident pages to your phone (ntfy) with automatic email fallback — the step-away safety net.",
    fields: [
      { name: "topic", label: "Private ntfy topic", secret: false, envVar: "SOLENE_PAGE_TOPIC", placeholder: "a long, private topic your phone subscribes to" },
      { name: "founder_email", label: "Founder email (fallback channel)", secret: false, envVar: "FOUNDER_EMAIL", placeholder: "you@example.com" },
    ],
  },
  {
    key: "github",
    label: "GitHub",
    category: "operations",
    powers: "The immune system's self-patch PRs and evolution-PR merge detection.",
    fields: [
      { name: "token", label: "Personal access token", secret: true, envVar: "GITHUB_TOKEN", placeholder: "ghp_…" },
      { name: "repository", label: "Repository (owner/name)", secret: false, envVar: "GITHUB_REPOSITORY", placeholder: "you/acreos" },
    ],
  },
  {
    key: "anthropic",
    label: "Anthropic",
    category: "ai",
    powers: "Every Solene dispatch and the pre-call constitutional checker.",
    fields: [{ name: "api_key", label: "API key", secret: true, envVar: "ANTHROPIC_API_KEY", placeholder: "sk-ant-…" }],
  },
  {
    key: "openrouter",
    label: "OpenRouter",
    category: "ai",
    powers: "The routed AI layer (Pax, judges, founder chat).",
    fields: [{ name: "api_key", label: "API key", secret: true, envVar: "AI_INTEGRATIONS_OPENROUTER_API_KEY", placeholder: "sk-or-…" }],
  },
  {
    key: "stripe",
    label: "Stripe",
    category: "money",
    powers: "Billing, dunning recovery, refunds.",
    fields: [{ name: "secret_key", label: "Secret key", secret: true, envVar: "STRIPE_SECRET_KEY", placeholder: "sk_live_…" }],
  },
  {
    key: "lob",
    label: "Lob (direct mail)",
    category: "money",
    powers: "Customer letter/postcard sends.",
    fields: [
      { name: "test_key", label: "Test API key", secret: true, envVar: "LOB_API_KEY", placeholder: "test_…" },
      { name: "live_key", label: "Live API key", secret: true, envVar: "LOB_LIVE_API_KEY", placeholder: "live_…" },
    ],
    note: "The live-send interlock is separate by design: even with a live key connected, real mail goes out only when LOB_LIVE_SEND_ENABLED=true in production.",
  },
  {
    key: "twilio",
    label: "Twilio",
    category: "money",
    powers: "SMS sends and inbound seller-reply capture.",
    fields: [
      { name: "account_sid", label: "Account SID", secret: false, envVar: "TWILIO_ACCOUNT_SID", placeholder: "AC…" },
      { name: "auth_token", label: "Auth token", secret: true, envVar: "TWILIO_AUTH_TOKEN" },
    ],
  },
  {
    key: "meta_ads",
    label: "Meta Ads",
    category: "growth",
    powers: "The run_ad_campaign hand's first real provider (drafts stay witnessed until you approve each campaign).",
    fields: [
      { name: "app_id", label: "Meta app ID", secret: false, envVar: "META_APP_ID" },
      { name: "app_secret", label: "Meta app secret", secret: true, envVar: "META_APP_SECRET" },
      { name: "ad_account_id", label: "Ad account ID (numbers only)", secret: false, envVar: "META_AD_ACCOUNT_ID", placeholder: "e.g. 1234567890" },
      // oauth_access_token / oauth_account_id are written by the OAuth flow.
    ],
    oauth: { kind: "oauth2", note: "After saving the app credentials, tap Connect to log in with your Meta account — AcreOS stores the resulting token encrypted." },
  },
  {
    key: "google_ads",
    label: "Google Ads",
    category: "growth",
    powers: "Second ad provider (prewired; drafts stay witnessed).",
    fields: [
      { name: "client_id", label: "OAuth client ID", secret: false, envVar: "GOOGLE_ADS_CLIENT_ID" },
      { name: "client_secret", label: "OAuth client secret", secret: true, envVar: "GOOGLE_ADS_CLIENT_SECRET" },
      { name: "developer_token", label: "Developer token", secret: true, envVar: "GOOGLE_ADS_DEVELOPER_TOKEN" },
    ],
    oauth: { kind: "oauth2", note: "After saving the OAuth client, tap Connect to log in with your Google account — tokens are stored encrypted." },
  },
] as const;

export function providerSpec(key: string): ConnectionProviderSpec | null {
  return CONNECTION_PROVIDERS.find((p) => p.key === key) ?? null;
}

/** Fields the OAuth flow writes — legal to store but never founder-typed. */
export const OAUTH_FIELDS = ["oauth_access_token", "oauth_refresh_token", "oauth_account_id", "oauth_state"] as const;

function isKnownField(spec: ConnectionProviderSpec, field: string): boolean {
  return spec.fields.some((f) => f.name === field) || (OAUTH_FIELDS as readonly string[]).includes(field);
}

function isSecretField(spec: ConnectionProviderSpec, field: string): boolean {
  const f = spec.fields.find((x) => x.name === field);
  if (f) return f.secret;
  // OAuth tokens are always secret; oauth_state / account id are not.
  return field === "oauth_access_token" || field === "oauth_refresh_token";
}

// ─── Vault ───────────────────────────────────────────────────────────────────

function fingerprintOf(plaintext: string): string {
  return `…${plaintext.slice(-4)}`;
}

/** Set (or replace) one field. Revoke-then-insert in a single transaction. */
export async function setConnectionField(
  provider: string,
  field: string,
  plaintext: string,
  updatedBy: string,
): Promise<{ fingerprint: string | null }> {
  const spec = providerSpec(provider);
  if (!spec) throw new Error(`setConnectionField: unknown provider "${provider}"`);
  if (!isKnownField(spec, field)) throw new Error(`setConnectionField: unknown field "${provider}.${field}"`);
  const value = plaintext.trim();
  if (!value) throw new Error("setConnectionField: value must be non-empty (use disconnect to clear)");

  const secret = isSecretField(spec, field);
  const fingerprint = secret ? fingerprintOf(value) : null;

  await db.transaction(async (tx) => {
    await tx
      .update(platformConnections)
      .set({ revokedAt: new Date() })
      .where(and(eq(platformConnections.provider, provider), eq(platformConnections.field, field), isNull(platformConnections.revokedAt)));
    await tx.insert(platformConnections).values({
      provider,
      field,
      secretEncrypted: secret ? Buffer.from(encrypt(value), "utf8") : null,
      valuePlain: secret ? null : value,
      fingerprint,
      updatedBy,
    });
  });

  bustResolveCache();
  void founderAudit.log({
    category: "security_event",
    severity: "info",
    action: "platform_connection_set",
    description: `Platform connection ${provider}.${field} set${fingerprint ? ` (${fingerprint})` : ""}`,
    userId: updatedBy,
  });
  logger.warn(`[connections] ${provider}.${field} set by founder${fingerprint ? ` (${fingerprint})` : ""}`);
  return { fingerprint };
}

/** Revoke every active field for a provider (full disconnect). */
export async function disconnectProvider(provider: string, updatedBy: string): Promise<number> {
  const spec = providerSpec(provider);
  if (!spec) throw new Error(`disconnectProvider: unknown provider "${provider}"`);
  const revoked = await db
    .update(platformConnections)
    .set({ revokedAt: new Date() })
    .where(and(eq(platformConnections.provider, provider), isNull(platformConnections.revokedAt)))
    .returning({ id: platformConnections.id });
  bustResolveCache();
  void founderAudit.log({
    category: "security_event",
    severity: "warning",
    action: "platform_connection_disconnect",
    description: `Platform connection ${provider} disconnected (${revoked.length} field(s) revoked); env fallbacks (if set) now govern`,
    userId: updatedBy,
  });
  logger.warn(`[connections] ${provider} disconnected by founder (${revoked.length} field(s))`);
  return revoked.length;
}

// ─── Resolution (DB-first, env fallback, fail-soft) ─────────────────────────

const RESOLVE_CACHE_TTL_MS = 30_000;
let resolveCache: Map<string, { at: number; value: string | null; source: "db" | "env" | "missing" }> = new Map();

export function bustResolveCache(): void {
  resolveCache = new Map();
}

export interface ResolvedConnectionValue {
  value: string | null;
  source: "db" | "env" | "missing";
}

/**
 * Resolve one field: active DB row first (decrypted), env fallback second.
 * FAIL-SOFT: any error (db down, decrypt failure, unknown field) logs and
 * degrades to the env var — a broken connections layer can never take down
 * a service that used to work on env alone.
 */
export async function resolveConnection(provider: string, field: string): Promise<ResolvedConnectionValue> {
  const cacheKey = `${provider}.${field}`;
  const hit = resolveCache.get(cacheKey);
  if (hit && Date.now() - hit.at < RESOLVE_CACHE_TTL_MS) return { value: hit.value, source: hit.source };

  const spec = providerSpec(provider);
  const envVar = spec?.fields.find((f) => f.name === field)?.envVar;
  const envValue = envVar ? process.env[envVar]?.trim() || null : null;

  let out: ResolvedConnectionValue = { value: envValue, source: envValue ? "env" : "missing" };
  try {
    const [row] = await db
      .select()
      .from(platformConnections)
      .where(and(eq(platformConnections.provider, provider), eq(platformConnections.field, field), isNull(platformConnections.revokedAt)))
      .limit(1);
    if (row) {
      if (row.secretEncrypted) {
        out = { value: decrypt(row.secretEncrypted.toString("utf8")), source: "db" };
      } else if (row.valuePlain) {
        out = { value: row.valuePlain, source: "db" };
      }
    }
  } catch (err) {
    logger.warn(
      `[connections] resolve ${provider}.${field} failed — falling back to env: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  resolveCache.set(cacheKey, { at: Date.now(), ...out });
  return out;
}

/** Convenience: the value or null. */
export async function resolveConnectionValue(provider: string, field: string): Promise<string | null> {
  return (await resolveConnection(provider, field)).value;
}

/** GitHub credentials for the self-patch motor + evolution PR polling. */
export async function resolveGithubCredentials(): Promise<{ token: string | null; repository: string | null }> {
  return {
    token: await resolveConnectionValue("github", "token"),
    repository: await resolveConnectionValue("github", "repository"),
  };
}

// ─── Status + verify ─────────────────────────────────────────────────────────

export interface ConnectionFieldStatus {
  name: string;
  label: string;
  secret: boolean;
  /** Where the effective value comes from right now. */
  source: "db" | "env" | "missing";
  /** Display-safe identifier for secrets set via DB. */
  fingerprint: string | null;
}

export interface ConnectionProviderStatus {
  key: string;
  label: string;
  category: ConnectionProviderSpec["category"];
  powers: string;
  note?: string;
  oauth?: { kind: "oauth2"; note: string; connected: boolean };
  fields: ConnectionFieldStatus[];
  /** connected = every declared field resolves (db or env). */
  connected: boolean;
  lastVerifiedAt: string | null;
  lastVerificationStatus: string | null;
}

export async function getConnectionStatuses(): Promise<ConnectionProviderStatus[]> {
  const out: ConnectionProviderStatus[] = [];
  for (const spec of CONNECTION_PROVIDERS) {
    const fields: ConnectionFieldStatus[] = [];
    for (const f of spec.fields) {
      const resolved = await resolveConnection(spec.key, f.name);
      let fingerprint: string | null = null;
      if (resolved.source === "db" && f.secret) {
        try {
          const [row] = await db
            .select({ fingerprint: platformConnections.fingerprint })
            .from(platformConnections)
            .where(and(eq(platformConnections.provider, spec.key), eq(platformConnections.field, f.name), isNull(platformConnections.revokedAt)))
            .limit(1);
          fingerprint = row?.fingerprint ?? null;
        } catch { /* display-only */ }
      }
      fields.push({ name: f.name, label: f.label, secret: f.secret, source: resolved.source, fingerprint });
    }
    let oauthStatus: ConnectionProviderStatus["oauth"];
    if (spec.oauth) {
      const token = await resolveConnection(spec.key, "oauth_access_token");
      oauthStatus = { ...spec.oauth, connected: token.source === "db" };
    }
    let lastVerifiedAt: string | null = null;
    let lastVerificationStatus: string | null = null;
    try {
      const [statusRow] = await db
        .select()
        .from(integrationStatus)
        .where(eq(integrationStatus.integrationKey, `platform:${spec.key}`))
        .limit(1);
      lastVerifiedAt = statusRow?.lastVerifiedAt?.toISOString() ?? null;
      lastVerificationStatus = statusRow?.lastVerificationStatus ?? null;
    } catch { /* display-only */ }
    out.push({
      key: spec.key,
      label: spec.label,
      category: spec.category,
      powers: spec.powers,
      note: spec.note,
      oauth: oauthStatus,
      fields,
      connected: fields.every((f) => f.source !== "missing"),
      lastVerifiedAt,
      lastVerificationStatus,
    });
  }
  return out;
}

/**
 * Live-verify a provider against its REAL API using the resolved values.
 * Writes the outcome to integration_status (key "platform:<provider>").
 * Never throws; failures come back as { ok: false, detail }.
 */
export async function verifyProvider(provider: string): Promise<{ ok: boolean; detail: string }> {
  const spec = providerSpec(provider);
  if (!spec) return { ok: false, detail: `unknown provider "${provider}"` };

  let result: { ok: boolean; detail: string };
  try {
    result = await runVerify(provider);
  } catch (err) {
    result = { ok: false, detail: err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300) };
  }

  try {
    await db
      .insert(integrationStatus)
      .values({
        integrationKey: `platform:${provider}`,
        displayName: spec.label,
        isConfigured: result.ok,
        isCritical: false,
        lastVerifiedAt: new Date(),
        lastVerificationStatus: result.ok ? "verified" : `failed: ${result.detail.slice(0, 200)}`,
      })
      .onConflictDoUpdate({
        target: integrationStatus.integrationKey,
        set: {
          isConfigured: result.ok,
          lastVerifiedAt: new Date(),
          lastVerificationStatus: result.ok ? "verified" : `failed: ${result.detail.slice(0, 200)}`,
          updatedAt: new Date(),
        },
      });
  } catch (err) {
    logger.warn(`[connections] verify bookkeeping failed for ${provider}: ${err instanceof Error ? err.message : String(err)}`);
  }
  return result;
}

const VERIFY_TIMEOUT_MS = 8_000;

async function timedFetch(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function runVerify(provider: string): Promise<{ ok: boolean; detail: string }> {
  const need = async (field: string): Promise<string> => {
    const v = await resolveConnectionValue(provider, field);
    if (!v) throw new Error(`missing ${provider}.${field} (no DB value, no env fallback)`);
    return v;
  };

  switch (provider) {
    case "paging": {
      const topic = await need("topic");
      const res = await timedFetch(`https://ntfy.sh/${encodeURIComponent(topic)}`, {
        method: "POST",
        headers: { Title: "AcreOS: connection test", Priority: "2" },
        body: "Paging channel verified from the Control Center. No action needed.",
      });
      return res.ok
        ? { ok: true, detail: "test push delivered — check your phone" }
        : { ok: false, detail: `ntfy HTTP ${res.status}` };
    }
    case "github": {
      const token = await need("token");
      const repo = await need("repository");
      const headers = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" };
      const user = await timedFetch("https://api.github.com/user", { headers });
      if (!user.ok) return { ok: false, detail: `token rejected (HTTP ${user.status})` };
      const repoRes = await timedFetch(`https://api.github.com/repos/${repo}`, { headers });
      if (!repoRes.ok) return { ok: false, detail: `token OK but cannot see ${repo} (HTTP ${repoRes.status})` };
      return { ok: true, detail: `token OK; ${repo} reachable` };
    }
    case "anthropic": {
      const key = await need("api_key");
      const res = await timedFetch("https://api.anthropic.com/v1/models", {
        headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
      });
      return res.ok ? { ok: true, detail: "key accepted" } : { ok: false, detail: `HTTP ${res.status}` };
    }
    case "openrouter": {
      const key = await need("api_key");
      const res = await timedFetch("https://openrouter.ai/api/v1/key", {
        headers: { Authorization: `Bearer ${key}` },
      });
      return res.ok ? { ok: true, detail: "key accepted" } : { ok: false, detail: `HTTP ${res.status}` };
    }
    case "stripe": {
      const key = await need("secret_key");
      const res = await timedFetch("https://api.stripe.com/v1/balance", {
        headers: { Authorization: `Bearer ${key}` },
      });
      return res.ok ? { ok: true, detail: "key accepted" } : { ok: false, detail: `HTTP ${res.status}` };
    }
    case "lob": {
      const key = await need("test_key");
      const res = await timedFetch("https://api.lob.com/v1/addresses?limit=1", {
        headers: { Authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}` },
      });
      return res.ok
        ? { ok: true, detail: "test key accepted (live sends still gated by the interlock)" }
        : { ok: false, detail: `HTTP ${res.status}` };
    }
    case "twilio": {
      const sid = await need("account_sid");
      const token = await need("auth_token");
      const res = await timedFetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}.json`, {
        headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}` },
      });
      return res.ok ? { ok: true, detail: "credentials accepted" } : { ok: false, detail: `HTTP ${res.status}` };
    }
    case "meta_ads": {
      const token = await resolveConnectionValue(provider, "oauth_access_token");
      if (!token) {
        await need("app_id");
        await need("app_secret");
        return { ok: false, detail: "app credentials present — tap Connect to log in with Meta and finish the link" };
      }
      const res = await timedFetch(`https://graph.facebook.com/v19.0/me?access_token=${encodeURIComponent(token)}`, {});
      return res.ok ? { ok: true, detail: "Meta account linked" } : { ok: false, detail: `token rejected (HTTP ${res.status}) — reconnect` };
    }
    case "google_ads": {
      const token = await resolveConnectionValue(provider, "oauth_access_token");
      if (!token) {
        await need("client_id");
        await need("client_secret");
        return { ok: false, detail: "OAuth client present — tap Connect to log in with Google and finish the link" };
      }
      const res = await timedFetch(`https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=${encodeURIComponent(token)}`, {});
      return res.ok ? { ok: true, detail: "Google account linked" } : { ok: false, detail: `token rejected (HTTP ${res.status}) — reconnect` };
    }
    default:
      return { ok: false, detail: `no verifier for "${provider}"` };
  }
}
