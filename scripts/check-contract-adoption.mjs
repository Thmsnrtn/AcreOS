#!/usr/bin/env node
// ============================================================================
// scripts/check-contract-adoption.mjs — UP-ratchet for API-contract adoption.
// ----------------------------------------------------------------------------
// T3-3E Phase 3. The shared/contracts/ layer is adopted one route at a time;
// "contract coverage only increases" is an UP-ratchet, which the generic
// scripts/ratchet.mjs deliberately does NOT support (it only ratchets DOWN).
//
// This standalone gate counts the number of server route files
// (server/routes-*.ts) that import from "@shared/contracts" and FAILS if the
// count DROPS below the baseline (a contract was un-wired — fix it, don't
// lower the baseline) and FAILS if the count GROWS above the baseline (good —
// lock in the gain by raising BASELINE). Mirrors the bidirectional PASS/FAIL
// discipline + output strings of scripts/ratchet.mjs.
//
// Counting rule: a route file counts ONCE if any non-comment line imports
// from "@shared/contracts" (bare or subpath). Comment lines are skipped so a
// doc mention doesn't move the number.
//
//   count <  baseline → FAIL  (adoption regressed — re-wire the contract)
//   count >  baseline → FAIL  (adoption grew — raise BASELINE to lock it in)
//   count == baseline → PASS
//
// Raising BASELINE requires Iris-CTO sign-off (same as the DOWN-ratchets).
// ============================================================================

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");
const SERVER_DIR = join(REPO_ROOT, "server");

// Current number of server/routes-*.ts files importing from @shared/contracts.
// Raise this (and only this) when a new route adopts a contract. Lowering it
// requires Iris-CTO sign-off — adoption is not allowed to regress.
const BASELINE = 2;

const NAME = "contract-adoption";

// Matches an import/export/require/dynamic-import from "@shared/contracts"
// or a "@shared/contracts/<subpath>".
const CONTRACT_IMPORT_RE =
  /(?:from\s*|import\s*\(\s*|require\s*\(\s*)["']@shared\/contracts(?:\/[^"']*)?["']/;

function isRouteFile(name) {
  return name.startsWith("routes-") && name.endsWith(".ts") && !name.endsWith(".d.ts");
}

function fileImportsContracts(absPath) {
  const lines = readFileSync(absPath, "utf8").split("\n");
  for (const line of lines) {
    const t = line.trimStart();
    if (t.startsWith("//") || t.startsWith("*")) continue; // doc lines don't count
    if (CONTRACT_IMPORT_RE.test(line)) return true;
  }
  return false;
}

function main() {
  if (!existsSync(SERVER_DIR)) {
    console.error(`[${NAME}] missing server/ directory`);
    process.exit(1);
  }

  const adopters = [];
  for (const entry of readdirSync(SERVER_DIR).sort()) {
    if (!isRouteFile(entry)) continue;
    if (fileImportsContracts(join(SERVER_DIR, entry))) {
      adopters.push(`server/${entry}`);
    }
  }

  const count = adopters.length;

  if (count === BASELINE) {
    console.log(
      `[${NAME}] PASS — ${count} route file(s) adopt @shared/contracts ` +
        `(baseline ${BASELINE}).`,
    );
    for (const a of adopters) console.log(`    • ${a}`);
    process.exit(0);
  }

  if (count < BASELINE) {
    console.error(
      `[${NAME}] FAIL — ${count} < baseline ${BASELINE} ` +
        `(${BASELINE - count} route file(s) stopped importing @shared/contracts).`,
    );
    console.error(
      "  Contract adoption is an UP-ratchet — re-wire the contract instead of " +
        "lowering the baseline. Lowering BASELINE requires Iris-CTO sign-off.",
    );
    process.exit(1);
  }

  // count > baseline — good news; force the gate to tighten.
  console.error(
    `[${NAME}] FAIL — adoption grew to ${count} (baseline says ${BASELINE}).`,
  );
  console.error(
    `  Good news: ${count - BASELINE} more route file(s) adopted contracts. ` +
      `Lock it in — set BASELINE = ${count} in scripts/check-contract-adoption.mjs.`,
  );
  for (const a of adopters) console.error(`    • ${a}`);
  process.exit(1);
}

main();
