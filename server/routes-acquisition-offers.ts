/**
 * The two priced W3 acquisition products — both ship with the price UNSET and
 * refuse until the founder sets it (pricing is a founder-only hard stop).
 *
 *   GET  /api/public/offers/founding-member           is the founding-member yearly offer
 *                                                     open? (flag + plan + price + Stripe
 *                                                     price); no price is sent while unset
 *   POST /api/offers/founding-member/checkout         signed-in, billing permission; requires
 *                                                     the buyer's acknowledgment of the
 *                                                     auto-renewal terms; refuses any Stripe
 *                                                     price that is not a yearly subscription
 *                                                     of exactly the founder's price (no
 *                                                     lifetime deals)
 *   GET  /api/land-data/parcels/:parcelKey/dd-report/offer   the report's price, or why not for sale
 *   POST /api/land-data/parcels/:parcelKey/dd-report         buy (existing credit rail) and deliver
 *   GET  /api/land-data/parcels/:parcelKey/dd-report         re-deliver a report already bought
 *
 * The founding checkout records the same consent metadata as /api/stripe/checkout
 * (auto_renewal_*), so the W1 acknowledgment e-mail, the 15–45-day yearly
 * reminder and the one-click cancel in Settings → Billing all apply unchanged.
 */
import type { Express, Response } from "express";
import { z } from "zod";
import { AUTO_RENEWAL_TERMS_VERSION } from "@shared/billing/autoRenewalTerms";
import { FOUNDING_MEMBER_OFFER, foundingOfferAvailability } from "@shared/billing/foundingMemberOffer";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { requirePermission } from "./utils/permissions";
import { getOrganizationId, type AuthenticatedRequest } from "./types/request";
import { Errors } from "./utils/errors";
import { featureFlagService } from "./services/featureFlags";
import { ddReportOffer, purchaseDdReport, purchasedDdReport } from "./services/parcelDdReport";
import { clock } from "./utils/clock";

function stripePriceId(): string | null {
  const v = process.env[FOUNDING_MEMBER_OFFER.stripePriceEnv];
  return v && v.length > 0 ? v : null;
}

async function availability() {
  // Anonymous context: the public page opens only when the flag is fully on.
  const flagOn = await featureFlagService.isEnabled(FOUNDING_MEMBER_OFFER.flagKey, {});
  return foundingOfferAvailability({ flagOn, stripePriceId: stripePriceId() });
}

const parcelKeyParam = (raw: unknown) => String(raw ?? "").slice(0, 200);

/**
 * The public, no-auth half: mounted with the other public routes in
 * server/routes.ts, AHEAD of the global /api auth gate (mounting it with the
 * signed-in half made a stranger's offer page read 401 "Session expired").
 */
export function registerPublicOfferRoutes(app: Express): void {
  app.get("/api/public/offers/founding-member", async (_req, res: Response) => {
    try {
      const a = await availability();
      res.setHeader("Cache-Control", "no-store");
      return res.json(a);
    } catch (err) {
      return Errors.internal(res, err);
    }
  });
}

/** The signed-in half: founding checkout and the due-diligence report. */
export function registerAcquisitionOfferRoutes(app: Express): void {

  app.post(
    "/api/offers/founding-member/checkout",
    isAuthenticated,
    getOrCreateOrg,
    requirePermission("canManageBilling"),
    async (req: AuthenticatedRequest, res: Response) => {
      const parsed = z.object({ acknowledged: z.literal(true) }).safeParse(req.body ?? {});
      if (!parsed.success) {
        return Errors.badRequest(res, "Please confirm you have read the automatic-renewal terms before checking out.", { reason: "terms_not_acknowledged" });
      }
      try {
        const a = await availability();
        if (!a.available) return Errors.unprocessable(res, a.message, { reason: a.reason });
        const priceId = stripePriceId()!;
        const { stripeService } = await import("./stripeService");
        const price = (await stripeService.getPrice(priceId)) as {
          type?: string;
          unit_amount?: number | null;
          currency?: string;
          recurring?: { interval?: string } | null;
        } | null;
        // No lifetime deals: only a yearly recurring price is sellable here.
        if (!price || price.type !== "recurring" || price.recurring?.interval !== "year") {
          return Errors.unprocessable(res, "The configured price is not a yearly subscription, so it cannot be sold as this offer.", { reason: "not_yearly" });
        }
        if (price.unit_amount !== a.offer.priceYearlyCents || (price.currency ?? "usd").toLowerCase() !== a.offer.currency) {
          return Errors.unprocessable(res, "The configured Stripe price does not match the founder's price for this offer.", { reason: "price_mismatch" });
        }

        const org = req.organization!;
        let customerId: string | null = org.stripeCustomerId ?? null;
        if (!customerId) {
          const { storage } = await import("./storage");
          const customer = await stripeService.createCustomer(req.user!.email, req.user!.id, org.name);
          await storage.updateOrganization(org.id, { stripeCustomerId: customer.id });
          customerId = customer.id;
        }
        const host = `${req.protocol}://${req.get("host")}`;
        const session = await stripeService.createCheckoutSession(
          customerId,
          priceId,
          `${host}/settings?subscription=success`,
          `${host}/pricing/founding-member?checkout=cancelled`,
          {
            organizationId: String(getOrganizationId(req)),
            offer: "founding_member_yearly",
            // Consent verification (Cal. Bus. & Prof. Code § 17602(a)(6)):
            // which terms were shown and when the buyer acknowledged them.
            auto_renewal_terms_version: AUTO_RENEWAL_TERMS_VERSION,
            auto_renewal_plan: a.offer.planName,
            auto_renewal_price_cents: String(a.offer.priceYearlyCents),
            auto_renewal_interval: "year",
            auto_renewal_currency: a.offer.currency,
            auto_renewal_trial_days: "0",
            terms_acknowledged_at: clock.now().toISOString(),
          },
          undefined, // founding members pay the year up front: no trial
          { enableAch: true, renewalTerms: a.offer.termsText },
        );
        return res.json({ url: session.url });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  app.get("/api/land-data/parcels/:parcelKey/dd-report/offer", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      return res.json(await ddReportOffer(getOrganizationId(req), parcelKeyParam(req.params.parcelKey)));
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  app.post("/api/land-data/parcels/:parcelKey/dd-report", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const r = await purchaseDdReport(getOrganizationId(req), parcelKeyParam(req.params.parcelKey));
      if (!r.ok) {
        if (r.reason === "not_kept") return Errors.notFound(res, "Parcel");
        if (r.reason === "insufficient_credits") return Errors.paymentRequired(res, r.message, { reason: r.reason });
        return Errors.unprocessable(res, r.message, { reason: r.reason });
      }
      return res.json({ charged: r.charged, priceCents: r.priceCents, report: r.report });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  app.get("/api/land-data/parcels/:parcelKey/dd-report", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const report = await purchasedDdReport(getOrganizationId(req), parcelKeyParam(req.params.parcelKey));
      if (!report) return Errors.notFound(res, "Report");
      return res.json({ report });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });
}
