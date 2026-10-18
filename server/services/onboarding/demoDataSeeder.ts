/**
 * Settings → "Add Demo Data" (POST /api/seed-demo-data).
 *
 * Every row this creates carries the SAME sample marker the onboarding sample
 * book uses (./sampleSeeder.ts, read by ./sampleFilters.ts):
 *   - leads:      source = SAMPLE_LEAD_SOURCE ("sample_data") and a "sample" tag;
 *   - properties: apn starts with SAMPLE_APN_PREFIX ("SAMPLE-"), description
 *                 starts with "Sample";
 *   - deals and notes hang only off those properties, so `realDeal()` /
 *     `realNote()` exclude them.
 *
 * Before W5b's audit these rows were UNMARKED: the two closed acquisitions
 * below counted as real closings in the customer outcome metric (Finance) and
 * in the founder Letter's cross-customer aggregate, and the six leads counted
 * toward the first-deal program. A demo row presented as a customer's outcome
 * is fabrication. Anything that measures what the customer did must not see
 * these rows — and now cannot, because the shared predicates key on the marker.
 *
 * Every figure is a fixed, labelled fixture value.
 */
import { storage } from "../../storage";
import { addMonths } from "../../utils/dateUtils";
import { clock } from "../../utils/clock";
import type { InsertDeal, InsertLead, InsertProperty } from "@shared/schema";
import { SAMPLE_APN_PREFIX, SAMPLE_LEAD_SOURCE } from "./sampleSeeder";

type DemoLead = Omit<InsertLead, "source" | "tags">;

const DEMO_LEAD_FIXTURES: DemoLead[] = [
  { firstName: "John", lastName: "Martinez", type: "seller", email: "john.martinez@email.com", phone: "(602) 555-1234", address: "123 Desert Rose Lane", city: "Tucson", state: "AZ", zip: "85701", status: "responded", notes: "Sample — inherited property, motivated to sell" },
  { firstName: "Sarah", lastName: "Thompson", type: "seller", email: "sarah.t@email.com", phone: "(505) 555-2345", address: "456 Canyon View Dr", city: "Albuquerque", state: "NM", zip: "87101", status: "negotiating", notes: "Sample — moving out of state, needs quick close" },
  { firstName: "Robert", lastName: "Chen", type: "buyer", email: "rchen@email.com", phone: "(512) 555-3456", address: "789 Oak Street", city: "Austin", state: "TX", zip: "78701", status: "qualified", notes: "Sample — looking for 5-10 acre recreational parcels" },
  { firstName: "Maria", lastName: "Garcia", type: "seller", email: "mgarcia@email.com", phone: "(623) 555-4567", address: "321 Sunset Blvd", city: "Phoenix", state: "AZ", zip: "85001", status: "mailed", notes: "Sample — initial mailer sent 2 weeks ago" },
  { firstName: "David", lastName: "Wilson", type: "buyer", email: "dwilson@email.com", phone: "(702) 555-5678", address: "555 Palm Way", city: "Las Vegas", state: "NV", zip: "89101", status: "interested", notes: "Sample — pre-approved for $50K, wants AZ or NM" },
  { firstName: "Jennifer", lastName: "Brown", type: "seller", email: "jbrown@email.com", phone: "(480) 555-6789", address: "888 Cactus Court", city: "Scottsdale", state: "AZ", zip: "85251", status: "new", notes: "Sample — responded to online ad" },
];

const DEMO_PROPERTY_FIXTURES: InsertProperty[] = [
  { apn: "123-45-678", county: "Cochise", state: "AZ", sizeAcres: "5.2", status: "owned", purchasePrice: "8500", marketValue: "15000", description: "Beautiful 5+ acre parcel with mountain views near Willcox" },
  { apn: "234-56-789", county: "Mohave", state: "AZ", sizeAcres: "2.5", status: "listed", purchasePrice: "3200", listPrice: "7900", marketValue: "7500", description: "2.5 acre lot in Golden Valley with road access" },
  { apn: "345-67-890", county: "Luna", state: "NM", sizeAcres: "10.0", status: "owned", purchasePrice: "5000", marketValue: "12000", description: "10 acres of open desert land near Deming" },
  { apn: "456-78-901", county: "Navajo", state: "AZ", sizeAcres: "1.25", status: "prospect", assessedValue: "4500", marketValue: "6000", description: "1.25 acre residential lot in Show Low area" },
  { apn: "567-89-012", county: "Pinal", state: "AZ", sizeAcres: "40.0", status: "under_contract", purchasePrice: "28000", marketValue: "55000", description: "40 acre ranch parcel with well and power nearby" },
];

/** The rows as inserted — markers applied. */
const DEMO_LEADS: ReadonlyArray<Omit<InsertLead, "organizationId">> = DEMO_LEAD_FIXTURES.map((l) => ({
  ...l,
  source: SAMPLE_LEAD_SOURCE,
  tags: ["sample"],
}));

const DEMO_PROPERTIES: ReadonlyArray<InsertProperty> = DEMO_PROPERTY_FIXTURES.map((p) => ({
  ...p,
  apn: `${SAMPLE_APN_PREFIX}${p.apn}`,
  description: `Sample — ${p.description}`,
}));

export async function seedDemoDataForOrg(organizationId: number): Promise<{ leads: number; properties: number; deals: number; notes: number }> {
  let leadCount = 0;
  for (const lead of DEMO_LEADS) {
    const leadInput: InsertLead & { organizationId: number } = { ...lead, organizationId };
    await storage.createLead(leadInput);
    leadCount++;
  }

  const createdProperties = [];
  for (const prop of DEMO_PROPERTIES) {
    const propInput: InsertProperty & { organizationId: number } = { ...prop, organizationId };
    createdProperties.push(await storage.createProperty(propInput));
  }

  // The deals table has no name/stage/salePrice/purchasePrice/leadId columns —
  // stage→status, purchase/sale price→offerAmount (the amount struck at).
  const demoDeals = [
    { type: "acquisition", status: "closed", propertyId: createdProperties[0]?.id, offerAmount: "8500", closingDate: new Date("2024-06-15"), notes: "Sample deal" },
    { type: "disposition", status: "in_escrow", propertyId: createdProperties[1]?.id, offerAmount: "7900", closingDate: new Date("2025-02-01"), notes: "Sample deal" },
    { type: "acquisition", status: "closed", propertyId: createdProperties[2]?.id, offerAmount: "5000", closingDate: new Date("2024-09-20"), notes: "Sample deal" },
    { type: "acquisition", status: "offer_sent", propertyId: createdProperties[4]?.id, offerAmount: "28000", notes: "Sample deal" },
  ];
  for (const deal of demoDeals) {
    if (deal.propertyId == null) continue;
    const dealInput: InsertDeal & { organizationId: number } = { ...deal, propertyId: deal.propertyId, organizationId };
    await storage.createDeal(dealInput, undefined, { source: "sample_fixture" });
  }

  // Sample notes (seller financing)
  const startDate = addMonths(clock.now(), -3);
  const firstPaymentDate = addMonths(new Date(startDate), 1);
  const demoNotes = [
    {
      propertyId: createdProperties[0]?.id,
      borrowerName: "Michael Rodriguez",
      borrowerEmail: "mrodriguez@email.com",
      borrowerPhone: "(520) 555-7890",
      originalPrincipal: "12000",
      currentBalance: "10800",
      interestRate: "9.9",
      termMonths: 36,
      monthlyPayment: "387.50",
      downPayment: "3000",
      startDate,
      firstPaymentDate,
      status: "active",
      gracePeriodDays: 10,
      lateFee: "25",
    },
    {
      propertyId: createdProperties[2]?.id,
      borrowerName: "Amanda Foster",
      borrowerEmail: "afoster@email.com",
      borrowerPhone: "(575) 555-8901",
      originalPrincipal: "8500",
      currentBalance: "7700",
      interestRate: "10.5",
      termMonths: 24,
      monthlyPayment: "395.00",
      downPayment: "2000",
      startDate: new Date(clock.nowMs() - 60 * 24 * 60 * 60 * 1000),
      firstPaymentDate: new Date(clock.nowMs() - 30 * 24 * 60 * 60 * 1000),
      status: "active",
      gracePeriodDays: 10,
      lateFee: "25",
    },
  ];
  for (const note of demoNotes) {
    // Reg-Z §1026.43 hard gate (Workstream A). Demo data is synthetic /
    // non-consumer — flagged exempt so the gate constraint doesn't reject
    // the seed insert. Real consumer originations must go through
    // POST /api/notes/:id/originate with a full ATR determination.
    await storage.createNote({
      ...note,
      organizationId,
      atrExemptionCode: "business_purpose",
    } as any);
  }

  return { leads: leadCount, properties: createdProperties.length, deals: demoDeals.length, notes: demoNotes.length };
}
