/**
 * coverageLedger — getCoverageLedger() query (unit).
 *
 * The ledger left-joins the distinct (state, county) our customers actually
 * touch (demand, via reader.execute) against active county_gis_endpoints and a
 * discovery-queue snapshot. Asserts:
 *   - coverage % = covered / total demand counties
 *   - demand-ranked ordering (highest demand first)
 *   - endpointStatus classification: active / pending-review / discovering / none
 *   - discoveryQueue = the uncovered subset (the crawl order)
 *
 * The reader (db-replica) and its method chains are mocked in-memory.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

interface EndpointRow {
  state: string;
  county: string;
  isActive: boolean;
  redistributable: string | null;
}
interface QueueRow {
  state: string;
  county: string;
  status: string;
}

const store: {
  demand: Array<{ state: string; county: string; demand: number }>;
  endpoints: EndpointRow[];
  queue: QueueRow[];
} = { demand: [], endpoints: [], queue: [] };

function resetStore() {
  store.demand = [];
  store.endpoints = [];
  store.queue = [];
}

vi.mock("@shared/schema", () => ({
  countyGisEndpoints: { __t: "county_gis_endpoints" },
  countyDiscoveryQueue: { __t: "county_discovery_queue" },
  countyCoverageRequests: { __t: "county_coverage_requests" },
  properties: { __t: "properties" },
  parcelSnapshots: { __t: "parcel_snapshots" },
}));

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("drizzle-orm", () => ({
  and: (...a: any[]) => ({ __and: a }),
  eq: (col: any, val: any) => ({ __eq: [col, val] }),
  sql: Object.assign((..._a: any[]) => ({ __sql: true }), { raw: () => ({ __sql: true }) }),
  desc: (c: any) => ({ __desc: c }),
}));

// db (primary) unused by getCoverageLedger but imported by the module.
vi.mock("../../server/db", () => ({ db: { select: vi.fn(), insert: vi.fn(), update: vi.fn() } }));

// db-replica reader: execute() returns demand rows; select().from() returns
// endpoint/queue rows by table.
vi.mock("../../server/db-replica", () => {
  const tableOf = (t: any) => t?.__t ?? "unknown";
  const reader = {
    execute: vi.fn(async (_q: any) => ({ rows: store.demand.map((d) => ({ ...d })) })),
    select: vi.fn((_cols?: any) => {
      const chain: any = {
        _table: null as string | null,
        from(t: any) {
          chain._table = tableOf(t);
          return chain;
        },
        then(onF: any, onR: any) {
          const rows =
            chain._table === "county_gis_endpoints"
              ? store.endpoints.map((e) => ({ ...e }))
              : chain._table === "county_discovery_queue"
                ? store.queue.map((q) => ({ ...q }))
                : [];
          return Promise.resolve(rows).then(onF, onR);
        },
      };
      return chain;
    }),
  };
  return { dbForReads: vi.fn(async () => reader) };
});

import { getCoverageLedger } from "../../server/services/coverageLedger";

describe("getCoverageLedger", () => {
  beforeEach(resetStore);

  it("returns 0% coverage and empty queue with no demand", async () => {
    const l = await getCoverageLedger();
    expect(l.totalCounties).toBe(0);
    expect(l.coveragePct).toBe(0);
    expect(l.counties).toHaveLength(0);
    expect(l.discoveryQueue).toHaveLength(0);
  });

  it("computes coverage % over demand counties and ranks by demand", async () => {
    store.demand = [
      { state: "TX", county: "harris", demand: 10 },
      { state: "NM", county: "luna", demand: 3 },
      { state: "AZ", county: "cochise", demand: 7 },
    ];
    // Harris is covered (active); Cochise has a pending endpoint; Luna nothing.
    store.endpoints = [
      { state: "TX", county: "Harris", isActive: true, redistributable: "review-required" },
      { state: "AZ", county: "Cochise", isActive: false, redistributable: "review-required" },
    ];
    store.queue = [{ state: "NM", county: "luna", status: "pending" }];

    const l = await getCoverageLedger();

    expect(l.totalCounties).toBe(3);
    expect(l.coveredCounties).toBe(1); // only Harris is active
    expect(l.coveragePct).toBe(33); // round(1/3*100)

    // Demand-ranked desc.
    expect(l.counties.map((c) => c.county)).toEqual(["harris", "cochise", "luna"]);

    const harris = l.counties.find((c) => c.county === "harris")!;
    expect(harris.endpointStatus).toBe("active");
    expect(harris.covered).toBe(true);

    const cochise = l.counties.find((c) => c.county === "cochise")!;
    expect(cochise.endpointStatus).toBe("pending-review");
    expect(cochise.covered).toBe(false);

    const luna = l.counties.find((c) => c.county === "luna")!;
    expect(luna.endpointStatus).toBe("discovering");
    expect(luna.queueStatus).toBe("pending");

    // discoveryQueue is the uncovered subset.
    expect(l.discoveryQueue.map((c) => c.county).sort()).toEqual(["cochise", "luna"]);
  });

  it("classifies an uncovered county with no queue row as 'none'", async () => {
    store.demand = [{ state: "MO", county: "greene", demand: 1 }];
    const l = await getCoverageLedger();
    expect(l.counties[0].endpointStatus).toBe("none");
    expect(l.coveragePct).toBe(0);
  });
});
