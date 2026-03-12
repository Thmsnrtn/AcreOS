import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle2,
  XCircle,
  ArrowRight,
  Bot,
  Target,
  Mail,
  Map,
  BarChart3,
  FileText,
  Shield,
  DollarSign,
} from "lucide-react";

const COMPARISON_ROWS = [
  { feature: "Automated ACH payment collection (Actum)", geekpay: true, acreos: true },
  { feature: "Credit/debit card payments (Stripe)", geekpay: true, acreos: true },
  { feature: "Borrower portal (buyer self-service)", geekpay: true, acreos: true },
  { feature: "Amortization schedule & payoff quotes", geekpay: true, acreos: true },
  { feature: "1098 tax form generation", geekpay: true, acreos: true },
  { feature: "Late fee automation", geekpay: true, acreos: true },
  { feature: "Multiple payment processors", geekpay: true, acreos: true, note: "Actum + Stripe" },
  { feature: "Authorize.net support", geekpay: true, acreos: false },
  { feature: "Property tax escrow management", geekpay: false, acreos: true },
  { feature: "CRM & lead tracking", geekpay: false, acreos: true },
  { feature: "Deal pipeline (offer → close)", geekpay: false, acreos: true },
  { feature: "Document automation (offers, deeds)", geekpay: false, acreos: true },
  { feature: "Email + SMS + direct mail campaigns", geekpay: false, acreos: true },
  { feature: "AI due diligence & deal scoring", geekpay: false, acreos: true },
  { feature: "Portfolio maps & parcel data", geekpay: false, acreos: true },
  { feature: "Portfolio analytics & P&L dashboard", geekpay: false, acreos: true },
  { feature: "Team collaboration & roles", geekpay: false, acreos: true },
  { feature: "Free tier (≤5 notes)", geekpay: false, acreos: true },
];

const PRICING_ROWS = [
  { tier: "≤10 notes", geekpay: "$49/mo", acreos: "Free" },
  { tier: "≤99 notes", geekpay: "$99/mo", acreos: "$97/mo" },
  { tier: "≤199 notes", geekpay: "$169/mo", acreos: "$149/mo" },
  { tier: "Unlimited notes", geekpay: "Custom", acreos: "$399/mo" },
  { tier: "CRM included", geekpay: "No (+$99 for LG Pass)", acreos: "Yes" },
  { tier: "AI included", geekpay: "No", acreos: "Yes" },
  { tier: "Campaigns included", geekpay: "No", acreos: "Yes" },
];

export default function CompareGeekPayPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Nav */}
      <header className="border-b border-border/50 sticky top-0 bg-background/95 backdrop-blur z-50">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/">
            <div className="flex items-center gap-2 cursor-pointer">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-accent flex items-center justify-center">
                <span className="text-white font-bold text-sm">A</span>
              </div>
              <span className="font-bold text-lg">AcreOS</span>
            </div>
          </Link>
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
      <section className="py-20 px-4 bg-gradient-to-b from-primary/5 to-transparent">
        <div className="max-w-4xl mx-auto text-center space-y-5">
          <Badge variant="secondary" className="text-xs font-medium px-3 py-1">
            GeekPay Alternative
          </Badge>
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight">
            AcreOS vs GeekPay
          </h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
            GeekPay handles note payments well. But it's one piece of the puzzle. AcreOS includes
            everything GeekPay does — plus CRM, AI, campaigns, maps, and a full deal pipeline —
            at the same price point or less.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
            <Button asChild size="lg" className="font-semibold px-8">
              <Link href="/auth?mode=register">
                Try AcreOS Free <ArrowRight className="w-4 h-4 ml-2" />
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link href="/compare/lg-pass">Also compare vs LG Pass →</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Pricing comparison */}
      <section className="py-12 px-4">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-2xl font-bold text-center mb-6">Side-by-side pricing</h2>
          <div className="rounded-xl border border-border overflow-hidden">
            <div className="grid grid-cols-3 bg-muted/50 px-6 py-3 text-sm font-semibold">
              <div>Notes in portfolio</div>
              <div className="text-center">GeekPay</div>
              <div className="text-center text-primary">AcreOS</div>
            </div>
            {PRICING_ROWS.map((row, i) => (
              <div
                key={i}
                className="grid grid-cols-3 px-6 py-3.5 text-sm border-t border-border/50"
              >
                <div className="text-muted-foreground">{row.tier}</div>
                <div className="text-center font-medium">{row.geekpay}</div>
                <div className="text-center font-medium text-primary">{row.acreos}</div>
              </div>
            ))}
          </div>
          <p className="text-center text-sm text-muted-foreground mt-3">
            Most operators also pay $99/mo for LG Pass on top of GeekPay. AcreOS replaces both.
          </p>
        </div>
      </section>

      {/* Feature comparison table */}
      <section className="py-12 px-4">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl font-bold text-center mb-8">Full Feature Comparison</h2>
          <div className="rounded-xl border border-border overflow-hidden">
            <div className="grid grid-cols-3 bg-muted/50 px-6 py-3 text-sm font-semibold">
              <div>Feature</div>
              <div className="text-center">GeekPay</div>
              <div className="text-center text-primary">AcreOS</div>
            </div>
            {COMPARISON_ROWS.map((row, i) => (
              <div
                key={i}
                className={`grid grid-cols-3 px-6 py-3.5 text-sm border-t border-border/50 ${
                  !row.geekpay && row.acreos ? "bg-primary/3" : ""
                }`}
              >
                <div className="text-muted-foreground">
                  {row.feature}
                  {row.note && (
                    <span className="text-xs text-muted-foreground/60 ml-1">({row.note})</span>
                  )}
                </div>
                <div className="flex justify-center">
                  {row.geekpay ? (
                    <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                  ) : (
                    <XCircle className="w-5 h-5 text-muted-foreground/40" />
                  )}
                </div>
                <div className="flex justify-center">
                  {row.acreos ? (
                    <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                  ) : (
                    <XCircle className="w-5 h-5 text-muted-foreground/40" />
                  )}
                </div>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground text-center mt-3">
            AcreOS does not yet support Authorize.net. Actum Processing (recommended for land
            investors) and Stripe are fully supported.
          </p>
        </div>
      </section>

      {/* What AcreOS adds */}
      <section className="py-16 px-4 bg-muted/30">
        <div className="max-w-4xl mx-auto space-y-8">
          <h2 className="text-2xl font-bold text-center">Everything GeekPay does — and more</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            {[
              {
                icon: DollarSign,
                title: "Tax escrow management",
                body: "Collect monthly property tax escrow from borrowers, track the balance, and link directly to county tax portals. GeekPay has no tax escrow feature.",
              },
              {
                icon: Target,
                title: "Full CRM included",
                body: "Track every seller lead, manage follow-ups, and run your acquisition pipeline — all in the same tool you use to service notes. No second subscription needed.",
              },
              {
                icon: Bot,
                title: "AI deal intelligence",
                body: "Atlas AI scores deals, answers due diligence questions, and recommends next actions — across both your acquisition pipeline and your note portfolio.",
              },
              {
                icon: Mail,
                title: "Marketing campaigns",
                body: "Send direct mail, email, and SMS campaigns to potential sellers without leaving AcreOS. GeekPay is notes-only — your acquisition funnel lives elsewhere.",
              },
              {
                icon: Map,
                title: "Portfolio mapping",
                body: "Visualize every active note on a map alongside your acquisition targets. Understand your geographic concentration at a glance.",
              },
              {
                icon: Shield,
                title: "Free tier for small portfolios",
                body: "Investors with fewer than 5 notes pay nothing on AcreOS. GeekPay starts at $49/mo even for new investors just getting started.",
              },
            ].map(({ icon: Icon, title, body }) => (
              <div key={title} className="flex gap-4 p-5 rounded-xl bg-background border border-border/50">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <Icon className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <h3 className="font-semibold text-sm mb-1">{title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Migration CTA */}
      <section className="py-20 px-4">
        <div className="max-w-2xl mx-auto text-center space-y-5">
          <h2 className="text-3xl font-bold">Import your GeekPay notes in minutes</h2>
          <p className="text-muted-foreground text-lg">
            Export your notes from GeekPay as CSV and import them directly into AcreOS with
            our field-mapping importer. Your borrowers, balances, and payment schedules
            come with you.
          </p>
          <Button asChild size="lg" className="font-semibold px-10">
            <Link href="/auth?mode=register">
              Start Free <ArrowRight className="w-4 h-4 ml-2" />
            </Link>
          </Button>
          <p className="text-sm text-muted-foreground">
            Have a large note portfolio?{" "}
            <a href="mailto:hello@acreos.io" className="text-primary hover:underline">
              Contact us for a white-glove migration.
            </a>
          </p>
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
          <div className="flex gap-6">
            <Link href="/" className="hover:text-foreground transition-colors">Home</Link>
            <Link href="/compare/lg-pass" className="hover:text-foreground transition-colors">vs LG Pass</Link>
            <Link href="/terms" className="hover:text-foreground transition-colors">Terms</Link>
            <Link href="/privacy" className="hover:text-foreground transition-colors">Privacy</Link>
            <Link href="/auth" className="hover:text-foreground transition-colors">Sign In</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
