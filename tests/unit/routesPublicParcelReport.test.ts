/**
 * Tier 3A — /p public parcel report routes (server/routes-public-parcel-report.ts).
 *
 * Covers the route-layer contract on top of the (mocked) service:
 *  - JSON API: 200 found / honest 200 no_free_source / 429 daily capacity /
 *    400 junk keys.
 *  - Rate limiting: session-id keyed first; the no-sid fallback keys on
 *    IP+UA hash, NOT pure IP (two browsers behind one carrier-NAT IP get
 *    independent budgets).
 *  - Page routes: head-meta injection for existing reports, og.png renders
 *    a real PNG, sitemap lists only rows that exist.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import fs from "fs";
import os from "os";
import path from "path";

const h = vi.hoisted(() => ({
  shellPath: null as string | null,
  getOrCreateReport: vi.fn(),
  getExistingReport: vi.fn(),
  recordReportView: vi.fn(async () => undefined),
  listReportsForSitemap: vi.fn(async () => [] as any[]),
}));

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
// No Redis in tests — the limiter falls back to its in-memory window.
vi.mock("../../server/utils/redis", () => ({
  getRedisClient: async () => null,
}));
vi.mock("../../server/static", () => ({
  finalizeShellHtml: (html: string, _nonce: string) => html,
  resolveShellPath: () => h.shellPath,
}));
vi.mock("../../server/services/publicParcelReport", async (importOriginal) => {
  // Keep the PURE helpers real (normalizeReportKey / reportPath / buildOgSvg
  // have no I/O imports of consequence once db/resolveParcel are mocked
  // below) — the routes' 400-path must be tested against the real
  // normalizer, not a stub of it.
  const real = await importOriginal<any>();
  return {
    ...real,
    getOrCreateReport: h.getOrCreateReport,
    getExistingReport: h.getExistingReport,
    recordReportView: h.recordReportView,
    listReportsForSitemap: h.listReportsForSitemap,
  };
});
// The real service module (imported above for its pure helpers) pulls these —
// stub them so importing it costs nothing and touches nothing.
vi.mock("../../server/db", () => ({ db: {} }));
vi.mock("../../server/services/parcel/resolveParcel", () => ({
  resolveParcel: vi.fn(),
}));
vi.mock("../../server/services/alertSpine", () => ({
  raiseAlert: vi.fn(async () => undefined),
}));

import publicParcelReportRouter, {
  registerPublicParcelReportPages,
} from "../../server/routes-public-parcel-report";
import { clearRateLimitStore } from "../../server/middleware/rateLimit";

const REPORT = {
  id: 1,
  state: "TX",
  countySlug: "travis",
  countyLabel: "Travis",
  apn: "123-45-678",
  apnKey: "12345678",
  facts: {
    parcel: {
      apn: "123-45-678",
      state: "TX",
      county: "Travis",
      acres: 5.2,
      centroid: { lat: 30.3, lng: -97.7 },
      countyAttributes: "not-redistributable",
      attribution: null,
      assessorData: null,
    },
    categories: [],
  },
  lcs: {
    kind: "partial",
    basis: "government-data-only",
    scoredDimensions: 2,
    totalDimensions: 6,
    partialScore: 795,
    partialGrade: "A",
    dimensions: [
      {
        key: "environmental",
        label: "Environmental",
        weight: 10,
        status: "scored",
        score: 90,
        coverage: ["floodRisk"],
        missing: [],
        sources: ["FEMA NFHL"],
      },
    ],
    modelVersion: "public-partial-v1",
    computedAt: new Date().toISOString(),
  },
  latitude: 30.3,
  longitude: -97.7,
  viewCount: 0,
  lastViewedAt: null,
  createdAt: new Date(),
  refreshedAt: new Date(),
};

function makeApp() {
  const app = express();
  app.use("/api/public/parcel-report", publicParcelReportRouter);
  registerPublicParcelReportPages(app);
  return app;
}

beforeEach(() => {
  clearRateLimitStore();
  h.shellPath = null;
  h.getOrCreateReport.mockReset();
  h.getExistingReport.mockReset();
  h.recordReportView.mockClear();
  h.listReportsForSitemap.mockReset();
  h.listReportsForSitemap.mockResolvedValue([]);
});

describe("GET /api/public/parcel-report/:state/:county/:apn", () => {
  it("returns the report and records a server-side view", async () => {
    h.getOrCreateReport.mockResolvedValue({
      ok: true,
      report: REPORT,
      generated: true,
    });
    const res = await request(makeApp())
      .get("/api/public/parcel-report/tx/travis/123-45-678")
      .query({ sid: "session-abc-123" });
    expect(res.status).toBe(200);
    expect(res.body.found).toBe(true);
    expect(res.body.path).toBe("/p/tx/travis/123-45-678");
    expect(res.body.report.lcs.partialScore).toBe(795);
    expect(h.recordReportView).toHaveBeenCalledWith(1);
    // The router passed the NORMALIZED key to the service.
    const key = h.getOrCreateReport.mock.calls[0][0];
    expect(key).toMatchObject({
      state: "TX",
      countySlug: "travis",
      apnKey: "12345678",
    });
  });

  it("400s junk that cannot be a parcel reference (no service call)", async () => {
    const res = await request(makeApp()).get(
      "/api/public/parcel-report/tx/travis/about",
    );
    expect(res.status).toBe(400);
    expect(h.getOrCreateReport).not.toHaveBeenCalled();
  });

  it("returns an honest 200 no_free_source — absence is information", async () => {
    h.getOrCreateReport.mockResolvedValue({
      ok: false,
      reason: "no_free_source",
    });
    const res = await request(makeApp()).get(
      "/api/public/parcel-report/tx/travis/99999",
    );
    expect(res.status).toBe(200);
    expect(res.body.found).toBe(false);
    expect(res.body.reason).toBe("no_free_source");
    expect(typeof res.body.message).toBe("string");
  });

  it("429s when the daily generation cap refuses new work", async () => {
    h.getOrCreateReport.mockResolvedValue({
      ok: false,
      reason: "daily_capacity",
    });
    const res = await request(makeApp()).get(
      "/api/public/parcel-report/tx/travis/99999",
    );
    expect(res.status).toBe(429);
    expect(res.body.details.reason).toBe("daily_capacity");
  });

  it("rate-limits per session id, and the no-sid fallback is IP+UA — not pure IP", async () => {
    h.getOrCreateReport.mockResolvedValue({
      ok: true,
      report: REPORT,
      generated: false,
    });
    const app = makeApp();

    // Exhaust one session's 30/min budget.
    for (let i = 0; i < 30; i++) {
      const ok = await request(app)
        .get("/api/public/parcel-report/tx/travis/12345")
        .query({ sid: "session-aaaa-1111" });
      expect(ok.status).toBe(200);
    }
    const limited = await request(app)
      .get("/api/public/parcel-report/tx/travis/12345")
      .query({ sid: "session-aaaa-1111" });
    expect(limited.status).toBe(429);

    // A DIFFERENT session from the same IP still has its own budget
    // (carrier-NAT phones share an IP; the session key isolates them).
    const otherSession = await request(app)
      .get("/api/public/parcel-report/tx/travis/12345")
      .query({ sid: "session-bbbb-2222" });
    expect(otherSession.status).toBe(200);

    // No sid: two different user agents on the same IP get independent
    // buckets — the fallback key is sha256(IP|UA), never bare IP.
    for (let i = 0; i < 30; i++) {
      await request(app)
        .get("/api/public/parcel-report/tx/travis/12345")
        .set("User-Agent", "phone-a");
    }
    const phoneALimited = await request(app)
      .get("/api/public/parcel-report/tx/travis/12345")
      .set("User-Agent", "phone-a");
    expect(phoneALimited.status).toBe(429);
    const phoneB = await request(app)
      .get("/api/public/parcel-report/tx/travis/12345")
      .set("User-Agent", "phone-b");
    expect(phoneB.status).toBe(200);
  });
});

describe("page routes", () => {
  it("injects per-report head meta into the shell for crawlers", async () => {
    const shell = path.join(os.tmpdir(), `acreos-test-shell-${Date.now()}.html`);
    fs.writeFileSync(
      shell,
      `<html><head><title>AcreOS</title><meta name="description" content="generic" /></head><body><div id="root"></div></body></html>`,
    );
    h.shellPath = shell;
    h.getExistingReport.mockResolvedValue(REPORT);

    const res = await request(makeApp()).get("/p/tx/travis/123-45-678");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.text).toContain("Travis County, TX");
    expect(res.text).toContain("partial Land Credit Score 795 (A)");
    expect(res.text).toContain('property="og:image"');
    expect(res.text).toContain("/p/tx/travis/123-45-678/og.png");
    expect(res.text).not.toContain('content="generic"');
    fs.unlinkSync(shell);
  });

  it("serves a noindex shell when no report exists — read-only, never generates", async () => {
    const shell = path.join(os.tmpdir(), `acreos-test-shell-${Date.now()}.html`);
    fs.writeFileSync(
      shell,
      `<html><head><title>AcreOS</title></head><body></body></html>`,
    );
    h.shellPath = shell;
    h.getExistingReport.mockResolvedValue(null);

    const res = await request(makeApp()).get("/p/tx/travis/55555");
    expect(res.status).toBe(200);
    expect(res.text).toContain('name="robots" content="noindex"');
    expect(h.getOrCreateReport).not.toHaveBeenCalled();
    fs.unlinkSync(shell);
  });

  it("renders og.png from the saved report and 404s when absent", async () => {
    h.getExistingReport.mockResolvedValue(REPORT);
    const app = makeApp();
    const png = await request(app)
      .get("/p/tx/travis/123-45-678/og.png")
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => cb(null, Buffer.concat(chunks)));
      });
    expect(png.status).toBe(200);
    expect(png.headers["content-type"]).toBe("image/png");
    // PNG magic bytes
    expect((png.body as Buffer).subarray(0, 4)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    );

    h.getExistingReport.mockResolvedValue(null);
    const missing = await request(app).get("/p/tx/travis/00000/og.png");
    expect(missing.status).toBe(404);
  });

  it("sitemap lists only reports that actually exist", async () => {
    h.listReportsForSitemap.mockResolvedValue([
      {
        state: "TX",
        countySlug: "travis",
        apn: "123-45-678",
        refreshedAt: new Date("2026-06-01T00:00:00Z"),
      },
    ]);
    const res = await request(makeApp()).get("/sitemap-reports.xml");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/xml");
    expect(res.text).toContain(
      "<loc>https://acreos.io/p/tx/travis/123-45-678</loc>",
    );
    expect(res.text).toContain("<lastmod>2026-06-01</lastmod>");
    // Exactly the one row — no fabricated coverage.
    expect((res.text.match(/<url>/g) ?? []).length).toBe(1);
  });
});
