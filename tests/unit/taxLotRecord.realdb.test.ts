/**
 * V-Tax-1 T4 — the lot's tax record against a REAL database built from this
 * repository, over HTTP. SYNTHETIC data.
 *
 *   - the list, another sale's list of the same parcel, the county's record
 *     (as the operator entered it) and the warehouse parcel each keep their
 *     value with provenance; where they differ, all are shown and the book
 *     value is named; nothing is overwritten (the book row is unchanged);
 *   - blank on the list reads differently from never stated;
 *   - a lien never searched is "unknown", and the rights stack refuses to
 *     derive a max bid from it;
 *   - a county value with the wrong type, or a future as-of, is refused;
 *   - another organization's lot is a 404, and its observations never appear.
 */
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { realDbAvailable, useRealDb } from "../helpers/realDb";

useRealDb("taxLotRecord.realdb.test.ts");

const h = vi.hoisted(() => ({ org: { id: 0 }, user: { id: "t4-user" } }));
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const tag = `t4${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const county = `Synth${tag}`;
const apn = `${tag}-7`;
const orgIds: number[] = [];
let app: express.Express;
let lotId = 0;
let siblingId = 0;
let otherOrgLotId = 0;
let parcelId = 0;
const today = new Date().toISOString().slice(0, 10);

describe.runIf(realDbAvailable)("lot tax record — real database", () => {
  beforeAll(async () => {
    const { db } = await import("../../server/db");
    const { organizations, taxSaleListings, taxLotObservations, parcelSnapshots } = await import("@shared/schema");
    for (const s of ["a", "b"]) {
      const [org] = await db.insert(organizations).values({ name: `${tag}-${s}`, slug: `${tag}-${s}`, ownerId: `${tag}-${s}` } as never).returning();
      orgIds.push(org.id);
    }
    h.org = { id: orgIds[0] };
    const [p] = await db.insert(parcelSnapshots).values({ apn, state: "TX", county, source: "owned_pipeline", organizationId: null, parcelKey: `pk-${tag}`, marketValue: "62000", assessedValue: "41000", rawData: { sourceName: "SYNTHETIC appraisal roll" } } as never).returning({ id: parcelSnapshots.id });
    parcelId = p.id;
    const listing = (org: number, saleDate: string, owed: string | null, years: string[]) =>
      ({ organizationId: org, apn, county, state: "TX", saleType: "tax_deed", saleDate, totalTaxOwed: owed, taxYearsDelinquent: years, marketValue: "55000" }) as never;
    const [l] = await db.insert(taxSaleListings).values(listing(orgIds[0], "2026-11-03", "4812.50", ["2023", "2024"])).returning({ id: taxSaleListings.id });
    const [s] = await db.insert(taxSaleListings).values(listing(orgIds[0], "2025-11-04", "2400.00", ["2023"])).returning({ id: taxSaleListings.id });
    const [o] = await db.insert(taxSaleListings).values(listing(orgIds[1], "2026-11-03", "9999.00", ["2020"])).returning({ id: taxSaleListings.id });
    lotId = l.id;
    siblingId = s.id;
    otherOrgLotId = o.id;
    const obs = (org: number, listingId: number, field: string, kind: "value" | "searched_none", value: unknown, column: string, file: string) => ({
      organizationId: org, listingId, field, kind, value: kind === "value" ? value : null, source: "tax_list", sourceRef: { fileName: file, fileRow: 2, column, raw: String(value ?? "") },
      asOf: "2026-09-01", confidence: "medium", confidenceBasis: "stated on the tax list the operator imported; not independently verified", decayClass: "months", recordedBy: "t4-user",
    }) as never;
    await db.insert(taxLotObservations).values([
      obs(orgIds[0], lotId, "totalTaxOwed", "value", 481_250, "Amount Due", "synthetic-2026.csv"),
      obs(orgIds[0], lotId, "delinquentYears", "value", [2023, 2024], "Years", "synthetic-2026.csv"),
      obs(orgIds[0], lotId, "minimumBid", "searched_none", null, "Min Bid", "synthetic-2026.csv"),
      obs(orgIds[0], siblingId, "delinquentYears", "value", [2023], "Years", "synthetic-2025.csv"),
      obs(orgIds[1], otherOrgLotId, "delinquentYears", "value", [2020], "Years", "other-org.csv"),
      { organizationId: orgIds[0], listingId: lotId, field: "parcel.apid", kind: "value", value: { parcelKey: `pk-${tag}`, apid: null, apidReason: "SYNTHETIC" }, source: "warehouse", sourceRef: { searchedFor: { apn } }, asOf: null, confidence: "high", confidenceBasis: "matched", decayClass: "years", recordedBy: "t4-user" } as never,
    ]);
    const taxResearcherRouter = (await import("../../server/routes-tax-researcher")).default;
    app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => { req.user = h.user; req.organization = h.org; req.organizationId = h.org.id; next(); });
    app.use("/api/tax-researcher", taxResearcherRouter);
  });

  afterAll(async () => {
    const { db, pool } = await import("../../server/db");
    const { sql } = await import("drizzle-orm");
    for (const id of orgIds) {
      await db.execute(sql`DELETE FROM tax_sale_listings WHERE organization_id = ${id}`).catch(() => undefined);
      await db.execute(sql`DELETE FROM organizations WHERE id = ${id}`).catch(() => undefined);
    }
    if (parcelId) await db.execute(sql`DELETE FROM parcel_snapshots WHERE id = ${parcelId}`).catch(() => undefined);
    await pool.end();
  });

  const record = async () => (await request(app).get(`/api/tax-researcher/listings/${lotId}/record`)).body.record;
  const field = (r: any, f: string) => r.fields.find((x: any) => x.field === f);

  it("each source keeps its value; another sale's list of the parcel disagrees and is shown, the book named", async () => {
    const r = await record();
    const years = field(r, "delinquentYears");
    expect(years.value).toEqual([2023, 2024]);
    expect(years.disagreement.values.map((v: any) => v.value)).toEqual([[2023, 2024], [2023]]);
    expect(years.disagreement.bookValueIs).toBe(0);
    expect(years.disagreement.values[1].observations[0]).toMatchObject({ sourceRef: { fileName: "synthetic-2025.csv", otherListingId: siblingId } });
    expect(JSON.stringify(r)).not.toContain("other-org.csv");
    expect(r.otherListings).toEqual([expect.objectContaining({ listingId: siblingId, saleDate: "2025-11-04" })]);
  });

  it("the warehouse parcel is a source too: its market value disagrees with the list's", async () => {
    const mv = field(await record(), "marketValue");
    expect(mv.value).toBe(5_500_000);
    expect(mv.disagreement.values.map((v: any) => [v.value, v.observations[0].source])).toEqual([[6_200_000, "warehouse"]]);
    expect(mv.disagreement.bookValueIs).toBeNull(); // no list observation states the book's 55,000
    expect(field(await record(), "assessedValue").disagreement.values[0]).toMatchObject({ value: 4_100_000 });
  });

  it("blank on the list is not the same as never stated", async () => {
    const r = await record();
    expect(field(r, "minimumBid").absence).toEqual({ status: "blank_on_source", column: "Min Bid", fileName: "synthetic-2026.csv" });
    expect(field(r, "assessedValue").absence).toEqual({ status: "never_stated" });
  });

  it("a county value is kept beside the list's, and the book row is not changed", async () => {
    const res = await request(app).post(`/api/tax-researcher/listings/${lotId}/county-values`).send({ field: "totalTaxOwed", kind: "value", value: 512_000, reference: "SYNTHETIC treasurer statement p.2", asOf: today });
    expect(res.status).toBe(200);
    const owed = field(res.body.record, "totalTaxOwed");
    expect(owed.value).toBe(481_250);
    expect(owed.disagreement.values.map((v: any) => [v.value, v.observations[0].source])).toEqual([[481_250, "tax_list"], [512_000, "operator_correction"]]);
    expect(owed.disagreement.values[1].observations[0].sourceRef).toEqual({ statedBy: "county_record", reference: "SYNTHETIC treasurer statement p.2" });
    const { db } = await import("../../server/db");
    const { sql } = await import("drizzle-orm");
    expect(((await db.execute(sql`SELECT total_tax_owed::text AS v FROM tax_sale_listings WHERE id = ${lotId}`)).rows[0] as any).v).toBe("4812.50");
  });

  it("a county value of the wrong type, a value on an absence, or a future as-of is refused", async () => {
    const post = (b: object) => request(app).post(`/api/tax-researcher/listings/${lotId}/county-values`).send({ reference: "SYNTHETIC", asOf: today, ...b });
    expect((await post({ field: "totalTaxOwed", kind: "value", value: "lots" })).status).toBe(422);
    expect((await post({ field: "delinquentYears", kind: "value", value: [1800] })).status).toBe(422);
    expect((await post({ field: "saleDate", kind: "value", value: "2026-02-30" })).status).toBe(422);
    expect((await post({ field: "minimumBid", kind: "searched_none", value: 5 })).status).toBe(422);
    expect((await post({ field: "minimumBid", kind: "value", value: 100, asOf: "2999-01-01" })).status).toBe(422);
  });

  it("a lien never searched is unknown — and the rights stack will not derive from it", async () => {
    const r = await record();
    expect(r.facts.find((f: any) => f.key === "seniorLiens").state).toEqual({ status: "unknown", reason: "no lien search has been performed" });
    expect(r.facts.find((f: any) => f.key === "parcelMatch").state.status).toBe("known");
    const screen = await request(app).post(`/api/tax-researcher/listings/${lotId}/max-bid/screen`).send({
      value: { status: "known", amountCents: 6_200_000, source: "SYNTHETIC", asOf: today },
      survivingLiens: { status: "unknown" },
      otherTaxes: { status: "searched_none", source: "SYNTHETIC", asOf: today },
      costs: [],
      requiredReturn: { kind: "cents", amountCents: 0 },
    });
    expect(screen.body.screen).toMatchObject({ status: "refused", missing: [{ key: "survivingLiens" }] });
  });

  it("another organization's lot is a 404 and cannot be written", async () => {
    expect((await request(app).get(`/api/tax-researcher/listings/${otherOrgLotId}/record`)).status).toBe(404);
    expect((await request(app).post(`/api/tax-researcher/listings/${otherOrgLotId}/county-values`).send({ field: "totalTaxOwed", kind: "value", value: 1, reference: "x", asOf: today })).status).toBe(404);
  });
});
