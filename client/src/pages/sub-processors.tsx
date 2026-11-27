/**
 * /legal/sub-processors — public sub-processor list (FW-SAM-2 / 90-11).
 *
 * GDPR Art. 28 + Art. 30: data controllers must publish their list of
 * sub-processors. Acquirer-diligence reviewers expect a structured,
 * version-stamped, change-log-style page (not a bullet list buried
 * mid-privacy-policy).
 *
 * The list itself lives in client/src/data/sub-processors.ts and is shared with
 * /security and the privacy policy.
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
import { useSubProcessors } from "@/lib/sub-processors";

export default function SubProcessorsPage() {
  usePageMeta(
    "Sub-processors — AcreOS",
    "AcreOS sub-processor list. GDPR Art. 28 disclosures: vendor, purpose, data categories, region, DPA link, effective date.",
  );
  // The list is served as data (/sub-processors.json, sourced from
  // client/src/data/sub-processors.ts) instead of riding inside this
  // chunk as JS — see client/src/lib/sub-processors.ts. Shell first:
  // the page frame renders immediately, the table on arrival; a failed
  // or malformed asset renders a visible error, never a silently
  // shorter list.
  const { data, error: listError } = useSubProcessors();
  const lastUpdated = data?.lastUpdated;
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
              sub-processor.{lastUpdated ? ` Last updated ${lastUpdated}.` : ""}
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
                {listError ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-3">
                      <p role="alert" className="text-sm text-destructive" data-testid="sub-processors-load-error">
                        We couldn't load the sub-processor list. Check your connection and refresh to
                        try again.
                      </p>
                    </td>
                  </tr>
                ) : !data ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-3 text-muted-foreground" aria-busy="true">
                      Loading the sub-processor list…
                    </td>
                  </tr>
                ) : (
                  data.processors.map((sp) => (
                  <tr key={sp.vendor} className="border-b border-border/40 align-top">
                    <td className="px-4 py-3 font-medium">
                      {sp.vendor}
                      {sp.optional && (
                        <span className="ml-2 text-micro uppercase tracking-wide text-muted-foreground">
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
                      {sp.dpaUrl ? (
                        <a
                          href={sp.dpaUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary hover:underline text-xs"
                        >
                          DPA →
                        </a>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {sp.effectiveDate ?? "—"}
                    </td>
                  </tr>
                  ))
                )}
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
