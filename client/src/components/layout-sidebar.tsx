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
  Menu
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
  { label: "AI Command", icon: Bot, href: "/agents" },
];

export function Sidebar() {
  const [location] = useLocation();
  const { logout } = useAuth();
  const [isOpen, setIsOpen] = useState(false);

  const NavContent = () => (
    <div className="flex flex-col h-full bg-slate-900 text-slate-50">
      <div className="p-6">
        <h1 className="text-2xl font-bold bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">
          AcreOS
        </h1>
        <p className="text-xs text-slate-400 mt-1">Automation Platform</p>
      </div>

      <nav className="flex-1 px-3 space-y-1">
        {navItems.map((item) => {
          const isActive = location === item.href;
          return (
            <Link key={item.href} href={item.href} className={cn(
              "flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 group",
              isActive 
                ? "bg-primary text-white shadow-lg shadow-primary/25" 
                : "text-slate-400 hover:text-white hover:bg-white/10"
            )}>
              <item.icon className={cn("w-5 h-5", isActive ? "text-white" : "text-slate-400 group-hover:text-white")} />
              <span className="font-medium">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="p-4 border-t border-slate-800">
        <button 
          onClick={() => logout()}
          className="flex items-center gap-3 px-4 py-3 w-full rounded-xl text-slate-400 hover:text-red-400 hover:bg-red-400/10 transition-colors"
        >
          <LogOut className="w-5 h-5" />
          <span className="font-medium">Sign Out</span>
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
            <Button variant="outline" size="icon" className="shadow-lg">
              <Menu className="w-5 h-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="p-0 border-r-slate-800 w-72">
            <NavContent />
          </SheetContent>
        </Sheet>
      </div>

      {/* Desktop Sidebar */}
      <aside className="hidden md:flex w-64 flex-col fixed inset-y-0 left-0 z-50 bg-slate-900 border-r border-slate-800 shadow-2xl">
        <NavContent />
      </aside>
    </>
  );
}
