/**
 * Autonomous Self-Acquisition — Google Search Console sense.
 *
 * The missing feedback edge every acquisition panel named #1: real per-property
 * impressions / clicks / average-position from Google, so the loop can tell
 * "published into a void" from "indexed and earning attention," and the
 * reputation governor (A3) can pace publishing to actual authority signal.
 *
 * Auth: a Google service account (GSC_SERVICE_ACCOUNT_JSON) the founder grants
 * read access to the GSC property (GSC_SITE_URL) at ignition. We sign a JWT
 * (jose, RS256) and exchange it for a short-lived access token — no SDK needed.
 * Safe-by-absence: no creds ⇒ every call returns null (the loop treats search
 * data as "not yet available," never as zero). The credential is NEVER logged.
 *
 * Pure helpers (claims/body/summary) are unit-tested; the IO is best-effort.
 */
import { SignJWT, importPKCS8 } from "jose";
import { logger } from "../../utils/logger";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const GSC_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";

interface ServiceAccount {
  client_email: string;
  private_key: string;
}

/** Parse the service-account JSON from env. Returns null if absent/malformed. NEVER logs the key. */
function serviceAccount(): ServiceAccount | null {
  const raw = process.env.GSC_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw) as Partial<ServiceAccount>;
    if (typeof obj.client_email === "string" && typeof obj.private_key === "string") {
      return { client_email: obj.client_email, private_key: obj.private_key };
    }
  } catch {
    /* malformed — treated as absent */
  }
  return null;
}

/** The configured GSC property (e.g. "sc-domain:acreos.com" or "https://acreos.com/"). */
export function gscSiteUrl(): string | null {
  return process.env.GSC_SITE_URL?.trim() || null;
}

/** Is the GSC sense configured (creds + property present)? */
export function gscConfigured(): boolean {
  return serviceAccount() !== null && gscSiteUrl() !== null;
}

/** JWT claims for the service-account → access-token exchange. Pure. */
export function buildJwtClaims(clientEmail: string, nowSec: number): Record<string, unknown> {
  return {
    iss: clientEmail,
    scope: GSC_SCOPE,
    aud: TOKEN_URL,
    iat: nowSec,
    exp: nowSec + 3600,
  };
}

// Cache the access token until shortly before expiry (best-effort, in-process).
let tokenCache: { token: string; expSec: number } | null = null;

async function getAccessToken(nowSec: number): Promise<string | null> {
  if (tokenCache && tokenCache.expSec - 60 > nowSec) return tokenCache.token;
  const sa = serviceAccount();
  if (!sa) return null;
  try {
    const key = await importPKCS8(sa.private_key, "RS256");
    const assertion = await new SignJWT(buildJwtClaims(sa.client_email, nowSec))
      .setProtectedHeader({ alg: "RS256", typ: "JWT" })
      .sign(key);
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      logger.warn("[searchConsoleSense] token exchange non-2xx", { status: res.status });
      return null;
    }
    const data = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!data.access_token) return null;
    tokenCache = { token: data.access_token, expSec: nowSec + (data.expires_in ?? 3600) };
    return data.access_token;
  } catch (err) {
    // Never include the credential in the log.
    logger.warn("[searchConsoleSense] token mint failed", err instanceof Error ? new Error(err.name) : undefined);
    return null;
  }
}

/** ISO yyyy-mm-dd for the Search Analytics window. Pure. */
export function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Search Analytics query body for a window. Pure. */
export function buildSearchAnalyticsBody(startDate: string, endDate: string, rowLimit = 1): Record<string, unknown> {
  return { startDate, endDate, dimensions: [], rowLimit };
}

export interface SearchConsoleMetrics {
  impressions: number;
  clicks: number;
  avgPosition: number | null;
  windowDays: number;
}

/** Summarize Search Analytics rows into the headline metrics. Pure. */
export function summarizeSearchRows(
  rows: Array<{ impressions?: number; clicks?: number; position?: number }> | undefined,
  windowDays: number,
): SearchConsoleMetrics {
  const r = rows?.[0];
  return {
    impressions: Math.max(0, Math.round(r?.impressions ?? 0)),
    clicks: Math.max(0, Math.round(r?.clicks ?? 0)),
    avgPosition: typeof r?.position === "number" ? Math.round(r.position * 10) / 10 : null,
    windowDays,
  };
}

/**
 * Fetch headline Search Console metrics over the last `windowDays`. Returns null
 * when unconfigured or on any error — the caller treats null as "search data not
 * yet available," never as zero traffic. Best-effort; never throws.
 */
export async function getSearchConsoleMetrics(windowDays = 28, now = new Date()): Promise<SearchConsoleMetrics | null> {
  const site = gscSiteUrl();
  if (!site) return null;
  const nowSec = Math.floor(now.getTime() / 1000);
  const token = await getAccessToken(nowSec);
  if (!token) return null;
  // GSC data lags ~2-3 days; end the window 3 days back to avoid an empty tail.
  const end = new Date(now.getTime() - 3 * 86400_000);
  const start = new Date(end.getTime() - windowDays * 86400_000);
  try {
    const res = await fetch(
      `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site)}/searchAnalytics/query`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(buildSearchAnalyticsBody(isoDay(start), isoDay(end))),
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!res.ok) {
      logger.warn("[searchConsoleSense] searchAnalytics non-2xx", { status: res.status });
      return null;
    }
    const data = (await res.json()) as { rows?: Array<{ impressions?: number; clicks?: number; position?: number }> };
    return summarizeSearchRows(data.rows, windowDays);
  } catch (err) {
    logger.warn("[searchConsoleSense] searchAnalytics failed", err instanceof Error ? new Error(err.name) : undefined);
    return null;
  }
}

/** Structurally an EdgeEvidence (worldModel) — kept import-free to avoid coupling
 *  the GSC service to the kernel. */
export interface ReachEvidence {
  successes: number;
  failures: number;
}

/** Below this impression count over the GSC window, a published-guide surface
 *  has no meaningful visibility yet — and during the natural 4-9mo indexing lag
 *  that is EXPECTED, never a strategy failure. */
export const SEARCH_REACH_IMPRESSION_FLOOR = 100;
/** Cap on the success evidence a single GSC snapshot contributes (so one strong
 *  window can't overwhelm the prior; accumulation across windows is the
 *  follow-up that persists samples). */
export const SEARCH_REACH_SUCCESS_CAP = 10;

/**
 * THE ACQUISITION LOOP-CLOSER (panel). Turn REAL Search Console reach into
 * EdgeEvidence for the owned-growth/publish lever, so the world-model edge
 * (publish_guide → … → search_impressions) moves from PRIOR to MEASURED off a
 * genuine, zero-capital, no-customer-needed consequence: a published guide
 * actually earning search reach.
 *
 * HONESTY + LAG-AWARENESS (load-bearing):
 *  - null metrics (GSC unconfigured / unavailable) → {0,0}: no evidence, the
 *    edge is unchanged. Safe-off by default.
 *  - It produces ONLY success evidence (reach materialized) or {0,0} — NEVER a
 *    failure. Low/zero impressions early are EXPECTED during the 4-9mo indexing
 *    lag; punishing the publish strategy for them would be dishonest (absence ≠
 *    failure, the same invariant evidenceByLever holds). The strategy is judged
 *    only on reach it DID earn, never on reach it hasn't earned YET.
 *  - Real click-throughs are the cleanest signal (someone reached the tool via
 *    search); meaningful impressions are a weaker positive. Pure + total.
 *
 * This refines the world-model's CONFIDENCE only (via refineModel) — it is NOT
 * a PlayStats success and never touches the Thompson reward edge.
 */
export function searchReachEvidence(metrics: SearchConsoleMetrics | null): ReachEvidence {
  if (!metrics) return { successes: 0, failures: 0 };
  const clicks = Math.max(0, Math.floor(metrics.clicks));
  if (clicks >= 1) return { successes: Math.min(SEARCH_REACH_SUCCESS_CAP, clicks), failures: 0 };
  if (Math.max(0, Math.floor(metrics.impressions)) >= SEARCH_REACH_IMPRESSION_FLOOR) {
    return { successes: 1, failures: 0 };
  }
  return { successes: 0, failures: 0 }; // not failing — just not yet earning reach
}
