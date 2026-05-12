/**
 * /legal/sub-processors — public sub-processor list (FW-SAM-2 / 90-11).
 *
 * GDPR Art. 28 + Art. 30: data controllers must publish their list of
 * sub-processors. Acquirer-diligence reviewers expect a structured,
 * version-stamped, change-log-style page (not a bullet list buried
 * mid-privacy-policy).
 *
 * Each row: vendor, what they process, where (region), legal basis,
 * DPA link, effective date. Customer-facing — no auth required.
 */

import { useRef } from "react";
import { Link } from "wouter";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { usePageMeta } from "@/hooks/use-document-title";
import { SupportFeedbackButton } from "@/components/support-feedback-button";

interface SubProcessor {
  vendor: string;
  purpose: string;
  dataCategories: string[];
  region: string;
  dpaUrl: string;
  effectiveDate: string;
  optional?: boolean;
}

const SUB_PROCESSORS: SubProcessor[] = [
  {
    vendor: "Clerk",
    purpose: "Authentication, session management, MFA",
    dataCategories: ["email", "authentication factors", "session metadata"],
    region: "US",
    dpaUrl: "https://clerk.com/legal/dpa",
    effectiveDate: "2025-09-01",
  },
  {
    vendor: "Stripe",
    purpose: "Payment processing, subscription billing, tax",
    dataCategories: ["billing email", "payment method (tokenized)", "tax IDs"],
    region: "US, EU",
    dpaUrl: "https://stripe.com/legal/dpa",
    effectiveDate: "2025-09-01",
  },
  {
    vendor: "Fly.io",
    purpose: "Application hosting, Postgres, edge compute",
    dataCategories: ["all customer-uploaded data at rest"],
    region: "US",
    dpaUrl: "https://fly.io/legal/dpa",
    effectiveDate: "2025-09-01",
  },
  {
    vendor: "Cloudflare",
    purpose: "DNS, CDN, R2 object storage, DDoS protection",
    dataCategories: ["request metadata", "uploaded files"],
    region: "Global",
    dpaUrl: "https://www.cloudflare.com/cloudflare-customer-dpa/",
    effectiveDate: "2025-09-01",
  },
  {
    vendor: "Amazon Web Services (SES)",
    purpose: "Transactional email delivery",
    dataCategories: ["recipient email", "message body", "delivery metadata"],
    region: "US",
    dpaUrl: "https://aws.amazon.com/service-terms/",
    effectiveDate: "2025-09-01",
  },
  {
    vendor: "Anthropic",
    purpose: "AI features (Pax inbox draft, contract assistance)",
    dataCategories: ["redacted prompt content opted-in by operator"],
    region: "US",
    dpaUrl: "https://www.anthropic.com/legal/dpa",
    effectiveDate: "2025-12-01",
    optional: true,
  },
  {
    vendor: "OpenAI",
    purpose: "AI features (when routed via OpenRouter or direct)",
    dataCategories: ["redacted prompt content opted-in by operator"],
    region: "US",
    dpaUrl: "https://openai.com/policies/data-processing-addendum",
    effectiveDate: "2025-09-01",
    optional: true,
  },
  {
    vendor: "Twilio",
    purpose: "SMS, voice (when operator enables)",
    dataCategories: ["recipient phone", "message body", "call metadata"],
    region: "US",
    dpaUrl: "https://www.twilio.com/legal/data-protection-addendum",
    effectiveDate: "2025-10-01",
    optional: true,
  },
  {
    vendor: "Lob",
    purpose: "Direct mail (when operator enables campaigns)",
    dataCategories: ["recipient name + mailing address", "campaign content"],
    region: "US",
    dpaUrl: "https://www.lob.com/legal/data-protection-agreement",
    effectiveDate: "2025-10-01",
    optional: true,
  },
  {
    vendor: "Sentry",
    purpose: "Error monitoring, exception tracing",
    dataCategories: ["stack traces", "redacted request context"],
    region: "US",
    dpaUrl: "https://sentry.io/legal/dpa/",
    effectiveDate: "2025-09-01",
  },
  {
    vendor: "Regrid",
    purpose: "Property parcel data enrichment (when operator enables)",
    dataCategories: ["public-record parcel queries"],
    region: "US",
    dpaUrl: "https://regrid.com/dpa",
    effectiveDate: "2025-12-01",
    optional: true,
  },
];

export default function SubProcessorsPage() {
  usePageMeta(
    "Sub-processors — AcreOS",
    "AcreOS sub-processor list. GDPR Art. 28 disclosures: vendor, purpose, data categories, region, DPA link, effective date.",
  );
  const lastUpdated = "2026-05-08";
  const docRef = useRef<HTMLDivElement>(null);

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-5xl mx-auto p-4 md:p-8 pb-24">
        <div className="mb-6">
          <Button asChild variant="ghost" size="sm">
            <Link href="/legal/privacy">
              <ArrowLeft className="w-4 h-4 mr-2" aria-hidden="true" />
              Back to Privacy Policy
            </Link>
          </Button>
        </div>

        <div className="flex items-start gap-3 mb-6">
          <ShieldCheck className="w-7 h-7 text-primary mt-1" aria-hidden="true" />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Sub-processors</h1>
            <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
              Third-party service providers who process customer data on our
              behalf. We notify customers ≥30 days before adding a new
              sub-processor. Last updated {lastUpdated}.
            </p>
          </div>
        </div>

        <Card ref={docRef as any}>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 border-b border-border">
                <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Vendor</th>
                  <th className="px-4 py-3 font-medium">Purpose</th>
                  <th className="px-4 py-3 font-medium">Data categories</th>
                  <th className="px-4 py-3 font-medium">Region</th>
                  <th className="px-4 py-3 font-medium">DPA</th>
                  <th className="px-4 py-3 font-medium">Effective</th>
                </tr>
              </thead>
              <tbody>
                {SUB_PROCESSORS.map((sp) => (
                  <tr key={sp.vendor} className="border-b border-border/40 align-top">
                    <td className="px-4 py-3 font-medium">
                      {sp.vendor}
                      {sp.optional && (
                        <span className="ml-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                          opt-in
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{sp.purpose}</td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">
                      {sp.dataCategories.join(", ")}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{sp.region}</td>
                    <td className="px-4 py-3">
                      <a
                        href={sp.dpaUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline text-xs"
                      >
                        DPA →
                      </a>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {sp.effectiveDate}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <p className="mt-6 text-xs text-muted-foreground max-w-2xl">
          To object to a specific sub-processor before its effective date,{" "}
          <SupportFeedbackButton
            variant="link"
            defaultCategory="question"
            source="sub_processors"
            ariaLabel="Open support form to object to a sub-processor"
            testId="subproc-privacy-contact"
          >
            contact our privacy team
          </SupportFeedbackButton>
          . To request a Data Processing Addendum (DPA) with AcreOS as your
          processor,{" "}
          <SupportFeedbackButton
            variant="link"
            defaultCategory="question"
            source="sub_processors"
            ariaLabel="Open support form to request a DPA from the legal team"
            testId="subproc-legal-contact"
          >
            contact our legal team
          </SupportFeedbackButton>
          .
        </p>
      </div>
    </div>
  );
}
