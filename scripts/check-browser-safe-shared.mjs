#!/usr/bin/env node
// ============================================================================
// scripts/check-browser-safe-shared.mjs — shared/ must never crash a browser.
// ----------------------------------------------------------------------------
// shared/ modules are bundled into BOTH the server and the client. A bare
// `process.env.X` evaluates fine in Node but throws
// `ReferenceError: process is not defined` at module-evaluation time in the
// browser — which kills EVERY lazy chunk that transitively includes the module.
// That is exactly how the founder's Decisions/Controls doors went blank on
// 2026-07-11: shared/schema/solene-chat-config.ts read five env vars at top
// level and rode into the founder chunks via the Solene chat components.
//
// RULE
// ────
// Any file under shared/ that reads `process.env` (outside comments) must guard
// it with a `typeof process` check somewhere in the file (the
// shared/billing/tier-pricing.ts pattern). Deliberately coarse — one guard per
// file is enough, because the idiom is to hoist a single guarded `env` object
// and read from it everywhere.
//
// This gate is ZERO-TOLERANCE: its baseline is 0 offenders and it has no
// allowlist. That makes a silent UNDER-READ the worst thing that can happen to
// it — an under-read does not fail, it prints PASS.
//
// COMMENT HANDLING — masked, never deleted
// ────────────────────────────────────────
// Comments are removed by maskComments(), the string-aware SAME-LENGTH masker
// shared with scripts/lint-zindex.mjs and scripts/lint-page-hex.mjs. It replaces
// two regex substitutions that both DELETED characters, and both could delete
// a real `process.env` read:
//
//   1. `.replace(/\/\*[\s\S]*?\*\//g, "")` — the naive block stripper this repo
//      has already been bitten by (cited in the headers of
//      check-org-scoped-fetch.mjs, check-no-fabrication.mjs and
//      reachability.json's minimaNote). A `/*` inside a STRING or REGEX literal
//      opens a block the regex then closes at the next `*/`, deleting every line
//      in between. Mutation-tested 2026-08-16 with this exact fixture, which the
//      old stripper passed CLEAN at exit 0 while walking the file:
//          export const SCHEMA_GLOB = "shared/schema/*.ts";
//          export const API_BASE = process.env.LEAK_BLOCK_HOST ?? "";
//          export const NESTED_GLOB = "shared/*/index.ts";
//      NOTE which literals bite, because it is not all of them and the
//      distinction was measured, not assumed: `"shared/**/*.ts"` does NOT bite —
//      its `/**/` is a self-closing block, so the damage stays on its own line.
//      The dangerous shape is a quoted `/*` whose next `*/` is DOWNSTREAM, as
//      above. Scale of the blind spot: the old stripper deleted 1,052,327
//      characters across 157 of the 158 scanned shared/ files. Almost all of
//      that is genuine comment — the point is that nothing distinguished the
//      genuine part from a swallowed literal.
//   2. `.replace(/([^:'"])\/\/[^\n]*/g, "$1")` — blanked the rest of ANY line
//      where `//` followed a character that was not `:` or a quote. The `:` and
//      quote carve-outs were a hand-approximation of "am I inside a string", and
//      they leak: a template literal like `` `${base}//${process.env.HOST}` ``
//      has `//` preceded by `}`, so the process.env read was deleted from the
//      line. Same silent PASS.
//
// Masking blanks instead of deleting, so nothing the gate was about to check can
// disappear, and offsets/line counts stay honest.
//
// VACUITY GUARDS — a scan that stops seeing files must FAIL
// ─────────────────────────────────────────────────────────
// This gate counts BAD THINGS FOUND, so a broken walk finds zero and prints a
// reassuring PASS line with a scanned count nobody checks. Same family as
// scripts/ratchets/reachability.json `minima` and
// scripts/check-residential-comps-hold.mjs. So:
//
//   · MIN_SHARED_FILES floors the scan POPULATION the run prints.
//   · CANARY_FILE proves both predicates are still LIVE — without it, "0
//     unguarded reads" is indistinguishable from "the detector regex is dead".
//
// Neither is a ratchet and neither may be raised to silence a finding. If a
// deletion wave legitimately takes shared/ under the floor, LOWER the floor in
// the same commit and name the wave.
//
// Exit codes: 0 = clean; 1 = an unguarded process.env read, a vacuous scan, or a
// dead predicate.
// ============================================================================

import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { stripCommentsPreservingLines as maskComments } from "./lib/strip-comments.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const SHARED = join(ROOT, "shared");

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) yield* walk(p);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name)) yield p;
  }
}

const ENV_READ = /\bprocess\s*\.\s*env\b/;
const TYPEOF_GUARD = /typeof\s+process\s*(!==|===|!=|==)\s*["']undefined["']/;

// ----------------------------------------------------------------------------
// VACUITY FLOOR — not a ratchet. Every number this gate prints counts BAD THINGS
// FOUND, so a walk that stops reaching shared/ finds zero and reports success.
//
// MEASURED 2026-08-16: 158 files under shared/ satisfy the walk (*.ts/*.tsx,
// excluding *.test.*). Floor set at 120 — ~76% of live, the same 75-80% seeding
// rule reachability.json's `minima` uses — so a broken walker, a mangled
// extension filter or a wrong ROOT trips it, while ordinary deletion does not.
// ----------------------------------------------------------------------------
const MIN_SHARED_FILES = 120;

// ----------------------------------------------------------------------------
// IN-REPO CANARY — a real file that MUST keep matching both predicates. The
// floor proves files were READ; this proves they were UNDERSTOOD. Without it,
// "0 unguarded reads" is indistinguishable from "ENV_READ no longer matches
// anything", which is the failure mode a comment-stripper bug produces.
//
// shared/billing/tier-pricing.ts is the file the header names as the canonical
// guarded pattern, and it is the one this gate's fix advice points at, so it is
// the right thing to pin. Measured 2026-08-16: of the 158 scanned files, exactly
// 3 read process.env (tier-pricing.ts, schema/solene-chat-config.ts,
// schema/solene-embeddings.ts) and all 3 carry the typeof guard.
//
// If this canary fails, do NOT delete it to make the gate green: either the file
// genuinely stopped reading process.env (repoint the canary at another of the
// three, and say so here) or a predicate has rotted (fix the predicate).
// ----------------------------------------------------------------------------
const CANARY_FILE = join("shared", "billing", "tier-pricing.ts");

const offenders = [];
const hardFailures = [];
let scanned = 0;
let envReaders = 0;
let canarySeen = false;

for (const file of walk(SHARED)) {
  scanned += 1;
  const rel = file.replace(ROOT, "");
  const code = maskComments(readFileSync(file, "utf8"));
  const reads = ENV_READ.test(code);
  const guarded = TYPEOF_GUARD.test(code);

  if (rel === CANARY_FILE) {
    canarySeen = true;
    if (!reads) {
      hardFailures.push(
        `CANARY DEAD — ${CANARY_FILE} no longer matches the process.env detector. ` +
          `Either the file stopped reading process.env (repoint CANARY_FILE and note it) ` +
          `or ENV_READ / maskComments has rotted, in which case every "0" below is meaningless.`,
      );
    } else if (!guarded) {
      hardFailures.push(
        `CANARY DEAD — ${CANARY_FILE} reads process.env but no longer matches the ` +
          `typeof-guard detector. TYPEOF_GUARD has rotted, or the canonical guarded ` +
          `pattern this gate advertises has been rewritten.`,
      );
    }
  }

  if (!reads) continue;
  envReaders += 1;
  if (guarded) continue;
  offenders.push(rel);
}

if (scanned < MIN_SHARED_FILES) {
  hardFailures.push(
    `VACUOUS SCAN — only ${scanned} shared/ file(s) walked (floor ${MIN_SHARED_FILES}; ` +
      `measured 158 on 2026-08-16). An empty scan is not a clean bill of health. If a ` +
      `deletion wave genuinely shrank shared/, lower MIN_SHARED_FILES in the same commit.`,
  );
}
if (!canarySeen) {
  hardFailures.push(
    `CANARY MISSING — ${CANARY_FILE} was never reached by the walk. The walker is not ` +
      `seeing part of shared/, so the offender count below is an under-read, not a pass.`,
  );
}

if (hardFailures.length) {
  console.error(
    `[check-browser-safe-shared] FAIL — the gate itself is not trustworthy right now ` +
      `(${scanned} file(s) walked, ${envReaders} process.env reader(s) seen):`,
  );
  for (const f of hardFailures) console.error(`  x ${f}`);
  console.error(
    "\n  This gate is zero-tolerance, so a scan that reads nothing produces a zero that\n" +
      "  looks exactly like compliance. Fix the gate before trusting it.",
  );
  process.exit(1);
}

if (offenders.length) {
  console.error(
    `[check-browser-safe-shared] FAIL — ${offenders.length} shared/ file(s) read process.env without a \`typeof process\` guard.`,
  );
  console.error(
    "  Bare `process` throws in the browser and blanks every chunk that includes the module.",
  );
  console.error(
    "  Fix: hoist `const env = typeof process !== \"undefined\" && process.env ? process.env : {};` and read from `env` (see shared/billing/tier-pricing.ts).",
  );
  for (const f of offenders) console.error(`    ${f}`);
  process.exit(1);
}
console.log(
  `[check-browser-safe-shared] PASS — ${scanned} shared/ files scanned (floor ${MIN_SHARED_FILES}), ` +
    `${envReaders} process.env reader(s), all guarded; 0 unguarded reads.`,
);
