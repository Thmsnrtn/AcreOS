import { useLocation, Link } from "wouter";
import { cn } from "@/lib/utils";
import { MoreHorizontal } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { useState } from "react";
import { MobileCommandDrawer } from "./MobileCommandDrawer";
import { useNavPreferences } from "@/hooks/use-nav-preferences";
import { NAV_ITEM_MAP, type MasterNavItem } from "@/lib/nav-items";

export function MobileBottomNav() {
  const [location] = useLocation();
  const { isMobile, isKeyboardOpen } = useIsMobile();
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const { mobileItems } = useNavPreferences();

  const navItems: MasterNavItem[] = mobileItems
    .slice(0, 4)
    .map((id) => NAV_ITEM_MAP.get(id))
    .filter((item): item is MasterNavItem => item != null);

  if (!isMobile || isKeyboardOpen) {
    return null;
  }

  return (
    <>
      <nav
        className="fixed bottom-0 left-0 right-0 z-50 bg-background/95 backdrop-blur-lg border-t border-border"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
        data-testid="mobile-bottom-nav"
      >
        <div className="flex justify-around items-center h-[72px] px-1">
          {navItems.map((item) => {
            const isActive =
              location === item.href ||
              (item.href !== "/today" && location.startsWith(item.href));
            const ItemIcon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex flex-col items-center justify-center gap-1 min-w-[56px] min-h-[48px] rounded-xl transition-all active:scale-95",
                  isActive
                    ? "text-primary"
                    : "text-muted-foreground active:bg-muted/50"
                )}
                data-testid={`mobile-nav-item-${item.id}`}
              >
                <div className={cn(
                  "flex items-center justify-center w-full h-8 rounded-full transition-colors",
                  isActive && "bg-primary/15"
                )}>
                  <ItemIcon className={cn("w-6 h-6", isActive && "text-primary")} />
                </div>
                <span className={cn(
                  "text-[11px] font-medium truncate",
                  isActive && "text-primary"
                )}>
                  {item.label}
                </span>
              </Link>
            );
          })}

          <button
            onClick={() => setIsDrawerOpen(true)}
            className={cn(
              "flex flex-col items-center justify-center gap-1 min-w-[56px] min-h-[48px] rounded-xl transition-all active:scale-95",
              isDrawerOpen
                ? "text-primary"
                : "text-muted-foreground active:bg-muted/50"
            )}
            data-testid="mobile-nav-item-more"
          >
            <div className={cn(
              "flex items-center justify-center w-full h-8 rounded-full transition-colors",
              isDrawerOpen && "bg-primary/15"
            )}>
              <MoreHorizontal className={cn("w-6 h-6", isDrawerOpen && "text-primary")} />
            </div>
            <span className={cn(
              "text-[11px] font-medium truncate",
              isDrawerOpen && "text-primary"
            )}>
              More
            </span>
          </button>
        </div>
      </nav>

      <MobileCommandDrawer
        open={isDrawerOpen}
        onOpenChange={setIsDrawerOpen}
      />

      <div className="h-[72px] md:hidden" style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }} />
    </>
  );
}
