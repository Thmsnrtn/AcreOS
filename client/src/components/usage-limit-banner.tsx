import { useQuery } from "@tanstack/react-query";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AlertTriangle, X, ArrowUpRight } from "lucide-react";
import { useState } from "react";
import { Link } from "wouter";

const DISMISS_KEY = "acreos_limit_banner_dismissed";

function isDismissed(): boolean {
  try {
    const stored = localStorage.getItem(DISMISS_KEY);
    if (!stored) return false;
    const { timestamp } = JSON.parse(stored);
    return Date.now() - timestamp < 24 * 60 * 60 * 1000; // 24 hours
  } catch { return false; }
}

type UsageStatus = {
  limits: Array<{
    resource: string;
    current: number;
    limit: number | null;
    percentUsed: number;
    label: string;
  }>;
  tier: string;
};

export function UsageLimitBanner() {
  const [dismissed, setDismissed] = useState(isDismissed);
  const { data } = useQuery<UsageStatus>({
    queryKey: ["/api/usage/status"],
    refetchInterval: 5 * 60 * 1000, // every 5 minutes
  });

  if (dismissed || !data) return null;

  const warnings = data.limits.filter(l => l.limit !== null && l.percentUsed >= 75);
  const critical = warnings.filter(l => l.percentUsed >= 100);
  const approaching = warnings.filter(l => l.percentUsed >= 75 && l.percentUsed < 100);

  if (warnings.length === 0) return null;

  const isCritical = critical.length > 0;
  const topResource = (critical[0] || approaching[0]);

  const handleDismiss = () => {
    localStorage.setItem(DISMISS_KEY, JSON.stringify({ timestamp: Date.now() }));
    setDismissed(true);
  };

  return (
    <Alert
      variant={isCritical ? "destructive" : "default"}
      className={`mx-4 mt-2 ${isCritical ? "border-acr-neg/50 bg-acr-neg/5" : "border-acr-warn/50 bg-acr-warn/5"}`}
      role="alert"
      aria-live={isCritical ? "assertive" : "polite"}
    >
      <AlertTriangle className={`h-4 w-4 ${isCritical ? "text-acr-neg" : "text-acr-warn"}`} aria-hidden="true" />
      <AlertDescription className="flex items-center justify-between gap-4">
        <span className="text-sm">
          {isCritical
            ? `You've reached your ${data.tier} plan limit for ${topResource.label} (${topResource.current}/${topResource.limit}). Upgrade to continue.`
            : `You're using ${topResource.percentUsed}% of your ${topResource.label} limit (${topResource.current}/${topResource.limit}).`
          }
        </span>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Button size="sm" variant={isCritical ? "destructive" : "default"} asChild>
            <Link href="/settings?tab=billing">
              Upgrade <ArrowUpRight className="ml-1 h-3 w-3" aria-hidden="true" />
            </Link>
          </Button>
          {!isCritical && (
            <Button size="sm" variant="ghost" onClick={handleDismiss} aria-label="Dismiss usage warning">
              <X className="h-3 w-3" aria-hidden="true" />
            </Button>
          )}
        </div>
      </AlertDescription>
    </Alert>
  );
}
