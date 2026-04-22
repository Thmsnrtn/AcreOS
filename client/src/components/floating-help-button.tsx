import { useState, useEffect } from "react";
import { Link } from "wouter";
import { HelpCircle, MessageSquarePlus, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { HelpPanel } from "@/components/help/HelpPanel";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { FeedbackDialog } from "@/components/feedback-button";

export function FloatingHelpButton() {
  const [isOpen, setIsOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  // Handle Cmd+? (or Ctrl+? on Windows) to open help
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Check for Cmd+? (Mac) or Ctrl+? (Windows/Linux)
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "?") {
        e.preventDefault();
        setIsOpen(true);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => setIsOpen(true)}
            className="fixed bottom-[232px] md:bottom-[176px] right-4 md:right-16 z-[48] rounded-full shadow-lg hover:shadow-xl transition-shadow safe-area-bottom bg-background border"
            data-testid="button-floating-help"
            aria-label="Open help panel"
          >
            <HelpCircle className="w-5 h-5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="left">
          <p>Help (⌘?)</p>
        </TooltipContent>
      </Tooltip>

      <Sheet open={isOpen} onOpenChange={setIsOpen}>
        <SheetContent side="right" className="w-full sm:w-96 sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <HelpCircle className="w-5 h-5" />
              Help
            </SheetTitle>
          </SheetHeader>
          <div className="mt-6 space-y-6">
            <HelpPanel />

            {/* Help surface consolidation: feedback is now inside the
                help sheet (one discovery path for support-adjacent
                actions), with a link to the full /help center below. */}
            <div className="border-t pt-4 space-y-2">
              <Button
                variant="outline"
                className="w-full justify-start"
                onClick={() => {
                  setIsOpen(false);
                  setFeedbackOpen(true);
                }}
                data-testid="button-help-feedback"
              >
                <MessageSquarePlus className="w-4 h-4 mr-2" />
                Send feedback
              </Button>
              <Button
                variant="ghost"
                className="w-full justify-start"
                asChild
              >
                <Link href="/help" onClick={() => setIsOpen(false)}>
                  <ExternalLink className="w-4 h-4 mr-2" />
                  Open full help center
                </Link>
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Feedback dialog — reused from FeedbackButton component so
          the submission form stays DRY. */}
      <FeedbackDialog open={feedbackOpen} onOpenChange={setFeedbackOpen} />
    </>
  );
}
