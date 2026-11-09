/**
 * Notes V2 Leg 3 — the seller-finance counter, the activation gate and the
 * 0307 append-only records against a REAL database built from this
 * repository. SYNTHETIC data only.
 *
 *   §7.3-12  Window edges: a dwelling-secured consumer deal consummated
 *            12 months minus a day before the reference counts in the
 *            rolling window; exactly 12 months before does not (the
 *            window start is exclusive); plus a day does not.
 *   §7.3-13  Population: bare-flag-era rows (completed flag, NO payload)
 *            are classified unknown — never in tracks (a)/(b); 'legacy'
 *            rows are flagged, not counted; a NULL owning_entity counts
 *            toward the organization itself.
 *   §7.3-14  Org isolation: another org's identical seller name
 *            contributes nothing.
 *   R2/R3    Unknown-dwelling rows land in the unknown bucket only;
 *            seller-key normalization (case / whitespace) counts
 *            spelling variants as one seller.
 *   R6/R8    Synthetic (sample) rows are excluded; an activation whose
 *            note was later deleted still counts by its gate snapshot
 *            (the FK SET NULL orphan).
 *   Gate     createNote/updateNote refusals and cures against the real
 *            gate: bare flag, legacy without the import marker, RMLO
 *            cure-exactness for §5.2.1, the creditor-threshold refusal
 *            and its founder-release cure (wrong seller does not cure).
 *   0307     Append-only proofs: UPDATE, DELETE and TRUNCATE on
 *            note_origination_records are refused by the database.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { realDbAvailable, useRealDb } from "../helpers/realDb";

useRealDb("sellerFinanceCounter.realdb.test.ts");
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

// The gate honours threshold releases only from FOUNDER_USER_IDS; set the
// test founder BEFORE any server module loads (all imports below are
// dynamic, inside beforeAll).
const FOUNDER = `founder-${Math.random().toString(36).slice(2, 8)}`;
process.env.FOUNDER_USER_IDS = FOUNDER;

const tag = `l3${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const orgIds: number[] = [];
let orgA = 0;
let orgB = 0;

/** A determination payload validateAtrDetermination accepts. */
function validPayload() {
  return {
    currentOrReasonablyExpectedIncomeCents: 7_200_000,
    currentEmploymentStatus: "W-2 full-time, 4 years",
    monthlyMortgagePaymentCents: 110_000,
    monthlyPaymentSimultaneousLoansCents: 0,
    monthlyPaymentMortgageRelatedObligationsCents: 25_000,
    currentDebtObligationsAlimonyChildSupportCents: 40_000,
    monthlyDtiOrResidualIncomeCents: 2_900,
    creditHistorySummary: "FICO 712; no bankruptcies; tradelines current",
    verificationDocuments: [
      { factor: "factor_i_income", documentType: "w2", receivedDate: "2026-07-01" },
      { factor: "factor_viii_credit_history", documentType: "credit_report", receivedDate: "2026-07-01" },
    ],
    qmClassification: "non_qm",
    attestedBy: "Casey Operator",
    attestedByUserId: 12,
    attestationText:
      "I certify that I have made a reasonable and good faith determination that the consumer has a reasonable ability to repay this loan according to its terms, based on consideration of the eight factors enumerated in 12 CFR 1026.43(c)(2), and that the factors have been verified using reasonably reliable third-party records as required by 12 CFR 1026.43(c)(3). The supporting documentation is retained in the consumer credit transaction file in accordance with 12 CFR 1026.25(c)(3).",
  };
}

async function seedNote(orgId: number, over: Record<string, unknown>): Promise<number> {
  const { db } = await import("../../server/db");
  const { notes } = await import("@shared/schema");
  const [row] = await db
    .insert(notes)
    .values({
      organizationId: orgId,
      originalPrincipal: "24000",
      currentBalance: "24000",
      interestRate: "9.5",
      termMonths: 24,
      monthlyPayment: "1102.50",
      startDate: new Date("2026-05-01T00:00:00Z"),
      firstPaymentDate: new Date("2026-06-01T00:00:00Z"),
      status: "active",
      ...over,
    } as never)
    .returning();
  return (row as { id: number }).id;
}

async function count(orgId: number, sellerKey: string | null, date = "2026-06-15") {
  const { countSellerFinance } = await import("../../server/services/notes/sellerFinanceCounter");
  const { db } = await import("../../server/db");
  return countSellerFinance(db, { organizationId: orgId, sellerKey, consummationDate: date });
}

describe.runIf(realDbAvailable)("Leg 3 counter + gate — real database", () => {
  beforeAll(async () => {
    const { db } = await import("../../server/db");
    const { organizations } = await import("@shared/schema");
    for (const s of ["a", "b"]) {
      const [org] = await db
        .insert(organizations)
        .values({ name: `${tag}${s}`, slug: `${tag}${s}`, ownerId: `${tag}-o${s}` } as never)
        .returning();
      orgIds.push((org as { id: number }).id);
    }
    [orgA, orgB] = orgIds;
  });

  afterAll(async () => {
    const { db, pool } = await import("../../server/db");
    const { sql } = await import("drizzle-orm");
    for (const id of orgIds) {
      await db.execute(sql`DELETE FROM note_origination_records WHERE organization_id = ${id}`).catch(() => undefined);
      await db.execute(sql`DELETE FROM notes WHERE organization_id = ${id}`).catch(() => undefined);
      await db.execute(sql`DELETE FROM organizations WHERE id = ${id}`).catch(() => undefined);
    }
    await pool.end();
  });

  it("§7.3-12 window edges: 12 months minus a day counts; exactly 12 months and plus a day do not (rolling)", async () => {
    const seller = `${tag} Window LLC`;
    const mk = (start: string) =>
      seedNote(orgA, {
        owningEntity: seller,
        startDate: new Date(`${start}T00:00:00Z`),
        atrDeterminationCompleted: true,
        atrDetermination: validPayload(),
      });
    await mk("2025-06-16"); // 12 months minus a day before 2026-06-15
    await mk("2025-06-15"); // exactly 12 months before — window start is exclusive
    await mk("2025-06-14"); // 12 months plus a day before
    await mk("2026-06-15"); // the reference day itself
    const c = await count(orgA, `${tag} window llc`);
    expect(c.trackA).toBe(2); // 2025-06-16 and 2026-06-15
    expect(c.trackBRolling).toBe(2);
    expect(c.trackBCalendarYear).toBe(1); // only the 2026 deal is in the reference year
    expect(c.trackC).toBe(2);
  });

  it("§7.3-13 population: bare-flag rows are unknown (never in (a)/(b)); legacy is flagged, not counted", async () => {
    const seller = `${tag} Population LLC`;
    await seedNote(orgA, {
      owningEntity: seller,
      startDate: new Date("2026-05-01T00:00:00Z"),
      atrDeterminationCompleted: true,
      atrDetermination: null, // bare-flag era: flag with no record behind it
    });
    await seedNote(orgA, {
      owningEntity: seller,
      startDate: new Date("2026-05-02T00:00:00Z"),
      atrExemptionCode: "legacy",
    });
    await seedNote(orgA, {
      owningEntity: seller,
      startDate: new Date("2026-05-03T00:00:00Z"),
      atrExemptionCode: "raw_land",
    });
    const c = await count(orgA, `${tag} population llc`);
    expect(c.trackA).toBe(0);
    expect(c.trackBRolling).toBe(0);
    expect(c.unknownDwelling).toBe(1); // the bare-flag row, dwelling unrecorded
    expect(c.legacyFlagged).toBe(1);
    expect(c.trackC).toBe(2); // bare-flag + raw_land population rows; legacy is not population
  });

  it("§7.3-13/R3 a NULL owning_entity counts toward the organization itself", async () => {
    await seedNote(orgA, {
      owningEntity: null,
      startDate: new Date("2026-05-01T00:00:00Z"),
      atrDeterminationCompleted: true,
      atrDetermination: validPayload(),
    });
    const c = await count(orgA, null);
    expect(c.sellerKey).toBeNull();
    expect(c.trackA).toBe(1);
  });

  it("R3 seller-key normalization: case and whitespace variants are one seller", async () => {
    for (const variant of [`${tag} Norm LLC`, `  ${tag}   norm   llc `, `${tag.toUpperCase()} NORM LLC`]) {
      await seedNote(orgA, {
        owningEntity: variant,
        startDate: new Date("2026-05-01T00:00:00Z"),
        atrDeterminationCompleted: true,
        atrDetermination: validPayload(),
      });
    }
    const c = await count(orgA, `${tag} norm llc`);
    expect(c.trackA).toBe(3);
  });

  it("§7.3-14 org isolation: org B's identical seller contributes nothing to org A", async () => {
    const seller = `${tag} Shared Name LLC`;
    await seedNote(orgB, {
      owningEntity: seller,
      startDate: new Date("2026-05-01T00:00:00Z"),
      atrDeterminationCompleted: true,
      atrDetermination: validPayload(),
    });
    const a = await count(orgA, `${tag} shared name llc`);
    expect(a.trackA).toBe(0);
    const b = await count(orgB, `${tag} shared name llc`);
    expect(b.trackA).toBe(1);
  });

  it("R8 an activation whose note was deleted still counts (FK SET NULL orphan, by its gate snapshot)", async () => {
    const { noteRepo } = await import("../../server/storage/noteRepo");
    const { db } = await import("../../server/db");
    const { notes, noteOriginationRecords } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");
    const seller = `${tag} Orphan LLC`;
    const created = await noteRepo.createNote.call(
      { logActivity: async () => undefined } as never,
      {
        organizationId: orgA,
        owningEntity: seller,
        originalPrincipal: "24000",
        currentBalance: "24000",
        interestRate: "9.5",
        termMonths: 24,
        monthlyPayment: "1102.50",
        startDate: new Date("2026-05-10T00:00:00Z"),
        firstPaymentDate: new Date("2026-06-10T00:00:00Z"),
        status: "active",
        atrDeterminationCompleted: true,
        atrDetermination: validPayload(),
      } as never,
      { recordedBy: `${tag}-op` },
    );
    const before = await count(orgA, `${tag} orphan llc`);
    expect(before.trackA).toBe(1);
    expect(before.orphanedActivationIds).toEqual([]);
    await db.delete(notes).where(eq(notes.id, (created as { id: number }).id));
    const recs = await db
      .select()
      .from(noteOriginationRecords)
      .where(eq(noteOriginationRecords.noteIdAtRecord, (created as { id: number }).id));
    expect(recs).toHaveLength(1);
    expect(recs[0].noteId).toBeNull(); // the FK nulled the pointer; the snapshot stands
    const after = await count(orgA, `${tag} orphan llc`);
    expect(after.trackA).toBe(1);
    expect(after.orphanedActivationIds).toEqual([(created as { id: number }).id]);
  });
});

describe.runIf(realDbAvailable)("Leg 3 activation gate — real database", () => {
  async function repo() {
    const { noteRepo } = await import("../../server/storage/noteRepo");
    return noteRepo as unknown as {
      createNote: Function;
      updateNote: Function;
    };
  }
  const noLog = { logActivity: async () => undefined };

  function basePayload(over: Record<string, unknown>) {
    return {
      organizationId: orgA,
      originalPrincipal: "24000",
      currentBalance: "24000",
      interestRate: "9.5",
      termMonths: 24,
      monthlyPayment: "1102.50",
      startDate: new Date("2026-05-20T00:00:00Z"),
      firstPaymentDate: new Date("2026-06-20T00:00:00Z"),
      status: "active",
      ...over,
    };
  }

  it("createNote refuses a bare-flag active create and writes nothing", async () => {
    const r = await repo();
    await expect(
      r.createNote.call(noLog, basePayload({ owningEntity: `${tag} Bare LLC`, atrDeterminationCompleted: true }), {
        recordedBy: `${tag}-op`,
      }),
    ).rejects.toMatchObject({ code: "ATR_DETERMINATION_REQUIRED" });
    const { db } = await import("../../server/db");
    const { notes } = await import("@shared/schema");
    const { and, eq } = await import("drizzle-orm");
    const rows = await db
      .select()
      .from(notes)
      .where(and(eq(notes.organizationId, orgA), eq(notes.owningEntity, `${tag} Bare LLC`)));
    expect(rows).toHaveLength(0);
  });

  it("createNote refuses 'legacy' without the import marker; with it, the row lands flagged", async () => {
    const r = await repo();
    await expect(
      r.createNote.call(noLog, basePayload({ owningEntity: `${tag} Legacy LLC`, atrExemptionCode: "legacy" }), {
        recordedBy: `${tag}-op`,
      }),
    ).rejects.toMatchObject({ refusals: [{ check: "legacy_claimed" }] });
    const ok = await r.createNote.call(
      noLog,
      basePayload({ owningEntity: `${tag} Legacy LLC`, atrExemptionCode: "legacy", status: "pending" }),
      { recordedBy: `${tag}-op`, viaImport: true },
    );
    expect((ok as { status: string }).status).toBe("pending");
    // And a stored-'legacy' row activates without the counter gate.
    const upd = await r.updateNote.call(noLog, (ok as { id: number }).id, { status: "active" }, orgA);
    expect((upd as { status: string }).status).toBe("active");
  });

  it("updateNote refuses pending -> active with no basis; pending -> late never engages the gate", async () => {
    const id = await seedNote(orgA, {
      owningEntity: `${tag} Gate LLC`,
      status: "pending",
      startDate: new Date("2026-05-01T00:00:00Z"),
    });
    const r = await repo();
    await expect(r.updateNote.call(noLog, id, { status: "active" }, orgA)).rejects.toMatchObject({
      code: "ATR_DETERMINATION_REQUIRED",
    });
    const late = await r.updateNote.call(noLog, id, { status: "late" }, orgA);
    expect((late as { status: string }).status).toBe("late");
  });

  it("§5.2.1: the 4th dwelling-consumer deal refuses without an RMLO record — and a complete record cures it exactly", async () => {
    const seller = `${tag} Rmlo LLC`;
    for (let i = 0; i < 3; i++) {
      await seedNote(orgA, {
        owningEntity: seller,
        startDate: new Date(`2026-0${i + 2}-01T00:00:00Z`),
        atrDeterminationCompleted: true,
        atrDetermination: validPayload(),
      });
    }
    const pendingId = await seedNote(orgA, {
      owningEntity: seller,
      status: "pending",
      startDate: new Date("2026-05-15T00:00:00Z"),
      atrDeterminationCompleted: true,
      atrDetermination: validPayload(),
    });
    const r = await repo();
    const refusal = await r.updateNote.call(noLog, pendingId, { status: "active" }, orgA).then(
      () => null,
      (e: unknown) => e as { refusals: Array<{ check: string }> },
    );
    expect(refusal).not.toBeNull();
    expect(refusal!.refusals.map((x) => x.check)).toEqual(
      expect.arrayContaining([expect.stringMatching(/count_a4|rmlo_required/)]),
    );
    // The cure: a COMPLETE rmlo_engagement record for this note.
    const { db } = await import("../../server/db");
    const { noteOriginationRecords } = await import("@shared/schema");
    await db.insert(noteOriginationRecords).values({
      organizationId: orgA,
      noteId: pendingId,
      noteIdAtRecord: pendingId,
      kind: "rmlo_engagement",
      detail: {
        originatorName: "Licensed Originator LLC",
        licenceIdentifierAsStated: "NMLS# 123456 (as stated by the originator)",
        engagementDate: "2026-05-01",
      },
      recordedBy: `${tag}-op`,
    } as never);
    const ok = await r.updateNote.call(noLog, pendingId, { status: "active" }, orgA);
    expect((ok as { status: string }).status).toBe("active");
  });

  it("creditor threshold: the 6th dwelling deal of the calendar year refuses; only a matching founder release cures it", async () => {
    const seller = `${tag} Threshold LLC`;
    let anchorId = 0;
    for (let i = 0; i < 5; i++) {
      anchorId = await seedNote(orgA, {
        owningEntity: seller,
        startDate: new Date(`2026-0${i + 1}-10T00:00:00Z`),
        atrDeterminationCompleted: true,
        atrDetermination: validPayload(),
      });
    }
    const pendingId = await seedNote(orgA, {
      owningEntity: seller,
      status: "pending",
      startDate: new Date("2026-06-01T00:00:00Z"),
      atrDeterminationCompleted: true,
      atrDetermination: validPayload(),
    });
    const r = await repo();
    await expect(r.updateNote.call(noLog, pendingId, { status: "active" }, orgA)).rejects.toMatchObject({
      refusals: expect.arrayContaining([expect.objectContaining({ check: "creditor_threshold" })]),
    });
    const { db } = await import("../../server/db");
    const { noteOriginationRecords } = await import("@shared/schema");
    const release = (sellerKey: string) => ({
      organizationId: orgA,
      noteId: anchorId,
      noteIdAtRecord: anchorId,
      kind: "threshold_release",
      detail: {
        threshold: "creditor_1026_2_a_17_v",
        sellerKey,
        calendarYear: 2026,
        decisionRef: `${tag}-counsel-note`,
      },
      recordedBy: FOUNDER,
    });
    // A release for a DIFFERENT seller does not cure this seller's refusal.
    await db.insert(noteOriginationRecords).values(release(`${tag} someone else llc`) as never);
    await expect(r.updateNote.call(noLog, pendingId, { status: "active" }, orgA)).rejects.toMatchObject({
      refusals: expect.arrayContaining([expect.objectContaining({ check: "creditor_threshold" })]),
    });
    // The matching release (normalized key stored in the detail) cures it.
    await db.insert(noteOriginationRecords).values(release(`${tag} threshold llc`) as never);
    const ok = await r.updateNote.call(noLog, pendingId, { status: "active" }, orgA);
    expect((ok as { status: string }).status).toBe("active");
  });

  it("0307 append-only: UPDATE, DELETE and TRUNCATE on the records table are refused by the database", async () => {
    const { db } = await import("../../server/db");
    const { sql } = await import("drizzle-orm");
    const { noteOriginationRecords } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");
    const [rec] = await db
      .select()
      .from(noteOriginationRecords)
      .where(eq(noteOriginationRecords.organizationId, orgA))
      .limit(1);
    expect(rec).toBeDefined();
    await expect(
      db.execute(sql`UPDATE note_origination_records SET recorded_by = 'tampered' WHERE id = ${rec.id}`),
    ).rejects.toThrow(/append-only/);
    await expect(db.execute(sql`DELETE FROM note_origination_records WHERE id = ${rec.id}`)).rejects.toThrow(
      /append-only/,
    );
    await expect(db.execute(sql`TRUNCATE note_origination_records`)).rejects.toThrow(/append-only/);
    const [still] = await db
      .select()
      .from(noteOriginationRecords)
      .where(eq(noteOriginationRecords.id, rec.id));
    expect(still.recordedBy).not.toBe("tampered");
  });
});
