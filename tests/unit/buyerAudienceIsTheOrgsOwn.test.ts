/**
 * DEFECT-0179 — a buyer audience is the org's own, and a deactivated buyer is
 * out of it.
 *
 * Found by the independent audit of DEFECT-0177:
 *  - `buyer_profiles.leadId` is caller-supplied and was never ownership
 *    checked. The buyer blast joined `leads` on that id alone, so a profile
 *    carrying another org's leadId returned that tenant's buyer name and
 *    email (dry run) and emailed them an offer of this org's land;
 *  - "Deactivate buyer" wrote only `engagement.deactivatedAt`, on the claim
 *    that no active column existed. `is_active` exists, and the matcher and
 *    the blast filter on it, so a deactivated buyer kept receiving matches
 *    and offers.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { getTableName, type SQL } from "drizzle-orm";

const h = vi.hoisted(() => ({
  joins: [] as string[],
  leadWhere: "",
  sets: [] as Array<Record<string, unknown>>,
  inserts: 0,
}));

vi.mock("../../server/db", async () => {
  const { PgDialect } = await import("drizzle-orm/pg-core");
  const dialect = new PgDialect();
  const render = (w: SQL) => dialect.sqlToQuery(w).sql;
  const chain = () => {
    let table = "";
    const rows = () =>
      table === "properties"
        ? [{ id: 3, status: "owned" }]
        : table === "buyer_profiles"
          ? [{ engagement: {} }]
          : table === "leads"
            ? // A lead read that names the organization finds nothing: the
              // lead in play belongs to another org.
              /"organization_id"/.test(h.leadWhere)
              ? []
              : [{ id: 5 }]
            : [];
    const q: Record<string, unknown> = {
      from(t: Parameters<typeof getTableName>[0]) {
        table = getTableName(t);
        return q;
      },
      innerJoin(_t: unknown, on: SQL) {
        h.joins.push(render(on));
        return q;
      },
      where(w: SQL) {
        if (table === "leads") h.leadWhere = render(w);
        return q;
      },
      orderBy: () => q,
      groupBy: () => q,
      limit: () => q,
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(rows()).then(res, rej),
    };
    return q;
  };
  const update = () => ({
    set: (v: Record<string, unknown>) => {
      h.sets.push(v);
      return { where: () => ({ returning: async () => [{ id: 11, ...v }] }) };
    },
  });
  const insert = () => ({
    values: () => {
      h.inserts++;
      return { returning: async () => [{ id: 11 }] };
    },
  });
  return { db: { select: chain, update, insert } };
});
vi.mock("../../server/auth", () => ({ isAuthenticated: (_q: unknown, _s: unknown, n: () => void) => n() }));
vi.mock("../../server/middleware/getOrCreateOrg", () => ({
  getOrCreateOrg: (req: { organization?: unknown; organizationId?: number }, _s: unknown, n: () => void) => {
    req.organization = { id: 7 };
    req.organizationId = 7;
    n();
  },
}));
vi.mock("../../server/middleware/roleGuard", () => ({ requireRole: () => (_q: unknown, _s: unknown, n: () => void) => n() }));
vi.mock("../../server/services/emailService", () => ({ sendEmail: vi.fn() }));
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/utils/openaiClient", () => ({ getOpenAIClient: vi.fn().mockReturnValue(null) }));

import { registerBuyerBlastRoutes } from "../../server/routes-buyer-blasts";
import { registerBuyerAnalyticsRoutes } from "../../server/routes-buyer-analytics";
import { BuyerMatchingAIService } from "../../server/services/buyerMatchingAI";

const app = express();
app.use(express.json());
registerBuyerBlastRoutes(app);
registerBuyerAnalyticsRoutes(app);

beforeEach(() => {
  h.joins = [];
  h.leadWhere = "";
  h.sets = [];
  h.inserts = 0;
});

describe("the blast joins only the org's own buyers and leads", () => {
  it("both the profile join and the lead join name the organization", async () => {
    await request(app).post("/api/properties/3/blast-buyers").send({ subject: "Land", body: "Five acres", dryRun: true });
    const leadJoin = h.joins.find((j) => /"leads"\."id"/.test(j));
    const profileJoin = h.joins.find((j) => /"buyer_profiles"\."id"/.test(j));
    expect(leadJoin).toMatch(/"leads"\."organization_id" = \$/);
    expect(profileJoin).toMatch(/"buyer_profiles"\."organization_id" = \$/);
  });
});

describe("a buyer profile can only point at the org's own lead", () => {
  it("another org's leadId is refused before anything is written", async () => {
    await expect(
      new BuyerMatchingAIService().createBuyerProfile(7, { leadId: 5, profileType: "individual" } as never),
    ).rejects.toMatchObject({ name: "BuyerMatchRefusal" });
    expect(h.inserts).toBe(0);
  });
});

describe("deactivate means inactive", () => {
  it("sets is_active false, which the matcher and the blast read", async () => {
    const res = await request(app).post("/api/buyer-profiles/11/deactivate");
    expect(res.status).toBe(200);
    expect(h.sets[0]).toMatchObject({ isActive: false });
  });
});
