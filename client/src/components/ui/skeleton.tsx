import { cn } from "@/lib/utils"

/**
 * Skeleton — a self-announcing loading placeholder.
 *
 * Why role="status" + sr-only text:
 * Without this, the 257 callers across the app each rendered a silent
 * animated grey rectangle. Screen-reader users heard nothing while content
 * loaded. By marking the root as `role="status"` and `aria-busy="true"` and
 * injecting visually-hidden text, every existing caller becomes a11y-correct
 * without touching the call sites. Callers can pass `announceText` to give
 * a more specific cue (e.g. "Loading lead detail").
 *
 * Pass `announce={false}` for decorative placeholders inside a list whose
 * parent already announces loading state, to avoid duplicate announcements.
 */
interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Text read by screen readers. Default: "Loading content". */
  announceText?: string
  /** Set to false to suppress the sr-only announcement (e.g. inside a list
   *  that already has a parent role="status"). Default: true. */
  announce?: boolean
}

function Skeleton({
  className,
  announceText = "Loading content",
  announce = true,
  ...props
}: SkeletonProps) {
  return (
    <div
      role={announce ? "status" : undefined}
      aria-busy={announce ? true : undefined}
      aria-live={announce ? "polite" : undefined}
      className={cn("animate-pulse rounded-md bg-muted", className)}
      {...props}
    >
      {announce ? <span className="sr-only">{announceText}</span> : null}
    </div>
  )
}

export { Skeleton }
