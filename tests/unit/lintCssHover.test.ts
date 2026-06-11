/**
 * lint-css-hover ratchet tests (W2-10a, 2026-06-11).
 *
 * Locks in the three properties that make scripts/lint-css-hover.mjs
 * trustworthy (same pattern as voiceLinter.test.ts):
 *   1. It CATCHES ungated `:hover` rules — the iOS-Safari double-tap bug
 *      (feedback_ios_double_tap_hover) → exit 1.
 *   2. It does NOT false-positive on hover rules already gated behind
 *      `@media (hover: hover)` (including compound queries and nesting),
 *      nor on `:hover` mentioned in CSS comments → exit 0.
 *   3. The CURRENT client/src CSS surface passes at its frozen baseline.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");
const LINTER = join(REPO_ROOT, "scripts", "lint-css-hover.mjs");

/** Run the linter against an absolute target; return { code, out }. */
function runLinter(...targets: string[]): { code: number; out: string } {
  try {
    const out = execFileSync("node", [LINTER, ...targets], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    return { code: 0, out };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

describe("lint-css-hover", () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "lint-css-hover-"));
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("catches ungated :hover rules", () => {
    const bad = join(dir, "bad.css");
    writeFileSync(
      bad,
      [
        ".card { color: red; }",
        ".card:hover { color: blue; }", // raw hover — the iOS double-tap bug
        "@media (max-width: 640px) {",
        "  .row:hover { background: gray; }", // wrong media gate — still ungated
        "}",
      ].join("\n"),
    );
    const { code, out } = runLinter(bad);
    expect(code).toBe(1);
    expect(out).toContain("FAIL");
    expect(out).toContain(".card:hover");
    expect(out).toContain(".row:hover");
    expect(out).toContain("@media (hover: hover)");
  });

  it("does NOT false-positive on gated rules or comments", () => {
    const clean = join(dir, "clean.css");
    writeFileSync(
      clean,
      [
        "/* .legacy:hover used to live here — see feedback_ios_double_tap_hover */",
        ".card { color: red; }",
        "@media (hover: hover) {",
        "  .card:hover { color: blue; }",
        "  @supports (display: grid) {",
        "    .grid-card:hover { outline: 1px solid; }", // nested under the gate
        "  }",
        "}",
        "@media (hover: hover) and (pointer: fine) {",
        "  .dense-row:hover { background: gray; }", // compound query gate
        "}",
      ].join("\n"),
    );
    const { code, out } = runLinter(clean);
    expect(out).not.toContain("FAIL");
    expect(code).toBe(0);
  });

  it("passes the current client/src CSS surface at its frozen baseline", () => {
    // Full-scope run (no explicit target) — exercises the real baseline,
    // including the stale-entry direction of the ratchet.
    const { code, out } = runLinter();
    expect(out).toContain("PASS");
    expect(code).toBe(0);
  });
});
