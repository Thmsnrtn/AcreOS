import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/simulation/**/*.spec.ts"],
    exclude: ["node_modules", "dist", "client"],
    // Refuses to start without a reachable server and an authenticated
    // session per persona — see the file's header for why.
    globalSetup: ["./tests/simulation/global-setup.ts"],
    testTimeout: 60000,
    pool: "forks",
  },
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "./shared"),
      "@": path.resolve(__dirname, "./client/src"),
    },
  },
});
