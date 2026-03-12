import { PageShell } from "@/components/page-shell";
import { 
  useOrganization, 
  useStripeProducts, 
  useStripeSubscription,
  useCreateCheckoutSession,
  useCreatePortalSession,
  useUpdateOrganization,
  useUsageLimits,
  useTeamMembers,
  useUpdateTeamMemberRole,
  useUserPermissions,
  getRoleLabel,
  getRoleBadgeStyle,
  type Role
} from "@/hooks/use-organization";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Building2, Crown, Check, ExternalLink, CreditCard, Loader2, Lightbulb, RotateCcw, Database, Trash2, BarChart3, Users, Home, FileText, Sparkles, TrendingUp, Coins, Shield, Mail, Phone, Bell, Code, Settings as SettingsIcon, Gift, Link2, AlertCircle, CheckCircle2, Clock, RefreshCw, Unlink, Wallet, Target, Plus, X, Calendar } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { UsageDashboard } from "@/components/usage-dashboard";
import { PricingGuide } from "@/components/pricing-guide";
import { IntegrationsSettings } from "@/components/integrations-settings";
import { EmailDomainsSettings } from "@/components/email-domains-settings";
import { PhoneNumbersSettings } from "@/components/phone-numbers-settings";
import { EmailSettingsContent } from "@/components/email-settings-content";
import { MailSettingsContent } from "@/components/mail-settings-content";
import { CustomFieldsManager } from "@/components/custom-fields";
import { NotificationPreferences } from "@/components/notification-preferences";
import { ImportExportManager } from "@/components/import-export";
import { ComplianceSettings } from "@/components/compliance-settings";
import { AISettings } from "@/components/ai-settings";
import { ProviderSettings } from "@/components/provider-settings";
import { AICostDashboard } from "@/components/ai-cost-dashboard";
import { ByokSettings } from "@/components/settings/ByokSettings";
import { ThemeSettings } from "@/components/theme-settings";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { UserPlus } from "lucide-react";
import { Input } from "@/components/ui/input";

interface SeatInfo {
  tier: string;
  includedSeats: number;
  additionalSeats: number;
  totalSeats: number;
  maxSeats: number | null;
  usedSeats: number;
  availableSeats: number;
  canAddSeats: boolean;
  seatPriceCents: number | null;
  hasTeamMessaging: boolean;
}

interface SeatPricing {
  canPurchaseSeats: boolean;
  message?: string;
  tier?: string;
  monthly?: { id: string; amount: number; currency: string } | null;
  yearly?: { id: string; amount: number; currency: string } | null;
}

const VALID_TABS = ["general", "appearance", "team", "payments", "communications", "notifications", "ai", "data", "integrations", "developer", "goals", "referral"] as const;
type TabValue = typeof VALID_TABS[number];

interface StripeConnectStatusResponse {
  isConnected: boolean;
  accountId?: string;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  capabilities?: {
    cardPayments?: string;
    transfers?: string;
    usBankAccountAchPayments?: string;
  };
  requirements?: {
    currentlyDue: string[];
    eventuallyDue: string[];
    pastDue: string[];
  };
  businessProfile?: {
    name?: string;
    url?: string;
  };
}

function StripeConnectSettings() {
  const { toast } = useToast();
  
  const { data: connectStatus, isLoading: statusLoading, refetch } = useQuery<StripeConnectStatusResponse>({
    queryKey: ["/api/stripe/connect/status"],
  });
  
  const connectMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/stripe/connect/link", {});
      if (!res.ok) throw new Error("Failed to start Stripe onboarding");
      return res.json();
    },
    onSuccess: (data) => {
      if (data.onboardingUrl) {
        window.location.href = data.onboardingUrl;
      }
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to start Stripe onboarding",
        variant: "destructive",
      });
    },
  });
  
  const refreshMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/stripe/connect/refresh", {});
      if (!res.ok) throw new Error("Failed to refresh status");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/stripe/connect/status"] });
      toast({
        title: "Status refreshed",
        description: "Your Stripe account status has been updated.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to refresh status",
        variant: "destructive",
      });
    },
  });
  
  const disconnectMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/stripe/connect/disconnect", {});
      if (!res.ok) throw new Error("Failed to disconnect account");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/stripe/connect/status"] });
      toast({
        title: "Stripe disconnected",
        description: "Your Stripe account has been disconnected.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to disconnect Stripe account",
        variant: "destructive",
      });
    },
  });
  
  const getStatusDisplay = () => {
    if (!connectStatus) return { label: "Not Connected", icon: AlertCircle, color: "text-muted-foreground" };
    
    if (!connectStatus.isConnected) {
      return { label: "Not Connected", icon: AlertCircle, color: "text-muted-foreground" };
    }
    
    if (!connectStatus.detailsSubmitted) {
      return { label: "Onboarding Required", icon: Clock, color: "text-amber-500" };
    }
    
    if (!connectStatus.chargesEnabled) {
      return { label: "Pending Verification", icon: Clock, color: "text-amber-500" };
    }
    
    return { label: "Active", icon: CheckCircle2, color: "text-green-500" };
  };
  
  const status = getStatusDisplay();
  const StatusIcon = status.icon;

  if (statusLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wallet className="w-5 h-5" />
            Stripe Connect
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Wallet className="w-5 h-5" />
          Stripe Connect
        </CardTitle>
        <CardDescription>
          Connect your Stripe account to receive payments from borrowers and buyers.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <StatusIcon className={`w-5 h-5 ${status.color}`} />
            <div>
              <p className="font-medium">Connection Status</p>
              <p className={`text-sm ${status.color}`} data-testid="text-stripe-status">
                {status.label}
              </p>
            </div>
          </div>
          
          {connectStatus?.isConnected && connectStatus.accountId && (
            <div className="text-right">
              <p className="text-sm text-muted-foreground">Account ID</p>
              <p className="font-mono text-sm" data-testid="text-stripe-account-id">
                {connectStatus.accountId}
              </p>
            </div>
          )}
        </div>
        
        {connectStatus?.isConnected && (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 pt-4 border-t">
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Charges</p>
              <div className="flex items-center gap-1">
                {connectStatus.chargesEnabled ? (
                  <CheckCircle2 className="w-4 h-4 text-green-500" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-amber-500" />
                )}
                <span className="text-sm font-medium">
                  {connectStatus.chargesEnabled ? "Enabled" : "Pending"}
                </span>
              </div>
            </div>
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Payouts</p>
              <div className="flex items-center gap-1">
                {connectStatus.payoutsEnabled ? (
                  <CheckCircle2 className="w-4 h-4 text-green-500" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-amber-500" />
                )}
                <span className="text-sm font-medium">
                  {connectStatus.payoutsEnabled ? "Enabled" : "Pending"}
                </span>
              </div>
            </div>
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Onboarding</p>
              <div className="flex items-center gap-1">
                {connectStatus.detailsSubmitted ? (
                  <CheckCircle2 className="w-4 h-4 text-green-500" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-amber-500" />
                )}
                <span className="text-sm font-medium">
                  {connectStatus.detailsSubmitted ? "Complete" : "Incomplete"}
                </span>
              </div>
            </div>
          </div>
        )}
        
        {connectStatus?.requirements && connectStatus.requirements.currentlyDue.length > 0 && (
          <div className="p-4 rounded-md bg-amber-500/10 border border-amber-500/20">
            <p className="font-medium text-amber-500 flex items-center gap-2">
              <AlertCircle className="w-4 h-4" />
              Action Required
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              Complete your Stripe onboarding to enable payments. Click "Complete Onboarding" below.
            </p>
          </div>
        )}
        
        <div className="flex flex-wrap gap-3 pt-4 border-t">
          {!connectStatus?.isConnected ? (
            <Button
              onClick={() => connectMutation.mutate()}
              disabled={connectMutation.isPending}
              data-testid="button-connect-stripe"
            >
              {connectMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Link2 className="w-4 h-4 mr-2" />
              )}
              Connect Stripe Account
            </Button>
          ) : (
            <>
              {!connectStatus.detailsSubmitted && (
                <Button
                  onClick={() => connectMutation.mutate()}
                  disabled={connectMutation.isPending}
                  data-testid="button-complete-onboarding"
                >
                  {connectMutation.isPending ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <ExternalLink className="w-4 h-4 mr-2" />
                  )}
                  Complete Onboarding
                </Button>
              )}
              
              <Button
                variant="outline"
                onClick={() => refreshMutation.mutate()}
                disabled={refreshMutation.isPending}
                data-testid="button-refresh-stripe-status"
              >
                {refreshMutation.isPending ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <RefreshCw className="w-4 h-4 mr-2" />
                )}
                Refresh Status
              </Button>
              
              <Button
                variant="outline"
                onClick={() => disconnectMutation.mutate()}
                disabled={disconnectMutation.isPending}
                data-testid="button-disconnect-stripe"
              >
                {disconnectMutation.isPending ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Unlink className="w-4 h-4 mr-2" />
                )}
                Disconnect
              </Button>
            </>
          )}
        </div>
        
        <div className="pt-4 border-t">
          <p className="text-sm text-muted-foreground">
            <strong>Platform Fee:</strong> A 2.5% platform fee is applied to all payments processed through AcreOS. 
            This covers payment processing, automated payment collection, and platform infrastructure.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function SeatManagement() {
  const { toast } = useToast();
  const [seatQuantity, setSeatQuantity] = useState(1);
  const [billingPeriod, setBillingPeriod] = useState<"monthly" | "yearly">("monthly");
  
  const { data: seatInfo, isLoading: seatInfoLoading } = useQuery<SeatInfo>({
    queryKey: ["/api/organization/seats"],
  });
  
  const { data: seatPricing, isLoading: pricingLoading } = useQuery<SeatPricing>({
    queryKey: ["/api/organization/seats/pricing"],
  });
  
  const purchaseSeatsMutation = useMutation({
    mutationFn: async ({ quantity, billingPeriod }: { quantity: number; billingPeriod: string }) => {
      const res = await apiRequest("POST", "/api/organization/seats/purchase", { quantity, billingPeriod });
      if (!res.ok) throw new Error("Failed to create checkout session");
      return res.json();
    },
    onSuccess: (data) => {
      if (data.url) {
        window.location.href = data.url;
      }
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to purchase seats",
        variant: "destructive",
      });
    },
  });
  
  const handlePurchaseSeats = () => {
    purchaseSeatsMutation.mutate({ quantity: seatQuantity, billingPeriod });
  };
  
  const formatPrice = (amount: number | undefined, currency: string = "usd") => {
    if (!amount) return "$0";
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.toUpperCase(),
      minimumFractionDigits: 0,
    }).format(amount / 100);
  };

  if (seatInfoLoading || pricingLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="w-5 h-5" />
            Seat Management
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="w-5 h-5" />
          Seat Management
        </CardTitle>
        <CardDescription>Manage your team seat allocation</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">Included Seats</p>
            <p className="text-2xl font-semibold" data-testid="text-included-seats">
              {seatInfo?.includedSeats ?? 0}
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">Additional Seats</p>
            <p className="text-2xl font-semibold" data-testid="text-additional-seats">
              {seatInfo?.additionalSeats ?? 0}
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">Used</p>
            <p className="text-2xl font-semibold" data-testid="text-used-seats">
              {seatInfo?.usedSeats ?? 0} / {seatInfo?.totalSeats ?? 0}
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">Available</p>
            <p className="text-2xl font-semibold text-green-600" data-testid="text-available-seats">
              {seatInfo?.availableSeats ?? 0}
            </p>
          </div>
        </div>
        
        {seatInfo && seatInfo.totalSeats > 0 && (
          <Progress 
            value={(seatInfo.usedSeats / seatInfo.totalSeats) * 100} 
            className="h-2"
          />
        )}
        
        {seatInfo?.hasTeamMessaging && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Check className="w-4 h-4 text-green-500" />
            Team messaging enabled (2+ seats)
          </div>
        )}
        
        {seatPricing?.canPurchaseSeats && seatInfo?.canAddSeats && (
          <div className="pt-4 border-t space-y-4">
            <h4 className="font-medium">Add More Seats</h4>
            <div className="flex flex-wrap items-end gap-4">
              <div className="space-y-1">
                <Label htmlFor="seat-quantity">Quantity</Label>
                <Input
                  id="seat-quantity"
                  type="number"
                  min={1}
                  max={seatInfo?.maxSeats ? seatInfo.maxSeats - seatInfo.totalSeats : 100}
                  value={seatQuantity}
                  onChange={(e) => setSeatQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-20"
                  data-testid="input-seat-quantity"
                />
              </div>
              <div className="space-y-1">
                <Label>Billing</Label>
                <Select value={billingPeriod} onValueChange={(v) => setBillingPeriod(v as "monthly" | "yearly")}>
                  <SelectTrigger className="w-28" data-testid="select-billing-period">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="monthly">Monthly</SelectItem>
                    <SelectItem value="yearly">Yearly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex-1 space-y-1">
                <Label>Price</Label>
                <p className="text-lg font-semibold" data-testid="text-seat-price">
                  {billingPeriod === "monthly" 
                    ? `${formatPrice((seatPricing.monthly?.amount ?? 0) * seatQuantity)}/mo`
                    : `${formatPrice((seatPricing.yearly?.amount ?? 0) * seatQuantity)}/yr`
                  }
                </p>
              </div>
              <Button
                onClick={handlePurchaseSeats}
                disabled={purchaseSeatsMutation.isPending || !seatQuantity}
                data-testid="button-purchase-seats"
              >
                {purchaseSeatsMutation.isPending ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <UserPlus className="w-4 h-4 mr-2" />
                )}
                Add Seats
              </Button>
            </div>
          </div>
        )}
        
        {seatPricing && !seatPricing.canPurchaseSeats && (
          <p className="text-sm text-muted-foreground pt-4 border-t">
            {seatPricing.message}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export default function Settings() {
  const { toast } = useToast();
  const [location, setLocation] = useLocation();
  const search = useSearch();
  const searchParams = new URLSearchParams(search);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  
  const getTabFromHash = (): TabValue => {
    const hash = window.location.hash.replace("#", "");
    if (VALID_TABS.includes(hash as TabValue)) {
      return hash as TabValue;
    }
    return "general";
  };
  
  const [activeTab, setActiveTab] = useState<TabValue>(getTabFromHash);
  
  useEffect(() => {
    const handleHashChange = () => {
      setActiveTab(getTabFromHash());
    };
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);
  
  const handleTabChange = (value: string) => {
    const newTab = value as TabValue;
    setActiveTab(newTab);
    window.history.replaceState(null, "", `/settings#${newTab}`);
  };
  
  const { data: organization, isLoading: orgLoading } = useOrganization();
  const { data: products, isLoading: productsLoading } = useStripeProducts();
  const { data: subscriptionData, isLoading: subLoading } = useStripeSubscription();
  const { data: usageData, isLoading: usageLoading } = useUsageLimits();
  const { data: teamMembers, isLoading: teamLoading } = useTeamMembers();
  const { data: userPermissions } = useUserPermissions();
  
  const checkoutMutation = useCreateCheckoutSession();
  const portalMutation = useCreatePortalSession();
  const updateOrgMutation = useUpdateOrganization();
  const updateRoleMutation = useUpdateTeamMemberRole();
  
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
      default: return "bg-muted text-muted-foreground border-border";
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
    <PageShell maxWidth="4xl">
          <div>
            <h1 className="text-3xl font-bold" data-testid="text-settings-title">
              Settings
            </h1>
            <p className="text-muted-foreground mt-2">Manage your organization, team, and preferences.</p>
          </div>

          <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
            <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
              <TabsList className="inline-flex w-auto min-w-full md:min-w-0" data-testid="tabs-settings">
                <TabsTrigger value="general" data-testid="tab-general" className="gap-1">
                  <SettingsIcon className="w-4 h-4 hidden sm:inline" />
                  General
                </TabsTrigger>
                <TabsTrigger value="team" data-testid="tab-team" className="gap-1">
                  <Users className="w-4 h-4 hidden sm:inline" />
                  Team
                </TabsTrigger>
                <TabsTrigger value="payments" data-testid="tab-payments" className="gap-1">
                  <Wallet className="w-4 h-4 hidden sm:inline" />
                  Payments
                </TabsTrigger>
                <TabsTrigger value="communications" data-testid="tab-communications" className="gap-1">
                  <Mail className="w-4 h-4 hidden sm:inline" />
                  Communications
                </TabsTrigger>
                <TabsTrigger value="notifications" data-testid="tab-notifications" className="gap-1">
                  <Bell className="w-4 h-4 hidden sm:inline" />
                  Notifications
                </TabsTrigger>
                <TabsTrigger value="ai" data-testid="tab-ai" className="gap-1">
                  <Sparkles className="w-4 h-4 hidden sm:inline" />
                  AI
                </TabsTrigger>
                <TabsTrigger value="data" data-testid="tab-data" className="gap-1">
                  <FileText className="w-4 h-4 hidden sm:inline" />
                  Data
                </TabsTrigger>
                <TabsTrigger value="appearance" data-testid="tab-appearance" className="gap-1">
                  <SettingsIcon className="w-4 h-4 hidden sm:inline" />
                  Appearance
                </TabsTrigger>
                <TabsTrigger value="integrations" data-testid="tab-integrations" className="gap-1">
                  <Link2 className="w-4 h-4 hidden sm:inline" />
                  Integrations
                </TabsTrigger>
                <TabsTrigger value="developer" data-testid="tab-developer" className="gap-1">
                  <Code className="w-4 h-4 hidden sm:inline" />
                  Developer
                </TabsTrigger>
                <TabsTrigger value="goals" data-testid="tab-goals" className="gap-1">
                  <Target className="w-4 h-4 hidden sm:inline" />
                  Goals
                </TabsTrigger>
                <TabsTrigger value="referral" data-testid="tab-referral" className="gap-1">
                  <Gift className="w-4 h-4 hidden sm:inline" />
                  Refer &amp; Earn
                </TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="general" className="space-y-8 mt-6" data-testid="tab-content-general">
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
                            className={`${organization.isFounder ? 'bg-gradient-to-r from-purple-500 to-pink-500 text-white border-purple-500' : getTierColor(organization.subscriptionTier)}`}
                            data-testid="badge-current-tier"
                          >
                            <Crown className="w-3 h-3 mr-1" />
                            {organization.isFounder ? 'Enterprise (Founder)' : organization.subscriptionTier.charAt(0).toUpperCase() + organization.subscriptionTier.slice(1)}
                          </Badge>
                          {organization.isFounder && (
                            <Badge variant="outline" className="bg-gradient-to-r from-amber-500 to-orange-500 text-white border-amber-500" data-testid="badge-unlimited">
                              Unlimited
                            </Badge>
                          )}
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
                        <div className="space-y-3">
                          {!organization.trialUsed && (
                            <div className="flex items-start gap-3 p-4 rounded-md bg-emerald-500/10 border border-emerald-500/20">
                              <Gift className="w-5 h-5 text-emerald-500 mt-0.5 flex-shrink-0" />
                              <div>
                                <p className="font-medium text-emerald-500" data-testid="text-trial-available">
                                  7-Day Free Trial Available
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

              <div className="space-y-4" data-testid="section-pricing-guide">
                <div>
                  <h2 className="text-xl font-semibold">Pricing Guide</h2>
                  <p className="text-muted-foreground text-sm">
                    View pricing details for all billable actions before you use them.
                  </p>
                </div>
                <PricingGuide />
              </div>

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
            </TabsContent>

            <TabsContent value="team" className="space-y-8 mt-6" data-testid="tab-content-team">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Users className="w-5 h-5" />
                    Team Members
                  </CardTitle>
                  <CardDescription>Manage team roles and permissions</CardDescription>
                </CardHeader>
                <CardContent>
                  {teamLoading ? (
                    <div className="space-y-3">
                      {[1, 2].map((i) => (
                        <div key={i} className="flex items-center gap-4">
                          <Skeleton className="h-10 w-10 rounded-full" />
                          <Skeleton className="h-4 w-32" />
                          <Skeleton className="h-6 w-16" />
                        </div>
                      ))}
                    </div>
                  ) : teamMembers && teamMembers.length > 0 ? (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Member</TableHead>
                          <TableHead>Role</TableHead>
                          {userPermissions?.permissions.canManageTeam && (
                            <TableHead className="w-32">Actions</TableHead>
                          )}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {teamMembers.map((member) => (
                          <TableRow key={member.id} data-testid={`row-team-member-${member.id}`}>
                            <TableCell>
                              <div className="flex items-center gap-3">
                                <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                                  <Users className="w-4 h-4 text-primary" />
                                </div>
                                <div>
                                  <p className="font-medium" data-testid={`text-member-name-${member.id}`}>
                                    {member.displayName || member.email || member.userId}
                                  </p>
                                  {member.email && member.displayName && (
                                    <p className="text-xs text-muted-foreground">{member.email}</p>
                                  )}
                                </div>
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge 
                                variant="outline"
                                className={`border-0 ${getRoleBadgeStyle(member.role)}`}
                                data-testid={`badge-role-${member.id}`}
                              >
                                {member.role === "owner" && <Crown className="w-3 h-3 mr-1" />}
                                {member.role === "admin" && <Shield className="w-3 h-3 mr-1" />}
                                {getRoleLabel(member.role)}
                              </Badge>
                            </TableCell>
                            {userPermissions?.permissions.canManageTeam && (
                              <TableCell>
                                {member.role !== "owner" || userPermissions.role === "owner" ? (
                                  <Select
                                    value={member.role}
                                    onValueChange={(newRole: Role) => {
                                      updateRoleMutation.mutate(
                                        { memberId: member.id, role: newRole },
                                        {
                                          onSuccess: () => {
                                            toast({
                                              title: "Role updated",
                                              description: `${member.displayName || member.userId}'s role has been changed to ${getRoleLabel(newRole)}.`,
                                            });
                                          },
                                          onError: (error) => {
                                            toast({
                                              title: "Error",
                                              description: error.message || "Failed to update role",
                                              variant: "destructive",
                                            });
                                          },
                                        }
                                      );
                                    }}
                                    disabled={updateRoleMutation.isPending}
                                  >
                                    <SelectTrigger 
                                      className="w-28"
                                      data-testid={`select-role-${member.id}`}
                                    >
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {userPermissions.role === "owner" && (
                                        <SelectItem value="owner">Owner</SelectItem>
                                      )}
                                      <SelectItem value="admin">Admin</SelectItem>
                                      <SelectItem value="member">Member</SelectItem>
                                      <SelectItem value="viewer">Viewer</SelectItem>
                                    </SelectContent>
                                  </Select>
                                ) : (
                                  <span className="text-sm text-muted-foreground">-</span>
                                )}
                              </TableCell>
                            )}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : (
                    <p className="text-muted-foreground text-sm">No team members found.</p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="payments" className="space-y-8 mt-6" data-testid="tab-content-payments">
              <StripeConnectSettings />
            </TabsContent>

            <TabsContent value="communications" className="space-y-8 mt-6" data-testid="tab-content-communications">
              <div className="space-y-4" data-testid="section-email-settings">
                <div>
                  <h2 className="text-xl font-semibold flex items-center gap-2">
                    <Mail className="w-5 h-5" />
                    Email Settings
                  </h2>
                  <p className="text-muted-foreground text-sm">
                    Configure email sender identities and reply routing.
                  </p>
                </div>
                <EmailSettingsContent />
              </div>

              <div className="space-y-4" data-testid="section-mail-settings">
                <div>
                  <h2 className="text-xl font-semibold flex items-center gap-2">
                    <Mail className="w-5 h-5" />
                    Mail Settings
                  </h2>
                  <p className="text-muted-foreground text-sm">
                    Configure return addresses for direct mail campaigns.
                  </p>
                </div>
                <MailSettingsContent />
              </div>

              <div className="space-y-4" data-testid="section-phone-settings">
                <div>
                  <h2 className="text-xl font-semibold flex items-center gap-2">
                    <Phone className="w-5 h-5" />
                    Phone Numbers
                  </h2>
                  <p className="text-muted-foreground text-sm">
                    Configure phone numbers for SMS and calling.
                  </p>
                </div>
                <PhoneNumbersSettings />
              </div>

              <div className="space-y-4" data-testid="section-integrations">
                <div>
                  <h2 className="text-xl font-semibold">Communication Integrations</h2>
                  <p className="text-muted-foreground text-sm">
                    Connect your own email, SMS, and direct mail providers for branded communications.
                  </p>
                </div>
                <IntegrationsSettings />
                <EmailDomainsSettings />
              </div>
            </TabsContent>

            <TabsContent value="notifications" className="space-y-8 mt-6" data-testid="tab-content-notifications">
              <NotificationPreferences />
            </TabsContent>

            <TabsContent value="ai" className="space-y-8 mt-6" data-testid="tab-content-ai">
              <AICostDashboard />
              <AISettings />
              <div className="pt-4 border-t">
                <h3 className="text-lg font-semibold mb-4">Service Providers</h3>
                <ProviderSettings />
              </div>
            </TabsContent>

            <TabsContent value="data" className="space-y-8 mt-6" data-testid="tab-content-data">
              <div className="space-y-4">
                <div>
                  <h2 className="text-xl font-semibold flex items-center gap-2">
                    <FileText className="w-5 h-5" />
                    Custom Fields
                  </h2>
                  <p className="text-muted-foreground text-sm">
                    Define custom fields for leads, properties, and deals.
                  </p>
                </div>
                <CustomFieldsManager />
              </div>

              <div className="space-y-4">
                <ImportExportManager />
              </div>

              <div className="space-y-4">
                <ComplianceSettings />
              </div>
            </TabsContent>

            <TabsContent value="integrations" className="space-y-8 mt-6" data-testid="tab-content-integrations">
              <div className="space-y-6">
                <div>
                  <h2 className="text-xl font-semibold flex items-center gap-2">
                    <Link2 className="w-5 h-5" />
                    Bring Your Own Keys (BYOK)
                  </h2>
                  <p className="text-muted-foreground text-sm">
                    Connect your own API keys to external services for unlimited usage and complete control.
                  </p>
                </div>
                <ByokSettings />
              </div>
            </TabsContent>

            <TabsContent value="appearance" className="space-y-8 mt-6" data-testid="tab-content-appearance">
              <div className="space-y-4">
                <div>
                  <h2 className="text-xl font-semibold flex items-center gap-2">
                    <SettingsIcon className="w-5 h-5" />
                    Appearance
                  </h2>
                  <p className="text-muted-foreground text-sm">
                    Customize the look and feel of AcreOS.
                  </p>
                </div>
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Theme & Colors</CardTitle>
                    <CardDescription>
                      Choose from named presets, accent colors, and light/dark/system mode.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ThemeSettings />
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            <TabsContent value="developer" className="space-y-8 mt-6" data-testid="tab-content-developer">
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

              {/* API Key Management */}
              <ApiKeyManager />

              {/* Activity Audit Log */}
              <ActivityLogPanel />
            </TabsContent>

            {/* ── Goals Tab ─────────────────────────────────────────────── */}
            <TabsContent value="goals" className="space-y-6 mt-6" data-testid="tab-content-goals">
              <GoalsSettings />
            </TabsContent>
            <TabsContent value="referral" className="space-y-6 mt-6" data-testid="tab-content-referral">
              <ReferralSettings />
            </TabsContent>
          </Tabs>
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
    </PageShell>
  );
}

// ── Referral Settings component ────────────────────────────────────────────────

function ReferralSettings() {
  const { toast } = useToast();
  const appUrl = typeof window !== "undefined" ? window.location.origin : "https://app.acreos.io";

  const codeQuery = useQuery<{ code: string }>({
    queryKey: ["/api/referral/code"],
    queryFn: async () => {
      const res = await fetch("/api/referral/code", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load referral code");
      return res.json();
    },
  });

  const statsQuery = useQuery<{ signups: number; conversions: number; creditsEarned: number; creditBalance: number }>({
    queryKey: ["/api/referral/stats"],
    queryFn: async () => {
      const res = await fetch("/api/referral/stats", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load referral stats");
      return res.json();
    },
  });

  const referralLink = codeQuery.data?.code
    ? `${appUrl}/?ref=${codeQuery.data.code}`
    : "";

  const copyLink = () => {
    if (!referralLink) return;
    navigator.clipboard.writeText(referralLink).then(() => {
      toast({ title: "Copied!", description: "Referral link copied to clipboard." });
    });
  };

  const stats = statsQuery.data;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Gift className="w-5 h-5" />
            Refer &amp; Earn
          </CardTitle>
          <CardDescription>
            Share AcreOS with fellow land investors. They get 30 days free — you get $20 account credit when they subscribe.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Offer callout */}
          <div className="rounded-xl bg-primary/5 border border-primary/20 p-4 flex items-start gap-3">
            <Gift className="w-5 h-5 text-primary shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-semibold text-sm">Give 30 days free, get $20 credit</p>
              <p className="text-xs text-muted-foreground">
                Your referral code gives new users their first 30 days on us.
                Once they become a paying subscriber, you'll automatically receive a $20 account credit — applied to your next invoice.
              </p>
            </div>
          </div>

          {/* Referral link */}
          <div className="space-y-2">
            <p className="text-sm font-medium">Your referral link</p>
            {codeQuery.isLoading ? (
              <Skeleton className="h-10 w-full" />
            ) : codeQuery.isError ? (
              <p className="text-sm text-destructive">Failed to load referral link. Please refresh.</p>
            ) : (
              <div className="flex gap-2">
                <Input readOnly value={referralLink} className="font-mono text-sm" />
                <Button variant="outline" size="sm" onClick={copyLink} className="shrink-0">
                  <Link2 className="w-4 h-4 mr-1" />
                  Copy
                </Button>
              </div>
            )}
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: "Signups", value: stats?.signups ?? 0, icon: Users },
              { label: "Converted", value: stats?.conversions ?? 0, icon: CheckCircle2 },
              { label: "Credits Earned", value: stats ? `$${(stats.creditsEarned / 100).toFixed(0)}` : "$0", icon: Coins },
              { label: "Available Credit", value: stats ? `$${(stats.creditBalance / 100).toFixed(0)}` : "$0", icon: Wallet },
            ].map(({ label, value, icon: Icon }) => (
              <div key={label} className="rounded-lg border border-border/60 bg-card p-4 space-y-1 text-center">
                <Icon className="w-4 h-4 text-primary mx-auto" />
                <p className="text-2xl font-bold">{statsQuery.isLoading ? "—" : value}</p>
                <p className="text-xs text-muted-foreground">{label}</p>
              </div>
            ))}
          </div>

          <p className="text-xs text-muted-foreground">
            Credits are applied automatically to your subscription invoice once a referee has been a paying subscriber for 30+ days.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Goals Settings component ──────────────────────────────────────────────────

interface GoalPayload {
  label: string;
  goalType: "deals_closed" | "notes_deployed" | "revenue_earned" | "leads_contacted";
  targetValue: string;
  periodStart: string;
  periodEnd: string;
}

const GOAL_TYPE_LABELS: Record<GoalPayload["goalType"], string> = {
  deals_closed: "Deals Closed",
  notes_deployed: "Notes Deployed",
  revenue_earned: "Revenue Earned ($)",
  leads_contacted: "Leads Contacted",
};

function GoalsSettings() {
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<GoalPayload>({
    label: "",
    goalType: "deals_closed",
    targetValue: "",
    periodStart: new Date().toISOString().slice(0, 10),
    periodEnd: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
  });

  const { data: goals = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/goals"],
    queryFn: () => apiRequest("GET", "/api/goals").then(r => r.json()),
  });

  const createGoal = useMutation({
    mutationFn: (payload: GoalPayload) => apiRequest("POST", "/api/goals", payload).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/goals"] });
      setShowForm(false);
      setForm({ label: "", goalType: "deals_closed", targetValue: "", periodStart: new Date().toISOString().slice(0, 10), periodEnd: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10) });
      toast({ title: "Goal created", description: "Your new goal has been saved." });
    },
    onError: () => toast({ title: "Error", description: "Failed to create goal.", variant: "destructive" }),
  });

  const deleteGoal = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/goals/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/goals"] });
      toast({ title: "Goal deleted" });
    },
    onError: () => toast({ title: "Error", description: "Failed to delete goal.", variant: "destructive" }),
  });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Target className="w-5 h-5" />
                Business Goals
              </CardTitle>
              <CardDescription>Track progress toward deals, revenue, and activity targets</CardDescription>
            </div>
            <Button size="sm" onClick={() => setShowForm(v => !v)} variant={showForm ? "outline" : "default"}>
              {showForm ? <X className="w-4 h-4 mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
              {showForm ? "Cancel" : "New Goal"}
            </Button>
          </div>
        </CardHeader>

        {showForm && (
          <CardContent className="border-t pt-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2 space-y-1">
                <Label>Goal Label</Label>
                <Input
                  placeholder="e.g. Q2 deal target"
                  value={form.label}
                  onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label>Type</Label>
                <Select value={form.goalType} onValueChange={v => setForm(f => ({ ...f, goalType: v as GoalPayload["goalType"] }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.entries(GOAL_TYPE_LABELS) as [GoalPayload["goalType"], string][]).map(([v, l]) => (
                      <SelectItem key={v} value={v}>{l}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Target</Label>
                <Input
                  type="number"
                  min="0"
                  placeholder="e.g. 10"
                  value={form.targetValue}
                  onChange={e => setForm(f => ({ ...f, targetValue: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5" />Start Date</Label>
                <Input type="date" value={form.periodStart} onChange={e => setForm(f => ({ ...f, periodStart: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5" />End Date</Label>
                <Input type="date" value={form.periodEnd} onChange={e => setForm(f => ({ ...f, periodEnd: e.target.value }))} />
              </div>
              <div className="sm:col-span-2">
                <Button
                  onClick={() => createGoal.mutate(form)}
                  disabled={!form.label || !form.targetValue || createGoal.isPending}
                >
                  {createGoal.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Save Goal
                </Button>
              </div>
            </div>
          </CardContent>
        )}

        <CardContent className={showForm ? "pt-4 border-t" : ""}>
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-16 w-full" />)}
            </div>
          ) : goals.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Target className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm font-medium">No goals yet</p>
              <p className="text-xs mt-1">Create a goal to track your team's progress</p>
            </div>
          ) : (
            <div className="space-y-4">
              {goals.map((goal: any) => {
                const pct = Math.min(100, Math.round((Number(goal.currentValue ?? 0) / Number(goal.targetValue)) * 100));
                const isComplete = pct >= 100;
                return (
                  <div key={goal.id} className="rounded-lg border p-4 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium truncate">{goal.label}</p>
                        <p className="text-xs text-muted-foreground">
                          {GOAL_TYPE_LABELS[goal.goalType as GoalPayload["goalType"]] ?? goal.goalType}
                          {" · "}
                          {new Date(goal.periodStart).toLocaleDateString()} – {new Date(goal.periodEnd).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {isComplete && (
                          <Badge variant="default" className="bg-green-600 text-white text-xs">Complete</Badge>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          onClick={() => deleteGoal.mutate(goal.id)}
                          disabled={deleteGoal.isPending}
                        >
                          <X className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Progress value={pct} className="h-2" />
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>{Number(goal.currentValue ?? 0).toLocaleString()} / {Number(goal.targetValue).toLocaleString()}</span>
                        <span className={isComplete ? "text-green-600 font-semibold" : ""}>{pct}%</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── API Key Manager ────────────────────────────────────────────────────────────

interface OrgApiKey {
  id: number;
  name: string;
  keyPrefix: string;
  scope: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  isRevoked: boolean;
  createdAt: string;
}

function ApiKeyManager() {
  const { toast } = useToast();
  const [showCreate, setShowCreate] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyScope, setNewKeyScope] = useState<"read" | "write" | "admin">("read");
  const [newKeyExpiry, setNewKeyExpiry] = useState<string>("never");
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [revokeId, setRevokeId] = useState<number | null>(null);

  const { data: keys = [], isLoading, refetch } = useQuery<OrgApiKey[]>({
    queryKey: ["/api/org/api-keys"],
    queryFn: async () => {
      const res = await fetch("/api/org/api-keys", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load API keys");
      return res.json();
    },
  });

  const createKey = useMutation({
    mutationFn: async () => {
      const expiresInDays = newKeyExpiry === "never" ? null : parseInt(newKeyExpiry);
      const res = await apiRequest("POST", "/api/org/api-keys", {
        name: newKeyName,
        scope: newKeyScope,
        expiresInDays,
      });
      return res.json() as Promise<OrgApiKey & { key: string }>;
    },
    onSuccess: (data) => {
      setCreatedKey((data as any).key);
      setShowCreate(false);
      setNewKeyName("");
      refetch();
    },
    onError: () => toast({ title: "Failed to create API key", variant: "destructive" }),
  });

  const revokeKey = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/org/api-keys/${id}`, undefined);
      return res.json();
    },
    onSuccess: () => {
      setRevokeId(null);
      refetch();
      toast({ title: "API key revoked" });
    },
    onError: () => toast({ title: "Failed to revoke key", variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <Code className="w-5 h-5" />
            API Keys
          </h2>
          <p className="text-muted-foreground text-sm">
            Create API keys to let external tools access your AcreOS data.
          </p>
        </div>
        <Button size="sm" onClick={() => setShowCreate(true)} data-testid="button-create-api-key">
          <Plus className="w-4 h-4 mr-1" /> Create Key
        </Button>
      </div>

      {/* Newly created key — show once */}
      {createdKey && (
        <Card className="border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-emerald-700 dark:text-emerald-400 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4" /> API key created — copy it now, it won't be shown again
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs bg-muted rounded px-2 py-1.5 font-mono break-all">{createdKey}</code>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  navigator.clipboard.writeText(createdKey);
                  toast({ title: "Copied to clipboard" });
                }}
              >
                Copy
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setCreatedKey(null)}>
                <X className="w-4 h-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Create form */}
      {showCreate && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">New API Key</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>Name</Label>
              <Input
                placeholder="e.g. Zapier integration"
                value={newKeyName}
                onChange={e => setNewKeyName(e.target.value)}
                className="mt-1"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Scope</Label>
                <Select value={newKeyScope} onValueChange={(v: any) => setNewKeyScope(v)}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="read">Read</SelectItem>
                    <SelectItem value="write">Write</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Expiry</Label>
                <Select value={newKeyExpiry} onValueChange={setNewKeyExpiry}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="never">Never</SelectItem>
                    <SelectItem value="30">30 days</SelectItem>
                    <SelectItem value="60">60 days</SelectItem>
                    <SelectItem value="90">90 days</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                onClick={() => createKey.mutate()}
                disabled={!newKeyName.trim() || createKey.isPending}
              >
                {createKey.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                Create
              </Button>
              <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Keys list */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 text-sm text-muted-foreground">Loading keys…</div>
          ) : keys.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              No API keys yet. Create one above to get started.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Key</TableHead>
                  <TableHead>Scope</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Last used</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {keys.map(k => (
                  <TableRow key={k.id}>
                    <TableCell className="font-medium">{k.name}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{k.keyPrefix}…</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="text-xs capitalize">{k.scope}</Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {k.createdAt ? new Date(k.createdAt).toLocaleDateString() : "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleDateString() : "Never"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {k.expiresAt ? new Date(k.expiresAt).toLocaleDateString() : "Never"}
                    </TableCell>
                    <TableCell>
                      {revokeId === k.id ? (
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => revokeKey.mutate(k.id)}
                            disabled={revokeKey.isPending}
                          >
                            Confirm
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setRevokeId(null)}>
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive hover:text-destructive"
                          onClick={() => setRevokeId(k.id)}
                        >
                          Revoke
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Activity Audit Log Panel ───────────────────────────────────────────────────

interface AuditLogEntry {
  id: number;
  userId: string | null;
  action: string;
  entityType: string;
  entityId: number | null;
  changes: Record<string, any> | null;
  ipAddress: string | null;
  metadata: Record<string, any> | null;
  createdAt: string;
}

function ActivityLogPanel() {
  const { data: entries = [], isLoading } = useQuery<AuditLogEntry[]>({
    queryKey: ["/api/org/activity-log"],
    queryFn: async () => {
      const res = await fetch("/api/org/activity-log", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load activity log");
      return res.json();
    },
  });

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <Shield className="w-5 h-5" />
          Activity Log
        </h2>
        <p className="text-muted-foreground text-sm">
          Last 50 actions performed in your organization.
        </p>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 text-sm text-muted-foreground">Loading…</div>
          ) : entries.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">No activity recorded yet.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Entity</TableHead>
                  <TableHead>User</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map(e => (
                  <TableRow key={e.id}>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(e.createdAt).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs capitalize">{e.action}</Badge>
                    </TableCell>
                    <TableCell className="text-sm">
                      <span className="capitalize">{e.entityType}</span>
                      {e.entityId && <span className="text-muted-foreground ml-1">#{e.entityId}</span>}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {e.userId ? e.userId.slice(0, 8) + "…" : "System"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
