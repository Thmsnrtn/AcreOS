/**
 * A URL id is caller-supplied, so it is never a tenant boundary.
 *
 * ── HOW THESE WERE FOUND ────────────────────────────────────────────────────
 * Fixing the LTV cross-tenant read (`fd616bdc`) showed that
 * `check-org-scoped-fetch` has a systematic blind spot: its step 3 treats a
 * function as org-scoped when the string `organizationId` appears ANYWHERE in
 * its text. So a handler that scopes one query and leaves another unscoped
 * passes, and a service method reached only by id sits in the weaker rule-1
 * baseline.
 *
 * Scanning route handlers for "a URL id reaches a service method, and NO call
 * in that handler ever pairs that id with an org" produced 28 candidates after
 * excluding two legitimate patterns:
 *
 *   - GUARD-THEN-USE — `getNote(org.id, noteId)` first, then an unscoped child
 *     read. Correct: ownership was just proved.
 *   - DELIBERATELY PLATFORM-WIDE — `requireFounder` routers such as dunning,
 *     which is AcreOS billing its OWN customers. Identity != tenant != authority.
 *
 * Four of the candidates were real, all on tables whose `organization_id` is
 * NOT NULL:
 *
 *   1. GET   /api/leads/:id/score-history      READ  — lead_score_history.
 *      The handler bound `const org = req.organization` AND NEVER USED IT,
 *      which is exactly why the textual org-context test was satisfied.
 *   2. PATCH /alerts/:id/{ack,resolve,dismiss} WRITE — portfolio_alerts, from
 *      two separate routers onto the same service.
 *   3. GET   /alerts/:id/suggest               READ  — portfolio_alerts.
 *   4. POST  /api/pax/observations/:id/{acknowledge,dismiss} WRITE.
 *
 * The writes are the worse half: `resolveAlert` also stores caller-supplied
 * `resolution` text into the other tenant's record.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { getTableName, type SQL } from "drizzle-orm";

/** Which values a predicate binds to a given column. */
function bound(node: unknown, column: string): unknown[] {
  const out: unknown[] = [];
  const tokens: Array<{ kind: "col" | "param"; v: unknown }> = [];
  const walk = (n: any): void => {
    if (n === null || typeof n !== "object") return;
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (typeof n.name === "string" && n.table !== undefined) { tokens.push({ kind: "col", v: n.name }); return; }
    if ("encoder" in n && "value" in n) { tokens.push({ kind: "param", v: n.value }); return; }
    if (Array.isArray(n.queryChunks)) { n.queryChunks.forEach(walk); return; }
  };
  walk(node);
  for (let i = 0; i < tokens.length - 1; i++) {
    if (tokens[i].kind === "col" && tokens[i].v === column && tokens[i + 1].kind === "param") {
      out.push(tokens[i + 1].v);
    }
  }
  return out;
}

interface Ask { table: string; where: unknown; kind: "select" | "update" }

/** Records every query, and answers only those scoped to the owning org. */
function makeDb(asks: Ask[], visibleOrg: number, rows: Record<string, unknown[]>) {
  const chain = (kind: Ask["kind"], table?: string) => {
    const state: Ask = { table: table ?? "", where: undefined, kind };
    const self: any = {
      from(t: any) { state.table = getTableName(t); return self; },
      set() { return self; },
      where(p: SQL) { state.where = p; return self; },
      orderBy() { return self; },
      limit() { return self; },
      returning() { return self; },
      then(resolve: (v: unknown) => void) {
        asks.push({ ...state });
        const scoped = bound(state.where, "organization_id").includes(visibleOrg);
        resolve(scoped ? (rows[state.table] ?? [{ id: 1 }]) : []);
      },
    };
    return self;
  };
  return {
    select: () => chain("select"),
    update: (t: any) => chain("update", getTableName(t)),
  };
}

const OWNER = 7;
const OTHER = 99;

beforeEach(() => vi.resetModules());

async function withDb<T>(fn: (asks: Ask[]) => Promise<T>): Promise<{ result: T; asks: Ask[] }> {
  const asks: Ask[] = [];
  vi.resetModules();
  vi.doMock("../../server/db", () => ({ db: makeDb(asks, OWNER, {}) }));
  const result = await fn(asks);
  return { result, asks };
}

describe("lead score history is scoped to the caller's organization", () => {
  const call = (org: number) =>
    withDb(async () => {
      const { leadScoringService } = await import("../../server/services/leadScoring");
      return leadScoringService.getScoreHistory(org, 123, 10);
    });

  it("the owning org still gets its history", async () => {
    const { result } = await call(OWNER);
    expect(result, "the owning org can no longer read its own lead scores").not.toEqual([]);
  });

  it("ANOTHER ORG GETS NOTHING", async () => {
    const { result } = await call(OTHER);
    expect(result, "another tenant's lead scores and recommendations were returned").toEqual([]);
  });

  it("binds organization_id on the query itself", async () => {
    const { asks } = await call(OWNER);
    expect(asks.length).toBeGreaterThan(0);
    expect(bound(asks[0].where, "organization_id")).toContain(OWNER);
  });
});

describe("portfolio alert transitions are scoped — these are WRITES", () => {
  const each = [
    { name: "acknowledgeAlert", run: (s: any, org: number) => s.acknowledgeAlert(org, 55, 1) },
    { name: "resolveAlert", run: (s: any, org: number) => s.resolveAlert(org, 55, "done") },
    { name: "dismissAlert", run: (s: any, org: number) => s.dismissAlert(org, 55) },
  ];

  for (const c of each) {
    it(`${c.name} refuses another organization's alert`, async () => {
      const { result, asks } = await withDb(async () => {
        const { portfolioSentinelService } = await import("../../server/services/portfolioSentinel");
        return c.run(portfolioSentinelService, OTHER);
      });
      expect(result, `${c.name} mutated another tenant's alert`).toBeNull();
      const writes = asks.filter((a) => a.kind === "update");
      expect(writes.length, `${c.name} issued no update — the fixture stopped exercising it`).toBeGreaterThan(0);
      for (const w of writes) {
        expect(
          bound(w.where, "organization_id"),
          `${c.name} updated portfolio_alerts without an organization predicate`,
        ).toContain(OTHER);
      }
    });

    it(`${c.name} still works for the owning organization`, async () => {
      // Vacuity guard: a method that always returns null would pass above.
      const { result } = await withDb(async () => {
        const { portfolioSentinelService } = await import("../../server/services/portfolioSentinel");
        return c.run(portfolioSentinelService, OWNER);
      });
      expect(result, `${c.name} no longer works for the owning org`).not.toBeNull();
    });
  }
});

describe("Pax observation transitions are scoped", () => {
  for (const name of ["acknowledgeObservation", "dismissObservation"] as const) {
    it(`${name} binds the organization on its update`, async () => {
      const { asks } = await withDb(async () => {
        const { paxObserver } = await import("../../server/services/paxObserver");
        return (paxObserver as any)[name](OTHER, 42);
      });
      const writes = asks.filter((a) => a.kind === "update");
      expect(writes.length, `${name} issued no update`).toBeGreaterThan(0);
      for (const w of writes) {
        expect(
          bound(w.where, "organization_id"),
          `${name} updated pax_observations without an organization predicate`,
        ).toContain(OTHER);
      }
    });
  }
});
