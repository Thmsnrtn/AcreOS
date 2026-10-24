/**
 * D2d — the golden registry's ABSENCES are explicit. Every wave-1 state without
 * an established golden county has no ground truth, so no remap of its layer
 * can ever auto-promote — however perfect the proposal — and verification
 * makes zero live reads trying.
 *
 * No real assessor data exists for these states in this repo, and none is
 * invented here: establishing one is a human procedure
 * (docs/land-data/golden-county-procedure.md). When a state IS established,
 * move it from NO_GROUND_TRUTH to HAS_GROUND_TRUTH in the same commit.
 *
 * Population: the statewide build states are read from the handler source
 * (STATEWIDE_BUILD_STATES in server/services/etlHandlers.ts). Adding a build
 * state without deciding which list it belongs to fails here.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../server/db", () => ({ db: {} }));
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { healDrift } from "../../server/services/openData/adapterRemap";
import { SchemaDriftError, buildSpecFor, type LayerDeps, type StatewideBuildSpec } from "../../server/services/landData/statewideCadastral";
import { goldenCountyFor, verifiedParcels } from "../../shared/landData/goldenCounty";
import { stripComments } from "../helpers/stripComments";

const HAS_GROUND_TRUTH = ["FL"] as const;
const NO_GROUND_TRUTH = ["NC", "WI", "AR", "MT", "IN", "OH"] as const;
const NOW = new Date("2026-10-24T12:00:00Z");

const ALL_STATES =
  "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(" ");

/** The seeded spec, or — for a state with no seeded layer (IN/OH today) — a SYNTHETIC one, labelled. */
function specFor(st: string): StatewideBuildSpec {
  try {
    return buildSpecFor(st);
  } catch {
    return { state: st, job: `${st.toLowerCase()}_statewide_cadastral_v1`, layerUrl: "https://example.invalid/SYNTHETIC/0", attribution: "SYNTHETIC — no seeded layer", mapping: { apn: "PARCEL_ID" } };
  }
}

describe("the golden registry (vacuity + explicit absences)", () => {
  it("of all 50 states + DC, exactly HAS_GROUND_TRUTH have five verified golden parcels", () => {
    expect(ALL_STATES).toHaveLength(51);
    expect(ALL_STATES.filter((s) => verifiedParcels(goldenCountyFor(s)).length > 0)).toEqual([...HAS_GROUND_TRUTH]);
    for (const s of HAS_GROUND_TRUTH) expect(verifiedParcels(goldenCountyFor(s))).toHaveLength(5);
  });

  it("population: every statewide build state is classified — has ground truth, or explicitly has none", () => {
    const src = stripComments(readFileSync(path.join(__dirname, "../../server/services/etlHandlers.ts"), "utf8"));
    const m = /STATEWIDE_BUILD_STATES\s*=\s*\[([^\]]*)\]/.exec(src);
    expect(m, "STATEWIDE_BUILD_STATES must be parseable").not.toBeNull();
    const built = Array.from((m as RegExpExecArray)[1].matchAll(/"([A-Z]{2})"/g), (x) => x[1]);
    expect(built).toContain("FL");
    expect(built.length).toBeGreaterThanOrEqual(5);
    const classified = new Set<string>([...HAS_GROUND_TRUTH, ...NO_GROUND_TRUTH]);
    expect(built.filter((s) => !classified.has(s))).toEqual([]);
  });
});

describe.each(NO_GROUND_TRUTH.map((s) => [s] as const))("%s — no ground truth, so no remap ever auto-promotes", (st) => {
  it("has no golden county", () => {
    expect(goldenCountyFor(st)).toBeNull();
    expect(verifiedParcels(goldenCountyFor(st))).toEqual([]);
  });

  it("a PERFECT proposal (the parcel-id field renamed only in case) is still rejected, with zero live reads", async () => {
    const spec = specFor(st);
    const apn = spec.mapping.apn as string;
    const renamed = apn === apn.toUpperCase() ? apn.toLowerCase() : apn.toUpperCase();
    const others = Object.values(spec.mapping).filter((f): f is string => !!f && f !== apn);
    const fields = [{ name: "OBJECTID", type: "esriFieldTypeOID", alias: null }, { name: renamed, type: "esriFieldTypeString", alias: null }, ...others.map((n) => ({ name: n, type: "esriFieldTypeString", alias: null }))];
    let reads = 0;
    const deps: LayerDeps = {
      async getJson() {
        reads += 1;
        return { ok: true, status: 200, body: { features: [] } };
      },
    };
    const a = await healDrift(spec, new SchemaDriftError(st, [apn], fields, spec.mapping), deps, NOW);
    expect(a.proposal.ok, "the proposal itself is clean").toBe(true);
    expect(a.proposal.ok && a.proposal.mapping.apn).toBe(renamed);
    expect(a.outcome).toBe("rejected");
    expect(a.mappingAfter).toBeNull();
    expect(a.verification?.why).toMatch(/no ground truth/);
    expect(a.verification?.goldenCounty).toBeNull();
    expect(reads).toBe(0);
  });
});
