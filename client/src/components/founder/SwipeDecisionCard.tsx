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
          className="absolute inset-y-0 right-4 flex items-center pointer-events-none"
          style={{ opacity: approveOpacity }}
        >
          <div className="flex items-center gap-2 text-green-600 font-medium">
            <Check className="h-6 w-6" />
            <span className="text-sm">Approve</span>
          </div>
        </motion.div>
        <motion.div
          className="absolute inset-y-0 left-4 flex items-center pointer-events-none"
          style={{ opacity: rejectOpacity }}
        >
          <div className="flex items-center gap-2 text-red-600 font-medium">
            <span className="text-sm">Reject</span>
            <X className="h-6 w-6" />
          </div>
        </motion.div>

        {/* Success/Reject flash overlay */}
        <AnimatePresence>
          {flashState !== 'none' && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className={`absolute inset-0 z-10 flex items-center justify-center rounded-xl ${
                flashState === 'approved'
                  ? 'bg-green-500/20'
                  : 'bg-red-500/20'
              }`}
            >
              {flashState === 'approved' ? (
                <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 400, damping: 15 }}>
                  <Check className="h-12 w-12 text-green-600" strokeWidth={3} />
                </motion.div>
              ) : (
                <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 400, damping: 15 }}>
                  <X className="h-12 w-12 text-red-600" strokeWidth={3} />
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
              <span className="text-2xl" role="img" aria-label={role}>{avatar}</span>
              <div>
                <p className="text-sm font-medium text-foreground">{role}</p>
                <p className="text-xs text-muted-foreground">
                  {naturalItemType(item.itemType)} · {naturalUrgency(item.urgencyScore)}
                </p>
              </div>
            </div>
            <Badge className={`text-xs ${
              item.riskLevel === "critical" ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300" :
              item.riskLevel === "high" ? "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300" :
              "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
            }`}>
              {naturalRisk(item.riskLevel)}
            </Badge>
          </div>

          {/* Analysis — the human-readable recommendation */}
          <p className="text-sm text-foreground leading-relaxed">{item.sophieAnalysis}</p>

          {/* Impact if available */}
          {item.estimatedImpactCents && (
            <p className="text-xs text-muted-foreground">
              Estimated impact: ${(item.estimatedImpactCents / 100).toLocaleString()}/yr
            </p>
          )}

          {/* Expandable context */}
          {item.contextBundle && Object.keys(item.contextBundle).length > 0 && (
            <button
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              onClick={(e) => { e.stopPropagation(); setExpanded(e => !e); }}
            >
              {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              {expanded ? "Hide details" : "Show details"}
            </button>
          )}

          <AnimatePresence>
            {expanded && item.contextBundle && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <pre className="text-xs bg-muted rounded-lg p-3 overflow-auto max-h-32">
                  {JSON.stringify(item.contextBundle, null, 2)}
                </pre>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Action buttons (fallback for non-swipe users) */}
          <div className="flex items-center gap-2 pt-1">
            <Button
              size="sm"
              className="bg-green-600 hover:bg-green-700 text-white flex-1"
              disabled={mutate.isPending}
              onClick={(e) => { e.stopPropagation(); mutate.mutate({ action: "approve" }); }}
            >
              <Check className="h-3.5 w-3.5 mr-1.5" />
              {item.recommendedActionLabel}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={mutate.isPending}
              onClick={(e) => { e.stopPropagation(); mutate.mutate({ action: "reject" }); }}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={mutate.isPending}
              onClick={(e) => { e.stopPropagation(); mutate.mutate({ action: "defer", body: { hours: 24 } }); }}
            >
              <Clock className="h-3.5 w-3.5" />
            </Button>
          </div>

          {/* Swipe hint */}
          <p className="text-[10px] text-muted-foreground/50 text-center select-none">
            Swipe right to approve · left to reject
          </p>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
