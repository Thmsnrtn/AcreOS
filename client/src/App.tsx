import React, { Suspense } from "react";
import { Switch, Route, Redirect, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/use-auth";
import { useWhiteLabel } from "@/hooks/use-white-label";
import { Loader2 } from "lucide-react";
import { telemetry } from "@/lib/telemetry";
import { ThemeProvider } from "@/contexts/theme-context";
import { AnimatePresence, motion } from "framer-motion";
import { pageTransition } from "@/lib/animations";

import { SidebarProvider } from "@/components/layout-sidebar";
import { HintsProvider } from "@/components/feature-hints";
import { KeyboardShortcutsProvider } from "@/hooks/use-keyboard-shortcuts";
import { KeyboardShortcutsModal } from "@/components/keyboard-shortcuts";
import { NewItemMenu } from "@/components/new-item-menu";
import { QuickActionsMenu } from "@/components/quick-actions-menu";
import { PWAInstallPrompt } from "@/components/pwa-install-prompt";
import { ConversationTray } from "@/components/conversation-tray";
import { ErrorBoundary } from "@/components/error-boundary";
import { OfflineIndicator } from "@/components/offline-indicator";
import { FloatingActionButton } from "@/components/floating-action-button";
import { FloatingHelpButton } from "@/components/floating-help-button";
import { CommandPalette } from "@/components/command-palette";
import { useSwipeNavigation } from "@/hooks/use-swipe-gesture";
import { MobileBottomNav } from "@/components/mobile";
import { BetaFeedbackWidget } from "@/components/beta-feedback-widget";
import { BetaActivationDetector } from "@/components/beta-activation-detector";

// Eagerly loaded: must be available immediately with no delay
import AuthPage from "@/pages/auth-page";
import LandingPage from "@/pages/landing";
import NotFound from "@/pages/not-found";

// ─── Lazy-loaded page bundles ───────────────────────────────────────────────
// Core (primary nav)
const TodayPage = React.lazy(() => import("@/pages/today"));
const PipelinePage = React.lazy(() => import("@/pages/pipeline"));
const MoneyPage = React.lazy(() => import("@/pages/money"));
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
const VisionAIPage = React.lazy(() => import("@/pages/vision-ai"));
const LandCreditPage = React.lazy(() => import("@/pages/land-credit"));
const MarketIntelligencePage = React.lazy(() => import("@/pages/market-intelligence"));
const MarketWatchlistPage = React.lazy(() => import("@/pages/market-watchlist"));
const PriceOptimizerPage = React.lazy(() => import("@/pages/price-optimizer"));
const SellerIntentPage = React.lazy(() => import("@/pages/seller-intent"));
const DealPatternsPage = React.lazy(() => import("@/pages/deal-patterns"));
const DocumentIntelligencePage = React.lazy(() => import("@/pages/document-intelligence"));
const VoiceAnalyticsPage = React.lazy(() => import("@/pages/voice-analytics"));
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
const AcademyPage = React.lazy(() => import("@/pages/academy"));
const InvestorDirectoryPage = React.lazy(() => import("@/pages/investor-directory"));
const BuyerQualificationPage = React.lazy(() => import("@/pages/buyer-qualification"));
const MatchingEnginePage = React.lazy(() => import("@/pages/matching-engine"));

// Admin / Founder
const AdminSupportPage = React.lazy(() => import("@/pages/admin-support"));
const FounderDashboard = React.lazy(() => import("@/pages/founder-dashboard"));
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
const OnboardingWizardPage = React.lazy(() => import("@/pages/onboarding-wizard"));
const DunningManagerPage = React.lazy(() => import("@/pages/dunning-manager"));

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

function HomeRoute() {
  const { user, isLoading } = useAuth();
  if (isLoading) {
    return <PageLoader />;
  }
  return user ? <Redirect to="/today" /> : <LandingPage />;
}

// ─── Router ─────────────────────────────────────────────────────────────────
function Router() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Switch>
        {/* Public routes */}
        <Route path="/auth" component={AuthPage} />
        <Route path="/terms" component={TermsOfService} />
        <Route path="/privacy" component={PrivacyPolicy} />
        <Route path="/portal" component={BorrowerPortal} />
        <Route path="/portal/:accessToken" component={BorrowerPortal} />
        <Route path="/onboarding">{() => <OnboardingWizardPage />}</Route>

        {/* Home */}
        <Route path="/" component={HomeRoute} />

        {/* Core */}
        <Route path="/today">{() => <ProtectedRoute component={TodayPage} />}</Route>
        <Route path="/pipeline">{() => <ProtectedRoute component={PipelinePage} />}</Route>
        <Route path="/money">{() => <ProtectedRoute component={MoneyPage} />}</Route>
        <Route path="/atlas">{() => <ProtectedRoute component={AtlasPage} />}</Route>
        <Route path="/dashboard">{() => <ProtectedRoute component={Dashboard} />}</Route>

        {/* CRM */}
        <Route path="/leads">{() => <ProtectedRoute component={LeadsPage} />}</Route>
        <Route path="/properties">{() => <ProtectedRoute component={PropertiesPage} />}</Route>
        <Route path="/deals">{() => <ProtectedRoute component={DealsPage} />}</Route>
        <Route path="/tasks">{() => <ProtectedRoute component={TasksPage} />}</Route>
        <Route path="/offers">{() => <ProtectedRoute component={OffersPage} />}</Route>
        <Route path="/listings">{() => <ProtectedRoute component={ListingsPage} />}</Route>
        <Route path="/documents">{() => <ProtectedRoute component={DocumentsPage} />}</Route>
        <Route path="/documents/versions">{() => <ProtectedRoute component={DocumentVersionsPage} />}</Route>
        <Route path="/counties">{() => <ProtectedRoute component={CountiesPage} />}</Route>
        <Route path="/sequences">{() => <ProtectedRoute component={SequencesPage} />}</Route>
        <Route path="/ab-tests">{() => <ProtectedRoute component={AbTestsPage} />}</Route>
        <Route path="/activity">{() => <ProtectedRoute component={ActivityPage} />}</Route>
        <Route path="/marketplace">{() => <ProtectedRoute component={MarketplacePage} />}</Route>
        <Route path="/marketplace-analytics">{() => <ProtectedRoute component={MarketplaceAnalyticsPage} />}</Route>
        <Route path="/skip-tracing">{() => <ProtectedRoute component={SkipTracingPage} />}</Route>
        <Route path="/territories">{() => <ProtectedRoute component={TerritoryManagerPage} />}</Route>
        <Route path="/buyer-qualification">{() => <ProtectedRoute component={BuyerQualificationPage} />}</Route>
        <Route path="/matching">{() => <ProtectedRoute component={MatchingEnginePage} />}</Route>
        <Route path="/direct-mail">{() => <ProtectedRoute component={DirectMailCampaignsPage} />}</Route>
        <Route path="/drip-sequences">{() => <ProtectedRoute component={DripSequencesPage} />}</Route>
        <Route path="/va-dashboard">{() => <ProtectedRoute component={VaDashboardPage} />}</Route>

        {/* Communications */}
        <Route path="/inbox">{() => <ProtectedRoute component={InboxPage} />}</Route>
        <Route path="/campaigns">{() => <ProtectedRoute component={CampaignsPage} />}</Route>
        <Route path="/voice-analytics">{() => <ProtectedRoute component={VoiceAnalyticsPage} />}</Route>

        {/* Finance */}
        <Route path="/finance">{() => <ProtectedRoute component={FinancePage} />}</Route>
        <Route path="/portfolio">{() => <ProtectedRoute component={PortfolioPage} />}</Route>
        <Route path="/cash-flow">{() => <ProtectedRoute component={CashFlowPage} />}</Route>
        <Route path="/forecasting">{() => <ProtectedRoute component={ForecastingPage} />}</Route>
        <Route path="/capital-markets">{() => <ProtectedRoute component={CapitalMarketsPage} />}</Route>
        <Route path="/portfolio-optimizer">{() => <ProtectedRoute component={PortfolioOptimizerPage} />}</Route>
        <Route path="/portfolio-health">{() => <ProtectedRoute component={PortfolioHealthPage} />}</Route>
        <Route path="/portfolio-pnl">{() => <ProtectedRoute component={PortfolioPnLPage} />}</Route>
        <Route path="/exchange-1031">{() => <ProtectedRoute component={Exchange1031Page} />}</Route>
        <Route path="/tax-optimizer">{() => <ProtectedRoute component={TaxOptimizerPage} />}</Route>
        <Route path="/tax-delinquent">{() => <ProtectedRoute component={TaxDelinquentPage} />}</Route>
        <Route path="/bookkeeping">{() => <ProtectedRoute component={BookkeepingPage} />}</Route>
        <Route path="/depreciation">{() => <ProtectedRoute component={DepreciationCalculatorPage} />}</Route>
        <Route path="/closing-costs">{() => <ProtectedRoute component={ClosingCostsPage} />}</Route>
        <Route path="/property-tax">{() => <ProtectedRoute component={PropertyTaxPage} />}</Route>
        <Route path="/fee-dashboard">{() => <FounderProtectedRoute component={FeeDashboardPage} />}</Route>

        {/* AI / Intelligence */}
        <Route path="/analytics">{() => <ProtectedRoute component={AnalyticsPage} />}</Route>
        <Route path="/avm">{() => <ProtectedRoute component={AVMPage} />}</Route>
        <Route path="/avm-bulk">{() => <ProtectedRoute component={AvmBulkPage} />}</Route>
        <Route path="/radar">{() => <ProtectedRoute component={AcquisitionRadarPage} />}</Route>
        <Route path="/negotiation">{() => <ProtectedRoute component={NegotiationCopilotPage} />}</Route>
        <Route path="/deal-hunter">{() => <ProtectedRoute component={DealHunterPage} />}</Route>
        <Route path="/vision-ai">{() => <ProtectedRoute component={VisionAIPage} />}</Route>
        <Route path="/land-credit">{() => <ProtectedRoute component={LandCreditPage} />}</Route>
        <Route path="/market-intelligence">{() => <ProtectedRoute component={MarketIntelligencePage} />}</Route>
        <Route path="/market-watchlist">{() => <ProtectedRoute component={MarketWatchlistPage} />}</Route>
        <Route path="/price-optimizer">{() => <ProtectedRoute component={PriceOptimizerPage} />}</Route>
        <Route path="/seller-intent">{() => <ProtectedRoute component={SellerIntentPage} />}</Route>
        <Route path="/deal-patterns">{() => <ProtectedRoute component={DealPatternsPage} />}</Route>
        <Route path="/document-intelligence">{() => <ProtectedRoute component={DocumentIntelligencePage} />}</Route>
        <Route path="/tax-researcher">{() => <ProtectedRoute component={TaxResearcherPage} />}</Route>
        <Route path="/command-center">{() => <ProtectedRoute component={CommandCenterPage} />}</Route>
        <Route path="/agents">{() => <Redirect to="/command-center" />}</Route>
        <Route path="/ai-team">{() => <Redirect to="/command-center" />}</Route>

        {/* Operations */}
        <Route path="/maps">{() => <ProtectedRoute component={MapsPage} />}</Route>
        <Route path="/automation">{() => <ProtectedRoute component={AutomationPage} />}</Route>
        <Route path="/workflows">{() => <ProtectedRoute component={WorkflowsPage} />}</Route>
        <Route path="/tools">{() => <ProtectedRoute component={ToolsPage} />}</Route>
        <Route path="/zoning">{() => <ProtectedRoute component={ZoningLookupPage} />}</Route>
        <Route path="/title-search">{() => <ProtectedRoute component={TitleSearchPage} />}</Route>
        <Route path="/property-enrichment">{() => <ProtectedRoute component={PropertyEnrichmentPage} />}</Route>
        <Route path="/syndication">{() => <ProtectedRoute component={SyndicationPage} />}</Route>
        <Route path="/syndication-status">{() => <ProtectedRoute component={ListingSyndicationPage} />}</Route>

        {/* Team */}
        <Route path="/team-dashboard">{() => <ProtectedRoute component={TeamDashboardPage} />}</Route>
        <Route path="/team">{() => <ProtectedRoute component={TeamInboxPage} />}</Route>
        <Route path="/commissions">{() => <ProtectedRoute component={CommissionsPage} />}</Route>
        <Route path="/team-leaderboard">{() => <ProtectedRoute component={TeamLeaderboardPage} />}</Route>

        {/* Analytics / Reporting */}
        <Route path="/kpis">{() => <ProtectedRoute component={KPIDashboardPage} />}</Route>
        <Route path="/cohort-analysis">{() => <ProtectedRoute component={CohortAnalysisPage} />}</Route>
        <Route path="/audit-log">{() => <ProtectedRoute component={AuditLogPage} />}</Route>
        <Route path="/data-export">{() => <ProtectedRoute component={DataExportPage} />}</Route>
        <Route path="/model-training">{() => <ProtectedRoute component={ModelTrainingPage} />}</Route>
        <Route path="/investor-network">{() => <ProtectedRoute component={InvestorDirectoryPage} />}</Route>
        <Route path="/regulatory-intel">{() => <ProtectedRoute component={RegulatoryIntelPage} />}</Route>

        {/* Settings */}
        <Route path="/settings">{() => <ProtectedRoute component={SettingsPage} />}</Route>
        <Route path="/settings/email">{() => <ProtectedRoute component={EmailSettingsPage} />}</Route>
        <Route path="/settings/mail">{() => <ProtectedRoute component={MailSettingsPage} />}</Route>
        <Route path="/settings/privacy">{() => <ProtectedRoute component={PrivacySettingsPage} />}</Route>
        <Route path="/usage">{() => <ProtectedRoute component={UsageQuotaPage} />}</Route>
        <Route path="/goals">{() => <ProtectedRoute component={GoalsPage} />}</Route>
        <Route path="/webhooks">{() => <ProtectedRoute component={WebhooksPage} />}</Route>
        <Route path="/compliance">{() => <ProtectedRoute component={CompliancePage} />}</Route>
        <Route path="/dodd-frank">{() => <ProtectedRoute component={DoddFrankCheckerPage} />}</Route>
        <Route path="/state-documents">{() => <ProtectedRoute component={StateDocumentsPage} />}</Route>
        <Route path="/dunning">{() => <ProtectedRoute component={DunningManagerPage} />}</Route>

        {/* Education */}
        <Route path="/academy">{() => <ProtectedRoute component={AcademyPage} />}</Route>

        {/* Support */}
        <Route path="/help">{() => <ProtectedRoute component={HelpPage} />}</Route>
        <Route path="/support">{() => <ProtectedRoute component={SupportPage} />}</Route>
        <Route path="/admin/support">{() => <ProtectedRoute component={AdminSupportPage} />}</Route>

        {/* Founder / Admin */}
        <Route path="/founder">{() => <FounderProtectedRoute component={FounderDashboard} />}</Route>
        <Route path="/admin/beta">{() => <FounderProtectedRoute component={BetaDashboardPage} />}</Route>
        <Route path="/admin/safety-gates">{() => <FounderProtectedRoute component={SafetyGatesPage} />}</Route>
        <Route path="/admin/decisions">{() => <FounderProtectedRoute component={DecisionQueuePage} />}</Route>
        <Route path="/admin/ops">{() => <FounderProtectedRoute component={OpsDashboardPage} />}</Route>
        <Route path="/admin/beta-intake">{() => <FounderProtectedRoute component={BetaIntakePage} />}</Route>
        <Route path="/admin/queues">{() => <FounderProtectedRoute component={QueueMonitorPage} />}</Route>
        <Route path="/admin/integrations-health">{() => <FounderProtectedRoute component={IntegrationsHealthPage} />}</Route>
        <Route path="/admin/monitor">{() => <ProtectedRoute component={ProactiveMonitorPage} />}</Route>
        <Route path="/reseller">{() => <FounderProtectedRoute component={ResellerDashboardPage} />}</Route>
        <Route path="/data-moat">{() => <FounderProtectedRoute component={DataMoatDashboardPage} />}</Route>

        <Route component={NotFound} />
      </Switch>
    </Suspense>
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
  useSwipeNavigation();
  useWhiteLabel();

  React.useEffect(() => {
    if (user) {
      telemetry.sessionStart();
    }
  }, [user]);

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
      {user && <BetaFeedbackWidget />}
      {user && <BetaActivationDetector />}
      <PWAInstallPrompt />
    </>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <SidebarProvider>
          <QueryClientProvider client={queryClient}>
            <TooltipProvider>
              <HintsProvider>
                <KeyboardShortcutsProvider>
                  <OfflineIndicator />
                  <Toaster />
                  <AppContent />
                  <KeyboardShortcutsModal />
                </KeyboardShortcutsProvider>
              </HintsProvider>
            </TooltipProvider>
          </QueryClientProvider>
        </SidebarProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
