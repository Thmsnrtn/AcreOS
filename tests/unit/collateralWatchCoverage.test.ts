/**
 * Collateral watch (W5a) — never imply coverage AcreOS does not have. A kind
 * is "watched" only where a source exists for that county; everything else
 * reads "Not watched: no source for <county>". And an unrecognised county tax
 * value never alerts and never reads as current.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { classifyTaxStatus, collateralCoverage } from "../../shared/trust/collateralWatch";
import { stripComments } from "../helpers/stripComments";

const SOURCES = [{ state: "TN", county: "Hamilton", name: "Hamilton County, gis.hamiltontn.gov" }];

describe("coverage", () => {
  it("a county with a mapped tax-status source is watched for tax delinquency only", () => {
    const c = collateralCoverage({ state: "tn", county: "Hamilton County" }, SOURCES);
    expect(c.map((x) => [x.kind, x.watched])).toEqual([
      ["tax_delinquency", true],
      ["liens", false],
      ["probate", false],
    ]);
    expect(c[0].text).toMatch(/Hamilton County, gis\.hamiltontn\.gov/);
    expect(c[1].text).toBe("Not watched: no source for Hamilton County, TN");
  });
  it("a county with no source is watched for nothing, and says so per kind", () => {
    const c = collateralCoverage({ state: "TX", county: "Travis" }, SOURCES);
    expect(c.map((x) => x.kind)).toEqual(["tax_delinquency", "liens", "probate"]);
    for (const x of c) {
      expect(x.watched).toBe(false);
      expect(x.text).toBe("Not watched: no source for Travis County, TX");
    }
  });
  it("same county name in another state is not coverage", () => {
    expect(collateralCoverage({ state: "IN", county: "Hamilton" }, SOURCES)[0].watched).toBe(false);
  });
});

describe("county tax-status values", () => {
  it("reads delinquency only from wording that says so", () => {
    for (const v of ["DELINQUENT", "Taxes Delinquent 2024", "Past Due", "Tax Sale", "UNPAID"]) expect(classifyTaxStatus(v), v).toBe("delinquent");
    for (const v of ["PAID", "Current", "good standing"]) expect(classifyTaxStatus(v), v).toBe("current");
    for (const v of ["", null, "Y", "N", "2024", "EXEMPT"]) expect(classifyTaxStatus(v as string), String(v)).toBe("unknown");
  });
});

describe("the watch reads only sources AcreOS already has", () => {
  it("the job reads the parcel through the provider registry, county-gis only", () => {
    const src = stripComments(fs.readFileSync(path.resolve(__dirname, "../../server/services/trust/collateralWatchService.ts"), "utf8"));
    expect(src).toMatch(/providerRegistry\.lookup\(\s*"parcel_data"/);
    expect(src).toMatch(/allowProviders:\s*\["county-gis"\]/);
    expect(src).not.toMatch(/\bfetch\(/);
  });
});
