/**
 * Regulatory Intelligence Unit Tests
 *
 * Tests regulatory intelligence logic:
 * - State requirement lookup
 * - Compliance score computation
 * - Alert generation
 * - Requirement matching to transactions
 */

import { describe, it, expect } from "vitest";

// ── Types mirroring RegulatoryIntelligence ────────────────────────────────────

type WaterRightsSystem = "prior_appropriation" | "riparian" | "hybrid";
type SellerFinancingRisk = "low" | "medium" | "high";
type SubdivisionRegulation = "strict" | "moderate" | "permissive";

interface StateRegulatoryProfile {
  code: string;
  name: string;
  titleInsuranceRequired: boolean;
  todDeedAvailable: boolean;
  contractForDeedAllowed: boolean;
  contractForDeedRestrictions?: string;
  sellerFinancingRisk: SellerFinancingRisk;
  doddFrankExemptions: string[];
  usuryCeiling?: number;
  waterRightsSystem: WaterRightsSystem;
  droughtRisk: "low" | "moderate" | "high" | "extreme";
  requiredDisclosures: string[];
  environmentalDisclosureRequired: boolean;
  agriculturalExemptionAvailable: boolean;
  transferTax?: string;
  subdivisionRegulations: SubdivisionRegulation;
  percolationTestRequired: boolean;
  practitionerNotes: string;
  lastReviewed: string;
  riskScore: number; // 1-10
}

interface TransactionContext {
  state: string;
  isSellerFinanced: boolean;
  isContractForDeed: boolean;
  hasEnvironmentalConcern: boolean;
  acreage: number;
  isSubdivision: boolean;
  hasSepticSystem: boolean;
}

interface ComplianceAlert {
  severity: "critical" | "warning" | "info";
  category: string;
  message: string;
  actionRequired: string;
}

interface ComplianceReport {
  state: string;
  score: number; // 0-100 (100 = fully compliant)
  alerts: ComplianceAlert[];
  requirements: string[];
  riskLevel: "low" | "medium" | "high";
}

// ── State data (subset matching real service) ─────────────────────────────────

const STATE_PROFILES: StateRegulatoryProfile[] = [
  {
    code: "TX",
    name: "Texas",
    titleInsuranceRequired: false,
    todDeedAvailable: true,
    contractForDeedAllowed: true,
    contractForDeedRestrictions: "Must record within 14 days; seller must provide annual statement",
    sellerFinancingRisk: "medium",
    doddFrankExemptions: ["natural_person_3_per_year", "inherited_property"],
    usuryCeiling: 18,
    waterRightsSystem: "prior_appropriation",
    droughtRisk: "high",
    requiredDisclosures: ["mold", "lead_paint", "easements", "deed_restrictions"],
    environmentalDisclosureRequired: true,
    agriculturalExemptionAvailable: true,
    transferTax: "none",
    subdivisionRegulations: "moderate",
    percolationTestRequired: false,
    practitionerNotes: "Buyer beware state. Seller's disclosure not mandatory for all properties.",
    lastReviewed: "2024-11-01",
    riskScore: 4,
  },
  {
    code: "FL",
    name: "Florida",
    titleInsuranceRequired: true,
    todDeedAvailable: false,
    contractForDeedAllowed: true,
    sellerFinancingRisk: "medium",
    doddFrankExemptions: ["natural_person_3_per_year"],
    usuryCeiling: 18,
    waterRightsSystem: "riparian",
    droughtRisk: "moderate",
    requiredDisclosures: ["material_defects", "HOA", "flood_zone", "lead_paint"],
    environmentalDisclosureRequired: true,
    agriculturalExemptionAvailable: true,
    transferTax: "0.70 per $100",
    subdivisionRegulations: "strict",
    percolationTestRequired: true,
    practitionerNotes: "Flood zone disclosure critical. Transfer tax applies to most deeds.",
    lastReviewed: "2024-10-15",
    riskScore: 6,
  },
  {
    code: "CA",
    name: "California",
    titleInsuranceRequired: true,
    todDeedAvailable: true,
    contractForDeedAllowed: false,
    sellerFinancingRisk: "high",
    doddFrankExemptions: ["natural_person_3_per_year"],
    usuryCeiling: 10,
    waterRightsSystem: "hybrid",
    droughtRisk: "extreme",
    requiredDisclosures: ["TDS", "NHD", "lead_paint", "HOA", "environmental_hazards", "retrofit"],
    environmentalDisclosureRequired: true,
    agriculturalExemptionAvailable: false,
    transferTax: "1.10 per $1000",
    subdivisionRegulations: "strict",
    percolationTestRequired: true,
    practitionerNotes: "Highest regulatory burden in the US. TDS and NHD disclosures mandatory.",
    lastReviewed: "2024-09-20",
    riskScore: 9,
  },
];

// ── Pure helpers ───────────────────────────────────────────────────────────────

function lookupStateProfile(stateCode: string): StateRegulatoryProfile | null {
  return STATE_PROFILES.find(p => p.code === stateCode.toUpperCase()) || null;
}

function generateAlerts(
  profile: StateRegulatoryProfile,
  transaction: TransactionContext
): ComplianceAlert[] {
  const alerts: ComplianceAlert[] = [];

  // Contract for deed
  if (transaction.isContractForDeed && !profile.contractForDeedAllowed) {
    alerts.push({
      severity: "critical",
      category: "contract_for_deed",
      message: `Contract for deed is NOT allowed in ${profile.name}`,
      actionRequired: "Use alternative financing structure (seller carryback, lease-option)",
    });
  }

  if (transaction.isContractForDeed && profile.contractForDeedAllowed && profile.contractForDeedRestrictions) {
    alerts.push({
      severity: "warning",
      category: "contract_for_deed",
      message: `Contract for deed restrictions apply in ${profile.name}`,
      actionRequired: profile.contractForDeedRestrictions,
    });
  }

  // Seller financing risk
  if (transaction.isSellerFinanced && profile.sellerFinancingRisk === "high") {
    alerts.push({
      severity: "warning",
      category: "seller_financing",
      message: `High seller financing regulatory risk in ${profile.name}`,
      actionRequired: "Consult local RMLO for Dodd-Frank compliance",
    });
  }

  // Environmental disclosure
  if (transaction.hasEnvironmentalConcern && profile.environmentalDisclosureRequired) {
    alerts.push({
      severity: "critical",
      category: "environmental",
      message: `Environmental disclosure required in ${profile.name}`,
      actionRequired: "Complete environmental disclosure form before closing",
    });
  }

  // Percolation test
  if (transaction.hasSepticSystem && profile.percolationTestRequired) {
    alerts.push({
      severity: "warning",
      category: "septic",
      message: `Percolation test required for septic system in ${profile.name}`,
      actionRequired: "Order perc test before contract execution",
    });
  }

  // Subdivision regulations
  if (transaction.isSubdivision && profile.subdivisionRegulations === "strict") {
    alerts.push({
      severity: "warning",
      category: "subdivision",
      message: `Strict subdivision regulations apply in ${profile.name}`,
      actionRequired: "Verify platting and subdivision approval requirements",
    });
  }

  // Drought risk for water rights
  if (profile.droughtRisk === "extreme" && transaction.acreage > 50) {
    alerts.push({
      severity: "info",
      category: "water_rights",
      message: `Extreme drought risk in ${profile.name} — water rights due diligence critical`,
      actionRequired: "Review water rights documentation and delivery reliability",
    });
  }

  return alerts;
}

function computeComplianceScore(alerts: ComplianceAlert[]): number {
  let score = 100;
  for (const alert of alerts) {
    if (alert.severity === "critical") score -= 30;
    else if (alert.severity === "warning") score -= 10;
    else if (alert.severity === "info") score -= 2;
  }
  return Math.max(0, score);
}

function generateComplianceReport(
  profile: StateRegulatoryProfile,
  transaction: TransactionContext
): ComplianceReport {
  const alerts = generateAlerts(profile, transaction);
  const score = computeComplianceScore(alerts);

  const requirements: string[] = [...profile.requiredDisclosures];
  if (profile.titleInsuranceRequired) requirements.push("title_insurance");
  if (profile.percolationTestRequired && transaction.hasSepticSystem) requirements.push("percolation_test");

  const riskLevel: ComplianceReport["riskLevel"] =
    score < 50 ? "high" : score < 80 ? "medium" : "low";

  return {
    state: profile.code,
    score,
    alerts,
    requirements,
    riskLevel,
  };
}

function matchDoddFrankExemption(
  profile: StateRegulatoryProfile,
  transactionsThisYear: number,
  isInheritedProperty: boolean
): { exempt: boolean; exemptionReason?: string } {
  if (isInheritedProperty && profile.doddFrankExemptions.includes("inherited_property")) {
    return { exempt: true, exemptionReason: "inherited_property" };
  }
  if (
    transactionsThisYear <= 3 &&
    profile.doddFrankExemptions.includes("natural_person_3_per_year")
  ) {
    return { exempt: true, exemptionReason: "natural_person_3_per_year" };
  }
  return { exempt: false };
}

function getDisclosureDueDiligenceChecklist(profile: StateRegulatoryProfile): string[] {
  const checklist = [...profile.requiredDisclosures.map(d => `Prepare ${d} disclosure form`)];
  if (profile.titleInsuranceRequired) checklist.push("Order title insurance commitment");
  if (profile.environmentalDisclosureRequired) checklist.push("Complete environmental disclosure questionnaire");
  if (profile.percolationTestRequired) checklist.push("Schedule percolation test");
  if (!profile.todDeedAvailable) checklist.push("Note: Transfer-on-death deed NOT available in this state");
  return checklist;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("State Requirement Lookup", () => {
  it("returns Texas profile by state code", () => {
    const profile = lookupStateProfile("TX");
    expect(profile).not.toBeNull();
    expect(profile?.name).toBe("Texas");
    expect(profile?.code).toBe("TX");
  });

  it("returns Florida profile", () => {
    const profile = lookupStateProfile("FL");
    expect(profile).not.toBeNull();
    expect(profile?.titleInsuranceRequired).toBe(true);
    expect(profile?.percolationTestRequired).toBe(true);
  });

  it("returns California profile with high risk score", () => {
    const profile = lookupStateProfile("CA");
    expect(profile?.riskScore).toBeGreaterThanOrEqual(8);
  });

  it("is case-insensitive for state code lookup", () => {
    expect(lookupStateProfile("tx")).not.toBeNull();
    expect(lookupStateProfile("Fl")).not.toBeNull();
  });

  it("returns null for unknown state code", () => {
    expect(lookupStateProfile("XX")).toBeNull();
    expect(lookupStateProfile("ZZ")).toBeNull();
  });

  it("Texas has no transfer tax", () => {
    const profile = lookupStateProfile("TX");
    expect(profile?.transferTax).toBe("none");
  });

  it("Florida requires title insurance", () => {
    const profile = lookupStateProfile("FL");
    expect(profile?.titleInsuranceRequired).toBe(true);
  });
});

describe("Compliance Score Computation", () => {
  it("returns 100 for zero alerts", () => {
    expect(computeComplianceScore([])).toBe(100);
  });

  it("deducts 30 points per critical alert", () => {
    const alerts: ComplianceAlert[] = [
      { severity: "critical", category: "test", message: "A", actionRequired: "B" },
      { severity: "critical", category: "test", message: "C", actionRequired: "D" },
    ];
    expect(computeComplianceScore(alerts)).toBe(40);
  });

  it("deducts 10 points per warning alert", () => {
    const alerts: ComplianceAlert[] = [
      { severity: "warning", category: "test", message: "A", actionRequired: "B" },
      { severity: "warning", category: "test", message: "C", actionRequired: "D" },
    ];
    expect(computeComplianceScore(alerts)).toBe(80);
  });

  it("deducts 2 points per info alert", () => {
    const alerts: ComplianceAlert[] = [
      { severity: "info", category: "test", message: "A", actionRequired: "B" },
    ];
    expect(computeComplianceScore(alerts)).toBe(98);
  });

  it("never drops below 0", () => {
    const alerts: ComplianceAlert[] = Array(10).fill({
      severity: "critical" as const, category: "test", message: "A", actionRequired: "B",
    });
    expect(computeComplianceScore(alerts)).toBeGreaterThanOrEqual(0);
  });

  it("critical alerts reduce score more than warnings per alert", () => {
    // 1 critical = -30, 2 warnings = -20 → critical score (70) < 2-warning score (80)
    const critical: ComplianceAlert[] = [{ severity: "critical", category: "x", message: "x", actionRequired: "x" }];
    const twoWarnings: ComplianceAlert[] = [
      { severity: "warning", category: "x", message: "x", actionRequired: "x" },
      { severity: "warning", category: "x", message: "x", actionRequired: "x" },
    ];
    expect(computeComplianceScore(critical)).toBeLessThan(computeComplianceScore(twoWarnings));
  });
});

describe("Alert Generation", () => {
  const cleanTx: TransactionContext = {
    state: "TX",
    isSellerFinanced: false,
    isContractForDeed: false,
    hasEnvironmentalConcern: false,
    acreage: 50,
    isSubdivision: false,
    hasSepticSystem: false,
  };

  it("generates no alerts for clean Texas transaction", () => {
    const profile = lookupStateProfile("TX")!;
    const alerts = generateAlerts(profile, cleanTx);
    expect(alerts).toHaveLength(0);
  });

  it("generates critical alert for contract-for-deed in CA (not allowed)", () => {
    const profile = lookupStateProfile("CA")!;
    const txn = { ...cleanTx, isContractForDeed: true };
    const alerts = generateAlerts(profile, txn);
    const critical = alerts.filter(a => a.severity === "critical" && a.category === "contract_for_deed");
    expect(critical).toHaveLength(1);
  });

  it("generates warning for contract-for-deed in TX (allowed with restrictions)", () => {
    const profile = lookupStateProfile("TX")!;
    const txn = { ...cleanTx, isContractForDeed: true };
    const alerts = generateAlerts(profile, txn);
    const warning = alerts.filter(a => a.severity === "warning" && a.category === "contract_for_deed");
    expect(warning).toHaveLength(1);
    expect(warning[0].actionRequired).toContain("14 days");
  });

  it("generates critical for environmental concern requiring disclosure", () => {
    const profile = lookupStateProfile("FL")!;
    const txn = { ...cleanTx, hasEnvironmentalConcern: true };
    const alerts = generateAlerts(profile, txn);
    const envAlert = alerts.find(a => a.category === "environmental");
    expect(envAlert?.severity).toBe("critical");
  });

  it("generates warning for perc test in FL with septic system", () => {
    const profile = lookupStateProfile("FL")!;
    const txn = { ...cleanTx, hasSepticSystem: true };
    const alerts = generateAlerts(profile, txn);
    const percAlert = alerts.find(a => a.category === "septic");
    expect(percAlert?.severity).toBe("warning");
  });

  it("generates info for extreme drought risk on large acreage", () => {
    const profile = lookupStateProfile("CA")!;
    const txn = { ...cleanTx, acreage: 100 };
    const alerts = generateAlerts(profile, txn);
    const waterAlert = alerts.find(a => a.category === "water_rights");
    expect(waterAlert?.severity).toBe("info");
  });

  it("does not generate drought alert for small acreage (<= 50 acres)", () => {
    const profile = lookupStateProfile("CA")!;
    const txn = { ...cleanTx, acreage: 40 };
    const alerts = generateAlerts(profile, txn);
    const waterAlert = alerts.find(a => a.category === "water_rights");
    expect(waterAlert).toBeUndefined();
  });
});

describe("Requirement Matching to Transactions", () => {
  it("generates checklist items for all required disclosures", () => {
    const profile = lookupStateProfile("TX")!;
    const checklist = getDisclosureDueDiligenceChecklist(profile);
    // TX requires: mold, lead_paint, easements, deed_restrictions
    expect(checklist.some(item => item.includes("mold"))).toBe(true);
    expect(checklist.some(item => item.includes("lead_paint"))).toBe(true);
  });

  it("adds title insurance to checklist when required", () => {
    const profile = lookupStateProfile("FL")!;
    const checklist = getDisclosureDueDiligenceChecklist(profile);
    expect(checklist.some(item => item.includes("title insurance"))).toBe(true);
  });

  it("adds perc test to checklist when required", () => {
    const profile = lookupStateProfile("CA")!;
    const checklist = getDisclosureDueDiligenceChecklist(profile);
    expect(checklist.some(item => item.includes("percolation test"))).toBe(true);
  });

  it("notes when TOD deed is not available", () => {
    const profile = lookupStateProfile("FL")!; // FL has todDeedAvailable: false
    const checklist = getDisclosureDueDiligenceChecklist(profile);
    expect(checklist.some(item => item.toLowerCase().includes("not available"))).toBe(true);
  });

  it("does not note TOD unavailability when it IS available", () => {
    const profile = lookupStateProfile("TX")!; // TX has todDeedAvailable: true
    const checklist = getDisclosureDueDiligenceChecklist(profile);
    expect(checklist.some(item => item.includes("NOT available"))).toBe(false);
  });
});

describe("Dodd-Frank Exemption Matching", () => {
  const txProfile = lookupStateProfile("TX")!;

  it("exempts under natural person 3/year rule for 1st transaction", () => {
    const result = matchDoddFrankExemption(txProfile, 1, false);
    expect(result.exempt).toBe(true);
    expect(result.exemptionReason).toBe("natural_person_3_per_year");
  });

  it("exempts for inherited property in Texas", () => {
    const result = matchDoddFrankExemption(txProfile, 5, true);
    expect(result.exempt).toBe(true);
    expect(result.exemptionReason).toBe("inherited_property");
  });

  it("not exempt on 4th transaction for natural person (exceeds 3/year)", () => {
    const result = matchDoddFrankExemption(txProfile, 4, false);
    expect(result.exempt).toBe(false);
  });

  it("not exempt in CA for inherited property (not in CA exemptions)", () => {
    const caProfile = lookupStateProfile("CA")!;
    const result = matchDoddFrankExemption(caProfile, 5, true);
    expect(result.exempt).toBe(false);
  });

  it("exempts on exactly 3rd transaction", () => {
    const result = matchDoddFrankExemption(txProfile, 3, false);
    expect(result.exempt).toBe(true);
  });
});

describe("Full Compliance Report Generation", () => {
  it("generates low risk report for clean TX transaction", () => {
    const profile = lookupStateProfile("TX")!;
    const txn: TransactionContext = {
      state: "TX",
      isSellerFinanced: false,
      isContractForDeed: false,
      hasEnvironmentalConcern: false,
      acreage: 50,
      isSubdivision: false,
      hasSepticSystem: false,
    };
    const report = generateComplianceReport(profile, txn);
    expect(report.score).toBe(100);
    expect(report.riskLevel).toBe("low");
    expect(report.alerts).toHaveLength(0);
  });

  it("generates high risk report for complex CA transaction", () => {
    const profile = lookupStateProfile("CA")!;
    const txn: TransactionContext = {
      state: "CA",
      isSellerFinanced: true,
      isContractForDeed: true, // not allowed in CA
      hasEnvironmentalConcern: true,
      acreage: 200,
      isSubdivision: true,
      hasSepticSystem: true,
    };
    const report = generateComplianceReport(profile, txn);
    expect(report.score).toBeLessThan(50);
    expect(report.riskLevel).toBe("high");
    expect(report.alerts.length).toBeGreaterThan(2);
  });

  it("includes all required disclosures in requirements list", () => {
    const profile = lookupStateProfile("FL")!;
    const txn: TransactionContext = {
      state: "FL",
      isSellerFinanced: false,
      isContractForDeed: false,
      hasEnvironmentalConcern: false,
      acreage: 50,
      isSubdivision: false,
      hasSepticSystem: false,
    };
    const report = generateComplianceReport(profile, txn);
    // FL requires: material_defects, HOA, flood_zone, lead_paint
    expect(report.requirements.some(r => r.includes("flood_zone"))).toBe(true);
    expect(report.requirements.some(r => r.includes("title_insurance"))).toBe(true);
  });

  it("score correlates inversely with number of critical alerts", () => {
    const profile = lookupStateProfile("CA")!;
    const clean: TransactionContext = { state: "CA", isSellerFinanced: false, isContractForDeed: false, hasEnvironmentalConcern: false, acreage: 10, isSubdivision: false, hasSepticSystem: false };
    const complex: TransactionContext = { ...clean, isContractForDeed: true, hasEnvironmentalConcern: true };
    const cleanReport = generateComplianceReport(profile, clean);
    const complexReport = generateComplianceReport(profile, complex);
    expect(cleanReport.score).toBeGreaterThan(complexReport.score);
  });
});
