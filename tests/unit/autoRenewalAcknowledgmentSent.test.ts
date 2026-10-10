/** The acknowledgment a subscriber can keep (Cal. Bus. & Prof. Code § 17602(a)(3)), sent when checkout completes. */
import { describe, expect, it, vi } from "vitest";
const H = vi.hoisted(() => ({ sent: [] as any[] }));
vi.mock("../../server/services/emailService", () => ({ emailService: { sendEmail: async (o: any) => { H.sent.push(o); return { success: true }; } } }));
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
import { WebhookHandlers } from "../../server/webhookHandlers";

describe("sendAutoRenewalAcknowledgment", () => {
  it("emails the terms, the cancellation policy and how to cancel, on the system lane", async () => {
    await WebhookHandlers.sendAutoRenewalAcknowledgment({
      id: "cs_1",
      customer_details: { email: "o@x.test" },
      metadata: { organizationId: "7", auto_renewal_terms_version: "v", auto_renewal_plan: "Pro", auto_renewal_price_cents: "49000", auto_renewal_interval: "year", auto_renewal_currency: "usd", auto_renewal_trial_days: "0" },
    } as any);
    expect(H.sent).toHaveLength(1);
    // One per checkout session: a redelivered webhook replays through the outward-action boundary.
    expect(H.sent[0]).toEqual(expect.objectContaining({ to: "o@x.test", purpose: "system", organizationId: 7, idempotencyKey: "auto-renewal-ack:cs_1" }));
    expect(H.sent[0].text).toMatch(/renews automatically every year at \$490\.00/);
    expect(H.sent[0].text).toMatch(/How to cancel/);
  });

  it("sends nothing for a checkout that showed no renewal terms", async () => {
    H.sent.length = 0;
    await WebhookHandlers.sendAutoRenewalAcknowledgment({ id: "cs_2", customer_details: { email: "o@x.test" }, metadata: {} } as any);
    expect(H.sent).toHaveLength(0);
  });
});
