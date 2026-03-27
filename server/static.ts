import express, { type Express, type Request, type Response } from "express";
import fs from "fs";
import path from "path";

/** Public config injected into index.html as window.__ENV__ so the SPA
 *  can read runtime env vars that weren't available at Vite build time. */
function buildRuntimeEnvScript(): string {
  const cfg: Record<string, string> = {};
  if (process.env.VITE_CLERK_PUBLISHABLE_KEY) cfg.VITE_CLERK_PUBLISHABLE_KEY = process.env.VITE_CLERK_PUBLISHABLE_KEY;
  if (process.env.VITE_MAPBOX_TOKEN) cfg.VITE_MAPBOX_ACCESS_TOKEN = process.env.VITE_MAPBOX_TOKEN;
  if (process.env.VITE_MAPBOX_ACCESS_TOKEN) cfg.VITE_MAPBOX_ACCESS_TOKEN = process.env.VITE_MAPBOX_ACCESS_TOKEN;
  if (process.env.VITE_SENTRY_DSN) cfg.VITE_SENTRY_DSN = process.env.VITE_SENTRY_DSN;
  if (Object.keys(cfg).length === 0) return "";
  const json = JSON.stringify(cfg).replace(/</g, "\\u003c");
  return `<script>window.__ENV__=${json}</script>`;
}

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  const envScript = buildRuntimeEnvScript();

  // Task #193: Static assets with content-hash filenames (e.g., main.abc123.js)
  // get 1-year max-age with immutable flag. The HTML shell is served with no-cache
  // so browsers always fetch the latest entry point (which references hashed assets).
  app.use(express.static(distPath, {
    maxAge: process.env.NODE_ENV === "production" ? "1y" : 0,
    immutable: process.env.NODE_ENV === "production",
    setHeaders: (res, filePath) => {
      // HTML files should never be cached — they reference hashed asset URLs
      if (filePath.endsWith(".html")) {
        res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        res.setHeader("Pragma", "no-cache");
        res.setHeader("Expires", "0");
      }
    },
  }));

  // fall through to index.html — inject runtime env + CSP nonce into the HTML shell
  // Skip API routes — they should have already sent a response
  const indexPath = path.resolve(distPath, "index.html");
  app.use("{*splat}", (req: Request, res: Response) => {
    if (res.headersSent) return;
    // Don't serve index.html for API routes — if we got here, the API route didn't match
    if (req.originalUrl.startsWith("/api/")) {
      return res.status(404).json({ message: "Not found" });
    }

    try {
      let html = fs.readFileSync(indexPath, "utf-8");
      // Inject runtime env vars before </head>
      if (envScript) {
        html = html.replace("</head>", `${envScript}\n</head>`);
      }
      // Inject CSP nonce
      const nonce: string = res.locals.cspNonce || "";
      if (nonce) {
        html = html.replace(/data-csp-nonce/g, `nonce="${nonce}" data-csp-nonce`);
      }
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(html);
    } catch {
      res.sendFile(indexPath);
    }
  });
}
