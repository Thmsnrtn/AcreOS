/**
 * Field-level clearance — the per-field / per-class answer the lookup gate
 * gives instead of one refused-whole boolean (register I-6, conceptual-gap
 * sweep (e) §2b).
 *
 * A RECORD is a transcription of a written determination that already exists
 * on paper: for one identified data object (a county's named layer, one
 * office-provided file, a statewide compilation) it states, per use class,
 * what the rights holder's words permit, and which FIELD GROUPS those words
 * let us serve. A record is not a live clearance. Every record carries the
 * DRAFT-for-attorney-review posture of the dossier program, and no record in
 * this module's registry changes the lookup gate's live posture
 * (statewideSourceRegistry.ts LOOKUP_CLEARANCE — today no state is cleared).
 * Serving a record live is a separate reviewed code change per source, the
 * same discipline the clearance pin has always enforced.
 *
 * THE ANSWER is derived from the record and from nothing else, fail-closed:
 *   - no record for the object → no field is servable, for any surface;
 *   - the surface's use class is prohibited or unresolved → no field is
 *     servable on that surface (a county can answer on display and stay dark
 *     for paid point lookup — Los Angeles is exactly that case);
 *   - otherwise exactly the record's `servableFields` are servable, and every
 *     other field group is withheld WITH ITS REASON. A field group absent
 *     from the source object itself (owner names stripped upstream, a
 *     geometry-only file) is never in `servableFields`: a determination
 *     cannot grant what the source does not contain, and nothing here
 *     backfills a withheld field from another source.
 *
 * Pure and browser-safe (shared/): types and pure helpers only.
 */

/** The field groups a parcel answer is divided into. Stable ids — never renamed. */
export const PARCEL_FIELD_GROUPS = [
  "geometry",
  "identifiers",
  "assessment",
  "situs",
  "ownerName",
  "ownerMailing",
] as const;
export type ParcelFieldGroup = (typeof PARCEL_FIELD_GROUPS)[number];

/** Customer-plain labels for the groups, for ignorance / withheld reporting. */
export const PARCEL_FIELD_GROUP_LABELS: Record<ParcelFieldGroup, string> = {
  geometry: "Parcel geometry",
  identifiers: "Parcel identifiers (APN / parcel number)",
  assessment: "Assessment and value fields",
  situs: "Situs (property location) fields",
  ownerName: "Owner name",
  ownerMailing: "Owner mailing address",
};

/**
 * The use classes a field-level answer distinguishes. The first four are the
 * dossier program's classes (design §12); `lookupDisplay` is the paid
 * per-parcel point-lookup surface, which determinations sometimes answer
 * separately from display (Los Angeles: display permitted-with-conditions,
 * paid lookup-display unresolved).
 */
export const LOOKUP_USE_CLASSES = ["internal", "display", "redistribution", "resale", "lookupDisplay"] as const;
export type LookupUseClass = (typeof LOOKUP_USE_CLASSES)[number];

/** What a written determination says about one use class. */
export type UseClassStatus = "permitted" | "permitted_with_conditions" | "prohibited" | "unresolved";

export interface FieldClearanceRecord {
  /** Two-letter state code. */
  state: string;
  /** County name without the "County" suffix, or "*" for a statewide object. */
  county: string;
  /**
   * The ONE data object this determination covers, in words ("the free
   * shapefile only", "Board of Assessors parcel data only"). Clearance
   * attaches to the object, never to the county's data as a whole.
   */
  objectScope: string;
  /** Machine key for the object, where a county has more than one rights holder / object. */
  objectKey?: string;
  /** Determinations are transcribed, never upgraded: this is always the draft posture. */
  posture: "draft_for_attorney_review";
  /** Per use class, what the written determination says. */
  classes: Record<LookupUseClass, UseClassStatus>;
  /**
   * The field groups this determination lets us serve (on a surface whose
   * class it permits). Withheld groups are every group NOT listed here.
   */
  servableFields: readonly ParcelFieldGroup[];
  /** The deciding words, quoted where the record quotes them — never paraphrased into a yes. */
  evidence: string;
  /** Where those words live (thread / pack / published terms). */
  evidenceSource: string;
  /** ISO date of the determination as recorded in the dossier program. */
  recordedOn: string;
  /** Conditions and caveats that travel with the determination, verbatim in substance. */
  conditions: readonly string[];
}

export interface WithheldField {
  field: ParcelFieldGroup;
  why: string;
}

/**
 * The gate's per-field answer for one surface: exactly which field groups may
 * be served, which are withheld and why, and the determination the answer
 * rests on (null when there is no record at all).
 */
export interface FieldClearanceAnswer {
  surface: LookupUseClass;
  servableFields: ParcelFieldGroup[];
  withheldFields: WithheldField[];
  basis: {
    state: string;
    county: string;
    objectScope: string;
    evidence: string;
    evidenceSource: string;
    recordedOn: string;
    conditions: readonly string[];
  } | null;
}

const NO_RECORD_WHY = "No written determination is on file for this data object — unclear licence = unshipped, so nothing is served.";

/**
 * The per-field answer for `record` on `surface`. Fail-closed in every
 * direction: an absent record, a prohibited class, or an unresolved class
 * each serve zero fields, and the withheld list always names every group not
 * served, with the reason the record itself gives.
 */
export function fieldClearanceAnswer(
  record: FieldClearanceRecord | undefined,
  surface: LookupUseClass,
): FieldClearanceAnswer {
  if (!record) {
    return {
      surface,
      servableFields: [],
      withheldFields: PARCEL_FIELD_GROUPS.map((field) => ({ field, why: NO_RECORD_WHY })),
      basis: null,
    };
  }
  const basis = {
    state: record.state,
    county: record.county,
    objectScope: record.objectScope,
    evidence: record.evidence,
    evidenceSource: record.evidenceSource,
    recordedOn: record.recordedOn,
    conditions: record.conditions,
  };
  const status = record.classes[surface];
  if (status === "prohibited" || status === "unresolved") {
    const why =
      status === "prohibited"
        ? `The written determination for ${record.objectScope} prohibits the ${surface} use class.`
        : `The written determination for ${record.objectScope} does not resolve the ${surface} use class — unresolved = unserved.`;
    return {
      surface,
      servableFields: [],
      withheldFields: PARCEL_FIELD_GROUPS.map((field) => ({ field, why })),
      basis,
    };
  }
  const servable = new Set<ParcelFieldGroup>(record.servableFields);
  return {
    surface,
    servableFields: PARCEL_FIELD_GROUPS.filter((f) => servable.has(f)),
    withheldFields: PARCEL_FIELD_GROUPS.filter((f) => !servable.has(f)).map((field) => ({
      field,
      why: `The written determination for ${record.objectScope} does not clear the ${PARCEL_FIELD_GROUP_LABELS[field].toLowerCase()} group for serving.`,
    })),
    basis,
  };
}

/** True when the answer serves the group on its surface. */
export function answerServes(answer: FieldClearanceAnswer, field: ParcelFieldGroup): boolean {
  return answer.servableFields.includes(field);
}
