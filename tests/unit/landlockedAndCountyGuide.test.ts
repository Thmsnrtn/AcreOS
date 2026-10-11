/**
 * W3 — the landlocked checker (server/services/landlockedCheck.ts) and the
 * county guide's road-access share (server/services/publicCountyGuide.ts).
 *
 * Both state something about real land to a stranger, so both are tested on
 * the real engine output for the committed sample parcels and through the real
 * accuracy gate:
 *  - the checker answers ONLY from the gated access fact, and refuses — with
 *    the reason — when the county is not kept, the parcel id is unknown, the
 *    fact has not passed its gate, or the input is junk;
 *  - "no road" is reported as POSSIBLY landlocked, never as a legal finding;
 *  - the county share counts only facts the gate would show, and is refused
 *    below a minimum or when the gate has not passed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  ownedRow: null as any,
  pointHit: null as any,
  guide: null as any,
}));

vi.mock("../../server/db", () => ({ db: {} }));
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/services/parcel/resolveParcel", () => ({ resolveParcel: vi.fn() }));
vi.mock("../../server/services/alertSpine", () => ({ raiseAlert: vi.fn() }));
vi.mock("../../server/services/landData/ownedParcelView", async (importOriginal) => {
  const real = await importOriginal<any>();
  return { ...real, findOwnedParcelRow: vi.fn(async () => h.ownedRow) };
});
vi.mock("../../server/services/landData/ownedParcelStore", async (importOriginal) => {
  const real = await importOriginal<any>();
  return { ...real, ownedParcelAtPoint: vi.fn(async () => h.pointHit) };
});
vi.mock("../../server/services/publicCountyGuide", async (importOriginal) => {
  const real = await importOriginal<any>();
  return { ...real, getCountyGuide: vi.fn(async () => h.guide) };
});

import { checkLandlocked, LANDLOCKED_CAVEATS } from "../../server/services/landlockedCheck";
import { MIN_PARCELS_FOR_SHARE, roadAccessShare } from "../../server/services/publicCountyGuide";
import { FACT_ACCURACY } from "@shared/landData/factAccuracyGate";
import { fx, factsFor, noRoadParcelIndex, ownedRowFor, roadParcelIndex } from "../helpers/landFixtureFacts";

beforeEach(() => {
  h.ownedRow = null;
  h.pointHit = null;
  h.guide = null;
});

const savedGate = { ...FACT_ACCURACY.legal_access_indication };
afterEach(() => {
  Object.assign(FACT_ACCURACY.legal_access_indication, savedGate);
});

describe("checkLandlocked", () => {
  it("answers 'not landlocked on the map' from the gated fact for a parcel with road contact", async () => {
    const i = roadParcelIndex();
    h.ownedRow = ownedRowFor(i);
    const a = await checkLandlocked({ state: "TN", county: "DeKalb", apn: h.ownedRow.apn });
    expect(a.status).toBe("answered");
    if (a.status !== "answered") return;
    expect(a.verdict).toBe("public_road");
    expect(a.fact.status).toBe("shown");
    expect(a.fact.sources[0].retrievedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(a.caveats).toEqual([...LANDLOCKED_CAVEATS]);
    expect(a.parcel.reportPath).toBe(`/p/tn/dekalb/${encodeURIComponent(h.ownedRow.apn)}`);
  });

  it("says POSSIBLY landlocked — never a legal finding — when no road touches it", async () => {
    const i = noRoadParcelIndex();
    expect(i).toBeGreaterThanOrEqual(0);
    h.ownedRow = ownedRowFor(i);
    const a = await checkLandlocked({ state: "TN", county: "DeKalb", apn: h.ownedRow.apn });
    expect(a.status).toBe("answered");
    if (a.status !== "answered") return;
    // The sample's independent label agrees with the verdict (labels came from TIGERweb).
    expect(fx.parcels[i].labels.accessRoadWithin20m).toBe(false);
    expect(a.verdict).not.toBe("public_road");
    expect(a.headline).toMatch(/^Possibly landlocked/);
    expect(a.explanation).toMatch(/easement/);
  });

  it("refuses when the access fact has not passed its accuracy gate (adoption: follows the gate)", async () => {
    h.ownedRow = ownedRowFor(roadParcelIndex());
    Object.assign(FACT_ACCURACY.legal_access_indication, { status: "no_sample", noSampleReason: "test: withdrawn" });
    const a = await checkLandlocked({ state: "TN", county: "DeKalb", apn: h.ownedRow.apn });
    expect(a).toMatchObject({ status: "refused", reason: "fact_not_verified" });
  });

  it("refuses when the engine could not compute access for this parcel", async () => {
    const row = ownedRowFor(0);
    row.facts.legal_access_indication = { key: "legal_access_indication", status: "unavailable", value: null, confidence: null, reason: "No road layer answered.", method: "m", sources: [] };
    h.ownedRow = row;
    const a = await checkLandlocked({ state: "TN", county: "DeKalb", apn: row.apn });
    expect(a).toMatchObject({ status: "refused", reason: "fact_unavailable", message: "No road layer answered." });
  });

  it("refuses a county AcreOS has not loaded, naming it — it does not guess", async () => {
    const a = await checkLandlocked({ state: "TN", county: "Shelby", apn: "123 456" });
    expect(a.status).toBe("refused");
    if (a.status !== "refused") return;
    expect(a.reason).toBe("county_not_kept");
    expect(a.county?.label).toBe("Shelby County, TN");
    expect(a.message).toMatch(/will not guess/);
  });

  it("refuses an unknown parcel id in a kept county, pointing at the county guide", async () => {
    h.guide = { state: "TN", countySlug: "dekalb", countyLabel: "Dekalb", parcelCount: 20 };
    const a = await checkLandlocked({ state: "TN", county: "DeKalb", apn: "999 999" });
    expect(a).toMatchObject({ status: "refused", reason: "parcel_not_kept", county: { guidePath: "/land/tn/dekalb" } });
  });

  it("refuses junk input and a point with no kept parcel", async () => {
    expect(await checkLandlocked({ state: "TN", county: "DeKalb", apn: "about" })).toMatchObject({ status: "refused", reason: "bad_input" });
    expect(await checkLandlocked({ lat: 36, lng: -85.8 })).toMatchObject({ status: "refused", reason: "parcel_not_kept" });
  });
});

describe("roadAccessShare (county guide)", () => {
  const facts = fx.parcels.map((p: any) => factsFor(p).legal_access_indication);

  it("counts only gated facts and states the share with its basis", () => {
    const { share, refusal } = roadAccessShare(facts, facts.length);
    expect(refusal).toBeNull();
    expect(share!.computed).toBe(facts.length);
    expect(share!.publicRoad + share!.nonAccessOnly + share!.noRoad).toBe(share!.computed);
    // The engine's public-road count equals the independent labels' (20/20 agreed in W2).
    const labelled = fx.parcels.filter((p: any) => p.labels.accessRoadWithin20m).length;
    expect(share!.publicRoad).toBe(labelled);
    expect(share!.publicRoadPct).toBe(Math.round((labelled / facts.length) * 1000) / 10);
    expect(share!.basis).toMatch(/indication of access, not proof/);
  });

  it("a fact without a dated source is not counted (the gate's projection decides)", () => {
    const stripped = facts.map((f: any, i: number) => (i < 3 ? { ...f, sources: [] } : f));
    expect(roadAccessShare(stripped, facts.length).share!.computed).toBe(facts.length - 3);
  });

  it(`refuses below ${MIN_PARCELS_FOR_SHARE} computed facts instead of stating a noisy share`, () => {
    const r = roadAccessShare(facts.slice(0, MIN_PARCELS_FOR_SHARE - 1), 500);
    expect(r.share).toBeNull();
    expect(r.refusal).toMatch(/too few/);
  });

  it("refuses when the access fact's gate has not passed", () => {
    Object.assign(FACT_ACCURACY.legal_access_indication, { status: "no_sample" });
    const r = roadAccessShare(facts, facts.length);
    expect(r.share).toBeNull();
    expect(r.refusal).toMatch(/accuracy check/);
  });
});
