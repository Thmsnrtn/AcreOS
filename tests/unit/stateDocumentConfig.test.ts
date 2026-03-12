/**
 * T279 — State Document Configuration Tests
 * Tests state-specific deed types, recording fee estimates, and transfer tax lookup.
 */

import { describe, it, expect } from "vitest";

// ─── Inline pure logic ────────────────────────────────────────────────────────

type DeedType =
  | "general_warranty_deed"
  | "special_warranty_deed"
  | "limited_warranty_deed"
  | "quitclaim_deed"
  | "grant_deed"
  | "bargain_and_sale_deed"
  | "warranty_deed_with_vendor_lien";

type LandContractName =
  | "land_contract"
  | "land_sale_contract"
  | "contract_for_deed"
  | "installment_sale_agreement"
  | "agreement_for_deed"
  | "bond_for_deed";

interface StateDocumentConfig {
  state: string;
  stateName: string;
  primaryDeedType: DeedType;
  alternativeDeedTypes: DeedType[];
  lienInstrument: "deed_of_trust" | "mortgage" | "security_deed";
  landContractName: LandContractName;
  notaryRequired: boolean;
  witnessCount: number;
  recordingFeeBase: number;
  recordingFeePerPage: number;
  transferTaxPercent: number;
  attorneyStateForClosing: boolean;
}

const STATE_DOCUMENT_CONFIGS: Record<string, StateDocumentConfig> = {
  TX: {
    state: "TX", stateName: "Texas",
    primaryDeedType: "general_warranty_deed",
    alternativeDeedTypes: ["special_warranty_deed", "quitclaim_deed"],
    lienInstrument: "deed_of_trust",
    landContractName: "contract_for_deed",
    notaryRequired: true, witnessCount: 0,
    recordingFeeBase: 25, recordingFeePerPage: 4,
    transferTaxPercent: 0,
    attorneyStateForClosing: false,
  },
  WA: {
    state: "WA", stateName: "Washington",
    primaryDeedType: "general_warranty_deed",
    alternativeDeedTypes: ["special_warranty_deed", "bargain_and_sale_deed", "quitclaim_deed"],
    lienInstrument: "deed_of_trust",
    landContractName: "contract_for_deed",
    notaryRequired: true, witnessCount: 0,
    recordingFeeBase: 203.50, recordingFeePerPage: 1,
    transferTaxPercent: 1.1,
    attorneyStateForClosing: false,
  },
  GA: {
    state: "GA", stateName: "Georgia",
    primaryDeedType: "general_warranty_deed",
    alternativeDeedTypes: ["quitclaim_deed"],
    lienInstrument: "security_deed",
    landContractName: "installment_sale_agreement",
    notaryRequired: true, witnessCount: 2,
    recordingFeeBase: 10, recordingFeePerPage: 5,
    transferTaxPercent: 0.1,
    attorneyStateForClosing: true,
  },
};

function getStateConfig(stateAbbr: string): StateDocumentConfig | null {
  return STATE_DOCUMENT_CONFIGS[stateAbbr.toUpperCase()] || null;
}

function getDeedTypeLabel(deedType: DeedType): string {
  const labels: Record<DeedType, string> = {
    general_warranty_deed: "General Warranty Deed",
    special_warranty_deed: "Special Warranty Deed",
    limited_warranty_deed: "Limited Warranty Deed",
    quitclaim_deed: "Quitclaim Deed",
    grant_deed: "Grant Deed",
    bargain_and_sale_deed: "Bargain and Sale Deed",
    warranty_deed_with_vendor_lien: "Warranty Deed with Vendor's Lien",
  };
  return labels[deedType] || deedType;
}

function getLandContractLabel(name: LandContractName): string {
  const labels: Record<LandContractName, string> = {
    land_contract: "Land Contract",
    land_sale_contract: "Land Sale Contract",
    contract_for_deed: "Contract for Deed",
    installment_sale_agreement: "Installment Sale Agreement",
    agreement_for_deed: "Agreement for Deed",
    bond_for_deed: "Bond for Deed",
  };
  return labels[name] || name;
}

function getRecordingEstimate(state: string, pageCount: number = 4): number {
  const config = getStateConfig(state);
  if (!config) return 50;
  return config.recordingFeeBase + config.recordingFeePerPage * pageCount;
}

function getTransferTaxAmount(state: string, salePrice: number): number {
  const config = getStateConfig(state);
  if (!config) return 0;
  return salePrice * (config.transferTaxPercent / 100);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

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

  it("returns GA config with 2 witnesses required", () => {
    const config = getStateConfig("GA");
    expect(config!.witnessCount).toBe(2);
    expect(config!.attorneyStateForClosing).toBe(true);
  });

  it("TX has no transfer tax", () => {
    expect(getStateConfig("TX")!.transferTaxPercent).toBe(0);
  });

  it("WA has significant transfer tax", () => {
    expect(getStateConfig("WA")!.transferTaxPercent).toBeGreaterThan(0);
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

describe("getTransferTaxAmount", () => {
  it("returns 0 for TX (no transfer tax)", () => {
    expect(getTransferTaxAmount("TX", 100_000)).toBe(0);
  });

  it("calculates WA transfer tax at 1.1%", () => {
    // 1.1% of $500k = $5,500
    expect(getTransferTaxAmount("WA", 500_000)).toBeCloseTo(5500, 0);
  });

  it("calculates GA transfer tax at 0.1%", () => {
    // 0.1% of $200k = $200
    expect(getTransferTaxAmount("GA", 200_000)).toBe(200);
  });

  it("returns 0 for unknown state", () => {
    expect(getTransferTaxAmount("ZZ", 100_000)).toBe(0);
  });
});
