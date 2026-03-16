import { useEffect } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  MapPin,
  TrendingUp,
  FileText,
  Bot,
  Brain,
  Zap,
  Shield,
  Users,
  BarChart3,
  Banknote,
  CheckCircle,
  CheckCircle2,
  ArrowRight,
  Star,
  Globe,
  Target,
  Mail,
  Phone,
  Building2,
  ChevronRight,
  Sparkles,
  DollarSign,
  PieChart,
  GitBranch,
  Map,
} from "lucide-react";

const FEATURES = [
  {
    icon: Brain,
    title: "AI-Powered Deal Intelligence",
    description: "Atlas, your AI co-pilot, surfaces the best opportunities, predicts seller intent, and generates personalized offers automatically.",
    color: "text-violet-500",
    bg: "bg-violet-50 dark:bg-violet-900/20",
  },
  {
    icon: MapPin,
    title: "Interactive Property Maps",
    description: "Visualize your entire portfolio on live satellite maps with parcel overlays, zoning data, and demand heat maps.",
    color: "text-primary",
    bg: "bg-primary/10",
  },
  {
    icon: TrendingUp,
    title: "Automated Valuations (AVM)",
    description: "Instant AI-driven land valuations trained on millions of comparable transactions — bulk or single property.",
    color: "text-emerald-500",
    bg: "bg-emerald-50 dark:bg-emerald-900/20",
  },
  {
    icon: Banknote,
    title: "Seller Finance Management",
    description: "Track every note, payment schedule, and amortization in one place. Automated payment reminders included.",
    color: "text-amber-500",
    bg: "bg-amber-50 dark:bg-amber-900/20",
  },
  {
    icon: Mail,
    title: "Marketing Automation",
    description: "Multi-channel outreach via direct mail, email, and SMS. AI-optimized sequences that follow up for you.",
    color: "text-blue-500",
    bg: "bg-blue-50 dark:bg-blue-900/20",
  },
  {
    icon: BarChart3,
    title: "Portfolio Analytics",
    description: "Real-time P&L, cash flow forecasting, IRR tracking, and market comparables across your entire portfolio.",
    color: "text-rose-500",
    bg: "bg-rose-50 dark:bg-rose-900/20",
  },
  {
    icon: FileText,
    title: "Document Intelligence",
    description: "Auto-generate purchase agreements, deeds, and closing documents. AI extraction from any land document.",
    color: "text-indigo-500",
    bg: "bg-indigo-50 dark:bg-indigo-900/20",
  },
  {
    icon: Shield,
    title: "Compliance & Risk",
    description: "TCPA, Dodd-Frank, and state-level compliance checks built-in. Regulatory intelligence alerts before you need them.",
    color: "text-slate-500",
    bg: "bg-slate-50 dark:bg-slate-900/20",
  },
  {
    icon: Users,
    title: "Team Collaboration",
    description: "Bring your VA, acquisitions team, and disposition staff under one roof with role-based access.",
    color: "text-cyan-500",
    bg: "bg-cyan-50 dark:bg-cyan-900/20",
  },
];

const STATS = [
  { value: "10,000+", label: "Active Properties Tracked" },
  { value: "99.9%", label: "Platform Uptime" },
  { value: "$2B+", label: "Portfolio Value Managed" },
  { value: "50+", label: "AI-Powered Tools" },
];

const HOW_IT_WORKS = [
  {
    step: "01",
    title: "Import Your Pipeline",
    description: "Connect your existing data via CSV, or pull directly from county records. AcreOS enriches every lead automatically.",
  },
  {
    step: "02",
    title: "Let Atlas Work",
    description: "Your AI assistant prioritizes the best opportunities, runs comps, generates offers, and sequences follow-ups hands-free.",
  },
  {
    step: "03",
    title: "Close More Deals",
    description: "Track every deal from offer to closing with real-time pipeline visibility, e-signatures, and document generation.",
  },
];

const TESTIMONIALS = [
  {
    quote: "AcreOS replaced 5 different tools we were using. The AI valuations alone save our team 20+ hours a week on research.",
    author: "Marcus T.",
    role: "Land Fund Manager",
    stars: 5,
  },
  {
    quote: "The direct mail automation and seller intent scoring has tripled our response rates. This platform just works.",
    author: "Sarah K.",
    role: "Land Investor, Texas",
    stars: 5,
  },
  {
    quote: "Finally a CRM built specifically for land. The seller finance tracking and portfolio analytics are world-class.",
    author: "James R.",
    role: "Acquisitions Director",
    stars: 5,
  },
];

const PRICING = [
  {
    name: "Free",
    price: "$0",
    period: "forever",
    description: "Try the platform with no credit card required.",
    features: ["50 leads", "10 properties", "5 notes", "Basic CRM", "100 AI credits/mo"],
    cta: "Start Free",
    highlighted: false,
  },
  {
    name: "Starter",
    price: "$97",
    period: "/mo",
    description: "Perfect for solo operators just getting started.",
    features: [
      "Up to 500 leads",
      "Basic AI valuations",
      "Email & SMS campaigns",
      "Pipeline CRM",
      "Document generation",
      "2 team members",
    ],
    cta: "Start Free Trial",
    highlighted: false,
  },
  {
    name: "Pro",
    price: "$297",
    period: "/mo",
    description: "For serious operators scaling their operation.",
    features: [
      "Unlimited leads",
      "Advanced AVM (bulk valuations)",
      "AI seller intent scoring",
      "Direct mail automation",
      "Full portfolio analytics",
      "Negotiation Copilot",
      "10 team members",
      "Priority support",
    ],
    cta: "Start Free Trial",
    highlighted: true,
    badge: "Most Popular",
  },
  {
    name: "Scale",
    price: "$797",
    period: "/mo",
    description: "Enterprise power for multi-market operators.",
    features: [
      "Everything in Pro",
      "White-label platform",
      "Capital markets access",
      "Land credit scoring",
      "Custom integrations",
      "Dedicated AI model training",
      "Unlimited team members",
      "Dedicated success manager",
    ],
    cta: "Contact Sales",
    highlighted: false,
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
      {/* Navigation */}
      <nav className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center shrink-0">
                <span className="text-white font-bold text-base">A</span>
              </div>
              <span className="text-xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                AcreOS
              </span>
            </div>

            <div className="hidden md:flex items-center gap-6 text-sm font-medium text-muted-foreground">
              <a href="#features" className="hover:text-foreground transition-colors">Features</a>
              <a href="#how-it-works" className="hover:text-foreground transition-colors">How It Works</a>
              <a href="#pricing" className="hover:text-foreground transition-colors">Pricing</a>
            </div>

            <div className="flex items-center gap-3">
              <Button asChild variant="ghost" size="sm">
                <Link href="/auth">Sign In</Link>
              </Button>
              <Button asChild size="sm" className="hidden sm:flex">
                <Link href="/auth">Start Free Trial</Link>
              </Button>
            </div>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative overflow-hidden pt-20 pb-28 px-4 sm:px-6 lg:px-8">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-accent/5 pointer-events-none" />
        <div className="max-w-5xl mx-auto text-center space-y-8 relative">
          <Badge variant="outline" className="px-4 py-1.5 text-sm font-medium border-primary/30 text-primary gap-2">
            <Sparkles className="w-3.5 h-3.5" />
            Now with Atlas AI — your intelligent land deal co-pilot
          </Badge>

          <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold tracking-tight leading-tight">
            The Operating System
            <br />
            <span className="bg-gradient-to-r from-primary via-accent to-primary bg-clip-text text-transparent">
              for Land Investors
            </span>
          </h1>

          <p className="text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
            AcreOS brings your entire land business into one AI-powered platform — from lead acquisition and seller outreach to deal closing, finance management, and portfolio analytics.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button asChild size="lg" className="text-base px-8 h-12 gap-2">
              <Link href="/auth">
                Start Free 14-Day Trial
                <ArrowRight className="w-4 h-4" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="text-base px-8 h-12">
              <a href="#features">See All Features</a>
            </Button>
          </div>

          <p className="text-sm text-muted-foreground">
            No credit card required · 14-day free trial · Cancel anytime
          </p>
        </div>
      </section>

      {/* Stats Bar */}
      <section className="border-y bg-muted/40">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            {STATS.map((stat) => (
              <div key={stat.label} className="text-center">
                <div className="text-3xl font-bold text-primary">{stat.value}</div>
                <div className="text-sm text-muted-foreground mt-1">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section id="features" className="py-24 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16 space-y-4">
            <Badge variant="outline" className="text-sm">Features</Badge>
            <h2 className="text-4xl font-bold">Everything you need to dominate land</h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              50+ AI-powered tools purpose-built for land investors. Replace your entire software stack with one platform.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {FEATURES.map((feature) => {
              const Icon = feature.icon;
              return (
                <Card key={feature.title} className="border hover:shadow-md transition-shadow">
                  <CardContent className="p-6 space-y-4">
                    <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${feature.bg}`}>
                      <Icon className={`w-5 h-5 ${feature.color}`} />
                    </div>
                    <div>
                      <h3 className="font-semibold text-sm mb-1.5">{feature.title}</h3>
                      <p className="text-xs text-muted-foreground leading-relaxed">{feature.description}</p>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      </section>

      {/* Feature Highlight: Atlas AI */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 bg-gradient-to-br from-violet-50 to-primary/5 dark:from-violet-950/20 dark:to-primary/5">
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
            <div className="space-y-6">
              <Badge variant="outline" className="border-violet-300 text-violet-600 dark:text-violet-400">
                <Sparkles className="w-3.5 h-3.5 mr-1.5" />
                Atlas AI
              </Badge>
              <h2 className="text-4xl font-bold leading-tight">
                Your intelligent land deal co-pilot
              </h2>
              <p className="text-lg text-muted-foreground leading-relaxed">
                Atlas monitors your entire pipeline, surfaces what needs attention, predicts seller readiness, and takes action — all without being asked. It's like having a seasoned analyst working 24/7.
              </p>
              <ul className="space-y-3">
                {[
                  "Proactively identifies your hottest leads",
                  "Generates AI-crafted offers with market comps",
                  "Predicts seller intent with 85%+ accuracy",
                  "Automates multi-channel follow-up sequences",
                  "Provides daily briefings on portfolio health",
                ].map((item) => (
                  <li key={item} className="flex items-center gap-3 text-sm">
                    <CheckCircle className="w-4 h-4 text-emerald-500 shrink-0" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
              <Button asChild size="lg" className="gap-2">
                <Link href="/auth">
                  Try Atlas Free
                  <ChevronRight className="w-4 h-4" />
                </Link>
              </Button>
            </div>
            <div className="relative">
              <div className="rounded-2xl border bg-card shadow-2xl p-6 space-y-4">
                <div className="flex items-center gap-3 pb-4 border-b">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 to-primary flex items-center justify-center">
                    <Sparkles className="w-4 h-4 text-white" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold">Atlas</p>
                    <p className="text-xs text-muted-foreground">AI Deal Intelligence</p>
                  </div>
                  <Badge variant="secondary" className="ml-auto text-xs bg-emerald-100 text-emerald-700">Live</Badge>
                </div>
                {[
                  { type: "alert", icon: "🔥", text: "John D. opened your offer email 3x today. High intent detected.", action: "Call Now" },
                  { type: "insight", icon: "📊", text: "Your TX-Hill-County parcel AVM jumped 12% — consider repricing.", action: "View AVM" },
                  { type: "action", icon: "✉️", text: "15 leads haven't been contacted in 30+ days. Auto-sequence ready.", action: "Launch" },
                ].map((item, i) => (
                  <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                    <span className="text-lg">{item.icon}</span>
                    <p className="text-xs text-muted-foreground flex-1 leading-relaxed">{item.text}</p>
                    <Button size="sm" variant="outline" className="text-xs h-7 shrink-0">{item.action}</Button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section id="how-it-works" className="py-24 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16 space-y-4">
            <Badge variant="outline" className="text-sm">How It Works</Badge>
            <h2 className="text-4xl font-bold">Up and running in minutes</h2>
            <p className="text-lg text-muted-foreground max-w-xl mx-auto">
              Import your existing data, configure your automation, and let AcreOS take it from there.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {HOW_IT_WORKS.map((step) => (
              <div key={step.step} className="text-center space-y-4">
                <div className="w-16 h-16 rounded-2xl bg-primary/10 text-primary font-bold text-2xl flex items-center justify-center mx-auto">
                  {step.step}
                </div>
                <h3 className="text-xl font-semibold">{step.title}</h3>
                <p className="text-muted-foreground leading-relaxed">{step.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 bg-muted/30">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12 space-y-4">
            <Badge variant="outline" className="text-sm">Testimonials</Badge>
            <h2 className="text-4xl font-bold">Trusted by top land operators</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {TESTIMONIALS.map((t) => (
              <Card key={t.author} className="border">
                <CardContent className="p-6 space-y-4">
                  <div className="flex gap-0.5">
                    {Array.from({ length: t.stars }).map((_, i) => (
                      <Star key={i} className="w-4 h-4 fill-amber-400 text-amber-400" />
                    ))}
                  </div>
                  <p className="text-sm leading-relaxed text-muted-foreground italic">"{t.quote}"</p>
                  <div>
                    <p className="text-sm font-semibold">{t.author}</p>
                    <p className="text-xs text-muted-foreground">{t.role}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="py-24 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16 space-y-4">
            <Badge variant="outline" className="text-sm">Pricing</Badge>
            <h2 className="text-4xl font-bold">Simple, transparent pricing</h2>
            <p className="text-lg text-muted-foreground max-w-xl mx-auto">
              14-day free trial on all plans. No setup fees. Cancel anytime.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {PRICING.map((plan) => (
              <Card
                key={plan.name}
                className={`relative border-2 ${plan.highlighted ? "border-primary shadow-lg shadow-primary/10" : "border-border"}`}
              >
                {plan.badge && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <Badge className="bg-primary text-primary-foreground px-4 py-1 text-xs font-semibold">
                      {plan.badge}
                    </Badge>
                  </div>
                )}
                <CardContent className="p-8 space-y-6">
                  <div>
                    <h3 className="text-xl font-bold">{plan.name}</h3>
                    <p className="text-sm text-muted-foreground mt-1">{plan.description}</p>
                  </div>
                  <div className="flex items-baseline gap-1">
                    <span className="text-4xl font-bold">{plan.price}</span>
                    <span className="text-muted-foreground">{plan.period}</span>
                  </div>
                  <ul className="space-y-3">
                    {plan.features.map((f) => (
                      <li key={f} className="flex items-center gap-2.5 text-sm">
                        <CheckCircle className="w-4 h-4 text-emerald-500 shrink-0" />
                        {f}
                      </li>
                    ))}
                  </ul>
                  <Button
                    asChild
                    className="w-full"
                    variant={plan.highlighted ? "default" : "outline"}
                    size="lg"
                  >
                    <Link href="/auth">{plan.cta}</Link>
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-24 px-4 sm:px-6 lg:px-8 bg-gradient-to-br from-primary/10 via-accent/5 to-primary/5">
        <div className="max-w-3xl mx-auto text-center space-y-8">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary to-accent flex items-center justify-center mx-auto">
            <span className="text-white font-bold text-2xl">A</span>
          </div>
          <h2 className="text-4xl sm:text-5xl font-bold">
            Ready to run your land business like a machine?
          </h2>
          <p className="text-lg text-muted-foreground max-w-xl mx-auto">
            Join the operators using AcreOS to find better deals faster, automate their follow-up, and build wealth through land.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button asChild size="lg" className="text-base px-10 h-12 gap-2">
              <Link href="/auth">
                Start Your Free Trial
                <ArrowRight className="w-4 h-4" />
              </Link>
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">No credit card required · 14-day free trial</p>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t bg-background py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8 pb-8 border-b">
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-accent flex items-center justify-center">
                  <span className="text-white font-bold text-sm">A</span>
                </div>
                <span className="font-bold text-lg">AcreOS</span>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">
                The operating system for land investors. AI-powered deal intelligence for serious operators.
              </p>
            </div>

            <div className="space-y-3">
              <h4 className="font-semibold text-sm">Product</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><a href="#features" className="hover:text-foreground transition-colors">Features</a></li>
                <li><a href="#pricing" className="hover:text-foreground transition-colors">Pricing</a></li>
                <li><a href="#how-it-works" className="hover:text-foreground transition-colors">How It Works</a></li>
              </ul>
            </div>

            <div className="space-y-3">
              <h4 className="font-semibold text-sm">Company</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><Link href="/terms" className="hover:text-foreground transition-colors">Terms of Service</Link></li>
                <li><Link href="/privacy" className="hover:text-foreground transition-colors">Privacy Policy</Link></li>
              </ul>
            </div>

            <div className="space-y-3">
              <h4 className="font-semibold text-sm">Get Started</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><Link href="/auth" className="hover:text-foreground transition-colors">Sign Up Free</Link></li>
                <li><Link href="/auth" className="hover:text-foreground transition-colors">Log In</Link></li>
              </ul>
            </div>
          </div>

          <div className="pt-8 flex flex-col sm:flex-row items-center justify-between gap-4">
            <p className="text-sm text-muted-foreground">© {new Date().getFullYear()} AcreOS. All rights reserved.</p>
            <div className="flex gap-4 text-sm text-muted-foreground flex-wrap justify-center">
              <Link href="/compare/lg-pass" className="hover:text-foreground transition-colors">vs LG Pass</Link>
              <Link href="/compare/geekpay" className="hover:text-foreground transition-colors">vs GeekPay</Link>
              <span>Built for land investors, by land investors.</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
