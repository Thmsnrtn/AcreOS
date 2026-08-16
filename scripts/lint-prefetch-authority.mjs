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
//
// ----------------------------------------------------------------------------
// VACUITY GUARD — this gate is ZERO-TOLERANCE, which is exactly why it needs one
// ----------------------------------------------------------------------------
// The sibling ratchets in this family (lint-zindex, lint-css-hover,
// check-org-scoped-fetch) carry a per-file BASELINE map, and their stale-entry
// check gives them accidental, partial vacuity protection: a scan that goes
// blind leaves every baselined file unseen, so the gate fails "stale baseline
// entries" instead of printing PASS. THIS gate has no baseline map at all — it
// is zero-tolerance by design — so it has no stale-entry backstop either.
// Its ONLY output over an empty walk is:
//
//     [lint-prefetch-authority] scanned 0 client files; direct prefetchQuery
//     call sites outside the authority: 0
//     [lint-prefetch-authority] PASS
//
// A totally blind gate, exit 0, with the number that proves it blind printed
// right there and compared against nothing. So three checks run BEFORE any
// verdict is allowed to print:
//
//   1. POPULATION FLOOR on the client files walked. Measured 2026-08-16:
//      873 non-test .ts/.tsx files under client/src excluding the authority
//      (874 including it) → floor 650 (~74% of live). A broken walk, a renamed
//      client/src, or a rotted extension filter trips it; ordinary deletion
//      does not. A MISSING floor fails as loudly as a breached one — the guard
//      must not be removable by deleting a line.
//   2. AUTHORITY SEEN. The walk must actually reach client/src/lib/queryClient.ts.
//      A gate that cannot see its own authority is not checking anything: the
//      whole rule is "this symbol belongs HERE and nowhere else", and if the
//      walk never visits HERE, the `rel === AUTHORITY` skip is dead code and
//      the scoping claim is unverified. This also catches the authority being
//      moved or renamed without updating this file — in which case the real
//      authority is silently being LINTED as an offender, or worse, is outside
//      the walk entirely.
//   3. PREDICATE CANARY. The authority must still contain at least one real
//      (non-comment) `.prefetchQuery(` / `.prefetchInfiniteQuery(` call, so
//      CALL_RE is proved live against real code in the tree. Measured
//      2026-08-16: exactly 1 (queryClient.ts:590, inside prefetchRoute). If
//      React Query renames the API, or the regex rots, "0 call sites outside
//      the authority" becomes true for the wrong reason and this gate stops
//      protecting anything. Without a canary, "0 offenders" and "0 files read"
//      are indistinguishable.
// ============================================================================

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SCAN_DIR = join(ROOT, "client", "src");
// The single authority — the one file allowed to call prefetchQuery directly.
const AUTHORITY = join("client", "src", "lib", "queryClient.ts");

// Measured 2026-08-16 (see header). Set ~74% below live so a broken walk trips
// it and ordinary deletion does not. Never raise it to silence something; never
// delete the constant. If a real deletion wave takes the population under this
// floor, lower it in the SAME commit and record the new measurement above.
const MIN_CLIENT_FILES = 650; // live: 873 scanned (874 incl. the authority)

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
let authoritySeen = false;
let authorityCalls = 0;

for (const file of walk(SCAN_DIR)) {
  const rel = relative(ROOT, file);
  if (rel === AUTHORITY) {
    // The authority is allowed to call it — but the walk MUST have reached it,
    // and its own call sites are the canary that CALL_RE still matches code.
    authoritySeen = true;
    authorityCalls = readFileSync(file, "utf8")
      .split("\n")
      .filter((line) => !COMMENT_RE.test(line) && CALL_RE.test(line)).length;
    continue;
  }
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
  `[lint-prefetch-authority] scanned ${scanned} client files (floor ${MIN_CLIENT_FILES}); ` +
    `authority seen: ${authoritySeen ? "yes" : "NO"} with ${authorityCalls} sanctioned call site(s); ` +
    `direct prefetchQuery call sites outside the authority: ${offenders.length}`,
);

// ── Vacuity guard, BEFORE any verdict ───────────────────────────────────────
const vacuity = [];
if (typeof MIN_CLIENT_FILES !== "number" || !Number.isInteger(MIN_CLIENT_FILES) || MIN_CLIENT_FILES < 1) {
  vacuity.push(
    `MIN_CLIENT_FILES must be an integer >= 1 (got ${JSON.stringify(MIN_CLIENT_FILES)}). ` +
      `A missing or zero floor is not a floor — it admits the empty scan this guard exists to catch.`,
  );
} else if (scanned < MIN_CLIENT_FILES) {
  vacuity.push(
    `VACUOUS SCAN — only ${scanned} client file(s) walked under ${relative(ROOT, SCAN_DIR)} ` +
      `(floor ${MIN_CLIENT_FILES}). "0 call sites" over a collapsed population is not a clean ` +
      `bill of health. Suspect the walk, a moved client/src, or the extension filter before you ` +
      `suspect progress. If a real deletion wave shrank this, lower MIN_CLIENT_FILES in ` +
      `scripts/lint-prefetch-authority.mjs in the SAME commit and name the wave.`,
  );
}
if (!authoritySeen) {
  vacuity.push(
    `AUTHORITY NOT SEEN — the walk never reached ${AUTHORITY}. A gate that cannot see its own ` +
      `authority is not checking anything: the rule is "prefetchQuery belongs HERE and nowhere ` +
      `else", and HERE was never visited. Either the authority moved/was renamed without ` +
      `updating AUTHORITY in this file (in which case the real authority is now being linted as ` +
      `an offender, or is outside the walk entirely), or the walk is broken.`,
  );
} else if (authorityCalls < 1) {
  vacuity.push(
    `PREDICATE CANARY DEAD — ${AUTHORITY} contains no non-comment ` +
      `\`.prefetchQuery(\`/\`.prefetchInfiniteQuery(\` call, so CALL_RE is no longer proved ` +
      `against real code (measured 1 on 2026-08-16, at queryClient.ts:590 inside prefetchRoute). ` +
      `Either prefetchRoute stopped using the API this lint is scoping — in which case there is ` +
      `nothing left to scope and this gate should be retired deliberately, not left passing ` +
      `vacuously — or the regex has rotted and every "0 offenders" below is meaningless.`,
  );
}

if (vacuity.length > 0) {
  console.error("[lint-prefetch-authority] FAIL — the gate itself is not trustworthy right now:");
  for (const v of vacuity) console.error(`  ✗ ${v}`);
  if (offenders.length > 0) {
    console.error(
      `  (${offenders.length} offender(s) were also matched, but the population is ` +
        `untrustworthy — fix the scan first.)`,
    );
  }
  process.exit(1);
}

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
