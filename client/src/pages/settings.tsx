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
import { Building2, Crown, Check, ExternalLink, CreditCard, Loader2, Lightbulb, RotateCcw, Database, Trash2, BarChart3, Users, Home, FileText, Sparkles, TrendingUp, Coins, Shield, Mail, Phone, Bell, Settings as SettingsIcon, Gift, Link2, CheckCircle2, Wallet, Plus, X, Lock, ArrowLeft } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { trackEvent } from "@/lib/analytics";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { QueryErrorState } from "@/components/query-error-state";
import { EmptyState } from "@/components/empty-state";
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
import { SecurityActivityLog } from "@/components/security-activity-log";
import { ProviderSettings } from "@/components/provider-settings";
import { AICostDashboard } from "@/components/ai-cost-dashboard";
import { SettingsQuickFind } from "@/components/settings/SettingsQuickFind";
import { TeamInviteCard } from "@/components/settings/TeamInviteCard";
// Monolith split (T3 census W1-2) — per-tab sections live in their own
// modules under pages/settings/, mirroring the existing 8 routed subpages.
import { StripeConnectSettings, SeatManagement } from "@/pages/settings/billing-sections";
import { ApiKeyManager, ActivityLogPanel } from "@/pages/settings/developer-sections";
import { ReferralSettings, PrivacyDataSettings } from "@/pages/settings/account-sections";
import { GoalsSettings } from "@/pages/settings/organization-sections";
// ThemeSettings (dialog quick-picker) is intended for top-bar mount in Phase E;
// the full Settings → Appearance surface uses AppearancePanel below.
import { AppearancePanel } from "@/components/settings/appearance-panel";
import { AccessibilityPanel } from "@/components/settings/accessibility-panel";
import { PersonaPanel } from "@/components/settings/persona-panel";
import { NotificationQuietHours } from "@/components/settings/notification-quiet-hours";
import { PreferencesCard } from "@/components/preferences-card";
import { PlanComparisonModal, type TierKey } from "@/components/tier-upgrade-panel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useState, useEffect } from "react";
// R4: Clerk-native MFA management — replaces the deleted in-house TOTP flow.
import { UserProfile } from "@clerk/react";
import { useSafeUser, CLERK_AVAILABLE } from "@/lib/clerk-safe";
import { useLocation } from "wouter";
import { useSearch } from "wouter";
import { Link } from "wouter";
import { PAX_CONTROLS_PATH, PAX_SETTINGS_COPY } from "@shared/pax-glossary";
import { XCircle } from "lucide-react";
import { CancellationDialog } from "@/components/cancellation-dialog";
import { useDocumentTitle } from "@/hooks/use-document-title";
import "./today.css";
import { formatDate } from "@/lib/format";
import { Verbs } from "@/lib/labels";

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
// autonomy         →  integrations       (legacy hash only — Pax lives at /settings/pax)
// goals            →  organization       (org-scoped goals)
// notifications    →  notifications      (channel matrix)
// communications   →  notifications      (email/SMS/mail provider config)
// team             →  organization       (members + roles + ownership)
// payments         →  billing            (Stripe Connect + plan)
// data             →  tax-compliance     (compliance settings live here +
//                                         custom fields + import/export)
// integrations     →  integrations       (Pax & connections: Pax card, BYOK link, providers)
// automations      →  integrations       (legacy hash — /workflows is the one editor)
// developer        →  integrations       (API keys + audit log)
// ai               →  integrations       (AI cost + provider settings)
// ai-tasks         →  integrations       (legacy hash — scheduled prompts live on /settings/pax)
//
// Legacy HASH values (#payments, #referral, …) auto-rewrite to the
// canonical bucket via LEGACY_TO_CANONICAL below. NOTE: only the HASH is
// read — `?tab=billing` query params are IGNORED (this comment previously
// claimed otherwise and misled the dunning-email link author into a broken
// recovery link; deep links must use /settings#billing form).
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
  // The upgrade-toast deep link is `/settings#billing?tier=pro` — the
  // "?tier=" rides INSIDE the hash (there is no real query string), so the
  // hash must be split before tab matching. Without this, that link landed
  // on the Account tab with no plan comparison (broken upgrade funnel).
  const getHashParts = (): { hash: string; tier: TierKey | null } => {
    const raw = window.location.hash.replace("#", "");
    const [hash, pseudoQuery] = raw.split("?");
    const tierRaw = new URLSearchParams(pseudoQuery ?? "").get("tier");
    const tier: TierKey | null =
      tierRaw === "free" || tierRaw === "starter" || tierRaw === "pro" || tierRaw === "scale"
        ? tierRaw
        : null;
    return { hash, tier };
  };

  const getTabFromHash = (): TabValue => {
    const { hash } = getHashParts();
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

  // Auto-show plan comparison when arriving via #billing (from the upgrade
  // toast or a dunning email), highlighting the suggested tier when the
  // link carries one. Note: "billing" is now itself a canonical tab.
  const applyBillingIntent = () => {
    const { hash, tier } = getHashParts();
    if (hash === "billing" || hash === "payments") {
      if (tier) setPlanPickerHighlight(tier);
      setShowPlanComparison(true);
    }
  };

  useEffect(() => {
    applyBillingIntent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handleHashChange = () => {
      setActiveTab(getTabFromHash());
      applyBillingIntent();
    };
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  
  const handleTabChange = (value: string) => {
    const newTab = value as TabValue;
    setActiveTab(newTab);
    window.history.replaceState(null, "", `/settings#${newTab}`);
  };
  
  // Every query on this page surfaces failure with a retry — Settings is a
  // fixed top-bar door and must never silently fail (T3 census W1-2).
  const { data: organization, isLoading: orgLoading, isError: orgError, error: orgErrorObj, refetch: refetchOrg, isRefetching: orgRefetching } = useOrganization();
  const { data: products, isLoading: productsLoading, isError: productsError, error: productsErrorObj, refetch: refetchProducts, isRefetching: productsRefetching } = useStripeProducts();
  const { data: subscriptionData, isLoading: subLoading, isError: subError, error: subErrorObj, refetch: refetchSub, isRefetching: subRefetching } = useStripeSubscription();
  const { data: usageData, isLoading: usageLoading, isError: usageError, error: usageErrorObj, refetch: refetchUsage, isRefetching: usageRefetching } = useUsageLimits();
  const { data: teamMembers, isLoading: teamLoading, isError: teamError, error: teamErrorObj, refetch: refetchTeam, isRefetching: teamRefetching } = useTeamMembers();
  const { data: userPermissions } = useUserPermissions();
  const { data: coOwners, isLoading: coOwnersLoading, isError: coOwnersError, error: coOwnersErrorObj, refetch: refetchCoOwners, isRefetching: coOwnersRefetching } = useOrgCoOwners();

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
        title: "Workspace cleared",
        description:
          "All leads, properties, deals, notes, and payments were removed from your workspace.",
      });
    },
    onError: (err: any) => {
      // apiRequest throws "<status>: <server message>" — the numeric prefix
      // is engineer-speak, so drop it before showing the person the message.
      const raw = typeof err?.message === "string" ? err.message : "";
      const friendly = raw.replace(/^\d{3}:\s*/, "");
      toast({
        title: "Couldn't clear your data",
        description:
          friendly ||
          "Nothing was removed. Check your connection and try again — if it keeps failing, it's on our side and already logged.",
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
          {/* Mobile back-to-app affordance. PageTopbar's breadcrumb is hidden
              on mobile, so without this an entrant from the MobileShell brand
              tap has no obvious return path other than the bottom nav. The
              link is md:hidden because desktop already shows breadcrumb +
              Home icon in the topbar. */}
          <div className="md:hidden -mt-2 mb-2">
            <Button
              variant="ghost"
              size="sm"
              className="min-h-11 px-2 -ml-2 text-muted-foreground"
              onClick={() => setLocation("/today")}
              data-testid="button-back-to-today"
              aria-label="Back to Today"
            >
              <ArrowLeft className="w-4 h-4 mr-1" aria-hidden="true" />
              Back to Today
            </Button>
          </div>

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

          {/* Quick-find search — jumps to any setting across all 7 tabs by
             keyword. Reduces the "overwhelming" feel: a user who knows
             they want "2fa" or "stripe" or "theme" can land there in
             one keystroke without scanning tab labels. */}
          <SettingsQuickFind onJump={(tab) => handleTabChange(tab)} />

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
                <SelectItem value="integrations">{PAX_SETTINGS_COPY.bucketLabel}</SelectItem>
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
                  {PAX_SETTINGS_COPY.bucketLabel}
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
                                  14-day free trial available
                                </p>
                                <p className="text-sm text-muted-foreground mt-1">
                                  Start your subscription with a 14-day free trial. No charge until the trial ends.
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
                                      // Plans live in the Billing tab now — switch, then scroll once it paints.
                                      handleTabChange("billing");
                                      setTimeout(() => document.getElementById("pricing-section")?.scrollIntoView({ behavior: "smooth" }), 50);
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
                        try {
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
                        } catch {
                          toast({
                            title: "Couldn't save your preference",
                            description: "The change didn't stick — please try again.",
                            variant: "destructive",
                          });
                        }
                      }}
                      disabled={updateOrgMutation.isPending}
                      data-testid="switch-show-tips"
                    />
                  </div>
                  
                  {/* Re-run onboarding — labeled for what it actually does
                      (re-runs the setup wizard; there is no separate "tour").
                      Reset PRESERVES the org's businessType/noteRole, and the
                      wizard prefills from them — a re-run never flips the org
                      back to the land_flipper default. */}
                  <div className="flex items-center justify-between gap-4 pt-4 border-t">
                    <div className="space-y-0.5">
                      <Label className="text-base">Re-run onboarding</Label>
                      <p className="text-sm text-muted-foreground">
                        {settings?.onboardingCompleted
                          ? "Run the setup wizard again — your business type and answers are kept and prefilled."
                          : "Finish the setup wizard to configure your workspace."}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="min-h-11 pointer-fine:sm:min-h-9"
                      onClick={async () => {
                        try {
                          const res = await fetch("/api/onboarding/reset", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            credentials: "include",
                          });
                          if (!res.ok) throw new Error("Reset failed");
                          queryClient.invalidateQueries({ queryKey: ["/api/organization"] });
                          queryClient.invalidateQueries({ queryKey: ["/api/onboarding/status"] });
                          queryClient.invalidateQueries({ queryKey: ["/api/me/needs-onboarding"] });
                          setLocation("/onboarding-v2");
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
                      {settings?.onboardingCompleted ? "Re-run onboarding" : "Resume onboarding"}
                    </Button>
                  </div>
                </CardContent>
              </Card>

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
                    className="min-h-11 pointer-fine:sm:min-h-9"
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
                          <Skeleton className="h-10 w-10 rounded-full" announce={i === 1} announceText="Loading team members" />
                          <Skeleton className="h-4 w-32" announce={false} />
                          <Skeleton className="h-6 w-16" announce={false} />
                        </div>
                      ))}
                    </div>
                  ) : teamError ? (
                    <QueryErrorState
                      error={teamErrorObj as Error}
                      onRetry={() => refetchTeam()}
                      isRetrying={teamRefetching}
                      compact
                      title="Couldn't load your team"
                      description="Your team and their roles are intact — this is just a display issue."
                      testId="error-team-members"
                    />
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
                    <EmptyState
                      icon={Users}
                      headline="It's just you so far"
                      subtitle="Invite a teammate above — they get their own login and a role that controls what they can see and do."
                      cta={{
                        label: "Invite someone",
                        onClick: () => {
                          const input = document.querySelector<HTMLInputElement>('[data-testid="input-invite-email"]');
                          input?.scrollIntoView({ behavior: "smooth", block: "center" });
                          input?.focus({ preventScroll: true });
                        },
                        "data-testid": "empty-invite-team-member",
                      }}
                      actionIcon={null}
                      className="py-6"
                      testId="empty-team-members"
                    />
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
                        <Skeleton className="h-8 w-full" announceText="Loading co-owners" />
                        <Skeleton className="h-8 w-full" announce={false} />
                      </div>
                    ) : coOwnersError ? (
                      <QueryErrorState
                        error={coOwnersErrorObj as Error}
                        onRetry={() => refetchCoOwners()}
                        isRetrying={coOwnersRefetching}
                        compact
                        title="Couldn't load co-owners"
                        description="Co-owner records are intact — this is just a display issue."
                        testId="error-co-owners"
                      />
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
                                  {formatDate(co.addedAt)}
                                </TableCell>
                                <TableCell>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-11 w-11 pointer-fine:sm:h-8 pointer-fine:sm:w-8"
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
                          className="min-h-11 pointer-fine:sm:min-h-9"
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

              {/* Business goals — previously orphaned in a second
                  TabsContent value="organization" that Radix never rendered. */}
              <div className="pt-4 border-t" data-testid="tab-content-organization-goals">
                <GoalsSettings />
              </div>
            </TabsContent>

            <TabsContent value="billing" className="space-y-8 mt-6" data-testid="tab-content-billing">
              {/* Plans + upgrade grid — moved here from the Account tab (WS1,
                  2026-07-07): every server upgradeUrl deep-links to
                  /settings#billing, but the tab named Billing only held
                  Stripe Connect, so customers looking to upgrade found no
                  plans. */}
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
            </TabsContent>

            <TabsContent value="notifications" className="space-y-8 mt-6" data-testid="tab-content-notifications-comms">
              <div className="space-y-4" data-testid="section-email-settings">
                <div>
                  <h2 className="text-section-h2 flex items-center gap-2">
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
                  <h2 className="text-section-h2 flex items-center gap-2">
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
                  <h2 className="text-section-h2 flex items-center gap-2">
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
                  <h2 className="text-section-h2">Communication Integrations</h2>
                  <p className="text-muted-foreground text-sm">
                    Connect your own email, SMS, and direct mail providers for branded communications.
                  </p>
                </div>
                <IntegrationsSettings />
                <EmailDomainsSettings />
              </div>

              {/* Notification preferences — quiet hours + channel matrix */}
              <NotificationQuietHours />
              <NotificationPreferences />
            </TabsContent>

            <TabsContent value="integrations" className="space-y-8 mt-6" data-testid="tab-content-integrations-ai">
              {/* Pax — the ONE control surface (AUTONOMY_SPEC.md §3a). It is
                  nested at /settings/pax, never a tab; this card is the
                  bucket's first entry. The six-component stack that used to
                  live here is deleted (spec §3d). */}
              <Card data-testid="card-pax-controls-entry">
                <CardContent className="p-4 flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2 min-w-0">
                    <Sparkles className="w-5 h-5 text-acr-brand shrink-0" aria-hidden="true" />
                    <span className="text-sm font-medium">{PAX_SETTINGS_COPY.cardTitle}</span>
                  </div>
                  <Button asChild className="min-h-11 pointer-fine:sm:min-h-9">
                    <Link href={PAX_CONTROLS_PATH} data-testid="link-pax-controls">
                      {PAX_SETTINGS_COPY.cardOpen}
                      <ExternalLink className="w-4 h-4 ml-2" aria-hidden="true" />
                    </Link>
                  </Button>
                </CardContent>
              </Card>

              {/* BYOK — ONE catalog, at /settings/byok. The inline mount is
                  gone (two catalogs was confusion #14). */}
              <div className="space-y-4 pt-4 border-t" data-testid="section-byok-link">
                <div>
                  <h2 className="text-section-h2 flex items-center gap-2">
                    <Link2 className="w-5 h-5" />
                    {PAX_SETTINGS_COPY.byokCardTitle}
                  </h2>
                  <p className="text-muted-foreground text-sm">{PAX_SETTINGS_COPY.byokCardBody}</p>
                  {/* Trust microcopy at the moment of key entry. BYOK
                      adoption is gated on the user believing we won't
                      leak their OpenAI / Twilio / SendGrid secret. */}
                  <div className="mt-3 rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground flex items-start gap-2">
                    <Lock className="h-3.5 w-3.5 mt-0.5 shrink-0 text-foreground/70" aria-hidden />
                    <span>
                      Keys are encrypted at rest with per-org KMS, never logged, and only decrypted in-memory to make the upstream call.{" "}
                      <a href="/security" className="underline hover:text-foreground active:text-foreground">
                        Security details
                      </a>
                      .
                    </span>
                  </div>
                </div>
                <Button asChild variant="outline" className="min-h-11 pointer-fine:sm:min-h-9">
                  <Link href="/settings/byok" data-testid="link-settings-byok">
                    {PAX_SETTINGS_COPY.byokOpen}
                    <ExternalLink className="w-4 h-4 ml-2" aria-hidden="true" />
                  </Link>
                </Button>
              </div>

              {/* Provider status — read-only, from /api/organization/providers */}
              <div className="pt-4 border-t">
                <h3 className="text-section-h2 mb-4">Service Providers</h3>
                <ProviderSettings />
              </div>

              {/* Developer tools */}
              <div className="space-y-4 pt-4 border-t" data-testid="tab-content-integrations-developer">
                <div>
                  <h2 className="text-section-h2 flex items-center gap-2">
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
                      className="min-h-11 pointer-fine:sm:min-h-9"
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
                      className="min-h-11 pointer-fine:sm:min-h-9"
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

                {/* API Key Management */}
                <ApiKeyManager />

                {/* Activity Audit Log */}
                <ActivityLogPanel />
              </div>

              {/* AI cost — last in the bucket (spec §3a). */}
              <div className="pt-4 border-t" data-testid="tab-content-integrations-ai-cost">
                <AICostDashboard />
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
                    Add your business's tax details (EIN or SSN) so AcreOS can issue
                    the 1099 forms you owe anyone you pay more than $600 in a year.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Button
                    variant="outline"
                    className="min-h-11 pointer-fine:sm:min-h-9"
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
                  <h2 className="text-section-h2 flex items-center gap-2">
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

            {/* ── Account: appearance, persona, privacy, referral ─── */}
            {/* All four were previously split across separate TabsContent
                value="account" blocks — only the first one was ever rendered
                by Radix Tabs. This single block is the canonical account tab. */}
            <TabsContent value="account" className="space-y-8 mt-6" data-testid="tab-content-account-appearance">
              <div className="space-y-4">
                <div>
                  <h2 className="text-section-h2 flex items-center gap-2">
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
                {/* Wave B accessibility & comfort accommodations:
                    Lexend, reading density, cognitive a11y, larger taps,
                    picture-first parcels, focus mode + quiet hours. */}
                <AccessibilityPanel />
              </div>

              {/* Privacy & data rights (GDPR/CCPA) */}
              <div className="pt-4 border-t" data-testid="tab-content-account-privacy">
                <PrivacyDataSettings />
              </div>

              {/* How AcreOS sources data (Quinn item #5 — transparency surface) */}
              <div className="pt-4 border-t" data-testid="tab-content-account-data-sources">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Database className="w-5 h-5" aria-hidden="true" />
                      How AcreOS sources data
                    </CardTitle>
                    <CardDescription>
                      See every data source behind the numbers in AcreOS — what
                      each is on record for, how often it updates, its license,
                      and how to read facts versus estimates.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Button
                      variant="outline"
                      className="min-h-11 pointer-fine:sm:min-h-9"
                      onClick={() => setLocation("/data-sources")}
                      data-testid="button-view-data-sources"
                    >
                      View data sources
                      <ExternalLink className="w-4 h-4 ml-2" aria-hidden="true" />
                    </Button>
                  </CardContent>
                </Card>
              </div>

              {/* Transparency Report (Quinn #4 / Beatrice #3 — public
                  accountability surface). Linked here for logged-in
                  customers; also public at /transparency. */}
              <div className="pt-4 border-t" data-testid="tab-content-account-transparency">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <FileText className="w-5 h-5" aria-hidden="true" />
                      Transparency report
                    </CardTitle>
                    <CardDescription>
                      See how Pax's rules play out each period — refusals by
                      rule, appeal outcomes, founder overrides, and our drift
                      and fairness checks. Published even when the numbers are
                      unflattering.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Button
                      variant="outline"
                      className="min-h-11 pointer-fine:sm:min-h-9"
                      onClick={() => setLocation("/transparency")}
                      data-testid="button-view-transparency"
                    >
                      View transparency report
                      <ExternalLink className="w-4 h-4 ml-2" aria-hidden="true" />
                    </Button>
                  </CardContent>
                </Card>
              </div>

              {/* Refer & earn */}
              <div className="pt-4 border-t" data-testid="tab-content-account-referral">
                <ReferralSettings />
              </div>
            </TabsContent>

            {/* ── Organization: team + goals ─────────────────────────── */}
            {/* GoalsSettings was previously in a second TabsContent
                value="organization" that never rendered. Merged here. */}

            {/* ── Security Tab ─────────────────────────────────────────── */}
            {/* Password change is delegated to Clerk's UserProfile dialog
                (opened from TwoFactorAuthSettings). The legacy PasswordChange
                card POSTed to /api/auth/change-password which no longer
                exists — Clerk owns credentials end-to-end. */}
            <TabsContent value="security" className="space-y-6 mt-6" data-testid="tab-content-security">
              <TwoFactorAuthSettings />
              <SecurityActivityLog />
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
  const { user, isLoaded } = useSafeUser();
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
          Manage your password, two-factor authentication (authenticator app or SMS), and connected accounts through your Clerk account.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!isLoaded ? (
          <div className="flex items-center gap-2">
            <Skeleton className="h-4 w-4 rounded-full" announceText="Loading account security status" />
            <Skeleton className="h-4 w-36" announce={false} />
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

        {CLERK_AVAILABLE ? (
          <Button
            size="sm"
            variant={twoFactorEnabled ? "outline" : "default"}
            className="min-h-11 pointer-fine:sm:min-h-9"
            onClick={() => setShowProfile(true)}
            data-testid="button-manage-2fa"
          >
            {twoFactorEnabled ? "Manage 2FA" : "Set up 2FA"}
          </Button>
        ) : (
          <p className="text-xs text-muted-foreground" data-testid="text-2fa-unavailable">
            Account security is managed through your sign-in provider, which
            isn&apos;t loaded here.
          </p>
        )}

        <Dialog open={showProfile && CLERK_AVAILABLE} onOpenChange={setShowProfile}>
          <DialogContent className="sm:max-w-3xl p-0 overflow-hidden">
            <DialogHeader className="sr-only">
              <DialogTitle>Account security</DialogTitle>
              <DialogDescription>
                Manage your password, two-factor authentication factors, and connected accounts through Clerk.
              </DialogDescription>
            </DialogHeader>
            <div className="max-h-[80vh] overflow-y-auto">
              {/* TODO(tsc): Clerk's public UserProfileProps types `routing` as
                  'path' | 'hash' only — 'virtual' is runtime-valid (used by Clerk
                  for modal mounting) but not exposed on the component props.
                  Using 'hash' here keeps navigation off the app router (closest
                  type-valid equivalent to 'virtual' for this in-Dialog embed). */}
              <UserProfile routing="hash" />
            </div>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

