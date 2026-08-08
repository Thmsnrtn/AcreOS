// Pins the creative-finance balloon lifecycle emitter (audit Wave 1, beta→core):
// note.balloon_approaching had ZERO emitters, so its two templates
// (tpl_balloon_approaching / tpl_note_balloon_approaching_extended) sat idle
// forever. This test fixes the new truth — the event fires ONLY for a note that
// is genuinely in the balloon window (active, maturityDate within 90 days, a
// positive balance), carries only real note + joined-borrower fields (never a
// fabricated precise balloon payoff — only the approximate OUTSTANDING balance),
// suppresses the recipient honestly when the borrower email is null, and is
// fire-and-forget. It also pins the notePaymentDueDetector balloon fold-in's
// exactly-once dedupe by source order (the same shape paymentWorkflowEvents pins
// for payment.missed).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import path from "path";

const { emitNoteEvent, dbSelect, limitResults } = vi.hoisted(() => {
  const limitResults: any[][] = [];
  const chain: any = {};
  chain.from = () => chain;
  chain.where = () => chain;
  chain.limit = () => Promise.resolve(limitResults.length ? limitResults.shift() : []);
  return { emitNoteEvent: vi.fn(), dbSelect: () => chain, limitResults };
});

vi.mock("../../server/services/workflow-engine", () => ({ emitNoteEvent }));
vi.mock("../../server/db", () => ({ db: { select: dbSelect } }));
vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  emitNoteBalloonApproaching,
  type NoteBalloonRow,
} from "../../server/services/noteEvents";

// Fixed clock — the env's "today". A note maturing 2026-10-01 is 54 days out.
const now = new Date("2026-08-08T00:00:00.000Z");

const activeNote: NoteBalloonRow = {
  id: 42,
  organizationId: 7,
  propertyId: 100,
  borrowerId: 5,
  status: "active",
  maturityDate: new Date("2026-10-01T00:00:00.000Z"),
  currentBalance: "45000.00",
};

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  limitResults.length = 0;
  emitNoteEvent.mockReset();
});
afterEach(() => {
  limitResults.length = 0;
});

describe("emitNoteBalloonApproaching", () => {
  it("fires note.balloon_approaching for an active note in the 90-day window, with only real fields", async () => {
    // db returns the borrower (leads) then the org (organizations), in that order.
    limitResults.push(
      [{ firstName: "Maria", lastName: "Delgado", email: "maria@example.com" }],
      [{ name: "Smith Land LLC" }],
    );

    emitNoteBalloonApproaching(activeNote, now);
    await flush();

    expect(emitNoteEvent).toHaveBeenCalledTimes(1);
    const [event, orgId, entityId, data] = emitNoteEvent.mock.calls[0];
    expect(event).toBe("note.balloon_approaching");
    expect(orgId).toBe(7);
    expect(entityId).toBe(100); // propertyId is the numeric entity handle
    expect(data.noteId).toBe(42);
    expect(data.balloonDate).toBe("2026-10-01"); // from notes.maturityDate
    expect(data.daysToBalloon).toBe(54);
    // The money field is the APPROXIMATE outstanding balance — a real number,
    // never a precise "balloon payment amount" (that lives in the schedule).
    expect(data.outstandingBalance).toBe(45000);
    expect(data.balloonAmount).toBeUndefined(); // the fabrication never returns
    expect(data.borrowerName).toBe("Maria Delgado");
    expect(data.borrowerFirstName).toBe("Maria");
    expect(data.borrowerEmail).toBe("maria@example.com");
    expect(data.orgName).toBe("Smith Land LLC");
  });

  it("uses the note's own numeric id as the entity handle when no property is attached", async () => {
    limitResults.push(
      [{ firstName: "Maria", lastName: "Delgado", email: "maria@example.com" }],
      [{ name: "Smith Land LLC" }],
    );

    emitNoteBalloonApproaching({ ...activeNote, propertyId: null }, now);
    await flush();

    expect(emitNoteEvent).toHaveBeenCalledTimes(1);
    const [, , entityId, data] = emitNoteEvent.mock.calls[0];
    expect(entityId).toBe(42); // falls back to notes.id (a serial — always numeric)
    expect(data.noteId).toBe(42);
  });

  it("passes a null borrower email through (suppresses the recipient), never fabricated", async () => {
    limitResults.push(
      [{ firstName: "Maria", lastName: "Delgado", email: null }],
      [{ name: "Smith Land LLC" }],
    );

    emitNoteBalloonApproaching(activeNote, now);
    await flush();

    const [, , , data] = emitNoteEvent.mock.calls[0];
    expect(data.borrowerEmail).toBeNull();
    expect(data.borrowerName).toBe("Maria Delgado");
  });

  it("emits null borrower fields for an unlinked note (no borrower row queried)", async () => {
    // borrowerId null → resolveBorrower is skipped; only the org read runs.
    limitResults.push([{ name: "Smith Land LLC" }]);

    emitNoteBalloonApproaching({ ...activeNote, borrowerId: null }, now);
    await flush();

    const [, , , data] = emitNoteEvent.mock.calls[0];
    expect(data.borrowerName).toBeNull();
    expect(data.borrowerFirstName).toBeNull();
    expect(data.borrowerEmail).toBeNull();
    expect(data.orgName).toBe("Smith Land LLC");
  });

  it("the money field is null-safe (a genuinely-absent balance would not fabricate a 0)", () => {
    // The guard rejects a non-positive / absent balance outright — nothing
    // outstanding to balloon — so no emit and no invented figure.
    emitNoteBalloonApproaching({ ...activeNote, currentBalance: "0" }, now);
    emitNoteBalloonApproaching({ ...activeNote, currentBalance: null }, now);
    expect(emitNoteEvent).not.toHaveBeenCalled();
  });

  it("no-ops (synchronously) outside the balloon window / on a non-qualifying note", () => {
    // non-active
    emitNoteBalloonApproaching({ ...activeNote, status: "paid_off" }, now);
    // no maturity date (month-to-... / never set) → no signal
    emitNoteBalloonApproaching({ ...activeNote, maturityDate: null }, now);
    // already matured (in the past) → not "approaching"
    emitNoteBalloonApproaching(
      { ...activeNote, maturityDate: new Date("2026-07-01T00:00:00.000Z") },
      now,
    );
    // beyond the 90-day window
    emitNoteBalloonApproaching(
      { ...activeNote, maturityDate: new Date("2026-12-01T00:00:00.000Z") },
      now,
    );
    expect(emitNoteEvent).not.toHaveBeenCalled();
  });

  it("fires exactly at the window edges (0 and 90 days), never past them", async () => {
    limitResults.push([], [], [], []); // borrower/org reads return nothing
    // exactly 90 days out
    emitNoteBalloonApproaching(
      { ...activeNote, maturityDate: new Date("2026-11-06T00:00:00.000Z") },
      now,
    );
    // exactly today (0 days)
    emitNoteBalloonApproaching(
      { ...activeNote, maturityDate: new Date("2026-08-08T00:00:00.000Z") },
      now,
    );
    await flush();
    expect(emitNoteEvent).toHaveBeenCalledTimes(2);
    expect(emitNoteEvent.mock.calls[0][3].daysToBalloon).toBe(90);
    expect(emitNoteEvent.mock.calls[1][3].daysToBalloon).toBe(0);
  });

  it("is fire-and-forget: a db/emit fault never throws out of the emitter", async () => {
    emitNoteEvent.mockImplementation(() => {
      throw new Error("workflow engine exploded");
    });
    limitResults.push(
      [{ firstName: "Maria", lastName: "Delgado", email: "maria@example.com" }],
      [{ name: "Smith Land LLC" }],
    );
    expect(() => emitNoteBalloonApproaching(activeNote, now)).not.toThrow();
    await flush(); // the swallowed rejection resolves without an unhandled throw
  });
});

// ── The notePaymentDueDetector balloon fold-in: exactly-once by source order ──
// Same discipline paymentWorkflowEvents pins for payment.missed: the emit sits
// inside the publish try-block, AFTER `result.balloonPublished += 1`, and BEHIND
// the `alreadyBallooned.has(dedupeKey)` skip — so an already-emitted (note,
// maturityDate) is filtered out before the emit is ever reached, and a daily
// rerun re-reads the mesh ledger and re-skips it. No migration; it rides the
// EXISTING daily scan (no new job / no new scheduler line).
describe("balloon fold-in dedupe (notePaymentDueDetector — exactly one emit per note+maturity)", () => {
  const src = fs.readFileSync(
    path.join(process.cwd(), "server/services/notePaymentDueDetector.ts"),
    "utf-8",
  );

  it("emits once per NEW finding, after a successful publish, behind the ledger skip", () => {
    const skipIdx = src.indexOf("if (alreadyBallooned.has(dedupeKey)) continue;");
    const publishedIdx = src.indexOf("result.balloonPublished += 1;");
    const emitIdx = src.indexOf("emitNoteBalloonApproaching(r, now);");
    expect(skipIdx).toBeGreaterThan(-1);
    expect(publishedIdx).toBeGreaterThan(-1);
    expect(emitIdx).toBeGreaterThan(-1);
    // ledger skip precedes the publish+emit, and the emit follows the publish.
    expect(skipIdx).toBeLessThan(publishedIdx);
    expect(emitIdx).toBeGreaterThan(publishedIdx);
  });

  it("dedupes per (noteId, maturityDate) on the note:balloons channel — no migration", () => {
    expect(src).toContain("note-balloon:${r.id}:");
    expect(src).toContain('NOTE_BALLOON_CHANNEL = "note:balloons"');
    // The mesh event IS the durable ledger (payload ->> 'dedupeKey'); no new table.
    expect(src).toContain("'dedupeKey'");
    expect(src).not.toMatch(/CREATE TABLE|migrations\//);
  });

  it("rides the existing daily scan — no new scheduler line", () => {
    // The fold-in lives inside runNotePaymentDueScan; it does not register a job.
    expect(src).toContain("emitNoteBalloonApproaching");
    expect(src).not.toContain("startNoteBalloon");
    expect(src).not.toContain("setInterval");
  });
});
