/**
 * coverageLedger — discovery-on-miss enqueue + validate logic (unit).
 *
 * Covers the Iris/Iyari demand-driven coverage growth:
 *   - enqueueCountyForDiscovery(): new enqueue / demand bump / already-covered.
 *   - discoverCountyEndpoint(): the confidence-gated state machine —
 *       validated + live feature   → endpoint flipped isActive=true, queue resolved
 *       validated but no feature   → endpoint inserted isActive=false (review-pending)
 *       no candidate               → queue failed, then exhausted at maxAttempts
 *     The ArcGIS probe is fully injected so NO network is touched.
 *   - Beatrice rule: a freshly-discovered endpoint is NEVER auto-marked fully
 *     redistributable — it stays redistributable='review-required'.
 *
 * `server/db` is mocked with an in-memory store honouring the exact Drizzle
 * chains the service uses.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── In-memory store ─────────────────────────────────────────────────────────

interface EndpointRow {
  id: number;
  state: string;
  county: string;
  baseUrl: string;
  isActive: boolean;
  isVerified: boolean;
  redistributable: string;
  layerId: string;
  apnField: string;
  ownerField: string;
  [k: string]: any;
}

interface QueueRow {
  id: number;
  state: string;
  county: string;
  demandCount: number;
  priority: number;
  status: string;
  attempts: number;
  maxAttempts: number;
  resolvedEndpointId: number | null;
  lastResult: string | null;
  [k: string]: any;
}

interface CoverageReqRow {
  id: number;
  queueId: number | null;
  status: string;
  [k: string]: any;
}

const store: {
  endpoints: EndpointRow[];
  queue: QueueRow[];
  coverageReqs: CoverageReqRow[];
  nextEndpointId: number;
  nextQueueId: number;
} = {
  endpoints: [],
  queue: [],
  coverageReqs: [],
  nextEndpointId: 1,
  nextQueueId: 1,
};

function resetStore() {
  store.endpoints = [];
  store.queue = [];
  store.coverageReqs = [];
  store.nextEndpointId = 1;
  store.nextQueueId = 1;
}

// Table identity sentinels — the db mock returns table-specific behaviour by
// matching the `__t` tag on the object passed to db.select/insert/update.
// Inlined inside the factory because vi.mock is hoisted above module scope.
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

vi.mock("../../server/db-replica", () => ({
  dbForReads: vi.fn(async () => (globalThis as any).__mockDb),
}));

// SSRF guard always passes in tests (we control the candidate URLs).
vi.mock("../../server/services/providers/ssrf-guard", () => ({
  checkOperatorUrl: () => ({ ok: true }),
}));

// drizzle-orm — the service uses and/eq/sql/desc only as opaque markers we
// don't interpret; return harmless stand-ins.
vi.mock("drizzle-orm", () => ({
  and: (...a: any[]) => ({ __and: a }),
  eq: (col: any, val: any) => ({ __eq: [col, val] }),
  sql: Object.assign((..._a: any[]) => ({ __sql: true }), {
    raw: () => ({ __sql: true }),
  }),
  desc: (c: any) => ({ __desc: c }),
}));

vi.mock("../../server/db", () => {
  // Builders return thenable chain objects. Each terminal method resolves to
  // the rows the service expects. We track WHICH table via the object passed
  // to from()/insert()/update().
  const tableOf = (t: any): string => t?.__t ?? "unknown";

  // --- SELECT ---
  const select = vi.fn((_cols?: any) => {
    const chain: any = {
      _table: null as string | null,
      _where: null as any,
      from(t: any) {
        this._table = tableOf(t);
        return this;
      },
      where(cond: any) {
        this._where = cond;
        return this;
      },
      orderBy() {
        return this;
      },
      async limit(_n: number) {
        return chain._resolve();
      },
      // some queries are awaited directly (no limit) — make the chain thenable
      then(onF: any, onR: any) {
        return Promise.resolve(chain._resolve()).then(onF, onR);
      },
      _resolve() {
        if (chain._table === "county_gis_endpoints") {
          // Active-endpoint existence check (enqueue / discover de-dupe).
          return store.endpoints.map((e) => ({ ...e }));
        }
        if (chain._table === "county_discovery_queue") {
          return store.queue.map((q) => ({ ...q }));
        }
        return [];
      },
    };
    return chain;
  });

  // --- INSERT ---
  const insert = vi.fn((table: any) => {
    const t = tableOf(table);
    let pending: any = null;
    let conflict = false;
    const api: any = {
      values(v: any) {
        pending = v;
        return this;
      },
      onConflictDoUpdate(_opts: any) {
        conflict = true;
        return this;
      },
      async returning(_sel?: any) {
        if (t === "county_discovery_queue") {
          const key = `${pending.state}|${pending.county}`;
          const existing = store.queue.find((q) => `${q.state}|${q.county}` === key);
          if (existing && conflict) {
            existing.demandCount += 1;
            existing.priority = Math.max(existing.priority, pending.priority ?? 0);
            if (existing.status === "exhausted") existing.status = "pending";
            return [
              { id: existing.id, status: existing.status, demandCount: existing.demandCount },
            ];
          }
          const row: QueueRow = {
            id: store.nextQueueId++,
            state: pending.state,
            county: pending.county,
            demandCount: pending.demandCount ?? 1,
            priority: pending.priority ?? 0,
            status: pending.status ?? "pending",
            attempts: 0,
            maxAttempts: pending.maxAttempts ?? 5,
            resolvedEndpointId: null,
            lastResult: null,
          };
          store.queue.push(row);
          return [{ id: row.id, status: row.status, demandCount: row.demandCount }];
        }
        if (t === "county_gis_endpoints") {
          const row: EndpointRow = {
            id: store.nextEndpointId++,
            state: pending.state,
            county: pending.county,
            baseUrl: pending.baseUrl,
            isActive: pending.isActive ?? false,
            isVerified: pending.isVerified ?? false,
            redistributable: pending.redistributable ?? "review-required",
            layerId: pending.layerId ?? "0",
            apnField: pending.apnField,
            ownerField: pending.ownerField,
          };
          store.endpoints.push(row);
          return [{ id: row.id }];
        }
        return [];
      },
    };
    return api;
  });

  // --- UPDATE ---
  const update = vi.fn((table: any) => {
    const t = tableOf(table);
    let setVals: any = null;
    return {
      set(v: any) {
        setVals = v;
        return this;
      },
      async where(cond: any) {
        // Identify the target row by the eq() id captured in the condition.
        const idMatch = findIdInCond(cond);
        if (t === "county_gis_endpoints") {
          const row = store.endpoints.find((e) => e.id === idMatch);
          if (row) Object.assign(row, setVals);
        } else if (t === "county_discovery_queue") {
          const row = store.queue.find((q) => q.id === idMatch);
          if (row) Object.assign(row, setVals);
        } else if (t === "county_coverage_requests") {
          // queueId-based update — mark matching pending reqs covered.
          for (const r of store.coverageReqs) {
            if (r.status === "pending") r.status = setVals.status ?? r.status;
          }
        }
        return { rowCount: 1 };
      },
    };
  });

  return { db: { select, insert, update } };
});

// Pull the eq()'d id out of an and()/eq() condition tree.
function findIdInCond(cond: any): number | null {
  if (!cond || typeof cond !== "object") return null;
  if (cond.__eq) {
    const [, val] = cond.__eq;
    if (typeof val === "number") return val;
  }
  if (cond.__and) {
    for (const c of cond.__and) {
      const found = findIdInCond(c);
      if (found != null) return found;
    }
  }
  return null;
}

// ── Imports under test (after vi.mock) ──────────────────────────────────────

import {
  enqueueCountyForDiscovery,
  discoverCountyEndpoint,
  normalizeState,
  normalizeCounty,
  type ArcGisProbe,
} from "../../server/services/coverageLedger";

// ── Mock ArcGIS probe factory ────────────────────────────────────────────────

function makeProbe(opts: {
  candidates?: Array<{ baseUrl: string; county: string; state: string }>;
  valid?: boolean;
  fields?: string[];
  featureReturned?: boolean;
}): ArcGisProbe {
  return {
    findCandidates: vi.fn(async (state, county) =>
      (opts.candidates ?? []).map((c) => ({
        baseUrl: c.baseUrl,
        county: c.county ?? county,
        state: c.state ?? state,
        confidenceScore: 80,
        endpointType: "arcgis_rest",
        discoverySource: "test",
      })),
    ),
    validate: vi.fn(async (_url) => ({
      valid: opts.valid ?? true,
      hasParcelData: opts.valid ?? true,
      parcelLayerId: 0,
      parcelFields: opts.fields ?? ["OBJECTID", "APN", "OwnerName"],
      message: "test validation",
    })),
    probeFeature: vi.fn(async (_b, _l, _f) => ({
      returnedFeature: opts.featureReturned ?? false,
      sampleApn: opts.featureReturned ? "12-34-567" : undefined,
    })),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("coverageLedger — normalization", () => {
  it("uppercases state and strips ' County'/dashes from county", () => {
    expect(normalizeState(" tx ")).toBe("TX");
    expect(normalizeCounty("Harris County")).toBe("harris");
    expect(normalizeCounty("San-Miguel")).toBe("san miguel");
  });
});

describe("enqueueCountyForDiscovery", () => {
  beforeEach(resetStore);

  it("creates a new pending queue row on first miss", async () => {
    const r = await enqueueCountyForDiscovery("TX", "Harris");
    expect(r.queued).toBe(true);
    expect(r.alreadyCovered).toBe(false);
    expect(r.demandCount).toBe(1);
    expect(store.queue).toHaveLength(1);
    expect(store.queue[0]).toMatchObject({ state: "TX", county: "harris", status: "pending" });
  });

  it("bumps demand on a repeat miss instead of duplicating", async () => {
    await enqueueCountyForDiscovery("TX", "Harris");
    const r2 = await enqueueCountyForDiscovery("TX", "Harris County");
    expect(r2.bumped).toBe(true);
    expect(r2.demandCount).toBe(2);
    expect(store.queue).toHaveLength(1);
  });

  it("is a no-op when an active endpoint already covers the county", async () => {
    store.endpoints.push({
      id: store.nextEndpointId++,
      state: "TX",
      county: "Harris",
      baseUrl: "https://gis.example/FeatureServer",
      isActive: true,
      isVerified: true,
      redistributable: "review-required",
      layerId: "0",
      apnField: "APN",
      ownerField: "OWNER",
    });
    const r = await enqueueCountyForDiscovery("TX", "harris");
    expect(r.alreadyCovered).toBe(true);
    expect(store.queue).toHaveLength(0);
  });

  it("lifts priority for a customer-requested county", async () => {
    await enqueueCountyForDiscovery("NM", "Luna", { priorityBoost: 100 });
    expect(store.queue[0].priority).toBe(100);
  });
});

describe("discoverCountyEndpoint — confidence-gated activation", () => {
  beforeEach(resetStore);

  function seedQueue(): QueueRow {
    const row: QueueRow = {
      id: store.nextQueueId++,
      state: "TX",
      county: "harris",
      demandCount: 3,
      priority: 0,
      status: "pending",
      attempts: 0,
      maxAttempts: 5,
      resolvedEndpointId: null,
      lastResult: null,
    };
    store.queue.push(row);
    return row;
  }

  it("inserts isActive=false then flips active ONLY after a real feature", async () => {
    const q = seedQueue();
    const probe = makeProbe({
      candidates: [{ baseUrl: "https://gis.tx/FeatureServer", county: "Harris", state: "TX" }],
      valid: true,
      fields: ["OBJECTID", "PARCEL_ID", "OWNER_NAME"],
      featureReturned: true,
    });

    const r = await discoverCountyEndpoint(
      { id: q.id, state: q.state, county: q.county, attempts: 0, maxAttempts: 5 },
      probe,
    );

    expect(r.outcome).toBe("activated");
    expect(store.endpoints).toHaveLength(1);
    const ep = store.endpoints[0];
    expect(ep.isActive).toBe(true);
    expect(ep.isVerified).toBe(true);
    // Beatrice rule: NEVER auto-marked fully redistributable.
    expect(ep.redistributable).toBe("review-required");
    // Auto-mapped fields from the validation field list.
    expect(ep.apnField).toBe("PARCEL_ID");
    expect(ep.ownerField).toBe("OWNER_NAME");
    // Queue resolved + linked.
    const queued = store.queue.find((x) => x.id === q.id)!;
    expect(queued.status).toBe("resolved");
    expect(queued.resolvedEndpointId).toBe(ep.id);
  });

  it("leaves endpoint isActive=false (review-pending) when no feature comes back", async () => {
    const q = seedQueue();
    const probe = makeProbe({
      candidates: [{ baseUrl: "https://gis.tx/FeatureServer", county: "Harris", state: "TX" }],
      valid: true,
      featureReturned: false,
    });

    const r = await discoverCountyEndpoint(
      { id: q.id, state: q.state, county: q.county, attempts: 0, maxAttempts: 5 },
      probe,
    );

    expect(r.outcome).toBe("review-pending");
    expect(store.endpoints).toHaveLength(1);
    expect(store.endpoints[0].isActive).toBe(false);
    expect(store.endpoints[0].redistributable).toBe("review-required");
    const queued = store.queue.find((x) => x.id === q.id)!;
    expect(queued.status).toBe("pending");
    expect(queued.resolvedEndpointId).toBeNull();
  });

  it("marks the queue row failed (not exhausted) when no candidate is found", async () => {
    const q = seedQueue();
    const probe = makeProbe({ candidates: [] });

    const r = await discoverCountyEndpoint(
      { id: q.id, state: q.state, county: q.county, attempts: 0, maxAttempts: 5 },
      probe,
    );

    expect(r.outcome).toBe("no-candidate");
    expect(store.endpoints).toHaveLength(0);
    expect(store.queue.find((x) => x.id === q.id)!.status).toBe("failed");
  });

  it("exhausts the queue row at maxAttempts with no candidate", async () => {
    const q = seedQueue();
    const probe = makeProbe({ candidates: [] });

    const r = await discoverCountyEndpoint(
      { id: q.id, state: q.state, county: q.county, attempts: 4, maxAttempts: 5 },
      probe,
    );

    expect(r.outcome).toBe("exhausted");
    expect(store.queue.find((x) => x.id === q.id)!.status).toBe("exhausted");
  });

  it("skips candidates that fail validation", async () => {
    const q = seedQueue();
    const probe = makeProbe({
      candidates: [{ baseUrl: "https://gis.tx/FeatureServer", county: "Harris", state: "TX" }],
      valid: false,
    });

    const r = await discoverCountyEndpoint(
      { id: q.id, state: q.state, county: q.county, attempts: 0, maxAttempts: 5 },
      probe,
    );

    expect(r.outcome).toBe("no-candidate");
    expect(store.endpoints).toHaveLength(0);
  });
});
