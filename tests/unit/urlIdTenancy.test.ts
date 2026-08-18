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

describe("seller-intent signal analysers are scoped", () => {
  /**
   * Four routes — `GET /:leadId/{urgency,financial,engagement}` and
   * `POST /:leadId/offer-range` — reached six analysers that resolved `leads`,
   * `properties` and `conversations` by primary key alone. The correct call was
   * already three lines above the first offender in the same route module:
   * `predictIntent(org.id, leadId)`.
   */
  const analysers = [
    "analyzeUrgencySignals",
    "analyzeEngagementSignals",
    "analyzeEmotionalSignals",
    "analyzePriceFlexibility",
    "analyzeCompetitionSignals",
  ] as const;

  for (const name of analysers) {
    it(`${name} binds the organization on every read`, async () => {
      const { asks } = await withDb(async () => {
        const { sellerIntentPredictorService } = await import(
          "../../server/services/sellerIntentPredictor"
        );
        return (sellerIntentPredictorService as any)[name](OTHER, 321);
      });
      expect(asks.length, `${name} issued no query — the fixture stopped exercising it`).toBeGreaterThan(0);
      for (const a of asks) {
        expect(
          bound(a.where, "organization_id"),
          `${name} read ${a.table} without an organization predicate`,
        ).toContain(OTHER);
      }
    });
  }

  it("analyzeFinancialSignals scopes its property lookup too", async () => {
    const { asks } = await withDb(async () => {
      const { sellerIntentPredictorService } = await import(
        "../../server/services/sellerIntentPredictor"
      );
      return sellerIntentPredictorService.analyzeFinancialSignals(OTHER, 321, 654);
    });
    const props = asks.filter((a) => a.table === "properties");
    expect(props.length, "the property lookup stopped being exercised").toBeGreaterThan(0);
    for (const a of props) expect(bound(a.where, "organization_id")).toContain(OTHER);
  });
});

describe("writing-style profiles are scoped", () => {
  /**
   * `POST /api/writing-styles/:id/{samples,analyze,generate}` reached three
   * functions that resolved `writing_style_profiles` by primary key alone,
   * while `deleteStyleProfile` two functions down and the three list/create
   * functions above all took the organization first. Same drift as
   * portfolioSentinel: the correct shape was already in the file.
   *
   * The consequences are a tenant's VOICE: inject sample text into another
   * org's profile, trigger an analysis that overwrites it, or generate replies
   * in that org's writing style.
   */
  it("addSampleMessage refuses another organization's profile", async () => {
    const { result } = await withDb(async () => {
      const w = await import("../../server/services/writingStyle");
      return w.addSampleMessage(OTHER, 77, "general", "hello").then(() => "wrote").catch((e) => String(e));
    });
    expect(String(result), "a sample was written into another tenant's voice profile").toMatch(/not found/i);
  });

  it("analyzeWritingStyle refuses another organization's profile", async () => {
    const { result } = await withDb(async () => {
      const w = await import("../../server/services/writingStyle");
      return w.analyzeWritingStyle(OTHER, 77).then(() => "analysed").catch((e) => String(e));
    });
    expect(String(result)).toMatch(/not found/i);
  });

  it("EVERY profile-id function binds the organization on its read", async () => {
    // The discriminating assertion. The behavioural checks above cannot tell an
    // unscoped read from a scoped miss, because this fake answers [] to both —
    // so a mutation that unscopes only ONE function still produces "not found".
    // Asserting the predicate on each function is what actually separates them.
    const cases: Array<[string, (w: any) => Promise<unknown>]> = [
      ["addSampleMessage", (w) => w.addSampleMessage(OTHER, 77, "general", "hi")],
      ["analyzeWritingStyle", (w) => w.analyzeWritingStyle(OTHER, 77)],
      ["generateStyledResponse", (w) => w.generateStyledResponse(OTHER, 77, { recipientName: "x", topic: "y", intent: "z" })],
    ];

    for (const [name, run] of cases) {
      const { asks } = await withDb(async () => {
        const w = await import("../../server/services/writingStyle");
        return run(w).catch(() => null);
      });
      const reads = asks.filter((a) => a.table === "writing_style_profiles");
      expect(reads.length, `${name} issued no profile read — the fixture stopped exercising it`).toBeGreaterThan(0);
      for (const a of reads) {
        expect(
          bound(a.where, "organization_id"),
          `${name} resolved a writing style profile by primary key alone`,
        ).toContain(OTHER);
      }
    }
  });
});

describe("buyer qualifications and deal-pattern matches are scoped", () => {
  /**
   * Two more found by the same scan, and both instructive about how partial the
   * coverage was:
   *
   * `getQualificationById` is reached from TWO routers.
   * `routes-buyer-qualification.ts` guards it with a `requireOwnedQualificationId`
   * helper that fetches then compares `organizationId` — correct. But
   * `routes-ai-operations.ts:682` calls the same service with no guard at all.
   * One service, two doors, one of them open — the same shape as the portfolio
   * alerts. The data is a named buyer's financial pre-qualification.
   *
   * `updateMatchOutcome` is a WRITE that feeds pattern learning: an outcome
   * written onto another tenant's match teaches that tenant's model.
   */
  it("getQualificationById binds the organization", async () => {
    const { asks } = await withDb(async () => {
      const { buyerQualificationBotService } = await import(
        "../../server/services/buyerQualificationBot"
      );
      return buyerQualificationBotService.getQualificationById(OTHER, 501);
    });
    const reads = asks.filter((a) => a.table === "buyer_qualifications");
    expect(reads.length, "the qualification read stopped being exercised").toBeGreaterThan(0);
    for (const a of reads) {
      expect(
        bound(a.where, "organization_id"),
        "a buyer qualification was resolved by primary key alone",
      ).toContain(OTHER);
    }
  });

  it("updateMatchOutcome binds the organization on its WRITE", async () => {
    const { asks } = await withDb(async () => {
      const { dealPatternCloningService } = await import(
        "../../server/services/dealPatternCloning"
      );
      return dealPatternCloningService.updateMatchOutcome(OTHER, 88, "closed", true);
    });
    const writes = asks.filter((a) => a.kind === "update" && a.table === "deal_pattern_matches");
    expect(writes.length, "the match update stopped being exercised").toBeGreaterThan(0);
    for (const a of writes) {
      expect(
        bound(a.where, "organization_id"),
        "a pattern match outcome was written by primary key alone",
      ).toContain(OTHER);
    }
  });

  it("BOTH doors onto getQualificationById pass an organization", () => {
    // The service being scoped is only half of it: a caller that omits the
    // argument would not compile, but a caller that passes the WRONG thing
    // would. Pin that each route hands over its own org.
    const fs = require("node:fs") as typeof import("node:fs");
    const path = require("node:path") as typeof import("node:path");
    const read = (f: string) =>
      fs.readFileSync(path.resolve(__dirname, "../../server", f), "utf8");

    expect(read("routes-ai-operations.ts")).toMatch(
      /getQualificationById\(\s*org\.id\s*,\s*qualificationId/,
    );
    expect(read("routes-buyer-qualification.ts")).toMatch(
      /getQualificationById\(org\.id, id\)/,
    );
  });
});
