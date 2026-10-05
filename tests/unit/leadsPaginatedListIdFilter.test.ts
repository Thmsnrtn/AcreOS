/**
 * W10.3 — GET /api/leads/paginated?listId=… pages the members of ONE of the
 * caller's marketing lists. Another org's list (or a malformed id) is not
 * found — never ignored, which would render the whole book as "the list".
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { sql } from "drizzle-orm";

const H = vi.hoisted(() => ({
  owned: new Set<number>(),
  ownershipChecks: [] as Array<[number, number]>,
  listReads: [] as unknown[][],
  bookReads: [] as unknown[][],
  stageAsked: [] as string[],
}));

const STAGE_SQL = sql`score >= 80`;

vi.mock("../../server/storage/listBuilderRepo", () => ({
  orgHasMarketingList: vi.fn(async (org: number, listId: number) => {
    H.ownershipChecks.push([org, listId]);
    return org === 7 && H.owned.has(listId);
  }),
  listMemberLeadsCursor: vi.fn(async (...args: unknown[]) => {
    H.listReads.push(args);
    return { data: [{ id: 41, emailOpens: 0 }], total: 1, hasMore: false };
  }),
}));
vi.mock("../../server/storage", () => ({
  storage: {
    getLeadsCursor: vi.fn(async (...args: unknown[]) => {
      H.bookReads.push(args);
      return { data: [{ id: 1, emailOpens: 0 }, { id: 2, emailOpens: 0 }], total: 2, hasMore: false };
    }),
    stageConditionSql: vi.fn((stage: string) => {
      H.stageAsked.push(stage);
      return STAGE_SQL;
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
vi.mock("../../server/services/leadNurturer", () => ({
  leadNurturerService: {
    calculateLeadScore: () => ({ score: 50, factors: {} }),
    segmentLead: () => "warm",
  },
}));
vi.mock("../../server/services/leadScoring", () => ({ leadScoringService: {} }));
vi.mock("../../server/services/skipTracingService", () => ({ skipTracingService: {} }));
vi.mock("../../server/services/alerting", () => ({ alertingService: {} }));
vi.mock("../../server/services/propertyEnrichment", () => ({ propertyEnrichmentService: {} }));
vi.mock("../../server/services/credits", () => ({ usageMeteringService: {}, creditService: {} }));
vi.mock("../../server/middleware/fileUploadSecurity", () => ({
  createUploadMiddleware: () => ({ single: () => (_q: unknown, _s: unknown, n: () => void) => n() }),
  validateFileMiddleware: () => (_q: unknown, _s: unknown, n: () => void) => n(),
}));
vi.mock("../../server/utils/contractResponse", () => ({ validateResponse: (_s: unknown, p: unknown) => p }));
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const { registerLeadRoutes } = await import("../../server/routes-leads");
const app = express();
app.use(express.json());
registerLeadRoutes(app);

beforeEach(() => {
  H.owned = new Set([5]);
  H.ownershipChecks = [];
  H.listReads = [];
  H.bookReads = [];
  H.stageAsked = [];
});

describe("GET /api/leads/paginated?listId", () => {
  it("without listId, the whole book is paged as before", async () => {
    const r = await request(app).get("/api/leads/paginated?limit=10");
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(2);
    expect(H.listReads).toEqual([]);
    expect(H.bookReads).toHaveLength(1);
  });

  it("with the org's own list, only its members are paged — org and list passed through", async () => {
    const r = await request(app).get("/api/leads/paginated?listId=5&limit=10&cursor=900&stage=hot");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ total: 1, hasMore: false, nextCursor: null });
    expect(r.body.data.map((l: { id: number }) => l.id)).toEqual([41]);
    expect(H.bookReads).toEqual([]);
    expect(H.ownershipChecks).toEqual([[7, 5]]);
    const [org, listId, opts] = H.listReads[0] as [number, number, { limit: number; cursor: number; stageCondition: unknown }];
    expect([org, listId]).toEqual([7, 5]);
    expect(opts).toMatchObject({ limit: 10, cursor: 900 });
    expect(opts.stageCondition).toBe(STAGE_SQL);
    expect(H.stageAsked).toEqual(["hot"]);
  });

  it("another org's list — or a malformed id — is not found, and nothing is read", async () => {
    for (const q of ["listId=6", "listId=abc", "listId=0", "listId=-3", "listId=1.5"]) {
      const r = await request(app).get(`/api/leads/paginated?${q}`);
      expect(r.status, q).toBe(404);
    }
    expect(H.listReads).toEqual([]);
    expect(H.bookReads).toEqual([]);
  });
});
