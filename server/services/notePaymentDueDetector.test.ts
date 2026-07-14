/**
 * Tests for the note payment due-date detector (Jarvis 2.1, audit G2).
 *
 * Coverage:
 *  - classifyPaymentsDue (pure): 7-day window edges, overdue vs due-soon,
 *    null/invalid dates skipped, deterministic dedupe keys (and a due-soon
 *    finding that turns overdue is a NEW key)
 *  - runNotePaymentDueScan: honest dedupe against the mesh ledger (already-
 *    published keys are never re-published), fail-closed publish skip when
 *    the ledger read breaks, senses recorded as aggregate COUNTS only (no
 *    borrower data), publish failures swallowed
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Scripted SELECT results, consumed in call order:
//   1st select = active-notes read, 2nd select = dedupe ledger read.
const SELECT_QUEUE: Array<any[] | Error> = [];
vi.mock("../db", () => ({
  db: {
    select: (_p?: unknown) => ({
      from: (_t: unknown) => ({
        where: (_w: unknown) => {
          const next = SELECT_QUEUE.shift() ?? [];
          if (next instanceof Error) return Promise.reject(next);
          return Promise.resolve(next);
        },
      }),
    }),
  },
}));

const PUBLISHED: Array<{ channel: string; eventType: string; payload: any; options: any }> = [];
let PUBLISH_FAILS = false;
vi.mock("./eventMeshPublisher", () => ({
  eventMeshPublisher: {
    publish: vi.fn(async (channel: string, eventType: string, payload: any, options: any) => {
      if (PUBLISH_FAILS) throw new Error("mesh down");
      PUBLISHED.push({ channel, eventType, payload, options });
    }),
  },
}));

const SENSES: Array<{ kind: string; value: number; detail: unknown }> = [];
vi.mock("./autopilot/perception", () => ({
  recordSense: vi.fn(async (kind: string, value: number, detail?: unknown) => {
    SENSES.push({ kind, value, detail });
    return true;
  }),
}));

import {
  classifyPaymentsDue,
  runNotePaymentDueScan,
  NOTE_PAYMENT_CHANNEL,
  type NotePaymentRow,
} from "./notePaymentDueDetector";

const NOW = new Date("2026-07-14T12:00:00Z");
const days = (n: number) => new Date(NOW.getTime() + n * 24 * 60 * 60 * 1000);
const note = (id: number, due: Date | null, orgId = 1): NotePaymentRow => ({
  id,
  organizationId: orgId,
  nextPaymentDate: due,
});

beforeEach(() => {
  SELECT_QUEUE.length = 0;
  PUBLISHED.length = 0;
  SENSES.length = 0;
  PUBLISH_FAILS = false;
  vi.clearAllMocks();
});

describe("classifyPaymentsDue (pure window + dedupe-key logic)", () => {
  it("classifies inside-window as due_soon, past-due as overdue, outside as nothing", () => {
    const findings = classifyPaymentsDue(
      [note(1, days(3)), note(2, days(-2)), note(3, days(10)), note(4, null)],
      NOW,
    );
    expect(findings).toHaveLength(2);
    expect(findings.find((f) => f.noteId === 1)?.classification).toBe("due_soon");
    expect(findings.find((f) => f.noteId === 2)?.classification).toBe("overdue");
  });

  it("includes the window boundary (exactly 7 days out) and treats due-now as due_soon", () => {
    const findings = classifyPaymentsDue([note(1, days(7)), note(2, NOW)], NOW);
    expect(findings.map((f) => f.classification)).toEqual(["due_soon", "due_soon"]);
  });

  it("computes signed daysUntilDue (negative = days overdue)", () => {
    const findings = classifyPaymentsDue([note(1, days(3)), note(2, days(-2))], NOW);
    expect(findings.find((f) => f.noteId === 1)?.daysUntilDue).toBe(3);
    expect(findings.find((f) => f.noteId === 2)?.daysUntilDue).toBe(-2);
  });

  it("builds deterministic dedupe keys from note + due date + classification", () => {
    const [f] = classifyPaymentsDue([note(9, days(2))], NOW);
    expect(f.dedupeKey).toBe("note-payment:9:2026-07-16:due_soon");
    // Same inputs → same key (deterministic across reruns).
    const [again] = classifyPaymentsDue([note(9, days(2))], NOW);
    expect(again.dedupeKey).toBe(f.dedupeKey);
  });

  it("a due-soon payment that later turns overdue is a NEW finding (different key)", () => {
    const due = days(1);
    const [soon] = classifyPaymentsDue([note(9, due)], NOW);
    const [over] = classifyPaymentsDue([note(9, due)], days(3));
    expect(soon.classification).toBe("due_soon");
    expect(over.classification).toBe("overdue");
    expect(over.dedupeKey).not.toBe(soon.dedupeKey);
  });
});

describe("runNotePaymentDueScan", () => {
  it("publishes one org-scoped event per new finding with the priority split (overdue 3, due-soon 4)", async () => {
    SELECT_QUEUE.push([note(1, days(3), 10), note(2, days(-1), 11)]); // notes read
    SELECT_QUEUE.push([]); // ledger: nothing published yet
    const r = await runNotePaymentDueScan(NOW);
    expect(r).toMatchObject({ scanned: 2, dueSoon: 1, overdue: 1, published: 2, errors: 0 });
    expect(PUBLISHED).toHaveLength(2);
    const dueSoon = PUBLISHED.find((p) => p.eventType === "note:payment_due_soon")!;
    const overdue = PUBLISHED.find((p) => p.eventType === "note:payment_overdue")!;
    expect(dueSoon.channel).toBe(NOTE_PAYMENT_CHANNEL);
    expect(dueSoon.options).toMatchObject({ orgId: 10, priority: 4, publisher: "note-payment-detector" });
    expect(overdue.options).toMatchObject({ orgId: 11, priority: 3 });
  });

  it("honest dedupe: an already-published key is never re-published", async () => {
    SELECT_QUEUE.push([note(1, days(3), 10), note(2, days(-1), 11)]);
    // Ledger already contains note 1's key for this due date.
    SELECT_QUEUE.push([{ key: `note-payment:1:${days(3).toISOString().slice(0, 10)}:due_soon` }]);
    const r = await runNotePaymentDueScan(NOW);
    expect(r.published).toBe(1);
    expect(PUBLISHED.map((p) => p.eventType)).toEqual(["note:payment_overdue"]);
    // The aggregate senses still report the CURRENT totals, not just new ones.
    expect(SENSES.find((s) => s.kind === "note_payment_due_soon")?.value).toBe(1);
  });

  it("fails closed on a broken dedupe-ledger read: skips ALL publishing, still records senses", async () => {
    SELECT_QUEUE.push([note(1, days(3), 10)]);
    SELECT_QUEUE.push(new Error("ledger unavailable"));
    const r = await runNotePaymentDueScan(NOW);
    expect(r.published).toBe(0);
    expect(r.errors).toBe(1);
    expect(PUBLISHED).toHaveLength(0);
    expect(SENSES.find((s) => s.kind === "note_payment_due_soon")?.value).toBe(1);
  });

  it("records aggregate counts only — no note ids or borrower data in senses", async () => {
    SELECT_QUEUE.push([note(1, days(2), 10), note(2, days(4), 10), note(3, days(-9), 10)]);
    SELECT_QUEUE.push([]);
    await runNotePaymentDueScan(NOW);
    expect(SENSES).toHaveLength(2);
    const dueSoon = SENSES.find((s) => s.kind === "note_payment_due_soon")!;
    const overdue = SENSES.find((s) => s.kind === "note_payment_overdue")!;
    expect(dueSoon.value).toBe(2);
    expect(overdue.value).toBe(1);
    for (const s of SENSES) {
      expect(JSON.stringify(s.detail ?? {})).not.toMatch(/noteId|borrower|dueDate/);
      expect(Object.values((s.detail ?? {}) as Record<string, unknown>).every((v) => typeof v === "number")).toBe(true);
    }
  });

  it("records no sense for a quiet channel (absent, never zero-spam)", async () => {
    SELECT_QUEUE.push([note(1, days(3), 10)]); // due_soon only, no overdue
    SELECT_QUEUE.push([]);
    await runNotePaymentDueScan(NOW);
    expect(SENSES.map((s) => s.kind)).toEqual(["note_payment_due_soon"]);
  });

  it("swallows publish failures (counts them, never throws)", async () => {
    SELECT_QUEUE.push([note(1, days(3), 10)]);
    SELECT_QUEUE.push([]);
    PUBLISH_FAILS = true;
    const r = await runNotePaymentDueScan(NOW);
    expect(r.published).toBe(0);
    expect(r.errors).toBe(1);
  });

  it("degrades to an empty scan when the notes read fails (honest none)", async () => {
    SELECT_QUEUE.push(new Error("db down"));
    const r = await runNotePaymentDueScan(NOW);
    expect(r).toMatchObject({ scanned: 0, dueSoon: 0, overdue: 0, published: 0, errors: 1 });
    expect(PUBLISHED).toHaveLength(0);
    expect(SENSES).toHaveLength(0);
  });
});
