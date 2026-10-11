/**
 * W3 public land routes — the HTTP contract of what crawlers and strangers get
 * (server/routes-public-parcel-report.ts page route for owned parcels, and
 * server/routes-public-land.ts).
 *
 *  - /p page for a parcel AcreOS keeps: the verified facts are IN the HTML
 *    (server-rendered), the canonical URL names the stored parcel id, the
 *    JSON-LD carries only shown facts, and a page with no verified fact is
 *    noindex. Read-only: never generates.
 *  - /api/public/parcel-report carries the land facts even when the daily
 *    ceiling refuses a new report.
 *  - /api/public/land/landlocked: answers and refusals pass through, junk is
 *    400, and it is rate-limited per visitor (not per bare IP).
 *  - /land/:state/:county: a county with no data has NO page (404, noindex);
 *    one with data renders its sourced numbers into the HTML.
 *  - /sitemap-land*.xml and /llms.txt list only pages that exist.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import fs from "fs";
import os from "os";
import path from "path";

const h = vi.hoisted(() => ({
  shellPath: null as string | null,
  getExistingReport: vi.fn(),
  getOrCreateReport: vi.fn(),
  getPublicLandFacts: vi.fn(),
  getCountyGuide: vi.fn(),
  listCountyGuides: vi.fn(async () => [] as any[]),
  listIndexableParcels: vi.fn(async () => [] as any[]),
  countIndexableParcels: vi.fn(async () => 0),
  checkLandlocked: vi.fn(),
}));

vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/utils/redis", () => ({ getRedisClient: async () => null }));
vi.mock("../../server/static", () => ({
  finalizeShellHtml: (html: string) => html,
  resolveShellPath: () => h.shellPath,
}));
vi.mock("../../server/db", () => ({ db: {} }));
vi.mock("../../server/services/parcel/resolveParcel", () => ({ resolveParcel: vi.fn() }));
vi.mock("../../server/services/alertSpine", () => ({ raiseAlert: vi.fn(async () => undefined) }));
vi.mock("../../server/services/publicParcelReport", async (importOriginal) => {
  const real = await importOriginal<any>();
  return {
    ...real,
    getExistingReport: h.getExistingReport,
    getOrCreateReport: h.getOrCreateReport,
    getPublicLandFacts: h.getPublicLandFacts,
    recordReportView: vi.fn(async () => undefined),
  };
});
vi.mock("../../server/services/publicCountyGuide", async (importOriginal) => {
  const real = await importOriginal<any>();
  return {
    ...real,
    getCountyGuide: h.getCountyGuide,
    listCountyGuides: h.listCountyGuides,
    listIndexableParcels: h.listIndexableParcels,
    countIndexableParcels: h.countIndexableParcels,
  };
});
vi.mock("../../server/services/landlockedCheck", () => ({ checkLandlocked: h.checkLandlocked }));

import publicParcelReportRouter, { registerPublicParcelReportPages } from "../../server/routes-public-parcel-report";
import { registerPublicLandRoutes } from "../../server/routes-public-land";
import { clearRateLimitStore } from "../../server/middleware/rateLimit";
import { publicLandFactsOf } from "../../server/services/publicParcelReport";
import { ownedRowFor } from "../helpers/landFixtureFacts";

function makeApp() {
  const app = express();
  app.use("/api/public/parcel-report", publicParcelReportRouter);
  registerPublicParcelReportPages(app);
  registerPublicLandRoutes(app);
  return app;
}

function withShell() {
  const shell = path.join(os.tmpdir(), `acreos-w3-shell-${process.pid}-${Math.random().toString(36).slice(2)}.html`);
  fs.writeFileSync(
    shell,
    `<html><head><title>AcreOS</title><meta name="description" content="generic" /><link rel="canonical" href="https://acreos.io/" /></head><body><div id="root"></div></body></html>`,
  );
  h.shellPath = shell;
  return shell;
}

const GUIDE = {
  state: "TN",
  countySlug: "dekalb",
  countyLabel: "Dekalb",
  parcelCount: 20,
  sourceNames: ["TN Comptroller parcel download"],
  retrievedFrom: "2026-10-10",
  retrievedTo: "2026-10-10",
  roadAccess: { computed: 20, publicRoad: 16, nonAccessOnly: 0, noRoad: 4, publicRoadPct: 80, basis: "Counted over 20 of 20 kept parcels." },
  roadAccessRefusal: null,
  taxSaleSources: [],
  coverage: null,
  coverageLabel: null,
  parcelLinks: [{ apn: "021037 00500", path: "/p/tn/dekalb/021037%2000500" }],
};

beforeEach(async () => {
  for (const f of Object.values(h)) if (typeof f === "function" && "mockReset" in f) (f as any).mockReset();
  h.listCountyGuides.mockResolvedValue([]);
  h.listIndexableParcels.mockResolvedValue([]);
  h.countIndexableParcels.mockResolvedValue(0);
  h.shellPath = null;
  await clearRateLimitStore();
});

describe("/p page for a parcel AcreOS keeps", () => {
  it("server-renders the verified facts, canonical stored id and fact-only JSON-LD", async () => {
    const shell = withShell();
    const land = publicLandFactsOf(ownedRowFor(0));
    h.getExistingReport.mockResolvedValue(null);
    h.getPublicLandFacts.mockResolvedValue(land);
    // Requested with the id in a different spelling.
    const res = await request(makeApp()).get("/p/tn/dekalb/021037-00500");
    expect(res.status).toBe(200);
    expect(res.text).toContain('data-ssr="land-report"');
    expect(res.text).toContain(`<link rel="canonical" href="https://acreos.io/p/tn/dekalb/${encodeURIComponent(land.apn)}"`);
    expect(res.text).not.toContain('name="robots" content="noindex"');
    expect(res.text).not.toContain('content="generic"');
    const shown = land.rows.filter((r) => r.status === "shown");
    expect(shown.length).toBeGreaterThan(0);
    const ld = JSON.parse(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/.exec(res.text)![1]);
    expect(ld.mainEntity.additionalProperty).toHaveLength(shown.length);
    // Inside #root, so the SPA replaces it on mount and crawlers read it.
    expect(res.text).toMatch(/<div id="root"><article[^>]*data-ssr="land-report"/);
    expect(h.getOrCreateReport).not.toHaveBeenCalled();
    fs.unlinkSync(shell);
  });

  it("a kept parcel with no verified fact is noindex", async () => {
    const shell = withShell();
    const land = { ...publicLandFactsOf(ownedRowFor(0)), indexable: false };
    land.rows = land.rows.map((r) => ({ ...r, status: "not_available" as const, text: "Not available", reason: "test" }));
    h.getExistingReport.mockResolvedValue(null);
    h.getPublicLandFacts.mockResolvedValue(land);
    const res = await request(makeApp()).get("/p/tn/dekalb/021037-00500");
    expect(res.text).toContain('name="robots" content="noindex"');
    fs.unlinkSync(shell);
  });

  it("no report and no kept parcel: noindex shell, nothing generated", async () => {
    const shell = withShell();
    h.getExistingReport.mockResolvedValue(null);
    h.getPublicLandFacts.mockResolvedValue(null);
    const res = await request(makeApp()).get("/p/tn/dekalb/99999");
    expect(res.text).toContain('name="robots" content="noindex"');
    expect(res.text).not.toContain("data-ssr");
    fs.unlinkSync(shell);
  });

  it("the JSON API carries the land facts even when the daily ceiling refuses a new report", async () => {
    const land = publicLandFactsOf(ownedRowFor(0));
    h.getOrCreateReport.mockResolvedValue({ ok: false, reason: "daily_capacity" });
    h.getPublicLandFacts.mockResolvedValue(land);
    const res = await request(makeApp()).get("/api/public/parcel-report/tn/dekalb/021037-00500").query({ sid: "sid-aaaa-0001" });
    expect(res.status).toBe(429);
    expect(res.body.details.land.parcelKey).toBe(land.parcelKey);
  });
});

describe("GET /api/public/land/landlocked", () => {
  it("passes the service's answer through", async () => {
    h.checkLandlocked.mockResolvedValue({ status: "refused", reason: "county_not_kept", message: "not loaded", county: null });
    const res = await request(makeApp()).get("/api/public/land/landlocked").query({ state: "TN", county: "Shelby", apn: "123", sid: "sid-bbbb-0001" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("refused");
    expect(h.checkLandlocked).toHaveBeenCalledWith({ state: "TN", county: "Shelby", apn: "123" });
  });

  it("400s input that is neither a parcel reference nor a point", async () => {
    const res = await request(makeApp()).get("/api/public/land/landlocked").query({ state: "Tennessee" });
    expect(res.status).toBe(400);
    expect(h.checkLandlocked).not.toHaveBeenCalled();
  });

  it("rate-limits per visitor: 20 a minute, and another visitor on the same IP is unaffected", async () => {
    h.checkLandlocked.mockResolvedValue({ status: "refused", reason: "bad_input", message: "x", county: null });
    const app = makeApp();
    for (let i = 0; i < 20; i++) {
      const ok = await request(app).get("/api/public/land/landlocked").query({ lat: 36, lng: -85.8, sid: "sid-cccc-0001" });
      expect(ok.status).toBe(200);
    }
    const limited = await request(app).get("/api/public/land/landlocked").query({ lat: 36, lng: -85.8, sid: "sid-cccc-0001" });
    expect(limited.status).toBe(429);
    const other = await request(app).get("/api/public/land/landlocked").query({ lat: 36, lng: -85.8, sid: "sid-dddd-0002" });
    expect(other.status).toBe(200);
  });
});

describe("/land/:state/:county county guides", () => {
  it("a county with no data has no page: 404 + noindex", async () => {
    const shell = withShell();
    h.getCountyGuide.mockResolvedValue(null);
    const res = await request(makeApp()).get("/land/tn/shelby");
    expect(res.status).toBe(404);
    expect(res.text).toContain('name="robots" content="noindex"');
    const api = await request(makeApp()).get("/api/public/land/county-guide/tn/shelby");
    expect(api.status).toBe(404);
    fs.unlinkSync(shell);
  });

  it("a county with data renders its sourced numbers into the HTML with a canonical URL", async () => {
    const shell = withShell();
    h.getCountyGuide.mockResolvedValue(GUIDE);
    const res = await request(makeApp()).get("/land/tn/dekalb");
    expect(res.status).toBe(200);
    expect(res.text).toContain('data-ssr="county-guide"');
    expect(res.text).toContain("<strong>20</strong> parcels kept");
    expect(res.text).toContain("<strong>80%</strong> of the 20 kept parcels");
    expect(res.text).toContain('<link rel="canonical" href="https://acreos.io/land/tn/dekalb"');
    expect(res.text).toContain('"@type":"Dataset"');
    fs.unlinkSync(shell);
  });
});

describe("sitemaps and llms.txt list only pages that exist", () => {
  it("the index names the counties map and one parcels page per 40,000", async () => {
    h.countIndexableParcels.mockResolvedValue(40_001);
    const res = await request(makeApp()).get("/sitemap-land.xml");
    expect(res.text).toContain("<loc>https://acreos.io/sitemap-land-counties.xml</loc>");
    expect(res.text).toContain("sitemap-land-parcels-2.xml");
    expect(res.text).not.toContain("sitemap-land-parcels-3.xml");
  });

  it("the counties map lists exactly the counties with a guide", async () => {
    h.listCountyGuides.mockResolvedValue([{ state: "TN", countySlug: "dekalb", countyLabel: "Dekalb", parcelCount: 20, lastRetrieved: new Date("2026-10-10") }]);
    const res = await request(makeApp()).get("/sitemap-land-counties.xml");
    expect((res.text.match(/<url>/g) ?? []).length).toBe(1);
    expect(res.text).toContain("<loc>https://acreos.io/land/tn/dekalb</loc>");
  });

  it("a parcels page past the end is a 404, not an empty sitemap", async () => {
    h.listIndexableParcels.mockResolvedValue([]);
    const res = await request(makeApp()).get("/sitemap-land-parcels-7.xml");
    expect(res.status).toBe(404);
  });

  it("llms.txt lists the county guides that exist, and says so when there are none", async () => {
    const none = await request(makeApp()).get("/llms.txt");
    expect(none.text).toContain("County guides: none yet");
    h.listCountyGuides.mockResolvedValue([{ state: "TN", countySlug: "dekalb", countyLabel: "Dekalb", parcelCount: 20, lastRetrieved: null }]);
    const some = await request(makeApp()).get("/llms.txt");
    expect(some.text).toContain("[Dekalb County, TN](https://acreos.io/land/tn/dekalb): 20 parcels kept");
    expect(some.text).toContain("/tools/landlocked");
  });
});
