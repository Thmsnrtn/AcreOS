/**
 * W10.4 audit finding 10 — POST /api/seed-demo-data.
 *
 * The Settings "Add Demo Data" button writes leads, properties, two CLOSED
 * deals, an in-escrow deal and notes into the org's workspace. It was
 * reachable by any member (a viewer included), and its parcels carried
 * real-format APNs — so its closed deals counted as the customer's own on
 * every money surface that splits sample from real (onboarding/sampleFilters:
 * a deal on a `SAMPLE-` parcel is sample lineage), and closing its escrow deal
 * would have run the close effects as a real first close.
 *
 * Now: owner/admin only (`canImportData`, the permission bulk record creation
 * already sits behind), and every demo parcel carries the SAMPLE- marker.
 * Driven through the real route and the real permission middleware.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const H = vi.hoisted(() => ({
  role: "member" as string,
  properties: [] as Array<Record<string, unknown>>,
  deals: [] as Array<{ deal: Record<string, unknown>; opts: unknown }>,
  leads: 0,
  leadSources: [] as unknown[],
  orgPatches: [] as Array<Record<string, unknown>>,
  notes: 0,
}));

vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/auth", () => ({
  isAuthenticated: (req: any, _res: any, next: any) => {
    req.user = { id: "user-1", claims: { sub: "user-1" } };
    next();
  },
}));
vi.mock("../../server/middleware/getOrCreateOrg", () => ({
  getOrCreateOrg: (req: any, _res: any, next: any) => {
    req.organization = { id: 42, name: "Test Org" };
    req.organizationId = 42;
    next();
  },
}));
vi.mock("../../server/storage", () => {
  let id = 100;
  const storage = {
    getTeamMember: async (orgId: number, userId: string) => ({ id: 1, organizationId: orgId, userId, role: H.role, isActive: true }),
    createLead: async (l: Record<string, unknown>) => (H.leads++, H.leadSources.push(l.source), { id: id++, ...l }),
    createProperty: async (p: Record<string, unknown>) => {
      const row = { id: id++, ...p };
      H.properties.push(row);
      return row;
    },
    createDeal: async (d: Record<string, unknown>, _tx: unknown, opts: unknown) => {
      H.deals.push({ deal: d, opts });
      return { id: id++, ...d };
    },
    createNote: async (n: Record<string, unknown>) => (H.notes++, { id: id++, ...n }),
    getOrganization: async (orgId: number) => ({ id: orgId, onboardingData: { persona: "land_flipper" } }),
    updateOrganization: async (orgId: number, patch: Record<string, unknown>) => (H.orgPatches.push(patch), { id: orgId, ...patch }),
  };
  return { storage, db: {} };
});

let app: express.Application;

beforeAll(async () => {
  const { registerAdminRoutes } = await import("../../server/routes-admin");
  app = express();
  app.use(express.json());
  registerAdminRoutes(app as any);
});

beforeEach(() => {
  H.properties = [];
  H.deals = [];
  H.leads = 0;
  H.leadSources = [];
  H.orgPatches = [];
  H.notes = 0;
});

describe("seed-demo-data is not a member's button", () => {
  it.each(["member", "va", "viewer"])("a %s is refused (403) and nothing is written", async (role) => {
    H.role = role;
    const res = await request(app).post("/api/seed-demo-data").send({});
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("FORBIDDEN");
    expect(res.body.details.requiredPermission).toBe("canImportData");
    expect(H.properties).toEqual([]);
    expect(H.deals).toEqual([]);
    expect(H.leads + H.notes).toBe(0);
  });

  it.each(["owner", "admin"])("an %s may seed (the Settings Developer Tools use stands)", async (role) => {
    H.role = role;
    const res = await request(app).post("/api/seed-demo-data").send({});
    expect(res.status).toBe(200);
    expect(H.properties.length).toBeGreaterThan(0);
  });
});

describe("its parcels are the sample book", () => {
  it("flags the org's sample set complete (keeping the rest of its onboarding data), so onboarding never 'repairs' it", async () => {
    H.role = "owner";
    await request(app).post("/api/seed-demo-data").send({});
    expect(H.orgPatches).toEqual([{ onboardingData: { persona: "land_flipper", sampleDataLoaded: true } }]);
  });

  it("a refused caller flags nothing", async () => {
    H.role = "viewer";
    await request(app).post("/api/seed-demo-data").send({});
    expect(H.orgPatches).toEqual([]);
  });

  it("every demo lead carries the sample source, so it is not counted as pipeline and the sample clear removes it", async () => {
    const { SAMPLE_LEAD_SOURCE } = await import("../../server/services/onboarding/sampleSeeder");
    H.role = "owner";
    await request(app).post("/api/seed-demo-data").send({});
    expect(H.leads).toBeGreaterThan(0);
    expect(H.leadSources).toEqual(Array(H.leads).fill(SAMPLE_LEAD_SOURCE));
  });

  it("every demo property carries the SAMPLE- APN marker, so its deals and notes are sample lineage", async () => {
    const { SAMPLE_APN_PREFIX } = await import("../../server/services/onboarding/sampleSeeder");
    H.role = "owner";
    await request(app).post("/api/seed-demo-data").send({});
    expect(H.properties.length).toBe(5);
    for (const p of H.properties) expect(String(p.apn).startsWith(SAMPLE_APN_PREFIX), String(p.apn)).toBe(true);
    // Every demo deal hangs off one of those parcels, created as a "sample".
    const sampleIds = new Set(H.properties.map((p) => p.id));
    expect(H.deals.length).toBeGreaterThan(0);
    for (const d of H.deals) {
      expect(sampleIds.has(d.deal.propertyId)).toBe(true);
      expect(d.opts).toEqual({ creation: "sample" });
    }
  });
});
