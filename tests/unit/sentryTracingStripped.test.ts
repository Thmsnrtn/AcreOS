/**
 * Sentry's tracing machinery is compiled out of both client outputs, and
 * nothing in the client can start a trace.
 *
 * L-P3 (2026-11-18) paid for its client bytes with this in-PR offset, the
 * same move P2-6 S1 made with `__SENTRY_DEBUG__`: vite.config.ts defines
 * `__SENTRY_TRACING__: false`, Sentry's documented tree-shaking flag. The
 * premise is read from the code, not assumed:
 *
 *   - client/src/lib/sentry.ts installs exactly one integration —
 *     replayIntegration. No browserTracing / router tracing integration
 *     means no pageload or navigation transaction is ever started.
 *   - No client file calls a span/transaction API (startSpan,
 *     startTransaction, startInactiveSpan, getActiveSpan, …), so no manual
 *     transaction exists either. Performance signal is web-vitals via
 *     captureMessage, which is not tracing.
 *   - `tracesSampleRate` in the init is therefore inert today; it stays as
 *     the tuning knob for the day a tracing integration is added — and
 *     adding one means removing the define first, or the integration would
 *     silently produce nothing.
 *
 * Two halves pinned: the define is false in the real `buildConfig()` for
 * BOTH outputs, and the no-tracing-API population scan stays clean.
 * Mutation: add a browserTracingIntegration call to sentry.ts → red.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { REPO_SWEEP_TIMEOUT_MS, stripComments } from "../helpers/stripComments";
import { buildConfig } from "../../vite.config";

vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const ROOT = path.join(__dirname, "../..");
const SENTRY_IMPORT = /\bfrom\s*["']@sentry\/[a-z-]+["']|\bimport\(\s*["']@sentry\/[a-z-]+["']\s*\)/;
/** Ways client code could start or observe a Sentry trace. */
const TRACING_API =
  /\b(?:browserTracingIntegration|reactRouterV\dBrowserTracingIntegration|vueBrowserTracingIntegration|startSpan|startSpanManual|startInactiveSpan|startTransaction|getActiveSpan|withActiveSpan|trace\b)/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
}

describe("__SENTRY_TRACING__ is defined false for both client outputs", () => {
  for (const output of ["customer", "founder"] as const) {
    it(`${output} build`, () => {
      const define = buildConfig(output).define ?? {};
      expect(Object.prototype.hasOwnProperty.call(define, "__SENTRY_TRACING__")).toBe(true);
      expect(String(define.__SENTRY_TRACING__)).toBe("false");
    });
  }
});

describe("no client code can start a Sentry trace while the define stands", () => {
  const files = walk(path.join(ROOT, "client/src"));
  const sentryFiles = files.filter((f) => SENTRY_IMPORT.test(stripComments(readFileSync(f, "utf8"))));

  it("finds the Sentry init (vacuity)", () => {
    expect(files.length).toBeGreaterThan(500);
    const rel = sentryFiles.map((f) => path.relative(ROOT, f));
    expect(rel).toContain("client/src/lib/sentry.ts");
  });

  it("sentry.ts installs Replay and no tracing integration", () => {
    const src = stripComments(readFileSync(path.join(ROOT, "client/src/lib/sentry.ts"), "utf8"));
    expect(src).toContain("replayIntegration");
    expect(TRACING_API.test(src)).toBe(false);
  });

  it("no Sentry-importing client file uses a tracing API", () => {
    const offenders = sentryFiles.filter((f) => TRACING_API.test(stripComments(readFileSync(f, "utf8"))));
    expect(offenders.map((f) => path.relative(ROOT, f))).toEqual([]);
  });
});
