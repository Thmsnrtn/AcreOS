import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { execSync } from "child_process";
import { visualizer } from "rollup-plugin-visualizer";
import viteCompression from "vite-plugin-compression";

// Phase 8 Mo 12 — Beatriz §3 bundle-analyzer.
// Enabled when ANALYZE=1 (CI / one-off `npm run build:analyze`).
// In normal builds the plugin is excluded so the prod bundle is unaffected.
const ANALYZE = process.env.ANALYZE === "1" || process.env.ANALYZE === "true";

// Resolve the git SHA at config time so the value is baked into the
// client bundle as `import.meta.env.VITE_GIT_SHA`. CI overrides this
// via the env var so deploys reflect the actual commit even when the
// build runs in a shallow clone where `git rev-parse` would fail.
function resolveGitSha(): string {
  if (process.env.VITE_GIT_SHA) return process.env.VITE_GIT_SHA;
  try {
    return execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "unknown";
  }
}

const GIT_SHA = resolveGitSha();
process.env.VITE_GIT_SHA = GIT_SHA;

export default defineConfig({
  define: {
    // Belt-and-suspenders: ensure `import.meta.env.VITE_GIT_SHA` is
    // available even when Vite's loadEnv hasn't picked up the var.
    "import.meta.env.VITE_GIT_SHA": JSON.stringify(GIT_SHA),
  },
  plugins: [
    react(),
    // Pre-compress build output (gzip + brotli) so static-serve can deliver
    // already-compressed bytes. Sidesteps the HTTP/2 + `compression`
    // middleware bug where compression negotiation fails under H2 (verified
    // 2026-05-04: `content-encoding` missing on /assets/*.js under H2 but
    // works under H1.1). See PERFORMANCE-DIAGNOSTIC.md §3.
    //
    // Threshold: 1024 bytes — same as the runtime middleware. ext: includes
    // js/mjs/css/html/json/svg. The `disable: false` is the default; kept
    // explicit so anyone reading sees the toggle.
    viteCompression({
      algorithm: "gzip",
      ext: ".gz",
      threshold: 1024,
      deleteOriginFile: false,
      disable: false,
    }),
    viteCompression({
      algorithm: "brotliCompress",
      ext: ".br",
      threshold: 1024,
      deleteOriginFile: false,
      disable: false,
    }),
    // Bundle analyzer — only active in --analyze mode. Emits
    // `dist/bundle-stats.html` (treemap) so we can identify the
    // largest chunks. Run `ANALYZE=1 npm run build` then open the file.
    ...(ANALYZE
      ? [
          visualizer({
            filename: path.resolve(import.meta.dirname, "dist/bundle-stats.html"),
            gzipSize: true,
            brotliSize: true,
            template: "treemap",
            open: false,
          }),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@acreos/solene": path.resolve(import.meta.dirname, "packages", "solene", "src", "index.ts"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
      "@content": path.resolve(import.meta.dirname, "content"),
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    // Task #196: Performance budget — warn if any chunk exceeds 500 KB
    chunkSizeWarningLimit: 500,
    // Task #196: Emit source maps in production for Sentry error symbolication
    sourcemap: process.env.NODE_ENV === "production" ? "hidden" : false,
    rollupOptions: {
      output: {
        // Why this is a function instead of an object map:
        // The previous object form leaked weight onto first paint. Vite's
        // internal __vitePreload helper + tiny utilities like clsx /
        // tailwind-merge land in *some* chunk; with the object form they
        // landed inside vendor-pdf and vendor-charts respectively. Since
        // every page uses the preload helper and clsx (via cn()), those
        // "vendor" chunks got modulepreload'd on every page — dragging
        // 100KB of jspdf and 100KB of recharts into the landing page.
        //
        // The function form gives us per-module control: shared mini-utils
        // get their own tiny chunk, heavy single-use libs (jspdf) stay
        // unchunked so they ride with their lazy consumer, and the major
        // shared deps (react, radix, motion, etc.) keep their manual
        // groupings. Verified via vite-plugin-visualizer post-change.
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined;

          // Tiny shared utils — give them their own chunk so they don't
          // ride along with heavy libs and force-preload them.
          if (/\/(clsx|tailwind-merge|class-variance-authority)\//.test(id)) {
            return 'vendor-utils';
          }

          // Core runtime — eagerly needed everywhere.
          if (/\/(react|react-dom|scheduler|wouter|@tanstack\/react-query)\//.test(id)) {
            return 'vendor-react';
          }

          if (/\/@radix-ui\//.test(id)) return 'vendor-ui';
          if (/\/@clerk\//.test(id)) return 'vendor-clerk';
          if (/\/framer-motion\//.test(id)) return 'vendor-motion';
          if (/\/date-fns\//.test(id)) return 'vendor-date';

          // Heavy libs used across many pages — keep grouped so 30+ pages
          // share one cached chunk instead of each carrying their own copy.
          if (/\/recharts\//.test(id)) return 'vendor-charts';
          if (/\/(mapbox-gl|maplibre-gl)\//.test(id)) return 'vendor-map';

          // Heavy libs with a single consumer — DO NOT name them. Returning
          // undefined lets Vite co-locate the lib with its sole importer's
          // lazy chunk, so the lib only downloads when that route renders.
          // Apply to: jspdf (borrower-portal only), @turf/turf (subdivision-
          // plan-editor only), isomorphic-dompurify, @dnd-kit (deals only).

          return undefined;
        },
      },
    },
  },
  server: {
    fs: {
      strict: true,
      deny: ["**/.*"],
      // Allow Vite to read content/ which lives at the repo root, a
      // sibling of the Vite root (client/). Used by the programmatic
      // SEO loader at client/src/pages/learn/registry.ts.
      allow: [
        path.resolve(import.meta.dirname),
        path.resolve(import.meta.dirname, "content"),
      ],
    },
  },
});
