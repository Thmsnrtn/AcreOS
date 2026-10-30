import type { Request, Response } from "express";
import { e2eTestAuthEnabled } from "../auth/testAuth";
import { logger } from "../utils/logger";
import { Errors } from "../utils/errors";
import { clock } from "../utils/clock";

// Clerk Frontend API origin we proxy to. Cloudflare blocks the vanity
// clerk.acreos.io (Error 1000), so the browser talks to /__clerk and we relay
// to the *.clerk.accounts.dev backing FAPI here.
//
// Override with the CLERK_FAPI_ORIGIN env var if the instance's backing domain
// ever changes (e.g. a new Clerk instance) — no code edit required. The default
// is the current production instance's backing domain. Do NOT derive this from
// the publishable key: that encodes the Cloudflare-blocked vanity domain.
const DEFAULT_CLERK_FAPI_ORIGIN = "https://possible-emu-83.clerk.accounts.dev";
const CLERK_FAPI_ORIGIN =
  process.env.CLERK_FAPI_ORIGIN?.trim().replace(/\/+$/, "") || DEFAULT_CLERK_FAPI_ORIGIN;
// Hostname only — used to rewrite upstream Location headers back through /__clerk
// regardless of which origin is configured.
const CLERK_FAPI_HOST = new URL(CLERK_FAPI_ORIGIN).host;

// Bound the upstream call well below the 30s global requestTimeout wall
// (server/middleware/security.ts). PROD BUG 2026-06-09: an un-timed fetch to
// Clerk FAPI hung ~30s on session-token refresh; the global timeout then sent a
// 504, and when this fetch finally settled it tried to respond AGAIN ->
// ERR_HTTP_HEADERS_SENT -> 500. A 10s abort returns a clean response from here
// first, so there is never a late second send.
export const CLERK_UPSTREAM_TIMEOUT_MS = 10_000;

export interface SignInProxyProbe {
  /** null = could not be probed here (no APP_URL, or test-auth mode blocks the proxy by design). */
  ok: boolean | null;
  status: number | null;
  detail: string;
}

/**
 * Probe sign-in the way a browser reaches it: GET <APP_URL>/__clerk/v1/environment,
 * through this proxy. Probing the backing FAPI directly (what clerk_proxy_health
 * did) answered 200 through the whole 2026-10-30 outage, because the defect was
 * in what the proxy forwarded, so the probe must go through the proxy.
 */
export async function probeSignInProxy(fetchImpl: typeof fetch = fetch): Promise<SignInProxyProbe> {
  if (e2eTestAuthEnabled()) return { ok: null, status: null, detail: "test-auth mode blocks the Clerk proxy by design" };
  const base = process.env.APP_URL?.trim().replace(/\/+$/, "");
  if (!base) return { ok: null, status: null, detail: "APP_URL is not set, so the public sign-in path cannot be probed" };
  try {
    const r = await fetchImpl(`${base}/__clerk/v1/environment`, { method: "GET", signal: AbortSignal.timeout(CLERK_UPSTREAM_TIMEOUT_MS) });
    if (r.ok) return { ok: true, status: r.status, detail: "the sign-in proxy answered /v1/environment" };
    const text = await r.text().catch(() => "");
    const code = /"code"\s*:\s*"([a-z_]+)"/.exec(text)?.[1];
    return { ok: false, status: r.status, detail: `${base}/__clerk/v1/environment returned ${r.status}${code ? ` ${code}` : ""}; the sign-in widget cannot load` };
  } catch (err) {
    return { ok: false, status: null, detail: `${base}/__clerk/v1/environment did not answer (${err instanceof Error ? err.message : String(err)})` };
  }
}

/**
 * Factory for the /__clerk reverse-proxy handler. Extracted from routes.ts so
 * the double-send / timeout behavior is unit-testable in isolation.
 *
 * `fetchImpl` is injectable purely for tests; production uses global `fetch`.
 */
/**
 * True when a Location value points at a Clerk accounts host. Parsed, not
 * substring-matched: "accounts.acreos.io" appearing inside a path or query
 * of some other host must not trigger the rewrite (CodeQL: incomplete URL
 * substring sanitization).
 */
function isAccountsHost(loc: string): boolean {
  try {
    const host = new URL(loc).hostname;
    return host === "accounts.acreos.io" || host.endsWith(".accounts.acreos.io");
  } catch {
    return false;
  }
}

export function createClerkProxyHandler(fetchImpl: typeof fetch = fetch) {
  return async function clerkProxyHandler(req: Request, res: Response): Promise<void> {
    // E2E test-auth: block the Clerk proxy so Clerk-JS fails to load and the
    // SPA renders via the API-based useAuth (no FAPI redirect to a domain CI
    // can't resolve). Hard-gated; never active on Fly. See auth/testAuth.ts.
    if (e2eTestAuthEnabled()) {
      res.status(404).end();
      return;
    }
    try {
      const clerkPath = req.originalUrl.replace(/^\/__clerk/, "") || "/";

      // The proxy's public identity is THIS request's host — never a
      // hardcoded production origin. On staging, telling FAPI the proxy
      // lives at acreos.io makes it answer with acreos.io-bound script
      // URLs; the browser's cross-origin script load is then denied
      // (WebKit) and Clerk JS never loads (issue #359).
      const publicHost = req.headers.host || "acreos.io";
      const publicOrigin = `https://${publicHost}`;

      // STR-011 root cause: /v1/client is per-session and MUST NOT be cached
      // across users. /v1/environment is safe to cache (instance-level / public).
      if (req.method === "GET" && clerkPath === "/v1/environment") {
        const cacheKey = `clerk:${clerkPath}`;
        if ((globalThis as any).__clerkCache?.[cacheKey] && clock.nowMs() - (globalThis as any).__clerkCache[cacheKey].ts < 60000) {
          const cached = (globalThis as any).__clerkCache[cacheKey];
          res.setHeader("X-Clerk-Cache", "hit");
          cached.headers.forEach(([k, v]: [string, string]) => res.setHeader(k, v));
          res.status(cached.status);
          res.end(cached.body);
          return;
        }
      }

      const targetUrl = `${CLERK_FAPI_ORIGIN}${clerkPath}`;
      const fwdHeaders: Record<string, string> = {
        "Clerk-Proxy-Url": `${publicOrigin}/__clerk`,
        "Clerk-Secret-Key": process.env.CLERK_SECRET_KEY || "",
      };
      for (const key of ["content-type", "authorization", "cookie", "accept", "user-agent", "referer", "origin"]) {
        if (req.headers[key]) fwdHeaders[key] = req.headers[key] as string;
      }
      fwdHeaders["x-forwarded-for"] = req.ip || req.socket.remoteAddress || "";
      fwdHeaders["x-forwarded-proto"] = "https";
      // NO x-forwarded-host (PROD OUTAGE 2026-10-30: nobody could sign in).
      // FAPI attributes a request to its instance by that header when it is
      // present, and the public host (acreos.io, acreos-staging.fly.dev) is
      // not the instance's frontend domain, so every /v1/environment and
      // /v1/client answered 400 host_invalid and the <SignIn> widget never
      // got a form. The proxy's public identity travels in Clerk-Proxy-Url
      // above; tests/unit/clerkProxyForwardedHost.test.ts pins the absence.
      let body: string | undefined;
      if (!["GET", "HEAD"].includes(req.method)) {
        const ct = (req.headers["content-type"] || "").toLowerCase();
        if (ct.includes("application/json")) body = JSON.stringify(req.body);
        else if (ct.includes("form-urlencoded") && typeof req.body === "object") body = new URLSearchParams(req.body as Record<string, string>).toString();
        else if (typeof req.body === "string") body = req.body;
      }

      const clerkRes = await fetchImpl(targetUrl, {
        method: req.method,
        headers: fwdHeaders,
        body,
        redirect: "manual",
        signal: AbortSignal.timeout(CLERK_UPSTREAM_TIMEOUT_MS),
      });

      // If a response already went out (global request timeout fired, or the
      // client disconnected) while we were awaiting upstream, stop here rather
      // than throwing ERR_HTTP_HEADERS_SENT on the header/body writes below.
      if (res.headersSent || res.writableEnded) return;

      // Set-Cookie: use getSetCookie() for spec-blessed per-cookie values.
      const setCookies = clerkRes.headers.getSetCookie();
      if (setCookies.length > 0) {
        const cookieNames = setCookies.map((c) => c.split("=")[0]);
        logger.info(`[clerk-proxy] ${req.method} ${clerkPath} -> Set-Cookie: ${cookieNames.join(", ")}`);
        for (const raw of setCookies) {
          // On the production domain the cookie is shared across subdomains
          // (.acreos.io). Anywhere else (staging, previews) the cookie must be
          // host-scoped to the proxy's own host — a .acreos.io domain attribute
          // on a staging response is rejected and the session never sticks.
          const rewritten = publicHost === "acreos.io" || publicHost.endsWith(".acreos.io")
            ? raw.replace(/domain=[^;]+/gi, "domain=.acreos.io")
            : raw.replace(/;\s*domain=[^;]+/gi, "");
          res.appendHeader("Set-Cookie", rewritten);
        }
      }

      clerkRes.headers.forEach((value, key) => {
        const k = key.toLowerCase();
        if (["transfer-encoding", "connection", "content-encoding", "content-length", "set-cookie"].includes(k)) return;
        if (k === "location") {
          let loc = value;
          if (loc.startsWith("/v1/") || loc.startsWith("/npm/")) loc = "/__clerk" + loc;
          if (loc.includes(CLERK_FAPI_HOST)) loc = loc.replace(CLERK_FAPI_ORIGIN, "/__clerk");
          if (isAccountsHost(loc)) loc = `${publicOrigin}/`;
          res.setHeader(key, loc);
          return;
        }
        res.setHeader(key, value);
      });
      res.status(clerkRes.status);
      const responseBody = Buffer.from(await clerkRes.arrayBuffer());

      // Cache ONLY /v1/environment (instance-level, safe to share).
      if (req.method === "GET" && clerkRes.status < 400 && clerkPath === "/v1/environment") {
        const cacheKey = `clerk:${clerkPath}`;
        if (!(globalThis as any).__clerkCache) (globalThis as any).__clerkCache = {};
        const hdrs: [string, string][] = [];
        clerkRes.headers.forEach((v, k) => { if (!["transfer-encoding", "connection", "content-encoding", "content-length"].includes(k)) hdrs.push([k, v]); });
        (globalThis as any).__clerkCache[cacheKey] = { status: clerkRes.status, headers: hdrs, body: responseBody, ts: clock.nowMs() };
      }

      // Final guard before the body write: the global timeout could have fired
      // during the await on arrayBuffer() above.
      if (res.headersSent || res.writableEnded) return;
      res.end(responseBody);
    } catch (err: any) {
      // A 10s upstream abort surfaces here as an AbortError/TimeoutError. Map it
      // to a clean 504 (matching the global timeout's contract), not a 502.
      const aborted = err?.name === "AbortError" || err?.name === "TimeoutError";
      logger.error("[clerk-proxy] " + (aborted ? `upstream timeout after ${CLERK_UPSTREAM_TIMEOUT_MS}ms: ${err.message}` : err.message));
      // CRITICAL: the global requestTimeout (or the success path above) may have
      // already sent a response before this catch ran — sending again throws
      // ERR_HTTP_HEADERS_SENT -> 500. Guard every terminal response path.
      if (res.headersSent || res.writableEnded) return;
      if (aborted) {
        Errors.gatewayTimeout(res, "Clerk upstream timed out — please try again.");
      } else {
        Errors.badGateway(res, "The Clerk authentication proxy hit an error — please try again.");
      }
    }
  };
}
