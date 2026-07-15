/**
 * Tier 3A (elevation blueprint) — public parcel report routes.
 *
 * Two surfaces:
 *
 *   1. JSON API (mounted at /api/public/parcel-report) — what the SPA calls.
 *      This is the ONLY path that can generate a report row. Generation is
 *      rate-limited (session-first key, IP+UA hash fallback — never pure IP,
 *      carrier-grade NAT shares one IP across many phones) and capped daily
 *      via the service's hard cap + alert-spine tripwire.
 *
 *   2. Page routes registered directly on the app (inside registerRoutes, so
 *      they win over the SPA-shell catch-all in static.ts):
 *        GET /p/:state/:county/:apn          — SPA shell with REAL head meta
 *                                              (title/og/twitter/canonical/JSON-LD)
 *                                              for crawlers + link unfurlers
 *        GET /p/:state/:county/:apn/og.png   — per-report OG card (SVG → PNG)
 *        GET /sitemap-reports.xml            — only reports that actually
 *                                              exist; no fabricated coverage
 *      All three are READ-ONLY (getExistingReport) — crawler URL fuzzing can
 *      never create rows or trigger upstream lookups.
 *
 * Free-data guarantee lives in services/publicParcelReport.ts: every upstream
 * call is pinned to maxTier:"free", so the provider registry structurally
 * filters out paid providers (regrid/batchdata/attom). Zero credit deduction.
 */
import { Router, type Express, type Request, type Response, type NextFunction } from "express";
import { createHash } from "crypto";
import fs from "fs";
import sharp from "sharp";
import { createRateLimiter } from "./middleware/rateLimit";
import { getClientIp } from "./utils/clientIp";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";
import { finalizeShellHtml, resolveShellPath } from "./static";
import { publicParcelReportEventsTotal } from "./metrics";
import {
  buildOgSvg,
  getExistingReport,
  getOrCreateReport,
  listReportsForSitemap,
  normalizeReportKey,
  recordReportView,
  reportPath,
} from "./services/publicParcelReport";
import { DISCLAIMER_INFORMATIONAL_SCORE } from "./services/legalDisclaimers";
import type { PublicParcelReport } from "@shared/schema";

const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || "https://acreos.io";

// ── Rate limiting ────────────────────────────────────────────────────────────
// Primary key: the client's anonymous session id (same acreos_anon_id the
// marketing-touch substrate uses). Fallback: sha256(IP|User-Agent) — NEVER
// pure IP as the primary key, because carrier-grade NAT shares one egress IP
// across many phones (memory/feedback_rate_limit_ip_keying.md). A coarser
// pure-IP ceiling exists only as a secondary backstop against session-id
// rotation from a single host.

function reportRequestKey(req: Request): string {
  const sid = (req.query.sid as string | undefined) ?? "";
  if (sid.length >= 8 && sid.length <= 64) return `preport:sid:${sid}`;
  const ua = String(req.headers["user-agent"] ?? "");
  const hash = createHash("sha256")
    .update(`${getClientIp(req)}|${ua}`)
    .digest("hex")
    .slice(0, 16);
  return `preport:ipua:${hash}`;
}

// 30/min/session — generous for a human reading a few reports (the SPA makes
// exactly one call per report view; cache hits are one DB read).
const sessionLimiter = createRateLimiter(
  { maxRequests: 30, windowMs: 60 * 1000 },
  reportRequestKey,
);

// 150 / 10 min per IP — catches a single host rotating session ids without
// punishing a shared-NAT cell (the session key already isolates real users).
const ipCeiling = createRateLimiter(
  { maxRequests: 150, windowMs: 10 * 60 * 1000 },
  (req: Request) => `preport:ipceil:${getClientIp(req)}`,
);

// ── JSON API ─────────────────────────────────────────────────────────────────

const router = Router();

/**
 * GET /api/public/parcel-report/:state/:county/:apn[?sid=...]
 *
 * Returns the saved report, generating it on first request (free/government
 * data only). Honest degradation: when no free source covers the parcel we
 * say so in a 200 — that absence is real information, not an error.
 */
router.get(
  "/:state/:county/:apn",
  ipCeiling,
  sessionLimiter,
  async (req: Request, res: Response) => {
    const key = normalizeReportKey(
      req.params.state,
      req.params.county,
      req.params.apn,
    );
    if (!key) {
      return Errors.badRequest(
        res,
        "That link doesn't look like a parcel reference. Check the two-letter state code, the county name, and the parcel number (APN), then try again.",
      );
    }

    try {
      const result = await getOrCreateReport(key);

      if (!result.ok) {
        if (result.reason === "daily_capacity") {
          return Errors.limitExceeded(res, {
            reason: "daily_capacity",
            message:
              "New public reports are at today's capacity. Reports that already exist still load — try this parcel again tomorrow, or sign up to run lookups inside AcreOS.",
          });
        }
        // no_free_source — honest 200: the county's free data doesn't cover
        // this parcel (or the county GIS endpoint isn't integrated yet).
        return res.json({
          found: false,
          reason: "no_free_source",
          message:
            "No free government data source covers this parcel yet. County coverage grows as more county GIS endpoints come online. Inside AcreOS, paid data providers can usually fill the gap.",
        });
      }

      // Server-side truth for consumption: fire-and-forget view bump.
      void recordReportView(result.report.id);

      return res.json({
        found: true,
        generated: result.generated,
        path: reportPath({
          state: result.report.state,
          countySlug: result.report.countySlug,
          apn: result.report.apn,
        }),
        report: result.report,
        // L1 liability shield — response-level legend covers reports
        // generated before the lcs payload started carrying its own.
        disclaimer: DISCLAIMER_INFORMATIONAL_SCORE,
      });
    } catch (err) {
      return Errors.internal(res, err);
    }
  },
);

export default router;

// ── HTML / OG / sitemap page routes ──────────────────────────────────────────

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Build the per-report head block (mirrors script/prerender.ts renderHead). */
function buildReportHead(report: PublicParcelReport): string {
  const path = reportPath({
    state: report.state,
    countySlug: report.countySlug,
    apn: report.apn,
  });
  const url = `${PUBLIC_BASE_URL}${path}`;
  const lcs = report.lcs;
  const title =
    lcs.partialScore != null && lcs.partialGrade
      ? `${report.countyLabel} County, ${report.state} — parcel ${report.apn} — partial Land Credit Score ${lcs.partialScore} (${lcs.partialGrade}) | AcreOS`
      : `${report.countyLabel} County, ${report.state} — parcel ${report.apn} — public parcel report | AcreOS`;
  const description = `Public parcel report for APN ${report.apn} in ${report.countyLabel} County, ${report.state}: county records, FEMA flood zone, USDA soil, and wetlands data. Partial Land Credit Score from government-data dimensions only — the full score runs inside AcreOS.`;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: title,
    description,
    url,
  };
  const lines = [
    `<title>${escapeAttr(title)}</title>`,
    `<meta name="description" content="${escapeAttr(description)}" />`,
    `<link rel="canonical" href="${escapeAttr(url)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:title" content="${escapeAttr(title)}" />`,
    `<meta property="og:description" content="${escapeAttr(description)}" />`,
    `<meta property="og:url" content="${escapeAttr(url)}" />`,
    `<meta property="og:image" content="${escapeAttr(`${url}/og.png`)}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${escapeAttr(title)}" />`,
    `<meta name="twitter:description" content="${escapeAttr(description)}" />`,
    `<meta name="twitter:image" content="${escapeAttr(`${url}/og.png`)}" />`,
    // data-csp-nonce so finalizeShellHtml stamps the per-request nonce on it.
    `<script type="application/ld+json" data-csp-nonce>${JSON.stringify(jsonLd)}</script>`,
  ];
  return lines.join("\n    ");
}

/**
 * Swap the shell's generic head metadata for the report's (same targeted
 * regex approach as script/prerender.ts — the input is our own index.html,
 * stable and small).
 */
function rewriteHead(html: string, replacement: string): string {
  let out = html;
  out = out.replace(/<title>[^<]*<\/title>/, "<!--__ACREOS_REPORT_HEAD__-->");
  out = out.replace(/<meta name="description"[^>]*>\s*/g, "");
  out = out.replace(/<meta property="og:[^"]+"[^>]*>\s*/g, "");
  out = out.replace(/<meta name="twitter:[^"]+"[^>]*>\s*/g, "");
  out = out.replace(/<link rel="canonical"[^>]*>\s*/g, "");
  out = out.replace(
    /<script type="application\/ld\+json"[^>]*>[\s\S]*?<\/script>\s*/g,
    "",
  );
  out = out.replace(/<!--__ACREOS_REPORT_HEAD__-->/, replacement);
  return out;
}

/**
 * Register the /p page routes + sitemap directly on the app. Called from
 * registerRoutes() so these win over the SPA-shell catch-all (static.ts in
 * prod, Vite middleware in dev). In dev (no dist build) the HTML route
 * next()s and Vite serves the plain SPA shell — meta injection is a
 * prod/crawler concern.
 */
export function registerPublicParcelReportPages(app: Express): void {
  // OG image first (4 segments — no overlap with the 3-segment HTML route,
  // but explicit ordering keeps intent obvious).
  app.get(
    "/p/:state/:county/:apn/og.png",
    async (req: Request, res: Response) => {
      try {
        const key = normalizeReportKey(
          req.params.state,
          req.params.county,
          req.params.apn,
        );
        const report = key ? await getExistingReport(key) : null;
        if (!report) {
          // Crawler/img-tag consumer — only the status code matters; the
          // unified JSON error body keeps the ratchet contract intact.
          return Errors.notFound(res, "Report");
        }
        const png = await sharp(Buffer.from(buildOgSvg(report))).png().toBuffer();
        publicParcelReportEventsTotal.inc({ event: "og_image" });
        res.setHeader("Content-Type", "image/png");
        res.setHeader("Cache-Control", "public, max-age=86400, s-maxage=86400");
        return res.send(png);
      } catch (err) {
        // Errors.internal auto-logs — no separate logger.error needed.
        return Errors.internal(res, err);
      }
    },
  );

  app.get(
    "/p/:state/:county/:apn",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const shellPath = resolveShellPath();
        if (!shellPath) return next(); // dev — Vite serves the SPA shell

        const key = normalizeReportKey(
          req.params.state,
          req.params.county,
          req.params.apn,
        );
        // READ-ONLY: never generates. The SPA's API call does the generating;
        // a crawler fuzzing /p/... URLs gets noindex shells and zero DB rows.
        const report = key ? await getExistingReport(key) : null;

        const raw = fs.readFileSync(shellPath, "utf-8");
        const nonce: string = res.locals.cspNonce || "";
        let html: string;
        if (report) {
          html = rewriteHead(raw, buildReportHead(report));
          // Edge-cacheable: content changes only on refresh (30-day TTL).
          res.setHeader(
            "Cache-Control",
            "public, max-age=300, s-maxage=900, stale-while-revalidate=3600",
          );
        } else {
          // No saved report — serve the shell (the SPA will try to generate
          // via the API) but tell crawlers not to index a page that may 404.
          html = raw.replace(
            "</head>",
            `<meta name="robots" content="noindex" />\n</head>`,
          );
          res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        }
        html = finalizeShellHtml(html, nonce);
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        return res.send(html);
      } catch (err) {
        return next(err);
      }
    },
  );

  // Sitemap of reports that ACTUALLY exist — never fabricated coverage.
  // Referenced from robots.txt alongside the build-time static sitemap.
  app.get("/sitemap-reports.xml", async (_req: Request, res: Response) => {
    try {
      const rows = await listReportsForSitemap();
      const urls = rows
        .map((r) => {
          const loc = escapeXml(`${PUBLIC_BASE_URL}${reportPath(r)}`);
          const lastmod = r.refreshedAt
            ? `<lastmod>${new Date(r.refreshedAt).toISOString().slice(0, 10)}</lastmod>`
            : "";
          return `  <url><loc>${loc}</loc>${lastmod}</url>`;
        })
        .join("\n");
      res.setHeader("Content-Type", "application/xml; charset=utf-8");
      res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=3600");
      return res.send(
        `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
      );
    } catch (err) {
      // Errors.internal auto-logs — no separate logger.error needed.
      return Errors.internal(res, err);
    }
  });
}
