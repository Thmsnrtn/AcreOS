/**
 * Every `/api/founder/*` route must be founder-gated.
 *
 * The founder plane reads across ORGANIZATIONS — platform MRR, per-org cost,
 * other tenants' audit trails. It is the one surface in this repo where a
 * missing guard is a CROSS-TENANT leak rather than an intra-org one, and it has
 * 608 routes registered from 40-odd files with **no global mount**. Nothing
 * related the set to its guard.
 *
 * It found one: `GET /api/founder/safety-status` carried `isAuthenticated` and
 * `getOrCreateOrg` only, and its query reads `simulated_actions` with no
 * organization filter — returning ten recent rows, payloads included, to any
 * authenticated user of any org. A simulated Lob payload carries a recipient
 * name and mailing address.
 *
 * FOUR GUARD MECHANISMS, WHICH IS WHY THIS IS HARD
 * ------------------------------------------------
 * Writing this took three wrong answers before a right one, and each wrong
 * answer was a large FALSE POSITIVE — 378, then 322, then 20 "unguarded" routes
 * that were all fine. The surface guards itself four different ways:
 *
 *   1. middleware in the registration:  app.get(path, …, requireFounder, h)
 *   2. an in-handler first statement:   if (!requireFounder(req, res)) return;
 *   3. a prefix mount in routes.ts:     app.use('/api/founder/v11', …, requireFounder)
 *   4. a spread guard array:            const guards = [...]; app.get(p, ...guards, h)
 *
 * A checker that models only some of them reports healthy code as broken, which
 * is the failure that gets a security test deleted. **The lesson is the opposite
 * of the usual one**: here the danger was over-reporting, and the only way
 * through was to verify every candidate by hand before believing the number.
 *
 * ORDER MATTERS for mechanism 3, and this repo has already been bitten by
 * exactly that: the `/api/admin` MFA gate was registered BELOW five of the seven
 * routes it was meant to protect, so they reached their handlers first. A prefix
 * mount only counts here if it appears before the routes it covers.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");

/** Line-based comment stripping — see the note in destructivePermissionCoverage. */
function stripComments(src: string): string {
  const out: string[] = [];
  let inBlock = false;
  for (const line of src.split("\n")) {
    let s = line;
    if (inBlock) {
      const end = s.indexOf("*/");
      if (end === -1) { out.push(""); continue; }
      s = s.slice(end + 2);
      inBlock = false;
    }
    const open = s.indexOf("/*");
    if (open > -1) {
      const close = s.indexOf("*/", open + 2);
      if (close > -1) s = s.slice(0, open) + s.slice(close + 2);
      else if (/^\s*\{?\s*\/\*/.test(s)) { s = s.slice(0, open); inBlock = true; }
    }
    out.push(s.replace(/(^|[^:])\/\/.*$/, "$1"));
  }
  if (inBlock) throw new Error("stripComments ran away — assertions would be meaningless.");
  return out.join("\n");
}

const GUARD =
  /requireFounder|isFounderAdmin|isFounderIdentity|requireFounderOrBot|founderOnly|isFounder\b/;

function routeFiles(): string[] {
  return fs
    .readdirSync(path.join(ROOT, "server"))
    .filter((f) => /^routes.*\.ts$/.test(f));
}

function src(file: string): string {
  return stripComments(fs.readFileSync(path.join(ROOT, "server", file), "utf8"));
}

interface Finding { file: string; method: string; route: string }

function scan(): { total: number; unguarded: Finding[]; prefixGates: number } {
  const routesSrc = src("routes.ts");

  // Mechanism 3: prefix mounts that carry a founder guard, with their position.
  const prefixGates: Array<{ prefix: string; pos: number }> = [];
  for (const m of routesSrc.matchAll(/app\.use\(\s*['"`](\/api\/founder[^'"`]*)['"`]([^\n]*)/g)) {
    if (GUARD.test(m[2])) prefixGates.push({ prefix: m[1], pos: m.index ?? 0 });
  }

  // Where each route FILE's registrar is invoked, so ordering can be compared.
  const registrarPos = new Map<string, number>();
  for (const m of routesSrc.matchAll(/await\s+import\(\s*['"`]\.\/(routes[\w-]+)['"`]\s*\)/g)) {
    if (!registrarPos.has(m[1])) registrarPos.set(m[1], m.index ?? 0);
  }

  const unguarded: Finding[] = [];
  let total = 0;
  for (const f of routeFiles()) {
    const s = src(f);
    const filePos =
      f === "routes.ts" ? null : registrarPos.get(f.replace(/\.ts$/, "")) ?? Infinity;
    for (const m of s.matchAll(
      /(?:app|api|router)\.(get|post|put|patch|delete)\(\s*["'`](\/api\/founder\/[^"'`]*)["'`]/g,
    )) {
      total++;
      const at = m.index ?? 0;
      // Mechanisms 1, 2 and 4 all appear within the registration + handler head.
      // 4 is covered because `...guards` expands from a const in the same file,
      // so the ARRAY is checked separately below.
      const window = s.slice(at, at + 1400);
      if (GUARD.test(window)) continue;
      // Mechanism 4: a spread of a guard array declared in this file.
      const spread = /\.\.\.(\w*[Gg]uards?\w*)/.exec(window);
      if (spread) {
        const decl = new RegExp(`const\\s+${spread[1]}\\s*=\\s*\\[([^\\]]*)\\]`).exec(s);
        if (decl && GUARD.test(decl[1])) continue;
      }
      // Mechanism 3: a prefix mount, but only if registered BEFORE these routes.
      const routePos = f === "routes.ts" ? at : (filePos as number);
      const covered = prefixGates.some(
        (g) =>
          (m[2] === g.prefix || m[2].startsWith(g.prefix + "/")) && g.pos < routePos,
      );
      if (covered) continue;
      unguarded.push({ file: f, method: m[1].toUpperCase(), route: m[2] });
    }
  }
  return { total, unguarded, prefixGates: prefixGates.length };
}

describe("the founder plane is founder-gated", () => {
  const result = scan();

  it("finds the founder surface at all (vacuity guard)", () => {
    // A renamed prefix or a changed registration style would otherwise make this
    // whole file pass by checking nothing.
    expect(result.total, "no /api/founder routes found — has the shape changed?")
      .toBeGreaterThan(400);
    expect(result.prefixGates, "no founder prefix mounts found").toBeGreaterThan(0);
  });

  it("every route carries a guard by one of the four mechanisms", () => {
    const listed = result.unguarded
      .map((u) => `${u.file}  ${u.method} ${u.route}`)
      .join("\n");
    expect(
      result.unguarded.length,
      `founder routes with NO founder guard:\n${listed}\n\n` +
        "The founder plane reads across organizations, so a missing guard here is " +
        "a cross-tenant leak. Add requireFounder to the registration, or an " +
        "in-handler `if (!requireFounder(req, res)) return;` as its first statement.",
    ).toBe(0);
  });

  it("a prefix mount only counts when it is registered FIRST", () => {
    // The /api/admin MFA defect was exactly this: a gate registered below five
    // of the seven routes it was meant to protect, so they reached their
    // handlers before it ever ran. Asserted structurally so the ordering rule
    // cannot be dropped from the scanner without this failing.
    const routesSrc = src("routes.ts");
    const v11Gate = routesSrc.indexOf("app.use('/api/founder/v11'");
    const v11Register = routesSrc.indexOf("registerFounderV11Routes(app)");
    expect(v11Gate, "the v11 prefix gate is gone").toBeGreaterThan(-1);
    expect(v11Register, "the v11 registrar call is gone").toBeGreaterThan(-1);
    expect(v11Gate, "the v11 gate is registered AFTER its routes").toBeLessThan(
      v11Register,
    );
  });

  it("the safety-status endpoint that this found stays gated", () => {
    // It reads simulated_actions with NO organization filter and returns ten
    // rows with payloads. The fix is the guard, not an org filter — scoping the
    // query would break the platform-wide view the endpoint exists to give.
    const org = src("routes-organization.ts");
    const at = org.indexOf('"/api/founder/safety-status"');
    expect(at, "safety-status route not found").toBeGreaterThan(-1);
    const line = org.slice(at, org.indexOf("\n", at));
    expect(line, "safety-status lost its founder guard").toContain("requireFounder");
  });
});
