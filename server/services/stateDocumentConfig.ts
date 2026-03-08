/**
 * State-Specific Document Configuration
 *
 * LGPass parity: county-specific deeds at the click of a button.
 * Each state has different requirements for:
 * - Deed type (Warranty, Special Warranty, Quitclaim, Grant, Bargain & Sale)
 * - Recording instrument (Deed of Trust vs. Mortgage)
 * - Notary requirements
 * - Witness requirements
 * - Recording fees (approximate)
 * - Transfer tax
 * - Legal language specific to that state
 */

export type DeedType =
  | "general_warranty_deed"
  | "special_warranty_deed"
  | "limited_warranty_deed"
  | "quitclaim_deed"
  | "grant_deed"
  | "bargain_and_sale_deed"
  | "warranty_deed_with_vendor_lien"; // Texas-specific

export type LienInstrument = "deed_of_trust" | "mortgage" | "security_deed";

export type LandContractName =
  | "land_contract"
  | "contract_for_deed"
  | "installment_sale_agreement"
  | "agreement_for_deed"
  | "bond_for_deed";

export interface StateDocumentConfig {
  state: string;
  stateName: string;

  // Deed configuration
  primaryDeedType: DeedType;
  alternativeDeedTypes: DeedType[];
  deedNotesForInvestors: string;

  // Lien instrument (when seller finances)
  lienInstrument: LienInstrument;

  // Land contract terminology in this state
  landContractName: LandContractName;
  landContractNotes: string;

  // Notary & witness requirements
  notaryRequired: boolean;
  witnessCount: number; // Number of witnesses required (0, 1, or 2)

  // Recording
  recordingOffice: string; // County Recorder, County Clerk, Register of Deeds, etc.
  recordingFeeBase: number; // Approximate base fee in dollars
  recordingFeePerPage: number;
  recordingTimeline: string; // "Same day", "1-3 days", etc.

  // Transfer tax
  transferTaxPercent: number; // % of sale price (0 if none)
  transferTaxNotes: string;

  // Attorney required?
  attorneyStateForClosing: boolean; // Some states require attorney for closing

  // Right of redemption
  rightOfRedemptionDays: number; // 0 if no right of redemption for land contracts

  // Legal language snippets
  grantingClause: string; // State-specific granting clause
  haberendumClause: string; // "To have and to hold" clause
  warrantyClause: string; // Warranty language

  // Common practice notes
  practiceNotes: string;
}

export const STATE_DOCUMENT_CONFIGS: Record<string, StateDocumentConfig> = {
  AL: {
    state: "AL", stateName: "Alabama",
    primaryDeedType: "general_warranty_deed",
    alternativeDeedTypes: ["quitclaim_deed", "special_warranty_deed"],
    deedNotesForInvestors: "Warranty deeds are standard. Quitclaim deeds used for clearing title.",
    lienInstrument: "mortgage",
    landContractName: "installment_sale_agreement",
    landContractNotes: "Land contracts are enforceable but less common. Deeds of Trust are not used.",
    notaryRequired: true, witnessCount: 2,
    recordingOffice: "County Probate Judge",
    recordingFeeBase: 18, recordingFeePerPage: 4,
    recordingTimeline: "Same day to 3 days",
    transferTaxPercent: 0.1, transferTaxNotes: "$0.50 per $500 of value",
    attorneyStateForClosing: false,
    rightOfRedemptionDays: 0,
    grantingClause: "CONVEY AND WARRANT to",
    haberendumClause: "TO HAVE AND TO HOLD unto the Grantee, his heirs and assigns forever,",
    warrantyClause: "the Grantor will forever WARRANT AND DEFEND the title to said lands against the lawful claims of all persons.",
    practiceNotes: "Deeds must be filed in the county where the property is located.",
  },
  AZ: {
    state: "AZ", stateName: "Arizona",
    primaryDeedType: "warranty_deed_with_vendor_lien",
    alternativeDeedTypes: ["general_warranty_deed", "special_warranty_deed", "quitclaim_deed"],
    deedNotesForInvestors: "Warranty deeds with covenants of title are standard. Beneficiary deeds available for estate planning.",
    lienInstrument: "deed_of_trust",
    landContractName: "agreement_for_deed",
    landContractNotes: "Agreement for deed (installment land contract) is common in Arizona. Buyer gets equitable title.",
    notaryRequired: true, witnessCount: 0,
    recordingOffice: "County Recorder",
    recordingFeeBase: 30, recordingFeePerPage: 0,
    recordingTimeline: "Same day (e-recording available)",
    transferTaxPercent: 0, transferTaxNotes: "No deed transfer tax in Arizona.",
    attorneyStateForClosing: false,
    rightOfRedemptionDays: 0,
    grantingClause: "does hereby CONVEY and WARRANT to",
    haberendumClause: "TO HAVE AND TO HOLD the said premises with all the appurtenances,",
    warrantyClause: "warrants the title against all persons claiming under Grantor.",
    practiceNotes: "Arizona is a tax lien state. No attorney required for real estate closings.",
  },
  CA: {
    state: "CA", stateName: "California",
    primaryDeedType: "grant_deed",
    alternativeDeedTypes: ["quitclaim_deed", "bargain_and_sale_deed"],
    deedNotesForInvestors: "Grant deeds are universal in California. Never use warranty deed — grant deed is the equivalent.",
    lienInstrument: "deed_of_trust",
    landContractName: "land_contract",
    landContractNotes: "Land contracts (installment sales) are valid. Seller retains legal title until paid. Use carefully — tenant-friendly state.",
    notaryRequired: true, witnessCount: 0,
    recordingOffice: "County Recorder",
    recordingFeeBase: 15, recordingFeePerPage: 3,
    recordingTimeline: "Same day to next day",
    transferTaxPercent: 0.055, transferTaxNotes: "$1.10 per $1,000 of value (county), cities may add more.",
    attorneyStateForClosing: false,
    rightOfRedemptionDays: 0,
    grantingClause: "GRANTS to",
    haberendumClause: "TO HAVE AND TO HOLD said premises with appurtenances,",
    warrantyClause: "grants described property with statutory grant deed covenants.",
    practiceNotes: "PCOR (Preliminary Change of Ownership Report) required at recording.",
  },
  CO: {
    state: "CO", stateName: "Colorado",
    primaryDeedType: "special_warranty_deed",
    alternativeDeedTypes: ["general_warranty_deed", "bargain_and_sale_deed", "quitclaim_deed"],
    deedNotesForInvestors: "Special warranty deeds are standard in Colorado — only warrant against grantor's acts, not all prior claims.",
    lienInstrument: "deed_of_trust",
    landContractName: "installment_sale_agreement",
    landContractNotes: "Installment sale agreements are valid. Colorado has clear foreclosure procedures for sellers.",
    notaryRequired: true, witnessCount: 0,
    recordingOffice: "County Clerk and Recorder",
    recordingFeeBase: 13, recordingFeePerPage: 5,
    recordingTimeline: "Same day",
    transferTaxPercent: 0, transferTaxNotes: "No state transfer tax. Some counties have local documentary fees.",
    attorneyStateForClosing: false,
    rightOfRedemptionDays: 75,
    grantingClause: "CONVEYS AND WARRANTS to",
    haberendumClause: "TO HAVE AND TO HOLD said premises with all appurtenances,",
    warrantyClause: "grantor warrants the title against all persons claiming under grantor.",
    practiceNotes: "Colorado ALTA title commitment standard. E-recording widely available.",
  },
  FL: {
    state: "FL", stateName: "Florida",
    primaryDeedType: "general_warranty_deed",
    alternativeDeedTypes: ["special_warranty_deed", "quitclaim_deed", "bargain_and_sale_deed"],
    deedNotesForInvestors: "Florida is a warranty deed state. Two witnesses required — very important, deeds without witnesses are invalid.",
    lienInstrument: "mortgage",
    landContractName: "agreement_for_deed",
    landContractNotes: "Agreement for deed / installment land contract valid. Seller retains legal title. Florida favors mortgages over land contracts.",
    notaryRequired: true, witnessCount: 2,
    recordingOffice: "County Clerk of Court",
    recordingFeeBase: 10, recordingFeePerPage: 8.50,
    recordingTimeline: "Same day to next business day",
    transferTaxPercent: 0.07, transferTaxNotes: "Documentary stamp tax $0.70 per $100 of consideration.",
    attorneyStateForClosing: false,
    rightOfRedemptionDays: 0,
    grantingClause: "GRANTS, BARGAINS AND SELLS to",
    haberendumClause: "TO HAVE AND TO HOLD, the same in fee simple forever,",
    warrantyClause: "shall warrant the title against the lawful claims of all persons whomsoever.",
    practiceNotes: "Two witnesses are REQUIRED for valid deed in Florida. No exceptions.",
  },
  GA: {
    state: "GA", stateName: "Georgia",
    primaryDeedType: "general_warranty_deed",
    alternativeDeedTypes: ["limited_warranty_deed", "quitclaim_deed"],
    deedNotesForInvestors: "Warranty deeds standard. Security Deeds (not Deeds of Trust or Mortgages) used for financing.",
    lienInstrument: "security_deed",
    landContractName: "installment_sale_agreement",
    landContractNotes: "Land contracts less common in Georgia. Security deeds are preferred for seller financing.",
    notaryRequired: true, witnessCount: 1,
    recordingOffice: "County Superior Court Clerk",
    recordingFeeBase: 25, recordingFeePerPage: 0,
    recordingTimeline: "Same day",
    transferTaxPercent: 0.1, transferTaxNotes: "$1.00 per $1,000 of value.",
    attorneyStateForClosing: true,
    rightOfRedemptionDays: 0,
    grantingClause: "CONVEY with GENERAL WARRANTY to",
    haberendumClause: "TO HAVE AND TO HOLD said described property to the party of the second part, their heirs and assigns,",
    warrantyClause: "warrants title against the lawful claims of all persons claiming by, through, or under Grantor.",
    practiceNotes: "Georgia requires an attorney (not just a title company) for closings.",
  },
  ID: {
    state: "ID", stateName: "Idaho",
    primaryDeedType: "general_warranty_deed",
    alternativeDeedTypes: ["special_warranty_deed", "quitclaim_deed"],
    deedNotesForInvestors: "Warranty deeds are standard. Deed of Trust used for purchase money financing.",
    lienInstrument: "deed_of_trust",
    landContractName: "contract_for_deed",
    landContractNotes: "Contract for deed is used in Idaho. Seller retains legal title until paid off.",
    notaryRequired: true, witnessCount: 0,
    recordingOffice: "County Recorder",
    recordingFeeBase: 15, recordingFeePerPage: 5,
    recordingTimeline: "Same day",
    transferTaxPercent: 0, transferTaxNotes: "No deed transfer tax in Idaho.",
    attorneyStateForClosing: false,
    rightOfRedemptionDays: 0,
    grantingClause: "CONVEYS AND WARRANTS to",
    haberendumClause: "TO HAVE AND TO HOLD said premises, with their appurtenances,",
    warrantyClause: "warrants the title against all persons claiming under the Grantor.",
    practiceNotes: "Idaho is a community property state. Spouse signature may be required.",
  },
  MI: {
    state: "MI", stateName: "Michigan",
    primaryDeedType: "warranty_deed_with_vendor_lien",
    alternativeDeedTypes: ["general_warranty_deed", "quitclaim_deed"],
    deedNotesForInvestors: "Michigan warranty deeds are very common. Land contracts are EXTREMELY common in Michigan — more than any other state.",
    lienInstrument: "mortgage",
    landContractName: "land_contract",
    landContractNotes: "Land contracts are the dominant seller-finance instrument in Michigan. Well-established law supports them. Highly recommended for seller financing.",
    notaryRequired: true, witnessCount: 0,
    recordingOffice: "County Register of Deeds",
    recordingFeeBase: 30, recordingFeePerPage: 0,
    recordingTimeline: "Same day to 3 days",
    transferTaxPercent: 0.075, transferTaxNotes: "State: $3.75 per $500. County: $0.55 per $500.",
    attorneyStateForClosing: false,
    rightOfRedemptionDays: 180,
    grantingClause: "CONVEYS AND WARRANTS to",
    haberendumClause: "to the said party of the second part, his heirs and assigns,",
    warrantyClause: "will warrant the title against all encumbrances made by the Grantor.",
    practiceNotes: "Michigan land contracts are very investor-friendly. Buyer records equitable title. Seller retains legal title.",
  },
  MO: {
    state: "MO", stateName: "Missouri",
    primaryDeedType: "general_warranty_deed",
    alternativeDeedTypes: ["special_warranty_deed", "quitclaim_deed", "bargain_and_sale_deed"],
    deedNotesForInvestors: "General warranty deeds are standard. Deeds of Trust used for seller financing.",
    lienInstrument: "deed_of_trust",
    landContractName: "contract_for_deed",
    landContractNotes: "Contract for deed valid in Missouri. Seller retains legal title. Use carefully — forfeiture can be challenged.",
    notaryRequired: true, witnessCount: 0,
    recordingOffice: "County Recorder of Deeds",
    recordingFeeBase: 24, recordingFeePerPage: 4,
    recordingTimeline: "1-3 days",
    transferTaxPercent: 0, transferTaxNotes: "No state transfer tax in Missouri.",
    attorneyStateForClosing: false,
    rightOfRedemptionDays: 0,
    grantingClause: "GRANT, BARGAIN AND SELL to",
    haberendumClause: "TO HAVE AND TO HOLD the premises aforesaid with all appurtenances,",
    warrantyClause: "Grantor will warrant and defend title against the lawful claims and demands of all persons.",
    practiceNotes: "Missouri uses the torrens title system in some counties.",
  },
  NM: {
    state: "NM", stateName: "New Mexico",
    primaryDeedType: "general_warranty_deed",
    alternativeDeedTypes: ["special_warranty_deed", "quitclaim_deed"],
    deedNotesForInvestors: "Warranty deeds are standard. New Mexico is a community property state — spousal consent matters.",
    lienInstrument: "deed_of_trust",
    landContractName: "installment_sale_agreement",
    landContractNotes: "Installment sales valid. Deed of Trust is preferred for seller financing in NM.",
    notaryRequired: true, witnessCount: 0,
    recordingOffice: "County Clerk",
    recordingFeeBase: 25, recordingFeePerPage: 0,
    recordingTimeline: "Same day",
    transferTaxPercent: 0, transferTaxNotes: "No deed transfer tax in New Mexico.",
    attorneyStateForClosing: false,
    rightOfRedemptionDays: 0,
    grantingClause: "GRANTS AND WARRANTS to",
    haberendumClause: "TO HAVE AND TO HOLD the same, together with all singular the appurtenances thereunto belonging,",
    warrantyClause: "the Grantor will warrant and defend the same against all persons lawfully claiming the whole or any part thereof.",
    practiceNotes: "Community property state — both spouses must sign if property is community property.",
  },
  NV: {
    state: "NV", stateName: "Nevada",
    primaryDeedType: "grant_deed",
    alternativeDeedTypes: ["general_warranty_deed", "quitclaim_deed", "bargain_and_sale_deed"],
    deedNotesForInvestors: "Grant deeds are standard in Nevada (like California). Deed of Trust used for financing.",
    lienInstrument: "deed_of_trust",
    landContractName: "installment_sale_agreement",
    landContractNotes: "Land contracts valid but less common. Deed of Trust is preferred for seller financing.",
    notaryRequired: true, witnessCount: 0,
    recordingOffice: "County Recorder",
    recordingFeeBase: 25, recordingFeePerPage: 0,
    recordingTimeline: "Same day",
    transferTaxPercent: 0.0195, transferTaxNotes: "$1.95 per $500 of value.",
    attorneyStateForClosing: false,
    rightOfRedemptionDays: 0,
    grantingClause: "GRANTS to",
    haberendumClause: "TO HAVE AND TO HOLD said premises together with all appurtenances,",
    warrantyClause: "with statutory grant deed covenants.",
    practiceNotes: "Nevada is a community property state. No attorney required for closings.",
  },
  NC: {
    state: "NC", stateName: "North Carolina",
    primaryDeedType: "general_warranty_deed",
    alternativeDeedTypes: ["special_warranty_deed", "quitclaim_deed"],
    deedNotesForInvestors: "General warranty deeds standard. Two witnesses + notary required.",
    lienInstrument: "deed_of_trust",
    landContractName: "installment_sale_agreement",
    landContractNotes: "Installment land contracts valid but less common than Deeds of Trust.",
    notaryRequired: true, witnessCount: 2,
    recordingOffice: "County Register of Deeds",
    recordingFeeBase: 26, recordingFeePerPage: 0,
    recordingTimeline: "Same day to next day",
    transferTaxPercent: 0.02, transferTaxNotes: "$2.00 per $1,000 of consideration.",
    attorneyStateForClosing: true,
    rightOfRedemptionDays: 0,
    grantingClause: "CONVEYS AND WARRANTS to",
    haberendumClause: "TO HAVE AND TO HOLD the aforesaid tract or parcel of land and all privileges thereunto belonging to the Grantee,",
    warrantyClause: "will warrant and defend the said title to the same against the lawful claims of all persons claiming by, through, or under the Grantor.",
    practiceNotes: "Attorney required for deed preparation and closings in North Carolina.",
  },
  OH: {
    state: "OH", stateName: "Ohio",
    primaryDeedType: "general_warranty_deed",
    alternativeDeedTypes: ["limited_warranty_deed", "quitclaim_deed", "bargain_and_sale_deed"],
    deedNotesForInvestors: "General warranty deeds are standard. Limited warranty deed common for investor sales.",
    lienInstrument: "mortgage",
    landContractName: "land_contract",
    landContractNotes: "Land contracts are VERY common in Ohio — one of the most land-contract-friendly states. Widely used by investors.",
    notaryRequired: true, witnessCount: 0,
    recordingOffice: "County Recorder",
    recordingFeeBase: 28, recordingFeePerPage: 8,
    recordingTimeline: "Same day to next day",
    transferTaxPercent: 0.1, transferTaxNotes: "$1.00 per $1,000 of value (exempt if foreclosure).",
    attorneyStateForClosing: false,
    rightOfRedemptionDays: 0,
    grantingClause: "CONVEYS AND WARRANTS to",
    haberendumClause: "TO HAVE AND TO HOLD said premises with all the appurtenances thereunto belonging,",
    warrantyClause: "the grantor warrants the title against all persons claiming by, through, or under the grantor.",
    practiceNotes: "Ohio land contracts are extremely investor-friendly. Memorandum of land contract should be recorded.",
  },
  OR: {
    state: "OR", stateName: "Oregon",
    primaryDeedType: "general_warranty_deed",
    alternativeDeedTypes: ["special_warranty_deed", "quitclaim_deed", "bargain_and_sale_deed"],
    deedNotesForInvestors: "Warranty deeds are standard. Deed of Trust used for financing. Statutory warranty deed language is sufficient.",
    lienInstrument: "deed_of_trust",
    landContractName: "land_sale_contract",
    landContractNotes: "Oregon Land Sale Contract (ORS 93.905-920) is well-defined by statute. Use the statutory form.",
    notaryRequired: true, witnessCount: 0,
    recordingOffice: "County Clerk",
    recordingFeeBase: 96, recordingFeePerPage: 0,
    recordingTimeline: "Same day to 3 days",
    transferTaxPercent: 0, transferTaxNotes: "No state transfer tax. Some cities have local taxes.",
    attorneyStateForClosing: false,
    rightOfRedemptionDays: 0,
    grantingClause: "CONVEYS AND WARRANTS to",
    haberendumClause: "TO HAVE AND TO HOLD to the said Grantee and Grantee's heirs, successors, and assigns forever,",
    warrantyClause: "that the property is free from all encumbrances except as specifically set forth herein.",
    practiceNotes: "Oregon requires a cover page with specific formatting for recording. Oregon Land Sale Contract is statutory.",
  },
  TX: {
    state: "TX", stateName: "Texas",
    primaryDeedType: "general_warranty_deed",
    alternativeDeedTypes: ["special_warranty_deed", "quitclaim_deed"],
    deedNotesForInvestors: "General warranty deed with vendor's lien is the gold standard in Texas for seller-financed deals. Protects seller's security interest.",
    lienInstrument: "deed_of_trust",
    landContractName: "contract_for_deed",
    landContractNotes: "CAUTION: Texas Property Code 5.061-5.086 imposes strict requirements on contracts for deed. Non-compliance has severe consequences. Consider Deed of Trust structure instead.",
    notaryRequired: true, witnessCount: 0,
    recordingOffice: "County Clerk",
    recordingFeeBase: 25, recordingFeePerPage: 4,
    recordingTimeline: "Same day to next day",
    transferTaxPercent: 0, transferTaxNotes: "No deed transfer tax in Texas.",
    attorneyStateForClosing: false,
    rightOfRedemptionDays: 0,
    grantingClause: "GRANT, SELL AND CONVEY to",
    haberendumClause: "TO HAVE AND TO HOLD the above described premises together with all and singular the rights and appurtenances thereto in anywise belonging unto the said Grantee, his heirs and assigns forever;",
    warrantyClause: "Grantor does hereby bind Grantor and Grantor's heirs, executors, administrators, and successors to WARRANT AND FOREVER DEFEND all and singular the said premises unto the said Grantee, his heirs and assigns, against every person whomsoever lawfully claiming or to claim the same or any part thereof.",
    practiceNotes: "Texas contracts for deed have strict disclosure requirements. Use Deed of Trust with Warranty Deed for safer seller financing.",
  },
  WA: {
    state: "WA", stateName: "Washington",
    primaryDeedType: "general_warranty_deed",
    alternativeDeedTypes: ["special_warranty_deed", "bargain_and_sale_deed", "quitclaim_deed"],
    deedNotesForInvestors: "Warranty deeds standard. Deed of Trust for financing. Washington has a significant real estate excise tax.",
    lienInstrument: "deed_of_trust",
    landContractName: "contract_for_deed",
    landContractNotes: "Contracts for deed valid in Washington. Seller retains legal title. Buyer has equitable interest.",
    notaryRequired: true, witnessCount: 0,
    recordingOffice: "County Auditor",
    recordingFeeBase: 203.50, recordingFeePerPage: 1,
    recordingTimeline: "Same day to 3 days",
    transferTaxPercent: 1.1, transferTaxNotes: "Real Estate Excise Tax (REET): 1.1% on sales under $500K, up to 3% for higher values.",
    attorneyStateForClosing: false,
    rightOfRedemptionDays: 0,
    grantingClause: "CONVEYS AND WARRANTS to",
    haberendumClause: "TO HAVE AND TO HOLD said real estate with all its appurtenances,",
    warrantyClause: "the Grantor will warrant and defend the said premises against all persons lawfully claiming the same.",
    practiceNotes: "Washington REET is significant — factor into deal underwriting. Escrow agents (not attorneys) typically handle closings.",
  },
};

// Fill in remaining states with sensible defaults
const DEFAULT_STATES = [
  ["AK", "Alaska"], ["AR", "Arkansas"], ["CT", "Connecticut"], ["DE", "Delaware"],
  ["HI", "Hawaii"], ["IL", "Illinois"], ["IN", "Indiana"], ["IA", "Iowa"],
  ["KS", "Kansas"], ["KY", "Kentucky"], ["LA", "Louisiana"], ["ME", "Maine"],
  ["MD", "Maryland"], ["MA", "Massachusetts"], ["MN", "Minnesota"], ["MS", "Mississippi"],
  ["MT", "Montana"], ["NE", "Nebraska"], ["NH", "New Hampshire"], ["NJ", "New Jersey"],
  ["NY", "New York"], ["ND", "North Dakota"], ["OK", "Oklahoma"], ["PA", "Pennsylvania"],
  ["RI", "Rhode Island"], ["SC", "South Carolina"], ["SD", "South Dakota"], ["TN", "Tennessee"],
  ["UT", "Utah"], ["VT", "Vermont"], ["VA", "Virginia"], ["WV", "West Virginia"],
  ["WI", "Wisconsin"], ["WY", "Wyoming"],
];

for (const [abbr, name] of DEFAULT_STATES) {
  if (!STATE_DOCUMENT_CONFIGS[abbr]) {
    STATE_DOCUMENT_CONFIGS[abbr] = {
      state: abbr, stateName: name,
      primaryDeedType: "general_warranty_deed",
      alternativeDeedTypes: ["special_warranty_deed", "quitclaim_deed"],
      deedNotesForInvestors: `Consult a local real estate attorney for ${name}-specific requirements.`,
      lienInstrument: "deed_of_trust",
      landContractName: "contract_for_deed",
      landContractNotes: "Land contracts are valid in most states. Consult local counsel for specific requirements.",
      notaryRequired: true, witnessCount: 0,
      recordingOffice: "County Recorder / Clerk",
      recordingFeeBase: 25, recordingFeePerPage: 5,
      recordingTimeline: "1-5 days",
      transferTaxPercent: 0, transferTaxNotes: "Verify current transfer tax rates with county.",
      attorneyStateForClosing: false,
      rightOfRedemptionDays: 0,
      grantingClause: "CONVEYS AND WARRANTS to",
      haberendumClause: "TO HAVE AND TO HOLD said premises with all appurtenances,",
      warrantyClause: "warrants the title against all persons claiming by, through, or under the Grantor.",
      practiceNotes: `Verify ${name}-specific requirements before closing.`,
    };
  }
}

// ============================================
// LOOKUP HELPERS
// ============================================

export function getStateConfig(stateAbbr: string): StateDocumentConfig | null {
  return STATE_DOCUMENT_CONFIGS[stateAbbr.toUpperCase()] || null;
}

export function getDeedTypeLabel(deedType: DeedType): string {
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

export function getLandContractLabel(name: LandContractName): string {
  const labels: Record<LandContractName, string> = {
    land_contract: "Land Contract",
    contract_for_deed: "Contract for Deed",
    installment_sale_agreement: "Installment Sale Agreement",
    agreement_for_deed: "Agreement for Deed",
    bond_for_deed: "Bond for Deed",
  };
  return labels[name] || name;
}

export function getRecordingEstimate(state: string, pageCount: number = 4): number {
  const config = getStateConfig(state);
  if (!config) return 50;
  return config.recordingFeeBase + config.recordingFeePerPage * pageCount;
}

export function getTransferTaxAmount(state: string, salePrice: number): number {
  const config = getStateConfig(state);
  if (!config) return 0;
  return salePrice * (config.transferTaxPercent / 100);
}
