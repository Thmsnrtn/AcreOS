import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { motion } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ContentReveal } from "@/components/ContentReveal";
import { ClearedEmpty } from "@/components/empty-states";
import { ConfidenceBar } from "@/components/today/ConfidenceBar";
import { ConfidenceSparkline } from "@/components/today/ConfidenceSparkline";
import { SwipeableCard } from "@/components/mobile/SwipeableCard";
import { staggerContainer, staggerItem } from "@/lib/animations";
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
export function DecisionQueue({ items, isLoading, autoThreshold = 1.01 }: DecisionQueueProps) {
  const [snoozed, setSnoozed] = useState<Record<string, number>>(() => loadSnoozed());
  const [, setLocation] = useLocation();

  // A Pax-sourced item is "auto-handled" when its confidence meets/exceeds the
  // user's autonomy threshold. Visual-only treatment (see prop doc).
  const isAutoHandled = (item: DecisionItem) =>
    item.source.startsWith("pax-") &&
    typeof item.confidence === "number" &&
    item.confidence >= autoThreshold;

  useEffect(() => {
    persistSnoozed(snoozed);
  }, [snoozed]);

  function snoozeItem(id: string) {
    setSnoozed((prev) => ({ ...prev, [id]: Date.now() + SNOOZE_DURATION_MS }));
  }

  function snoozeAll(ids: string[]) {
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

  const visible = useMemo(
    () => items.filter((it) => !snoozed[it.id]).sort((a, b) => a.rank - b.rank),
    [items, snoozed],
  );
  const snoozedCount = Object.keys(snoozed).length;

  return (
    <div data-testid="section-decision-queue">
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-acr-brand" aria-hidden="true" />
          <h2 className="acr-section-h2 text-section-h2">Decision queue</h2>
          {visible.length > 0 && (
            <Badge variant="secondary" className="bg-acr-brand-soft text-acr-brand border-transparent text-xs tabular-nums">
              {visible.length}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1">
          {visible.length > 0 && (
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
              Restore {snoozedCount}
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
          <ClearedEmpty
            headline={snoozedCount > 0 ? "Queue cleared for now" : "All clear — nothing needs you right now"}
            subtitle={
              snoozedCount > 0
                ? `${snoozedCount} item${snoozedCount === 1 ? "" : "s"} snoozed for 24 hours. Use Restore to bring them back.`
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
              return (
                <motion.li key={item.id} role="listitem" variants={staggerItem}>
                  <SwipeableCard
                    leftAction={{
                      icon: ArrowRightCircle,
                      label: swipeLeftLabel,
                      tone: swipeLeftTone,
                      onAction: () => setLocation(item.actionUrl),
                    }}
                    rightAction={{
                      icon: Clock,
                      label: "Snooze 24h",
                      tone: "warn",
                      onAction: () => snoozeItem(item.id),
                    }}
                  >
                  <Card
                    className="rounded-card hover:shadow-md transition-shadow border-l-2"
                    style={{ borderLeftColor: borderColor }}
                    data-auto-handled={auto ? "true" : undefined}
                    data-priority={item.priority}
                    data-testid={`decision-item-${item.id}`}
                  >
                    <CardContent className="flex items-start gap-4 p-4">
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
    </div>
  );
}
