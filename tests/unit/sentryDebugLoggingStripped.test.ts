/**
 * Sentry's SDK debug logging is compiled out of both client outputs, and
 * nothing in the client asks for it.
 *
 * P2-6 S1 (the /trust page) paid for its bytes with an in-PR offset:
 * vite.config.ts defines `__SENTRY_DEBUG__: false`, Sentry's documented
 * tree-shaking flag. The SDK gates its debug logging on
 * `DEBUG_BUILD = (typeof __SENTRY_DEBUG__ === 'undefined' || __SENTRY_DEBUG__)`;
 * that logging prints only when `Sentry.init` receives `debug: true`, so with
 * no caller passing `debug` it was dead weight (measured 7,720 bytes off the
 * customer output on dab43df7). Two things must stay true:
 *
 *   1. the define is in the config BOTH outputs are built from — read from the
 *      real `buildConfig()` object, not from the file's text, so a commented-out
 *      or misspelled define fails here;
 *   2. no client file passes `debug` to a Sentry init. With the flag set,
 *      `debug: true` would silently log nothing (Sentry prints one warning
 *      instead). Anyone who needs SDK debug logs removes the define first.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { REPO_SWEEP_TIMEOUT_MS, stripComments } from "../helpers/stripComments";
import { buildConfig } from "../../vite.config";

vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const ROOT = path.join(__dirname, "../..");
const SENTRY_IMPORT = /\bfrom\s*["']@sentry\/[a-z-]+["']|\bimport\(\s*["']@sentry\/[a-z-]+["']\s*\)/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
}

describe("__SENTRY_DEBUG__ is defined false for both client outputs", () => {
  for (const output of ["customer", "founder"] as const) {
    it(`${output} build`, () => {
      const define = buildConfig(output).define ?? {};
      expect(Object.prototype.hasOwnProperty.call(define, "__SENTRY_DEBUG__")).toBe(true);
      // Vite substitutes the value as an expression; false and "false" both
      // compile the DEBUG_BUILD branches away.
      expect(String(define.__SENTRY_DEBUG__)).toBe("false");
    });
  }
});

describe("no client code asks Sentry for debug logging", () => {
  const files = walk(path.join(ROOT, "client/src"));
  const sentryFiles = files.filter((f) => SENTRY_IMPORT.test(stripComments(readFileSync(f, "utf8"))));

  it("finds the Sentry init (vacuity)", () => {
    expect(files.length).toBeGreaterThan(500);
    const rel = sentryFiles.map((f) => path.relative(ROOT, f));
    expect(rel).toContain("client/src/lib/sentry.ts");
    const init = stripComments(readFileSync(path.join(ROOT, "client/src/lib/sentry.ts"), "utf8"));
    expect(init).toMatch(/Sentry\.init\(\{/);
  });

  it("no Sentry-importing client file sets a debug option", () => {
    const offenders = sentryFiles.filter((f) => /\bdebug\s*:/.test(stripComments(readFileSync(f, "utf8"))));
    expect(
      offenders.map((f) => path.relative(ROOT, f)),
      "vite.config.ts compiles Sentry's debug logging out (__SENTRY_DEBUG__: false) — remove that define before enabling Sentry debug",
    ).toEqual([]);
  });
});
