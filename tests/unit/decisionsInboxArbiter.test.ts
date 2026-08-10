/**
 * Decisions-inbox interrupt-arbiter wrapper — Jarvis 2.2 (audit finding G3).
 *
 * Pins the EXPLICIT per-call-site class mapping and what each arbiter
 * outcome means for an inbox row (the row is ALWAYS written — never dropped;
 * only its landing status changes):
 *
 *   createFromEscalation     billing (riskLevel high)  → B ; medium → C
 *   createFromAlert          riskLevel critical        → B
 *   createFromChurnRisk      riskLevel critical        → B
 *   createFromFeatureRequest priorityScore ≥80 (high)  → B ; medium → C
 *   createFromAppeal         customer waiting on verdict → B   (F2 mirror)
 *   createFromRecourseDraft  same-hour-reply doctrine    → B   (F2 mirror)
 *
 *   deliver  → status "pending"   (today's behavior)
 *   defer_*  → status "deferred"  + deferredUntil
 *   suppress → status "suppressed" (audit/defect record, never surfaced)
 *
 * Plus the fail-CLOSED-quiet policy when the arbiter itself throws.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ─── Arbiter mock (controllable) ────────────────────────────────────────────

const ARBITER_CALLS: Array<{ source: string; interruptClass: string; channel: string }> = [];
let arbiterMode: "deliver" | "defer" | "suppress" | "throw" = "deliver";
const DEFER_UNTIL = new Date("2026-07-21T12:00:00Z");

vi.mock("../../server/services/founderInterruptArbiter", () => ({
  arbitrateFounderInterrupt: vi.fn(async (req: any) => {
    ARBITER_CALLS.push({
      source: req.source,
      interruptClass: req.interruptClass,
      channel: req.channel,
    });
    if (arbiterMode === "throw") throw new Error("arbiter exploded");
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
    if (arbiterMode === "suppress") {
      return {
        outcome: "suppress",
        interruptClass: req.interruptClass,
        reason: "class C never interrupts",
        quietHoursActive: null,
        budget: null,
        deferUntil: null,
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

// ─── Collaborator mocks ─────────────────────────────────────────────────────

vi.mock("../../server/services/agentActionExecutors", () => ({
  executeAction: vi.fn(),
  hasExecutor: vi.fn(() => false),
}));

let autoResolved = false;
vi.mock("../../server/services/customerSupportAutoResolver", () => ({
  customerSupportAutoResolver: {
    attemptResolution: vi.fn(async () => ({
      autoResolved,
      geniusResponse: null,
      geniusConfidence: 0,
    })),
  },
}));

vi.mock("../../server/utils/openaiClient", () => ({
  requireOpenAIClient: vi.fn(() => ({
    chat: {
      completions: {
        create: vi.fn(async () => ({
          choices: [
            {
              message: {
                tool_calls: [
                  {
                    type: "function",
                    function: {
                      name: "evaluate_feature_request",
                      arguments: JSON.stringify({
                        estimatedRevImpactCents: 100000,
                        priorityScore: featurePriorityScore,
                        analysisReason: "test reason",
                        shouldSurface: true,
                      }),
                    },
                  },
                ],
              },
            },
          ],
        })),
      },
    },
  })),
}));

let featurePriorityScore = 90;

// ─── DB mock ────────────────────────────────────────────────────────────────

const INSERTED: Array<Record<string, any>> = [];
let nextId = 1;

// findFirst results keyed by query table
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
      set: (_v: any) => ({
        where: (_w: any) => Promise.resolve(),
      }),
    }),
  };
  return { db };
});

import { decisionsInboxService } from "../../server/services/decisionsInbox";

beforeEach(() => {
  ARBITER_CALLS.length = 0;
  INSERTED.length = 0;
  nextId = 1;
  arbiterMode = "deliver";
  autoResolved = false;
  featurePriorityScore = 90;
  for (const k of Object.keys(FIND_FIRST)) delete FIND_FIRST[k];
  FIND_FIRST.supportTickets = {
    id: 11,
    subject: "Refund question",
    category: "billing",
    organizationId: 7,
  };
  FIND_FIRST.systemAlerts = { id: 21, severity: "critical", title: "DB down", message: "no conn" };
  FIND_FIRST.organizations = { id: 7, name: "Acme Land" };
  FIND_FIRST.featureRequests = {
    id: 31,
    title: "Bulk export",
    description: "csv",
    category: "data",
    organizationId: 7,
  };
  // F2 mirror inflows (appeals + recourse drafts).
  FIND_FIRST.paxDecisionAppeals = {
    id: 41,
    organizationId: 7,
    refusalPayloadId: 9,
    status: "open",
  };
  FIND_FIRST.paxRefusalPayloads = { id: 9, citedImmutableId: "IMM-3", severity: "warn" };
  FIND_FIRST.recourseDrafts = { id: 61, organizationId: 7, signalType: "detractor_nps", status: "draft" };
});

describe("explicit class mapping per call site", () => {
  it("createFromEscalation: billing (riskLevel high) → Class B on the decisions_inbox source", async () => {
    await decisionsInboxService.createFromEscalation(11, { category: "billing" });

    expect(ARBITER_CALLS).toEqual([
      { source: "decisions_inbox", interruptClass: "B", channel: "inbox_pending_item" },
    ]);
    expect(INSERTED[0]).toMatchObject({ itemType: "support_escalation", status: "pending" });
  });

  it("createFromEscalation: non-billing (riskLevel medium) → Class C", async () => {
    FIND_FIRST.supportTickets = { ...FIND_FIRST.supportTickets, category: "general" };
    arbiterMode = "suppress";

    await decisionsInboxService.createFromEscalation(11, { category: "general" });

    expect(ARBITER_CALLS[0].interruptClass).toBe("C");
    // The row is written as an audit/defect record, never a pending interrupt.
    expect(INSERTED[0]).toMatchObject({ status: "suppressed", deferredUntil: null });
  });

  it("createFromAlert: riskLevel critical → Class B", async () => {
    await decisionsInboxService.createFromAlert(21);

    expect(ARBITER_CALLS[0].interruptClass).toBe("B");
    expect(INSERTED[0]).toMatchObject({ itemType: "critical_alert", status: "pending" });
  });

  it("createFromChurnRisk: riskLevel critical → Class B", async () => {
    await decisionsInboxService.createFromChurnRisk(7, 95);

    expect(ARBITER_CALLS[0].interruptClass).toBe("B");
    expect(INSERTED[0]).toMatchObject({ itemType: "churn_risk_intervention", status: "pending" });
  });

  it("createFromAppeal (F2 mirror): a customer waiting on a verdict → Class B", async () => {
    await decisionsInboxService.createFromAppeal(41);

    expect(ARBITER_CALLS).toEqual([
      { source: "decisions_inbox", interruptClass: "B", channel: "inbox_pending_item" },
    ]);
    expect(INSERTED[0]).toMatchObject({ itemType: "appeal_review", status: "pending" });
  });

  it("createFromRecourseDraft (F2 mirror): the same-hour-reply doctrine → Class B", async () => {
    await decisionsInboxService.createFromRecourseDraft(61);

    expect(ARBITER_CALLS[0].interruptClass).toBe("B");
    expect(INSERTED[0]).toMatchObject({ itemType: "recourse_draft", status: "pending" });
  });

  it("createFromFeatureRequest: priorityScore ≥ 80 → Class B; below → Class C", async () => {
    featurePriorityScore = 90;
    await decisionsInboxService.createFromFeatureRequest(31);
    expect(ARBITER_CALLS[0].interruptClass).toBe("B");

    ARBITER_CALLS.length = 0;
    featurePriorityScore = 50;
    arbiterMode = "suppress";
    await decisionsInboxService.createFromFeatureRequest(31);
    expect(ARBITER_CALLS[0].interruptClass).toBe("C");
    expect(INSERTED[1]).toMatchObject({ riskLevel: "medium", status: "suppressed" });
  });
});

describe("arbiter outcomes land in the right status — the row is never dropped", () => {
  it("deliver → pending (today's behavior)", async () => {
    await decisionsInboxService.createFromAlert(21);
    expect(INSERTED[0].status).toBe("pending");
    expect(INSERTED[0].deferredUntil).toBeNull();
  });

  it("defer → deferred with the arbiter's deferUntil (processDeferredItems re-opens it)", async () => {
    arbiterMode = "defer";
    const id = await decisionsInboxService.createFromAlert(21);

    expect(id).not.toBeNull();
    expect(INSERTED[0].status).toBe("deferred");
    expect(INSERTED[0].deferredUntil).toEqual(DEFER_UNTIL);
  });

  it("fail CLOSED-quiet: arbiter throw defers a Class B row", async () => {
    arbiterMode = "throw";
    await decisionsInboxService.createFromAlert(21);

    expect(INSERTED[0].status).toBe("deferred");
    expect(INSERTED[0].deferredUntil).toBeInstanceOf(Date);
  });

  it("fail CLOSED-quiet: arbiter throw suppresses a Class C row", async () => {
    arbiterMode = "throw";
    FIND_FIRST.supportTickets = { ...FIND_FIRST.supportTickets, category: "general" };

    await decisionsInboxService.createFromEscalation(11, { category: "general" });

    expect(INSERTED[0].status).toBe("suppressed");
  });
});

describe("existing behavior preserved", () => {
  it("auto-resolved escalations never reach the arbiter or the inbox", async () => {
    autoResolved = true;
    const res = await decisionsInboxService.createFromEscalation(11, { category: "billing" });

    expect(res.autoResolved).toBe(true);
    expect(ARBITER_CALLS).toHaveLength(0);
    expect(INSERTED).toHaveLength(0);
  });

  it("non-critical alerts are still ignored before any arbitration", async () => {
    FIND_FIRST.systemAlerts = { id: 22, severity: "warning", title: "meh", message: "" };
    const id = await decisionsInboxService.createFromAlert(22);

    expect(id).toBeNull();
    expect(ARBITER_CALLS).toHaveLength(0);
  });

  it("churn scores under 90 are still auto-handled without arbitration", async () => {
    const id = await decisionsInboxService.createFromChurnRisk(7, 80);

    expect(id).toBeNull();
    expect(ARBITER_CALLS).toHaveLength(0);
  });
});
