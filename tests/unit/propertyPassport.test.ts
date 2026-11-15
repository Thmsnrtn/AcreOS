/**
 * Property passport assembly (slice 1) — what this suite pins, and why.
 *
 *  1. GATE FIRST, ZERO LEAKAGE. The statewide lookup gate is asked before any
 *     layer input is read. A refusal (gated entry, no entry, or an incomplete
 *     clearance record) must carry no layer content at all: not a fact's value,
 *     not a source name, not a truth's message. The fixtures put distinctive
 *     marker strings in every layer and the refusal is serialised and searched
 *     for them. The REAL isClearedForLookup is under test: entries are built by
 *     spreading the real registry entry and overriding only `lookup`.
 *
 *  2. DECLARED EXCLUSION. "out_of_state_owner" is an owner-situation derivation
 *     fenced out of slice 1 (Amendment 3 §3.4). It must never appear as a fact,
 *     even when the caller supplies it as computed, and the exclusion must be
 *     declared on the passport (`excludedFactKeys`), never silent.
 *
 *  3. IGNORANCE FROM THE INPUTS' OWN WORDS. Every unavailable fact, missing
 *     county signal, absent layer and the standing "no distress assessment"
 *     statement lands in `ignorance`, with the reason stated by whoever knew it.
 *
 *  Plus: the gate's four clearance strings ride on the passport verbatim, inputs
 *  are never mutated (they are deep-frozen), and facts pass through by reference.
 */

import { describe, it, expect } from "vitest";
import { assemblePropertyPassport } from "../../server/services/landData/propertyPassport";
import type {
  PassportLayerInputs,
  PassportParcelRef,
  PropertyPassport,
  PropertyPassportResult,
} from "../../server/services/landData/propertyPassport";
import { statewideSource } from "../../server/services/openData/statewideSourceRegistry";
import type { StatewideSourceEntry } from "../../server/services/openData/statewideSourceRegistry";
import type { CountyMomentum } from "../../server/services/openData/countyMarketSignals";
import { unavailable } from "@shared/landData/parcelFacts";
import type { FactSource, ParcelFactSet } from "@shared/landData/parcelFacts";
import type { ParcelTruth } from "@shared/landData/parcelTruths";
import type { TaxSaleSource } from "@shared/landData/taxSaleSources";

const MARKER_TOWN = "FIXTUREMARKERTOWN";
const MARKER_SOURCE = "FIXTURE MARKER SOURCE";
const TRUTH_MESSAGE = "FIXTURE TRUTH MESSAGE";
const UNAVAILABLE_REASON = "FIXTURE UNAVAILABLE REASON";
const MISSING_REASON = "FIXTURE MISSING REASON";
const REGISTER_STATE = "FIXTURE REGISTER STATE";

const DISTRESS_STANDING_WHAT = "Per-parcel distress events (liens, foreclosure and probate filings)";

const ref: PassportParcelRef = {
  apid: "TN-047-000001",
  parcelKey: "TN:Hamilton:000001",
  state: "TN",
  county: "Hamilton",
  sourceParcelId: "FIXTURE-APN-1",
};

const clearedLookup = {
  status: "cleared",
  determination: "FIXTURE DETERMINATION",
  evidence: "FIXTURE EVIDENCE WORDS",
  evidenceUrl: "https://example.invalid/fixture",
  decidedOn: "2026-11-01",
} as const;

function baseEntry(): StatewideSourceEntry {
  const entry = statewideSource("FL");
  if (!entry) throw new Error("fixture precondition: the FL registry entry must exist");
  return entry;
}

function clearedEntry(): StatewideSourceEntry {
  return { ...baseEntry(), lookup: { ...clearedLookup } };
}

function gatedEntry(): StatewideSourceEntry {
  return { ...baseEntry(), lookup: { status: "gated", registerState: REGISTER_STATE } };
}

function blankEvidenceEntry(): StatewideSourceEntry {
  return { ...baseEntry(), lookup: { ...clearedLookup, evidence: "   " } };
}

function markerSource(): FactSource {
  return { name: MARKER_SOURCE, url: "https://example.invalid/layer", retrievedOn: "2026-11-01", sourceAsOf: null };
}

function factSet(): ParcelFactSet {
  const sources = [markerSource()];
  return {
    road_frontage_m: {
      key: "road_frontage_m",
      status: "computed",
      value: 120.5,
      confidence: "medium",
      method: "FIXTURE METHOD",
      sources,
    },
    legal_access_indication: {
      key: "legal_access_indication",
      status: "computed",
      value: "public_road_contact",
      confidence: "medium",
      method: "FIXTURE METHOD",
      sources,
    },
    buildable_acres: unavailable("buildable_acres", UNAVAILABLE_REASON, "FIXTURE METHOD"),
    public_land_adjacent: {
      key: "public_land_adjacent",
      status: "computed",
      value: { adjacent: true, units: [{ name: "FIXTURE UNIT", manager: "FIXTURE MANAGER" }] },
      confidence: "high",
      method: "FIXTURE METHOD",
      sources,
    },
    distance_to_transmission_km: {
      key: "distance_to_transmission_km",
      status: "computed",
      value: { km: 3.2, voltageClass: null },
      confidence: "low",
      method: "FIXTURE METHOD",
      sources,
    },
    distance_to_town_km: {
      key: "distance_to_town_km",
      status: "computed",
      value: { km: 8.4, town: MARKER_TOWN },
      confidence: "high",
      method: "FIXTURE METHOD",
      sources,
    },
    out_of_state_owner: {
      key: "out_of_state_owner",
      status: "computed",
      value: { outOfState: true, mailingState: "GA" },
      confidence: "high",
      method: "FIXTURE METHOD",
      sources,
    },
  };
}

function truth(): ParcelTruth {
  return {
    key: "easements_unknown",
    severity: "caution",
    confidence: "high",
    message: TRUTH_MESSAGE,
  };
}

function taxSaleSource(): TaxSaleSource {
  return {
    state: "TN",
    county: "Hamilton",
    office: "FIXTURE OFFICE",
    kind: "delinquent_inquiry",
    url: "https://example.invalid/tax-sale",
    checkedOn: "2026-10-10",
    reachable: true,
    pageSays: "FIXTURE PAGE SAYS",
  };
}

function momentum(): CountyMomentum {
  return {
    stateFips: "47",
    countyFips: "065",
    signalsConsidered: 3,
    signalsPresent: 2,
    evidence: [
      {
        signal: "migration",
        source: "FIXTURE EVIDENCE SOURCE A",
        years: "FIXTURE YEARS A",
        direction: 1,
        values: { netReturns: 10 },
        detail: "FIXTURE DETAIL A",
      },
      {
        signal: "permits",
        source: "FIXTURE EVIDENCE SOURCE B",
        years: "FIXTURE YEARS B",
        direction: 0,
        values: { trendPercent: 0 },
        detail: "FIXTURE DETAIL B",
      },
    ],
    missingSignals: [{ signal: "employment", source: "FIXTURE SOURCE", reason: MISSING_REASON }],
    composite: { score: 1, outOf: 2, direction: "rising", basis: "FIXTURE BASIS" },
    compositeUnavailableReason: null,
  };
}

function richLayers(): PassportLayerInputs {
  return {
    physical: factSet(),
    legalDistress: { truths: [truth()], taxSaleSources: [taxSaleSource()] },
    contextTrajectory: momentum(),
  };
}

function emptyLayers(): PassportLayerInputs {
  return { physical: null, legalDistress: null, contextTrajectory: null };
}

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function expectAssembled(result: PropertyPassportResult): PropertyPassport {
  if (result.status !== "assembled") {
    throw new Error(`expected an assembled passport, got a refusal: ${result.reason}`);
  }
  return result.passport;
}

describe("property passport assembly", () => {
  it("refuses a gated entry, reports its register state, and leaks no layer content", () => {
    const result = assemblePropertyPassport(ref, gatedEntry(), richLayers());

    expect(result.status).toBe("refused");
    if (result.status !== "refused") return;
    expect(result.registerState).toBe(REGISTER_STATE);

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(MARKER_TOWN);
    expect(serialized).not.toContain(MARKER_SOURCE);
    expect(serialized).not.toContain(TRUTH_MESSAGE);
  });

  it("refuses when there is no register entry, with a null register state", () => {
    const result = assemblePropertyPassport(ref, undefined, richLayers());

    expect(result.status).toBe("refused");
    if (result.status !== "refused") return;
    expect(result.registerState).toBeNull();
    expect(JSON.stringify(result)).not.toContain(MARKER_TOWN);
  });

  it("refuses a cleared entry whose evidence is blank, because the real gate fails closed", () => {
    const result = assemblePropertyPassport(ref, blankEvidenceEntry(), richLayers());

    expect(result.status).toBe("refused");
    if (result.status !== "refused") return;
    expect(result.registerState).toBeNull();
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(MARKER_TOWN);
    expect(serialized).not.toContain(MARKER_SOURCE);
    expect(serialized).not.toContain(TRUTH_MESSAGE);
  });

  it("assembles a cleared entry with the clearance strings verbatim and the fenced fact left out", () => {
    const passport = expectAssembled(assemblePropertyPassport(ref, clearedEntry(), richLayers()));

    expect(passport.gate).toEqual({
      determination: "FIXTURE DETERMINATION",
      evidence: "FIXTURE EVIDENCE WORDS",
      evidenceUrl: "https://example.invalid/fixture",
      decidedOn: "2026-11-01",
    });
    expect(passport.apid).toBe(ref.apid);
    expect(passport.parcelKey).toBe(ref.parcelKey);

    const physical = passport.layers.physical;
    expect(physical).not.toBeNull();
    if (physical === null) return;
    expect(physical.facts).toHaveLength(6);
    expect(physical.facts.map((f) => f.key)).not.toContain("out_of_state_owner");
    expect(physical.excludedFactKeys).toEqual(["out_of_state_owner"]);

    // The exclusion is declared (excludedFactKeys names it) but never present as a fact.
    expect(JSON.stringify(passport)).not.toContain('"key":"out_of_state_owner"');
    expect(JSON.stringify(passport)).not.toContain("mailingState");
  });

  it("derives the ignorance map from the inputs' own words", () => {
    const passport = expectAssembled(assemblePropertyPassport(ref, clearedEntry(), richLayers()));

    expect(passport.ignorance).toContainEqual({
      layer: "physical",
      what: "Buildable acres",
      why: UNAVAILABLE_REASON,
    });
    expect(passport.ignorance).toContainEqual({
      layer: "contextTrajectory",
      what: "employment",
      why: MISSING_REASON,
    });
    expect(passport.ignorance.some((i) => i.layer === "legalDistress" && i.what === DISTRESS_STANDING_WHAT)).toBe(true);
  });

  it("assembles with all layers absent and says so for each one", () => {
    const passport = expectAssembled(assemblePropertyPassport(ref, clearedEntry(), emptyLayers()));

    expect(passport.layers.physical).toBeNull();
    expect(passport.layers.legalDistress).toBeNull();
    expect(passport.layers.contextTrajectory).toBeNull();

    const byLayer = (layer: "physical" | "legalDistress" | "contextTrajectory") =>
      passport.ignorance.filter((i) => i.layer === layer);
    expect(byLayer("physical")).toHaveLength(1);
    expect(byLayer("legalDistress")).toHaveLength(2);
    expect(byLayer("legalDistress").some((i) => i.what === DISTRESS_STANDING_WHAT)).toBe(true);
    expect(byLayer("contextTrajectory")).toHaveLength(1);
  });

  it("does not mutate its inputs (deep-frozen fixtures assemble without throwing)", () => {
    const entry = deepFreeze(clearedEntry());
    const layers = deepFreeze(richLayers());
    const frozenRef = deepFreeze({ ...ref });

    expect(() => assemblePropertyPassport(frozenRef, entry, layers)).not.toThrow();
    expect(layers.physical).not.toBeNull();
    if (layers.physical === null) return;
    expect(Object.keys(layers.physical)).toHaveLength(7);
    expect(Object.isFrozen(layers.physical)).toBe(true);
  });

  it("passes facts through by reference, unmodified", () => {
    const set = factSet();
    const layers: PassportLayerInputs = { ...emptyLayers(), physical: set };
    const passport = expectAssembled(assemblePropertyPassport(ref, clearedEntry(), layers));

    const physical = passport.layers.physical;
    expect(physical).not.toBeNull();
    if (physical === null) return;

    expect(physical.facts[0]).toBe(set.road_frontage_m);
    expect(physical.facts[1]).toBe(set.legal_access_indication);
    expect(physical.facts[2]).toBe(set.buildable_acres);
    expect(physical.facts[3]).toBe(set.public_land_adjacent);
    expect(physical.facts[4]).toBe(set.distance_to_transmission_km);
    expect(physical.facts[5]).toBe(set.distance_to_town_km);
  });
});
