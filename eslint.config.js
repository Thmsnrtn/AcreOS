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
      // Stub plugin: the codebase has many inline
      // `// eslint-disable-next-line react-hooks/exhaustive-deps`
      // comments left over from the legacy `.eslintrc.json` setup.
      // Until eslint-plugin-react-hooks is ported into flat config,
      // declare the rule names as no-ops so the disable comments stay
      // valid (otherwise ESLint reports "rule not found" errors).
      "react-hooks": {
        rules: {
          "exhaustive-deps": { meta: { schema: [] }, create: () => ({}) },
          "rules-of-hooks": { meta: { schema: [] }, create: () => ({}) },
        },
      },
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
    },
  },
];
