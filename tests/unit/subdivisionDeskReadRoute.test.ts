/**
 * Subdivision V1, Leg 4 — GET /api/subdivision/parcels/:id/desk (§6.1–6.3, §5.5).
 *
 * The REAL decisionStore and scenarioStore run; only `db` is faked, and the fake
 * is a small evaluator over the RENDERED SQL: it parses every `"table"."col" = $n`
 * / `in (...)` predicate out of the WHERE and checks it against the seeded row,
 * sorts by the rendered ORDER BY, and honours LIMIT. So a route (or store) that
 * drops an org / parcel / subject predicate, or its ORDER BY, changes what comes
 * back and the test goes red — nothing is shaped by a hand-written filter.
 * The clock is the route's own `server/utils/clock`, pinned to NOW.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { getTableName, type SQL } from "drizzle-orm";

const dialect = new PgDialect();
const render = (x: unknown) => dialect.sqlToQuery(x as SQL);

const NOW = vi.hoisted(() => ({ iso: "2026-11-09T12:00:00.000Z" }));
const world = vi.hoisted(() => ({ rows: {} as Record<string, any[]> }));

vi.mock("../../server/utils/clock", async (orig) => {
  const real = await orig<any>();
  return { ...real, clock: { ...real.clock, now: () => new Date(NOW.iso), nowMs: () => Date.parse(NOW.iso) } };
});

vi.mock("../../server/db", async () => {
  const camel = (s: string) => s.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase());
  const evalWhere = (w: unknown, ctx: Record<string, any>, primary: string): boolean => {
    const { sql: text, params } = render(w);
    const re = /(?:"(\w+)"\.)?"(\w+)" (=|in) (\$\d+|\([^)]*\))/g;
    let m: RegExpExecArray | null;
    let seen = 0;
    while ((m = re.exec(text))) {
      seen++;
      const row = ctx[m[1] ?? primary];
      const v = row?.[camel(m[2])];
      const refs = [...m[4].matchAll(/\$(\d+)/g)].map((x) => params[Number(x[1]) - 1]);
      if (!refs.includes(v)) return false;
    }
    // A WHERE with no parseable predicate would match nothing-checked: refuse to be vacuous.
    if (seen === 0) throw new Error(`fake db could not read any predicate from: ${text}`);
    return true;
  };
  const chain = (rows: any[]) => {
    const p: any = Promise.resolve(rows);
    p.orderBy = (...cols: unknown[]) => {
      const keys = cols.map((c) => {
        const t = render(c).sql;
        const mm = /"(\w+)"(?: (asc|desc))?$/.exec(t.trim());
        if (!mm) throw new Error(`fake db cannot read ORDER BY: ${t}`);
        return { key: camel(mm[1]), dir: mm[2] === "desc" ? -1 : 1 };
      });
      const sorted = [...rows].sort((a, b) => {
        for (const { key, dir } of keys) {
          const av = a[key] instanceof Date ? a[key].getTime() : a[key];
          const bv = b[key] instanceof Date ? b[key].getTime() : b[key];
          if (av < bv) return -dir;
          if (av > bv) return dir;
        }
        return 0;
      });
      return chain(sorted);
    };
    p.limit = (n: number) => chain(rows.slice(0, n));
    return p;
  };
  return {
    db: {
      select: () => ({
        from: (table: unknown) => {
          const name = getTableName(table as any);
          const all = world.rows[name] ?? [];
          return {
            where: (w: unknown) => chain(all.filter((r) => evalWhere(w, { [name]: r }, name))),
            innerJoin: (joined: unknown) => {
              const jn = getTableName(joined as any);
              return {
                where: (w: unknown) =>
                  chain(
                    all.filter((r) =>
                      (world.rows[jn] ?? []).some((j) => j.id === r.checklistId && evalWhere(w, { [name]: r, [jn]: j }, name)),
                    ),
                  ),
              };
            },
          };
        },
      }),
    },
  };
});
vi.mock("../../server/auth", () => ({
  isAuthenticated: (req: any, _res: any, next: any) => {
    req.user = { id: "user_1", claims: { sub: "user_1" } };
    next();
  },
}));
vi.mock("../../server/middleware/getOrCreateOrg", () => ({
  getOrCreateOrg: (req: any, _res: any, next: any) => {
    req.organization = { id: 7 };
    req.organizationId = 7;
    next();
  },
}));
vi.mock("../../server/types/request", async (orig) => ({
  ...(await orig<object>()),
  getUserId: () => "user_1",
  getOrganizationId: (req: any) => req.organizationId,
}));
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { registerSubdivisionDecisionRoutes } from "../../server/routes-subdivision-decision";

type Handler = (req: any, res: any, next: (err?: unknown) => void) => unknown;
const routes = new Map<string, Handler[]>();
const appStub: any = {};
for (const m of ["get", "post", "patch", "put", "delete"]) appStub[m] = (p: string, ...h: Handler[]) => routes.set(`${m.toUpperCase()} ${p}`, h);
registerSubdivisionDecisionRoutes(appStub);

async function getDesk(id: string | number) {
  const req: any = { params: { id: String(id) }, body: undefined, headers: {} };
  const res: any = {
    statusCode: 200,
    body: undefined,
    status(c: number) {
      this.statusCode = c;
      return this;
    },
    json(b: unknown) {
      this.body = b;
      return this;
    },
  };
  for (const h of routes.get("GET /api/subdivision/parcels/:id/desk")!) {
    let next = false;
    await h(req, res, () => {
      next = true;
    });
    if (!next) break;
  }
  return res;
}

const ORG = 7;
const OTHER = 8;
const PARCEL = 42;
const d = (iso: string) => new Date(iso);
const day = (iso: string) => iso.slice(0, 10);

const decisionRow = (over: Record<string, any> = {}) => ({
  id: 1,
  organizationId: ORG,
  subjectType: "property",
  subjectId: PARCEL,
  snapshotVersion: 1,
  kind: "pursue",
  choice: "Proceed to entitlement",
  rationale: "Margin clears our floor on the stated inputs.",
  actorType: "user",
  actorRef: "user_1",
  authority: "org_member:subdivision_decide",
  strategyPackId: "subdivider",
  strategyPackVersion: "1",
  evidenceAsOf: d("2026-10-01T00:00:00Z"),
  resolutionPolicyVersion: "1",
  evidence: [],
  assumptions: [],
  alternatives: [],
  unknowns: [],
  scenarios: [{ scenarioId: 501, label: "s", engineId: "subdivision_feasibility", engineVersion: "1", predicted: [] }],
  reviewDueAt: null,
  decidedAt: d("2026-10-01T00:00:00Z"),
  ...over,
});
const scenarioRow = (id: number, inputs: Record<string, unknown>, over: Record<string, any> = {}) => ({
  id,
  organizationId: ORG,
  shapeVersion: 1,
  subjectType: "property",
  subjectId: PARCEL,
  label: "s",
  engineId: "subdivision_feasibility",
  engineVersion: "1",
  strategyPackId: "subdivider",
  strategyPackVersion: "1",
  inputs,
  assumptions: [],
  metrics: [],
  computedAt: d("2026-10-01T00:00:00Z"),
  ...over,
});
const checklist = (id: number, org: number, parcel = PARCEL) => ({ id, organizationId: org, parentParcelId: parcel });
const gate = (id: number, checklistId: number, org: number, seq: number, status: string, expectedReturnAt: string | null) => ({
  id,
  checklistId,
  organizationId: org,
  gateKey: `gate_${id}`,
  label: `Gate ${id}`,
  sequence: seq,
  status,
  expectedReturnAt,
});

beforeEach(() => {
  NOW.iso = "2026-11-09T12:00:00.000Z";
  world.rows = {
    properties: [{ id: PARCEL, organizationId: ORG, address: "12 Ridge Rd", county: "Pima", state: "AZ", apn: "123-45", parentParcelId: null }],
    subdivision_screen_runs: [],
    decision_snapshots: [],
    scenarios: [],
    outcomes: [],
    lot_pricing_rules: [],
    permit_checklists: [],
    permit_gates: [],
  };
});

describe("GET /api/subdivision/parcels/:id/desk — tenancy", () => {
  it("a parcel owned by another org → 404 and the payload carries nothing from it", async () => {
    world.rows.properties = [{ id: PARCEL, organizationId: OTHER, address: "SECRET ST", county: "X", state: "AZ", apn: "9", parentParcelId: null }];
    world.rows.subdivision_screen_runs = [{ id: 1, organizationId: OTHER, parentParcelId: PARCEL, createdAt: d("2026-10-01T00:00:00Z"), ruleVersion: "v", triggeredCount: 1, notDeterminableCount: 1, result: { headline: "SECRET" }, yieldEstimate: null }];
    world.rows.decision_snapshots = [decisionRow({ organizationId: OTHER })];
    const res = await getDesk(PARCEL);
    expect(res.statusCode).toBe(404);
    expect(res.body.statusCode).toBe(404);
    expect(JSON.stringify(res.body)).not.toMatch(/SECRET|latestScreenRun|decisions|pricingLocks|criticalPath/);
  });
});

describe("GET /api/subdivision/parcels/:id/desk — latestScreenRun", () => {
  it("returns the NEWEST run only, with headline, counts, rule version and yieldEstimate passed through", async () => {
    const yieldEstimate = { yield: { low: { value: 8, refusedReason: null, basis: "b-low" }, high: { value: 10, refusedReason: null, basis: "b-high" } } };
    const run = (id: number, createdAt: string, over: Record<string, any> = {}) => ({
      id,
      organizationId: ORG,
      parentParcelId: PARCEL,
      createdAt: d(createdAt),
      ruleVersion: "buildability-screen v1",
      triggeredCount: 1,
      notDeterminableCount: 1,
      result: { headline: "OLD HEADLINE" },
      yieldEstimate: null,
      ...over,
    });
    world.rows.subdivision_screen_runs = [
      run(11, "2026-09-01T00:00:00Z"),
      run(12, "2026-10-15T00:00:00Z", { ruleVersion: "buildability-screen v2", triggeredCount: 2, notDeterminableCount: 3, result: { headline: "2 triggers fired; 3 not determinable" }, yieldEstimate }),
      run(13, "2026-10-20T00:00:00Z", { organizationId: OTHER, result: { headline: "OTHER ORG" } }),
    ];
    const res = await getDesk(PARCEL);
    expect(res.statusCode).toBe(200);
    expect(res.body.latestScreenRun).toEqual({
      id: 12,
      createdAt: "2026-10-15T00:00:00.000Z",
      ruleVersion: "buildability-screen v2",
      triggeredCount: 2,
      notDeterminableCount: 3,
      headline: "2 triggers fired; 3 not determinable",
      yieldEstimate,
    });
    expect(JSON.stringify(res.body)).not.toMatch(/OLD HEADLINE|OTHER ORG/);
  });

  it("no run on record → latestScreenRun is null", async () => {
    expect((await getDesk(PARCEL)).body.latestScreenRun).toBeNull();
  });
});

describe("GET /api/subdivision/parcels/:id/desk — decisions", () => {
  it("only this org's subdivider pursue/pass on THIS parcel, newest first, with frozen scenarioIds + reviewDueAt", async () => {
    world.rows.decision_snapshots = [
      decisionRow({ id: 1, decidedAt: d("2026-09-01T00:00:00Z"), kind: "pass", choice: "Pass", scenarios: [{ scenarioId: 500 }] }),
      decisionRow({ id: 2, decidedAt: d("2026-10-01T00:00:00Z"), reviewDueAt: d("2026-12-01T00:00:00Z"), scenarios: [{ scenarioId: 501 }, { scenarioId: 502 }] }),
      decisionRow({ id: 3, decidedAt: d("2026-10-05T00:00:00Z"), kind: "price", choice: "Lock grid", strategyPackId: "subdivider", scenarios: [] }), // price-kind lock snapshot
      decisionRow({ id: 4, decidedAt: d("2026-10-06T00:00:00Z"), subjectId: 999 }), // another parcel
      decisionRow({ id: 5, decidedAt: d("2026-10-07T00:00:00Z"), organizationId: OTHER }), // another org
      decisionRow({ id: 6, decidedAt: d("2026-10-08T00:00:00Z"), strategyPackId: "flip", kind: "pursue" }), // another pack
    ];
    const res = await getDesk(PARCEL);
    expect(res.statusCode).toBe(200);
    expect(res.body.decisions).toEqual([
      {
        id: 2,
        decidedAt: "2026-10-01T00:00:00.000Z",
        kind: "pursue",
        choice: "Proceed to entitlement",
        rationale: "Margin clears our floor on the stated inputs.",
        reviewDueAt: "2026-12-01T00:00:00.000Z",
        scenarioIds: [501, 502],
        hasOutcome: false,
      },
      {
        id: 1,
        decidedAt: "2026-09-01T00:00:00.000Z",
        kind: "pass",
        choice: "Pass",
        rationale: "Margin clears our floor on the stated inputs.",
        reviewDueAt: null,
        scenarioIds: [500],
        hasOutcome: false,
      },
    ]);
    expect(res.body.decisions.map((x: any) => x.id)).not.toContain(3);
    expect(res.body.decisions.map((x: any) => x.id)).not.toContain(4);
  });

  it("hasOutcome is false before an outcome row exists and true after — for that decision only, and only this org's outcome counts", async () => {
    world.rows.decision_snapshots = [
      decisionRow({ id: 1, decidedAt: d("2026-09-01T00:00:00Z") }),
      decisionRow({ id: 2, decidedAt: d("2026-10-01T00:00:00Z") }),
    ];
    const before = await getDesk(PARCEL);
    expect(before.body.decisions.map((x: any) => [x.id, x.hasOutcome])).toEqual([[2, false], [1, false]]);

    world.rows.outcomes = [{ id: 1, organizationId: OTHER, decisionSnapshotId: 2 }]; // other org's outcome: must not grade it
    const foreign = await getDesk(PARCEL);
    expect(foreign.body.decisions.map((x: any) => [x.id, x.hasOutcome])).toEqual([[2, false], [1, false]]);

    world.rows.outcomes = [{ id: 2, organizationId: ORG, decisionSnapshotId: 1 }];
    const after = await getDesk(PARCEL);
    expect(after.body.decisions.map((x: any) => [x.id, x.hasOutcome])).toEqual([[2, false], [1, true]]);
  });
});

describe("GET /api/subdivision/parcels/:id/desk — pricingLocks", () => {
  it("only locked grids appear; lotCount = grid length; total = exact sum; grading is ungraded_pricing_act, note names no scenario/review date", async () => {
    const lock = (id: number, lockedAt: string | null, lockedGrid: any, over: Record<string, any> = {}) => ({
      id,
      organizationId: ORG,
      parentParcelId: PARCEL,
      lockedAt: lockedAt ? d(lockedAt) : null,
      lockedGrid,
      lockedDecisionSnapshotId: 77,
      ...over,
    });
    world.rows.lot_pricing_rules = [
      lock(1, "2026-10-01T00:00:00Z", [{ askingPriceCents: 10_000_00 }, { askingPriceCents: 12_550_00 }, { askingPriceCents: 7_499_99 }]),
      lock(2, null, null, { lockedDecisionSnapshotId: null }), // rules saved, never locked
      lock(3, "2026-10-09T00:00:00Z", [{ askingPriceCents: 5_000_00 }], { lockedDecisionSnapshotId: 78 }),
      lock(4, "2026-10-10T00:00:00Z", [{ askingPriceCents: 99_999_00 }], { organizationId: OTHER }),
    ];
    const res = await getDesk(PARCEL);
    expect(res.statusCode).toBe(200);
    const note =
      "A pricing act, not an outcome-graded decision: the lock's record cites no scenario and carries no review date, by design (package §6.2).";
    expect(res.body.pricingLocks).toEqual([
      { id: 3, lockedAt: "2026-10-09T00:00:00.000Z", lotCount: 1, totalAskingCents: 500_000, decisionSnapshotId: 78, grading: "ungraded_pricing_act", gradingNote: note },
      { id: 1, lockedAt: "2026-10-01T00:00:00.000Z", lotCount: 3, totalAskingCents: 1_000_000 + 1_255_000 + 749_999, decisionSnapshotId: 77, grading: "ungraded_pricing_act", gradingNote: note },
    ]);
    expect(res.body.pricingLocks[1].totalAskingCents).toBe(3_004_999);
    for (const l of res.body.pricingLocks) {
      expect(l.gradingNote).toMatch(/cites no scenario and carries no review date/);
      expect(l).not.toHaveProperty("scenarioIds");
      expect(l).not.toHaveProperty("reviewDueAt");
    }
  });
});

describe("GET /api/subdivision/parcels/:id/desk — criticalPath", () => {
  // Decision recorded 2026-10-01; clock pinned at 2026-11-09 → 39 elapsed days.
  const seedTimeline = (inputs: Record<string, unknown>) => {
    world.rows.decision_snapshots = [decisionRow({ id: 2, decidedAt: d("2026-10-01T00:00:00Z"), scenarios: [{ scenarioId: 501 }] })];
    world.rows.scenarios = [scenarioRow(501, inputs), scenarioRow(502, { timelineP50Days: 1, timelineP90Days: 2 })];
  };

  it("computed against the cited scenario's frozen p50/p90, exact position/elapsed/dates, gates counted across checklists", async () => {
    seedTimeline({ timelineP50Days: 30, timelineP90Days: 60 });
    world.rows.permit_checklists = [checklist(1, ORG), checklist(2, ORG)];
    world.rows.permit_gates = [
      gate(1, 1, ORG, 1, "approved", "2026-10-20"),
      gate(2, 1, ORG, 2, "submitted", "2026-11-01"), // open, overdue 8 days at 2026-11-09
      gate(3, 2, ORG, 3, "in_review", "2026-12-15"), // open, latest return
      gate(4, 2, ORG, 4, "skipped", null),
    ];
    const res = await getDesk(PARCEL);
    expect(res.statusCode).toBe(200);
    expect(res.body.criticalPath).toEqual({
      state: "computed",
      elapsedDays: 39,
      p50EndDate: "2026-10-31",
      p90EndDate: "2026-11-30",
      position: "between_p50_p90",
      completedGateCount: 2,
      openGateCount: 2,
      slippedGates: [{ gateKey: "gate_2", label: "Gate 2", sequence: 2, expectedReturnAt: "2026-11-01", daysOverdue: 8 }],
      projectedFinish: "2026-12-15",
      projectedFinishWithheldReason: null,
      overrunVsP90Days: 15,
    });
  });

  it("the position moves with the controlled clock (within_p50 early, past_p90 late)", async () => {
    seedTimeline({ timelineP50Days: 30, timelineP90Days: 60 });
    NOW.iso = "2026-10-11T12:00:00.000Z";
    const early = await getDesk(PARCEL);
    expect(early.body.criticalPath).toMatchObject({ state: "computed", elapsedDays: 10, position: "within_p50" });
    NOW.iso = "2026-12-20T12:00:00.000Z";
    const late = await getDesk(PARCEL);
    expect(late.body.criticalPath).toMatchObject({ state: "computed", elapsedDays: 80, position: "past_p90" });
  });

  it("another org's checklist/gates for the same parcel id never enter the computation (org-scoped join)", async () => {
    seedTimeline({ timelineP50Days: 30, timelineP90Days: 60 });
    world.rows.permit_checklists = [checklist(1, ORG), checklist(9, OTHER)];
    world.rows.permit_gates = [
      gate(1, 1, ORG, 1, "submitted", "2026-12-01"),
      gate(10, 9, OTHER, 2, "approved", "2026-10-02"), // foreign checklist + foreign gate
      gate(11, 9, OTHER, 3, "submitted", "2027-06-01"), // would move projectedFinish and openGateCount
      gate(12, 1, OTHER, 4, "submitted", "2027-07-01"), // foreign gate row hung on OUR checklist
      gate(13, 9, ORG, 5, "submitted", "2027-08-01"), // our gate row hung on a FOREIGN checklist
    ];
    const res = await getDesk(PARCEL);
    expect(res.body.criticalPath).toMatchObject({
      state: "computed",
      completedGateCount: 0,
      openGateCount: 1,
      projectedFinish: "2026-12-01",
      overrunVsP90Days: 1,
    });
    expect(res.body.criticalPath.slippedGates).toEqual([]);
  });

  it("another parcel's checklist in the same org is excluded too", async () => {
    seedTimeline({ timelineP50Days: 30, timelineP90Days: 60 });
    world.rows.permit_checklists = [checklist(1, ORG), checklist(3, ORG, 999)];
    world.rows.permit_gates = [gate(1, 1, ORG, 1, "submitted", "2026-12-01"), gate(2, 3, ORG, 2, "submitted", "2027-05-01")];
    const res = await getDesk(PARCEL);
    expect(res.body.criticalPath).toMatchObject({ openGateCount: 1, projectedFinish: "2026-12-01" });
  });

  it("no decision → withheld (even with gates on record), stating why", async () => {
    world.rows.permit_checklists = [checklist(1, ORG)];
    world.rows.permit_gates = [gate(1, 1, ORG, 1, "submitted", "2026-12-01")];
    const res = await getDesk(PARCEL);
    expect(res.body.decisions).toEqual([]);
    expect(res.body.criticalPath).toEqual({
      state: "withheld",
      reason: "No subdivision decision has been recorded for this parcel yet, so there is no stated timeline to measure against.",
    });
  });

  it("a decision whose cited scenario stated no timeline → withheld; no timeline is assumed", async () => {
    seedTimeline({ landCostCents: 1 }); // no timelineP50Days / timelineP90Days
    const res = await getDesk(PARCEL);
    expect(res.body.decisions).toHaveLength(1);
    expect(res.body.criticalPath).toEqual({
      state: "withheld",
      reason: "The decision on record stated no timeline (p50 and p90), so there is nothing to measure elapsed time against. No timeline is assumed.",
    });
  });

  it("a timeline stated only on a scenario the decision does NOT cite is not used (withheld)", async () => {
    world.rows.decision_snapshots = [decisionRow({ id: 2, scenarios: [{ scenarioId: 501 }] })];
    world.rows.scenarios = [scenarioRow(501, {}), scenarioRow(502, { timelineP50Days: 30, timelineP90Days: 60 })];
    const res = await getDesk(PARCEL);
    expect(res.body.criticalPath.state).toBe("withheld");
  });
});
