import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { useKeyboardLayer } from "@/hooks/use-keyboard-layer";
import { motion } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ContentReveal } from "@/components/ContentReveal";
import { ClearedEmpty } from "@/components/empty-state";
import { SwipeableCard } from "@/components/mobile/SwipeableCard";
import PaxAskCard from "@/components/pax/PaxAskCard";
import { usePaxAskActions, type PaxAskItem } from "@/hooks/usePaxNeedsYou";
import { lightImpact } from "@/lib/haptics";
import { staggerContainer, staggerItem } from "@/lib/animations";
import { Verbs } from "@/lib/labels";
import {
  Sparkles,
  Zap,
  AlertTriangle,
  GitBranch,
  ArrowRight,
  EyeOff,
  RotateCcw,
  ArrowRightCircle,
  Clock,
  Check,
  CalendarClock,
  X as XIcon,
  Trash2,
  Loader2,
  type LucideIcon,
} from "lucide-react";

export type DecisionSource =
  | "pax-priority"
  | "pax-suggests"
  | "pax-noticed"
  | "pax-ask"
  | "ai-queue"
  | "portfolio-alert";

const sourcePillStyles: Record<DecisionSource, string> = {
  "pax-priority": "bg-acr-brand-soft text-acr-brand-soft-ink",
  "pax-suggests": "bg-acr-pos-soft text-acr-pos-soft-ink",
  "pax-noticed": "bg-acr-brand-soft text-acr-brand-soft-ink",
  "pax-ask": "bg-acr-warn-soft text-acr-warn-soft-ink",
  "ai-queue": "bg-primary/10 text-primary",
  "portfolio-alert": "bg-acr-warn-soft text-acr-warn-soft-ink",
};

const sourcePillLabel: Record<DecisionSource, string> = {
  "pax-priority": "Pax",
  "pax-suggests": "Pax",
  "pax-noticed": "Pax",
  "pax-ask": "Pax",
  "ai-queue": "AI queue",
  "portfolio-alert": "Alert",
};

const sourceIcon: Record<DecisionSource, LucideIcon> = {
  "pax-priority": Zap,
  "pax-suggests": Sparkles,
  "pax-noticed": Sparkles,
  "pax-ask": Sparkles,
  "ai-queue": GitBranch,
  "portfolio-alert": AlertTriangle,
};

// Priority → left-border tone color (CSS var). Encoded as a single 2px
// left border on the Card, replacing the old standalone priority Badge.
const priorityBorderColor: Record<DecisionItem["priority"], string> = {
  high: "var(--acr-neg)",
  medium: "var(--acr-warn)",
  low: "var(--acr-brand-soft)",
};

// ── Inline action (Maren CPO #2) ────────────────────────────────────────────
// Describes what the operator can do to a queue item WITHOUT leaving Today.
// Discriminated on `kind` so the row renders exactly the right controls.
//   - "resolve"  : Done / Snooze 3d / Dismiss in place (PATCH the item).
//                  An optional `paxDraft` adds a "Pax, draft the follow-up" CTA.
//   - "navigate" : link-out only (legacy behavior; no inline resolution).
export type InlineAction =
  | {
      kind: "resolve";
      paxDraft?: { entityType: "lead" | "deal"; entityId: number };
    }
  | { kind: "navigate" };

// The inline-resolution verbs the queue supports. Mirrors the server's
// PATCH /api/today/queue/:id body contract.
export type ResolveAction = "done" | "snooze" | "dismiss";

export interface DecisionItem {
  id: string;
  source: DecisionSource;
  priority: "high" | "medium" | "low";
  title: string;
  description: string;
  actionLabel: string;
  actionUrl: string;
  rank: number; // for sort; lower = higher priority
  // Host 3 of 4 for PaxAskCard (the Pax controls spec §4.5): a `pax-ask` row
  // carries the server-formatted ask and renders the same card as the /ai
  // strip, the chat and the support chat, with inline Approve / Reject /
  // Edit. No confidence number rides on any row — the old hardcoded
  // value, the auto-handled pill and its CTA were fabricated and are gone.
  ask?: PaxAskItem;
  // What the operator can do in place. Absent → treated as "navigate".
  inlineAction?: InlineAction;
  // Urgency class from the server's one ranking function (Tier 3C):
  // overdue → money → time → routine. Informational on the client — the
  // server already sorted by it; we never re-derive or re-sort.
  urgency?: "overdue" | "money" | "time" | "routine";
}

interface DecisionQueueProps {
  items: DecisionItem[];
  isLoading: boolean;
  /**
   * Inline-resolve a queue item in place (Maren CPO #2). The parent owns the
   * PATCH mutation + query invalidation so this component stays presentational.
   * When omitted, items fall back to navigate-only (legacy behavior).
   */
  onResolve?: (itemId: string, action: ResolveAction) => void;
  /** Ids currently mid-resolve (pending PATCH) — disables their controls. */
  resolvingIds?: ReadonlySet<string>;
  /**
   * Finishability (Tier 3C): items the operator marked done TODAY (server-
   * derived from today_queue_state, org-scoped, survives reload) and the
   * day's total (cleared + still in queue). Drives the "N of M cleared"
   * header readout and the day-done zero state.
   */
  clearedToday?: number;
  totalToday?: number;
  /**
   * Permanently clear the ENTIRE active queue (POST /api/today/queue/clear).
   * Destructive + irreversible, so the button is gated behind a confirm
   * dialog before this fires. The parent owns the mutation + query
   * invalidation (mirrors onResolve), so this component stays presentational.
   * When omitted, the "Clear queue" control falls back to the local 24h
   * snooze-all (temporary hide).
   */
  onClearAll?: () => void;
  /** True while the clear-all POST is in flight — drives the confirm spinner. */
  isClearing?: boolean;
}

// localStorage-backed snooze map. Keyed by item id, value is an ISO
// expiry timestamp. Snoozed items hide from the queue until expiry.
// Per-org persistence is overkill for a hide-toggle — we keep this
// local so the user never waits on a network round-trip to dismiss.
const SNOOZE_KEY = "acreos-decisionqueue-snoozed";
const SNOOZE_DURATION_MS = 24 * 60 * 60 * 1000;

function loadSnoozed(): Record<string, number> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(SNOOZE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, number>;
    const now = Date.now();
    const fresh: Record<string, number> = {};
    for (const [id, expiry] of Object.entries(parsed)) {
      if (typeof expiry === "number" && expiry > now) fresh[id] = expiry;
    }
    return fresh;
  } catch {
    return {};
  }
}

function persistSnoozed(map: Record<string, number>) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(SNOOZE_KEY, JSON.stringify(map));
  } catch {
    /* quota / private mode — best effort */
  }
}

// Provenance-pill decision list. Replaces the old Start-here / Today's
// actions / Pax suggests / Pax noticed / AI action queue / Portfolio
// alerts stack — one prioritized list, source on a pill.
/**
 * The queue's loading state, built out of the SAME chrome as a real row.
 *
 * It used to be three `<Skeleton className="h-16 w-full" />` blocks — 64px
 * each against a real row of roughly 150 (a Card with `CardContent ... p-6`,
 * a badge row, a 15px title, a 12px description and often an inline-resolve
 * button row), so every Today load produced a visible jump as the
 * placeholders were replaced by cards more than twice their height.
 * CLAUDE.md asks for skeletons "matching the content shape"; the repo has 316
 * raw `h-N w-full` blocks and six files importing the shaped primitives.
 *
 * Geometry is DERIVED, not estimated: this renders the real Card and
 * CardContent with the real padding, radius, shadow and left priority edge,
 * so the outer box cannot drift from the row it stands in for. Only the bars
 * inside are approximations, and they are sized from the type scale the row
 * actually uses.
 */
function DecisionQueueSkeleton() {
  return (
    <div className="space-y-2" data-testid="decision-queue-skeleton">
      {[0, 1, 2].map((i) => (
        <Card
          key={i}
          className="rounded-card shadow-acr-1 border-l-2"
          style={{ borderLeftColor: "var(--acr-line)" }}
          aria-hidden="true"
        >
          <CardContent className="flex items-start gap-4 p-6">
            <div className="flex-1 min-w-0">
              {/* origin pill + priority pill */}
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <Skeleton className="h-[18px] w-16 rounded-full" />
                <Skeleton className="h-[18px] w-20 rounded-full" />
              </div>
              {/* 15px title, then the 12px description */}
              <Skeleton className="h-[15px] w-3/5 my-1" />
              <Skeleton className="h-3 w-5/6" />
              {/* the inline-resolve row most items carry */}
              <div className="flex gap-2 mt-3">
                <Skeleton className="h-8 w-24 rounded-md" />
                <Skeleton className="h-8 w-20 rounded-md" />
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function DecisionQueue({
  items,
  isLoading,
  onResolve,
  resolvingIds,
  clearedToday = 0,
  totalToday = 0,
  onClearAll,
  isClearing = false,
}: DecisionQueueProps) {
  const [snoozed, setSnoozed] = useState<Record<string, number>>(() => loadSnoozed());
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [, setLocation] = useLocation();
  // The three taps on a `pax-ask` row post to the approval routes and settle
  // the queue reads; the card reports the server's own outcome.
  const paxAsk = usePaxAskActions();

  useEffect(() => {
    persistSnoozed(snoozed);
  }, [snoozed]);

  // Close the confirm dialog once the clear-all mutation finishes (isClearing
  // falls back to false). The queue then refetches empty and the zero state
  // renders. Tracks the previous value so we only act on the true→false edge.
  const wasClearingRef = useRef(false);
  useEffect(() => {
    if (wasClearingRef.current && !isClearing) {
      setConfirmClearOpen(false);
    }
    wasClearingRef.current = isClearing;
  }, [isClearing]);

  function snoozeItem(id: string) {
    lightImpact();
    setSnoozed((prev) => ({ ...prev, [id]: Date.now() + SNOOZE_DURATION_MS }));
  }

  function snoozeAll(ids: string[]) {
    lightImpact();
    const expiry = Date.now() + SNOOZE_DURATION_MS;
    setSnoozed((prev) => {
      const next = { ...prev };
      for (const id of ids) next[id] = expiry;
      return next;
    });
  }

  function restoreAll() {
    setSnoozed({});
  }

  // Server owns the ranking (one explainable comparator in routes-today.ts:
  // overdue → money-touching → time-sensitive → routine). The client only
  // subtracts locally-snoozed rows — it never re-sorts.
  const visible = useMemo(
    () => items.filter((it) => !snoozed[it.id]),
    [items, snoozed],
  );
  const snoozedCount = Object.keys(snoozed).length;
  // Asks are answered on their card (Approve / Reject / Edit), never
  // cleared or snoozed away: "Clear queue" only counts the server's rows.
  const clearable = visible.filter((it) => it.source !== "pax-ask");

  // Declared above the keyboard layer because onOpen closes over it: the
  // closure only runs on a keypress, so the old ordering worked, but a
  // reader should not have to establish that to trust the code.
  const rowRefs = useRef<Map<string, HTMLLIElement>>(new Map());

  // ── Keyboard layer (Tier 3C) — J/K traverses, Enter opens ──────────────
  // Desktop-only (fine pointer + hover); suppressed while typing and while
  // dialogs are open. See hooks/use-keyboard-layer.ts.
  const { activeIndex } = useKeyboardLayer({
    itemCount: visible.length,
    enabled: !isLoading,
    onOpen: (index) => {
      const item = visible[index];
      if (!item) return;
      // A PAX ASK IS ANSWERED HERE, NOT SOMEWHERE ELSE.
      //
      // Asks are ranked first (rank -1), so the sequence a keyboard user
      // actually performs — land on Today, J to the top item, Enter — used to
      // fire `setLocation("/ai")` and teleport them to the Pax door. The one
      // row on the page built to be decided in place was the one row where
      // Enter navigated away from it, losing their position in the queue.
      //
      // Enter now moves focus to the card's Approve control instead of
      // approving outright. That is deliberate: a single keystroke must never
      // send an email. The user lands on the button, sees what it says, and
      // presses Enter again — or Tabs to Reject or Edit.
      if (item.source === "pax-ask" && item.ask) {
        const row = rowRefs.current.get(item.id);
        const approve = row?.querySelector<HTMLButtonElement>(
          `[data-testid="pax-ask-approve-${item.ask.id}"]`,
        );
        if (approve) {
          approve.focus();
          return;
        }
        // No Approve button means the ask is no longer actionable (executed,
        // expired, mid-flight). Focus the card so the reader is told which one
        // rather than being silently ignored.
        row?.focus();
        return;
      }
      setLocation(item.actionUrl);
    },
  });
  const activeId = activeIndex !== null ? visible[activeIndex]?.id ?? null : null;
  useEffect(() => {
    if (!activeId) return;
    const el = rowRefs.current.get(activeId);
    if (el) {
      el.scrollIntoView({ block: "nearest" });
      el.focus({ preventScroll: true });
    }
  }, [activeId]);

  // Finishability readout: only rendered when something real happened today.
  const showProgress = clearedToday > 0 && totalToday > 0;

  return (
    <div data-testid="section-decision-queue">
      <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-acr-brand" aria-hidden="true" />
          <h2 className="acr-section-h2 text-section-h2">Decision queue</h2>
          {visible.length > 0 && (
            <Badge variant="secondary" className="bg-acr-brand-soft text-acr-brand-soft-ink border-transparent text-xs tabular-nums">
              {visible.length}
            </Badge>
          )}
          {/* "N of M cleared" — real completions today, server-derived. */}
          {showProgress && (
            <span
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums"
              data-testid="text-queue-progress"
            >
              <span
                className="h-1.5 w-16 rounded-full bg-muted overflow-hidden"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={totalToday}
                aria-valuenow={clearedToday}
                aria-label={`${clearedToday} of ${totalToday} cleared today`}
              >
                <span
                  className="block h-full rounded-full bg-acr-pos"
                  style={{ width: `${Math.min(100, Math.round((clearedToday / totalToday) * 100))}%` }}
                />
              </span>
              {clearedToday} of {totalToday} cleared
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {clearable.length > 0 && (
            onClearAll ? (
              // Permanent clear — destructive, so it opens a confirm dialog
              // before firing POST /api/today/queue/clear (server clears the
              // WHOLE active queue, not just the rows loaded here).
              <Button
                variant="ghost"
                size="sm"
                className="gap-1 text-xs"
                onClick={() => setConfirmClearOpen(true)}
                aria-label={`Clear all ${clearable.length} decisions permanently`}
                data-testid="button-clear-queue"
              >
                <Trash2 className="w-3 h-3" aria-hidden="true" />
                Clear queue
              </Button>
            ) : (
              // Fallback: local 24h snooze-all (temporary hide) when no
              // permanent-clear handler is wired.
              <Button
                variant="ghost"
                size="sm"
                className="gap-1 text-xs"
                onClick={() => snoozeAll(clearable.map((v) => v.id))}
                aria-label="Snooze all items for 24 hours"
                data-testid="button-snooze-all-decisions"
              >
                <EyeOff className="w-3 h-3" aria-hidden="true" />
                Clear queue
              </Button>
            )
          )}
          {snoozedCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="gap-1 text-xs"
              onClick={restoreAll}
              aria-label={`Restore ${snoozedCount} snoozed item${snoozedCount === 1 ? "" : "s"}`}
              data-testid="button-restore-snoozed-decisions"
            >
              <RotateCcw className="w-3 h-3" aria-hidden="true" />
              {Verbs.RESTORE} {snoozedCount}
            </Button>
          )}
          <Button asChild variant="ghost" size="sm" className="gap-1 text-xs">
            <Link href="/decision-queue">
              View all <ArrowRight className="w-3 h-3" aria-hidden="true" />
            </Link>
          </Button>
        </div>
      </div>

      <ContentReveal
        ready={!isLoading}
        skeleton={<DecisionQueueSkeleton />}
      >
        {visible.length === 0 ? (
          // Three honest zero states: snoozed-away, day finished (real
          // completions today), and nothing-came-in. The finished state is
          // the Tier 3C payoff — the day is DONE and we say so.
          <ClearedEmpty
            headline={
              snoozedCount > 0
                ? "Queue cleared for now"
                : clearedToday > 0
                  ? `That's the day — all ${totalToday} cleared.`
                  : "All clear — nothing needs you right now"
            }
            subtitle={
              snoozedCount > 0
                ? `${snoozedCount} item${snoozedCount === 1 ? "" : "s"} snoozed for 24 hours. Use Restore to bring them back.`
                : clearedToday > 0
                  ? "Nothing else needs you today. Tomorrow's queue builds overnight."
                  : "When new leads, deals, or signals come in, they'll show up here first."
            }
          />
        ) : (
          <motion.ul
            role="list"
            className="space-y-2"
            variants={staggerContainer}
            initial="hidden"
            animate="visible"
          >
            {visible.map((item) => {
              const SourceIcon = sourceIcon[item.source];
              const isKeyboardActiveAsk = item.id === activeId;
              // Host 3 of 4: an ask is answered on its own card, in place.
              if (item.source === "pax-ask" && item.ask) {
                return (
                  <motion.li
                    key={item.id}
                    role="listitem"
                    variants={staggerItem}
                    tabIndex={isKeyboardActiveAsk ? -1 : undefined}
                    data-keyboard-active={isKeyboardActiveAsk ? "true" : undefined}
                    className={isKeyboardActiveAsk ? "rounded-card ring-2 ring-ring outline-none" : undefined}
                    ref={(el) => {
                      if (el) rowRefs.current.set(item.id, el);
                      else rowRefs.current.delete(item.id);
                    }}
                    data-testid={`decision-item-${item.id}`}
                  >
                    <PaxAskCard
                      ask={item.ask}
                      onApprove={(a) => paxAsk.approve(a.id)}
                      onReject={(a) => paxAsk.reject(a.id)}
                      onRevise={(a, args) => paxAsk.revise(a.id, args)}
                    />
                  </motion.li>
                );
              }
              const borderColor = priorityBorderColor[item.priority];
              // Swipe right (left action) — fire the primary CTA: the regular
              // open/act path (e.g. "Open lead", "Send reminder"). We navigate
              // via wouter so the gesture matches the on-screen Button's Link
              // target exactly. Swipe left (right action) — snooze, mirroring
              // InboxTab's vocabulary.
              const swipeLeftLabel = item.actionLabel;
              const swipeLeftTone = "brand" as const;
              // Inline-resolve is available when the parent wired onResolve AND
              // the server marked this item resolvable.
              const canResolveInline =
                !!onResolve && item.inlineAction?.kind === "resolve";
              const paxDraft =
                item.inlineAction?.kind === "resolve" ? item.inlineAction.paxDraft : undefined;
              const isResolving = resolvingIds?.has(item.id) ?? false;
              // Swipe-snooze: prefer the server 3-day snooze when wired so the
              // gesture and the inline button agree; else fall back to the local
              // 24h hide.
              const onSwipeSnooze = canResolveInline
                ? () => { lightImpact(); onResolve!(item.id, "snooze"); }
                : () => snoozeItem(item.id);
              const isKeyboardActive = item.id === activeId;
              return (
                <motion.li
                  key={item.id}
                  role="listitem"
                  variants={staggerItem}
                  // Roving keyboard focus (J/K): the active row takes
                  // programmatic focus so screen readers announce it and
                  // Enter opens it. tabIndex -1 keeps Tab order unchanged.
                  tabIndex={isKeyboardActive ? -1 : undefined}
                  data-keyboard-active={isKeyboardActive ? "true" : undefined}
                  className={isKeyboardActive ? "rounded-card ring-2 ring-ring outline-none" : undefined}
                  ref={(el) => {
                    if (el) rowRefs.current.set(item.id, el);
                    else rowRefs.current.delete(item.id);
                  }}
                  aria-label={isKeyboardActive ? `${item.title} — press Enter to open` : undefined}
                >
                  <SwipeableCard
                    leftAction={{
                      icon: ArrowRightCircle,
                      label: swipeLeftLabel,
                      tone: swipeLeftTone,
                      onAction: () => setLocation(item.actionUrl),
                    }}
                    rightAction={{
                      icon: Clock,
                      label: canResolveInline ? "Snooze 3d" : "Snooze 24h",
                      tone: "warn",
                      onAction: onSwipeSnooze,
                    }}
                  >
                  <Card
                    className="rounded-card shadow-acr-1 hover-elevate border-l-2"
                    style={{ borderLeftColor: borderColor }}
                    data-priority={item.priority}
                    data-testid={`decision-item-${item.id}`}
                  >
                    <CardContent className="flex items-start gap-4 p-6">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          {/* Origin pill: which subsystem raised this item. */}
                          <Badge
                            variant="secondary"
                            className={`text-xs border-transparent inline-flex items-center gap-1 ${sourcePillStyles[item.source]}`}
                            aria-label={sourcePillLabel[item.source]}
                          >
                            <SourceIcon className="w-3 h-3" aria-hidden={true} />
                            <span>{sourcePillLabel[item.source]}</span>
                          </Badge>
                        </div>
                        <div className="text-[15px] font-medium leading-snug text-foreground">
                          {item.title}
                        </div>
                        <p className="text-xs text-muted-foreground leading-relaxed mt-1">
                          {item.description}
                        </p>

                        {/* ── Inline resolution row (Maren CPO #2) ──────────
                            Resolve the item WITHOUT leaving Today — the habit-
                            loop core. Done / Snooze 3d / Dismiss shrink the
                            queue toward zero; "Pax, draft the follow-up" deep-
                            links the compose intent AND marks the row done. */}
                        {canResolveInline && (
                          <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 px-2.5 text-xs gap-1"
                              disabled={isResolving}
                              onClick={() => { lightImpact(); onResolve!(item.id, "done"); }}
                              data-testid={`decision-resolve-done-${item.id}`}
                              aria-label={`Mark "${item.title}" done`}
                            >
                              <Check className="w-3.5 h-3.5" aria-hidden="true" />
                              Done
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8 px-2.5 text-xs gap-1 text-muted-foreground"
                              disabled={isResolving}
                              onClick={() => { lightImpact(); onResolve!(item.id, "snooze"); }}
                              data-testid={`decision-resolve-snooze-${item.id}`}
                              aria-label={`Snooze "${item.title}" for 3 days`}
                            >
                              <CalendarClock className="w-3.5 h-3.5" aria-hidden="true" />
                              Snooze 3d
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8 px-2.5 text-xs gap-1 text-muted-foreground"
                              disabled={isResolving}
                              onClick={() => { lightImpact(); onResolve!(item.id, "dismiss"); }}
                              data-testid={`decision-resolve-dismiss-${item.id}`}
                              aria-label={`Dismiss "${item.title}"`}
                            >
                              <XIcon className="w-3.5 h-3.5" aria-hidden="true" />
                              Dismiss
                            </Button>
                            {paxDraft && (
                              <Button
                                asChild
                                size="sm"
                                variant="ghost"
                                className="h-8 px-2.5 text-xs gap-1 text-acr-brand"
                                onClick={() => { lightImpact(); onResolve!(item.id, "done"); }}
                                data-testid={`decision-resolve-pax-draft-${item.id}`}
                              >
                                <Link
                                  href={`/pax?intent=draft_follow_up&${paxDraft.entityType}Id=${paxDraft.entityId}`}
                                  aria-label={`Ask Pax to draft the follow-up for "${item.title}"`}
                                >
                                  <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
                                  Pax, draft the follow-up
                                </Link>
                              </Button>
                            )}
                          </div>
                        )}
                      </div>
                      <Button
                        asChild
                        size="sm"
                        variant="default"
                        className="shrink-0 text-xs"
                      >
                        <Link href={item.actionUrl}>{item.actionLabel}</Link>
                      </Button>
                    </CardContent>
                  </Card>
                  </SwipeableCard>
                </motion.li>
              );
            })}
          </motion.ul>
        )}
      </ContentReveal>

      {/* ── Permanent clear confirm (destructive) ─────────────────────────
          Gated behind the house AlertDialog — never window.confirm. Confirm
          fires the parent's POST /api/today/queue/clear mutation; the button
          shows the in-flight spinner while it runs. */}
      {onClearAll && (
        <AlertDialog
          open={confirmClearOpen}
          onOpenChange={(open) => {
            // Don't let an outside-click close the dialog mid-clear.
            if (isClearing) return;
            setConfirmClearOpen(open);
          }}
        >
          <AlertDialogContent data-testid="dialog-clear-queue">
            <AlertDialogHeader>
              <AlertDialogTitle>
                Clear all {clearable.length} decision{clearable.length === 1 ? "" : "s"} permanently?
              </AlertDialogTitle>
              <AlertDialogDescription>
                This removes every item currently in your decision queue. It can't
                be undone — cleared items won't come back. New leads, deals, and
                signals will still show up here going forward.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel
                disabled={isClearing}
                data-testid="cancel-clear-queue"
              >
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                disabled={isClearing}
                onClick={(e) => {
                  // Keep the dialog mounted while the mutation runs so the
                  // spinner is visible; the parent closes it on success via
                  // the queue refetching empty (visible.length → 0).
                  e.preventDefault();
                  onClearAll();
                }}
                className="gap-1.5"
                data-testid="confirm-clear-queue"
              >
                {isClearing ? (
                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Trash2 className="w-4 h-4" aria-hidden="true" />
                )}
                Clear queue
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}
