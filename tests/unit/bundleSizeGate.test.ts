/**
 * Bundle-size gate — fail-closed contract (Phase 3, audit #20).
 *
 * The bundle-size check (scripts/check-bundle-size.js) used to exit 0 whenever
 * dist/ was absent, and it ran in no workflow — so a dropped build step could
 * ship an unweighed bundle while the gate stayed green. These tests pin the
 * hardened contract:
 *
 *   1. CI + missing dist   → FAIL (exit 1). A missing build must not pass.
 *   2. local + missing dist → friendly SKIP (exit 0). Dev ergonomics preserved.
 *   3. present dist under budget → PASS (exit 0).
 *   4. an oversized single chunk → FAIL (exit 1).
 *   5. total JS over budget → FAIL (exit 1).
 *   6. the real CLI, spawned with CI=1 and no build, exits non-zero
 *      (guards the process.exit wiring, not just the pure helper).
 *
 * Any regression that reinstates the silent exit-0-on-missing-build behavior
 * flips test #1 (and #6) red.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  checkBundleSize,
  MAX_SINGLE_CHUNK_KB,
  MAX_TOTAL_JS_KB,
} from "../../scripts/check-bundle-size.js";

const REPO_ROOT = resolve(__dirname, "..", "..");
const SCRIPT = join(REPO_ROOT, "scripts", "check-bundle-size.js");

/** Write a .js file of approximately `kb` kilobytes into `dir`. */
function writeJs(dir: string, name: string, kb: number): void {
  writeFileSync(join(dir, name), Buffer.alloc(kb * 1024, "a"));
}

describe("bundle-size gate — checkBundleSize (pure decision)", () => {
  let workDir: string;
  let assetsDir: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), "bundle-size-"));
    assetsDir = join(workDir, "dist", "public", "assets");
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it("FAILS closed in CI when dist/ is absent (missing build must not pass)", () => {
    const result = checkBundleSize({ distDir: assetsDir, ci: true });
    expect(result.exitCode).toBe(1);
    expect(result.level).toBe("error");
    expect(result.message).toMatch(/FAIL/);
    expect(result.message).toMatch(/not found in CI/i);
  });

  it("SKIPS (exit 0) when dist/ is absent and NOT in CI (local dev preserved)", () => {
    const result = checkBundleSize({ distDir: assetsDir, ci: false });
    expect(result.exitCode).toBe(0);
    expect(result.level).toBe("log");
    expect(result.message).toMatch(/SKIP/);
  });

  it("PASSES when a present dist is under budget", () => {
    mkdirSync(assetsDir, { recursive: true });
    writeJs(assetsDir, "index-abc123.js", 100);
    writeJs(assetsDir, "vendor-def456.js", 200);

    // Under budget under BOTH ci flags — presence, not CI, decides here.
    for (const ci of [true, false]) {
      const result = checkBundleSize({ distDir: assetsDir, ci });
      expect(result.exitCode).toBe(0);
      expect(result.level).toBe("log");
      expect(result.message).toMatch(/PASS/);
      expect(result.violations).toHaveLength(0);
    }
  });

  it("FAILS when a single chunk exceeds MAX_SINGLE_CHUNK_KB", () => {
    mkdirSync(assetsDir, { recursive: true });
    writeJs(assetsDir, "huge-chunk.js", MAX_SINGLE_CHUNK_KB + 50);

    const result = checkBundleSize({ distDir: assetsDir, ci: true });
    expect(result.exitCode).toBe(1);
    expect(result.violations.some((v) => v.includes("huge-chunk.js"))).toBe(true);
  });

  it("FAILS when total JS exceeds MAX_TOTAL_JS_KB (no single chunk over limit)", () => {
    mkdirSync(assetsDir, { recursive: true });
    // Each file is under the per-chunk limit, but together they blow the total.
    const perFileKb = MAX_SINGLE_CHUNK_KB - 50; // 550 KB, under 600
    const count = Math.ceil(MAX_TOTAL_JS_KB / perFileKb) + 1; // guarantees over 3000
    for (let i = 0; i < count; i++) {
      writeJs(assetsDir, `chunk-${i}.js`, perFileKb);
    }

    const result = checkBundleSize({ distDir: assetsDir, ci: true });
    expect(result.exitCode).toBe(1);
    expect(result.violations.some((v) => v.includes("Total JS"))).toBe(true);
  });
});

/** Run the real CLI; return { code, out }. */
function runCli(env: NodeJS.ProcessEnv): { code: number; out: string } {
  try {
    const out = execFileSync("node", [SCRIPT], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: { ...process.env, ...env },
    });
    return { code: 0, out };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

describe("bundle-size gate — real CLI wiring", () => {
  const MISSING_DIST = join(tmpdir(), "definitely-not-a-real-dist-dir-xyz");

  it("exits non-zero when CI is set and the dist dir is missing", () => {
    const { code, out } = runCli({
      CI: "1",
      BUNDLE_SIZE_DIST_DIR: MISSING_DIST,
    });
    expect(code).toBe(1);
    expect(out).toMatch(/FAIL/);
  });

  it("exits 0 (friendly skip) when NOT in CI and the dist dir is missing", () => {
    const { code, out } = runCli({
      CI: "", // GitHub sets CI=true; explicitly clear it for the local-dev branch
      BUNDLE_SIZE_DIST_DIR: MISSING_DIST,
    });
    expect(code).toBe(0);
    expect(out).toMatch(/SKIP/);
  });
});
