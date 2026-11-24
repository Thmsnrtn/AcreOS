/**
 * Subdivision V1, Leg 1 — the screen routes (server/routes-subdivision-screen.ts).
 * §8.1 test 4 (append-only + idempotence) and §8.4 test 17 (cross-tenant):
 *   - a run INSERTS one row computed by the shared modules; two runs over the
 *     same facts are two rows with identical verdicts; a changed fact appends a
 *     third whose changed verdict cites the new fact;
 *   - no route updates or deletes a run (the module is scanned for the shapes);
 *   - another org's parcel is a 404 with nothing written;
 *   - the perc-estimate slot refuses any value (§3.4);
 *   - the history read is org-scoped and puts the newest run's estimate beside
 *     the drawn plans, writing nothing.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { REPO_SWEEP_TIMEOUT_MS, stripComments } from "../helpers/stripComments";

// The no-update scan strips every server/ file: a repo sweep declares its budget.
vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const dialect = new PgDialect();
const rendered = (w: unknown) => dialect.sqlToQuery(w as SQL);

const state = {
  readRows: [] as unknown[][],
  reads: [] as Array<{ table: unknown; where: unknown }>,
  inserts: [] as Array<{ table: unknown; values: Record<string, unknown> }>,
};

vi.mock("../../server/db", () => {
  const chain = (rows: unknown[]) => {
    const p = Promise.resolve(rows) as Promise<unknown[]> & Record<string, unknown>;
    p.orderBy = () => chain(rows);
    p.limit = () => Promise.resolve(rows);
    return p;
  };
  return {
    db: {
      select: () => ({
        from: (table: unknown) => ({
          where: (w: unknown) => {
            const i = state.reads.length;
            state.reads.push({ table, where: w });
            return chain(state.readRows[i] ?? []);
          },
        }),
      }),
      insert: (table: unknown) => ({
        values: (values: Record<string, unknown>) => ({
          returning: async () => {
            state.inserts.push({ table, values });
            return [{ id: state.inserts.length, ...values }];
          },
        }),
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

import { registerSubdivisionScreenRoutes } from "../../server/routes-subdivision-screen";
import { properties, subdivisionPlans, subdivisionScreenRuns } from "@shared/schema";
import { runBuildabilityScreen } from "../../shared/subdivision/buildabilityScreen";
import { estimateLotYield } from "../../shared/subdivision/lotYield";

type Handler = (req: any, res: any, next: (err?: unknown) => void) => unknown;
const routes = new Map<string, Handler[]>();
const appStub: any = {};
for (const m of ["get", "post", "patch", "put", "delete"]) appStub[m] = (p: string, ...h: Handler[]) => routes.set(`${m.toUpperCase()} ${p}`, h);
registerSubdivisionScreenRoutes(appStub);

async function call(method: "GET" | "POST", p: string, id: string, body?: unknown) {
  const req: any = { params: { id }, body, headers: {} };
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
  for (const h of routes.get(`${method} ${p}`)!) {
    let next = false;
    await h(req, res, () => {
      next = true;
    });
    if (!next) break;
  }
  return res;
}

const BODY = {
  facts: {
    legalAccess: { value: "recorded_access", source: "deed book 1234" },
    floodwayAcres: { value: 0, source: "FEMA panel" },
    floodplainAcres: { value: 0, source: "FEMA panel" },
    percResult: { value: "fail", source: "perc test by A. Soil", asOf: "2026-09-12" },
  },
  thresholds: { floodplainShareMax: 0.2 },
  yield: { easementAcres: { value: 0, source: "title" }, unbuildableSlopeAcres: { value: 0, source: "topo" }, roadsRowFraction: 0.1, minimumLot: { acres: 1, citation: "regs" } },
};

beforeEach(() => {
  state.readRows = [];
  state.reads = [];
  state.inserts = [];
});

describe("POST /api/parcels/:id/screen", () => {
  it("is registered behind isAuthenticated + getOrCreateOrg; there is no PATCH/PUT/DELETE on screen runs", () => {
    expect(routes.get("POST /api/parcels/:id/screen")).toHaveLength(3);
    expect(routes.get("GET /api/parcels/:id/screen-runs")).toHaveLength(3);
    expect([...routes.keys()].sort()).toEqual(["GET /api/parcels/:id/screen-runs", "POST /api/parcels/:id/screen"]);
  });

  it("appends ONE row computed by the shared modules, org-scoped, actor recorded", async () => {
    state.readRows = [[{ id: 42, sizeAcres: "20", parentParcelId: null }], [{ id: "p1", name: "Plan A", lotCount: 12 }]];
    const res = await call("POST", "/api/parcels/:id/screen", "42", BODY);
    expect(res.statusCode).toBe(200);
    expect(state.inserts).toHaveLength(1);
    const row = state.inserts[0];
    expect(row.table).toBe(subdivisionScreenRuns);
    expect(row.values).toMatchObject({ organizationId: 7, parentParcelId: 42, ruleVersion: "buildability-screen v1", actorRef: "user_1" });
    const inputs = row.values.inputs as any;
    expect(row.values.yieldEstimate).toEqual(estimateLotYield(inputs.yieldInputs));
    expect(row.values.result).toEqual(runBuildabilityScreen(inputs.facts, inputs.thresholds, row.values.yieldEstimate as never));
    // The parcel record's acreage is used, labelled as exactly that.
    expect(inputs.facts.grossAcres).toEqual({ value: 20, source: "the parcel record's acreage (no source recorded on it)", asOf: null });
    expect((row.values.result as any).triggered).toEqual(["septic"]);
    expect(rendered(state.reads[0].where)).toEqual(rendered(and(eq(properties.id, 42), eq(properties.organizationId, 7))));
    // §4.2: the drawn counts as they stood at the run are FROZEN on the record (org-scoped read).
    expect(inputs.drawnPlansAtRun).toEqual([{ planId: "p1", name: "Plan A", lotCount: 12 }]);
    expect(rendered(state.reads[1].where)).toEqual(rendered(and(eq(subdivisionPlans.organizationId, 7), eq(subdivisionPlans.parentParcelId, 42))));
  });

  it("a child lot is refused (screen its parent); a non-numeric id is refused — both before anything is written", async () => {
    state.readRows = [[{ id: 43, sizeAcres: "1", parentParcelId: 42 }]];
    expect((await call("POST", "/api/parcels/:id/screen", "43", BODY)).statusCode).toBe(400);
    expect((await call("POST", "/api/parcels/:id/screen", "42abc", BODY)).statusCode).toBe(400);
    expect(state.inserts).toHaveLength(0);
  });

  it("§8.1 test 4: same facts twice → two rows, identical verdicts; a changed fact → a third whose changed verdict cites it", async () => {
    for (let i = 0; i < 3; i++) state.readRows.push([{ id: 42, sizeAcres: "20", parentParcelId: null }], []);
    await call("POST", "/api/parcels/:id/screen", "42", BODY);
    await call("POST", "/api/parcels/:id/screen", "42", BODY);
    const changed = { ...BODY, facts: { ...BODY.facts, sewerAvailable: { value: true, source: "utility letter 2026-11-04" } } };
    await call("POST", "/api/parcels/:id/screen", "42", changed);
    expect(state.inserts).toHaveLength(3);
    const [a, b, c] = state.inserts.map((x) => x.values.result as any);
    expect(b.verdicts).toEqual(a.verdicts);
    const septic = (r: any) => r.verdicts.find((v: any) => v.id === "septic");
    expect(septic(a).verdict).toBe("triggered");
    expect(septic(c).verdict).toBe("clear_on_evidence");
    expect(septic(c).evidence).toContainEqual({ fact: "public sewer available", value: "true", source: "utility letter 2026-11-04", asOf: null });
  });

  it("another org's parcel (or none): 404, nothing written", async () => {
    state.readRows = [[]];
    const res = await call("POST", "/api/parcels/:id/screen", "42", BODY);
    expect(res.statusCode).toBe(404);
    expect(state.inserts).toHaveLength(0);
  });

  it("§3.4: a perc estimate is refused in any form, before anything is read or written", async () => {
    for (const percEstimate of [{ estimate: 0.7, basis: "x", calibrationState: "y" }, 0.7]) {
      const res = await call("POST", "/api/parcels/:id/screen", "42", { ...BODY, facts: { ...BODY.facts, percEstimate } });
      expect(res.statusCode).toBe(422);
    }
    // An unknown fact key (a would-be synonym) is refused too: the facts object is strict.
    const res = await call("POST", "/api/parcels/:id/screen", "42", { ...BODY, facts: { ...BODY.facts, percPassRate: 0.7 } });
    expect(res.statusCode).toBe(422);
    expect(state.reads).toHaveLength(0);
    expect(state.inserts).toHaveLength(0);
  });

  it("a fact without its source is refused (a fact counts only with where it came from)", async () => {
    const res = await call("POST", "/api/parcels/:id/screen", "42", { ...BODY, facts: { legalAccess: { value: "recorded_access", source: "" } } });
    expect(res.statusCode).toBe(422);
  });
});

describe("GET /api/parcels/:id/screen-runs", () => {
  it("reads org-scoped runs and puts the newest run's estimate beside the drawn plans, writing nothing", async () => {
    const y = estimateLotYield({ grossAcres: { value: 13.5, source: "s", asOf: null }, floodwayAcres: { value: 0, source: "s", asOf: null }, easementAcres: { value: 0, source: "s", asOf: null }, unbuildableSlopeAcres: { value: 0, source: "s", asOf: null }, roadsRowFraction: 0.1, minimumLot: { acres: 1.2, citation: "c" }, targetLotAcres: 1.5 });
    // The run froze Plan A at 12; today it has been redrawn to 9. Both survive.
    state.readRows = [[{ id: 9, yieldEstimate: y, inputs: { drawnPlansAtRun: [{ planId: "p1", name: "Plan A", lotCount: 12 }] } }], [{ id: "p1", name: "Plan A", lotCount: 9 }]];
    const res = await call("GET", "/api/parcels/:id/screen-runs", "42");
    expect(res.body.runs[0].reconciliationAtRun[0]).toMatchObject({ drawn: 12, estimateLow: 8, estimateHigh: 10, relation: "above_range" });
    expect(res.body.latestReconciliation[0]).toMatchObject({ drawn: 9, relation: "within_range" });
    expect(res.body.truncated).toBe(false);
    expect(rendered(state.reads[0].where)).toEqual(rendered(and(eq(subdivisionScreenRuns.organizationId, 7), eq(subdivisionScreenRuns.parentParcelId, 42))));
    expect(rendered(state.reads[1].where)).toEqual(rendered(and(eq(subdivisionPlans.organizationId, 7), eq(subdivisionPlans.parentParcelId, 42))));
    expect(state.inserts).toHaveLength(0);
  });

  it("no runs: an empty history and no plan read", async () => {
    state.readRows = [[]];
    const res = await call("GET", "/api/parcels/:id/screen-runs", "42");
    expect(res.body).toEqual({ runs: [], latestReconciliation: [], truncated: false });
    expect(state.reads).toHaveLength(1);
  });
});

describe("no update or delete path on a screen run, anywhere in server/ or scripts/", () => {
  const TABLE_REF = /\bsubdivisionScreenRuns\b|subdivision_screen_runs/;
  // Any reference to the table in a write-shaped call: Drizzle update/delete
  // (direct, aliased or via a schema namespace) or raw SQL in any quoting.
  const WRITE_SHAPES = [
    /\b(?:update|delete)\s*\(\s*(?:[\w$]+\.)?subdivisionScreenRuns\b/,
    /\b(?:UPDATE|DELETE\s+FROM|TRUNCATE(?:\s+TABLE)?)\s+["`]?\$?\{?\s*(?:[\w$]+\.)?(?:subdivision_screen_runs|subdivisionScreenRuns)\b/i,
  ];
  const walk = (d: string, out: string[]) => {
    for (const n of readdirSync(d)) {
      const p = path.join(d, n);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (/\.(?:ts|mjs|js)$/.test(p) && !/\.test\.ts$/.test(p)) out.push(p);
    }
    return out;
  };
  const files = [...walk(path.join(__dirname, "../../server"), []), ...walk(path.join(__dirname, "../../scripts"), [])];

  it("no file updates, deletes or truncates the table (comments stripped)", () => {
    expect(files.length).toBeGreaterThan(600);
    const offenders = files.filter((p) => {
      const src = stripComments(readFileSync(p, "utf8"));
      return TABLE_REF.test(src) && WRITE_SHAPES.some((re) => re.test(src));
    });
    expect(offenders).toEqual([]);
  });

  it("an import alias is caught: any module that imports the table under another name fails", () => {
    const aliasers = files.filter((p) => /subdivisionScreenRuns\s+as\s+\w+/.test(stripComments(readFileSync(p, "utf8"))));
    expect(aliasers).toEqual([]);
  });

  it("canaries: each write shape is detected", () => {
    for (const src of [
      "db.update(subdivisionScreenRuns).set({})",
      "db.delete(schema.subdivisionScreenRuns)",
      "sql`DELETE FROM ${subdivisionScreenRuns}`",
      'db.execute(sql`UPDATE "subdivision_screen_runs" SET x = 1`)',
      "TRUNCATE subdivision_screen_runs",
    ]) {
      expect(WRITE_SHAPES.some((re) => re.test(src)), src).toBe(true);
    }
  });

  it("vacuity: the one writer is found, and it only inserts", () => {
    const writers = files.filter((p) => /\binsert\(\s*subdivisionScreenRuns\b/.test(stripComments(readFileSync(p, "utf8"))));
    expect(writers.map((p) => path.basename(p))).toEqual(["routes-subdivision-screen.ts"]);
  });
});
