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
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
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
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'wouter', '@tanstack/react-query'],
          'vendor-ui': [
            '@radix-ui/react-dialog',
            '@radix-ui/react-dropdown-menu',
            '@radix-ui/react-tabs',
            '@radix-ui/react-select',
            '@radix-ui/react-popover',
            '@radix-ui/react-tooltip',
            '@radix-ui/react-accordion',
            '@radix-ui/react-scroll-area',
            '@radix-ui/react-switch',
            '@radix-ui/react-checkbox',
            '@radix-ui/react-slider',
            '@radix-ui/react-toast',
          ],
          // Isolate heavy deps so they only download when a page that
          // needs them is visited (charts on analytics/dashboards, map
          // on /maps, PDF on document pages, motion on animation-heavy
          // pages, date-fns once across the app, Clerk on auth pages).
          'vendor-charts': ['recharts'],
          'vendor-map': ['mapbox-gl'],
          'vendor-motion': ['framer-motion'],
          'vendor-pdf': ['jspdf'],
          'vendor-sanitize': ['isomorphic-dompurify'],
          'vendor-clerk': ['@clerk/react'],
          'vendor-date': ['date-fns'],
        },
      },
    },
  },
  server: {
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
