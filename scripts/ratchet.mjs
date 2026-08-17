#!/usr/bin/env node
// ============================================================================
// scripts/ratchet.mjs — generic count-ratchet factory (elevation 1C).
// ----------------------------------------------------------------------------
// Reads every config in scripts/ratchets/*.json. Each config declares:
//
//   {
//     "name":          "res-status-raw",
//     "description":   "why this pattern is being driven down",
//     "pattern":       "res\\.status\\(",        // JS regex source
//     "globs":         ["server/**/*.ts"],
//     "exclude":       ["**/*.test.ts"],          // optional
//     "baselineCount": 704,
//     "minima":        { "files": 1100 },         // REQUIRED — see VACUITY GUARD
//     "minimaNote":    "seeded from N files measured YYYY-MM-DD",
//     "direction":     "down"
//   }
//
// A config may instead declare `"mode": "external"` + `"evaluator": "<path>"`.
// Those are baselines this regex factory CANNOT compute (e.g. reachability,
// which needs a cross-file symbol index). They live here so every ratchet
// baseline in the repo is in one directory, but their own script owns the gate
// and is wired into `npm run check` separately. This factory prints DELEGATED
// and skips them.
//
// Semantics (bidirectional, same discipline as check-no-fabrication.mjs):
//   count >  baseline → FAIL  (new offender introduced — fix it, don't bump)
//   count <  baseline → FAIL  (improvement landed but the baseline is now
//                              stale-high; print the new number so the commit
//                              that removed offenders also tightens the gate)
//   count == baseline → PASS
//
// Counting rules:
//   - every regex match on every line counts (a line can count twice);
//   - pure comment lines (trimmed start `//` or `*`) are skipped so
//     documentation that MENTIONS a pattern doesn't move the number;
//   - node_modules / dist / dotted dirs are never walked.
//
// ----------------------------------------------------------------------------
// VACUITY GUARD — `minima.files`, REQUIRED on every non-external config.
// ----------------------------------------------------------------------------
// Every baseline here counts BAD THINGS FOUND, so a scan that stops seeing
// files finds zero and reports that as PROGRESS. `walk()` returns an empty list
// for a directory that does not exist (`if (!existsSync(dir)) return out`), so
// one typo'd or stale glob silently empties a config's file set — and nothing
// downstream looks at `files.length`. The two outcomes are both worse than a
// crash:
//
//   · a ZERO-baseline ratchet (req-as-any) prints `PASS — 0 (baseline 0, 0
//     files)` and the whole run stays green. The guarantee is gone and CI
//     says everything is fine.
//   · a NONZERO-baseline ratchet prints `Good news: 38 occurrence(s) were
//     removed. Lock it in — set "baselineCount": 0`. A register that
//     instructs the operator to lower a baseline to a number that was never
//     true is the most dangerous output a gate can produce — this is exactly
//     what check-tests-typecheck.mjs did on 2026-08-16 off a memory-starved
//     tsc ("count is 1, baseline says 162"; the real count was 162).
//
// So `minima.files` floors the scan POPULATION, and it is checked BEFORE the
// baseline comparison — a config whose population is untrustworthy prints no
// verdict at all, neither PASS nor a "lock it in". Same shape and same
// discipline as `minima` in scripts/ratchets/reachability.json.
//
// A MISSING floor fails exactly as loudly as a breached one. That half is not
// decoration: without it the guard can be dropped later by deleting a line,
// which is precisely how a gate quietly stops gating.
//
// Floors are MEASURED from the live repo and set comfortably below it (~75-80%)
// so a broken walk trips them while ordinary deletion — the whole point of
// these ratchets — does not. If a real deletion wave takes a population under
// its floor, LOWER the floor in the same commit and name the wave in
// `minimaNote`. Never raise a floor to silence something; never delete the key.
// The linecount ratchets scan exactly one file, so their floor is 1 — that is
// a real canary, not a formality: it catches the god-file being renamed or
// deleted, which would otherwise read as its line count collapsing to zero.
//
// Adding a new ratchet = drop a JSON file in scripts/ratchets/ with the
// CURRENT measured count AND a measured `minima.files` (run
// `node scripts/ratchet.mjs --measure` to print counts and populations without
// gating). Raising an existing baseline requires Iris-CTO sign-off.
// ============================================================================

import { readFileSync, readdirSync, lstatSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, relative } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");
const RATCHETS_DIR = join(__dirname, "ratchets");

// --measure mode: print per-config counts without failing (for seeding /
// re-baselining). Optionally pass config names to limit.
const args = process.argv.slice(2);
const MEASURE_ONLY = args.includes("--measure");

// ----------------------------------------------------------------------------
// Minimal glob → regex (supports **, *, ?). Paths are repo-relative posix.
// ----------------------------------------------------------------------------
function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === "*") {
      if (glob[i + 1] === "*") {
        // `**/` matches zero or more path segments; bare `**` matches all.
        if (glob[i + 2] === "/") {
          re += "(?:[^/]+/)*";
          i += 2;
        } else {
          re += ".*";
          i += 1;
        }
      } else {
        re += "[^/]*";
      }
    } else if (ch === "?") {
      re += "[^/]";
    } else if ("\\^$.|+()[]{}".includes(ch)) {
      re += "\\" + ch;
    } else {
      re += ch;
    }
  }
  return new RegExp(`^${re}$`);
}

function walk(dir, out) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry.startsWith(".")) {
      continue;
    }
    const full = join(dir, entry);
    // lstat: never follow symlinks (the repo contains self-referential
    // convenience links that would loop a recursive stat-based walk).
    const st = lstatSync(full);
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

// Cache walked roots across configs (one walk per top-level dir, many
// ratchets). We only walk the directories the globs actually root in, so a
// "server/**" ratchet never touches client/ or attached_assets/.
const WALK_CACHE = new Map();
function filesUnderRoot(root) {
  if (!WALK_CACHE.has(root)) {
    WALK_CACHE.set(
      root,
      walk(join(REPO_ROOT, root), []).map((f) =>
        relative(REPO_ROOT, f).split("\\").join("/"),
      ),
    );
  }
  return WALK_CACHE.get(root);
}

function globRoot(glob) {
  // First path segment before any wildcard, e.g. "server/**/*.ts" → "server".
  const seg = glob.split("/")[0];
  return seg.includes("*") || seg.includes("?") ? "" : seg;
}

function matchFiles(globs, exclude) {
  const incRes = globs.map(globToRegExp);
  const excRes = (exclude ?? []).map(globToRegExp);
  const roots = [...new Set(globs.map(globRoot))];
  const candidates = new Set();
  // walk() treats a nonexistent directory as "no files here", which is
  // indistinguishable from a clean scan downstream. Name the missing roots so
  // the vacuity guard can report the CAUSE and not just the symptom. (A root
  // that exists is no proof of a live scan — a glob can point at a missing
  // SUBdirectory and walk fine; that case is caught by the population floor.)
  const missingRoots = [];
  for (const root of roots) {
    if (root === "") {
      console.error(
        "[ratchet] globs must start with a literal top-level directory " +
          `(got a wildcard root) — refusing to walk the whole repo`,
      );
      process.exit(1);
    }
    if (!existsSync(join(REPO_ROOT, root))) missingRoots.push(root);
    for (const f of filesUnderRoot(root)) candidates.add(f);
  }
  const files = [...candidates].filter(
    (rel) =>
      incRes.some((re) => re.test(rel)) && !excRes.some((re) => re.test(rel)),
  );
  return { files, missingRoots };
}

// ----------------------------------------------------------------------------
// Counting
// ----------------------------------------------------------------------------
function countInFile(relPath, regex) {
  const lines = readFileSync(join(REPO_ROOT, relPath), "utf8").split("\n");
  let count = 0;
  const examples = [];
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trimStart();
    if (t.startsWith("//") || t.startsWith("*")) continue; // doc lines don't count
    const matches = lines[i].match(regex);
    if (matches) {
      count += matches.length;
      if (examples.length < 5) examples.push(`${relPath}:${i + 1}`);
    }
  }
  return { count, examples };
}

// mode "lineCount": the per-file count is the file's newline count (matches
// `wc -l`), not regex matches. Used to ratchet a god-file's size DOWN as it is
// progressively split into mixin repos. No comment-skipping (every line counts).
function lineCountInFile(relPath) {
  const text = readFileSync(join(REPO_ROOT, relPath), "utf8");
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") count++;
  }
  return { count, examples: [`${relPath}:${count}`] };
}

// ----------------------------------------------------------------------------
// Config loading + evaluation
// ----------------------------------------------------------------------------
function loadConfigs() {
  if (!existsSync(RATCHETS_DIR)) {
    console.error(`[ratchet] missing config dir scripts/ratchets/`);
    process.exit(1);
  }
  const configs = [];
  for (const entry of readdirSync(RATCHETS_DIR).sort()) {
    if (!entry.endsWith(".json")) continue;
    const raw = readFileSync(join(RATCHETS_DIR, entry), "utf8");
    let cfg;
    try {
      cfg = JSON.parse(raw);
    } catch (err) {
      console.error(`[ratchet] ${entry} is not valid JSON: ${err.message}`);
      process.exit(1);
    }
    // mode "external": the count is not a regex tally over globs, so this
    // factory cannot evaluate it. The config still lives here (one place to
    // look for every ratchet baseline in the repo) but its OWN evaluator owns
    // the gate — it is wired into `npm run check` separately.
    if (cfg.mode === "external") {
      if (!cfg.evaluator) {
        console.error(
          `[ratchet] ${entry}: mode "external" requires an "evaluator" path`,
        );
        process.exit(1);
      }
      console.log(
        `[ratchet] ${cfg.name ?? entry}: DELEGATED — evaluated by ${cfg.evaluator}`,
      );
      continue;
    }
    // "pattern" is required for the default (regex-match) mode but irrelevant
    // for mode "lineCount", which counts the file's newlines instead.
    const required = ["name", "globs", "baselineCount", "direction"];
    if (cfg.mode !== "lineCount") required.push("pattern");
    for (const field of required) {
      if (cfg[field] === undefined) {
        console.error(`[ratchet] ${entry} missing required field "${field}"`);
        process.exit(1);
      }
    }
    if (cfg.direction !== "down") {
      console.error(
        `[ratchet] ${entry}: direction "${cfg.direction}" unsupported (only "down")`,
      );
      process.exit(1);
    }
    cfg.__file = entry;
    configs.push(cfg);
  }
  if (configs.length === 0) {
    console.error("[ratchet] no configs found in scripts/ratchets/");
    process.exit(1);
  }
  return configs;
}

function evaluate(cfg) {
  const lineCountMode = cfg.mode === "lineCount";
  const regex = lineCountMode ? null : new RegExp(cfg.pattern, cfg.flags ?? "g");
  const { files, missingRoots } = matchFiles(cfg.globs, cfg.exclude);
  let total = 0;
  let newExamples = [];
  for (const rel of files) {
    const { count, examples } = lineCountMode
      ? lineCountInFile(rel)
      : countInFile(rel, regex);
    total += count;
    if (examples.length && newExamples.length < 10) {
      newExamples = newExamples.concat(examples).slice(0, 10);
    }
  }
  return {
    total,
    fileCount: files.length,
    examples: newExamples,
    missingRoots,
  };
}

// ----------------------------------------------------------------------------
// VACUITY GUARD (see the header). Returns the reasons this config's count is
// NOT evidence of anything. Empty array = the scan is trustworthy and the
// baseline comparison may proceed.
// ----------------------------------------------------------------------------
function vacuityFailures(cfg, fileCount, missingRoots) {
  const rel = `scripts/ratchets/${cfg.__file}`;
  const failures = [];

  if (missingRoots.length > 0) {
    failures.push(
      `glob root(s) missing from the repo: ${missingRoots.join(", ")}. ` +
        `walk() returns an empty list for a directory that does not exist, so ` +
        `this config scanned nothing at all.\n` +
        `      Fix the glob (or the move/rename that orphaned it) in ${rel}. ` +
        `Do NOT touch "baselineCount" — the count below is an artefact of the ` +
        `broken scan, not a measurement.`,
    );
  }

  const floor = cfg.minima?.files;

  if (floor === undefined) {
    // A missing floor must be as loud as a breached one, otherwise the guard
    // can be removed later by deleting one line and nothing notices.
    failures.push(
      `no "minima": { "files": <n> } in ${rel}. Every ratchet must floor its ` +
        `scan population — an unfloored config lets a broken scan read as ` +
        `clean:\n` +
        `      a zero-baseline ratchet PASSes on 0 files, and a nonzero one ` +
        `prints a stale-high "lock it in" for a number that was never true.\n` +
        `      This run matched ${fileCount} file(s). Seed the floor ` +
        `comfortably below that (~75-80%) ONLY after confirming this run is ` +
        `not itself vacuous, and record the observed number and the date in ` +
        `"minimaNote" so the next session re-measures instead of re-arguing.`,
    );
  } else if (!Number.isFinite(floor) || !Number.isInteger(floor) || floor < 1) {
    failures.push(
      `"minima.files" in ${rel} must be an integer >= 1 (got ` +
        `${JSON.stringify(floor)}). A floor of 0 is not a floor — it admits ` +
        `the empty scan this guard exists to catch.`,
    );
  } else if (fileCount < floor) {
    failures.push(
      `scanned ${fileCount} file(s), below the floor of ${floor}. This is NOT ` +
        `a clean bill of health — the scan stopped seeing files.\n` +
        `      Suspect the globs, a renamed/moved directory, or the walk ` +
        `before you suspect progress. If a real deletion wave genuinely ` +
        `shrank this population, lower "minima.files" in ${rel} in the SAME ` +
        `commit and name the wave in "minimaNote". Never raise a floor to ` +
        `silence something, and never delete the key.`,
    );
  }

  return failures;
}

// ----------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------
function main() {
  const configs = loadConfigs();
  let failed = false;

  for (const cfg of configs) {
    const { total, fileCount, missingRoots } = evaluate(cfg);
    const base = cfg.baselineCount;
    const vacuity = vacuityFailures(cfg, fileCount, missingRoots);

    if (MEASURE_ONLY) {
      // --measure is explicitly non-gating (it already exits 0 with counts off
      // baseline) and must stay usable for SEEDING a floor on a new config, so
      // vacuity is reported here as a note rather than a failure.
      console.log(
        `[ratchet:measure] ${cfg.name}: current=${total} baseline=${base} ` +
          `(${fileCount} files, floor ${cfg.minima?.files ?? "MISSING"})`,
      );
      for (const f of vacuity) console.log(`  [ratchet:measure] vacuity — ${f}`);
      continue;
    }

    // VACUITY GUARD, before the baseline comparison. A count taken over a file
    // set that should not be trusted is not evidence, and the worst thing this
    // script can do with it is turn it into a "lock it in" instruction. So a
    // config that trips this prints NO verdict — not PASS, not a reduction.
    if (vacuity.length > 0) {
      failed = true;
      console.error(
        `[ratchet] ${cfg.name}: VACUITY GUARD — count ${total} over ` +
          `${fileCount} file(s) is not trustworthy; baseline comparison ` +
          `SKIPPED (baseline ${base} left untouched).`,
      );
      for (const f of vacuity) console.error(`    · ${f}`);
      continue;
    }

    if (total === base) {
      console.log(
        `[ratchet] ${cfg.name}: PASS — ${total} (baseline ${base}, ` +
          `${fileCount} files, floor ${cfg.minima.files})`,
      );
    } else if (total > base) {
      failed = true;
      const unit =
        cfg.mode === "lineCount" ? "line(s)" : `occurrence(s) of /${cfg.pattern}/`;
      console.error(
        `[ratchet] ${cfg.name}: FAIL — ${total} > baseline ${base} ` +
          `(+${total - base} new ${unit}).`,
      );
      console.error(
        `  Fix the new occurrence(s) instead of raising the baseline` +
          (cfg.description ? ` — ${cfg.description}` : "."),
      );
      console.error(
        `  Raising scripts/ratchets/${cfg.__file} requires Iris-CTO sign-off.`,
      );
    } else {
      // total < base — improvement landed; force the gate to tighten.
      failed = true;
      console.error(
        `[ratchet] ${cfg.name}: FAIL — stale-high baseline. Current count is ` +
          `${total}, baseline says ${base}.`,
      );
      console.error(
        `  Good news: ${base - total} occurrence(s) were removed. Lock it in — ` +
          `set "baselineCount": ${total} in scripts/ratchets/${cfg.__file}.`,
      );
      // Say WHY this reduction is believable. The identical sentence off a
      // broken scan is how a baseline gets lowered to a number that was never
      // true, so the population that backs it is stated alongside it.
      console.error(
        `  (Population checked first: ${fileCount} files scanned, floor ` +
          `${cfg.minima.files} — this reduction is not a vacuous scan.)`,
      );
    }
  }

  if (MEASURE_ONLY) process.exit(0);
  if (failed) process.exit(1);
  console.log("[ratchet] PASS — all ratchets at baseline");
  process.exit(0);
}

main();
