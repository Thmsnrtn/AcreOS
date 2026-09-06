/**
 * Admin MFA gate ordering.
 *
 * Express evaluates middleware in REGISTRATION order. A gate mounted with
 * `app.use("/api/admin", …)` protects only the `/api/admin/*` handlers
 * registered AFTER it; anything registered above reaches its handler and
 * returns first, and the gate never runs.
 *
 * That is exactly what had happened. `app.use("/api/admin", isAuthenticated,
 * requireClerkMFA)` sat ~700 lines below five of the seven admin surfaces:
 *
 *     /api/admin/finance
 *     /api/admin/support/saved-replies
 *     /api/admin/support/customer-context
 *     /api/admin/feature-flags[/:key]
 *     /api/admin/audit-log/verify[-all]        (registerAdminAuditLogRoutes)
 *     /api/admin/deployments, /api/admin/dr-drills (registerAdminComplianceRoutes)
 *
 * Only `registerAdminRoutes` and `registerAdminRecoveryRoutes` — the two
 * registered immediately below the gate — were covered. The comment beside them
 * claimed the middleware "also covers" them, which was true, and quietly
 * implied a generality the ordering did not provide.
 *
 * SEVERITY, STATED HONESTLY: every affected route was still behind
 * `isAuthenticated` + `requireFounder`, so this was a missing SECOND FACTOR on
 * founder-only surfaces, not an open door. It still matters —
 * `/api/admin/support/customer-context` reads any org's MRR and audit trail,
 * which is precisely the blast radius a second factor exists to bound.
 *
 * This test is a source-order assertion rather than a runtime one because the
 * defect IS a source-order property: no request-level test would have caught it
 * without already knowing which routes to probe.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "../helpers/stripComments";

const ROOT = path.resolve(__dirname, "../..");
const ROUTES = fs.readFileSync(path.join(ROOT, "server/routes.ts"), "utf8");

const SRC = stripComments(ROUTES);

/**
 * Route-file registrars that mount `/api/admin/*` paths internally. A
 * `registerX(app)` call has no literal path at the call site, so the mount
 * order has to be checked at the CALL, not at the path.
 *
 * Verified by reading each file's own route declarations.
 */
const ADMIN_REGISTRARS = [
  { call: "registerAdminAuditLogRoutes(app)", file: "server/routes-admin-audit.ts" },
  { call: "registerAdminComplianceRoutes(app)", file: "server/routes-admin-compliance.ts" },
  { call: "registerAdminRoutes(app)", file: "server/routes-admin.ts" },
  { call: "registerAdminRecoveryRoutes(app)", file: "server/routes-admin-recovery.ts" },
];

function mfaGateIndex(): number {
  const i = SRC.indexOf('app.use("/api/admin", isAuthenticated, requireClerkMFA)');
  expect(i, "the /api/admin MFA gate must exist in server/routes.ts").toBeGreaterThan(-1);
  return i;
}

describe("admin MFA gate ordering", () => {
  it("is registered exactly once", () => {
    const matches = SRC.match(/app\.use\(\s*["']\/api\/admin["']\s*,\s*isAuthenticated\s*,\s*requireClerkMFA/g);
    expect(matches?.length ?? 0).toBe(1);
  });

  it("precedes every literal /api/admin route registration", () => {
    const gate = mfaGateIndex();
    const re = /app\.(?:use|get|post|put|patch|delete)\(\s*["']\/api\/admin[^"']*["']/g;
    const offenders: string[] = [];
    let found = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(SRC)) !== null) {
      found++;
      // The gate itself matches this pattern; skip it.
      if (m.index === gate) continue;
      if (m.index < gate) {
        offenders.push(`${m[0]}  (line ${SRC.slice(0, m.index).split("\n").length})`);
      }
    }
    // Vacuity guard: an ordering check that finds no routes passes for the
    // wrong reason. There are six literal /api/admin registrations plus the
    // gate; if the scanner or the comment-stripper breaks, fail here rather
    // than report a false all-clear.
    expect(found, "scanner found no /api/admin registrations — it is broken").toBeGreaterThanOrEqual(
      6,
    );
    expect(
      offenders,
      `These /api/admin routes are registered ABOVE the MFA gate, so Express\n` +
        `reaches their handlers first and requireClerkMFA never runs:\n` +
        offenders.map((o) => `  ✗ ${o}`).join("\n") +
        `\n\nMove the app.use("/api/admin", …) registration above them.`,
    ).toEqual([]);
  });

  it("precedes every registrar that mounts /api/admin paths internally", () => {
    const gate = mfaGateIndex();
    const offenders: string[] = [];
    for (const reg of ADMIN_REGISTRARS) {
      const at = SRC.indexOf(reg.call);
      expect(at, `${reg.call} must still be called in server/routes.ts`).toBeGreaterThan(-1);
      if (at < gate) offenders.push(reg.call);
    }
    expect(
      offenders,
      `These registrars mount /api/admin/* paths and are called ABOVE the MFA\n` +
        `gate, so their routes bypass it:\n` +
        offenders.map((o) => `  ✗ ${o}`).join("\n"),
    ).toEqual([]);
  });

  it("each listed registrar really does mount an /api/admin path", () => {
    // Guards the list above from rotting into a set of names that no longer
    // touch /api/admin — which would make the ordering check pass vacuously.
    for (const reg of ADMIN_REGISTRARS) {
      const src = fs.readFileSync(path.join(ROOT, reg.file), "utf8");
      expect(src, `${reg.file} should declare an /api/admin path`).toContain("/api/admin");
    }
  });

  it("the gate still sits above the two registrars whose comment claims coverage", () => {
    // registerAdminRoutes / registerAdminRecoveryRoutes were the only two
    // genuinely covered before the fix. They must stay covered.
    const gate = mfaGateIndex();
    expect(SRC.indexOf("registerAdminRoutes(app)")).toBeGreaterThan(gate);
    expect(SRC.indexOf("registerAdminRecoveryRoutes(app)")).toBeGreaterThan(gate);
  });
});

/**
 * ── THE SAME GATE, THE LARGER NAMESPACE ──────────────────────────────────────
 *
 * requireClerkMFA was mounted on exactly ONE prefix. `/api/founder/*` — a far
 * larger namespace — had no second factor at all, and it is where the
 * consequential operations actually live: `DELETE
 * /api/founder/pricing/:tier/promo` is a PRICING CHANGE, one of the four
 * hard-stops CLAUDE.md declares founder-only forever; `/api/founder/finance`,
 * the Meta ad-spend surface, and the v10-v14 sovereign control plane
 * (`versions/:id/deploy`, `versions/:codename/rollback`, `trust/promote`) sit
 * beside it. Founder identity is asserted by email or Clerk user id, so a
 * single compromised founder session reached every one of them.
 *
 * The ordering problem is worse here than it was for /api/admin: the first
 * `/api/founder` handler registers ~1,050 lines ABOVE where the admin gate
 * sits, so "put it next to the other one" would have silently covered nothing.
 *
 * The registrar list below is DERIVED rather than typed. The admin block above
 * hardcodes four names and guards them with a "does this file still mount
 * /api/admin" check — good, but it cannot notice a FIFTH registrar nobody
 * added. Reading routes.ts for every `registerX(app)` call and asking each
 * one's file whether it declares a founder path means a new founder route file
 * is covered the day it is written, which is the failure mode this whole
 * family of gates keeps having.
 */
describe("founder MFA gate ordering", () => {
  const GATE = 'app.use("/api/founder", isAuthenticated, requireClerkMFA)';

  function founderGateIndex(): number {
    const i = SRC.indexOf(GATE);
    expect(
      i,
      "the /api/founder MFA gate is gone from server/routes.ts. The founder " +
        "plane holds the pricing, ad-spend and control-plane surfaces; it does " +
        "not get to be the namespace without a second factor.",
    ).toBeGreaterThan(-1);
    return i;
  }

  /** Every `registerX(app)` call in routes.ts, paired with its defining file. */
  function registrars(): Array<{ call: string; file: string; index: number }> {
    const out: Array<{ call: string; file: string; index: number }> = [];
    const seen = new Set<string>();
    const re = /\b(register[A-Za-z0-9_]*)\s*\(\s*app\b/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(SRC)) !== null) {
      const name = m[1];
      if (seen.has(name)) continue;
      seen.add(name);
      const file = fileDefining(name);
      if (file) out.push({ call: name, file, index: m.index });
    }
    return out;
  }

  /** Locate the server file that exports a given registrar. */
  function fileDefining(name: string): string | null {
    const stack = ["server"];
    while (stack.length > 0) {
      const dir = stack.pop()!;
      for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        const rel = `${dir}/${entry.name}`;
        if (entry.isDirectory()) {
          if (!["node_modules", "__tests__", "__mocks__"].includes(entry.name)) stack.push(rel);
          continue;
        }
        if (!entry.name.endsWith(".ts") || /\.(test|spec)\.ts$/.test(entry.name)) continue;
        const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
        if (new RegExp(`export\\s+(?:async\\s+)?function\\s+${name}\\b`).test(src)) return rel;
      }
    }
    return null;
  }

  it("is registered exactly once", () => {
    const matches = SRC.match(
      /app\.use\(\s*["']\/api\/founder["']\s*,\s*isAuthenticated\s*,\s*requireClerkMFA/g,
    );
    expect(matches?.length ?? 0).toBe(1);
  });

  it("precedes every literal /api/founder route registration", () => {
    const gate = founderGateIndex();
    const re = /app\.(?:use|get|post|put|patch|delete)\(\s*["']\/api\/founder[^"']*["']/g;
    const offenders: string[] = [];
    let found = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(SRC)) !== null) {
      found++;
      if (m.index === gate) continue;
      if (m.index < gate) offenders.push(`${m[0]}  (line ${SRC.slice(0, m.index).split("\n").length})`);
    }
    // Vacuity: an ordering check that finds no routes passes for the wrong
    // reason. There were 30+ literal /api/founder registrations when this was
    // written; a scanner or comment-stripper failure must be loud.
    expect(found, "scanner found almost no /api/founder registrations — it is broken")
      .toBeGreaterThanOrEqual(10);
    expect(
      offenders,
      "These /api/founder routes are registered ABOVE the MFA gate, so Express\n" +
        "reaches their handlers first and requireClerkMFA never runs:\n" +
        offenders.map((o) => `  ✗ ${o}`).join("\n") +
        '\n\nMove the app.use("/api/founder", …) registration above them.',
    ).toEqual([]);
  });

  it("precedes every registrar whose file mounts an /api/founder path", () => {
    const gate = founderGateIndex();
    const all = registrars();
    // Vacuity: the derivation has to be finding registrars at all.
    expect(all.length, "no registerX(app) calls were resolved to files").toBeGreaterThan(10);

    const founderOnes = all.filter(({ file }) =>
      fs.readFileSync(path.join(ROOT, file), "utf8").includes("/api/founder"),
    );
    expect(
      founderOnes.length,
      "no registrar was found to mount /api/founder — the derivation is broken, " +
        "and a broken derivation reports every ordering as correct",
    ).toBeGreaterThan(3);

    const offenders = founderOnes.filter((r) => r.index < gate).map((r) => `${r.call}  (${r.file})`);
    expect(
      offenders,
      "These registrars mount /api/founder/* paths and are called ABOVE the MFA\n" +
        "gate, so their routes bypass it:\n" +
        offenders.map((o) => `  ✗ ${o}`).join("\n"),
    ).toEqual([]);
  });

  it("sits above the admin gate, because the first founder route is far above it", () => {
    // Not cosmetic. The admin gate is ~1,050 lines below the first
    // /api/founder handler, so a founder gate placed beside it would cover
    // nothing while looking correct — the exact shape of the bug the admin
    // block above records.
    expect(founderGateIndex()).toBeLessThan(mfaGateIndex());
  });
});
