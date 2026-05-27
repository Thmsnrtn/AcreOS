import { useQuery } from "@tanstack/react-query";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AlertTriangle, X, ArrowUpRight } from "lucide-react";
import { useState } from "react";
import { Link } from "wouter";
import { usd } from "@/lib/format";
import {
  TIER_LIMITS,
  nextPaidTier,
  type ResourceType,
} from "@shared/billing/tier-limits";
import { TIER_PRICES_CENTS, type Tier } from "@shared/billing/tier-pricing";

const DISMISS_KEY = "acreos_limit_banner_dismissed";

function isDismissed(): boolean {
  try {
    const stored = localStorage.getItem(DISMISS_KEY);
    if (!stored) return false;
    const { timestamp } = JSON.parse(stored);
    return Date.now() - timestamp < 24 * 60 * 60 * 1000; // 24 hours
  } catch { return false; }
}

type UsageLimitRow = {
  resource: string;
  current: number;
  limit: number | null;
  percentUsed: number;
  label: string;
};

type UsageStatus = {
  limits: UsageLimitRow[];
  tier: string;
};

function tierDisplay(tier: string | null | undefined): string {
  if (!tier) return "current plan";
  return tier.charAt(0).toUpperCase() + tier.slice(1);
}

function formatLimitNumber(value: number | null | undefined): string {
  if (value == null) return "unlimited";
  return value.toLocaleString("en-US");
}

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

  // Lens 3 (Pricing Coherence): the banner quotes the same diff the 429 toast
  // does — "Upgrade to Pro for 500 leads (vs. your 50 cap) at $49/mo" — so a
  // user who clicks Upgrade isn't surprised by the upsell math.
  const nextTier = nextPaidTier(data.tier);
  const resourceKey = topResource.resource as ResourceType;
  const knownResource = resourceKey in TIER_LIMITS.free;
  const nextLimit: number | null | undefined =
    nextTier && knownResource
      ? ((TIER_LIMITS[nextTier] as Record<string, unknown>)[resourceKey] as number | null)
      : undefined;
  const nextPricing =
    nextTier && nextTier !== "free" && nextTier !== "enterprise"
      ? TIER_PRICES_CENTS[nextTier as Tier]
      : null;

  const currentTierName = tierDisplay(data.tier);
  const nextTierName = nextTier ? tierDisplay(nextTier) : null;
  const upgradeUrl = nextTier
    ? `/pricing#${nextTier}`
    : "/settings?tab=billing";

  const handleDismiss = () => {
    localStorage.setItem(DISMISS_KEY, JSON.stringify({ timestamp: Date.now() }));
    setDismissed(true);
  };

  let message: string;
  if (isCritical) {
    if (nextTierName && nextPricing && nextLimit !== undefined) {
      message =
        `You've maxed out your ${currentTierName} ${topResource.label.toLowerCase()} ` +
        `(${topResource.current.toLocaleString("en-US")}/${formatLimitNumber(topResource.limit)}). ` +
        `Upgrade to ${nextTierName} for ${formatLimitNumber(nextLimit)} ` +
        `(vs. your ${formatLimitNumber(topResource.limit)} cap) at ` +
        `${usd(nextPricing.priceMonthlyCents / 100, { noCents: true })}/mo.`;
    } else {
      message =
        `You've reached your ${currentTierName} plan limit for ${topResource.label} ` +
        `(${topResource.current}/${topResource.limit}). Upgrade to continue.`;
    }
  } else {
    // 75–99% — show diff context so the user understands the trade-off.
    if (nextTierName && nextPricing && nextLimit !== undefined) {
      message =
        `You're using ${topResource.percentUsed}% of your ${currentTierName} ` +
        `${topResource.label.toLowerCase()} cap ` +
        `(${topResource.current.toLocaleString("en-US")}/${formatLimitNumber(topResource.limit)}). ` +
        `${nextTierName} unlocks ${formatLimitNumber(nextLimit)} at ` +
        `${usd(nextPricing.priceMonthlyCents / 100, { noCents: true })}/mo.`;
    } else {
      message =
        `You're using ${topResource.percentUsed}% of your ${topResource.label} limit ` +
        `(${topResource.current}/${topResource.limit}).`;
    }
  }

  return (
    <Alert
      variant={isCritical ? "destructive" : "default"}
      className={`mx-4 mt-2 ${isCritical ? "border-acr-neg/50 bg-acr-neg/5" : "border-acr-warn/50 bg-acr-warn/5"}`}
      role="alert"
      aria-live={isCritical ? "assertive" : "polite"}
    >
      <AlertTriangle className={`h-4 w-4 ${isCritical ? "text-acr-neg" : "text-acr-warn"}`} aria-hidden="true" />
      <AlertDescription className="flex items-center justify-between gap-4">
        <span className="text-sm">{message}</span>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Button size="sm" variant={isCritical ? "destructive" : "default"} asChild>
            <Link href={upgradeUrl}>
              {nextTierName ? `Upgrade to ${nextTierName}` : "Upgrade"}
              <ArrowUpRight className="ml-1 h-3 w-3" aria-hidden="true" />
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

