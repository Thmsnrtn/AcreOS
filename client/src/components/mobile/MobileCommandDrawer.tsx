import { useLocation, Link } from "wouter";
import { cn } from "@/lib/utils";
import { 
  Settings, 
  Bot, 
  DollarSign, 
  Mail, 
  HelpCircle,
  Search,
  Banknote,
  TrendingUp,
  FileText,
  ListTodo,
  Store,
  Workflow,
  Zap,
  Inbox,
  PieChart
} from "lucide-react";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";

interface MobileCommandDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const quickActions = [
  { href: "/settings", icon: Settings, label: "Settings", color: "text-muted-foreground" },
  { href: "/ai", icon: Bot, label: "AI Hub", color: "text-acr-brand" },
  { href: "/finance", icon: Banknote, label: "Finance", color: "text-acr-pos" },
  { href: "/campaigns", icon: Mail, label: "Marketing", color: "text-acr-accent" },
  { href: "/help", icon: HelpCircle, label: "Help", color: "text-acr-warn" },
];

const moreItems = [
  { href: "/inbox", icon: Inbox, label: "Inbox" },
  { href: "/tasks", icon: ListTodo, label: "Tasks" },
  { href: "/analytics", icon: TrendingUp, label: "Insights" },
  { href: "/portfolio", icon: PieChart, label: "Portfolio" },
  { href: "/listings", icon: Store, label: "Listings" },
  { href: "/documents", icon: FileText, label: "Documents" },
  { href: "/automation", icon: Zap, label: "Automation" },
  { href: "/workflows", icon: Workflow, label: "Workflows" },
];

export function MobileCommandDrawer({ open, onOpenChange }: MobileCommandDrawerProps) {
  const [location] = useLocation();
  const [searchQuery, setSearchQuery] = useState("");
  const { isFounder } = useAuth();

  const handleNavigate = () => {
    onOpenChange(false);
    setSearchQuery("");
  };

  const filteredQuickActions = quickActions.filter(item =>
    item.label.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const dynamicMoreItems = isFounder
    ? [{ href: "/founder", icon: PieChart, label: "Founder Dashboard" }, ...moreItems]
    : moreItems;

  const filteredMoreItems = dynamicMoreItems.filter(item =>
    item.label.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <Drawer open={open} onOpenChange={onOpenChange} handleOnly>
      <DrawerContent
        className="max-h-[85vh]"
        data-testid="mobile-command-drawer"
      >
        <DrawerHeader className="pb-2">
          <DrawerTitle className="sr-only">Quick actions</DrawerTitle>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
            <Input
              placeholder="Search actions…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 min-h-[44px]"
              data-testid="mobile-command-search"
            />
          </div>
        </DrawerHeader>

        <div 
          className="px-4 pb-4 overflow-y-auto"
          style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom, 0px))" }}
        >
          {filteredQuickActions.length > 0 && (
            <section aria-labelledby="quick-actions-heading" className="mb-4">
              <h3 id="quick-actions-heading" className="text-xs font-medium text-muted-foreground mb-2 px-1">Quick actions</h3>
              <ul aria-labelledby="quick-actions-heading" className="grid grid-cols-5 gap-2 list-none p-0 m-0">
                {filteredQuickActions.map((item) => {
                  const isActive = location === item.href;
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={handleNavigate}
                        aria-current={isActive ? "page" : undefined}
                        className={cn(
                          "flex flex-col items-center justify-center gap-1.5 p-3 rounded-xl transition-all active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          isActive
                            ? "bg-primary/10 text-primary"
                            : "active:bg-muted/50"
                        )}
                        data-testid={`mobile-drawer-${item.label.toLowerCase().replace(/\s/g, '-')}`}
                      >
                        <div aria-hidden="true" className={cn(
                          "flex items-center justify-center w-12 h-12 rounded-full bg-muted/50",
                          isActive && "bg-primary/15"
                        )}>
                          <item.icon className={cn(
                            "w-6 h-6",
                            isActive ? "text-primary" : item.color
                          )} />
                        </div>
                        <span className="text-[10px] font-medium text-center leading-tight">
                          {item.label}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {filteredMoreItems.length > 0 && (
            <section aria-labelledby="more-heading">
              <h3 id="more-heading" className="text-xs font-medium text-muted-foreground mb-2 px-1">More</h3>
              <ul aria-labelledby="more-heading" className="space-y-1 list-none p-0 m-0">
                {filteredMoreItems.map((item) => {
                  const isActive = location === item.href;
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={handleNavigate}
                        aria-current={isActive ? "page" : undefined}
                        className={cn(
                          "flex items-center gap-3 px-4 py-3 rounded-xl transition-all active:scale-[0.98] min-h-[48px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          isActive
                            ? "bg-primary/10 text-primary"
                            : "active:bg-muted/50"
                        )}
                        data-testid={`mobile-drawer-${item.label.toLowerCase()}`}
                      >
                        <item.icon className={cn(
                          "w-5 h-5",
                          isActive ? "text-primary" : "text-muted-foreground"
                        )} aria-hidden="true" />
                        <span className="font-medium text-sm">{item.label}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {filteredQuickActions.length === 0 && filteredMoreItems.length === 0 && (
            <p role="status" aria-live="polite" className="text-center py-8 text-muted-foreground">
              No actions found for "{searchQuery}"
            </p>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
