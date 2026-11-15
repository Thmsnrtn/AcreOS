/**
 * Notes V2 Leg 2 — workout analysis runs against a REAL database built from
 * this repository. SYNTHETIC data (the golden note tape).
 *
 *   9. Snapshot integrity: a stored run's note is edited afterwards (balance,
 *      rate, payment changed on the book) — the stored run still reproduces its
 *      original outputs byte-for-byte from its own snapshot, and a new run on
 *      the edited note differs.
 *  18. Cross-tenant: another org cannot create, list or read a run on this
 *      note (null / empty), and this org's runs are unaffected by the other's.
 *   -  The write set: a run appends exactly one note_events analysis row and
 *      changes nothing else — the open loss-mit case keeps its status and
 *      updated_at, no loss-mit action is logged, no other note_events row is
 *      added. The run names the open case it was made against.
 *   -  Migration 0301: analysis rows are append-only like every other
 *      note_events row; 'workout_engine' and 'analysis' are bound both ways;
 *      V1 shapes still validate exactly as before.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { realDbAvailable, useRealDb } from "../helpers/realDb";

useRealDb("workoutAnalysis.realdb.test.ts");
// The neutral order the spec lists the paths in, pinned here independently of the engine.
const WORKOUT_PATHS = ["hold_perform", "modification", "forbearance", "deed_in_lieu", "foreclosure", "charge_off_hold"] as const;
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const tag = `wk${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const golden = readFileSync(path.join(__dirname, "../../shared/notes/golden/note-tape-golden.csv"), "utf8");
const orgIds: number[] = [];
let noteId = "";
const count = (r: unknown) => Number((r as { rows: Array<{ n: number }> }).rows[0].n);

const OPERATOR = {
  discountRateBps: 1200,
  arrearsCents: 50_000,
  servicingMonthlyCents: 2_500,
  remainingTermMonths: 60,
  collateralValueCents: 9_000_000,
  modification: { rateBps: 600, termMonths: 60, arrearsTreatment: "capitalize" as const, principalForbearanceCents: 0, principalReductionCents: 0 },
  forbearance: { months: 3, reducedPaymentCents: 0 },
  deedInLieu: { timelineMonths: 4, costs: [{ label: "Legal", amountCents: 150_000, timing: "upfront" as const }], citation: null },
  foreclosure: { timelineMonths: 10, costs: [{ label: "Attorney", amountCents: 400_000, timing: "upfront" as const }], citation: "operator: local counsel estimate" },
  chargeOffHold: { recoveryCents: 100_000, horizonMonths: 6, costs: [] },
  supersedesRunId: null,
};

describe.runIf(realDbAvailable)("workout analysis runs — real database", () => {
  beforeAll(async () => {
    const { db } = await import("../../server/db");
    const { organizations } = await import("@shared/schema");
    for (const suffix of ["a", "b"]) {
      const [org] = await db.insert(organizations).values({ name: `${tag}${suffix}`, slug: `${tag}${suffix}`, ownerId: `${tag}-o${suffix}` } as never).returning();
      orgIds.push(org.id);
    }
    const { readNoteTape, suggestNoteTapeMapping, validateNoteTape } = await import("../../server/services/notes/noteTapeImport");
    const { commitNoteTape } = await import("../../server/services/notes/noteTapeCommit");
    const { sheet, sha256 } = readNoteTape(golden);
    const r = await commitNoteTape({ organizationId: orgIds[0], actorUserId: `${tag}-u`, fileName: "tape.csv", fileSha256: sha256, asOf: "2026-09-30", validation: validateNoteTape({ sheet, mapping: suggestNoteTapeMapping(sheet.headers).mapping }), excludeRows: [4, 5] });
    if (r.status !== "committed") throw new Error(JSON.stringify(r));
    noteId = r.notes[0].noteId;
  });

  afterAll(async () => {
    const { db, pool } = await import("../../server/db");
    const { sql } = await import("drizzle-orm");
    for (const id of orgIds) {
      await db.execute(sql`DELETE FROM note_loss_mit_cases WHERE organization_id = ${id}`).catch(() => undefined);
      await db.execute(sql`DELETE FROM acquired_notes WHERE organization_id = ${id}`).catch(() => undefined);
      await db.execute(sql`DELETE FROM organizations WHERE id = ${id}`).catch(() => undefined);
    }
    await pool.end();
  });

  it("a run appends exactly one analysis row, names the open case, and changes nothing else", async () => {
    const { db } = await import("../../server/db");
    const { sql } = await import("drizzle-orm");
    const { noteLossMitCases } = await import("@shared/schema");
    const [lmCase] = await db.insert(noteLossMitCases).values({ organizationId: orgIds[0], noteId, state: "NC" }).returning();

    const snap = async () => ({
      events: count(await db.execute(sql`SELECT count(*)::int AS n FROM note_events WHERE organization_id = ${orgIds[0]}`)),
      analysis: count(await db.execute(sql`SELECT count(*)::int AS n FROM note_events WHERE organization_id = ${orgIds[0]} AND category = 'analysis'`)),
      actions: count(await db.execute(sql`SELECT count(*)::int AS n FROM note_loss_mit_actions WHERE organization_id = ${orgIds[0]}`)),
      caseRow: JSON.stringify((await db.execute(sql`SELECT status, updated_at, closed_at, summary FROM note_loss_mit_cases WHERE id = ${lmCase.id}`)).rows),
      note: JSON.stringify((await db.execute(sql`SELECT * FROM acquired_notes WHERE id = ${noteId}`)).rows),
    });
    const before = await snap();

    const { createWorkoutRun } = await import("../../server/services/notes/workoutAnalysis");
    const run = await createWorkoutRun({ organizationId: orgIds[0], noteId, recordedBy: `${tag}-u`, operator: OPERATOR });
    expect(run).not.toBeNull();
    expect(run!.lossMitCaseId).toBe(lmCase.id);
    expect(run!.result.status).toBe("computed");
    expect(run!.result.paths.map((p) => p.path)).toEqual([...WORKOUT_PATHS]);

    const after = await snap();
    expect(after.analysis - before.analysis).toBe(1);
    expect(after.events - before.events).toBe(1);
    expect(after.actions).toBe(before.actions);
    expect(after.caseRow).toBe(before.caseRow);
    expect(after.note).toBe(before.note);
  });

  it("every recorded input carries provenance, and every stated input says it was stated", async () => {
    const { listWorkoutRuns } = await import("../../server/services/notes/workoutAnalysis");
    const [run] = await listWorkoutRuns(orgIds[0], noteId);
    expect(run.provenance.upbCents.basis).toBe("recorded");
    expect(run.provenance.upbCents.recorded?.provenance?.source).toBe("note_tape");
    expect(run.provenance.rateBps.basis).toBe("recorded");
    expect(run.provenance.paymentCents.basis).toBe("recorded");
    expect(run.provenance.arrearsCents.basis).toBe("operator_stated");
    expect(run.provenance.discountRateBps.basis).toBe("operator_set");
    expect(run.provenance.foreclosureTimelineMonths.basis).toBe("operator_entered");
    expect(run.context.citations.foreclosure).toBe("operator: local counsel estimate");
    expect(run.provenance.collateralValueCents.basis).toBe("operator_stated");
    expect(run.provenance.collateralValueCents.warehouse).not.toBeNull();
  });

  it("(9) after the note is edited, the stored run reproduces byte-for-byte; a new run differs", async () => {
    const { db } = await import("../../server/db");
    const { sql } = await import("drizzle-orm");
    const { listWorkoutRuns, getWorkoutRun, createWorkoutRun, canonicalJson } = await import("../../server/services/notes/workoutAnalysis");
    const [stored] = await listWorkoutRuns(orgIds[0], noteId);
    const storedJson = canonicalJson(stored.result);

    await db.execute(sql`UPDATE acquired_notes SET current_balance_cents = current_balance_cents - 100000, interest_rate_bps = interest_rate_bps + 150, payment_amount_cents = payment_amount_cents + 5000 WHERE id = ${noteId}`);

    const reread = await getWorkoutRun(orgIds[0], noteId, stored.runId);
    expect(reread!.reproduction).toEqual({ status: "reproduces" });
    expect(canonicalJson(reread!.result)).toBe(storedJson);

    const fresh = await createWorkoutRun({ organizationId: orgIds[0], noteId, recordedBy: `${tag}-u`, operator: { ...OPERATOR, supersedesRunId: stored.runId } });
    expect(fresh!.supersedesRunId).toBe(stored.runId);
    expect(canonicalJson(fresh!.result)).not.toBe(storedJson);
    // The superseded run is still there.
    expect((await listWorkoutRuns(orgIds[0], noteId)).map((r) => r.runId)).toContain(stored.runId);
  });

  it("(18) another org cannot create, list or read a run on this note", async () => {
    const { createWorkoutRun, listWorkoutRuns, getWorkoutRun } = await import("../../server/services/notes/workoutAnalysis");
    const mine = await listWorkoutRuns(orgIds[0], noteId);
    expect(mine.length).toBeGreaterThan(0);
    expect(await createWorkoutRun({ organizationId: orgIds[1], noteId, recordedBy: `${tag}-x`, operator: OPERATOR })).toBeNull();
    expect(await listWorkoutRuns(orgIds[1], noteId)).toEqual([]);
    expect(await getWorkoutRun(orgIds[1], noteId, mine[0].runId)).toBeNull();
    expect((await listWorkoutRuns(orgIds[0], noteId)).length).toBe(mine.length);
  });

  it("superseding a run that is not on this note is refused", async () => {
    const { createWorkoutRun, SupersedeTargetMissing } = await import("../../server/services/notes/workoutAnalysis");
    await expect(
      createWorkoutRun({ organizationId: orgIds[0], noteId, recordedBy: `${tag}-u`, operator: { ...OPERATOR, supersedesRunId: "00000000-0000-4000-8000-000000000000" } }),
    ).rejects.toBeInstanceOf(SupersedeTargetMissing);
  });

  it("0301: analysis rows are append-only, and source and category are bound both ways", async () => {
    const { db } = await import("../../server/db");
    const { sql } = await import("drizzle-orm");
    const codeOf = (q: Promise<unknown>) => q.then(() => null, (e: { code?: string; cause?: { code?: string } }) => e.code ?? e.cause?.code);
    expect(await codeOf(db.execute(sql`UPDATE note_events SET detail = '{}'::jsonb WHERE note_id = ${noteId} AND category = 'analysis'`))).toBe("23001");
    expect(await codeOf(db.execute(sql`DELETE FROM note_events WHERE note_id = ${noteId} AND category = 'analysis'`))).toBe("23503");
    const insert = (category: string, type: string, source: string) =>
      codeOf(db.execute(sql`INSERT INTO note_events (organization_id, note_id, category, event_type, event_date, detail, source, source_ref, recorded_by) VALUES (${orgIds[0]}, ${noteId}, ${category}, ${type}, '2027-01-01', '{}'::jsonb, ${source}, '{}'::jsonb, 'test')`));
    // A computed row cannot claim a stated source, nor a stated row the engine.
    expect(await insert("analysis", "workout_analysis_run", "note_tape")).toBe("23514");
    expect(await insert("analysis", "workout_analysis_run", "operator_correction")).toBe("23514");
    expect(await insert("outcome", "performance_reported", "workout_engine")).toBe("23514");
    expect(await insert("calendar", "maturity", "workout_engine")).toBe("23514");
    // The type stays bound to its category.
    expect(await insert("analysis", "performance_reported", "workout_engine")).toBe("23514");
    expect(await insert("outcome", "workout_analysis_run", "note_tape")).toBe("23514");
    // V1 shapes still validate.
    expect(await insert("outcome", "performance_reported", "note_tape")).toBeNull();
    expect(await insert("calendar", "maturity", "operator_correction")).toBeNull();
  });
});
