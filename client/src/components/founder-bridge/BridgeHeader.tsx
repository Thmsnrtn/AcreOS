/**
 * BridgeHeader — 56pt top rail spanning the whole surface.
 *
 * Left: hamburger (mobile only) · brand · persona scope. Right: live dot
 * + Cmd+; affordance. Identity is restrained — the Bridge canvas itself
 * is the brand surface; the header is just orientation.
 */
import { useEffect, useState } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { LiveDot } from "./LiveDot";

export interface BridgeHeaderProps {
  /** True when an SSE stream is active — surfaces the LiveDot. */
  streamActive?: boolean;
  /** Hamburger onClick (mobile only). */
  onMenu?: () => void;
}

export function BridgeHeader({ streamActive, onMenu }: BridgeHeaderProps) {
  const { isMobile } = useIsMobile();
  const clock = useClock();

  return (
    <header
      className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-acr-line px-4 md:px-6"
      data-testid="bridge-header"
    >
      <div className="flex items-center gap-3">
        {isMobile && onMenu && (
          <button
            type="button"
            onClick={onMenu}
            aria-label="Open menu"
            className="flex h-10 w-10 -ml-2 items-center justify-center rounded-card text-muted-foreground hover:bg-white/[0.04] hover:text-foreground"
          >
            <span aria-hidden className="text-lg">☰</span>
          </button>
        )}
        <span className="text-sm font-medium text-foreground/90">AcreOS</span>
        <span aria-hidden className="text-muted-foreground/40">·</span>
        <span className="text-xs uppercase tracking-[0.08em] text-muted-foreground">Founder</span>
      </div>
      <div className="flex items-center gap-3">
        <span className="hidden font-mono text-caption tabular-nums text-muted-foreground sm:inline">
          {clock}
        </span>
        {streamActive && (
          <span className="inline-flex items-center gap-1.5 text-micro uppercase tracking-[0.1em] text-muted-foreground">
            <LiveDot label="Atlas stream active" />
            Live
          </span>
        )}
        <kbd className="hidden h-6 items-center gap-0.5 rounded border border-white/[0.08] px-1.5 font-mono text-micro text-muted-foreground md:inline-flex">
          ⌘;
        </kbd>
      </div>
    </header>
  );
}

/**
 * Single shared clock — once per minute, plenty for header chrome.
 * Format: "Tue · 8:42 AM" (local zone).
 */
function useClock(): string {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  const dow = now.toLocaleDateString(undefined, { weekday: "short" });
  const time = now.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${dow} · ${time}`;
}
