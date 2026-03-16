import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["**/*.test.ts"],
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
        lines: 30,
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
