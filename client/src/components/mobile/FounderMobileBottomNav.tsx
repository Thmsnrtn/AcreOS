import { useRef, useState } from "react";
import { useLocation, Link } from "wouter";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { NAV_INDICATOR_LAYOUT_IDS, navIndicatorSpring } from "@/lib/animations";
import {
  Inbox,
  Compass,
  Sliders,
  Search,
  Megaphone,
  Newspaper,
  ListChecks,
  SlidersHorizontal,
  BookOpen,
  Sparkles,
} from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { PersonaSheet } from "@/components/persona-sheet";
import { useNewFounderUI } from "@/lib/featureFlags";
import { FOUNDER_DOORS, type FounderDoor } from "@/lib/founder-doors";

/**
 * FounderMobileBottomNav — the founder-side equivalent of MobileBottomNav.
 *
 * The customer MobileBottomNav is suppressed on /founder routes (its items
 * don't apply to founder mode), but until this component existed, founders
 * on mobile had NO navigation — they landed on /founder and saw a single
 * dashboard with no controls to get anywhere else. Reported by Thomas as
 * "felt like a single dashboard and no controls" mid-deep-test.
 *
 * The four canonical doors (FOUNDER_DOORS — Letter · Decisions · Controls ·
 * Story), driven DIRECTLY off that single source so the map the founder reads
 * (the doctrine) and the map he taps (this nav) can never diverge again. The
 * Solene chat FAB rides above the bar, so chat is reachable without a slot.
 *
 * Long-press (500ms) on ANY slot opens the PersonaSheet — the mobile
 * equivalent of the desktop header dropdown. Solves Tom's #1 nav pain
 * of being stuck inside /founder/* with no way out except Back.
 */

interface FounderNavItem {
  id: string;
  label: string;
  href: string;
  icon: typeof Inbox;
  /** match this path AND any subpath under it */
  matchPrefix?: string;
}

// Legacy nav — kept reachable via ?ui=old.
const FOUNDER_NAV_ITEMS_LEGACY: FounderNavItem[] = [
  { id: "now", label: "Now", href: "/founder", icon: Inbox },
  { id: "steering", label: "Steering", href: "/founder/steering", icon: Compass },
  { id: "studio", label: "Studio", href: "/founder/studio", icon: Sliders },
  { id: "inspector", label: "Inspector", href: "/founder/inspector/audit", icon: Search, matchPrefix: "/founder/inspector" },
  { id: "cmo", label: "CMO", href: "/founder/cmo", icon: Megaphone },
];

// The canonical four doors, derived from FOUNDER_DOORS so this nav is the
// doctrine, not a parallel copy of it. "The Letter" shortens to "Letter" for
// the slot; the Letter door (/founder) matches exactly (not as a prefix) so it
// isn't perpetually "active" on every /founder/* subpath.
const DOOR_ICON: Record<FounderDoor["id"], typeof Inbox> = {
  letter: Newspaper,
  decisions: ListChecks,
  controls: SlidersHorizontal,
  story: BookOpen,
};
const DOOR_NAV_LABEL: Record<FounderDoor["id"], string> = {
  letter: "Letter",
  decisions: "Decisions",
  controls: "Controls",
  story: "Story",
};
const FOUNDER_NAV_ITEMS_NEW: FounderNavItem[] = FOUNDER_DOORS.map((d) => ({
  id: d.id,
  label: DOOR_NAV_LABEL[d.id],
  href: d.href,
  matchPrefix: d.href === "/founder" ? undefined : d.href,
  icon: DOOR_ICON[d.id],
}));

const LONG_PRESS_MS = 500;

export function FounderMobileBottomNav() {
  const [location] = useLocation();
  const { isMobile, isKeyboardOpen } = useIsMobile();
  const [sheetOpen, setSheetOpen] = useState(false);
  const newFounderUI = useNewFounderUI();
  const FOUNDER_NAV_ITEMS = newFounderUI
    ? FOUNDER_NAV_ITEMS_NEW
    : FOUNDER_NAV_ITEMS_LEGACY;
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFiredRef = useRef(false);

  const clearLongPress = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const startLongPress = () => {
    clearLongPress();
    longPressFiredRef.current = false;
    longPressTimer.current = setTimeout(() => {
      longPressFiredRef.current = true;
      setSheetOpen(true);
    }, LONG_PRESS_MS);
  };

  if (!isMobile || isKeyboardOpen) return null;
  if (!location.startsWith("/founder")) return null;

  return (
    <>
      <nav
        aria-label="Founder mobile navigation"
        className="fixed bottom-0 left-0 right-0 z-floating bg-surface-chrome backdrop-blur-lg border-t border-border"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
        data-testid="founder-mobile-bottom-nav"
      >
        <div className="flex justify-around items-center h-[72px] px-1">
          {FOUNDER_NAV_ITEMS.map((item) => {
            const matchTarget = item.matchPrefix ?? item.href;
            const isActive = item.href === "/founder"
              ? location === "/founder" || location === "/founder/"
              : location === item.href || location.startsWith(matchTarget);
            const ItemIcon = item.icon;
            return (
              <Link
                key={item.id}
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                onTouchStart={startLongPress}
                onTouchEnd={clearLongPress}
                onTouchCancel={clearLongPress}
                onTouchMove={clearLongPress}
                onMouseDown={startLongPress}
                onMouseUp={clearLongPress}
                onMouseLeave={clearLongPress}
                onClick={(e) => {
                  // Swallow the tap nav if a long-press already fired —
                  // we don't want the user to land on a different page
                  // after intentionally opening the persona sheet.
                  if (longPressFiredRef.current) {
                    e.preventDefault();
                    longPressFiredRef.current = false;
                  }
                }}
                className={cn(
                  "flex flex-col items-center justify-center gap-1 min-w-[56px] min-h-[48px] rounded-xl transition-all active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  isActive ? "text-primary" : "text-muted-foreground active:bg-muted/50",
                )}
                data-testid={`founder-mobile-nav-${item.id}`}
              >
                <div className="relative flex items-center justify-center w-full h-8 rounded-full">
                  {isActive && (
                    <motion.div
                      layoutId={NAV_INDICATOR_LAYOUT_IDS.founderBottomNav}
                      className="absolute inset-0 rounded-full bg-primary/15"
                      transition={navIndicatorSpring}
                      aria-hidden="true"
                    />
                  )}
                  <ItemIcon className={cn("relative w-6 h-6", isActive && "text-primary")} aria-hidden="true" />
                </div>
                <span className={cn("text-caption font-medium truncate", isActive && "text-primary")}>
                  {item.label}
                </span>
              </Link>
            );
          })}
        </div>
      </nav>

      {/* Solene chat FAB — reachable from every door on mobile when the
          new founder UI is active. Sits above the bottom nav so it's
          always thumb-reachable without consuming a nav slot. */}
      {newFounderUI && location !== "/founder/solene-chat" && (
        <Link
          href="/founder/solene-chat"
          aria-label="Chat with Solene"
          data-testid="fab-solene-chat"
          className="fixed right-4 z-floating flex items-center justify-center h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-lg active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          style={{
            bottom: "calc(72px + env(safe-area-inset-bottom, 0px) + 16px)",
          }}
        >
          <Sparkles className="h-6 w-6" aria-hidden="true" />
        </Link>
      )}

      {/* spacer so page content doesn't sit under the nav */}
      <div className="h-[72px] md:hidden" style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }} />

      <PersonaSheet open={sheetOpen} onOpenChange={setSheetOpen} />
    </>
  );
}
