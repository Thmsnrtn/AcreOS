/**
 * Thin wrapper around SupportFeedbackModal — gives any page a one-liner
 * button (link or default) that opens the support/feedback form. Pipes
 * into POST /api/feedback → /founder/feedback inbox.
 *
 * Use `variant="link"` for inline prose ("contact our team"); use the
 * default chip variant for standalone CTAs.
 */

import { useState, type ReactNode } from "react";
import { SupportFeedbackModal } from "./support-feedback-modal";

type Category = "support" | "feedback" | "question";
type Variant = "default" | "link";

interface SupportFeedbackButtonProps {
  children: ReactNode;
  variant?: Variant;
  defaultCategory?: Category;
  source?: string;
  /** Optional extra classes appended to the variant's base class. */
  className?: string;
  /** Optional aria-label override; defaults to "Open support form". */
  ariaLabel?: string;
  /** data-testid for E2E hooks. */
  testId?: string;
}

const BASE_BY_VARIANT: Record<Variant, string> = {
  link: "underline-offset-2 hover:underline text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm",
  default:
    "inline-flex items-center justify-center rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
};

export function SupportFeedbackButton({
  children,
  variant = "link",
  defaultCategory = "question",
  source,
  className,
  ariaLabel = "Open support form",
  testId,
}: SupportFeedbackButtonProps) {
  const [open, setOpen] = useState(false);
  const base = BASE_BY_VARIANT[variant];
  const cls = className ? `${base} ${className}` : base;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={ariaLabel}
        className={cls}
        data-testid={testId}
      >
        {children}
      </button>
      <SupportFeedbackModal
        open={open}
        onOpenChange={setOpen}
        defaultCategory={defaultCategory}
        source={source}
      />
    </>
  );
}
