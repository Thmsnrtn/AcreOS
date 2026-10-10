// @vitest-environment jsdom
/**
 * The subdivision plan editor must actually build its map.
 *
 * Found by driving the editor in a browser (W2 audit, 2026-10-10): "Edit on
 * map" opened the card, the draw tools' kind chips rendered, and there was no
 * map — no canvas, no draw controls. The map-init effect ran once, on the
 * first render, while the plan was still loading and the component was
 * returning a Skeleton, so its container ref was null; with `[]` deps it
 * never ran again. The editor has never drawn anything for a plan that had to
 * be fetched, which is every plan.
 *
 * This mounts the editor with the plan request pending, resolves it, and
 * requires a Map to be constructed on the real container.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mapCtor = vi.hoisted(() => vi.fn());
const drawCtor = vi.hoisted(() => vi.fn());

vi.mock("maplibre-gl", () => {
  class FakeMap {
    constructor(opts: { container: HTMLElement }) {
      mapCtor(opts);
    }
    addControl() {}
    on() {}
    once() {}
    off() {}
    remove() {}
    isStyleLoaded() { return false; }
    getSource() { return undefined; }
    getLayer() { return undefined; }
    fitBounds() {}
  }
  class NavigationControl {}
  return { Map: FakeMap, NavigationControl, setWorkerUrl: () => {}, default: { Map: FakeMap, NavigationControl } };
});
vi.mock("maplibre-gl/dist/maplibre-gl.css", () => ({}));
vi.mock("maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url", () => ({ default: "/worker.js" }));
vi.mock("@mapbox/mapbox-gl-draw", () => ({
  default: class {
    static constants = { classes: {} as Record<string, string> };
    static lib = { theme: [{ id: "gl-draw-lines", paint: { "line-dasharray": ["case", ["==", 1, 1], [0.2, 2], [2, 0]] } }] };
    constructor(opts: unknown) { drawCtor(opts); }
    add() { return []; } getAll() { return { type: "FeatureCollection", features: [] }; } deleteAll() {} set() {} setFeatureProperty() {} },
}));
vi.mock("@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css", () => ({}));
vi.mock("maplibre-contour", () => ({ default: {} }));

import { SubdivisionPlanEditor } from "../../client/src/components/parcels/subdivision-plan-editor";

let root: Root | null = null;
let host: HTMLDivElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  vi.unstubAllGlobals();
  mapCtor.mockReset();
  drawCtor.mockReset();
});

describe("SubdivisionPlanEditor", () => {
  it("builds its map once the plan has loaded (not only on the first, loading render)", async () => {
    let releasePlan!: () => void;
    const planGate = new Promise<void>((r) => (releasePlan = r));
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "Content-Type": "application/json" } });
      if (String(url).includes("/api/plans/")) {
        await planGate;
        return json({ plan: { id: "p1", name: "Plan A", versionNumber: 1, parentParcelId: null, status: "draft", geojson: { type: "FeatureCollection", features: [] } } });
      }
      return json(null);
    }));

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root!.render(
        <QueryClientProvider client={qc}>
          <SubdivisionPlanEditor planId="p1" />
        </QueryClientProvider>,
      );
    });
    expect(mapCtor).not.toHaveBeenCalled(); // still loading: nothing to mount on

    await act(async () => {
      releasePlan();
      await new Promise((r) => setTimeout(r, 20));
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    expect(mapCtor, "the editor never constructed its map").toHaveBeenCalledTimes(1);
    const container = mapCtor.mock.calls[0][0].container as HTMLElement;
    expect(host.contains(container), "the map was built on a detached container").toBe(true);
    // The draw tools get MapLibre-valid styles, not mapbox-gl-draw's default
    // theme (whose bare dash arrays MapLibre rejects).
    expect(drawCtor).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(drawCtor.mock.calls[0][0].styles)).toContain('["literal",[0.2,2]]');
  });
});
