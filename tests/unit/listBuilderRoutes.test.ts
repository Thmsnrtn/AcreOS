/**
 * W10.3 — /api/list-builder preview + commit, end to end over HTTP.
 *
 * The county is a fake ArcGIS server (fetchGeo stubbed — no network) that
 * evaluates the where clause it is sent; the database is a recording fake
 * that answers reads by table and records every statement, so the tenancy
 * check renders each one with the real Postgres dialect.
 *
 * The parcels and leads are arranged so every dedupe branch is exercised:
 *   parcel 01 — an existing LIVE lead       → linked, not created
 *   parcel 02 — only a DELETED lead         → suppressed: not linked, never re-created
 *   parcel 03 — a lead with the same APN in ANOTHER county → a different parcel → created
 *   parcel 04 — no APN                      → skippedNoApn (cannot be matched)
 *   parcel 05 — no lead                     → created
 *   parcel 07 — repeats parcel 05's APN     → skippedDuplicateApn
 * so the preview's IDENTITY — count = alreadyLeads + newLeads +
 * suppressedDeleted + skippedNoApn + skippedDuplicateApn — is pinned over all
 * five kinds at once.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

const ORG = 7;

const H = vi.hoisted(() => ({
  // county source
  urls: [] as string[],
  fail: false as boolean | "error400" | "error500",
  noPaging: false,
  parcels: [] as Array<Record<string, unknown>>,
  // database
  endpoints: [] as Array<Record<string, unknown>>,
  queue: [] as Array<Record<string, unknown>>,
  leads: [] as Array<Record<string, unknown>>,
  /** Per-read answers for `leads`, consumed in order before falling back to `leads`. */
  leadAnswers: [] as Array<Array<Record<string, unknown>>>,
  selects: [] as Array<{ table: string; where: unknown }>,
  inserts: [] as Array<{ table: string; values: Array<Record<string, unknown>> }>,
  transactions: 0,
  /** Holds every transaction open this long — lets two requests overlap. */
  txDelayMs: 0,
  nextId: 1000,
  usage: { limit: null as number | null, current: 0 },
  /** Per-call answers for checkUsageLimit, consumed in order before falling back to `usage`. */
  usageAnswers: [] as Array<{ limit: number | null; current: number }>,
  usageCalls: 0,
  /** The org's plan-counted leads as read INSIDE the save's transaction (null = `usage.current`). */
  inTxCount: null as number | null,
  /** Every executor countPlanLeads was handed, and every transaction executor opened. */
  countExecs: [] as unknown[],
  txExecs: [] as unknown[],
  /** team_members rows by user id (requirePermission reads them through storage). */
  members: {} as Record<string, { role: string }>,
  /** What the team_members read answers (requireScope, for a non-owner). */
  scopeRows: [] as Array<Record<string, unknown>>,
  lists: [] as Array<Record<string, unknown>>,
  listSizes: [] as Array<{ listId: number; n: number }>,
  emitted: [] as number[],
}));

vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/auth", () => ({ isAuthenticated: (_q: unknown, _s: unknown, n: () => void) => n() }));
vi.mock("../../server/middleware/getOrCreateOrg", () => ({
  getOrCreateOrg: (req: { organization?: unknown; user?: unknown; headers: Record<string, string | undefined> }, _s: unknown, n: () => void) => {
    req.organization = { id: 7, ownerId: "u-owner" };
    req.user = { id: req.headers["x-user"] ?? "u-owner" };
    n();
  },
}));
// requirePermission's only storage read: the caller's team_members row.
vi.mock("../../server/storage", () => ({
  storage: {
    getTeamMember: async (_org: number, userId: string) =>
      H.members[userId] ? { id: 1, organizationId: 7, userId, isActive: true, ...H.members[userId] } : undefined,
  },
}));
vi.mock("../../server/services/providers/circuit-breaker-store", () => ({
  dbBreakerStore: { load: async () => null, save: async () => undefined },
}));
vi.mock("../../server/services/usageLimits", () => ({
  checkUsageLimit: vi.fn(async () => {
    H.usageCalls++;
    return { allowed: true, ...(H.usageAnswers.shift() ?? H.usage), tier: "pro" };
  }),
  // The plan's limit alone (a tier read) — what the save reads BEFORE its transaction.
  usageLimitFor: vi.fn(async () => H.usage.limit),
  // The plan's lead counter, run through whichever executor it is handed.
  countPlanLeads: vi.fn(async (exec: unknown) => {
    H.countExecs.push(exec);
    return H.inTxCount ?? H.usage.current;
  }),
}));
vi.mock("../../server/services/leadEvents", () => ({
  emitLeadCreated: vi.fn((_org: number, lead: { id: number }) => H.emitted.push(lead.id)),
}));

vi.mock("../../server/db", async () => {
  const { getTableName } = await import("drizzle-orm");
  const answer = (table: string, fields?: Record<string, unknown>) =>
    table === "marketing_lists" && fields && "n" in fields ? [{ n: H.lists.length }]
    : table === "marketing_lists" ? H.lists
    : table === "marketing_list_members" && fields && "n" in fields ? H.listSizes
    : table === "county_gis_endpoints" ? H.endpoints
    : table === "county_discovery_queue" ? H.queue
    : table === "leads" ? (H.leadAnswers.shift() ?? H.leads)
    : table === "team_members" ? H.scopeRows
    : [];
  const exec = () => ({
    select: (fields?: Record<string, unknown>) => {
      const q = { table: "", where: undefined as unknown };
      H.selects.push(q);
      const chain: Record<string, unknown> = {
        from: (t: Parameters<typeof getTableName>[0]) => ((q.table = getTableName(t)), chain),
        where: (w: unknown) => ((q.where = w), chain),
        limit: () => chain,
        orderBy: () => chain,
        groupBy: () => chain,
        then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(answer(q.table, fields)).then(res, rej),
      };
      return chain;
    },
    insert: (t: Parameters<typeof getTableName>[0]) => ({
      values: (v: Record<string, unknown> | Array<Record<string, unknown>>) => {
        const rows = (Array.isArray(v) ? v : [v]).map((r) => ({ id: H.nextId++, ...r }));
        H.inserts.push({ table: getTableName(t), values: rows });
        return { returning: async () => rows, onConflictDoNothing: async () => rows };
      },
    }),
    execute: async () => ({ rows: [] }),
  });
  return { db: { ...exec(), transaction: async (cb: (tx: unknown) => unknown) => {
    H.transactions++;
    if (H.txDelayMs) await new Promise((r) => setTimeout(r, H.txDelayMs));
    const tx = exec();
    H.txExecs.push(tx);
    return cb(tx);
  } } };
});

const CLAUSE = /^([A-Za-z_][A-Za-z0-9_.]*) (>=|<=) (-?\d+(?:\.\d+)?)$/;
vi.mock("../../server/services/providers/fetchGeo", () => ({
  fetchGeo: vi.fn(async (url: string) => {
    H.urls.push(url);
    if (H.fail === true) return { ok: false, status: 503, json: async () => ({}) };
    if (H.fail === "error400") return { ok: true, status: 200, json: async () => ({ error: { code: 400, message: "Invalid field" } }) };
    if (H.fail === "error500") return { ok: true, status: 200, json: async () => ({ error: { code: 500, message: "Error performing query" } }) };
    const u = new URL(url);
    if (!u.pathname.endsWith("/query")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          fields: ["OBJECTID:esriFieldTypeOID", "PID:esriFieldTypeString", "OWNER:esriFieldTypeString", "ACRES:esriFieldTypeDouble", "SITUS:esriFieldTypeString"]
            .map((s) => ({ name: s.split(":")[0], type: s.split(":")[1] })),
          maxRecordCount: 1000,
          objectIdField: "OBJECTID",
          advancedQueryCapabilities: { supportsPagination: !H.noPaging },
        }),
      };
    }
    const where = u.searchParams.get("where") ?? "";
    const hit = H.parcels.filter((a) =>
      where === "1=1" ||
      where.split(" AND ").every((c) => {
        const m = CLAUSE.exec(c);
        if (!m) throw new Error(`fake county: unrecognised clause ${c}`);
        return m[2] === ">=" ? Number(a[m[1]]) >= Number(m[3]) : Number(a[m[1]]) <= Number(m[3]);
      }),
    );
    if (u.searchParams.get("returnCountOnly") === "true") return { ok: true, status: 200, json: async () => ({ count: hit.length }) };
    const n = Number(u.searchParams.get("resultRecordCount") ?? 1000);
    return { ok: true, status: 200, json: async () => ({ features: hit.slice(0, n).map((attributes) => ({ attributes })) }) };
  }),
}));

const { registerListBuilderRoutes, sharedSave, SAVE_SHARE_GRACE_MS } = await import("../../server/routes-list-builder");
const { commitCountyList } = await import("../../server/services/listBuilder/countyListBuilder");
const { AreaQueryAborted } = await import("../../server/services/providers/countyAreaQuery");
const { COUNTY_SOURCE_WENT_DARK_MESSAGE, countyLiveSourceCopy } = await import("@shared/geo/countyStatus");
const app = express();
app.use(express.json());
registerListBuilderRoutes(app);

function endpointRow(redistributable: string) {
  return {
    id: 55,
    state: "TX",
    county: "Harris",
    endpointType: "arcgis_rest",
    baseUrl: "https://gis.example.gov/arcgis/rest/services/Parcels/MapServer",
    layerId: "0",
    apnField: "PID",
    ownerField: "OWNER",
    fieldMappings: { apn: "PID", owner: "OWNER", acres: "ACRES", address: "SITUS" },
    additionalParams: null,
    isActive: true,
    redistributable,
    attribution: null as string | null,
  };
}

const parcelRow = (i: number, pid: string | null, owner: string, acres: number) => ({
  OBJECTID: i,
  PID: pid,
  OWNER: owner,
  ACRES: acres,
  SITUS: `${i} Ranch Rd`,
});

const LIVE_LEAD = 501;
const DELETED_LEAD = 502;
const OTHER_COUNTY_LEAD = 503;

// Every test runs two minutes after the last, so the per-org rate limiters
// (in-memory here: no REDIS_URL) start each test with an empty window.
let clock = Date.UTC(2026, 9, 5, 12);
beforeEach(() => {
  clock += 120_000;
  vi.spyOn(Date, "now").mockImplementation(() => clock);
  H.urls = [];
  H.fail = false;
  H.noPaging = false;
  H.parcels = [
    parcelRow(1, "R-001", "JOHN SMITH", 10),
    parcelRow(2, "R-002", "MARY JONES", 12),
    parcelRow(3, "R-003", "ACME LAND LLC", 14),
    parcelRow(4, null, "NO APN OWNER", 16),
    parcelRow(5, "R-005", "SMITH FAMILY TRUST", 18),
    parcelRow(6, "R-006", "TOO SMALL", 1),
    parcelRow(7, "r-005", "SMITH FAMILY TRUST", 20),
  ];
  H.endpoints = [endpointRow("yes")];
  H.queue = [];
  H.leads = [
    { id: LIVE_LEAD, apn: "R-001", state: "TX", county: "Harris", deletedAt: null },
    { id: DELETED_LEAD, apn: "r-002", state: "TX", county: "Harris County", deletedAt: new Date("2026-01-01") },
    { id: OTHER_COUNTY_LEAD, apn: "R-003", state: "TX", county: "Travis", deletedAt: null },
  ];
  H.selects = [];
  H.inserts = [];
  H.transactions = 0;
  H.txDelayMs = 0;
  H.usage = { limit: null, current: 0 };
  H.usageAnswers = [];
  H.usageCalls = 0;
  H.inTxCount = null;
  H.countExecs = [];
  H.txExecs = [];
  H.members = {
    "u-owner": { role: "owner" },
    "u-admin": { role: "admin" },
    "u-member": { role: "member" },
    "u-viewer": { role: "viewer" },
    "u-va": { role: "va" },
  };
  H.scopeRows = [];
  H.emitted = [];
  H.lists = [];
  H.listSizes = [];
  H.leadAnswers = [];
});

const BODY = { state: "TX", county: "harris county", acreageMin: 5 };

describe("POST /api/list-builder/preview", () => {
  it("returns the exact count, a sample, the dedupe split and a free pull — and writes nothing", async () => {
    const r = await request(app).post("/api/list-builder/preview").send(BODY);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      count: 6,
      alreadyLeads: 1,
      newLeads: 2,
      suppressedDeleted: 1,
      skippedNoApn: 1,
      skippedDuplicateApn: 1,
      saveable: true,
      saveRefusal: null,
      tooLarge: false,
      maxPerList: 2500,
      status: "covered",
      cost: { pullCredits: 0, mailEstimate: null },
    });
    expect(r.body.sample).toHaveLength(5);
    expect(r.body.sample[0]).toEqual({ apn: "R-001", owner: "JOHN SMITH", acres: 10, address: "1 Ranch Rd" });
    expect(r.body).not.toHaveProperty("skippedRecords");
    expect(H.inserts).toEqual([]);
    expect(H.transactions).toBe(0);
  });

  it("IDENTITY: count = alreadyLeads + newLeads + suppressedDeleted + skippedNoApn + skippedDuplicateApn, over all five kinds", async () => {
    const b = (await request(app).post("/api/list-builder/preview").send(BODY)).body;
    const kinds = [b.alreadyLeads, b.newLeads, b.suppressedDeleted, b.skippedNoApn, b.skippedDuplicateApn];
    // Vacuity: every kind is present in the fixture, so a mislabel between two cannot balance.
    expect(kinds.every((k: number) => k >= 1), JSON.stringify(b)).toBe(true);
    expect(kinds.reduce((a: number, k: number) => a + k, 0)).toBe(b.count);
  });

  it("the source's attribution line is returned when it has one", async () => {
    H.endpoints = [{ ...endpointRow("attribution"), attribution: "Parcel data: Harris County Appraisal District" }];
    const r = await request(app).post("/api/list-builder/preview").send(BODY);
    expect(r.body).toMatchObject({ status: "covered", attribution: "Parcel data: Harris County Appraisal District" });
  });

  it("an org already over its plan can still preview a list that creates no new leads as saveable", async () => {
    H.leads = [
      ...H.leads,
      { id: 504, apn: "R-003", state: "TX", county: "Harris", deletedAt: null },
      { id: 505, apn: "R-005", state: "TX", county: "Harris", deletedAt: null },
    ];
    H.usage = { limit: 10, current: 12 };
    const r = await request(app).post("/api/list-builder/preview").send(BODY);
    expect(r.body).toMatchObject({ newLeads: 0, saveable: true, saveRefusal: null });
  });

  it("an unreviewed county previews but says plainly it cannot be saved", async () => {
    H.endpoints = [endpointRow("review-required")];
    const r = await request(app).post("/api/list-builder/preview").send(BODY);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ count: 6, status: "view_only", saveable: false });
    expect(r.body.saveRefusal).toMatch(/terms of use haven't been reviewed/);
  });

  it("a county the founder marked 'no' previews but says its terms were REVIEWED and don't permit saving — never 'not reviewed yet'", async () => {
    H.endpoints = [endpointRow("no")];
    const r = await request(app).post("/api/list-builder/preview").send(BODY);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: "view_only", saveable: false });
    expect(r.body.saveRefusal).toMatch(/were reviewed/);
    expect(r.body.saveRefusal).not.toMatch(/haven't been reviewed/);
    const c = await request(app).post("/api/list-builder/commit").send({ ...BODY, name: "L", expectedCount: 6 });
    expect(c.status).toBe(422);
    expect(c.body.message).toBe(r.body.saveRefusal);
    expect(H.inserts).toEqual([]);
    const counties = await request(app).get("/api/list-builder/counties?state=TX");
    expect(counties.body.counties).toEqual([expect.objectContaining({ county: "Harris", status: "view_only", message: countyLiveSourceCopy(["no"]).message })]);
    expect(counties.body.counties[0].message).toMatch(/were reviewed and don't permit saving/);
  });

  it("a filter the county cannot answer is a 400 naming it — never silently dropped", async () => {
    H.endpoints = [{ ...endpointRow("yes"), fieldMappings: { apn: "PID", owner: "OWNER", acres: "ACRES" } }];
    const r = await request(app).post("/api/list-builder/preview").send({ ...BODY, yearsOwnedMin: 10 });
    expect(r.status).toBe(400);
    expect(r.body.details.filter).toBe("yearsOwned");
    expect(r.body.message).toMatch(/years owned/);
  });

  it("a misspelled filter is refused, not ignored", async () => {
    const r = await request(app).post("/api/list-builder/preview").send({ ...BODY, ownerType: ["trust"] });
    expect(r.status).toBe(400);
    expect(H.urls).toEqual([]);
  });

  it("a county with no live source is a 400 carrying its status", async () => {
    H.endpoints = [];
    H.queue = [{ status: "exhausted", attempts: 5 }];
    const r = await request(app).post("/api/list-builder/preview").send(BODY);
    expect(r.status).toBe(400);
    expect(r.body.details.status).toBe("unavailable");
  });

  it("a county whose source went dark says so in the coverage route's own words", async () => {
    H.endpoints = [];
    H.queue = [{ county: "harris", status: "resolved", attempts: 1 }];
    const r = await request(app).post("/api/list-builder/preview").send(BODY);
    expect(r.status).toBe(400);
    expect(r.body.message).toContain(COUNTY_SOURCE_WENT_DARK_MESSAGE);
    const c = await request(app).get("/api/list-builder/counties?state=TX");
    expect(c.body.counties).toEqual([expect.objectContaining({ county: "Harris", status: "unavailable", message: COUNTY_SOURCE_WENT_DARK_MESSAGE })]);
  });

  it("a county source failure is an honest error with NO number in it", async () => {
    H.fail = true;
    const r = await request(app).post("/api/list-builder/preview").send(BODY);
    expect(r.status).toBe(502);
    expect(r.body.error).toBe("COUNTY_SOURCE_FAILED");
    expect(JSON.stringify(r.body)).not.toMatch(/"count"/);
  });

  it("a structural refusal is a 422 with the reason, not a 502: a layer that cannot page", async () => {
    H.noPaging = true;
    H.parcels = Array.from({ length: 1001 }, (_, i) => parcelRow(i + 1, `P-${i}`, "X", 9));
    const r = await request(app).post("/api/list-builder/preview").send(BODY);
    expect(r.status).toBe(422);
    expect(r.body.details.reason).toBe("cannot_page");
    expect(r.body.message).toMatch(/cannot page/);
  });

  it("a structural refusal is a 422: a misconfigured layer", async () => {
    H.endpoints = [{ ...endpointRow("yes"), layerId: "parcels" }];
    const r = await request(app).post("/api/list-builder/preview").send(BODY);
    expect(r.status).toBe(422);
    expect(r.body.details.reason).toBe("misconfigured");
    expect(H.urls).toEqual([]);
  });

  it("an ArcGIS error body: a 4xx-class refusal is structural (422), a 5xx-class one transient (502)", async () => {
    H.fail = "error400";
    const a = await request(app).post("/api/list-builder/preview").send(BODY);
    expect(a.status).toBe(422);
    expect(a.body.details.reason).toBe("query_refused");
    H.fail = "error500";
    const b = await request(app).post("/api/list-builder/preview").send(BODY);
    expect(b.status).toBe(502);
    expect(b.body.details.reason).toBe("query_refused");
  });

  it("is readable by any member of the org — a viewer can preview", async () => {
    const r = await request(app).post("/api/list-builder/preview").set("x-user", "u-viewer").send(BODY);
    expect(r.status).toBe(200);
  });

  it("is rate limited per org: the 11th preview in a minute is a 429 and reaches no county server", async () => {
    for (let i = 0; i < 10; i++) expect((await request(app).post("/api/list-builder/preview").send(BODY)).status).toBe(200);
    const before = H.urls.length;
    const r = await request(app).post("/api/list-builder/preview").send(BODY);
    expect(r.status).toBe(429);
    expect(r.body.error).toBe("rate_limit_exceeded");
    expect(r.body.message).toMatch(/10 requests per 60 seconds/);
    expect(H.urls.length).toBe(before);
    clock += 61_000;
    expect((await request(app).post("/api/list-builder/preview").send(BODY)).status).toBe(200);
  });

  it("too many parcels: the true count, tooLarge, and no invented dedupe figures", async () => {
    H.parcels = Array.from({ length: 2501 }, (_, i) => parcelRow(i + 1, `P-${i}`, "X", 9));
    const r = await request(app).post("/api/list-builder/preview").send(BODY);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ count: 2501, tooLarge: true, saveable: false, alreadyLeads: null, newLeads: null });
    expect(H.selects.filter((s) => s.table === "leads")).toEqual([]);
  });
});

describe("POST /api/list-builder/commit", () => {
  const COMMIT = { ...BODY, name: "Harris 5+ acres", expectedCount: 6 };

  it("creates the list, the new leads and the memberships — linking the live lead and suppressing the deleted one", async () => {
    const r = await request(app).post("/api/list-builder/commit").send(COMMIT);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      created: 2,
      linkedExisting: 1,
      total: 3,
      suppressedDeleted: 1,
      skippedNoApn: 1,
      skippedDuplicateApn: 1,
      attribution: null,
    });
    expect(r.body).not.toHaveProperty("skippedRecords");
    expect(H.transactions).toBe(1);

    const list = H.inserts.find((i) => i.table === "marketing_lists")!.values[0];
    expect(list).toMatchObject({ organizationId: ORG, name: "Harris 5+ acres", source: "county_records", totalRecords: 6, validRecords: 3 });
    // duplicates_removed holds DUPLICATES only — a parcel with no APN is not a duplicate.
    expect(list.duplicatesRemoved).toBe(1);
    expect(list).not.toHaveProperty("invalidAddresses");
    expect(list.filters).toEqual({ states: ["TX"], counties: ["Harris"], acreageMin: 5 });
    expect(r.body.listId).toBe(list.id);

    const created = H.inserts.filter((i) => i.table === "leads").flatMap((i) => i.values);
    expect(created.map((l) => l.apn).sort()).toEqual(["R-003", "R-005"]);
    for (const l of created) {
      expect(l).toMatchObject({ organizationId: ORG, type: "seller", status: "new", source: "county_records", tcpaConsent: false, consentSource: null, state: "TX", county: "Harris" });
      // The parcel's situs is the PROPERTY address; no mailing address is invented.
      expect(l.propertyAddress).toMatch(/Ranch Rd$/);
      expect(l).not.toHaveProperty("address");
    }
    // first_name/last_name are NOT NULL columns: an entity owner has no first name, so it is "".
    expect(created.find((l) => l.apn === "R-005")).toMatchObject({ firstName: "", lastName: "SMITH FAMILY TRUST" });
    expect(created.find((l) => l.apn === "R-003")).toMatchObject({ acreage: "14" });

    const members = H.inserts.filter((i) => i.table === "marketing_list_members").flatMap((i) => i.values);
    expect(members.map((m) => m.leadId).sort()).toEqual([LIVE_LEAD, ...created.map((l) => l.id as number)].sort());
    expect(members.map((m) => m.leadId)).not.toContain(DELETED_LEAD);
    expect(members.every((m) => m.organizationId === ORG && m.listId === list.id)).toBe(true);
    expect(H.emitted.sort()).toEqual(created.map((l) => l.id as number).sort());
  });

  it("a view-only county is refused before the county is even queried — nothing written", async () => {
    H.endpoints = [endpointRow("review-required")];
    const r = await request(app).post("/api/list-builder/commit").send(COMMIT);
    expect(r.status).toBe(422);
    expect(r.body.message).toMatch(/terms of use haven't been reviewed/);
    expect(H.urls).toEqual([]);
    expect(H.inserts).toEqual([]);
    expect(H.transactions).toBe(0);
  });

  it("returns the source's attribution with the saved list", async () => {
    H.endpoints = [{ ...endpointRow("attribution"), attribution: "Parcel data: Harris CAD" }];
    const r = await request(app).post("/api/list-builder/commit").send(COMMIT);
    expect(r.status).toBe(200);
    expect(r.body.attribution).toBe("Parcel data: Harris CAD");
  });

  it("409 with the new count when the county's records changed since the preview", async () => {
    const r = await request(app).post("/api/list-builder/commit").send({ ...COMMIT, expectedCount: 4 });
    expect(r.status).toBe(409);
    expect(r.body.details.count).toBe(6);
    expect(H.inserts).toEqual([]);
  });

  it("refuses a list larger than one list may hold", async () => {
    H.parcels = Array.from({ length: 2501 }, (_, i) => parcelRow(i + 1, `P-${i}`, "X", 9));
    const r = await request(app).post("/api/list-builder/commit").send({ ...COMMIT, expectedCount: 2501 });
    expect(r.status).toBe(422);
    expect(H.inserts).toEqual([]);
  });

  it("refuses the whole save when the new leads would exceed the plan — nothing written", async () => {
    H.usage = { limit: 10, current: 9 };
    const r = await request(app).post("/api/list-builder/commit").send(COMMIT);
    expect(r.status).toBe(429);
    expect(r.body).toMatchObject({ error: "LIMIT_EXCEEDED", details: { resourceType: "leads", limit: 10, current: 9, newLeads: 2 } });
    expect(r.body.message).toMatch(/plan allows 10/);
    expect(H.inserts).toEqual([]);
    expect(H.transactions).toBe(0);
  });

  it("re-checks the plan under the lock: a lead that vanished since the check cannot push the save over the limit", async () => {
    // The pre-check sees a live lead for R-005 (1 new lead: 9 + 1 = 10, allowed);
    // by the time the transaction re-reads, that lead is gone (2 new: over).
    const r005 = { id: 777, apn: "R-005", state: "TX", county: "Harris", deletedAt: null };
    H.leadAnswers = [[...H.leads, r005], [...H.leads]];
    H.usage = { limit: 10, current: 9 };
    const r = await request(app).post("/api/list-builder/commit").send(COMMIT);
    expect(r.status).toBe(429);
    expect(r.body.details).toMatchObject({ newLeads: 2 });
    expect(H.transactions).toBe(1);
    expect(H.inserts).toEqual([]);
  });

  it("re-counts the org's leads UNDER the lock: leads added since the check push the save over — nothing written", async () => {
    // The check outside sees 8 (8 + 2 = 10, allowed); under the lock the
    // org has 9 (an import landed in between): 9 + 2 > 10.
    H.usageAnswers = [{ limit: 10, current: 8 }];
    H.inTxCount = 9;
    const r = await request(app).post("/api/list-builder/commit").send(COMMIT);
    expect(r.status).toBe(429);
    expect(r.body.details).toMatchObject({ resourceType: "leads", limit: 10, current: 9, newLeads: 2 });
    expect(H.transactions).toBe(1);
    expect(H.inserts).toEqual([]);
  });

  it("POOL: the under-the-lock count goes through the transaction's OWN connection, never a second pool connection (W10.3 second audit, finding 2)", async () => {
    // checkUsageLimit reads through the global db. Called inside the
    // transaction it held the tx connection AND took another from a pool of
    // five — a burst of saves starves the pool. The limit is read before the
    // transaction; the count, inside it, through `tx`.
    H.usageAnswers = [{ limit: 10, current: 8 }];
    H.inTxCount = 8;
    const r = await request(app).post("/api/list-builder/commit").send(COMMIT);
    expect(r.status).toBe(200);
    expect(H.usageCalls, "checkUsageLimit (global db) only OUTSIDE the transaction").toBe(1);
    expect(H.txExecs).toHaveLength(1);
    expect(H.countExecs, "the in-transaction count must be taken").toHaveLength(1);
    expect(H.countExecs[0]).toBe(H.txExecs[0]);
  });

  it("a list that becomes lead-creating only under the lock still gets the in-transaction count against the plan", async () => {
    // Outside: R-003 and R-005 are both live leads (0 new — no plan read
    // needed); under the lock both are gone (2 new) and the org is at 9 of 10.
    const r003 = { id: 778, apn: "R-003", state: "TX", county: "Harris", deletedAt: null };
    const r005 = { id: 779, apn: "R-005", state: "TX", county: "Harris", deletedAt: null };
    H.leadAnswers = [[...H.leads, r003, r005], [...H.leads]];
    H.usage = { limit: 10, current: 9 };
    const r = await request(app).post("/api/list-builder/commit").send(COMMIT);
    expect(r.status).toBe(429);
    expect(r.body.details).toMatchObject({ limit: 10, current: 9, newLeads: 2 });
    expect(H.countExecs[0]).toBe(H.txExecs[0]);
    expect(H.inserts).toEqual([]);
  });

  it("a list that creates no new leads is never refused by the plan — even for an org already over it", async () => {
    H.leads = [
      ...H.leads,
      { id: 504, apn: "R-003", state: "TX", county: "Harris", deletedAt: null },
      { id: 505, apn: "R-005", state: "TX", county: "Harris", deletedAt: null },
    ];
    H.usage = { limit: 10, current: 12 };
    const r = await request(app).post("/api/list-builder/commit").send(COMMIT);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ created: 0, linkedExisting: 3 });
  });

  it("a county source failure saves nothing", async () => {
    H.fail = true;
    const r = await request(app).post("/api/list-builder/commit").send(COMMIT);
    expect(r.status).toBe(502);
    expect(H.inserts).toEqual([]);
  });

  it("a cannot-page county is a 422 that saves nothing", async () => {
    H.noPaging = true;
    H.parcels = Array.from({ length: 1001 }, (_, i) => parcelRow(i + 1, `P-${i}`, "X", 9));
    const r = await request(app).post("/api/list-builder/commit").send({ ...COMMIT, expectedCount: 1001 });
    expect(r.status).toBe(422);
    expect(r.body.details.reason).toBe("cannot_page");
    expect(H.inserts).toEqual([]);
  });

  it.each(["u-viewer", "u-va", "u-member"])("PERMISSION: %s may not save a county list (canImportData) — nothing read, nothing written", async (user) => {
    const r = await request(app).post("/api/list-builder/commit").set("x-user", user).send(COMMIT);
    expect(r.status).toBe(403);
    expect(r.body.error).toBe("FORBIDDEN");
    expect(r.body.details.requiredPermission).toBe("canImportData");
    expect(H.urls).toEqual([]);
    expect(H.inserts).toEqual([]);
    expect(H.transactions).toBe(0);
  });

  it("PERMISSION: an admin holding canImportData but lacking deal_write is refused by scope", async () => {
    H.scopeRows = [{ role: "viewer" }]; // the team_members row requireScope reads
    const r = await request(app).post("/api/list-builder/commit").set("x-user", "u-admin").send(COMMIT);
    expect(r.status).toBe(403);
    expect(r.body.message).toMatch(/deal_write/);
    expect(H.inserts).toEqual([]);
    H.scopeRows = [{ role: "admin" }];
    expect((await request(app).post("/api/list-builder/commit").set("x-user", "u-admin").send(COMMIT)).status).toBe(200);
  });

  it("IDEMPOTENT: the same Idempotency-Key twice is ONE list, and the retry gets the first answer", async () => {
    const first = await request(app).post("/api/list-builder/commit").set("Idempotency-Key", "save-abc").send(COMMIT);
    const again = await request(app).post("/api/list-builder/commit").set("Idempotency-Key", "save-abc").send(COMMIT);
    expect(first.status).toBe(200);
    expect(again.status).toBe(200);
    expect(again.body).toEqual(first.body);
    expect(H.inserts.filter((i) => i.table === "marketing_lists")).toHaveLength(1);
    expect(H.transactions).toBe(1);
  });

  it("IDEMPOTENT: a double click (two requests in flight with one key) is ONE list", async () => {
    // The first save is still inside its transaction when the second arrives,
    // so the middleware has nothing finished to replay.
    H.txDelayMs = 150;
    const [a, b] = await Promise.all([
      request(app).post("/api/list-builder/commit").set("Idempotency-Key", "double-click").send(COMMIT),
      request(app).post("/api/list-builder/commit").set("Idempotency-Key", "double-click").send(COMMIT),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(b.body.listId).toBe(a.body.listId);
    expect(H.inserts.filter((i) => i.table === "marketing_lists")).toHaveLength(1);
    expect(H.transactions).toBe(1);
  });

  it("different keys are different saves", async () => {
    await request(app).post("/api/list-builder/commit").set("Idempotency-Key", "k-1").send(COMMIT);
    await request(app).post("/api/list-builder/commit").set("Idempotency-Key", "k-2").send(COMMIT);
    expect(H.inserts.filter((i) => i.table === "marketing_lists")).toHaveLength(2);
  });

  it("is rate limited per org: the 6th save in a minute is a 429 that writes nothing", async () => {
    for (let i = 0; i < 5; i++) expect((await request(app).post("/api/list-builder/commit").send(COMMIT)).status).toBe(200);
    const lists = H.inserts.filter((x) => x.table === "marketing_lists").length;
    const r = await request(app).post("/api/list-builder/commit").send(COMMIT);
    expect(r.status).toBe(429);
    expect(r.body.error).toBe("rate_limit_exceeded");
    expect(H.inserts.filter((x) => x.table === "marketing_lists").length).toBe(lists);
  });

  it("an abandoned save (the client went away) stops before the county is read and writes nothing", async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(commitCountyList(ORG, { ...COMMIT, state: "TX", county: "harris county" }, { signal: ac.signal })).rejects.toBeInstanceOf(AreaQueryAborted);
    expect(H.urls).toEqual([]);
    expect(H.inserts).toEqual([]);
    expect(H.transactions).toBe(0);
  });
});

describe("one save per key in flight — the single-flight's own edges (W10.3 second audit, finding 3)", () => {
  type Outcome = Awaited<ReturnType<typeof commitCountyList>>;
  const okOutcome = (listId: number): Outcome => ({
    ok: true,
    list: { listId, created: 1, linkedExisting: 0, total: 1, suppressedDeleted: 0, skippedNoApn: 0, skippedDuplicateApn: 0, attribution: null },
  });
  const live = () => new AbortController().signal;
  let n = 0;
  const key = () => `7:sf-${++n}`;

  it("a FINISHED save stays shared until the middleware has cached it: a same-key request right after it settles does not save again", async () => {
    // The gap: the entry used to be deleted the moment the save settled —
    // BEFORE the first handler's res.json -> setCached ran — so a second
    // request in that window found neither the cache nor the entry, and saved.
    const k = key();
    let saves = 0;
    const save = async () => okOutcome(++saves);
    const first = await sharedSave(k, live(), save);
    const second = await sharedSave(k, live(), save);
    expect(saves).toBe(1);
    expect(second).toEqual(first);
  });

  it("the finished entry is released after the grace (no leak), and a refusal is released at once so a retry runs again", async () => {
    vi.useFakeTimers();
    try {
      const k = key();
      let saves = 0;
      await sharedSave(k, live(), async () => okOutcome(++saves));
      await vi.advanceTimersByTimeAsync(SAVE_SHARE_GRACE_MS + 1);
      await sharedSave(k, live(), async () => okOutcome(++saves));
      expect(saves).toBe(2);

      const r = key();
      let tries = 0;
      const refused = async (): Promise<Outcome> => (++tries, { ok: false, kind: "source_error", message: "county down" });
      await sharedSave(r, live(), refused);
      await sharedSave(r, live(), refused);
      expect(tries).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("the retry after an abandoned first save is registered: two clients still waiting share ONE new save", async () => {
    const k = key();
    let release!: (e: unknown) => void;
    const firstSave = () => new Promise<Outcome>((_res, rej) => (release = rej));
    let retries = 0;
    let finishRetry!: (o: Outcome) => void;
    const retrySave = () => (++retries, new Promise<Outcome>((res) => (finishRetry = res)));

    const a = sharedSave(k, live(), firstSave).catch((e) => e);
    const b = sharedSave(k, live(), retrySave);
    const c = sharedSave(k, live(), retrySave);
    release(new AreaQueryAborted());
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(retries, "B and C must share one retry, not save twice").toBe(1);
    finishRetry(okOutcome(4242));
    expect((await b).ok && (await c).ok).toBe(true);
    expect(await b).toEqual(await c);
    expect(await a).toBeInstanceOf(AreaQueryAborted);
  });
});

describe("GET /api/list-builder/lists", () => {
  it("returns the org's county lists with their true member totals and the overall total", async () => {
    H.lists = [
      { id: 9, name: "B", filters: { states: ["TX"], counties: ["Harris"] }, createdAt: new Date("2026-10-02") },
      { id: 8, name: "A", filters: { states: ["TX"], counties: ["Travis"] }, createdAt: new Date("2026-10-01") },
    ];
    H.listSizes = [{ listId: 9, n: 42 }];
    const r = await request(app).get("/api/list-builder/lists");
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(2);
    expect(r.body.lists).toEqual([
      { id: 9, name: "B", state: "TX", county: "Harris", total: 42, createdAt: "2026-10-02T00:00:00.000Z" },
      { id: 8, name: "A", state: "TX", county: "Travis", total: 0, createdAt: "2026-10-01T00:00:00.000Z" },
    ]);
  });

  it("a list's size counts only its LIVE member leads — the number the leads view and the composer show (W10.3 second audit, finding 7)", async () => {
    H.lists = [{ id: 9, name: "B", filters: { states: ["TX"], counties: ["Harris"] }, createdAt: new Date("2026-10-02") }];
    H.listSizes = [{ listId: 9, n: 41 }];
    expect((await request(app).get("/api/list-builder/lists")).status).toBe(200);
    const sizeRead = H.selects.filter((q) => q.table === "marketing_list_members");
    expect(sizeRead, "vacuity: the size read").toHaveLength(1);
    const q = new PgDialect().sqlToQuery(sizeRead[0].where as SQL);
    // Membership is narrowed to leads that are this org's AND not deleted.
    expect(q.sql).toMatch(/"marketing_list_members"\."lead_id" in \(select "leads"\."id" from "leads" where/);
    expect(q.sql).toMatch(/"leads"\."deleted_at" is null/);
    const leadsOrg = /"leads"\."organization_id" = \$(\d+)/.exec(q.sql);
    expect(leadsOrg, q.sql).not.toBeNull();
    expect(q.params[Number(leadsOrg![1]) - 1]).toBe(ORG);
  });
});

describe("tenancy — every statement on an org-owned table is bound to THIS org", () => {
  const dialect = new PgDialect();
  const ORG_TABLES = new Set(["leads", "marketing_lists", "marketing_list_members", "activity_log"]);

  it("reads render with organization_id bound to the caller's org; writes carry it", async () => {
    await request(app).post("/api/list-builder/preview").send(BODY);
    await request(app).post("/api/list-builder/commit").send({ ...BODY, name: "L", expectedCount: 6 });
    H.lists = [{ id: 9, name: "B", filters: {}, createdAt: new Date() }];
    expect((await request(app).get("/api/list-builder/lists")).status).toBe(200);

    const orgReads = H.selects.filter((s) => ORG_TABLES.has(s.table));
    expect(orgReads.length).toBeGreaterThanOrEqual(6); // vacuity: preview + commit dedupe (×2) + lists (×3)
    for (const s of orgReads) {
      const q = dialect.sqlToQuery(s.where as SQL);
      const bound = [...q.sql.matchAll(/"organization_id" = \$(\d+)/g)].map((m) => q.params[Number(m[1]) - 1]);
      expect(bound, `${s.table}: ${q.sql}`).toContain(ORG);
      expect(bound.every((p) => p === ORG), `${s.table}: ${q.sql}`).toBe(true);
    }
    const writes = H.inserts.filter((i) => ORG_TABLES.has(i.table));
    expect(writes.length).toBeGreaterThanOrEqual(4);
    for (const w of writes) for (const v of w.values) expect(v.organizationId, w.table).toBe(ORG);
  });
});
