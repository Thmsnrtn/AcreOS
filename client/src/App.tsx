import React, { Suspense } from "react";
import { Switch, Route, Redirect, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { CookieConsentBanner } from "@/components/cookie-consent-banner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/use-auth";
import { useWhiteLabel } from "@/hooks/use-white-label";
import { useFeatureFlags } from "@/hooks/use-feature-flags";
import { Loader2 } from "lucide-react";
import { telemetry } from "@/lib/telemetry";
import { setSentryUser } from "@/lib/sentry";
import { ThemeProvider } from "@/contexts/theme-context";
import { FeatureFlagsProvider } from "@/contexts/feature-flags-context";
import { PaxRailProvider } from "@/contexts/pax-rail-context";
import { AnimatePresence, motion, MotionConfig } from "framer-motion";
import { pageTransition } from "@/lib/animations";
import { useToast } from "@/hooks/use-toast";

import { SidebarProvider } from "@/components/layout-sidebar";
import { HintsProvider } from "@/components/feature-hints";
import { KeyboardShortcutsProvider } from "@/hooks/use-keyboard-shortcuts";
// Heavy components that mount on every authenticated page but the user
// rarely interacts with on first paint (NpsDialog appears intermittently;
// modals open on click; rails open on click). Lazy-loading reclaims
// ~5,000 LOC from the entry chunk per the 2026-05-01 perf audit.
const KeyboardShortcutsModal = React.lazy(() => import("@/components/keyboard-shortcuts").then(m => ({ default: m.KeyboardShortcutsModal })));
const NewItemMenu = React.lazy(() => import("@/components/new-item-menu").then(m => ({ default: m.NewItemMenu })));
const OnboardingWizard = React.lazy(() => import("@/components/onboarding-wizard").then(m => ({ default: m.OnboardingWizard })));
import { PWAInstallPrompt } from "@/components/pwa-install-prompt";
import { ConversationTray } from "@/components/conversation-tray";
import { ErrorBoundary } from "@/components/error-boundary";
import { OfflineIndicator } from "@/components/offline-indicator";
import { DealModalsHost } from "@/components/modals";
import { FloatingActionButton } from "@/components/floating-action-button";
import { EarlyAccessBanner } from "@/components/early-access-banner";
const CommandPalette = React.lazy(() => import("@/components/command-palette").then(m => ({ default: m.CommandPalette })));
import { FounderCommandPaletteProvider } from "@/components/founder-command-palette";
import { useSwipeNavigation } from "@/hooks/use-swipe-gesture";
import { useNextRoutePrefetch } from "@/hooks/use-next-route-prefetch";
import { MobileBottomNav } from "@/components/mobile";
import { BetaActivationDetector } from "@/components/beta-activation-detector";
const PaxCopilotRail = React.lazy(() => import("@/components/pax-copilot-rail").then(m => ({ default: m.PaxCopilotRail })));
import { DynamicIsland } from "@/components/dynamic-island";
import { DynamicIslandProvider } from "@/contexts/dynamic-island-context";
import { useCursorGlass } from "@/hooks/use-cursor-glass";
import { TrialBanner } from "@/components/trial-banner";
import { NotificationBanner } from "@/components/notification-banner";
const NpsDialog = React.lazy(() => import("@/components/nps-dialog").then(m => ({ default: m.NpsDialog })));

// Eagerly loaded: must be available immediately with no delay
import AuthPage from "@/pages/auth-page";
import LandingPage from "@/pages/landing";
import NotFound from "@/pages/not-found";

// ─── Lazy-loaded page bundles ───────────────────────────────────────────────
// Core (primary nav)
const TodayPage = React.lazy(() => import("@/pages/today"));
const PipelinePage = React.lazy(() => import("@/pages/pipeline"));
const MoneyPage = React.lazy(() => import("@/pages/money"));
const PaxPage = React.lazy(() => import("@/pages/pax"));
const AtlasPage = React.lazy(() => import("@/pages/atlas"));
const Dashboard = React.lazy(() => import("@/pages/dashboard"));
const LeadsPage = React.lazy(() => import("@/pages/leads"));
const LeadDetailPage = React.lazy(() => import("@/pages/lead-detail"));
const PropertiesPage = React.lazy(() => import("@/pages/properties"));
const DealsPage = React.lazy(() => import("@/pages/deals"));
const DealDetailPage = React.lazy(() => import("@/pages/deal-detail"));
const FinancePage = React.lazy(() => import("@/pages/finance"));
const PortfolioPage = React.lazy(() => import("@/pages/portfolio"));
const CampaignsPage = React.lazy(() => import("@/pages/campaigns"));
const InboxPage = React.lazy(() => import("@/pages/inbox"));
const SettingsPage = React.lazy(() => import("@/pages/settings"));
const TasksPage = React.lazy(() => import("@/pages/tasks"));
const AnalyticsPage = React.lazy(() => import("@/pages/analytics"));
const HelpPage = React.lazy(() => import("@/pages/help"));
const SupportPage = React.lazy(() => import("@/pages/support"));

// CRM / Pipeline
const OffersPage = React.lazy(() => import("@/pages/offers"));
const ListingsPage = React.lazy(() => import("@/pages/listings"));
const DocumentsPage = React.lazy(() => import("@/pages/documents"));
const CountiesPage = React.lazy(() => import("@/pages/counties"));
const SequencesPage = React.lazy(() => import("@/pages/sequences"));
const AbTestsPage = React.lazy(() => import("@/pages/ab-tests"));
const ActivityPage = React.lazy(() => import("@/pages/activity"));
const MarketplacePage = React.lazy(() => import("@/pages/marketplace"));

// Finance / Portfolio
const CashFlowPage = React.lazy(() => import("@/pages/cash-flow"));
const ForecastingPage = React.lazy(() => import("@/pages/forecasting"));
const CapitalMarketsPage = React.lazy(() => import("@/pages/capital-markets"));
const PortfolioOptimizerPage = React.lazy(() => import("@/pages/portfolio-optimizer"));
const PortfolioHealthPage = React.lazy(() => import("@/pages/portfolio-health"));
const PortfolioPnLPage = React.lazy(() => import("@/pages/portfolio-pnl"));
const Exchange1031Page = React.lazy(() => import("@/pages/exchange-1031"));
const TaxOptimizerPage = React.lazy(() => import("@/pages/tax-optimizer"));
const TaxDelinquentPage = React.lazy(() => import("@/pages/tax-delinquent"));
const BookkeepingPage = React.lazy(() => import("@/pages/bookkeeping"));
const DepreciationCalculatorPage = React.lazy(() => import("@/pages/depreciation-calculator"));
const ClosingCostsPage = React.lazy(() => import("@/pages/closing-costs"));
const PropertyTaxPage = React.lazy(() => import("@/pages/property-tax"));
const FeeDashboardPage = React.lazy(() => import("@/pages/fee-dashboard"));

// AI / Intelligence
const AVMPage = React.lazy(() => import("@/pages/avm"));
const AvmBulkPage = React.lazy(() => import("@/pages/avm-bulk"));
const AcquisitionRadarPage = React.lazy(() => import("@/pages/acquisition-radar"));
const NegotiationCopilotPage = React.lazy(() => import("@/pages/negotiation-copilot"));
const DealHunterPage = React.lazy(() => import("@/pages/deal-hunter"));
const AgentCommandCenterPage = React.lazy(() => import("@/pages/agent-command-center"));
const VisionAIPage = React.lazy(() => import("@/pages/vision-ai"));
const LandCreditPage = React.lazy(() => import("@/pages/land-credit"));
const MarketIntelligencePage = React.lazy(() => import("@/pages/market-intelligence"));
const MarketWatchlistPage = React.lazy(() => import("@/pages/market-watchlist"));
const PriceOptimizerPage = React.lazy(() => import("@/pages/price-optimizer"));
const SellerIntentPage = React.lazy(() => import("@/pages/seller-intent"));
const DealPatternsPage = React.lazy(() => import("@/pages/deal-patterns"));
const DealFeedPage = React.lazy(() => import("@/pages/deal-feed"));
const MarketDataPage = React.lazy(() => import("@/pages/market-data"));
const DocumentIntelligencePage = React.lazy(() => import("@/pages/document-intelligence"));
// VoiceAnalyticsPage removed — AI Voice feature deprecated
const MarketplaceAnalyticsPage = React.lazy(() => import("@/pages/marketplace-analytics"));

// Operations
const MapsPage = React.lazy(() => import("@/pages/maps"));
const CommandCenterPage = React.lazy(() => import("@/pages/command-center"));
const ConsciousOrganizationPage = React.lazy(() => import("@/pages/conscious-organization"));
const AnticipatoryEnterprisePage = React.lazy(() => import("@/pages/anticipatory-enterprise"));
const RealRuntimePage = React.lazy(() => import("@/pages/real-runtime"));
const AutomationPage = React.lazy(() => import("@/pages/automation"));
const WorkflowsPage = React.lazy(() => import("@/pages/workflows"));
const ToolsPage = React.lazy(() => import("@/pages/tools"));
const SkipTracingPage = React.lazy(() => import("@/pages/skip-tracing"));
const TerritoryManagerPage = React.lazy(() => import("@/pages/territory-manager"));
const ZoningLookupPage = React.lazy(() => import("@/pages/zoning-lookup"));
const TitleSearchPage = React.lazy(() => import("@/pages/title-search"));
const PropertyEnrichmentPage = React.lazy(() => import("@/pages/property-enrichment"));
const DirectMailCampaignsPage = React.lazy(() => import("@/pages/direct-mail-campaigns"));
const DripSequencesPage = React.lazy(() => import("@/pages/drip-sequences"));
const ListingSyndicationPage = React.lazy(() => import("@/pages/listing-syndication"));
const SyndicationPage = React.lazy(() => import("@/pages/syndication"));
const DocumentVersionsPage = React.lazy(() => import("@/pages/document-versions"));
const VaDashboardPage = React.lazy(() => import("@/pages/va-dashboard"));

// Team
const TeamDashboardPage = React.lazy(() => import("@/pages/team-dashboard"));
const TeamInboxPage = React.lazy(() => import("@/pages/team-inbox"));
const CommissionsPage = React.lazy(() => import("@/pages/commissions"));
const TeamLeaderboardPage = React.lazy(() => import("@/pages/team-leaderboard"));

// Analytics / Reporting
const KPIDashboardPage = React.lazy(() => import("@/pages/kpi-dashboard"));
const CohortAnalysisPage = React.lazy(() => import("@/pages/cohort-analysis"));
const AuditLogPage = React.lazy(() => import("@/pages/audit-log"));
const DataExportPage = React.lazy(() => import("@/pages/data-export"));
const ModelTrainingPage = React.lazy(() => import("@/pages/model-training"));

// Settings / Compliance
const EmailSettingsPage = React.lazy(() => import("@/pages/email-settings"));
const MailSettingsPage = React.lazy(() => import("@/pages/mail-settings"));
const PrivacySettingsPage = React.lazy(() => import("@/pages/privacy-settings"));
const TaxIdentitySettingsPage = React.lazy(() => import("@/pages/settings/tax-identity"));
const AccessibilitySettingsPage = React.lazy(() => import("@/pages/settings/accessibility"));
const WebhooksPage = React.lazy(() => import("@/pages/webhooks"));
const CompliancePage = React.lazy(() => import("@/pages/compliance"));
const DoddFrankCheckerPage = React.lazy(() => import("@/pages/dodd-frank-checker"));
const StateDocumentsPage = React.lazy(() => import("@/pages/state-documents"));
const RegulatoryIntelPage = React.lazy(() => import("@/pages/regulatory-intel"));
const UsageQuotaPage = React.lazy(() => import("@/pages/usage-quota"));
const GoalsPage = React.lazy(() => import("@/pages/goals"));
const TaxResearcherPage = React.lazy(() => import("@/pages/tax-researcher"));

// Platform / Marketplace
// AcademyPage removed — Academy feature deprecated
const InvestorDirectoryPage = React.lazy(() => import("@/pages/investor-directory"));
const BuyerQualificationPage = React.lazy(() => import("@/pages/buyer-qualification"));
const MatchingEnginePage = React.lazy(() => import("@/pages/matching-engine"));

// Admin / Founder
const AdminSupportPage = React.lazy(() => import("@/pages/admin-support"));
const FounderDashboard = React.lazy(() => import("@/pages/founder-dashboard"));
const FounderHomePage = React.lazy(() => import("@/pages/founder-home"));
const FounderAiObservatory = React.lazy(() => import("@/pages/founder-ai-observatory"));
const FounderFeatureFlags = React.lazy(() => import("@/pages/founder/feature-flags"));
const FounderFeatures = React.lazy(() => import("@/pages/founder/features"));
const FounderIntegrationsPage = React.lazy(() => import("@/pages/founder/integrations"));
const FounderAiCostsPage = React.lazy(() => import("@/pages/founder/ai-costs"));
const FounderDsarPage = React.lazy(() => import("@/pages/founder/dsar"));
const FounderLegalHoldsPage = React.lazy(() => import("@/pages/founder/legal-holds"));
const FounderSubProcessorsPage = React.lazy(() => import("@/pages/founder/sub-processors"));
const FounderRecoveryConsolePage = React.lazy(() => import("@/pages/founder/recovery-console"));
const FounderActivationPage = React.lazy(() => import("@/pages/founder/activation"));
const DealUnderwritingPage = React.lazy(() => import("@/pages/deal-underwriting"));
const TeamKPIPage = React.lazy(() => import("@/pages/team-kpi"));
const SovereignV13Page = React.lazy(() => import("@/pages/sovereign-v13"));
const AgentDetailPage = React.lazy(() => import("@/pages/agent-detail"));
const SafetyGatesPage = React.lazy(() => import("@/pages/safety-gates"));
const DecisionQueuePage = React.lazy(() => import("@/pages/decision-queue"));
const OpsDashboardPage = React.lazy(() => import("@/pages/ops-dashboard"));
const BetaIntakePage = React.lazy(() => import("@/pages/beta-intake"));
const BetaAnalyticsPage = React.lazy(() => import("@/pages/beta-analytics"));
const QueueMonitorPage = React.lazy(() => import("@/pages/queue-monitor"));
const IntegrationsHealthPage = React.lazy(() => import("@/pages/integrations-health"));
const ProactiveMonitorPage = React.lazy(() => import("@/pages/proactive-monitor"));
const BetaDashboardPage = React.lazy(() => import("@/pages/beta-dashboard"));
const ResellerDashboardPage = React.lazy(() => import("@/pages/reseller-dashboard"));
const DataMoatDashboardPage = React.lazy(() => import("@/pages/data-moat-dashboard"));
const ExecutiveDashboardPage = React.lazy(() => import("@/pages/executive-dashboard"));

// Sovereign Protocol — Phase A Visibility Layer
const SovereignDashboardPage = React.lazy(() => import("@/pages/sovereign-dashboard"));
const BoardOfDirectorsPage = React.lazy(() => import("@/pages/board-of-directors"));
const AgentPerformancePage = React.lazy(() => import("@/pages/agent-performance"));
const MemoryBrowserPage = React.lazy(() => import("@/pages/memory-browser"));
const EventLogPage = React.lazy(() => import("@/pages/event-log"));
const JobHealthPage = React.lazy(() => import("@/pages/job-health"));
const AgentCollaborationPage = React.lazy(() => import("@/pages/agent-collaboration"));

// Misc public
const BorrowerPortal = React.lazy(() => import("@/pages/borrower-portal"));
const TermsOfService = React.lazy(() => import("@/pages/terms"));
const PrivacyPolicy = React.lazy(() => import("@/pages/privacy"));
const PricingPage = React.lazy(() => import("@/pages/pricing"));
const WhyPage = React.lazy(() => import("@/pages/why"));
const ParcelDetailPage = React.lazy(() => import("@/pages/parcel-detail"));
const FounderAgentsPage = React.lazy(() => import("@/pages/founder-agents"));
const FounderDailyDigestPage = React.lazy(() => import("@/pages/founder-daily-digest"));
const FounderDecisionsPage = React.lazy(() => import("@/pages/founder-decisions"));
const FounderLetterPage = React.lazy(() => import("@/pages/founder-letter"));
const FounderSettingsPage = React.lazy(() => import("@/pages/founder-settings"));
const FounderPreviewPage = React.lazy(() => import("@/pages/founder-preview"));
const FounderToolsPage = React.lazy(() => import("@/pages/founder-tools"));
const FounderPromptEvolutionsPage = React.lazy(() => import("@/pages/founder-prompt-evolutions"));
const FounderPromptHistoryPage = React.lazy(() => import("@/pages/founder-prompt-history"));
const FounderTracesPage = React.lazy(() => import("@/pages/founder-traces"));
const SignDocumentPage = React.lazy(() => import("@/pages/sign-document"));
const OfferBatchesPage = React.lazy(() => import("@/pages/offer-batches"));
const LeadsDedupePage = React.lazy(() => import("@/pages/leads-dedupe"));
const FounderStrategyPage = React.lazy(() => import("@/pages/founder-strategy"));
const FounderTrendsPage = React.lazy(() => import("@/pages/founder-trends"));
const MyLetterPage = React.lazy(() => import("@/pages/my-letter"));
const FounderOnboardingPage = React.lazy(() => import("@/pages/founder-onboarding"));
const FounderExpansionPage = React.lazy(() => import("@/pages/founder-expansion"));
const FounderExperimentsPage = React.lazy(() => import("@/pages/founder-experiments"));
const FounderProvidersPage = React.lazy(() => import("@/pages/founder-providers"));
const FounderTodoPage = React.lazy(() => import("@/pages/founder-todo"));
const ForgotPasswordPage = React.lazy(() => import("@/pages/forgot-password"));
const ResetPasswordPage = React.lazy(() => import("@/pages/reset-password"));
const OnboardingWizardPage = React.lazy(() => import("@/pages/onboarding-wizard"));
const OnboardingV2Page = React.lazy(() => import("@/pages/onboarding-v2"));
const FieldScoutPage = React.lazy(() => import("@/pages/field-scout"));
const DunningManagerPage = React.lazy(() => import("@/pages/dunning-manager"));
const FreedomMeterPage = React.lazy(() => import("@/pages/freedom-meter"));
const BlindOfferWizardPage = React.lazy(() => import("@/pages/blind-offer-wizard"));
const EveningReviewPage = React.lazy(() => import("@/pages/night-cap"));
const StatusPage = React.lazy(() => import("@/pages/status"));
const ChangelogPage = React.lazy(() => import("@/pages/changelog"));
const SecurityPage = React.lazy(() => import("@/pages/security"));

// ─── Page loading fallback ──────────────────────────────────────────────────
// Shown during route-level auth resolution and React.lazy() chunk loads.
// Intentionally branded (not a bare spinner) — users bouncing off a blank
// page with a tiny loader read the app as "is this still working?" A small
// AcreOS moment with a subtle pulse keeps them oriented.
function PageLoader() {
  return (
    <div
      className="min-h-screen flex items-center justify-center bg-background px-4"
      role="status"
      aria-label="Loading AcreOS"
    >
      <div className="flex flex-col items-center gap-4">
        <div className="relative">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center shadow-md">
            <span className="text-white font-bold text-xl">A</span>
          </div>
          <div
            className="absolute -inset-1 rounded-xl border-2 border-primary/30 animate-ping"
            aria-hidden="true"
          />
        </div>
        <p className="text-sm text-muted-foreground">Loading AcreOS…</p>
      </div>
    </div>
  );
}

// ─── Route wrappers ─────────────────────────────────────────────────────────
function ProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  const { user, isLoading, authFailCount } = useAuth();

  if (isLoading) {
    return <PageLoader />;
  }

  // Check if session cookie exists — if so, user was recently authenticated
  // and the session might just be refreshing. Show a loader instead of redirecting.
  const hasSessionCookie = typeof document !== "undefined" && document.cookie.includes("__session=");

  if (!user) {
    // If there's a session cookie but auth failed, the JWT might have expired
    // while Clerk tries to refresh. Show a brief loader instead of bouncing to /auth
    if (hasSessionCookie && authFailCount < 3) {
      return <PageLoader />;
    }
    return <Redirect to="/auth" />;
  }

  return <Component />;
}

function FounderProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  const { user, isLoading, isFounder } = useAuth();

  if (isLoading) {
    return <PageLoader />;
  }

  if (!user) {
    return <Redirect to="/auth" />;
  }

  if (!isFounder) {
    return <NotFound />;
  }

  return <Component />;
}

// Feature-flagged protected route: if the feature is disabled globally, render NotFound
function FlaggedRoute({ route, component: Component }: { route: string; component: React.ComponentType }) {
  const { user, isLoading: authLoading } = useAuth();
  const { isRouteEnabled, isLoading: flagsLoading } = useFeatureFlags();

  if (authLoading || flagsLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) return <Redirect to="/auth" />;
  if (!isRouteEnabled(route)) return <NotFound />;
  return <Component />;
}

// Persona-gated protected route — JC#7 / VERTICAL-EXPANSION-PLAN.md primitive #3.
// Renders the page only when the signed-in user's persona is in the allow-list;
// other personas get NotFound. Defaults treat unauthenticated users as
// land_investor so server-driven redirects still work.
function PersonaRoute({
  personas,
  component: Component,
}: {
  personas: readonly import("@shared/models/auth").Persona[];
  component: React.ComponentType;
}) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) return <Redirect to="/auth" />;
  const persona = (user.persona as import("@shared/models/auth").Persona | undefined) ?? "land_investor";
  if (!personas.includes(persona)) return <NotFound />;
  return <Component />;
}
// Re-export so persona-gated routes can be added incrementally without
// touching this file each time the type signature evolves.
export { PersonaRoute };



function HomeRoute() {
  const { user, isLoading } = useAuth();
  if (isLoading) {
    return <PageLoader />;
  }
  return user ? <Redirect to="/today" /> : <LandingPage />;
}

// ─── Router ─────────────────────────────────────────────────────────────────
function Router() {
  const [pathname] = useLocation();
  useNextRoutePrefetch(pathname);
  return (
    <React.Suspense fallback={
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    }>
    <Switch>
      <Route path="/auth" component={AuthPage} />
      <Route path="/terms" component={TermsOfService} />
      <Route path="/privacy" component={PrivacyPolicy} />

        {/* Competitor comparison pages (public, SEO-targeted) */}

      <Route path="/pricing" component={PricingPage} />
      <Route path="/why" component={WhyPage} />
      <Route path="/status" component={StatusPage} />
      <Route path="/changelog" component={ChangelogPage} />
      <Route path="/security" component={SecurityPage} />

      {/* Public Borrower Portal */}
      <Route path="/portal" component={BorrowerPortal} />

      {/* Public signing — external signers (sellers, borrowers) arrive via
          /sign/:docId?s=...&t=... with an HMAC token in the URL. No auth. */}
      <Route path="/sign/:docId" component={SignDocumentPage} />
      <Route path="/portal/:accessToken" component={BorrowerPortal} />
      
      {/* Onboarding V2 wizard */}
      <Route path="/onboarding-v2">
        {() => <ProtectedRoute component={OnboardingV2Page} />}
      </Route>

      {/* Home: landing page (unauth) or today hub (auth) */}
      <Route path="/" component={HomeRoute} />
      <Route path="/today">
        {() => <ProtectedRoute component={TodayPage} />}
      </Route>
      {/* Legacy alias — see client/src/lib/route-redirects.ts (sunset 2026-07-02). */}
      <Route path="/dashboard">
        {() => <Redirect to="/today" />}
      </Route>
      <Route path="/pipeline">
        {() => <ProtectedRoute component={PipelinePage} />}
      </Route>
      <Route path="/money">
        {() => <ProtectedRoute component={MoneyPage} />}
      </Route>
      <Route path="/ai">
        {() => <ProtectedRoute component={PaxPage} />}
      </Route>
      <Route path="/pax">
        {() => <Redirect to="/ai" />}
      </Route>
      <Route path="/leads">
        {() => <ProtectedRoute component={LeadsPage} />}
      </Route>
      <Route path="/leads/dedupe">
        {() => <ProtectedRoute component={LeadsDedupePage} />}
      </Route>
      {/* P1-28 — shareable URLs for lead detail. Sits AFTER /leads/dedupe
          so wouter doesn't route "dedupe" as the :id param. */}
      <Route path="/leads/:id">
        {() => <ProtectedRoute component={LeadDetailPage} />}
      </Route>
      <Route path="/properties">
        {() => <ProtectedRoute component={PropertiesPage} />}
      </Route>
      {/* Parcel detail v1 — JC #1 / JC #9. Composes existing widgets
          (overview / due diligence / financial / cross-links) into
          one route Land Investors can land on per parcel. */}
      <Route path="/parcels/:id">
        {() => <ProtectedRoute component={ParcelDetailPage} />}
      </Route>
      <Route path="/deals">
        {() => <ProtectedRoute component={DealsPage} />}
      </Route>
      {/* P1-28 — shareable URLs for deal detail. */}
      <Route path="/deals/:id">
        {() => <ProtectedRoute component={DealDetailPage} />}
      </Route>
      <Route path="/tasks">
        {() => <ProtectedRoute component={TasksPage} />}
      </Route>
      <Route path="/team-dashboard">
        {() => <ProtectedRoute component={TeamDashboardPage} />}
      </Route>
      <Route path="/team">
        {() => <ProtectedRoute component={TeamInboxPage} />}
      </Route>
      {/* Legacy alias — see client/src/lib/route-redirects.ts (sunset 2026-07-02). */}
      <Route path="/team-inbox">
        {() => <Redirect to="/team" />}
      </Route>
      <Route path="/automation">
        {() => <ProtectedRoute component={AutomationPage} />}
      </Route>
      <Route path="/workflows">
        {() => <ProtectedRoute component={WorkflowsPage} />}
      </Route>
      <Route path="/activity">
        {() => <ProtectedRoute component={ActivityPage} />}
      </Route>
      <Route path="/analytics">
        {() => <ProtectedRoute component={AnalyticsPage} />}
      </Route>
      <Route path="/finance">
        {() => <ProtectedRoute component={FinancePage} />}
      </Route>
      <Route path="/portfolio">
        {() => <ProtectedRoute component={PortfolioPage} />}
      </Route>
      <Route path="/campaigns">
        {() => <ProtectedRoute component={CampaignsPage} />}
      </Route>
      <Route path="/ab-tests">
        {() => <ProtectedRoute component={AbTestsPage} />}
      </Route>
      <Route path="/sequences">
        {() => <ProtectedRoute component={SequencesPage} />}
      </Route>
      <Route path="/counties">
        {() => <ProtectedRoute component={CountiesPage} />}
      </Route>
      <Route path="/offers">
        {() => <ProtectedRoute component={OffersPage} />}
      </Route>
      <Route path="/offers/batches">
        {() => <ProtectedRoute component={OfferBatchesPage} />}
      </Route>
      <Route path="/listings">
        {() => <ProtectedRoute component={ListingsPage} />}
      </Route>
      <Route path="/documents">
        {() => <ProtectedRoute component={DocumentsPage} />}
      </Route>
      <Route path="/tools">
        {() => <ProtectedRoute component={ToolsPage} />}
      </Route>
      <Route path="/command-center">
        {() => <Redirect to="/ai#chat" />}
      </Route>
      <Route path="/agents">
        {() => <Redirect to="/ai#agents" />}
      </Route>
      <Route path="/ai-team">
        {() => <Redirect to="/ai#agents" />}
      </Route>
      <Route path="/support">
        {() => <ProtectedRoute component={SupportPage} />}
      </Route>
      <Route path="/settings">
        {() => <ProtectedRoute component={SettingsPage} />}
      </Route>
      <Route path="/my-letter">
        {() => <ProtectedRoute component={MyLetterPage} />}
      </Route>
      <Route path="/settings/email">
        {() => <ProtectedRoute component={EmailSettingsPage} />}
      </Route>
      <Route path="/settings/mail">
        {() => <ProtectedRoute component={MailSettingsPage} />}
      </Route>
      <Route path="/inbox">
        {() => <ProtectedRoute component={InboxPage} />}
      </Route>
      <Route path="/help">
        {() => <ProtectedRoute component={HelpPage} />}
      </Route>
      <Route path="/admin/support">
        {() => <ProtectedRoute component={AdminSupportPage} />}
      </Route>
      <Route path="/founder-dashboard">
        {() => <FounderProtectedRoute component={FounderDashboard} />}
      </Route>
      {/* /founder and /founder-home now serve the new clean home with
          autonomy-health card + unified todo preview. The legacy
          operational dashboard lives at /founder-dashboard. */}
      {/* Legacy alias — see client/src/lib/route-redirects.ts (sunset 2026-07-02). */}
      <Route path="/founder-home">
        {() => <Redirect to="/founder" />}
      </Route>
      <Route path="/founder">
        {() => <FounderProtectedRoute component={FounderHomePage} />}
      </Route>
      <Route path="/founder/ai-observatory">
        {() => <FounderProtectedRoute component={FounderAiObservatory} />}
      </Route>
      {/* Legacy binary-flag page consolidated to /founder/features per
          JUDGMENT-CALL-RECOMMENDATIONS #6. Old page kept registered (lazy-
          loaded only on direct URL hit, not in nav) for one release in case
          migration edge-cases surface; planned removal next cleanup. */}
      <Route path="/founder/feature-flags">
        {() => <Redirect to="/founder/features" />}
      </Route>
      <Route path="/founder/features">
        {() => <FounderProtectedRoute component={FounderFeatures} />}
      </Route>
      <Route path="/founder/integrations">
        {() => <FounderProtectedRoute component={FounderIntegrationsPage} />}
      </Route>
      <Route path="/founder/ai-costs">
        {() => <FounderProtectedRoute component={FounderAiCostsPage} />}
      </Route>
      <Route path="/founder/dsar">
        {() => <FounderProtectedRoute component={FounderDsarPage} />}
      </Route>
      <Route path="/founder/legal-holds">
        {() => <FounderProtectedRoute component={FounderLegalHoldsPage} />}
      </Route>
      <Route path="/founder/sub-processors">
        {() => <FounderProtectedRoute component={FounderSubProcessorsPage} />}
      </Route>
      <Route path="/founder/recovery-console">
        {() => <FounderProtectedRoute component={FounderRecoveryConsolePage} />}
      </Route>
      <Route path="/founder/activation">
        {() => <FounderProtectedRoute component={FounderActivationPage} />}
      </Route>
      <Route path="/marketplace">
        {() => <FlaggedRoute route="/marketplace" component={MarketplacePage} />}
      </Route>
      {/* AcademyPage removed — Academy feature deprecated */}
      <Route path="/land-credit">
        {() => <FlaggedRoute route="/land-credit" component={LandCreditPage} />}
      </Route>
      <Route path="/radar">
        {() => <FlaggedRoute route="/radar" component={AcquisitionRadarPage} />}
      </Route>
      <Route path="/portfolio-optimizer">
        {() => <FlaggedRoute route="/portfolio-optimizer" component={PortfolioOptimizerPage} />}
      </Route>
      <Route path="/avm">
        {() => <FlaggedRoute route="/avm" component={AVMPage} />}
      </Route>
      <Route path="/maps">
        {() => <ProtectedRoute component={MapsPage} />}
      </Route>
      <Route path="/negotiation">
        {() => <FlaggedRoute route="/negotiation" component={NegotiationCopilotPage} />}
      </Route>
      <Route path="/cash-flow">
        {() => <ProtectedRoute component={CashFlowPage} />}
      </Route>
      <Route path="/deal-hunter">
        {() => <FlaggedRoute route="/deal-hunter" component={DealHunterPage} />}
      </Route>
      <Route path="/vision-ai">
        {() => <FlaggedRoute route="/vision-ai" component={VisionAIPage} />}
      </Route>
      <Route path="/capital-markets">
        {() => <FlaggedRoute route="/capital-markets" component={CapitalMarketsPage} />}
      </Route>
      <Route path="/market-intelligence">
        {() => <FlaggedRoute route="/market-intelligence" component={MarketIntelligencePage} />}
      </Route>
      <Route path="/compliance">
        {() => <FlaggedRoute route="/compliance" component={CompliancePage} />}
      </Route>
      <Route path="/tax-researcher">
        {() => <FlaggedRoute route="/tax-researcher" component={TaxResearcherPage} />}
      </Route>
      <Route path="/document-intelligence">
        {() => <FlaggedRoute route="/document-intelligence" component={DocumentIntelligencePage} />}
      </Route>
      <Route path="/admin/beta">
        {() => <FounderProtectedRoute component={BetaDashboardPage} />}
      </Route>
      <Route path="/admin/safety-gates">
        {() => <FounderProtectedRoute component={SafetyGatesPage} />}
      </Route>
      <Route path="/admin/decisions">
        {/* Cycle 7 r8 Gabriel: autonomous-decision-review is a customer-
            facing feature per acreos-product-model.md; opening this to
            any authenticated user so non-founders can see the
            Decisions Inbox for their own org. */}
        {() => <ProtectedRoute component={DecisionQueuePage} />}
      </Route>
      {/* Cycle 7: legacy /decision-queue alias — /today linked there
          but the real route is /admin/decisions. Redirect so existing
          CTAs and bookmarks still land on the right surface. */}
      <Route path="/decision-queue">
        {() => <Redirect to="/admin/decisions" />}
      </Route>
      <Route path="/admin/ops">
        {() => <FounderProtectedRoute component={OpsDashboardPage} />}
      </Route>
      <Route path="/admin/beta-intake">
        {/* Cycle 10 F03: /admin/beta-intake was routing to the PUBLIC
            beta sign-up form (beta-intake.tsx). The founder's admin
            review queue is at beta-dashboard.tsx (routed at /admin/beta).
            Redirect so founders land on the actual admin queue. The
            public form remains at /beta-intake for non-founder users. */}
        {() => <Redirect to="/admin/beta" />}
      </Route>
      <Route path="/founder/beta-analytics">
        {() => <FounderProtectedRoute component={BetaAnalyticsPage} />}
      </Route>
      <Route path="/founder/agents">
        {() => <FounderProtectedRoute component={FounderAgentsPage} />}
      </Route>
      <Route path="/founder/daily-digest">
        {() => <FounderProtectedRoute component={FounderDailyDigestPage} />}
      </Route>
      <Route path="/founder/decisions">
        {() => <FounderProtectedRoute component={FounderDecisionsPage} />}
      </Route>
      <Route path="/founder/letter">
        {() => <FounderProtectedRoute component={FounderLetterPage} />}
      </Route>
      <Route path="/founder/settings">
        {() => <FounderProtectedRoute component={FounderSettingsPage} />}
      </Route>
      <Route path="/founder/preview">
        {() => <FounderProtectedRoute component={FounderPreviewPage} />}
      </Route>
      <Route path="/founder/tools">
        {() => <FounderProtectedRoute component={FounderToolsPage} />}
      </Route>
      <Route path="/founder/prompt-evolutions">
        {() => <FounderProtectedRoute component={FounderPromptEvolutionsPage} />}
      </Route>
      <Route path="/founder/prompt-history">
        {() => <FounderProtectedRoute component={FounderPromptHistoryPage} />}
      </Route>
      <Route path="/founder/traces">
        {() => <FounderProtectedRoute component={FounderTracesPage} />}
      </Route>
      <Route path="/founder/strategy">
        {() => <FounderProtectedRoute component={FounderStrategyPage} />}
      </Route>
      <Route path="/founder/trends">
        {() => <FounderProtectedRoute component={FounderTrendsPage} />}
      </Route>
      <Route path="/founder/onboarding">
        {() => <FounderProtectedRoute component={FounderOnboardingPage} />}
      </Route>
      <Route path="/founder/expansion">
        {() => <FounderProtectedRoute component={FounderExpansionPage} />}
      </Route>
      <Route path="/founder/experiments">
        {() => <FounderProtectedRoute component={FounderExperimentsPage} />}
      </Route>
      <Route path="/founder/providers">
        {() => <FounderProtectedRoute component={FounderProvidersPage} />}
      </Route>
      <Route path="/founder/todo">
        {() => <FounderProtectedRoute component={FounderTodoPage} />}
      </Route>
      <Route path="/executive-dashboard">
        {() => <FounderProtectedRoute component={ExecutiveDashboardPage} />}
      </Route>

      <Route path="/deal-underwriting">
        {() => <ProtectedRoute component={DealUnderwritingPage} />}
      </Route>
      <Route path="/deal-feed">
        {() => <ProtectedRoute component={DealFeedPage} />}
      </Route>
      <Route path="/market-data">
        {() => <ProtectedRoute component={MarketDataPage} />}
      </Route>
      <Route path="/team-kpi">
        {() => <ProtectedRoute component={TeamKPIPage} />}
      </Route>

      {/* Finance — additional */}
      <Route path="/forecasting">
        {() => <ProtectedRoute component={ForecastingPage} />}
      </Route>
      <Route path="/portfolio-health">
        {() => <ProtectedRoute component={PortfolioHealthPage} />}
      </Route>
      <Route path="/portfolio-pnl">
        {() => <ProtectedRoute component={PortfolioPnLPage} />}
      </Route>
      <Route path="/exchange-1031">
        {() => <ProtectedRoute component={Exchange1031Page} />}
      </Route>
      <Route path="/tax-optimizer">
        {() => <ProtectedRoute component={TaxOptimizerPage} />}
      </Route>
      <Route path="/tax-delinquent">
        {() => <ProtectedRoute component={TaxDelinquentPage} />}
      </Route>
      <Route path="/bookkeeping">
        {() => <ProtectedRoute component={BookkeepingPage} />}
      </Route>
      <Route path="/depreciation">
        {() => <ProtectedRoute component={DepreciationCalculatorPage} />}
      </Route>
      <Route path="/closing-costs">
        {() => <ProtectedRoute component={ClosingCostsPage} />}
      </Route>
      <Route path="/property-tax">
        {() => <ProtectedRoute component={PropertyTaxPage} />}
      </Route>
      <Route path="/fee-dashboard">
        {() => <FounderProtectedRoute component={FeeDashboardPage} />}
      </Route>

      {/* AI / Intelligence — additional */}
      <Route path="/avm-bulk">
        {() => <FlaggedRoute route="/avm-bulk" component={AvmBulkPage} />}
      </Route>
      <Route path="/market-watchlist">
        {() => <FlaggedRoute route="/market-watchlist" component={MarketWatchlistPage} />}
      </Route>
      <Route path="/price-optimizer">
        {() => <FlaggedRoute route="/price-optimizer" component={PriceOptimizerPage} />}
      </Route>
      <Route path="/seller-intent">
        {() => <FlaggedRoute route="/seller-intent" component={SellerIntentPage} />}
      </Route>
      <Route path="/deal-patterns">
        {() => <FlaggedRoute route="/deal-patterns" component={DealPatternsPage} />}
      </Route>
      <Route path="/conscious-organization">
        {() => <ProtectedRoute component={ConsciousOrganizationPage} />}
      </Route>
      <Route path="/anticipatory-enterprise">
        {/* Exposes internal agent-negotiation codenames (forge_revenue,
            sophie_support, shield_compliance...). Founder-only to keep
            the internal agent taxonomy off customer surfaces — customers
            see one AI brand (Pax), not the dozen under the hood. */}
        {() => <FounderProtectedRoute component={AnticipatoryEnterprisePage} />}
      </Route>
      <Route path="/real-runtime">
        {() => <ProtectedRoute component={RealRuntimePage} />}
      </Route>
      <Route path="/agent-command-center">
        {() => <Redirect to="/ai#agents" />}
      </Route>

      {/* Operations — additional */}
      <Route path="/zoning">
        {() => <ProtectedRoute component={ZoningLookupPage} />}
      </Route>
      <Route path="/title-search">
        {() => <ProtectedRoute component={TitleSearchPage} />}
      </Route>
      <Route path="/property-enrichment">
        {() => <ProtectedRoute component={PropertyEnrichmentPage} />}
      </Route>
      <Route path="/skip-tracing">
        {() => <ProtectedRoute component={SkipTracingPage} />}
      </Route>
      <Route path="/direct-mail">
        {() => <ProtectedRoute component={DirectMailCampaignsPage} />}
      </Route>
      <Route path="/syndication">
        {() => <ProtectedRoute component={SyndicationPage} />}
      </Route>
      <Route path="/syndication-status">
        {() => <ProtectedRoute component={ListingSyndicationPage} />}
      </Route>

      {/* Team — additional */}
      <Route path="/commissions">
        {() => <ProtectedRoute component={CommissionsPage} />}
      </Route>
      <Route path="/team-leaderboard">
        {() => <ProtectedRoute component={TeamLeaderboardPage} />}
      </Route>

      {/* Analytics / Reporting */}
      <Route path="/kpis">
        {() => <ProtectedRoute component={KPIDashboardPage} />}
      </Route>
      <Route path="/cohort-analysis">
        {() => <ProtectedRoute component={CohortAnalysisPage} />}
      </Route>
      <Route path="/audit-log">
        {() => <ProtectedRoute component={AuditLogPage} />}
      </Route>
      <Route path="/data-export">
        {() => <ProtectedRoute component={DataExportPage} />}
      </Route>
      <Route path="/model-training">
        {() => <ProtectedRoute component={ModelTrainingPage} />}
      </Route>
      <Route path="/investor-network">
        {() => <ProtectedRoute component={InvestorDirectoryPage} />}
      </Route>
      <Route path="/regulatory-intel">
        {() => <ProtectedRoute component={RegulatoryIntelPage} />}
      </Route>

      {/* Settings — additional */}
      <Route path="/settings/privacy">
        {() => <ProtectedRoute component={PrivacySettingsPage} />}
      </Route>
      <Route path="/settings/tax-identity">
        {() => <ProtectedRoute component={TaxIdentitySettingsPage} />}
      </Route>
      <Route path="/settings/accessibility">
        {() => <ProtectedRoute component={AccessibilitySettingsPage} />}
      </Route>
      <Route path="/usage">
        {() => <ProtectedRoute component={UsageQuotaPage} />}
      </Route>
      <Route path="/goals">
        {() => <ProtectedRoute component={GoalsPage} />}
      </Route>
      <Route path="/webhooks">
        {() => <ProtectedRoute component={WebhooksPage} />}
      </Route>
      <Route path="/dodd-frank">
        {() => <FlaggedRoute route="/dodd-frank" component={DoddFrankCheckerPage} />}
      </Route>
      <Route path="/state-documents">
        {() => <ProtectedRoute component={StateDocumentsPage} />}
      </Route>
      <Route path="/dunning">
        {() => <ProtectedRoute component={DunningManagerPage} />}
      </Route>
      <Route path="/freedom-meter">
        {() => <ProtectedRoute component={FreedomMeterPage} />}
      </Route>
      <Route path="/blind-offer-wizard">
        {() => <ProtectedRoute component={BlindOfferWizardPage} />}
      </Route>
      <Route path="/night-cap">
        {() => <ProtectedRoute component={EveningReviewPage} />}
      </Route>
      <Route path="/evening-review">
        {() => <ProtectedRoute component={EveningReviewPage} />}
      </Route>

      {/* Founder / Admin — additional */}
      <Route path="/founder/v13">
        {() => <FounderProtectedRoute component={SovereignV13Page} />}
      </Route>
      <Route path="/founder/agents/:codename">
        {() => <FounderProtectedRoute component={AgentDetailPage} />}
      </Route>
      <Route path="/admin/beta-analytics">
        {() => <FounderProtectedRoute component={BetaAnalyticsPage} />}
      </Route>
      <Route path="/admin/queues">
        {() => <FounderProtectedRoute component={QueueMonitorPage} />}
      </Route>
      <Route path="/admin/integrations-health">
        {() => <FounderProtectedRoute component={IntegrationsHealthPage} />}
      </Route>
      <Route path="/admin/monitor">
        {() => <ProtectedRoute component={ProactiveMonitorPage} />}
      </Route>
      <Route path="/reseller">
        {() => <FounderProtectedRoute component={ResellerDashboardPage} />}
      </Route>
      <Route path="/data-moat">
        {() => <FounderProtectedRoute component={DataMoatDashboardPage} />}
      </Route>

      {/* Sovereign Protocol — Phase A Visibility Layer */}
      <Route path="/sovereign">
        {() => <FounderProtectedRoute component={SovereignDashboardPage} />}
      </Route>
      <Route path="/board-of-directors">
        {() => <FounderProtectedRoute component={BoardOfDirectorsPage} />}
      </Route>
      <Route path="/agent-performance">
        {() => <FounderProtectedRoute component={AgentPerformancePage} />}
      </Route>
      <Route path="/memory-browser">
        {() => <FounderProtectedRoute component={MemoryBrowserPage} />}
      </Route>
      <Route path="/event-log">
        {() => <FounderProtectedRoute component={EventLogPage} />}
      </Route>
      <Route path="/job-health">
        {() => <FounderProtectedRoute component={JobHealthPage} />}
      </Route>
      <Route path="/agent-collaboration">
        {() => <FounderProtectedRoute component={AgentCollaborationPage} />}
      </Route>

      <Route component={NotFound} />
      </Switch>
    </React.Suspense>
  );
}

function PageWrapper({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={location}
        variants={pageTransition}
        initial="initial"
        animate="animate"
        exit="exit"
        className="min-h-screen"
        id="main-content"
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

function AppContent() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [location] = useLocation();
  useSwipeNavigation();
  useWhiteLabel();
  useCursorGlass();

  // NPS feedback collection
  const [npsOpen, setNpsOpen] = React.useState(false);
  const [npsDismissChecked, setNpsDismissChecked] = React.useState(false);

  const { data: npsData } = useQuery<{ shouldShow: boolean; trigger: string | null }>({
    queryKey: ["/api/nps/pending"],
    enabled: !!user,
    staleTime: 5 * 60 * 1000, // Check at most every 5 minutes
    refetchOnWindowFocus: false,
  });

  React.useEffect(() => {
    if (!npsData?.shouldShow || npsDismissChecked) return;
    setNpsDismissChecked(true);

    // Respect 7-day dismiss window
    const dismissedAt = localStorage.getItem("nps_dismissed_at");
    if (dismissedAt) {
      const dismissedDate = new Date(dismissedAt);
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      if (dismissedDate > sevenDaysAgo) return;
    }

    // Delay showing NPS dialog so it doesn't interrupt page load
    const timer = setTimeout(() => setNpsOpen(true), 3000);
    return () => clearTimeout(timer);
  }, [npsData, npsDismissChecked]);

  React.useEffect(() => {
    if (user) {
      telemetry.sessionStart();
      // Tag Sentry events with the authenticated user so error reports
      // are searchable by id/email. Cleared on logout via the else branch.
      setSentryUser({ id: user.id, email: user.email ?? undefined });
    } else {
      setSentryUser(null);
    }
  }, [user]);

  // One-time hint for command palette
  if (import.meta.env.DEV && typeof window !== 'undefined') {
    const seen = localStorage.getItem('hint_cmdk_shown');
    if (!seen && user) {
      localStorage.setItem('hint_cmdk_shown', '1');
      setTimeout(() => {
        toast({ title: 'Tip', description: 'Press ⌘K (or Ctrl+K) to open the command palette.' });
      }, 800);
    }
  }

  return (
    <>
      <a href="#main-content" className="skip-to-content" aria-label="Skip to main content">
        Skip to content
      </a>
      {user && <EarlyAccessBanner />}
      {user && <TrialBanner />}
      <PageWrapper>
        <Router />
      </PageWrapper>
      {/* Floating dock — canonical slots, no overlaps (see lib/floating-slots.ts):
          slot 0 (bottom-4):    primary FAB  — new lead/property/deal/etc
          slot 1 (bottom-24):   conversation tray — chat with agents
          slot 2 (bottom-176):  help (also hosts feedback)
          Feedback was slot 3 until the consolidation pass — now it
          lives inside the help sheet + settings + command palette. */}
      {/* FloatingActionButton hidden on desktop — desktop has ⌘K + sidebar
          New-Item menu; mobile keeps the FAB as a tap target. */}
      {user && <div className="md:hidden"><FloatingActionButton /></div>}
      {user && <ConversationTray />}
      {/* FloatingHelpButton removed 2026-05-01 — folded into ⌘K command
          palette (already shipped). The help search lives there now;
          one fewer FAB on every page. */}
      {/* Lazy-loaded floating components — wrapped in Suspense with null
          fallback so the entry chunk doesn't ship them. They appear after
          first paint with no visible delay (small JS, fetched in parallel
          with main render). */}
      {user && (
        <Suspense fallback={null}>
          <CommandPalette />
        </Suspense>
      )}
      {/* Founder-specific ⌘⇧K palette — searches decisions, agents, letters, proposals */}
      <FounderCommandPaletteProvider>{null}</FounderCommandPaletteProvider>
      {user && (
        <Suspense fallback={null}>
          <NewItemMenu />
        </Suspense>
      )}
      {/* Suppress MobileBottomNav on founder routes — customer-side nav
          items don't apply to founder mode (#9 audit finding). */}
      {user && !location.startsWith("/founder") && <MobileBottomNav />}
      {user && (
        <Suspense fallback={null}>
          <OnboardingWizard />
        </Suspense>
      )}
      {user && <BetaActivationDetector />}
      {/* Hide the global PaxCopilotRail on /ai because that page has
          its own main-area chat UI ("AcreOS Assistant"). r3 Gabriel
          caught the dual-chat-UI confusion (UX-R3-001). Elsewhere
          the rail remains the primary conversational entry point. */}
      {user && !location.startsWith("/ai") && (
        <Suspense fallback={null}>
          <PaxCopilotRail />
        </Suspense>
      )}
      {user && <DynamicIsland />}
      {user && <NotificationBanner />}
      {user && npsData?.shouldShow && npsData.trigger && (
        <Suspense fallback={null}>
          <NpsDialog
            open={npsOpen}
            trigger={npsData.trigger}
            onClose={() => setNpsOpen(false)}
          />
        </Suspense>
      )}
      <PWAInstallPrompt />
    </>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <MotionConfig reducedMotion="user">
      <ThemeProvider>
        <SidebarProvider>
          <PaxRailProvider>
          <DynamicIslandProvider>
          <QueryClientProvider client={queryClient}>
            <FeatureFlagsProvider>
            <TooltipProvider>
              <HintsProvider>
                <KeyboardShortcutsProvider>
                  <OfflineIndicator />
                  <Toaster />
                  <CookieConsentBanner />
                  <AppContent />
                  <Suspense fallback={null}>
                    <KeyboardShortcutsModal />
                  </Suspense>
                  <DealModalsHost />
                </KeyboardShortcutsProvider>
              </HintsProvider>
            </TooltipProvider>
            </FeatureFlagsProvider>
          </QueryClientProvider>
          </DynamicIslandProvider>
          </PaxRailProvider>
        </SidebarProvider>
      </ThemeProvider>
      </MotionConfig>
    </ErrorBoundary>
  );
}

export default App;
