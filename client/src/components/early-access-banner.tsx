import { useState } from "react";
import { X, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
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

  // Feedback dialog state
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [category, setCategory] = useState<string>("");
  const [message, setMessage] = useState("");
  const [allowFollowUp, setAllowFollowUp] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();

  function resetForm() {
    setCategory("");
    setMessage("");
    setAllowFollowUp(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!category) {
      toast({ title: "Please select a category", variant: "destructive" });
      return;
    }
    if (message.trim().length < 10) {
      toast({
        title: "Message too short",
        description: "Please provide at least 10 characters of detail.",
        variant: "destructive",
      });
      return;
    }

    setSubmitting(true);
    try {
      await apiRequest("POST", "/api/feedback", {
        category,
        message: message.trim(),
        allowFollowUp,
      });

      setFeedbackOpen(false);
      resetForm();
      toast({
        title: "Feedback sent",
        description: "Thank you! We read every submission.",
      });
    } catch {
      toast({
        title: "Failed to send feedback",
        description: "Please try again in a moment.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  }

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
      <div className="mx-4 mb-2 rounded-lg border border-primary/20 bg-primary/5 dark:border-primary/15 dark:bg-primary/5 p-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm min-w-0">
          <Sparkles className="h-4 w-4 shrink-0 text-primary/70" aria-hidden="true" />
          <span className="text-foreground/80">
            AcreOS is in early access — your feedback helps us build the right thing.
          </span>
          <button
            type="button"
            onClick={() => setFeedbackOpen(true)}
            className="text-primary hover:text-primary/80 font-medium underline underline-offset-2 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm"
          >
            Send Feedback
          </button>
        </div>
        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground"
          onClick={handleDismiss}
          aria-label="Dismiss early access banner"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      <FeedbackDialog
        open={feedbackOpen}
        onOpenChange={(v) => {
          setFeedbackOpen(v);
          if (!v) resetForm();
        }}
        category={category}
        onCategoryChange={setCategory}
        message={message}
        onMessageChange={setMessage}
        allowFollowUp={allowFollowUp}
        onAllowFollowUpChange={setAllowFollowUp}
        submitting={submitting}
        onSubmit={handleSubmit}
      />
    </>
  );
}
