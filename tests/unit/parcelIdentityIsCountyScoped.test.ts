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

const h = vi.hoisted(() => ({ queue: [] as unknown[][] }));

vi.mock("../../server/db", () => {
  const chain = () => {
    const next = h.queue.shift() ?? [];
    const p = Promise.resolve(next);
    const c: Record<string, unknown> = {};
    for (const k of ["from", "where", "orderBy", "limit"]) c[k] = () => c;
    c.then = p.then.bind(p);
    c.catch = p.catch.bind(p);
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
