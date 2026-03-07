import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { LogOut, Menu, Crown, SlidersHorizontal } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useState, useCallback } from "react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { prefetchRoute } from "@/lib/queryClient";
import { NotificationCenter } from "@/components/notification-center";
import { ThemeToggle } from "@/components/theme-toggle";
import { useNavPreferences } from "@/hooks/use-nav-preferences";
import { NAV_ITEM_MAP, type MasterNavItem } from "@/lib/nav-items";
import { NavCustomizer } from "@/components/nav-customizer";

const routePrefetchMap: Record<string, string> = {
  "/pipeline": "/api/deals",
  "/money": "/api/notes",
  "/leads": "/api/leads",
  "/properties": "/api/properties",
  "/deals": "/api/deals",
  "/finance": "/api/notes",
};

export function Sidebar() {
  const [location] = useLocation();
  const { logout, isFounder } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [customizerOpen, setCustomizerOpen] = useState(false);

  const {
    sidebarItems,
    mobileItems,
    setSidebarItems,
    setMobileItems,
    reset,
  } = useNavPreferences();

  const handlePrefetch = useCallback((href: string) => {
    const apiRoute = routePrefetchMap[href];
    if (apiRoute) prefetchRoute(apiRoute);
  }, []);

  const renderNavItem = (item: MasterNavItem, onNavClick?: () => void) => {
    const isActive =
      location === item.href ||
      (item.href !== "/today" && location.startsWith(item.href));
    const ItemIcon = item.icon;
    return (
      <Tooltip key={item.href} delayDuration={300}>
        <TooltipTrigger asChild>
          <Link
            href={item.href}
            onClick={onNavClick}
            className={cn(
              "flex items-center gap-3 px-4 py-3 md:py-2 rounded-lg transition-all duration-150 group min-h-[40px]",
              isActive
                ? "bg-primary text-primary-foreground shadow-md"
                : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground"
            )}
            onMouseEnter={() => handlePrefetch(item.href)}
            data-testid={`link-nav-${item.id}`}
          >
            <ItemIcon
              className={cn(
                "w-4 h-4 transition-colors shrink-0",
                isActive ? "text-primary-foreground" : "text-muted-foreground group-hover:text-sidebar-foreground"
              )}
            />
            <span className="font-medium text-sm flex-1 truncate">{item.label}</span>
          </Link>
        </TooltipTrigger>
        <TooltipContent side="right" className="max-w-xs">
          <p>{item.description}</p>
        </TooltipContent>
      </Tooltip>
    );
  };

  const resolvedSidebarItems = sidebarItems
    .map((id) => NAV_ITEM_MAP.get(id))
    .filter((item): item is MasterNavItem => item != null);

  const NavContent = ({ onNavClick }: { onNavClick?: () => void }) => (
    <div className="flex flex-col h-full vibrancy-sidebar">
      {/* Header */}
      <div className="p-4 md:p-6 border-b border-sidebar-border">
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
          <NotificationCenter />
        </div>
        <p className="text-xs text-muted-foreground mt-1">Land Investment Platform</p>
      </div>

      {/* Nav items */}
      <nav className="flex-1 px-3 py-3 space-y-0.5 overflow-y-auto">
        {isFounder && (
          <Link
            href="/founder"
            onClick={onNavClick}
            className={cn(
              "flex items-center gap-3 px-4 py-3 md:py-2 rounded-lg transition-all duration-150 group mb-2 min-h-[40px]",
              location === "/founder"
                ? "bg-amber-500 text-white shadow-md"
                : "bg-amber-500/10 text-amber-600 hover:bg-amber-500/20"
            )}
            data-testid="link-founder-dashboard"
          >
            <Crown className={cn(
              "w-4 h-4 transition-colors",
              location === "/founder" ? "text-white" : "text-amber-500"
            )} />
            <span className="font-medium text-sm">Founder Dashboard</span>
          </Link>
        )}
        {resolvedSidebarItems.map((item) => renderNavItem(item, onNavClick))}
      </nav>

      {/* Footer */}
      <div className="p-4 border-t border-sidebar-border safe-area-bottom space-y-2">
        <div className="flex items-center justify-between px-2">
          <span className="text-xs text-muted-foreground">Theme</span>
          <ThemeToggle />
        </div>
        <button
          onClick={() => {
            onNavClick?.();
            setCustomizerOpen(true);
          }}
          data-testid="button-customize-nav"
          className="flex items-center gap-3 px-4 py-2.5 w-full rounded-lg text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors min-h-[40px]"
        >
          <SlidersHorizontal className="w-4 h-4" />
          <span className="font-medium text-sm">Customize nav</span>
        </button>
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
            <Button variant="outline" size="icon" className="shadow-lg glass-panel min-h-[44px] min-w-[44px]" data-testid="button-mobile-menu">
              <Menu className="w-5 h-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="p-0 w-[85vw] max-w-[320px] border-r-sidebar-border">
            <NavContent onNavClick={() => setIsOpen(false)} />
          </SheetContent>
        </Sheet>
      </div>

      {/* Desktop Sidebar */}
      <aside className="hidden md:flex w-64 flex-col fixed inset-y-0 left-0 z-50 m-2 rounded-xl border border-sidebar-border shadow-xl overflow-hidden vibrancy-sidebar">
        <NavContent />
      </aside>

      {/* Nav Customizer Sheet */}
      <NavCustomizer
        open={customizerOpen}
        onOpenChange={setCustomizerOpen}
        sidebarItems={sidebarItems}
        mobileItems={mobileItems}
        onSidebarChange={setSidebarItems}
        onMobileChange={setMobileItems}
        onReset={reset}
      />
    </>
  );
}
