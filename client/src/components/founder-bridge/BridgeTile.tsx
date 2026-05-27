/**
 * BridgeTile — the shared chrome every Bridge tile wears.
 *
 * Hairline border + 1px top inner highlight for depth (no shadows).
 * 20pt radius desktop / 16pt mobile. Generous internal padding. On
 * hover (desktop only, pointer:fine), border brightens to signal
 * interactivity; collapsed to opacity-only under reduced-motion.
 *
 * Composes a `↗︎` "discuss" affordance in the top-right corner when
 * onDiscuss is supplied — the chat-handoff hook wired in a later phase.
 */
import { forwardRef, type ReactNode } from "react";
import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";

export interface BridgeTileProps {
  /** Tile content. */
  children: ReactNode;
  /** Aria label for screen readers — required so a tile is identifiable. */
  label: string;
  /** Optional callback for the top-right "↗︎ discuss" affordance. */
  onDiscuss?: () => void;
  /** Optional className override. */
  className?: string;
  /** Optional test id. */
  testId?: string;
}

export const BridgeTile = forwardRef<HTMLDivElement, BridgeTileProps>(function BridgeTile(
  { children, label, onDiscuss, className, testId },
  ref,
) {
  return (
    <div
      ref={ref}
      role="group"
      aria-label={label}
      data-testid={testId}
      className={cn(
        "relative isolate flex flex-col rounded-2xl",
        // Hairline border + transparent fill so the page bg shows through.
        "border border-acr-line bg-white/[0.015]",
        // Top inner highlight — a 1px gradient hairline that fakes depth
        // without a drop shadow.
        "before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:h-px",
        "before:rounded-t-2xl before:bg-gradient-to-b before:from-white/[0.06] before:to-transparent",
        // Hover state (pointer:fine only — never on touch).
        "transition-colors duration-200",
        "[@media(pointer:fine)]:hover:border-white/[0.10]",
        // Reduced-motion strips the colorshift's perceived motion.
        "motion-reduce:transition-none",
        className,
      )}
    >
      {onDiscuss && (
        <button
          type="button"
          onClick={onDiscuss}
          aria-label={`Discuss ${label} with Atlas`}
          className={cn(
            "absolute right-3 top-3 z-10 flex h-6 w-6 items-center justify-center rounded-full",
            "text-muted-foreground/60 transition-colors duration-150",
            "[@media(pointer:fine)]:hover:bg-white/[0.06] [@media(pointer:fine)]:hover:text-foreground/90",
            // Visible focus state — accessibility rule.
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FFB547]/60 focus-visible:ring-offset-1 focus-visible:ring-offset-background",
          )}
        >
          <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      )}
      {children}
    </div>
  );
});
