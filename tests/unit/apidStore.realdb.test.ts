/**
 * D2c — the APID store against a REAL database built from this repository
 * (migration 0291): a first release mints, a re-apply is a no-op, a split
 * retires the parent, closes its window and mints two children whose lineage
 * event is stored; the reloaded ledger is sound; the one-open-window index and
 * the append-only events trigger hold in the database itself.
 * Every run uses its own synthetic county scope (state ZZ, a random FIPS) and
 * SYNTHETIC rectangles — no real parcel.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { realDbAvailable, useRealDb } from "../helpers/realDb";
import type { LineageGeometry } from "@shared/landData/lineage";

useRealDb("apidStore.realdb.test.ts");

vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const fips = String(90000 + Math.floor(Math.random() * 9999)).padStart(5, "0");
const rect = (x0: number, y0: number, x1: number, y1: number): LineageGeometry => ({
  type: "Polygon",
  coordinates: [[[-81.5 + x0 * 1e-4, 30 + y0 * 1e-4], [-81.5 + x1 * 1e-4, 30 + y0 * 1e-4], [-81.5 + x1 * 1e-4, 30 + y1 * 1e-4], [-81.5 + x0 * 1e-4, 30 + y1 * 1e-4], [-81.5 + x0 * 1e-4, 30 + y0 * 1e-4]]],
});
const parent = [{ sourceId: "SYNTHETIC-P", geometry: rect(0, 0, 10, 10) }];
const children = [
  { sourceId: "SYNTHETIC-C1", geometry: rect(0, 0, 4, 10) },
  { sourceId: "SYNTHETIC-C2", geometry: rect(4, 0, 10, 10) },
];

describe.runIf(realDbAvailable)("APID store — real database", () => {
  afterAll(async () => {
    const { pool } = await import("../../server/db");
    await pool.end();
  });

  it("first release mints; re-applying it is a no-op", async () => {
    const { applyCountyRelease } = await import("../../server/services/landData/apidStore");
    const r1 = await applyCountyRelease({ state: "ZZ", countyFips: fips, release: { releaseId: "SYNTHETIC-R1", ordinal: 1 }, input: { previous: [], next: parent } });
    expect(r1).toMatchObject({ status: "applied", minted: 1 });
    const again = await applyCountyRelease({ state: "ZZ", countyFips: fips, release: { releaseId: "SYNTHETIC-R1", ordinal: 1 }, input: { previous: [], next: parent } });
    expect(again.status).toBe("already_applied");
  });

  it("a split retires the parent, mints two children, stores the event, and the reloaded ledger is sound", async () => {
    const { applyCountyRelease, loadCountyLedger } = await import("../../server/services/landData/apidStore");
    const { ledgerViolations } = await import("@shared/landData/apid");
    const { db } = await import("../../server/db");
    const { sql } = await import("drizzle-orm");
    const r2 = await applyCountyRelease({ state: "ZZ", countyFips: fips, release: { releaseId: "SYNTHETIC-R2", ordinal: 2 }, input: { previous: parent, next: children } });
    expect(r2).toMatchObject({ status: "applied", minted: 2, retiredOrHeld: 1, events: 1 });
    const ledger = await db.transaction((tx) => loadCountyLedger(tx as never, "ZZ", fips));
    expect(ledgerViolations(ledger)).toEqual([]);
    expect(ledger.lastRelease).toEqual({ releaseId: "SYNTHETIC-R2", ordinal: 2 });
    expect(Object.values(ledger.apids).filter((a) => a.status === "active")).toHaveLength(2);
    const ev = await db.execute(sql`SELECT kind, previous_apns, next_apns, cardinality(previous_apids) AS p FROM parcel_lineage_events WHERE county_fips = ${fips} AND release_id = 'SYNTHETIC-R2'`);
    expect((ev as unknown as { rows: Array<{ kind: string; p: number }> }).rows).toEqual([expect.objectContaining({ kind: "split", p: 1 })]);
    // A release out of order is refused, not applied.
    const stale = await applyCountyRelease({ state: "ZZ", countyFips: fips, release: { releaseId: "SYNTHETIC-R0", ordinal: 1 }, input: { previous: children, next: children } });
    expect(stale).toMatchObject({ status: "refused", reason: "release_not_after_last" });
  });

  it("the database itself refuses a second open window for an APN and any edit to a lineage event", async () => {
    const { db } = await import("../../server/db");
    const { sql } = await import("drizzle-orm");
    // One probe per index, each built to pass the OTHER index: the open
    // child's APN on the RETIRED parent APID (which has no open window) hits
    // only the per-APN index; the open child's APID under a fresh APN hits only
    // the per-APID index. A copied row would be refused by either and prove neither.
    const codeOf = (q: Promise<unknown>) => q.then(() => null, (e: { code?: string; cause?: { code?: string } }) => e.code ?? e.cause?.code);
    const sameApn = await codeOf(db.execute(sql`INSERT INTO parcel_apn_windows (apid_id, state, county_fips, apn, valid_from, valid_from_release)
        SELECT p.id, w.state, w.county_fips, w.apn, 99, 'SYNTHETIC-X'
        FROM parcel_apn_windows w JOIN parcel_apids p ON p.county_fips = w.county_fips AND p.status = 'retired'
        WHERE w.county_fips = ${fips} AND w.valid_to IS NULL LIMIT 1`));
    expect(sameApn).toBe("23505");
    const sameApid = await codeOf(db.execute(sql`INSERT INTO parcel_apn_windows (apid_id, state, county_fips, apn, valid_from, valid_from_release)
        SELECT apid_id, state, county_fips, 'SYNTHETIC-OTHER-APN', 99, 'SYNTHETIC-X' FROM parcel_apn_windows WHERE county_fips = ${fips} AND valid_to IS NULL LIMIT 1`));
    expect(sameApid).toBe("23505");
    const edit = await codeOf(db.execute(sql`UPDATE parcel_lineage_events SET reason = 'x' WHERE county_fips = ${fips}`));
    expect(edit).toBe("23001");
  });
});
