/**
 * Route cost-class metadata (L5b).
 *
 * Every route handler declares an expected cost class so the cost-aware
 * substrate can answer "which routes are budget-relevant?" without
 * scraping individual queries. The class is a coarse forecast — the
 * actual cost is still measured per-request via apiTelemetry — but it
 * lets the founder dashboard distinguish a $0/req static asset route
 * from a $0.50/req Pax-chat route at registration time.
 *
 * Five buckets:
 *   - free    — static / cache-only / no provider call (e.g. /api/healthz)
 *   - low     — single DB query, no AI, no external API (most CRUD)
 *   - medium  — multiple DB queries OR a single cheap provider hit
 *               (e.g. lead enrichment cache hit)
 *   - high    — AI inference, expensive provider call, or fan-out work
 *               (e.g. /api/ai/chat, /api/leads/skip-trace)
 *   - bypass  — explicit opt-out. Use for webhooks where the cost shape
 *               is genuinely unknown at registration time. Surfaces as
 *               "unclassified" on the dashboard so the founder can audit.
 *
 * Usage at route registration:
 *
 *   import { costClass } from "@/server/utils/costClass";
 *
 *   app.get("/api/leads", isAuthenticated, getOrCreateOrg,
 *     costClass("low"),
 *     async (req, res) => { ... }
 *   );
 *
 * Or the wrapper form for handler-only registration:
 *
 *   app.post("/api/ai/chat", isAuthenticated,
 *     withCostClass("high", async (req, res) => { ... })
 *   );
 *
 * The `scripts/check-route-cost-class.mjs` script enforces that any
 * server/routes*.ts file has costClass declared on every new app.METHOD
 * call (delta-only check against main).
 */

import type { Request, Response, NextFunction } from "express";

export type CostClass = "free" | "low" | "medium" | "high" | "bypass";

export const COST_CLASSES: readonly CostClass[] = ["free", "low", "medium", "high", "bypass"] as const;

declare global {
  namespace Express {
    interface Request {
      /**
       * Cost class declared at route registration. apiTelemetry uses this
       * to enrich its per-route counters; the founder cost dashboard
       * surfaces routes whose realised cost diverges from their declared
       * class (a "low" route that consistently hits AI is a flag).
       */
      costClass?: CostClass;
    }
  }
}

/**
 * Middleware form. Place anywhere in the middleware chain before the
 * handler:
 *
 *   app.get("/api/leads", isAuthenticated, costClass("low"), handler);
 */
export function costClass(cls: CostClass) {
  return function costClassMw(req: Request, _res: Response, next: NextFunction) {
    req.costClass = cls;
    next();
  };
}

/**
 * Wrapper form. Marks the handler itself, useful when the handler is
 * declared separately:
 *
 *   const getLeads = withCostClass("low", async (req, res) => { ... });
 *   app.get("/api/leads", isAuthenticated, getLeads);
 */
export function withCostClass<H extends (req: Request, res: Response, next?: NextFunction) => unknown>(
  cls: CostClass,
  handler: H,
): H {
  // Attach a non-enumerable marker the lint script + apiTelemetry can read.
  Object.defineProperty(handler, "__costClass", {
    value: cls,
    enumerable: false,
    writable: false,
    configurable: false,
  });
  // Wrap so the per-request stamp also happens at handler entry.
  const wrapped = ((req: Request, res: Response, next?: NextFunction) => {
    req.costClass = cls;
    return handler(req, res, next);
  }) as H;
  Object.defineProperty(wrapped, "__costClass", {
    value: cls,
    enumerable: false,
    writable: false,
    configurable: false,
  });
  return wrapped;
}
