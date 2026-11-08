/**
 * MorningBrief — the brief that frames the Decision Queue on Today.
 *
 * Tier 3C made it a one-line collapsed disclosure so it frames the queue
 * without competing with it. E2 slice 1 (leg 2) keeps that line as the
 * headline and adds the three designed sections beneath it — what changed,
 * what needs you, what Pax prepared — plus dismiss, and an archive of past
 * briefs the user can reopen.
 *
 * Server composes everything (server/routes-today.ts → buildBriefCard,
 * server/services/morningBriefSections.ts); this component only presents
 * it. Every item is a real count with its source and as-of; an empty
 * section says so in one plain line, never filler. Not a separate
 * destination — it lives directly above the queue as its preamble.
 *
 * The Pax heartbeat (6px brand-dot pulse, 2.4s period) is rendered next to
 * the word "Pax" — this is the FIRST appearance of Pax on Today, so per the
 * design rule the heartbeat shows here and nowhere else on the page.
 */
import { useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ChevronDown, History } from "lucide-react";
import { PAX_CONTROLS_LABEL, PAX_CONTROLS_PATH } from "@shared/pax-glossary";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryErrorState } from "@/components/query-error-state";
import { formatDateTime } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import { getErrorMessage } from "@/lib/error-utils";

export interface BriefItem {
  id: string;
  text: string;
  count: number;
  href: string;
  source: string;
  asOf: string;
}

export interface BriefSections {
  changed: BriefItem[];
  needsYou: BriefItem[];
  prepared: BriefItem[];
  /** Sections some input of which could not be read. Absent on older rows. */
  unreadable?: Array<"changed" | "needsYou" | "prepared">;
  empty: boolean;
  asOf: string;
}

export interface BriefCard {
  id: number | null;
  date: string | null;
  headline: string | null;
  sections: BriefSections;
  dismissed: boolean;
  /** The Pax Pause (stand-down). Absent on an older server. */
  standDown?: { active: boolean; until: string | null };
}

interface ArchiveRow {
  id: number;
  date: string;
  headline: string | null;
  dismissed: boolean;
  counts: { changed: number; needsYou: number; prepared: number };
}

interface MorningBriefProps {
  /** The one-line headline (kept for callers that only have the line). */
  brief: string | null;
  /** The sectioned card from GET /api/today. */
  card?: BriefCard | null;
}

// Each "none" line names exactly what the section counted — the queue below
// may still hold other kinds of work, so no line claims "nothing" in general.
const SECTION_META: ReadonlyArray<{ key: "changed" | "needsYou" | "prepared"; title: string; none: string }> = [
  {
    key: "changed",
    title: "What changed",
    none: "No payments posted, new leads or deal changes in the last 24 hours.",
  },
  {
    key: "needsYou",
    title: "What needs you",
    none: "No late notes, note payments due this week, open alerts or leads waiting 14+ days.",
  },
  { key: "prepared", title: "What Pax prepared", none: "Nothing Pax prepared is waiting for your tap." },
];

const UNREADABLE_LINE = "Part of this could not be read just now, so it may be incomplete.";

/** The three sections — shared by today's card and a reopened archive brief. */
export function BriefSectionsView({ sections }: { sections: BriefSections }) {
  if (sections.empty) {
    return (
      <p className="text-sm text-acr-ink-3" data-testid="text-brief-empty">
        No payments, new leads, deal changes, late notes, due payments, alerts or waiting
        leads to report, and nothing Pax prepared is waiting for your tap.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      {SECTION_META.map(({ key, title, none }) => {
        const items = sections[key] ?? [];
        const unreadable = (sections.unreadable ?? []).includes(key);
        return (
          <div key={key} data-testid={`brief-section-${key}`}>
            <h3 className="acr-eyebrow mb-1">{title}</h3>
            {unreadable && (
              <p className="text-sm text-acr-ink-3" data-testid={`text-brief-unreadable-${key}`}>
                {UNREADABLE_LINE}
              </p>
            )}
            {items.length === 0 ? (
              !unreadable && <p className="text-sm text-acr-ink-3">{none}</p>
            ) : (
              <ul className="space-y-1">
                {items.map((item) => (
                  <li key={item.id} className="text-[15px] leading-relaxed text-acr-ink-2">
                    <Link
                      href={item.href}
                      className="underline-offset-2 hover:underline hover:text-acr-brand active:text-acr-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                      data-testid={`brief-item-${item.id}`}
                    >
                      {item.text}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
      <p className="text-xs text-acr-ink-3" data-testid="text-brief-as-of">
        Counted from your records at {formatDateTime(sections.asOf)}.
      </p>
    </div>
  );
}

function PastBriefsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [selected, setSelected] = useState<number | null>(null);
  const list = useQuery<{ briefs: ArchiveRow[] }>({
    queryKey: ["/api/today/briefs"],
    enabled: open,
  });
  const one = useQuery<BriefCard>({
    queryKey: [`/api/today/briefs/${selected}`],
    enabled: open && selected != null,
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setSelected(null);
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-lg" data-testid="dialog-past-briefs">
        <DialogHeader>
          <DialogTitle>{selected == null ? "Past briefs" : `Brief for ${one.data?.date ?? "…"}`}</DialogTitle>
          <DialogDescription>
            {selected == null
              ? "Each day's brief as it read the last time Today was opened that day."
              : "Reopened from the archive. Counts are as they were that day."}
          </DialogDescription>
        </DialogHeader>
        {selected == null ? (
          list.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : list.isError ? (
            <QueryErrorState error={list.error as Error | null} onRetry={() => list.refetch()} compact testId="past-briefs-error" />
          ) : (list.data?.briefs ?? []).length === 0 ? (
            <p className="text-sm text-acr-ink-3">No past briefs yet.</p>
          ) : (
            <ul className="divide-y divide-[color:var(--acr-line-soft)]">
              {list.data!.briefs.map((b) => (
                <li key={b.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(b.id)}
                    className="w-full text-left py-2.5 min-h-11 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                    data-testid={`button-reopen-brief-${b.id}`}
                  >
                    <span className="block text-sm font-medium">{b.date}</span>
                    <span className="block text-xs text-acr-ink-3 truncate">
                      {b.headline ?? `${b.counts.changed + b.counts.needsYou + b.counts.prepared} items`}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : one.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : one.isError || !one.data ? (
          <QueryErrorState error={(one.error as Error | null) ?? null} onRetry={() => one.refetch()} compact testId="past-brief-error" />
        ) : (
          <div className="space-y-3">
            {one.data.headline && <p className="text-sm text-acr-ink-2">{one.data.headline}</p>}
            <BriefSectionsView sections={one.data.sections} />
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="text-xs text-acr-ink-3 hover:text-acr-brand min-h-11 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
              data-testid="button-past-briefs-back"
            >
              ← All past briefs
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function MorningBrief({ brief, card }: MorningBriefProps) {
  const [expanded, setExpanded] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const { toast } = useToast();

  const toggleDismiss = useMutation({
    mutationFn: async (dismiss: boolean) => {
      if (card?.id == null) return null;
      const res = await apiRequest("POST", `/api/today/briefs/${card.id}/${dismiss ? "dismiss" : "restore"}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/today"] });
      queryClient.invalidateQueries({ queryKey: ["/api/today/briefs"] });
    },
    onError: (error) => {
      toast({
        title: "Couldn't update the brief",
        description: getErrorMessage(error),
        variant: "destructive",
      });
    },
  });

  const headline = card?.headline ?? brief;
  if (!headline && !card) return null;

  const pastBriefsButton = (
    <button
      type="button"
      onClick={() => setArchiveOpen(true)}
      className="inline-flex items-center gap-1 min-h-11 px-2 -mx-2 text-xs text-acr-ink-3 hover:text-acr-brand active:text-acr-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
      data-testid="button-past-briefs"
    >
      <History className="w-3.5 h-3.5" aria-hidden="true" />
      Past briefs
    </button>
  );

  // Dismissed: one slim line that can bring it back, and the archive.
  if (card?.dismissed) {
    return (
      <section
        aria-label="Morning brief"
        data-testid="section-morning-brief"
        className="flex items-center gap-3 px-4 md:px-3.5 text-sm text-acr-ink-3"
      >
        <span>Morning brief dismissed for your team today.</span>
        <button
          type="button"
          onClick={() => toggleDismiss.mutate(false)}
          disabled={toggleDismiss.isPending}
          className="min-h-11 px-2 -mx-2 text-xs hover:text-acr-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
          data-testid="button-morning-brief-restore"
        >
          Show it again
        </button>
        {pastBriefsButton}
        <PastBriefsDialog open={archiveOpen} onOpenChange={setArchiveOpen} />
      </section>
    );
  }

  const contentId = "morning-brief-content";
  return (
    <section
      aria-label="Morning brief"
      data-testid="section-morning-brief"
      className="rounded-card border border-[color:var(--acr-line-soft)] bg-acr-surface shadow-acr-1"
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-controls={contentId}
        data-testid="button-morning-brief-toggle"
        className="w-full flex items-center gap-2 p-4 md:p-3.5 text-left min-h-11 pointer-fine:sm:min-h-9 rounded-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span
          className="acr-pax-heartbeat shrink-0"
          aria-hidden="true"
          data-testid="pax-heartbeat"
        />
        <span className="acr-eyebrow shrink-0">Pax · Morning brief</span>
        {!expanded && headline && (
          <span className="text-sm text-acr-ink-3 truncate min-w-0 flex-1" aria-hidden="true">
            {headline}
          </span>
        )}
        <ChevronDown
          className={`w-4 h-4 text-acr-ink-3 shrink-0 ml-auto transition-transform ${expanded ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>
      {expanded && (
        <div id={contentId} className="px-4 pb-4 md:px-3.5 md:pb-3.5 space-y-3">
          {card?.standDown?.active && (
            <p className="text-sm text-acr-ink-2" data-testid="text-brief-stand-down">
              Pax is paused{card.standDown.until ? ` until ${formatDateTime(card.standDown.until)}` : ""}: no summary line,
              no prepared work and no shadow entries until it resumes. The counts below are read from your records.
            </p>
          )}
          {headline && (
            <p className="text-[15px] leading-relaxed text-acr-ink-2 max-w-prose">
              {headline}
            </p>
          )}
          {card && <BriefSectionsView sections={card.sections} />}
          <div className="flex flex-wrap items-center gap-x-4">
            <Link
              href={PAX_CONTROLS_PATH}
              className="inline-flex min-h-11 items-center px-2 -mx-2 text-xs text-acr-ink-3 hover:text-acr-brand active:text-acr-brand underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
              data-testid="link-pax-controls-from-brief"
            >
              {PAX_CONTROLS_LABEL} →
            </Link>
            {card && pastBriefsButton}
            {card?.id != null && (
              <button
                type="button"
                onClick={() => toggleDismiss.mutate(true)}
                disabled={toggleDismiss.isPending}
                className="inline-flex min-h-11 items-center px-2 -mx-2 text-xs text-acr-ink-3 hover:text-acr-brand active:text-acr-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                data-testid="button-morning-brief-dismiss"
              >
                Dismiss for the team today
              </button>
            )}
          </div>
        </div>
      )}
      {card && <PastBriefsDialog open={archiveOpen} onOpenChange={setArchiveOpen} />}
    </section>
  );
}
