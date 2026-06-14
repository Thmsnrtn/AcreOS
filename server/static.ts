import express, { type Express, type NextFunction, type Request, type Response } from "express";
import fs from "fs";
import path from "path";
import { sendError } from "./utils/errors";

/**
 * HTTP/2-safe pre-compressed asset middleware. Sidesteps the
 * compression@1.8 + Node http2 negotiation bug by serving statically
 * pre-compressed `.br` / `.gz` files (emitted by vite-plugin-compression
 * during `npm run build`) when the client advertises support.
 *
 * Order matters: this must run BEFORE express.static so it gets first
 * crack at /assets/* requests. If the client doesn't support br/gzip,
 * or no pre-compressed sibling file exists, it calls next() and the
 * regular static middleware serves the original.
 *
 * Verified by curl after deploy: `curl -sI -H 'Accept-Encoding: br' …`
 * should return `content-encoding: br` for /assets/*.js | .css.
 */
function preCompressedAssets(distPath: string) {
  const CONTENT_TYPES: Record<string, string> = {
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
  };

  return (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    const accept = String(req.headers["accept-encoding"] ?? "");
    const wantsBrotli = /\bbr\b/i.test(accept);
    const wantsGzip = /\bgzip\b/i.test(accept);
    if (!wantsBrotli && !wantsGzip) return next();

    // Resolve safely; reject any path traversal attempt.
    const requested = decodeURIComponent(req.path);
    if (requested.includes("..")) return next();
    const filePath = path.join(distPath, requested);
    const ext = path.extname(filePath).toLowerCase();
    const contentType = CONTENT_TYPES[ext];
    if (!contentType) return next(); // not a type we pre-compress

    const candidates: Array<{ enc: "br" | "gzip"; ext: string }> = [];
    if (wantsBrotli) candidates.push({ enc: "br", ext: ".br" });
    if (wantsGzip) candidates.push({ enc: "gzip", ext: ".gz" });

    for (const { enc, ext: cmpExt } of candidates) {
      const cmpPath = filePath + cmpExt;
      try {
        const stat = fs.statSync(cmpPath);
        if (!stat.isFile()) continue;
        res.setHeader("Content-Type", contentType);
        res.setHeader("Content-Encoding", enc);
        res.setHeader("Content-Length", String(stat.size));
        res.setHeader("Vary", "Accept-Encoding");
        // Match express.static long-cache semantics for hashed assets.
        // Same logic as the wrapping express.static call below — content-
        // hashed filenames are immutable for one year.
        const isHashedAsset = /\/assets\//.test(requested);
        if (process.env.NODE_ENV === "production" && isHashedAsset) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        }
        const stream = fs.createReadStream(cmpPath);
        stream.on("error", () => res.end());
        stream.pipe(res);
        return;
      } catch {
        // file not found — try next candidate
      }
    }
    return next();
  };
}

/** Public config injected into index.html as window.__ENV__ so the SPA
 *  can read runtime env vars that weren't available at Vite build time. */
function buildRuntimeEnvPayload(): string {
  const cfg: Record<string, string> = {};
  if (process.env.VITE_CLERK_PUBLISHABLE_KEY) cfg.VITE_CLERK_PUBLISHABLE_KEY = process.env.VITE_CLERK_PUBLISHABLE_KEY;
  if (process.env.VITE_MAPBOX_TOKEN) cfg.VITE_MAPBOX_ACCESS_TOKEN = process.env.VITE_MAPBOX_TOKEN;
  if (process.env.VITE_MAPBOX_ACCESS_TOKEN) cfg.VITE_MAPBOX_ACCESS_TOKEN = process.env.VITE_MAPBOX_ACCESS_TOKEN;
  if (process.env.VITE_SENTRY_DSN) cfg.VITE_SENTRY_DSN = process.env.VITE_SENTRY_DSN;
  // PostHog public project key. Read at runtime (not baked at build) so the
  // founder can rotate via `fly secrets set VITE_POSTHOG_KEY=...` + redeploy
  // without a rebuild. client/src/lib/analytics.ts already reads from both
  // import.meta.env and window.__ENV__; we inject the runtime value here.
  if (process.env.VITE_POSTHOG_KEY) cfg.VITE_POSTHOG_KEY = process.env.VITE_POSTHOG_KEY;
  if (process.env.VITE_POSTHOG_HOST) cfg.VITE_POSTHOG_HOST = process.env.VITE_POSTHOG_HOST;
  // Deploy SHA — lets version-check.ts read the running build's SHA from
  // window.__ENV__ even when vite didn't bake VITE_GIT_SHA into the bundle.
  // Without a real SHA here, installVersionCheck() no-ops and stale tabs
  // never auto-reload (the cache-clearing pain users hit).
  if (process.env.VITE_GIT_SHA) cfg.VITE_GIT_SHA = process.env.VITE_GIT_SHA;
  // E2E test-auth — tells the client to skip the real ClerkProvider (which
  // would do a dev-instance handshake redirect CI can't complete) and rely on
  // the API-based useAuth. Mirrors server/auth/testAuth.ts; never set on Fly.
  if (process.env.E2E_TEST_AUTH === "1" && !process.env.FLY_APP_NAME) {
    cfg.E2E_TEST_AUTH = "1";
  }
  if (Object.keys(cfg).length === 0) return "";
  return JSON.stringify(cfg).replace(/</g, "\\u003c");
}

function buildEnvScriptTag(nonce: string): string {
  const payload = buildRuntimeEnvPayload();
  if (!payload) return "";
  const nonceAttr = nonce ? ` nonce="${nonce}"` : "";
  return `<script${nonceAttr}>window.__ENV__=${payload}</script>`;
}

/**
 * Finalize an SPA shell HTML string for sending: inject the runtime env
 * script (window.__ENV__) before </head> and stamp the per-request CSP
 * nonce onto tags marked data-csp-nonce. Shared by the static catch-all
 * below and any route that serves the shell with custom head metadata
 * (e.g. the /p/:state/:county/:apn public parcel report pages in
 * server/routes-public-parcel-report.ts) — keeps env/nonce handling in
 * one place so a CSP change can't silently break one path.
 */
export function finalizeShellHtml(html: string, nonce: string): string {
  const envScript = buildEnvScriptTag(nonce);
  if (envScript) {
    html = html.replace("</head>", `${envScript}\n</head>`);
  }
  if (nonce) {
    html = html.replace(/data-csp-nonce/g, `nonce="${nonce}" data-csp-nonce`);
  }
  return html;
}

/**
 * Resolve the built SPA shell (dist/public/index.html). Returns null when
 * the client build doesn't exist (dev — Vite middleware serves the shell
 * instead, so callers should next() and let the dev pipeline handle it).
 */
export function resolveShellPath(): string | null {
  const indexPath = path.resolve(__dirname, "public", "index.html");
  return fs.existsSync(indexPath) ? indexPath : null;
}

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  // F1 (PERFORMANCE-DIAGNOSTIC.md): pre-compressed asset middleware runs
  // first, serving .br/.gz siblings for browsers that support them.
  // Sidesteps the HTTP/2 + compression middleware bug. Falls through to
  // the normal express.static below when no pre-compressed file exists
  // or the client doesn't advertise br/gzip.
  app.use(preCompressedAssets(distPath));

  // Task #193: Static assets with content-hash filenames (e.g., main.abc123.js)
  // get 1-year max-age with immutable flag. The HTML shell is served with no-cache
  // so browsers always fetch the latest entry point (which references hashed assets).
  app.use(express.static(distPath, {
    index: false, // Don't serve index.html directly — fall through to catch-all for env injection
    // Without `redirect: false`, express.static auto-301s a directory request
    // like /pricing → /pricing/ (trailing slash) whenever dist/public/pricing/
    // exists as a directory. The trailing-slash strip middleware then bounces
    // /pricing/ → /pricing, creating an infinite redirect loop. Disabling the
    // auto-redirect lets these SPA routes (/pricing, /security, /glossary,
    // /changelog) fall through to the catch-all and render the React app.
    redirect: false,
    maxAge: process.env.NODE_ENV === "production" ? "1y" : 0,
    immutable: process.env.NODE_ENV === "production",
    setHeaders: (res, filePath) => {
      // HTML files should never be cached — they reference hashed asset URLs
      if (filePath.endsWith(".html")) {
        res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        res.setHeader("Pragma", "no-cache");
        res.setHeader("Expires", "0");
      }
      // Service worker file must NOT be cached as immutable. Browsers check
      // /sw.js on every page load to detect SW updates; a 1-year immutable
      // cache pins users to whatever SW they first installed and prevents
      // bug fixes from propagating. See PERFORMANCE-DIAGNOSTIC.md §4.
      if (filePath.endsWith("/sw.js") || filePath.endsWith("\\sw.js")) {
        res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        res.setHeader("Pragma", "no-cache");
        res.setHeader("Expires", "0");
      }
    },
  }));

  // fall through to index.html — inject runtime env + CSP nonce into the HTML shell
  // Skip API routes — they should have already sent a response
  const indexPath = path.resolve(distPath, "index.html");

  // Wave: cost — Cloudflare-edge cacheable SPA routes. The asset URLs
  // referenced by the HTML shell are content-hashed so a stale shell
  // can't break a deploy; the only risk is users seeing copy that's up
  // to TTL_SECONDS old, which is fine for marketing-style pages.
  // These need `public` so Cloudflare will actually cache them.
  // Public marketing/legal routes — cacheable at the Cloudflare edge so the
  // HTML shell hits in <30ms instead of round-tripping to Fly IAD (~325ms
  // from the West Coast). All asset URLs in the shell are content-hashed
  // so a stale shell can't reference a deleted bundle. Authed users hitting
  // `/` still client-side-redirect to /today via HomeRoute — caching the
  // shell doesn't change that, the JS boots and the redirect fires.
  // Note: the shell carries a per-request CSP nonce; with caching, every
  // visitor in a TTL window shares a nonce. Acceptable defense-in-depth
  // tradeoff for unauthenticated public pages.
  const EDGE_CACHEABLE_SPA_PATHS: Array<{ rx: RegExp; ttl: number }> = [
    { rx: /^\/$/, ttl: 300 },                 // landing — 5 min
    { rx: /^\/security(\/|$)/, ttl: 600 },    // 10 min
    { rx: /^\/changelog(\/|$)/, ttl: 600 },   // 10 min
    { rx: /^\/terms(\/|$)/, ttl: 3600 },      // legal — 1 hr (rarely changes)
    { rx: /^\/privacy(\/|$)/, ttl: 3600 },    // 1 hr
    { rx: /^\/legal\//, ttl: 3600 },          // 1 hr
    { rx: /^\/field-notes(\/|$)/, ttl: 600 }, // 10 min
  ];

  // Legacy /letters → /field-notes 301s. Rebranded 2026-06-06 per the
  // marketing-OS voice doctrine (`docs/internal/marketing-os/00-blueprint.md`
  // §2). 301 is permanent; search engines transfer SEO equity. This must
  // run before the SPA-shell catch-all so the redirect happens server-side
  // (not via in-app wouter <Redirect>), which is what crawlers see.
  // Path-only check; query strings + fragments are preserved by `res.redirect`.
  const LEGACY_LETTERS_301 = /^\/letters(?:\/([^/?#]+))?\/?$/;

  app.use("{*splat}", (req: Request, res: Response) => {
    if (res.headersSent) return;
    // This handler is mounted via app.use("{*splat}", …), which rewrites
    // req.path to "/" inside the handler — so the real request path must come
    // from req.originalUrl. (The API guard below already uses req.originalUrl;
    // the letters-301, asset guard, per-route prerender lookup, and edge-cache
    // rule below all need the same, or they silently see "/" for every route.)
    const fullPath = (req.originalUrl || req.url || "/").split("?")[0].split("#")[0];
    // Don't serve index.html for API routes — if we got here, the API route didn't match
    if (req.originalUrl.startsWith("/api/")) {
      return sendError(res, 404, "NOT_FOUND", "Not found");
    }
    // 301 legacy /letters[/:slug] → /field-notes[/:slug].
    {
      const m = LEGACY_LETTERS_301.exec(fullPath);
      if (m) {
        const slug = m[1];
        const search = req.originalUrl.includes("?")
          ? req.originalUrl.slice(req.originalUrl.indexOf("?"))
          : "";
        const target = slug ? `/field-notes/${slug}${search}` : `/field-notes${search}`;
        res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=86400");
        return res.redirect(301, target);
      }
    }
    // F-D10: Don't fall through to the SPA shell for asset URLs that didn't
    // hit express.static. Without this, a stale lazy-chunk request (post-
    // deploy, browser still holds old chunk hashes) gets served index.html
    // with content-type text/html, the browser refuses the module load,
    // dynamic import throws, and the whole app crashes to ErrorBoundary.
    // Return 404 instead so the client-side chunk-error handler can detect
    // the deploy and trigger a hard reload to fetch the new bundle.
    if (/^\/assets\/.*\.(js|css|map|wasm)(\.(br|gz))?$/i.test(fullPath)) {
      return res.status(404).type("text/plain").send("asset not found");
    }

    try {
      // Prefer a per-route prerendered shell (written by script/prerender.ts to
      // dist/public/<route>/index.html for PUBLIC_ROUTES flagged prerender:true)
      // so crawlers + link-unfurlers get the route's real <title>/meta/JSON-LD
      // instead of the generic root index.html. Without this the entire prerender
      // step is inert — the build generates per-route heads that were never
      // served (every sub-route fell through to the root shell). The SPA still
      // hydrates over the prerendered shell identically; runtime env + CSP nonce
      // are injected below exactly as for the root shell (same </head> +
      // data-csp-nonce markers, since prerender only swaps the head metadata).
      let shellPath = indexPath;
      {
        const cleanPath = fullPath.replace(/\/+$/, "");
        if (cleanPath && cleanPath !== "/" && !cleanPath.includes("..")) {
          const candidate = path.resolve(distPath, "." + cleanPath, "index.html");
          // Path-traversal guard: candidate must stay within distPath.
          if (candidate.startsWith(distPath + path.sep) && fs.existsSync(candidate)) {
            shellPath = candidate;
          }
        }
      }
      const rawHtml = fs.readFileSync(shellPath, "utf-8");
      const nonce: string = res.locals.cspNonce || "";
      // Inject runtime env vars + CSP nonce (shared with /p report pages).
      const html = finalizeShellHtml(rawHtml, nonce);
      res.setHeader("Content-Type", "text/html; charset=utf-8");

      // Cloudflare-cacheable for marketing-style SPA routes; no-cache
      // for everything else so deploys take effect immediately for
      // authenticated app surfaces.
      const edgeRule = EDGE_CACHEABLE_SPA_PATHS.find((r) => r.rx.test(fullPath));
      if (edgeRule) {
        res.setHeader(
          "Cache-Control",
          `public, max-age=${edgeRule.ttl}, s-maxage=${edgeRule.ttl}, stale-while-revalidate=${edgeRule.ttl * 6}`,
        );
      } else {
        res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        res.setHeader("Pragma", "no-cache");
        res.setHeader("Expires", "0");
      }
      res.send(html);
    } catch {
      res.sendFile(indexPath);
    }
  });
}
