import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { 
  LayoutDashboard, 
  Users, 
  Map, 
  Banknote, 
  Bot, 
  Settings,
  LogOut,
  Menu,
  Mail,
  Inbox,
  GitBranch,
  Calculator,
  Crown,
  HelpCircle,
  PieChart,
  ListTodo,
  Store,
  FileText,
  Zap,
  TrendingUp,
  Workflow
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { prefetchRoute } from "@/lib/queryClient";
import { NotificationCenter } from "@/components/notification-center";
import { ThemeToggle } from "@/components/theme-toggle";
import { DevBanner } from "@/components/dev-banner";
import { ProviderStatusBadges } from "@/components/provider-status";

const routePrefetchMap: Record<string, string> = {
  "/leads": "/api/leads",
  "/properties": "/api/properties",
  "/deals": "/api/deals",
  "/finance": "/api/notes",
  "/campaigns": "/api/campaigns",
  "/inbox": "/api/inbox",
};

const navItems = [
  { label: "Dashboard", icon: LayoutDashboard, href: "/", description: "Overview of your land investment business", section: "Overview" },
  { label: "Inbox", icon: Inbox, href: "/inbox", showUnreadBadge: true, description: "Messages and communications", section: "Work" },
  { label: "Leads (CRM)", icon: Users, href: "/leads", description: "Manage your land seller leads", section: "Work" },
  { label: "Inventory", icon: Map, href: "/properties", description: "Track properties you own or evaluate", section: "Work" },
  { label: "Deal Pipeline", icon: GitBranch, href: "/deals", description: "Visualize your deal flow", section: "Work" },
  { label: "Tasks", icon: ListTodo, href: "/tasks", description: "Your action items and to-do list", section: "Work" },
  { label: "Automation", icon: Zap, href: "/automation", description: "Set up automated workflows and rules", section: "Automation" },
  { label: "Workflows", icon: Workflow, href: "/workflows", description: "Design and manage complex workflows", section: "Automation" },
  { label: "AI", icon: Bot, href: "/command-center", description: "AI assistants and automation", section: "Automation" },
  { label: "Insights", icon: TrendingUp, href: "/analytics", description: "Analytics and market insights", section: "Insights" },
  { label: "Finance", icon: Banknote, href: "/finance", description: "Manage seller-financed notes", section: "Insights" },
  { label: "Portfolio", icon: PieChart, href: "/portfolio", description: "View your investment portfolio", section: "Insights" },
  { label: "Listings", icon: Store, href: "/listings", description: "Properties available for sale", section: "Sales" },
  { label: "Documents", icon: FileText, href: "/documents", description: "Store and manage documents", section: "Sales" },
  { label: "Marketing", icon: Mail, href: "/campaigns", description: "Email, SMS, and direct mail campaigns", section: "Sales" },
  { label: "Tools", icon: Calculator, href: "/tools", description: "Calculators and utility tools", section: "Operations" },
  { label: "Help & Support", icon: HelpCircle, href: "/help", description: "Help topics and support resources", section: "Operations" },
  { label: "Settings", icon: Settings, href: "/settings", description: "Configure your account and preferences", section: "Operations" },
] as const;

export function Sidebar() {
  const [location] = useLocation();
  const { logout, isFounder } = useAuth();
  const [isOpen, setIsOpen] = useState(false);

  const { data: unreadCountData } = useQuery<{ count: number }>({
    queryKey: ["/api/inbox/unread-count"],
    refetchInterval: 60000,
  });
  const inboxUnreadCount = unreadCountData?.count ?? 0;

  const handlePrefetch = useCallback((href: string) => {
    const apiRoute = routePrefetchMap[href];
    if (apiRoute) {
      prefetchRoute(apiRoute);
    }
  }, []);

  const NavContent = ({ onNavClick }: { onNavClick?: () => void }) => (
    <div className="flex flex-col h-full vibrancy-sidebar">
      <div className="p-0 md:p-0 border-b border-sidebar-border">
        <DevBanner />
        <div className="p-4 md:p-6">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h1 className="text-xl md:text-2xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
              AcreOS
            </h1>
            {isFounder && (
              <Badge 
                variant="outline" 
                className="bg-amber-500/10 text-amber-600 border-amber-500/30 text-xs"
                data-testid="badge-founder"
              >
                <Crown className="w-3 h-3 mr-1" />
                Founder
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            <ProviderStatusBadges />
            <NotificationCenter />
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-1">Land Investment Platform</p>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {isFounder && (
          <Link 
            href="/founder" 
            onClick={onNavClick}
            className={cn(
              "flex items-center gap-3 px-4 py-3 md:py-2.5 rounded-lg transition-all duration-150 group mb-2 min-h-[44px]",
              location === "/founder" 
                ? "bg-amber-500 text-white shadow-md" 
                : "bg-amber-500/10 text-amber-600 hover:bg-amber-500/20"
            )} 
            data-testid="link-founder-dashboard"
          >
            <Crown className={cn(
              "w-5 h-5 transition-colors", 
              location === "/founder" ? "text-white" : "text-amber-500"
            )} />
            <span className="font-medium text-sm">Founder Dashboard</span>
          </Link>
        )}
        {/* Grouped sections for clearer information architecture */}
        {Array.from(new Set(navItems.map((n) => (n as any).section))).map((section) => (
          <div key={section} className="space-y-1">
            <div className="px-4 pt-4 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground/70">
              {section}
            </div>
            {(navItems as any)
              .filter((n: any) => n.section === section)
              .map((item: any) => {
                const isActive = location === item.href;
                const showBadge = item.showUnreadBadge && inboxUnreadCount > 0;
                const itemDescription = item.description || item.label;
                return (
                  <Tooltip key={item.href} delayDuration={300}>
                    <TooltipTrigger asChild>
                      <Link 
                        href={item.href}
                        onClick={onNavClick}
                        className={cn(
                          "flex items-center gap-3 px-4 py-3 md:py-2.5 rounded-lg transition-all duration-150 group min-h-[44px]",
                          isActive 
                            ? "bg-primary text-primary-foreground shadow-md" 
                            : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                        )}
                        onMouseEnter={() => handlePrefetch(item.href)}
                        data-testid={`link-nav-${item.href.replace("/", "") || "dashboard"}`}
                      >
                        <item.icon className={cn(
                          "w-5 h-5 transition-colors", 
                          isActive ? "text-primary-foreground" : "text-muted-foreground group-hover:text-sidebar-foreground"
                        )} />
                        <span className="font-medium text-sm flex-1">{item.label}</span>
                        {showBadge && (
                          <Badge 
                            variant="secondary" 
                            className="text-xs"
                            data-testid="badge-inbox-unread"
                          >
                            {inboxUnreadCount > 99 ? "99+" : inboxUnreadCount}
                          </Badge>
                        )}
                      </Link>
                    </TooltipTrigger>
                    <TooltipContent side="right" className="max-w-xs">
                      <p>{itemDescription}</p>
                    </TooltipContent>
                  </Tooltip>
                );
              })}
          </div>
        ))}
      </nav>

      <div className="p-4 border-t border-sidebar-border safe-area-bottom space-y-2">
        <div className="flex items-center justify-between px-2">
          <span className="text-xs text-muted-foreground">Theme</span>
          <ThemeToggle />
        </div>
        <button 
          onClick={() => logout()}
          data-testid="button-logout"
          className="flex items-center gap-3 px-4 py-3 md:py-2.5 w-full rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors min-h-[44px]"
        >
          <LogOut className="w-5 h-5" />
          <span className="font-medium text-sm">Sign Out</span>
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile Trigger */}
      <div className="md:hidden fixed top-4 left-4 z-50 safe-area-top">
        <Sheet open={isOpen} onOpenChange={setIsOpen}>
          <SheetTrigger asChild>
<Button aria-label="Open navigation" variant="outline" size="icon" className="shadow-lg glass-panel min-h-[44px] min-w-[44px]" data-testid="button-mobile-menu">
              <Menu className="w-5 h-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="p-0 w-[85vw] max-w-[320px] border-r-sidebar-border">
            <NavContent onNavClick={() => setIsOpen(false)} />
          </SheetContent>
        </Sheet>
      </div>

      {/* Desktop Sidebar - macOS Tahoe style floating panel */}
      <aside className="hidden md:flex w-64 flex-col fixed inset-y-0 left-0 z-50 m-2 rounded-xl border border-sidebar-border shadow-xl overflow-hidden vibrancy-sidebar">
        <NavContent />
      </aside>
    </>
  );
}
