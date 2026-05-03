import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useBrandName } from "@/hooks/use-white-label";
import { ReadAloudButton } from "@/components/ReadAloudButton";

type RequiredDisclaimerType = "financial" | "legal" | "ai" | "valuation";

interface RequiredDisclaimerProps {
  type: RequiredDisclaimerType;
  className?: string;
}

function disclaimerFor(type: RequiredDisclaimerType, brand: string): string {
  switch (type) {
    case "financial":
      return `${brand} provides financial tools for informational purposes only. This is not financial, tax, or investment advice. Consult a licensed financial advisor before making investment decisions.`;
    case "legal":
      return `${brand} compliance tools provide automated screening only. This is not legal advice. Always consult a licensed attorney before finalizing transactions.`;
    case "ai":
      return "AI-generated content is for informational purposes only and may contain errors. Always verify AI suggestions independently before acting on them.";
    case "valuation":
      return "AVM estimates are algorithmic approximations, not certified appraisals. Do not use as the sole basis for financial decisions. Obtain a licensed appraisal for material transactions.";
  }
}

export function RequiredDisclaimer({ type, className }: RequiredDisclaimerProps) {
  const brandName = useBrandName();
  const text = disclaimerFor(type, brandName);
  return (
    <div
      data-testid={`required-disclaimer-${type}`}
      className={cn(
        "flex items-center gap-2 rounded-md border border-acr-warn bg-acr-warn-soft px-4 py-2 dark:border-acr-warn dark:bg-acr-warn-soft/30",
        className
      )}
    >
      <AlertTriangle className="w-4 h-4 text-acr-warn dark:text-acr-warn flex-shrink-0" />
      <p className="text-xs text-acr-warn dark:text-acr-warn flex-1">{text}</p>
      <ReadAloudButton
        text={text}
        data-testid={`required-disclaimer-${type}-read-aloud`}
        className="flex-shrink-0"
      />
    </div>
  );
}
