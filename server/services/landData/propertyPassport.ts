/**
 * Property passport assembly, slice 1 — one parcel's passport, keyed by its
 * APID, assembled from layer inputs that other code fetched or computed
 * (Data Intelligence Amendment 3 §3.5: facts with provenance plus an ignorance
 * map; §5: the passport assembly package).
 *
 * A passport is the facts we hold AND the plain statement of what we do not.
 * Every layer that is missing, every fact that could not be computed, and every
 * question no in-repo source answers lands in `ignorance`, with the reason
 * stated by whoever knew it. Nothing is defaulted, guessed or filled in.
 *
 * GATE DISCIPLINE. The statewide lookup gate (founder decision 2026-11-03) is
 * asked FIRST, before any layer input is read: a statewide source serves a
 * lookup only when the register clears it, and a gated source behaves exactly
 * as if it were not seeded. The answer comes from the register's own
 * isClearedForLookup(); this module re-derives nothing. A refusal carries no
 * layer content at all. A cleared state's determination, evidence, URL and
 * date ride on the passport verbatim, so a reader sees what cleared it.
 *
 * Pure: no I/O, no clock reads, no mutation of its inputs. Facts pass through
 * by reference, unmodified.
 *
 * What slice 1 deliberately is NOT:
 *   - no route and no UI — nothing calls this yet;
 *   - no situation layer: the owner-situation derivation
 *     ("out_of_state_owner") is fenced out (Amendment 3 §3.4), and the
 *     exclusion is declared on the passport, never silent;
 *   - no new data rights: it reads what the gate and the callers already hold;
 *   - no per-parcel distress assessment: it never says a parcel is, or is not,
 *     delinquent or distressed. It carries recorded parcel truths and
 *     published tax-sale sources, and says what it does not know.
 * The ref and the layers carry no owner names, addresses or contact fields.
 */

import {
  PARCEL_FACT_KEYS,
  PARCEL_FACT_LABELS,
  type ParcelFact,
  type ParcelFactKey,
  type ParcelFactSet,
} from "@shared/landData/parcelFacts";
import type { ParcelTruth } from "@shared/landData/parcelTruths";
import type { TaxSaleSource } from "@shared/landData/taxSaleSources";
import { isClearedForLookup, type StatewideSourceEntry } from "../openData/statewideSourceRegistry";
import {
  coverageDemandAffordance,
  type CoverageDemandAffordance,
  type CoverageRefusalReason,
} from "@shared/coverageDemand";
// Type-only: that module loads the database at import time.
import type { CountyMomentum } from "../openData/countyMarketSignals";

export interface PassportParcelRef {
  apid: string;
  parcelKey: string;
  state: string;
  county: string;
  sourceParcelId: string;
}

export interface PassportLegalDistressInput {
  truths: ParcelTruth[];
  taxSaleSources: TaxSaleSource[];
}

export interface PassportLayerInputs {
  physical: ParcelFactSet | null;
  legalDistress: PassportLegalDistressInput | null;
  contextTrajectory: CountyMomentum | null;
}

export interface PassportIgnoranceEntry {
  layer: "physical" | "legalDistress" | "contextTrajectory";
  what: string;
  why: string;
}

export interface PropertyPassport {
  apid: string;
  parcelKey: string;
  state: string;
  county: string;
  sourceParcelId: string;
  /** What cleared this state's statewide source for lookup, verbatim from the register. */
  gate: { determination: string; evidence: string; evidenceUrl: string; decidedOn: string };
  layers: {
    physical: { facts: ParcelFact[]; excludedFactKeys: ParcelFactKey[] } | null;
    legalDistress: PassportLegalDistressInput | null;
    contextTrajectory: CountyMomentum | null;
  };
  /** Everything this passport does not know, and why. */
  ignorance: PassportIgnoranceEntry[];
}

export type PropertyPassportResult =
  | {
      status: "refused";
      apid: string;
      state: string;
      reason: string;
      registerState: string | null;
      /**
       * P1-7 / A-2: the refusal, named in the shared demand taxonomy, plus
       * the "request this county" affordance a future caller can render.
       * This module stays pure — it emits nothing; the fields only let the
       * refusal be attributed when a caller surfaces it. The refusal itself
       * and its `reason` text are unchanged.
       */
      refusalReason: CoverageRefusalReason;
      demand: CoverageDemandAffordance;
    }
  | { status: "assembled"; passport: PropertyPassport };

/**
 * Fact keys fenced out of slice 1. "out_of_state_owner" is an owner-situation
 * derivation, and Amendment 3 §3.4 keeps situation data out of this slice.
 */
const FENCED_FACT_KEYS: readonly ParcelFactKey[] = ["out_of_state_owner"];

const DISTRESS_STANDING_WHAT = "Per-parcel distress events (liens, foreclosure and probate filings)";
const DISTRESS_STANDING_WHY =
  "No in-repo source assesses per-parcel distress events yet, so this layer carries recorded parcel truths and published tax-sale sources only.";

export function assemblePropertyPassport(
  ref: PassportParcelRef,
  entry: StatewideSourceEntry | undefined,
  layers: PassportLayerInputs,
): PropertyPassportResult {
  // P1-7 / A-2: every refusal below is a gate refusal; name it and carry the
  // demand affordance on the result (see the type note — nothing is emitted).
  const refusalFields = {
    refusalReason: "gated" as CoverageRefusalReason,
    demand: coverageDemandAffordance({
      state: ref.state,
      county: ref.county,
      reason: "gated",
      surface: "passport",
    }),
  };
  // The gate is asked first. No layer input has been read when it refuses.
  if (!isClearedForLookup(entry)) {
    const lookup = entry?.lookup;
    if (!entry || !lookup) {
      return {
        status: "refused",
        apid: ref.apid,
        state: ref.state,
        reason: `No register entry exists for ${ref.state}, and a source the register does not clear serves nothing.`,
        registerState: null,
        ...refusalFields,
      };
    }
    if (lookup.status === "gated") {
      return {
        status: "refused",
        apid: ref.apid,
        state: ref.state,
        reason: `The statewide source for ${ref.state} is not cleared for lookup; its licence review is recorded on the register, and a source the register does not clear serves nothing.`,
        registerState: lookup.registerState,
        ...refusalFields,
      };
    }
    return {
      status: "refused",
      apid: ref.apid,
      state: ref.state,
      reason: `The clearance record for ${ref.state} is incomplete, so it serves nothing.`,
      registerState: null,
      ...refusalFields,
    };
  }

  const clearance = entry?.lookup;
  // isClearedForLookup is true only for a filled "cleared" record; this keeps the
  // compiler in step with that and fails closed if the two ever disagree.
  if (!clearance || clearance.status !== "cleared") {
    return {
      status: "refused",
      apid: ref.apid,
      state: ref.state,
      reason: `The clearance record for ${ref.state} is incomplete, so it serves nothing.`,
      registerState: null,
      ...refusalFields,
    };
  }

  const ignorance: PassportIgnoranceEntry[] = [];

  // Physical layer.
  let physical: PropertyPassport["layers"]["physical"] = null;
  if (layers.physical === null) {
    ignorance.push({
      layer: "physical",
      what: "Physical facts",
      why: "The fact set was not supplied to the assembly.",
    });
  } else {
    const set = layers.physical;
    const facts: ParcelFact[] = [];
    for (const key of PARCEL_FACT_KEYS) {
      if (FENCED_FACT_KEYS.includes(key)) continue;
      const fact: ParcelFact = set[key];
      facts.push(fact);
      if (fact.status === "unavailable") {
        ignorance.push({ layer: "physical", what: PARCEL_FACT_LABELS[key], why: fact.reason });
      }
    }
    physical = { facts, excludedFactKeys: [...FENCED_FACT_KEYS] };
  }

  // Legal / distress layer.
  ignorance.push({ layer: "legalDistress", what: DISTRESS_STANDING_WHAT, why: DISTRESS_STANDING_WHY });
  if (layers.legalDistress === null) {
    ignorance.push({
      layer: "legalDistress",
      what: "Recorded parcel truths and published tax-sale sources",
      why: "The legal and distress inputs were not supplied to the assembly.",
    });
  }

  // Context / trajectory layer.
  if (layers.contextTrajectory === null) {
    ignorance.push({
      layer: "contextTrajectory",
      what: "County context and trajectory",
      why: "The county momentum readout was not supplied to the assembly.",
    });
  } else {
    for (const missing of layers.contextTrajectory.missingSignals) {
      ignorance.push({ layer: "contextTrajectory", what: missing.signal, why: missing.reason });
    }
  }

  return {
    status: "assembled",
    passport: {
      apid: ref.apid,
      parcelKey: ref.parcelKey,
      state: ref.state,
      county: ref.county,
      sourceParcelId: ref.sourceParcelId,
      gate: {
        determination: clearance.determination,
        evidence: clearance.evidence,
        evidenceUrl: clearance.evidenceUrl,
        decidedOn: clearance.decidedOn,
      },
      layers: {
        physical,
        legalDistress: layers.legalDistress,
        contextTrajectory: layers.contextTrajectory,
      },
      ignorance,
    },
  };
}
