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
  Workflow,
  Brain,
  Activity,
  Target,
  Shield,
  BarChart2,
  GraduationCap,
  Search,
  Eye,
  Globe,
  ShieldCheck,
  Gavel,
  DollarSign,
  FileSearch,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  MapPin,
  Package,
  CreditCard,
  Sparkles,
  X,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import {
  useState,
  useCallback,
  useEffect,
  createContext,
  useContext,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { prefetchRoute } from "@/lib/queryClient";
import { NotificationCenter } from "@/components/notification-center";
import { ThemeToggle } from "@/components/theme-toggle";
import { useFeatureFlags } from "@/hooks/use-feature-flags";

// ─────────────────────────────────────────────────────────────────────
// Sophie proactive notification badge
// Polls GET /api/sophie/observations?unread=true every 2 min.
// Shows a Sparkles icon with a red count bubble when Sophie has new
// observations for the org.  Clicking opens a popover with the
// latest insights and quick-dismiss actions.
// ─────────────────────────────────────────────────────────────────────
interface SophieObservation {
  id: number;
  type: string;
  severity: string;
  title: string;
  description: string;
  status: string;
  detectedAt: string;
  metadata?: Record<string, any>;
}

function SophieNotificationBadge() {
  const { data: unreadData } = useQuery<{ count: number }>({
    queryKey: ["/api/sophie/observations", "unread"],
    queryFn: async () => {
      const res = await fetch("/api/sophie/observations?unread=true", { credentials: "include" });
      if (!res.ok) return { count: 0 };
      return res.json();
    },
    refetchInterval: 2 * 60 * 1000,
    staleTime: 60 * 1000,
  });

  const { data: observationsData, refetch: refetchObservations } = useQuery<{ observations: SophieObservation[] }>({
    queryKey: ["/api/sophie/observations"],
    queryFn: async () => {
      const res = await fetch("/api/sophie/observations?limit=10", { credentials: "include" });
      if (!res.ok) return { observations: [] };
      return res.json();
    },
    enabled: false, // Only fetch when popover opens
    staleTime: 30 * 1000,
  });

  const unreadCount = unreadData?.count ?? 0;
  const observations = observationsData?.observations ?? [];

  const handleDismiss = async (id: number) => {
    try {
      await fetch(`/api/sophie/observations/${id}/dismiss`, {
        method: "POST",
        credentials: "include",
      });
      refetchObservations();
    } catch {}
  };

  const handleAcknowledge = async (id: number) => {
    try {
      await fetch(`/api/sophie/observations/${id}/acknowledge`, {
        method: "POST",
        credentials: "include",
      });
      refetchObservations();
    } catch {}
  };

  const severityColor: Record<string, string> = {
    high: "text-red-500",
    medium: "text-amber-500",
    low: "text-blue-500",
    info: "text-muted-foreground",
  };

  return (
    <Popover onOpenChange={(open) => { if (open) refetchObservations(); }}>
      <Tooltip delayDuration={0}>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              className="relative p-1.5 rounded-lg text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors"
              aria-label="Sophie AI insights"
              data-testid="button-sophie-notifications"
            >
              <Sparkles className="w-4 h-4" />
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[16px] h-4 px-0.5 rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground leading-none">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="right">
          <p className="font-medium">Sophie AI Insights</p>
          {unreadCount > 0 && (
            <p className="text-xs text-muted-foreground">{unreadCount} new observation{unreadCount === 1 ? "" : "s"}</p>
          )}
        </TooltipContent>
      </Tooltip>

      <PopoverContent side="right" align="start" className="w-80 p-0 ml-2 shadow-xl" sideOffset={4}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            <span className="font-semibold text-sm">Sophie Insights</span>
            {unreadCount > 0 && (
              <Badge variant="secondary" className="text-xs">{unreadCount} new</Badge>
            )}
          </div>
        </div>

        <div className="max-h-80 overflow-y-auto">
          {observations.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
              <Sparkles className="w-8 h-8 text-muted-foreground/40 mb-2" />
              <p className="text-sm text-muted-foreground">Sophie is watching for insights.</p>
              <p className="text-xs text-muted-foreground mt-1">You'll be notified when something needs attention.</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {observations.map((obs) => (
                <div key={obs.id} className="px-4 py-3 hover:bg-muted/30 transition-colors">
                  <div className="flex items-start gap-2">
                    <Sparkles className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${severityColor[obs.severity] || "text-muted-foreground"}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-foreground leading-snug">{obs.title}</p>
                      <p className="text-xs text-muted-foreground mt-0.5 leading-snug line-clamp-2">{obs.description}</p>
                      <p className="text-[10px] text-muted-foreground/60 mt-1">
                        {new Date(obs.detectedAt).toLocaleDateString()}
                      </p>
                    </div>
                    <button
                      onClick={() => handleDismiss(obs.id)}
                      className="shrink-0 p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                      aria-label="Dismiss"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                  {obs.status === "detected" && (
                    <button
                      onClick={() => handleAcknowledge(obs.id)}
                      className="mt-1.5 ml-5 text-[10px] text-primary hover:underline"
                    >
                      Mark as seen
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Sidebar collapse context — consumed by page-shell to adjust margin
// ─────────────────────────────────────────────────────────────────────
interface SidebarContextValue {
  isCollapsed: boolean;
  setIsCollapsed: (v: boolean) => void;
}

export const SidebarContext = createContext<SidebarContextValue>({
  isCollapsed: false,
  setIsCollapsed: () => {},
});

export function useSidebarCollapsed() {
  return useContext(SidebarContext);
}

// ─────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────
interface NavChild {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  href: string;
  description?: string;
  showUnreadBadge?: boolean;
}

interface NavModule {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  href: string;
  description?: string;
  showUnreadBadge?: boolean;
  children?: NavChild[];
}

// ─────────────────────────────────────────────────────────────────────
// Navigation structure — 9 core modules
// ─────────────────────────────────────────────────────────────────────
const NAV_MODULES: NavModule[] = [
  {
    id: "dashboard",
    label: "Dashboard",
    icon: LayoutDashboard,
    href: "/",
    description: "Overview of your land investment business",
  },
  {
    id: "inbox",
    label: "Inbox",
    icon: Inbox,
    href: "/inbox",
    description: "Messages and communications",
    showUnreadBadge: true,
  },
  {
    id: "leads",
    label: "Leads",
    icon: Users,
    href: "/leads",
    description: "Manage your land seller leads",
    children: [
      { label: "All Leads", icon: Users, href: "/leads", description: "All your leads" },
      { label: "Campaigns", icon: Mail, href: "/campaigns", description: "Email, SMS, and direct mail campaigns" },
      { label: "Sequences", icon: Zap, href: "/sequences", description: "Automated follow-up sequences" },
      { label: "A/B Tests", icon: BarChart2, href: "/ab-tests", description: "Campaign split tests" },
    ],
  },
  {
    id: "inventory",
    label: "Inventory",
    icon: Package,
    href: "/properties",
    description: "Properties you own or evaluate",
    children: [
      { label: "Properties", icon: Map, href: "/properties", description: "Track properties you own or evaluate" },
      { label: "Maps", icon: MapPin, href: "/maps", description: "Portfolio map view" },
      { label: "Documents", icon: FileText, href: "/documents", description: "Property documents" },
    ],
  },
  {
    id: "pipeline",
    label: "Pipeline",
    icon: GitBranch,
    href: "/deals",
    description: "Visualize your deal flow",
    children: [
      { label: "Deal Pipeline", icon: GitBranch, href: "/deals", description: "Visualize your deal flow" },
      { label: "Marketplace", icon: Store, href: "/marketplace", description: "Buy and sell deals" },
      { label: "Listings", icon: FileText, href: "/listings", description: "Properties for sale" },
    ],
  },
  {
    id: "tasks",
    label: "Tasks",
    icon: ListTodo,
    href: "/tasks",
    description: "Action items and workflows",
    children: [
      { label: "Tasks", icon: ListTodo, href: "/tasks", description: "Your action items" },
      { label: "Automation", icon: Zap, href: "/automation", description: "Automated workflows and rules" },
      { label: "Workflows", icon: Workflow, href: "/workflows", description: "Design and manage workflows" },
    ],
  },
  {
    id: "finance",
    label: "Finance",
    icon: Banknote,
    href: "/finance",
    description: "Seller financing and portfolio",
    children: [
      { label: "Finance", icon: Banknote, href: "/finance", description: "Seller-financed notes" },
      { label: "Cash Flow", icon: Activity, href: "/cash-flow", description: "12-month cash flow forecasting" },
      { label: "Capital Mkts", icon: DollarSign, href: "/capital-markets", description: "Note securitization and lenders" },
      { label: "Portfolio", icon: PieChart, href: "/portfolio", description: "Investment portfolio view" },
      { label: "Optimizer", icon: BarChart2, href: "/portfolio-optimizer", description: "Monte Carlo simulation" },
    ],
  },
  {
    id: "intelligence",
    label: "Intelligence",
    icon: Brain,
    href: "/analytics",
    description: "AI-powered insights and analysis",
    children: [
      { label: "Insights", icon: TrendingUp, href: "/analytics", description: "Analytics and market insights" },
      { label: "AVM™", icon: TrendingUp, href: "/avm", description: "AcreOS Valuation Model" },
      { label: "Markets", icon: Globe, href: "/market-intelligence", description: "Market analysis and price trends" },
      { label: "Acq. Radar", icon: Target, href: "/radar", description: "AI-scored deal opportunities" },
      { label: "Land Credit", icon: Shield, href: "/land-credit", description: "Proprietary 300–850 land scoring" },
      { label: "Deal Hunter", icon: Search, href: "/deal-hunter", description: "Automated deal sourcing" },
      { label: "Vision AI", icon: Eye, href: "/vision-ai", description: "AI photo and satellite analysis" },
      { label: "Negotiation", icon: Brain, href: "/negotiation", description: "AI negotiation copilot" },
      { label: "Tax Research", icon: Gavel, href: "/tax-researcher", description: "Tax lien auctions and delinquent properties" },
      { label: "Compliance", icon: ShieldCheck, href: "/compliance", description: "Regulatory monitoring" },
      { label: "Doc Intel", icon: FileSearch, href: "/document-intelligence", description: "AI contract parsing" },
      { label: "AI Assistant", icon: Bot, href: "/command-center", description: "AI assistants and automation" },
      { label: "Academy", icon: GraduationCap, href: "/academy", description: "Land investment education" },
    ],
  },
  {
    id: "settings",
    label: "Settings",
    icon: Settings,
    href: "/settings",
    description: "Account settings and preferences",
    children: [
      { label: "Settings", icon: Settings, href: "/settings", description: "Account and preferences" },
      { label: "Tools", icon: Calculator, href: "/tools", description: "Calculators and utilities" },
      { label: "Help & Support", icon: HelpCircle, href: "/help", description: "Help topics and support" },
    ],
  },
];

// Default expanded modules (open by default)
const DEFAULT_EXPANDED = new Set<string>(["leads", "inventory", "pipeline"]);

const COLLAPSED_STORAGE_KEY = "sidebar-collapsed";
const EXPANDED_STORAGE_KEY = "sidebar-expanded-modules";
const HIDDEN_MODULES_KEY = "sidebar-hidden-modules";

const routePrefetchMap: Record<string, string> = {
  "/leads": "/api/leads",
  "/properties": "/api/properties",
  "/deals": "/api/deals",
  "/finance": "/api/notes",
  "/campaigns": "/api/campaigns",
  "/inbox": "/api/inbox",
};

// ─────────────────────────────────────────────────────────────────────
// Provider — wrap app at root so page-shell can consume
// ─────────────────────────────────────────────────────────────────────
export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [isCollapsed, setIsCollapsedState] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSED_STORAGE_KEY) === "true";
    } catch {
      return false;
    }
  });

  const setIsCollapsed = useCallback((v: boolean) => {
    setIsCollapsedState(v);
    try {
      localStorage.setItem(COLLAPSED_STORAGE_KEY, String(v));
    } catch {}
  }, []);

  return (
    <SidebarContext.Provider value={{ isCollapsed, setIsCollapsed }}>
      {children}
    </SidebarContext.Provider>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Main Sidebar component
// ─────────────────────────────────────────────────────────────────────
export function Sidebar() {
  const [location] = useLocation();
  const { logout, isFounder } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const { isCollapsed, setIsCollapsed } = useSidebarCollapsed();
  const { isRouteEnabled, isLoading: flagsLoading } = useFeatureFlags();

  // Filter NAV_MODULES: hide any nav items whose route is feature-flagged off
  // While flags are loading we show everything (prevents flicker on initial load)
  const visibleModules = flagsLoading
    ? NAV_MODULES
    : NAV_MODULES.map((module) => ({
        ...module,
        children: module.children?.filter((child) => isRouteEnabled(child.href)),
      })).filter((module) => {
        // If the module itself has a controlled route, check it
        if (!isRouteEnabled(module.href)) return false;
        // If all children were filtered out and the module is purely a container, hide it
        if (module.children !== undefined && module.children.length === 0) return false;
        return true;
      });

  // Which modules are expanded (only relevant when not collapsed)
  const [expandedModules, setExpandedModules] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem(EXPANDED_STORAGE_KEY);
      if (stored) return new Set(JSON.parse(stored));
    } catch {}
    // Auto-expand the module that contains the current route
    const active = new Set(DEFAULT_EXPANDED);
    NAV_MODULES.forEach((m) => {
      if (
        m.children?.some((c) => location.startsWith(c.href) && c.href !== "/") ||
        location === m.href
      ) {
        active.add(m.id);
      }
    });
    return active;
  });

  // Persist expanded state
  useEffect(() => {
    try {
      localStorage.setItem(
        EXPANDED_STORAGE_KEY,
        JSON.stringify(Array.from(expandedModules))
      );
    } catch {}
  }, [expandedModules]);

  const { data: unreadCountData } = useQuery<{ count: number }>({
    queryKey: ["/api/inbox/unread-count"],
    refetchInterval: 60000,
  });
  const inboxUnreadCount = unreadCountData?.count ?? 0;

  const handlePrefetch = useCallback((href: string) => {
    const apiRoute = routePrefetchMap[href];
    if (apiRoute) prefetchRoute(apiRoute);
  }, []);

  const toggleModule = (id: string) => {
    setExpandedModules((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const isRouteActive = (href: string) => {
    if (href === "/") return location === "/";
    return location === href || location.startsWith(href + "/");
  };

  const isModuleActive = (module: NavModule) => {
    if (isRouteActive(module.href)) return true;
    return module.children?.some((c) => isRouteActive(c.href)) ?? false;
  };

  // ─── Desktop nav content ───────────────────────────────────────────
  const DesktopNavContent = () => (
    <div className="flex flex-col h-full vibrancy-sidebar">
      {/* Header */}
      <div
        className={cn(
          "border-b border-sidebar-border transition-all duration-200",
          isCollapsed ? "p-3" : "p-4 md:p-5"
        )}
      >
        {isCollapsed ? (
          <div className="flex justify-center">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-accent flex items-center justify-center">
              <span className="text-white font-bold text-xs">A</span>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
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
            <div className="flex items-center gap-1">
              <SophieNotificationBadge />
              <NotificationCenter />
            </div>
          </div>
        )}
        {!isCollapsed && (
          <p className="text-xs text-muted-foreground mt-1">
            Land Investment Platform
          </p>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto overflow-x-hidden">
        {/* Founder link */}
        {isFounder && (
          <DesktopNavItem
            href="/founder"
            icon={Crown}
            label="Founder Dashboard"
            isActive={location === "/founder"}
            isCollapsed={isCollapsed}
            accentClass={
              location === "/founder"
                ? "bg-amber-500 text-white shadow-md"
                : "bg-amber-500/10 text-amber-600 hover:bg-amber-500/20"
            }
            iconClass={
              location === "/founder" ? "text-white" : "text-amber-500"
            }
            testId="link-founder-dashboard"
            onMouseEnter={() => {}}
          />
        )}

        {/* Nav modules (filtered by feature flags) */}
        {visibleModules.map((module) => {
          const active = isModuleActive(module);
          const expanded = expandedModules.has(module.id);
          const hasChildren = (module.children?.length ?? 0) > 0;
          const showBadge =
            module.showUnreadBadge && inboxUnreadCount > 0;

          if (isCollapsed) {
            // Collapsed: icon-only with popover for children
            return (
              <CollapsedModuleItem
                key={module.id}
                module={module}
                isActive={active}
                inboxUnreadCount={inboxUnreadCount}
                isRouteActive={isRouteActive}
                onPrefetch={handlePrefetch}
              />
            );
          }

          return (
            <div key={module.id}>
              {/* Module row */}
              <div
                className={cn(
                  "flex items-center gap-2 px-3 py-2 rounded-lg transition-all duration-150 group cursor-pointer min-h-[40px]",
                  active && !hasChildren
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : active
                    ? "bg-primary/10 text-primary"
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                )}
                onClick={() => {
                  if (hasChildren) toggleModule(module.id);
                }}
                onMouseEnter={() => handlePrefetch(module.href)}
                data-testid={`module-${module.id}`}
              >
                {/* If no children, make the whole row a link */}
                {!hasChildren ? (
                  <Link
                    href={module.href}
                    className="flex items-center gap-2 flex-1 min-w-0"
                    data-testid={`link-nav-${module.href.replace("/", "") || "dashboard"}`}
                  >
                    <module.icon
                      className={cn(
                        "w-4 h-4 shrink-0 transition-colors",
                        active
                          ? "text-primary-foreground"
                          : "text-muted-foreground group-hover:text-sidebar-foreground"
                      )}
                    />
                    <span className="font-medium text-sm truncate flex-1">
                      {module.label}
                    </span>
                    {showBadge && (
                      <Badge
                        variant="secondary"
                        className="text-xs shrink-0"
                        data-testid="badge-inbox-unread"
                      >
                        {inboxUnreadCount > 99 ? "99+" : inboxUnreadCount}
                      </Badge>
                    )}
                  </Link>
                ) : (
                  <>
                    <module.icon
                      className={cn(
                        "w-4 h-4 shrink-0 transition-colors",
                        active
                          ? "text-primary"
                          : "text-muted-foreground group-hover:text-sidebar-foreground"
                      )}
                    />
                    <Link
                      href={module.href}
                      className="font-medium text-sm flex-1 truncate"
                      data-testid={`link-nav-${module.href.replace("/", "") || "dashboard"}`}
                      onClick={(e) => e.stopPropagation()}
                      onMouseEnter={() => handlePrefetch(module.href)}
                    >
                      {module.label}
                    </Link>
                    {showBadge && (
                      <Badge
                        variant="secondary"
                        className="text-xs shrink-0"
                        data-testid="badge-inbox-unread"
                      >
                        {inboxUnreadCount > 99 ? "99+" : inboxUnreadCount}
                      </Badge>
                    )}
                    {expanded ? (
                      <ChevronUp className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                    )}
                  </>
                )}
              </div>

              {/* Children */}
              {hasChildren && expanded && (
                <div className="ml-3 pl-3 border-l border-sidebar-border/60 mt-0.5 mb-1 space-y-0.5">
                  {module.children!.map((child) => {
                    const childActive = isRouteActive(child.href);
                    const childBadge =
                      child.showUnreadBadge && inboxUnreadCount > 0;
                    return (
                      <Link
                        key={child.href}
                        href={child.href}
                        className={cn(
                          "flex items-center gap-2 px-3 py-1.5 rounded-md transition-all duration-150 group min-h-[34px] text-xs",
                          childActive
                            ? "bg-primary text-primary-foreground shadow-sm"
                            : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                        )}
                        onMouseEnter={() => handlePrefetch(child.href)}
                        data-testid={`link-nav-${child.href.replace("/", "")}`}
                      >
                        <child.icon
                          className={cn(
                            "w-3.5 h-3.5 shrink-0",
                            childActive
                              ? "text-primary-foreground"
                              : "text-muted-foreground group-hover:text-sidebar-foreground"
                          )}
                        />
                        <span className="font-medium flex-1 truncate">
                          {child.label}
                        </span>
                        {childBadge && (
                          <Badge
                            variant="secondary"
                            className="text-xs shrink-0"
                          >
                            {inboxUnreadCount > 99 ? "99+" : inboxUnreadCount}
                          </Badge>
                        )}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* Footer */}
      <div
        className={cn(
          "border-t border-sidebar-border safe-area-bottom",
          isCollapsed ? "p-2 space-y-1" : "p-3 space-y-2"
        )}
      >
        {isCollapsed ? (
          <>
            <div className="flex justify-center py-1">
              <ThemeToggle />
            </div>
            <button
              onClick={() => logout()}
              data-testid="button-logout"
              className="flex items-center justify-center w-full p-2 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors min-h-[40px]"
            >
              <Tooltip delayDuration={0}>
                <TooltipTrigger asChild>
                  <LogOut className="w-4 h-4" />
                </TooltipTrigger>
                <TooltipContent side="right">Sign Out</TooltipContent>
              </Tooltip>
            </button>
            <button
              onClick={() => setIsCollapsed(false)}
              className="flex items-center justify-center w-full p-2 rounded-lg text-muted-foreground hover:bg-sidebar-accent transition-colors min-h-[40px]"
              aria-label="Expand sidebar"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </>
        ) : (
          <>
            <div className="flex items-center justify-between px-1">
              <span className="text-xs text-muted-foreground">Theme</span>
              <ThemeToggle />
            </div>
            <button
              onClick={() => logout()}
              data-testid="button-logout"
              className="flex items-center gap-2 px-3 py-2 w-full rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors min-h-[40px]"
            >
              <LogOut className="w-4 h-4" />
              <span className="font-medium text-sm">Sign Out</span>
            </button>
            <button
              onClick={() => setIsCollapsed(true)}
              className="flex items-center gap-2 px-3 py-2 w-full rounded-lg text-muted-foreground hover:bg-sidebar-accent transition-colors min-h-[40px]"
              aria-label="Collapse sidebar"
            >
              <ChevronLeft className="w-4 h-4" />
              <span className="text-xs text-muted-foreground">Collapse</span>
            </button>
          </>
        )}
      </div>
    </div>
  );

  // ─── Mobile nav content ────────────────────────────────────────────
  const MobileNavContent = ({ onNavClick }: { onNavClick?: () => void }) => (
    <div className="flex flex-col h-full vibrancy-sidebar">
      <div className="p-4 border-b border-sidebar-border">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
              AcreOS
            </h1>
            {isFounder && (
              <Badge
                variant="outline"
                className="bg-amber-500/10 text-amber-600 border-amber-500/30 text-xs"
              >
                <Crown className="w-3 h-3 mr-1" />
                Founder
              </Badge>
            )}
          </div>
          <NotificationCenter />
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Land Investment Platform
        </p>
      </div>

      <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
        {isFounder && (
          <Link
            href="/founder"
            onClick={onNavClick}
            className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-150 group mb-2 min-h-[44px]",
              location === "/founder"
                ? "bg-amber-500 text-white shadow-md"
                : "bg-amber-500/10 text-amber-600 hover:bg-amber-500/20"
            )}
            data-testid="link-founder-dashboard"
          >
            <Crown
              className={cn(
                "w-5 h-5",
                location === "/founder" ? "text-white" : "text-amber-500"
              )}
            />
            <span className="font-medium text-sm">Founder Dashboard</span>
          </Link>
        )}

        {visibleModules.map((module) => {
          const active = isModuleActive(module);
          const expanded = expandedModules.has(module.id);
          const hasChildren = (module.children?.length ?? 0) > 0;
          const showBadge = module.showUnreadBadge && inboxUnreadCount > 0;

          return (
            <div key={module.id}>
              <div
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-150 group cursor-pointer min-h-[44px]",
                  active && !hasChildren
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : active
                    ? "bg-primary/10 text-primary"
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                )}
                onClick={() => {
                  if (hasChildren) toggleModule(module.id);
                }}
              >
                {!hasChildren ? (
                  <Link
                    href={module.href}
                    onClick={onNavClick}
                    className="flex items-center gap-3 flex-1 min-w-0"
                    data-testid={`link-nav-${module.href.replace("/", "") || "dashboard"}`}
                  >
                    <module.icon
                      className={cn(
                        "w-5 h-5 shrink-0",
                        active ? "text-primary-foreground" : "text-muted-foreground"
                      )}
                    />
                    <span className="font-medium text-sm flex-1 truncate">
                      {module.label}
                    </span>
                    {showBadge && (
                      <Badge variant="secondary" className="text-xs shrink-0">
                        {inboxUnreadCount > 99 ? "99+" : inboxUnreadCount}
                      </Badge>
                    )}
                  </Link>
                ) : (
                  <>
                    <module.icon
                      className={cn(
                        "w-5 h-5 shrink-0",
                        active ? "text-primary" : "text-muted-foreground"
                      )}
                    />
                    <Link
                      href={module.href}
                      onClick={(e) => {
                        e.stopPropagation();
                        onNavClick?.();
                      }}
                      className="font-medium text-sm flex-1 truncate"
                      data-testid={`link-nav-${module.href.replace("/", "") || "dashboard"}`}
                    >
                      {module.label}
                    </Link>
                    {showBadge && (
                      <Badge variant="secondary" className="text-xs shrink-0">
                        {inboxUnreadCount > 99 ? "99+" : inboxUnreadCount}
                      </Badge>
                    )}
                    {expanded ? (
                      <ChevronUp className="w-4 h-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="w-4 h-4 shrink-0 text-muted-foreground" />
                    )}
                  </>
                )}
              </div>

              {hasChildren && expanded && (
                <div className="ml-4 pl-3 border-l border-sidebar-border/60 mt-0.5 mb-1 space-y-0.5">
                  {module.children!.map((child) => {
                    const childActive = isRouteActive(child.href);
                    return (
                      <Link
                        key={child.href}
                        href={child.href}
                        onClick={onNavClick}
                        className={cn(
                          "flex items-center gap-3 px-3 py-2 rounded-md transition-all duration-150 min-h-[40px]",
                          childActive
                            ? "bg-primary text-primary-foreground shadow-sm"
                            : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                        )}
                        data-testid={`link-nav-${child.href.replace("/", "")}`}
                      >
                        <child.icon
                          className={cn(
                            "w-4 h-4 shrink-0",
                            childActive
                              ? "text-primary-foreground"
                              : "text-muted-foreground"
                          )}
                        />
                        <span className="font-medium text-sm">{child.label}</span>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      <div className="p-4 border-t border-sidebar-border safe-area-bottom space-y-2">
        <div className="flex items-center justify-between px-1">
          <span className="text-xs text-muted-foreground">Theme</span>
          <ThemeToggle />
        </div>
        <button
          onClick={() => logout()}
          data-testid="button-logout"
          className="flex items-center gap-3 px-3 py-2.5 w-full rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors min-h-[44px]"
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
            <Button
              variant="outline"
              size="icon"
              className="shadow-lg glass-panel min-h-[44px] min-w-[44px]"
              data-testid="button-mobile-menu"
            >
              <Menu className="w-5 h-5" />
            </Button>
          </SheetTrigger>
          <SheetContent
            side="left"
            className="p-0 w-[85vw] max-w-[320px] border-r-sidebar-border"
          >
            <MobileNavContent onNavClick={() => setIsOpen(false)} />
          </SheetContent>
        </Sheet>
      </div>

      {/* Desktop Sidebar */}
      <aside
        className={cn(
          "hidden md:flex flex-col fixed inset-y-0 left-0 z-50 m-2 rounded-xl border border-sidebar-border shadow-xl overflow-hidden sidebar-vibrancy sidebar-spring",
          isCollapsed ? "w-[68px]" : "w-64"
        )}
      >
        <DesktopNavContent />
      </aside>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Collapsed icon-only module item with popover for children
// ─────────────────────────────────────────────────────────────────────
function CollapsedModuleItem({
  module,
  isActive,
  inboxUnreadCount,
  isRouteActive,
  onPrefetch,
}: {
  module: NavModule;
  isActive: boolean;
  inboxUnreadCount: number;
  isRouteActive: (href: string) => boolean;
  onPrefetch: (href: string) => void;
}) {
  const hasChildren = (module.children?.length ?? 0) > 0;
  const showBadge = module.showUnreadBadge && inboxUnreadCount > 0;

  if (!hasChildren) {
    return (
      <Tooltip delayDuration={0}>
        <TooltipTrigger asChild>
          <Link
            href={module.href}
            className={cn(
              "flex items-center justify-center w-full p-2.5 rounded-lg transition-all duration-150 min-h-[40px] relative",
              isActive
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground"
            )}
            onMouseEnter={() => onPrefetch(module.href)}
            data-testid={`link-nav-${module.href.replace("/", "") || "dashboard"}`}
          >
            <module.icon
              className={cn(
                "w-4 h-4 shrink-0",
                isActive ? "text-primary-foreground" : "text-muted-foreground"
              )}
            />
            {showBadge && (
              <span className="absolute top-1 right-1 w-2 h-2 bg-primary rounded-full" />
            )}
          </Link>
        </TooltipTrigger>
        <TooltipContent side="right">
          <p className="font-medium">{module.label}</p>
          {module.description && (
            <p className="text-xs text-muted-foreground">{module.description}</p>
          )}
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Popover>
      <Tooltip delayDuration={0}>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              className={cn(
                "flex items-center justify-center w-full p-2.5 rounded-lg transition-all duration-150 min-h-[40px] relative",
                isActive
                  ? "bg-primary/10 text-primary"
                  : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground"
              )}
              onMouseEnter={() => onPrefetch(module.href)}
              data-testid={`module-${module.id}`}
            >
              <module.icon
                className={cn(
                  "w-4 h-4 shrink-0",
                  isActive ? "text-primary" : "text-muted-foreground"
                )}
              />
              {showBadge && (
                <span className="absolute top-1 right-1 w-2 h-2 bg-primary rounded-full" />
              )}
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="right">
          <p className="font-medium">{module.label}</p>
        </TooltipContent>
      </Tooltip>
      <PopoverContent side="right" align="start" className="w-48 p-1.5 ml-1">
        <p className="text-xs font-semibold text-muted-foreground px-2 py-1 uppercase tracking-wide">
          {module.label}
        </p>
        {module.children!.map((child) => {
          const childActive = isRouteActive(child.href);
          return (
            <Link
              key={child.href}
              href={child.href}
              className={cn(
                "flex items-center gap-2 px-2 py-1.5 rounded-md transition-all duration-150 text-sm",
                childActive
                  ? "bg-primary text-primary-foreground"
                  : "text-foreground hover:bg-accent"
              )}
              onMouseEnter={() => onPrefetch(child.href)}
            >
              <child.icon className="w-3.5 h-3.5 shrink-0" />
              <span>{child.label}</span>
            </Link>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Simple desktop nav item helper (for founder link with custom accent)
// ─────────────────────────────────────────────────────────────────────
function DesktopNavItem({
  href,
  icon: Icon,
  label,
  isActive,
  isCollapsed,
  accentClass,
  iconClass,
  testId,
  onMouseEnter,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  isActive: boolean;
  isCollapsed: boolean;
  accentClass: string;
  iconClass: string;
  testId: string;
  onMouseEnter: () => void;
}) {
  if (isCollapsed) {
    return (
      <Tooltip delayDuration={0}>
        <TooltipTrigger asChild>
          <Link
            href={href}
            className={cn(
              "flex items-center justify-center w-full p-2.5 rounded-lg transition-all min-h-[40px]",
              accentClass
            )}
            onMouseEnter={onMouseEnter}
            data-testid={testId}
          >
            <Icon className={cn("w-4 h-4 shrink-0", iconClass)} />
          </Link>
        </TooltipTrigger>
        <TooltipContent side="right">
          <p>{label}</p>
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-2 px-3 py-2 rounded-lg transition-all mb-1 min-h-[40px]",
        accentClass
      )}
      onMouseEnter={onMouseEnter}
      data-testid={testId}
    >
      <Icon className={cn("w-4 h-4 shrink-0", iconClass)} />
      <span className="font-medium text-sm">{label}</span>
    </Link>
  );
}
