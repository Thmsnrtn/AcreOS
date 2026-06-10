/**
 * Credit-weights invariants — Pillar 4 foundation.
 *
 * These tests pin the launch credit weights so that a careless edit can't
 * silently shift the unit economics of every metered action. The
 * /founder/studio/credits surface can still override per-action weights
 * via founder_settings at runtime — that override path is exercised in
 * the third test below using a mock of the settings module.
 */

import { describe, it, expect } from "vitest";
import {
  CREDIT_WEIGHTS,
  creditExamples,
  type CreditAction,
} from "./credit-weights";

// NOTE: the founder_settings override path of the async creditCost() helper
// is covered in tests/unit/creditCost.test.ts — the helper moved to
// server/services/creditCost.ts (Tier 1C boundary enforcement) so this
// shared module stays pure.

describe("CREDIT_WEIGHTS", () => {
  // Cent-cost weights from the approved plan. Lock these so a future edit
  // is a deliberate, reviewed change.
  const EXPECTED: Record<CreditAction, number> = {
    sms_outbound: 1,
    email_outbound: 0.02,
    postcard_eddm: 31,
    postcard_postgrid: 55,
    postcard_lob: 75,
    letter_presort: 32,
    letter_lob: 120,
    skip_trace: 30,
    ai_turn_avg: 1.5,
  };

  for (const action of Object.keys(EXPECTED) as CreditAction[]) {
    it(`${action} weight matches the plan (${EXPECTED[action]} cents)`, () => {
      expect(CREDIT_WEIGHTS[action]).toBe(EXPECTED[action]);
    });
  }
});

describe("creditExamples(750) — Starter $20 → 750 credits breakdown", () => {
  const examples = creditExamples(750);

  it("returns exactly 4 illustrative breakdowns", () => {
    expect(examples).toHaveLength(4);
  });

  it("includes ~24 EDDM postcards (750 / 31 = 24.19 → floor 24)", () => {
    const eddm = examples.find((e) => e.action === "postcard_eddm");
    expect(eddm).toBeDefined();
    expect(eddm!.quantity).toBe(24);
  });

  it("includes 750 SMS messages (1 credit each)", () => {
    const sms = examples.find((e) => e.action === "sms_outbound");
    expect(sms).toBeDefined();
    expect(sms!.quantity).toBe(750);
  });

  it("includes 37,500 emails (750 / 0.02 = 37,500)", () => {
    const email = examples.find((e) => e.action === "email_outbound");
    expect(email).toBeDefined();
    expect(email!.quantity).toBe(37_500);
  });

  it("includes 23 presort letters (750 / 32 = 23.43 → floor 23)", () => {
    const letter = examples.find((e) => e.action === "letter_presort");
    expect(letter).toBeDefined();
    expect(letter!.quantity).toBe(23);
  });

  it("every example labels its credit consumption as the full pool", () => {
    for (const e of examples) {
      expect(e.creditsConsumed).toBe(750);
      expect(e.label).toBeTruthy();
    }
  });
});
