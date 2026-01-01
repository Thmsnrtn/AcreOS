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
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-background/95 backdrop-blur-lg border-t border-border safe-area-bottom">
      <div className="flex justify-around items-center h-16 px-2">
        {navItems.map((item) => {
          const isActive = location === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex flex-col items-center justify-center gap-1 py-2 px-3 min-w-0 transition-colors",
                isActive 
                  ? "text-primary" 
                  : "text-muted-foreground"
              )}
              data-testid={`nav-${item.label.toLowerCase()}`}
            >
              <item.icon className={cn(
                "w-5 h-5",
                isActive && "text-primary"
              )} />
              <span className={cn(
                "text-[10px] font-medium truncate",
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
