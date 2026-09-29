/**
 * Founder ruling 2026-09-29 #11 (DEFECT-0154, DEFECT-0159) — cross-customer
 * data is OPT-IN, and every figure shown across customers needs FIVE distinct
 * opted-in operators behind it.
 *
 * Before: the data-co-op floor counted parcels, credit benchmarks counted
 * parcels, the market network needed 3 orgs, support learnings 3, county
 * reviews 3 deals, the "data network" county overview / LCS averages had no
 * floor at all, case studies and mentor matches published single operators,
 * valuation comps served other customers' individual deals — and nothing
 * anywhere asked for consent (sophiePrivacyGuard declared it and had no
 * callers).
 *
 * The behaviour of each surface is pinned below against a recording db; the
 * population gate at the end enumerates every server file that reads a
 * cross-org source table and requires it to be classified.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { getTableName, type SQL } from "drizzle-orm";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { stripComments, REPO_SWEEP_TIMEOUT_MS } from "../helpers/stripComments";

vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const ALL_ORGS = Array.from({ length: 20 }, (_, i) => i + 1);
const h = vi.hoisted(() => ({
  consenting: [] as number[],
  selectThrows: false,
  queries: [] as Array<{ table: string; where: string; having: string; havingParams: unknown[] }>,
  executes: [] as string[],
  rowsByTable: {} as Record<string, unknown[]>,
  executeRows: [] as unknown[],
  executeParams: [] as unknown[][],
}));

vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/db", () => {
  const dialect = new PgDialect();
  const render = (w: unknown) => (w ? dialect.sqlToQuery(w as SQL).sql : "");
  const select = (proj?: Record<string, unknown>) => {
    if (h.selectThrows) throw new Error("db down");
    const rec = { table: "", where: "", having: "", havingParams: [] as unknown[] };
    const q: Record<string, unknown> = {};
    q.from = (t: unknown) => {
      rec.table = getTableName(t as never);
      h.queries.push(rec);
      return q;
    };
    q.innerJoin = () => q;
    q.leftJoin = () => q;
    q.where = (w: unknown) => {
      rec.where = render(w);
      return q;
    };
    q.groupBy = () => q;
    q.having = (w: unknown) => {
      const r = dialect.sqlToQuery(w as SQL);
      rec.having = r.sql;
      rec.havingParams = r.params;
      return q;
    };
    q.orderBy = () => q;
    q.limit = () => q;
    q.then = (f: (v: unknown) => unknown, r?: (e: unknown) => unknown) => {
      // The consent read answers with the consenting orgs ONLY when the
      // query actually filters on consent; an unfiltered read of organizations
      // gets every org — so a surface that skipped the consent predicate
      // would publish non-consenting orgs and the tests below would see it.
      if (rec.table === "organizations" && proj && "id" in proj) {
        const ids = /crossOrgLearningConsent/.test(rec.where) ? h.consenting : ALL_ORGS;
        return Promise.resolve(ids.map((id) => ({ id }))).then(f, r);
      }
      return Promise.resolve(h.rowsByTable[rec.table] ?? []).then(f, r);
    };
    return q;
  };
  const execute = async (q: unknown) => {
    const r = dialect.sqlToQuery(q as SQL);
    h.executes.push(r.sql);
    h.executeParams.push(r.params);
    return { rows: h.executeRows };
  };
  return { db: { select, execute } };
});

import { consentingOrgIds, sophiePrivacyGuard } from "../../server/services/sophiePrivacyGuard";
import { getCountyReviews } from "../../server/services/communityIntelligence";
import {
  getCountyIntelligenceOverview,
  getDataContributionMetrics,
  getLcsBenchmarks,
} from "../../server/services/dataNetworkVisibility";
import { CreditBenchmarkingService } from "../../server/services/creditBenchmarking";
import { compsVisibleTo, publicRecordTransaction } from "../../server/services/acreOSValuation";

const dialect = new PgDialect();
const FIVE = [1, 2, 3, 4, 5];

beforeEach(() => {
  h.consenting = [];
  h.selectThrows = false;
  h.queries = [];
  h.executes = [];
  h.rowsByTable = {};
  h.executeRows = [];
  h.executeParams = [];
});

describe("consent is opt-in and fails closed", () => {
  it("the consenting set reads the opt-in flag and nothing else", async () => {
    h.consenting = [3, 9];
    expect(await consentingOrgIds()).toEqual(new Set([3, 9]));
    const q = h.queries.find((x) => x.table === "organizations")!;
    expect(q.where).toMatch(/->>'crossOrgLearningConsent' = 'true'/);
  });

  it("an unreadable consent store means NOBODY is in", async () => {
    h.selectThrows = true;
    expect(await consentingOrgIds()).toEqual(new Set());
    expect(await sophiePrivacyGuard.hasConsent(3)).toBe(false);
  });

  it("an org with no setting has not consented", async () => {
    h.rowsByTable.organizations = [{ settings: {} }];
    expect(await sophiePrivacyGuard.hasConsent(3)).toBe(false);
    h.rowsByTable.organizations = [{ settings: { crossOrgLearningConsent: true } }];
    expect(await sophiePrivacyGuard.hasConsent(3)).toBe(true);
  });
});

describe("county reviews (communityIntelligence)", () => {
  it("fewer than five opted-in operators anywhere: nothing is published, nothing is queried", async () => {
    h.consenting = [1, 2, 3, 4];
    expect(await getCountyReviews("TX")).toEqual([]);
    expect(h.executes).toEqual([]);
  });

  it("only opted-in operators' deals, and only counties with five of them", async () => {
    h.consenting = FIVE;
    await getCountyReviews("TX");
    const q = h.executes[0];
    expect(q).toMatch(/d\.organization_id = ANY\(ARRAY\[\$1, \$2, \$3, \$4, \$5\]::int\[\]\)/);
    expect(q).toMatch(/COUNT\(DISTINCT d\.organization_id\) >= \$\d+/);
    expect(h.executeParams[0].slice(-2)).toEqual([5, 5]); // deals floor, operator floor
  });
});

describe("data network figures (dataNetworkVisibility)", () => {
  it("county coverage and county LCS averages publish nothing below five opted-in operators", async () => {
    h.consenting = [1, 2, 3, 4];
    expect(await getCountyIntelligenceOverview(1)).toMatchObject({ counties: [], totalContributingOrgs: 0 });
    expect(await getLcsBenchmarks(1)).toEqual([]);
    expect(h.queries.filter((q) => q.table !== "organizations")).toEqual([]);
  });

  it("with five, both read opted-in orgs only and publish only counties five of them stand behind", async () => {
    h.consenting = FIVE;
    await getCountyIntelligenceOverview(1);
    await getLcsBenchmarks(1);
    const reads = h.queries.filter((q) => q.table === "properties" || q.table === "land_credit_scores");
    expect(reads.length).toBeGreaterThanOrEqual(3);
    for (const r of reads) expect(r.where).toMatch(/"properties"\."organization_id" in \(/);
    const grouped = reads.filter((r) => r.having);
    expect(grouped).toHaveLength(2);
    for (const r of grouped) {
      expect(r.having).toMatch(/count\(distinct "properties"\."organization_id"\) >= \$\d/);
      expect(r.havingParams.at(-1)).toBe(5); // the floor's VALUE, not just its shape
    }
  });

  it("a percentile rank is only for an org that opted in, ranked among at least five other opted-in orgs that HOLD properties", async () => {
    const holding = (ids: number[]) => ids.map((id) => ({ propertyCount: 10, countyCount: 2, orgId: id, ct: id === 1 ? 10 : 5 }));
    h.consenting = [2, 3, 4, 5, 6, 7];
    h.rowsByTable.properties = holding([1, 2, 3, 4, 5, 6, 7]);
    expect(await getDataContributionMetrics(1)).toMatchObject({ contributing: false, percentileRank: null });
    // Five other opted-in orgs — but only one holds properties: no rank.
    h.consenting = [1, 2, 3, 4, 5, 6];
    h.rowsByTable.properties = [...holding([1, 2]), ...[3, 4, 5, 6].map((id) => ({ propertyCount: 10, countyCount: 2, orgId: id, ct: 0 }))];
    expect(await getDataContributionMetrics(1)).toMatchObject({ contributing: true, percentileRank: null });
    // Five others holding properties, all smaller: top of the ranking.
    h.rowsByTable.properties = holding([1, 2, 3, 4, 5, 6]);
    const r = await getDataContributionMetrics(1);
    expect(r).toMatchObject({ contributing: true, percentileRank: Math.round((5 / 6) * 100) });
  });
});

describe("credit benchmarks (creditBenchmarking)", () => {
  const svc = new CreditBenchmarkingService();
  const scoreRow = (propertyId: number, operator: number, overallScore = 60) => ({
    propertyId,
    operator,
    overallScore,
    createdAt: new Date("2026-09-01"),
  });

  it("six scored parcels from ONE operator are not a benchmark", async () => {
    h.consenting = FIVE;
    h.rowsByTable.land_credit_scores = [1, 2, 3, 4, 5, 6].map((p) => scoreRow(p, 1));
    const r = await svc.getBenchmarks("land", "TX");
    expect(r.available).toBe(false);
    const reason = (r as { reason: string }).reason;
    expect(reason).toMatch(/5 different operators who opted in/);
    expect(reason).not.toMatch(/\b6\b/); // the below-floor cohort size is not disclosed
  });

  it("five parcels from five opted-in operators are, and the cohort query reads opted-in orgs only", async () => {
    h.consenting = FIVE;
    h.rowsByTable.land_credit_scores = FIVE.map((o) => scoreRow(o, o, 50 + o));
    const r = await svc.getBenchmarks("land", "TX");
    expect(r.available).toBe(true);
    const q = h.queries.find((x) => x.table === "land_credit_scores")!;
    expect(q.where).toMatch(/"properties"\."organization_id" in \(/);
  });

  it("nobody opted in: no cohort query at all", async () => {
    h.consenting = [];
    const r = await svc.compareToIndustry(70, "land", "TX");
    expect(r.available).toBe(false);
    expect(h.queries.filter((q) => q.table === "land_credit_scores")).toEqual([]);
  });
});

describe("valuation comps (acreOSValuation)", () => {
  it("a public record is a sha256-keyed row with no contributor; a customer deal is only its own org's comp", () => {
    expect(dialect.sqlToQuery(publicRecordTransaction()).sql).toBe(
      `("transaction_training"."transaction_hash" NOT LIKE '%|%' AND "transaction_training"."contributor_org_id" IS NULL)`,
    );
    const own = dialect.sqlToQuery(compsVisibleTo(7));
    expect(own.sql).toMatch(/OR "transaction_training"\."contributor_org_id" = \$1\)$/);
    expect(own.params).toEqual([7]);
  });
});

// ── Population ───────────────────────────────────────────────────────────────
// Every server file that reads a cross-org source table must be classified.
// "consented" files must call a canonical consent filter; the others must
// say why they are not a publication across customers.
const ROOT = resolve(__dirname, "../..");
type Verdict = "consented" | "own-org" | "founder-only" | "platform-op";
const CONSENT_FILTERS = /\b(consentingOrgIds|publishableCrossOrgLearnings|publicRecordTransaction|compsVisibleTo)\(|\bCROSS_ORG_CONSENT_EFFECTIVE_AT\b/;
// Every query shape a reader can take: a Drizzle .from()/.join() (spacing or
// line breaks inside the parens included), the relational db.query API, and
// raw SQL FROM/JOIN in any case.
const shape = (ident: string, table: string) =>
  new RegExp(
    `\\.from\\(\\s*${ident}\\s*\\)|\\.(inner|left|right|full)?[jJ]oin\\(\\s*${ident}\\b|\\bdb\\.query\\.${ident}\\.|\\b(from|join)\\s+${table}\\b`,
    "i",
  );
const SOURCES: Record<string, RegExp> = {
  pax_cross_org_learnings: shape("paxCrossOrgLearnings", "pax_cross_org_learnings"),
  transaction_training: shape("transactionTraining", "transaction_training"),
  land_credit_scores: shape("landCreditScores", "land_credit_scores"),
  parcel_observations: shape("parcelObservations", "parcel_observations"),
  county_market_rollups: shape("countyMarketRollups", "county_market_rollups"),
};
const REGISTER: Record<string, Verdict> = {
  "server/services/paxLearning.ts": "consented",
  "server/services/paxObserver.ts": "consented",
  "server/routes-admin.ts": "founder-only", // /api/admin/pax-observations
  "server/services/acreOSValuation.ts": "consented",
  "server/jobs/featureEngineeringJob.ts": "consented",
  "server/routes-data-api.ts": "consented",
  "server/services/creditBenchmarking.ts": "consented",
  "server/services/dataCoop/countyRollupJob.ts": "consented",
  "server/services/dataNetworkVisibility.ts": "consented",
  "server/services/landCredit.ts": "own-org",
  "server/services/outcomeCalibrationLoop.ts": "own-org",
  "server/services/lcsCalibrator.ts": "own-org", // per-deal latest score lookup
  "server/jobs/landCreditScoreRecalculation.ts": "platform-op", // rescoring job, publishes nothing
  "server/routes-market-heat.ts": "consented", // serves only rollups computed under the consent rule
  "server/services/dataCoop/quarterlyMarketReport.ts": "founder-only", // draft, founder-reviewed
  "server/services/parcel-biography.ts": "own-org", // the org's own + unattributed public facts
  "server/services/parcelDeltaDetector.ts": "own-org", // same
  "server/services/audit/detectors/observationRateDetector.ts": "platform-op", // insert-rate health signal
};

function readers(src: string): string[] {
  return Object.entries(SOURCES).filter(([, re]) => re.test(src)).map(([t]) => t);
}

describe("every reader of a cross-org source is classified", () => {
  const files = execSync("git ls-files 'server/*.ts'", { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .filter((f) => f && !f.includes(".test."));
  const found = new Map<string, string>();
  for (const f of files) {
    const src = stripComments(readFileSync(resolve(ROOT, f), "utf8"));
    if (readers(src).length) found.set(f, src);
  }

  it("the scan read the whole server tree, and its detector is live (canary)", () => {
    expect(files.length).toBeGreaterThan(1000);
    expect(readers(`db.select().from(paxCrossOrgLearnings)`)).toEqual(["pax_cross_org_learnings"]);
    expect(readers(`db.select().from(\n  paxCrossOrgLearnings\n)`)).toEqual(["pax_cross_org_learnings"]);
    expect(readers(`db.query.transactionTraining.findMany({})`)).toEqual(["transaction_training"]);
    expect(readers(`db.query.landCreditScores.findFirst({})`)).toEqual(["land_credit_scores"]);
    expect(readers(`q.innerJoin(landCreditScores, eq(a, b))`)).toEqual(["land_credit_scores"]);
    expect(readers(`sql\`SELECT * FROM land_credit_scores\``)).toEqual(["land_credit_scores"]);
    expect(readers(`sql\`select n from x join parcel_observations po on true\``)).toEqual(["parcel_observations"]);
    expect(readers(`// db.select().from(landCreditScores)`.replace(/^\/\/.*$/, ""))).toEqual([]);
  });

  it("no unclassified reader", () => {
    expect([...found.keys()].filter((f) => !(f in REGISTER))).toEqual([]);
  });

  for (const [file, verdict] of Object.entries(REGISTER)) {
    it(`${file} still reads a source (vacuity) and honours '${verdict}'`, () => {
      expect(found.has(file), `${file} no longer reads a cross-org source — remove it from the register`).toBe(true);
      if (verdict === "consented") expect(found.get(file)).toMatch(CONSENT_FILTERS);
    });
  }

  it("only the OWNER can switch sharing on, and the general settings PATCH cannot set it", () => {
    const src = stripComments(readFileSync(resolve(ROOT, "server/routes-organization.ts"), "utf8"));
    expect(src).toMatch(/api\.put\("\/api\/organization\/data-sharing", isAuthenticated, getOrCreateOrg, requireOwner\(\),/);
    expect(src).toMatch(/sophiePrivacyGuard\.setConsent\(org\.id, parsed\.data\.enabled\)/);
    const patchSchema = src.slice(src.indexOf("const orgSettingsPatchSchema"), src.indexOf("});", src.indexOf("const orgSettingsPatchSchema")));
    expect(patchSchema.length).toBeGreaterThan(100); // located (vacuity)
    expect(patchSchema).not.toMatch(/crossOrgLearningConsent/);
  });

  it("market heat serves only rollups computed under the consent rule, and no below-floor count", () => {
    const src = stripComments(readFileSync(resolve(ROOT, "server/routes-market-heat.ts"), "utf8"));
    // Both reads — the per-county latest and the state browse.
    expect(src.match(/gte\(countyMarketRollups\.computedAt, CROSS_ORG_CONSENT_EFFECTIVE_AT\)/g) ?? []).toHaveLength(1);
    expect(src.match(/computed_at >= \$\{CROSS_ORG_CONSENT_EFFECTIVE_AT\}/g) ?? []).toHaveLength(1);
    expect(src).not.toMatch(/parcelsObserved|parcelsNeeded|FROM parcel_observations/);
  });

  it("the single-operator publications stay gone", () => {
    const ci = stripComments(readFileSync(resolve(ROOT, "server/services/communityIntelligence.ts"), "utf8"));
    expect(ci).not.toMatch(/getAnonymizedCaseStudies|findMentorMatches/);
    const routes = stripComments(readFileSync(resolve(ROOT, "server/routes-platform-features.ts"), "utf8"));
    expect(routes).not.toMatch(/\/api\/community\/(case-studies|mentor-matches)/);
  });
});
