import { describe, it, expect } from "vitest";
import {
  supportToolDefinitions,
  executeSupportTool,
  MONEY_MUTATING_BILLING_FIXES,
} from "../../server/ai/supportAgent";
import type { Organization } from "@shared/schema";

/**
 * Phase-0 CRITICAL bypass regression guard.
 *
 * The interactive support agent held an uncapped, ungated, un-audited
 * platform-Stripe money tool: `apply_billing_fix` could apply arbitrary account
 * credits, pay invoices, and void invoices from a customer-driven chat loop,
 * with the only "approval" being prose in the tool description. This pins the
 * fix (INV-MONEY-2 / INV-HARD-1): the tool offers only the safe self-service
 * link, and the executor refuses every money-moving fix type BEFORE any
 * Stripe/db call — so a widened enum or a new caller cannot silently re-open it.
 */
describe("support agent — money-mutation hard stop", () => {
  it("only offers the safe payment-update link in the tool schema", () => {
    const enumValues = (supportToolDefinitions as any).apply_billing_fix.parameters
      .properties.fix_type.enum as string[];
    expect(enumValues).toEqual(["send_update_payment_link"]);
    for (const money of MONEY_MUTATING_BILLING_FIXES) {
      expect(enumValues).not.toContain(money);
    }
  });

  // A fake org with a Stripe customer id — proves the refusal is unconditional,
  // not merely a side effect of missing Stripe config.
  const org = { id: 1, ownerId: "u1", stripeCustomerId: "cus_test" } as unknown as Organization;

  for (const fixType of MONEY_MUTATING_BILLING_FIXES) {
    it(`refuses money-moving fix "${fixType}" without touching Stripe`, async () => {
      const res = await executeSupportTool(
        "apply_billing_fix",
        { fix_type: fixType, amount_cents: 9_999_999, invoice_id: "in_x", reason: "test" },
        org,
        123,
      );
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/founder-only|escalate/i);
      // The refusal returns before the Stripe import; there is no success data.
      expect(res.data).toBeUndefined();
    });
  }

  it("still allows the safe self-service payment-update link path", () => {
    // The only reachable Stripe call is billingPortal.sessions.create; assert
    // the schema keeps that capability so support can still help customers.
    const enumValues = (supportToolDefinitions as any).apply_billing_fix.parameters
      .properties.fix_type.enum as string[];
    expect(enumValues).toContain("send_update_payment_link");
  });
});
