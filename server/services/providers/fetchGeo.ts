/**
 * fetchGeo — the one hardened fetch for all free geospatial upstreams.
 *
 * County/state GIS servers and federal endpoints (FEMA NFHL, Census TIGER,
 * USGS/3DEP, USDA SSURGO/NASS) are individually unreliable and have unpublished
 * rate limits. A bare `fetch()` against them on a cold Fly machine can hang
 * indefinitely, burn the health-check grace, and — worst case — get our shared
 * egress NAT IP banned by an over-eager backfill.
 *
 * This helper centralises the reliability + etiquette discipline so no caller
 * has to re-roll it (Iris item 3 / Tess item 4):
 *   - one timeout per attempt (AbortSignal.timeout)
 *   - bounded retry with exponential backoff + full jitter, honouring Retry-After
 *   - per-host token bucket + in-flight concurrency limiter (don't hammer a
 *     single source; one bad job must not set the reliability floor for all orgs)
 *   - a contactable User-Agent so source admins reach us instead of silently
 *     banning us — table stakes etiquette for public-data providers
 *   - reuse of the just-merged SSRF guard (operator-contributed county URLs are
 *     a classic SSRF surface)
 *
 * It is intentionally framework-free (returns the native Response) so existing
 * call sites swap `fetch(` → `fetchGeo(` with minimal churn.
 */

import { checkOperatorUrl } from "./ssrf-guard";
import { logger } from "../../utils/logger";

/**
 * Contactable User-Agent. Public-data source admins who see traffic they don't
 * like can reach us at this address rather than silently IP-banning the shared
 * Fly egress IP — which would degrade the product for EVERY org at once.
 * Override the contact via DATABOT_CONTACT (e.g. an ops alias) in prod.
 */
const CONTACT = process.env.DATABOT_CONTACT || "ops@acreos.com";
export const GEO_USER_AGENT = `AcreOS-DataBot (${CONTACT})`;

export interface FetchGeoOptions extends Omit<RequestInit, "signal"> {
  /** Per-attempt timeout in ms. Default 8000. */
  timeoutMs?: number;
  /** Number of RETRIES after the first attempt (so total attempts = retries+1). Default 2. */
  retries?: number;
  /**
   * Override the per-host key. Defaults to the URL hostname. Use to share a
   * budget across several path-distinct endpoints on the same host.
   */
  host?: string;
  /**
   * Max concurrent in-flight requests per host. Default 4 — polite for a free
   * county portal, plenty for our request volume at Phase 0.
   */
  maxConcurrentPerHost?: number;
  /**
   * Token-bucket: sustained requests/sec allowed per host. Default 5.
   * Bucket capacity (burst) is 2x the rate.
   */
  ratePerSec?: number;
  /**
   * Skip the SSRF guard. ONLY for first-party trusted hosts already validated
   * elsewhere; never for operator-contributed URLs. Default false.
   */
  skipSsrfCheck?: boolean;
}

const DEFAULTS = {
  timeoutMs: 8000,
  retries: 2,
  maxConcurrentPerHost: 4,
  ratePerSec: 5,
};

// ── Per-host token bucket + concurrency limiter ───────────────────

interface HostLimiter {
  tokens: number;
  lastRefill: number;
  ratePerSec: number;
  capacity: number;
  inFlight: number;
  maxConcurrent: number;
  /** FIFO queue of waiters blocked on a token or a concurrency slot. */
  queue: Array<() => void>;
}

const limiters = new Map<string, HostLimiter>();

function getLimiter(host: string, ratePerSec: number, maxConcurrent: number): HostLimiter {
  let l = limiters.get(host);
  if (!l) {
    l = {
      tokens: ratePerSec * 2, // start full at burst capacity
      lastRefill: Date.now(),
      ratePerSec,
      capacity: ratePerSec * 2,
      inFlight: 0,
      maxConcurrent,
      queue: [],
    };
    limiters.set(host, l);
  } else {
    // A later caller may tighten/loosen the budget; honour the latest config.
    l.ratePerSec = ratePerSec;
    l.capacity = ratePerSec * 2;
    l.maxConcurrent = maxConcurrent;
  }
  return l;
}

function refill(l: HostLimiter): void {
  const now = Date.now();
  const elapsedSec = (now - l.lastRefill) / 1000;
  if (elapsedSec <= 0) return;
  l.tokens = Math.min(l.capacity, l.tokens + elapsedSec * l.ratePerSec);
  l.lastRefill = now;
}

/** Block until a token AND a concurrency slot are available for this host. */
async function acquire(l: HostLimiter): Promise<void> {
  // Loop: re-check after each wake, since multiple waiters race for one slot.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    refill(l);
    if (l.tokens >= 1 && l.inFlight < l.maxConcurrent) {
      l.tokens -= 1;
      l.inFlight += 1;
      return;
    }
    // Not ready — park and wait to be woken by a release or the refill timer.
    await new Promise<void>((resolve) => {
      l.queue.push(resolve);
      // Wake when at least one more token should have accrued, in case no
      // release fires (pure rate-limit wait).
      const msUntilToken = l.tokens >= 1 ? 0 : ((1 - l.tokens) / l.ratePerSec) * 1000;
      setTimeout(() => {
        const idx = l.queue.indexOf(resolve);
        if (idx !== -1) {
          l.queue.splice(idx, 1);
          resolve();
        }
      }, Math.max(15, Math.ceil(msUntilToken)));
    });
  }
}

function release(l: HostLimiter): void {
  l.inFlight = Math.max(0, l.inFlight - 1);
  const next = l.queue.shift();
  if (next) next();
}

// ── Backoff ───────────────────────────────────────────────────────

function backoffMs(attempt: number): number {
  // Exponential base (250ms, 500, 1000...) with FULL jitter to avoid a
  // thundering herd of synchronized retries against the same flaky host.
  const base = 250 * 2 ** attempt;
  const capped = Math.min(base, 5000);
  return Math.floor(Math.random() * capped);
}

function parseRetryAfter(res: Response): number | null {
  const ra = res.headers.get("retry-after");
  if (!ra) return null;
  const asNum = Number(ra);
  if (!Number.isNaN(asNum)) return asNum * 1000;
  const asDate = Date.parse(ra);
  if (!Number.isNaN(asDate)) return Math.max(0, asDate - Date.now());
  return null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A status worth retrying: transient server / rate-limit / gateway errors. */
function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504 || status === 408;
}

/**
 * Fetch a free geospatial endpoint with timeout + bounded retry + per-host
 * rate limiting + SSRF guard + contactable UA.
 *
 * Throws on network error / timeout after exhausting retries. Returns the
 * Response (even for non-2xx) so callers keep their existing `.ok` handling —
 * but retries 429/5xx internally first.
 */
export async function fetchGeo(url: string, opts: FetchGeoOptions = {}): Promise<Response> {
  const {
    timeoutMs = DEFAULTS.timeoutMs,
    retries = DEFAULTS.retries,
    host: hostOverride,
    maxConcurrentPerHost = DEFAULTS.maxConcurrentPerHost,
    ratePerSec = DEFAULTS.ratePerSec,
    skipSsrfCheck = false,
    headers,
    ...rest
  } = opts;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`fetchGeo: invalid URL`);
  }

  // SSRF guard: refuse private/loopback/link-local/metadata + non-https.
  // checkOperatorUrl also enforces https — the right default for a re-served
  // public data source. (Skippable only for vetted first-party hosts.)
  if (!skipSsrfCheck) {
    const ssrf = checkOperatorUrl(url);
    if (!ssrf.ok) {
      throw new Error(`fetchGeo: SSRF guard blocked URL: ${ssrf.reason}`);
    }
  }

  const host = hostOverride || parsed.hostname;
  const limiter = getLimiter(host, ratePerSec, maxConcurrentPerHost);

  const mergedHeaders = new Headers(headers as HeadersInit | undefined);
  if (!mergedHeaders.has("user-agent")) {
    mergedHeaders.set("User-Agent", GEO_USER_AGENT);
  }

  let lastErr: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    await acquire(limiter);
    try {
      const res = await fetch(url, {
        ...rest,
        headers: mergedHeaders,
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (isRetryableStatus(res.status) && attempt < retries) {
        const retryAfter = parseRetryAfter(res);
        const waitMs = retryAfter ?? backoffMs(attempt);
        logger.warn(`[fetchGeo] retryable status ${res.status} from ${host}`, {
          source: "fetchGeo",
          metadata: { host, status: res.status, attempt, waitMs },
        });
        release(limiter);
        await sleep(waitMs);
        continue;
      }

      release(limiter);
      return res;
    } catch (err) {
      release(limiter);
      lastErr = err;
      const isTimeout = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
      if (attempt < retries) {
        const waitMs = backoffMs(attempt);
        logger.warn(`[fetchGeo] ${isTimeout ? "timeout" : "network error"} from ${host}`, {
          source: "fetchGeo",
          metadata: { host, attempt, waitMs, error: err instanceof Error ? err.message : String(err) },
        });
        await sleep(waitMs);
        continue;
      }
    }
  }

  throw lastErr instanceof Error
    ? lastErr
    : new Error(`fetchGeo: request to ${host} failed after ${retries + 1} attempts`);
}

/** Test-only: reset the in-memory per-host limiters. */
export function __resetFetchGeoLimiters(): void {
  limiters.clear();
}
