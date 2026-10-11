/**
 * W3 — the two priced acquisition products, both shipped with the price UNSET
 * (pricing is a founder-only hard stop):
 *
 *  Founding-member yearly offer (shared/billing/foundingMemberOffer.ts,
 *  server/routes-acquisition-offers.ts):
 *   - behind a feature flag AND refused while the plan or price is unset — the
 *     public endpoint then carries no price at all;
 *   - when offered, the California auto-renewal terms come with it (renews
 *     yearly, the amount, the 15–45-day reminder, online cancellation), the
 *     buyer must acknowledge them, and the checkout records the consent the
 *     acknowledgment e-mail and the renewal reminder run on;
 *   - no lifetime deal: a Stripe price that is not a yearly subscription — a
 *     one-time "lifetime" price — is refused, and so is one whose amount
 *     differs from the founder's price.
 *
 *  Per-parcel due-diligence report (shared/billing/parcelReportProduct.ts,
 *  server/services/parcelDdReport.ts):
 *   - refused while the price is unset — no credits move;
 *   - when priced, runs on the existing credit rail: one debit, idempotent per
 *     org and parcel, refused (402) without enough credits;
 *   - the report content is the same gated facts as the public page.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const h = vi.hoisted(() => ({
  flagOn: false,
  user: { id: "user-1", email: "buyer@example.test" } as any,
  org: { id: 7, name: "Org", stripeCustomerId: "cus_1", trialUsed: true } as any,
  getPrice: vi.fn(),
  createCheckoutSession: vi.fn(async () => ({ url: "https://checkout.test/s" })),
  ownedRow: null as any,
  purchases: [] as any[],
  deduct: vi.fn(),
}));

vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/utils/redis", () => ({ getRedisClient: async () => null }));
vi.mock("../../server/auth", () => ({
  isAuthenticated: (req: any, res: any, next: any) => {
    if (req.headers["x-test-anon"]) return res.status(401).json({ error: "UNAUTHORIZED" });
    req.user = h.user;
    next();
  },
}));
vi.mock("../../server/middleware/getOrCreateOrg", () => ({
  getOrCreateOrg: (req: any, _res: any, next: any) => {
    req.organization = h.org;
    req.organizationId = h.org.id;
    next();
  },
}));
vi.mock("../../server/utils/permissions", () => ({ requirePermission: () => (_req: any, _res: any, next: any) => next() }));
vi.mock("../../server/services/featureFlags", () => ({
  featureFlagService: { isEnabled: vi.fn(async () => h.flagOn) },
  buildFlagContext: () => ({}),
}));
vi.mock("../../server/stripeService", () => ({
  stripeService: { getPrice: h.getPrice, createCheckoutSession: h.createCheckoutSession, createCustomer: vi.fn() },
}));
vi.mock("../../server/storage", () => ({ storage: { updateOrganization: vi.fn() } }));
vi.mock("../../server/db", () => {
  const chain = (rows: () => any[]): any => {
    const c: any = { from: () => c, where: () => c, orderBy: () => c, limit: () => Promise.resolve(rows()), then: (r: any, j: any) => Promise.resolve(rows()).then(r, j) };
    return c;
  };
  return { db: { select: () => chain(() => h.purchases) } };
});
vi.mock("../../server/services/credits", () => ({ creditService: { deductCredits: h.deduct } }));
vi.mock("../../server/services/parcel/resolveParcel", () => ({ resolveParcel: vi.fn() }));
vi.mock("../../server/services/alertSpine", () => ({ raiseAlert: vi.fn() }));
vi.mock("../../server/services/landData/ownedParcelView", async (importOriginal) => {
  const real = await importOriginal<any>();
  return { ...real, findOwnedParcelByKey: vi.fn(async () => h.ownedRow) };
});

import { registerAcquisitionOfferRoutes, registerPublicOfferRoutes } from "../../server/routes-acquisition-offers";
import { FOUNDING_MEMBER_OFFER, foundingOfferAvailability } from "@shared/billing/foundingMemberOffer";
import { PARCEL_DD_REPORT } from "@shared/billing/parcelReportProduct";
import { pendingAcquisitionDecisions } from "../../server/services/acquisitionDecisions";
import { publicLandFactsOf } from "../../server/services/publicParcelReport";
import { ownedRowFor } from "../helpers/landFixtureFacts";
import { clearRateLimitStore } from "../../server/middleware/rateLimit";

const shipped = { offer: { ...FOUNDING_MEMBER_OFFER }, report: { ...PARCEL_DD_REPORT } };
function priceOffer() {
  Object.assign(FOUNDING_MEMBER_OFFER, { tier: "pro", priceYearlyCents: 39_000 });
  process.env[FOUNDING_MEMBER_OFFER.stripePriceEnv] = "price_founding";
}

function app() {
  const a = express();
  a.use(express.json());
  registerPublicOfferRoutes(a);
  registerAcquisitionOfferRoutes(a);
  return a;
}

beforeEach(async () => {
  h.flagOn = false;
  h.ownedRow = null;
  h.purchases = [];
  h.getPrice.mockReset();
  h.createCheckoutSession.mockClear();
  h.deduct.mockReset();
  await clearRateLimitStore();
});
afterEach(() => {
  Object.assign(FOUNDING_MEMBER_OFFER, shipped.offer);
  Object.assign(PARCEL_DD_REPORT, shipped.report);
  delete process.env[FOUNDING_MEMBER_OFFER.stripePriceEnv];
});

describe("founding-member yearly offer", () => {
  it("ships with the plan and the price unset, and yearly only", () => {
    expect(FOUNDING_MEMBER_OFFER.priceYearlyCents).toBeNull();
    expect(FOUNDING_MEMBER_OFFER.tier).toBeNull();
    expect(FOUNDING_MEMBER_OFFER.interval).toBe("year");
  });

  it("is refused while the flag is off, and while the price is unset even with the flag on", () => {
    expect(foundingOfferAvailability({ flagOn: false, stripePriceId: "p" })).toMatchObject({ available: false, reason: "flag_off" });
    expect(foundingOfferAvailability({ flagOn: true, stripePriceId: "p" })).toMatchObject({ available: false, reason: "price_unset" });
  });

  it("the public endpoint carries no price while it is unset", async () => {
    h.flagOn = true;
    const res = await request(app()).get("/api/public/offers/founding-member");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ available: false, reason: "price_unset" });
    expect(JSON.stringify(res.body)).not.toMatch(/priceCents|\$\d/);
  });

  it("when the founder has set it, the CA auto-renewal terms come with the offer — and no lifetime wording", async () => {
    h.flagOn = true;
    priceOffer();
    const res = await request(app()).get("/api/public/offers/founding-member");
    expect(res.body.available).toBe(true);
    const terms: string = res.body.offer.termsText;
    expect(terms).toContain("renews automatically every year at $390.00");
    expect(terms).toContain("Cancel any time online");
    expect(terms).toContain("15–45 days before each yearly renewal");
    expect(JSON.stringify(res.body)).not.toMatch(/lifetime/i);
  });

  it("checkout refuses without the buyer's acknowledgment of the renewal terms", async () => {
    h.flagOn = true;
    priceOffer();
    const res = await request(app()).post("/api/offers/founding-member/checkout").send({});
    expect(res.status).toBe(400);
    expect(h.createCheckoutSession).not.toHaveBeenCalled();
  });

  it("checkout refuses while the price is unset — nothing reaches Stripe", async () => {
    h.flagOn = true;
    const res = await request(app()).post("/api/offers/founding-member/checkout").send({ acknowledged: true });
    expect(res.status).toBe(422);
    expect(res.body.details.reason).toBe("price_unset");
    expect(h.getPrice).not.toHaveBeenCalled();
  });

  it("no lifetime deal: a one-time Stripe price is refused", async () => {
    h.flagOn = true;
    priceOffer();
    h.getPrice.mockResolvedValue({ id: "price_founding", type: "one_time", unit_amount: 39_000, currency: "usd", recurring: null });
    const res = await request(app()).post("/api/offers/founding-member/checkout").send({ acknowledged: true });
    expect(res.status).toBe(422);
    expect(res.body.details.reason).toBe("not_yearly");
    expect(h.createCheckoutSession).not.toHaveBeenCalled();
  });

  it("a Stripe price whose amount differs from the founder's price is refused", async () => {
    h.flagOn = true;
    priceOffer();
    h.getPrice.mockResolvedValue({ id: "price_founding", type: "recurring", unit_amount: 1_000, currency: "usd", recurring: { interval: "year" } });
    const res = await request(app()).post("/api/offers/founding-member/checkout").send({ acknowledged: true });
    expect(res.status).toBe(422);
    expect(res.body.details.reason).toBe("price_mismatch");
  });

  it("a valid checkout shows the terms beside the pay button and records the consent", async () => {
    h.flagOn = true;
    priceOffer();
    h.getPrice.mockResolvedValue({ id: "price_founding", type: "recurring", unit_amount: 39_000, currency: "usd", recurring: { interval: "year" } });
    const res = await request(app()).post("/api/offers/founding-member/checkout").send({ acknowledged: true });
    expect(res.status).toBe(200);
    expect(res.body.url).toBe("https://checkout.test/s");
    const [, priceId, , , metadata, trialDays, options] = h.createCheckoutSession.mock.calls[0] as any[];
    expect(priceId).toBe("price_founding");
    expect(trialDays).toBeUndefined();
    expect(options.renewalTerms).toContain("renews automatically every year");
    expect(metadata).toMatchObject({
      organizationId: "7",
      auto_renewal_interval: "year",
      auto_renewal_price_cents: "39000",
      offer: "founding_member_yearly",
    });
    expect(metadata.auto_renewal_terms_version).toBeTruthy();
    expect(metadata.terms_acknowledged_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe("per-parcel due-diligence report", () => {
  it("ships with the price unset", () => {
    expect(PARCEL_DD_REPORT.priceCents).toBeNull();
    expect(PARCEL_DD_REPORT.rail).toBe("credits");
  });

  it("is refused while the price is unset — no credits move", async () => {
    h.ownedRow = ownedRowFor(0);
    const offer = await request(app()).get(`/api/land-data/parcels/${encodeURIComponent(h.ownedRow.parcelKey)}/dd-report/offer`);
    expect(offer.body).toMatchObject({ available: false, reason: "price_unset" });
    const buy = await request(app()).post(`/api/land-data/parcels/${encodeURIComponent(h.ownedRow.parcelKey)}/dd-report`);
    expect(buy.status).toBe(422);
    expect(buy.body.details.reason).toBe("price_unset");
    expect(h.deduct).not.toHaveBeenCalled();
  });

  it("when priced: one credit debit, the gated facts as content, and a repeat costs nothing", async () => {
    Object.assign(PARCEL_DD_REPORT, { priceCents: 1_500 });
    h.ownedRow = ownedRowFor(0);
    h.deduct.mockResolvedValue({ id: 1 });
    const key = encodeURIComponent(h.ownedRow.parcelKey);
    const first = await request(app()).post(`/api/land-data/parcels/${key}/dd-report`);
    expect(first.status).toBe(200);
    expect(h.deduct).toHaveBeenCalledTimes(1);
    const [orgId, cents, , meta] = h.deduct.mock.calls[0];
    expect([orgId, cents]).toEqual([7, 1_500]);
    expect(meta).toMatchObject({ kind: "parcel_dd_report", parcelKey: h.ownedRow.parcelKey });
    expect(first.body.report.facts.rows).toEqual(JSON.parse(JSON.stringify(publicLandFactsOf(h.ownedRow).rows)));

    h.purchases = [{ id: 1 }]; // the debit now exists
    const again = await request(app()).post(`/api/land-data/parcels/${key}/dd-report`);
    expect(again.status).toBe(200);
    expect(again.body.charged).toBe(false);
    expect(h.deduct).toHaveBeenCalledTimes(1);
  });

  it("without enough credits it is 402 and nothing is delivered", async () => {
    Object.assign(PARCEL_DD_REPORT, { priceCents: 1_500 });
    h.ownedRow = ownedRowFor(0);
    h.deduct.mockResolvedValue(null);
    const res = await request(app()).post(`/api/land-data/parcels/${encodeURIComponent(h.ownedRow.parcelKey)}/dd-report`);
    expect(res.status).toBe(402);
    expect(res.body.report).toBeUndefined();
  });

  it("a parcel AcreOS does not keep is a 404 before any charge", async () => {
    Object.assign(PARCEL_DD_REPORT, { priceCents: 1_500 });
    const res = await request(app()).post(`/api/land-data/parcels/TN-47041-nope/dd-report`);
    expect(res.status).toBe(404);
    expect(h.deduct).not.toHaveBeenCalled();
  });
});

describe("the founder sees every open pricing decision", () => {
  it("lists the commission rate, the founding plan + price and the report price as pending", () => {
    const d = pendingAcquisitionDecisions();
    expect(d.map((x) => [x.key, x.status])).toEqual([
      ["creator_commission_rate", "pending"],
      ["founding_member_yearly", "pending"],
      ["parcel_dd_report_price", "pending"],
    ]);
  });
});
