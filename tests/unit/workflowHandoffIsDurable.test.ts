/**
 * DEFECT-0114 — scheduled detectors hand off to workflows durably.
 *
 * The acquired-note aging sweep wrote a worse delinquency status and then
 * called an unawaited, in-memory `emitPaymentEvent`. A crash between the two
 * lost the collection workflow, and the persisted status stopped the next sweep
 * from re-emitting. The fix stages a `workflow_trigger` outbox row on the SAME
 * transaction as the status write, and the worker drains it with retries.
 *
 * Proven here against the real sweep, the real staging function and the real
 * drain, with the database and the engine doubled:
 *   - the status update and the outbox insert run on one transaction handle;
 *   - a failed outbox insert fails that transaction (the status goes with it);
 *   - the drain awaits the engine, lets its failure propagate for a retry, and
 *     refuses a malformed payload terminally;
 *   - the worker registers the drain.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { stripComments } from "../helpers/stripComments";

const h = vi.hoisted(() => ({
  rows: [] as unknown[],
  txCalls: [] as Array<{ op: string; table: unknown; values?: unknown }>,
  outsideTx: [] as string[],
  insertFails: false,
  trigger: vi.fn(),
}));

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../server/db", () => {
  const chain = (result: unknown) => {
    const p = Promise.resolve(result);
    const c: Record<string, unknown> = {};
    for (const k of ["from", "where", "orderBy", "limit", "innerJoin", "leftJoin"]) c[k] = () => c;
    c.then = p.then.bind(p);
    c.catch = p.catch.bind(p);
    return c;
  };
  const tx = {
    update: (table: unknown) => ({
      set: (values: unknown) => ({
        where: async () => {
          h.txCalls.push({ op: "update", table, values });
        },
      }),
    }),
    insert: (table: unknown) => ({
      values: async (values: unknown) => {
        if (h.insertFails) throw new Error("outbox insert failed");
        h.txCalls.push({ op: "insert", table, values });
      },
    }),
    select: () => chain([]),
  };
  return {
    db: {
      select: () => chain(h.rows),
      update: () => {
        h.outsideTx.push("update");
        return { set: () => ({ where: async () => undefined }) };
      },
      insert: () => {
        h.outsideTx.push("insert");
        return { values: async () => undefined };
      },
      transaction: async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx),
    },
  };
});

vi.mock("../../server/services/workflow-engine", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    emitPaymentEvent: vi.fn(),
  };
});

import { outbox } from "@shared/schema";
import { acquiredNotes } from "@shared/schema/notes-vertical";
import { runAcquiredNoteAgingSweep, type AgingNoteRow } from "../../server/jobs/acquiredNoteAging";
import { drainWorkflowTrigger, stageWorkflowEvent } from "../../server/services/workflowOutbox";

const ENGINE = { triggerWorkflows: (...a: unknown[]) => h.trigger(...a) } as never;
const ASOF = new Date(Date.UTC(2026, 6, 30));
function note(over: Partial<AgingNoteRow> = {}): AgingNoteRow {
  return {
    id: "note-1",
    organizationId: 7,
    noteNumber: "N-001",
    status: "performing",
    paymentDueDay: 15,
    originationDate: "2025-01-10",
    maturityDate: "2035-01-15",
    acquisitionDate: "2025-01-20",
    firstPaymentDate: "2025-02-15",
    paidThroughDate: "2026-06-15",
    nextPaymentDate: null,
    gracePeriodDays: 10,
    lateFeeCents: 5000,
    daysDelinquent: 0,
    delinquencyStatus: "current",
    ...over,
  };
}

beforeEach(() => {
  h.rows = [];
  h.txCalls.length = 0;
  h.outsideTx.length = 0;
  h.insertFails = false;
  h.trigger.mockReset();
});

describe("DEFECT-0114 — the aging sweep stages its hand-off on the status transaction", () => {
  it("a worsening transition writes the status AND the outbox row on one transaction", async () => {
    h.rows = [note()]; // performing → late
    const summary = await runAcquiredNoteAgingSweep({ asOf: ASOF });
    expect(summary.transitioned).toBe(1);
    const ops = h.txCalls.map((c) => [c.op, c.table === outbox ? "outbox" : c.table === acquiredNotes ? "acquired_notes" : "?"]);
    expect(ops).toEqual([
      ["update", "acquired_notes"],
      ["insert", "outbox"],
    ]);
    const staged = h.txCalls[1].values as { eventType: string; payload: Record<string, any> };
    expect(staged.eventType).toBe("workflow_trigger");
    expect(staged.payload).toMatchObject({
      event: "payment.missed",
      organizationId: 7,
      entityType: "payment",
      data: { source: "acquired_note_aging", noteId: "note-1", noteStatus: "late" },
    });
    expect(h.outsideTx).toEqual([]);
  });

  it("a failed outbox write fails the note's transaction — status and trigger go together", async () => {
    h.rows = [note()];
    h.insertFails = true;
    const summary = await runAcquiredNoteAgingSweep({ asOf: ASOF });
    expect(summary.errors).toBe(1);
    expect(summary.updated).toBe(0);
    expect(summary.transitioned).toBe(0);
  });

  it("a recovery (not worsening) stages nothing", async () => {
    h.rows = [note({ status: "late", paidThroughDate: "2026-07-15", daysDelinquent: 20, delinquencyStatus: "late_30" })];
    await runAcquiredNoteAgingSweep({ asOf: ASOF });
    expect(h.txCalls.filter((c) => c.table === outbox)).toEqual([]);
  });
});

describe("DEFECT-0114 — staging and draining", () => {
  it("a dedupe key already staged is not staged twice", async () => {
    const inserts: unknown[] = [];
    const exec = {
      select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ id: 1 }] }) }) }),
      insert: () => ({ values: async (v: unknown) => void inserts.push(v) }),
    };
    const r = await stageWorkflowEvent(
      { event: "payment.missed", organizationId: 7, entityId: 42, entityType: "payment", data: {} },
      { executor: exec as never, dedupeKey: "note-payment:42:2026-07-01:overdue" },
    );
    expect(r.staged).toBe(false);
    expect(inserts).toEqual([]);
  });

  it("the drain AWAITS the engine and reports the runs", async () => {
    h.trigger.mockResolvedValue([{ id: 1 }, { id: 2 }]);
    const r = await drainWorkflowTrigger(
      { event: "payment.missed", organizationId: 7, entityId: 42, entityType: "payment", data: { noteId: 42 } },
      ENGINE,
    );
    expect(r).toEqual({ runs: 2 });
    expect(h.trigger).toHaveBeenCalledWith(
      expect.objectContaining({ event: "payment.missed", organizationId: 7, entityId: 42, entityType: "payment" }),
    );
  });

  it("an engine failure propagates so the outbox retries it", async () => {
    h.trigger.mockRejectedValue(new Error("db down"));
    await expect(
      drainWorkflowTrigger({ event: "payment.missed", organizationId: 7, entityId: 42, entityType: "payment", data: {} }, ENGINE),
    ).rejects.toThrow("db down");
  });

  it("a malformed payload is refused terminally and never reaches the engine", async () => {
    const r = await drainWorkflowTrigger({ event: "not.an.event", organizationId: "7", entityId: 42, entityType: "payment", data: {} }, ENGINE);
    expect(r).toMatchObject({ refused: true });
    expect(h.trigger).not.toHaveBeenCalled();
  });

  it("the worker registers the drain for workflow_trigger rows", () => {
    const worker = stripComments(readFileSync(resolve(__dirname, "../../server/worker.ts"), "utf8"));
    const types = worker.slice(worker.indexOf("const HANDLED_EVENT_TYPES"), worker.indexOf("] as const"));
    expect(types).toContain('"workflow_trigger"');
    expect(worker).toMatch(/workflow_trigger:\s*handleWorkflowTrigger/);
    expect(worker).toMatch(/drainWorkflowTrigger\(payload\)/);
  });
});
