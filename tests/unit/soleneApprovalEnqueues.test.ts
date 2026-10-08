/**
 * Approving an autopilot ask must make the approved move actually run.
 *
 * act.ts tells the founder "Approve to let it proceed", but answerFounderAsk
 * only recorded the verdict: nothing enqueued the drafted move. These tests
 * drive the REAL answerFounderAsk + enqueueApprovedMove; only the DB edges are
 * in-memory. The dispatch store dedupes on idempotency key exactly as the
 * partial unique index does.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type Ask = { id: number; status: string; answerFormat: string; options: unknown };
const state = {
  asks: new Map<number, Ask>(),
  experiences: [] as Array<{ id: number; askId: number; moveKind: string; domain: string; dispatchId: number | null; reasoningTrace: unknown }>,
  dispatches: [] as Array<{ id: number; idempotencyKey: string | null; sourceId: string; promptText: string; enqueuedBy?: string }>,
};

vi.mock("../../server/db", () => {
  // Only the two shapes answerFounderAsk uses: getAsk (select…limit) and the
  // status flip (update…set…where). The flip applies to the ask under test.
  let currentAskId = 0;
  return {
    db: {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => {
              const a = state.asks.get(currentAskId);
              return a ? [a] : [];
            },
          }),
        }),
      }),
      update: () => ({
        set: (patch: { status?: string }) => ({
          where: async () => {
            const a = state.asks.get(currentAskId);
            if (a && a.status === "open" && patch.status) a.status = patch.status;
          },
        }),
      }),
      __setAsk: (id: number) => {
        currentAskId = id;
      },
    },
  };
});

vi.mock("../../server/services/solene/pagerService", () => ({ sendSolenePage: vi.fn() }));

vi.mock("../../server/services/autopilot/experienceLog", () => ({
  recordFounderVerdict: vi.fn(async () => undefined),
  findEscalatedMoveForAsk: vi.fn(async (askId: number) => {
    const e = state.experiences.find((x) => x.askId === askId);
    return e
      ? { experienceId: e.id, moveKind: e.moveKind, domain: e.domain, dispatchId: e.dispatchId, reasoningTrace: e.reasoningTrace }
      : null;
  }),
  linkExperienceDispatch: vi.fn(async (experienceId: number, dispatchId: number) => {
    const e = state.experiences.find((x) => x.id === experienceId);
    if (e) e.dispatchId = dispatchId;
  }),
}));

vi.mock("../../server/services/autopilot/policyInducer", () => ({
  resolvePolicyProposalForAsk: vi.fn(async () => undefined),
}));

vi.mock("../../server/services/solene/dispatchQueue", () => ({
  enqueueDispatch: vi.fn(async (opts: { idempotencyKey?: string | null; sourceId: string; promptText: string; enqueuedBy?: string }) => {
    const key = opts.idempotencyKey ?? null;
    const existing = key ? state.dispatches.find((d) => d.idempotencyKey === key) : undefined;
    if (existing) return existing.id;
    const id = state.dispatches.length + 100;
    state.dispatches.push({ id, idempotencyKey: key, sourceId: opts.sourceId, promptText: opts.promptText, enqueuedBy: opts.enqueuedBy });
    return id;
  }),
}));

import { db } from "../../server/db";
import { answerFounderAsk } from "../../server/services/solene/founderCollab";
import { enqueueApprovedMove } from "../../server/services/autopilot/act";

// The per-ask idempotency key the approval enqueue uses (pinned literally).
const approvedAskIdempotencyKey = (askId: number) => `approved-ask:${askId}`;
import * as experienceLog from "../../server/services/autopilot/experienceLog";
import { enqueueDispatch } from "../../server/services/solene/dispatchQueue";

function seed(askId: number, withExperience = true) {
  state.asks.set(askId, { id: askId, status: "open", answerFormat: "yes_no", options: null });
  if (withExperience) {
    state.experiences.push({
      id: askId * 10,
      askId,
      moveKind: "clear_support_backlog",
      domain: "support",
      dispatchId: null,
      reasoningTrace: { consideredMoves: [{ kind: "clear_support_backlog", rationale: "3 customer(s) waiting on support." }] },
    });
  }
  (db as unknown as { __setAsk: (id: number) => void }).__setAsk(askId);
}

beforeEach(() => {
  state.asks.clear();
  state.experiences.length = 0;
  state.dispatches.length = 0;
  vi.mocked(enqueueDispatch).mockClear();
});

describe("approving an autopilot ask enqueues the drafted move", () => {
  it("approve → exactly one dispatch, carrying the move and the founder's approval", async () => {
    seed(7);
    await answerFounderAsk({ askId: 7, answerText: "yes" });
    expect(state.dispatches).toHaveLength(1);
    const d = state.dispatches[0];
    expect(d.sourceId).toBe("autopilot:clear_support_backlog");
    expect(d.idempotencyKey).toBe(approvedAskIdempotencyKey(7));
    expect(d.enqueuedBy).toBe("founder-approval");
    expect(d.promptText).toContain("3 customer(s) waiting on support.");
    // Linked to the experience so its REAL result is what votes.
    expect(state.experiences[0].dispatchId).toBe(d.id);
  });

  it("approving twice still gives one dispatch", async () => {
    seed(8);
    await answerFounderAsk({ askId: 8, answerText: "yes" });
    // The second answer is refused (the ask is no longer open)…
    await expect(answerFounderAsk({ askId: 8, answerText: "yes" })).rejects.toThrow(/only 'open' is answerable/);
    // …and a racing/retried enqueue for the same ask dedupes.
    await enqueueApprovedMove(8, {
      findEscalatedMove: experienceLog.findEscalatedMoveForAsk,
      enqueue: enqueueDispatch,
      linkDispatch: experienceLog.linkExperienceDispatch,
    });
    expect(state.dispatches).toHaveLength(1);
  });

  it("even when the link was lost, a re-enqueue for the same ask dedupes on its key", async () => {
    seed(9);
    await answerFounderAsk({ askId: 9, answerText: "yes" });
    state.experiences[0].dispatchId = null; // simulate a lost link write
    const out = await enqueueApprovedMove(9, {
      findEscalatedMove: experienceLog.findEscalatedMoveForAsk,
      enqueue: enqueueDispatch,
      linkDispatch: experienceLog.linkExperienceDispatch,
    });
    expect(out.status).toBe("enqueued");
    expect(state.dispatches).toHaveLength(1);
  });

  it("decline enqueues nothing", async () => {
    seed(10);
    await answerFounderAsk({ askId: 10, answerText: "no" });
    expect(enqueueDispatch).not.toHaveBeenCalled();
    expect(state.dispatches).toHaveLength(0);
  });

  it("an approved ask that was not an autopilot move enqueues nothing", async () => {
    seed(11, false);
    await answerFounderAsk({ askId: 11, answerText: "yes" });
    expect(state.dispatches).toHaveLength(0);
  });

  it("an enqueue that fails does not read as done", async () => {
    seed(12);
    vi.mocked(enqueueDispatch).mockRejectedValueOnce(new Error("insert refused"));
    await expect(answerFounderAsk({ askId: 12, answerText: "yes" })).rejects.toThrow(/could not be queued/);
  });
});
