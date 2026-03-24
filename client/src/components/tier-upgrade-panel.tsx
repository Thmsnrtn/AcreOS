import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check, X, Sparkles } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

interface TierFeature {
  name: string;
  free: string | boolean;
  starter: string | boolean;
  pro: string | boolean;
}

const LAUNCH_TIERS = [
  {
    id: "free" as const,
    name: "Free",
    price: 0,
    yearlyPrice: 0,
    description: "Explore the platform",
    cta: "Get Started",
    highlighted: false,
  },
  {
    id: "starter" as const,
    name: "Starter",
    price: 20,
    yearlyPrice: 192,
    description: "Replace your spreadsheet",
    cta: "Start Free Trial",
    highlighted: false,
  },
  {
    id: "pro" as const,
    name: "Pro",
    price: 49,
    yearlyPrice: 470,
    description: "For serious operators",
    cta: "Start Free Trial",
    highlighted: true,
  },
];

const FEATURES: TierFeature[] = [
  { name: "Leads", free: "25", starter: "250", pro: "500" },
  { name: "Properties", free: "5", starter: "50", pro: "100" },
  { name: "Notes", free: "3", starter: "25", pro: "50" },
  { name: "AI Requests", free: "50", starter: "500", pro: "1,000" },
  { name: "Campaigns", free: false, starter: "5", pro: "Unlimited" },
  { name: "Sequences", free: false, starter: "2", pro: "Unlimited" },
  { name: "BYOK Data Providers", free: false, starter: false, pro: true },
  { name: "Team Seats", free: "1", starter: "1", pro: "2" },
  { name: "Open Data Sources (18)", free: true, starter: true, pro: true },
];

function FeatureCell({ value }: { value: string | boolean }) {
  if (value === true) return <Check className="h-4 w-4 text-green-500 mx-auto" />;
  if (value === false) return <X className="h-4 w-4 text-muted-foreground/40 mx-auto" />;
  return <span className="text-sm">{value}</span>;
}

interface TierUpgradePanelProps {
  onSelectTier?: (tier: string) => void;
  currentTier?: string;
}

export function TierUpgradePanel({ onSelectTier, currentTier }: TierUpgradePanelProps) {
  const [annual, setAnnual] = useState(false);
  const { user } = useAuth();
  const activeTier = currentTier || "free";

  return (
    <div className="space-y-8">
      {/* Billing toggle */}
      <div className="flex items-center justify-center gap-3">
        <span className={`text-sm ${!annual ? "font-semibold" : "text-muted-foreground"}`}>Monthly</span>
        <button
          onClick={() => setAnnual(!annual)}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
            annual ? "bg-primary" : "bg-muted"
          }`}
        >
          <span
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
          const monthlyEquiv = annual ? Math.round(tier.yearlyPrice / 12) : tier.price;

          return (
            <Card
              key={tier.id}
              className={`relative ${tier.highlighted ? "border-primary shadow-lg ring-1 ring-primary" : ""}`}
            >
              {tier.highlighted && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <Badge className="bg-primary text-primary-foreground">
                    <Sparkles className="h-3 w-3 mr-1" /> Most Popular
                  </Badge>
                </div>
              )}
              <CardHeader className="text-center pb-2">
                <CardTitle className="text-lg">{tier.name}</CardTitle>
                <p className="text-sm text-muted-foreground">{tier.description}</p>
                <div className="mt-4">
                  <span className="text-4xl font-bold">
                    ${tier.price === 0 ? "0" : monthlyEquiv}
                  </span>
                  <span className="text-muted-foreground">/mo</span>
                  {annual && tier.price > 0 && (
                    <p className="text-xs text-muted-foreground mt-1">
                      ${tier.yearlyPrice}/year billed annually
                    </p>
                  )}
                </div>
              </CardHeader>
              <CardContent className="pt-4">
                <Button
                  className="w-full"
                  variant={tier.highlighted ? "default" : "outline"}
                  disabled={isCurrentTier}
                  onClick={() => onSelectTier?.(tier.id)}
                >
                  {isCurrentTier ? "Current Plan" : tier.cta}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Feature comparison table */}
      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="text-left p-3 font-medium">Feature</th>
              {LAUNCH_TIERS.map((t) => (
                <th key={t.id} className="text-center p-3 font-medium">{t.name}</th>
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
