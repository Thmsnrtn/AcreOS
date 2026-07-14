/**
 * Horizon A1 — the outcome ledger.
 *
 * Pins the constitutional honesty contract end to end:
 *
 *   1. Predictions at creation — every decisionsInbox creator writes
 *      expectedOutcome + checkInDate with honest per-itemType defaults
 *      (machine-checkable where a real criterion exists, a neutral
 *      "founder will assess" where it doesn't); an explicit caller
 *      prediction overrides the default; unknown itemTypes carry NONE.
 *   2. The 30/90-day scorer — machine checks evaluate against real data
 *      (pass → +2, fail → -1, never -2 from a machine alone) and write an
 *      actualOutcome that states exactly what was checked and found;
 *      judgment calls raise exactly ONE open founder check-in card with
 *      the fixed 5-point scale; unevaluable criteria stay UNSCORED.
 *   3. Founder answers write back to the ORIGINAL row; "too soon to tell"
 *      pushes the check-in forward 30 days without scoring.
 *
 * Mock pattern follows tests/unit/decisionsInboxArbiter.test.ts: reads
 * return whole in-memory stores and the services re-apply their filters in
 * process, so the assertions pin the arithmetic independent of SQL.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ─── Arbiter mock (always delivers; calls recorded) ─────────────────────────

const ARBITER_CALLS: Array<{ interruptClass: string; subject: string }> = [];

vi.mock("../../server/services/founderInterruptArbiter", () => ({
  arbitrateFounderInterrupt: vi.fn(async (req: any) => {
    ARBITER_CALLS.push({ interruptClass: req.interruptClass, subject: req.subject });
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

// ─── Collaborator mocks (decisionsInbox module dependencies) ────────────────

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
                        priorityScore: 90,
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

const EXPERIMENT_CALLS: Array<{ orgId: number; itemType: string; score: number }> = [];
vi.mock("../../server/services/decisionExperiments", () => ({
  recordExperimentOutcome: vi.fn(async (orgId: number, itemType: string, score: number) => {
    EXPERIMENT_CALLS.push({ orgId, itemType, score });
  }),
}));

// ─── DB mock — in-memory stores; WHERE re-applied in process by services ────

const ITEMS: any[] = []; // decisions_inbox_items
const ORGS: any[] = []; // organizations
const INSERTED: any[] = [];
const UPDATES: Array<{ table: string | null; set: any; whereValue: unknown }> = [];
const FIND_FIRST: Record<string, any> = {};
let nextId = 1000;

vi.mock("../../server/db", () => {
  const tableName = (tableLike: any): string | null => {
    if (!tableLike) return null;
    const sym = Object.getOwnPropertySymbols(tableLike).find((s) =>
      String(s).includes("Name"),
    );
    if (sym && typeof tableLike[sym] === "string") return tableLike[sym];
    return null;
  };

  // eq(col, value) → SQL whose queryChunks include a Param { value, encoder }.
  const eqValue = (w: any): unknown => {
    const chunks: any[] = w?.queryChunks ?? [];
    for (const c of chunks) {
      if (c && typeof c === "object" && "encoder" in c && "value" in c) return c.value;
    }
    return undefined;
  };

  const db = {
    query: {
      decisionsInboxItems: { findFirst: vi.fn(async () => FIND_FIRST.decisionsInboxItems ?? null) },
      supportTickets: { findFirst: vi.fn(async () => FIND_FIRST.supportTickets ?? null) },
      systemAlerts: { findFirst: vi.fn(async () => FIND_FIRST.systemAlerts ?? null) },
      featureRequests: { findFirst: vi.fn(async () => FIND_FIRST.featureRequests ?? null) },
      organizations: { findFirst: vi.fn(async () => FIND_FIRST.organizations ?? null) },
    },
    select: (_proj?: any) => ({
      _table: null as string | null,
      from(t: any) {
        this._table = tableName(t);
        return this;
      },
      where(_w: any) {
        return this;
      },
      orderBy(..._o: any[]) {
        return this;
      },
      limit(_n: number) {
        return this;
      },
      then(onFulfilled: (rows: any[]) => any, onRejected?: (e: any) => any) {
        const rows =
          this._table === "decisions_inbox_items"
            ? [...ITEMS]
            : this._table === "organizations"
              ? [...ORGS]
              : [];
        return Promise.resolve(rows).then(onFulfilled, onRejected);
      },
    }),
    insert: (_t: any) => ({
      values: (row: Record<string, any>) => ({
        returning: () => {
          const withId = { id: nextId++, ...row };
          INSERTED.push(withId);
          return Promise.resolve([withId]);
        },
      }),
    }),
    update: (t: any) => ({
      set: (v: any) => ({
        where: (w: any) => {
          UPDATES.push({ table: tableName(t), set: v, whereValue: eqValue(w) });
          return Promise.resolve();
        },
      }),
    }),
  };
  return { db };
});

import {
  attachPrediction,
  applyCheckInAnswer,
  getOutcomeLedgerCounts,
  scoreDueCheckIns,
  OUTCOME_CHECK_IN_OPTIONS,
} from "../../server/services/outcomeLedger";
import { decisionsInboxService } from "../../server/services/decisionsInbox";

const NOW = new Date("2026-07-14T12:00:00Z");
const DAY_MS = 24 * 60 * 60 * 1000;

function daysAgo(n: number): Date {
  return new Date(NOW.getTime() - n * DAY_MS);
}

beforeEach(() => {
  ITEMS.length = 0;
  ORGS.length = 0;
  INSERTED.length = 0;
  UPDATES.length = 0;
  ARBITER_CALLS.length = 0;
  EXPERIMENT_CALLS.length = 0;
  nextId = 1000;
  for (const k of Object.keys(FIND_FIRST)) delete FIND_FIRST[k];
});

// ─── 1. Predictions ─────────────────────────────────────────────────────────

describe("attachPrediction — honest per-itemType defaults", () => {
  it("support_escalation → 30d no_recurrence machine check scoped to the org", () => {
    const pred = attachPrediction({
      itemType: "support_escalation",
      organizationId: 7,
      now: NOW,
    })!;
    expect(pred.checkInDate).toEqual(new Date(NOW.getTime() + 30 * DAY_MS));
    expect(pred.outcomePrediction).toEqual({
      checkInDays: 30,
      machineCheck: { kind: "no_recurrence", itemType: "support_escalation", organizationId: 7 },
    });
    // The text claims only what the check verifies.
    expect(pred.expectedOutcome).toContain("No new support_escalation item");
    expect(pred.expectedOutcome).toContain("no_recurrence");
  });

  it("churn_risk_intervention → 90d churn_retained machine check", () => {
    const pred = attachPrediction({
      itemType: "churn_risk_intervention",
      organizationId: 7,
      now: NOW,
    })!;
    expect(pred.checkInDate).toEqual(new Date(NOW.getTime() + 90 * DAY_MS));
    expect(pred.outcomePrediction.machineCheck).toEqual({
      kind: "churn_retained",
      organizationId: 7,
    });
  });

  it("churn_risk_intervention without an org honestly downgrades to a judgment call — never a criterion that can't run", () => {
    const pred = attachPrediction({
      itemType: "churn_risk_intervention",
      organizationId: null,
      now: NOW,
    })!;
    expect(pred.outcomePrediction.machineCheck).toBeUndefined();
    expect(pred.expectedOutcome).toBe("Judgment call — founder will assess at check-in.");
    expect(pred.checkInDate).toEqual(new Date(NOW.getTime() + 90 * DAY_MS));
  });

  it("dunning_recovery → 30d dunning_recovered machine check", () => {
    const pred = attachPrediction({
      itemType: "dunning_recovery",
      organizationId: 3,
      now: NOW,
    })!;
    expect(pred.checkInDate).toEqual(new Date(NOW.getTime() + 30 * DAY_MS));
    expect(pred.outcomePrediction.machineCheck).toEqual({
      kind: "dunning_recovered",
      organizationId: 3,
    });
  });

  it("critical_alert and feature_request_flagged → 30d judgment calls with NO machine check and no invented specifics", () => {
    for (const itemType of ["critical_alert", "feature_request_flagged"]) {
      const pred = attachPrediction({ itemType, organizationId: null, now: NOW })!;
      expect(pred.checkInDate).toEqual(new Date(NOW.getTime() + 30 * DAY_MS));
      expect(pred.outcomePrediction.machineCheck).toBeUndefined();
      expect(pred.expectedOutcome).toBe("Judgment call — founder will assess at check-in.");
    }
  });

  it("an itemType with no default and no explicit prediction carries NONE — never fabricated", () => {
    expect(attachPrediction({ itemType: "deferred_interrupt", now: NOW })).toBeNull();
  });

  it("an explicit caller prediction overrides the default verbatim", () => {
    const pred = attachPrediction({
      itemType: "critical_alert",
      prediction: {
        expectedOutcome: "No repeat of this incident class within 90 days.",
        checkInDays: 90,
        machineCheck: { kind: "no_recurrence", itemType: "critical_alert", organizationId: null },
      },
      now: NOW,
    })!;
    expect(pred.expectedOutcome).toBe("No repeat of this incident class within 90 days.");
    expect(pred.checkInDate).toEqual(new Date(NOW.getTime() + 90 * DAY_MS));
    expect(pred.outcomePrediction.machineCheck).toEqual({
      kind: "no_recurrence",
      itemType: "critical_alert",
      organizationId: null,
    });
  });
});

describe("creators populate expectedOutcome + checkInDate", () => {
  beforeEach(() => {
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
  });

  function expectCheckInDaysFromNow(checkInDate: Date, days: number) {
    // Creators stamp the prediction at insert time (real clock) — allow 60s.
    expect(Math.abs(checkInDate.getTime() - (Date.now() + days * DAY_MS))).toBeLessThan(60_000);
  }

  it("createFromEscalation → 30d no_recurrence machine check", async () => {
    await decisionsInboxService.createFromEscalation(11, { category: "billing" });
    const row = INSERTED[0];
    expect(row.expectedOutcome).toContain("no_recurrence");
    expectCheckInDaysFromNow(row.checkInDate, 30);
    expect(row.contextBundle.outcomePrediction.machineCheck).toEqual({
      kind: "no_recurrence",
      itemType: "support_escalation",
      organizationId: 7,
    });
  });

  it("createFromAlert → 30d judgment call (founder scores at check-in)", async () => {
    await decisionsInboxService.createFromAlert(21);
    const row = INSERTED[0];
    expect(row.expectedOutcome).toBe("Judgment call — founder will assess at check-in.");
    expectCheckInDaysFromNow(row.checkInDate, 30);
    expect(row.contextBundle.outcomePrediction).toEqual({ checkInDays: 30 });
  });

  it("createFromChurnRisk → 90d churn_retained machine check", async () => {
    await decisionsInboxService.createFromChurnRisk(7, 95);
    const row = INSERTED[0];
    expectCheckInDaysFromNow(row.checkInDate, 90);
    expect(row.contextBundle.outcomePrediction.machineCheck).toEqual({
      kind: "churn_retained",
      organizationId: 7,
    });
  });

  it("createFromFeatureRequest → 30d judgment call", async () => {
    await decisionsInboxService.createFromFeatureRequest(31);
    const row = INSERTED[0];
    expect(row.expectedOutcome).toBe("Judgment call — founder will assess at check-in.");
    expectCheckInDaysFromNow(row.checkInDate, 30);
    expect(row.contextBundle.outcomePrediction.machineCheck).toBeUndefined();
  });

  it("an explicit prediction passed by the caller overrides the default", async () => {
    await decisionsInboxService.createFromAlert(21, {
      prediction: {
        expectedOutcome: "No repeat incident within 90 days.",
        checkInDays: 90,
      },
    });
    const row = INSERTED[0];
    expect(row.expectedOutcome).toBe("No repeat incident within 90 days.");
    expectCheckInDaysFromNow(row.checkInDate, 90);
  });
});

// ─── 2. Machine-check scoring ───────────────────────────────────────────────

function dueItem(overrides: Record<string, any> = {}) {
  return {
    id: 1,
    itemType: "support_escalation",
    status: "approved",
    organizationId: 7,
    createdAt: daysAgo(35),
    resolvedAt: daysAgo(31),
    checkInDate: daysAgo(1),
    outcomeScore: null,
    outcomeRecordedAt: null,
    ownerAgentCodename: "sophie_csm",
    recommendedActionLabel: "Resolve Ticket",
    expectedOutcome: "No new support_escalation item for this organization in the 30 days after resolution (machine-checked: no_recurrence).",
    contextBundle: {
      outcomePrediction: {
        checkInDays: 30,
        machineCheck: { kind: "no_recurrence", itemType: "support_escalation", organizationId: 7 },
      },
    },
    ...overrides,
  };
}

describe("scoreDueCheckIns — machine checks against real data", () => {
  it("no_recurrence pass → +2 with an actualOutcome stating exactly what was checked", async () => {
    ITEMS.push(dueItem());

    const r = await scoreDueCheckIns(NOW);

    expect(r).toMatchObject({ due: 1, machineScored: 1, machinePassed: 1, machineFailed: 0 });
    expect(UPDATES).toHaveLength(1);
    expect(UPDATES[0].whereValue).toBe(1);
    expect(UPDATES[0].set.outcomeScore).toBe(2);
    expect(UPDATES[0].set.outcomeRecordedAt).toEqual(NOW);
    expect(UPDATES[0].set.actualOutcome).toBe(
      "Machine check no_recurrence: 0 new support_escalation items for organization #7 between resolution and check-in — the intervention held.",
    );
  });

  it("no_recurrence fail → -1 (never -2 from a machine check alone), causality named uncertain", async () => {
    ITEMS.push(
      dueItem(),
      // A newer same-org, same-type arrival — evidence the fix didn't hold.
      { id: 2, itemType: "support_escalation", organizationId: 7, status: "pending", createdAt: daysAgo(5), checkInDate: null, outcomeScore: null },
    );

    const r = await scoreDueCheckIns(NOW);

    expect(r).toMatchObject({ machineScored: 1, machinePassed: 0, machineFailed: 1 });
    expect(UPDATES[0].set.outcomeScore).toBe(-1);
    expect(UPDATES[0].set.actualOutcome).toContain("1 new support_escalation item");
    expect(UPDATES[0].set.actualOutcome).toContain("did not hold (causality uncertain)");
  });

  it("no_recurrence ignores other orgs, other itemTypes, and rows created before resolution", async () => {
    ITEMS.push(
      dueItem(),
      { id: 3, itemType: "support_escalation", organizationId: 8, status: "pending", createdAt: daysAgo(5), checkInDate: null, outcomeScore: null },
      { id: 4, itemType: "critical_alert", organizationId: 7, status: "pending", createdAt: daysAgo(5), checkInDate: null, outcomeScore: null },
      { id: 5, itemType: "support_escalation", organizationId: 7, status: "rejected", createdAt: daysAgo(40), resolvedAt: daysAgo(39), checkInDate: null, outcomeScore: -1, outcomeRecordedAt: daysAgo(30) },
    );

    const r = await scoreDueCheckIns(NOW);
    expect(r.machinePassed).toBe(1);
    expect(UPDATES[0].set.outcomeScore).toBe(2);
  });

  it("churn_retained pass → +2 stating status and tier found", async () => {
    ITEMS.push(
      dueItem({
        id: 6,
        itemType: "churn_risk_intervention",
        checkInDate: daysAgo(2),
        contextBundle: {
          outcomePrediction: { checkInDays: 90, machineCheck: { kind: "churn_retained", organizationId: 7 } },
        },
      }),
    );
    ORGS.push({ id: 7, subscriptionStatus: "active", subscriptionTier: "pro", dunningStage: "none" });

    await scoreDueCheckIns(NOW);

    expect(UPDATES[0].set.outcomeScore).toBe(2);
    expect(UPDATES[0].set.actualOutcome).toBe(
      'Machine check churn_retained: subscription status "active", tier "pro" at check-in — customer retained.',
    );
  });

  it("churn_retained fail (downgraded to free) → -1 with the found state named", async () => {
    ITEMS.push(
      dueItem({
        id: 6,
        itemType: "churn_risk_intervention",
        contextBundle: {
          outcomePrediction: { checkInDays: 90, machineCheck: { kind: "churn_retained", organizationId: 7 } },
        },
      }),
    );
    ORGS.push({ id: 7, subscriptionStatus: "active", subscriptionTier: "free", dunningStage: "none" });

    await scoreDueCheckIns(NOW);

    expect(UPDATES[0].set.outcomeScore).toBe(-1);
    expect(UPDATES[0].set.actualOutcome).toContain('tier "free"');
    expect(UPDATES[0].set.actualOutcome).toContain("not retained (causality uncertain)");
  });

  it("dunning_recovered pass/fail by the org's recorded dunning stage", async () => {
    ITEMS.push(
      dueItem({
        id: 8,
        itemType: "dunning_recovery",
        contextBundle: {
          outcomePrediction: { checkInDays: 30, machineCheck: { kind: "dunning_recovered", organizationId: 7 } },
        },
      }),
    );
    ORGS.push({ id: 7, subscriptionStatus: "active", subscriptionTier: "pro", dunningStage: "restricted" });

    await scoreDueCheckIns(NOW);
    expect(UPDATES[0].set.outcomeScore).toBe(-1);
    expect(UPDATES[0].set.actualOutcome).toContain('dunning stage "restricted"');

    UPDATES.length = 0;
    ITEMS[0].outcomeScore = null;
    ORGS[0].dunningStage = "none";

    await scoreDueCheckIns(NOW);
    expect(UPDATES[0].set.outcomeScore).toBe(2);
    expect(UPDATES[0].set.actualOutcome).toContain('dunning stage "none"');
    expect(UPDATES[0].set.actualOutcome).toContain("recovered");
  });

  it("HONESTY: an unknown machineCheck kind leaves the row unscored — never a guessed score", async () => {
    ITEMS.push(
      dueItem({
        contextBundle: { outcomePrediction: { checkInDays: 30, machineCheck: { kind: "mystery_check" } } },
      }),
    );

    const r = await scoreDueCheckIns(NOW);

    expect(r.skipped).toBe(1);
    expect(r.machineScored).toBe(0);
    expect(UPDATES).toHaveLength(0);
  });

  it("only due rows are touched: unresolved, future-dated, already-scored, and check-in cards are all skipped", async () => {
    ITEMS.push(
      dueItem({ id: 10, status: "pending" }), // not resolved
      dueItem({ id: 11, checkInDate: new Date(NOW.getTime() + DAY_MS) }), // not due yet
      dueItem({ id: 12, outcomeScore: 2, outcomeRecordedAt: daysAgo(1) }), // already scored
      dueItem({ id: 13, itemType: "outcome_check_in", contextBundle: { outcomeCheckInFor: 1 } }), // the ledger's own instrument
    );

    const r = await scoreDueCheckIns(NOW);

    expect(r.due).toBe(0);
    expect(UPDATES).toHaveLength(0);
    expect(INSERTED).toHaveLength(0);
  });

  it("scored outcomes mirror into the decision-experiments rollup (best-effort parity with the legacy grader)", async () => {
    ITEMS.push(dueItem());
    await scoreDueCheckIns(NOW);
    expect(EXPERIMENT_CALLS).toEqual([{ orgId: 7, itemType: "support_escalation", score: 2 }]);
  });
});

// ─── Judgment calls → founder check-in cards ────────────────────────────────

function judgmentDueItem(overrides: Record<string, any> = {}) {
  return dueItem({
    id: 20,
    itemType: "critical_alert",
    organizationId: null,
    expectedOutcome: "Judgment call — founder will assess at check-in.",
    contextBundle: { outcomePrediction: { checkInDays: 30 } },
    ...overrides,
  });
}

describe("scoreDueCheckIns — judgment calls raise ONE founder check-in card", () => {
  it("creates exactly one outcome_check_in card with the fixed 5-point scale, Class B", async () => {
    ITEMS.push(judgmentDueItem());

    const r = await scoreDueCheckIns(NOW);

    expect(r).toMatchObject({ due: 1, checkInsCreated: 1, checkInsDeduped: 0 });
    expect(UPDATES).toHaveLength(0); // no score written — the founder decides
    expect(INSERTED).toHaveLength(1);
    const card = INSERTED[0];
    expect(card).toMatchObject({
      itemType: "outcome_check_in",
      riskLevel: "low",
      status: "pending",
      actionPayload: null,
    });
    expect(card.contextBundle.outcomeCheckInFor).toBe(20);
    expect(card.contextBundle.options).toEqual([
      { key: "right_call", label: "Right call" },
      { key: "mostly_right", label: "Mostly right" },
      { key: "too_soon", label: "Too soon to tell" },
      { key: "didnt_help", label: "Didn't help" },
      { key: "wrong_call", label: "Wrong call" },
    ]);
    expect(ARBITER_CALLS).toEqual([
      { interruptClass: "B", subject: "Outcome check-in: decision #20" },
    ]);
  });

  it("dedupe: an OPEN check-in for the same original blocks a second card", async () => {
    ITEMS.push(judgmentDueItem());
    FIND_FIRST.decisionsInboxItems = {
      id: 99,
      itemType: "outcome_check_in",
      status: "pending",
      contextBundle: { outcomeCheckInFor: 20 },
    };

    const r = await scoreDueCheckIns(NOW);

    expect(r).toMatchObject({ checkInsCreated: 0, checkInsDeduped: 1 });
    expect(INSERTED).toHaveLength(0);
  });

  it("a RESOLVED check-in does not block — 'too soon' legitimately produces a later card", async () => {
    ITEMS.push(judgmentDueItem());
    FIND_FIRST.decisionsInboxItems = {
      id: 99,
      itemType: "outcome_check_in",
      status: "approved",
      contextBundle: { outcomeCheckInFor: 20 },
    };

    const r = await scoreDueCheckIns(NOW);

    expect(r).toMatchObject({ checkInsCreated: 1, checkInsDeduped: 0 });
    expect(INSERTED).toHaveLength(1);
  });
});

// ─── 3. Founder answers write back to the ORIGINAL row ─────────────────────

describe("applyCheckInAnswer", () => {
  const checkInItem = { id: 50, contextBundle: { outcomeCheckInFor: 5 } };

  function originalRow(overrides: Record<string, any> = {}) {
    return {
      id: 5,
      itemType: "critical_alert",
      status: "approved",
      organizationId: null,
      outcomeScore: null,
      outcomeRecordedAt: null,
      checkInDate: daysAgo(2),
      ...overrides,
    };
  }

  it("writes the founder's score to the original row (right call → +2)", async () => {
    ITEMS.push(originalRow());

    const r = await applyCheckInAnswer({ checkInItem, optionKey: "right_call", now: NOW });

    expect(r).toEqual({ applied: "scored", originalItemId: 5, score: 2 });
    expect(UPDATES).toHaveLength(1);
    expect(UPDATES[0].whereValue).toBe(5);
    expect(UPDATES[0].set.outcomeScore).toBe(2);
    expect(UPDATES[0].set.outcomeRecordedAt).toEqual(NOW);
    expect(UPDATES[0].set.actualOutcome).toBe(
      'Founder scored this decision at check-in: "Right call" (+2).',
    );
  });

  it("wrong call → -2 (the founder MAY award -2; only machines may not)", async () => {
    ITEMS.push(originalRow());

    const r = await applyCheckInAnswer({ checkInItem, optionKey: "wrong_call", now: NOW });

    expect(r.score).toBe(-2);
    expect(UPDATES[0].set.outcomeScore).toBe(-2);
    expect(UPDATES[0].set.actualOutcome).toContain('"Wrong call" (-2)');
  });

  it("'too soon to tell' pushes checkInDate 30 days from NOW and writes NO score", async () => {
    ITEMS.push(originalRow());

    const r = await applyCheckInAnswer({ checkInItem, optionKey: "too_soon", now: NOW });

    expect(r).toEqual({ applied: "deferred", originalItemId: 5, score: null });
    expect(UPDATES).toHaveLength(1);
    expect(UPDATES[0].set.checkInDate).toEqual(new Date(NOW.getTime() + 30 * DAY_MS));
    expect("outcomeScore" in UPDATES[0].set).toBe(false);
    expect("outcomeRecordedAt" in UPDATES[0].set).toBe(false);
  });

  it("first answer wins: an already-scored original is never overwritten", async () => {
    ITEMS.push(originalRow({ outcomeScore: 1, outcomeRecordedAt: daysAgo(1) }));

    const r = await applyCheckInAnswer({ checkInItem, optionKey: "wrong_call", now: NOW });

    expect(r).toEqual({ applied: "skipped", originalItemId: 5, score: 1 });
    expect(UPDATES).toHaveLength(0);
  });

  it("a missing original is reported skipped — nothing is scored, nothing invented", async () => {
    const r = await applyCheckInAnswer({ checkInItem, optionKey: "right_call", now: NOW });
    expect(r).toEqual({ applied: "skipped", originalItemId: 5, score: null });
    expect(UPDATES).toHaveLength(0);
  });

  it("throws on an unknown option key or a card without outcomeCheckInFor", async () => {
    ITEMS.push(originalRow());
    await expect(
      applyCheckInAnswer({ checkInItem, optionKey: "sounds_great", now: NOW }),
    ).rejects.toThrow("unknown check-in option key");
    await expect(
      applyCheckInAnswer({ checkInItem: { id: 51, contextBundle: {} }, optionKey: "right_call", now: NOW }),
    ).rejects.toThrow("carries no outcomeCheckInFor");
  });

  it("the 5-point scale maps every key to its constitutional score", () => {
    expect(OUTCOME_CHECK_IN_OPTIONS.map((o) => [o.key, o.score])).toEqual([
      ["right_call", 2],
      ["mostly_right", 1],
      ["too_soon", 0],
      ["didnt_help", -1],
      ["wrong_call", -2],
    ]);
  });
});

// ─── Ledger counts (metric (d) source) ──────────────────────────────────────

describe("getOutcomeLedgerCounts — honest zeros, trailing 90 days", () => {
  it("empty table → all zeros, never backfilled", async () => {
    expect(await getOutcomeLedgerCounts(NOW)).toEqual({
      scored: 0,
      positive: 0,
      pending: 0,
      overdue: 0,
    });
  });

  it("counts scored/positive/pending/overdue over prediction-bearing rows only", async () => {
    ITEMS.push(
      // scored positive
      { id: 1, createdAt: daysAgo(31), checkInDate: daysAgo(1), outcomeScore: 2, outcomeRecordedAt: daysAgo(1) },
      // scored negative
      { id: 2, createdAt: daysAgo(40), checkInDate: daysAgo(10), outcomeScore: -1, outcomeRecordedAt: daysAgo(9) },
      // pending — check-in still ahead
      { id: 3, createdAt: daysAgo(5), checkInDate: new Date(NOW.getTime() + 25 * DAY_MS), outcomeScore: null, outcomeRecordedAt: null },
      // overdue — due date passed, honestly unscored
      { id: 4, createdAt: daysAgo(35), checkInDate: daysAgo(5), outcomeScore: null, outcomeRecordedAt: null },
      // outside the trailing-90d prediction window
      { id: 5, createdAt: daysAgo(100), checkInDate: daysAgo(70), outcomeScore: 2, outcomeRecordedAt: daysAgo(69) },
      // no prediction at all — invisible to the ledger
      { id: 6, createdAt: daysAgo(3), checkInDate: null, outcomeScore: 1, outcomeRecordedAt: daysAgo(1) },
    );

    expect(await getOutcomeLedgerCounts(NOW)).toEqual({
      scored: 2,
      positive: 1,
      pending: 1,
      overdue: 1,
    });
  });
});
