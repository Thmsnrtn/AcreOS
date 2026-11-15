/**
 * The stored shape of one workout analysis run (V-Notes-2 Leg 2) — shared by
 * the server that writes it (server/services/notes/workoutAnalysis.ts) and the
 * page that renders it, so the two cannot drift.
 */
import type { ObservationView } from "@shared/provenance/fieldRecord";
import type { WorkoutInputs, WorkoutRunResult } from "./workoutEngine";

export type Basis = "recorded" | "operator_stated" | "warehouse" | "operator_set" | "operator_entered";
export interface InputProvenance {
  basis: Basis | null;
  /** The value the run used (null = none available; the engine refuses what needs it). */
  value: number | null;
  /** The book value and the observation that states it, when the input is a recorded fact. */
  recorded: { value: number | null; provenance: ObservationView | null } | null;
  /** The warehouse picture, when the input is collateral value. */
  warehouse: { marketValueCents: number | null; source: string | null; retrievedAt: string | null; status: string; reason: string } | null;
  /** What the operator stated, when they stated something. */
  stated: number | null;
  note: string | null;
}

export interface WorkoutRunRecord {
  runId: string;
  noteId: string;
  asOf: string;
  recordedAt: string;
  recordedBy: string;
  lossMitCaseId: string | null;
  supersedesRunId: string | null;
  engineVersion: string;
  inputs: WorkoutInputs;
  provenance: Record<string, InputProvenance>;
  context: {
    daysDelinquent: number | null;
    delinquencyStatus: string | null;
    paidThroughDate: string | null;
    nextPaymentDate: string | null;
    citations: { deedInLieu: string | null; foreclosure: string | null };
  };
  result: WorkoutRunResult;
}
