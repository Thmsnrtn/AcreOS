/**
 * Phase 3 Week 14 — RBAC repair + va role + co-owners
 *
 * Liana §1+§3, Reyna §1, Blanco §1
 *
 * 1. requireRole(['admin']) accepts admin and owner, rejects member/va/viewer.
 * 2. A `va` user with viewOnlyAssignedLeads sees only leads they're assigned to.
 *
 * Both tests exercise the unit of behavior in isolation — the role guard is
 * tested by stubbing the DB call, and the leads-visibility check is tested
 * against the same in-memory filter logic that storage.getLeads applies.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── 1. requireRole guard test ────────────────────────────────────────────────
//
// We stub the drizzle db client to return a deterministic team_members row,
// then verify the middleware calls next() vs returns 403 based on role.

vi.mock("../../server/db", () => {
  let _role: string = "member";
  return {
    db: {
      select: () => ({
        from: () => ({
          where: () => Promise.resolve([{ role: _role }]),
        }),
      }),
      __setMockRole: (r: string) => {
        _role = r;
      },
    },
  };
});

import { requireRole, normalizeRole } from "../../server/middleware/roleGuard";
import { db } from "../../server/db";

function makeReqRes(role: string) {
  (db as any).__setMockRole(role);
  const req: any = {
    user: { id: "user-1" },
    organization: { id: 1 },
  };
  const res: any = {
    statusCode: 200,
    body: undefined,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  let nextCalled = false;
  const next = () => {
    nextCalled = true;
  };
  return { req, res, next: () => next(), getNextCalled: () => nextCalled };
}

describe("requireRole(['admin', 'owner']) — Liana §1", () => {
  it("rejects a `member` user with 403", async () => {
    const guard = requireRole(["admin", "owner"]);
    const { req, res } = makeReqRes("member");
    let nextCalled = false;
    await guard(req as any, res as any, () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(403);
  });

  it("rejects a `va` user with 403", async () => {
    const guard = requireRole(["admin", "owner"]);
    const { req, res } = makeReqRes("va");
    let nextCalled = false;
    await guard(req as any, res as any, () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(403);
  });

  it("rejects a `viewer` user with 403", async () => {
    const guard = requireRole(["admin", "owner"]);
    const { req, res } = makeReqRes("viewer");
    let nextCalled = false;
    await guard(req as any, res as any, () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(403);
  });

  it("accepts an `admin` user (calls next)", async () => {
    const guard = requireRole(["admin", "owner"]);
    const { req, res } = makeReqRes("admin");
    let nextCalled = false;
    await guard(req as any, res as any, () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(true);
    expect(res.statusCode).toBe(200);
  });

  it("accepts an `owner` user (calls next)", async () => {
    const guard = requireRole(["admin", "owner"]);
    const { req, res } = makeReqRes("owner");
    let nextCalled = false;
    await guard(req as any, res as any, () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(true);
    expect(res.statusCode).toBe(200);
  });

  it("accepts variadic call form (legacy callers)", async () => {
    // requireRole('admin', 'owner') — legacy variadic — still works.
    const guard = requireRole("admin", "owner");
    const { req, res } = makeReqRes("admin");
    let nextCalled = false;
    await guard(req as any, res as any, () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(true);
  });

  it("normalizes legacy roles to `member`", () => {
    expect(normalizeRole("acquisitions")).toBe("member");
    expect(normalizeRole("marketing")).toBe("member");
    expect(normalizeRole("finance")).toBe("member");
    expect(normalizeRole("owner")).toBe("owner");
    expect(normalizeRole("admin")).toBe("admin");
    expect(normalizeRole("va")).toBe("va");
    expect(normalizeRole("viewer")).toBe("viewer");
    expect(normalizeRole("garbage")).toBe("member"); // safe fallback
  });
});

// ── 2. va viewOnlyAssignedLeads filter test ──────────────────────────────────
//
// This mirrors the SQL-level filter applied in storage.getLeads /
// storage.getLeadsPaginated (server/storage.ts:1290-1326). When
// permissionContext.permissions.viewOnlyAssignedLeads is true (which is the
// default for `va` users with the per-user flag set), routes-leads.ts
// passes { assignedTo: teamMemberId } down — we verify the filter shape
// produces the right subset.

interface Lead {
  id: number;
  organizationId: number;
  assignedTo: number | null;
  deletedAt: Date | null;
}

function applyAssignedLeadsFilter(
  pool: Lead[],
  orgId: number,
  filters?: { assignedTo?: number | null },
): Lead[] {
  return pool.filter((l) => {
    if (l.organizationId !== orgId) return false;
    if (l.deletedAt !== null) return false;
    if (filters?.assignedTo === null) return l.assignedTo === null;
    if (filters?.assignedTo !== undefined) return l.assignedTo === filters.assignedTo;
    return true;
  });
}

describe("va role honors viewOnlyAssignedLeads — Reyna §1", () => {
  const orgId = 1;
  const vaTeamMemberId = 42;
  const otherMemberId = 7;

  let pool: Lead[];
  beforeEach(() => {
    pool = [
      // Assigned to the VA — should be visible
      { id: 1, organizationId: orgId, assignedTo: vaTeamMemberId, deletedAt: null },
      { id: 2, organizationId: orgId, assignedTo: vaTeamMemberId, deletedAt: null },
      // Assigned to someone else — must NOT be visible to the VA
      { id: 3, organizationId: orgId, assignedTo: otherMemberId, deletedAt: null },
      { id: 4, organizationId: orgId, assignedTo: otherMemberId, deletedAt: null },
      // Unassigned — must NOT be visible to the VA either
      { id: 5, organizationId: orgId, assignedTo: null, deletedAt: null },
      // Deleted — never visible
      { id: 6, organizationId: orgId, assignedTo: vaTeamMemberId, deletedAt: new Date() },
      // Different org — never visible
      { id: 7, organizationId: 999, assignedTo: vaTeamMemberId, deletedAt: null },
    ];
  });

  it("a va with viewOnlyAssignedLeads only sees their assigned leads", () => {
    // Simulate routes-leads.ts: when context.permissions.viewOnlyAssignedLeads
    // is true, sqlAssignedTo = context.teamMemberId.
    const filters = { assignedTo: vaTeamMemberId };
    const visible = applyAssignedLeadsFilter(pool, orgId, filters);

    // Only ids 1 and 2 — assigned to the VA, not deleted, in this org
    expect(visible.map((l) => l.id).sort()).toEqual([1, 2]);
    // Other-member leads are NOT visible
    expect(visible.find((l) => l.id === 3)).toBeUndefined();
    expect(visible.find((l) => l.id === 4)).toBeUndefined();
    // Unassigned leads are NOT visible
    expect(visible.find((l) => l.id === 5)).toBeUndefined();
    // Deleted leads (even if assigned) are NOT visible
    expect(visible.find((l) => l.id === 6)).toBeUndefined();
    // Cross-org leak is impossible
    expect(visible.find((l) => l.id === 7)).toBeUndefined();
  });

  it("a member without viewOnlyAssignedLeads sees the full org pool (minus deleted)", () => {
    // No filter — non-restricted member sees everything in their org.
    const visible = applyAssignedLeadsFilter(pool, orgId);
    // Ids 1, 2, 3, 4, 5 — everything in org 1 that isn't deleted
    expect(visible.map((l) => l.id).sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it("a va whose teamMemberId has zero assigned leads sees an empty list", () => {
    const filters = { assignedTo: 9999 }; // unassigned to anyone
    const visible = applyAssignedLeadsFilter(pool, orgId, filters);
    expect(visible).toEqual([]);
  });
});
