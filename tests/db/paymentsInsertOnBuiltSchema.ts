/**
 * tests/db/paymentsInsertOnBuiltSchema.ts — can a database built from this
 * repository record a payment?
 *
 * Run against a REAL database that `scripts/ci/build-schema-from-repo.sh` has
 * just built (it is that script's step 5):
 *
 *     DATABASE_URL=postgres://… npx tsx tests/db/paymentsInsertOnBuiltSchema.ts
 *
 * ── WHY ─────────────────────────────────────────────────────────────────────
 * Every writer of `payments` inserts with
 * `onConflictDoNothing({ target: payments.transactionId })` — a bare
 * `ON CONFLICT ("transaction_id")`. migrations/0023 had made that column unique
 * with a PARTIAL index (`WHERE transaction_id IS NOT NULL`), which PostgreSQL
 * cannot infer from a bare conflict target, so on a migration-built database
 * every payment insert failed. A `drizzle-kit push` database had the full
 * constraint the schema declares, so the defect depended on how the database
 * was built — and nothing had ever inserted a payment into a built one.
 *
 * ── WHAT IT PROVES ──────────────────────────────────────────────────────────
 *   1. Through the REAL posting path (`postServicedNotePayment`, which the
 *      portal, the Stripe webhook, Payment Links and the finance page all
 *      call): the same transaction id posted twice yields one row, the second
 *      call reports `already_recorded`, and neither throws.
 *   2. The conflict target the ACH autopay writers use is accepted too.
 *   3. Payments with no transaction id (manual) may repeat — NULLs distinct.
 *   4. The built constraint is the one shared/schema.ts declares: unique, not
 *      partial, named as drizzle names `.unique()`, so push-built and
 *      migration-built databases end equivalent.
 *
 * Seeds its own organization and note and deletes them afterwards. Exits
 * non-zero on any failure and prints what it found.
 */

import { and, eq, sql } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { notes, organizations, payments } from "@shared/schema";
import { db, pool } from "../../server/db";
import { postServicedNotePayment } from "../../server/services/borrower/portalPaymentPosting";

const failures: string[] = [];
/** drizzle wraps the driver error; the reason PostgreSQL gave is the cause. */
const why = (err: unknown) => {
  const e = err as { message?: string; cause?: { message?: string } };
  return e?.cause?.message ?? e?.message ?? String(err);
};
const check = (ok: boolean, what: string) => {
  console.log(`[payments-on-built-schema] ${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures.push(what);
};

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error("[payments-on-built-schema] DATABASE_URL not set — this needs a real, built database.");
    process.exit(1);
  }

  const tag = `pay-built-schema-${process.pid}-${Date.now()}`;
  const [org] = await db
    .insert(organizations)
    .values({ name: tag, slug: tag, ownerId: tag } as any)
    .returning();
  let noteId: number | undefined;
  try {
    const [note] = await db
      .insert(notes)
      .values({
        organizationId: org.id,
        originalPrincipal: "10000",
        currentBalance: "10000",
        interestRate: "9",
        termMonths: 60,
        monthlyPayment: "207.58",
        startDate: new Date(),
        firstPaymentDate: new Date(),
        status: "active",
        // notes_atr_origination_gate: an active note carries an ATR outcome.
        atrDeterminationCompleted: true,
      } as any)
      .returning();
    noteId = note.id;

    // 1. The real posting path, twice, same transaction id.
    const txId = `${tag}-cs`;
    let first: Awaited<ReturnType<typeof postServicedNotePayment>> | undefined;
    let second: typeof first;
    try {
      first = await postServicedNotePayment({
        note, amountCents: 20758, transactionId: txId,
        source: "operator_recorded", paymentMethod: "check", sendReceipt: false,
      });
      second = await postServicedNotePayment({
        note, amountCents: 20758, transactionId: txId,
        source: "operator_recorded", paymentMethod: "check", sendReceipt: false,
      });
    } catch (err) {
      check(false, `posting a payment threw: ${why(err)}`);
    }
    if (first && second) {
      check(first.outcome === "posted", `first post → posted (got ${first.outcome})`);
      check(second.outcome === "already_recorded", `repeat post → already_recorded (got ${second.outcome})`);
    }
    const rows = await db.select().from(payments)
      .where(and(eq(payments.organizationId, org.id), eq(payments.transactionId, txId)));
    check(rows.length === 1, `one row for the transaction id (got ${rows.length})`);

    // 2. The ACH autopay writers' statement shape.
    const achRow = {
      organizationId: org.id, noteId: note.id, amount: "1", principalAmount: "1",
      interestAmount: "0", paymentDate: new Date(), dueDate: new Date(),
      paymentMethod: "ach", transactionId: `${tag}-pi` as string | null, status: "pending",
    };
    try {
      const a = await db.insert(payments).values(achRow)
        .onConflictDoNothing({ target: payments.transactionId }).returning();
      const b = await db.insert(payments).values(achRow)
        .onConflictDoNothing({ target: payments.transactionId }).returning();
      check(a.length === 1 && b.length === 0, `ach conflict target: inserted ${a.length}, then ${b.length}`);
    } catch (err) {
      check(false, `ach-shaped insert threw: ${why(err)}`);
    }

    // 3. Manual payments carry no transaction id and may repeat.
    try {
      const manual = { ...achRow, transactionId: null, paymentMethod: "cash" };
      await db.insert(payments).values(manual);
      await db.insert(payments).values(manual);
      check(true, "two payments with no transaction id");
    } catch (err) {
      check(false, `two NULL transaction ids refused: ${why(err)}`);
    }

    // 4. The built constraint matches the declaration.
    const declared = getTableConfig(payments).columns.find((c) => c.name === "transaction_id");
    check(!!declared?.isUnique, "shared/schema.ts declares transaction_id unique");
    const declaredName = (declared as any)?.uniqueName ?? "payments_transaction_id_unique";
    const built = await db.execute(sql`
      SELECT c.relname AS name, i.indisunique AS uniq, i.indpred IS NOT NULL AS partial,
             EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conindid = i.indexrelid AND k.contype = 'u') AS is_constraint
        FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
       WHERE i.indrelid = 'public.payments'::regclass
         AND i.indkey::text = (SELECT attnum::text FROM pg_attribute
                                WHERE attrelid = 'public.payments'::regclass AND attname = 'transaction_id')`);
    const idx = (built.rows as any[]).filter((r) => r.uniq);
    check(idx.length === 1, `exactly one unique index on transaction_id (got ${idx.length})`);
    check(idx.every((r) => !r.partial), "the unique index is not partial");
    check(idx.every((r) => r.is_constraint), "it is a UNIQUE constraint, as drizzle push builds it");
    check(idx.every((r) => r.name === declaredName), `named ${declaredName} (got ${idx.map((r) => r.name).join(",")})`);
  } finally {
    if (noteId !== undefined) {
      await db.execute(sql`DELETE FROM payments WHERE organization_id = ${org.id}`);
      await db.execute(sql`DELETE FROM notes WHERE organization_id = ${org.id}`);
    }
    await db.execute(sql`DELETE FROM organizations WHERE id = ${org.id}`).catch((err) => {
      // Rows other writers hung off the org (activity, events) keep it; the
      // database is a throwaway CI build, so say so rather than fail.
      console.log(`[payments-on-built-schema] note: seeded org ${org.id} left in place (${(err as Error).message})`);
    });
  }
}

main()
  .then(async () => {
    await pool.end().catch(() => {});
    if (failures.length > 0) {
      console.error(`[payments-on-built-schema] FAIL — ${failures.length} check(s):\n  ${failures.join("\n  ")}`);
      process.exit(1);
    }
    console.log("[payments-on-built-schema] PASS — a database built from this repo records a payment exactly once.");
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("[payments-on-built-schema] FAIL — crashed:", err);
    await pool.end().catch(() => {});
    process.exit(1);
  });
