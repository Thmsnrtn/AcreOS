// @vitest-environment jsdom
/**
 * Click-a-parcel owner lookup, wired into the maps (Gap Slice 6).
 *
 * SinglePropertyMap runs against a fake maplibre `Map` so the REAL click
 * handler executes: a tap on a parcel feature looks up that parcel's APN (with
 * the map's county), a tap where no parcel is drawn looks up the tapped
 * coordinate, `showNearbyParcels={false}` turns the whole path off, and a 404
 * renders the honest not-covered state. DriveMode is rendered with the lazy map
 * stubbed to read the props it is handed: it must enable the path.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => {
  class FakeApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(`${status}: ${message}`);
      this.status = status;
    }
  }
  const maps: any[] = [];
  const driveProps: any[] = [];
  return { apiRequest: vi.fn(), FakeApiError, maps, driveProps };
});

vi.mock("../../client/src/lib/queryClient", () => ({
  apiRequest: h.apiRequest,
  ApiError: h.FakeApiError,
}));

vi.mock("maplibre-gl", () => {
  class FakeMap {
    handlers: Record<string, Array<(e: any) => void>> = {};
    features: any[] = [];
    layers = new Set<string>(["nearby-parcels-fill", "property-fill"]);
    constructor() {
      h.maps.push(this);
    }
    on(type: string, cb: (e: any) => void) {
      (this.handlers[type] ||= []).push(cb);
      return this;
    }
    once() {
      return this;
    }
    off() {
      return this;
    }
    addControl() {}
    getSource() {
      return undefined;
    }
    addSource() {}
    addLayer() {}
    getLayer(id: string) {
      return this.layers.has(id) ? { id } : undefined;
    }
    queryRenderedFeatures() {
      return this.features;
    }
    fitBounds() {}
    setTerrain() {}
    remove() {}
    getCanvas() {
      return { style: {} };
    }
    click(lat: number, lng: number) {
      for (const cb of this.handlers.click || []) cb({ point: { x: 5, y: 5 }, lngLat: { lat, lng } });
    }
  }
  class Stub {
    setLngLat() { return this; }
    setPopup() { return this; }
    setDOMContent() { return this; }
    addTo() { return this; }
    remove() {}
  }
  return { Map: FakeMap, NavigationControl: Stub, Marker: Stub, Popup: Stub, setWorkerUrl: () => {} };
});

vi.mock("../../client/src/components/property-map-lazy", async () => {
  const React = await import("react");
  return {
    SinglePropertyMap: (props: any) => {
      h.driveProps.push(props);
      return React.createElement("div", { "data-testid": "stub-single-map" });
    },
  };
});

vi.mock("../../client/src/hooks/use-mobile", () => ({
  useIsMobile: () => ({ isMobile: true }),
}));

import { SinglePropertyMap } from "../../client/src/components/property-map";
import { DriveMode } from "../../client/src/components/mobile/DriveMode";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

async function flush() {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

async function render(node: React.ReactElement) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  await act(async () => {
    root!.render(createElement(QueryClientProvider, { client: qc }, node));
  });
  await flush();
  return host;
}

const BOUNDARY = {
  type: "Polygon" as const,
  coordinates: [[[-115, 36], [-115, 36.1], [-114.9, 36.1], [-115, 36]]],
};

const FOUND = {
  ok: true,
  json: async () => ({
    apn: "123-45-678",
    boundary: BOUNDARY,
    centroid: { lat: 36.05, lng: -115 },
    data: {
      regridId: "r1",
      owner: "JANE Q DOE",
      ownerAddress: "1 Main St",
      taxAmount: "$412",
      lastUpdated: "2026-01-01",
      county: "Clark",
      state: "NV",
    },
  }),
};

beforeEach(() => {
  h.maps.length = 0;
  h.driveProps.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ parcels: [] }) })),
  );
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  h.apiRequest.mockReset();
  vi.unstubAllGlobals();
});

function mapEl(props: Record<string, unknown> = {}) {
  return createElement(SinglePropertyMap, {
    boundary: BOUNDARY,
    centroid: { lat: 36.05, lng: -115 },
    apn: "SUBJECT-1",
    state: "NV",
    county: "Clark",
    enable3DTerrain: false,
    ...props,
  });
}

describe("SinglePropertyMap — tap a parcel for its owner", () => {
  it("looks up the tapped parcel's APN with the map's county", async () => {
    h.apiRequest.mockResolvedValue(FOUND);
    const el = await render(mapEl());
    expect(h.maps).toHaveLength(1);
    h.maps[0].features = [{ properties: { apn: "123-45-678" } }];
    await act(async () => h.maps[0].click(36.06, -115.01));
    await flush();
    expect(h.apiRequest).toHaveBeenCalledWith("POST", "/api/parcels/lookup", {
      apn: "123-45-678",
      state: "NV",
      county: "Clark",
    });
    expect(el.querySelector('[data-testid="parcel-owner-name"]')?.textContent).toBe("JANE Q DOE");
  });

  it("looks up the tapped coordinate when no parcel feature is under the tap", async () => {
    h.apiRequest.mockResolvedValue(FOUND);
    await render(mapEl());
    h.maps[0].features = [];
    await act(async () => h.maps[0].click(36.2, -115.2));
    await flush();
    expect(h.apiRequest).toHaveBeenCalledWith("POST", "/api/parcels/lookup", {
      lat: 36.2,
      lng: -115.2,
    });
  });

  it("renders the honest not-covered state when the lookup finds nothing", async () => {
    h.apiRequest.mockRejectedValue(new h.FakeApiError(404, "Parcel not found"));
    const el = await render(mapEl());
    await act(async () => h.maps[0].click(36.2, -115.2));
    await flush();
    expect(el.querySelector('[data-testid="parcel-owner-not-covered"]')?.textContent).toMatch(
      /isn't covered here/i,
    );
    expect(el.querySelector('[data-testid="parcel-owner-name"]')).toBeNull();
  });

  it("does nothing when showNearbyParcels is off", async () => {
    const el = await render(mapEl({ showNearbyParcels: false }));
    await act(async () => h.maps[0].click(36.2, -115.2));
    await flush();
    expect(h.apiRequest).not.toHaveBeenCalled();
    expect(el.querySelector('[data-testid="parcel-owner-card"]')).toBeNull();
  });
});

describe("DriveMode — tap-a-parcel owner lookup is enabled", () => {
  beforeEach(() => {
    vi.stubGlobal("navigator", {
      ...navigator,
      geolocation: {
        watchPosition: (ok: (p: any) => void) => {
          ok({ coords: { latitude: 36.05, longitude: -115, accuracy: 5 } });
          return 1;
        },
        clearWatch: () => {},
      },
    });
  });

  it("passes the enabled flag and a compact card to the map", async () => {
    await render(createElement(DriveMode));
    const last = h.driveProps[h.driveProps.length - 1];
    expect(last, "DriveMode never rendered the map").toBeTruthy();
    expect(last.showNearbyParcels).toBe(true);
    expect(last.compactOwnerCard).toBe(true);
    expect(typeof last.onParcelResolved).toBe("function");
  });

  it("feeds the county a lookup resolved back to the map so the overlay can draw", async () => {
    await render(createElement(DriveMode));
    expect(h.driveProps[h.driveProps.length - 1].county).toBeUndefined();
    await act(async () => {
      h.driveProps[h.driveProps.length - 1].onParcelResolved({ state: "NV", county: "Clark" });
    });
    const last = h.driveProps[h.driveProps.length - 1];
    expect(last.state).toBe("NV");
    expect(last.county).toBe("Clark");
  });
});
