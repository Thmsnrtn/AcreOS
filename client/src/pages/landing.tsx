/**
 * AcreOS public landing page.
 *
 * Phase 2A.3 (in progress) is rebuilding the landing surface to land
 * the prototype's design identity (homestead palette, serif display
 * type, three-agent illustration cards, the founder-letter voice).
 *
 * Prototype source: /acreos-landing/ (sections-1.jsx, sections-2.jsx,
 * sections-3.jsx, sections.css, copy.jsx). The "letter" tone is the
 * canonical voice — see client/src/pages/landing/copy.ts.
 *
 * This file currently composes:
 *   - Production nav (preserved — Clerk sign-in flow + analytics)
 *   - <Hero> from ./landing/Hero.tsx (Phase 2A.3.a — landed)
 *   - Original sections kept inline below the hero until each is
 *     ported in subsequent commits (How / Agents / Day in life /
 *     Features / Quotes / Founder note / Pricing / FAQ / Final CTA)
 */
import { Link } from "wouter";
import { useState } from "react";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { AcreosLogo } from "@/components/acreos-logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { SkipToContent } from "@/components/skip-to-content";
import { Hero } from "./landing/Hero";
import { HowItWorks } from "./landing/HowItWorks";
import "./landing/landing.css";
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
  Check,
} from "lucide-react";

const VERTICALS = [
  { name: "Wholesaling", desc: "Deal flow and motivated seller outreach" },
  { name: "Fix & Flip", desc: "Rehab budgeting and ARV analysis" },
  { name: "Buy & Hold", desc: "Rental portfolio management" },
  { name: "STR / Airbnb", desc: "Short-term rental optimization" },
  { name: "Multifamily", desc: "Multi-unit deal underwriting" },
  { name: "Creative Finance", desc: "Sub-to, wraps, and lease options" },
  { name: "Notes", desc: "Seller-financed note management" },
  { name: "Commercial", desc: "Commercial property analysis" },
];

function WaitlistSection() {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitted, setSubmitted] = useState(false);

  const toggle = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  return (
    <div className="max-w-4xl mx-auto text-center space-y-8">
      <div className="space-y-2">
        <h2 className="text-2xl font-bold">Coming to AcreOS</h2>
        <p className="text-muted-foreground max-w-xl mx-auto">
          AcreOS starts with Land Investors. Select the verticals you're interested in and we'll notify you when they launch.
        </p>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {VERTICALS.map((v) => {
          const isSelected = selected.has(v.name);
          return (
            <button
              key={v.name}
              type="button"
              onClick={() => toggle(v.name)}
              className={`border rounded-lg p-4 text-left transition-all ${
                isSelected
                  ? "border-primary bg-primary/10 ring-1 ring-primary/30"
                  : "bg-background hover:border-primary/40"
              }`}
            >
              <div className="flex items-start justify-between">
                <h3 className="font-semibold text-sm">{v.name}</h3>
                {isSelected && <Check className="w-4 h-4 text-primary shrink-0" />}
              </div>
              <p className="text-xs text-muted-foreground mt-1">{v.desc}</p>
              <p className="text-xs text-primary mt-2 font-medium">Coming soon</p>
            </button>
          );
        })}
      </div>
      {submitted ? (
        <p className="text-sm text-primary font-medium">
          Thanks! We'll notify you when {selected.size > 1 ? "these verticals launch" : "this vertical launches"}.
        </p>
      ) : (
        <form
          className="max-w-sm mx-auto flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const email = (form.elements.namedItem("waitlist-email") as HTMLInputElement)?.value;
            if (!email || selected.size === 0) return;
            try {
              await Promise.all(
                Array.from(selected).map((vertical) =>
                  fetch("/api/waitlist", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ email, vertical }),
                  })
                )
              );
              setSubmitted(true);
            } catch {
              toast({
                variant: "destructive",
                title: "Couldn't add you to the waitlist",
                description: "Network error. Your email is still in the form — try again in a moment.",
              });
            }
          }}
        >
          <Label htmlFor="waitlist-email" className="sr-only">Email address for waitlist</Label>
          <Input
            id="waitlist-email"
            name="waitlist-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder="you@email.com"
            required
            className="flex-1"
          />
          <Button type="submit" size="sm" disabled={selected.size === 0}>
            Join waitlist{selected.size > 0 ? ` (${selected.size})` : ""}
          </Button>
        </form>
      )}
    </div>
  );
}

const FEATURES = [
  {
    icon: MapPin,
    title: "Portfolio Mapping",
    description: "Visualize every parcel on interactive maps with property boundaries, flood zones, and zoning data.",
  },
  {
    icon: TrendingUp,
    title: "AI Valuations",
    description: "Instant property valuations powered by comps analysis and 9 data sources.",
  },
  {
    icon: Bot,
    title: "AI Deal Intelligence",
    description: "Pax, your AI copilot, scores leads, drafts offers, and surfaces the best opportunities.",
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
  { stat: "9", label: "Data sources" },
  { stat: "$0", label: "To get started" },
  { stat: "14", label: "Day free trial" },
  { stat: "500+", label: "Properties managed" },
];

export default function LandingPage() {
  useDocumentTitle("AcreOS — the operating system for land investors");
  const { toast } = useToast();
  return (
    <div className="min-h-screen bg-background">
      <SkipToContent />
      {/* Nav */}
      <nav className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <AcreosLogo size={30} />

          <div className="flex items-center gap-1 sm:gap-3">
            <Button variant="ghost" size="sm" asChild className="hidden sm:inline-flex">
              <Link href="/pricing">Pricing</Link>
            </Button>
            <ThemeToggle />
            <Button variant="ghost" size="sm" asChild>
              <Link href="/auth">Sign in</Link>
            </Button>
            <Button size="sm" asChild>
              {/* Short label on mobile so the button doesn't clip. Full
                  "Get Started Free" on sm+ screens. */}
              <Link href="/auth?mode=register">
                <span className="sm:hidden">Get started</span>
                <span className="hidden sm:inline">Get Started Free</span>
              </Link>
            </Button>
          </div>
        </div>
      </nav>

      {/* Hero + How It Works per /acreos-landing/sections-1.jsx.
          Subsequent sections (Agents, Day in Life, Features, Quotes,
          Founder note, Pricing, FAQ, Final CTA) are pending and will
          be ported in subsequent 2A.3 commits. The legacy inline
          sections below remain until each is replaced. */}
      <main id="main-content">
        <Hero />
        <HowItWorks />
      </main>

      {/* Legacy social-proof / waitlist / etc. sections remain below
          until each prototype-aligned replacement lands in subsequent
          2A.3 commits (Agents → Day in Life → Features → Quotes →
          Founder → Pricing → FAQ → Final CTA → Footer). */}

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
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-8">
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
        <WaitlistSection />
      </section>

      {/* CTA */}
      <section className="py-24 px-6">
        <div className="max-w-2xl mx-auto text-center space-y-6">
          <h2 className="text-3xl font-bold">Ready to close more land deals with less effort?</h2>
          <p className="text-muted-foreground">
            Join Land Investors who are finding better parcels and closing faster with AcreOS.
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
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3 text-sm text-muted-foreground">
          <span>&copy; {new Date().getFullYear()} AcreOS. All rights reserved.</span>
          <div className="flex gap-4 flex-wrap justify-center">
            <Link href="/pricing" className="hover:text-foreground">Pricing</Link>
            <Link href="/status" className="hover:text-foreground">Status</Link>
            <Link href="/changelog" className="hover:text-foreground">Changelog</Link>
            <Link href="/terms" className="hover:text-foreground">Terms</Link>
            <Link href="/privacy" className="hover:text-foreground">Privacy</Link>
            <Link href="/auth" className="hover:text-foreground">Sign in</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
