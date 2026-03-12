import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle2,
  XCircle,
  ArrowRight,
  Bot,
  DollarSign,
  Mail,
  Map,
  BarChart3,
  FileText,
  Users,
  Zap,
} from "lucide-react";

const COMPARISON_ROWS = [
  { feature: "CRM & lead tracking", lgpass: true, acreos: true },
  { feature: "Document automation (offers, deeds, contracts)", lgpass: true, acreos: true },
  { feature: "Address verification", lgpass: true, acreos: true },
  { feature: "Task delegation to team", lgpass: true, acreos: true },
  { feature: "Seller-financed note servicing", lgpass: false, acreos: true },
  { feature: "Automated ACH payment collection", lgpass: false, acreos: true },
  { feature: "Borrower portal (buyer-facing dashboard)", lgpass: false, acreos: true },
  { feature: "Property tax escrow management", lgpass: false, acreos: true },
  { feature: "AI-assisted due diligence & AVM", lgpass: false, acreos: true },
  { feature: "AI deal scoring & next best action", lgpass: false, acreos: true },
  { feature: "Email + SMS + direct mail campaigns", lgpass: false, acreos: true },
  { feature: "Campaign A/B testing", lgpass: false, acreos: true },
  { feature: "Marketing spend tracking & ROI", lgpass: false, acreos: true },
  { feature: "Automated follow-up sequences", lgpass: false, acreos: true },
  { feature: "Interactive parcel maps", lgpass: false, acreos: true },
  { feature: "Portfolio analytics & P&L dashboard", lgpass: false, acreos: true },
  { feature: "Deal pipeline (offer → close)", lgpass: false, acreos: true },
  { feature: "CSV import from external tools", lgpass: false, acreos: true },
];

export default function CompareLGPassPage() {
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
            LG Pass Alternative
          </Badge>
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight">
            AcreOS vs LG Pass
          </h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
            LG Pass is great at what it does. But land investors doing seller-finance and
            marketing automation are paying for 2–3 extra tools to fill the gaps. AcreOS
            replaces all of them at a lower combined price.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
            <Button asChild size="lg" className="font-semibold px-8">
              <Link href="/auth?mode=register">
                Try AcreOS Free <ArrowRight className="w-4 h-4 ml-2" />
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link href="/compare/geekpay">Also compare vs GeekPay →</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Price comparison callout */}
      <section className="py-12 px-4">
        <div className="max-w-3xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="rounded-xl border border-border p-6 text-center space-y-2">
              <p className="text-sm text-muted-foreground font-medium">LG Pass</p>
              <p className="text-4xl font-bold">$99</p>
              <p className="text-sm text-muted-foreground">/month</p>
              <p className="text-xs text-muted-foreground">CRM + docs only</p>
            </div>
            <div className="rounded-xl border border-border p-6 text-center space-y-2 bg-muted/30">
              <p className="text-sm text-muted-foreground font-medium">LG Pass + GeekPay</p>
              <p className="text-4xl font-bold text-destructive">$198</p>
              <p className="text-sm text-muted-foreground">/month</p>
              <p className="text-xs text-muted-foreground">Most operators need both</p>
            </div>
            <div className="rounded-xl border-2 border-primary p-6 text-center space-y-2 bg-primary/5">
              <p className="text-sm text-primary font-medium">AcreOS</p>
              <p className="text-4xl font-bold text-primary">$97</p>
              <p className="text-sm text-muted-foreground">/month</p>
              <p className="text-xs text-primary font-medium">CRM + notes + AI + campaigns</p>
            </div>
          </div>
          <p className="text-center text-sm text-muted-foreground mt-4">
            AcreOS replaces LG Pass + GeekPay for less than the cost of LG Pass alone.
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
              <div className="text-center">LG Pass</div>
              <div className="text-center text-primary">AcreOS</div>
            </div>
            {COMPARISON_ROWS.map((row, i) => (
              <div
                key={i}
                className={`grid grid-cols-3 px-6 py-3.5 text-sm border-t border-border/50 ${
                  !row.lgpass && row.acreos ? "bg-primary/3" : ""
                }`}
              >
                <div className="text-muted-foreground">{row.feature}</div>
                <div className="flex justify-center">
                  {row.lgpass ? (
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
        </div>
      </section>

      {/* What you get that LG Pass doesn't have */}
      <section className="py-16 px-4 bg-muted/30">
        <div className="max-w-4xl mx-auto space-y-8">
          <h2 className="text-2xl font-bold text-center">What AcreOS adds</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            {[
              {
                icon: DollarSign,
                title: "Note servicing built in",
                body: "Automated ACH collection via Actum, borrower portal, amortization schedules, payoff quotes, 1098 statements — the full GeekPay feature set without a separate subscription.",
              },
              {
                icon: Bot,
                title: "AI that actually works",
                body: "Atlas AI analyzes every deal, scores leads, answers due diligence questions, and tells you the next best action — no prompt engineering required.",
              },
              {
                icon: Mail,
                title: "Full marketing stack",
                body: "Email, SMS, and direct mail campaigns with automated follow-up sequences. LG Pass has no marketing automation — AcreOS has all of it.",
              },
              {
                icon: Map,
                title: "Interactive maps",
                body: "Every property and lead visualized on a parcel map with county overlays, zoning data, and market intelligence layers.",
              },
              {
                icon: BarChart3,
                title: "Portfolio analytics",
                body: "Real P&L dashboards, cash flow projections, note portfolio performance, and deal-level IRR — not just a contact list.",
              },
              {
                icon: Zap,
                title: "One tool, not three",
                body: "AcreOS + GeekPay + a campaign tool = $250–$350/mo. AcreOS alone = $97/mo. Same workflows, one login, no spreadsheet reconciliation.",
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
          <h2 className="text-3xl font-bold">Ready to consolidate?</h2>
          <p className="text-muted-foreground text-lg">
            Import your LG Pass contacts as a CSV and be live in minutes. Free plan available —
            no credit card required.
          </p>
          <Button asChild size="lg" className="font-semibold px-10">
            <Link href="/auth?mode=register">
              Start Free <ArrowRight className="w-4 h-4 ml-2" />
            </Link>
          </Button>
          <p className="text-sm text-muted-foreground">
            Already using LG Pass?{" "}
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
