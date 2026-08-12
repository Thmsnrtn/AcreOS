/**
 * The assigned-leads gate must hold on EVERY lead write path.
 *
 * `team_members.viewOnlyAssignedLeads` is a restriction an org owner sets
 * deliberately, and which is forced on for the `va` role. It was enforced on
 * `GET /api/leads`, `GET /api/leads/paginated`, `PUT /api/leads/:id` and the
 * `/api/bulk/leads/*` paths — and **missing from four writes**:
 * `DELETE /api/leads/:id`, `PATCH /api/leads/:id/restore`,
 * `POST /api/leads/bulk-delete` and `POST /api/leads/bulk-update`.
 *
 * A VA restricted to their own leads could delete, restore or mass-update any
 * lead in the org by guessing a numeric id, and the two bulk paths accepted an
 * arbitrary id array.
 *
 * SEVERITY, STATED HONESTLY: intra-org, not cross-tenant. Every affected path is
 * already org-scoped, so nothing crossed an organization boundary. What was
 * bypassed is a permission the org's own owner configured — a real boundary, and
 * not the same thing as a tenant leak.
 *
 * This is the same shape as the `/api/admin` MFA defect found earlier in this
 * program: a correct gate applied to some surfaces and not others, invisible
 * because each surface looks fine read on its own. The only way to see it is to
 * enumerate the surfaces and check them together — which is what this file does,
 * so the next write path cannot quietly join the unprotected set.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

/** Source with comments stripped — a gate must exist in CODE, not in prose. */
function code(rel: string): string {
  return read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/(^|[^:])\/\/.*$/, "$1"))
    .join("\n");
}

const LEADS = "server/routes-leads.ts";

/**
 * Every route in routes-leads.ts that MUTATES a lead by id (or id array).
 *
 * Creation is excluded on purpose: a lead that does not exist yet cannot be
 * assigned to someone else, so there is nothing for the restriction to protect.
 * Enrichment and scoring are excluded because they derive facts about a lead
 * rather than changing what it says — if that ever stops being true they belong
 * here, and the completeness check below will not catch it, which is stated so
 * the boundary is a decision rather than an oversight.
 */
const GUARDED_WRITES = [
  { method: "put", pattern: '"/api/leads/:id"', shape: "single" },
  { method: "delete", pattern: '"/api/leads/:id"', shape: "single" },
  { method: "patch", pattern: '"/api/leads/:id/restore"', shape: "single" },
  { method: "post", pattern: '"/api/leads/bulk-delete"', shape: "bulk" },
  { method: "post", pattern: '"/api/leads/bulk-update"', shape: "bulk" },
] as const;

/** The handler body for one route, bounded by the NEXT route registration. */
function handler(src: string, method: string, pattern: string): string {
  const start = src.indexOf(`api.${method}(${pattern}`);
  if (start === -1) return "";
  const next = src.slice(start + 1).search(/\n\s*api\.(get|post|put|patch|delete)\(/);
  return next === -1 ? src.slice(start) : src.slice(start, start + 1 + next);
}

describe("every lead write path enforces the assigned-leads restriction", () => {
  const src = code(LEADS);

  it("finds every route it claims to check (vacuity guard)", () => {
    // Without this, a renamed path would make the whole file pass by checking
    // nothing — the failure mode of every source-scanning security test.
    for (const w of GUARDED_WRITES) {
      expect(
        handler(src, w.method, w.pattern).length,
        `${w.method.toUpperCase()} ${w.pattern} not found — has it been renamed?`,
      ).toBeGreaterThan(0);
    }
  });

  it("attaches the permission context, or the gate reads undefined and passes", () => {
    // The check is `context?.permissions.viewOnlyAssignedLeads`. Without
    // attachPermissionContext() the optional chain yields undefined, the
    // condition is falsy, and the gate silently allows everything — a guard that
    // fails OPEN when its input is missing.
    for (const w of GUARDED_WRITES) {
      const h = handler(src, w.method, w.pattern);
      expect(h, `${w.method.toUpperCase()} ${w.pattern}`).toContain(
        "attachPermissionContext()",
      );
    }
  });

  it("calls the shared gate — a single lead is checked against its assignee", () => {
    for (const w of GUARDED_WRITES.filter((x) => x.shape === "single")) {
      const h = handler(src, w.method, w.pattern);
      expect(h, `${w.method.toUpperCase()} ${w.pattern}`).toMatch(
        /assertAssignedLeadWritable\(/,
      );
      // ...and returns immediately on refusal. A gate whose result is computed
      // and ignored is worse than none: it reads as protection.
      expect(h, `${w.method.toUpperCase()} ${w.pattern} ignores the refusal`).toMatch(
        /if \(assertAssignedLeadWritable\([^)]*\)\) return;/,
      );
    }
  });

  it("refuses BULK writes outright rather than filtering them", () => {
    // A bulk call that quietly does less than it was asked reports success for
    // work it did not do. Refusal is visible; silent narrowing is not.
    for (const w of GUARDED_WRITES.filter((x) => x.shape === "bulk")) {
      const h = handler(src, w.method, w.pattern);
      expect(h, `${w.method.toUpperCase()} ${w.pattern}`).toMatch(
        /if \(refuseBulkLeadWrite\([^)]*\)\) return;/,
      );
    }
  });

  it("the refusal happens BEFORE the write, not after it", () => {
    // Ordering is the whole property. The MFA defect this mirrors was a gate
    // registered below the routes it was meant to protect.
    for (const w of GUARDED_WRITES) {
      const h = handler(src, w.method, w.pattern);
      const gate = Math.max(
        h.indexOf("assertAssignedLeadWritable("),
        h.indexOf("refuseBulkLeadWrite("),
      );
      expect(gate, `${w.pattern} has no gate`).toBeGreaterThan(-1);
      // The first mutation in the handler, whichever form it takes.
      const mutations = [
        h.indexOf("db.update(leads)"),
        h.indexOf("storage.updateLead("),
        h.indexOf("storage.bulkDeleteLeads("),
        h.indexOf("storage.bulkUpdateLeads("),
      ].filter((i) => i > -1);
      for (const m of mutations) {
        expect(gate, `${w.pattern}: gate runs after the write`).toBeLessThan(m);
      }
    }
  });
});

describe("the rule has ONE owner", () => {
  it("lives in a shared module, not in hand-written copies", () => {
    // Five copies of a security rule is not five times the safety; it is five
    // chances to forget the sixth — which is exactly what happened.
    const gate = code("server/utils/assignedLeadGate.ts");
    expect(gate).toContain("export function assertAssignedLeadWritable");
    expect(gate).toContain("export function refuseBulkLeadWrite");
  });

  it("treats an UNASSIGNED lead as not writable by a restricted caller", () => {
    // "Assigned to nobody" must not read as "assigned to everybody" — that
    // would void the restriction for exactly the leads most likely to be
    // unclaimed.
    const gate = code("server/utils/assignedLeadGate.ts");
    expect(gate).toMatch(/assignedTo == null \|\|/);
  });

  it("compares as strings, so a numeric id never mismatches a string one", () => {
    const gate = code("server/utils/assignedLeadGate.ts");
    expect(gate).toMatch(/String\(assignedTo\) !== String\(callerId\)/);
  });

  it("names the restriction, never the ids, so the error is not a probe", () => {
    const gate = read("server/utils/assignedLeadGate.ts");
    const fn = gate.slice(gate.indexOf("export function refuseBulkLeadWrite"));
    expect(fn).not.toMatch(/\$\{ids\}|\$\{leadId\}/);
  });
});
