/**
 * The PUBLIC health probes — /api/health, /api/health/live, /api/health/cached.
 *
 * Registered from server/routes.ts in the pre-Clerk, pre-auth block, so they
 * answer even when auth is broken. That position is also why they cannot tell
 * a signed-in caller from an anonymous one, and why they answer ONE terse shape
 * to everyone.
 */
import type { Express, Request, Response } from "express";
import { clock } from "./utils/clock";

export function registerPublicHealthRoutes(app: Express): void {
  // PUBLIC HEALTH IS STATUS ONLY (2026-08-31 E-2 recon finding; completed
  // 2026-10-07).
  //
  // The full payload enumerates the vendor stack — every provider's name,
  // configured/unconfigured state, and live failure detail (at the time of the
  // finding it advertised a regrid 401 to the open internet). The 2026-08-31
  // fix redacted /api/health and /api/health/live "for anonymous callers" by
  // reading req.auth — but this block runs BEFORE clerkMiddleware, so req.auth
  // never exists here: everyone got the terse body (correct by accident), while
  // /api/health/cached — Fly's own health-check target, also in this block —
  // kept returning the full component list to anyone. And /api/health/:service,
  // /deep and /replica (registered later) were reachable without a session.
  //
  // So: every public health route answers ONE shape — overall + timestamp +
  // version — with the status code probes read (503 when unavailable). The
  // per-service detail is behind a session at GET /api/system/health
  // (routes-integrations.ts), and the single-service / deep / replica probes
  // are founder-only. Fly (fly.toml [checks.health] → /api/health/cached), the
  // Dockerfile HEALTHCHECK, the deploy/staging curl --fail probes and the
  // docker smoke test all read only the status code.
  // tests/unit/publicHealthIsStatusOnly.test.ts pins every route in the family.
  const publicHealthBody = (result: { overall: string; timestamp?: unknown }) => ({
    overall: result.overall,
    timestamp: result.timestamp ?? clock.now(),
    version: process.env.npm_package_version || "1.0.0",
  });

  app.get("/api/health", async (_req: Request, res: Response) => {
    try {
      const { healthCheckService } = await import("./services/healthCheck");
      // Use cached snapshot maintained by startPeriodicChecks(). Only fall
      // back to a synchronous checkAll() if the cache is empty (first call
      // after boot before the first periodic tick).
      const cached = healthCheckService.getLastResults();
      const result = cached || (await healthCheckService.checkAll());
      const statusCode = result.overall === "unavailable" ? 503 : 200;
      res.setHeader(
        "Cache-Control",
        "public, max-age=10, s-maxage=10, stale-while-revalidate=60",
      );
      res.status(statusCode).json(publicHealthBody(result));
    } catch {
      res.status(503).json(publicHealthBody({ overall: "degraded" }));
    }
  });

  app.get("/api/health/live", async (_req: Request, res: Response) => {
    try {
      const { healthCheckService } = await import("./services/healthCheck");
      const result = await healthCheckService.checkAll();
      const statusCode = result.overall === "unavailable" ? 503 : 200;
      res.setHeader("Cache-Control", "no-store");
      // The deploy pipeline's post-deploy probe reads only the status code
      // (--fail), so the terse body changes nothing for it.
      res.status(statusCode).json(publicHealthBody(result));
    } catch {
      res.status(503).json(publicHealthBody({ overall: "degraded" }));
    }
  });

  app.get("/api/health/cached", async (_req: Request, res: Response) => {
    try {
      const { healthCheckService } = await import("./services/healthCheck");
      const result = healthCheckService.getLastResults();
      const data = result || await healthCheckService.checkAll();
      const statusCode = data.overall === "unavailable" ? 503 : 200;
      // Wave: cost — already memoized server-side; let Cloudflare collapse
      // the herd from Fly health checks too (interval=30s in fly.toml).
      res.setHeader(
        "Cache-Control",
        "public, max-age=10, s-maxage=10, stale-while-revalidate=60",
      );
      // Status only — see PUBLIC HEALTH IS STATUS ONLY above. Signed-in UI
      // that needs the per-service list reads GET /api/system/health.
      res.status(statusCode).json({ ...publicHealthBody(data), uptime: process.uptime() });
    } catch {
      res.status(503).json({ ...publicHealthBody({ overall: "degraded" }), uptime: process.uptime() });
    }
  });
}
