/**
 * Build-time pre-render for AcreOS marketing routes.
 *
 * This is a pragmatic, dependency-free SSG step: AcreOS is a Vite SPA
 * served from one `dist/public/index.html`. For SEO we need each
 * marketing URL (/pricing, /security, /changelog, /glossary, etc.) to
 * resolve to its own HTML file with the right `<title>`,
 * `<meta name="description">`, Open Graph tags, and inline JSON-LD —
 * crawler bots and link-preview unfurlers don't always run client JS.
 *
 * What this script does, after `vite build`:
 *
 *   1. Read the canonical `dist/public/index.html`.
 *   2. For each PUBLIC_ROUTE flagged `prerender: true`, write a per-path
 *      file (e.g. `dist/public/pricing/index.html`) with the route's
 *      title / description / canonical / og tags / JSON-LD substituted in.
 *   3. The React SPA still mounts when the page loads — the pre-rendered
 *      HTML is purely a head + skeleton stub. When the bundle hydrates it
 *      replaces the body without remounting the head, so the user sees
 *      the live app.
 *
 * Why hand-rolled instead of `vite-plugin-ssg` or Puppeteer:
 *   - We don't have a global store of head metadata to collect from the
 *     React tree (each page calls `usePageMeta` after mount).
 *   - Bringing Chromium into the build pipeline costs ~150 MB and adds
 *     a significant CI cold-start penalty.
 *   - The marketing pages don't have meaningful render-blocking data —
 *     the body is mostly static once React mounts.
 *
 * Trade-offs:
 *   - Crawlers that don't execute JS see the head metadata and a
 *     skeleton — *not* the full page text. For most public marketing
 *     surfaces this is fine because Googlebot does run JS. We document
 *     the limitation in `script/prerender.ts` rather than silently
 *     pretending we have a full SSG pipeline.
 *
 * Usage:
 *   tsx script/prerender.ts
 *
 * Wired into the build pipeline by `script/build.ts`.
 */

import { readFile, writeFile, mkdir } from "fs/promises";
import path from "path";

import {
  PUBLIC_ROUTES,
  SITE_BASE_URL,
  type PublicRoute,
} from "../shared/seo/public-routes.js";

const DIST_DIR = path.resolve("dist/public");
const INDEX_HTML = path.join(DIST_DIR, "index.html");

interface RouteMeta {
  title: string;
  description: string;
  ogType: "website" | "product" | "article";
  /** Optional inline JSON-LD payloads to embed in the head. */
  jsonLd?: Array<{ id: string; data: unknown }>;
}

const META_BY_PATH: Record<string, RouteMeta> = {
  "/": {
    title: "AcreOS — The Operating System for Land Investors",
    description:
      "One platform for every Land Investor — pull lists, run comps, send mail, draft replies, and track every deal through closing. Built for land flippers, note investors, fix-and-flippers, wholesalers, subdividers, tax-delinquent buyers, and buy-and-hold landlords.",
    ogType: "website",
  },
  "/pricing": {
    title: "Pricing · AcreOS",
    description:
      "Transparent plans for every Land Investor — same price regardless of vertical. CRM, direct mail, automated due diligence, note servicing, and rehab tracking in one platform.",
    ogType: "product",
  },
  "/why": {
    title: "Why we built AcreOS · AcreOS",
    description:
      "The case for one operating system built specifically for Land Investors — why the spreadsheets, generic CRMs, and stitched-together tools fall short, and what AcreOS does instead.",
    ogType: "article",
  },
  "/land-credit-score": {
    title: "The Land Credit Score — AcreOS",
    description:
      "The Land Credit Score is a 300–850 read on a parcel as an investment, graded A+ through F across six weighted dimensions. It scores land, not people — it is not a FICO score, a consumer credit report, or a regulated credit product, and it pulls no personal credit.",
    ogType: "website",
    jsonLd: [
      {
        id: "lcs-defined-term",
        data: {
          "@context": "https://schema.org",
          "@type": "DefinedTerm",
          name: "Land Credit Score",
          description:
            "A 300–850 score, graded A+ through F, of how a parcel of land stacks up as an investment, computed from a weighted blend of six dimensions (Location, Financial, Physical, Legal, Environmental, Market). It scores parcels, not people, and is not a consumer credit report.",
          inDefinedTermSet: `${SITE_BASE_URL}/glossary`,
          url: `${SITE_BASE_URL}/land-credit-score`,
        },
      },
      {
        id: "lcs-software-application",
        data: {
          "@context": "https://schema.org",
          "@type": "SoftwareApplication",
          name: "AcreOS Land Credit Score",
          description:
            "Scores any U.S. parcel 300–850 (A+ through F) across six weighted dimensions, from the same government and market data behind every AcreOS parcel check. Scores land, not people — not a consumer credit report.",
          applicationCategory: "BusinessApplication",
          operatingSystem: "Any (web)",
          url: `${SITE_BASE_URL}/land-credit-score`,
          offers: {
            "@type": "Offer",
            price: "0",
            priceCurrency: "USD",
          },
          publisher: {
            "@type": "Organization",
            name: "AcreOS",
            url: SITE_BASE_URL,
          },
        },
      },
    ],
  },
  "/security": {
    title: "Security · AcreOS",
    description:
      "How AcreOS protects operators' data — encryption at rest and in transit, MFA, sub-processors, vulnerability disclosure, and SOC 2 posture.",
    ogType: "website",
  },
  "/changelog": {
    title: "Changelog · AcreOS",
    description:
      "Recent updates, new features, and improvements to AcreOS — written for the operators using the platform.",
    ogType: "article",
  },
  "/glossary": {
    title: "Land investor glossary · AcreOS",
    description:
      "Plain-English definitions of the vocabulary every Land Investor needs — yellow letter, skip trace, AVM, BPO, executory contract, balloon, escrow shortfall, and more.",
    ogType: "website",
  },
  "/learn": {
    title: "Learn — land investing guides by state & county · AcreOS",
    description:
      "Field guides for Land Investors: state and county primers on parcel data, flood and soil signals, buy-box criteria, and the diligence behind every offer.",
    ogType: "website",
  },
};

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

function renderHead(route: PublicRoute, meta: RouteMeta): string {
  const url = `${SITE_BASE_URL}${route.path === "/" ? "" : route.path}`;
  const lines = [
    `<title>${escapeAttr(meta.title)}</title>`,
    `<meta name="description" content="${escapeAttr(meta.description)}" />`,
    `<link rel="canonical" href="${escapeAttr(url)}" />`,
    `<meta property="og:type" content="${meta.ogType}" />`,
    `<meta property="og:title" content="${escapeAttr(meta.title)}" />`,
    `<meta property="og:description" content="${escapeAttr(meta.description)}" />`,
    `<meta property="og:url" content="${escapeAttr(url)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${escapeAttr(meta.title)}" />`,
    `<meta name="twitter:description" content="${escapeAttr(meta.description)}" />`,
  ];
  if (meta.jsonLd) {
    for (const ld of meta.jsonLd) {
      lines.push(
        `<script type="application/ld+json" id="ld-json-${ld.id}">${JSON.stringify(ld.data)}</script>`,
      );
    }
  }
  return lines.join("\n    ");
}

/**
 * Replace the existing head metadata in the canonical index.html with
 * route-specific equivalents. We use targeted regex replacements rather
 * than a full HTML parser because the input is our own `client/index.html`
 * shape — stable and small.
 */
function rewriteHead(html: string, replacement: string): string {
  let out = html;
  // Replace title
  out = out.replace(
    /<title>[^<]*<\/title>/,
    "<!--__ACREOS_PRERENDER_HEAD__-->",
  );
  // Strip the existing description / og / twitter tags so we don't ship
  // duplicates — the new ones are inside `replacement`.
  out = out.replace(/<meta name="description"[^>]*>\s*/g, "");
  out = out.replace(/<meta property="og:[^"]+"[^>]*>\s*/g, "");
  out = out.replace(/<meta name="twitter:[^"]+"[^>]*>\s*/g, "");
  out = out.replace(/<link rel="canonical"[^>]*>\s*/g, "");
  // Replace the previously-injected ld+json so we don't ship the generic
  // landing one on every route.
  out = out.replace(
    /<script type="application\/ld\+json">[\s\S]*?<\/script>\s*/g,
    "",
  );
  out = out.replace(/<!--__ACREOS_PRERENDER_HEAD__-->/, replacement);
  return out;
}

async function main() {
  let template: string;
  try {
    template = await readFile(INDEX_HTML, "utf-8");
  } catch (err) {
    console.error(
      `[prerender] could not read ${INDEX_HTML} — did vite build run first?`,
    );
    throw err;
  }

  let count = 0;
  for (const route of PUBLIC_ROUTES) {
    if (!route.prerender) continue;
    const meta = META_BY_PATH[route.path];
    if (!meta) {
      // FAIL THE BUILD. A route flagged prerender:true is promised in the
      // sitemap; if it has no META_BY_PATH entry it would silently ship the
      // generic landing <head> on its own URL — a silent SEO own-goal. Make
      // that impossible: every prerender:true route MUST have a meta entry.
      throw new Error(
        `[prerender] no META_BY_PATH entry for prerender:true route "${route.path}". ` +
          `Add one in script/prerender.ts (this route is sitemap-promised — it cannot ` +
          `ship the generic landing head).`,
      );
    }
    const head = renderHead(route, meta);
    const html = rewriteHead(template, head);

    if (route.path === "/") {
      // Root: overwrite dist/public/index.html in-place with the
      // landing-tuned head. The SPA still mounts on /.
      await writeFile(INDEX_HTML, html, "utf-8");
    } else {
      // Per-route: dist/public/<path>/index.html
      const targetDir = path.join(DIST_DIR, route.path.replace(/^\//, ""));
      await mkdir(targetDir, { recursive: true });
      await writeFile(path.join(targetDir, "index.html"), html, "utf-8");
    }
    count += 1;
    console.log(`[prerender] wrote ${route.path}`);
  }

  console.log(`[prerender] done — ${count} routes pre-rendered`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
