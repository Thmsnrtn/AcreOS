/**
 * no-founder-codenames-in-customer-jsx
 *
 * AcreOS persona architecture: customers see only "Pax" (the unified
 * assistant). Founder-mode surfaces use a private roster of codenames
 * (Atlas/Sophie/Forge/Beacon/Sentinel/Ledger/Shield/Oracle/Compass/
 * Crucible). The two MUST NOT mix in customer-facing UI — leaking a
 * founder codename into a customer surface breaks the persona contract
 * and reveals the internal org-as-OS metaphor that customers shouldn't
 * see.
 *
 * This rule scans string literals and JSX text for whole-word matches
 * against the founder roster, in files that are NOT founder/sovereign
 * surfaces and NOT the persona registries themselves.
 *
 * Allowed contexts (rule auto-skips):
 *  - **\/pages/founder*\/**
 *  - **\/pages/sovereign*\/**
 *  - **\/components/founder*\/**
 *  - **\/components/dashboard/**     (founder-dashboard widgets)
 *  - **\/lib/agent-identity.ts
 *  - **\/lib/trust-language.ts
 *  - **\/lib/personaVocabulary.ts
 *  - **\/pages/landing/**            (marketing copy: agents are part
 *                                     of the brand pitch)
 *  - **\/pages/atlas.tsx             (legacy /atlas route page)
 *  - **\/pages/why.tsx               (founder origin story)
 *
 * If you need to reference a codename inside a founder-gated branch
 * elsewhere (e.g. `{isFounder && <span>Forge</span>}`) add an inline
 * `// eslint-disable-next-line acreos/no-founder-codenames-in-customer-jsx`
 * with a short rationale.
 *
 * NOTE: "Shield" and "Compass" are also lucide-react icon component
 * names. The rule only matches Literal/JSXText/TemplateElement *values*,
 * so JSX usage like `<Shield />` (an Identifier) is not flagged. A
 * string like `"Shield"` would be flagged — if you mean the icon, use
 * the import directly.
 */

"use strict";

const CODENAMES = [
  "Atlas",
  "Sophie",
  "Forge",
  "Beacon",
  "Sentinel",
  "Ledger",
  "Shield",
  "Oracle",
  "Compass",
  "Crucible",
];

// Whole-word match — won't match "Atlas's" → false; will match "Atlas"
// inside "Ask Atlas (open AI chat)". Hyphens, apostrophes, and most
// punctuation count as word boundaries in JS regex \b.
const CODENAME_RE = new RegExp(`\\b(${CODENAMES.join("|")})\\b`);

// Path-based skip patterns. Tested against the resolved filename with
// forward slashes so the rule works on both POSIX and Windows.
const SKIP_PATTERNS = [
  /\/pages\/founder[^/]*\//,
  /\/pages\/founder[^/]*\.tsx?$/,
  /\/pages\/sovereign[^/]*\//,
  /\/pages\/sovereign[^/]*\.tsx?$/,
  /\/components\/founder[^/]*\//,
  /\/components\/dashboard\//,
  /\/lib\/agent-identity\.ts$/,
  /\/lib\/trust-language\.ts$/,
  /\/lib\/personaVocabulary\.ts$/,
  /\/pages\/landing\//,
  /\/pages\/atlas\.tsx?$/,
  /\/pages\/why\.tsx?$/,
];

function shouldSkip(filename) {
  if (!filename) return true;
  const normalized = filename.replace(/\\/g, "/");
  return SKIP_PATTERNS.some((re) => re.test(normalized));
}

/**
 * Find the first codename match. Returns `null` if none.
 */
function firstMatch(value) {
  if (typeof value !== "string" || value.length === 0) return null;
  const m = CODENAME_RE.exec(value);
  return m ? m[1] : null;
}

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow founder codenames (Atlas, Sophie, Forge, ...) in customer-facing JSX/strings.",
      recommended: true,
    },
    schema: [],
    messages: {
      leak:
        "Founder codename '{{name}}' must not appear in customer-facing UI. Use 'Pax' or a generic label.",
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
        const name = firstMatch(node.value);
        if (name) {
          context.report({ node, messageId: "leak", data: { name } });
        }
      },
      JSXText(node) {
        const name = firstMatch(node.value);
        if (name) {
          context.report({ node, messageId: "leak", data: { name } });
        }
      },
      TemplateElement(node) {
        const cooked = node.value && node.value.cooked;
        const name = firstMatch(cooked);
        if (name) {
          context.report({ node, messageId: "leak", data: { name } });
        }
      },
    };
  },
};
