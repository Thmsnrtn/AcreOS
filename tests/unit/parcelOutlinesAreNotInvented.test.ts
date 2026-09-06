/**
 * A parcel outline on the map is a claim about a real lot. Nobody may invent one.
 *
 * `properties.tsx` used to fall back, when a property had no `parcel_boundary`,
 * to an axis-aligned square 0.003 degrees to a side — roughly a hundred acres —
 * centred on the geocode, and hand it to `<PropertyMap>` as that property's
 * `boundary`. The map drew it with the same layer, colour and weight as every
 * real boundary beside it. It is not an approximation: it has no relationship to
 * the lot's shape, frontage or buildable area, and it appears in precisely the
 * state where someone is most likely to be deciding from it — straight after a
 * CSV import, before the parcel lookup has run.
 *
 * That is the standing founder decision on fabrication ("no placeholder data
 * presented as real"), on a surface people buy land from. `maps.tsx` had already
 * settled it the honest way; this pins both, and anything that joins them.
 *
 * ── THE POPULATION ────────────────────────────────────────────────────────
 * Derived from the files that actually render `<PropertyMap>`, not typed out, so
 * a fourth page joins by existing rather than by someone remembering to add it.
 * The walk is asserted non-empty and the known members are asserted present —
 * a glob that silently stops matching reads exactly like a clean repository.
 *
 * ── WHAT IS *NOT* FORBIDDEN ───────────────────────────────────────────────
 * Constructing a polygon is not itself the defect. `DriveMode.tsx` builds a
 * ~110m box around the driver's own GPS fix because the single-property map
 * requires some extent to frame; that is a viewport, not a parcel claim, and it
 * says so. `property-map.tsx` builds polygons for its own drawing and viewport
 * layers. The rule is narrower and is the thing that actually matters: the
 * `boundary` handed to PropertyMap must be one we RECEIVED, never one we made.
 */

import { describe, expect, it, vi } from "vitest";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
// This gate walks the source tree; its cost scales with the repo, and under the
// coverage run it does not fit the suite’s 30s default. A killed gate reports
// nothing about what it guards, so the budget is declared, not inherited.
vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });


const ROOT = process.cwd();
const CLIENT_SRC = path.join(ROOT, "client", "src");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (["node_modules", "__snapshots__"].includes(e)) continue;
    const abs = path.join(dir, e);
    if (statSync(abs).isDirectory()) walk(abs, out);
    else if (/\.tsx?$/.test(e) && !/\.test\.tsx?$/.test(e)) out.push(abs);
  }
  return out;
}

/** Files that hand a feature list to <PropertyMap>. Derived, not enumerated. */
const clientFiles = walk(CLIENT_SRC);
const mapFeeders = clientFiles.filter((abs) => {
  const src = readFileSync(abs, "utf8");
  return /<PropertyMap[\s/>]/.test(src) && !/property-map\.tsx$/.test(abs);
});

/**
 * Does this expression construct a GeoJSON polygon?
 *
 * An OBJECT LITERAL with `type: "Polygon" | "MultiPolygon"`. Walking the AST
 * rather than the text is what separates the three honest shapes in this repo
 * from the one dishonest one: a TYPE annotation (`as { type: "Polygon" … }`) is
 * a TypeLiteral and is never visited, and a COMPARISON (`b.type === "Polygon"`)
 * is a binary expression, not a property assignment.
 */
function buildsAPolygon(node: ts.Node, sf: ts.SourceFile): boolean {
  let found = false;
  const visit = (n: ts.Node) => {
    if (found) return;
    if (ts.isObjectLiteralExpression(n)) {
      for (const prop of n.properties) {
        if (!ts.isPropertyAssignment(prop)) continue;
        if (prop.name.getText(sf).replace(/['"]/g, "") !== "type") continue;
        const value = ts.isAsExpression(prop.initializer)
          ? prop.initializer.expression
          : prop.initializer;
        if (ts.isStringLiteral(value) && /^(Multi)?Polygon$/.test(value.text)) {
          found = true;
          return;
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

/** Every `boundary: <expr>` property assignment in a file. */
function boundaryInitializers(src: string, file: string): Array<{ line: number; text: string }> {
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: Array<{ line: number; text: string }> = [];
  const visit = (n: ts.Node) => {
    if (
      ts.isPropertyAssignment(n) &&
      n.name.getText(sf).replace(/['"]/g, "") === "boundary" &&
      buildsAPolygon(n.initializer, sf)
    ) {
      out.push({
        line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1,
        text: n.getText(sf).slice(0, 120).replace(/\s+/g, " "),
      });
    }
    ts.forEachChild(n, visit);
  };
  ts.forEachChild(sf, visit);
  return out;
}

describe("a parcel outline is never invented", () => {
  it("the population is real", () => {
    expect(clientFiles.length, "the client walk found almost nothing").toBeGreaterThan(300);
    expect(mapFeeders.length, "nothing renders <PropertyMap> — the scan below is vacuous")
      .toBeGreaterThan(0);
    // The two known members, pinned by name. If a rename silently drops one from
    // the derived set, this fails rather than the set quietly shrinking to one.
    const rel = mapFeeders.map((f) => path.relative(ROOT, f));
    expect(rel).toContain("client/src/pages/properties.tsx");
    expect(rel).toContain("client/src/pages/maps.tsx");
  });

  it("no page hands PropertyMap a boundary it constructed itself", () => {
    const offenders: string[] = [];
    for (const abs of mapFeeders) {
      for (const hit of boundaryInitializers(readFileSync(abs, "utf8"), abs)) {
        offenders.push(`${path.relative(ROOT, abs)}:${hit.line}  ${hit.text}`);
      }
    }
    expect(
      offenders,
      "these build a GeoJSON polygon and pass it as a parcel `boundary`. A shape " +
        "we invented, drawn in the same style as a real one, is a claim about a " +
        "lot that nobody surveyed — omit the polygon and let the centroid locate " +
        "the property instead (see maps.tsx).",
    ).toEqual([]);
  });

  it("the detector sees a fabricated boundary when there is one", () => {
    // The exact shape that was live, so this arm cannot quietly stop matching.
    const fixture = [
      "const features = rows.map((p) => ({",
      "  id: p.id,",
      '  boundary: (p.parcelBoundary as any) || { type: "Polygon" as const, coordinates: [[[0,0],[1,0],[1,1],[0,1],[0,0]]] },',
      "}));",
    ].join("\n");
    expect(boundaryInitializers(fixture, "fixture.tsx")).toHaveLength(1);
  });

  it("the detector does NOT fire on the honest shapes this repo uses", () => {
    const passthrough = "const f = { boundary: (p.parcelBoundary as any) || undefined };";
    expect(boundaryInitializers(passthrough, "fixture.tsx")).toEqual([]);

    // A type assertion names "Polygon" without constructing one.
    const annotated =
      'const f = { boundary: p.parcelBoundary as { type: "Polygon" | "MultiPolygon"; coordinates: number[][][] } };';
    expect(boundaryInitializers(annotated, "fixture.tsx")).toEqual([]);

    // A comparison names it too.
    const compared = 'if (boundary.type === "Polygon") { render(boundary); }';
    expect(boundaryInitializers(compared, "fixture.tsx")).toEqual([]);
  });
});
