import { Sidebar } from "@/components/layout-sidebar";
import { 
  useOrganization, 
  useStripeProducts, 
  useStripeSubscription,
  useCreateCheckoutSession,
  useCreatePortalSession,
  useUpdateOrganization,
  useUsageLimits
} from "@/hooks/use-organization";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Building2, Crown, Check, ExternalLink, CreditCard, Loader2, Lightbulb, RotateCcw, Database, Trash2, BarChart3, Users, Home, FileText, Sparkles, TrendingUp, Coins } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { UsageDashboard } from "@/components/usage-dashboard";
import { PricingGuide } from "@/components/pricing-guide";
import { IntegrationsSettings } from "@/components/integrations-settings";
import { useState } from "react";
import { useEffect } from "react";
import { useSearch } from "wouter";

export default function Settings() {
  const { toast } = useToast();
  const search = useSearch();
  const searchParams = new URLSearchParams(search);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  
  const { data: organization, isLoading: orgLoading } = useOrganization();
  const { data: products, isLoading: productsLoading } = useStripeProducts();
  const { data: subscriptionData, isLoading: subLoading } = useStripeSubscription();
  const { data: usageData, isLoading: usageLoading } = useUsageLimits();
  
  const checkoutMutation = useCreateCheckoutSession();
  const portalMutation = useCreatePortalSession();
  const updateOrgMutation = useUpdateOrganization();
  
  const seedDataMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/seed-demo-data", {});
      if (!res.ok) throw new Error("Failed to seed demo data");
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries();
      toast({
        title: "Demo data created",
        description: `Added ${data.counts.leads} leads, ${data.counts.properties} properties, ${data.counts.deals} deals, and ${data.counts.notes} notes.`,
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to create demo data",
        variant: "destructive",
      });
    },
  });
  
  const clearDataMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/clear-demo-data", {});
      if (!res.ok) throw new Error("Failed to clear data");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries();
      setShowClearConfirm(false);
      toast({
        title: "Data cleared",
        description: "All demo data has been removed from your organization.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to clear data",
        variant: "destructive",
      });
    },
  });
  
  const settings = organization?.settings as {
    showTips?: boolean;
    checklistDismissed?: boolean;
    onboardingCompleted?: boolean;
    [key: string]: unknown;
  } | null;
  const showTips = settings?.showTips !== false;

  useEffect(() => {
    const subscriptionStatus = searchParams.get("subscription");
    if (subscriptionStatus === "success") {
      toast({
        title: "Subscription activated!",
        description: "Your subscription has been successfully activated.",
      });
    } else if (subscriptionStatus === "cancelled") {
      toast({
        title: "Checkout cancelled",
        description: "You can upgrade anytime from the settings page.",
        variant: "destructive",
      });
    }
  }, [searchParams, toast]);

  const handleUpgrade = async (priceId: string) => {
    try {
      const result = await checkoutMutation.mutateAsync(priceId);
      if (result.url) {
        window.location.href = result.url;
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to create checkout session",
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
        title: "Error",
        description: error.message || "Failed to open customer portal",
        variant: "destructive",
      });
    }
  };

  const getTierColor = (tier: string) => {
    switch (tier) {
      case "pro": return "bg-purple-500/10 text-purple-500 border-purple-500/20";
      case "scale": return "bg-amber-500/10 text-amber-500 border-amber-500/20";
      case "starter": return "bg-blue-500/10 text-blue-500 border-blue-500/20";
      default: return "bg-slate-500/10 text-slate-500 border-slate-500/20";
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
    <div className="flex min-h-screen bg-background desert-gradient">
      <Sidebar />
      <main className="flex-1 md:ml-[17rem] p-4 pt-16 md:pt-8 md:p-8 pb-24 md:pb-8 overflow-x-hidden">
        <div className="max-w-4xl mx-auto space-y-8">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 dark:text-white" data-testid="text-settings-title">
              Settings
            </h1>
            <p className="text-slate-500 mt-2">Manage your organization and subscription.</p>
          </div>

          {/* Organization Details */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building2 className="w-5 h-5" />
                Organization Details
              </CardTitle>
              <CardDescription>Your organization information and current plan</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {orgLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-6 w-48" />
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-4 w-40" />
                </div>
              ) : organization && (
                <>
                  <div className="flex flex-col gap-1">
                    <span className="text-sm text-muted-foreground">Organization Name</span>
                    <span className="text-lg font-medium" data-testid="text-org-name">
                      {organization.name}
                    </span>
                  </div>
                  
                  <div className="flex flex-col gap-1">
                    <span className="text-sm text-muted-foreground">Subscription Tier</span>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge 
                        variant="outline" 
                        className={`${getTierColor(organization.subscriptionTier)}`}
                        data-testid="badge-current-tier"
                      >
                        <Crown className="w-3 h-3 mr-1" />
                        {organization.subscriptionTier.charAt(0).toUpperCase() + organization.subscriptionTier.slice(1)}
                      </Badge>
                      <Badge variant="outline" data-testid="badge-subscription-status">
                        {organization.subscriptionStatus}
                      </Badge>
                    </div>
                  </div>

                  {subLoading ? (
                    <Skeleton className="h-10 w-48" />
                  ) : subscriptionData?.subscription ? (
                    <div className="flex flex-col gap-2 pt-2">
                      <span className="text-sm text-muted-foreground">Current Period</span>
                      <span className="text-sm" data-testid="text-subscription-period">
                        {new Date(subscriptionData.subscription.current_period_start * 1000).toLocaleDateString()} - {new Date(subscriptionData.subscription.current_period_end * 1000).toLocaleDateString()}
                      </span>
                      <Button 
                        variant="outline" 
                        onClick={handleManageSubscription}
                        disabled={portalMutation.isPending}
                        data-testid="button-manage-subscription"
                      >
                        {portalMutation.isPending ? (
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        ) : (
                          <CreditCard className="w-4 h-4 mr-2" />
                        )}
                        Manage Subscription
                        <ExternalLink className="w-3 h-3 ml-2" />
                      </Button>
                    </div>
                  ) : organization.subscriptionTier === "free" && (
                    <p className="text-sm text-muted-foreground">
                      You're on the free tier. Upgrade below to unlock more features!
                    </p>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          {/* Usage Limits */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="w-5 h-5" />
                Usage & Limits
              </CardTitle>
              <CardDescription>Track your resource usage against your plan limits</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {usageLoading ? (
                <div className="space-y-4">
                  {[1, 2, 3, 4].map((i) => (
                    <div key={i} className="space-y-2">
                      <Skeleton className="h-4 w-24" />
                      <Skeleton className="h-2 w-full" />
                    </div>
                  ))}
                </div>
              ) : usageData && (
                <>
                  {(() => {
                    const usageItems = [
                      { key: "leads" as const, label: "Leads", icon: Users, description: "Total leads in your CRM" },
                      { key: "properties" as const, label: "Properties", icon: Home, description: "Properties in your inventory" },
                      { key: "notes" as const, label: "Notes", icon: FileText, description: "Active seller finance notes" },
                      { key: "ai_requests" as const, label: "AI Requests", icon: Sparkles, description: "Daily AI requests (resets at midnight)" },
                    ];
                    
                    const nearLimitItems = usageItems.filter(item => {
                      const usage = usageData.usage[item.key];
                      return usage.percentage !== null && usage.percentage >= 80;
                    });
                    
                    return (
                      <>
                        {nearLimitItems.length > 0 && usageData.tier !== "enterprise" && (
                          <div className="flex items-start gap-3 p-4 rounded-md bg-amber-500/10 border border-amber-500/20 mb-4">
                            <TrendingUp className="w-5 h-5 text-amber-500 mt-0.5 flex-shrink-0" />
                            <div>
                              <p className="font-medium text-amber-500">
                                You're approaching your limits
                              </p>
                              <p className="text-sm text-muted-foreground mt-1">
                                You've used 80%+ of your {nearLimitItems.map(i => i.label.toLowerCase()).join(", ")} allowance.
                                Upgrade your plan to unlock higher limits.
                              </p>
                              <Button 
                                size="sm" 
                                className="mt-2"
                                onClick={() => document.getElementById("pricing-section")?.scrollIntoView({ behavior: "smooth" })}
                                data-testid="button-upgrade-from-usage"
                              >
                                <Crown className="w-4 h-4 mr-2" />
                                View Upgrade Options
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
                                    <IconComponent className="w-4 h-4 text-muted-foreground" />
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
                                    className={`h-2 ${isAtLimit ? "[&>div]:bg-red-500" : isNearLimit ? "[&>div]:bg-amber-500" : ""}`}
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

          {/* Usage & Credits Dashboard */}
          <div className="space-y-4">
            <div>
              <h2 className="text-xl font-semibold flex items-center gap-2">
                <Coins className="w-5 h-5" />
                Usage & Credits
              </h2>
              <p className="text-muted-foreground text-sm">
                Track your credit balance, usage history, and purchase more credits.
              </p>
            </div>
            <UsageDashboard />
          </div>

          {/* Pricing Guide */}
          <div className="space-y-4" data-testid="section-pricing-guide">
            <div>
              <h2 className="text-xl font-semibold">Pricing Guide</h2>
              <p className="text-muted-foreground text-sm">
                View pricing details for all billable actions before you use them.
              </p>
            </div>
            <PricingGuide />
          </div>

          {/* Communication Integrations */}
          <div className="space-y-4" data-testid="section-integrations">
            <div>
              <h2 className="text-xl font-semibold">Communication Integrations</h2>
              <p className="text-muted-foreground text-sm">
                Connect your own email, SMS, and direct mail providers for branded communications.
              </p>
            </div>
            <IntegrationsSettings />
          </div>

          {/* Onboarding & Help Settings */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Lightbulb className="w-5 h-5" />
                Help & Tips
              </CardTitle>
              <CardDescription>Configure onboarding assistance and contextual help</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <Label htmlFor="show-tips" className="text-base">Show Tips</Label>
                  <p className="text-sm text-muted-foreground">
                    Display helpful tips and the getting started checklist
                  </p>
                </div>
                <Switch
                  id="show-tips"
                  checked={showTips}
                  onCheckedChange={async (checked) => {
                    await updateOrgMutation.mutateAsync({
                      settings: {
                        ...(organization?.settings || {}),
                        showTips: checked,
                        checklistDismissed: checked ? false : settings?.checklistDismissed,
                      },
                    });
                    toast({
                      title: checked ? "Tips enabled" : "Tips disabled",
                      description: checked 
                        ? "You'll now see helpful tips throughout the app."
                        : "Tips have been hidden. You can re-enable them anytime.",
                    });
                  }}
                  disabled={updateOrgMutation.isPending}
                  data-testid="switch-show-tips"
                />
              </div>
              
              <div className="flex items-center justify-between gap-4 pt-4 border-t">
                <div className="space-y-0.5">
                  <Label className="text-base">Start Onboarding Tour</Label>
                  <p className="text-sm text-muted-foreground">
                    {settings?.onboardingCompleted 
                      ? "Re-run the guided setup wizard to update your configuration"
                      : "Complete the guided setup wizard to configure your account"}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    try {
                      const res = await fetch("/api/onboarding/reset", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        credentials: "include",
                      });
                      if (res.ok) {
                        queryClient.invalidateQueries({ queryKey: ["/api/organization"] });
                        queryClient.invalidateQueries({ queryKey: ["/api/onboarding/status"] });
                        toast({
                          title: "Onboarding reset",
                          description: "Navigate to the Dashboard to start the setup wizard.",
                        });
                        window.location.href = "/";
                      }
                    } catch (error) {
                      toast({
                        title: "Error",
                        description: "Failed to reset onboarding",
                        variant: "destructive",
                      });
                    }
                  }}
                  disabled={updateOrgMutation.isPending}
                  data-testid="button-restart-onboarding"
                >
                  <RotateCcw className="w-4 h-4 mr-2" />
                  {settings?.onboardingCompleted ? "Restart Tour" : "Start Tour"}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Pricing Tiers */}
          <div id="pricing-section" className="space-y-4">
            <h2 className="text-xl font-semibold">Available Plans</h2>
            
            {productsLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {[1, 2, 3].map((i) => (
                  <Card key={i}>
                    <CardContent className="pt-6 space-y-4">
                      <Skeleton className="h-6 w-24" />
                      <Skeleton className="h-8 w-20" />
                      <Skeleton className="h-4 w-full" />
                      <Skeleton className="h-10 w-full" />
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : products && products.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {products
                  .filter(p => p.active && p.prices.length > 0)
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
                                    <Check className="w-4 h-4 text-green-500 flex-shrink-0" />
                                    <span>{value}</span>
                                  </li>
                                ))}
                            </ul>
                          )}
                          
                          {price && !isCurrent && (
                            <Button 
                              className="w-full"
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
                              className="w-full"
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
                <CardContent className="py-8 text-center text-muted-foreground">
                  No subscription plans available at this time.
                </CardContent>
              </Card>
            )}
          </div>
          
          {/* Developer Tools */}
          <div className="space-y-4">
            <div>
              <h2 className="text-xl font-semibold flex items-center gap-2">
                <Database className="w-5 h-5" />
                Developer Tools
              </h2>
              <p className="text-muted-foreground text-sm">
                Manage test data for development and demo purposes.
              </p>
            </div>
            
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Demo Data</CardTitle>
                <CardDescription>
                  Populate your account with sample leads, properties, deals, and notes for testing.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-3">
                <Button
                  onClick={() => seedDataMutation.mutate()}
                  disabled={seedDataMutation.isPending}
                  data-testid="button-seed-demo-data"
                >
                  {seedDataMutation.isPending ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Database className="w-4 h-4 mr-2" />
                  )}
                  Add Demo Data
                </Button>
                
                <Button
                  variant="destructive"
                  onClick={() => setShowClearConfirm(true)}
                  disabled={clearDataMutation.isPending}
                  data-testid="button-clear-data"
                >
                  {clearDataMutation.isPending ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Trash2 className="w-4 h-4 mr-2" />
                  )}
                  Clear All Data
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
      
      <ConfirmDialog
        open={showClearConfirm}
        onOpenChange={setShowClearConfirm}
        title="Clear All Data"
        description="This will permanently delete all leads, properties, deals, notes, and payments from your organization. This action cannot be undone. Are you sure you want to continue?"
        confirmLabel="Yes, Delete Everything"
        onConfirm={() => clearDataMutation.mutate()}
        isLoading={clearDataMutation.isPending}
        variant="destructive"
      />
    </div>
  );
}
