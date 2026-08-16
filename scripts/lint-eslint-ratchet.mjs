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
// scripts/eslint-rules-baseline.json in the same commit. The founder-codename
// and icon-button-aria ERRORS are the priority targets (they're errors, not
// warnings, for a reason).
//
// ----------------------------------------------------------------------------
// VACUITY — WHY THIS SCRIPT IS THREE TIMES LONGER THAN THE RATCHET IT RUNS
// ----------------------------------------------------------------------------
// Every count below is a count of BAD THINGS FOUND, so a scan that stops
// finding files finds zero and reports the most reassuring line in the file.
// This gate shipped with exactly that hole and it was measured, not theorised:
//
//   `npx eslint client/src -f json` returns 873 file entries and 0 messages.
//   `counts` is therefore `{}`, and the old code printed
//     "0 problems across 0 rule(s); baseline 0"
//     "PASS — no rule above baseline."
//   without ever reading `results.length`. One more entry in the
//   `eslint.config.js` `ignores` array — which already holds 14 — could have
//   removed most of client/src and the gate would have printed the same two
//   lines. Measured: adding `client/src/components/**` + `client/src/pages/**`
//   to the ignored set takes the population 873 -> 151 and the old gate still
//   said PASS.
//
// This is the repo's named defect class: a gate whose number goes DOWN because
// the SCAN BROKE, reported as good news. check-tests-typecheck once announced
// "161 error(s) were fixed. Lock it in" from a tsc that had been starved of
// memory; ratchet.mjs once announced "1682 occurrence(s) were removed. Lock it
// in — set baselineCount: 0" from a ratchet scanning ZERO files. So:
//
//   FLOOR 1 — files linted (MIN_LINTED_FILES). The population ESLint actually
//     walked. A collapsed `files`/`ignores` set, a mistyped target, a config
//     that stops matching **/*.tsx: all land here.
//   FLOOR 2 — baselined rules (MIN_BASELINE_RULES). If the baseline file is
//     emptied or its doc-key filter starts eating real entries, zero rules get
//     compared and every comparison passes vacuously.
//   CANARY  — the rules must PROVE they still fire. See the next section; this
//     is the only one of the three that can see a rule going quiet.
//   STDERR + EXIT STATUS — an ESLint that fails to start must not read as a
//     clean lint. `stdio: [..., "ignore"]` used to throw the evidence away.
//
// ----------------------------------------------------------------------------
// WHAT A POPULATION FLOOR CANNOT SEE — AND WHY THE CANARY EXISTS
// ----------------------------------------------------------------------------
// BE HONEST ABOUT THE COVERAGE THIS GATE CLAIMS. A file-count floor answers
// "did ESLint read the code?". It does NOT answer "did the rules look at it?".
// ESLint will happily return 873 results and 0 messages if every acreos rule
// became a no-op — a `create()` returning `{}`, a plugin that failed to load,
// a rule dropped from `eslint.config.js`, a severity flipped to "off". Every
// one of those is indistinguishable, in the JSON, from clean code.
//
// That is not hypothetical here. `eslint.config.js` ALREADY CONTAINS a live
// `create: () => ({})` stub (the `react-hooks` shim that keeps legacy disable
// comments valid). The exact shape is in the tree, three lines from where the
// acreos plugin is registered.
//
// Worse, the baseline is currently ALL ZEROS. A rule that goes quiet reports 0;
// a rule that is clean reports 0. Comparing numbers cannot tell those apart AT
// A BASELINE OF ZERO no matter how carefully the comparison is written — which
// is why requirement 3 below (compare vanished rules too) is necessary but not
// sufficient, and why the canary is the load-bearing part.
//
// So the gate proves liveness directly, three ways, cheapest first:
//
//   SELF-TEST A (pure logic, instant) — feeds the fired-rule detector a
//     synthetic EMPTY result set and a synthetic FULL one, and asserts it says
//     "all missing" then "none missing". A detector stuck on pass fails here.
//   SELF-TEST B (in-process ESLint API, ~0.7s) — lints the fixture twice
//     against an in-memory config: once with the REAL rule modules loaded from
//     eslint-rules/index.cjs (all must fire) and once with each rule replaced
//     by `{ create: () => ({}) }` (none may fire). This is the no-op mutation,
//     run on every invocation rather than trusted to a comment.
//   CANARY (real CLI, real eslint.config.js, ~1s) — pipes the same known-bad
//     fixture through `npx eslint --stdin` at a virtual client/src path and
//     requires every expected rule to report. This is the leg that sees the
//     config-level failures: plugin unregistered, severity "off", path newly
//     ignored.
//
// Every rule in the baseline MUST have a canary expectation. A baselined rule
// with no fixture is a rule whose zero means nothing. Adding a rule to the
// baseline therefore means adding two things: a line to CANARY_FIXTURE that
// violates it, and an entry in CANARY_EXPECTATIONS. The gate names both in its
// failure text.
//
// STATED LIMITS — what this gate still cannot see:
//   1. A rule that fires on the fixture but has been narrowed so it no longer
//      fires on real code (e.g. a skip-pattern widened to swallow client/src).
//      The canary proves the rule is ALIVE, not that its scope is intact.
//   2. Suppressed problems. `// eslint-disable-next-line` moves a violation
//      into `suppressedMessages`, which this ratchet does not count (measured
//      2026-08-16: 3 suppressions, all no-founder-codenames). Bulk-disabling a
//      rule inline is a real bypass and is not gated here.
//   3. Anything outside `client/src`. server/, shared/ and tests/ are in the
//      config's `ignores` and are gated by other scripts.
//
// ----------------------------------------------------------------------------
// FLAGS (mutation-testing affordances; `npm run check` passes none)
// ----------------------------------------------------------------------------
//   --target <path>          repeatable; replaces the default `client/src`.
//   --ignore-pattern <glob>  repeatable; passed to ESLint, applied to BOTH the
//                            main lint and the canary.
//
// Both flags are purely SUBTRACTIVE — they can only shrink the linted set or
// shrink the canary's reach. Neither can loosen a floor, widen the baseline or
// silence a rule, so a run that uses them can fail but can never pass over
// less than a clean run would. That is deliberate: it makes the floors
// mutation-provable without handing anyone a bypass.
//
// Exit codes: 0 = clean; 1 = a rule over baseline, a stale baseline, a dead
// canary, a broken ESLint, or a vacuous scan.
// ============================================================================
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { dirname, relative, resolve, sep } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const requireCjs = createRequire(import.meta.url);

const toRel = (abs) => relative(REPO_ROOT, abs).split(sep).join("/");

// NB: kept OUT of scripts/ratchets/ on purpose — that dir is owned by
// ratchet.mjs, which requires a different config shape (a `name` field etc.).
const BASELINE_PATH = resolve(__dirname, "eslint-rules-baseline.json");
// Every message that tells a human which file to edit derives the path from
// BASELINE_PATH instead of hardcoding it. The previous edition hardcoded
// "scripts/ratchets/eslint-rules.json" — a file that does not exist and never
// did — so the one moment someone was paying attention was spent editing the
// wrong thing.
const BASELINE_REL = toRel(BASELINE_PATH);
const SELF_REL = toRel(fileURLToPath(import.meta.url));
const TAG = "[lint-eslint-ratchet]";

const DEFAULT_TARGETS = ["client/src"];

// ----------------------------------------------------------------------------
// FLOORS. Both MEASURED from the live repo, both set comfortably below the
// observed value so a broken scan trips them while ordinary deletion does not.
// Neither may be raised to silence anything, and neither may be deleted — a
// missing floor fails as loudly as a breached one (see assertFloor).
// ----------------------------------------------------------------------------

/**
 * Files ESLint must actually lint under the target.
 *
 * MEASURED 2026-08-16: `npx eslint client/src -f json` returns 873 entries.
 * Corroborated independently — check-no-fabrication.mjs walks the same tree and
 * records `client/src/** measured2026_08_16: 874`; the difference is exactly
 * one file, client/src/components/page-shell.tsx, which eslint.config.js
 * ignores for a pre-existing JSX parse error.
 *
 * Floor set at 700 ≈ 80% of live, matching the ratio scripts/ratchets/
 * reachability.json `minima` uses for the same purpose. If a real deletion wave
 * takes client/src under this floor, LOWER THE FLOOR IN THE SAME COMMIT and
 * name the wave here. Do not raise it, and do not delete it.
 */
const MIN_LINTED_FILES = 700;

/**
 * Rule entries the baseline must contain after doc keys are dropped.
 *
 * MEASURED 2026-08-16: 5 (the five acreos/* rules). A baseline that loses its
 * entries — an emptied file, a doc-key filter that starts eating real keys,
 * counts written as strings — compares nothing and passes everything.
 * Retiring a rule is a deliberate act: lower this in the same commit.
 */
const MIN_BASELINE_RULES = 5;

// ----------------------------------------------------------------------------
// THE CANARY FIXTURE. Never written to disk — it is piped through
// `eslint --stdin` under a virtual path inside client/src so the real config
// (and every rule's own path-based skip list) applies to it exactly as it would
// to a real page.
// ----------------------------------------------------------------------------

/** Virtual path. Must NOT match any rule's skip pattern, and must not be ignored. */
const CANARY_PATH = "client/src/__eslint_ratchet_canary__.tsx";

const CANARY_FIXTURE = [
  "// VIRTUAL FIXTURE for scripts/lint-eslint-ratchet.mjs. Never written to disk.",
  "// Every line below violates exactly one baselined rule, on purpose.",
  "export function EslintRatchetCanary() {",
  "  const m = useMutation({ mutationFn: async () => {} });",
  '  const codename = "Atlas";',
  '  const cls = "bg-red-500";',
  "  return (",
  "    <div className={cls} data-m={m}>",
  "      {codename}",
  "      <Button><Trash2 /></Button>",
  "      <Button>Save</Button>",
  "    </div>",
  "  );",
  "}",
  "",
].join("\n");

/**
 * Rules the fixture MUST trip, and the line that trips each. Keys must cover
 * every rule in the baseline (enforced below) — a baselined rule with no
 * expectation here is a rule whose count of 0 is unfalsifiable.
 */
const CANARY_EXPECTATIONS = {
  "acreos/use-mutation-must-invalidate":
    "useMutation({ mutationFn }) with no onSuccess/onSettled/onMutate",
  "acreos/no-founder-codenames-in-customer-jsx":
    'the string literal "Atlas" in a non-founder path',
  "acreos/no-hardcoded-color-literals":
    'the string literal "bg-red-500"',
  "acreos/icon-button-needs-aria-label":
    "<Button><Trash2 /></Button> — icon-only, no aria-label",
  "acreos/prefer-verbs-canon":
    "<Button>Save</Button> — a canonical verb inline",
};

// ----------------------------------------------------------------------------
// stderr classification. The old code ran ESLint with stderr set to "ignore",
// so a process that failed to start looked identical to a clean lint. Nothing
// is discarded now: harness chatter is PRINTED as a note, and anything else at
// all is fatal.
//
// The two patterns below are the Node RUNTIME's own two-line warning shape and
// npm/npx's own chatter — neither can be produced by ESLint. `npm ERR!` is
// deliberately NOT here. Do not extend this list to quiet an ESLint diagnostic;
// an ESLint diagnostic on stderr means the lint you are about to trust did not
// run the way you think it did.
// ----------------------------------------------------------------------------
const HARNESS_NOISE_PATTERNS = [
  /^\(node:\d+\)\s/,
  /^\(Use `node --trace-warnings/,
  /^npm (?:warn|notice)\b/,
];

function classifyStderr(text) {
  const lines = String(text || "").split("\n");
  const noise = [];
  const diagnostics = [];
  for (const line of lines) {
    if (line.trim() === "") continue;
    if (HARNESS_NOISE_PATTERNS.some((re) => re.test(line))) noise.push(line);
    else diagnostics.push(line);
  }
  return { noise, diagnostics };
}

// ----------------------------------------------------------------------------
// Plumbing
// ----------------------------------------------------------------------------

const failures = [];
function fail(msg) {
  console.error(`${TAG} FAIL — ${msg}`);
  process.exit(1);
}
function note(msg) {
  console.log(`${TAG} ${msg}`);
}

/**
 * A floor that cannot be silently removed: passing `undefined` is as loud as
 * breaching it, and a floor of 0 is rejected because 0 is not a floor
 * (scripts/ratchet.mjs makes the same refusal).
 */
function assertFloor(label, observed, floor, extra) {
  if (typeof floor !== "number" || !Number.isFinite(floor)) {
    fail(
      `MISSING FLOOR — '${label}' has no numeric floor in ${SELF_REL}. ` +
        `An unfloored population is how a scan of nothing reads as clean. Add one.`,
    );
  }
  if (floor <= 0) {
    fail(`FLOOR OF ${floor} — '${label}' is not floored. 0 is not a floor; measure the live value and set ~80% of it.`);
  }
  if (typeof observed !== "number" || !Number.isFinite(observed)) {
    fail(`UNMEASURED POPULATION — '${label}' produced ${observed}, not a number. The scan is broken.`);
  }
  if (observed < floor) {
    fail(
      `VACUOUS SCAN — ${label}: ${observed} (floor ${floor}). ${extra || ""}\n` +
        `  This is NOT good news. A gate that counts problems reports zero when it stops\n` +
        `  seeing anything. Find out why the population collapsed before touching the floor;\n` +
        `  lower it only for a real deletion, in the same commit, with the reason recorded in ${SELF_REL}.`,
    );
  }
}

/** Run ESLint via the CLI, keeping stdout AND stderr AND the exit status. */
function runEslint({ args, input, label }) {
  const res = spawnSync("npx", ["eslint", ...args], {
    cwd: REPO_ROOT,
    encoding: "utf-8",
    maxBuffer: 64 * 1024 * 1024,
    input,
    stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
  });

  if (res.error) {
    fail(`could not run ESLint (${label}): ${res.error.message}`);
  }
  if (res.signal) {
    fail(
      `ESLint (${label}) was killed by ${res.signal} — it did not finish. ` +
        `A killed linter reports no problems; that is not the same as no problems.`,
    );
  }

  const { noise, diagnostics } = classifyStderr(res.stderr);
  if (noise.length) {
    for (const line of noise) note(`  eslint stderr (harness noise): ${line}`);
  }
  if (diagnostics.length) {
    for (const line of diagnostics) console.error(`${TAG}   eslint stderr: ${line}`);
    fail(
      `ESLint (${label}) wrote ${diagnostics.length} diagnostic line(s) to stderr (exit ${res.status}). ` +
        `An ESLint that fails to start must not read as a clean lint — fix the cause. ` +
        `Do NOT re-ignore stderr and do NOT widen HARNESS_NOISE_PATTERNS in ${SELF_REL} to quiet it.`,
    );
  }
  // ESLint: 0 = no problems, 1 = problems found, 2 = fatal (bad config, bad
  // CLI, no matching files). Anything above 1 means the lint did not happen.
  if (res.status === null || res.status > 1) {
    fail(`ESLint (${label}) exited ${res.status} — a fatal error, not a lint result.`);
  }

  const raw = String(res.stdout || "");
  if (!raw.trim()) {
    fail(`ESLint (${label}) produced no JSON output (exit ${res.status}) — did the run crash?`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    fail(`could not parse ESLint JSON output (${label}): ${e.message}`);
  }
  if (!Array.isArray(parsed)) {
    fail(`ESLint JSON output (${label}) is not an array — the formatter changed shape.`);
  }
  return parsed;
}

/** Rule ids that produced at least one message across a result set. */
function firedRules(results) {
  const fired = new Set();
  for (const file of results || []) {
    for (const m of file.messages || []) {
      if (m.ruleId) fired.add(m.ruleId);
    }
  }
  return fired;
}

/** Which expected rules did NOT fire. The detector under test in SELF-TEST A. */
function missingFrom(results, expected) {
  const fired = firedRules(results);
  return expected.filter((r) => !fired.has(r));
}

// ============================================================================
// STAGE 0 — arguments
// ============================================================================
const argv = process.argv.slice(2);
const targets = [];
const ignorePatterns = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--target") {
    const v = argv[++i];
    if (!v) fail("--target needs a path");
    targets.push(v);
  } else if (a === "--ignore-pattern") {
    const v = argv[++i];
    if (!v) fail("--ignore-pattern needs a glob");
    ignorePatterns.push(v);
  } else {
    fail(`unknown argument '${a}'. Supported: --target <path>, --ignore-pattern <glob>.`);
  }
}
const activeTargets = targets.length ? targets : DEFAULT_TARGETS;
const ignoreArgs = ignorePatterns.flatMap((p) => ["--ignore-pattern", p]);
const nonDefault = targets.length > 0 || ignorePatterns.length > 0;
if (nonDefault) {
  console.log(
    `${TAG} ############################################################\n` +
      `${TAG} NON-DEFAULT INVOCATION — this run does NOT gate anything.\n` +
      `${TAG}   targets:         ${activeTargets.join(", ")}\n` +
      `${TAG}   ignore-patterns: ${ignorePatterns.join(", ") || "(none)"}\n` +
      `${TAG} Both flags are subtractive; the floors are unchanged, so a shrunken\n` +
      `${TAG} run can only FAIL. \`npm run check\` passes neither flag.\n` +
      `${TAG} ############################################################`,
  );
}
note(`target: ${activeTargets.join(", ")}`);

// ============================================================================
// STAGE 1 — baseline, validated and floored
// ============================================================================
let baselineRaw;
try {
  baselineRaw = JSON.parse(readFileSync(BASELINE_PATH, "utf-8"));
} catch (e) {
  fail(`could not read ${BASELINE_REL}: ${e.message}`);
}
if (!baselineRaw || typeof baselineRaw !== "object" || Array.isArray(baselineRaw)) {
  fail(`${BASELINE_REL} is not a JSON object of rule -> count.`);
}

// Doc keys (leading "_") are dropped. Anything ELSE that is not a number is a
// malformed entry, and it is reported rather than silently skipped — a rule
// whose count is the string "0" would otherwise vanish from the comparison.
const baseline = {};
for (const [k, v] of Object.entries(baselineRaw)) {
  if (k.startsWith("_")) continue;
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) {
    fail(
      `${BASELINE_REL} entry '${k}' is ${JSON.stringify(v)}, not a non-negative number. ` +
        `A malformed entry drops out of the comparison and takes the rule's gate with it.`,
    );
  }
  baseline[k] = v;
}
const baselineRules = Object.keys(baseline);
assertFloor(
  "baselined rules",
  baselineRules.length,
  MIN_BASELINE_RULES,
  `${BASELINE_REL} yielded ${baselineRules.length} rule entries after dropping doc keys.`,
);
note(`baseline: ${baselineRules.length} rule(s) from ${BASELINE_REL} (floor ${MIN_BASELINE_RULES})`);

// Canary coverage is part of the baseline's validity: a baselined rule with no
// known-bad fixture cannot be distinguished from a rule that stopped running.
const uncovered = baselineRules.filter((r) => !(r in CANARY_EXPECTATIONS));
if (uncovered.length) {
  for (const r of uncovered) {
    console.error(`${TAG}   UNCOVERED BASELINE RULE: ${r}`);
  }
  fail(
    `${uncovered.length} baselined rule(s) have no canary fixture. Its count of 0 would be\n` +
      `  indistinguishable from the rule silently no longer running. Add a line to\n` +
      `  CANARY_FIXTURE in ${SELF_REL} that violates the rule, and an entry to\n` +
      `  CANARY_EXPECTATIONS naming that line.`,
  );
}
const expectedRules = Object.keys(CANARY_EXPECTATIONS);

// ============================================================================
// STAGE 2 — SELF-TEST A: prove the fired-rule detector is not stuck on pass.
// Pure logic, no ESLint. A mutation that does not mutate proves nothing, so the
// detector is driven from both ends before its verdict is trusted.
// ============================================================================
{
  const emptyResults = [{ filePath: CANARY_PATH, messages: [] }];
  const missingOnEmpty = missingFrom(emptyResults, expectedRules);
  if (missingOnEmpty.length !== expectedRules.length) {
    fail(
      `SELF-TEST A — the fired-rule detector reported only ${missingOnEmpty.length}/` +
        `${expectedRules.length} rules missing from an EMPTY result set. It is stuck on pass.`,
    );
  }
  const fullResults = [
    { filePath: CANARY_PATH, messages: expectedRules.map((ruleId) => ({ ruleId, message: "synthetic" })) },
  ];
  const missingOnFull = missingFrom(fullResults, expectedRules);
  if (missingOnFull.length !== 0) {
    fail(
      `SELF-TEST A — the fired-rule detector reported ${missingOnFull.length} rule(s) missing ` +
        `from a result set that contains all of them (${missingOnFull.join(", ")}). It is stuck on fail.`,
    );
  }
}

// ============================================================================
// STAGE 3 — SELF-TEST B: prove the RULE MODULES still fire, and that a no-op
// rule is DETECTED. This is the `create() { return {}; }` mutation, run every
// time rather than trusted to a comment — eslint.config.js already ships one
// such stub (the react-hooks shim), so the shape is three lines from the
// acreos plugin registration.
//
// Deliberately uses an IN-MEMORY config: this leg tests the rule modules in
// isolation. The config-level failures (plugin unregistered, severity "off")
// are the CLI canary's job in stage 4.
// ============================================================================
{
  let ESLintCtor;
  let tsParser;
  let acreos;
  try {
    ({ ESLint: ESLintCtor } = await import("eslint"));
    tsParser = (await import("@typescript-eslint/parser")).default;
    acreos = requireCjs(resolve(REPO_ROOT, "eslint-rules/index.cjs"));
  } catch (e) {
    fail(`SELF-TEST B — could not load ESLint / the acreos plugin: ${e.message}`);
  }
  if (!acreos || !acreos.rules || typeof acreos.rules !== "object") {
    fail("SELF-TEST B — eslint-rules/index.cjs exports no `rules` object.");
  }

  // Only the acreos/* expectations can be exercised here; anything else would
  // need its own plugin loaded. Report the split rather than implying coverage.
  const acreosExpected = expectedRules.filter((r) => r.startsWith("acreos/"));
  const foreignExpected = expectedRules.filter((r) => !r.startsWith("acreos/"));
  assertFloor(
    "acreos rules exercised by SELF-TEST B",
    acreosExpected.length,
    1,
    "No acreos/* rule is in CANARY_EXPECTATIONS, so the no-op mutation test covers nothing.",
  );

  const missingModules = acreosExpected.filter((r) => !(r.slice("acreos/".length) in acreos.rules));
  if (missingModules.length) {
    fail(
      `SELF-TEST B — eslint-rules/index.cjs no longer exports: ${missingModules.join(", ")}. ` +
        `The baseline still gates these rules; a rule that is not exported cannot fire.`,
    );
  }

  const makeConfig = (plugin) => [
    {
      files: ["**/*.tsx"],
      languageOptions: {
        parser: tsParser,
        parserOptions: { ecmaVersion: 2022, sourceType: "module", ecmaFeatures: { jsx: true } },
      },
      plugins: { acreos: plugin },
      rules: Object.fromEntries(acreosExpected.map((r) => [r, "error"])),
    },
  ];
  const lintFixture = async (plugin) => {
    const engine = new ESLintCtor({ overrideConfigFile: true, cwd: REPO_ROOT, baseConfig: makeConfig(plugin) });
    return engine.lintText(CANARY_FIXTURE, { filePath: resolve(REPO_ROOT, CANARY_PATH) });
  };

  const liveResults = await lintFixture(acreos);
  const deadOnLive = missingFrom(liveResults, acreosExpected);
  if (deadOnLive.length) {
    for (const r of deadOnLive) {
      console.error(`${TAG}   DEAD RULE MODULE: ${r} — expected to fire on: ${CANARY_EXPECTATIONS[r]}`);
    }
    fail(
      `SELF-TEST B — ${deadOnLive.length} acreos rule module(s) did not fire on the known-bad fixture.\n` +
        `  Either the rule stopped working (a create() returning {}, a broken predicate, a skip\n` +
        `  pattern that now swallows ${CANARY_PATH}) or the fixture stopped violating it.\n` +
        `  A rule that cannot fire reports 0 problems forever, and this ratchet would call that PASS.`,
    );
  }

  const noopPlugin = {
    rules: Object.fromEntries(
      Object.keys(acreos.rules).map((n) => [n, { meta: { schema: [] }, create: () => ({}) }]),
    ),
  };
  const noopResults = await lintFixture(noopPlugin);
  const firedWhenStubbed = [...firedRules(noopResults)].filter((r) => acreosExpected.includes(r));
  if (firedWhenStubbed.length) {
    fail(
      `SELF-TEST B — ${firedWhenStubbed.length} rule(s) still "fired" with every rule stubbed to ` +
        `create: () => ({}): ${firedWhenStubbed.join(", ")}. The liveness check is measuring something else.`,
    );
  }

  note(
    `self-test: ${acreosExpected.length} rule module(s) fire on the fixture, ` +
      `${acreosExpected.length} detected dead when stubbed with create: () => ({})` +
      (foreignExpected.length ? ` [not covered by SELF-TEST B: ${foreignExpected.join(", ")}]` : ""),
  );
}

// ============================================================================
// STAGE 4 — CANARY: the same fixture through the REAL eslint.config.js, over
// the real CLI. This is what sees a plugin that stopped being registered, a
// severity flipped to "off", or CANARY_PATH becoming ignored.
// ============================================================================
{
  const canaryResults = runEslint({
    args: ["--stdin", "--stdin-filename", CANARY_PATH, "-f", "json", ...ignoreArgs],
    input: CANARY_FIXTURE,
    label: "canary",
  });

  const ignored = canaryResults.some((f) =>
    (f.messages || []).some((m) => !m.ruleId && /File ignored/i.test(m.message || "")),
  );
  if (ignored) {
    fail(
      `CANARY IGNORED — the config no longer lints ${CANARY_PATH}. The canary proves nothing\n` +
        `  when its own path is ignored, and whatever ignores it is very likely ignoring real\n` +
        `  client/src files too. Check the \`ignores\` array in eslint.config.js.`,
    );
  }

  const fatal = [];
  for (const f of canaryResults) {
    for (const m of f.messages || []) if (m.fatal) fatal.push(m.message);
  }
  if (fatal.length) {
    fail(`CANARY UNPARSEABLE — the fixture no longer parses: ${fatal.join("; ")}`);
  }

  const silent = missingFrom(canaryResults, expectedRules);
  if (silent.length) {
    for (const r of silent) {
      console.error(`${TAG}   SILENT RULE: ${r} — expected to fire on: ${CANARY_EXPECTATIONS[r]}`);
    }
    fail(
      `${silent.length} baselined rule(s) did not fire on the known-bad fixture under the REAL\n` +
        `  eslint.config.js. A rule that cannot fire reports 0 problems, and a baseline of 0 makes\n` +
        `  that indistinguishable from clean code — which is exactly why this check exists.\n` +
        `  Look for: the rule removed from eslint.config.js, its severity set to "off", the acreos\n` +
        `  plugin failing to load, or ${CANARY_PATH} newly matching an \`ignores\` entry.`,
    );
  }
  note(`canary: ${expectedRules.length}/${expectedRules.length} baselined rule(s) fired on the virtual known-bad fixture`);
}

// ============================================================================
// STAGE 5 — the real lint, and the population floor
// ============================================================================
const results = runEslint({
  args: [...activeTargets, "-f", "json", ...ignoreArgs],
  label: "main",
});

assertFloor(
  "files linted",
  results.length,
  MIN_LINTED_FILES,
  `ESLint returned ${results.length} file entries for ${activeTargets.join(", ")}.`,
);
note(`population: ${results.length} files linted (floor ${MIN_LINTED_FILES}; measured 873 on 2026-08-16)`);

// Count problems per rule (errors + warnings together — the ratchet doesn't
// care about severity, only that no rule grows). A FATAL message means the file
// did not really get linted, so it is a population loss dressed as a problem.
const counts = {};
let fatalFiles = 0;
for (const file of results) {
  let sawFatal = false;
  for (const m of file.messages || []) {
    if (m.fatal) sawFatal = true;
    const rule = m.ruleId || "(no-rule)";
    counts[rule] = (counts[rule] || 0) + 1;
  }
  if (sawFatal) {
    fatalFiles++;
    console.error(`${TAG}   PARSE ERROR: ${toRel(file.filePath)} — no rule could run on this file.`);
  }
}
if (fatalFiles) {
  fail(
    `${fatalFiles} file(s) failed to parse. They are inside the population count but no rule ran ` +
      `on them, so their zero problems mean nothing.`,
  );
}

// ============================================================================
// STAGE 6 — the ratchet. Compare the UNION of observed rules and baselined
// rules. Iterating `counts` alone skipped every rule that VANISHED from the
// output: a rule dropping to zero because its plugin stopped loading looked
// identical to it being fixed, and only one of those is good news.
//
// Note the honest limit: at a baseline of 0, "vanished" and "clean" are the
// same number and no comparison can separate them. Stages 2-4 are what
// separate them.
// ============================================================================
const allRules = [...new Set([...Object.keys(counts), ...baselineRules])].sort();

const over = [];
const under = [];
const novel = [];
for (const rule of allRules) {
  const observed = Object.prototype.hasOwnProperty.call(counts, rule);
  const n = observed ? counts[rule] : 0;
  const base = baseline[rule];
  if (base === undefined) novel.push([rule, n]);
  else if (n > base) over.push([rule, n, base]);
  else if (n < base) under.push([rule, n, base, observed]);
}

const total = Object.values(counts).reduce((a, b) => a + b, 0);
const baseTotal = Object.values(baseline).reduce((a, b) => a + b, 0);
console.log(
  `${TAG} ${total} problem(s); ${allRules.length} rule(s) compared ` +
    `(${Object.keys(counts).length} present in output, ${baselineRules.length} in baseline); baseline total ${baseTotal}`,
);

if (novel.length) {
  for (const [rule, n] of novel) {
    console.error(
      `${TAG}   NEW rule above baseline: ${rule} (${n}). Fix the violations or add the rule to ` +
        `${BASELINE_REL} with sign-off (and give it a canary fixture in ${SELF_REL}).`,
    );
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
  for (const [rule, n, base, observed] of under) {
    const vanished = !observed
      ? `\n${TAG}     NB: ${rule} produced NO messages at all. Before you lower this, confirm the rule ` +
        `still RUNS — a rule that stopped loading looks exactly like a rule that was fixed. The canary ` +
        `above says it fires on a known-bad fixture; that it fires on real code is your check.`
      : "";
    console.error(
      `${TAG}   IMPROVED (tighten baseline): ${rule} is now ${n}, baseline ${base}. Lower it to ${n} in ` +
        `${BASELINE_REL} in this commit to lock the win.${vanished}`,
    );
  }
  fail(`${under.length} rule(s) below baseline — tighten the baseline.`);
}

console.log(`${TAG} PASS — no rule above baseline; population and canary intact.`);
