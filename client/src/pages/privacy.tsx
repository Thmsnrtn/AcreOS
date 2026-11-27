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
import { PAX_CONTROLS_LABEL } from "@shared/pax-glossary-core";
import { LegalDocBody } from "@/components/legal-doc-body";
import { PRIVACY_POLICY_URL } from "@/lib/legal-doc";
import { subProcessorRowsHtml } from "@/data/sub-processors";
import { useSubProcessors } from "@/lib/sub-processors";

// v1.0 — effective 2026-06-01 — Beatrice Whitfield, CRO (Beatrice audit P2).
// Content sourced from docs/legal/privacy-policy.md.
// Key fixes over prior version: deletion timeline corrected to 7 days (constitution §8),
// AI/Pax disclosure added, GDPR legal bases table, breach notification timelines,
// full subprocessor list, DPA controller/processor framing.
// Sections moved to a served HTML asset 2026-11-21 (bundle diet) — the
// header, footer and read-aloud above/below are unchanged.
const PAGE_TITLE = "Privacy policy";
const PAGE_DESCRIPTION =
  "How AcreOS collects, uses, and protects data from land investors and their leads — including encryption, retention, and your rights under applicable privacy laws.";

export default function PrivacyPolicy() {
  usePageMeta(PAGE_TITLE, PAGE_DESCRIPTION);
  const lastUpdated = "2026-06-01";
  const docRef = useRef<HTMLDivElement>(null);
  // Section 8's rows come from the sub-processor list, which is served
  // as data (/sub-processors.json, sourced from
  // client/src/data/sub-processors.ts) instead of riding inside this
  // chunk as JS — see client/src/lib/sub-processors.ts. The body is
  // rendered only once the list is in hand, so the policy never renders
  // with a silently-empty Section 8 table; a failed or malformed asset
  // renders a visible error in the body's place.
  const { data: subProcessors, error: subProcessorsError } = useSubProcessors();

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

            {/* The 16 sections are served as a static asset (client/src/legal/
                privacy-policy.html) and rendered by LegalDocBody — see
                lib/legal-doc.ts. Edit the asset to change the sections. */}
            {subProcessorsError ? (
              <p role="alert" className="text-sm text-destructive" data-testid="privacy-sub-processors-load-error">
                We couldn't load this page's content. Please refresh and try again.
              </p>
            ) : !subProcessors ? (
              <p className="text-sm text-muted-foreground" aria-busy="true">
                Loading the privacy policy…
              </p>
            ) : (
              <LegalDocBody
                url={PRIVACY_POLICY_URL}
                testId="privacy-doc-body"
                substitutions={{
                  PAX_CONTROLS_LABEL,
                  // Section 8's table rows come from the shared sub-processor
                  // list, loaded as served data above.
                  SUBPROCESSOR_ROWS: subProcessorRowsHtml(subProcessors.processors),
                }}
              supportFeedbackButton={
                <SupportFeedbackButton
                  variant="link"
                  defaultCategory="support"
                  source="privacy_page"
                  ariaLabel="Open support form to contact the AcreOS privacy team"
                  testId="privacy-contact-team"
                >
                  contact our privacy team
                </SupportFeedbackButton>
                }
              />
            )}

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
