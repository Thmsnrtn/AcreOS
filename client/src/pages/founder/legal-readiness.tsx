/**
 * /founder/legal-readiness — Launch Legal & Peace-of-Mind Readiness.
 *
 * A founder-readable rendering of docs/legal/launch-readiness-checklist.md:
 * every legal/operational obligation of launching AcreOS, grouped by area,
 * each with a plain-language status. This is the closed, handled list Tom
 * asked for so the "legal logistics" cloud becomes finite.
 *
 * Static surface — the source of truth is the markdown checklist; this page
 * mirrors its structure so Tom can scan status at a glance and open the full
 * doc for the "why / what to do / who owns it" detail. No API, no DB.
 */

import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { staggerContainer, staggerItem } from "@/lib/animations";
import { motion } from "framer-motion";
import {
  Building2, FileText, Database, Scale, CreditCard, PenTool,
  ShieldCheck, Umbrella, MapPin, type LucideIcon,
} from "lucide-react";

type Status = "done" | "needs-tom" | "needs-vendor" | "open";

const STATUS_CONFIG: Record<Status, { label: string; className: string }> = {
  done: {
    label: "Done",
    className: "bg-acr-pos/10 text-acr-pos border-acr-pos/20",
  },
  "needs-tom": {
    label: "Needs Tom",
    className: "bg-acr-warn/10 text-acr-warn border-acr-warn/20",
  },
  "needs-vendor": {
    label: "Needs vendor",
    className: "bg-acr-brand/10 text-acr-brand border-acr-brand/20",
  },
  open: {
    label: "Open (we prep)",
    className: "bg-acr-surface text-acr-ink-3 border-acr-line",
  },
};

interface Item {
  label: string;
  status: Status;
  note: string;
}

interface Section {
  title: string;
  icon: LucideIcon;
  items: Item[];
}

const SECTIONS: Section[] = [
  {
    title: "1. Business entity, registered agent, EIN",
    icon: Building2,
    items: [
      { label: "Form the operating entity (LLC)", status: "needs-tom", note: "No entity = Tom is personally AcreOS today. The #1 item. Tom decides LLC-now vs. deferred C-corp." },
      { label: "Operating Agreement", status: "needs-vendor", note: "Reinforces the liability shield. Template via formation service; ~1 lawyer hour to review." },
      { label: "EIN (federal tax ID)", status: "open", note: "Free, ~10 min at IRS.gov once the entity exists." },
      { label: "Registered agent", status: "needs-vendor", note: "Receives legal service; also keeps Tom's home address off emails + Terms." },
      { label: "C-corp / Delaware conversion", status: "needs-tom", note: "DEFERRED per Tom's 2026-06-06 H1 decision. No action this quarter." },
    ],
  },
  {
    title: "2. Terms of Service + Privacy Policy",
    icon: FileText,
    items: [
      { label: "ToS v1 drafted", status: "done", note: "docs/legal/terms-of-service.md — tool-not-advisor, AI disclosure, liability cap." },
      { label: "Privacy Policy v1 drafted", status: "done", note: "docs/legal/privacy-policy.md — controller/processor roles, never-sell commitment." },
      { label: "New ToS/Privacy live on pages", status: "needs-tom", note: "Verify /terms + /privacy render v1, not old thin version (Iris's surface)." },
      { label: "Sub-processor list completeness", status: "open", note: "Audit gap: add Anthropic, Fly, Cloudflare, Mercury, SES, PostHog, Twilio, Clerk." },
      { label: "Lawyer review before public reliance", status: "needs-vendor", note: "~2-3 counsel hours on ToS/Privacy/DPA; liability cap + class waiver are the priority." },
      { label: "Deletion timeline matches constitution (7 days)", status: "needs-tom", note: "Old policy said 30; constitution #8 says 7. Verify live page." },
    ],
  },
  {
    title: "3. Data licensing posture",
    icon: Database,
    items: [
      { label: "Data-license register in code", status: "done", note: "server/services/providers/data-licenses.ts — license + redistributable per source." },
      { label: "Federal sources redistributable (§105)", status: "done", note: "FEMA/USGS/USDA/USFWS/Census/BLM/EPA = public domain, redistributable." },
      { label: "County 'review-required' default", status: "done", note: "Live-passthrough only until a human reads each county's portal terms." },
      { label: "OSM ODbL attribution rendered", status: "needs-tom", note: "'© OpenStreetMap contributors' required on the map (Iris/Krieger surface)." },
      { label: "Public-data accuracy disclosure", status: "open", note: "Add 'public records may be out of date; verify with county' near displayed values." },
    ],
  },
  {
    title: "4. The 'tool, not advisor' line",
    icon: Scale,
    items: [
      { label: "'Not a broker/lender/adviser' in ToS", status: "done", note: "ToS §2/§3 state it plainly. Core legal armor." },
      { label: "Pax fiduciary boundary in prompts", status: "done", note: "Constitution #12; audited system prompts refer out to licensed pros." },
      { label: "AI disclosure at first interaction", status: "needs-tom", note: "Constitution #7 + CO SB 24-205. Verify server-side gate shipped (Iris)." },
      { label: "'Estimated' labels on Pax dollar figures", status: "needs-tom", note: "Revenue-impact ranges must read as estimates, not predictions (Iris/Soren)." },
      { label: "Disclaimer coverage on every data surface", status: "needs-tom", note: "Valuation ≠ appraisal; wrong flood read = real-harm claim; FCRA on owner data." },
    ],
  },
  {
    title: "5. Payments, refunds, dunning, sales tax",
    icon: CreditCard,
    items: [
      { label: "Stripe processor (no card data stored)", status: "done", note: "Keeps AcreOS out of heavy PCI scope; Stripe handles it." },
      { label: "Auto-renewal clear-and-conspicuous", status: "needs-tom", note: "FTC Negative Option Rule: annual total must be equal-weight to monthly (Iris/Soren)." },
      { label: "Easy cancellation", status: "done", note: "Constitution #4 + FTC click-to-cancel. Keep it true." },
      { label: "Refund policy", status: "needs-tom", note: "Terms are a Tom business decision; Beatrice drafts the language once chosen." },
      { label: "Dunning / failed-payment flow", status: "open", note: "Retry + notice beats silent cutoff; avoids billing disputes." },
      { label: "SaaS sales-tax / economic nexus", status: "needs-vendor", note: "Below thresholds at Phase 0; Stripe Tax + accountant as MRR grows. MA taxes some software." },
    ],
  },
  {
    title: "6. Native e-sign validity (ESIGN/UETA)",
    icon: PenTool,
    items: [
      { label: "ESIGN §101(c) consent gate", status: "done", note: "Fail-closed gate + idempotency (commit 4b1a8174)." },
      { label: "Five §101(c) disclosures present", status: "needs-tom", note: "Verify EsignConsentDialog has all five verbatim (Iris)." },
      { label: "Audit trail (IP, UA, timestamp)", status: "done", note: "signing_consent_audit captures attributability." },
      { label: "7-year retention of signing records", status: "needs-tom", note: "Matches contract statute of limitations; verify retention policy." },
    ],
  },
  {
    title: "7. Customer data: security, breach, deletion, DPA",
    icon: ShieldCheck,
    items: [
      { label: "DPA drafted", status: "done", note: "docs/legal/data-processing-agreement.md — processor terms; B2B sales unblocker." },
      { label: "Security posture documented", status: "open", note: "'Reasonable security' standard; honest controls, no certs we don't have." },
      { label: "50-state breach-notification readiness", status: "open", note: "All 50 states have laws. Need a one-page incident runbook BEFORE an incident." },
      { label: "GDPR 72-hour breach notification stated", status: "needs-tom", note: "Verify v1 Privacy doc includes Art. 33 commitment." },
      { label: "7-day deletion (constitutional)", status: "done", note: "Constitution #8; /founder/dsar + legal-holds operate it." },
    ],
  },
  {
    title: "8. Insurance to consider (options, not advice)",
    icon: Umbrella,
    items: [
      { label: "Tech E&O / Professional Liability", status: "needs-vendor", note: "Most relevant for a data+AI product; covers cost of defending a 'your data cost me' claim." },
      { label: "Cyber liability", status: "needs-vendor", note: "Breach-response + a lawyer on call. Pairs with the breach runbook." },
      { label: "General liability (CGL)", status: "needs-vendor", note: "Lower priority for pure software; often bundled cheaply in a tech BOP." },
    ],
  },
  {
    title: "9. Massachusetts-specific items",
    icon: MapPin,
    items: [
      { label: "MA breach law (93H) readiness", status: "open", note: "Notice to residents + MA AG + Consumer Affairs. Folds into the breach runbook." },
      { label: "MA WISP (201 CMR 17.00)", status: "open", note: "MA uniquely requires a Written Information Security Program for holding MA residents' PI." },
      { label: "MA SaaS sales-tax treatment", status: "needs-vendor", note: "MA taxes prewritten software; SaaS is fact-specific — accountant question." },
      { label: "Foreign-entity registration in MA", status: "needs-vendor", note: "If formed outside MA but operated from MA. Moot if formed in MA." },
    ],
  },
];

function statusCount(status: Status): number {
  return SECTIONS.reduce(
    (n, s) => n + s.items.filter((i) => i.status === status).length,
    0,
  );
}

export default function FounderLegalReadinessPage() {
  useDocumentTitle("Launch legal readiness — AcreOS");

  return (
    <PageShell label="Launch legal readiness">
      <div className="mx-auto max-w-4xl space-y-6">
        <header className="space-y-3">
          <h1 className="text-2xl font-semibold text-acr-ink">
            Launch Legal & Peace-of-Mind Readiness
          </h1>
          <p className="text-sm text-acr-ink-3">
            Every legal and operational obligation of launching AcreOS, made
            into a closed list with a clear status. Full detail — the "why it
            matters / what to do / who owns it" for each — lives in the{" "}
            <a
              href="https://github.com/AcreOS/AcreOS/blob/main/docs/legal/launch-readiness-checklist.md"
              className="text-acr-brand underline underline-offset-2 hover:text-acr-brand/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-acr-brand"
            >
              full checklist
            </a>{" "}
            and the{" "}
            <a
              href="https://github.com/AcreOS/AcreOS/blob/main/docs/founder/peace-of-mind-brief.md"
              className="text-acr-brand underline underline-offset-2 hover:text-acr-brand/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-acr-brand"
            >
              peace-of-mind brief
            </a>
            .
          </p>
          <div className="flex flex-wrap gap-2" aria-label="Status summary">
            {(Object.keys(STATUS_CONFIG) as Status[]).map((s) => (
              <Badge key={s} variant="outline" className={STATUS_CONFIG[s].className}>
                {STATUS_CONFIG[s].label}: {statusCount(s)}
              </Badge>
            ))}
          </div>
          <p className="rounded-md border border-acr-line bg-acr-surface p-3 text-xs text-acr-ink-3">
            This is a risk-management work product, not a legal opinion. Items
            marked "Needs vendor" genuinely require a licensed professional's
            sign-off — prepared, but not a substitute for counsel.
          </p>
        </header>

        <motion.div
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
          className="space-y-4"
        >
          {SECTIONS.map((section) => {
            const Icon = section.icon;
            return (
              <motion.div key={section.title} variants={staggerItem}>
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Icon className="h-4 w-4 text-acr-ink-3" aria-hidden="true" />
                      {section.title}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {section.items.map((item) => (
                      <div
                        key={item.label}
                        className="flex flex-col gap-1.5 border-b border-acr-line pb-3 last:border-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-acr-ink">
                            {item.label}
                          </p>
                          <p className="mt-0.5 text-xs text-acr-ink-3">
                            {item.note}
                          </p>
                        </div>
                        <Badge
                          variant="outline"
                          className={`shrink-0 ${STATUS_CONFIG[item.status].className}`}
                        >
                          {STATUS_CONFIG[item.status].label}
                        </Badge>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </motion.div>
            );
          })}
        </motion.div>
      </div>
    </PageShell>
  );
}
