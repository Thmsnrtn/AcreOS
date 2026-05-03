/**
 * Trust Badge — displays org trust tier with visual indicator.
 * Used on marketplace listings, shared deal links, PDFs, and profile pages.
 */

import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Shield, ShieldCheck, Award, Star, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

type TrustTier = "platinum" | "gold" | "silver" | "bronze" | "new";

interface TrustBadgeProps {
  tier: TrustTier;
  score?: number;
  compact?: boolean;
  className?: string;
}

const TIER_CONFIG: Record<TrustTier, {
  label: string;
  icon: typeof Shield;
  color: string;
  bgColor: string;
  borderColor: string;
  description: string;
}> = {
  platinum: {
    label: "Platinum",
    icon: Sparkles,
    color: "text-acr-brand",
    bgColor: "bg-acr-brand-soft",
    borderColor: "border-acr-brand-soft",
    description: "Top-tier investor with exceptional track record",
  },
  gold: {
    label: "Gold",
    icon: Award,
    color: "text-acr-warn",
    bgColor: "bg-acr-warn-soft",
    borderColor: "border-acr-warn-soft",
    description: "Proven investor with strong deal history",
  },
  silver: {
    label: "Silver",
    icon: ShieldCheck,
    color: "text-muted-foreground",
    bgColor: "bg-muted",
    borderColor: "border-border",
    description: "Established investor with verified deals",
  },
  bronze: {
    label: "Bronze",
    icon: Shield,
    color: "text-acr-warn",
    bgColor: "bg-acr-warn-soft",
    borderColor: "border-acr-warn-soft",
    description: "Active investor building their track record",
  },
  new: {
    label: "New",
    icon: Star,
    color: "text-muted-foreground",
    bgColor: "bg-muted",
    borderColor: "border-border",
    description: "New to the AcreOS marketplace",
  },
};

export function TrustBadge({ tier, score, compact, className }: TrustBadgeProps) {
  const config = TIER_CONFIG[tier] || TIER_CONFIG.new;
  const Icon = config.icon;

  if (compact) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={cn("inline-flex items-center gap-1", config.color, className)}>
            <Icon className="h-3.5 w-3.5" />
          </span>
        </TooltipTrigger>
        <TooltipContent>
          <p className="font-medium">{config.label} Trust</p>
          {score != null && <p className="text-xs text-muted-foreground">{score}/1000</p>}
          <p className="text-xs text-muted-foreground">{config.description}</p>
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="outline"
          className={cn(
            "gap-1 font-medium",
            config.bgColor,
            config.borderColor,
            config.color,
            className
          )}
        >
          <Icon className="h-3 w-3" />
          {config.label}
          {score != null && (
            <span className="text-xs opacity-70">({score})</span>
          )}
        </Badge>
      </TooltipTrigger>
      <TooltipContent>
        <p className="font-medium">{config.label} Trust Tier</p>
        {score != null && <p className="text-xs">Trust Score: {score}/1000</p>}
        <p className="text-xs text-muted-foreground max-w-48">{config.description}</p>
      </TooltipContent>
    </Tooltip>
  );
}

// Progress toward next tier
interface TrustProgressProps {
  score: number;
  tier: TrustTier;
  className?: string;
}

const TIER_THRESHOLDS: Record<TrustTier, number> = {
  new: 0,
  bronze: 200,
  silver: 400,
  gold: 600,
  platinum: 800,
};

export function TrustProgress({ score, tier, className }: TrustProgressProps) {
  const tiers: TrustTier[] = ["new", "bronze", "silver", "gold", "platinum"];
  const currentIndex = tiers.indexOf(tier);
  const nextTier = currentIndex < tiers.length - 1 ? tiers[currentIndex + 1] : null;

  if (!nextTier) {
    return (
      <div className={cn("text-sm text-muted-foreground", className)}>
        <span className="text-acr-brand font-medium">Platinum tier achieved</span> — highest trust level
      </div>
    );
  }

  const nextThreshold = TIER_THRESHOLDS[nextTier];
  const currentThreshold = TIER_THRESHOLDS[tier];
  const progress = Math.min(100, ((score - currentThreshold) / (nextThreshold - currentThreshold)) * 100);

  return (
    <div className={cn("space-y-1", className)}>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{TIER_CONFIG[tier].label}</span>
        <span>{TIER_CONFIG[nextTier].label} ({nextThreshold})</span>
      </div>
      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all", TIER_CONFIG[tier].bgColor.replace("50", "400"))}
          style={{ width: `${Math.max(2, progress)}%` }}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        {nextThreshold - score} points to {TIER_CONFIG[nextTier].label}
      </p>
    </div>
  );
}
