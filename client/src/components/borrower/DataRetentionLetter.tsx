/**
 * DataRetentionLetter — the S-1 borrower letter, rendered in the borrower
 * portal with the borrower's own context (P2-6 S2, roadmap A-5).
 *
 * Five-doors rule (CLAUDE.md): this lives UNDER the portal's existing Tabs
 * group as the "Your data" tab — never a new top-level entry. It is loaded
 * lazily by borrower-portal.tsx, so a borrower who never opens the tab never
 * downloads it.
 *
 * Static by design (census ruling, lane-slicing §3): the letter reads NOTHING
 * from the server. Every value it renders — first name, lender name, loan
 * number, the verified email — is already in the page after sign-in. No new
 * endpoint, no new read of borrower data, so no purpose-ledger DEBT entry.
 *
 * The prose lives in shared/privacy/borrowerErasureLetter.ts and is pinned to
 * the code it describes by tests/unit/borrowerErasureLetter.test.ts.
 */
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Shield } from "lucide-react";
import { formatDate } from "@/lib/format";
import {
  BORROWER_LETTER_REVIEWED_ON,
  PRIVACY_REQUEST_EMAIL,
  buildBorrowerErasureLetter,
  type BorrowerLetterContext,
} from "@shared/privacy/borrowerErasureLetter";

const LINK_CLASS =
  "underline underline-offset-2 text-foreground rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function DataRetentionLetter(ctx: BorrowerLetterContext) {
  const letter = buildBorrowerErasureLetter(ctx);
  // A calendar date built from its parts in local time, so the reviewed-on
  // date never shifts a day west of UTC (same idiom as LenderServicingNotice).
  const { year, month, day } = BORROWER_LETTER_REVIEWED_ON;
  const reviewedOn = formatDate(new Date(year, month - 1, day));

  return (
    <Card data-testid="borrower-data-letter">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
          <Shield className="w-4 h-4 sm:w-5 sm:h-5" aria-hidden="true" /> {letter.title}
        </CardTitle>
        <CardDescription>
          A plain-English letter about erasure requests from borrowers. It describes how AcreOS works as of{" "}
          <span className="tabular-nums" data-testid="letter-reviewed-on">{reviewedOn}</span>.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <article className="max-w-prose space-y-5 text-sm leading-relaxed" aria-label="Letter to the borrower">
          <p className="font-medium" data-testid="letter-greeting">{letter.greeting}</p>
          {letter.sections.map((section) => (
            <section key={section.heading} className="space-y-2">
              <h3 className="font-semibold text-foreground">{section.heading}</h3>
              {section.paragraphs.map((p) => (
                <p key={p} className="text-muted-foreground">{p}</p>
              ))}
              {section.list && (
                <ul className="list-disc pl-5 space-y-1 text-muted-foreground" data-testid="letter-record-contents">
                  {section.list.map((item) => (
                    <li key={item.domain} data-testid={`letter-record-item-${item.domain}`}>{item.plain}</li>
                  ))}
                </ul>
              )}
            </section>
          ))}
          {letter.closing.map((p) => (
            <p key={p} className="text-muted-foreground">{p}</p>
          ))}
          <p className="font-medium">{letter.signoff}</p>
          <footer className="pt-3 border-t text-xs text-muted-foreground space-y-1">
            <p>
              Requests:{" "}
              <a href={`mailto:${PRIVACY_REQUEST_EMAIL}`} className={LINK_CLASS} data-testid="letter-contact-email">
                {PRIVACY_REQUEST_EMAIL}
              </a>
            </p>
            <p>
              The full privacy policy, including the rights listed there, is at{" "}
              <a href="/privacy" className={LINK_CLASS} data-testid="letter-privacy-link">
                acreos.io/privacy
              </a>
              .
            </p>
          </footer>
        </article>
      </CardContent>
    </Card>
  );
}

export default DataRetentionLetter;
