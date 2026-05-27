/**
 * ThreadSidebar — collapsible left rail listing chat threads.
 *
 * - Desktop: fixed left rail, collapsible.
 * - Mobile: hidden by default, opened via the hamburger in
 *   FounderChatHeader. Slides in over the chat (Sheet-style).
 */
import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { Button } from "@/components/ui/button";
import { Plus, MessageCircle, MessagesSquare, ChevronLeft, X, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useFounderChatThreads } from "@/hooks/use-founder-chat-threads";
import type { ChatThread } from "@shared/founder-chat/artifacts";

interface ThreadSidebarProps {
  activeThreadId: string | null;
  onSelect: (threadId: string) => void;
  /** Mobile open state (controlled by the parent). */
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}

export function ThreadSidebar({
  activeThreadId,
  onSelect,
  mobileOpen = false,
  onMobileClose,
}: ThreadSidebarProps) {
  const { threads, isLoading, createThread } = useFounderChatThreads();
  const [collapsedDesktop, setCollapsedDesktop] = useState(false);

  const handleNew = async () => {
    try {
      const t = await createThread.mutateAsync({});
      onSelect(t.id);
    } catch {
      // Pre-Phase-B: createThread may fail. Sidebar still shows the
      // default thread; we no-op.
    }
  };

  return (
    <>
      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-background/70 backdrop-blur-sm"
          onClick={onMobileClose}
          aria-hidden="true"
        />
      )}

      <aside
        className={cn(
          "flex flex-col bg-background border-r border-border z-50",
          // Desktop layout — fixed width column inside the parent grid.
          "hidden md:flex md:static md:h-full",
          collapsedDesktop ? "md:w-12" : "md:w-64",
          // Mobile — slide-in panel.
          mobileOpen && "flex fixed inset-y-0 left-0 w-72 max-w-[80vw] shadow-xl md:shadow-none",
        )}
        aria-label="Atlas threads"
        data-testid="thread-sidebar"
      >
        <div className="flex items-center justify-between gap-2 px-3 py-3 border-b border-border">
          {!collapsedDesktop && (
            <div className="flex items-center gap-2 min-w-0">
              <MessagesSquare className="w-4 h-4 text-acr-brand shrink-0" aria-hidden="true" />
              <h2 className="text-sm font-semibold truncate">Threads</h2>
            </div>
          )}
          <div className="flex items-center gap-1">
            <Button
              size="icon"
              variant="ghost"
              className="hidden md:inline-flex h-7 w-7"
              onClick={() => setCollapsedDesktop((c) => !c)}
              aria-label={collapsedDesktop ? "Expand sidebar" : "Collapse sidebar"}
              data-testid="sidebar-collapse"
            >
              <ChevronLeft
                className={cn(
                  "w-4 h-4 transition-transform",
                  collapsedDesktop && "rotate-180",
                )}
                aria-hidden="true"
              />
            </Button>
            {onMobileClose && (
              <Button
                size="icon"
                variant="ghost"
                className="md:hidden h-7 w-7"
                onClick={onMobileClose}
                aria-label="Close threads panel"
                data-testid="sidebar-close-mobile"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </Button>
            )}
          </div>
        </div>

        {!collapsedDesktop && (
          <>
            <div className="px-3 py-2">
              <Button
                size="sm"
                variant="outline"
                className="w-full justify-start gap-2"
                onClick={handleNew}
                disabled={createThread.isPending}
                aria-label="Start a new thread"
                data-testid="sidebar-new-thread"
              >
                {createThread.isPending ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                )}
                New thread
              </Button>
            </div>

            <nav
              className="flex-1 min-h-0 overflow-y-auto px-2 pb-3"
              aria-label="Thread list"
            >
              {isLoading ? (
                <p className="px-2 py-3 text-xs text-muted-foreground">Loading…</p>
              ) : (
                <ul className="space-y-0.5" role="list">
                  {threads.map((t) => (
                    <ThreadRow
                      key={t.id}
                      thread={t}
                      active={t.id === activeThreadId}
                      onClick={() => onSelect(t.id)}
                    />
                  ))}
                </ul>
              )}
            </nav>
          </>
        )}
      </aside>
    </>
  );
}

function ThreadRow({
  thread,
  active,
  onClick,
}: {
  thread: ChatThread;
  active: boolean;
  onClick: () => void;
}) {
  const label = thread.isDefault ? "Daily check-in" : thread.title ?? "Untitled thread";
  let relative: string | null = null;
  try {
    const ts = new Date(thread.lastActivityAt);
    if (!Number.isNaN(ts.getTime()) && ts.getTime() > 0) {
      relative = formatDistanceToNow(ts, { addSuffix: true });
    }
  } catch {
    /* swallow */
  }

  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        aria-current={active ? "true" : undefined}
        className={cn(
          "w-full text-left rounded-card px-2 py-2 transition-colors flex items-start gap-2",
          active
            ? "bg-acr-brand-soft/60 text-foreground"
            : "hover:bg-muted/60 text-muted-foreground hover:text-foreground",
        )}
        data-testid={`thread-row-${thread.id}`}
      >
        <MessageCircle
          className={cn(
            "w-3.5 h-3.5 mt-0.5 shrink-0",
            active ? "text-acr-brand" : "text-muted-foreground",
          )}
          aria-hidden="true"
        />
        <div className="flex-1 min-w-0">
          <p className={cn("text-xs font-medium truncate", active && "text-foreground")}>
            {label}
          </p>
          {relative && (
            <p className="text-micro text-muted-foreground truncate">{relative}</p>
          )}
        </div>
      </button>
    </li>
  );
}

export default ThreadSidebar;
