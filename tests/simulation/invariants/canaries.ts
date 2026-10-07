/**
 * One canary per invariant: a clean observation the monitor must pass, and a
 * violating one it must catch. Violations are written in EQUIVALENT
 * REPRESENTATIONS where one exists (a display-name From header, a recipient
 * in another case, a revocation in natural language the product never marked,
 * a second page worded differently), so a check that matches a literal shape
 * cannot pass its canary.
 */
import type { Observation } from "./types";

const AT = "2026-10-05T12:00:00.000Z";
const base = (tick: number): Observation => ({ tick, at: AT });

export interface Canary { clean: Observation[]; violating: Observation[] }

export const CANARIES: Record<string, Canary> = {
  "no-cross-tenant": {
    clean: [{ ...base(1), queries: [{ actorOrg: 7, kind: "read", table: "leads", rowOrgs: [7, 7] }, { actorOrg: 3, actorIsFounder: true, kind: "read", table: "organizations", rowOrgs: [1, 2, 3] }, { actorOrg: null, kind: "read", table: "leads", rowOrgs: [1, 9] }], tenantWrites: [] }],
    violating: [
      { ...base(2), queries: [{ actorOrg: 7, kind: "read", table: "support_resolution_history", rowOrgs: [7, 12] }] },
      { ...base(3), queries: [], tenantWrites: [{ actorOrg: 7, rowOrg: 8, table: "leads", op: "UPDATE" }] },
    ],
  },
  "customer-money-not-on-platform": {
    clean: [{ ...base(1), providerCalls: [{ rail: "stripe", at: AT, to: [], account: null, moneyKind: "subscription", path: "/v1/subscriptions" }, { rail: "stripe", at: AT, to: [], account: "acct_customer1", moneyKind: "customer_money", path: "/v1/payment_intents" }] }],
    violating: [
      { ...base(2), providerCalls: [{ rail: "stripe", at: AT, to: [], account: null, moneyKind: "customer_money", path: "/v1/payment_intents", amountCents: 31200 }] },
      { ...base(3), providerCalls: [{ rail: "stripe", at: AT, to: [], account: null, moneyKind: "unknown", path: "/v1/transfers", amountCents: 5000 }] },
    ],
  },
  "no-platform-counterparty-mail": {
    clean: [{ ...base(1), platformSenders: ["noreply@acreos.sim"], counterparties: { emails: ["seller@example.net"], phones: [] }, providerCalls: [{ rail: "ses", at: AT, from: "noreply@acreos.sim", to: ["owner@customer.example"] }, { rail: "sendgrid", at: AT, from: "deals@customer.example", to: ["seller@example.net"] }] }],
    violating: [
      { ...base(2), platformSenders: ["noreply@acreos.sim"], counterparties: { emails: ["seller@example.net"], phones: [] }, providerCalls: [{ rail: "ses", at: AT, from: "AcreOS <NoReply@acreos.sim>", to: ["Seller Person <Seller@Example.NET>"] }] },
    ],
  },
  "no-send-without-consent": {
    clean: [{ ...base(1), sends: [{ channel: "sms", at: AT, to: "+15205550100", orgId: 1, leadDnc: false, leadConsent: true, revokedAt: null }, { channel: "sms", at: AT, to: "+15205550101", orgId: 1, leadDnc: false, leadConsent: true, revokedAt: "2026-10-05T13:00:00.000Z" }] }],
    violating: [
      { ...base(2), sends: [{ channel: "sms", at: AT, to: "+15205550102", orgId: 1, leadDnc: true }] },
      { ...base(3), sends: [{ channel: "sms", at: AT, to: "+15205550103", orgId: 1, leadDnc: false, leadConsent: false }] },
      // The product never marked this lead — the twin knows the seller wrote "cease all contact" an hour earlier.
      { ...base(4), sends: [{ channel: "email", at: AT, to: "seller@example.net", orgId: 1, leadDnc: false, leadConsent: true, revokedAt: "2026-10-05T11:00:00.000Z" }] },
    ],
  },
  "every-number-has-a-source": {
    clean: [{ ...base(1), screens: [{ surface: "letter", texts: ["Good morning. 3 trials, $49 MRR, as of 2026."], sourcedNumbers: [3, 49] }] }],
    violating: [
      { ...base(2), screens: [{ surface: "letter", texts: ["Customers love us — 98% satisfaction."], sourcedNumbers: [3, 49] }] },
      { ...base(3), screens: [{ surface: "pax", texts: ["Your list will return about $12,400 this quarter."], sourcedNumbers: [] }] },
    ],
  },
  "approval-is-version-bound": {
    clean: [{ ...base(1), approvals: [{ askId: 5, shownHash: "h1", shownActs: { moveKind: "grow_owned_channels", domain: "growth" }, answer: "yes", storedHash: "h1", storedActs: { moveKind: "grow_owned_channels", domain: "growth" }, dispatched: [{ sourceId: "autopilot:grow_owned_channels" }] }, { askId: 6, shownHash: "h2", shownActs: null, answer: "no", storedHash: "h2", storedActs: null, dispatched: [] }] }],
    violating: [
      { ...base(2), approvals: [{ askId: 7, shownHash: "h1", shownActs: { moveKind: "grow_owned_channels", domain: "growth" }, answer: "yes", storedHash: "h1", storedActs: { moveKind: "grow_owned_channels", domain: "growth" }, dispatched: [{ sourceId: "autopilot:run_paid_ads" }] }] },
      { ...base(3), approvals: [{ askId: 8, shownHash: "h1", shownActs: { moveKind: "grow_owned_channels", domain: "growth" }, answer: "yes", storedHash: "h9", storedActs: { moveKind: "grow_owned_channels", domain: "growth" }, dispatched: [{ sourceId: "autopilot:grow_owned_channels" }] }] },
      { ...base(4), approvals: [{ askId: 9, shownHash: "h1", shownActs: null, answer: "no", storedHash: "h1", storedActs: null, dispatched: [{ sourceId: "autopilot:grow_owned_channels" }] }] },
    ],
  },
  "no-hard-stop-without-founder": {
    clean: [{ ...base(1), hardStops: [{ kind: "data_deletion", at: AT, evidence: "org 4 deleted on the founder's tap", founderTap: "tap-17" }], providerCalls: [{ rail: "stripe", at: AT, to: [], path: "/v1/refunds" }, { rail: "meta", at: AT, to: [], dailyBudgetCents: 2000 }] }],
    violating: [
      { ...base(2), hardStops: [{ kind: "data_deletion", at: AT, evidence: "org 4 purged", founderTap: null }] },
      { ...base(3), providerCalls: [{ rail: "stripe", at: AT, to: [], path: "/v1/prices" }] },
      { ...base(4), providerCalls: [{ rail: "meta", at: AT, to: [], dailyBudgetCents: 60000 }] },
    ],
  },
  "refunds-within-rules": {
    clean: [{ ...base(1), refunds: [{ id: "r1", at: AT, amountCents: 3000, byMachine: true, ceilingCents: 5000, grantUsed: 1, grantMax: 20, ofAcreosCharge: true }, { id: "r2", at: AT, amountCents: 8000, byMachine: false, ceilingCents: 5000, grantUsed: 1, grantMax: 20, ofAcreosCharge: true }] }],
    violating: [
      { ...base(2), refunds: [{ id: "r3", at: AT, amountCents: 8000, byMachine: true, ceilingCents: 5000, grantUsed: 2, grantMax: 20, ofAcreosCharge: true }] },
      { ...base(3), refunds: [{ id: "r4", at: AT, amountCents: 1000, byMachine: true, ceilingCents: 5000, grantUsed: 21, grantMax: 20, ofAcreosCharge: true }] },
      { ...base(4), refunds: [{ id: "r5", at: AT, amountCents: 1000, byMachine: true, ceilingCents: 5000, grantUsed: 3, grantMax: 20, ofAcreosCharge: false }] },
    ],
  },
  "one-page-per-incident": {
    clean: [{ ...base(1), outages: [{ provider: "stripe", names: ["Stripe"], from: "2026-10-05T00:00:00.000Z", to: null }], pages: [{ at: AT, subject: "Stripe is down", body: "Incident 1" }, { at: AT, subject: "Email is down", body: "x" }] }],
    // Two ticks: the second page is worded differently but names the same outage.
    violating: [
      { ...base(2), outages: [{ provider: "stripe", names: ["Stripe"], from: "2026-10-05T00:00:00.000Z", to: null }], pages: [{ at: AT, subject: "Stripe is down", body: "Incident 1" }] },
      { ...base(3), outages: [{ provider: "stripe", names: ["Stripe"], from: "2026-10-05T00:00:00.000Z", to: null }], pages: [{ at: "2026-10-05T18:00:00.000Z", subject: "Still no payments", body: "Stripe has not answered for 18h" }] },
    ],
  },
};
