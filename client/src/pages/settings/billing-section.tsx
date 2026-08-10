/**
 * Settings → Billing & plan — routed section (Wave 1.5, P2 §1).
 *
 * Content moved intact from the settings.tsx monolith's Account + Billing
 * tabs: current plan/subscription card, seats, usage & limits, credits,
 * pricing guide, the plans grid (WS1: every server upgradeUrl deep-links
 * here), and Stripe Connect. Legacy deep links land here via the shell's
 * legacy resolution: /settings#billing → /settings/billing, and the
 * upgrade-toast/dunning form /settings#billing?tier=pro arrives as a REAL
 * ?tier= query which auto-opens the plan comparison with that tier
 * highlighted (the monolith's applyBillingIntent, minus the hash parsing).
 */
import {
  useOrganization,
  useStripeProducts,
  useStripeSubscription,
  useCreateCheckoutSession,
  useCreatePortalSession,
  useUsageLimits,
} from "@/hooks/use-organization";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  Building2,
  Crown,
  Check,
  ExternalLink,
  CreditCard,
  Loader2,
  BarChart3,
  Users,
  Home,
  FileText,
  Sparkles,
  TrendingUp,
  Coins,
  Gift,
  XCircle,
} from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { trackEvent } from "@/lib/analytics";
import { QueryErrorState } from "@/components/query-error-state";
import { EmptyState } from "@/components/empty-state";
import { UsageDashboard } from "@/components/usage-dashboard";
import { PricingGuide } from "@/components/pricing-guide";
import { SeatManagement, StripeConnectSettings } from "@/pages/settings/billing-sections";
import { PlanComparisonModal, type TierKey } from "@/components/tier-upgrade-panel";
import { CancellationDialog } from "@/components/cancellation-dialog";
import { useEffect, useState } from "react";
import { useSearch } from "wouter";
import { formatDate } from "@/lib/format";
import { Verbs } from "@/lib/labels";

export default function BillingSection() {
  const { toast } = useToast();
  const search = useSearch();
  const searchParams = new URLSearchParams(search);
  const [showPlanComparison, setShowPlanComparison] = useState(false);
  const [planPickerHighlight, setPlanPickerHighlight] = useState<TierKey | null>(null);
  const [showCancelDialog, setShowCancelDialog] = useState(false);

  // Every query on this page surfaces failure with a retry — Settings is a
  // fixed top-bar door and must never silently fail (T3 census W1-2).
  const { data: organization, isLoading: orgLoading, isError: orgError, error: orgErrorObj, refetch: refetchOrg, isRefetching: orgRefetching } = useOrganization();
  const { data: products, isLoading: productsLoading, isError: productsError, error: productsErrorObj, refetch: refetchProducts, isRefetching: productsRefetching } = useStripeProducts();
  const { data: subscriptionData, isLoading: subLoading, isError: subError, error: subErrorObj, refetch: refetchSub, isRefetching: subRefetching } = useStripeSubscription();
  const { data: usageData, isLoading: usageLoading, isError: usageError, error: usageErrorObj, refetch: refetchUsage, isRefetching: usageRefetching } = useUsageLimits();

  const checkoutMutation = useCreateCheckoutSession();
  const portalMutation = useCreatePortalSession();

  // The upgrade-toast/dunning deep link used to be `/settings#billing?tier=pro`
  // (tier riding inside the hash). The shell's legacy resolution promotes it
  // to a real query — /settings/billing?tier=pro — read once on arrival.
  useEffect(() => {
    const tierRaw = searchParams.get("tier");
    const tier: TierKey | null =
      tierRaw === "free" || tierRaw === "starter" || tierRaw === "pro" || tierRaw === "scale"
        ? tierRaw
        : null;
    if (tier) {
      setPlanPickerHighlight(tier);
      setShowPlanComparison(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const subscriptionStatus = searchParams.get("subscription");
    if (subscriptionStatus === "success") {
      toast({
        title: "Subscription activated!",
        description: "Your subscription has been successfully activated.",
      });
      // Tier 2C — `trial_to_paid` is no longer a client event. The
      // Stripe webhook (webhookHandlers.ts) records the server-truth
      // activation_event where the money actually moves; the redirect
      // back here can be lost (closed tab, ad-blocker, flaky network)
      // and was never a reliable witness. This supplemental event keeps
      // the checkout-return moment visible in PostHog for UX analysis.
      trackEvent("stripe_checkout_return", {
        surface: "stripe_checkout_return",
      });
    } else if (subscriptionStatus === "cancelled") {
      toast({
        title: "Checkout cancelled",
        description: "You can upgrade anytime from the settings page.",
        variant: "destructive",
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, toast]);

  const handleUpgrade = async (priceId: string) => {
    try {
      const result = await checkoutMutation.mutateAsync(priceId);
      if (result.url) {
        window.location.href = result.url;
      }
    } catch (error: any) {
      toast({
        title: "Couldn't start checkout",
        description: error?.message || "Check your connection and try again — your plan wasn't changed.",
        variant: "destructive",
      });
    }
  };

  const handleManageSubscription = async () => {
    try {
      const result = await portalMutation.mutateAsync();
      if (result.url) {
        window.location.href = result.url;
      }
    } catch (error: any) {
      toast({
        title: "Couldn't open the billing portal",
        description: error?.message || "Check your connection and try again.",
        variant: "destructive",
      });
    }
  };

  const getTierColor = (tier: string) => {
    switch (tier) {
      // Pro is the recommended tier — use the theme primary so "Pro"
      // reads as on-brand rather than an off-theme lavender accent.
      case "pro":     return "bg-primary/10 text-primary border-primary/20";
      case "scale":   return "bg-acr-warn/10 text-acr-warn border-acr-warn/20";
      case "starter": return "bg-acr-accent/10 text-acr-accent border-acr-accent/20";
      default:        return "bg-muted text-muted-foreground border-border";
    }
  };

  const formatPrice = (amount: number, currency: string) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency.toUpperCase(),
      minimumFractionDigits: 0,
    }).format(amount / 100);
  };

  const isCurrentTier = (productName: string) => {
    if (!organization) return false;
    return productName.toLowerCase().includes(organization.subscriptionTier.toLowerCase());
  };

  return (
    <div className="space-y-8" data-testid="settings-section-billing">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="w-5 h-5" aria-hidden="true" />
            Organization details
          </CardTitle>
          <CardDescription>Your organization information and current plan.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {orgLoading ? (
            <div className="space-y-3" aria-busy="true">
              <Skeleton className="h-6 w-48" announceText="Loading organization details" />
              <Skeleton className="h-4 w-32" announce={false} />
              <Skeleton className="h-4 w-40" announce={false} />
            </div>
          ) : orgError ? (
            <QueryErrorState
              error={orgErrorObj as Error}
              onRetry={() => refetchOrg()}
              isRetrying={orgRefetching}
              compact
              title="Couldn't load your organization"
              description="Your organization and plan are unchanged — this is just a display issue."
              testId="error-organization"
            />
          ) : organization && (
            <>
              <div className="flex flex-col gap-1">
                <span className="text-sm text-muted-foreground">Organization name</span>
                <span className="text-lg font-medium" data-testid="text-org-name">
                  {organization.name}
                </span>
              </div>

              <div className="flex flex-col gap-1">
                <span className="text-sm text-muted-foreground">Subscription tier</span>
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge
                    variant="outline"
                    className={`${organization.isFounder ? 'bg-gradient-to-r from-primary to-accent text-white border-primary' : getTierColor(organization.subscriptionTier)}`}
                    data-testid="badge-current-tier"
                  >
                    <Crown className="w-3 h-3 mr-1" aria-hidden="true" />
                    {organization.isFounder ? 'Enterprise (Founder)' : organization.subscriptionTier.charAt(0).toUpperCase() + organization.subscriptionTier.slice(1)}
                  </Badge>
                  {organization.isFounder && (
                    <Badge variant="outline" className="bg-gradient-to-r from-acr-warn to-acr-warn text-white border-acr-warn" data-testid="badge-unlimited">
                      Unlimited
                    </Badge>
                  )}
                  <Badge variant="outline" data-testid="badge-subscription-status">
                    {organization.subscriptionStatus}
                  </Badge>
                </div>
              </div>

              {subLoading ? (
                <Skeleton className="h-10 w-48" announceText="Loading subscription details" />
              ) : subError ? (
                <QueryErrorState
                  error={subErrorObj as Error}
                  onRetry={() => refetchSub()}
                  isRetrying={subRefetching}
                  compact
                  title="Couldn't load your subscription"
                  description="Your plan and billing are unchanged — this is just a display issue."
                  testId="error-subscription"
                />
              ) : subscriptionData?.subscription ? (
                <div className="flex flex-col gap-2 pt-2">
                  <span className="text-sm text-muted-foreground">Current period</span>
                  <span className="text-sm tabular-nums" data-testid="text-subscription-period">
                    {formatDate(subscriptionData.subscription.current_period_start * 1000)} &ndash; {formatDate(subscriptionData.subscription.current_period_end * 1000)}
                  </span>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      className="min-h-11 pointer-fine:sm:min-h-9"
                      onClick={handleManageSubscription}
                      disabled={portalMutation.isPending}
                      data-testid="button-manage-subscription"
                    >
                      {portalMutation.isPending ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />
                      ) : (
                        <CreditCard className="w-4 h-4 mr-2" aria-hidden="true" />
                      )}
                      Manage subscription
                      <ExternalLink className="w-3 h-3 ml-2" aria-hidden="true" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="min-h-11 pointer-fine:sm:min-h-9 text-muted-foreground hover:text-destructive active:text-destructive"
                      onClick={() => setShowCancelDialog(true)}
                      aria-label="Cancel subscription"
                    >
                      <XCircle className="w-4 h-4 mr-1" aria-hidden="true" />
                      {Verbs.CANCEL}
                    </Button>
                  </div>
                  <CancellationDialog
                    open={showCancelDialog}
                    onOpenChange={setShowCancelDialog}
                    currentTier={organization.subscriptionTier || "free"}
                    // Vesper §3 — wire "Downgrade instead" to the
                    // plan picker preselected to a lower tier.
                    // Canonical Tier (starter/pro/scale) maps to
                    // the modal's TierKey (free/starter/pro/scale).
                    onDowngrade={(suggested) => {
                      const modalTier: TierKey =
                        suggested === "scale" ? "scale"
                          : suggested === "pro" ? "pro"
                          : suggested === "starter" ? "starter"
                          : "starter";
                      setPlanPickerHighlight(modalTier);
                      setShowPlanComparison(true);
                    }}
                  />
                </div>
              ) : organization.subscriptionTier === "free" && (
                <div className="space-y-3">
                  {!organization.trialUsed && (
                    <div className="flex items-start gap-3 p-4 rounded-md bg-acr-pos/10 border border-acr-pos/20">
                      <Gift className="w-5 h-5 text-acr-pos mt-0.5 flex-shrink-0" aria-hidden="true" />
                      <div>
                        <p className="font-medium text-acr-pos" data-testid="text-trial-available">
                          7-day free trial available
                        </p>
                        <p className="text-sm text-muted-foreground mt-1">
                          Start your subscription with a 7-day free trial. No charge until the trial ends.
                        </p>
                      </div>
                    </div>
                  )}
                  <p className="text-sm text-muted-foreground">
                    {organization.trialUsed
                      ? "Upgrade below to unlock more features!"
                      : "Select a plan below to start your free trial."}
                  </p>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <SeatManagement />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="w-5 h-5" aria-hidden="true" />
            Usage and limits
          </CardTitle>
          <CardDescription>Track your resource usage against your plan limits.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {usageLoading ? (
            <div className="space-y-4">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="space-y-2">
                  <Skeleton className="h-4 w-24" announce={i === 1} announceText="Loading usage and limits" />
                  <Skeleton className="h-2 w-full" announce={false} />
                </div>
              ))}
            </div>
          ) : usageError ? (
            <QueryErrorState
              error={usageErrorObj as Error}
              onRetry={() => refetchUsage()}
              isRetrying={usageRefetching}
              compact
              title="Couldn't load usage data"
              description="Your limits and usage are unaffected — this is just a display issue."
              testId="error-usage-limits"
            />
          ) : usageData && (
            <>
              {(() => {
                const usageItems = [
                  { key: "leads" as const, label: "Leads", icon: Users, description: "Total leads in your CRM" },
                  { key: "properties" as const, label: "Properties", icon: Home, description: "Properties in your inventory" },
                  { key: "notes" as const, label: "Notes", icon: FileText, description: "Active seller-finance notes" },
                  { key: "ai_requests" as const, label: "Pax messages", icon: Sparkles, description: "Monthly Pax message turns (resets on the 1st)" },
                ];

                const nearLimitItems = usageItems.filter(item => {
                  const usage = usageData.usage[item.key];
                  return usage.percentage !== null && usage.percentage >= 80;
                });

                return (
                  <>
                    {nearLimitItems.length > 0 && usageData.tier !== "enterprise" && (
                      <div
                        className="flex items-start gap-3 p-4 rounded-md bg-acr-warn/10 border border-acr-warn/20 mb-4"
                        role="status"
                        aria-live="polite"
                      >
                        <TrendingUp className="w-5 h-5 text-acr-warn mt-0.5 flex-shrink-0" aria-hidden="true" />
                        <div>
                          <p className="font-medium text-acr-warn">
                            You're approaching your limits
                          </p>
                          <p className="text-sm text-muted-foreground mt-1">
                            You've used 80%+ of your {nearLimitItems.map(i => i.label.toLowerCase()).join(", ")} allowance.
                            Upgrade your plan to unlock higher limits.
                          </p>
                          <Button
                            size="sm"
                            className="mt-2 min-h-11 pointer-fine:sm:min-h-9"
                            onClick={() => {
                              // Plans live further down THIS section now — scroll, no tab switch.
                              document.getElementById("pricing-section")?.scrollIntoView({ behavior: "smooth" });
                            }}
                            data-testid="button-upgrade-from-usage"
                          >
                            <Crown className="w-4 h-4 mr-2" aria-hidden="true" />
                            View upgrade options
                          </Button>
                        </div>
                      </div>
                    )}

                    <div className="grid gap-4">
                      {usageItems.map((item) => {
                        const usage = usageData.usage[item.key];
                        const IconComponent = item.icon;
                        const isUnlimited = usage.limit === null;
                        const percentage = usage.percentage ?? 0;
                        const isNearLimit = percentage >= 80;
                        const isAtLimit = percentage >= 100;

                        return (
                          <div key={item.key} className="space-y-2" data-testid={`usage-item-${item.key}`}>
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2">
                                <IconComponent className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
                                <span className="font-medium">{item.label}</span>
                              </div>
                              <span className="text-sm tabular-nums" data-testid={`text-usage-${item.key}`}>
                                {usage.current.toLocaleString()}
                                {!isUnlimited && (
                                  <span className="text-muted-foreground"> / {usage.limit?.toLocaleString()}</span>
                                )}
                                {isUnlimited && (
                                  <span className="text-muted-foreground"> (unlimited)</span>
                                )}
                              </span>
                            </div>
                            {!isUnlimited && (
                              <Progress
                                value={Math.min(percentage, 100)}
                                className={`h-2 ${isAtLimit ? "[&>div]:bg-acr-neg" : isNearLimit ? "[&>div]:bg-acr-warn" : ""}`}
                                aria-label={`${item.label} usage: ${usage.current} of ${usage.limit} (${Math.round(percentage)}%)`}
                              />
                            )}
                            <p className="text-xs text-muted-foreground">{item.description}</p>
                          </div>
                        );
                      })}
                    </div>
                  </>
                );
              })()}
            </>
          )}
        </CardContent>
      </Card>

      <div className="space-y-4">
        <div>
          <h2 className="text-section-h2 flex items-center gap-2">
            <Coins className="w-5 h-5" />
            Usage &amp; Credits
          </h2>
          <p className="text-muted-foreground text-sm">
            Track your credit balance, usage history, and purchase more credits.
          </p>
        </div>
        <UsageDashboard />
      </div>

      <div className="space-y-4" data-testid="section-pricing-guide">
        <div>
          <h2 className="text-section-h2">Pricing Guide</h2>
          <p className="text-muted-foreground text-sm">
            View pricing details for all billable actions before you use them.
          </p>
        </div>
        <PricingGuide />
      </div>

      {/* Plans + upgrade grid — moved here from the Account tab (WS1,
          2026-07-07): every server upgradeUrl deep-links to the billing
          surface, but the tab named Billing only held Stripe Connect, so
          customers looking to upgrade found no plans. */}
      <div id="pricing-section" className="space-y-4">
        <h2 className="text-section-h2">Available Plans</h2>

        {productsLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <Card key={i}>
                <CardContent className="pt-6 space-y-4">
                  <Skeleton className="h-6 w-24" announce={i === 1} announceText="Loading available plans" />
                  <Skeleton className="h-8 w-20" announce={false} />
                  <Skeleton className="h-4 w-full" announce={false} />
                  <Skeleton className="h-10 w-full" announce={false} />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : productsError ? (
          <Card>
            <CardContent className="py-6">
              <QueryErrorState
                error={productsErrorObj as Error}
                onRetry={() => refetchProducts()}
                isRetrying={productsRefetching}
                compact
                title="Couldn't load plans"
                description="Your current subscription is unaffected — this is just a display issue."
                testId="error-available-plans"
              />
            </CardContent>
          </Card>
        ) : products && products.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {products
              .filter(p => p.active && p.prices.length > 0)
              // Only the 3 base tier cards (Starter / Pro / Scale).
              // Seat add-ons + vertical packs come from the same
              // /api/stripe/products endpoint but are managed via
              // the seats UI + per-vertical pack picker (Phase 5
              // §5). Tagging convention: metadata.tier is
              // starter|pro|scale on base tiers; seat-addons carry
              // metadata.type=seat_addon; packs carry
              // metadata.type=vertical_pack.
              .filter(p => {
                const tier = p.metadata?.tier;
                const type = p.metadata?.type;
                return (tier === "starter" || tier === "pro" || tier === "scale") && !type;
              })
              .sort((a, b) => {
                const order: Record<string, number> = { starter: 0, pro: 1, scale: 2 };
                return (order[a.metadata?.tier ?? ""] ?? 99) - (order[b.metadata?.tier ?? ""] ?? 99);
              })
              .map((product) => {
                const price = product.prices.find(p => p.active && p.recurring);
                const isCurrent = isCurrentTier(product.name);

                return (
                  <Card
                    key={product.id}
                    className={isCurrent ? "border-primary" : ""}
                    data-testid={`card-plan-${product.id}`}
                  >
                    <CardHeader>
                      <CardTitle className="flex items-center justify-between gap-2 flex-wrap">
                        {product.name}
                        {isCurrent && (
                          <Badge variant="default" className="text-xs">Current</Badge>
                        )}
                      </CardTitle>
                      {price && (
                        <div className="text-2xl font-bold">
                          {formatPrice(price.unit_amount, price.currency)}
                          <span className="text-sm font-normal text-muted-foreground">
                            /{price.recurring?.interval}
                          </span>
                        </div>
                      )}
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {product.description && (
                        <p className="text-sm text-muted-foreground">{product.description}</p>
                      )}

                      {product.metadata && Object.keys(product.metadata).length > 0 && (
                        <ul className="space-y-2">
                          {Object.entries(product.metadata)
                            .filter(([key]) => key.startsWith("feature_"))
                            .map(([key, value]) => (
                              <li key={key} className="flex items-center gap-2 text-sm">
                                <Check className="w-4 h-4 text-acr-pos flex-shrink-0" />
                                <span>{value}</span>
                              </li>
                            ))}
                        </ul>
                      )}

                      {price && !isCurrent && (
                        <Button
                          className="w-full min-h-11 pointer-fine:sm:min-h-9"
                          onClick={() => handleUpgrade(price.id)}
                          disabled={checkoutMutation.isPending}
                          data-testid={`button-upgrade-${product.id}`}
                        >
                          {checkoutMutation.isPending ? (
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          ) : null}
                          Upgrade to {product.name}
                        </Button>
                      )}

                      {isCurrent && subscriptionData?.subscription && (
                        <Button
                          variant="outline"
                          className="w-full min-h-11 pointer-fine:sm:min-h-9"
                          onClick={handleManageSubscription}
                          disabled={portalMutation.isPending}
                          data-testid={`button-manage-${product.id}`}
                        >
                          {portalMutation.isPending ? (
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          ) : null}
                          Manage Plan
                        </Button>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
          </div>
        ) : (
          <Card>
            <CardContent className="py-2">
              <EmptyState
                icon={CreditCard}
                headline="No plans to show"
                subtitle="Plans didn't come back from billing just now. A refresh usually clears this up."
                cta={{
                  label: "Refresh plans",
                  onClick: () => refetchProducts(),
                  "data-testid": "empty-refresh-plans",
                }}
                actionIcon={null}
                className="py-6"
                testId="empty-available-plans"
              />
            </CardContent>
          </Card>
        )}
      </div>

      <StripeConnectSettings />

      <PlanComparisonModal
        open={showPlanComparison}
        onClose={() => {
          setShowPlanComparison(false);
          setPlanPickerHighlight(null);
        }}
        currentTier={(organization?.subscriptionTier || "free") as TierKey}
        highlightedTier={planPickerHighlight}
      />
    </div>
  );
}
