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
 * FIELD-LEVEL ANSWERS (I-6). When the statewide gate refuses but the caller
 * supplies a field-level clearance answer (fieldClearance.ts — a written
 * county/state determination expressed per field group), the passport no
 * longer refuses whole: it assembles PARTIALLY. Only what the answer serves
 * is assembled — the physical layer rides on the geometry group — every
 * withheld field group lands in `ignorance` with the determination's own
 * reason, the parcel's source identifier is carried only when the
 * identifiers group is served, and the passport is marked `partial` with
 * the served/withheld groups and the determination's evidence on it. With
 * no field-level answer, or an answer serving zero groups, the refusal
 * shapes above are byte-identical to before this package. The field-level
 * answer is a DETERMINATION, not a live clearance: this module's posture
 * toward the live gate does not change (see fieldClearanceRegistry.ts).
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
  PARCEL_FIELD_GROUP_LABELS,
  answerServes,
  type FieldClearanceAnswer,
  type ParcelFieldGroup,
} from "@shared/openData/fieldClearance";
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
  /**
   * What cleared this state's statewide source for lookup, verbatim from the
   * register. Null exactly when the passport is partial: no statewide
   * clearance exists for it, and the field-level basis rides in
   * `fieldClearance` instead — never dressed up as a gate clearance.
   */
  gate: { determination: string; evidence: string; evidenceUrl: string; decidedOn: string } | null;
  /** True when this passport was assembled from a field-level answer, not a full gate clearance. */
  partial: boolean;
  /** The field-level basis of a partial passport: what was served, what was withheld, and the determination behind both. */
  fieldClearance?: {
    servedFieldGroups: ParcelFieldGroup[];
    withheldFieldGroups: ParcelFieldGroup[];
    objectScope: string;
    evidence: string;
    evidenceSource: string;
    recordedOn: string;
  };
  layers: {
    physical: { facts: ParcelFact[]; excludedFactKeys: ParcelFactKey[] } | null;
    legalDistress: PassportLegalDistressInput | null;
    contextTrajectory: CountyMomentum | null;
  };
  /** Everything this passport does not know, and why. */
  ignorance: PassportIgnoranceEntry[];
}

export type PropertyPassportResult =
  | { status: "refused"; apid: string; state: string; reason: string; registerState: string | null }
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
  fieldClearance?: FieldClearanceAnswer | null,
): PropertyPassportResult {
  const fullCleared = isClearedForLookup(entry);
  // A field-level answer serving at least one field group converts a
  // refused-whole into a partial assembly. Zero groups — or no answer at
  // all — keeps the refusal exactly as it was.
  const partialAnswer =
    !fullCleared && fieldClearance && fieldClearance.servableFields.length > 0 ? fieldClearance : null;
  // The gate is asked first. No layer input has been read when it refuses.
  if (!fullCleared && !partialAnswer) {
    const lookup = entry?.lookup;
    if (!entry || !lookup) {
      return {
        status: "refused",
        apid: ref.apid,
        state: ref.state,
        reason: `No register entry exists for ${ref.state}, and a source the register does not clear serves nothing.`,
        registerState: null,
      };
    }
    if (lookup.status === "gated") {
      return {
        status: "refused",
        apid: ref.apid,
        state: ref.state,
        reason: `The statewide source for ${ref.state} is not cleared for lookup; its licence review is recorded on the register, and a source the register does not clear serves nothing.`,
        registerState: lookup.registerState,
      };
    }
    return {
      status: "refused",
      apid: ref.apid,
      state: ref.state,
      reason: `The clearance record for ${ref.state} is incomplete, so it serves nothing.`,
      registerState: null,
    };
  }

  const clearance = entry?.lookup;
  // isClearedForLookup is true only for a filled "cleared" record; this keeps the
  // compiler in step with that and fails closed if the two ever disagree.
  if (fullCleared && (!clearance || clearance.status !== "cleared")) {
    return {
      status: "refused",
      apid: ref.apid,
      state: ref.state,
      reason: `The clearance record for ${ref.state} is incomplete, so it serves nothing.`,
      registerState: null,
    };
  }

  const ignorance: PassportIgnoranceEntry[] = [];

  // Physical layer. The facts are computed from the parcel layer itself, so
  // on a partial passport the layer rides on the GEOMETRY group: geometry
  // withheld means the layer is withheld whole, named in ignorance below.
  let physical: PropertyPassport["layers"]["physical"] = null;
  if (partialAnswer && !answerServes(partialAnswer, "geometry")) {
    ignorance.push({
      layer: "physical",
      what: "Physical facts",
      why: `The field-level determination for ${partialAnswer.basis?.objectScope ?? "this source"} does not clear parcel geometry, so no physical layer is assembled.`,
    });
  } else if (layers.physical === null) {
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

  // Partial assembly: one ignorance entry per withheld field group, with the
  // determination's own reason — the withheld half of the answer is stated,
  // never silent.
  if (partialAnswer) {
    for (const withheld of partialAnswer.withheldFields) {
      ignorance.push({
        layer: "physical",
        what: `Parcel field group: ${PARCEL_FIELD_GROUP_LABELS[withheld.field]}`,
        why: withheld.why,
      });
    }
  }

  const partialBasis = partialAnswer?.basis ?? null;
  return {
    status: "assembled",
    passport: {
      apid: ref.apid,
      parcelKey: ref.parcelKey,
      state: ref.state,
      county: ref.county,
      // The source parcel id IS the identifiers group: carried only when served.
      sourceParcelId:
        partialAnswer && !answerServes(partialAnswer, "identifiers") ? "" : ref.sourceParcelId,
      gate:
        fullCleared && clearance && clearance.status === "cleared"
          ? {
              determination: clearance.determination,
              evidence: clearance.evidence,
              evidenceUrl: clearance.evidenceUrl,
              decidedOn: clearance.decidedOn,
            }
          : null,
      partial: partialAnswer !== null,
      ...(partialAnswer && partialBasis
        ? {
            fieldClearance: {
              servedFieldGroups: [...partialAnswer.servableFields],
              withheldFieldGroups: partialAnswer.withheldFields.map((w) => w.field),
              objectScope: partialBasis.objectScope,
              evidence: partialBasis.evidence,
              evidenceSource: partialBasis.evidenceSource,
              recordedOn: partialBasis.recordedOn,
            },
          }
        : {}),
      layers: {
        physical,
        legalDistress: layers.legalDistress,
        contextTrajectory: layers.contextTrajectory,
      },
      ignorance,
    },
  };
}
