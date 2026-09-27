/**
 * Identity-keyed rate limiters — defined once, mounted once, directly after
 * Clerk (DEFECT-0062, 2026-09-27).
 *
 * WHY THIS MODULE EXISTS. These four limiters used to be defined in
 * server/index.ts and mounted at module scope, with key generators of the
 * form `getClerkAuth(req)?.userId || req.ip`. Express runs middleware in
 * registration order, and Clerk's middleware — the thing that populates
 * `req.auth` — is installed inside registerRoutes(), long after index.ts's
 * module-scope mounts. So `userId` was undefined for every request those
 * limiters ever saw, and every one of them keyed on the fallback. The
 * fallback was `req.ip`, which behind Cloudflare → Fly with
 * `trust proxy = 1` is the Cloudflare EDGE address (server/utils/clientIp.ts
 * has the hop analysis). The net effect:
 *
 *   - the general API budget ("300/min keyed by session") was 300/min per
 *     Cloudflare edge node, shared by every customer routed through it;
 *   - the AI budget ("240/min keyed by userId") likewise;
 *   - the bulk-export cap ("per-org per-day, keyed by org then user") read
 *     `req.organization` before getOrCreateOrg had run as well, so it was
 *     5 exports per day per edge node across ALL orgs;
 *   - the /api/auth budget ("keyed by user-id when authenticated") was per
 *     edge node — the exact CGNAT failure its comment says was fixed.
 *
 * Meanwhile server/routes.ts mounted a second set with the same names
 * (`aiLimiter`, `authLimiter`, `importLimiter`) keyed on `req.user`, which
 * is populated even later (per-route isAuthenticated), so those keyed on IP
 * too; the /api/auth one reached no handler at all, because every
 * /api/auth route is registered before it and answers first.
 *
 * THE RULE THIS MODULE ENCODES: a limiter may key on identity only where
 * identity exists. Everything here is mounted by `mountIdentityRateLimiters`,
 * which routes.ts calls immediately after the Clerk wrapper and before any
 * /api route that needs a session. Limiters that must run earlier (the IP
 * floor, webhooks, imports, MCP) stay in index.ts and key on
 * `getClientIp(req)` — never on identity, never on bare `req.ip`. The
 * `rateLimitIdentityKeying.test.ts` ratchet holds both halves.
 */

import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import type { Express, Request } from "express";
import { getClerkAuth } from "../types/request";
import { getClientIp } from "../utils/clientIp";
import { createLimiterStore } from "./limiterRedisStore";
import { e2eTestAuthEnabled } from "../auth/testAuth";

/**
 * The key every limiter in this module uses: the verified Clerk user when
 * there is one, else the real client IP (CF-Connecting-IP first). Never
 * `req.ip` alone — that is the Cloudflare edge.
 */
export function identityRateLimitKey(req: Request): string {
  const userId = getClerkAuth(req)?.userId;
  if (userId) return `user:${userId}`;
  return `ip:${ipKeyGenerator(getClientIp(req))}`;
}

/** Paths whose handlers call a model. */
const AI_PATHS = ["/api/ai", "/api/pax", "/api/chat", "/api/executive", "/api/document-generation"];

/** Bulk export paths (RS-7, the Asher-takeover export burst). */
const EXPORT_PATHS = [
  "/api/leads/export",
  "/api/properties/export",
  "/api/notes/export",
  "/api/contractors/export",
  "/api/tenants/export",
];

export function mountIdentityRateLimiters(app: Express): void {
  // /api/auth reads (session check, org list, org switch, logout): a
  // permissive cap per user. /api/auth/user is skipped: it is called on every
  // page render to validate the session, Clerk has already verified the JWT,
  // and a tight cap on it produced the 2026-05-10 mobile sign-in hang.
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    store: createLimiterStore("auth"),
    keyGenerator: identityRateLimitKey,
    skip: (req) => req.originalUrl.startsWith("/api/auth/user"),
    message: { message: "Too many requests. Please try again later." },
  });
  app.use("/api/auth", authLimiter);

  // AI / Pax / chat: 240 requests per minute per user. /api/pax fans out ~8
  // calls per page load. Per-org traffic shaping (aiRateLimit) and the
  // per-org USD budget (paxChatGuard / routeAITask) sit behind this.
  const aiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 240,
    standardHeaders: true,
    legacyHeaders: false,
    store: createLimiterStore("ai-user"),
    keyGenerator: identityRateLimitKey,
    skip: () => e2eTestAuthEnabled(), // never on Fly — see server/auth/testAuth.ts
    message: { message: "AI request limit reached. Please wait a moment." },
  });
  for (const path of AI_PATHS) app.use(path, aiLimiter);

  // Bulk export: 5 per day per user. The org is NOT known at a global mount
  // (getOrCreateOrg runs per route), so this is honestly per-user, which is
  // also the unit a takeover operates as. The earlier comment promised
  // "per-org" and the key read an org that was never there.
  const exportLimiter = rateLimit({
    windowMs: 24 * 60 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    store: createLimiterStore("export-user"),
    keyGenerator: (req) => `export:${identityRateLimitKey(req)}`,
    message: { message: "Bulk-export rate limit exceeded. The daily cap is 5 per user. Email support@acreos.io for one-off lifts." },
  });
  for (const path of EXPORT_PATHS) app.use(path, exportLimiter);

  // General authenticated API: 300 requests per minute per user, so one
  // person behind a shared NAT or office egress does not spend the budget of
  // everyone else on it. The per-IP floor that also covers the public,
  // pre-Clerk routes lives in index.ts. /api/auth/user is skipped for the
  // same reason as above; /api/health* is skipped as it always was.
  const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    store: createLimiterStore("api-user"),
    keyGenerator: identityRateLimitKey,
    skip: (req) =>
      e2eTestAuthEnabled() || // E2E suite hammers many routes as one user; never on Fly
      req.originalUrl.startsWith("/api/auth/user") ||
      req.originalUrl.startsWith("/api/health"),
    message: { message: "Too many requests. Please slow down and try again shortly." },
  });
  app.use("/api", apiLimiter);
}
