/**
 * The delinquency ladder's read shapes (V-Notes-2 Leg 1) — shared by the server
 * that builds them (server/services/notes/delinquencyLadder.ts) and the note
 * page that renders them, so the two cannot drift.
 */
import type { LadderStage } from "./delinquency";
import type { ExtendAndPretendCheck } from "./extendAndPretend";

export interface LadderView {
  noteId: string;
  onLadder: boolean;
  /** Why the note has no current stage, when it has none. */
  reason: string | null;
  current: null | { stage: LadderStage; label: string; daysDelinquent: number; nextPaymentDate: string | null; paidThroughDate: string | null };
  recorded: Array<{ id: string; stage: LadderStage; label: string; priorStage: LadderStage | null; eventDate: string; recordedAt: string; snapshot: Record<string, unknown> }>;
  /** The latest recorded stage and the stage the stored aging facts give now, when they differ. Both kept. */
  disagreement: null | { recordedStage: LadderStage; currentStage: LadderStage; note: string };
  defaultReview: null | { recordedAt: string; recordedBy: string; operatorNote: string | null };
  escalates: boolean;
}

export interface EscalationBundle {
  noteId: string;
  assembledAt: string;
  ladder: LadderView;
  paymentHistory: { payments: Array<{ paymentDate: string; paymentType: string; principalCents: number; interestCents: number; unappliedCents: number }>; performanceReported: Array<{ eventDate: string; detail: Record<string, unknown>; source: string }> };
  collateral: unknown;
  documents: unknown;
  scope: {
    isConsumerPurpose: boolean;
    collateralIsDwelling: boolean;
    respaEarlyIntervention: null | { firedAt: string; daysDelinquent: number | null; citation: string | null };
    scra: null | { checkedAt: string | null; activeDuty: boolean | null };
  };
  extendAndPretend: ExtendAndPretendCheck;
  lossMitCase: null | { id: string; status: string; openedAt: string };
}
