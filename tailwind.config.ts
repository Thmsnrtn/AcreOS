import type { Config } from "tailwindcss";

/**
 * Alpha-capable acr-* token. The --acr-* CSS vars hold raw hex, so
 * Tailwind's native `<alpha-value>` injection can't apply — and before
 * this wrapper, `bg-acr-pos/10` silently compiled to NOTHING (the class
 * was dropped), stranding ~650 authored washes/tints across the app.
 * A literal opacity modifier now mixes the token with transparency via
 * CSS color-mix (Baseline 2023); no modifier — or a var()-based legacy
 * opacity-plugin value — returns the raw var unchanged.
 */
const acrToken =
  (cssVar: string) =>
  ({ opacityValue }: { opacityValue?: string } = {}): string => {
    if (!opacityValue || opacityValue.includes("var(")) return `var(${cssVar})`;
    return `color-mix(in srgb, var(${cssVar}) calc(${opacityValue} * 100%), transparent)`;
  };

export default {
  darkMode: ["class"],
  content: ["./client/index.html", "./client/src/**/*.{js,jsx,ts,tsx}"],
  // Scope every `hover:` Tailwind class behind `@media (hover: hover)`
  // so they only apply when the device actually supports hovering. On
  // iOS Safari (no hover), the first tap no longer activates a hover
  // state — taps register as clicks immediately. Without this flag every
  // `hover:bg-muted`, `hover:opacity-100`, etc requires a double-tap on
  // touch devices (the Apple-documented "first tap reveals hover state,
  // second tap commits the click" behavior).
  future: {
    hoverOnlyWhenSupported: true,
  },
  theme: {
    extend: {
      borderRadius: {
        sm:    ".1875rem", /* 3px */
        md:    ".5rem",    /* 8px */
        lg:    "1rem",     /* 16px */
        xl:    "1.25rem",  /* 20px */
        "2xl": "1.5rem",   /* 24px */
        full:  "9999px",   /* capsule */
        // Prototype's .acr-card radius — locked at 14px per design-system §0.2.
        // Sits between Tailwind `md` (8) and `lg` (16). Use `rounded-card`
        // explicitly on cardish surfaces; do not approximate with `lg`.
        card:  ".875rem",  /* 14px */
      },
      boxShadow: {
        "level-1": "var(--shadow-1)",
        "level-2": "var(--shadow-2)",
        "level-3": "var(--shadow-3)",
        "level-4": "var(--shadow-4)",
        // Prototype-derived shadows (acreos/theme.jsx homestead).
        "acr-1": "var(--acr-shadow-1)",
        "acr-2": "var(--acr-shadow-2)",
        "acr-3": "var(--acr-shadow-3)",
        "acr-ring": "var(--acr-ring)",
      },
      transitionDuration: {
        "acr-fast": "120ms",
        "acr-normal": "240ms",
        "acr-slow": "320ms",
      },
      transitionTimingFunction: {
        "acr-spring": "cubic-bezier(.22, 1, .36, 1)",
        "acr-standard": "cubic-bezier(0.25, 0.46, 0.45, 0.94)",
      },
      // ── Z-index / layering scale ──────────────────────────────────────
      // Single SEMANTIC stacking scale for the whole app. Before this,
      // z-index was entirely ad-hoc (52 × `z-50`, 44 × `z-10`, plus
      // arbitrary escalations `z-[60]`/`z-[100]`/`z-[9998]`/`z-[9999]`)
      // and the same numbers were reused for unrelated roles, which caused
      // stacking bugs (FAB-over-FAB; founder tab list over the settings
      // gear). Future code must say `z-modal`, not `z-50`.
      //
      // The numeric values are derived from the EXISTING anchors so the
      // migration is a behavior-identical RENAME, never a re-layer: every
      // distinct legacy layer keeps its own token at its own value, and
      // the documented stacking order (low → high) is preserved exactly.
      //
      // Mirrored as CSS custom properties (--z-*) in index.css for the
      // handful of non-Tailwind / inline-style consumers, and as the
      // runtime `Z` registry in client/src/lib/z-index.ts.
      zIndex: {
        base: "0",          // in-flow default content
        raised: "1",        // card hover-lift; thin in-flow raise
        docked: "10",       // sticky subheaders, table headers, raised cards
        dropdown: "20",     // in-page dropdowns / popper menus
        sticky: "30",       // page topbar
        overlay: "40",      // autopilot status bar, top notifications, cookie banner
        "slot-help": "48",  // floating help slot (just under the FAB stack)
        "slot-tray": "49",  // floating conversation tray slot
        floating: "50",     // FAB, bottom nav, base dialogs/sheets, PWA prompt
        modal: "60",        // modal scrim, command palette, new-item menu, escalated dialogs/sheets
        toast: "100",       // toasts / transient banners above modals
        offline: "110",     // offline indicator above toasts
        tour: "9990",       // product tour scrim
        island: "9998",     // dynamic island, tour/demo highlight rings
        spotlight: "9999",  // demo orb / highlight focus above the island
        max: "10000",       // absolute top — demo control panel
      },
      colors: {
        // Flat / base colors (regular buttons)
        background: "hsl(var(--background) / <alpha-value>)",
        foreground: "hsl(var(--foreground) / <alpha-value>)",
        border: "hsl(var(--border) / <alpha-value>)",
        input: "hsl(var(--input) / <alpha-value>)",
        card: {
          DEFAULT: "hsl(var(--card) / <alpha-value>)",
          foreground: "hsl(var(--card-foreground) / <alpha-value>)",
          border: "hsl(var(--card-border) / <alpha-value>)",
        },
        popover: {
          DEFAULT: "hsl(var(--popover) / <alpha-value>)",
          foreground: "hsl(var(--popover-foreground) / <alpha-value>)",
          border: "hsl(var(--popover-border) / <alpha-value>)",
        },
        primary: {
          DEFAULT: "hsl(var(--primary) / <alpha-value>)",
          foreground: "hsl(var(--primary-foreground) / <alpha-value>)",
          border: "var(--primary-border)",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary) / <alpha-value>)",
          foreground: "hsl(var(--secondary-foreground) / <alpha-value>)",
          border: "var(--secondary-border)",
        },
        muted: {
          DEFAULT: "hsl(var(--muted) / <alpha-value>)",
          foreground: "hsl(var(--muted-foreground) / <alpha-value>)",
          border: "var(--muted-border)",
        },
        accent: {
          DEFAULT: "hsl(var(--accent) / <alpha-value>)",
          foreground: "hsl(var(--accent-foreground) / <alpha-value>)",
          border: "var(--accent-border)",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive) / <alpha-value>)",
          foreground: "hsl(var(--destructive-foreground) / <alpha-value>)",
          border: "var(--destructive-border)",
        },
        ring: "hsl(var(--ring) / <alpha-value>)",
        chart: {
          "1": "hsl(var(--chart-1) / <alpha-value>)",
          "2": "hsl(var(--chart-2) / <alpha-value>)",
          "3": "hsl(var(--chart-3) / <alpha-value>)",
          "4": "hsl(var(--chart-4) / <alpha-value>)",
          "5": "hsl(var(--chart-5) / <alpha-value>)",
        },
        sidebar: {
          ring: "hsl(var(--sidebar-ring) / <alpha-value>)",
          DEFAULT: "hsl(var(--sidebar) / <alpha-value>)",
          foreground: "hsl(var(--sidebar-foreground) / <alpha-value>)",
          border: "hsl(var(--sidebar-border) / <alpha-value>)",
        },
        "sidebar-primary": {
          DEFAULT: "hsl(var(--sidebar-primary) / <alpha-value>)",
          foreground: "hsl(var(--sidebar-primary-foreground) / <alpha-value>)",
          border: "var(--sidebar-primary-border)",
        },
        "sidebar-accent": {
          DEFAULT: "hsl(var(--sidebar-accent) / <alpha-value>)",
          foreground: "hsl(var(--sidebar-accent-foreground) / <alpha-value>)",
          border: "var(--sidebar-accent-border)"
        },
        status: {
          online: "rgb(34 197 94)",
          away: "rgb(245 158 11)",
          busy: "rgb(239 68 68)",
          offline: "rgb(156 163 175)",
        },
        // Prototype-derived semantic tokens (acreos/theme.jsx homestead).
        // Raw hex/rgba vars wrapped by acrToken so literal alpha modifiers
        // (e.g. `bg-acr-brand/50`) resolve via color-mix; `*-soft` variants
        // remain the semantic choice for standard tinted surfaces.
        acr: {
          bg:           acrToken("--acr-bg"),
          "bg-sunken":  acrToken("--acr-bg-sunken"),
          "bg-raised":  acrToken("--acr-bg-raised"),
          surface:      acrToken("--acr-surface"),
          "surface-2":  acrToken("--acr-surface-2"),
          "sidebar-bg": acrToken("--acr-sidebar-bg"),
          "sidebar-ink": acrToken("--acr-sidebar-ink"),
          ink:    acrToken("--acr-ink"),
          "ink-2": acrToken("--acr-ink-2"),
          "ink-3": acrToken("--acr-ink-3"),
          "ink-4": acrToken("--acr-ink-4"),
          line:        acrToken("--acr-line"),
          "line-soft": acrToken("--acr-line-soft"),
          brand:        acrToken("--acr-brand"),
          "brand-ink":  acrToken("--acr-brand-ink"),
          "brand-soft": acrToken("--acr-brand-soft"),
          accent: acrToken("--acr-accent"),
          pos:        acrToken("--acr-pos"),
          "pos-soft": acrToken("--acr-pos-soft"),
          warn:       acrToken("--acr-warn"),
          "warn-soft": acrToken("--acr-warn-soft"),
          neg:       acrToken("--acr-neg"),
          "neg-soft": acrToken("--acr-neg-soft"),
          glow: acrToken("--acr-glow"),
          // Borrower portal — warm public-surface gradient endpoints.
          // Defined as CSS vars in index.css (light + dark) so the portal's
          // distinct parchment identity is tokenized, not hardcoded hex.
          "portal-from": acrToken("--acr-portal-grad-from"),
          "portal-to":   acrToken("--acr-portal-grad-to"),
          "chart-a": acrToken("--acr-chart-a"),
          "chart-b": acrToken("--acr-chart-b"),
          "chart-c": acrToken("--acr-chart-c"),
          "chart-d": acrToken("--acr-chart-d"),
          // Bridge surface — single amber accent for live / active / now.
          // Defined as a CSS var in index.css so it can theoretically
          // theme without touching component code.
          "bridge-accent": acrToken("--acr-bridge-accent"),
          // Heat tokens — activity/demand intensity (Kai finding #1, 2026-06-01).
          // Distinct from neg/warn/pos which encode outcome sentiment.
          // cold = quiet/low, warm = building/medium, hot = high/active.
          "heat-cold":      acrToken("--acr-heat-cold"),
          "heat-warm":      acrToken("--acr-heat-warm"),
          "heat-hot":       acrToken("--acr-heat-hot"),
          "heat-cold-soft": acrToken("--acr-heat-cold-soft"),
          "heat-warm-soft": acrToken("--acr-heat-warm-soft"),
          "heat-hot-soft":  acrToken("--acr-heat-hot-soft"),
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)"],
        serif: ["var(--font-serif)"],
        mono: ["var(--font-mono)"],
      },
      fontSize: {
        // Caption / micro scale extensions per design-system §1.2.
        // Replace the prior `text-[11px]` / `text-[10px]` ad-hocs so
        // line-height stays coherent across the system.
        caption: ["11px", "14px"],
        micro:   ["10px", "12px"],
        // Typography hierarchy — hero + section utilities (§1.2).
        // These are Tailwind-queryable aliases for .acr-cc-greeting and
        // .acr-section-h2 respectively. The CSS classes remain the
        // canonical definition (index.css TYPOGRAPHY HIERARCHY block);
        // these tokens exist so `<h1 className="text-hero">` compiles
        // and can be used alongside the legacy class names during the
        // incremental migration. Font family + letter-spacing MUST be
        // set separately (the class handles them; utilities below cover
        // size + line-height only per Tailwind fontSize convention).
        hero:          ["32px", { lineHeight: "1.15", fontWeight: "600" }],
        "section-h2":  ["18px", { lineHeight: "1.2",  fontWeight: "500" }],
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "collapsible-down": {
          from: { height: "0", opacity: "0" },
          to: { height: "var(--radix-collapsible-content-height)", opacity: "1" },
        },
        "collapsible-up": {
          from: { height: "var(--radix-collapsible-content-height)", opacity: "1" },
          to: { height: "0", opacity: "0" },
        },
        // Bridge live-indicator breathing. Subtle opacity oscillation,
        // never scale (scale at 6px reads as a flicker).
        "bridge-breathe": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.5" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "collapsible-down": "collapsible-down 0.25s ease-out",
        "collapsible-up": "collapsible-up 0.2s ease-out",
        "bridge-breathe": "bridge-breathe 1.5s ease-in-out infinite",
      },
    },
  },
  plugins: [
    require("tailwindcss-animate"),
    require("@tailwindcss/typography"),
    // pointer-coarse: — touch-target sizing must follow POINTER TYPE, not
    // viewport width. The Button scale's "desktop stays dense" arm keyed
    // density to sm: (>=640px), which silently under-sized every control on
    // touch tablets: a 768px iPad lands on the desktop-density arm with a
    // finger as the pointer (caught by the ipad-mini Krieger touch-target
    // contract, 2026-06-10 — 38px CTAs on the 404 page / cookie banner).
    // `pointer-coarse:min-h-11` lets a control stay dense for mouse users at
    // ANY width while holding the 44px Apple-HIG floor whenever the primary
    // input is a finger. (Tailwind v4 ships this variant natively; this is
    // the v3 equivalent.)
    function pointerVariants({ addVariant }: { addVariant: (name: string, def: string) => void }) {
      addVariant("pointer-coarse", "@media (pointer: coarse)");
      addVariant("pointer-fine", "@media (pointer: fine)");
    },
  ],
} satisfies Config;
