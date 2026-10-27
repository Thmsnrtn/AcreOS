/**
 * V-Notes-1 N4 — disagreement capture and negative knowledge against a REAL
 * database built from this repository. SYNTHETIC data.
 *
 *   - a later tape that states a different balance and rate for a note the org
 *     already holds is kept beside the first: the record lists BOTH values with
 *     their sources, marks which one the book holds, and the book row is not
 *     overwritten — nothing resolved, averaged or deleted;
 *   - a field blank on a tape that had the column reads "blank on the source",
 *     distinct from a field no import ever had a column for ("never stated");
 *   - another organization's tape for the same loan number never shows up as a
 *     disagreement — the comparison is within one org's own history.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { realDbAvailable, useRealDb } from "../helpers/realDb";

useRealDb("noteDisagreement.realdb.test.ts");
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const tag = `n4${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const golden = readFileSync(path.join(__dirname, "../../shared/notes/golden/note-tape-golden.csv"), "utf8");
// The October tape: the same SYNTH-1001 with a different balance and rate, and no balloon columns at all.
const OCT = "Loan #,Borrower,Orig Balance,UPB,Note Rate,Term,P&I,Due Day,Note Date,Maturity,Purchase Date,Purchase Price,Loan Status,Original Note,Mortgage/DOT,Assignments\nSYNTH-1001,SYNTHETIC Borrower One,\"$120,000.00\",\"$83,900.00\",8.75%,360,922.70,1,2015-03-01,2045-03-01,2026-09-15,\"$61,500.00\",Performing,Yes,Yes,Yes\n";
const orgIds: number[] = [];
const noteIds: Record<string, string> = {};

async function commit(orgId: number, csv: string, fileName: string, asOf: string, excludeRows: number[] = []) {
  const { readNoteTape, suggestNoteTapeMapping, validateNoteTape } = await import("../../server/services/notes/noteTapeImport");
  const { commitNoteTape } = await import("../../server/services/notes/noteTapeCommit");
  const { sheet, sha256 } = readNoteTape(csv);
  const r = await commitNoteTape({ organizationId: orgId, actorUserId: `${tag}-u`, fileName, fileSha256: sha256, asOf, validation: validateNoteTape({ sheet, mapping: suggestNoteTapeMapping(sheet.headers).mapping }), excludeRows });
  if (r.status !== "committed") throw new Error(JSON.stringify(r));
  return r;
}

describe.runIf(realDbAvailable)("note disagreement and negative knowledge — real database", () => {
  beforeAll(async () => {
    const { db } = await import("../../server/db");
    const { organizations } = await import("@shared/schema");
    for (const suffix of ["a", "b"]) {
      const [org] = await db.insert(organizations).values({ name: `${tag}-${suffix}`, slug: `${tag}-${suffix}`, ownerId: `${tag}-${suffix}` } as never).returning();
      orgIds.push(org.id);
    }
    const r = await commit(orgIds[0], golden, "golden-sep.csv", "2026-09-30", [4, 5]);
    for (const n of r.notes) noteIds[n.noteNumber] = n.noteId;
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

  it("no disagreement after one tape; a field blank on it reads 'blank on the source', one it never had reads 'never stated'", async () => {
    const { buildNoteRecord } = await import("../../server/services/notes/noteRecord");
    const r = (await buildNoteRecord(orgIds[0], noteIds["SYNTH-1001"]))!;
    expect([...r.terms, ...r.yieldFields].filter((t) => t.disagreement)).toEqual([]);
    expect(r.yieldFields.find((t) => t.field === "balloonAmount")).toMatchObject({ value: null, absence: { status: "blank_on_source", column: "Balloon", fileName: "golden-sep.csv" } });
    expect(r.yieldFields.find((t) => t.field === "nextPaymentDate")).toMatchObject({ value: null, absence: { status: "never_stated" } });
    expect(r.terms.find((t) => t.field === "currentBalance")).toMatchObject({ absence: null });
  });

  it("another org's tape for the same loan number is not a disagreement here", async () => {
    await commit(orgIds[1], OCT, "other-org.csv", "2026-10-20");
    const { buildNoteRecord } = await import("../../server/services/notes/noteRecord");
    const r = (await buildNoteRecord(orgIds[0], noteIds["SYNTH-1001"]))!;
    expect(r.terms.find((t) => t.field === "currentBalance")!.disagreement).toBeNull();
  });

  it("a later tape that disagrees is kept beside the first: both values, both sources, the book unchanged", async () => {
    const res = await commit(orgIds[0], OCT, "tape-oct.csv", "2026-10-20");
    expect(res.notes[0]).toMatchObject({ created: false, differingFields: expect.arrayContaining(["currentBalance", "interestRate"]) });
    const { buildNoteRecord } = await import("../../server/services/notes/noteRecord");
    const r = (await buildNoteRecord(orgIds[0], noteIds["SYNTH-1001"]))!;
    const bal = r.terms.find((t) => t.field === "currentBalance")!;
    expect(bal.value).toBe(8425000);
    expect(bal.disagreement).toMatchObject({
      bookValueIs: 0,
      values: [
        { value: 8425000, observations: [expect.objectContaining({ asOf: "2026-09-30", sourceRef: expect.objectContaining({ fileName: "golden-sep.csv", raw: "$84,250.00" }) })] },
        { value: 8390000, observations: [expect.objectContaining({ asOf: "2026-10-20", sourceRef: expect.objectContaining({ fileName: "tape-oct.csv", raw: "$83,900.00" }) })] },
      ],
    });
    expect(r.terms.find((t) => t.field === "interestRate")!.disagreement!.values.map((v) => v.value)).toEqual([850, 875]);
    // Fields both tapes agree on are not disagreements.
    expect(r.terms.find((t) => t.field === "maturityDate")!.disagreement).toBeNull();
    // A later tape WITHOUT a balloon column does not turn "blank on the source" into "never stated".
    expect(r.yieldFields.find((t) => t.field === "balloonAmount")!.absence).toMatchObject({ status: "blank_on_source", fileName: "golden-sep.csv" });

    const { db } = await import("../../server/db");
    const { sql } = await import("drizzle-orm");
    const book = await db.execute(sql`SELECT current_balance_cents::bigint AS b, interest_rate_bps AS r FROM acquired_notes WHERE id = ${noteIds["SYNTH-1001"]}`);
    expect((book as { rows: Array<{ b: string; r: number }> }).rows[0]).toMatchObject({ r: 850 });
    expect(Number((book as { rows: Array<{ b: string }> }).rows[0].b)).toBe(8425000);
  });

  it("a later tape that fills a field the book holds blank is a disagreement too — the book says none, the source says a value", async () => {
    const NOV = "Loan #,Borrower,Orig Balance,UPB,Note Rate,Term,P&I,Due Day,Note Date,Maturity,Purchase Date,Purchase Price,Loan Status,Balloon,Original Note,Mortgage/DOT,Assignments\nSYNTH-1001,SYNTHETIC Borrower One,\"$120,000.00\",\"$84,250.00\",8.5%,360,922.70,1,2015-03-01,2045-03-01,2026-09-15,\"$61,500.00\",Performing,\"$40,000.00\",Yes,Yes,Yes\n";
    await commit(orgIds[0], NOV, "tape-nov.csv", "2026-11-01");
    const { buildNoteRecord } = await import("../../server/services/notes/noteRecord");
    const r = (await buildNoteRecord(orgIds[0], noteIds["SYNTH-1001"]))!;
    const balloon = r.yieldFields.find((t) => t.field === "balloonAmount")!;
    expect(balloon.value).toBeNull();
    expect(balloon.disagreement).toMatchObject({ bookValueIs: null, values: [{ value: 4000000 }] });
  });
});
