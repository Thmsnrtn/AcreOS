/**
 * D2f end to end for one wave-1 state (Indiana): parcel → the REAL
 * DataSourceBroker (its EPA FRS + environmental queries) → the screening
 * adapters → findings → verdict.
 *
 * Only the network and the database are faked: fetch serves SYNTHETIC
 * payloads from tests/fixtures/screening/in/ (shaped to the fields the broker
 * parses — see that folder's README), and db is an empty chainable stub (no
 * data_sources rows, no cache), so the broker takes its built-in federal path.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

function makeDbStub(resolved: unknown[] = []) {
  const handler: ProxyHandler<object> = {
    get(_t, prop) {
      if (prop === "then") return (onF: (v: unknown) => unknown) => Promise.resolve(resolved).then(onF);
      if (prop === "catch") return () => Promise.resolve(undefined);
      return () => proxy;
    },
  };
  const proxy: object = new Proxy(function () {}, handler);
  return proxy;
}
vi.mock("../../server/db", () => ({ db: makeDbStub([]) }));
vi.mock("../../server/storage", () => ({ storage: {} }));

const FIX = path.resolve(__dirname, "../fixtures/screening/in");
function fixture(name: string): { synthetic: boolean; payload: unknown } {
  return JSON.parse(fs.readFileSync(path.join(FIX, name), "utf8"));
}
const parcelFixture = JSON.parse(fs.readFileSync(path.join(FIX, "parcel.json"), "utf8"));

type Route = { match: string; file?: string; status?: number };
const ROUTE_KEYS = ["frs_rest_services", "efservice/tri_facility", "echo_rest_services", "UST_Finder"] as const;

function installFetch(routes: Route[]) {
  const spy = vi.fn(async (input: unknown) => {
    const url = String(input);
    const route = routes.find((r) => url.includes(r.match));
    if (!route) throw new Error(`unexpected fetch in test: ${url}`);
    if (route.status && route.status !== 200) {
      return { ok: false, status: route.status, json: async () => ({}) };
    }
    const body = fixture(route.file ?? "");
    expect(body.synthetic).toBe(true);
    return { ok: true, status: 200, json: async () => body.payload };
  });
  global.fetch = spy as unknown as typeof fetch;
  return spy;
}

const EMPTY: Route[] = [
  { match: "frs_rest_services", file: "frs-empty.json" },
  { match: "efservice/tri_facility", file: "tri-empty.json" },
  { match: "echo_rest_services", file: "echo-zero.json" },
  { match: "UST_Finder", file: "ust-zero.json" },
];
function withRoute(over: Route): Route[] {
  return EMPTY.map((r) => (r.match === over.match ? over : r));
}

describe("historical-use screening, Indiana end to end through the real broker", () => {
  const originalFetch = global.fetch;
  let mod: typeof import("../../server/services/screening/historicalUseSources");
  let DataSourceBroker: typeof import("../../server/services/data-source-broker").DataSourceBroker;
  let lookup: NonNullable<Parameters<typeof mod.screenParcelHistoricalUse>[1]>;
  const subject = {
    parcelRef: parcelFixture.parcelRef,
    state: parcelFixture.state,
    county: parcelFixture.county,
    centroid: parcelFixture.centroid,
    synthetic: parcelFixture.synthetic,
  };

  beforeEach(async () => {
    vi.resetModules();
    mod = await import("../../server/services/screening/historicalUseSources");
    ({ DataSourceBroker } = await import("../../server/services/data-source-broker"));
    const broker = new DataSourceBroker();
    lookup = (category, options) => broker.lookup(category, options);
  });
  afterEach(() => {
    global.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it("FRS records → adverse_found with provenance; the record with no REGISTRY_ID is reported, not dropped", async () => {
    const spy = installFetch(withRoute({ match: "frs_rest_services", file: "frs-two-facilities.json" }));
    const v = await mod.screenParcelHistoricalUse(subject, lookup);

    // Every upstream was actually reached (the population is the four calls).
    for (const key of ROUTE_KEYS) expect(spy.mock.calls.some(([u]) => String(u).includes(key))).toBe(true);
    // ECHO and UST share one broker "environmental" call: TRI fetched once.
    expect(spy.mock.calls.filter(([u]) => String(u).includes("efservice/tri_facility"))).toHaveLength(1);

    expect(v.verdict).toBe("adverse_found");
    if (v.verdict !== "adverse_found") return;
    expect(v.synthetic).toBe(true);
    expect(v.findings).toHaveLength(1);
    const f = v.findings[0];
    expect(f.recordId).toBe("SYNTHETIC-FRS-1");
    expect(f.category).toBe("rcra");
    expect(f.sourceFields.INTEREST_TYPES).toBe("RCRAINFO, NPDES");
    expect(f.relationship).toEqual({ kind: "within_query_radius", radiusMiles: 5, distanceMiles: expect.any(Number) });
    if (f.relationship.kind === "within_query_radius") {
      // 0.0133° of latitude ≈ 0.92 mi.
      expect(f.relationship.distanceMiles).toBeGreaterThan(0.85);
      expect(f.relationship.distanceMiles).toBeLessThan(1.0);
    }
    expect(v.inconclusive.some((i) => i.sourceId === "epa_frs" && /no record id/.test(i.reason))).toBe(true);
    // Licence-unresolved and missing sources are disclosed on the verdict.
    const ns = v.notScreened.map((n) => n.sourceId);
    expect(ns).toEqual(expect.arrayContaining(["epa_tri", "state_tank_registry", "historical_aerials", "usgs_htmc"]));
  });

  it("everything empty → inconclusive, not no-adverse: no broker-backed adapter has a positive control yet", async () => {
    installFetch(EMPTY);
    const v = await mod.screenParcelHistoricalUse(subject, lookup);
    expect(v.verdict).toBe("inconclusive");
    expect(v.verifiedAbsences).toHaveLength(0);
    expect(v.inconclusive.map((i) => i.sourceId).sort()).toEqual(
      ["epa_echo_current_violations", "epa_frs", "epa_ust_finder"],
    );
    expect(v.statement).toMatch(/not a finding of no adverse use/);
  });

  it("an unreachable FRS → inconclusive with the broker's reason", async () => {
    installFetch(withRoute({ match: "frs_rest_services", status: 503 }));
    const v = await mod.screenParcelHistoricalUse(subject, lookup);
    expect(v.verdict).toBe("inconclusive");
    const frs = v.inconclusive.find((i) => i.sourceId === "epa_frs");
    expect(frs?.reason).toMatch(/source unreachable: .*503/);
  });

  it("an unreachable ECHO sub-query → that source inconclusive (the broker's null, never a 0)", async () => {
    installFetch(withRoute({ match: "echo_rest_services", status: 500 }));
    const v = await mod.screenParcelHistoricalUse(subject, lookup);
    const echo = v.inconclusive.find((i) => i.sourceId === "epa_echo_current_violations");
    expect(echo?.reason).toMatch(/source unreachable: .*ECHO/);
  });

  it("an ECHO violation count with no records → inconclusive, cited as a count", async () => {
    installFetch(withRoute({ match: "echo_rest_services", file: "echo-two.json" }));
    const v = await mod.screenParcelHistoricalUse(subject, lookup);
    expect(v.verdict).toBe("inconclusive");
    const echo = v.inconclusive.find((i) => i.sourceId === "epa_echo_current_violations");
    expect(echo?.reason).toMatch(/2 matching records/);
  });

  it("production adapters: every licence key resolves in the register, and none claims a synthetic positive control", async () => {
    const { mayCacheAndRedistribute } = await import("../../server/services/providers/data-licenses");
    const adapters = mod.createEpaBrokerAdapters(lookup);
    expect(adapters.length).toBeGreaterThanOrEqual(3);
    for (const a of adapters) {
      expect(mayCacheAndRedistribute(a.licenseSource)).toBe(true);
      if (a.absenceEligibility.eligible) expect(a.absenceEligibility.positiveControl.synthetic).toBe(false);
    }
  });
});
