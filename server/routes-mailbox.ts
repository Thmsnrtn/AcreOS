/**
 * Native business inbox — mailbox connect routes (R1c, foundation slice).
 *
 * The connect/callback OAuth flow for Gmail + Outlook, plus list/disconnect.
 * MINIMAL-CUSTODY: we store ONLY the encrypted OAuth tokens (bytea envelope)
 * and non-secret metadata — never message bodies. The inbox view (a later
 * slice) reads mail ON-DEMAND through the stored token.
 *
 * Everything here is GATED on the provider's OAuth env vars. When they are
 * unset the connect route returns a friendly 400 ("not configured") — the
 * feature is inert, never half-broken, until the founder registers the app.
 *
 * Distinct from server/auth/oauth.ts (login SSO, scopes `openid email
 * profile`): mail needs gmail.readonly/gmail.send // Mail.Read/Mail.Send +
 * offline_access, and per-org refresh-token storage login never keeps.
 */

import { Router, type Response } from "express";
import crypto from "crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "./db";
import { connectedMailboxes, type MailboxOAuthProvider } from "@shared/schema";
import { encrypt } from "./services/fieldEncryption";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";
import { getOrganizationId, getUserId, type AuthenticatedRequest } from "./types/request";

const router = Router();

const appUrl = () => process.env.APP_URL || "http://localhost:5000";

// This codebase has no express-session (Clerk-based auth), so the OAuth CSRF
// `state` is a STATELESS HMAC-signed nonce: we issue it on connect and verify
// the signature + freshness on callback. The callback also runs behind
// isAuthenticated, so tokens only ever bind to the logged-in operator.
const STATE_SECRET =
  process.env.SESSION_SECRET || process.env.FIELD_ENCRYPTION_KEY || "acreos-mailbox-oauth-dev-secret";
const STATE_TTL_MS = 10 * 60 * 1000;

export function signState(): string {
  const payload = `${crypto.randomBytes(12).toString("hex")}.${Date.now()}`;
  const sig = crypto.createHmac("sha256", STATE_SECRET).update(payload).digest("hex");
  return `${Buffer.from(payload).toString("base64url")}.${sig}`;
}

export function verifyState(state: string | undefined): boolean {
  if (!state) return false;
  const [b64, sig] = state.split(".");
  if (!b64 || !sig) return false;
  let payload: string;
  try {
    payload = Buffer.from(b64, "base64url").toString("utf8");
  } catch {
    return false;
  }
  const expected = crypto.createHmac("sha256", STATE_SECRET).update(payload).digest("hex");
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return false;
  }
  const ts = Number(payload.split(".")[1]);
  return Number.isFinite(ts) && Date.now() - ts < STATE_TTL_MS;
}

interface ProviderConfig {
  clientIdEnv: string;
  clientSecretEnv: string;
  authUrl: (params: URLSearchParams) => string;
  tokenUrl: string;
  scope: string;
  /** Resolve the connected address from an access token. */
  whoami: (accessToken: string) => Promise<string | null>;
}

const PROVIDERS: Record<MailboxOAuthProvider, ProviderConfig> = {
  gmail: {
    clientIdEnv: "GOOGLE_CLIENT_ID",
    clientSecretEnv: "GOOGLE_CLIENT_SECRET",
    authUrl: (p) => `https://accounts.google.com/o/oauth2/v2/auth?${p}`,
    tokenUrl: "https://oauth2.googleapis.com/token",
    scope:
      "openid email profile https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send",
    async whoami(accessToken) {
      const r = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!r.ok) return null;
      const j = (await r.json()) as { email?: string };
      return j.email ?? null;
    },
  },
  outlook: {
    clientIdEnv: "MICROSOFT_CLIENT_ID",
    clientSecretEnv: "MICROSOFT_CLIENT_SECRET",
    authUrl: (p) => {
      const tenant = process.env.MICROSOFT_TENANT_ID || "common";
      return `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize?${p}`;
    },
    tokenUrl: `https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT_ID || "common"}/oauth2/v2.0/token`,
    scope: "openid email profile offline_access User.Read Mail.Read Mail.Send",
    async whoami(accessToken) {
      const r = await fetch("https://graph.microsoft.com/v1.0/me", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!r.ok) return null;
      const j = (await r.json()) as { mail?: string; userPrincipalName?: string };
      return j.mail ?? j.userPrincipalName ?? null;
    },
  },
};

function providerConfig(raw: string): ProviderConfig | null {
  if (raw !== "gmail" && raw !== "outlook") return null;
  return PROVIDERS[raw];
}

function isConfigured(cfg: ProviderConfig): boolean {
  return !!(process.env[cfg.clientIdEnv] && process.env[cfg.clientSecretEnv]);
}

function redirectUri(provider: string): string {
  return `${appUrl()}/api/mailbox/callback/${provider}`;
}

/** Encrypt a token string into a bytea-ready Buffer, or null. */
function encToken(plaintext: string | undefined | null): Buffer | null {
  if (!plaintext) return null;
  return Buffer.from(encrypt(plaintext), "utf8");
}

// ── Connect: redirect to the provider consent screen ────────────────────────
router.get("/connect/:provider", (req: AuthenticatedRequest, res: Response) => {
  const cfg = providerConfig(req.params.provider);
  if (!cfg) return Errors.badRequest(res, "Unknown mailbox provider");
  if (!isConfigured(cfg)) {
    return Errors.badRequest(
      res,
      `${req.params.provider} mailbox connect isn't configured yet. An admin needs to set ${cfg.clientIdEnv}.`,
    );
  }

  // Stateless signed CSRF nonce, verified on callback.
  const state = signState();

  const params = new URLSearchParams({
    client_id: process.env[cfg.clientIdEnv]!,
    redirect_uri: redirectUri(req.params.provider),
    response_type: "code",
    scope: cfg.scope,
    access_type: "offline",
    prompt: "consent", // force a refresh_token on re-consent
    state,
  });
  res.redirect(cfg.authUrl(params));
});

// ── Callback: exchange code → store encrypted tokens ────────────────────────
router.get("/callback/:provider", async (req: AuthenticatedRequest, res: Response) => {
  const cfg = providerConfig(req.params.provider);
  if (!cfg || !isConfigured(cfg)) return res.redirect("/settings/byok?mailbox=error");

  const { code, state } = req.query as { code?: string; state?: string };
  if (!code || !verifyState(state)) {
    return res.redirect("/settings/byok?mailbox=error");
  }

  try {
    const organizationId = getOrganizationId(req);
    const userId = getUserId(req);

    const tokenRes = await fetch(cfg.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: process.env[cfg.clientIdEnv]!,
        client_secret: process.env[cfg.clientSecretEnv]!,
        redirect_uri: redirectUri(req.params.provider),
        grant_type: "authorization_code",
      }),
    });
    const tokens = (await tokenRes.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
    };
    if (!tokens.access_token) {
      logger.warn(`[mailbox] ${req.params.provider} token exchange returned no access_token`);
      return res.redirect("/settings/byok?mailbox=error");
    }

    const email = await cfg.whoami(tokens.access_token);
    if (!email) return res.redirect("/settings/byok?mailbox=error");

    const expiresAt = tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000) : null;

    // Revoke any prior active connection for this (org, address), then insert.
    await db.transaction(async (tx) => {
      await tx
        .update(connectedMailboxes)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(connectedMailboxes.organizationId, organizationId),
            eq(connectedMailboxes.emailAddress, email),
            isNull(connectedMailboxes.revokedAt),
          ),
        );
      await tx.insert(connectedMailboxes).values({
        organizationId,
        userId,
        provider: req.params.provider,
        emailAddress: email,
        accessTokenEncrypted: encToken(tokens.access_token),
        refreshTokenEncrypted: encToken(tokens.refresh_token),
        tokenExpiresAt: expiresAt,
        scopes: tokens.scope ?? cfg.scope,
        status: "connected",
      });
    });

    logger.info(`[mailbox] connected ${req.params.provider} for org=${organizationId}`);
    return res.redirect("/settings/byok?mailbox=connected");
  } catch (err) {
    logger.error("[mailbox] callback failed", err instanceof Error ? err : undefined);
    return res.redirect("/settings/byok?mailbox=error");
  }
});

// ── List connected mailboxes (metadata only — never tokens) ─────────────────
router.get("/", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const organizationId = getOrganizationId(req);
    const rows = await db
      .select({
        id: connectedMailboxes.id,
        provider: connectedMailboxes.provider,
        emailAddress: connectedMailboxes.emailAddress,
        status: connectedMailboxes.status,
        lastError: connectedMailboxes.lastError,
        lastSyncedAt: connectedMailboxes.lastSyncedAt,
        createdAt: connectedMailboxes.createdAt,
      })
      .from(connectedMailboxes)
      .where(and(eq(connectedMailboxes.organizationId, organizationId), isNull(connectedMailboxes.revokedAt)))
      .orderBy(desc(connectedMailboxes.createdAt));

    // Which providers are even connectable in this environment (env-gated).
    const providers = Object.fromEntries(
      (Object.keys(PROVIDERS) as MailboxOAuthProvider[]).map((p) => [p, isConfigured(PROVIDERS[p])]),
    );
    res.json({ mailboxes: rows, providers });
  } catch (err) {
    Errors.internal(res, err);
  }
});

// ── Disconnect (revoke) ─────────────────────────────────────────────────────
router.delete("/:id", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const organizationId = getOrganizationId(req);
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return Errors.badRequest(res, "Invalid mailbox id");

    const [row] = await db
      .update(connectedMailboxes)
      .set({ revokedAt: new Date(), status: "revoked" })
      .where(
        and(
          eq(connectedMailboxes.id, id),
          eq(connectedMailboxes.organizationId, organizationId),
          isNull(connectedMailboxes.revokedAt),
        ),
      )
      .returning({ id: connectedMailboxes.id });

    if (!row) return Errors.notFound(res, "Mailbox");
    res.json({ ok: true });
  } catch (err) {
    Errors.internal(res, err);
  }
});

// Mounted in routes.ts behind `isAuthenticated, getOrCreateOrg` (mirrors the
// byok router), so every handler has req.organization + req.user populated.
export default router;
