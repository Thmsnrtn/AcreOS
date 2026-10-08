// ============================================================================
// server/middleware/secretColumnGuard.ts — no secret column leaves in a
// JSON response.
// ----------------------------------------------------------------------------
// Installed ONCE, app-wide, in server/index.ts before any route is
// registered, so it wraps `res.json` for every handler in the process —
// /api, /api/v1, /mcp and anything mounted later. `res.send(object)` routes
// through `res.json` in Express, so it is covered as well.
//
// What it does: passes the payload through `stripSecretColumns()`
// (server/utils/secretColumns.ts), which removes the registered secret keys
// from rows anywhere in the payload — arrays, nested joins, spreads, audit
// snapshots — and any value carrying the encryption-envelope prefix. The
// input object is never mutated.
//
// Every removal is a handler that serialized a secret column, so each one is
// counted (acreos_response_secret_column_stripped_total{table,key}) and
// logged at warn with the route and keys. It runs in every environment: a
// guard that only runs in production is a guard nobody has seen work.
//
// Not covered: bodies written as pre-serialized strings (`res.send(JSON
// .stringify(x))`), streams and `res.write`. Those are serialized by the
// handler, not by Express, and are out of this guard's population.
// ============================================================================

import type { Request, Response, NextFunction } from "express";
import { stripSecretColumns } from "../utils/secretColumns";
import { recordResponseSecretColumnStripped } from "../metrics";
import { logger } from "../utils/logger";

/** Marker so a second install is a no-op rather than a double walk. */
const GUARDED = Symbol.for("acreos.secretColumnGuard");

function routeLabel(req: Request): string {
  const routePath = (req.route as { path?: unknown } | undefined)?.path;
  const pattern = typeof routePath === "string" ? `${req.baseUrl ?? ""}${routePath}` : req.path;
  return `${req.method} ${pattern}`;
}

export function secretColumnGuard(req: Request, res: Response, next: NextFunction): void {
  const r = res as Response & { [GUARDED]?: true };
  if (r[GUARDED]) return next();
  r[GUARDED] = true;

  const originalJson = res.json.bind(res);
  res.json = ((body?: unknown) => {
    const { value, stripped, unwalked } = stripSecretColumns(body);
    if (stripped.length > 0) {
      const keys = new Set<string>();
      for (const s of stripped) {
        recordResponseSecretColumnStripped(s.table, s.key);
        keys.add(`${s.table}.${s.key}`);
      }
      logger.warn("[secretColumnGuard] removed secret columns from a response", {
        route: routeLabel(req),
        keys: [...keys],
        count: stripped.length,
        firstPath: stripped[0]!.path,
      });
    }
    if (unwalked > 0) {
      logger.warn("[secretColumnGuard] response subtrees not walked (depth cap or cycle)", {
        route: routeLabel(req),
        unwalked,
      });
    }
    return originalJson(value);
  }) as Response["json"];
  next();
}
