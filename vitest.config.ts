import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    // .test.ts runs under node by default; .test.tsx files opt into
    // jsdom via the `// @vitest-environment jsdom` pragma at file head
    // (Phase D — dock.test.tsx is the first such test).
    // L1.5 (2026-06-03) — added `.test.mjs` so the filesystem-lock
    // primitive's test file (scripts/check-interactive-claims.test.mjs) is
    // discovered. That file is intentionally `.mjs` because the primitive
    // is a pure-Node ESM module with no project imports.
    include: ["**/*.test.ts", "**/*.test.tsx", "**/*.test.mjs"],
    // `**/node_modules` catches nested deps (e.g. tests/e2e-intelligent/node_modules/zod)
    // that the bare `node_modules` token misses; we were running Zod's vendored
    // test suite by accident until this was tightened.
    exclude: ["**/node_modules/**", "dist", "client", ".claude", "**/.claude/**"],
    setupFiles: ["./tests/setup.ts"],
    testTimeout: 15000,
    // Some hooks dynamically import large modules (routes-founder-chat
    // pulls in 40+ tool modules; webhookHandlers pulls in stripe). The
    // default 10s hook timeout is too tight on cold caches.
    hookTimeout: 30000,
    pool: "forks",
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["server/**/*.ts", "shared/**/*.ts"],
      exclude: ["**/*.test.ts", "node_modules", "dist"],
      thresholds: {
        lines: 50,
      },
    },
  },
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "./shared"),
      "@": path.resolve(__dirname, "./client/src"),
    },
  },
  // tsconfig sets jsx: "preserve" so vite/SWC can handle JSX in the
  // app build. Vitest's transformer needs an explicit jsx mode — we
  // pick "automatic" so client component tests (statementsPanel.test.tsx,
  // dock.test.tsx) don't need `import React from "react"` shims.
  esbuild: {
    jsx: "automatic",
  },
});
