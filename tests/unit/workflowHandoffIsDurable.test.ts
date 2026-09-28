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
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";

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

vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

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

/**
 * The population (independent audit, 2026-09-27): the first version of this
 * fix covered two detectors and had no list, so four more scheduled emitters of
 * the same shape — ACH autopay settlement, parcel alerts, the certificate
 * redemption clock, the note balloon lane — were invisible to it.
 *
 * Two enumerations now:
 *   1. SCHEDULED_HANDOFFS — every scheduled hand-off, each required to use a
 *      durable helper (per-member: the file must still name it).
 *   2. IN_MEMORY_EMITTERS — EVERY file that calls an in-memory emit*Event
 *      helper, derived from the engine's exports and compared both ways with
 *      this register. Each is a request path (the request's own response is
 *      the failure signal). A new in-memory call site anywhere fails until
 *      someone decides which kind it is.
 */
const SCHEDULED_HANDOFFS: Array<{ file: string; durable: string }> = [
  { file: "server/jobs/acquiredNoteAging.ts", durable: "emitDurablePaymentEvent" },
  { file: "server/services/notePaymentDueDetector.ts", durable: "emitDurablePaymentEvent" },
  { file: "server/services/achAutopay.ts", durable: "emitDurablePaymentEvent" },
  { file: "server/services/parcelDeltaDetector.ts", durable: "emitDurableParcelEvent" },
  { file: "server/services/certificateEvents.ts", durable: "emitDurableCertEvent" },
  { file: "server/services/noteEvents.ts", durable: "emitDurableNoteEvent" },
  { file: "server/services/leadEvents.ts", durable: "emitDurableLeadEvent" },
  { file: "server/services/propertyEvents.ts", durable: "emitDurablePropertyEvent" },
  { file: "server/services/dealEvents.ts", durable: "emitDurableDealEvent" },
];

const IN_MEMORY_EMITTERS: Record<string, string> = {
  "server/routes-notes.ts": "request: note payment posted by an operator",
  "server/routes-rent-ledger.ts": "request: rent payment posted by an operator",
  "server/services/borrower/portalPaymentPosting.ts": "request/webhook: a borrower payment",
  "server/services/buyerEvents.ts": "request: buyer CRUD",
  "server/services/certificateEvents.ts": "request: cert.acquired / cert.redeemed only (the scheduled two are durable)",
  "server/services/dealEvents.ts": "request: deal CRUD; the scheduled import worker uses emitDealCreatedDurably",
  "server/services/leadEvents.ts": "request: lead CRUD; the scheduled import worker uses emitLeadCreatedDurably (DEFECT-0130)",
  "server/services/propertyEvents.ts": "request: property CRUD; the scheduled import worker uses emitPropertyCreatedDurably",
  "server/services/rehabEvents.ts": "request: rehab CRUD",
  "server/services/rentalEvents.ts": "request: rental CRUD",
  "server/services/strEvents.ts": "request: STR CRUD",
  "server/services/subdivisionEvents.ts": "request: subdivision CRUD",
  "server/services/wholesaleEvents.ts": "request: wholesale CRUD",
};

function tsFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== "node_modules") tsFiles(p, out);
    } else if (p.endsWith(".ts") && !p.endsWith(".test.ts") && !p.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

describe("DEFECT-0114 population — every workflow emitter is classified", () => {
  const ROOT = resolve(__dirname, "../..");
  const engine = stripComments(readFileSync(resolve(ROOT, "server/services/workflow-engine.ts"), "utf8"));
  const helpers = [...engine.matchAll(/export function (emit\w*Event)\s*\(\s*event:/g)].map((m) => m[1]);
  const inMemory = helpers.filter((h) => !h.startsWith("emitDurable"));
  const sources = tsFiles(resolve(ROOT, "server"))
    .filter((p) => !p.endsWith(join("services", "workflow-engine.ts")))
    .map((p) => ({ file: relative(ROOT, p), src: stripComments(readFileSync(p, "utf8")) }));

  it("derives the helper sets (vacuity floor)", () => {
    expect(inMemory.length).toBeGreaterThanOrEqual(8);
    expect(helpers).toEqual(expect.arrayContaining(["emitDurablePaymentEvent", "emitDurableParcelEvent", "emitDurableCertEvent", "emitDurableNoteEvent"]));
  });

  it("every scheduled hand-off uses its durable helper", () => {
    for (const h of SCHEDULED_HANDOFFS) {
      const s = sources.find((x) => x.file === h.file);
      expect(s, `${h.file} is gone — update SCHEDULED_HANDOFFS`).toBeDefined();
      expect(s!.src, `${h.file} must call ${h.durable}`).toContain(`${h.durable}(`);
    }
  });

  it("the in-memory call sites are exactly the classified register (both directions)", () => {
    const actual = sources
      .filter((s) => inMemory.some((h) => new RegExp(`\\b${h}\\(`).test(s.src)))
      .map((s) => s.file)
      .sort();
    expect(actual).toEqual(Object.keys(IN_MEMORY_EMITTERS).sort());
  });

  it("the scheduled import worker stages every created event durably (DEFECT-0130)", () => {
    // Population: EVERY importer call the worker makes, not just leads — the
    // property and deal imports were the audit's blind spot.
    const worker = sources.find((s) => s.file === "server/services/migrationJobs.ts")!.src;
    const calls = [...worker.matchAll(/\bimport(Leads|Properties|Deals)\(([^)]*)\)/g)];
    expect(calls.map((c) => c[1]).sort()).toEqual(["Deals", "Leads", "Properties"]);
    for (const c of calls) expect(c[2], `import${c[1]} in the worker`).toMatch(/durableEvents:\s*true/);
    const importer = sources.find((s) => s.file === "server/services/importExport.ts")!.src;
    expect(importer).toMatch(/options\.durableEvents\)\s*await emitLeadCreatedDurably/);
    expect(importer).toMatch(/options\.durableEvents\)\s*await emitPropertyCreatedDurably/);
    expect(importer).toMatch(/options\.durableEvents\)\s*await emitDealCreatedDurably/);
  });

  it("no scheduled job file calls an in-memory emitter", () => {
    const jobs = sources.filter((s) => s.file.startsWith("server/jobs/"));
    expect(jobs.length).toBeGreaterThan(20);
    const offenders = jobs.filter((s) => inMemory.some((h) => new RegExp(`\\b${h}\\(`).test(s.src))).map((s) => s.file);
    expect(offenders).toEqual([]);
  });
});
