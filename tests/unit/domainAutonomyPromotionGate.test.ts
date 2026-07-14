/**
 * Horizon A2 — the FOUNDER GATE on autonomy promotions.
 *
 * Constitutional pin: Sovereign Principle 10 — "No agent may unilaterally
 * expand its own authority"; promotions/demotions are Class B decisions.
 *
 *   1. recordCleanCycle at threshold (holds passing) creates ONE open
 *      'shadow_promotion_request' card and does NOT write the level; the
 *      counter holds at threshold.
 *   2. grant tap → setDomainLevel with the founder-approved reason (shadow
 *      agreement N/M); hold tap → counter halved, level untouched; stale
 *      cards never loosen.
 *   3. dedupe: never a second open card for the same domain+targetLevel.
 *   4. hard-stop classes are refused structurally — no shadow record makes
 *      pricing_changes / legal_signing / spend_over_500_usd /
 *      customer_data_deletion promotable (hardStops.ts provenance).
 *   5. regressions: recordAnomaly demotion stays AUTOMATIC and unchanged;
 *      manual setDomainLevel (the Control Center Grant button, Principle 9)
 *      unchanged; below threshold nothing fires.
 *
 * Mock pattern follows tests/unit/outcomeLedger.test.ts: in-memory stores,
 * services re-apply their filters in process.
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

// ─── decisionsInbox collaborator mocks ───────────────────────────────────────

vi.mock("../../server/services/agentActionExecutors", () => ({
  executeAction: vi.fn(),
  hasExecutor: vi.fn(() => false),
}));
vi.mock("../../server/services/customerSupportAutoResolver", () => ({
  customerSupportAutoResolver: { attemptResolution: vi.fn(async () => ({ autoResolved: false })) },
}));
vi.mock("../../server/utils/openaiClient", () => ({
  requireOpenAIClient: vi.fn(() => ({ chat: { completions: { create: vi.fn() } } })),
}));

// ─── recordCleanCycle's hold collaborators ───────────────────────────────────
// Calibration: empty pairs → real calibrationReport grades "unproven" (never
// over-confident) → the hold passes. Quality + shadow evidence are steered per
// test through the decisionEval partial mock.

vi.mock("../../server/services/autopilot/experienceLog", () => ({
  getCalibrationPairs: vi.fn(async () => []),
}));

const DECISION_RECORDS: any[] = [];
vi.mock("../../server/services/autopilot/decisionEval", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    buildDecisionRecords: vi.fn(async () => [...DECISION_RECORDS]),
    shouldHoldPromotionForQuality: vi.fn(async () => false),
  };
});

// ─── DB mock — in-memory domain rows + inbox items ───────────────────────────

const DOMAIN_ROWS: any[] = []; // domain_autonomy_levels
const INSERTED: any[] = []; // rows inserted with .returning()
const UPDATES: Array<{ table: string | null; set: any }> = [];
const UPSERTS: Array<{ table: string | null; values: any; set: any }> = [];
const FIND_FIRST: Record<string, any> = {};
let nextId = 900;

vi.mock("../../server/db", () => {
  const tableName = (tableLike: any): string | null => {
    if (!tableLike) return null;
    const sym = Object.getOwnPropertySymbols(tableLike).find((s) => String(s).includes("Name"));
    if (sym && typeof tableLike[sym] === "string") return tableLike[sym];
    return null;
  };
  const db = {
    query: {
      decisionsInboxItems: { findFirst: vi.fn(async () => FIND_FIRST.decisionsInboxItems ?? null) },
    },
    select: (_proj?: any) => ({
      _table: null as string | null,
      from(t: any) {
        this._table = tableName(t);
        return this;
      },
      where() {
        return this;
      },
      orderBy() {
        return this;
      },
      limit() {
        return this;
      },
      then(onFulfilled: (rows: any[]) => any, onRejected?: (e: any) => any) {
        const rows = this._table === "domain_autonomy_levels" ? [...DOMAIN_ROWS] : [];
        return Promise.resolve(rows).then(onFulfilled, onRejected);
      },
    }),
    insert: (t: any) => ({
      values: (row: Record<string, any>) => ({
        returning: () => {
          const withId = { id: nextId++, ...row };
          INSERTED.push({ table: tableName(t), ...withId });
          return Promise.resolve([withId]);
        },
        onConflictDoNothing: () => Promise.resolve(),
        onConflictDoUpdate: (opts: any) => {
          UPSERTS.push({ table: tableName(t), values: row, set: opts?.set });
          return Promise.resolve();
        },
      }),
    }),
    update: (t: any) => ({
      set: (v: any) => ({
        where: () => {
          UPDATES.push({ table: tableName(t), set: v });
          // Keep the single seeded domain row live so sequential reads see it.
          if (tableName(t) === "domain_autonomy_levels" && DOMAIN_ROWS[0]) {
            Object.assign(DOMAIN_ROWS[0], v);
          }
          return Promise.resolve();
        },
      }),
    }),
  };
  return { db };
});

import {
  recordCleanCycle,
  recordAnomaly,
  setDomainLevel,
  holdPromotionProgress,
} from "../../server/services/autopilot/domainAutonomy";
import {
  requestPromotion,
  applyPromotionAnswer,
  promotionHardStopViolation,
  SHADOW_PROMOTION_ITEM_TYPE,
} from "../../server/services/autopilot/promotionRequest";
import { HARD_STOPS } from "../../server/services/autopilot/hardStops";

const NOW = Date.now();
const DAY_MS = 24 * 60 * 60 * 1000;

/** Ten resolved shadow pairs (9 wins, 1 loss) — sufficient, real-shaped evidence. */
function seedSufficientShadowEvidence() {
  DECISION_RECORDS.length = 0;
  for (let i = 0; i < 9; i++) {
    DECISION_RECORDS.push({
      moveKind: "recover_payments",
      domain: "growth",
      senses: { i },
      predictedSuccess: null,
      vote: "success",
      at: new Date(NOW - (i + 1) * DAY_MS),
      shadow: { shadowedCapability: "recover_payments" },
    });
  }
  DECISION_RECORDS.push({
    moveKind: "grow_owned_channels",
    domain: "growth",
    senses: { i: 99 },
    predictedSuccess: null,
    vote: "failure",
    at: new Date(NOW - 10 * DAY_MS),
    shadow: { shadowedCapability: "grow_owned_channels" },
  });
}

beforeEach(() => {
  DOMAIN_ROWS.length = 0;
  INSERTED.length = 0;
  UPDATES.length = 0;
  UPSERTS.length = 0;
  ARBITER_CALLS.length = 0;
  DECISION_RECORDS.length = 0;
  nextId = 900;
  for (const k of Object.keys(FIND_FIRST)) delete FIND_FIRST[k];
});

// ─── 1. Threshold no longer auto-promotes — it raises the founder card ──────

describe("recordCleanCycle at threshold — a card, never a level write (Principle 10)", () => {
  it("creates ONE shadow_promotion_request card, holds the counter at threshold, and does NOT change the level", async () => {
    DOMAIN_ROWS.push({ domain: "growth", level: "observe", cleanCycleCount: 9 });
    seedSufficientShadowEvidence();

    const level = await recordCleanCycle("growth", 10);

    // The level the caller sees is unchanged.
    expect(level).toBe("observe");
    // The counter HOLDS at threshold (accrues; the domain may sit here indefinitely).
    const counterWrites = UPDATES.filter((u) => u.table === "domain_autonomy_levels");
    expect(counterWrites).toHaveLength(1);
    expect(counterWrites[0].set.cleanCycleCount).toBe(10);
    // No write anywhere carries a level change.
    expect(counterWrites[0].set.level).toBeUndefined();
    expect(UPSERTS.filter((u) => u.table === "domain_autonomy_levels")).toHaveLength(0);

    // Exactly one card, Class B through the arbiter, with the full evidence bundle.
    const cards = INSERTED.filter((r) => r.itemType === SHADOW_PROMOTION_ITEM_TYPE);
    expect(cards).toHaveLength(1);
    const card = cards[0];
    expect(card.status).toBe("pending");
    expect(card.actionPayload).toBeNull(); // nothing executes on resolve — the tap interception applies the level
    expect(card.contextBundle.shadowPromotion).toMatchObject({
      domain: "growth",
      fromLevel: "observe",
      toLevel: "draft",
      cleanCycleCount: 10,
      threshold: 10,
    });
    expect(card.contextBundle.shadowPromotion.agreement).toMatchObject({ matched: 9, total: 10 });
    expect(card.contextBundle.options).toEqual([
      { key: "grant", label: "Promote to draft" },
      { key: "hold", label: "Not yet — keep earning" },
    ]);
    // Card body cites the real numbers + the miss verbatim.
    expect(card.sophieAnalysis).toContain("9/10 matched");
    expect(card.sophieAnalysis).toContain("observe → draft");
    expect(card.sophieAnalysis).toContain("grow_owned_channels");
    expect(ARBITER_CALLS).toEqual([
      { interruptClass: "B", subject: "Autonomy promotion request: growth → draft" },
    ]);
  });

  it("insufficient shadow evidence (< 8 resolved pairs) → NO card, counter still holds at threshold", async () => {
    DOMAIN_ROWS.push({ domain: "growth", level: "observe", cleanCycleCount: 9 });
    // Only 3 resolved pairs + 2 pending (pending never pads the denominator).
    for (let i = 0; i < 3; i++) {
      DECISION_RECORDS.push({
        moveKind: "recover_payments", domain: "growth", senses: { i }, predictedSuccess: null,
        vote: "success", at: new Date(NOW - (i + 1) * DAY_MS), shadow: {},
      });
    }
    for (let i = 0; i < 2; i++) {
      DECISION_RECORDS.push({
        moveKind: "recover_payments", domain: "growth", senses: { p: i }, predictedSuccess: null,
        vote: "pending", at: new Date(NOW - DAY_MS), shadow: {},
      });
    }

    const level = await recordCleanCycle("growth", 10);

    expect(level).toBe("observe");
    expect(INSERTED).toHaveLength(0);
    const counterWrites = UPDATES.filter((u) => u.table === "domain_autonomy_levels");
    expect(counterWrites[0].set.cleanCycleCount).toBe(10);
    // …and the NEXT clean cycle simply re-checks (counter keeps accruing, still no level write).
    UPDATES.length = 0;
    await recordCleanCycle("growth", 10);
    expect(INSERTED).toHaveLength(0);
    expect(UPDATES.filter((u) => u.table === "domain_autonomy_levels")[0].set.cleanCycleCount).toBe(11);
    expect(UPDATES.some((u) => u.set.level != null)).toBe(false);
  });

  it("dedupe: an OPEN card for the same domain+targetLevel blocks a second card", async () => {
    DOMAIN_ROWS.push({ domain: "growth", level: "observe", cleanCycleCount: 10 });
    seedSufficientShadowEvidence();
    FIND_FIRST.decisionsInboxItems = {
      id: 77,
      itemType: SHADOW_PROMOTION_ITEM_TYPE,
      status: "pending",
      contextBundle: { shadowPromotion: { domain: "growth", toLevel: "draft" } },
    };

    await recordCleanCycle("growth", 10);

    expect(INSERTED).toHaveLength(0);
    expect(ARBITER_CALLS).toHaveLength(0);
  });

  it("below threshold: no request, no card, plain counter accrual (unchanged behavior)", async () => {
    DOMAIN_ROWS.push({ domain: "growth", level: "observe", cleanCycleCount: 3 });
    seedSufficientShadowEvidence();

    const level = await recordCleanCycle("growth", 10);

    expect(level).toBe("observe");
    expect(INSERTED).toHaveLength(0);
    expect(UPDATES.filter((u) => u.table === "domain_autonomy_levels")[0].set.cleanCycleCount).toBe(4);
  });
});

// ─── 2. The founder's tap ────────────────────────────────────────────────────

function promotionCard(overrides: Record<string, any> = {}) {
  return {
    id: 901,
    contextBundle: {
      shadowPromotion: {
        domain: "growth",
        fromLevel: "observe",
        toLevel: "draft",
        cleanCycleCount: 10,
        threshold: 10,
        agreement: { matched: 9, total: 10 },
        ...overrides,
      },
    },
  };
}

describe("applyPromotionAnswer — only the founder's tap moves the level", () => {
  it("grant → setDomainLevel with the founder-approved reason citing the shadow agreement", async () => {
    const setLevel = vi.fn(async () => ({ domain: "growth" as any, level: "draft" as any }));
    const hold = vi.fn(async () => {});
    const r = await applyPromotionAnswer(
      { item: promotionCard(), optionKey: "grant" },
      { getLevel: vi.fn(async () => "observe" as any), setLevel, hold },
    );
    expect(r).toMatchObject({ applied: "granted", domain: "growth", level: "draft" });
    expect(setLevel).toHaveBeenCalledTimes(1);
    expect(setLevel).toHaveBeenCalledWith("growth", "draft", "founder-approved promotion (shadow agreement 9/10)");
    expect(hold).not.toHaveBeenCalled();
  });

  it("hold → clean-cycle counter halved, level untouched (re-ask is re-earned, not a nag)", async () => {
    const setLevel = vi.fn();
    const hold = vi.fn(async () => {});
    const r = await applyPromotionAnswer(
      { item: promotionCard(), optionKey: "hold" },
      { getLevel: vi.fn(async () => "observe" as any), setLevel: setLevel as any, hold },
    );
    expect(r).toMatchObject({ applied: "held", domain: "growth" });
    expect(hold).toHaveBeenCalledWith("growth");
    expect(setLevel).not.toHaveBeenCalled();
  });

  it("holdPromotionProgress writes cleanCycleCount = floor(threshold/2)", async () => {
    DOMAIN_ROWS.push({ domain: "growth", level: "observe", cleanCycleCount: 10 });
    await holdPromotionProgress("growth", 10);
    const w = UPDATES.filter((u) => u.table === "domain_autonomy_levels");
    expect(w).toHaveLength(1);
    expect(w[0].set.cleanCycleCount).toBe(5);
    expect(w[0].set.level).toBeUndefined();
  });

  it("STALE card never loosens: if the domain moved since the card was raised, grant is skipped", async () => {
    const setLevel = vi.fn();
    const r = await applyPromotionAnswer(
      { item: promotionCard(), optionKey: "grant" },
      // The circuit breaker demoted growth back… no, wait — the card says
      // fromLevel observe but the domain now sits at draft (already granted).
      { getLevel: vi.fn(async () => "draft" as any), setLevel: setLevel as any, hold: vi.fn() },
    );
    expect(r.applied).toBe("skipped");
    expect(setLevel).not.toHaveBeenCalled();
  });

  it("throws on an unknown option key or a card without a shadowPromotion bundle (programming errors, never guessed)", async () => {
    await expect(
      applyPromotionAnswer({ item: promotionCard(), optionKey: "maybe" }),
    ).rejects.toThrow(/unknown promotion option key/);
    await expect(
      applyPromotionAnswer({ item: { id: 5, contextBundle: {} }, optionKey: "grant" }),
    ).rejects.toThrow(/carries no shadowPromotion bundle/);
  });
});

// ─── 3. Hard-stop structural exclusion ───────────────────────────────────────

describe("hard-stop classes are NEVER promotion-eligible (hardStops.ts, mature-machine §1.4 + §4)", () => {
  it("promotionHardStopViolation flags every literal hard-stop class name", () => {
    for (const hs of HARD_STOPS) {
      expect(promotionHardStopViolation("growth", [hs])).toBe(hs);
    }
  });

  it("flags capability names matching the hands-registry hard-stop patterns", () => {
    expect(promotionHardStopViolation("growth", ["price_update_helper"])).toBe("pricing_changes");
    expect(promotionHardStopViolation("growth", ["legal_signing_bot"])).toBe("legal_signing");
    expect(promotionHardStopViolation("growth", ["delete_customer_data"])).toBe("customer_data_deletion");
    expect(promotionHardStopViolation("growth", ["recover_payments", "optimize"])).toBeNull();
  });

  it("requestPromotion REFUSES (no card) when the evidence cites a hard-stop capability — regardless of a perfect record", async () => {
    const createCard = vi.fn();
    const r = await requestPromotion(
      "growth",
      { currentLevel: "observe", cleanCycleCount: 10, threshold: 10 },
      {
        computeAgreement: async () => ({
          matched: 12, total: 12, pendingPairs: 0, windowWeeks: 6, misses: [],
          sufficient: true, capabilities: ["pricing_change_update"], caveat: "proxy",
        }),
        createCard,
      },
    );
    expect(r).toMatchObject({ created: false, reason: "hard_stop_excluded", detail: "pricing_changes" });
    expect(createCard).not.toHaveBeenCalled();
  });

  it("requestPromotion at the top level requests nothing", async () => {
    const createCard = vi.fn();
    const r = await requestPromotion(
      "growth",
      { currentLevel: "autonomous_gated", cleanCycleCount: 10, threshold: 10 },
      { computeAgreement: vi.fn(), createCard },
    );
    expect(r).toMatchObject({ created: false, reason: "at_top_level" });
    expect(createCard).not.toHaveBeenCalled();
  });
});

// ─── 4. Regressions — nothing else moved ─────────────────────────────────────

describe("regressions: demotion stays automatic; the manual override stays sovereign", () => {
  it("recordAnomaly demotes one rung immediately — no card, no founder gate", async () => {
    DOMAIN_ROWS.push({ domain: "growth", level: "execute_gated", cleanCycleCount: 7 });

    const demoted = await recordAnomaly("growth", "gate-failure spike");

    expect(demoted).toBe("draft");
    const w = UPDATES.filter((u) => u.table === "domain_autonomy_levels");
    expect(w).toHaveLength(1);
    expect(w[0].set).toMatchObject({ level: "draft", cleanCycleCount: 0, lastDemotionReason: "gate-failure spike" });
    expect(INSERTED).toHaveLength(0); // demotion never asks permission
  });

  it("manual setDomainLevel (Control Center Grant — Principle 9 sovereign override) is unchanged", async () => {
    DOMAIN_ROWS.push({ domain: "growth", level: "observe", cleanCycleCount: 4 });

    const r = await setDomainLevel("growth", "execute_gated", "set from Control Center");

    expect(r).toEqual({ domain: "growth", level: "execute_gated" });
    const upsert = UPSERTS.find((u) => u.table === "domain_autonomy_levels");
    expect(upsert?.set).toMatchObject({ level: "execute_gated", cleanCycleCount: 0 });
    // Input contract still enforced.
    // @ts-expect-error — deliberately invalid
    await expect(setDomainLevel("growth", "root", "nope")).rejects.toThrow(/unknown level/i);
  });
});
