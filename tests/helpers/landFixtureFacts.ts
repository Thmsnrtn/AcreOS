/**
 * Real engine facts for the committed TN accuracy-sample parcels, shaped as
 * the owned parcel_snapshots rows the public surfaces read. Shared by the W3
 * public-land tests so they exercise the shipping engine and the real gate,
 * not hand-written fact objects.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { computeParcelFacts, type ParcelContext } from "../../server/services/landData/computeParcelFacts";
import { slopeSamplerFromGrids, type ElevationGrid } from "../../server/services/landData/dem";
import { areaCentroid } from "../../server/services/landData/geometry";
import type { ParcelFactSet } from "@shared/landData/parcelFacts";

const root = path.resolve(__dirname, "../..");
export const fx = JSON.parse(readFileSync(path.join(root, "tests/fixtures/land-data/tn-accuracy-sample.json"), "utf8"));

function contextFor(p: any): ParcelContext {
  const L = fx.meta.layers;
  const grids: ElevationGrid[] = p.context.dem.map((g: any) => {
    const b = Buffer.from(g.dataB64, "base64");
    return { ...g, data: new Float32Array(b.buffer, b.byteOffset, b.length / 4) };
  });
  return {
    roads: { source: L.roads, features: p.context.roads },
    wetlands: { source: L.wetlands, features: p.context.wetlands },
    flood: { source: L.flood, features: p.context.flood.features, firmCovered: p.context.flood.firmCovered },
    publicLands: { source: L.publicLands, features: p.context.publicLands },
    transmission: null,
    towns: { source: L.towns, features: p.context.towns },
    slope: slopeSamplerFromGrids(grids, L.slope),
  };
}

export function factsFor(p: any): ParcelFactSet {
  return computeParcelFacts(
    { parcelKey: p.parcelKey, state: "TN", county: p.county, sourceParcelId: p.sourceParcelId, geometry: p.geometry, deededAcres: p.deededAcres },
    contextFor(p),
  );
}

/** An owned parcel_snapshots row for sample parcel i (as saveOwnedParcels writes it). */
export function ownedRowFor(i: number): any {
  const p = fx.parcels[i];
  const [lng, lat] = areaCentroid(p.geometry);
  return {
    id: i + 1,
    organizationId: null,
    apn: p.gisLink.replace(/\s+/g, " ").trim(),
    state: "TN",
    county: "dekalb",
    source: "owned_pipeline",
    sourceId: p.gisLink,
    boundary: p.geometry,
    centroid: { lat, lng },
    acres: String(p.deededAcres),
    rawData: { sourceName: "TN Comptroller parcel download", deededAcres: p.deededAcres, attributes: {}, sourceIdHistory: [] },
    parcelKey: p.parcelKey,
    facts: factsFor(p),
    factsComputedAt: new Date("2026-10-10T00:00:00Z"),
    fetchedAt: new Date("2026-10-10T00:00:00Z"),
    expiresAt: null,
    updatedAt: new Date("2026-10-10T00:00:00Z"),
  };
}

/** Index of the first sample parcel whose labels say no access road within 20 m. */
export function noRoadParcelIndex(): number {
  return fx.parcels.findIndex((p: any) => p.labels.accessRoadWithin20m === false);
}

export function roadParcelIndex(): number {
  return fx.parcels.findIndex((p: any) => p.labels.accessRoadWithin20m === true);
}
