import { useRef, useState, useEffect, useCallback, type ReactNode } from "react";
import { Haptics, ImpactStyle } from "@capacitor/haptics";
import { RefreshCw, ArrowDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";

interface PullToRefreshProps {
  children: ReactNode;
  onRefresh: () => Promise<void>;
  /** Threshold in pixels to trigger refresh (default: 80) */
  threshold?: number;
  /** Maximum pull distance in pixels (default: 120) */
  maxPull?: number;
  /** Whether pull-to-refresh is enabled (default: true) */
  enabled?: boolean;
  /** Custom className for the container */
  className?: string;
}

type PullState = "idle" | "pulling" | "ready" | "refreshing";

/**
 * PullToRefresh - A mobile-friendly pull-to-refresh container component.
 * 
 * Features:
 * - Native-feeling pull gesture with visual feedback
 * - Haptic feedback at threshold via Capacitor
 * - Automatic detection of scroll position
 * - Works with React Query's refetch pattern
 */
export function PullToRefresh({
  children,
  onRefresh,
  threshold = 80,
  maxPull = 120,
  enabled = true,
  className,
}: PullToRefreshProps) {
  const { isMobile } = useIsMobile();
  const containerRef = useRef<HTMLDivElement>(null);
  const [pullState, setPullState] = useState<PullState>("idle");
  const [pullDistance, setPullDistance] = useState(0);
  const touchStartY = useRef<number | null>(null);
  const scrollStartY = useRef<number>(0);
  const hasTriggeredHaptic = useRef(false);

  // Don't render pull-to-refresh on desktop
  const isEnabled = enabled && isMobile;

  const triggerHaptic = useCallback(async () => {
    try {
      await Haptics.impact({ style: ImpactStyle.Medium });
    } catch {
      // Haptics not available (web or unsupported device)
    }
  }, []);

  const handleRefresh = useCallback(async () => {
    setPullState("refreshing");
    try {
      await triggerHaptic();
      await onRefresh();
    } finally {
      // Smooth transition back
      setPullState("idle");
      setPullDistance(0);
    }
  }, [onRefresh, triggerHaptic]);

  useEffect(() => {
    if (!isEnabled) return;

    const container = containerRef.current;
    if (!container) return;

    const handleTouchStart = (e: TouchEvent) => {
      // Only enable at top of scroll
      const scrollTop = container.scrollTop || window.scrollY;
      if (scrollTop > 5) return;

      touchStartY.current = e.touches[0].clientY;
      scrollStartY.current = scrollTop;
      hasTriggeredHaptic.current = false;
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (touchStartY.current === null) return;
      if (pullState === "refreshing") return;

      const currentY = e.touches[0].clientY;
      const scrollTop = container.scrollTop || window.scrollY;
      
      // Only activate if at top
      if (scrollTop > 5) {
        touchStartY.current = null;
        setPullDistance(0);
        setPullState("idle");
        return;
      }

      const diff = currentY - touchStartY.current;
      
      // Only pull down, not up
      if (diff <= 0) {
        setPullDistance(0);
        setPullState("idle");
        return;
      }

      // Apply resistance for natural feel
      const resistance = 0.5;
      const distance = Math.min(diff * resistance, maxPull);
      setPullDistance(distance);

      if (distance >= threshold) {
        if (!hasTriggeredHaptic.current) {
          triggerHaptic();
          hasTriggeredHaptic.current = true;
        }
        setPullState("ready");
      } else {
        setPullState("pulling");
        hasTriggeredHaptic.current = false;
      }

      // Prevent default scrolling behavior when pulling
      if (distance > 10) {
        e.preventDefault();
      }
    };

    const handleTouchEnd = () => {
      touchStartY.current = null;

      if (pullState === "ready") {
        handleRefresh();
      } else {
        setPullState("idle");
        setPullDistance(0);
      }
    };

    container.addEventListener("touchstart", handleTouchStart, { passive: true });
    container.addEventListener("touchmove", handleTouchMove, { passive: false });
    container.addEventListener("touchend", handleTouchEnd, { passive: true });

    return () => {
      container.removeEventListener("touchstart", handleTouchStart);
      container.removeEventListener("touchmove", handleTouchMove);
      container.removeEventListener("touchend", handleTouchEnd);
    };
  }, [isEnabled, pullState, threshold, maxPull, handleRefresh, triggerHaptic]);

  if (!isEnabled) {
    return <div className={className}>{children}</div>;
  }

  const progress = Math.min(pullDistance / threshold, 1);
  const rotation = pullState === "refreshing" ? 0 : progress * 180;
  const showIndicator = pullDistance > 10 || pullState === "refreshing";

  return (
    <div
      ref={containerRef}
      className={cn("relative overflow-auto", className)}
      data-testid="pull-to-refresh-container"
    >
      {/* Pull indicator */}
      <div
        className={cn(
          "absolute left-0 right-0 flex items-center justify-center transition-opacity duration-200 pointer-events-none z-10",
          showIndicator ? "opacity-100" : "opacity-0"
        )}
        style={{
          top: `calc(env(safe-area-inset-top, 0px) + ${Math.max(pullDistance - 40, 8)}px)`,
          height: "40px",
        }}
        data-testid="pull-to-refresh-indicator"
      >
        <div
          className={cn(
            "flex items-center justify-center w-10 h-10 rounded-full shadow-md transition-all duration-200",
            pullState === "ready" || pullState === "refreshing"
              ? "bg-primary text-primary-foreground scale-110"
              : "bg-background text-muted-foreground border border-border"
          )}
        >
          {pullState === "refreshing" ? (
            <RefreshCw className="w-5 h-5 animate-spin" data-testid="refresh-spinner" />
          ) : (
            <ArrowDown
              className="w-5 h-5 transition-transform duration-200"
              style={{ transform: `rotate(${rotation}deg)` }}
              data-testid="pull-arrow"
            />
          )}
        </div>
      </div>

      {/* Content with pull offset */}
      <div
        className="transition-transform duration-200"
        style={{
          transform: pullState === "refreshing" 
            ? "translateY(48px)" 
            : `translateY(${pullDistance}px)`,
          transitionDuration: pullState === "idle" || pullState === "refreshing" ? "200ms" : "0ms",
        }}
        data-testid="pull-to-refresh-content"
      >
        {children}
      </div>
    </div>
  );
}
