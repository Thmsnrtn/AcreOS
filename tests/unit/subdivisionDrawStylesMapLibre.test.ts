/**
 * The subdivision editor's draw layers must be valid MapLibre style.
 *
 * Found in a browser (W2 audit, 2026-10-10): mapbox-gl-draw's default theme
 * writes `line-dasharray: ["case", cond, [0.2, 2], [2, 0]]`. Mapbox GL accepts
 * a bare array there; MapLibre reads `[0.2, 2]` as an expression whose name
 * is a number and REJECTS the layer ("Expression name must be a string"), so
 * gl-draw-lines.cold/.hot never existed: lot outlines and road centerlines
 * were invisible while being drawn and after. The editor must hand MapLibre
 * styles in which every array argument inside an expression is ["literal", …].
 */
import { describe, expect, it } from "vitest";
import MapboxDraw from "@mapbox/mapbox-gl-draw";
import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import { drawStylesForMapLibre } from "../../client/src/lib/map-draw-styles";

/** Paths of bare numeric arrays nested inside an expression. */
function bareArrays(v: unknown, path: string, inExpr: boolean, out: string[]) {
  if (!Array.isArray(v)) return;
  if (v.length > 0 && typeof v[0] === "number" && inExpr) { out.push(path); return; }
  if (v[0] === "literal") return;
  const isExpr = typeof v[0] === "string";
  v.forEach((x, i) => bareArrays(x, `${path}[${i}]`, isExpr, out));
}

describe("subdivision editor draw styles on MapLibre", () => {
  const styles = drawStylesForMapLibre();

  it("keeps every layer of the draw theme (nothing dropped to make it pass)", () => {
    const ids = (styles as Array<{ id: string }>).map((s) => s.id);
    const theme = (MapboxDraw as unknown as { lib: { theme: Array<{ id: string }> } }).lib.theme;
    expect(theme.length, "the draw theme was not found").toBeGreaterThanOrEqual(5);
    expect(ids).toEqual(theme.map((l) => l.id));
    expect(ids).toContain("gl-draw-lines");
  });

  it("no expression carries a bare array argument", () => {
    const bad: string[] = [];
    for (const layer of styles as Array<{ id: string; paint?: Record<string, unknown>; layout?: Record<string, unknown> }>) {
      for (const [k, v] of Object.entries({ ...layer.paint, ...layer.layout })) bareArrays(v, `${layer.id}.${k}`, false, bad);
    }
    expect(bad).toEqual([]);
  });

  it("adds no property the theme did not have (MapLibre rejects `layout: undefined`)", () => {
    for (const layer of styles as Array<Record<string, unknown>>) {
      for (const [k, v] of Object.entries(layer)) expect(v, `${layer.id}.${k}`).not.toBeUndefined();
    }
  });

  it("MapLibre's own style validator accepts every layer, as draw adds them (.cold and .hot)", () => {
    // The semantic check: the validator MapLibre runs in map.addLayer().
    const layers = (styles as Array<Record<string, unknown>>).flatMap((l) =>
      ["cold", "hot"].map((s) => ({ ...l, id: `${l.id}.${s}`, source: `mapbox-gl-draw-${s}` })),
    );
    const style = {
      version: 8,
      sources: { "mapbox-gl-draw-cold": { type: "geojson", data: { type: "FeatureCollection", features: [] } }, "mapbox-gl-draw-hot": { type: "geojson", data: { type: "FeatureCollection", features: [] } } },
      layers,
    };
    expect(validateStyleMin(style as never).map((e: { message: string }) => e.message)).toEqual([]);
  });

  it("the dash pattern survives, as a literal", () => {
    const lines = (styles as Array<{ id: string; paint?: Record<string, unknown> }>).find((s) => s.id === "gl-draw-lines")!;
    expect(JSON.stringify(lines.paint!["line-dasharray"])).toContain('["literal",[0.2,2]]');
  });
});
