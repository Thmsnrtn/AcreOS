#!/usr/bin/env node
// ============================================================================
// scripts/lint-unchecked-mutation.mjs — the UI may not report an effect it
// did not have.
// ----------------------------------------------------------------------------
// THE RULE ALREADY EXISTS; THE POPULATION DID NOT
//
// CLAUDE.md's standing rule is "Fabrication is never acceptable … no fake
// activity". The server side of it is enforced: `paxToolsReportRealEffects`
// exists because `schedule_background_job` told a customer their campaign was
// queued and queued nothing.
//
// That gate's population is SERVER TOOL SWITCHES. No gate had ever read a
// CLIENT mutation handler — and the client had the same defect, 28 times:
//
//     await fetch(url, { method: "DELETE" });          // result discarded
//     onSuccess: () => qc.invalidateQueries(...)       // runs anyway
//
// react-query cannot distinguish a 403 from a 204 when the mutationFn resolves
// either way. So onSuccess ran, the cache was invalidated, and the row the
// customer had just deleted reappeared with no error anywhere. Worse shapes
// found: `catch {}` swallowing a failed dismiss; `res.json()` on an unchecked
// response parsing an ERROR body as a result, so a failed lender match rendered
// as "no lenders matched" and a failed syndication toasted "Syndicated to 0/3
// platforms"; and an Undo button that left the customer believing they had
// undone a deletion that is still a deletion.
//
// WHAT THIS ENFORCES
//
// A mutating `fetch()` in client/src must either
//   (a) check its own response — `res.ok`, `res.status`, or go through
//       `apiRequest`, which throws on a non-OK status; or
//   (b) carry an `// unchecked-mutation: <reason>` marker saying why not.
//
// (b) is not a loophole, it is the point. Some mutations genuinely must not
// throw: error telemetry reported from inside an error boundary, a logout that
// has to proceed whatever the server says, and the Clerk session refresh that
// `apiRequest` ITSELF calls on a 401 — routing that through apiRequest would
// recurse. What the marker forbids is doing it by accident. Twelve calls carry
// one; each names its reason.
// ============================================================================

import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const SRC = join(ROOT, "client", "src");
const MARKER = "unchecked-mutation:";

/** Walk from an opening paren to its match. */
function matchParen(src, open) {
  let depth = 0;
  let quote = null;
  let prev = "";
  for (let i = open; i < src.length; i += 1) {
    const ch = src[i];
    if (quote) {
      if (ch === quote && prev !== "\\") quote = null;
    } else if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if (ch === "(") depth += 1;
    else if (ch === ")") {
      depth -= 1;
      if (depth === 0) return i;
    }
    prev = ch;
  }
  return -1;
}

let scannedFiles = 0;
let mutations = 0;
let checked = 0;
let marked = 0;
const offenders = [];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full, { throwIfNoEntry: false });
    if (!st) continue;
    if (st.isDirectory()) {
      if (entry !== "node_modules" && entry !== "__tests__") walk(full);
      continue;
    }
    if (!/\.(tsx|ts)$/.test(entry) || /\.(test|spec)\.tsx?$/.test(entry)) continue;
    scannedFiles += 1;
    const text = readFileSync(full, "utf8");
    for (const m of text.matchAll(/\bfetch\s*\(/g)) {
      const open = text.indexOf("(", m.index);
      const close = matchParen(text, open);
      if (close === -1) continue;
      const call = text.slice(m.index, close + 1);
      if (!/method:\s*["'](POST|PUT|PATCH|DELETE)["']/.test(call)) continue;
      mutations += 1;

      // (a) does it check its own response?
      const before = text.slice(Math.max(0, m.index - 60), m.index);
      const bound = /(?:const|let)\s+(\w+)\s*=\s*(?:await\s+)?$/.exec(before);
      const window = text.slice(m.index, m.index + 3000);
      if (bound && new RegExp(`\\b${bound[1]}\\.(ok|status)\\b`).test(window)) {
        checked += 1;
        continue;
      }
      if (/\.then\s*\(\s*\(?\s*(\w+)\s*\)?\s*=>\s*[^)]*\.\s*(ok|status)\b/.test(text.slice(close, close + 400))) {
        checked += 1;
        continue;
      }

      // (b) is it marked, on the call or within the three lines above it?
      const lineNo = text.slice(0, m.index).split("\n").length;
      const lines = text.split("\n");
      const nearby = lines.slice(Math.max(0, lineNo - 4), lineNo).join("\n");
      if (nearby.includes(MARKER)) {
        marked += 1;
        continue;
      }

      offenders.push({ file: relative(ROOT, full), line: lineNo });
    }
  }
}

walk(SRC);

// ── vacuity floors ───────────────────────────────────────────────────────────
const FILE_FLOOR = 400;      // 868 measured 2026-09-04
const MUTATION_FLOOR = 100;  // 212 measured 2026-09-04
for (const [what, got, floor] of [
  ["client files", scannedFiles, FILE_FLOOR],
  ["mutating fetch() calls", mutations, MUTATION_FLOOR],
]) {
  if (got < floor) {
    console.error(
      `[lint-unchecked-mutation] FAIL (VACUITY GUARD) — found only ${got} ${what} ` +
        `(floor ${floor}). A scanner that sees nothing certifies everything. Find out ` +
        `why it stopped matching; do NOT lower this floor.`,
    );
    process.exit(1);
  }
}

console.log(
  `[lint-unchecked-mutation] ${scannedFiles} client files, ${mutations} mutating fetch() ` +
    `calls: ${checked} check their response, ${marked} deliberately do not (marked with a reason)`,
);

if (offenders.length > 0) {
  console.error("");
  console.error(
    "[lint-unchecked-mutation] FAIL — these mutations discard their response. A 403 " +
      "resolves exactly like a 204, so onSuccess runs, the cache is invalidated, and the " +
      "customer is shown an effect that did not happen:",
  );
  console.error("");
  for (const o of offenders) console.error(`  ${o.file}:${o.line}`);
  console.error("");
  console.error(
    "  Route it through `apiRequest(method, url, body)` from @/lib/queryClient — it " +
      "throws on a non-OK status, so react-query reaches onError — or, if it genuinely " +
      "must not throw (telemetry, logout, the Clerk refresh apiRequest itself calls), " +
      `add a \`// ${MARKER} <reason>\` comment above it saying which and why.`,
  );
  process.exit(1);
}

console.log("[lint-unchecked-mutation] PASS — every client mutation either checks its response or says why not.");
