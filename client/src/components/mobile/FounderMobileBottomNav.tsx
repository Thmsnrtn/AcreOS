import { useLocation, Link } from "wouter";
import { cn } from "@/lib/utils";
import { Inbox, Compass, Sliders, Search, Megaphone } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";

/**
 * FounderMobileBottomNav — the founder-side equivalent of MobileBottomNav.
 *
 * The customer MobileBottomNav is suppressed on /founder routes (its items
 * don't apply to founder mode), but until this component existed, founders
 * on mobile had NO navigation — they landed on /founder and saw a single
 * dashboard with no controls to get anywhere else. Reported by Thomas as
 * "felt like a single dashboard and no controls" mid-deep-test.
 *
 * Exactly 5 canonical founder surfaces, all four canonical-IA + CMO. No
 * "More" drawer needed — 5 fits in a 4-or-5-slot bottom nav.
 */

interface FounderNavItem {
  id: string;
  label: string;
  href: string;
  icon: typeof Inbox;
  /** match this path AND any subpath under it */
  matchPrefix?: string;
}

const FOUNDER_NAV_ITEMS: FounderNavItem[] = [
  { id: "now", label: "Now", href: "/founder", icon: Inbox },
  { id: "steering", label: "Steering", href: "/founder/steering", icon: Compass },
  { id: "studio", label: "Studio", href: "/founder/studio", icon: Sliders },
  { id: "inspector", label: "Inspector", href: "/founder/inspector/audit", icon: Search, matchPrefix: "/founder/inspector" },
  { id: "cmo", label: "CMO", href: "/founder/cmo", icon: Megaphone },
];

export function FounderMobileBottomNav() {
  const [location] = useLocation();
  const { isMobile, isKeyboardOpen } = useIsMobile();

  if (!isMobile || isKeyboardOpen) return null;
  if (!location.startsWith("/founder")) return null;

  return (
    <>
      <nav
        aria-label="Founder mobile navigation"
        className="fixed bottom-0 left-0 right-0 z-50 bg-background/95 backdrop-blur-lg border-t border-border"
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
                className={cn(
                  "flex flex-col items-center justify-center gap-1 min-w-[56px] min-h-[48px] rounded-xl transition-all active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  isActive ? "text-primary" : "text-muted-foreground active:bg-muted/50",
                )}
                data-testid={`founder-mobile-nav-${item.id}`}
              >
                <div
                  className={cn(
                    "flex items-center justify-center w-full h-8 rounded-full transition-colors",
                    isActive && "bg-primary/15",
                  )}
                >
                  <ItemIcon className={cn("w-6 h-6", isActive && "text-primary")} aria-hidden="true" />
                </div>
                <span className={cn("text-[11px] font-medium truncate", isActive && "text-primary")}>
                  {item.label}
                </span>
              </Link>
            );
          })}
        </div>
      </nav>

      {/* spacer so page content doesn't sit under the nav */}
      <div className="h-[72px] md:hidden" style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }} />
    </>
  );
}
