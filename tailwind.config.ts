import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./client/index.html", "./client/src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      borderRadius: {
        sm:    ".1875rem", /* 3px */
        md:    ".5rem",    /* 8px */
        lg:    "1rem",     /* 16px */
        xl:    "1.25rem",  /* 20px */
        "2xl": "1.5rem",   /* 24px */
        full:  "9999px",   /* capsule */
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
        // Literal hex/rgba — alpha modifiers (e.g. `bg-acr-brand/50`) are not
        // alpha-aware; use `*-soft` variants for tinted variants.
        acr: {
          bg:           "var(--acr-bg)",
          "bg-sunken":  "var(--acr-bg-sunken)",
          "bg-raised":  "var(--acr-bg-raised)",
          surface:      "var(--acr-surface)",
          "surface-2":  "var(--acr-surface-2)",
          "sidebar-bg": "var(--acr-sidebar-bg)",
          "sidebar-ink": "var(--acr-sidebar-ink)",
          ink:    "var(--acr-ink)",
          "ink-2": "var(--acr-ink-2)",
          "ink-3": "var(--acr-ink-3)",
          "ink-4": "var(--acr-ink-4)",
          line:        "var(--acr-line)",
          "line-soft": "var(--acr-line-soft)",
          brand:        "var(--acr-brand)",
          "brand-ink":  "var(--acr-brand-ink)",
          "brand-soft": "var(--acr-brand-soft)",
          accent: "var(--acr-accent)",
          pos:        "var(--acr-pos)",
          "pos-soft": "var(--acr-pos-soft)",
          warn:       "var(--acr-warn)",
          "warn-soft": "var(--acr-warn-soft)",
          neg:       "var(--acr-neg)",
          "neg-soft": "var(--acr-neg-soft)",
          glow: "var(--acr-glow)",
          "chart-a": "var(--acr-chart-a)",
          "chart-b": "var(--acr-chart-b)",
          "chart-c": "var(--acr-chart-c)",
          "chart-d": "var(--acr-chart-d)",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)"],
        serif: ["var(--font-serif)"],
        mono: ["var(--font-mono)"],
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
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "collapsible-down": "collapsible-down 0.25s ease-out",
        "collapsible-up": "collapsible-up 0.2s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate"), require("@tailwindcss/typography")],
} satisfies Config;
