/**
 * Autonomous Self-Acquisition — Search-engine submission (IndexNow).
 *
 * The cheapest cold-start discovery accelerant: the instant the autopilot
 * publishes a /field-notes artifact or a permanent /p/ parcel report is minted,
 * we PING IndexNow so Bing + Yandex (which honor it) crawl within hours instead
 * of waiting weeks for organic discovery. Google ignores IndexNow but still
 * benefits from the fresh sitemap; GSC submission is the separate (creds-gated)
 * sense built at ignition.
 *
 * Safe-by-absence: no INDEXNOW_KEY configured ⇒ every call is a logged no-op,
 * exactly like every other autopilot organ (dormant until switched on). Never
 * throws — discovery acceleration is best-effort and must never block a publish.
 *
 * The payload builder is pure + tested; the submit is thin best-effort IO.
 */
import { logger } from "../../utils/logger";

const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";
/** Where the key file is served (see routes-well-known.ts). */
export const INDEXNOW_KEY_PATH = "/indexnow-key.txt";

/** The configured IndexNow key, or null when unset (⇒ submission is dormant). */
export function indexNowKey(): string | null {
  const k = process.env.INDEXNOW_KEY?.trim();
  return k && k.length >= 8 ? k : null;
}

/**
 * Zero-config key resolution (free-distribution work, 2026-07-03). IndexNow
 * keys are SELF-MINTED — there is no account, no signup; you invent a key and
 * prove ownership by serving it at /indexnow-key.txt. So the accelerant was
 * dormant purely for lack of a random string. Resolution order:
 *   1. env INDEXNOW_KEY (explicit override),
 *   2. the persisted platform connection (indexnow.key),
 *   3. AUTO-MINT: generate 32 hex chars, persist via Platform Connections,
 *      return it — from that moment the key file serves it and pings work.
 * Fail-soft: any storage error → env-only behavior (dormant, logged).
 */
export async function resolveIndexNowKey(): Promise<string | null> {
  const envKey = indexNowKey();
  if (envKey) return envKey;
  try {
    const { resolveConnection, setConnectionField } = await import("../connections/platformConnections");
    const existing = await resolveConnection("indexnow", "key");
    if (existing.source === "db" && existing.value && existing.value.length >= 8) {
      return existing.value;
    }
    const { randomBytes } = await import("node:crypto");
    const minted = randomBytes(16).toString("hex");
    await setConnectionField("indexnow", "key", minted, "system:auto-mint");
    logger.info("[searchEngineSubmit] IndexNow key auto-minted — discovery pings are live with zero configuration");
    return minted;
  } catch (err) {
    logger.warn(
      `[searchEngineSubmit] IndexNow key resolution failed — staying dormant: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

/** The public base URL (no trailing slash), or null if unconfigured. */
export function publicBaseUrl(): string | null {
  const raw = (process.env.PUBLIC_APP_URL || process.env.APP_URL || "").trim();
  if (!raw) return null;
  return raw.replace(/\/+$/, "");
}

export interface IndexNowPayload {
  host: string;
  key: string;
  keyLocation: string;
  urlList: string[];
}

/**
 * Build the IndexNow POST body. Pure. Normalizes relative paths to absolute URLs
 * on the configured host, dedupes, drops anything off-host (IndexNow rejects a
 * batch containing a URL from another host), and caps the batch. Returns null
 * when there's nothing valid to submit.
 */
export function buildIndexNowPayload(
  baseUrl: string,
  key: string,
  urls: string[],
  max = 100,
): IndexNowPayload | null {
  let host: string;
  try {
    host = new URL(baseUrl).host;
  } catch {
    return null;
  }
  const seen = new Set<string>();
  const urlList: string[] = [];
  for (const u of urls) {
    if (!u) continue;
    let abs: string;
    try {
      abs = u.startsWith("http") ? u : new URL(u, baseUrl + "/").toString();
    } catch {
      continue;
    }
    try {
      if (new URL(abs).host !== host) continue; // IndexNow: all URLs must share the host
    } catch {
      continue;
    }
    if (seen.has(abs)) continue;
    seen.add(abs);
    urlList.push(abs);
    if (urlList.length >= max) break;
  }
  if (urlList.length === 0) return null;
  return { host, key, keyLocation: `${baseUrl}${INDEXNOW_KEY_PATH}`, urlList };
}

/**
 * Submit URLs to IndexNow. Best-effort + safe-by-absence: no-op (logged) when no
 * key or base URL is configured, or when nothing valid resolves. Never throws.
 * Accepts absolute URLs or site-relative paths (e.g. "/field-notes/foo").
 */
export async function submitToIndexNow(urls: string[]): Promise<{ submitted: number; reason: string }> {
  const key = await resolveIndexNowKey();
  const baseUrl = publicBaseUrl();
  if (!key) return { submitted: 0, reason: "no INDEXNOW_KEY (dormant)" };
  if (!baseUrl) return { submitted: 0, reason: "no PUBLIC_APP_URL" };
  const payload = buildIndexNowPayload(baseUrl, key, urls);
  if (!payload) return { submitted: 0, reason: "no valid on-host URLs" };
  try {
    const res = await fetch(INDEXNOW_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });
    // IndexNow returns 200/202 on accept; treat any 2xx as success.
    if (res.ok) {
      logger.info("[searchEngineSubmit] IndexNow accepted", { count: payload.urlList.length });
      return { submitted: payload.urlList.length, reason: "ok" };
    }
    logger.warn("[searchEngineSubmit] IndexNow non-2xx", { status: res.status });
    return { submitted: 0, reason: `status ${res.status}` };
  } catch (err) {
    logger.warn("[searchEngineSubmit] IndexNow submit failed", err instanceof Error ? err : undefined);
    return { submitted: 0, reason: "request failed" };
  }
}
