/**
 * V-Notes-1 N3 — outcome and forward-calendar hooks against a REAL database
 * built from this repository. SYNTHETIC data.
 *
 *   - the real tape commit records one outcome per note and registers each
 *     STATED dated term — and no next payment date the tape did not state;
 *   - the note record reads them back: performance oldest first, and per date
 *     type the latest registration or why none is on record;
 *   - a re-import adds rows beside the earlier ones; the record shows the
 *     latest, and the earlier rows are still there;
 *   - note_events is append-only (no edit, no direct delete, no truncate), and
 *     an organization holding notes is still erasable.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { realDbAvailable, useRealDb } from "../helpers/realDb";

useRealDb("noteEvents.realdb.test.ts");
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const tag = `n3${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const golden = readFileSync(path.join(__dirname, "../../shared/notes/golden/note-tape-golden.csv"), "utf8");
const HEAD = "Loan #,Borrower,Orig Balance,UPB,Note Rate,Term,P&I,Due Day,Note Date,Maturity,Purchase Date,Purchase Price,Loan Status,Paid Thru,Next Due,Next Rate Change,Original Note,Mortgage/DOT,Assignments";
const dated = (status: string, paid: string, next: string) => `${HEAD}\nSYNTH-3001,SYNTHETIC Borrower,"10,000","9,000",9,120,126.68,5,2020-01-05,2030-01-05,2026-09-01,"6,000",${status},${paid},${next},2027-01-05,Yes,Yes,Yes\n`;
const orgIds: number[] = [];
const noteIds: Record<string, string> = {};
const count = (r: unknown) => Number((r as { rows: Array<{ n: number }> }).rows[0].n);

async function commit(orgId: number, csv: string, asOf: string | null, excludeRows: number[] = []) {
  const { readNoteTape, suggestNoteTapeMapping, validateNoteTape } = await import("../../server/services/notes/noteTapeImport");
  const { commitNoteTape } = await import("../../server/services/notes/noteTapeCommit");
  const { sheet, sha256 } = readNoteTape(csv);
  const r = await commitNoteTape({ organizationId: orgId, actorUserId: `${tag}-u`, fileName: "tape.csv", fileSha256: sha256, asOf, validation: validateNoteTape({ sheet, mapping: suggestNoteTapeMapping(sheet.headers).mapping }), excludeRows });
  if (r.status !== "committed") throw new Error(JSON.stringify(r));
  for (const n of r.notes) noteIds[n.noteNumber] = n.noteId;
  return r;
}

describe.runIf(realDbAvailable)("note events — real database", () => {
  beforeAll(async () => {
    const { db } = await import("../../server/db");
    const { organizations } = await import("@shared/schema");
    const [org] = await db.insert(organizations).values({ name: tag, slug: tag, ownerId: `${tag}-o` } as never).returning();
    orgIds.push(org.id);
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

  it("the golden import records an outcome per note and registers only the dates the tape states", async () => {
    const r = await commit(orgIds[0], golden, "2026-09-30", [4, 5]);
    expect(r.notes.map((n) => [n.noteNumber, n.calendarRegistered])).toEqual([
      ["SYNTH-1001", ["maturity"]],
      ["SYNTH-1002", ["maturity", "balloon"]],
      ["SYNTH-1005", ["maturity"]],
    ]);
    const { buildNoteRecord } = await import("../../server/services/notes/noteRecord");
    const rec = (await buildNoteRecord(orgIds[0], noteIds["SYNTH-1002"]))!;
    expect(rec.outcomes).toHaveLength(1);
    expect(rec.outcomes[0]).toMatchObject({ eventType: "performance_reported", eventDate: "2026-09-30", detail: { status: "performing", paidThroughDate: "2026-08-15", currentBalanceCents: 3891244 } });
    const cal = Object.fromEntries(rec.calendar.map((c) => [c.eventType, c]));
    expect(cal.maturity.event).toMatchObject({ eventDate: "2034-03-15", source: "note_tape" });
    expect(cal.balloon.event).toMatchObject({ eventDate: "2029-03-15", detail: { balloonAmountCents: 2000000 } });
    // A due day is on the tape; a next due date is not — so none is registered, and the record says why.
    expect(cal.payment_due).toMatchObject({ event: null, reason: expect.stringMatching(/does not derive one/) });
    expect(cal.rate_adjustment).toMatchObject({ event: null, reason: expect.stringMatching(/no import stated/) });
  });

  it("a re-import adds rows beside the earlier ones; the record shows the latest and keeps every report", async () => {
    await commit(orgIds[0], dated("Performing", "2026-09-05", "2026-10-05"), "2026-09-30");
    await commit(orgIds[0], dated("Late", "2026-09-05", "2026-11-05"), "2026-10-20");
    const { buildNoteRecord } = await import("../../server/services/notes/noteRecord");
    const rec = (await buildNoteRecord(orgIds[0], noteIds["SYNTH-3001"]))!;
    expect(rec.outcomes.map((o) => [o.eventDate, o.detail.status])).toEqual([["2026-09-30", "performing"], ["2026-10-20", "late"]]);
    const due = rec.calendar.find((c) => c.eventType === "payment_due")!;
    expect(due.event).toMatchObject({ eventDate: "2026-11-05", recurrence: "monthly", recurrenceUntil: "2030-01-05" });
    expect(rec.calendar.find((c) => c.eventType === "rate_adjustment")!.event).toMatchObject({ eventDate: "2027-01-05" });
    const { db } = await import("../../server/db");
    const { sql } = await import("drizzle-orm");
    expect(count(await db.execute(sql`SELECT count(*)::int AS n FROM note_events WHERE organization_id = ${orgIds[0]} AND note_id = ${noteIds["SYNTH-3001"]} AND event_type = 'payment_due'`))).toBe(2);
  });

  it("note_events is append-only, and its shape constraints hold", async () => {
    const { db } = await import("../../server/db");
    const { sql } = await import("drizzle-orm");
    const id = noteIds["SYNTH-1001"];
    const codeOf = (q: Promise<unknown>) => q.then(() => null, (e: { code?: string; cause?: { code?: string } }) => e.code ?? e.cause?.code);
    expect(await codeOf(db.execute(sql`UPDATE note_events SET event_date = '2099-01-01' WHERE note_id = ${id}`))).toBe("23001");
    expect(await codeOf(db.execute(sql`DELETE FROM note_events WHERE note_id = ${id}`))).toBe("23503");
    expect(await codeOf(db.execute(sql`TRUNCATE note_events`))).toBe("23001");
    const insert = (category: string, type: string, rec: string | null, until: string | null) =>
      codeOf(db.execute(sql`INSERT INTO note_events (organization_id, note_id, category, event_type, event_date, recurrence, recurrence_until, detail, source, source_ref, recorded_by) VALUES (${orgIds[0]}, ${id}, ${category}, ${type}, '2027-01-01', ${rec}, ${until}, '{}'::jsonb, 'note_tape', '{}'::jsonb, 'test')`));
    expect(await insert("outcome", "maturity", null, null)).toBe("23514");
    expect(await insert("calendar", "maturity", "monthly", "2030-01-01")).toBe("23514");
    expect(await insert("calendar", "payment_due", "monthly", "2026-01-01")).toBe("23514");
  });

  it("deleteOrganization completes for an org holding note events, and they leave with the notes", async () => {
    const { db } = await import("../../server/db");
    const { sql } = await import("drizzle-orm");
    const { deleteOrganization } = await import("../../server/services/orgDeletion");
    const orgId = orgIds[0];
    expect(count(await db.execute(sql`SELECT count(*)::int AS n FROM note_events WHERE organization_id = ${orgId}`))).toBeGreaterThan(0);
    expect(await deleteOrganization(orgId)).toMatchObject({ orgRowDeleted: true, residualTables: [] });
    expect(count(await db.execute(sql`SELECT count(*)::int AS n FROM note_events WHERE organization_id = ${orgId}`))).toBe(0);
  });
});
