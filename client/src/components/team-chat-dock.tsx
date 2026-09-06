/**
 * TeamChatDock — the persistent, collapsible team-chat presence.
 *
 * Cohesion R4: team chat follows the operator across every customer screen,
 * the way Atlas follows the founder. A trigger bubble docks bottom-LEFT
 * (the Pax copilot rail owns the right edge, so left avoids the collision);
 * opening it floats the full `<TeamChatPanel />` — the SAME primitive the
 * Inbox door's Team tab and /team-inbox render, so there is one team-chat
 * implementation, three mount points.
 *
 * Nav discipline: this is connective tissue that lives ACROSS the doors
 * (like ⌘K and notifications), never a new top-level door.
 *
 * Cost discipline: `<TeamChatPanel />` runs five queries + two realtime
 * subscriptions, so it is mounted ONLY while the dock is open — collapsed,
 * this is just a button.
 *
 * Persistence: open/closed is remembered in localStorage. Following the
 * Atlas pattern, the initial render is deterministic (closed) and the stored
 * state is hydrated in an effect, so first paint never flickers.
 */

import { useEffect, useState } from "react";
import { Link } from "wouter";
import { MessagesSquare, X, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TeamChatPanel } from "@/components/team-chat-panel";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "acr-team-dock-open";

export function TeamChatDock() {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);

  // Hydrate the persisted open state after mount (deterministic first paint).
  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY) === "true") setOpen(true);
    } catch {
      /* private-mode / disabled storage — default closed */
    }
  }, []);

  const setOpenPersisted = (next: boolean) => {
    setOpen(next);
    try {
      localStorage.setItem(STORAGE_KEY, String(next));
    } catch {
      /* ignore */
    }
  };

  return (
    <>
      {/* Trigger bubble — bottom-left; sits above the mobile bottom nav. */}
      {!open && (
        <Button
          type="button"
          onClick={() => setOpenPersisted(true)}
          aria-label="Open team chat"
          data-testid="team-dock-trigger"
          className={cn(
            "fixed left-4 z-overlay h-12 w-12 rounded-full p-0 shadow-acr-3",
            isMobile ? "bottom-20" : "bottom-4",
          )}
        >
          <MessagesSquare className="h-5 w-5" aria-hidden="true" />
        </Button>
      )}

      {open && (
        <>
          {/* Mobile: scrim behind the bottom sheet. */}
          {isMobile && (
            <div
              className="fixed inset-0 bg-surface-scrim z-overlay"
              aria-hidden="true"
              onClick={() => setOpenPersisted(false)}
            />
          )}

          <div
            role="dialog"
            aria-label="Team chat"
            data-testid="team-dock-panel"
            className={cn(
              "fixed z-floating flex flex-col border bg-background shadow-acr-3",
              isMobile
                ? "inset-x-0 bottom-0 h-[80vh] rounded-t-2xl"
                : "left-4 bottom-4 w-[720px] max-w-[calc(100vw-2rem)] h-[70vh] rounded-2xl",
            )}
          >
            {/* Header — title + jump-to-full-view + collapse. */}
            <div className="flex items-center justify-between gap-2 border-b px-4 py-2.5">
              <div className="flex items-center gap-2 min-w-0">
                <MessagesSquare className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden="true" />
                <span className="text-sm font-semibold truncate">Team chat</span>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  asChild
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  aria-label="Open the full team inbox"
                >
                  <Link href="/team">
                    <ExternalLink className="h-4 w-4" aria-hidden="true" />
                  </Link>
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  aria-label="Collapse team chat"
                  data-testid="team-dock-collapse"
                  onClick={() => setOpenPersisted(false)}
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </div>

            {/* Body — the shared panel, mounted only while open. */}
            <div className="flex flex-1 min-h-0 overflow-hidden">
              <TeamChatPanel />
            </div>
          </div>
        </>
      )}
    </>
  );
}
