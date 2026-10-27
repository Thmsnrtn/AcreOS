/**
 * D2c wiring (pure parts): the row difference apidStore persists, the county
 * FIPS resolver lineage depends on, and the artifact → LineageInput adapter.
 * Geometry is SYNTHETIC hand-drawn rectangles.
 */
import { describe, expect, it } from "vitest";
import { applyRelease, emptyLedger, ledgerViolations } from "@shared/landData/apid";
import type { LineageGeometry } from "@shared/landData/lineage";
import { ledgerChanges } from "../../server/services/landData/apidStore";
import { countyFipsFor, toLineageSide } from "../../server/services/landData/releases/releaseLineage";

const rect = (x0: number, y0: number, x1: number, y1: number): LineageGeometry => ({
  type: "Polygon",
  coordinates: [[[-81.5 + x0 * 1e-4, 30 + y0 * 1e-4], [-81.5 + x1 * 1e-4, 30 + y0 * 1e-4], [-81.5 + x1 * 1e-4, 30 + y1 * 1e-4], [-81.5 + x0 * 1e-4, 30 + y1 * 1e-4], [-81.5 + x0 * 1e-4, 30 + y0 * 1e-4]]],
});

describe("ledgerChanges — exactly the rows a release adds or moves", () => {
  it("first release: every APID and window is new; a split retires the parent, closes its window, mints two", () => {
    const l0 = emptyLedger("ZZ", "99001");
    const r1 = applyRelease(l0, { releaseId: "SYNTHETIC-R1", ordinal: 1 }, { previous: [], next: [{ sourceId: "SYNTHETIC-P", geometry: rect(0, 0, 10, 10) }] });
    if (!r1.ok) throw new Error(r1.detail);
    const c1 = ledgerChanges(l0, r1.ledger);
    expect(c1.newApids).toHaveLength(1);
    expect(c1.newWindows).toHaveLength(1);
    expect(c1.changedApids).toEqual([]);
    expect(c1.closedWindows).toEqual([]);

    const r2 = applyRelease(r1.ledger, { releaseId: "SYNTHETIC-R2", ordinal: 2 }, {
      previous: [{ sourceId: "SYNTHETIC-P", geometry: rect(0, 0, 10, 10) }],
      next: [
        { sourceId: "SYNTHETIC-C1", geometry: rect(0, 0, 4, 10) },
        { sourceId: "SYNTHETIC-C2", geometry: rect(4, 0, 10, 10) },
      ],
    });
    if (!r2.ok) throw new Error(r2.detail);
    expect(ledgerViolations(r2.ledger)).toEqual([]);
    const c2 = ledgerChanges(r1.ledger, r2.ledger);
    expect(c2.newApids.map((a) => a.parents)).toEqual([[c1.newApids[0].apid], [c1.newApids[0].apid]]);
    expect(c2.changedApids).toEqual([expect.objectContaining({ apid: c1.newApids[0].apid, status: "retired", endedIn: "SYNTHETIC-R2" })]);
    expect(c2.closedWindows).toEqual([expect.objectContaining({ apn: "SYNTHETIC-P", validFrom: 1, validTo: 2 })]);
    expect(c2.newWindows.map((w) => w.apn).sort()).toEqual(["SYNTHETIC-C1", "SYNTHETIC-C2"]);
  });

  it("an all-`same` release changes no row", () => {
    const l0 = emptyLedger("ZZ", "99002");
    const parcels = [{ sourceId: "SYNTHETIC-A", geometry: rect(0, 0, 10, 10) }];
    const r1 = applyRelease(l0, { releaseId: "SYNTHETIC-R1", ordinal: 1 }, { previous: [], next: parcels });
    if (!r1.ok) throw new Error(r1.detail);
    const r2 = applyRelease(r1.ledger, { releaseId: "SYNTHETIC-R2", ordinal: 2 }, { previous: parcels, next: parcels });
    if (!r2.ok) throw new Error(r2.detail);
    expect(ledgerChanges(r1.ledger, r2.ledger)).toEqual({ newApids: [], changedApids: [], newWindows: [], closedWindows: [] });
  });
});

describe("county FIPS for lineage — a reference or an honest null, never a guess", () => {
  it("resolves TN counties from the repo's TIGER county list, with or without ' County'", () => {
    expect(countyFipsFor("TN", "Davidson")).toBe("47037");
    expect(countyFipsFor("tn", "anderson county")).toBe("47001");
  });
  it("refuses a county or state the repo holds no reference for", () => {
    expect(countyFipsFor("TN", "Atlantis")).toBeNull();
    expect(countyFipsFor("NC", "Wake")).toBeNull();
  });
});

describe("artifact rows → LineageInput side", () => {
  it("keeps polygon shapes and maps anything else to null (id_only lineage)", () => {
    const side = toLineageSide([
      { source_parcel_id: "SYNTHETIC-1", geometry: rect(0, 0, 1, 1) },
      { source_parcel_id: "SYNTHETIC-2", geometry: { type: "Point", coordinates: [0, 0] } },
      { source_parcel_id: "SYNTHETIC-3", geometry: null },
    ]);
    expect(side.map((p) => [p.sourceId, p.geometry?.type ?? null])).toEqual([["SYNTHETIC-1", "Polygon"], ["SYNTHETIC-2", null], ["SYNTHETIC-3", null]]);
  });
});
