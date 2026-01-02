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
  
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge 
          variant="outline" 
          className="text-xs gap-1"
          data-testid="badge-cost-indicator"
        >
          {showIcon && <DollarSign className="w-3 h-3" />}
          ${costDollars}
          {label && <span className="text-muted-foreground">/{label}</span>}
        </Badge>
      </TooltipTrigger>
      <TooltipContent>
        <p>This action costs ${costDollars} per use</p>
      </TooltipContent>
    </Tooltip>
  );
}
