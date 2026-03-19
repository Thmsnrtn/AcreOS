import { Sparkles } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { usePaxRail, type RailEntityContext } from "@/contexts/pax-rail-context";
import { cn } from "@/lib/utils";

interface PaxContextButtonProps {
  entityType: RailEntityContext["entityType"];
  entityId: number;
  entityName: string;
  starterPrompt?: string;
  className?: string;
}

/**
 * A subtle "Ask Pax" sparkle button that appears on hover.
 * Wire into table rows and cards:
 *   <PaxContextButton entityType="lead" entityId={lead.id} entityName={lead.firstName} />
 */
export function PaxContextButton({
  entityType, entityId, entityName, starterPrompt, className,
}: PaxContextButtonProps) {
  const { openWithContext } = usePaxRail();

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          data-testid={`pax-ctx-${entityType}-${entityId}`}
          className={cn(
            "inline-flex items-center justify-center",
            "w-6 h-6 rounded-md",
            "opacity-0 group-hover:opacity-100 focus:opacity-100",
            "hover:bg-primary/10 transition-all duration-150",
            "text-muted-foreground hover:text-primary",
            className
          )}
          onClick={(e) => {
            e.stopPropagation();
            openWithContext({ entityType, entityId, entityName, starterPrompt });
          }}
        >
          <Sparkles className="w-3 h-3" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="left" className="text-xs">
        Ask Pax about this {entityType}
      </TooltipContent>
    </Tooltip>
  );
}
