/**
 * Tests for the event-driven team-improvement detector layer.
 *
 * Coverage:
 *   - Each of the 7 detectors fires on synthetic-state inputs that should match
 *     AND ignores inputs that should NOT match (boundary cases included).
 *   - Auto-dispatch guardrails: confidence floor, cost cap, severity gate,
 *     core-architecture block, per-member 24h ceiling, envelope room.
 *
 * Strategy: light in-memory db mock. vi.mock factories are hoisted, so all
 * data registries live as globalThis.__test* slots — the factories pluck
 * them at call time, not at module-load time.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../server/utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ── Schema mocks — table objects are sentinel references so the db mock
//    can route select(...).from(<table>) to the right in-memory dataset.
vi.mock("../../shared/schema/solene-audit", () => {
  const t = {
    soleneAuditFindings: { __t: "solene_audit_findings" },
    soleneDecisions: { __t: "solene_decisions" },
  };
  (globalThis as any).__schemaSolene = t;
  return t;
});
vi.mock("../../shared/schema/solene-capital", () => {
  const t = { soleneCapitalEvents: { __t: "solene_capital_events" } };
  (globalThis as any).__schemaSoleneCapital = t;
  return t;
});
vi.mock("../../shared/schema/team-improvement", async () => {
  const actual = await vi.importActual<any>(
    "../../shared/schema/team-improvement",
  );
  const sentinel = { __t: "team_improvement_opportunities" };
  (globalThis as any).__schemaTeamImprovement = sentinel;
  return { ...actual, teamImprovementOpportunities: sentinel };
});

// ── db mock — routes by sentinel reference identity. Reads from globalThis
//    registries that the per-test code sets up.
vi.mock("../../server/db", () => {
  const db = {
    select: (_fields?: any) => ({
      from: (table: any) => {
        const arr = pluckTable(table);
        const chain: any = {
          _arr: arr,
          where: function (_cond: any) {
            return this;
          },
          orderBy: function () {
            return this;
          },
          limit: function (n: number) {
            this._arr = this._arr.slice(0, n);
            return this;
          },
          groupBy: function () {
            return this;
          },
          then: function (resolve: any, reject: any) {
            return Promise.resolve(this._arr).then(resolve, reject);
          },
        };
        return chain;
      },
    }),
    insert: (table: any) => ({
      values: (rowOrRows: any) => ({
        onConflictDoNothing: () => ({
          returning: () => {
            const ops = (globalThis as any).__opportunities as any[];
            const arr = Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows];
            const inserted: { id: number }[] = [];
            const seenKey = (r: any) =>
              `${r.teamMember}::${r.signalPattern}::${r.description}`;
            for (const r of arr) {
              if (
                table === (globalThis as any).__schemaTeamImprovement
                  ?.teamImprovementOpportunities ||
                table?.__t === "team_improvement_opportunities"
              ) {
                if (ops.some((o) => seenKey(o) === seenKey(r))) continue;
                const id = ops.length + 1;
                ops.push({ ...r, id });
                inserted.push({ id });
              }
            }
            return Promise.resolve(inserted);
          },
        }),
      }),
    }),
    update: (_table: any) => ({
      set: (vals: any) => ({
        where: () => {
          const ops = (globalThis as any).__opportunities as any[];
          if (ops.length === 0) return Promise.resolve();
          const last = ops[ops.length - 1];
          for (const k of Object.keys(vals)) {
            last[k] = vals[k];
          }
          return Promise.resolve();
        },
      }),
    }),
    execute: async (_q: any) => {
      const rows = (globalThis as any).__regEvents;
      if (rows === null || rows === undefined) {
        throw new Error('relation "beatrice_reg_events" does not exist');
      }
      return { rows };
    },
  };
  function pluckTable(t: any): any[] {
    if (!t) return [];
    if (t.__t === "solene_audit_findings") return (globalThis as any).__findings ?? [];
    if (t.__t === "solene_decisions") return (globalThis as any).__decisions ?? [];
    if (t.__t === "solene_capital_events") return (globalThis as any).__capital ?? [];
    if (t.__t === "team_improvement_opportunities")
      return (globalThis as any).__opportunities ?? [];
    return [];
  }
  return { db };
});

// Capital-tracker stub (envelope guardrail).
vi.mock("../../server/services/solene/capitalTracker", () => ({
  getMonthlyEnvelopeStatus: () =>
    Promise.resolve((globalThis as any).__envelope ?? {
      envelopeUsd: 50,
      monthToDateUsd: 0,
      percentUsed: 0,
    }),
}));

// ── System under test ──────────────────────────────────────────────────────
import {
  detectRecurringGap,
  detectPatternTransfer,
  detectExternalEvent,
  detectRecurringDispatchFlag,
  detectSuccessfulPattern,
  detectVolumeThreshold,
  detectCapitalConcentration,
  CAPABILITY_REGISTRY,
  VOLUME_TIERS,
} from "../../server/services/improvement/detector";
import {
  evaluateForAutoDispatch,
  AUTO_DISPATCH_CONFIDENCE_FLOOR,
  AUTO_DISPATCH_COST_CEILING_USD,
  AUTO_DISPATCH_PER_MEMBER_24H_CEILING,
} from "../../server/services/improvement/autoDispatch";
import type { TeamImprovementOpportunity } from "../../shared/schema/team-improvement";

const ONE_DAY_AGO = new Date(Date.now() - 24 * 60 * 60 * 1000);
const TWO_WEEKS_AGO = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

beforeEach(() => {
  (globalThis as any).__findings = [];
  (globalThis as any).__decisions = [];
  (globalThis as any).__capital = [];
  (globalThis as any).__opportunities = [];
  (globalThis as any).__regEvents = null;
  (globalThis as any).__envelope = {
    envelopeUsd: 50,
    monthToDateUsd: 0,
    percentUsed: 0,
  };
});

afterEach(() => {
  (globalThis as any).__findings = [];
  (globalThis as any).__decisions = [];
  (globalThis as any).__capital = [];
  (globalThis as any).__opportunities = [];
  (globalThis as any).__regEvents = null;
});

// ============================================================================
// DETECTOR 1 — recurring_gap
// ============================================================================
describe("detectRecurringGap", () => {
  it("fires when same pattern + excerpt appears ≥2 times with member keywords", async () => {
    (globalThis as any).__findings = [
      {
        id: 1,
        pattern: "menu_handing",
        severity: "fail",
        excerpt: "iris perf-monitor regression — should I add ADR?",
        firedAt: ONE_DAY_AGO,
      },
      {
        id: 2,
        pattern: "menu_handing",
        severity: "fail",
        excerpt: "iris perf-monitor regression — should I add ADR?",
        firedAt: ONE_DAY_AGO,
      },
    ];
    const r = await detectRecurringGap("iris", TWO_WEEKS_AGO);
    expect(r).toHaveLength(1);
    expect(r[0].signalPattern).toBe("recurring_gap");
    expect(r[0].teamMember).toBe("iris");
    expect(r[0].confidence).toBe(0.9);
    expect(r[0].severity).toBe("opportunity");
  });

  it("does NOT fire on a single occurrence", async () => {
    (globalThis as any).__findings = [
      {
        id: 1,
        pattern: "menu_handing",
        severity: "fail",
        excerpt: "iris perf-monitor regression once",
        firedAt: ONE_DAY_AGO,
      },
    ];
    const r = await detectRecurringGap("iris", TWO_WEEKS_AGO);
    expect(r).toHaveLength(0);
  });

  it("does NOT fire when member keywords don't match the excerpt", async () => {
    (globalThis as any).__findings = [
      {
        id: 1,
        pattern: "menu_handing",
        severity: "fail",
        excerpt: "completely unrelated widgets text",
        firedAt: ONE_DAY_AGO,
      },
      {
        id: 2,
        pattern: "menu_handing",
        severity: "fail",
        excerpt: "completely unrelated widgets text",
        firedAt: ONE_DAY_AGO,
      },
    ];
    const r = await detectRecurringGap("iris", TWO_WEEKS_AGO);
    expect(r).toHaveLength(0);
  });
});

// ============================================================================
// DETECTOR 2 — pattern_transfer
// ============================================================================
describe("detectPatternTransfer", () => {
  it("fires for members whose baseline gaps a peer's capability closes", async () => {
    const r = await detectPatternTransfer();
    const irisOpp = r.find(
      (o) => o.teamMember === "iris" && o.signalPattern === "pattern_transfer",
    );
    expect(irisOpp).toBeDefined();
    expect(irisOpp?.confidence).toBe(0.8);
    expect(irisOpp?.severity).toBe("opportunity");
  });

  it("does NOT self-recommend (member can't transfer to themselves)", async () => {
    const r = await detectPatternTransfer();
    for (const opp of r) {
      // Description embeds "<owner> ships <cap>" — neither owner nor cap-target
      // is the same member.
      expect(opp.description).not.toMatch(
        new RegExp(`^${opp.teamMember}: .* ${opp.teamMember} ships`),
      );
    }
  });
});

// ============================================================================
// DETECTOR 3 — external_event
// ============================================================================
describe("detectExternalEvent", () => {
  it("skips gracefully when beatrice_reg_events doesn't exist", async () => {
    (globalThis as any).__regEvents = null;
    const r = await detectExternalEvent(TWO_WEEKS_AGO);
    expect(r).toEqual([]);
  });

  it("fires URGENT when title contains breach|enforcement|fine", async () => {
    (globalThis as any).__regEvents = [
      {
        id: 1,
        title: "CFPB enforcement action against XYZ for compliance breach",
        surface: "compliance",
        publishedAt: ONE_DAY_AGO,
      },
    ];
    const r = await detectExternalEvent(TWO_WEEKS_AGO);
    expect(r).toHaveLength(1);
    expect(r[0].severity).toBe("urgent");
    expect(r[0].confidence).toBe(0.95);
  });

  it("fires opportunity (not urgent) for routine reg events", async () => {
    (globalThis as any).__regEvents = [
      {
        id: 2,
        title: "New CFPB guidance on adverse-action notices",
        surface: "compliance",
        publishedAt: ONE_DAY_AGO,
      },
    ];
    const r = await detectExternalEvent(TWO_WEEKS_AGO);
    expect(r).toHaveLength(1);
    expect(r[0].severity).toBe("opportunity");
  });
});

// ============================================================================
// DETECTOR 4 — recurring_dispatch_flag
// ============================================================================
describe("detectRecurringDispatchFlag", () => {
  it("fires at ≥3 mentions of an infrastructure-gap phrase tied to the member", async () => {
    (globalThis as any).__decisions = [1, 2, 3].map((i) => ({
      id: i,
      decisionType: "dispatch",
      contextSummary: "iris perf-monitor work",
      rationale:
        "iris dispatch — this would be cleaner if a structured perf ADR primitive existed",
      decidedAt: ONE_DAY_AGO,
    }));
    const r = await detectRecurringDispatchFlag("iris", TWO_WEEKS_AGO);
    expect(r).toHaveLength(1);
    expect(r[0].signalPattern).toBe("recurring_dispatch_flag");
    expect(r[0].confidence).toBe(0.85);
  });

  it("does NOT fire below the 3-mention floor", async () => {
    (globalThis as any).__decisions = [1, 2].map((i) => ({
      id: i,
      decisionType: "dispatch",
      contextSummary: "iris perf work",
      rationale: "iris — would be cleaner if X existed",
      decidedAt: ONE_DAY_AGO,
    }));
    const r = await detectRecurringDispatchFlag("iris", TWO_WEEKS_AGO);
    expect(r).toHaveLength(0);
  });
});

// ============================================================================
// DETECTOR 5 — successful_pattern
// ============================================================================
describe("detectSuccessfulPattern", () => {
  it("emits 'replicate the win' opportunities for gap-having members", async () => {
    const r = await detectSuccessfulPattern();
    const opp = r.find(
      (o) => o.teamMember === "iris" && o.signalPattern === "successful_pattern",
    );
    expect(opp).toBeDefined();
    expect(opp?.confidence).toBe(0.75);
  });
});

// ============================================================================
// DETECTOR 6 — volume_threshold
// ============================================================================
describe("detectVolumeThreshold", () => {
  it("fires at the 50-commit tier", async () => {
    const r = await detectVolumeThreshold("iris", TWO_WEEKS_AGO, {
      getCommitCount: () => 50,
    });
    expect(r).toHaveLength(1);
    expect(r[0].description).toMatch(/50-commit tier/);
    expect(r[0].severity).toBe("info");
  });

  it("fires BOTH tiers at the 200-commit mark", async () => {
    const r = await detectVolumeThreshold("iris", TWO_WEEKS_AGO, {
      getCommitCount: () => 200,
    });
    expect(r).toHaveLength(2);
  });

  it("does NOT fire below the 50-commit floor", async () => {
    const r = await detectVolumeThreshold("iris", TWO_WEEKS_AGO, {
      getCommitCount: () => 49,
    });
    expect(r).toHaveLength(0);
  });

  it("tier definitions are stable", () => {
    expect(VOLUME_TIERS.map((t) => t.count)).toEqual([50, 200]);
  });
});

// ============================================================================
// DETECTOR 7 — capital_concentration
// ============================================================================
describe("detectCapitalConcentration", () => {
  it("fires when one member consumes >50% of capital with few attributed commits", async () => {
    (globalThis as any).__capital = [
      {
        id: 1,
        eventType: "agent_dispatch",
        costUsd: "40.00",
        contextSummary: "iris perf-monitor dispatch",
        occurredAt: ONE_DAY_AGO,
      },
      {
        id: 2,
        eventType: "agent_dispatch",
        costUsd: "10.00",
        contextSummary: "soren landing copy dispatch",
        occurredAt: ONE_DAY_AGO,
      },
    ];
    const r = await detectCapitalConcentration(TWO_WEEKS_AGO, {
      getCommitCount: () => 0,
    });
    const irisOpp = r.find((o) => o.teamMember === "iris");
    expect(irisOpp).toBeDefined();
    expect(irisOpp?.confidence).toBe(0.8);
    expect(irisOpp?.description).toMatch(/80%/);
  });

  it("does NOT fire when heavy-spend member also shipped ≥5 commits", async () => {
    (globalThis as any).__capital = [
      {
        id: 1,
        eventType: "agent_dispatch",
        costUsd: "40.00",
        contextSummary: "iris perf-monitor dispatch",
        occurredAt: ONE_DAY_AGO,
      },
    ];
    const r = await detectCapitalConcentration(TWO_WEEKS_AGO, {
      getCommitCount: () => 10,
    });
    expect(r.find((o) => o.teamMember === "iris")).toBeUndefined();
  });

  it("returns nothing on empty capital ledger", async () => {
    const r = await detectCapitalConcentration(TWO_WEEKS_AGO, {
      getCommitCount: () => 0,
    });
    expect(r).toEqual([]);
  });
});

// ============================================================================
// AUTO-DISPATCH GUARDRAILS
// ============================================================================
function baseOpportunity(
  over: Partial<TeamImprovementOpportunity> = {},
): TeamImprovementOpportunity {
  return {
    id: 1,
    detectedAt: new Date(),
    teamMember: "iris",
    signalPattern: "recurring_gap",
    description: "iris: recurring perf regression gap",
    evidence: {},
    confidence: "0.900",
    estimatedCostUsd: "25.00",
    severity: "opportunity",
    autoDispatched: false,
    dispatchedAt: null,
    dispatchedAgentId: null,
    resolvedAt: null,
    resolutionCommit: null,
    ...over,
  } as unknown as TeamImprovementOpportunity;
}

describe("evaluateForAutoDispatch — guardrails", () => {
  it("auto-dispatches (simulated) when all guardrails pass", async () => {
    const r = await evaluateForAutoDispatch(baseOpportunity(), {
      countMemberDispatchesLast24h: async () => 0,
      dryRun: true,
    });
    expect(r.dispatched).toBe(true);
    expect(r.simulated).toBe(true);
    expect(r.agentId).toMatch(/^SIMULATED:/);
    expect(r.evaluation.passed).toBe(true);
  });

  it("BLOCKS when confidence < floor", async () => {
    const r = await evaluateForAutoDispatch(
      baseOpportunity({ confidence: "0.840" as any }),
      { countMemberDispatchesLast24h: async () => 0, dryRun: true },
    );
    expect(r.dispatched).toBe(false);
    expect(r.evaluation.failed).toContain("confidence_floor");
  });

  it("PASSES at exactly the confidence floor (boundary)", async () => {
    const r = await evaluateForAutoDispatch(
      baseOpportunity({
        confidence: String(AUTO_DISPATCH_CONFIDENCE_FLOOR) as any,
      }),
      { countMemberDispatchesLast24h: async () => 0, dryRun: true },
    );
    expect(r.dispatched).toBe(true);
  });

  it("BLOCKS when estimated cost > $50 ceiling", async () => {
    const r = await evaluateForAutoDispatch(
      baseOpportunity({
        estimatedCostUsd: String(AUTO_DISPATCH_COST_CEILING_USD + 0.01) as any,
      }),
      { countMemberDispatchesLast24h: async () => 0, dryRun: true },
    );
    expect(r.dispatched).toBe(false);
    expect(r.evaluation.failed).toContain("cost_cap");
  });

  it("BLOCKS when MTD envelope leaves no room", async () => {
    const r = await evaluateForAutoDispatch(
      baseOpportunity({ estimatedCostUsd: "25.00" as any }),
      {
        countMemberDispatchesLast24h: async () => 0,
        getEnvelopeStatus: async () => ({
          envelopeUsd: 50,
          monthToDateUsd: 40,
          percentUsed: 80,
        }),
        dryRun: true,
      },
    );
    expect(r.dispatched).toBe(false);
    expect(r.evaluation.failed).toContain("envelope_room");
  });

  it("BLOCKS info-severity opportunities", async () => {
    const r = await evaluateForAutoDispatch(
      baseOpportunity({ severity: "info" }),
      { countMemberDispatchesLast24h: async () => 0, dryRun: true },
    );
    expect(r.dispatched).toBe(false);
    expect(r.evaluation.failed).toContain("severity_gate");
  });

  it("PERMITS urgent-severity opportunities", async () => {
    const r = await evaluateForAutoDispatch(
      baseOpportunity({ severity: "urgent" }),
      { countMemberDispatchesLast24h: async () => 0, dryRun: true },
    );
    expect(r.dispatched).toBe(true);
  });

  it("BLOCKS when description matches core-architecture phrases", async () => {
    const r = await evaluateForAutoDispatch(
      baseOpportunity({
        description: "iris: introduce schema-changing migration for perf",
      }),
      { countMemberDispatchesLast24h: async () => 0, dryRun: true },
    );
    expect(r.dispatched).toBe(false);
    expect(r.evaluation.failed).toContain("core_architecture_block");
  });

  it("BLOCKS at the per-member 24h ceiling", async () => {
    const r = await evaluateForAutoDispatch(baseOpportunity(), {
      countMemberDispatchesLast24h: async () =>
        AUTO_DISPATCH_PER_MEMBER_24H_CEILING,
      dryRun: true,
    });
    expect(r.dispatched).toBe(false);
    expect(r.evaluation.failed).toContain("per_member_24h_ceiling");
  });

  it("PASSES at ceiling - 1 (boundary)", async () => {
    const r = await evaluateForAutoDispatch(baseOpportunity(), {
      countMemberDispatchesLast24h: async () =>
        AUTO_DISPATCH_PER_MEMBER_24H_CEILING - 1,
      dryRun: true,
    });
    expect(r.dispatched).toBe(true);
  });
});

describe("capability registry sanity", () => {
  it("exposes the five baseline capability slugs", () => {
    const slugs = CAPABILITY_REGISTRY.map((c) => c.slug).sort();
    expect(slugs).toEqual(
      [
        "audit_framework",
        "capital_tracker",
        "perf_monitor",
        "self_audit",
        "seo_ranking_tracker",
      ].sort(),
    );
  });
});
