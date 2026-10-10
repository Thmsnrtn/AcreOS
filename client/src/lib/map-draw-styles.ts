/**
 * mapbox-gl-draw's default theme, made valid for MapLibre.
 *
 * The theme writes array arguments inside expressions bare
 * (`line-dasharray: ["case", cond, [0.2, 2], [2, 0]]`). Mapbox GL tolerates
 * that; MapLibre parses `[0.2, 2]` as an expression named 0.2 and rejects the
 * whole layer, so the draw tools' line layers never existed and drawn lots and
 * roads were invisible. Every bare array inside an expression is wrapped in
 * ["literal", …]; nothing else changes.
 */
import MapboxDraw from "@mapbox/mapbox-gl-draw";

type Json = unknown;

function literalize(v: Json, inExpr: boolean): Json {
  if (!Array.isArray(v)) return v;
  if (v[0] === "literal") return v;
  if (inExpr && v.length > 0 && v.every((x) => typeof x === "number")) return ["literal", v];
  const isExpr = typeof v[0] === "string";
  return v.map((x) => literalize(x, isExpr));
}

function fixProps(props: Record<string, Json> | undefined): Record<string, Json> | undefined {
  if (!props) return props;
  return Object.fromEntries(Object.entries(props).map(([k, v]) => [k, literalize(v, false)]));
}

export function drawStylesForMapLibre(): object[] {
  const theme = (MapboxDraw as unknown as { lib: { theme: Array<Record<string, Json>> } }).lib.theme;
  // Only the keys the theme set: MapLibre rejects an explicit `layout: undefined`.
  return theme.map((layer) => {
    const out: Record<string, Json> = { ...layer };
    if (layer.paint) out.paint = fixProps(layer.paint as Record<string, Json>);
    if (layer.layout) out.layout = fixProps(layer.layout as Record<string, Json>);
    return out;
  });
}
