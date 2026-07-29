/**
 * Sample-data seeder — the SINGLE sample-data path for onboarding.
 *
 * Consolidates the three previously uncoordinated seeders:
 *   1. `OnboardingService.generateSampleData` ("Try with sample data") — now
 *      delegates here.
 *   2. `OnboardingService.completeOnboarding`'s inline seeds — which used real
 *      lead sources ("direct_mail", "cold_call") and were therefore
 *      UNCLEARABLE. completeOnboarding now delegates here too.
 *   3. `OnboardingService.clearSampleData` — now delegates to
 *      `clearSampleDataForOrg`.
 * (Workflow/campaign TEMPLATE provisioning — `provisionTemplates` — is NOT
 * sample data and deliberately stays in onboarding.ts.)
 *
 * ── Marker / labeling convention (the cleanup contract) ────────────────────
 * Every seeded row is identifiable as sample data:
 *   - every lead carries source = "sample_data" (SAMPLE_LEAD_SOURCE) and a
 *     "sample" tag;
 *   - every property's apn starts with "SAMPLE-" (SAMPLE_APN_PREFIX) and its
 *     description starts with "Sample";
 *   - deals and notes have no flag column, so they attach ONLY to sample
 *     properties (propertyId → a SAMPLE- apn) and their free-text starts with
 *     "Sample"; the DB cascades them away when the sample property is deleted.
 * This is the SAME convention the existing demo-data clear flow
 * (DELETE /api/onboarding/sample-data → clearSampleData) has always keyed on,
 * so both paths agree on what "sample" means.
 *
 * ── Idempotency ────────────────────────────────────────────────────────────
 * `seedSampleDataForOrg` first scans the org for existing marker rows (any
 * lead with source="sample_data" OR any property with a "SAMPLE-" apn). If
 * any exist, it returns `{ seeded: false }` with the CURRENT sample counts
 * and creates nothing — calling seed twice never duplicates.
 *
 * ── Honesty ────────────────────────────────────────────────────────────────
 * Every figure is a fixed, labeled fixture value — NO Math.random(), no
 * invented market numbers presented as real. All 15 registered business
 * types (shared/business-types.ts) get a tailored builder speaking that
 * vertical's vocabulary (shared/models/persona-mapping.ts).
 *
 * Note: the storage layer keys organizations by numeric id; the contract
 * takes `orgId: string` and this module coerces (and validates) internally.
 */

import { storage } from "../../storage";
import { logger } from "../../utils/logger";
import { addMonths } from "../../utils/dateUtils";

export const SAMPLE_LEAD_SOURCE = "sample_data" as const;
export const SAMPLE_APN_PREFIX = "SAMPLE-" as const;

// ───────────────────────────────────────────────────────────────────────────
// Fixture shapes (properties/notes reference related rows by INDEX so we
// never hand-wire ids; the seeder resolves them against just-created rows).
// ───────────────────────────────────────────────────────────────────────────

export interface SampleLeadFixture {
  organizationId: number;
  type: "seller" | "buyer";
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  status: string;
  source: typeof SAMPLE_LEAD_SOURCE;
  tags: string[];
  notes?: string;
}

export interface SamplePropertyFixture {
  organizationId: number;
  /** MUST start with "SAMPLE-" so the clear path removes it. */
  apn: string;
  legalDescription: string;
  county: string;
  state: string;
  address: string;
  city: string;
  zip: string;
  sizeAcres: string;
  zoning: string;
  terrain: string;
  roadAccess: string;
  status: string;
  assessedValue: string;
  marketValue: string;
  purchasePrice: string;
  listPrice: string;
  description: string;
  highlights: string[];
  /**
   * Representative coordinates of the fixture's stated locality. REQUIRED:
   * the Map door filters out coordinate-less parcels, and the onboarding
   * finish CTA lands on /maps — a sample parcel without lat/lng renders zero
   * pins and dead-ends the activation moment.
   */
  latitude: string;
  longitude: string;
  /** Index into the fixture leads array that owns/sells this property. */
  sellerLeadIndex?: number;
}

export interface SampleDealFixture {
  organizationId: number;
  type: string;
  status: string;
  offerAmount: string;
  acceptedAmount?: string;
  notes: string;
  /** Index into the fixture properties array this deal is on. */
  propertyIndex?: number;
}

export interface SampleNoteFixture {
  organizationId: number;
  originalPrincipal: string;
  currentBalance: string;
  interestRate: string;
  termMonths: number;
  monthlyPayment: string;
  serviceFee: string;
  lateFee: string;
  gracePeriodDays: number;
  startDate: Date;
  firstPaymentDate: Date;
  nextPaymentDate: Date;
  maturityDate: Date;
  status: string;
  downPayment: string;
  downPaymentReceived: boolean;
  notes_text: string;
  // Reg-Z §1026.43 hard gate. Sample onboarding data is synthetic /
  // non-consumer — flagged exempt so the gate constraint doesn't reject the
  // seed insert. Real consumer originations must go through
  // POST /api/notes/:id/originate with a full ATR.
  atrExemptionCode: "business_purpose";
  /** Index into the fixture properties array secured by this note. */
  propertyIndex?: number;
  /** Index into the fixture leads array that is the borrower. */
  borrowerLeadIndex?: number;
}

export interface SampleFixtureSet {
  leads: SampleLeadFixture[];
  properties: SamplePropertyFixture[];
  deals: SampleDealFixture[];
  notes: SampleNoteFixture[];
}

function noteDates(monthsPaid: number, nextPaymentInDays = 12): {
  startDate: Date;
  firstPaymentDate: Date;
  nextPaymentDate: Date;
  maturityDate: Date;
} {
  // Anchor on "now" but back-date the start so a seasoned book reads honestly.
  const now = new Date();
  const startDate = new Date(now);
  startDate.setMonth(startDate.getMonth() - monthsPaid);
  const firstPaymentDate = addMonths(new Date(startDate), 1);
  // Explicit day offset: keeps the next payment INSIDE Today's 30-day cash
  // window. Negative = past due (a delinquent note's next payment is BEHIND
  // it, not ahead).
  const nextPaymentDate = new Date(now.getTime() + nextPaymentInDays * 24 * 60 * 60 * 1000);
  const maturityDate = new Date(startDate);
  maturityDate.setFullYear(maturityDate.getFullYear() + 5);
  return { startDate, firstPaymentDate, nextPaymentDate, maturityDate };
}

// ───────────────────────────────────────────────────────────────────────────
// Per-business-type builders — one for each of the 15 registered ids.
// ───────────────────────────────────────────────────────────────────────────

/**
 * Land flipper — vacant-parcel acquisition + seller-financed exit. Preserves
 * the canonical fixture set (apns pinned by personaSampleData.test.ts).
 */
function buildLandFlipperFixtures(orgId: number): SampleFixtureSet {
  const leads: SampleLeadFixture[] = [
    { organizationId: orgId, type: "seller", firstName: "John", lastName: "Anderson", email: "john.anderson@example.com", phone: "(555) 123-4567", address: "123 Oak Street", city: "Austin", state: "TX", zip: "78701", status: "new", source: SAMPLE_LEAD_SOURCE, tags: ["sample", "hot lead"] },
    { organizationId: orgId, type: "seller", firstName: "Maria", lastName: "Garcia", email: "maria.garcia@example.com", phone: "(555) 234-5678", address: "456 Pine Avenue", city: "Phoenix", state: "AZ", zip: "85001", status: "contacted", source: SAMPLE_LEAD_SOURCE, tags: ["sample", "motivated seller"] },
    { organizationId: orgId, type: "buyer", firstName: "Robert", lastName: "Smith", email: "robert.smith@example.com", phone: "(555) 345-6789", address: "789 Maple Drive", city: "Denver", state: "CO", zip: "80202", status: "qualified", source: SAMPLE_LEAD_SOURCE, tags: ["sample", "cash buyer"] },
    { organizationId: orgId, type: "seller", firstName: "Linda", lastName: "Williams", email: "linda.williams@example.com", phone: "(555) 456-7890", address: "321 Cedar Lane", city: "Tampa", state: "FL", zip: "33601", status: "negotiating", source: SAMPLE_LEAD_SOURCE, tags: ["sample", "inherited property"] },
    { organizationId: orgId, type: "buyer", firstName: "Michael", lastName: "Johnson", email: "michael.johnson@example.com", phone: "(555) 567-8901", address: "654 Birch Road", city: "Nashville", state: "TN", zip: "37201", status: "new", source: SAMPLE_LEAD_SOURCE, tags: ["sample", "terms buyer"] },
  ];

  const properties: SamplePropertyFixture[] = [
    { organizationId: orgId, apn: "SAMPLE-001-234", latitude: "30.3752", longitude: "-97.8331", legalDescription: "Lot 5, Block A, Sunset Acres", county: "Travis", state: "TX", address: "Tract 5 FM 2222", city: "Austin", zip: "78730", sizeAcres: "5.25", zoning: "Agricultural", terrain: "rolling", roadAccess: "paved", status: "owned", assessedValue: "15000", marketValue: "25000", purchasePrice: "12000", listPrice: "29900", description: "Sample — 5+ acre parcel with mature trees and rolling terrain. Great for homesite or recreational use.", highlights: ["Road frontage", "Mature trees", "Electric available"], sellerLeadIndex: 0 },
    { organizationId: orgId, apn: "SAMPLE-002-567", latitude: "33.6529", longitude: "-112.3830", legalDescription: "Lot 12, Desert Vista Estates", county: "Maricopa", state: "AZ", address: "N Desert Vista Road", city: "Surprise", zip: "85374", sizeAcres: "2.5", zoning: "Residential", terrain: "flat", roadAccess: "gravel", status: "listed", assessedValue: "8000", marketValue: "18000", purchasePrice: "6500", listPrice: "19900", description: "Sample — level 2.5 acre lot for a manufactured or stick-built home. Mountain views.", highlights: ["Mountain views", "Level lot", "Near town"], sellerLeadIndex: 1 },
    { organizationId: orgId, apn: "SAMPLE-003-890", latitude: "38.9958", longitude: "-104.4836", legalDescription: "Parcel B, Mountain Creek Ranch", county: "El Paso", state: "CO", address: "County Road 47", city: "Peyton", zip: "80831", sizeAcres: "10.0", zoning: "Agricultural", terrain: "mountainous", roadAccess: "dirt", status: "under_contract", assessedValue: "22000", marketValue: "45000", purchasePrice: "18000", listPrice: "49900", description: "Sample — 10 acre mountain property with Pikes Peak views.", highlights: ["Pikes Peak views", "Creek frontage", "Wildlife"] },
  ];

  const deals: SampleDealFixture[] = [
    { organizationId: orgId, type: "acquisition", status: "closed", offerAmount: "10000", acceptedAmount: "12000", notes: "Sample acquisition deal - good margin on this one", propertyIndex: 0 },
    { organizationId: orgId, type: "disposition", status: "in_escrow", offerAmount: "45000", notes: "Sample disposition - cash buyer, closing next week", propertyIndex: 2 },
  ];

  const d = noteDates(0);
  const notes: SampleNoteFixture[] = [
    { organizationId: orgId, originalPrincipal: "19900", currentBalance: "18500", interestRate: "9.9", termMonths: 60, monthlyPayment: "419.52", serviceFee: "0", lateFee: "25", gracePeriodDays: 10, ...d, status: "active", downPayment: "1990", downPaymentReceived: true, notes_text: "Sample seller-financed note. Buyer is paying on time.", atrExemptionCode: "business_purpose", propertyIndex: 1, borrowerLeadIndex: 2 },
  ];

  return { leads, properties, deals, notes };
}

/**
 * Note investor — a small SERVICED note book (borrowers, payment cadence,
 * mixed performance), not parcel hunting.
 */
function buildNoteInvestorFixtures(orgId: number): SampleFixtureSet {
  const leads: SampleLeadFixture[] = [
    { organizationId: orgId, type: "buyer", firstName: "Dana", lastName: "Phillips", email: "dana.phillips@example.com", phone: "(555) 201-3300", address: "44 Sandhill Trail", city: "Ocala", state: "FL", zip: "34470", status: "active", source: SAMPLE_LEAD_SOURCE, tags: ["sample", "borrower", "current"] },
    { organizationId: orgId, type: "buyer", firstName: "Marcus", lastName: "Reed", email: "marcus.reed@example.com", phone: "(555) 202-4411", address: "1208 Mesquite Way", city: "Lubbock", state: "TX", zip: "79410", status: "active", source: SAMPLE_LEAD_SOURCE, tags: ["sample", "borrower", "watch"] },
    { organizationId: orgId, type: "buyer", firstName: "Tyra", lastName: "Coleman", email: "tyra.coleman@example.com", phone: "(555) 203-5522", address: "9 Red Rock Loop", city: "Cortez", state: "CO", zip: "81321", status: "active", source: SAMPLE_LEAD_SOURCE, tags: ["sample", "borrower", "delinquent"] },
    { organizationId: orgId, type: "seller", firstName: "Greenline", lastName: "Capital", email: "desk@greenline-notes.example.com", phone: "(555) 204-6633", address: "500 Note Exchange Blvd", city: "Dallas", state: "TX", zip: "75201", status: "qualified", source: SAMPLE_LEAD_SOURCE, tags: ["sample", "note seller", "wholesale tape"] },
  ];

  const properties: SamplePropertyFixture[] = [
    { organizationId: orgId, apn: "SAMPLE-N01-118", latitude: "29.1992", longitude: "-82.0931", legalDescription: "Lot 7, Block C, Sandhill Acres", county: "Marion", state: "FL", address: "44 Sandhill Trail", city: "Ocala", zip: "34470", sizeAcres: "1.25", zoning: "Residential", terrain: "flat", roadAccess: "paved", status: "owned", assessedValue: "9000", marketValue: "16000", purchasePrice: "7000", listPrice: "0", description: "Sample — collateral parcel for a performing seller-financed note. Borrower current.", highlights: ["Performing note collateral", "Paved access"], sellerLeadIndex: 0 },
    { organizationId: orgId, apn: "SAMPLE-N02-227", latitude: "33.5670", longitude: "-101.8783", legalDescription: "Tract 3, Mesquite Flats", county: "Lubbock", state: "TX", address: "1208 Mesquite Way", city: "Lubbock", zip: "79410", sizeAcres: "3.0", zoning: "Agricultural", terrain: "flat", roadAccess: "gravel", status: "owned", assessedValue: "11000", marketValue: "21000", purchasePrice: "8500", listPrice: "0", description: "Sample — collateral parcel for a note on the watch list; borrower paid 9 days late twice this year.", highlights: ["Note collateral", "Watch-list borrower"], sellerLeadIndex: 1 },
    { organizationId: orgId, apn: "SAMPLE-N03-336", latitude: "37.3528", longitude: "-108.5773", legalDescription: "Parcel A, Red Rock Mesa", county: "Montezuma", state: "CO", address: "9 Red Rock Loop", city: "Cortez", zip: "81321", sizeAcres: "5.0", zoning: "Agricultural", terrain: "rolling", roadAccess: "dirt", status: "owned", assessedValue: "14000", marketValue: "27000", purchasePrice: "10000", listPrice: "0", description: "Sample — collateral parcel for a delinquent note; 38 days past due, loss-mitigation outreach in progress.", highlights: ["Note collateral", "Delinquent — loss mit"], sellerLeadIndex: 2 },
  ];

  const deals: SampleDealFixture[] = [
    { organizationId: orgId, type: "acquisition", status: "closed", offerAmount: "14200", acceptedAmount: "14200", notes: "Sample note purchase - bought a single performing note off a wholesale tape at ~0.78 of UPB.", propertyIndex: 0 },
  ];

  const dCurrent = noteDates(14, 12); // seasoned, performing — due in 12 days
  const dWatch = noteDates(8, 25); // due toward the end of the 30-day window
  const dDelinquent = noteDates(20, -38); // 38 days PAST due — matches the copy
  const notes: SampleNoteFixture[] = [
    { organizationId: orgId, originalPrincipal: "15500", currentBalance: "13100", interestRate: "10.5", termMonths: 84, monthlyPayment: "258.61", serviceFee: "15", lateFee: "25", gracePeriodDays: 10, ...dCurrent, status: "active", downPayment: "1550", downPaymentReceived: true, notes_text: "Sample performing note. Borrower current, 14 payments in. Yield holding.", atrExemptionCode: "business_purpose", propertyIndex: 0, borrowerLeadIndex: 0 },
    { organizationId: orgId, originalPrincipal: "18000", currentBalance: "16400", interestRate: "9.75", termMonths: 96, monthlyPayment: "246.18", serviceFee: "15", lateFee: "25", gracePeriodDays: 10, ...dWatch, status: "active", downPayment: "1800", downPaymentReceived: true, notes_text: "Sample watch-list note. Paid 9 days late twice — inside grace but trending. Worth a check-in call.", atrExemptionCode: "business_purpose", propertyIndex: 1, borrowerLeadIndex: 1 },
    { organizationId: orgId, originalPrincipal: "22000", currentBalance: "20950", interestRate: "11.0", termMonths: 120, monthlyPayment: "303.12", serviceFee: "15", lateFee: "25", gracePeriodDays: 10, ...dDelinquent, status: "delinquent", downPayment: "2200", downPaymentReceived: true, notes_text: "Sample delinquent note. 38 days past due. Loss-mitigation outreach started; do NOT proceed to remedy without notice + cure period.", atrExemptionCode: "business_purpose", propertyIndex: 2, borrowerLeadIndex: 2 },
  ];

  return { leads, properties, deals, notes };
}

/**
 * Hybrid — both books in one workspace: a land acquisition in flight AND a
 * small serviced-note position, so both the Map and Finance doors light up.
 */
function buildHybridFixtures(orgId: number): SampleFixtureSet {
  const leads: SampleLeadFixture[] = [
    { organizationId: orgId, type: "seller", firstName: "Evelyn", lastName: "Marsh", email: "evelyn.marsh@example.com", phone: "(555) 210-1100", address: "Route 6 Tract", city: "Alamogordo", state: "NM", zip: "88310", status: "negotiating", source: SAMPLE_LEAD_SOURCE, tags: ["sample", "motivated seller", "land book"] },
    { organizationId: orgId, type: "buyer", firstName: "Colin", lastName: "Reyes", email: "colin.reyes@example.com", phone: "(555) 211-2200", address: "18 Juniper Flat Rd", city: "Deming", state: "NM", zip: "88030", status: "active", source: SAMPLE_LEAD_SOURCE, tags: ["sample", "borrower", "current", "note book"] },
    { organizationId: orgId, type: "buyer", firstName: "Priscilla", lastName: "Odom", email: "priscilla.odom@example.com", phone: "(555) 212-3300", address: "902 Vista Ln", city: "El Paso", state: "TX", zip: "79901", status: "new", source: SAMPLE_LEAD_SOURCE, tags: ["sample", "terms buyer"] },
  ];

  const properties: SamplePropertyFixture[] = [
    { organizationId: orgId, apn: "SAMPLE-HY1-101", latitude: "32.8995", longitude: "-105.9603", legalDescription: "Tract 2, Sacramento Foothills", county: "Otero", state: "NM", address: "Route 6 Tract", city: "Alamogordo", zip: "88310", sizeAcres: "8.0", zoning: "Agricultural", terrain: "rolling", roadAccess: "gravel", status: "prospect", assessedValue: "12000", marketValue: "24000", purchasePrice: "0", listPrice: "0", description: "Sample — land-book prospect: 8-acre foothills tract, offer out to the seller.", highlights: ["Land book", "Offer out"], sellerLeadIndex: 0 },
    { organizationId: orgId, apn: "SAMPLE-HY2-202", latitude: "32.2687", longitude: "-107.7586", legalDescription: "Lot 4, Juniper Flat", county: "Luna", state: "NM", address: "18 Juniper Flat Rd", city: "Deming", zip: "88030", sizeAcres: "2.0", zoning: "Residential", terrain: "flat", roadAccess: "gravel", status: "owned", assessedValue: "6000", marketValue: "14000", purchasePrice: "5000", listPrice: "0", description: "Sample — note-book collateral: parcel conveyed on seller financing, borrower current.", highlights: ["Note book", "Performing collateral"], sellerLeadIndex: 1 },
  ];

  const deals: SampleDealFixture[] = [
    { organizationId: orgId, type: "acquisition", status: "negotiating", offerAmount: "17500", notes: "Sample land-book acquisition. Offered $17.5k on the 8-acre tract; seller countered $21k.", propertyIndex: 0 },
  ];

  const dCurrent = noteDates(10, 14);
  const notes: SampleNoteFixture[] = [
    { organizationId: orgId, originalPrincipal: "13900", currentBalance: "12300", interestRate: "9.9", termMonths: 72, monthlyPayment: "230.05", serviceFee: "0", lateFee: "25", gracePeriodDays: 10, ...dCurrent, status: "active", downPayment: "1390", downPaymentReceived: true, notes_text: "Sample note-book position. Seller-financed exit on the Deming lot, 10 payments in, borrower current.", atrExemptionCode: "business_purpose", propertyIndex: 1, borrowerLeadIndex: 1 },
  ];

  return { leads, properties, deals, notes };
}

/**
 * Residential wholesaler — motivated-seller lead flow + a cash-buyer list +
 * an assignment in flight. No notes (wholesalers flip contracts, not paper).
 */
function buildWholesalerFixtures(orgId: number): SampleFixtureSet {
  const leads: SampleLeadFixture[] = [
    { organizationId: orgId, type: "seller", firstName: "Carla", lastName: "Nguyen", email: "carla.nguyen@example.com", phone: "(555) 301-1010", address: "812 Harwood St", city: "Columbus", state: "OH", zip: "43201", status: "negotiating", source: SAMPLE_LEAD_SOURCE, tags: ["sample", "motivated seller", "pre-foreclosure"] },
    { organizationId: orgId, type: "seller", firstName: "Devon", lastName: "Brooks", email: "devon.brooks@example.com", phone: "(555) 302-2020", address: "55 Lakeview Ct", city: "Memphis", state: "TN", zip: "38103", status: "contacted", source: SAMPLE_LEAD_SOURCE, tags: ["sample", "motivated seller", "tired landlord"] },
    { organizationId: orgId, type: "buyer", firstName: "Anita", lastName: "Powell", email: "anita.powell@example.com", phone: "(555) 303-3030", address: "9001 Investor Row", city: "Atlanta", state: "GA", zip: "30303", status: "qualified", source: SAMPLE_LEAD_SOURCE, tags: ["sample", "cash buyer", "buyer list"] },
    { organizationId: orgId, type: "buyer", firstName: "Hector", lastName: "Vega", email: "hector.vega@example.com", phone: "(555) 304-4040", address: "210 Rehab Ave", city: "Atlanta", state: "GA", zip: "30310", status: "qualified", source: SAMPLE_LEAD_SOURCE, tags: ["sample", "cash buyer", "buyer list"] },
  ];

  const properties: SamplePropertyFixture[] = [
    { organizationId: orgId, apn: "SAMPLE-W01-441", latitude: "39.9900", longitude: "-82.9990", legalDescription: "Lot 9, Block 2, Harwood Addition", county: "Franklin", state: "OH", address: "812 Harwood St", city: "Columbus", zip: "43201", sizeAcres: "0.18", zoning: "Residential", terrain: "flat", roadAccess: "paved", status: "under_contract", assessedValue: "78000", marketValue: "135000", purchasePrice: "92000", listPrice: "104000", description: "Sample wholesale deal. 3/1 needing cosmetic rehab. Under contract at $92k, assigning to a cash buyer.", highlights: ["Under contract", "Assignment in flight", "ARV ~$165k"], sellerLeadIndex: 0 },
    { organizationId: orgId, apn: "SAMPLE-W02-552", latitude: "35.1421", longitude: "-90.0520", legalDescription: "Unit 4, Lakeview Court Condos", county: "Shelby", state: "TN", address: "55 Lakeview Ct", city: "Memphis", zip: "38103", sizeAcres: "0.05", zoning: "Residential", terrain: "flat", roadAccess: "paved", status: "lead", assessedValue: "61000", marketValue: "98000", purchasePrice: "0", listPrice: "0", description: "Sample lead. Tired-landlord condo, seller exploring a quick cash exit. Pre-offer.", highlights: ["Tired landlord", "Pre-offer"], sellerLeadIndex: 1 },
  ];

  const deals: SampleDealFixture[] = [
    { organizationId: orgId, type: "assignment", status: "in_escrow", offerAmount: "92000", acceptedAmount: "92000", notes: "Sample assignment. Locked at $92k, assigning to cash buyer at $104k — $12k assignment fee. EMD received.", propertyIndex: 0 },
    { organizationId: orgId, type: "acquisition", status: "negotiating", offerAmount: "58000", notes: "Sample offer out. Tired-landlord condo, countered at $66k. Working toward a contract-to-close.", propertyIndex: 1 },
  ];

  return { leads, properties, deals, notes: [] };
}

/**
 * Fix-and-flipper — acquisition + rehab + resale. Properties carry rehab
 * framing (ARV, holding cost); deals show an in-rehab and a listed resale.
 */
function buildFixAndFlipFixtures(orgId: number): SampleFixtureSet {
  const leads: SampleLeadFixture[] = [
    { organizationId: orgId, type: "seller", firstName: "Priya", lastName: "Raman", email: "priya.raman@example.com", phone: "(555) 401-7000", address: "330 Birchwood Dr", city: "Raleigh", state: "NC", zip: "27601", status: "negotiating", source: SAMPLE_LEAD_SOURCE, tags: ["sample", "motivated seller", "estate sale"] },
    { organizationId: orgId, type: "seller", firstName: "Owen", lastName: "Fletcher", email: "owen.fletcher@example.com", phone: "(555) 402-8000", address: "77 Magnolia St", city: "Charlotte", state: "NC", zip: "28202", status: "contacted", source: SAMPLE_LEAD_SOURCE, tags: ["sample", "motivated seller"] },
    { organizationId: orgId, type: "buyer", firstName: "Sasha", lastName: "Klein", email: "sasha.klein@example.com", phone: "(555) 403-9000", address: "12 Retail Buyer Ln", city: "Raleigh", state: "NC", zip: "27604", status: "qualified", source: SAMPLE_LEAD_SOURCE, tags: ["sample", "retail buyer"] },
  ];

  const properties: SamplePropertyFixture[] = [
    { organizationId: orgId, apn: "SAMPLE-F01-771", latitude: "35.7743", longitude: "-78.6336", legalDescription: "Lot 14, Birchwood Estates", county: "Wake", state: "NC", address: "330 Birchwood Dr", city: "Raleigh", zip: "27601", sizeAcres: "0.25", zoning: "Residential", terrain: "flat", roadAccess: "paved", status: "owned", assessedValue: "188000", marketValue: "245000", purchasePrice: "165000", listPrice: "0", description: "Sample flip mid-rehab. Bought at $165k, ~$38k rehab budget, ARV ~$285k. Kitchen + 2 baths in progress.", highlights: ["Mid-rehab", "ARV ~$285k", "Holding cost ~$1.4k/mo"], sellerLeadIndex: 0 },
    { organizationId: orgId, apn: "SAMPLE-F02-882", latitude: "35.2271", longitude: "-80.8431", legalDescription: "Lot 6, Magnolia Court", county: "Mecklenburg", state: "NC", address: "77 Magnolia St", city: "Charlotte", zip: "28202", sizeAcres: "0.21", zoning: "Residential", terrain: "flat", roadAccess: "paved", status: "listed", assessedValue: "210000", marketValue: "299000", purchasePrice: "182000", listPrice: "299000", description: "Sample completed flip, listed for resale. Rehab done, on market 11 days, 2 showings scheduled.", highlights: ["Rehab complete", "Listed for resale", "11 days on market"], sellerLeadIndex: 1 },
  ];

  const deals: SampleDealFixture[] = [
    { organizationId: orgId, type: "acquisition", status: "closed", offerAmount: "160000", acceptedAmount: "165000", notes: "Sample acquisition. Closed at $165k. Rehab scope locked at $38k. Target exit $285k.", propertyIndex: 0 },
    { organizationId: orgId, type: "disposition", status: "listed", offerAmount: "299000", notes: "Sample resale. Listed at $299k after a $41k rehab. Watching days-on-market against the $182k basis.", propertyIndex: 1 },
  ];

  return { leads, properties, deals, notes: [] };
}

/**
 * Buy-and-hold landlord — a small rental book: an owned cash-flowing SFR and
 * an acquisition prospect. Vocabulary: rent, cap rate. No notes.
 */
function buildBuyAndHoldFixtures(orgId: number): SampleFixtureSet {
  const leads: SampleLeadFixture[] = [
    { organizationId: orgId, type: "seller", firstName: "Pat", lastName: "Sullivan", email: "pat.sullivan@example.com", phone: "(555) 501-1000", address: "77 Maple Blvd", city: "Columbus", state: "OH", zip: "43201", status: "negotiating", source: SAMPLE_LEAD_SOURCE, tags: ["sample", "tired landlord", "SFR"] },
    { organizationId: orgId, type: "seller", firstName: "June", lastName: "Okafor", email: "june.okafor@example.com", phone: "(555) 502-2000", address: "410 Sycamore St", city: "Dayton", state: "OH", zip: "45402", status: "contacted", source: SAMPLE_LEAD_SOURCE, tags: ["sample", "duplex", "value-add"] },
  ];

  const properties: SamplePropertyFixture[] = [
    { organizationId: orgId, apn: "SAMPLE-BH1-611", latitude: "39.9750", longitude: "-83.0030", legalDescription: "Lot 3, Maple Grove Addition", county: "Franklin", state: "OH", address: "77 Maple Blvd", city: "Columbus", zip: "43201", sizeAcres: "0.17", zoning: "Residential", terrain: "flat", roadAccess: "paved", status: "owned", assessedValue: "112000", marketValue: "145000", purchasePrice: "118000", listPrice: "0", description: "Sample rental — owned SFR renting at $1,150/mo on the fixture rent roll; basis $118k.", highlights: ["Owned rental", "Rented $1,150/mo", "Long-term hold"], sellerLeadIndex: 0 },
    { organizationId: orgId, apn: "SAMPLE-BH2-622", latitude: "39.7589", longitude: "-84.1916", legalDescription: "Lot 11, Sycamore Row", county: "Montgomery", state: "OH", address: "410 Sycamore St", city: "Dayton", zip: "45402", sizeAcres: "0.15", zoning: "Residential", terrain: "flat", roadAccess: "paved", status: "prospect", assessedValue: "88000", marketValue: "132000", purchasePrice: "0", listPrice: "0", description: "Sample prospect — duplex with below-market fixture rents ($700 + $725); value-add on renewal.", highlights: ["Duplex", "Below-market rents", "Value-add"], sellerLeadIndex: 1 },
  ];

  const deals: SampleDealFixture[] = [
    { organizationId: orgId, type: "acquisition", status: "closed", offerAmount: "115000", acceptedAmount: "118000", notes: "Sample acquisition — closed the Maple Blvd SFR at $118k; rented within 3 weeks at $1,150/mo.", propertyIndex: 0 },
    { organizationId: orgId, type: "acquisition", status: "negotiating", offerAmount: "108000", notes: "Sample offer out — Dayton duplex at $108k; underwriting to a 7% cap on stabilized fixture rents.", propertyIndex: 1 },
  ];

  return { leads, properties, deals, notes: [] };
}

/**
 * Short-term rental operator — an owned cabin in service plus an acquisition
 * prospect from a tired host. Vocabulary: occupancy, nightly rate. No notes.
 */
function buildShortTermRentalFixtures(orgId: number): SampleFixtureSet {
  const leads: SampleLeadFixture[] = [
    { organizationId: orgId, type: "seller", firstName: "Heather", lastName: "Brooks", email: "heather.brooks@example.com", phone: "(555) 701-1000", address: "42 Lakefront Dr", city: "Gatlinburg", state: "TN", zip: "37738", status: "negotiating", source: SAMPLE_LEAD_SOURCE, tags: ["sample", "tired host", "STR"] },
    { organizationId: orgId, type: "seller", firstName: "Ray", lastName: "Delgado", email: "ray.delgado@example.com", phone: "(555) 702-2000", address: "8 Summit View Way", city: "Sevierville", state: "TN", zip: "37862", status: "contacted", source: SAMPLE_LEAD_SOURCE, tags: ["sample", "cabin", "off-market"] },
  ];

  const properties: SamplePropertyFixture[] = [
    { organizationId: orgId, apn: "SAMPLE-ST1-711", latitude: "35.7143", longitude: "-83.5102", legalDescription: "Lot 5, Lakefront Cabins", county: "Sevier", state: "TN", address: "42 Lakefront Dr", city: "Gatlinburg", zip: "37738", sizeAcres: "0.40", zoning: "Residential", terrain: "mountainous", roadAccess: "paved", status: "prospect", assessedValue: "310000", marketValue: "425000", purchasePrice: "0", listPrice: "0", description: "Sample STR prospect — 2/2 cabin from a burning-out host; fixture history shows ~82% occupancy at a $189 average nightly rate.", highlights: ["Tired host", "Turn-key listing", "Hot tub + view"], sellerLeadIndex: 0 },
    { organizationId: orgId, apn: "SAMPLE-ST2-722", latitude: "35.8681", longitude: "-83.5619", legalDescription: "Lot 2, Summit View", county: "Sevier", state: "TN", address: "8 Summit View Way", city: "Sevierville", zip: "37862", sizeAcres: "0.55", zoning: "Residential", terrain: "mountainous", roadAccess: "paved", status: "owned", assessedValue: "265000", marketValue: "360000", purchasePrice: "298000", listPrice: "0", description: "Sample STR in service — owned 3/2 cabin; fixture calendar shows 21 booked nights next month, cleaner turnover scheduled.", highlights: ["In service", "21 nights booked", "Self-managed"], sellerLeadIndex: 1 },
  ];

  const deals: SampleDealFixture[] = [
    { organizationId: orgId, type: "acquisition", status: "negotiating", offerAmount: "380000", notes: "Sample STR acquisition — offered $380k on the Lakefront cabin; underwriting on the host's actual booking history, not projections.", propertyIndex: 0 },
    { organizationId: orgId, type: "acquisition", status: "closed", offerAmount: "292000", acceptedAmount: "298000", notes: "Sample closed acquisition — Summit View cabin at $298k; furnished and listed within 6 weeks.", propertyIndex: 1 },
  ];

  return { leads, properties, deals, notes: [] };
}

/**
 * Commercial — an off-market NNN retail strip prospect and a retiring-owner
 * lead. Vocabulary: NNN, cap rate, tenants. No notes.
 */
function buildCommercialFixtures(orgId: number): SampleFixtureSet {
  const leads: SampleLeadFixture[] = [
    { organizationId: orgId, type: "seller", firstName: "Lynn", lastName: "Park", email: "lynn.park@example.com", phone: "(555) 601-1000", address: "1200 Commerce Pkwy", city: "Dallas", state: "TX", zip: "75201", status: "negotiating", source: SAMPLE_LEAD_SOURCE, tags: ["sample", "retiring owner", "NNN"] },
    { organizationId: orgId, type: "buyer", firstName: "Harold", lastName: "Simms", email: "harold.simms@example.com", phone: "(555) 602-2000", address: "300 Capital Ct", city: "Fort Worth", state: "TX", zip: "76102", status: "qualified", source: SAMPLE_LEAD_SOURCE, tags: ["sample", "1031 buyer"] },
  ];

  const properties: SamplePropertyFixture[] = [
    { organizationId: orgId, apn: "SAMPLE-C01-811", latitude: "32.7767", longitude: "-96.7970", legalDescription: "Tract 1, Commerce Park Addition", county: "Dallas", state: "TX", address: "1200 Commerce Pkwy", city: "Dallas", zip: "75201", sizeAcres: "1.10", zoning: "Commercial", terrain: "flat", roadAccess: "paved", status: "prospect", assessedValue: "1650000", marketValue: "2100000", purchasePrice: "0", listPrice: "0", description: "Sample commercial prospect — 3-tenant NNN retail strip; owner retiring, open to seller financing. Fixture rent roll implies an 8% cap at the offer price.", highlights: ["NNN", "3 tenants", "Seller-finance open"], sellerLeadIndex: 0 },
  ];

  const deals: SampleDealFixture[] = [
    { organizationId: orgId, type: "acquisition", status: "negotiating", offerAmount: "1850000", notes: "Sample commercial acquisition — offered $1.85M on the Commerce Pkwy strip; targeting an 8% cap on in-place NNN fixture leases.", propertyIndex: 0 },
  ];

  return { leads, properties, deals, notes: [] };
}

/**
 * Creative finance — subject-to / wrap / lease-option pipeline plus one
 * CARRIED note (the Close & Carry deal→note bridge is this vertical's center).
 */
function buildCreativeFinanceFixtures(orgId: number): SampleFixtureSet {
  const leads: SampleLeadFixture[] = [
    { organizationId: orgId, type: "seller", firstName: "Derek", lastName: "Nguyen", email: "derek.nguyen@example.com", phone: "(555) 801-1000", address: "1515 Sunset Blvd", city: "Orlando", state: "FL", zip: "32801", status: "negotiating", source: SAMPLE_LEAD_SOURCE, tags: ["sample", "pre-foreclosure", "subject-to candidate"] },
    { organizationId: orgId, type: "buyer", firstName: "Alisha", lastName: "Grant", email: "alisha.grant@example.com", phone: "(555) 802-2000", address: "77 Terms Ave", city: "Kissimmee", state: "FL", zip: "34741", status: "active", source: SAMPLE_LEAD_SOURCE, tags: ["sample", "borrower", "wrap buyer"] },
  ];

  const properties: SamplePropertyFixture[] = [
    { organizationId: orgId, apn: "SAMPLE-CF1-911", latitude: "28.5384", longitude: "-81.3789", legalDescription: "Lot 8, Sunset Park", county: "Orange", state: "FL", address: "1515 Sunset Blvd", city: "Orlando", zip: "32801", sizeAcres: "0.20", zoning: "Residential", terrain: "flat", roadAccess: "paved", status: "prospect", assessedValue: "255000", marketValue: "310000", purchasePrice: "0", listPrice: "0", description: "Sample subject-to prospect — seller 2 months behind; fixture terms: existing $245k mortgage at 3.5%, PITI $1,450/mo, ~$65k equity.", highlights: ["Subject-to candidate", "Pre-foreclosure", "Low-rate loan in place"], sellerLeadIndex: 0 },
    { organizationId: orgId, apn: "SAMPLE-CF2-922", latitude: "28.2920", longitude: "-81.4076", legalDescription: "Lot 3, Terms Grove", county: "Osceola", state: "FL", address: "77 Terms Ave", city: "Kissimmee", zip: "34741", sizeAcres: "0.18", zoning: "Residential", terrain: "flat", roadAccess: "paved", status: "owned", assessedValue: "198000", marketValue: "262000", purchasePrice: "205000", listPrice: "0", description: "Sample wrap collateral — sold on an owner-carry wrap; buyer 6 payments in and current.", highlights: ["Owner-carry wrap", "Performing"], sellerLeadIndex: 1 },
  ];

  const deals: SampleDealFixture[] = [
    { organizationId: orgId, type: "acquisition", status: "negotiating", offerAmount: "0", notes: "Sample subject-to — taking over the existing $245k @ 3.5% loan; seller keeps credit intact, no cash to seller beyond arrears cure.", propertyIndex: 0 },
    { organizationId: orgId, type: "disposition", status: "closed", offerAmount: "262000", acceptedAmount: "262000", notes: "Sample wrap exit — sold on owner-carry terms and carried the paper (see the serviced note in Finance).", propertyIndex: 1 },
  ];

  const dWrap = noteDates(6, 15);
  const notes: SampleNoteFixture[] = [
    { organizationId: orgId, originalPrincipal: "249000", currentBalance: "246800", interestRate: "7.5", termMonths: 360, monthlyPayment: "1741.02", serviceFee: "0", lateFee: "50", gracePeriodDays: 10, ...dWrap, status: "active", downPayment: "13000", downPaymentReceived: true, notes_text: "Sample carried wrap note — owner-carry exit on the Kissimmee house; buyer 6 payments in, current. Balloon review at year 5.", atrExemptionCode: "business_purpose", propertyIndex: 1, borrowerLeadIndex: 1 },
  ];

  return { leads, properties, deals, notes };
}

/**
 * Developer / builder — a parent tract under negotiation and a builder
 * lot-buyer lead. Vocabulary: entitlement, utilities, lots. No notes.
 */
function buildDeveloperFixtures(orgId: number): SampleFixtureSet {
  const leads: SampleLeadFixture[] = [
    { organizationId: orgId, type: "seller", firstName: "Margaret", lastName: "Ellis", email: "margaret.ellis@example.com", phone: "(555) 901-1000", address: "Hwy 290 Tract", city: "Dripping Springs", state: "TX", zip: "78620", status: "negotiating", source: SAMPLE_LEAD_SOURCE, tags: ["sample", "subdividable", "utilities available"] },
    { organizationId: orgId, type: "buyer", firstName: "Tom", lastName: "Barrera", email: "tom.barrera@example.com", phone: "(555) 902-2000", address: "14 Builder Row", city: "Austin", state: "TX", zip: "78704", status: "qualified", source: SAMPLE_LEAD_SOURCE, tags: ["sample", "lot buyer", "builder"] },
  ];

  const properties: SamplePropertyFixture[] = [
    { organizationId: orgId, apn: "SAMPLE-D01-131", latitude: "30.1902", longitude: "-98.0867", legalDescription: "20-acre tract, Hwy 290 frontage", county: "Hays", state: "TX", address: "Hwy 290 Tract", city: "Dripping Springs", zip: "78620", sizeAcres: "20.0", zoning: "Residential", terrain: "rolling", roadAccess: "paved", status: "prospect", assessedValue: "520000", marketValue: "800000", purchasePrice: "0", listPrice: "0", description: "Sample development prospect — 20-acre tract zoned residential, city water at the road; fixture pro-forma: 40 half-acre lots.", highlights: ["Hwy frontage", "City water at road", "Zoned residential"], sellerLeadIndex: 0 },
  ];

  const deals: SampleDealFixture[] = [
    { organizationId: orgId, type: "acquisition", status: "negotiating", offerAmount: "650000", notes: "Sample development acquisition — offered $650k on the 20-acre tract; fixture pro-forma shows 40 half-acre lots at ~$45k retail.", propertyIndex: 0 },
  ];

  return { leads, properties, deals, notes: [] };
}

/**
 * Subdivider — a parent parcel owned mid-split (plat submitted) plus the
 * first lot in escrow. Vocabulary: plat, phase, lots. No notes.
 */
function buildSubdividerFixtures(orgId: number): SampleFixtureSet {
  const leads: SampleLeadFixture[] = [
    { organizationId: orgId, type: "seller", firstName: "Nora", lastName: "Whitfield", email: "nora.whitfield@example.com", phone: "(555) 121-1000", address: "CR 220 Parent Tract", city: "Burnet", state: "TX", zip: "78611", status: "closed", source: SAMPLE_LEAD_SOURCE, tags: ["sample", "parent parcel seller"] },
    { organizationId: orgId, type: "buyer", firstName: "Felix", lastName: "Amado", email: "felix.amado@example.com", phone: "(555) 122-2000", address: "6 Lot Buyer Ln", city: "Marble Falls", state: "TX", zip: "78654", status: "qualified", source: SAMPLE_LEAD_SOURCE, tags: ["sample", "lot buyer"] },
  ];

  const properties: SamplePropertyFixture[] = [
    { organizationId: orgId, apn: "SAMPLE-SD1-141", latitude: "30.7582", longitude: "-98.2284", legalDescription: "Parent tract, CR 220 (plat pending)", county: "Burnet", state: "TX", address: "CR 220 Parent Tract", city: "Burnet", zip: "78611", sizeAcres: "12.0", zoning: "Agricultural", terrain: "rolling", roadAccess: "gravel", status: "owned", assessedValue: "96000", marketValue: "180000", purchasePrice: "105000", listPrice: "0", description: "Sample parent parcel — 12 acres mid-split into 6 two-acre lots; preliminary plat submitted to the county, survey complete.", highlights: ["Plat submitted", "6-lot split", "Survey complete"], sellerLeadIndex: 0 },
    { organizationId: orgId, apn: "SAMPLE-SD2-142", latitude: "30.7601", longitude: "-98.2251", legalDescription: "Lot 1 of pending plat, CR 220", county: "Burnet", state: "TX", address: "Lot 1, CR 220", city: "Burnet", zip: "78611", sizeAcres: "2.0", zoning: "Residential", terrain: "rolling", roadAccess: "gravel", status: "under_contract", assessedValue: "16000", marketValue: "42000", purchasePrice: "17500", listPrice: "44900", description: "Sample first lot — Lot 1 of the split, under contract to a lot buyer contingent on plat recording.", highlights: ["Lot 1", "Contingent on recording"], sellerLeadIndex: 0 },
  ];

  const deals: SampleDealFixture[] = [
    { organizationId: orgId, type: "acquisition", status: "closed", offerAmount: "98000", acceptedAmount: "105000", notes: "Sample parent-tract acquisition — closed at $105k; fixture split economics: 6 lots at ~$45k retail against ~$38k of road + survey + plat cost.", propertyIndex: 0 },
    { organizationId: orgId, type: "disposition", status: "in_escrow", offerAmount: "44900", acceptedAmount: "43500", notes: "Sample lot sale — Lot 1 in escrow at $43.5k, closing contingent on the plat recording.", propertyIndex: 1 },
  ];

  return { leads, properties, deals, notes: [] };
}

/**
 * Tax lien / deed — a certificate on the redemption clock and a deed held
 * pending quiet title. Vocabulary: redemption, auction, quiet title. No notes.
 */
function buildTaxLienDeedFixtures(orgId: number): SampleFixtureSet {
  const leads: SampleLeadFixture[] = [
    { organizationId: orgId, type: "seller", firstName: "Roy", lastName: "Watkins", email: "roy.watkins@example.com", phone: "(555) 131-1000", address: "8800 County Rd 12", city: "Ocala", state: "FL", zip: "34470", status: "contacted", source: SAMPLE_LEAD_SOURCE, tags: ["sample", "delinquent owner", "redemption window"] },
    { organizationId: orgId, type: "buyer", firstName: "Selma", lastName: "Ortiz", email: "selma.ortiz@example.com", phone: "(555) 132-2000", address: "41 Exit Buyer Rd", city: "Gainesville", state: "FL", zip: "32601", status: "qualified", source: SAMPLE_LEAD_SOURCE, tags: ["sample", "cash buyer", "post-quiet-title exit"] },
  ];

  const properties: SamplePropertyFixture[] = [
    { organizationId: orgId, apn: "SAMPLE-TX1-151", latitude: "29.1992", longitude: "-82.1401", legalDescription: "Parcel 12, County Rd 12", county: "Marion", state: "FL", address: "8800 County Rd 12", city: "Ocala", zip: "34470", sizeAcres: "1.50", zoning: "Residential", terrain: "flat", roadAccess: "gravel", status: "prospect", assessedValue: "38000", marketValue: "55000", purchasePrice: "0", listPrice: "0", description: "Sample tax-certificate position — cert bought at auction for $3,100; owner inside the redemption window at the fixture statutory rate.", highlights: ["Certificate held", "Redemption clock running"], sellerLeadIndex: 0 },
    { organizationId: orgId, apn: "SAMPLE-TX2-152", latitude: "29.6516", longitude: "-82.3248", legalDescription: "Lot 4, Pine Hollow", county: "Alachua", state: "FL", address: "220 Pine Hollow Rd", city: "Gainesville", zip: "32601", sizeAcres: "0.90", zoning: "Residential", terrain: "flat", roadAccess: "paved", status: "owned", assessedValue: "31000", marketValue: "48000", purchasePrice: "5200", listPrice: "0", description: "Sample tax deed held — deed acquired at auction for $5,200; quiet-title action filed, exit blocked until it clears.", highlights: ["Deed held", "Quiet title filed"], sellerLeadIndex: 0 },
  ];

  const deals: SampleDealFixture[] = [
    { organizationId: orgId, type: "acquisition", status: "closed", offerAmount: "5200", acceptedAmount: "5200", notes: "Sample tax-deed acquisition — won at auction for $5,200 against a $48k fixture market value; quiet title filed, $2.5k legal budget.", propertyIndex: 1 },
    { organizationId: orgId, type: "disposition", status: "negotiating", offerAmount: "39000", notes: "Sample exit in waiting — cash buyer offering $39k on the Pine Hollow deed, contingent on quiet title clearing.", propertyIndex: 1 },
  ];

  return { leads, properties, deals, notes: [] };
}

/**
 * Multifamily — a 12-unit value-add prospect from a retiring owner.
 * Vocabulary: units, NOI, cap rate. No notes.
 */
function buildMultifamilyFixtures(orgId: number): SampleFixtureSet {
  const leads: SampleLeadFixture[] = [
    { organizationId: orgId, type: "seller", firstName: "Gloria", lastName: "Reeves", email: "gloria.reeves@example.com", phone: "(555) 141-1000", address: "2200 Park Ave", city: "Kansas City", state: "MO", zip: "64108", status: "negotiating", source: SAMPLE_LEAD_SOURCE, tags: ["sample", "retiring owner", "12 units"] },
    { organizationId: orgId, type: "seller", firstName: "Stan", lastName: "Hubbard", email: "stan.hubbard@example.com", phone: "(555) 142-2000", address: "615 Quincy St", city: "Topeka", state: "KS", zip: "66603", status: "contacted", source: SAMPLE_LEAD_SOURCE, tags: ["sample", "8 units", "deferred maintenance"] },
  ];

  const properties: SamplePropertyFixture[] = [
    { organizationId: orgId, apn: "SAMPLE-MF1-161", latitude: "39.0842", longitude: "-94.5800", legalDescription: "Lots 5-6, Park Avenue Addition", county: "Jackson", state: "MO", address: "2200 Park Ave", city: "Kansas City", zip: "64108", sizeAcres: "0.45", zoning: "Multifamily", terrain: "flat", roadAccess: "paved", status: "prospect", assessedValue: "740000", marketValue: "960000", purchasePrice: "0", listPrice: "0", description: "Sample multifamily prospect — 12 units, below-market rents; fixture underwriting: current NOI $62k, stabilized $96k after unit turns.", highlights: ["12 units", "Value-add", "Below-market rents"], sellerLeadIndex: 0 },
  ];

  const deals: SampleDealFixture[] = [
    { organizationId: orgId, type: "acquisition", status: "negotiating", offerAmount: "820000", notes: "Sample multifamily acquisition — offered $820k on the 12-unit; fixture underwriting targets a 7.2% cap on stabilized NOI after renovating 6 units.", propertyIndex: 0 },
  ];

  return { leads, properties, deals, notes: [] };
}

/**
 * Mobile home / park — a park acquisition prospect plus one park-owned home
 * sold on payments (a small carried note is idiomatic for this vertical).
 */
function buildMobileHomeFixtures(orgId: number): SampleFixtureSet {
  const leads: SampleLeadFixture[] = [
    { organizationId: orgId, type: "seller", firstName: "Earl", lastName: "Dixon", email: "earl.dixon@example.com", phone: "(555) 151-1000", address: "Pine Ridge MHP", city: "Fayetteville", state: "NC", zip: "28301", status: "negotiating", source: SAMPLE_LEAD_SOURCE, tags: ["sample", "retiring park owner", "25 lots"] },
    { organizationId: orgId, type: "buyer", firstName: "Wanda", lastName: "Pruitt", email: "wanda.pruitt@example.com", phone: "(555) 152-2000", address: "Lot 14, Pine Ridge MHP", city: "Fayetteville", state: "NC", zip: "28301", status: "active", source: SAMPLE_LEAD_SOURCE, tags: ["sample", "borrower", "home buyer"] },
  ];

  const properties: SamplePropertyFixture[] = [
    { organizationId: orgId, apn: "SAMPLE-MH1-171", latitude: "35.0527", longitude: "-78.8784", legalDescription: "Pine Ridge MHP, 25 lots", county: "Cumberland", state: "NC", address: "Pine Ridge MHP", city: "Fayetteville", zip: "28301", sizeAcres: "6.50", zoning: "Manufactured Housing", terrain: "flat", roadAccess: "paved", status: "prospect", assessedValue: "480000", marketValue: "625000", purchasePrice: "0", listPrice: "0", description: "Sample park prospect — 25 lots, 20 occupied at $350/lot fixture rent on city water/sewer; fixture gross $7k/mo.", highlights: ["25 lots", "80% occupancy", "City water/sewer"], sellerLeadIndex: 0 },
    { organizationId: orgId, apn: "SAMPLE-MH2-172", latitude: "35.0533", longitude: "-78.8771", legalDescription: "1998 single-wide, Lot 14, Pine Ridge MHP", county: "Cumberland", state: "NC", address: "Lot 14, Pine Ridge MHP", city: "Fayetteville", zip: "28301", sizeAcres: "0.10", zoning: "Manufactured Housing", terrain: "flat", roadAccess: "paved", status: "owned", assessedValue: "14000", marketValue: "28000", purchasePrice: "11000", listPrice: "0", description: "Sample park-owned home — 1998 single-wide sold on payments to the lot-14 resident; buyer current.", highlights: ["Sold on payments", "Performing"], sellerLeadIndex: 0 },
  ];

  const deals: SampleDealFixture[] = [
    { organizationId: orgId, type: "acquisition", status: "negotiating", offerAmount: "500000", notes: "Sample park acquisition — offered $500k on Pine Ridge (25 lots, 20 occupied); fixture upside is filling the 5 vacant lots.", propertyIndex: 0 },
  ];

  const dHome = noteDates(7, 10);
  const notes: SampleNoteFixture[] = [
    { organizationId: orgId, originalPrincipal: "24500", currentBalance: "22900", interestRate: "10.0", termMonths: 84, monthlyPayment: "406.71", serviceFee: "0", lateFee: "25", gracePeriodDays: 10, ...dHome, status: "active", downPayment: "2450", downPaymentReceived: true, notes_text: "Sample home note — 1998 single-wide on Lot 14 sold on payments; buyer 7 payments in and current.", atrExemptionCode: "business_purpose", propertyIndex: 1, borrowerLeadIndex: 1 },
  ];

  return { leads, properties, deals, notes };
}

/**
 * Agent-investor — an expired-listing seller, an investor-buyer client, and a
 * deal that could list OR join the own book. Vocabulary: listing, ARV. No notes.
 */
function buildAgentInvestorFixtures(orgId: number): SampleFixtureSet {
  const leads: SampleLeadFixture[] = [
    { organizationId: orgId, type: "seller", firstName: "Tamara", lastName: "Wells", email: "tamara.wells@example.com", phone: "(555) 161-1000", address: "900 Cherry Ln", city: "Raleigh", state: "NC", zip: "27601", status: "negotiating", source: SAMPLE_LEAD_SOURCE, tags: ["sample", "expired listing", "motivated"] },
    { organizationId: orgId, type: "buyer", firstName: "Jason", lastName: "Park", email: "jason.park@example.com", phone: "(555) 162-2000", address: "220 Investor Way", city: "Raleigh", state: "NC", zip: "27602", status: "qualified", source: SAMPLE_LEAD_SOURCE, tags: ["sample", "investor client", "cash buyer"] },
  ];

  const properties: SamplePropertyFixture[] = [
    { organizationId: orgId, apn: "SAMPLE-AG1-181", latitude: "35.7796", longitude: "-78.6382", legalDescription: "Lot 22, Cherry Lane Addition", county: "Wake", state: "NC", address: "900 Cherry Ln", city: "Raleigh", zip: "27601", sizeAcres: "0.22", zoning: "Residential", terrain: "flat", roadAccess: "paved", status: "prospect", assessedValue: "236000", marketValue: "285000", purchasePrice: "0", listPrice: "0", description: "Sample dual-track prospect — listing expired after 90 days; fixture math: buy at $255k for the own book (ARV ~$310k) or re-list with a new plan.", highlights: ["Expired listing", "List-or-buy decision", "ARV ~$310k"], sellerLeadIndex: 0 },
  ];

  const deals: SampleDealFixture[] = [
    { organizationId: orgId, type: "acquisition", status: "negotiating", offerAmount: "255000", notes: "Sample own-book offer — $255k on the expired listing; fallback is a re-list agreement if the seller declines.", propertyIndex: 0 },
  ];

  return { leads, properties, deals, notes: [] };
}

/**
 * Dispatch to the right builder for each of the 15 registered business types
 * (shared/business-types.ts BUSINESS_TYPE_IDS). Unknown / future ids fall
 * back to the land flipper set (never blank, never mismatched).
 */
export function buildSampleFixtures(
  orgId: number,
  businessType: string,
): SampleFixtureSet {
  switch (businessType) {
    case "note_investor":
      return buildNoteInvestorFixtures(orgId);
    case "hybrid":
      return buildHybridFixtures(orgId);
    case "residential_wholesaler":
      return buildWholesalerFixtures(orgId);
    case "fix_and_flip":
      return buildFixAndFlipFixtures(orgId);
    case "buy_and_hold":
      return buildBuyAndHoldFixtures(orgId);
    case "short_term_rental":
      return buildShortTermRentalFixtures(orgId);
    case "commercial":
      return buildCommercialFixtures(orgId);
    case "creative_finance":
      return buildCreativeFinanceFixtures(orgId);
    case "developer":
      return buildDeveloperFixtures(orgId);
    case "subdivider":
      return buildSubdividerFixtures(orgId);
    case "tax_lien_deed":
      return buildTaxLienDeedFixtures(orgId);
    case "multifamily":
      return buildMultifamilyFixtures(orgId);
    case "mobile_home":
      return buildMobileHomeFixtures(orgId);
    case "agent_investor":
      return buildAgentInvestorFixtures(orgId);
    case "land_flipper":
    default:
      return buildLandFlipperFixtures(orgId);
  }
}

// ───────────────────────────────────────────────────────────────────────────
// The service contract
// ───────────────────────────────────────────────────────────────────────────

function toNumericOrgId(orgId: string | number): number {
  const id = Number(orgId);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error(`Invalid organization id: ${orgId}`);
  }
  return id;
}

function isSampleLead(lead: { source?: string | null }): boolean {
  return lead.source === SAMPLE_LEAD_SOURCE;
}

function isSampleProperty(prop: { apn?: string | null }): boolean {
  return prop.apn?.startsWith(SAMPLE_APN_PREFIX) ?? false;
}

/** Current sample-row counts for an org (marker-based, storage-backed). */
async function findSampleRows(id: number): Promise<{
  leads: number;
  properties: number;
  deals: number;
  notes: number;
  samplePropertyIds: number[];
  sampleLeadIds: number[];
}> {
  const [allLeads, allProperties] = await Promise.all([
    storage.getLeads(id),
    storage.getProperties(id),
  ]);
  const sampleLeadIds = allLeads.filter(isSampleLead).map((l: { id: number }) => l.id);
  const samplePropertyIds = allProperties
    .filter(isSampleProperty)
    .map((p: { id: number }) => p.id);

  let deals = 0;
  let notes = 0;
  if (samplePropertyIds.length > 0) {
    const idSet = new Set(samplePropertyIds);
    const [allDeals, allNotes] = await Promise.all([
      storage.getDeals(id),
      storage.getNotes(id),
    ]);
    deals = allDeals.filter(
      (d: { propertyId?: number | null }) => d.propertyId != null && idSet.has(d.propertyId),
    ).length;
    notes = allNotes.filter(
      (n: { propertyId?: number | null }) => n.propertyId != null && idSet.has(n.propertyId),
    ).length;
  }

  return {
    leads: sampleLeadIds.length,
    properties: samplePropertyIds.length,
    deals,
    notes,
    samplePropertyIds,
    sampleLeadIds,
  };
}

/**
 * Seed the tailored sample set for an org's business type. Idempotent: if any
 * marker rows already exist (lead source="sample_data" or property apn
 * "SAMPLE-*"), returns `{ seeded: false }` with the CURRENT sample counts and
 * creates nothing.
 */
export async function seedSampleDataForOrg(
  orgId: string,
  businessType: string,
  opts?: { userId?: string },
): Promise<{ seeded: boolean; counts: Record<string, number> }> {
  const id = toNumericOrgId(orgId);
  const org = await storage.getOrganization(id);
  if (!org) {
    throw new Error("Organization not found");
  }

  const existing = await findSampleRows(id);
  if (existing.leads > 0 || existing.properties > 0) {
    logger.info("[sampleSeeder] Sample data already present; skipping seed", {
      metadata: {
        orgId: id,
        businessType,
        userId: opts?.userId,
        existing: { leads: existing.leads, properties: existing.properties },
      },
    });
    return {
      seeded: false,
      counts: {
        leads: existing.leads,
        properties: existing.properties,
        deals: existing.deals,
        notes: existing.notes,
      },
    };
  }

  const fixtures = buildSampleFixtures(id, businessType);

  // Create leads first; properties/deals/notes resolve their relations by
  // index against the just-created rows so FKs are always valid.
  const createdLeads: Array<{ id: number }> = [];
  for (const leadData of fixtures.leads) {
    createdLeads.push(await storage.createLead(leadData as any));
  }

  const createdProperties: Array<{ id: number }> = [];
  for (const propSpec of fixtures.properties) {
    const { sellerLeadIndex, ...propData } = propSpec;
    const property = await storage.createProperty({
      ...propData,
      sellerId: sellerLeadIndex != null ? createdLeads[sellerLeadIndex]?.id : undefined,
    } as any);
    createdProperties.push(property);
  }

  let dealsCreated = 0;
  for (const dealSpec of fixtures.deals) {
    const { propertyIndex, ...dealData } = dealSpec;
    const propertyId = propertyIndex != null ? createdProperties[propertyIndex]?.id : undefined;
    if (propertyIndex != null && propertyId == null) continue;
    await storage.createDeal({ ...dealData, propertyId } as any);
    dealsCreated++;
  }

  let notesCreated = 0;
  for (const noteSpec of fixtures.notes) {
    const { propertyIndex, borrowerLeadIndex, ...noteData } = noteSpec;
    const propertyId = propertyIndex != null ? createdProperties[propertyIndex]?.id : undefined;
    const borrowerId = borrowerLeadIndex != null ? createdLeads[borrowerLeadIndex]?.id : undefined;
    if (propertyIndex != null && propertyId == null) continue;
    await storage.createNote({ ...noteData, propertyId, borrowerId } as any);
    notesCreated++;
  }

  // Mark sample data loaded on the org (same flag the legacy flow set).
  const currentData = (org.onboardingData as Record<string, unknown>) || {};
  await storage.updateOrganization(id, {
    onboardingData: { ...currentData, sampleDataLoaded: true } as any,
  });

  const counts = {
    leads: createdLeads.length,
    properties: createdProperties.length,
    deals: dealsCreated,
    notes: notesCreated,
  };
  logger.info("[sampleSeeder] Seeded sample data", {
    metadata: { orgId: id, businessType, userId: opts?.userId, counts },
  });
  return { seeded: true, counts };
}

/**
 * Remove exactly what seeding created, nothing else: leads with
 * source="sample_data", properties with a "SAMPLE-" apn, and (via DB cascade
 * on property delete — the same mechanism the legacy clear flow relied on)
 * the deals and notes attached to those sample properties. Counts of
 * cascaded deals/notes are measured before deletion so the report is honest.
 */
export async function clearSampleDataForOrg(
  orgId: string,
): Promise<{ cleared: Record<string, number> }> {
  const id = toNumericOrgId(orgId);
  const org = await storage.getOrganization(id);
  if (!org) {
    throw new Error("Organization not found");
  }

  const existing = await findSampleRows(id);

  for (const leadId of existing.sampleLeadIds) {
    await storage.deleteLead(leadId, id);
  }
  for (const propertyId of existing.samplePropertyIds) {
    await storage.deleteProperty(propertyId, id);
  }

  const currentData = (org.onboardingData as Record<string, unknown>) || {};
  await storage.updateOrganization(id, {
    onboardingData: { ...currentData, sampleDataLoaded: false } as any,
  });

  const cleared = {
    leads: existing.leads,
    properties: existing.properties,
    deals: existing.deals,
    notes: existing.notes,
  };
  logger.info("[sampleSeeder] Cleared sample data", { metadata: { orgId: id, cleared } });
  return { cleared };
}
