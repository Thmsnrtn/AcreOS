/**
 * Leads from AcreOS's own Meta lead ads land in the FOUNDER's organisation —
 * or nowhere. Never in a guessed one.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 * `POST /api/webhooks/meta-lead-ads` wrote every lead into
 * `parseInt(process.env.DEFAULT_ORG_ID || "1")` — a guessed tenant. Meta ads
 * are the founder-only ad rail (founder ruling 2026-08-13), so these are
 * AcreOS's OWN prospects; on a multi-tenant database "org 1" is whatever org
 * happened to be created first, and an unset env var routed AcreOS's sales
 * pipeline into it. The route sat behind the `/api` session catch-all, so it
 * never ran — which is the only reason it never did this in production.
 *
 * Owner decision 2026-10-08: the destination is the founder's own org, named
 * by the canonical `resolveFounderOrganization()`; when it cannot be named
 * unambiguously (none, or several) the write is REFUSED — logged, acked to
 * Meta with a 2xx so Meta does not retry forever, nothing written.
 *
 * ── HOW THIS FILE PROVES IT ─────────────────────────────────────────────────
 * The REAL route (`registerMetaLeadAdsWebhookRoutes`) behind the production
 * JSON parser (rawBody kept), the REAL signature middleware, the REAL resolver
 * and the REAL `processLeadAdSubmission`. Only the edges are faked: the Graph
 * API fetch, the lead-created emitter, and `db` — whose fake EVALUATES each
 * `inArray` predicate from the SQL drizzle actually renders, so a resolver that
 * stops filtering by owner reads customer orgs exactly as Postgres would.
 *
 * The tenant population always contains a CUSTOMER org with id 1 — the one the
 * old fallback guessed — so restoring that fallback writes into a customer
 * and turns this red, not merely "writes somewhere".
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import crypto from "node:crypto";

const env = vi.hoisted(() => {
  // services/founder.ts reads the founder identity env at module load.
  process.env.FOUNDER_EMAIL = "founder@acreos.test";
  process.env.FOUNDER_EMAILS = "";
  process.env.FOUNDER_USER_IDS = "";
  process.env.META_APP_SECRET = "meta-founder-org-test-secret";
  process.env.META_ACCESS_TOKEN = "meta-test-access-token";
  process.env.META_WEBHOOK_VERIFY_TOKEN = "meta-verify-token";
  return { secret: "meta-founder-org-test-secret", verifyToken: "meta-verify-token" };
});

type Row = Record<string, unknown>;
const store = vi.hoisted(() => ({
  users: [] as Row[],
  organizations: [] as Row[],
  inserted: [] as Row[],
}));

vi.mock("../../server/db", async (orig) => {
  const actual = await orig<typeof import("../../server/db")>();
  const { getTableName } = await import("drizzle-orm");
  const { PgDialect } = await import("drizzle-orm/pg-core");
  const dialect = new PgDialect();
  const COL: Record<string, string> = { email: "email", owner_id: "ownerId", id: "id" };

  /** Evaluate the `"table"."col" in ($1, …)` predicate drizzle rendered. */
  const matches = (where: any) => {
    const q = dialect.sqlToQuery(where);
    const m = /"(\w+)"\s+in\s*\(/i.exec(q.sql);
    if (!m || !COL[m[1]]) throw new Error(`fake db cannot evaluate predicate: ${q.sql}`);
    const field = COL[m[1]];
    const allowed = new Set(q.params.map(String));
    return (r: Row) => allowed.has(String(r[field]));
  };

  const fakeDb = {
    select: () => ({
      from: (table: any) => ({
        where: async (where: any) => {
          const name = getTableName(table);
          const rows = name === "users" ? store.users : name === "organizations" ? store.organizations : null;
          if (!rows) throw new Error(`fake db: unexpected select from ${name}`);
          return rows.filter(matches(where));
        },
      }),
    }),
    insert: (table: any) => ({
      values: (v: Row) => ({
        returning: async () => {
          if (getTableName(table) !== "leads") throw new Error(`fake db: unexpected insert into ${getTableName(table)}`);
          const row = { id: store.inserted.length + 100, ...v };
          store.inserted.push(row);
          return [row];
        },
      }),
    }),
  };
  return { ...actual, db: fakeDb };
});

vi.mock("../../server/services/leadEvents", () => ({ emitLeadCreated: vi.fn() }));

const logged: Array<{ message: string; meta: unknown }> = [];

let app: Express;

beforeAll(async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({
        field_data: [
          { name: "full_name", values: ["Pat Prospect"] },
          { name: "email", values: ["pat@example.com"] },
        ],
        campaign_name: "AcreOS founder campaign",
        ad_name: "ad",
      }),
    })),
  );
  const { logger } = await import("../../server/utils/logger");
  for (const level of ["warn", "error", "info"] as const) {
    vi.spyOn(logger, level).mockImplementation(((message: string, meta?: unknown) => {
      logged.push({ message: String(message), meta });
    }) as never);
  }
  const { registerMetaLeadAdsWebhookRoutes } = await import("../../server/routes-elite-features");
  app = express();
  app.use(
    express.json({
      verify: (req, _res, buf) => {
        (req as unknown as { rawBody: Buffer }).rawBody = buf;
      },
    }),
  );
  registerMetaLeadAdsWebhookRoutes(app);
}, 120_000);

const FOUNDER = { id: "user_founder", email: "founder@acreos.test" };
const CUSTOMER = { id: "user_customer", email: "customer@example.com" };
const OTHER_CUSTOMER = { id: "user_customer_2", email: "other@example.com" };
/** Org 1 is a CUSTOMER — the org the old fallback guessed. */
const CUSTOMER_ORG_1 = { id: 1, ownerId: CUSTOMER.id };
const CUSTOMER_ORG_9 = { id: 9, ownerId: OTHER_CUSTOMER.id };
const FOUNDER_ORG = { id: 7, ownerId: FOUNDER.id };
const CUSTOMER_ORG_IDS = [CUSTOMER_ORG_1.id, CUSTOMER_ORG_9.id];

beforeEach(() => {
  store.users = [FOUNDER, CUSTOMER, OTHER_CUSTOMER];
  store.organizations = [CUSTOMER_ORG_1, FOUNDER_ORG, CUSTOMER_ORG_9];
  store.inserted = [];
  logged.length = 0;
  delete process.env.FOUNDER_PRIMARY_ORG_ID;
  delete process.env.DEFAULT_ORG_ID;
});

const payload = JSON.stringify({
  object: "page",
  entry: [
    {
      id: "page-1",
      changes: [
        { field: "leadgen", value: { leadgen_id: "900000000000001", form_id: "form-1", ad_id: "ad-1", campaign_name: "c" } },
        { field: "leadgen", value: { leadgen_id: "900000000000002", form_id: "form-1", ad_id: "ad-1", campaign_name: "c" } },
      ],
    },
  ],
});
const sign = (body: string, secret = env.secret) =>
  "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");

const deliver = (signature: string | null = sign(payload)) => {
  const r = request(app).post("/api/webhooks/meta-lead-ads").set("Content-Type", "application/json");
  return (signature ? r.set("X-Hub-Signature-256", signature) : r).send(payload);
};

const refusalLogged = () => logged.some((l) => l.message.includes("founder organisation unresolved"));

describe("Meta lead-ads leads land in the founder's own organisation", () => {
  it("a signed delivery writes every lead into the founder org — and only there", async () => {
    const res = await deliver();
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, written: 2 });
    expect(store.inserted.map((r) => r.organizationId)).toEqual([FOUNDER_ORG.id, FOUNDER_ORG.id]);
    expect(store.inserted.every((r) => r.source === "facebook_lead_ad")).toBe(true);
  });

  it("DEFAULT_ORG_ID is not a destination, even when set", async () => {
    process.env.DEFAULT_ORG_ID = String(CUSTOMER_ORG_1.id);
    await deliver();
    expect(store.inserted.map((r) => r.organizationId)).toEqual([FOUNDER_ORG.id, FOUNDER_ORG.id]);
  });
});

describe("no unambiguous founder org → nothing written, Meta acked", () => {
  it("no founder org (the founder owns nothing) → refused", async () => {
    store.organizations = [CUSTOMER_ORG_1, CUSTOMER_ORG_9];
    const res = await deliver();
    expect(res.status, "a non-2xx makes Meta retry a delivery that will be refused identically").toBe(200);
    expect(res.body).toMatchObject({ written: 0, refused: "no-founder-org" });
    expect(store.inserted).toEqual([]);
    expect(refusalLogged()).toBe(true);
  });

  it("no founder identity on record → refused", async () => {
    store.users = [CUSTOMER, OTHER_CUSTOMER];
    const res = await deliver();
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ written: 0, refused: "no-founder-identity" });
    expect(store.inserted).toEqual([]);
  });

  it("two candidate founder orgs → refused, not 'the first one'", async () => {
    store.organizations = [CUSTOMER_ORG_1, FOUNDER_ORG, { id: 12, ownerId: FOUNDER.id }];
    const res = await deliver();
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ written: 0, refused: "ambiguous" });
    expect(store.inserted).toEqual([]);
    expect(refusalLogged()).toBe(true);
  });

  it("FOUNDER_PRIMARY_ORG_ID disambiguates — but only among orgs the founder owns", async () => {
    store.organizations = [CUSTOMER_ORG_1, FOUNDER_ORG, { id: 12, ownerId: FOUNDER.id }];
    process.env.FOUNDER_PRIMARY_ORG_ID = "12";
    await deliver();
    expect(store.inserted.map((r) => r.organizationId)).toEqual([12, 12]);
  });

  it("a pin naming a CUSTOMER org is refused, never followed", async () => {
    process.env.FOUNDER_PRIMARY_ORG_ID = String(CUSTOMER_ORG_1.id);
    const res = await deliver();
    expect(res.body).toMatchObject({ written: 0, refused: "pin-not-founder-owned" });
    expect(store.inserted).toEqual([]);
  });
});

describe("Meta's signature stays fail-closed", () => {
  it("a bad signature is refused before anything is resolved or written", async () => {
    const res = await deliver(sign(payload, "not-the-app-secret"));
    expect(res.status).toBe(401);
    expect(store.inserted).toEqual([]);
    expect(refusalLogged()).toBe(false);
  });

  it("a missing signature is refused", async () => {
    const res = await deliver(null);
    expect(res.status).toBe(401);
    expect(store.inserted).toEqual([]);
  });
});

describe("the GET challenge echo cannot reflect markup (anonymous since it left the catch-all)", () => {
  const challenge = (c: string | string[], token = env.verifyToken) =>
    request(app)
      .get("/api/webhooks/meta-lead-ads")
      .query({ "hub.mode": "subscribe", "hub.verify_token": token, "hub.challenge": c });

  it("the right token and a numeric challenge echo it, as text/plain", async () => {
    const res = await challenge("1158201444");
    expect(res.status).toBe(200);
    expect(res.text).toBe("1158201444");
    expect(res.headers["content-type"]).toMatch(/^text\/plain/);
  });

  it("a markup challenge is refused even WITH the right token, and never echoed", async () => {
    const res = await challenge("<script>alert(document.domain)</script>");
    expect(res.status).toBe(403);
    expect(res.text).not.toContain("<script");
    expect(res.headers["content-type"]).not.toMatch(/html/);
  });

  it("an array challenge (?hub.challenge=a&hub.challenge=b) is refused", async () => {
    const res = await challenge(["123", "<b>x</b>"]);
    expect(res.status).toBe(403);
    expect(res.text).not.toContain("<b>");
  });

  it("the wrong token is refused even with a numeric challenge", async () => {
    const res = await challenge("1158201444", "not-the-token");
    expect(res.status).toBe(403);
    expect(res.text).not.toContain("1158201444");
  });
});

describe("caller-supplied Graph ids cannot steer the platform-token request (SSRF)", () => {
  const STEERING = ["me/accounts", "../../v1/act_1/campaigns", "1?access_token=x", "1#frag", "", "12/insights"];

  it("a signed delivery whose leadgen_id is not a Graph id fetches nothing and writes nothing", async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    for (const bad of STEERING) {
      fetchMock.mockClear();
      store.inserted = [];
      const body = JSON.stringify({ entry: [{ changes: [{ field: "leadgen", value: { leadgen_id: bad } }] }] });
      const res = await request(app)
        .post("/api/webhooks/meta-lead-ads")
        .set("Content-Type", "application/json")
        .set("X-Hub-Signature-256", sign(body))
        .send(body);
      expect(res.status).toBe(200);
      expect(fetchMock, `leadgen_id ${JSON.stringify(bad)} reached graph.facebook.com`).not.toHaveBeenCalled();
      expect(store.inserted).toEqual([]);
    }
  });

  it("a numeric leadgen_id is fetched at exactly that Graph path", async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockClear();
    await deliver();
    const urls = fetchMock.mock.calls.map((c) => new URL(String(c[0])).pathname);
    expect(urls).toEqual(["/v21.0/900000000000001", "/v21.0/900000000000002"]);
  });

  it("getAdPerformance and syncPropertyCatalog refuse a non-numeric id before any request", async () => {
    const svc = await import("../../server/services/metaAdsService");
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockClear();
    for (const bad of STEERING) {
      await expect(svc.getAdPerformance(bad)).rejects.toThrow(/Graph object id/);
      await expect(svc.syncPropertyCatalog(7, bad, "https://app.example")).rejects.toThrow(/Graph object id/);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("customer orgs never receive these leads", () => {
  // Every shape of tenant population this file can build; across all of them
  // the only org ever written is one the founder owns.
  const SCENARIOS: Array<{ name: string; orgs: Row[]; pin?: string }> = [
    { name: "founder org present", orgs: [CUSTOMER_ORG_1, FOUNDER_ORG, CUSTOMER_ORG_9] },
    { name: "founder org absent", orgs: [CUSTOMER_ORG_1, CUSTOMER_ORG_9] },
    { name: "only customer orgs, pinned to one", orgs: [CUSTOMER_ORG_1, CUSTOMER_ORG_9], pin: "9" },
    { name: "two founder orgs", orgs: [CUSTOMER_ORG_1, FOUNDER_ORG, { id: 12, ownerId: FOUNDER.id }] },
  ];
  for (const s of SCENARIOS) {
    it(`${s.name}: no customer org id is ever written`, async () => {
      store.organizations = s.orgs;
      if (s.pin) process.env.FOUNDER_PRIMARY_ORG_ID = s.pin;
      await deliver();
      const written = store.inserted.map((r) => r.organizationId as number);
      expect(written.filter((id) => CUSTOMER_ORG_IDS.includes(id))).toEqual([]);
    });
  }

  it("vacuity: the founder-org scenario really writes (so the empties above mean something)", async () => {
    await deliver();
    expect(store.inserted.length).toBe(2);
  });
});

describe("the resolver is the canonical one, adopted by the lenient accessor", () => {
  it("getFounderPrimaryOrgId agrees with resolveFounderOrganization when it names an org", async () => {
    const founder = await import("../../server/services/founder");
    const r = await founder.resolveFounderOrganization();
    expect(r).toEqual({ ok: true, organizationId: FOUNDER_ORG.id, via: "sole-owned" });
    expect(await founder.getFounderPrimaryOrgId()).toBe(FOUNDER_ORG.id);
  });
});
