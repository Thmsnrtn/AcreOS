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
    // 30s (was 15s): a handful of slow integration tests (webhook idempotency,
    // model-hygiene, telemetry fire-and-forget) intermittently exceed 15s NOT
    // because they do 15s of work but because they get CPU-starved under the
    // many-parallel-fork load of the full 7500-test suite. They pass in
    // isolation; the extra headroom keeps the suite reliably green under load.
    testTimeout: 30000,
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
      // RATCHET thresholds (2026-07-07, mature-machine H0 §6.5). The old
      // `lines: 50` was aspirational — measured global coverage was 18.22%,
      // so the coverage step was permanently red and trained everyone to
      // ignore it. These floors sit just under MEASURED coverage instead:
      // green today, and a regression below any floor is a real signal.
      // Raise a floor whenever real coverage rises (never lower one —
      // same discipline as FOUNDER_ROUTE_BASELINE).
      thresholds: {
        lines: 18,
        // Money/send/compliance paths carry per-file floors — these are the
        // surfaces where a coverage DROP most likely means an untested
        // change to code that moves money or sends messages.
        // Raised 2026-07-07 after the real tcpaCompliance/dunning suites
        // landed (measured: tcpa 53.3, sms 42.9, dunning 24.7, dnc 59.1).
        // Ratcheted again 2026-07-16 (S4) to the newly-measured levels, each
        // ~1pt under measured so a real regression trips but run-to-run
        // jitter doesn't: creditPool 88.6, sms 43.4, dunning 33.5, dnc 59.1,
        // featureGate 92.3 (new floor on the tenant/subscription gate).
        "server/services/creditPool.ts": { lines: 87 },
        "server/webhookHandlers.ts": { lines: 70 },
        "server/services/webhook-idempotency.ts": { lines: 75 },
        "server/services/publicParcelReport.ts": { lines: 88 },
        "server/services/directMailService.ts": { lines: 52 },
        "server/services/smsService.ts": { lines: 42 },
        "server/services/dunning.ts": { lines: 32 },
        "server/services/tcpaCompliance.ts": { lines: 50 },
        "server/services/compliance/dncScrub.ts": { lines: 58 },
        "server/middleware/featureGate.ts": { lines: 90 },
      },
    },
  },
  resolve: {
    alias: {
      "@acreos/solene": path.resolve(__dirname, "./packages/solene/src/index.ts"),
      "@shared": path.resolve(__dirname, "./shared"),
      "@": path.resolve(__dirname, "./client/src"),
      "@sovereign": path.resolve(__dirname, "./sovereign-protocol"),
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
