/**
 * lint-page-hex ratchet tests (W2-10b, 2026-06-11).
 *
 * Locks in the three properties that make scripts/lint-page-hex.mjs
 * trustworthy (same pattern as voiceLinter.test.ts):
 *   1. It CATCHES hex color literals in page code (theming breakers —
 *      chart colors belong in lib/chart-colors.ts, UI colors in Tailwind
 *      tokens) → exit 1.
 *   2. It does NOT false-positive on comments, HTML entities (&#8984;),
 *      issue/ticket refs (#128, #2026-PR-1234), or URL fragments → exit 0.
 *   3. The CURRENT client/src/pages surface passes at its frozen baseline.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");
const LINTER = join(REPO_ROOT, "scripts", "lint-page-hex.mjs");

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

describe("lint-page-hex", () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "lint-page-hex-"));
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("catches hex color literals in page code", () => {
    const bad = join(dir, "bad.tsx");
    writeFileSync(
      bad,
      [
        'const COLOR = "#2563eb";', // 6-digit
        'const SHORT = "#fff";', // 3-digit, letters
        'const BLACK = "#000";', // 3-digit, repeated-digit
        "export function Dot() {",
        '  return <span style={{ background: "#ef4444aa" }} />;', // 8-digit
        "}",
      ].join("\n"),
    );
    const { code, out } = runLinter(bad);
    expect(code).toBe(1);
    expect(out).toContain("FAIL");
    expect(out).toContain("#2563eb");
    expect(out).toContain("#fff");
    expect(out).toContain("#000");
    expect(out).toContain("#ef4444aa");
    expect(out).toContain("chart-colors");
  });

  it("does NOT false-positive on comments, entities, refs, or fragments", () => {
    const clean = join(dir, "clean.tsx");
    writeFileSync(
      clean,
      [
        "// Panel-300 #128 closed this loop; accent was #FFB547 before tokens.",
        "/* Roadmap #146 / #209 — contact dedupe across sources. */",
        "export function Page() {",
        "  return (",
        "    <div>",
        "      <span>Press &#8984;K to search</span>",
        '      <a href="#features">Jump to features</a>',
        '      <input placeholder="Probate order #2026-PR-1234, ticket #12345" />',
        '      <p>Note #2204-A is current</p>',
        "    </div>",
        "  );",
        "}",
      ].join("\n"),
    );
    const { code, out } = runLinter(clean);
    expect(out).not.toContain("FAIL");
    expect(code).toBe(0);
  });

  it("passes the current client/src/pages surface at its frozen baseline", () => {
    // Full-scope run (no explicit target) — exercises the real baseline,
    // including the stale-entry direction of the ratchet.
    const { code, out } = runLinter();
    expect(out).toContain("PASS");
    expect(code).toBe(0);
  });
});
