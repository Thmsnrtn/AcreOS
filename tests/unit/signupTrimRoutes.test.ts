/**
 * Signup trim (W1.4) — the server agrees with the picker.
 *
 * Flag ON (the default): a NEW signup (org not yet onboarded) is refused (422)
 * a business type that is not land_flipper / note_investor / hybrid, on every
 * route that writes one. Flag OFF: all fifteen are accepted again. An org that
 * already has a type keeps it, an onboarded org is never touched, and a
 * founder is never refused. The waitlist capture persists to the existing
 * feedback inbox, validated, idempotent and rate limited.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { feedbackSubmissions } from "@shared/schema";

const h = vi.hoisted(() => ({
  org: null as any,
  isFounder: false,
  userId: "user-1",
  flag: null as null | { state: string },
  feedbackRows: [] as any[],
  failInsert: false,
  completed: 0,
}));

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../server/storage", () => ({
  storage: { updateOrganization: vi.fn(async (_id: number, u: any) => ({ ...h.org, ...u })) },
  db: {},
}));
vi.mock("../../server/services/onboarding/sampleSeeder", () => ({
  seedSampleDataForOrg: vi.fn(async () => ({ seeded: true, counts: {} })),
  clearSampleDataForOrg: vi.fn(),
}));
vi.mock("../../server/utils/openaiClient", () => ({ getOpenAIClient: () => null }));
vi.mock("../../server/services/onboarding", () => ({
  onboardingService: { completeOnboarding: vi.fn(async () => { h.completed += 1; }) },
}));
vi.mock("../../server/services/featureFlags", () => ({
  featureFlagService: { getByKey: async () => (h.flag ? { key: "onboarding.signup_trim", ...h.flag } : null) },
}));
vi.mock("../../server/db", () => ({
  db: {
    select: () => ({
      from: (t: unknown) => ({
        where: () => ({
          limit: async () =>
            t === feedbackSubmissions ? h.feedbackRows.slice(0, 1).map((r) => ({ id: r.id })) : [{ role: "owner" }],
        }),
      }),
    }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
    insert: () => ({
      values: (v: any) => ({
        returning: async () => {
          if (h.failInsert) throw new Error("db down");
          const row = { id: h.feedbackRows.length + 1, ...v };
          h.feedbackRows.push(row);
          return [{ id: row.id }];
        },
      }),
    }),
  },
}));

import { BUSINESS_TYPES } from "@shared/models/persona-mapping";
import onboardingRouter from "../../server/routes-onboarding";
import { SIGNUP_OPEN_BUSINESS_TYPES } from "@shared/business-types/signupTrim";

const SIGNUP_WAITLIST_BUSINESS_TYPES = BUSINESS_TYPES.filter((t) => !SIGNUP_OPEN_BUSINESS_TYPES.includes(t));
const fresh = (o: Record<string, unknown> = {}) => ({
  id: 42, onboardingCompleted: false, onboardingData: null, ownerId: "user-1", ...o,
});

describe("signup trim on the server", () => {
  let app: express.Application;
  beforeAll(() => {
    app = express();
    app.use(express.json());
    // Deliberately NO global csrfProtection here: the waitlist route must
    // refuse a tokenless post on its own (see "CSRF" below).
    app.use(cookieParser());
    app.use(
      "/api/onboarding",
      (req, _res, next) => {
        (req as any).user = { id: h.userId, email: "u@example.com", firstName: "Una", lastName: "Test" };
        (req as any).organization = h.org;
        if (h.isFounder) (req as any).isFounder = true;
        next();
      },
      onboardingRouter,
    );
  });
  beforeEach(() => {
    h.org = fresh();
    h.isFounder = false;
    h.userId = "user-1";
    h.flag = null; // no row: the default, ON
    h.feedbackRows.length = 0;
    h.failInsert = false;
    h.completed = 0;
  });

  const complete = (businessType: string) => request(app).post("/api/onboarding/complete").send({ businessType });

  it("ON (no flag row): a new signup is refused every one of the twelve closed types, and nothing completes", async () => {
    expect(SIGNUP_WAITLIST_BUSINESS_TYPES).toHaveLength(12);
    for (const t of SIGNUP_WAITLIST_BUSINESS_TYPES) {
      const res = await complete(t);
      expect(res.status, t).toBe(422);
      expect(res.body.details).toMatchObject({ reason: "business_type_not_open", requested: t });
    }
    expect(h.completed).toBe(0);
  });

  it("ON: the three open types complete", async () => {
    for (const t of SIGNUP_OPEN_BUSINESS_TYPES) {
      h.org = fresh();
      expect((await complete(t)).status, t).toBe(200);
    }
  });

  it("OFF (state off): all twelve closed types are accepted again", async () => {
    h.flag = { state: "off" };
    for (const t of SIGNUP_WAITLIST_BUSINESS_TYPES) {
      expect((await complete(t)).status, t).toBe(200);
    }
  });

  it("an explicit 'on' row behaves like no row", async () => {
    h.flag = { state: "on" };
    expect((await complete("fix_and_flip")).status).toBe(422);
  });

  it("existing orgs are untouched: an onboarded org, and an org keeping the type it has", async () => {
    h.org = fresh({ onboardingCompleted: true });
    expect((await complete("tax_lien_deed")).status).toBe(200);
    h.org = fresh({ onboardingData: { businessType: "residential_wholesaler" } });
    expect((await complete("residential_wholesaler")).status).toBe(200);
    // ...but a re-run may not hop to a DIFFERENT closed type.
    h.org = fresh({ onboardingData: { businessType: "residential_wholesaler" } });
    expect((await complete("multifamily")).status).toBe(422);
  });

  it("a founder is never refused", async () => {
    h.isFounder = true;
    expect((await complete("mobile_home")).status).toBe(200);
  });

  it("the other writers refuse too (progress)", async () => {
    const res = await request(app).patch("/api/onboarding/progress").send({ step: 1, businessType: "commercial" });
    expect(res.status).toBe(422);
    const ok = await request(app).patch("/api/onboarding/progress").send({ step: 1, businessType: "hybrid" });
    expect(ok.status).toBe(200);
  });

  describe("waitlist capture", () => {
    const CSRF = "test-csrf-token";
    const join = (type: unknown) =>
      request(app)
        .post("/api/onboarding/waitlist")
        .set("Cookie", `csrf_token=${CSRF}`)
        .set("x-csrf-token", CSRF)
        .send({ type });

    it("CSRF: a post without the double-submit token is refused and writes nothing", async () => {
      h.userId = "wl-user-csrf";
      const none = await request(app).post("/api/onboarding/waitlist").send({ type: "developer" });
      expect(none.status).toBe(403);
      const cookieOnly = await request(app)
        .post("/api/onboarding/waitlist")
        .set("Cookie", `csrf_token=${CSRF}`)
        .send({ type: "developer" });
      expect(cookieOnly.status).toBe(403);
      const mismatched = await request(app)
        .post("/api/onboarding/waitlist")
        .set("Cookie", `csrf_token=${CSRF}`)
        .set("x-csrf-token", "something-else")
        .send({ type: "developer" });
      expect(mismatched.status).toBe(403);
      expect(h.feedbackRows).toHaveLength(0);
      // ...and the same request WITH a matching token goes through.
      expect((await join("developer")).status).toBe(200);
      expect(h.feedbackRows).toHaveLength(1);
    });

    it("persists a feature_request in the feedback inbox with the caller's identity", async () => {
      h.userId = "wl-user-a";
      const res = await join("fix_and_flip");
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ ok: true, status: "recorded", type: "fix_and_flip" });
      expect(h.feedbackRows).toHaveLength(1);
      expect(h.feedbackRows[0]).toMatchObject({
        category: "feature_request",
        source: "signup_waitlist:fix_and_flip",
        userId: "wl-user-a",
        email: "u@example.com",
        allowFollowUp: true,
      });
    });

    it("is idempotent per user and type", async () => {
      h.userId = "wl-user-b";
      await join("developer");
      const again = await join("developer");
      expect(again.body.status).toBe("already_recorded");
      expect(h.feedbackRows).toHaveLength(1);
    });

    it("validates: an open type, an unknown type and a missing type are refused and write nothing", async () => {
      h.userId = "wl-user-c";
      expect((await join("land_flipper")).status).toBe(422);
      expect((await join("vacation_rental")).status).toBe(422);
      expect((await join(undefined)).status).toBe(422);
      expect(h.feedbackRows).toHaveLength(0);
    });

    it("with the trim OFF there is no waitlist to join", async () => {
      h.userId = "wl-user-d";
      h.flag = { state: "off" };
      expect((await join("developer")).status).toBe(422);
      expect(h.feedbackRows).toHaveLength(0);
    });

    it("never claims a capture that failed", async () => {
      h.userId = "wl-user-e";
      h.failInsert = true;
      const res = await join("developer");
      expect(res.status).toBe(500);
      expect(res.body.ok).toBeUndefined();
    });

    it("is rate limited per user", async () => {
      h.userId = "wl-user-rate";
      let last = 0;
      for (let i = 0; i < 21; i++) last = (await join("developer")).status;
      expect(last).toBe(429);
    });
  });
});
