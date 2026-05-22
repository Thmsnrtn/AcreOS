/**
 * /founder — Atlas chat shell.
 *
 * Phase C deliverable. Replaces the legacy tile-driven Now-surface as
 * the default founder landing. Layout:
 *
 *   ┌────────────────────────────────────────────────────────────────┐
 *   │ FounderChatHeader     ☰   Atlas — Daily check-in   [Dashboard] │
 *   ├──────────┬─────────────────────────────────────────────────────┤
 *   │ Threads  │                                                     │
 *   │  • Daily │   <MessageList — virtualized, role=log>              │
 *   │  • Q3    │                                                     │
 *   │  + new   │                                                     │
 *   │          ├─────────────────────────────────────────────────────┤
 *   │          │   <Composer — textarea, /-popover, send>            │
 *   └──────────┴─────────────────────────────────────────────────────┘
 *                                              [FounderMobileBottomNav]
 *
 * The morning brief (Phase E) renders as the FIRST message in the
 * default thread each day — it composes the same bucket / net-negative
 * / scale-up data that Now-surface tiles show today, but inline in the
 * chat instead of as a separate dashboard surface.
 *
 * "View dashboard" in the header opens /founder/dashboard which still
 * shows the legacy tile layout (LegacyNowSurface) — handy during the
 * transition, deprecated in Phase F.
 */
import { useState } from "react";
import { Link } from "wouter";
import { Menu, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useFounderChat } from "@/hooks/use-founder-chat";
import { useFounderChatThreads } from "@/hooks/use-founder-chat-threads";
import { Composer } from "@/components/founder-chat/Composer";
import { MessageList } from "@/components/founder-chat/MessageList";
import { ThreadSidebar } from "@/components/founder-chat/ThreadSidebar";

export default function FounderChatPage() {
  useDocumentTitle("Atlas — founder chat");
  const { threads } = useFounderChatThreads();
  const defaultThreadId =
    threads.find((t) => t.isDefault)?.id ?? threads[0]?.id ?? "default";
  const [activeThreadId, setActiveThreadId] = useState<string>(defaultThreadId);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  const {
    messages,
    sendMessage,
    isStreaming,
    activeToolCalls,
    status,
  } = useFounderChat(activeThreadId);

  const activeThread = threads.find((t) => t.id === activeThreadId);
  const headerTitle = activeThread?.isDefault
    ? "Atlas — Daily check-in"
    : activeThread?.title ?? "Atlas";

  return (
    // Container is locked to the viewport minus the founder mobile nav
    // (h-16 on mobile, hidden md+). We use a CSS calc so the chat fills
    // the rest of the screen and only the MessageList scrolls — the
    // Composer stays pinned to the bottom on every breakpoint.
    <div
      className="flex h-[100dvh] md:h-screen w-full overflow-hidden bg-background pb-16 md:pb-0"
      data-testid="founder-chat-shell"
    >
      <ThreadSidebar
        activeThreadId={activeThreadId}
        onSelect={(id) => {
          setActiveThreadId(id);
          setMobileSidebarOpen(false);
        }}
        mobileOpen={mobileSidebarOpen}
        onMobileClose={() => setMobileSidebarOpen(false)}
      />

      <div className="flex-1 min-w-0 flex flex-col">
        {/* Header */}
        <header className="flex items-center gap-2 px-3 sm:px-4 py-2.5 border-b border-border">
          <Button
            size="icon"
            variant="ghost"
            className="md:hidden h-8 w-8"
            onClick={() => setMobileSidebarOpen(true)}
            aria-label="Open thread list"
            data-testid="header-open-sidebar"
          >
            <Menu className="w-4 h-4" aria-hidden="true" />
          </Button>
          <div className="flex-1 min-w-0">
            <h1 className="text-sm font-semibold truncate" data-testid="header-title">
              {headerTitle}
            </h1>
            {isStreaming && (
              <p className="text-[10px] text-acr-brand" aria-live="polite">
                streaming…
              </p>
            )}
          </div>
          <Button
            size="sm"
            variant="ghost"
            asChild
            className="text-xs gap-1.5"
            data-testid="header-view-dashboard"
          >
            <Link href="/founder/dashboard" aria-label="View legacy dashboard">
              <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">View dashboard</span>
              <span className="sm:hidden">Dashboard</span>
            </Link>
          </Button>
        </header>

        {/* Messages */}
        <MessageList
          messages={messages}
          isStreaming={isStreaming}
          activeToolCalls={activeToolCalls}
        />

        {/* Composer */}
        <Composer
          onSubmit={sendMessage}
          disabled={status === "submitting"}
        />
      </div>
    </div>
  );
}
