/**
 * State document config — against the PRODUCTION module.
 *
 * This file used to re-implement stateDocumentConfig inline (table included),
 * so it pinned whatever the copy said — including the transfer-tax percents
 * that were 10× low (best-in-class audit 2026-10-20). Transfer tax has moved
 * to the canonical, statute-checked table (transferTaxFromStatute.test.ts).
 */

import { describe, it, expect } from "vitest";
import {
  getStateConfig,
  getDeedTypeLabel,
  getLandContractLabel,
  getRecordingEstimate,
  type DeedType,
} from "../../server/services/stateDocumentConfig";

describe("getStateConfig", () => {
  it("returns TX config", () => {
    const config = getStateConfig("TX");
    expect(config).not.toBeNull();
    expect(config!.stateName).toBe("Texas");
    expect(config!.primaryDeedType).toBe("general_warranty_deed");
    expect(config!.lienInstrument).toBe("deed_of_trust");
  });

  it("is case-insensitive", () => {
    expect(getStateConfig("tx")).toEqual(getStateConfig("TX"));
  });

  it("returns null for unknown state", () => {
    expect(getStateConfig("ZZ")).toBeNull();
  });

  it("returns GA config: one unofficial witness plus the notary (O.C.G.A. § 44-2-15)", () => {
    // The old inline copy said 2 and agreed with itself; production records
    // the unofficial witness separately from notaryRequired.
    const config = getStateConfig("GA");
    expect(config!.witnessCount).toBe(1);
    expect(config!.notaryRequired).toBe(true);
    expect(config!.attorneyStateForClosing).toBe(true);
  });

  it("holds no transfer-tax figure — that lives only in shared/regulatory/transferTax.ts", () => {
    for (const st of ["TX", "WA", "FL", "NV", "GA"]) {
      const c = getStateConfig(st) as unknown as Record<string, unknown>;
      expect(Object.keys(c).filter((k) => /transferTax/i.test(k))).toEqual([]);
    }
  });
});

describe("getDeedTypeLabel", () => {
  it("returns human-readable label for general_warranty_deed", () => {
    expect(getDeedTypeLabel("general_warranty_deed")).toBe("General Warranty Deed");
  });

  it("returns human-readable label for quitclaim_deed", () => {
    expect(getDeedTypeLabel("quitclaim_deed")).toBe("Quitclaim Deed");
  });

  it("returns human-readable label for grant_deed", () => {
    expect(getDeedTypeLabel("grant_deed")).toBe("Grant Deed");
  });

  it("returns the key itself for unknown deed type", () => {
    expect(getDeedTypeLabel("unknown_deed" as DeedType)).toBe("unknown_deed");
  });
});

describe("getLandContractLabel", () => {
  it("returns Contract for Deed label", () => {
    expect(getLandContractLabel("contract_for_deed")).toBe("Contract for Deed");
  });

  it("returns Agreement for Deed label", () => {
    expect(getLandContractLabel("agreement_for_deed")).toBe("Agreement for Deed");
  });

  it("returns Bond for Deed label", () => {
    expect(getLandContractLabel("bond_for_deed")).toBe("Bond for Deed");
  });
});

describe("getRecordingEstimate", () => {
  it("estimates TX recording fee for 4-page deed", () => {
    // TX: base $25 + $4/page × 4 = $41
    expect(getRecordingEstimate("TX", 4)).toBe(41);
  });

  it("estimates WA recording fee (higher base)", () => {
    // WA: base $203.50 + $1/page × 4 = $207.50
    expect(getRecordingEstimate("WA", 4)).toBe(207.50);
  });

  it("uses default 4 pages when not specified", () => {
    expect(getRecordingEstimate("TX")).toBe(getRecordingEstimate("TX", 4));
  });

  it("returns $50 fallback for unknown state", () => {
    expect(getRecordingEstimate("ZZ", 4)).toBe(50);
  });
});
