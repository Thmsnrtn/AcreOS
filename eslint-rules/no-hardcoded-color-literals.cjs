/**
 * no-hardcoded-color-literals
 *
 * AcreOS theming: the app supports 5 themes × 2 modes via `acr-*`
 * semantic tokens (acr-pos, acr-neg, acr-warn, acr-brand, acr-accent,
 * plus shadcn neutrals: foreground / muted-foreground / muted / border).
 * Hardcoded Tailwind palette classes like `bg-red-500`, `text-emerald-700`,
 * or `border-amber-300` defeat theme switching: they render the same
 * regardless of the active theme.
 *
 * This rule scans Literal / JSXText / TemplateElement values for
 * Tailwind color literals matching:
 *   <prefix>-<color>-<shade>
 * where:
 *   prefix ∈ {bg, text, border, ring, fill, stroke, from, to, via}
 *   color  ∈ {red, green, emerald, amber, yellow, blue, sky, indigo,
 *             violet, purple, pink, rose, orange, teal, cyan,
 *             gray, slate, zinc, neutral, stone}
 *   shade  ∈ 50..950
 *
 * Severity is `warn` rather than `error` — false positives are
 * possible on legacy data fixtures (e.g. test mocks describing real
 * external palettes) and on intentional landing-page brand
 * illustrations. Add an inline disable for those:
 *
 *   // eslint-disable-next-line acreos/no-hardcoded-color-literals
 *   const HERO_GRADIENT = "from-orange-500 to-rose-500";
 *
 * Allowed contexts (rule auto-skips):
 *   - **\/components/ui/**            (shadcn primitives — token plumbing)
 *   - **\/pages/landing/**            (marketing illustrations)
 *   - **\/lib/glossary.ts             (term definitions, not UI)
 *   - **\/*.test.tsx                  (test fixtures may quote raw classes)
 *
 * Ports companion to `no-founder-codenames-in-customer-jsx.cjs`.
 */

"use strict";

const COLORS = [
  "red", "green", "emerald", "amber", "yellow", "blue", "sky",
  "indigo", "violet", "purple", "pink", "rose", "orange", "teal",
  "cyan", "gray", "slate", "zinc", "neutral", "stone",
];

const PREFIXES = [
  "bg", "text", "border", "ring", "fill", "stroke", "from", "to", "via",
];

// Whole-token match: anchored at word boundaries so `not-a-real-class`
// and substrings inside identifiers don't match.
const COLOR_RE = new RegExp(
  `\\b(${PREFIXES.join("|")})-(${COLORS.join("|")})-([0-9]{2,3})\\b`,
);

const SKIP_PATTERNS = [
  /\/components\/ui\//,
  /\/pages\/landing\//,
  /\/lib\/glossary\.ts$/,
  /\.test\.tsx?$/,
  /\.test\.ts$/,
];

function shouldSkip(filename) {
  if (!filename) return true;
  const norm = filename.replace(/\\/g, "/");
  return SKIP_PATTERNS.some((re) => re.test(norm));
}

/** Returns the first hardcoded color match, or null. */
function firstMatch(value) {
  if (typeof value !== "string" || value.length === 0) return null;
  const m = COLOR_RE.exec(value);
  return m ? m[0] : null;
}

module.exports = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Disallow hardcoded Tailwind palette colors (bg-red-500, text-emerald-700, ...). Use the acr-* semantic tokens (acr-pos / acr-neg / acr-warn / acr-brand / acr-accent) or the shadcn neutrals (foreground / muted-foreground / muted / border).",
      recommended: true,
    },
    schema: [],
    messages: {
      hardcoded:
        "Hardcoded Tailwind color '{{literal}}' breaks theme switching. Replace with an acr-* semantic token (e.g. text-acr-pos / bg-acr-neg-soft / border-acr-warn) or a shadcn neutral (text-muted-foreground / bg-muted / border-border).",
    },
  },

  create(context) {
    const filename = context.getFilename
      ? context.getFilename()
      : context.filename;

    if (shouldSkip(filename)) {
      return {};
    }

    return {
      Literal(node) {
        const literal = firstMatch(node.value);
        if (literal) {
          context.report({ node, messageId: "hardcoded", data: { literal } });
        }
      },
      JSXText(node) {
        const literal = firstMatch(node.value);
        if (literal) {
          context.report({ node, messageId: "hardcoded", data: { literal } });
        }
      },
      TemplateElement(node) {
        const cooked = node.value && node.value.cooked;
        const literal = firstMatch(cooked);
        if (literal) {
          context.report({ node, messageId: "hardcoded", data: { literal } });
        }
      },
    };
  },
};
