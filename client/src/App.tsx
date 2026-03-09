import React from "react";
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
import TodayPage from "@/pages/today";
import PipelinePage from "@/pages/pipeline";
import MoneyPage from "@/pages/money";
import AtlasPage from "@/pages/atlas";
import Dashboard from "@/pages/dashboard";
import LeadsPage from "@/pages/leads";
import PropertiesPage from "@/pages/properties";
import FinancePage from "@/pages/finance";
import PortfolioPage from "@/pages/portfolio";
import CampaignsPage from "@/pages/campaigns";
import DealsPage from "@/pages/deals";
import ToolsPage from "@/pages/tools";
import CommandCenterPage from "@/pages/command-center";
import SupportPage from "@/pages/support";
import SettingsPage from "@/pages/settings";
import HelpPage from "@/pages/help";
import AdminSupportPage from "@/pages/admin-support";
import FounderDashboard from "@/pages/founder-dashboard";
import SequencesPage from "@/pages/sequences";
import AbTestsPage from "@/pages/ab-tests";
import TasksPage from "@/pages/tasks";
import TeamDashboardPage from "@/pages/team-dashboard";
import TeamInboxPage from "@/pages/team-inbox";
import CommissionsPage from "@/pages/commissions";
import TeamLeaderboardPage from "@/pages/team-leaderboard";
import ForecastingPage from "@/pages/forecasting";
import AutomationPage from "@/pages/automation";
import WorkflowsPage from "@/pages/workflows";
import ActivityPage from "@/pages/activity";
import CountiesPage from "@/pages/counties";
import OffersPage from "@/pages/offers";
import ListingsPage from "@/pages/listings";
import DocumentsPage from "@/pages/documents";
import AnalyticsPage from "@/pages/analytics";
import EmailSettingsPage from "@/pages/email-settings";
import MailSettingsPage from "@/pages/mail-settings";
import InboxPage from "@/pages/inbox";
import MarketplacePage from "@/pages/marketplace";
import AcademyPage from "@/pages/academy";
import LandCreditPage from "@/pages/land-credit";
import AcquisitionRadarPage from "@/pages/acquisition-radar";
import PortfolioOptimizerPage from "@/pages/portfolio-optimizer";
import AVMPage from "@/pages/avm";
import MapsPage from "@/pages/maps";
import NegotiationCopilotPage from "@/pages/negotiation-copilot";
import CashFlowPage from "@/pages/cash-flow";
import DealHunterPage from "@/pages/deal-hunter";
import VisionAIPage from "@/pages/vision-ai";
import CapitalMarketsPage from "@/pages/capital-markets";
import MarketIntelligencePage from "@/pages/market-intelligence";
import CompliancePage from "@/pages/compliance";
import TaxResearcherPage from "@/pages/tax-researcher";
import DocumentIntelligencePage from "@/pages/document-intelligence";
import AuthPage from "@/pages/auth-page";
import BorrowerPortal from "@/pages/borrower-portal";
import TermsOfService from "@/pages/terms";
import PrivacyPolicy from "@/pages/privacy";
import LandingPage from "@/pages/landing";
import NotFound from "@/pages/not-found";
import SafetyGatesPage from "@/pages/safety-gates";
import DecisionQueuePage from "@/pages/decision-queue";
import OpsDashboardPage from "@/pages/ops-dashboard";
import BetaIntakePage from "@/pages/beta-intake";
import QueueMonitorPage from "@/pages/queue-monitor";
import IntegrationsHealthPage from "@/pages/integrations-health";
import AuditLogPage from "@/pages/audit-log";
import GoalsPage from "@/pages/goals";
import TaxOptimizerPage from "@/pages/tax-optimizer";
import WebhooksPage from "@/pages/webhooks";
import ProactiveMonitorPage from "@/pages/proactive-monitor";
import SyndicationPage from "@/pages/syndication";
import ModelTrainingPage from "@/pages/model-training";
import InvestorDirectoryPage from "@/pages/investor-directory";
import RegulatoryIntelPage from "@/pages/regulatory-intel";
import DataExportPage from "@/pages/data-export";
import MarketWatchlistPage from "@/pages/market-watchlist";
import PriceOptimizerPage from "@/pages/price-optimizer";
import PortfolioHealthPage from "@/pages/portfolio-health";
import SellerIntentPage from "@/pages/seller-intent";
import DealPatternsPage from "@/pages/deal-patterns";
import PortfolioPnLPage from "@/pages/portfolio-pnl";
import BuyerQualificationPage from "@/pages/buyer-qualification";
import PrivacySettingsPage from "@/pages/privacy-settings";
import SkipTracingPage from "@/pages/skip-tracing";
import TerritoryManagerPage from "@/pages/territory-manager";
import ZoningLookupPage from "@/pages/zoning-lookup";
import TitleSearchPage from "@/pages/title-search";
import UsageQuotaPage from "@/pages/usage-quota";
import OnboardingWizardPage from "@/pages/onboarding-wizard";
import DunningManagerPage from "@/pages/dunning-manager";
import Exchange1031Page from "@/pages/exchange-1031";
import PropertyEnrichmentPage from "@/pages/property-enrichment";
import DirectMailCampaignsPage from "@/pages/direct-mail-campaigns";
import TaxDelinquentPage from "@/pages/tax-delinquent";
import MatchingEnginePage from "@/pages/matching-engine";
import DocumentVersionsPage from "@/pages/document-versions";
import KPIDashboardPage from "@/pages/kpi-dashboard";
import DepreciationCalculatorPage from "@/pages/depreciation-calculator";
import ListingSyndicationPage from "@/pages/listing-syndication";
import DripSequencesPage from "@/pages/drip-sequences";
import CohortAnalysisPage from "@/pages/cohort-analysis";
import PropertyTaxPage from "@/pages/property-tax";
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

// Protected Route Wrapper
function ProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return <Redirect to="/auth" />;
  }

  return <Component />;
}

// Founder-only Route Wrapper (shows 404 for non-founders)
function FounderProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  const { user, isLoading, isFounder } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return <Redirect to="/auth" />;
  }

  // Non-founders see 404 (route doesn't exist for them)
  if (!isFounder) {
    return <NotFound />;
  }

  return <Component />;
}

// Landing/Dashboard split: unauth sees landing, auth sees today
function HomeRoute() {
  const { user, isLoading } = useAuth();
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }
  return user ? <Redirect to="/today" /> : <LandingPage />;
}

function Router() {
  return (
    <Switch>
      <Route path="/auth" component={AuthPage} />
      <Route path="/terms" component={TermsOfService} />
      <Route path="/privacy" component={PrivacyPolicy} />
      
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
      <Route path="/atlas">
        {() => <ProtectedRoute component={AtlasPage} />}
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
      <Route path="/commissions">
        {() => <ProtectedRoute component={CommissionsPage} />}
      </Route>
      <Route path="/team-leaderboard">
        {() => <ProtectedRoute component={TeamLeaderboardPage} />}
      </Route>
      <Route path="/forecasting">
        {() => <ProtectedRoute component={ForecastingPage} />}
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
      <Route path="/marketplace">
        {() => <ProtectedRoute component={MarketplacePage} />}
      </Route>
      <Route path="/academy">
        {() => <ProtectedRoute component={AcademyPage} />}
      </Route>
      <Route path="/land-credit">
        {() => <ProtectedRoute component={LandCreditPage} />}
      </Route>
      <Route path="/radar">
        {() => <ProtectedRoute component={AcquisitionRadarPage} />}
      </Route>
      <Route path="/portfolio-optimizer">
        {() => <ProtectedRoute component={PortfolioOptimizerPage} />}
      </Route>
      <Route path="/avm">
        {() => <ProtectedRoute component={AVMPage} />}
      </Route>
      <Route path="/maps">
        {() => <ProtectedRoute component={MapsPage} />}
      </Route>
      <Route path="/negotiation">
        {() => <ProtectedRoute component={NegotiationCopilotPage} />}
      </Route>
      <Route path="/cash-flow">
        {() => <ProtectedRoute component={CashFlowPage} />}
      </Route>
      <Route path="/deal-hunter">
        {() => <ProtectedRoute component={DealHunterPage} />}
      </Route>
      <Route path="/vision-ai">
        {() => <ProtectedRoute component={VisionAIPage} />}
      </Route>
      <Route path="/capital-markets">
        {() => <ProtectedRoute component={CapitalMarketsPage} />}
      </Route>
      <Route path="/market-intelligence">
        {() => <ProtectedRoute component={MarketIntelligencePage} />}
      </Route>
      <Route path="/compliance">
        {() => <ProtectedRoute component={CompliancePage} />}
      </Route>
      <Route path="/tax-researcher">
        {() => <ProtectedRoute component={TaxResearcherPage} />}
      </Route>
      <Route path="/document-intelligence">
        {() => <ProtectedRoute component={DocumentIntelligencePage} />}
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
      <Route path="/admin/queues">
        {() => <FounderProtectedRoute component={QueueMonitorPage} />}
      </Route>
      <Route path="/admin/integrations-health">
        {() => <FounderProtectedRoute component={IntegrationsHealthPage} />}
      </Route>
      <Route path="/audit-log">
        {() => <ProtectedRoute component={AuditLogPage} />}
      </Route>

      {/* T76-T90 New Feature Pages */}
      <Route path="/goals">
        {() => <ProtectedRoute component={GoalsPage} />}
      </Route>
      <Route path="/tax-optimizer">
        {() => <ProtectedRoute component={TaxOptimizerPage} />}
      </Route>
      <Route path="/webhooks">
        {() => <ProtectedRoute component={WebhooksPage} />}
      </Route>
      <Route path="/admin/monitor">
        {() => <ProtectedRoute component={ProactiveMonitorPage} />}
      </Route>
      <Route path="/syndication">
        {() => <ProtectedRoute component={SyndicationPage} />}
      </Route>
      <Route path="/model-training">
        {() => <ProtectedRoute component={ModelTrainingPage} />}
      </Route>
      <Route path="/investor-network">
        {() => <ProtectedRoute component={InvestorDirectoryPage} />}
      </Route>

      {/* Wave 4-6: Beta, Regulatory Intel, Analytics Enhancements */}
      <Route path="/regulatory-intel">
        {() => <ProtectedRoute component={RegulatoryIntelPage} />}
      </Route>
      <Route path="/data-export">
        {() => <ProtectedRoute component={DataExportPage} />}
      </Route>
      <Route path="/market-watchlist">
        {() => <ProtectedRoute component={MarketWatchlistPage} />}
      </Route>

      {/* Wave 9: New service UI pages */}
      <Route path="/price-optimizer">
        {() => <ProtectedRoute component={PriceOptimizerPage} />}
      </Route>
      <Route path="/portfolio-health">
        {() => <ProtectedRoute component={PortfolioHealthPage} />}
      </Route>
      <Route path="/seller-intent">
        {() => <ProtectedRoute component={SellerIntentPage} />}
      </Route>
      <Route path="/deal-patterns">
        {() => <ProtectedRoute component={DealPatternsPage} />}
      </Route>
      <Route path="/portfolio-pnl">
        {() => <ProtectedRoute component={PortfolioPnLPage} />}
      </Route>
      <Route path="/buyer-qualification">
        {() => <ProtectedRoute component={BuyerQualificationPage} />}
      </Route>
      <Route path="/settings/privacy">
        {() => <ProtectedRoute component={PrivacySettingsPage} />}
      </Route>
      <Route path="/skip-tracing">
        {() => <ProtectedRoute component={SkipTracingPage} />}
      </Route>
      <Route path="/territories">
        {() => <ProtectedRoute component={TerritoryManagerPage} />}
      </Route>
      <Route path="/zoning">
        {() => <ProtectedRoute component={ZoningLookupPage} />}
      </Route>
      <Route path="/title-search">
        {() => <ProtectedRoute component={TitleSearchPage} />}
      </Route>
      <Route path="/usage">
        {() => <ProtectedRoute component={UsageQuotaPage} />}
      </Route>
      <Route path="/onboarding">
        {() => <OnboardingWizardPage />}
      </Route>
      <Route path="/dunning">
        {() => <ProtectedRoute component={DunningManagerPage} />}
      </Route>
      <Route path="/exchange-1031">
        {() => <ProtectedRoute component={Exchange1031Page} />}
      </Route>
      <Route path="/property-enrichment">
        {() => <ProtectedRoute component={PropertyEnrichmentPage} />}
      </Route>
      <Route path="/direct-mail">
        {() => <ProtectedRoute component={DirectMailCampaignsPage} />}
      </Route>
      <Route path="/tax-delinquent">
        {() => <ProtectedRoute component={TaxDelinquentPage} />}
      </Route>
      <Route path="/matching">
        {() => <ProtectedRoute component={MatchingEnginePage} />}
      </Route>
      <Route path="/documents/versions">
        {() => <ProtectedRoute component={DocumentVersionsPage} />}
      </Route>
      <Route path="/kpis">
        {() => <ProtectedRoute component={KPIDashboardPage} />}
      </Route>
      <Route path="/depreciation">
        {() => <ProtectedRoute component={DepreciationCalculatorPage} />}
      </Route>
      <Route path="/syndication-status">
        {() => <ProtectedRoute component={ListingSyndicationPage} />}
      </Route>
      <Route path="/drip-sequences">
        {() => <ProtectedRoute component={DripSequencesPage} />}
      </Route>
      <Route path="/cohort-analysis">
        {() => <ProtectedRoute component={CohortAnalysisPage} />}
      </Route>
      <Route path="/property-tax">
        {() => <ProtectedRoute component={PropertyTaxPage} />}
      </Route>

      <Route component={NotFound} />
    </Switch>
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
  // Apply white-label CSS variables / branding (T67) — runs only when config is present
  useWhiteLabel();

  // Fire session_start telemetry on app mount (once per page load)
  React.useEffect(() => {
    if (user) {
      telemetry.sessionStart();
    }
  }, [user]);
  
  return (
    <>
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
