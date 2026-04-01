import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Info } from "lucide-react";

interface InfoTooltipProps {
  term: string;
  explanation: string;
  children?: React.ReactNode;
}

export function InfoTooltip({ term, explanation, children }: InfoTooltipProps) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex items-center gap-1 cursor-help">
            {children || term}
            <Info className="h-3.5 w-3.5 text-muted-foreground" aria-label={`Learn about ${term}`} />
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs text-sm">
          <p><strong>{term}:</strong> {explanation}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
