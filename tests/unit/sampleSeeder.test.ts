/**
 * Consolidated sample-data seeder (server/services/onboarding/sampleSeeder.ts).
 *
 * Locks in the contract the onboarding rebuild converges on:
 *   1. ALL 15 registered business types (shared/business-types.ts) get a
 *      tailored fixture set — no persona lands in a blank or mismatched set.
 *   2. Marker convention: every lead source="sample_data" + "sample" tag;
 *      every property apn "SAMPLE-*"; deals/notes attach only to sample
 *      properties. Same markers the legacy demo-clear flow keyed on.
 *   3. IDEMPOTENT: seeding twice never duplicates — the second call reports
 *      seeded:false with the existing counts.
 *   4. CLEARABLE: clearSampleDataForOrg removes exactly what seeding created
 *      and nothing else (real customer rows survive).
 *   5. No fabricated values: fixed fixture figures, valid continental-US
 *      coordinates (the Map door filters out coordinate-less parcels).
 *
 * Storage is fully mocked in-memory (this environment has no DATABASE_URL);
 * deleteProperty emulates the DB's ON DELETE CASCADE for deals/notes, which
 * is the same mechanism the production clear path relies on.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../server/db", () => ({ db: {} }));
vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

interface Row {
  id: number;
  organizationId: number;
  [key: string]: unknown;
}

const mem = vi.hoisted(() => ({
  nextId: 1,
  orgs: new Map<number, Record<string, unknown>>(),
  leads: [] as Row[],
  properties: [] as Row[],
  deals: [] as Row[],
  notes: [] as Row[],
}));

vi.mock("../../server/storage", () => {
  const storage = {
    async getOrganization(id: number) {
      return mem.orgs.get(id);
    },
    async updateOrganization(id: number, updates: Record<string, unknown>) {
      const org = mem.orgs.get(id);
      if (!org) throw new Error("Organization not found");
      Object.assign(org, updates);
      return org;
    },
    async getLeads(orgId: number) {
      return mem.leads.filter((l) => l.organizationId === orgId);
    },
    async createLead(lead: Record<string, unknown>) {
      const row = { id: mem.nextId++, ...lead } as Row;
      mem.leads.push(row);
      return row;
    },
    async deleteLead(id: number, orgId?: number) {
      mem.leads = mem.leads.filter(
        (l) => !(l.id === id && (orgId == null || l.organizationId === orgId)),
      );
    },
    async getProperties(orgId: number) {
      return mem.properties.filter((p) => p.organizationId === orgId);
    },
    async createProperty(property: Record<string, unknown>) {
      const row = { id: mem.nextId++, ...property } as Row;
      mem.properties.push(row);
      return row;
    },
    async deleteProperty(id: number, orgId?: number) {
      const target = mem.properties.find(
        (p) => p.id === id && (orgId == null || p.organizationId === orgId),
      );
      if (!target) return;
      mem.properties = mem.properties.filter((p) => p !== target);
      // Emulate DB ON DELETE CASCADE — the mechanism the clear path relies on.
      mem.deals = mem.deals.filter((d) => d.propertyId !== id);
      mem.notes = mem.notes.filter((n) => n.propertyId !== id);
    },
    async getDeals(orgId: number) {
      return mem.deals.filter((d) => d.organizationId === orgId);
    },
    async createDeal(deal: Record<string, unknown>) {
      const row = { id: mem.nextId++, ...deal } as Row;
      mem.deals.push(row);
      return row;
    },
    async getNotes(orgId: number) {
      return mem.notes.filter((n) => n.organizationId === orgId);
    },
    async createNote(note: Record<string, unknown>) {
      const row = { id: mem.nextId++, ...note } as Row;
      mem.notes.push(row);
      return row;
    },
    async deleteNote(id: number, orgId?: number) {
      mem.notes = mem.notes.filter(
        (n) => !(n.id === id && (orgId == null || n.organizationId === orgId)),
      );
    },
  };
  return { storage };
});

import {
  seedSampleDataForOrg,
  clearSampleDataForOrg,
  buildSampleFixtures,
  SAMPLE_LEAD_SOURCE,
  SAMPLE_APN_PREFIX,
} from "../../server/services/onboarding/sampleSeeder";
import { BUSINESS_TYPE_IDS } from "../../shared/business-types";

const ORG = 7;

function resetMem() {
  mem.nextId = 1;
  mem.orgs.clear();
  mem.leads = [];
  mem.properties = [];
  mem.deals = [];
  mem.notes = [];
  mem.orgs.set(ORG, { id: ORG, onboardingData: {} });
}

beforeEach(resetMem);

describe("seedSampleDataForOrg — all 15 registered business types", () => {
  for (const businessType of BUSINESS_TYPE_IDS) {
    it(`'${businessType}': seeds a marked, tailored, coordinate-carrying set`, async () => {
      const result = await seedSampleDataForOrg(String(ORG), businessType);
      expect(result.seeded).toBe(true);
      expect(result.counts.leads).toBeGreaterThan(0);
      expect(result.counts.properties).toBeGreaterThan(0);
      expect(result.counts.deals).toBeGreaterThan(0);

      // Reported counts match what actually landed in storage.
      expect(mem.leads.length).toBe(result.counts.leads);
      expect(mem.properties.length).toBe(result.counts.properties);
      expect(mem.deals.length).toBe(result.counts.deals);
      expect(mem.notes.length).toBe(result.counts.notes);

      // Marker convention — same one the legacy demo-clear flow keys on.
      for (const lead of mem.leads) {
        expect(lead.source).toBe(SAMPLE_LEAD_SOURCE);
        expect(lead.tags as string[]).toContain("sample");
        expect(lead.organizationId).toBe(ORG);
      }
      const propIds = new Set<number>();
      for (const prop of mem.properties) {
        expect(String(prop.apn).startsWith(SAMPLE_APN_PREFIX)).toBe(true);
        expect(String(prop.description).startsWith("Sample")).toBe(true);
        propIds.add(prop.id);
        // Continental-US coordinate sanity (Map door filters out
        // coordinate-less parcels; catches swapped lat/lng and 0,0).
        const lat = Number(prop.latitude);
        const lng = Number(prop.longitude);
        expect(lat).toBeGreaterThan(24);
        expect(lat).toBeLessThan(50);
        expect(lng).toBeGreaterThan(-125);
        expect(lng).toBeLessThan(-66);
      }
      // Deals/notes carry no flag column — they MUST anchor to a sample
      // property (that is how the clear path cascades them away) and label
      // themselves in free text.
      for (const deal of mem.deals) {
        expect(propIds.has(deal.propertyId as number)).toBe(true);
        expect(String(deal.notes).startsWith("Sample")).toBe(true);
      }
      for (const note of mem.notes) {
        expect(propIds.has(note.propertyId as number)).toBe(true);
        expect(String(note.notes_text).startsWith("Sample")).toBe(true);
        expect(note.atrExemptionCode).toBe("business_purpose");
      }

      // Org flag set (parity with the legacy flow).
      const org = mem.orgs.get(ORG)!;
      expect((org.onboardingData as Record<string, unknown>).sampleDataLoaded).toBe(true);
    });
  }

  it("every business type gets a DEDICATED builder (no two types share the same apn set), except the deliberate land fallback", () => {
    const apnSets = new Map<string, string>();
    for (const businessType of BUSINESS_TYPE_IDS) {
      const f = buildSampleFixtures(ORG, businessType);
      const key = f.properties.map((p) => p.apn).join("|");
      const prior = apnSets.get(key);
      // land_flipper is the canonical set; nothing else may collide with it
      // or with each other.
      expect(prior, `${businessType} shares fixtures with ${prior}`).toBeUndefined();
      apnSets.set(key, businessType);
    }
  });
});

describe("seedSampleDataForOrg — idempotency", () => {
  it("seeding twice never duplicates; second call reports existing counts", async () => {
    const first = await seedSampleDataForOrg(String(ORG), "note_investor");
    expect(first.seeded).toBe(true);
    const snapshot = {
      leads: mem.leads.length,
      properties: mem.properties.length,
      deals: mem.deals.length,
      notes: mem.notes.length,
    };

    const second = await seedSampleDataForOrg(String(ORG), "note_investor");
    expect(second.seeded).toBe(false);
    expect(second.counts).toEqual(first.counts);
    expect(mem.leads.length).toBe(snapshot.leads);
    expect(mem.properties.length).toBe(snapshot.properties);
    expect(mem.deals.length).toBe(snapshot.deals);
    expect(mem.notes.length).toBe(snapshot.notes);
  });

  it("skips even when the business type differs on the second call (markers, not memory, are the guard)", async () => {
    await seedSampleDataForOrg(String(ORG), "land_flipper");
    const before = mem.properties.map((p) => p.apn);
    const again = await seedSampleDataForOrg(String(ORG), "fix_and_flip");
    expect(again.seeded).toBe(false);
    expect(mem.properties.map((p) => p.apn)).toEqual(before);
  });
});

describe("clearSampleDataForOrg — removes exactly what seeding created", () => {
  it("clears the full sample set and reports honest counts, leaving real rows untouched", async () => {
    // Real (non-sample) customer rows that must survive.
    const realLead = await (await import("../../server/storage")).storage.createLead({
      organizationId: ORG,
      firstName: "Real",
      lastName: "Customer",
      source: "website",
      tags: [],
    });
    const realProp = await (await import("../../server/storage")).storage.createProperty({
      organizationId: ORG,
      apn: "123-45-678",
      description: "A real customer parcel",
    });
    await (await import("../../server/storage")).storage.createDeal({
      organizationId: ORG,
      propertyId: realProp.id,
      notes: "A real customer deal",
    });

    const seeded = await seedSampleDataForOrg(String(ORG), "creative_finance");
    expect(seeded.seeded).toBe(true);

    const { cleared } = await clearSampleDataForOrg(String(ORG));
    expect(cleared).toEqual(seeded.counts);

    // Everything sample is gone; everything real survives.
    expect(mem.leads.map((l) => l.id)).toEqual([realLead.id]);
    expect(mem.properties.map((p) => p.id)).toEqual([realProp.id]);
    expect(mem.deals.length).toBe(1);
    expect(mem.deals[0].notes).toBe("A real customer deal");
    expect(mem.notes.length).toBe(0);
    expect(
      (mem.orgs.get(ORG)!.onboardingData as Record<string, unknown>).sampleDataLoaded,
    ).toBe(false);
  });

  it("clearing an org with no sample data is a safe no-op reporting zeros", async () => {
    const { cleared } = await clearSampleDataForOrg(String(ORG));
    expect(cleared).toEqual({ leads: 0, properties: 0, deals: 0, notes: 0 });
  });

  it("seed → clear → seed works again (fully re-seedable)", async () => {
    const first = await seedSampleDataForOrg(String(ORG), "subdivider");
    await clearSampleDataForOrg(String(ORG));
    const again = await seedSampleDataForOrg(String(ORG), "subdivider");
    expect(again.seeded).toBe(true);
    expect(again.counts).toEqual(first.counts);
  });
});

describe("alignment with the legacy demo-clear flow", () => {
  it("uses exactly the markers the shipped clear endpoint keys on", () => {
    // The legacy flow (DELETE /api/onboarding/sample-data → clearSampleData)
    // filters leads on source === "sample_data" and properties on
    // apn.startsWith("SAMPLE-"). These constants ARE that convention.
    expect(SAMPLE_LEAD_SOURCE).toBe("sample_data");
    expect(SAMPLE_APN_PREFIX).toBe("SAMPLE-");
  });

  it("no seeded lead ever masquerades under a real acquisition source (the old completeOnboarding bug)", () => {
    for (const businessType of BUSINESS_TYPE_IDS) {
      const f = buildSampleFixtures(ORG, businessType);
      for (const lead of f.leads) {
        expect(lead.source).toBe(SAMPLE_LEAD_SOURCE);
        expect(["direct_mail", "cold_call", "referral", "expired_listing"]).not.toContain(
          lead.source,
        );
      }
    }
  });
});

describe("per-business-type shaping", () => {
  const noteExpectations: Record<string, number> = {
    land_flipper: 1,
    note_investor: 3,
    hybrid: 1,
    creative_finance: 1,
    mobile_home: 1,
    residential_wholesaler: 0,
    fix_and_flip: 0,
    buy_and_hold: 0,
    short_term_rental: 0,
    commercial: 0,
    developer: 0,
    subdivider: 0,
    tax_lien_deed: 0,
    multifamily: 0,
    agent_investor: 0,
  };

  it("note books appear only where the vertical genuinely carries paper", () => {
    for (const businessType of BUSINESS_TYPE_IDS) {
      const f = buildSampleFixtures(ORG, businessType);
      expect(f.notes.length, businessType).toBe(noteExpectations[businessType]);
    }
  });

  it("wholesaler ships an assignment; subdivider a lot sale; tax vertical a quiet-title-bound exit", () => {
    expect(buildSampleFixtures(ORG, "residential_wholesaler").deals.map((d) => d.type)).toContain(
      "assignment",
    );
    const sub = buildSampleFixtures(ORG, "subdivider");
    expect(sub.deals.some((d) => d.type === "disposition" && d.status === "in_escrow")).toBe(true);
    const tax = buildSampleFixtures(ORG, "tax_lien_deed");
    expect(tax.deals.some((d) => d.notes.toLowerCase().includes("quiet title"))).toBe(true);
  });

  it("unknown / future business types fall back to the land flipper set (never blank)", () => {
    const fallback = buildSampleFixtures(ORG, "some_future_vertical");
    const land = buildSampleFixtures(ORG, "land_flipper");
    expect(fallback.properties.map((p) => p.apn)).toEqual(land.properties.map((p) => p.apn));
  });

  it("no fabricated values: every monetary field is a fixed finite string", () => {
    for (const businessType of BUSINESS_TYPE_IDS) {
      const f = buildSampleFixtures(ORG, businessType);
      for (const p of f.properties) {
        for (const field of [p.assessedValue, p.marketValue, p.purchasePrice, p.listPrice]) {
          expect(typeof field).toBe("string");
          expect(Number.isFinite(Number(field)), `${businessType} ${p.apn}`).toBe(true);
        }
      }
      for (const n of f.notes) {
        expect(Number.isFinite(Number(n.currentBalance))).toBe(true);
        expect(Number.isFinite(Number(n.monthlyPayment))).toBe(true);
      }
    }
  });
});

describe("input validation", () => {
  it("rejects a non-numeric org id", async () => {
    await expect(seedSampleDataForOrg("not-an-id", "land_flipper")).rejects.toThrow(
      /Invalid organization id/,
    );
    await expect(clearSampleDataForOrg("not-an-id")).rejects.toThrow(/Invalid organization id/);
  });

  it("rejects a missing organization", async () => {
    await expect(seedSampleDataForOrg("999", "land_flipper")).rejects.toThrow(
      /Organization not found/,
    );
    await expect(clearSampleDataForOrg("999")).rejects.toThrow(/Organization not found/);
  });
});
