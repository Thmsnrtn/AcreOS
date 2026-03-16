import React from "react";
import { Switch, Route, Redirect, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/use-auth";
import { useFeatureFlags } from "@/hooks/use-feature-flags";
import { Loader2 } from "lucide-react";
import { telemetry } from "@/lib/telemetry";
import { ThemeProvider } from "@/contexts/theme-context";
import { PaxRailProvider } from "@/contexts/pax-rail-context";
import { AnimatePresence, motion } from "framer-motion";
import { pageTransition } from "@/lib/animations";

import { SidebarProvider } from "@/components/layout-sidebar";
import { HintsProvider } from "@/components/feature-hints";
import { KeyboardShortcutsProvider } from "@/hooks/use-keyboard-shortcuts";
import { KeyboardShortcutsModal } from "@/components/keyboard-shortcuts";
import { NewItemMenu } from "@/components/new-item-menu";
import { QuickActionsMenu } from "@/components/quick-actions-menu";
// ── Eagerly loaded (critical-path: auth + minimal shell) ─────────────────────
import AuthPage from "@/pages/auth-page";
import LandingPage from "@/pages/landing";
import NotFound from "@/pages/not-found";
import BorrowerPortal from "@/pages/borrower-portal";
import TermsOfService from "@/pages/terms";
import PrivacyPolicy from "@/pages/privacy";

// ── Lazy loaded (all app pages — route-level code splitting) ─────────────────
const TodayPage = React.lazy(() => import("@/pages/today"));
const PipelinePage = React.lazy(() => import("@/pages/pipeline"));
const MoneyPage = React.lazy(() => import("@/pages/money"));
const PaxPage = React.lazy(() => import("@/pages/pax"));
const LeadsPage = React.lazy(() => import("@/pages/leads"));
const PropertiesPage = React.lazy(() => import("@/pages/properties"));
const FinancePage = React.lazy(() => import("@/pages/finance"));
const PortfolioPage = React.lazy(() => import("@/pages/portfolio"));
const CampaignsPage = React.lazy(() => import("@/pages/campaigns"));
const DealsPage = React.lazy(() => import("@/pages/deals"));
const ToolsPage = React.lazy(() => import("@/pages/tools"));
const CommandCenterPage = React.lazy(() => import("@/pages/command-center"));
const SupportPage = React.lazy(() => import("@/pages/support"));
const SettingsPage = React.lazy(() => import("@/pages/settings"));
const HelpPage = React.lazy(() => import("@/pages/help"));
const AdminSupportPage = React.lazy(() => import("@/pages/admin-support"));
const FounderDashboard = React.lazy(() => import("@/pages/founder-dashboard"));
const FounderAiObservatory = React.lazy(() => import("@/pages/founder-ai-observatory"));
const SequencesPage = React.lazy(() => import("@/pages/sequences"));
const AbTestsPage = React.lazy(() => import("@/pages/ab-tests"));
const TasksPage = React.lazy(() => import("@/pages/tasks"));
const TeamDashboardPage = React.lazy(() => import("@/pages/team-dashboard"));
const TeamInboxPage = React.lazy(() => import("@/pages/team-inbox"));
const AutomationPage = React.lazy(() => import("@/pages/automation"));
const WorkflowsPage = React.lazy(() => import("@/pages/workflows"));
const ActivityPage = React.lazy(() => import("@/pages/activity"));
const CountiesPage = React.lazy(() => import("@/pages/counties"));
const OffersPage = React.lazy(() => import("@/pages/offers"));
const ListingsPage = React.lazy(() => import("@/pages/listings"));
const DocumentsPage = React.lazy(() => import("@/pages/documents"));
const AnalyticsPage = React.lazy(() => import("@/pages/analytics"));
const EmailSettingsPage = React.lazy(() => import("@/pages/email-settings"));
const MailSettingsPage = React.lazy(() => import("@/pages/mail-settings"));
const InboxPage = React.lazy(() => import("@/pages/inbox"));
const MarketplacePage = React.lazy(() => import("@/pages/marketplace"));
const AcademyPage = React.lazy(() => import("@/pages/academy"));
const LandCreditPage = React.lazy(() => import("@/pages/land-credit"));
const AcquisitionRadarPage = React.lazy(() => import("@/pages/acquisition-radar"));
const PortfolioOptimizerPage = React.lazy(() => import("@/pages/portfolio-optimizer"));
const AVMPage = React.lazy(() => import("@/pages/avm"));
const MapsPage = React.lazy(() => import("@/pages/maps"));
const NegotiationCopilotPage = React.lazy(() => import("@/pages/negotiation-copilot"));
const CashFlowPage = React.lazy(() => import("@/pages/cash-flow"));
const DealHunterPage = React.lazy(() => import("@/pages/deal-hunter"));
const VisionAIPage = React.lazy(() => import("@/pages/vision-ai"));
const CapitalMarketsPage = React.lazy(() => import("@/pages/capital-markets"));
const MarketIntelligencePage = React.lazy(() => import("@/pages/market-intelligence"));
const CompliancePage = React.lazy(() => import("@/pages/compliance"));
const TaxResearcherPage = React.lazy(() => import("@/pages/tax-researcher"));
const DocumentIntelligencePage = React.lazy(() => import("@/pages/document-intelligence"));
const SafetyGatesPage = React.lazy(() => import("@/pages/safety-gates"));
const DecisionQueuePage = React.lazy(() => import("@/pages/decision-queue"));
const OpsDashboardPage = React.lazy(() => import("@/pages/ops-dashboard"));
const BetaIntakePage = React.lazy(() => import("@/pages/beta-intake"));
const CompareLGPassPage = React.lazy(() => import("@/pages/compare-lgpass"));
const CompareGeekPayPage = React.lazy(() => import("@/pages/compare-geekpay"));
const DealUnderwritingPage = React.lazy(() => import("@/pages/deal-underwriting"));
const TeamKPIPage = React.lazy(() => import("@/pages/team-kpi"));
import { OnboardingWizard } from "@/components/onboarding-wizard";
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
import { PaxCopilotRail } from "@/components/pax-copilot-rail";

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
      <Route path="/compare/lg-pass" component={CompareLGPassPage} />
      <Route path="/compare/geekpay" component={CompareGeekPayPage} />

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
      <Route path="/academy">
        {() => <FlaggedRoute route="/academy" component={AcademyPage} />}
      </Route>
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
  useSwipeNavigation();

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
      {user && <OnboardingWizard />}
      {user && <BetaFeedbackWidget />}
      {user && <BetaActivationDetector />}
      {user && <PaxCopilotRail />}
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
          </PaxRailProvider>
        </SidebarProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
