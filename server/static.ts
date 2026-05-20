import express, { type Express, type NextFunction, type Request, type Response } from "express";
import fs from "fs";
import path from "path";

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
  if (Object.keys(cfg).length === 0) return "";
  return JSON.stringify(cfg).replace(/</g, "\\u003c");
}

function buildEnvScriptTag(nonce: string): string {
  const payload = buildRuntimeEnvPayload();
  if (!payload) return "";
  const nonceAttr = nonce ? ` nonce="${nonce}"` : "";
  return `<script${nonceAttr}>window.__ENV__=${payload}</script>`;
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
    { rx: /^\/letters(\/|$)/, ttl: 600 },     // 10 min
  ];

  app.use("{*splat}", (req: Request, res: Response) => {
    if (res.headersSent) return;
    // Don't serve index.html for API routes — if we got here, the API route didn't match
    if (req.originalUrl.startsWith("/api/")) {
      return res.status(404).json({ message: "Not found" });
    }

    try {
      let html = fs.readFileSync(indexPath, "utf-8");
      const nonce: string = res.locals.cspNonce || "";
      // Inject runtime env vars (with CSP nonce) before </head>
      const envScript = buildEnvScriptTag(nonce);
      if (envScript) {
        html = html.replace("</head>", `${envScript}\n</head>`);
      }
      // Inject CSP nonce into existing script/style tags
      if (nonce) {
        html = html.replace(/data-csp-nonce/g, `nonce="${nonce}" data-csp-nonce`);
      }
      res.setHeader("Content-Type", "text/html; charset=utf-8");

      // Cloudflare-cacheable for marketing-style SPA routes; no-cache
      // for everything else so deploys take effect immediately for
      // authenticated app surfaces.
      const edgeRule = EDGE_CACHEABLE_SPA_PATHS.find((r) => r.rx.test(req.path));
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
