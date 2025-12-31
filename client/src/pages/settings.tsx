import { Sidebar } from "@/components/layout-sidebar";
import { 
  useOrganization, 
  useStripeProducts, 
  useStripeSubscription,
  useCreateCheckoutSession,
  useCreatePortalSession
} from "@/hooks/use-organization";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Building2, Crown, Check, ExternalLink, CreditCard, Loader2 } from "lucide-react";
import { useEffect } from "react";
import { useSearch } from "wouter";

export default function Settings() {
  const { toast } = useToast();
  const search = useSearch();
  const searchParams = new URLSearchParams(search);
  
  const { data: organization, isLoading: orgLoading } = useOrganization();
  const { data: products, isLoading: productsLoading } = useStripeProducts();
  const { data: subscriptionData, isLoading: subLoading } = useStripeSubscription();
  
  const checkoutMutation = useCreateCheckoutSession();
  const portalMutation = useCreatePortalSession();

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
      <main className="flex-1 md:ml-[17rem] p-8">
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

          {/* Pricing Tiers */}
          <div className="space-y-4">
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
        </div>
      </main>
    </div>
  );
}
