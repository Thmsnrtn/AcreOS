#!/usr/bin/env node
// ============================================================================
// scripts/check-boundaries.mjs
// ----------------------------------------------------------------------------
// Import-boundary lint (elevation blueprint 1C) — same lightweight-scanner
// shape as check-org-leading-index.mjs / check-no-fabrication.mjs. No
// dependency-cruiser, no TypeScript program — a focused regex pass over
// import/export/require specifiers.
//
// Rules enforced
// ──────────────
//   shared/**  (consumed by BOTH the client bundle and the server)
//     S1. must not import server code (relative paths resolving into server/,
//         or a bare "server/…" specifier).
//     S2. must not import Node-only builtin modules (fs, child_process,
//         crypto, …, or anything with the node: prefix). Rollup can't resolve
//         these in the client bundle; shared/ must stay isomorphic.
//     S3. must not import server-only path aliases — aliases that exist in
//         tsconfig.json (server esbuild reads it) but NOT in vite.config.ts
//         (client). Today that's "@sovereign/*". This is exactly the class of
//         break that forced solene-constitutional-violations out of the
//         shared/schema.ts barrel; the live offender was moved server-side
//         (server/services/solene/constitutionalGuard.ts) when this lint
//         landed.
//
//   client/src/**
//     C1. must not import server code (relative or bare "server/…").
//     C2. must not import server-only aliases ("@sovereign/*").
//
// Baseline allowlist
// ──────────────────
// shared/seo/content-routes.ts legitimately uses fs/child_process/path/url —
// it is BUILD-TIME tooling (consumed only by script/generate-sitemap.ts and a
// unit test, never bundled into the client). It is frozen as the baseline.
// New entries require Iris-CTO sign-off; the list only ratchets DOWN (a stale
// entry — file deleted or imports cleaned up — FAILS the lint so the
// allowlist can't rot).
//
// VACUITY FLOORS — why a zero here needs a population behind it
// ─────────────────────────────────────────────────────────────
// This gate counts BAD THINGS FOUND, so a scan that stops seeing files finds
// none and prints PASS. `walkSourceFiles()` returns its accumulator unchanged
// when a directory is missing, and the extension/test filters can narrow to
// nothing after a rename — either way the run reads exactly like compliance.
//
// The stale-baseline backstop does NOT cover this, and the reason is specific:
// BASELINE has exactly ONE entry (shared/seo/content-routes.ts), and it lives
// in the shared/ half. So shared/ going dark is caught by that entry going
// stale, while the ENTIRE client/src/ half could go dark and the gate would
// still pass on the strength of the one shared/ hit. Half a scan, full PASS.
//
// So each zone's file population is floored INDEPENDENTLY, and the floors are
// evaluated BEFORE any count is allowed to read as clean. Independence is the
// whole point: one floor over the combined 1,030 would let the 872-file client
// half vanish entirely and still sit above any floor the 158-file shared half
// could justify. A MISSING floor fails as loudly as a breached one (see
// scripts/ratchets/reachability.json `minima`), so a zone cannot be added here
// without one.
//
// Floors are NOT ratchets — they exist to catch a broken scan, not to forbid
// deletion. Seeded at ~75% of live so a broken walk trips them while ordinary
// file deletion does not. If a real deletion wave takes a population under its
// floor, LOWER the floor in the same commit and name the wave; never raise one
// to silence anything, and never delete a key.
//
// Exit codes
// ──────────
//   0 — no violations outside the baseline, no stale baseline entries, and
//       every zone population at or above its floor
//   1 — at least one new violation OR a stale baseline entry OR a zone
//       population below its floor OR a zone with no floor declared
// ============================================================================

import { readFileSync, readdirSync, lstatSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, relative, posix } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");

// ----------------------------------------------------------------------------
// Baseline allowlist — file (repo-relative, posix) → Set of rule ids the file
// is allowed to violate. Curated 2026-06-10 (Tier 1C). Ratchets DOWN only.
// ----------------------------------------------------------------------------
const BASELINE = new Map([
  // Build-time SEO tooling: reads content/learn JSON + git timestamps to
  // generate sitemap.xml. Never imported by client or server runtime code.
  ["shared/seo/content-routes.ts", new Set(["node-builtin"])],
]);

// Node builtin modules (bare names; the node: prefix is matched separately).
const NODE_BUILTINS = new Set([
  "assert", "async_hooks", "buffer", "child_process", "cluster", "console",
  "constants", "crypto", "dgram", "diagnostics_channel", "dns", "domain",
  "events", "fs", "http", "http2", "https", "inspector", "module", "net",
  "os", "path", "perf_hooks", "process", "punycode", "querystring",
  "readline", "repl", "stream", "string_decoder", "timers", "tls",
  "trace_events", "tty", "url", "util", "v8", "vm", "worker_threads", "zlib",
]);

// Aliases resolvable by the server build (tsconfig paths → esbuild) but NOT
// by the client build (vite.config.ts resolve.alias). Keep in sync with both
// configs when aliases change.
const SERVER_ONLY_ALIAS_PREFIXES = ["@sovereign/"];

// ----------------------------------------------------------------------------
// The two scanned zones, and the VACUITY FLOOR under each one's file
// population. See the "VACUITY FLOORS" section of the header for why these are
// per-zone rather than one floor over the total.
//
// MEASURED 2026-08-16 against the live repo, by running this script and reading
// the population line it already prints:
//
//   [check-boundaries] scanned 158 shared/ + 872 client/src/ files; …
//
//   shared/     observed 158  → floor 118  (~75% of live)
//   client/src/ observed 872  → floor 654  (~75% of live)
//
// Re-measure before touching these; do not re-argue them from memory.
// ----------------------------------------------------------------------------
const ZONES = [
  { id: "shared", label: "shared/", segments: ["shared"], floor: 118 },
  { id: "client", label: "client/src/", segments: ["client", "src"], floor: 654 },
];

// ----------------------------------------------------------------------------
// File discovery
// ----------------------------------------------------------------------------
function isTestFile(name) {
  return (
    name.endsWith(".test.ts") || name.endsWith(".spec.ts") ||
    name.endsWith(".test.tsx") || name.endsWith(".spec.tsx")
  );
}

function walkSourceFiles(dir, out) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    // lstat: never follow symlinks (avoids self-referential link loops).
    const st = lstatSync(full);
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) {
      walkSourceFiles(full, out);
    } else if (
      (entry.endsWith(".ts") || entry.endsWith(".tsx")) &&
      !entry.endsWith(".d.ts") &&
      !isTestFile(entry) &&
      !entry.endsWith(".bak")
    ) {
      out.push(full);
    }
  }
  return out;
}

// ----------------------------------------------------------------------------
// Import-specifier extraction
// ----------------------------------------------------------------------------
// Strip block comments + pure comment lines so documentation that MENTIONS an
// import path (e.g. the shared/schema.ts barrel note) doesn't register.
function stripComments(source) {
  const noBlocks = source.replace(/\/\*[\s\S]*?\*\//g, "");
  return noBlocks
    .split("\n")
    .map((line) => {
      const t = line.trimStart();
      if (t.startsWith("//") || t.startsWith("*")) return "";
      return line;
    })
    .join("\n");
}

// Matches: import … from "x" | export … from "x" | import "x" |
//          import("x") | require("x")
const SPEC_RE =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)["']([^"']+)["']/g;

function extractSpecifiers(source) {
  const specs = [];
  const clean = stripComments(source);
  const lines = clean.split("\n");
  for (let i = 0; i < lines.length; i++) {
    let m;
    SPEC_RE.lastIndex = 0;
    while ((m = SPEC_RE.exec(lines[i])) !== null) {
      specs.push({ spec: m[1], line: i + 1 });
    }
  }
  // Multi-line `import {\n …\n} from "x"` — the `from "x"` part is on its own
  // line and is caught by the per-line pass above (the regex doesn't require
  // the `import` keyword on the same line).
  return specs;
}

// ----------------------------------------------------------------------------
// Rule evaluation
// ----------------------------------------------------------------------------
function classify(spec, fileAbs, zone) {
  // zone: "shared" | "client"
  const violations = [];

  // node: prefix or bare builtin (with or without subpath, e.g. fs/promises)
  const bare = spec.split("/")[0];
  const isNodeBuiltin =
    spec.startsWith("node:") || NODE_BUILTINS.has(bare === "" ? spec : bare) ||
    NODE_BUILTINS.has(spec);
  if (zone === "shared" && isNodeBuiltin) {
    violations.push({ rule: "node-builtin", detail: spec });
  }

  // server-only aliases
  for (const prefix of SERVER_ONLY_ALIAS_PREFIXES) {
    if (spec === prefix.slice(0, -1) || spec.startsWith(prefix)) {
      violations.push({ rule: "server-only-alias", detail: spec });
    }
  }

  // server code: bare "server/…" or a relative path resolving into <repo>/server
  if (spec === "server" || spec.startsWith("server/")) {
    violations.push({ rule: "server-import", detail: spec });
  } else if (spec.startsWith(".")) {
    const resolved = resolve(dirname(fileAbs), spec);
    const rel = relative(REPO_ROOT, resolved);
    if (rel === "server" || rel.startsWith("server/") || rel.startsWith(`server${posix.sep}`)) {
      violations.push({ rule: "server-import", detail: spec });
    }
  }

  return violations;
}

// ----------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------
/**
 * VACUITY GUARD — floor each zone's file population INDEPENDENTLY, and treat a
 * zone with no declared floor as a failure (an unfloored population cannot
 * exist, by design). Returns a list of failure strings; empty means the scan
 * saw enough of the tree for its zeros to mean anything.
 */
function checkZonePopulations(populations) {
  const failures = [];
  for (const zone of ZONES) {
    const count = populations.get(zone.id);
    if (typeof zone.floor !== "number" || !Number.isFinite(zone.floor)) {
      failures.push(
        `NO FLOOR DECLARED for zone "${zone.id}" (${zone.label}) — an unfloored ` +
          `population can go to zero silently and the gate would still PASS. ` +
          `Measure the live count and add a floor at ~75% of it.`,
      );
      continue;
    }
    if (count === undefined) {
      failures.push(
        `ZONE NOT SCANNED — "${zone.id}" (${zone.label}) produced no population ` +
          `at all. The walk never ran for this zone.`,
      );
      continue;
    }
    if (count < zone.floor) {
      failures.push(
        `VACUOUS SCAN — ${zone.label} yielded only ${count} file(s) (floor ` +
          `${zone.floor}). walkSourceFiles() returns its accumulator unchanged ` +
          `for a missing directory, so a moved/renamed root or a broken ` +
          `extension filter shows up here as a small number and everywhere ` +
          `else as "0 violations". If a real deletion wave earned this drop, ` +
          `lower this zone's floor in the same commit and name the wave — do ` +
          `NOT raise it, and do not remove it.`,
      );
    }
  }
  return failures;
}

function main() {
  const zoneFiles = new Map();
  const populations = new Map();
  for (const zone of ZONES) {
    const files = walkSourceFiles(join(REPO_ROOT, ...zone.segments), []);
    zoneFiles.set(zone.id, files);
    populations.set(zone.id, files.length);
  }
  const sharedFiles = zoneFiles.get("shared");
  const clientFiles = zoneFiles.get("client");

  const newViolations = [];
  const baselineHits = new Map(); // file → Set(rules actually seen)

  function scan(files, zone) {
    for (const abs of files) {
      const rel = relative(REPO_ROOT, abs).split("\\").join("/");
      const source = readFileSync(abs, "utf8");
      for (const { spec, line } of extractSpecifiers(source)) {
        for (const v of classify(spec, abs, zone)) {
          const allowed = BASELINE.get(rel);
          if (allowed && allowed.has(v.rule)) {
            if (!baselineHits.has(rel)) baselineHits.set(rel, new Set());
            baselineHits.get(rel).add(v.rule);
          } else {
            newViolations.push({ file: rel, line, ...v, zone });
          }
        }
      }
    }
  }

  scan(sharedFiles, "shared");
  scan(clientFiles, "client");

  // Stale baseline entries: file gone or rule no longer violated → must be
  // removed so the allowlist only shrinks.
  const staleBaseline = [];
  for (const [file, rules] of BASELINE) {
    const seen = baselineHits.get(file) ?? new Set();
    for (const rule of rules) {
      if (!seen.has(rule)) staleBaseline.push(`${file} (${rule})`);
    }
  }

  // Vacuity floors are evaluated BEFORE the verdict: a count of zero from a
  // half-blind scan must never be allowed to read as clean.
  const vacuityFailures = checkZonePopulations(populations);

  console.log(
    `[check-boundaries] scanned ${sharedFiles.length} shared/ ` +
      `(floor ${ZONES[0].floor}) + ` +
      `${clientFiles.length} client/src/ (floor ${ZONES[1].floor}) files; ` +
      `baseline-allowlisted files: ${baselineHits.size}; ` +
      `new violations: ${newViolations.length}; ` +
      `stale baseline entries: ${staleBaseline.length}`,
  );

  if (
    vacuityFailures.length === 0 &&
    newViolations.length === 0 &&
    staleBaseline.length === 0
  ) {
    console.log("[check-boundaries] PASS");
    process.exit(0);
  }

  if (vacuityFailures.length > 0) {
    console.error("");
    console.error(
      `[check-boundaries] FAIL — ${vacuityFailures.length} zone population ` +
        "problem(s); this gate is not trustworthy right now:",
    );
    for (const f of vacuityFailures) console.error(`  ✗ ${f}`);
    console.error("");
    console.error(
      "  Each zone is floored SEPARATELY on purpose. The baseline allowlist has",
    );
    console.error(
      "  a single entry and it sits in shared/, so a stale-baseline failure can",
    );
    console.error(
      "  only ever notice shared/ going dark — the whole client/src/ half could",
    );
    console.error(
      "  vanish and every other count below would still print a reassuring 0.",
    );
  }

  if (newViolations.length > 0) {
    console.error("");
    console.error(
      `[check-boundaries] FAIL — ${newViolations.length} boundary violation(s):`,
    );
    for (const v of newViolations) {
      console.error(
        `  • ${v.file}:${v.line} [${v.zone}/${v.rule}] imports "${v.detail}"`,
      );
    }
    console.error("");
    console.error("Rules:");    console.error(
      "  shared/ must stay isomorphic — no server code, no Node builtins, no",
    );
    console.error(
      "  server-only aliases (@sovereign/*). client/src/ must never import",
    );
    console.error(
      "  server code or server-only aliases. Move the dependency to the",
    );
    console.error(
      "  server side (see constitutionalGuard.ts for the pattern) or hoist",
    );
    console.error(
      "  the truly-shared part into a pure module. Allowlisting requires",
    );
    console.error("  Iris-CTO sign-off (BASELINE in this script).");
  }

  if (staleBaseline.length > 0) {
    console.error("");
    console.error(
      `[check-boundaries] FAIL — ${staleBaseline.length} stale baseline ` +
        "entry(ies) (the violation no longer exists — remove the entry so " +
        "the ratchet stays tight):",
    );
    for (const s of staleBaseline) console.error(`  • ${s}`);
  }

  process.exit(1);
}

main();
