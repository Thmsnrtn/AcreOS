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
import {
  LEGAL_ENTITY_OPERATED_BY,
  LEGAL_ENTITY_FOOTER,
  LEGAL_GOVERNING_STATE,
} from "@/lib/legal-entity";
import { LegalDocBody } from "@/components/legal-doc-body";
import { TERMS_OF_SERVICE_URL } from "@/lib/legal-doc";

// v1.1 — effective 2026-07-25 — adds §19 assignment/successor-entity clause
// (pre-LLC → LLC continuity), severability, and waiver language.
// Content sourced from docs/legal/terms-of-service.md.
// Sections moved to a served HTML asset 2026-11-21 (bundle diet) — the
// header, footer and read-aloud above/below are unchanged.
const PAGE_TITLE = "Terms of service";
const PAGE_DESCRIPTION =
  "AcreOS Terms of Service — the agreement governing access and use of the AcreOS platform for land investors.";

export default function TermsOfService() {
  usePageMeta(PAGE_TITLE, PAGE_DESCRIPTION);
  const lastUpdated = "2026-07-25";
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
                Version 1.1 · Effective date:{" "}
                <span className="tabular-nums">2026-06-01</span> · Last updated:{" "}
                <span className="tabular-nums">{lastUpdated}</span>
              </p>
              <p className="text-sm text-muted-foreground italic">
                This is a legally binding agreement. Please read it carefully before using AcreOS.
              </p>
            </div>

            {/* The 21 sections are served as a static asset (client/src/legal/
                terms-of-service.html) and rendered by LegalDocBody — see
                lib/legal-doc.ts. Edit the asset to change the sections. */}
            <LegalDocBody
              url={TERMS_OF_SERVICE_URL}
              testId="terms-doc-body"
              substitutions={{
                LEGAL_ENTITY_OPERATED_BY,
                LEGAL_GOVERNING_STATE,
              }}
              supportFeedbackButton={
                <SupportFeedbackButton
                  variant="link"
                  defaultCategory="question"
                  source="terms_legal"
                  ariaLabel="Open support form to contact the AcreOS legal team"
                  testId="terms-contact-legal"
                >
                  contact our legal team
                </SupportFeedbackButton>
              }
            />

            <div className="pt-6 border-t border-border">
              <p className="text-sm text-muted-foreground text-center">
                {LEGAL_ENTITY_FOOTER} · v1.1 — 2026-07-25
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
