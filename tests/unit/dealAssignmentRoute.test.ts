/**
 * PUT /api/deals/:id/assignment — agent_investor item 3, server half.
 *
 * The dedicated writer for `deals.assignedTo` + `deals.dealBook` (migration
 * 0226 columns). Before it, the generic deal create/update schemas accepted
 * any integer assignee and any string book tag with NO org check; this suite
 * pins the disciplined contract:
 *
 *   - the deal is read within the caller's org (a foreign deal is a 404 and
 *     nothing is written);
 *   - a non-null assignee must be an active team member of THIS org — the
 *     canonical `isAssignableLeadMember` check is invoked with the caller's
 *     org id, so a member of another org and a non-member are both refused
 *     in plain words and nothing is written;
 *   - unassigning (assignedTo: null) works;
 *   - the book tag round-trips ('client' / 'own_investment' / null) and an
 *     unknown tag is refused;
 *   - the generic PUT/POST deal paths run the same validation — they are
 *     not a bypass around this route;
 *   - money discipline: the route records NO commission and the stored deal
 *     after assignment merely satisfies the close seam's precondition shape
 *     (assignedTo set, book not 'own_investment') — the seam's own
 *     no-config-no-commission gate is pinned by
 *     agentInvestorCommissionWedge.test.ts and is untouched here.
 *
 * Storage and the org-scope validator are mocked; the validator mock mirrors
 * the real helper's contract (null/undefined pass; otherwise the id must be
 * an active member of the org passed in).
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import fs from "fs";
import path from "path";

const ORG_A = 42;
const MEMBER_OF_A = 7;
const MEMBER_OF_OTHER_ORG = 8;
const NOT_A_MEMBER = 40404;
const DEAL_ID = 42;

vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/auth", () => ({
  isAuthenticated: (req: any, _res: any, next: any) => {
    req.user = { id: "user-a", claims: { sub: "user-a" } };
    next();
  },
}));
vi.mock("../../server/middleware/getOrCreateOrg", () => ({
  getOrCreateOrg: (req: any, _res: any, next: any) => {
    req.organization = { id: ORG_A, name: "Org A" };
    req.organizationId = ORG_A;
    next();
  },
}));

// Mirrors isAssignableLeadMember's contract: null passes (unassign); an id
// passes only when it is an active member of the org it is checked against.
const isAssignableLeadMember = vi.fn(async (assignedTo: unknown, organizationId: number) => {
  if (assignedTo === null || assignedTo === undefined) return true;
  return assignedTo === MEMBER_OF_A && organizationId === ORG_A;
});
vi.mock("../../server/utils/orgScope", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, isAssignableLeadMember: (...a: unknown[]) => (isAssignableLeadMember as any)(...a) };
});

// A tiny in-memory deal so book/assignment round-trips read back honestly.
let dealRow: Record<string, unknown> | undefined;
const getDeal = vi.fn(async (_orgId: number, dealId: number) =>
  dealRow && dealRow.id === dealId ? { ...dealRow } : undefined,
);
const updateDeal = vi.fn(async (dealId: number, updates: Record<string, unknown>) => {
  dealRow = { ...(dealRow as Record<string, unknown>), ...updates, id: dealId };
  return { ...dealRow };
});
const createAuditLogEntry = vi.fn(async (entry: Record<string, unknown>) => ({ id: 1, ...entry }));
const createDeal = vi.fn();
const bulkUpdateDeals = vi.fn(async (_orgId: number, ids: unknown[], _updates: Record<string, unknown>) => ids.length);
vi.mock("../../server/storage", () => ({
  storage: {
    getDeal: (...a: unknown[]) => (getDeal as any)(...a),
    updateDeal: (...a: unknown[]) => (updateDeal as any)(...a),
    createAuditLogEntry: (...a: unknown[]) => (createAuditLogEntry as any)(...a),
    createDeal: (...a: unknown[]) => (createDeal as any)(...a),
    bulkUpdateDeals: (...a: unknown[]) => (bulkUpdateDeals as any)(...a),
  },
}));
vi.mock("../../server/db", () => ({ db: {}, withTransaction: async (fn: any) => fn({}) }));
vi.mock("../../server/services/leadScoring", () => ({ leadScoringService: {} }));
vi.mock("../../server/services/propertyEnrichment", () => ({ propertyEnrichmentService: {} }));
vi.mock("../../server/services/usageLimits", () => ({ checkUsageLimit: vi.fn() }));
vi.mock("../../server/services/usury", () => ({ checkUsury: vi.fn() }));
vi.mock("../../server/services/dealHandoffService", () => ({
  getAllHandoffs: vi.fn(),
  getHandoffsForDeal: vi.fn(),
  initiateHandoff: vi.fn(),
  updateHandoffChecklist: vi.fn(),
  completeHandoff: vi.fn(),
}));

import { registerDealRoutes } from "../../server/routes-deals";

describe("PUT /api/deals/:id/assignment", () => {
  let app: express.Application;
  beforeAll(() => {
    app = express();
    app.use(express.json());
    registerDealRoutes(app as any);
  });
  beforeEach(() => {
    dealRow = { id: DEAL_ID, organizationId: ORG_A, status: "negotiating", assignedTo: null, dealBook: null };
    getDeal.mockClear();
    updateDeal.mockClear();
    createAuditLogEntry.mockClear();
    createDeal.mockClear();
    isAssignableLeadMember.mockClear();
  });

  it("happy path: assigns an own-org member and tags the client book, with an audit entry", async () => {
    const res = await request(app)
      .put(`/api/deals/${DEAL_ID}/assignment`)
      .send({ assignedTo: MEMBER_OF_A, dealBook: "client" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ dealId: DEAL_ID, assignedTo: MEMBER_OF_A, dealBook: "client", recordsOnly: true });
    expect(res.body.notice).toMatch(/records no commission/i);
    expect(isAssignableLeadMember).toHaveBeenCalledWith(MEMBER_OF_A, ORG_A);
    expect(updateDeal).toHaveBeenCalledWith(DEAL_ID, { assignedTo: MEMBER_OF_A, dealBook: "client" }, undefined, ORG_A);
    // Audit trail: before/after of exactly the two fields, deal-scoped.
    expect(createAuditLogEntry).toHaveBeenCalledTimes(1);
    const entry = createAuditLogEntry.mock.calls[0][0] as any;
    expect(entry).toMatchObject({ organizationId: ORG_A, action: "update", entityType: "deal", entityId: DEAL_ID });
    expect(entry.changes.before).toEqual({ assignedTo: null, dealBook: null });
    expect(entry.changes.after).toEqual({ assignedTo: MEMBER_OF_A, dealBook: "client" });
  });

  it("the stored deal now satisfies the close seam's precondition — and nothing else was recorded", async () => {
    await request(app).put(`/api/deals/${DEAL_ID}/assignment`).send({ assignedTo: MEMBER_OF_A, dealBook: "client" });
    // The seam records only when assignedTo != null and the book is not
    // 'own_investment' (its config gate is pinned by the wedge suite).
    expect(dealRow?.assignedTo).not.toBeNull();
    expect(dealRow?.dealBook).not.toBe("own_investment");
    // This route itself touches no commission machinery: the only storage
    // writes are the deal update and the audit entry.
    expect(createDeal).not.toHaveBeenCalled();
    const src = fs.readFileSync(path.resolve(__dirname, "../../server/routes-deals.ts"), "utf-8");
    const handler = src.slice(src.indexOf('"/api/deals/:id/assignment"'), src.indexOf('"/api/deals/:id/assignment"') + 4000);
    expect(handler).not.toContain("recordDealCommission");
    expect(handler).not.toContain("commissionService");
  });

  it("cross-org assignee is refused in plain words and nothing is written", async () => {
    const res = await request(app).put(`/api/deals/${DEAL_ID}/assignment`).send({ assignedTo: MEMBER_OF_OTHER_ORG });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/active team member of this organization/);
    // The check ran against the CALLER's org — that is what makes the
    // other org's member id unusable here.
    expect(isAssignableLeadMember).toHaveBeenCalledWith(MEMBER_OF_OTHER_ORG, ORG_A);
    expect(updateDeal).not.toHaveBeenCalled();
    expect(createAuditLogEntry).not.toHaveBeenCalled();
  });

  it("a non-member assignee is refused the same way", async () => {
    const res = await request(app).put(`/api/deals/${DEAL_ID}/assignment`).send({ assignedTo: NOT_A_MEMBER });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/active team member of this organization/);
    expect(updateDeal).not.toHaveBeenCalled();
  });

  it("unassign (assignedTo: null) works and does not need a member check to pass an id", async () => {
    dealRow = { ...dealRow, assignedTo: MEMBER_OF_A };
    const res = await request(app).put(`/api/deals/${DEAL_ID}/assignment`).send({ assignedTo: null });
    expect(res.status).toBe(200);
    expect(res.body.assignedTo).toBeNull();
    expect(updateDeal).toHaveBeenCalledWith(DEAL_ID, { assignedTo: null }, undefined, ORG_A);
    expect(dealRow?.assignedTo).toBeNull();
  });

  it("the book tag round-trips: own_investment, then cleared back to null", async () => {
    const first = await request(app).put(`/api/deals/${DEAL_ID}/assignment`).send({ dealBook: "own_investment" });
    expect(first.status).toBe(200);
    expect(first.body.dealBook).toBe("own_investment");
    expect(dealRow?.dealBook).toBe("own_investment");
    const second = await request(app).put(`/api/deals/${DEAL_ID}/assignment`).send({ dealBook: null });
    expect(second.status).toBe(200);
    expect(second.body.dealBook).toBeNull();
    expect(dealRow?.dealBook).toBeNull();
  });

  it("an unknown book tag is refused, not stored", async () => {
    const res = await request(app).put(`/api/deals/${DEAL_ID}/assignment`).send({ dealBook: "personal" });
    expect(res.status).toBe(422);
    expect(updateDeal).not.toHaveBeenCalled();
  });

  it("an empty body is refused — there is nothing to update", async () => {
    const res = await request(app).put(`/api/deals/${DEAL_ID}/assignment`).send({});
    expect(res.status).toBe(422);
    expect(updateDeal).not.toHaveBeenCalled();
  });

  it("a deal the caller's org does not hold is a 404 and nothing is written", async () => {
    const res = await request(app).put(`/api/deals/999/assignment`).send({ assignedTo: MEMBER_OF_A });
    expect(res.status).toBe(404);
    expect(getDeal).toHaveBeenCalledWith(ORG_A, 999);
    expect(updateDeal).not.toHaveBeenCalled();
  });

  it.each(["abc", "0", "-3"])("a malformed deal id (%s) is a 400, not a 500", async (id) => {
    const res = await request(app).put(`/api/deals/${id}/assignment`).send({ assignedTo: MEMBER_OF_A });
    expect(res.status).toBe(400);
    expect(updateDeal).not.toHaveBeenCalled();
  });
});

describe("the generic deal write paths are not a bypass around the assignment validation", () => {
  let app: express.Application;
  beforeAll(() => {
    app = express();
    app.use(express.json());
    registerDealRoutes(app as any);
  });
  beforeEach(() => {
    dealRow = { id: DEAL_ID, organizationId: ORG_A, status: "negotiating", assignedTo: null, dealBook: null };
    updateDeal.mockClear();
    createDeal.mockClear();
    bulkUpdateDeals.mockClear();
    isAssignableLeadMember.mockClear();
  });

  it("PUT /api/deals/:id refuses a cross-org assignee", async () => {
    const res = await request(app).put(`/api/deals/${DEAL_ID}`).send({ assignedTo: MEMBER_OF_OTHER_ORG });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/active team member of this organization/);
    expect(updateDeal).not.toHaveBeenCalled();
  });

  it("PUT /api/deals/:id refuses an unknown book tag", async () => {
    const res = await request(app).put(`/api/deals/${DEAL_ID}`).send({ dealBook: "personal" });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/dealBook must be 'client', 'own_investment', or null/);
    expect(updateDeal).not.toHaveBeenCalled();
  });

  it("POST /api/deals refuses a cross-org assignee before creating anything", async () => {
    const res = await request(app)
      .post(`/api/deals`)
      .send({ propertyId: 5, type: "acquisition", assignedTo: MEMBER_OF_OTHER_ORG });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/active team member of this organization/);
    expect(createDeal).not.toHaveBeenCalled();
  });

  it("POST /api/deals/bulk-update runs the same assignment validation — and leaves non-assignment updates untouched", async () => {
    // Audit D1: bulk-update passed the raw updates object to
    // bulkUpdateDeals, whose protected-field strip does not cover
    // assignedTo/dealBook. A cross-org assignee is refused, with the
    // validator checked against the CALLER's org, and nothing is written.
    const crossOrg = await request(app)
      .post(`/api/deals/bulk-update`)
      .send({ ids: [DEAL_ID], updates: { assignedTo: MEMBER_OF_OTHER_ORG } });
    expect(crossOrg.status).toBe(400);
    expect(JSON.stringify(crossOrg.body)).toMatch(/active team member of this organization/);
    expect(isAssignableLeadMember).toHaveBeenCalledWith(MEMBER_OF_OTHER_ORG, ORG_A);
    expect(bulkUpdateDeals).not.toHaveBeenCalled();

    // A garbage book tag is refused the same way.
    const garbageBook = await request(app)
      .post(`/api/deals/bulk-update`)
      .send({ ids: [DEAL_ID], updates: { dealBook: "personal" } });
    expect(garbageBook.status).toBe(400);
    expect(JSON.stringify(garbageBook.body)).toMatch(/dealBook must be 'client', 'own_investment', or null/);
    expect(bulkUpdateDeals).not.toHaveBeenCalled();

    // A bulk update that does not touch the assignment fields passes
    // through untouched — the validator is not even consulted.
    isAssignableLeadMember.mockClear();
    const plain = await request(app)
      .post(`/api/deals/bulk-update`)
      .send({ ids: [DEAL_ID], updates: { notes: "follow up Friday" } });
    expect(plain.status).toBe(200);
    expect(plain.body).toMatchObject({ updatedCount: 1 });
    expect(isAssignableLeadMember).not.toHaveBeenCalled();
    expect(bulkUpdateDeals).toHaveBeenCalledWith(ORG_A, [DEAL_ID], { notes: "follow up Friday" });
  });
});
