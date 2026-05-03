/**
 * Pax Relationship Arc Indicator — shows current Pax stage + progress.
 * Displayed in Atlas chat header or settings page.
 */

import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Bot, Sprout, Handshake, Crown } from "lucide-react";
import { cn } from "@/lib/utils";

type Stage = "onboarding" | "building" | "trusted" | "partner";

interface RelationshipData {
  stage: Stage;
  progressPercent: number;
  nextStage: Stage | null;
  nextStageRequirements: string[];
  sessionCount: number;
  dealsClosed: number;
  paxInteractions: number;
}

const STAGE_CONFIG: Record<Stage, {
  label: string;
  icon: typeof Bot;
  color: string;
  bgColor: string;
}> = {
  onboarding: { label: "Getting Started", icon: Sprout, color: "text-acr-pos", bgColor: "bg-acr-pos-soft" },
  building: { label: "Building Trust", icon: Bot, color: "text-acr-accent", bgColor: "bg-acr-accent" },
  trusted: { label: "Trusted Advisor", icon: Handshake, color: "text-acr-brand", bgColor: "bg-acr-brand-soft" },
  partner: { label: "Strategic Partner", icon: Crown, color: "text-acr-warn", bgColor: "bg-acr-warn-soft" },
};

interface PaxRelationshipIndicatorProps {
  compact?: boolean;
  className?: string;
}

export function PaxRelationshipIndicator({ compact, className }: PaxRelationshipIndicatorProps) {
  const { data } = useQuery<RelationshipData>({
    queryKey: ["/api/pax/relationship"],
    staleTime: 5 * 60 * 1000,
  });

  if (!data) return null;

  const config = STAGE_CONFIG[data.stage];
  const Icon = config.icon;

  if (compact) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={cn("inline-flex items-center gap-1 text-xs", config.color, className)}>
            <Icon className="h-3.5 w-3.5" />
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-52">
          <p className="font-medium text-sm">{config.label}</p>
          {data.nextStage && (
            <>
              <div className="mt-1.5 h-1 bg-muted rounded-full overflow-hidden">
                <div className={cn("h-full rounded-full", config.bgColor.replace("50", "500"))} style={{ width: `${data.progressPercent}%` }} />
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {data.progressPercent}% to {STAGE_CONFIG[data.nextStage].label}
              </p>
            </>
          )}
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <div className={cn("rounded-lg border p-3 space-y-2", className)}>
      <div className="flex items-center gap-2">
        <div className={cn("p-1.5 rounded-md", config.bgColor)}>
          <Icon className={cn("h-4 w-4", config.color)} />
        </div>
        <div>
          <p className="text-sm font-medium">{config.label}</p>
          <p className="text-xs text-muted-foreground">
            {data.sessionCount} sessions · {data.dealsClosed} deals · {data.paxInteractions} interactions
          </p>
        </div>
      </div>
      {data.nextStage && (
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{config.label}</span>
            <span>{STAGE_CONFIG[data.nextStage].label}</span>
          </div>
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className={cn("h-full rounded-full transition-all", config.bgColor.replace("50", "400"))}
              style={{ width: `${Math.max(3, data.progressPercent)}%` }}
            />
          </div>
          {data.nextStageRequirements.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Next: {data.nextStageRequirements[0]}
            </p>
          )}
        </div>
      )}
      {data.stage === "partner" && (
        <Badge variant="outline" className="text-xs text-acr-warn border-acr-warn-soft bg-acr-warn-soft">
          Highest level reached
        </Badge>
      )}
    </div>
  );
}
