/**
 * W3.4 — pipeline status vocabulary + transition tables
 * (shared/lifecycle/pipeline-status.ts).
 *
 * Funnel metrics key off these strings; the audit found silent drift
 * ("won", "active") that matched nothing. These tests lock:
 *   - the vocabularies (incl. "contacted", which live writers use)
 *   - every transition target is itself a valid status (no typo edges)
 *   - the deal table matches the machine routes-deals has enforced
 *   - validate*Transition semantics: same-status no-op, legacy-current
 *     leniency, invalid-value refusal, illegal-jump refusal
 */

import { describe, it, expect } from "vitest";
import {
  LEAD_STATUSES,
  DEAL_STATUSES,
  LEAD_STATUS_TRANSITIONS,
  DEAL_STATUS_TRANSITIONS,
  isLeadStatus,
  isDealStatus,
  validateLeadTransition,
  validateDealTransition,
} from "../../shared/lifecycle/pipeline-status";

describe("pipeline status vocabulary", () => {
  it("lead vocabulary covers live writers (incl. the 'contacted' drift)", () => {
    for (const s of ["new", "mailed", "contacted", "responded", "negotiating", "accepted", "closed", "dead", "interested", "qualified", "under_contract"]) {
      expect(isLeadStatus(s), s).toBe(true);
    }
    // Values the audit found being READ but never written stay invalid.
    expect(isLeadStatus("active")).toBe(false);
  });

  it("deal vocabulary matches the kanban and rejects the 'won' drift", () => {
    expect([...DEAL_STATUSES]).toEqual([
      "negotiating", "offer_sent", "countered", "accepted", "in_escrow", "closed", "cancelled",
    ]);
    expect(isDealStatus("won")).toBe(false);
  });

  it("every transition target is itself a valid status", () => {
    for (const [from, targets] of Object.entries(LEAD_STATUS_TRANSITIONS)) {
      expect(isLeadStatus(from), from).toBe(true);
      for (const t of targets) expect(isLeadStatus(t), `${from} → ${t}`).toBe(true);
    }
    for (const [from, targets] of Object.entries(DEAL_STATUS_TRANSITIONS)) {
      expect(isDealStatus(from), from).toBe(true);
      for (const t of targets) expect(isDealStatus(t), `${from} → ${t}`).toBe(true);
    }
  });

  it("deal machine preserves the Task #210 semantics routes-deals enforced", () => {
    expect(DEAL_STATUS_TRANSITIONS.negotiating).toContain("offer_sent");
    expect(DEAL_STATUS_TRANSITIONS.negotiating).not.toContain("closed"); // no skipping
    expect(DEAL_STATUS_TRANSITIONS.closed).toHaveLength(0); // terminal
    expect(DEAL_STATUS_TRANSITIONS.cancelled).toHaveLength(0); // terminal
  });
});

describe("validateDealTransition", () => {
  it("allows legal moves and same-status no-ops", () => {
    expect(validateDealTransition("negotiating", "offer_sent")).toBeNull();
    expect(validateDealTransition("in_escrow", "closed")).toBeNull();
    expect(validateDealTransition("closed", "closed")).toBeNull();
  });

  it("refuses stage-skips and moves out of terminal states", () => {
    expect(validateDealTransition("negotiating", "closed")).toMatch(/Cannot transition/);
    expect(validateDealTransition("closed", "negotiating")).toMatch(/Cannot transition/);
  });

  it("refuses unknown target values outright", () => {
    expect(validateDealTransition("negotiating", "won")).toMatch(/not a valid deal status/);
  });

  it("lets legacy/unknown CURRENT rows move to any valid status", () => {
    expect(validateDealTransition("some_2024_value", "negotiating")).toBeNull();
    expect(validateDealTransition(null, "offer_sent")).toBeNull();
  });
});

describe("validateLeadTransition", () => {
  it("allows the seller happy path", () => {
    expect(validateLeadTransition("new", "mailed")).toBeNull();
    expect(validateLeadTransition("mailed", "responded")).toBeNull();
    expect(validateLeadTransition("responded", "negotiating")).toBeNull();
    expect(validateLeadTransition("negotiating", "accepted")).toBeNull();
    expect(validateLeadTransition("accepted", "closed")).toBeNull();
  });

  it("allows dead-lead resurrection but not new → closed jumps", () => {
    expect(validateLeadTransition("dead", "responded")).toBeNull();
    expect(validateLeadTransition("new", "closed")).toMatch(/Cannot move/);
  });

  it("refuses unknown target values", () => {
    expect(validateLeadTransition("new", "active")).toMatch(/not a valid lead status/);
  });
});
