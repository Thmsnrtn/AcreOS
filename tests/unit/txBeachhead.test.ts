/**
 * D2a — Texas: no beachhead county is verified, so every TX build refuses,
 * with the reason, before any page is read. Never faked from another layer.
 *
 * SYNTHETIC: the hand-built TX spec below points at an invalid host; it exists
 * only to prove the refusal does not depend on going through buildSpecFor.
 */
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { stripComments } from "../helpers/stripComments";

vi.mock("../../server/db", () => ({ db: {} }));
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { buildCounty, buildSpecFor, streamCounty, type LayerDeps, type StatewideBuildSpec } from "../../server/services/landData/statewideCadastral";
import { STATEWIDE_PARCEL_ENDPOINTS } from "../../server/services/statewideParcelEndpoints";

const REASON = /no verified beachhead county — the TX beachhead list is empty because no TX county source has been verified live with its terms read/;
const SRC = path.join(__dirname, "../../server/services/landData/statewideCadastral.ts");
const TX_SPEC: StatewideBuildSpec = {
  state: "TX",
  job: "tx_statewide_cadastral_v1",
  layerUrl: "https://example.invalid/arcgis/rest/services/SYNTHETIC/FeatureServer/0",
  attribution: "SYNTHETIC",
  mapping: { apn: "SYN_ID" },
};
// Real county names — the refusal must hold for the counties a beachhead would pick.
const TX_COUNTIES = ["Harris", "Travis", "Bexar", "Dallas", "Tarrant", "Hays", "Williamson", "Bastrop"];

const recordingDeps = () => {
  const urls: string[] = [];
  const deps: LayerDeps = {
    async getJson(url) {
      urls.push(url);
      return { ok: true, status: 200, body: { fields: [{ name: "SYN_ID", type: "esriFieldTypeString" }], objectIdField: "OBJECTID" } };
    },
  };
  return { urls, deps };
};

describe("TX beachhead: empty, with a reason, and every TX build refuses", () => {
  it("the beachhead list in source is EMPTY (parsed with comments stripped)", () => {
    const code = stripComments(readFileSync(SRC, "utf8"));
    const m = Array.from(code.matchAll(/const TX_BEACHHEAD_COUNTIES\s*:\s*readonly string\[\]\s*=\s*\[([^\]]*)\]/g));
    expect(m.length, "vacuity: the declaration was found exactly once").toBe(1);
    expect(m[0][1].trim()).toBe("");
  });

  it("TX has no seeded statewide row (a beachhead would not be faked from one)", () => {
    expect(STATEWIDE_PARCEL_ENDPOINTS.some((e) => e.state === "TX")).toBe(false);
  });

  it("buildSpecFor('TX') refuses with the beachhead reason, in any case", () => {
    expect(() => buildSpecFor("TX")).toThrow(REASON);
    expect(() => buildSpecFor("tx")).toThrow(REASON);
  });

  it("a hand-built TX spec is refused for every county before any request is made", async () => {
    for (const county of TX_COUNTIES) {
      const { urls, deps } = recordingDeps();
      await expect(streamCounty(TX_SPEC, { countyField: "CNTY", countyValue: county }, deps, async () => {})).rejects.toThrow(REASON);
      expect(urls, county).toEqual([]);
    }
  });

  it("buildCounty for TX refuses and leaves no artifact behind", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "tx-refuse-"));
    const { urls, deps } = recordingDeps();
    await expect(buildCounty(TX_SPEC, { countyField: "CNTY", countyValue: "Travis" }, { ...deps, outDir: dir, bucketConfigured: true, today: "2026-10-24" })).rejects.toThrow(REASON);
    expect(urls).toEqual([]);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("the guard is TX-only: a seeded wave-1 state still builds a spec", () => {
    expect(buildSpecFor("NC").state).toBe("NC");
  });
});
