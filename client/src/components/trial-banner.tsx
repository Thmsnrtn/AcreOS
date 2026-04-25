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
        className="mx-4 mb-2 rounded-lg border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/50 p-3 flex items-center justify-between"
      >
        <div className="flex items-center gap-2 text-sm">
          <Sparkles className="h-4 w-4 text-blue-600 dark:text-blue-400" aria-hidden="true" />
          <span className="text-blue-800 dark:text-blue-200">
            Try Starter or Pro free for 14 days
          </span>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs border-blue-300 text-blue-700 hover:bg-blue-100 dark:border-blue-700 dark:text-blue-300"
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
        className={`mx-4 mb-2 rounded-lg border p-3 flex items-center justify-between ${
          urgent
            ? "border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/50"
            : "border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/50"
        }`}
      >
        <div className="flex items-center gap-2 text-sm">
          <Clock
            className={`h-4 w-4 ${urgent ? "text-amber-600 dark:text-amber-400" : "text-green-600 dark:text-green-400"}`}
            aria-hidden="true"
          />
          <span className={urgent ? "text-amber-800 dark:text-amber-200" : "text-green-800 dark:text-green-200"}>
            {trial.daysRemaining} day{trial.daysRemaining !== 1 ? "s" : ""} left in your free trial
          </span>
          {urgent && (
            <Badge variant="outline" className="text-xs border-amber-400 text-amber-700 dark:text-amber-300">
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
