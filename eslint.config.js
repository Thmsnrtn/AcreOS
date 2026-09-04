import reactHooks from "eslint-plugin-react-hooks";
/**
 * ESLint flat config — ESLint 9.
 *
 * The legacy `.eslintrc.json` is kept for documentation, but ESLint 9
 * requires a flat config to run. This file is the active config.
 *
 * Today's role is narrow: enforce the AcreOS persona-architecture rule
 * `acreos/no-founder-codenames-in-customer-jsx`. The existing legacy
 * ruleset (eslint-plugin-react, jsx-a11y, ...) is not yet ported here —
 * `npm run lint` was already non-functional under ESLint 9 before this
 * change. Future work: port the legacy ruleset into flat config.
 */

import tseslint from "@typescript-eslint/parser";
import { createRequire } from "node:module";

// Local plugin authored as CommonJS so the rule files stay portable to
// other tooling (Jest unit tests, `eslint --rulesdir`, etc.). Bridge
// into ESM via createRequire.
const require = createRequire(import.meta.url);
const acreos = require("./eslint-rules/index.cjs");

export default [
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "build/**",
      "**/*.config.js",
      "**/*.config.ts",
      "tailwind.config.ts",
      "postcss.config.js",
      "eslint-rules/**",
      "playwright-report/**",
      "test-results/**",
      ".playwright-mcp/**",
      "acreos/**",
      "acreos-landing/**",
      "acreos-onboarding/**",
      "acreos-picker/**",
      "src-tauri/**",
      "scripts/**",
      "tests/**",
      "server/**",
      // Pre-existing JSX parse error — a comment was placed at a
      // position where the JSX grammar doesn't accept it. Out of scope
      // for the persona-leak codemod; un-ignore once that lands.
      "client/src/components/page-shell.tsx",
    ],
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    // Don't surface unused-disable directives — the legacy `.eslintrc`
    // config left no-console disable comments throughout the codebase
    // that no longer have a matching rule under flat config.
    linterOptions: {
      reportUnusedDisableDirectives: false,
    },
    languageOptions: {
      parser: tseslint,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      acreos,
      // The REAL plugin, since 2026-09-04. It was a no-op stub — the rule
      // names were declared with `create: () => ({})` so that legacy
      // `eslint-disable-next-line react-hooks/...` comments would not error.
      // The cost was that neither rule enforced anything for as long as it
      // stood, and rules-of-hooks is not a style rule: it had TWELVE real
      // violations waiting, including ten in layout-sidebar.tsx where an
      // early return sat above ten hooks on the app shell itself.
      "react-hooks": reactHooks,
    },
    rules: {
      "acreos/no-founder-codenames-in-customer-jsx": "error",
      // Phase 4 Week 15-16 (Calla §7): wired as `warn` because legacy
      // fixtures (test mocks, edge-case branded illustrations) may quote
      // palette classes intentionally. Promote to `error` once the
      // codemod settles and fixtures are clean.
      "acreos/no-hardcoded-color-literals": "warn",
      // Soft nudge — surfaces inline button labels that have a Verbs.*
      // entry in `client/src/lib/labels.ts`. Set to "warn" so it's a
      // review hint, not a blocker.
      "acreos/prefer-verbs-canon": "warn",
      // Phase 4 Week 23-26: WCAG 2.2 SC 4.1.2 — every icon-only button
      // must expose an accessible name. Bulk-applied 25+ aria-labels
      // during the full a11y pass; this rule prevents regressions.
      "acreos/icon-button-needs-aria-label": "error",
      // 2026-05 cache-invalidation infra: flag `useMutation` callsites
      // that forget to invalidate the query cache in their success
      // callbacks. Heuristic-based (mutations that legitimately don't
      // need invalidation can opt out with `// allow-no-invalidation:
      // <reason>`), so wired as `warn` rather than `error`. Pairs with
      // `client/src/lib/query-keys.ts` which provides `invalidateRelated`.
      "acreos/use-mutation-must-invalidate": "warn",
      // A conditional hook is a crash, not a nit: React throws "Rendered
      // fewer hooks than expected" when the branch flips between renders.
      // Wired as an ERROR because there is nothing to burn down — the
      // twelve violations were fixed in the commit that turned this on.
      "react-hooks/rules-of-hooks": "error",
      // react-hooks/exhaustive-deps is NOT enabled. Turning it on reports 34
      // violations today, and the ratchet requires any rule that produces
      // output to be baselined — which would mean recording 34 warnings as
      // accepted debt, and the gate reserves that to a sign-off. It is a
      // genuine judgement call rule (a deliberately-omitted dep is often
      // correct), so it is left off pending a decision rather than
      // baselined quietly. rules-of-hooks, which is not a judgement call,
      // is an ERROR above.
    },
  },
];
