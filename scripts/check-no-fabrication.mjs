#!/usr/bin/env node
// ============================================================================
// scripts/check-no-fabrication.mjs
// ----------------------------------------------------------------------------
// Truth-immutable CI lint — a RATCHET (same discipline shape as
// check-org-leading-index.mjs) that flags non-deterministic value sources
// (`Math.random()`) inside the server paths that can produce customer-visible
// FACTS, so a NEW fabricated metric can never silently ship.
//
// Why
// ───
// AcreOS sells truth. A dashboard number, a skip-trace phone, a deal-velocity
// stat, a freedom-score projection — these are facts the customer acts on. If
// any of them is `Math.floor(Math.random() * …)`, we are lying with a
// confident UI. This session found several live fabrications. We cannot fix
// them all in one PR (other agents own the actual data wiring), but we CAN
// freeze the known set and make the build FAIL the instant a NEW one appears.
//
// Heuristic (deliberately conservative — false positives are cheap to
// allowlist, false negatives ship a lie)
// ─────────────────────────────────────
//   1. Scan a fixed set of server paths that emit customer-facing data:
//        - server/routes-*.ts        (HTTP responses)
//        - server/storage.ts         (the data-access layer)
//        - server/services/**/*.ts   (business logic feeding responses)
//      Tests (*.test.ts / *.spec.ts) are excluded.
//   2. Report every `Math.random` occurrence as file:line.
//      (We do NOT regex-classify "is this a fact vs an id" — that judgment
//       lives in the human-curated allowlist. The lint just enumerates.)
//   3. Every CURRENT occurrence is covered by the allowlist
//      (scripts/no-fabrication.allowlist.json), each annotated as either a
//      legitimate use (id/jitter/sampling/shuffle/weighted-pick) or
//      `P0-FIX-PENDING` (a real fabrication awaiting its owning agent's fix).
//   4. The lint PASSES today (allowlist == current state) and FAILS on:
//        - any NEW `Math.random` hit not in the allowlist, OR
//        - any STALE allowlist entry (a hit that no longer exists), so the
//          ratchet is enforced in both directions and the allowlist can only
//          shrink as fabrications get fixed.
//
// Note on Date.now()/new Date()
// ─────────────────────────────
// `Date.now()` and `new Date()` are overwhelmingly legitimate (timestamps,
// ids, TTLs, jitter) and flagging every one would bury the signal. The brief
// calls out "Date.now()/new Date() used AS data" — that pattern is almost
// always paired with a Math.random() in the same fabricated object (see the
// freedom-snapshot nextPaymentDate), so the Math.random scan already catches
// those call sites. We intentionally do NOT scan bare Date.now()/new Date()
// to keep the ratchet's false-positive rate near zero. If a pure-Date-based
// fabrication ever appears without an adjacent Math.random, raise it to Iris
// and we'll extend the heuristic with a targeted pattern.
//
// Allowlist entry shape (scripts/no-fabrication.allowlist.json):
//   { "file": "server/...", "line": <int>, "category": "id|jitter|sampling|
//        shuffle|weighted-pick|backoff|P0-FIX-PENDING", "note": "..." }
//
// As the P0 fabrication fixes land, the owning agent (or Solene's integration
// follow-up) removes the corresponding `P0-FIX-PENDING` entries here. A fixed
// call site disappears from the scan → the now-stale allowlist entry FAILS the
// lint → forces the entry's removal. The ratchet only goes DOWN.
//
// Exit codes
// ──────────
//   0 — every current hit is allowlisted and no allowlist entry is stale
//   1 — at least one NEW unallowlisted hit, OR a stale allowlist entry
// ============================================================================

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, relative } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");
const SERVER_DIR = join(REPO_ROOT, "server");
const SERVICES_DIR = join(SERVER_DIR, "services");
const ALLOWLIST_PATH = join(__dirname, "no-fabrication.allowlist.json");

// The non-deterministic source we flag. Kept as a single token so the message
// is precise; broaden deliberately (with allowlist coverage) if needed.
const FORBIDDEN_TOKEN = "Math.random";

// ----------------------------------------------------------------------------
// File discovery — exactly the customer-fact-producing surface.
// ----------------------------------------------------------------------------
function isTestFile(name) {
  return name.endsWith(".test.ts") || name.endsWith(".spec.ts");
}

function walkTsFiles(dir, out) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walkTsFiles(full, out);
    } else if (entry.endsWith(".ts") && !isTestFile(entry)) {
      out.push(full);
    }
  }
}

function findScannedFiles() {
  const files = [];
  // server/routes-*.ts
  for (const entry of readdirSync(SERVER_DIR)) {
    if (!entry.startsWith("routes-") || !entry.endsWith(".ts")) continue;
    if (isTestFile(entry)) continue;
    files.push(join(SERVER_DIR, entry));
  }
  // server/storage.ts
  const storage = join(SERVER_DIR, "storage.ts");
  if (existsSync(storage)) files.push(storage);
  // server/services/**/*.ts
  walkTsFiles(SERVICES_DIR, files);
  return files.sort();
}

// ----------------------------------------------------------------------------
// Scan — enumerate every Math.random hit as { file, line }.
// We skip occurrences inside line comments that merely MENTION the token
// (e.g. "Stable across runs (no Math.random)") so documentation doesn't
// register as a hit. A line counts only if the token appears outside a
// leading `//` comment OR appears before a trailing `//` on a code line.
// ----------------------------------------------------------------------------
function scanFile(absPath) {
  const rel = relative(REPO_ROOT, absPath);
  const lines = readFileSync(absPath, "utf8").split("\n");
  const hits = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const idx = raw.indexOf(FORBIDDEN_TOKEN);
    if (idx === -1) continue;
    // Determine if the token is inside a comment.
    const commentIdx = raw.indexOf("//");
    const trimmed = raw.trimStart();
    const isPureComment = trimmed.startsWith("//") || trimmed.startsWith("*");
    const isAfterComment = commentIdx !== -1 && commentIdx < idx;
    if (isPureComment || isAfterComment) continue;
    hits.push({ file: rel, line: i + 1 });
  }
  return hits;
}

// ----------------------------------------------------------------------------
// Allowlist
// ----------------------------------------------------------------------------
function loadAllowlist() {
  if (!existsSync(ALLOWLIST_PATH)) {
    console.error(
      `[check-no-fabrication] allowlist missing at ${relative(REPO_ROOT, ALLOWLIST_PATH)}`,
    );
    process.exit(1);
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(ALLOWLIST_PATH, "utf8"));
  } catch (err) {
    console.error(`[check-no-fabrication] allowlist is not valid JSON: ${err.message}`);
    process.exit(1);
  }
  const entries = Array.isArray(parsed) ? parsed : parsed.allowlist;
  if (!Array.isArray(entries)) {
    console.error(
      "[check-no-fabrication] allowlist must be a JSON array (or { allowlist: [...] })",
    );
    process.exit(1);
  }
  const map = new Map();
  for (const e of entries) {
    if (typeof e.file !== "string" || typeof e.line !== "number") {
      console.error(
        `[check-no-fabrication] allowlist entry missing file/line: ${JSON.stringify(e)}`,
      );
      process.exit(1);
    }
    map.set(`${e.file}:${e.line}`, e);
  }
  return map;
}

// ----------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------
function main() {
  const files = findScannedFiles();
  const allowlist = loadAllowlist();

  const allHits = [];
  for (const f of files) allHits.push(...scanFile(f));

  const seenKeys = new Set();
  const newHits = [];
  let allowlistedCount = 0;
  let p0Count = 0;

  for (const hit of allHits) {
    const key = `${hit.file}:${hit.line}`;
    seenKeys.add(key);
    const entry = allowlist.get(key);
    if (entry) {
      allowlistedCount += 1;
      if (entry.category === "P0-FIX-PENDING") p0Count += 1;
    } else {
      newHits.push(hit);
    }
  }

  // Stale allowlist entries: documented a hit that no longer exists.
  const staleEntries = [];
  for (const key of allowlist.keys()) {
    if (!seenKeys.has(key)) staleEntries.push(key);
  }

  console.log(
    `[check-no-fabrication] scanned ${files.length} files; ` +
      `${allHits.length} ${FORBIDDEN_TOKEN} hit(s); ` +
      `allowlisted: ${allowlistedCount} (P0-FIX-PENDING: ${p0Count}); ` +
      `new: ${newHits.length}; stale allowlist: ${staleEntries.length}`,
  );

  if (newHits.length === 0 && staleEntries.length === 0) {
    console.log("[check-no-fabrication] PASS");
    process.exit(0);
  }

  if (newHits.length > 0) {
    console.error("");
    console.error(
      `[check-no-fabrication] FAIL — ${newHits.length} new ${FORBIDDEN_TOKEN} hit(s) ` +
        `in a customer-fact path, not in the allowlist:`,
    );
    for (const h of newHits) console.error(`  • ${h.file}:${h.line}`);
    console.error("");
    console.error(
      "If this is a customer-visible FACT, it must come from real data, not " +
        `${FORBIDDEN_TOKEN}.`,
    );
    console.error(
      "If it is a legitimate use (id, jitter, sampling, shuffle, weighted " +
        "pick, backoff), add an annotated entry to " +
        "scripts/no-fabrication.allowlist.json:",
    );
    console.error(
      '  { "file": "server/...", "line": N, "category": "id", "note": "..." }',
    );
    console.error("New non-id/jitter entries require Iris-CTO sign-off.");
  }

  if (staleEntries.length > 0) {
    console.error("");
    console.error(
      `[check-no-fabrication] FAIL — ${staleEntries.length} stale allowlist ` +
        "entry(ies) (the hit no longer exists — remove the entry):",
    );
    for (const k of staleEntries) console.error(`  • ${k}`);
    console.error("");
    console.error(
      "A stale entry usually means a fabrication was FIXED (good!) — delete " +
        "its allowlist line so the ratchet stays tight.",
    );
  }

  process.exit(1);
}

main();
