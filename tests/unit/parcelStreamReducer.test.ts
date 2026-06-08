/**
 * parcelStreamReducer — unit tests for the streaming parcel-check state machine.
 *
 * Covers the contract the boldest-bet UX depends on:
 *   - tiles transition querying → resolved / missing
 *   - meter math (arrived / total / complete) stays consistent with the tiles
 *   - honesty: an unavailable source lands as `missing`, never a fake value
 *   - ordering tolerance: source-before-meta, late meta backfill
 *   - terminal phases: done / unresolved / error
 */

import { describe, it, expect } from "vitest";
import {
  parcelStreamReducer,
  initialParcelStreamState,
  streamMeter,
  type ParcelStreamState,
  type StreamedSource,
  type ParcelStreamCategory,
} from "../../client/src/components/parcels/parcel-stream-reducer";

const CATS: ParcelStreamCategory[] = [
  "flood_zone",
  "soil",
  "elevation",
  "wetlands",
  "demographics",
];

function source(
  category: ParcelStreamCategory,
  available: boolean,
  overrides: Partial<StreamedSource> = {},
): StreamedSource {
  return {
    category,
    available,
    data: available ? { value: "x" } : null,
    source: available ? "FEMA NFHL" : null,
    sourceAsOf: null,
    classification: "authoritative",
    confidence: null,
    fromCache: false,
    ...overrides,
  };
}

function meta(state: ParcelStreamState): ParcelStreamState {
  return parcelStreamReducer(state, {
    type: "meta",
    coordinates: { lat: 32.1, lng: -110.2 },
    matchedAddress: "123 County Rd, AZ",
    categories: CATS,
  });
}

describe("parcelStreamReducer", () => {
  it("starts idle with empty tiles", () => {
    expect(initialParcelStreamState.phase).toBe("idle");
    expect(initialParcelStreamState.tiles).toHaveLength(0);
    expect(streamMeter(initialParcelStreamState)).toEqual({
      arrived: 0,
      total: null,
      complete: false,
    });
  });

  it("open → connecting, then meta seeds one querying tile per category", () => {
    let s = parcelStreamReducer(initialParcelStreamState, { type: "open" });
    expect(s.phase).toBe("connecting");
    s = meta(s);
    expect(s.phase).toBe("streaming");
    expect(s.tiles).toHaveLength(CATS.length);
    expect(s.tiles.every((t) => t.status === "querying")).toBe(true);
    expect(s.totalCount).toBe(CATS.length);
    expect(s.coordinates).toEqual({ lat: 32.1, lng: -110.2 });
    expect(s.matchedAddress).toBe("123 County Rd, AZ");
  });

  it("a resolved source flips its tile querying → resolved and bumps the meter", () => {
    let s = meta(parcelStreamReducer(initialParcelStreamState, { type: "open" }));
    s = parcelStreamReducer(s, {
      type: "source",
      source: source("flood_zone", true),
    });
    const tile = s.tiles.find((t) => t.category === "flood_zone")!;
    expect(tile.status).toBe("resolved");
    expect(tile.result?.source).toBe("FEMA NFHL");
    expect(s.resolvedCount).toBe(1);
    expect(s.missingCount).toBe(0);
    expect(streamMeter(s).arrived).toBe(1);
    expect(streamMeter(s).total).toBe(CATS.length);
    expect(streamMeter(s).complete).toBe(false);
  });

  it("an unavailable source lands as missing, never a fake value", () => {
    let s = meta(parcelStreamReducer(initialParcelStreamState, { type: "open" }));
    s = parcelStreamReducer(s, {
      type: "source",
      source: source("wetlands", false),
    });
    const tile = s.tiles.find((t) => t.category === "wetlands")!;
    expect(tile.status).toBe("missing");
    expect(tile.result?.available).toBe(false);
    expect(tile.result?.data).toBeNull();
    expect(s.missingCount).toBe(1);
    expect(s.resolvedCount).toBe(0);
  });

  it("counts stay consistent across a full resolved/missing mix", () => {
    let s = meta(parcelStreamReducer(initialParcelStreamState, { type: "open" }));
    s = parcelStreamReducer(s, { type: "source", source: source("flood_zone", true) });
    s = parcelStreamReducer(s, { type: "source", source: source("soil", true) });
    s = parcelStreamReducer(s, { type: "source", source: source("elevation", false) });
    s = parcelStreamReducer(s, { type: "source", source: source("wetlands", true) });
    s = parcelStreamReducer(s, { type: "source", source: source("demographics", false) });
    expect(s.resolvedCount).toBe(3);
    expect(s.missingCount).toBe(2);
    const m = streamMeter(s);
    expect(m.arrived).toBe(5);
    expect(m.total).toBe(5);
    expect(m.complete).toBe(true); // all expected sources reported
  });

  it("done sets the phase + lookup time and marks the meter complete", () => {
    let s = meta(parcelStreamReducer(initialParcelStreamState, { type: "open" }));
    s = parcelStreamReducer(s, { type: "source", source: source("flood_zone", true) });
    s = parcelStreamReducer(s, { type: "done", lookupTimeMs: 1234 });
    expect(s.phase).toBe("done");
    expect(s.lookupTimeMs).toBe(1234);
    expect(streamMeter(s).complete).toBe(true);
  });

  it("tolerates a source arriving before meta (fast cache hit), backfilled by late meta", () => {
    let s = parcelStreamReducer(initialParcelStreamState, { type: "open" });
    // source before meta
    s = parcelStreamReducer(s, { type: "source", source: source("soil", true) });
    expect(s.tiles).toHaveLength(1);
    expect(s.resolvedCount).toBe(1);
    // late meta should keep the resolved soil tile and add the rest as querying
    s = meta(s);
    expect(s.tiles).toHaveLength(CATS.length);
    const soil = s.tiles.find((t) => t.category === "soil")!;
    expect(soil.status).toBe("resolved");
    expect(s.tiles.filter((t) => t.status === "querying")).toHaveLength(CATS.length - 1);
    expect(s.resolvedCount).toBe(1);
  });

  it("a second source event for the same category updates in place (no duplicate tile)", () => {
    let s = meta(parcelStreamReducer(initialParcelStreamState, { type: "open" }));
    s = parcelStreamReducer(s, { type: "source", source: source("flood_zone", false) });
    expect(s.missingCount).toBe(1);
    s = parcelStreamReducer(s, { type: "source", source: source("flood_zone", true) });
    expect(s.tiles.filter((t) => t.category === "flood_zone")).toHaveLength(1);
    expect(s.resolvedCount).toBe(1);
    expect(s.missingCount).toBe(0);
  });

  it("unresolved resets to a clean terminal state with the honest message", () => {
    let s = meta(parcelStreamReducer(initialParcelStreamState, { type: "open" }));
    s = parcelStreamReducer(s, {
      type: "unresolved",
      message: "Could not locate that address.",
    });
    expect(s.phase).toBe("unresolved");
    expect(s.message).toBe("Could not locate that address.");
    expect(s.tiles).toHaveLength(0);
    expect(s.resolvedCount).toBe(0);
  });

  it("error preserves arrived tiles and surfaces the message", () => {
    let s = meta(parcelStreamReducer(initialParcelStreamState, { type: "open" }));
    s = parcelStreamReducer(s, { type: "source", source: source("flood_zone", true) });
    s = parcelStreamReducer(s, { type: "error", message: "boom" });
    expect(s.phase).toBe("error");
    expect(s.message).toBe("boom");
    expect(s.resolvedCount).toBe(1); // partial progress retained
  });

  it("reset returns to the initial state", () => {
    let s = meta(parcelStreamReducer(initialParcelStreamState, { type: "open" }));
    s = parcelStreamReducer(s, { type: "source", source: source("soil", true) });
    s = parcelStreamReducer(s, { type: "reset" });
    expect(s).toEqual(initialParcelStreamState);
  });

  it("streamMeter is complete once arrived >= total even before an explicit done", () => {
    let s = meta(parcelStreamReducer(initialParcelStreamState, { type: "open" }));
    for (const c of CATS) {
      s = parcelStreamReducer(s, { type: "source", source: source(c, true) });
    }
    expect(s.phase).toBe("streaming"); // no done yet
    expect(streamMeter(s).complete).toBe(true);
  });
});
