#!/usr/bin/env tsx
/**
 * Seed script for synthetic beta simulation.
 *
 * Boots against a running AcreOS instance (docker-compose.test.yml),
 * creates all 5 persona accounts, runs their onboarding paths,
 * and seeds appropriate data volumes.
 *
 * Usage:
 *   npx tsx tests/simulation/seed-personas.ts
 *
 * Environment:
 *   SIM_BASE_URL  — override base URL (default: http://localhost:5000)
 */

import { PERSONAS, type PersonaKey } from "./personas";
import {
  createAuthenticatedSession,
  apiCall,
  generateCSV,
  type AuthSession,
} from "./helpers";

const BASE_URL = process.env.SIM_BASE_URL ?? "http://localhost:5000";

// ── Health check ───────────────────────────────────────────────────────────

async function waitForHealth(maxRetries = 30, intervalMs = 2000): Promise<void> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch(`${BASE_URL}/api/health`);
      if (res.ok) {
        console.log("[seed] App is healthy");
        return;
      }
    } catch {
      // server not up yet
    }
    console.log(`[seed] Waiting for app... (${i + 1}/${maxRetries})`);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error("[seed] App did not become healthy in time");
}

// ── Per-persona seed functions ─────────────────────────────────────────────

async function seedFirstTimer(session: AuthSession): Promise<void> {
  console.log("[seed] Fiona (First Timer): adding 1 lead, 1 deal");

  await apiCall("POST", "/api/leads", {
    firstName: "Jane",
    lastName: "Doe",
    email: "jane@example.com",
    phone: "555-0001",
    status: "new",
  }, session);

  await apiCall("POST", "/api/deals", {
    name: "Fiona's First Deal",
    stage: "prospect",
    offerAmount: 5000_00,
  }, session);
}

async function seedScalingOperator(session: AuthSession): Promise<void> {
  console.log("[seed] Steve (Scaling Operator): importing 200 leads via CSV, creating campaign + note");

  // CSV import
  const csv = generateCSV(200);
  const blob = new Blob([csv], { type: "text/csv" });
  const formData = new FormData();
  formData.append("file", blob, "steve-leads.csv");

  const importUrl = `${BASE_URL}/api/leads/import`;
  const headers: Record<string, string> = {};
  if (session.cookie) headers["Cookie"] = session.cookie;
  if (session.csrfToken) headers["X-CSRF-Token"] = session.csrfToken;

  await fetch(importUrl, {
    method: "POST",
    headers,
    body: formData,
  });

  // Create a campaign
  await apiCall("POST", "/api/campaigns", {
    name: "Steve's Mail Campaign",
    type: "direct_mail",
    status: "draft",
  }, session);

  // Create a deal
  await apiCall("POST", "/api/deals", {
    name: "Steve's Flip Deal",
    stage: "offer_sent",
    offerAmount: 15000_00,
  }, session);

  // Create a note
  await apiCall("POST", "/api/notes", {
    borrowerName: "Alice Buyer",
    borrowerEmail: "alice@example.com",
    originalBalance: 25000_00,
    currentBalance: 25000_00,
    interestRate: 9.5,
    termMonths: 60,
    monthlyPayment: 524_87,
    startDate: "2026-01-01",
    status: "performing",
  }, session);
}

async function seedEnterpriseManager(session: AuthSession): Promise<void> {
  console.log("[seed] Elaine (Enterprise Manager): creating deals for team");

  for (let i = 0; i < 5; i++) {
    await apiCall("POST", "/api/deals", {
      name: `Elaine Team Deal ${i + 1}`,
      stage: "negotiation",
      offerAmount: (10000 + i * 5000) * 100,
    }, session);
  }
}

async function seedNoteInvestor(session: AuthSession): Promise<void> {
  console.log("[seed] Nathan (Note Investor): creating 10 notes with varying terms");

  const noteConfigs = [
    { term: 60, rate: 8.0, principal: 20000_00 },
    { term: 120, rate: 9.5, principal: 45000_00 },
    { term: 180, rate: 10.0, principal: 80000_00 },
    { term: 60, rate: 7.5, principal: 15000_00 },
    { term: 120, rate: 8.5, principal: 35000_00 },
    { term: 180, rate: 11.0, principal: 100000_00 },
    { term: 60, rate: 9.0, principal: 22000_00 },
    { term: 120, rate: 10.5, principal: 55000_00 },
    { term: 180, rate: 8.0, principal: 70000_00 },
    { term: 60, rate: 12.0, principal: 18000_00 },
  ];

  for (let i = 0; i < noteConfigs.length; i++) {
    const cfg = noteConfigs[i];
    // Calculate monthly payment using standard amortization formula
    const monthlyRate = cfg.rate / 100 / 12;
    const payment = Math.round(
      (cfg.principal * monthlyRate * Math.pow(1 + monthlyRate, cfg.term)) /
        (Math.pow(1 + monthlyRate, cfg.term) - 1),
    );

    await apiCall("POST", "/api/notes", {
      borrowerName: `Borrower ${i + 1}`,
      borrowerEmail: `borrower${i + 1}@sim-test.com`,
      originalBalance: cfg.principal,
      currentBalance: cfg.principal,
      interestRate: cfg.rate,
      termMonths: cfg.term,
      monthlyPayment: payment,
      startDate: "2026-01-01",
      status: "performing",
    }, session);
  }
}

async function seedLimitTester(session: AuthSession): Promise<void> {
  console.log("[seed] Tom (Limit Tester): creating leads up to free tier limit");

  // Create leads up to the free tier limit (50)
  for (let i = 0; i < 50; i++) {
    await apiCall("POST", "/api/leads", {
      firstName: `Tom`,
      lastName: `Lead${i}`,
      email: `tom-lead-${i}@sim-test.com`,
      status: "new",
    }, session);
  }

  // Create properties up to the free tier limit (10)
  for (let i = 0; i < 10; i++) {
    await apiCall("POST", "/api/properties", {
      address: `${100 + i} Desert Rd`,
      county: "Mohave",
      state: "AZ",
      acreage: 5 + i,
      askingPrice: (5000 + i * 1000) * 100,
    }, session);
  }
}

// ── Main ───────────────────────────────────────────────────────────────────

const SEED_MAP: Record<PersonaKey, (s: AuthSession) => Promise<void>> = {
  firstTimer: seedFirstTimer,
  scalingOperator: seedScalingOperator,
  enterpriseManager: seedEnterpriseManager,
  noteInvestor: seedNoteInvestor,
  limitTester: seedLimitTester,
};

async function main(): Promise<void> {
  console.log("[seed] Starting persona seeding...");
  console.log(`[seed] Target: ${BASE_URL}`);

  await waitForHealth();

  const sessions: Record<string, AuthSession> = {};

  for (const key of Object.keys(PERSONAS) as PersonaKey[]) {
    const persona = PERSONAS[key];
    console.log(`\n[seed] ═══ ${persona.name} (${key}) ═══`);

    try {
      const session = await createAuthenticatedSession(key);
      sessions[key] = session;
      console.log(`[seed] Authenticated as ${persona.email} (org: ${session.orgId})`);

      await SEED_MAP[key](session);
      console.log(`[seed] ✓ ${persona.name} seeded`);
    } catch (err) {
      console.error(`[seed] ✗ Failed to seed ${persona.name}:`, err);
    }
  }

  console.log("\n[seed] ═══ Seeding complete ═══");
  console.log("[seed] Sessions created:", Object.keys(sessions).length);
}

main().catch((err) => {
  console.error("[seed] Fatal error:", err);
  process.exit(1);
});
