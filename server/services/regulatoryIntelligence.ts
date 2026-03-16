/**
 * T101 — Regulatory Intelligence Service
 *
 * Monitors and summarizes state/county-level regulatory requirements
 * affecting land investment:
 *   - Disclosure requirements (seller, environmental, zoning)
 *   - Transfer-on-death deed availability by state
 *   - Seller financing / Dodd-Frank compliance flags
 *   - Water rights / riparian doctrine by state
 *   - Timber/mineral rights practices
 *   - County recording fee schedules
 *   - Subdivision regulations
 *   - Agricultural exemptions
 *   - Contract-for-deed restrictions
 *
 * Data is curated expert knowledge + optional AI enrichment.
 *
 * Exposed via:
 *   GET /api/regulatory/states                 — all state profiles
 *   GET /api/regulatory/states/:code           — one state
 *   GET /api/regulatory/alerts                 — active regulatory alerts
 *   GET /api/regulatory/checklist/:state       — due diligence checklist
 *   POST /api/regulatory/analyze               — AI analysis for a deal
 */

export type WaterRightsSystem = "prior_appropriation" | "riparian" | "hybrid";
export type SellerFinancingRisk = "low" | "medium" | "high";

export interface StateRegulatoryProfile {
  code: string; // e.g. "TX"
  name: string;
  // Core transaction requirements
  titleInsuranceRequired: boolean;
  deedTypes: string[]; // "warranty", "quitclaim", "special_warranty", "tod"
  todDeedAvailable: boolean; // Transfer-on-Deed available
  contractForDeedAllowed: boolean;
  contractForDeedRestrictions?: string;
  // Seller financing
  sellerFinancingRisk: SellerFinancingRisk;
  doddFrankExemptions: string[];
  usuryCeiling?: number; // max interest rate %, null = no ceiling
  // Water
  waterRightsSystem: WaterRightsSystem;
  droughtRisk: "low" | "moderate" | "high" | "extreme";
  // Disclosures
  requiredDisclosures: string[];
  environmentalDisclosureRequired: boolean;
  // Taxes
  propertyTaxRate?: string; // "0.5%-1.5%"
  agriculturalExemptionAvailable: boolean;
  transferTax?: string;
  // Land specific
  subdivisionRegulations: "strict" | "moderate" | "permissive";
  percolationTestRequired: boolean;
  // Notes
  practitionerNotes: string;
  lastReviewed: string; // ISO date
  riskScore: number; // 1-10 (10 = most complex/risky)
}

// Curated database of state regulatory profiles
const STATE_PROFILES: StateRegulatoryProfile[] = [
  {
    code: "TX",
    name: "Texas",
    titleInsuranceRequired: false,
    deedTypes: ["warranty", "special_warranty", "quitclaim"],
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
    propertyTaxRate: "1.6%-2.5%",
    agriculturalExemptionAvailable: true,
    transferTax: "none",
    subdivisionRegulations: "moderate",
    percolationTestRequired: false,
    practitionerNotes: "Texas is favorable for land investors. No state income tax. Ag exemption can dramatically reduce property taxes. Water rights are critical — always check Edwards Aquifer rules in Central TX.",
    lastReviewed: "2026-01-01",
    riskScore: 4,
  },
  {
    code: "FL",
    name: "Florida",
    titleInsuranceRequired: false,
    deedTypes: ["warranty", "special_warranty", "quitclaim"],
    todDeedAvailable: false,
    contractForDeedAllowed: true,
    contractForDeedRestrictions: "Installment Land Contract Act applies; buyer has right to cure default",
    sellerFinancingRisk: "medium",
    doddFrankExemptions: ["natural_person_3_per_year"],
    usuryCeiling: 18,
    waterRightsSystem: "hybrid",
    droughtRisk: "moderate",
    requiredDisclosures: ["sinkholes", "flood_zone", "environmental_contamination", "lead_paint"],
    environmentalDisclosureRequired: true,
    propertyTaxRate: "0.8%-1.5%",
    agriculturalExemptionAvailable: true,
    transferTax: "0.35% documentary stamp",
    subdivisionRegulations: "strict",
    percolationTestRequired: true,
    practitionerNotes: "Sinkhole disclosure is critical in Central FL. Wetland regulations are strict — always check SFWMD permits. Homestead exemption protects primary residence but not investment land. No state income tax.",
    lastReviewed: "2026-01-01",
    riskScore: 6,
  },
  {
    code: "GA",
    name: "Georgia",
    titleInsuranceRequired: false,
    deedTypes: ["warranty", "limited_warranty", "quitclaim", "security_deed"],
    todDeedAvailable: true,
    contractForDeedAllowed: true,
    contractForDeedRestrictions: "Must use specific statutory form; immediate title transfer on default",
    sellerFinancingRisk: "low",
    doddFrankExemptions: ["natural_person_3_per_year", "owner_occupant"],
    usuryCeiling: 16,
    waterRightsSystem: "riparian",
    droughtRisk: "low",
    requiredDisclosures: ["lead_paint", "material_defects"],
    environmentalDisclosureRequired: false,
    propertyTaxRate: "0.7%-1.2%",
    agriculturalExemptionAvailable: true,
    transferTax: "$1 per $1,000 of value",
    subdivisionRegulations: "moderate",
    percolationTestRequired: false,
    practitionerNotes: "Georgia uses Security Deeds (not mortgages) — important distinction. Non-judicial foreclosure is straightforward. Good land market in North GA mountains and South GA farmland.",
    lastReviewed: "2026-01-01",
    riskScore: 3,
  },
  {
    code: "NC",
    name: "North Carolina",
    titleInsuranceRequired: false,
    deedTypes: ["general_warranty", "special_warranty", "quitclaim"],
    todDeedAvailable: false,
    contractForDeedAllowed: true,
    contractForDeedRestrictions: "Installment land contract; buyer builds equity immediately",
    sellerFinancingRisk: "medium",
    doddFrankExemptions: ["natural_person_3_per_year"],
    usuryCeiling: 16,
    waterRightsSystem: "riparian",
    droughtRisk: "low",
    requiredDisclosures: ["residential_property_disclosure", "lead_paint", "mineral_rights", "flood_hazard"],
    environmentalDisclosureRequired: true,
    propertyTaxRate: "0.6%-1.0%",
    agriculturalExemptionAvailable: true,
    transferTax: "$2 per $1,000 — county may add $0.40",
    subdivisionRegulations: "moderate",
    percolationTestRequired: true,
    practitionerNotes: "Attorneys must close real estate in NC. Mountain land has strict subdivision rules. The Highlands/Cashiers area commands premium prices. Coastal land requires CAMA permits.",
    lastReviewed: "2026-01-01",
    riskScore: 5,
  },
  {
    code: "TN",
    name: "Tennessee",
    titleInsuranceRequired: false,
    deedTypes: ["warranty", "quitclaim"],
    todDeedAvailable: true,
    contractForDeedAllowed: true,
    sellerFinancingRisk: "low",
    doddFrankExemptions: ["natural_person_3_per_year", "owner_occupant"],
    usuryCeiling: undefined,
    waterRightsSystem: "riparian",
    droughtRisk: "low",
    requiredDisclosures: ["residential_disclosure", "lead_paint"],
    environmentalDisclosureRequired: false,
    propertyTaxRate: "0.5%-0.8%",
    agriculturalExemptionAvailable: true,
    transferTax: "$0.37 per $100 of value",
    subdivisionRegulations: "permissive",
    percolationTestRequired: false,
    practitionerNotes: "No state income tax makes TN attractive. Very permissive land use outside cities. East TN mountains are popular for recreational land. Low regulatory burden overall.",
    lastReviewed: "2026-01-01",
    riskScore: 2,
  },
  {
    code: "AL",
    name: "Alabama",
    titleInsuranceRequired: false,
    deedTypes: ["warranty", "quitclaim"],
    todDeedAvailable: false,
    contractForDeedAllowed: true,
    sellerFinancingRisk: "low",
    doddFrankExemptions: ["natural_person_3_per_year"],
    usuryCeiling: 8,
    waterRightsSystem: "riparian",
    droughtRisk: "low",
    requiredDisclosures: ["lead_paint", "material_defects"],
    environmentalDisclosureRequired: false,
    propertyTaxRate: "0.3%-0.5%",
    agriculturalExemptionAvailable: true,
    transferTax: "$0.50 per $500 of value",
    subdivisionRegulations: "permissive",
    percolationTestRequired: false,
    practitionerNotes: "Alabama has some of the lowest property taxes in the US. Very favorable for land investors. Mineral rights often severed — always check title. Timber land is popular investment.",
    lastReviewed: "2026-01-01",
    riskScore: 2,
  },
  {
    code: "MS",
    name: "Mississippi",
    titleInsuranceRequired: false,
    deedTypes: ["warranty", "quitclaim"],
    todDeedAvailable: false,
    contractForDeedAllowed: true,
    sellerFinancingRisk: "low",
    doddFrankExemptions: ["natural_person_3_per_year"],
    usuryCeiling: undefined,
    waterRightsSystem: "riparian",
    droughtRisk: "low",
    requiredDisclosures: ["lead_paint"],
    environmentalDisclosureRequired: false,
    propertyTaxRate: "0.5%-1.0%",
    agriculturalExemptionAvailable: true,
    transferTax: "none",
    subdivisionRegulations: "permissive",
    percolationTestRequired: false,
    practitionerNotes: "Very low regulatory burden. No transfer tax. Heirs property is common issue — always check for heirship issues in rural areas. Delta farmland is valuable.",
    lastReviewed: "2026-01-01",
    riskScore: 3,
  },
  {
    code: "AR",
    name: "Arkansas",
    titleInsuranceRequired: false,
    deedTypes: ["warranty", "quitclaim"],
    todDeedAvailable: true,
    contractForDeedAllowed: true,
    sellerFinancingRisk: "low",
    doddFrankExemptions: ["natural_person_3_per_year"],
    usuryCeiling: 17,
    waterRightsSystem: "riparian",
    droughtRisk: "low",
    requiredDisclosures: ["lead_paint", "residential_property_condition"],
    environmentalDisclosureRequired: false,
    propertyTaxRate: "0.5%-0.8%",
    agriculturalExemptionAvailable: true,
    transferTax: "$1.10 per $1,000",
    subdivisionRegulations: "permissive",
    percolationTestRequired: false,
    practitionerNotes: "Low regulatory state. Ozark and Ouachita mountain land very popular. Timber rights often valuable. Low taxes and no major regulatory barriers.",
    lastReviewed: "2026-01-01",
    riskScore: 2,
  },
  {
    code: "MO",
    name: "Missouri",
    titleInsuranceRequired: false,
    deedTypes: ["warranty", "special_warranty", "quitclaim", "beneficiary_deed"],
    todDeedAvailable: true,
    contractForDeedAllowed: true,
    sellerFinancingRisk: "medium",
    doddFrankExemptions: ["natural_person_3_per_year"],
    usuryCeiling: undefined,
    waterRightsSystem: "riparian",
    droughtRisk: "low",
    requiredDisclosures: ["seller_disclosure", "lead_paint", "flood_plain"],
    environmentalDisclosureRequired: false,
    propertyTaxRate: "0.9%-1.4%",
    agriculturalExemptionAvailable: true,
    transferTax: "none",
    subdivisionRegulations: "moderate",
    percolationTestRequired: false,
    practitionerNotes: "No transfer tax. Beneficiary deed (like TOD) available. Strong Ozark recreational land market. Mark Twain National Forest proximity adds value.",
    lastReviewed: "2026-01-01",
    riskScore: 3,
  },
  {
    code: "OK",
    name: "Oklahoma",
    titleInsuranceRequired: false,
    deedTypes: ["warranty", "quitclaim"],
    todDeedAvailable: true,
    contractForDeedAllowed: true,
    contractForDeedRestrictions: "Buyer has redemption rights",
    sellerFinancingRisk: "low",
    doddFrankExemptions: ["natural_person_3_per_year", "owner_occupant"],
    usuryCeiling: undefined,
    waterRightsSystem: "prior_appropriation",
    droughtRisk: "high",
    requiredDisclosures: ["seller_property_condition", "lead_paint"],
    environmentalDisclosureRequired: false,
    propertyTaxRate: "0.8%-1.2%",
    agriculturalExemptionAvailable: true,
    transferTax: "none",
    subdivisionRegulations: "permissive",
    percolationTestRequired: false,
    practitionerNotes: "No transfer tax. Water rights follow prior appropriation — check Oklahoma Water Resources Board. Oil and gas mineral rights are often severed. Tribal land issues in eastern OK.",
    lastReviewed: "2026-01-01",
    riskScore: 4,
  },
];

export interface RegulatoryAlert {
  id: string;
  state?: string; // null = national
  title: string;
  summary: string;
  severity: "info" | "warning" | "critical";
  effectiveDate: string;
  category: "seller_financing" | "disclosure" | "subdivision" | "environmental" | "tax" | "water_rights" | "other";
  source?: string;
  createdAt: string;
}

// Active regulatory alerts (would come from a DB/scraper in production)
const REGULATORY_ALERTS: RegulatoryAlert[] = [
  {
    id: "alert-001",
    state: undefined,
    title: "CFPB Updates RESPA Guidance on Owner-Financing",
    summary: "The CFPB clarified that seller-financing involving more than 3 residential properties per year requires full TILA/RESPA compliance regardless of property type.",
    severity: "warning",
    effectiveDate: "2026-01-15",
    category: "seller_financing",
    source: "CFPB",
    createdAt: "2026-01-10",
  },
  {
    id: "alert-002",
    state: "TX",
    title: "Texas Water Development Board: New Edwards Aquifer Restrictions",
    summary: "New pumping restrictions in the Edward Aquifer Authority zone affecting Bexar, Comal, and Medina counties. Properties within the EAA jurisdiction may face reduced well permits.",
    severity: "warning",
    effectiveDate: "2026-03-01",
    category: "water_rights",
    source: "TWDB",
    createdAt: "2026-02-01",
  },
  {
    id: "alert-003",
    state: "FL",
    title: "Florida DEP Updates Wetland Mitigation Rules",
    summary: "Florida Dept of Environmental Protection has tightened wetland mitigation requirements for parcels over 5 acres. Environmental assessments now required for parcels near identified wetland corridors.",
    severity: "critical",
    effectiveDate: "2026-02-01",
    category: "environmental",
    source: "Florida DEP",
    createdAt: "2026-01-20",
  },
  {
    id: "alert-004",
    state: "NC",
    title: "NC CAMA Coastal Rules Update",
    summary: "CAMA setback requirements in Brunswick and New Hanover counties have been extended by 25 feet following 2025 storm assessment. Affects coastal land sales and development.",
    severity: "warning",
    effectiveDate: "2026-01-01",
    category: "environmental",
    source: "NC DCM",
    createdAt: "2025-12-15",
  },
];

export interface DueDiligenceChecklist {
  state: string;
  stateName: string;
  items: {
    category: string;
    item: string;
    required: boolean;
    description: string;
  }[];
}

function buildChecklist(profile: StateRegulatoryProfile): DueDiligenceChecklist {
  const items: DueDiligenceChecklist["items"] = [
    // Always required
    { category: "Title", item: "Title search (40+ year chain)", required: true, description: "Confirm clear title with no outstanding liens or encumbrances." },
    { category: "Title", item: "Survey / boundary confirmation", required: true, description: "Verify boundary descriptions match deed legal description." },
    { category: "Title", item: "Deed type selection", required: true, description: `Common deed types in ${profile.name}: ${profile.deedTypes.join(", ")}.` },
    { category: "Access", item: "Verify legal access / easements", required: true, description: "Confirm recorded access easement or road frontage." },
    { category: "Zoning", item: "Confirm zoning + permitted uses", required: true, description: "Check with county planning department for current zoning classification." },
    // Conditional
    ...(profile.environmentalDisclosureRequired ? [{
      category: "Environmental",
      item: "Environmental disclosure review",
      required: true,
      description: "Seller must provide environmental disclosure. Review for contamination, spills, underground storage tanks.",
    }] : []),
    ...(profile.percolationTestRequired ? [{
      category: "Utilities",
      item: "Percolation test (septic suitability)",
      required: true,
      description: "Required before septic system installation. County health dept may require before closing.",
    }] : []),
    ...(profile.waterRightsSystem === "prior_appropriation" ? [{
      category: "Water",
      item: "Water rights verification",
      required: true,
      description: `${profile.name} follows prior appropriation. Verify any water rights are transferred with deed.`,
    }] : [{
      category: "Water",
      item: "Water source confirmation",
      required: false,
      description: "Confirm water source: well, municipal, riparian rights.",
    }]),
    ...(profile.agriculturalExemptionAvailable ? [{
      category: "Tax",
      item: "Ag exemption eligibility review",
      required: false,
      description: `${profile.name} offers agricultural tax exemptions. Review eligibility criteria and application process.`,
    }] : []),
    // Disclosures
    ...profile.requiredDisclosures.map(d => ({
      category: "Disclosures",
      item: `Seller disclosure: ${d.replace(/_/g, " ")}`,
      required: true,
      description: `${profile.name} requires disclosure of ${d.replace(/_/g, " ")}.`,
    })),
    // Seller financing specific
    ...(profile.sellerFinancingRisk !== "low" ? [{
      category: "Seller Financing",
      item: "Dodd-Frank compliance review",
      required: true,
      description: "Verify loan terms comply with federal TILA/RESPA requirements. Consult real estate attorney.",
    }] : []),
    ...(profile.usuryCeiling ? [{
      category: "Seller Financing",
      item: `Interest rate cap: ${profile.usuryCeiling}%`,
      required: true,
      description: `${profile.name} limits interest rates to ${profile.usuryCeiling}%. Ensure note terms comply.`,
    }] : []),
    // Generic important items
    { category: "Property", item: "Mineral rights status", required: false, description: "Confirm whether mineral rights are included in sale or previously severed." },
    { category: "Property", item: "Timber rights status", required: false, description: "Verify any timber agreements or severances." },
    { category: "Property", item: "Flood zone determination", required: true, description: "Check FEMA flood maps. Zone AE may require flood insurance." },
    { category: "Tax", item: "Tax delinquency search", required: true, description: "Confirm no outstanding property taxes, special assessments, or municipal liens." },
  ];

  return {
    state: profile.code,
    stateName: profile.name,
    items,
  };
}

export const regulatoryIntelligenceService = {
  /**
   * Get all state profiles (summary view).
   */
  getAllStates(): Pick<StateRegulatoryProfile, "code" | "name" | "sellerFinancingRisk" | "riskScore" | "waterRightsSystem" | "agriculturalExemptionAvailable" | "subdivisionRegulations">[] {
    return STATE_PROFILES.map(p => ({
      code: p.code,
      name: p.name,
      sellerFinancingRisk: p.sellerFinancingRisk,
      riskScore: p.riskScore,
      waterRightsSystem: p.waterRightsSystem,
      agriculturalExemptionAvailable: p.agriculturalExemptionAvailable,
      subdivisionRegulations: p.subdivisionRegulations,
    }));
  },

  /**
   * Get full profile for a specific state.
   */
  getStateProfile(code: string): StateRegulatoryProfile | null {
    return STATE_PROFILES.find(p => p.code.toUpperCase() === code.toUpperCase()) ?? null;
  },

  /**
   * Get active regulatory alerts, optionally filtered by state.
   */
  getAlerts(stateCode?: string): RegulatoryAlert[] {
    if (!stateCode) return REGULATORY_ALERTS;
    return REGULATORY_ALERTS.filter(a => !a.state || a.state === stateCode.toUpperCase());
  },

  /**
   * Generate a due diligence checklist for a state.
   */
  getDueDiligenceChecklist(stateCode: string): DueDiligenceChecklist | null {
    const profile = this.getStateProfile(stateCode);
    if (!profile) return null;
    return buildChecklist(profile);
  },

  /**
   * Quick risk assessment for a deal in a given state.
   */
  assessDealRisk(stateCode: string, opts: {
    sellerFinanced?: boolean;
    acreage?: number;
    nearWater?: boolean;
    coastal?: boolean;
  }): { riskLevel: "low" | "medium" | "high"; flags: string[]; recommendations: string[] } {
    const profile = this.getStateProfile(stateCode);
    if (!profile) return { riskLevel: "medium", flags: ["State profile not available"], recommendations: [] };

    const flags: string[] = [];
    const recommendations: string[] = [];

    if (opts.sellerFinanced) {
      if (profile.sellerFinancingRisk === "high") {
        flags.push(`${profile.name} has HIGH seller financing regulatory risk`);
        recommendations.push("Consult a real estate attorney before structuring seller financing");
      }
      if (profile.usuryCeiling) {
        flags.push(`Interest rate capped at ${profile.usuryCeiling}% in ${profile.name}`);
      }
    }

    if (opts.nearWater && profile.waterRightsSystem === "prior_appropriation") {
      flags.push("Prior appropriation state — water rights may not convey automatically");
      recommendations.push("Explicitly address water rights in purchase agreement");
    }

    if (opts.coastal && profile.code === "FL") {
      flags.push("Florida coastal land: CAMA setbacks and DEP permits likely required");
      recommendations.push("Order Phase I environmental assessment; verify CAMA compliance");
    }

    if (opts.acreage && opts.acreage > 5 && profile.subdivisionRegulations === "strict") {
      flags.push(`${profile.name} has strict subdivision regulations for parcels over 5 acres`);
      recommendations.push("Review county subdivision ordinance before marketing as multiple lots");
    }

    const alerts = this.getAlerts(stateCode);
    if (alerts.some(a => a.severity === "critical")) {
      flags.push(`Active CRITICAL regulatory alert for ${profile.name}`);
      recommendations.push("Review current regulatory alerts before proceeding");
    }

    const riskLevel = flags.length >= 3 ? "high" : flags.length >= 1 ? "medium" : "low";
    return { riskLevel, flags, recommendations };
  },
};
