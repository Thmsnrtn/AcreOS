#!/usr/bin/env node
/**
 * Check that the production bundle doesn't exceed size limits.
 * Runs after `npm run build` and inspects dist/public/assets/.
 *
 * Fail-closed contract (audit #20): in CI a MISSING build is a FAILURE, not a
 * pass. Previously an absent dist/ printed a friendly SKIP and exited 0 — so if
 * the build step was ever dropped or produced no assets, the gate went green
 * without ever weighing a byte. In CI (process.env.CI) that now exits 1. Local
 * developers who just haven't run `npm run build` still get the friendly skip.
 *
 * The decision is a pure function (`checkBundleSize`) so it can be unit-tested
 * without spawning a process; the CLI wrapper at the bottom is the only part
 * that touches process.exit / stdio.
 */

import { readdirSync, statSync } from "fs";
import { resolve, join, dirname } from "path";
import { fileURLToPath } from "url";

export const MAX_SINGLE_CHUNK_KB = 600; // No single chunk > 600 KB
export const MAX_TOTAL_JS_KB = 3000; // Total JS < 3 MB

// Script-relative paths via import.meta.url (fileURLToPath) — universally
// supported, unlike import.meta.dirname/filename which may be undefined when a
// test imports this module through a bundler transform.
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Resolve the default dist assets directory relative to this script's location
 * (NOT the cwd) so the check behaves identically regardless of where it's run.
 */
export const DEFAULT_DIST_DIR = resolve(__dirname, "../dist/public/assets");

/**
 * Pure decision function. Given a dist assets dir and whether we're in CI,
 * returns what the CLI should do — WITHOUT touching the process.
 *
 * @param {{ distDir?: string, ci?: boolean }} [opts]
 * @returns {{ exitCode: 0 | 1, level: "log" | "error", message: string, violations: string[] }}
 */
export function checkBundleSize(opts = {}) {
  const { distDir = DEFAULT_DIST_DIR, ci = false } = opts;

  let files;
  try {
    files = readdirSync(distDir);
  } catch {
    // dist/ is absent. In CI a missing build must FAIL — a gate that never
    // sees the bundle must not report success. Locally, stay friendly.
    if (ci) {
      return {
        exitCode: 1,
        level: "error",
        message:
          `FAIL: ${distDir} not found in CI. The production build did not run ` +
          `(or produced no assets), so the bundle-size gate could not weigh a ` +
          `single byte. A missing build must not silently pass — run ` +
          `'npm run build' before this check.`,
        violations: [],
      };
    }
    return {
      exitCode: 0,
      level: "log",
      message:
        "SKIP: dist/public/assets/ not found — run 'npm run build' first",
      violations: [],
    };
  }

  let totalJS = 0;
  const violations = [];

  for (const file of files) {
    if (!file.endsWith(".js")) continue;
    const size = statSync(join(distDir, file)).size;
    const sizeKB = Math.round(size / 1024);
    totalJS += sizeKB;

    if (sizeKB > MAX_SINGLE_CHUNK_KB) {
      violations.push(
        `${file}: ${sizeKB} KB (limit: ${MAX_SINGLE_CHUNK_KB} KB)`
      );
    }
  }

  if (totalJS > MAX_TOTAL_JS_KB) {
    violations.push(
      `Total JS: ${totalJS} KB exceeds limit of ${MAX_TOTAL_JS_KB} KB`
    );
  }

  if (violations.length > 0) {
    return {
      exitCode: 1,
      level: "error",
      message:
        "FAIL: Bundle size violations:\n" +
        violations.map((v) => `  ${v}`).join("\n"),
      violations,
    };
  }

  return {
    exitCode: 0,
    level: "log",
    message: `PASS: Bundle size OK (total JS: ${totalJS} KB)`,
    violations: [],
  };
}

// --- CLI entry -------------------------------------------------------------
// Only runs when executed directly (`node scripts/check-bundle-size.js`), not
// when imported by a test.
const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
const isMain = __filename === invokedPath;

if (isMain) {
  // Allow tests / callers to point the CLI at an alternate dist dir. Falls back
  // to the script-relative default used by `npm run build`.
  const distDir = process.env.BUNDLE_SIZE_DIST_DIR || DEFAULT_DIST_DIR;
  const ci = Boolean(process.env.CI);

  const result = checkBundleSize({ distDir, ci });
  if (result.level === "error") {
    console.error(result.message);
  } else {
    console.log(result.message);
  }
  process.exit(result.exitCode);
}
