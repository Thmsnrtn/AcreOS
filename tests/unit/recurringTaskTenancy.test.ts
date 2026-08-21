/**
 * One org may not create tasks in every other org.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 * `tasksRepo.getRecurringTasksDue()` took no organization and emitted
 *
 *     where is_recurring = true and status = 'completed' and next_occurrence <= now
 *
 * across the whole table. Its only two call sites are the SAME route registered
 * twice — `POST /api/tasks/process-recurring` in `server/routes.ts` and again in
 * `server/routes-crm-extras.ts` — behind nothing but `isAuthenticated,
 * getOrCreateOrg`. Each looped the result into `createNextRecurringTask`, which
 * inserts with `organizationId: parentTask.organizationId` and then nulls the
 * parent's `nextOccurrence`.
 *
 * So any authenticated user of any organization could, with one request:
 *   - INSERT a task row into every other organization on the platform,
 *   - MUTATE every other organization's parent tasks, and
 *   - READ the created rows back in the response body — `title`, `description`,
 *     `assignedTo` and `entityId` are copied verbatim from the foreign parent.
 *
 * A cross-tenant write, a cross-tenant mutation and a cross-tenant read, from a
 * button any customer can press.
 *
 * ── WHY THIS ONE IS IN ITS OWN COMMIT ───────────────────────────────────────
 * It was claim 7 of 8 in the rule-1 adjudication, and that run capped
 * adversarial refutation at 6 claims. It therefore came back reported as
 * UNVERIFIED — explicitly not as safe — and was adjudicated by hand afterwards.
 * Recorded because the cap is the interesting part: a fleet that silently
 * truncates its own verification reads exactly like one that verified
 * everything, and the only reason this defect was not shipped as "reviewed" is
 * that the overflow was reported rather than dropped.
 *
 * ── WHAT THIS FILE PROVES ───────────────────────────────────────────────────
 * Behaviour. The fake `db` evaluates the predicate drizzle actually built
 * against rows belonging to two organizations, so an unscoped statement reaches
 * the other tenant's rows here exactly as it did in production. Asserting that
 * the source mentions `organizationId` would pass against a predicate built on
 * the wrong value.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Column, Param, SQL, Table, getTableColumns, getTableName, is } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { tasks } from "@shared/schema";

const CALLER_ORG = 42;
const OTHER_ORG = 7;

type Row = Record<string, unknown>;

const KEYS = new Map<string, string>(
  Object.entries(getTableColumns(tasks as any)).map(([tsKey, col]) => [
    (col as { name: string }).name,
    tsKey,
  ]),
);

/** Equalities the predicate binds, as [column, value]. */
function equalities(node: unknown): Array<[string, unknown]> {
  const tokens: Array<{ kind: "col" | "param"; v: unknown }> = [];
  const seen = new WeakSet<object>();
  const walk = (n: any): void => {
    if (n === null || typeof n !== "object" || seen.has(n)) return;
    seen.add(n);
    if (Array.isArray(n)) return n.forEach(walk);
    if (is(n, Column)) return void tokens.push({ kind: "col", v: n.name });
    if (is(n, Param)) return void tokens.push({ kind: "param", v: n.value });
    if (is(n, Table)) return;
    if (is(n, SQL)) return (n as any).queryChunks.forEach(walk);
    if (typeof n.getSQL === "function") return walk(n.getSQL());
  };
  walk(node);
  const out: Array<[string, unknown]> = [];
  for (let i = 0; i < tokens.length - 1; i++) {
    if (tokens[i].kind === "col" && tokens[i + 1].kind === "param") {
      out.push([String(tokens[i].v), tokens[i + 1].v]);
    }
  }
  return out;
}

const dialect = new PgDialect();
const compile = (p: unknown) => dialect.sqlToQuery((p as SQL).getSQL()).sql;

/**
 * Which columns this statement compares with `=`, read from the RENDERED SQL.
 *
 * This query mixes operators — `next_occurrence <= $n` sits beside three
 * equalities — and a token walk cannot tell them apart: `lte(col, v)` emits the
 * same [Column, chunk, Param] shape as `eq(col, v)`. Applying an `lte` as if it
 * were an `=` made the vacuity case fail against CORRECT code, which is the
 * useful direction for a harness bug to fail in.
 *
 * So the operator comes from the compiled SQL rather than from an assumption,
 * and anything that is not `=` is asserted to be a genuine inequality rather
 * than quietly ignored.
 */
function equalityColumns(predicate: unknown): Set<string> {
  const sql = compile(predicate);
  const ops = new Map<string, string>();
  for (const m of sql.matchAll(/"([a-z_]+)"\s*(=|<=|>=|<|>|!=)\s*\$/g)) {
    ops.set(m[1], m[2]);
  }
  for (const [col, op] of ops) {
    if (op !== "=") {
      expect(
        ["<=", ">=", "<", ">"],
        `unexpected operator ${op} on ${col} — this evaluator would mis-model it`,
      ).toContain(op);
    }
  }
  return new Set([...ops].filter(([, op]) => op === "=").map(([col]) => col));
}

/**
 * A row is returned when it satisfies every EQUALITY the predicate binds.
 *
 * Every seeded row is genuinely due and completed, so the `next_occurrence <=
 * now` clause holds for all of them by construction — which is what makes
 * equality-only evaluation faithful here rather than permissive. The only thing
 * that can separate these rows is the organization predicate, and a statement
 * that binds none reaches the whole table exactly as production did.
 */
function matches(row: Row, predicate: unknown): boolean {
  const eqCols = equalityColumns(predicate);
  return equalities(predicate)
    .filter(([col]) => eqCols.has(col))
    .every(([col, value]) => {
      const tsKey = KEYS.get(col);
      return tsKey !== undefined && String(row[tsKey]) === String(value);
    });
}

let captured: unknown[] = [];
let rows: Row[] = [];

function makeDb() {
  return {
    select: () => ({
      from(table: any) {
        expect(getTableName(table)).toBe(getTableName(tasks));
        return {
          async where(predicate: unknown) {
            expect(
              compile(predicate).toLowerCase(),
              "the statement emits an OR — this evaluator models conjunctions only",
            ).not.toMatch(/\bor\b/);
            captured.push(predicate);
            return rows.filter((r) => matches(r, predicate));
          },
        };
      },
    }),
  };
}

async function callRepo(orgId: number) {
  vi.resetModules();
  vi.doMock("../../server/db", () => ({ db: makeDb() }));
  const { tasksRepo } = await import("../../server/storage/tasksRepo");
  return (tasksRepo as any).getRecurringTasksDue.call({} as any, orgId);
}

beforeEach(() => {
  vi.resetModules();
  captured = [];
  rows = [
    { id: 1, organizationId: CALLER_ORG, title: "caller: weekly drive-by", isRecurring: true, status: "completed", nextOccurrence: new Date(0) },
    { id: 2, organizationId: OTHER_ORG, title: "other org: monthly note review", isRecurring: true, status: "completed", nextOccurrence: new Date(0) },
    { id: 3, organizationId: OTHER_ORG, title: "other org: quarterly tax reserve", isRecurring: true, status: "completed", nextOccurrence: new Date(0) },
  ];
});

describe("getRecurringTasksDue is scoped to the caller's organization", () => {
  it("VACUITY: the caller's own due task IS returned", async () => {
    // Without this, every assertion below is satisfied by a method that returns
    // nothing at all.
    const out = await callRepo(CALLER_ORG);
    expect(out.map((t: Row) => t.title)).toContain("caller: weekly drive-by");
  });

  it("does not return another organization's due tasks", async () => {
    const out = await callRepo(CALLER_ORG);
    const orgs = new Set(out.map((t: Row) => t.organizationId));
    expect(
      [...orgs],
      "a foreign organization's recurring task was returned — every one of these " +
        "would have been re-created and its parent mutated by the route",
    ).toEqual([CALLER_ORG]);
    expect(out).toHaveLength(1);
  });

  it("binds organization_id to the CALLER's org in the emitted statement", async () => {
    await callRepo(CALLER_ORG);
    expect(captured).toHaveLength(1);
    const bound = equalities(captured[0]);
    expect(
      bound.some(([col, v]) => col === "organization_id" && String(v) === String(CALLER_ORG)),
      `no organization_id = ${CALLER_ORG} in the statement. Bound: ${JSON.stringify(bound)}`,
    ).toBe(true);
    expect(bound.some(([col, v]) => col === "organization_id" && String(v) === String(OTHER_ORG))).toBe(false);
  });
});

describe("both call sites feed it an organization", () => {
  // The repo predicate is only safe while the routes keep passing an org. The
  // route is registered TWICE; fixing the one named in a report and leaving its
  // twin is the wave-discipline failure CLAUDE.md warns about, so both are
  // pinned here by source.
  //
  // WHAT THESE TWO CASES CANNOT PROVE, stated because it actually happened:
  // when this fix first landed, BOTH call sites read `getRecurringTasksDue(org.id)`
  // while neither route had bound `org` at all. These cases were green — the
  // string is right — and `tsc` was the thing that failed, in both files. A
  // source scan cannot tell valid code from code that does not compile, which is
  // exactly why CLAUDE.md calls static scanning defence in depth rather than
  // proof. The behavioural block above is the proof; this block only catches the
  // narrower regression of a caller dropping the argument entirely.
  const CALL_SITES = ["server/routes.ts", "server/routes-crm-extras.ts"] as const;

  it.each(CALL_SITES)("%s calls it with the caller's org", (rel) => {
    const src = readFileSync(resolve(__dirname, "../..", rel), "utf8");
    const hits = [...src.matchAll(/getRecurringTasksDue\(([^)]*)\)/g)].map((m) => m[1].trim());
    expect(hits.length, `${rel} no longer calls getRecurringTasksDue — re-anchor this`).toBeGreaterThan(0);
    for (const arg of hits) {
      expect(
        arg,
        `${rel} calls getRecurringTasksDue() with no organization — the route would ` +
          "process every tenant's recurring tasks again",
      ).not.toBe("");
      expect(arg).toMatch(/org/i);
    }
  });
});
