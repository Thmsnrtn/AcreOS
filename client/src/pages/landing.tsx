import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  MapPin,
  TrendingUp,
  FileText,
  Bot,
  Shield,
  BarChart3,
  ArrowRight,
  Map,
  Sparkles,
  Mail,
  DollarSign,
} from "lucide-react";

const FEATURES = [
  {
    icon: MapPin,
    title: "Portfolio Mapping",
    description: "Visualize every parcel on interactive maps with property boundaries, flood zones, and zoning data.",
  },
  {
    icon: TrendingUp,
    title: "AI Valuations",
    description: "Instant property valuations powered by comps analysis and 18 open data sources.",
  },
  {
    icon: Bot,
    title: "AI Deal Intelligence",
    description: "Sophie, your AI copilot, scores leads, drafts offers, and surfaces the best opportunities.",
  },
  {
    icon: FileText,
    title: "Document Generation",
    description: "Auto-generate purchase agreements, contracts, and closing documents in seconds.",
  },
  {
    icon: BarChart3,
    title: "Campaign Automation",
    description: "Multi-channel outreach with SMS, email, and direct mail sequences.",
  },
  {
    icon: Shield,
    title: "Compliance Built-In",
    description: "Phone compliance, do-not-call list checks, and audit trails handled automatically for every communication.",
  },
];

const SOCIAL_PROOF = [
  { stat: "18", label: "Free data sources" },
  { stat: "$0", label: "To get started" },
  { stat: "14", label: "Day free trial" },
  { stat: "500+", label: "Properties managed" },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:z-[100] focus:top-2 focus:left-2 focus:px-4 focus:py-2 focus:bg-primary focus:text-primary-foreground focus:rounded-md focus:text-sm focus:font-medium"
      >
        Skip to content
      </a>
      {/* Nav */}
      <nav className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-accent flex items-center justify-center">
              <span className="text-white font-bold text-sm">A</span>
            </div>
            <span className="text-lg font-bold">AcreOS</span>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" asChild>
              <Link href="/pricing">Pricing</Link>
            </Button>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/auth">Sign In</Link>
            </Button>
            <Button size="sm" asChild>
              <Link href="/auth?mode=register">Get Started Free</Link>
            </Button>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section id="main-content" className="py-24 px-6">
        <div className="max-w-4xl mx-auto text-center space-y-6">
          <h1 className="text-5xl sm:text-6xl font-bold tracking-tight">
            The AI-Powered Platform for{" "}
            <span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
              Land Investors
            </span>
          </h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Find motivated sellers. Analyze parcels. Send direct mail. Close deals.
            All in one platform.
          </p>
          <div className="flex gap-3 justify-center pt-4">
            <Button size="lg" asChild>
              <Link href="/auth?mode=register">
                Get Started Free <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <Link href="/pricing">View Pricing</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-20 px-6 bg-muted/30 border-y">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-3xl font-bold">How AcreOS Works</h2>
            <p className="text-muted-foreground mt-3 max-w-xl mx-auto">
              From raw land data to closed deals in four steps.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-8">
            {[
              {
                icon: Map,
                step: "1",
                title: "Import or Find Parcels",
                description: "Pull county data, import CSVs, or search by state and county to build your target list.",
              },
              {
                icon: Sparkles,
                step: "2",
                title: "AI Analyzes Each Parcel",
                description: "Instant valuations, comp analysis, and deal scoring powered by 18 free data sources.",
              },
              {
                icon: Mail,
                step: "3",
                title: "Launch Direct Mail Campaigns",
                description: "Generate offer letters, set up mail sequences, and reach motivated sellers at scale.",
              },
              {
                icon: DollarSign,
                step: "4",
                title: "Close Deals & Track Returns",
                description: "Manage contracts, track your pipeline, and monitor ROI across your entire land portfolio.",
              },
            ].map(({ icon: Icon, step, title, description }) => (
              <div key={step} className="text-center space-y-3">
                <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto">
                  <Icon className="h-7 w-7 text-primary" />
                </div>
                <div className="text-xs font-semibold text-primary uppercase tracking-wider">Step {step}</div>
                <h3 className="font-semibold">{title}</h3>
                <p className="text-sm text-muted-foreground">{description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Social proof */}
      <section className="border-y bg-muted/30 py-12 px-6">
        <div className="max-w-4xl mx-auto grid grid-cols-2 sm:grid-cols-4 gap-8 text-center">
          {SOCIAL_PROOF.map((item) => (
            <div key={item.label}>
              <div className="text-3xl font-bold text-primary">{item.stat}</div>
              <div className="text-sm text-muted-foreground mt-1">{item.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="py-24 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold">Everything you need to run your land business</h2>
            <p className="text-muted-foreground mt-3 max-w-xl mx-auto">
              From finding parcels to closing deals, AcreOS handles the full lifecycle of your land investments.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {FEATURES.map(({ icon: Icon, title, description }) => (
              <Card key={title} className="border bg-card hover:shadow-md transition-shadow">
                <CardContent className="pt-6">
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
                    <Icon className="h-5 w-5 text-primary" />
                  </div>
                  <h3 className="font-semibold mb-2">{title}</h3>
                  <p className="text-sm text-muted-foreground">{description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing teaser */}
      <section className="py-24 px-6 bg-muted/30 border-t">
        <div className="max-w-3xl mx-auto text-center space-y-6">
          <h2 className="text-3xl font-bold">Simple, transparent pricing</h2>
          <p className="text-muted-foreground">
            Start free. Upgrade when you're ready. 14-day free trial on all paid plans.
          </p>
          <div className="grid sm:grid-cols-4 gap-4 mt-8">
            {[
              { name: "Free", price: "$0", desc: "10 leads, 3 properties" },
              { name: "Starter", price: "$20/mo", desc: "250 leads, campaigns" },
              { name: "Pro", price: "$49/mo", desc: "500 leads, BYOK, unlimited" },
              { name: "Scale", price: "$79/mo", desc: "10 seats, unlimited everything" },
            ].map((tier) => (
              <Card key={tier.name} className={tier.name === "Pro" ? "border-primary shadow-md" : ""}>
                <CardContent className="pt-6 text-center">
                  <h3 className="font-semibold">{tier.name}</h3>
                  <div className="text-2xl font-bold mt-2">{tier.price}</div>
                  <p className="text-xs text-muted-foreground mt-1">{tier.desc}</p>
                </CardContent>
              </Card>
            ))}
          </div>
          <Button asChild>
            <Link href="/pricing">See Full Comparison</Link>
          </Button>
        </div>
      </section>

      {/* Adjacent Verticals Waitlist */}
      <section className="py-16 px-6 bg-muted/30">
        <div className="max-w-4xl mx-auto text-center space-y-8">
          <div className="space-y-2">
            <h2 className="text-2xl font-bold">Expanding to Serve More Investors</h2>
            <p className="text-muted-foreground max-w-xl mx-auto">
              AcreOS starts with land investors. We're building dedicated tools for adjacent real estate verticals. Join the waitlist to get early access.
            </p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { name: "Wholesaling", desc: "Deal flow and motivated seller outreach" },
              { name: "Fix & Flip", desc: "Rehab budgeting and ARV analysis" },
              { name: "Buy & Hold", desc: "Rental portfolio management" },
              { name: "STR / Airbnb", desc: "Short-term rental optimization" },
              { name: "Multifamily", desc: "Multi-unit deal underwriting" },
              { name: "Creative Finance", desc: "Sub-to, wraps, and lease options" },
              { name: "Notes", desc: "Seller-financed note management" },
              { name: "Commercial", desc: "Commercial property analysis" },
            ].map((v) => (
              <div key={v.name} className="border rounded-lg p-4 text-left bg-background hover:border-primary/40 transition-colors">
                <h3 className="font-semibold text-sm">{v.name}</h3>
                <p className="text-xs text-muted-foreground mt-1">{v.desc}</p>
                <p className="text-xs text-primary mt-2 font-medium">Coming soon</p>
              </div>
            ))}
          </div>
          <div className="max-w-sm mx-auto">
            <form
              className="flex gap-2"
              onSubmit={async (e) => {
                e.preventDefault();
                const form = e.currentTarget;
                const email = (form.elements.namedItem("waitlist-email") as HTMLInputElement)?.value;
                if (!email) return;
                try {
                  await fetch("/api/waitlist", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ email, vertical: "general" }),
                  });
                  alert("Thanks! We'll notify you when new verticals launch.");
                  form.reset();
                } catch {
                  alert("Something went wrong. Please try again.");
                }
              }}
            >
              <input
                name="waitlist-email"
                type="email"
                placeholder="you@email.com"
                required
                className="flex-1 px-3 py-2 text-sm border rounded-md bg-background"
              />
              <Button type="submit" size="sm">Join Waitlist</Button>
            </form>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-24 px-6">
        <div className="max-w-2xl mx-auto text-center space-y-6">
          <h2 className="text-3xl font-bold">Ready to close more land deals with less effort?</h2>
          <p className="text-muted-foreground">
            Join land investors who are finding better parcels and closing faster with AcreOS.
          </p>
          <Button size="lg" asChild>
            <Link href="/auth?mode=register">
              Get Started Free <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t py-8 px-6">
        <div className="max-w-6xl mx-auto flex items-center justify-between text-sm text-muted-foreground">
          <span>&copy; {new Date().getFullYear()} AcreOS. All rights reserved.</span>
          <div className="flex gap-4">
            <Link href="/pricing" className="hover:text-foreground">Pricing</Link>
            <Link href="/auth" className="hover:text-foreground">Sign In</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
