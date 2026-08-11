/**
 * Wave 2.3 — click-to-identify → inspector → "Track this parcel" → quick actions.
 *
 * The exit line: tap an untracked parcel in a covered county → owner/APN/acres
 * fast → tracked → the existing offer flow unchanged.
 *
 * This suite pins the five things that can silently rot:
 *
 *  1. IDENTIFY READS WHAT WE ALREADY HOLD. The resolver returns REAL
 *     parcel_snapshots fields (owner / APN / acres / assessed value) with the
 *     slice-11 provenance grammar (source + vintage + licence posture) — and
 *     never invents one. A null column renders as an honest "not recorded",
 *     which is a DIFFERENT thing from a licence withholding, and the two may
 *     never be collapsed into one another (the "suppression disguised as an
 *     absence" defect).
 *
 *  2. HONEST ABSENCE, AND THE NEGATIVE CLAIM IS VERIFIED IN BOTH DIRECTIONS.
 *     "We do not have parcel data for this county yet" is a CLAIM. It is only
 *     allowed when BOTH sources of parcel truth were inspected and both came
 *     back empty: the county-GIS endpoint register AND the parcel_snapshots
 *     cache. A county with cached snapshots but no endpoint row is COVERED.
 *     The result names what it inspected — and the suite checks that name
 *     against the reads THAT ACTUALLY RAN, not against a constant the service
 *     also owns. A payload field that merely echoes a hardcoded list is how a
 *     previous slice's test ended up PINNING a fabrication instead of catching
 *     it.
 *
 *  3. NO READ MAY BE UNBOUNDED, AND NO READ MAY CROSS TENANTS. The first draft
 *     of this resolver pulled `limit(500)` rows of the shared cache with no
 *     WHERE and filtered them in TypeScript. Past 500 rows that is an
 *     arbitrary slice: a parcel we genuinely hold misses, and the miss renders
 *     as "we do not have parcel data for this county yet" — a fabricated
 *     negative about our own coverage, invisible to everyone. The mock below
 *     therefore EVALUATES the predicates the service builds (and throws on any
 *     predicate shape it does not understand, so it can never go vacuously
 *     green) and the suite asserts every read carried one.
 *
 *  4. TRACKING IS ORG-SCOPED AND IDEMPOTENT, AND THE TABLE SHIPS WITH BOTH
 *     MIGRATION ARTIFACTS. A table in shared/schema.ts with no CREATE TABLE in
 *     migrations/*.sql AND no mirror in scripts/migrate.mjs (what prod's
 *     release_command actually runs) 500s on deploy for every tenant — this
 *     repo's canonical defect. Both artifacts are asserted by name.
 *
 *  5. QUICK ACTIONS REUSE EXISTING FLOWS, AND THE SURFACE IS WIRED. Every
 *     destination the inspector offers must already be a mounted route in
 *     client/src/App.tsx, and the inspector must actually be rendered by the
 *     Map door — a component nobody mounts is this repo's other canonical
 *     defect, and it is what the dead run left behind here.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf-8");

// ─── Schema stand-ins ───────────────────────────────────────────────────────
// Columns are real markers, not `undefined`: the predicate interpreter below
// resolves each `eq(col, …)` back to the row field it names, so a query that
// filters on the wrong column fails here rather than in production.

vi.mock("@shared/schema", () => {
  // Declared inside the factory: vi.mock is hoisted above module scope.
  const tableStub = (name: string, columns: string[]) => {
    const t: Record<string, unknown> = { __t: name };
    for (const c of columns) t[c] = { __col: c, __t: name };
    return t;
  };
  return {
  countyGisEndpoints: tableStub("county_gis_endpoints", [
    "state",
    "county",
    "isActive",
    "redistributable",
  ]),
  parcelSnapshots: tableStub("parcel_snapshots", [
    "id",
    "organizationId",
    "apn",
    "state",
    "county",
    "centroid",
  ]),
  trackedParcels: tableStub("tracked_parcels", [
    "id",
    "organizationId",
    "state",
    "county",
    "apn",
    "createdAt",
  ]),
  };
});

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("drizzle-orm", () => ({
  and: (...a: any[]) => ({ __and: a.filter(Boolean) }),
  or: (...a: any[]) => ({ __or: a.filter(Boolean) }),
  eq: (col: any, val: any) => ({ __eq: [col, val] }),
  isNull: (col: any) => ({ __isNull: col }),
  desc: (c: any) => ({ __desc: c }),
  sql: Object.assign(
    (strings: TemplateStringsArray, ...values: any[]) => ({
      __sql: Array.isArray(strings) ? strings.join("?") : String(strings),
      values,
    }),
    { raw: (s: string) => ({ __sql: s, values: [] }) },
  ),
}));

interface SnapshotRow {
  id: number;
  organizationId: number | null;
  apn: string;
  state: string;
  county: string;
  source: string;
  owner: string | null;
  siteAddress?: string | null;
  acres: string | null;
  assessedValue: string | null;
  taxYear?: number | null;
  centroid: { lat: number; lng: number } | null;
  boundary?: {
    type: "Polygon" | "MultiPolygon";
    coordinates: number[][][] | number[][][][];
  } | null;
  fetchedAt: Date | null;
}

interface EndpointRow {
  state: string;
  county: string;
  isActive: boolean;
  redistributable: string | null;
}

interface TrackedRow {
  id: number;
  organizationId: number;
  state: string;
  county: string;
  apn: string;
  parcelSnapshotId: number | null;
  createdAt: Date;
}

const store: {
  snapshots: SnapshotRow[];
  endpoints: EndpointRow[];
  tracked: TrackedRow[];
  readThrows: boolean;
} = { snapshots: [], endpoints: [], tracked: [], readThrows: false };

let nextTrackedId = 1;
/** Every SELECT the service issued: which table, and whether it carried a WHERE. */
let readsSeen: { table: string; hasWhere: boolean }[] = [];

function resetStore() {
  store.snapshots = [];
  store.endpoints = [];
  store.tracked = [];
  store.readThrows = false;
  nextTrackedId = 1;
  readsSeen = [];
}

const tableOf = (t: any): string => t?.__t ?? "unknown";

/**
 * ORDER BY, evaluated rather than ignored.
 *
 * Only one ordering exists in this service: `centroidDistanceSq`, the squared
 * planar distance from the tapped point to a row's centroid. It is what makes
 * `POINT_CANDIDATE_LIMIT` a bound on WORK instead of a bound on CORRECTNESS,
 * so the interpreter has to reproduce it or the suite cannot see the property
 * it most needs to check.
 *
 * Anything else throws, on the same principle as the predicate interpreter: a
 * shape the tests do not understand must fail loudly, never pass silently.
 */
function applyOrder(rows: any[], order: any): any[] {
  if (!order) return rows;
  const sqlText = typeof order?.__sql === "string" ? order.__sql : null;
  if (!sqlText) {
    throw new Error(`orderBy received a shape the test interpreter cannot read: ${JSON.stringify(order)}`);
  }
  if (sqlText.includes("power(") && sqlText.includes("->>")) {
    // centroidDistanceSq interpolates the column marker, then lat, then the
    // column marker again, then lng — so the numbers, in order, are [lat, lng].
    const [lat, lng] = (order.values ?? []).filter((v: any) => typeof v === "number");
    if (typeof lat !== "number" || typeof lng !== "number") {
      throw new Error("distance ordering did not carry a numeric lat/lng pair");
    }
    const dsq = (r: any) => {
      const c = r?.centroid;
      if (!c || typeof c.lat !== "number" || typeof c.lng !== "number") {
        return Number.POSITIVE_INFINITY; // sorts last, never rescued by luck
      }
      return (c.lat - lat) ** 2 + (c.lng - lng) ** 2;
    };
    return [...rows].sort((a, b) => dsq(a) - dsq(b));
  }
  throw new Error(`orderBy expression not understood by the test interpreter: ${sqlText}`);
}

function rowsFor(table: string): any[] {
  if (table === "parcel_snapshots") return store.snapshots.map((r) => ({ ...r }));
  if (table === "county_gis_endpoints") return store.endpoints.map((r) => ({ ...r }));
  if (table === "tracked_parcels") return store.tracked.map((r) => ({ ...r }));
  return [];
}

// ─── Predicate interpreter ─────────────────────────────────────────────────
// This is the part that makes the suite non-vacuous. It evaluates the SAME
// predicate objects the service builds. Anything it does not recognise THROWS,
// so a future edit cannot smuggle in a filter the tests silently ignore.

/**
 * MIRRORS `countyMatches`'s SQL EXACTLY — deliberately, and it is worth saying
 * why, because the first version of this helper did not.
 *
 * Production runs `LOWER(REPLACE(TRIM(col), ' County', ''))`: the REPLACE is
 * case-SENSITIVE and runs BEFORE the LOWER, and there is no hyphen handling.
 * The earlier mock lower-cased first, stripped the suffix case-insensitively,
 * and folded hyphens to spaces — all three make it MORE forgiving than the
 * database. A row stored as 'travis county' matched here and did not match in
 * Postgres, and `parcel_snapshots.county` is written unnormalized straight
 * from the Regrid ETL feed, so the stored casing is not ours to assume.
 *
 * A mock that accepts more than production turns this suite into a source of
 * false confidence about the exact predicate it exists to verify. If the SQL
 * changes, change this with it — do not loosen it.
 */
const normCounty = (c: unknown) => String(c ?? "").trim().replace(/ County/g, "").toLowerCase();
const normState = (s: unknown) => String(s ?? "").trim().toUpperCase();
const normApn = (a: unknown) => String(a ?? "").replace(/[-\s]/g, "").toLowerCase();

function evalSqlFragment(frag: { __sql: string; values: any[] }, row: any): boolean {
  const text = frag.__sql;
  const v = frag.values;

  // centroidInBox: values = [centroidCol, minLat, maxLat, centroidCol, minLng, maxLng]
  if (text.includes("->>'lat'")) {
    const c = row.centroid;
    if (!c || typeof c.lat !== "number" || typeof c.lng !== "number") return false;
    return c.lat >= v[1] && c.lat <= v[2] && c.lng >= v[4] && c.lng <= v[5];
  }
  // countyMatches: values = [countyCol, normalizedCounty]
  if (text.includes("' County'")) {
    return normCounty(row[v[0].__col]) === v[1];
  }
  // stateMatches: values = [stateCol, normalizedState]
  if (text.includes("UPPER(TRIM(")) {
    return normState(row[v[0].__col]) === v[1];
  }
  // apnMatches: values = [apnCol, normalizedApn]
  if (text.includes("'-'")) {
    return normApn(row[v[0].__col]) === v[1];
  }
  throw new Error(
    `parcelIdentify.test: unrecognised SQL predicate — the mock cannot honestly ` +
      `evaluate it, so the suite would be vacuous. Teach the interpreter or ` +
      `change the query. Fragment: ${text}`,
  );
}

function evalPredicate(pred: any, row: any): boolean {
  if (pred == null) return true;
  if (pred.__and) return pred.__and.every((p: any) => evalPredicate(p, row));
  if (pred.__or) return pred.__or.some((p: any) => evalPredicate(p, row));
  if (pred.__eq) {
    const [col, val] = pred.__eq;
    return row[col.__col] === val;
  }
  if (pred.__isNull) return row[pred.__isNull.__col] == null;
  if (pred.__sql) return evalSqlFragment(pred, row);
  throw new Error(
    `parcelIdentify.test: unrecognised predicate shape ${JSON.stringify(pred)}`,
  );
}

/**
 * A chainable select() stand-in that actually applies `.where()` and
 * `.limit()`. Returning the whole table regardless of predicate — which the
 * dead run's version did — would have let the unbounded, cross-tenant read
 * pass every assertion in this file.
 */
function makeSelectChain() {
  const chain: any = {
    _table: null as string | null,
    _where: undefined as any,
    _limit: undefined as number | undefined,
    _entry: null as { table: string; hasWhere: boolean } | null,
    from(t: any) {
      chain._table = tableOf(t);
      chain._entry = { table: chain._table!, hasWhere: false };
      readsSeen.push(chain._entry);
      return chain;
    },
    where(pred: any) {
      chain._where = pred;
      if (chain._entry) chain._entry.hasWhere = true;
      return chain;
    },
    orderBy(expr: any) {
      chain._order = expr;
      return chain;
    },
    limit(n: number) {
      chain._limit = n;
      return chain;
    },
    then(onF: any, onR: any) {
      if (store.readThrows) {
        return Promise.reject(new Error("connection refused")).then(onF, onR);
      }
      let rows = rowsFor(chain._table!).filter((r) => evalPredicate(chain._where, r));
      // ORDER BEFORE LIMIT, exactly as the database does. This used to be a
      // no-op, which made the interpreter blind to the single most important
      // property of the point read: that its cap applies to the NEAREST rows.
      // With a no-op ordering plus a slice of insertion order, a suite could
      // stay green while production returned an arbitrary window.
      rows = applyOrder(rows, chain._order);
      if (typeof chain._limit === "number") rows = rows.slice(0, chain._limit);
      return Promise.resolve(rows).then(onF, onR);
    },
  };
  return chain;
}

vi.mock("../../server/db-replica", () => ({
  dbForReads: vi.fn(async () => ({ select: vi.fn(() => makeSelectChain()) })),
}));

vi.mock("../../server/db", () => ({
  db: {
    select: vi.fn(() => makeSelectChain()),
    insert: vi.fn((t: any) => ({
      values: (vals: any) => {
        const chain: any = {
          _conflict: false,
          onConflictDoNothing() {
            chain._conflict = true;
            return chain;
          },
          returning() {
            return chain;
          },
          then(onF: any, onR: any) {
            if (tableOf(t) !== "tracked_parcels") {
              return Promise.resolve([]).then(onF, onR);
            }
            // The real unique index is (organization_id, state, county, apn).
            const dup = store.tracked.find(
              (r) =>
                r.organizationId === vals.organizationId &&
                r.state === vals.state &&
                r.county === vals.county &&
                r.apn === vals.apn,
            );
            if (dup) {
              // onConflictDoNothing returns ZERO rows on a collision — the
              // service must treat that as "already tracked", not as failure.
              return Promise.resolve([]).then(onF, onR);
            }
            const row: TrackedRow = {
              id: nextTrackedId++,
              organizationId: vals.organizationId,
              state: vals.state,
              county: vals.county,
              apn: vals.apn,
              parcelSnapshotId: vals.parcelSnapshotId ?? null,
              createdAt: new Date("2026-08-10T00:00:00Z"),
            };
            store.tracked.push(row);
            return Promise.resolve([{ ...row }]).then(onF, onR);
          },
        };
        return chain;
      },
    })),
    // The delete stand-in evaluates its predicate too, so a cross-tenant
    // delete is caught by BEHAVIOUR rather than by grepping the source.
    delete: vi.fn((_t: any) => {
      const chain: any = {
        _where: undefined,
        where(pred: any) {
          chain._where = pred;
          return chain;
        },
        returning() {
          return chain;
        },
        then(onF: any, onR: any) {
          const keep: TrackedRow[] = [];
          const removed: TrackedRow[] = [];
          for (const r of store.tracked) {
            (evalPredicate(chain._where, r) ? removed : keep).push(r);
          }
          store.tracked = keep;
          return Promise.resolve(removed).then(onF, onR);
        },
      };
      return chain;
    }),
  },
}));

import {
  identifyParcel,
  trackParcel,
  untrackParcel,
  type ParcelIdentifyResult,
} from "../../server/services/parcelIdentify";

const ORG = 42;
const OTHER_ORG = 99;

function seedSnapshot(over: Partial<SnapshotRow> = {}): SnapshotRow {
  const row: SnapshotRow = {
    id: over.id ?? 1,
    organizationId: null,
    apn: "R123456",
    state: "TX",
    county: "travis",
    source: "County GIS",
    owner: "SMITH FAMILY TRUST",
    siteAddress: "123 RANCH RD",
    acres: "40.25",
    assessedValue: "185000",
    taxYear: 2025,
    centroid: { lat: 30.2672, lng: -97.7431 },
    boundary: null,
    fetchedAt: new Date("2026-07-01T00:00:00Z"),
    ...over,
  };
  store.snapshots.push(row);
  return row;
}

function factOf(result: ParcelIdentifyResult, key: string) {
  return result.facts.find((f) => f.key === key);
}

const tablesRead = () => readsSeen.map((r) => r.table);

beforeEach(() => {
  resetStore();
  vi.clearAllMocks();
});

// ─── 1. Identify returns REAL held fields, with provenance ──────────────────

describe("identify — the inspector shows what the product already holds", () => {
  it("returns the real snapshot fields for a parcel we hold, matched by APN", async () => {
    seedSnapshot();
    store.endpoints.push({ state: "TX", county: "travis", isActive: true, redistributable: "yes" });

    const result = await identifyParcel({
      organizationId: ORG,
      state: "TX",
      county: "Travis County",
      apn: "R123456",
    });

    expect(result.status).toBe("identified");
    expect(result.match?.by).toBe("apn");
    expect(factOf(result, "owner")?.value).toBe("SMITH FAMILY TRUST");
    expect(factOf(result, "apn")?.value).toBe("R123456");
    expect(factOf(result, "acres")?.value).toBe("40.25");
    expect(factOf(result, "assessedValue")?.value).toBe("185000");
    // Nothing is invented: every fact carries either a real value or an
    // explicit absence, never both and never neither.
    for (const fact of result.facts) {
      if (fact.value === null) expect(fact.absence).toBeTruthy();
      else expect(fact.absence).toBeNull();
    }
  });

  it("matches an APN whose stored form is punctuated differently", async () => {
    // Snapshot rows are written by several paths and only some normalize. A
    // bare `=` here would report "we don't hold this" for a parcel we do.
    seedSnapshot({ apn: "R-123 456" });
    const result = await identifyParcel({
      organizationId: ORG,
      state: "TX",
      county: "travis",
      apn: "R123456",
    });
    expect(result.status).toBe("identified");
  });

  it("carries the slice-11 provenance grammar — source, vintage and licence posture", async () => {
    seedSnapshot();
    const result = await identifyParcel({
      organizationId: ORG,
      state: "TX",
      county: "travis",
      apn: "R123456",
    });

    expect(result.provenance).toBeTruthy();
    expect(result.provenance!.source).toBe("County GIS");
    // Retrieved-at is the snapshot's own fetchedAt — never the render clock.
    expect(result.provenance!.retrievedAt).toBe("2026-07-01T00:00:00.000Z");
    // Resolved through server/services/licenseEgress.ts (slice 11), not a
    // second, drifting copy of the posture table.
    expect(["yes", "attribution", "no", "review-required"]).toContain(
      result.provenance!.posture,
    );
    expect(result.provenance!.postureReason).toBeTruthy();
  });

  it("honours the county's OWN recorded licence review rather than fail-closed guessing", async () => {
    // county_gis_endpoints.redistributable (migration 0120) is a human review.
    // Ignoring it would tell the customer a fact "isn't included when you
    // export" when a reviewer already said it is.
    seedSnapshot({ source: "Travis County GIS portal" });
    store.endpoints.push({
      state: "TX",
      county: "travis",
      isActive: true,
      redistributable: "yes",
    });

    const result = await identifyParcel({
      organizationId: ORG,
      state: "TX",
      county: "travis",
      apn: "R123456",
    });

    expect(result.provenance!.posture).toBe("yes");
    expect(result.provenance!.mayRedistribute).toBe(true);
    expect(result.provenance!.postureReason.toLowerCase()).toContain("review");
  });

  it("a null column is an honest 'not recorded' — NEVER a licence withholding", async () => {
    seedSnapshot({ owner: null, assessedValue: null });
    const result = await identifyParcel({
      organizationId: ORG,
      state: "TX",
      county: "travis",
      apn: "R123456",
    });

    const owner = factOf(result, "owner")!;
    expect(owner.value).toBeNull();
    expect(owner.absence).toBe("not-recorded");
    // The defect this guards: a suppression rendered as "we looked and found
    // nothing". The two absence kinds are distinct values and the resolver may
    // never emit the withheld kind for a merely-empty column.
    expect(owner.absence).not.toBe("withheld");
    expect(owner.absenceLabel.toLowerCase()).toContain("not recorded");
  });

  it("identifies by boundary containment when we hold a polygon, and says so", async () => {
    seedSnapshot({
      boundary: {
        type: "Polygon",
        coordinates: [
          [
            [-97.75, 30.26],
            [-97.73, 30.26],
            [-97.73, 30.28],
            [-97.75, 30.28],
            [-97.75, 30.26],
          ],
        ],
      },
    });

    const result = await identifyParcel({
      organizationId: ORG,
      lat: 30.2672,
      lng: -97.7431,
    });

    expect(result.status).toBe("identified");
    expect(result.match?.by).toBe("boundary-contains");
  });

  it("a centroid match is labelled as approximate with its distance — never as containment", async () => {
    // No boundary held, so the best we can honestly say is "the nearest parcel
    // we hold, N metres away" — asserting the tap landed ON it would be a
    // claim the geometry does not support.
    seedSnapshot({ boundary: null, centroid: { lat: 30.2672, lng: -97.7431 } });

    const result = await identifyParcel({
      organizationId: ORG,
      lat: 30.2675,
      lng: -97.7431,
    });

    expect(result.status).toBe("identified");
    expect(result.match?.by).toBe("nearest-centroid");
    expect(result.match!.distanceMeters).toBeGreaterThan(0);
    expect(result.match!.approximate).toBe(true);
  });

  it("does not call a far-away cached parcel 'the one you tapped'", async () => {
    // Well inside the SQL candidate box but far outside the match limit.
    seedSnapshot({ boundary: null, centroid: { lat: 30.2672, lng: -97.7431 } });
    const result = await identifyParcel({
      organizationId: ORG,
      lat: 30.32,
      lng: -97.7431,
    });

    // REWRITTEN, not deleted (fleet-12b integration). This pin used to assert
    // `location-unidentified`, which was the only miss a bare lat/lng tap
    // could ever produce — because the resolver bailed before it could work
    // out which county the tap was in. The wave's audit showed what that cost:
    // the two coverage answers were unreachable in production, and a customer
    // tapping inside a county we DO cover was asked to request coverage for
    // it. The resolver now establishes the county server-side from the nearest
    // parcel we hold, so this tap correctly resolves to the covered-county
    // miss.
    //
    // The invariant this test was written to protect is untouched and is what
    // the assertions below check: a far-away parcel must never be presented as
    // the one the customer tapped. It is still a MISS — no match, no facts, no
    // snapshot id — it is simply an honestly NAMED miss now.
    expect(result.status).toBe("county-covered-no-parcel");
    expect(result.match).toBeNull();
    expect(result.snapshotId).toBeNull();
    expect(result.apn).toBeNull();
    // A miss carries no facts — the empty list, not a far-away parcel's.
    expect(result.facts).toEqual([]);
    // Covered county: asking this customer to request coverage would be wrong.
    expect(result.requestCoverage).toBeNull();
    // The county came from our own data, not from anything the caller sent.
    expect(result.county).toBe("travis");
    expect(result.state).toBe("TX");
  });

  it("an APN that collides across counties does not answer with the wrong parcel", async () => {
    // APNs are unique only WITHIN a county, and the matcher strips hyphens and
    // spaces and lowercases — so with no county predicate these two rows are
    // the same key. The map tap sends no county (it cannot), so before this
    // was fixed the resolver took whichever row came back first and presented
    // it as `by: "apn", approximate: false` — the strongest confidence the API
    // has, attached to a different county's owner, acres and assessed value.
    seedSnapshot({
      id: 1,
      apn: "123-45-678",
      state: "NM",
      county: "catron",
      owner: "WRONG PARCEL LLC",
      centroid: { lat: 34.1, lng: -108.4 },
    });
    seedSnapshot({
      id: 2,
      apn: "12345678",
      state: "TX",
      county: "travis",
      owner: "THE PARCEL YOU TAPPED",
      centroid: { lat: 30.2672, lng: -97.7431 },
    });

    const result = await identifyParcel({
      organizationId: ORG,
      apn: "12345678",
      lat: 30.2672,
      lng: -97.7431,
    });

    expect(result.status).toBe("identified");
    expect(result.snapshotId).toBe(2);
    expect(result.state).toBe("TX");
    expect(result.county).toBe("travis");
    expect(result.facts?.find((f) => f.label === "Owner of record")?.value).toBe(
      "THE PARCEL YOU TAPPED",
    );
  });

  it("an APN we cannot place against the tapped point is not a confident match", async () => {
    // Same collision, but the tap is nowhere near either row. Corroboration
    // fails for both, so there is no APN answer — and the point path has
    // nothing either. A miss is the honest outcome; picking one is not.
    seedSnapshot({ id: 1, apn: "999", state: "NM", county: "catron", centroid: { lat: 34.1, lng: -108.4 } });
    seedSnapshot({ id: 2, apn: "999", state: "TX", county: "travis", centroid: { lat: 30.2672, lng: -97.7431 } });

    const result = await identifyParcel({
      organizationId: ORG,
      apn: "999",
      lat: 41.8781,
      lng: -87.6298,
    });

    expect(result.status).toBe("location-unidentified");
    expect(result.match).toBeNull();
    expect(result.snapshotId).toBeNull();
  });

  it("a parcel we hold is found even when more rows sit in the box than the read limit", async () => {
    // The false-negative the module header warns about, made concrete. The
    // candidate read is capped; before it was ordered, the cap returned an
    // ARBITRARY slice, so the true match could simply be absent and the miss
    // would render as a claim about our own coverage. Nearest-first ordering
    // is what makes the cap a bound on work rather than on correctness.
    // Deliberately seeded well past POINT_CANDIDATE_LIMIT (200), with the real
    // parcel LAST so insertion order cannot rescue it.
    for (let i = 0; i < 250; i++) {
      seedSnapshot({
        id: 1000 + i,
        apn: `FILLER-${i}`,
        owner: "FILLER",
        // Inside the ~0.25 degree box, outside the 400 m match radius.
        centroid: { lat: 30.2672 + 0.02 + i * 0.0004, lng: -97.7431 + 0.02 },
      });
    }
    seedSnapshot({
      id: 7,
      apn: "REAL-ONE",
      owner: "THE PARCEL YOU TAPPED",
      centroid: { lat: 30.2672, lng: -97.7431 },
    });

    const result = await identifyParcel({
      organizationId: ORG,
      lat: 30.2672,
      lng: -97.7431,
    });

    expect(result.status).toBe("identified");
    expect(result.snapshotId).toBe(7);
    expect(result.facts?.find((f) => f.label === "Owner of record")?.value).toBe(
      "THE PARCEL YOU TAPPED",
    );
  });

  it("a tap with nothing cached anywhere near it stays unidentified", async () => {
    // The guard on the reconstruction above: with no parcel in the candidate
    // box there is no honest basis for naming a county, so the resolver must
    // NOT reach for one. This is the case the old assertion was really about.
    seedSnapshot({ boundary: null, centroid: { lat: 30.2672, lng: -97.7431 } });
    const result = await identifyParcel({
      organizationId: ORG,
      lat: 41.8781, // Chicago — far outside the candidate box
      lng: -87.6298,
    });
    expect(result.status).toBe("location-unidentified");
    expect(result.county).toBeNull();
    expect(result.state).toBeNull();
    // No prefill, because we genuinely do not know where this is.
    expect(result.requestCoverage).toEqual({ state: null, county: null });
  });
});

// ─── 2. Bounded and tenant-scoped reads ────────────────────────────────────

describe("reads are bounded and tenant-scoped — no truncated scan, no cross-tenant peek", () => {
  it("never issues a SELECT without a WHERE", async () => {
    seedSnapshot();
    await identifyParcel({ organizationId: ORG, state: "TX", county: "travis", apn: "R123456" });
    expect(readsSeen.length).toBeGreaterThan(0);
    // An unpredicated read of the shared cache is only correct while the cache
    // is small; once it is not, the arbitrary slice it returns manufactures a
    // "we don't hold this" for a parcel we do.
    expect(readsSeen.filter((r) => !r.hasWhere)).toEqual([]);
  });

  it("never issues a SELECT without a WHERE on the point path either", async () => {
    seedSnapshot();
    await identifyParcel({ organizationId: ORG, lat: 30.2672, lng: -97.7431 });
    expect(readsSeen.filter((r) => !r.hasWhere)).toEqual([]);
  });

  it("does not return another org's private snapshot", async () => {
    // organization_id NULL = shared cache; non-null = that org's own research.
    seedSnapshot({ id: 7, organizationId: OTHER_ORG, apn: "PRIVATE-1" });

    const result = await identifyParcel({
      organizationId: ORG,
      state: "TX",
      county: "travis",
      apn: "PRIVATE-1",
    });

    expect(result.status).not.toBe("identified");
    expect(result.facts).toHaveLength(0);
  });

  it("still returns the org's OWN private snapshot, and the shared cache", async () => {
    seedSnapshot({ id: 8, organizationId: ORG, apn: "MINE-1" });
    const mine = await identifyParcel({
      organizationId: ORG,
      state: "TX",
      county: "travis",
      apn: "MINE-1",
    });
    expect(mine.status).toBe("identified");

    resetStore();
    seedSnapshot({ id: 9, organizationId: null, apn: "SHARED-1" });
    const shared = await identifyParcel({
      organizationId: ORG,
      state: "TX",
      county: "travis",
      apn: "SHARED-1",
    });
    expect(shared.status).toBe("identified");
  });

  it("another org's private row in a county does not make that county look covered", async () => {
    seedSnapshot({ id: 11, organizationId: OTHER_ORG, apn: "THEIRS", state: "NM", county: "catron" });

    const result = await identifyParcel({
      organizationId: ORG,
      state: "NM",
      county: "Catron",
      apn: "0000",
    });

    // We hold nothing THIS org may see, and there is no endpoint row.
    expect(result.status).toBe("county-not-covered");
  });
});

// ─── 3. Honest absence — and the negative claim verified BOTH ways ──────────

describe("honest absence — 'we don't have this county' is a claim, and it is checked", () => {
  it("says the county is not covered ONLY when both sources came back empty, and names them", async () => {
    const result = await identifyParcel({
      organizationId: ORG,
      state: "NM",
      county: "Catron",
      apn: "0000",
    });

    expect(result.status).toBe("county-not-covered");
    expect(result.message.toLowerCase()).toContain(
      "we do not have parcel data for this county yet",
    );

    // The claim is auditable from the payload — and the payload is checked
    // against the reads that ACTUALLY RAN, not against a constant the service
    // also owns. A hardcoded `inspected` list that drifts from the queries is
    // exactly the shape of fabrication this slice exists to avoid.
    expect(result.inspected).toContain("county_gis_endpoints");
    expect(result.inspected).toContain("parcel_snapshots");
    expect(tablesRead()).toContain("county_gis_endpoints");
    expect(tablesRead()).toContain("parcel_snapshots");
    for (const named of result.inspected) {
      expect(tablesRead()).toContain(named);
    }

    expect(result.facts).toHaveLength(0);
    expect(result.provenance).toBeNull();
    // The dead-end routes to the existing coverage-request affordance.
    expect(result.requestCoverage).toEqual({ state: "NM", county: "Catron" });
  });

  it("does NOT claim 'not covered' when the county has cached snapshots but no endpoint row", async () => {
    // The one-direction fabrication: checking only the endpoint register would
    // declare this county uncovered while we demonstrably hold parcels in it.
    seedSnapshot({ apn: "OTHER-1", state: "NM", county: "catron" });

    const result = await identifyParcel({
      organizationId: ORG,
      state: "NM",
      county: "Catron",
      apn: "0000",
    });

    expect(result.status).not.toBe("county-not-covered");
    expect(result.status).toBe("county-covered-no-parcel");
    expect(result.message.toLowerCase()).not.toContain("do not have parcel data for this county");
  });

  it("distinguishes 'county covered, this parcel not cached' from 'county not covered'", async () => {
    store.endpoints.push({ state: "TX", county: "travis", isActive: true, redistributable: "yes" });

    const result = await identifyParcel({
      organizationId: ORG,
      state: "TX",
      county: "Travis",
      apn: "NOT-CACHED",
    });

    expect(result.status).toBe("county-covered-no-parcel");
    expect(result.facts).toHaveLength(0);
    // It must NOT offer a coverage request for a county that IS covered —
    // that would be a dead-end CTA misdescribing the situation.
    expect(result.requestCoverage).toBeNull();
  });

  it("an inactive endpoint alone does not make a county covered", async () => {
    store.endpoints.push({ state: "TX", county: "travis", isActive: false, redistributable: "yes" });

    const result = await identifyParcel({
      organizationId: ORG,
      state: "TX",
      county: "Travis",
      apn: "NOT-CACHED",
    });

    expect(result.status).toBe("county-not-covered");
  });

  it("a lat/lng tap with no hit does NOT name a county it never established", async () => {
    const result = await identifyParcel({ organizationId: ORG, lat: 44.1, lng: -110.2 });

    expect(result.status).toBe("location-unidentified");
    // We never learned which county this is, so we may not claim anything
    // about a county's coverage — and the CTA must not be prefilled with a
    // guess.
    expect(result.message.toLowerCase()).not.toContain("county yet");
    expect(result.county).toBeNull();
    expect(result.requestCoverage).toEqual({ state: null, county: null });
  });

  it("a read failure is reported as a failure — never as an absence of data", async () => {
    store.readThrows = true;
    const result = await identifyParcel({
      organizationId: ORG,
      state: "TX",
      county: "Travis",
      apn: "R123456",
    });

    expect(result.status).toBe("lookup-failed");
    expect(result.message.toLowerCase()).toContain("could not");
    // The killer regression: a broken read collapsing into "this county has no
    // data", which is a fabricated negative.
    expect(result.status).not.toBe("county-not-covered");
    expect(result.requestCoverage).toBeNull();
    // And it must not claim to have inspected anything, because it did not
    // successfully inspect anything.
    expect(result.inspected).toEqual([]);
  });
});

// ─── 4. Tracking — org-scoped, idempotent, and reachable ────────────────────

describe("track this parcel — org-scoped and idempotent", () => {
  it("tracks once and stays idempotent when tapped twice", async () => {
    const first = await trackParcel({
      organizationId: ORG,
      state: "TX",
      county: "Travis County",
      apn: "R123456",
    });
    expect(first.tracked).toBe(true);
    expect(first.alreadyTracked).toBe(false);

    const second = await trackParcel({
      organizationId: ORG,
      state: "tx",
      county: "travis",
      apn: "R123456",
    });
    expect(second.tracked).toBe(true);
    expect(second.alreadyTracked).toBe(true);

    // One row, not two — the normalized key is what the unique index holds.
    expect(store.tracked).toHaveLength(1);
    expect(store.tracked[0].state).toBe("TX");
    expect(store.tracked[0].county).toBe("travis");
  });

  it("is org-scoped: another org tracking the same parcel is a separate row", async () => {
    await trackParcel({ organizationId: ORG, state: "TX", county: "Travis", apn: "R123456" });
    await trackParcel({ organizationId: OTHER_ORG, state: "TX", county: "Travis", apn: "R123456" });
    expect(store.tracked).toHaveLength(2);
    expect(store.tracked.map((r) => r.organizationId).sort()).toEqual(
      [ORG, OTHER_ORG].sort(),
    );

    // REWRITTEN, not deleted (fleet-12b integration). This used to assert org
    // scoping through `listTrackedParcels`, a reader removed during
    // integration because nothing in the product ever called it. The invariant
    // it protected — one org's tracking is invisible to another — is what the
    // assertions here and below check, now through the paths that are actually
    // reachable: the write path's separate rows, and identify's per-org
    // `tracked` flag.
    seedSnapshot();
    const asMine = await identifyParcel({ organizationId: ORG, apn: "R123456" });
    const asTheirs = await identifyParcel({
      organizationId: OTHER_ORG + 1, // a third org, tracking nothing
      apn: "R123456",
    });
    expect(asMine.tracked).toBe(true);
    expect(asTheirs.tracked).toBe(false);
  });

  it("identify reports whether the caller's org already tracks the parcel", async () => {
    seedSnapshot();
    store.tracked.push({
      id: 1,
      organizationId: ORG,
      state: "TX",
      county: "travis",
      apn: "R123456",
      parcelSnapshotId: 1,
      createdAt: new Date("2026-08-01T00:00:00Z"),
    });

    const mine = await identifyParcel({
      organizationId: ORG,
      state: "TX",
      county: "Travis",
      apn: "R123456",
    });
    expect(mine.tracked).toBe(true);

    const theirs = await identifyParcel({
      organizationId: OTHER_ORG,
      state: "TX",
      county: "Travis",
      apn: "R123456",
    });
    expect(theirs.tracked).toBe(false);
  });

  it("untrack removes only the caller's own row, leaving another org's alone", async () => {
    await trackParcel({ organizationId: ORG, state: "TX", county: "Travis", apn: "R123456" });
    await trackParcel({ organizationId: OTHER_ORG, state: "TX", county: "Travis", apn: "R123456" });

    const removed = await untrackParcel({
      organizationId: ORG,
      state: "TX",
      county: "Travis",
      apn: "R123456",
    });
    expect(removed.untracked).toBe(true);

    // Behavioural, not a source grep: the other tenant's row survives.
    expect(store.tracked).toHaveLength(1);
    expect(store.tracked[0].organizationId).toBe(OTHER_ORG);
  });

  it("untracking something you do not track reports untracked:false, not success", async () => {
    await trackParcel({ organizationId: OTHER_ORG, state: "TX", county: "Travis", apn: "R123456" });
    const removed = await untrackParcel({
      organizationId: ORG,
      state: "TX",
      county: "Travis",
      apn: "R123456",
    });
    expect(removed.untracked).toBe(false);
    expect(store.tracked).toHaveLength(1);
  });
});

// ─── 5. Migration artifacts — the repo's canonical defect ───────────────────

describe("migration artifacts — the table ships with BOTH DDL artifacts", () => {
  it("shared/schema.ts declares tracked_parcels with an org-leading unique key", () => {
    const schema = read("shared/schema.ts");
    expect(schema).toContain('export const trackedParcels = pgTable("tracked_parcels"');
    // Idempotency is enforced by the DATABASE, not only by a read-then-write
    // race in the service.
    expect(schema).toMatch(
      /uniqueIndex\("tracked_parcels_org_parcel_key"\)\s*\.on\(\s*table\.organizationId,\s*table\.state,\s*table\.county,\s*table\.apn,?\s*\)/,
    );
  });

  it("migrations/0230 creates the table and its unique index", () => {
    const sql = read("migrations/0230_tracked_parcels.sql");
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS "tracked_parcels"/);
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS "tracked_parcels_org_parcel_key"/,
    );
    expect(sql).toContain('"organization_id"');
  });

  it("the release-command mirror (scripts/migrate.mjs — what prod actually runs) carries the same DDL", () => {
    const migrate = read("scripts/migrate.mjs");
    expect(migrate).toMatch(/CREATE TABLE IF NOT EXISTS "tracked_parcels"/);
    expect(migrate).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS "tracked_parcels_org_parcel_key"/,
    );
  });
});

// ─── 6. Quick actions reuse EXISTING flows ─────────────────────────────────

describe("quick actions — existing flows only, no parallel offer path", () => {
  const inspector = () => read("client/src/components/maps/ParcelInspector.tsx");

  it("every quick-action destination is already a mounted route in App.tsx", () => {
    const app = read("client/src/App.tsx");
    const src = inspector();

    const destinations = [...src.matchAll(/href:\s*"(\/[a-z0-9/-]*)"/g)].map((m) => m[1]);
    expect(destinations.length).toBeGreaterThanOrEqual(3);

    for (const dest of destinations) {
      // Wouter mounts these as <Route path="/x">. The destination must match
      // an existing mounted path exactly — a quick action pointing at a route
      // nobody mounted is a dead button.
      expect(app).toContain(`<Route path="${dest}">`);
    }
  });

  it("the parcel-carrying action hands over params /properties actually reads", () => {
    const src = inspector();
    const properties = read("client/src/pages/properties.tsx");
    // "Opens Add Property with this parcel's location filled in" is a CLAIM
    // about another page. It holds only while that page reads these params.
    for (const param of ["addAtLat", "addAtLng", "addCounty", "addState"]) {
      expect(src).toContain(param);
      expect(properties).toContain(`urlParams.get("${param}")`);
    }
  });

  it("says per-action whether the parcel is carried, instead of implying all three are", () => {
    const src = inspector();
    // Each action declares `carriesParcel`, and the rendered note is DERIVED
    // from it — a single hand-written sentence would drift the moment an
    // action is added.
    expect(src).toContain("carriesParcel");
    expect(src).toMatch(/carriesParcel\s*&&/);
    expect(src).toContain("parcel-action-note-");
    expect(src).toContain("action.description");
  });

  it("the inspector does not introduce an offer path of its own", () => {
    const src = inspector();
    // The handoff is explicit: the existing offer flow is unchanged. The
    // inspector may LINK to /offers; it may not define a new one.
    expect(src).not.toMatch(/\/offers\/[a-z-]*new/);
    expect(src).not.toMatch(/api\/offers\/(create|draft)/);
  });

  it("the inspector renders the existing coverage CTA on an uncovered county", () => {
    const src = inspector();
    expect(src).toContain("RequestCountyCTA");
    expect(src).toContain("county-not-covered");
  });

  it("renders 'we checked …' from the server's inspected list, not from prose", () => {
    const src = inspector();
    // "We checked our county sources and our parcel cache" is a claim about
    // work that either happened or did not. It must be derived from the
    // payload field the server builds out of its real reads — a hand-written
    // sentence keeps promising both sources after one is dropped.
    expect(src).toContain("inspectedSentence(result.inspected)");
    expect(src).not.toMatch(/We checked our county sources and our parcel cache/);
  });
});

// ─── 7. Wiring — the route file is mounted AND the surface is rendered ─────

describe("wiring — built AND wired", () => {
  it("the identify/track routes file is registered in server/routes.ts", () => {
    const routes = read("server/routes.ts");
    expect(routes).toContain("registerParcelIdentifyRoutes");
    expect(routes).toContain("./routes-parcel-identify");
  });

  it("the route handlers use the house request/error/logging contracts", () => {
    const src = read("server/routes-parcel-identify.ts");
    expect(src).toContain("AuthenticatedRequest");
    expect(src).not.toMatch(/req as any/);
    expect(src).not.toMatch(/res\.status\(\d+\)\.json\(/);
    expect(src).not.toMatch(/console\.(log|warn|error)/);
  });

  it("the Map door renders the inspector and feeds it real taps", () => {
    const inspector = read("client/src/components/maps/ParcelInspector.tsx");
    expect(inspector).toContain("/api/parcel-identify");

    // The map must hand the inspector a real tap, or none of this is
    // reachable. This is the check the dead run left red: the component and
    // the endpoint both existed and nothing rendered either.
    const map = read("client/src/components/property-map.tsx");
    expect(map).toContain("onParcelIdentify");

    const page = read("client/src/pages/maps.tsx");
    expect(page).toContain("ParcelInspector");
    expect(page).toContain("onParcelIdentify={handleParcelIdentify}");
    // Rendered, not merely imported — and given the tap state as its target.
    expect(page).toMatch(/<ParcelInspector\s+target=\{identifyTarget\}/);
  });

  it("lives behind the Map door — no new route, no new nav entry", () => {
    const app = read("client/src/App.tsx");
    expect(app).not.toContain("parcel-inspector");
    expect(app).not.toMatch(/<Route path="\/parcels?\/identify"/);
  });
});
