/**
 * G1.2 — public read-only demo workspace (server/routes-demo.ts), mounted on
 * a bare express app with storage/seeder/db mocked (routes-eddm.test.ts
 * pattern).
 *
 * Contract pinned:
 *   1. Honest not-provisioned behavior — DEMO_ORG_ID unset or the org row
 *      missing reports { provisioned: false, reason }, and NOTHING is ever
 *      created or invented (never a fake org).
 *   2. Provisioning composes EXISTING machinery: the ONE sample-data path
 *      (seedSampleDataForOrg), org-level simulationMode enforced, free tier
 *      REQUIRED (a non-free designated org is refused, billing never
 *      silently edited).
 *   3. Hard read-only guard: every mutating /api request from a demo session
 *      → 403, before any route runs; GETs pass; the session lifecycle
 *      endpoints stay reachable; sessions without the cookie are untouched.
 *   4. The workspace snapshot serves ONLY sample-marked rows — a
 *      misconfigured DEMO_ORG_ID pointing at a live org cannot leak real
 *      rows.
 *   5. Funnel stays clean (G1.1 composition): the markers demo rows carry
 *      are exactly the ones the activation recorder refuses, so demo
 *      activity can never light the founder funnel; and the demo org's
 *      settings satisfy shouldSimulate, so any send lands in
 *      simulated_actions, never a provider.
 */

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";

// ── Mocks BEFORE importing the module under test ────────────────────────────

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const storageMock = vi.hoisted(() => ({
  getOrganization: vi.fn(),
  updateOrganization: vi.fn(),
  getLeads: vi.fn(),
  getProperties: vi.fn(),
  getDeals: vi.fn(),
  getNotes: vi.fn(),
}));
vi.mock("../../server/storage", () => ({ storage: storageMock }));

const seederMock = vi.hoisted(() => ({
  seedSampleDataForOrg: vi.fn(async () => ({ seeded: true, counts: {} })),
}));
vi.mock("../../server/services/onboarding/sampleSeeder", async () => {
  // Real marker constants (the contract under test), mocked seeder.
  const markers = await import("../../server/services/onboarding/sampleMarkers");
  return {
    seedSampleDataForOrg: seederMock.seedSampleDataForOrg,
    SAMPLE_LEAD_SOURCE: markers.SAMPLE_LEAD_SOURCE,
    SAMPLE_APN_PREFIX: markers.SAMPLE_APN_PREFIX,
  };
});

// In-memory activation_events double (registryActivation.test.ts pattern)
// for the funnel-cleanliness pin.
const activationMem = vi.hoisted(() => ({
  rows: [] as Array<{ organizationId: number; eventName: string }>,
}));
vi.mock("../../server/db", () => ({
  db: {
    insert: (_table: unknown) => ({
      values: (vals: any) => ({
        onConflictDoNothing: async (_opts: unknown) => {
          activationMem.rows.push({ ...vals });
        },
      }),
    }),
  },
}));

import {
  DEMO_GUARD_EXEMPT_PATHS,
  DEMO_ORG_ENV,
  DEMO_SESSION_COOKIE,
  demoSessionReadOnlyGuard,
  registerDemoRoutes,
} from "../../server/routes-demo";
import { recordActivationEvent } from "../../server/services/activation";
import {
  SAMPLE_APN_PREFIX,
  SAMPLE_LEAD_SOURCE,
} from "../../server/services/onboarding/sampleMarkers";
import { shouldSimulate } from "../../server/utils/simulationMode";

const DEMO_ORG_ID = 7042;
const DEMO_COOKIE = `${DEMO_SESSION_COOKIE}=viewer`;

function demoOrg(overrides: Record<string, unknown> = {}) {
  return {
    id: DEMO_ORG_ID,
    name: "AcreOS Demo",
    slug: "acreos-demo",
    subscriptionTier: "free",
    settings: { simulationMode: true },
    onboardingData: { businessType: "land_flipper" },
    ...overrides,
  };
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  // Same order as server/routes.ts: guard BEFORE any route registration.
  app.use(demoSessionReadOnlyGuard);
  registerDemoRoutes(app);
  // Downstream stand-ins for real app routes the guard must protect.
  app.post("/api/leads", (_req, res) => res.json({ mutated: true }));
  app.patch("/api/leads/1", (_req, res) => res.json({ mutated: true }));
  app.delete("/api/leads/1", (_req, res) => res.json({ mutated: true }));
  app.get("/api/leads", (_req, res) => res.json({ read: true }));
  return app;
}

const savedEnv = process.env[DEMO_ORG_ENV];

beforeEach(() => {
  vi.clearAllMocks();
  activationMem.rows = [];
  delete process.env[DEMO_ORG_ENV];
  storageMock.updateOrganization.mockImplementation(
    async (_id: number, updates: Record<string, unknown>) => ({
      ...demoOrg(),
      ...updates,
    }),
  );
});

afterEach(() => {
  if (savedEnv === undefined) delete process.env[DEMO_ORG_ENV];
  else process.env[DEMO_ORG_ENV] = savedEnv;
});

describe("honest not-provisioned behavior (never a fake org)", () => {
  it("status reports not_configured when DEMO_ORG_ID is unset — without touching storage", async () => {
    const res = await request(buildApp()).get("/api/demo/status");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ provisioned: false, reason: "not_configured" });
    expect(storageMock.getOrganization).not.toHaveBeenCalled();
  });

  it("session refuses when unconfigured: no cookie, no seed, no org creation", async () => {
    const res = await request(buildApp()).post("/api/demo/session");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ provisioned: false, reason: "not_configured" });
    expect(res.headers["set-cookie"]).toBeUndefined();
    expect(seederMock.seedSampleDataForOrg).not.toHaveBeenCalled();
  });

  it("reports org_not_found when DEMO_ORG_ID names a missing row — and creates nothing", async () => {
    process.env[DEMO_ORG_ENV] = String(DEMO_ORG_ID);
    storageMock.getOrganization.mockResolvedValue(undefined);
    const res = await request(buildApp()).get("/api/demo/status");
    expect(res.body).toEqual({ provisioned: false, reason: "org_not_found" });
    expect(storageMock.updateOrganization).not.toHaveBeenCalled();
    expect(seederMock.seedSampleDataForOrg).not.toHaveBeenCalled();
  });
});

describe("provisioning composes existing machinery", () => {
  beforeEach(() => {
    process.env[DEMO_ORG_ENV] = String(DEMO_ORG_ID);
  });

  it("session seeds via the ONE sample-data path with the org's vertical, and sets the cookie", async () => {
    storageMock.getOrganization.mockResolvedValue(demoOrg());
    const res = await request(buildApp()).post("/api/demo/session");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      provisioned: true,
      role: "viewer",
      readOnly: true,
      vertical: "land_flipper",
      verticalLabel: "Land flipper",
    });
    expect(res.headers["set-cookie"]?.[0]).toContain(DEMO_SESSION_COOKIE);
    expect(seederMock.seedSampleDataForOrg).toHaveBeenCalledWith(
      String(DEMO_ORG_ID),
      "land_flipper",
    );
    // Settings already carried simulationMode — no redundant write.
    expect(storageMock.updateOrganization).not.toHaveBeenCalled();
  });

  it("enforces org-level simulationMode when the designated org lacks it", async () => {
    storageMock.getOrganization.mockResolvedValue(demoOrg({ settings: {} }));
    const res = await request(buildApp()).post("/api/demo/session");
    expect(res.body.provisioned).toBe(true);
    expect(storageMock.updateOrganization).toHaveBeenCalledWith(
      DEMO_ORG_ID,
      expect.objectContaining({
        settings: expect.objectContaining({ simulationMode: true }),
      }),
    );
  });

  it("REFUSES a non-free designated org — billing is never silently edited", async () => {
    storageMock.getOrganization.mockResolvedValue(
      demoOrg({ subscriptionTier: "pro" }),
    );
    const res = await request(buildApp()).post("/api/demo/session");
    expect(res.body).toEqual({
      provisioned: false,
      reason: "demo_org_not_free_tier",
    });
    expect(res.headers["set-cookie"]).toBeUndefined();
    expect(storageMock.updateOrganization).not.toHaveBeenCalled();
    expect(seederMock.seedSampleDataForOrg).not.toHaveBeenCalled();
  });
});

describe("hard read-only guard — every mutating verb from a demo session → 403", () => {
  beforeEach(() => {
    process.env[DEMO_ORG_ENV] = String(DEMO_ORG_ID);
    storageMock.getOrganization.mockResolvedValue(demoOrg());
  });

  it("blocks POST/PATCH/DELETE on registered routes before the handler runs", async () => {
    const app = buildApp();
    for (const [method, path] of [
      ["post", "/api/leads"],
      ["patch", "/api/leads/1"],
      ["delete", "/api/leads/1"],
    ] as const) {
      const res = await (request(app) as any)[method](path).set("Cookie", DEMO_COOKIE);
      expect(res.status, `${method.toUpperCase()} ${path}`).toBe(403);
      expect(res.body.mutated).toBeUndefined();
      expect(res.body).toMatchObject({ statusCode: 403 });
    }
  });

  it("blocks mutations even on unregistered /api paths (guard runs app-wide, not per-route)", async () => {
    const res = await request(buildApp())
      .post("/api/anything/else")
      .set("Cookie", DEMO_COOKIE);
    expect(res.status).toBe(403);
  });

  it("case-shifted paths cannot slip the guard (Express matches routes case-insensitively)", async () => {
    const res = await request(buildApp())
      .post("/API/leads")
      .set("Cookie", DEMO_COOKIE);
    expect(res.status).toBe(403);
  });

  it("exempts the anonymous marketing-touch beacon — the acquisition funnel must not go dark for demo visitors", async () => {
    // Slice-3 audit catch: blocking POST /api/marketing/touch silenced every
    // page_view/CTA touch from the browser for the cookie's 2h life —
    // including the demo:entry event itself.
    expect(DEMO_GUARD_EXEMPT_PATHS.has("/api/marketing/touch")).toBe(true);
    const res = await request(buildApp())
      .post("/api/marketing/touch")
      .set("Cookie", DEMO_COOKIE);
    expect(res.status).not.toBe(403);
  });

  it("lets demo-session GETs through", async () => {
    const res = await request(buildApp()).get("/api/leads").set("Cookie", DEMO_COOKIE);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ read: true });
  });

  it("does not touch requests without the demo cookie", async () => {
    const res = await request(buildApp()).post("/api/leads");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ mutated: true });
  });

  it("keeps the session lifecycle reachable: /api/demo/exit clears the cookie", async () => {
    const res = await request(buildApp())
      .post("/api/demo/exit")
      .set("Cookie", DEMO_COOKIE);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(res.headers["set-cookie"]?.[0]).toMatch(
      new RegExp(`${DEMO_SESSION_COOKIE}=;`),
    );
  });
});

describe("workspace snapshot serves ONLY sample-marked rows", () => {
  beforeEach(() => {
    process.env[DEMO_ORG_ENV] = String(DEMO_ORG_ID);
    storageMock.getOrganization.mockResolvedValue(demoOrg());
    storageMock.getLeads.mockResolvedValue([
      { id: 1, firstName: "John", lastName: "Anderson", status: "new", city: "Austin", state: "TX", source: SAMPLE_LEAD_SOURCE },
      // A REAL row that must never leave this API, even if the env id is
      // misconfigured to point at a live org.
      { id: 2, firstName: "Real", lastName: "Customer", status: "new", city: "Reno", state: "NV", source: "direct_mail" },
    ]);
    storageMock.getProperties.mockResolvedValue([
      { id: 11, apn: `${SAMPLE_APN_PREFIX}TX-001`, county: "Travis", state: "TX", status: "owned", sizeAcres: "5.0" },
      { id: 12, apn: "123-456-789", county: "Washoe", state: "NV", status: "owned", sizeAcres: "2.0" },
    ]);
    storageMock.getDeals.mockResolvedValue([
      { id: 21, type: "acquisition", status: "open", offerAmount: "9000", propertyId: 11, notes: "Sample deal" },
      { id: 22, type: "acquisition", status: "open", offerAmount: "50000", propertyId: 12, notes: "Real deal" },
    ]);
    storageMock.getNotes.mockResolvedValue([
      { id: 31, status: "active", currentBalance: "12000", monthlyPayment: "300", propertyId: 11 },
      { id: 32, status: "active", currentBalance: "90000", monthlyPayment: "900", propertyId: 12 },
    ]);
  });

  it("refuses without a demo session", async () => {
    const res = await request(buildApp()).get("/api/demo/workspace");
    expect(res.status).toBe(403);
  });

  it("returns the viewer-shaped, sample-only snapshot", async () => {
    const res = await request(buildApp())
      .get("/api/demo/workspace")
      .set("Cookie", DEMO_COOKIE);
    expect(res.status).toBe(200);
    expect(res.body.role).toBe("viewer");
    expect(res.body.readOnly).toBe(true);
    expect(res.body.org).toMatchObject({
      vertical: "land_flipper",
      verticalLabel: "Land flipper",
      simulated: true,
    });
    expect(res.body.counts).toEqual({ leads: 1, properties: 1, deals: 1, notes: 1 });
    expect(res.body.leads.map((l: any) => l.id)).toEqual([1]);
    expect(res.body.properties.map((p: any) => p.id)).toEqual([11]);
    expect(res.body.deals.map((d: any) => d.id)).toEqual([21]);
    expect(res.body.notes.map((n: any) => n.id)).toEqual([31]);
    expect(JSON.stringify(res.body)).not.toContain("Real Customer");
  });

  it("404s honestly when the demo becomes unprovisioned mid-session", async () => {
    delete process.env[DEMO_ORG_ENV];
    const res = await request(buildApp())
      .get("/api/demo/workspace")
      .set("Cookie", DEMO_COOKIE);
    expect(res.status).toBe(404);
  });
});

describe("composition with G1.1 + simulation (funnel clean, sends simulated)", () => {
  it("the markers demo rows carry are exactly what the activation recorder refuses", async () => {
    // A demo lead (seeded via sampleSeeder → source "sample_data"):
    await recordActivationEvent({
      orgId: DEMO_ORG_ID,
      eventName: "first_lead_added",
      entity: { source: SAMPLE_LEAD_SOURCE },
    });
    // A demo parcel (SAMPLE- apn):
    await recordActivationEvent({
      orgId: DEMO_ORG_ID,
      eventName: "first_mailer_sent",
      entity: { apn: `${SAMPLE_APN_PREFIX}TX-001` },
    });
    expect(activationMem.rows).toHaveLength(0);
  });

  it("a real entity still records — the demo guard doesn't dim the real funnel", async () => {
    await recordActivationEvent({
      orgId: 1,
      eventName: "first_lead_added",
      entity: { source: "direct_mail" },
    });
    expect(activationMem.rows).toHaveLength(1);
  });

  it("the demo org's settings satisfy shouldSimulate — sends land in simulated_actions, never a provider", () => {
    const org = demoOrg();
    for (const category of ["lob", "sms", "email", "stripe"] as const) {
      expect(shouldSimulate(category, org)).toBe(true);
    }
    // And a NON-simulated org is not affected by the demo machinery.
    expect(shouldSimulate("lob", { settings: {} })).toBe(false);
  });
});
