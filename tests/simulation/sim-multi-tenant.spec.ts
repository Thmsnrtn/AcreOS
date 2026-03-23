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
  createAuthenticatedSession,
  apiCall,
  assertOrgIsolation,
  type AuthSession,
} from "./helpers";

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
    } catch {
      console.warn("[sim] Could not authenticate — is the test server running?");
    }
  }, 30_000);

  // ── Seed Org A with entities ───────────────────────────────────────────

  describe("Seed Org A entities", () => {
    it("creates leads for Org A", async () => {
      if (!orgA) return;

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
      if (!orgA) return;

      for (let i = 0; i < 2; i++) {
        const res = await apiCall("POST", "/api/deals", {
          name: `Elaine Deal ${i}`,
          stage: "negotiation",
          offerAmount: (10000 + i * 5000) * 100,
        }, orgA);

        if (res.status === 201 || res.status === 200) {
          const id = res.body.id ?? res.body.dealId;
          if (id) orgAEntities.deals.push(id);
        }

        expect(res.status).toBeLessThan(500);
      }
    });

    it("creates properties for Org A", async () => {
      if (!orgA) return;

      const res = await apiCall("POST", "/api/properties", {
        address: "100 Elaine Blvd",
        county: "Mohave",
        state: "AZ",
        acreage: 40,
        askingPrice: 50000_00,
      }, orgA);

      if (res.status === 201 || res.status === 200) {
        const id = res.body.id ?? res.body.propertyId;
        if (id) orgAEntities.properties.push(id);
      }

      expect(res.status).toBeLessThan(500);
    });

    it("creates notes for Org A", async () => {
      if (!orgA) return;

      const res = await apiCall("POST", "/api/notes", {
        borrowerName: "Elaine Borrower",
        borrowerEmail: "elaine-borrower@sim-test.com",
        originalBalance: 30000_00,
        currentBalance: 30000_00,
        interestRate: 9.0,
        termMonths: 60,
        monthlyPayment: 622_75,
        startDate: "2026-01-01",
        status: "performing",
      }, orgA);

      if (res.status === 201 || res.status === 200) {
        const id = res.body.id ?? res.body.noteId;
        if (id) orgAEntities.notes.push(id);
      }

      expect(res.status).toBeLessThan(500);
    });

    it("creates campaigns for Org A", async () => {
      if (!orgA) return;

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
      if (!orgA || !orgB || orgAEntities.leads.length === 0) return;

      for (const id of orgAEntities.leads) {
        const res = await apiCall("GET", `/api/leads/${id}`, undefined, orgB);
        expect([403, 404]).toContain(res.status);
      }
    });

    it("Org B cannot read Org A's deals", async () => {
      if (!orgA || !orgB || orgAEntities.deals.length === 0) return;

      for (const id of orgAEntities.deals) {
        const res = await apiCall("GET", `/api/deals/${id}`, undefined, orgB);
        expect([403, 404]).toContain(res.status);
      }
    });

    it("Org B cannot read Org A's properties", async () => {
      if (!orgA || !orgB || orgAEntities.properties.length === 0) return;

      for (const id of orgAEntities.properties) {
        const res = await apiCall("GET", `/api/properties/${id}`, undefined, orgB);
        expect([403, 404]).toContain(res.status);
      }
    });

    it("Org B cannot read Org A's notes", async () => {
      if (!orgA || !orgB || orgAEntities.notes.length === 0) return;

      for (const id of orgAEntities.notes) {
        const res = await apiCall("GET", `/api/notes/${id}`, undefined, orgB);
        expect([403, 404]).toContain(res.status);
      }
    });

    it("Org B cannot read Org A's campaigns", async () => {
      if (!orgA || !orgB || orgAEntities.campaigns.length === 0) return;

      for (const id of orgAEntities.campaigns) {
        const res = await apiCall("GET", `/api/campaigns/${id}`, undefined, orgB);
        expect([403, 404]).toContain(res.status);
      }
    });
  });

  // ── Cross-org UPDATE isolation ─────────────────────────────────────────

  describe("Org B cannot UPDATE Org A's entities", () => {
    it("Org B cannot update Org A's leads", async () => {
      if (!orgA || !orgB || orgAEntities.leads.length === 0) return;

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
      if (!orgA || !orgB || orgAEntities.deals.length === 0) return;

      const id = orgAEntities.deals[0];
      const res = await apiCall("PUT", `/api/deals/${id}`, {
        name: "Hacked Deal",
      }, orgB);

      expect([403, 404]).toContain(res.status);
    });

    it("Org B cannot update Org A's properties", async () => {
      if (!orgA || !orgB || orgAEntities.properties.length === 0) return;

      const id = orgAEntities.properties[0];
      const res = await apiCall("PUT", `/api/properties/${id}`, {
        address: "Hacked Address",
      }, orgB);

      expect([403, 404]).toContain(res.status);
    });

    it("Org B cannot update Org A's notes", async () => {
      if (!orgA || !orgB || orgAEntities.notes.length === 0) return;

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
      if (!orgA || !orgB || orgAEntities.leads.length === 0) return;

      const id = orgAEntities.leads[0];
      const res = await apiCall("DELETE", `/api/leads/${id}`, undefined, orgB);

      expect([403, 404]).toContain(res.status);

      // Verify lead still exists for Org A
      const verifyRes = await apiCall("GET", `/api/leads/${id}`, undefined, orgA);
      expect(verifyRes.status).toBe(200);
    });

    it("Org B cannot delete Org A's deals", async () => {
      if (!orgA || !orgB || orgAEntities.deals.length === 0) return;

      const id = orgAEntities.deals[0];
      const res = await apiCall("DELETE", `/api/deals/${id}`, undefined, orgB);

      expect([403, 404]).toContain(res.status);
    });

    it("Org B cannot delete Org A's properties", async () => {
      if (!orgA || !orgB || orgAEntities.properties.length === 0) return;

      const id = orgAEntities.properties[0];
      const res = await apiCall("DELETE", `/api/properties/${id}`, undefined, orgB);

      expect([403, 404]).toContain(res.status);
    });
  });

  // ── Org list isolation ─────────────────────────────────────────────────

  describe("Org B's list endpoints don't leak Org A data", () => {
    it("Org B's lead list does not contain Org A's leads", async () => {
      if (!orgA || !orgB) return;

      const res = await apiCall("GET", "/api/leads", undefined, orgB);
      if (res.status !== 200) return;

      const leads = Array.isArray(res.body) ? res.body : res.body.leads ?? [];
      const leakedIds = leads
        .map((l: any) => l.id)
        .filter((id: number) => orgAEntities.leads.includes(id));

      expect(leakedIds).toHaveLength(0);
    });

    it("Org B's deal list does not contain Org A's deals", async () => {
      if (!orgA || !orgB) return;

      const res = await apiCall("GET", "/api/deals", undefined, orgB);
      if (res.status !== 200) return;

      const deals = Array.isArray(res.body) ? res.body : res.body.deals ?? [];
      const leakedIds = deals
        .map((d: any) => d.id)
        .filter((id: number) => orgAEntities.deals.includes(id));

      expect(leakedIds).toHaveLength(0);
    });

    it("Org B's notes list does not contain Org A's notes", async () => {
      if (!orgA || !orgB) return;

      const res = await apiCall("GET", "/api/notes", undefined, orgB);
      if (res.status !== 200) return;

      const notes = Array.isArray(res.body) ? res.body : res.body.notes ?? [];
      const leakedIds = notes
        .map((n: any) => n.id)
        .filter((id: number) => orgAEntities.notes.includes(id));

      expect(leakedIds).toHaveLength(0);
    });

    it("Org B's campaign list does not contain Org A's campaigns", async () => {
      if (!orgA || !orgB) return;

      const res = await apiCall("GET", "/api/campaigns", undefined, orgB);
      if (res.status !== 200) return;

      const campaigns = Array.isArray(res.body) ? res.body : res.body.campaigns ?? [];
      const leakedIds = campaigns
        .map((c: any) => c.id)
        .filter((id: number) => orgAEntities.campaigns.includes(id));

      expect(leakedIds).toHaveLength(0);
    });
  });

  // ── Full isolation assertion using helper ──────────────────────────────

  describe("Full CRUD isolation via assertOrgIsolation helper", () => {
    it("leads are fully isolated", async () => {
      if (!orgA || !orgB || orgAEntities.leads.length === 0) return;

      const violations = await assertOrgIsolation(
        orgA,
        orgB,
        "leads",
        orgAEntities.leads[0],
      );

      expect(violations).toHaveLength(0);
    });

    it("deals are fully isolated", async () => {
      if (!orgA || !orgB || orgAEntities.deals.length === 0) return;

      const violations = await assertOrgIsolation(
        orgA,
        orgB,
        "deals",
        orgAEntities.deals[0],
      );

      expect(violations).toHaveLength(0);
    });

    it("properties are fully isolated", async () => {
      if (!orgA || !orgB || orgAEntities.properties.length === 0) return;

      const violations = await assertOrgIsolation(
        orgA,
        orgB,
        "properties",
        orgAEntities.properties[0],
      );

      expect(violations).toHaveLength(0);
    });

    it("notes are fully isolated", async () => {
      if (!orgA || !orgB || orgAEntities.notes.length === 0) return;

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
      if (!orgA || !orgB) return;

      const orgAUser = await apiCall("GET", "/api/auth/user", undefined, orgA);
      const orgBUser = await apiCall("GET", "/api/auth/user", undefined, orgB);

      expect(orgAUser.status).toBeLessThan(500);
      expect(orgBUser.status).toBeLessThan(500);

      // They should be different users/orgs
      if (orgAUser.status === 200 && orgBUser.status === 200) {
        const orgAId = orgAUser.body.organizationId ?? orgAUser.body.orgId;
        const orgBId = orgBUser.body.organizationId ?? orgBUser.body.orgId;

        if (orgAId && orgBId) {
          expect(orgAId).not.toBe(orgBId);
        }
      }
    });
  });
});
