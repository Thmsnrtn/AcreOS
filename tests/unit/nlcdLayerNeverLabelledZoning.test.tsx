// @vitest-environment jsdom
/**
 * The map raster sourced from USGS NLCD is LAND COVER, never "zoning"
 * (P1-C item 4).
 *
 * property-map.tsx added a raster source with `attribution: "USGS NLCD"` and
 * showed it to the customer as "Zoning Districts" — in the layer checkbox and
 * in the load-status chip (OVERLAY_SOURCE_LABELS). Land cover (forest / crop /
 * developed) is not a legal land-use designation, and a buyer reading
 * "zoning" draws a conclusion the data cannot support.
 *
 * Population: EVERY `addSource(...)` in property-map.tsx whose body names
 * NLCD (attribution or tile URL constant that resolves to the NLCD service),
 * with a vacuity floor of 1. For each, the customer-facing label for that
 * source id, and the <Label> of the checkbox whose handler adds that source,
 * must not say zoning. Comments are stripped first so the explanatory note
 * about the old label cannot be read as the defect.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { stripComments } from "../helpers/stripComments";
import { OverlayLegend } from "../../client/src/components/maps/OverlayLegend";

const MAP = path.resolve(__dirname, "../../client/src/components/property-map.tsx");
const src = stripComments(readFileSync(MAP, "utf8"));

/** Constants (const X = "url") so a tile URL can be resolved by name. */
const consts = new Map<string, string>();
for (const m of src.matchAll(/const\s+([A-Z_][A-Z0-9_]*)\s*=\s*"([^"]*)"/g)) consts.set(m[1], m[2]);

/** NLCD's ScienceBase MapServer (the service USGS_LAND_USE_URL points at). */
const NLCD_URL_MARKERS = ["5f9637fad34eb2e5df3d40a2"];

const labelsBlock = src.match(/const OVERLAY_SOURCE_LABELS[^=]*=\s*\{([\s\S]*?)\};/)?.[1] ?? "";
function overlayLabel(key: string): string | null {
  return labelsBlock.match(new RegExp(`"${key}"\\s*:\\s*"([^"]+)"`))?.[1] ?? null;
}

interface NlcdSource { sourceId: string; addFn: string | null }

function nlcdSources(): NlcdSource[] {
  const out: NlcdSource[] = [];
  const re = /addSource\(\s*"([^"]+)"\s*,\s*\{/g;
  for (const m of src.matchAll(re)) {
    // Body = up to the matching close brace.
    let depth = 1;
    let i = m.index! + m[0].length;
    for (; i < src.length && depth > 0; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") depth--;
    }
    const body = src.slice(m.index!, i);
    const urlRefs = [...body.matchAll(/\$\{([A-Z_][A-Z0-9_]*)\}/g)].map((x) => consts.get(x[1]) ?? "");
    const isNlcd = /NLCD/.test(body) || urlRefs.some((u) => NLCD_URL_MARKERS.some((k) => u.includes(k)));
    if (!isNlcd) continue;
    // The useCallback that contains this addSource.
    const before = src.slice(0, m.index!);
    const fnMatch = [...before.matchAll(/const\s+(\w+)\s*=\s*useCallback\(/g)].pop();
    out.push({ sourceId: m[1], addFn: fnMatch ? fnMatch[1] : null });
  }
  return out;
}

describe("NLCD map layer labelling", () => {
  const sources = nlcdSources();

  it("finds the NLCD raster source(s) (vacuity floor)", () => {
    expect(sources.length).toBeGreaterThanOrEqual(1);
  });

  it("OVERLAY_SOURCE_LABELS never calls an NLCD source zoning", () => {
    const block = src.match(/const OVERLAY_SOURCE_LABELS[^=]*=\s*\{([\s\S]*?)\};/);
    expect(block).not.toBeNull();
    for (const s of sources) {
      const label = block![1].match(new RegExp(`"${s.sourceId}"\\s*:\\s*"([^"]+)"`));
      expect(label, `label for ${s.sourceId}`).not.toBeNull();
      expect(label![1]).not.toMatch(/zoning/i);
      expect(label![1]).toMatch(/land cover/i);
      expect(label![1]).toMatch(/NLCD/);
    }
  });

  it("the layer-panel checkbox that turns an NLCD source on is not labelled zoning", () => {
    for (const s of sources) {
      expect(s.addFn, `add function for ${s.sourceId}`).not.toBeNull();
      // Handler(s) that call the add function.
      const handlers = [...src.matchAll(/const\s+(\w+)\s*=\s*useCallback\(([\s\S]*?)\}\s*,\s*\[/g)]
        .filter((h) => new RegExp(`\\b${s.addFn}\\(`).test(h[2]) && h[1] !== s.addFn)
        .map((h) => h[1]);
      expect(handlers.length, `toggle handler for ${s.addFn}`).toBeGreaterThanOrEqual(1);
      let checkedLabels = 0;
      for (const h of handlers) {
        for (const cb of src.matchAll(/<Checkbox\b([\s\S]*?)\/>/g)) {
          if (!new RegExp(`\\b${h}\\(`).test(cb[1])) continue;
          const id = cb[1].match(/\bid="([^"]+)"/)?.[1];
          expect(id).toBeTruthy();
          expect(id!).not.toMatch(/zoning/i);
          expect(cb[1]).not.toMatch(/data-testid="[^"]*zoning/i);
          const lab = src.match(new RegExp(`<Label\\s+htmlFor="${id}"[^>]*>([\\s\\S]*?)</Label>`));
          expect(lab, `label for checkbox ${id}`).not.toBeNull();
          // Resolve `{OVERLAY_SOURCE_LABELS["id"]}` to the text it renders —
          // the KEY is an internal id; the VALUE is what the customer reads.
          const rendered = lab![1].replace(
            /\{\s*OVERLAY_SOURCE_LABELS\["([^"]+)"\]\s*\}/g,
            (_m, key) => overlayLabel(key) ?? "<<unresolved>>",
          );
          expect(rendered).not.toMatch(/unresolved/);
          expect(rendered).not.toMatch(/zoning/i);
          expect(rendered.trim().length).toBeGreaterThan(0);
          checkedLabels++;
        }
      }
      expect(checkedLabels).toBeGreaterThanOrEqual(1);
    }
  });

  it("the overlay legend for the NLCD layer says land cover, not zoning", async () => {
    const el = document.createElement("div");
    const root = createRoot(el);
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    await act(async () => {
      root.render(<OverlayLegend active={{ zoningDistricts: true }} />);
    });
    expect(el.textContent ?? "").toMatch(/land cover/i);
    expect(el.textContent ?? "").toMatch(/NLCD/);
    expect(el.textContent ?? "").not.toMatch(/zoning/i);
    act(() => root.unmount());
  });
});
