import { useState } from "react";
import { X, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FeedbackDialog } from "@/components/feedback-button";

const DISMISS_KEY = "acreos_ea_banner_dismissed_v1";

export function EarlyAccessBanner() {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === "true";
    } catch {
      return false;
    }
  });

  const [feedbackOpen, setFeedbackOpen] = useState(false);

  function handleDismiss() {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, "true");
    } catch {
      // localStorage unavailable
    }
  }

  if (dismissed) return null;

  return (
    <>
      <div className="mx-4 mb-2 rounded-card border border-primary/20 bg-primary/5 dark:border-primary/15 dark:bg-primary/5 py-2 pl-3 pr-1 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs sm:text-sm min-w-0">
          <Sparkles className="h-4 w-4 shrink-0 text-primary/70" aria-hidden="true" />
          <span className="text-foreground/80 truncate sm:whitespace-normal">
            Early access — your feedback shapes AcreOS.
          </span>
          {/* 44px touch target via padding + negative margin so the banner
              doesn't grow; active: companion gives iOS real press feedback. */}
          <button
            type="button"
            onClick={() => setFeedbackOpen(true)}
            className="inline-flex min-h-11 items-center px-2 -mx-2 -my-3.5 text-primary hover:text-primary/80 active:text-primary/70 font-medium underline underline-offset-2 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm"
          >
            Send Feedback
          </button>
        </div>
        {/* 44px touch target (a11y) with a small visible glyph. */}
        <Button
          size="icon"
          variant="ghost"
          className="h-11 w-11 shrink-0 text-muted-foreground hover:text-foreground active:text-foreground"
          onClick={handleDismiss}
          aria-label="Dismiss early access banner"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      <FeedbackDialog open={feedbackOpen} onOpenChange={setFeedbackOpen} />
    </>
  );
}
