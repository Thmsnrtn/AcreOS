import { useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, FileText } from "lucide-react";
import { Link } from "wouter";
import { usePageMeta } from "@/hooks/use-document-title";
import { LegalDocReadAloud } from "@/components/LegalDocReadAloud";
import { SupportFeedbackButton } from "@/components/support-feedback-button";
import { OpenGraph } from "@/components/seo/OpenGraph";
import { SITE } from "@/lib/jsonld-schemas";

// v1.0 — effective 2026-06-01 — Beatrice Whitfield, CRO (Beatrice audit P2).
// Content sourced from docs/legal/terms-of-service.md.
const PAGE_TITLE = "Terms of service";
const PAGE_DESCRIPTION =
  "AcreOS Terms of Service — the agreement governing access and use of the AcreOS platform for land investors.";

export default function TermsOfService() {
  usePageMeta(PAGE_TITLE, PAGE_DESCRIPTION);
  const lastUpdated = "2026-06-01";
  const docRef = useRef<HTMLDivElement>(null);

  return (
    <div className="min-h-screen bg-background">
      <OpenGraph
        url={`${SITE.url}/terms`}
        title={`${PAGE_TITLE} · AcreOS`}
        description={PAGE_DESCRIPTION}
        type="website"
      />
      <div className="max-w-4xl mx-auto p-4 md:p-8 pb-24">
        <div className="mb-6">
          <Button asChild variant="ghost" size="sm" data-testid="button-back-to-home">
            <Link href="/">
              <ArrowLeft className="w-4 h-4 mr-2" aria-hidden="true" />
              Back to AcreOS
            </Link>
          </Button>
        </div>

        <Card className="border-border/50" data-testid="card-terms">
          <CardContent ref={docRef} className="p-6 md:p-8 space-y-8">
            {/* ── Header ── */}
            <div className="space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <FileText className="w-8 h-8 text-primary" aria-hidden="true" />
                  <h1 className="text-3xl font-bold" data-testid="text-terms-title">
                    Terms of service
                  </h1>
                </div>
                <LegalDocReadAloud docRef={docRef} data-testid="terms-read-aloud" />
              </div>
              <p className="text-muted-foreground" data-testid="text-last-updated">
                Version 1.0 · Effective date:{" "}
                <span className="tabular-nums">2026-06-01</span> · Last updated:{" "}
                <span className="tabular-nums">{lastUpdated}</span>
              </p>
              <p className="text-sm text-muted-foreground italic">
                This is a legally binding agreement. Please read it carefully before using AcreOS.
              </p>
            </div>

            {/* ── 1. Acceptance ── */}
            <section className="space-y-4" data-testid="section-acceptance">
              <h2 className="text-xl font-semibold">1. Acceptance of terms</h2>
              <p className="text-muted-foreground leading-relaxed">
                By accessing or using the AcreOS platform ("Service"), you ("Customer," "you," or "your")
                agree to be bound by these Terms of Service ("Terms"). If you do not agree to these Terms,
                you may not access or use the Service.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                If you are accepting these Terms on behalf of a company, organization, or other legal entity,
                you represent and warrant that you have authority to bind that entity to these Terms, and
                "you" refers to that entity.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                The Service is operated by AcreOS, Inc. ("AcreOS," "we," "us," or "our"), a Delaware
                corporation.
              </p>
            </section>

            {/* ── 2. Service Description ── */}
            <section className="space-y-4" data-testid="section-description">
              <h2 className="text-xl font-semibold">2. Service description</h2>
              <p className="text-muted-foreground leading-relaxed">
                AcreOS provides a software platform for real estate investors — primarily land investors —
                that includes tools for lead management, parcel analysis, direct mail campaign management,
                offer generation, e-signature workflow, seller-finance note servicing, and AI-assisted
                workflow automation ("Pax"). The Service is a software tool. AcreOS does not provide legal,
                financial, investment, or tax advice.
              </p>
              <p className="text-muted-foreground leading-relaxed font-medium">
                AcreOS is not a broker, lender, servicer, real estate agent, investment adviser, or
                fiduciary. Nothing in the Service or in communications from AcreOS or Pax constitutes
                legal, financial, tax, or investment advice. You make every decision about your
                investments, your money, and your business.
              </p>
            </section>

            {/* ── 3. AI Disclosure ── */}
            <section className="space-y-4" data-testid="section-ai-disclosure">
              <h2 className="text-xl font-semibold">3. AI disclosure</h2>
              <p className="text-muted-foreground leading-relaxed font-medium">
                AcreOS uses artificial intelligence in its platform. Please read this section.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                AcreOS's customer-facing AI assistant is named <strong>Pax</strong>. Pax is an AI system
                that analyzes your data, surfaces insights, drafts communications for your review, scores
                leads, and automates workflow tasks on your behalf.
              </p>
              <ul className="list-disc list-inside text-muted-foreground space-y-2 ml-4">
                <li>
                  <strong>Pax is a tool, not an advisor.</strong> Pax surfaces data and offers suggestions
                  based on the information you provide and publicly available records. The Customer makes
                  every decision about their investments, offers, and money.
                </li>
                <li>
                  <strong>Pax does not give fiduciary advice.</strong> Pax will never tell you what you
                  "should" do with your money. Information, yes. Data analysis, yes. Suggestions and drafts
                  that you review, yes. Direct advice on financial decisions — never.
                </li>
                <li>
                  <strong>Pax output requires your judgment.</strong> Any draft, analysis, or observation
                  produced by Pax is a starting point for your review, not a final determination. You are
                  responsible for verifying Pax's outputs before acting on them.
                </li>
                <li>
                  <strong>AcreOS's internal operations are AI-assisted.</strong> AcreOS operates with an
                  AI executive team assisting the human founder in operating the company. This does not
                  affect your rights or the enforceability of these Terms.
                </li>
              </ul>
              <p className="text-muted-foreground leading-relaxed">
                You acknowledge that you have been informed of AcreOS's use of AI systems and consent to
                interacting with them as part of the Service.
              </p>
            </section>

            {/* ── 4. Eligibility ── */}
            <section className="space-y-4" data-testid="section-eligibility">
              <h2 className="text-xl font-semibold">4. Eligibility and account</h2>
              <p className="text-muted-foreground leading-relaxed">
                You must be at least 18 years of age to use the Service. The Service is intended for
                business and investment purposes. Use of the Service for personal, family, or household
                purposes is not the intended use case and may not be appropriate.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                You are responsible for:
              </p>
              <ul className="list-disc list-inside text-muted-foreground space-y-2 ml-4">
                <li>Maintaining the confidentiality of your account credentials</li>
                <li>All activity that occurs under your account</li>
                <li>
                  Promptly notifying AcreOS of any unauthorized access or security breach at support
                  channels identified at acreos.io
                </li>
                <li>Ensuring all users within your organization comply with these Terms</li>
              </ul>
            </section>

            {/* ── 5. Payment Terms ── */}
            <section className="space-y-4" data-testid="section-payment">
              <h2 className="text-xl font-semibold">5. Payment terms and subscription</h2>
              <p className="text-muted-foreground leading-relaxed">
                Paid subscription plans are billed in advance, monthly or annually, as selected at
                checkout. Payment is processed by Stripe. By subscribing to a paid plan, you authorize
                recurring charges.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                We will provide at least{" "}
                <span className="tabular-nums">30</span> days' advance notice before implementing any
                price increase. Continued use of the Service after the effective date of a price change
                constitutes acceptance.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                Credit-based services (direct mail, skip tracing, AI credits) are charged on a per-use
                basis per current published rates.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                <strong>Refunds:</strong> Refunds for subscription fees are issued at AcreOS's discretion.
                Credits for unused prepaid periods may be issued upon cancellation. Refunds exceeding
                $1,000 require escalation per internal policy.
              </p>
            </section>

            {/* ── 6. Free Trial ── */}
            <section className="space-y-4" data-testid="section-free-trial">
              <h2 className="text-xl font-semibold">6. Free trial</h2>
              <p className="text-muted-foreground leading-relaxed">
                Where a free trial is offered, access to paid features during the trial period is provided
                at no charge. At the end of the trial, you will be charged at the applicable subscription
                rate unless you cancel before the trial ends. No credit card is required to start a trial
                unless otherwise stated at checkout.
              </p>
            </section>

            {/* ── 7. Cancellation ── */}
            <section className="space-y-4" data-testid="section-cancellation">
              <h2 className="text-xl font-semibold">7. Cancellation and termination</h2>
              <p className="text-muted-foreground leading-relaxed">
                <strong>You may cancel your subscription at any time</strong> through account settings.
                Cancellation takes effect at the end of the current billing period. AcreOS does not charge
                cancellation fees.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                <strong>Data export upon cancellation:</strong> You may export all of your data in a
                portable format (CSV, JSON) at any time, including after cancellation, for{" "}
                <span className="tabular-nums">30</span> days following the end of your subscription.
                AcreOS does not hold your data hostage.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                <strong>AcreOS may terminate or suspend your access</strong> immediately, without prior
                notice, for:
              </p>
              <ul className="list-disc list-inside text-muted-foreground space-y-2 ml-4">
                <li>Material breach of these Terms that is not cured within 10 days of written notice</li>
                <li>Fraudulent or illegal use of the Service</li>
                <li>Non-payment of fees after a grace period</li>
                <li>Court order or regulatory requirement</li>
              </ul>
              <p className="text-muted-foreground leading-relaxed">
                Upon termination, your right to access the Service ceases. Termination does not relieve
                you of payment obligations for fees accrued prior to termination. Provisions of these
                Terms that by their nature should survive termination (including limitation of liability,
                indemnification, arbitration, and governing law) survive termination.
              </p>
            </section>

            {/* ── 8. Acceptable Use ── */}
            <section className="space-y-4" data-testid="section-acceptable-use">
              <h2 className="text-xl font-semibold">8. Acceptable use and banned practices</h2>
              <p className="text-muted-foreground leading-relaxed">
                You agree to use the Service only for lawful purposes and in compliance with all applicable
                laws. You agree NOT to use the Service to:
              </p>
              <ul className="list-disc list-inside text-muted-foreground space-y-2 ml-4">
                <li>Violate any federal, state, or local law or regulation</li>
                <li>
                  Send spam, unsolicited communications, or violate the CAN-SPAM Act (15 U.S.C. §7701 et
                  seq.) or the TCPA (47 U.S.C. §227)
                </li>
                <li>
                  Engage in predatory practices toward property owners, including misrepresentation of your
                  identity, false statements about property values, or coercive tactics
                </li>
                <li>
                  Make lending or credit decisions based on protected characteristics in violation of the
                  Fair Housing Act (42 U.S.C. §3604) or the Equal Credit Opportunity Act (15 U.S.C. §1691)
                </li>
                <li>
                  Use Pax outputs or any AcreOS data as the basis for decisions regulated by the Fair
                  Credit Reporting Act (15 U.S.C. §1681) without AcreOS's prior written consent and
                  appropriate FCRA certifications
                </li>
                <li>
                  Use the Service to discriminate against any person based on race, color, national origin,
                  religion, sex, familial status, disability, or any other protected class
                </li>
                <li>Reverse engineer, decompile, or extract source code from the Service</li>
                <li>Attempt unauthorized access to AcreOS systems or other users' accounts</li>
                <li>Introduce malware, viruses, or harmful code</li>
                <li>Resell or sublicense the Service without written authorization</li>
              </ul>
              <p className="text-muted-foreground leading-relaxed">
                Violation of this section may result in immediate termination without refund and may expose
                you to civil and criminal liability.
              </p>
            </section>

            {/* ── 9. Intellectual Property ── */}
            <section className="space-y-4" data-testid="section-ip">
              <h2 className="text-xl font-semibold">9. Intellectual property</h2>
              <p className="text-muted-foreground leading-relaxed">
                AcreOS retains all intellectual property rights in and to the Service, including all
                software, algorithms, models, designs, and content. You retain ownership of the data you
                upload to the Service. You grant AcreOS a limited license to use your data solely to
                provide and improve the Service, consistent with the Privacy Policy.
              </p>
            </section>

            {/* ── 10. Warranties Disclaimed ── */}
            <section className="space-y-4" data-testid="section-warranties">
              <h2 className="text-xl font-semibold">10. Warranties disclaimed</h2>
              <p className="text-muted-foreground leading-relaxed uppercase text-sm">
                The Service is provided "as is" and "as available," without warranty of any kind, express
                or implied, including but not limited to warranties of merchantability, fitness for a
                particular purpose, title, and non-infringement.
              </p>
              <p className="text-muted-foreground leading-relaxed uppercase text-sm">
                AcreOS does not warrant that: (a) the Service will be uninterrupted, error-free, or
                available at any particular time; (b) any data, analysis, or output from the Service
                (including Pax outputs) is accurate, complete, or suitable for any particular purpose; or
                (c) the Service will meet your specific business requirements.
              </p>
              <p className="text-muted-foreground leading-relaxed font-medium">
                Parcel data, comp estimates, AVM valuations, and lead scores are statistical estimates for
                informational purposes only. They are not appraisals, legal descriptions, or investment
                advice. You are responsible for independent verification before making any financial
                decision.
              </p>
            </section>

            {/* ── 11. Limitation of Liability ── */}
            <section className="space-y-4" data-testid="section-liability">
              <h2 className="text-xl font-semibold">11. Limitation of liability</h2>
              <p className="text-muted-foreground leading-relaxed uppercase text-sm">
                To the maximum extent permitted by applicable law, AcreOS shall not be liable for any
                indirect, incidental, special, consequential, or punitive damages, including but not
                limited to loss of profits, lost revenue, loss of data, loss of business, or loss of
                goodwill, arising out of or related to these Terms or the Service, even if AcreOS has been
                advised of the possibility of such damages.
              </p>
              <p className="text-muted-foreground leading-relaxed uppercase text-sm">
                AcreOS's total cumulative liability arising out of or related to these Terms or the Service
                shall not exceed the lesser of: (a) one thousand dollars ($1,000.00), or (b) the total
                fees you paid to AcreOS in the twelve (12) months immediately preceding the claim.
              </p>
              <p className="text-muted-foreground leading-relaxed uppercase text-sm">
                The limitations in this section apply regardless of the theory of liability (contract,
                tort, strict liability, or otherwise) and regardless of whether AcreOS was advised of the
                possibility of such liability.
              </p>
              <p className="text-muted-foreground leading-relaxed text-sm">
                Some jurisdictions do not allow the exclusion of certain warranties or the limitation of
                liability for certain damages. In such jurisdictions, AcreOS's liability is limited to the
                greatest extent permitted by law.
              </p>
            </section>

            {/* ── 12. Indemnification ── */}
            <section className="space-y-4" data-testid="section-indemnification">
              <h2 className="text-xl font-semibold">12. Customer indemnification</h2>
              <p className="text-muted-foreground leading-relaxed">
                You agree to defend, indemnify, and hold harmless AcreOS, its officers, directors,
                employees, contractors, agents, licensors, and successors from and against any claims,
                liabilities, damages, judgments, awards, losses, costs, expenses, and fees (including
                reasonable attorneys' fees) arising out of or relating to:
              </p>
              <ul className="list-disc list-inside text-muted-foreground space-y-2 ml-4">
                <li>Your violation of these Terms</li>
                <li>Your use of the Service</li>
                <li>
                  Your violation of any third-party rights, including intellectual property rights, privacy
                  rights, or applicable law
                </li>
                <li>Any content you upload, submit, or transmit through the Service</li>
                <li>
                  Your outreach campaigns and communications conducted using the Service
                </li>
                <li>
                  Any claim by your customers, leads, or third parties arising from your use of the Service
                </li>
              </ul>
            </section>

            {/* ── 13. Force Majeure ── */}
            <section className="space-y-4" data-testid="section-force-majeure">
              <h2 className="text-xl font-semibold">13. Force majeure</h2>
              <p className="text-muted-foreground leading-relaxed">
                Neither party will be liable for any failure or delay in performance of its obligations
                under these Terms (other than payment obligations) to the extent such failure or delay is
                caused by circumstances beyond that party's reasonable control, including acts of God,
                natural disasters, war, terrorism, civil unrest, governmental action, pandemic, labor
                disputes, internet or infrastructure failures, or acts or omissions of third-party service
                providers. The affected party will promptly notify the other and use commercially
                reasonable efforts to resume performance.
              </p>
            </section>

            {/* ── 14. Arbitration ── */}
            <section className="space-y-4" data-testid="section-arbitration">
              <h2 className="text-xl font-semibold">14. Dispute resolution — mandatory binding arbitration</h2>
              <p className="text-muted-foreground leading-relaxed font-medium">
                Please read this section carefully. It affects your legal rights.
              </p>
              <h3 className="text-base font-semibold text-foreground">14.1 Agreement to arbitrate</h3>
              <p className="text-muted-foreground leading-relaxed">
                You and AcreOS agree that any dispute, claim, or controversy arising out of or relating to
                these Terms or the Service (including any dispute as to the formation, validity,
                enforceability, or scope of this arbitration agreement) will be resolved exclusively by
                final, binding arbitration, rather than in court. The arbitration will be administered by
                JAMS (www.jamsadr.com) under its Streamlined Arbitration Rules and Procedures (for claims
                under $250,000) or Comprehensive Arbitration Rules and Procedures (for claims $250,000 or
                above), as applicable, in effect at the time arbitration is commenced. The arbitrator will
                have exclusive authority to resolve any dispute relating to the interpretation,
                applicability, enforceability, or formation of this agreement to arbitrate.
              </p>
              <h3 className="text-base font-semibold text-foreground">14.2 Class action waiver</h3>
              <p className="text-muted-foreground leading-relaxed uppercase text-sm">
                You and AcreOS each waive the right to bring or participate in any class, collective,
                representative, or consolidated action or proceeding, whether in arbitration or court. The
                arbitrator may not consolidate more than one person's claims and may not preside over any
                form of a class or representative proceeding. If this class action waiver is found to be
                unenforceable, the entire arbitration provision will be null and void.
              </p>
              <h3 className="text-base font-semibold text-foreground">14.3 Exceptions</h3>
              <p className="text-muted-foreground leading-relaxed">
                Either party may seek injunctive or other equitable relief from a court of competent
                jurisdiction to prevent actual or threatened infringement, misappropriation, or violation
                of intellectual property rights.
              </p>
              <h3 className="text-base font-semibold text-foreground">14.4 Location and procedure</h3>
              <p className="text-muted-foreground leading-relaxed">
                Arbitration will be conducted in Delaware or, at your election, by telephone or
                videoconference. The arbitrator will apply Delaware law and these Terms, and may award any
                relief available in court on an individual basis. The arbitrator's decision is final and
                binding and may be entered as a judgment in any court of competent jurisdiction.
              </p>
              <h3 className="text-base font-semibold text-foreground">14.5 Costs</h3>
              <p className="text-muted-foreground leading-relaxed">
                JAMS filing fees are as set forth in JAMS's fee schedule. AcreOS will pay JAMS arbitration
                fees for claims under $10,000 unless the arbitrator determines the claim is frivolous. You
                are responsible for your own attorneys' fees unless applicable law provides otherwise.
              </p>
              <h3 className="text-base font-semibold text-foreground">14.6 Opt-out</h3>
              <p className="text-muted-foreground leading-relaxed">
                You may opt out of this arbitration agreement by sending written notice to legal@acreos.io
                within <span className="tabular-nums">30</span> days of first agreeing to these Terms. Your
                opt-out notice must include your name, account email address, and a clear statement that
                you wish to opt out of arbitration.
              </p>
            </section>

            {/* ── 15. Governing Law ── */}
            <section className="space-y-4" data-testid="section-governing-law">
              <h2 className="text-xl font-semibold">15. Governing law and venue</h2>
              <p className="text-muted-foreground leading-relaxed">
                These Terms are governed by the laws of the State of Delaware, without regard to its
                conflict of law principles. AcreOS, Inc. is incorporated in Delaware; Delaware has a
                well-developed body of commercial contract law; the Court of Chancery provides specialized
                commercial dispute resolution; and Delaware choice-of-law clauses are routinely enforced
                by courts across the United States.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                For any dispute that is not subject to arbitration (including injunctive relief
                proceedings), you and AcreOS consent to the exclusive jurisdiction and venue of the state
                and federal courts located in the State of Delaware.
              </p>
            </section>

            {/* ── 16. Modifications ── */}
            <section className="space-y-4" data-testid="section-modifications">
              <h2 className="text-xl font-semibold">16. Modifications to these terms</h2>
              <p className="text-muted-foreground leading-relaxed">
                AcreOS may modify these Terms at any time. For material changes, AcreOS will provide at
                least <span className="tabular-nums">30</span> days' prior notice by email to your account
                email address, by prominent notice in the Service, or both. Your continued use of the
                Service after the effective date of modified Terms constitutes your acceptance of those
                Terms. If you do not agree to modified Terms, you must stop using the Service and cancel
                your subscription before the effective date.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                AcreOS will maintain a version history of these Terms accessible at acreos.io/terms/history.
              </p>
            </section>

            {/* ── 17. E-Sign ── */}
            <section className="space-y-4" data-testid="section-esign">
              <h2 className="text-xl font-semibold">17. E-sign consent and electronic communications</h2>
              <p className="text-muted-foreground leading-relaxed">
                By using the Service, you consent to receive electronic communications from AcreOS,
                including notices, disclosures, and account-related communications, in electronic form.
                This consent satisfies any requirement that communications be in writing.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                The Service includes native e-signature functionality governed by the Electronic Signatures
                in Global and National Commerce Act (E-SIGN Act, 15 U.S.C. §7001 et seq.) and, where
                applicable, the Uniform Electronic Transactions Act (UETA). Electronic signatures executed
                through the Service have the same legal effect as handwritten signatures. The E-SIGN
                consent flow within the signing surface satisfies §101(c) disclosure requirements.
              </p>
            </section>

            {/* ── 18. Third-Party Services ── */}
            <section className="space-y-4" data-testid="section-third-party">
              <h2 className="text-xl font-semibold">18. Third-party services and integrations</h2>
              <p className="text-muted-foreground leading-relaxed">
                The Service integrates with third-party services including Anthropic (AI), Stripe
                (payments), Fly.io (hosting), Cloudflare (network), Twilio (SMS), AWS SES (email), Lob
                (print mail), Regrid (parcel data), Clerk (authentication), PostHog (analytics), and
                Mercury (banking). Your use of these integrations is subject to each provider's terms.
                AcreOS is not responsible for the availability, accuracy, or conduct of third-party
                services.
              </p>
            </section>

            {/* ── 19. Entire Agreement ── */}
            <section className="space-y-4" data-testid="section-entire-agreement">
              <h2 className="text-xl font-semibold">19. Entire agreement</h2>
              <p className="text-muted-foreground leading-relaxed">
                These Terms, together with the Privacy Policy and any order forms or written agreements
                between you and AcreOS, constitute the entire agreement between you and AcreOS regarding
                the Service and supersede all prior agreements, representations, and understandings
                relating to the subject matter hereof.
              </p>
            </section>

            {/* ── 20. Contact ── */}
            <section className="space-y-4" data-testid="section-contact">
              <h2 className="text-xl font-semibold">20. Contact</h2>
              <p className="text-muted-foreground leading-relaxed">
                For legal inquiries:{" "}
                <a
                  href="mailto:legal@acreos.io"
                  className="underline-offset-2 hover:underline text-primary"
                >
                  legal@acreos.io
                </a>
              </p>
              <p className="text-muted-foreground leading-relaxed">
                For support questions,{" "}
                <SupportFeedbackButton
                  variant="link"
                  defaultCategory="question"
                  source="terms_legal"
                  ariaLabel="Open support form to contact the AcreOS legal team"
                  testId="terms-contact-legal"
                >
                  contact our legal team
                </SupportFeedbackButton>
                .
              </p>
            </section>

            <div className="pt-6 border-t border-border">
              <p className="text-sm text-muted-foreground text-center">
                AcreOS, Inc. · Delaware corporation · acreos.io · v1.0 — 2026-05-31
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
