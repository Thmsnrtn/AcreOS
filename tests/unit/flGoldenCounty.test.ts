/**
 * D1 amendment A5 — the FL golden county harness.
 *
 * Reads the golden set from shared/landData/golden/fl-golden-county.json (the
 * same production data the D2d self-healing adapter verifies remaps against).
 * Every VERIFIED parcel's sourceAttributes (the FDOR layer's own response for
 * it) are normalized through the streamed build (streamCounty) and each
 * assessor-verified value is asserted against the normalizer's output, so a
 * mapping change that moves a real parcel off its ground truth goes red in CI.
 *
 * The comparator is shared/landData/goldenCounty.ts; it is proven here on an
 * in-test entry whose values are synthetic and labelled so, including a
 * deliberate mismatch.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../server/db", () => ({ db: {} }));
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { buildSpecFor, streamCounty } from "../../server/services/landData/statewideCadastral";
import type { BulkParcelRecord } from "../../shared/landData/bulkParcelRecord";
import { goldenCountyFor, goldenMismatches, isVerifiedParcel, verifiedParcels, type GoldenParcel } from "../../shared/landData/goldenCounty";

const FL_SPEC = buildSpecFor("FL");
const MAPPED = Object.values(FL_SPEC.mapping).filter((f): f is string => !!f);

/**
 * Run one parcel's recorded layer attributes through the SAME path the job
 * uses (streamCounty, the D2a streamed build): a one-feature layer carrying
 * exactly those attributes. The only synthetic parts are the object id and the
 * county filter field the harness pages by — neither is compared.
 */
async function normalizeThroughPipeline(attrs: Record<string, unknown>): Promise<BulkParcelRecord | null> {
  const props = { ...attrs, OBJECTID: 1, GOLDEN_COUNTY: "GOLDEN" };
  const fields = Array.from(new Set(["OBJECTID", "GOLDEN_COUNTY", ...MAPPED, ...Object.keys(attrs)]));
  const records: BulkParcelRecord[] = [];
  await streamCounty(
    FL_SPEC,
    { countyField: "GOLDEN_COUNTY", countyValue: "GOLDEN" },
    {
      async getJson(url) {
        if (url.endsWith("?f=json")) {
          return { ok: true, status: 200, body: { objectIdField: "OBJECTID", fields: fields.map((name) => ({ name, type: "esriFieldTypeString" })) } };
        }
        const done = /OBJECTID > 1/.test(decodeURIComponent(url.replace(/\+/g, " ")));
        return { ok: true, status: 200, body: { features: done ? [] : [{ geometry: null, properties: props }] } };
      },
    },
    async (r) => {
      records.push(r);
    },
  );
  return records[0] ?? null;
}

const golden = goldenCountyFor("FL")!;

describe("FL golden county (A5)", () => {
  it("holds exactly five slots", () => {
    expect(golden.state).toBe("FL");
    expect(golden.parcels.map((p) => p.slot)).toEqual([1, 2, 3, 4, 5]);
  });

  it("its status is honest: 'established' only when all five are assessor-verified", () => {
    const verified = golden.parcels.filter(isVerifiedParcel).length;
    expect(golden.status).toBe(verified === 5 ? "established" : "pending_verification");
    if (golden.status === "established") expect(golden.county).toBeTruthy();
  });

  it("FALSIFICATION: a file marked established with fewer than five verified parcels yields no ground truth", () => {
    expect(verifiedParcels(golden).length).toBe(golden.status === "established" ? 5 : 0);
    const short = { ...golden, status: "established" as const, parcels: golden.parcels.slice(0, 4) };
    expect(verifiedParcels(short)).toEqual([]);
  });

  it("FALSIFICATION: five verified slots holding only four DISTINCT parcels yield no ground truth", () => {
    const dup = { ...golden, status: "established" as const, parcels: [...golden.parcels.slice(0, 4), { ...golden.parcels[3], slot: 5 }] };
    expect(dup.parcels.filter(isVerifiedParcel)).toHaveLength(5);
    expect(verifiedParcels(dup)).toEqual([]);
  });

  it("a slot is either fully verified or fully empty — never half-filled", () => {
    for (const p of golden.parcels) {
      const empty = [p.sourceParcelId, p.sourceAttributes, p.assessorVerified, p.verifiedBy, p.verifiedOn, p.assessorRecordUrl].every((v) => v === null);
      expect(isVerifiedParcel(p) || empty, `slot ${p.slot}`).toBe(true);
    }
  });

  it("every verified parcel normalizes to its assessor-verified values", async () => {
    for (const p of golden.parcels.filter(isVerifiedParcel)) {
      expect(goldenMismatches(p, await normalizeThroughPipeline(p.sourceAttributes ?? {})), `slot ${p.slot}`).toEqual([]);
    }
  });

  it("the comparator catches a mismatch (synthetic entry, labelled — not Florida data)", async () => {
    const synthetic: GoldenParcel = {
      slot: 0,
      sourceParcelId: "SYNTHETIC-1",
      sourceAttributes: { PARCEL_ID: "SYNTHETIC-1", JV: 125_000, AV_NSD: 90_000, OWN_NAME: "SYNTHETIC OWNER" },
      assessorVerified: { marketValueUsd: 125_000, assessedValueUsd: 90_000, ownerName: "SYNTHETIC OWNER" },
      verifiedBy: "synthetic",
      verifiedOn: "2026-10-22",
      assessorRecordUrl: "https://example.invalid/synthetic",
    };
    const rec = await normalizeThroughPipeline(synthetic.sourceAttributes ?? {});
    expect(goldenMismatches(synthetic, rec)).toEqual([]);
    expect(goldenMismatches({ ...synthetic, assessorVerified: { marketValueUsd: 124_999 } }, rec)).toEqual(["marketValueUsd: normalizer 125000 != assessor 124999"]);
  });
});
