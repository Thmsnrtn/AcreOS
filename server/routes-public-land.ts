/**
 * Public land pages (W3 acquisition engine) — what a stranger arriving from
 * search can read and use without an account.
 *
 *   GET /api/public/land/landlocked                 the free landlocked checker
 *                                                   (?state&county&apn or ?lat&lng)
 *   GET /api/public/land/county-guide/:state/:county the county guide as JSON (404: no data)
 *   GET /land/:state/:county                        the county guide page — server-rendered
 *                                                   body + head (prod); a county with no
 *                                                   data is a 404 with noindex
 *   GET /sitemap-land.xml                           sitemap index: guides + parcel pages
 *   GET /sitemap-land-counties.xml                  every county with a guide
 *   GET /sitemap-land-parcels-:page.xml             indexable parcel report pages
 *   GET /llms.txt                                   the agent-legible site map, with the
 *                                                   live list of county guides
 *
 * These serve AcreOS's own pages; they are not a developer API (no keys, no
 * spec — the expansion ladder holds the public API until ~50 customers).
 * Everything is read-only: no route here creates a row or calls upstream.
 */
import type { Express, NextFunction, Request, Response } from "express";
import { createHash } from "crypto";
import fs from "fs";
import path from "path";
import { z } from "zod";
import { createRateLimiter } from "./middleware/rateLimit";
import { getClientIp } from "./utils/clientIp";
import { Errors } from "./utils/errors";
import { finalizeShellHtml, resolveShellPath } from "./static";
import { checkLandlocked } from "./services/landlockedCheck";
import {
  SITEMAP_PARCELS_PER_PAGE,
  countIndexableParcels,
  countyGuidePath,
  getCountyGuide,
  listCountyGuides,
  listIndexableParcels,
} from "./services/publicCountyGuide";
import { countySlugOf, reportPath } from "./services/publicParcelReport";
import { countyGuideJsonLd, esc, renderCountyGuideHtml } from "./services/publicLandPages";
import { injectRootHtml } from "./routes-public-parcel-report";

const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || "https://acreos.io";

// Session id first, then a hash of IP + user agent — never pure IP as the
// primary key (carrier NAT shares one IP across many phones).
function visitorKey(prefix: string) {
  return (req: Request) => {
    const sid = String(req.query.sid ?? "");
    if (sid.length >= 8 && sid.length <= 64) return `${prefix}:sid:${sid}`;
    const ua = String(req.headers["user-agent"] ?? "");
    return `${prefix}:ipua:${createHash("sha256").update(`${getClientIp(req)}|${ua}`).digest("hex").slice(0, 16)}`;
  };
}

/** 20 checks a minute per visitor — plenty for a person, little for a scraper. */
export const landlockedVisitorLimiter = createRateLimiter({ maxRequests: 20, windowMs: 60 * 1000 }, visitorKey("landlocked"));
/** 100 per 10 minutes per IP — backstop against one host rotating session ids. */
export const landlockedIpCeiling = createRateLimiter(
  { maxRequests: 100, windowMs: 10 * 60 * 1000 },
  (req: Request) => `landlocked:ipceil:${getClientIp(req)}`,
);
const guideLimiter = createRateLimiter({ maxRequests: 60, windowMs: 60 * 1000 }, visitorKey("countyguide"));

const landlockedQuery = z.union([
  z.object({
    state: z.string().trim().length(2),
    county: z.string().trim().min(1).max(64),
    apn: z.string().trim().min(1).max(64),
    sid: z.string().optional(),
  }),
  z.object({
    lat: z.coerce.number().min(-90).max(90),
    lng: z.coerce.number().min(-180).max(180),
    sid: z.string().optional(),
  }),
]);

function rewriteHead(html: string, replacement: string): string {
  let out = html;
  out = out.replace(/<title>[^<]*<\/title>/, "<!--__ACREOS_LAND_HEAD__-->");
  out = out.replace(/<meta name="description"[^>]*>\s*/g, "");
  out = out.replace(/<meta property="og:[^"]+"[^>]*>\s*/g, "");
  out = out.replace(/<meta name="twitter:[^"]+"[^>]*>\s*/g, "");
  out = out.replace(/<link rel="canonical"[^>]*>\s*/g, "");
  out = out.replace(/<script type="application\/ld\+json"[^>]*>[\s\S]*?<\/script>\s*/g, "");
  return out.replace(/<!--__ACREOS_LAND_HEAD__-->/, replacement);
}

function xmlEsc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function sendXml(res: Response, body: string) {
  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=3600");
  return res.send(`<?xml version="1.0" encoding="UTF-8"?>\n${body}\n`);
}

/** The static llms.txt the generator commits (served under /.well-known too). */
function staticLlmsTxt(): string {
  for (const p of [
    path.resolve(__dirname, "public", ".well-known", "llms.txt"),
    path.resolve(process.cwd(), "client", "public", ".well-known", "llms.txt"),
    path.resolve(process.cwd(), "dist", "public", ".well-known", "llms.txt"),
  ]) {
    try {
      return fs.readFileSync(p, "utf8"); // one read: no stat-then-read race
    } catch {
      // try the next location
    }
  }
  return "# AcreOS\n";
}

/** The live section appended to llms.txt: only pages that exist. Pure. */
export function llmsLandSection(guides: Array<{ state: string; countySlug: string; countyLabel: string; parcelCount: number }>): string {
  const lines = [
    "",
    "## Land data (public pages)",
    "",
    "- [Is this parcel landlocked? (free checker)](https://acreos.io/tools/landlocked): answers from AcreOS's own road-access fact for parcels it keeps, or says why it cannot.",
    "- Parcel reports live at https://acreos.io/p/{state}/{county}/{parcel-id}. They show only facts that passed AcreOS's accuracy check, each with its source, date and confidence; anything else is marked \"Not available\".",
  ];
  if (guides.length === 0) {
    lines.push("- County guides: none yet. A county gets a guide only once AcreOS has loaded its parcels.");
  } else {
    lines.push("", "### County guides", "");
    for (const g of guides) {
      lines.push(`- [${g.countyLabel} County, ${g.state}](${PUBLIC_BASE_URL}${countyGuidePath(g.state, g.countySlug)}): ${g.parcelCount.toLocaleString("en-US")} parcels kept`);
    }
  }
  return lines.join("\n") + "\n";
}

export function registerPublicLandRoutes(app: Express): void {
  app.get("/api/public/land/landlocked", landlockedIpCeiling, landlockedVisitorLimiter, async (req: Request, res: Response) => {
    const parsed = landlockedQuery.safeParse(req.query);
    if (!parsed.success) {
      return Errors.badRequest(res, "Give a two-letter state, a county and the county parcel number — or a latitude and longitude.");
    }
    try {
      const { sid: _sid, ...input } = parsed.data;
      const answer = await checkLandlocked(input as Parameters<typeof checkLandlocked>[0]);
      res.setHeader("Cache-Control", "no-store");
      return res.json(answer);
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  app.get("/api/public/land/county-guide/:state/:county", guideLimiter, async (req: Request, res: Response) => {
    try {
      const guide = await getCountyGuide(req.params.state, req.params.county);
      if (!guide) return Errors.notFound(res, "County guide");
      return res.json({ guide });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  app.get("/land/:state/:county", guideLimiter, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const shellPath = resolveShellPath();
      if (!shellPath) return next(); // dev — Vite serves the SPA shell
      const guide = await getCountyGuide(req.params.state, req.params.county);
      const raw = fs.readFileSync(shellPath, "utf-8");
      const nonce: string = res.locals.cspNonce || "";
      if (!guide) {
        // No data, no page: a real 404 that tells crawlers not to index.
        const html = finalizeShellHtml(raw.replace("</head>", `<meta name="robots" content="noindex" />\n</head>`), nonce);
        res.status(404).setHeader("Content-Type", "text/html; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        return res.send(html);
      }
      const url = `${PUBLIC_BASE_URL}${countyGuidePath(guide.state, guide.countySlug)}`;
      const title = `${guide.countyLabel} County, ${guide.state} land: ${guide.parcelCount.toLocaleString("en-US")} parcels, road access, tax sales | AcreOS`;
      const description = `${guide.countyLabel} County, ${guide.state}: ${guide.parcelCount.toLocaleString("en-US")} parcels kept by AcreOS${
        guide.roadAccess ? `, ${guide.roadAccess.publicRoadPct}% touching a public road` : ""
      }, tax-sale source links and data coverage. Sourced numbers only.`;
      const head = [
        `<title>${esc(title)}</title>`,
        `<meta name="description" content="${esc(description)}" />`,
        `<link rel="canonical" href="${esc(url)}" />`,
        `<meta property="og:type" content="website" />`,
        `<meta property="og:title" content="${esc(title)}" />`,
        `<meta property="og:description" content="${esc(description)}" />`,
        `<meta property="og:url" content="${esc(url)}" />`,
        `<meta name="twitter:card" content="summary" />`,
        `<script type="application/ld+json" data-csp-nonce>${JSON.stringify(countyGuideJsonLd(guide, url)).replace(/</g, "\\u003c")}</script>`,
      ].join("\n    ");
      const html = finalizeShellHtml(injectRootHtml(rewriteHead(raw, head), renderCountyGuideHtml(guide)), nonce);
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "public, max-age=300, s-maxage=3600, stale-while-revalidate=3600");
      return res.send(html);
    } catch (err) {
      return next(err);
    }
  });

  app.get("/sitemap-land.xml", async (_req: Request, res: Response) => {
    try {
      const n = await countIndexableParcels();
      const pages = Math.ceil(n / SITEMAP_PARCELS_PER_PAGE);
      const maps = [`${PUBLIC_BASE_URL}/sitemap-land-counties.xml`];
      for (let i = 1; i <= pages; i++) maps.push(`${PUBLIC_BASE_URL}/sitemap-land-parcels-${i}.xml`);
      return sendXml(
        res,
        `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${maps.map((m) => `  <sitemap><loc>${xmlEsc(m)}</loc></sitemap>`).join("\n")}\n</sitemapindex>`,
      );
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  app.get("/sitemap-land-counties.xml", async (_req: Request, res: Response) => {
    try {
      const guides = await listCountyGuides();
      const urls = guides.map((g) => {
        const lastmod = g.lastRetrieved ? `<lastmod>${new Date(g.lastRetrieved).toISOString().slice(0, 10)}</lastmod>` : "";
        return `  <url><loc>${xmlEsc(`${PUBLIC_BASE_URL}${countyGuidePath(g.state, g.countySlug)}`)}</loc>${lastmod}</url>`;
      });
      return sendXml(res, `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>`);
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  app.get("/sitemap-land-parcels-:page.xml", async (req: Request, res: Response) => {
    const page = Number(req.params.page);
    if (!Number.isInteger(page) || page < 1 || page > 10_000) return Errors.notFound(res, "Sitemap page");
    try {
      const rows = await listIndexableParcels(page);
      if (rows.length === 0) return Errors.notFound(res, "Sitemap page");
      const urls = rows.map((r) => {
        const loc = `${PUBLIC_BASE_URL}${reportPath({ state: r.state, countySlug: countySlugOf(r.county), apn: r.apn })}`;
        const lastmod = r.fetchedAt ? `<lastmod>${new Date(r.fetchedAt).toISOString().slice(0, 10)}</lastmod>` : "";
        return `  <url><loc>${xmlEsc(loc)}</loc>${lastmod}</url>`;
      });
      return sendXml(res, `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>`);
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  app.get("/llms.txt", async (_req: Request, res: Response) => {
    let guides: Awaited<ReturnType<typeof listCountyGuides>> = [];
    try {
      guides = await listCountyGuides();
    } catch {
      // The static part still serves; the live section then lists none.
    }
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=3600");
    return res.send(staticLlmsTxt().replace(/\s*$/, "\n") + llmsLandSection(guides));
  });
}
