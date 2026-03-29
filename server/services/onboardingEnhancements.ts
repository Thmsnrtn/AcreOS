// @ts-nocheck
/**
 * Onboarding Enhancements — Items 1-15
 * Auto-detect investor type, sample leads, import converters, progressive profile, etc.
 */

import { db } from "../db";
import { leads, organizations } from "@shared/schema";
import { eq } from "drizzle-orm";

// Item 1: Auto-detect investor type from email domain
export function detectInvestorType(email: string): string {
  const domain = email.split("@")[1]?.toLowerCase() || "";
  const corpDomains = ["llc", "investments", "capital", "realty", "properties", "holdings", "group", "partners"];
  if (corpDomains.some(d => domain.includes(d))) return "experienced_investor";
  const devDomains = ["gmail.com", "yahoo.com", "hotmail.com", "outlook.com"];
  if (devDomains.includes(domain)) return "individual";
  return "unknown";
}

// Item 2: Pre-populate sample leads
export async function seedSampleLeads(orgId: number): Promise<number> {
  const existing = await db.select({ id: leads.id }).from(leads).where(eq(leads.organizationId, orgId)).limit(1);
  if (existing.length > 0) return 0; // Already has leads

  const samples = [
    { firstName: "Sample", lastName: "Lead A", status: "new", source: "sample", county: "Travis", state: "TX" },
    { firstName: "Sample", lastName: "Lead B", status: "new", source: "sample", county: "Maricopa", state: "AZ" },
    { firstName: "Sample", lastName: "Lead C", status: "new", source: "sample", county: "Polk", state: "FL" },
  ];

  for (const s of samples) {
    await db.insert(leads).values({ organizationId: orgId, ...s } as any);
  }
  return samples.length;
}

// Item 9: Universal spreadsheet mapper — AI column detection
export function detectColumnMapping(headers: string[]): Record<string, string> {
  const mappings: Record<string, string[]> = {
    firstName: ["first name", "first", "fname", "owner first", "first_name"],
    lastName: ["last name", "last", "lname", "owner last", "last_name", "owner name"],
    email: ["email", "e-mail", "email address", "contact email"],
    phone: ["phone", "telephone", "cell", "mobile", "phone number", "phone_number"],
    address: ["address", "property address", "street", "mailing address", "site address"],
    city: ["city", "town"],
    state: ["state", "st"],
    zip: ["zip", "zipcode", "zip code", "postal"],
    county: ["county"],
    apn: ["apn", "parcel", "parcel number", "parcel id", "parcel_number", "pin"],
    acreage: ["acreage", "acres", "lot size", "size", "area"],
    askingPrice: ["price", "asking price", "asking", "list price", "value", "amount"],
  };

  const result: Record<string, string> = {};
  for (const header of headers) {
    const lower = header.toLowerCase().trim();
    for (const [field, aliases] of Object.entries(mappings)) {
      if (aliases.includes(lower) || aliases.some(a => lower.includes(a))) {
        result[header] = field;
        break;
      }
    }
  }
  return result;
}

// Item 3 & 4: Pebble/REsimpli CSV format detection
export function detectCsvFormat(headers: string[]): "pebble" | "resimpli" | "generic" {
  const headerSet = new Set(headers.map(h => h.toLowerCase().trim()));
  if (headerSet.has("pebble_id") || headerSet.has("pebble id")) return "pebble";
  if (headerSet.has("resimpli_id") || headerSet.has("resimpli id") || headerSet.has("list_stacking_tags")) return "resimpli";
  return "generic";
}

// Item 10: Progressive profile prompts
export function getNextProfilePrompt(profile: any): { field: string; question: string } | null {
  if (!profile?.targetCounties?.length) return { field: "targetCounties", question: "Which counties are you targeting for land deals?" };
  if (!profile?.investmentGoal) return { field: "investmentGoal", question: "What's your monthly passive income goal?" };
  if (!profile?.experienceLevel) return { field: "experienceLevel", question: "How many land deals have you closed?" };
  if (!profile?.preferredStrategy) return { field: "preferredStrategy", question: "What's your primary strategy? (wholesale, buy-hold, seller-finance, subdivide)" };
  return null;
}

// Item 12: Suggest starter counties based on state
export function suggestStarterCounties(state: string): Array<{ county: string; state: string; reason: string }> {
  const suggestions: Record<string, Array<{ county: string; reason: string }>> = {
    TX: [
      { county: "Hudspeth", reason: "High volume, low competition" },
      { county: "Culberson", reason: "Affordable entry point" },
      { county: "Loving", reason: "Small market, quick turns" },
    ],
    FL: [
      { county: "Polk", reason: "Active market, good margins" },
      { county: "Highlands", reason: "Steady demand" },
      { county: "Charlotte", reason: "Growing area" },
    ],
    AZ: [
      { county: "Mohave", reason: "High deal volume" },
      { county: "Cochise", reason: "Affordable parcels" },
      { county: "La Paz", reason: "Low competition" },
    ],
    NM: [
      { county: "Luna", reason: "Consistent inventory" },
      { county: "Torrance", reason: "Growing interest" },
      { county: "Otero", reason: "Good margins" },
    ],
  };
  const stateSuggestions = suggestions[state.toUpperCase()];
  if (stateSuggestions) return stateSuggestions.map(s => ({ ...s, state }));
  return [
    { county: "Hudspeth", state: "TX", reason: "Popular starting county" },
    { county: "Mohave", state: "AZ", reason: "Active market" },
    { county: "Polk", state: "FL", reason: "Good for beginners" },
  ];
}

// Item 15: Timezone detection
export function detectTimezone(offsetMinutes: number): string {
  const offsets: Record<number, string> = {
    300: "America/New_York", 360: "America/Chicago",
    420: "America/Denver", 480: "America/Los_Angeles",
    540: "America/Anchorage", 600: "Pacific/Honolulu",
  };
  return offsets[offsetMinutes] || "America/Chicago";
}
