/**
 * Founder hard-stop guardrails — unit ratchet over checkHardGuardrails().
 *
 * checkHardGuardrails() is the autopilot's code-level block layer, checked
 * BEFORE the AI is consulted. It already enforces three of the four standing
 * founder hard stops (CLAUDE.md DO-NOT-DO list):
 *
 *   - spends over $500          → HARD_GUARDRAIL_AMOUNT_LIMIT (50_000 cents)
 *   - pricing/billing changes   → BILLING_SUBSCRIPTION_ACTIONS
 *   - customer-data deletion    → DATA_DELETION_ACTIONS + destructive flags
 *
 * ...but its only coverage was a DB-dependent integration test, so the
 * enforcement existed without being *ratcheted*: someone could weaken or drop
 * a case and no fast test would notice. This suite pins the behaviour as pure
 * unit assertions (no DB), so the guardrails cannot silently erode — the same
 * lesson the >$500 drift taught.
 *
 * Registry: shared/governance/constitution.ts references this file as the
 * enforcement pointer for the pricing + customer-data-deletion hard stops.
 */

import { describe, expect, it } from "vitest";
import { checkHardGuardrails } from "../../server/services/autonomousDecisionExecutor";

describe("checkHardGuardrails — spend hard stop (>$500)", () => {
  it("blocks a spend above the $500 limit", () => {
    const r = checkHardGuardrails({ actionPayload: { amount: 50_001 } });
    expect(r.blocked).toBe(true);
    expect(r.reason).toMatch(/exceeds hard limit/i);
  });

  it("allows a spend at or below $500", () => {
    expect(checkHardGuardrails({ actionPayload: { amount: 50_000 } }).blocked).toBe(false);
    expect(checkHardGuardrails({ actionPayload: { amount: 1_00 } }).blocked).toBe(false);
  });
});

describe("checkHardGuardrails — mass-action limit", () => {
  it("blocks a recipient list over the limit", () => {
    const recipients = Array.from({ length: 101 }, (_, i) => `r${i}`);
    expect(checkHardGuardrails({ actionPayload: { recipients } }).blocked).toBe(true);
  });

  it("allows a recipient list at the limit", () => {
    const recipients = Array.from({ length: 100 }, (_, i) => `r${i}`);
    expect(checkHardGuardrails({ actionPayload: { recipients } }).blocked).toBe(false);
  });
});

describe("checkHardGuardrails — pricing/billing hard stop", () => {
  // "Pricing changes stay founder-only forever" (CLAUDE.md).
  const blocked = [
    "pricing_change",
    "billing_modification",
    "subscription_change",
    "plan_upgrade",
    "plan_downgrade",
    "payment_method_update",
    "invoice_adjustment",
    "subscription_cancel",
  ];

  for (const actionType of blocked) {
    it(`blocks "${actionType}" via actionPayload.actionType`, () => {
      expect(checkHardGuardrails({ actionPayload: { actionType } }).blocked).toBe(true);
    });
  }

  it("blocks a pricing change declared via itemType", () => {
    expect(checkHardGuardrails({ itemType: "pricing_change" }).blocked).toBe(true);
  });

  it("blocks a pricing change declared only via payload.category", () => {
    expect(
      checkHardGuardrails({ actionPayload: { category: "pricing_change" } }).blocked,
    ).toBe(true);
  });
});

describe("checkHardGuardrails — customer-data-deletion hard stop", () => {
  // "Customer-data deletion stays founder-only forever" (CLAUDE.md).
  const blocked = [
    "data_deletion",
    "bulk_delete",
    "account_deletion",
    "record_purge",
    "permanent_delete",
  ];

  for (const actionType of blocked) {
    it(`blocks "${actionType}"`, () => {
      const r = checkHardGuardrails({ actionPayload: { actionType } });
      expect(r.blocked).toBe(true);
      expect(r.reason).toMatch(/data deletion/i);
    });
  }

  it("blocks a deletion declared only via payload.category", () => {
    expect(
      checkHardGuardrails({ actionPayload: { category: "account_deletion" } }).blocked,
    ).toBe(true);
  });

  it("blocks destructive intent flags regardless of action type", () => {
    for (const flag of ["delete", "permanent", "purge"]) {
      const r = checkHardGuardrails({ actionPayload: { [flag]: true } });
      expect(r.blocked, `flag ${flag} must block`).toBe(true);
      expect(r.reason).toMatch(/destructive action flag/i);
    }
  });

  it("does not block when a destructive flag is explicitly false", () => {
    expect(
      checkHardGuardrails({ actionPayload: { delete: false, purge: false } }).blocked,
    ).toBe(false);
  });
});

describe("checkHardGuardrails — benign actions still pass", () => {
  it("allows an ordinary non-destructive, non-financial action", () => {
    const r = checkHardGuardrails({
      itemType: "support_escalation",
      actionPayload: { actionType: "draft_reply", recipients: ["a@example.com"] },
    });
    expect(r.blocked).toBe(false);
    expect(r.reason).toBe("");
  });

  it("tolerates a completely empty action", () => {
    expect(checkHardGuardrails({}).blocked).toBe(false);
  });
});
