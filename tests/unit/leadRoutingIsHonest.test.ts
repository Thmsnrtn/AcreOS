/**
 * Lead routing (W2-TEAM light-up) — the rules the Settings card now reaches
 * do what the page says, and nothing more.
 *
 * Driven through the REAL assigner (server/services/leadAssigner.ts) and the
 * REAL route handlers (server/routes-team-readiness.ts) over a fake database
 * that renders every WHERE clause Drizzle builds (PgDialect) and evaluates it
 * against fixture rows. A dropped organization predicate therefore changes
 * which rows come back — the fake never ignores a predicate, and throws on
 * any shape it cannot evaluate rather than matching everything.
 *
 * Pinned:
 *   - round robin takes one turn per real lead, and the turn is claimed by
 *     one statement (insert-or-increment);
 *   - "Test with a sample lead" is a dry run — it takes no turn and writes
 *     nothing (it used to advance the cursor, changing who got the next
 *     real lead);
 *   - a dry run that fails is an error, not "no rule matched";
 *   - territory matching ignores case and stray spaces;
 *   - a rule may only name this organization's team members, and assignment
 *     never lands on another organization's member;
 *   - the endpoint the client constant names is the one the server serves.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { LEAD_ASSIGNMENT_RULES_API } from "../../client/src/lib/lead-routing";

const F = vi.hoisted(() => ({
  rows: {} as Record<string, Array<Record<string, any>>>,
  writes: [] as Array<{ op: string; table: string }>,
  failRulesRead: false,
  seq: 1000,
}));

vi.mock("../../server/storage", async () => {
  const { getTableName, getTableColumns } = await import("drizzle-orm");
  const { PgDialect } = await import("drizzle-orm/pg-core");
  const dialect = new PgDialect();
  const name = (t: any) => getTableName(t);
  const propsOf = (t: any) => {
    const m = new Map<string, string>();
    for (const [prop, col] of Object.entries(getTableColumns(t))) m.set((col as any).name, prop);
    return m;
  };
  const isSql = (v: any) => v && typeof v === "object" && "queryChunks" in v;

  function matcher(t: any, where: any): (r: Record<string, any>) => boolean {
    if (!where) return () => true;
    const { sql, params } = dialect.sqlToQuery(where);
    const tn = name(t);
    const props = propsOf(t);
    const body = sql.startsWith("(") && sql.endsWith(")") ? sql.slice(1, -1) : sql;
    const checks = body.split(" and ").map((part) => {
      const e = part.match(/^"(\w+)"\."(\w+)" = \$(\d+)$/);
      if (e && e[1] === tn) {
        const p = props.get(e[2])!;
        const v = params[Number(e[3]) - 1];
        return (r: Record<string, any>) => r[p] === v;
      }
      const i = part.match(/^"(\w+)"\."(\w+)" in \(([^)]*)\)$/);
      if (i && i[1] === tn) {
        const p = props.get(i[2])!;
        const vs = i[3].split(", ").map((x) => params[Number(x.slice(1)) - 1]);
        return (r: Record<string, any>) => vs.includes(r[p]);
      }
      throw new Error(`fake db cannot evaluate predicate: ${part}`);
    });
    return (r) => checks.every((c) => c(r));
  }
  const project = (t: any, row: Record<string, any>, fields?: Record<string, any>) => {
    if (!fields) return { ...row };
    const props = propsOf(t);
    return Object.fromEntries(Object.entries(fields).map(([alias, col]) => [alias, row[props.get(col.name)!]]));
  };
  const thenable = (q: any, run: () => unknown) => {
    q.then = (res: any, rej: any) => {
      let p: Promise<unknown>;
      try {
        p = Promise.resolve(run());
      } catch (err) {
        p = Promise.reject(err);
      }
      return p.then(res, rej);
    };
    return q;
  };

  function select(fields?: Record<string, any>) {
    let table: any;
    let where: any;
    let order: any;
    const run = () => {
      if (F.failRulesRead && name(table) === "lead_assignment_rules") throw new Error("connection reset");
      let rows = (F.rows[name(table)] ?? []).filter(matcher(table, where));
      if (order) {
        const { sql } = dialect.sqlToQuery(order);
        const m = sql.match(/^"\w+"\."(\w+)" (asc|desc)$/);
        if (!m) throw new Error(`fake db cannot order by: ${sql}`);
        const p = propsOf(table).get(m[1])!;
        rows = [...rows].sort((a, b) => (a[p] - b[p]) * (m[2] === "asc" ? 1 : -1));
      }
      return rows.map((r) => project(table, r, fields));
    };
    const q: any = {
      from: (t: any) => ((table = t), q),
      where: (w: any) => ((where = w), q),
      orderBy: (o: any) => ((order = o), q),
    };
    return thenable(q, run);
  }

  function insert(table: any) {
    let values: any;
    let conflict: any;
    const run = (fields?: Record<string, any>) => {
      const tn = name(table);
      F.writes.push({ op: "insert", table: tn });
      const list = (F.rows[tn] ??= []);
      const props = propsOf(table);
      const v = Array.isArray(values) ? values[0] : values;
      if (conflict) {
        const key = props.get(conflict.target.name)!;
        const existing = list.find((r) => r[key] === v[key]);
        if (existing) {
          for (const [k, val] of Object.entries(conflict.set)) {
            if (isSql(val)) {
              const { sql } = dialect.sqlToQuery(val as any);
              const m = sql.match(/^"\w+"\."(\w+)" \+ (\d+)$/);
              if (!m) throw new Error(`fake db cannot evaluate set: ${sql}`);
              const p = props.get(m[1])!;
              existing[p] = existing[p] + Number(m[2]);
            } else existing[k] = val;
          }
          return [project(table, existing, fields)];
        }
      }
      const row = { id: F.seq++, ...v };
      list.push(row);
      return [project(table, row, fields)];
    };
    const q: any = {
      values: (v: any) => ((values = v), q),
      onConflictDoUpdate: (c: any) => ((conflict = c), q),
      returning: (fields?: Record<string, any>) => Promise.resolve().then(() => run(fields)),
    };
    return thenable(q, () => void run());
  }

  function update(table: any) {
    let setv: any;
    let where: any;
    const run = (fields?: Record<string, any>) => {
      F.writes.push({ op: "update", table: name(table) });
      const rows = (F.rows[name(table)] ?? []).filter(matcher(table, where));
      for (const r of rows) Object.assign(r, setv);
      return rows.map((r) => project(table, r, fields));
    };
    const q: any = {
      set: (v: any) => ((setv = v), q),
      where: (w: any) => ((where = w), q),
      returning: (fields?: Record<string, any>) => Promise.resolve().then(() => run(fields)),
    };
    return thenable(q, () => void run());
  }

  return { db: { select, insert, update }, storage: { createAuditLogEntry: async () => undefined } };
});
vi.mock("../../server/auth", () => ({
  isAuthenticated: (req: any, _res: unknown, next: () => void) => {
    req.user = { id: "user-1" };
    next();
  },
}));
vi.mock("../../server/middleware/getOrCreateOrg", () => ({
  getOrCreateOrg: (req: any, _res: unknown, next: () => void) => {
    req.organization = { id: 7, subscriptionTier: "pro", seatCount: 3 };
    req.organizationId = 7;
    next();
  },
}));
vi.mock("../../server/utils/permissions", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("../../server/utils/permissions");
  const pass = () => (_req: unknown, _res: unknown, next: () => void) => next();
  return { ...actual, requireAdminOrAbove: pass, requireOwner: pass, requirePermission: pass, attachPermissionContext: pass };
});

import { assignLead } from "../../server/services/leadAssigner";
import { registerTeamReadinessRoutes } from "../../server/routes-team-readiness";

function app() {
  const a = express();
  a.use(express.json());
  registerTeamReadinessRoutes(a);
  return a;
}

const rule = (over: Record<string, unknown> = {}) => ({
  id: 5,
  organizationId: 7,
  name: "Take turns",
  ruleType: "round_robin",
  priority: 100,
  territoryFilter: null,
  weightedAssignees: [
    { teamMemberId: 11, weight: 1 },
    { teamMemberId: 12, weight: 1 },
  ],
  isDefault: false,
  isActive: true,
  ...over,
});

const cursorWrites = () => F.writes.filter((w) => w.table === "org_assignment_cursor").length;
const cursor = () => F.rows.org_assignment_cursor.find((r) => r.ruleId === 5)?.cursorIndex;

beforeEach(() => {
  F.rows = {
    team_members: [
      { id: 11, organizationId: 7, isActive: true },
      { id: 12, organizationId: 7, isActive: true },
      { id: 13, organizationId: 7, isActive: false },
      { id: 99, organizationId: 8, isActive: true },
    ],
    lead_assignment_rules: [],
    org_assignment_cursor: [],
  };
  F.writes = [];
  F.failRulesRead = false;
});

describe("round robin", () => {
  it("takes one turn per real lead, in order", async () => {
    F.rows.lead_assignment_rules.push(rule());
    const picks = [];
    for (let i = 0; i < 3; i++) picks.push(await assignLead(7, {}));
    expect(picks).toEqual([11, 12, 11]);
    expect(cursor()).toBe(3);
  });

  it("a dry run names the next teammate and takes no turn", async () => {
    F.rows.lead_assignment_rules.push(rule());
    expect(await assignLead(7, {})).toBe(11);
    const before = cursorWrites();
    expect(await assignLead(7, {}, { dryRun: true })).toBe(12);
    expect(await assignLead(7, {}, { dryRun: true })).toBe(12);
    expect(cursorWrites(), "a dry run wrote the cursor").toBe(before);
    expect(cursor()).toBe(1);
    expect(await assignLead(7, {}), "the dry runs used up a turn").toBe(12);
  });
});

describe("POST /test is a dry run through the real route", () => {
  it("answers the same teammate twice and writes nothing", async () => {
    F.rows.lead_assignment_rules.push(rule());
    const first = await request(app()).post(`${LEAD_ASSIGNMENT_RULES_API}/test`).send({});
    const second = await request(app()).post(`${LEAD_ASSIGNMENT_RULES_API}/test`).send({});
    expect(first.status).toBe(200);
    expect([first.body.teamMemberId, second.body.teamMemberId]).toEqual([11, 11]);
    expect(cursorWrites(), "the test endpoint took a round-robin turn").toBe(0);
    expect(await assignLead(7, {}), "the next real lead goes to the first teammate").toBe(11);
  });

  it("a failed lookup is an error, not 'no rule matched'", async () => {
    F.rows.lead_assignment_rules.push(rule());
    F.failRulesRead = true;
    const res = await request(app()).post(`${LEAD_ASSIGNMENT_RULES_API}/test`).send({});
    expect(res.status).toBe(500);
    expect(res.body.teamMemberId).toBeUndefined();
    // Lead creation itself still never fails because of rules.
    expect(await assignLead(7, {})).toBeNull();
  });
});

describe("territory", () => {
  it("matches state and county regardless of case or stray spaces", async () => {
    F.rows.lead_assignment_rules.push(
      rule({ ruleType: "territory", territoryFilter: { states: ["TX"], counties: ["Harris"] }, weightedAssignees: [{ teamMemberId: 12, weight: 1 }] }),
    );
    expect(await assignLead(7, { state: " tx", county: "harris " })).toBe(12);
    expect(await assignLead(7, { state: "OK", county: "Harris" })).toBeNull();
  });
});

describe("tenancy", () => {
  it("a rule may only name this organization's team members", async () => {
    const body = { name: "Mixed", ruleType: "round_robin", weightedAssignees: [{ teamMemberId: 11, weight: 1 }, { teamMemberId: 99, weight: 1 }] };
    const refused = await request(app()).post(LEAD_ASSIGNMENT_RULES_API).send(body);
    expect(refused.status).toBe(400);
    expect(F.rows.lead_assignment_rules).toHaveLength(0);

    // A deactivated member of THIS org may stay on a rule (re-saving must not fail).
    const ok = await request(app())
      .post(LEAD_ASSIGNMENT_RULES_API)
      .send({ ...body, weightedAssignees: [{ teamMemberId: 11, weight: 1 }, { teamMemberId: 13, weight: 1 }] });
    expect(ok.status).toBe(201);
    expect(F.rows.lead_assignment_rules).toHaveLength(1);
  });

  it("assignment never lands on another organization's member, even if a stored rule names one", async () => {
    F.rows.lead_assignment_rules.push(rule({ weightedAssignees: [{ teamMemberId: 99, weight: 1 }] }));
    expect(await assignLead(7, {})).toBeNull();
  });

  it("the client's endpoint constant is the path the server serves, scoped to the caller's org", async () => {
    F.rows.lead_assignment_rules.push(rule(), rule({ id: 6, organizationId: 8, name: "Other org" }));
    const res = await request(app()).get(LEAD_ASSIGNMENT_RULES_API);
    expect(res.status).toBe(200);
    expect(res.body.rules.map((r: { id: number }) => r.id)).toEqual([5]);
  });
});
