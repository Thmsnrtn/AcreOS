/**
 * Field-level data serving (I-6) — what this suite pins, and why.
 *
 * The lookup gate used to answer one boolean per source while the dominant
 * real-world determination is "permitted with conditions" — so partial
 * clearances converted to dead ends. This suite pins the replacement:
 *
 *  1. THE REGISTRY IS A TRANSCRIPTION, PINNED EXACTLY. Every record's
 *     servable field groups and the load-bearing class statuses are pinned
 *     below, per county, from the dossier program's written determinations
 *     (display-green compilation 2026-11-12; sweep (e) §2c). Widening a mask
 *     bit or a class in the registry without changing this pin — i.e.
 *     without a new written determination — fails here.
 *  2. FAIL-CLOSED EVERYWHERE. No record → no fields. A prohibited or
 *     unresolved surface class → no fields on that surface (Los Angeles
 *     answers on display and stays dark for paid lookup). Paulding's GIS
 *     Division object is not the Assessor object and gets nothing.
 *  3. SERVE-WITH-MASK. A full parcel masked by a limited county's answer
 *     returns EXACTLY the cleared groups: Union GA geometry only; Sacramento
 *     geometry + attributes with owner groups stripped; Ferry (no geometry
 *     in its answer) serves no parcel at all.
 *  4. THE PASSPORT ASSEMBLES PARTIALLY. Given a field-level answer it
 *     contains the cleared layers, is marked partial with the determination's
 *     evidence, carries the source identifier only when identifiers are
 *     served, and names one ignorance entry per withheld field group. With
 *     no answer — or a zero-group answer — the refusal is the old one.
 *  5. THE LIVE POSTURE DID NOT MOVE. No statewide entry is cleared for
 *     lookup, and the statewide field answer for every real (gated) entry
 *     serves zero groups. These records are determinations, DRAFT for
 *     attorney review — not live clearances.
 */
import { describe, expect, it } from "vitest";
import {
  PARCEL_FIELD_GROUPS,
  fieldClearanceAnswer,
  type FieldClearanceRecord,
  type ParcelFieldGroup,
} from "@shared/openData/fieldClearance";
import {
  FIELD_CLEARANCE_REGISTRY,
  fieldClearanceFor,
  fieldClearanceRecordFor,
} from "../../server/services/openData/fieldClearanceRegistry";
import {
  isClearedForLookup,
  statewideFieldAnswer,
  statewideSource,
  type StatewideSourceEntry,
} from "../../server/services/openData/statewideSourceRegistry";
import { maskParcelLookupResult } from "../../server/services/openData/fieldMasking";
import type { ParcelLookupResult } from "../../server/services/parcel";
import { assemblePropertyPassport, type PassportParcelRef } from "../../server/services/landData/propertyPassport";
import { unavailable, type ParcelFactSet } from "@shared/landData/parcelFacts";

const ALL: ParcelFieldGroup[] = ["geometry", "identifiers", "assessment", "situs", "ownerName", "ownerMailing"];
const NO_OWNER: ParcelFieldGroup[] = ["geometry", "identifiers", "assessment", "situs"];

/** The pinned transcription: county → servable field groups (registry order is PARCEL_FIELD_GROUPS order). */
const EXPECTED_COUNTY_FIELDS: Record<string, ParcelFieldGroup[]> = {
  "TX:Harris": ALL,
  "IN:Delaware": ALL,
  "GA:Madison": ALL,
  "GA:Paulding": ALL,
  "CA:Sacramento": NO_OWNER,
  "IL:DuPage": ["geometry", "identifiers", "assessment", "situs", "ownerName"],
  "CA:Los Angeles": NO_OWNER,
  "CA:San Francisco": NO_OWNER,
  "IL:Hamilton": ALL,
  "KY:McCracken": ALL,
  "IL:Shelby": ALL,
  "GA:Union": ["geometry"],
  "WA:Ferry": ["identifiers", "assessment"],
  "WA:Grays Harbor": NO_OWNER,
};

const EXPECTED_STATE_FIELDS: Record<string, ParcelFieldGroup[]> = {
  WI: ALL,
  MA: ALL,
  CT: ALL,
  MS: ALL,
  DE: ["identifiers", "assessment"],
  UT: NO_OWNER,
  CO: ALL,
  MN: ALL,
  AR: ALL,
};

const rec = (state: string, county: string, objectKey?: string): FieldClearanceRecord => {
  const r = fieldClearanceRecordFor(state, county, objectKey);
  if (!r) throw new Error(`fixture precondition: a record must exist for ${state}:${county}`);
  return r;
};

describe("1. the registry is a pinned transcription of written determinations", () => {
  it("holds exactly the 14 written-green counties plus the 9 state objects", () => {
    const counties = FIELD_CLEARANCE_REGISTRY.filter((r) => r.county !== "*");
    const states = FIELD_CLEARANCE_REGISTRY.filter((r) => r.county === "*");
    expect(counties).toHaveLength(14);
    expect(states).toHaveLength(9);
    expect(Object.keys(EXPECTED_COUNTY_FIELDS).sort()).toEqual(counties.map((r) => `${r.state}:${r.county}`).sort());
    expect(Object.keys(EXPECTED_STATE_FIELDS).sort()).toEqual(states.map((r) => r.state).sort());
  });

  it("every record is DRAFT, evidence-carrying, and fully classed", () => {
    for (const r of FIELD_CLEARANCE_REGISTRY) {
      expect(r.posture, `${r.state}:${r.county}`).toBe("draft_for_attorney_review");
      expect(r.evidence.trim().length, `${r.state}:${r.county} evidence`).toBeGreaterThan(0);
      expect(r.evidenceSource.trim().length, `${r.state}:${r.county} source`).toBeGreaterThan(0);
      expect(r.recordedOn, `${r.state}:${r.county} date`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Object.keys(r.classes).sort()).toEqual(["display", "internal", "lookupDisplay", "redistribution", "resale"]);
      for (const f of r.servableFields) expect(PARCEL_FIELD_GROUPS).toContain(f);
    }
  });

  it("pins each county's servable field groups exactly — widening a bit fails here", () => {
    for (const [key, fields] of Object.entries(EXPECTED_COUNTY_FIELDS)) {
      const [state, county] = key.split(":");
      expect(rec(state, county).servableFields, key).toEqual(fields);
    }
    for (const [state, fields] of Object.entries(EXPECTED_STATE_FIELDS)) {
      expect(rec(state, "*").servableFields, state).toEqual(fields);
    }
  });

  it("pins the load-bearing class statuses", () => {
    expect(rec("CA", "Los Angeles").classes).toMatchObject({ display: "permitted_with_conditions", resale: "unresolved", lookupDisplay: "unresolved" });
    expect(rec("IL", "Hamilton").classes).toMatchObject({ redistribution: "prohibited", internal: "unresolved", display: "permitted" });
    expect(rec("KY", "McCracken").classes).toMatchObject({ redistribution: "prohibited", resale: "permitted" });
    expect(rec("IL", "DuPage").classes).toMatchObject({ resale: "unresolved", redistribution: "permitted" });
    expect(rec("AR", "*").classes).toMatchObject({ display: "permitted_with_conditions", lookupDisplay: "unresolved" });
    expect(rec("CO", "*").classes).toMatchObject({ redistribution: "prohibited" });
    expect(rec("IL", "Shelby").classes).toMatchObject({ internal: "unresolved" });
  });

  it("the field-level math: 14 of 14 counties serve something on display; 13 of 14 on paid lookup (LA stays dark)", () => {
    const counties = FIELD_CLEARANCE_REGISTRY.filter((r) => r.county !== "*");
    for (const r of counties) {
      expect(fieldClearanceAnswer(r, "display").servableFields.length, `${r.state}:${r.county} display`).toBeGreaterThan(0);
    }
    const lookupServable = counties.filter((r) => fieldClearanceAnswer(r, "lookupDisplay").servableFields.length > 0);
    expect(lookupServable).toHaveLength(13);
    expect(fieldClearanceAnswer(rec("CA", "Los Angeles"), "lookupDisplay").servableFields).toEqual([]);
  });
});

describe("2. fail-closed: no determination, no fields — on any surface", () => {
  it("an unknown county answers with zero fields and no basis", () => {
    const a = fieldClearanceFor("GA", "Nonexistent", "display");
    expect(a.servableFields).toEqual([]);
    expect(a.basis).toBeNull();
    expect(a.withheldFields).toHaveLength(PARCEL_FIELD_GROUPS.length);
  });

  it("Paulding: the GIS Division object is not the Assessor object", () => {
    expect(fieldClearanceRecordFor("GA", "Paulding", "gis-division")).toBeUndefined();
    expect(fieldClearanceFor("GA", "Paulding", "display", "gis-division").servableFields).toEqual([]);
    expect(fieldClearanceFor("GA", "Paulding", "display", "assessors").servableFields).toEqual(ALL);
    // No object named: the county's one record answers, carrying its scope.
    expect(fieldClearanceFor("GA", "Paulding", "display").basis?.objectScope).toContain("Assessors");
  });

  it("a prohibited class serves nothing on that surface even when fields are transcribed", () => {
    const a = fieldClearanceAnswer(rec("IL", "Hamilton"), "redistribution");
    expect(a.servableFields).toEqual([]);
    expect(a.withheldFields[0].why).toContain("prohibits");
  });

  it("county matching is exact — no neighbouring-county or suffix inference", () => {
    expect(fieldClearanceRecordFor("GA", "Union County")).toBeDefined();
    expect(fieldClearanceRecordFor("GA", "union")).toBeDefined();
    expect(fieldClearanceRecordFor("SC", "Union")).toBeUndefined();
    expect(fieldClearanceRecordFor("GA", "Uni")).toBeUndefined();
  });
});

function fullParcel(): ParcelLookupResult {
  return {
    found: true,
    source: "county_gis",
    parcel: {
      apn: "APN-123",
      boundary: { type: "Polygon", coordinates: [[[0, 0], [0, 1], [1, 1], [0, 0]]] },
      centroid: { lat: 0.5, lng: 0.5 },
      data: {
        regridId: "RID-1",
        owner: "JANE OWNER",
        ownerAddress: "1 MAILING WAY",
        taxAmount: "1234",
        lastUpdated: "2026-11-01T00:00:00.000Z",
        acres: 2.5,
        county: "Union",
        state: "GA",
        assessedValue: 50000,
        marketValue: 60000,
        taxStatus: "current",
        lastSalePrice: 40000,
        lastSaleDate: "2020-01-01",
      },
    },
  };
}

describe("3. serve-with-mask: a limited county serves exactly its cleared fields", () => {
  it("Union GA (geometry only): boundary + centroid survive; every attribute group is stripped", () => {
    const masked = maskParcelLookupResult(fullParcel(), fieldClearanceFor("GA", "Union", "lookupDisplay", "gis-geometry"));
    expect(masked.found).toBe(true);
    expect(masked.parcel?.boundary.coordinates).toEqual([[[0, 0], [0, 1], [1, 1], [0, 0]]]);
    expect(masked.parcel?.centroid).toEqual({ lat: 0.5, lng: 0.5 });
    expect(masked.parcel?.apn).toBe("");
    expect(masked.parcel?.data.owner).toBeNull();
    expect(masked.parcel?.data.ownerAddress).toBe("");
    expect(masked.parcel?.data.taxAmount).toBe("");
    expect(masked.parcel?.data.acres).toBeUndefined();
    expect(masked.parcel?.data.assessedValue).toBeUndefined();
    expect(masked.parcel?.data.lastSalePrice).toBeUndefined();
    expect(masked.parcel?.data.county).toBeUndefined();
    expect(masked.parcel?.data.state).toBeUndefined();
  });

  it("Sacramento CA: geometry + attributes served, owner groups absent", () => {
    const masked = maskParcelLookupResult(fullParcel(), fieldClearanceFor("CA", "Sacramento", "lookupDisplay"));
    expect(masked.found).toBe(true);
    expect(masked.parcel?.apn).toBe("APN-123");
    expect(masked.parcel?.data.taxAmount).toBe("1234");
    expect(masked.parcel?.data.acres).toBe(2.5);
    expect(masked.parcel?.data.county).toBe("Union");
    expect(masked.parcel?.data.owner).toBeNull();
    expect(masked.parcel?.data.ownerAddress).toBe("");
  });

  it("Harris TX (untrimmed): the mask is the identity", () => {
    const parcel = fullParcel();
    expect(maskParcelLookupResult(parcel, fieldClearanceFor("TX", "Harris", "lookupDisplay"))).toEqual(parcel);
  });

  it("Ferry WA (identifiers + assessment, no geometry): no parcel is served at all", () => {
    const masked = maskParcelLookupResult(fullParcel(), fieldClearanceFor("WA", "Ferry", "lookupDisplay", "free-shapefile"));
    expect(masked.found).toBe(false);
    expect(masked.parcel).toBeUndefined();
  });

  it("an answer with no record masks everything away", () => {
    const masked = maskParcelLookupResult(fullParcel(), fieldClearanceFor("GA", "Nonexistent", "lookupDisplay"));
    expect(masked.found).toBe(false);
  });
});

describe("5. the live gate posture did not move", () => {
  it("no statewide entry is cleared for lookup, and every real entry's field answer is empty", () => {
    for (const state of ["FL", "MT", "NC", "WA", "NJ", "AR", "NY", "WI", "MD"]) {
      const entry = statewideSource(state);
      expect(entry, state).toBeDefined();
      expect(isClearedForLookup(entry), state).toBe(false);
      expect(statewideFieldAnswer(entry, "lookupDisplay").servableFields, state).toEqual([]);
    }
    expect(statewideFieldAnswer(undefined, "display").servableFields).toEqual([]);
  });

  it("a cleared entry with a trimmed mask answers per-field (the reviewed-clearance shape)", () => {
    const base = statewideSource("WI");
    if (!base) throw new Error("fixture precondition: WI entry must exist");
    const trimmed: StatewideSourceEntry = {
      ...base,
      lookup: {
        status: "cleared",
        determination: "FIXTURE DETERMINATION",
        evidence: "FIXTURE EVIDENCE",
        evidenceUrl: "https://example.invalid/fixture",
        decidedOn: "2026-11-12",
        servableFields: ["geometry", "identifiers"],
      },
    };
    const a = statewideFieldAnswer(trimmed, "lookupDisplay");
    expect(a.servableFields).toEqual(["geometry", "identifiers"]);
    expect(a.withheldFields.map((w) => w.field)).toEqual(["assessment", "situs", "ownerName", "ownerMailing"]);
    const masked = maskParcelLookupResult(fullParcel(), a);
    expect(masked.parcel?.apn).toBe("APN-123");
    expect(masked.parcel?.data.owner).toBeNull();
    expect(masked.parcel?.data.taxAmount).toBe("");
  });

  it("a cleared entry naming no mask serves every group (cleared as published)", () => {
    const base = statewideSource("WI");
    if (!base) throw new Error("fixture precondition: WI entry must exist");
    const full: StatewideSourceEntry = {
      ...base,
      lookup: {
        status: "cleared",
        determination: "FIXTURE DETERMINATION",
        evidence: "FIXTURE EVIDENCE",
        evidenceUrl: "https://example.invalid/fixture",
        decidedOn: "2026-11-12",
      },
    };
    expect(statewideFieldAnswer(full, "lookupDisplay").servableFields).toEqual([...PARCEL_FIELD_GROUPS]);
  });
});

function factSet(): ParcelFactSet {
  const reason = "FIXTURE REASON";
  return {
    road_frontage_m: unavailable("road_frontage_m", reason, "FIXTURE METHOD"),
    legal_access_indication: unavailable("legal_access_indication", reason, "FIXTURE METHOD"),
    buildable_acres: unavailable("buildable_acres", reason, "FIXTURE METHOD"),
    public_land_adjacent: unavailable("public_land_adjacent", reason, "FIXTURE METHOD"),
    distance_to_transmission_km: unavailable("distance_to_transmission_km", reason, "FIXTURE METHOD"),
    distance_to_town_km: unavailable("distance_to_town_km", reason, "FIXTURE METHOD"),
    out_of_state_owner: unavailable("out_of_state_owner", reason, "FIXTURE METHOD"),
  };
}

const LAYERS = { physical: null, legalDistress: null, contextTrajectory: null };

describe("4. the passport consumes the field-level answer", () => {
  it("Union GA: partial assembly — geometry layer in, five withheld groups named, identifier withheld", () => {
    const ref: PassportParcelRef = { apid: "GA-131-000001", parcelKey: "GA:Union:000001", state: "GA", county: "Union", sourceParcelId: "UNION-APN-1" };
    const result = assemblePropertyPassport(
      ref,
      statewideSource("GA"),
      { physical: factSet(), legalDistress: null, contextTrajectory: null },
      fieldClearanceFor("GA", "Union", "display", "gis-geometry"),
    );
    expect(result.status).toBe("assembled");
    if (result.status !== "assembled") return;
    const p = result.passport;
    expect(p.partial).toBe(true);
    expect(p.gate).toBeNull();
    expect(p.fieldClearance?.servedFieldGroups).toEqual(["geometry"]);
    expect(p.fieldClearance?.withheldFieldGroups).toEqual(["identifiers", "assessment", "situs", "ownerName", "ownerMailing"]);
    expect(p.fieldClearance?.evidence).toContain("without restrictions");
    expect(p.layers.physical).not.toBeNull();
    // Identifiers withheld → the source parcel id is not carried.
    expect(p.sourceParcelId).toBe("");
    const groupEntries = p.ignorance.filter((e) => e.what.startsWith("Parcel field group:"));
    expect(groupEntries).toHaveLength(5);
    expect(groupEntries.map((e) => e.what)).toContain("Parcel field group: Owner name");
  });

  it("Sacramento CA: partial assembly keeps the identifier and names the two owner groups withheld", () => {
    const ref: PassportParcelRef = { apid: "CA-067-000001", parcelKey: "CA:Sacramento:000001", state: "CA", county: "Sacramento", sourceParcelId: "SAC-APN-1" };
    const result = assemblePropertyPassport(ref, statewideSource("CA"), { physical: factSet(), legalDistress: null, contextTrajectory: null }, fieldClearanceFor("CA", "Sacramento", "display"));
    expect(result.status).toBe("assembled");
    if (result.status !== "assembled") return;
    expect(result.passport.partial).toBe(true);
    expect(result.passport.sourceParcelId).toBe("SAC-APN-1");
    expect(result.passport.fieldClearance?.withheldFieldGroups).toEqual(["ownerName", "ownerMailing"]);
  });

  it("Ferry WA: geometry withheld → the physical layer is withheld whole and named", () => {
    const ref: PassportParcelRef = { apid: "WA-019-000001", parcelKey: "WA:Ferry:000001", state: "WA", county: "Ferry", sourceParcelId: "FERRY-1" };
    const result = assemblePropertyPassport(ref, statewideSource("WA"), { physical: factSet(), legalDistress: null, contextTrajectory: null }, fieldClearanceFor("WA", "Ferry", "display", "free-shapefile"));
    expect(result.status).toBe("assembled");
    if (result.status !== "assembled") return;
    expect(result.passport.layers.physical).toBeNull();
    expect(result.passport.ignorance.some((e) => e.what === "Physical facts" && e.why.includes("geometry"))).toBe(true);
    expect(result.passport.sourceParcelId).toBe("FERRY-1");
  });

  it("no field-level answer: the refusal is the old refused-whole", () => {
    const ref: PassportParcelRef = { apid: "GA-131-000001", parcelKey: "GA:Union:000001", state: "GA", county: "Union", sourceParcelId: "UNION-APN-1" };
    const result = assemblePropertyPassport(ref, statewideSource("GA"), { ...LAYERS });
    expect(result.status).toBe("refused");
  });

  it("a zero-group answer (LA on paid lookup) still refuses whole", () => {
    const ref: PassportParcelRef = { apid: "CA-037-000001", parcelKey: "CA:Los Angeles:000001", state: "CA", county: "Los Angeles", sourceParcelId: "LA-1" };
    const result = assemblePropertyPassport(ref, statewideSource("CA"), { ...LAYERS }, fieldClearanceFor("CA", "Los Angeles", "lookupDisplay"));
    expect(result.status).toBe("refused");
  });
});
