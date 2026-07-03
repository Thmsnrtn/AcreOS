/**
 * Per-route server-rendered <head> for public SPA pages.
 *
 * Registered inside registerRoutes — BEFORE serveStatic — so these handlers
 * win the URL for exactly the public content surfaces where the static shell's
 * one-size-fits-all head was costing free distribution:
 *
 *   /field-notes           — the autopilot's content archive
 *   /field-notes/:slug     — per-note title/description/OG + Article JSON-LD
 *                            carrying the FULL article text for crawlers
 *   /compare/:slug         — high-intent "X alternative" landers
 *   /learn/*               — statute-grade guide library
 *
 * Everything else (including "/", whose committed head is already correct)
 * still flows to the untouched shell. Fail-open by design: any error sends
 * the plain shell — a head-injection bug can never take a page down.
 */
import fs from "node:fs";
import path from "node:path";
import type { Express, Request, Response, NextFunction } from "express";
import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "./db";
import { communityLetters } from "@shared/schema/etl";
import { logger } from "./utils/logger";
import {
  injectHead,
  headForFieldNote,
  headForFieldNotesArchive,
  headForCompare,
  headForLearnPath,
  type HeadSpec,
} from "./services/seo/serverHead";

const SHELL_CACHE_TTL_MS = 60_000;
let shellCache: { at: number; html: string } | null = null;

function resolveShellPath(): string | null {
  const candidates = [
    path.resolve(__dirname, "public", "index.html"),
    path.resolve(process.cwd(), "dist", "public", "index.html"),
    path.resolve(process.cwd(), "client", "index.html"),
  ];
  for (const p of candidates) {
    try {
      if (fs.statSync(p).isFile()) return p;
    } catch { /* next */ }
  }
  return null;
}

function loadShell(): string | null {
  if (shellCache && Date.now() - shellCache.at < SHELL_CACHE_TTL_MS) return shellCache.html;
  const p = resolveShellPath();
  if (!p) return null;
  try {
    const html = fs.readFileSync(p, "utf8");
    shellCache = { at: Date.now(), html };
    return html;
  } catch {
    return null;
  }
}

function baseUrl(): string {
  return (process.env.PUBLIC_BASE_URL || "https://acreos.io").replace(/\/+$/, "");
}

function sendWithHead(res: Response, next: NextFunction, spec: HeadSpec): void {
  const shell = loadShell();
  if (!shell) return next(); // no shell resolvable (odd dev state) → SPA fallback
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=300");
  res.send(injectHead(shell, spec, baseUrl()));
}

export function registerSeoHeadRoutes(app: Express): void {
  app.get("/field-notes", (_req: Request, res: Response, next: NextFunction) => {
    try {
      sendWithHead(res, next, headForFieldNotesArchive());
    } catch (err) {
      logger.warn("[seoHead] archive head failed — plain shell", err instanceof Error ? err : undefined);
      next();
    }
  });

  app.get("/field-notes/:slug", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const [note] = await db
        .select({
          slug: communityLetters.slug,
          subject: communityLetters.subject,
          plainBody: communityLetters.plainBody,
          htmlBody: communityLetters.htmlBody,
          publishedAt: communityLetters.publishedAt,
        })
        .from(communityLetters)
        .where(and(eq(communityLetters.slug, req.params.slug), isNotNull(communityLetters.publishedAt)))
        .limit(1);
      if (!note) return next(); // unknown slug → SPA renders its own not-found
      sendWithHead(res, next, headForFieldNote(note));
    } catch (err) {
      logger.warn("[seoHead] field-note head failed — plain shell", err instanceof Error ? err : undefined);
      next();
    }
  });

  app.get("/compare/:slug", (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!/^acreos-vs-[a-z0-9-]+$/.test(req.params.slug)) return next();
      sendWithHead(res, next, headForCompare(req.params.slug));
    } catch (err) {
      logger.warn("[seoHead] compare head failed — plain shell", err instanceof Error ? err : undefined);
      next();
    }
  });

  app.get(["/learn", "/learn/*learnPath"], (req: Request, res: Response, next: NextFunction) => {
    try {
      // Sanitize: only word/dash/slash paths get a synthesized head.
      if (!/^\/learn(\/[a-z0-9-]+)*$/.test(req.path)) return next();
      sendWithHead(res, next, headForLearnPath(req.path));
    } catch (err) {
      logger.warn("[seoHead] learn head failed — plain shell", err instanceof Error ? err : undefined);
      next();
    }
  });

  logger.info("[seoHead] per-route public heads registered (field-notes, compare, learn)");
}
