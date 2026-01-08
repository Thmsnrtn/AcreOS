import { Switch, Route, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/use-auth";
import { Loader2 } from "lucide-react";
import { ThemeProvider } from "@/contexts/theme-context";

import { LowBalanceAlert } from "@/components/low-balance-alert";
import { HintsProvider } from "@/components/feature-hints";
import { KeyboardShortcutsProvider } from "@/hooks/use-keyboard-shortcuts";
import { KeyboardShortcutsDialog } from "@/components/keyboard-shortcuts-dialog";
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
import AutomationPage from "@/pages/automation";
import ActivityPage from "@/pages/activity";
import CountiesPage from "@/pages/counties";
import OffersPage from "@/pages/offers";
import ListingsPage from "@/pages/listings";
import DocumentsPage from "@/pages/documents";
import AnalyticsPage from "@/pages/analytics";
import EmailSettingsPage from "@/pages/email-settings";
import MailSettingsPage from "@/pages/mail-settings";
import InboxPage from "@/pages/inbox";
import AuthPage from "@/pages/auth-page";
import BorrowerPortal from "@/pages/borrower-portal";
import TermsOfService from "@/pages/terms";
import PrivacyPolicy from "@/pages/privacy";
import NotFound from "@/pages/not-found";
import { PWAInstallPrompt } from "@/components/pwa-install-prompt";
import { MobileBottomNav } from "@/components/mobile-bottom-nav";
import { ConversationTray } from "@/components/conversation-tray";
import { ErrorBoundary } from "@/components/error-boundary";
import { OfflineIndicator } from "@/components/offline-indicator";
import { FloatingActionButton } from "@/components/floating-action-button";
import { useSwipeNavigation } from "@/hooks/use-swipe-gesture";

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

function Router() {
  return (
    <Switch>
      <Route path="/auth" component={AuthPage} />
      <Route path="/terms" component={TermsOfService} />
      <Route path="/privacy" component={PrivacyPolicy} />
      
      {/* Public Borrower Portal */}
      <Route path="/portal" component={BorrowerPortal} />
      <Route path="/portal/:accessToken" component={BorrowerPortal} />
      
      {/* Protected Routes */}
      <Route path="/">
        {() => <ProtectedRoute component={Dashboard} />}
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
      <Route path="/automation">
        {() => <ProtectedRoute component={AutomationPage} />}
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

      <Route component={NotFound} />
    </Switch>
  );
}

function AppContent() {
  const { user } = useAuth();
  useSwipeNavigation();
  
  return (
    <>
      {user && <LowBalanceAlert />}
      <Router />
      {user && <MobileBottomNav />}
      {user && <FloatingActionButton />}
      {user && <ConversationTray />}
      <PWAInstallPrompt />
    </>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <HintsProvider>
              <KeyboardShortcutsProvider>
                <OfflineIndicator />
                <Toaster />
                <AppContent />
                <KeyboardShortcutsDialog />
              </KeyboardShortcutsProvider>
            </HintsProvider>
          </TooltipProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
