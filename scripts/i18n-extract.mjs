#!/usr/bin/env node
/**
 * i18n extraction candidate finder.
 *
 * Walks client/src/**\/*.{ts,tsx}, finds string literals that look like
 * hardcoded English UI copy, and writes a ranked CSV of candidates to
 * `./i18n-candidates.csv`.
 *
 * Conservative by design — does NOT modify source files. Used to size
 * the migration ("how many surfaces would extraction touch?") and to
 * pick high-traffic strings for the first batch of keys.
 *
 * Heuristics:
 *   - JSX text nodes: `>Some text<`
 *   - Common stringy props: title=, placeholder=, aria-label=, label=,
 *     description=, headline=, alt=
 *   - Toast / error helpers: toast({ title: "…", description: "…" })
 *
 * Filters out:
 *   - Strings shorter than 3 chars
 *   - Strings without a letter
 *   - All-lowercase identifier-ish strings (className, data-testid)
 *   - Strings inside files under __tests__/ or *.test.tsx
 *
 * Run:  node scripts/i18n-extract.mjs
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "client", "src");

/** Walk a directory recursively, yielding absolute file paths. */
async function* walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "__tests__") continue;
      yield* walk(full);
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      yield full;
    }
  }
}

const PATTERNS = [
  // JSX text node between tags: >Some text< (excludes interpolations)
  { kind: "jsx-text", re: />([^<>{}\n]{3,})</g, captureIdx: 1 },
  // Common stringy JSX props
  { kind: "prop:title", re: /\btitle=["']([^"'\n]{3,})["']/g, captureIdx: 1 },
  { kind: "prop:placeholder", re: /\bplaceholder=["']([^"'\n]{3,})["']/g, captureIdx: 1 },
  { kind: "prop:aria-label", re: /\baria-label=["']([^"'\n]{3,})["']/g, captureIdx: 1 },
  { kind: "prop:label", re: /\blabel=["']([^"'\n]{3,})["']/g, captureIdx: 1 },
  { kind: "prop:description", re: /\bdescription=["']([^"'\n]{3,})["']/g, captureIdx: 1 },
  { kind: "prop:headline", re: /\bheadline=["']([^"'\n]{3,})["']/g, captureIdx: 1 },
  { kind: "prop:alt", re: /\balt=["']([^"'\n]{3,})["']/g, captureIdx: 1 },
];

function looksLikeUiCopy(s) {
  const trimmed = s.trim();
  if (trimmed.length < 3) return false;
  if (!/[A-Za-z]/.test(trimmed)) return false;
  // identifier-ish: camelCase / kebab-case / snake_case with no spaces
  if (!/\s/.test(trimmed) && /^[a-z][a-zA-Z0-9_-]*$/.test(trimmed)) return false;
  // pure numbers / icons / unicode glyphs
  if (/^[\d\s.,%$+-]+$/.test(trimmed)) return false;
  // probable className tokens
  if (/^[a-z][a-z0-9-]*( [a-z][a-z0-9-]*)+$/.test(trimmed)) return false;
  // single tokens that are obviously not copy (acronyms < 3 mixed-case)
  if (trimmed.length <= 4 && trimmed === trimmed.toUpperCase()) return false;
  return true;
}

/** @type {Map<string, { count: number; kinds: Set<string>; files: Set<string> }>} */
const candidates = new Map();

for await (const file of walk(ROOT)) {
  const src = await fs.readFile(file, "utf8");
  for (const { kind, re, captureIdx } of PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src)) !== null) {
      const raw = m[captureIdx];
      if (!looksLikeUiCopy(raw)) continue;
      const key = raw.trim();
      const slot = candidates.get(key) ?? {
        count: 0,
        kinds: new Set(),
        files: new Set(),
      };
      slot.count += 1;
      slot.kinds.add(kind);
      slot.files.add(path.relative(ROOT, file));
      candidates.set(key, slot);
    }
  }
}

const ranked = Array.from(candidates.entries())
  .map(([text, info]) => ({
    text,
    count: info.count,
    kinds: Array.from(info.kinds).sort().join("|"),
    files: info.files.size,
    firstFile: Array.from(info.files)[0],
  }))
  .sort((a, b) => b.count - a.count);

const escape = (s) => `"${String(s).replace(/"/g, '""')}"`;
const csv = [
  ["text", "count", "files", "kinds", "firstFile"].join(","),
  ...ranked.map((r) => [escape(r.text), r.count, r.files, escape(r.kinds), escape(r.firstFile)].join(",")),
].join("\n");

const out = path.resolve(__dirname, "..", "i18n-candidates.csv");
await fs.writeFile(out, csv, "utf8");

const total = ranked.length;
const top10 = ranked.slice(0, 10);
console.log(`i18n extraction candidates: ${total} unique strings`);
console.log(`wrote ${out}`);
console.log("\nTop 10 by occurrence:");
for (const r of top10) {
  console.log(`  ${String(r.count).padStart(4)}  ${r.text.slice(0, 80)}`);
}
