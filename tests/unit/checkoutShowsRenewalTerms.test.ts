/** Stripe Checkout carries the renewal terms beside the pay button (Cal. Bus. & Prof. Code § 17602(a)(1)). */
import { describe, expect, it, vi } from "vitest";
const H = vi.hoisted(() => ({ cfg: [] as any[] }));
vi.mock("../../server/stripeClient", () => ({
  getUncachableStripeClient: async () => ({ checkout: { sessions: { create: async (cfg: any) => { H.cfg.push(cfg); return { url: "u" }; } } } }),
}));
import { StripeService } from "../../server/stripeService";

describe("createCheckoutSession", () => {
  it("puts renewalTerms in custom_text.submit, capped at Stripe's 1,200 characters; none when absent", async () => {
    await new StripeService().createCheckoutSession("cus_1", "price_1", "s", "c", {}, undefined, { renewalTerms: "T".repeat(1500) });
    expect(H.cfg[0].custom_text.submit.message).toHaveLength(1200);
    await new StripeService().createCheckoutSession("cus_1", "price_2", "s", "c", {});
    expect(H.cfg[1].custom_text).toBeUndefined();
  });
});
