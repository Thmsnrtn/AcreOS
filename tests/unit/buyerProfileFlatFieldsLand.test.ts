/**
 * W-DEF-2 — the buyer-profile creation API discarded the profile's
 * financial/preference data.
 *
 * POST /api/ai/buyer-matching/profile validates a FLAT body (leadId,
 * targetCounties, priceRangeMin/Max, acreageMin/Max, financing), but
 * `createBuyerProfile` stores preferences/financialInfo/intent — and the
 * route passed the flat body straight through, so every profile created
 * through the product's only creation API stored
 * `preferences=null, financial_info=null, intent=null` no matter what the
 * caller supplied (proven live on staging, 2026-11-18 walk, org 106
 * profile 1). The buyer then matched on neutral defaults and was excluded
 * from the default cash-financing blast audience, which admits only
 * `financialInfo.financingType === "cash"`.
 *
 * WHAT THIS FILE PROVES, AND HOW IT CAN FAIL
 * ------------------------------------------
 * These tests drive the REAL route (registerAIOperationsRoutes +
 * supertest, real validateRequest, real BuyerMatchingAIService) with only
 * auth, org resolution, and the database stubbed. The db double is honest
 * in the two places honesty matters:
 *
 *   - `leads` renders the WHERE expression the service actually emitted
 *     and applies exactly those predicates (the buyerContactTenancy
 *     pattern), so the DEFECT-0179 ownership check still decides which
 *     leadIds may be profiled — a foreign lead is refused through the
 *     route, and no row is stored.
 *   - `buyer_profiles` inserts are stored as rows (undefined jsonb fields
 *     normalised to null, the column default applied to profileType) and
 *     the assertions read the STORED row back — not the request, not the
 *     service's arguments. Remove the route's translation and the stored
 *     row is nulls again, and the first test fails: that is the defect,
 *     falsified semantically rather than by symbol.
 *
 * The last two tests pin the boundaries of the cure: a profile created
 * with no flat fields stores exactly the nulls it always did, and
 * `financing: false` stores no financingType — a false asserts nothing
 * about how the buyer pays, so no blast audience is invented for them.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { PgDialect } from "drizzle-orm/pg-core";
import { getTableName } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

const ORG = 106; // the walk's org, in memoriam
const LEAD_OWN = 92; // the walk's buyer lead
const LEAD_FOREIGN = 77; // another org's lead

const state = vi.hoisted(() => ({
  leads: [] as Array<{ id: number; organizationId: number }>,
  profiles: [] as Array<Record<string, unknown>>,
  nextProfileId: 0,
}));

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../server/auth", () => ({
  isAuthenticated: (req: any, _res: unknown, next: () => void) => {
    req.user = { id: "user-walk" };
    next();
  },
}));
vi.mock("../../server/middleware/getOrCreateOrg", () => ({
  getOrCreateOrg: (req: any, _res: unknown, next: () => void) => {
    req.organization = { id: ORG };
    req.organizationId = ORG;
    next();
  },
}));
vi.mock("../../server/storage", () => ({ storage: {} }));
vi.mock("../../server/utils/openaiClient", () => ({
  getOpenAIClient: vi.fn().mockReturnValue(null),
}));
vi.mock("../../server/services/buyerEvents", () => ({
  emitBuyerMatchCreated: vi.fn(),
}));

vi.mock("../../server/db", async () => {
  const { PgDialect: Dialect } = await import("drizzle-orm/pg-core");
  const { getTableName: tableName } = await import("drizzle-orm");
  const dialect = new Dialect();

  // Apply the predicates the SERVICE emitted against `leads` — all of
  // them, only them. An unrecognised pinned column filters everything
  // out rather than being ignored, so a predicate can never widen the
  // result set silently.
  const LEAD_COLUMNS: Record<string, (row: any) => unknown> = {
    id: (r) => r.id,
    organization_id: (r) => r.organizationId,
  };
  const selectLeads = (expr: unknown) => {
    const { sql, params } = dialect.sqlToQuery(expr as SQL);
    const pinned: Array<[string, unknown]> = [];
    for (const m of sql.matchAll(/"leads"\."([a-z_]+)"\s*=\s*\$(\d+)/g)) {
      pinned.push([m[1], params[Number(m[2]) - 1]]);
    }
    return state.leads.filter((row) =>
      pinned.every(([col, value]) => {
        const read = LEAD_COLUMNS[col];
        return read ? read(row) === value : false;
      }),
    );
  };

  const select = () => {
    let table: any;
    const q: any = {};
    q.from = (t: unknown) => {
      table = t;
      return q;
    };
    q.where = (expr: unknown) => {
      const rows =
        table && tableName(table) === "leads" ? selectLeads(expr) : [];
      const p: any = Promise.resolve(rows);
      p.limit = async () => rows;
      return p;
    };
    return q;
  };

  const insert = (table: any) => ({
    values: (values: Record<string, unknown>) => {
      const isProfile = tableName(table) === "buyer_profiles";
      // Mirror Postgres: undefined jsonb inputs store as null; the
      // profile_type column default applies when none was supplied.
      const row: Record<string, unknown> = isProfile
        ? {
            id: (state.nextProfileId += 1),
            ...values,
            profileType: values.profileType ?? "individual",
            preferences: values.preferences ?? null,
            financialInfo: values.financialInfo ?? null,
            intent: values.intent ?? null,
          }
        : { ...values };
      if (isProfile) state.profiles.push(row);
      const p: any = Promise.resolve([row]);
      p.returning = async () => [row];
      return p;
    },
  });

  return { db: { select, insert } };
});

import { registerAIOperationsRoutes } from "../../server/routes-ai-operations";

function app() {
  const a = express();
  a.use(express.json());
  registerAIOperationsRoutes(a);
  return a;
}

beforeEach(() => {
  state.leads = [
    { id: LEAD_OWN, organizationId: ORG },
    { id: LEAD_FOREIGN, organizationId: 999 },
  ];
  state.profiles = [];
  state.nextProfileId = 0;
});

describe("POST /api/ai/buyer-matching/profile (W-DEF-2)", () => {
  it("stores the supplied flat fields as preferences/financialInfo — the walk payload, read back from the stored row", async () => {
    const res = await request(app())
      .post("/api/ai/buyer-matching/profile")
      .send({
        leadId: LEAD_OWN,
        targetCounties: ["Harris"],
        priceRangeMin: 50000,
        priceRangeMax: 250000,
        acreageMin: 0.1,
        acreageMax: 2,
        financing: true,
      });

    expect(res.status).toBe(200);
    expect(state.profiles).toHaveLength(1);
    const stored = state.profiles[0];
    expect(stored.organizationId).toBe(ORG);
    expect(stored.leadId).toBe(LEAD_OWN);
    expect(stored.profileType).toBe("individual");
    expect(stored.preferences).toEqual({
      counties: ["Harris"],
      minPrice: 50000,
      maxPrice: 250000,
      minAcreage: 0.1,
      maxAcreage: 2,
    });
    // budget = the stated ceiling; financingType "cash" is what admits
    // this buyer to the default blast audience.
    expect(stored.financialInfo).toEqual({
      budget: 250000,
      financingType: "cash",
    });
    expect(stored.intent).toBeNull();
    // The response is the stored row, so it carries the landed data too.
    expect(res.body.preferences).toEqual(stored.preferences);
    expect(res.body.financialInfo).toEqual(stored.financialInfo);
  });

  it("a profile created with no flat fields stores the same nulls it always did", async () => {
    const res = await request(app())
      .post("/api/ai/buyer-matching/profile")
      .send({ leadId: LEAD_OWN });

    expect(res.status).toBe(200);
    expect(state.profiles).toHaveLength(1);
    const stored = state.profiles[0];
    expect(stored.preferences).toBeNull();
    expect(stored.financialInfo).toBeNull();
    expect(stored.intent).toBeNull();
    expect(stored.profileType).toBe("individual");
  });

  it("financing:false stores the budget but no financingType — no audience is invented", async () => {
    const res = await request(app())
      .post("/api/ai/buyer-matching/profile")
      .send({ leadId: LEAD_OWN, priceRangeMax: 100000, financing: false });

    expect(res.status).toBe(200);
    expect(state.profiles).toHaveLength(1);
    const stored = state.profiles[0];
    expect(stored.preferences).toEqual({ maxPrice: 100000 });
    expect(stored.financialInfo).toEqual({ budget: 100000 });
    expect(
      (stored.financialInfo as Record<string, unknown>).financingType,
    ).toBeUndefined();
  });

  it("a foreign leadId is still refused through the route and stores nothing (DEFECT-0179)", async () => {
    const res = await request(app())
      .post("/api/ai/buyer-matching/profile")
      .send({ leadId: LEAD_FOREIGN, priceRangeMax: 250000, financing: true });

    expect(res.status).toBe(400);
    expect(state.profiles).toHaveLength(0);
  });
});
