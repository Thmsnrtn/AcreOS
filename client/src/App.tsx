import React, { Suspense } from "react";
import { Switch, Route, Redirect, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { CookieConsentBanner } from "@/components/cookie-consent-banner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/use-auth";
import { useWhiteLabel } from "@/hooks/use-white-label";
import { useFeatureFlags } from "@/hooks/use-feature-flags";
import { Loader2 } from "lucide-react";
import { telemetry } from "@/lib/telemetry";
import { ThemeProvider } from "@/contexts/theme-context";
import { PaxRailProvider } from "@/contexts/pax-rail-context";
import { AnimatePresence, motion } from "framer-motion";
import { pageTransition } from "@/lib/animations";
import { useToast } from "@/hooks/use-toast";

import { SidebarProvider } from "@/components/layout-sidebar";
import { HintsProvider } from "@/components/feature-hints";
import { KeyboardShortcutsProvider } from "@/hooks/use-keyboard-shortcuts";
import { KeyboardShortcutsModal } from "@/components/keyboard-shortcuts";
import { NewItemMenu } from "@/components/new-item-menu";
import { QuickActionsMenu } from "@/components/quick-actions-menu";
import { OnboardingWizard } from "@/components/onboarding-wizard";
import { PWAInstallPrompt } from "@/components/pwa-install-prompt";
import { ConversationTray } from "@/components/conversation-tray";
import { ErrorBoundary } from "@/components/error-boundary";
import { OfflineIndicator } from "@/components/offline-indicator";
import { FloatingActionButton } from "@/components/floating-action-button";
import { FloatingHelpButton } from "@/components/floating-help-button";
import { CommandPalette } from "@/components/command-palette";
import { useSwipeNavigation } from "@/hooks/use-swipe-gesture";
import { useNextRoutePrefetch } from "@/hooks/use-next-route-prefetch";
import { MobileBottomNav } from "@/components/mobile";
import { BetaFeedbackWidget } from "@/components/beta-feedback-widget";
import { BetaActivationDetector } from "@/components/beta-activation-detector";
import { PaxCopilotRail } from "@/components/pax-copilot-rail";
import { DynamicIsland } from "@/components/dynamic-island";
import { DynamicIslandProvider } from "@/contexts/dynamic-island-context";
import { useCursorGlass } from "@/hooks/use-cursor-glass";

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
const PropertiesPage = React.lazy(() => import("@/pages/properties"));
const DealsPage = React.lazy(() => import("@/pages/deals"));
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
const DocumentIntelligencePage = React.lazy(() => import("@/pages/document-intelligence"));
// VoiceAnalyticsPage removed — AI Voice feature deprecated
const MarketplaceAnalyticsPage = React.lazy(() => import("@/pages/marketplace-analytics"));

// Operations
const MapsPage = React.lazy(() => import("@/pages/maps"));
const CommandCenterPage = React.lazy(() => import("@/pages/command-center"));
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
const FounderAiObservatory = React.lazy(() => import("@/pages/founder-ai-observatory"));
const DealUnderwritingPage = React.lazy(() => import("@/pages/deal-underwriting"));
const TeamKPIPage = React.lazy(() => import("@/pages/team-kpi"));
const SafetyGatesPage = React.lazy(() => import("@/pages/safety-gates"));
const DecisionQueuePage = React.lazy(() => import("@/pages/decision-queue"));
const OpsDashboardPage = React.lazy(() => import("@/pages/ops-dashboard"));
const BetaIntakePage = React.lazy(() => import("@/pages/beta-intake"));
const QueueMonitorPage = React.lazy(() => import("@/pages/queue-monitor"));
const IntegrationsHealthPage = React.lazy(() => import("@/pages/integrations-health"));
const ProactiveMonitorPage = React.lazy(() => import("@/pages/proactive-monitor"));
const BetaDashboardPage = React.lazy(() => import("@/pages/beta-dashboard"));
const ResellerDashboardPage = React.lazy(() => import("@/pages/reseller-dashboard"));
const DataMoatDashboardPage = React.lazy(() => import("@/pages/data-moat-dashboard"));

// Misc public
const BorrowerPortal = React.lazy(() => import("@/pages/borrower-portal"));
const TermsOfService = React.lazy(() => import("@/pages/terms"));
const PrivacyPolicy = React.lazy(() => import("@/pages/privacy"));
const ForgotPasswordPage = React.lazy(() => import("@/pages/forgot-password"));
const ResetPasswordPage = React.lazy(() => import("@/pages/reset-password"));
const OnboardingWizardPage = React.lazy(() => import("@/pages/onboarding-wizard"));
const OnboardingV2Page = React.lazy(() => import("@/pages/onboarding-v2"));
const FieldScoutPage = React.lazy(() => import("@/pages/field-scout"));
const DunningManagerPage = React.lazy(() => import("@/pages/dunning-manager"));
const FreedomMeterPage = React.lazy(() => import("@/pages/freedom-meter"));
const BlindOfferWizardPage = React.lazy(() => import("@/pages/blind-offer-wizard"));
const NightCapPage = React.lazy(() => import("@/pages/night-cap"));

// ─── Page loading fallback ──────────────────────────────────────────────────
function PageLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center" aria-label="Loading page">
      <Loader2 className="w-8 h-8 animate-spin text-primary" aria-hidden="true" />
    </div>
  );
}

// ─── Route wrappers ─────────────────────────────────────────────────────────
function ProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return <PageLoader />;
  }

  if (!user) {
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
        <Route path="/compare/lg-pass">{() => <ProtectedRoute component={React.lazy(() => import("@/pages/compare-lgpass"))} />}</Route>
        <Route path="/compare/geekpay">{() => <ProtectedRoute component={React.lazy(() => import("@/pages/compare-geekpay"))} />}</Route>

      {/* Public Borrower Portal */}
      <Route path="/portal" component={BorrowerPortal} />
      <Route path="/portal/:accessToken" component={BorrowerPortal} />
      
      {/* Home: landing page (unauth) or today hub (auth) */}
      <Route path="/" component={HomeRoute} />
      <Route path="/today">
        {() => <ProtectedRoute component={TodayPage} />}
      </Route>
      <Route path="/pipeline">
        {() => <ProtectedRoute component={PipelinePage} />}
      </Route>
      <Route path="/money">
        {() => <ProtectedRoute component={MoneyPage} />}
      </Route>
      <Route path="/pax">
        {() => <ProtectedRoute component={PaxPage} />}
      </Route>
      <Route path="/leads">
        {() => <ProtectedRoute component={LeadsPage} />}
      </Route>
      <Route path="/properties">
        {() => <ProtectedRoute component={PropertiesPage} />}
      </Route>
      <Route path="/deals">
        {() => <ProtectedRoute component={DealsPage} />}
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
        {() => <ProtectedRoute component={CommandCenterPage} />}
      </Route>
      <Route path="/agents">
        {() => <Redirect to="/command-center" />}
      </Route>
      <Route path="/ai-team">
        {() => <Redirect to="/command-center" />}
      </Route>
      <Route path="/support">
        {() => <ProtectedRoute component={SupportPage} />}
      </Route>
      <Route path="/settings">
        {() => <ProtectedRoute component={SettingsPage} />}
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
      <Route path="/founder">
        {() => <FounderProtectedRoute component={FounderDashboard} />}
      </Route>
      <Route path="/founder/ai-observatory">
        {() => <FounderProtectedRoute component={FounderAiObservatory} />}
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
        {() => <FounderProtectedRoute component={React.lazy(() => import("@/pages/beta-dashboard"))} />}
      </Route>
      <Route path="/admin/safety-gates">
        {() => <FounderProtectedRoute component={SafetyGatesPage} />}
      </Route>
      <Route path="/admin/decisions">
        {() => <FounderProtectedRoute component={DecisionQueuePage} />}
      </Route>
      <Route path="/admin/ops">
        {() => <FounderProtectedRoute component={OpsDashboardPage} />}
      </Route>
      <Route path="/admin/beta-intake">
        {() => <FounderProtectedRoute component={BetaIntakePage} />}
      </Route>

      <Route path="/deal-underwriting">
        {() => <ProtectedRoute component={DealUnderwritingPage} />}
      </Route>
      <Route path="/team-kpi">
        {() => <ProtectedRoute component={TeamKPIPage} />}
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
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

function AppContent() {
  const { user } = useAuth();
  const { toast } = useToast();
  useSwipeNavigation();
  useWhiteLabel();
  useCursorGlass();

  React.useEffect(() => {
    if (user) {
      telemetry.sessionStart();
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
      <PageWrapper>
        <Router />
      </PageWrapper>
      {user && <FloatingActionButton />}
      {user && <FloatingHelpButton />}
      {user && <QuickActionsMenu />}
      {user && <ConversationTray />}
      {user && <CommandPalette />}
      {user && <NewItemMenu />}
      {user && <MobileBottomNav />}
      {user && <OnboardingWizard />}
      {user && <BetaFeedbackWidget />}
      {user && <BetaActivationDetector />}
      {user && <PaxCopilotRail />}
      {user && <DynamicIsland />}
      <PWAInstallPrompt />
    </>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <SidebarProvider>
          <PaxRailProvider>
          <DynamicIslandProvider>
          <QueryClientProvider client={queryClient}>
            <TooltipProvider>
              <HintsProvider>
                <KeyboardShortcutsProvider>
                  <OfflineIndicator />
                  <Toaster />
                  <CookieConsentBanner />
                  <AppContent />
                  <KeyboardShortcutsModal />
                </KeyboardShortcutsProvider>
              </HintsProvider>
            </TooltipProvider>
          </QueryClientProvider>
          </DynamicIslandProvider>
          </PaxRailProvider>
        </SidebarProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
