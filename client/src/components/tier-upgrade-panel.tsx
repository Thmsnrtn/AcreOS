import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Check, X, Sparkles } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { usd } from "@/lib/format";
import { TIER_PRICES_CENTS } from "@shared/billing/tier-pricing";

export type TierKey = "free" | "starter" | "pro";

interface TierFeature {
  name: string;
  free: string | boolean;
  starter: string | boolean;
  pro: string | boolean;
}

// Marketing labels Starter/Pro map to the canonical solo/operator pricing
// tiers from shared/billing/tier-pricing.ts. Never hardcode tier prices.
const LAUNCH_TIERS = [
  {
    id: "free" as const,
    name: "Free",
    price: 0,
    yearlyPrice: 0,
    description: "Explore the platform",
    cta: "Get started",
    highlighted: false,
  },
  {
    id: "starter" as const,
    name: "Starter",
    price: TIER_PRICES_CENTS.solo.priceMonthlyCents / 100,
    yearlyPrice: TIER_PRICES_CENTS.solo.priceYearlyCents / 100,
    description: "Replace your spreadsheet",
    cta: "Start free trial",
    highlighted: false,
  },
  {
    id: "pro" as const,
    name: "Pro",
    price: TIER_PRICES_CENTS.operator.priceMonthlyCents / 100,
    yearlyPrice: TIER_PRICES_CENTS.operator.priceYearlyCents / 100,
    description: "For serious operators",
    cta: "Start free trial",
    highlighted: true,
  },
];

const FEATURES: TierFeature[] = [
  { name: "Leads", free: "25", starter: "250", pro: "500" },
  { name: "Properties", free: "5", starter: "50", pro: "100" },
  { name: "Notes", free: "3", starter: "25", pro: "50" },
  { name: "AI requests", free: "50", starter: "500", pro: "1,000" },
  { name: "Campaigns", free: false, starter: "5", pro: "Unlimited" },
  { name: "Sequences", free: false, starter: "2", pro: "Unlimited" },
  { name: "BYOK data providers", free: false, starter: false, pro: true },
  { name: "Team seats", free: "1", starter: "1", pro: "2" },
  { name: "Data sources (6 free + 3 premium)", free: true, starter: true, pro: true },
];

function FeatureCell({ value }: { value: string | boolean }) {
  if (value === true) return <Check className="h-4 w-4 text-green-500 mx-auto" aria-label="Included" role="img" />;
  if (value === false) return <X className="h-4 w-4 text-muted-foreground/40 mx-auto" aria-label="Not included" role="img" />;
  return <span className="text-sm">{value}</span>;
}

interface TierUpgradePanelProps {
  onSelectTier?: (tier: string) => void;
  currentTier?: string;
  /**
   * Vesper §3 — when set, this tier card receives a "Recommended" badge
   * and visual emphasis. Used by the cancellation flow to nudge the user
   * toward a downgrade target instead of a full cancel.
   */
  highlightedTier?: TierKey | null;
}

export function TierUpgradePanel({ onSelectTier, currentTier, highlightedTier }: TierUpgradePanelProps) {
  const [annual, setAnnual] = useState(false);
  const { user } = useAuth();
  const activeTier = currentTier || "free";

  return (
    <div className="space-y-8">
      {/* Billing toggle */}
      <div className="flex items-center justify-center gap-3">
        <span className={`text-sm ${!annual ? "font-semibold" : "text-muted-foreground"}`}>Monthly</span>
        <button
          type="button"
          role="switch"
          aria-checked={annual}
          aria-label="Toggle annual billing"
          onClick={() => setAnnual(!annual)}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
            annual ? "bg-primary" : "bg-muted"
          }`}
        >
          <span
            aria-hidden="true"
            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              annual ? "translate-x-6" : "translate-x-1"
            }`}
          />
        </button>
        <span className={`text-sm ${annual ? "font-semibold" : "text-muted-foreground"}`}>
          Annual <Badge variant="secondary" className="ml-1 text-xs">Save 20%</Badge>
        </span>
      </div>

      {/* Tier cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {LAUNCH_TIERS.map((tier) => {
          const isCurrentTier = activeTier === tier.id;
          const isRecommended = highlightedTier === tier.id;
          const showHighlight = isRecommended || (tier.highlighted && !highlightedTier);
          const monthlyEquiv = annual ? Math.round(tier.yearlyPrice / 12) : tier.price;

          return (
            <Card
              key={tier.id}
              className={`relative ${showHighlight ? "border-primary shadow-lg ring-1 ring-primary" : ""}`}
              data-recommended={isRecommended ? "true" : undefined}
            >
              {isRecommended ? (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <Badge className="bg-primary text-primary-foreground">
                    <Sparkles className="h-3 w-3 mr-1" aria-hidden="true" /> Recommended for you
                  </Badge>
                </div>
              ) : tier.highlighted && !highlightedTier && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <Badge className="bg-primary text-primary-foreground">
                    <Sparkles className="h-3 w-3 mr-1" aria-hidden="true" /> Most popular
                  </Badge>
                </div>
              )}
              <CardHeader className="text-center pb-2">
                <CardTitle className="text-lg">{tier.name}</CardTitle>
                <p className="text-sm text-muted-foreground">{tier.description}</p>
                <div className="mt-4">
                  <span className="text-4xl font-bold tabular-nums">
                    {tier.price === 0 ? "$0" : usd(monthlyEquiv, { noCents: true })}
                  </span>
                  <span className="text-muted-foreground">/mo</span>
                  {annual && tier.price > 0 && (
                    <p className="text-xs text-muted-foreground mt-1 tabular-nums">
                      {usd(tier.yearlyPrice, { noCents: true })}/year billed annually
                    </p>
                  )}
                </div>
              </CardHeader>
              <CardContent className="pt-4">
                <Button
                  className="w-full"
                  variant={showHighlight ? "default" : "outline"}
                  disabled={isCurrentTier}
                  onClick={() => onSelectTier?.(tier.id)}
                >
                  {isCurrentTier ? "Current plan" : tier.cta}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Feature comparison table */}
      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-sm" aria-label="Plan feature comparison">
          <thead>
            <tr className="border-b bg-muted/50">
              <th scope="col" className="text-left p-3 font-medium">Feature</th>
              {LAUNCH_TIERS.map((t) => (
                <th scope="col" key={t.id} className="text-center p-3 font-medium">{t.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {FEATURES.map((feat, i) => (
              <tr key={feat.name} className={i % 2 === 0 ? "bg-muted/20" : ""}>
                <td className="p-3 font-medium">{feat.name}</td>
                <td className="p-3 text-center"><FeatureCell value={feat.free} /></td>
                <td className="p-3 text-center"><FeatureCell value={feat.starter} /></td>
                <td className="p-3 text-center"><FeatureCell value={feat.pro} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Scale/Enterprise teaser */}
      <p className="text-center text-sm text-muted-foreground">
        Need more? <span className="font-medium">Scale and Enterprise plans</span> coming soon for high-volume operators.
      </p>
    </div>
  );
}

interface PlanComparisonModalProps {
  open: boolean;
  onClose: () => void;
  currentTier: TierKey;
  /**
   * Vesper §3 — preselect a recommended tier (e.g. when the cancellation
   * flow nudges Empire/Operator users toward a cheaper plan instead of a
   * full cancel).
   */
  highlightedTier?: TierKey | null;
}

export function PlanComparisonModal({ open, onClose, currentTier, highlightedTier }: PlanComparisonModalProps) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{highlightedTier ? "Switch to a lighter plan" : "Compare plans"}</DialogTitle>
          <DialogDescription className="sr-only">
            Compare Free, Starter, and Pro plan features and pricing.
          </DialogDescription>
        </DialogHeader>
        <TierUpgradePanel currentTier={currentTier} highlightedTier={highlightedTier} />
      </DialogContent>
    </Dialog>
  );
}
