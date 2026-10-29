/**
 * V-Tax-1 T1 — the tax-list commit, county watches and triage against a REAL
 * database built from this repository. SYNTHETIC data.
 *
 *   - every stated cell becomes an observation with its file, row, column and
 *     raw text; owner names are not copied;
 *   - an amount the list does not state is null on the lot and has no value
 *     observation — only a recorded "blank on the list";
 *   - the parcel is matched (to an AcreOS-held public-record parcel), searched
 *     with no match, or — never linked on a guess;
 *   - a county watch per county, created with no terms (unknown), once;
 *   - triage reads the matched parcel's public-record value, and the watch's
 *     stated redemption period once someone states it with a source;
 *   - another organization cannot read the watch (null → 404);
 *   - observations are append-only, and an organization holding lots is
 *     still erasable.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { realDbAvailable, useRealDb } from "../helpers/realDb";

useRealDb("taxLotCommit.realdb.test.ts");
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const tag = `t1${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const apnMatched = `SYNTH-${tag}-0001`;
const golden = readFileSync(path.join(__dirname, "../../shared/tax/golden/tax-list-golden.csv"), "utf8").replaceAll("SYNTH-T-0001", apnMatched);
const orgIds: number[] = [];
let parcelId: number | null = null;
const count = (r: unknown) => Number((r as { rows: Array<{ n: number }> }).rows[0].n);

async function commit(orgId: number) {
  const { parseDelimited, suggestColumnMapping, validateLotRows } = await import("../../server/services/taxSaleCsvImport");
  const { commitTaxLotList } = await import("../../server/services/tax/taxLotCommit");
  const sheet = parseDelimited(golden);
  const out = validateLotRows({ headers: sheet.headers, rows: sheet.rows, mapping: suggestColumnMapping(sheet.headers).mapping });
  return commitTaxLotList({ organizationId: orgId, actorUserId: `${tag}-u`, fileName: "golden.csv", fileSha256: "sha-golden", asOf: "2026-10-01", auctionId: null, lots: out.valid });
}

describe.runIf(realDbAvailable)("tax-list commit, watches and triage — real database", () => {
  beforeAll(async () => {
    const { db } = await import("../../server/db");
    const { organizations, parcelSnapshots } = await import("@shared/schema");
    const { ownedApn, OWNED_SNAPSHOT_SOURCE } = await import("../../server/services/landData/ownedParcelStore");
    for (const s of ["a", "b"]) {
      const [org] = await db.insert(organizations).values({ name: `${tag}-${s}`, slug: `${tag}-${s}`, ownerId: `${tag}-${s}` } as never).returning();
      orgIds.push(org.id);
    }
    const [p] = await db
      .insert(parcelSnapshots)
      .values({ apn: ownedApn("TX", "travis", apnMatched)!, state: "TX", county: "travis", source: OWNED_SNAPSHOT_SOURCE, organizationId: null, parcelKey: `pk-${tag}`, marketValue: "62000", rawData: { sourceName: "SYNTHETIC appraisal roll" } } as never)
      .returning({ id: parcelSnapshots.id });
    parcelId = p.id;
  });

  afterAll(async () => {
    const { db, pool } = await import("../../server/db");
    const { sql } = await import("drizzle-orm");
    for (const id of orgIds) {
      await db.execute(sql`DELETE FROM tax_sale_listings WHERE organization_id = ${id}`).catch(() => undefined);
      await db.execute(sql`DELETE FROM tax_county_watches WHERE organization_id = ${id}`).catch(() => undefined);
      await db.execute(sql`DELETE FROM organizations WHERE id = ${id}`).catch(() => undefined);
    }
    if (parcelId) await db.execute(sql`DELETE FROM parcel_snapshots WHERE id = ${parcelId}`).catch(() => undefined);
    await pool.end();
  });

  let r: Awaited<ReturnType<typeof commit>>;
  it("commits the lots with every stated cell's provenance; an unstated amount is null with only a recorded blank", async () => {
    r = await commit(orgIds[0]);
    expect(r.lots.map((l) => [l.fileRow, l.parcel])).toEqual([[2, "matched"], [3, "unmatched"], [4, "unmatched"]]);
    const { db } = await import("../../server/db");
    const { sql } = await import("drizzle-orm");
    const lot1 = r.lots[0].listingId;
    const obs = (await db.execute(sql`SELECT field, kind, value, source, source_ref, as_of::text AS as_of FROM tax_lot_observations WHERE organization_id = ${orgIds[0]} AND listing_id = ${lot1} ORDER BY field`)).rows as Array<Record<string, any>>;
    expect(obs.find((o) => o.field === "totalTaxOwed")).toMatchObject({ kind: "value", value: 481250, source: "tax_list", as_of: "2026-10-01", source_ref: { fileName: "golden.csv", fileRow: 2, column: "Amount Due", raw: "$4,812.50" } });
    expect(obs.find((o) => o.field === "delinquentYears")).toMatchObject({ value: [2022, 2023], source_ref: { raw: "2022, 2023" } });
    expect(obs.find((o) => o.field === "marketValue")).toMatchObject({ kind: "searched_none", value: null, source_ref: { column: "Market Value", raw: "" } });
    expect(obs.find((o) => o.field === "parcel.apid")).toMatchObject({ kind: "value", source: "warehouse", value: { parcelKey: `pk-${tag}`, apid: null } });
    expect(obs.some((o) => o.field === "ownerName")).toBe(false);

    const lot2 = r.lots[1].listingId;
    const [book] = (await db.execute(sql`SELECT total_tax_owed, sale_date::text AS sale_date, tax_years_delinquent FROM tax_sale_listings WHERE id = ${lot2}`)).rows as Array<Record<string, any>>;
    expect(book).toMatchObject({ total_tax_owed: null, sale_date: "2026-11-04", tax_years_delinquent: ["2021", "2022", "2023"] });
    const owed = (await db.execute(sql`SELECT kind FROM tax_lot_observations WHERE listing_id = ${lot2} AND field = 'totalTaxOwed'`)).rows as Array<{ kind: string }>;
    expect(owed).toEqual([{ kind: "searched_none" }]);
    const p2 = (await db.execute(sql`SELECT kind, source_ref FROM tax_lot_observations WHERE listing_id = ${lot2} AND field = 'parcel.apid'`)).rows as Array<Record<string, any>>;
    expect(p2).toEqual([expect.objectContaining({ kind: "searched_none", source_ref: expect.objectContaining({ reason: expect.stringMatching(/no AcreOS-held public-record parcel/) }) })]);
  });

  it("one watch per county, with no terms; a second import creates none", async () => {
    expect(r.watchesCreated).toEqual([{ state: "TX", county: "Travis" }, { state: "TX", county: "Harris" }]);
    const again = await commit(orgIds[0]);
    expect(again.watchesCreated).toEqual([]);
    const { listWatches } = await import("../../server/services/tax/taxWatches");
    const w = await listWatches(orgIds[0]);
    expect(w.map((x) => [x.county, x.lotCount, x.terms])).toEqual([["Harris", 2, {}], ["Travis", 4, {}]]);
  });

  it("triage reads the matched parcel's public-record value, and the redemption period once it is stated with a source", async () => {
    const { listWatches, buildWatchTriage, setWatchTerms } = await import("../../server/services/tax/taxWatches");
    const travis = (await listWatches(orgIds[0])).find((w) => w.county === "Travis")!;
    let t = (await buildWatchTriage(orgIds[0], travis.id))!;
    const matched = t.lots.find((l) => l.apn === apnMatched)!;
    expect(matched.facts.find((f) => f.key === "marketValue")!.state).toEqual({ status: "known", value: "$62,000.00", source: "SYNTHETIC appraisal roll" });
    expect(matched.facts.find((f) => f.key === "redemptionPeriod")!.state).toMatchObject({ status: "unknown" });
    expect(matched.facts.find((f) => f.key === "seniorLiens")!.state).toMatchObject({ status: "unknown", reason: "no lien search has been performed" });

    await setWatchTerms(orgIds[0], travis.id, { redemptionPeriodMonths: { value: 6, source: "SYNTHETIC county sale notice", asOf: "2026-09-01" } });
    t = (await buildWatchTriage(orgIds[0], travis.id))!;
    expect(t.lots.find((l) => l.apn === apnMatched)!.facts.find((f) => f.key === "redemptionPeriod")!.state).toEqual({ status: "known", value: "6 months", source: "SYNTHETIC county sale notice" });
  });

  it("another organization cannot read or change the watch", async () => {
    const { listWatches, buildWatchTriage, setWatchTerms } = await import("../../server/services/tax/taxWatches");
    const travis = (await listWatches(orgIds[0])).find((w) => w.county === "Travis")!;
    expect(await buildWatchTriage(orgIds[1], travis.id)).toBeNull();
    expect(await setWatchTerms(orgIds[1], travis.id, {})).toBeNull();
    expect(await listWatches(orgIds[1])).toEqual([]);
  });

  it("observations are append-only, and an organization holding lots is still erasable", async () => {
    const { db } = await import("../../server/db");
    const { sql } = await import("drizzle-orm");
    const id = r.lots[0].listingId;
    const codeOf = (q: Promise<unknown>) => q.then(() => null, (e: { code?: string; cause?: { code?: string } }) => e.code ?? e.cause?.code);
    expect(await codeOf(db.execute(sql`UPDATE tax_lot_observations SET field = 'x' WHERE listing_id = ${id}`))).toBe("23001");
    expect(await codeOf(db.execute(sql`DELETE FROM tax_lot_observations WHERE listing_id = ${id}`))).toBe("23503");
    expect(await codeOf(db.execute(sql`TRUNCATE tax_lot_observations`))).toBe("23001");
    const { deleteOrganization } = await import("../../server/services/orgDeletion");
    expect(await deleteOrganization(orgIds[0])).toMatchObject({ orgRowDeleted: true, residualTables: [] });
    expect(count(await db.execute(sql`SELECT count(*)::int AS n FROM tax_lot_observations WHERE organization_id = ${orgIds[0]}`))).toBe(0);
    expect(count(await db.execute(sql`SELECT count(*)::int AS n FROM tax_county_watches WHERE organization_id = ${orgIds[0]}`))).toBe(0);
  });
});
