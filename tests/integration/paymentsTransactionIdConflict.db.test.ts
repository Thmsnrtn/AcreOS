/**
 * payments.transaction_id is a full unique constraint, so the three payment
 * writers' `INSERT … ON CONFLICT (transaction_id) DO NOTHING` resolves — on a
 * REAL database built from this repository.
 *
 * Migration 0023 made `payments_transaction_id_unique` a PARTIAL unique index
 * (`WHERE transaction_id IS NOT NULL`). Postgres infers a partial index as an
 * ON CONFLICT arbiter only when the statement repeats its predicate, and the
 * writers name the column alone, so every one of these inserts failed with
 * "there is no unique or exclusion constraint matching the ON CONFLICT
 * specification" — the FIRST payment, not just a replay. A mock cannot see
 * that: it is a property of the index, which only Postgres evaluates.
 * Migration 0262 (mirrored in scripts/migrate.mjs) makes it a full constraint.
 *
 * Each writer is driven through its real function against the real database:
 *   - postBorrowerPortalCheckoutPayment  (borrower portal / Connect webhook)
 *   - dbAchAutopayStore.postSettlement   (ACH debit settled)
 *   - dbAchAutopayStore.postReversal     (ACH return)
 * and each must (i) insert exactly one payment the first time and (ii) insert
 * nothing, and not throw, the second time with the same transaction id.
 * Nothing external is reached: the portal note has no borrower (no receipt
 * email) and the ACH store never calls the processor.
 *
 * The last case cross-checks the static gate
 * (tests/unit/onConflictTargetsAreFullUniqueConstraints.test.ts) against this
 * database: for every ON CONFLICT target in server/, the verdict the gate
 * computes from the shipped DDL must equal the verdict Postgres's own catalog
 * gives. A divergence means the gate's model of the DDL is wrong somewhere,
 * and the gate is then certifying a database that does not exist.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { useRealDb, realDbAvailable } from "../helpers/realDb";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";
import type { Note } from "@shared/schema";
import type { AchDebitAttempt } from "@shared/schema/ach-autopay";
import {
  buildShippedUniqueModel,
  collectConflictSites,
  dbIndexesByTable,
  shippedDdlSources,
  siteVerdict,
  uniqueIndexesOf,
  DB_UNIQUE_INDEXES_SQL,
  type DbUniqueIndexRow,
} from "../helpers/onConflictTargets";

// Must run before anything imports server/db.
useRealDb("paymentsTransactionIdConflict.db.test.ts");

// The cross-check walks server/ and replays the shipped DDL.
vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

describe.runIf(realDbAvailable)("payments.transaction_id ON CONFLICT on a database built from this repo", () => {
  const tag = `${process.pid}-${Date.now()}`;
  let orgId = 0;
  let pool: typeof import("../../server/db").pool;
  let db: typeof import("../../server/db").db;
  let schema: typeof import("@shared/schema");
  let ach: typeof import("@shared/schema/ach-autopay");
  let portal: typeof import("../../server/services/borrower/portalPaymentPosting");
  let autopay: typeof import("../../server/services/achAutopay");
  let actum: typeof import("../../server/services/actumProcessing");

  const dueDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);

  async function seedNote(label: string): Promise<number> {
    const { rows } = await pool.query<{ id: number }>(
      `INSERT INTO notes (organization_id, original_principal, current_balance, interest_rate, term_months,
                          monthly_payment, start_date, first_payment_date, next_payment_date, status, auto_pay_enabled,
                          atr_exemption_code)
       VALUES ($1, 10000, 10000, 9, 60, 207.58, now() - interval '30 days', now(), $2, 'active', true, 'raw_land')
       RETURNING id`,
      [orgId, dueDate],
    );
    expect(rows[0]?.id, `seeded ${label} note`).toBeGreaterThan(0);
    return rows[0].id;
  }

  async function paymentRows(transactionId: string): Promise<number> {
    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM payments WHERE transaction_id = $1`,
      [transactionId],
    );
    return Number(rows[0].n);
  }

  async function balanceOf(noteId: number): Promise<string> {
    const { rows } = await pool.query<{ b: string }>(`SELECT current_balance::text AS b FROM notes WHERE id = $1`, [noteId]);
    return rows[0].b;
  }

  beforeAll(async () => {
    ({ pool, db } = await import("../../server/db"));
    schema = await import("@shared/schema");
    ach = await import("@shared/schema/ach-autopay");
    portal = await import("../../server/services/borrower/portalPaymentPosting");
    autopay = await import("../../server/services/achAutopay");
    actum = await import("../../server/services/actumProcessing");
    const { rows } = await pool.query<{ id: number }>(
      `INSERT INTO organizations (name, slug, owner_id) VALUES ($1, $2, $3) RETURNING id`,
      [`ON CONFLICT test ${tag}`, `on-conflict-test-${tag}`, `on-conflict-test-owner-${tag}`],
    );
    orgId = rows[0].id;
  });

  afterAll(async () => {
    if (!pool) return;
    if (orgId) {
      // FK order: attempts → mandates → payments → notes → organization.
      // Everything is scoped to the org this file created.
      const { eq } = await import("drizzle-orm");
      await db.delete(ach.achDebitAttempts).where(eq(ach.achDebitAttempts.organizationId, orgId));
      await db.delete(ach.achMandates).where(eq(ach.achMandates.organizationId, orgId));
      await pool.query(`DELETE FROM payments WHERE organization_id = $1`, [orgId]);
      await pool.query(`DELETE FROM late_fee_assessments WHERE organization_id = $1`, [orgId]);
      await pool.query(`DELETE FROM activity_log WHERE organization_id = $1`, [orgId]);
      await pool.query(`DELETE FROM notes WHERE organization_id = $1`, [orgId]);
      await pool.query(`DELETE FROM organizations WHERE id = $1`, [orgId]);
    }
    await pool.end().catch(() => {});
  });

  it("the built database holds payments_transaction_id_unique as a full UNIQUE constraint", async () => {
    const { rows } = await pool.query<{ contype: string; indexdef: string }>(
      `SELECT c.contype, pg_get_indexdef(c.conindid) AS indexdef
         FROM pg_constraint c
        WHERE c.conrelid = 'public.payments'::regclass AND c.conname = 'payments_transaction_id_unique'`,
    );
    expect(rows, "payments_transaction_id_unique is a constraint (not only an index)").toHaveLength(1);
    expect(rows[0].contype).toBe("u");
    expect(rows[0].indexdef).not.toMatch(/\bWHERE\b/i);
  });

  it("borrower portal posting: the first post inserts one payment; a replay inserts nothing and does not throw", async () => {
    const noteId = await seedNote("portal");
    const load = async (): Promise<Note> => {
      const { eq } = await import("drizzle-orm");
      const [n] = await db.select().from(schema.notes).where(eq(schema.notes.id, noteId));
      return n;
    };
    const session = {
      id: `cs_test_on_conflict_${tag}`,
      amount_total: 20758,
      payment_status: "paid" as const,
      metadata: { noteId: String(noteId) },
    };

    const first = await portal.postBorrowerPortalCheckoutPayment({ note: await load(), stripeSession: session, source: "borrower_portal" });
    expect(first.outcome).toBe("posted");
    expect(await paymentRows(session.id)).toBe(1);
    const balanceAfterFirst = await balanceOf(noteId);
    expect(Number(balanceAfterFirst)).toBeLessThan(10000);

    const second = await portal.postBorrowerPortalCheckoutPayment({ note: await load(), stripeSession: session, source: "stripe_webhook" });
    expect(second.outcome).toBe("already_recorded");
    if (second.outcome === "already_recorded" && first.outcome === "posted") {
      expect(second.payment.id).toBe(first.payment.id);
    }
    expect(await paymentRows(session.id)).toBe(1);
    expect(await balanceOf(noteId)).toBe(balanceAfterFirst);
  });

  async function settledAttempt(noteId: number): Promise<AchDebitAttempt> {
    const [mandate] = await db
      .insert(ach.achMandates)
      .values({
        organizationId: orgId,
        noteId,
        authorizationText: "Test authorization",
        authorizationTextVersion: autopay.AUTHORIZATION_TEXT_VERSION,
        agreedAt: new Date(),
        agreedByEmail: "borrower@example.test",
        maxAmountCents: 50_000,
        scheduleDescription: "monthly",
        status: "active",
      })
      .returning();
    const periodKey = autopay.periodKeyForDueDate(dueDate);
    const attempt = await autopay.dbAchAutopayStore.claimAttempt({
      organizationId: orgId,
      noteId,
      mandateId: mandate.id,
      periodKey,
      attemptNumber: 1,
      idempotencyKey: `${autopay.idempotencyKeyFor(noteId, periodKey, 1)}:${tag}`,
      amountCents: 20758,
      dueDate,
      retryOfAttemptId: null,
    });
    expect(attempt, "claimAttempt inserted the attempt").not.toBeNull();
    return attempt!;
  }

  it("ACH settlement: the first post inserts one payment; a replay inserts nothing and does not throw", async () => {
    const noteId = await seedNote("ach-settlement");
    const attempt = await settledAttempt(noteId);
    const paymentIntentId = `pi_test_on_conflict_settle_${tag}`;
    const note = await autopay.dbAchAutopayStore.getNote(noteId);
    expect(note).not.toBeNull();

    const first = await autopay.dbAchAutopayStore.postSettlement({ note: note!, attempt, paymentIntentId, settledAt: new Date() });
    expect(first.created).toBe(true);
    expect(await paymentRows(paymentIntentId)).toBe(1);
    const balanceAfterFirst = await balanceOf(noteId);
    expect(Number(balanceAfterFirst)).toBeLessThan(10000);

    const again = await autopay.dbAchAutopayStore.getNote(noteId);
    const second = await autopay.dbAchAutopayStore.postSettlement({ note: again!, attempt, paymentIntentId, settledAt: new Date() });
    expect(second.created).toBe(false);
    expect(second.paymentId).toBe(first.paymentId);
    expect(await paymentRows(paymentIntentId)).toBe(1);
    expect(await balanceOf(noteId)).toBe(balanceAfterFirst);
  });

  it("ACH reversal: the first post inserts one reversal; a replay inserts nothing and does not throw", async () => {
    const noteId = await seedNote("ach-reversal");
    const claimed = await settledAttempt(noteId);
    const paymentIntentId = `pi_test_on_conflict_return_${tag}`;
    const note = await autopay.dbAchAutopayStore.getNote(noteId);
    const settled = await autopay.dbAchAutopayStore.postSettlement({ note: note!, attempt: claimed, paymentIntentId, settledAt: new Date() });
    expect(settled.created).toBe(true);
    await autopay.dbAchAutopayStore.markAttemptSettled(claimed.id, settled.paymentId, new Date());
    const [attempt] = (await autopay.dbAchAutopayStore.listAttemptsForPeriod(noteId, claimed.periodKey)).filter((a) => a.id === claimed.id);
    expect(attempt.paymentId).toBe(settled.paymentId);
    const balanceAfterSettlement = await balanceOf(noteId);

    const reversalTxn = autopay.reversalTransactionId(paymentIntentId);
    const returnCode = actum.ACH_RETURN_CODES.R01;
    const first = await autopay.dbAchAutopayStore.postReversal({ attempt, paymentIntentId, returnCode, returnedAt: new Date() });
    expect(first.created).toBe(true);
    expect(first.reversalPaymentId).not.toBeNull();
    expect(await paymentRows(reversalTxn)).toBe(1);
    const balanceAfterReversal = await balanceOf(noteId);
    expect(Number(balanceAfterReversal)).toBeGreaterThan(Number(balanceAfterSettlement));

    const second = await autopay.dbAchAutopayStore.postReversal({ attempt, paymentIntentId, returnCode, returnedAt: new Date() });
    expect(second.created).toBe(false);
    expect(second.reversalPaymentId).toBe(first.reversalPaymentId);
    expect(await paymentRows(reversalTxn)).toBe(1);
    expect(await balanceOf(noteId)).toBe(balanceAfterReversal);
  });

  it("the static ON CONFLICT gate agrees with this database's catalog on every target in server/", async () => {
    const model = buildShippedUniqueModel(shippedDdlSources());
    const { sites } = await collectConflictSites();
    const { rows } = await pool.query<DbUniqueIndexRow>(DB_UNIQUE_INDEXES_SQL);
    const live = dbIndexesByTable(rows);
    const compared = sites.filter((s) => s.targeted && !s.unresolved && s.table);
    // Vacuity: the population is the one the gate reads, payments included.
    expect(compared.length).toBeGreaterThan(100);
    expect(compared.filter((s) => s.table === "payments" && s.columns?.join() === "transaction_id").length).toBeGreaterThanOrEqual(3);

    const disagreements = compared
      .map((s) => {
        const fromDdl = siteVerdict(s, uniqueIndexesOf(model, s.table!));
        const fromDb = siteVerdict(s, live.get(s.table!) ?? []);
        return fromDdl.ok === fromDb.ok
          ? null
          : `${s.file}:${s.line} ${s.kind} ${s.table}(${(s.columns ?? []).join(", ")}) — DDL model: ${
              fromDdl.ok ? "ok" : fromDdl.why
            }; database: ${fromDb.ok ? "ok" : fromDb.why}`;
      })
      .filter((x): x is string => x !== null);
    expect(disagreements, disagreements.join("\n")).toEqual([]);
  });
});
