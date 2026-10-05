/**
 * GET /api/leads/focus and GET /api/leads/aging read only what they show
 * (W10.2b audit).
 *
 * The focus list read readAllLeads — `select *` over the whole book — on every
 * Leads page render, then scored each lead in memory. The score is computed,
 * not stored, so ranking stays in JS; but SQL now narrows to the leads the
 * list can pick (not contacted in the last 24h — the one part of its filter
 * that does not depend on the score), reads only the scorer's columns, and
 * reads full rows for the ten it returns. The response is unchanged.
 *
 * The aging list returns the most urgent leads (bounded in SQL) with the
 * whole-book total in X-Total-Count; the body stays an array.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const H = vi.hoisted(() => ({
  candidates: [] as Array<Record<string, unknown> & { id: number; createdAt: Date }>,
  cutoffs: [] as Array<{ org: number; before: Date }>,
  fullReads: [] as number[][],
  full: new Map<number, Record<string, unknown>>(),
}));

vi.mock("../../server/storage/wholeOrgReadsG", () => ({
  focusLeadCandidates: vi.fn(async (org: number, before: Date) => {
    H.cutoffs.push({ org, before });
    return H.candidates;
  }),
}));
vi.mock("../../server/storage/wholeBookReads", () => ({
  readAllLeads: vi.fn(async () => {
    throw new Error("the focus list must not read every lead row");
  }),
  readPropertiesBySellerIds: vi.fn(async () => []),
}));
vi.mock("../../server/storage", () => ({
  storage: {
    getLeadsByIds: vi.fn(async (org: number, ids: number[]) => {
      H.fullReads.push(ids);
      // Unordered, as SQL `IN (…)` returns them; org-scoped.
      return org === 7 ? ids.map((id) => H.full.get(id)).filter(Boolean).reverse() : [];
    }),
  },
  db: {},
}));
vi.mock("../../server/db", () => ({ db: {} }));

vi.mock("../../server/auth", () => ({ isAuthenticated: (_q: unknown, _s: unknown, n: () => void) => n() }));
vi.mock("../../server/middleware/getOrCreateOrg", () => ({
  getOrCreateOrg: (req: { organization?: unknown }, _s: unknown, n: () => void) => {
    req.organization = { id: 7 };
    n();
  },
}));
vi.mock("../../server/middleware/usageLimitGate", () => ({ usageLimitGate: () => (_q: unknown, _s: unknown, n: () => void) => n() }));
vi.mock("../../server/middleware/roleScope", () => ({ requireScope: () => (_q: unknown, _s: unknown, n: () => void) => n() }));
vi.mock("../../server/utils/permissions", () => ({
  attachPermissionContext: () => (_q: unknown, _s: unknown, n: () => void) => n(),
  requirePermission: () => (_q: unknown, _s: unknown, n: () => void) => n(),
}));
vi.mock("../../server/utils/orgScope", () => ({ assertUserIsOrgMember: vi.fn(async () => true) }));
vi.mock("../../server/services/usageLimits", () => ({ checkUsageLimit: vi.fn() }));
// A transparent scorer: the score is the lead's emailOpens; under 20 is dead.
vi.mock("../../server/services/leadNurturer", () => ({
  leadNurturerService: {
    calculateLeadScore: (l: { emailOpens: number }) => ({ score: l.emailOpens, factors: { total: l.emailOpens } }),
    segmentLead: (score: number) => (score >= 80 ? "hot" : score >= 50 ? "warm" : score >= 20 ? "cold" : "dead"),
  },
}));
vi.mock("../../server/services/leadScoring", () => ({ leadScoringService: {} }));
vi.mock("../../server/services/skipTracingService", () => ({ skipTracingService: {} }));
vi.mock("../../server/services/alerting", () => ({
  alertingService: {
    getAgingLeads: vi.fn(async () => ({ agingLeads: [{ id: 3, urgency: "urgent" }], total: 4321 })),
  },
}));
vi.mock("../../server/services/propertyEnrichment", () => ({ propertyEnrichmentService: {} }));
vi.mock("../../server/services/credits", () => ({ usageMeteringService: {}, creditService: {} }));
vi.mock("../../server/middleware/fileUploadSecurity", () => ({
  createUploadMiddleware: () => ({ single: () => (_q: unknown, _s: unknown, n: () => void) => n() }),
  validateFileMiddleware: () => (_q: unknown, _s: unknown, n: () => void) => n(),
}));
vi.mock("../../server/utils/contractResponse", () => ({ validateResponse: (_s: unknown, p: unknown) => p }));

const { registerLeadRoutes } = await import("../../server/routes-leads");
const app = express();
app.use(express.json());
registerLeadRoutes(app);

const candidate = (id: number, emailOpens: number) => ({
  id,
  emailOpens,
  createdAt: new Date(Date.UTC(2025, 0, 1) + id * 60_000),
  lastContactedAt: null,
});

beforeEach(() => {
  H.candidates = [];
  H.cutoffs = [];
  H.fullReads = [];
  H.full = new Map();
});

describe("GET /api/leads/focus", () => {
  it("ranks the SQL-narrowed candidates and returns the full rows of the top ten, unchanged in shape", async () => {
    // 6,000 candidates: the best-scoring is the OLDEST (id 1); ids 2..6000 score by id.
    H.candidates = [candidate(1, 100), ...Array.from({ length: 5999 }, (_, i) => candidate(i + 2, (i + 2) % 79))];
    for (const c of H.candidates) H.full.set(c.id, { id: c.id, firstName: `F${c.id}`, organizationId: 7, emailOpens: c.emailOpens, notes: "full row" });

    const before = Date.now();
    const r = await request(app).get("/api/leads/focus");
    expect(r.status).toBe(200);

    // The candidate read is org-scoped with a 24-hour cutoff.
    expect(H.cutoffs).toHaveLength(1);
    expect(H.cutoffs[0].org).toBe(7);
    expect(Math.abs(before - 24 * 3_600_000 - H.cutoffs[0].before.getTime())).toBeLessThan(5_000);

    // Full rows are read for exactly the ten shown.
    expect(H.fullReads).toHaveLength(1);
    expect(H.fullReads[0]).toHaveLength(10);

    expect(r.body).toHaveLength(10);
    expect(r.body[0]).toEqual({
      id: 1,
      firstName: "F1",
      organizationId: 7,
      emailOpens: 100,
      notes: "full row",
      score: 100,
      scoreFactors: { total: 100 },
      nurturingStage: "hot",
    });
    // Ranked by score; ties keep newest first (78 is scored by ids 78, 157, 236 …).
    const scores = r.body.map((l: { score: number }) => l.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    const ties = r.body.filter((l: { score: number }) => l.score === 78).map((l: { id: number }) => l.id);
    expect(ties).toEqual([...ties].sort((a, b) => b - a));
  });

  it("dead (computed stage) leads are never shown", async () => {
    H.candidates = [candidate(1, 5), candidate(2, 25)];
    for (const c of H.candidates) H.full.set(c.id, { id: c.id });
    const r = await request(app).get("/api/leads/focus");
    expect(r.body.map((l: { id: number }) => l.id)).toEqual([2]);
    expect(H.fullReads[0]).toEqual([2]);
  });

  it("a lead deleted between the two reads is dropped, not shown stale", async () => {
    H.candidates = [candidate(1, 60), candidate(2, 70)];
    H.full.set(2, { id: 2 });
    const r = await request(app).get("/api/leads/focus");
    expect(r.body.map((l: { id: number }) => l.id)).toEqual([2]);
  });
});

describe("GET /api/leads/aging", () => {
  it("the body is the array it always was; the whole-book total is X-Total-Count", async () => {
    const r = await request(app).get("/api/leads/aging");
    expect(r.status).toBe(200);
    expect(r.body).toEqual([{ id: 3, urgency: "urgent" }]);
    expect(r.headers["x-total-count"]).toBe("4321");
  });
});
