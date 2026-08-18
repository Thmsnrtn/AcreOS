/**
 * Negotiation analytics — no invented figure beside a real one.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 * `GET /api/enhancements/negotiation-analytics` (live, authenticated) returned:
 *
 *     avgOffersToClose: <computed from deals>,
 *     avgDiscountFromAsking: 25,   // "Would be calculated from offer vs asking"
 *     avgNegotiationRounds:  2.3,  // "Would be calculated from offer history"
 *     winRate: <computed from deals>,
 *
 * Two literals and two real figures in one object, identically shaped. That
 * packaging is the dangerous kind — nothing in the response tells a caller
 * which half is measured. `lint:no-fabrication` scans for `Math.random`, so it
 * never saw either.
 *
 * ── WHAT THIS FILE PROVES ───────────────────────────────────────────────────
 * 1. No field is a constant: the same function over DIFFERENT data returns
 *    DIFFERENT values for all four. A literal cannot pass a test that varies
 *    the input and demands the output move — that is the semantic defect
 *    ("this number does not depend on the data"), not the symbol.
 * 2. An org with nothing recorded gets `null`, never `0` — a 0% win rate and a
 *    0% discount are measurements, and an empty pipeline is not one.
 * 3. Every query is scoped to the calling org.
 * 4. An offer with no recorded market-value percentage is excluded from the
 *    average rather than counted as a 0% offer.
 */

import { describe, it, expect, vi } from "vitest";
import { getTableName, type SQL } from "drizzle-orm";

/** Values bound against `column` in a drizzle predicate tree. */
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

/**
 * The literal SQL fragments in a drizzle predicate tree, concatenated.
 *
 * `JSON.stringify` cannot be used here: a drizzle column holds a back-pointer
 * to its table, so the tree is circular. This walks it instead and collects
 * only the StringChunk text, which is where `= 'closed_won'` lives.
 */
function rawSql(node: unknown): string {
  const parts: string[] = [];
  const seen = new Set<unknown>();
  const walk = (n: any): void => {
    if (n === null || typeof n !== "object") return;
    if (seen.has(n)) return;
    seen.add(n);
    if (Array.isArray(n)) { n.forEach(walk); return; }
    // StringChunk: { value: string[] }
    if (Array.isArray(n.value) && n.value.every((v: unknown) => typeof v === "string")) {
      parts.push(n.value.join(""));
      return;
    }
    if (Array.isArray(n.queryChunks)) { n.queryChunks.forEach(walk); return; }
  };
  walk(node);
  return parts.join(" ");
}

/** Column names referenced anywhere inside a drizzle expression. */
function columnsIn(node: unknown): string[] {
  const out: string[] = [];
  const seen = new Set<unknown>();
  const walk = (n: any): void => {
    if (n === null || typeof n !== "object") return;
    if (seen.has(n)) return;
    seen.add(n);
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (typeof n.name === "string" && n.table !== undefined) { out.push(n.name); return; }
    if (Array.isArray(n.queryChunks)) { n.queryChunks.forEach(walk); return; }
  };
  walk(node);
  return out;
}

interface Fixture {
  dealsNotNew: number;
  dealsClosedWon: number;
  offersRecorded: number;
  leadsWithOffers: number;
  offersWithPct: number;
  avgOfferPct: number | null;
  offersOnClosedWon: number;
}

const EMPTY: Fixture = {
  dealsNotNew: 0,
  dealsClosedWon: 0,
  offersRecorded: 0,
  leadsWithOffers: 0,
  offersWithPct: 0,
  avgOfferPct: null,
  offersOnClosedWon: 0,
};

const ORG = 41;

/**
 * The service issues four counting selects. They are told apart by the table
 * and by which predicate they carry, so a query that changed table or dropped
 * its org scope stops matching and the assertions below notice.
 */
async function analytics(f: Fixture, orgId = ORG) {
  vi.resetModules();
  const wheres: Array<{ table: string; joined: string | null; where: unknown; fields: string[] }> = [];
  const selectedFields: Array<Record<string, unknown>> = [];

  vi.doMock("../../server/db", () => ({
    db: {
      select(fields: Record<string, unknown> = {}) {
        const ctx: { table: string; joined: string | null; where: unknown } = {
          table: "", joined: null, where: undefined,
        };
        selectedFields.push(fields);
        const self: any = {
          from(t: any) { ctx.table = getTableName(t); return self; },
          innerJoin(t: any) { ctx.joined = getTableName(t); return self; },
          where(p: SQL) { ctx.where = p; return self; },
          then(res: (v: unknown) => void) {
            const names = Object.keys(fields);
            wheres.push({ ...ctx, fields: names });
            const isDeals = ctx.table === "deals";
            const isOffers = ctx.table === "offers";
            const src = rawSql(ctx.where);
            if (isDeals) {
              // closed_won vs != 'new' — read off the raw SQL fragment.
              res([{ count: src.includes("closed_won") ? f.dealsClosedWon : f.dealsNotNew }]);
              return;
            }
            if (isOffers && ctx.joined === "deals") {
              res([{ n: f.offersOnClosedWon }]);
              return;
            }
            if (isOffers && names.includes("avgPct")) {
              res([{ avgPct: f.avgOfferPct === null ? null : String(f.avgOfferPct), n: f.offersWithPct }]);
              return;
            }
            if (isOffers) {
              res([{ offersRecorded: f.offersRecorded, leadsWithOffers: f.leadsWithOffers }]);
              return;
            }
            res([]);
          },
        };
        return self;
      },
    },
  }));

  const { getNegotiationAnalytics } = await import(
    "../../server/services/negotiationEnhancements"
  );
  const result = await getNegotiationAnalytics(orgId);
  return { result, wheres, selectedFields };
}

describe("getNegotiationAnalytics — nothing recorded means null, not zero", () => {
  it("an org with no deals and no offers gets null on every metric", async () => {
    const { result } = await analytics(EMPTY);
    expect(result.avgOffersToClose).toBeNull();
    expect(result.avgDiscountFromMarketValuePct).toBeNull();
    expect(result.avgNegotiationRounds).toBeNull();
    expect(result.winRate).toBeNull();
    // Zero would be a measurement. None of these may be one.
    expect(Object.values(result).filter((v) => v === 0)).toEqual([]);
  });

  it("the basis block reports the empty populations honestly", async () => {
    const { result } = await analytics(EMPTY);
    expect(result.basis).toEqual({
      dealsConsidered: 0,
      dealsClosedWon: 0,
      offersRecorded: 0,
      offersWithMarketValuePct: 0,
      leadsWithOffers: 0,
    });
  });
});

describe("every field moves with the data — none is a constant", () => {
  const A: Fixture = {
    dealsNotNew: 20,
    dealsClosedWon: 5,
    offersRecorded: 30,
    leadsWithOffers: 12,
    offersWithPct: 24,
    avgOfferPct: 72,
    offersOnClosedWon: 11,
  };
  const B: Fixture = {
    dealsNotNew: 40,
    dealsClosedWon: 8,
    offersRecorded: 90,
    leadsWithOffers: 18,
    offersWithPct: 60,
    avgOfferPct: 55,
    offersOnClosedWon: 32,
  };

  it("computes each field from its own inputs, hand-checked", async () => {
    const { result } = await analytics(A);
    expect(result.winRate).toBe(25); // 5 / 20
    expect(result.avgOffersToClose).toBe(2.2); // 11 / 5
    expect(result.avgNegotiationRounds).toBe(2.5); // 30 / 12
    expect(result.avgDiscountFromMarketValuePct).toBe(28); // 100 - 72
    expect(result.basis.offersWithMarketValuePct).toBe(24);
  });

  it("a different org's data produces a different answer in EVERY field", async () => {
    const a = (await analytics(A)).result;
    const b = (await analytics(B)).result;
    // This is the assertion a hardcoded 25 / 2.3 cannot survive.
    expect(b.winRate).not.toBe(a.winRate);
    expect(b.avgOffersToClose).not.toBe(a.avgOffersToClose);
    expect(b.avgNegotiationRounds).not.toBe(a.avgNegotiationRounds);
    expect(b.avgDiscountFromMarketValuePct).not.toBe(a.avgDiscountFromMarketValuePct);
    expect(b.avgDiscountFromMarketValuePct).toBe(45); // 100 - 55
  });

  it("the discount averages only the offers that carry a percentage", async () => {
    // 60 offers on file, only 12 carrying a percentage, averaging 80%.
    const { result } = await analytics({
      ...A,
      offersRecorded: 60,
      offersWithPct: 12,
      avgOfferPct: 80,
    });
    expect(result.avgDiscountFromMarketValuePct).toBe(20); // 100 - 80
    // The two populations are reported separately, so a caller can see that
    // the discount rests on 12 rows while 60 offers exist.
    expect(result.basis.offersRecorded).toBe(60);
    expect(result.basis.offersWithMarketValuePct).toBe(12);
  });

  it("the reported denominator counts the COLUMN, not the rows", async () => {
    // This is the load-bearing choice, and it is not visible in the returned
    // numbers: SQL's `avg()` already skips NULLs, so dropping the
    // `IS NOT NULL` predicate is semantically equivalent and a behavioural
    // assertion cannot tell the difference. `count(offer_percentage)` vs
    // `count(*)` CAN differ — the latter would report 60 offers as the basis
    // for an average taken over 12, which is the honesty claim this field
    // makes. So it is pinned on the generated expression.
    const { selectedFields } = await analytics(A);
    const pctSelect = selectedFields.find((f) => "avgPct" in f);
    expect(pctSelect, "the percentage aggregate query is gone").toBeDefined();
    expect(
      columnsIn(pctSelect!.n),
      "the basis count no longer counts offer_percentage",
    ).toContain("offer_percentage");
    expect(columnsIn(pctSelect!.avgPct)).toContain("offer_percentage");
  });

  it("no closed-won deal means no offers-to-close average", async () => {
    const { result } = await analytics({ ...A, dealsClosedWon: 0, offersOnClosedWon: 0 });
    expect(result.avgOffersToClose).toBeNull();
    expect(result.winRate).toBe(0); // 0 of 20 closed IS a measurement
  });
});

describe("every query is scoped to the calling organization", () => {
  it("each select carries organization_id = the caller's org", async () => {
    const { wheres } = await analytics({
      dealsNotNew: 3, dealsClosedWon: 1, offersRecorded: 4,
      leadsWithOffers: 2, offersWithPct: 4, avgOfferPct: 60, offersOnClosedWon: 2,
    }, 999);
    // Five: deals(closed_won), deals(!= new), offers(avg pct), offers(totals),
    // offers x deals(closed_won). Pinned so a query added later has to be
    // org-scoped to pass the loop below rather than slipping in unchecked.
    expect(wheres.length, "the service's query set changed").toBe(5);
    for (const w of wheres) {
      expect(
        bound(w.where, "organization_id"),
        `${w.table}${w.joined ? `+${w.joined}` : ""} query is not org-scoped`,
      ).toContain(999);
    }
    // The join must scope BOTH sides — a deals row from another tenant reached
    // through an offers row of ours is still a cross-tenant read.
    const joined = wheres.find((w) => w.joined === "deals");
    expect(joined, "the offers-to-close join is gone").toBeDefined();
    expect(bound(joined!.where, "organization_id").filter((v) => v === 999)).toHaveLength(2);
  });
});
