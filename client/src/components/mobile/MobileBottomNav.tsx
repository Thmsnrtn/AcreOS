import { useLocation, Link } from "wouter";
import { cn } from "@/lib/utils";
import { MoreHorizontal } from "lucide-react";
import { motion } from "framer-motion";
import { useIsMobile } from "@/hooks/use-mobile";
import { useState } from "react";
import { MobileCommandDrawer } from "./MobileCommandDrawer";
import { NAV_ITEM_MAP, MOBILE_DOORS, type MasterNavItem } from "@/lib/nav-items";
import { NAV_INDICATOR_LAYOUT_IDS, navIndicatorSpring } from "@/lib/animations";

export function MobileBottomNav() {
  const [location] = useLocation();
  const { isMobile, isKeyboardOpen } = useIsMobile();
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  // The five canonical doors — the SAME for every persona (persona changes the
  // content behind them, not the doors). Inbox/Settings/long-tail live behind
  // the More drawer + top-bar Search. See MOBILE_DOORS in lib/nav-items.
  const navItems: MasterNavItem[] = MOBILE_DOORS
    .map((id) => NAV_ITEM_MAP.get(id))
    .filter((item): item is MasterNavItem => item != null);

  if (!isMobile || isKeyboardOpen) {
    return null;
  }

  return (
    <>
      <nav
        aria-label="Mobile navigation"
        className="fixed bottom-0 left-0 right-0 z-50 bg-background/95 backdrop-blur-lg border-t border-border"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
        data-testid="mobile-bottom-nav"
      >
        <div className="flex justify-around items-center h-[72px] px-1">
          {navItems.map((item) => {
            // Exact match OR true sub-path under the door's prefix. A bare
            // prefix-match lit Pax (`/ai`) up for every `/ai-*` sibling
            // (e.g. `/ai-observatory`, `/ai-ops`); requiring the trailing
            // slash means only `/ai` and `/ai/...` are "Pax".
            const isActive =
              location === item.href ||
              (item.href !== "/today" &&
                location.startsWith(item.href + "/"));
            const ItemIcon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "flex flex-col items-center justify-center gap-1 min-w-[48px] min-h-[48px] rounded-xl transition-all active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  isActive
                    ? "text-primary"
                    : "text-muted-foreground active:bg-muted/50"
                )}
                data-testid={`mobile-nav-item-${item.id}`}
              >
                <div className="relative flex items-center justify-center w-full h-8 rounded-full">
                  {isActive && (
                    <motion.div
                      layoutId={NAV_INDICATOR_LAYOUT_IDS.customerBottomNav}
                      className="absolute inset-0 rounded-full bg-primary/15"
                      transition={navIndicatorSpring}
                      aria-hidden="true"
                    />
                  )}
                  <ItemIcon className={cn("relative w-6 h-6", isActive && "text-primary")} aria-hidden="true" />
                </div>
                <span className={cn(
                  "text-caption font-medium truncate",
                  isActive && "text-primary"
                )}>
                  {item.label}
                </span>
              </Link>
            );
          })}

          <button
            type="button"
            aria-label="Open more actions"
            aria-expanded={isDrawerOpen}
            aria-haspopup="dialog"
            onClick={() => setIsDrawerOpen(true)}
            className={cn(
              "flex flex-col items-center justify-center gap-1 min-w-[48px] min-h-[48px] rounded-xl transition-all active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
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
              <MoreHorizontal className={cn("w-6 h-6", isDrawerOpen && "text-primary")} aria-hidden="true" />
            </div>
            <span className={cn(
              "text-caption font-medium truncate",
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
