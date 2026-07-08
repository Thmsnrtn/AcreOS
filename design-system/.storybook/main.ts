import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { StorybookConfig } from "@storybook/react-vite";

const here = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = resolve(here, "..", "..");

const config: StorybookConfig = {
  stories: ["../src/**/*.stories.@(ts|tsx)"],
  framework: { name: "@storybook/react-vite", options: {} },
  core: { disableTelemetry: true },
  // Previews don't need TS type-checking or docgen — Vite/esbuild transpiles
  // (no type errors), the converter gets Props from the dist .d.ts and argTypes
  // from the Playwright probe. Disabling react-docgen-typescript also avoids
  // parsing the full client type graph (import.meta.env etc.) + speeds the build.
  typescript: { check: false, reactDocgen: false },
  // Serve ONLY the app's self-hosted fonts at /fonts/* so the @font-face URLs
  // in fonts.css resolve in previews (and the woff2 ship into _sb/). Mapping
  // just the fonts dir (not all of client/public) keeps the bundle lean —
  // the full public dir carries ~40MB of unrelated marketing imagery.
  staticDirs: [{ from: "../../client/public/fonts", to: "/fonts" }],
  async viteFinal(cfg) {
    // Storybook auto-merges the root vite.config.ts, which carries the LIB-only
    // dts plugin (vite-plugin-dts). That plugin has no place in a preview build
    // and chokes on some re-exported const arrows (AlertDialogFooter). Strip it.
    if (Array.isArray(cfg.plugins)) {
      const notDts = (p: any): boolean =>
        !p || typeof p.then === "function" || !(typeof p === "object" && "name" in p && String(p.name).includes("dts"));
      cfg.plugins = cfg.plugins.filter(notDts);
    }
    cfg.resolve = cfg.resolve ?? {};
    cfg.resolve.alias = {
      ...(cfg.resolve.alias as Record<string, string> | undefined),
      "@": resolve(repoRoot, "client", "src"),
      "@shared": resolve(repoRoot, "shared"),
      "@assets": resolve(repoRoot, "attached_assets"),
      "@content": resolve(repoRoot, "content"),
    };
    // Single React across DS-local + root-resolved component deps (recharts,
    // embla, react-hook-form, …) so hooks don't break.
    cfg.resolve.dedupe = [...(cfg.resolve.dedupe ?? []), "react", "react-dom", "react/jsx-runtime"];
    return cfg;
  },
};

export default config;
