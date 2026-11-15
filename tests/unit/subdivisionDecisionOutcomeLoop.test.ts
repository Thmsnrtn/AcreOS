/**
 * Subdivision V1, Leg 4 — the outcome loop closes for a subdivider decision
 * (§8.4 test 16, §6.3).
 *
 * LEVEL PINNED: the REAL functions — recordUnderwrittenDecision (the kit, the
 * real feasibility engine), recordDecision, freezeScenarioRefs, getDecision,
 * decisionsDueForOutcome and recordOutcome — run over an IN-MEMORY db fake. The
 * fake does not run SQL: it reads the WHERE clause the store actually built
 * (rendered by drizzle's own PgDialect) and applies the predicates it finds there
 * (org scope, id, review_due_at IS NOT NULL, review_due_at <= as-of, NOT IN the
 * resolved-outcome subquery, outcome kind <> / = still_open, ORDER BY). A
 * predicate the store drops therefore changes what the fake returns, and the
 * assertions below go red. It is NOT a Postgres run: a predicate the fake does
 * not know is not evaluated (the pre-existing source-shape pins in
 * outcomePrompt.test.ts cover the SQL text itself).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

const dialect = new PgDialect();
const render = (x: unknown) => dialect.sqlToQuery(x as SQL);

const mem = vi.hoisted(() => ({
  scenarios: [] as any[],
  decisions: [] as any[],
  outcomes: [] as any[],
}));

vi.mock("../../server/db", async () => {
  const { scenarios, decisionSnapshots, outcomes } = await import("@shared/schema");
  const isTimestamp = (p: unknown) => p instanceof Date || (typeof p === "string" && /^\d{4}-\d{2}-\d{2}T/.test(p));
  const orgScoped = (text: string, params: unknown[], r: any) => !text.includes('"organization_id" = $') || params.includes(r.organizationId);

  const outcomeRows = (text: string, params: unknown[]) => {
    const kind = params.find((p) => typeof p === "string");
    return mem.outcomes
      .filter((r) => orgScoped(text, params, r))
      .filter((r) => (text.includes('"kind" <> $') ? r.kind !== kind : text.includes('"kind" = $') ? r.kind === kind : true));
  };
  const decisionRows = (text: string, params: unknown[]) => {
    let out = mem.decisions.filter((r) => orgScoped(text, params, r));
    if (/(^|[^_a-z])"id" = \$/.test(text)) out = out.filter((r) => params.includes(r.id));
    if (text.includes('"review_due_at" is not null')) out = out.filter((r) => r.reviewDueAt !== null && r.reviewDueAt !== undefined);
    if (text.includes('"review_due_at" <= $')) {
      const asOf = new Date(params.find(isTimestamp) as string | Date).getTime();
      out = out.filter((r) => r.reviewDueAt && new Date(r.reviewDueAt).getTime() <= asOf);
    }
    if (text.includes(" not in ")) {
      const sub = params.find((p) => p && typeof p === "object" && "__subq" in (p as object)) as any;
      const resolved = new Set(outcomeRows(sub.__subq.text, sub.__subq.params).map((o) => o.decisionSnapshotId));
      out = out.filter((r) => !resolved.has(r.id));
    }
    return out;
  };
  const scenarioRows = (text: string, params: unknown[]) =>
    mem.scenarios.filter((r) => orgScoped(text, params, r) && params.includes(r.id));

  const chain = (list: any[], subq?: { text: string; params: unknown[] }) => {
    const p = Promise.resolve(list) as Promise<any[]> & Record<string, unknown>;
    p.__subq = subq;
    p.orderBy = (...ord: unknown[]) => {
      const texts = ord.map((o) => render(o).sql).join(" ");
      const sorted = [...list];
      if (texts.includes('"review_due_at" asc')) sorted.sort((a, b) => new Date(a.reviewDueAt).getTime() - new Date(b.reviewDueAt).getTime());
      if (texts.includes('"decided_at" desc')) sorted.sort((a, b) => new Date(b.decidedAt).getTime() - new Date(a.decidedAt).getTime());
      return chain(sorted, subq);
    };
    p.limit = () => Promise.resolve(list);
    return p;
  };

  const insertInto = (table: unknown, values: Record<string, unknown>) => {
    if (table === scenarios) {
      const row = { computedAt: new Date("2026-11-09T12:00:00Z"), ...values, id: mem.scenarios.length + 1 };
      mem.scenarios.push(row);
      return row;
    }
    if (table === decisionSnapshots) {
      const row = { decidedAt: new Date("2026-11-09T12:00:00Z"), ...values, id: mem.decisions.length + 1 };
      mem.decisions.push(row);
      return row;
    }
    if (table === outcomes) {
      const row = { recordedAt: new Date("2026-12-03T12:00:00Z"), ...values, id: mem.outcomes.length + 1 };
      mem.outcomes.push(row);
      return row;
    }
    throw new Error("unexpected insert target");
  };

  return {
    db: {
      select: () => ({
        from: (table: unknown) => ({
          where: (w: unknown) => {
            const { sql: text, params } = render(w);
            if (table === decisionSnapshots) return chain(decisionRows(text, params));
            if (table === scenarios) return chain(scenarioRows(text, params));
            if (table === outcomes) return chain(outcomeRows(text, params).map((o) => ({ id: o.decisionSnapshotId })), { text, params });
            throw new Error("unexpected select source");
          },
        }),
      }),
      insert: (table: unknown) => ({
        values: (values: Record<string, unknown>) => ({ returning: async () => [insertInto(table, values)] }),
      }),
    },
  };
});
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
// No evidence claims exist for this fake parcel; the fabric is not under test here.
vi.mock("../../server/services/evidence/evidenceStore", () => ({ resolveSubject: async () => new Map() }));
vi.mock("../../server/services/opportunities", () => ({ requireOpportunity: async () => undefined }));

import { decisionsDueForOutcome, getDecision } from "../../server/services/decisions/decisionStore";
import { recordOutcome } from "../../server/services/outcomes/outcomeStore";
import { recordUnderwrittenDecision } from "../../server/services/underwriting/verticalDecision";

const $ = (d: number) => d * 100;
/** Leg 3's golden project (cost 280,000; margin 120,000; profit after p50 carry 118,000). */
const WIRE: Record<string, number | string> = {
  landCostCents: $(100_000),
  lotCount: 10,
  grossProceedsCents: $(400_000),
  absorptionLotsPerMonth: 5,
  wastewater: "septic",
  gradingCents: $(20_000),
  roadsCents: $(50_000),
  waterCents: $(10_000),
  septicCents: $(30_000),
  stormwaterCents: $(5_000),
  utilitiesCents: $(15_000),
  landscapingCents: 0,
  engineeringSurveyCents: $(12_000),
  legalCents: $(3_000),
  permittingFeesCents: $(10_000),
  financingCents: 0,
  marketingCents: $(20_000),
  contingencyCents: $(5_000),
  timelineP50Days: 60,
  timelineP90Days: 90,
  holdingCostMonthlyCents: $(1_000),
};
const RENTAL = {
  purchasePriceCents: 20_000_000,
  monthlyRentCents: 200_000,
  vacancyPct: 5,
  monthlyFixedExpensesCents: 50_000,
  managementPct: 8,
  reservesPct: 10,
};

const ASOF = new Date("2026-12-02T00:00:00Z");
const subdividerDecision = (over: { reviewDueAt: Date | null; org?: number; subjectId?: number; kind?: "pursue" | "pass" }) =>
  recordUnderwrittenDecision(over.org ?? 7, {
    subjectType: "property",
    subjectId: over.subjectId ?? 42,
    engineId: "subdivision_feasibility",
    strategyPackId: "subdivider",
    inputs: WIRE,
    assumptions: [],
    scenarioLabel: "Subdivision decision — 12 Ridge Rd",
    kind: over.kind ?? "pursue",
    choice: "Proceed to entitlement",
    rationale: "Margin clears our floor on the stated inputs.",
    actorRef: "user_1",
    authority: "org_member:subdivision_decide",
    reviewDueAt: over.reviewDueAt,
  });

beforeEach(() => {
  mem.scenarios.length = 0;
  mem.decisions.length = 0;
  mem.outcomes.length = 0;
});

describe("§8.4 test 16 — a recorded subdivider decision is asked for its outcome (no pack filter hides it)", () => {
  it("the kit writes a subdivider decision (real engine, frozen scenario) and decisionsDueForOutcome returns it once its review date has passed", async () => {
    const out = await subdividerDecision({ reviewDueAt: new Date("2026-12-01T00:00:00Z") });
    expect(mem.scenarios).toHaveLength(1);
    expect(mem.decisions).toHaveLength(1);
    expect(mem.decisions[0].strategyPackId).toBe("subdivider");
    expect(mem.decisions[0].scenarios.map((s: any) => s.scenarioId)).toEqual([out.scenarioId]);
    expect(mem.decisions[0].scenarios[0].engineId).toBe("subdivision_feasibility");

    const due = await decisionsDueForOutcome(7, ASOF);
    expect(due).toHaveLength(1);
    expect(due[0]).toMatchObject({
      id: out.decisionId,
      subjectType: "property",
      subjectId: 42,
      kind: "pursue",
      choice: "Proceed to entitlement",
      interimObservations: 0,
    });
    expect(due[0].reviewDueAt).toEqual(new Date("2026-12-01T00:00:00Z"));
    // The forecast the engine made rides with the prompt (so variance is a real comparison)…
    expect(due[0].predictedMetricIds).toEqual(expect.arrayContaining(["project_cost_before_carry", "margin_before_carry", "profit"]));
    // …and `total_cost` — which the loop reads as ACQUISITION cost — is never among them.
    expect(due[0].predictedMetricIds).not.toContain("total_cost");
  });

  it("not yet due, and no review date, are both NOT asked about; 'pass' is asked like any other kind", async () => {
    await subdividerDecision({ reviewDueAt: new Date("2026-12-03T00:00:00Z"), subjectId: 1 }); // due after as-of
    await subdividerDecision({ reviewDueAt: null, subjectId: 2 }); // no set date: never nagged
    const pass = await subdividerDecision({ reviewDueAt: new Date("2026-12-01T00:00:00Z"), subjectId: 3, kind: "pass" });
    const due = await decisionsDueForOutcome(7, ASOF);
    expect(due.map((d) => d.id)).toEqual([pass.decisionId]);
    expect(due[0].kind).toBe("pass");
  });

  it("no pack filter: a subdivider decision sits in the same queue as another vertical's, oldest review date first", async () => {
    const sub = await subdividerDecision({ reviewDueAt: new Date("2026-12-01T00:00:00Z") });
    const rental = await recordUnderwrittenDecision(7, {
      subjectType: "property",
      subjectId: 77,
      engineId: "rental_acquisition",
      strategyPackId: "buy_and_hold",
      inputs: RENTAL,
      scenarioLabel: "Buy at $200,000",
      kind: "acquire",
      choice: "Acquire at $200,000",
      rationale: "Cap rate clears our floor.",
      actorRef: "user_1",
      authority: "org_member:test",
      reviewDueAt: new Date("2026-11-20T00:00:00Z"),
    });
    const due = await decisionsDueForOutcome(7, ASOF);
    expect(due.map((d) => d.id)).toEqual([rental.decisionId, sub.decisionId]); // oldest due date first
    expect(mem.decisions.map((d) => d.strategyPackId)).toEqual(["subdivider", "buy_and_hold"]);
  });

  it("the queue is org-scoped: another org sees nothing", async () => {
    await subdividerDecision({ reviewDueAt: new Date("2026-12-01T00:00:00Z") });
    expect(await decisionsDueForOutcome(8, ASOF)).toEqual([]);
    expect(await decisionsDueForOutcome(7, ASOF)).toHaveLength(1);
  });
});

describe("§8.4 test 16 / §6.3 — outcomes append; the decision snapshot is never edited", () => {
  it("an interim observation keeps the decision in the queue (counted); a terminal outcome closes it; the snapshot body is byte-identical throughout", async () => {
    const out = await subdividerDecision({ reviewDueAt: new Date("2026-12-01T00:00:00Z") });
    const rowBefore = JSON.stringify(mem.decisions[0]);
    const bodyBefore = JSON.stringify((await getDecision(7, out.decisionId))!.body);
    const scenarioBefore = JSON.stringify(mem.scenarios[0]);

    // 1. an interim observation: a real answer, not the last one.
    const interim = await recordOutcome(7, {
      decisionSnapshotId: out.decisionId,
      kind: "still_open",
      summary: "Preliminary plat submitted; county has not responded.",
      actuals: [],
      observedAt: new Date("2026-12-02T00:00:00Z"),
    });
    expect(interim.body).toMatchObject({ decisionSnapshotId: out.decisionId, subjectType: "property", subjectId: 42, kind: "still_open" });
    let due = await decisionsDueForOutcome(7, ASOF);
    expect(due.map((d) => d.id)).toEqual([out.decisionId]);
    expect(due[0].interimObservations).toBe(1);

    // 2. a terminal outcome closes the question.
    await recordOutcome(7, {
      decisionSnapshotId: out.decisionId,
      kind: "abandoned",
      summary: "Dropped after the perc results failed.",
      actuals: [{ id: "profit", value: $(-15_000) }],
      observedAt: new Date("2026-12-02T00:00:00Z"),
    });
    due = await decisionsDueForOutcome(7, ASOF);
    expect(due).toEqual([]);

    // Outcomes APPENDED (two rows, each pointing at the decision)…
    expect(mem.outcomes.map((o) => [o.decisionSnapshotId, o.kind])).toEqual([
      [out.decisionId, "still_open"],
      [out.decisionId, "abandoned"],
    ]);
    expect(mem.outcomes[1].actuals).toMatchObject([{ id: "profit", value: $(-15_000) }]);
    // …and nothing they did touched the decision or the scenario it froze.
    expect(mem.decisions).toHaveLength(1);
    expect(JSON.stringify(mem.decisions[0])).toBe(rowBefore);
    expect(JSON.stringify((await getDecision(7, out.decisionId))!.body)).toBe(bodyBefore);
    expect(JSON.stringify(mem.scenarios[0])).toBe(scenarioBefore);
    expect(mem.scenarios).toHaveLength(1);
  });

  it("an outcome cannot be filed against another org's decision (nothing is written)", async () => {
    const out = await subdividerDecision({ reviewDueAt: new Date("2026-12-01T00:00:00Z") });
    await expect(
      recordOutcome(8, {
        decisionSnapshotId: out.decisionId,
        kind: "abandoned",
        summary: "x",
        actuals: [],
        observedAt: new Date("2026-12-02T00:00:00Z"),
      }),
    ).rejects.toThrow(/does not exist for this organization/);
    expect(mem.outcomes).toHaveLength(0);
    expect((await decisionsDueForOutcome(7, ASOF)).map((d) => d.id)).toEqual([out.decisionId]);
  });
});
