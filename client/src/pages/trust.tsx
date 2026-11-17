/**
 * TrustPage — the dated public trust surface at /trust (P2-6 S1, register A-5).
 *
 * DARK ROUTE: registered in the customer App so it is reachable by URL, and
 * linked from nowhere — no nav, footer, sitemap or landing link, and it sets
 * robots noindex. Publishing and linking it is the founder's act.
 *
 * CONTENT LAW: every sentence is a claim the shipped code makes true, and each
 * one is anchored in scripts/audit-public-claims.ts (TRUST_PAGE_FILES + its
 * CLAIMS / sources), which reads this file. Edit a sentence here and the
 * audit fails until its anchor and source are updated to the same truth.
 * Keep each sentence on one line inside its string so anchors match verbatim.
 *
 * Layout mirrors /security (top nav + cards + shared footer). The page is
 * data-driven to stay light: the customer bundle is at its ceiling, and this
 * page shipped with an in-PR offset (vite.config.ts __SENTRY_DEBUG__).
 */
import { useEffect } from "react";
import { Link } from "wouter";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AcreosLogo } from "@/components/acreos-logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { SkipToContent } from "@/components/skip-to-content";
import { PublicFooter } from "@/components/public-footer";
import { usePageMeta } from "@/hooks/use-document-title";
import { formatDate } from "@/lib/format";

/** The page's own date and version. Change both when the copy changes. */
const UPDATED = new Date(2026, 10, 15);
const VERSION = "1";

const SECTIONS: { title: string; lines: string[] }[] = [
  {
    title: "Your money never touches AcreOS",
    lines: [
      "Your borrowers pay your Stripe account directly. AcreOS is built so it can never touch, hold, or move your money.",
      "Borrower payments are set up on your own Stripe Standard account, with no AcreOS fee taken from them and no AcreOS account to fall back to.",
    ],
  },
  {
    title: "Only data we can stand behind",
    lines: [
      "We only show you parcel data we're licensed to show you — and we'd rather show you nothing than data we can't stand behind.",
      "A parcel source must be cleared in writing before it answers a lookup, and until it is, the gate stays shut.",
    ],
  },
  {
    title: "Sensitive numbers, encrypted one by one",
    lines: [
      "Your own EIN or SSN for tax forms, and a borrower's tax ID on a purchased note, are encrypted field by field with AES-256-GCM and never sent back to the browser.",
      "We never store full card or bank numbers. Your payment processor holds them; AcreOS keeps a reference and the last four digits.",
    ],
  },
  {
    title: "Your book stays yours alone",
    lines: [
      "One organization can never read another's book. That is tested, not just designed: automated tests check it on every change.",
    ],
  },
  {
    title: "Money back, as promised",
    lines: [
      "Ask within 30 days of your first charge and we refund that charge in full, no questions asked.",
      "Eligible refunds are automated at any amount, so a refund above $50 doesn't wait on a person to approve it.",
    ],
  },
  {
    title: "Records that hold up",
    lines: [
      "We protect your loan records' integrity. When a record can't support a request, AcreOS refuses and says why rather than guess:",
      "A 1099-INT is not generated until the payer and recipient tax details it needs are on file.",
      "A request to erase a borrower is refused, naming the notes involved, while their loan and tax records must keep that identity.",
      "Skip tracing runs only after you state a permissible purpose under the FCRA and sign the attestation.",
    ],
  },
  {
    title: "Consent you can show",
    lines: [
      "No cold texting without written consent. A verbal yes is not enough.",
      "Email consent is separate from texting consent; one never stands in for the other.",
      "Every grant and revocation goes into an append-only consent record, and it comes with a person's data export.",
    ],
  },
  {
    title: "An audit trail you can check",
    lines: [
      "Your audit log is append-only and hash-chained: each entry seals the one before it, so an altered or removed entry shows when the chain is checked.",
      "The data-retention job won't purge an account that is under a legal hold.",
    ],
  },
  {
    title: "Your book goes where you go",
    lines: [
      "Your book is exportable in full, any time — and for 30 days after your subscription ends.",
      "If AcreOS moves into its own company (a Massachusetts LLC is being formed) or changes hands, the Terms pass to the new owner and your subscription continues under them.",
    ],
  },
  {
    title: "Where AI sees your data",
    lines: [
      "When you ask Pax for help, the records it needs to answer — which can include a borrower's or seller's name, address and loan details — are sent to OpenRouter, which passes the request to the model that answers it.",
      "AcreOS's backup route for those requests is OpenAI. If you connect your own AI key, the request runs on your key with that provider instead.",
    ],
  },
  {
    title: "If we ever disagree",
    lines: [
      "Our Terms send disputes to binding individual arbitration with JAMS instead of court, and neither side can bring a class action.",
      "In plain words: if something goes wrong, you and AcreOS settle it one-on-one before a neutral arbitrator, in Massachusetts or by phone or video.",
      "AcreOS pays the JAMS fees on claims under $10,000, and you can opt out of arbitration by emailing legal@acreos.io within 30 days of first agreeing to the Terms.",
    ],
  },
  {
    title: "Who you're dealing with",
    lines: [
      "AcreOS is new and in active development, run by one person: Thomas Norton, a sole proprietor in Massachusetts.",
      "It's in beta, and what early users tell us shapes what gets built next. Wherever AcreOS shows example data, it's labelled as example data.",
    ],
  },
];

export default function TrustPage() {
  usePageMeta("Trust", "What AcreOS promises about your money, your data and your records — in plain words.");
  // Dark route: never indexed until the founder publishes it.
  useEffect(() => {
    const tag = document.createElement("meta");
    tag.name = "robots";
    tag.content = "noindex";
    document.head.appendChild(tag);
    return () => tag.remove();
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <SkipToContent />
      <nav className="border-b bg-surface-chrome backdrop-blur sticky top-0 z-floating">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link
            href="/"
            className="flex items-center gap-2 hover:opacity-80 transition-opacity min-h-11 py-1"
            aria-label="Back to AcreOS home"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            <AcreosLogo size={30} />
          </Link>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Button asChild>
              <Link href="/auth?mode=register" className="min-h-11">
                Get started
              </Link>
            </Button>
          </div>
        </div>
      </nav>

      <main id="main-content" className="max-w-4xl mx-auto px-6 py-16 space-y-8">
        <header className="space-y-3">
          <div className="flex items-center gap-3">
            <ShieldCheck className="h-8 w-8 text-primary" aria-hidden="true" />
            <h1 className="text-4xl font-bold">Trust at AcreOS</h1>
          </div>
          <p className="text-muted-foreground max-w-2xl leading-relaxed">
            What AcreOS promises note investors and land investors, in plain words — and only what the product already does.
          </p>
          <p className="text-sm text-muted-foreground" data-testid="trust-updated">
            Last updated {formatDate(UPDATED)} · Version {VERSION}
          </p>
        </header>

        {SECTIONS.map((s) => (
          <Card key={s.title}>
            <CardHeader>
              <CardTitle>{s.title}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm leading-relaxed text-muted-foreground">
              {s.lines.map((l) => (
                <p key={l}>{l}</p>
              ))}
            </CardContent>
          </Card>
        ))}
      </main>

      <PublicFooter />
    </div>
  );
}
