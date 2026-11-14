/**
 * Settlement & Documents Rail — the recording-status component (S-2).
 *
 * One status workflow for every recordable instrument the rail produces —
 * a Notes lien release here first; Land deeds and Subdivision partial
 * releases plug into the same rows when their transplants land. Before the
 * rail, NO closing path could say "the instrument that proves this money
 * moment is recorded at the county": generation ended at a PDF and a hope.
 *
 * The workflow (shared/settlement-rail.ts RECORDING_TRANSITIONS):
 *   prepared → sent_for_recording → recorded (terminal)
 *            ↘ recorded directly (hand-delivered)   rejected → prepared
 * `recorded` requires the recorder's instrument number — a status may not
 * claim the public record without naming its place in it.
 */

import { and, desc, eq } from "drizzle-orm";
import { db } from "../../db";
import { recordingStatuses, type RecordingStatusRow } from "@shared/schema";
import {
  recordingTransitionAllowed,
  type RecordingStatus,
  type RecordingSubjectKind,
} from "@shared/settlement-rail";
import { clock } from "../../utils/clock";

export class RecordingTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecordingTransitionError";
  }
}

export async function createRecordingStatus(input: {
  organizationId: number;
  subjectKind: RecordingSubjectKind;
  subjectType: string;
  subjectId: string;
  county?: string | null;
  state?: string | null;
  documentRef?: string | null;
  createdByUserId?: string | null;
}): Promise<RecordingStatusRow> {
  const [row] = await db
    .insert(recordingStatuses)
    .values({
      organizationId: input.organizationId,
      subjectKind: input.subjectKind,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      status: "prepared",
      county: input.county ?? null,
      state: input.state ?? null,
      documentRef: input.documentRef ?? null,
      createdByUserId: input.createdByUserId ?? null,
    })
    .returning();
  return row;
}

export async function listRecordingStatusesForSubject(
  organizationId: number,
  subjectType: string,
  subjectId: string,
): Promise<RecordingStatusRow[]> {
  return db
    .select()
    .from(recordingStatuses)
    .where(
      and(
        eq(recordingStatuses.organizationId, organizationId),
        eq(recordingStatuses.subjectType, subjectType),
        eq(recordingStatuses.subjectId, subjectId),
      ),
    )
    .orderBy(desc(recordingStatuses.createdAt));
}

export async function advanceRecordingStatus(input: {
  organizationId: number;
  id: number;
  to: RecordingStatus;
  instrumentNumber?: string | null;
  documentRef?: string | null;
  rejectionReason?: string | null;
}): Promise<RecordingStatusRow> {
  const [row] = await db
    .select()
    .from(recordingStatuses)
    .where(and(eq(recordingStatuses.id, input.id), eq(recordingStatuses.organizationId, input.organizationId)))
    .limit(1);
  if (!row) throw new RecordingTransitionError("recording status not found for this organization");
  const from = row.status as RecordingStatus;
  if (!recordingTransitionAllowed(from, input.to)) {
    throw new RecordingTransitionError(`a recording in status "${from}" cannot move to "${input.to}"`);
  }
  const instrumentNumber = input.instrumentNumber ?? row.instrumentNumber;
  if (input.to === "recorded" && !(instrumentNumber && instrumentNumber.trim())) {
    throw new RecordingTransitionError("an instrument number is required before a recording can read \"recorded\"");
  }
  if (input.to === "rejected" && !(input.rejectionReason && input.rejectionReason.trim())) {
    throw new RecordingTransitionError("a rejection reason is required when the recorder rejects an instrument");
  }
  const now = clock.now();
  const [updated] = await db
    .update(recordingStatuses)
    .set({
      status: input.to,
      instrumentNumber: instrumentNumber ?? null,
      documentRef: input.documentRef ?? row.documentRef,
      rejectionReason: input.to === "rejected" ? input.rejectionReason! : input.to === "prepared" ? null : row.rejectionReason,
      sentAt: input.to === "sent_for_recording" ? now : row.sentAt,
      recordedAt: input.to === "recorded" ? now : row.recordedAt,
      preparedAt: input.to === "prepared" ? now : row.preparedAt,
      updatedAt: now,
    })
    .where(and(eq(recordingStatuses.id, input.id), eq(recordingStatuses.organizationId, input.organizationId)))
    .returning();
  return updated;
}
