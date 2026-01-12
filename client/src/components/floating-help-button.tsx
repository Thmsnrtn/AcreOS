import { useState, useEffect } from "react";
import { HelpCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { HelpPanel } from "@/components/help/HelpPanel";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function FloatingHelpButton() {
  const [isOpen, setIsOpen] = useState(false);

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
            className="fixed bottom-6 right-6 rounded-full shadow-lg hover:shadow-xl transition-shadow"
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
          <div className="mt-6">
            <HelpPanel />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
