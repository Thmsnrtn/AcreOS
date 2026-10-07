/**
 * H4 (round 2) — what the chat may approve is decided by STRUCTURE, not by
 * reading model text. Regex over words a model wrote cannot fail closed: the
 * re-audit found ten fresh phrasings of pricing / legal / spend / deletion
 * proposals that every classifier let through. So:
 *
 *   • an ask is chat-approvable ONLY when planAndAct built it from a
 *     SERVER-AUTHORED catalog move (decide.ts marks the objects rankMoves
 *     writes; a copy or rewrite is not one) on CHAT_APPROVABLE_MOVES, on the
 *     main escalation path — never a pre-mortem or risk card;
 *   • the chat's answer_ask answers only asks the server marked so
 *     (chat_approvable) — any model-written rationale is the founder's tap,
 *     WHATEVER IT SAYS (the ten phrasings below are canaries for exactly that);
 *   • the classifiers stay as defence in depth.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const store = vi.hoisted(() => ({ asks: new Map<number, Record<string, unknown>>(), answered: [] as Array<Record<string, unknown>> }));
vi.mock("../../server/services/solene/founderCollab", () => ({
  getAsk: async (id: number) => store.asks.get(id) ?? null,
  answerFounderAsk: async (a: Record<string, unknown>) => {
    store.answered.push(a);
  },
  listOpenAsks: async () => [],
}));

import { planAndAct, isChatApprovableMove, type ActDeps } from "../../server/services/autopilot/act";
import { rankMoves, type RankedMove } from "../../server/services/autopilot/decide";
import { executeBusinessChatTool } from "../../server/services/solene/chat/businessTools";
import { founderOnlyClassForMove } from "../../server/services/autopilot/hardStopMoves";

const SENSES = {
  openIncidents: 0, complianceOpenCount: 0, envelopeStatus: "green" as const, supportBacklog: 0, escalatedTicketIds: [],
  trials: 0, activationStalled: false, activationStalledCount: 0, mrr: 0, dispatchBacklog: 0,
  emailComplaints: 0, dunningPressure: 0, churnSignals: 2, trialsEnding: 0, reflexFailures: 0,
};

/** The re-audit's ten phrasings: model-written rationales on known, allow-listed kinds. */
const MODEL_WRITTEN = [
  "two grand a week on Google Ads",
  "migrate free users to paid automatically",
  "Make Starter 19 a month going forward",
  "Okay the Regrid renewal paperwork",
  "Clear out borrowers who left last year",
  "Put 3k behind the field notes on LinkedIn",
  "Bump everyone on free to the 49 option",
  "remove them for good",
  "Agree to the vendor's updated conditions",
  "Run promoted posts at 90 per day through December",
];

function deps(captured: Array<Record<string, unknown>>): ActDeps {
  return {
    runGate: async () => ({ decision: "escalate" as const, decidedBy: "autonomy", results: [] }),
    classify: () => ({ escalate: true, action: "founder_ask" as const, urgency: "normal" as const, reason: "the domain is at DRAFT" }),
    enqueue: async () => 1,
    ask: async (input: Record<string, unknown>) => {
      captured.push(input);
      return { askId: captured.length };
    },
  } as unknown as ActDeps;
}

async function askFor(move: RankedMove) {
  const captured: Array<Record<string, unknown>> = [];
  await planAndAct(move, { envelopeStatus: "green" }, deps(captured));
  return captured[0] as { acts?: { chatApprovable: boolean; rationale: string } } | undefined;
}

beforeEach(() => {
  store.asks.clear();
  store.answered.length = 0;
});

describe("chat approval is structural", () => {
  it("a server-authored catalog move on the allow-list yields a chat-approvable ask", async () => {
    const m = rankMoves(SENSES).find((x) => x.kind === "retain_at_risk")!;
    expect(isChatApprovableMove(m)).toBe(true);
    const ask = await askFor(m);
    expect(ask?.acts).toMatchObject({ chatApprovable: true, rationale: m.rationale });
  });

  it("the SAME kind with benign but model-written text is founder-tap only (a copy is never server-authored)", async () => {
    const m = rankMoves(SENSES).find((x) => x.kind === "retain_at_risk")!;
    const rewritten = { ...m, rationale: "Send a friendly check-in to the two customers." };
    expect(founderOnlyClassForMove({ ...rewritten })).toBeNull(); // no classifier objects to it…
    expect(isChatApprovableMove(rewritten)).toBe(false); // …and it is still not approvable
    expect((await askFor(rewritten))?.acts?.chatApprovable).toBe(false);
  });

  it("mutating a server-authored move's rationale in place revokes it", () => {
    const m = rankMoves(SENSES).find((x) => x.kind === "optimize")!;
    m.rationale = "Run promoted posts at 90 per day through December";
    expect(isChatApprovableMove(m)).toBe(false);
  });

  it.each(MODEL_WRITTEN)("canary %j: as a model-written rationale on an allow-listed kind it is never chat-approvable", async (text) => {
    for (const kind of ["optimize", "retain_at_risk", "clear_compliance", "grow_owned_channels"]) {
      const base = rankMoves({ ...SENSES, complianceOpenCount: 1 }).find((x) => x.kind === kind) ?? { priority: 4, domain: "growth", kind, rationale: "x" };
      const move = { ...base, rationale: text };
      const ask = await askFor(move);
      expect(ask?.acts?.chatApprovable ?? false, `${kind}: ${text}`).toBe(false);
    }
  });

  it("answer_ask answers ONLY an ask the server marked chat-approvable — benign words do not help", async () => {
    const card = { status: "open", answerFormat: "yes_no", questionSummary: "Review a drafted growth action: grow_owned_channels", questionBody: "Approve to let it proceed.", bodyHash: "h1" };
    store.asks.set(1, { id: 1, ...card, chatApprovable: false });
    store.asks.set(2, { id: 2, ...card, chatApprovable: true });
    const refused = await executeBusinessChatTool("answer_ask", { ask_id: 1, decision: "approve", version: "h1" }, "f");
    expect(refused.ok).toBe(false);
    expect(refused.text).toMatch(/founder-only/);
    expect(store.answered).toHaveLength(0);
    const ok = await executeBusinessChatTool("answer_ask", { ask_id: 2, decision: "approve", version: "h1" }, "f");
    expect(ok.ok).toBe(true);
    expect(store.answered).toEqual([{ askId: 2, answerText: "yes", expectedBodyHash: "h1" }]);
  });

  it("a pre-mortem card is never chat-approvable, even for a server-authored move", async () => {
    const m = rankMoves(SENSES).find((x) => x.kind === "retain_at_risk")!;
    const captured: Array<Record<string, unknown>> = [];
    const d = { ...deps(captured), runGate: async () => ({ decision: "pass" as const, results: [] }), premortem: async () => ({ veto: true, objection: "model-written objection" }) } as unknown as ActDeps;
    await planAndAct(m, { envelopeStatus: "green" }, d);
    expect((captured[0] as { acts?: { chatApprovable: boolean } }).acts?.chatApprovable).toBe(false);
  });
});

describe("defence in depth — the classifiers also catch the ten phrasings", () => {
  it.each(MODEL_WRITTEN)("%j is founder-only by the classifier too", (text) => {
    expect(founderOnlyClassForMove({ kind: "optimize", rationale: text, domain: "ops" })).not.toBeNull();
  });
});

describe("the chat answers only a version it SHOWED the founder", () => {
  const card = { status: "open", answerFormat: "yes_no", questionSummary: "Review a drafted growth action: grow_owned_channels", questionBody: "Approve to let it proceed.", bodyHash: "h1", chatApprovable: true };
  it("no version → refused; a stale version → refused; the shown version → answered", async () => {
    store.asks.set(3, { id: 3, ...card });
    expect((await executeBusinessChatTool("answer_ask", { ask_id: 3, decision: "approve" }, "f")).ok).toBe(false);
    expect((await executeBusinessChatTool("answer_ask", { ask_id: 3, decision: "approve", version: "old" }, "f")).ok).toBe(false);
    expect(store.answered).toHaveLength(0);
    expect((await executeBusinessChatTool("answer_ask", { ask_id: 3, decision: "approve", version: "h1" }, "f")).ok).toBe(true);
  });
});
