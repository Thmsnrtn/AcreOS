/**
 * PageTopbar — minimal sticky top bar for authenticated app surfaces.
 *
 * JUDGMENT-CALL-RECOMMENDATIONS #2: prototype's `shell.jsx` carries a
 * sticky backdrop-blur top bar with breadcrumb + bell + dark toggle +
 * command palette opener. Production had none — primary nav lived in
 * the sidebar, and chrome above the page area was empty.
 *
 * v1 ships:
 * - Breadcrumb derived from document title (deepest crumb)
 * - Theme mode quick-toggle (light ↔ dark, no system option here —
 *   that lives in /settings → appearance)
 * - Notifications bell (placeholder, hooks into existing
 *   NotificationBanner state in a follow-up commit)
 * - Command-palette trigger (⌘K) — kbd hint visible, click opens
 *
 * Skips the prototype's "ambient AI status" indicator — that's its
 * own feature project (websocket, focus management, error states),
 * out of scope for the polish pass.
 *
 * Mobile: only shows the theme toggle + bell on small screens — bread-
 * crumb collapses to the title-only view in PageShell.
 */

import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { Sun, Moon, Bell, Command, Home, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/contexts/theme-context";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { OrgSwitcher } from "@/components/org-switcher";

interface PageTopbarProps {
  /** Optional explicit title; falls back to document.title minus AcreOS suffix */
  title?: string;
  /** Optional override for the breadcrumb crumbs (besides Home + current) */
  crumbs?: Array<{ label: string; href: string }>;
}

/**
 * Read document.title and strip the trailing " · AcreOS". Mirrors the
 * pattern in PageShell's useDocumentTitleFallback so the top bar tracks
 * page title without coordinating with each page individually.
 */
function useDocumentTitle(): string {
  const [title, setTitle] = useState<string>(() => extractTitle());
  useEffect(() => {
    const update = () => setTitle(extractTitle());
    update();
    // document.title is set by useDocumentTitle hook on each page mount.
    // A MutationObserver on <title> picks that up reliably across all paths.
    const titleEl = document.querySelector("title");
    if (!titleEl) return;
    const obs = new MutationObserver(update);
    obs.observe(titleEl, { childList: true, characterData: true, subtree: true });
    return () => obs.disconnect();
  }, []);
  return title;
}

function extractTitle(): string {
  if (typeof document === "undefined") return "";
  return document.title.replace(/\s·\sAcreOS$/, "").trim();
}

export function PageTopbar({ title: explicitTitle, crumbs }: PageTopbarProps = {}) {
  const docTitle = useDocumentTitle();
  const title = explicitTitle ?? docTitle;
  const [location] = useLocation();
  const { themeConfig, setThemeConfig } = useTheme();
  const { isMobile } = useIsMobile();

  // Resolved mode: on auto, the actual rendered mode tracks system. The
  // toggle button here flips light↔dark and pins explicit (auto users
  // can opt back in via /settings → appearance).
  const isDark =
    themeConfig.mode === "dark" ||
    (themeConfig.mode === "auto" && typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches);

  const toggleMode = () => {
    setThemeConfig({ mode: isDark ? "light" : "dark" });
  };

  const openCommandPalette = () => {
    // Existing CommandPalette listens for ⌘K keyboard shortcut. Dispatching
    // a synthetic keydown is the lowest-risk integration point — the palette
    // doesn't yet expose an imperative open(). Same pattern used in
    // command-palette-trigger surfaces elsewhere.
    const evt = new KeyboardEvent("keydown", {
      key: "k",
      code: "KeyK",
      metaKey: true,
      ctrlKey: !navigator.platform.toLowerCase().includes("mac"),
      bubbles: true,
    });
    document.dispatchEvent(evt);
  };

  // Don't render the breadcrumb on /auth, /, /pricing, /why etc — public
  // surfaces have their own chrome.
  const isAppSurface = !["/auth", "/", "/pricing", "/why", "/terms", "/privacy", "/status", "/changelog"].includes(location);

  if (!isAppSurface) return null;

  return (
    <header
      // data-page-topbar lets the offline banner push us down by its
      // h-10 (40px) while it's visible. See index.css rule that pairs
      // with body[data-offline-banner='true']. Without this the sticky
      // topbar (z-30) is covered by the fixed offline banner (z-[100]).
      data-page-topbar
      className="sticky top-0 z-30 flex items-center justify-between gap-4 px-4 md:px-6 h-14 backdrop-blur-md bg-background/80 border-b border-border"
      role="banner"
    >
      {/* Breadcrumb / title */}
      <div className="flex items-center gap-1.5 min-w-0 flex-1">
        {!isMobile && (
          <>
            <Link href="/today" className="text-muted-foreground hover:text-foreground transition-colors shrink-0">
              <Home className="w-4 h-4" aria-label="Home" />
            </Link>
            {crumbs?.map((c) => (
              <span key={c.href} className="flex items-center gap-1.5 shrink-0">
                <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" aria-hidden="true" />
                <Link href={c.href} className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                  {c.label}
                </Link>
              </span>
            ))}
            {title && (
              <>
                <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" aria-hidden="true" />
                <span className="text-sm font-medium truncate">{title}</span>
              </>
            )}
          </>
        )}
        {isMobile && title && <span className="text-sm font-medium truncate">{title}</span>}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 shrink-0">
        {/* Reyna §2 — VAs flip orgs without logging out. Hidden by the
            component itself when the user only belongs to one org. */}
        <OrgSwitcher compact={isMobile} />
        {!isMobile && (
          <Button
            variant="ghost"
            size="sm"
            onClick={openCommandPalette}
            className="text-xs text-muted-foreground gap-2 h-8"
            aria-label="Open command palette"
          >
            <Command className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Search</span>
            <kbd className="hidden lg:inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border border-border bg-muted text-[10px] font-mono">
              ⌘K
            </kbd>
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleMode}
          aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
          className={cn("min-h-[44px] min-w-[44px] md:h-9 md:w-9 md:min-h-9 md:min-w-9")}
        >
          {isDark ? <Sun className="w-4 h-4" aria-hidden="true" /> : <Moon className="w-4 h-4" aria-hidden="true" />}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Notifications"
          className={cn("min-h-[44px] min-w-[44px] md:h-9 md:w-9 md:min-h-9 md:min-w-9")}
          onClick={() => {
            // Notifications bell is a stub for v1 — clicking dispatches a
            // custom event the existing NotificationBanner can wire into
            // when the proper drawer ships. Until then, this button is a
            // visual anchor without behavior.
            window.dispatchEvent(new CustomEvent("acreos:notifications:open"));
          }}
        >
          <Bell className="w-4 h-4" aria-hidden="true" />
        </Button>
      </div>
    </header>
  );
}
