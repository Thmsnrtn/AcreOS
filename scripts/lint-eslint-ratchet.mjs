#!/usr/bin/env node
// ============================================================================
// scripts/lint-eslint-ratchet.mjs — gate the custom ESLint rules via a ratchet.
// ----------------------------------------------------------------------------
// Why
// ───
// The repo ships well-written custom ESLint rules (acreos/* — icon-button aria
// labels, no-hardcoded-color-literals, no-founder-codenames-in-customer-jsx,
// prefer-verbs-canon, use-mutation-must-invalidate) but they DID NOT GATE
// anything: the CI ESLint step is `continue-on-error: true` and deploy.yml
// doesn't run lint at all. Good rules, no teeth — a regression couldn't fail
// the build.
//
// Getting raw `eslint --max-warnings 0` to green means clearing 460+
// pre-existing problems in one go, which is its own large cleanup. Instead we
// ratchet, the AcreOS idiom: baseline the CURRENT per-rule problem count and
// only ever let it go DOWN. New violations of any rule fail the gate; fixing
// violations requires decrementing the baseline in the same commit (so the win
// is locked and can't silently regress). This runs inside `npm run check`, so
// it gates CI AND deploy without touching the (still-informational) raw lint
// step.
//
// Drive-to-zero: pick a rule, fix some violations, lower its count in
// scripts/ratchets/eslint-rules.json in the same commit. The founder-codename
// and icon-button-aria ERRORS are the priority targets (they're errors, not
// warnings, for a reason).
// ============================================================================
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
// NB: kept OUT of scripts/ratchets/ on purpose — that dir is owned by
// ratchet.mjs, which requires a different config shape (a `name` field etc.).
const BASELINE_PATH = resolve(__dirname, "eslint-rules-baseline.json");
const TAG = "[lint-eslint-ratchet]";

function fail(msg) {
  console.error(`${TAG} FAIL — ${msg}`);
  process.exit(1);
}

let raw;
try {
  // eslint exits non-zero when problems exist; capture stdout regardless.
  raw = execSync("npx eslint client/src -f json", {
    cwd: resolve(__dirname, ".."),
    encoding: "utf-8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
  });
} catch (e) {
  raw = e.stdout?.toString() ?? "";
}
if (!raw.trim()) fail("eslint produced no JSON output (did the run crash?)");

let results;
try {
  results = JSON.parse(raw);
} catch {
  fail("could not parse eslint JSON output");
}

// Count problems per rule (errors + warnings together — the ratchet doesn't
// care about severity, only that no rule grows).
const counts = {};
for (const file of results) {
  for (const m of file.messages) {
    const rule = m.ruleId || "(no-rule)";
    counts[rule] = (counts[rule] || 0) + 1;
  }
}

const baselineRaw = JSON.parse(readFileSync(BASELINE_PATH, "utf-8"));
// Drop doc keys (e.g. "_comment") so only real rule entries are compared.
const baseline = Object.fromEntries(
  Object.entries(baselineRaw).filter(([k, v]) => !k.startsWith("_") && typeof v === "number"),
);

const over = [];
const under = [];
const novel = [];
for (const [rule, n] of Object.entries(counts)) {
  const base = baseline[rule];
  if (base === undefined) novel.push([rule, n]);
  else if (n > base) over.push([rule, n, base]);
  else if (n < base) under.push([rule, n, base]);
}

const total = Object.values(counts).reduce((a, b) => a + b, 0);
const baseTotal = Object.values(baseline).reduce((a, b) => a + b, 0);
console.log(`${TAG} ${total} problems across ${Object.keys(counts).length} rule(s); baseline ${baseTotal}`);

if (novel.length) {
  for (const [rule, n] of novel) {
    console.error(`${TAG}   NEW rule above baseline: ${rule} (${n}). Fix the violations or add the rule to the baseline with sign-off.`);
  }
}
if (over.length) {
  for (const [rule, n, base] of over) {
    console.error(`${TAG}   REGRESSION: ${rule} is ${n}, baseline ${base}. You added ${n - base} new violation(s) — fix them.`);
  }
}
if (novel.length || over.length) {
  fail(`${novel.length + over.length} rule(s) over baseline.`);
}

if (under.length) {
  for (const [rule, n, base] of under) {
    console.error(`${TAG}   IMPROVED (tighten baseline): ${rule} is now ${n}, baseline ${base}. Lower it to ${n} in scripts/ratchets/eslint-rules.json in this commit to lock the win.`);
  }
  fail(`${under.length} rule(s) below baseline — tighten the baseline.`);
}

console.log(`${TAG} PASS — no rule above baseline.`);
