/**
 * AcreOS local ESLint plugin.
 *
 * Loaded by `.eslintrc.json` via `"plugins": ["acreos"]` and the
 * `eslint-plugin-acreos` symlink/alias in the project root, OR loaded
 * inline via `--rulesdir`/local-resolver depending on ESLint version.
 *
 * Each rule file in this directory exports a single ESLint rule. This
 * index aggregates them so ESLint can resolve the plugin by name.
 */

"use strict";

module.exports = {
  rules: {
    "no-founder-codenames-in-customer-jsx": require("./no-founder-codenames-in-customer-jsx.cjs"),
    "no-hardcoded-color-literals": require("./no-hardcoded-color-literals.cjs"),
    "prefer-verbs-canon": require("./prefer-verbs-canon.cjs"),
    "icon-button-needs-aria-label": require("./icon-button-needs-aria-label.cjs"),
  },
};
