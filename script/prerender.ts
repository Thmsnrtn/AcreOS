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
      "Find motivated sellers, analyze parcels, send direct mail, and close land deals — with agents that act on your behalf.",
    ogType: "website",
  },
  "/pricing": {
    title: "Pricing · AcreOS",
    description:
      "Transparent plans for Land Investors — from the free tier to full-team tooling. CRM, direct mail, automated due diligence, and seller financing in one platform.",
    ogType: "product",
  },
  "/security": {
    title: "Security · AcreOS",
    description:
      "How AcreOS protects Land Investors' data — encryption at rest and in transit, MFA, sub-processors, vulnerability disclosure, and SOC 2 posture.",
    ogType: "website",
  },
  "/changelog": {
    title: "Changelog · AcreOS",
    description:
      "Recent updates, new features, and improvements to AcreOS — written for Land Investors using the platform.",
    ogType: "article",
  },
  "/glossary": {
    title: "Land Investor glossary · AcreOS",
    description:
      "Plain-English definitions of the vocabulary every land investor needs — yellow letter, skip trace, AVM, executory contract, and more.",
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
      console.warn(`[prerender] no meta entry for ${route.path}, skipping`);
      continue;
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
