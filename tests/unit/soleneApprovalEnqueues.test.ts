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

type Ask = { id: number; status: string; answerFormat: string; options: unknown; bodyHash?: string | null; actsPayload?: { moveKind: string; domain: string; rationale: string } | null };
const state = {
  asks: new Map<number, Ask>(),
  experiences: [] as Array<{ id: number; askId: number; moveKind: string; domain: string; dispatchId: number | null; reasoningTrace: unknown }>,
  dispatches: [] as Array<{ id: number; idempotencyKey: string | null; sourceId: string; promptText: string; enqueuedBy?: string }>,
  updateSql: [] as string[],
};

vi.mock("../../server/db", async () => {
  const { PgDialect } = await import("drizzle-orm/pg-core");
  const dialect = new PgDialect();
  // Only the two shapes answerFounderAsk uses: getAsk (select…limit) and the
  // status flip (update…set…where). The flip applies to the ask under test.
  let currentAskId = 0;
  return {
    db: {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => {
              // A READ is a snapshot (as a database read is), so two
              // concurrent answers can both see the ask open.
              const a = state.asks.get(currentAskId);
              return a ? [{ ...a }] : [];
            },
          }),
        }),
      }),
      update: () => ({
        set: (patch: { status?: string }) => ({
          // The guarded UPDATE: exactly one caller flips open → answered and
          // gets the row back; a loser gets [] (as the database does).
          where: (pred: unknown) => {
            state.updateSql.push(dialect.sqlToQuery(pred as never).sql);
            const flip = () => {
              const a = state.asks.get(currentAskId);
              if (a && a.status === "open" && patch.status) {
                a.status = patch.status;
                return [{ id: a.id }];
              }
              return [];
            };
            return { returning: async () => flip(), then: (r: (v: unknown) => unknown) => Promise.resolve(flip()).then(r) };
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

const PROPOSAL = { moveKind: "clear_support_backlog", domain: "support", rationale: "3 customer(s) waiting on support." };
function seed(askId: number, withExperience = true) {
  state.asks.set(askId, { id: askId, status: "open", answerFormat: "yes_no", options: null, bodyHash: `v${askId}`, actsPayload: withExperience ? PROPOSAL : null });
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
    await answerFounderAsk({ askId: 7, answerText: "yes", expectedBodyHash: "v7" });
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
    await answerFounderAsk({ askId: 8, answerText: "yes", expectedBodyHash: "v8" });
    // The second answer is refused (the ask is no longer open)…
    await expect(answerFounderAsk({ askId: 8, answerText: "yes", expectedBodyHash: "v8" })).rejects.toThrow(/only 'open' is answerable/);
    // …and a racing/retried enqueue for the same ask dedupes.
    await enqueueApprovedMove(8, {
      proposal: PROPOSAL,
      findEscalatedMove: experienceLog.findEscalatedMoveForAsk,
      enqueue: enqueueDispatch,
      linkDispatch: experienceLog.linkExperienceDispatch,
    });
    expect(state.dispatches).toHaveLength(1);
  });

  it("even when the link was lost, a re-enqueue for the same ask dedupes on its key", async () => {
    seed(9);
    await answerFounderAsk({ askId: 9, answerText: "yes", expectedBodyHash: "v9" });
    state.experiences[0].dispatchId = null; // simulate a lost link write
    const out = await enqueueApprovedMove(9, {
      proposal: PROPOSAL,
      findEscalatedMove: experienceLog.findEscalatedMoveForAsk,
      enqueue: enqueueDispatch,
      linkDispatch: experienceLog.linkExperienceDispatch,
    });
    expect(out.status).toBe("enqueued");
    expect(state.dispatches).toHaveLength(1);
  });

  it("decline enqueues nothing", async () => {
    seed(10);
    await answerFounderAsk({ askId: 10, answerText: "no", expectedBodyHash: "v10" });
    expect(enqueueDispatch).not.toHaveBeenCalled();
    expect(state.dispatches).toHaveLength(0);
  });

  it("an approved ask that was not an autopilot move enqueues nothing", async () => {
    seed(11, false);
    await answerFounderAsk({ askId: 11, answerText: "yes", expectedBodyHash: "v11" });
    expect(state.dispatches).toHaveLength(0);
  });

  it("an enqueue that fails does not read as done", async () => {
    seed(12);
    vi.mocked(enqueueDispatch).mockRejectedValueOnce(new Error("insert refused"));
    await expect(answerFounderAsk({ askId: 12, answerText: "yes", expectedBodyHash: "v12" })).rejects.toThrow(/could not be queued/);
  });
});

// Audit item 4 — an approval is bound to the exact proposal and card version
// the founder saw; what runs is the proposal, never a later re-read.
describe("approval is bound to the version the founder saw", () => {
  it("what runs is the bound proposal, even when the decision trace says something else", async () => {
    seed(20);
    state.experiences[0].reasoningTrace = { consideredMoves: [{ kind: "clear_support_backlog", rationale: "A LATER, DIFFERENT rationale." }] };
    await answerFounderAsk({ askId: 20, answerText: "yes", expectedBodyHash: "v20" });
    expect(state.dispatches[0].promptText).toContain("3 customer(s) waiting on support.");
    expect(state.dispatches[0].promptText).not.toContain("LATER, DIFFERENT");
  });
  it("a card that changed since it was shown is refused — nothing recorded, nothing enqueued", async () => {
    seed(21);
    await expect(answerFounderAsk({ askId: 21, answerText: "yes", expectedBodyHash: "stale" })).rejects.toThrow(/changed since it was shown/);
    expect(state.asks.get(21)?.status).toBe("open");
    expect(state.dispatches).toHaveLength(0);
  });
  it("a YES to an acting ask that names no version is refused", async () => {
    seed(22);
    await expect(answerFounderAsk({ askId: 22, answerText: "yes" })).rejects.toThrow(/version that was shown/);
    expect(state.dispatches).toHaveLength(0);
  });
  it("an approval with no bound proposal (or a proposal for another move) enqueues nothing", async () => {
    seed(23);
    const deps = { findEscalatedMove: experienceLog.findEscalatedMoveForAsk, enqueue: enqueueDispatch, linkDispatch: experienceLog.linkExperienceDispatch };
    expect((await enqueueApprovedMove(23, deps)).status).toBe("not_bound");
    expect((await enqueueApprovedMove(23, { ...deps, proposal: { ...PROPOSAL, moveKind: "grow_owned_channels" } })).status).toBe("not_bound");
    expect(state.dispatches).toHaveLength(0);
  });
});

// Round 3 — the answer race: two concurrent answers (the founder's tap and the
// chat), exactly ONE set of side effects.
describe("concurrent answers: exactly one wins and only it acts", () => {
  it("approve racing approve → one dispatch, one verdict; the loser throws", async () => {
    seed(30);
    vi.mocked(experienceLog.recordFounderVerdict).mockClear();
    const results = await Promise.allSettled([
      answerFounderAsk({ askId: 30, answerText: "yes", expectedBodyHash: "v30" }),
      answerFounderAsk({ askId: 30, answerText: "yes", expectedBodyHash: "v30" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(state.dispatches).toHaveLength(1);
    expect(vi.mocked(experienceLog.recordFounderVerdict)).toHaveBeenCalledTimes(1);
  });
  it("approve racing decline → whichever wins, the other has no effect", async () => {
    seed(31);
    vi.mocked(experienceLog.recordFounderVerdict).mockClear();
    const results = await Promise.allSettled([
      answerFounderAsk({ askId: 31, answerText: "no", expectedBodyHash: "v31" }),
      answerFounderAsk({ askId: 31, answerText: "yes", expectedBodyHash: "v31" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(vi.mocked(experienceLog.recordFounderVerdict)).toHaveBeenCalledTimes(1);
    expect(state.dispatches).toHaveLength(0); // the decline won (it flipped first)
  });
});

describe("a chat answer lands only on a card still chat-approvable at the write", () => {
  it("the guarded update for a chat answer requires chat_approvable; the founder's own does not", async () => {
    seed(40);
    state.updateSql.length = 0;
    await answerFounderAsk({ askId: 40, answerText: "no", expectedBodyHash: "v40", viaChat: true });
    expect(state.updateSql.at(-1)).toContain(`"chat_approvable"`);
    seed(41);
    await answerFounderAsk({ askId: 41, answerText: "no", expectedBodyHash: "v41" });
    expect(state.updateSql.at(-1)).not.toContain(`"chat_approvable"`);
  });
});
