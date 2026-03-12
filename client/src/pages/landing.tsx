import { useEffect } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  MapPin,
  TrendingUp,
  FileText,
  Bot,
  Users,
  BarChart3,
  Mail,
  Phone,
  DollarSign,
  Shield,
  Zap,
  CheckCircle2,
  ArrowRight,
  Building2,
  Target,
  Map,
} from "lucide-react";

const FEATURES = [
  {
    icon: Target,
    title: "CRM & Lead Pipeline",
    description: "Track every seller lead, automate follow-ups, and manage your entire acquisition funnel in one place.",
  },
  {
    icon: Bot,
    title: "AI Deal Intelligence",
    description: "AI-powered due diligence, AVM valuations, deal scoring, and negotiation coaching at every step.",
  },
  {
    icon: DollarSign,
    title: "Seller-Finance & Notes",
    description: "Manage seller-financed notes, payment schedules, and loan portfolios with full amortization tools.",
  },
  {
    icon: Mail,
    title: "Marketing Automation",
    description: "Email, SMS, and direct mail campaigns with AI-optimized sequences and A/B testing built in.",
  },
  {
    icon: Map,
    title: "Portfolio Mapping",
    description: "Visualize every property on an interactive map with parcel data, county layers, and market overlays.",
  },
  {
    icon: BarChart3,
    title: "Portfolio Analytics",
    description: "Real-time P&L, cash flow projections, IRR calculations, and portfolio-level performance dashboards.",
  },
  {
    icon: FileText,
    title: "Document Generation",
    description: "Generate purchase agreements, deeds, notes, and closing packages from customizable templates.",
  },
  {
    icon: Users,
    title: "Team Collaboration",
    description: "Bring your VA, acquisitions team, and disposition staff under one roof with role-based access.",
  },
];

const PLANS = [
  {
    name: "Free",
    price: "$0",
    period: "forever",
    description: "Try the platform with no credit card required.",
    features: ["50 leads", "10 properties", "5 notes", "Basic CRM", "100 AI credits/mo"],
    cta: "Start Free",
    highlight: false,
  },
  {
    name: "Starter",
    price: "$49",
    period: "/month",
    description: "Solo investors just getting started.",
    features: ["500 leads", "100 properties", "50 notes", "Email campaigns", "AI due diligence", "1,000 AI credits/mo"],
    cta: "Get Started",
    highlight: false,
  },
  {
    name: "Pro",
    price: "$149",
    period: "/month",
    description: "Growing businesses with a full toolkit.",
    features: [
      "5,000 leads",
      "1,000 properties",
      "500 notes",
      "Email + SMS + direct mail",
      "Full AI suite",
      "10 team members",
      "5,000 AI credits/mo",
    ],
    cta: "Get Started",
    highlight: true,
  },
  {
    name: "Scale",
    price: "$399",
    period: "/month",
    description: "High-volume operators who need unlimited scale.",
    features: [
      "Unlimited leads & properties",
      "Unlimited notes",
      "25 team members",
      "API access & webhooks",
      "Marketplace syndication",
      "Custom branding",
      "25,000 AI credits/mo",
    ],
    cta: "Get Started",
    highlight: false,
  },
];

export default function LandingPage() {
  // Capture UTM params and referral code from URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);

    // Persist referral code in localStorage so auth-page can pick it up at registration
    const ref = params.get("ref");
    if (ref) {
      localStorage.setItem("acreos_ref", ref.toUpperCase());
    }

    const utm = {
      utmSource: params.get("utm_source"),
      utmMedium: params.get("utm_medium"),
      utmCampaign: params.get("utm_campaign"),
      utmContent: params.get("utm_content"),
    };
    if (utm.utmSource || utm.utmMedium || utm.utmCampaign) {
      fetch("/api/auth/attribution", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(utm),
      }).catch(() => {}); // Non-fatal
    }
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Nav */}
      <header className="border-b border-border/50 sticky top-0 z-40 bg-background/80 backdrop-blur-sm">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-accent flex items-center justify-center">
              <span className="text-white font-bold text-sm">A</span>
            </div>
            <span className="font-bold text-lg">AcreOS</span>
          </div>
          <div className="flex items-center gap-3">
            <Button asChild variant="ghost" size="sm">
              <Link href="/auth">Sign In</Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/auth?mode=register">Get Started Free</Link>
            </Button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden py-24 px-4">
        <div className="absolute inset-0 bg-gradient-to-b from-primary/5 via-transparent to-transparent pointer-events-none" />
        <div className="max-w-4xl mx-auto text-center space-y-6 relative">
          <Badge variant="secondary" className="text-xs font-medium px-3 py-1">
            Land Investment Platform
          </Badge>
          <h1 className="text-5xl md:text-6xl font-bold leading-tight tracking-tight">
            The operating system
            <br />
            <span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
              built for land investors
            </span>
          </h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
            CRM, deal pipeline, seller-financed notes, AI assistants, marketing automation,
            and portfolio analytics — all in one platform designed for serious land operators.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
            <Button asChild size="lg" className="text-base font-semibold px-8">
              <Link href="/auth?mode=register">
                Start for Free <ArrowRight className="w-4 h-4 ml-2" />
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg" className="text-base">
              <Link href="/auth">Sign In</Link>
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">No credit card required · Free plan available</p>
        </div>
      </section>

      {/* Social proof bar */}
      <section className="border-y border-border/50 py-6 px-4 bg-muted/30">
        <div className="max-w-4xl mx-auto flex flex-wrap items-center justify-center gap-6 text-sm text-muted-foreground">
          {[
            { icon: Shield, label: "SOC-2 ready architecture" },
            { icon: Zap, label: "Built on OpenAI GPT-4" },
            { icon: Building2, label: "Multi-tenant & team-ready" },
            { icon: CheckCircle2, label: "Stripe-powered billing" },
          ].map(({ icon: Icon, label }) => (
            <div key={label} className="flex items-center gap-2">
              <Icon className="w-4 h-4 text-primary shrink-0" />
              <span>{label}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="py-24 px-4">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16 space-y-3">
            <h2 className="text-3xl md:text-4xl font-bold">Everything you need to run your land business</h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
              Stop cobbling together spreadsheets, CRMs, and email tools. AcreOS was purpose-built for land.
            </p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            {FEATURES.map(({ icon: Icon, title, description }) => (
              <div
                key={title}
                className="rounded-xl border border-border/60 bg-card p-5 space-y-3 hover:border-primary/40 hover:shadow-md transition-all"
              >
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Icon className="w-5 h-5 text-primary" />
                </div>
                <h3 className="font-semibold text-sm">{title}</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">{description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section className="py-24 px-4 bg-muted/20 border-t border-border/50">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16 space-y-3">
            <h2 className="text-3xl md:text-4xl font-bold">Simple, transparent pricing</h2>
            <p className="text-muted-foreground text-lg">
              Start free. Upgrade when you're ready.
            </p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            {PLANS.map((plan) => (
              <div
                key={plan.name}
                className={`rounded-xl border p-6 space-y-4 flex flex-col relative ${
                  plan.highlight
                    ? "border-primary bg-primary/5 shadow-lg shadow-primary/10"
                    : "border-border/60 bg-card"
                }`}
              >
                {plan.highlight && (
                  <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 text-xs">Most Popular</Badge>
                )}
                <div>
                  <h3 className="font-bold text-lg">{plan.name}</h3>
                  <p className="text-xs text-muted-foreground mt-1">{plan.description}</p>
                </div>
                <div className="flex items-baseline gap-1">
                  <span className="text-3xl font-bold">{plan.price}</span>
                  <span className="text-sm text-muted-foreground">{plan.period}</span>
                </div>
                <ul className="space-y-2 flex-1">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm">
                      <CheckCircle2 className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                <Button
                  asChild
                  variant={plan.highlight ? "default" : "outline"}
                  className="w-full mt-2"
                  size="sm"
                >
                  <Link href="/auth?mode=register">{plan.cta}</Link>
                </Button>
              </div>
            ))}
          </div>
          <p className="text-center text-sm text-muted-foreground mt-8">
            Need custom enterprise pricing?{" "}
            <a href="mailto:hello@acreos.io" className="text-primary hover:underline">
              Contact us
            </a>
          </p>
        </div>
      </section>

      {/* CTA */}
      <section className="py-24 px-4">
        <div className="max-w-2xl mx-auto text-center space-y-6">
          <h2 className="text-3xl md:text-4xl font-bold">Ready to run a tighter operation?</h2>
          <p className="text-muted-foreground text-lg">
            Join land investors who use AcreOS to close more deals with less chaos.
          </p>
          <Button asChild size="lg" className="text-base font-semibold px-10">
            <Link href="/auth?mode=register">
              Get Started Free <ArrowRight className="w-4 h-4 ml-2" />
            </Link>
          </Button>
          <p className="text-sm text-muted-foreground">No credit card required</p>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border/50 py-8 px-4">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded bg-gradient-to-br from-primary to-accent flex items-center justify-center">
              <span className="text-white font-bold text-xs">A</span>
            </div>
            <span className="font-medium text-foreground">AcreOS</span>
          </div>
          <div className="flex gap-6 flex-wrap justify-center">
            <Link href="/compare/lg-pass" className="hover:text-foreground transition-colors">vs LG Pass</Link>
            <Link href="/compare/geekpay" className="hover:text-foreground transition-colors">vs GeekPay</Link>
            <Link href="/terms" className="hover:text-foreground transition-colors">Terms</Link>
            <Link href="/privacy" className="hover:text-foreground transition-colors">Privacy</Link>
            <Link href="/auth" className="hover:text-foreground transition-colors">Sign In</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
