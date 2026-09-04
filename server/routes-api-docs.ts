/**
 * routes-api-docs.ts
 *
 * Serves Swagger UI and OpenAPI 3.0 spec for the AcreOS API.
 *
 * GET /api/docs          → Swagger UI HTML
 * GET /api/docs/openapi.json → Raw OpenAPI 3.0 spec
 */

import { Router, type Request, type Response, type Express } from 'express';
import { generateOpenAPISpec } from './openapi-spec';
import { reflectAppPaths } from './openapi-reflector';

// Lazily captured app reference — set by registerApiDocsApp() below
// once the app has finished mounting all its routers.
let appRef: Express | null = null;
let reflectedCache: Record<string, any> | null = null;

export function registerApiDocsApp(app: Express): void {
  appRef = app;
  reflectedCache = null;
}

/**
 * Every live route the reflector can see, for COMPLETENESS reporting only.
 *
 * Deliberately not wired into the public response — see the note on
 * `/openapi.json` below. Exported so the gap between "routes that exist" and
 * "routes we document" is measurable without publishing the former.
 */
export function reflectedPathsForAudit(): Record<string, unknown> {
  if (!appRef) return {};
  if (!reflectedCache) reflectedCache = reflectAppPaths(appRef);
  return reflectedCache;
}

const docsRouter = Router();

// ── OpenAPI JSON Spec ──────────────────────────────────────────────────────────

// ── ALLOW-LIST, NOT DENY-LIST ─────────────────────────────────────────────────
//
// This endpoint used to merge `reflectAppPaths(appRef)` — a walk of the LIVE
// Express stack — into the public document, filtered by a 15-entry
// PRIVATE_PATH_PREFIXES deny-list. A deny-list is allow-BY-DEFAULT, so every
// route family nobody thought to add was published: `/api/scp/v2/*` (the
// sovereign control plane: trust/promote, trust/demote, evolution/rollback,
// evolution/pause), `/api/dsar/`, `/api/legal-hold/`, `/api/dunning/`,
// `/api/data-api/`, `/api/mcp`. Unauthenticated, and with
// `Access-Control-Allow-Origin: *`.
//
// Those endpoints are guarded — `/api/scp/v2` carries isAuthenticated +
// getOrCreateOrg + requireFounder. What leaked was their EXISTENCE, which this
// codebase spends a status code concealing: requireFounder returns 404 rather
// than 403 specifically so a non-founder cannot learn that a founder route is
// there (server/auth/clerkAuth.ts). One endpoint was handing out the map the
// other pays to hide.
//
// So the polarity is inverted to match the rest of the codebase — the same
// argument viewerReadOnlyGate's header makes. The public document is now the
// HAND-CURATED spec and nothing else: 22 paths that are a product artifact,
// where adding a route to the app cannot add it here. Stripe, Twilio and
// GitHub all publish a curated document for exactly this reason.
//
// The reflector is kept and still exported: it is a useful COMPLETENESS
// signal — "which live routes are undocumented" — and
// openapiIsAllowListed.test.ts uses it as one. It just no longer decides what
// strangers can see.
docsRouter.get('/openapi.json', (_req: Request, res: Response) => {
  const out = generateOpenAPISpec();
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.json(out);
});

// ── Swagger UI HTML ────────────────────────────────────────────────────────────

/** HTML-escape a value that came from the spec. */
function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── A PAGE THAT ACTUALLY RENDERS ──────────────────────────────────────────────
//
// This route used to serve Swagger UI loaded from unpkg.com. unpkg is not in
// `script-src` or `style-src` (server/middleware/security.ts), and in
// production `script-src` requires a per-request nonce — so the browser
// refused every asset and the page was a blank `#swagger-ui` div. It had been
// shipping a page that could not render.
//
// Adding unpkg to the CSP would loosen a security control for a docs page,
// which is the wrong trade. So the reference is rendered SERVER-SIDE from the
// same curated document `/openapi.json` serves: no external assets, no
// JavaScript at all, and inline `<style>` only, which the policy already
// permits. It cannot be broken by a CDN, an ad blocker, or the next CSP
// tightening.
docsRouter.get('/', (_req: Request, res: Response) => {
  const spec = generateOpenAPISpec() as {
    info?: { title?: string; version?: string; description?: string };
    servers?: Array<{ url?: string }>;
    paths?: Record<string, Record<string, { summary?: string; description?: string; tags?: string[] }>>;
  };

  const base = spec.servers?.[0]?.url ?? "";
  const entries = Object.entries(spec.paths ?? {}).sort(([a], [b]) => a.localeCompare(b));

  const rows = entries
    .map(([path, ops]) => {
      const methods = Object.entries(ops ?? {})
        .filter(([verb]) => ["get", "post", "put", "patch", "delete"].includes(verb))
        .map(([verb, op]) => {
          const summary = op?.summary ?? op?.description ?? "";
          return `        <li><span class="verb v-${esc(verb)}">${esc(verb.toUpperCase())}</span>` +
            `<span class="sum">${esc(summary)}</span></li>`;
        })
        .join("\n");
      if (!methods) return "";
      return `      <section class="op">
        <h2><code>${esc(base)}${esc(path)}</code></h2>
        <ul>
${methods}
        </ul>
      </section>`;
    })
    .filter(Boolean)
    .join("\n");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(spec.info?.title ?? "AcreOS API")}</title>
  <style>
    :root {
      color-scheme: light dark;
      --ink: #16130f; --ink-2: #6b6259; --line: #e6e0d8;
      --bg: #fbf9f6; --card: #ffffff; --brand: #d97541;
      --get: #2f6f4f; --post: #1f5f8b; --put: #8a6a1f; --patch: #8a6a1f; --delete: #a33a2e;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --ink: #f2ede6; --ink-2: #a39a90; --line: #2e2a25;
        --bg: #14120f; --card: #1b1815; --brand: #e08a5c;
        --get: #6fbf90; --post: #6fb0d8; --put: #d6b45f; --patch: #d6b45f; --delete: #e0796a;
      }
    }
    * { box-sizing: border-box; }
    body {
      margin: 0; background: var(--bg); color: var(--ink);
      font: 15px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    .wrap { max-width: 60rem; margin: 0 auto; padding: 3rem 1.25rem 5rem; }
    header { border-bottom: 1px solid var(--line); padding-bottom: 1.5rem; margin-bottom: 2rem; }
    h1 { font-size: 1.65rem; margin: 0 0 .35rem; letter-spacing: -.01em; }
    .meta { color: var(--ink-2); font-size: .875rem; margin: 0; }
    .meta a { color: var(--brand); }
    .op { background: var(--card); border: 1px solid var(--line); border-radius: .625rem; padding: 1rem 1.15rem; margin-bottom: .75rem; }
    .op h2 { font-size: .95rem; margin: 0 0 .6rem; font-weight: 600; }
    .op code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .875rem; word-break: break-all; }
    .op ul { list-style: none; margin: 0; padding: 0; display: grid; gap: .35rem; }
    .op li { display: flex; gap: .6rem; align-items: baseline; }
    .verb { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .7rem; font-weight: 700; letter-spacing: .04em; min-width: 3.75rem; }
    .v-get { color: var(--get); } .v-post { color: var(--post); }
    .v-put, .v-patch { color: var(--put); } .v-delete { color: var(--delete); }
    .sum { color: var(--ink-2); font-size: .875rem; }
    footer { margin-top: 2.5rem; color: var(--ink-2); font-size: .8125rem; border-top: 1px solid var(--line); padding-top: 1.25rem; }
  </style>
</head>
<body>
  <div class="wrap">
    <header>
      <h1>${esc(spec.info?.title ?? "AcreOS API")}</h1>
      <p class="meta">Version ${esc(spec.info?.version ?? "")} · machine-readable spec at
        <a href="/api/docs/openapi.json">/api/docs/openapi.json</a></p>
    </header>
${rows}
    <footer>
      This reference lists the ${entries.length} documented endpoints. It is a curated
      document, not a reflection of the running server: an endpoint appears here only
      when it has been written up deliberately.
    </footer>
  </div>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

export default docsRouter;
