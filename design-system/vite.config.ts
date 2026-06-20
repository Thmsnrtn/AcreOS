import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import dts from "vite-plugin-dts";

const here = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = resolve(here, "..");

// Library build: bundle the real components (resolving the app's `@/` alias)
// into a single ESM entry + .d.ts. React/react-dom stay external (the
// design-sync host provides them on window). Everything else (Radix, cva,
// clsx, tailwind-merge, lucide) is bundled so window.AcreOSDS is self-contained.
export default defineConfig({
  plugins: [
    react(),
    dts({
      rollupTypes: true,
      tsconfigPath: resolve(here, "tsconfig.json"),
      // Only emit types for the library entry — NOT the .stories.tsx files
      // (their `meta` consts leak external Props names the rollup can't re-name).
      include: ["src/index.ts"],
    }),
  ],
  resolve: {
    alias: {
      "@": resolve(repoRoot, "client", "src"),
      "@shared": resolve(repoRoot, "shared"),
      "@assets": resolve(repoRoot, "attached_assets"),
      "@content": resolve(repoRoot, "content"),
    },
    // Heavy component deps (recharts, embla, react-hook-form, cmdk, vaul,
    // react-day-picker, …) aren't listed here — they resolve from the repo
    // root node_modules via upward resolution. Dedupe React so those deps share
    // the single copy and hooks don't break.
    dedupe: ["react", "react-dom", "react/jsx-runtime"],
  },
  build: {
    lib: {
      entry: resolve(here, "src", "index.ts"),
      formats: ["es"],
      fileName: () => "index.js",
    },
    outDir: resolve(here, "dist"),
    emptyOutDir: true,
    rollupOptions: {
      external: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime"],
    },
  },
});
