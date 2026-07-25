import { useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Shield } from "lucide-react";
import { Link } from "wouter";
import { usePageMeta } from "@/hooks/use-document-title";
import { LegalDocReadAloud } from "@/components/LegalDocReadAloud";
import { SupportFeedbackButton } from "@/components/support-feedback-button";
import { OpenGraph } from "@/components/seo/OpenGraph";
import { SITE } from "@/lib/jsonld-schemas";
import { LEGAL_ENTITY_NAME, LEGAL_ENTITY_FOOTER } from "@/lib/legal-entity";

// v1.0 — effective 2026-06-01 — Beatrice Whitfield, CRO (Beatrice audit P2).
// Content sourced from docs/legal/privacy-policy.md.
// Key fixes over prior version: deletion timeline corrected to 7 days (constitution §8),
// AI/Pax disclosure added, GDPR legal bases table, breach notification timelines,
// full subprocessor list, DPA controller/processor framing.
const PAGE_TITLE = "Privacy policy";
const PAGE_DESCRIPTION =
  "How AcreOS collects, uses, and protects data from land investors and their leads — including encryption, retention, and your rights under applicable privacy laws.";

export default function PrivacyPolicy() {
  usePageMeta(PAGE_TITLE, PAGE_DESCRIPTION);
  const lastUpdated = "2026-06-01";
  const docRef = useRef<HTMLDivElement>(null);

  return (
    <div className="min-h-screen bg-background">
      <OpenGraph
        url={`${SITE.url}/privacy`}
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

        <Card className="border-border/50" data-testid="card-privacy">
          <CardContent ref={docRef} className="p-6 md:p-8 space-y-8">
            {/* ── Header ── */}
            <div className="space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <Shield className="w-8 h-8 text-primary" aria-hidden="true" />
                  <h1 className="text-3xl font-bold" data-testid="text-privacy-title">
                    Privacy policy
                  </h1>
                </div>
                <LegalDocReadAloud docRef={docRef} data-testid="privacy-read-aloud" />
              </div>
              <p className="text-muted-foreground" data-testid="text-last-updated">
                Version 1.0 · Effective date:{" "}
                <span className="tabular-nums">2026-06-01</span> · Last updated:{" "}
                <span className="tabular-nums">{lastUpdated}</span>
              </p>
              <p className="text-muted-foreground leading-relaxed">
                {LEGAL_ENTITY_NAME} ("AcreOS," "we," "us," or "our") is committed to protecting the
                privacy of our customers and their contacts. This Privacy Policy explains how we collect,
                use, disclose, and protect personal data in connection with our land investor platform
                ("Service").
              </p>
              <p className="text-muted-foreground leading-relaxed font-medium">
                We will never sell your data.
              </p>
            </div>

            {/* ── 1. Who This Applies To ── */}
            <section className="space-y-4" data-testid="section-applicability">
              <h2 className="text-xl font-semibold">1. Who this policy applies to</h2>
              <p className="text-muted-foreground leading-relaxed">
                This Policy applies to:
              </p>
              <ul className="list-disc list-inside text-muted-foreground space-y-2 ml-4">
                <li>
                  <strong>Customers:</strong> Registered users of the AcreOS platform (land investors,
                  note investors, and their team members)
                </li>
                <li>
                  <strong>Leads and Contacts:</strong> Property owners and other individuals whose
                  information is entered into the Service by Customers
                </li>
                <li>
                  <strong>Visitors:</strong> Anyone who visits acreos.io or the Service without a
                  registered account
                </li>
              </ul>
              <p className="text-muted-foreground leading-relaxed">
                Customers are primarily <strong>controllers</strong> of data about their leads and
                contacts. AcreOS acts as a <strong>processor</strong> on behalf of Customers for that
                lead/contact data. See Section 13 (Data Processing Agreement) for more.
              </p>
            </section>

            {/* ── 2. Data We Collect ── */}
            <section className="space-y-4" data-testid="section-data-collection">
              <h2 className="text-xl font-semibold">2. Data we collect</h2>

              <h3 className="text-base font-semibold text-foreground">
                2.1 Information you provide directly
              </h3>
              <ul className="list-disc list-inside text-muted-foreground space-y-2 ml-4">
                <li>
                  <strong>Account data:</strong> Name, email address, authentication credentials (managed
                  by Clerk; we do not store passwords directly)
                </li>
                <li>
                  <strong>Organization data:</strong> Business name, business type, target
                  counties/markets, onboarding preferences
                </li>
                <li>
                  <strong>Lead and contact data:</strong> Property owner names, mailing addresses, phone
                  numbers, parcel identifiers, transaction records, notes, tags, and communication history
                  you enter or import
                </li>
                <li>
                  <strong>Financial data:</strong> Note terms, payment history, seller finance records
                  (stored encrypted; payment card data processed by Stripe and not stored by AcreOS)
                </li>
                <li>
                  <strong>Campaign data:</strong> Mail content, recipient lists, campaign settings
                </li>
                <li>
                  <strong>Support communications:</strong> Messages submitted via support channels,
                  feedback forms
                </li>
                <li>
                  <strong>User-generated content:</strong> Documents, offer letters, contracts uploaded or
                  generated in the Service
                </li>
              </ul>

              <h3 className="text-base font-semibold text-foreground">
                2.2 Data collected automatically
              </h3>
              <ul className="list-disc list-inside text-muted-foreground space-y-2 ml-4">
                <li>
                  <strong>Usage data:</strong> Features accessed, actions taken, time spent, page
                  navigation
                </li>
                <li>
                  <strong>Device and browser data:</strong> IP address, browser type, operating system,
                  device identifiers, screen resolution
                </li>
                <li>
                  <strong>Log data:</strong> Server logs including access times, HTTP methods, response
                  codes
                </li>
                <li>
                  <strong>Cookies and similar technologies:</strong> Session cookies (required for
                  authentication), preference cookies, and analytics cookies (PostHog). See Section 9 for
                  cookie details.
                </li>
                <li>
                  <strong>Signing audit data:</strong> For e-signature events, IP address, browser
                  fingerprint, and timestamp are logged per E-SIGN Act requirements
                </li>
              </ul>

              <h3 className="text-base font-semibold text-foreground">
                2.3 Data from third-party sources
              </h3>
              <ul className="list-disc list-inside text-muted-foreground space-y-2 ml-4">
                <li>
                  <strong>Parcel data:</strong> Publicly available county assessor, recorder, and parcel
                  database records obtained from Regrid and similar licensed data providers, used to
                  populate property information
                </li>
                <li>
                  <strong>Skip-trace data:</strong> Third-party skip-trace services used when Customer
                  activates skip-tracing features (Customer is responsible for compliance with applicable
                  laws when using this data)
                </li>
              </ul>
            </section>

            {/* ── 3. How We Use Data ── */}
            <section className="space-y-4" data-testid="section-data-usage">
              <h2 className="text-xl font-semibold">3. How we use data</h2>
              <p className="text-muted-foreground leading-relaxed">
                We use the data described above to:
              </p>
              <ul className="list-disc list-inside text-muted-foreground space-y-2 ml-4">
                <li>
                  <strong>Provide the Service:</strong> Operate the platform, process transactions, service
                  notes, generate AI-assisted outputs via Pax
                </li>
                <li>
                  <strong>Communicate with you:</strong> Send transactional emails (receipts, alerts,
                  signing notifications), account notifications, and — where you have consented — marketing
                  communications
                </li>
                <li>
                  <strong>Improve the Service:</strong> Analyze usage patterns, identify bugs, run A/B
                  tests, train and evaluate internal AI models on aggregated, de-identified data
                </li>
                <li>
                  <strong>Ensure security and prevent fraud:</strong> Detect anomalous behavior, verify
                  identity, prevent abuse
                </li>
                <li>
                  <strong>Comply with legal obligations:</strong> Respond to lawful requests from courts
                  and regulators, maintain records required by law
                </li>
                <li>
                  <strong>Honor deletion requests:</strong> Process data-subject requests as described in
                  Section 7
                </li>
              </ul>
              <p className="text-muted-foreground leading-relaxed font-medium">
                We do not use your lead/contact data or your customer business data to train AI models that
                benefit other customers or third parties without explicit consent.
              </p>
            </section>

            {/* ── 4. AI Processing and Pax ── */}
            <section className="space-y-4" data-testid="section-ai-processing">
              <h2 className="text-xl font-semibold">4. AI processing and Pax</h2>
              <p className="text-muted-foreground leading-relaxed">
                The Service uses AI systems, including <strong>Pax</strong> (our customer-facing AI
                assistant) and internal AI models. When you use Pax:
              </p>
              <ul className="list-disc list-inside text-muted-foreground space-y-2 ml-4">
                <li>
                  Your prompts, uploaded documents, and the context of your account (lead data, property
                  data, notes) may be sent to AI model providers (currently Anthropic) to generate
                  responses
                </li>
                <li>
                  AI providers process this data under their own privacy policies and data use agreements;
                  see the subprocessor list in Section 8
                </li>
                <li>Pax outputs are suggestions for your review; AcreOS does not guarantee their accuracy</li>
                <li>
                  You can reduce the data sent to Pax by limiting your queries and by using the autonomy
                  controls in Settings (Pax &gt; Controls)
                </li>
              </ul>
            </section>

            {/* ── 5. Legal Bases (GDPR) ── */}
            <section className="space-y-4" data-testid="section-gdpr-bases">
              <h2 className="text-xl font-semibold">5. Legal bases for processing (GDPR)</h2>
              <p className="text-muted-foreground leading-relaxed">
                For customers in the European Economic Area (EEA), United Kingdom, or Switzerland, we
                process personal data on the following legal bases:
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-muted-foreground border-collapse">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-2 pr-4 font-semibold text-foreground">Processing activity</th>
                      <th className="text-left py-2 font-semibold text-foreground">Legal basis</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    <tr>
                      <td className="py-2 pr-4">Providing the contracted Service</td>
                      <td className="py-2">Performance of contract (Art. 6(1)(b))</td>
                    </tr>
                    <tr>
                      <td className="py-2 pr-4">Sending transactional communications</td>
                      <td className="py-2">Performance of contract (Art. 6(1)(b))</td>
                    </tr>
                    <tr>
                      <td className="py-2 pr-4">Security and fraud prevention</td>
                      <td className="py-2">Legitimate interests (Art. 6(1)(f))</td>
                    </tr>
                    <tr>
                      <td className="py-2 pr-4">Analytics and product improvement</td>
                      <td className="py-2">Legitimate interests (Art. 6(1)(f))</td>
                    </tr>
                    <tr>
                      <td className="py-2 pr-4">Marketing communications</td>
                      <td className="py-2">Consent (Art. 6(1)(a))</td>
                    </tr>
                    <tr>
                      <td className="py-2 pr-4">Compliance with legal obligations</td>
                      <td className="py-2">Legal obligation (Art. 6(1)(c))</td>
                    </tr>
                    <tr>
                      <td className="py-2 pr-4">E-signature audit trail</td>
                      <td className="py-2">Legal obligation + legitimate interests</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="text-muted-foreground leading-relaxed text-sm">
                Where we rely on legitimate interests, we have assessed that our interests are not
                overridden by your rights and interests. You may object to processing based on legitimate
                interests; see Section 7.
              </p>
            </section>

            {/* ── 6. Data Retention ── */}
            <section className="space-y-4" data-testid="section-data-retention">
              <h2 className="text-xl font-semibold">6. Data retention</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-muted-foreground border-collapse">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-2 pr-4 font-semibold text-foreground">Data type</th>
                      <th className="text-left py-2 font-semibold text-foreground">Retention period</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    <tr>
                      <td className="py-2 pr-4">Account and organization data</td>
                      <td className="py-2">
                        Duration of active subscription + <span className="tabular-nums">90</span> days
                        post-cancellation
                      </td>
                    </tr>
                    <tr>
                      <td className="py-2 pr-4">Lead and contact data</td>
                      <td className="py-2">
                        Duration of active subscription + <span className="tabular-nums">90</span> days
                        post-cancellation
                      </td>
                    </tr>
                    <tr>
                      <td className="py-2 pr-4">Note and financial records</td>
                      <td className="py-2">
                        Duration of subscription + <span className="tabular-nums">7</span> years (legal/regulatory
                        requirement for financial records)
                      </td>
                    </tr>
                    <tr>
                      <td className="py-2 pr-4">E-signature audit logs</td>
                      <td className="py-2">
                        <span className="tabular-nums">7</span> years from date of signing (statute of limitations)
                      </td>
                    </tr>
                    <tr>
                      <td className="py-2 pr-4">ATR determination records</td>
                      <td className="py-2">
                        <span className="tabular-nums">3</span> years from note origination date per 12 C.F.R.
                        §1026.25(c)(3)
                      </td>
                    </tr>
                    <tr>
                      <td className="py-2 pr-4">Server logs</td>
                      <td className="py-2">
                        <span className="tabular-nums">90</span> days rolling
                      </td>
                    </tr>
                    <tr>
                      <td className="py-2 pr-4">Backup snapshots</td>
                      <td className="py-2">Purged within <span className="tabular-nums">30</span> days of primary deletion</td>
                    </tr>
                    <tr>
                      <td className="py-2 pr-4">Billing records</td>
                      <td className="py-2">
                        <span className="tabular-nums">7</span> years (tax and accounting obligations)
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="text-muted-foreground leading-relaxed font-medium">
                Deletion requests: Upon a verified deletion request, AcreOS will delete or anonymize your
                personal data within <span className="tabular-nums">7</span> days of verification, except
                where retention is required by law (e.g., financial records, e-signature audit logs). See
                Section 7.
              </p>
            </section>

            {/* ── 7. Your Rights ── */}
            <section className="space-y-4" data-testid="section-user-rights">
              <h2 className="text-xl font-semibold">7. Your rights</h2>
              <p className="text-muted-foreground leading-relaxed">
                Depending on your jurisdiction, you have the following rights regarding your personal data:
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-muted-foreground border-collapse">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-2 pr-4 font-semibold text-foreground">Right</th>
                      <th className="text-left py-2 pr-4 font-semibold text-foreground">What it means</th>
                      <th className="text-left py-2 font-semibold text-foreground">How to exercise</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    <tr>
                      <td className="py-2 pr-4 font-medium">Access</td>
                      <td className="py-2 pr-4">Obtain a copy of all personal data we hold about you</td>
                      <td className="py-2">
                        <Link
                          href="/settings/privacy"
                          className="underline-offset-2 hover:underline text-primary"
                          data-testid="rights-dsr-access"
                        >
                          Data Subject Request
                        </Link>
                      </td>
                    </tr>
                    <tr>
                      <td className="py-2 pr-4 font-medium">Portability</td>
                      <td className="py-2 pr-4">
                        Receive your data in a machine-readable format (JSON, CSV)
                      </td>
                      <td className="py-2">Data export in account settings</td>
                    </tr>
                    <tr>
                      <td className="py-2 pr-4 font-medium">Correction</td>
                      <td className="py-2 pr-4">Correct inaccurate or incomplete data</td>
                      <td className="py-2">Edit in account settings or via support</td>
                    </tr>
                    <tr>
                      <td className="py-2 pr-4 font-medium">Deletion</td>
                      <td className="py-2 pr-4">
                        Permanent deletion of your personal data (subject to legal retention obligations)
                      </td>
                      <td className="py-2">
                        Data Subject Request; honored within <span className="tabular-nums">7</span> days
                      </td>
                    </tr>
                    <tr>
                      <td className="py-2 pr-4 font-medium">Restriction</td>
                      <td className="py-2 pr-4">Limit our processing in certain circumstances</td>
                      <td className="py-2">
                        <Link
                          href="/settings/privacy"
                          className="underline-offset-2 hover:underline text-primary"
                          data-testid="rights-dsr-restriction"
                        >
                          Data Subject Request
                        </Link>
                      </td>
                    </tr>
                    <tr>
                      <td className="py-2 pr-4 font-medium">Objection</td>
                      <td className="py-2 pr-4">Object to processing based on legitimate interests</td>
                      <td className="py-2">
                        <Link
                          href="/settings/privacy"
                          className="underline-offset-2 hover:underline text-primary"
                          data-testid="rights-dsr-objection"
                        >
                          Data Subject Request
                        </Link>
                      </td>
                    </tr>
                    <tr>
                      <td className="py-2 pr-4 font-medium">Withdraw consent</td>
                      <td className="py-2 pr-4">
                        Withdraw any consent you have given (e.g., for marketing)
                      </td>
                      <td className="py-2">Email preferences or support</td>
                    </tr>
                    <tr>
                      <td className="py-2 pr-4 font-medium">Opt out of sale (CCPA)</td>
                      <td className="py-2 pr-4">
                        We do not sell or share personal data for cross-context behavioral advertising
                      </td>
                      <td className="py-2">N/A — this practice does not occur</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="text-muted-foreground leading-relaxed">
                <strong>To exercise any right:</strong> Submit a request via{" "}
                <Link
                  href="/settings/privacy"
                  className="underline-offset-2 hover:underline text-primary"
                  data-testid="privacy-rights-dsar"
                >
                  privacy settings (Data Subject Requests)
                </Link>{" "}
                or email{" "}
                <a
                  href="mailto:privacy@acreos.io"
                  className="underline-offset-2 hover:underline text-primary"
                >
                  privacy@acreos.io
                </a>
                . We will respond within <span className="tabular-nums">30</span> days for routine
                requests, or within the statutory deadline applicable to your jurisdiction (45 days for
                CCPA, 30 days for GDPR). We may need to verify your identity before processing certain
                requests.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                <strong>California residents (CCPA/CPRA):</strong> In addition to the rights above, you
                have the right to know the categories of personal information we collect, the purposes for
                which it is used, and whether it is sold (it is not). You have the right to limit the use
                of sensitive personal information (as defined by CPRA). To exercise California rights:{" "}
                <a
                  href="mailto:privacy@acreos.io"
                  className="underline-offset-2 hover:underline text-primary"
                >
                  privacy@acreos.io
                </a>{" "}
                or{" "}
                <Link
                  href="/settings/privacy"
                  className="underline-offset-2 hover:underline text-primary"
                  data-testid="privacy-rights-dsar-ccpa"
                >
                  privacy settings
                </Link>
                .
              </p>
            </section>

            {/* ── 8. Subprocessors ── */}
            <section className="space-y-4" data-testid="section-subprocessors">
              <h2 className="text-xl font-semibold">8. Subprocessors</h2>
              <p className="text-muted-foreground leading-relaxed text-sm">
                AcreOS uses the following third-party service providers ("subprocessors") who may process
                personal data on our behalf. This list is updated when subprocessors change; material
                changes will be notified per Section 15 of the Terms.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-muted-foreground border-collapse">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-2 pr-4 font-semibold text-foreground">Subprocessor</th>
                      <th className="text-left py-2 pr-4 font-semibold text-foreground">Category</th>
                      <th className="text-left py-2 pr-4 font-semibold text-foreground">Data processed</th>
                      <th className="text-left py-2 font-semibold text-foreground">Location</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    <tr>
                      <td className="py-2 pr-4 font-medium">Anthropic</td>
                      <td className="py-2 pr-4">AI model provider (Pax)</td>
                      <td className="py-2 pr-4">Prompt content, lead/property context sent to Pax</td>
                      <td className="py-2">United States</td>
                    </tr>
                    <tr>
                      <td className="py-2 pr-4 font-medium">OpenRouter</td>
                      <td className="py-2 pr-4">LLM routing / failover gateway</td>
                      <td className="py-2 pr-4">Prompt content, lead/property context (routed to underlying LLM provider)</td>
                      <td className="py-2">United States</td>
                    </tr>
                    <tr>
                      <td className="py-2 pr-4 font-medium">Voyage AI</td>
                      <td className="py-2 pr-4">Semantic-search embeddings</td>
                      <td className="py-2 pr-4">Text content of notes, leads, and documents (embedded as vectors for retrieval)</td>
                      <td className="py-2">United States</td>
                    </tr>
                    <tr>
                      <td className="py-2 pr-4 font-medium">Stripe</td>
                      <td className="py-2 pr-4">Payment processing</td>
                      <td className="py-2 pr-4">Subscription billing, payment card data</td>
                      <td className="py-2">United States</td>
                    </tr>
                    <tr>
                      <td className="py-2 pr-4 font-medium">Fly.io</td>
                      <td className="py-2 pr-4">Cloud hosting and compute</td>
                      <td className="py-2 pr-4">All Service data (hosted infrastructure)</td>
                      <td className="py-2">United States (+ EU regions as applicable)</td>
                    </tr>
                    <tr>
                      <td className="py-2 pr-4 font-medium">Cloudflare</td>
                      <td className="py-2 pr-4">CDN, DNS, DDoS protection</td>
                      <td className="py-2 pr-4">IP addresses, request metadata</td>
                      <td className="py-2">United States</td>
                    </tr>
                    <tr>
                      <td className="py-2 pr-4 font-medium">Clerk</td>
                      <td className="py-2 pr-4">Authentication</td>
                      <td className="py-2 pr-4">User identity, authentication tokens</td>
                      <td className="py-2">United States</td>
                    </tr>
                    <tr>
                      <td className="py-2 pr-4 font-medium">AWS (SES)</td>
                      <td className="py-2 pr-4">Email delivery</td>
                      <td className="py-2 pr-4">Email addresses, email content</td>
                      <td className="py-2">United States</td>
                    </tr>
                    <tr>
                      <td className="py-2 pr-4 font-medium">Twilio</td>
                      <td className="py-2 pr-4">SMS communications</td>
                      <td className="py-2 pr-4">Phone numbers, SMS content</td>
                      <td className="py-2">United States</td>
                    </tr>
                    <tr>
                      <td className="py-2 pr-4 font-medium">Lob</td>
                      <td className="py-2 pr-4">Direct mail fulfillment</td>
                      <td className="py-2 pr-4">Recipient names and postal addresses</td>
                      <td className="py-2">United States</td>
                    </tr>
                    <tr>
                      <td className="py-2 pr-4 font-medium">Regrid</td>
                      <td className="py-2 pr-4">Parcel data</td>
                      <td className="py-2 pr-4">Parcel identifiers, publicly-sourced property data</td>
                      <td className="py-2">United States</td>
                    </tr>
                    <tr>
                      <td className="py-2 pr-4 font-medium">PostHog</td>
                      <td className="py-2 pr-4">Product analytics</td>
                      <td className="py-2 pr-4">Usage events, session data, anonymized identifiers</td>
                      <td className="py-2">United States / EU</td>
                    </tr>
                    <tr>
                      <td className="py-2 pr-4 font-medium">Mercury</td>
                      <td className="py-2 pr-4">Business banking</td>
                      <td className="py-2 pr-4">Wire/ACH origination data (internal company use)</td>
                      <td className="py-2">United States</td>
                    </tr>
                    <tr>
                      <td className="py-2 pr-4 font-medium">Sentry</td>
                      <td className="py-2 pr-4">Error monitoring</td>
                      <td className="py-2 pr-4">Stack traces, anonymized user identifiers</td>
                      <td className="py-2">United States</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="text-muted-foreground leading-relaxed text-sm">
                For EU/EEA customers, transfers to US-based subprocessors are governed by Standard
                Contractual Clauses (SCCs) as required by GDPR Chapter V. AcreOS will provide copies of
                applicable SCCs upon written request.
              </p>
            </section>

            {/* ── 9. Cookies ── */}
            <section className="space-y-4" data-testid="section-cookies">
              <h2 className="text-xl font-semibold">9. Cookies and tracking technologies</h2>
              <p className="text-muted-foreground leading-relaxed">
                We use the following cookie categories:
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-muted-foreground border-collapse">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-2 pr-4 font-semibold text-foreground">Category</th>
                      <th className="text-left py-2 pr-4 font-semibold text-foreground">Purpose</th>
                      <th className="text-left py-2 font-semibold text-foreground">Can be disabled?</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    <tr>
                      <td className="py-2 pr-4 font-medium">Strictly necessary</td>
                      <td className="py-2 pr-4">
                        Session management, authentication, CSRF protection
                      </td>
                      <td className="py-2">No — required for Service to function</td>
                    </tr>
                    <tr>
                      <td className="py-2 pr-4 font-medium">Functional</td>
                      <td className="py-2 pr-4">
                        Remembering preferences, onboarding state, dismissed banners
                      </td>
                      <td className="py-2">Partially — some preferences may reset</td>
                    </tr>
                    <tr>
                      <td className="py-2 pr-4 font-medium">Analytics</td>
                      <td className="py-2 pr-4">
                        PostHog usage analytics, product improvement (data is sampled and anonymized)
                      </td>
                      <td className="py-2">
                        Yes — contact{" "}
                        <a
                          href="mailto:privacy@acreos.io"
                          className="underline-offset-2 hover:underline text-primary"
                        >
                          privacy@acreos.io
                        </a>
                      </td>
                    </tr>
                    <tr>
                      <td className="py-2 pr-4 font-medium">Marketing</td>
                      <td className="py-2 pr-4">
                        None — we do not run retargeting or behavioral advertising cookies
                      </td>
                      <td className="py-2">N/A</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="text-muted-foreground leading-relaxed">
                You can manage cookies through your browser settings. Disabling strictly necessary cookies
                will prevent you from logging in to the Service. A cookie consent banner is displayed to
                users in jurisdictions requiring explicit consent (EU/EEA, UK).
              </p>
            </section>

            {/* ── 10. Data Security ── */}
            <section className="space-y-4" data-testid="section-security">
              <h2 className="text-xl font-semibold">10. Data security</h2>
              <p className="text-muted-foreground leading-relaxed">
                AcreOS implements technical and organizational measures to protect personal data:
              </p>
              <ul className="list-disc list-inside text-muted-foreground space-y-2 ml-4">
                <li>Encryption in transit: TLS 1.3 for all connections</li>
                <li>Encryption at rest: AES-256 for database storage</li>
                <li>
                  API key encryption: Customer BYOK keys are encrypted at rest and decrypted only for
                  authorized API calls
                </li>
                <li>Access controls: Role-based access; principle of least privilege</li>
                <li>
                  Audit logging: Sensitive actions (data access, deletions, ATR determinations,
                  e-signatures) are logged immutably
                </li>
                <li>
                  Vulnerability management: Automated dependency scanning; security review on production
                  deploys touching customer data
                </li>
              </ul>
              <p className="text-muted-foreground leading-relaxed">
                No system is <span className="tabular-nums">100</span>% secure. We cannot guarantee
                absolute security. We will notify you of any breach affecting your personal data as
                described in Section 11.
              </p>
            </section>

            {/* ── 11. Breach Notification ── */}
            <section className="space-y-4" data-testid="section-breach">
              <h2 className="text-xl font-semibold">11. Data breach notification</h2>
              <p className="text-muted-foreground leading-relaxed">
                In the event of a personal data breach that poses a risk to the rights and freedoms of
                individuals:
              </p>
              <ul className="list-disc list-inside text-muted-foreground space-y-2 ml-4">
                <li>
                  <strong>GDPR:</strong> We will notify the applicable supervisory authority within{" "}
                  <span className="tabular-nums">72</span> hours of becoming aware of the breach, where
                  feasible.
                </li>
                <li>
                  <strong>CCPA / US state laws:</strong> We will notify affected California residents (and
                  residents of other states with applicable breach notification laws) without unreasonable
                  delay, and no later than required by applicable state law (generally 30–45 days from
                  discovery for most US states).
                </li>
                <li>
                  <strong>Customer notification:</strong> We will notify affected Customers via email
                  within <span className="tabular-nums">72</span> hours of determining that a breach has
                  occurred that is reasonably likely to affect their data.
                </li>
              </ul>
              <p className="text-muted-foreground leading-relaxed">
                Breach notification will describe: the nature of the breach, the categories of data
                involved, approximate number of records affected, likely consequences, and measures taken
                or proposed to address the breach.
              </p>
            </section>

            {/* ── 12. Children's Privacy ── */}
            <section className="space-y-4" data-testid="section-children">
              <h2 className="text-xl font-semibold">12. Children's privacy</h2>
              <p className="text-muted-foreground leading-relaxed">
                The Service is not directed to individuals under the age of{" "}
                <span className="tabular-nums">18</span>. We do not knowingly collect personal information
                from children under 18. If we learn that we have collected personal data from a child
                under 18 without verifiable parental consent, we will delete it promptly. We do not market
                to or target individuals under 18 or individuals identified as being in financial distress.
              </p>
            </section>

            {/* ── 13. Data Processing Agreement ── */}
            <section className="space-y-4" data-testid="section-dpa">
              <h2 className="text-xl font-semibold">13. Data processing agreement (controller/processor relationship)</h2>
              <p className="text-muted-foreground leading-relaxed">
                Where Customers use AcreOS to process personal data about their leads and contacts on
                behalf of their own business:
              </p>
              <ul className="list-disc list-inside text-muted-foreground space-y-2 ml-4">
                <li>The Customer is the <strong>data controller</strong></li>
                <li>AcreOS is the <strong>data processor</strong></li>
                <li>
                  AcreOS processes that data only on the Customer's documented instructions (i.e., to
                  provide the Service)
                </li>
                <li>
                  AcreOS does not use lead/contact data for any purpose other than providing the contracted
                  Service to that Customer
                </li>
              </ul>
              <p className="text-muted-foreground leading-relaxed">
                Customers who require a formal Data Processing Agreement (DPA) — for example, EU-based
                customers subject to GDPR Art. 28 — may request one at{" "}
                <a
                  href="mailto:legal@acreos.io"
                  className="underline-offset-2 hover:underline text-primary"
                >
                  legal@acreos.io
                </a>
                .
              </p>
            </section>

            {/* ── 14. International Transfers ── */}
            <section className="space-y-4" data-testid="section-international">
              <h2 className="text-xl font-semibold">14. International transfers</h2>
              <p className="text-muted-foreground leading-relaxed">
                AcreOS is based in the United States. If you access the Service from outside the United
                States, your data is transferred to and processed in the United States. Where we transfer
                personal data from the EEA, UK, or Switzerland to the US or other countries not deemed
                adequate by the European Commission, we use Standard Contractual Clauses (SCCs) as the
                transfer mechanism.
              </p>
            </section>

            {/* ── 15. Changes to This Policy ── */}
            <section className="space-y-4" data-testid="section-changes">
              <h2 className="text-xl font-semibold">15. Changes to this policy</h2>
              <p className="text-muted-foreground leading-relaxed">
                We may update this Policy from time to time. For material changes, we will provide at
                least <span className="tabular-nums">30</span> days' notice via email to your account email
                address or by prominent notice in the Service. The updated Policy will be posted at
                acreos.io/privacy with the new effective date. Your continued use of the Service after the
                effective date constitutes acceptance of the updated Policy.
              </p>
            </section>

            {/* ── 16. Contact ── */}
            <section className="space-y-4" data-testid="section-contact">
              <h2 className="text-xl font-semibold">16. Contact</h2>
              <p className="text-muted-foreground leading-relaxed">
                <strong>Privacy inquiries and data subject requests:</strong>
              </p>
              <ul className="list-disc list-inside text-muted-foreground space-y-2 ml-4">
                <li>
                  <a
                    href="mailto:privacy@acreos.io"
                    className="underline-offset-2 hover:underline text-primary"
                  >
                    privacy@acreos.io
                  </a>
                </li>
                <li>
                  <Link
                    href="/settings/privacy"
                    className="underline-offset-2 hover:underline text-primary"
                    data-testid="privacy-settings-link"
                  >
                    Privacy settings (in-app data subject request portal)
                  </Link>
                </li>
              </ul>
              <p className="text-muted-foreground leading-relaxed">
                <strong>Legal inquiries:</strong>{" "}
                <a
                  href="mailto:legal@acreos.io"
                  className="underline-offset-2 hover:underline text-primary"
                >
                  legal@acreos.io
                </a>
              </p>
              <p className="text-muted-foreground leading-relaxed">
                For other questions,{" "}
                <SupportFeedbackButton
                  variant="link"
                  defaultCategory="support"
                  source="privacy_page"
                  ariaLabel="Open support form to contact the AcreOS privacy team"
                  testId="privacy-contact-team"
                >
                  contact our privacy team
                </SupportFeedbackButton>
                .
              </p>
              <p className="text-muted-foreground leading-relaxed text-sm">
                For EU/EEA residents: If you believe we have processed your personal data in violation of
                applicable law, you have the right to lodge a complaint with your local supervisory
                authority (e.g., the UK ICO, Ireland DPC, or the supervisory authority in your EU member
                state).
              </p>
            </section>

            <div className="pt-6 border-t border-border">
              <p className="text-sm text-muted-foreground text-center">
                {LEGAL_ENTITY_FOOTER} · v1.0 — 2026-05-31
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
