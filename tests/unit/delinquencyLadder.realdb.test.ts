/**
 * Notes V2 Leg 1 — the delinquency ladder against a REAL database built from
 * this repository, driven by the REAL aging sweep. SYNTHETIC data (golden tape).
 *
 *   1. Stage entries appear exactly at the boundary days (29 → none new,
 *      30 → stage_30, 60 → stage_60, 90 → stage_90_plus), each with its input
 *      snapshot, source 'aging_engine'.
 *   2. Unknown is not late: an undeterminable note records no stage. A partial
 *      payment (paid-through unchanged) does not move the stage; bringing the
 *      note current records the exit.
 *   3. Idempotence: re-running the sweep on the same date appends zero rows;
 *      exit and re-entry append exactly the transitions.
 *   4. The no-sends fence: across every sweep, zero calls into the legacy
 *      dunning ladder, borrower notices, email or SMS (every exported function
 *      spied at the module boundary), and the ladder writes only note_events.
 *   5. Terminal immunity: a paid-off note gains no ladder row at any age.
 *   -  Ruling 1 (2026-11-05): no aging run creates default review at any age; an
 *      operator recording creates it exactly once; the database refuses it from
 *      any source but 'operator_recorded'.
 *  18. Cross-tenant: another org reads no ladder, no bundle, records nothing.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { realDbAvailable, useRealDb } from "../helpers/realDb";

useRealDb("delinquencyLadder.realdb.test.ts");
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

// The no-sends fence at the module boundary: every exported function of every
// module that can send or notify is wrapped in a pass-through spy.
const { sendSpies, spyAll } = vi.hoisted(() => {
  const sendSpies: Array<{ module: string; name: string; spy: { mock: { calls: unknown[][] } } }> = [];
  const spyAll = async (module: string, importOriginal: () => Promise<unknown>) => {
    const orig = (await importOriginal()) as Record<string, unknown>;
    const wrapped: Record<string, unknown> = { ...orig };
    for (const [k, v] of Object.entries(orig)) {
      if (typeof v === "function" && !/^[A-Z]/.test(k)) {
        const calls: unknown[][] = [];
        const fn = (...a: unknown[]) => {
          calls.push(a);
          return (v as (...x: unknown[]) => unknown)(...a);
        };
        sendSpies.push({ module, name: k, spy: { mock: { calls } } });
        wrapped[k] = fn;
      }
    }
    return wrapped;
  };
  return { sendSpies, spyAll };
});
vi.mock("../../server/jobs/borrowerDunningLadder", (io) => spyAll("borrowerDunningLadder", io));
vi.mock("../../server/services/borrowerNotices", (io) => spyAll("borrowerNotices", io));
vi.mock("../../server/services/emailService", (io) => spyAll("emailService", io));
vi.mock("../../server/services/smsService", (io) => spyAll("smsService", io));

const tag = `dl${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const golden = readFileSync(path.join(__dirname, "../../shared/notes/golden/note-tape-golden.csv"), "utf8");
const orgIds: number[] = [];
let noteId = "";
let unknownNoteId = "";
let terminalNoteId = "";
let due = new Date();
const DAY = 24 * 60 * 60 * 1000;
const at = (days: number) => new Date(due.getTime() + days * DAY + 12 * 60 * 60 * 1000);

async function stages(id: string) {
  const { db } = await import("../../server/db");
  const { sql } = await import("drizzle-orm");
  const r = await db.execute(sql`SELECT detail->>'stage' AS stage, source FROM note_events WHERE note_id = ${id} AND event_type = 'delinquency_stage_entered' ORDER BY recorded_at, id`);
  return (r as unknown as { rows: Array<{ stage: string; source: string }> }).rows;
}
async function sweep(days: number) {
  const { runAcquiredNoteAgingSweep } = await import("../../server/jobs/acquiredNoteAging");
  return runAcquiredNoteAgingSweep({ asOf: at(days) });
}

describe.runIf(realDbAvailable)("delinquency ladder — real database, real aging sweep", () => {
  beforeAll(async () => {
    // Load every send module so its spies exist before any sweep runs: a fence
    // over modules that were never loaded would be green by construction.
    await import("../../server/jobs/borrowerDunningLadder");
    await import("../../server/services/borrowerNotices");
    await import("../../server/services/emailService");
    await import("../../server/services/smsService");
    const { db } = await import("../../server/db");
    const { sql } = await import("drizzle-orm");
    const { organizations } = await import("@shared/schema");
    for (const s of ["a", "b"]) {
      const [org] = await db.insert(organizations).values({ name: `${tag}${s}`, slug: `${tag}${s}`, ownerId: `${tag}-o${s}` } as never).returning();
      orgIds.push(org.id);
    }
    const { readNoteTape, suggestNoteTapeMapping, validateNoteTape } = await import("../../server/services/notes/noteTapeImport");
    const { commitNoteTape } = await import("../../server/services/notes/noteTapeCommit");
    const { sheet, sha256 } = readNoteTape(golden);
    const r = await commitNoteTape({ organizationId: orgIds[0], actorUserId: `${tag}-u`, fileName: "tape.csv", fileSha256: sha256, asOf: "2026-09-30", validation: validateNoteTape({ sheet, mapping: suggestNoteTapeMapping(sheet.headers).mapping }), excludeRows: [4, 5] });
    if (r.status !== "committed") throw new Error(JSON.stringify(r));
    [noteId, unknownNoteId, terminalNoteId] = r.notes.slice(0, 3).map((n) => n.noteId);
    // Known schedule facts on the main note; no derivable schedule on the second; the third is paid off.
    await db.execute(sql`UPDATE acquired_notes SET status = 'performing', payment_due_day = 5, first_payment_date = '2026-01-05', paid_through_date = '2026-05-05', next_payment_date = NULL, days_delinquent = 0, delinquency_status = 'current', maturity_date = '2040-01-05' WHERE id = ${noteId}`);
    await db.execute(sql`UPDATE acquired_notes SET status = 'performing', first_payment_date = NULL, paid_through_date = NULL, next_payment_date = NULL, days_delinquent = 0, delinquency_status = 'current' WHERE id = ${unknownNoteId}`);
    await db.execute(sql`UPDATE acquired_notes SET status = 'paid_off', payment_due_day = 5, first_payment_date = '2026-01-05', paid_through_date = '2026-01-05', maturity_date = '2040-01-05' WHERE id = ${terminalNoteId}`);
    // Anchor: the sweep's own derivation of the next due date.
    const { runAcquiredNoteAgingSweep } = await import("../../server/jobs/acquiredNoteAging");
    await runAcquiredNoteAgingSweep({ asOf: new Date("2026-05-20T12:00:00Z") });
    const row = (await db.execute(sql`SELECT next_payment_date AS d FROM acquired_notes WHERE id = ${noteId}`)) as unknown as { rows: Array<{ d: string }> };
    due = new Date(`${String(row.rows[0].d).slice(0, 10)}T00:00:00Z`);
  });

  afterAll(async () => {
    const { db, pool } = await import("../../server/db");
    const { sql } = await import("drizzle-orm");
    for (const id of orgIds) {
      await db.execute(sql`DELETE FROM acquired_notes WHERE organization_id = ${id}`).catch(() => undefined);
      await db.execute(sql`DELETE FROM organizations WHERE id = ${id}`).catch(() => undefined);
    }
    await pool.end();
  });

  it("(1) stage entries land exactly on the boundary days, with their snapshots", async () => {
    expect(due.toISOString().slice(0, 10)).toBe("2026-06-05");
    await sweep(0);
    expect(await stages(noteId)).toEqual([]); // current, never off it: no ladder history
    await sweep(29);
    expect((await stages(noteId)).map((r) => r.stage)).toEqual(["past_due_under_30"]);
    await sweep(30);
    await sweep(59);
    await sweep(60);
    await sweep(89);
    await sweep(90);
    const s = await stages(noteId);
    expect(s.map((r) => r.stage)).toEqual(["past_due_under_30", "stage_30", "stage_60", "stage_90_plus"]);
    expect(new Set(s.map((r) => r.source))).toEqual(new Set(["aging_engine"]));
    const { buildLadderView } = await import("../../server/services/notes/delinquencyLadder");
    const view = await buildLadderView(orgIds[0], noteId);
    const last = view!.recorded.at(-1)!;
    expect(last.snapshot).toMatchObject({ stage: "stage_90_plus", priorStage: "stage_60", daysDelinquent: 90, paidThroughDate: "2026-05-05", nextPaymentDate: "2026-06-05" });
  });

  it("(3) idempotence: the same date twice appends nothing", async () => {
    const before = (await stages(noteId)).length;
    const a = await sweep(90);
    const b = await sweep(90);
    expect((await stages(noteId)).length).toBe(before);
    expect(a.ladderStagesRecorded + b.ladderStagesRecorded).toBe(0);
  });

  it("(2) a partial payment does not move the stage; bringing the note current records the exit, and re-entry is a new row", async () => {
    const { db } = await import("../../server/db");
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`INSERT INTO note_payments (note_id, organization_id, payment_date, principal_cents, interest_cents, payment_type, unapplied_cents) VALUES (${noteId}, ${orgIds[0]}, '2026-09-04', 0, 0, 'partial', 20000)`);
    const before = (await stages(noteId)).length;
    await sweep(91);
    expect((await stages(noteId)).length).toBe(before);
    // Paid through the next five periods (as the payment path would record) → current.
    await db.execute(sql`UPDATE acquired_notes SET paid_through_date = '2026-10-05', next_payment_date = NULL WHERE id = ${noteId}`);
    await sweep(91);
    expect((await stages(noteId)).at(-1)!.stage).toBe("current");
    // Falls behind again (next due 2026-11-05; day 188 = 2026-12-10, 35 days late) → a NEW entry row.
    await sweep(188);
    expect((await stages(noteId)).map((r) => r.stage).slice(-2)).toEqual(["current", "stage_30"]);
  });

  it("(2) unknown is not late: an undeterminable note records no stage and says why", async () => {
    await sweep(200);
    expect(await stages(unknownNoteId)).toEqual([]);
    const { buildLadderView } = await import("../../server/services/notes/delinquencyLadder");
    const v = await buildLadderView(orgIds[0], unknownNoteId);
    expect(v!.current).toBeNull();
    expect(v!.reason).toMatch(/not determinable/i);
  });

  it("(5) terminal immunity: a paid-off note gains no ladder row at any age", async () => {
    await sweep(365);
    await sweep(800);
    expect(await stages(terminalNoteId)).toEqual([]);
  });

  it("ruling 1: no aging run creates default review at any age; the operator records it exactly once", async () => {
    const { db } = await import("../../server/db");
    const { sql } = await import("drizzle-orm");
    const countDr = async () => Number(((await db.execute(sql`SELECT count(*)::int AS n FROM note_events WHERE note_id = ${noteId} AND event_type = 'default_review_recorded'`)) as unknown as { rows: Array<{ n: number }> }).rows[0].n);
    await sweep(1_000);
    expect(await countDr()).toBe(0);
    const { recordDefaultReview, DefaultReviewRefused } = await import("../../server/services/notes/delinquencyLadder");
    const row = await recordDefaultReview({ organizationId: orgIds[0], noteId, userId: `${tag}-operator`, note: "placing in review" });
    expect(row!.recordedBy).toBe(`${tag}-operator`);
    expect(row!.source).toBe("operator_recorded");
    await expect(recordDefaultReview({ organizationId: orgIds[0], noteId, userId: `${tag}-operator`, note: null })).rejects.toBeInstanceOf(DefaultReviewRefused);
    await sweep(1_001);
    expect(await countDr()).toBe(1);
    // A paid-off note refuses.
    await expect(recordDefaultReview({ organizationId: orgIds[0], noteId: terminalNoteId, userId: `${tag}-operator`, note: null })).rejects.toBeInstanceOf(DefaultReviewRefused);
  });

  it("0302: each ladder type is bound to its one source; ladder rows are append-only", async () => {
    const { db } = await import("../../server/db");
    const { sql } = await import("drizzle-orm");
    const codeOf = (q: Promise<unknown>) => q.then(() => null, (e: { code?: string; cause?: { code?: string } }) => e.code ?? e.cause?.code);
    const insert = (type: string, source: string) =>
      codeOf(db.execute(sql`INSERT INTO note_events (organization_id, note_id, category, event_type, event_date, detail, source, source_ref, recorded_by) VALUES (${orgIds[0]}, ${unknownNoteId}, 'delinquency', ${type}, '2027-01-01', '{}'::jsonb, ${source}, '{}'::jsonb, 'test')`));
    expect(await insert("default_review_recorded", "aging_engine")).toBe("23514");
    expect(await insert("default_review_recorded", "note_tape")).toBe("23514");
    expect(await insert("delinquency_stage_entered", "operator_recorded")).toBe("23514");
    expect(await insert("delinquency_stage_entered", "workout_engine")).toBe("23514");
    expect(await codeOf(db.execute(sql`INSERT INTO note_events (organization_id, note_id, category, event_type, event_date, detail, source, source_ref, recorded_by) VALUES (${orgIds[0]}, ${unknownNoteId}, 'outcome', 'performance_reported', '2027-01-01', '{}'::jsonb, 'aging_engine', '{}'::jsonb, 'test')`))).toBe("23514");
    expect(await codeOf(db.execute(sql`UPDATE note_events SET detail = '{}'::jsonb WHERE note_id = ${noteId} AND category = 'delinquency'`))).toBe("23001");
  });

  it("the escalation bundle assembles from recorded facts at 30+ days", async () => {
    const { buildEscalationBundle } = await import("../../server/services/notes/delinquencyLadder");
    const b = await buildEscalationBundle(orgIds[0], noteId);
    expect(b && !("status" in b)).toBe(true);
    if (!b || "status" in b) return;
    expect(b.paymentHistory.payments.map((p) => p.paymentType)).toContain("partial");
    expect(b.extendAndPretend.status).toBe("not_determinable");
    expect(b.lossMitCase).toBeNull();
    expect(b.documents).not.toBeNull();
    const notEscalated = await buildEscalationBundle(orgIds[0], unknownNoteId);
    expect(notEscalated).toMatchObject({ status: "not_escalated" });
  });

  it("(18) another org reads no ladder or bundle and can record nothing", async () => {
    const { buildLadderView, buildEscalationBundle, recordDefaultReview } = await import("../../server/services/notes/delinquencyLadder");
    expect(await buildLadderView(orgIds[1], noteId)).toBeNull();
    expect(await buildEscalationBundle(orgIds[1], noteId)).toBeNull();
    expect(await recordDefaultReview({ organizationId: orgIds[1], noteId: unknownNoteId, userId: "x", note: null })).toBeNull();
  });

  it("(4) the no-sends fence: across every sweep above, nothing that sends or notifies was called", () => {
    expect(sendSpies.length).toBeGreaterThan(5); // vacuity: the spies really wrap the modules' functions
    expect(sendSpies.filter((s) => s.spy.mock.calls.length > 0).map((s) => `${s.module}::${s.name}`)).toEqual([]);
  });
});
