/**
 * `canAssignLeads` was declared for every role and consulted nowhere.
 *
 * `RolePermissions` grants it to `owner` and `admin` and denies it to `member`,
 * `va` and `viewer`. `client/src/hooks/use-organization.ts` exposes it, so the
 * UI hides the control. **No server route had ever checked it**, and three
 * separate paths accepted an assignee from anyone:
 *
 *   POST  /api/leads                 (assignedTo in the create body)
 *   PUT   /api/leads/:id             (assignedTo in the update body)
 *   POST  /api/bulk/leads/update     (updates.assignedTo, over an id array)
 *
 * This is the last of the class that produced units 30–35 — a rule applied to
 * some surfaces and not others — at its limit: applied to none. **A permission
 * the UI honours and the server ignores is worse than no permission at all**,
 * because it reads as enforced to everyone who looks at the product while the
 * API is open.
 *
 * WHY IT IS WORTH A PERMISSION, rather than being workflow trivia. Assignment
 * decides whose pipeline a lead lands in, who is measured on it, and — for a
 * `va` or anyone carrying `viewOnlyAssignedLeads` — **who can see it at all**.
 * Assigning a lead to a restricted user grants them access; assigning it away
 * revokes theirs. It is an access-control operation wearing a workflow name,
 * which is exactly why it is easy to leave ungated.
 *
 * GATED BY FIELD. The same trade as `ORG_WIDE_SETTINGS`: `PUT /api/leads/:id`
 * carries ordinary member edits, and refusing the whole request because the
 * payload also contains `assignedTo` would break real work to close a narrow
 * gap. The refusal fires only when the request SETS an assignee — and
 * `assignedTo: null` counts, because unassigning is an assignment decision in
 * the direction that removes access.
 */

import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { getPermissionsForRole } from "../../server/utils/permissions";
import { stripComments } from "../helpers/stripComments";
import {
  setsAssignee,
  refuseUnpermittedAssignment,
} from "../../server/utils/leadAssignmentGate";

const ROOT = path.resolve(__dirname, "../..");

function fakeRes() {
  const captured: { status?: number; body?: unknown } = {};
  const res = {
    status(code: number) { captured.status = code; return res; },
    json(body: unknown) { captured.body = body; return res; },
  };
  return { res: res as never, captured };
}

function reqWith(canAssignLeads: boolean | undefined) {
  return (canAssignLeads === undefined
    ? {}
    : { permissionContext: { permissions: { canAssignLeads } } }) as never;
}

describe("the permission it enforces really denies someone", () => {
  it("owner and admin have it; member, va and viewer do not", () => {
    // The gate matters only because of this table. If it changed to grant the
    // permission to everyone, every assertion below would still pass and the
    // routes would be open again — so the premise is checked too.
    expect(getPermissionsForRole("owner").canAssignLeads).toBe(true);
    expect(getPermissionsForRole("admin").canAssignLeads).toBe(true);
    for (const role of ["member", "va", "viewer"] as const) {
      expect(
        getPermissionsForRole(role).canAssignLeads,
        `${role} now has canAssignLeads — the gate protects nobody`,
      ).toBe(false);
    }
  });
});

describe("the gate fires on an assignment and only on an assignment", () => {
  it("lets an ordinary edit through untouched", () => {
    const { res, captured } = fakeRes();
    expect(refuseUnpermittedAssignment(reqWith(false), res, { phone: "555-0100" })).toBe(false);
    expect(captured.status, "an edit with no assignee was refused").toBeUndefined();
  });

  it("refuses a member setting an assignee", () => {
    const { res, captured } = fakeRes();
    expect(refuseUnpermittedAssignment(reqWith(false), res, { assignedTo: 7 })).toBe(true);
    expect(captured.status).toBe(403);
  });

  it("refuses UNASSIGNING too", () => {
    // Unassigning changes who works the lead and, for a restricted user,
    // revokes their access to it. It is an assignment decision in the direction
    // that removes something, and reading `null` as "not an assignment" would
    // leave exactly half the operation open.
    const { res } = fakeRes();
    expect(refuseUnpermittedAssignment(reqWith(false), res, { assignedTo: null })).toBe(true);
  });

  it("lets an admin assign", () => {
    const { res, captured } = fakeRes();
    expect(refuseUnpermittedAssignment(reqWith(true), res, { assignedTo: 7 })).toBe(false);
    expect(captured.status).toBeUndefined();
  });

  it("FAILS CLOSED when the role could not be resolved", () => {
    // "We do not know who this is" reads as no. The viewer gate's first draft
    // read a context attached later than the chokepoint, found undefined, and
    // would have passed everything through while looking correct.
    const { res } = fakeRes();
    expect(refuseUnpermittedAssignment(reqWith(undefined), res, { assignedTo: 7 })).toBe(true);
  });

  it("setsAssignee distinguishes absent from null", () => {
    expect(setsAssignee({ assignedTo: 3 })).toBe(true);
    expect(setsAssignee({ assignedTo: null })).toBe(true);
    expect(setsAssignee({ status: "new" })).toBe(false);
    expect(setsAssignee(undefined)).toBe(false);
    expect(setsAssignee(null)).toBe(false);
  });
});

// ─── Every user-driven assignment path carries the gate ───────────────────────

/**
 * Derived from source rather than listed. The defect was that a rule reached
 * NONE of its surfaces; a hand-written list of surfaces is the same kind of
 * artefact that let that happen.
 *
 * A path counts when it lets a REQUEST choose the assignee. Automation that
 * assigns under the org's own rules is not a user decision and is registered
 * below with its reason.
 */
const AUTOMATED_ASSIGNERS = [
  {
    file: "server/services/leadAssigner.ts",
    why:
      "the rules-based auto-assign that runs on create when the caller named " +
      "nobody. It applies the ORG'S OWN configured rules; denying them the " +
      "right to run would break intake for exactly the roles that need it.",
  },
  {
    file: "server/services/territoryService.ts",
    why: "automation acting under its own authority, not a user's — a user permission is the wrong instrument.",
  },
  {
    file: "server/services/importExport.ts",
    why: "already behind canImportData (unit 35); a second gate would be a second owner of the same rule.",
  },
] as const;

describe("every path that lets a REQUEST choose the assignee is gated", () => {
  const GATED = [
    { file: "server/routes-leads.ts", marker: 'api.post("/api/leads"', what: "creating a lead with an assignee" },
    { file: "server/routes-leads.ts", marker: 'api.put("/api/leads/:id"', what: "updating a lead's assignee" },
    { file: "server/routes-bulk.ts", marker: 'router.post("/leads/update"', what: "bulk lead assignment" },
  ] as const;

  function handler(rel: string, marker: string): string {
    const src = stripComments(fs.readFileSync(path.join(ROOT, rel), "utf8"));
    const at = src.indexOf(marker);
    expect(at, `${marker} not found in ${rel} — renamed?`).toBeGreaterThan(-1);
    // Bounded at the NEXT route registration. A window run to end-of-file is
    // how a source assertion passes on a neighbour's code — this program has
    // shipped that defect five times.
    const next = src.slice(at + marker.length).search(/\b(api|router)\.(get|post|put|patch|delete)\(/);
    return next === -1 ? src.slice(at) : src.slice(at, at + marker.length + next);
  }

  it("finds each handler (vacuity guard)", () => {
    for (const g of GATED) {
      expect(handler(g.file, g.marker).length, `${g.marker} window is empty`).toBeGreaterThan(200);
    }
  });

  it("each one refuses an unpermitted assignment", () => {
    for (const g of GATED) {
      expect(
        handler(g.file, g.marker),
        `${g.what} (${g.file}) does not call refuseUnpermittedAssignment — ` +
          `canAssignLeads is declared for every role and this path would ignore it`,
      ).toContain("refuseUnpermittedAssignment(");
    }
  });

  it("the gate can actually read a role on each path", () => {
    // It fails closed, so a route that never attaches a permission context
    // would refuse EVERY assignment — including an owner's. That is a
    // different defect from the one being fixed and would be found in
    // production rather than here.
    for (const g of GATED) {
      const src = stripComments(fs.readFileSync(path.join(ROOT, g.file), "utf8"));
      const at = src.indexOf(g.marker);
      const registration = src.slice(at, src.indexOf("\n", at + 200) + 1);
      expect(
        registration.includes("attachPermissionContext"),
        `${g.marker} does not attach a permission context, so the gate would ` +
          `fail closed for everyone, owners included`,
      ).toBe(true);
    }
  });

  it("automated assigners are registered with reasons, not silently skipped", () => {
    for (const a of AUTOMATED_ASSIGNERS) {
      expect(fs.existsSync(path.join(ROOT, a.file)), `${a.file} is gone`).toBe(true);
      expect(a.why.length, `${a.file} is exempt with no stated reason`).toBeGreaterThan(50);
    }
  });
});
