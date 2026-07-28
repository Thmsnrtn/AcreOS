/**
 * Source-shape guard for the client-side FEMA NFHL URL (2026-07-28).
 *
 * FEMA migrated the public NFHL service off the `/gis/nfhl/` path — that host
 * is now a WebSEAL gateway returning an HTML error page — to `/arcgis/`. The
 * server-side broker was fixed on 2026-06-09 (data-source-broker.ts,
 * open-data-provider.ts healthCheck) but the client map overlay kept the dead
 * host, so the FEMA flood overlay silently rendered nothing.
 *
 * These assertions read the component SOURCE (no network, no DOM): the dead
 * `/gis/nfhl/` path must never reappear, and the working `/arcgis/` NFHL
 * MapServer must be the tile-export base.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SOURCE_PATH = resolve(__dirname, "../../client/src/components/property-map.tsx");
const source = readFileSync(SOURCE_PATH, "utf8");

describe("property-map.tsx FEMA NFHL URL (source shape)", () => {
  it("does NOT reference the dead /gis/nfhl/ WebSEAL path anywhere", () => {
    expect(source).not.toContain("/gis/nfhl/");
  });

  it("uses the current /arcgis/ NFHL MapServer as the flood-overlay base", () => {
    expect(source).toContain(
      "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer",
    );
  });

  it("pins the tile export to the server-verified flood-zones layer (28)", () => {
    // Layer 28 is the flood-hazard-zones layer the server-side broker queries
    // successfully on the /arcgis/ host; the raster export pins to it instead
    // of trusting the new service's default visible-layer set.
    expect(source).toMatch(/FEMA_NFHL_FLOOD_LAYER = 28/);
    expect(source).toMatch(/layers=show:\$\{FEMA_NFHL_FLOOD_LAYER\}/);
  });
});
