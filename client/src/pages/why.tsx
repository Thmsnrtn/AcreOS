/**
 * /why — the founder's verbatim letter from the design brief §1.
 *
 * Ships verbatim per the brief: "could it live in the same document as
 * this letter?" is the voice test for every other surface, so the letter
 * itself must be accessible. Public, no auth.
 *
 * Path is `/why` not `/about` because the brief offered both as
 * acceptable and `/why` is shorter, more direct, and signals the
 * content. The landing-page footer + a /pricing excerpt link here.
 */

import { Link } from "wouter";
import { useDocumentTitle, usePageMeta } from "@/hooks/use-document-title";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

export default function WhyPage() {
  usePageMeta(
    "Why we built this",
    "From the founder of AcreOS. Why this exists, what it does, and the rule that drives every agent."
  );
  useDocumentTitle("Why we built this");

  return (
    <main className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-6 py-16 md:py-24">
        <div className="mb-10">
          <Link href="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
            Back to AcreOS
          </Link>
        </div>

        <article className="space-y-8">
          <header className="space-y-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
              Why we built this
            </p>
            <h1 className="text-3xl md:text-4xl font-bold leading-tight">
              A land investor who couldn't stop building systems.
            </h1>
          </header>

          <div className="space-y-6 text-base md:text-lg leading-relaxed text-foreground/90">
            <p>
              I'm a land investor, and I'm the kind of person who can't leave a
              broken system alone. For years, my operation ran on a spreadsheet,
              a dozen browser tabs, AI assistants that didn't know what I was
              working on, and a stack of emails and voicemails that kept
              growing while I tried to close deals.
            </p>

            <p>
              It mostly worked. But the leaks were everywhere. A reply missed by
              a day. A skip-trace I'd already paid for. A mailer to a seller who
              told me no six months ago. Each one was small. Together they were
              the difference between a good year and a great one.
            </p>

            <p>
              AcreOS is what came out the other side. One AI partner, Pax, that
              handles the parts of the job that should never have been manual.
              Comping, replies, loan servicing, follow-ups. It runs in the
              background. You stay on the decisions only you should make.
            </p>

            <p>
              The rule is honesty. Pax shows its work — what it did, what it
              used, how confident it is, what it skipped. You can pause
              anything, edit anything, override anything, in one click.
            </p>

            <p className="font-medium">
              If you're running a land business and the seams are starting to
              show, this is built for you.
            </p>
          </div>

          <div className="pt-8 mt-8 border-t border-border">
            <Link href="/auth?mode=register">
              <Button size="lg" className="min-h-12">
                Try AcreOS
              </Button>
            </Link>
            <p className="mt-3 text-xs text-muted-foreground">
              Free to start. No credit card required.
            </p>
          </div>
        </article>
      </div>
    </main>
  );
}
