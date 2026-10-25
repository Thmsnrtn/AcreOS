/**
 * routes-ops — Machine operations API for the AI COO.
 *
 * GET-only, bearer-token authenticated. Read-only by construction.
 *
 * Why this exists: the founder dashboard (/api/founder/*) is gated on Clerk
 * sessions, which a machine operator cannot and should not hold. This API
 * exposes the same operational aggregates behind a dedicated service token
 * so the COO can monitor the business programmatically.
 *
 * Auth: Authorization: Bearer <OPS_SERVICE_TOKEN>
 *   - Token is a high-entropy secret set via env (Fly secret, never in git).
 *   - Compared with timingSafeEqual.
 *   - Non-GET/HEAD requests are rejected 403 — read-only by construction.
 *   - When OPS_SERVICE_TOKEN is unset, every endpoint returns 503.
 *
 * Endpoints:
 *   GET /api/ops/summary — asOf, AI spend (month), MRR, org/user counts,
 *                          latest infra snapshot. The morning-brief payload.
 *   GET /api/ops/costs   — full cost breakdown (same sources as
 *                          /api/founder/cost-summary).
 *   GET /api/ops/data    — D2g data-sourcing metrics: coverage, paid
 *                          fall-through per 1k lookups, warehouse-served
 *                          lookups vs the $0.001 target (cost not measured,
 *                          said so), adapter remap rates (dataOpsMetrics.ts).
 *
 * SECURITY NOTES (read before touching):
 *   - This token grants read access to founder-level business data. Treat it
 *     like a production credential: rotate on suspected exposure, never log
 *     it, never return it in a response.
 *   - The GET-only gate is the read-only guarantee. Do not add POST/PUT/
 *     DELETE handlers to this file without a separate security review —
 *     writes belong behind Clerk + requireFounder.
 *   - Rate limiting: none yet. If this is ever exposed beyond the COO's
 *     poller, add one (see server/mcp-server.ts for the pattern).
 */

import type { Express, Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { sql, desc, eq, gte } from "drizzle-orm";

import { unscopedForPlatformOps } from "./utils/orgScopedDb";
// NOTE: unscopedForPlatformOps() must be inline in each QUERY CHAIN, not stored
// in a handle. The org-scoped-fetch lint exemption is CHAIN-scoped: it looks
// back only to the enclosing statement's boundary. `const opsDb = hatch(...)`
// then `opsDb.select()` does NOT exempt the chain. Four deploy attempts died
// learning this. Inline the hatch into every chain below.
import {
  aiUsageDaily,
  costOptimizationRuns,
  organizations,
  users,
} from "@shared/schema";
import { Errors, sendError } from "./utils/errors";
import { logger } from "./utils/logger";
import { clock } from "./utils/clock";

// ─── Auth ────────────────────────────────────────────────────────────────────

function opsServiceAuth(req: Request, res: Response, next: NextFunction): void {
  const expected = process.env.OPS_SERVICE_TOKEN;
  if (!expected) {
    sendError(res, 503, "UNAVAILABLE", "Ops API not configured");
    return;
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    sendError(res, 403, "FORBIDDEN", "Ops service token is read-only");
    return;
  }
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) {
    sendError(res, 401, "UNAUTHORIZED", "Missing bearer token");
    return;
  }
  const token = auth.slice("Bearer ".length).trim();
  const a = Buffer.from(token, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    sendError(res, 401, "UNAUTHORIZED", "Invalid token");
    return;
  }
  next();
}

// ─── Helpers (mirroring routes-founder-cost.ts) ─────────────────────────────

function thisMonthStart(): string {
  const d = clock.now();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

function toNum(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") return parseFloat(v) || 0;
  return 0;
}

async function getInfraSnapshot() {
  // Hatch inlined into the chain: the lint exemption is chain-scoped.
  const rows = await unscopedForPlatformOps(
    "AI COO ops API: cross-org aggregates for machine monitoring (read-only)"
  )
    .select({
      runAt: costOptimizationRuns.runAt,
      totalAiCostUsd: costOptimizationRuns.totalAiCostUsd,
      totalFlyCostUsd: costOptimizationRuns.totalFlyCostUsd,
      mrrUsd: costOptimizationRuns.mrrUsd,
      profitMarginPct: costOptimizationRuns.profitMarginPct,
      customerCount: costOptimizationRuns.customerCount,
    })
    .from(costOptimizationRuns)
    .orderBy(desc(costOptimizationRuns.runAt))
    .limit(1);
  const latest = rows[0];
  if (!latest) return null;
  return {
    runAt: latest.runAt,
    aiCostUsd: toNum(latest.totalAiCostUsd),
    flyCostUsd: toNum(latest.totalFlyCostUsd),
    mrrUsd: toNum(latest.mrrUsd),
    profitMarginPct: toNum(latest.profitMarginPct),
    customerCount: latest.customerCount ?? 0,
  };
}

// ─── Route registration ──────────────────────────────────────────────────────

export function registerOpsRoutes(app: Express): void {
  // Morning-brief payload: one call, everything the COO checks daily.
  app.get("/api/ops/summary", opsServiceAuth, async (_req: Request, res: Response) => {
    try {
      const monthStart = thisMonthStart();

      const [monthRows, orgRows, userRows, infraSnapshot] = await Promise.all([
        unscopedForPlatformOps(
          "AI COO ops API: cross-org aggregates for machine monitoring (read-only)"
        )
          .select({
            totalUsd: sql<string>`SUM(${aiUsageDaily.totalUsd})`,
            totalCalls: sql<string>`SUM(${aiUsageDaily.callCount})`,
          })
          .from(aiUsageDaily)
          .where(gte(aiUsageDaily.date, monthStart)),
        unscopedForPlatformOps(
          "AI COO ops API: cross-org aggregates for machine monitoring (read-only)"
        ).select({ c: sql<number>`COUNT(*)::int` }).from(organizations),
        unscopedForPlatformOps(
          "AI COO ops API: cross-org aggregates for machine monitoring (read-only)"
        ).select({ c: sql<number>`COUNT(*)::int` }).from(users),
        getInfraSnapshot(),
      ]);

      return res.json({
        asOf: clock.now().toISOString(),
        aiSpendThisMonthUsd: toNum(monthRows[0]?.totalUsd),
        aiCallsThisMonth: Math.round(toNum(monthRows[0]?.totalCalls)),
        organizationCount: orgRows[0]?.c ?? 0,
        userCount: userRows[0]?.c ?? 0,
        mrrUsd: infraSnapshot?.mrrUsd ?? 0,
        profitMarginPct: infraSnapshot?.profitMarginPct ?? null,
        infraSnapshot,
      });
    } catch (err) {
      logger.error("[/api/ops/summary] failed", err instanceof Error ? err : undefined);
      return Errors.internal(res, err);
    }
  });

  // D2g: data-sourcing ops metrics (read-only, platform aggregates).
  app.get("/api/ops/data", opsServiceAuth, async (req: Request, res: Response) => {
    try {
      const days = Math.min(Math.max(Number(req.query.days ?? 30) || 30, 1), 365);
      const { loadDataOpsMetrics } = await import("./services/ops/dataOpsMetrics");
      // D2b: the release store is the inventory's reader (tables in 0290).
      const { readReleaseInventory } = await import("./services/landData/releases/releaseStore");
      return res.json(await loadDataOpsMetrics(clock.now(), days, () => readReleaseInventory()));
    } catch (err) {
      logger.error("[/api/ops/data] failed", err instanceof Error ? err : undefined);
      return Errors.internal(res, err);
    }
  });

  // Full cost breakdown — same sources as /api/founder/cost-summary.
  app.get("/api/ops/costs", opsServiceAuth, async (_req: Request, res: Response) => {
    try {
      const monthStart = thisMonthStart();

      const [monthRows, infraSnapshot, perOrgRows] = await Promise.all([
        unscopedForPlatformOps(
          "AI COO ops API: cross-org aggregates for machine monitoring (read-only)"
        )
          .select({
            totalUsd: sql<string>`SUM(${aiUsageDaily.totalUsd})`,
            totalCalls: sql<string>`SUM(${aiUsageDaily.callCount})`,
          })
          .from(aiUsageDaily)
          .where(gte(aiUsageDaily.date, monthStart)),
        getInfraSnapshot(),
        unscopedForPlatformOps(
          "AI COO ops API: cross-org aggregates for machine monitoring (read-only)"
        )
          .select({
            organizationId: aiUsageDaily.organizationId,
            orgName: organizations.name,
            totalUsd: sql<string>`SUM(${aiUsageDaily.totalUsd})`,
            totalCalls: sql<string>`SUM(${aiUsageDaily.callCount})`,
          })
          .from(aiUsageDaily)
          .leftJoin(organizations, eq(organizations.id, aiUsageDaily.organizationId))
          .where(gte(aiUsageDaily.date, monthStart))
          .groupBy(aiUsageDaily.organizationId, organizations.name)
          .orderBy(sql`SUM(${aiUsageDaily.totalUsd}) DESC`)
          .limit(10),
      ]);

      return res.json({
        asOf: clock.now().toISOString(),
        aiSpendThisMonthUsd: toNum(monthRows[0]?.totalUsd),
        aiCallsThisMonth: Math.round(toNum(monthRows[0]?.totalCalls)),
        infraSnapshot,
        topOrgs: perOrgRows.map(
          (r: {
            organizationId: number | null;
            orgName: string | null;
            totalUsd: string | null;
            totalCalls: string | null;
          }) => ({
            organizationId: r.organizationId,
            organizationName: r.orgName ?? `Org ${r.organizationId}`,
            usd: toNum(r.totalUsd),
            calls: Math.round(toNum(r.totalCalls)),
          }),
        ),
      });
    } catch (err) {
      logger.error("[/api/ops/costs] failed", err instanceof Error ? err : undefined);
      return Errors.internal(res, err);
    }
  });
}
