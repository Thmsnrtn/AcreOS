/**
 * Org A may not read org B's lead activity timeline.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 * `leadRepo.getLeadActivities` was declared
 *
 *     getLeadActivities(leadId: number, limit: number = 50)
 *
 * and emitted `where lead_id = $1 order by created_at desc limit $2`. No org
 * appeared in its signature or its body — `lead_activities.organization_id` is
 * `NOT NULL`, so the column existed and was simply never asserted.
 *
 * Four of its five production call sites passed the arguments in the OTHER
 * order, because every neighbouring repo method takes the org first
 * (`getLead(orgId, id)`, `getLeadsNeedingScoring(orgId, limit)`):
 *
 *     server/services/agent-skills.ts      scoreBuyer / scoreLead / suggestFollowUp
 *     server/services/sequenceProcessor.ts checkLeadResponded
 *         → storage.getLeadActivities(context.organizationId, leadId)
 *
 * Both parameters are `number`, so `npm run check` was green while the query
 * ran as `where lead_id = <organizationId> limit <leadId>`: the timeline of
 * whichever lead happens to carry the caller's ORG ID as its primary key, read
 * by an org that has no relationship to it and folded into the skill's output.
 * A missing org parameter is exactly what let the wrong argument slide in
 * silently — the two defects are one defect.
 *
 * ── WHAT THIS FILE PROVES ───────────────────────────────────────────────────
 * Behaviour, not vocabulary. The fake `db` below is an honest postgres for the
 * shape this method emits: it holds activity rows for two organizations and
 * answers a SELECT by EVALUATING the predicate drizzle actually built against
 * each row. A statement that omits the org predicate therefore returns the
 * other tenant's rows here exactly as production did, and the assertions fail.
 *
 * Asserting that the source mentions `organizationId` would pass against a
 * predicate built on the wrong value; a storage double that filters by org for
 * free would pass against no predicate at all. Both were rejected.
 *
 * The ARGUMENT ORDER is pinned separately and deliberately, against real call
 * sites: the runtime predicate is only safe while callers keep feeding the org
 * into the org slot, and nothing in the type system can tell two `number`s
 * apart. That assertion is what fails if the swap is reintroduced at a caller
 * without touching this repo method at all.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Column, Param, SQL, Table, getTableColumns, getTableName, is } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { leadActivities } from "@shared/schema";

const ATTACKER_ORG = 42;
const VICTIM_ORG = 7;

/**
 * The lead whose id COLLIDES with the attacker's org id. This is the row the
 * swapped call actually fetched: `lead_id = 42` where 42 was an organization
 * id. It belongs to the victim.
 */
const VICTIM_LEAD_ID = ATTACKER_ORG;
const ATTACKER_LEAD_ID = 3;

type Row = Record<string, unknown>;

/** DB column name (`organization_id`) → drizzle/TS key (`organizationId`). */
const KEYS = new Map<string, string>(
  Object.entries(getTableColumns(leadActivities as any)).map(([tsKey, col]) => [
    (col as { name: string }).name,
    tsKey,
  ]),
);

/**
 * Flatten a drizzle predicate into the equalities it binds, as
 * [column name, value] pairs. `eq(col, v)` emits [Column, StringChunk, Param];
 * `and(...)` nests SQL objects with their own `queryChunks`.
 */
function equalities(node: unknown): Array<[string, unknown]> {
  const tokens: Array<{ kind: "col" | "param"; v: unknown }> = [];
  const seen = new WeakSet<object>();
  const walk = (n: any): void => {
    if (n === null || typeof n !== "object") return;
    if (seen.has(n)) return;
    seen.add(n);
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (is(n, Column)) { tokens.push({ kind: "col", v: n.name }); return; }
    if (is(n, Param)) { tokens.push({ kind: "param", v: n.value }); return; }
    if (is(n, Table)) return;
    if (is(n, SQL)) { (n as any).queryChunks.forEach(walk); return; }
    if (typeof n.getSQL === "function") { walk(n.getSQL()); return; }
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

/** The SQL the driver would actually receive for this predicate. */
function compile(predicate: unknown): string {
  return dialect.sqlToQuery((predicate as SQL).getSQL()).sql;
}

function expectConjunction(predicate: unknown): void {
  expect(
    compile(predicate).toLowerCase(),
    "the statement emits an OR — the evaluator below models conjunctions only, " +
      "so it would silently mis-model this predicate",
  ).not.toMatch(/\bor\b/);
}

/**
 * A row is returned when it satisfies EVERY equality the predicate binds. A
 * predicate that binds nothing matches the whole table — which is the point:
 * an unscoped statement reaches other tenants' rows here just as it did in
 * production.
 */
function matches(row: Row, predicate: unknown): boolean {
  return equalities(predicate).every(([colName, value]) => {
    const tsKey = KEYS.get(colName);
    return tsKey !== undefined && String(row[tsKey]) === String(value);
  });
}

interface Harness {
  rows: Row[];
  predicates: unknown[];
  limits: number[];
}

function makeHarness(): Harness {
  return {
    rows: [
      // Org B's lead #42 — the row the swapped call reached.
      { id: 1, leadId: VICTIM_LEAD_ID, organizationId: VICTIM_ORG, type: "call_made", description: "org B: seller will take 190k" },
      { id: 2, leadId: VICTIM_LEAD_ID, organizationId: VICTIM_ORG, type: "note_added", description: "org B: probate, motivated" },
      // Org A's own lead.
      { id: 3, leadId: ATTACKER_LEAD_ID, organizationId: ATTACKER_ORG, type: "email_sent", description: "org A: intro" },
      // Same lead id, different tenant — sequential ids collide across orgs.
      { id: 4, leadId: ATTACKER_LEAD_ID, organizationId: VICTIM_ORG, type: "sms_sent", description: "org B: same lead id" },
    ],
    predicates: [],
    limits: [],
  };
}

/** A `db` shaped like drizzle's select chain, backed by `h`. */
function makeDb(h: Harness) {
  return {
    select: () => ({
      from(table: any) {
        expect(getTableName(table)).toBe(getTableName(leadActivities));
        return {
          where(predicate: unknown) {
            expectConjunction(predicate);
            h.predicates.push(predicate);
            const hits = h.rows.filter((r) => matches(r, predicate));
            return {
              orderBy() {
                return {
                  limit: async (n: number) => {
                    h.limits.push(n);
                    return hits.slice(0, n);
                  },
                };
              },
            };
          },
        };
      },
    }),
  };
}

async function getActivitiesWith(
  h: Harness,
  ...args: number[]
): Promise<Row[]> {
  vi.resetModules();
  vi.doMock("../../server/db", () => ({ db: makeDb(h) }));
  const { leadRepo } = await import("../../server/storage/leadRepo");
  return (leadRepo.getLeadActivities as any).call({}, ...args);
}

const repoSource = () =>
  readFileSync(resolve(__dirname, "../../server/storage/leadRepo.ts"), "utf8");

beforeEach(() => vi.resetModules());

describe("storage.getLeadActivities scopes the timeline it reads", () => {
  it("THE OWNING ORG STILL READS ITS OWN TIMELINE — vacuity guard", async () => {
    // Without this, every assertion below would pass against a method that
    // returns nothing at all.
    const h = makeHarness();
    const rows = await getActivitiesWith(h, ATTACKER_ORG, ATTACKER_LEAD_ID);

    expect(rows.map((r) => r.id), "the owning org can no longer read its own lead's activities")
      .toEqual([3]);
    expect(h.predicates, "the SELECT never ran").toHaveLength(1);
  });

  it("ANOTHER ORG'S LEAD TIMELINE IS NOT RETURNED — the cross-tenant read", async () => {
    // Org A asks for lead 42. Lead 42 belongs to org B — this is the id the
    // swapped call site handed in, since org A's own organizationId is 42.
    const h = makeHarness();
    const rows = await getActivitiesWith(h, ATTACKER_ORG, VICTIM_LEAD_ID);

    expect(rows, "org B's lead activity rows were returned to org A").toEqual([]);
  });

  it("A SHARED LEAD ID DOES NOT LEAK THE OTHER TENANT'S ROWS", async () => {
    // Lead ids are sequential per table, so the same id exists in both orgs.
    // Reading org B's copy of lead 3 requires the org predicate, not the id.
    const h = makeHarness();
    const rows = await getActivitiesWith(h, VICTIM_ORG, ATTACKER_LEAD_ID);

    expect(rows.map((r) => r.id)).toEqual([4]);
    expect(
      rows.every((r) => r.organizationId === VICTIM_ORG),
      "a row belonging to another organization came back",
    ).toBe(true);
  });

  it("THE STATEMENT BINDS organization_id TO THE CALLER'S ORG", async () => {
    const h = makeHarness();
    await getActivitiesWith(h, ATTACKER_ORG, ATTACKER_LEAD_ID);

    expect(h.predicates).toHaveLength(1);
    const bound = equalities(h.predicates[0]);
    expect(
      bound.filter(([col]) => col === "organization_id").map(([, v]) => v),
      `the SELECT carries no organization_id predicate:\n${compile(h.predicates[0])}`,
    ).toEqual([ATTACKER_ORG]);
    expect(
      bound.filter(([col]) => col === "lead_id").map(([, v]) => v),
      `the SELECT no longer constrains lead_id:\n${compile(h.predicates[0])}`,
    ).toEqual([ATTACKER_LEAD_ID]);
  });

  it("THE LIMIT IS THE LIMIT, NOT A LEAD ID — the swap's other half", async () => {
    // The old signature put `limit` where the lead id now sits, so the swapped
    // call also truncated the read to `<leadId>` rows. Pin the third argument's
    // meaning so the parameter list cannot silently shift back.
    const h = makeHarness();
    await getActivitiesWith(h, VICTIM_ORG, VICTIM_LEAD_ID, 1);
    await getActivitiesWith(h, VICTIM_ORG, VICTIM_LEAD_ID);

    expect(h.limits, "the third argument is not the row limit, or the default moved")
      .toEqual([1, 50]);
  });

  it("THE ORG ID IS THE LEADING ARGUMENT AT EVERY PRODUCTION CALL SITE", () => {
    // The runtime predicate above is only safe while callers put the org in the
    // org slot, and two `number` parameters are indistinguishable to tsc — the
    // original defect passed `npm run check`. So the call sites are checked
    // directly: every one must lead with an org-shaped expression, and none may
    // lead with a lead id.
    const files = [
      "server/routes-leads.ts",
      "server/services/agent-skills.ts",
      "server/services/sequenceProcessor.ts",
    ];
    const ORG_ARG = /^(?:[A-Za-z_$][\w$]*\.)*(?:org(?:anization)?Id|org\.id|organization\.id)$/i;

    let seen = 0;
    for (const rel of files) {
      const src = readFileSync(resolve(__dirname, "../..", rel), "utf8");
      for (const m of src.matchAll(/getLeadActivities\(([^)]*)\)/g)) {
        seen++;
        const first = m[1].split(",")[0].trim();
        expect(
          first,
          `${rel}: getLeadActivities(${m[1]}) does not lead with an organization id. ` +
            "Both parameters are `number`, so a swap type-checks and turns the " +
            "query into `lead_id = <organizationId> limit <leadId>` — another " +
            "tenant's lead timeline.",
        ).toMatch(ORG_ARG);
      }
    }
    expect(
      seen,
      "no getLeadActivities call sites were found — the scan went blind, or the " +
        "callers moved. Re-point this list; do not delete the assertion.",
    ).toBe(5);
  });

  it("THE REPO METHOD CANNOT BE CALLED WITHOUT AN ORG", () => {
    // Defence in depth for the signature itself: an optional org would let a
    // caller omit it and fall back to an unscoped read, which is how this
    // method shipped in the first place.
    const signature = /async getLeadActivities\(this: DatabaseStorage,([^)]*)\)/.exec(repoSource());
    expect(signature, "getLeadActivities was renamed or reshaped").not.toBeNull();
    const params = signature![1].split(",").map((p) => p.trim()).filter(Boolean);
    expect(params[0], "the org id is no longer the first parameter").toMatch(
      /^organizationId: number$/,
    );
    expect(params[1], "the lead id is no longer the second parameter").toMatch(
      /^leadId: number$/,
    );
  });
});
