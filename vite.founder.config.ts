import { defineConfig } from "vite";
import { buildConfig } from "./vite.config";

// The FOUNDER output (P1-9 / X-2): client/founder.html + src/founder-main.tsx →
// dist/founder, base "/founder-app/", assets under /founder-assets. Everything
// else — aliases, plugins, manualChunks, sourcemap policy — is the customer
// config's, built by the same factory, so the two outputs cannot drift.
// Invoked by script/build.ts right after the customer build.
export default defineConfig(buildConfig("founder"));
