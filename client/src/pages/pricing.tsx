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
import { usePageMeta } from "@/hooks/use-document-title";

const TIERS = [
  {
    id: "free",
    name: "Free",
    price: 0,
    yearlyPrice: 0,
    description: "Explore the platform",
    cta: "Get started",
    highlighted: false,
  },
  {
    id: "starter",
    name: "Starter",
    price: 20,
    yearlyPrice: 192,
    description: "Replace your spreadsheet",
    cta: "Start 14-day free trial",
    highlighted: false,
  },
  {
    id: "pro",
    name: "Pro",
    price: 49,
    yearlyPrice: 470,
    description: "For serious operators",
    cta: "Start 14-day free trial",
    highlighted: true,
  },
  {
    id: "scale",
    name: "Scale",
    price: 79,
    yearlyPrice: 758,
    description: "For growing teams",
    cta: "Start 14-day free trial",
    highlighted: false,
  },
];

interface Feature {
  name: string;
  free: string | boolean;
  starter: string | boolean;
  pro: string | boolean;
  scale: string | boolean;
}

const FEATURES: Feature[] = [
  { name: "Leads", free: "10", starter: "250", pro: "500", scale: "Unlimited" },
  { name: "Properties", free: "3", starter: "50", pro: "100", scale: "Unlimited" },
  { name: "Notes", free: "2", starter: "25", pro: "50", scale: "Unlimited" },
  { name: "AI requests / day", free: "25", starter: "500", pro: "1,000", scale: "Unlimited" },
  { name: "Campaigns", free: false, starter: "5", pro: "Unlimited", scale: "Unlimited" },
  { name: "Sequences", free: false, starter: "2", pro: "Unlimited", scale: "Unlimited" },
  { name: "BYOK data providers", free: false, starter: false, pro: true, scale: true },
  { name: "Team seats", free: "1", starter: "1", pro: "2 (add more at $20/seat)", scale: "10 (add more at $40/seat)" },
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
  const [annual, setAnnual] = useState(false);
  usePageMeta(
    "Pricing",
    "Transparent plans for land investors — from the free tier to full-team tooling. CRM, direct mail, AI-powered due diligence, and seller financing in one platform."
  );

  return (
    <div className="min-h-screen bg-background">
      <SkipToContent />
      {/* Nav */}
      <nav className="border-b bg-background/95 backdrop-blur sticky top-0 z-50">
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

      {/* Header */}
      <section id="main-content" className="py-16 px-6 text-center">
        <h1 className="text-4xl font-bold">Simple, transparent pricing</h1>
        <p className="text-muted-foreground mt-3 max-w-lg mx-auto">
          Start free. Upgrade when you're ready. Every paid plan includes a <span className="tabular-nums">14</span>-day free trial.
        </p>

        {/* Billing toggle */}
        <div className="flex items-center justify-center gap-3 mt-8">
          <span className={`text-sm ${!annual ? "font-semibold" : "text-muted-foreground"}`}>
            Monthly
          </span>
          <button
            role="switch"
            aria-checked={annual}
            aria-label="Switch to annual billing"
            onClick={() => setAnnual(!annual)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              annual ? "bg-primary" : "bg-muted-foreground/30"
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                annual ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </button>
          <span className={`text-sm ${annual ? "font-semibold" : "text-muted-foreground"}`}>
            Annual
          </span>
          {annual && (
            <Badge variant="secondary" className="text-xs">
              Save 20%
            </Badge>
          )}
        </div>
      </section>

      {/* Tier cards */}
      <section className="px-6 pb-16">
        <div className="max-w-5xl mx-auto grid sm:grid-cols-4 gap-6">
          {TIERS.map((tier) => {
            const displayPrice = annual
              ? Math.round(tier.yearlyPrice / 12)
              : tier.price;
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
                  <p className="text-sm text-muted-foreground">{tier.description}</p>
                </CardHeader>
                <CardContent className="text-center space-y-4">
                  <div>
                    <span className="text-4xl font-bold tabular-nums">
                      {usd(displayPrice, { noCents: true })}
                    </span>
                    {tier.price > 0 && (
                      <span className="text-muted-foreground text-sm">/mo</span>
                    )}
                    {annual && tier.yearlyPrice > 0 && (
                      <p className="text-xs text-muted-foreground mt-1 tabular-nums">
                        {usd(tier.yearlyPrice, { noCents: true })}/year
                      </p>
                    )}
                  </div>
                  <Button
                    className="w-full"
                    variant={tier.highlighted ? "default" : "outline"}
                    asChild
                  >
                    <Link href="/auth?mode=register">{tier.cta}</Link>
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      {/* Feature comparison table */}
      <section className="px-6 pb-24">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-2xl font-bold text-center mb-2">Feature comparison</h2>
          <p className="text-xs text-muted-foreground text-center mb-6 sm:hidden">
            Swipe the table to compare all tiers →
          </p>
          <div className="border rounded-lg overflow-x-auto relative" role="region" aria-label="Plan feature comparison" tabIndex={0}>
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
            <a
              href="mailto:support@acreos.io"
              aria-label="Email support@acreos.io for enterprise pricing"
              className="text-primary hover:underline"
            >
              Contact us
            </a>
            .
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t py-8 px-6">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 text-sm text-muted-foreground">
          <span>&copy; {new Date().getFullYear()} AcreOS. All rights reserved.</span>
          <div className="flex flex-wrap gap-x-2 gap-y-1">
            <Link href="/" className="hover:text-foreground inline-flex items-center min-h-11 px-2">Home</Link>
            <Link href="/status" className="hover:text-foreground inline-flex items-center min-h-11 px-2">Status</Link>
            <Link href="/changelog" className="hover:text-foreground inline-flex items-center min-h-11 px-2">Changelog</Link>
            <Link href="/terms" className="hover:text-foreground inline-flex items-center min-h-11 px-2">Terms</Link>
            <Link href="/privacy" className="hover:text-foreground inline-flex items-center min-h-11 px-2">Privacy</Link>
            <Link href="/auth" className="hover:text-foreground inline-flex items-center min-h-11 px-2">Sign in</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
