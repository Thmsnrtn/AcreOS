/**
 * HYB-DEF-1 — deleting a parcel that secures a live serviced note must refuse.
 *
 * Proven on staging by the Hybrid seam walk (org 126, 2026-11-20):
 * `DELETE /api/properties/1048` returned 204 while serviced note 64
 * (active, $52,833.28) and note 65 (pending) were secured by that parcel.
 * The delete is a soft delete and the notes survive, so nothing was
 * destroyed — the defect is the missing guard at the seam: the land book
 * could delete the collateral out from under the notes book with nothing
 * said.
 *
 * The cure follows the codebase's guarded-delete idiom (the rental-unit
 * guard, `unitDeletionRefusal` in server/routes-rentals.ts): a pure
 * refusal predicate, a 400 via Errors.badRequest, and a structured
 * `code` in details naming what is in the way.
 *
 * The status predicate is the code's own serviced-note model, verified
 * against three agreeing sources: the `notes.status` column comment in
 * shared/schema.ts, the note-update zod enum in server/routes-finance.ts,
 * and the Pax tool enum in server/ai/tools.ts — all five values are
 * pending | active | paid_off | defaulted | foreclosed. Terminal states
 * (paid_off, foreclosed, and sold — named "finished" alongside the first
 * two by server/services/borrower/portalPaymentPosting.ts) must NOT
 * block; every live state must.
 *
 * There is no DATABASE_URL in this environment, so the predicate is
 * tested as a pure function and the route wiring is asserted against the
 * route file AS CODE (comments stripped first), exactly as
 * rentalUnitWriters.test.ts does for the guard this one mirrors.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { stripComments } from "../helpers/stripComments";
import {
  propertyDeletionRefusal,
  liveSecuringNotes,
  TERMINAL_SERVICED_NOTE_STATUSES,
} from "../../server/routes-properties";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.resolve(ROOT, p), "utf-8");
const code = (src: string) => stripComments(src);

/** The body of one Express handler, comment-free: from its registration to the next one. */
function handler(src: string, registration: string): string {
  const stripped = code(src);
  const start = stripped.indexOf(registration);
  expect(start, `handler not found: ${registration}`).toBeGreaterThanOrEqual(0);
  const rest = stripped.slice(start + registration.length);
  const next = rest.search(/\n\s*api\.(get|post|patch|put|delete)\(/);
  return rest.slice(0, next === -1 ? undefined : next);
}

const PROPERTIES_SRC = read("server/routes-properties.ts");

describe("HYB-DEF-1 predicate — the serviced-note status model", () => {
  it("terminal states are exactly the finished states of the model", () => {
    expect([...TERMINAL_SERVICED_NOTE_STATUSES].sort()).toEqual(
      ["foreclosed", "paid_off", "sold"].sort(),
    );
  });

  it("every live status in the model blocks: pending, active, defaulted", () => {
    for (const status of ["pending", "active", "defaulted"]) {
      expect(liveSecuringNotes([{ id: 1, status }])).toHaveLength(1);
    }
  });

  it("every terminal status in the model does not block", () => {
    for (const status of ["paid_off", "foreclosed", "sold"]) {
      expect(liveSecuringNotes([{ id: 1, status }])).toHaveLength(0);
    }
  });
});

describe("HYB-DEF-1 — propertyDeletionRefusal", () => {
  it("unencumbered property: deletable", () => {
    expect(propertyDeletionRefusal([])).toBeNull();
  });

  it("active note (the walked defect, note 64): refused, note named", () => {
    const msg = propertyDeletionRefusal([{ id: 64, status: "active" }]);
    expect(msg).not.toBeNull();
    expect(msg).toContain("note 64 (active)");
    expect(msg).toContain("still secures");
  });

  it("pending and defaulted notes are live and also refuse", () => {
    expect(propertyDeletionRefusal([{ id: 65, status: "pending" }])).toContain("note 65 (pending)");
    expect(propertyDeletionRefusal([{ id: 66, status: "defaulted" }])).toContain("note 66 (defaulted)");
  });

  it("terminal-note property: deletable (paid_off / foreclosed / sold do not block)", () => {
    expect(propertyDeletionRefusal([{ id: 70, status: "paid_off" }])).toBeNull();
    expect(propertyDeletionRefusal([{ id: 71, status: "foreclosed" }])).toBeNull();
    expect(propertyDeletionRefusal([{ id: 72, status: "sold" }])).toBeNull();
  });

  it("mixed book: only the live notes are named, terminal ones are not", () => {
    const msg = propertyDeletionRefusal([
      { id: 64, status: "active" },
      { id: 70, status: "paid_off" },
    ]);
    expect(msg).not.toBeNull();
    expect(msg).toContain("note 64 (active)");
    expect(msg).not.toContain("note 70");
  });

  it("several live notes: all named", () => {
    const msg = propertyDeletionRefusal([
      { id: 64, status: "active" },
      { id: 65, status: "pending" },
    ]);
    expect(msg).toContain("2 live serviced notes");
    expect(msg).toContain("note 64 (active)");
    expect(msg).toContain("note 65 (pending)");
  });

  it("offers the non-destructive path instead of a dead end", () => {
    const msg = propertyDeletionRefusal([{ id: 64, status: "active" }]);
    expect(msg).toContain("Pay off, foreclose, or sell the note first");
  });
});

describe("HYB-DEF-1 — route wiring", () => {
  it("single delete counts securing notes and short-circuits BEFORE the delete", () => {
    const del = handler(PROPERTIES_SRC, `api.delete("/api/properties/:id"`);
    expect(del).toContain("propertyDeletionRefusal(");
    const refusalAt = del.indexOf("propertyDeletionRefusal(");
    const deleteAt = del.indexOf("storage.deleteProperty(");
    expect(refusalAt).toBeGreaterThanOrEqual(0);
    expect(deleteAt).toBeGreaterThan(refusalAt);
    // The lookup is over notes pointing at THIS property, org-scoped,
    // and ignores soft-deleted notes.
    expect(del).toContain("eq(notes.organizationId, org.id)");
    expect(del).toContain("eq(notes.propertyId, propertyId)");
    expect(del).toContain("isNull(notes.deletedAt)");
    // The refusal is the guarded-delete idiom: Errors.badRequest with a
    // structured code naming the live securing notes.
    expect(del).toContain("Errors.badRequest(res, refusal");
    expect(del).toContain(`code: "PROPERTY_SECURES_LIVE_NOTE"`);
    expect(del).toContain("liveSecuringNotes(securingNotes)");
  });

  it("bulk delete applies the same guard BEFORE the bulk delete", () => {
    const bulk = handler(PROPERTIES_SRC, `api.post("/api/properties/bulk-delete"`);
    expect(bulk).toContain("propertyDeletionRefusal(");
    const refusalAt = bulk.indexOf("propertyDeletionRefusal(");
    const deleteAt = bulk.indexOf("storage.bulkDeleteProperties(");
    expect(refusalAt).toBeGreaterThanOrEqual(0);
    expect(deleteAt).toBeGreaterThan(refusalAt);
    expect(bulk).toContain("inArray(notes.propertyId, ids)");
    expect(bulk).toContain(`code: "PROPERTY_SECURES_LIVE_NOTE"`);
  });
});
