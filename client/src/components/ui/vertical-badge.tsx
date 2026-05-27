/**
 * VerticalBadge — shows the current org's detected investor type, plus
 * a click-to-refresh that re-infers from fresh data.
 *
 * Why: the platform auto-detects investor type from usage signals, which
 * means (a) users never see a setup form, and (b) the detection can
 * drift as the org's behavior changes (e.g., a wholesaler starts
 * holding a portfolio of seller-financed notes). Exposing the detected
 * label with a refresh button closes the feedback loop — if the
 * sidebar hides a route the user needs, they can tell AcreOS "re-check
 * what I am" without filing a support ticket.
 *
 * Compact inline pill — drop on /today, Settings → Profile, or the
 * org-switcher popover.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  useContextProfile,
  INVESTOR_LABELS,
  type InvestorType,
} from "@/hooks/use-context-profile";
import { cn } from "@/lib/utils";

interface VerticalBadgeProps {
  className?: string;
  /** Show the refresh button. Default true. */
  refreshable?: boolean;
  /** Pass a custom label override (otherwise uses detected type). */
  overrideLabel?: string;
}

export function VerticalBadge({
  className,
  refreshable = true,
  overrideLabel,
}: VerticalBadgeProps) {
  const { investorType, isLoading } = useContextProfile();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const refresh = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/intelligence/context-profile/refresh", {});
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.setQueryData(["/api/intelligence/context-profile"], data);
      const newLabel = INVESTOR_LABELS[data.profile.investorType as InvestorType] ?? "Investor";
      toast({
        title: "Profile refreshed",
        description: `Detected as ${newLabel}.`,
      });
    },
    onError: (err: Error) => {
      toast({
        title: "Couldn't refresh profile",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  if (isLoading) return null;

  const label = overrideLabel ?? INVESTOR_LABELS[investorType];
  return (
    <div className={cn("inline-flex items-center gap-1", className)}>
      <Badge variant="outline" className="text-caption font-normal">
        {label}
      </Badge>
      {refreshable && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={() => refresh.mutate()}
          disabled={refresh.isPending}
          aria-label="Re-detect investor type"
          title="Re-detect what kind of investor you are based on your recent activity"
        >
          <RefreshCw className={cn("h-3 w-3", refresh.isPending && "animate-spin")} />
        </Button>
      )}
    </div>
  );
}
