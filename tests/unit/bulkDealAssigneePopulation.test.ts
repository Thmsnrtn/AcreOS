/**
 * POST /api/bulk/deals/update — the assignee gate must check the population
 * `deals.assigned_to` actually stores (audit-pr792 N3).
 *
 * The bulk deals handler used to validate `updates.assignedTo` with
 * `assertUserIsOrgMember`, which matches `team_members.user_id` (a text user
 * id). But `deals.assigned_to` is an integer column storing `team_members.id`
 * — so a legitimate member-id assignment could essentially never pass, and
 * bulk assignment through this route was refused for every real assignee.
 * The canonical check is `isAssignableLeadMember` (id + org + active), the
 * same one /api/bulk/leads/update in the same file already runs and the same
 * one the dedicated deal assignment route runs. This suite pins the swap:
 *
 *   - a valid team-MEMBER ID of the caller's org is assigned;
 *   - a user-id-shaped value is refused — even one that IS a real member's
 *     user id (the old gate would have waved it through toward an integer
 *     column that cannot hold it);
 *   - a member of ANOTHER org, an INACTIVE member, and a non-member id are
 *     all refused in plain words, and nothing is written;
 *   - `assignedTo: null` still unassigns, exactly as before (the canonical
 *     validator passes null — clearing is not an assignee to verify);
 *   - a non-assignment update never consults either validator.
 *
 * No existing routes-bulk suite covered this endpoint's assignee; this file
 * follows dealStatusWritersHoldTheStateMachine.test.ts (same router, same
 * storage-double shape) and mirrors the real validator's contract in the
 * orgScope double, as dealAssignmentRoute.test.ts does.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import fs from "fs";
import path from "path";

const ORG_A = 42;
const MEMBER_OF_A = 7;
const MEMBER_OF_OTHER_ORG = 8;
const INACTIVE_MEMBER_OF_A = 9;
const NOT_A_MEMBER = 40404;
// Member 7's user id — the population the OLD gate checked. Under the old
// gate this value passed; the column it would land in cannot even hold it.
const USER_ID_OF_MEMBER_A = "user-77";

vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

// Mirrors isAssignableLeadMember's contract (server/utils/orgScope.ts):
// null/undefined pass (unassign); anything else must be a positive integer
// naming an ACTIVE team member of the org it is checked against.
const MEMBERS = [
  { id: MEMBER_OF_A, organizationId: ORG_A, isActive: true },
  { id: MEMBER_OF_OTHER_ORG, organizationId: 99, isActive: true },
  { id: INACTIVE_MEMBER_OF_A, organizationId: ORG_A, isActive: false },
];
const isAssignableLeadMember = vi.fn(async (assignedTo: unknown, organizationId: number) => {
  if (assignedTo === null || assignedTo === undefined) return true;
  if (typeof assignedTo !== "number" || !Number.isInteger(assignedTo) || assignedTo <= 0) return false;
  return MEMBERS.some((m) => m.id === assignedTo && m.organizationId === organizationId && m.isActive);
});
// The old population: a value passes when it is the USER ID of a member.
// Kept as a recording double so the pins can prove the deals handler no
// longer consults it at all.
const assertUserIsOrgMember = vi.fn(async (userId: string | null | undefined, _organizationId: number) => userId === USER_ID_OF_MEMBER_A);
vi.mock("../../server/utils/orgScope", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    isAssignableLeadMember: (...a: unknown[]) => (isAssignableLeadMember as any)(...a),
    assertUserIsOrgMember: (...a: unknown[]) => (assertUserIsOrgMember as any)(...a),
  };
});

const S = vi.hoisted(() => ({
  bulkWrites: [] as Array<{ orgId: number; ids: number[]; updates: Record<string, unknown> }>,
}));
vi.mock("../../server/storage", () => ({
  storage: {
    getDealsByIds: async (_orgId: number, _ids: number[]) => [],
    bulkUpdateDeals: async (orgId: number, ids: number[], updates: Record<string, unknown>) => (
      S.bulkWrites.push({ orgId, ids, updates }), ids.length
    ),
  },
  db: {},
}));
vi.mock("../../server/services/dealEvents", () => ({ emitDealStageChanged: vi.fn() }));

let app: express.Application;
beforeAll(async () => {
  const { default: router } = await import("../../server/routes-bulk");
  app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).organization = { id: ORG_A };
    (req as any).organizationId = ORG_A;
    (req as any).user = { id: "u1" };
    next();
  });
  app.use("/api/bulk", router);
});

beforeEach(() => {
  S.bulkWrites = [];
  isAssignableLeadMember.mockClear();
  assertUserIsOrgMember.mockClear();
});

const bulkDeals = (updates: Record<string, unknown>, ids = [3]) =>
  request(app).post("/api/bulk/deals/update").send({ ids, updates });

describe("POST /api/bulk/deals/update — assignee population", () => {
  it("assigns a valid team-member id of the org", async () => {
    const res = await bulkDeals({ assignedTo: MEMBER_OF_A });
    expect(res.status).toBe(200);
    expect(isAssignableLeadMember).toHaveBeenCalledWith(MEMBER_OF_A, ORG_A);
    expect(assertUserIsOrgMember).not.toHaveBeenCalled();
    expect(S.bulkWrites).toEqual([
      { orgId: ORG_A, ids: [3], updates: expect.objectContaining({ assignedTo: MEMBER_OF_A }) },
    ]);
  });

  it("refuses a user-id-shaped value — even a real member's user id — and writes nothing", async () => {
    const res = await bulkDeals({ assignedTo: USER_ID_OF_MEMBER_A });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/id of an active team member of this organization/);
    // The member-id validator is the gate now; the user-id check is not consulted.
    expect(isAssignableLeadMember).toHaveBeenCalledWith(USER_ID_OF_MEMBER_A, ORG_A);
    expect(assertUserIsOrgMember).not.toHaveBeenCalled();
    expect(S.bulkWrites).toEqual([]);
  });

  it("refuses a member of another org", async () => {
    const res = await bulkDeals({ assignedTo: MEMBER_OF_OTHER_ORG });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/id of an active team member of this organization/);
    // Checked against the CALLER's org — that is what makes the other
    // org's member id unusable here.
    expect(isAssignableLeadMember).toHaveBeenCalledWith(MEMBER_OF_OTHER_ORG, ORG_A);
    expect(S.bulkWrites).toEqual([]);
  });

  it("refuses an inactive member of the org", async () => {
    const res = await bulkDeals({ assignedTo: INACTIVE_MEMBER_OF_A });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/id of an active team member of this organization/);
    expect(S.bulkWrites).toEqual([]);
  });

  it("refuses an id that is no member at all", async () => {
    const res = await bulkDeals({ assignedTo: NOT_A_MEMBER });
    expect(res.status).toBe(400);
    expect(S.bulkWrites).toEqual([]);
  });

  it("null still unassigns — the assignment is cleared, as before", async () => {
    const res = await bulkDeals({ assignedTo: null });
    expect(res.status).toBe(200);
    expect(S.bulkWrites).toEqual([
      { orgId: ORG_A, ids: [3], updates: expect.objectContaining({ assignedTo: null }) },
    ]);
  });

  it("a non-assignment update never consults either validator", async () => {
    const res = await bulkDeals({ stage: "under_contract" });
    expect(res.status).toBe(200);
    expect(isAssignableLeadMember).not.toHaveBeenCalled();
    expect(assertUserIsOrgMember).not.toHaveBeenCalled();
    expect(S.bulkWrites).toEqual([
      { orgId: ORG_A, ids: [3], updates: expect.objectContaining({ stage: "under_contract" }) },
    ]);
  });

  it("the deals handler's source gates on the member-id population, not the user-id one", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../../server/routes-bulk.ts"), "utf-8");
    const handler = src.slice(src.indexOf('router.post("/deals/update"'), src.indexOf('router.post("/tasks/complete"'));
    expect(handler).toContain("isAssignableLeadMember(updates.assignedTo, orgId)");
    expect(handler).not.toContain("assertUserIsOrgMember");
  });
});
