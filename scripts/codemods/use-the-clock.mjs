#!/usr/bin/env node
// Codemod: convert direct wall-clock reads in the given server paths to the one
// clock (server/utils/clock.ts). Uses the SAME parser as the clock ratchet
// (scripts/check-clock-reads.mjs), so what it converts is exactly what the
// ratchet counts.
//
//   node scripts/codemods/use-the-clock.mjs server/services/solene server/jobs ...
//
// Converts `Date.now()` -> `clock.nowMs()` and `new Date()` -> `clock.now()`.
// Leaves aliased references (`const n = Date.now`), `Date()` and
// `performance.timeOrigin` for a human: they are rare and each needs reading.
// Imports `clock` (or `clock as appClock` when the file already binds `clock`).
import { readFileSync, writeFileSync, statSync, readdirSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { findClockReads, CLOCK_MODULE } from "../check-clock-reads.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const TEST = /(\.test\.|\.spec\.|(^|\/)__tests__\/|(^|\/)__mocks__\/)/;

function listFiles(p) {
  const abs = join(ROOT, p);
  const st = statSync(abs);
  if (st.isFile()) return [p];
  const out = [];
  for (const n of readdirSync(abs)) {
    if (n === "node_modules" || n.startsWith(".")) continue;
    out.push(...listFiles(join(p, n)));
  }
  return out;
}

function boundIdentifiers(sf) {
  const names = new Set();
  const visit = (n) => {
    if (ts.isIdentifier(n)) names.add(n.text);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return names;
}

let changedFiles = 0, converted = 0;
const skipped = [];
for (const target of process.argv.slice(2)) {
  for (const rel0 of listFiles(target)) {
    const rel = rel0.split(sep).join("/");
    if (!/\.(ts|tsx)$/.test(rel) || TEST.test(rel) || rel === CLOCK_MODULE || rel.endsWith(".d.ts")) continue;
    const abs = join(ROOT, rel);
    let text = readFileSync(abs, "utf8");
    const reads = findClockReads(text, rel).filter((r) => r.shape === "Date.now()" || r.shape === "new Date()");
    if (!reads.length) continue;
    const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, rel.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const ids = boundIdentifiers(sf);
    let name = "clock";
    if (ids.has("clock")) {
      // Already imports the one clock? Then reuse it.
      const already = sf.statements.some((s) => ts.isImportDeclaration(s) && /utils\/clock["']?$/.test(s.moduleSpecifier.getText(sf).replace(/["']/g, "")) );
      if (!already) {
        if (ids.has("appClock")) { skipped.push(`${rel} (binds clock and appClock)`); continue; }
        name = "appClock";
      }
    }
    // Replace from the end so offsets stay valid.
    const sorted = [...reads].sort((a, b) => b.start - a.start);
    // Drop reads nested inside another converted read (cannot happen for these two shapes, but be safe).
    for (const r of sorted) {
      const rep = r.shape === "Date.now()" ? `${name}.nowMs()` : `${name}.now()`;
      text = text.slice(0, r.start) + rep + text.slice(r.end);
      converted++;
    }
    const hasImport = /from\s+["'][./]*(?:\.\.\/)*(?:[\w./-]*\/)?utils\/clock["']/.test(text) || rel === "server/utils/clock.ts";
    if (!hasImport) {
      let spec = relative(dirname(abs), join(ROOT, "server/utils/clock")).split(sep).join("/");
      if (!spec.startsWith(".")) spec = "./" + spec;
      const line = name === "clock" ? `import { clock } from "${spec}";\n` : `import { clock as appClock } from "${spec}";\n`;
      const sf2 = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, rel.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
      const imports = sf2.statements.filter((s) => ts.isImportDeclaration(s) || ts.isImportEqualsDeclaration(s));
      if (imports.length) {
        const last = imports[imports.length - 1];
        const at = last.getEnd();
        text = text.slice(0, at) + "\n" + line.trimEnd() + text.slice(at);
      } else {
        const first = sf2.statements[0];
        const at = first ? first.getFullStart() : 0;
        // Keep a leading comment block above the import.
        const lead = first ? text.slice(at, first.getStart(sf2)) : "";
        const keep = lead.lastIndexOf("\n") >= 0 ? at + lead.lastIndexOf("\n") + 1 : at;
        text = text.slice(0, keep) + line + text.slice(keep);
      }
    }
    writeFileSync(abs, text);
    changedFiles++;
  }
}
console.log(`use-the-clock: converted ${converted} read(s) in ${changedFiles} file(s); skipped ${skipped.length}`);
for (const s of skipped) console.log("  skipped:", s);
