/**
 * DEFECT-0128 — a parcel is APN + STATE + COUNTY.
 *
 * APNs are assigned per county. The delta detector keyed its tracked set, its
 * observation match and its lead/property link on apn|state, and pushed a
 * delta even when nothing linked. So a same-APN owner or tax change in another
 * county (or state) reached a customer's Today feed as a change "on their
 * parcel". This drives the real detectDeltasForOrg against a scripted db.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { stripComments } from "../helpers/stripComments";

const h = vi.hoisted(() => ({ queue: [] as unknown[][], awaited: 0 }));

// A query consumes its scripted rows when it is AWAITED, not when select() is
// called: the observation read builds a windowed subquery (.as()) that is
// never awaited on its own.
vi.mock("../../server/db", () => {
  const chain = () => {
    const c: Record<string, unknown> = {};
    for (const k of ["from", "where", "orderBy", "limit"]) c[k] = () => c;
    c.as = () => new Proxy({}, { get: (_t, prop) => ({ name: String(prop) }) });
    c.then = (f: (v: unknown) => unknown, r?: (e: unknown) => unknown) => {
      h.awaited++;
      return Promise.resolve(h.queue.shift() ?? []).then(f, r);
    };
    return c;
  };
  return { db: { select: () => chain() } };
});
vi.mock("../../server/storage", () => ({ db: {}, storage: {} }));
vi.mock("../../server/services/workflow-engine", () => ({ emitDurableParcelEvent: vi.fn() }));

import { detectDeltasForOrg } from "../../server/services/parcelDeltaDetector";

const T0 = new Date("2026-09-01T00:00:00Z");
const T1 = new Date("2026-09-20T00:00:00Z");
function change(state: string, county: string) {
  // newest first, as the query orders
  return [
    { apn: "123-45", state, county, field: "owner", value: "New Owner LLC", source: "gis", confidence: 0.9, observedAt: T1 },
    { apn: "123-45", state, county, field: "owner", value: "Old Owner", source: "gis", confidence: 0.9, observedAt: T0 },
  ];
}

beforeEach(() => {
  h.queue.length = 0;
  h.awaited = 0;
});

describe("DEFECT-0128 — deltas are matched on full parcel identity", () => {
  it("only the tracked county's change becomes an alert, linked to its property", async () => {
    h.queue.push([{ apn: "123-45", state: "TX", county: "Travis", id: 11 }]); // properties
    h.queue.push([]); // leads
    h.queue.push([...change("TX", "Travis"), ...change("TX", "Harris"), ...change("OK", "Tulsa")]); // observations
    const deltas = await detectDeltasForOrg(7);
    expect(deltas.map((d) => `${d.state}/${d.county}`)).toEqual(["TX/Travis"]);
    expect(deltas[0].propertyId).toBe(11);
  });

  it("a lead with no county is not guessed onto an ambiguous parcel", async () => {
    // The org owns the APN in two TX counties; the county-less lead is ambiguous.
    h.queue.push([
      { apn: "123-45", state: "TX", county: "Travis", id: 11 },
      { apn: "123-45", state: "TX", county: "Harris", id: 12 },
    ]);
    h.queue.push([{ apn: "123-45", state: "TX", id: 99 }]);
    h.queue.push([...change("TX", "Harris")]);
    const deltas = await detectDeltasForOrg(7);
    expect(deltas).toHaveLength(1);
    expect(deltas[0].propertyId).toBe(12);
    expect(deltas[0].leadId).toBeNull();
  });

  it("county matching ignores case and surrounding space", async () => {
    h.queue.push([{ apn: "123-45", state: "tx", county: " travis ", id: 11 }]);
    h.queue.push([]);
    h.queue.push([...change("TX", "Travis")]);
    const deltas = await detectDeltasForOrg(7);
    expect(deltas.map((d) => d.propertyId)).toEqual([11]);
  });
});

describe("DEFECT-0141 — the observation read is bounded", () => {
  it("a large pipeline is read in APN chunks, not one unbounded IN list", async () => {
    const props = Array.from({ length: 1200 }, (_, i) => ({ apn: `A-${i}`, state: "TX", county: "Travis", id: i + 1 }));
    h.queue.push(props); // properties
    h.queue.push([]); // leads
    await detectDeltasForOrg(7);
    // properties + leads + ceil(1200 / 500) observation chunks
    expect(h.awaited).toBe(2 + 3);
  });

  it("keeps only the latest two observations per parcel field, in SQL", () => {
    const src = stripComments(readFileSync(resolve(__dirname, "../../server/services/parcelDeltaDetector.ts"), "utf8"));
    const body = src.slice(src.indexOf("export async function loadObservationPairs"), src.indexOf("export async function detectDeltasForOrg"));
    expect(body).toMatch(/row_number\(\) over \(partition by/);
    expect(body).toMatch(/\$\{ranked\.rn\} <= 2/);
  });
});
