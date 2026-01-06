import { useState, useEffect } from "react";
import { X, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type DisclaimerType = "finance" | "ai" | "deals";

interface DisclaimerBannerProps {
  type: DisclaimerType;
  className?: string;
}

const disclaimerMessages: Record<DisclaimerType, string> = {
  finance: "This platform is not a substitute for professional financial, tax, or legal advice. Consult qualified professionals for your specific situation.",
  ai: "AI-generated content is provided for informational purposes only and should not be relied upon as professional advice. Always verify important information.",
  deals: "Deal valuations and projections are estimates only. This platform does not provide real estate, legal, or financial advice. Consult licensed professionals before making investment decisions.",
};

export function DisclaimerBanner({ type, className }: DisclaimerBannerProps) {
  const storageKey = `disclaimer-dismissed-${type}`;
  const [isDismissed, setIsDismissed] = useState(true);

  useEffect(() => {
    const dismissed = localStorage.getItem(storageKey);
    setIsDismissed(dismissed === "true");
  }, [storageKey]);

  const handleDismiss = () => {
    localStorage.setItem(storageKey, "true");
    setIsDismissed(true);
  };

  if (isDismissed) {
    return null;
  }

  return (
    <div
      data-testid={`disclaimer-${type}`}
      className={cn(
        "flex items-start gap-3 rounded-md bg-muted/50 border border-border/50 px-4 py-3",
        className
      )}
    >
      <Info className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
      <p className="text-xs text-muted-foreground flex-1">
        {disclaimerMessages[type]}
      </p>
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 flex-shrink-0 -mr-1 -mt-1"
        onClick={handleDismiss}
        data-testid={`button-dismiss-disclaimer-${type}`}
      >
        <X className="w-3 h-3" />
      </Button>
    </div>
  );
}
