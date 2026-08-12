/**
 * A declared permission that nothing enforces is not a permission.
 *
 * `RolePermissions` declares `canDeleteLeads`, `canDeleteProperties`,
 * `canDeleteDeals` and `canDeleteNotes`, and every one of them is FALSE for the
 * `member`, `va` and `viewer` roles. Only `canDeleteLeads` was ever enforced.
 *
 * `DELETE /api/properties/:id`, `POST /api/properties/bulk-delete` and
 * `POST /api/deals/bulk-delete` carried `isAuthenticated` and `getOrCreateOrg`
 * and nothing else — so a **viewer**, a role whose entire purpose is read-only
 * access, could delete every property and every deal in the organization.
 *
 * SEVERITY, STATED HONESTLY: intra-org, not cross-tenant. All three paths are
 * org-scoped, so nothing crossed an organization boundary. What was unenforced
 * is the org owner's own configuration — and unlike the assigned-leads gap found
 * alongside it, this one had **no enforcement anywhere at all**: the permission
 * existed in the type, in the role table and in the client's `useOrganization`
 * shape, and was checked by no server code on any path.
 *
 * WHY A REGISTRY AND NOT THREE ASSERTIONS
 * ---------------------------------------
 * The defect was not "someone forgot a middleware on one route". It was that
 * **nothing related the permission vocabulary to the routes that need it**, so a
 * permission could be declared, shipped, read by the client, and never once
 * consulted. Three hand-written assertions would fix the three known routes and
 * leave the next one exactly as undiscoverable. This maps each destructive
 * permission to the routes that must enforce it, and fails when a route in the
 * map loses its gate — or when a permission in the map has no route at all,
 * which is how `canDeleteProperties` sat unenforced.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

/**
 * Source with comments stripped — a rule must hold in CODE, not in prose.
 *
 * LINE-BY-LINE, deliberately. The obvious one-regex implementation is wrong on
 * real source: an unbalanced block-comment OPENER inside a string or a regex
 * literal starts a comment that never closes where you expect, and everything
 * up to the next closer vanishes. Measured on
 * server/routes.ts it removed **38.8% of the file**, including the
 * `app.use("/api/admin", …)` line an assertion here was checking — so the
 * assertion failed against correct code, and a weaker assertion would have
 * PASSED against broken code.
 *
 * A state machine over lines cannot run away: a block comment must open and
 * close on lines, and a stray opener inside a string affects at most the
 * rest of that one line.
 */
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
    // Only treat `/*` as a comment when the line has no closing `*/` after it
    // AND the line looks like a comment line — anything else stays.
    const open = s.indexOf("/*");
    if (open > -1) {
      const close = s.indexOf("*/", open + 2);
      if (close > -1) {
        s = s.slice(0, open) + s.slice(close + 2);
      } else if (/^\s*\{?\s*\/\*/.test(s)) {
        // `{/*` too: a JSX comment is prose, and prose must not satisfy a
        // code assertion. Without this, a `{/* No "dismiss" ... */}` comment
        // made a test asserting the ABSENCE of "dismiss" fail on the very
        // comment documenting why it is absent.
        s = s.slice(0, open);
        inBlock = true;
      }
    }
    out.push(s.replace(/(^|[^:])\/\/.*$/, "$1"));
  }
  // The guard is STRUCTURAL, not a ratio.
  //
  // A ratio was tried first — "a strip that eats a third of the file is a bug"
  // — and it fired on correct output: this repo's files are deliberately
  // comment-heavy, and server/utils/assignedLeadGate.ts is 72% prose by design.
  // A guard whose premise is wrong is worse than no guard, because it fails on
  // correct input and trains the next reader to loosen it.
  //
  // An unclosed block at EOF is the real signal: it means an opener was taken
  // for a comment that never ended, which is precisely the runaway this
  // function exists to prevent. Comment density is not evidence of anything.
  if (inBlock) {
    throw new Error(
      "stripComments reached EOF inside an unclosed block comment — an opener " +
        "was mistaken for one; assertions against this output would be meaningless.",
    );
  }
  return out.join("\n");
}

function code(rel: string): string {
  return stripComments(read(rel));
}

/**
 * Every DESTRUCTIVE route, and the declared permission it must enforce.
 *
 * "Destructive" means it removes customer records. Soft or hard delete makes no
 * difference: a soft-deleted lead is gone from every list the customer looks at,
 * so the authorization question is identical.
 */
/** Every route file, concatenated — used to prove a route does NOT exist. */
const ALL_ROUTE_SRC = fs
  .readdirSync(path.join(ROOT, "server"))
  .filter((f) => f.startsWith("routes") && f.endsWith(".ts"))
  .map((f) => code(`server/${f}`))
  .join("\n");

const DESTRUCTIVE_ROUTES = [
  { file: "server/routes-leads.ts", match: 'api.delete("/api/leads/:id"', permission: "canDeleteLeads" },
  { file: "server/routes-leads.ts", match: 'api.post("/api/leads/bulk-delete"', permission: "canDeleteLeads" },
  { file: "server/routes-properties.ts", match: 'api.delete("/api/properties/:id"', permission: "canDeleteProperties" },
  { file: "server/routes-properties.ts", match: 'api.post("/api/properties/bulk-delete"', permission: "canDeleteProperties" },
  { file: "server/routes-deals.ts", match: 'api.post("/api/deals/bulk-delete"', permission: "canDeleteDeals" },
  // Found BY this test: the exemption claimed no notes delete endpoint existed.
  // One does, in routes-finance.ts, and it was unguarded — so canDeleteNotes was
  // the fourth unenforced permission, not a routeless one.
  { file: "server/routes-finance.ts", match: 'api.delete("/api/notes/:id"', permission: "canDeleteNotes" },
] as const;

/** The route registration line — from the match to the end of that line. */
function registration(src: string, match: string): string {
  const at = src.indexOf(match);
  if (at === -1) return "";
  const end = src.indexOf("\n", at);
  return end === -1 ? src.slice(at) : src.slice(at, end);
}

describe("every destructive route enforces its declared permission", () => {
  it("finds every route it claims to check (vacuity guard)", () => {
    // Without this a renamed path makes the file pass by checking nothing —
    // the failure mode of every source-scanning security test.
    for (const r of DESTRUCTIVE_ROUTES) {
      expect(
        registration(code(r.file), r.match).length,
        `${r.match} not found in ${r.file} — renamed?`,
      ).toBeGreaterThan(0);
    }
  });

  it("names the permission in the route's own middleware chain", () => {
    for (const r of DESTRUCTIVE_ROUTES) {
      const line = registration(code(r.file), r.match);
      expect(line, `${r.match} does not enforce ${r.permission}`).toContain(
        `requirePermission("${r.permission}")`,
      );
    }
  });

  it("the gate precedes the handler, not something inside it", () => {
    // requirePermission is middleware. A check written inside the handler after
    // the delete has already run would satisfy a naive substring search and
    // protect nothing, so the assertion is anchored to the registration LINE.
    for (const r of DESTRUCTIVE_ROUTES) {
      const line = registration(code(r.file), r.match);
      expect(line.indexOf("requirePermission(")).toBeGreaterThan(-1);
      expect(line).toMatch(/async \(req, res\) =>|async \(\s*req/);
      expect(
        line.indexOf("requirePermission("),
        `${r.match}: gate is not before the handler`,
      ).toBeLessThan(line.indexOf("async ("));
    }
  });
});

/**
 * Non-delete routes whose permission was ALSO unenforced.
 *
 * Found by continuing the same audit past the delete verbs. Each is a mutation
 * that `member`, `va` and `viewer` are denied by the role table and could
 * perform anyway.
 */
const PRIVILEGED_ROUTES = [
  {
    file: "server/routes-organization.ts",
    match: 'api.post("/api/organization/seats/purchase"',
    permission: "canManageBilling",
    // Creates a Stripe checkout session and writes stripeCustomerId onto the
    // org. NOT a silent charge — completing it requires card entry — but it is
    // a billing action that mutates billing state, started by a role the owner
    // denied billing access to. canManageBilling is true for OWNER ONLY, not
    // even admin.
  },
  {
    file: "server/routes-organization.ts",
    match: 'api.patch("/api/organization/ai-settings"',
    permission: "canAccessSettings",
  },
] as const;

describe("privileged non-delete mutations enforce their permission too", () => {
  it("finds every route it claims to check (vacuity guard)", () => {
    for (const r of PRIVILEGED_ROUTES) {
      expect(
        registration(code(r.file), r.match).length,
        `${r.match} not found — renamed?`,
      ).toBeGreaterThan(0);
    }
  });

  it("names the permission in the route's own middleware chain", () => {
    for (const r of PRIVILEGED_ROUTES) {
      expect(
        registration(code(r.file), r.match),
        `${r.match} does not enforce ${r.permission}`,
      ).toContain(`requirePermission("${r.permission}")`);
    }
  });

  it("the settings endpoint is gated by FIELD, not wholesale", () => {
    // PATCH /api/organization/settings mixes per-org UI state any member
    // legitimately toggles (showTips, checklistDismissed) with org-wide
    // operational settings (mailMode, timezone, currency) that canAccessSettings
    // exists to deny. Gating the whole route would stop a member dismissing
    // their own checklist — a real regression to fix a real gap.
    const src = code("server/routes-organization.ts");
    const h = src.slice(src.indexOf('api.patch("/api/organization/settings"'));
    expect(h).toContain("attachPermissionContext()");
    expect(h).toMatch(/ORG_WIDE_SETTINGS = \["mailMode", "timezone", "currency"\]/);
    expect(h).toMatch(/touchesOrgWide && !\(req as AuthenticatedRequest\)\.permissionContext\?\.permissions\.canAccessSettings/);
    // The benign fields must NOT be in the refused set.
    const set = h.slice(h.indexOf("ORG_WIDE_SETTINGS"), h.indexOf("touchesOrgWide"));
    for (const benign of ["showTips", "checklistDismissed", "notificationsConfigured"]) {
      expect(set, `${benign} must stay writable by a member`).not.toContain(benign);
    }
  });
});

/**
 * BULK EXPORT is an exfiltration boundary.
 *
 * `canExportData` is FALSE for `member`, `va` and `viewer`, and it was enforced
 * on exactly ONE of nine export endpoints (`GET /api/leads/export`). The other
 * eight — including `/api/export/backup`, a ZIP of the whole organization, and
 * the generic `/api/export/:entityType` — carried `isAuthenticated` and
 * `getOrCreateOrg` only. `bulkExportLimiter` sits on two of them and is a RATE
 * limiter, not an authorization gate.
 *
 * These are GETs, so the viewer read-only gate does NOT cover them: it refuses
 * mutations. A read-only account — the role most likely to be handed to an
 * outside party — could export the organization's entire database.
 *
 * Discovered rather than assumed: this test derives the export surface from the
 * SOURCE, so a new export route cannot quietly join the ungated set.
 */
describe("every bulk export enforces canExportData", () => {
  /**
   * Export endpoints that return DATA. Deliberately excludes the two
   * export-JOB status reads (`/api/export/jobs`, `/api/export/jobs/:id`), which
   * report on the caller's own export requests and carry no records, and the
   * per-conversation AI transcript export, which is scoped to one conversation
   * the caller can already read.
   */
  const NOT_A_DATA_EXPORT = [
    "/api/export/jobs",
    "/api/export/jobs/:id",
    "/api/ai/conversations/:id/export",
  ];

  /** Every `api.get("…export…")` registration across the route files. */
  function exportRoutes(): Array<{ file: string; path: string; line: string }> {
    const out: Array<{ file: string; path: string; line: string }> = [];
    for (const f of fs.readdirSync(path.join(ROOT, "server"))) {
      if (!f.startsWith("routes") || !f.endsWith(".ts")) continue;
      const src = code(`server/${f}`);
      // The captured span runs from `api.get(` to the start of the HANDLER,
      // not to the end of the line. A registration may be formatted across
      // several lines, and a line-bound capture walked straight past the
      // middleware on /api/export/jobs/:id/download — reporting it ungated when
      // it was, and, worse, capable of reporting it gated when it was not.
      for (const m of src.matchAll(/api\.get\(\s*"([^"]*export[^"]*)"/g)) {
        const start = m.index ?? 0;
        const handler = src.slice(start).search(/async\s*\(|\(\s*req\s*[,:)]/);
        const chain = src.slice(start, start + (handler === -1 ? 400 : handler));
        out.push({ file: `server/${f}`, path: m[1], line: chain });
      }
    }
    return out;
  }

  it("finds the export surface at all (vacuity guard)", () => {
    expect(exportRoutes().length, "no export routes found — has the shape changed?")
      .toBeGreaterThanOrEqual(9);
  });

  it("gates every DATA export", () => {
    for (const r of exportRoutes()) {
      if (NOT_A_DATA_EXPORT.includes(r.path)) continue;
      expect(
        r.line,
        `${r.file} ${r.path} exports data without requirePermission("canExportData")`,
      ).toContain('requirePermission("canExportData")');
    }
  });

  it("a rate limiter is not an authorization gate", () => {
    // bulkExportLimiter sat on /api/export/backup and /api/export/:entityType
    // and reads like protection. It bounds how OFTEN, never WHO.
    const backup = exportRoutes().find((r) => r.path === "/api/export/backup");
    expect(backup, "/api/export/backup not found").toBeTruthy();
    expect(backup!.line).toContain("bulkExportLimiter");
    expect(backup!.line).toContain('requirePermission("canExportData")');
  });

  it("the roles this protects really are denied export", () => {
    const perms = code("server/utils/permissions.ts");
    for (const role of ["member", "va", "viewer"]) {
      const at = perms.indexOf(`  ${role}: {`);
      const block = perms.slice(at, perms.indexOf("\n  },", at));
      expect(block, `${role} is no longer denied export`).toContain("canExportData: false");
    }
  });
});

/**
 * BULK IMPORT creates records at scale.
 *
 * `canImportData` is FALSE for `member`, `va` and `viewer`, and it was enforced
 * on ZERO of thirteen import endpoints. These are POSTs, so unit 32's viewer
 * read-only gate already covered the viewer; the residual exposure was
 * `member` and `va`, who could bulk-import into the CRM against an explicit
 * denial — polluting the record set at scale and consuming the org's usage
 * allowance.
 *
 * Lower severity than the export gap (creating data is recoverable; exfiltrating
 * it is not), and the same defect shape.
 */
describe("every bulk import enforces canImportData", () => {
  /**
   * Import endpoints that are NOT customer-record imports, each with its reason.
   * Verified rather than assumed, and rechecked so the exemption cannot outlive
   * its justification.
   */
  const NOT_A_RECORD_IMPORT: Record<string, { why: string; stillTrue: () => boolean }> = {
    "/api/data-sources/bulk-import": {
      why: "founder-only — behind isFounderAdmin, not a customer route",
      stillTrue: () =>
        /api\.post\(\s*"\/api\/data-sources\/bulk-import",\s*isAuthenticated,\s*isFounderAdmin/.test(
          code("server/routes-admin.ts"),
        ),
    },
    "/api/writing-styles/:id/import": {
      why: "imports a writing-style config, not customer records",
      stillTrue: () => true,
    },
  };

  function importRoutes(): Array<{ file: string; path: string; chain: string }> {
    const out: Array<{ file: string; path: string; chain: string }> = [];
    for (const f of fs.readdirSync(path.join(ROOT, "server"))) {
      if (!f.startsWith("routes") || !f.endsWith(".ts")) continue;
      const src = code(`server/${f}`);
      for (const m of src.matchAll(/api\.post\(\s*"([^"]*import[^"]*)"/g)) {
        const start = m.index ?? 0;
        const handler = src.slice(start).search(/async\s*\(|\(\s*req\s*[,:)]/);
        out.push({
          file: `server/${f}`,
          path: m[1],
          chain: src.slice(start, start + (handler === -1 ? 400 : handler)),
        });
      }
    }
    return out;
  }

  it("finds the import surface at all (vacuity guard)", () => {
    expect(importRoutes().length, "no import routes found — has the shape changed?")
      .toBeGreaterThanOrEqual(13);
  });

  it("gates every customer-record import", () => {
    for (const r of importRoutes()) {
      if (NOT_A_RECORD_IMPORT[r.path]) continue;
      expect(
        r.chain,
        `${r.file} ${r.path} imports records without requirePermission("canImportData")`,
      ).toContain('requirePermission("canImportData")');
    }
  });

  it("each exemption still holds its reason", () => {
    for (const [p, ex] of Object.entries(NOT_A_RECORD_IMPORT)) {
      expect(ex.stillTrue(), `${p}: "${ex.why}" is no longer true`).toBe(true);
    }
  });

  it("PREVIEW is gated too — you cannot preview an import you may not run", () => {
    // A preview parses the operator's uploaded file and reports what it would
    // create. Leaving it open would let a denied role use the importer as a
    // file-processing oracle against the org's own schema.
    for (const r of importRoutes().filter((x) => x.path.includes("preview"))) {
      expect(r.chain, `${r.path}`).toContain('requirePermission("canImportData")');
    }
  });
});

describe("no destructive permission is declared and then never consulted", () => {
  const perms = code("server/utils/permissions.ts");

  it("every canDelete* in the vocabulary is enforced somewhere, or named as not needing to be", () => {
    // This is the assertion that would have caught the defect. A permission can
    // exist in the type, in the role table and in the client's shape while no
    // server code ever reads it — which is exactly what canDeleteProperties and
    // canDeleteDeals did.
    const declared = [...perms.matchAll(/^\s{2}(canDelete\w+):\s*boolean;/gm)].map(
      (m) => m[1],
    );
    expect(declared.length, "no canDelete* permissions found — has the type moved?")
      .toBeGreaterThanOrEqual(4);

    const enforced = new Set(DESTRUCTIVE_ROUTES.map((r) => r.permission));

    /**
     * Declared permissions with no customer-facing destructive route, each with
     * the reason it is not a gap — VERIFIED, not assumed, and each rechecked
     * below so an exemption cannot outlive its justification.
     */
    const NO_ROUTE_YET: Record<string, { why: string; stillTrue: () => boolean }> = {
      canDeleteCampaign: {
        why: "no campaign delete endpoint exists",
        stillTrue: () =>
          !/api\.delete\(\s*["'`]\/api\/campaigns\/:id["'`]/.test(ALL_ROUTE_SRC),
      },
      canDeleteOrg: {
        // Org deletion is NOT a customer operation. It lives under /api/admin,
        // behind isAuthenticated + requireClerkMFA + a founder check, and
        // additionally demands the org's exact name as confirmation. A
        // customer-role permission is the wrong lock for it, and adding one
        // would imply a customer path that must never exist.
        why: "founder-only under /api/admin (MFA + exact-name confirmation)",
        stillTrue: () =>
          code("server/routes.ts").includes(
            'app.use("/api/admin", isAuthenticated, requireClerkMFA)',
          ) &&
          code("server/routes-admin.ts").includes("deleteOrganization"),
      },
    };

    for (const p of declared) {
      if (enforced.has(p)) continue;
      const exemption = NO_ROUTE_YET[p];
      expect(
        exemption,
        `${p} is declared but nothing enforces it and it is not documented as routeless`,
      ).toBeTruthy();
      expect(
        exemption.stillTrue(),
        `${p}: the exemption's reason ("${exemption.why}") is no longer true — ` +
          "add the route to DESTRUCTIVE_ROUTES",
      ).toBe(true);
    }
  });

  it("the roles this protects really are restricted", () => {
    // The gates matter only because member/va/viewer are denied. If the role
    // table changed to grant them, these routes would be open again and every
    // assertion above would still pass — so the premise is checked too.
    for (const role of ["member", "va", "viewer"]) {
      const at = perms.indexOf(`  ${role}: {`);
      expect(at, `role ${role} not found`).toBeGreaterThan(-1);
      const block = perms.slice(at, perms.indexOf("\n  },", at));
      for (const p of ["canDeleteLeads", "canDeleteProperties", "canDeleteDeals"]) {
        expect(block, `${role}.${p} is no longer restricted`).toContain(`${p}: false`);
      }
    }
  });
});
