import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { useListKeys, ListKeyGrammarOverlay } from "@/hooks/use-list-keys";
import {
  isAboveThreshold,
  qualifyingApprovals,
} from "@/components/today/approve-above-threshold";
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
import { ConfidenceBar } from "@/components/today/ConfidenceBar";
import { ConfidenceSparkline } from "@/components/today/ConfidenceSparkline";
import { SwipeableCard } from "@/components/mobile/SwipeableCard";
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
  | "ai-queue"
  | "portfolio-alert";

const sourcePillStyles: Record<DecisionSource, string> = {
  "pax-priority": "bg-acr-brand-soft text-acr-brand",
  "pax-suggests": "bg-acr-pos-soft text-acr-pos",
  "pax-noticed": "bg-acr-brand-soft text-acr-brand",
  "ai-queue": "bg-primary/10 text-primary",
  "portfolio-alert": "bg-acr-warn-soft text-acr-warn",
};

const sourcePillLabel: Record<DecisionSource, string> = {
  "pax-priority": "Pax",
  "pax-suggests": "Pax",
  "pax-noticed": "Pax",
  "ai-queue": "AI queue",
  "portfolio-alert": "Alert",
};

const sourceIcon: Record<DecisionSource, LucideIcon> = {
  "pax-priority": Zap,
  "pax-suggests": Sparkles,
  "pax-noticed": Sparkles,
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
  // Optional Pax model-confidence (0..1). Only set for Pax-sourced rows;
  // surfaces in the merged left-edge pill ("Pax · 87%") and drives the
  // ConfidenceBar + ConfidenceSparkline directly under the title.
  confidence?: number | null;
  // Optional chronological history of confidences (oldest first) for this
  // item's class — fed into the sparkline. The server `/api/today` does
  // not populate this yet; Sparkline gracefully renders a flat baseline.
  confidenceHistory?: number[];
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
   * Pax autonomy threshold (0..1). Pax-sourced items whose confidence is at
   * or above this value are rendered as "Pax will handle — tap to override"
   * instead of as a decision the user must make.
   *
   * NOTE: this is a *visual* treatment only. It reflects the user's persisted
   * autonomy preference but does NOT itself execute anything — server-side
   * auto-execution above the threshold is a separate, not-yet-wired engine.
   * Default 1.01 means "never auto" until a threshold is supplied.
   */
  autoThreshold?: number;
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
  /**
   * Batch-approve the "Pax would handle" rows (Wave 1.3): the parent runs
   * the SAME per-item resolution mutation the row-level Done button uses,
   * once per item, sequentially — never a bulk endpoint (see
   * components/today/approve-above-threshold.ts). This component only
   * renders the affordance + the confirm dialog that states exactly which
   * rows it will touch and what "approve" does (marks each done — nothing
   * is sent or executed).
   */
  onApproveAboveThreshold?: (items: DecisionItem[]) => void;
  /** True while the sequential per-item run is in flight. */
  isApproving?: boolean;
  /** "Approving n of N…" readout while the run progresses. */
  approveProgress?: { done: number; total: number } | null;
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
export function DecisionQueue({
  items,
  isLoading,
  autoThreshold = 1.01,
  onResolve,
  resolvingIds,
  clearedToday = 0,
  totalToday = 0,
  onClearAll,
  isClearing = false,
  onApproveAboveThreshold,
  isApproving = false,
  approveProgress = null,
}: DecisionQueueProps) {
  const [snoozed, setSnoozed] = useState<Record<string, number>>(() => loadSnoozed());
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [confirmApproveOpen, setConfirmApproveOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [, setLocation] = useLocation();

  // A Pax-sourced item is "auto-handled" when its confidence meets/exceeds the
  // user's autonomy threshold. Visual-only treatment (see prop doc). Shared
  // predicate with the batch affordance so row styling and "Approve all N"
  // can never disagree about which rows qualify.
  const isAutoHandled = (item: DecisionItem) => isAboveThreshold(item, autoThreshold);

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

  // Same edge-close pattern for the batch-approve confirm: the dialog stays
  // mounted while the sequential run progresses ("Approving n of N…"), and
  // closes when the parent's run settles (per-item results land in a toast).
  const wasApprovingRef = useRef(false);
  useEffect(() => {
    if (wasApprovingRef.current && !isApproving) {
      setConfirmApproveOpen(false);
    }
    wasApprovingRef.current = isApproving;
  }, [isApproving]);

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

  // ── Keyboard layer (Wave 1.3) — J/K traverses, Enter opens, S snoozes ──
  // Desktop-only (fine pointer + hover); suppressed while typing and while
  // dialogs are open. "S" prefers the server 3-day snooze (the same
  // per-item PATCH the inline Snooze button fires) when the row is
  // resolvable; otherwise it falls back to the local 24h hide — exactly
  // the two paths the on-screen controls already offer, no third one.
  // "?" toggles the grammar overlay below. See hooks/use-list-keys.tsx.
  const { activeIndex } = useListKeys({
    itemCount: visible.length,
    enabled: !isLoading,
    onOpen: (index) => {
      const item = visible[index];
      if (item) setLocation(item.actionUrl);
    },
    actionKeys: {
      s: (index) => {
        const item = visible[index];
        if (!item) return;
        const canResolve =
          !!onResolve && !isAutoHandled(item) && item.inlineAction?.kind === "resolve";
        if (canResolve && !(resolvingIds?.has(item.id) ?? false)) {
          lightImpact();
          onResolve!(item.id, "snooze");
        } else if (!canResolve) {
          snoozeItem(item.id);
        }
      },
    },
    onHelp: () => setHelpOpen((prev) => !prev),
  });
  const activeId = activeIndex !== null ? visible[activeIndex]?.id ?? null : null;
  const rowRefs = useRef<Map<string, HTMLLIElement>>(new Map());
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

  // The exact rows a batch approve would touch (visible "Pax would handle"
  // rows), via the same shared predicate the row styling uses.
  const autoItems = useMemo(
    () => qualifyingApprovals(visible, autoThreshold),
    [visible, autoThreshold],
  );
  const thresholdPctLabel = Math.round(autoThreshold * 100);

  return (
    <div data-testid="section-decision-queue">
      <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-acr-brand" aria-hidden="true" />
          <h2 className="acr-section-h2 text-section-h2">Decision queue</h2>
          {visible.length > 0 && (
            <Badge variant="secondary" className="bg-acr-brand-soft text-acr-brand border-transparent text-xs tabular-nums">
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
          {/* Batch approve — only when qualifying "Pax would handle" rows
              exist AND the parent wired the sequential per-item runner. */}
          {autoItems.length > 0 && onApproveAboveThreshold && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1 text-xs"
              onClick={() => setConfirmApproveOpen(true)}
              disabled={isApproving}
              aria-label={`Clear ${autoItems.length} Pax preview${autoItems.length === 1 ? "" : "s"} at or above your ${thresholdPctLabel}% threshold — they will not come back`}
              data-testid="button-approve-above-threshold"
            >
              <Zap className="w-3 h-3" aria-hidden="true" />
              Clear {autoItems.length} above threshold
            </Button>
          )}
          {visible.length > 0 && (
            onClearAll ? (
              // Permanent clear — destructive, so it opens a confirm dialog
              // before firing POST /api/today/queue/clear (server clears the
              // WHOLE active queue, not just the rows loaded here).
              <Button
                variant="ghost"
                size="sm"
                className="gap-1 text-xs"
                onClick={() => setConfirmClearOpen(true)}
                aria-label={`Clear all ${visible.length} decisions permanently`}
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
                onClick={() => snoozeAll(visible.map((v) => v.id))}
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
        skeleton={
          <div className="space-y-2">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
          </div>
        }
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
              const auto = isAutoHandled(item);
              const isPax = item.source.startsWith("pax-");
              const hasConfidence = isPax && typeof item.confidence === "number";
              const confidencePct = hasConfidence
                ? Math.round((item.confidence as number) * 100)
                : null;
              const thresholdPct = Math.round(autoThreshold * 100);
              // Auto-handled rows replace the priority left-border with a
              // hairline --acr-pos signal; other rows take priority tone.
              const borderColor = auto
                ? "var(--acr-pos)"
                : priorityBorderColor[item.priority];
              // Swipe right (left action) — fire the primary CTA. For auto-handled
              // Pax rows that becomes "Override"; otherwise it's the regular open/act
              // path (e.g. "Open lead", "Send reminder"). We navigate via wouter so
              // the gesture matches the on-screen Button's Link target exactly.
              // Swipe left (right action) — snooze, mirroring InboxTab's vocabulary.
              const swipeLeftLabel = auto ? "Override" : item.actionLabel;
              const swipeLeftTone = auto ? "pos" : "brand";
              // Inline-resolve is available when the parent wired onResolve AND
              // the server marked this item resolvable. Auto-handled Pax rows
              // keep their Override-only treatment (Pax owns those).
              const canResolveInline =
                !!onResolve && !auto && item.inlineAction?.kind === "resolve";
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
                    data-auto-handled={auto ? "true" : undefined}
                    data-priority={item.priority}
                    data-testid={`decision-item-${item.id}`}
                  >
                    <CardContent className="flex items-start gap-4 p-6">
                      {auto && (
                        <div
                          className="shrink-0 mt-1.5 w-2 h-2 rounded-full ring-1"
                          style={{
                            background: "transparent",
                            // The ring is the only color signal on auto rows.
                            // Using inline style keeps us on tokens without
                            // adding a new Tailwind utility class.
                            boxShadow: "inset 0 0 0 1px var(--acr-pos)",
                          }}
                          aria-hidden="true"
                        />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          {/* Merged source + confidence pill (one Badge). */}
                          <Badge
                            variant="secondary"
                            className={`text-xs border-transparent inline-flex items-center gap-1 ${sourcePillStyles[item.source]}`}
                            aria-label={
                              hasConfidence
                                ? `${sourcePillLabel[item.source]}, confidence ${confidencePct}%`
                                : sourcePillLabel[item.source]
                            }
                          >
                            <SourceIcon className="w-3 h-3" aria-hidden={true} />
                            <span>{sourcePillLabel[item.source]}</span>
                            {hasConfidence && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="tabular-nums">{confidencePct}%</span>
                              </>
                            )}
                          </Badge>
                          {auto && (
                            <span className="text-xs text-acr-pos inline-flex items-center gap-1">
                              <Zap className="w-3 h-3" aria-hidden="true" />
                              Pax would handle
                            </span>
                          )}
                        </div>
                        <div className="text-[15px] font-medium leading-snug text-foreground">
                          {item.title}
                        </div>
                        <p className="text-xs text-muted-foreground leading-relaxed mt-1">
                          {auto
                            ? "Preview — Pax will still ask you. You'll see this row in your queue."
                            : item.description}
                        </p>
                        {isPax && hasConfidence && (
                          <div
                            className="flex items-center justify-between gap-3 mt-2"
                            aria-label={`Pax confidence ${confidencePct}% (auto-handle threshold ${thresholdPct}%)`}
                          >
                            <ConfidenceBar
                              value={item.confidence as number}
                              threshold={autoThreshold}
                            />
                            <ConfidenceSparkline
                              history={item.confidenceHistory ?? []}
                              current={item.confidence as number}
                            />
                          </div>
                        )}

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
                        variant={auto ? "outline" : "default"}
                        className="shrink-0 text-xs"
                      >
                        <Link href={item.actionUrl}>{auto ? "Override" : item.actionLabel}</Link>
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
                Clear all {visible.length} decision{visible.length === 1 ? "" : "s"} permanently?
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

      {/* ── Approve-above-threshold confirm ───────────────────────────────
          States exactly which rows it touches and what "approve" does. On
          confirm the parent runs the SAME per-item resolution mutation the
          row-level Done button uses, once per item, sequentially — per-item
          results land in the parent's summary toast; failed rows stay. */}
      {onApproveAboveThreshold && (
        <AlertDialog
          open={confirmApproveOpen}
          onOpenChange={(open) => {
            // Don't let an outside-click close the dialog mid-run.
            if (isApproving) return;
            setConfirmApproveOpen(open);
          }}
        >
          <AlertDialogContent data-testid="dialog-approve-above-threshold">
            <AlertDialogHeader>
              <AlertDialogTitle>
                Clear {autoItems.length} Pax preview{autoItems.length === 1 ? "" : "s"} at or above{" "}
                {thresholdPctLabel}% confidence?
              </AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-2">
                  <ul className="list-disc pl-5 space-y-1 max-h-40 overflow-y-auto">
                    {autoItems.map((item) => (
                      <li key={item.id} className="text-sm">
                        {item.title}
                        {typeof item.confidence === "number" && (
                          <span className="tabular-nums text-muted-foreground">
                            {" "}· {Math.round(item.confidence * 100)}%
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                  <p>
                    Each row is marked done individually, one request per row.
                    Nothing is sent or executed on your behalf —{" "}
                    <strong>and these rows will not come back</strong>: marking
                    a Pax preview done is how you tell the queue to stop
                    raising it. Rows that fail stay in your queue.
                  </p>
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel
                disabled={isApproving}
                data-testid="cancel-approve-above-threshold"
              >
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                disabled={isApproving}
                onClick={(e) => {
                  // Keep the dialog mounted while the sequential run
                  // progresses; the isApproving true→false edge closes it.
                  e.preventDefault();
                  onApproveAboveThreshold(autoItems);
                }}
                className="gap-1.5"
                data-testid="confirm-approve-above-threshold"
              >
                {isApproving ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                    {approveProgress
                      ? `Approving ${approveProgress.done} of ${approveProgress.total}…`
                      : "Approving…"}
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4" aria-hidden="true" />
                    Approve all {autoItems.length}
                  </>
                )}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}

      {/* ── "?" grammar overlay — documents this list's keys ────────────── */}
      <ListKeyGrammarOverlay
        open={helpOpen}
        onOpenChange={setHelpOpen}
        title="Decision queue keys"
        entries={[
          { keys: "j", label: "Next item" },
          { keys: "k", label: "Previous item" },
          { keys: "enter", label: "Open the focused item" },
          { keys: "s", label: "Snooze the focused item" },
          { keys: "escape", label: "Clear focus" },
          { keys: "?", label: "Toggle this help" },
        ]}
      />
    </div>
  );
}
