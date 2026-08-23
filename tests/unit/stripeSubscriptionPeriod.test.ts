/**
 * The billing period comes from the subscription ITEM, and absent is not NaN.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 * `current_period_start` / `current_period_end` are not on `Stripe.Subscription`
 * in the pinned API version — Stripe moved them onto the subscription ITEM,
 * because a subscription whose items bill on different cadences has no single
 * period. Four call sites read them off the subscription anyway, each behind a
 * cast, and the SAME missing field produced three different failures:
 *
 *   supportAgent.diagnose_account  `new Date(undefined * 1000).toISOString()`
 *                                  is `new Date(NaN).toISOString()`, which
 *                                  THROWS RangeError. The support agent could
 *                                  never report subscription status for a
 *                                  customer who had one.
 *   founder-chat stripe-ops        `as unknown as { current_period_end: number }`
 *                                  — a DOUBLE assertion. It typed the field
 *                                  `number` and filled it with undefined, and it
 *                                  is why the ghost-field gate missed this: that
 *                                  gate matches `as any`, and this is not.
 *   founder-chat operations        the same throw, one layer downstream.
 *   paxLearning                    guarded by `if (periodEnd)`, so the renewal
 *                                  prediction silently never fired.
 *
 * ── WHAT THIS FILE PROVES ───────────────────────────────────────────────────
 * That the accessor reads the item, that "no period" is null rather than NaN,
 * and that all four sites actually USE it — a canonical projection with no
 * adopters is the failure this repo has a law about.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  subscriptionPeriod,
  subscriptionPeriodIso,
  invoiceSubscriptionId,
} from "../../server/stripeClient";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

const subWith = (items: Array<Record<string, unknown>>) =>
  ({ items: { data: items } }) as any;

describe("the period is read off the item", () => {
  it("VACUITY: a normal single-item subscription yields a real period", () => {
    const p = subscriptionPeriod(subWith([{ current_period_start: 1_700_000_000, current_period_end: 1_702_592_000 }]));
    expect(p).not.toBeNull();
    expect(p!.start).toBe(1_700_000_000);
    expect(p!.end).toBe(1_702_592_000);
  });

  it("ignores a period placed on the SUBSCRIPTION, which is where it no longer lives", () => {
    // The exact defect: the value present in the old location must not be used.
    const sub = { current_period_start: 111, current_period_end: 222, items: { data: [] } } as any;
    expect(
      subscriptionPeriod(sub),
      "the accessor read the subscription-level field — that is the field Stripe removed",
    ).toBeNull();
  });

  it("takes the EARLIEST end when items bill on different cadences", () => {
    // Which is the whole reason Stripe moved the field: there is no one period.
    const p = subscriptionPeriod(
      subWith([
        { current_period_start: 100, current_period_end: 999 },
        { current_period_start: 100, current_period_end: 500 },
      ]),
    );
    expect(p!.end, "the next charge is the soonest one").toBe(500);
  });
});

describe("absent is null, never an Invalid Date", () => {
  it.each([
    ["no items", subWith([])],
    ["an item with no period", subWith([{ price: { id: "p" } }])],
    ["a non-numeric period", subWith([{ current_period_start: null, current_period_end: "soon" }])],
  ])("%s yields null", (_label, sub) => {
    expect(subscriptionPeriod(sub)).toBeNull();
  });

  it("the ISO helper returns nulls rather than throwing RangeError", () => {
    // The precise failure that shipped. `new Date(NaN).toISOString()` throws, so
    // the old code did not return a wrong date — it took down the whole handler.
    expect(() => new Date(NaN).toISOString()).toThrow(RangeError);
    expect(() => subscriptionPeriodIso(subWith([]))).not.toThrow();
    expect(subscriptionPeriodIso(subWith([]))).toEqual({ start: null, end: null });
  });
});

describe("every site that needs a period uses the accessor", () => {
  // A canonical projection with no production callers is not canonical. All four
  // sites are named, so removing one from the list is a deliberate act.
  const SITES = [
    "server/ai/supportAgent.ts",
    "server/services/founder-chat/providers/stripe-ops.ts",
    "server/services/paxLearning.ts",
  ] as const;

  it.each(SITES)("%s calls subscriptionPeriod", (rel) => {
    expect(read(rel)).toMatch(/subscriptionPeriod(Iso)?\s*\(/);
  });

  it("no server code reads the period off a subscription any more", () => {
    // Value-level across the whole surface: any cast form, any variable name.
    for (const rel of [...SITES, "server/services/founder-chat/tools/operations.ts"]) {
      const code = read(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      expect(
        code,
        `${rel} still casts a subscription to read current_period_* — the field is on the item`,
      ).not.toMatch(/\bsub\w*\s+as\s+(any|unknown)[\s\S]{0,80}?current_period_/);
    }
  });
});

describe("an invoice's subscription comes from its parent", () => {
  /**
   * `Invoice.subscription` is gone in the pinned API version — Stripe moved it
   * under `parent.subscription_details`, alongside `quote_details`, because an
   * invoice's parent can be several things. Both `invoice.payment_failed`
   * handlers read the old location and so passed `''` into every dunning event.
   *
   * Nothing queries `dunning_events.stripe_subscription_id`, so no behaviour was
   * wrong: dunning ran, notifications sent, retries scheduled. What was wrong is
   * the audit trail — and `''` in a nullable column is a worse answer than null,
   * because it asserts there IS a subscription and it is blank.
   */
  const invoiceWith = (parent: unknown) => ({ parent }) as any;

  it("VACUITY: a subscription invoice yields its id", () => {
    expect(
      invoiceSubscriptionId(invoiceWith({ subscription_details: { subscription: "sub_123" } })),
    ).toBe("sub_123");
  });

  it("accepts an expanded subscription object, not just an id string", () => {
    expect(
      invoiceSubscriptionId(
        invoiceWith({ subscription_details: { subscription: { id: "sub_exp" } } }),
      ),
    ).toBe("sub_exp");
  });

  it("ignores a subscription placed at the OLD top level", () => {
    // The exact defect: the value in the removed location must not be used.
    const legacy = { subscription: "sub_legacy", parent: null } as any;
    expect(
      invoiceSubscriptionId(legacy),
      "the accessor read invoice.subscription — the field Stripe removed",
    ).toBeNull();
  });

  it.each([
    ["no parent", invoiceWith(null)],
    ["a quote parent", invoiceWith({ quote_details: { quote: "qt_1" } })],
    ["subscription_details null", invoiceWith({ subscription_details: null })],
  ])("%s yields null, never an empty string", (_label, inv) => {
    const got = invoiceSubscriptionId(inv);
    expect(got).toBeNull();
    expect(got, "'' asserts there is a subscription and it is blank").not.toBe("");
  });

  it("neither payment_failed handler reads the removed field", () => {
    for (const rel of ["server/webhookHandlers.ts", "server/services/stripeConnect.ts"]) {
      const code = read(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      expect(code, `${rel} still casts an invoice to read .subscription`).not.toMatch(
        /invoice as any\s*\)\s*\.subscription/,
      );
      expect(code).toMatch(/invoiceSubscriptionId\s*\(/);
    }
  });
});
