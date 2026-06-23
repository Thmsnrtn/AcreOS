/**
 * routes-well-known.ts — serve the agentic-web discovery files under
 * /.well-known/.
 *
 * Why an explicit route rather than relying on express.static: the static
 * middleware in server/static.ts uses Express's default `dotfiles: "ignore"`,
 * so any path segment beginning with a dot — including the whole
 * `/.well-known/` directory — is skipped and falls through to the SPA shell.
 * That is exactly why /.well-known/security.txt already has its own route in
 * server/index.ts. These routes do the same for the agent-discovery files.
 *
 * The file contents are generated and committed by
 * scripts/generate-llms-txt.mjs (derived from the live App Intent registry, so
 * the MCP tool list can't drift). We serve the committed copy from the built
 * client public dir; in dev we fall back to client/public.
 *
 * Files served:
 *   GET /.well-known/llms.txt        (text/plain)   — agent-legible site map
 *   GET /.well-known/ai-plugin.json  (application/json) — MCP plugin manifest
 */
import fs from "fs";
import path from "path";
import type { Express, Request, Response } from "express";
import { logger } from "./utils/logger";

// Built client assets live in server/public (copied from dist/public at build);
// in dev the source is client/public. Try both.
function resolveWellKnownFile(filename: string): string | null {
  const candidates = [
    path.resolve(__dirname, "public", ".well-known", filename),
    path.resolve(process.cwd(), "client", "public", ".well-known", filename),
    path.resolve(process.cwd(), "dist", "public", ".well-known", filename),
  ];
  for (const p of candidates) {
    try {
      if (fs.statSync(p).isFile()) return p;
    } catch {
      // try next
    }
  }
  return null;
}

function serveFile(
  res: Response,
  filename: string,
  contentType: string,
): void {
  const filePath = resolveWellKnownFile(filename);
  if (!filePath) {
    logger.warn("well-known file missing", {
      source: "well-known",
      metadata: { filename },
    });
    res.status(404).type("text/plain").send("Not found\n");
    return;
  }
  res.setHeader("Content-Type", contentType);
  // Cacheable at the edge; these change only when the registry changes + a
  // redeploy ships the regenerated file.
  res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=86400");
  res.send(fs.readFileSync(filePath, "utf8"));
}

/**
 * Register the /.well-known agent-discovery routes. Call from server/index.ts
 * before serveStatic so the SPA catch-all never shadows these paths.
 */
export function registerWellKnownRoutes(app: Express): void {
  app.get("/.well-known/llms.txt", (_req: Request, res: Response) => {
    serveFile(res, "llms.txt", "text/plain; charset=utf-8");
  });

  app.get("/.well-known/ai-plugin.json", (_req: Request, res: Response) => {
    serveFile(res, "ai-plugin.json", "application/json; charset=utf-8");
  });

  // IndexNow key file — proves domain ownership to Bing/Yandex so the autopilot
  // can ping new /field-notes + /p/ pages for near-immediate crawl. Served from
  // the INDEXNOW_KEY secret (safe-by-absence: 404 until the key is set). The key
  // file must contain exactly the key. See services/autopilot/searchEngineSubmit.ts.
  app.get("/indexnow-key.txt", async (_req: Request, res: Response) => {
    const { indexNowKey } = await import("./services/autopilot/searchEngineSubmit");
    const key = indexNowKey();
    if (!key) {
      res.status(404).type("text/plain").send("Not found\n");
      return;
    }
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.send(key);
  });
}
