import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DollarSign } from "lucide-react";

interface CostIndicatorProps {
  costCents: number;
  label?: string;
  showIcon?: boolean;
}

export function CostIndicator({ costCents, label, showIcon = true }: CostIndicatorProps) {
  const costDollars = (costCents / 100).toFixed(2);
  
  const ariaLabel = `Cost: $${costDollars}${label ? ` per ${label}` : " per use"}`;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="outline"
          tabIndex={0}
          role="img"
          aria-label={ariaLabel}
          className="text-xs gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
          data-testid="badge-cost-indicator"
        >
          {showIcon && <DollarSign className="w-3 h-3" aria-hidden="true" />}
          <span className="tabular-nums" aria-hidden="true">${costDollars}</span>
          {label && <span className="text-muted-foreground" aria-hidden="true">/{label}</span>}
        </Badge>
      </TooltipTrigger>
      <TooltipContent>
        <p className="m-0">This action costs <span className="tabular-nums">${costDollars}</span> per use</p>
      </TooltipContent>
    </Tooltip>
  );
}
