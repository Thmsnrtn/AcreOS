/**
 * Voice-linter tests (Soren, 2026-06-06).
 *
 * Locks in the two properties that make scripts/voice-lint.mjs trustworthy:
 *   1. It CATCHES the real doctrine violations (competitor names, founder
 *      first-person, wrong terminology, persona leakage, dark patterns,
 *      flattery, we-believe) in customer-facing copy → exit 1.
 *   2. It does NOT false-positive on code comments, CSS classNames, or import
 *      paths (the masking layer) → those same tokens in comments pass.
 *   3. The CURRENT customer-facing surface passes with zero ERRORS (warnings
 *      from the numeric-claim provenance rule are allowed — they don't block).
 *
 * Spec: docs/internal/marketing-os/02-voice-linter.md.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");
const LINTER = join(REPO_ROOT, "scripts", "voice-lint.mjs");

/** Run the linter against an absolute target; return { code, stdout }. */
function runLinter(target: string): { code: number; out: string } {
  try {
    const out = execFileSync("node", [LINTER, target], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    return { code: 0, out };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

describe("voice-lint", () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "voice-lint-"));
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("catches doctrine violations in customer-facing string literals", () => {
    const bad = join(dir, "bad.tsx");
    writeFileSync(
      bad,
      [
        "export const Copy = {",
        '  a: "I built AcreOS for real estate professionals like you.",',
        '  b: "Only 3 spots left — act now before they go!",',
        '  c: "You\'re a serious operator.",',
        '  d: "We believe land deals should be simple.",',
        '  e: "Unlike Land Geek and GeekPay, AcreOS ships servicing.",',
        '  f: "Ask Solene if you get stuck.",',
        "};",
      ].join("\n"),
    );
    const { code, out } = runLinter(bad);
    expect(code).toBe(1);
    expect(out).toContain("voice/no-real-estate-professional");
    expect(out).toContain("voice/no-founder-first-person");
    expect(out).toContain("voice/no-dark-pattern-urgency");
    expect(out).toContain("voice/no-you-flattery");
    expect(out).toContain("voice/no-we-believe");
    expect(out).toContain("voice/no-competitor-land-geek");
    expect(out).toContain("voice/no-competitor-geekpay");
    expect(out).toContain("voice/no-internal-persona");
  });

  it("does NOT false-positive on comments, classNames, or import paths", () => {
    const clean = join(dir, "clean.tsx");
    writeFileSync(
      clean,
      [
        '// Internal agents (Atlas/Sophie/Forge) and Solene are not surfaced here.',
        "/* Maturity verified against Rafe CCO report; Iris owns the routing. */",
        'import { Thing } from "@/components/lp-hv-atlas-card";',
        "export function Hero() {",
        "  return (",
        '    <div className="lp-hero-card lp-hv-atlas lp-hv-sophie">',
        '      <h1>The operating system for Land Investors.</h1>',
        "    </div>",
        "  );",
        "}",
      ].join("\n"),
    );
    const { code, out } = runLinter(clean);
    expect(out).not.toContain("ERROR");
    expect(code).toBe(0);
  });

  it("passes the current customer-facing surface with zero ERRORS", () => {
    // Full scope run (no explicit target). Warnings are allowed; ERRORS block.
    const { code, out } = runLinter(join(REPO_ROOT, "client/src/pages/landing"));
    expect(out).not.toContain("ERROR");
    expect(code).toBe(0);
  });
});
