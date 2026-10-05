/**
 * W10.3 — the county AREA query (server/services/providers/countyAreaQuery.ts).
 *
 * The county layer is a fake ArcGIS server that EVALUATES the where clause it
 * is sent: it understands exactly the clause shapes the module may emit
 * (`F >= n`, `F <= n`, `F <= DATE 'YYYY-MM-DD'`, `1=1`, joined by AND) and
 * throws on anything else — so an injected fragment cannot pass as a filter,
 * and every count asserted below is the fake county's own count of the
 * parcels that truly match. No network.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CountyGisEndpoint } from "@shared/schema";

const H = vi.hoisted(() => ({
  urls: [] as string[],
  fail: null as null | "network" | "http500" | "error-json" | "error-json-500" | "http404" | "http408" | "ssrf" | "invalid-url",
  layer: {} as Record<string, unknown>,
  parcels: [] as Array<Record<string, unknown>>,
  /** Records to drop from READS only (not from counts) — a county changing mid-read. */
  hideOnRead: 0,
  /** A server that ignores resultOffset (every page is the first page). */
  ignoreOffset: false,
  /** A server that ignores orderByFields (returns records newest-OID first). */
  ignoreOrder: false,
  /** Called after each request the fake answers — lets a test abort mid-read. */
  afterRequest: null as null | ((n: number) => void),
}));

vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
// The breaker's DB persistence is not the subject; keep its state in memory.
vi.mock("../../server/services/providers/circuit-breaker-store", () => ({
  dbBreakerStore: { load: async () => null, save: async () => undefined },
}));

const CLAUSE = /^([A-Za-z_][A-Za-z0-9_.]*) (>=|<=) (?:(-?\d+(?:\.\d+)?)|DATE '(\d{4}-\d{2}-\d{2})')$/;

/** The fake county's evaluator. Anything it does not recognise is a test failure. */
function matches(where: string, a: Record<string, unknown>): boolean {
  if (where === "1=1") return true;
  return where.split(" AND ").every((clause) => {
    const m = CLAUSE.exec(clause);
    if (!m) throw new Error(`fake county: unrecognised clause ${JSON.stringify(clause)}`);
    const [, field, op, n, date] = m;
    if (!(field in a)) throw new Error(`fake county: no field ${field}`);
    const v = a[field];
    if (v === null || v === undefined) return false;
    const lhs = Number(v);
    const rhs = date ? Date.parse(`${date}T00:00:00Z`) : Number(n);
    return op === ">=" ? lhs >= rhs : lhs <= rhs;
  });
}

vi.mock("../../server/services/providers/fetchGeo", async () => {
  // The REAL refusal type (its own module — the fake fetch below throws it
  // exactly where fetchGeo's guard would, before any request is sent).
  const { FetchGeoUrlRefused } = await import("../../server/services/providers/fetchGeoErrors");
  return { fetchGeo: vi.fn(async (url: string) => {
    if (H.fail === "ssrf") throw new FetchGeoUrlRefused("fetchGeo: SSRF guard blocked URL: private address");
    if (H.fail === "invalid-url") throw new FetchGeoUrlRefused("fetchGeo: invalid URL");
    H.urls.push(url);
    if (H.fail === "network") throw new Error("ECONNRESET");
    // What fetchGeo returns once its retries of a 408 are spent.
    if (H.fail === "http408") return { ok: false, status: 408, json: async () => ({}) };
    if (H.fail === "http500") return { ok: false, status: 500, json: async () => ({}) };
    if (H.fail === "http404") return { ok: false, status: 404, json: async () => ({}) };
    if (H.fail === "error-json") return { ok: true, status: 200, json: async () => ({ error: { code: 400, message: "Invalid query" } }) };
    if (H.fail === "error-json-500") return { ok: true, status: 200, json: async () => ({ error: { code: 500, message: "Error performing query operation" } }) };
    H.afterRequest?.(H.urls.length);
    const u = new URL(url);
    if (!u.pathname.endsWith("/query")) return { ok: true, status: 200, json: async () => H.layer };
    const p = u.searchParams;
    const where = p.get("where") ?? "";
    const matched = H.parcels.filter((a) => matches(where, a));
    const hit = H.ignoreOrder ? [...matched].reverse() : matched;
    if (p.get("returnCountOnly") === "true") return { ok: true, status: 200, json: async () => ({ count: hit.length }) };
    const readable = hit.slice(0, Math.max(0, hit.length - H.hideOnRead));
    const max = Number(H.layer.maxRecordCount);
    const offset = H.ignoreOffset ? 0 : Number(p.get("resultOffset") ?? 0);
    const size = Math.min(Number(p.get("resultRecordCount") ?? max), max);
    const page = readable.slice(offset, offset + size);
    const out = (p.get("outFields") ?? "").split(",");
    return {
      ok: true,
      status: 200,
      json: async () => ({
        features: page.map((a) => ({ attributes: Object.fromEntries(out.map((f) => [f, a[f]])) })),
        exceededTransferLimit: offset + page.length < readable.length,
      }),
    };
  }) };
});

const { queryCountyArea, areaFilterCapabilities, AreaQueryRefusal, CountySourceError, AreaQueryAborted } = await import(
  "../../server/services/providers/countyAreaQuery"
);

let nextId = 100;
function endpoint(over: Partial<CountyGisEndpoint> = {}): CountyGisEndpoint {
  return {
    id: nextId++,
    state: "TX",
    county: "Harris",
    fipsCode: "48201",
    endpointType: "arcgis_rest",
    baseUrl: "https://gis.example.gov/arcgis/rest/services/Parcels/MapServer",
    layerId: "0",
    apnField: "HCAD_NUM",
    ownerField: "OWNER_NAME",
    geometryField: null,
    additionalParams: null,
    fieldMappings: { apn: "HCAD_NUM", owner: "OWNER_NAME", address: "SITUS", acres: "ACREAGE", lastSaleDate: "SALE_DATE" },
    isVerified: true,
    lastVerified: null,
    isActive: true,
    errorCount: 0,
    lastError: null,
    sourceUrl: null,
    notes: null,
    contributedBy: "system",
    license: "county-tos",
    attribution: null,
    termsUrl: null,
    redistributable: "review-required",
    reviewedAt: null,
    reviewedBy: null,
    createdAt: null,
    updatedAt: null,
    ...over,
  } as CountyGisEndpoint;
}

const field = (name: string, type: string) => ({ name, type });
const NOW = new Date("2026-10-05T12:00:00Z");

function parcel(i: number, acres: number, owner: string | null, saleIso: string | null = null) {
  return {
    OBJECTID: i,
    HCAD_NUM: `0${i}-000`,
    OWNER_NAME: owner,
    ACREAGE: acres,
    SITUS: `${i} County Rd`,
    SALE_DATE: saleIso ? Date.parse(`${saleIso}T00:00:00Z`) : null,
    SALE_TXT: saleIso,
  };
}

const whereOf = (url: string) => new URL(url).searchParams.get("where");
const queryUrls = () => H.urls.filter((u) => new URL(u).pathname.endsWith("/query"));

beforeEach(() => {
  H.urls = [];
  H.fail = null;
  H.hideOnRead = 0;
  H.ignoreOffset = false;
  H.ignoreOrder = false;
  H.afterRequest = null;
  H.layer = {
    fields: [
      field("OBJECTID", "esriFieldTypeOID"),
      field("HCAD_NUM", "esriFieldTypeString"),
      field("OWNER_NAME", "esriFieldTypeString"),
      field("ACREAGE", "esriFieldTypeDouble"),
      field("SITUS", "esriFieldTypeString"),
      field("SALE_DATE", "esriFieldTypeDate"),
      field("SALE_TXT", "esriFieldTypeString"),
    ],
    maxRecordCount: 2,
    objectIdField: "OBJECTID",
    advancedQueryCapabilities: { supportsPagination: true },
  };
  H.parcels = [
    parcel(1, 2, "JOHN SMITH", "2010-01-01"),
    parcel(2, 12, "SMITH FAMILY TRUST", "2020-06-01"),
    parcel(3, 25, "ACME LAND LLC", "2001-03-15"),
    parcel(4, 40, "ESTATE OF MARY JONES", null),
    parcel(5, 80, "BOB AND ANN LEE", "2016-10-05"),
    parcel(6, 15, null, "1999-01-01"),
  ];
});

describe("the where clause is built from whitelisted fields and formatted literals only", () => {
  it("acreage pushes down as a numeric range the county evaluates exactly", async () => {
    const r = await queryCountyArea(endpoint(), { acreageMin: 10, acreageMax: 40 }, { memberLimit: 100, now: NOW });
    expect(r.count).toBe(4); // parcels 2, 3, 4, 6
    expect(r.records!.map((x) => x.apn)).toEqual(["02-000", "03-000", "04-000", "06-000"]);
    expect(whereOf(queryUrls()[0])).toBe("ACREAGE >= 10 AND ACREAGE <= 40");
    // Paged at the server's own maxRecordCount, in object-id order.
    const pages = queryUrls().slice(1).map((u) => new URL(u).searchParams);
    expect(pages.map((p) => p.get("resultRecordCount"))).toEqual(["2", "2"]);
    expect(pages.map((p) => p.get("resultOffset"))).toEqual(["0", "2"]);
    expect(pages.every((p) => p.get("orderByFields") === "OBJECTID")).toBe(true);
  });

  it("a literal never carries an exponent or anything but digits", async () => {
    await queryCountyArea(endpoint(), { acreageMin: 1e-7, acreageMax: 999999.123456 }, { memberLimit: 100, now: NOW });
    expect(whereOf(queryUrls()[0])).toBe("ACREAGE >= 0 AND ACREAGE <= 999999.1235");
  });

  it("refuses a non-finite or out-of-range number before anything is sent", async () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -1, 2e6]) {
      H.urls = [];
      await expect(queryCountyArea(endpoint(), { acreageMin: bad }, { memberLimit: 100 })).rejects.toBeInstanceOf(AreaQueryRefusal);
      expect(H.urls).toEqual([]);
    }
  });

  it("CANARY: a field name that is not a plain identifier is never interpolated — the filter is refused by name", async () => {
    const evil = endpoint({ fieldMappings: { apn: "HCAD_NUM", owner: "OWNER_NAME", acres: "ACREAGE) OR (1=1" } });
    expect(areaFilterCapabilities(evil).acreage).toBe(false);
    const err = await queryCountyArea(evil, { acreageMin: 1 }, { memberLimit: 100 }).catch((e) => e);
    expect(err).toBeInstanceOf(AreaQueryRefusal);
    expect(err.filter).toBe("acreage");
    expect(H.urls).toEqual([]);
  });

  it("CANARY: a mapped field the LAYER does not report is refused, not sent", async () => {
    const ghost = endpoint({ fieldMappings: { apn: "HCAD_NUM", owner: "OWNER_NAME", acres: "LAND_ACRES" } });
    const err = await queryCountyArea(ghost, { acreageMin: 1 }, { memberLimit: 100 }).catch((e) => e);
    expect(err).toBeInstanceOf(AreaQueryRefusal);
    expect(err.filter).toBe("acreage");
    expect(queryUrls()).toEqual([]);
  });

  it("CANARY: a text acreage column cannot be compared numerically, so it is refused", async () => {
    H.layer.fields = (H.layer.fields as Array<{ name: string; type: string }>).map((f) =>
      f.name === "ACREAGE" ? field("ACREAGE", "esriFieldTypeString") : f,
    );
    await expect(queryCountyArea(endpoint(), { acreageMin: 1 }, { memberLimit: 100 })).rejects.toMatchObject({ filter: "acreage" });
    expect(queryUrls()).toEqual([]);
  });

  it("CANARY: the county and state names never reach the where clause, and additionalParams cannot replace it", async () => {
    const e = endpoint({
      county: "O'Brien' OR '1'='1",
      state: "TX'--",
      additionalParams: { where: "1=1", outFields: "*", token: "abc" } as Record<string, string>,
    });
    await queryCountyArea(e, { acreageMin: 50 }, { memberLimit: 100, now: NOW });
    for (const u of queryUrls()) {
      const p = new URL(u).searchParams;
      expect(p.get("where")).toBe("ACREAGE >= 50");
      expect(p.get("token")).toBe("abc"); // a non-controlled extra param still passes through
      expect(p.get("outFields")).not.toBe("*");
    }
  });

  it("CANARY: additionalParams is an allowlist (token only) — every other key is dropped, whatever its case", async () => {
    const e = endpoint({
      additionalParams: {
        WHERE: "1=1",
        Where: "1=1",
        outStatistics: "[{}]",
        returnDistinctValues: "true",
        gdbVersion: "SDE.DEFAULT",
        OUTFIELDS: "*",
        resultoffset: "999",
        Token: "abc",
      } as Record<string, string>,
    });
    const r = await queryCountyArea(e, { acreageMin: 50 }, { memberLimit: 100, now: NOW });
    expect(r.count).toBe(1);
    expect(H.urls.length).toBeGreaterThan(1); // vacuity: info + count + read
    for (const u of H.urls) {
      const keys = [...new URL(u).searchParams.keys()].map((k) => k.toLowerCase());
      for (const banned of ["outstatistics", "returndistinctvalues", "gdbversion"]) expect(keys, u).not.toContain(banned);
      // Exactly one where / outFields / resultOffset, and it is ours.
      expect(keys.filter((k) => k === "where").length, u).toBeLessThanOrEqual(1);
      expect(keys.filter((k) => k === "outfields").length, u).toBeLessThanOrEqual(1);
      expect(keys.filter((k) => k === "resultoffset").length, u).toBeLessThanOrEqual(1);
      expect(new URL(u).searchParams.get("token"), u).toBe("abc");
    }
    for (const u of queryUrls()) expect(whereOf(u)).toBe("ACREAGE >= 50");
  });

  it("an unmapped filter is refused by name with no request at all", async () => {
    const noSale = endpoint({ fieldMappings: { apn: "HCAD_NUM", owner: "OWNER_NAME", acres: "ACREAGE" } });
    expect(areaFilterCapabilities(noSale)).toEqual({ acreage: true, ownerType: true, yearsOwned: false });
    await expect(queryCountyArea(noSale, { yearsOwnedMin: 5 }, { memberLimit: 100 })).rejects.toMatchObject({ filter: "yearsOwned" });
    expect(H.urls).toEqual([]);
  });
});

describe("filters the county cannot evaluate are computed exactly over the whole pushed-down set", () => {
  it("owner type: every record of the acreage set is read and classified; the count is exact", async () => {
    const r = await queryCountyArea(endpoint(), { acreageMin: 10, ownerTypes: ["trust", "estate"] }, { memberLimit: 100, now: NOW });
    expect(r.count).toBe(2);
    expect(r.records!.map((x) => x.owner)).toEqual(["SMITH FAMILY TRUST", "ESTATE OF MARY JONES"]);
    // The owner filter itself never reaches the county.
    expect(queryUrls().every((u) => whereOf(u) === "ACREAGE >= 10")).toBe(true);
  });

  it("a parcel with no owner name is not any owner type", async () => {
    const r = await queryCountyArea(endpoint(), { ownerTypes: ["individual", "entity", "trust", "estate"] }, { memberLimit: 100 });
    expect(r.count).toBe(5); // parcel 6 has no owner
  });

  it("refuses with the TRUE pushed-down count when the set is beyond the fetch ceiling — and reads none of it", async () => {
    H.parcels = Array.from({ length: 20_001 }, (_, i) => parcel(i + 1, 5, "JOHN DOE"));
    const err = await queryCountyArea(endpoint(), { ownerTypes: ["entity"] }, { memberLimit: 2500 }).catch((e) => e);
    expect(err).toBeInstanceOf(AreaQueryRefusal);
    expect(err.filter).toBe("ownerType");
    expect(err.details.pushedDownCount).toBe(20_001);
    expect(err.message).toMatch(/narrow by acreage first/i);
    // One info read, one count — no record pages.
    expect(queryUrls().map((u) => new URL(u).searchParams.get("returnCountOnly"))).toEqual(["true"]);
  });

  it("years owned on a DATE column pushes down as a date cutoff", async () => {
    const r = await queryCountyArea(endpoint(), { yearsOwnedMin: 10 }, { memberLimit: 100, now: NOW });
    expect(whereOf(queryUrls()[0])).toBe("SALE_DATE <= DATE '2016-10-05'");
    // 2010, 2001, 2016-10-05 (the boundary day), 1999 — never parcel 4 (no sale on record).
    expect(r.records!.map((x) => x.apn).sort()).toEqual(["01-000", "03-000", "05-000", "06-000"]);
  });

  it("years owned on a TEXT column is read and computed, with the same boundary", async () => {
    const e = endpoint({ fieldMappings: { apn: "HCAD_NUM", owner: "OWNER_NAME", acres: "ACREAGE", lastSaleDate: "SALE_TXT" } });
    const r = await queryCountyArea(e, { yearsOwnedMin: 10 }, { memberLimit: 100, now: NOW });
    expect(queryUrls().every((u) => whereOf(u) === "1=1")).toBe(true);
    expect(r.records!.map((x) => x.apn).sort()).toEqual(["01-000", "03-000", "05-000", "06-000"]);
  });

  it("an unreadable sale date refuses the filter instead of guessing", async () => {
    H.parcels[0].SALE_TXT = "sometime in spring";
    const e = endpoint({ fieldMappings: { apn: "HCAD_NUM", owner: "OWNER_NAME", lastSaleDate: "SALE_TXT" } });
    await expect(queryCountyArea(e, { yearsOwnedMin: 3 }, { memberLimit: 100, now: NOW })).rejects.toMatchObject({ filter: "yearsOwned" });
  });
});

describe("a large set is counted, not read; a failing source yields no number", () => {
  it("over the member limit: the exact count and a five-row sample, no full read", async () => {
    H.parcels = Array.from({ length: 30 }, (_, i) => parcel(i + 1, 5, "JOHN DOE"));
    H.layer.maxRecordCount = 1000;
    const r = await queryCountyArea(endpoint(), { acreageMin: 1 }, { memberLimit: 10 });
    expect(r.count).toBe(30);
    expect(r.records).toBeNull();
    expect(r.sample).toHaveLength(5);
    expect(new URL(queryUrls()[1]).searchParams.get("resultRecordCount")).toBe("5");
  });

  it("a read that comes back short of the county's own count is an error, never a smaller list", async () => {
    H.hideOnRead = 1;
    const err = await queryCountyArea(endpoint(), {}, { memberLimit: 100 }).catch((e) => e);
    expect(err).toBeInstanceOf(CountySourceError);
    expect(err.reason).toBe("changed_while_reading");
  });

  it("a server that cannot page refuses a set larger than one response", async () => {
    H.layer.advancedQueryCapabilities = { supportsPagination: false };
    await expect(queryCountyArea(endpoint(), {}, { memberLimit: 100 })).rejects.toMatchObject({ reason: "cannot_page" });
  });

  it.each(["network", "http500", "error-json"] as const)("source failure (%s) is a CountySourceError with no count", async (mode) => {
    H.fail = mode;
    const err = await queryCountyArea(endpoint(), { acreageMin: 1 }, { memberLimit: 100 }).catch((e) => e);
    expect(err).toBeInstanceOf(CountySourceError);
    expect(err).not.toHaveProperty("count");
  });

  it("paged reads ask for the object id and get it", async () => {
    await queryCountyArea(endpoint(), {}, { memberLimit: 100 });
    const paged = queryUrls().filter((u) => new URL(u).searchParams.has("resultOffset"));
    expect(paged.length).toBe(3); // vacuity: 6 records, 2 per page
    for (const u of paged) expect(new URL(u).searchParams.get("outFields")!.split(",")).toContain("OBJECTID");
  });

  it("CANARY: a server that ignores resultOffset (every page the first) is caught, never read as six records", async () => {
    H.ignoreOffset = true;
    const err = await queryCountyArea(endpoint(), {}, { memberLimit: 100 }).catch((e) => e);
    expect(err).toBeInstanceOf(CountySourceError);
    expect(err.reason).toBe("changed_while_reading");
  });

  it("CANARY: a server that ignores the object-id ordering is caught (ids must advance across pages)", async () => {
    H.ignoreOrder = true;
    const err = await queryCountyArea(endpoint(), {}, { memberLimit: 100 }).catch((e) => e);
    expect(err).toBeInstanceOf(CountySourceError);
    expect(err.reason).toBe("changed_while_reading");
  });

  it("a layer whose object ids are not numbers cannot be paged exactly — a structural refusal", async () => {
    H.parcels = H.parcels.map((p) => ({ ...p, OBJECTID: `id-${p.OBJECTID}` }));
    const err = await queryCountyArea(endpoint(), {}, { memberLimit: 100 }).catch((e) => e);
    expect(err).toBeInstanceOf(CountySourceError);
    expect(err.reason).toBe("misconfigured");
    expect(err.transient).toBe(false);
  });

  it("a layer id that is not a number is a misconfigured (structural) source, not a transient failure", async () => {
    const err = await queryCountyArea(endpoint({ layerId: "0/../1" }), {}, { memberLimit: 100 }).catch((e) => e);
    expect(err).toBeInstanceOf(CountySourceError);
    expect(err.reason).toBe("misconfigured");
    expect(err.transient).toBe(false);
    expect(H.urls).toEqual([]);
  });

  it("transience: only a source failing to answer is transient; cannot_page and a 4xx refusal are structural", async () => {
    H.layer.advancedQueryCapabilities = { supportsPagination: false };
    expect(await queryCountyArea(endpoint(), {}, { memberLimit: 100 }).catch((e) => e)).toMatchObject({ reason: "cannot_page", transient: false });
    H.layer.advancedQueryCapabilities = { supportsPagination: true };
    H.fail = "error-json";
    expect(await queryCountyArea(endpoint(), {}, { memberLimit: 100 }).catch((e) => e)).toMatchObject({ reason: "query_refused", transient: false });
    H.fail = "error-json-500";
    expect(await queryCountyArea(endpoint(), {}, { memberLimit: 100 }).catch((e) => e)).toMatchObject({ reason: "query_refused", transient: true });
    H.fail = "http404";
    expect(await queryCountyArea(endpoint(), {}, { memberLimit: 100 }).catch((e) => e)).toMatchObject({ reason: "misconfigured", transient: false });
    for (const f of ["http500", "network"] as const) {
      H.fail = f;
      expect(await queryCountyArea(endpoint(), {}, { memberLimit: 100 }).catch((e) => e), f).toMatchObject({ transient: true });
    }
  });

  it("an ArcGIS 4xx-class error body (HTTP 200) is a refusal, not a source failure: it never opens the breaker", async () => {
    const e = endpoint();
    H.fail = "error-json";
    for (let i = 0; i < 4; i++) {
      await expect(queryCountyArea(e, {}, { memberLimit: 100 })).rejects.toMatchObject({ reason: "query_refused", transient: false });
    }
    H.fail = null;
    const ok = await queryCountyArea(e, { acreageMin: 70 }, { memberLimit: 100 });
    expect(ok.count).toBe(1);
  });

  it("an ArcGIS 5xx-class error body (HTTP 200) IS the source failing: transient, and three open the breaker (W10.3 second audit, finding 9)", async () => {
    const e = endpoint();
    H.fail = "error-json-500";
    for (let i = 0; i < 3; i++) {
      await expect(queryCountyArea(e, {}, { memberLimit: 100 })).rejects.toMatchObject({ reason: "query_refused", transient: true });
    }
    H.fail = null;
    H.urls = [];
    await expect(queryCountyArea(e, {}, { memberLimit: 100 })).rejects.toMatchObject({ reason: "circuit_open" });
    expect(H.urls).toEqual([]);
  });

  it("a 408 that outlasted fetchGeo's retries is a timeout: transient, and it counts toward the breaker", async () => {
    const e = endpoint();
    H.fail = "http408";
    for (let i = 0; i < 3; i++) {
      await expect(queryCountyArea(e, {}, { memberLimit: 100 })).rejects.toMatchObject({ transient: true });
    }
    H.fail = null;
    await expect(queryCountyArea(e, {}, { memberLimit: 100 })).rejects.toMatchObject({ reason: "circuit_open" });
  });

  it.each(["ssrf", "invalid-url"] as const)(
    "a URL fetchGeo refuses to fetch (%s) is a MISCONFIGURED source: structural (422), never counted against the county",
    async (kind) => {
      const e = endpoint();
      H.fail = kind;
      for (let i = 0; i < 4; i++) {
        await expect(queryCountyArea(e, {}, { memberLimit: 100 })).rejects.toMatchObject({ reason: "misconfigured", transient: false });
      }
      // Four refusals and the breaker is still closed: a fixed URL reads at once.
      H.fail = null;
      const ok = await queryCountyArea(e, { acreageMin: 70 }, { memberLimit: 100 });
      expect(ok.count).toBe(1);
    },
  );

  it("stops reading when the caller goes away: no request after the abort", async () => {
    const ac = new AbortController();
    // info (1), count (2), first page (3) — abort after the first page.
    H.afterRequest = (n) => {
      if (n === 3) ac.abort();
    };
    const err = await queryCountyArea(endpoint(), {}, { memberLimit: 100, signal: ac.signal }).catch((e) => e);
    expect(err).toBeInstanceOf(AreaQueryAborted);
    expect(H.urls).toHaveLength(3);
  });

  it("three failures open this endpoint's breaker; the next call sends nothing; another county is unaffected", async () => {
    const dark = endpoint();
    H.fail = "http500";
    for (let i = 0; i < 3; i++) await queryCountyArea(dark, {}, { memberLimit: 100 }).catch(() => undefined);
    H.fail = null;
    H.urls = [];
    await expect(queryCountyArea(dark, {}, { memberLimit: 100 })).rejects.toMatchObject({ reason: "circuit_open" });
    expect(H.urls).toEqual([]);
    const other = await queryCountyArea(endpoint(), { acreageMin: 70 }, { memberLimit: 100 });
    expect(other.count).toBe(1);
  });
});

