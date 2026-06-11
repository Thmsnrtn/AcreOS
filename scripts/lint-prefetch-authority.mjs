#!/usr/bin/env node
// ============================================================================
// scripts/lint-prefetch-authority.mjs — prefetchRoute single-authority lint.
// ----------------------------------------------------------------------------
// T3-3C (B3). `prefetchRoute` (client/src/lib/queryClient.ts) is the ONLY
// sanctioned cache-warmer: it normalizes the paginated `{data}` envelope to a
// flat array before caching for the array-contract keys (/api/leads etc.).
// Calling `queryClient.prefetchQuery(...)` / `.prefetchInfiniteQuery(...)`
// directly with the default fetcher caches the RAW envelope under the bare key
// and crashes any consumer expecting a flat array while the entry is fresh
// (`leads.forEach is not a function` → 500 boundary). This envelope-poisoning
// regression shipped TWICE (the sidebar handlePrefetch, then the focus-on-
// link-click path — see the dated comments in queryClient.ts + prefetch-link.tsx).
//
// Project memory long claimed this discipline was "ratchet-enforced"; it was
// only a code-comment convention. This lint makes the claim true: zero
// tolerance — `prefetchQuery(` / `prefetchInfiniteQuery(` may appear ONLY in
// the authority file. Any other call site is a build failure.
//
//   0 call sites outside the authority → PASS
//   >0                                 → FAIL (route the warm through prefetchRoute)
//
// Matches a real CALL: `.prefetchQuery(` / `.prefetchInfiniteQuery(`. Comment
// lines (// or *-prefixed) are skipped so the explanatory comments that name
// the banned API in queryClient.ts + prefetch-link.tsx don't trip the lint.
// ============================================================================

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SCAN_DIR = join(ROOT, "client", "src");
// The single authority — the one file allowed to call prefetchQuery directly.
const AUTHORITY = join("client", "src", "lib", "queryClient.ts");

// A real call to the banned APIs (method-call form, after a dot).
const CALL_RE = /\.prefetch(?:Infinite)?Query\s*\(/;
const COMMENT_RE = /^\s*(\/\/|\*|\/\*)/;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      walk(full, out);
    } else if (/\.tsx?$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const offenders = [];
let scanned = 0;

for (const file of walk(SCAN_DIR)) {
  const rel = relative(ROOT, file);
  if (rel === AUTHORITY) continue; // the authority is allowed to call it
  scanned++;
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    if (COMMENT_RE.test(line)) return;
    if (CALL_RE.test(line)) {
      offenders.push(`${rel}:${i + 1}  ${line.trim().slice(0, 100)}`);
    }
  });
}

console.log(
  `[lint-prefetch-authority] scanned ${scanned} client files; direct prefetchQuery call sites outside the authority: ${offenders.length}`,
);

if (offenders.length > 0) {
  console.error(
    `[lint-prefetch-authority] FAIL — prefetchQuery/prefetchInfiniteQuery may only be called in ${AUTHORITY}.\n` +
      `  Route every cache-warm through prefetchRoute(key, staleTime) — it normalizes the paginated\n` +
      `  envelope to a flat array, avoiding the "leads.forEach is not a function" envelope-poisoning crash.\n` +
      offenders.map((o) => `  • ${o}`).join("\n"),
  );
  process.exit(1);
}

console.log("[lint-prefetch-authority] PASS");
