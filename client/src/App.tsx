import { Switch, Route, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/use-auth";
import { Loader2 } from "lucide-react";

import Dashboard from "@/pages/dashboard";
import LeadsPage from "@/pages/leads";
import PropertiesPage from "@/pages/properties";
import FinancePage from "@/pages/finance";
import CampaignsPage from "@/pages/campaigns";
import DealsPage from "@/pages/deals";
import AgentsPage from "@/pages/agents";
import CommandCenterPage from "@/pages/command-center";
import SettingsPage from "@/pages/settings";
import AuthPage from "@/pages/auth-page";
import BorrowerPortal from "@/pages/borrower-portal";
import NotFound from "@/pages/not-found";
import { PWAInstallPrompt } from "@/components/pwa-install-prompt";
import { MobileBottomNav } from "@/components/mobile-bottom-nav";
import { ErrorBoundary } from "@/components/error-boundary";
import { OfflineIndicator } from "@/components/offline-indicator";

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

function Router() {
  return (
    <Switch>
      <Route path="/auth" component={AuthPage} />
      
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
      <Route path="/finance">
        {() => <ProtectedRoute component={FinancePage} />}
      </Route>
      <Route path="/campaigns">
        {() => <ProtectedRoute component={CampaignsPage} />}
      </Route>
      <Route path="/agents">
        {() => <ProtectedRoute component={AgentsPage} />}
      </Route>
      <Route path="/command-center">
        {() => <ProtectedRoute component={CommandCenterPage} />}
      </Route>
      <Route path="/settings">
        {() => <ProtectedRoute component={SettingsPage} />}
      </Route>

      <Route component={NotFound} />
    </Switch>
  );
}

function AppContent() {
  const { user } = useAuth();
  
  return (
    <>
      <Router />
      {user && <MobileBottomNav />}
      <PWAInstallPrompt />
    </>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <OfflineIndicator />
          <Toaster />
          <AppContent />
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
