import React from "react";
import type { Preview } from "@storybook/react-vite";
import { TooltipProvider } from "@/components/ui/tooltip";
// Fonts FIRST (matches main.tsx import order) — the @font-face blocks +
// --font-sans/--font-display token values, so previews render in the real
// faces (default pairing: Fraunces display + Inter body). The /fonts/*.woff2
// are served via staticDirs in main.ts.
import "../../client/src/fonts.css";
// The app's token + Tailwind layer (verbatim). @tailwind directives are
// processed by this workspace's postcss/tailwind config; the --acr token
// blocks + shadcn HSL vars come along so previews render in the real theme.
import "../../client/src/index.css";

const preview: Preview = {
  parameters: {
    layout: "centered",
    controls: { matchers: { color: /(background|color)$/i, date: /Date$/i } },
  },
  // Default to the house brand theme in light mode so previews are styled
  // exactly as the app's default surface.
  decorators: [
    (Story) => {
      if (typeof document !== "undefined") {
        document.documentElement.setAttribute("data-theme", "homestead");
      }
      // Wrap every story in TooltipProvider so components that use a Radix
      // tooltip internally (e.g. ConversionFunnel) render without each story
      // having to add the provider.
      return React.createElement(TooltipProvider, null, Story());
    },
  ],
};

export default preview;
