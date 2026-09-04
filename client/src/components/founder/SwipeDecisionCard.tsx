/**
 * SwipeDecisionCard — Sovereign Company Protocol v3
 *
 * Tinder-style swipeable decision cards for the CEO.
 * Swipe right to approve, left to reject. Tap to expand.
 *
 * Uses Framer Motion drag gestures with spring physics
 * for a native, Apple-grade interaction feel.
 */

import { useState, useRef } from "react";
import { motion, useMotionValue, useTransform, AnimatePresence } from "framer-motion";
import { useRespectfulTransition } from "@/lib/motion-tokens";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Check, X, Clock, ChevronDown, ChevronUp } from "lucide-react";
import {
  AGENT_AVATARS,
  AGENT_ROLES,
  naturalItemType,
  naturalUrgency,
  naturalRisk,
} from "@/lib/trust-language";

// Haptic feedback helper
function triggerHaptic(style: 'light' | 'medium' | 'heavy' = 'medium') {
  try {
    if ('vibrate' in navigator) {
      navigator.vibrate(style === 'light' ? 10 : style === 'medium' ? [10, 50, 10] : [30, 30, 30]);
    }
  } catch {}
}

// Jarvis 2.3 — phone-answerable card option (contextBundle.options) and the
// precedent attached by the cascade (contextBundle.precedents).
interface DecisionCardOption {
  key: string;
  label: string;
}

interface DecisionPrecedent {
  sourceRef: string;
  snippet: string;
  similarity: number;
}

function readOptions(bundle: Record<string, any> | null): DecisionCardOption[] {
  const raw = bundle?.options;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (o: any): o is DecisionCardOption =>
      o && typeof o.key === "string" && typeof o.label === "string",
  );
}

function readPrecedents(bundle: Record<string, any> | null): DecisionPrecedent[] {
  const raw = bundle?.precedents;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (p: any): p is DecisionPrecedent =>
      p && typeof p.sourceRef === "string" && typeof p.snippet === "string",
  );
}

interface DecisionItem {
  id: number;
  itemType: string;
  riskLevel: string;
  urgencyScore: number;
  estimatedImpactCents: number | null;
  sophieAnalysis: string;
  sophieConfidenceScore: number | null;
  recommendedAction: string;
  recommendedActionLabel: string;
  ownerAgentCodename?: string;
  organizationId: number | null;
  contextBundle: Record<string, any> | null;
  status: string;
  createdAt: string;
}

interface SwipeDecisionCardProps {
  item: DecisionItem;
  onAction: () => void;
}

const SWIPE_THRESHOLD = 120;

const RISK_ACCENT: Record<string, string> = {
  critical: "border-l-red-500",
  high: "border-l-orange-500",
  medium: "border-l-amber-400",
  low: "border-l-blue-400",
};

export function SwipeDecisionCard({ item, onAction }: SwipeDecisionCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [flashState, setFlashState] = useState<'none' | 'approved' | 'rejected'>('none');
  const hapticFired = useRef(false);
  const qc = useQueryClient();
  const x = useMotionValue(0);

  // Respect prefers-reduced-motion for the flash spring + expand fade.
  const flashSpring = useRespectfulTransition({ type: "spring", stiffness: 400, damping: 15 });
  const expandFade = useRespectfulTransition({ duration: 0.2 });

  // Color interpolation based on drag position
  const backgroundColor = useTransform(
    x,
    [-SWIPE_THRESHOLD, 0, SWIPE_THRESHOLD],
    ["rgba(254, 226, 226, 0.5)", "rgba(255, 255, 255, 0)", "rgba(220, 252, 231, 0.5)"]
  );
  const approveOpacity = useTransform(x, [0, SWIPE_THRESHOLD * 0.6], [0, 1]);
  const rejectOpacity = useTransform(x, [-SWIPE_THRESHOLD * 0.6, 0], [1, 0]);

  const mutate = useMutation({
    mutationFn: ({ action, body }: { action: string; body?: any }) =>
      apiRequest("POST", `/api/founder/intelligence/decisions-inbox/${item.id}/${action}`, body ?? {}),
    onSuccess: (_, variables) => {
      qc.invalidateQueries({ queryKey: ["/api/founder/intelligence/decisions-inbox"] });
      qc.invalidateQueries({ queryKey: ["/api/founder/intelligence/morning-briefing"] });
      triggerHaptic('medium');
      // Show brief success/reject flash before dismissing
      setFlashState(variables.action === 'reject' ? 'rejected' : 'approved');
      setTimeout(() => {
        setDismissed(true);
        setTimeout(onAction, 300);
      }, 500);
    },
  });

  // Fire haptic when crossing threshold during drag
  x.on("change", (latest) => {
    const pastThreshold = Math.abs(latest) > SWIPE_THRESHOLD * 0.6;
    if (pastThreshold && !hapticFired.current) {
      triggerHaptic('light');
      hapticFired.current = true;
    } else if (!pastThreshold) {
      hapticFired.current = false;
    }
  });

  const handleDragEnd = (_: any, info: { offset: { x: number }; velocity: { x: number } }) => {
    const swipeDistance = info.offset.x;
    const swipeVelocity = Math.abs(info.velocity.x);

    // Lower threshold if swiping fast
    const effectiveThreshold = swipeVelocity > 300 ? SWIPE_THRESHOLD * 0.5 : SWIPE_THRESHOLD;

    if (swipeDistance > effectiveThreshold) {
      mutate.mutate({ action: "approve" });
    } else if (swipeDistance < -effectiveThreshold) {
      mutate.mutate({ action: "reject" });
    }
  };

  const agent = item.ownerAgentCodename || "sophie_csm";
  const avatar = AGENT_AVATARS[agent] || "🤖";
  const role = AGENT_ROLES[agent] || "AI Agent";
  const options = readOptions(item.contextBundle);
  const precedents = readPrecedents(item.contextBundle);

  // Jarvis 2.3 — tapping an option answers the card in one gesture:
  // 'approve_recommended' approves (and executes the recommended action);
  // any other key lands as an override recorded verbatim.
  const answerWithOption = (opt: DecisionCardOption) => {
    mutate.mutate({
      action: opt.key === "approve_recommended" ? "approve" : "override",
      body: { chosenOption: opt.key },
    });
  };

  if (dismissed) return null;

  return (
    <AnimatePresence>
      <motion.div
        layout
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.2 } }}
        drag="x"
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.3}
        onDragEnd={handleDragEnd}
        style={{ x, backgroundColor }}
        className={`relative rounded-xl border-l-4 ${RISK_ACCENT[item.riskLevel] || RISK_ACCENT.medium} bg-card shadow-sm cursor-grab active:cursor-grabbing touch-pan-y`}
        whileTap={{ scale: 0.99 }}
      >
        {/* Swipe indicators */}
        <motion.div
          aria-hidden="true"
          className="absolute inset-y-0 right-4 flex items-center pointer-events-none"
          style={{ opacity: approveOpacity }}
        >
          <div className="flex items-center gap-2 text-acr-pos font-medium">
            <Check className="h-6 w-6" />
            <span className="text-sm">Approve</span>
          </div>
        </motion.div>
        <motion.div
          aria-hidden="true"
          className="absolute inset-y-0 left-4 flex items-center pointer-events-none"
          style={{ opacity: rejectOpacity }}
        >
          <div className="flex items-center gap-2 text-acr-neg font-medium">
            <span className="text-sm">Reject</span>
            <X className="h-6 w-6" />
          </div>
        </motion.div>

        {/* Success/Reject flash overlay */}
        <AnimatePresence>
          {flashState !== 'none' && (
            <motion.div
              role="status"
              aria-live="polite"
              aria-label={flashState === 'approved' ? "Approved" : "Rejected"}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className={`absolute inset-0 z-docked flex items-center justify-center rounded-xl ${
                flashState === 'approved'
                  ? 'bg-acr-pos/20'
                  : 'bg-acr-neg/20'
              }`}
            >
              {flashState === 'approved' ? (
                <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={flashSpring}>
                  <Check className="h-12 w-12 text-acr-pos" strokeWidth={3} aria-hidden="true" />
                </motion.div>
              ) : (
                <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={flashSpring}>
                  <X className="h-12 w-12 text-acr-neg" strokeWidth={3} aria-hidden="true" />
                </motion.div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Card content */}
        <div className="p-4 space-y-3">
          {/* Header: agent + type + urgency */}
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-3">
              <span className="text-2xl" aria-hidden="true">{avatar}</span>
              <div>
                <p className="text-sm font-medium text-foreground">{role}</p>
                <p className="text-xs text-muted-foreground">
                  {naturalItemType(item.itemType)} · {naturalUrgency(item.urgencyScore)}
                </p>
              </div>
            </div>
            <Badge className={`text-xs ${
              item.riskLevel === "critical" ? "bg-acr-neg-soft text-acr-neg-soft-ink dark:bg-acr-neg-soft/30 dark:text-acr-neg-soft-ink" :
              item.riskLevel === "high" ? "bg-acr-warn-soft text-acr-warn-soft-ink dark:bg-acr-warn-soft/30 dark:text-acr-warn-soft-ink" :
              "bg-acr-warn-soft text-acr-warn-soft-ink dark:bg-acr-warn-soft/30 dark:text-acr-warn-soft-ink"
            }`}>
              {naturalRisk(item.riskLevel)}
            </Badge>
          </div>

          {/* Analysis — the human-readable recommendation */}
          <p className="text-sm text-foreground leading-relaxed">{item.sophieAnalysis}</p>

          {/* Impact if available */}
          {item.estimatedImpactCents && (
            <p className="text-xs text-muted-foreground">
              Estimated impact: <span className="tabular-nums">${(item.estimatedImpactCents / 100).toLocaleString()}</span>/yr
            </p>
          )}

          {/* Expandable context */}
          {item.contextBundle && Object.keys(item.contextBundle).length > 0 && (
            <button
              type="button"
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
              onClick={(e) => { e.stopPropagation(); setExpanded(e => !e); }}
              aria-expanded={expanded}
            >
              {expanded ? <ChevronUp className="h-3 w-3" aria-hidden="true" /> : <ChevronDown className="h-3 w-3" aria-hidden="true" />}
              {expanded ? "Hide details" : "Show details"}
            </button>
          )}

          <AnimatePresence>
            {expanded && item.contextBundle && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={expandFade}
                className="overflow-hidden space-y-2"
              >
                {/* Jarvis 2.3 — precedent(s) attached by the cascade */}
                {precedents.length > 0 && (
                  <div className="text-xs bg-muted rounded-card p-3 space-y-1">
                    <p className="font-medium text-foreground">Previously ruled</p>
                    {precedents.slice(0, 3).map((p) => (
                      <p key={p.sourceRef} className="text-muted-foreground leading-snug">
                        {p.snippet.length > 200 ? `${p.snippet.slice(0, 200)}…` : p.snippet}
                      </p>
                    ))}
                  </div>
                )}
                <pre className="text-xs bg-muted rounded-card p-3 overflow-auto max-h-32">
                  {JSON.stringify(item.contextBundle, null, 2)}
                </pre>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Jarvis 2.3 — phone-answerable options: tap-sized, full-width
              stack. When present they replace the approve/reject/defer row;
              option keys post override (or approve for 'approve_recommended')
              with chosenOption. */}
          {options.length > 0 ? (
            <div className="flex flex-col gap-2 pt-1">
              {options.map((opt) => (
                <Button
                  key={opt.key}
                  type="button"
                  variant={opt.key === "approve_recommended" ? "default" : "outline"}
                  className="w-full min-h-11 justify-center whitespace-normal"
                  disabled={mutate.isPending}
                  aria-busy={mutate.isPending}
                  onClick={(e) => { e.stopPropagation(); answerWithOption(opt); }}
                >
                  {opt.label}
                </Button>
              ))}
            </div>
          ) : (
            /* Action buttons (fallback for non-swipe users) */
            <div className="flex items-center gap-2 pt-1">
              <Button
                type="button"
                size="sm"
                className="bg-acr-pos hover:bg-acr-pos text-white flex-1"
                disabled={mutate.isPending}
                aria-busy={mutate.isPending}
                onClick={(e) => { e.stopPropagation(); mutate.mutate({ action: "approve" }); }}
              >
                <Check className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
                {item.recommendedActionLabel}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={mutate.isPending}
                aria-busy={mutate.isPending}
                aria-label="Reject"
                onClick={(e) => { e.stopPropagation(); mutate.mutate({ action: "reject" }); }}
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={mutate.isPending}
                aria-busy={mutate.isPending}
                aria-label="Defer 24 hours"
                onClick={(e) => { e.stopPropagation(); mutate.mutate({ action: "defer", body: { hours: 24 } }); }}
              >
                <Clock className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            </div>
          )}

          {/* Swipe hint */}
          {options.length === 0 && (
            <p aria-hidden="true" className="text-micro text-muted-foreground/50 text-center select-none">
              Swipe right to approve · left to reject
            </p>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
