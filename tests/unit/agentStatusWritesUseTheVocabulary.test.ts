/**
 * The autopilot could write any string it liked into `leads.status` and
 * `deals.status`. One of the strings it wrote was hardcoded and wrong.
 *
 * ── WHAT WAS THERE ────────────────────────────────────────────────────────
 *     "advance_deal_stage": async (ctx) => {
 *       const { dealId, newStage } = ctx.input;
 *       ...
 *       .set({ status: newStage ?? "closing" })
 *
 * `"closing"` IS NOT A DEAL STATUS. `DEAL_STATUSES` is negotiating, offer_sent,
 * countered, accepted, in_escrow, closed, cancelled — the pre-close state is
 * `in_escrow`. So any autopilot call that omitted `newStage` silently stored a
 * word the vocabulary does not contain, and a deal parked there became three
 * different kinds of wrong at once:
 *
 *   1. INVISIBLE to every `ACTIVE_DEAL_STATUSES` filter — the "Deals in
 *      Pipeline" card, the pipeline-value chart, founder-bridge. Not active,
 *      not closed, just absent.
 *   2. COUNTED AS REVENUE by portfolioPnl, cohortAnalysis and
 *      attributionService, each of which had independently written
 *      `('closed', 'closing')` inline to compensate — the same compensation
 *      spelled three times, which is three places to forget it.
 *   3. EXEMPT FROM THE STATE MACHINE. Both human guards read
 *      `const allowedNext = DEAL_STATUS_TRANSITIONS[currentStatus]` and then
 *      `if (allowedNext && !allowedNext.includes(next))`. An unknown current
 *      status makes `allowedNext` undefined, so the guard Task #210 exists to
 *      enforce is skipped entirely (routes-deals.ts:730 and :2482).
 *
 * And `newStatus` on the lead handler had the same hole without the hardcoded
 * value: whatever a model put in `ctx.input` went into the column.
 *
 * ── WHY THIS IS THE ASYMMETRY THAT MATTERS ────────────────────────────────
 * The vocabulary was never unenforced. `routes-leads.ts:666` validates every
 * human status change against `validateLeadTransition`; `routes.ts:1658` and
 * `routes-deals.ts:730` do the deal side. Every seam a PERSON drives was
 * guarded. The seam a MODEL drives, unattended and at machine rate, was not —
 * and pipeline-status.ts's own header says the house pattern is "validation at
 * the write seams".
 *
 * That is the shape this repo already names: "a guard that covers the
 * calculator and not the commitment is worse than none, because it reads as
 * covered."
 *
 * Handlers are driven THROUGH THE REGISTRY, not through `execute()` —
 * `advance_deal_stage` is structurally founder-gated, so a suite driven
 * through `execute()` reads the GATE's refusal as if it were the handler's.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "../helpers/stripComments";

let currentRows: Array<Record<string, unknown>> = [];
let returningRows: Array<Record<string, unknown>> = [];
/** Every patch that reached `.set()` — proof of what was, or was not, written. */
const written: Array<Record<string, unknown>> = [];

vi.mock("../../server/db", () => ({
  db: {
    execute: vi.fn().mockResolvedValue({ rows: [{ count: 1 }] }),
    insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue([]) })),
    select: vi.fn(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue(currentRows) }),
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn().mockImplementation((patch: Record<string, unknown>) => {
        written.push(patch);
        return {
          where: vi.fn().mockImplementation(() => {
            const p: any = Promise.resolve(returningRows);
            p.returning = () => Promise.resolve(returningRows);
            return p;
          }),
        };
      }),
    })),
  },
}));
vi.mock("../../server/services/trustAuthorityEscalation", () => ({
  trustAuthorityEscalation: {
    isActionAllowed: vi.fn().mockReturnValue(true),
    getTier: vi.fn().mockReturnValue({ label: "test", allowedActions: [] }),
  },
}));
vi.mock("../../server/services/companyAgents", () => ({
  companyAgentService: {
    getByCodename: vi.fn().mockResolvedValue(undefined),
    effectiveTrustScore: vi.fn().mockResolvedValue(100),
  },
}));
vi.mock("../../server/services/governanceBrainV13", () => ({
  governanceBrainService: {
    evaluateAction: vi.fn().mockResolvedValue({ overallResult: "allowed", explanation: "test" }),
  },
}));
vi.mock("../../server/services/eventMeshPublisher", () => ({
  eventMeshPublisher: { publish: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock("../../server/websocket", () => ({
  wsServer: { broadcastFounderEvent: vi.fn(), broadcast: vi.fn() },
}));

const { executionEngine } = await import("../../server/services/executionEngine");
const { LEAD_STATUSES, DEAL_STATUSES, CLOSED_DEAL_STATUSES } = await import(
  "@shared/lifecycle/pipeline-status"
);

const ORG = 42;

function handlerFor(action: string) {
  const executor = executionEngine.getActionExecutor(action);
  expect(executor, `no executor registered for ${action}`).toBeTypeOf("function");
  return executor!;
}
const run = (action: string, input: Record<string, unknown>) =>
  handlerFor(action)({ orgId: ORG, agentCodename: "test-agent", action, input } as any);

beforeEach(() => {
  written.length = 0;
  returningRows = [{ id: 7 }];
  currentRows = [{ status: "negotiating" }];
});

describe("advance_deal_stage", () => {
  it("refuses a missing stage instead of defaulting to a word that is not a status", async () => {
    const result = await run("advance_deal_stage", { dealId: 7 });
    expect(result.success).toBe(false);
    expect(result.error ?? "").toMatch(/newStage required/i);
    // The whole defect in one assertion: nothing was written at all.
    expect(written).toEqual([]);
  });

  it("never writes the legacy value, whatever the input says", async () => {
    const result = await run("advance_deal_stage", { dealId: 7, newStage: "closing" });
    expect(result.success).toBe(false);
    expect(written).toEqual([]);
    // And the refusal tells the model what it may say instead.
    expect(result.error ?? "").toContain("in_escrow");
  });

  it("refuses a value outside DEAL_STATUSES", async () => {
    for (const bogus of ["Closed", "won", "under_contract", "closed_won", ""]) {
      written.length = 0;
      const result = await run("advance_deal_stage", { dealId: 7, newStage: bogus });
      expect(result.success, `"${bogus}" was accepted as a deal status`).toBe(false);
      expect(written).toEqual([]);
    }
  });

  it("refuses a transition the state machine forbids", async () => {
    currentRows = [{ status: "closed" }];
    const result = await run("advance_deal_stage", { dealId: 7, newStage: "offer_sent" });
    expect(result.success).toBe(false);
    expect(result.error ?? "").toMatch(/cannot transition from closed to offer_sent/i);
    expect(written).toEqual([]);
  });

  it("still advances a legal transition", async () => {
    currentRows = [{ status: "accepted" }];
    const result = await run("advance_deal_stage", { dealId: 7, newStage: "in_escrow" });
    expect(result.success).toBe(true);
    expect(written).toHaveLength(1);
    expect(written[0].status).toBe("in_escrow");
  });
});

describe("update_lead_status", () => {
  it("refuses a value outside LEAD_STATUSES", async () => {
    currentRows = [{ status: "new" }];
    for (const bogus of ["warm", "hot", "Contacted", "converted", "offer_sent"]) {
      written.length = 0;
      const result = await run("update_lead_status", { leadId: 7, newStatus: bogus });
      expect(result.success, `"${bogus}" was accepted as a lead status`).toBe(false);
      expect(written).toEqual([]);
    }
  });

  it("refuses a transition the state machine forbids", async () => {
    currentRows = [{ status: "new" }];
    const result = await run("update_lead_status", { leadId: 7, newStatus: "closed" });
    expect(result.success).toBe(false);
    expect(written).toEqual([]);
  });

  it("still writes a legal transition", async () => {
    currentRows = [{ status: "new" }];
    const result = await run("update_lead_status", { leadId: 7, newStatus: "contacted" });
    expect(result.success).toBe(true);
    expect(written).toHaveLength(1);
    expect(written[0].status).toBe("contacted");
  });

  it("allows a legacy row with an unknown current status to re-enter the vocabulary", async () => {
    // validateLeadTransition's documented contract: an unknown CURRENT value
    // must never brick an old row in place. The autopilot is exactly who has
    // to be able to rescue one.
    currentRows = [{ status: "warm" }];
    const result = await run("update_lead_status", { leadId: 7, newStatus: "contacted" });
    expect(result.success).toBe(true);
    expect(written[0].status).toBe("contacted");
  });
});

describe("the source no longer carries the value, and the readers share one list", () => {
  const read = (rel: string) =>
    stripComments(fs.readFileSync(path.resolve(process.cwd(), rel), "utf8"));

  it("executionEngine writes no status literal outside the vocabulary", () => {
    const src = read("server/services/executionEngine.ts");
    // POPULATION: writes to the two tables this vocabulary governs, and only
    // those. `status` is a column on several tables here — tasks are
    // "completed", agent runs are "restart_requested" — and a predicate that
    // read every `status:` key in the file would fail on those and teach the
    // next author to weaken it. So the scan is anchored on the table.
    const writes = [...src.matchAll(/db\.update\((leads|deals)\)([\s\S]{0,600}?)\.where\(/g)];
    expect(
      writes.length,
      "no db.update(leads|deals) found in executionEngine — the scan is reading nothing",
    ).toBeGreaterThanOrEqual(2);

    const vocab = new Set<string>([...LEAD_STATUSES, ...DEAL_STATUSES]);
    const off: string[] = [];
    for (const w of writes) {
      for (const m of w[2].matchAll(/status:\s*["']([^"']+)["']/g)) {
        if (!vocab.has(m[1])) off.push(`${w[1]} <- "${m[1]}"`);
      }
    }
    expect(
      off,
      "a status literal written to leads/deals that no vocabulary contains — this " +
        "is exactly how `closing` got in",
    ).toEqual([]);
  });

  it("CLOSED_DEAL_STATUSES carries the legacy value so historical rows keep counting", () => {
    expect([...CLOSED_DEAL_STATUSES]).toContain("closed");
    expect(
      [...CLOSED_DEAL_STATUSES],
      "the legacy value must stay READABLE — the writer is gone, the rows are not, " +
        "and this repo does not guess at production data",
    ).toContain("closing");
    // It is not a member of the writable vocabulary, and must not become one.
    expect([...DEAL_STATUSES]).not.toContain("closing");
  });

  it("the three revenue readers consume the projection instead of spelling it", () => {
    const readers = [
      "server/services/portfolioPnl.ts",
      "server/services/cohortAnalysis.ts",
      "server/services/attributionService.ts",
    ];
    for (const rel of readers) {
      const src = read(rel);
      expect(src, `${rel} does not import the canonical list`).toContain("CLOSED_DEAL_STATUSES");
      // The inline spelling is what drifts. Comments are stripped, so the
      // paragraph in pipeline-status.ts explaining the old form cannot satisfy
      // this — and neither can the one at the top of this file.
      expect(
        /["']closing["']/.test(src),
        `${rel} still spells the legacy status inline; that is the third copy ` +
          `ACTIVE_DEAL_STATUSES's comment says was already paid for once`,
      ).toBe(false);
    }
  });
});
