import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    // .test.ts runs under node by default; .test.tsx files opt into
    // jsdom via the `// @vitest-environment jsdom` pragma at file head
    // (Phase D — dock.test.tsx is the first such test).
    include: ["**/*.test.ts", "**/*.test.tsx"],
    exclude: ["node_modules", "dist", "client", ".claude"],
    setupFiles: ["./tests/setup.ts"],
    testTimeout: 15000,
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
});
