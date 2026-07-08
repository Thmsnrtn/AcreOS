/**
 * Platform Connections — the OAuth half (prewired ad-account login).
 *
 * The founder saves the provider's APP credentials as normal connection
 * fields (meta_ads.app_id/app_secret, google_ads.client_id/client_secret),
 * then taps Connect: we mint a state nonce (stored as a connection field so
 * it survives instance restarts, 10-minute TTL), send the browser to the
 * provider's consent screen, and the callback exchanges the code for tokens
 * stored encrypted on the same rows. No token ever transits the client.
 *
 * URL builders are PURE (creds in, URL out) so the shape is unit-testable
 * without any network or DB.
 */
import { randomBytes } from "node:crypto";
import { logger } from "../../utils/logger";
import {
  providerSpec,
  resolveConnectionValue,
  setConnectionField,
} from "./platformConnections";

export const OAUTH_PROVIDERS = ["meta_ads", "google_ads"] as const;
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

export function isOAuthProvider(p: string): p is OAuthProvider {
  return (OAUTH_PROVIDERS as readonly string[]).includes(p);
}

/** Where the provider sends the browser back. One callback for all providers. */
export function oauthRedirectUri(): string {
  const base = (process.env.PUBLIC_BASE_URL || "https://acreos.io").replace(/\/$/, "");
  return `${base}/api/founder/connections/oauth/callback`;
}

// ─── Pure URL builders ───────────────────────────────────────────────────────

export function buildMetaAuthUrl(appId: string, redirectUri: string, state: string): string {
  const q = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    state,
    scope: "ads_management,ads_read,business_management",
    response_type: "code",
  });
  return `https://www.facebook.com/v19.0/dialog/oauth?${q.toString()}`;
}

export function buildGoogleAuthUrl(clientId: string, redirectUri: string, state: string): string {
  const q = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
    response_type: "code",
    scope: "https://www.googleapis.com/auth/adwords",
    access_type: "offline",
    prompt: "consent",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q.toString()}`;
}

// ─── Start ───────────────────────────────────────────────────────────────────

const STATE_TTL_MS = 10 * 60 * 1000;

/**
 * Begin the flow: verify app creds exist, mint + persist a state nonce, and
 * return the consent URL for the client to navigate to. Honest refusal when
 * the app credentials aren't saved yet.
 */
export async function startOAuth(
  provider: OAuthProvider,
  updatedBy: string,
): Promise<{ ok: true; url: string } | { ok: false; reason: string }> {
  const spec = providerSpec(provider);
  if (!spec?.oauth) return { ok: false, reason: `"${provider}" is not an OAuth provider` };

  const redirectUri = oauthRedirectUri();
  // State carries the provider so one callback serves all providers; the
  // random half is verified against the persisted copy.
  const nonce = randomBytes(24).toString("hex");
  const state = `${provider}:${nonce}`;

  if (provider === "meta_ads") {
    const appId = await resolveConnectionValue(provider, "app_id");
    const appSecret = await resolveConnectionValue(provider, "app_secret");
    if (!appId || !appSecret) {
      return { ok: false, reason: "Save the Meta app ID + app secret first — then Connect logs you into your Meta account." };
    }
    await setConnectionField(provider, "oauth_state", `${nonce}:${Date.now()}`, updatedBy);
    return { ok: true, url: buildMetaAuthUrl(appId, redirectUri, state) };
  }

  const clientId = await resolveConnectionValue(provider, "client_id");
  const clientSecret = await resolveConnectionValue(provider, "client_secret");
  if (!clientId || !clientSecret) {
    return { ok: false, reason: "Save the Google OAuth client ID + secret first — then Connect logs you into your Google account." };
  }
  await setConnectionField(provider, "oauth_state", `${nonce}:${Date.now()}`, updatedBy);
  return { ok: true, url: buildGoogleAuthUrl(clientId, redirectUri, state) };
}

// ─── Callback ────────────────────────────────────────────────────────────────

/**
 * Finish the flow: validate state (matches the persisted nonce, within TTL),
 * exchange the code for tokens, store them encrypted. Returns a
 * founder-readable outcome; never throws.
 */
export async function completeOAuth(
  rawState: string,
  code: string,
  updatedBy: string,
): Promise<{ ok: boolean; provider: string | null; detail: string }> {
  const sep = rawState.indexOf(":");
  const provider = sep > 0 ? rawState.slice(0, sep) : "";
  const nonce = sep > 0 ? rawState.slice(sep + 1) : "";
  if (!isOAuthProvider(provider) || !nonce) {
    return { ok: false, provider: null, detail: "malformed state" };
  }

  try {
    const stored = await resolveConnectionValue(provider, "oauth_state");
    const [storedNonce, mintedAtRaw] = (stored ?? "").split(":");
    const mintedAt = Number(mintedAtRaw);
    if (!stored || storedNonce !== nonce) {
      return { ok: false, provider, detail: "state mismatch — start the connect flow again" };
    }
    if (!Number.isFinite(mintedAt) || Date.now() - mintedAt > STATE_TTL_MS) {
      return { ok: false, provider, detail: "connect flow expired — start again" };
    }

    const redirectUri = oauthRedirectUri();

    if (provider === "meta_ads") {
      const appId = await resolveConnectionValue(provider, "app_id");
      const appSecret = await resolveConnectionValue(provider, "app_secret");
      if (!appId || !appSecret) return { ok: false, provider, detail: "app credentials missing" };
      const q = new URLSearchParams({
        client_id: appId,
        client_secret: appSecret,
        redirect_uri: redirectUri,
        code,
      });
      const res = await fetch(`https://graph.facebook.com/v19.0/oauth/access_token?${q.toString()}`);
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        return { ok: false, provider, detail: `Meta token exchange failed (HTTP ${res.status}): ${body.slice(0, 200)}` };
      }
      const tokens = (await res.json()) as { access_token?: string };
      if (!tokens.access_token) return { ok: false, provider, detail: "Meta returned no access token" };
      await setConnectionField(provider, "oauth_access_token", tokens.access_token, updatedBy);
      logger.warn("[connections] Meta Ads account CONNECTED via OAuth");
      return { ok: true, provider, detail: "Meta account connected" };
    }

    // google_ads
    const clientId = await resolveConnectionValue(provider, "client_id");
    const clientSecret = await resolveConnectionValue(provider, "client_secret");
    if (!clientId || !clientSecret) return { ok: false, provider, detail: "OAuth client missing" };
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
        code,
      }).toString(),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, provider, detail: `Google token exchange failed (HTTP ${res.status}): ${body.slice(0, 200)}` };
    }
    const tokens = (await res.json()) as { access_token?: string; refresh_token?: string };
    if (!tokens.access_token) return { ok: false, provider, detail: "Google returned no access token" };
    await setConnectionField(provider, "oauth_access_token", tokens.access_token, updatedBy);
    if (tokens.refresh_token) {
      await setConnectionField(provider, "oauth_refresh_token", tokens.refresh_token, updatedBy);
    }
    logger.warn("[connections] Google Ads account CONNECTED via OAuth");
    return { ok: true, provider, detail: "Google account connected" };
  } catch (err) {
    return { ok: false, provider, detail: err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300) };
  }
}
