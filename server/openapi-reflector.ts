/**
 * openapi-reflector.ts
 *
 * Walks the live Express app's router stack and emits an OpenAPI 3.0
 * `paths` object covering every registered route. Merges with the
 * hand-curated spec from ./openapi-spec.ts so hand-written schemas,
 * descriptions, and examples survive — the reflector only *adds* paths
 * the hand spec doesn't already cover.
 *
 * Driven by Yuki D03 (persona 18 developer-integrator): the hand spec
 * documents ~29 paths but the app has >1,000 registered. Rather than
 * writing each by hand we introspect them so the spec is never >30s
 * out of date with reality.
 */

import type { Express } from "express";

type Method = "get" | "post" | "put" | "patch" | "delete" | "options" | "head";
const METHODS: readonly Method[] = [
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "options",
  "head",
] as const;

interface ExtractedRoute {
  method: Method;
  path: string;
}

/**
 * Convert Express-style `/foo/:id` to OpenAPI-style `/foo/{id}`.
 * Leaves `*` wildcards alone — they can't be expressed in OpenAPI
 * and will be filtered out before emission.
 */
function expressPathToOpenApi(path: string): string {
  return path.replace(/:([A-Za-z_][A-Za-z0-9_]*)\??/g, (_m, name) => `{${name}}`);
}

/** Collect the parameter names from an Express path. */
function extractPathParams(path: string): string[] {
  const names: string[] = [];
  const re = /:([A-Za-z_][A-Za-z0-9_]*)\??/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(path)) !== null) names.push(m[1]);
  return names;
}

/**
 * Recursively walk the Express router stack (which is also used by
 * every sub-router mounted via `app.use`) and gather all
 * `{method, path}` pairs.
 *
 * Express stacks are trees: `app._router.stack` holds a mix of
 * middleware-layers and route-layers. Route layers have a `.route`
 * with `.methods` keys and a `.path` string. Router layers (sub-apps)
 * have a `.handle.stack` we recurse into, with the mount path
 * extracted from `.regexp`.
 */
function walkRouter(router: any, basePath: string): ExtractedRoute[] {
  const out: ExtractedRoute[] = [];
  const stack: any[] = router?.stack || [];
  for (const layer of stack) {
    if (layer.route) {
      const rawPath = layer.route.path;
      // A single route can be mounted at multiple paths as an array; normalize.
      const paths: string[] = Array.isArray(rawPath) ? rawPath : [rawPath];
      for (const p of paths) {
        if (typeof p !== "string" || p.includes("*")) continue;
        for (const method of METHODS) {
          if (layer.route.methods?.[method]) {
            out.push({ method, path: joinPaths(basePath, p) });
          }
        }
      }
    } else if (layer.name === "router" && layer.handle?.stack) {
      // Sub-router. Mount path is encoded in `layer.regexp`; we can
      // extract it by asking Express for its `path` property
      // (populated when fast_slash is false) or by walking `layer.keys`.
      const mount = extractMountPath(layer) ?? "";
      out.push(...walkRouter(layer.handle, joinPaths(basePath, mount)));
    }
  }
  return out;
}

function extractMountPath(layer: any): string | null {
  // Express stores the source regexp + its keys. Prefer an explicit
  // `path` field if present (Express 5 sets this in some cases).
  if (typeof layer.path === "string") return layer.path;
  // Otherwise try to recover from the regexp source.
  const src: string = layer?.regexp?.source ?? "";
  // Express builds regexps like `^\/api\/?(?=\/|$)`; strip escaping.
  // This isn't perfect but recovers 99% of real mount paths.
  const m = src.match(/^\^\\?\/(.*?)\\\/\?(?:\$|\(\?=)/);
  if (!m) return null;
  return "/" + m[1].replace(/\\\//g, "/").replace(/\\\./g, ".");
}

function joinPaths(a: string, b: string): string {
  if (!b || b === "/") return a || "/";
  if (!a || a === "/") return b.startsWith("/") ? b : "/" + b;
  return a.replace(/\/+$/, "") + (b.startsWith("/") ? b : "/" + b);
}

/**
 * Guess a tag for grouping — the first path segment after `/api/`.
 * e.g. `/api/leads/{id}` → `leads`.
 */
function inferTag(path: string): string {
  const cleaned = path.replace(/^\/api\//, "");
  const head = cleaned.split("/")[0] || "misc";
  return head === "" ? "misc" : head;
}

/**
 * Route prefixes that MUST NOT appear in the public OpenAPI spec.
 *
 * SEC (Lens 23 / Yuki audit): the /api/docs endpoint is deliberately
 * unauthenticated so external integrators can read the public surface
 * before signing up. The reflector, left unchecked, walks the entire
 * Express router and emits a path entry for every internal/admin/
 * founder/debug route too. That's an enumeration goldmine — an
 * attacker hitting /api/docs/openapi.json before a single auth attempt
 * gets a free map of every privileged endpoint, their HTTP verbs, and
 * their path parameter names.
 *
 * Anything under these prefixes is stripped from the reflected output.
 * Hand-curated entries in openapi-spec.ts are still merged in for
 * documented public paths. Adding a new private prefix here is a
 * cheap defensive move that does NOT block any legitimate caller —
 * they don't need to read the doc to call the endpoint.
 */
const PRIVATE_PATH_PREFIXES: readonly string[] = [
  "/api/admin/",
  "/api/founder/",
  "/api/atlas/",        // Atlas chat surface — founder-only
  "/api/internal/",
  "/api/_internal/",
  "/api/dev/",          // dev-only debug surfaces
  "/api/debug/",
  "/api/ops/",
  "/api/test/",
  "/api/__",            // any double-underscore reserved path
  "/api/webhooks/",     // webhook receivers — secret-signed, not for callers
  "/api/sse/",          // server-sent events transport, not REST-shaped
  "/api/borrower/",     // borrower-portal session surface; uses its own auth
  "/api/portal/",
  "/api/sign/",         // public e-sign HMAC-tokened, not a documented API
];

function isPrivatePath(path: string): boolean {
  for (const prefix of PRIVATE_PATH_PREFIXES) {
    if (path === prefix.replace(/\/$/, "") || path.startsWith(prefix)) {
      return true;
    }
  }
  return false;
}

/**
 * Build an OpenAPI 3.0 `paths` object from the introspected routes.
 * Each operation is given:
 *   - an `operationId` derived from `method + path`
 *   - a `tags` entry so Swagger UI groups them
 *   - path-parameter descriptors for every `:name` in the Express path
 *   - a generic `200` response with no schema (the hand spec fills in
 *     rich schemas where it overrides).
 *
 * Paths matching PRIVATE_PATH_PREFIXES are deliberately excluded so the
 * public, unauthenticated /api/docs surface doesn't enumerate the
 * internal/admin/founder routes.
 */
export function buildPathsFromRoutes(
  routes: ExtractedRoute[]
): Record<string, any> {
  const paths: Record<string, any> = {};
  for (const { method, path } of routes) {
    if (!path.startsWith("/api/")) continue;
    if (isPrivatePath(path)) continue;
    const specPath = expressPathToOpenApi(path);
    const params = extractPathParams(path).map((name) => ({
      name,
      in: "path",
      required: true,
      schema: { type: "string" },
    }));
    const op = {
      operationId: deriveOperationId(method, path),
      tags: [inferTag(specPath)],
      summary: `${method.toUpperCase()} ${specPath}`,
      ...(params.length ? { parameters: params } : {}),
      responses: {
        "200": { description: "Successful response" },
        "401": { description: "Unauthorized" },
        "403": { description: "Forbidden" },
        "404": { description: "Not found" },
      },
    };
    paths[specPath] ??= {};
    paths[specPath][method] = op;
  }
  return paths;
}

function deriveOperationId(method: Method, path: string): string {
  const cleaned = path
    .replace(/^\/api\//, "")
    .replace(/\//g, "_")
    .replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, "by_$1")
    .replace(/[^A-Za-z0-9_]/g, "");
  return method + "_" + cleaned;
}

/**
 * Top-level entry point — takes the running Express app and returns
 * the `paths` object to merge into the OpenAPI spec.
 */
export function reflectAppPaths(app: Express): Record<string, any> {
  // Express 4 exposes the router as `app._router`. Express 5 exposes
  // it as `app.router`. Support both.
  const router: any = (app as any)._router ?? (app as any).router;
  if (!router?.stack) return {};
  const routes = walkRouter(router, "");
  // De-dupe — the same route can appear multiple times when a middleware
  // is wrapped (e.g. rate limiter + body parser on top of the same path).
  const seen = new Set<string>();
  const unique: ExtractedRoute[] = [];
  for (const r of routes) {
    const key = `${r.method} ${r.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(r);
  }
  return buildPathsFromRoutes(unique);
}
