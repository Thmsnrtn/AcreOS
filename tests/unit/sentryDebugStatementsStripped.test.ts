/**
 * 2026-11-08 bundle trim (S-BUNDLE-2): vite.config.ts defines
 * `__SENTRY_DEBUG__` false, which drops Sentry's internal debug-log
 * statements from the client bundle (~8 KB of vendor-react). Those statements
 * only ever print when debug logging is switched on — `debug: true` in
 * Sentry.init, or enabling Sentry's debug logger at runtime. So the define is
 * behaviour-neutral exactly while nothing switches it on, and this pins the
 * pair: EITHER the define is absent, OR no client/shared/package file that
 * imports Sentry turns debug logging on. Adding `debug: true` without removing
 * the define fails here, instead of shipping a switch that silently does
 * nothing.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { REPO_SWEEP_TIMEOUT_MS, stripComments } from "../helpers/stripComments";

vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const ROOT = path.join(__dirname, "../..");
const SCAN_DIRS = ["client/src", "shared", "packages"];
const SENTRY_IMPORT = /\bfrom\s*["']@sentry\/[^"']+["']|\bimport\(\s*["']@sentry\/[^"']+["']\s*\)/;
// `debug: …` / `{ debug }` shorthand in an options object, or the runtime switch.
const TURNS_DEBUG_ON = /\bdebug\s*:|[{,]\s*debug\s*[,}]|\bdebug\s*\.\s*enable\s*\(|\blogger\s*\.\s*enable\s*\(/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
}

describe("Sentry debug statements are stripped only while nothing turns them on", () => {
  const config = stripComments(readFileSync(path.join(ROOT, "vite.config.ts"), "utf8"));
  const defineBlock = config.slice(config.indexOf("define:"), config.indexOf("plugins:"));
  const stripped = /__SENTRY_DEBUG__\s*:\s*["']false["']/.test(defineBlock);

  const files = SCAN_DIRS.flatMap((d) => walk(path.join(ROOT, d)));
  const consumers = files.filter((f) => SENTRY_IMPORT.test(stripComments(readFileSync(f, "utf8"))));

  it("reads the Sentry consumers (vacuity floor)", () => {
    expect(files.length).toBeGreaterThan(1000);
    const rel = consumers.map((f) => path.relative(ROOT, f));
    expect(rel).toContain("client/src/lib/sentry.ts");
    expect(stripComments(readFileSync(path.join(ROOT, "client/src/lib/sentry.ts"), "utf8"))).toMatch(/\bSentry\.init\s*\(/);
  });

  it("the define is in the build's define block", () => {
    expect(stripped).toBe(true);
  });

  it("no Sentry consumer turns debug logging on while the define strips it", () => {
    if (!stripped) return;
    const offenders = consumers.filter((f) => TURNS_DEBUG_ON.test(stripComments(readFileSync(f, "utf8"))));
    expect(
      offenders.map((f) => path.relative(ROOT, f)),
      "Sentry debug logging is compiled out (vite.config.ts __SENTRY_DEBUG__) — remove that define before turning debug on",
    ).toEqual([]);
  });

  it("the predicate catches the shapes it guards (canary)", () => {
    for (const s of ["Sentry.init({ dsn, debug: true })", "Sentry.init({ dsn, debug })", "debug.enable()", "logger.enable()"]) {
      expect(TURNS_DEBUG_ON.test(s), s).toBe(true);
    }
    expect(TURNS_DEBUG_ON.test("Sentry.init({ dsn, environment })")).toBe(false);
  });
});
