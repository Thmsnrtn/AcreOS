/**
 * Settlement & Documents Rail — the payment-event ledger service (S-3).
 *
 * One shape for every "money actually arrived" record outside the note
 * ledger: { amount, date, source, proof, reconciles-against }. The
 * transplant packages (Wholesale fee_received, Tax redemption, Flip
 * proceeds, Subdivision lot proceeds) write here instead of growing four
 * incompatible received-tables; the cross-vertical read below is the query
 * that shape exists to make possible.
 *
 * Rows are records of money that moved on rails AcreOS does not operate
 * (the user's own bank/Stripe Standard account, title/escrow, a county
 * treasurer). Recording one moves nothing. A row is never updated or
 * deleted by this service — a correction is a new row whose notes name the
 * row it corrects.
 */

import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "../../db";
import { moneyEvents, type MoneyEvent } from "@shared/schema";
import type { MoneyEventKind } from "@shared/settlement-rail";

export interface RecordMoneyEventInput {
  organizationId: number;
  kind: MoneyEventKind;
  vertical: string;
  subjectType: string;
  subjectId: string;
  amountCents: number;
  /** ISO calendar date (YYYY-MM-DD) the money was received. */
  receivedDate: string;
  sourceName?: string | null;
  sourceReference?: string | null;
  reconcilesAgainstType?: string | null;
  reconcilesAgainstId?: string | null;
  expectedAmountCents?: number | null;
  proofDocumentRef?: string | null;
  notes?: string | null;
  recordedByUserId?: string | null;
}

/** The variance a recorded receipt carries against its expected figure, when it has one. */
export function moneyEventVarianceCents(e: Pick<MoneyEvent, "amountCents" | "expectedAmountCents">): number | null {
  return e.expectedAmountCents == null ? null : e.amountCents - e.expectedAmountCents;
}

export async function recordMoneyEvent(input: RecordMoneyEventInput): Promise<MoneyEvent> {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    throw new Error("money event amount must be a positive whole number of cents");
  }
  if (input.expectedAmountCents != null && (!Number.isInteger(input.expectedAmountCents) || input.expectedAmountCents < 0)) {
    throw new Error("expected amount must be a non-negative whole number of cents");
  }
  const [row] = await db
    .insert(moneyEvents)
    .values({
      organizationId: input.organizationId,
      kind: input.kind,
      vertical: input.vertical,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      amountCents: input.amountCents,
      receivedDate: input.receivedDate,
      sourceName: input.sourceName ?? null,
      sourceReference: input.sourceReference ?? null,
      reconcilesAgainstType: input.reconcilesAgainstType ?? null,
      reconcilesAgainstId: input.reconcilesAgainstId ?? null,
      expectedAmountCents: input.expectedAmountCents ?? null,
      proofDocumentRef: input.proofDocumentRef ?? null,
      notes: input.notes ?? null,
      recordedByUserId: input.recordedByUserId ?? null,
    })
    .returning();
  return row;
}

export async function listMoneyEventsForSubject(
  organizationId: number,
  subjectType: string,
  subjectId: string,
): Promise<MoneyEvent[]> {
  return db
    .select()
    .from(moneyEvents)
    .where(
      and(
        eq(moneyEvents.organizationId, organizationId),
        eq(moneyEvents.subjectType, subjectType),
        eq(moneyEvents.subjectId, subjectId),
      ),
    )
    .orderBy(desc(moneyEvents.receivedDate), desc(moneyEvents.id));
}

/** Money actually received by one org in a calendar month — the read the shared shape exists for. */
export async function sumMoneyReceivedInMonth(
  organizationId: number,
  monthStartIsoDate: string,
  nextMonthStartIsoDate: string,
): Promise<{ totalCents: number; byKind: Array<{ kind: string; totalCents: number; count: number }> }> {
  const rows = await db
    .select({
      kind: moneyEvents.kind,
      totalCents: sql<number>`coalesce(sum(${moneyEvents.amountCents}), 0)::bigint`,
      count: sql<number>`count(*)::int`,
    })
    .from(moneyEvents)
    .where(
      and(
        eq(moneyEvents.organizationId, organizationId),
        gte(moneyEvents.receivedDate, monthStartIsoDate),
        lt(moneyEvents.receivedDate, nextMonthStartIsoDate),
      ),
    )
    .groupBy(moneyEvents.kind);
  const byKind = rows.map((r) => ({ kind: r.kind, totalCents: Number(r.totalCents), count: Number(r.count) }));
  return { totalCents: byKind.reduce((s, r) => s + r.totalCents, 0), byKind };
}
