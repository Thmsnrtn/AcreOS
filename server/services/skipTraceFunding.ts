/**
 * Skip-trace funding — the customer debit and the purpose-ledger rows for a
 * set of lookups, in ONE transaction (D2e Option B, approved 2026-10-25).
 *
 * Before this, each paid door debited the credit pool, then wrote the ledger
 * row, and refunded on a ledger failure (compensation). That left two windows
 * (docs/compliance/purpose-ledger-metering-transaction.md): a crash between
 * the debit and the ledger write charged the customer for a lookup that never
 * ran, and a refund that failed was swallowed while the route still said
 * "Nothing was charged". Here the debit row and every purpose row commit or
 * roll back together, so a lookup that cannot be recorded costs nothing by
 * construction, not by a refund.
 *
 * One caller shape for every door: POST /api/skip-tracing/trace/:leadId,
 * POST /api/skip-tracing/batch, and POST /api/skip-traces (which made a paid
 * vendor call with no customer debit at all until this landed). Every door
 * funds ONE lookup per call: the batch door calls this once per lead, so each
 * lead's debit and row commit (or roll back) on their own (D2e batch shape
 * 2A, Tom-approved 2026-10-26).
 */

import { poolDebit, type PoolDebitResult } from "./creditPool";
import { recordPurpose, type PurposeEntry, type PurposeReceipt } from "./purposeLedger";

export type SkipTraceFunding =
  | { status: "funded"; debit: PoolDebitResult; receipts: PurposeReceipt[] }
  /** The pool refused the debit; nothing was written. */
  | { status: "refused"; debit: PoolDebitResult };

/**
 * Debit `entries.length` skip-trace units and write one skip_trace_call
 * purpose row per entry, atomically. Each entry's meteringRef is set to the
 * debit it rode on. Throws — with nothing committed — when the debit errors
 * or any ledger row cannot be written; the caller refuses the lookup.
 */
export async function fundSkipTraceLookups(args: {
  organizationId: number;
  isFounder?: boolean;
  externalEventId: string;
  notes: string;
  entries: Array<Omit<PurposeEntry, "organizationId" | "surface" | "meteringRef">>;
}): Promise<SkipTraceFunding> {
  if (args.entries.length === 0) throw new Error("fundSkipTraceLookups: no lookups to fund");
  const { withTransaction } = await import("../db");
  return withTransaction(async (tx) => {
    const debit = await poolDebit({
      organizationId: args.organizationId,
      action: "skip_trace",
      units: args.entries.length,
      externalEventId: args.externalEventId,
      notes: args.notes,
      isFounder: args.isFounder,
      tx,
    });
    if (!debit.allowed) return { status: "refused" as const, debit };
    const receipts: PurposeReceipt[] = [];
    for (const e of args.entries) {
      receipts.push(
        await recordPurpose(
          {
            ...e,
            organizationId: args.organizationId,
            surface: "skip_trace_call",
            meteringRef: `${args.externalEventId}#${debit.ledgerRowId ?? "no-debit"}`,
          },
          tx,
        ),
      );
    }
    return { status: "funded" as const, debit, receipts };
  });
}
