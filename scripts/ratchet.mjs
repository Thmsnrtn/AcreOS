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
//     "direction":     "down"
//   }
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
// Adding a new ratchet = drop a JSON file in scripts/ratchets/ with the
// CURRENT measured count (run `node scripts/ratchet.mjs --measure <file>` to
// print counts without gating). Raising an existing baseline requires
// Iris-CTO sign-off.
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
  for (const root of roots) {
    if (root === "") {
      console.error(
        "[ratchet] globs must start with a literal top-level directory " +
          `(got a wildcard root) — refusing to walk the whole repo`,
      );
      process.exit(1);
    }
    for (const f of filesUnderRoot(root)) candidates.add(f);
  }
  return [...candidates].filter(
    (rel) =>
      incRes.some((re) => re.test(rel)) && !excRes.some((re) => re.test(rel)),
  );
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
  const files = matchFiles(cfg.globs, cfg.exclude);
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
  return { total, fileCount: files.length, examples: newExamples };
}

// ----------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------
function main() {
  const configs = loadConfigs();
  let failed = false;

  for (const cfg of configs) {
    const { total, fileCount } = evaluate(cfg);
    const base = cfg.baselineCount;

    if (MEASURE_ONLY) {
      console.log(
        `[ratchet:measure] ${cfg.name}: current=${total} baseline=${base} ` +
          `(${fileCount} files)`,
      );
      continue;
    }

    if (total === base) {
      console.log(
        `[ratchet] ${cfg.name}: PASS — ${total} (baseline ${base}, ${fileCount} files)`,
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
    }
  }

  if (MEASURE_ONLY) process.exit(0);
  if (failed) process.exit(1);
  console.log("[ratchet] PASS — all ratchets at baseline");
  process.exit(0);
}

main();
