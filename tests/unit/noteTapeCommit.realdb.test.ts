/**
 * V-Notes-1 N1 — the note-tape commit against a REAL database built from this
 * repository (migration 0292). SYNTHETIC tape (the golden fixture); a fresh org
 * per run.
 *
 * What a mock cannot prove:
 *   - a refused commit writes NOTHING;
 *   - a commit writes the notes and one provenance row per stated field, and
 *     collateral lands as matched / searched-none / never-searched;
 *   - a re-import of the same loan number appends beside the old value and
 *     never overwrites the book row (N4's raw material);
 *   - the observations are append-only in the database itself;
 *   - another org importing the same loan numbers gets ITS OWN notes — no
 *     cross-org path in the import;
 *   - deleteOrganization still completes, and the history leaves with the notes.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { realDbAvailable, useRealDb } from "../helpers/realDb";

useRealDb("noteTapeCommit.realdb.test.ts");
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const tag = `n1${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const apnMatched = `SYNTH-${tag}-001`;
const tape = readFileSync(path.join(__dirname, "../../shared/notes/golden/note-tape-golden.csv"), "utf8").replace("SYNTH-0101-001", apnMatched);
const orgIds: number[] = [];
let seededParcelId: number | null = null;

async function newOrg(suffix: string): Promise<number> {
  const { db } = await import("../../server/db");
  const { organizations } = await import("@shared/schema");
  const [o] = await db.insert(organizations).values({ name: `${tag}-${suffix}`, slug: `${tag}-${suffix}`, ownerId: `${tag}-${suffix}` } as never).returning();
  orgIds.push(o.id);
  return o.id;
}

async function validate(text: string, overrides = {}) {
  const { readNoteTape, suggestNoteTapeMapping, validateNoteTape } = await import("../../server/services/notes/noteTapeImport");
  const { sheet, sha256 } = readNoteTape(text);
  return { sha256, validation: validateNoteTape({ sheet, mapping: suggestNoteTapeMapping(sheet.headers).mapping, overrides }) };
}

const count = (r: unknown) => (r as { rows: Array<{ n: number }> }).rows[0].n;

describe.runIf(realDbAvailable)("note-tape commit — real database", () => {
  afterAll(async () => {
    const { db, pool } = await import("../../server/db");
    const { sql } = await import("drizzle-orm");
    for (const id of orgIds) {
      await db.execute(sql`DELETE FROM acquired_notes WHERE organization_id = ${id}`).catch(() => undefined);
      await db.execute(sql`DELETE FROM organizations WHERE id = ${id}`).catch(() => undefined);
    }
    if (seededParcelId) await db.execute(sql`DELETE FROM parcel_snapshots WHERE id = ${seededParcelId}`).catch(() => undefined);
    await pool.end();
  });

  it("refuses while any row is unfixed and unexcluded — and writes nothing", async () => {
    const orgId = await newOrg("refuse");
    const { commitNoteTape } = await import("../../server/services/notes/noteTapeCommit");
    const { db } = await import("../../server/db");
    const { sql } = await import("drizzle-orm");
    const { sha256, validation } = await validate(tape);
    const r = await commitNoteTape({ organizationId: orgId, actorUserId: `${tag}-u`, fileName: "golden.csv", fileSha256: sha256, asOf: null, validation, excludeRows: [] });
    expect(r).toMatchObject({ status: "refused", unresolvedRows: [4, 5] });
    expect(count(await db.execute(sql`SELECT count(*)::int AS n FROM acquired_notes WHERE organization_id = ${orgId}`))).toBe(0);
  });

  it("commits the notes with provenance; collateral is matched, searched-none, or never searched", async () => {
    const orgId = await newOrg("commit");
    const { db } = await import("../../server/db");
    const { sql } = await import("drizzle-orm");
    const { parcelSnapshots } = await import("@shared/schema");
    const { ownedApn, OWNED_SNAPSHOT_SOURCE } = await import("../../server/services/landData/ownedParcelStore");
    const [p] = await db
      .insert(parcelSnapshots)
      .values({ apn: ownedApn("NC", "wake", apnMatched)!, state: "NC", county: "wake", source: OWNED_SNAPSHOT_SOURCE, organizationId: null, parcelKey: `pk-${tag}` } as never)
      .returning({ id: parcelSnapshots.id });
    seededParcelId = p.id;

    const { commitNoteTape } = await import("../../server/services/notes/noteTapeCommit");
    const { sha256, validation } = await validate(tape);
    const r = await commitNoteTape({ organizationId: orgId, actorUserId: `${tag}-u`, fileName: "golden.csv", fileSha256: sha256, asOf: "2026-09-30", validation, excludeRows: [4, 5] });
    if (r.status !== "committed") throw new Error(JSON.stringify(r));
    expect(r).toMatchObject({ created: 3, appendedToExisting: 0, excludedRows: [4, 5] });
    expect(r.notes.map((n) => [n.noteNumber, n.collateral, n.documentsIncomplete])).toEqual([
      ["SYNTH-1001", "matched", false],
      ["SYNTH-1002", "not_searched", true],
      ["SYNTH-1005", "unmatched", false],
    ]);

    const n1001 = r.notes[0].noteId;
    const book = await db.execute(sql`SELECT interest_rate_bps, current_balance_cents, remaining_term_months, balloon_amount_cents FROM acquired_notes WHERE id = ${n1001} AND organization_id = ${orgId}`);
    expect((book as unknown as { rows: unknown[] }).rows[0]).toEqual({ interest_rate_bps: 850, current_balance_cents: "8425000", remaining_term_months: 221, balloon_amount_cents: null });
    const obs = await db.execute(sql`SELECT field, kind, value, source, source_ref, as_of::text AS as_of, confidence FROM note_field_observations WHERE note_id = ${n1001} AND organization_id = ${orgId} ORDER BY field`);
    const rows = (obs as unknown as { rows: Array<Record<string, unknown>> }).rows;
    const bal = rows.find((x) => x.field === "currentBalance")!;
    expect(bal).toMatchObject({ kind: "value", value: 8425000, source: "note_tape", as_of: "2026-09-30", confidence: "medium" });
    expect(bal.source_ref).toMatchObject({ fileName: "golden.csv", fileSha256: sha256, fileRow: 2, column: "UPB", raw: "$84,250.00" });
    expect(rows.find((x) => x.field === "collateral.parcel")).toMatchObject({ kind: "value", source: "warehouse", value: expect.objectContaining({ parcelKey: `pk-${tag}`, apid: null }) });
    // A field the tape left blank has no row at all (unknown), never a 0.
    expect(rows.find((x) => x.field === "balloonAmount")).toBeUndefined();
    const unmatched = await db.execute(sql`SELECT kind, value FROM note_field_observations WHERE note_id = ${r.notes[2].noteId} AND field = 'collateral.parcel'`);
    expect((unmatched as unknown as { rows: unknown[] }).rows).toEqual([{ kind: "searched_none", value: null }]);
    const notSearched = await db.execute(sql`SELECT count(*)::int AS n FROM note_field_observations WHERE note_id = ${r.notes[1].noteId} AND field = 'collateral.parcel'`);
    expect(count(notSearched)).toBe(0);

    // Re-import: the same loan number, a different balance. Appended, never overwritten.
    const changed = tape.replace('"$84,250.00"', '"$83,900.00"');
    const again = await validate(changed);
    const r2 = await commitNoteTape({ organizationId: orgId, actorUserId: `${tag}-u`, fileName: "golden-v2.csv", fileSha256: again.sha256, asOf: null, validation: again.validation, excludeRows: [4, 5] });
    if (r2.status !== "committed") throw new Error(JSON.stringify(r2));
    expect(r2).toMatchObject({ created: 0, appendedToExisting: 3 });
    expect(r2.notes[0]).toMatchObject({ noteId: n1001, differingFields: ["currentBalance"] });
    const bals = await db.execute(sql`SELECT value FROM note_field_observations WHERE note_id = ${n1001} AND field = 'currentBalance' ORDER BY observed_at`);
    expect((bals as unknown as { rows: Array<{ value: number }> }).rows.map((x) => x.value)).toEqual([8425000, 8390000]);
    const still = await db.execute(sql`SELECT current_balance_cents FROM acquired_notes WHERE id = ${n1001}`);
    expect((still as unknown as { rows: Array<{ current_balance_cents: string }> }).rows[0].current_balance_cents).toBe("8425000");

    // Append-only in the database: no edit, no direct delete, no truncate.
    const codeOf = (q: Promise<unknown>) => q.then(() => null, (e: { code?: string; cause?: { code?: string } }) => e.code ?? e.cause?.code);
    expect(await codeOf(db.execute(sql`UPDATE note_field_observations SET field = 'x' WHERE note_id = ${n1001}`))).toBe("23001");
    expect(await codeOf(db.execute(sql`DELETE FROM note_field_observations WHERE note_id = ${n1001}`))).toBe("23503");
    expect(await codeOf(db.execute(sql`TRUNCATE note_field_observations`))).toBe("23001");
  });

  it("another org importing the same loan numbers gets its own notes — the import has no cross-org path", async () => {
    const a = orgIds[1];
    const b = await newOrg("other");
    const { commitNoteTape } = await import("../../server/services/notes/noteTapeCommit");
    const { db } = await import("../../server/db");
    const { sql } = await import("drizzle-orm");
    const { sha256, validation } = await validate(tape);
    const r = await commitNoteTape({ organizationId: b, actorUserId: `${tag}-u2`, fileName: "golden.csv", fileSha256: sha256, asOf: null, validation, excludeRows: [4, 5] });
    if (r.status !== "committed") throw new Error(JSON.stringify(r));
    expect(r).toMatchObject({ created: 3, appendedToExisting: 0 });
    for (const n of r.notes) expect(n.differingFields).toEqual([]);
    const own = await db.execute(sql`SELECT count(*)::int AS n FROM acquired_notes WHERE organization_id = ${b}`);
    expect(count(own)).toBe(3);
    const leaked = await db.execute(sql`SELECT count(*)::int AS n FROM note_field_observations o JOIN acquired_notes n ON n.id = o.note_id WHERE o.organization_id = ${b} AND n.organization_id = ${a}`);
    expect(count(leaked)).toBe(0);
  });

  it("deleteOrganization completes for an org holding imported notes, and their history leaves with them", async () => {
    const orgId = orgIds[1];
    const { deleteOrganization } = await import("../../server/services/orgDeletion");
    const { db } = await import("../../server/db");
    const { sql } = await import("drizzle-orm");
    expect(count(await db.execute(sql`SELECT count(*)::int AS n FROM note_field_observations WHERE organization_id = ${orgId}`))).toBeGreaterThan(0);
    const result = await deleteOrganization(orgId);
    expect(result).toMatchObject({ orgRowDeleted: true, residualTables: [] });
    expect(count(await db.execute(sql`SELECT count(*)::int AS n FROM note_field_observations WHERE organization_id = ${orgId}`))).toBe(0);
    expect(count(await db.execute(sql`SELECT count(*)::int AS n FROM acquired_notes WHERE organization_id = ${orgId}`))).toBe(0);
  });
});
