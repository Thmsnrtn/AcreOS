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
//   2. Report every FORBIDDEN_TOKENS occurrence as file:line.
//      (We do NOT regex-classify "is this a fact vs an id" — that judgment
//       lives in the human-curated allowlist. The lint just enumerates.)
//   3. Every CURRENT occurrence is covered by the allowlist
//      (scripts/no-fabrication.allowlist.json), each annotated as either a
//      legitimate use (id/jitter/sampling/shuffle/weighted-pick) or
//      `P0-FIX-PENDING` (a real fabrication awaiting its owning agent's fix).
//   4. The lint PASSES today (allowlist == current state) and FAILS on:
//        - any NEW forbidden-token hit not in the allowlist, OR
//        - any STALE allowlist entry (a hit that no longer exists), so the
//          ratchet is enforced in both directions and the allowlist can only
//          shrink as fabrications get fixed, OR
//        - a VACUITY trip (a scan root that stopped yielding files — see
//          "Vacuity guard" below).
//
// One token was not enough (2026-08-16)
// ─────────────────────────────────────
// This gate keyed on the single string `Math.random`, so the hard-stop it
// cites ("no invented numbers") was enforced against ONE SPELLING of getting a
// random number rather than against the act. Every one of these shipped GREEN
// under the old predicate while fabricating exactly what the rule forbids:
//   • `makeSeededRng(Date.now())` — a seeded PRNG that ALREADY EXISTS in this
//     repo (server/services/autopilot/efficacy.ts), driving a buyerMatchScore
//     between 50 and 90;
//   • `randomInt(12, 45)` from node:crypto as a dealVelocityDays;
//   • `globalThis.crypto.getRandomValues` driving a pipelineHealth percentage;
//   • `faker.*` in a client score card.
// A gate that a rename walks past is a gate that teaches people the rename.
// FORBIDDEN_TOKENS is therefore a LIST, and the bar for joining it is measured,
// not asserted — see REJECTED_CANDIDATES.
//
// Vacuity guard
// ─────────────
// An enumerating scan has one silent failure mode: it stops seeing files and
// reports "0 new hits" — a clean bill of health that means nothing. This repo
// has been bitten by exactly that (a block-comment stripper mispaired and
// blanked the very lines a scan was counting). So each scan root carries a
// floor set well below its current population: a root that vanishes, gets
// renamed, or collapses FAILS the gate instead of passing it. The stale-entry
// check guards the other direction — if the scan went blind, all 57 allowlist
// entries would go stale and fail — but the floors say WHY, immediately.
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
// The god-class server/storage.ts is being decomposed into mixin repos under
// server/storage/*Repo.ts. Scan that dir too so fabrication coverage follows
// the extracted data-access code instead of leaving a blind spot.
const STORAGE_DIR = join(SERVER_DIR, "storage");
// client/src/** — added 2026-08-13. This lint's own rationale names the UI
// ("we are lying with a confident UI") and then scanned only the server, so a
// component rendering `Math.floor(Math.random() * 40) + 50` as a match score
// passed every gate. The rendering layer is where a fabricated number becomes
// a fact the customer acts on; a fabrication invented there never touches a
// route handler at all.
const CLIENT_DIR = join(REPO_ROOT, "client", "src");
const ALLOWLIST_PATH = join(__dirname, "no-fabrication.allowlist.json");

// ----------------------------------------------------------------------------
// The non-deterministic value sources we flag.
//
// Adoption rule (learned the hard way — a gate whose count is mostly false
// positives is one people re-baseline instead of read): MEASURE a candidate
// across the scan roots BEFORE adopting it. `node scripts/check-no-fabrication.mjs
// --measure` prints the count for every token below, adopted and rejected, so
// the next person re-measures in one command instead of guessing.
//
// Measured 2026-08-16 over 2,049 scanned files:
//   Math.random     53 hits — the original token.
//   getRandomValues  1 hit  — CSPRNG bytes; adopted, hand-verified.
//   makeSeededRng(   3 hits — this repo's own PRNG; adopted, hand-verified.
//   randomInt(       0 hits — free to adopt, closes the node:crypto spelling.
//   faker.           0 hits — free to adopt; fixture data in a shipped path is
//                             fabrication by definition.
// A zero-hit token costs nothing today and closes a live bypass tomorrow;
// that is the whole reason two of these are here.
// ----------------------------------------------------------------------------
const FORBIDDEN_TOKENS = [
  "Math.random",
  "getRandomValues",
  "makeSeededRng(",
  "randomInt(",
  "faker.",
];

// ----------------------------------------------------------------------------
// Candidates MEASURED AND DELIBERATELY REJECTED. Recorded so the next session
// does not re-propose them, and so the rejection stays falsifiable: --measure
// reprints these counts, and if one ever collapses to a handful it becomes
// adoptable on the same evidence that rejects it today.
//
// Both are overwhelmingly IDS AND CRYPTO KEYS, not reported facts. Adding them
// would move the register from 57 annotated entries to ~161 and bury the four
// signal entries under a hundred `id` rows — the exact "count is mostly false
// positives" failure the adoption rule above exists to prevent. This program
// already narrowed one proposed check from 237 hits to 10 for this reason, and
// that narrowing is why the gate survived.
// ----------------------------------------------------------------------------
const REJECTED_CANDIDATES = [
  { token: "randomUUID(", measured: 72, why: "ids — a UUID is never a reported fact" },
  { token: "randomBytes(", measured: 32, why: "crypto key/secret material, not data" },
];

// ----------------------------------------------------------------------------
// File discovery — exactly the customer-fact-producing surface.
// ----------------------------------------------------------------------------
function isTestFile(name) {
  return (
    name.endsWith(".test.ts") ||
    name.endsWith(".spec.ts") ||
    name.endsWith(".test.tsx") ||
    name.endsWith(".spec.tsx")
  );
}

function walkTsFiles(dir, out) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walkTsFiles(full, out);
    } else if ((entry.endsWith(".ts") || entry.endsWith(".tsx")) && !isTestFile(entry)) {
      out.push(full);
    }
  }
}

// Per-root file floors — the VACUITY GUARD. Each is set well below the root's
// 2026-08-16 population, so ordinary churn (files added, deleted, moved within
// a root) never trips it, but a root that VANISHES — renamed, relocated, or
// excluded by a broken walk — fails the gate instead of reading as "0 new
// hits, PASS". `min: 0` marks a root that is legitimately allowed to be empty.
const SCAN_ROOTS = [
  { id: "server/routes-*.ts", min: 100, measured2026_08_16: 269 },
  { id: "server/storage.ts", min: 0, measured2026_08_16: 1 },
  { id: "server/storage/**", min: 10, measured2026_08_16: 33 },
  { id: "server/services/**", min: 300, measured2026_08_16: 872 },
  { id: "client/src/**", min: 300, measured2026_08_16: 874 },
];

function findScannedFiles() {
  const byRoot = new Map(SCAN_ROOTS.map((r) => [r.id, []]));
  // server/routes-*.ts
  for (const entry of readdirSync(SERVER_DIR)) {
    if (!entry.startsWith("routes-") || !entry.endsWith(".ts")) continue;
    if (isTestFile(entry)) continue;
    byRoot.get("server/routes-*.ts").push(join(SERVER_DIR, entry));
  }
  // server/storage.ts
  const storage = join(SERVER_DIR, "storage.ts");
  if (existsSync(storage)) byRoot.get("server/storage.ts").push(storage);
  // server/storage/**/*.ts — the extracted mixin repos.
  if (existsSync(STORAGE_DIR)) walkTsFiles(STORAGE_DIR, byRoot.get("server/storage/**"));
  // server/services/**/*.ts
  walkTsFiles(SERVICES_DIR, byRoot.get("server/services/**"));
  // client/src/**/*.{ts,tsx} — the rendering layer.
  walkTsFiles(CLIENT_DIR, byRoot.get("client/src/**"));

  const files = [];
  for (const list of byRoot.values()) files.push(...list);
  return { files: files.sort(), byRoot };
}

/**
 * Vacuity guard. Returns the roots that fell below their floor. A non-empty
 * result must FAIL the run: a scan that stopped seeing files reports zero new
 * hits, and zero new hits is indistinguishable from good news.
 */
function checkVacuity(byRoot) {
  const starved = [];
  for (const root of SCAN_ROOTS) {
    const count = (byRoot.get(root.id) ?? []).length;
    if (count < root.min) starved.push({ ...root, count });
  }
  return starved;
}

// ----------------------------------------------------------------------------
// Scan — enumerate every Math.random hit as { file, line }.
// We skip occurrences inside line comments that merely MENTION the token
// (e.g. "Stable across runs (no Math.random)") so documentation doesn't
// register as a hit. A line counts only if the token appears outside a
// leading `//` comment OR appears before a trailing `//` on a code line.
// ----------------------------------------------------------------------------
function tokensOnLine(raw, tokens) {
  const found = [];
  const trimmed = raw.trimStart();
  // A line that IS a comment can only ever MENTION a token.
  if (trimmed.startsWith("//") || trimmed.startsWith("*")) return found;
  const commentIdx = raw.indexOf("//");
  for (const token of tokens) {
    const idx = raw.indexOf(token);
    if (idx === -1) continue;
    // Token sits after a trailing `//` on a code line → it's prose.
    if (commentIdx !== -1 && commentIdx < idx) continue;
    found.push(token);
  }
  return found;
}

/**
 * One hit per (file, line), carrying every forbidden token found on it. Keying
 * hits by line (not by line×token) keeps the allowlist's file:line key — and
 * therefore all 53 pre-existing entries — valid unchanged as the token list
 * grows.
 */
function scanFile(absPath, tokens = FORBIDDEN_TOKENS) {
  const rel = relative(REPO_ROOT, absPath);
  const lines = readFileSync(absPath, "utf8").split("\n");
  const hits = [];
  for (let i = 0; i < lines.length; i++) {
    const found = tokensOnLine(lines[i], tokens);
    if (found.length === 0) continue;
    // `text` is the fingerprint source — see fingerprint() below for why a
    // line number alone is not an identity.
    hits.push({ file: rel, line: i + 1, tokens: found, text: lines[i] });
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

/**
 * The hit's own text, normalised — the key that survives an edit ABOVE it.
 *
 * A line number is a position, not an identity. Every edit above a hit
 * invalidates its entry, and the gate cannot tell that from a fabrication
 * actually being fixed: it reports one stale entry and one new hit, and someone
 * has to re-read both to discover nothing changed. The two routes-va-engine
 * entries have cost that SIXTEEN times (the allowlist's own bump note counts
 * them), and every one of those corrections was an opportunity to wave through
 * a real hit while restoring a line number.
 *
 * So an entry may also carry `match`. When the line has drifted, a hit in the
 * SAME FILE whose normalised text equals `match` is the same hit, and the entry
 * still covers it. Deliberately narrow:
 *   - same file only — a fingerprint never travels between files;
 *   - the rematch must be UNAMBIGUOUS on both sides (exactly one unconsumed
 *     entry and exactly one unclaimed hit), or it is refused and both halves
 *     report normally;
 *   - if the hit's TEXT changes, the fingerprint stops matching and the entry
 *     goes stale exactly as before. Changing the code still costs a re-read;
 *     moving it no longer does.
 */
function fingerprint(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

// ----------------------------------------------------------------------------
// --measure — re-measure every candidate token, adopted and rejected, over the
// real scan roots. This is the evidence behind FORBIDDEN_TOKENS and
// REJECTED_CANDIDATES; run it before proposing a change to either.
// ----------------------------------------------------------------------------
function measure() {
  const { files, byRoot } = findScannedFiles();
  console.log(`[check-no-fabrication --measure] ${files.length} files scanned\n`);
  console.log("scan roots (file counts vs vacuity floor):");
  for (const root of SCAN_ROOTS) {
    const n = (byRoot.get(root.id) ?? []).length;
    console.log(
      `  ${n < root.min ? "STARVED" : "ok     "} ${String(n).padStart(5)}  (floor ${root.min})  ${root.id}`,
    );
  }

  const all = [
    ...FORBIDDEN_TOKENS.map((t) => ({ token: t, adopted: true })),
    ...REJECTED_CANDIDATES.map((c) => ({ ...c, adopted: false })),
  ];
  const counts = new Map(all.map((c) => [c.token, 0]));
  for (const f of files) {
    const lines = readFileSync(f, "utf8").split("\n");
    for (const raw of lines) {
      for (const token of tokensOnLine(raw, all.map((c) => c.token))) {
        counts.set(token, counts.get(token) + 1);
      }
    }
  }

  console.log("\ntoken counts:");
  for (const c of all) {
    console.log(
      `  ${c.adopted ? "ADOPTED " : "rejected"} ${String(counts.get(c.token)).padStart(4)}  ` +
        `${c.token}${c.why ? `  — ${c.why}` : ""}`,
    );
  }
  console.log(
    "\nA rejected candidate becomes adoptable when its count is small enough to " +
      "annotate honestly. A noisy token is not a stricter gate — it is a gate " +
      "people re-baseline.",
  );
  process.exit(0);
}

// ----------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------
function main() {
  if (process.argv.includes("--measure")) return measure();

  const { files, byRoot } = findScannedFiles();
  const allowlist = loadAllowlist();

  // VACUITY GUARD — run BEFORE the scan is interpreted. A starved root makes
  // "0 new hits" meaningless, so it fails here rather than passing quietly.
  const starved = checkVacuity(byRoot);
  if (starved.length > 0) {
    console.error(
      `[check-no-fabrication] FAIL (VACUOUS SCAN) — ${starved.length} scan root(s) ` +
        "below their file floor. The scan went blind; a clean result here would " +
        "be a false negative, not good news:",
    );
    for (const s of starved) {
      console.error(
        `  • ${s.id}: found ${s.count} file(s), floor ${s.min} ` +
          `(was ${s.measured2026_08_16} on 2026-08-16)`,
      );
    }
    console.error("");
    console.error(
      "Did a directory get renamed or relocated? Fix the scan root — do NOT " +
        "lower the floor to make this pass.",
    );
    process.exit(1);
  }

  if (allowlist.size === 0) {
    console.error(
      "[check-no-fabrication] FAIL — the allowlist is empty. 53+ annotated " +
        "entries are expected; an empty register cannot detect anything.",
    );
    process.exit(1);
  }

  const allHits = [];
  for (const f of files) allHits.push(...scanFile(f));

  const seenKeys = new Set();
  const newHits = [];
  const tokenMismatches = [];
  const matchMismatches = [];
  const perToken = new Map(FORBIDDEN_TOKENS.map((t) => [t, 0]));
  let allowlistedCount = 0;
  let p0Count = 0;

  // Pass 1 — exact line matches, which is the ordinary case.
  const claimed = new Set();
  const unmatchedHits = [];
  for (const hit of allHits) {
    for (const t of hit.tokens) perToken.set(t, perToken.get(t) + 1);
    const key = `${hit.file}:${hit.line}`;
    if (allowlist.has(key)) {
      seenKeys.add(key);
      claimed.add(hit);
    } else {
      unmatchedHits.push(hit);
    }
  }

  // Pass 2 — fingerprint rematch for hits whose line drifted. Both sides must be
  // unambiguous, so a file with two identical hits gets no rematch at all.
  const drifted = [];
  for (const hit of unmatchedHits) {
    const fp = fingerprint(hit.text);
    if (!fp) continue;
    const candidates = [];
    for (const [k, e] of allowlist) {
      if (seenKeys.has(k)) continue;
      if (e.file !== hit.file) continue;
      if (typeof e.match !== "string" || fingerprint(e.match) !== fp) continue;
      candidates.push(k);
    }
    if (candidates.length !== 1) continue;
    const twins = unmatchedHits.filter((h) => h.file === hit.file && fingerprint(h.text) === fp);
    if (twins.length !== 1) continue;
    seenKeys.add(candidates[0]);
    claimed.add(hit);
    drifted.push({ from: candidates[0], to: `${hit.file}:${hit.line}` });
  }

  for (const hit of allHits) {
    const key = `${hit.file}:${hit.line}`;
    const entry = allowlist.get(key) ?? (claimed.has(hit)
      ? [...allowlist.values()].find(
          (e) => e.file === hit.file && typeof e.match === "string" &&
                 fingerprint(e.match) === fingerprint(hit.text))
      : undefined);
    if (entry) {
      allowlistedCount += 1;
      if (entry.category === "P0-FIX-PENDING") p0Count += 1;
      // An entry may PIN the token it annotates. If the line's token changed
      // (someone swapped Math.random for a seeded PRNG), the note now describes
      // code that is gone — the annotation is stale even though the line isn't.
      if (typeof entry.token === "string" && !hit.tokens.includes(entry.token)) {
        tokenMismatches.push({ key, pinned: entry.token, found: hit.tokens });
      }
      // Same idea one level finer. `match` is the hit's own text at the time a
      // person read it and wrote the note. If the line still holds a forbidden
      // token but the CODE changed, the note describes something that is gone —
      // and an exact line match would otherwise wave it straight through,
      // because the line number is unchanged. Whitespace is normalised, so
      // reformatting is not a change; the expression changing is.
      if (typeof entry.match === "string" && fingerprint(entry.match) !== fingerprint(hit.text)) {
        matchMismatches.push({ key, annotated: fingerprint(entry.match), found: fingerprint(hit.text) });
      }
    } else if (!claimed.has(hit)) {
      newHits.push(hit);
    }
  }

  if (drifted.length > 0) {
    console.log(
      `[check-no-fabrication] ${drifted.length} entry(ies) rematched by fingerprint ` +
        `after a line drift (the code did not change, only its position): ` +
        drifted.map((d) => `${d.from} -> ${d.to}`).join(", "),
    );
  }

  // Stale allowlist entries: documented a hit that no longer exists.
  const staleEntries = [];
  for (const key of allowlist.keys()) {
    if (!seenKeys.has(key)) staleEntries.push(key);
  }

  const breakdown = FORBIDDEN_TOKENS.map((t) => `${t}=${perToken.get(t)}`).join(" ");
  console.log(
    `[check-no-fabrication] scanned ${files.length} files; ` +
      `${allHits.length} hit line(s) [${breakdown}]; ` +
      `allowlisted: ${allowlistedCount} (P0-FIX-PENDING: ${p0Count}); ` +
      `new: ${newHits.length}; stale allowlist: ${staleEntries.length}; ` +
      `token mismatches: ${tokenMismatches.length}; ` +
      `annotation mismatches: ${matchMismatches.length}`,
  );

  if (
    newHits.length === 0 &&
    staleEntries.length === 0 &&
    tokenMismatches.length === 0 &&
    matchMismatches.length === 0
  ) {
    console.log("[check-no-fabrication] PASS");
    process.exit(0);
  }

  if (matchMismatches.length > 0) {
    console.error("");
    console.error(
      `[check-no-fabrication] FAIL — ${matchMismatches.length} allowlist ` +
        `annotation(s) describe code that has CHANGED. The line still holds a ` +
        `forbidden token, so nothing looks new — but the note was written about ` +
        `different code and no longer vouches for this one. Re-read the site and ` +
        `update the entry's "match" (and its note, if the reason moved):`,
    );
    for (const m of matchMismatches) {
      console.error(`  • ${m.key}`);
      console.error(`      annotated: ${m.annotated}`);
      console.error(`      found:     ${m.found}`);
    }
  }

  if (newHits.length > 0) {
    console.error("");
    console.error(
      `[check-no-fabrication] FAIL — ${newHits.length} new non-deterministic ` +
        `value source(s) in a customer-fact path, not in the allowlist:`,
    );
    for (const h of newHits) console.error(`  • ${h.file}:${h.line}  [${h.tokens.join(", ")}]`);
    console.error("");
    console.error(
      "If this is a customer-visible FACT, it must come from real data. " +
        "Reaching for a different random source than Math.random does not " +
        "change that — a seeded PRNG, crypto.randomInt, getRandomValues and " +
        "faker all invent the number just the same.",
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

  if (tokenMismatches.length > 0) {
    console.error("");
    console.error(
      `[check-no-fabrication] FAIL — ${tokenMismatches.length} allowlist ` +
        "entry(ies) pin a token that is no longer on that line. The line " +
        "survived but its ANNOTATION now describes code that is gone:",
    );
    for (const m of tokenMismatches) {
      console.error(`  • ${m.key}: pinned "${m.pinned}", found [${m.found.join(", ")}]`);
    }
    console.error("");
    console.error(
      "Swapping one random source for another does not inherit the old " +
        "entry's sign-off. Re-judge the line and rewrite its note.",
    );
  }

  process.exit(1);
}

main();
