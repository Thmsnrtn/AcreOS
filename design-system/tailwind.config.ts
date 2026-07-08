import type { Config } from "tailwindcss";
import appConfig from "../tailwind.config";

// Reuse the app's full theme (the --acr token mapping, animations, variants),
// overriding only `content` so Tailwind scans the components + stories in this
// workspace's resolution context. The tokens themselves come from
// client/src/index.css, imported by .storybook/preview.ts.
export default {
  ...appConfig,
  content: [
    "../client/src/components/ui/**/*.{ts,tsx}",
    "../client/src/lib/**/*.{ts,tsx}",
    "./src/**/*.{ts,tsx}",
    "./.storybook/**/*.{ts,tsx}",
  ],
} satisfies Config;
