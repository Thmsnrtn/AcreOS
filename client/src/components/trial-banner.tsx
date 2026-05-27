import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Clock, Sparkles } from "lucide-react";

interface TrialStatus {
  isTrialing: boolean;
  daysRemaining: number;
  trialEndsAt: string | null;
  eligible: boolean;
}

export function TrialBanner() {
  const [, setLocation] = useLocation();
  const { data: trial } = useQuery<TrialStatus>({
    queryKey: ["/api/trial/status"],
    refetchInterval: 60_000,
  });

  if (!trial) return null;

  if (trial.eligible) {
    return (
      <aside
        aria-label="Free trial available"
        className="mx-4 mb-2 rounded-card border border-acr-accent bg-acr-accent dark:border-acr-accent dark:bg-acr-accent/50 p-3 flex items-center justify-between"
      >
        <div className="flex items-center gap-2 text-sm">
          <Sparkles className="h-4 w-4 text-acr-accent dark:text-acr-accent" aria-hidden="true" />
          <span className="text-acr-accent dark:text-acr-accent">
            Try Starter or Pro free for 14 days
          </span>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs border-acr-accent text-acr-accent hover:bg-acr-accent dark:border-acr-accent dark:text-acr-accent"
          onClick={() => setLocation("/settings?tab=billing")}
        >
          Start trial
        </Button>
      </aside>
    );
  }

  if (trial.isTrialing && trial.daysRemaining > 0) {
    const urgent = trial.daysRemaining <= 3;
    return (
      <aside
        aria-label={`Free trial — ${trial.daysRemaining} day${trial.daysRemaining !== 1 ? "s" : ""} remaining`}
        className={`mx-4 mb-2 rounded-card border p-3 flex items-center justify-between ${
          urgent
            ? "border-acr-warn bg-acr-warn-soft dark:border-acr-warn dark:bg-acr-warn-soft/50"
            : "border-acr-pos-soft bg-acr-pos-soft dark:border-acr-pos-soft dark:bg-acr-pos-soft/50"
        }`}
      >
        <div className="flex items-center gap-2 text-sm">
          <Clock
            className={`h-4 w-4 ${urgent ? "text-acr-warn dark:text-acr-warn" : "text-acr-pos dark:text-acr-pos"}`}
            aria-hidden="true"
          />
          <span className={urgent ? "text-acr-warn dark:text-acr-warn" : "text-acr-pos dark:text-acr-pos"}>
            {trial.daysRemaining} day{trial.daysRemaining !== 1 ? "s" : ""} left in your free trial
          </span>
          {urgent && (
            <Badge variant="outline" className="text-xs border-acr-warn text-acr-warn dark:text-acr-warn">
              Expiring soon
            </Badge>
          )}
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          onClick={() => setLocation("/settings?tab=billing")}
        >
          Upgrade now
        </Button>
      </aside>
    );
  }

  return null;
}
