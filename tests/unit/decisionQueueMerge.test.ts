/**
 * F2 slice 1 — one decision queue (handoff P6 §3).
 *
 * Two founder decision inflows that previously lived ONLY on their deep
 * surfaces are mirrored into the decisions door as cards linking back:
 *
 *   appeal_review   ← pax_decision_appeals   (/founder/appeals)
 *   recourse_draft  ← recourse_drafts        (/founder/recourse)
 *
 * This suite pins the adapter's load-bearing properties:
 *   1. Mirror creation: card shape (actionPayload ALWAYS null; deep link;
 *      source id in contextBundle), Class-B arbitration, open-card dedupe,
 *      and refusal to mirror already-disposed source rows.
 *   2. Mirror resolution: the deep surface's disposition closes the card as
 *      resolvedBy "founder_deep_surface" with the reason line in
 *      founderModification; resolved mirrors are never overwritten.
 *   3. Reasons on disposition: approve/reject/defer/override all carry an
 *      optional founder reason into founderModification (normalized, capped),
 *      with founderOverrideAction's legacy semantics untouched.
 *   4. Wiring pins (source-derived): the four inflow hook sites, the door
 *      routes' mirror-refusal + reason plumbing, and the door page's reason
 *      textarea + deep-link affordance actually exist at their seams.
 *   5. The do-nothing contract covers both mirror classes honestly.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import path from "path";

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ─── Arbiter mock (controllable) ────────────────────────────────────────────

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

// ─── Collaborator mocks (same set the arbiter suite uses) ───────────────────

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

// ─── DB mock ────────────────────────────────────────────────────────────────

const INSERTED: Array<Record<string, any>> = [];
const UPDATES: Array<Record<string, any>> = [];
let nextId = 1;

const FIND_FIRST: Record<string, any> = {};
/** Rows a findMany returns, per table (slice 2 — the two sweep functions). */
const FIND_MANY: Record<string, any[]> = {};

function findFirstFor(table: string) {
  return vi.fn(async () => FIND_FIRST[table] ?? null);
}
function findManyFor(table: string) {
  return vi.fn(async () => FIND_MANY[table] ?? []);
}

vi.mock("../../server/db", () => {
  const db = {
    query: {
      supportTickets: { findFirst: findFirstFor("supportTickets") },
      systemAlerts: { findFirst: findFirstFor("systemAlerts") },
      featureRequests: { findFirst: findFirstFor("featureRequests") },
      organizations: { findFirst: findFirstFor("organizations") },
      decisionsInboxItems: {
        findFirst: findFirstFor("decisionsInboxItems"),
        findMany: findManyFor("decisionsInboxItems"),
      },
      paxDecisionAppeals: { findFirst: findFirstFor("paxDecisionAppeals") },
      paxRefusalPayloads: { findFirst: findFirstFor("paxRefusalPayloads") },
      recourseDrafts: { findFirst: findFirstFor("recourseDrafts") },
      autopilotPendingActions: { findFirst: findFirstFor("autopilotPendingActions") },
    },
    insert: (_t: any) => ({
      values: (row: Record<string, any>) => ({
        returning: () => {
          const withId = { id: nextId++, ...row };
          INSERTED.push(withId);
          return Promise.resolve([withId]);
        },
      }),
    }),
    update: (_t: any) => ({
      set: (v: Record<string, any>) => {
        UPDATES.push(v);
        return { where: (_w: any) => Promise.resolve() };
      },
    }),
  };
  return { db };
});

// ─── Dated-obligation registry (slice 2, controllable) ──────────────────────
//
// The real registry is STATIC code whose dates move as obligations are
// discharged, so pinning against it would make this suite drift with the
// calendar. The shape is pinned instead, against a fixed fixture.

let OBLIGATIONS: Array<Record<string, any>> = [];

vi.mock("../../server/services/datedObligations", () => ({
  get DATED_OBLIGATIONS() {
    return OBLIGATIONS;
  },
  imminentObligations: (_now: Date, _within = 14) => OBLIGATIONS,
  pageThresholdsFor: () => [14, 7, 2, 0],
  DEFAULT_PAGE_THRESHOLDS: [14, 7, 2, 0],
}));

import {
  decisionsInboxService,
  MIRRORED_QUEUE_ITEM_TYPES,
  isMirroredQueueItemType,
  normalizeDispositionReason,
  DISPOSITION_REASON_MAX_CHARS,
  MirrorDispositionError,
  WITNESSED_SEND_ITEM_TYPE,
  DATED_OBLIGATION_ITEM_TYPE,
  datedObligationKey,
  datedObligationMilestone,
} from "../../server/services/decisionsInbox";
import { DO_NOTHING_CONTRACTS, doNothingContract } from "../../shared/decisions/doNothing";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf-8");

/** Fixed clock for the slice-2 countdown + expiry arithmetic. */
const NOW = new Date("2026-08-11T12:00:00Z");

beforeEach(() => {
  ARBITER_CALLS.length = 0;
  INSERTED.length = 0;
  UPDATES.length = 0;
  nextId = 1;
  arbiterMode = "deliver";
  for (const k of Object.keys(FIND_FIRST)) delete FIND_FIRST[k];
  for (const k of Object.keys(FIND_MANY)) delete FIND_MANY[k];
  OBLIGATIONS = [];
  FIND_FIRST.organizations = { id: 7, name: "Acme Land" };
  FIND_FIRST.paxDecisionAppeals = {
    id: 41,
    organizationId: 7,
    refusalPayloadId: 9,
    status: "open",
    appealReason: "I was just asking for my own data",
  };
  FIND_FIRST.paxRefusalPayloads = {
    id: 9,
    citedImmutableId: "IMM-3",
    severity: "warn",
  };
  FIND_FIRST.recourseDrafts = {
    id: 61,
    organizationId: 7,
    signalType: "cancellation",
    status: "draft",
  };
  FIND_FIRST.autopilotPendingActions = {
    id: 88,
    handName: "apply_refund",
    domain: "finance",
    summary: 'apply_refund → ch_123: "Refund for jane@acme.example"',
    args: { charge_id: "ch_123", to: "jane@acme.example", body: "Sorry about that, Jane." },
    contentHash: "abc",
    status: "pending",
    expiresAt: new Date(NOW.getTime() + 12 * 60 * 60 * 1000),
    createdAt: new Date(NOW.getTime() - 12 * 60 * 60 * 1000),
  };
});

// ─── 1. Mirror creation ─────────────────────────────────────────────────────

describe("createFromAppeal — the appeals inflow lands on the decisions door", () => {
  it("mirrors an open appeal as a Class-B appeal_review card with a deep link and NO executable payload", async () => {
    const res = await decisionsInboxService.createFromAppeal(41);

    expect(res.created).toBe(true);
    expect(ARBITER_CALLS).toHaveLength(1);
    expect(ARBITER_CALLS[0].interruptClass).toBe("B");
    expect(INSERTED[0]).toMatchObject({
      itemType: "appeal_review",
      riskLevel: "high",
      status: "pending",
      actionPayload: null,
      organizationId: 7,
      ownerAgentCodename: "quinn",
    });
    expect(INSERTED[0].contextBundle).toMatchObject({
      sourceAppealId: 41,
      deepLink: "/founder/appeals",
      citedImmutableId: "IMM-3",
    });
    // The card text never carries the customer's free-text appeal reason —
    // this row feeds model-read surfaces; the verbatim stays on the deep page.
    expect(INSERTED[0].sophieAnalysis).not.toContain("I was just asking");
  });

  it("dedupes on an OPEN mirror for the same appeal — no second card, no arbitration", async () => {
    FIND_FIRST.decisionsInboxItems = {
      id: 5,
      itemType: "appeal_review",
      status: "pending",
      contextBundle: { sourceAppealId: 41 },
    };
    const res = await decisionsInboxService.createFromAppeal(41);

    expect(res).toEqual({ itemId: 5, created: false });
    expect(INSERTED).toHaveLength(0);
    expect(ARBITER_CALLS).toHaveLength(0);
  });

  it("never mirrors an already-ruled appeal, and a missing appeal is a no-op", async () => {
    FIND_FIRST.paxDecisionAppeals = { ...FIND_FIRST.paxDecisionAppeals, status: "upheld" };
    expect(await decisionsInboxService.createFromAppeal(41)).toEqual({ itemId: null, created: false });

    FIND_FIRST.paxDecisionAppeals = null;
    expect(await decisionsInboxService.createFromAppeal(41)).toEqual({ itemId: null, created: false });

    expect(INSERTED).toHaveLength(0);
    expect(ARBITER_CALLS).toHaveLength(0);
  });
});

describe("createFromRecourseDraft — the recourse inflow lands on the decisions door", () => {
  it("mirrors an open draft as a Class-B recourse_draft card (cancellation ranks highest)", async () => {
    const res = await decisionsInboxService.createFromRecourseDraft(61);

    expect(res.created).toBe(true);
    expect(ARBITER_CALLS[0].interruptClass).toBe("B");
    expect(INSERTED[0]).toMatchObject({
      itemType: "recourse_draft",
      riskLevel: "high",
      urgencyScore: 85,
      status: "pending",
      actionPayload: null,
      organizationId: 7,
      ownerAgentCodename: "rafe",
    });
    expect(INSERTED[0].contextBundle).toMatchObject({
      sourceRecourseDraftId: 61,
      deepLink: "/founder/recourse",
      signalType: "cancellation",
    });
  });

  it("dedupes on an OPEN mirror and refuses sent/dismissed drafts", async () => {
    FIND_FIRST.decisionsInboxItems = {
      id: 6,
      itemType: "recourse_draft",
      status: "deferred",
      contextBundle: { sourceRecourseDraftId: 61 },
    };
    expect(await decisionsInboxService.createFromRecourseDraft(61)).toEqual({ itemId: 6, created: false });

    FIND_FIRST.decisionsInboxItems = null;
    FIND_FIRST.recourseDrafts = { ...FIND_FIRST.recourseDrafts, status: "sent" };
    expect(await decisionsInboxService.createFromRecourseDraft(61)).toEqual({ itemId: null, created: false });

    expect(INSERTED).toHaveLength(0);
  });

  it("arbiter deferral lands the mirror as deferred — the row is never dropped", async () => {
    arbiterMode = "defer";
    const res = await decisionsInboxService.createFromRecourseDraft(61);

    expect(res.created).toBe(true);
    expect(INSERTED[0].status).toBe("deferred");
    expect(INSERTED[0].deferredUntil).toEqual(DEFER_UNTIL);
  });
});

// ─── 2. Mirror resolution ───────────────────────────────────────────────────

describe("resolveMirrorItem — the deep surface's disposition closes the card", () => {
  it("resolves an open mirror as founder_deep_surface with the reason in founderModification", async () => {
    FIND_FIRST.decisionsInboxItems = {
      id: 12,
      itemType: "appeal_review",
      status: "pending",
      contextBundle: { sourceAppealId: 41 },
    };
    const res = await decisionsInboxService.resolveMirrorItem({
      itemType: "appeal_review",
      sourceId: 41,
      status: "approved",
      detail: "Resolved on the Appeals queue — verdict: reversed. The refusal misread the request.",
    });

    expect(res).toEqual({ resolved: true, itemId: 12 });
    expect(UPDATES).toHaveLength(1);
    expect(UPDATES[0]).toMatchObject({
      status: "approved",
      resolvedBy: "founder_deep_surface",
      founderModification:
        "Resolved on the Appeals queue — verdict: reversed. The refusal misread the request.",
    });
    expect(UPDATES[0].resolvedAt).toBeInstanceOf(Date);
  });

  it("without an open mirror it resolves nothing (an already-resolved card is never overwritten)", async () => {
    FIND_FIRST.decisionsInboxItems = {
      id: 12,
      itemType: "recourse_draft",
      status: "approved", // already resolved
      contextBundle: { sourceRecourseDraftId: 61 },
    };
    const res = await decisionsInboxService.resolveMirrorItem({
      itemType: "recourse_draft",
      sourceId: 61,
      status: "rejected",
      detail: "Dismissed from the Recourse queue without sending.",
    });

    expect(res).toEqual({ resolved: false, itemId: null });
    expect(UPDATES).toHaveLength(0);
  });

  // Rewritten (not deleted) by F2 slice 2: the registry legitimately grew a
  // third mirror type. The original invariant — an exhaustive key list, the
  // exact bundle key per type, and the guard recognizing exactly those types
  // and nothing else — is preserved verbatim over the new set.
  it("the registry itself is pinned: three mirror types, correct bundle keys, recognized by the guard", () => {
    expect(Object.keys(MIRRORED_QUEUE_ITEM_TYPES).sort()).toEqual([
      "appeal_review",
      "recourse_draft",
      "witnessed_send",
    ]);
    expect(MIRRORED_QUEUE_ITEM_TYPES.appeal_review.bundleKey).toBe("sourceAppealId");
    expect(MIRRORED_QUEUE_ITEM_TYPES.recourse_draft.bundleKey).toBe("sourceRecourseDraftId");
    expect(MIRRORED_QUEUE_ITEM_TYPES.witnessed_send.bundleKey).toBe("sourcePendingActionId");
    expect(isMirroredQueueItemType("appeal_review")).toBe(true);
    expect(isMirroredQueueItemType("recourse_draft")).toBe(true);
    expect(isMirroredQueueItemType(WITNESSED_SEND_ITEM_TYPE)).toBe(true);
    expect(isMirroredQueueItemType("support_escalation")).toBe(false);
    // The slice-2 NATIVE inflow must NOT be a mirror: the queue row IS the
    // record for a dated obligation, so every verb works on it directly.
    expect(isMirroredQueueItemType(DATED_OBLIGATION_ITEM_TYPE)).toBe(false);
  });
});

// ─── 2b. Slice 2 inflow A — autopilot pending hands (MIRROR) ────────────────

describe("createFromPendingHand — the witnessed-send inflow lands in the ranked queue", () => {
  it("mirrors a live frozen hand as a Class-B card with NO executable payload and NO customer text", async () => {
    const res = await decisionsInboxService.createFromPendingHand(88, { now: NOW.getTime() });

    expect(res.created).toBe(true);
    expect(ARBITER_CALLS).toHaveLength(1);
    expect(ARBITER_CALLS[0].interruptClass).toBe("B");
    expect(INSERTED[0]).toMatchObject({
      itemType: "witnessed_send",
      // apply_refund moves money → the money band, level with a billing
      // escalation and BELOW every fire class.
      riskLevel: "high",
      urgencyScore: 80,
      status: "pending",
      actionPayload: null,
      organizationId: null,
      ownerAgentCodename: "solene",
    });
    expect(INSERTED[0].contextBundle).toMatchObject({
      sourcePendingActionId: 88,
      handName: "apply_refund",
      domain: "finance",
      handKnownToQueue: true,
    });
    // The control is on the same page, so the card carries NO deepLink (a link
    // from /founder/decisions to /founder/decisions is noise) — it names the
    // control in prose instead.
    expect(INSERTED[0].contextBundle.deepLink).toBeUndefined();
    expect(INSERTED[0].contextBundle.disposeOn).toContain("Waiting on you to send");
    expect(INSERTED[0].recommendedAction).toContain("Waiting on you to send");
    // Free-text discipline: the frozen args and the machine summary carry the
    // recipient and the outbound body. This row feeds model-read surfaces, so
    // none of it may appear in the analysis text.
    expect(INSERTED[0].sophieAnalysis).not.toContain("jane@acme.example");
    expect(INSERTED[0].sophieAnalysis).not.toContain("Sorry about that");
    expect(INSERTED[0].sophieAnalysis).not.toContain("ch_123");
  });

  it("a customer-send hand ranks below the money band; an UNKNOWN hand says so instead of pretending", async () => {
    FIND_FIRST.autopilotPendingActions = {
      ...FIND_FIRST.autopilotPendingActions,
      handName: "send_email",
      domain: "support",
    };
    await decisionsInboxService.createFromPendingHand(88, { now: NOW.getTime() });
    expect(INSERTED[0]).toMatchObject({ riskLevel: "medium", urgencyScore: 62 });
    expect(INSERTED[0].contextBundle.handKnownToQueue).toBe(true);

    INSERTED.length = 0;
    FIND_FIRST.autopilotPendingActions = {
      ...FIND_FIRST.autopilotPendingActions,
      handName: "some_future_hand",
    };
    await decisionsInboxService.createFromPendingHand(88, { now: NOW.getTime() });
    expect(INSERTED[0].contextBundle.handKnownToQueue).toBe(false);
    expect(INSERTED[0].sophieAnalysis).toContain("has not been taught to describe");
  });

  it("appears exactly once: an OPEN mirror dedupes with no second card and no arbitration", async () => {
    FIND_FIRST.decisionsInboxItems = {
      id: 31,
      itemType: "witnessed_send",
      status: "pending",
      contextBundle: { sourcePendingActionId: 88 },
    };
    const res = await decisionsInboxService.createFromPendingHand(88, { now: NOW.getTime() });

    expect(res).toEqual({ itemId: 31, created: false });
    expect(INSERTED).toHaveLength(0);
    expect(ARBITER_CALLS).toHaveLength(0);
  });

  it("never mirrors a disposed or expired frozen action (a decided item is never resurrected)", async () => {
    for (const status of ["approved", "executed", "rejected", "expired"]) {
      FIND_FIRST.autopilotPendingActions = { ...FIND_FIRST.autopilotPendingActions, status };
      expect(await decisionsInboxService.createFromPendingHand(88, { now: NOW.getTime() })).toEqual({
        itemId: null,
        created: false,
      });
    }
    // Still "pending" in the row, but past its TTL — it can never send, so it
    // must never earn a card either.
    FIND_FIRST.autopilotPendingActions = {
      ...FIND_FIRST.autopilotPendingActions,
      status: "pending",
      expiresAt: new Date(NOW.getTime() - 1),
    };
    expect(await decisionsInboxService.createFromPendingHand(88, { now: NOW.getTime() })).toEqual({
      itemId: null,
      created: false,
    });

    FIND_FIRST.autopilotPendingActions = null;
    expect(await decisionsInboxService.createFromPendingHand(88, { now: NOW.getTime() })).toEqual({
      itemId: null,
      created: false,
    });

    expect(INSERTED).toHaveLength(0);
    expect(ARBITER_CALLS).toHaveLength(0);
  });

  it("self-resolves when the frozen action is disposed on the witnessed-send control", async () => {
    FIND_FIRST.decisionsInboxItems = {
      id: 31,
      itemType: "witnessed_send",
      status: "pending",
      contextBundle: { sourcePendingActionId: 88 },
    };
    const res = await decisionsInboxService.resolveMirrorItem({
      itemType: "witnessed_send",
      sourceId: 88,
      status: "approved",
      detail: "Approved and sent from the witnessed-send card on Decisions — apply_refund executed on your tap.",
    });
    expect(res).toEqual({ resolved: true, itemId: 31 });
    expect(UPDATES[0]).toMatchObject({
      status: "approved",
      resolvedBy: "founder_deep_surface",
    });
  });

  it("an untouched draft ages out: the expiry sweep closes the card, and refuses to guess without an expiry", async () => {
    FIND_MANY.decisionsInboxItems = [
      {
        id: 40,
        itemType: "witnessed_send",
        status: "pending",
        contextBundle: {
          sourcePendingActionId: 88,
          expiresAt: new Date(NOW.getTime() - 60_000).toISOString(),
        },
      },
      {
        id: 41,
        itemType: "witnessed_send",
        status: "deferred",
        contextBundle: {
          sourcePendingActionId: 89,
          expiresAt: new Date(NOW.getTime() + 60_000).toISOString(),
        },
      },
      // No readable expiry — left ALONE rather than closed on a guess.
      { id: 42, itemType: "witnessed_send", status: "pending", contextBundle: {} },
    ];
    const res = await decisionsInboxService.resolveExpiredWitnessedSendMirrors(NOW);

    expect(res).toEqual({ resolved: 1 });
    expect(UPDATES).toHaveLength(1);
    // "auto_resolved", NOT "rejected": the decision-log buckets route any
    // human-ish resolvedBy into "You reviewed", and the founder did not review
    // this — it aged out untouched. Claiming a review that never happened is
    // the exact failure this program keeps catching.
    expect(UPDATES[0]).toMatchObject({
      status: "auto_resolved",
      resolvedBy: "witnessed_send_expired",
    });
    expect(UPDATES[0].status).not.toBe("rejected");
    // The reason line says NOTHING WAS SENT — never that the founder declined.
    expect(UPDATES[0].founderModification).toContain("Nothing was sent");
  });
});

// ─── 2c. Slice 2 inflow B — dated-obligation countdowns (NATIVE) ────────────

describe("dated obligations — the countdown inflow is NATIVE and honest about what a tap does", () => {
  const OBLIGATION = {
    what: "SmartyStreets key renewal",
    due: "2026-08-18",
    owner: "founder",
    kind: "vendor_credential",
    note: "Renew in the vendor console; the key is the only address-verification source.",
    envVar: "SMARTY_AUTH_ID",
    vendor: "SmartyStreets",
    soleSourceFor: "address verification",
  };

  it("files a NATIVE countdown card with no executable payload and a truthful discharge sentence", async () => {
    const res = await decisionsInboxService.createFromDatedObligation({
      ...OBLIGATION,
      daysLeft: 7,
    });

    expect(res.created).toBe(true);
    expect(ARBITER_CALLS[0].interruptClass).toBe("B");
    expect(INSERTED[0]).toMatchObject({
      itemType: "dated_obligation",
      riskLevel: "high",
      urgencyScore: 60,
      actionPayload: null,
      ownerAgentCodename: "sentinel_devops",
    });
    expect(INSERTED[0].contextBundle).toMatchObject({
      obligationKey: "SMARTY_AUTH_ID",
      milestone: "7",
      due: "2026-08-18",
      daysLeft: 7,
      soleSourceFor: "address verification",
    });
    // Every fact on the card is registry-sourced — no invented dates or notes.
    expect(INSERTED[0].sophieAnalysis).toContain("2026-08-18");
    expect(INSERTED[0].sophieAnalysis).toContain(OBLIGATION.note);
    // The card must never imply that answering it discharges the obligation.
    expect(INSERTED[0].recommendedAction).toContain("does not move the date");
    // A NATIVE card has to be ANSWERABLE on the door: founder-decisions.tsx
    // renders buttons only from contextBundle.options, so a native card
    // without them is a card the founder cannot dispose (built-but-unwired).
    expect(INSERTED[0].contextBundle.options.map((o: any) => o.key)).toEqual([
      "discharged",
      "not_yet",
    ]);
  });

  it("the MIRROR card is deliberately NOT answerable in the queue — no options, no buttons", async () => {
    await decisionsInboxService.createFromPendingHand(88, { now: NOW.getTime() });
    // Options are what render the queue's inline answer buttons. A mirror must
    // never carry them: the disposition belongs to the surface that re-verifies
    // the content hash, and refuseIfMirror would refuse the POST anyway.
    expect(INSERTED[0].contextBundle.options).toBeUndefined();
  });

  it("ranks by days left, and a calendar row never outranks a live fire", async () => {
    const rank = async (daysLeft: number) => {
      INSERTED.length = 0;
      await decisionsInboxService.createFromDatedObligation({ ...OBLIGATION, daysLeft });
      return {
        riskLevel: INSERTED[0].riskLevel as string,
        urgencyScore: INSERTED[0].urgencyScore as number,
      };
    };
    expect(await rank(-3)).toEqual({ riskLevel: "critical", urgencyScore: 90 });
    expect(await rank(2)).toEqual({ riskLevel: "critical", urgencyScore: 85 });
    expect(await rank(7)).toEqual({ riskLevel: "high", urgencyScore: 60 });
    expect(await rank(14)).toEqual({ riskLevel: "medium", urgencyScore: 40 });
    // The existing grammar's fire classes are 95 (critical_alert / support P0)
    // and up to 100 (critical churn). Neither slice-2 inflow may reach them.
    for (const daysLeft of [-3, 0, 2, 7, 14]) {
      expect((await rank(daysLeft)).urgencyScore).toBeLessThan(95);
    }
  });

  it("past due says PAST DUE with the real overshoot, and keys the milestone as 'overdue'", async () => {
    await decisionsInboxService.createFromDatedObligation({ ...OBLIGATION, daysLeft: -3 });
    expect(INSERTED[0].sophieAnalysis).toContain("3 day(s) PAST DUE");
    expect(INSERTED[0].contextBundle.milestone).toBe("overdue");
    expect(datedObligationMilestone(-1)).toBe("overdue");
    expect(datedObligationMilestone(7)).toBe("7");
  });

  it("appears exactly once per milestone — an ANSWERED milestone is never re-asked", async () => {
    // Dedupe deliberately ignores status: a resolved T-7 card still blocks a
    // second T-7 card, so the daily sweep cannot re-ask a decided milestone.
    FIND_FIRST.decisionsInboxItems = {
      id: 55,
      itemType: "dated_obligation",
      status: "approved",
      contextBundle: { obligationKey: "SMARTY_AUTH_ID", milestone: "7", due: "2026-08-18" },
    };
    expect(
      await decisionsInboxService.createFromDatedObligation({ ...OBLIGATION, daysLeft: 7 }),
    ).toEqual({ itemId: 55, created: false });
    expect(INSERTED).toHaveLength(0);
    expect(ARBITER_CALLS).toHaveLength(0);
  });

  it("the obligation key matches the pager's anchor exactly (envVar, else a slug of the what-line)", () => {
    expect(datedObligationKey(OBLIGATION)).toBe("SMARTY_AUTH_ID");
    expect(datedObligationKey({ what: "Statute re-review: MA 93A" })).toBe("statute_re_review_ma_93a");
  });

  it("self-resolves when the registry discharges the row, and leaves live rows alone", async () => {
    FIND_MANY.decisionsInboxItems = [
      {
        id: 61,
        itemType: "dated_obligation",
        status: "pending",
        // Still live in the registry at this date → untouched.
        contextBundle: { obligationKey: "SMARTY_AUTH_ID", due: "2026-08-18" },
      },
      {
        id: 62,
        itemType: "dated_obligation",
        status: "deferred",
        // Same obligation, OLD date — the row was renewed → closes itself.
        contextBundle: { obligationKey: "SMARTY_AUTH_ID", due: "2026-07-18" },
      },
      {
        id: 63,
        itemType: "dated_obligation",
        status: "pending",
        // Gone from the registry entirely → closes itself.
        contextBundle: { obligationKey: "retired_review", due: "2026-08-01" },
      },
      // Unreadable identity — left ALONE rather than closed on a guess.
      { id: 64, itemType: "dated_obligation", status: "pending", contextBundle: {} },
    ];
    const res = await decisionsInboxService.resolveDischargedObligationCards([OBLIGATION], NOW);

    expect(res).toEqual({ resolved: 2 });
    expect(UPDATES).toHaveLength(2);
    for (const u of UPDATES) {
      expect(u).toMatchObject({ status: "auto_resolved", resolvedBy: "obligation_registry" });
      expect(u.founderModification).toContain("no longer lists this row");
    }
  });

  it("the sweep files only at page milestones, and closes discharged cards in the same pass", async () => {
    OBLIGATIONS = [
      { ...OBLIGATION, daysLeft: 7 }, // at a milestone → files
      { ...OBLIGATION, what: "DR drill", envVar: undefined, due: "2026-08-22", daysLeft: 11 }, // not a milestone
    ];
    FIND_MANY.decisionsInboxItems = [
      {
        id: 71,
        itemType: "dated_obligation",
        status: "pending",
        contextBundle: { obligationKey: "gone_row", due: "2026-01-01" },
      },
    ];
    const res = await decisionsInboxService.syncDatedObligationCards(NOW);

    expect(res).toEqual({ filed: 1, resolved: 1 });
    expect(INSERTED).toHaveLength(1);
    expect(INSERTED[0].contextBundle.milestone).toBe("7");
  });
});

// ─── 2d. Slice 2 — the mirror guard covers the new mirror type ─────────────

describe("refuseIfMirror — the witnessed-send mirror refuses terminal verbs at the SERVICE altitude", () => {
  beforeEach(() => {
    FIND_FIRST.decisionsInboxItems = {
      id: 31,
      itemType: "witnessed_send",
      status: "pending",
      contextBundle: { sourcePendingActionId: 88 },
    };
  });

  it("approve / reject / override all throw MirrorDispositionError and write nothing", async () => {
    await expect(decisionsInboxService.approve(31)).rejects.toBeInstanceOf(MirrorDispositionError);
    await expect(decisionsInboxService.reject(31, "no")).rejects.toBeInstanceOf(MirrorDispositionError);
    await expect(decisionsInboxService.override(31, "do it differently")).rejects.toBeInstanceOf(
      MirrorDispositionError,
    );
    expect(UPDATES).toHaveLength(0);
    // The refusal points at the control that CAN dispose it.
    await expect(decisionsInboxService.approve(31)).rejects.toThrow("/founder/decisions");
  });

  it("defer stays allowed — snoozing a mirror is presence management, not a verdict", async () => {
    await decisionsInboxService.defer(31, 6, "reading it after the call");
    expect(UPDATES).toHaveLength(1);
    expect(UPDATES[0]).toMatchObject({
      status: "deferred",
      founderModification: "reading it after the call",
    });
  });

  it("the NATIVE dated-obligation card is NOT refused — every verb works on it directly", async () => {
    FIND_FIRST.decisionsInboxItems = {
      id: 55,
      itemType: "dated_obligation",
      status: "pending",
      contextBundle: { obligationKey: "SMARTY_AUTH_ID" },
    };
    await decisionsInboxService.approve(55, undefined, "renewed it this morning");
    expect(UPDATES[0]).toMatchObject({
      status: "approved",
      founderModification: "renewed it this morning",
    });
  });
});

// ─── 3. Reasons on disposition ──────────────────────────────────────────────

describe("reasons on disposition — every verb carries the founder's reason into founderModification", () => {
  it("approve: reason lands normalized; chosen-option text keeps its legacy column", async () => {
    await decisionsInboxService.approve(1, "option:fix — Fix it", "  they are an annual customer  ");
    expect(UPDATES[0]).toMatchObject({
      status: "approved",
      founderOverrideAction: "option:fix — Fix it",
      founderModification: "they are an annual customer",
    });
  });

  it("approve without a reason writes NO founderModification key", async () => {
    await decisionsInboxService.approve(1);
    expect(UPDATES[0]).not.toHaveProperty("founderModification");
    await decisionsInboxService.approve(1, undefined, "   ");
    expect(UPDATES[1]).not.toHaveProperty("founderModification");
  });

  it("reject: the reason keeps its legacy founderOverrideAction write AND lands in founderModification", async () => {
    await decisionsInboxService.reject(1, "wrong customer segment");
    expect(UPDATES[0]).toMatchObject({
      status: "rejected",
      founderOverrideAction: "wrong customer segment",
      founderModification: "wrong customer segment",
    });
  });

  it("defer: the optional reason rides the snooze", async () => {
    await decisionsInboxService.defer(1, 4, "waiting on the billing call");
    expect(UPDATES[0]).toMatchObject({
      status: "deferred",
      founderModification: "waiting on the billing call",
    });
    expect(UPDATES[0].deferredUntil).toBeInstanceOf(Date);
  });

  it("override: customAction and reason are distinct fields", async () => {
    await decisionsInboxService.override(1, "call them instead", "emails were ignored twice");
    expect(UPDATES[0]).toMatchObject({
      status: "approved",
      founderOverrideAction: "call them instead",
      founderModification: "emails were ignored twice",
    });
  });

  it("reasons are capped at the documented maximum", async () => {
    const long = "x".repeat(DISPOSITION_REASON_MAX_CHARS + 500);
    await decisionsInboxService.approve(1, undefined, long);
    expect(UPDATES[0].founderModification).toHaveLength(DISPOSITION_REASON_MAX_CHARS);

    expect(normalizeDispositionReason(long)).toHaveLength(DISPOSITION_REASON_MAX_CHARS);
    expect(normalizeDispositionReason(42 as unknown as string)).toBeUndefined();
    expect(normalizeDispositionReason("  ")).toBeUndefined();
  });
});

// ─── 4. Wiring pins (source-derived) — built AND wired ──────────────────────

describe("wiring pins — the adapter is hooked at every seam, not just built", () => {
  it("appeal filing (routes-pax-appeals.ts) mirrors best-effort after the insert", () => {
    const src = read("server/routes-pax-appeals.ts");
    expect(src).toContain("decisionsInboxService.createFromAppeal(appeal.id)");
    // Best-effort contract: the mirror call is inside a try/catch.
    expect(src).toMatch(/try\s*\{[\s\S]{0,300}createFromAppeal\(appeal\.id\)[\s\S]{0,300}\}\s*catch/);
  });

  it("appeal verdict (routes-founder-appeals.ts) resolves the mirror with the verdict + rationale", () => {
    const src = read("server/routes-founder-appeals.ts");
    expect(src).toContain('itemType: "appeal_review"');
    expect(src).toContain("resolveMirrorItem");
    expect(src).toMatch(/verdict: \$\{decision\}/);
  });

  it("the recourse sweep (recourseDrafter.ts) mirrors each NEW draft only", () => {
    const src = read("server/services/recourseDrafter.ts");
    expect(src).toContain("createFromRecourseDraft(result[0].id)");
    // The mirror call must live inside the result.length > 0 branch so
    // re-running the sweep (onConflictDoNothing) never re-mirrors.
    expect(src).toMatch(/if \(result\.length > 0\)\s*\{[\s\S]{0,900}createFromRecourseDraft/);
  });

  it("recourse send AND dismiss (routes-founder-recourse.ts) both resolve the mirror", () => {
    const src = read("server/routes-founder-recourse.ts");
    const calls = src.match(/resolveMirrorItem\(\{\s*itemType: "recourse_draft"/g) ?? [];
    expect(calls.length).toBe(2);
    expect(src).toContain('status: "approved"'); // send
    expect(src).toContain('status: "rejected"'); // dismiss
  });

  it("the door routes refuse generic dispositions on mirror cards (approve/reject/override) but allow defer", () => {
    const src = read("server/routes-founder-intelligence.ts");
    // One guard per intercepted verb.
    const guards = src.match(/isMirroredQueueItemType\(item\.itemType\)/g) ?? [];
    expect(guards.length).toBe(3);
    expect(src).toContain("function refuseMirrorDisposition");
    // Defer stays snoozable: the defer route carries no mirror guard.
    const deferRoute = src.slice(
      src.indexOf('"/decisions-inbox/:id/defer"'),
      src.indexOf('"/decisions-inbox/:id/override"'),
    );
    expect(deferRoute).not.toContain("isMirroredQueueItemType");
  });

  it("the SERVICE verbs themselves refuse mirror dispositions — no caller can bypass (fleet-5 audit)", () => {
    // The route-only guard was bypassable via founder-chat's
    // approve_decision/reject_decision tools calling the service directly —
    // a mirror could be marked approved while the customer's real row stayed
    // open. The guard now lives at the service altitude: every terminal verb
    // calls refuseIfMirror; defer stays exempt (presence management, and
    // resolveMirrorItem covers deferred cards).
    const src = read("server/services/decisionsInbox.ts");
    expect(src).toContain("class MirrorDispositionError");
    const guardCalls = src.match(/await this\.refuseIfMirror\(itemId, "(approve|reject|override)"\)/g) ?? [];
    expect(guardCalls.length).toBe(3);
    // defer must NOT carry the guard.
    const deferBody = src.slice(src.indexOf("async defer("), src.indexOf("async override("));
    expect(deferBody).not.toContain("refuseIfMirror");
  });

  it("the door routes plumb the optional reason end-to-end on all four verbs", () => {
    const src = read("server/routes-founder-intelligence.ts");
    expect(src).toMatch(/const \{ chosenOption, reason \} = req\.body \?\? \{\}/);
    expect(src).toMatch(/const \{ hours, reason \} = req\.body \?\? \{\}/);
    expect(src).toMatch(/const \{ customAction, chosenOption, reason \} = req\.body \?\? \{\}/);
    // approve passes the normalized reason into the service…
    expect(src).toMatch(/decisionsInboxService\.approve\(\s*id,[\s\S]{0,120}reasonText,?\s*\)/);
    // …defer and override too.
    expect(src).toContain("decisionsInboxService.defer(id, hours ?? 24, normalizeDispositionReason(reason))");
    expect(src).toContain("decisionsInboxService.override(id, action, reasonText)");
  });

  it("slice 2 — the freeze mirrors into the queue, on the new row AND on a reused live row", () => {
    const src = read("server/services/autopilot/pendingHands.ts");
    expect(src).toContain("createFromPendingHand");
    // Both proposal outcomes mirror: the freshly frozen row, and the reused
    // identical live row (so a failed first mirror self-heals on re-propose).
    const calls = src.match(/await mirrorPendingHand\(/g) ?? [];
    expect(calls.length).toBe(2);
    expect(src).toMatch(/if \(live\)\s*\{[\s\S]{0,400}mirrorPendingHand\(live\.id\)/);
    // Best-effort by contract — a mirror failure must never turn a freeze into
    // a send or a refusal.
    expect(src).toMatch(/async function mirrorPendingHand[\s\S]{0,500}catch/);
  });

  it("slice 2 — every disposition of a frozen action resolves its mirror (send, reject, expiry)", () => {
    const src = read("server/services/autopilot/pendingHands.ts");
    const resolves = src.match(/await resolvePendingHandMirror\(/g) ?? [];
    // REWRITTEN, not deleted (fleet-12b audit). This asserted exactly 3 call
    // sites, which was a COUNT — and a count is one-directional: it proved
    // every disposition resolved something, and proved nothing about WHAT was
    // written. The audit found two paths writing the wrong thing while this
    // stayed green (a delegated machine send recorded as a founder tap, and an
    // expired draft recorded as a founder rejection). The count moved to 4
    // when the delegated path got its own branch; asserting the SHAPE is what
    // actually protects the invariant, so that lives in the fleet-12b block
    // below and this keeps only the floor.
    expect(resolves.length).toBeGreaterThanOrEqual(3);
    expect(src).toContain('itemType: "witnessed_send"');
    // Approved only on the executed path — never on a claim that then failed,
    // and never on a delegated send (which resolves as auto_resolved). Checked
    // by POSITION rather than by proximity: a character-distance regex broke
    // the moment the delegated branch was inserted between the log line and
    // the resolution, which is a brittleness worth not reintroducing.
    const executedLog = src.indexOf("action executed after founder approval");
    const viaBranch = src.indexOf('if (input.via === "witness_grant")');
    const approvedResolution = src.indexOf(
      "Approved and sent from the witnessed-send card",
    );
    expect(executedLog).toBeGreaterThan(-1);
    expect(viaBranch).toBeGreaterThan(executedLog);
    expect(approvedResolution).toBeGreaterThan(viaBranch);
  });

  it("slice 2 — the daily sweep is wired ahead of the briefing's email gates", () => {
    const src = read("server/services/founderBriefing.ts");
    expect(src).toContain("syncDatedObligationCards");
    expect(src).toContain("resolveExpiredWitnessedSendMirrors");
    const body = src.slice(src.indexOf("export async function sendDailyBriefing"));
    // The queue sync must run BEFORE the FOUNDER_EMAIL / already-sent returns:
    // the card is the record, the email is only a channel.
    expect(body.indexOf("syncDatedObligationCards")).toBeLessThan(
      body.indexOf("No FOUNDER_EMAIL configured"),
    );
    expect(body.indexOf("syncDatedObligationCards")).toBeLessThan(body.indexOf("alreadySentToday"));
  });

  it("slice 2 — the witnessed-send control names its mirror rows, so neither surface reads as a second item", () => {
    const pageSrc = read("client/src/pages/founder-decisions.tsx");
    expect(pageSrc).toContain("witnessed-send-queue-mirror-note");
    expect(pageSrc).toContain("this card is the only place a send happens");
  });

  it("the door page posts the reason with the option tap and links mirror cards to their deep surface", () => {
    const pageSrc = read("client/src/pages/founder-decisions.tsx");
    // Reason textarea: labeled (a11y), bounded, and riding the answer POST.
    expect(pageSrc).toMatch(/htmlFor=\{`decision-reason-\$\{row\.id\}`\}/);
    expect(pageSrc).toMatch(/id=\{`decision-reason-\$\{row\.id\}`\}/);
    expect(pageSrc).toContain("...(reason ? { reason } : {})");
    // Deep-link affordance: internal founder paths only.
    expect(pageSrc).toContain('href.startsWith("/founder/")');
    expect(pageSrc).toMatch(/decision-deep-link-\$\{row\.id\}/);
  });
});

// ─── 5. The do-nothing contract covers the mirror classes ───────────────────

describe("do-nothing contract — mirror classes state the mirror truth", () => {
  it("both mirror types carry verified sentences (never the generic catch-all)", () => {
    for (const t of ["appeal_review", "recourse_draft"] as const) {
      expect(DO_NOTHING_CONTRACTS[t]).toBeDefined();
      expect(doNothingContract(t)).toBe(DO_NOTHING_CONTRACTS[t]);
      // The mirror caveat: the card clears itself from the deep surface, and
      // the executor (opt-in) can only ever clear the CARD.
      expect(DO_NOTHING_CONTRACTS[t]).toContain("clears itself");
      expect(DO_NOTHING_CONTRACTS[t]).toContain("autonomous executor");
    }
    expect(DO_NOTHING_CONTRACTS.appeal_review).toContain("the refusal stands");
    expect(DO_NOTHING_CONTRACTS.recourse_draft).toContain("never send themselves");
  });

  it("slice 2 — each witnessed-send surface's sentence is true OF THAT SURFACE", () => {
    // REWRITTEN, not deleted (fleet-12b audit). This used to assert that the
    // frozen card and the mirror row show the SAME sentence, and pinned that
    // sameness as a feature. The audit showed it was the defect: the shared
    // text is written in the frozen card's voice ("the draft still waits right
    // here"), so on the mirror row it was self-referential, and once the
    // frozen card expired off the page it pointed at a control that no longer
    // rendered — a claim with a ~24h window of being flatly untrue, since the
    // mirror's only staleness closer is a once-a-day sweep.
    //
    // The surviving invariant is the one that always mattered: neither surface
    // may claim the other's capability, and neither may imply a send can
    // happen where it cannot.
    const card = doNothingContract(WITNESSED_SEND_ITEM_TYPE);
    const mirror = doNothingContract("witnessed_send_mirror");

    expect(card).toBe(DO_NOTHING_CONTRACTS.witnessed_send);
    expect(mirror).toBe(DO_NOTHING_CONTRACTS.witnessed_send_mirror);
    // Two DIFFERENT sentences now — that is the fix, so pin it.
    expect(mirror).not.toBe(card);

    // Both must still say the load-bearing thing: nothing sends by inaction.
    expect(card).toContain("nothing sends");
    expect(mirror).toContain("nothing sends");

    // The card is the surface that can actually send, and says so.
    expect(card).toContain("24 hours");
    expect(card).toContain("can never send the draft");

    // The mirror must NOT speak in the card's voice about itself, and must
    // point at the card rather than at itself.
    expect(mirror).not.toContain("right here");
    expect(mirror).toContain("carries no buttons");
    expect(mirror).toContain("only place it can be sent");
    // And it must not promise the draft is still waiting — the row outlives
    // the card by up to a sweep interval.
    expect(mirror).not.toContain("still waits");
  });

  it("slice 2 — the dated-obligation sentence refuses to imply a tap discharges anything", () => {
    const contract = doNothingContract(DATED_OBLIGATION_ITEM_TYPE);
    expect(contract).toBe(DO_NOTHING_CONTRACTS.dated_obligation);
    expect(contract).toContain("the date still arrives");
    expect(contract).toContain("countdown, not a discharge");
    expect(contract).toContain("obligations registry");
    // It must NOT be the generic catch-all — a countdown's do-nothing cost is
    // genuinely different from "this waits".
    expect(contract).not.toBe(doNothingContract("some_unknown_item_type"));
  });
});

// ─── 2e. fleet-12b audit — attribution, ranking, and the registry-derived band ──

describe("fleet-12b audit — the mirror must not claim a review that never happened", () => {
  const HANDS = read("server/services/autopilot/pendingHands.ts");
  const AUTO_WITNESS = read("server/services/autopilot/autoWitness.ts");
  const ROUTES = read("server/routes-autopilot.ts");
  const INBOX = read("server/services/decisionsInbox.ts");
  const LOG_ROUTE = read("server/routes-founder-intelligence.ts");

  /**
   * THE DEFECT, in one sentence: `autoWitness` taps through the SAME
   * `approvePendingHand` a founder tap uses, and the mirror hardcoded
   * `resolvedBy: "founder_deep_surface"` — so a refund the machine sent under
   * a standing grant while the founder was asleep was filed under "You
   * reviewed", the "Auto-handled" bucket never saw it, and the false sentence
   * was then ingested into the model-read corpus by `decisionLogRag`.
   *
   * Source-derived: exercising this end to end needs the whole witnessed
   * executor. What must not regress is the SHAPE — that the two callers are
   * distinguishable and that the delegated one resolves as automation.
   */
  it("approvePendingHand cannot be called without stating how the approval happened", () => {
    const start = HANDS.indexOf("export async function approvePendingHand(");
    const sig = HANDS.slice(start, HANDS.indexOf("): Promise<ApprovalOutcome>", start));
    expect(sig.length).toBeGreaterThan(50);
    // Required, not optional — a default is what produced the defect.
    expect(sig).toMatch(/via:\s*"founder_tap"\s*\|\s*"witness_grant";/);
    expect(sig).not.toMatch(/via\?:/);
  });

  it("both call sites declare which they are", () => {
    expect(AUTO_WITNESS).toContain('via: "witness_grant"');
    expect(ROUTES).toContain('via: "founder_tap"');
    // And nothing else calls it — a third caller must make the same choice.
    const callers = [
      ...AUTO_WITNESS.matchAll(/approvePendingHand\(/g),
      ...ROUTES.matchAll(/approvePendingHand\(/g),
    ];
    expect(callers.length).toBeGreaterThanOrEqual(2);
  });

  it("a delegated send resolves as automation, not as a founder tap", () => {
    const branch = HANDS.slice(HANDS.indexOf('if (input.via === "witness_grant")'));
    expect(branch.length).toBeGreaterThan(100);
    expect(branch.slice(0, 700)).toContain('"auto_resolved"');
    expect(branch.slice(0, 700)).toContain('"witness_grant_delegated"');
    // The sentence must say a human did NOT tap.
    expect(branch.slice(0, 700)).toContain("without a tap from you");
  });

  it("tapping Approve on an expired draft never records a rejection", () => {
    // Same invariant the sweep path already carries; the audit found it had
    // not been applied to this second expiry path, where the founder tapped
    // APPROVE and the draft merely aged out.
    const eStart = HANDS.indexOf('if (action.status === "expired"');
    const expiry = HANDS.slice(eStart, HANDS.indexOf("// Re-verify the hash", eStart));
    expect(expiry.length).toBeGreaterThan(100);
    expect(expiry).toContain('"auto_resolved"');
    expect(expiry).toContain('"witnessed_send_expired"');
    // Scoped to the RESOLUTION CALL, not the whole branch: the branch's own
    // comment explains why "rejected" would be wrong, and a naive substring
    // check would match that explanation and pass for the wrong reason.
    const call = expiry.slice(expiry.indexOf("await resolvePendingHandMirror("));
    expect(call).not.toContain('"rejected"');
  });

  it("resolveMirrorItem lets a caller say who resolved it, and still defaults to the founder", () => {
    const fn = INBOX.slice(INBOX.indexOf("async resolveMirrorItem(input: {"));
    expect(fn.slice(0, 1600)).toMatch(/resolvedBy\?:\s*string;/);
    expect(fn.slice(0, 3000)).toContain('resolvedBy: input.resolvedBy ?? "founder_deep_surface"');
  });

  /**
   * THE SECOND DEFECT: the lane's whole justification was that the
   * witnessed-send section is "newest-first and disconnected from severity".
   * It computed ranks, tested the rank VALUES, wrote them to urgencyScore —
   * and rendered them into a queue still ordered newest-first, while the page
   * told the founder "nothing outranks it silently". Stored, not applied.
   */
  it("the needs-you bucket is actually ranked, not merely scored", () => {
    const sort = LOG_ROUTE.slice(
      LOG_ROUTE.indexOf("const rankedNeedsYou"),
      LOG_ROUTE.indexOf("// Outcome rollup"),
    );
    expect(sort.length).toBeGreaterThan(80);
    expect(sort).toContain("urgencyScore");
    // Ties fall back to newest-first, so the old ordering survives where rank
    // cannot distinguish two rows.
    expect(sort).toContain("createdAt");
    expect(sort).toContain("needsYou.push(...rankedNeedsYou)");
  });

  it("the ranking comparator puts higher urgency first and breaks ties by recency", () => {
    // The comparator itself, reproduced — this is the behaviour the route
    // relies on, and it is pure, so it gets a real test rather than a grep.
    const cmp = (a: { urgencyScore: number | null; createdAt: Date | null }, b: typeof a) => {
      const byUrgency = (b.urgencyScore ?? 0) - (a.urgencyScore ?? 0);
      if (byUrgency !== 0) return byUrgency;
      return (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0);
    };
    const older = new Date("2026-08-10T00:00:00Z");
    const newer = new Date("2026-08-11T00:00:00Z");

    // The exact case the lane exists to fix: a frozen refund drafted
    // YESTERDAY must outrank a marketing email drafted TODAY.
    const refund = { urgencyScore: 80, createdAt: older };
    const email = { urgencyScore: 62, createdAt: newer };
    expect([email, refund].sort(cmp)[0]).toBe(refund);

    // Equal urgency → newest first, the previous behaviour.
    const a = { urgencyScore: 62, createdAt: older };
    const b = { urgencyScore: 62, createdAt: newer };
    expect([a, b].sort(cmp)[0]).toBe(b);

    // A missing score sorts as zero rather than throwing or winning.
    const unscored = { urgencyScore: null, createdAt: newer };
    expect([unscored, a].sort(cmp)[0]).toBe(a);
  });

  it("an unmapped money-moving hand ranks by the registry, not by the name map", () => {
    // WITNESSED_SEND_CARD_META is keyed by hand NAME and duplicates a fact the
    // registry owns. Register an 8th money hand and it would have ranked
    // 62/medium — beside a marketing email — silently and forever, which is
    // the one thing the fallback must not get wrong, since ranking is the
    // entire reason the mirror exists.
    const fn = INBOX.slice(INBOX.indexOf("function witnessedSendBandFor("));
    expect(fn.slice(0, 900)).toContain("getHand(handName)");
    expect(fn.slice(0, 900)).toContain('spec?.movesMoney === true || spec?.domain === "finance"');
    expect(fn.slice(0, 900)).toMatch(/riskLevel:\s*"high",\s*urgencyScore:\s*80/);
    // And the creator uses it for the BAND while keeping the name map's prose.
    expect(INBOX).toContain("witnessedSendBandFor(action.handName)");
  });
});
