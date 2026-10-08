#!/usr/bin/env node
// ============================================================================
// scripts/check-clock-reads.mjs — the CLOCK ratchet.
// ----------------------------------------------------------------------------
// Counts every direct wall-clock read in server/ outside the one clock
// (server/utils/clock.ts). Such a read is invisible in production and breaks
// every simulation: a simulated month cannot pass while code asks the machine
// what time it is (the founder sim's 2-articles-a-month, 2026-10-07).
//
// WHAT COUNTS (a parse, not a scan — comments and strings never count):
//   - any reference to `Date.now` — called, aliased (`const n = Date.now`),
//     passed as a value, or reached as `globalThis.Date.now`;
//   - `Date["now"]` (element access with the literal "now");
//   - `new Date()` / `new Date` with no arguments;
//   - `Date()` called as a function (returns "now" as a string);
//   - `performance.timeOrigin` (wall-clock epoch by another name).
// `new Date(x)` with an argument is a conversion, not a read, and is not
// counted; `Date.now()` nested inside it IS counted on its own.
//
// POPULATION: every .ts/.tsx/.mts/.cts/.js/.mjs/.cjs file under server/,
// minus test files (*.test.*, *.spec.*, __tests__/, __mocks__/), minus
// EXACTLY server/utils/clock.ts. Floors on the file count and on the number
// of directories walked are checked before the baseline (vacuity), and a
// file the parser cannot read is COUNTED as unreadable and fails the gate —
// never skipped.
//
// Semantics: bidirectional like scripts/ratchet.mjs. count > baseline FAILS
// (new wall-clock read); count < baseline FAILS (lower the baseline in the
// same commit that converted the reads). Baseline lives in
// scripts/ratchets/clock-reads.json.
//
//   node scripts/check-clock-reads.mjs            # gate
//   node scripts/check-clock-reads.mjs --measure  # print counts, no verdict
//   node scripts/check-clock-reads.mjs --by-dir   # breakdown
// ============================================================================
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
export const CLOCK_MODULE = "server/utils/clock.ts";
const EXT = /\.(ts|tsx|mts|cts|js|mjs|cjs)$/;
const TEST = /(\.test\.|\.spec\.|(^|\/)__tests__\/|(^|\/)__mocks__\/)/;

function kindFor(file) {
  if (file.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (/\.(js|mjs|cjs)$/.test(file)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function isDateIdent(node) {
  if (ts.isIdentifier(node)) return node.text === "Date";
  // globalThis.Date / global.Date / window.Date
  return ts.isPropertyAccessExpression(node) && node.name.text === "Date" && ts.isIdentifier(node.expression) && ["globalThis", "global", "window", "self"].includes(node.expression.text);
}

/**
 * Every wall-clock read in one source text. Returns [{ shape, line, start, end }].
 * `start`/`end` are offsets of the whole read expression (for the codemod).
 */
export function findClockReads(text, fileName = "x.ts") {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, kindFor(fileName));
  const out = [];
  const push = (shape, node) => {
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    out.push({ shape, line: line + 1, start: node.getStart(sf), end: node.getEnd() });
  };
  const visit = (node) => {
    if (ts.isPropertyAccessExpression(node) && node.name.text === "now" && isDateIdent(node.expression)) {
      const parent = node.parent;
      if (parent && ts.isCallExpression(parent) && parent.expression === node) push(parent.arguments.length === 0 ? "Date.now()" : "Date.now(…)", parent);
      else push("Date.now (reference)", node);
    } else if (ts.isElementAccessExpression(node) && isDateIdent(node.expression) && ts.isStringLiteralLike(node.argumentExpression) && node.argumentExpression.text === "now") {
      push("Date[\"now\"]", node);
    } else if (ts.isNewExpression(node) && isDateIdent(node.expression) && (!node.arguments || node.arguments.length === 0)) {
      push("new Date()", node);
    } else if (ts.isCallExpression(node) && isDateIdent(node.expression)) {
      push("Date()", node);
    } else if (ts.isPropertyAccessExpression(node) && node.name.text === "timeOrigin" && ts.isIdentifier(node.expression) && node.expression.text === "performance") {
      push("performance.timeOrigin", node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** The population: every non-test source file under server/, minus the clock. */
export function serverPopulation(root = ROOT) {
  const files = [];
  const dirs = new Set();
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name.startsWith(".")) continue;
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) { dirs.add(relative(root, p)); walk(p); continue; }
      const rel = relative(root, p).split(sep).join("/");
      if (!EXT.test(rel) || TEST.test(rel) || rel === CLOCK_MODULE) continue;
      files.push(rel);
    }
  };
  walk(join(root, "server"));
  return { files: files.sort(), dirCount: dirs.size };
}

export function measure(root = ROOT) {
  const { files, dirCount } = serverPopulation(root);
  let total = 0;
  const byFile = {};
  const unreadable = [];
  for (const f of files) {
    let text;
    try { text = readFileSync(join(root, f), "utf8"); } catch (e) { unreadable.push(f); continue; }
    try {
      const n = findClockReads(text, f).length;
      if (n) byFile[f] = n;
      total += n;
    } catch (e) {
      unreadable.push(f);
    }
  }
  return { total, files: files.length, dirCount, byFile, unreadable, clockModulePresent: existsSync(join(root, CLOCK_MODULE)) };
}

function main() {
  const cfg = JSON.parse(readFileSync(join(ROOT, "scripts/ratchets/clock-reads.json"), "utf8"));
  const m = measure();
  const args = new Set(process.argv.slice(2));
  if (args.has("--by-dir")) {
    const by = {};
    for (const [f, n] of Object.entries(m.byFile)) {
      const d = f.split("/").slice(0, 3).join("/");
      by[d] = (by[d] ?? 0) + n;
    }
    for (const [d, n] of Object.entries(by).sort((a, b) => b[1] - a[1])) console.log(String(n).padStart(6), d);
  }
  console.log(`clock-reads: ${m.total} direct wall-clock read(s) in ${m.files} server file(s), ${m.dirCount} dir(s) walked; unreadable=${m.unreadable.length}`);
  if (args.has("--measure")) return;
  const fails = [];
  if (!m.clockModulePresent) fails.push(`${CLOCK_MODULE} is missing — the one clock is gone, so every read is uncounted by design`);
  if (m.files < cfg.minima.files) fails.push(`population ${m.files} files < floor ${cfg.minima.files} (VACUITY: the scan stopped seeing server/)`);
  if (m.dirCount < cfg.minima.dirs) fails.push(`walked ${m.dirCount} dirs < floor ${cfg.minima.dirs} (VACUITY)`);
  if (m.unreadable.length) fails.push(`unreadable files (counted, not skipped): ${m.unreadable.join(", ")}`);
  if (m.total > cfg.baselineCount) {
    fails.push(`count ${m.total} > baseline ${cfg.baselineCount}: a new direct wall-clock read. Use clock.now()/clock.nowMs() from server/utils/clock.ts. Do NOT raise the baseline.`);
  } else if (m.total < cfg.baselineCount) {
    fails.push(`count ${m.total} < baseline ${cfg.baselineCount}: reads were converted — lower "baselineCount" to ${m.total} in scripts/ratchets/clock-reads.json in this commit.`);
  }
  if (fails.length) {
    for (const f of fails) console.log(`FAIL clock-reads: ${f}`);
    process.exit(1);
  }
  console.log(`PASS clock-reads: ${m.total} (baseline ${cfg.baselineCount})`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
