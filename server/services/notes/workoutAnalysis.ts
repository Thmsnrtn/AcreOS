/**
 * Workout analysis runs — V-Notes-2 Leg 2. Assembles one run's input snapshot
 * from the note's RECORDED facts (with the provenance the note page shows) plus
 * the operator's STATED scenario inputs, runs the one engine
 * (shared/notes/workoutEngine.ts), and appends the whole thing to note_events
 * as category 'analysis' (migration 0301).
 *
 * WHAT THIS DOES NOT DO — by design, and pinned by tests:
 *   - It changes nothing else. No loss-mit case is opened, edited or closed; no
 *     action is logged; no letter, notice, filing or posting is made; nothing
 *     is sent and no money moves. An open loss-mit case is READ so the run can
 *     name it, and that is the only contact with it.
 *   - It proposes nothing. Every scenario input is the operator's; an unstated
 *     scenario is reported as not stated. The output is a comparison in a fixed
 *     order with no recommendation (see the engine header).
 *   - It never guesses a recorded fact. Balance, rate and payment come from the
 *     book row; a value the operator states instead (remaining term, collateral
 *     value) is labelled operator-stated with the recorded value kept beside it.
 *   - It computes no tax figure. Forgiven or uncollected amounts are facts with
 *     amounts only.
 *
 * Append-only: a run is never edited. A corrected run is a new run naming the
 * one it supersedes; the old one stays. A stored run is reproducible from its
 * own snapshot (reproduceRun) whatever later happens to the note.
 */
import { and, asc, eq, sql } from "drizzle-orm";
import { noteEvents, noteLossMitCases } from "@shared/schema";
import {
  runWorkoutComparison,
  WORKOUT_ENGINE_VERSION,
  type CostLine,
  type WorkoutInputs,
  type WorkoutRunResult,
} from "@shared/notes/workoutEngine";
import type { InputProvenance, WorkoutRunRecord } from "@shared/notes/workoutRunRecord";
import { buildNoteRecord } from "./noteRecord";
import { clock } from "../../utils/clock";

/** What the operator states for one run. Every scenario is optional; absent = not stated. */
export interface OperatorWorkoutInputs {
  discountRateBps: number;
  arrearsCents: number | null;
  servicingMonthlyCents: number | null;
  /** Used only when the book carries no remaining term; recorded beside it otherwise. */
  remainingTermMonths: number | null;
  /** When set, the disposition value basis; the warehouse value is kept beside it. */
  collateralValueCents: number | null;
  modification: WorkoutInputs["modification"];
  forbearance: WorkoutInputs["forbearance"];
  deedInLieu: null | { timelineMonths: number | null; costs: CostLine[]; citation: string | null };
  foreclosure: null | { timelineMonths: number | null; costs: CostLine[]; citation: string | null };
  chargeOffHold: WorkoutInputs["chargeOffHold"];
  supersedesRunId: string | null;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * Build the snapshot + run the engine + append the run. Returns null when the
 * note is not this org's (the route answers 404).
 */
export type { InputProvenance, WorkoutRunRecord };

export async function createWorkoutRun(params: {
  organizationId: number;
  noteId: string;
  recordedBy: string;
  operator: OperatorWorkoutInputs;
}): Promise<WorkoutRunRecord | null> {
  const record = await buildNoteRecord(params.organizationId, params.noteId);
  if (!record) return null;
  const { db } = await import("../../db");
  const { acquiredNotes } = await import("@shared/schema");
  const [row] = await db
    .select({
      daysDelinquent: acquiredNotes.daysDelinquent,
      delinquencyStatus: acquiredNotes.delinquencyStatus,
    })
    .from(acquiredNotes)
    .where(and(eq(acquiredNotes.id, params.noteId), eq(acquiredNotes.organizationId, params.organizationId)))
    .limit(1);
  if (!row) return null;

  if (params.operator.supersedesRunId) {
    const prior = await loadRunRow(params.organizationId, params.noteId, params.operator.supersedesRunId);
    if (!prior) throw new SupersedeTargetMissing();
  }

  const field = (key: string) => [...record.terms, ...record.yieldFields].find((f) => f.field === key);
  const recorded = (key: string): InputProvenance => {
    const f = field(key);
    const value = num(f?.value);
    return { basis: value === null ? null : "recorded", value, recorded: { value, provenance: f?.provenance ?? null }, warehouse: null, stated: null, note: null };
  };
  const op = params.operator;

  const remaining = recorded("remainingTermMonths");
  if (remaining.value === null && op.remainingTermMonths !== null) {
    remaining.basis = "operator_stated";
    remaining.value = op.remainingTermMonths;
    remaining.stated = op.remainingTermMonths;
    remaining.note = "The book carries no remaining term; the operator stated one for this run.";
  } else if (remaining.value !== null && op.remainingTermMonths !== null && op.remainingTermMonths !== remaining.value) {
    remaining.stated = op.remainingTermMonths;
    remaining.note = "The operator stated a different remaining term; the run uses the recorded one.";
  }

  const parcel = record.collateral.parcel;
  const warehouseValue = parcel && "marketValueCents" in parcel.value ? parcel.value.marketValueCents : null;
  const collateral: InputProvenance = {
    basis: null,
    value: null,
    recorded: null,
    warehouse: {
      marketValueCents: warehouseValue,
      source: parcel?.source.name ?? null,
      retrievedAt: parcel?.source.retrievedAt ?? null,
      status: record.collateral.status,
      reason: parcel && !("marketValueCents" in parcel.value) ? parcel.value.reason : record.collateral.reason,
    },
    stated: op.collateralValueCents,
    note: null,
  };
  if (op.collateralValueCents !== null) {
    collateral.basis = "operator_stated";
    collateral.value = op.collateralValueCents;
    collateral.note = warehouseValue === null ? "No warehouse value is on record; the operator stated the value basis." : "The operator stated the value basis; the warehouse value is kept beside it.";
  } else if (warehouseValue !== null) {
    collateral.basis = "warehouse";
    collateral.value = warehouseValue;
  }

  const stated = (v: number | null, basis: NonNullable<InputProvenance["basis"]>): InputProvenance => ({ basis: v === null ? null : basis, value: v, recorded: null, warehouse: null, stated: v, note: null });

  const asOf = clock.now().toISOString().slice(0, 10);
  const inputs: WorkoutInputs = {
    asOf,
    discountRateBps: op.discountRateBps,
    note: {
      upbCents: recorded("currentBalance").value,
      rateBps: recorded("interestRate").value,
      paymentCents: recorded("paymentAmount").value,
      remainingTermMonths: remaining.value,
      arrearsCents: op.arrearsCents,
    },
    collateralValueCents: collateral.value,
    servicingMonthlyCents: op.servicingMonthlyCents,
    modification: op.modification,
    forbearance: op.forbearance,
    deedInLieu: op.deedInLieu ? { timelineMonths: op.deedInLieu.timelineMonths, costs: op.deedInLieu.costs } : null,
    foreclosure: op.foreclosure ? { timelineMonths: op.foreclosure.timelineMonths, costs: op.foreclosure.costs } : null,
    chargeOffHold: op.chargeOffHold,
  };
  const provenance: Record<string, InputProvenance> = {
    upbCents: recorded("currentBalance"),
    rateBps: recorded("interestRate"),
    paymentCents: recorded("paymentAmount"),
    remainingTermMonths: remaining,
    arrearsCents: { ...stated(op.arrearsCents, "operator_stated"), note: "AcreOS records no arrears amount; the operator states it. Delinquency context is shown beside it." },
    collateralValueCents: collateral,
    discountRateBps: { ...stated(op.discountRateBps, "operator_set"), note: "Set by the operator for this run. There is no platform default." },
    servicingMonthlyCents: stated(op.servicingMonthlyCents, "operator_entered"),
    foreclosureTimelineMonths: {
      ...stated(op.foreclosure?.timelineMonths ?? null, "operator_entered"),
      note: "Operator-entered. AcreOS holds no cited per-state foreclosure timeline or cost data, so none is presented as a state's law.",
    },
    deedInLieuTimelineMonths: stated(op.deedInLieu?.timelineMonths ?? null, "operator_entered"),
  };

  const result = runWorkoutComparison(inputs);

  const [openCase] = await db
    .select({ id: noteLossMitCases.id })
    .from(noteLossMitCases)
    .where(and(eq(noteLossMitCases.organizationId, params.organizationId), eq(noteLossMitCases.noteId, params.noteId), eq(noteLossMitCases.status, "open")))
    .limit(1);
  const lossMitCaseId = openCase?.id ?? null;

  const context: WorkoutRunRecord["context"] = {
    daysDelinquent: row.daysDelinquent ?? null,
    delinquencyStatus: row.delinquencyStatus ?? null,
    paidThroughDate: (field("paidThroughDate")?.value as string | null) ?? null,
    nextPaymentDate: (field("nextPaymentDate")?.value as string | null) ?? null,
    citations: { deedInLieu: op.deedInLieu?.citation ?? null, foreclosure: op.foreclosure?.citation ?? null },
  };

  const detail = {
    engineVersion: WORKOUT_ENGINE_VERSION,
    lossMitCaseId,
    supersedesRunId: op.supersedesRunId,
    inputs,
    provenance,
    context,
    result,
  };
  const [inserted] = await db
    .insert(noteEvents)
    .values({
      organizationId: params.organizationId,
      noteId: params.noteId,
      category: "analysis",
      eventType: "workout_analysis_run",
      eventDate: asOf,
      detail,
      source: "workout_engine",
      sourceRef: { engine: "workout-engine", version: WORKOUT_ENGINE_VERSION, lossMitCaseId, supersedesRunId: op.supersedesRunId },
      recordedBy: params.recordedBy,
    })
    .returning();
  return toRecord(inserted);
}

export class SupersedeTargetMissing extends Error {
  constructor() {
    super("The run to supersede is not on this note.");
  }
}

type RunRow = typeof noteEvents.$inferSelect;

function toRecord(r: RunRow): WorkoutRunRecord {
  const d = r.detail as unknown as Omit<WorkoutRunRecord, "runId" | "noteId" | "asOf" | "recordedAt" | "recordedBy">;
  return {
    runId: r.id,
    noteId: r.noteId,
    asOf: r.eventDate,
    recordedAt: r.recordedAt.toISOString(),
    recordedBy: r.recordedBy,
    lossMitCaseId: d.lossMitCaseId ?? null,
    supersedesRunId: d.supersedesRunId ?? null,
    engineVersion: d.engineVersion,
    inputs: d.inputs,
    provenance: d.provenance,
    context: d.context,
    result: d.result,
  };
}

async function loadRunRow(organizationId: number, noteId: string, runId: string): Promise<RunRow | null> {
  const { db } = await import("../../db");
  const [r] = await db
    .select()
    .from(noteEvents)
    .where(and(
      eq(noteEvents.organizationId, organizationId),
      eq(noteEvents.noteId, noteId),
      eq(noteEvents.category, "analysis"),
      eq(noteEvents.id, runId),
    ))
    .limit(1);
  return r ?? null;
}

/** Every run on a note, oldest first, for this org only (another org's note: empty). */
export async function listWorkoutRuns(organizationId: number, noteId: string): Promise<WorkoutRunRecord[]> {
  const { db } = await import("../../db");
  const rows = await db
    .select()
    .from(noteEvents)
    .where(and(eq(noteEvents.organizationId, organizationId), eq(noteEvents.noteId, noteId), eq(noteEvents.category, "analysis")))
    .orderBy(asc(noteEvents.recordedAt), asc(sql`${noteEvents.id}`));
  return rows.map(toRecord);
}

/** One run, with a reproduction check: the engine re-run on the STORED snapshot. */
export async function getWorkoutRun(
  organizationId: number,
  noteId: string,
  runId: string,
): Promise<(WorkoutRunRecord & { reproduction: ReturnType<typeof reproduceRun> }) | null> {
  const r = await loadRunRow(organizationId, noteId, runId);
  if (!r) return null;
  const rec = toRecord(r);
  return { ...rec, reproduction: reproduceRun(rec) };
}

/**
 * Re-run the engine on a stored run's own snapshot. Byte-identical output is
 * the proof the figure is defensible from its record; a run stored by an older
 * engine version is reported as such rather than compared against a newer one.
 */
export function reproduceRun(rec: Pick<WorkoutRunRecord, "engineVersion" | "inputs" | "result">):
  | { status: "reproduces" }
  | { status: "differs" }
  | { status: "engine_version_changed"; storedVersion: string; currentVersion: string } {
  if (rec.engineVersion !== WORKOUT_ENGINE_VERSION) {
    return { status: "engine_version_changed", storedVersion: rec.engineVersion, currentVersion: WORKOUT_ENGINE_VERSION };
  }
  return canonicalJson(runWorkoutComparison(rec.inputs)) === canonicalJson(rec.result) ? { status: "reproduces" } : { status: "differs" };
}

/**
 * JSON with object keys sorted at every depth. Postgres jsonb does not keep
 * key order, so a stored run read back has the same values in a different key
 * order; comparing canonical forms compares the values, every one of them.
 */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v as Record<string, unknown>).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson((v as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}
