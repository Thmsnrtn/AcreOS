/**
 * D1 amendment A5 — the FL golden county harness.
 *
 * Reads tests/fixtures/golden/fl-golden-county.json. Every VERIFIED parcel's
 * sourceAttributes (the FDOR layer's own response for it) are normalized and
 * each assessor-verified value is asserted against the normalizer's output —
 * so a mapping change that moves a real parcel's value off its ground truth
 * goes red in CI.
 *
 * Today the set holds five honest pending slots (the build container could
 * not reach the FDOR or county hosts): the harness asserts that the file says
 * so — "pending_verification", 0 of 5 — rather than passing as if a golden
 * county existed. The comparator itself is proven on an in-test entry whose
 * values are synthetic and labelled so, including a deliberate mismatch.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../server/db", () => ({ db: {} }));
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { fetchFlCounty } from "../../server/services/landData/flStatewideCadastral";
import { STATEWIDE_PARCEL_ENDPOINTS } from "../../server/services/statewideParcelEndpoints";

const MAPPED = Object.values(STATEWIDE_PARCEL_ENDPOINTS.find((e) => e.state === "FL")!.fieldMappings).filter((f): f is string => !!f);

/**
 * Run one parcel's recorded layer attributes through the SAME path the job
 * uses (fetchFlCounty): a one-feature layer carrying exactly those attributes.
 * The only synthetic parts are the object id and the county filter field the
 * harness pages by — neither is compared.
 */
async function normalizeThroughPipeline(attrs: Record<string, unknown>) {
  const props = { ...attrs, OBJECTID: 1, GOLDEN_COUNTY: "GOLDEN" };
  const fields = Array.from(new Set(["OBJECTID", "GOLDEN_COUNTY", ...MAPPED, ...Object.keys(attrs)]));
  const { records } = await fetchFlCounty(
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
  );
  return records[0] ?? null;
}

interface GoldenParcel {
  slot: number;
  sourceParcelId: string | null;
  sourceAttributes: Record<string, unknown> | null;
  assessorVerified: Partial<Record<"ownerName" | "situsAddress" | "assessedValueUsd" | "marketValueUsd" | "lastSalePriceUsd", string | number>> | null;
  verifiedBy: string | null;
  verifiedOn: string | null;
  assessorRecordUrl: string | null;
}

interface GoldenCounty {
  state: string;
  county: string | null;
  status: "pending_verification" | "established";
  parcels: GoldenParcel[];
}

const GOLDEN_SIZE = 5;
const golden = JSON.parse(
  readFileSync(path.join(__dirname, "../fixtures/golden/fl-golden-county.json"), "utf8"),
) as GoldenCounty;

const isVerified = (p: GoldenParcel) =>
  p.sourceParcelId !== null &&
  p.sourceAttributes !== null &&
  p.assessorVerified !== null &&
  Object.keys(p.assessorVerified).length > 0 &&
  !!p.verifiedBy &&
  /^\d{4}-\d{2}-\d{2}$/.test(p.verifiedOn ?? "") &&
  /^https:\/\//.test(p.assessorRecordUrl ?? "");

/** Field-by-field mismatches between the normalizer and the assessor's record. */
async function goldenMismatches(p: GoldenParcel): Promise<string[]> {
  const rec = await normalizeThroughPipeline(p.sourceAttributes ?? {});
  if (!rec) return ["normalizer refused the parcel (no id)"];
  const got: Record<string, string | number | null> = {
    ownerName: rec.ownership.ownerName,
    situsAddress: rec.ownership.situsAddress,
    assessedValueUsd: rec.tax.assessedValueUsd,
    marketValueUsd: rec.valuation.marketValueUsd,
    lastSalePriceUsd: rec.sale.lastSalePriceUsd,
  };
  const out: string[] = [];
  if (rec.identity.sourceParcelId !== p.sourceParcelId) out.push(`parcel id ${rec.identity.sourceParcelId} != ${p.sourceParcelId}`);
  for (const [k, want] of Object.entries(p.assessorVerified ?? {})) {
    if (got[k] !== want) out.push(`${k}: normalizer ${JSON.stringify(got[k])} != assessor ${JSON.stringify(want)}`);
  }
  return out;
}

describe("FL golden county (A5)", () => {
  it("holds exactly five slots", () => {
    expect(golden.state).toBe("FL");
    expect(golden.parcels.map((p) => p.slot)).toEqual([1, 2, 3, 4, 5]);
  });

  it("its status is honest: 'established' only when all five are assessor-verified", () => {
    const verified = golden.parcels.filter(isVerified).length;
    expect(golden.status).toBe(verified === GOLDEN_SIZE ? "established" : "pending_verification");
    if (golden.status === "established") expect(golden.county).toBeTruthy();
  });

  it("a slot is either fully verified or fully empty — never half-filled", () => {
    for (const p of golden.parcels) {
      const empty = [p.sourceParcelId, p.sourceAttributes, p.assessorVerified, p.verifiedBy, p.verifiedOn, p.assessorRecordUrl].every((v) => v === null);
      expect(isVerified(p) || empty, `slot ${p.slot}`).toBe(true);
    }
  });

  it("every verified parcel normalizes to its assessor-verified values", async () => {
    for (const p of golden.parcels.filter(isVerified)) expect(await goldenMismatches(p), `slot ${p.slot}`).toEqual([]);
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
    expect(await goldenMismatches(synthetic)).toEqual([]);
    expect(await goldenMismatches({ ...synthetic, assessorVerified: { marketValueUsd: 124_999 } })).toEqual([
      "marketValueUsd: normalizer 125000 != assessor 124999",
    ]);
  });
});
