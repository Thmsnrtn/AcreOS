/**
 * Wave S · S5 — conflict → negotiation WITH A RECORD.
 *
 * The autopilot is a chartered staff, and chartered colleagues disagree. Two
 * ways that can go wrong, and this suite pins the boundary between them:
 *
 *   • The safety ladder must stay AUTHORITATIVE. An incident outranks growth;
 *     a red envelope outranks growth; an open compliance finding outranks
 *     outward action. Those are not negotiations, and turning one into a memo
 *     would put a founder card between the machine and a fire. The ladder set
 *     is DERIVED by probing decide.ts's real ranker — never a copied list —
 *     so a new P0/P1 move is covered the day it lands.
 *
 *   • A genuine cross-charter contention (budget, growth-vs-finance,
 *     speed-vs-compliance) must not be settled by whoever spoke last. When
 *     the council is genuinely divided it becomes ONE memo carrying BOTH
 *     positions — each charter's recommendation, its cost read, its risk
 *     read — plus a default that states what happens if the founder never
 *     answers.
 *
 * The properties locked in here:
 *   1. A forced growth-vs-finance contention produces exactly ONE memo, and
 *      the memo carries both positions with costs, risks and a default.
 *   2. An incident-vs-growth conflict produces NO memo — the ladder decides.
 *   3. The memo cannot self-dispose and writes no autonomy state: no
 *      actionPayload, no autonomy mutator, no standing-order write, no
 *      disposition verb (source-scan pin, scenarioLibrary's not-a-grant
 *      pattern).
 *   4. A second identical resolved contention yields a standing-order
 *      PROPOSAL — and no policy write. Granting it stays the founder's.
 *   5. Reason capture rides slice 5's EXISTING rail (founderModification +
 *      the `option:<key>` text), not a parallel store.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import path from "path";

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ─── Arbiter mock (controllable — decisionQueueMerge house pattern) ─────────

const ARBITER_CALLS: Array<{ source: string; interruptClass: string; subject: string }> = [];
let arbiterMode: "deliver" | "defer" = "deliver";
const DEFER_UNTIL = new Date("2026-08-15T12:00:00Z");

vi.mock("../../server/services/founderInterruptArbiter", () => ({
  arbitrateFounderInterrupt: vi.fn(async (req: any) => {
    ARBITER_CALLS.push({ source: req.source, interruptClass: req.interruptClass, subject: req.subject });
    if (arbiterMode === "defer") {
      return {
        outcome: "defer_to_letter",
        interruptClass: req.interruptClass,
        reason: "budget consumed",
        quietHoursActive: false,
        budget: { used: 5, limit: 5 },
        deferUntil: DEFER_UNTIL,
      };
    }
    return {
      outcome: "deliver",
      interruptClass: req.interruptClass,
      reason: "within budget",
      quietHoursActive: false,
      budget: { used: 0, limit: 5 },
      deferUntil: null,
    };
  }),
  recordDeferredInterrupt: vi.fn(async () => null),
}));

// ─── Collaborator mocks (the decisionsInbox module boundary) ────────────────

vi.mock("../../server/services/agentActionExecutors", () => ({
  executeAction: vi.fn(),
  hasExecutor: vi.fn(() => false),
}));

vi.mock("../../server/services/customerSupportAutoResolver", () => ({
  customerSupportAutoResolver: {
    attemptResolution: vi.fn(async () => ({
      autoResolved: false,
      geniusResponse: null,
      geniusConfidence: 0,
    })),
  },
}));

vi.mock("../../server/utils/openaiClient", () => ({
  requireOpenAIClient: vi.fn(() => ({ chat: { completions: { create: vi.fn() } } })),
}));

vi.mock("../../server/services/emailService", () => ({ sendEmail: vi.fn() }));
vi.mock("../../server/services/emailSuppressions", () => ({ filterSuppressed: vi.fn() }));
vi.mock("../../server/services/smsService", () => ({ sendSMSToLead: vi.fn() }));
vi.mock("../../server/services/mailProvider", () => ({ sendLetter: vi.fn() }));
vi.mock("../../server/services/pushNotificationService", () => ({ sendPushToUser: vi.fn() }));
vi.mock("../../server/services/dunning", () => ({ dunningService: {} }));

// ─── DB mock ────────────────────────────────────────────────────────────────
//
// INSERTED is the whole write surface of this suite: a standing-order write or
// an autonomy write would show up here as a second row, which property 4
// asserts can never happen.

const INSERTED: Array<Record<string, any>> = [];
const UPDATED: Array<Record<string, any>> = [];
let nextId = 1;
/** S5-completion: force the write to fail, to prove the tick survives it. */
let INSERT_THROWS = false;

const FIND_FIRST: Record<string, any> = {};
/** Rows the `db.select()...` chain resolves to (the memo history read). */
let SELECT_ROWS: Array<Record<string, any>> = [];

function findFirstFor(table: string) {
  return vi.fn(async () => FIND_FIRST[table] ?? null);
}

vi.mock("../../server/db", () => {
  const makeChain = () => {
    const chain: any = {};
    for (const m of ["select", "selectDistinct", "from", "where", "orderBy", "limit", "groupBy", "innerJoin", "leftJoin"]) {
      chain[m] = () => chain;
    }
    chain.then = (res: any, rej: any) => Promise.resolve(SELECT_ROWS).then(res, rej);
    return chain;
  };
  const db = {
    query: {
      supportTickets: { findFirst: findFirstFor("supportTickets") },
      systemAlerts: { findFirst: findFirstFor("systemAlerts") },
      featureRequests: { findFirst: findFirstFor("featureRequests") },
      organizations: { findFirst: findFirstFor("organizations") },
      decisionsInboxItems: { findFirst: findFirstFor("decisionsInboxItems") },
      paxDecisionAppeals: { findFirst: findFirstFor("paxDecisionAppeals") },
      paxRefusalPayloads: { findFirst: findFirstFor("paxRefusalPayloads") },
      recourseDrafts: { findFirst: findFirstFor("recourseDrafts") },
    },
    select: (_c?: any) => makeChain(),
    selectDistinct: (_c?: any) => makeChain(),
    insert: (_t: any) => ({
      values: (row: Record<string, any>) => {
        if (INSERT_THROWS) throw new Error("decisions_inbox_items is unreachable");
        const withId = { id: nextId++, ...row };
        INSERTED.push(withId);
        const ret = { returning: () => Promise.resolve([withId]) };
        // Support both `insert().values().returning()` and a bare awaited
        // `insert().values()` (both shapes exist in this codebase).
        return Object.assign(Promise.resolve([withId]), ret);
      },
    }),
    update: (_t: any) => ({
      set: (v: Record<string, any>) => ({
        where: (_w: any) => {
          UPDATED.push(v);
          return Promise.resolve();
        },
      }),
    }),
  };
  return { db };
});

import {
  NEGOTIABLE_CONTENTIONS,
  getContentionDef,
  ladderStabilizeKinds,
  evaluateContention,
  contentionFingerprint,
  detectRepeatResolution,
  parseChosenOptionKey,
  fileConflictMemo,
  REPEAT_RESOLUTION_THRESHOLD,
  type CharterPosition,
} from "../../server/services/autopilot/conflictMemo";
import {
  CONFLICT_MEMO_ITEM_TYPE,
  isMirroredQueueItemType,
} from "../../server/services/decisionsInbox";
import {
  aggregateCouncil,
  councilIsContested,
  councilTopTwo,
} from "../../server/services/autopilot/council";
import { rankMoves, type DecisionSenses } from "../../server/services/autopilot/decide";
import { maybeFileContentionMemo } from "../../server/services/autopilot/contentionPositions";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf-8");

// ─── Fixtures ───────────────────────────────────────────────────────────────

/** A council that genuinely split 2–2 — the contested case. */
const DIVIDED = aggregateCouncil([
  { recommendedKind: "grow_owned_channels" },
  { recommendedKind: "grow_owned_channels" },
  { recommendedKind: "convert_trials" },
  { recommendedKind: "convert_trials" },
]);

/** A council that agreed — no contention to escalate. */
const UNANIMOUS = aggregateCouncil([
  { recommendedKind: "grow_owned_channels" },
  { recommendedKind: "grow_owned_channels" },
  { recommendedKind: "grow_owned_channels" },
]);

const GROWTH_POSITION: CharterPosition = {
  charter: "growth",
  moveKind: "grow_owned_channels",
  recommendation: "Spend the remaining envelope on owned-channel acquisition this cycle.",
  cost: { usd: 400, basis: "growth budget override currently set to $400" },
  risk: { basis: "adds support load at the current backlog", coupledCharter: "support", pressureAdded: 0.3 },
  requiresNewCommitment: true,
};

const FINANCE_POSITION: CharterPosition = {
  charter: "finance",
  moveKind: "convert_trials",
  recommendation: "Hold the cash; convert the trials already in hand before spending more.",
  cost: { usd: null, basis: "no new spend — not measured because nothing is committed" },
  risk: { basis: "slower top-of-funnel while runway is protected", coupledCharter: "growth", pressureAdded: null },
  requiresNewCommitment: false,
};

/** The ladder case: an OPEN INCIDENT against growth. Never a negotiation. */
const INCIDENT_POSITION: CharterPosition = {
  charter: "deploy",
  moveKind: "resolve_incident",
  recommendation: "Stabilize the open incident before anything else runs.",
  cost: { usd: null, basis: "not measured" },
  risk: { basis: "an unstabilized incident compounds", coupledCharter: null, pressureAdded: null },
  requiresNewCommitment: true,
};

const CONTESTED_INPUT = {
  contention: "growth_vs_finance" as const,
  positions: [GROWTH_POSITION, FINANCE_POSITION] as [CharterPosition, CharterPosition],
  council: DIVIDED,
};

beforeEach(() => {
  ARBITER_CALLS.length = 0;
  INSERTED.length = 0;
  UPDATED.length = 0;
  SELECT_ROWS = [];
  nextId = 1;
  arbiterMode = "deliver";
  INSERT_THROWS = false;
  for (const k of Object.keys(FIND_FIRST)) delete FIND_FIRST[k];
});

// ─── 1. The memo: both positions, costs, risks, a default ───────────────────

describe("a forced growth-vs-finance contention → exactly ONE two-position memo", () => {
  it("evaluates to a memo carrying BOTH positions with a cost read and a risk read each", () => {
    const outcome = evaluateContention(CONTESTED_INPUT);

    expect(outcome.memo).not.toBeNull();
    const memo = outcome.memo!;
    expect(memo.contention).toBe("growth_vs_finance");
    expect(memo.positions).toHaveLength(2);

    const charters = memo.positions.map((p) => p.charter).sort();
    expect(charters).toEqual(["finance", "growth"]);

    // Every position states a recommendation, a cost read and a risk read.
    // "Not measured" is a legal cost read; a MISSING one is not.
    for (const p of memo.positions) {
      expect(p.recommendation.length).toBeGreaterThan(0);
      expect(p.cost).toBeDefined();
      expect(p.cost.basis.length).toBeGreaterThan(0);
      expect(p.risk).toBeDefined();
      expect(p.risk.basis.length).toBeGreaterThan(0);
    }
  });

  it("fills a MISSING risk read from the real coupling model rather than shipping a blank", () => {
    const { risk, ...growthWithoutRisk } = GROWTH_POSITION;
    const memo = evaluateContention({
      ...CONTESTED_INPUT,
      positions: [growthWithoutRisk, FINANCE_POSITION] as [CharterPosition, CharterPosition],
      // Support is under real strain — the modeled read should name it.
      pressures: { support: 0.8, finance: 0.1 },
    }).memo!;

    const growth = memo.positions.find((p) => p.charter === "growth")!;
    // crossFunction couples growth→support at +0.3, the heaviest outward edge.
    expect(growth.risk.coupledCharter).toBe("support");
    expect(growth.risk.pressureAdded).toBeCloseTo(0.3, 5);
    expect(growth.risk.basis).toContain("support");
  });

  it("carries a DEFAULT that states what happens if the founder never answers", () => {
    const memo = evaluateContention(CONTESTED_INPUT).memo!;
    expect(memo.default).toBeDefined();
    expect(memo.default.action).toBe("hold_both_positions");
    // The no-commitment side is the one a silent founder effectively backs.
    expect(memo.default.favors).toBe("finance");
    expect(memo.default.sentence.length).toBeGreaterThan(0);
  });

  it("records the council's MEASURED split — never a claim of consensus", () => {
    const memo = evaluateContention(CONTESTED_INPUT).memo!;
    expect(memo.council.votes).toBe(4);
    expect(memo.council.agreement).toBeCloseTo(0.5, 5);
    expect(councilIsContested(DIVIDED)).toBe(true);
    // Both leading positions come off the real tally.
    const top = councilTopTwo(DIVIDED);
    expect(top.leading?.kind).toBeTruthy();
    expect(top.opposing?.kind).toBeTruthy();
    expect(top.leading?.kind).not.toBe(top.opposing?.kind);
  });

  it("files exactly ONE decisions-door row: native type, NO executable payload", async () => {
    const res = await fileConflictMemo(CONTESTED_INPUT);

    expect(res.created).toBe(true);
    expect(INSERTED).toHaveLength(1);
    expect(INSERTED[0]).toMatchObject({
      itemType: CONFLICT_MEMO_ITEM_TYPE,
      // Nothing auto-executes from a memo — the founder's ruling IS the action.
      actionPayload: null,
      status: "pending",
    });
    expect(ARBITER_CALLS).toHaveLength(1);
    // The confidence column is an INTEGER on a 0-100 scale and the card bands
    // it at 85/60 (naturalConfidence). Storing the raw 0..1 agreement would
    // truncate to 0 and badge every memo "not sure" — a claim weaker than the
    // derivation supports. A 2-2 split is 50, and reads as 50.
    expect(INSERTED[0].sophieConfidenceScore).toBe(50);

    const bundle = INSERTED[0].contextBundle;
    expect(bundle.conflictMemo.positions).toHaveLength(2);
    // One answer option per position — the card is answerable, and each option
    // names the charter whose position it adopts.
    expect(bundle.options).toHaveLength(2);
    expect(bundle.options.map((o: any) => o.key).sort()).toEqual([
      "adopt_finance",
      "adopt_growth",
    ]);
  });

  it("is a NATIVE item, not a mirror — every disposition verb works on it directly", () => {
    expect(isMirroredQueueItemType(CONFLICT_MEMO_ITEM_TYPE)).toBe(false);
  });

  it("dedupes on an OPEN memo for the same contention — never two memos for one fight", async () => {
    const memo = evaluateContention(CONTESTED_INPUT).memo!;
    FIND_FIRST.decisionsInboxItems = {
      id: 9,
      itemType: CONFLICT_MEMO_ITEM_TYPE,
      status: "pending",
      contextBundle: { fingerprint: memo.fingerprint },
    };
    const res = await fileConflictMemo(CONTESTED_INPUT);
    expect(res).toEqual({ itemId: 9, created: false, refused: null });
    expect(INSERTED).toHaveLength(0);
    expect(ARBITER_CALLS).toHaveLength(0);
  });

  it("an agreeing council files nothing — disagreement is the trigger, not the topic", async () => {
    const res = await fileConflictMemo({ ...CONTESTED_INPUT, council: UNANIMOUS });
    expect(res.created).toBe(false);
    expect(res.refused).toBe("council_not_contested");
    expect(INSERTED).toHaveLength(0);
    expect(ARBITER_CALLS).toHaveLength(0);
  });
});

// ─── 2. The ladder decides — no negotiation over a fire ─────────────────────

describe("an incident-vs-growth conflict produces NO memo", () => {
  it("evaluates to ladder_decides, naming the ladder move that outranks", () => {
    const outcome = evaluateContention({
      contention: "growth_vs_finance",
      positions: [INCIDENT_POSITION, GROWTH_POSITION],
      council: DIVIDED,
    });
    expect(outcome.memo).toBeNull();
    expect(outcome.reason).toBe("ladder_decides");
    expect(outcome.ladderKind).toBe("resolve_incident");
  });

  it("files nothing — the founder is never asked to arbitrate a fire", async () => {
    const res = await fileConflictMemo({
      contention: "growth_vs_finance",
      positions: [INCIDENT_POSITION, GROWTH_POSITION],
      council: DIVIDED,
    });
    expect(res.created).toBe(false);
    expect(res.refused).toBe("ladder_decides");
    expect(INSERTED).toHaveLength(0);
    expect(ARBITER_CALLS).toHaveLength(0);
  });

  it("the stabilize set is DERIVED from decide.ts's real ranker, not copied", () => {
    const stabilize = ladderStabilizeKinds();
    // Every P0/P1 move decide.ts actually emits today.
    for (const kind of [
      "resolve_incident",
      "protect_runway",
      "clear_compliance",
      "stabilize_reflexes",
      "protect_deliverability",
    ]) {
      expect(stabilize.has(kind), `${kind} must be ladder-decided`).toBe(true);
    }
    // …and the negotiable tier is NOT in it.
    for (const kind of ["grow_owned_channels", "convert_trials", "optimize"]) {
      expect(stabilize.has(kind), `${kind} must stay negotiable`).toBe(false);
    }
  });

  it("every registered contention is a real cross-charter pair", () => {
    expect(NEGOTIABLE_CONTENTIONS.length).toBeGreaterThan(0);
    for (const def of NEGOTIABLE_CONTENTIONS) {
      expect(def.charters).toHaveLength(2);
      expect(def.charters[0]).not.toBe(def.charters[1]);
      expect(getContentionDef(def.key)).toBe(def);
    }
  });

  it("refuses an unregistered contention rather than inventing one", async () => {
    const res = await fileConflictMemo({
      ...CONTESTED_INPUT,
      contention: "vibes_vs_metrics" as any,
    });
    expect(res.created).toBe(false);
    expect(res.refused).toBe("unknown_contention");
    expect(INSERTED).toHaveLength(0);
  });
});

// ─── 3. Not a grant: no self-disposal, no autonomy write ────────────────────

describe("the memo cannot self-dispose and writes no autonomy state", () => {
  const src = read("server/services/autopilot/conflictMemo.ts");

  it("imports no autonomy mutator, no standing-order writer, no disposition verb", () => {
    for (const forbidden of [
      "setDomainLevel",
      "nextLevel",
      "recordCleanCycle",
      "requestPromotion",
      "applyPromotionAnswer",
      "createStandingOrder",
      "resolvePolicyProposalForAsk",
      "setGrowthBudgetOverrideUsd",
      "panicStop",
      "resolveMirrorItem",
    ]) {
      expect(src.includes(forbidden), `conflictMemo.ts must not touch ${forbidden}`).toBe(false);
    }
    // No disposition verb on the inbox service — a memo never answers itself.
    expect(/decisionsInboxService\s*\.\s*(approve|reject|override|defer)\b/.test(src)).toBe(false);
  });

  it("exports no setter-shaped symbol", async () => {
    const mod = await import("../../server/services/autopilot/conflictMemo");
    for (const name of Object.keys(mod)) {
      expect(
        /^(set|grant|promote|apply|widen|enable)/i.test(name),
        `export "${name}" looks like a mutator`,
      ).toBe(false);
    }
  });

  it("treats the safety ladder as READ-ONLY — decide.ts is imported, never edited", () => {
    // The only decide.ts surface it uses is the ranker + the senses type.
    expect(/import\s*\{[^}]*rankMoves[^}]*\}\s*from\s*["']\.\/decide["']/.test(src)).toBe(true);
  });

  it("the filed row carries no payload and no resolution — it only ever waits", async () => {
    await fileConflictMemo(CONTESTED_INPUT);
    expect(INSERTED).toHaveLength(1);
    expect(INSERTED[0].actionPayload).toBeNull();
    expect(INSERTED[0].resolvedAt ?? null).toBeNull();
    expect(INSERTED[0].resolvedBy ?? null).toBeNull();
    expect(["pending", "deferred"]).toContain(INSERTED[0].status);
    // Filing a memo updates NOTHING.
    expect(UPDATED).toHaveLength(0);
  });
});

// ─── 4. Repeat resolution → a PROPOSAL, never a policy write ────────────────

describe("the same contention resolved the same way twice → a standing-order PROPOSAL", () => {
  const FP = contentionFingerprint("growth_vs_finance", [GROWTH_POSITION, FINANCE_POSITION]);

  const priorsSameWay = [
    { fingerprint: FP, chosenKey: "adopt_finance", resolvedAt: "2026-07-01T00:00:00Z" },
    { fingerprint: FP, chosenKey: "adopt_finance", resolvedAt: "2026-07-20T00:00:00Z" },
  ];

  it("the fingerprint is stable across ticks and independent of position ORDER", () => {
    expect(contentionFingerprint("growth_vs_finance", [FINANCE_POSITION, GROWTH_POSITION])).toBe(FP);
    expect(contentionFingerprint("budget_allocation", [GROWTH_POSITION, FINANCE_POSITION])).not.toBe(FP);
  });

  it("proposes only at the threshold — one prior resolution is not a pattern", () => {
    expect(REPEAT_RESOLUTION_THRESHOLD).toBe(2);
    expect(detectRepeatResolution(FP, priorsSameWay.slice(0, 1))).toBeNull();
    expect(detectRepeatResolution(FP, priorsSameWay)).not.toBeNull();
  });

  it("refuses to generalize from two DIFFERENT answers", () => {
    expect(
      detectRepeatResolution(FP, [
        { fingerprint: FP, chosenKey: "adopt_finance", resolvedAt: "2026-07-01T00:00:00Z" },
        { fingerprint: FP, chosenKey: "adopt_growth", resolvedAt: "2026-07-20T00:00:00Z" },
      ]),
    ).toBeNull();
  });

  it("ignores resolutions of a DIFFERENT contention", () => {
    const other = contentionFingerprint("speed_vs_compliance", [GROWTH_POSITION, FINANCE_POSITION]);
    expect(
      detectRepeatResolution(FP, [
        { fingerprint: other, chosenKey: "adopt_finance", resolvedAt: "2026-07-01T00:00:00Z" },
        { fingerprint: other, chosenKey: "adopt_finance", resolvedAt: "2026-07-20T00:00:00Z" },
      ]),
    ).toBeNull();
  });

  it("the proposal is a PROPOSAL — explicitly not in force, and it asks", () => {
    const proposal = detectRepeatResolution(FP, priorsSameWay)!;
    expect(proposal.proposalOnly).toBe(true);
    expect(proposal.inForce).toBe(false);
    expect(proposal.timesResolvedTheSameWay).toBe(2);
    expect(proposal.chosenKey).toBe("adopt_finance");
    expect(proposal.body.length).toBeGreaterThan(0);
    expect(proposal.ask.length).toBeGreaterThan(0);
  });

  it("rides the NEXT memo as a card block — and writes no standing order", async () => {
    // The history read returns the two prior resolutions off the SAME store
    // slice 5 writes to (decisions_inbox_items), in its real column shape.
    SELECT_ROWS = [
      {
        contextBundle: { fingerprint: FP },
        founderOverrideAction: "option:adopt_finance — Hold the cash",
        founderModification: "runway first until we clear 20 customers",
        resolvedAt: new Date("2026-07-20T00:00:00Z"),
      },
      {
        contextBundle: { fingerprint: FP },
        founderOverrideAction: "option:adopt_finance — Hold the cash",
        founderModification: "same reason as last time",
        resolvedAt: new Date("2026-07-01T00:00:00Z"),
      },
    ];

    const res = await fileConflictMemo(CONTESTED_INPUT);
    expect(res.created).toBe(true);

    const proposal = INSERTED[0].contextBundle.standingOrderProposal;
    expect(proposal).toBeTruthy();
    expect(proposal.proposalOnly).toBe(true);
    expect(proposal.inForce).toBe(false);
    expect(proposal.chosenKey).toBe("adopt_finance");

    // THE load-bearing assertion: proposing changed nothing. One row was
    // written — the memo — and no standing order, no autonomy bump, no update.
    expect(INSERTED).toHaveLength(1);
    expect(INSERTED[0].itemType).toBe(CONFLICT_MEMO_ITEM_TYPE);
    expect(UPDATED).toHaveLength(0);
  });

  it("no proposal rides a memo whose contention has no repeat history", async () => {
    SELECT_ROWS = [];
    await fileConflictMemo(CONTESTED_INPUT);
    expect(INSERTED[0].contextBundle.standingOrderProposal ?? null).toBeNull();
  });
});

// ─── 5. The learning loop rides slice 5's rail, not a new one ───────────────

describe("reason capture rides the EXISTING disposition rail", () => {
  it("reads the founder's tapped option out of the slice-5 `option:<key>` text", () => {
    expect(parseChosenOptionKey("option:adopt_finance — Hold the cash")).toBe("adopt_finance");
    expect(parseChosenOptionKey("adopt_finance")).toBeNull();
    expect(parseChosenOptionKey(null)).toBeNull();
    expect(parseChosenOptionKey("")).toBeNull();
  });

  it("opens no parallel store — history comes from decisions_inbox_items", () => {
    const src = read("server/services/autopilot/conflictMemo.ts");
    expect(src).toContain("decisionsInboxItems");
    // No new table, and no second reason column of its own.
    expect(/pgTable\s*\(/.test(src)).toBe(false);
    expect(src).toContain("founderModification");
  });

  it("slice 5's mirror-refusal guard is untouched by the new native type", () => {
    const src = read("server/services/decisionsInbox.ts");
    expect(src).toContain("refuseIfMirror");
    expect(src).toContain("MirrorDispositionError");
    // The memo is deliberately absent from the mirror registry.
    const mirrorBlock = src.slice(
      src.indexOf("MIRRORED_QUEUE_ITEM_TYPES = {"),
      src.indexOf("} as const;", src.indexOf("MIRRORED_QUEUE_ITEM_TYPES = {")),
    );
    expect(mirrorBlock).not.toContain("conflict_memo");
  });
});

// ─── 6. Wiring pins — the surfaces that make it real ────────────────────────

describe("wiring", () => {
  it("the founder read + memo surface is mounted on the autopilot routes", () => {
    const src = read("server/routes-autopilot.ts");
    expect(src).toContain("/api/founder/autopilot/contentions");
    expect(src).toContain("conflictMemo");
    // Founder-gated like every other surface in this file.
    expect(/contentions[\s\S]{0,400}requireFounder/.test(src)).toBe(true);
  });

  it("the Decisions door renders the memo card's positions, costs, risks and default", () => {
    const src = read("client/src/pages/founder-decisions.tsx");
    expect(src).toContain("conflictMemo");
    expect(src).toContain("standingOrderProposal");
    // The proposal must read as a proposal on the glass, not as a fact.
    expect(src.toLowerCase()).toContain("not in force");
  });
});

// ─── Fleet-9 verifier catches — each fix pinned ─────────────────────────────

describe("fleet-9 catch — a memo never misdescribes its own subject", () => {
  it("positions that are not this contention's charters are REFUSED", () => {
    // The memo's headline label, question and resource come from the
    // REGISTRY, so mismatched positions would produce a card headed with one
    // fight while its two positions argue another.
    const outcome = evaluateContention({
      contention: "growth_vs_finance",
      positions: [
        { ...GROWTH_POSITION, charter: "ops" },
        { ...FINANCE_POSITION, charter: "support" },
      ],
      council: DIVIDED,
    });
    expect(outcome.memo).toBeNull();
    expect(outcome.reason).toBe("charter_mismatch");
  });

  it("but a FIRE still outranks the mismatch — the ladder is reported first", () => {
    const outcome = evaluateContention({
      contention: "growth_vs_finance",
      positions: [INCIDENT_POSITION, GROWTH_POSITION],
      council: DIVIDED,
    });
    expect(outcome.reason).toBe("ladder_decides");
  });
});

describe("fleet-9 catch — the memo claims only what the code checked", () => {
  it("the ladder sentence describes the move-kind check, not live senses", () => {
    const src = read("server/services/decisionsInbox.ts");
    // evaluateContention inspects the two positions' moveKind strings; it
    // never reads openIncidents / envelopeStatus / complianceOpenCount, so it
    // must not claim those would have decided the matter.
    expect(src).not.toMatch(/a red envelope or an open compliance finding would have decided/);
    expect(src).toContain("safety ladder did not decide this one");
  });
});

describe("fleet-9 catch — contention state reports unknown as unknown", () => {
  it("openMemos is nullable and a failed read is marked, never rendered as 0", () => {
    const src = read("server/services/autopilot/conflictMemo.ts");
    expect(src).toMatch(/openMemos: number \| null;/);
    expect(src).toMatch(/readFailed: boolean;/);
    // The failure path must null the count rather than leave the initialised 0.
    expect(src).toMatch(/readFailed = true;\s*\n\s*openMemos = null;/);
    // And the initial value is null, so an unreached read is never a zero.
    expect(src).toMatch(/let openMemos: number \| null = null;/);
  });
});

// ─── 7. S5 completion — the emitter WIRED at the council seam ───────────────
//
// Slice 9 built the memo and deliberately left fileConflictMemo with zero
// production callers, because filing a memo requires deriving two REAL charter
// positions and improvising them is how a fabricated memo gets born. These
// tests pin the derivation's honesty and the seam's blast radius:
//
//   • a contested tick whose two sides map to a registered contention files
//     exactly ONE memo, with costs that are real or honestly null;
//   • the same open contention on the next tick files NOTHING (the existing
//     open-memo dedupe is reused, not re-invented);
//   • a pair the registry does not describe files NOTHING — the derivation
//     refuses rather than bridging, and the file-layer charter check refuses
//     a mismatched pair with charter_mismatch;
//   • a throwing memo path returns a refusal instead of propagating, and the
//     seam assigns nothing, so the tick's own result cannot change.

/** A calm tick: nothing on fire, so the ranker offers growth + optimize. */
const CALM_SENSES: DecisionSenses = {
  openIncidents: 0,
  complianceOpenCount: 0,
  envelopeStatus: "green",
  supportBacklog: 0,
  trials: 4,
  activationStalled: false,
  mrr: 900,
  dispatchBacklog: 0,
  emailComplaints: 0,
  dunningPressure: 0,
  churnSignals: 0,
  trialsEnding: 0,
  reflexFailures: 0,
};
/** REAL moves from the authoritative ranker — never hand-written fixtures. */
const CALM_MOVES = rankMoves(CALM_SENSES);

/** A panel that split 1–1 (one voice dropped) — exactly two sides, contested. */
const SPLIT_GROWTH_OPS = aggregateCouncil([
  { recommendedKind: "grow_owned_channels" },
  { recommendedKind: "optimize" },
]);

const CALM_TICK = {
  moves: CALM_MOVES,
  council: SPLIT_GROWTH_OPS,
  deliberated: true,
  senses: CALM_SENSES,
  dispatchCeilingUsd: 5,
  budget: { capUsd: 50, spentUsd: 12.5 },
};

describe("a contested tick with two mappable positions files exactly ONE memo", () => {
  it("derives both positions from the REAL ranker + binding registry", async () => {
    const res = await maybeFileContentionMemo(CALM_TICK);

    expect(res.filed).toBe(true);
    expect(res.contention).toBe("budget_allocation");
    expect(INSERTED).toHaveLength(1);

    const memo = INSERTED[0].contextBundle.conflictMemo;
    expect(memo.contention).toBe("budget_allocation");
    expect(memo.positions.map((p: any) => p.charter).sort()).toEqual(["growth", "ops"]);

    // Each position's recommendation carries the ranker's OWN rationale — the
    // sentence decide.ts wrote from real counts, not a re-worded claim.
    const growth = memo.positions.find((p: any) => p.charter === "growth");
    const ops = memo.positions.find((p: any) => p.charter === "ops");
    const growMove = CALM_MOVES.find((m) => m.kind === "grow_owned_channels")!;
    expect(growth.moveKind).toBe("grow_owned_channels");
    expect(growth.recommendation).toContain(growMove.rationale);
    expect(ops.moveKind).toBe("optimize");

    // BOTH sides commit: every candidate move becomes a governed dispatch that
    // draws on the AI/data envelope, so neither position is the "free" one and
    // the no-commitment shortcut must not fire.
    expect(growth.requiresNewCommitment).toBe(true);
    expect(ops.requiresNewCommitment).toBe(true);
    // REWRITTEN to the new truth (fleet-10 verifier catch, rewrite-not-delete):
    // the original pin asserted "silence advances neither", which was itself
    // the false claim — the authoritative ladder ranks grow_owned_channels
    // ABOVE optimize, so doing nothing hands the next tick to growth. The
    // surviving invariant is unchanged: the default must state what silence
    // ACTUALLY does, never flatter it as neutrality.
    expect(memo.default.favors).toBe("growth");
    expect(memo.default.sentence).toContain("hands the next tick to growth");
    expect(memo.default.sentence).not.toContain("silence advances neither");
  });

  it("states each side's REAL binding — no position reads as consequence-free", async () => {
    await maybeFileContentionMemo(CALM_TICK);
    const memo = INSERTED[0].contextBundle.conflictMemo;
    const growth = memo.positions.find((p: any) => p.charter === "growth");
    const ops = memo.positions.find((p: any) => p.charter === "ops");
    // act.ts binds grow_owned_channels irreversible and optimize reversible;
    // both are internal. The card says so rather than implying either is free.
    expect(growth.cost.basis).toContain("irreversible");
    expect(ops.cost.basis).toContain("reversible");
    expect(ops.cost.basis).not.toContain("irreversible");
    for (const p of [growth, ops]) expect(p.cost.basis).toContain("internal");
  });

  it("costs are REAL — the ceiling the loop actually commits, with the envelope read", async () => {
    await maybeFileContentionMemo(CALM_TICK);
    const memo = INSERTED[0].contextBundle.conflictMemo;

    for (const p of memo.positions) {
      expect(p.cost.usd).toBe(5);
      expect(p.cost.basis).toContain("$5.00");
      expect(p.cost.basis).toContain("worst-case");
      // The live envelope read is quoted, not invented.
      expect(p.cost.basis).toContain("$12.50");
      expect(p.cost.basis).toContain("$50.00");
    }
    // Only the growth side is the deferrable one at the budget gate.
    const growth = memo.positions.find((p: any) => p.charter === "growth");
    const ops = memo.positions.find((p: any) => p.charter === "ops");
    expect(growth.cost.basis).toContain("deferrable");
    expect(ops.cost.basis).not.toContain("deferrable");
  });

  it("an unmeasurable cost is NULL with its basis — never a plausible number", async () => {
    await maybeFileContentionMemo({ ...CALM_TICK, dispatchCeilingUsd: null, budget: null });
    const memo = INSERTED[0].contextBundle.conflictMemo;
    for (const p of memo.positions) {
      expect(p.cost.usd).toBeNull();
      expect(p.cost.basis).toContain("not measured");
    }
  });

  it("an unreadable envelope says so instead of quoting a number it does not have", async () => {
    await maybeFileContentionMemo({ ...CALM_TICK, budget: null });
    const memo = INSERTED[0].contextBundle.conflictMemo;
    for (const p of memo.positions) {
      expect(p.cost.usd).toBe(5); // the ceiling IS known
      expect(p.cost.basis).toContain("not readable"); // the envelope is not
      expect(p.cost.basis).not.toContain("$50.00");
    }
  });

  it("risk reads come from the real coupling model, with honest absence when unmodeled", async () => {
    await maybeFileContentionMemo(CALM_TICK);
    const memo = INSERTED[0].contextBundle.conflictMemo;
    const growth = memo.positions.find((p: any) => p.charter === "growth");
    const ops = memo.positions.find((p: any) => p.charter === "ops");
    // crossFunction couples growth→support at +0.3 (its heaviest outward edge).
    expect(growth.risk.coupledCharter).toBe("support");
    expect(growth.risk.pressureAdded).toBeCloseTo(0.3, 5);
    // ops has NO outward coupling — the memo says that rather than inventing one.
    expect(ops.risk.coupledCharter).toBeNull();
    expect(ops.risk.pressureAdded).toBeNull();
    expect(ops.risk.basis.length).toBeGreaterThan(0);
  });
});

describe("a second tick with the same open memo files NOTHING", () => {
  it("reuses the OPEN memo for the fingerprint instead of spawning a duplicate", async () => {
    const first = await maybeFileContentionMemo(CALM_TICK);
    expect(first.filed).toBe(true);
    expect(INSERTED).toHaveLength(1);

    // The next tick sees the same contention still open on the door.
    FIND_FIRST.decisionsInboxItems = {
      id: INSERTED[0].id,
      itemType: CONFLICT_MEMO_ITEM_TYPE,
      status: "pending",
      contextBundle: { fingerprint: INSERTED[0].contextBundle.fingerprint },
    };

    const second = await maybeFileContentionMemo(CALM_TICK);
    expect(second.filed).toBe(false);
    expect(second.reason).toBe("reused_open_memo");
    expect(second.itemId).toBe(INSERTED[0].id);
    // The load-bearing assertion: still exactly one memo, and no update.
    expect(INSERTED).toHaveLength(1);
    expect(UPDATED).toHaveLength(0);
    expect(ARBITER_CALLS).toHaveLength(1);
  });
});

describe("an unmappable pair files nothing", () => {
  it("refuses a cross-charter pair no registered contention describes", async () => {
    const senses: DecisionSenses = { ...CALM_SENSES, supportBacklog: 2, dunningPressure: 1 };
    const res = await maybeFileContentionMemo({
      ...CALM_TICK,
      senses,
      moves: rankMoves(senses),
      council: aggregateCouncil([
        { recommendedKind: "clear_support_backlog" },
        { recommendedKind: "recover_payments" },
      ]),
    });
    expect(res.filed).toBe(false);
    expect(res.reason).toBe("no_registered_contention");
    expect(INSERTED).toHaveLength(0);
    expect(ARBITER_CALLS).toHaveLength(0);
  });

  it("refuses to bridge growth-vs-finance with a finance move that is not holding cash", async () => {
    // The registry asks "spend on acquisition now, or hold the cash for
    // runway?" — convert_trials is a SEND, not a hold, so filing it under that
    // headline would head the card with a fight its positions do not argue.
    const senses: DecisionSenses = { ...CALM_SENSES, trialsEnding: 3 };
    const res = await maybeFileContentionMemo({
      ...CALM_TICK,
      senses,
      moves: rankMoves(senses),
      council: aggregateCouncil([
        { recommendedKind: "grow_owned_channels" },
        { recommendedKind: "convert_trials" },
      ]),
    });
    expect(res.filed).toBe(false);
    expect(res.reason).toBe("no_registered_contention");
    expect(INSERTED).toHaveLength(0);
  });

  it("and the FILE layer still refuses a mismatched pair with charter_mismatch", async () => {
    // Belt and braces: even if a future caller bypassed the derivation, the
    // registry check refuses positions that are not this contention's charters.
    const res = await fileConflictMemo({
      contention: "budget_allocation",
      positions: [
        { ...GROWTH_POSITION, charter: "support" },
        { ...FINANCE_POSITION, charter: "deploy" },
      ],
      council: DIVIDED,
    });
    expect(res.created).toBe(false);
    expect(res.refused).toBe("charter_mismatch");
    expect(INSERTED).toHaveLength(0);
    expect(ARBITER_CALLS).toHaveLength(0);
  });

  it("every move pair in the derivation table names a REGISTERED contention", () => {
    // Drift guard: the memo's headline label, question and resource come from
    // the registry, so a table entry pointing at a contention that does not
    // exist would head a card with nothing at all.
    const src = read("server/services/autopilot/contentionPositions.ts");
    const keys = [...src.matchAll(/contention: "([a-z_]+)"/g)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(getContentionDef(key), `${key} must be a registered contention`).toBeTruthy();
    }
  });

  it("refuses a THREE-way split — two of three positions is not the whole contest", async () => {
    const senses: DecisionSenses = { ...CALM_SENSES, trialsEnding: 3 };
    const res = await maybeFileContentionMemo({
      ...CALM_TICK,
      senses,
      moves: rankMoves(senses),
      council: aggregateCouncil([
        { recommendedKind: "grow_owned_channels" },
        { recommendedKind: "optimize" },
        { recommendedKind: "convert_trials" },
      ]),
    });
    expect(res.filed).toBe(false);
    expect(res.reason).toBe("multi_way_split");
    expect(INSERTED).toHaveLength(0);
  });

  it("refuses a vote for a kind that is not in the tick's candidate set", async () => {
    const res = await maybeFileContentionMemo({
      ...CALM_TICK,
      council: aggregateCouncil([
        { recommendedKind: "grow_owned_channels" },
        { recommendedKind: "invent_a_new_thing" },
      ]),
    });
    expect(res.filed).toBe(false);
    expect(res.reason).toBe("vote_not_a_candidate");
    expect(INSERTED).toHaveLength(0);
  });

  it("files nothing when the council agreed, or when no panel deliberated", async () => {
    const agreed = await maybeFileContentionMemo({
      ...CALM_TICK,
      council: aggregateCouncil([
        { recommendedKind: "grow_owned_channels" },
        { recommendedKind: "grow_owned_channels" },
      ]),
    });
    expect(agreed.filed).toBe(false);
    expect(agreed.reason).toBe("council_not_contested");

    const undeliberated = await maybeFileContentionMemo({ ...CALM_TICK, deliberated: false });
    expect(undeliberated.filed).toBe(false);
    expect(undeliberated.reason).toBe("not_deliberated");
    expect(INSERTED).toHaveLength(0);
  });
});

describe("a throwing memo path leaves the tick's own result unchanged", () => {
  it("returns a refusal instead of propagating when the write fails", async () => {
    INSERT_THROWS = true;
    const res = await maybeFileContentionMemo(CALM_TICK);
    expect(res.filed).toBe(false);
    expect(res.reason).toBe("error");
    expect(res.itemId).toBeNull();
    expect(INSERTED).toHaveLength(0);
  });

  it("the seam calls it gated, wrapped, and assigns NOTHING", () => {
    const loop = read("server/services/solene/continuousLoop.ts");

    // Gated exactly as the council seam requires.
    expect(loop).toMatch(/del\.deliberated && councilIsContested\(del\.aggregate\)/);
    // Called, and its result is discarded — the tick cannot read it.
    expect(loop).toMatch(/\n\s*await maybeFileContentionMemo\(/);
    expect(loop).not.toMatch(/=\s*await maybeFileContentionMemo\(/);

    // Its OWN try/catch — folding it into the deliberation catch would log
    // "deliberation failed" for a memo failure, which is a false statement.
    expect(loop).toContain("conflict-memo path failed");

    // The seam sits at the council, after the confidence assignment.
    const conf = loop.indexOf("councilConf = del.confidence");
    const memo = loop.indexOf("maybeFileContentionMemo");
    expect(conf).toBeGreaterThan(-1);
    expect(memo).toBeGreaterThan(conf);

    // And the whole block touches none of the tick's own state.
    const block = loop.slice(loop.indexOf("councilIsContested(del.aggregate)"), memo + 900);
    for (const forbidden of ["councilConf =", "effectiveMoves =", "actMove", "outcome ="]) {
      expect(block.includes(forbidden), `the memo seam must not touch ${forbidden}`).toBe(false);
    }
  });

  it("the derivation widens no autonomy and writes no standing order", async () => {
    const src = read("server/services/autopilot/contentionPositions.ts");
    for (const forbidden of [
      "setDomainLevel",
      "recordCleanCycle",
      "recordAnomaly",
      "requestPromotion",
      "createStandingOrder",
      "setGrowthBudgetOverrideUsd",
      "planAndAct",
      "enqueueDispatch",
    ]) {
      expect(src.includes(forbidden), `contentionPositions.ts must not touch ${forbidden}`).toBe(false);
    }
    // Filing a memo writes exactly one row and updates nothing.
    await maybeFileContentionMemo(CALM_TICK);
    expect(INSERTED).toHaveLength(1);
    expect(UPDATED).toHaveLength(0);
  });
});

// ─── Fleet-10 verifier catches — the founder-facing sentences ───────────────

describe("fleet-10 catch — the memo's dollar figure names what it measures", () => {
  const src = read("server/services/autopilot/contentionPositions.ts");

  it("the spend line says autopilot DISPATCH spend, not all AI and data spend", () => {
    // The value comes from the agent_dispatch meter; calling it "AI and data
    // spend" understated the draw on the very envelope the card asks the
    // founder to allocate — on the one contention this emitter can file.
    expect(src).toContain("Month-to-date autopilot dispatch spend");
    expect(src).not.toContain("Month-to-date AI and data spend");
    // …and it says plainly what is excluded.
    expect(src).toContain("other AI spend");
  });

  it("the header describes the derivation the code performs, not one it doesn't", () => {
    // requiresNewCommitment is hardcoded true for every derived position; the
    // header claimed it was derived from act.ts's binding.
    expect(src).toMatch(/COMMITS something new → NOT derived/);
    expect(src).toContain("requiresNewCommitment: true");
  });
});
