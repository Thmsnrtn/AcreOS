#!/usr/bin/env node
// ============================================================================
// scripts/regenerate-gate-manifest.mjs — the ONLY sanctioned writer of
// server/services/autopilot/gateTamperManifest.json (master-handoff F3,
// "eternal lines").
// ----------------------------------------------------------------------------
// The manifest pins the SHA-256 of every gate-estate file (ratchet baselines,
// governance registries, sovereign immutables, codeChangeGate, the named
// ratchet tests, the security + deploy workflows, this script and the
// evaluators). Changing ANY estate file therefore requires re-running this
// script, which puts a deliberate, reviewable manifest diff in the same
// commit — that is the amendment forcing function, same shape as the
// sovereign-immutables fixture-hash procedure.
//
//   node scripts/regenerate-gate-manifest.mjs            # rewrite the manifest
//   node scripts/regenerate-gate-manifest.mjs --out FILE # write elsewhere
//                                                        # (used by the parity test)
//
// Consumers of the manifest:
//   • tests/unit/gateTamperWatch.test.ts — CI fails when the committed
//     manifest drifts from the repo (and when this script's estate list
//     drifts from the TS module's — the two enumerations are pinned equal).
//   • server/services/autopilot/gateTamperWatch.ts — the gate_tamper_watch
//     job re-hashes the running estate and pages the founder on mismatch.
//
// The ESTATE list below is a deliberate mirror of GATE_ESTATE in
// server/services/autopilot/gateTamperWatch.ts (this file is plain Node ESM
// and cannot import TS). Drift between the two fails the parity test.
// ============================================================================

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST_RELPATH = "server/services/autopilot/gateTamperManifest.json";

const argv = process.argv.slice(2);
const outIdx = argv.indexOf("--out");
const OUT = outIdx >= 0 && argv[outIdx + 1] ? argv[outIdx + 1] : join(ROOT, MANIFEST_RELPATH);

// Mirror of GATE_ESTATE in server/services/autopilot/gateTamperWatch.ts —
// keep the two in lockstep (the parity test enforces it).
const ESTATE_DIRS = [
  { dir: "scripts/ratchets", ext: ".json" },
  { dir: "shared/governance", ext: ".ts" },
];
const ESTATE_FILES = [
  "sovereign-protocol/immutables.json",
  "server/services/autopilot/codeChangeGate.ts",
  "server/services/autopilot/gateTamperWatch.ts",
  "scripts/ratchet.mjs",
  "scripts/lint-reachability.mjs",
  "scripts/regenerate-gate-manifest.mjs",
  ".github/workflows/security.yml",
  ".github/workflows/deploy.yml",
  "tests/unit/constitution.test.ts",
  "tests/unit/moneyCustodyHardStop.test.ts",
  "tests/unit/founderHardStopGuardrails.test.ts",
  "tests/unit/sovereign-protocol-immutables.test.ts",
  "tests/unit/founderFourDoors.test.ts",
  "tests/unit/sidebarHiddenRoutes.test.ts",
  "tests/unit/workflowActionHonesty.test.ts",
  "tests/unit/statuteRegister.test.ts",
  "tests/unit/pagerMatrix.test.ts",
  "tests/unit/jobRosterCoverage.test.ts",
  "tests/unit/selfPatchCannotMerge.test.ts",
  "tests/unit/gateTamperWatch.test.ts",
];

const NOTE =
  "Generated ONLY by scripts/regenerate-gate-manifest.mjs — never edit by hand. " +
  "tests/unit/gateTamperWatch.test.ts fails CI when this drifts from the repo; " +
  "the gate_tamper_watch job pages the founder when the running estate drifts from this.";

const present = new Set();
const missing = [];
for (const { dir, ext } of ESTATE_DIRS) {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) continue;
  for (const entry of readdirSync(abs)) {
    if (!entry.endsWith(ext)) continue;
    const rel = `${dir}/${entry}`;
    if (rel === MANIFEST_RELPATH) continue;
    present.add(rel);
  }
}
for (const rel of ESTATE_FILES) {
  if (rel === MANIFEST_RELPATH) continue; // the manifest cannot pin itself
  if (existsSync(join(ROOT, rel))) present.add(rel);
  else missing.push(rel);
}

if (missing.length > 0) {
  // Refuse, don't bless a deletion: a manifest built while a named gate file
  // is absent would hide exactly the tampering this system exists to catch.
  console.error(
    `[regenerate-gate-manifest] REFUSING — named estate file(s) missing:\n` +
      missing.map((m) => `  ✗ ${m}`).join("\n"),
  );
  process.exit(1);
}

const files = {};
for (const rel of [...present].sort()) {
  files[rel] = createHash("sha256").update(readFileSync(join(ROOT, rel))).digest("hex");
}

const manifest = { note: NOTE, algorithm: "sha256", files };
writeFileSync(OUT, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(
  `[regenerate-gate-manifest] wrote ${Object.keys(files).length} pinned hashes → ${OUT}`,
);
