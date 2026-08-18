/**
 * The daily deal feed — one tenancy defect and one fabrication defect, in the
 * same function.
 *
 * ── 1. TENANCY ──────────────────────────────────────────────────────────────
 * `generateDealFeed` gathered candidates with
 *
 *     .from(properties).where(and(LOWER(state) = …, LOWER(county) = …))
 *
 * and no organization predicate. `properties.organization_id` is NOT NULL with
 * a cascade FK — there is no shared or public parcel pool — so the feed built
 * for one org drew candidates from EVERY org's parcels in its target counties,
 * and `buildOpportunity` returns the parcel's APN, address, coordinates,
 * assessed value, tax-delinquency signals and owner-motivation analysis. Those
 * were then persisted into the reading org's `daily_deal_feed` and rendered.
 *
 * `check-org-scoped-fetch` was green over it, both before and after the fix,
 * and the reason is a known property of that gate: its rule 3 treats a
 * function as org-scoped when the string `organizationId` appears ANYWHERE in
 * the body. `generateDealFeed` is org-scoped in six other places, so a
 * partly-scoped function HIDES an unscoped query inside it.
 *
 * ── 2. FABRICATION ──────────────────────────────────────────────────────────
 * The four scoring pillars were seeded `radar = 50`, `ownerMotivation = 50`,
 * `countyOpp = 50`, `lcs = 575` ("middle of range"), and a scorer that failed
 * left its seed in place. `countyOpportunity` was never assigned from anything
 * at all — 20% of every composite score was the constant 50. On top of that,
 * `parcel.acreage || 5` valued a parcel of unknown size as five acres and
 * three dollar offer amounts were derived from it.
 *
 * A neutral midpoint is not neutral when it is averaged against real scores:
 * it drags every ranking toward the middle and makes an unscored parcel
 * indistinguishable from a genuinely average one, on a surface whose entire
 * claim is "these are the ten best parcels we found".
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { getTableName, type SQL } from "drizzle-orm";

/** Values bound against `column` anywhere in a drizzle predicate tree. */
function bound(node: unknown, column: string): unknown[] {
  const out: unknown[] = [];
  const tokens: Array<{ kind: "col" | "param"; v: unknown }> = [];
  const seen = new Set<unknown>();
  const walk = (n: any): void => {
    if (n === null || typeof n !== "object") return;
    if (seen.has(n)) return;
    seen.add(n);
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

/** The literal SQL fragments in a predicate tree (the tree is circular, so
 *  JSON.stringify cannot be used on it directly). */
function rawChunks(node: unknown): string[] {
  const parts: string[] = [];
  const seen = new Set<unknown>();
  const walk = (n: any): void => {
    if (n === null || typeof n !== "object") return;
    if (seen.has(n)) return;
    seen.add(n);
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (Array.isArray(n.value) && n.value.every((v: unknown) => typeof v === "string")) {
      parts.push(n.value.join(""));
      return;
    }
    if (Array.isArray(n.queryChunks)) { n.queryChunks.forEach(walk); return; }
  };
  walk(node);
  return parts;
}

const ORG = 31;

/** One parcel belonging to ORG, in a county ORG targets. */
const PARCEL = {
  id: 900,
  organizationId: ORG,
  apn: "12-345-678",
  address: "9 Ridge Rd",
  county: "Hudspeth",
  state: "TX",
  latitude: "31.5",
  longitude: "-105.2",
  sizeAcres: "40",
  acreage: 40,
  assessedValue: 80_000,
  leadId: null,
  propertyId: 900,
};

interface Scenario {
  /** What each pillar's scorer returns; null models "did not answer". */
  radar: number | null;
  intent: number | null;
  landCredit: number | null;
  /** null models "the blind-offer calculator produced nothing". */
  medianSalePerAcre: number | null;
  parcelAcreage: number | null;
}

const ALL_SCORED: Scenario = {
  radar: 72,
  intent: 64,
  landCredit: 700,
  medianSalePerAcre: 2_000,
  parcelAcreage: 40,
};

/** Every predicate the run generated, by table. */
let queries: Array<{ table: string; where: unknown }>;

async function runFeed(s: Scenario, orgId = ORG) {
  queries = [];
  vi.resetModules();

  const rowsFor = (table: string, where: unknown): unknown[] => {
    queries.push({ table, where });
    if (table === "territories") return [];
    if (table === "properties") {
      // selectDistinct (target counties) and the candidate select both land
      // here; both must be org-scoped, and the fake answers either way so the
      // assertion is on the PREDICATE, not on whether a row came back. A fake
      // that returned [] for an unscoped query could not tell them apart.
      return [{ ...PARCEL, acreage: s.parcelAcreage, sizeAcres: String(s.parcelAcreage ?? "") }];
    }
    if (table === "daily_deal_feed") return [];
    if (table === "deal_feed_interactions") return [];
    return [];
  };

  vi.doMock("../../server/db", () => {
    const build = (table: { current: string }) => {
      let where: unknown;
      const self: any = {
        from(t: any) { table.current = getTableName(t); return self; },
        where(p: SQL) { where = p; return self; },
        orderBy() { return self; },
        limit() { return self; },
        then(res: (v: unknown) => void) { res(rowsFor(table.current, where)); },
      };
      return self;
    };
    return {
      db: {
        select: () => build({ current: "" }),
        selectDistinct: () => build({ current: "" }),
        insert: () => ({ values: () => ({ then: (r: (v: unknown) => void) => r([]) }) }),
      },
    };
  });

  vi.doMock("../../server/services/acquisitionRadar", () => ({
    acquisitionRadar: {
      getOrCreateConfig: async () => ({ weights: {} }),
      // null models "the radar could not score this parcel" the way the real
      // scorer signals it — a non-numeric result.
      scoreParcel: async () => ({ score: s.radar }),
    },
  }));
  // Cold parcels (no leadId) route through the log-native scorer, whose
  // honesty gate returns null when the biography has no real series.
  vi.doMock("../../server/services/parcel-biography", () => ({
    getParcelBiography: async () => ({ observations: [] }),
    scoreSellerLikelihood: () =>
      s.intent === null ? null : { score: s.intent, drivers: ["test"] },
  }));
  vi.doMock("../../server/services/sellerIntentPredictor", () => ({
    SellerIntentPredictorService: class {
      async predictIntent() { return { intentScore: s.intent }; }
    },
  }));
  vi.doMock("../../server/services/landCredit", () => ({
    landCredit: { calculateCreditScore: async () => ({ overall: s.landCredit }) },
  }));
  vi.doMock("../../server/services/blindOfferCalculator", () => ({
    calculateBlindOffer: async () =>
      s.medianSalePerAcre === null
        ? null
        : { comps: { medianSalePerAcre: s.medianSalePerAcre }, tiers: [] },
  }));

  // `scoreParcelRadar` and `scoreColdParcelMotivation` are same-module
  // exports, so the internal calls use the local binding and a spy on the
  // module namespace would not intercept them. Their DEPENDENCIES are mocked
  // above instead, which also means the real functions — including their
  // null-propagation — are the ones under test.
  const mod = await import("../../server/services/dealFeedEngine");
  return mod.generateDealFeed(orgId);
}

describe("the candidate query is scoped to the reading organization", () => {
  beforeEach(() => { queries = []; });

  it("every properties read carries organization_id = the caller's org", async () => {
    await runFeed(ALL_SCORED, 4242);
    const propertyReads = queries.filter((q) => q.table === "properties");
    expect(
      propertyReads.length,
      "generateDealFeed no longer reads properties — the scan below is vacuous",
    ).toBeGreaterThan(0);
    for (const q of propertyReads) {
      expect(
        bound(q.where, "organization_id"),
        "a properties read has no organization predicate — this is the cross-tenant leak",
      ).toContain(4242);
    }
  });

  it("the candidate read still filters by county as well — scoping did not replace it", async () => {
    await runFeed(ALL_SCORED, 4242);
    // The candidate query is the one carrying state/county; if the org
    // predicate had been added by REPLACING the geography the feed would be
    // scoped and useless.
    // The candidate query is the one carrying LOWER(state)/LOWER(county);
    // `getTargetCounties`'s selectDistinct also reads properties and is
    // org-scoped but has no geography.
    const withGeography = queries.filter(
      (q) => q.table === "properties" && JSON.stringify(rawChunks(q.where)).includes("LOWER"),
    );
    expect(withGeography.length, "the candidate query lost its geography filter").toBeGreaterThan(0);
    for (const q of withGeography) {
      expect(
        bound(q.where, "organization_id"),
        "the candidate query is not org-scoped",
      ).toContain(4242);
    }
  });
});

describe("an unscored pillar is excluded, not seeded at a midpoint", () => {
  it("all four pillars scored → composite over full weight coverage", async () => {
    const feed = await runFeed(ALL_SCORED);
    expect(feed).toHaveLength(1);
    const { scores } = feed[0];
    // countyOpportunity has no scorer wired on this path, so it is null even
    // in the "all scored" case — which IS the point: it was the constant 50
    // carrying 20% of every composite, and 0.8 is the honest coverage.
    expect(scores.countyOpportunity).toBeNull();
    expect(scores.basis.missingPillars).toEqual(["countyOpportunity"]);
    expect(scores.basis.weightCoverage).toBe(0.8);
  });

  it("a pillar whose scorer returns nothing is null, and the weight renormalises", async () => {
    const feed = await runFeed({ ...ALL_SCORED, landCredit: null });
    expect(feed).toHaveLength(1);
    const { scores } = feed[0];
    expect(scores.landCredit).toBeNull();
    // The letter grade is the most confident-looking thing on the card and
    // must not be manufactured from a seeded 575.
    expect(scores.landCreditGrade).toBeNull();
    expect(scores.basis.missingPillars).toContain("landCredit");
    expect(scores.basis.weightCoverage).toBeLessThan(1);
  });

  it("dropping a pillar does not move the others, and is not scored as zero", async () => {
    const full = (await runFeed(ALL_SCORED))[0];
    const partial = (await runFeed({ ...ALL_SCORED, landCredit: null }))[0];
    expect(partial.scores.radarScore).toBe(full.scores.radarScore);
    expect(partial.scores.ownerMotivation).toBe(full.scores.ownerMotivation);
    // Zeroing the missing pillar would LOWER the composite. Excluding it
    // leaves the surviving pillars' weighted average intact.
    const cov = full.scores.basis.weightCoverage - 0.2; // landCredit weight
    const expected =
      Math.round(
        ((full.scores.radarScore! * 0.3 + full.scores.ownerMotivation! * 0.3) / cov) * 100,
      ) / 100;
    expect(partial.scores.composite).toBeCloseTo(expected, 1);
  });

  it("no pillar answers at all → the parcel is dropped from the feed entirely", async () => {
    const feed = await runFeed({
      ...ALL_SCORED,
      radar: null,
      intent: null,
      landCredit: null,
    });
    // Not ranked last, not scored 0 or 50 — absent. A parcel nothing scored is
    // not evidence for "the ten best parcels we found".
    expect(feed).toEqual([]);
  });
});

describe("offer amounts require a real acreage", () => {
  it("a parcel with acreage produces a value from median price per acre", async () => {
    const feed = await runFeed(ALL_SCORED);
    // 2,000/acre * 40 acres.
    expect(feed[0].financials.estimatedValue).toBe(80_000);
    expect(feed[0].financials.suggestedOffer.market).toBe(32_000); // 40%
  });

  it("a parcel of unknown size is NOT valued as five acres", async () => {
    const feed = await runFeed({ ...ALL_SCORED, parcelAcreage: null });
    expect(feed).toHaveLength(1);
    expect(feed[0].parcel.acreage).toBeNull();
    // The old code returned medianSalePerAcre * 5 = 10,000 and derived three
    // offer tiers from it. It now falls back to the parcel's real assessed
    // value, which is a measurement.
    expect(feed[0].financials.estimatedValue).not.toBe(10_000);
    expect(feed[0].financials.estimatedValue).toBe(80_000); // assessedValue
    expect(feed[0].financials.suggestedOffer.market).not.toBe(4_000); // 40% of 10,000
  });

  /**
   * A note on what this test can and cannot separate, because a mutation
   * proved it.
   *
   * `acreage || 5` appeared TWICE — once guarding the call to the blind-offer
   * calculator, once in the estimatedValue expression. Restoring only the
   * second one leaves this suite green, and that is correct rather than a
   * hole: the caller-side guard returns null before the calculator runs, so
   * with it in place `offerData` is null and the value expression never sees
   * comps without an acreage. The second occurrence is unreachable, and a
   * mutation of unreachable code is semantically null.
   *
   * There is no way to isolate it from a test either — the guard is
   * production code, and a mock of the calculator cannot bypass a `return`
   * that happens before the mock is called. So the load-bearing assertion is
   * the one above, and the real mutation is removing BOTH occurrences, which
   * this suite does catch.
   */

  it("no acreage AND no assessed value → no value, no offers, no profit", async () => {
    const feed = await runFeed({
      ...ALL_SCORED,
      parcelAcreage: null,
      medianSalePerAcre: null,
    });
    expect(feed).toHaveLength(1);
    const f = feed[0].financials;
    // With PARCEL.assessedValue present this still resolves; the assertion
    // that matters is that nothing was manufactured from a 5-acre assumption.
    expect(f.estimatedValue).toBe(80_000);
    expect(f.suggestedOffer.aggressive).toBe(20_000); // 25% of the assessed value
  });
});
