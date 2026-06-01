/**
 * SwipeableCard — generic horizontal swipe-to-action primitive.
 *
 * Extracted from InboxTab (Workstream D, Wave 3). Encapsulates the
 * tuned drag vocabulary that already feels right on the inbox triage
 * surface so every list in the app can pick it up:
 *
 *   - Drag horizontally with rubber-band elastic.
 *   - Commit when distance > `commitDistancePx` (default 120) OR
 *     velocity > `commitVelocityPxs` (default 500). Quarter-second
 *     flicks land.
 *   - Spring-back on release if the threshold isn't met.
 *   - Reveal action backgrounds during drag, sized by distance, in
 *     `--acr-{tone}-soft` background with `--acr-{tone}` ink. iOS
 *     Mail convention: right-action background reveals on left-swipe,
 *     left-action background reveals on right-swipe.
 *   - Respect `data-motion="reduced"`: skip the drag wrapper entirely
 *     and render children as a plain div. No spatial gesture is the
 *     correct degradation — users with that preference set ALSO have
 *     a fallback tap-target on the row itself.
 *
 * The component does NOT own the card chrome. Pass any children — a
 * `<Card>`, a `<motion.li>` body, whatever — and they ride inside the
 * dragged surface. The reveal backgrounds sit underneath and clip to
 * the wrapper's rounded shape (`rounded-2xl`).
 */

import { useMotionValue, useTransform, motion, type PanInfo } from "framer-motion";
import { useReducedMotionPreference } from "@/lib/motion-tokens";
import { lightImpact } from "@/lib/haptics";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

export type SwipeTone = "neg" | "warn" | "brand" | "pos";

export interface SwipeAction {
  icon: LucideIcon;
  label: string;
  onAction: () => void;
  tone: SwipeTone;
}

export interface SwipeableCardProps {
  children: React.ReactNode;
  /** Action revealed on RIGHT-swipe (finger moves left→right). iOS Mail convention. */
  leftAction?: SwipeAction;
  /** Action revealed on LEFT-swipe (finger moves right→left). */
  rightAction?: SwipeAction;
  /** Distance past which a release commits (default 120). */
  commitDistancePx?: number;
  /** Velocity past which a release commits (default 500). */
  commitVelocityPxs?: number;
  /** When true, no drag — children render unwrapped. */
  disabled?: boolean;
  /** Extra className on the outer wrapper (rounded clip + relative). */
  className?: string;
}

const toneBg: Record<SwipeTone, string> = {
  neg: "bg-[color:var(--acr-neg-soft)] text-[color:var(--acr-neg)]",
  warn: "bg-[color:var(--acr-warn-soft)] text-[color:var(--acr-warn)]",
  brand: "bg-[color:var(--acr-brand-soft)] text-[color:var(--acr-brand)]",
  pos: "bg-[color:var(--acr-pos-soft)] text-[color:var(--acr-pos)]",
};

/**
 * Detect data-motion="reduced" on the document root. Returns true when
 * the user has either OS-level prefers-reduced-motion OR the app has
 * been set to reduced motion via the data-motion attribute (see
 * index.css). Either signal kills the drag wrapper.
 */
function useReducedMotionOrAttribute(): boolean {
  const osReduced = useReducedMotionPreference();
  if (osReduced) return true;
  if (typeof document === "undefined") return false;
  return document.documentElement.getAttribute("data-motion") === "reduced";
}

export function SwipeableCard({
  children,
  leftAction,
  rightAction,
  commitDistancePx = 120,
  commitVelocityPxs = 500,
  disabled,
  className,
}: SwipeableCardProps) {
  const reduced = useReducedMotionOrAttribute();
  const x = useMotionValue(0);

  // Haptic on commit. Fire once when the gesture lands past the commit
  // threshold — not during drag (that would spam vibrations). The check
  // mirrors handleDragEnd's threshold logic exactly so the haptic is
  // always coupled to the same moment the action fires.
  const fireHapticOnCommit = (offset: number, velocity: number) => {
    const passedDistance = Math.abs(offset) > commitDistancePx;
    const passedVelocity = Math.abs(velocity) > commitVelocityPxs;
    if (passedDistance || passedVelocity) {
      lightImpact();
    }
  };

  // Action backgrounds — fade in as the user drags toward the action.
  // bgLeftOpacity reveals the `leftAction` during a right-swipe (x > 0).
  // bgRightOpacity reveals the `rightAction` during a left-swipe (x < 0).
  const bgLeftOpacity = useTransform(x, [0, 80, 200], [0, 0.6, 1]);
  const bgRightOpacity = useTransform(x, [-200, -80, 0], [1, 0.6, 0]);
  const opacity = useTransform(x, [-200, 0, 200], [0.3, 1, 0.3]);

  // When neither action is provided, drag is a no-op — render children plain.
  // When disabled or reduced motion, same fallback so the row still renders
  // and the embedded tap target (provided by `children`) keeps working.
  if (disabled || reduced || (!leftAction && !rightAction)) {
    return <div className={cn("relative", className)}>{children}</div>;
  }

  // If only one action is provided, clamp drag to that side. Both → both.
  const dragConstraints = {
    left: rightAction ? -240 : 0,
    right: leftAction ? 240 : 0,
  };

  const handleDragEnd = (_e: unknown, info: PanInfo) => {
    const offset = info.offset.x;
    const velocity = info.velocity.x;
    const passedDistance = Math.abs(offset) > commitDistancePx;
    const passedVelocity = Math.abs(velocity) > commitVelocityPxs;
    if (!passedDistance && !passedVelocity) return;

    // Haptic at the moment the gesture commits — one pulse, the same
    // instant the action fires. lightImpact() is a no-op when
    // prefers-reduced-motion is set.
    fireHapticOnCommit(offset, velocity);

    // Direction of the gesture decides which action fires. A
    // right-swipe (offset > 0) commits the leftAction (background
    // revealed from the left). A left-swipe commits the rightAction.
    if (offset > 0 && leftAction) {
      leftAction.onAction();
    } else if (offset < 0 && rightAction) {
      rightAction.onAction();
    }
  };

  const LeftIcon = leftAction?.icon;
  const RightIcon = rightAction?.icon;

  return (
    <div className={cn("relative overflow-hidden rounded-2xl", className)}>
      {leftAction && LeftIcon && (
        <motion.div
          aria-hidden
          className={cn(
            "absolute inset-0 flex items-center justify-start pl-6 rounded-2xl",
            toneBg[leftAction.tone],
          )}
          style={{ opacity: bgLeftOpacity }}
        >
          <LeftIcon className="h-6 w-6" />
          <span className="ml-2 text-sm font-medium">{leftAction.label}</span>
        </motion.div>
      )}
      {rightAction && RightIcon && (
        <motion.div
          aria-hidden
          className={cn(
            "absolute inset-0 flex items-center justify-end pr-6 rounded-2xl",
            toneBg[rightAction.tone],
          )}
          style={{ opacity: bgRightOpacity }}
        >
          <span className="mr-2 text-sm font-medium">{rightAction.label}</span>
          <RightIcon className="h-6 w-6" />
        </motion.div>
      )}

      <motion.div
        drag="x"
        dragConstraints={dragConstraints}
        dragElastic={0.5}
        onDragEnd={handleDragEnd}
        style={{ x, opacity }}
        whileTap={{ scale: 0.98 }}
        className="relative"
      >
        {children}
      </motion.div>
    </div>
  );
}

export default SwipeableCard;
