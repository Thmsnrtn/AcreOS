/**
 * W3 "Carfax for land" — the public parcel report's land facts
 * (server/services/publicParcelReport.ts publicLandFactsOf / getOrCreateReport,
 * server/services/publicLandPages.ts renderLandFactsHtml / landFactsJsonLd).
 *
 * The properties under test are the ones whose false green would publish a
 * lie on a page search engines index:
 *  1. Only facts that passed W2's accuracy gate are SHOWN, each with sources,
 *     a retrieval date and a confidence — measured on the real engine output
 *     for real sample parcels, and re-measured after flipping a gate entry
 *     (adoption: the page follows the gate, it does not copy it).
 *  2. Every other fact is "Not available" with a reason — never a number.
 *  3. The data-truth warnings travel with every report.
 *  4. Structured data names only shown facts.
 *  5. An owned parcel's report is generated through the same getOrCreateReport
 *     and refused by the same daily ceiling; it calls no county GIS.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  todayCount: 0,
  reportRows: [] as any[],
  ownedRow: null as any,
  resolveParcel: vi.fn(),
  inserts: [] as any[],
}));

vi.mock("../../server/db", () => ({
  db: {
    select: (...args: any[]) => {
      const rows = () => (args.length === 0 ? h.reportRows : "n" in (args[0] ?? {}) ? [{ n: h.todayCount }] : []);
      const chain: any = {
        from: () => chain,
        where: () => chain,
        orderBy: () => chain,
        limit: () => Promise.resolve(rows()),
        then: (res: any, rej: any) => Promise.resolve(rows()).then(res, rej),
      };
      return chain;
    },
    insert: () => ({
      values: (vals: any) => {
        h.inserts.push(vals);
        const row = { id: 1, viewCount: 0, createdAt: new Date(), refreshedAt: new Date(), ...vals };
        const after: any = { onConflictDoUpdate: () => after, returning: () => Promise.resolve([row]) };
        return after;
      },
    }),
    update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
  },
}));
vi.mock("../../server/services/parcel/resolveParcel", () => ({ resolveParcel: h.resolveParcel }));
vi.mock("../../server/services/alertSpine", () => ({ raiseAlert: vi.fn(async () => undefined) }));
vi.mock("../../server/services/autopilot/searchEngineSubmit", () => ({ submitToIndexNow: vi.fn(async () => ({ submitted: 0, reason: "test" })) }));
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/services/landData/ownedParcelView", async (importOriginal) => {
  const real = await importOriginal<any>();
  return { ...real, findOwnedParcelRow: vi.fn(async () => h.ownedRow) };
});

import {
  getOrCreateReport,
  normalizeReportKey,
  publicLandFactsOf,
  PUBLIC_REPORT_DAILY_HARD_CAP,
} from "../../server/services/publicParcelReport";
import { landFactsJsonLd, renderLandFactsHtml } from "../../server/services/publicLandPages";
import { FACT_ACCURACY } from "@shared/landData/factAccuracyGate";
import { NOT_AVAILABLE, PUBLIC_EXCLUDED_FACTS } from "@shared/landData/publicFactText";
import { PARCEL_FACT_KEYS } from "@shared/landData/parcelFacts";
import { fx, noRoadParcelIndex, ownedRowFor } from "../helpers/landFixtureFacts";

const passed = PARCEL_FACT_KEYS.filter((k) => FACT_ACCURACY[k].status === "passed" && !PUBLIC_EXCLUDED_FACTS.includes(k));

beforeEach(() => {
  h.todayCount = 0;
  h.reportRows = [];
  h.ownedRow = null;
  h.inserts = [];
  h.resolveParcel.mockReset();
  h.resolveParcel.mockResolvedValue({ results: {} });
});

describe("publicLandFactsOf — only gated facts are shown", () => {
  it("on every sample parcel, the shown facts are exactly the passed ones, each sourced, dated and rated", () => {
    expect(fx.parcels.length).toBeGreaterThan(0);
    for (let i = 0; i < fx.parcels.length; i++) {
      const land = publicLandFactsOf(ownedRowFor(i));
      const shown = land.rows.filter((r) => r.status === "shown");
      // Every passed fact either shows, or (if the engine could not compute it here) is Not available.
      for (const r of shown) {
        expect(passed, r.key).toContain(r.key);
        expect(r.sources.length, `${i} ${r.key}`).toBeGreaterThan(0);
        for (const s of r.sources) expect(s.retrievedOn, `${i} ${r.key}`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(r.confidence, `${i} ${r.key}`).toMatch(/^(high|medium|low)$/);
        expect(r.accuracy?.sampleSize, r.key).toBe(FACT_ACCURACY[r.key].sampleSize);
      }
      for (const r of land.rows.filter((x) => x.status === "not_available")) {
        expect(r.text).toBe(NOT_AVAILABLE);
        expect(r.reason, `${i} ${r.key}`).toBeTruthy();
        expect(r.confidence).toBeNull();
      }
      // A fact with no passed sample is never shown — whatever the engine computed.
      for (const k of PARCEL_FACT_KEYS.filter((k) => FACT_ACCURACY[k].status !== "passed")) {
        expect(shown.map((r) => r.key), `${i}`).not.toContain(k);
      }
      // The owner-derived fact is never even a row on a public page.
      expect(land.rows.map((r) => r.key)).not.toContain("out_of_state_owner");
      expect(land.indexable).toBe(shown.length > 0);
    }
  });

  describe("adoption: the page follows the gate", () => {
    const saved = { ...FACT_ACCURACY.public_land_adjacent };
    afterEach(() => {
      Object.assign(FACT_ACCURACY.public_land_adjacent, saved);
    });

    it("flipping a fact's gate to no_sample withdraws it from the public page", () => {
      const before = publicLandFactsOf(ownedRowFor(0)).rows.find((r) => r.key === "public_land_adjacent")!;
      expect(before.status).toBe("shown");
      Object.assign(FACT_ACCURACY.public_land_adjacent, { status: "no_sample", noSampleReason: "test: sample withdrawn" });
      const after = publicLandFactsOf(ownedRowFor(0)).rows.find((r) => r.key === "public_land_adjacent")!;
      expect(after.status).toBe("not_available");
      expect(after.text).toBe(NOT_AVAILABLE);
      expect(after.reason).toContain("accuracy sample has not passed");
    });
  });

  it("a computed fact that lost its dated source is Not available, not shown bare", () => {
    const row = ownedRowFor(0);
    row.facts.road_frontage_m = { ...row.facts.road_frontage_m, sources: [] };
    const r = publicLandFactsOf(row).rows.find((x) => x.key === "road_frontage_m")!;
    expect(r.status).toBe("not_available");
  });

  it("an engine 'unavailable' fact is Not available with the engine's reason — never estimated", () => {
    const row = ownedRowFor(0);
    row.facts.distance_to_town_km = { key: "distance_to_town_km", status: "unavailable", value: null, confidence: null, reason: "No town layer answered.", method: "m", sources: [] };
    const r = publicLandFactsOf(row).rows.find((x) => x.key === "distance_to_town_km")!;
    expect(r).toMatchObject({ status: "not_available", text: NOT_AVAILABLE, reason: "No town layer answered." });
  });

  it("carries the data-truth warnings: GIS is not a legal boundary, easements unknown", () => {
    const keys = publicLandFactsOf(ownedRowFor(noRoadParcelIndex())).truths.map((t) => t.key);
    expect(keys).toEqual(expect.arrayContaining(["gis_not_legal_boundary", "easements_unknown", "split_mineral_estate", "parcel_id_crosswalk"]));
  });
});

describe("server-rendered body and structured data", () => {
  it("the HTML a crawler reads holds every shown fact, the Not-available rows and the warnings", () => {
    const land = publicLandFactsOf(ownedRowFor(0));
    const html = renderLandFactsHtml(land);
    const escText = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    // Read each fact's OWN list item — the page's intro also says "Not
    // available", so a whole-page substring check would read the explanation
    // as the evidence.
    const itemOf = (key: string) => {
      const m = new RegExp(`<li[^>]*data-fact="${key}"[^>]*>([\\s\\S]*?)</li>`).exec(html);
      expect(m, key).not.toBeNull();
      return m![1];
    };
    expect(land.rows.some((r) => r.status === "not_available")).toBe(true);
    for (const r of land.rows) {
      const item = itemOf(r.key);
      if (r.status === "shown") {
        expect(item, r.key).toContain(escText(r.text));
        expect(item, r.key).toContain(`Confidence: ${r.confidence}`);
        expect(item, r.key).toContain(`retrieved ${r.sources[0].retrievedOn}`);
      } else {
        expect(item, r.key).toContain(">Not available<");
        expect(item, r.key).toContain(escText(r.reason!));
      }
    }
    for (const t of land.truths) expect(html).toContain(`data-truth="${t.key}"`);
    expect(html).toMatch(/sign up/i);
  });

  it("escapes data — a hostile source name cannot inject markup", () => {
    const land = publicLandFactsOf(ownedRowFor(0));
    const shown = land.rows.find((r) => r.status === "shown")!;
    shown.sources = [{ name: "<script>alert(1)</script>", url: "https://x.test/?a=1&b=\"2\"", retrievedOn: "2026-10-10" }];
    const html = renderLandFactsHtml(land);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("JSON-LD names only shown facts", () => {
    const land = publicLandFactsOf(ownedRowFor(0));
    const ld: any = landFactsJsonLd(land, "https://acreos.io/p/tn/dekalb/x");
    const names = ld.mainEntity.additionalProperty.map((p: any) => p.name);
    expect(names.sort()).toEqual(land.rows.filter((r) => r.status === "shown").map((r) => r.label).sort());
    expect(names).not.toContain("Distance to a transmission line");
  });
});

describe("owned parcels go through getOrCreateReport and its daily ceiling", () => {
  const key = () => normalizeReportKey("tn", "dekalb", ownedRowFor(0).apn)!;

  it("uses the owned row's centroid — no county GIS call — and records the owned parcel key", async () => {
    h.ownedRow = ownedRowFor(0);
    const r = await getOrCreateReport(key());
    expect(r.ok).toBe(true);
    // Exactly one upstream call: the free federal geo lookup at the centroid.
    expect(h.resolveParcel).toHaveBeenCalledTimes(1);
    const [input, opts] = h.resolveParcel.mock.calls[0];
    expect(input.type).toBe("coordinates");
    expect(opts).toMatchObject({ orgTier: "free", maxTier: "free" });
    expect(h.inserts[0].facts.parcel.ownedParcelKey).toBe(h.ownedRow.parcelKey);
  });

  it("is refused at the daily hard cap like any other new report", async () => {
    h.ownedRow = ownedRowFor(0);
    h.todayCount = PUBLIC_REPORT_DAILY_HARD_CAP;
    const r = await getOrCreateReport(key());
    expect(r).toEqual({ ok: false, reason: "daily_capacity" });
    expect(h.resolveParcel).not.toHaveBeenCalled();
    expect(h.inserts).toHaveLength(0);
  });
});
