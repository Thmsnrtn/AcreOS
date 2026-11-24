/**
 * Notes N7 — the tape commit carries the operator's servicing declaration, and
 * that declaration is what lets a self-servicing operator's note qualify for the
 * periodic-statement duty.
 *
 *   - the commit service refuses a missing / invalid arrangement (no silent
 *     column default) and writes nothing;
 *   - a NEW note is inserted with the chosen arrangement, and a provenance row
 *     records it as the operator's declaration, not the tape's;
 *   - a note the org already holds keeps its arrangement — re-import never flips
 *     it — and the result REPORTS it was kept;
 *   - PARITY: the row the commit writes, run through the real predicate
 *     (predicate.ts, unmodified), qualifies when self_serviced and a dwelling /
 *     consumer-purpose note, and does not for any other arrangement.
 *     (isConsumerPurpose / collateralIsDwelling are not tape fields — they are
 *     set on the fixture, as they are set elsewhere in the product.)
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { getTableName } from "drizzle-orm";

const h = vi.hoisted(() => ({
  existing: [] as Array<{ organizationId: number; noteNumber: string; id: string; servicingArrangement: string }>,
  ownership: [] as Array<{ id: string }>,
  inserts: [] as Array<{ table: string; values: any }>,
}));

vi.mock("../../server/services/landData/resolveOwnedParcelRef", () => ({ resolveOwnedParcelRef: async () => null }));
vi.mock("../../server/db", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const dialect = new PgDialect();
  const tx = {
    select: () => ({
      from: (table: unknown) => {
        const name = getTableName(table as any);
        const rows = (w?: unknown) => {
          if (name === "acquired_notes") {
            const { params } = dialect.sqlToQuery(w as any);
            return h.existing.filter((e) => params.includes(e.noteNumber) && params.includes(e.organizationId)).map((e) => ({ id: e.id, servicingArrangement: e.servicingArrangement }));
          }
          return [];
        };
        let w: unknown;
        const chain: any = {
          where: (x: unknown) => { w = x; return chain; },
          orderBy: () => chain,
          limit: () => Promise.resolve(rows(w)),
          then: (f: any, r: any) => Promise.resolve(rows(w)).then(f, r),
        };
        return chain;
      },
    }),
    insert: (table: unknown) => ({
      values: (v: any) => {
        h.inserts.push({ table: getTableName(table as any), values: v });
        const p: any = Promise.resolve(undefined);
        p.returning = async () => [{ id: `note-${h.inserts.filter((i) => i.table === "acquired_notes").length}` }];
        return p;
      },
    }),
  };
  const fakeDb = {
    // The predicate's gate 4 reads the ownership-of-record table.
    select: () => ({ from: () => ({ where: () => ({ limit: async () => h.ownership }) }) }),
  };
  return { ...actual, db: fakeDb, withTransaction: async (fn: (t: unknown) => unknown) => fn(tx) };
});

import { commitNoteTape } from "../../server/services/notes/noteTapeCommit";
import { readNoteTape, suggestNoteTapeMapping, validateNoteTape } from "../../server/services/notes/noteTapeImport";
import { qualifiesForRegZStatement, qualifiesForRegZStatementSync } from "../../server/services/periodicStatements/predicate";
import { SERVICING_ARRANGEMENTS } from "@shared/notes/servicingArrangement";
import type { AcquiredNote } from "@shared/schema/notes-vertical";

const csv = readFileSync(path.join(__dirname, "../../shared/notes/golden/note-tape-golden.csv"), "utf8");
const { sheet, sha256 } = readNoteTape(csv);
const validation = validateNoteTape({ sheet, mapping: suggestNoteTapeMapping(sheet.headers).mapping });
const base = { organizationId: 41, actorUserId: "u-41", fileName: "golden.csv", fileSha256: sha256, asOf: null, validation, excludeRows: [4, 5] };
const noteInserts = () => h.inserts.filter((i) => i.table === "acquired_notes").map((i) => i.values);

beforeEach(() => {
  h.existing = [];
  h.ownership = [];
  h.inserts = [];
});

describe("commitNoteTape — servicing arrangement", () => {
  it.each([undefined, null, "", "compliant"])("refuses %j and writes nothing", async (bad) => {
    const r = await commitNoteTape({ ...base, servicingArrangement: bad as any });
    expect(r.status).toBe("refused");
    expect((r as any).reason).toMatch(/who services/i);
    expect(h.inserts).toHaveLength(0);
  });

  it.each(SERVICING_ARRANGEMENTS)("writes %s on every new note, with the operator's declaration on the ledger", async (arrangement) => {
    const r = await commitNoteTape({ ...base, servicingArrangement: arrangement });
    expect(r.status).toBe("committed");
    const inserted = noteInserts();
    expect(inserted).toHaveLength(3);
    for (const v of inserted) expect(v.servicingArrangement).toBe(arrangement);
    const ledger = h.inserts.filter((i) => i.table === "note_field_observations").flatMap((i) => i.values).filter((o: any) => o.field === "servicingArrangement");
    expect(ledger).toHaveLength(3);
    for (const o of ledger) expect(o).toMatchObject({ kind: "value", value: arrangement, source: "edit", recordedBy: "u-41", organizationId: 41 });
    if (r.status === "committed") for (const n of r.notes) expect(n).toMatchObject({ created: true, servicingArrangement: arrangement, servicingArrangementKept: false });
  });

  it("a note the org already holds keeps its arrangement and the result says so", async () => {
    const heldNumber = validation.valid[0].noteNumber;
    h.existing = [{ organizationId: 41, noteNumber: heldNumber, id: "held-1", servicingArrangement: "sub_serviced" }];
    const r = await commitNoteTape({ ...base, servicingArrangement: "self_serviced" });
    expect(r.status).toBe("committed");
    if (r.status !== "committed") return;
    const held = r.notes.find((n) => n.noteNumber === heldNumber)!;
    expect(held).toMatchObject({ created: false, noteId: "held-1", servicingArrangement: "sub_serviced", servicingArrangementKept: true });
    // Not inserted again, and no declaration recorded against it.
    expect(noteInserts().map((v) => v.noteNumber)).not.toContain(heldNumber);
    const ledger = h.inserts.filter((i) => i.table === "note_field_observations").flatMap((i) => i.values).filter((o: any) => o.field === "servicingArrangement");
    expect(ledger.map((o: any) => o.noteId)).not.toContain("held-1");
    // The other two were created with the chosen arrangement.
    expect(r.notes.filter((n) => n.created).map((n) => n.servicingArrangement)).toEqual(["self_serviced", "self_serviced"]);
  });

  it("another organization's note with the same loan number is not 'held' — it gets its own arrangement", async () => {
    h.existing = [{ organizationId: 99, noteNumber: validation.valid[0].noteNumber, id: "other-org", servicingArrangement: "sub_serviced" }];
    const r = await commitNoteTape({ ...base, servicingArrangement: "self_serviced" });
    expect(r.status === "committed" && r.notes.every((n) => n.created && n.servicingArrangement === "self_serviced")).toBe(true);
  });
});

describe("parity — what the commit writes is what the periodic-statement predicate reads", () => {
  const rowFromCommit = (written: Record<string, unknown>): AcquiredNote =>
    ({
      id: "00000000-0000-0000-0000-0000000000aa",
      ...written,
      // Not tape fields: set the way the rest of the product sets them.
      isConsumerPurpose: true,
      collateralIsDwelling: true,
    }) as unknown as AcquiredNote;

  it("a note committed self_serviced, dwelling + consumer purpose, QUALIFIES (sync and DB-backed paths)", async () => {
    await commitNoteTape({ ...base, servicingArrangement: "self_serviced" });
    const row = rowFromCommit(noteInserts()[0]);
    expect(row.servicingArrangement).toBe("self_serviced");
    const sync = qualifiesForRegZStatementSync({ kind: "acquired_note", row });
    expect(sync).toMatchObject({ qualifies: true });
    h.ownership = [{ id: "own-1" }];
    expect(await qualifiesForRegZStatement({ kind: "acquired_note", row }, 41)).toMatchObject({ qualifies: true });
  });

  it.each(["sub_serviced", "seller_retained", "passive_holder"] as const)("the same note committed %s does NOT qualify, and the skip says why", async (arrangement) => {
    await commitNoteTape({ ...base, servicingArrangement: arrangement });
    const row = rowFromCommit(noteInserts()[0]);
    const r = qualifiesForRegZStatementSync({ kind: "acquired_note", row });
    expect(r.qualifies).toBe(false);
    expect(r.skipReason).toContain(arrangement);
  });
});
