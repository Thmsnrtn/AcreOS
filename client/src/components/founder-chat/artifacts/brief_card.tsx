/**
 * brief_card artifact — multi-section morning brief.
 *
 * Phase E shape: each section carries a markdown body + optional big
 * Fraunces headline metric + inline action buttons. Sections expand
 * inline (NEVER modal) with REVEAL_FROM_BELOW + TAP_PRESS. The /founder
 * shell renders the brief as the first assistant message of the day.
 *
 * Backwards-compatible: sections that supply `artifacts` (the older
 * /brief tool shape) still render via ArtifactRenderer underneath.
 */

import { useCallback, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, Sun } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ArtifactRenderer } from "@/components/founder-chat/ArtifactRenderer";
import {
  REVEAL_FROM_BELOW,
  TAP_PRESS,
  TRANSITION_DEFAULT,
} from "@/lib/motion";
import { TOUCH_TARGET_PT } from "@/lib/spacing";
import type { BriefSection } from "@shared/founder-chat/artifacts";

interface BriefCardProps {
  title?: string;
  sections: BriefSection[];
  /** Inserts text into the chat composer when an action chip is tapped. */
  onActionClick?: (toolCallText: string) => void;
}

function toneClasses(tone?: BriefSection["tone"]): string {
  switch (tone) {
    case "positive":
      return "border-emerald-500/30 bg-emerald-500/5";
    case "warning":
      return "border-amber-500/30 bg-amber-500/5";
    case "danger":
      return "border-rose-500/30 bg-rose-500/5";
    default:
      return "border-border bg-card";
  }
}

function toneHeadlineClasses(tone?: BriefSection["tone"]): string {
  switch (tone) {
    case "positive":
      return "text-emerald-600 dark:text-emerald-400";
    case "warning":
      return "text-amber-700 dark:text-amber-400";
    case "danger":
      return "text-rose-600 dark:text-rose-400";
    default:
      return "text-foreground";
  }
}

export function BriefCardArtifact({ title, sections, onActionClick }: BriefCardProps) {
  return (
    <motion.div
      initial={REVEAL_FROM_BELOW.initial}
      animate={REVEAL_FROM_BELOW.animate}
      exit={REVEAL_FROM_BELOW.exit}
    >
      <Card
        className="border-acr-brand/30 bg-gradient-to-br from-acr-brand-soft/30 to-transparent"
        data-testid="artifact-brief-card"
      >
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Sun className="w-4 h-4 text-acr-warn" aria-hidden="true" />
            {title ?? "Morning brief"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {(sections ?? []).map((section, idx) => (
            <BriefSectionCard
              key={`${section.title}-${idx}`}
              section={section}
              defaultOpen={idx < 2}
              onActionClick={onActionClick}
            />
          ))}
        </CardContent>
      </Card>
    </motion.div>
  );
}

interface BriefSectionCardProps {
  section: BriefSection;
  defaultOpen?: boolean;
  onActionClick?: (toolCallText: string) => void;
}

function BriefSectionCard({ section, defaultOpen = false, onActionClick }: BriefSectionCardProps) {
  const [open, setOpen] = useState(defaultOpen);
  const hasEmbeddedArtifacts = Array.isArray(section.artifacts) && section.artifacts.length > 0;
  const hasActions = Array.isArray(section.actions) && section.actions.length > 0;

  const sectionTone = section.tone ?? "neutral";

  const toggleId = useMemo(() => `brief-section-${section.title.replace(/\s+/g, "-").toLowerCase()}`, [section.title]);

  const onToggle = useCallback(() => setOpen((v) => !v), []);
  const onAction = useCallback(
    (text: string) => {
      if (onActionClick) onActionClick(text);
    },
    [onActionClick],
  );

  return (
    <motion.section
      aria-label={section.title}
      className={cn("rounded-2xl border p-3 transition-colors", toneClasses(sectionTone))}
      style={{ transition: TRANSITION_DEFAULT }}
      whileHover={{}}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={toggleId}
        className="flex w-full items-start justify-between gap-3 text-left"
        style={{ minHeight: TOUCH_TARGET_PT }}
      >
        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {section.title}
          </div>
          {section.headline ? (
            <div className="mt-1 flex items-baseline gap-2">
              <span
                className={cn(
                  "font-serif font-semibold leading-none text-3xl sm:text-4xl",
                  toneHeadlineClasses(sectionTone),
                )}
                style={{ fontFamily: "'Fraunces', ui-serif, Georgia, serif" }}
                data-testid={`brief-headline-${section.title.toLowerCase().replace(/\s+/g, "-")}`}
              >
                {section.headline}
              </span>
              {section.headlineLabel ? (
                <span className="text-xs text-muted-foreground">{section.headlineLabel}</span>
              ) : null}
            </div>
          ) : null}
        </div>
        <ChevronDown
          aria-hidden="true"
          className={cn(
            "h-4 w-4 mt-1 shrink-0 text-muted-foreground transition-transform",
            open ? "rotate-180" : "rotate-0",
          )}
        />
      </button>

      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            id={toggleId}
            key="content"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto", transition: { duration: 0.22, ease: [0.4, 0, 0.2, 1] } }}
            exit={{ opacity: 0, height: 0, transition: { duration: 0.18, ease: [0.4, 0, 1, 1] } }}
            className="overflow-hidden"
          >
            <div className="pt-2 space-y-3">
              {section.markdown ? (
                <p className="text-sm leading-relaxed text-foreground whitespace-pre-wrap">
                  {section.markdown}
                </p>
              ) : null}

              {hasEmbeddedArtifacts ? (
                <div className="space-y-2">
                  {(section.artifacts ?? []).map((art, j) => (
                    <ArtifactRenderer key={j} artifact={art} />
                  ))}
                </div>
              ) : null}

              {hasActions ? (
                <div className="flex flex-wrap gap-2 pt-1">
                  {(section.actions ?? []).map((a, j) => (
                    <motion.div key={j} whileTap={TAP_PRESS}>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => onAction(a.toolCallText)}
                        style={{ minHeight: TOUCH_TARGET_PT }}
                        data-testid={`brief-action-${a.label.toLowerCase().replace(/\s+/g, "-")}`}
                        className="rounded-full"
                      >
                        {a.label}
                      </Button>
                    </motion.div>
                  ))}
                </div>
              ) : null}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.section>
  );
}

export default BriefCardArtifact;
