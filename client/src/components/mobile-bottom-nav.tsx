import { useLocation, Link } from "wouter";
import { cn } from "@/lib/utils";
import { Home, Users, Map, Briefcase, DollarSign, Settings } from "lucide-react";

const navItems = [
  { href: "/", icon: Home, label: "Home" },
  { href: "/leads", icon: Users, label: "Leads" },
  { href: "/properties", icon: Map, label: "Properties" },
  { href: "/deals", icon: Briefcase, label: "Deals" },
  { href: "/finance", icon: DollarSign, label: "Finance" },
  { href: "/settings", icon: Settings, label: "Settings" },
];

export function MobileBottomNav() {
  const [location] = useLocation();

  return (
    <nav 
      className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-background/95 backdrop-blur-lg border-t border-border"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      <div className="flex justify-around items-center h-[72px] px-1">
        {navItems.map((item) => {
          const isActive = location === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex flex-col items-center justify-center gap-1 min-w-[52px] min-h-[52px] rounded-xl transition-colors",
                isActive 
                  ? "text-primary bg-primary/10" 
                  : "text-muted-foreground"
              )}
              data-testid={`nav-${item.label.toLowerCase()}`}
            >
              <item.icon className={cn(
                "w-6 h-6",
                isActive && "text-primary"
              )} />
              <span className={cn(
                "text-[11px] font-medium truncate",
                isActive && "text-primary"
              )}>
                {item.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
