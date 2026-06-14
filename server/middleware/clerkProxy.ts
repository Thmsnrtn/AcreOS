import type { Request, Response } from "express";
import { e2eTestAuthEnabled } from "../auth/testAuth";
import { logger } from "../utils/logger";
import { sendError } from "../utils/errors";

// Clerk Frontend API origin we proxy to. Cloudflare blocks the vanity
// clerk.acreos.io (Error 1000), so the browser talks to /__clerk and we relay
// to the *.clerk.accounts.dev backing FAPI here.
//
// Override with the CLERK_FAPI_ORIGIN env var if the instance's backing domain
// ever changes (e.g. a new Clerk instance) — no code edit required. The default
// is the current production instance's backing domain. Do NOT derive this from
// the publishable key: that encodes the Cloudflare-blocked vanity domain.
// syntheticChecks.ts imports both constants so the health probe always targets
// the exact origin the proxy uses.
const DEFAULT_CLERK_FAPI_ORIGIN = "https://possible-emu-83.clerk.accounts.dev";
export const CLERK_FAPI_ORIGIN =
  process.env.CLERK_FAPI_ORIGIN?.trim().replace(/\/+$/, "") || DEFAULT_CLERK_FAPI_ORIGIN;
// Hostname only — used to rewrite upstream Location headers back through /__clerk
// regardless of which origin is configured.
export const CLERK_FAPI_HOST = new URL(CLERK_FAPI_ORIGIN).host;

// Bound the upstream call well below the 30s global requestTimeout wall
// (server/middleware/security.ts). PROD BUG 2026-06-09: an un-timed fetch to
// Clerk FAPI hung ~30s on session-token refresh; the global timeout then sent a
// 504, and when this fetch finally settled it tried to respond AGAIN ->
// ERR_HTTP_HEADERS_SENT -> 500. A 10s abort returns a clean response from here
// first, so there is never a late second send.
export const CLERK_UPSTREAM_TIMEOUT_MS = 10_000;

/**
 * Factory for the /__clerk reverse-proxy handler. Extracted from routes.ts so
 * the double-send / timeout behavior is unit-testable in isolation.
 *
 * `fetchImpl` is injectable purely for tests; production uses global `fetch`.
 */
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

      // STR-011 root cause: /v1/client is per-session and MUST NOT be cached
      // across users. /v1/environment is safe to cache (instance-level / public).
      if (req.method === "GET" && clerkPath === "/v1/environment") {
        const cacheKey = `clerk:${clerkPath}`;
        if ((globalThis as any).__clerkCache?.[cacheKey] && Date.now() - (globalThis as any).__clerkCache[cacheKey].ts < 60000) {
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
        "Clerk-Proxy-Url": "https://acreos.io/__clerk",
        "Clerk-Secret-Key": process.env.CLERK_SECRET_KEY || "",
      };
      for (const key of ["content-type", "authorization", "cookie", "accept", "user-agent", "referer", "origin"]) {
        if (req.headers[key]) fwdHeaders[key] = req.headers[key] as string;
      }
      fwdHeaders["x-forwarded-for"] = req.ip || req.socket.remoteAddress || "";
      fwdHeaders["x-forwarded-proto"] = "https";
      fwdHeaders["x-forwarded-host"] = "acreos.io";
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
          res.appendHeader("Set-Cookie", raw.replace(/domain=[^;]+/gi, "domain=.acreos.io"));
        }
      }

      clerkRes.headers.forEach((value, key) => {
        const k = key.toLowerCase();
        if (["transfer-encoding", "connection", "content-encoding", "content-length", "set-cookie"].includes(k)) return;
        if (k === "location") {
          let loc = value;
          if (loc.startsWith("/v1/") || loc.startsWith("/npm/")) loc = "/__clerk" + loc;
          if (loc.includes(CLERK_FAPI_HOST)) loc = loc.replace(CLERK_FAPI_ORIGIN, "/__clerk");
          if (loc.includes("accounts.acreos.io")) loc = "https://acreos.io/";
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
        (globalThis as any).__clerkCache[cacheKey] = { status: clerkRes.status, headers: hdrs, body: responseBody, ts: Date.now() };
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
        sendError(res, 504, "Gateway Timeout", "Clerk upstream timed out");
      } else {
        sendError(res, 502, "BAD_GATEWAY", "Clerk proxy error");
      }
    }
  };
}
