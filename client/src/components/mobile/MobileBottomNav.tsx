import { useLocation, Link } from "wouter";
import { cn } from "@/lib/utils";
import { MoreHorizontal, Plus } from "lucide-react";
import { motion } from "framer-motion";
import { useIsMobile } from "@/hooks/use-mobile";
import { useEffect, useState } from "react";
import { prefetchDoorChunksOnIdle } from "@/lib/door-prefetch";
import { MobileCommandDrawer } from "./MobileCommandDrawer";
import { QuickAddSheet } from "./QuickAddSheet";
import { useAuth } from "@/hooks/use-auth";
import { NAV_ITEM_MAP, MOBILE_DOORS, type MasterNavItem } from "@/lib/nav-items";
import { usePaxNeedsYouCount } from "@/hooks/usePaxNeedsYou";
import { NAV_INDICATOR_LAYOUT_IDS, navIndicatorSpring } from "@/lib/animations";

export function MobileBottomNav() {
  const [location] = useLocation();
  const { isMobile, isKeyboardOpen } = useIsMobile();
  const { user } = useAuth();
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false);
  // The Pax door badge — asks "Waiting for your tap", from the server's own
  // count (live on `pax.needs_you`, 5-min poll fallback). `null` until the
  // server answers, so the door never shows an invented 0.
  const { count: paxAskCount } = usePaxNeedsYouCount();

  // The five canonical doors — the SAME for every persona (persona changes the
  // content behind them, not the doors). Inbox/Settings/long-tail live behind
  // the More drawer + top-bar Search. See MOBILE_DOORS in lib/nav-items.
  const navItems: MasterNavItem[] = MOBILE_DOORS
    .map((id) => NAV_ITEM_MAP.get(id))
    .filter((item): item is MasterNavItem => item != null);

  // Perceived speed (Tier 3C): once the bar is up for a signed-in user,
  // warm the five door chunks during idle time so the next door tap paints
  // immediately instead of hitting the route-level fallback.
  useEffect(() => {
    if (isMobile && user) prefetchDoorChunksOnIdle();
  }, [isMobile, user]);

  if (!isMobile || isKeyboardOpen) {
    return null;
  }

  // Surfaces whose primary action lives in the page chrome — on these the
  // FAB stacks OVER the working area (Pax's composer + settings gear,
  // inbox message actions). Mirrors the FloatingActionButton suppression
  // list in App.tsx ("the global FAB overlaps the chat input on mobile");
  // this newer FAB repeated that mistake — E2E run 27334034694 caught it
  // intercepting the tap on Pax's settings gear on iphone-se. Exact-or-
  // subpath match so /ai-* siblings (e.g. /ai-observatory) keep the FAB.
  const FAB_SUPPRESSED_PREFIXES = ["/ai", "/inbox", "/founder"];
  const fabSuppressed = FAB_SUPPRESSED_PREFIXES.some(
    (p) => location === p || location.startsWith(p + "/"),
  );

  return (
    <>
      {/* Quick-add FAB — thumb-reachable capture (lead / payment / ticket /
          note) tailored to the user's persona. Floats above the fixed
          five-door bar so it never becomes a sixth door. Hidden while the
          More drawer is open to avoid stacking over its overlay. */}
      {!isDrawerOpen && !fabSuppressed && (
        <button
          type="button"
          aria-label="Quick add"
          aria-haspopup="dialog"
          aria-expanded={isQuickAddOpen}
          onClick={() => setIsQuickAddOpen(true)}
          className="fixed right-4 z-floating flex items-center justify-center w-12 h-12 rounded-full bg-primary text-primary-foreground shadow-level-3 transition-transform active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          style={{ bottom: "calc(72px + env(safe-area-inset-bottom, 0px) + 16px)" }}
          data-testid="mobile-quick-add-fab"
        >
          <Plus className="w-6 h-6" aria-hidden="true" />
        </button>
      )}

      <nav
        aria-label="Mobile navigation"
        className="fixed bottom-0 left-0 right-0 z-floating bg-surface-chrome backdrop-blur-lg border-t border-border"
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
                  {item.id === "ai-hub" && paxAskCount != null && paxAskCount > 0 && (
                    <span
                      className="absolute -top-0.5 right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold leading-[18px] text-center tabular-nums"
                      aria-label={`${paxAskCount} waiting for your tap`}
                      data-testid="badge-pax-needs-you-mobile"
                    >
                      {paxAskCount > 99 ? "99+" : paxAskCount}
                    </span>
                  )}
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

      <QuickAddSheet
        open={isQuickAddOpen}
        onOpenChange={setIsQuickAddOpen}
        persona={user?.persona}
      />

      <div className="h-[72px] md:hidden" style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }} />
    </>
  );
}
