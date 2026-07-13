/**
 * D2 — auto-top-up off-session charging (executeAutoTopUp).
 *
 * Pins the founder-decision rules (2026-07-11):
 *   - Customer settings decide IF/HOW MUCH, but the permanent $500/action
 *     hard-stop binds ABOVE customer config.
 *   - Skips while Stripe is unconfigured (live with keys).
 *   - Ledger-based idempotency: one auto charge per org per hour.
 *   - No card on file → honest skip, never a guess.
 *   - Credits land ONLY after the charge succeeds; declines credit nothing.
 *   - Every outcome Letter-visible via logActivity.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const selectQueue: unknown[][] = [];
function chain() {
  const c: any = {};
  c.from = () => c;
  c.where = () => c;
  c.limit = () => Promise.resolve(selectQueue.shift() ?? []);
  return c;
}

const findFirstMock = vi.fn();
vi.mock("../../server/db", () => ({
  db: {
    select: vi.fn(() => chain()),
    query: { organizations: { findFirst: (...a: unknown[]) => findFirstMock(...a) } },
  },
  withTransaction: vi.fn(async (fn: any) => fn({})),
}));
vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../server/services/systemActivityLogger", () => ({
  logActivity: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../server/services/emailService", () => ({
  emailService: { sendEmail: vi.fn().mockResolvedValue(undefined) },
}));

const paymentIntentCreateMock = vi.fn();
const customersRetrieveMock = vi.fn();
const paymentMethodsListMock = vi.fn();
vi.mock("../../server/stripeClient", () => ({
  getUncachableStripeClient: vi.fn(async () => ({
    paymentIntents: { create: paymentIntentCreateMock },
    customers: { retrieve: customersRetrieveMock },
    paymentMethods: { list: paymentMethodsListMock },
  })),
}));

import { usageMeteringService, creditService } from "../../server/services/credits";
import { logActivity } from "../../server/services/systemActivityLogger";
import { getUncachableStripeClient } from "../../server/stripeClient";

const ORG = {
  id: 42,
  name: "Test Org",
  ownerId: "user_1",
  autoTopUpEnabled: true,
  autoTopUpThresholdCents: 500,
  autoTopUpAmountCents: 2500,
  creditBalance: "100", // below threshold → triggers
  stripeCustomerId: "cus_123",
};

beforeEach(() => {
  vi.clearAllMocks();
  selectQueue.length = 0;
  findFirstMock.mockResolvedValue({ ...ORG });
  customersRetrieveMock.mockResolvedValue({
    invoice_settings: { default_payment_method: "pm_1" },
  });
  paymentMethodsListMock.mockResolvedValue({ data: [{ id: "pm_1" }] });
});

describe("executeAutoTopUp — D2", () => {
  it("does nothing when settings don't trigger (balance above threshold)", async () => {
    findFirstMock.mockResolvedValue({ ...ORG, creditBalance: "10000" });
    const r = await usageMeteringService.executeAutoTopUp(42);
    expect(r).toEqual({ executed: false, reason: "not_triggered" });
    expect(paymentIntentCreateMock).not.toHaveBeenCalled();
  });

  it("disabled auto-top-up never charges", async () => {
    findFirstMock.mockResolvedValue({ ...ORG, autoTopUpEnabled: false });
    const r = await usageMeteringService.executeAutoTopUp(42);
    expect(r.executed).toBe(false);
    expect(paymentIntentCreateMock).not.toHaveBeenCalled();
  });

  it("skips while Stripe is unconfigured", async () => {
    vi.mocked(getUncachableStripeClient).mockRejectedValueOnce(new Error("no key"));
    const r = await usageMeteringService.executeAutoTopUp(42);
    expect(r).toEqual({ executed: false, reason: "stripe_unconfigured" });
  });

  it("ledger idempotency: a recent auto top-up blocks another charge", async () => {
    selectQueue.push([{ id: 99 }]); // idempotency lookback finds a recent auto topup
    const r = await usageMeteringService.executeAutoTopUp(42);
    expect(r).toEqual({ executed: false, reason: "recent_auto_topup" });
    expect(paymentIntentCreateMock).not.toHaveBeenCalled();
  });

  it("no card on file → honest skip, no charge", async () => {
    selectQueue.push([]); // no recent topup
    customersRetrieveMock.mockResolvedValue({ invoice_settings: {} });
    paymentMethodsListMock.mockResolvedValue({ data: [] });
    const r = await usageMeteringService.executeAutoTopUp(42);
    expect(r).toEqual({ executed: false, reason: "no_card_on_file" });
    expect(paymentIntentCreateMock).not.toHaveBeenCalled();
  });

  it("success: charges off-session, credits AFTER the charge, Letter-visible", async () => {
    selectQueue.push([]); // no recent topup
    selectQueue.push([{ email: "owner@example.com" }]); // owner email
    paymentIntentCreateMock.mockResolvedValue({ id: "pi_1" });
    const addCreditsSpy = vi
      .spyOn(creditService, "addCredits")
      .mockResolvedValue({} as any);

    const r = await usageMeteringService.executeAutoTopUp(42);

    expect(r).toEqual({ executed: true, reason: "charged" });
    expect(paymentIntentCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 2500,
        customer: "cus_123",
        payment_method: "pm_1",
        off_session: true,
        confirm: true,
      }),
      expect.objectContaining({ idempotencyKey: expect.stringContaining("auto-topup:42:") }),
    );
    expect(addCreditsSpy).toHaveBeenCalledWith(
      42,
      2500,
      "topup",
      expect.any(String),
      expect.objectContaining({ auto: "true", paymentIntentId: "pi_1" }),
    );
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ job: "billing", action: "auto_top_up_succeeded" }),
    );
    addCreditsSpy.mockRestore();
  });

  it("the $500/action hard-stop binds above customer config", async () => {
    findFirstMock.mockResolvedValue({ ...ORG, autoTopUpAmountCents: 200_000 }); // customer asked for $2,000
    selectQueue.push([]);
    selectQueue.push([]);
    paymentIntentCreateMock.mockResolvedValue({ id: "pi_2" });
    const addCreditsSpy = vi
      .spyOn(creditService, "addCredits")
      .mockResolvedValue({} as any);

    await usageMeteringService.executeAutoTopUp(42);

    expect(paymentIntentCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 50_000 }), // capped at $500
      expect.anything(),
    );
    expect(addCreditsSpy).toHaveBeenCalledWith(42, 50_000, "topup", expect.any(String), expect.anything());
    addCreditsSpy.mockRestore();
  });

  it("decline: credits NOTHING, records the failure Letter-visibly", async () => {
    selectQueue.push([]);
    selectQueue.push([{ email: "owner@example.com" }]);
    paymentIntentCreateMock.mockRejectedValue(new Error("card_declined"));
    const addCreditsSpy = vi.spyOn(creditService, "addCredits");

    const r = await usageMeteringService.executeAutoTopUp(42);

    expect(r).toEqual({ executed: false, reason: "charge_failed" });
    expect(addCreditsSpy).not.toHaveBeenCalled();
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ job: "billing", action: "auto_top_up_failed" }),
    );
    addCreditsSpy.mockRestore();
  });
});
