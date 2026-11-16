/**
 * The S-1 borrower letter (P2-6 S2, roadmap A-5).
 *
 * A borrower never chose AcreOS — their lender did — and when a borrower asks
 * for erasure the answer today is a refusal by code name
 * (`RETENTION_REQUIRED_LOAN_RECORDS`, server/services/gdprService.ts
 * eraseLeadSubject). This module turns that posture into a plain-English
 * letter the borrower can read in their own portal: what is kept, why, and
 * what they CAN ask for.
 *
 * CONTENT LAW (P1-1 claims discipline): every factual sentence below traces to
 * shipped code or a ratified register row, and the tests in
 * tests/unit/borrowerErasureLetter.test.ts pin the traceable parts:
 *   - the refusal and its grounds        → gdprService.ts eraseLeadSubject +
 *                                           shared/privacy/dsarDomains.ts S1_RETAIN
 *   - the list of what a copy contains   → DSAR_DOMAINS, every lead-subject
 *                                           `export` domain (set equality)
 *   - what a copy leaves out             → server/services/privacy/dsarExporters.ts
 *                                           (accessToken, SECRET_COLUMNS, taxIdOnFile)
 *   - how a request is matched           → shared/privacy/dsarIdentityPosture.ts
 *   - where to send a request            → client/src/pages/privacy.tsx (privacy@acreos.io)
 *
 * It states NO deadline (Q-C2, whether the 24h clock or the 30-day promise
 * governs externally, is open) and NO outcome the code does not produce.
 * It changes nothing about the refusal itself: this file is read-only prose.
 *
 * The list of record contents is NOT derived from DSAR_DOMAINS at runtime on
 * purpose: this module ships in the customer bundle, where headroom is under
 * 1 KB, and the registry carries long operator-facing reason strings. The
 * equivalence is pinned by test instead (law 2 of CLAUDE.md: where the real
 * surface cannot consume the canonical projection, pin behavioural
 * equivalence against the rendered output).
 *
 * Pure, browser-safe (no process.env, no Date reads). Rendered by
 * client/src/components/borrower/DataRetentionLetter.tsx.
 */

/** The date this letter's prose was last checked against the code it describes. */
export const BORROWER_LETTER_REVIEWED_ON = { year: 2026, month: 11, day: 16 } as const;

/** Where a borrower sends a request (the published privacy page's address). */
export const PRIVACY_REQUEST_EMAIL = "privacy@acreos.io";

/**
 * What a borrower's copy contains, in the borrower's words. One entry per
 * lead-subject `export` domain in DSAR_DOMAINS — the test fails if the
 * registry gains or loses a domain this list does not mirror.
 */
const RECORD_CONTENTS: ReadonlyArray<{ domain: string; plain: string }> = [
  { domain: "lead_profile", plain: "your contact details, and the consent flags your lender recorded" },
  { domain: "consent_records", plain: "the record of when you agreed to, or withdrew from, texts and calls" },
  { domain: "loan_notes", plain: "the loan itself: its terms and its status" },
  { domain: "loan_payments", plain: "every payment recorded on the loan" },
  { domain: "properties", plain: "property records that name you as the buyer or the seller" },
  { domain: "communications", plain: "messages and notes exchanged with your lender, including messages sent through this portal" },
  { domain: "borrower_portal_sessions", plain: "when this portal was signed into" },
  { domain: "borrower_payment_profiles", plain: "your saved payment profiles, without the payment-method tokens" },
  { domain: "email_suppressions", plain: "any email opt-out on file for your address" },
  { domain: "activity_events", plain: "activity your lender logged on your record" },
];

/** The borrower's own context, as the portal already holds it after sign-in. */
export interface BorrowerLetterContext {
  /** From the verified loan's borrower record; null renders a plain greeting. */
  borrowerFirstName: string | null;
  /** The lender organization's name; null degrades to "your lender", never an invented name. */
  lenderName: string | null;
  /** The loan (note) number the portal session is for; null omits it. */
  loanNumber: number | null;
  /** The email the borrower verified with — the address on file for the loan. */
  emailOnFile: string | null;
}

export interface BorrowerLetterSection {
  heading: string;
  paragraphs: string[];
  /** Plain-English record contents, keyed by their registry domain for the equivalence test. */
  list?: ReadonlyArray<{ domain: string; plain: string }>;
}

export interface BorrowerErasureLetter {
  title: string;
  greeting: string;
  sections: BorrowerLetterSection[];
  closing: string[];
  signoff: string;
}

function clean(s: string | null | undefined): string | null {
  const t = (s ?? "").trim();
  return t.length > 0 ? t : null;
}

export function buildBorrowerErasureLetter(ctx: BorrowerLetterContext): BorrowerErasureLetter {
  const first = clean(ctx.borrowerFirstName);
  const lender = clean(ctx.lenderName) ?? "your lender";
  const email = clean(ctx.emailOnFile);
  const loan = ctx.loanNumber != null && Number.isFinite(ctx.loanNumber) ? `loan #${ctx.loanNumber}` : "your loan";
  const Lender = lender === "your lender" ? "Your lender" : lender;

  return {
    title: "How your information is kept, and what you can ask for",
    greeting: first ? `Hello ${first},` : "Hello,",
    sections: [
      {
        heading: "Who holds your record",
        paragraphs: [
          `${Lender} is your lender and holds the record of ${loan}. AcreOS is the software ${lender} uses to service it. ` +
            `This letter is about one question borrowers ask us: what happens if you ask for your information to be erased.`,
        ],
      },
      {
        heading: "What happens if you ask us to erase your information",
        paragraphs: [
          `We will say no, and we would rather explain why than send you a code. The loan record, its payment history, and the tax ` +
            `forms your lender prepares from them (IRS Form 1098, and Form 1099-INT where it applies) all read your name and address ` +
            `from one place: your borrower record. Erasing that record would change what those forms say.`,
          `So while any loan with ${lender} names you as the borrower, including one that has been paid off, your borrower record stays ` +
            `exactly as it is. An erasure request changes nothing on it: nothing is deleted, nothing is anonymized, and nothing is ` +
            `partly removed.`,
          `If you were sent a refusal, it carries the code RETENTION_REQUIRED_LOAN_RECORDS. This letter is what that code means.`,
        ],
      },
      {
        heading: "Why the law allows this",
        paragraphs: [
          `Privacy law lets a record be kept when a legal obligation requires it, even when the person it describes asks for erasure. ` +
            `The basis recorded in our system is GDPR Article 17(3)(b), the legal-obligation exception, because tax reporting is built from ` +
            `the borrower record.`,
          `This is the position AcreOS takes today. Our founder and counsel may still decide that some parts of a borrower record can be ` +
            `erased without touching tax reporting. If that changes, this letter changes with it.`,
        ],
      },
      {
        heading: "What you can ask for instead: a complete copy",
        paragraphs: [
          `You can ask for a copy of everything ${lender} holds about you on AcreOS. That copy includes:`,
        ],
        list: RECORD_CONTENTS,
      },
      {
        heading: "What a copy leaves out, and why",
        paragraphs: [
          `The copy leaves out secrets: your portal sign-in link and any saved payment-method tokens. It never includes your tax ` +
            `identification number itself, only whether one is on file. Anything left out is named in the copy, with the reason.`,
        ],
      },
      {
        heading: "How to ask",
        paragraphs: [
          email
            ? `Email ${PRIVACY_REQUEST_EMAIL} from ${email}, the address ${lender} has on file for this loan. Or send ${lender} a message ` +
              `through this portal and ask them to pass your request on.`
            : `Email ${PRIVACY_REQUEST_EMAIL} from the address ${lender} has on file for this loan. Or send ${lender} a message through ` +
              `this portal and ask them to pass your request on.`,
          `Before anything is released, a person at AcreOS records an identity check on your request. The match is made on that email ` +
            `address exactly: a name, a phone number or a street address alone is never enough, and your record with each lender is ` +
            `handled separately.`,
          `If something in your record is wrong, ask ${lender} to correct it. The record is theirs to maintain.`,
        ],
      },
    ],
    closing: [
      `You did not choose AcreOS; ${lender} did. That is exactly why we would rather tell you plainly what is kept, and why, than hand you a code.`,
    ],
    signoff: "AcreOS",
  };
}
