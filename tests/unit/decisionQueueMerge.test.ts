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

function findFirstFor(table: string) {
  return vi.fn(async () => FIND_FIRST[table] ?? null);
}

vi.mock("../../server/db", () => {
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

import {
  decisionsInboxService,
  MIRRORED_QUEUE_ITEM_TYPES,
  isMirroredQueueItemType,
  normalizeDispositionReason,
  DISPOSITION_REASON_MAX_CHARS,
} from "../../server/services/decisionsInbox";
import { DO_NOTHING_CONTRACTS, doNothingContract } from "../../shared/decisions/doNothing";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf-8");

beforeEach(() => {
  ARBITER_CALLS.length = 0;
  INSERTED.length = 0;
  UPDATES.length = 0;
  nextId = 1;
  arbiterMode = "deliver";
  for (const k of Object.keys(FIND_FIRST)) delete FIND_FIRST[k];
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

  it("the registry itself is pinned: two mirror types, correct bundle keys, recognized by the guard", () => {
    expect(Object.keys(MIRRORED_QUEUE_ITEM_TYPES).sort()).toEqual(["appeal_review", "recourse_draft"]);
    expect(MIRRORED_QUEUE_ITEM_TYPES.appeal_review.bundleKey).toBe("sourceAppealId");
    expect(MIRRORED_QUEUE_ITEM_TYPES.recourse_draft.bundleKey).toBe("sourceRecourseDraftId");
    expect(isMirroredQueueItemType("appeal_review")).toBe(true);
    expect(isMirroredQueueItemType("recourse_draft")).toBe(true);
    expect(isMirroredQueueItemType("support_escalation")).toBe(false);
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
});
