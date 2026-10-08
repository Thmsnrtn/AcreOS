/**
 * Multi-Tenant Isolation Simulation
 *
 * Security-focused simulation that creates 2 orgs and verifies complete isolation.
 * Tests every CRUD endpoint for every core entity with cross-org attempts.
 *
 * Covers Persona 3 (Enterprise Elaine) territory + cross-tenant security.
 */

import { describe, it, expect, beforeAll } from "vitest";
import {
  assertSession,
  createAuthenticatedSession,
  apiCall,
  assertOrgIsolation,
  type AuthSession,
} from "./helpers";

/**
 * A list body as an array. A shape this does not recognise throws: reading it
 * as an empty list would make every "no leaked ids" assertion below true.
 */
function listOf(body: any, key: string): any[] {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.[key])) return body[key];
  if (Array.isArray(body?.data)) return body.data;
  throw new Error(`[sim] unrecognised list shape (no array, no "${key}"): ${JSON.stringify(body).slice(0, 120)}`);
}

describe("Multi-Tenant Isolation — Security Simulation", () => {
  let orgA: AuthSession; // Elaine (pro tier)
  let orgB: AuthSession; // Fiona (sprout tier)

  // Entity IDs created by Org A
  const orgAEntities: Record<string, number[]> = {
    leads: [],
    deals: [],
    properties: [],
    notes: [],
    campaigns: [],
  };

  beforeAll(async () => {
    try {
      orgA = await createAuthenticatedSession("enterpriseManager");
      orgB = await createAuthenticatedSession("firstTimer");
    } catch (err) {
      // Rethrown, not warned: an isolation suite that could not sign in two
      // tenants has checked nothing, and every test below would read as a pass.
      throw err;
    }
  }, 30_000);

  // ── Seed Org A with entities ───────────────────────────────────────────

  describe("Seed Org A entities", () => {
    it("creates leads for Org A", async () => {
      assertSession(orgA);

      for (let i = 0; i < 3; i++) {
        const res = await apiCall("POST", "/api/leads", {
          firstName: `Elaine`,
          lastName: `Lead${i}`,
          email: `elaine-lead-${i}@sim-test.com`,
          status: "new",
        }, orgA);

        if (res.status === 201 || res.status === 200) {
          const id = res.body.id ?? res.body.leadId;
          if (id) orgAEntities.leads.push(id);
        }

        expect(res.status).toBeLessThan(500);
      }
    });

    it("creates deals for Org A", async () => {
      assertSession(orgA);

      // A deal belongs to a property, so each one gets its own.
      for (let i = 0; i < 2; i++) {
        const prop = await apiCall("POST", "/api/properties", {
          apn: `SIM-ELAINE-DEAL-${i}-${Date.now()}`,
          address: `${200 + i} Elaine Way`,
          county: "Mohave",
          state: "AZ",
          sizeAcres: "10",
        }, orgA);
        expect([200, 201], `property for deal ${i} answered ${prop.status}`).toContain(prop.status);

        const res = await apiCall("POST", "/api/deals", {
          propertyId: prop.body.id,
          type: "acquisition",
          status: "negotiation",
          offerAmount: String(10000 + i * 5000),
        }, orgA);

        // A seed that fails must fail here, not leave the isolation checks
        // below with nothing to probe.
        expect([200, 201], `deal ${i} answered ${res.status}`).toContain(res.status);
        orgAEntities.deals.push(res.body.id ?? res.body.dealId);
      }
    });

    it("creates properties for Org A", async () => {
      assertSession(orgA);

      const res = await apiCall("POST", "/api/properties", {
        apn: `SIM-ELAINE-${Date.now()}`,
        address: "100 Elaine Blvd",
        county: "Mohave",
        state: "AZ",
        sizeAcres: "40",
      }, orgA);

      expect([200, 201], `property creation answered ${res.status}`).toContain(res.status);
      orgAEntities.properties.push(res.body.id ?? res.body.propertyId);
    });

    it("creates notes for Org A", async () => {
      assertSession(orgA);

      const res = await apiCall("POST", "/api/notes", {
        borrowerName: "Elaine Borrower",
        borrowerEmail: "elaine-borrower@sim-test.com",
        // Decimal dollars as strings; the server computes the payment.
        originalPrincipal: "30000.00",
        currentBalance: "30000.00",
        interestRate: "9.00",
        termMonths: 60,
        startDate: "2026-01-01",
      }, orgA);

      expect([200, 201], `note creation answered ${res.status}`).toContain(res.status);
      orgAEntities.notes.push(res.body.id ?? res.body.noteId);
    });

    it("creates campaigns for Org A", async () => {
      assertSession(orgA);

      const res = await apiCall("POST", "/api/campaigns", {
        name: "Elaine's Secret Campaign",
        type: "direct_mail",
        status: "draft",
      }, orgA);

      if (res.status === 201 || res.status === 200) {
        const id = res.body.id ?? res.body.campaignId;
        if (id) orgAEntities.campaigns.push(id);
      }

      expect(res.status).toBeLessThan(500);
    });
  });

  // ── Cross-org READ isolation ───────────────────────────────────────────

  describe("Org B cannot READ Org A's entities", () => {
    it("Org B cannot read Org A's leads", async () => {
      assertSession(orgA);
      assertSession(orgB);
      expect(orgAEntities.leads.length, "Org A has no leads to probe — its seed step created none").toBeGreaterThan(0);

      for (const id of orgAEntities.leads) {
        const res = await apiCall("GET", `/api/leads/${id}`, undefined, orgB);
        expect([403, 404]).toContain(res.status);
      }
    });

    it("Org B cannot read Org A's deals", async () => {
      assertSession(orgA);
      assertSession(orgB);
      expect(orgAEntities.deals.length, "Org A has no deals to probe — its seed step created none").toBeGreaterThan(0);

      for (const id of orgAEntities.deals) {
        const res = await apiCall("GET", `/api/deals/${id}`, undefined, orgB);
        expect([403, 404]).toContain(res.status);
      }
    });

    it("Org B cannot read Org A's properties", async () => {
      assertSession(orgA);
      assertSession(orgB);
      expect(orgAEntities.properties.length, "Org A has no properties to probe — its seed step created none").toBeGreaterThan(0);

      for (const id of orgAEntities.properties) {
        const res = await apiCall("GET", `/api/properties/${id}`, undefined, orgB);
        expect([403, 404]).toContain(res.status);
      }
    });

    it("Org B cannot read Org A's notes", async () => {
      assertSession(orgA);
      assertSession(orgB);
      expect(orgAEntities.notes.length, "Org A has no notes to probe — its seed step created none").toBeGreaterThan(0);

      for (const id of orgAEntities.notes) {
        const res = await apiCall("GET", `/api/notes/${id}`, undefined, orgB);
        expect([403, 404]).toContain(res.status);
      }
    });

    it("Org B cannot read Org A's campaigns", async () => {
      assertSession(orgA);
      assertSession(orgB);
      expect(orgAEntities.campaigns.length, "Org A has no campaigns to probe — its seed step created none").toBeGreaterThan(0);

      for (const id of orgAEntities.campaigns) {
        const res = await apiCall("GET", `/api/campaigns/${id}`, undefined, orgB);
        expect([403, 404]).toContain(res.status);
      }
    });
  });

  // ── Cross-org UPDATE isolation ─────────────────────────────────────────

  describe("Org B cannot UPDATE Org A's entities", () => {
    it("Org B cannot update Org A's leads", async () => {
      assertSession(orgA);
      assertSession(orgB);
      expect(orgAEntities.leads.length, "Org A has no leads to probe — its seed step created none").toBeGreaterThan(0);

      const id = orgAEntities.leads[0];
      const res = await apiCall("PUT", `/api/leads/${id}`, {
        firstName: "Hacked",
      }, orgB);

      expect([403, 404]).toContain(res.status);

      // Verify Org A's lead was NOT modified
      const verifyRes = await apiCall("GET", `/api/leads/${id}`, undefined, orgA);
      if (verifyRes.status === 200) {
        expect(verifyRes.body.firstName).not.toBe("Hacked");
      }
    });

    it("Org B cannot update Org A's deals", async () => {
      assertSession(orgA);
      assertSession(orgB);
      expect(orgAEntities.deals.length, "Org A has no deals to probe — its seed step created none").toBeGreaterThan(0);

      const id = orgAEntities.deals[0];
      const res = await apiCall("PUT", `/api/deals/${id}`, {
        name: "Hacked Deal",
      }, orgB);

      expect([403, 404]).toContain(res.status);
    });

    it("Org B cannot update Org A's properties", async () => {
      assertSession(orgA);
      assertSession(orgB);
      expect(orgAEntities.properties.length, "Org A has no properties to probe — its seed step created none").toBeGreaterThan(0);

      const id = orgAEntities.properties[0];
      const res = await apiCall("PUT", `/api/properties/${id}`, {
        address: "Hacked Address",
      }, orgB);

      expect([403, 404]).toContain(res.status);
    });

    it("Org B cannot update Org A's notes", async () => {
      assertSession(orgA);
      assertSession(orgB);
      expect(orgAEntities.notes.length, "Org A has no notes to probe — its seed step created none").toBeGreaterThan(0);

      const id = orgAEntities.notes[0];
      const res = await apiCall("PUT", `/api/notes/${id}`, {
        borrowerName: "Hacked Borrower",
      }, orgB);

      expect([403, 404]).toContain(res.status);
    });
  });

  // ── Cross-org DELETE isolation ─────────────────────────────────────────

  describe("Org B cannot DELETE Org A's entities", () => {
    it("Org B cannot delete Org A's leads", async () => {
      assertSession(orgA);
      assertSession(orgB);
      expect(orgAEntities.leads.length, "Org A has no leads to probe — its seed step created none").toBeGreaterThan(0);

      const id = orgAEntities.leads[0];
      const res = await apiCall("DELETE", `/api/leads/${id}`, undefined, orgB);

      expect([403, 404]).toContain(res.status);

      // Verify lead still exists for Org A
      const verifyRes = await apiCall("GET", `/api/leads/${id}`, undefined, orgA);
      expect(verifyRes.status).toBe(200);
    });

    it("Org B cannot delete Org A's deals", async () => {
      assertSession(orgA);
      assertSession(orgB);
      expect(orgAEntities.deals.length, "Org A has no deals to probe — its seed step created none").toBeGreaterThan(0);

      const id = orgAEntities.deals[0];
      const res = await apiCall("DELETE", `/api/deals/${id}`, undefined, orgB);

      expect([403, 404]).toContain(res.status);
    });

    it("Org B cannot delete Org A's properties", async () => {
      assertSession(orgA);
      assertSession(orgB);
      expect(orgAEntities.properties.length, "Org A has no properties to probe — its seed step created none").toBeGreaterThan(0);

      const id = orgAEntities.properties[0];
      const res = await apiCall("DELETE", `/api/properties/${id}`, undefined, orgB);

      expect([403, 404]).toContain(res.status);
    });
  });

  // ── Org list isolation ─────────────────────────────────────────────────

  describe("Org B's list endpoints don't leak Org A data", () => {
    it("Org B's lead list does not contain Org A's leads", async () => {
      assertSession(orgA);
      assertSession(orgB);

      const res = await apiCall("GET", "/api/leads", undefined, orgB);
      expect(res.status, "Org B could not read its own list, so nothing was checked").toBe(200);

      const leads = listOf(res.body, "leads");
      const leakedIds = leads
        .map((l: any) => l.id)
        .filter((id: number) => orgAEntities.leads.includes(id));

      expect(leakedIds).toHaveLength(0);
    });

    it("Org B's deal list does not contain Org A's deals", async () => {
      assertSession(orgA);
      assertSession(orgB);

      const res = await apiCall("GET", "/api/deals", undefined, orgB);
      expect(res.status, "Org B could not read its own list, so nothing was checked").toBe(200);

      const deals = listOf(res.body, "deals");
      const leakedIds = deals
        .map((d: any) => d.id)
        .filter((id: number) => orgAEntities.deals.includes(id));

      expect(leakedIds).toHaveLength(0);
    });

    it("Org B's notes list does not contain Org A's notes", async () => {
      assertSession(orgA);
      assertSession(orgB);

      const res = await apiCall("GET", "/api/notes", undefined, orgB);
      expect(res.status, "Org B could not read its own list, so nothing was checked").toBe(200);

      const notes = listOf(res.body, "notes");
      const leakedIds = notes
        .map((n: any) => n.id)
        .filter((id: number) => orgAEntities.notes.includes(id));

      expect(leakedIds).toHaveLength(0);
    });

    it("Org B's campaign list does not contain Org A's campaigns", async () => {
      assertSession(orgA);
      assertSession(orgB);

      const res = await apiCall("GET", "/api/campaigns", undefined, orgB);
      expect(res.status, "Org B could not read its own list, so nothing was checked").toBe(200);

      const campaigns = listOf(res.body, "campaigns");
      const leakedIds = campaigns
        .map((c: any) => c.id)
        .filter((id: number) => orgAEntities.campaigns.includes(id));

      expect(leakedIds).toHaveLength(0);
    });
  });

  // ── Full isolation assertion using helper ──────────────────────────────

  describe("Full CRUD isolation via assertOrgIsolation helper", () => {
    it("leads are fully isolated", async () => {
      assertSession(orgA);
      assertSession(orgB);
      expect(orgAEntities.leads.length, "Org A has no leads to probe — its seed step created none").toBeGreaterThan(0);

      const violations = await assertOrgIsolation(
        orgA,
        orgB,
        "leads",
        orgAEntities.leads[0],
      );

      expect(violations).toHaveLength(0);
    });

    it("deals are fully isolated", async () => {
      assertSession(orgA);
      assertSession(orgB);
      expect(orgAEntities.deals.length, "Org A has no deals to probe — its seed step created none").toBeGreaterThan(0);

      const violations = await assertOrgIsolation(
        orgA,
        orgB,
        "deals",
        orgAEntities.deals[0],
      );

      expect(violations).toHaveLength(0);
    });

    it("properties are fully isolated", async () => {
      assertSession(orgA);
      assertSession(orgB);
      expect(orgAEntities.properties.length, "Org A has no properties to probe — its seed step created none").toBeGreaterThan(0);

      const violations = await assertOrgIsolation(
        orgA,
        orgB,
        "properties",
        orgAEntities.properties[0],
      );

      expect(violations).toHaveLength(0);
    });

    it("notes are fully isolated", async () => {
      assertSession(orgA);
      assertSession(orgB);
      expect(orgAEntities.notes.length, "Org A has no notes to probe — its seed step created none").toBeGreaterThan(0);

      const violations = await assertOrgIsolation(
        orgA,
        orgB,
        "notes",
        orgAEntities.notes[0],
      );

      expect(violations).toHaveLength(0);
    });
  });

  // ── Billing / subscription independence ────────────────────────────────

  describe("Billing state independence", () => {
    it("Org A and Org B have independent subscription data", async () => {
      assertSession(orgA);
      assertSession(orgB);

      const orgAUser = await apiCall("GET", "/api/auth/user", undefined, orgA);
      const orgBUser = await apiCall("GET", "/api/auth/user", undefined, orgB);

      expect(orgAUser.status).toBeLessThan(500);
      expect(orgBUser.status).toBeLessThan(500);

      // They should be different users and different orgs. The org ids come
      // from the sessions (GET /api/organization); /api/auth/user carries no
      // organization id, so reading it there compared undefined to undefined
      // and the assertion never ran.
      expect(orgAUser.body.id).not.toBe(orgBUser.body.id);
      expect(orgA.orgId).not.toBe(orgB.orgId);
    });
  });
});
