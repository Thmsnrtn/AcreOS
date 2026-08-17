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

const ROOT = path.resolve(__dirname, "../..");
const ROUTES = fs.readFileSync(path.join(ROOT, "server/routes.ts"), "utf8");

/**
 * Blank out line comments so prose mentioning a route (including this fix's own
 * explanatory comment, which lists every bypassed path) is not read as a
 * registration.
 *
 * Deliberately does NOT strip block comments: a naive `/*…*\/` regex over this
 * file matches across unrelated constructs and swallows nearly all of it, which
 * would make every assertion below pass vacuously. Line stripping is sufficient
 * — no route in server/routes.ts is registered inside a block comment, and the
 * "gate exists" assertion would fail loudly if this ever over-stripped again.
 */
function stripComments(src: string): string {
  return src
    .split("\n")
    .map((l) => (l.trimStart().startsWith("//") ? "" : l))
    .join("\n");
}

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
