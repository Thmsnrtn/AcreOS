import { useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Check, X, ArrowLeft } from "lucide-react";
import { AcreosLogo } from "@/components/acreos-logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { usd } from "@/lib/format";
import { SkipToContent } from "@/components/skip-to-content";
import { PublicFooter } from "@/components/public-footer";
import { usePageMeta } from "@/hooks/use-document-title";
import { TIER_LIMITS } from "@shared/billing/tier-limits";
import {
  PRICING_TIER_COPY,
  SCALE_SALES_MAILTO,
  displayMonthlyPrice,
  tierSignupHref,
} from "@/lib/pricing-copy";
import { JsonLd } from "@/components/seo/JsonLd";
import { OpenGraph } from "@/components/seo/OpenGraph";
import { pricingProductSchema, SITE } from "@/lib/jsonld-schemas";
import { SupportFeedbackButton } from "@/components/support-feedback-button";
import { VerticalPackSection } from "@/components/billing/VerticalPackSection";

// Tier cards (name / tagline / price / CTA) come from the shared
// pricing-copy module — the single source both this page and the landing
// Pricing section render. Prices inside it derive from
// shared/billing/tier-pricing.ts so this page can never drift from the
// MRR math in /api/founder/executive-dashboard or the Stripe checkout.

interface Feature {
  name: string;
  free: string | boolean;
  starter: string | boolean;
  pro: string | boolean;
  scale: string | boolean;
}

// Lens 3 (Pricing Coherence) — numeric rows read straight from
// shared/billing/tier-limits.ts. Hardcoded numbers here drift; the source
// of truth is the same module the server gate (`checkUsageLimit`) reads.
function fmtCount(value: number | null): string {
  return value === null ? "Unlimited" : value.toLocaleString("en-US");
}
function fmtCountOrCross(value: number | null): string | boolean {
  if (value === null) return "Unlimited";
  if (value === 0) return false;
  return value.toLocaleString("en-US");
}
function fmtSeats(tier: "free" | "starter" | "pro" | "scale"): string {
  const t = TIER_LIMITS[tier];
  if (t.seatPriceCents === null) return t.includedSeats.toLocaleString("en-US");
  const perSeat = `$${t.seatPriceCents / 100}/seat`;
  return `${t.includedSeats} (add more at ${perSeat})`;
}

const FEATURES: Feature[] = [
  {
    name: "Leads",
    free: fmtCount(TIER_LIMITS.free.leads),
    starter: fmtCount(TIER_LIMITS.starter.leads),
    pro: fmtCount(TIER_LIMITS.pro.leads),
    scale: fmtCount(TIER_LIMITS.scale.leads),
  },
  {
    name: "Properties",
    free: fmtCount(TIER_LIMITS.free.properties),
    starter: fmtCount(TIER_LIMITS.starter.properties),
    pro: fmtCount(TIER_LIMITS.pro.properties),
    scale: fmtCount(TIER_LIMITS.scale.properties),
  },
  {
    name: "Notes",
    free: fmtCount(TIER_LIMITS.free.notes),
    starter: fmtCount(TIER_LIMITS.starter.notes),
    pro: fmtCount(TIER_LIMITS.pro.notes),
    scale: fmtCount(TIER_LIMITS.scale.notes),
  },
  {
    name: "Pax messages / month",
    free: fmtCount(TIER_LIMITS.free.ai_requests),
    starter: fmtCount(TIER_LIMITS.starter.ai_requests),
    pro: fmtCount(TIER_LIMITS.pro.ai_requests),
    scale: fmtCount(TIER_LIMITS.scale.ai_requests),
  },
  {
    name: "Campaigns",
    // W2.1: the free tier ships a 5-piece lifetime first send (the wedge) —
    // a bare ✗ here contradicted the in-app checklist's "first 5 pieces on
    // us" promise on the very page meant to convert.
    free: "5 letters free",
    starter: fmtCountOrCross(TIER_LIMITS.starter.campaigns),
    pro: fmtCountOrCross(TIER_LIMITS.pro.campaigns),
    scale: fmtCountOrCross(TIER_LIMITS.scale.campaigns),
  },
  {
    name: "Sequences",
    free: fmtCountOrCross(TIER_LIMITS.free.sequences),
    starter: fmtCountOrCross(TIER_LIMITS.starter.sequences),
    pro: fmtCountOrCross(TIER_LIMITS.pro.sequences),
    scale: fmtCountOrCross(TIER_LIMITS.scale.sequences),
  },
  {
    name: "BYOK data providers",
    free: TIER_LIMITS.free.byokSupport,
    starter: TIER_LIMITS.starter.byokSupport,
    pro: TIER_LIMITS.pro.byokSupport,
    scale: TIER_LIMITS.scale.byokSupport,
  },
  {
    name: "Team seats",
    free: fmtSeats("free"),
    starter: fmtSeats("starter"),
    pro: fmtSeats("pro"),
    scale: fmtSeats("scale"),
  },
  {
    // Credits are the tangible "data + mail allowance" each tier carries
    // (1 credit ≈ $0.01 of provider cost — shared/billing/credit-weights.ts).
    // Surfacing them here was part of the 2026-07-08 pricing decision:
    // subscription buys adoption, credits carry the variable value.
    name: "Data & mail credits / month",
    free: fmtCount(TIER_LIMITS.free.creditPool),
    starter: fmtCount(TIER_LIMITS.starter.creditPool),
    pro: fmtCount(TIER_LIMITS.pro.creditPool),
    scale: fmtCount(TIER_LIMITS.scale.creditPool),
  },
  { name: "Data sources (6 free + 3 premium)", free: true, starter: true, pro: true, scale: true },
  { name: "AI deal intelligence", free: true, starter: true, pro: true, scale: true },
  { name: "Document generation", free: true, starter: true, pro: true, scale: true },
  { name: "Portfolio mapping", free: true, starter: true, pro: true, scale: true },
  { name: "Stripe Connect payments", free: false, starter: true, pro: true, scale: true },
  { name: "Direct mail integration", free: false, starter: true, pro: true, scale: true },
  { name: "SMS/voice outreach", free: false, starter: false, pro: true, scale: true },
  { name: "Priority support", free: false, starter: false, pro: true, scale: true },
];

function FeatureValue({ value }: { value: string | boolean }) {
  if (value === true)
    return (
      <>
        <Check className="h-4 w-4 text-acr-pos mx-auto" aria-hidden="true" />
        <span className="sr-only">Included</span>
      </>
    );
  if (value === false)
    return (
      <>
        <X className="h-4 w-4 text-muted-foreground/30 mx-auto" aria-hidden="true" />
        <span className="sr-only">Not included</span>
      </>
    );
  return <span className="text-sm text-center">{value}</span>;
}

export default function PricingPage() {
  // Default to annual so this surface matches the landing Pricing section
  // (landing/Pricing.tsx defaults annual=true). Prospects who saw $41 on the
  // landing must not see $49 the moment they hit Settings → Billing.
  const [annual, setAnnual] = useState(true);
  usePageMeta(
    "Pricing",
    "Transparent plans for Land Investors — from the free tier to full-team tooling. CRM, direct mail, automated due diligence, and seller financing in one platform."
  );

  return (
    <div className="min-h-screen bg-background">
      <SkipToContent />
      <OpenGraph
        url={`${SITE.url}/pricing`}
        title="Pricing · AcreOS"
        description="Transparent plans for Land Investors — from the free tier to full-team tooling. CRM, direct mail, automated due diligence, and seller financing in one platform."
        type="product"
      />
      <JsonLd id="ld-pricing-product" data={pricingProductSchema()} />
      {/* Nav */}
      <nav className="border-b bg-surface-chrome backdrop-blur sticky top-0 z-floating">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity min-h-11 py-1">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            <AcreosLogo size={30} />
          </Link>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Button asChild>
              <Link href="/auth?mode=register" className="min-h-11">Get started</Link>
            </Button>
          </div>
        </div>
      </nav>

      {/* Header — lead with the data narrative (Soren §4): the free tier
          already runs premium government data; paid data comes when you scale. */}
      <section id="main-content" className="py-16 px-6 text-center">
        <h1 className="text-4xl font-bold">Premium government data, free. Paid data when you scale.</h1>
        <p className="text-muted-foreground mt-3 max-w-2xl mx-auto">
          The free tier runs flood, soil, elevation, and wetlands checks from
          government data on every parcel — no card. Reach for paid providers
          only when your deal volume earns them. Every paid plan includes a{" "}
          <span className="tabular-nums">14</span>-day free trial and a{" "}
          <span className="tabular-nums">30</span>-day money-back guarantee.
        </p>
        {/* Founding-member pricing — 2026-07-08 founder decision: launch
            prices are held for the first cohort for as long as they stay
            subscribed; list prices rise afterward. Honest mechanism: Stripe
            subscriptions keep their price on later list changes. */}
        <p
          className="mt-4 max-w-2xl mx-auto text-sm font-medium text-primary"
          data-testid="founding-member-note"
        >
          Founding-member pricing: these are launch prices. The first 25
          customers keep them for as long as they stay subscribed — list
          prices rise after that.
        </p>

        {/* Billing toggle */}
        <div className="flex items-center justify-center gap-3 mt-8">
          <span className={`text-sm ${!annual ? "font-semibold" : "text-muted-foreground"}`}>
            Monthly
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={annual}
            aria-label="Annual billing"
            onClick={() => setAnnual(!annual)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
              annual ? "bg-primary" : "bg-muted-foreground/30"
            }`}
          >
            <span
              aria-hidden="true"
              className={`inline-block h-4 w-4 transform rounded-full bg-background transition-transform ${
                annual ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </button>
          <span className={`text-sm ${annual ? "font-semibold" : "text-muted-foreground"}`}>
            Annual
          </span>
          {annual && (
            <Badge variant="secondary" className="text-xs">
              Save 17%
            </Badge>
          )}
        </div>
        {annual && (
          <p className="text-center text-xs text-muted-foreground mt-3">
            Pay by ACH on yearly plans to save ~$18 in processing fees per payment.
          </p>
        )}
      </section>

      {/* Tier cards */}
      <section className="px-6 pb-16">
        <div className="max-w-5xl mx-auto grid sm:grid-cols-4 gap-6">
          {PRICING_TIER_COPY.map((tier) => {
            const displayPrice = displayMonthlyPrice(tier, annual);
            return (
              <Card
                key={tier.id}
                className={`relative ${
                  tier.highlighted
                    ? "border-primary shadow-lg ring-1 ring-primary/20"
                    : ""
                }`}
              >
                {tier.highlighted && (
                  <Badge className="absolute -top-3 left-1/2 -translate-x-1/2">
                    Most popular
                  </Badge>
                )}
                <CardHeader className="text-center pb-2">
                  <CardTitle className="text-lg">{tier.name}</CardTitle>
                  <p className="text-sm text-muted-foreground">{tier.tagline}</p>
                </CardHeader>
                <CardContent className="text-center space-y-4">
                  <div>
                    <span className="text-4xl font-bold tabular-nums">
                      {usd(displayPrice, { noCents: true })}
                    </span>
                    {tier.priceMonthly > 0 && (
                      <span className="text-muted-foreground text-sm">/mo</span>
                    )}
                    {annual && tier.priceYearly > 0 && (
                      <p className="text-xs text-muted-foreground mt-1 tabular-nums">
                        {usd(tier.priceYearly, { noCents: true })}/year
                      </p>
                    )}
                  </div>
                  <Button
                    className="w-full"
                    variant={tier.highlighted ? "default" : "outline"}
                    asChild
                  >
                    {tier.salesAssisted ? (
                      // Sales-assisted Scale path — mailto matches the
                      // landing page (landing/Pricing.tsx) so both surfaces
                      // tell the same story. No fake self-serve trial.
                      <a
                        href={SCALE_SALES_MAILTO}
                        data-testid="cta-scale-mailto"
                      >
                        {tier.ctaLabel}
                      </a>
                    ) : (
                      // Tier 2C — carry tier + cadence into the signup URL;
                      // capturePendingUtm() folds plan/billing into the
                      // first-touch snapshot for funnel segmentation.
                      <Link
                        href={tierSignupHref(tier.id, annual ? "yearly" : "monthly")}
                      >
                        {tier.ctaLabel}
                      </Link>
                    )}
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
        {/* Trust microcopy under the pricing cards. The /security page
            describes encryption + SOC 2 in flight; surface a one-liner
            at the moment the user is about to give us their card. */}
        <div className="mt-8 mx-auto max-w-2xl text-center text-xs text-muted-foreground">
          {/* FTC negative-option rule: auto-renewal terms + the cancel
              mechanism must be disclosed BEFORE billing info is collected,
              and cancelling must be as easy as subscribing. Keep this
              sentence next to the CTAs. */}
          <span data-testid="auto-renewal-disclosure">
            Paid plans renew automatically each billing period (monthly or
            yearly, as selected) until you cancel. Cancel anytime in Settings
            &rarr; Billing — it takes effect at the end of the current period,
            no calls and no forms.
          </span>{" "}
          Payments processed by Stripe. Your card never touches our servers.
          Every paid plan is backed by a <span className="tabular-nums">30</span>-day
          money-back guarantee — see our{" "}
          <Link href="/terms" className="underline hover:text-foreground">
            terms
          </Link>{" "}
          for details.{" "}
          <Link href="/security" className="underline hover:text-foreground">
            How we keep your data safe
          </Link>
          .
        </div>
      </section>

      {/* Vertical packs — add-on subscriptions on top of any paid tier.
          Real catalog data from GET /api/billing/packs (which reads
          VERTICAL_PACKS in shared/billing/tier-pricing.ts); waitlisted
          verticals stay visible with honest framing, never hidden. */}
      <VerticalPackSection annual={annual} />

      {/* Feature comparison table */}
      <section className="px-6 pb-24">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-2xl font-bold text-center mb-2">Feature comparison</h2>
          <p className="text-xs text-muted-foreground text-center mb-6 sm:hidden">
            Swipe the table to compare all tiers →
          </p>
          <div className="border rounded-card overflow-x-auto relative" role="region" aria-label="Plan feature comparison" tabIndex={0}>
            {/* min-w-[640px] forces the comparison table to keep its
                natural width on mobile instead of crushing columns;
                the parent overflow-x-auto gives horizontal scroll. */}
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th scope="col" className="text-left p-3 font-medium">Feature</th>
                  <th scope="col" className="text-center p-3 font-medium w-28">Free</th>
                  <th scope="col" className="text-center p-3 font-medium w-28">Starter</th>
                  <th scope="col" className="text-center p-3 font-medium w-28 text-primary">Pro</th>
                  <th scope="col" className="text-center p-3 font-medium w-28">Scale</th>
                </tr>
              </thead>
              <tbody>
                {FEATURES.map((feature, i) => (
                  <tr key={feature.name} className={i % 2 === 0 ? "bg-background" : "bg-muted/20"}>
                    <th scope="row" className="p-3 font-medium text-left">{feature.name}</th>
                    <td className="p-3 text-center">
                      <FeatureValue value={feature.free} />
                    </td>
                    <td className="p-3 text-center">
                      <FeatureValue value={feature.starter} />
                    </td>
                    <td className="p-3 text-center">
                      <FeatureValue value={feature.pro} />
                    </td>
                    <td className="p-3 text-center">
                      <FeatureValue value={feature.scale} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-center text-sm text-muted-foreground mt-8">
            Need custom enterprise pricing?{" "}
            <SupportFeedbackButton
              variant="link"
              defaultCategory="question"
              source="pricing_enterprise"
              ariaLabel="Open support form for enterprise pricing"
              testId="pricing-enterprise-contact"
            >
              Contact us
            </SupportFeedbackButton>
            .
          </p>
        </div>
      </section>

      {/* Footer — shared across customer-trust pages so discoverability
          for /security and /changelog (P1-5) lives in one place. */}
      <PublicFooter />
    </div>
  );
}
