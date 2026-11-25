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
 *
 * The checklist copy itself is served as data (/legal-readiness.json,
 * sourced from client/src/data/legal-readiness-data.ts) instead of riding
 * inside the founder bundle as JS — see client/src/lib/legal-readiness.ts.
 * The page renders its shell first; a failed or malformed asset shows a
 * visible failure line, never a silently-empty checklist.
 */

import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { staggerContainer, staggerItem } from "@/lib/animations";
import { motion } from "framer-motion";
import {
  countLegalReadinessByStatus,
  useLegalReadinessSections,
} from "@/lib/legal-readiness";
import type { LegalReadinessStatus } from "@/data/legal-readiness-data";

type Status = LegalReadinessStatus;

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

export default function FounderLegalReadinessPage() {
  useDocumentTitle("Launch legal readiness — AcreOS");
  const { sections, error } = useLegalReadinessSections();

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
          {sections ? (
            <div className="flex flex-wrap gap-2" aria-label="Status summary">
              {(Object.keys(STATUS_CONFIG) as Status[]).map((s) => (
                <Badge key={s} variant="outline" className={STATUS_CONFIG[s].className}>
                  {STATUS_CONFIG[s].label}: {countLegalReadinessByStatus(sections, s)}
                </Badge>
              ))}
            </div>
          ) : null}
          <p className="rounded-md border border-acr-line bg-acr-surface p-3 text-xs text-acr-ink-3">
            This is a risk-management work product, not a legal opinion. Items
            marked "Needs vendor" genuinely require a licensed professional's
            sign-off — prepared, but not a substitute for counsel.
          </p>
        </header>

        {error ? (
          <p
            role="alert"
            className="text-sm text-acr-ink-3"
            data-testid="legal-readiness-load-error"
          >
            We couldn't load the readiness checklist. Refresh the page to try
            again.
          </p>
        ) : sections === null ? (
          <p role="status" className="text-sm text-acr-ink-3">
            Loading the readiness checklist…
          </p>
        ) : (
          <motion.div
            variants={staggerContainer}
            initial="hidden"
            animate="visible"
            className="space-y-4"
          >
            {sections.map((section) => {
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
        )}
      </div>
    </PageShell>
  );
}
