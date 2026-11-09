/**
 * County list builder v0 (W10.3, draft W4.10) — REAL BUT GATED.
 *
 * Production builds no list query and no import leg, so every geography is
 * refused. These tests inject a counting source and an import leg (fixtures,
 * never customer-reachable) so that EACH refusal can be shown to be the thing
 * refusing, with every other condition satisfied:
 *
 *  (a) the lookup gate: a seeded state whose statewide source is not cleared
 *      for lookup is refused before its source is asked — for every seeded
 *      state, through the HTTP route called directly; clearing it (the
 *      registry flip) admits it;
 *  (b) rights: a cleared source without display/keep/mail rights is refused;
 *  (c) the import leg and the vendor layers' missing price keep everything dark;
 *  (d) the quote contract: no pull without the quote's digest, a stale or
 *      foreign digest is refused, the price is re-checked at pull, the charge
 *      equals the quoted cost (free → no pool debit), a filter the source
 *      cannot answer is refused, an oversized list is refused, never truncated;
 *  (e) org scoping: one org's quote cannot be pulled by another.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const h = vi.hoisted(() => ({
  /** state → overrides on the REAL registry entry. */
  lookupCleared: new Set<string>(),
  rightsGranted: new Set<string>(),
  org: 7,
  user: "user_a",
}));

vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/auth/clerkAuth", () => ({ isAuthenticated: (_q: unknown, _s: unknown, next: () => void) => next() }));
vi.mock("../../server/middleware/getOrCreateOrg", () => ({
  getOrCreateOrg: (req: { organization?: unknown; user?: unknown }, _s: unknown, next: () => void) => {
    req.organization = { id: h.org };
    req.user = { id: h.user, claims: { sub: h.user } };
    next();
  },
}));
vi.mock("../../server/utils/permissions", () => ({ requirePermission: () => (_q: unknown, _s: unknown, next: () => void) => next() }));
vi.mock("../../server/services/creditPool", () => ({ poolDebit: vi.fn(), refundPoolDebit: vi.fn() }));
vi.mock("../../server/services/openData/statewideSourceRegistry", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../server/services/openData/statewideSourceRegistry")>();
  return {
    ...real,
    statewideSource: (state: string, now?: Date) => {
      const entry = real.statewideSource(state, now);
      if (!entry) return entry;
      const st = state.toUpperCase();
      return {
        ...entry,
        lookup: h.lookupCleared.has(st)
          ? { status: "cleared" as const, determination: "TEST FIXTURE", evidence: "TEST FIXTURE", evidenceUrl: "https://example.test/terms", decidedOn: "2026-11-06" }
          : entry.lookup,
        policy: h.rightsGranted.has(st) ? { ...entry.policy, can_display: true, can_cache: true, can_mail: true } : entry.policy,
      };
    },
  };
});

import { createListBuilder } from "../../server/services/landData/listBuilder";
import { registerLandDataRoutes } from "../../server/routes-land-data";
import { countyGisProvider } from "../../server/services/providers/county-gis-provider";
import { poolDebit } from "../../server/services/creditPool";
import { STATEWIDE_PARCEL_ENDPOINTS } from "../../server/services/statewideParcelEndpoints";

const counted: string[] = [];
const imports: Array<{ organizationId: number; credits: number; count: number }> = [];
function countingSource(n: number | (() => number), filters: string[] = ["acreage"]) {
  return {
    filters: new Set(filters) as ReadonlySet<"acreage" | "ownerType" | "yearsOwned">,
    count: async (q: { state: string }) => {
      counted.push(q.state);
      return typeof n === "function" ? n() : n;
    },
  };
}
const importLeg = async (a: { organizationId: number; quote: { cost: { credits: number }; count: number } }) => {
  imports.push({ organizationId: a.organizationId, credits: a.quote.cost.credits, count: a.quote.count });
  return { imported: a.quote.count, duplicatesSkipped: 0 };
};
const allStates = () => Object.fromEntries(STATEWIDE_PARCEL_ENDPOINTS.map((e) => [e.state, countingSource(42)]));

function appWith(builder = createListBuilder()) {
  const a = express();
  a.use(express.json());
  registerLandDataRoutes(a, builder);
  return a;
}
const body = (state: string, filters: Record<string, unknown> = { acreageMin: 5 }) => ({ state, county: "Some County", filters });

beforeEach(() => {
  h.lookupCleared.clear();
  h.rightsGranted.clear();
  h.org = 7;
  counted.length = 0;
  imports.length = 0;
  vi.mocked(poolDebit).mockClear();
  vi.restoreAllMocks();
});

describe("production: dark everywhere, decided before any source is asked", () => {
  it("serves no geography; every seeded state reports why", () => {
    const g = createListBuilder().geographies();
    expect(g.selectable).toEqual([]);
    expect(g.states.map((s) => s.state).sort()).toEqual(STATEWIDE_PARCEL_ENDPOINTS.map((e) => e.state).sort());
    expect(g.states.length).toBeGreaterThanOrEqual(9); // vacuity: the population this reads
    for (const s of g.states) {
      expect(s.status, s.state).toBe("endpoint");
      expect(s.layers.find((l) => l.layer === "open_data")!.reasons.join(" ")).toMatch(/not cleared/);
    }
    expect(g.blockers.join(" ")).toMatch(/purpose ledger/);
  });

  it("POST quote, called directly: 422 for a seeded and an unseeded state, no count, no cost", async () => {
    for (const st of ["FL", "WI", "TX"]) {
      const r = await request(appWith()).post("/api/land-data/list-builder/quote").send(body(st));
      expect(r.status, st).toBe(422);
      expect(r.body.details.code).toBe("not_cleared");
      expect(r.body).not.toHaveProperty("count");
      expect(r.body).not.toHaveProperty("quoteDigest");
    }
  });

  it("vendor layers stay dark: no price for a platform-paid pull, no keep or mail rights", () => {
    const fl = createListBuilder().geographies().states.find((s) => s.state === "FL")!;
    for (const id of ["regrid", "attom"]) {
      const v = fl.layers.find((l) => l.layer === id)!;
      expect(v.status).toBe("none");
      expect(v.reasons.join(" ")).toMatch(/no price set/);
      expect(v.reasons.join(" ")).toMatch(/does not let AcreOS keep/);
    }
  });
});

describe("(a) the lookup gate refuses every seeded state, even with a source, rights and an import leg", () => {
  it.each(STATEWIDE_PARCEL_ENDPOINTS.map((e) => e.state))("%s: gated → 422 and its source is never asked", async (st) => {
    h.rightsGranted.add(st);
    const app = appWith(createListBuilder({ sources: { open_data: allStates() }, importLeg }));
    const r = await request(app).post("/api/land-data/list-builder/quote").send(body(st));
    expect(r.status).toBe(422);
    expect(r.body.details.status).toBe("endpoint");
    expect(counted).toEqual([]);
  });

  it.each(STATEWIDE_PARCEL_ENDPOINTS.map((e) => e.state))("%s: the registry flip to cleared admits it (the gate is what refused)", async (st) => {
    h.rightsGranted.add(st);
    h.lookupCleared.add(st);
    const app = appWith(createListBuilder({ sources: { open_data: allStates() }, importLeg }));
    const r = await request(app).post("/api/land-data/list-builder/quote").send(body(st));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: "rights_qualified", layer: "open_data", count: 42, cost: { kind: "free", credits: 0 } });
    expect(counted).toEqual([st]);
  });

  it("an unseeded state is refused even when a source is injected for it", async () => {
    const b = createListBuilder({ sources: { open_data: { TX: countingSource(3) } }, importLeg });
    expect((await b.quote(1, { state: "TX", county: "Travis", filters: {} })).ok).toBe(false);
    expect(counted).toEqual([]);
  });
});

describe("(b, c) rights, the import leg and price each keep a cleared source dark", () => {
  it("cleared for lookup but no mail/keep/display rights → refused, source not asked", async () => {
    h.lookupCleared.add("WI"); // WI's real dossier: display + internal allowed, mail unresolved
    const r = await createListBuilder({ sources: { open_data: allStates() }, importLeg }).quote(1, body("WI"));
    expect(r).toMatchObject({ ok: false, code: "not_cleared", status: "list_ready" });
    if (!r.ok && r.code === "not_cleared") expect(r.layers.find((l) => l.layer === "open_data")!.reasons.join(" ")).toMatch(/addressing mail to the owners/);
    expect(counted).toEqual([]);
  });

  it("everything cleared but no import leg → refused", async () => {
    h.lookupCleared.add("FL");
    h.rightsGranted.add("FL");
    const r = await createListBuilder({ sources: { open_data: allStates() }, importLeg: null }).quote(1, body("FL"));
    expect(r).toMatchObject({ ok: false, code: "not_cleared", status: "lookup" });
    expect(counted).toEqual([]);
  });

  it("a paid vendor source with a query and a leg is still not quoted: no founder-set list price", async () => {
    const r = await createListBuilder({ sources: { regrid: { "*": countingSource(9) }, attom: { "*": countingSource(9) } }, importLeg }).quote(1, body("TX"));
    expect(r).toMatchObject({ ok: false, code: "not_cleared" });
    expect(counted).toEqual([]);
  });
});

describe("(d) the quote contract", () => {
  const admittedFL = (n: number | (() => number) = 120, filters?: string[]) => {
    h.lookupCleared.add("FL");
    h.rightsGranted.add("FL");
    return createListBuilder({ sources: { open_data: { FL: countingSource(n, filters) } }, importLeg });
  };

  it("no pull without the quote's digest; no Idempotency-Key → 400; a made-up digest → 409; nothing imported", async () => {
    const app = appWith(admittedFL());
    const noKey = await request(app).post("/api/land-data/list-builder/pull").send(body("FL"));
    expect(noKey.status).toBe(400);
    const noQuote = await request(app).post("/api/land-data/list-builder/pull").set("Idempotency-Key", "k1").send(body("FL"));
    expect(noQuote.status).toBe(400);
    expect(noQuote.body.details.code).toBe("quote_required");
    const forged = await request(app).post("/api/land-data/list-builder/pull").set("Idempotency-Key", "k1").send({ ...body("FL"), expectedQuoteDigest: "0".repeat(64) });
    expect(forged.status).toBe(409);
    expect(imports).toEqual([]);
  });

  it("quote → pull: the charge is the quoted cost (free) and the pool is never debited", async () => {
    const app = appWith(admittedFL());
    const q = await request(app).post("/api/land-data/list-builder/quote").send(body("FL"));
    expect(q.status).toBe(200);
    const p = await request(app).post("/api/land-data/list-builder/pull").set("Idempotency-Key", "k2").send({ ...body("FL"), expectedQuoteDigest: q.body.quoteDigest });
    expect(p.status).toBe(200);
    expect(p.body.charged).toEqual(q.body.cost);
    expect(imports).toEqual([{ organizationId: 7, credits: 0, count: 120 }]);
    expect(poolDebit).not.toHaveBeenCalled();
  });

  it("the count changed between quote and pull → 409 with the new quote, nothing imported", async () => {
    let n = 120;
    const app = appWith(admittedFL(() => n));
    const q = await request(app).post("/api/land-data/list-builder/quote").send(body("FL"));
    n = 121;
    const p = await request(app).post("/api/land-data/list-builder/pull").set("Idempotency-Key", "k3").send({ ...body("FL"), expectedQuoteDigest: q.body.quoteDigest });
    expect(p.status).toBe(409);
    expect(p.body.details.quote.count).toBe(121);
    expect(imports).toEqual([]);
  });

  it("the price is re-checked at pull: a source that stops being free is refused, nothing imported or charged", async () => {
    const app = appWith(admittedFL());
    const q = await request(app).post("/api/land-data/list-builder/quote").send(body("FL"));
    vi.spyOn(countyGisProvider, "costPerLookupCents").mockReturnValue(5);
    const p = await request(app).post("/api/land-data/list-builder/pull").set("Idempotency-Key", "k4").send({ ...body("FL"), expectedQuoteDigest: q.body.quoteDigest });
    expect(p.status).toBe(422);
    expect(imports).toEqual([]);
    expect(poolDebit).not.toHaveBeenCalled();
  });

  it("a filter the source cannot answer is refused, never ignored; an unknown filter is a validation failure", async () => {
    const app = appWith(admittedFL(120, ["acreage"]));
    const r = await request(app).post("/api/land-data/list-builder/quote").send(body("FL", { yearsOwned: 10 }));
    expect(r.status).toBe(422);
    expect(r.body.details).toMatchObject({ code: "filter_unsupported", unsupported: ["yearsOwned"] });
    const unknown = await request(app).post("/api/land-data/list-builder/quote").send(body("FL", { landUse: "ag" }));
    expect(unknown.status).toBe(422);
    expect(unknown.body.error).toBe("VALIDATION_FAILED");
    expect(counted).toEqual([]);
  });

  it("over the per-import ceiling the quote refuses with the numbers — never a silent cap", async () => {
    const r = await request(appWith(admittedFL(5_000))).post("/api/land-data/list-builder/quote").send(body("FL"));
    expect(r.status).toBe(422);
    expect(r.body.details).toMatchObject({ code: "list_too_large", count: 5_000, ceiling: 500 });
    expect(r.body).not.toHaveProperty("quoteDigest");
  });

  it("a source that fails or answers nonsense shows no number", async () => {
    const thrower = admittedFL(() => {
      throw new Error("down");
    });
    expect(await thrower.quote(1, body("FL") as never)).toEqual({ ok: false, code: "count_unavailable" });
    const nonsense = admittedFL(-1);
    expect(await nonsense.quote(1, body("FL") as never)).toEqual({ ok: false, code: "count_unavailable" });
  });
});

describe("(e) org scoping", () => {
  it("one org's quote cannot be pulled by another; the body cannot name an org", async () => {
    h.lookupCleared.add("FL");
    h.rightsGranted.add("FL");
    const app = appWith(createListBuilder({ sources: { open_data: { FL: countingSource(10) } }, importLeg }));
    h.org = 7;
    const q = await request(app).post("/api/land-data/list-builder/quote").send(body("FL"));
    h.org = 8;
    const p = await request(app).post("/api/land-data/list-builder/pull").set("Idempotency-Key", "k5").send({ ...body("FL"), expectedQuoteDigest: q.body.quoteDigest });
    expect(p.status).toBe(409);
    expect(imports).toEqual([]);
    const named = await request(app).post("/api/land-data/list-builder/quote").send({ ...body("FL"), organizationId: 7 });
    expect(named.status).toBe(422);
    expect(named.body.error).toBe("VALIDATION_FAILED");
  });
});
