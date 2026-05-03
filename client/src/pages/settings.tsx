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
  useUpdateTeamMemberViewOnly,
  useUserPermissions,
  useOrgCoOwners,
  useAddOrgCoOwner,
  useRemoveOrgCoOwner,
  getRoleLabel,
  getRoleBadgeStyle,
  type Role
} from "@/hooks/use-organization";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Building2, Crown, Check, ExternalLink, CreditCard, Loader2, Lightbulb, RotateCcw, Database, Trash2, BarChart3, Users, Home, FileText, Sparkles, TrendingUp, Coins, Shield, Mail, Phone, Bell, Code, Settings as SettingsIcon, Gift, Link2, AlertCircle, CheckCircle2, Clock, RefreshCw, Unlink, Wallet, Target, Plus, X, Calendar, Zap, Download, AlertTriangle, Lock, Bot } from "lucide-react";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
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
import { WorkflowsSettingsTab } from "@/components/workflows-settings-tab";
import { PaxTasksSettingsTab } from "@/components/pax-tasks-settings-tab";
import { ProviderSettings } from "@/components/provider-settings";
import { AICostDashboard } from "@/components/ai-cost-dashboard";
import { ByokSettings } from "@/components/settings/ByokSettings";
import { TeamInviteCard } from "@/components/settings/TeamInviteCard";
// ThemeSettings (dialog quick-picker) is intended for top-bar mount in Phase E;
// the full Settings → Appearance surface uses AppearancePanel below.
import { AppearancePanel } from "@/components/settings/appearance-panel";
import { PersonaPanel } from "@/components/settings/persona-panel";
import { NotificationQuietHours } from "@/components/settings/notification-quiet-hours";
import { AutonomyPanel } from "@/components/settings/autonomy-panel";
import { useFlag } from "@/contexts/feature-flags-context";
import { PreferencesCard } from "@/components/preferences-card";
import { PlanComparisonModal, type TierKey } from "@/components/tier-upgrade-panel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useState, useEffect } from "react";
// R4: Clerk-native MFA management — replaces the deleted in-house TOTP flow.
import { UserProfile, useUser } from "@clerk/react";
import { useLocation } from "wouter";
import { useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { UserPlus, XCircle } from "lucide-react";
import { CancellationDialog } from "@/components/cancellation-dialog";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/use-auth";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { usd } from "@/lib/format";
import { Verbs } from "@/lib/labels";
import "./today.css";

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

// ─────────────────────────────────────────────────────────────────────────
// IA collapse — Phase 2 Week 4 (P1-26 / Reyna §2). 17 tabs → 7 canonical
// buckets so settings stops feeling like a federation of unrelated files.
//
// Old tab          →  New canonical bucket
// ──────────────────────────────────────────
// general          →  account            (profile + org details overview)
// security         →  security           (Clerk MFA + sessions + audit)
// privacy          →  account            (data rights, export, delete)
// referral         →  account            (refer & earn — personal action)
// appearance       →  account            (theme + language + accessibility)
// autonomy         →  integrations       (per-agent autonomy lives w/ AI)
// goals            →  organization       (org-scoped goals)
// notifications    →  notifications      (channel matrix)
// communications   →  notifications      (email/SMS/mail provider config)
// team             →  organization       (members + roles + ownership)
// payments         →  billing            (Stripe Connect + plan)
// data             →  tax-compliance     (compliance settings live here +
//                                         custom fields + import/export)
// integrations     →  integrations       (BYOK + provider connections)
// automations      →  integrations       (workflow rules)
// developer        →  integrations       (API keys + audit log)
// ai               →  integrations       (AI cost + provider settings)
// ai-tasks         →  integrations       (Pax tasks)
//
// Legacy `?tab=` query params auto-rewrite to the canonical bucket via
// LEGACY_TO_CANONICAL below — every old deep link still lands somewhere
// sensible.
//
// Tax & Compliance is a NEW bucket (no legacy 1:1) because the
// onboarding-tax-identity merge added /settings/tax-identity but never
// surfaced an entry point in the main settings tabs (Reyna §2 gap).
// ─────────────────────────────────────────────────────────────────────────
const VALID_TABS = [
  "account",
  "security",
  "organization",
  "billing",
  "tax-compliance",
  "notifications",
  "integrations",
] as const;
type TabValue = typeof VALID_TABS[number];

const LEGACY_TO_CANONICAL: Record<string, TabValue> = {
  // legacy → canonical
  general: "account",
  privacy: "account",
  referral: "account",
  appearance: "account",
  autonomy: "integrations",
  goals: "organization",
  communications: "notifications",
  team: "organization",
  payments: "billing",
  data: "tax-compliance",
  automations: "integrations",
  developer: "integrations",
  ai: "integrations",
  "ai-tasks": "integrations",
};

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
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);

  const { data: connectStatus, isLoading: statusLoading, refetch } = useQuery<StripeConnectStatusResponse>({
    queryKey: ["/api/stripe/connect/status"],
  });

  const connectMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/stripe/connect/link", {});
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      return res.json();
    },
    onSuccess: (data) => {
      if (data.onboardingUrl) {
        window.location.href = data.onboardingUrl;
      }
    },
    onError: (error: any) => {
      toast({
        title: "Couldn't start Stripe onboarding",
        description: error?.message || "Check your connection and try again — your Stripe connection is unchanged.",
        variant: "destructive",
      });
    },
  });

  const refreshMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/stripe/connect/refresh", {});
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
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
        title: "Couldn't refresh Stripe status",
        description: error?.message || "Check your connection and try again.",
        variant: "destructive",
      });
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/stripe/connect/disconnect", {});
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/stripe/connect/status"] });
      setShowDisconnectConfirm(false);
      toast({
        title: "Stripe disconnected",
        description: "Your Stripe account has been disconnected.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Couldn't disconnect Stripe",
        description: error?.message || "Check your connection and try again — your Stripe account is still connected.",
        variant: "destructive",
      });
    },
  });

  const getStatusDisplay = () => {
    if (!connectStatus) return { label: "Not connected", icon: AlertCircle, color: "text-muted-foreground" };

    if (!connectStatus.isConnected) {
      return { label: "Not connected", icon: AlertCircle, color: "text-muted-foreground" };
    }

    if (!connectStatus.detailsSubmitted) {
      return { label: "Onboarding required", icon: Clock, color: "text-acr-warn" };
    }

    if (!connectStatus.chargesEnabled) {
      return { label: "Pending verification", icon: Clock, color: "text-acr-warn" };
    }

    return { label: "Active", icon: CheckCircle2, color: "text-acr-pos" };
  };
  
  const status = getStatusDisplay();
  const StatusIcon = status.icon;

  if (statusLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wallet className="w-5 h-5" aria-hidden="true" />
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
          <Wallet className="w-5 h-5" aria-hidden="true" />
          Stripe Connect
        </CardTitle>
        <CardDescription>
          Connect your Stripe account to receive payments from borrowers and buyers.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <StatusIcon className={`w-5 h-5 ${status.color}`} aria-hidden="true" />
            <div>
              <p className="font-medium">Connection status</p>
              <p className={`text-sm ${status.color}`} data-testid="text-stripe-status">
                {status.label}
              </p>
            </div>
          </div>

          {connectStatus?.isConnected && connectStatus.accountId && (
            <div className="text-right">
              <p className="text-sm text-muted-foreground">Account ID</p>
              <p className="font-mono text-sm tabular-nums" data-testid="text-stripe-account-id">
                {connectStatus.accountId}
              </p>
            </div>
          )}
        </div>

        {connectStatus?.isConnected && (
          <dl className="grid grid-cols-2 md:grid-cols-3 gap-4 pt-4 border-t">
            <div className="space-y-1">
              <dt className="text-sm text-muted-foreground">Charges</dt>
              <dd className="flex items-center gap-1">
                {connectStatus.chargesEnabled ? (
                  <CheckCircle2 className="w-4 h-4 text-acr-pos" aria-hidden="true" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-acr-warn" aria-hidden="true" />
                )}
                <span className="text-sm font-medium">
                  {connectStatus.chargesEnabled ? "Enabled" : "Pending"}
                </span>
              </dd>
            </div>
            <div className="space-y-1">
              <dt className="text-sm text-muted-foreground">Payouts</dt>
              <dd className="flex items-center gap-1">
                {connectStatus.payoutsEnabled ? (
                  <CheckCircle2 className="w-4 h-4 text-acr-pos" aria-hidden="true" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-acr-warn" aria-hidden="true" />
                )}
                <span className="text-sm font-medium">
                  {connectStatus.payoutsEnabled ? "Enabled" : "Pending"}
                </span>
              </dd>
            </div>
            <div className="space-y-1">
              <dt className="text-sm text-muted-foreground">Onboarding</dt>
              <dd className="flex items-center gap-1">
                {connectStatus.detailsSubmitted ? (
                  <CheckCircle2 className="w-4 h-4 text-acr-pos" aria-hidden="true" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-acr-warn" aria-hidden="true" />
                )}
                <span className="text-sm font-medium">
                  {connectStatus.detailsSubmitted ? "Complete" : "Incomplete"}
                </span>
              </dd>
            </div>
          </dl>
        )}

        {connectStatus?.requirements && connectStatus.requirements.currentlyDue.length > 0 && (
          <div
            className="p-4 rounded-md bg-acr-warn/10 border border-acr-warn/20"
            role="status"
            aria-live="polite"
          >
            <p className="font-medium text-acr-warn flex items-center gap-2">
              <AlertCircle className="w-4 h-4" aria-hidden="true" />
              Action required
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              Complete your Stripe onboarding to enable payments. Click &ldquo;Complete onboarding&rdquo; below.
            </p>
          </div>
        )}

        <div className="flex flex-wrap gap-3 pt-4 border-t">
          {!connectStatus?.isConnected ? (
            <Button
              onClick={() => connectMutation.mutate()}
              disabled={connectMutation.isPending}
              className="min-h-11 sm:min-h-9"
              data-testid="button-connect-stripe"
            >
              {connectMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />
              ) : (
                <Link2 className="w-4 h-4 mr-2" aria-hidden="true" />
              )}
              Connect Stripe account
            </Button>
          ) : (
            <>
              {!connectStatus.detailsSubmitted && (
                <Button
                  onClick={() => connectMutation.mutate()}
                  disabled={connectMutation.isPending}
                  className="min-h-11 sm:min-h-9"
                  data-testid="button-complete-onboarding"
                >
                  {connectMutation.isPending ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />
                  ) : (
                    <ExternalLink className="w-4 h-4 mr-2" aria-hidden="true" />
                  )}
                  Complete onboarding
                </Button>
              )}

              <Button
                variant="outline"
                onClick={() => refreshMutation.mutate()}
                disabled={refreshMutation.isPending}
                className="min-h-11 sm:min-h-9"
                data-testid="button-refresh-stripe-status"
              >
                {refreshMutation.isPending ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />
                ) : (
                  <RefreshCw className="w-4 h-4 mr-2" aria-hidden="true" />
                )}
                Refresh status
              </Button>

              <Button
                variant="outline"
                onClick={() => setShowDisconnectConfirm(true)}
                disabled={disconnectMutation.isPending}
                className="min-h-11 sm:min-h-9"
                data-testid="button-disconnect-stripe"
              >
                {disconnectMutation.isPending ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />
                ) : (
                  <Unlink className="w-4 h-4 mr-2" aria-hidden="true" />
                )}
                Disconnect
              </Button>
            </>
          )}
        </div>

        <div className="pt-4 border-t">
          <p className="text-sm text-muted-foreground">
            <strong>Platform fee:</strong> a 2.5% platform fee is applied to all payments processed through AcreOS.
            This covers payment processing, automated payment collection, and platform infrastructure.
          </p>
        </div>
      </CardContent>

      <ConfirmDialog
        open={showDisconnectConfirm}
        onOpenChange={setShowDisconnectConfirm}
        title="Disconnect your Stripe account?"
        description="You won't be able to collect new payments through AcreOS until you reconnect. Pending payments already in Stripe will continue to process normally. You can reconnect at any time."
        confirmLabel="Disconnect Stripe"
        cancelLabel="Keep connected"
        variant="destructive"
        isLoading={disconnectMutation.isPending}
        onConfirm={() => disconnectMutation.mutate()}
      />
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
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      return res.json();
    },
    onSuccess: (data) => {
      if (data.url) {
        window.location.href = data.url;
      }
    },
    onError: (error: any) => {
      toast({
        title: "Couldn't start seat purchase",
        description: error?.message || "Check your connection and try again — no card was charged and your seat count is unchanged.",
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
            <Users className="w-5 h-5" aria-hidden="true" />
            Seat management
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
          <Users className="w-5 h-5" aria-hidden="true" />
          Seat management
        </CardTitle>
        <CardDescription>Manage your team seat allocation.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="space-y-1">
            <dt className="text-sm text-muted-foreground">Included seats</dt>
            <dd className="text-2xl font-semibold tabular-nums" data-testid="text-included-seats">
              {seatInfo?.includedSeats ?? 0}
            </dd>
          </div>
          <div className="space-y-1">
            <dt className="text-sm text-muted-foreground">Additional seats</dt>
            <dd className="text-2xl font-semibold tabular-nums" data-testid="text-additional-seats">
              {seatInfo?.additionalSeats ?? 0}
            </dd>
          </div>
          <div className="space-y-1">
            <dt className="text-sm text-muted-foreground">Used</dt>
            <dd className="text-2xl font-semibold tabular-nums" data-testid="text-used-seats">
              {seatInfo?.usedSeats ?? 0} / {seatInfo?.totalSeats ?? 0}
            </dd>
          </div>
          <div className="space-y-1">
            <dt className="text-sm text-muted-foreground">Available</dt>
            <dd className="text-2xl font-semibold tabular-nums text-acr-pos" data-testid="text-available-seats">
              {seatInfo?.availableSeats ?? 0}
            </dd>
          </div>
        </dl>

        {seatInfo && seatInfo.totalSeats > 0 && (
          <Progress
            value={(seatInfo.usedSeats / seatInfo.totalSeats) * 100}
            className="h-2"
            aria-label={`Seat usage: ${seatInfo.usedSeats} of ${seatInfo.totalSeats} seats in use`}
          />
        )}

        {seatInfo?.hasTeamMessaging && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Check className="w-4 h-4 text-acr-pos" aria-hidden="true" />
            Team messaging enabled (2+ seats)
          </div>
        )}

        {seatPricing?.canPurchaseSeats && seatInfo?.canAddSeats && (
          <div className="pt-4 border-t space-y-4">
            <h4 className="font-medium">Add more seats</h4>
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
                  className="w-20 tabular-nums"
                  inputMode="numeric"
                  data-testid="input-seat-quantity"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="select-billing-period">Billing</Label>
                <Select value={billingPeriod} onValueChange={(v) => setBillingPeriod(v as "monthly" | "yearly")}>
                  <SelectTrigger id="select-billing-period" className="w-28" data-testid="select-billing-period">
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
                <p className="text-lg font-semibold tabular-nums" data-testid="text-seat-price">
                  {billingPeriod === "monthly"
                    ? `${formatPrice((seatPricing.monthly?.amount ?? 0) * seatQuantity)}/mo`
                    : `${formatPrice((seatPricing.yearly?.amount ?? 0) * seatQuantity)}/yr`
                  }
                </p>
              </div>
              <Button
                onClick={handlePurchaseSeats}
                disabled={purchaseSeatsMutation.isPending || !seatQuantity}
                className="min-h-11 sm:min-h-9"
                data-testid="button-purchase-seats"
                aria-label={`Add ${seatQuantity} ${billingPeriod} seat${seatQuantity === 1 ? "" : "s"}`}
              >
                {purchaseSeatsMutation.isPending ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />
                ) : (
                  <UserPlus className="w-4 h-4 mr-2" aria-hidden="true" />
                )}
                Add seats
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
  useDocumentTitle("Settings — AcreOS");
  const { toast } = useToast();
  const [location, setLocation] = useLocation();
  const search = useSearch();
  const searchParams = new URLSearchParams(search);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showPlanComparison, setShowPlanComparison] = useState(false);
  const [planPickerHighlight, setPlanPickerHighlight] = useState<TierKey | null>(null);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  // Feature flag — autonomy matrix is founder-only by default per
  // design-system §8.4. Tab + content hidden when flag is off; founder
  // toggles state via /founder/features.
  const autonomyFlag = useFlag("feature.autonomy-matrix");

  const getTabFromHash = (): TabValue => {
    const hash = window.location.hash.replace("#", "");
    // Legacy hashes from the 17-tab era — rewrite to canonical bucket.
    if (hash in LEGACY_TO_CANONICAL) {
      return LEGACY_TO_CANONICAL[hash];
    }
    if (VALID_TABS.includes(hash as TabValue)) {
      return hash as TabValue;
    }
    return "account";
  };

  const [activeTab, setActiveTab] = useState<TabValue>(getTabFromHash);

  useEffect(() => {
    // Auto-show plan comparison when arriving via #billing (from upgrade toast).
    // Note: "billing" is now itself a canonical tab (no more "payments" alias).
    const hash = window.location.hash.replace("#", "");
    if (hash === "billing" || hash === "payments") {
      setShowPlanComparison(true);
    }
  }, []);

  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.replace("#", "");
      setActiveTab(getTabFromHash());
      if (hash === "billing" || hash === "payments") {
        setShowPlanComparison(true);
      }
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
  const { data: coOwners, isLoading: coOwnersLoading } = useOrgCoOwners();

  const checkoutMutation = useCreateCheckoutSession();
  const portalMutation = useCreatePortalSession();
  const updateOrgMutation = useUpdateOrganization();
  const updateRoleMutation = useUpdateTeamMemberRole();
  const updateViewOnlyMutation = useUpdateTeamMemberViewOnly();
  const addCoOwnerMutation = useAddOrgCoOwner();
  const removeCoOwnerMutation = useRemoveOrgCoOwner();
  const [coOwnerCandidate, setCoOwnerCandidate] = useState<string>("");
  
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
    onError: (err: any) => {
      toast({
        title: "Couldn't create demo data",
        description: err?.message || "Check your connection and try again.",
        variant: "destructive",
      });
    },
  });

  const clearDataMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/clear-demo-data", {});
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
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
    onError: (err: any) => {
      toast({
        title: "Couldn't clear data",
        description: err?.message || "Check your connection and try again.",
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
    <PageShell label="Settings" maxWidth="4xl">
          <div className="acr-cc-hero" style={{ marginTop: 0 }}>
            <div>
              <div className="acr-eyebrow">Settings</div>
              <h1 className="acr-cc-greeting" data-testid="text-settings-title">
                Tune the workspace.
                <span className="acr-cc-greeting-soft">
                  {" "}Organization, team, and personal preferences.
                </span>
              </h1>
            </div>
          </div>

          {/* Mobile jump-menu — 17 tabs grouped into six clusters via Radix
             SelectGroup. Group labels make the long list scannable at 375px
             rather than a flat alphabetical-ish run. Desktop unchanged. */}
          <div className="md:hidden mb-4">
            <Select value={activeTab} onValueChange={handleTabChange}>
              <SelectTrigger className="w-full" aria-label="Settings section">
                <SelectValue placeholder="Choose a section" />
              </SelectTrigger>
              <SelectContent>
                {/* IA collapse — 7 canonical buckets. Legacy values
                    auto-rewrite via LEGACY_TO_CANONICAL. */}
                <SelectItem value="account">Account</SelectItem>
                <SelectItem value="security">Security</SelectItem>
                <SelectItem value="organization">Organization</SelectItem>
                <SelectItem value="billing">Billing</SelectItem>
                <SelectItem value="tax-compliance">Tax &amp; Compliance</SelectItem>
                <SelectItem value="notifications">Notifications</SelectItem>
                <SelectItem value="integrations">Integrations</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
            <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0 hidden md:block">
              {/* IA collapse — 17 tabs → 7 canonical buckets (P1-26 / Reyna §2).
                  See LEGACY_TO_CANONICAL above for the migration map; old
                  hashes auto-rewrite so deep links keep working. */}
              <TabsList className="inline-flex w-auto min-w-full md:min-w-0" data-testid="tabs-settings">
                <TabsTrigger value="account" data-testid="tab-account" className="gap-1">
                  <SettingsIcon className="w-4 h-4 hidden sm:inline" aria-hidden="true" />
                  Account
                </TabsTrigger>
                <TabsTrigger value="security" data-testid="tab-security" className="gap-1">
                  <Shield className="w-4 h-4 hidden sm:inline" aria-hidden="true" />
                  Security
                </TabsTrigger>
                <TabsTrigger value="organization" data-testid="tab-organization" className="gap-1">
                  <Users className="w-4 h-4 hidden sm:inline" aria-hidden="true" />
                  Organization
                </TabsTrigger>
                <TabsTrigger value="billing" data-testid="tab-billing" className="gap-1">
                  <Wallet className="w-4 h-4 hidden sm:inline" aria-hidden="true" />
                  Billing
                </TabsTrigger>
                <TabsTrigger value="tax-compliance" data-testid="tab-tax-compliance" className="gap-1">
                  <FileText className="w-4 h-4 hidden sm:inline" aria-hidden="true" />
                  Tax &amp; Compliance
                </TabsTrigger>
                <TabsTrigger value="notifications" data-testid="tab-notifications" className="gap-1">
                  <Bell className="w-4 h-4 hidden sm:inline" aria-hidden="true" />
                  Notifications
                </TabsTrigger>
                <TabsTrigger value="integrations" data-testid="tab-integrations" className="gap-1">
                  <Link2 className="w-4 h-4 hidden sm:inline" aria-hidden="true" />
                  Integrations
                </TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="account" className="space-y-8 mt-6" data-testid="tab-content-account">
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
                    <div className="space-y-3">
                      <Skeleton className="h-6 w-48" />
                      <Skeleton className="h-4 w-32" />
                      <Skeleton className="h-4 w-40" />
                    </div>
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
                        <Skeleton className="h-10 w-48" />
                      ) : subscriptionData?.subscription ? (
                        <div className="flex flex-col gap-2 pt-2">
                          <span className="text-sm text-muted-foreground">Current period</span>
                          <span className="text-sm tabular-nums" data-testid="text-subscription-period">
                            {new Date(subscriptionData.subscription.current_period_start * 1000).toLocaleDateString()} &ndash; {new Date(subscriptionData.subscription.current_period_end * 1000).toLocaleDateString()}
                          </span>
                          <div className="flex gap-2">
                            <Button
                              variant="outline"
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
                              className="text-muted-foreground hover:text-destructive"
                              onClick={() => setShowCancelDialog(true)}
                              aria-label="Cancel subscription"
                            >
                              <XCircle className="w-4 h-4 mr-1" aria-hidden="true" />
                              Cancel
                            </Button>
                          </div>
                          <CancellationDialog
                            open={showCancelDialog}
                            onOpenChange={setShowCancelDialog}
                            currentTier={organization.subscriptionTier || "free"}
                            // Vesper §3 — wire "Downgrade instead" to the
                            // plan picker preselected to a lower tier.
                            // Canonical Tier (solo/operator/empire) maps to
                            // the modal's TierKey (starter/pro/free).
                            onDowngrade={(suggested) => {
                              const modalTier: TierKey =
                                suggested === "operator" ? "pro"
                                  : suggested === "solo" ? "starter"
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
                          { key: "notes" as const, label: "Notes", icon: FileText, description: "Active seller-finance notes" },
                          { key: "ai_requests" as const, label: "AI requests", icon: Sparkles, description: "Daily AI requests (resets at midnight)" },
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
                                    className="mt-2"
                                    onClick={() => document.getElementById("pricing-section")?.scrollIntoView({ behavior: "smooth" })}
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
                            title: "Couldn't reset onboarding",
                            description: "Your onboarding state is unchanged. Try again.",
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
                                        <Check className="w-4 h-4 text-acr-pos flex-shrink-0" />
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

              {/* Tax identity (org-side 1099 issuer fields) — owner-only edit. */}
              <Card data-testid="card-tax-identity-link">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Shield className="w-5 h-5" aria-hidden="true" />
                    Tax identity
                  </CardTitle>
                  <CardDescription>
                    Legal entity name, EIN/SSN/ITIN, and tax address used to
                    issue 1099-INT forms. Captured during onboarding —
                    editable by the owner anytime.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Button
                    variant="outline"
                    onClick={() => setLocation("/settings/tax-identity")}
                    data-testid="button-open-tax-identity"
                  >
                    Open Tax Identity
                    <ExternalLink className="w-4 h-4 ml-2" aria-hidden="true" />
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="organization" className="space-y-8 mt-6" data-testid="tab-content-organization">
              <TeamInviteCard />
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
                                              title: "Couldn't update role",
                                              description: `${error.message || "Try again"} — the member's existing role is unchanged.`,
                                              variant: "destructive",
                                            });
                                          },
                                        }
                                      );
                                    }}
                                    disabled={updateRoleMutation.isPending}
                                  >
                                    <SelectTrigger
                                      className="w-44 sm:w-56"
                                      aria-label={`Role for team member`}
                                      data-testid={`select-role-${member.id}`}
                                    >
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {userPermissions.role === "owner" && (
                                        <SelectItem value="owner">Owner — full access and billing</SelectItem>
                                      )}
                                      {/*
                                        Liana §1: only owner can grant `admin`.
                                        Admins see member↔va↔viewer in the
                                        dropdown but the server still rejects
                                        admin→admin escalation.
                                      */}
                                      {userPermissions.role === "owner" && (
                                        <SelectItem value="admin">Admin — manage team and data</SelectItem>
                                      )}
                                      <SelectItem value="member">Member — create and edit records</SelectItem>
                                      <SelectItem value="va">VA — assigned-leads-only by default</SelectItem>
                                      <SelectItem value="viewer">Viewer — read-only access</SelectItem>
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

              {/*
                Blanco §1: Co-Owners section. Owner-only management. The
                presence of a co-owner row is what unlocks dual-billing-card
                and dual-tax-contact UX downstream (those surfaces ship in
                a billing follow-up; this section just establishes the
                relation so the data exists when the UI catches up).
              */}
              {userPermissions?.role === "owner" && (
                <Card data-testid="card-co-owners">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Crown className="w-5 h-5" />
                      Co-Owners
                    </CardTitle>
                    <CardDescription>
                      Co-owners share billing and tax-contact responsibility for this
                      organization. Only the primary owner can add or remove them.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {coOwnersLoading ? (
                      <div className="space-y-2">
                        <Skeleton className="h-8 w-full" />
                        <Skeleton className="h-8 w-full" />
                      </div>
                    ) : coOwners && coOwners.length > 0 ? (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>User</TableHead>
                            <TableHead>Added</TableHead>
                            <TableHead className="w-24" />
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {coOwners.map((co) => {
                            const member = teamMembers?.find((m) => m.userId === co.userId);
                            return (
                              <TableRow key={co.id} data-testid={`row-co-owner-${co.id}`}>
                                <TableCell>
                                  <div>
                                    <p className="font-medium">
                                      {member?.displayName || member?.email || co.userId}
                                    </p>
                                    {member?.email && member.displayName && (
                                      <p className="text-xs text-muted-foreground">
                                        {member.email}
                                      </p>
                                    )}
                                  </div>
                                </TableCell>
                                <TableCell className="text-sm text-muted-foreground">
                                  {new Date(co.addedAt).toLocaleDateString()}
                                </TableCell>
                                <TableCell>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() =>
                                      removeCoOwnerMutation.mutate(
                                        { userId: co.userId },
                                        {
                                          onSuccess: () => {
                                            toast({
                                              title: "Co-owner removed",
                                              description: `${
                                                member?.displayName || co.userId
                                              } is no longer a co-owner.`,
                                            });
                                          },
                                          onError: (err) => {
                                            toast({
                                              title: "Couldn't remove co-owner",
                                              description: err.message || "Try again.",
                                              variant: "destructive",
                                            });
                                          },
                                        },
                                      )
                                    }
                                    disabled={removeCoOwnerMutation.isPending}
                                    aria-label={`Remove ${
                                      member?.displayName || co.userId
                                    } as co-owner`}
                                    data-testid={`button-remove-co-owner-${co.id}`}
                                  >
                                    <X className="w-4 h-4" />
                                  </Button>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    ) : (
                      <p className="text-muted-foreground text-sm">
                        No co-owners yet. Co-owners must already be team members.
                      </p>
                    )}

                    {teamMembers && teamMembers.length > 1 && (
                      <div className="flex items-end gap-2 pt-2 border-t">
                        <div className="flex-1 space-y-1.5">
                          <Label htmlFor="co-owner-candidate" className="text-sm">
                            Add a team member as co-owner
                          </Label>
                          <Select
                            value={coOwnerCandidate}
                            onValueChange={setCoOwnerCandidate}
                          >
                            <SelectTrigger
                              id="co-owner-candidate"
                              data-testid="select-co-owner-candidate"
                            >
                              <SelectValue placeholder="Select a team member" />
                            </SelectTrigger>
                            <SelectContent>
                              {teamMembers
                                .filter(
                                  (m) =>
                                    m.role !== "owner" &&
                                    !coOwners?.some((co) => co.userId === m.userId),
                                )
                                .map((m) => (
                                  <SelectItem key={m.id} value={m.userId}>
                                    {m.displayName || m.email || m.userId}
                                  </SelectItem>
                                ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <Button
                          onClick={() => {
                            if (!coOwnerCandidate) return;
                            addCoOwnerMutation.mutate(
                              { userId: coOwnerCandidate },
                              {
                                onSuccess: () => {
                                  setCoOwnerCandidate("");
                                  toast({
                                    title: "Co-owner added",
                                    description:
                                      "They now share billing and tax-contact responsibility.",
                                  });
                                },
                                onError: (err) => {
                                  toast({
                                    title: "Couldn't add co-owner",
                                    description: err.message || "Try again.",
                                    variant: "destructive",
                                  });
                                },
                              },
                            );
                          }}
                          disabled={!coOwnerCandidate || addCoOwnerMutation.isPending}
                          data-testid="button-add-co-owner"
                        >
                          <Plus className="w-4 h-4 mr-1" />
                          Add
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="billing" className="space-y-8 mt-6" data-testid="tab-content-billing">
              <StripeConnectSettings />
            </TabsContent>

            <TabsContent value="notifications" className="space-y-8 mt-6" data-testid="tab-content-notifications-comms">
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

            <TabsContent value="notifications" className="space-y-6 mt-6" data-testid="tab-content-notifications">
              <NotificationQuietHours />
              <NotificationPreferences />
            </TabsContent>

            <TabsContent value="integrations" className="space-y-8 mt-6" data-testid="tab-content-integrations-ai">
              <AICostDashboard />
              <AISettings />
              <div className="pt-4 border-t">
                <h3 className="text-lg font-semibold mb-4">Service Providers</h3>
                <ProviderSettings />
              </div>
            </TabsContent>

            <TabsContent value="tax-compliance" className="space-y-8 mt-6" data-testid="tab-content-tax-compliance">
              {/* Tax identity link card — surfaces /settings/tax-identity
                  (shipped during the onboarding-tax-identity merge but
                  never discoverably wired from this bucket). Reyna §2 gap.
                  Distinct testid from the legacy card under the Account
                  bucket so both can coexist while we sunset the old home. */}
              <Card data-testid="card-tax-compliance-identity">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <FileText className="w-5 h-5" aria-hidden="true" />
                    Tax identity (W-9)
                  </CardTitle>
                  <CardDescription>
                    Manage your W-9 tax identity and TIN for 1099 reporting. Required
                    for borrowers and any seller you pay {">"} $600 in a tax year.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Button
                    variant="outline"
                    onClick={() => setLocation("/settings/tax-identity")}
                    data-testid="button-tax-compliance-open-tax-identity"
                  >
                    <FileText className="w-4 h-4 mr-2" aria-hidden="true" />
                    Open tax identity settings
                    <ExternalLink className="w-3 h-3 ml-2" aria-hidden="true" />
                  </Button>
                </CardContent>
              </Card>

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

            <TabsContent value="account" className="space-y-8 mt-6" data-testid="tab-content-account-appearance">
              <div className="space-y-4">
                <div>
                  <h2 className="text-xl font-semibold flex items-center gap-2">
                    <SettingsIcon className="w-5 h-5" />
                    Appearance
                  </h2>
                  <p className="text-muted-foreground text-sm">
                    Five themes, five type pairings, and the small comforts that make
                    the workspace feel like yours.
                  </p>
                </div>
                <AppearancePanel />
                <PreferencesCard />
                {/* Investor persona — drives vocabulary swaps + onboarding
                    path. Sits in Workspace cluster alongside appearance
                    because both shape how the workspace feels. */}
                <PersonaPanel />
              </div>
            </TabsContent>

            {autonomyFlag && (
              <TabsContent value="integrations" className="space-y-8 mt-6" data-testid="tab-content-integrations-autonomy">
                <AutonomyPanel />
              </TabsContent>
            )}

            <TabsContent value="integrations" className="space-y-8 mt-6" data-testid="tab-content-integrations-developer">
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
            <TabsContent value="organization" className="space-y-6 mt-6" data-testid="tab-content-organization-goals">
              <GoalsSettings />
            </TabsContent>

            {/* ── Security Tab ─────────────────────────────────────────── */}
            <TabsContent value="security" className="space-y-6 mt-6" data-testid="tab-content-security">
              <TwoFactorAuthSettings />
              <PasswordChangeSettings />
            </TabsContent>

            {/* ── Privacy Tab ──────────────────────────────────────────── */}
            <TabsContent value="account" className="space-y-6 mt-6" data-testid="tab-content-account-privacy">
              <PrivacyDataSettings />
            </TabsContent>

            <TabsContent value="account" className="space-y-6 mt-6" data-testid="tab-content-account-referral">
              <ReferralSettings />
            </TabsContent>

            <TabsContent value="integrations" className="space-y-6 mt-6" data-testid="tab-content-integrations-automations">
              <WorkflowsSettingsTab />
            </TabsContent>

            <TabsContent value="integrations" className="space-y-6 mt-6" data-testid="tab-content-integrations-ai-tasks">
              <PaxTasksSettingsTab />
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
      <PlanComparisonModal
        open={showPlanComparison}
        onClose={() => {
          setShowPlanComparison(false);
          setPlanPickerHighlight(null);
        }}
        currentTier={(organization?.subscriptionTier || "free") as TierKey}
        highlightedTier={planPickerHighlight}
      />
    </PageShell>
  );
}

// ── Two-Factor Authentication Settings (Clerk-native, R4) ────────────────────
// AcreOS used to ship its own TOTP implementation under /api/auth/2fa/*, but
// it was wired against express-session (not installed) and a `users` table
// that didn't actually have the 2FA columns — so the flow was non-functional
// end-to-end. R4 deletes that stack and delegates MFA enrollment / verify /
// disable to Clerk's hosted UserProfile UI. Clerk owns the TOTP secret, the
// SMS factor, and the backup codes; AcreOS just enforces verified-this-session
// at the API edge via requireClerkMFA.
//
// The `<UserProfile />` component shows the full Clerk account UI (email,
// password, MFA, connected accounts) inside a dialog — the cleanest way to
// give the user the security flows they expect without re-implementing TOTP.

function TwoFactorAuthSettings() {
  const { user, isLoaded } = useUser();
  const [showProfile, setShowProfile] = useState(false);

  const twoFactorEnabled = Boolean(user?.twoFactorEnabled);

  return (
    <Card data-testid="card-2fa-settings">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Shield className="w-5 h-5" aria-hidden="true" />
          Two-factor authentication
        </CardTitle>
        <CardDescription>
          Add an extra layer of security with an authenticator app (Google Authenticator, Authy, 1Password) or SMS code. Managed through your Clerk account.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!isLoaded ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
            Loading account…
          </div>
        ) : twoFactorEnabled ? (
          <div className="flex items-center gap-2 text-acr-pos" role="status">
            <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
            <span className="text-sm font-medium">2FA is enabled</span>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            2FA is not enabled. Some admin areas (recovery console, ownership transfer) require it.
          </p>
        )}

        <Button
          size="sm"
          variant={twoFactorEnabled ? "outline" : "default"}
          className="min-h-11 sm:min-h-9"
          onClick={() => setShowProfile(true)}
          data-testid="button-manage-2fa"
        >
          {twoFactorEnabled ? "Manage 2FA" : "Set up 2FA"}
        </Button>

        <Dialog open={showProfile} onOpenChange={setShowProfile}>
          <DialogContent className="sm:max-w-3xl p-0 overflow-hidden">
            <DialogHeader className="sr-only">
              <DialogTitle>Account security</DialogTitle>
              <DialogDescription>
                Manage your password, two-factor authentication factors, and connected accounts through Clerk.
              </DialogDescription>
            </DialogHeader>
            <div className="max-h-[80vh] overflow-y-auto">
              <UserProfile routing="virtual" />
            </div>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

// ── Password Change Settings ──────────────────────────────────────────────────

function PasswordChangeSettings() {
  const { toast } = useToast();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const changeMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/auth/change-password", { currentPassword, newPassword }).then(r => r.json()),
    onSuccess: () => {
      toast({ title: "Password changed" });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    },
    onError: (err: any) =>
      toast({
        title: "Couldn't change password",
        description: err?.message || "Check your current password and try again — your password hasn't changed.",
        variant: "destructive",
      }),
  });

  const passwordsMatch = !confirmPassword || newPassword === confirmPassword;
  const valid = !!currentPassword && newPassword.length >= 8 && newPassword === confirmPassword;

  return (
    <Card data-testid="card-password-change">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Shield className="w-5 h-5" aria-hidden="true" />
          Change password
        </CardTitle>
        <CardDescription>Update your account password. Use at least 8 characters.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-3 max-w-sm"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid && !changeMutation.isPending) changeMutation.mutate();
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="current-password">Current password</Label>
            <Input
              id="current-password"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={e => setCurrentPassword(e.target.value)}
              data-testid="input-current-password"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="new-password">New password</Label>
            <Input
              id="new-password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              data-testid="input-new-password"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="confirm-password">Confirm new password</Label>
            <Input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              aria-invalid={!passwordsMatch}
              aria-describedby={!passwordsMatch ? "confirm-password-error" : undefined}
              data-testid="input-confirm-password"
            />
            {!passwordsMatch && (
              <p id="confirm-password-error" className="text-xs text-destructive" role="alert">
                The two passwords don't match. Please retype them.
              </p>
            )}
          </div>
          <Button
            type="submit"
            size="sm"
            className="min-h-11 sm:min-h-9"
            disabled={!valid || changeMutation.isPending}
            data-testid="button-change-password"
          >
            {changeMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" /> : null}
            Change password
          </Button>
        </form>
      </CardContent>
    </Card>
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
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      return res.json();
    },
  });

  const statsQuery = useQuery<{ signups: number; conversions: number; creditsEarned: number; creditBalance: number }>({
    queryKey: ["/api/referral/stats"],
    queryFn: async () => {
      const res = await fetch("/api/referral/stats", { credentials: "include" });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      return res.json();
    },
  });

  const referralLink = codeQuery.data?.code
    ? `${appUrl}/?ref=${codeQuery.data.code}`
    : "";

  const copyLink = () => {
    if (!referralLink) return;
    navigator.clipboard.writeText(referralLink).then(() => {
      toast({ title: "Referral link copied to clipboard" });
    });
  };

  const stats = statsQuery.data;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Gift className="w-5 h-5" aria-hidden="true" />
            Refer &amp; earn
          </CardTitle>
          <CardDescription>
            Share AcreOS with fellow Land Investors. They get 30 days free — you get $20 account credit when they subscribe.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Offer callout */}
          <div className="rounded-xl bg-primary/5 border border-primary/20 p-4 flex items-start gap-3">
            <Gift className="w-5 h-5 text-primary shrink-0 mt-0.5" aria-hidden="true" />
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
            <Label htmlFor="input-referral-link" className="text-sm font-medium">Your referral link</Label>
            {codeQuery.isLoading ? (
              <Skeleton className="h-10 w-full" />
            ) : codeQuery.isError ? (
              <div
                role="alert"
                className="flex items-start gap-2 p-3 rounded-md border border-destructive/50 bg-destructive/5 text-sm"
              >
                <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" aria-hidden="true" />
                <div className="flex-1">
                  <p className="text-foreground">Couldn't load your referral link.</p>
                  <Button size="sm" variant="outline" className="mt-2" onClick={() => codeQuery.refetch()}>
                    <RefreshCw className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" />
                    Try again
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex gap-2">
                <Input
                  id="input-referral-link"
                  readOnly
                  value={referralLink}
                  className="font-mono text-sm"
                  onFocus={(e) => e.currentTarget.select()}
                  data-testid="input-referral-link"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={copyLink}
                  className="shrink-0 min-h-11 sm:min-h-9"
                  aria-label="Copy referral link to clipboard"
                >
                  <Link2 className="w-4 h-4 mr-1" aria-hidden="true" />
                  Copy
                </Button>
              </div>
            )}
          </div>

          {/* Stats */}
          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: "Signups", value: stats?.signups ?? 0, icon: Users, isMoney: false },
              { label: "Converted", value: stats?.conversions ?? 0, icon: CheckCircle2, isMoney: false },
              { label: "Credits earned", value: stats ? usd(stats.creditsEarned / 100, { noCents: true }) : "$0", icon: Coins, isMoney: true },
              { label: "Available credit", value: stats ? usd(stats.creditBalance / 100, { noCents: true }) : "$0", icon: Wallet, isMoney: true },
            ].map(({ label, value, icon: Icon }) => (
              <div key={label} className="rounded-lg border border-border/60 bg-card p-4 space-y-1 text-center">
                <Icon className="w-4 h-4 text-primary mx-auto" aria-hidden="true" />
                <dd className="text-2xl font-bold tabular-nums">{statsQuery.isLoading ? "—" : value}</dd>
                <dt className="text-xs text-muted-foreground">{label}</dt>
              </div>
            ))}
          </dl>

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
  deals_closed: "Deals closed",
  notes_deployed: "Notes deployed",
  revenue_earned: "Revenue earned ($)",
  leads_contacted: "Leads contacted",
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
    onError: (err: any) =>
      toast({
        title: "Couldn't create goal",
        description: err?.message || "Check your connection and try again — no goal was created.",
        variant: "destructive",
      }),
  });

  const deleteGoal = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/goals/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/goals"] });
      toast({ title: "Goal deleted" });
    },
    onError: (err: any) =>
      toast({
        title: "Couldn't delete goal",
        description: err?.message || "Check your connection and try again — the goal still exists.",
        variant: "destructive",
      }),
  });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Target className="w-5 h-5" aria-hidden="true" />
                Business goals
              </CardTitle>
              <CardDescription>Track progress toward deals, revenue, and activity targets.</CardDescription>
            </div>
            <Button
              size="sm"
              className="min-h-11 sm:min-h-9"
              onClick={() => setShowForm(v => !v)}
              variant={showForm ? "outline" : "default"}
              data-testid="button-toggle-new-goal"
            >
              {showForm ? <X className="w-4 h-4 mr-2" aria-hidden="true" /> : <Plus className="w-4 h-4 mr-2" aria-hidden="true" />}
              {showForm ? "Cancel" : "New goal"}
            </Button>
          </div>
        </CardHeader>

        {showForm && (
          <CardContent className="border-t pt-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2 space-y-1">
                <Label htmlFor="input-goal-label">
                  Goal label <span className="text-destructive" aria-label="required">*</span>
                </Label>
                <Input
                  id="input-goal-label"
                  placeholder="e.g. Q2 deal target"
                  value={form.label}
                  onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="select-goal-type">Type</Label>
                <Select value={form.goalType} onValueChange={v => setForm(f => ({ ...f, goalType: v as GoalPayload["goalType"] }))}>
                  <SelectTrigger id="select-goal-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.entries(GOAL_TYPE_LABELS) as [GoalPayload["goalType"], string][]).map(([v, l]) => (
                      <SelectItem key={v} value={v}>{l}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="input-goal-target">
                  Target <span className="text-destructive" aria-label="required">*</span>
                </Label>
                <Input
                  id="input-goal-target"
                  type="number"
                  min="0"
                  inputMode="decimal"
                  placeholder="e.g. 10"
                  value={form.targetValue}
                  onChange={e => setForm(f => ({ ...f, targetValue: e.target.value }))}
                  className="tabular-nums"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="input-goal-start" className="flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5" aria-hidden="true" />Start date
                </Label>
                <Input
                  id="input-goal-start"
                  type="date"
                  value={form.periodStart}
                  onChange={e => setForm(f => ({ ...f, periodStart: e.target.value }))}
                  className="tabular-nums"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="input-goal-end" className="flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5" aria-hidden="true" />End date
                </Label>
                <Input
                  id="input-goal-end"
                  type="date"
                  value={form.periodEnd}
                  onChange={e => setForm(f => ({ ...f, periodEnd: e.target.value }))}
                  className="tabular-nums"
                />
              </div>
              <div className="sm:col-span-2">
                <Button
                  onClick={() => createGoal.mutate(form)}
                  disabled={!form.label || !form.targetValue || createGoal.isPending}
                  className="min-h-11 sm:min-h-9"
                  data-testid="button-save-goal"
                >
                  {createGoal.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />}
                  Save goal
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
              <Target className="w-10 h-10 mx-auto mb-3 opacity-30" aria-hidden="true" />
              <p className="text-sm font-medium">No goals yet</p>
              <p className="text-xs mt-1">Create a goal to track your team's progress.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {goals.map((goal: any) => {
                const current = Number(goal.currentValue ?? 0);
                const target = Number(goal.targetValue);
                const pct = Math.min(100, Math.round((current / target) * 100));
                const isComplete = pct >= 100;
                const isRevenue = goal.goalType === "revenue_earned";
                const valueFormat = (n: number) =>
                  isRevenue ? usd(n, { noCents: true }) : n.toLocaleString();
                return (
                  <div key={goal.id} className="rounded-lg border p-4 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium truncate">{goal.label}</p>
                        <p className="text-xs text-muted-foreground tabular-nums">
                          {GOAL_TYPE_LABELS[goal.goalType as GoalPayload["goalType"]] ?? goal.goalType}
                          {" · "}
                          {new Date(goal.periodStart).toLocaleDateString()} &ndash; {new Date(goal.periodEnd).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {isComplete && (
                          <Badge variant="default" className="bg-acr-pos text-white text-xs">Complete</Badge>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-11 w-11 sm:h-7 sm:w-7 text-muted-foreground hover:text-destructive"
                          onClick={() => deleteGoal.mutate(goal.id)}
                          disabled={deleteGoal.isPending}
                          aria-label={`Delete goal: ${goal.label}`}
                        >
                          <X className="w-3.5 h-3.5" aria-hidden="true" />
                        </Button>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Progress
                        value={pct}
                        className="h-2"
                        aria-label={`${goal.label}: ${pct}% complete (${valueFormat(current)} of ${valueFormat(target)})`}
                      />
                      <div className="flex justify-between text-xs text-muted-foreground tabular-nums">
                        <span>{valueFormat(current)} / {valueFormat(target)}</span>
                        <span className={isComplete ? "text-acr-pos font-semibold" : ""}>{pct}%</span>
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
    onError: (err: any) =>
      toast({
        title: "Couldn't create API key",
        description: err?.message || "Check your connection and try again — no key was created.",
        variant: "destructive",
      }),
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
    onError: (err: any) =>
      toast({
        title: "Couldn't revoke API key",
        description: err?.message || "Check your connection and try again — the key is still active.",
        variant: "destructive",
      }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <Code className="w-5 h-5" aria-hidden="true" />
            API keys
          </h2>
          <p className="text-muted-foreground text-sm">
            Create API keys to let external tools access your AcreOS data.
          </p>
        </div>
        <Button
          size="sm"
          className="min-h-11 sm:min-h-9"
          onClick={() => setShowCreate(true)}
          data-testid="button-create-api-key"
        >
          <Plus className="w-4 h-4 mr-1" aria-hidden="true" /> Create key
        </Button>
      </div>

      {/* Newly created key — show once */}
      {createdKey && (
        <Card
          className="border-acr-pos bg-acr-pos-soft dark:bg-acr-pos-soft/30"
          role="alert"
          aria-live="assertive"
        >
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-acr-pos dark:text-acr-pos flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4" aria-hidden="true" /> API key created — copy it now, it won't be shown again
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <Label htmlFor="text-created-api-key" className="sr-only">Newly created API key</Label>
              <code
                id="text-created-api-key"
                className="flex-1 text-xs bg-muted rounded px-2 py-1.5 font-mono break-all tabular-nums"
                data-testid="text-created-api-key"
              >{createdKey}</code>
              <Button
                size="sm"
                variant="outline"
                className="min-h-11 sm:min-h-9 shrink-0"
                onClick={() => {
                  navigator.clipboard.writeText(createdKey);
                  toast({ title: "API key copied to clipboard" });
                }}
                aria-label="Copy API key to clipboard"
              >
                Copy
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-11 w-11 sm:h-9 sm:w-9 shrink-0"
                onClick={() => setCreatedKey(null)}
                aria-label="Dismiss new API key banner"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Create form */}
      {showCreate && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">New API key</CardTitle>
            <CardDescription>Name it for where you'll use it — Zapier, a custom script, etc. — so you know which key to revoke later.</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (!newKeyName.trim() || createKey.isPending) return;
                createKey.mutate();
              }}
            >
              <div>
                <Label htmlFor="input-api-key-name">
                  Name <span className="text-destructive" aria-label="required">*</span>
                </Label>
                <Input
                  id="input-api-key-name"
                  placeholder="e.g. Zapier integration"
                  value={newKeyName}
                  onChange={e => setNewKeyName(e.target.value)}
                  className="mt-1"
                  autoComplete="off"
                  data-testid="input-api-key-name"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="select-api-key-scope">Scope</Label>
                  <Select value={newKeyScope} onValueChange={(v: any) => setNewKeyScope(v)}>
                    <SelectTrigger id="select-api-key-scope" className="mt-1" data-testid="select-api-key-scope">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="read">Read — view data only</SelectItem>
                      <SelectItem value="write">Write — create and edit</SelectItem>
                      <SelectItem value="admin">Admin — full control</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="select-api-key-expiry">Expiry</Label>
                  <Select value={newKeyExpiry} onValueChange={setNewKeyExpiry}>
                    <SelectTrigger id="select-api-key-expiry" className="mt-1" data-testid="select-api-key-expiry">
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
                  type="submit"
                  className="min-h-11 sm:min-h-9"
                  disabled={!newKeyName.trim() || createKey.isPending}
                  data-testid="button-create-api-key-submit"
                >
                  {createKey.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" /> : null}
                  Create
                </Button>
                <Button type="button" variant="outline" className="min-h-11 sm:min-h-9" onClick={() => setShowCreate(false)}>{Verbs.CANCEL}</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Keys list */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div
              className="p-4 text-sm text-muted-foreground flex items-center gap-2"
              role="status"
              aria-live="polite"
            >
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
              Loading keys…
            </div>
          ) : keys.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              No API keys yet. Create one above to get started.
            </div>
          ) : (
            <div
              tabIndex={0}
              role="region"
              aria-label="Active API keys"
              className="overflow-x-auto"
            >
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Key</TableHead>
                    <TableHead>Scope</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Last used</TableHead>
                    <TableHead>Expires</TableHead>
                    <TableHead><span className="sr-only">Actions</span></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {keys.map(k => (
                    <TableRow key={k.id}>
                      <TableCell className="font-medium">{k.name}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground tabular-nums">{k.keyPrefix}…</TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="text-xs capitalize">{k.scope}</Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground tabular-nums">
                        {k.createdAt ? new Date(k.createdAt).toLocaleDateString() : "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground tabular-nums">
                        {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleDateString() : "Never"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground tabular-nums">
                        {k.expiresAt ? new Date(k.expiresAt).toLocaleDateString() : "Never"}
                      </TableCell>
                      <TableCell>
                        {revokeId === k.id ? (
                          <div
                            className="flex gap-1"
                            role="group"
                            aria-label={`Confirm revocation of ${k.name}`}
                          >
                            <Button
                              size="sm"
                              variant="destructive"
                              className="min-h-9"
                              onClick={() => revokeKey.mutate(k.id)}
                              disabled={revokeKey.isPending}
                              data-testid={`button-confirm-revoke-${k.id}`}
                              aria-label={`Confirm revoke ${k.name}`}
                            >
                              {revokeKey.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" aria-hidden="true" /> : null}
                              Confirm
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="min-h-9"
                              onClick={() => setRevokeId(null)}
                              aria-label={`Cancel revoke of ${k.name}`}
                            >
                              Cancel
                            </Button>
                          </div>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive hover:text-destructive min-h-9"
                            onClick={() => setRevokeId(k.id)}
                            data-testid={`button-revoke-${k.id}`}
                            aria-label={`Revoke ${k.name}`}
                          >
                            Revoke
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
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
          <Shield className="w-5 h-5" aria-hidden="true" />
          Activity log
        </h2>
        <p className="text-muted-foreground text-sm">
          Last 50 actions performed in your organization.
        </p>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div
              className="p-4 text-sm text-muted-foreground flex items-center gap-2"
              role="status"
              aria-live="polite"
            >
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
              Loading activity log…
            </div>
          ) : entries.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">No activity recorded yet.</div>
          ) : (
            <div
              tabIndex={0}
              role="region"
              aria-label="Organization activity log"
              className="overflow-x-auto"
            >
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
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap tabular-nums">
                        {new Date(e.createdAt).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs capitalize">{e.action}</Badge>
                      </TableCell>
                      <TableCell className="text-sm">
                        <span className="capitalize">{e.entityType}</span>
                        {e.entityId && <span className="text-muted-foreground ml-1 tabular-nums">#{e.entityId}</span>}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground tabular-nums">
                        {e.userId ? e.userId.slice(0, 8) + "…" : "System"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Privacy & Data Settings ─────────────────────────────────────────────────

interface PrivacyStatus {
  deleted: boolean;
  userId: number;
}

function PrivacyDataSettings() {
  const { toast } = useToast();
  const { logout } = useAuth();
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [showDeleteForm, setShowDeleteForm] = useState(false);

  const { data: privacyStatus } = useQuery<PrivacyStatus>({
    queryKey: ["/api/privacy/status"],
    queryFn: () => fetch("/api/privacy/status", { credentials: "include" }).then(r => r.json()),
  });

  const exportMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/privacy/export", {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `acreOS-data-export-${new Date().toISOString().split("T")[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },
    onSuccess: () => toast({ title: "Data export downloaded" }),
    onError: (err: any) =>
      toast({
        title: "Couldn't prepare your export",
        description: err?.message || "Check your connection and try again — no data was changed.",
        variant: "destructive",
      }),
  });

  const deleteMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/privacy/delete", { confirm: "DELETE MY DATA" }),
    onSuccess: () => {
      toast({
        title: "Account anonymized",
        description: "Your personal data has been deleted. You'll be signed out in a few seconds.",
      });
      setShowDeleteForm(false);
      setTimeout(() => {
        logout();
      }, 3000);
    },
    onError: (err: any) =>
      toast({
        title: "Couldn't delete your data",
        description: err?.message || "Check your connection and try again — your account is unchanged.",
        variant: "destructive",
      }),
  });

  if (privacyStatus?.deleted) {
    return (
      <div className="flex flex-col items-center gap-4 py-16 text-center" role="status" aria-live="polite">
        <CheckCircle2 className="w-12 h-12 text-acr-pos" aria-hidden="true" />
        <h2 className="text-xl font-semibold">Data deletion complete</h2>
        <p className="text-muted-foreground text-sm">Your personal data has already been anonymized.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <Lock className="w-5 h-5" aria-hidden="true" />
          Privacy &amp; data rights
        </h2>
        <p className="text-muted-foreground text-sm">
          Manage your personal data rights under GDPR/CCPA.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Data Export */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Download className="w-5 h-5 text-primary" aria-hidden="true" />
              <CardTitle className="text-base">Export your data</CardTitle>
            </div>
            <CardDescription>
              Download a complete copy of all personal data AcreOS holds about you (GDPR Article 15).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1 text-sm text-muted-foreground">
              <p>Your export includes:</p>
              <ul className="list-disc list-inside space-y-0.5 text-xs">
                <li>Account information</li>
                <li>Leads assigned to you</li>
                <li>Deals and properties</li>
                <li>Tasks and messages</li>
                <li>Support tickets</li>
              </ul>
            </div>
            <Button
              onClick={() => exportMutation.mutate()}
              disabled={exportMutation.isPending}
              className="w-full min-h-11 sm:min-h-9"
              data-testid="btn-export-data"
            >
              {exportMutation.isPending ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />Preparing export…</>
              ) : (
                <><Download className="w-4 h-4 mr-2" aria-hidden="true" />Download my data</>
              )}
            </Button>
          </CardContent>
        </Card>

        {/* Data Deletion */}
        <Card className="border-acr-neg/30 dark:border-acr-neg/30">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Trash2 className="w-5 h-5 text-acr-neg" aria-hidden="true" />
              <CardTitle className="text-base text-acr-neg dark:text-acr-neg">Delete personal data</CardTitle>
            </div>
            <CardDescription>
              Permanently anonymize your personal data (GDPR Article 17 — right to erasure).
              Business records required for legal compliance are retained in anonymized form.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div
              className="flex items-start gap-2 p-3 rounded-lg bg-acr-warn-soft dark:bg-acr-warn-soft/20 border border-acr-warn/30 dark:border-acr-warn/30"
              role="alert"
            >
              <AlertTriangle className="w-4 h-4 text-acr-warn shrink-0 mt-0.5" aria-hidden="true" />
              <div className="text-xs text-acr-warn dark:text-acr-warn space-y-1">
                <p className="font-medium">This action can't be undone.</p>
                <p>Your email, name, and contact details will be replaced with anonymized values. Deals and business records are retained for legal compliance.</p>
              </div>
            </div>

            {!showDeleteForm ? (
              <Button
                variant="destructive"
                className="w-full min-h-11 sm:min-h-9"
                onClick={() => setShowDeleteForm(true)}
                data-testid="btn-request-deletion"
              >
                <Trash2 className="w-4 h-4 mr-2" aria-hidden="true" />
                Request data deletion
              </Button>
            ) : (
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="input-delete-confirm" className="text-xs">
                    Type <strong className="tabular-nums">DELETE</strong> to confirm:
                  </Label>
                  <Input
                    id="input-delete-confirm"
                    value={deleteConfirmText}
                    onChange={e => setDeleteConfirmText(e.target.value)}
                    placeholder="Type DELETE here"
                    className="text-sm"
                    autoComplete="off"
                    autoCapitalize="characters"
                    autoCorrect="off"
                    spellCheck={false}
                    data-testid="input-delete-confirm"
                  />
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="destructive"
                    className="flex-1 min-h-11 sm:min-h-9"
                    disabled={deleteConfirmText !== "DELETE" || deleteMutation.isPending}
                    onClick={() => deleteMutation.mutate()}
                    data-testid="btn-confirm-deletion"
                  >
                    {deleteMutation.isPending ? (
                      <><Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />Deleting…</>
                    ) : (
                      "Confirm deletion"
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    className="min-h-11 sm:min-h-9"
                    onClick={() => { setShowDeleteForm(false); setDeleteConfirmText(""); }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-primary" aria-hidden="true" />
            <CardTitle className="text-base">Your data rights</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3" aria-label="GDPR and CCPA data rights">
            {[
              { right: "Right of access (Art. 15)", desc: "Download all data we hold about you.", status: "available" as const },
              { right: "Right to erasure (Art. 17)", desc: "Request anonymization of personal data.", status: "available" as const },
              { right: "Right to rectification (Art. 16)", desc: "Correct inaccurate data via Settings.", status: "available" as const },
              { right: "Right to portability (Art. 20)", desc: "Export your data in JSON format.", status: "available" as const },
              { right: "Right to object (Art. 21)", desc: "Contact support to object to processing.", status: "contact" as const },
              { right: "Right to restriction (Art. 18)", desc: "Contact support to restrict processing.", status: "contact" as const },
            ].map(({ right, desc, status }) => (
              <li key={right} className="flex items-start gap-2 p-3 rounded-lg border bg-muted/20">
                <Badge
                  variant={status === "available" ? "default" : "outline"}
                  className="text-xs shrink-0 mt-0.5"
                >
                  {status === "available" ? "Available" : "Via support"}
                </Badge>
                <div>
                  <p className="text-xs font-medium">{right}</p>
                  <p className="text-xs text-muted-foreground">{desc}</p>
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
