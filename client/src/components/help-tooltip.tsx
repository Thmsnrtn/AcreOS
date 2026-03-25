import { HelpCircle } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const HELP_CONTENT: Record<string, string> = {
  "land-credit-score":
    "Rates this parcel across 6 dimensions: location, physical, legal, financial, environmental, and market. Score of 300–850, like a credit score for dirt. Higher scores mean lower risk and better returns.",
  "70-percent-rule":
    "The 70% rule means you should pay no more than 70% of the after-repair value, minus repair costs. For raw land, this translates to 25–40% of market value depending on the exit strategy.",
  "dodd-frank":
    "The Dodd-Frank Act regulates seller-financed transactions. Key limits include balloon payment restrictions, ability-to-repay requirements, and licensing thresholds when financing more than 3 properties per year.",
  "composite-score":
    "A weighted blend of 4 scores: parcel quality (30%), owner motivation (30%), county opportunity (20%), and land credit (20%). Scores above 80 are strong acquisition candidates.",
  "cap-rate":
    "Capitalization rate = Net Operating Income ÷ Purchase Price × 100. A higher cap rate means higher return but typically higher risk. Land cap rates of 8–12% are common for rural income properties.",
  arv:
    "After Repair Value — the estimated market value of a property after renovations are complete. For raw land, this is the estimated value after entitlement, clearing, or infrastructure improvements.",
  "seller-finance-yield":
    "The annual return earned by holding a seller-financed note to maturity. Accounts for the time value of monthly payments, interest earned, and the original acquisition cost of the property.",
  byok:
    "Bring Your Own Key — use your personal API key from data providers like Regrid or DataTree. Bypasses platform credits and connects directly to your account for unlimited lookups.",
  tcpa:
    "Telephone Consumer Protection Act — regulates telemarketing calls, texts, and faxes. Requires prior express consent for auto-dialed calls/texts. Violations carry $500–$1,500 per call/text penalties.",
};

interface HelpTooltipProps {
  topic: string;
  className?: string;
}

export function HelpTooltip({ topic, className }: HelpTooltipProps) {
  const content = HELP_CONTENT[topic];
  if (!content) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`inline-flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 ${className ?? ""}`}
          aria-label={`Help: ${topic}`}
        >
          <HelpCircle className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="max-w-[280px] text-xs leading-relaxed"
        side="top"
        align="start"
      >
        {content}
      </PopoverContent>
    </Popover>
  );
}
