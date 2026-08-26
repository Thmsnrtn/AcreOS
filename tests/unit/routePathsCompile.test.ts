/**
 * EVERY ROUTE PATH MUST COMPILE — the gate that would have prevented the
 * 2026-08-25 production outage, and the one class of defect this repo's whole
 * pipeline is structurally blind to.
 *
 * WHAT HAPPENED. `express` is ^5.2.1, which ships path-to-regexp v8. v8 REMOVED
 * inline regex route params. Three routes in server/routes-decisions.ts were
 * declared `router.get("/:id(\\d+)")`. Under v8 that does not compile a
 * pattern — it THROWS, at route REGISTRATION time:
 *
 *   TypeError: Unexpected ( at index 4: /:id(\d+)
 *
 * Registration happens during boot, before the server binds :5000. So every app
 * machine crash-looped with exit_code=1, wrote zero application log lines, and
 * Fly reported "instance refused connection. is your app listening on
 * 0.0.0.0:5000?". Production was down for hours.
 *
 * WHY NOTHING CAUGHT IT. This is the important part. The bug shipped through a
 * completely green pipeline:
 *
 *   - 12,918 tests passed. The suite mounts routers INDIVIDUALLY or mocks them;
 *     nothing constructs the whole app, so a registration-time throw is never
 *     executed.
 *   - `npm run check` passed. `/:id(\\d+)` is a perfectly well-typed string.
 *     TypeScript has no opinion about its runtime meaning.
 *   - `npm run build` passed. esbuild bundles a string literal happily.
 *
 * Three gates, all green, none of which executes route registration. The defect
 * was introduced 2026-08-12 and sat undetected for eleven days — invisible only
 * because a SEPARATE broken gate (the check:tests OOM) was blocking every deploy
 * and therefore accidentally shielding production from it.
 *
 * WHAT THIS GATE DOES, and why it is a semantic test rather than a grep. It does
 * not scan for the string "(\\d+)". It extracts every route path literal in
 * server/ and hands each one to THE REAL path-to-regexp — the same compiler
 * Express itself calls at registration. So it fails on exactly the inputs
 * Express would reject, including forms nobody has thought to grep for (Express
 * 5 also changed `*` to `*splat`, made `?` illegal, and so on). Mutating the
 * thing the gate governs — putting an inline regex back — turns it red.
 *
 * MEASURED 2026-08-26: 3,098 path literals across server/, 0 failing after the
 * fix. Before the fix, exactly the three /:id(\\d+) routes failed.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

// path-to-regexp arrives via express. Loaded through createRequire so this test
// does not depend on the package's type surface, which would otherwise risk
// adding an entry to the tests-typecheck ratchet population.
const nodeRequire = createRequire(__filename);
const { pathToRegexp } = nodeRequire("path-to-regexp") as {
  pathToRegexp: (p: string) => unknown;
};

const ROOT = path.resolve(__dirname, "../..");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!/node_modules|dist|build/.test(p)) walk(p, out);
    } else if (/\.tsx?$/.test(entry.name)) {
      // *.test.ts files contain REQUEST urls (with query strings like
      // "?limit=2"), not route registrations. Those are not paths Express ever
      // compiles, and including them would fail this gate for a non-defect.
      if (!/\.(test|spec)\.tsx?$/.test(entry.name)) out.push(p);
    }
  }
  return out;
}

/** `.get("/x")`, `.post('/y')`, `.use("/z")` … — the literal, not template strings. */
const ROUTE_CALL = /\.(get|post|put|patch|delete|all|use)\(\s*(["'])(\/[^"'`]*)\2/g;

describe("every registered route path compiles under the installed path-to-regexp", () => {
  const files = walk(path.join(ROOT, "server"));
  const found: Array<{ file: string; routePath: string }> = [];

  for (const file of files) {
    const src = fs.readFileSync(file, "utf8");
    let m: RegExpExecArray | null;
    ROUTE_CALL.lastIndex = 0;
    while ((m = ROUTE_CALL.exec(src)) !== null) {
      found.push({ file: path.relative(ROOT, file), routePath: m[3] });
    }
  }

  it("the scan actually found routes — vacuity guard", () => {
    // A scan that matches nothing passes the real assertion below at zero, which
    // reads exactly like a clean bill of health. Measured 3,098 on 2026-08-26;
    // the floor is deliberately far below that so ordinary churn cannot trip it,
    // while a regex that stops matching still fails loudly.
    expect(
      found.length,
      "the route-path scan matched almost nothing — the pattern has rotted, " +
        "not the codebase gone routeless",
    ).toBeGreaterThan(2000);
    expect(files.length).toBeGreaterThan(500);
  });

  it("compiles every one of them, exactly as Express does at registration", () => {
    const failures: string[] = [];
    for (const { file, routePath } of found) {
      try {
        pathToRegexp(routePath);
      } catch (err) {
        failures.push(`${file}: ${JSON.stringify(routePath)} — ${(err as Error).message}`);
      }
    }
    expect(
      failures,
      "These route paths THROW when Express registers them, which crashes the " +
        "process on boot before it binds :5000 — not a 500 on one endpoint, a " +
        "total outage. Express 5 (path-to-regexp v8) removed inline regex " +
        "params: replace `/:id(\\d+)` with `/:id` plus a guard that calls " +
        "next(\"route\") for non-matching values, which preserves fall-through.",
    ).toEqual([]);
  });

  it("the compiler this gate uses really does reject the outage's pattern", () => {
    // Falsification, in-line: if path-to-regexp were ever swapped for something
    // permissive, every assertion above would pass vacuously while the defect
    // sailed through. Prove the detector still detects.
    expect(() => pathToRegexp("/:id(\\d+)")).toThrow();
    expect(() => pathToRegexp("/:id")).not.toThrow();
  });
});
