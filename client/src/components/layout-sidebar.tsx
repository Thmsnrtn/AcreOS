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
  MessageSquare
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useState } from "react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";

const navItems = [
  { label: "Dashboard", icon: LayoutDashboard, href: "/" },
  { label: "Leads (CRM)", icon: Users, href: "/leads" },
  { label: "Inventory", icon: Map, href: "/properties" },
  { label: "Finance", icon: Banknote, href: "/finance" },
  { label: "AI Agents", icon: Bot, href: "/agents" },
  { label: "AI Command Center", icon: MessageSquare, href: "/command-center" },
  { label: "Settings", icon: Settings, href: "/settings" },
];

export function Sidebar() {
  const [location] = useLocation();
  const { logout } = useAuth();
  const [isOpen, setIsOpen] = useState(false);

  const NavContent = () => (
    <div className="flex flex-col h-full vibrancy-sidebar">
      <div className="p-6 border-b border-sidebar-border">
        <h1 className="text-2xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
          AcreOS
        </h1>
        <p className="text-xs text-muted-foreground mt-1">Land Investment Platform</p>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1">
        {navItems.map((item) => {
          const isActive = location === item.href;
          return (
            <Link key={item.href} href={item.href} className={cn(
              "flex items-center gap-3 px-4 py-2.5 rounded-lg transition-all duration-150 group",
              isActive 
                ? "bg-primary text-primary-foreground shadow-md" 
                : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground"
            )}>
              <item.icon className={cn(
                "w-5 h-5 transition-colors", 
                isActive ? "text-primary-foreground" : "text-muted-foreground group-hover:text-sidebar-foreground"
              )} />
              <span className="font-medium text-sm">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="p-4 border-t border-sidebar-border">
        <button 
          onClick={() => logout()}
          data-testid="button-logout"
          className="flex items-center gap-3 px-4 py-2.5 w-full rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
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
      <div className="md:hidden fixed top-4 left-4 z-50">
        <Sheet open={isOpen} onOpenChange={setIsOpen}>
          <SheetTrigger asChild>
            <Button variant="outline" size="icon" className="shadow-lg glass-panel" data-testid="button-mobile-menu">
              <Menu className="w-5 h-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="p-0 w-72 border-r-sidebar-border">
            <NavContent />
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
